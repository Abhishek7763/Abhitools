import { supabaseRequest } from '../server_shared.js';

const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_TOTAL = 80 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function fail(message, status = 400) {
    throw Object.assign(new Error(message), { status, publicMessage: message });
}

function checkPath(bucket, name) {
    if (!['photos', 'documents'].includes(bucket) || typeof name !== 'string' || name.length > 1024 ||
        !name.startsWith('borrowers/') || name.split('/').some(p => !p || p === '.' || p === '..') ||
        /[\\\x00-\x1f\x7f]/.test(name)) fail('Backup mein upload ka path galat hai.');
}

function checkFileInfo(f, requireHashes) {
    checkPath(f?.bucket, f?.name);
    if (!Number.isSafeInteger(f.size) || f.size <= 0 || f.size > MAX_UPLOAD || !TYPES.has(f.type) ||
        (f.bucket === 'photos' && f.type === 'application/pdf')) fail('Unsupported upload type ya size (maximum 8 MiB per file).');
    if (requireHashes && !/^[a-f0-9]{64}$/.test(f.sha256 || '')) fail('File checksum missing hai.');
}

function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
}

function projectOrigin() {
    return new URL(process.env.SUPABASE_URL).origin;
}

export function checkMedia(file, requireHashes = true) {
    const media = file?.media;
    if (file?.version !== 8 || media?.version !== 1 || !Array.isArray(media.files) || media.files.length > 2000) {
        fail('Portable backup manifest supported nahi hai (maximum 2,000 files).');
    }
    let origin;
    try { origin = new URL(media.origin); } catch { fail('Backup project address invalid hai.'); }
    if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== media.origin) fail('Backup project address invalid hai.');
    const keys = new Set();
    let total = 0;
    for (const f of media.files) {
        checkFileInfo(f, requireHashes);
        const key = f.bucket + '/' + f.name;
        if (keys.has(key)) fail('ZIP mein duplicate upload hai.');
        keys.add(key);
        total += f.size;
    }
    if (total > MAX_TOTAL) fail('Portable backup mein uploads ki limit 80 MiB hai.', 413);

    let external = 0;
    const data = file.data;
    for (const [rows, field] of [[data.borrowers,'photo_url'],[data.documents,'file_url'],[data.loans,'agreement_url']]) {
        for (const row of rows) {
            const raw = row[field];
            if (!raw) continue;
            let key;
            if (String(raw).startsWith('storage://')) key = raw.slice(10);
            else {
                let url;
                try { url = new URL(raw); } catch { external++; continue; }
                const match = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/(photos|documents)\/(.+)$/.exec(url.pathname);
                if (!match || url.origin !== origin.origin) { external++; continue; }
                try { key = match[1] + '/' + decodeURIComponent(match[2]); } catch { fail('Storage link invalid hai.'); }
            }
            if (!/^(?:photos|documents)\/borrowers\//.test(key)) { external++; continue; }
            if (!keys.has(key)) fail('Record ki linked file Storage backup mein missing hai: ' + key, 409);
            // Private documents use the existing signed-link viewer. Public photos follow the target project.
            if (field === 'file_url' && key.startsWith('documents/')) row[field] = 'storage://' + key;
            else if (key.startsWith('photos/')) row[field] = projectOrigin() + '/storage/v1/object/public/' + encodePath(key);
            else if (origin.origin !== projectOrigin() && !raw.startsWith('storage://')) {
                const link = new URL(raw);
                if (!link.pathname.includes('/object/public/')) fail('Private agreement link ko stable Storage reference chahiye.');
                row[field] = projectOrigin() + link.pathname;
            }
        }
    }
    return { external, total };
}

export async function mediaTicket(req, res) {
    const { bucket, name, mode } = req.body || {};
    checkPath(bucket, name);
    if (!['read', 'restore'].includes(mode)) fail('Invalid transfer mode.');
    if (mode === 'restore') checkFileInfo(req.body, true);
    const { data: current } = await supabaseRequest('rpc/abhi_portable_object', 'POST', { p_bucket: bucket, p_name: name });
    if (!current && mode === 'read') fail('Upload Storage mein missing hai.', 409);
    const origin = projectOrigin();
    const path = encodePath(bucket + '/' + name);
    const route = current ? '/object/sign/' : '/object/upload/sign/';
    const key = process.env.SUPABASE_SERVICE_KEY;
    const response = await fetch(origin + '/storage/v1' + route + path, {
        method: 'POST', redirect: 'error',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(current ? { expiresIn: 180 } : {})
    });
    if (!response.ok) fail('Storage transfer shuru nahi hua. Bucket aur permissions check karein.', 502);
    const signed = await response.json();
    const raw = signed.signedURL || signed.url;
    if (typeof raw !== 'string') fail('Storage transfer link missing hai.', 502);
    const url = new URL(raw.startsWith('/object/') ? '/storage/v1' + raw : raw, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/storage/v1' + route) || !url.searchParams.get('token')) {
        fail('Storage transfer link invalid hai.', 502);
    }
    return res.status(200).json({ url: url.href, mode: current ? 'read' : 'upload', current });
}

// A dedicated worker can reach only the configured Storage origin. The admin page keeps its same-origin policy.
function transferWorker(origin) {
    self.onmessage = async ({ data }) => {
        try {
            const url = new URL(data.url);
            const upload = data.mode === 'upload';
            const prefix = upload ? '/storage/v1/object/upload/sign/' : '/storage/v1/object/sign/';
            if (url.origin !== origin || !url.pathname.startsWith(prefix) || !url.searchParams.has('token')) throw new Error('Invalid link');
            const options = { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(120000) };
            if (upload) Object.assign(options, { method: 'PUT', body: data.bytes, headers: { 'Content-Type': data.type, 'x-upsert': 'false' } });
            const response = await fetch(url.href, options);
            if (!response.ok) throw new Error('Storage HTTP ' + response.status);
            if (upload) { self.postMessage({ ok: true }); return; }
            const chunks = [];
            let length = 0;
            const reader = response.body.getReader();
            while (true) {
                const next = await reader.read();
                if (next.done) break;
                length += next.value.length;
                if (length > data.size) { await reader.cancel(); throw new Error('File size badal gaya.'); }
                chunks.push(next.value);
            }
            if (length !== data.size) throw new Error('File adhuri hai.');
            const bytes = await new Blob(chunks).arrayBuffer();
            self.postMessage({ ok: true, bytes }, [bytes]);
        } catch (err) { self.postMessage({ ok: false, error: err.message }); }
    };
}

export function serveTransferWorker(res) {
    const origin = projectOrigin();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; connect-src " + origin + "; frame-ancestors 'none'");
    return res.status(200).send('(' + transferWorker.toString() + ')(' + JSON.stringify(origin) + ');');
}
