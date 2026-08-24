import { isValidAdminSession, noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const MONTHS = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validDateParts(day, month, year) {
    const d = Number(day);
    const m = MONTHS[String(month || '').toUpperCase()];
    const y = Number(year);
    if (!Number.isInteger(d) || d < 1 || d > 31 || !m || !Number.isInteger(y) || y < 2000 || y > 2200) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return { d, m, y, month: String(month).toUpperCase(), iso: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` };
}

function parseEmiInput(loanId, e, index, existing = false) {
    const day = Number.parseInt(e?.day ?? e?.due_day, 10);
    const month = String(e?.month ?? e?.due_month ?? '').trim().toUpperCase();
    const amount = Number.parseInt(e?.amount, 10);
    const rawYear = e?.year ?? e?.due_year;
    const hasYear = rawYear !== null && rawYear !== undefined && String(rawYear).trim() !== '';

    if (!Number.isInteger(day) || day < 1 || day > 31 || !MONTHS[month] || !Number.isFinite(amount) || amount <= 0) {
        throw Object.assign(new Error('Invalid EMI day/month/amount'), { status: 400 });
    }

    let dueDate = null;
    let dueYear = null;
    if (hasYear) {
        const date = validDateParts(day, month, rawYear);
        if (!date) throw Object.assign(new Error('Invalid EMI date'), { status: 400 });
        dueDate = date.iso;
        dueYear = date.y;
    } else if (!existing) {
        throw Object.assign(new Error('Year is required for new EMI rows'), { status: 400 });
    }

    const id = UUID_RE.test(String(e?.id || '').trim()) ? String(e.id).trim() : null;
    return {
        id,
        loan_id: loanId,
        installment_number: index + 1,
        due_date: dueDate,
        due_day: day,
        due_month: month,
        due_year: dueYear,
        amount
    };
}

function buildNewEmiRows(loanId, emis = []) {
    return emis.map((e, i) => {
        const row = parseEmiInput(loanId, e, i, false);
        delete row.id;
        return { ...row, status: 'pending', paid_date: null, paid_amount: null };
    });
}

async function syncExistingEmis(loanId, incoming) {
    const { data: existingRows } = await supabaseRequest(
        `emis?loan_id=eq.${encodeURIComponent(loanId)}&select=id,amount,paid_amount,status,due_date,due_year`
    );
    const existing = existingRows || [];
    const byId = new Map(existing.map(e => [e.id, e]));
    const seen = new Set();
    const parsed = [];

    incoming.forEach((raw, index) => {
        const rawId = UUID_RE.test(String(raw?.id || '').trim()) ? String(raw.id).trim() : null;
        if (rawId && !byId.has(rawId)) throw Object.assign(new Error('EMI does not belong to this loan'), { status: 400 });
        const row = parseEmiInput(loanId, raw, index, Boolean(rawId));
        parsed.push(row);
        if (rawId) seen.add(rawId);
    });

    const removed = existing.filter(e => !seen.has(e.id));
    if (removed.some(e => (Number.parseInt(e.paid_amount, 10) || 0) > 0 || e.status === 'paid')) {
        throw Object.assign(new Error('Paid EMI cannot be removed from the schedule. Remove/correct its payments first.'), { status: 409 });
    }

    for (const row of parsed) {
        if (row.id) {
            const old = byId.get(row.id);
            const paid = Number.parseInt(old?.paid_amount, 10) || 0;
            if (paid > row.amount) throw Object.assign(new Error('EMI amount cannot be lower than the amount already paid'), { status: 409 });
            const id = row.id;
            const patch = { ...row };
            delete patch.id;
            delete patch.loan_id;
            await supabaseRequest(`emis?id=eq.${encodeURIComponent(id)}`, 'PATCH', patch);
            // Re-evaluate pending/overdue/paid after date or amount corrections.
            await supabaseRequest('rpc/abhi_recalculate_emi', 'POST', { p_emi_id: id });
        } else {
            const insertRow = { ...row };
            delete insertRow.id;
            await supabaseRequest('emis', 'POST', { ...insertRow, status: 'pending', paid_date: null, paid_amount: null });
        }
    }

    for (const row of removed) {
        await supabaseRequest(`emis?id=eq.${encodeURIComponent(row.id)}`, 'DELETE');
    }
}

export default async function handler(req, res) {
    noStore(res);
    const { action } = req.query || {};
    const isAdmin = isValidAdminSession(req);

    try {
        // Public read-only endpoint: preserve the existing public dashboard, but expose no phone/address/IDs.
        if (req.method === 'GET' && !action) {
            const select = isAdmin
                ? '*,borrowers(id,name,phone,whatsapp,address,photo_url),emis(*)&order=created_at.desc'
                : 'id,loan_code,amount,status,loan_year,borrowers(name),emis(installment_number,due_date,due_day,due_month,due_year,amount,status,paid_date,paid_amount)&order=created_at.desc';
            const { data } = await supabaseRequest(`loans?select=${select}`);
            return res.status(200).json(data || []);
        }

        if (!requireAdmin(req, res)) return;

        if (req.method === 'GET' && action === 'dashboard') {
            const [loansRes, overdueRes] = await Promise.all([
                supabaseRequest('loans?select=*,borrowers(name),emis(*)&status=eq.active'),
                supabaseRequest('emis?select=*&status=eq.overdue')
            ]);
            return res.status(200).json({ loans: loansRes.data || [], overdue: overdueRes.data || [] });
        }

        if (req.method === 'POST' && action === 'add') {
            const { borrower_id, loan_code, amount, interest_rate, loan_date, loan_year, notes, emis = [] } = req.body || {};
            const amountNum = Number.parseInt(amount, 10);
            const yearNum = Number.parseInt(loan_year, 10);
            if (!borrower_id || !loan_code || !Number.isFinite(amountNum) || amountNum <= 0 || !loan_date || !Number.isInteger(yearNum)) {
                return res.status(400).json({ error: 'Borrower, loan code, amount, date and year are required' });
            }

            const { data: loanData } = await supabaseRequest('loans', 'POST', {
                borrower_id,
                loan_code: String(loan_code).trim(),
                amount: amountNum,
                interest_rate: Number(interest_rate || 0),
                loan_date,
                loan_year: yearNum,
                notes: String(notes || '').trim() || null,
                status: 'active'
            });
            const loan = loanData?.[0];
            if (!loan?.id) throw new Error('Loan insert did not return an id');

            const emiRows = buildNewEmiRows(loan.id, Array.isArray(emis) ? emis : []);
            if (emiRows.length) await supabaseRequest('emis', 'POST', emiRows);
            await supabaseRequest('activity_log', 'POST', {
                action: 'ADD_LOAN', table_name: 'loans', record_id: loan.id,
                description: `Loan ${loan.loan_code} added - Amount: ${amountNum}`
            });
            return res.status(201).json({ success: true, loan });
        }

        if (req.method === 'PUT' && action === 'update') {
            const { loan_id, amount, interest_rate, notes, status, emis } = req.body || {};
            if (!loan_id) return res.status(400).json({ error: 'loan_id required' });

            const patch = {};
            if (amount !== undefined && amount !== '') {
                const amountNum = Number.parseInt(amount, 10);
                if (!Number.isFinite(amountNum) || amountNum <= 0) return res.status(400).json({ error: 'Invalid amount' });
                patch.amount = amountNum;
            }
            if (interest_rate !== undefined && interest_rate !== '') patch.interest_rate = Number(interest_rate || 0);
            if (notes !== undefined) patch.notes = String(notes || '').trim() || null;
            if (status !== undefined) {
                if (!['active','closed','defaulted'].includes(status)) return res.status(400).json({ error: 'Invalid loan status' });
                patch.status = status;
            }
            // Validate/sync the schedule first so a rejected EMI change does not partially update loan fields.
            if (Array.isArray(emis)) await syncExistingEmis(loan_id, emis);
            if (Object.keys(patch).length) await supabaseRequest(`loans?id=eq.${encodeURIComponent(loan_id)}`, 'PATCH', patch);

            await supabaseRequest('activity_log', 'POST', {
                action: 'UPDATE_LOAN', table_name: 'loans', record_id: loan_id,
                description: 'Loan updated'
            });
            return res.status(200).json({ success: true });
        }

        if (req.method === 'DELETE' && action === 'delete') {
            const loan_id = req.body?.loan_id;
            if (!loan_id) return res.status(400).json({ error: 'loan_id required' });
            await supabaseRequest(`loans?id=eq.${encodeURIComponent(loan_id)}`, 'DELETE');
            await supabaseRequest('activity_log', 'POST', {
                action: 'DELETE_LOAN', table_name: 'loans', record_id: loan_id,
                description: 'Loan deleted'
            });
            return res.status(200).json({ success: true });
        }

        // Manual Pending/Overdue correction is still available for unpaid legacy EMIs.
        // Paid state must go through /api/payments so payment history remains consistent.
        if (req.method === 'PUT' && action === 'emi-status') {
            const { emi_id, status } = req.body || {};
            if (!emi_id || !['pending','overdue'].includes(status)) {
                return res.status(400).json({ error: 'Use payment entry to mark an EMI paid' });
            }
            const { data } = await supabaseRequest(`emis?id=eq.${encodeURIComponent(emi_id)}&select=id,paid_amount`);
            const emi = data?.[0];
            if (!emi) return res.status(404).json({ error: 'EMI not found' });
            const paid = Number.parseInt(emi.paid_amount, 10) || 0;
            if (paid > 0 && status === 'pending') {
                return res.status(409).json({ error: 'EMI with payments cannot be manually reset; correct the payment history instead' });
            }
            const patch = paid > 0 ? { status } : { status, paid_date: null, paid_amount: null };
            await supabaseRequest(`emis?id=eq.${encodeURIComponent(emi_id)}`, 'PATCH', patch);
            await supabaseRequest('activity_log', 'POST', {
                action: 'EMI_STATUS_CHANGE', table_name: 'emis', record_id: emi_id,
                description: `EMI status changed: ${status}`
            });
            return res.status(200).json({ success: true });
        }

        res.setHeader('Allow', 'GET, POST, PUT, DELETE');
        return res.status(404).json({ error: 'Action not found' });
    } catch (err) {
        return sendServerError(res, 'Loans API Error:', err);
    }
}
