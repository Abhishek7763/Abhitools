import { createHash, timingSafeEqual } from 'node:crypto';
import { getClientAddress, securityFingerprint, supabaseRequest } from '../server_shared.js';

const lifetime = 15 * 60 * 1000;
const idPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function issueAccess(owner) {
    const expires = Date.now() + lifetime;
    const payload = owner + '.' + expires;
    return { token: payload + '.' + securityFingerprint('borrower-access',payload), expires };
}

export function verifiedOwner(req) {
    const [scheme, token] = String(req.headers?.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token || token.length > 160) return null;
    const [id,expires,signature,...extra] = token.split('.');
    if (extra.length || !idPattern.test(id) || !/^\d{13}$/.test(expires) || Number(expires) <= Date.now() || !/^[a-f0-9]{64}$/.test(signature)) return null;
    const expected = securityFingerprint('borrower-access',id + '.' + expires);
    return timingSafeEqual(Buffer.from(signature),Buffer.from(expected)) ? id : null;
}

async function accountLoans(owner) {
    const key = createHash('sha256').update('public-folder:' + owner).digest('hex');
    const { data } = await supabaseRequest('loans?borrower_id=eq.' + owner +
        '&deleted_at=is.null&borrowers.deleted_at=is.null&select=id,loan_code,amount,status,loan_year,borrowers!inner(name),emis(installment_number,due_date,due_day,due_month,due_year,amount,status,paid_date,paid_amount)&order=created_at.desc');
    return data.map(loan => ({ ...loan, folder_key:key }));
}

export async function borrowerAccess(action,req,res) {
    if (action === 'directory' && req.method === 'GET') {
        const {data} = await supabaseRequest('rpc/abhi_public_directory','POST',{ p_search:String(req.query?.q || '').trim().slice(0,200) });
        return res.status(200).json(data);
    }
    if (action === 'account' && req.method === 'GET') {
        const owner = verifiedOwner(req);
        if (!owner) return res.status(401).json({ error:'Apna registered mobile number darj karein.' });
        return res.status(200).json(await accountLoans(owner));
    }
    if (action === 'unlock' && req.method === 'POST') {
        const key = String(req.body?.folder || '');
        const raw = String(req.body?.phone || '').trim();
        const match = raw.length <= 26 && raw.replace(/[\s()+.\-]/g,'').match(/^(?:91|0)?(\d{10})$/);
        if (!/^[a-f0-9]{64}$/.test(key) || !match) return res.status(400).json({ error:'10 digit ka registered mobile number daalein.' });
        const ip = req.headers?.['x-vercel-forwarded-for'] || getClientAddress(req);
        const {data} = await supabaseRequest('rpc/abhi_unlock_borrower','POST',{
            p_key:key, p_phone:match[1], p_bucket:securityFingerprint('borrower-phone-attempt',String(ip))
        });
        if (data?.allowed === false) {
            res.setHeader('Retry-After',String(data.retry_after_seconds || 600));
            return res.status(429).json({error:'Kai galat attempts hue hain. Kuch der baad dobara koshish karein.'});
        }
        if (!idPattern.test(data?.borrower_id || '')) return res.status(403).json({error:'Number match nahi hua. Is account ka registered mobile number check karein.'});
        return res.status(200).json({ ...issueAccess(data.borrower_id), loans:await accountLoans(data.borrower_id) });
    }
    return res.status(405).json({error:'Method not allowed'});
}
