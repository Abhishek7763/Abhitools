import {
    clearAdminCookie,
    createAdminSession,
    credentialsMatch,
    isValidAdminSession,
    noStore,
    setAdminCookie
} from '../server_shared.js';

export default function handler(req, res) {
    noStore(res);

    if (req.method === 'GET') {
        return res.status(isValidAdminSession(req) ? 200 : 401).json({ authenticated: isValidAdminSession(req) });
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
        if (!credentialsMatch(String(userId).trim(), String(password))) {
            clearAdminCookie(res);
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        setAdminCookie(res, createAdminSession());
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Auth configuration error:', err);
        return res.status(500).json({ error: 'Server configuration error' });
    }
}
