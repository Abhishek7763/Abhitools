import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validUuid(value) {
    const text = String(value || '').trim();
    return UUID_RE.test(text) ? text : null;
}

function positiveInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanText(value, max = 500) {
    const text = String(value ?? '').trim().slice(0, max);
    return text || null;
}


async function ensureVisibleEmi(emiId) {
    const { data: emiRows } = await supabaseRequest(`emis?id=eq.${encodeURIComponent(emiId)}&select=id,loan_id`);
    const emi = emiRows?.[0];
    if (!emi) return null;
    const { data: loanRows } = await supabaseRequest(`loans?id=eq.${encodeURIComponent(emi.loan_id)}&deleted_at=is.null&select=id`);
    return loanRows?.length ? emi : null;
}

async function ensureVisiblePayment(paymentId) {
    const { data: rows } = await supabaseRequest(`emi_payments?id=eq.${encodeURIComponent(paymentId)}&select=id,emi_id`);
    const payment = rows?.[0];
    if (!payment) return null;
    return (await ensureVisibleEmi(payment.emi_id)) ? payment : null;
}
function cleanDate(value) {
    const text = String(value || '').slice(0, 10);
    if (!DATE_RE.test(text)) return null;
    const d = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : text;
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;

    try {
        if (req.method === 'GET') {
            const emiId = validUuid(req.query?.emi_id);
            if (!emiId) return res.status(400).json({ error: 'Valid emi_id required' });

            if (!await ensureVisibleEmi(emiId)) return res.status(404).json({ error: 'EMI not found or loan is in Recycle Bin' });
            const [emiRes, paymentRes] = await Promise.all([
                supabaseRequest(`emis?id=eq.${encodeURIComponent(emiId)}&select=id,loan_id,installment_number,due_date,due_day,due_month,due_year,amount,status,paid_date,paid_amount,notes`),
                supabaseRequest(`emi_payments?emi_id=eq.${encodeURIComponent(emiId)}&reversed_at=is.null&select=id,emi_id,amount,payment_date,method,notes,source,settlement_id,created_at,updated_at,reversed_at&order=payment_date.desc,created_at.desc`)
            ]);
            const emi = emiRes.data?.[0];
            if (!emi) return res.status(404).json({ error: 'EMI not found' });

            const payments = (paymentRes.data || []).map(p => ({ ...p, paid_date: p.payment_date }));
            const ledgerPaid = payments.reduce((sum, p) => sum + (Number.parseInt(p.amount, 10) || 0), 0);
            const aggregatePaid = Number.parseInt(emi.paid_amount, 10) || 0;
            const paid = Math.max(ledgerPaid, aggregatePaid);
            return res.status(200).json({
                emi,
                payments,
                summary: {
                    scheduled: Number.parseInt(emi.amount, 10) || 0,
                    paid,
                    remaining: Math.max((Number.parseInt(emi.amount, 10) || 0) - paid, 0),
                    hasOpeningBalance: aggregatePaid > ledgerPaid
                }
            });
        }

        if (req.method === 'POST') {
            const emiId = validUuid(req.body?.emi_id);
            const amount = positiveInt(req.body?.amount);
            const paidDate = cleanDate(req.body?.paid_date) || new Date().toISOString().slice(0, 10);
            if (!emiId || !amount) return res.status(400).json({ error: 'Valid emi_id and amount required' });
            if (!await ensureVisibleEmi(emiId)) return res.status(404).json({ error: 'EMI not found or loan is in Recycle Bin' });

            const { data } = await supabaseRequest('rpc/abhi_add_emi_payment', 'POST', {
                p_emi_id: emiId,
                p_amount: amount,
                p_payment_date: paidDate,
                p_method: cleanText(req.body?.method, 60),
                p_notes: cleanText(req.body?.notes, 500)
            });
            return res.status(201).json(Array.isArray(data) ? (data[0] || { success: true }) : (data || { success: true }));
        }

        if (req.method === 'PUT') {
            const paymentId = validUuid(req.body?.payment_id);
            const amount = positiveInt(req.body?.amount);
            const paidDate = cleanDate(req.body?.paid_date) || new Date().toISOString().slice(0, 10);
            if (!paymentId || !amount) return res.status(400).json({ error: 'Valid payment_id and amount required' });
            if (!await ensureVisiblePayment(paymentId)) return res.status(404).json({ error: 'Payment not found or loan is in Recycle Bin' });

            const { data } = await supabaseRequest('rpc/abhi_update_emi_payment', 'POST', {
                p_payment_id: paymentId,
                p_amount: amount,
                p_payment_date: paidDate,
                p_method: cleanText(req.body?.method, 60),
                p_notes: cleanText(req.body?.notes, 500)
            });
            return res.status(200).json(Array.isArray(data) ? (data[0] || { success: true }) : (data || { success: true }));
        }

        if (req.method === 'DELETE') {
            const paymentId = validUuid(req.body?.payment_id);
            if (!paymentId) return res.status(400).json({ error: 'Valid payment_id required' });
            if (!await ensureVisiblePayment(paymentId)) return res.status(404).json({ error: 'Payment not found or loan is in Recycle Bin' });
            if (req.body?.confirm !== true) return res.status(400).json({ error: 'Delete confirmation required' });

            const { data } = await supabaseRequest('rpc/abhi_reverse_emi_payment', 'POST', {
                p_payment_id: paymentId
            });
            return res.status(200).json(Array.isArray(data) ? (data[0] || { success: true }) : (data || { success: true }));
        }

        res.setHeader('Allow', 'GET, POST, PUT, DELETE');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return sendServerError(res, 'Payments API Error:', err);
    }
}
