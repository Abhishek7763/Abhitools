import { isValidAdminSession, noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const MONTHS = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };

function validDateParts(day, month, year) {
    const d = Number(day);
    const m = MONTHS[String(month || '').toUpperCase()];
    const y = Number(year);
    if (!Number.isInteger(d) || d < 1 || d > 31 || !m || !Number.isInteger(y) || y < 2000 || y > 2200) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return { d, m, y, month: String(month).toUpperCase(), iso: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` };
}

function buildEmiRows(loanId, emis = []) {
    return emis.map((e, i) => {
        const date = validDateParts(e.day, e.month, e.year);
        const amount = Number.parseInt(e.amount, 10);
        if (!date || !Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('Invalid EMI data'), { status: 400 });
        return {
            loan_id: loanId,
            installment_number: i + 1,
            due_date: date.iso,
            due_day: date.d,
            due_month: date.month,
            due_year: date.y,
            amount,
            status: ['pending','paid','overdue'].includes(e.status) ? e.status : 'pending',
            paid_date: e.status === 'paid' && e.paid_date ? e.paid_date : null,
            paid_amount: e.status === 'paid' && e.paid_amount ? Number.parseInt(e.paid_amount, 10) : null
        };
    });
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

            const emiRows = buildEmiRows(loan.id, Array.isArray(emis) ? emis : []);
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
            if (Object.keys(patch).length) await supabaseRequest(`loans?id=eq.${encodeURIComponent(loan_id)}`, 'PATCH', patch);

            if (Array.isArray(emis)) {
                await supabaseRequest(`emis?loan_id=eq.${encodeURIComponent(loan_id)}`, 'DELETE');
                const emiRows = buildEmiRows(loan_id, emis);
                if (emiRows.length) await supabaseRequest('emis', 'POST', emiRows);
            }

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

        if (req.method === 'PUT' && action === 'emi-status') {
            const { emi_id, status, paid_date, paid_amount } = req.body || {};
            if (!emi_id || !['pending','paid','overdue'].includes(status)) return res.status(400).json({ error: 'Valid emi_id and status required' });
            await supabaseRequest(`emis?id=eq.${encodeURIComponent(emi_id)}`, 'PATCH', {
                status,
                paid_date: status === 'paid' ? (paid_date || new Date().toISOString().split('T')[0]) : null,
                paid_amount: status === 'paid' && paid_amount ? Number.parseInt(paid_amount, 10) : null
            });
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
