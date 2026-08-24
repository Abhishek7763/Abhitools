import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function env(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
}

function encodeObjectPath(path) {
    return String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function parseStorageRef(value) {
    const text = String(value || '');
    const match = /^storage:\/\/([^/]+)\/(.+)$/.exec(text);
    if (!match) return null;
    return { bucket: match[1], path: match[2] };
}

async function signedUrlFor(bucket, path, expiresIn = 900) {
    const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
    const key = env('SUPABASE_SERVICE_KEY');
    const encodedPath = encodeObjectPath(path);
    const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, {
        method: 'POST',
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ expiresIn })
    });
    if (!response.ok) {
        console.error('Signed URL creation failed', response.status, await response.text());
        throw new Error('Could not create document access link');
    }
    const data = await response.json();
    const raw = data.signedURL || data.signedUrl || data.url;
    if (!raw) throw new Error('Signed URL missing');
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/storage/v1/')) return `${supabaseUrl}${raw}`;
    return `${supabaseUrl}/storage/v1${raw.startsWith('/') ? '' : '/'}${raw}`;
}

async function removeStorageObject(bucket, path) {
    const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
    const key = env('SUPABASE_SERVICE_KEY');
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`, {
        method: 'DELETE',
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefixes: [path] })
    });
    if (!response.ok) {
        console.error('Storage delete failed', response.status, await response.text());
        throw new Error('Storage file delete failed');
    }
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;

    const action = String(req.query?.action || '').trim();

    try {
        if (req.method === 'GET' && action === 'list') {
            const borrowerId = String(req.query?.borrower_id || '').trim();
            if (!UUID_RE.test(borrowerId)) return res.status(400).json({ error: 'Valid borrower id required' });
            const { data } = await supabaseRequest(
                `documents?borrower_id=eq.${encodeURIComponent(borrowerId)}&select=id,borrower_id,loan_id,doc_type,file_name,file_url,uploaded_at&order=uploaded_at.desc`
            );
            return res.status(200).json(data || []);
        }

        if (req.method === 'GET' && action === 'signed') {
            const id = String(req.query?.id || '').trim();
            if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Valid document id required' });
            const { data } = await supabaseRequest(
                `documents?id=eq.${encodeURIComponent(id)}&select=id,doc_type,file_name,file_url`
            );
            const document = data?.[0];
            if (!document) return res.status(404).json({ error: 'Document not found' });

            const storageRef = parseStorageRef(document.file_url);
            if (!storageRef) {
                const external = String(document.file_url || '');
                if (!/^https:\/\//i.test(external)) return res.status(409).json({ error: 'Document storage reference invalid' });
                return res.status(200).json({ url: external, expiresIn: null });
            }
            if (storageRef.bucket !== 'documents') return res.status(409).json({ error: 'Unsupported document bucket' });
            const url = await signedUrlFor(storageRef.bucket, storageRef.path, 900);
            return res.status(200).json({ url, expiresIn: 900 });
        }

        if (req.method === 'DELETE' && action === 'delete') {
            const id = String(req.body?.id || '').trim();
            if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Valid document id required' });
            const { data } = await supabaseRequest(
                `documents?id=eq.${encodeURIComponent(id)}&select=id,borrower_id,loan_id,doc_type,file_name,file_url`
            );
            const document = data?.[0];
            if (!document) return res.status(404).json({ error: 'Document not found' });

            const storageRef = parseStorageRef(document.file_url);
            if (storageRef?.bucket === 'documents') {
                await removeStorageObject(storageRef.bucket, storageRef.path);
            }
            await supabaseRequest(`documents?id=eq.${encodeURIComponent(id)}`, 'DELETE');
            await supabaseRequest('activity_log', 'POST', {
                action: 'DELETE_DOCUMENT',
                table_name: 'documents',
                record_id: id,
                description: `Document deleted: ${document.doc_type || 'document'} / ${document.file_name || ''}`
            });
            return res.status(200).json({ success: true });
        }

        res.setHeader('Allow', 'GET, DELETE');
        return res.status(404).json({ error: 'Action not found' });
    } catch (err) {
        return sendServerError(res, 'Documents API Error:', err);
    }
}
