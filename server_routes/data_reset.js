import { supabaseRequest } from '../server_shared.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readBatch(job) {
    const { data } = await supabaseRequest('rpc/abhi_reset_file_batch', 'POST', { p_job: job });
    if (!Array.isArray(data?.files) || !Number.isInteger(data.remaining) || data.remaining < data.files.length) {
        throw new Error('Invalid reset batch response');
    }
    return data;
}

async function deleteBatch(files) {
    const base = process.env.SUPABASE_URL.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_KEY;
    for (const file of files) {
        if (!['photos', 'documents'].includes(file.bucket) || !file.name?.startsWith('borrowers/')) {
            throw new Error('Unexpected upload outside Abhi Tools folders');
        }
    }
    for (const bucket of ['photos', 'documents']) {
        const names = files.filter(file => file.bucket === bucket).map(file => file.name);
        if (!names.length) continue;
        const response = await fetch(`${base}/storage/v1/object/${bucket}`, {
            method: 'DELETE',
            headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefixes: names })
        });
        if (!response.ok) throw new Error('Storage cleanup failed');
    }
}

// Called only after the shared backup endpoint checks the admin session.
export async function handleDataReset(action, req, res) {
    if (action === 'reset_preview' && req.method === 'GET') {
        const { data } = await supabaseRequest('rpc/abhi_reset_preview', 'POST', {});
        return res.status(200).json(data);
    }
    if (!['reset_start', 'reset_continue'].includes(action) || req.method !== 'POST') {
        return res.status(405).json({ error: 'Unsupported reset action' });
    }
    const job = req.body?.job_id;
    if (typeof job !== 'string' || !UUID.test(job)) return res.status(400).json({ error: 'Valid reset ID required' });
    if (action === 'reset_start') {
        if (req.body.confirm !== 'DELETE ALL') return res.status(400).json({ error: 'DELETE ALL type karein.' });
        const { data } = await supabaseRequest('rpc/abhi_start_data_reset', 'POST', { p_job: job, p_confirm: req.body.confirm });
        if (!UUID.test(data)) throw new Error('Invalid reset ID');
        return res.status(200).json({ job_id: data });
    }
    const batch = await readBatch(job);
    if (!batch.remaining) return res.status(200).json({ remaining: 0 });
    await deleteBatch(batch.files);
    const next = await readBatch(job);
    if (next.remaining >= batch.remaining) {
        return res.status(503).json({ error: 'Storage cleanup pending hai. Resume karein.' });
    }
    return res.status(200).json({ remaining: next.remaining });
}
