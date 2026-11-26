const khataDialog = document.getElementById('khataDialog');
let selectedKhata = null;
let lookupVersion = 0;

function askForMobile(person) {
    lookupVersion++;
    selectedKhata = person;
    document.getElementById('khataForm').reset();
    document.getElementById('khataHeading').textContent = person.name;
    document.getElementById('khataStatus').textContent = '';
    khataDialog.showModal();
    document.getElementById('khataPhone').focus();
}
document.getElementById('khataCancel').onclick = () => khataDialog.close();
document.getElementById('khataPhone').oninput = () => { lookupVersion++; };
document.getElementById('khataForm').onsubmit = async event => {
    event.preventDefault();
    const person = selectedKhata;
    const version = ++lookupVersion;
    const status = document.getElementById('khataStatus');
    status.textContent = 'Number check ho raha hai…';
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
        if (version === lookupVersion && khataDialog.open) status.textContent = error.message;
    }
};
khataDialog.addEventListener('close', () => { document.getElementById('khataForm').reset(); });
