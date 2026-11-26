import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/loans.js';

process.env.SUPABASE_URL = 'https://example.test';
process.env.SUPABASE_SERVICE_KEY = 'test-key';
const id = '00000000-0000-4000-8000-000000000001';

async function request(phone, borrower_id = id, method = 'POST') {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ method, headers: {}, query: method === 'POST' ? { action:'public_khata' } : {}, body:{ phone, borrower_id } }, res);
    return res;
}

test('card and valid mobile required', async () => {
    assert.equal((await request('abc')).code, 400);
    assert.equal((await request('9876543210', '')).code, 400);
});

test('other profile number, unset phone or deleted profile cannot open a card', async t => {
    let profiles;
    t.mock.method(globalThis, 'fetch', async url => {
        assert.equal(new URL(url).pathname, '/rest/v1/borrowers');
        assert.equal(new URL(url).searchParams.get('id'), 'eq.' + id);
        assert.equal(new URL(url).searchParams.get('deleted_at'), 'is.null');
        return Response.json(profiles);
    });
    for (profiles of [[{phone:'9876543211'}], [{phone:null}], []]) {
        assert.equal((await request('9876543210')).code, 403);
    }
});

test('formatted saved number opens only loans belonging to selected profile', async t => {
    t.mock.method(globalThis, 'fetch', async url => {
        const api = new URL(url);
        if (api.pathname.endsWith('/borrowers')) return Response.json([{phone:'+91 (98765) 43210'}]);
        assert.equal(api.searchParams.get('borrower_id'), 'eq.' + id);
        assert.doesNotMatch(api.searchParams.get('select'), /phone|address/);
        return Response.json([{loan_code:'L1'}]);
    });
    const res = await request('09876543210');
    assert.deepEqual(res.body, [{loan_code:'L1'}]);
});

test('anonymous directory excludes individual schedules and distinguishes namesakes', async t => {
    const rows = [id, 'other'].map(id => ({status:'active', amount:50, borrowers:{id, name:'Rahul'}, emis:[{due_month:'NOV', due_year:2026, amount:25}]}));
    t.mock.method(globalThis, 'fetch', async () => Response.json(rows));
    const res = await request(null, null, 'GET');
    assert.equal(res.body.total, 100);
    assert.equal(res.body.people.length, 2);
    assert.equal(res.body.months[0].people.length, 2);
    assert.doesNotMatch(JSON.stringify(res.body), /loan_code|emis|due_date|paid_amount/);
});
