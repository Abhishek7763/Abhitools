import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const TIME_ZONE = 'Asia/Kolkata';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_LOAN_STATUS = new Set(['all', 'active', 'closed', 'defaulted']);

function businessDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function safeDate(value) {
    const v = String(value || '').slice(0, 10);
    return DATE_RE.test(v) ? v : null;
}

function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function defaultFrom(today) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 11, 1);
    return d.toISOString().slice(0, 10);
}

function safeInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
}

function monthKey(iso) { return String(iso || '').slice(0, 7); }

function monthLabel(key) {
    if (!/^\d{4}-\d{2}$/.test(String(key || ''))) return key || '';
    const [year, month] = key.split('-').map(Number);
    return new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(Date.UTC(year, month - 1, 1)));
}

function monthsBetween(from, to) {
    const out = [];
    let [y, m] = from.slice(0, 7).split('-').map(Number);
    const [ty, tm] = to.slice(0, 7).split('-').map(Number);
    let guard = 0;
    while ((y < ty || (y === ty && m <= tm)) && guard < 120) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        m += 1;
        if (m === 13) { m = 1; y += 1; }
        guard += 1;
    }
    return out;
}

function isInRange(date, from, to, allDates) {
    const d = safeDate(date);
    if (!d) return false;
    if (allDates) return true;
    return d >= from && d <= to;
}

function ageDays(dueDate, today) {
    const due = safeDate(dueDate);
    if (!due) return null;
    const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`);
    return Math.floor(ms / 86400000);
}

function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function money(value) { return safeInt(value); }

function buildCsv(report) {
    const rows = [];
    const s = report.summary || {};
    rows.push(['AbhiTools Reports & Analytics']);
    rows.push(['Generated', report.generatedAt || '']);
    rows.push(['Date Range', report.filters?.allDates ? 'All dated records' : `${report.filters?.from || ''} to ${report.filters?.to || ''}`]);
    rows.push(['Borrower', report.filters?.borrowerName || 'All Borrowers']);
    rows.push(['Loan Status', report.filters?.loanStatus || 'all']);
    rows.push([]);
    rows.push(['Summary', 'Value']);
    rows.push(['Current Portfolio Principal', s.portfolioPrincipal || 0]);
    rows.push(['Current Scheduled EMI', s.scheduledTotal || 0]);
    rows.push(['Current Collected', s.collectedTotal || 0]);
    rows.push(['Current Outstanding', s.outstandingTotal || 0]);
    rows.push(['Current Overdue', s.overdueAmount || 0]);
    rows.push(['Period Disbursed', s.periodDisbursedAmount || 0]);
    rows.push(['Period Collections', s.periodCollectionAmount || 0]);
    rows.push(['Period Settlement Payment', s.periodSettlementPayment || 0]);
    rows.push(['Period Waived', s.periodWaivedAmount || 0]);
    rows.push(['Recovery Rate %', s.recoveryRate || 0]);
    rows.push([]);
    rows.push(['Monthly', 'Loans', 'Disbursed', 'Payments', 'Collected', 'Settlements', 'Settlement Payment', 'Waived']);
    for (const item of report.monthly || []) {
        rows.push([item.label, item.loanCount, item.disbursed, item.paymentCount, item.collected, item.settlementCount, item.settlementPayment, item.waived]);
    }
    rows.push([]);
    rows.push(['Borrower Performance', 'Loans', 'Principal', 'Collected', 'Outstanding', 'Overdue']);
    for (const b of report.borrowers || []) {
        rows.push([b.name, b.loanCount, b.principal, b.collected, b.outstanding, b.overdue]);
    }
    rows.push([]);
    rows.push(['Aging', 'EMIs', 'Amount']);
    for (const a of report.aging || []) rows.push([a.label, a.count, a.amount]);
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export default async function reportsHandler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const today = businessDate();
    const allDates = String(req.query?.all || '') === '1';
    const from = safeDate(req.query?.from) || defaultFrom(today);
    const to = safeDate(req.query?.to) || today;
    const borrowerId = String(req.query?.borrower_id || '').trim();
    const loanStatus = VALID_LOAN_STATUS.has(String(req.query?.loan_status || '').toLowerCase())
        ? String(req.query.loan_status).toLowerCase() : 'all';
    const format = String(req.query?.format || 'json').toLowerCase();

    if (!allDates && from > to) return res.status(400).json({ error: 'From date cannot be after To date' });

    try {
        await supabaseRequest('rpc/abhi_refresh_due_statuses', 'POST', {});
        const [borrowersRes, loansRes, emisRes, paymentsRes, settlementsRes] = await Promise.all([
            supabaseRequest('borrowers?deleted_at=is.null&select=id,name,phone&order=name.asc&limit=5000'),
            supabaseRequest('loans?deleted_at=is.null&select=id,borrower_id,loan_code,amount,status,loan_date,loan_year,created_at&limit=5000'),
            supabaseRequest('emis?select=id,loan_id,amount,paid_amount,status,due_date,due_year,due_day,due_month,installment_number&limit=10000'),
            supabaseRequest('emi_payments?reversed_at=is.null&select=id,emi_id,amount,payment_date,method,source&limit=20000'),
            supabaseRequest('loan_settlements?select=id,loan_id,settlement_date,scheduled_remaining_before,final_payment_amount,waived_amount,reopened_at&limit=5000')
        ]);

        const borrowers = borrowersRes.data || [];
        const borrowerById = new Map(borrowers.map(b => [b.id, b]));
        const selectedBorrower = borrowerId ? borrowerById.get(borrowerId) : null;
        if (borrowerId && !selectedBorrower) return res.status(404).json({ error: 'Borrower not found' });

        const allLoans = loansRes.data || [];
        const loans = allLoans.filter(loan => {
            if (borrowerId && loan.borrower_id !== borrowerId) return false;
            if (loanStatus !== 'all' && String(loan.status || 'active') !== loanStatus) return false;
            return true;
        });
        const loanById = new Map(loans.map(l => [l.id, l]));
        const loanIds = new Set(loans.map(l => l.id));

        const emis = (emisRes.data || []).filter(e => loanIds.has(e.loan_id));
        const emiById = new Map(emis.map(e => [e.id, e]));
        const payments = (paymentsRes.data || []).filter(p => emiById.has(p.emi_id));
        const settlements = (settlementsRes.data || []).filter(s => loanIds.has(s.loan_id));

        const summary = {
            portfolioLoans: loans.length,
            portfolioBorrowers: new Set(loans.map(l => l.borrower_id).filter(Boolean)).size,
            portfolioPrincipal: 0,
            scheduledTotal: 0,
            collectedTotal: 0,
            outstandingTotal: 0,
            overdueAmount: 0,
            periodDisbursedLoans: 0,
            periodDisbursedAmount: 0,
            periodPaymentCount: 0,
            periodCollectionAmount: 0,
            periodSettlementCount: 0,
            periodSettlementPayment: 0,
            periodWaivedAmount: 0,
            yearNotSetCount: 0,
            yearNotSetAmount: 0,
            recoveryRate: 0
        };

        const loanStatusCounts = { active:0, closed:0, defaulted:0 };
        for (const loan of loans) {
            const amount = money(loan.amount);
            summary.portfolioPrincipal += amount;
            const status = ['active','closed','defaulted'].includes(loan.status) ? loan.status : 'active';
            loanStatusCounts[status] += 1;
            if (isInRange(loan.loan_date, from, to, allDates)) {
                summary.periodDisbursedLoans += 1;
                summary.periodDisbursedAmount += amount;
            }
        }

        const emiStatusCounts = { pending:0, partial:0, paid:0, overdue:0 };
        const borrowerAgg = new Map();
        for (const loan of loans) {
            const b = borrowerById.get(loan.borrower_id) || { id:loan.borrower_id, name:'Unknown Borrower' };
            if (!borrowerAgg.has(loan.borrower_id)) borrowerAgg.set(loan.borrower_id, {
                id:loan.borrower_id, name:b.name || 'Unknown Borrower', loanCount:0, principal:0, collected:0, outstanding:0, overdue:0
            });
            const agg = borrowerAgg.get(loan.borrower_id);
            agg.loanCount += 1;
            agg.principal += money(loan.amount);
        }

        const agingMap = new Map([
            ['not_due', { key:'not_due', label:'Not Due / Current', count:0, amount:0 }],
            ['1_30', { key:'1_30', label:'1–30 Days Overdue', count:0, amount:0 }],
            ['31_60', { key:'31_60', label:'31–60 Days Overdue', count:0, amount:0 }],
            ['61_90', { key:'61_90', label:'61–90 Days Overdue', count:0, amount:0 }],
            ['90_plus', { key:'90_plus', label:'90+ Days Overdue', count:0, amount:0 }],
            ['year_not_set', { key:'year_not_set', label:'Year / Due Date Not Set', count:0, amount:0 }]
        ]);

        for (const emi of emis) {
            const loan = loanById.get(emi.loan_id);
            const amount = money(emi.amount);
            const paid = Math.max(0, Math.min(money(emi.paid_amount), amount));
            const remaining = Math.max(amount - paid, 0);
            summary.scheduledTotal += amount;
            summary.collectedTotal += paid;

            let status = String(emi.status || 'pending');
            if (amount > 0 && paid >= amount) status = 'paid';
            else if (status !== 'overdue' && paid > 0) status = 'partial';
            if (!(status in emiStatusCounts)) status = 'pending';
            emiStatusCounts[status] += 1;

            const isClosed = String(loan?.status || '') === 'closed';
            if (!isClosed) summary.outstandingTotal += remaining;
            if (!isClosed && status === 'overdue') summary.overdueAmount += remaining;
            if (!isClosed && remaining > 0 && (!emi.due_date || !emi.due_year)) {
                summary.yearNotSetCount += 1;
                summary.yearNotSetAmount += remaining;
            }

            const agg = borrowerAgg.get(loan?.borrower_id);
            if (agg) {
                agg.collected += paid;
                if (!isClosed) agg.outstanding += remaining;
                if (!isClosed && status === 'overdue') agg.overdue += remaining;
            }

            if (isClosed || remaining <= 0) continue;
            if (!emi.due_date || !emi.due_year) {
                const bucket = agingMap.get('year_not_set'); bucket.count += 1; bucket.amount += remaining; continue;
            }
            const days = ageDays(emi.due_date, today);
            let key = 'not_due';
            if (days > 90) key = '90_plus';
            else if (days > 60) key = '61_90';
            else if (days > 30) key = '31_60';
            else if (days > 0) key = '1_30';
            const bucket = agingMap.get(key); bucket.count += 1; bucket.amount += remaining;
        }

        summary.recoveryRate = summary.scheduledTotal > 0
            ? Math.round((summary.collectedTotal / summary.scheduledTotal) * 1000) / 10 : 0;

        const methodMap = new Map();
        for (const p of payments) {
            if (!isInRange(p.payment_date, from, to, allDates)) continue;
            const amount = money(p.amount);
            summary.periodPaymentCount += 1;
            summary.periodCollectionAmount += amount;
            const method = String(p.method || 'Not specified').trim() || 'Not specified';
            const row = methodMap.get(method) || { method, count:0, amount:0 };
            row.count += 1; row.amount += amount; methodMap.set(method, row);
        }

        for (const s of settlements) {
            if (s.reopened_at || !isInRange(s.settlement_date, from, to, allDates)) continue;
            summary.periodSettlementCount += 1;
            summary.periodSettlementPayment += money(s.final_payment_amount);
            summary.periodWaivedAmount += money(s.waived_amount);
        }

        let monthKeys;
        if (allDates) {
            const keys = new Set();
            for (const l of loans) if (safeDate(l.loan_date)) keys.add(monthKey(l.loan_date));
            for (const p of payments) if (safeDate(p.payment_date)) keys.add(monthKey(p.payment_date));
            for (const s of settlements) if (!s.reopened_at && safeDate(s.settlement_date)) keys.add(monthKey(s.settlement_date));
            monthKeys = [...keys].filter(k => /^\d{4}-\d{2}$/.test(k)).sort();
            if (monthKeys.length > 36) monthKeys = monthKeys.slice(-36);
        } else {
            monthKeys = monthsBetween(from, to);
            if (monthKeys.length > 36) monthKeys = monthKeys.slice(-36);
        }
        const monthlyMap = new Map(monthKeys.map(k => [k, {
            key:k, label:monthLabel(k), loanCount:0, disbursed:0, paymentCount:0, collected:0, settlementCount:0, settlementPayment:0, waived:0
        }]));
        for (const l of loans) {
            const k = monthKey(l.loan_date); const row = monthlyMap.get(k);
            if (row && isInRange(l.loan_date, from, to, allDates)) { row.loanCount += 1; row.disbursed += money(l.amount); }
        }
        for (const p of payments) {
            const k = monthKey(p.payment_date); const row = monthlyMap.get(k);
            if (row && isInRange(p.payment_date, from, to, allDates)) { row.paymentCount += 1; row.collected += money(p.amount); }
        }
        for (const s of settlements) {
            if (s.reopened_at) continue;
            const k = monthKey(s.settlement_date); const row = monthlyMap.get(k);
            if (row && isInRange(s.settlement_date, from, to, allDates)) {
                row.settlementCount += 1; row.settlementPayment += money(s.final_payment_amount); row.waived += money(s.waived_amount);
            }
        }

        const report = {
            businessDate: today,
            timezone: TIME_ZONE,
            generatedAt: new Date().toISOString(),
            filters: {
                allDates, from: allDates ? null : from, to: allDates ? null : to,
                borrowerId: borrowerId || null,
                borrowerName: selectedBorrower?.name || null,
                loanStatus
            },
            summary,
            loanStatus: loanStatusCounts,
            emiStatus: emiStatusCounts,
            aging: [...agingMap.values()],
            paymentMethods: [...methodMap.values()].sort((a,b) => b.amount - a.amount),
            monthly: [...monthlyMap.values()],
            borrowers: [...borrowerAgg.values()].sort((a,b) => b.outstanding - a.outstanding || b.principal - a.principal).slice(0, 50),
            borrowersAvailable: borrowers.map(b => ({ id:b.id, name:b.name || 'Unnamed' }))
        };

        if (format === 'csv') {
            const csv = buildCsv(report);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="AbhiTools_Report_${today}.csv"`);
            return res.status(200).send('\uFEFF' + csv);
        }
        return res.status(200).json(report);
    } catch (err) {
        return sendServerError(res, 'Reports API Error:', err);
    }
}
