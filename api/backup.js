import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

import { gzipSync, gunzipSync } from 'node:zlib';
import { checkMedia, mediaTicket, serveTransferWorker } from '../server_routes/portable_backup.js';
import { handleDataReset } from '../server_routes/data_reset.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_GZIP_BYTES = 2850000;
const DIRECT_JSON_BYTES = 3500000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanLabel(value, fallback = null) {
    const text = String(value || '').trim().slice(0, 120);
    return text || fallback;
}

const ANY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESTORE_TABLES = ['app_settings', 'collection_followups', 'borrowers', 'loans', 'emis', 'loan_settlements', 'emi_payments', 'documents', 'recycle_bin'];
const V8_TABLES = [...RESTORE_TABLES, 'upi_payment_config', 'upi_payment_requests', 'activity_log'];

function restoreError(message) {
    return Object.assign(new Error(message), { status: 400, publicMessage: message });
}

// Validates an exported "abhitools-backup" file BEFORE anything is written to Supabase.
// Returns the snapshot-shaped payload that abhi_restore_backup_snapshot() understands.
export function validateBackupFile(file) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw restoreError('Backup file ka format galat hai.');
    if (file.format !== 'abhitools-backup') throw restoreError('Ye AbhiTools Full Backup JSON nahi hai (format: abhitools-backup chahiye).');
    const version = Number(file.version);
    if (!Number.isInteger(version) || version < 1 || version > 8) throw restoreError(`Backup version ${file.version} supported nahi hai.`);
    const data = file.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw restoreError('Backup file me data section nahi mila.');

    // Only tables that are present in the file are staged. A table missing from an old backup is
    // simply absent from the snapshot (app_settings then stays untouched, see the SQL restore function).
    const payload = { format: 'abhitools-snapshot', version: version === 8 ? 8 : 7 };
    const counts = {};
    for (const table of ['borrowers', 'loans', 'emis']) {
        if (!Array.isArray(data[table])) throw restoreError(`Backup adhura hai. ${table} missing hai.`);
    }
    for (const table of version === 8 ? V8_TABLES : RESTORE_TABLES) {
        if (version === 8 && data[table] === undefined) throw restoreError(`Backup adhura hai. ${table} missing hai.`);
        if (data[table] === undefined) continue;
        if (!Array.isArray(data[table])) throw restoreError(`"${table}" list hona chahiye.`);
        for (const row of data[table]) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw restoreError(`"${table}" me galat row mili.`);
        }
        payload[table] = data[table];
        counts[table] = data[table].length;
    }
    if (version < 8 && !(payload.borrowers || []).length) {
        throw restoreError('File me ek bhi borrower nahi hai. Khali file se restore allowed nahi hai kyunki poora data ud jata.');
    }

    const ids = {};
    for (const table of ['borrowers', 'loans', 'emis', 'loan_settlements', 'emi_payments', 'documents', 'collection_followups', 'recycle_bin', 'upi_payment_requests']) {
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

    link('upi_payment_requests', 'borrower_id', 'borrowers', false);
    link('upi_payment_requests', 'loan_id', 'loans', true);
    link('upi_payment_requests', 'emi_id', 'emis', true);
    link('upi_payment_requests', 'payment_id', 'emi_payments', false);
    link('upi_payment_requests', 'settlement_id', 'loan_settlements', false);
    for (const table of ['borrowers', 'loans', 'documents']) link(table, 'recycle_batch_id', 'recycle_bin', false);
    for (const table of ['app_settings', 'upi_payment_config']) {
        const rows = payload[table] || [];
        if (rows.length > 1 || rows.some(row => row.id !== 'primary')) throw restoreError(`Invalid ${table} record.`);
    }
    for (const b of payload.borrowers) if (!String(b.name || '').trim()) throw restoreError('Kisi borrower ka naam khali hai.');
    for (const l of payload.loans || []) if (!String(l.loan_code || '').trim()) throw restoreError('Kisi loan ka loan_code khali hai.');

    return { payload, counts };
}

function submittedFile(body) {
    if (body?.gzip === undefined) return body?.payload;
    if (typeof body.gzip !== 'string' || body.gzip.length > Math.ceil(MAX_GZIP_BYTES / 3) * 4) {
        throw restoreError('Compressed backup size limit se badi hai.');
    }
    try {
        return JSON.parse(gunzipSync(Buffer.from(body.gzip, 'base64'), { maxOutputLength: MAX_JSON_BYTES }).toString('utf8'));
    } catch {
        throw restoreError('Compressed backup invalid hai ya 32 MiB se badi hai.');
    }
}

async function exportFile(res, portable = false) {
    const { data: result } = await supabaseRequest(portable ? 'rpc/abhi_portable_catalog' : 'rpc/abhi_backup_data', 'POST', {});
    const data = portable ? result?.data : result;
    if (!V8_TABLES.every(table => Array.isArray(data?.[table]))) throw new Error('Incomplete backup result');
    const created = new Date().toISOString();
    const file = { format: 'abhitools-backup', version: 8, created_at: created,
        note: 'Business records, UPI and activity history. Files are references only. Server snapshots are separate.',
        data };
    if (portable) {
        file.media = { version: 1, origin: new URL(process.env.SUPABASE_URL).origin, files: result.files };
        file.media.external_links = checkMedia(file, false).external;
        file.note = 'Portable backup. Uploaded media is stored in separate ZIP entries.';
    }
    const json = Buffer.from(JSON.stringify(file));
    const compress = json.length > DIRECT_JSON_BYTES;
    const body = compress && json.length <= MAX_JSON_BYTES ? gzipSync(json) : json;
    if (json.length > MAX_JSON_BYTES || (compress && body.length > MAX_GZIP_BYTES)) {
        return res.status(413).json({ error: 'Backup web download limit se badi hai. Supabase database export use karein.' });
    }
    const stamp = created.replace(/[:.]/g, '-');
    res.setHeader('Content-Type', compress ? 'application/gzip' : 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="AbhiTools_${stamp}.json${compress ? '.gz' : ''}"`);
    return res.status(200).send(body);
}

export default async function handler(req, res) {
    noStore(res);
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (!requireAdmin(req, res)) return;

    const action = String(req.query?.action || '').toLowerCase();

    try {
        if (req.method === 'GET' && action === 'media_worker') return serveTransferWorker(res);
        if (req.method === 'POST' && action === 'media_ticket') return await mediaTicket(req, res);
        if (req.method === 'GET' && action === 'portable_catalog') return await exportFile(res, true);
        if (req.method === 'POST' && action === 'media_check') {
            const files = req.body?.files;
            if (!Array.isArray(files) || files.length > 2000) return res.status(400).json({ error: 'Invalid file list' });
            const { data } = await supabaseRequest('rpc/abhi_media_present', 'POST', { p_files: files });
            return res.status(data === true ? 200 : 409).json(data === true ? { success: true } : { error: 'Backup ke beech uploads badal gaye. Dobara backup lein.' });
        }
        if (action.startsWith('reset_')) return await handleDataReset(action, req, res);
        if (req.method === 'GET' && action === 'export') return await exportFile(res);
        if (req.method === 'POST' && action === 'preview_file') {
            const file = submittedFile(req.body);
            const { counts } = validateBackupFile(file);
            const media = file.media ? checkMedia(file) : null;
            return res.status(200).json({ counts, version: file.version, created_at: file.created_at || null, media });
        }

        if (req.method === 'GET' && action === 'list') {
            const { data } = await supabaseRequest(
                'backup_snapshots?select=id,label,reason,summary,created_at,backup_version:payload->>version&order=created_at.desc&limit=30'
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
            if (req.body?.confirm !== true) return res.status(400).json({ error: 'Restore confirmation required' });
            const file = submittedFile(req.body);
            const { payload, counts } = validateBackupFile(file);
            const args = { p_payload: payload, p_counts: counts, p_label: cleanLabel(req.body?.label, 'Uploaded backup file') };
            if (file.media) {
                checkMedia(file);
                const revisions = req.body?.revisions;
                if (!Array.isArray(revisions) || revisions.length !== file.media.files.length ||
                    revisions.some(r => typeof r !== 'string' || !r || r.length > 200)) {
                    return res.status(400).json({ error: 'Pehle ZIP ki files restore aur verify karein.' });
                }
                args.p_files = file.media.files.map(({ bucket, name }, i) => ({ bucket, name, revision: revisions[i] }));
            }
            const { data } = await supabaseRequest(file.media ? 'rpc/abhi_restore_portable' : 'rpc/abhi_restore_backup_file', 'POST', args);
            return res.status(200).json({ ...data, file_counts: counts });
        }

        res.setHeader('Allow', 'GET, POST');
        return res.status(404).json({ error: 'Backup action not found' });
    } catch (err) {
        if (err?.details?.code === 'PGRST202') {
            return res.status(503).json({ error: 'Supabase migrations apply karein, backup_and_data_reset aur phir portable_media_backup.' });
        }
        return sendServerError(res, 'Backup API Error:', err);
    }
}
