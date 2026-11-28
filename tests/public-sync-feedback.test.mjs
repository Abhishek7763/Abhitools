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

test('clearing the search prevents a late server result from replacing the full directory', async () => {
    const elements = new Map();
    const ring = { hidden: true };
    const document = {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, {
                value: '', setAttribute() {}, querySelector() { return ring; }
            });
            return elements.get(id);
        }
    };
    const started = Promise.withResolvers();
    const reply = Promise.withResolvers();
    const page = {
        window: {}, document, AbortController, setTimeout, clearTimeout,
        fetch(url, options) { started.resolve(options.signal); return reply.promise; }
    };
    const source = readFileSync(new URL('../public_script.js', import.meta.url), 'utf8');
    runInNewContext(source, page);
    page.folders = [{ name:'Asha', label:'L-101' }, { name:'Neha', label:'L-102' }];
    runInNewContext('directory.folders = folders; lastDirectoryUpdate = new Date()', page);
    let displayed = [];
    page.renderFolders = rows => { displayed = [...rows]; };
    const field = document.getElementById('searchInput');
    field.value = 'ash';
    page.refreshFolderSearch(0);
    const signal = await started.promise;
    assert.equal(ring.hidden, false);
    assert.deepEqual(displayed, [page.folders[0]]);

    field.value = '';
    page.refreshFolderSearch();
    assert.equal(signal.aborted, true);
    reply.resolve({ok:true, json:async () => ({folders:[]})});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.getElementById('folderSearchFeedback').hidden, true);
    assert.deepEqual(displayed, page.folders);
});
