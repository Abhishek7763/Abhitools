import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

export const config = { api: { bodyParser: { sizeLimit: '3mb' } } };

const MONTHS = new Set(['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']);
const EMI_RE = /(?:\((\d+)\))?\s*(\d+)[-\s\/]+([a-zA-Z]+)[-\s\/]+(\d+)/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RECORDS = 10000;

function text(value, max = 500) {
    const v = String(value ?? '').trim();
    return v ? v.slice(0, max) : null;
}

function positiveInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function nonnegativeInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function optionalYear(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number.parseInt(value, 10);
    return Number.isInteger(n) && n >= 2000 && n <= 2200 ? n : null;
}

function validIsoDate(value) {
    if (!value) return null;
    const s = String(value).slice(0, 10);
    if (!DATE_RE.test(s)) return null;
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

function dateFromParts(day, month, year) {
    if (!year) return null;
    const monthIndex = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(month);
    if (monthIndex < 0) return null;
    const d = new Date(Date.UTC(year, monthIndex, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthIndex || d.getUTCDate() !== day) return null;
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function baseResult(format) {
    return {
        format,
        borrowers: [],
        loans: [],
        emis: [],
        documents: [],
        settlements: [],
        payments: [],
        issues: [],
        skipped: { borrowers: 0, loans: 0, emis: 0, documents: 0, settlements: 0, payments: 0 }
    };
}

function addBorrower(result, sourceKey, raw) {
    const name = text(raw?.name, 120)?.toUpperCase();
    if (!sourceKey || !name) {
        result.skipped.borrowers++;
        result.issues.push('Borrower skipped: missing name/source key.');
        return false;
    }
    result.borrowers.push({
        source_key: String(sourceKey),
        name,
        father_name: text(raw?.father_name, 120),
        phone: text(raw?.phone, 30),
        whatsapp: text(raw?.whatsapp, 30),
        address: text(raw?.address, 500),
        aadhaar: text(raw?.aadhaar, 30),
        pan: text(raw?.pan, 30),
        photo_url: text(raw?.photo_url, 1000),
        notes: text(raw?.notes, 1000)
    });
    return true;
}

function addLoan(result, sourceKey, borrowerKey, raw) {
    const loanCode = text(raw?.loan_code ?? raw?.id, 200);
    const amount = positiveInt(raw?.amount);
    if (!sourceKey || !borrowerKey || !loanCode || !amount) {
        result.skipped.loans++;
        result.issues.push(`Loan skipped${loanCode ? ` (${loanCode})` : ''}: missing borrower, code or valid amount.`);
        return false;
    }
    const status = ['active','closed','defaulted'].includes(raw?.status) ? raw.status : 'active';
    result.loans.push({
        source_key: String(sourceKey),
        borrower_key: String(borrowerKey),
        loan_code: loanCode,
        amount,
        interest_rate: Number.isFinite(Number(raw?.interest_rate)) ? Number(raw.interest_rate) : 0,
        loan_date: validIsoDate(raw?.loan_date),
        loan_year: optionalYear(raw?.loan_year),
        end_date: validIsoDate(raw?.end_date),
        status,
        agreement_url: text(raw?.agreement_url, 1000),
        notes: text(raw?.notes, 1000)
    });
    return true;
}

function addEmi(result, loanKey, raw, index = 0) {
    const day = Number.parseInt(raw?.due_day ?? raw?.day, 10);
    const month = String(raw?.due_month ?? raw?.month ?? '').trim().toUpperCase();
    const year = optionalYear(raw?.due_year ?? raw?.year);
    const amount = positiveInt(raw?.amount);
    if (!loanKey || !Number.isInteger(day) || day < 1 || day > 31 || !MONTHS.has(month) || !amount) {
        result.skipped.emis++;
        result.issues.push(`EMI skipped for ${loanKey || 'unknown loan'}: invalid day/month/amount.`);
        return;
    }
    const explicitDate = validIsoDate(raw?.due_date);
    const derivedDate = dateFromParts(day, month, year);
    if (year && !explicitDate && !derivedDate) {
        result.skipped.emis++;
        result.issues.push(`EMI skipped for ${loanKey}: invalid calendar date ${day}-${month}-${year}.`);
        return;
    }
    let status = ['pending','paid','overdue'].includes(raw?.status) ? raw.status : 'pending';
    let paidAmount = positiveInt(raw?.paid_amount);
    if (status === 'paid' && !paidAmount) paidAmount = amount;
    if (paidAmount) paidAmount = Math.min(paidAmount, amount);
    if (paidAmount >= amount) status = 'paid';
    result.emis.push({
        loan_key: String(loanKey),
        installment_number: positiveInt(raw?.installment_number) || index + 1,
        due_date: explicitDate || derivedDate,
        due_day: day,
        due_month: month,
        due_year: year,
        amount,
        status,
        paid_date: paidAmount ? validIsoDate(raw?.paid_date) : null,
        paid_amount: paidAmount || null,
        notes: text(raw?.notes, 1000)
    });
}

function normalizeLegacyArray(input) {
    const result = baseResult('legacy-gist-array');
    const borrowerKeys = new Map();

    input.forEach((item, itemIndex) => {
        const name = text(item?.name, 120)?.toUpperCase();
        const loanCode = text(item?.id, 200);
        const amount = positiveInt(item?.amount);
        if (!name || !loanCode || !amount) {
            result.skipped.loans++;
            result.issues.push(`Legacy record ${itemIndex + 1} skipped: invalid name/id/amount.`);
            return;
        }

        const identity = JSON.stringify([name, loanCode]);
        let borrowerKey = borrowerKeys.get(identity);
        if (!borrowerKey) {
            borrowerKey = `legacy-borrower:${itemIndex}`;
            borrowerKeys.set(identity, borrowerKey);
            addBorrower(result, borrowerKey, { name, father_name: item.father_name, phone: item.phone, notes: 'Imported from legacy JSON' });
        }

        const loanKey = `legacy-loan:${itemIndex}`;
        if (!addLoan(result, loanKey, borrowerKey, {
            loan_code: loanCode,
            amount,
            status: 'active',
            notes: 'Imported from legacy JSON; original loan date/year were not stored.'
        })) return;

        String(item?.emis || '').split(/\r?\n/).forEach((line, lineIndex) => {
            const m = line.match(EMI_RE);
            if (!m) {
                if (line.trim()) {
                    result.skipped.emis++;
                    result.issues.push(`Legacy EMI line skipped for ${loanCode}: ${line.trim().slice(0, 80)}`);
                }
                return;
            }
            addEmi(result, loanKey, {
                installment_number: Number.parseInt(m[1] || String(lineIndex + 1), 10),
                due_day: Number.parseInt(m[2], 10),
                due_month: m[3],
                due_year: null,
                amount: Number.parseInt(m[4], 10),
                status: 'pending'
            }, lineIndex);
        });
    });
    return result;
}

function normalizeStructured(input, format) {
    const result = baseResult(format);
    const root = input?.data && typeof input.data === 'object' ? input.data : input;
    const borrowers = Array.isArray(root?.borrowers) ? root.borrowers : [];
    const loans = Array.isArray(root?.loans) ? root.loans : [];
    const flatEmis = Array.isArray(root?.emis) ? root.emis : [];
    const documents = Array.isArray(root?.documents) ? root.documents : [];
    const settlements = Array.isArray(root?.loan_settlements) ? root.loan_settlements : [];
    const payments = Array.isArray(root?.emi_payments) ? root.emi_payments : [];

    const borrowerKeyById = new Map();
    borrowers.forEach((b, index) => {
        if (b?.deleted_at) { result.skipped.borrowers++; return; }
        const key = `borrower:${index}`;
        if (b?.id && borrowerKeyById.has(String(b.id))) throw Object.assign(new Error('File mein borrower ID do baar hai.'), { status: 400 });
        if (addBorrower(result, key, b)) borrowerKeyById.set(String(b?.id || key), key);
    });

    const deletedBorrowers = new Set(borrowers.filter(b => b?.deleted_at).map(b => String(b.id)));
    const loanKeyById = new Map();
    const emiRefById = new Map();

    loans.forEach((l, index) => {
        if (l?.deleted_at) { result.skipped.loans++; return; }
        const nested = l?.borrowers || l?.borrower;
        const ref = String(l?.borrower_id || nested?.id || '');
        if (ref && deletedBorrowers.has(ref)) { result.skipped.loans++; return; }
        let borrowerKey = borrowerKeyById.get(ref);
        if (!borrowerKey && nested?.name) {
            borrowerKey = `nested-borrower:${index}`;
            if (!addBorrower(result, borrowerKey, nested)) borrowerKey = null;
            else if (ref) borrowerKeyById.set(ref, borrowerKey);
        }
        // A row key keeps nested EMIs with their source row when duplicate loan codes are skipped.
        const loanKey = `loan:${index}`;
        const fileRef = String(l?.id || l?.loan_code || loanKey);
        if (addLoan(result, loanKey, borrowerKey, l)) {
            if (l?.id && loanKeyById.has(fileRef)) {
                throw Object.assign(new Error('File mein loan ID do baar hai. Import se pehle IDs check karein.'), { status: 400 });
            }
            if (!loanKeyById.has(fileRef)) loanKeyById.set(fileRef, loanKey);
            const nestedEmis = Array.isArray(l?.emis) ? l.emis : [];
            nestedEmis.forEach((e, emiIndex) => {
                addEmi(result, loanKey, e, emiIndex);
                if (e?.id) emiRefById.set(String(e.id), { loan_key: loanKey, installment_number: positiveInt(e.installment_number) || emiIndex + 1 });
            });
        }
    });

    if (flatEmis.length) {
        // Prefer the explicit flat EMI table in full backups to avoid double-importing nested EMI arrays.
        result.emis = [];
        result.skipped.emis = 0;
        emiRefById.clear();
        flatEmis.forEach((e, index) => {
            const loanKey = loanKeyById.get(String(e?.loan_id || ''));
            addEmi(result, loanKey, e, index);
            if (e?.id && loanKey) emiRefById.set(String(e.id), { loan_key: loanKey, installment_number: positiveInt(e.installment_number) || index + 1 });
        });
    }

    const settlementKeyById = new Map();
    settlements.forEach((st, index) => {
        const loanKey = loanKeyById.get(String(st?.loan_id || ''));
        const remaining = nonnegativeInt(st?.scheduled_remaining_before);
        const finalPayment = nonnegativeInt(st?.final_payment_amount);
        const waived = nonnegativeInt(st?.waived_amount);
        const settlementDate = validIsoDate(st?.settlement_date);
        if (!loanKey || remaining === null || finalPayment === null || waived === null || finalPayment + waived !== remaining || !settlementDate) {
            result.skipped.settlements++;
            return;
        }
        const sourceKey = String(st?.id || `settlement:${index}`);
        settlementKeyById.set(String(st?.id || sourceKey), sourceKey);
        result.settlements.push({
            source_key: sourceKey,
            loan_key: loanKey,
            settlement_date: settlementDate,
            scheduled_remaining_before: remaining,
            final_payment_amount: finalPayment,
            waived_amount: waived,
            method: text(st?.method, 60),
            notes: text(st?.notes, 1000),
            created_at: st?.created_at || new Date().toISOString(),
            reopened_at: st?.reopened_at || null,
            reopen_note: text(st?.reopen_note, 1000)
        });
    });

    payments.forEach((p) => {
        const ref = emiRefById.get(String(p?.emi_id || ''));
        const amount = positiveInt(p?.amount);
        const paidDate = validIsoDate(p?.payment_date ?? p?.paid_date);
        if (!ref || !amount || !paidDate) {
            result.skipped.payments++;
            return;
        }
        result.payments.push({
            loan_key: ref.loan_key,
            installment_number: ref.installment_number,
            amount,
            payment_date: paidDate,
            method: text(p?.method, 60),
            notes: text(p?.notes, 500),
            source: ['manual','baseline','settlement'].includes(p?.source) ? p.source : 'manual',
            settlement_key: settlementKeyById.get(String(p?.settlement_id || '')) || null,
            reversed_at: p?.reversed_at || null
        });
    });

    documents.forEach((d) => {
        if (d?.deleted_at || (d?.borrower_id && !borrowerKeyById.has(String(d.borrower_id))) ||
            (d?.loan_id && !loanKeyById.has(String(d.loan_id)))) {
            result.skipped.documents++;
            return;
        }
        const docType = text(d?.doc_type, 50);
        const fileName = text(d?.file_name, 300);
        const fileUrl = text(d?.file_url, 1500);
        if (!docType || !fileName || !fileUrl) {
            result.skipped.documents++;
            return;
        }
        result.documents.push({
            borrower_key: borrowerKeyById.get(String(d?.borrower_id || '')) || null,
            loan_key: loanKeyById.get(String(d?.loan_id || '')) || null,
            doc_type: docType,
            file_name: fileName,
            file_url: fileUrl
        });
    });

    return result;
}

function normalizeInput(input) {
    if (Array.isArray(input)) return normalizeLegacyArray(input);
    if (!input || typeof input !== 'object') throw Object.assign(new Error('JSON root must be an object or array'), { status: 400 });

    if (input.format === 'abhitools-backup') {
        if (!Number.isInteger(Number(input.version)) || Number(input.version) < 1 || Number(input.version) > 8) {
            throw Object.assign(new Error('Backup version supported nahi hai.'), { status: 400 });
        }
        return normalizeStructured(input, `abhitools-backup-v${Number(input.version)}`);
    }
    if (input.format === 'abhitools-snapshot') return normalizeStructured(input, 'abhitools-snapshot');
    if (Array.isArray(input.borrowers) && Array.isArray(input.loans)) return normalizeStructured(input, 'abhitools-compatible-json');

    throw Object.assign(new Error('Unsupported JSON format'), { status: 400 });
}

function dedupeNormalized(result) {
    const loanCodeSeen = new Set();
    const keptLoanKeys = new Set();
    result.loans = result.loans.filter(l => {
        if (loanCodeSeen.has(l.loan_code)) {
            result.skipped.loans++;
            result.issues.push(`Duplicate loan code inside file skipped: ${l.loan_code}`);
            return false;
        }
        loanCodeSeen.add(l.loan_code);
        keptLoanKeys.add(l.source_key);
        return true;
    });

    const before = result.emis.length;
    result.emis = result.emis.filter(e => keptLoanKeys.has(e.loan_key));
    result.skipped.emis += before - result.emis.length;
    const settlementBefore = result.settlements.length;
    result.settlements = result.settlements.filter(st => keptLoanKeys.has(st.loan_key));
    result.skipped.settlements += settlementBefore - result.settlements.length;
    const keptSettlementKeys = new Set(result.settlements.map(st => st.source_key));
    result.payments.forEach(p => { if (p.settlement_key && !keptSettlementKeys.has(p.settlement_key)) p.settlement_key = null; });

    const paymentBefore = result.payments.length;
    result.payments = result.payments.filter(p => keptLoanKeys.has(p.loan_key));
    result.skipped.payments += paymentBefore - result.payments.length;

    if (result.borrowers.length + result.loans.length + result.emis.length + result.documents.length + result.settlements.length + result.payments.length > MAX_RECORDS) {
        throw Object.assign(new Error(`Import is too large. Maximum ${MAX_RECORDS} normalized records.`), { status: 413 });
    }
    return result;
}

function reviewGroups(result, candidates) {
    const groups = new Map();
    const codes = new Map();
    for (const loan of result.loans) {
        if (!codes.has(loan.borrower_key)) codes.set(loan.borrower_key, []);
        codes.get(loan.borrower_key).push(loan.loan_code);
    }
    for (const b of result.borrowers) {
        if (!groups.has(b.name)) groups.set(b.name, { name: b.name, incoming: [], existing: [] });
        groups.get(b.name).incoming.push({ key: b.source_key, father: b.father_name,
            phone_last4: String(b.phone || b.whatsapp || '').replace(/\D/g,'').slice(-4), loans: (codes.get(b.source_key) || []).slice(0,6) });
    }
    for (const c of candidates) groups.get(c.name)?.existing.push(c);
    return [...groups.values()].filter(g => g.existing.length || g.incoming.length > 1);
}

function applyBorrowerChoices(result, groups, choices, mode) {
    const byKey = new Map(result.borrowers.map(b => [b.source_key, b]));
    const unusedChoices = new Set(Object.keys(choices || {}));
    for (const group of groups) {
        const earlier = new Set();
        const existing = new Set(mode === 'merge' ? group.existing.map(b => b.id) : []);
        for (const row of group.incoming) {
            if (earlier.size || existing.size) {
                unusedChoices.delete(row.key);
                const choice = choices?.[row.key];
                if (choice === 'new') byKey.get(row.key).match = { kind: 'new' };
                else if (typeof choice === 'string' && choice.startsWith('db:') && existing.has(choice.slice(3)))
                    byKey.get(row.key).match = { kind: 'existing', id: choice.slice(3) };
                else if (typeof choice === 'string' && choice.startsWith('file:') && earlier.has(choice.slice(5)))
                    byKey.get(row.key).match = { kind: 'incoming', key: choice.slice(5) };
                else return false;
            }
            earlier.add(row.key);
        }
    }
    return unusedChoices.size === 0;
}

async function buildPreview(result) {
    const { data } = await supabaseRequest('rpc/abhi_review_import_matches', 'POST', {
        p_names: result.borrowers.map(b => b.name), p_codes: result.loans.map(l => l.loan_code)
    });
    const existingNames = new Set(data.names);
    const existingCodes = new Set(data.codes);
    const duplicateBorrowers = result.borrowers.filter(b => existingNames.has(b.name)).map(b => b.name);
    const duplicateLoans = result.loans.filter(l => existingCodes.has(l.loan_code)).map(l => l.loan_code);

    return {
        format: result.format,
        borrower_groups: reviewGroups(result, data.candidates),
        counts: {
            borrowers: result.borrowers.length,
            loans: result.loans.length,
            emis: result.emis.length,
            documents: result.documents.length,
            settlements: result.settlements.length,
            payments: result.payments.length
        },
        skipped: result.skipped,
        duplicates: {
            existing_borrowers: duplicateBorrowers.length,
            existing_loans: duplicateLoans.length,
            loan_codes: duplicateLoans.slice(0, 30)
        },
        issues: result.issues.slice(0, 50),
        can_import: result.loans.length > 0
    };
}

function normalizedPayload(result) {
    return {
        format: result.format,
        borrowers: result.borrowers,
        loans: result.loans,
        emis: result.emis,
        documents: result.documents,
        settlements: result.settlements,
        payments: result.payments
    };
}


export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const action = String(req.query?.action || 'preview').toLowerCase();

    try {
        const rawPayload = req.body?.payload;
        const normalized = dedupeNormalized(normalizeInput(rawPayload));
        const preview = await buildPreview(normalized);

        if (action === 'preview') return res.status(200).json(preview);

        if (action === 'apply') {
            const { data: recycleRows } = await supabaseRequest('recycle_bin?restored_at=is.null&purged_at=is.null&select=id&limit=1');
            if (recycleRows?.length) {
                return res.status(409).json({ error: 'Recycle Bin me items hain. Smart Import se pehle unhe Restore ya Permanently Delete karein.' });
            }
            const mode = String(req.body?.mode || 'merge').toLowerCase();
            if (!['merge','replace'].includes(mode)) return res.status(400).json({ error: 'Mode must be merge or replace' });
            if (mode === 'replace' && req.body?.confirmReplace !== true) {
                return res.status(400).json({ error: 'Replace confirmation required' });
            }
            if (!preview.can_import) return res.status(400).json({ error: 'No valid loans found in import file' });

            const label = text(req.body?.label, 120) || `Before ${mode} import`;
            if (mode === 'replace' && ['abhitools-backup','abhitools-snapshot'].includes(rawPayload?.format)) {
                return res.status(400).json({ error: 'Poora backup replace karne ke liye Full Restore use karein.' });
            }
            if (!applyBorrowerChoices(normalized, preview.borrower_groups, req.body?.borrower_choices, mode)) {
                return res.status(409).json({ error: 'Same naam ke borrowers ko review karein. File dobara select karke latest matches dekhein.' });
            }
            const { data: result } = await supabaseRequest('rpc/abhi_import_with_history', 'POST', {
                p_payload: normalizedPayload(normalized), p_mode: mode, p_label: label
            });
            return res.status(200).json({ success: true, preview, result });
        }

        return res.status(404).json({ error: 'Import action not found' });
    } catch (err) {
        if (err?.details?.message === 'Borrower review changed') return res.status(409).json({ error: 'Borrower list badal gayi. File dobara select karke review karein.' });
        if (err?.status === 400 || err?.status === 413) return res.status(err.status).json({ error: err.message });
        return sendServerError(res, 'Import API Error:', err);
    }
}
