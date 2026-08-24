// ==========================================
// ADMIN SCRIPT - Abhishek Management Tool
// Supabase API se connected hai
// Koi bhi token ya password yahan nahi hai
// ==========================================

// Admin access is verified server-side through a signed HttpOnly cookie.
async function ensureAdminSession() {
    try {
        const response = await fetch('/api/auth', { cache: 'no-store' });
        if (!response.ok) {
            window.location.replace('advanced_admin_login_panel.html');
            return false;
        }
        return true;
    } catch (error) {
        console.error('Admin session check failed:', error);
        window.location.replace('advanced_admin_login_panel.html');
        return false;
    }
}

async function logoutAdmin() {
    try {
        await fetch('/api/auth', { method: 'DELETE' });
    } catch (error) {
        console.warn('Logout request failed:', error);
    }
    window.location.replace('index.html');
}

async function adminFetch(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        window.location.replace('advanced_admin_login_panel.html');
        throw new Error('Admin session expired');
    }
    if (!response.ok) {
        let message = `Request failed (${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch {}
        throw new Error(message);
    }
    return response;
}

// Service Worker hatao
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let r of registrations) r.unregister();
    });
}

// ==========================================
// GLOBAL VARIABLES
// ==========================================
let borrowers = [];
let loans = [];
let currentTab = 'folder';
let currentOpenFolder = null;
let isGridView = false;
let currentBorrowerId = null;

const monthOrder = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ==========================================
// APP INIT
// ==========================================
async function initApp() {
    if (!await ensureAdminSession()) return;

    // Dark mode restore
    if (localStorage.getItem('abhishek_dark_mode') === 'yes') {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('darkModeBtn');
        if (btn) { btn.innerText = '☀️ Light'; btn.style.background = '#fbbc05'; btn.style.color = '#333'; }
    }

    // Layout restore
    if (localStorage.getItem('abhishek_layout_pref') === 'grid') {
        isGridView = true;
        document.getElementById('folderView')?.classList.add('grid-view');
        const lb = document.getElementById('layoutToggleBtn');
        if (lb) lb.innerText = '📜 List View';
    }

    await loadAllData();
}

// ==========================================
// DATA LOAD - Supabase se
// ==========================================
async function loadAllData() {
    const badge = document.getElementById('lastUpdatedBadge');
    try {
        if (badge) badge.innerHTML = `<span class="spin-icon">🔄</span><br>Loading...`;

        const [borrowersRes, loansRes] = await Promise.all([
            adminFetch('/api/borrowers'),
            adminFetch('/api/loans')
        ]);

        borrowers = await borrowersRes.json();
        loans = await loansRes.json();

        // Overdue EMIs auto-detect karo
        await autoMarkOverdue();

        updateDashboard();
        renderFolders();
        if (currentTab === 'month') renderMonthFolders();
        if (currentOpenFolder) openFolder(currentOpenFolder);

        if (badge) badge.innerHTML = `Updated! ✅🥰`;
        setTimeout(() => {
            if (badge) badge.innerHTML = `Updated:<br>${new Date().toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true })}`;
        }, 2000);

    } catch (err) {
        console.error('Data load error:', err);
        if (badge) badge.innerHTML = `Error ❌`;
        alert('Data load nahi hua. Internet check karein.');
    }
}

async function manualSync() {
    await loadAllData();
}

// ==========================================
// OVERDUE AUTO DETECT
// ==========================================
async function autoMarkOverdue() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const loan of loans) {
        if (!loan.emis) continue;
        for (const emi of loan.emis) {
            if (emi.status === 'pending' && emi.due_date) {
                const dueDate = new Date(emi.due_date);
                if (dueDate < today) {
                    await adminFetch('/api/loans?action=emi-status', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ emi_id: emi.id, status: 'overdue' })
                    });
                    emi.status = 'overdue';
                }
            }
        }
    }
}

// ==========================================
// DASHBOARD
// ==========================================
function updateDashboard() {
    let totalAmount = 0;
    let dueThisMonth = 0;
    let overdueCount = 0;
    let todayDue = 0;

    const today = new Date();
    const currentMonthShort = today.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const todayStr = today.toISOString().split('T')[0];

    const dueLabel = document.getElementById('dueThisMonthLabel');
    if (dueLabel) dueLabel.innerText = 'Due in ' + currentMonthShort;

    loans.forEach(loan => {
        if (loan.status !== 'active') return;
        totalAmount += parseInt(loan.amount) || 0;

        if (loan.emis) {
            loan.emis.forEach(emi => {
                if (emi.due_month === currentMonthShort && emi.status !== 'paid') {
                    dueThisMonth += parseInt(emi.amount) || 0;
                }
                if (emi.status === 'overdue') overdueCount++;
                if (emi.due_date === todayStr && emi.status !== 'paid') {
                    todayDue += parseInt(emi.amount) || 0;
                }
            });
        }
    });

    const el = (id, val) => { const e = document.getElementById(id); if (e) e.innerText = val; };
    el('totalLoansCount', loans.filter(l => l.status === 'active').length);
    el('totalAmountSum', '₹' + totalAmount.toLocaleString('en-IN'));
    el('dueThisMonthSum', '₹' + dueThisMonth.toLocaleString('en-IN'));
    el('overdueCount', overdueCount);
    el('todayDueSum', '₹' + todayDue.toLocaleString('en-IN'));
}

// ==========================================
// DARK MODE & LAYOUT
// ==========================================
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('abhishek_dark_mode', isDark ? 'yes' : 'no');
    const btn = document.getElementById('darkModeBtn');
    if (isDark) { btn.innerText = '☀️ Light'; btn.style.background = '#fbbc05'; btn.style.color = '#333'; }
    else { btn.innerText = '🌙 Dark'; btn.style.background = '#5f6368'; btn.style.color = 'white'; }
}

function toggleLayout() {
    isGridView = !isGridView;
    const folderView = document.getElementById('folderView');
    const btn = document.getElementById('layoutToggleBtn');
    if (isGridView) {
        folderView.classList.add('grid-view');
        btn.innerText = '📜 List View';
        localStorage.setItem('abhishek_layout_pref', 'grid');
    } else {
        folderView.classList.remove('grid-view');
        btn.innerText = '🔲 Grid View';
        localStorage.setItem('abhishek_layout_pref', 'list');
    }
}

// ==========================================
// TABS
// ==========================================
function switchTab(tab) {
    currentTab = tab;
    ['tabFolder','tabMonth'].forEach(id => document.getElementById(id)?.classList.remove('active'));
    ['folderView','detailView','monthView','monthDetailView'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    if (tab === 'folder') {
        document.getElementById('tabFolder')?.classList.add('active');
        document.getElementById('folderView').style.display = 'block';
        document.getElementById('viewControlsContainer').style.display = 'flex';
        document.querySelector('.search-container').style.display = 'flex';
        handleSearch();
    } else {
        document.getElementById('tabMonth')?.classList.add('active');
        document.getElementById('monthView').style.display = 'block';
        document.getElementById('viewControlsContainer').style.display = 'none';
        document.querySelector('.search-container').style.display = 'none';
        renderMonthFolders();
    }
}

// ==========================================
// FOLDER VIEW
// ==========================================
function renderFolders(searchQuery = '', sortMode = 'name') {
    const folders = {};

    loans.forEach(loan => {
        if (loan.status !== 'active') return;
        const borrower = loan.borrowers;
        if (!borrower) return;
        const name = borrower.name.toUpperCase();

        if (searchQuery && !name.includes(searchQuery) && !loan.loan_code?.toUpperCase().includes(searchQuery)) return;

        if (!folders[name]) folders[name] = { count: 0, sum: 0, borrower_id: borrower.id, phone: borrower.phone, whatsapp: borrower.whatsapp };
        folders[name].count++;
        folders[name].sum += parseInt(loan.amount) || 0;
    });

    const folderDiv = document.getElementById('folderView');
    folderDiv.innerHTML = '';

    let names = Object.keys(folders);
    if (sortMode === 'highest') names.sort((a, b) => folders[b].sum - folders[a].sum);
    else if (sortMode === 'lowest') names.sort((a, b) => folders[a].sum - folders[b].sum);
    else names.sort();

    names.forEach(name => {
        const f = folders[name];
        const div = document.createElement('div');
        div.className = 'folder';
        div.onclick = () => openFolder(name);
        div.innerHTML = `
            <div>📁 ${name}</div>
            <div>
                <span>${f.count} Loans | ₹${f.sum.toLocaleString('en-IN')}</span>
                ${f.phone ? `<br><small style="color:#34a853;">📱 ${f.phone}</small>` : ''}
            </div>
        `;
        folderDiv.appendChild(div);
    });

    if (names.length === 0) {
        folderDiv.innerHTML = '<p style="text-align:center;color:#777;margin-top:20px;grid-column:1/-1;">Koi record nahi mila.</p>';
    }
}

function openFolder(name) {
    currentOpenFolder = name;
    document.getElementById('folderView').style.display = 'none';
    document.getElementById('detailView').style.display = 'block';
    document.getElementById('viewControlsContainer').style.display = 'none';

    let totalAmount = 0, loanCount = 0;
    loans.forEach(loan => {
        if (loan.borrowers?.name.toUpperCase() === name.toUpperCase() && loan.status === 'active') {
            totalAmount += parseInt(loan.amount) || 0;
            loanCount++;
        }
    });

    const badgeBg = document.body.classList.contains('dark-mode') ? '#333' : '#fce8e6';
    document.getElementById('currentFolderName').innerHTML = `
        📁 ${name}<br>
        <span style="font-size:14px;font-weight:normal;display:inline-block;margin-top:5px;background:${badgeBg};padding:5px 15px;border-radius:20px;">
            Loans: <b>${loanCount}</b> &nbsp;|&nbsp; Amount: <b>₹${totalAmount.toLocaleString('en-IN')}</b>
        </span>
    `;

    renderLoanList(name);
}

function goBackToFolders() {
    currentOpenFolder = null;
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('folderView').style.display = 'block';
    document.getElementById('viewControlsContainer').style.display = 'flex';
    handleSearch();
}

// ==========================================
// LOAN CARDS
// ==========================================
function renderLoanList(nameFilter) {
    const list = document.getElementById('loanList');
    list.innerHTML = '';

    loans.forEach(loan => {
        if (loan.borrowers?.name.toUpperCase() !== nameFilter.toUpperCase()) return;

        let emiSum = 0, paidSum = 0, overdueSum = 0;
        const emis = loan.emis || [];
        emis.forEach(e => {
            emiSum += parseInt(e.amount) || 0;
            if (e.status === 'paid') paidSum += parseInt(e.paid_amount || e.amount) || 0;
            if (e.status === 'overdue') overdueSum += parseInt(e.amount) || 0;
        });

        const remaining = emiSum - paidSum;
        const borderColor = overdueSum > 0 ? '#ea4335' : (remaining === 0 ? '#34a853' : '#fbbc05');
        const statusBadge = loan.status === 'closed' ? '🔒 Closed' : loan.status === 'defaulted' ? '⚠️ Defaulted' : '✅ Active';

        const card = document.createElement('div');
        card.className = 'card';
        card.style.borderLeftColor = borderColor;

        const borrower = loan.borrowers || {};
        const whatsappNum = borrower.whatsapp || borrower.phone || '';
        const whatsappMsg = encodeURIComponent(`Namaskar ${borrower.name}, aapki EMI due hai. Loan ID: ${loan.loan_code}. Kripya jald payment karein. - Abhishek`);

        card.innerHTML = `
            <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <p style="color:#ea4335;font-weight:600;font-size:14px;margin:0;">ID: ${loan.loan_code}</p>
                    <span style="font-size:11px;background:#f0f2f5;padding:3px 8px;border-radius:10px;">${statusBadge}</span>
                </div>
                <p><strong>Total Amount:</strong> ₹${parseInt(loan.amount).toLocaleString('en-IN')}</p>
                <p><strong>Loan Year:</strong> ${loan.loan_year || '-'}</p>
                ${borrower.phone ? `<p><strong>📱 Phone:</strong> <a href="tel:${borrower.phone}" style="color:#1a73e8;">${borrower.phone}</a></p>` : ''}
                <div class="emi-text"><strong>EMI Schedule:</strong><br>${renderEmiList(emis, loan.id)}</div>
            </div>
            <div style="margin-top:15px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:13px;">
                    <span style="color:#34a853;font-weight:600;">✅ Paid: ₹${paidSum.toLocaleString('en-IN')}</span>
                    <span style="color:#ea4335;font-weight:600;">⏳ Remaining: ₹${remaining.toLocaleString('en-IN')}</span>
                </div>
                ${overdueSum > 0 ? `<p style="color:#ea4335;font-size:12px;font-weight:600;">🔴 Overdue: ₹${overdueSum.toLocaleString('en-IN')}</p>` : ''}
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;" class="no-print">
                    <button class="btn btn-warning" onclick="editLoan('${loan.id}')" style="font-size:12px;padding:6px 10px;">✏️ Edit</button>
                    <button class="btn btn-danger" onclick="deleteLoan('${loan.id}')" style="font-size:12px;padding:6px 10px;">🗑️ Delete</button>
                    <button class="btn btn-secondary" onclick="closeLoan('${loan.id}')" style="font-size:12px;padding:6px 10px;">🔒 Close</button>
                    ${whatsappNum ? `<a href="https://wa.me/91${whatsappNum}?text=${whatsappMsg}" target="_blank" class="btn btn-success" style="font-size:12px;padding:6px 10px;text-decoration:none;">💬 WhatsApp</a>` : ''}
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

function renderEmiList(emis, loanId) {
    if (!emis || emis.length === 0) return 'Koi EMI nahi';
    return emis.map(e => {
        const statusColor = e.status === 'paid' ? '#34a853' : e.status === 'overdue' ? '#ea4335' : '#fbbc05';
        const statusIcon = e.status === 'paid' ? '✅' : e.status === 'overdue' ? '🔴' : '⏳';
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0;padding:4px 6px;border-radius:4px;background:rgba(0,0,0,0.03);">
            <span>${statusIcon} (${e.installment_number}) ${e.due_day} ${e.due_month}${e.due_year ? ' ' + e.due_year : ' (year not set)'} - ₹${e.amount}</span>
            <select onchange="changeEmiStatus('${e.id}', this.value)" style="font-size:11px;padding:2px;border:1px solid ${statusColor};border-radius:4px;color:${statusColor};background:white;cursor:pointer;" class="no-print">
                <option value="pending" ${e.status==='pending'?'selected':''}>⏳ Pending</option>
                <option value="paid" ${e.status==='paid'?'selected':''}>✅ Paid</option>
                <option value="overdue" ${e.status==='overdue'?'selected':''}>🔴 Overdue</option>
            </select>
        </div>`;
    }).join('');
}

async function changeEmiStatus(emiId, status) {
    try {
        const paid_date = status === 'paid' ? new Date().toISOString().split('T')[0] : null;
        await adminFetch('/api/loans?action=emi-status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emi_id: emiId, status, paid_date })
        });
        await loadAllData();
    } catch (err) {
        alert('EMI status update nahi hua. Try again.');
    }
}

// ==========================================
// BORROWER FORM
// ==========================================
function showBorrowerForm(borrowerId = null) {
    document.getElementById('borrowerFormContainer').style.display = 'block';
    document.getElementById('editBorrowerId').value = borrowerId || '';

    if (borrowerId) {
        const b = borrowers.find(x => x.id === borrowerId);
        if (b) {
            document.getElementById('bName').value = b.name || '';
            document.getElementById('bFatherName').value = b.father_name || '';
            document.getElementById('bPhone').value = b.phone || '';
            document.getElementById('bWhatsapp').value = b.whatsapp || '';
            document.getElementById('bAddress').value = b.address || '';
            document.getElementById('bAadhaar').value = b.aadhaar || '';
            document.getElementById('bPan').value = b.pan || '';
            document.getElementById('bNotes').value = b.notes || '';
        }
    } else {
        document.getElementById('borrowerForm').reset();
    }
    window.scrollTo(0, 0);
}

function hideBorrowerForm() {
    document.getElementById('borrowerFormContainer').style.display = 'none';
}

async function saveBorrower() {
    const id = document.getElementById('editBorrowerId').value;
    const body = {
        name: document.getElementById('bName').value.trim(),
        father_name: document.getElementById('bFatherName').value.trim(),
        phone: document.getElementById('bPhone').value.trim(),
        whatsapp: document.getElementById('bWhatsapp').value.trim(),
        address: document.getElementById('bAddress').value.trim(),
        aadhaar: document.getElementById('bAadhaar').value.trim(),
        pan: document.getElementById('bPan').value.trim(),
        notes: document.getElementById('bNotes').value.trim()
    };

    if (!body.name) { alert('Naam required hai!'); return; }

    try {
        if (id) {
            await adminFetch('/api/borrowers?action=update', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, ...body })
            });
        } else {
            await adminFetch('/api/borrowers?action=add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }
        hideBorrowerForm();
        await loadAllData();
    } catch (err) {
        alert('Borrower save nahi hua. Try again.');
    }
}

// ==========================================
// LOAN FORM
// ==========================================
function showForm(borrowerId = null) {
    document.getElementById('loanFormContainer').style.display = 'block';
    document.getElementById('editLoanId').value = '';
    document.getElementById('loanAmount').value = '';
    document.getElementById('loanYear').value = new Date().getFullYear();
    document.getElementById('loanInterest').value = '';
    document.getElementById('loanNotes').value = '';
    document.getElementById('dynamicEmiContainer').innerHTML = '';

    // Borrower select populate karo
    const select = document.getElementById('loanBorrowerSelect');
    select.innerHTML = '<option value="">-- Borrower Chunein --</option>';
    borrowers.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name;
        if (borrowerId && b.id === borrowerId) opt.selected = true;
        select.appendChild(opt);
    });

    addEmiRow();
    window.scrollTo(0, 0);
}

function hideForm() {
    document.getElementById('loanFormContainer').style.display = 'none';
}

function addEmiRow(day = '', month = '', year = undefined, amount = '') {
    const container = document.getElementById('dynamicEmiContainer');
    const row = document.createElement('div');
    row.className = 'emi-row';
    row.innerHTML = `
        <input type="number" placeholder="Din (10)" value="${day}" style="width:20%;" min="1" max="31">
        <input type="text" placeholder="Mahina (AUG)" value="${month}" style="width:25%;text-transform:uppercase;">
        <input type="number" placeholder="Saal (2025)" value="${year === undefined ? new Date().getFullYear() : (year || '')}" style="width:25%;" min="2020" max="2099">
        <input type="number" placeholder="Amount (₹)" value="${amount}" style="width:22%;" min="1">
        <button class="btn btn-danger" onclick="this.parentElement.remove()" style="padding:8px;width:8%;">❌</button>
    `;
    container.appendChild(row);
}

async function saveLoan() {
    const loanId = document.getElementById('editLoanId').value;
    const borrower_id = document.getElementById('loanBorrowerSelect').value;
    const amount = document.getElementById('loanAmount').value;
    const loan_year = document.getElementById('loanYear').value;
    const interest_rate = document.getElementById('loanInterest').value;
    const notes = document.getElementById('loanNotes').value;

    if (!borrower_id || !amount) { alert('Borrower aur Amount required hain!'); return; }

    const emis = [];
    document.querySelectorAll('.emi-row').forEach(row => {
        const inputs = row.querySelectorAll('input');
        const day = inputs[0].value.trim();
        const month = inputs[1].value.trim().toUpperCase();
        const year = inputs[2].value.trim();
        const amt = inputs[3].value.trim();
        if (day && month && year && amt) emis.push({ day, month, year, amount: amt });
    });

    try {
        if (loanId) {
            await adminFetch('/api/loans?action=update', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ loan_id: loanId, amount, interest_rate, notes, emis })
            });
        } else {
            const loan_code = 'ID' + Date.now();
            const loan_date = new Date().toISOString().split('T')[0];
            await adminFetch('/api/loans?action=add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ borrower_id, loan_code, amount, interest_rate, loan_date, loan_year, notes, emis })
            });
        }
        hideForm();
        await loadAllData();
        if (currentOpenFolder) openFolder(currentOpenFolder);
    } catch (err) {
        alert('Loan save nahi hua. Try again.');
    }
}

async function editLoan(loanId) {
    const loan = loans.find(l => l.id === loanId);
    if (!loan) return;

    showForm(loan.borrower_id);
    document.getElementById('editLoanId').value = loanId;
    document.getElementById('loanBorrowerSelect').value = loan.borrower_id;
    document.getElementById('loanAmount').value = loan.amount;
    document.getElementById('loanYear').value = loan.loan_year || '';
    document.getElementById('loanInterest').value = loan.interest_rate || '';
    document.getElementById('loanNotes').value = loan.notes || '';

    document.getElementById('dynamicEmiContainer').innerHTML = '';
    (loan.emis || []).forEach(e => addEmiRow(e.due_day, e.due_month, e.due_year, e.amount));
    if (!loan.emis?.length) addEmiRow();
}

async function deleteLoan(loanId) {
    if (!confirm('Kya aap sach mein ye loan delete karna chahte hain?')) return;
    try {
        await adminFetch('/api/loans?action=delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loan_id: loanId })
        });
        await loadAllData();
        if (currentOpenFolder) openFolder(currentOpenFolder);
        else goBackToFolders();
    } catch (err) {
        alert('Loan delete nahi hua. Try again.');
    }
}

async function closeLoan(loanId) {
    if (!confirm('Kya aap ye loan close karna chahte hain?')) return;
    try {
        await adminFetch('/api/loans?action=update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loan_id: loanId, status: 'closed' })
        });
        await loadAllData();
    } catch (err) {
        alert('Loan close nahi hua. Try again.');
    }
}

// ==========================================
// MONTH VIEW
// ==========================================
function renderMonthFolders() {
    const monthData = {};
    loans.forEach(loan => {
        (loan.emis || []).forEach(e => {
            const key = `${e.due_month} ${e.due_year || 'YEAR-NOT-SET'}`;
            if (!monthData[key]) monthData[key] = { total: 0, collected: 0, items: [], month: e.due_month, year: e.due_year || null };
            monthData[key].total += parseInt(e.amount) || 0;
            if (e.status === 'paid') monthData[key].collected += parseInt(e.paid_amount || e.amount) || 0;
            monthData[key].items.push({ ...e, name: loan.borrowers?.name, loan_code: loan.loan_code });
        });
    });

    const monthViewDiv = document.getElementById('monthView');
    monthViewDiv.innerHTML = '';

    const sorted = Object.keys(monthData).sort((a, b) => {
        const da = monthData[a];
        const db = monthData[b];
        const ya = Number(da.year) || 9999;
        const yb = Number(db.year) || 9999;
        if (ya !== yb) return ya - yb;
        return monthOrder.indexOf(da.month) - monthOrder.indexOf(db.month);
    });

    sorted.forEach(key => {
        const d = monthData[key];
        const div = document.createElement('div');
        div.className = 'month-folder';
        div.onclick = () => openMonthDetail(key, d);
        div.innerHTML = `
            <div>📅 ${d.month} ${d.year || 'Year not set'}</div>
            <div>
                <span style="color:#34a853;font-weight:600;">Total: ₹${d.total.toLocaleString('en-IN')}</span><br>
                <small style="color:#34a853;">✅ Collected: ₹${d.collected.toLocaleString('en-IN')}</small>
            </div>
        `;
        monthViewDiv.appendChild(div);
    });

    if (sorted.length === 0) {
        monthViewDiv.innerHTML = '<p style="text-align:center;color:#777;margin-top:20px;">Koi EMI schedule nahi mila.</p>';
    }
}

function openMonthDetail(key, monthObj) {
    document.getElementById('monthView').style.display = 'none';
    document.getElementById('monthDetailView').style.display = 'block';
    document.getElementById('currentMonthName').innerText = `📅 ${monthObj.month} ${monthObj.year || 'Year not set'} - Total: ₹${monthObj.total.toLocaleString('en-IN')} | Collected: ₹${monthObj.collected.toLocaleString('en-IN')}`;

    const list = document.getElementById('monthDateList');
    list.innerHTML = '';

    monthObj.items.sort((a, b) => a.due_day - b.due_day).forEach(item => {
        const statusColor = item.status === 'paid' ? '#34a853' : item.status === 'overdue' ? '#ea4335' : '#fbbc05';
        const statusIcon = item.status === 'paid' ? '✅' : item.status === 'overdue' ? '🔴' : '⏳';
        const div = document.createElement('div');
        div.className = 'monthly-item';
        div.style.borderLeftColor = statusColor;
        div.innerHTML = `
            <div>
                <span style="background:${statusColor};color:white;padding:2px 6px;border-radius:4px;margin-right:5px;">${item.due_day}</span>
                <strong>${item.name}</strong> ${statusIcon}<br>
                <small style="color:#888;">${item.loan_code}</small>
            </div>
            <div style="font-size:16px;font-weight:600;color:#333;">₹${item.amount.toLocaleString('en-IN')}</div>
        `;
        list.appendChild(div);
    });
}

function goBackToMonths() {
    document.getElementById('monthDetailView').style.display = 'none';
    document.getElementById('monthView').style.display = 'block';
    renderMonthFolders();
}

// ==========================================
// SEARCH & PRINT
// ==========================================
function handleSearch() {
    const query = document.getElementById('searchInput').value.toUpperCase().trim();
    const sortMode = document.getElementById('sortSelect').value;
    if (currentTab === 'folder') {
        if (currentOpenFolder) {
            currentOpenFolder = null;
            document.getElementById('detailView').style.display = 'none';
            document.getElementById('folderView').style.display = 'block';
            document.getElementById('viewControlsContainer').style.display = 'flex';
        }
        renderFolders(query, sortMode);
    }
}

function printStatement() {
    const today = new Date();
    const dateStr = String(today.getDate()).padStart(2,'0') + '/' + String(today.getMonth()+1).padStart(2,'0') + '/' + today.getFullYear();
    const timeStr = today.toLocaleString('en-US', { hour:'numeric', minute:'numeric', hour12:true });
    const el = document.getElementById('printDateDisplay');
    if (el) el.innerHTML = `Date Generated: ${dateStr} at ${timeStr}`;
    window.print();
}

// ==========================================
// EXPORT / IMPORT
// ==========================================
function exportData() {
    const dataStr = JSON.stringify({ borrowers, loans }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date();
    a.download = `Loan_Backup_${today.getDate()}-${today.getMonth()+1}-${today.getFullYear()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

window.onload = initApp;
