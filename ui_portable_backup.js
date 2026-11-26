const portableMiB = 1024 * 1024;
const portableMaxFiles = 2000;
let portableExporting = false;

async function fileDigest(bytes) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function uploadEntry(index) {
    return 'uploads/' + String(index + 1).padStart(6, '0');
}

function checkUploadBytes(file, bytes) {
    const starts = (...prefix) => prefix.every((b, i) => bytes[i] === b);
    const valid = {
        'image/jpeg': () => starts(255,216,255),
        'image/png': () => starts(137,80,78,71,13,10,26,10),
        'image/webp': () => starts(82,73,70,70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80,
        'application/pdf': () => starts(37,80,68,70,45)
    };
    if (bytes.length !== file.size || !Object.hasOwn(valid,file.type) || !valid[file.type]()) {
        throw new Error('File ka size ya type match nahi hua: ' + file.name);
    }
}

// Each short-lived worker handles one file under the Storage-origin CSP returned by the admin API.
function transferMedia(ticket, file, bytes) {
    return new Promise((resolve, reject) => {
        const worker = new Worker('/api/backup?action=media_worker');
        const timer = setTimeout(() => finish(new Error('Storage transfer timeout. Dobara try karein.')), 130000);
        function finish(error, value) {
            clearTimeout(timer);
            worker.terminate();
            if (error) reject(error); else resolve(value);
        }
        worker.onmessage = ({ data }) => data.ok ? finish(null, data.bytes) : finish(new Error(data.error));
        worker.onerror = () => finish(new Error('Storage transfer connect nahi hua.'));
        worker.postMessage({ url: ticket.url, mode: ticket.mode, type: file.type, size: file.size, bytes });
    });
}

async function ticketFor(file, mode) {
    const { bucket, name, size, type, sha256 } = file;
    return backupPost('media_ticket', { bucket, name, size, type, sha256, mode });
}

function portableStatus(message) {
    for (const box of document.querySelectorAll('[data-portable-status]')) {
        box.hidden = false;
        box.textContent = message;
    }
}

async function downloadPortableBackup() {
    if (portableExporting) return;
    portableExporting = true;
    const buttons = document.querySelectorAll('[data-portable-export]');
    for (const button of buttons) button.disabled = true;
    try {
        portableStatus('Records aur uploads ki list ban rahi hai…');
        const response = await adminFetch('/api/backup?action=portable_catalog', { cache: 'no-store' });
        const json = response.headers.get('Content-Type')?.includes('application/gzip')
            ? await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json()
            : await response.json();
        const files = json.media.files;
        const entries = Object.create(null);
        const revisions = [];
        for (const [i, file] of files.entries()) {
            portableStatus(`File ${i + 1}/${files.length} download ho rahi hai…`);
            const ticket = await ticketFor(file, 'read');
            if (ticket.current?.revision !== file.revision) throw new Error('Backup ke beech file badal gayi. Dobara try karein.');
            const bytes = new Uint8Array(await transferMedia(ticket, file));
            checkUploadBytes(file, bytes);
            file.sha256 = await fileDigest(bytes);
            entries[uploadEntry(i)] = bytes;
            revisions.push({ bucket: file.bucket, name: file.name, revision: file.revision });
            delete file.revision;
        }
        await backupPost('media_check', { files: revisions });
        const records = new TextEncoder().encode(JSON.stringify(json));
        // Make sure this build can also send these records back through the restore endpoint.
        await prepareRestoreUpload(new Blob([records]));
        entries['backup.json'] = records;
        entries['index.json'] = new TextEncoder().encode(JSON.stringify({
            format: 'abhitools-portable', version: 1, records_sha256: await fileDigest(records)
        }));
        const archive = fflate.zipSync(entries, { level: 0 });
        const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'AbhiTools_Full_' + json.created_at.replace(/[:.]/g, '-') + '.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        const extra = json.media.external_links ? ` ${json.media.external_links} baahari links sirf links ke roop mein hain.` : '';
        portableStatus(`ZIP download shuru ho gaya. ${files.length} asli files aur app records shaamil hain.` + extra);
    } catch (err) {
        portableStatus('ZIP backup nahi bana. ' + err.message);
    } finally {
        portableExporting = false;
        for (const button of buttons) button.disabled = false;
    }
}

async function openPortableZip(file) {
    if (file.size > 114 * portableMiB) throw new Error('ZIP maximum 114 MiB ki ho sakti hai.');
    const names = new Set();
    let total = 0;
    const entries = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
        let max = 8 * portableMiB;
        if (entry.name === 'index.json') max = 4096;
        else if (entry.name === 'backup.json') max = 32 * portableMiB;
        else if (!/^uploads\/\d{6}$/.test(entry.name)) throw new Error('ZIP mein unexpected entry hai.');
        total += entry.originalSize;
        if (names.has(entry.name) || names.size >= portableMaxFiles + 2 || entry.compression !== 0 ||
            entry.size !== entry.originalSize || entry.size > max || total > 114 * portableMiB) {
            throw new Error('Abhi Tools se download ki hui original ZIP chunein.');
        }
        names.add(entry.name);
        return true;
    } });
    const decode = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!entries['index.json'] || !entries['backup.json']) throw new Error('Backup manifest missing hai.');
    const index = decode(entries['index.json']);
    if (index.format !== 'abhitools-portable' || index.version !== 1 ||
        await fileDigest(entries['backup.json']) !== index.records_sha256) throw new Error('Backup records ka checksum match nahi hua.');
    const records = decode(entries['backup.json']);
    const files = records.media?.files;
    if (!Array.isArray(files) || names.size !== files.length + 2 || files.length > portableMaxFiles) throw new Error('ZIP mein files adhuri hain.');
    for (const [i, item] of files.entries()) {
        const bytes = entries[uploadEntry(i)];
        if (!bytes || await fileDigest(bytes) !== item.sha256) throw new Error('Missing ya damaged file: ' + item.name);
        checkUploadBytes(item, bytes);
    }
    const body = await prepareRestoreUpload(new Blob([entries['backup.json']]));
    delete entries['backup.json'];
    delete entries['index.json'];
    return { body, files, entries };
}

async function restorePortableFiles(bundle, status) {
    const revisions = [];
    for (const [i, file] of bundle.files.entries()) {
        status.textContent = `File ${i + 1}/${bundle.files.length} restore aur verify ho rahi hai…`;
        let ticket = await ticketFor(file, 'restore');
        if (ticket.mode === 'upload') {
            await transferMedia(ticket, file, bundle.entries[uploadEntry(i)]);
            ticket = await ticketFor(file, 'read');
        }
        if (ticket.current?.size !== file.size || ticket.current?.type !== file.type ||
            await fileDigest(await transferMedia(ticket, file)) !== file.sha256) {
            throw new Error('Is path par alag file hai. Existing file surakshit hai: ' + file.name);
        }
        revisions.push(ticket.current.revision);
    }
    return revisions;
}
