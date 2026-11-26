const khataDialog = document.getElementById('khataDialog');
const unlockForm = document.getElementById('khataForm');
const unlockButton = unlockForm.querySelector('[type=submit]');
const phoneField = document.getElementById('khataPhone');
const lookupStatus = document.getElementById('khataStatus');
let selectedKhata = null;
let lookupVersion = 0;
let returnPosition;

function showLookupState(state, message = '') {
    khataDialog.dataset.state = state;
    const busy = state === 'checking' || state === 'verified';
    unlockButton.disabled = busy;
    unlockButton.textContent = state === 'verified' ? 'Verified' : busy ? 'Check ho raha hai…' : 'Profile kholein';
    unlockButton.setAttribute('aria-busy', String(state === 'checking'));
    phoneField.readOnly = state === 'verified';
    phoneField.setAttribute('aria-invalid', String(state === 'invalid'));
    lookupStatus.textContent = message;
    if (state === 'invalid') phoneField.focus();
}

function askForMobile(person) {
    returnPosition = { id: person.id, y: window.scrollY, tab: currentTab, month: document.getElementById('monthDetailView').dataset.key };
    lookupVersion++;
    selectedKhata = person;
    unlockForm.reset();
    showLookupState('idle');
    document.getElementById('khataHeading').textContent = person.name;
    khataDialog.showModal();
    phoneField.focus();
}
document.getElementById('khataCancel').onclick = () => khataDialog.close();
phoneField.oninput = () => {
    lookupVersion++;
    showLookupState('idle');
};
unlockForm.onsubmit = async event => {
    event.preventDefault();
    if (unlockButton.disabled) return;
    const phone = phoneField.value.trim();
    if (!/^(?:\+?91|0)?\d{10}$/.test(phone.replace(/[\s()-]/g, ''))) {
        showLookupState('invalid', '10 digit ka mobile number daalein.');
        return;
    }

    const person = selectedKhata;
    const version = ++lookupVersion;
    const isCurrent = () => version === lookupVersion && khataDialog.open;
    showLookupState('checking');
    try {
        const response = await fetch('/api/loans?action=public_khata', {
            method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ borrower_id: person.id, phone })
        });
        if (!isCurrent()) return;
        if (response.status === 403) {
            showLookupState('invalid', 'Number match nahi hua. Saved number check karein.');
            return;
        }
        if (!response.ok) throw new Error('Network error');
        const data = await response.json();
        if (!isCurrent()) return;
        if (!Array.isArray(data) || !data.length) {
            showLookupState('error', 'Is profile mein loan nahi mila.');
            return;
        }
        showLookupState('verified', 'Number match ho gaya.');
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        await new Promise(resolve => setTimeout(resolve, reduced ? 180 : 460));
        if (!isCurrent()) return;
        khataDialog.close();
        switchTab('folder');
        loans = data;
        openFolder(person.name);
        const heading = document.getElementById('currentFolderName');
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
    } catch {
        if (isCurrent()) showLookupState('error', 'Profile load nahi hui. Dobara koshish karein.');
    }
};
khataDialog.addEventListener('close', () => {
    if (!khataDialog.open) {
        lookupVersion++;
        unlockForm.reset();
        showLookupState('idle');
    }
});
