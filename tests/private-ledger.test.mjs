import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/dashboard.js';
import { createAdminSession } from '../server_shared.js';

process.env.ADMIN_PASS = 'unit-test-password';
process.env.PRIVATE_KHATA_PIN = 'unit-test-pin';
process.env.SUPABASE_URL = 'https://example.test';
process.env.SUPABASE_SERVICE_KEY = 'unit-test-key';
function invoke(cookie, body) {
    const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; } };
    return handler({ method:'POST', headers:{ cookie }, query:{ mode:'private-ledger' }, body }, res).then(() => res);
}
test('private entries require both admin session and private PIN', async t => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async url => {
        calls.push(url);
        return Response.json(url.includes('/rpc/') ? { allowed:true } : []);
    });
    assert.equal((await invoke('', { pin:process.env.PRIVATE_KHATA_PIN })).code, 401);
    assert.equal(calls.length, 0);
    const cookie = 'abhi_admin_session=' + createAdminSession();
    assert.equal((await invoke(cookie, { pin:'wrong' })).code, 403);
    assert.ok(calls.every(url => url.includes('/rpc/')));
    const entry = { id:crypto.randomUUID(), person:'Demo', amount:'50.50', direction:'given' };
    const res = await invoke(cookie, { pin:process.env.PRIVATE_KHATA_PIN, entry });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.entries, []);
    assert.ok(calls.some(url => url.includes('private_ledger_entries?on_conflict=id')));
});
