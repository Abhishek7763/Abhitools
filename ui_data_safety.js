// File restore keeps the exact upload that the server previewed.
let restoreUpload = null;
let resetJob = null;
let resetRequestId = null;
let resetReady = false;
let resetBusy = false;
let resetPreviewNumber = 0;

async function backupPost(action, body) {
    const response = await adminFetch('/api/backup?action=' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return response.json();
}

async function gzipUpload(bytes) {
    if (bytes.size > 2850000) throw new Error('Compressed backup 2.85 MB se badi hai.');
    const buffer = new Uint8Array(await bytes.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 16384) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 16384));
    }
    return { gzip: btoa(binary) };
}

async function prepareRestoreUpload(file) {
    if (file.size > 32 * 1024 * 1024) throw new Error('Maximum JSON size 32 MiB hai.');
    const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (signature[0] === 31 && signature[1] === 139) return gzipUpload(file);
    const payload = JSON.parse(await file.text());
    const compact = new Blob([JSON.stringify(payload)]);
    if (compact.size <= 3500000) return { payload };
    const compressed = compact.stream().pipeThrough(new CompressionStream('gzip'));
    return gzipUpload(await new Response(compressed).blob());
}

async function handleFileRestoreSelect(event) {
    const input = event.target;
    const file = input.files[0];
    const info = document.getElementById('fileRestoreInfo');
    const button = document.getElementById('fileRestoreBtn');
    restoreUpload = null;
    button.disabled = true;
    document.getElementById('fileRestoreResult').style.display = 'none';
    info.textContent = file ? 'Backup ki jaanch chal rahi hai…' : 'Koi file select nahi hui.';
    if (!file) return;
    try {
        const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        const isZip = magic[0] === 80 && magic[1] === 75;
        const bundle = isZip ? await openPortableZip(file) : null;
        const body = bundle?.body || await prepareRestoreUpload(file);
        if (input.files[0] !== file) return;
        const preview = await backupPost('preview_file', body);
        if (input.files[0] !== file) return;
        const c = preview.counts;
        const lines = [
            file.name + ' · v' + preview.version + ' · ' + (preview.created_at || '').slice(0, 10),
            `${c.borrowers || 0} borrowers · ${c.loans || 0} loans · ${c.emis || 0} EMIs · ${c.emi_payments || 0} payments`,
            `${c.loan_settlements || 0} settlements · ${c.collection_followups || 0} follow-ups · ${c.documents || 0} document links`
        ];
        if (Number(preview.version) === 8) {
            lines.push(`${c.upi_payment_requests} UPI requests · ${c.activity_log} activity entries · ${c.recycle_bin} recycle entries`);
            if (!c.borrowers) lines.push('Is backup se restore karne par borrower list khaali ho jayegi.');
        } else {
            lines.push('Purane backup mein UPI history nahi hai. Restore par maujooda UPI requests hat jayengi.');
        }
        if (preview.media && !bundle) throw new Error('Asli files restore karne ke liye poori ZIP chunein.');
        if (bundle) {
            lines.push(`${bundle.files.length} verified files · ${(preview.media.total / 1048576).toFixed(1)} MiB`);
            if (preview.media.external) lines.push(`${preview.media.external} external links ki sirf link save hai.`);
        }
        info.textContent = lines.join('\n');
        restoreUpload = { body, bundle, label: file.name };
        button.disabled = false;
    } catch (err) {
        if (input.files[0] === file) info.textContent = 'Backup preview nahi hua. ' + err.message;
    }
}

async function applyFileRestore() {
    if (!restoreUpload || prompt('Current records replace honge. Confirm karne ke liye FULL RESTORE likhein.') !== 'FULL RESTORE') return;
    const button = document.getElementById('fileRestoreBtn');
    const input = document.getElementById('fileRestoreInput');
    const status = document.getElementById('fileRestoreResult');
    input.disabled = button.disabled = true;
    status.style.display = 'block';
    status.textContent = 'Restore chal raha hai…';
    try {
        const { body, bundle, label } = restoreUpload;
        const revisions = bundle ? await restorePortableFiles(bundle, status) : undefined;
        status.textContent = 'Records restore ho rahe hain…';
        const result = await backupPost('restore_file', { ...body, label, revisions, confirm: true });
        if (result.success !== true) throw new Error('Server confirmation nahi mili.');
        input.value = '';
        restoreUpload = null;
        alert('Restore ho gaya. Purane records ka snapshot Backup History mein hai.');
        window.location.reload();
    } catch (err) {
        status.textContent = 'Restore poora nahi hua ya confirmation nahi mili. Backup History dekhein. Isi ZIP se retry par verified files reuse hongi. ' + err.message;
        input.disabled = button.disabled = false;
    }
}

function updateResetControls() {
    const phrase = document.getElementById('dataResetPhrase');
    const start = document.getElementById('dataResetBtn');
    const resume = document.getElementById('dataResetResume');
    phrase.disabled = !resetReady || resetBusy || Boolean(resetJob);
    start.disabled = phrase.disabled || phrase.value !== 'DELETE ALL';
    resume.style.display = resetJob ? 'block' : 'none';
    resume.disabled = resetBusy;
}

async function loadResetPreview() {
    if (resetBusy) return;
    const request = ++resetPreviewNumber;
    const info = document.getElementById('dataResetInfo');
    document.getElementById('dataResetPhrase').value = '';
    resetReady = false;
    resetJob = null;
    updateResetControls();
    info.textContent = 'Delete hone wale records gin rahe hain…';
    try {
        const response = await adminFetch('/api/backup?action=reset_preview', { cache: 'no-store' });
        const data = await response.json();
        if (request !== resetPreviewNumber) return;
        resetJob = data.pending_job;
        resetReady = true;
        info.textContent = resetJob ? 'App records delete ho chuke hain. Storage cleanup poora karein.' :
            `${data.borrowers} borrowers · ${data.loans} loans · ${data.emis} EMIs · ${data.payments} payments\n` +
            `${data.snapshots} server snapshots · ${data.uploads} uploaded files`;
    } catch (err) {
        if (request === resetPreviewNumber) info.textContent = 'Preview nahi mila. ' + err.message;
    } finally {
        if (request === resetPreviewNumber) updateResetControls();
    }
}

async function runDataReset() {
    if (resetBusy || !resetReady) return;
    const phrase = document.getElementById('dataResetPhrase');
    const info = document.getElementById('dataResetInfo');
    if (!resetJob && (phrase.value !== 'DELETE ALL' || !confirm('App records, snapshots aur uploaded files permanently delete karein?'))) return;
    resetBusy = true;
    updateResetControls();
    try {
        if (!resetJob) {
            resetRequestId ||= crypto.randomUUID();
            info.textContent = 'App data delete ho raha hai…';
            const start = await backupPost('reset_start', { confirm: phrase.value, job_id: resetRequestId });
            resetJob = start.job_id;
            phrase.value = '';
        }
        info.textContent = 'App records delete ho gaye. Storage files check ho rahi hain…';
        while (true) {
            const result = await backupPost('reset_continue', { job_id: resetJob });
            if (result.remaining === 0) break;
            info.textContent = `Storage cleanup chal raha hai. ${result.remaining} files baaki hain.`;
        }
        resetJob = resetRequestId = null;
        resetReady = false;
        alert('Abhi Tools ke records, server snapshots aur app uploads delete ho gaye.');
        window.location.reload();
    } catch (err) {
        info.textContent = resetJob ? 'Records delete ho chuke hain. Files ka cleanup resume karein. ' + err.message :
            'Delete ki confirmation nahi mili. Preview dobara dekhein. ' + err.message;
    } finally {
        resetBusy = false;
        updateResetControls();
    }
}
