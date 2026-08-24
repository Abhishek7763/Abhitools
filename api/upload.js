import { noStore, requireAdmin } from '../server_shared.js';

export const config = { api: { bodyParser: false } };

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const BUCKETS = new Set(['photos', 'documents']);
const DOC_TYPES = new Set(['agreement', 'aadhaar', 'pan', 'photo', 'other']);
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

function env(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
}

function safeFilename(name) {
    return String(name || '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 120);
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const contentLength = Number(req.headers['content-length'] || 0);
        if (contentLength > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'File too large' });

        const { bucket, borrower_id, loan_id, doc_type } = req.query || {};
        const filename = safeFilename(req.query?.filename);
        if (!BUCKETS.has(bucket) || !filename) return res.status(400).json({ error: 'Invalid bucket or filename' });
        if (doc_type && !DOC_TYPES.has(doc_type)) return res.status(400).json({ error: 'Invalid document type' });

        const contentType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
        const allowed = bucket === 'photos' ? PHOTO_TYPES : DOCUMENT_TYPES;
        if (!allowed.has(contentType)) return res.status(415).json({ error: 'Unsupported file type' });

        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'File too large' });
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        if (!buffer.length) return res.status(400).json({ error: 'Empty file' });

        const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
        const key = env('SUPABASE_SERVICE_KEY');
        const objectPath = `${Date.now()}-${filename}`;
        const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodeURIComponent(objectPath)}`, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': contentType,
                'x-upsert': 'false'
            },
            body: buffer
        });
        if (!uploadRes.ok) {
            console.error('Storage upload failed', uploadRes.status, await uploadRes.text());
            return res.status(502).json({ error: 'Upload failed' });
        }

        const fileUrl = bucket === 'photos'
            ? `${supabaseUrl}/storage/v1/object/public/photos/${encodeURIComponent(objectPath)}`
            : null;

        if (borrower_id && doc_type) {
            const recordRes = await fetch(`${supabaseUrl}/rest/v1/documents`, {
                method: 'POST',
                headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation'
                },
                body: JSON.stringify({
                    borrower_id,
                    loan_id: loan_id || null,
                    doc_type,
                    file_name: objectPath,
                    file_url: fileUrl || `storage://${bucket}/${objectPath}`
                })
            });
            if (!recordRes.ok) {
                console.error('Document record insert failed', recordRes.status, await recordRes.text());
                return res.status(502).json({ error: 'File uploaded but metadata save failed' });
            }
        }

        return res.status(200).json({ success: true, url: fileUrl, path: objectPath });
    } catch (err) {
        console.error('Upload API Error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
}
