import crypto from 'node:crypto';
import { noStore, requireAdmin, securityFingerprint, sendServerError, supabaseRequest } from '../server_shared.js';

export default async function privateLedger(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
    const { pin, entry } = req.body || {};
    const secret = process.env.PRIVATE_KHATA_PIN;
    if (!secret || secret.length < 6) return res.status(503).json({ error: 'Private khata PIN setup baaki hai.' });
    try {
        const bucket = securityFingerprint('private-khata', 'owner');
        const limit = async action => {
            const { data } = await supabaseRequest('rpc/abhi_admin_login_rate_limit', 'POST', {
                p_bucket_hash: bucket, p_action: action
            });
            return Array.isArray(data) ? data[0] : data;
        };
        if ((await limit('check'))?.allowed !== true) return res.status(429).json({ error: 'Thodi der baad koshish karein.' });
        const digest = value => crypto.createHash('sha256').update(value).digest();
        if (typeof pin !== 'string' || !crypto.timingSafeEqual(digest(pin), digest(secret))) {
            await limit('fail');
            return res.status(403).json({ error: 'PIN galat hai.' });
        }
        if (entry !== undefined) {
            const person = String(entry?.person || '').trim();
            if (!person || person.length > 100 || !['given', 'received'].includes(entry?.direction)
                || !/^\d{1,10}(\.\d{1,2})?$/.test(String(entry?.amount)) || Number(entry.amount) <= 0
                || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(entry?.id || '')) {
                return res.status(400).json({ error: 'Naam aur rakam check karein.' });
            }
            await supabaseRequest('private_ledger_entries?on_conflict=id', 'POST', {
                id: entry.id, person, amount: entry.amount, direction: entry.direction
            }, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
        }
        const { data } = await supabaseRequest('private_ledger_entries?select=person,direction,amount,created_at&order=created_at.desc,id.desc&limit=50');
        return res.status(200).json({ entries: data });
    } catch (err) {
        return sendServerError(res, 'Private ledger error', err);
    }
}
