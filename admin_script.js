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
let currentPaymentEmiId = null;
let currentPaymentId = null;
let currentPaymentHistory = [];
let dueCenterData = null;
let currentDueBucket = 'overdue';

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

        // Server-side due engine refreshes statuses first; legacy year-less EMIs are intentionally skipped.
        const dueRes = await adminFetch('/api/due');
        dueCenterData = await dueRes.json();

        const [borrowersRes, loansRes] = await Promise.all([
            adminFetch('/api/borrowers'),
            adminFetch('/api/loans')
        ]);

        borrowers = await borrowersRes.json();
        loans = await loansRes.json();

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
// PHASE 3 - SERVER-SIDE DUE ENGINE
// ==========================================
async function refreshDueData() {
    const response = await adminFetch('/api/due');
    dueCenterData = await response.json();
    return dueCenterData;
}

// ==========================================
// DASHBOARD
// ==========================================
function emiPaidAmount(emi) {
    const scheduled = Number.parseInt(emi?.amount, 10) || 0;
    const paid = Number.parseInt(emi?.paid_amount, 10) || 0;
    return Math.max(0, Math.min(paid, scheduled));
}

function emiRemainingAmount(emi) {
    return Math.max((Number.parseInt(emi?.amount, 10) || 0) - emiPaidAmount(emi), 0);
}

function emiIsPastDue(emi) {
    if (!emi?.due_date || emiRemainingAmount(emi) <= 0) return false;
    const due = new Date(`${String(emi.due_date).slice(0,10)}T00:00:00`);
    const today = new Date(); today.setHours(0,0,0,0);
    return !Number.isNaN(due.getTime()) && due < today;
}

function updateDashboard() {
    let totalAmount = 0;
    loans.forEach(loan => { if (loan.status === 'active') totalAmount += parseInt(loan.amount) || 0; });

    const summary = dueCenterData?.summary || {};
    const month = summary.month || { amount: 0, count: 0 };
    const overdue = summary.overdue || { amount: 0, count: 0 };
    const today = summary.today || { amount: 0, count: 0 };
    const tomorrow = summary.tomorrow || { amount: 0, count: 0 };
    const next7 = summary.next7 || { amount: 0, count: 0 };
    const monthName = dueCenterData?.businessDate ? new Date(`${dueCenterData.businessDate}T00:00:00Z`).toLocaleString('en-US', { month:'short', timeZone:'UTC' }).toUpperCase() : '';

    const dueLabel = document.getElementById('dueThisMonthLabel');
    if (dueLabel) dueLabel.innerText = monthName ? `Due in ${monthName}` : 'Due This Month';
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.innerText = val; };
    el('totalLoansCount', loans.filter(l => l.status === 'active').length);
    el('totalAmountSum', '₹' + totalAmount.toLocaleString('en-IN'));
    el('dueThisMonthSum', '₹' + Number(month.amount || 0).toLocaleString('en-IN'));
    el('overdueDueSum', '₹' + Number(overdue.amount || 0).toLocaleString('en-IN'));
    el('overdueCount', `${Number(overdue.count || 0)} EMI`);
    el('todayDueSum', '₹' + Number(today.amount || 0).toLocaleString('en-IN'));
    el('todayDueCount', `${Number(today.count || 0)} EMI`);
    el('tomorrowDueSum', '₹' + Number(tomorrow.amount || 0).toLocaleString('en-IN'));
    el('tomorrowDueCount', `${Number(tomorrow.count || 0)} EMI`);
    el('next7DueSum', '₹' + Number(next7.amount || 0).toLocaleString('en-IN'));
    el('next7DueCount', `${Number(next7.count || 0)} EMI`);
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
// ==========================================
// PHASE 3 - DUE & OVERDUE CENTER
// ==========================================
function dueMoney(value) { return '₹' + Number(value || 0).toLocaleString('en-IN'); }

function updateDueCenterTiles() {
    const s = dueCenterData?.summary || {};
    const set = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };
    for (const [key, cap] of [['overdue','Overdue'],['today','Today'],['tomorrow','Tomorrow'],['next7','Next7'],['month','Month']]) {
        const x = s[key] || { amount:0, count:0 };
        set(`dueTile${cap}`, dueMoney(x.amount));
        set(`dueTile${cap}Count`, `${Number(x.count || 0)} EMI`);
    }
    const legacy = s.yearNotSet || { amount:0, count:0 };
    set('dueTileLegacy', dueMoney(legacy.amount));
    set('dueTileLegacyCount', `${Number(legacy.count || 0)} EMI`);
    set('dueBusinessDate', `Business date: ${dueCenterData?.businessDate || '-'} • Asia/Kolkata • statuses auto-refreshed`);
    const note = document.getElementById('dueLegacyNote');
    if (note) {
        note.style.display = legacy.count > 0 ? 'block' : 'none';
        note.textContent = legacy.count > 0
            ? `⚠️ ${legacy.count} legacy EMI ka year/date set nahi hai. Inhe automatic overdue/today calculation me include nahi kiya gaya, taaki galat year assume na ho.`
            : '';
    }
}

function dueBucketLabel(bucket) {
    return { overdue:'🔴 Overdue EMIs', today:'🔔 Aaj Due', tomorrow:'🌅 Kal Due', next7:'📆 Next 7 Days', month:'🗓️ This Month' }[bucket] || 'Due EMIs';
}

function renderDueBucket(bucket = currentDueBucket) {
    currentDueBucket = bucket;
    const title = document.getElementById('dueBucketTitle');
    if (title) title.textContent = dueBucketLabel(bucket);
    const list = document.getElementById('dueBucketList');
    if (!list) return;
    const items = dueCenterData?.buckets?.[bucket] || [];
    if (!items.length) {
        list.innerHTML = '<div class="due-empty">✅ Is category me koi EMI nahi hai.</div>';
        return;
    }
    list.innerHTML = items.map(item => {
        const paid = Number(item.paid_amount || 0);
        const partial = paid > 0 && Number(item.remaining || 0) > 0;
        return `<div class="due-item ${bucket === 'overdue' ? 'is-overdue' : ''}">
            <div class="due-item-main">
                <strong>${escapeHtml(item.borrower_name || 'Unknown')}</strong>
                <small>${escapeHtml(item.loan_code || '')} • EMI #${Number(item.installment_number || 0)} • ${escapeHtml(item.due_date || '')}</small>
                ${partial ? `<small>Part paid: ${dueMoney(paid)}</small>` : ''}
            </div>
            <div class="due-item-side">
                <strong>${dueMoney(item.remaining)}</strong>
                ${item.emi_id ? `<button class="btn btn-success" onclick="closeDueCenter(); openPaymentModal('${item.emi_id}')">💰 Pay</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

function openDueCenter(bucket = 'overdue') {
    const modal = document.getElementById('dueCenterModal');
    if (!modal) return;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    updateDueCenterTiles();
    renderDueBucket(bucket);
}

function closeDueCenter() {
    const modal = document.getElementById('dueCenterModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleDueOverlayClick(event) {
    if (event.target?.id === 'dueCenterModal') closeDueCenter();
}

async function refreshDueCenter() {
    try {
        await refreshDueData();
        updateDashboard();
        updateDueCenterTiles();
        renderDueBucket(currentDueBucket);
    } catch (err) {
        alert('Due data refresh nahi hua.');
    }
}

// ==========================================
// LOAN CARDS + PHASE 2 PAYMENT MANAGEMENT
// ==========================================
function renderLoanList(nameFilter) {
    const list = document.getElementById('loanList');
    list.innerHTML = '';

    loans.forEach(loan => {
        if (loan.borrowers?.name.toUpperCase() !== nameFilter.toUpperCase()) return;

        let emiSum = 0, paidSum = 0, overdueSum = 0;
        const emis = loan.emis || [];
        emis.forEach(e => {
            const scheduled = parseInt(e.amount) || 0;
            const paid = emiPaidAmount(e);
            const remaining = Math.max(scheduled - paid, 0);
            emiSum += scheduled;
            paidSum += paid;
            if (e.status === 'overdue' || emiIsPastDue(e)) overdueSum += remaining;
        });

        const remaining = Math.max(emiSum - paidSum, 0);
        const borderColor = overdueSum > 0 ? '#ea4335' : (remaining === 0 && emiSum > 0 ? '#34a853' : '#fbbc05');
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
                    <p style="color:#ea4335;font-weight:600;font-size:14px;margin:0;">ID: ${escapeHtml(loan.loan_code)}</p>
                    <span style="font-size:11px;background:#f0f2f5;padding:3px 8px;border-radius:10px;">${statusBadge}</span>
                </div>
                <p><strong>Total Amount:</strong> ₹${parseInt(loan.amount).toLocaleString('en-IN')}</p>
                <p><strong>Loan Year:</strong> ${loan.loan_year || '-'}</p>
                ${borrower.phone ? `<p><strong>📱 Phone:</strong> <a href="tel:${escapeHtml(borrower.phone)}" style="color:#1a73e8;">${escapeHtml(borrower.phone)}</a></p>` : ''}
                <div class="emi-text"><strong>EMI Schedule:</strong><br>${renderEmiList(emis, loan.id)}</div>
            </div>
            <div style="margin-top:15px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:13px;gap:8px;flex-wrap:wrap;">
                    <span style="color:#34a853;font-weight:600;">✅ Collected: ₹${paidSum.toLocaleString('en-IN')}</span>
                    <span style="color:#ea4335;font-weight:600;">⏳ Remaining: ₹${remaining.toLocaleString('en-IN')}</span>
                </div>
                ${overdueSum > 0 ? `<p style="color:#ea4335;font-size:12px;font-weight:600;">🔴 Overdue Remaining: ₹${overdueSum.toLocaleString('en-IN')}</p>` : ''}
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;" class="no-print">
                    <button class="btn btn-warning" onclick="editLoan('${loan.id}')" style="font-size:12px;padding:6px 10px;">✏️ Edit</button>
                    <button class="btn btn-danger" onclick="deleteLoan('${loan.id}')" style="font-size:12px;padding:6px 10px;">🗑️ Delete</button>
                    <button class="btn btn-secondary" onclick="closeLoan('${loan.id}')" style="font-size:12px;padding:6px 10px;">🔒 Close</button>
                    ${whatsappNum ? `<a href="https://wa.me/91${escapeHtml(whatsappNum)}?text=${whatsappMsg}" target="_blank" class="btn btn-success" style="font-size:12px;padding:6px 10px;text-decoration:none;">💬 WhatsApp</a>` : ''}
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

function emiDisplayState(e) {
    const paid = emiPaidAmount(e);
    const scheduled = Number.parseInt(e.amount, 10) || 0;
    if (paid >= scheduled && scheduled > 0) return { icon: '✅', text: 'Paid', color: '#34a853' };
    if (paid > 0 && (e.status === 'overdue' || emiIsPastDue(e))) return { icon: '🔴', text: 'Partial • Overdue', color: '#ea4335' };
    if (paid > 0) return { icon: '🟠', text: 'Partial', color: '#f57c00' };
    if (e.status === 'overdue' || emiIsPastDue(e)) return { icon: '🔴', text: 'Overdue', color: '#ea4335' };
    return { icon: '⏳', text: 'Pending', color: '#fbbc05' };
}

function renderEmiList(emis, loanId) {
    if (!emis || emis.length === 0) return 'Koi EMI nahi';
    return emis.map(e => {
        const state = emiDisplayState(e);
        const paid = emiPaidAmount(e);
        const remaining = emiRemainingAmount(e);
        const dateLabel = `${e.due_day} ${e.due_month}${e.due_year ? ' ' + e.due_year : ' (year not set)'}`;
        return `<div class="emi-payment-row" style="border-left-color:${state.color};">
            <div class="emi-payment-main">
                <div><strong>${state.icon} EMI ${e.installment_number}</strong> • ${escapeHtml(dateLabel)} • ₹${Number(e.amount).toLocaleString('en-IN')}</div>
                <small style="color:${state.color};font-weight:600;">${state.text}${paid > 0 ? ` • Paid ₹${paid.toLocaleString('en-IN')} • Remaining ₹${remaining.toLocaleString('en-IN')}` : ''}</small>
            </div>
            <div class="emi-payment-actions no-print">
                <button class="btn btn-success" onclick="openPaymentModal('${e.id}','${loanId}')" style="font-size:11px;padding:6px 8px;">${paid > 0 ? '🧾 Payments' : '💰 Pay'}</button>
                ${paid === 0 ? `<select onchange="changeEmiStatus('${e.id}', this.value); this.value=''" class="emi-status-select" title="Manual pending/overdue correction">
                    <option value="">Status</option>
                    <option value="pending">⏳ Pending</option>
                    <option value="overdue">🔴 Overdue</option>
                </select>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function changeEmiStatus(emiId, status) {
    if (!status) return;
    try {
        await adminFetch('/api/loans?action=emi-status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emi_id: emiId, status })
        });
        await loadAllData();
    } catch (err) {
        alert(err.message || 'EMI status update nahi hua.');
    }
}

function findEmiContext(emiId) {
    for (const loan of loans) {
        const emi = (loan.emis || []).find(e => e.id === emiId);
        if (emi) return { loan, emi };
    }
    return null;
}

async function openPaymentModal(emiId) {
    currentPaymentEmiId = emiId;
    currentPaymentId = null;
    const modal = document.getElementById('paymentModal');
    if (!modal) return;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    resetPaymentForm();
    await loadPaymentHistory();
}

function closePaymentModal() {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    currentPaymentEmiId = null;
    currentPaymentId = null;
    currentPaymentHistory = [];
}

function handlePaymentOverlayClick(event) {
    if (event.target?.id === 'paymentModal') closePaymentModal();
}

function resetPaymentForm() {
    currentPaymentId = null;
    const ctx = findEmiContext(currentPaymentEmiId);
    const remaining = ctx ? emiRemainingAmount(ctx.emi) : 0;
    const amount = document.getElementById('paymentAmount');
    const date = document.getElementById('paymentDate');
    const method = document.getElementById('paymentMethod');
    const notes = document.getElementById('paymentNotes');
    if (amount) { amount.value = remaining || ''; amount.max = remaining || ''; }
    if (date) date.value = new Date().toISOString().slice(0, 10);
    if (method) method.value = 'Cash';
    if (notes) notes.value = '';
    const saveBtn = document.getElementById('savePaymentBtn');
    if (saveBtn) saveBtn.textContent = '💰 Add Payment';
    const cancel = document.getElementById('cancelPaymentEditBtn');
    if (cancel) cancel.style.display = 'none';
}

async function loadPaymentHistory() {
    const status = document.getElementById('paymentStatusBox');
    const history = document.getElementById('paymentHistoryList');
    const title = document.getElementById('paymentModalTitle');
    const ctx = findEmiContext(currentPaymentEmiId);
    if (!ctx) {
        if (status) status.textContent = 'EMI not found.';
        return;
    }
    if (title) title.textContent = `💰 EMI ${ctx.emi.installment_number} Payment • ${ctx.loan.borrowers?.name || ''}`;
    if (status) status.textContent = 'Loading payment history...';
    if (history) history.innerHTML = '';

    try {
        const response = await adminFetch(`/api/payments?emi_id=${encodeURIComponent(currentPaymentEmiId)}`);
        const data = await response.json();
        const summary = data.summary || {};
        if (status) status.innerHTML = `Scheduled <strong>₹${Number(summary.scheduled || 0).toLocaleString('en-IN')}</strong> • Paid <strong>₹${Number(summary.paid || 0).toLocaleString('en-IN')}</strong> • Remaining <strong>₹${Number(summary.remaining || 0).toLocaleString('en-IN')}</strong>`;

        const amountInput = document.getElementById('paymentAmount');
        if (!currentPaymentId && amountInput) {
            amountInput.value = summary.remaining || '';
            amountInput.max = summary.remaining || '';
        }

        const payments = data.payments || [];
        currentPaymentHistory = payments;
        const virtualOpening = summary.hasOpeningBalance ? Number(data.emi?.paid_amount || 0) - payments.reduce((sum,p) => sum + (Number(p.amount)||0), 0) : 0;
        let html = '';
        if (virtualOpening > 0) {
            html += `<div class="payment-history-item baseline"><div><strong>Opening paid balance</strong><small>Previous/imported record</small></div><strong>₹${virtualOpening.toLocaleString('en-IN')}</strong></div>`;
        }
        html += payments.map(p => {
            const editable = p.source === 'manual';
            return `<div class="payment-history-item ${editable ? '' : 'baseline'}">
                <div class="payment-history-meta">
                    <strong>₹${Number(p.amount || 0).toLocaleString('en-IN')} • ${escapeHtml(p.paid_date || '')}</strong>
                    <small>${escapeHtml(p.method || 'Payment')}${p.notes ? ' • ' + escapeHtml(p.notes) : ''}${!editable ? ' • Opening balance' : ''}</small>
                </div>
                ${editable ? `<div class="payment-history-actions"><button class="btn btn-warning" onclick="editPayment('${p.id}')">✏️</button><button class="btn btn-danger" onclick="deletePayment('${p.id}')">↩️ Undo</button></div>` : ''}
            </div>`;
        }).join('');
        if (history) history.innerHTML = html || '<div class="payment-empty">Abhi koi payment entry nahi hai.</div>';
    } catch (err) {
        if (status) status.textContent = err.message || 'Payment history load nahi hui.';
    }
}

function editPayment(paymentId) {
    const p = currentPaymentHistory.find(item => item.id === paymentId);
    if (!p?.id || p.source !== 'manual') return;
    currentPaymentId = p.id;
    document.getElementById('paymentAmount').value = p.amount || '';
    document.getElementById('paymentDate').value = p.paid_date || new Date().toISOString().slice(0, 10);
    document.getElementById('paymentMethod').value = p.method || 'Cash';
    document.getElementById('paymentNotes').value = p.notes || '';
    document.getElementById('savePaymentBtn').textContent = '✅ Save Correction';
    document.getElementById('cancelPaymentEditBtn').style.display = 'inline-block';
}

async function savePayment() {
    const amount = document.getElementById('paymentAmount').value;
    const paid_date = document.getElementById('paymentDate').value;
    const method = document.getElementById('paymentMethod').value;
    const notes = document.getElementById('paymentNotes').value;
    if (!currentPaymentEmiId || !Number(amount) || Number(amount) <= 0) {
        alert('Valid payment amount required hai.');
        return;
    }
    const btn = document.getElementById('savePaymentBtn');
    if (btn) btn.disabled = true;
    try {
        const isEdit = Boolean(currentPaymentId);
        await adminFetch('/api/payments', {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(isEdit
                ? { payment_id: currentPaymentId, amount, paid_date, method, notes }
                : { emi_id: currentPaymentEmiId, amount, paid_date, method, notes })
        });
        await loadAllData();
        resetPaymentForm();
        await loadPaymentHistory();
        if (currentOpenFolder) openFolder(currentOpenFolder);
    } catch (err) {
        alert(err.message || 'Payment save nahi hua.');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deletePayment(paymentId) {
    if (!confirm('Is payment entry ko undo/delete karna hai? EMI balance automatically recalculate hoga.')) return;
    try {
        await adminFetch('/api/payments', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_id: paymentId, confirm: true })
        });
        await loadAllData();
        resetPaymentForm();
        await loadPaymentHistory();
        if (currentOpenFolder) openFolder(currentOpenFolder);
    } catch (err) {
        alert(err.message || 'Payment undo nahi hua.');
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

function addEmiRow(day = '', month = '', year = undefined, amount = '', emiId = '') {
    const container = document.getElementById('dynamicEmiContainer');
    const row = document.createElement('div');
    row.className = 'emi-row';
    row.dataset.emiId = emiId || '';
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
    let invalidNewLegacyRow = false;
    document.querySelectorAll('.emi-row').forEach(row => {
        const inputs = row.querySelectorAll('input');
        const day = inputs[0].value.trim();
        const month = inputs[1].value.trim().toUpperCase();
        const year = inputs[2].value.trim();
        const amt = inputs[3].value.trim();
        const id = row.dataset.emiId || null;
        if (!day && !month && !year && !amt) return;
        if (!day || !month || !amt || (!id && !year)) {
            invalidNewLegacyRow = true;
            return;
        }
        emis.push({ id, day, month, year: year || null, amount: amt });
    });

    if (invalidNewLegacyRow) {
        alert('New EMI ke liye Din, Mahina, Saal aur Amount required hain. Purani imported EMI ka blank year preserve kiya ja sakta hai.');
        return;
    }

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
        alert(err.message || 'Loan save nahi hua.');
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
    (loan.emis || []).sort((a,b) => (a.installment_number || 0) - (b.installment_number || 0))
        .forEach(e => addEmiRow(e.due_day, e.due_month, e.due_year, e.amount, e.id));
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
            monthData[key].collected += emiPaidAmount(e);
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
            <div style="font-size:14px;font-weight:600;color:#333;text-align:right;">₹${Number(item.amount).toLocaleString('en-IN')}<br><small>Paid ₹${emiPaidAmount(item).toLocaleString('en-IN')} • Rem ₹${emiRemainingAmount(item).toLocaleString('en-IN')}</small></div>
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
// PHASE 1 - SMART IMPORT / BACKUP / RESTORE
// ==========================================
let selectedImportPayload = null;
let selectedImportFileName = '';
let currentImportPreview = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function openDataSafetyCenter(section = 'import') {
    const modal = document.getElementById('dataSafetyModal');
    if (!modal) return;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    showSafetySection(section);
}

function closeDataSafetyCenter() {
    const modal = document.getElementById('dataSafetyModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleSafetyOverlayClick(event) {
    if (event?.target?.id === 'dataSafetyModal') closeDataSafetyCenter();
}

function showSafetySection(section) {
    const importSection = document.getElementById('smartImportSection');
    const restoreSection = document.getElementById('backupRestoreSection');
    const isRestore = section === 'restore';
    if (importSection) importSection.style.display = isRestore ? 'none' : 'block';
    if (restoreSection) restoreSection.style.display = isRestore ? 'block' : 'none';
    if (isRestore) loadBackupHistory();
}

async function downloadFullBackup() {
    try {
        const response = await adminFetch('/api/backup?action=export', { cache: 'no-store' });
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const fileName = match?.[1] || `AbhiTools_Full_Backup_${new Date().toISOString().slice(0,10)}.json`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
        console.error('Backup export failed:', err);
        alert('Backup export nahi hua: ' + err.message);
    }
}

// Old inline references remain compatible.
function exportData() {
    return downloadFullBackup();
}

async function createManualBackup() {
    const defaultLabel = `Manual ${new Date().toLocaleString('en-IN')}`;
    const label = prompt('Backup ka naam likhein:', defaultLabel);
    if (label === null) return;
    try {
        const response = await adminFetch('/api/backup?action=create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: label.trim() || defaultLabel })
        });
        const data = await response.json();
        alert('✅ Backup snapshot create ho gaya.');
        await loadBackupHistory();
        return data;
    } catch (err) {
        console.error('Manual backup failed:', err);
        alert('Backup create nahi hua: ' + err.message);
    }
}

async function loadBackupHistory() {
    const list = document.getElementById('backupHistoryList');
    if (!list) return;
    list.innerHTML = 'Loading...';
    try {
        const response = await adminFetch('/api/backup?action=list', { cache: 'no-store' });
        const items = await response.json();
        if (!Array.isArray(items) || !items.length) {
            list.innerHTML = '<div class="safety-status">Abhi koi server snapshot nahi hai.</div>';
            return;
        }
        list.innerHTML = items.map(item => {
            const s = item.summary || {};
            const when = item.created_at ? new Date(item.created_at).toLocaleString('en-IN') : 'Unknown time';
            const label = item.label || item.reason || 'Backup';
            return `
                <div class="backup-history-item">
                    <div class="meta">
                        <strong>${escapeHtml(label)}</strong>
                        <small>${escapeHtml(when)} • ${Number(s.borrowers || 0)} borrowers • ${Number(s.loans || 0)} loans • ${Number(s.emis || 0)} EMIs • ${Number(s.payments ?? s.emi_payments ?? 0)} payments<br>${escapeHtml(item.reason || '')}</small>
                    </div>
                    <button class="btn btn-warning" onclick="restoreSnapshot('${String(item.id || '').replace(/[^0-9a-f-]/gi, '')}')">♻️ Restore</button>
                </div>`;
        }).join('');
    } catch (err) {
        console.error('Backup history failed:', err);
        list.innerHTML = `<div class="safety-status">History load nahi hui: ${escapeHtml(err.message)}</div>`;
    }
}

async function restoreSnapshot(snapshotId) {
    if (!confirm('Selected backup restore karein? Current database pehle automatically backup hoga, phir selected snapshot restore hoga.')) return;
    const typed = prompt('Safety confirmation ke liye RESTORE type karein:');
    if (typed !== 'RESTORE') {
        alert('Restore cancel ho gaya.');
        return;
    }
    try {
        const response = await adminFetch('/api/backup?action=restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ snapshot_id: snapshotId, confirm: true })
        });
        const data = await response.json();
        alert(`✅ Restore complete. Loans: ${data?.summary?.loans ?? 'OK'}, EMIs: ${data?.summary?.emis ?? 'OK'}, Payments: ${data?.summary?.payments ?? data?.summary?.emi_payments ?? 0}`);
        currentOpenFolder = null;
        await loadAllData();
        await loadBackupHistory();
    } catch (err) {
        console.error('Restore failed:', err);
        alert('Restore nahi hua: ' + err.message);
    }
}

async function handleImportFile(event) {
    const file = event.target.files?.[0];
    const info = document.getElementById('importFileInfo');
    const previewBox = document.getElementById('importPreview');
    const controls = document.getElementById('importApplyControls');
    const resultBox = document.getElementById('importResult');

    selectedImportPayload = null;
    selectedImportFileName = '';
    currentImportPreview = null;
    if (previewBox) previewBox.style.display = 'none';
    if (controls) controls.style.display = 'none';
    if (resultBox) resultBox.style.display = 'none';

    if (!file) {
        if (info) info.textContent = 'Koi JSON file select nahi hui.';
        return;
    }
    if (file.size > 2 * 1024 * 1024) {
        if (info) info.textContent = '❌ File 2 MB se badi hai. Is build me maximum 2 MB JSON supported hai.';
        event.target.value = '';
        return;
    }

    try {
        if (info) info.textContent = `Reading ${file.name}...`;
        const payload = JSON.parse(await file.text());
        selectedImportPayload = payload;
        selectedImportFileName = file.name;
        if (info) info.textContent = `✅ ${file.name} read ho gayi. Server validation chal rahi hai...`;

        const response = await adminFetch('/api/import?action=preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload })
        });
        currentImportPreview = await response.json();
        renderImportPreview(currentImportPreview);
    } catch (err) {
        console.error('Import preview failed:', err);
        selectedImportPayload = null;
        currentImportPreview = null;
        if (info) info.textContent = `❌ JSON preview failed: ${err.message}`;
    }
}

function renderImportPreview(preview) {
    const box = document.getElementById('importPreview');
    const controls = document.getElementById('importApplyControls');
    if (!box) return;
    const c = preview.counts || {};
    const d = preview.duplicates || {};
    const skipped = preview.skipped || {};
    const issues = Array.isArray(preview.issues) ? preview.issues : [];
    const skippedTotal = Object.values(skipped).reduce((a, b) => a + Number(b || 0), 0);

    box.innerHTML = `
        <div><strong>Format:</strong> ${escapeHtml(preview.format || 'Unknown')}</div>
        <div class="import-stat-grid">
            <div class="import-stat"><strong>${Number(c.borrowers || 0)}</strong>Borrowers</div>
            <div class="import-stat"><strong>${Number(c.loans || 0)}</strong>Loans</div>
            <div class="import-stat"><strong>${Number(c.emis || 0)}</strong>EMIs</div>
            <div class="import-stat"><strong>${Number(c.documents || 0)}</strong>Documents</div>
            <div class="import-stat"><strong>${Number(c.payments || 0)}</strong>Payments</div>
        </div>
        <div class="import-warning">
            Existing matches: ${Number(d.existing_borrowers || 0)} borrower names, ${Number(d.existing_loans || 0)} loan IDs.<br>
            Invalid/skipped in file: ${skippedTotal}. Merge mode me existing duplicate loan IDs safely skip honge.
        </div>
        ${issues.length ? `<div class="import-warning"><strong>Validation notes:</strong><br>${issues.slice(0,8).map(escapeHtml).join('<br>')}</div>` : ''}
    `;
    box.style.display = 'block';
    if (controls) controls.style.display = preview.can_import ? 'block' : 'none';
}

async function applySmartImport() {
    if (!selectedImportPayload || !currentImportPreview?.can_import) {
        alert('Pehle valid JSON file select aur preview karein.');
        return;
    }
    const mode = document.getElementById('importMode')?.value || 'merge';
    if (mode === 'replace') {
        const typed = prompt('⚠️ Replace current Borrowers/Loans/EMIs ko imported data se replace karega. Automatic backup banega. Continue ke liye REPLACE type karein:');
        if (typed !== 'REPLACE') {
            alert('Replace import cancel ho gaya.');
            return;
        }
    } else if (!confirm('Merge import apply karein? Existing duplicate Loan IDs skip honge aur current data safe rahega.')) {
        return;
    }

    const button = document.getElementById('applyImportBtn');
    const resultBox = document.getElementById('importResult');
    if (button) button.disabled = true;
    if (resultBox) {
        resultBox.style.display = 'block';
        resultBox.textContent = 'Import chal raha hai... page close mat karein.';
    }

    try {
        const response = await adminFetch('/api/import?action=apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                payload: selectedImportPayload,
                mode,
                confirmReplace: mode === 'replace',
                label: `Before import: ${selectedImportFileName || 'JSON'}`
            })
        });
        const data = await response.json();
        const r = data.result || {};
        if (resultBox) {
            resultBox.textContent = `✅ Import complete\nBorrowers added: ${r.inserted_borrowers ?? 0}\nBorrowers reused: ${r.reused_borrowers ?? 0}\nLoans added: ${r.inserted_loans ?? 0}\nDuplicate loans skipped: ${r.duplicate_loans ?? 0}\nEMIs added: ${r.inserted_emis ?? 0}\nEMIs skipped: ${r.skipped_emis ?? 0}\nPayment history added: ${r.payment_history_inserted ?? 0}\nPayment history skipped: ${r.payment_history_skipped ?? 0}\nSafety snapshot: ${r.backup_snapshot_id || 'created'}`;
        }
        currentOpenFolder = null;
        await loadAllData();
    } catch (err) {
        console.error('Import apply failed:', err);
        if (resultBox) resultBox.textContent = '❌ Import failed safely: ' + err.message;
    } finally {
        if (button) button.disabled = false;
    }
}

window.onload = initApp;
