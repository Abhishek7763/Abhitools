import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/loans.js';

process.env.SUPABASE_URL = 'https://example.test';
process.env.SUPABASE_SERVICE_KEY = 'test-key';

function lookup(phone) {
    const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(body) { this.body = body; } };
    return handler({ method: 'POST', headers: {}, query: { action: 'public_khata' }, body: { phone } }, res).then(() => res);
}

test('invalid number is rejected before any database request', async () => {
    assert.equal((await lookup('abc123')).code, 400);
});

test('anonymous lookup selects only public fields and matches formatted Indian numbers', async t => {
    let query;
    t.mock.method(globalThis, 'fetch', async url => {
        query = new URL(url).searchParams;
        return new Response('[]');
    });
    for (const number of ['9876543210', '+91 98765-43210', '09876543210']) {
        const response = await lookup(number);
        assert.equal(response.code, 200);
        assert.deepEqual(response.body, []);
        assert.equal(query.get('deleted_at'), 'is.null');
        assert.match(query.get('select'), /borrowers!inner\(name\)/);
        assert.doesNotMatch(query.get('select'), /phone|address|photo_url/);
        const pattern = query.get('borrowers.phone').slice('match.'.length).replaceAll('[[:space:]()-]', '[\\s()-]');
        assert.match('+91 (98765) 43210', new RegExp(pattern));
        assert.doesNotMatch('19876543210', new RegExp(pattern));
    }
});
