import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/import.js';
import { createAdminSession } from '../server_shared.js';

process.env.ADMIN_SESSION_SECRET = 'test-session-secret';
process.env.SUPABASE_URL = 'https://fixture.test';
process.env.SUPABASE_SERVICE_KEY = 'fixture-key';

const emi = amount => ({ installment_number: 1, due_day: 5, due_month: 'DEC', amount });

const scenarios = [
    ['legacy', [
        { id: 'DUP', name: 'TEST', amount: 90, emis: '(1) 05-DEC-90' },
        { id: 'DUP', name: 'TEST', amount: 70, emis: '(1) 05-DEC-70' }
    ]],
    ['structured', {
        borrowers: [{ id: 'b', name: 'TEST' }],
        loans: [90, 70].map(amount => ({ borrower_id: 'b', loan_code: 'DUP', amount, emis: [emi(amount)] }))
    }]
];

for (const [format, payload] of scenarios) {
    test(format + ' duplicate loan does not contribute EMIs to the retained loan', async t => {
        let applied;
        t.mock.method(globalThis, 'fetch', async (url, options) => {
            if (url.includes('abhi_import_matches')) return Response.json({ names: [], codes: [] });
            if (url.includes('recycle_bin?')) return Response.json([]);
            assert.ok(url.endsWith('/rpc/abhi_import_with_history'));
            applied = JSON.parse(options.body).p_payload;
            return Response.json({ success: true });
        });
        const req = { method: 'POST', headers: { cookie: 'abhi_admin_session=' + createAdminSession() },
            query: { action: 'apply' }, body: { payload, mode: 'merge' } };
        const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
        await handler(req, res);
        assert.equal(res.code, 200);
        const { counts, skipped } = res.body.preview;
        assert.equal(counts.loans, 1);
        assert.equal(counts.emis, 1);
        assert.equal(skipped.loans, 1);
        assert.equal(skipped.emis, 1);
        assert.deepEqual(applied.emis.map(e => [e.loan_key,e.amount]), [[applied.loans[0].source_key,90]]);
    });
}
