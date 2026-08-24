import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

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
    return Number.isNaN(d.getTime()) ? null : s;
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
        issues: [],
        skipped: { borrowers: 0, loans: 0, emis: 0, documents: 0 }
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
    const status = ['pending','paid','overdue'].includes(raw?.status) ? raw.status : 'pending';
    result.emis.push({
        loan_key: String(loanKey),
        installment_number: positiveInt(raw?.installment_number) || index + 1,
        due_date: explicitDate || derivedDate,
        due_day: day,
        due_month: month,
        due_year: year,
        amount,
        status,
        paid_date: status === 'paid' ? validIsoDate(raw?.paid_date) : null,
        paid_amount: status === 'paid' ? positiveInt(raw?.paid_amount) : null,
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

        let borrowerKey = borrowerKeys.get(name);
        if (!borrowerKey) {
            borrowerKey = `legacy-borrower:${name}`;
            borrowerKeys.set(name, borrowerKey);
            addBorrower(result, borrowerKey, { name, notes: 'Imported from legacy JSON' });
        }

        const loanKey = `legacy-loan:${loanCode}`;
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

    const borrowerKeyById = new Map();
    borrowers.forEach((b, index) => {
        const key = String(b?.id || `borrower:${index}`);
        if (addBorrower(result, key, b)) borrowerKeyById.set(String(b?.id || key), key);
    });

    const borrowerByName = new Map(result.borrowers.map(b => [b.name, b.source_key]));
    const loanKeyById = new Map();

    loans.forEach((l, index) => {
        let borrowerKey = borrowerKeyById.get(String(l?.borrower_id || ''));
        const nestedName = text(l?.borrowers?.name ?? l?.borrower?.name, 120)?.toUpperCase();
        if (!borrowerKey && nestedName) {
            borrowerKey = borrowerByName.get(nestedName);
            if (!borrowerKey) {
                borrowerKey = `borrower-name:${nestedName}`;
                if (addBorrower(result, borrowerKey, { name: nestedName })) borrowerByName.set(nestedName, borrowerKey);
            }
        }
        const loanKey = String(l?.id || l?.loan_code || `loan:${index}`);
        if (addLoan(result, loanKey, borrowerKey, l)) {
            loanKeyById.set(String(l?.id || loanKey), loanKey);
            const nestedEmis = Array.isArray(l?.emis) ? l.emis : [];
            nestedEmis.forEach((e, emiIndex) => addEmi(result, loanKey, e, emiIndex));
        }
    });

    if (flatEmis.length) {
        // Prefer the explicit flat EMI table in full backups to avoid double-importing nested EMI arrays.
        result.emis = [];
        result.skipped.emis = 0;
        flatEmis.forEach((e, index) => {
            const loanKey = loanKeyById.get(String(e?.loan_id || ''));
            addEmi(result, loanKey, e, index);
        });
    }

    documents.forEach((d) => {
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

    if (input.format === 'abhitools-backup') return normalizeStructured(input, 'abhitools-backup-v2');
    if (input.format === 'abhitools-snapshot') return normalizeStructured(input, 'abhitools-snapshot');
    if (Array.isArray(input.borrowers) && Array.isArray(input.loans)) return normalizeStructured(input, 'abhitools-compatible-json');

    throw Object.assign(new Error('Unsupported JSON format'), { status: 400 });
}

function dedupeNormalized(result) {
    const borrowerSeen = new Map();
    result.borrowers = result.borrowers.filter(b => {
        const key = b.name;
        if (!borrowerSeen.has(key)) {
            borrowerSeen.set(key, b.source_key);
            return true;
        }
        const original = borrowerSeen.get(key);
        result.loans.forEach(l => { if (l.borrower_key === b.source_key) l.borrower_key = original; });
        result.documents.forEach(d => { if (d.borrower_key === b.source_key) d.borrower_key = original; });
        return false;
    });

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

    if (result.borrowers.length + result.loans.length + result.emis.length > MAX_RECORDS) {
        throw Object.assign(new Error(`Import is too large. Maximum ${MAX_RECORDS} normalized records.`), { status: 413 });
    }
    return result;
}

async function buildPreview(result) {
    const [existingBorrowers, existingLoans] = await Promise.all([
        supabaseRequest('borrowers?select=name'),
        supabaseRequest('loans?select=loan_code')
    ]);
    const existingNames = new Set((existingBorrowers.data || []).map(b => String(b.name || '').trim().toUpperCase()));
    const existingCodes = new Set((existingLoans.data || []).map(l => String(l.loan_code || '').trim()));
    const duplicateBorrowers = result.borrowers.filter(b => existingNames.has(b.name)).map(b => b.name);
    const duplicateLoans = result.loans.filter(l => existingCodes.has(l.loan_code)).map(l => l.loan_code);

    return {
        format: result.format,
        counts: {
            borrowers: result.borrowers.length,
            loans: result.loans.length,
            emis: result.emis.length,
            documents: result.documents.length
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
        documents: result.documents
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
            const mode = String(req.body?.mode || 'merge').toLowerCase();
            if (!['merge','replace'].includes(mode)) return res.status(400).json({ error: 'Mode must be merge or replace' });
            if (mode === 'replace' && req.body?.confirmReplace !== true) {
                return res.status(400).json({ error: 'Replace confirmation required' });
            }
            if (!preview.can_import) return res.status(400).json({ error: 'No valid loans found in import file' });

            const label = text(req.body?.label, 120) || `Before ${mode} import`;
            const { data } = await supabaseRequest('rpc/abhi_import_management_data', 'POST', {
                p_payload: normalizedPayload(normalized),
                p_mode: mode,
                p_label: label
            });
            const result = Array.isArray(data) ? data[0] : data;
            return res.status(200).json({ success: true, preview, result: result || {} });
        }

        return res.status(404).json({ error: 'Import action not found' });
    } catch (err) {
        if (err?.status === 400 || err?.status === 413) return res.status(err.status).json({ error: err.message });
        return sendServerError(res, 'Import API Error:', err);
    }
}
