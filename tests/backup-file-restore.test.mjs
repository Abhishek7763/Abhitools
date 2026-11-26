import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';

process.env.ADMIN_PASS = process.env.ADMIN_PASS || 'test-only-secret';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const { createAdminSession } = await import('../server_shared.js');
const backup = await import('../api/backup.js');
const { validateBackupFile } = backup;

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function sampleFile() {
    return {
        format: 'abhitools-backup',
        version: 7,
        created_at: '2026-11-17T00:00:00.000Z',
        data: {
            app_settings: [{ id: 'primary', config: {}, updated_at: '2026-11-01T00:00:00Z' }],
            collection_followups: [],
            borrowers: [{ id: U(1), name: 'TEST BORROWER' }],
            loans: [{ id: U(2), borrower_id: U(1), loan_code: 'ID1', amount: 1000 }],
            emis: [{ id: U(3), loan_id: U(2), installment_number: 1, due_day: 5, due_month: 'DEC', amount: 100, status: 'pending' }],
            loan_settlements: [],
            emi_payments: [],
            documents: [],
            recycle_bin: []
        }
    };
}

function mockRes() {
    return {
        headers: {}, statusCode: 200, body: undefined,
        setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.body = obj; return this; },
        send(text) { this.body = text; return this; }
    };
}

function adminReq(body) {
    const token = createAdminSession();
    return { method: 'POST', query: { action: 'restore_file' }, headers: { cookie: `abhi_admin_session=${encodeURIComponent(token)}` }, body };
}

test('valid backup file becomes a v7 snapshot payload with all present tables', () => {
    const { payload, counts } = validateBackupFile(sampleFile());
    assert.equal(payload.format, 'abhitools-snapshot');
    assert.equal(payload.version, 7);
    assert.equal(counts.borrowers, 1);
    assert.equal(counts.emis, 1);
    assert.ok(Array.isArray(payload.app_settings));
});

test('tables missing from an older backup are not staged (so settings are preserved)', () => {
    const file = sampleFile();
    delete file.data.app_settings;
    const { payload } = validateBackupFile(file);
    assert.equal('app_settings' in payload, false);
});

test('empty borrower list, wrong format and dangling references are rejected', () => {
    const empty = sampleFile(); empty.data.borrowers = []; empty.data.loans = []; empty.data.emis = [];
    assert.throws(() => validateBackupFile(empty), /borrower/);

    const wrong = sampleFile(); wrong.format = 'something-else';
    assert.throws(() => validateBackupFile(wrong), /Full Backup/);

    const dangling = sampleFile(); dangling.data.emis[0].loan_id = U(99);
    assert.throws(() => validateBackupFile(dangling), /emis\.loan_id/);

    const dup = sampleFile(); dup.data.borrowers.push({ id: U(1), name: 'DUP' });
    assert.throws(() => validateBackupFile(dup), /duplicate/);

    const future = sampleFile(); future.version = 99;
    assert.throws(() => validateBackupFile(future), /supported/);
});

test('restore_file stages and restores through one transactional database call', async t => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url: String(url), body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ success: true, staged_snapshot_id: U(500) }));
    });
    const res = mockRes();
    await backup.default(adminReq({ payload: sampleFile(), confirm: true, label: 'test.json' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.staged_snapshot_id, U(500));
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /rpc\/abhi_restore_backup_file$/);
    assert.equal(calls[0].body.p_payload.format, 'abhitools-snapshot');
    assert.equal(calls[0].body.p_counts.loans, 1);
});

test('restore_file needs confirmation and writes nothing when the file is invalid', async () => {
    let fetchCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetchCalls++; return { ok: true, status: 200, text: async () => '[]' }; };
    try {
        const noConfirm = mockRes();
        await backup.default(adminReq({ payload: sampleFile() }), noConfirm);
        assert.equal(noConfirm.statusCode, 400);

        const bad = sampleFile(); bad.data.emis[0].loan_id = U(99);
        const invalid = mockRes();
        await backup.default(adminReq({ payload: bad, confirm: true }), invalid);
        assert.equal(invalid.statusCode, 400);
        assert.match(invalid.body.error, /file me nahi hai/);
        assert.equal(fetchCalls, 0);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('restore_file is admin-only', async () => {
    const res = mockRes();
    await backup.default({ method: 'POST', query: { action: 'restore_file' }, headers: {}, body: { payload: sampleFile(), confirm: true } }, res);
    assert.equal(res.statusCode, 401);
});

function sampleV8() {
    const file = sampleFile();
    file.version = 8;
    file.data.upi_payment_config = [];
    file.data.upi_payment_requests = [{ id: U(4), borrower_id: U(1), loan_id: U(2), emi_id: U(3) }];
    file.data.activity_log = [];
    return file;
}

test('v8 requires every table, checks UPI references and supports a genuinely empty dataset', () => {
    const file = sampleV8();
    assert.deepEqual(validateBackupFile(file).payload.upi_payment_requests, file.data.upi_payment_requests);
    file.data.upi_payment_requests[0].emi_id = U(99);
    assert.throws(() => validateBackupFile(file), /upi_payment_requests.emi_id/);
    for (const key of Object.keys(file.data)) file.data[key] = [];
    assert.equal(validateBackupFile(file).counts.borrowers, 0);
    delete file.data.emis;
    assert.throws(() => validateBackupFile(file), /emis missing/);
});

test('large export compresses and previews completely without a write', async t => {
    const file = sampleV8();
    file.data.borrowers[0].notes = 'L'.repeat(3500001);
    const fetch = t.mock.method(globalThis, 'fetch', async url => {
        assert.match(String(url), /abhi_backup_data$/);
        return new Response(JSON.stringify(file.data));
    });
    const req = adminReq({});
    req.method = 'GET'; req.query.action = 'export';
    const exported = mockRes();
    await backup.default(req, exported);
    assert.match(exported.headers['Content-Disposition'], /json.gz/);
    assert.deepEqual(JSON.parse(gunzipSync(exported.body)).data, file.data);
    req.method = 'POST'; req.query.action = 'preview_file'; req.body.gzip = exported.body.toString('base64');
    const preview = mockRes();
    await backup.default(req, preview);
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.counts.upi_payment_requests, 1);
    assert.equal(fetch.mock.callCount(), 1);
    req.body.gzip = gzipSync('invalid JSON').toString('base64');
    const invalid = mockRes();
    await backup.default(req, invalid);
    assert.equal(invalid.statusCode, 400);
});

test('reset requires an admin session, POST and the exact phrase', async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected write'); });
    const req = adminReq({ job_id: U(22), confirm: 'delete' });
    req.query.action = 'reset_start';
    for (const [method, headers, status] of [['POST', {}, 401], ['GET', req.headers, 405], ['POST', req.headers, 400]]) {
        const res = mockRes();
        await backup.default({ ...req, method, headers }, res);
        assert.equal(res.statusCode, status);
    }
    assert.equal(fetch.mock.callCount(), 0);
});

test('cleanup deletes the captured Storage batch and checks what remains before reporting success', async t => {
    const job = U(22);
    const responses = [job, { remaining: 1, files: [{ bucket: 'photos', name: 'borrowers/test/p.jpg' }] }, [], { remaining: 0, files: [] }];
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url: String(url), method: options.method, body: JSON.parse(options.body) });
        return new Response(JSON.stringify(responses.shift()));
    });
    const req = adminReq({ job_id: job, confirm: 'DELETE ALL' });
    req.query.action = 'reset_start';
    const start = mockRes();
    await backup.default(req, start);
    assert.equal(start.body.job_id, job);
    req.query.action = 'reset_continue';
    const end = mockRes();
    await backup.default(req, end);
    assert.equal(end.body.remaining, 0);
    assert.equal(calls.length, 4);
    assert.match(calls[1].url, /abhi_reset_file_batch$/);
    assert.match(calls[2].url, /storage\/v1\/object\/photos$/);
    assert.deepEqual(calls[2].body.prefixes, ['borrowers/test/p.jpg']);
    assert.equal(calls[2].method, 'DELETE');
    assert.match(calls[3].url, /abhi_reset_file_batch$/);
});
