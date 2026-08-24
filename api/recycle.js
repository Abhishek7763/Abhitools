import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function env(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
}

function parseStorageRef(value) {
    const text = String(value || '');
    const direct = /^storage:\/\/([^/]+)\/(.+)$/.exec(text);
    if (direct) return { bucket: direct[1], path: direct[2] };
    const publicPhoto = /\/storage\/v1\/object\/public\/photos\/(.+)$/i.exec(text);
    if (publicPhoto) {
        try { return { bucket: 'photos', path: decodeURIComponent(publicPhoto[1]) }; }
        catch { return { bucket: 'photos', path: publicPhoto[1] }; }
    }
    return null;
}

async function removeObjectsBestEffort(refs) {
    const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
    const key = env('SUPABASE_SERVICE_KEY');
    const unique = new Map();
    for (const ref of refs) {
        if (!ref?.bucket || !ref?.path) continue;
        unique.set(`${ref.bucket}:${ref.path}`, ref);
    }
    const failures = [];
    for (const ref of unique.values()) {
        try {
            const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(ref.bucket)}`, {
                method: 'DELETE',
                headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ prefixes: [ref.path] })
            });
            if (!response.ok) failures.push(`${ref.bucket}/${ref.path}`);
        } catch {
            failures.push(`${ref.bucket}/${ref.path}`);
        }
    }
    return failures;
}

async function collectStorageRefs(item) {
    const refs = [];
    if (item.entity_type === 'document') {
        const { data } = await supabaseRequest(`documents?id=eq.${encodeURIComponent(item.record_id)}&select=file_url`);
        const ref = parseStorageRef(data?.[0]?.file_url);
        if (ref) refs.push(ref);
    } else if (item.entity_type === 'loan') {
        const { data } = await supabaseRequest(`documents?loan_id=eq.${encodeURIComponent(item.record_id)}&select=file_url`);
        for (const row of (data || [])) {
            const ref = parseStorageRef(row.file_url);
            if (ref) refs.push(ref);
        }
    } else if (item.entity_type === 'borrower') {
        const [borrowerRes, docRes] = await Promise.all([
            supabaseRequest(`borrowers?id=eq.${encodeURIComponent(item.record_id)}&select=photo_url`),
            supabaseRequest(`documents?borrower_id=eq.${encodeURIComponent(item.record_id)}&select=file_url`)
        ]);
        const photo = parseStorageRef(borrowerRes.data?.[0]?.photo_url);
        if (photo) refs.push(photo);
        for (const row of (docRes.data || [])) {
            const ref = parseStorageRef(row.file_url);
            if (ref) refs.push(ref);
        }
    }
    return refs;
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    const action = String(req.query?.action || '').trim().toLowerCase();

    try {
        if (req.method === 'GET' && (!action || action === 'list')) {
            const { data } = await supabaseRequest(
                'recycle_bin?restored_at=is.null&purged_at=is.null&select=id,entity_type,record_id,label,summary,deleted_at,created_at&order=deleted_at.desc&limit=200'
            );
            return res.status(200).json(data || []);
        }

        if (req.method === 'POST' && action === 'restore') {
            const id = String(req.body?.recycle_id || '').trim();
            if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Valid recycle_id required' });
            if (req.body?.confirm !== true) return res.status(400).json({ error: 'Restore confirmation required' });
            const { data } = await supabaseRequest('rpc/abhi_restore_recycle_item', 'POST', { p_recycle_id: id });
            return res.status(200).json(Array.isArray(data) ? (data[0] || { success: true }) : (data || { success: true }));
        }

        if (req.method === 'DELETE' && action === 'purge') {
            const id = String(req.body?.recycle_id || '').trim();
            if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Valid recycle_id required' });
            if (String(req.body?.confirm || '').trim().toUpperCase() !== 'PURGE') {
                return res.status(400).json({ error: 'Type PURGE to permanently delete' });
            }
            const { data: rows } = await supabaseRequest(
                `recycle_bin?id=eq.${encodeURIComponent(id)}&restored_at=is.null&purged_at=is.null&select=id,entity_type,record_id,label`
            );
            const item = rows?.[0];
            if (!item) return res.status(404).json({ error: 'Recycle item not found' });

            // Capture storage references first, delete DB records atomically, then clean storage best-effort.
            const storageRefs = await collectStorageRefs(item);
            const { data } = await supabaseRequest('rpc/abhi_purge_recycle_item', 'POST', { p_recycle_id: id });
            const cleanupFailures = await removeObjectsBestEffort(storageRefs);
            const result = Array.isArray(data) ? (data[0] || { success: true }) : (data || { success: true });
            return res.status(200).json({ ...result, storage_cleanup_warning: cleanupFailures.length ? cleanupFailures.length : 0 });
        }

        res.setHeader('Allow', 'GET, POST, DELETE');
        return res.status(404).json({ error: 'Recycle action not found' });
    } catch (err) {
        return sendServerError(res, 'Recycle API Error:', err);
    }
}
