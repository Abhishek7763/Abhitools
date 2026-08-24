import { isValidAdminSession, noStore, sendServerError, supabaseRequest } from '../server_shared.js';

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

export default async function handler(req, res) {
    noStore(res);
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const refresh = await supabaseRequest('rpc/abhi_refresh_due_statuses', 'POST', {});
        const refreshData = Array.isArray(refresh.data) ? (refresh.data[0] || {}) : (refresh.data || {});
        const businessDate = String(refreshData.business_date || new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date()));
        const tomorrow = dateAdd(businessDate, 1);
        const next7End = dateAdd(businessDate, 6);
        const thisMonth = monthKey(businessDate);

        const { data } = await supabaseRequest(
            'loans?deleted_at=is.null&status=eq.active&select=id,loan_code,status,borrowers(name),emis(id,installment_number,due_date,due_day,due_month,due_year,amount,status,paid_date,paid_amount)&order=created_at.desc'
        );

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
            timezone: 'Asia/Kolkata',
            refreshed: Number(refreshData.updated_count || 0),
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
