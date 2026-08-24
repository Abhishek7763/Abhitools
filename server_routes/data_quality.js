import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH_INDEX = new Map(['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].map((m, i) => [m, i + 1]));

function safeInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
}

function sourceDateValid(emi) {
    const month = MONTH_INDEX.get(String(emi?.due_month || '').trim().toUpperCase());
    const day = safeInt(emi?.due_day);
    return Boolean(month && day >= 1 && day <= 31);
}

function installmentGaps(emis) {
    const nums = [...new Set((emis || []).map(e => safeInt(e.installment_number)).filter(n => n > 0))].sort((a,b) => a-b);
    if (!nums.length) return [];
    const gaps = [];
    for (let n = nums[0]; n <= nums[nums.length - 1]; n += 1) if (!nums.includes(n)) gaps.push(n);
    return gaps;
}

function normalizeLoan(loan, emis) {
    const sorted = [...emis].sort((a,b) => safeInt(a.installment_number) - safeInt(b.installment_number));
    const missing = sorted.filter(e => !e.due_year || !e.due_date);
    const invalidSource = missing.filter(e => !sourceDateValid(e));
    const gaps = installmentGaps(sorted);
    return {
        id: loan.id,
        borrower_id: loan.borrower_id,
        borrower_name: loan.borrowers?.name || 'Unknown',
        loan_code: loan.loan_code || 'Loan',
        status: loan.status || 'active',
        amount: safeInt(loan.amount),
        loan_year: loan.loan_year || null,
        loan_date: loan.loan_date || null,
        missing_due_count: missing.length,
        invalid_source_count: invalidSource.length,
        installment_gaps: gaps,
        can_cleanup: missing.length > 0 && invalidSource.length === 0,
        emis: sorted.map(e => ({
            id: e.id,
            installment_number: safeInt(e.installment_number),
            due_day: safeInt(e.due_day),
            due_month: String(e.due_month || '').toUpperCase(),
            due_year: e.due_year || null,
            due_date: e.due_date || null,
            amount: safeInt(e.amount),
            paid_amount: safeInt(e.paid_amount),
            status: e.status || 'pending',
            missing_date: !e.due_year || !e.due_date,
            source_date_valid: sourceDateValid(e)
        }))
    };
}

async function getQuality(req, res) {
    const [loansRes, emisRes] = await Promise.all([
        supabaseRequest('loans?deleted_at=is.null&select=id,borrower_id,loan_code,status,amount,loan_year,loan_date,borrowers(id,name)&order=created_at.desc'),
        supabaseRequest('emis?select=id,loan_id,installment_number,due_day,due_month,due_year,due_date,amount,paid_amount,status&order=loan_id.asc,installment_number.asc')
    ]);
    const loans = loansRes.data || [];
    const emis = emisRes.data || [];
    const byLoan = new Map();
    for (const emi of emis) {
        if (!byLoan.has(emi.loan_id)) byLoan.set(emi.loan_id, []);
        byLoan.get(emi.loan_id).push(emi);
    }
    const items = loans.map(loan => normalizeLoan(loan, byLoan.get(loan.id) || []));
    const affected = items.filter(x => x.missing_due_count > 0 || !x.loan_year || !x.loan_date || x.installment_gaps.length || x.invalid_source_count);
    return res.status(200).json({
        summary: {
            visible_loans: items.length,
            affected_loans: affected.length,
            missing_emi_dates: items.reduce((s,x) => s + x.missing_due_count, 0),
            missing_loan_year: items.filter(x => !x.loan_year).length,
            missing_loan_date: items.filter(x => !x.loan_date).length,
            loans_with_sequence_gaps: items.filter(x => x.installment_gaps.length).length,
            invalid_source_dates: items.reduce((s,x) => s + x.invalid_source_count, 0),
            clean_loans: items.filter(x => x.missing_due_count === 0 && x.loan_year && x.loan_date && !x.installment_gaps.length && x.invalid_source_count === 0).length
        },
        items: affected
    });
}

async function applyCleanup(req, res) {
    const action = String(req.body?.action || '').toLowerCase();
    if (!['apply_dates','apply_cleanup'].includes(action)) return res.status(400).json({ error: 'Unsupported data-quality action' });
    const loanId = String(req.body?.loan_id || '').trim();
    const confirmText = String(req.body?.confirm || '').trim().toUpperCase();
    if (!UUID_RE.test(loanId)) return res.status(400).json({ error: 'Invalid loan_id' });
    if (confirmText !== 'APPLY DATES') return res.status(400).json({ error: 'Type APPLY DATES to confirm' });

    const rawUpdates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    if (rawUpdates.length > 120) return res.status(400).json({ error: 'Invalid EMI update list' });
    const updates = rawUpdates.map(row => {
        const emiId = String(row?.emi_id || '').trim();
        const year = Number.parseInt(row?.due_year, 10);
        if (!UUID_RE.test(emiId) || !Number.isInteger(year) || year < 2000 || year > 2200) {
            throw Object.assign(new Error('Every EMI needs a valid reviewed year'), { status: 400 });
        }
        return { emi_id: emiId, due_year: year };
    });

    let loanYear = req.body?.loan_year;
    if (loanYear === '' || loanYear === null || loanYear === undefined) loanYear = null;
    else {
        loanYear = Number.parseInt(loanYear, 10);
        if (!Number.isInteger(loanYear) || loanYear < 2000 || loanYear > 2200) return res.status(400).json({ error: 'Invalid optional loan year' });
    }
    let loanDate = String(req.body?.loan_date || '').trim() || null;
    if (loanDate && !/^\d{4}-\d{2}-\d{2}$/.test(loanDate)) return res.status(400).json({ error: 'Invalid optional loan date' });
    if (loanDate && loanYear && Number(loanDate.slice(0,4)) !== loanYear) return res.status(400).json({ error: 'Loan year must match exact loan date year' });
    const note = String(req.body?.note || '').trim().slice(0, 220) || null;
    if (!updates.length && !loanYear && !loanDate) return res.status(400).json({ error: 'Nothing to clean up' });

    const { data } = await supabaseRequest('rpc/abhi_apply_legacy_due_dates', 'POST', {
        p_loan_id: loanId,
        p_updates: updates,
        p_loan_year: loanYear,
        p_loan_date: loanDate,
        p_note: note
    });
    const result = Array.isArray(data) ? data[0] : data;
    return res.status(200).json(result || { success: true });
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    try {
        if (req.method === 'GET') return getQuality(req, res);
        if (req.method === 'POST') return applyCleanup(req, res);
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return sendServerError(res, 'Data Quality API Error:', err);
    }
}
