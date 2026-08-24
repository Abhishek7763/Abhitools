import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

const TIME_ZONE = 'Asia/Kolkata';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
    if (!safeDate(fromIso) || !safeDate(toIso)) return 0;
    return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

function safeInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
}

function remainingFor(emi) {
    const amount = Math.max(0, safeInt(emi.amount));
    const paid = Math.max(0, Math.min(safeInt(emi.paid_amount), amount));
    return { amount, paid, remaining: Math.max(amount - paid, 0) };
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

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
}

function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsv(payload) {
    const rows = [
        ['AbhiTools Collection Priority & Account Health Insights'],
        ['Generated', payload.generatedAt || ''],
        ['Business Date', payload.businessDate || ''],
        ['Important', 'Operational collection priority only; not a credit score or loan approval decision.'],
        [],
        ['Borrower', 'Tier', 'Priority Score', 'Confidence', 'Loans', 'Outstanding', 'Overdue', 'Max Days Overdue', 'Partial EMIs', 'Late Paid', 'Dated EMIs', 'Missing Dates', 'Data Complete %', 'Contact Attempts 30d', 'Contact Available']
    ];
    for (const item of payload.borrowers || []) {
        rows.push([
            item.name, item.tier, item.priority_score ?? '', item.confidence, item.active_loan_count,
            item.outstanding, item.overdue_amount, item.max_days_overdue, item.partial_count,
            item.late_paid_count, item.dated_emi_count, item.missing_date_count, item.data_completeness,
            item.contact_attempts_30d, item.has_contact ? 'Yes' : 'No'
        ]);
    }
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

function baseBorrower(b) {
    return {
        id: b.id,
        name: b.name || 'Unknown Borrower',
        phone: b.phone || null,
        whatsapp: b.whatsapp || b.phone || null,
        has_contact: Boolean(String(b.whatsapp || b.phone || '').trim()),
        loan_count: 0,
        active_loan_count: 0,
        principal: 0,
        scheduled: 0,
        collected: 0,
        outstanding: 0,
        overdue_amount: 0,
        overdue_count: 0,
        max_days_overdue: 0,
        due_next7_amount: 0,
        due_next7_count: 0,
        partial_count: 0,
        total_emi_count: 0,
        dated_emi_count: 0,
        active_emi_count: 0,
        active_dated_emi_count: 0,
        missing_date_count: 0,
        missing_date_amount: 0,
        paid_dated_count: 0,
        late_paid_count: 0,
        on_time_paid_count: 0,
        contact_attempts_30d: 0,
        last_contact_at: null,
        priority_score: null,
        tier: 'current',
        confidence: 'low',
        data_completeness: 0,
        recovery_rate: 0,
        late_payment_rate: 0,
        reasons: []
    };
}

function finalizeBorrower(item) {
    const coverageTotal = item.active_emi_count > 0 ? item.active_emi_count : item.total_emi_count;
    const coverageDated = item.active_emi_count > 0 ? item.active_dated_emi_count : item.dated_emi_count;
    item.data_completeness = coverageTotal > 0
        ? Math.round((coverageDated / coverageTotal) * 100)
        : 100;
    item.recovery_rate = item.scheduled > 0
        ? Math.round((item.collected / item.scheduled) * 1000) / 10
        : 0;
    item.late_payment_rate = item.paid_dated_count > 0
        ? Math.round((item.late_paid_count / item.paid_dated_count) * 1000) / 10
        : 0;
    item.confidence = item.data_completeness >= 85 ? 'high' : item.data_completeness >= 60 ? 'medium' : 'low';

    const reasons = [];
    if (item.missing_date_count > 0) reasons.push(`${item.missing_date_count} EMI date(s) missing`);
    if (item.overdue_count > 0) reasons.push(`${item.overdue_count} overdue EMI`);
    if (item.max_days_overdue > 0) reasons.push(`max ${item.max_days_overdue} days overdue`);
    if (item.partial_count > 0) reasons.push(`${item.partial_count} partial EMI`);
    if (item.late_paid_count > 0) reasons.push(`${item.late_paid_count} late-paid EMI`);
    if (!item.has_contact && item.outstanding > 0) reasons.push('contact details missing');
    if (item.overdue_count > 0 && item.contact_attempts_30d === 0) reasons.push('no reminder contact in 30 days');

    // Do not produce a collection priority tier from sparse legacy data.
    // Missing due dates must be reviewed first instead of being interpreted as delinquency.
    if (item.outstanding > 0 && item.data_completeness < 50) {
        item.priority_score = null;
        item.tier = 'data_incomplete';
        item.reasons = reasons.length ? reasons : ['insufficient dated repayment data'];
        return item;
    }

    const overdueShare = item.outstanding > 0 ? item.overdue_amount / item.outstanding : 0;
    const lateRate = item.paid_dated_count > 0 ? item.late_paid_count / item.paid_dated_count : 0;
    const dueSoonShare = item.outstanding > 0 ? item.due_next7_amount / item.outstanding : 0;
    let score = 0;
    score += clamp(overdueShare * 35, 0, 35);
    score += clamp((item.max_days_overdue / 90) * 20, 0, 20);
    score += clamp(item.partial_count * 4, 0, 12);
    score += clamp(lateRate * 15, 0, 15);
    score += clamp(dueSoonShare * 8, 0, 8);
    if (item.overdue_count > 0 && item.contact_attempts_30d === 0) score += 5;
    if (!item.has_contact && item.outstanding > 0) score += 5;
    item.priority_score = Math.round(clamp(score, 0, 100));

    if (item.priority_score >= 70) item.tier = 'critical';
    else if (item.priority_score >= 45) item.tier = 'high';
    else if (item.priority_score >= 20) item.tier = 'watch';
    else item.tier = 'current';
    item.reasons = reasons.length ? reasons : [item.outstanding > 0 ? 'no observed collection exception' : 'no current outstanding'];
    return item;
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
        const cutoff30 = addDays(today, -30);
        const [borrowersRes, loansRes, emisRes, paymentsRes, contactsRes, followupsRes] = await Promise.all([
            supabaseRequest('borrowers?deleted_at=is.null&select=id,name,phone,whatsapp&order=name.asc&limit=5000'),
            supabaseRequest('loans?deleted_at=is.null&select=id,borrower_id,loan_code,amount,status&limit=5000'),
            supabaseRequest('emis?select=id,loan_id,installment_number,amount,paid_amount,paid_date,status,due_date,due_year&limit=10000'),
            supabaseRequest('emi_payments?reversed_at=is.null&select=id,emi_id,amount,payment_date&limit=20000'),
            supabaseRequest('activity_log?action=eq.CONTACT_REMINDER&select=record_id,created_at&order=created_at.desc&limit=5000'),
            supabaseRequest(`collection_followups?followup_date=gte.${cutoff30}&followup_date=lte.${today}&select=borrower_id,created_at&order=created_at.desc&limit=5000`)
        ]);

        const borrowers = borrowersRes.data || [];
        const loans = loansRes.data || [];
        const emis = emisRes.data || [];
        const payments = paymentsRes.data || [];
        const borrowerStats = new Map(borrowers.map(b => [b.id, baseBorrower(b)]));
        const loanById = new Map(loans.map(l => [l.id, l]));
        const emiById = new Map(emis.map(e => [e.id, e]));
        const latestPaymentDate = new Map();

        for (const p of payments) {
            const date = safeDate(p.payment_date);
            if (!date || !p.emi_id) continue;
            const prev = latestPaymentDate.get(p.emi_id);
            if (!prev || date > prev) latestPaymentDate.set(p.emi_id, date);
        }

        for (const loan of loans) {
            const stat = borrowerStats.get(loan.borrower_id);
            if (!stat) continue;
            stat.loan_count += 1;
            if (String(loan.status || 'active') !== 'closed') stat.active_loan_count += 1;
            stat.principal += Math.max(0, safeInt(loan.amount));
        }

        for (const emi of emis) {
            const loan = loanById.get(emi.loan_id);
            if (!loan) continue;
            const stat = borrowerStats.get(loan.borrower_id);
            if (!stat) continue;
            const { amount, paid, remaining } = remainingFor(emi);
            const loanOpen = String(loan.status || 'active') !== 'closed';
            const dueDate = safeDate(emi.due_date);
            const dated = Boolean(dueDate && emi.due_year);

            stat.total_emi_count += 1;
            if (loanOpen) stat.active_emi_count += 1;
            stat.scheduled += amount;
            stat.collected += paid;
            if (loanOpen) stat.outstanding += remaining;
            if (dated) {
                stat.dated_emi_count += 1;
                if (loanOpen) stat.active_dated_emi_count += 1;
            }
            else if (loanOpen && remaining > 0) {
                stat.missing_date_count += 1;
                stat.missing_date_amount += remaining;
            }

            if (!dated) continue;
            if (paid > 0 && remaining > 0 && loanOpen) stat.partial_count += 1;

            if (remaining <= 0) {
                stat.paid_dated_count += 1;
                const paidDate = latestPaymentDate.get(emi.id) || safeDate(emi.paid_date);
                if (paidDate && paidDate > dueDate) stat.late_paid_count += 1;
                else if (paidDate) stat.on_time_paid_count += 1;
                continue;
            }
            if (!loanOpen) continue;

            if (dueDate < today) {
                const days = Math.max(1, daysBetween(dueDate, today));
                stat.overdue_count += 1;
                stat.overdue_amount += remaining;
                stat.max_days_overdue = Math.max(stat.max_days_overdue, days);
            }
            if (dueDate >= today && dueDate <= addDays(today, 7)) {
                stat.due_next7_count += 1;
                stat.due_next7_amount += remaining;
            }
        }

        for (const row of contactsRes.data || []) {
            const contactDate = dateInZone(row.created_at);
            if (!contactDate || contactDate < cutoff30 || contactDate > today) continue;
            const emi = emiById.get(row.record_id);
            const loan = emi ? loanById.get(emi.loan_id) : null;
            const stat = loan ? borrowerStats.get(loan.borrower_id) : null;
            if (!stat) continue;
            stat.contact_attempts_30d += 1;
            if (!stat.last_contact_at || String(row.created_at) > String(stat.last_contact_at)) stat.last_contact_at = row.created_at;
        }

        for (const row of followupsRes.data || []) {
            const stat = borrowerStats.get(row.borrower_id);
            if (!stat) continue;
            stat.contact_attempts_30d += 1;
            if (!stat.last_contact_at || String(row.created_at) > String(stat.last_contact_at)) stat.last_contact_at = row.created_at;
        }

        const rows = [...borrowerStats.values()].map(finalizeBorrower);
        const tierOrder = { critical: 5, high: 4, watch: 3, data_incomplete: 2, current: 1 };
        rows.sort((a, b) => (tierOrder[b.tier] || 0) - (tierOrder[a.tier] || 0)
            || (b.priority_score ?? -1) - (a.priority_score ?? -1)
            || b.overdue_amount - a.overdue_amount
            || b.outstanding - a.outstanding
            || a.name.localeCompare(b.name));

        const summary = {
            borrowers: rows.length,
            activeBorrowers: rows.filter(x => x.active_loan_count > 0).length,
            critical: rows.filter(x => x.tier === 'critical').length,
            high: rows.filter(x => x.tier === 'high').length,
            watch: rows.filter(x => x.tier === 'watch').length,
            current: rows.filter(x => x.tier === 'current').length,
            dataIncomplete: rows.filter(x => x.tier === 'data_incomplete').length,
            totalOutstanding: rows.reduce((a, x) => a + x.outstanding, 0),
            totalOverdue: rows.reduce((a, x) => a + x.overdue_amount, 0),
            missingDates: rows.reduce((a, x) => a + x.missing_date_count, 0),
            missingDateAmount: rows.reduce((a, x) => a + x.missing_date_amount, 0),
            missingContactBorrowers: rows.filter(x => x.outstanding > 0 && !x.has_contact).length,
            totalEmis: rows.reduce((a, x) => a + x.active_emi_count, 0),
            datedEmis: rows.reduce((a, x) => a + x.active_dated_emi_count, 0),
            paidDatedEmis: rows.reduce((a, x) => a + x.paid_dated_count, 0),
            latePaidEmis: rows.reduce((a, x) => a + x.late_paid_count, 0)
        };
        summary.dataCompleteness = summary.totalEmis > 0 ? Math.round((summary.datedEmis / summary.totalEmis) * 100) : 100;
        summary.latePaymentRate = summary.paidDatedEmis > 0 ? Math.round((summary.latePaidEmis / summary.paidDatedEmis) * 1000) / 10 : 0;

        const exposureRows = [...rows].sort((a, b) => b.outstanding - a.outstanding);
        const top = exposureRows[0] || null;
        const top3Amount = exposureRows.slice(0, 3).reduce((a, x) => a + x.outstanding, 0);
        const concentration = {
            topBorrowerId: top?.id || null,
            topBorrowerName: top?.name || null,
            topBorrowerOutstanding: top?.outstanding || 0,
            topBorrowerShare: summary.totalOutstanding > 0 ? Math.round(((top?.outstanding || 0) / summary.totalOutstanding) * 1000) / 10 : 0,
            top3Share: summary.totalOutstanding > 0 ? Math.round((top3Amount / summary.totalOutstanding) * 1000) / 10 : 0
        };

        const payload = {
            businessDate: today,
            timezone: TIME_ZONE,
            generatedAt: new Date().toISOString(),
            methodology: {
                title: 'Operational collection priority only',
                note: 'This is not a credit score and must not be used as an automated loan approval, denial, pricing, or eligibility decision. It summarizes observed due, repayment, partial-payment, contact and data-completeness records.',
                incompleteRule: 'When less than 50% of a borrower’s EMI records have verified due dates, the borrower is shown as Data Incomplete instead of being assigned a collection-priority score.'
            },
            summary,
            concentration,
            borrowers: rows
        };

        if (String(req.query?.format || '').toLowerCase() === 'csv') {
            const csv = buildCsv(payload);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="AbhiTools_Collection_Insights_${today}.csv"`);
            return res.status(200).send(`\uFEFF${csv}`);
        }

        return res.status(200).json(payload);
    } catch (err) {
        return sendServerError(res, 'Collection Insights API Error:', err);
    }
}
