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
            if (url.includes('abhi_review_import_matches')) return Response.json({ names: [], codes: [], candidates: [] });
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

test('same-name review keeps source identities and rejects missing, wrong and stale decisions', async t => {
    const rows = [
        { name:'TEST', id:'ONE', amount:90, phone:'5551234567' },
        { name:'TEST', id:'TWO', amount:70, father_name:'SECOND' }
    ];
    let candidate = [{ id:'existing', name:'TEST', phone_last4:'4455', loans:['OLD'] }];
    let applied;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        if (url.includes('abhi_review_import_matches')) return Response.json({ names:candidate.map(c=>c.name), codes:[], candidates:candidate });
        if (url.includes('recycle_bin?')) return Response.json([]);
        applied = JSON.parse(options.body).p_payload;
        return Response.json({success:true});
    });
    async function run(action, choices, mode='merge') {
        const req = { method:'POST', headers:{ cookie:'abhi_admin_session='+createAdminSession() }, query:{action},
            body:{ payload:rows, mode, borrower_choices:choices, confirmReplace:mode==='replace' } };
        const res = { setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;} };
        await handler(req,res);
        return res;
    }
    const preview=(await run('preview')).data;
    const [one,two]=preview.borrower_groups[0].incoming;
    assert.equal(one.phone_last4,'4567');
    assert.equal(two.father,'SECOND');
    assert.deepEqual(one.loans,['ONE']);
    assert.equal((await run('apply')).code,409);
    assert.equal((await run('apply',{[one.key]:'file:'+two.key,[two.key]:'new'})).code,409);
    assert.equal((await run('apply',{[one.key]:'db:existing',[two.key]:'new'})).code,200);
    assert.deepEqual(applied.borrowers.map(b=>b.match),[{kind:'existing',id:'existing'},{kind:'new'}]);
    assert.equal((await run('apply',{[two.key]:'file:'+one.key},'replace')).code,200);
    assert.deepEqual(applied.borrowers[1].match,{kind:'incoming',key:one.key});
    candidate=[];
    assert.equal((await run('apply',{[one.key]:'db:existing',[two.key]:'new'})).code,409);
});
