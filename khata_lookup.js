(() => {
    const form = document.getElementById('khataForm');
    const phone = document.getElementById('khataPhone');
    const status = document.getElementById('khataStatus');
    const result = document.getElementById('khataResult');
    const money = value => '₹' + Number(value).toLocaleString('en-IN');
    let latest = 0;

    phone.addEventListener('input', () => {
        latest++;
        result.replaceChildren();
        status.textContent = '';
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const request = ++latest;
        result.replaceChildren();
        if (!/^(?:\+?91|0)?\d{10}$/.test(phone.value.replace(/[\s()-]/g, ''))) {
            status.textContent = '10 digit mobile number daalein.';
            return;
        }
        status.textContent = 'Khata dhoondh rahe hain…';
        try {
            const response = await fetch('/api/loans?action=public_khata', {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phone.value })
            });
            if (!response.ok) throw new Error('lookup');
            const accounts = await response.json();
            if (request !== latest) return;
            status.textContent = accounts.length ? accounts.length + ' loan mile.' : 'Is number par koi loan nahi mila.';
            for (const account of accounts) {
                const details = document.createElement('details');
                details.open = accounts.length === 1;
                const title = document.createElement('summary');
                title.textContent = account.borrowers.name + ' · ' + account.loan_code + ' · ' + money(account.amount);
                details.append(title);
                const list = document.createElement('ul');
                for (const emi of account.emis || []) {
                    const row = document.createElement('li');
                    row.textContent = 'EMI ' + emi.installment_number + ' · ' + money(emi.amount) + ' · ' + emi.status + (emi.due_date ? ' · ' + emi.due_date : '');
                    list.append(row);
                }
                details.append(list);
                result.append(details);
            }
        } catch {
            if (request === latest) status.textContent = 'Khata load nahi hua. Dobara koshish karein.';
        }
    });
})();
