import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

export const config = { api: { bodyParser: false } };

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const BUCKETS = new Set(['photos', 'documents']);
const DOC_TYPES = new Set(['agreement', 'aadhaar', 'pan', 'receipt', 'other']);
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function encodeObjectPath(path) {
    return String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

async function removeUploadedObject(supabaseUrl, key, bucket, objectPath) {
    try {
        await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`, {
            method: 'DELETE',
            headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefixes: [objectPath] })
        });
    } catch (error) {
        console.warn('Upload cleanup failed:', error);
    }
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
        if (contentLength > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'File too large (max 8 MB)' });

        const bucket = String(req.query?.bucket || '').trim();
        const borrowerId = String(req.query?.borrower_id || '').trim();
        const loanId = String(req.query?.loan_id || '').trim();
        const docType = String(req.query?.doc_type || '').trim().toLowerCase();
        const filename = safeFilename(req.query?.filename);

        if (!BUCKETS.has(bucket) || !filename) return res.status(400).json({ error: 'Invalid bucket or filename' });
        if (!UUID_RE.test(borrowerId)) return res.status(400).json({ error: 'Valid borrower id required' });
        if (loanId && !UUID_RE.test(loanId)) return res.status(400).json({ error: 'Valid loan id required' });
        if (bucket === 'documents' && !DOC_TYPES.has(docType)) return res.status(400).json({ error: 'Invalid document type' });

        const { data: borrowerRows } = await supabaseRequest(`borrowers?id=eq.${encodeURIComponent(borrowerId)}&deleted_at=is.null&select=id`);
        if (!borrowerRows?.length) return res.status(404).json({ error: 'Borrower not found' });
        if (loanId) {
            const { data: loanRows } = await supabaseRequest(`loans?id=eq.${encodeURIComponent(loanId)}&borrower_id=eq.${encodeURIComponent(borrowerId)}&deleted_at=is.null&select=id`);
            if (!loanRows?.length) return res.status(400).json({ error: 'Loan does not belong to borrower' });
        }

        const contentType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
        const allowed = bucket === 'photos' ? PHOTO_TYPES : DOCUMENT_TYPES;
        if (!allowed.has(contentType)) return res.status(415).json({ error: 'Unsupported file type' });

        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'File too large (max 8 MB)' });
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        if (!buffer.length) return res.status(400).json({ error: 'Empty file' });

        const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
        const key = env('SUPABASE_SERVICE_KEY');
        const folder = bucket === 'photos' ? `borrowers/${borrowerId}` : `borrowers/${borrowerId}`;
        const objectPath = `${folder}/${Date.now()}-${filename}`;
        const encodedPath = encodeObjectPath(objectPath);
        const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
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

        if (bucket === 'photos') {
            const fileUrl = `${supabaseUrl}/storage/v1/object/public/photos/${encodedPath}`;
            try {
                await supabaseRequest(`borrowers?id=eq.${encodeURIComponent(borrowerId)}`, 'PATCH', { photo_url: fileUrl });
                await supabaseRequest('activity_log', 'POST', {
                    action: 'UPDATE_BORROWER_PHOTO',
                    table_name: 'borrowers',
                    record_id: borrowerId,
                    description: `Borrower photo updated: ${filename}`
                });
            } catch (error) {
                await removeUploadedObject(supabaseUrl, key, bucket, objectPath);
                throw error;
            }
            return res.status(200).json({ success: true, kind: 'photo', url: fileUrl, path: objectPath });
        }

        try {
            const { data: inserted } = await supabaseRequest('documents', 'POST', {
                borrower_id: borrowerId,
                loan_id: loanId || null,
                doc_type: docType,
                file_name: filename,
                file_url: `storage://documents/${objectPath}`
            });
            const document = inserted?.[0] || null;
            await supabaseRequest('activity_log', 'POST', {
                action: 'UPLOAD_DOCUMENT',
                table_name: 'documents',
                record_id: document?.id || null,
                description: `Document uploaded: ${docType} / ${filename}`
            });
            return res.status(200).json({ success: true, kind: 'document', document, path: objectPath });
        } catch (error) {
            await removeUploadedObject(supabaseUrl, key, bucket, objectPath);
            throw error;
        }
    } catch (err) {
        return sendServerError(res, 'Upload API Error:', err);
    }
}
