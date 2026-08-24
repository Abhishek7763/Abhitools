import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const TIME_ZONE = 'Asia/Kolkata';
const MONTH_RE = /^(20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/;

function businessDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function safeInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
}

function monthBounds(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = new Date(Date.UTC(year, month, 1));
    const endExclusive = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const last = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
    return { start, endExclusive, last };
}

function displayState(emi, today) {
    const amount = safeInt(emi.amount);
    const paid = Math.max(0, Math.min(safeInt(emi.paid_amount), amount));
    if (amount > 0 && paid >= amount) return 'paid';
    if (emi.due_date && String(emi.due_date).slice(0, 10) < today) return paid > 0 ? 'partial-overdue' : 'overdue';
    if (paid > 0) return 'partial';
    return 'pending';
}

function ensureDay(days, date) {
    if (!days[date]) {
        days[date] = {
            date,
            due: [],
            payments: [],
            totals: {
                scheduled: 0,
                remaining: 0,
                collected: 0,
                overdueRemaining: 0,
                dueCount: 0,
                paymentCount: 0
            }
        };
    }
    return days[date];
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

        const today = businessDate();
        const requestedMonth = String(req.query?.month || today.slice(0, 7));
        if (!MONTH_RE.test(requestedMonth)) {
            return res.status(400).json({ error: 'month must be YYYY-MM between 2000-01 and 2200-12' });
        }
        const bounds = monthBounds(requestedMonth);

        const [loansRes, emisRes, paymentsRes] = await Promise.all([
            supabaseRequest('loans?deleted_at=is.null&select=id,borrower_id,loan_code,status,borrowers(id,name,phone,whatsapp)'),
            supabaseRequest('emis?select=id,loan_id,installment_number,due_date,due_day,due_month,due_year,amount,status,paid_date,paid_amount'),
            supabaseRequest(`emi_payments?reversed_at=is.null&payment_date=gte.${bounds.start}&payment_date=lt.${bounds.endExclusive}&select=id,emi_id,amount,payment_date,method,notes,source&order=payment_date.asc`)
        ]);

        const loans = loansRes.data || [];
        const emis = emisRes.data || [];
        const payments = paymentsRes.data || [];
        const loanById = new Map(loans.map(l => [l.id, l]));
        const emiById = new Map(emis.map(e => [e.id, e]));
        const days = {};

        let unknownYearCount = 0;
        let unknownYearAmount = 0;
        let monthlyScheduled = 0;
        let monthlyRemaining = 0;
        let monthlyOverdue = 0;
        let monthlyCollected = 0;
        let monthlyDueCount = 0;
        let monthlyPaymentCount = 0;

        for (const emi of emis) {
            const loan = loanById.get(emi.loan_id);
            if (!loan || loan.status === 'closed') continue;
            const amount = safeInt(emi.amount);
            const paid = Math.max(0, Math.min(safeInt(emi.paid_amount), amount));
            const remaining = Math.max(amount - paid, 0);
            if (!emi.due_year || !emi.due_date) {
                if (remaining > 0) {
                    unknownYearCount += 1;
                    unknownYearAmount += remaining;
                }
                continue;
            }

            const dueDate = String(emi.due_date).slice(0, 10);
            if (!dueDate.startsWith(`${requestedMonth}-`)) continue;
            const state = displayState(emi, today);
            const overdueRemaining = (dueDate < today && remaining > 0) ? remaining : 0;
            const borrower = loan.borrowers || {};
            const item = {
                emi_id: emi.id,
                loan_id: loan.id,
                borrower_id: loan.borrower_id || borrower.id || null,
                borrower_name: borrower.name || 'Unknown',
                phone: borrower.phone || null,
                whatsapp: borrower.whatsapp || borrower.phone || null,
                loan_code: loan.loan_code,
                loan_status: loan.status || 'active',
                installment_number: emi.installment_number,
                due_date: dueDate,
                amount,
                paid_amount: paid,
                remaining,
                status: state
            };
            const day = ensureDay(days, dueDate);
            day.due.push(item);
            day.totals.scheduled += amount;
            day.totals.remaining += remaining;
            day.totals.overdueRemaining += overdueRemaining;
            day.totals.dueCount += 1;
            monthlyScheduled += amount;
            monthlyRemaining += remaining;
            monthlyOverdue += overdueRemaining;
            monthlyDueCount += 1;
        }

        for (const payment of payments) {
            const paymentDate = String(payment.payment_date || '').slice(0, 10);
            if (!paymentDate) continue;
            const emi = emiById.get(payment.emi_id);
            const loan = emi ? loanById.get(emi.loan_id) : null;
            if (!loan) continue;
            const borrower = loan.borrowers || {};
            const amount = safeInt(payment.amount);
            const item = {
                payment_id: payment.id,
                emi_id: payment.emi_id,
                loan_id: loan?.id || null,
                borrower_id: loan?.borrower_id || borrower.id || null,
                borrower_name: borrower.name || 'Unknown',
                loan_code: loan?.loan_code || '-',
                installment_number: emi?.installment_number || null,
                payment_date: paymentDate,
                amount,
                method: payment.method || null,
                notes: payment.notes || null,
                source: payment.source || 'manual'
            };
            const day = ensureDay(days, paymentDate);
            day.payments.push(item);
            day.totals.collected += amount;
            day.totals.paymentCount += 1;
            monthlyCollected += amount;
            monthlyPaymentCount += 1;
        }

        for (const day of Object.values(days)) {
            day.due.sort((a, b) => a.borrower_name.localeCompare(b.borrower_name) || a.installment_number - b.installment_number);
            day.payments.sort((a, b) => a.borrower_name.localeCompare(b.borrower_name));
        }

        return res.status(200).json({
            businessDate: today,
            timezone: TIME_ZONE,
            month: requestedMonth,
            bounds,
            summary: {
                scheduled: monthlyScheduled,
                remaining: monthlyRemaining,
                collected: monthlyCollected,
                overdueRemaining: monthlyOverdue,
                dueCount: monthlyDueCount,
                paymentCount: monthlyPaymentCount,
                yearNotSetCount: unknownYearCount,
                yearNotSetAmount: unknownYearAmount
            },
            days
        });
    } catch (err) {
        return sendServerError(res, 'Calendar API Error:', err);
    }
}
