import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';
import { loadAppSettings } from './settings_config.js';

const TIME_ZONE = 'Asia/Kolkata';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CHANNELS = new Set(['whatsapp','call','manual','visit','other']);
const OUTCOMES = new Set(['contacted','no_answer','callback','promised_to_pay','payment_received','dispute','wrong_number','other']);
const PROMISE_STATUSES = new Set(['kept','broken','cancelled']);

function businessDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    return d.toISOString().slice(0, 10);
}

function validDate(value) {
    const v = String(value || '').slice(0, 10);
    if (!DATE_RE.test(v)) return null;
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

function safeText(value, max = 3000) {
    const v = String(value ?? '').trim();
    return v ? v.slice(0, max) : null;
}

function safeInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
}

function remainingFor(emi) {
    const amount = Math.max(0, safeInt(emi?.amount));
    const paid = Math.max(0, Math.min(safeInt(emi?.paid_amount), amount));
    return Math.max(amount - paid, 0);
}

function actionState(row, today) {
    const pendingPromise = row.promise_status === 'pending' && row.promise_date;
    if (row.promise_status === 'broken' && row.status !== 'cancelled') return { key:'promise_broken', rank:575, label:'🔴 Promise broken' };
    if (pendingPromise && row.promise_date < today) return { key:'promise_overdue', rank:600, label:'🔴 Promise overdue' };
    if (pendingPromise && row.promise_date === today) return { key:'promise_today', rank:550, label:'🟠 Promise due today' };
    if (row.status === 'open' && row.next_followup_date && row.next_followup_date < today) return { key:'followup_overdue', rank:500, label:'🔴 Follow-up overdue' };
    if (row.status === 'open' && row.next_followup_date === today) return { key:'followup_today', rank:450, label:'🟠 Follow-up today' };
    if (row.status === 'open' && row.next_followup_date && row.next_followup_date <= addDays(today, 7)) return { key:'upcoming', rank:300, label:'🟡 Upcoming' };
    if (row.promise_status === 'pending') return { key:'promise_pending', rank:250, label:'📝 Promise pending' };
    if (row.status === 'open') return { key:'open', rank:200, label:'📌 Open' };
    return { key:'history', rank:0, label: row.status === 'cancelled' ? '⚪ Cancelled' : '✅ Done' };
}

function enrichFollowup(row, maps, today) {
    const borrower = maps.borrowerById.get(row.borrower_id) || null;
    const loan = row.loan_id ? maps.loanById.get(row.loan_id) || null : null;
    const emi = row.emi_id ? maps.emiById.get(row.emi_id) || null : null;
    const state = actionState(row, today);
    return {
        ...row,
        borrower_name: borrower?.name || 'Unknown',
        borrower_phone: borrower?.phone || null,
        borrower_whatsapp: borrower?.whatsapp || borrower?.phone || null,
        loan_code: loan?.loan_code || null,
        loan_status: loan?.status || null,
        installment_number: emi?.installment_number || null,
        emi_due_date: emi?.due_date || null,
        emi_amount: emi?.amount || null,
        emi_remaining: emi ? remainingFor(emi) : null,
        action_state: state.key,
        action_rank: state.rank,
        action_label: state.label
    };
}

async function loadContext() {
    const [borrowersRes, loansRes, emisRes] = await Promise.all([
        supabaseRequest('borrowers?deleted_at=is.null&select=id,name,phone,whatsapp&order=name.asc&limit=5000'),
        supabaseRequest('loans?deleted_at=is.null&select=id,borrower_id,loan_code,status&order=created_at.desc&limit=5000'),
        supabaseRequest('emis?select=id,loan_id,installment_number,due_date,due_year,amount,paid_amount,status&order=loan_id.asc,installment_number.asc&limit=10000')
    ]);
    const borrowers = borrowersRes.data || [];
    const loans = loansRes.data || [];
    const loanById = new Map(loans.map(x => [x.id, x]));
    const emis = (emisRes.data || []).filter(e => loanById.has(e.loan_id));
    return {
        borrowers,
        loans,
        emis,
        borrowerById: new Map(borrowers.map(x => [x.id, x])),
        loanById,
        emiById: new Map(emis.map(x => [x.id, x]))
    };
}

function buildSummary(items, today) {
    const summary = {
        total: items.length,
        open: 0,
        actionNow: 0,
        followupToday: 0,
        followupOverdue: 0,
        pendingPromises: 0,
        promiseToday: 0,
        promiseOverdue: 0,
        promiseBroken: 0,
        upcoming7: 0,
        promiseAmountPending: 0
    };
    for (const item of items) {
        if (item.status === 'open') summary.open += 1;
        if (['followup_today','followup_overdue','promise_today','promise_overdue','promise_broken'].includes(item.action_state)) summary.actionNow += 1;
        if (item.action_state === 'promise_broken') summary.promiseBroken += 1;
        if (item.action_state === 'followup_today') summary.followupToday += 1;
        if (item.action_state === 'followup_overdue') summary.followupOverdue += 1;
        if (item.promise_status === 'pending') {
            summary.pendingPromises += 1;
            summary.promiseAmountPending += Math.max(0, safeInt(item.promise_amount));
            if (item.promise_date === today) summary.promiseToday += 1;
            if (item.promise_date && item.promise_date < today) summary.promiseOverdue += 1;
        }
        if (item.status === 'open' && item.next_followup_date && item.next_followup_date > today && item.next_followup_date <= addDays(today, 7)) summary.upcoming7 += 1;
    }
    return summary;
}

async function getFollowups(req, res) {
    const today = businessDate();
    const context = await loadContext();
    const followRes = await supabaseRequest('collection_followups?select=*&order=created_at.desc&limit=5000');
    let items = (followRes.data || [])
        .filter(row => context.borrowerById.has(row.borrower_id))
        .filter(row => !row.loan_id || context.loanById.has(row.loan_id))
        .filter(row => !row.emi_id || context.emiById.has(row.emi_id))
        .map(row => enrichFollowup(row, context, today));

    const borrowerId = String(req.query?.borrower_id || '').trim();
    const loanId = String(req.query?.loan_id || '').trim();
    const q = String(req.query?.q || '').trim().toLowerCase();
    if (UUID_RE.test(borrowerId)) items = items.filter(x => x.borrower_id === borrowerId);
    if (UUID_RE.test(loanId)) items = items.filter(x => x.loan_id === loanId);
    if (q) {
        items = items.filter(x => [x.borrower_name,x.loan_code,x.notes,x.outcome,x.channel,x.promise_status]
            .map(v => String(v ?? '').toLowerCase()).join(' ').includes(q));
    }
    items.sort((a,b) => b.action_rank - a.action_rank || String(a.next_followup_date || a.promise_date || '9999').localeCompare(String(b.next_followup_date || b.promise_date || '9999')) || String(b.created_at).localeCompare(String(a.created_at)));

    const settingsState = await loadAppSettings(supabaseRequest);
    return res.status(200).json({
        businessDate: today,
        timezone: TIME_ZONE,
        generatedAt: new Date().toISOString(),
        defaults: { contact_channel: settingsState.settings.default_contact_channel || 'whatsapp' },
        summary: buildSummary(items, today),
        items,
        options: {
            borrowers: context.borrowers,
            loans: context.loans,
            emis: context.emis.map(e => ({ ...e, remaining: remainingFor(e) }))
        }
    });
}

async function validateTargets(body) {
    const borrowerId = String(body?.borrower_id || '').trim();
    const loanId = String(body?.loan_id || '').trim();
    const emiId = String(body?.emi_id || '').trim();
    if (!UUID_RE.test(borrowerId)) throw Object.assign(new Error('Valid borrower_id required'), { status:400 });

    const borrowerRes = await supabaseRequest(`borrowers?id=eq.${encodeURIComponent(borrowerId)}&deleted_at=is.null&select=id,name,phone,whatsapp&limit=1`);
    const borrower = borrowerRes.data?.[0];
    if (!borrower) throw Object.assign(new Error('Borrower not found'), { status:404 });

    let loan = null;
    if (loanId) {
        if (!UUID_RE.test(loanId)) throw Object.assign(new Error('Invalid loan_id'), { status:400 });
        const loanRes = await supabaseRequest(`loans?id=eq.${encodeURIComponent(loanId)}&borrower_id=eq.${encodeURIComponent(borrowerId)}&deleted_at=is.null&select=id,borrower_id,loan_code,status&limit=1`);
        loan = loanRes.data?.[0];
        if (!loan) throw Object.assign(new Error('Loan not found for borrower'), { status:404 });
    }

    let emi = null;
    if (emiId) {
        if (!loan) throw Object.assign(new Error('loan_id required when emi_id is supplied'), { status:400 });
        if (!UUID_RE.test(emiId)) throw Object.assign(new Error('Invalid emi_id'), { status:400 });
        const emiRes = await supabaseRequest(`emis?id=eq.${encodeURIComponent(emiId)}&loan_id=eq.${encodeURIComponent(loan.id)}&select=id,loan_id,installment_number,amount,paid_amount,due_date&limit=1`);
        emi = emiRes.data?.[0];
        if (!emi) throw Object.assign(new Error('EMI not found for loan'), { status:404 });
    }
    return { borrower, loan, emi };
}

async function createFollowup(req, res) {
    const today = businessDate();
    const body = req.body || {};
    const { borrower, loan, emi } = await validateTargets(body);
    if (loan?.status === 'closed' && String(body.outcome || '') === 'promised_to_pay') {
        return res.status(409).json({ error: 'Closed loan par new promise-to-pay create nahi ho sakta' });
    }

    const settingsState = await loadAppSettings(supabaseRequest);
    const channelRaw = String(body.channel || settingsState.settings.default_contact_channel || 'manual').toLowerCase();
    const channel = CHANNELS.has(channelRaw) ? channelRaw : 'manual';
    const outcome = String(body.outcome || 'contacted').toLowerCase();
    if (!OUTCOMES.has(outcome)) return res.status(400).json({ error: 'Invalid follow-up outcome' });

    const followupDate = validDate(body.followup_date) || today;
    if (followupDate > today) return res.status(400).json({ error: 'Follow-up date future me nahi ho sakti; future action ke liye Next Follow-up use karein' });
    const nextFollowupDate = body.next_followup_date ? validDate(body.next_followup_date) : null;
    if (body.next_followup_date && !nextFollowupDate) return res.status(400).json({ error: 'Invalid next follow-up date' });
    if (nextFollowupDate && nextFollowupDate < followupDate) return res.status(400).json({ error: 'Next follow-up date follow-up date se pehle nahi ho sakti' });
    if (['no_answer','callback'].includes(outcome) && !nextFollowupDate) return res.status(400).json({ error: 'No Answer / Callback ke liye Next Follow-up date required hai' });

    let promiseDate = null;
    let promiseAmount = null;
    let promiseStatus = 'none';
    if (outcome === 'promised_to_pay') {
        promiseDate = validDate(body.promise_date);
        promiseAmount = safeInt(body.promise_amount);
        if (!promiseDate) return res.status(400).json({ error: 'Promise date required hai' });
        if (promiseDate < followupDate) return res.status(400).json({ error: 'Promise date follow-up date se pehle nahi ho sakti' });
        if (promiseAmount <= 0 || promiseAmount > 1000000000) return res.status(400).json({ error: 'Valid promise amount required hai' });
        promiseStatus = 'pending';
    }

    const status = nextFollowupDate || promiseStatus === 'pending' ? 'open' : 'done';
    const now = new Date().toISOString();
    const insertRes = await supabaseRequest('collection_followups', 'POST', {
        borrower_id: borrower.id,
        loan_id: loan?.id || null,
        emi_id: emi?.id || null,
        followup_date: followupDate,
        channel,
        outcome,
        notes: safeText(body.notes),
        next_followup_date: nextFollowupDate,
        promise_date: promiseDate,
        promise_amount: promiseAmount,
        promise_status: promiseStatus,
        status,
        updated_at: now
    });
    const row = insertRes.data?.[0];
    const detail = [
        borrower.name,
        loan?.loan_code,
        emi ? `EMI #${safeInt(emi.installment_number)}` : null,
        outcome.replaceAll('_',' '),
        nextFollowupDate ? `next ${nextFollowupDate}` : null,
        promiseStatus === 'pending' ? `PTP ₹${promiseAmount} on ${promiseDate}` : null
    ].filter(Boolean).join(' • ');
    await supabaseRequest('activity_log', 'POST', {
        action: 'ADD_FOLLOWUP',
        table_name: 'collection_followups',
        record_id: row?.id || null,
        description: `Follow-up logged: ${detail}`
    });
    return res.status(201).json({ success:true, item:row });
}

async function changePromiseStatus(req, res) {
    const id = String(req.body?.id || '').trim();
    const status = String(req.body?.promise_status || '').toLowerCase();
    if (!UUID_RE.test(id)) return res.status(400).json({ error:'Valid follow-up id required' });
    if (!PROMISE_STATUSES.has(status)) return res.status(400).json({ error:'Invalid promise status' });
    const rowRes = await supabaseRequest(`collection_followups?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    const row = rowRes.data?.[0];
    if (!row) return res.status(404).json({ error:'Follow-up not found' });
    if (row.promise_status !== 'pending') return res.status(409).json({ error:'Only pending promise can be updated' });
    const nextStatus = status === 'broken' ? 'open' : 'done';
    const updateRes = await supabaseRequest(`collection_followups?id=eq.${encodeURIComponent(id)}`, 'PATCH', {
        promise_status: status,
        status: nextStatus,
        updated_at: new Date().toISOString()
    });
    await supabaseRequest('activity_log', 'POST', {
        action: 'UPDATE_PTP_STATUS',
        table_name: 'collection_followups',
        record_id: id,
        description: `Promise-to-pay marked ${status}: ₹${safeInt(row.promise_amount)} • promise date ${row.promise_date || '-'}`
    });
    return res.status(200).json({ success:true, item:updateRes.data?.[0] || null, payment_recorded:false });
}

async function changeFollowupState(req, res, nextState) {
    const id = String(req.body?.id || '').trim();
    if (!UUID_RE.test(id)) return res.status(400).json({ error:'Valid follow-up id required' });
    const rowRes = await supabaseRequest(`collection_followups?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    const row = rowRes.data?.[0];
    if (!row) return res.status(404).json({ error:'Follow-up not found' });
    if (row.status !== 'open') return res.status(409).json({ error:'Only open follow-up can be changed' });
    const patch = { status: nextState, updated_at: new Date().toISOString() };
    if (nextState === 'cancelled' && row.promise_status === 'pending') patch.promise_status = 'cancelled';
    const updateRes = await supabaseRequest(`collection_followups?id=eq.${encodeURIComponent(id)}`, 'PATCH', patch);
    await supabaseRequest('activity_log', 'POST', {
        action: nextState === 'done' ? 'COMPLETE_FOLLOWUP' : 'CANCEL_FOLLOWUP',
        table_name: 'collection_followups',
        record_id: id,
        description: `Follow-up marked ${nextState}`
    });
    return res.status(200).json({ success:true, item:updateRes.data?.[0] || null });
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    try {
        if (req.method === 'GET') return await getFollowups(req, res);
        if (req.method === 'POST') {
            const action = String(req.body?.action || 'create').toLowerCase();
            if (action === 'create') return await createFollowup(req, res);
            if (action === 'promise-status') return await changePromiseStatus(req, res);
            if (action === 'complete') return await changeFollowupState(req, res, 'done');
            if (action === 'cancel') return await changeFollowupState(req, res, 'cancelled');
            return res.status(400).json({ error:'Unsupported follow-up action' });
        }
        res.setHeader('Allow','GET, POST');
        return res.status(405).json({ error:'Method not allowed' });
    } catch (err) {
        return sendServerError(res, 'Follow-up API Error:', err);
    }
}
