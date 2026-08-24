import { noStore, requireAdmin } from '../server_shared.js';
// TEMPORARY one-time migration endpoint. Remove after successful import.
// It accepts no user data and only imports the fixed legacy public Gist when the new tables are empty.
const LEGACY_GIST_ID = '2d93e5e61cf6e2f7292d57edebf29fac';
const LEGACY_FILENAME = 'abhishek_loans.json';
const EMI_RE = /(?:\((\d+)\))?\s*(\d+)[-\s\/]+([a-zA-Z]+)[-\s\/]+(\d+)/;
const MONTHS = new Set(['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']);

function env(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
}

async function sb(path, method='GET', body) {
    const base = env('SUPABASE_URL').replace(/\/$/, '');
    const key = env('SUPABASE_SERVICE_KEY');
    const response = await fetch(`${base}/rest/v1/${path}`, {
        method,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`Supabase ${method} failed (${response.status}): ${text.slice(0,300)}`);
    return data;
}

function parseEmis(text, loanId) {
    if (!text) return [];
    const rows = [];
    String(text).split(/\r?\n/).forEach((line, index) => {
        const m = line.match(EMI_RE);
        if (!m) return;
        const day = Number.parseInt(m[2], 10);
        const month = String(m[3]).toUpperCase();
        const amount = Number.parseInt(m[4], 10);
        if (!Number.isInteger(day) || day < 1 || day > 31 || !MONTHS.has(month) || !Number.isFinite(amount) || amount <= 0) return;
        rows.push({
            loan_id: loanId,
            installment_number: Number.parseInt(m[1] || String(index + 1), 10),
            due_date: null,
            due_day: day,
            due_month: month,
            due_year: null,
            amount,
            status: 'pending'
        });
    });
    return rows;
}

export default async function handler(req, res) {
    noStore(res);
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!requireAdmin(req, res)) return;

    try {
        const [existingLoans, existingBorrowers, existingEmis] = await Promise.all([
            sb('loans?select=id&limit=1'),
            sb('borrowers?select=id&limit=1'),
            sb('emis?select=id&limit=1')
        ]);
        if ((existingLoans?.length || 0) + (existingBorrowers?.length || 0) + (existingEmis?.length || 0) > 0) {
            return res.status(409).json({ error: 'Migration refused because target tables are not empty' });
        }

        const gistResponse = await fetch(`https://api.github.com/gists/${LEGACY_GIST_ID}`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AbhiTools-Migration' },
            cache: 'no-store'
        });
        if (!gistResponse.ok) throw new Error(`Legacy Gist fetch failed (${gistResponse.status})`);
        const gist = await gistResponse.json();
        const file = gist.files?.[LEGACY_FILENAME] || Object.values(gist.files || {})[0];
        if (!file?.content) throw new Error('Legacy Gist data file is missing');
        const legacy = JSON.parse(file.content);
        if (!Array.isArray(legacy)) throw new Error('Legacy Gist content is not an array');

        const normalized = legacy.map((item, index) => ({
            name: String(item?.name || '').trim().toUpperCase(),
            loan_code: String(item?.id || '').trim(),
            amount: Number.parseInt(item?.amount, 10),
            emis: String(item?.emis || ''),
            index
        })).filter(x => x.name && x.loan_code && Number.isFinite(x.amount) && x.amount > 0);

        if (!normalized.length && legacy.length) throw new Error('No valid legacy records could be parsed');
        const codes = new Set();
        for (const item of normalized) {
            if (codes.has(item.loan_code)) throw new Error('Duplicate legacy loan ID found; migration stopped safely');
            codes.add(item.loan_code);
        }

        const names = [...new Set(normalized.map(x => x.name))];
        const borrowerRows = names.map(name => ({ name, notes: 'Imported from legacy Gist' }));
        const insertedBorrowers = borrowerRows.length ? await sb('borrowers', 'POST', borrowerRows) : [];
        const borrowerByName = new Map((insertedBorrowers || []).map(b => [String(b.name).toUpperCase(), b.id]));

        const loanRows = normalized.map(item => ({
            borrower_id: borrowerByName.get(item.name),
            loan_code: item.loan_code,
            amount: item.amount,
            loan_date: null,
            loan_year: null,
            status: 'active',
            notes: 'Imported from legacy Gist; original loan date/year were not stored.'
        }));
        if (loanRows.some(x => !x.borrower_id)) throw new Error('Borrower mapping failed');
        const insertedLoans = loanRows.length ? await sb('loans', 'POST', loanRows) : [];
        const loanByCode = new Map((insertedLoans || []).map(l => [String(l.loan_code), l.id]));

        const emiRows = [];
        for (const item of normalized) {
            const loanId = loanByCode.get(item.loan_code);
            if (!loanId) throw new Error('Loan mapping failed');
            emiRows.push(...parseEmis(item.emis, loanId));
        }
        if (emiRows.length) await sb('emis', 'POST', emiRows);

        await sb('activity_log', 'POST', {
            action: 'LEGACY_IMPORT',
            table_name: 'loans',
            description: `Imported ${insertedLoans?.length || 0} legacy loans and ${emiRows.length} EMI rows from the previous Gist store.`
        });

        return res.status(200).json({
            success: true,
            sourceUpdatedAt: gist.updated_at || null,
            legacyRecords: legacy.length,
            importedBorrowers: insertedBorrowers?.length || 0,
            importedLoans: insertedLoans?.length || 0,
            importedEmis: emiRows.length,
            skippedInvalidRecords: legacy.length - normalized.length
        });
    } catch (error) {
        console.error('Legacy migration failed:', error);
        return res.status(500).json({ error: 'Legacy migration failed safely; no source data was modified.' });
    }
}
