import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function uuid(value) {
    const v = String(value || '').trim();
    return UUID_RE.test(v) ? v : null;
}
function date(value) {
    const v = String(value || '').slice(0, 10);
    if (!DATE_RE.test(v)) return null;
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}
function money(value) {
    if (value === '' || value === null || value === undefined) return 0;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : null;
}
function text(value, max = 1000) {
    const v = String(value ?? '').trim().slice(0, max);
    return v || null;
}
function safeInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
}
function settlementSummary(loan, activeSettlement) {
    let scheduled = 0;
    let paid = 0;
    for (const emi of (loan?.emis || [])) {
        const amount = Math.max(0, safeInt(emi.amount));
        const collected = Math.max(0, Math.min(safeInt(emi.paid_amount), amount));
        scheduled += amount;
        paid += collected;
    }
    const rawRemaining = Math.max(scheduled - paid, 0);
    const waived = activeSettlement ? Math.max(0, safeInt(activeSettlement.waived_amount)) : 0;
    return {
        scheduled,
        paid,
        raw_remaining: rawRemaining,
        waived,
        account_remaining: activeSettlement ? Math.max(rawRemaining - waived, 0) : rawRemaining
    };
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    const action = String(req.query?.action || '').toLowerCase();

    try {
        if (req.method === 'GET') {
            const loanId = uuid(req.query?.loan_id);
            if (!loanId) return res.status(400).json({ error: 'Valid loan_id required' });
            const [loanRes, settlementRes] = await Promise.all([
                supabaseRequest(`loans?id=eq.${encodeURIComponent(loanId)}&deleted_at=is.null&select=*,borrowers(id,name,phone,whatsapp),emis(*)&limit=1`),
                supabaseRequest(`loan_settlements?loan_id=eq.${encodeURIComponent(loanId)}&select=*&order=created_at.desc`)
            ]);
            const loan = loanRes.data?.[0];
            if (!loan) return res.status(404).json({ error: 'Loan not found' });
            const history = settlementRes.data || [];
            const active = history.find(s => !s.reopened_at) || null;
            return res.status(200).json({ loan, active_settlement: active, history, summary: settlementSummary(loan, active) });
        }

        if (req.method === 'POST' && action === 'settle') {
            const loanId = uuid(req.body?.loan_id);
            const finalAmount = money(req.body?.final_payment_amount);
            const settlementDate = date(req.body?.settlement_date);
            if (!loanId || finalAmount === null || !settlementDate) return res.status(400).json({ error: 'Valid loan, settlement date and final payment required' });
            if (String(req.body?.confirm || '').trim().toUpperCase() !== 'SETTLE') return res.status(400).json({ error: 'Type SETTLE to confirm closing' });
            const { data } = await supabaseRequest('rpc/abhi_settle_loan', 'POST', {
                p_loan_id: loanId,
                p_final_payment_amount: finalAmount,
                p_settlement_date: settlementDate,
                p_method: text(req.body?.method, 60),
                p_notes: text(req.body?.notes, 1000)
            });
            return res.status(201).json(Array.isArray(data) ? (data[0] || { success: true }) : (data || { success: true }));
        }

        if (req.method === 'POST' && action === 'reopen') {
            const settlementId = uuid(req.body?.settlement_id);
            const note = text(req.body?.reopen_note, 1000);
            if (!settlementId) return res.status(400).json({ error: 'Valid settlement_id required' });
            if (!note || note.length < 3) return res.status(400).json({ error: 'Reopen reason required' });
            if (String(req.body?.confirm || '').trim().toUpperCase() !== 'REOPEN') return res.status(400).json({ error: 'Type REOPEN to confirm' });
            const { data } = await supabaseRequest('rpc/abhi_reopen_loan_settlement', 'POST', {
                p_settlement_id: settlementId,
                p_reopen_note: note
            });
            return res.status(200).json(Array.isArray(data) ? (data[0] || { success: true }) : (data || { success: true }));
        }

        res.setHeader('Allow', 'GET, POST');
        return res.status(404).json({ error: 'Settlement action not found' });
    } catch (err) {
        const message = String(err?.details?.message || err?.details?.hint || err?.message || '');
        if (/already|exceeds|not found|allocate/i.test(message)) return res.status(409).json({ error: message.replace(/^.*?:\s*/, '') || 'Settlement conflict' });
        return sendServerError(res, 'Settlements API Error:', err);
    }
}
