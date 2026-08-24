import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const TIME_ZONE = 'Asia/Kolkata';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_TYPES = new Set(['all', 'borrower', 'loan', 'emi']);
const VALID_LOAN_STATUS = new Set(['all', 'active', 'closed', 'defaulted']);
const VALID_EMI_STATUS = new Set(['all', 'pending', 'partial', 'paid', 'overdue', 'year-not-set']);
const VALID_DUE = new Set(['all', 'overdue', 'today', 'next7', 'this-month', 'year-not-set']);
const VALID_SORT = new Set(['name', 'amount-high', 'amount-low', 'due-soon', 'newest']);

function businessDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function safeInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
}

function norm(value) {
    return String(value ?? '').trim().toLowerCase();
}

function searchable(...values) {
    return values.flat(Infinity).filter(v => v !== null && v !== undefined).map(norm).join(' ');
}

function matchesQuery(haystack, q) {
    if (!q) return true;
    const terms = q.split(/\s+/).filter(Boolean);
    return terms.every(term => haystack.includes(term));
}

function emiState(emi, today) {
    const amount = safeInt(emi.amount);
    const paid = Math.max(0, Math.min(safeInt(emi.paid_amount), amount));
    const remaining = Math.max(amount - paid, 0);
    const dueDate = emi.due_date ? String(emi.due_date).slice(0, 10) : null;
    const hasKnownDate = Boolean(emi.due_year && dueDate);
    if (amount > 0 && paid >= amount) return { status: 'paid', paid, remaining, dueDate, hasKnownDate };
    if (hasKnownDate && dueDate < today && remaining > 0) return { status: 'overdue', paid, remaining, dueDate, hasKnownDate };
    if (paid > 0) return { status: 'partial', paid, remaining, dueDate, hasKnownDate };
    return { status: 'pending', paid, remaining, dueDate, hasKnownDate };
}

function dueMatches(state, dueFilter, today) {
    if (dueFilter === 'all') return true;
    if (dueFilter === 'year-not-set') return !state.hasKnownDate && state.remaining > 0;
    if (!state.hasKnownDate || state.remaining <= 0) return false;
    if (dueFilter === 'overdue') return state.dueDate < today;
    if (dueFilter === 'today') return state.dueDate === today;
    if (dueFilter === 'next7') return state.dueDate >= today && state.dueDate <= addDays(today, 6);
    if (dueFilter === 'this-month') return state.dueDate.startsWith(today.slice(0, 7));
    return true;
}

function amountMatches(value, minAmount, maxAmount) {
    if (minAmount !== null && value < minAmount) return false;
    if (maxAmount !== null && value > maxAmount) return false;
    return true;
}

function parseMoneyFilter(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
}

function compareResults(a, b, sort) {
    if (sort === 'amount-high') return (b.sortAmount - a.sortAmount) || a.sortName.localeCompare(b.sortName);
    if (sort === 'amount-low') return (a.sortAmount - b.sortAmount) || a.sortName.localeCompare(b.sortName);
    if (sort === 'due-soon') {
        const aa = a.sortDate || '9999-12-31';
        const bb = b.sortDate || '9999-12-31';
        return aa.localeCompare(bb) || a.sortName.localeCompare(b.sortName);
    }
    if (sort === 'newest') {
        const aa = a.created_at || '';
        const bb = b.created_at || '';
        return bb.localeCompare(aa) || a.sortName.localeCompare(b.sortName);
    }
    return a.sortName.localeCompare(b.sortName) || a.type.localeCompare(b.type);
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await supabaseRequest('rpc/abhi_refresh_due_statuses', 'POST', {});

        const q = norm(String(req.query?.q || '').slice(0, 100));
        const type = VALID_TYPES.has(String(req.query?.type || 'all')) ? String(req.query?.type || 'all') : 'all';
        const loanStatus = VALID_LOAN_STATUS.has(String(req.query?.loanStatus || 'all')) ? String(req.query?.loanStatus || 'all') : 'all';
        const emiStatus = VALID_EMI_STATUS.has(String(req.query?.emiStatus || 'all')) ? String(req.query?.emiStatus || 'all') : 'all';
        const due = VALID_DUE.has(String(req.query?.due || 'all')) ? String(req.query?.due || 'all') : 'all';
        const sort = VALID_SORT.has(String(req.query?.sort || 'name')) ? String(req.query?.sort || 'name') : 'name';
        const minAmount = parseMoneyFilter(req.query?.minAmount);
        const maxAmount = parseMoneyFilter(req.query?.maxAmount);
        if (Number.isNaN(minAmount) || Number.isNaN(maxAmount)) return res.status(400).json({ error: 'Amount filters must be positive numbers' });
        if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) return res.status(400).json({ error: 'Minimum amount cannot exceed maximum amount' });

        const requestedLimit = Number.parseInt(req.query?.limit, 10);
        const limit = Number.isFinite(requestedLimit) ? Math.max(10, Math.min(requestedLimit, 300)) : 150;
        const today = businessDate();

        const [borrowersRes, loansRes, emisRes, settlementsRes] = await Promise.all([
            supabaseRequest('borrowers?deleted_at=is.null&select=id,name,father_name,phone,whatsapp,address,aadhaar,pan,photo_url,created_at,updated_at&limit=5000'),
            supabaseRequest('loans?deleted_at=is.null&select=id,borrower_id,loan_code,amount,interest_rate,loan_date,loan_year,end_date,status,created_at,updated_at&limit=5000'),
            supabaseRequest('emis?select=id,loan_id,installment_number,due_date,due_day,due_month,due_year,amount,status,paid_date,paid_amount,created_at&limit=10000'),
            supabaseRequest('loan_settlements?reopened_at=is.null&select=id,loan_id,waived_amount,final_payment_amount,settlement_date&limit=5000')
        ]);

        const borrowers = borrowersRes.data || [];
        const loans = loansRes.data || [];
        const emis = emisRes.data || [];
        const settlements = settlementsRes.data || [];
        const activeSettlementByLoan = new Map(settlements.map(x => [x.loan_id, x]));
        const borrowerById = new Map(borrowers.map(b => [b.id, b]));
        const loanById = new Map(loans.map(l => [l.id, l]));
        const loansByBorrower = new Map();
        const emisByLoan = new Map();

        for (const loan of loans) {
            if (!loansByBorrower.has(loan.borrower_id)) loansByBorrower.set(loan.borrower_id, []);
            loansByBorrower.get(loan.borrower_id).push(loan);
        }
        for (const emi of emis) {
            if (!emisByLoan.has(emi.loan_id)) emisByLoan.set(emi.loan_id, []);
            emisByLoan.get(emi.loan_id).push(emi);
        }

        const results = [];

        if (type === 'all' || type === 'borrower') {
            for (const borrower of borrowers) {
                const relatedLoans = loansByBorrower.get(borrower.id) || [];
                const relatedEmis = relatedLoans.flatMap(l => emisByLoan.get(l.id) || []);
                const states = relatedEmis.map(e => ({ emi: e, loan: loanById.get(e.loan_id), state: emiState(e, today) }));
                const principal = relatedLoans.reduce((sum, l) => sum + safeInt(l.amount), 0);
                const collected = states.reduce((sum, x) => sum + x.state.paid, 0);
                const remaining = relatedLoans.reduce((sum, loan) => {
                    const raw = (emisByLoan.get(loan.id) || []).reduce((a,e) => a + emiState(e,today).remaining, 0);
                    const st = activeSettlementByLoan.get(loan.id);
                    return sum + (st ? Math.max(raw - safeInt(st.waived_amount), 0) : raw);
                }, 0);
                const haystack = searchable(borrower.id, borrower.name, borrower.father_name, borrower.phone, borrower.whatsapp, borrower.address, borrower.aadhaar, borrower.pan, relatedLoans.map(l => l.loan_code));
                if (!matchesQuery(haystack, q)) continue;
                if (loanStatus !== 'all' && !relatedLoans.some(l => l.status === loanStatus)) continue;
                if (emiStatus !== 'all') {
                    const hasStatus = emiStatus === 'year-not-set'
                        ? states.some(x => !x.state.hasKnownDate && x.state.remaining > 0)
                        : states.some(x => x.state.status === emiStatus);
                    if (!hasStatus) continue;
                }
                if (due !== 'all' && !states.some(x => x.loan?.status !== 'closed' && dueMatches(x.state, due, today))) continue;
                if (!amountMatches(principal, minAmount, maxAmount)) continue;

                results.push({
                    type: 'borrower',
                    id: borrower.id,
                    borrower_id: borrower.id,
                    name: borrower.name,
                    father_name: borrower.father_name,
                    phone: borrower.phone,
                    whatsapp: borrower.whatsapp,
                    address: borrower.address,
                    photo_url: borrower.photo_url,
                    total_loans: relatedLoans.length,
                    active_loans: relatedLoans.filter(l => l.status === 'active').length,
                    principal,
                    collected,
                    remaining,
                    overdue_emis: states.filter(x => x.loan?.status !== 'closed' && x.state.status === 'overdue').length,
                    created_at: borrower.created_at,
                    sortAmount: principal,
                    sortDate: null,
                    sortName: norm(borrower.name)
                });
            }
        }

        if (type === 'all' || type === 'loan') {
            for (const loan of loans) {
                const borrower = borrowerById.get(loan.borrower_id) || {};
                const relatedEmis = emisByLoan.get(loan.id) || [];
                const states = relatedEmis.map(e => ({ emi: e, state: emiState(e, today) }));
                const scheduled = states.reduce((sum, x) => sum + safeInt(x.emi.amount), 0);
                const collected = states.reduce((sum, x) => sum + x.state.paid, 0);
                const rawRemaining = states.reduce((sum, x) => sum + x.state.remaining, 0);
                const activeSettlement = activeSettlementByLoan.get(loan.id);
                const remaining = activeSettlement ? Math.max(rawRemaining - safeInt(activeSettlement.waived_amount), 0) : rawRemaining;
                const knownDates = states.map(x => x.state.dueDate).filter(Boolean).sort();
                const haystack = searchable(loan.id, loan.loan_code, loan.amount, loan.loan_year, loan.loan_date, borrower.name, borrower.phone, borrower.whatsapp, borrower.address);
                if (!matchesQuery(haystack, q)) continue;
                if (loanStatus !== 'all' && loan.status !== loanStatus) continue;
                if (emiStatus !== 'all') {
                    const hasStatus = emiStatus === 'year-not-set'
                        ? states.some(x => !x.state.hasKnownDate && x.state.remaining > 0)
                        : states.some(x => x.state.status === emiStatus);
                    if (!hasStatus) continue;
                }
                if (due !== 'all' && (loan.status === 'closed' || !states.some(x => dueMatches(x.state, due, today)))) continue;
                if (!amountMatches(safeInt(loan.amount), minAmount, maxAmount)) continue;

                results.push({
                    type: 'loan',
                    id: loan.id,
                    loan_id: loan.id,
                    borrower_id: loan.borrower_id,
                    borrower_name: borrower.name || 'Unknown',
                    phone: borrower.phone,
                    whatsapp: borrower.whatsapp,
                    loan_code: loan.loan_code,
                    amount: safeInt(loan.amount),
                    interest_rate: loan.interest_rate,
                    loan_date: loan.loan_date,
                    loan_year: loan.loan_year,
                    status: loan.status,
                    emi_count: relatedEmis.length,
                    scheduled,
                    collected,
                    remaining,
                    settlement: activeSettlement || null,
                    overdue_emis: loan.status === 'closed' ? 0 : states.filter(x => x.state.status === 'overdue').length,
                    year_not_set: states.filter(x => !x.state.hasKnownDate && x.state.remaining > 0).length,
                    created_at: loan.created_at,
                    sortAmount: safeInt(loan.amount),
                    sortDate: knownDates[0] || null,
                    sortName: norm(`${borrower.name || ''} ${loan.loan_code || ''}`)
                });
            }
        }

        if (type === 'all' || type === 'emi') {
            for (const emi of emis) {
                const loan = loanById.get(emi.loan_id);
                if (!loan) continue;
                const borrower = borrowerById.get(loan.borrower_id) || {};
                const state = emiState(emi, today);
                const haystack = searchable(
                    emi.id, emi.installment_number, emi.due_date, emi.due_day, emi.due_month, emi.due_year,
                    loan.id, loan.loan_code, borrower.name, borrower.phone, borrower.whatsapp, borrower.address
                );
                if (!matchesQuery(haystack, q)) continue;
                if (loanStatus !== 'all' && loan.status !== loanStatus) continue;
                if (emiStatus !== 'all') {
                    if (emiStatus === 'year-not-set') {
                        if (state.hasKnownDate || state.remaining <= 0) continue;
                    } else if (state.status !== emiStatus) continue;
                }
                if (due !== 'all' && loan.status === 'closed') continue;
                if (!dueMatches(state, due, today)) continue;
                const settled = activeSettlementByLoan.has(loan.id);
                const accountRemaining = settled ? 0 : state.remaining;
                if (!amountMatches(accountRemaining, minAmount, maxAmount)) continue;

                results.push({
                    type: 'emi',
                    id: emi.id,
                    emi_id: emi.id,
                    loan_id: loan.id,
                    borrower_id: loan.borrower_id,
                    borrower_name: borrower.name || 'Unknown',
                    phone: borrower.phone,
                    whatsapp: borrower.whatsapp,
                    loan_code: loan.loan_code,
                    loan_status: loan.status,
                    installment_number: emi.installment_number,
                    due_date: state.dueDate,
                    due_day: emi.due_day,
                    due_month: emi.due_month,
                    due_year: emi.due_year,
                    amount: safeInt(emi.amount),
                    paid_amount: state.paid,
                    remaining: accountRemaining,
                    raw_remaining: state.remaining,
                    settled,
                    status: state.status,
                    paid_date: emi.paid_date,
                    year_not_set: !state.hasKnownDate,
                    created_at: emi.created_at,
                    sortAmount: accountRemaining,
                    sortDate: state.dueDate,
                    sortName: norm(`${borrower.name || ''} ${loan.loan_code || ''} ${emi.installment_number || ''}`)
                });
            }
        }

        results.sort((a, b) => compareResults(a, b, sort));
        const total = results.length;
        const counts = results.reduce((acc, item) => {
            acc[item.type] = (acc[item.type] || 0) + 1;
            return acc;
        }, { borrower: 0, loan: 0, emi: 0 });
        const limited = results.slice(0, limit).map(({ sortAmount, sortDate, sortName, ...item }) => item);

        return res.status(200).json({
            businessDate: today,
            timezone: TIME_ZONE,
            query: q,
            filters: { type, loanStatus, emiStatus, due, minAmount, maxAmount, sort },
            summary: { total, shown: limited.length, ...counts },
            results: limited
        });
    } catch (err) {
        return sendServerError(res, 'Search API Error:', err);
    }
}
