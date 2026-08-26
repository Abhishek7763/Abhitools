import {
    clearAdminCookie,
    createAdminSession,
    credentialsMatch,
    getClientAddress,
    isValidAdminSession,
    noStore,
    securityFingerprint,
    setAdminCookie,
    supabaseRequest
} from '../server_shared.js';

function rateLimitBucket(req) {
    return securityFingerprint('admin-login-ip', getClientAddress(req));
}

async function rateLimitAction(bucketHash, action) {
    try {
        const { data } = await supabaseRequest('rpc/abhi_admin_login_rate_limit', 'POST', {
            p_bucket_hash: bucketHash,
            p_action: action
        });
        return Array.isArray(data) ? data[0] : data;
    } catch (error) {
        // Availability first: if the limiter is temporarily unavailable, keep the existing
        // authentication path working and log the degraded protection for diagnostics.
        console.warn('Admin login rate limiter unavailable:', error?.message || error);
        return null;
    }
}

function sendRateLimited(res, state) {
    const retryAfter = Math.max(1, Number(state?.retry_after_seconds) || 600);
    res.setHeader('Retry-After', String(retryAfter));
    clearAdminCookie(res);
    return res.status(429).json({
        success: false,
        error: 'Too many login attempts. Please try again later.',
        retry_after_seconds: retryAfter
    });
}

export default async function handler(req, res) {
    noStore(res);

    if (req.method === 'GET') {
        const authenticated = isValidAdminSession(req);
        return res.status(authenticated ? 200 : 401).json({ authenticated });
    }

    if (req.method === 'DELETE') {
        clearAdminCookie(res);
        return res.status(200).json({ success: true });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST, DELETE');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { userId = '', password = '' } = req.body || {};
        const normalizedUserId = String(userId).trim();
        const bucketHash = rateLimitBucket(req);

        const currentState = await rateLimitAction(bucketHash, 'check');
        if (currentState?.allowed === false) return sendRateLimited(res, currentState);

        if (!credentialsMatch(normalizedUserId, String(password))) {
            const failedState = await rateLimitAction(bucketHash, 'fail');
            if (failedState?.allowed === false) return sendRateLimited(res, failedState);
            clearAdminCookie(res);
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        await rateLimitAction(bucketHash, 'clear');
        setAdminCookie(res, createAdminSession());
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Auth configuration error:', err);
        return res.status(500).json({ error: 'Server configuration error' });
    }
}
