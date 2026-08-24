import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanLabel(value, fallback = null) {
    const text = String(value || '').trim().slice(0, 120);
    return text || fallback;
}

async function fullBackupPayload() {
    const [borrowersRes, loansRes, emisRes, documentsRes] = await Promise.all([
        supabaseRequest('borrowers?select=*&order=created_at.asc'),
        supabaseRequest('loans?select=*&order=created_at.asc'),
        supabaseRequest('emis?select=*&order=loan_id.asc,installment_number.asc'),
        supabaseRequest('documents?select=*&order=uploaded_at.asc')
    ]);

    return {
        format: 'abhitools-backup',
        version: 2,
        created_at: new Date().toISOString(),
        note: 'Full AbhiTools data backup. Document records contain metadata/paths; storage file bytes are not embedded.',
        data: {
            borrowers: borrowersRes.data || [],
            loans: loansRes.data || [],
            emis: emisRes.data || [],
            documents: documentsRes.data || []
        }
    };
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;

    const action = String(req.query?.action || '').toLowerCase();

    try {
        if (req.method === 'GET' && action === 'export') {
            const payload = await fullBackupPayload();
            const date = new Date().toISOString().slice(0, 10);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="AbhiTools_Full_Backup_${date}.json"`);
            return res.status(200).send(JSON.stringify(payload, null, 2));
        }

        if (req.method === 'GET' && action === 'list') {
            const { data } = await supabaseRequest(
                'backup_snapshots?select=id,label,reason,summary,created_at&order=created_at.desc&limit=30'
            );
            return res.status(200).json(data || []);
        }

        if (req.method === 'POST' && action === 'create') {
            const label = cleanLabel(req.body?.label, `Manual backup ${new Date().toLocaleDateString('en-IN')}`);
            const { data } = await supabaseRequest('rpc/abhi_create_backup_snapshot', 'POST', {
                p_label: label,
                p_reason: 'manual'
            });
            const snapshotId = Array.isArray(data) ? data[0] : data;
            return res.status(201).json({ success: true, snapshot_id: snapshotId, label });
        }

        if (req.method === 'POST' && action === 'restore') {
            const snapshotId = String(req.body?.snapshot_id || '').trim();
            if (!UUID_RE.test(snapshotId)) return res.status(400).json({ error: 'Valid snapshot_id required' });
            if (req.body?.confirm !== true) return res.status(400).json({ error: 'Restore confirmation required' });

            const { data } = await supabaseRequest('rpc/abhi_restore_backup_snapshot', 'POST', {
                p_snapshot_id: snapshotId
            });
            return res.status(200).json(Array.isArray(data) ? (data[0] || { success: true }) : (data || { success: true }));
        }

        res.setHeader('Allow', 'GET, POST');
        return res.status(404).json({ error: 'Backup action not found' });
    } catch (err) {
        return sendServerError(res, 'Backup API Error:', err);
    }
}
