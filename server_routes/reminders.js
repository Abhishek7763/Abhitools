import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const TIME_ZONE = 'Asia/Kolkata';
const VALID_CHANNELS = new Set(['whatsapp', 'call', 'manual']);

function businessDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function dateInZone(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    return d.toISOString().slice(0, 10);
}

function dayDiff(fromIso, toIso) {
    const a = Date.parse(`${fromIso}T00:00:00Z`);
    const b = Date.parse(`${toIso}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.round((b - a) / 86400000);
}

function safeInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
}

function remainingFor(emi) {
    const amount = Math.max(0, safeInt(emi.amount));
    const paid = Math.max(0, Math.min(safeInt(emi.paid_amount), amount));
    return { amount, paid, remaining: Math.max(amount - paid, 0) };
}

function classifyDue(dueDate, today, partial) {
    if (dueDate < today) return { bucket: 'overdue', priority: 'critical', rank: 500 + Math.min(dayDiff(dueDate, today), 365) };
    if (dueDate === today) return { bucket: 'today', priority: 'high', rank: 400 };
    if (dueDate === addDays(today, 1)) return { bucket: 'tomorrow', priority: 'medium', rank: 300 };
    if (dueDate <= addDays(today, 6)) return { bucket: 'next7', priority: partial ? 'medium' : 'normal', rank: partial ? 250 : 200 };
    return null;
}

function buildReminderItem(emi, loan, today, contactedMap) {
    if (!loan || loan.status === 'closed') return null;
    const dueDate = String(emi.due_date || '').slice(0, 10);
    const { amount, paid, remaining } = remainingFor(emi);
    if (!dueDate || !emi.due_year || remaining <= 0) return null;
    const partial = paid > 0 && remaining > 0;
    const state = classifyDue(dueDate, today, partial);
    if (!state) return null;
    const borrower = loan.borrowers || {};
    const contact = String(borrower.whatsapp || borrower.phone || '').trim();
    const contacted = contactedMap.get(emi.id) || null;
    return {
        emi_id: emi.id,
        loan_id: loan.id,
        borrower_id: loan.borrower_id || borrower.id || null,
        borrower_name: borrower.name || 'Unknown',
        phone: borrower.phone || null,
        whatsapp: borrower.whatsapp || borrower.phone || null,
        has_contact: Boolean(contact),
        loan_code: loan.loan_code || 'Loan',
        loan_status: loan.status || 'active',
        installment_number: safeInt(emi.installment_number),
        due_date: dueDate,
        due_year: emi.due_year,
        amount,
        paid_amount: paid,
        remaining,
        partial,
        bucket: state.bucket,
        priority: state.priority,
        priority_rank: state.rank + Math.min(Math.floor(remaining / 100), 99),
        days_from_due: dayDiff(dueDate, today),
        contacted_today: Boolean(contacted),
        contacted_at: contacted?.created_at || null,
        contacted_channel: contacted?.channel || null
    };
}

function summaryFrom(items, yearNotSetCount, yearNotSetAmount) {
    const summary = {
        actionableCount: items.length,
        actionableAmount: 0,
        overdueCount: 0, overdueAmount: 0,
        todayCount: 0, todayAmount: 0,
        tomorrowCount: 0, tomorrowAmount: 0,
        next7Count: 0, next7Amount: 0,
        partialCount: 0, partialAmount: 0,
        contactedToday: 0, uncontactedToday: 0,
        missingContactCount: 0,
        yearNotSetCount,
        yearNotSetAmount
    };
    for (const item of items) {
        summary.actionableAmount += item.remaining;
        const countKey = `${item.bucket}Count`;
        const amountKey = `${item.bucket}Amount`;
        if (item.bucket !== 'next7' && countKey in summary) summary[countKey] += 1;
        if (item.bucket !== 'next7' && amountKey in summary) summary[amountKey] += item.remaining;
        if (item.bucket !== 'overdue') {
            summary.next7Count += 1;
            summary.next7Amount += item.remaining;
        }
        if (item.partial) {
            summary.partialCount += 1;
            summary.partialAmount += item.remaining;
        }
        if (item.contacted_today) summary.contactedToday += 1;
        else summary.uncontactedToday += 1;
        if (!item.has_contact) summary.missingContactCount += 1;
    }
    return summary;
}

async function loadContactedToday(today) {
    const logsRes = await supabaseRequest('activity_log?action=eq.CONTACT_REMINDER&select=id,record_id,description,created_at&order=created_at.desc&limit=2000');
    const map = new Map();
    for (const row of logsRes.data || []) {
        if (!row.record_id || dateInZone(row.created_at) !== today || map.has(row.record_id)) continue;
        const match = String(row.description || '').match(/via\s+(whatsapp|call|manual)/i);
        map.set(row.record_id, {
            created_at: row.created_at,
            channel: match?.[1]?.toLowerCase() || 'manual'
        });
    }
    return map;
}

async function getReminders(req, res) {
    await supabaseRequest('rpc/abhi_refresh_due_statuses', 'POST', {});
    const today = businessDate();
    const [loansRes, emisRes, contactedMap] = await Promise.all([
        supabaseRequest('loans?deleted_at=is.null&select=id,borrower_id,loan_code,status,borrowers(id,name,phone,whatsapp)'),
        supabaseRequest('emis?select=id,loan_id,installment_number,due_date,due_day,due_month,due_year,amount,status,paid_amount'),
        loadContactedToday(today)
    ]);

    const loans = loansRes.data || [];
    const emis = emisRes.data || [];
    const loanById = new Map(loans.map(x => [x.id, x]));
    const items = [];
    let yearNotSetCount = 0;
    let yearNotSetAmount = 0;

    for (const emi of emis) {
        const loan = loanById.get(emi.loan_id);
        if (!loan || loan.status === 'closed') continue;
        const { remaining } = remainingFor(emi);
        if (remaining <= 0) continue;
        if (!emi.due_year || !emi.due_date) {
            yearNotSetCount += 1;
            yearNotSetAmount += remaining;
            continue;
        }
        const item = buildReminderItem(emi, loan, today, contactedMap);
        if (item) items.push(item);
    }

    items.sort((a, b) => b.priority_rank - a.priority_rank || a.due_date.localeCompare(b.due_date) || a.borrower_name.localeCompare(b.borrower_name));

    return res.status(200).json({
        businessDate: today,
        timezone: TIME_ZONE,
        generatedAt: new Date().toISOString(),
        summary: summaryFrom(items, yearNotSetCount, yearNotSetAmount),
        items
    });
}

async function markContacted(req, res) {
    const action = String(req.body?.action || '').toLowerCase();
    const emiId = String(req.body?.emi_id || '').trim();
    const channel = String(req.body?.channel || 'manual').toLowerCase();
    if (action !== 'contacted') return res.status(400).json({ error: 'Unsupported reminder action' });
    if (!emiId) return res.status(400).json({ error: 'emi_id is required' });
    if (!VALID_CHANNELS.has(channel)) return res.status(400).json({ error: 'Invalid contact channel' });

    const emiRes = await supabaseRequest(`emis?id=eq.${encodeURIComponent(emiId)}&select=id,loan_id,installment_number,due_date,due_year,amount,paid_amount&limit=1`);
    const emi = emiRes.data?.[0];
    if (!emi) return res.status(404).json({ error: 'EMI not found' });
    const loanRes = await supabaseRequest(`loans?id=eq.${encodeURIComponent(emi.loan_id)}&deleted_at=is.null&select=id,borrower_id,loan_code,status,borrowers(id,name,phone,whatsapp)&limit=1`);
    const loan = loanRes.data?.[0];
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.status === 'closed') return res.status(409).json({ error: 'Closed loan reminder cannot be contacted' });
    const { remaining } = remainingFor(emi);
    if (remaining <= 0) return res.status(409).json({ error: 'EMI already settled' });

    const borrower = loan.borrowers || {};
    const description = `Reminder contacted via ${channel}: ${borrower.name || 'Unknown'} • ${loan.loan_code || 'Loan'} • EMI #${safeInt(emi.installment_number)} • remaining ₹${remaining}`;
    const logRes = await supabaseRequest('activity_log', 'POST', {
        action: 'CONTACT_REMINDER',
        table_name: 'emis',
        record_id: emi.id,
        description
    });

    return res.status(200).json({
        success: true,
        businessDate: businessDate(),
        contacted: {
            emi_id: emi.id,
            channel,
            activity_id: logRes.data?.[0]?.id || null,
            created_at: logRes.data?.[0]?.created_at || new Date().toISOString()
        }
    });
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    try {
        if (req.method === 'GET') return await getReminders(req, res);
        if (req.method === 'POST') return await markContacted(req, res);
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return sendServerError(res, 'Reminder API Error:', err);
    }
}
