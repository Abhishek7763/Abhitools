import crypto from 'node:crypto';

const COOKIE_NAME = 'abhi_admin_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
}

function authSecret() {
    return process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY || process.env.ADMIN_PASS;
}

function b64url(input) {
    return Buffer.from(input).toString('base64url');
}

function safeEqual(a, b) {
    const aa = Buffer.from(String(a ?? ''));
    const bb = Buffer.from(String(b ?? ''));
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
}

function sign(payloadB64) {
    const secret = authSecret();
    if (!secret) throw new Error('Missing ADMIN_SESSION_SECRET/SUPABASE_SERVICE_KEY');
    return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function createAdminSession() {
    const payload = {
        v: 1,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        nonce: crypto.randomBytes(12).toString('base64url')
    };
    const payloadB64 = b64url(JSON.stringify(payload));
    return `${payloadB64}.${sign(payloadB64)}`;
}

export function isValidAdminSession(req) {
    try {
        const cookieHeader = req.headers?.cookie || '';
        const cookies = Object.fromEntries(cookieHeader.split(';').map(part => {
            const i = part.indexOf('=');
            return i === -1 ? [part.trim(), ''] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1))];
        }).filter(([k]) => k));
        const token = cookies[COOKIE_NAME];
        if (!token) return false;
        const [payloadB64, signature] = token.split('.');
        if (!payloadB64 || !signature || !safeEqual(signature, sign(payloadB64))) return false;
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        return payload?.v === 1 && Number(payload.exp) > Math.floor(Date.now() / 1000);
    } catch {
        return false;
    }
}

export function setAdminCookie(res, token) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`);
}

export function clearAdminCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

export function credentialsMatch(userId, password) {
    return safeEqual(userId, requiredEnv('ADMIN_ID')) && safeEqual(password, requiredEnv('ADMIN_PASS'));
}

export function getClientAddress(req) {
    const forwarded = req?.headers?.['x-forwarded-for'];
    const realIp = req?.headers?.['x-real-ip'];
    const source = Array.isArray(forwarded) ? forwarded[0] : (forwarded || realIp || 'unknown');
    const first = String(source).split(',')[0].trim().slice(0, 128);
    return first || 'unknown';
}

export function securityFingerprint(purpose, value) {
    const secret = authSecret();
    if (!secret) throw new Error('Missing server security secret');
    return crypto.createHmac('sha256', secret)
        .update(`${String(purpose || 'security')}\0${String(value || '')}`)
        .digest('hex');
}

export function noStore(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
}

export function requireAdmin(req, res) {
    if (!isValidAdminSession(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

export async function supabaseRequest(path, method = 'GET', body = undefined, extraHeaders = {}) {
    const url = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
    const key = requiredEnv('SUPABASE_SERVICE_KEY');
    const headers = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...extraHeaders
    };
    const options = { method, headers };
    if (body !== undefined) options.body = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);

    const response = await fetch(`${url}/rest/v1/${path}`, options);
    const text = await response.text();
    let data = null;
    if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
        const err = new Error(`Supabase request failed (${response.status})`);
        err.status = response.status;
        err.details = data;
        throw err;
    }
    return { data, status: response.status };
}

export function sendServerError(res, label, err) {
    console.error(label, err);
    const status = Number(err?.status) >= 400 && Number(err?.status) < 600 ? Number(err.status) : 500;
    const publicMessage = typeof err?.publicMessage === 'string' ? err.publicMessage.trim() : '';
    return res.status(status).json({ error: status === 500 ? 'Server error' : (publicMessage || 'Request failed') });
}
