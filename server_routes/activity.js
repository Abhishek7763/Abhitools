import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const TIME_ZONE = 'Asia/Kolkata';
const VALID_PERIODS = new Set(['all', 'today', '7d', '30d', '90d']);
const VALID_CATEGORIES = new Set(['all', 'payment', 'borrower', 'loan', 'document', 'recycle', 'safety', 'reminder', 'system']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function businessDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function isoDate(value) {
    const v = String(value || '').slice(0, 10);
    return DATE_RE.test(v) ? v : null;
}

function subtractDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

function categoryFor(action = '', table = '') {
    const a = String(action).toUpperCase();
    const t = String(table).toLowerCase();
    if (a.includes('REMINDER')) return 'reminder';
    if (a.includes('PAYMENT') || t === 'emi_payments') return 'payment';
    if (a.includes('RECYCLE') || a.includes('PURGE') || t === 'recycle_bin') return 'recycle';
    if (a.includes('BACKUP') || a.includes('IMPORT') || a === 'RESTORE_BACKUP' || t === 'backup_snapshots') return 'safety';
    if (a.includes('DOCUMENT') || a.includes('PHOTO') || t === 'documents') return 'document';
    if (a.includes('BORROWER') || t === 'borrowers') return 'borrower';
    if (a.includes('LOAN') || a.includes('SETTLE') || t === 'loans' || t === 'loan_settlements') return 'loan';
    return 'system';
}

function iconFor(category) {
    return ({ payment:'💰', borrower:'👤', loan:'💳', document:'📎', recycle:'♻️', safety:'🛡️', reminder:'🔔', system:'⚙️' })[category] || '🕘';
}

function labelFor(action = '') {
    const labels = {
        ADD_BORROWER:'Borrower Added', UPDATE_BORROWER:'Borrower Updated', UPDATE_BORROWER_PHOTO:'Borrower Photo Updated',
        ADD_LOAN:'Loan Added', UPDATE_LOAN:'Loan Updated', SETTLE_LOAN:'Loan Settled / Closed', REOPEN_LOAN:'Loan Settlement Reopened',
        ADD_EMI_PAYMENT:'EMI Payment Added', UPDATE_EMI_PAYMENT:'EMI Payment Corrected', REVERSE_EMI_PAYMENT:'EMI Payment Reversed',
        UPLOAD_DOCUMENT:'Document Uploaded', RECYCLE_BORROWER:'Borrower Recycled', RECYCLE_LOAN:'Loan Recycled', RECYCLE_DOCUMENT:'Document Recycled',
        RESTORE_RECYCLE_ITEM:'Recycle Item Restored', PURGE_RECYCLE_ITEM:'Recycle Item Permanently Deleted',
        CREATE_BACKUP:'Backup Created', RESTORE_BACKUP:'Backup Restored', SMART_IMPORT:'Smart Import', LEGACY_IMPORT:'Legacy Import',
        CONTACT_REMINDER:'Reminder Contacted'
    };
    const key = String(action || '').toUpperCase();
    return labels[key] || key.split('_').filter(Boolean).map(w => w[0] + w.slice(1).toLowerCase()).join(' ') || 'Activity';
}

function safeText(value) { return String(value ?? '').trim(); }
function safeInt(value) { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? n : 0; }

function csvCell(value) {
    const s = String(value ?? '');
    return `"${s.replace(/"/g, '""')}"`;
}

async function loadContext() {
    const [borrowersRes, loansRes, emisRes, paymentsRes, settlementsRes, documentsRes, recycleRes] = await Promise.all([
        supabaseRequest('borrowers?select=id,name,phone,deleted_at&limit=5000'),
        supabaseRequest('loans?select=id,loan_code,borrower_id,status,deleted_at&limit=5000'),
        supabaseRequest('emis?select=id,loan_id,installment_number&limit=10000'),
        supabaseRequest('emi_payments?select=id,emi_id,amount,payment_date,source,reversed_at&limit=10000'),
        supabaseRequest('loan_settlements?select=id,loan_id,settlement_date,reopened_at&limit=5000'),
        supabaseRequest('documents?select=id,borrower_id,loan_id,file_name,doc_type,deleted_at&limit=5000'),
        supabaseRequest('recycle_bin?select=id,entity_type,record_id,label,deleted_at,restored_at,purged_at&limit=5000')
    ]);
    const borrowers = borrowersRes.data || [];
    const loans = loansRes.data || [];
    const emis = emisRes.data || [];
    const payments = paymentsRes.data || [];
    const settlements = settlementsRes.data || [];
    const documents = documentsRes.data || [];
    const recycle = recycleRes.data || [];
    return {
        borrowerById: new Map(borrowers.map(x => [x.id, x])),
        loanById: new Map(loans.map(x => [x.id, x])),
        emiById: new Map(emis.map(x => [x.id, x])),
        paymentById: new Map(payments.map(x => [x.id, x])),
        settlementById: new Map(settlements.map(x => [x.id, x])),
        documentById: new Map(documents.map(x => [x.id, x])),
        recycleById: new Map(recycle.map(x => [x.id, x]))
    };
}

function contextFor(log, maps) {
    const recordId = safeText(log.record_id);
    const table = safeText(log.table_name).toLowerCase();
    let borrower = null;
    let loan = null;
    let emi = null;
    let payment = null;
    let settlement = null;
    let document = null;
    let recycle = null;

    if (table === 'borrowers') borrower = maps.borrowerById.get(recordId) || null;
    if (table === 'loans') loan = maps.loanById.get(recordId) || null;
    if (table === 'emis') emi = maps.emiById.get(recordId) || null;
    if (table === 'emi_payments') payment = maps.paymentById.get(recordId) || null;
    if (table === 'loan_settlements') settlement = maps.settlementById.get(recordId) || null;
    if (table === 'documents') document = maps.documentById.get(recordId) || null;
    if (table === 'recycle_bin') recycle = maps.recycleById.get(recordId) || null;

    if (payment) emi = maps.emiById.get(payment.emi_id) || null;
    if (emi) loan = maps.loanById.get(emi.loan_id) || null;
    if (settlement) loan = maps.loanById.get(settlement.loan_id) || null;
    if (document) {
        if (document.loan_id) loan = maps.loanById.get(document.loan_id) || null;
        if (document.borrower_id) borrower = maps.borrowerById.get(document.borrower_id) || null;
    }
    if (recycle) {
        if (recycle.entity_type === 'borrower') borrower = maps.borrowerById.get(recycle.record_id) || null;
        if (recycle.entity_type === 'loan') loan = maps.loanById.get(recycle.record_id) || null;
        if (recycle.entity_type === 'document') {
            document = maps.documentById.get(recycle.record_id) || null;
            if (document?.loan_id) loan = maps.loanById.get(document.loan_id) || null;
            if (document?.borrower_id) borrower = maps.borrowerById.get(document.borrower_id) || null;
        }
    }
    if (loan && !borrower) borrower = maps.borrowerById.get(loan.borrower_id) || null;

    return {
        borrower_id: borrower?.id || null,
        borrower_name: borrower?.name || null,
        borrower_phone: borrower?.phone || null,
        loan_id: loan?.id || null,
        loan_code: loan?.loan_code || null,
        loan_status: loan?.status || null,
        emi_id: emi?.id || null,
        installment_number: emi?.installment_number ?? null,
        payment_id: payment?.id || null,
        payment_amount: payment ? safeInt(payment.amount) : null,
        payment_date: payment?.payment_date || null,
        settlement_id: settlement?.id || null,
        document_id: document?.id || null,
        document_name: document?.file_name || null,
        recycle_id: recycle?.id || null,
        recycle_label: recycle?.label || null,
        recycle_entity_type: recycle?.entity_type || null
    };
}

function eventSearchText(event) {
    const c = event.context || {};
    return [event.action,event.label,event.table_name,event.record_id,event.description,c.borrower_name,c.borrower_phone,c.loan_code,c.document_name,c.recycle_label]
        .map(v => String(v ?? '').toLowerCase()).join(' ');
}

function filterEvents(events, opts) {
    return events.filter(event => {
        const date = String(event.created_at || '').slice(0, 10);
        if (opts.category !== 'all' && event.category !== opts.category) return false;
        if (opts.action !== 'all' && event.action !== opts.action) return false;
        if (opts.entity !== 'all' && String(event.table_name || '').toLowerCase() !== opts.entity) return false;
        if (opts.from && date < opts.from) return false;
        if (opts.to && date > opts.to) return false;
        if (opts.q) {
            const terms = opts.q.split(/\s+/).filter(Boolean);
            const haystack = eventSearchText(event);
            if (!terms.every(term => haystack.includes(term))) return false;
        }
        return true;
    });
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const q = safeText(req.query?.q).slice(0, 120).toLowerCase();
        const category = VALID_CATEGORIES.has(safeText(req.query?.category)) ? safeText(req.query?.category) : 'all';
        const period = VALID_PERIODS.has(safeText(req.query?.period)) ? safeText(req.query?.period) : '30d';
        const action = safeText(req.query?.action) || 'all';
        const entity = safeText(req.query?.entity).toLowerCase() || 'all';
        let from = isoDate(req.query?.from);
        const to = isoDate(req.query?.to);
        const today = businessDate();
        if (!from && period === 'today') from = today;
        if (!from && period === '7d') from = subtractDays(today, 6);
        if (!from && period === '30d') from = subtractDays(today, 29);
        if (!from && period === '90d') from = subtractDays(today, 89);
        if (from && to && from > to) return res.status(400).json({ error: 'From date cannot be after To date' });

        const pageRaw = Number.parseInt(req.query?.page, 10);
        const limitRaw = Number.parseInt(req.query?.limit, 10);
        const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
        const limit = Number.isFinite(limitRaw) ? Math.max(10, Math.min(limitRaw, 100)) : 30;

        const [logsRes, maps] = await Promise.all([
            supabaseRequest('activity_log?select=id,action,table_name,record_id,description,created_at&order=created_at.desc&limit=5000'),
            loadContext()
        ]);
        const rawLogs = logsRes.data || [];
        const events = rawLogs.map(log => {
            const categoryName = categoryFor(log.action, log.table_name);
            return {
                ...log,
                action: String(log.action || '').toUpperCase(),
                category: categoryName,
                icon: iconFor(categoryName),
                label: labelFor(log.action),
                context: contextFor(log, maps)
            };
        });

        const opts = { q, category, action: action === 'all' ? 'all' : action.toUpperCase(), entity, from, to };
        const filtered = filterEvents(events, opts);
        const start = (page - 1) * limit;
        const items = filtered.slice(start, start + limit);
        const last24Cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const last7Date = subtractDays(today, 6);
        const last30Date = subtractDays(today, 29);
        const summary = {
            total: filtered.length,
            last24h: events.filter(e => new Date(e.created_at).getTime() >= last24Cutoff).length,
            last7d: events.filter(e => String(e.created_at || '').slice(0,10) >= last7Date).length,
            last30d: events.filter(e => String(e.created_at || '').slice(0,10) >= last30Date).length,
            payments: filtered.filter(e => e.category === 'payment').length,
            safety: filtered.filter(e => e.category === 'safety' || e.category === 'recycle').length
        };
        const actions = [...new Set(events.map(e => e.action).filter(Boolean))].sort();
        const entities = [...new Set(events.map(e => String(e.table_name || '').toLowerCase()).filter(Boolean))].sort();

        if (safeText(req.query?.format).toLowerCase() === 'csv') {
            const header = ['Time','Action','Category','Entity','Record ID','Borrower','Loan','Description'];
            const rows = filtered.map(e => [e.created_at,e.action,e.category,e.table_name,e.record_id,e.context?.borrower_name || '',e.context?.loan_code || '',e.description || '']);
            const csv = '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="AbhiTools_Audit_History_${today}.csv"`);
            return res.status(200).send(csv);
        }

        return res.status(200).json({
            timezone: TIME_ZONE,
            businessDate: today,
            filters: { q, category, period, action: opts.action, entity, from, to, actions, entities },
            summary,
            pagination: { page, limit, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / limit)), has_more: start + limit < filtered.length },
            items
        });
    } catch (err) {
        return sendServerError(res, 'Activity API Error:', err);
    }
}
