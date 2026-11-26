(() => {
    const panel = document.getElementById('privateLedger');
    const unlock = document.getElementById('privateUnlock');
    const form = document.getElementById('privateEntry');
    const book = document.getElementById('privateBook');
    const rows = document.getElementById('privateRows');
    const status = document.getElementById('privateStatus');
    let pin = '';
    let generation = 0;
    let entryId = null;

    function lock() {
        generation++;
        pin = '';
        entryId = null;
        rows.replaceChildren();
        status.textContent = '';
        form.reset();
        unlock.reset();
        unlock.hidden = false;
        book.hidden = true;
        for (const button of panel.querySelectorAll('form button')) button.disabled = false;
    }

    async function submit(event) {
        event.preventDefault();
        const target = event.currentTarget;
        const button = target.querySelector('button');
        if (button.disabled) return;
        const current = generation;
        const values = Object.fromEntries(new FormData(target));
        const payload = target === unlock ? values : { pin, entry: { ...values, id: entryId ??= crypto.randomUUID() } };
        button.disabled = true;
        try {
            const response = await fetch('/api/dashboard?mode=private-ledger', {
                method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (current !== generation) return;
            if (!response.ok) throw new Error(data.error || 'Khata load nahi hua.');
            pin = payload.pin;
            unlock.reset();
            unlock.hidden = true;
            book.hidden = false;
            form.reset();
            entryId = null;
            rows.replaceChildren(...data.entries.map(entry => {
                const row = document.createElement('li');
                const direction = entry.direction === 'given' ? 'Diya' : 'Mila';
                row.textContent = [new Date(entry.created_at).toLocaleDateString('en-IN'), entry.person, direction, '₹' + Number(entry.amount).toLocaleString('en-IN')].join(' · ');
                return row;
            }));
            status.textContent = target === form ? 'Entry save ho gayi.' : '';
        } catch (error) {
            if (current === generation) status.textContent = error.message;
        } finally {
            if (current === generation) button.disabled = false;
        }
    }
    form.addEventListener('input', () => { entryId = null; });
    unlock.addEventListener('submit', submit);
    form.addEventListener('submit', submit);
    document.getElementById('privateLock').addEventListener('click', lock);
    panel.addEventListener('toggle', () => { if (!panel.open) lock(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) lock(); });
    window.addEventListener('pagehide', lock);
})();
