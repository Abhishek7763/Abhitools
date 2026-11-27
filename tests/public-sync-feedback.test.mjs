import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

test('manual refresh keeps the sync indicator visible until a failed request settles', async () => {
    const root = new URL('../', import.meta.url);
    const html = readFileSync(new URL('index.html', root), 'utf8');
    assert.match(html, /id="publicSyncLoader"[^>]*hidden>\s*<span class="abhi-sync-ring"/);

    const elements = new Map();
    const document = {
        body: { dataset: {} },
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, { dataset: {}, hidden: true, setAttribute() {} });
            return elements.get(id);
        }
    };
    const response = Promise.withResolvers();
    let requests = 0;
    const page = {
        document, window: {}, AbortController, setTimeout, clearTimeout,
        console: { error() {} },
        fetch() { requests++; return response.promise; }
    };
    runInNewContext(readFileSync(new URL('public_script.js', root), 'utf8'), page);
    const loader = document.getElementById('publicSyncLoader');
    const first = page.manualSync();
    const second = page.manualSync();
    assert.equal(requests, 1);
    assert.equal(loader.hidden, false);
    response.resolve({ ok: false });
    await Promise.all([first, second]);
    assert.equal(loader.hidden, true);
    assert.equal(document.getElementById('retryDirectory').hidden, false);
});
