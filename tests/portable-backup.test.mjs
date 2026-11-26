import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMedia, mediaTicket, serveTransferWorker } from '../server_routes/portable_backup.js';
import handler from '../api/backup.js';

process.env.SUPABASE_URL = 'https://target.test';
process.env.SUPABASE_SERVICE_KEY = 'local-test-service-key';
const object = { bucket: 'photos', name: 'borrowers/a/photo 1.jpg', size: 8, type: 'image/jpeg', sha256: 'b'.repeat(64) };

function file() {
    return { version: 8, media: { version: 1, origin: 'https://source.test', files: [{ ...object }] },
        data: { borrowers: [{ photo_url: 'https://source.test/storage/v1/object/public/photos/borrowers/a/photo%201.jpg' }],
            documents: [{ file_url: 'https://external.test/doc.pdf' }], loans: [] } };
}

function response() {
    return { headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(code) { this.code=code; return this; },
        json(body) { this.body=body; return this; }, send(body) { this.body=body; return this; } };
}

test('moves local media references to the target and counts external references', () => {
    const data = file();
    assert.deepEqual(checkMedia(data), { total: 8, external: 1 });
    assert.equal(data.data.borrowers[0].photo_url, 'https://target.test/storage/v1/object/public/photos/borrowers/a/photo%201.jpg');
    assert.equal(data.data.documents[0].file_url, 'https://external.test/doc.pdf');
});

test('rejects incomplete, duplicate and out-of-scope media manifests', () => {
    const missing = file();
    missing.media.files = [];
    assert.throws(() => checkMedia(missing), /missing/);
    const duplicate = file();
    duplicate.media.files.push({ ...object });
    assert.throws(() => checkMedia(duplicate), /duplicate/);
    for (const patch of [{ bucket: 'other' }, { name: 'borrowers/../other' }, { size: 8388609 }, { type: 'text/html' }, { sha256: 'bad' }]) {
        const invalid = file();
        Object.assign(invalid.media.files[0], patch);
        assert.throws(() => checkMedia(invalid));
    }
});

test('every portable backup action requires the admin session', async () => {
    for (const action of ['portable_catalog','media_ticket','media_check','media_worker','restore_file']) {
        const res = response();
        await handler({ query: { action }, headers: {}, method: 'POST' }, res);
        assert.equal(res.code, 401);
    }
});

test('transfer worker has a project-only connection policy and no server key', () => {
    const res = response();
    serveTransferWorker(res);
    assert.equal(res.code,200);
    assert.match(res.headers['Content-Security-Policy'], /connect-src https:\/\/target\.test;/);
    assert.ok(!res.body.includes(process.env.SUPABASE_SERVICE_KEY));
});

test('restore tickets sign a single missing path without upsert and reject off-project redirects', async t => {
    const calls = [];
    let raw = '/object/upload/sign/photos/borrowers/a/photo%201.jpg?token=test';
    t.mock.method(globalThis,'fetch', async (url,opts) => {
        calls.push({ url: String(url), opts });
        return new Response(JSON.stringify(String(url).includes('/rpc/') ? null : { url: raw }));
    });
    const req = { body: { ...object, mode: 'restore' } };
    const res = response();
    await mediaTicket(req, res);
    assert.equal(res.body.mode,'upload');
    assert.equal(res.body.url,'https://target.test/storage/v1'+raw);
    assert.equal(calls[1].opts.headers['x-upsert'],undefined);
    raw='https://external.test/object/upload/sign/photos/borrowers/a/p.jpg?token=test';
    await assert.rejects(() => mediaTicket(req, response()), /invalid/);
    await assert.rejects(() => mediaTicket({ body: { ...object, mode:'read' } }, response()), /missing/);
});
