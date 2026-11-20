import test from 'node:test';
import assert from 'node:assert/strict';

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

test('restore_file stages the file, then runs the transactional restore, in that order', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), method: options?.method, body: options?.body ? JSON.parse(options.body) : null });
        const text = String(url).includes('/rpc/abhi_restore_backup_snapshot')
            ? JSON.stringify({ success: true, summary: { borrowers: 1, loans: 1, emis: 1, emi_payments: 0 } })
            : JSON.stringify([{ id: U(500) }]);
        return { ok: true, status: 200, text: async () => text };
    };
    try {
        const res = mockRes();
        await backup.default(adminReq({ payload: sampleFile(), confirm: true, label: 'test.json' }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.staged_snapshot_id, U(500));
        assert.equal(calls.length, 2);
        assert.match(calls[0].url, /\/rest\/v1\/backup_snapshots$/);
        assert.equal(calls[0].body.reason, 'file-restore-source');
        assert.equal(calls[0].body.payload.format, 'abhitools-snapshot');
        assert.match(calls[1].url, /\/rest\/v1\/rpc\/abhi_restore_backup_snapshot$/);
        assert.equal(calls[1].body.p_snapshot_id, U(500));
    } finally {
        globalThis.fetch = realFetch;
    }
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
