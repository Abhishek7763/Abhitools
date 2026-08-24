import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

function textOrNull(value) {
    const v = typeof value === 'string' ? value.trim() : '';
    return v || null;
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;

    const { action } = req.query || {};

    try {
        if (req.method === 'GET' && !action) {
            const { data } = await supabaseRequest(
                'borrowers?select=*,loans(id,loan_code,amount,status,loan_year,emis(*))&order=name.asc'
            );
            return res.status(200).json(data || []);
        }


        if (req.method === 'GET' && action === 'profile') {
            const id = String(req.query?.id || '').trim();
            const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!uuidRe.test(id)) return res.status(400).json({ error: 'Valid borrower id required' });

            const [borrowerRes, loansRes, documentsRes] = await Promise.all([
                supabaseRequest(`borrowers?id=eq.${encodeURIComponent(id)}&select=*`),
                supabaseRequest(`loans?borrower_id=eq.${encodeURIComponent(id)}&select=*,emis(*)&order=created_at.desc`),
                supabaseRequest(`documents?borrower_id=eq.${encodeURIComponent(id)}&select=id,loan_id,doc_type,file_name,file_url,uploaded_at&order=uploaded_at.desc`)
            ]);

            const borrower = borrowerRes.data?.[0] || null;
            if (!borrower) return res.status(404).json({ error: 'Borrower not found' });

            const loans = loansRes.data || [];
            const documents = documentsRes.data || [];
            let principalTotal = 0;
            let activePrincipal = 0;
            let scheduledTotal = 0;
            let paidTotal = 0;
            let remainingTotal = 0;
            let overdueAmount = 0;
            let overdueEmis = 0;
            let paidEmis = 0;
            let partialEmis = 0;
            let pendingEmis = 0;
            let yearNotSetEmis = 0;

            for (const loan of loans) {
                const principal = Number.parseInt(loan.amount, 10) || 0;
                principalTotal += principal;
                if (loan.status === 'active') activePrincipal += principal;
                for (const emi of (loan.emis || [])) {
                    const amount = Number.parseInt(emi.amount, 10) || 0;
                    const paid = Math.max(0, Math.min(Number.parseInt(emi.paid_amount, 10) || 0, amount));
                    const remaining = Math.max(amount - paid, 0);
                    scheduledTotal += amount;
                    paidTotal += paid;
                    remainingTotal += remaining;
                    if (!emi.due_year || !emi.due_date) yearNotSetEmis += 1;
                    if (emi.status === 'paid' || (amount > 0 && paid >= amount)) paidEmis += 1;
                    else if (paid > 0) partialEmis += 1;
                    else pendingEmis += 1;
                    if (emi.status === 'overdue' && remaining > 0) {
                        overdueEmis += 1;
                        overdueAmount += remaining;
                    }
                }
            }

            return res.status(200).json({
                borrower,
                loans,
                documents,
                summary: {
                    totalLoans: loans.length,
                    activeLoans: loans.filter(l => l.status === 'active').length,
                    closedLoans: loans.filter(l => l.status === 'closed').length,
                    defaultedLoans: loans.filter(l => l.status === 'defaulted').length,
                    principalTotal,
                    activePrincipal,
                    scheduledTotal,
                    paidTotal,
                    remainingTotal,
                    overdueAmount,
                    overdueEmis,
                    paidEmis,
                    partialEmis,
                    pendingEmis,
                    yearNotSetEmis,
                    documentCount: documents.length
                }
            });
        }

        if (req.method === 'GET' && action === 'single') {
            const id = String(req.query?.id || '');
            if (!id) return res.status(400).json({ error: 'id required' });
            const { data } = await supabaseRequest(
                `borrowers?id=eq.${encodeURIComponent(id)}&select=*,loans(id,loan_code,amount,status,loan_year,loan_date,interest_rate,notes,emis(*)),documents(*)`
            );
            return res.status(200).json(data?.[0] || null);
        }

        if (req.method === 'POST' && action === 'add') {
            const { name, father_name, phone, whatsapp, address, aadhaar, pan, notes } = req.body || {};
            if (!String(name || '').trim()) return res.status(400).json({ error: 'Name required' });

            const { data } = await supabaseRequest('borrowers', 'POST', {
                name: String(name).trim().toUpperCase(),
                father_name: textOrNull(father_name),
                phone: textOrNull(phone),
                whatsapp: textOrNull(whatsapp) || textOrNull(phone),
                address: textOrNull(address),
                aadhaar: textOrNull(aadhaar),
                pan: textOrNull(pan),
                notes: textOrNull(notes)
            });

            const borrower = data?.[0];
            if (borrower?.id) {
                await supabaseRequest('activity_log', 'POST', {
                    action: 'ADD_BORROWER',
                    table_name: 'borrowers',
                    record_id: borrower.id,
                    description: `Borrower added: ${String(name).trim().toUpperCase()}`
                });
            }
            return res.status(201).json({ success: true, borrower });
        }

        if (req.method === 'PUT' && action === 'update') {
            const { id, name, father_name, phone, whatsapp, address, aadhaar, pan, notes, photo_url } = req.body || {};
            if (!id) return res.status(400).json({ error: 'id required' });

            const patch = {
                father_name: textOrNull(father_name),
                phone: textOrNull(phone),
                whatsapp: textOrNull(whatsapp) || textOrNull(phone),
                address: textOrNull(address),
                aadhaar: textOrNull(aadhaar),
                pan: textOrNull(pan),
                notes: textOrNull(notes),
                photo_url: textOrNull(photo_url)
            };
            if (String(name || '').trim()) patch.name = String(name).trim().toUpperCase();

            await supabaseRequest(`borrowers?id=eq.${encodeURIComponent(id)}`, 'PATCH', patch);
            await supabaseRequest('activity_log', 'POST', {
                action: 'UPDATE_BORROWER',
                table_name: 'borrowers',
                record_id: id,
                description: `Borrower updated${patch.name ? `: ${patch.name}` : ''}`
            });
            return res.status(200).json({ success: true });
        }

        if (req.method === 'DELETE' && action === 'delete') {
            const id = req.body?.id;
            if (!id) return res.status(400).json({ error: 'id required' });
            await supabaseRequest(`borrowers?id=eq.${encodeURIComponent(id)}`, 'DELETE');
            await supabaseRequest('activity_log', 'POST', {
                action: 'DELETE_BORROWER',
                table_name: 'borrowers',
                record_id: id,
                description: 'Borrower deleted'
            });
            return res.status(200).json({ success: true });
        }

        res.setHeader('Allow', 'GET, POST, PUT, DELETE');
        return res.status(404).json({ error: 'Action not found' });
    } catch (err) {
        return sendServerError(res, 'Borrowers API Error:', err);
    }
}
