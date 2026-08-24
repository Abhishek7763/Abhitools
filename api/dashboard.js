import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';
import calendarHandler from '../server_routes/calendar.js';
import searchHandler from '../server_routes/search.js';
import activityHandler from '../server_routes/activity.js';
import reportsHandler from '../server_routes/reports.js';
import remindersHandler from '../server_routes/reminders.js';

const TIME_ZONE = 'Asia/Kolkata';

function businessDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function monthKey(iso) {
    return String(iso || '').slice(0, 7);
}

function shiftMonth(isoDate, offset) {
    const [year, month] = String(isoDate).slice(0, 10).split('-').map(Number);
    const d = new Date(Date.UTC(year, (month - 1) + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
    const [year, month] = key.split('-').map(Number);
    return new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' })
        .format(new Date(Date.UTC(year, month - 1, 1)));
}

function safeInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
    const mode = String(req.query?.mode || '').toLowerCase();
    if (mode === 'calendar') return calendarHandler(req, res);
    if (mode === 'search') return searchHandler(req, res);
    if (mode === 'activity') return activityHandler(req, res);
    if (mode === 'reports') return reportsHandler(req, res);
    if (mode === 'reminders') return remindersHandler(req, res);
    noStore(res);
    if (!requireAdmin(req, res)) return;
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Keep overdue statuses current before calculating aggregates.
        await supabaseRequest('rpc/abhi_refresh_due_statuses', 'POST', {});

        const [loansRes, emisRes, paymentsRes] = await Promise.all([
            supabaseRequest('loans?deleted_at=is.null&select=id,amount,status,loan_date,loan_year'),
            supabaseRequest('emis?select=id,loan_id,amount,paid_amount,status,due_date,due_year'),
            supabaseRequest('emi_payments?select=emi_id,amount,payment_date&reversed_at=is.null')
        ]);

        const loans = loansRes.data || [];
        const emis = emisRes.data || [];
        const payments = paymentsRes.data || [];
        const today = businessDate();
        const currentMonth = monthKey(today);
        const loanStatusById = new Map(loans.map(l => [l.id, l.status || 'active']));

        const loanStatus = { active: 0, closed: 0, defaulted: 0 };
        let totalLent = 0;
        let activePrincipal = 0;
        let thisMonthLent = 0;
        for (const loan of loans) {
            const amount = safeInt(loan.amount);
            totalLent += amount;
            const status = ['active', 'closed', 'defaulted'].includes(loan.status) ? loan.status : 'active';
            loanStatus[status] += 1;
            if (status === 'active') activePrincipal += amount;
            if (monthKey(loan.loan_date) === currentMonth) thisMonthLent += amount;
        }

        const emiStatus = { pending: 0, partial: 0, paid: 0, overdue: 0 };
        let scheduledTotal = 0;
        let collectedTotal = 0;
        let outstandingTotal = 0;
        let overdueAmount = 0;
        let yearNotSetCount = 0;
        let yearNotSetAmount = 0;

        const visibleEmiIds = new Set();
        for (const emi of emis) {
            if (!loanStatusById.has(emi.loan_id)) continue;
            visibleEmiIds.add(emi.id);
            const amount = safeInt(emi.amount);
            const paid = Math.max(0, Math.min(safeInt(emi.paid_amount), amount));
            const remaining = Math.max(amount - paid, 0);
            const parentStatus = loanStatusById.get(emi.loan_id) || 'active';
            scheduledTotal += amount;
            collectedTotal += paid;

            let status = emi.status || 'pending';
            if (paid >= amount && amount > 0) status = 'paid';
            else if (paid > 0 && status !== 'overdue') status = 'partial';
            if (!emiStatus[status] && emiStatus[status] !== 0) status = 'pending';
            emiStatus[status] += 1;

            if (parentStatus !== 'closed') outstandingTotal += remaining;
            if (parentStatus !== 'closed' && status === 'overdue' && remaining > 0) overdueAmount += remaining;
            if (parentStatus !== 'closed' && (!emi.due_date || !emi.due_year)) {
                yearNotSetCount += 1;
                yearNotSetAmount += remaining;
            }
        }

        let todayCollected = 0;
        let monthCollected = 0;
        const last6Keys = Array.from({ length: 6 }, (_, i) => shiftMonth(today, i - 5));
        const trendMap = new Map(last6Keys.map(k => [k, 0]));
        for (const payment of payments) {
            if (!visibleEmiIds.has(payment.emi_id)) continue;
            const amount = safeInt(payment.amount);
            const pDate = String(payment.payment_date || '').slice(0, 10);
            if (pDate === today) todayCollected += amount;
            if (monthKey(pDate) === currentMonth) monthCollected += amount;
            const key = monthKey(pDate);
            if (trendMap.has(key)) trendMap.set(key, trendMap.get(key) + amount);
        }

        const recoveryRate = scheduledTotal > 0 ? Math.round((collectedTotal / scheduledTotal) * 1000) / 10 : 0;

        return res.status(200).json({
            businessDate: today,
            timezone: TIME_ZONE,
            money: {
                totalLent,
                activePrincipal,
                scheduledTotal,
                collectedTotal,
                outstandingTotal,
                overdueAmount,
                todayCollected,
                monthCollected,
                thisMonthLent,
                recoveryRate
            },
            loans: { total: loans.length, ...loanStatus },
            emis: { total: emis.length, ...emiStatus },
            legacy: { yearNotSetCount, yearNotSetAmount },
            collectionTrend: last6Keys.map(key => ({
                key,
                label: monthLabel(key),
                amount: trendMap.get(key) || 0
            }))
        });
    } catch (err) {
        return sendServerError(res, 'Dashboard API Error:', err);
    }
}
