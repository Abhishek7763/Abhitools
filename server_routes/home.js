import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const TIME_ZONE = 'Asia/Kolkata';

function businessDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function dateInZone(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function monthKey(value) { return String(value || '').slice(0, 7); }
function safeInt(value) { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? n : 0; }
function remainingFor(emi) {
    const amount = Math.max(0, safeInt(emi.amount));
    const paid = Math.max(0, Math.min(safeInt(emi.paid_amount), amount));
    return { amount, paid, remaining: Math.max(amount - paid, 0) };
}

function actionCategory(action = '', table = '') {
    const a = String(action).toUpperCase();
    const t = String(table).toLowerCase();
    if (a === 'LEGACY_DATE_CLEANUP' || a.includes('DATA_QUALITY')) return 'quality';
    if (a.includes('APP_SETTINGS') || t === 'app_settings') return 'settings';
    if (a.includes('REMINDER')) return 'reminder';
    if (a.includes('PAYMENT') || t === 'emi_payments') return 'payment';
    if (a.includes('RECYCLE') || a.includes('PURGE') || t === 'recycle_bin') return 'recycle';
    if (a.includes('BACKUP') || a.includes('IMPORT') || t === 'backup_snapshots') return 'safety';
    if (a.includes('DOCUMENT') || a.includes('PHOTO') || t === 'documents') return 'document';
    if (a.includes('BORROWER') || t === 'borrowers') return 'borrower';
    if (a.includes('LOAN') || a.includes('SETTLE') || t === 'loans' || t === 'loan_settlements') return 'loan';
    return 'system';
}

function priorityRank(dueDate, today, partial) {
    if (!dueDate) return 0;
    if (dueDate < today) return 500;
    if (dueDate === today) return 400;
    const diff = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (diff === 1) return 300;
    if (diff >= 2 && diff <= 7) return partial ? 250 : 200;
    return 0;
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
        const currentMonth = monthKey(today);
        const [borrowersRes, loansRes, emisRes, paymentsRes, activityRes, contactedRes, recycleRes, backupRes] = await Promise.all([
            supabaseRequest('borrowers?deleted_at=is.null&select=id,name,phone,whatsapp'),
            supabaseRequest('loans?deleted_at=is.null&select=id,borrower_id,loan_code,status,amount'),
            supabaseRequest('emis?select=id,loan_id,installment_number,due_date,due_year,amount,paid_amount,status'),
            supabaseRequest('emi_payments?reversed_at=is.null&select=emi_id,amount,payment_date'),
            supabaseRequest('activity_log?select=id,action,table_name,record_id,description,created_at&order=created_at.desc&limit=8'),
            supabaseRequest('activity_log?action=eq.CONTACT_REMINDER&select=record_id,created_at&order=created_at.desc&limit=2000'),
            supabaseRequest('recycle_bin?restored_at=is.null&purged_at=is.null&select=id'),
            supabaseRequest('backup_snapshots?select=id,label,reason,created_at&order=created_at.desc&limit=1')
        ]);

        const borrowers = borrowersRes.data || [];
        const loans = loansRes.data || [];
        const emis = emisRes.data || [];
        const payments = paymentsRes.data || [];
        const borrowerById = new Map(borrowers.map(x => [x.id, x]));
        const loanById = new Map(loans.map(x => [x.id, x]));
        const activeLoanIds = new Set(loans.filter(x => x.status !== 'closed').map(x => x.id));
        const visibleEmiIds = new Set();

        const contactedToday = new Set();
        for (const row of contactedRes.data || []) {
            if (row.record_id && dateInZone(row.created_at) === today) contactedToday.add(row.record_id);
        }

        let scheduledTotal = 0;
        let collectedScheduled = 0;
        let outstanding = 0;
        let overdueCount = 0;
        let overdueAmount = 0;
        let todayCount = 0;
        let todayAmount = 0;
        let tomorrowCount = 0;
        let tomorrowAmount = 0;
        let next7Count = 0;
        let next7Amount = 0;
        let legacyMissingDates = 0;
        let missingContactUrgent = 0;
        let contactedUrgent = 0;
        const priorityItems = [];

        for (const emi of emis) {
            const loan = loanById.get(emi.loan_id);
            if (!loan) continue;
            visibleEmiIds.add(emi.id);
            const { amount, paid, remaining } = remainingFor(emi);
            scheduledTotal += amount;
            collectedScheduled += paid;
            if (loan.status !== 'closed') outstanding += remaining;
            if (loan.status === 'closed' || remaining <= 0) continue;
            if (!emi.due_year || !emi.due_date) {
                legacyMissingDates += 1;
                continue;
            }

            const dueDate = String(emi.due_date).slice(0, 10);
            const rank = priorityRank(dueDate, today, paid > 0 && remaining > 0);
            if (!rank) continue;
            const borrower = borrowerById.get(loan.borrower_id) || {};
            const hasContact = Boolean(String(borrower.whatsapp || borrower.phone || '').trim());
            const wasContacted = contactedToday.has(emi.id);
            const diff = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

            if (dueDate < today) { overdueCount += 1; overdueAmount += remaining; }
            if (dueDate === today) { todayCount += 1; todayAmount += remaining; }
            if (diff === 1) { tomorrowCount += 1; tomorrowAmount += remaining; }
            if (diff >= 0 && diff <= 7) { next7Count += 1; next7Amount += remaining; }
            if (rank >= 400) {
                if (wasContacted) contactedUrgent += 1;
                else if (!hasContact) missingContactUrgent += 1;
            }

            priorityItems.push({
                emi_id: emi.id,
                loan_id: loan.id,
                borrower_id: loan.borrower_id,
                borrower_name: borrower.name || 'Borrower',
                phone: borrower.phone || null,
                whatsapp: borrower.whatsapp || null,
                loan_code: loan.loan_code || '',
                installment_number: emi.installment_number,
                due_date: dueDate,
                amount,
                paid,
                remaining,
                status: emi.status || 'pending',
                contacted_today: wasContacted,
                has_contact: hasContact,
                priority_rank: rank
            });
        }

        priorityItems.sort((a, b) => b.priority_rank - a.priority_rank || a.due_date.localeCompare(b.due_date) || a.borrower_name.localeCompare(b.borrower_name));

        let todayCollected = 0;
        let monthCollected = 0;
        for (const payment of payments) {
            if (!visibleEmiIds.has(payment.emi_id)) continue;
            const amount = Math.max(0, safeInt(payment.amount));
            const pDate = String(payment.payment_date || '').slice(0, 10);
            if (pDate === today) todayCollected += amount;
            if (monthKey(pDate) === currentMonth) monthCollected += amount;
        }

        const recoveryRate = scheduledTotal > 0 ? Math.round((collectedScheduled / scheduledTotal) * 1000) / 10 : 0;
        const recentActivity = (activityRes.data || []).map(row => ({
            id: row.id,
            action: row.action,
            category: actionCategory(row.action, row.table_name),
            description: row.description || '',
            created_at: row.created_at
        }));

        return res.status(200).json({
            businessDate: today,
            timezone: TIME_ZONE,
            summary: {
                borrowers: borrowers.length,
                activeLoans: activeLoanIds.size,
                overdueCount, overdueAmount,
                todayCount, todayAmount,
                tomorrowCount, tomorrowAmount,
                next7Count, next7Amount,
                urgentCount: overdueCount + todayCount,
                urgentAmount: overdueAmount + todayAmount,
                contactedUrgent,
                uncontactedUrgent: Math.max(0, overdueCount + todayCount - contactedUrgent),
                missingContactUrgent,
                legacyMissingDates,
                recycleItems: (recycleRes.data || []).length
            },
            money: { todayCollected, monthCollected, outstanding, recoveryRate },
            latestBackup: (backupRes.data || [])[0] || null,
            priorities: priorityItems.slice(0, 6),
            recentActivity
        });
    } catch (err) {
        return sendServerError(res, 'Home Command Center API Error:', err);
    }
}
