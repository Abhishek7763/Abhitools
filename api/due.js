import { isValidAdminSession, noStore, sendServerError, supabaseRequest } from '../server_shared.js';

const TIME_ZONE = 'Asia/Kolkata';
const DUE_REFRESH_COOLDOWN_MS = 60 * 1000;

// Warm serverless instances remember only that the date-status refresh ran recently.
// No borrower, loan, EMI, payment or other financial data is cached here.
let dueRefreshState = { businessDate: '', refreshedAt: 0 };
let dueRefreshInFlight = null;

function indiaBusinessDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

async function refreshDueStatusesSmoothly() {
    const now = Date.now();
    const localBusinessDate = indiaBusinessDate();
    const refreshStillFresh = dueRefreshState.businessDate === localBusinessDate
        && (now - dueRefreshState.refreshedAt) < DUE_REFRESH_COOLDOWN_MS;

    if (refreshStillFresh) {
        return {
            business_date: localBusinessDate,
            updated_count: 0,
            refresh_mode: 'cooldown'
        };
    }

    if (dueRefreshInFlight) {
        const shared = await dueRefreshInFlight;
        return {
            ...shared,
            updated_count: 0,
            refresh_mode: 'coalesced'
        };
    }

    dueRefreshInFlight = (async () => {
        const refresh = await supabaseRequest('rpc/abhi_refresh_due_statuses', 'POST', {});
        const refreshData = Array.isArray(refresh.data) ? (refresh.data[0] || {}) : (refresh.data || {});
        const businessDate = String(refreshData.business_date || localBusinessDate);
        dueRefreshState = { businessDate, refreshedAt: Date.now() };
        return {
            business_date: businessDate,
            updated_count: Number(refreshData.updated_count || 0),
            refresh_mode: 'fresh'
        };
    })();

    try {
        return await dueRefreshInFlight;
    } finally {
        dueRefreshInFlight = null;
    }
}

function dateAdd(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function monthKey(iso) {
    return String(iso || '').slice(0, 7);
}

function remainingAmount(emi) {
    const amount = Number.parseInt(emi?.amount, 10) || 0;
    const paid = Math.max(0, Math.min(Number.parseInt(emi?.paid_amount, 10) || 0, amount));
    return Math.max(amount - paid, 0);
}

function summarize(items) {
    return {
        count: items.length,
        amount: items.reduce((sum, item) => sum + (Number.parseInt(item.remaining, 10) || 0), 0)
    };
}

// Intentional public read endpoint: the public dashboard uses this unauthenticated GET
// to show borrower names and due amounts. Do not add an admin-login requirement here
// unless the public dues UX is deliberately redesigned. Admin sessions only add IDs.
export default async function handler(req, res) {
    noStore(res);
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const refreshStarted = Date.now();
        const refreshData = await refreshDueStatusesSmoothly();
        const refreshDuration = Date.now() - refreshStarted;
        const businessDate = String(refreshData.business_date || indiaBusinessDate());
        const tomorrow = dateAdd(businessDate, 1);
        const next7End = dateAdd(businessDate, 6);
        const thisMonth = monthKey(businessDate);

        const queryStarted = Date.now();
        const { data } = await supabaseRequest(
            'loans?deleted_at=is.null&status=eq.active&select=id,loan_code,borrowers(name),emis(id,installment_number,due_date,due_day,due_month,due_year,amount,status,paid_amount)&order=created_at.desc'
        );
        const queryDuration = Date.now() - queryStarted;

        res.setHeader('X-Abhi-Due-Refresh', String(refreshData.refresh_mode || 'fresh'));
        res.setHeader('Server-Timing', `due-refresh;dur=${refreshDuration}, due-query;dur=${queryDuration}`);

        const isAdmin = isValidAdminSession(req);
        const all = [];
        let unknownYearCount = 0;
        let unknownYearAmount = 0;

        for (const loan of (data || [])) {
            for (const emi of (loan.emis || [])) {
                const remaining = remainingAmount(emi);
                if (remaining <= 0) continue;
                if (!emi.due_date || !emi.due_year) {
                    unknownYearCount += 1;
                    unknownYearAmount += remaining;
                    continue;
                }

                const base = {
                    loan_code: loan.loan_code,
                    borrower_name: loan.borrowers?.name || 'Unknown',
                    installment_number: emi.installment_number,
                    due_date: String(emi.due_date).slice(0, 10),
                    due_day: emi.due_day,
                    due_month: emi.due_month,
                    due_year: emi.due_year,
                    amount: Number.parseInt(emi.amount, 10) || 0,
                    paid_amount: Number.parseInt(emi.paid_amount, 10) || 0,
                    remaining,
                    status: emi.status || 'pending'
                };
                if (isAdmin) {
                    base.emi_id = emi.id;
                    base.loan_id = loan.id;
                }
                all.push(base);
            }
        }

        all.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.borrower_name.localeCompare(b.borrower_name));
        const overdue = all.filter(x => x.due_date < businessDate);
        const today = all.filter(x => x.due_date === businessDate);
        const tomorrowItems = all.filter(x => x.due_date === tomorrow);
        const next7 = all.filter(x => x.due_date >= businessDate && x.due_date <= next7End);
        const month = all.filter(x => monthKey(x.due_date) === thisMonth);

        return res.status(200).json({
            businessDate,
            timezone: TIME_ZONE,
            refreshed: Number(refreshData.updated_count || 0),
            refreshMode: refreshData.refresh_mode || 'fresh',
            summary: {
                overdue: summarize(overdue),
                today: summarize(today),
                tomorrow: summarize(tomorrowItems),
                next7: summarize(next7),
                month: summarize(month),
                yearNotSet: { count: unknownYearCount, amount: unknownYearAmount }
            },
            buckets: {
                overdue,
                today,
                tomorrow: tomorrowItems,
                next7,
                month
            }
        });
    } catch (err) {
        return sendServerError(res, 'Due API Error:', err);
    }
}
