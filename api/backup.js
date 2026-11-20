import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanLabel(value, fallback = null) {
    const text = String(value || '').trim().slice(0, 120);
    return text || fallback;
}

const ANY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESTORE_TABLES = ['app_settings', 'collection_followups', 'borrowers', 'loans', 'emis', 'loan_settlements', 'emi_payments', 'documents', 'recycle_bin'];
const MAX_RESTORE_ROWS = 20000;

function restoreError(message) {
    return Object.assign(new Error(message), { status: 400, publicMessage: message });
}

// Validates an exported "abhitools-backup" file BEFORE anything is written to Supabase.
// Returns the snapshot-shaped payload that abhi_restore_backup_snapshot() understands.
export function validateBackupFile(file) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw restoreError('Backup file ka format galat hai.');
    if (file.format !== 'abhitools-backup') throw restoreError('Ye AbhiTools Full Backup JSON nahi hai (format: abhitools-backup chahiye).');
    const version = Number(file.version);
    if (!Number.isInteger(version) || version < 1 || version > 7) throw restoreError(`Backup version ${file.version} supported nahi hai.`);
    const data = file.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw restoreError('Backup file me data section nahi mila.');

    // Only tables that are present in the file are staged. A table missing from an old backup is
    // simply absent from the snapshot (app_settings then stays untouched, see the SQL restore function).
    const payload = { format: 'abhitools-snapshot', version: 7 };
    const counts = {};
    let total = 0;
    for (const table of RESTORE_TABLES) {
        if (data[table] === undefined) continue;
        if (!Array.isArray(data[table])) throw restoreError(`"${table}" list hona chahiye.`);
        for (const row of data[table]) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw restoreError(`"${table}" me galat row mili.`);
        }
        payload[table] = data[table];
        counts[table] = data[table].length;
        total += data[table].length;
    }
    if (total > MAX_RESTORE_ROWS) throw restoreError(`File bahut badi hai. Maximum ${MAX_RESTORE_ROWS} records supported.`);
    if (!(payload.borrowers || []).length) {
        throw restoreError('File me ek bhi borrower nahi hai. Khali file se restore allowed nahi hai kyunki poora data ud jata.');
    }

    const ids = {};
    for (const table of ['borrowers', 'loans', 'emis', 'loan_settlements', 'emi_payments', 'documents', 'collection_followups', 'recycle_bin']) {
        const seen = new Set();
        for (const row of payload[table] || []) {
            const id = String(row.id || '');
            if (!ANY_UUID_RE.test(id)) throw restoreError(`"${table}" me valid id nahi hai.`);
            if (seen.has(id)) throw restoreError(`"${table}" me duplicate id mili.`);
            seen.add(id);
        }
        ids[table] = seen;
    }

    const link = (table, field, target, required) => {
        for (const row of payload[table] || []) {
            const value = row[field];
            if (value === null || value === undefined || value === '') {
                if (required) throw restoreError(`"${table}" me ${field} missing hai.`);
                continue;
            }
            if (!ids[target].has(String(value))) throw restoreError(`"${table}.${field}" ek aise record ko point karta hai jo file me nahi hai.`);
        }
    };
    link('loans', 'borrower_id', 'borrowers', true);
    link('emis', 'loan_id', 'loans', true);
    link('loan_settlements', 'loan_id', 'loans', true);
    link('emi_payments', 'emi_id', 'emis', true);
    link('emi_payments', 'settlement_id', 'loan_settlements', false);
    link('documents', 'borrower_id', 'borrowers', false);
    link('documents', 'loan_id', 'loans', false);
    link('collection_followups', 'borrower_id', 'borrowers', true);
    link('collection_followups', 'loan_id', 'loans', false);
    link('collection_followups', 'emi_id', 'emis', false);

    for (const b of payload.borrowers) if (!String(b.name || '').trim()) throw restoreError('Kisi borrower ka naam khali hai.');
    for (const l of payload.loans || []) if (!String(l.loan_code || '').trim()) throw restoreError('Kisi loan ka loan_code khali hai.');

    return { payload, counts };
}

async function fullBackupPayload() {
    const [settingsRes, followupsRes, borrowersRes, loansRes, emisRes, settlementsRes, paymentsRes, documentsRes, recycleRes] = await Promise.all([
        supabaseRequest('app_settings?select=*&order=id.asc'),
        supabaseRequest('collection_followups?select=*&order=created_at.asc'),
        supabaseRequest('borrowers?select=*&order=created_at.asc'),
        supabaseRequest('loans?select=*&order=created_at.asc'),
        supabaseRequest('emis?select=*&order=loan_id.asc,installment_number.asc'),
        supabaseRequest('loan_settlements?select=*&order=settlement_date.asc,created_at.asc'),
        supabaseRequest('emi_payments?select=*&order=payment_date.asc,created_at.asc'),
        supabaseRequest('documents?select=*&order=uploaded_at.asc'),
        supabaseRequest('recycle_bin?select=*&order=deleted_at.asc')
    ]);

    return {
        format: 'abhitools-backup',
        version: 7,
        created_at: new Date().toISOString(),
        note: 'Full AbhiTools data backup including app settings, collection follow-up/PTP history, EMI payment and loan settlement history. Document records contain metadata/paths; storage file bytes are not embedded. Recycle Bin state is included.',
        data: {
            app_settings: settingsRes.data || [],
            collection_followups: followupsRes.data || [],
            borrowers: borrowersRes.data || [],
            loans: loansRes.data || [],
            emis: emisRes.data || [],
            loan_settlements: settlementsRes.data || [],
            emi_payments: paymentsRes.data || [],
            documents: documentsRes.data || [],
            recycle_bin: recycleRes.data || []
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

        if (req.method === 'POST' && action === 'restore_file') {
            // Full replace from an exported backup JSON: stage the file as a snapshot, then run the existing
            // transactional restore (it takes a pre-restore safety snapshot, wipes everything, re-inserts with original IDs).
            if (req.body?.confirm !== true) return res.status(400).json({ error: 'Restore confirmation required' });
            const { payload, counts } = validateBackupFile(req.body?.payload);
            const label = cleanLabel(req.body?.label, 'Uploaded backup file');
            const { data: staged } = await supabaseRequest('backup_snapshots', 'POST', {
                label: `File restore source: ${label}`,
                reason: 'file-restore-source',
                payload,
                summary: counts
            });
            const snapshotId = String((Array.isArray(staged) ? staged[0]?.id : staged?.id) || '');
            if (!ANY_UUID_RE.test(snapshotId)) throw new Error('Could not stage backup file');

            const { data } = await supabaseRequest('rpc/abhi_restore_backup_snapshot', 'POST', { p_snapshot_id: snapshotId });
            const result = Array.isArray(data) ? (data[0] || { success: true }) : (data || { success: true });
            return res.status(200).json({ ...result, staged_snapshot_id: snapshotId, file_counts: counts });
        }

        res.setHeader('Allow', 'GET, POST');
        return res.status(404).json({ error: 'Backup action not found' });
    } catch (err) {
        return sendServerError(res, 'Backup API Error:', err);
    }
}
