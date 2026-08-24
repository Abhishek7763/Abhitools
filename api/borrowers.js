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
