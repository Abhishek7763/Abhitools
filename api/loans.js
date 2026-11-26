import { isValidAdminSession, noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const MONTHS = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOAN_CODE_MAX_LENGTH = 80;

function requestError(message, status = 400) {
    return Object.assign(new Error(message), { status, publicMessage: message });
}

function validIsoDate(value) {
    const date = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function normalizeLoanCode(value) {
    const code = String(value ?? '').trim();
    if (!code || code.length > LOAN_CODE_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(code)) return null;
    return code;
}

async function assertLoanCodeAvailable(loanCode, excludeLoanId = null) {
    const { data } = await supabaseRequest('loans?select=id,loan_code');
    const duplicate = (data || []).find(row => row.id !== excludeLoanId && String(row.loan_code ?? '').trim() === loanCode);
    if (duplicate) {
        throw requestError('Ye Loan ID pehle se kisi loan me use ho rahi hai, Recycle Bin records me bhi duplicate allowed nahi hai.', 409);
    }
}

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
    const day = Number(e?.day ?? e?.due_day);
    const month = String(e?.month ?? e?.due_month ?? '').trim().toUpperCase();
    const amount = Number(e?.amount);
    const rawYear = e?.year ?? e?.due_year;
    const hasYear = rawYear !== null && rawYear !== undefined && String(rawYear).trim() !== '';

    if (!Number.isInteger(day) || day < 1 || day > 31 || !MONTHS[month] || !Number.isInteger(amount) || amount <= 0) {
        throw requestError('EMI ka day, month ya amount valid nahi hai.');
    }

    let dueDate = null;
    let dueYear = null;
    if (hasYear) {
        const date = validDateParts(day, month, rawYear);
        if (!date) throw requestError('EMI ki calendar date valid nahi hai.');
        dueDate = date.iso;
        dueYear = date.y;
    } else if (!existing) {
        throw requestError('New EMI row ke liye year required hai.');
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
        if (rawId && !byId.has(rawId)) throw requestError('EMI is loan se linked nahi hai.');
        const row = parseEmiInput(loanId, raw, index, Boolean(rawId));
        parsed.push(row);
        if (rawId) seen.add(rawId);
    });

    const removed = existing.filter(e => !seen.has(e.id));
    if (removed.some(e => (Number.parseInt(e.paid_amount, 10) || 0) > 0 || e.status === 'paid')) {
        throw requestError('Paid EMI schedule se remove nahi ho sakti. Pehle uski payment correct karein.', 409);
    }

    for (const row of parsed) {
        if (row.id) {
            const old = byId.get(row.id);
            const paid = Number.parseInt(old?.paid_amount, 10) || 0;
            if (paid > row.amount) throw requestError('EMI amount already paid amount se kam nahi ho sakta.', 409);
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
                ? '*,borrowers(id,name,phone,whatsapp,address,photo_url),emis(*),loan_settlements(*)&order=created_at.desc'
                : 'id,loan_code,amount,status,loan_year,borrowers(name),emis(installment_number,due_date,due_day,due_month,due_year,amount,status,paid_date,paid_amount)&order=created_at.desc';
            const { data } = await supabaseRequest(`loans?deleted_at=is.null&select=${select}`);
            return res.status(200).json(data || []);
        }

        if (!requireAdmin(req, res)) return;

        if (req.method === 'GET' && action === 'dashboard') {
            const [loansRes, overdueRes] = await Promise.all([
                supabaseRequest('loans?deleted_at=is.null&select=*,borrowers(name),emis(*)&status=eq.active'),
                supabaseRequest('emis?select=*&status=eq.overdue')
            ]);
            return res.status(200).json({ loans: loansRes.data || [], overdue: overdueRes.data || [] });
        }

        if (req.method === 'POST' && action === 'add') {
            const { borrower_id, loan_code, amount, interest_rate, loan_date, loan_year, notes, emis = [] } = req.body || {};
            const loanCode = normalizeLoanCode(loan_code);
            const amountNum = Number(amount);
            const yearNum = Number(loan_year);
            const interestNum = interest_rate === '' || interest_rate === null || interest_rate === undefined ? 0 : Number(interest_rate);
            const loanDate = loan_date ? validIsoDate(loan_date) : null;
            if (!UUID_RE.test(String(borrower_id || '').trim()) || !loanCode || !Number.isInteger(amountNum) || amountNum <= 0 || !Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2200) {
                return res.status(400).json({ error: `Borrower, 1-${LOAN_CODE_MAX_LENGTH} character Loan ID, positive amount aur valid year required hain.` });
            }
            if (loan_date && !loanDate) return res.status(400).json({ error: 'Loan date valid calendar date honi chahiye.' });
            if (loanDate && Number(loanDate.slice(0, 4)) !== yearNum) return res.status(400).json({ error: 'Loan date aur loan year ka saal same hona chahiye.' });
            if (!Number.isFinite(interestNum) || interestNum < 0) return res.status(400).json({ error: 'Interest rate valid non-negative number honi chahiye.' });
            await assertLoanCodeAvailable(loanCode);

            // Validate the complete schedule before creating the loan. Invalid input must never leave a partial loan row behind.
            const validatedEmiRows = buildNewEmiRows('__pending_loan__', Array.isArray(emis) ? emis : []);

            const { data: loanData } = await supabaseRequest('loans', 'POST', {
                borrower_id,
                loan_code: loanCode,
                amount: amountNum,
                interest_rate: interestNum,
                loan_date: loanDate,
                loan_year: yearNum,
                notes: String(notes || '').trim() || null,
                status: 'active'
            });
            const loan = loanData?.[0];
            if (!loan?.id) throw new Error('Loan insert did not return an id');

            const emiRows = validatedEmiRows.map(row => ({ ...row, loan_id: loan.id }));
            if (emiRows.length) await supabaseRequest('emis', 'POST', emiRows);
            await supabaseRequest('activity_log', 'POST', {
                action: 'ADD_LOAN', table_name: 'loans', record_id: loan.id,
                description: `Loan ${loan.loan_code} added - Amount: ${amountNum}`
            });
            return res.status(201).json({ success: true, loan });
        }

        if (req.method === 'PUT' && action === 'update') {
            const { loan_id, loan_code, amount, interest_rate, loan_date, loan_year, notes, status, emis } = req.body || {};
            if (!loan_id) return res.status(400).json({ error: 'loan_id required' });
            const { data: visibleLoanRows } = await supabaseRequest(`loans?id=eq.${encodeURIComponent(loan_id)}&deleted_at=is.null&select=id,loan_code,loan_date,loan_year&limit=1`);
            if (!visibleLoanRows?.length) return res.status(404).json({ error: 'Loan not found or is in Recycle Bin' });
            const { data: activeSettlementRows } = await supabaseRequest(`loan_settlements?loan_id=eq.${encodeURIComponent(loan_id)}&reopened_at=is.null&select=id&limit=1`);
            if (activeSettlementRows?.length) return res.status(409).json({ error: 'Settled loan is locked. Reopen the settlement before editing the loan.' });

            const patch = {};
            if (loan_code !== undefined) {
                const loanCode = normalizeLoanCode(loan_code);
                if (!loanCode) return res.status(400).json({ error: `Loan ID 1-${LOAN_CODE_MAX_LENGTH} normal characters me honi chahiye.` });
                await assertLoanCodeAvailable(loanCode, loan_id);
                patch.loan_code = loanCode;
            }
            if (amount !== undefined && amount !== '') {
                const amountNum = Number(amount);
                if (!Number.isInteger(amountNum) || amountNum <= 0) return res.status(400).json({ error: 'Invalid amount' });
                patch.amount = amountNum;
            }
            if (interest_rate !== undefined && interest_rate !== '') {
                const interestNum = Number(interest_rate);
                if (!Number.isFinite(interestNum) || interestNum < 0) return res.status(400).json({ error: 'Invalid interest rate' });
                patch.interest_rate = interestNum;
            }
            if (loan_year !== undefined) {
                if (loan_year === '' || loan_year === null) patch.loan_year = null;
                else {
                    const yearNum = Number(loan_year);
                    if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2200) return res.status(400).json({ error: 'Invalid loan year' });
                    patch.loan_year = yearNum;
                }
            }
            if (loan_date !== undefined) {
                if (loan_date === '' || loan_date === null) patch.loan_date = null;
                else {
                    const loanDate = validIsoDate(loan_date);
                    if (!loanDate) return res.status(400).json({ error: 'Invalid loan date' });
                    patch.loan_date = loanDate;
                }
            }
            const effectiveYear = Object.hasOwn(patch, 'loan_year') ? patch.loan_year : visibleLoanRows[0].loan_year;
            const effectiveDate = Object.hasOwn(patch, 'loan_date') ? patch.loan_date : visibleLoanRows[0].loan_date;
            if (effectiveYear && effectiveDate && Number(String(effectiveDate).slice(0, 4)) !== Number(effectiveYear)) {
                return res.status(400).json({ error: 'Loan date aur loan year ka saal same hona chahiye.' });
            }
            if (notes !== undefined) patch.notes = String(notes || '').trim() || null;
            if (status !== undefined) {
                if (!['active','closed','defaulted'].includes(status)) return res.status(400).json({ error: 'Invalid loan status' });
                if (status === 'closed') return res.status(409).json({ error: 'Use Loan Settlement Center to close a loan' });
                patch.status = status;
            }
            // Validate/sync the schedule first so a rejected EMI change does not partially update loan fields.
            if (Array.isArray(emis)) await syncExistingEmis(loan_id, emis);
            if (Object.keys(patch).length) await supabaseRequest(`loans?id=eq.${encodeURIComponent(loan_id)}&deleted_at=is.null`, 'PATCH', patch);

            const loanCodeChanged = Object.hasOwn(patch, 'loan_code') && patch.loan_code !== String(visibleLoanRows[0].loan_code ?? '').trim();
            await supabaseRequest('activity_log', 'POST', {
                action: 'UPDATE_LOAN', table_name: 'loans', record_id: loan_id,
                description: loanCodeChanged
                    ? `Loan updated - Loan ID ${visibleLoanRows[0].loan_code || '—'} -> ${patch.loan_code}`
                    : 'Loan updated'
            });
            return res.status(200).json({ success: true });
        }

        if (req.method === 'DELETE' && action === 'delete') {
            const loan_id = String(req.body?.loan_id || '').trim();
            if (!UUID_RE.test(loan_id)) return res.status(400).json({ error: 'Valid loan_id required' });
            const { data } = await supabaseRequest('rpc/abhi_recycle_loan', 'POST', { p_loan_id: loan_id });
            return res.status(200).json(Array.isArray(data) ? (data[0] || { success: true }) : (data || { success: true }));
        }

        // Manual Pending/Overdue correction is still available for unpaid legacy EMIs.
        // Paid state must go through /api/payments so payment history remains consistent.
        if (req.method === 'PUT' && action === 'emi-status') {
            const { emi_id, status } = req.body || {};
            if (!emi_id || !['pending','overdue'].includes(status)) {
                return res.status(400).json({ error: 'Use payment entry to mark an EMI paid' });
            }
            const { data } = await supabaseRequest(`emis?id=eq.${encodeURIComponent(emi_id)}&select=id,loan_id,paid_amount`);
            const emi = data?.[0];
            if (!emi) return res.status(404).json({ error: 'EMI not found' });
            const { data: liveLoanRows } = await supabaseRequest(`loans?id=eq.${encodeURIComponent(emi.loan_id)}&deleted_at=is.null&select=id&limit=1`);
            if (!liveLoanRows?.length) return res.status(409).json({ error: 'EMI belongs to a recycled loan' });
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
