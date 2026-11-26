const khataDialog = document.getElementById('khataDialog');
let selectedKhata = null;
let lookupVersion = 0;

const unlockButton = document.querySelector('#khataForm [type=submit]');
const phoneField = document.getElementById('khataPhone');
let returnPosition;

function setChecking(busy) {
    unlockButton.disabled = busy;
    unlockButton.textContent = busy ? 'Khata khul raha hai…' : 'Khata kholein';
    unlockButton.setAttribute('aria-busy', String(busy));
}

function askForMobile(person) {
    returnPosition = { id: person.id, y: window.scrollY, tab: currentTab, month: document.getElementById('monthDetailView').dataset.key };
    setChecking(false);
    phoneField.removeAttribute('aria-invalid');
    lookupVersion++;
    selectedKhata = person;
    document.getElementById('khataForm').reset();
    document.getElementById('khataHeading').textContent = person.name;
    document.getElementById('khataStatus').textContent = '';
    khataDialog.showModal();
    document.getElementById('khataPhone').focus();
}
document.getElementById('khataCancel').onclick = () => khataDialog.close();
phoneField.oninput = () => {
    lookupVersion++;
    setChecking(false);
    phoneField.removeAttribute('aria-invalid');
    document.getElementById('khataStatus').textContent = '';
};
document.getElementById('khataForm').onsubmit = async event => {
    event.preventDefault();
    if (unlockButton.disabled) return;
    setChecking(true);
    const person = selectedKhata;
    const version = ++lookupVersion;
    const status = document.getElementById('khataStatus');
    status.textContent = '';
    try {
        const response = await fetch('/api/loans?action=public_khata', {
            method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ borrower_id: person.id, phone: document.getElementById('khataPhone').value })
        });
        const data = await response.json();
        if (version !== lookupVersion || !khataDialog.open) return;
        if (!response.ok) throw new Error(data.error || 'Dobara koshish karein.');
        if (!data.length) throw new Error('Is profile mein loan nahi mila.');
        khataDialog.close();
        switchTab('folder');
        loans = data;
        openFolder(person.name);
    } catch (error) {
        if (version === lookupVersion && khataDialog.open) {
            status.textContent = error.message;
            phoneField.setAttribute('aria-invalid', 'true');
            phoneField.focus();
        }
    } finally {
        if (version === lookupVersion) setChecking(false);
    }
};
khataDialog.addEventListener('close', () => { document.getElementById('khataForm').reset(); });
