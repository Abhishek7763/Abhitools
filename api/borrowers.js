import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';

function textOrNull(value) {
    const v = typeof value === 'string' ? value.trim() : '';
    return v || null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    const { action } = req.query || {};

    try {
        if (req.method === 'GET' && !action) {
            const [borrowerRes, loanRes] = await Promise.all([
                supabaseRequest('borrowers?deleted_at=is.null&select=*&order=name.asc'),
                supabaseRequest('loans?deleted_at=is.null&select=id,borrower_id,loan_code,amount,status,loan_year,emis(*)&order=created_at.desc')
            ]);
            const byBorrower = new Map();
            for (const loan of (loanRes.data || [])) {
                const list = byBorrower.get(loan.borrower_id) || [];
                list.push(loan);
                byBorrower.set(loan.borrower_id, list);
            }
            return res.status(200).json((borrowerRes.data || []).map(b => ({ ...b, loans: byBorrower.get(b.id) || [] })));
        }

        if (req.method === 'GET' && action === 'profile') {
            const id = String(req.query?.id || '').trim();
            if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Valid borrower id required' });
            const [borrowerRes, loansRes, documentsRes] = await Promise.all([
                supabaseRequest(`borrowers?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=*`),
                supabaseRequest(`loans?borrower_id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=*,emis(*),loan_settlements(*)&order=created_at.desc`),
                supabaseRequest(`documents?borrower_id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=id,loan_id,doc_type,file_name,file_url,uploaded_at&order=uploaded_at.desc`)
            ]);
            const borrower = borrowerRes.data?.[0] || null;
            if (!borrower) return res.status(404).json({ error: 'Borrower not found' });
            const loans = loansRes.data || [];
            const documents = documentsRes.data || [];
            let principalTotal=0,activePrincipal=0,scheduledTotal=0,paidTotal=0,remainingTotal=0,waivedTotal=0,overdueAmount=0,overdueEmis=0,paidEmis=0,partialEmis=0,pendingEmis=0,yearNotSetEmis=0;
            for (const loan of loans) {
                const principal = Number.parseInt(loan.amount,10)||0;
                principalTotal += principal;
                if (loan.status === 'active') activePrincipal += principal;
                let loanRawRemaining=0,loanOverdue=0;
                for (const emi of (loan.emis||[])) {
                    const amount=Number.parseInt(emi.amount,10)||0;
                    const paid=Math.max(0,Math.min(Number.parseInt(emi.paid_amount,10)||0,amount));
                    const remaining=Math.max(amount-paid,0);
                    scheduledTotal+=amount; paidTotal+=paid; loanRawRemaining+=remaining;
                    if (!emi.due_year || !emi.due_date) yearNotSetEmis += 1;
                    if (emi.status==='paid' || (amount>0 && paid>=amount)) paidEmis += 1;
                    else if (paid>0) partialEmis += 1; else pendingEmis += 1;
                    if (emi.status==='overdue' && remaining>0) loanOverdue += remaining;
                }
                const activeSettlement=(loan.loan_settlements||[]).find(x=>!x.reopened_at)||null;
                const waived=activeSettlement?Math.max(0,Number.parseInt(activeSettlement.waived_amount,10)||0):0;
                waivedTotal+=waived;
                remainingTotal+=activeSettlement?Math.max(loanRawRemaining-waived,0):loanRawRemaining;
                if (!activeSettlement) {
                    overdueAmount+=loanOverdue;
                    if (loanOverdue>0) overdueEmis += (loan.emis||[]).filter(e=>e.status==='overdue'&&(Number(e.amount)||0)>(Number(e.paid_amount)||0)).length;
                }
            }
            return res.status(200).json({ borrower, loans, documents, summary: {
                totalLoans:loans.length, activeLoans:loans.filter(l=>l.status==='active').length, closedLoans:loans.filter(l=>l.status==='closed').length,
                defaultedLoans:loans.filter(l=>l.status==='defaulted').length, principalTotal,activePrincipal,scheduledTotal,paidTotal,remainingTotal,waivedTotal,
                overdueAmount,overdueEmis,paidEmis,partialEmis,pendingEmis,yearNotSetEmis,documentCount:documents.length
            }});
        }

        if (req.method === 'GET' && action === 'single') {
            const id=String(req.query?.id||'').trim();
            if (!UUID_RE.test(id)) return res.status(400).json({ error:'Valid id required' });
            const [bRes,lRes,dRes] = await Promise.all([
                supabaseRequest(`borrowers?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=*`),
                supabaseRequest(`loans?borrower_id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=id,loan_code,amount,status,loan_year,loan_date,interest_rate,notes,emis(*)`),
                supabaseRequest(`documents?borrower_id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=*`)
            ]);
            const borrower=bRes.data?.[0]||null;
            return res.status(200).json(borrower?{...borrower,loans:lRes.data||[],documents:dRes.data||[]}:null);
        }

        if (req.method === 'POST' && action === 'add') {
            const { name,father_name,phone,whatsapp,address,aadhaar,pan,notes }=req.body||{};
            if (!String(name||'').trim()) return res.status(400).json({ error:'Name required' });
            const { data }=await supabaseRequest('borrowers','POST',{ name:String(name).trim().toUpperCase(),father_name:textOrNull(father_name),phone:textOrNull(phone),whatsapp:textOrNull(whatsapp)||textOrNull(phone),address:textOrNull(address),aadhaar:textOrNull(aadhaar),pan:textOrNull(pan),notes:textOrNull(notes) });
            const borrower=data?.[0];
            if (borrower?.id) await supabaseRequest('activity_log','POST',{ action:'ADD_BORROWER',table_name:'borrowers',record_id:borrower.id,description:`Borrower added: ${String(name).trim().toUpperCase()}` });
            return res.status(201).json({ success:true,borrower });
        }

        if (req.method === 'PUT' && action === 'update') {
            const { id,name,father_name,phone,whatsapp,address,aadhaar,pan,notes,photo_url }=req.body||{};
            if (!UUID_RE.test(String(id||''))) return res.status(400).json({ error:'Valid id required' });
            const { data: rows } = await supabaseRequest(`borrowers?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=id`);
            if (!rows?.length) return res.status(404).json({ error:'Borrower not found' });
            const patch={ father_name:textOrNull(father_name),phone:textOrNull(phone),whatsapp:textOrNull(whatsapp)||textOrNull(phone),address:textOrNull(address),aadhaar:textOrNull(aadhaar),pan:textOrNull(pan),notes:textOrNull(notes),photo_url:textOrNull(photo_url) };
            if (String(name||'').trim()) patch.name=String(name).trim().toUpperCase();
            await supabaseRequest(`borrowers?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`,'PATCH',patch);
            await supabaseRequest('activity_log','POST',{ action:'UPDATE_BORROWER',table_name:'borrowers',record_id:id,description:`Borrower updated${patch.name?`: ${patch.name}`:''}` });
            return res.status(200).json({ success:true });
        }

        if (req.method === 'DELETE' && action === 'delete') {
            const id=String(req.body?.id||'').trim();
            if (!UUID_RE.test(id)) return res.status(400).json({ error:'Valid id required' });
            const { data }=await supabaseRequest('rpc/abhi_recycle_borrower','POST',{ p_borrower_id:id });
            return res.status(200).json(Array.isArray(data)?(data[0]||{success:true}):(data||{success:true}));
        }

        res.setHeader('Allow','GET, POST, PUT, DELETE');
        return res.status(404).json({ error:'Action not found' });
    } catch (err) {
        return sendServerError(res,'Borrowers API Error:',err);
    }
}
