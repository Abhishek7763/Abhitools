// ==========================================
// PUBLIC SCRIPT - Abhishek Management Tool
// Supabase API se data fetch karta hai
// Koi bhi token ya secret yahan nahi hai
// ==========================================

// Phase 15 PWA lifecycle/install handling lives in pwa.js.

// ==========================================
// GLOBAL VARIABLES
// ==========================================
let loans = [];
let directory = { people: [], months: [], count: 0, total: 0 };
let currentTab = 'folder';
let currentOpenFolder = null;
let isGridView = false;
let autoSyncInterval = null;
let publicDueData = null;
let directoryLoaded = false;
let syncInFlight = null;
const searchByTab = { folder: '', month: '' };

const monthOrder = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];


function publicEscapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==========================================
// APP INIT
// ==========================================
async function initApp() {
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

    await fetchFromCloud();

    // Auto sync har 5 minute mein
    autoSyncInterval = setInterval(fetchFromCloud, 5 * 60 * 1000);
}

// ==========================================
// DATA FETCH - Supabase API se
// ==========================================
async function readPublicData(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not refresh ' + url);
    return response.json();
}

function fetchFromCloud() {
    if (syncInFlight) return syncInFlight;
    const badge = document.getElementById('lastUpdatedBadge');
    const status = document.getElementById('syncStatus');
    badge.textContent = 'Syncing…';
    badge.disabled = true;
    status.textContent = '';

    const accounts = readPublicData('/api/loans?action=directory').then(data => {
        directory = data;
        directoryLoaded = true;
        document.getElementById('totalLoansCount').textContent = directory.count;
        document.getElementById('totalAmountSum').textContent = '₹' + directory.total.toLocaleString('en-IN');
        if (!document.body.classList.contains('public-detail-active')) handleSearch();
    });
    const dues = readPublicData('/api/due?view=public').then(data => {
        publicDueData = data;
        updateDashboard();
    });
    syncInFlight = Promise.allSettled([accounts, dues]).then(([accountsResult, duesResult]) => {
        const failed = [];
        if (accountsResult.status === 'rejected') {
            failed.push('Profile list');
            if (!directoryLoaded) document.querySelector('#folderView .directory-loading')?.remove();
        }
        if (duesResult.status === 'rejected') failed.push('Due summary');
        if (failed.length) {
            status.textContent = failed.join(' aur ') + ' refresh nahi hui. Retry karein.';
            badge.textContent = '↻ Retry';
        } else {
            badge.textContent = '↻ ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        }
    }).finally(() => {
        badge.disabled = false;
        syncInFlight = null;
    });
    return syncInFlight;
}

async function manualSync() {
    await fetchFromCloud();
}

// ==========================================
// DASHBOARD
// ==========================================
function publicEmiPaid(emi) {
    const scheduled = Number.parseInt(emi?.amount, 10) || 0;
    const paid = Number.parseInt(emi?.paid_amount, 10) || 0;
    return Math.max(0, Math.min(paid, scheduled));
}

function publicEmiRemaining(emi) {
    return Math.max((Number.parseInt(emi?.amount, 10) || 0) - publicEmiPaid(emi), 0);
}

function publicEmiPastDue(emi) {
    if (!emi?.due_date || publicEmiRemaining(emi) <= 0) return false;
    const dueDate = String(emi.due_date).slice(0, 10);
    const businessDate = String(publicDueData?.businessDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return false;
    return dueDate < businessDate;
}

function updateDashboard() {
    const summary = publicDueData?.summary || {};
    const month = summary.month || { amount:0, count:0 };
    const today = summary.today || { amount:0, count:0 };
    const tomorrow = summary.tomorrow || { amount:0, count:0 };
    const next7 = summary.next7 || { amount:0, count:0 };
    const overdue = summary.overdue || { amount:0, count:0 };
    const monthName = publicDueData?.businessDate ? new Date(`${publicDueData.businessDate}T00:00:00Z`).toLocaleString('en-US', { month:'short', timeZone:'UTC' }).toUpperCase() : '';

    const dueLabel = document.getElementById('dueThisMonthLabel');
    if (dueLabel) dueLabel.innerText = monthName ? `Due in ${monthName}` : 'Due This Month';
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.innerText = val; };
    el('dueThisMonthSum', '₹' + Number(month.amount || 0).toLocaleString('en-IN'));
    el('publicOverdueSum', '₹' + Number(overdue.amount || 0).toLocaleString('en-IN'));
    el('publicOverdueCount', `${Number(overdue.count || 0)} EMI`);
    el('publicTomorrowDue', '₹' + Number(tomorrow.amount || 0).toLocaleString('en-IN'));
    el('publicNext7Due', '₹' + Number(next7.amount || 0).toLocaleString('en-IN'));

    const todayBadge = document.getElementById('todayDueBadge');
    if (todayBadge) {
        const parts = [];
        if (Number(today.amount || 0) > 0) parts.push(`Aaj due: ₹${Number(today.amount).toLocaleString('en-IN')}`);
        todayBadge.innerText = parts.join('   •   ');
        todayBadge.style.display = parts.length ? 'block' : 'none';
    }
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
function clearOpenProfile() {
    loans = [];
    document.getElementById('loanList').replaceChildren();
    document.getElementById('mgrBorrower')?.remove();
    document.getElementById('khataPayments').replaceChildren();
    document.getElementById('khataPayments').hidden = true;
    currentOpenFolder = null;
    document.getElementById('currentFolderName').replaceChildren();
}

function switchTab(tab) {
    const search = document.getElementById('searchInput');
    searchByTab[currentTab] = search.value;
    search.value = searchByTab[tab];
    search.placeholder = tab === 'month' ? 'Mahina ya saal dhoondhein…' : 'Apna naam dhoondhein…';
    search.setAttribute('aria-label', tab === 'month' ? 'Mahina ya saal' : 'Borrower ka naam');
    document.querySelector('.directory-heading').textContent = tab === 'month' ? 'Mahine ka hisaab' : 'Profiles';
    currentTab = tab;
    clearOpenProfile();
    document.body.classList.remove('public-detail-active');
    ['tabFolder','tabMonth'].forEach(id => {
        const tabButton = document.getElementById(id);
        tabButton?.classList.remove('active');
        tabButton?.setAttribute('aria-selected', 'false');
    });
    ['folderView','detailView','monthView','monthDetailView'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    if (tab === 'folder') {
        document.getElementById('tabFolder')?.classList.add('active');
        document.getElementById('tabFolder')?.setAttribute('aria-selected', 'true');
        document.getElementById('folderView').style.display = 'block';
        document.getElementById('viewControlsContainer').style.display = 'flex';
        document.querySelector('.search-container').style.display = 'flex';
        handleSearch();
    } else {
        document.getElementById('tabMonth')?.classList.add('active');
        document.getElementById('tabMonth')?.setAttribute('aria-selected', 'true');
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
    const folderDiv = document.getElementById('folderView');
    folderDiv.replaceChildren();
    const people = directory.people.filter(person => person.name.toUpperCase().includes(searchQuery));
    people.sort((a,b) => a.name.localeCompare(b.name));
    if (sortMode === 'reverse') people.reverse();
    for (const person of people) folderDiv.appendChild(profileButton(person));
    if (people.length === 0) {
        folderDiv.innerHTML = '<p style="text-align:center;color:#777;margin-top:20px;grid-column:1/-1;">Koi record nahi mila.</p>';
    }
}

function profileButton(person) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.profileId = person.id;
    button.className = 'folder old-folder-card';
    const initials = person.name.trim().split(/\s+/u).slice(0, 2).map(word => Array.from(word)[0]).join('');
    button.innerHTML = `<i class="profile-initials" aria-hidden="true">${publicEscapeHtml(initials)}</i><div class="old-folder-title">${publicEscapeHtml(person.name)}</div><span class="card-arrow" aria-hidden="true">›</span>`;
    button.setAttribute('aria-label', person.name + ' ki profile kholein');
    button.onclick = () => askForMobile(person);
    return button;
}

function openFolder(name) {
    currentOpenFolder = name;
    document.body.classList.add('public-detail-active');
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

    const badgeBg = document.body.classList.contains('dark-mode') ? '#333' : '#e8f0fe';
    document.getElementById('currentFolderName').innerHTML = `
        📁 ${publicEscapeHtml(name)}<br>
        <span style="font-size:14px;font-weight:normal;display:inline-block;margin-top:5px;background:${badgeBg};padding:5px 15px;border-radius:20px;">
            Loans: <b>${loanCount}</b> &nbsp;•&nbsp; Loan total: <b>₹${totalAmount.toLocaleString('en-IN')}</b>
        </span>
    `;

    renderLoanList(name);
    renderPaymentHistory(name);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

function goBackToFolders() {
    const origin = returnPosition;
    switchTab(origin?.tab || 'folder');
    if (origin?.tab === 'month') {
        const month = directory.months.find(item => item.key === origin.month);
        if (month) openMonthDetail(month.key, month);
    }
    requestAnimationFrame(() => {
        const list = document.getElementById(origin?.tab === 'month' ? 'monthDateList' : 'folderView');
        const button = [...list.querySelectorAll('[data-profile-id]')].find(item => item.dataset.profileId === origin?.id);
        window.scrollTo({ top: origin?.y || 0, behavior: 'instant' });
        button?.focus({ preventScroll: true });
        button?.classList.add('profile-returned');
    });
}

// ==========================================
// LOAN CARDS - Public View (Read Only)
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
            const paid = publicEmiPaid(e);
            paidSum += paid;
            if (e.status === 'overdue' || publicEmiPastDue(e)) overdueSum += publicEmiRemaining(e);
        });

        const remaining = Math.max(emiSum - paidSum, 0);
        const borderColor = overdueSum > 0 ? '#ea4335' : (remaining === 0 ? '#34a853' : '#1a73e8');

        const card = document.createElement('div');
        card.className = 'card';
        card.style.borderLeftColor = borderColor;

        const borrower = loan.borrowers || {};

        card.innerHTML = `
            <div>
                <p style="color:#1a73e8;font-weight:600;font-size:14px;">ID: ${publicEscapeHtml(loan.loan_code || '')}</p>
                <p><strong>Total Amount:</strong> ₹${parseInt(loan.amount).toLocaleString('en-IN')}</p>
                <p><strong>Loan Year:</strong> ${publicEscapeHtml(loan.loan_year || '-')}</p>
                <div class="emi-text">
                    <strong>EMI Schedule:</strong><br>
                    ${renderEmiItems(emis)}
                </div>
            </div>
            <div style="margin-top:15px;">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;">
                    <span style="color:#34a853;font-weight:600;">✅ Paid: ₹${paidSum.toLocaleString('en-IN')}</span>
                    <span style="color:#ea4335;font-weight:600;">⏳ Remaining: ₹${remaining.toLocaleString('en-IN')}</span>
                </div>
                ${overdueSum > 0 ? `<p style="color:#ea4335;font-size:12px;font-weight:600;">🔴 Overdue: ₹${overdueSum.toLocaleString('en-IN')}</p>` : ''}
                <div class="emi-sum-box" style="background:#e8f0fe;color:#1a73e8;padding:6px 10px;border-radius:6px;font-weight:600;font-size:14px;text-align:right;">
                    EMI Total: ₹${emiSum.toLocaleString('en-IN')}
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

function renderEmiItems(emis) {
    if (!emis || emis.length === 0) return 'Koi EMI nahi';
    return emis.map(e => {
        const paid = publicEmiPaid(e);
        const remaining = publicEmiRemaining(e);
        const full = remaining === 0 && Number(e.amount) > 0;
        const partial = paid > 0 && !full;
        const pastDue = e.status === 'overdue' || publicEmiPastDue(e);
        const icon = full ? '✅' : pastDue ? '🔴' : partial ? '🟠' : '⏳';
        const color = full ? '#34a853' : pastDue ? '#ea4335' : partial ? '#f57c00' : '#fbbc05';
        const label = full ? 'Paid' : pastDue && partial ? 'Partial • Overdue' : pastDue ? 'Overdue' : partial ? 'Partial' : 'Pending';
        return `<div style="padding:3px 0;border-bottom:1px solid #f0f0f0;">
            <span style="color:${color};">${icon}</span>
            (${Number(e.installment_number || 0)}) ${Number(e.due_day || 0)} ${publicEscapeHtml(e.due_month || '')}${e.due_year ? ' ' + publicEscapeHtml(e.due_year) : ' (year not set)'} - ₹${parseInt(e.amount).toLocaleString('en-IN')}
            <span style="font-size:11px;color:${color};"> • ${label}${paid > 0 ? ` • Paid ₹${paid.toLocaleString('en-IN')} • Rem ₹${remaining.toLocaleString('en-IN')}` : ''}</span>
        </div>`;
    }).join('');
}

// ==========================================
// MONTH VIEW
// ==========================================
function renderMonthFolders() {
    const terms = document.getElementById('searchInput').value.toUpperCase().trim().split(/\s+/);
    const monthData = Object.fromEntries(directory.months.filter(month => {
        const index = monthOrder.indexOf(month.month);
        const fullName = index < 0 ? '' : new Date(Date.UTC(2000, index, 1)).toLocaleString('en-IN', { month:'long', timeZone:'UTC' });
        const label = (month.key + ' ' + fullName).toUpperCase();
        return terms.every(term => label.includes(term));
    }).map(month => [month.key, month]));
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
        const monthButton = document.createElement('button');
        monthButton.type = 'button';
        monthButton.className = 'month-folder';
        monthButton.setAttribute('aria-label', `${d.month || ''} ${d.year || 'year not set'}: EMI total ₹${d.total.toLocaleString('en-IN')}, collected ₹${d.collected.toLocaleString('en-IN')}`);
        monthButton.onclick = () => openMonthDetail(key, d);
        monthButton.innerHTML = `
            <div>📅 ${publicEscapeHtml(d.month || '')} ${d.year ? publicEscapeHtml(d.year) : 'Year not set'}</div>
            <div>
                <span style="color:#34a853;font-weight:600;">Total: ₹${d.total.toLocaleString('en-IN')}</span><br>
                <small style="color:#34a853;">✅ Collected: ₹${d.collected.toLocaleString('en-IN')}</small>
            </div>
        `;
        monthViewDiv.appendChild(monthButton);
    });

    if (sorted.length === 0) {
        monthViewDiv.innerHTML = '<p style="text-align:center;color:#777;margin-top:20px;">Koi EMI schedule nahi mila.</p>';
    }
}

function openMonthDetail(key, monthObj) {
    document.getElementById('monthDetailView').dataset.key = key;
    document.body.classList.add('public-detail-active');
    document.getElementById('monthView').style.display = 'none';
    document.getElementById('monthDetailView').style.display = 'block';
    document.getElementById('currentMonthName').innerText =
        `📅 ${key} - Total: ₹${monthObj.total.toLocaleString('en-IN')} | Collected: ₹${monthObj.collected.toLocaleString('en-IN')}`;

    const list = document.getElementById('monthDateList');
    list.innerHTML = '';

    for (const person of monthObj.people) list.appendChild(profileButton(person));
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

function goBackToMonths() {
    document.body.classList.remove('public-detail-active');
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
    if (!directoryLoaded) return;
    if (currentTab === 'month') {
        renderMonthFolders();
        return;
    }
    if (currentTab === 'folder') {
        if (currentOpenFolder) {
            clearOpenProfile();
            document.body.classList.remove('public-detail-active');
            document.getElementById('detailView').style.display = 'none';
            document.getElementById('folderView').style.display = 'block';
            document.getElementById('viewControlsContainer').style.display = 'flex';
        }
        renderFolders(query, sortMode);
    }
}

function printStatement() {
    const today = new Date();
    const dateStr = String(today.getDate()).padStart(2,'0') + '/' +
                    String(today.getMonth()+1).padStart(2,'0') + '/' + today.getFullYear();
    const timeStr = today.toLocaleString('en-US', { hour:'numeric', minute:'numeric', hour12:true });
    const el = document.getElementById('printDateDisplay');
    if (el) el.textContent = `Date Generated: ${dateStr} at ${timeStr}`;
    window.print();
}

// ==========================================
// CONTACT PAGE
// ==========================================
function showContactPage() {
    document.getElementById('contactPageContainer').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'instant' });
}

function hideContactPage() {
    document.getElementById('contactPageContainer').style.display = 'none';
}

window.onload = initApp;

function renderPaymentHistory(name) {
    const panel = document.getElementById('khataPayments');
    const entries = [];
    let balance = 0;
    for (const loan of loans) {
        for (const emi of loan.emis || []) {
            if (loan.status === 'active') balance += publicEmiRemaining(emi);
            for (const payment of emi.emi_payments || []) {
                entries.push({ ...payment, code: loan.loan_code, installment: emi.installment_number });
            }
        }
    }
    entries.sort((a, b) => b.payment_date.localeCompare(a.payment_date));
    const heading = document.createElement('h3');
    heading.textContent = 'Payment history';
    panel.replaceChildren(heading);
    panel.hidden = false;
    if (!entries.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Abhi koi payment entry nahi hai.';
        panel.append(empty);
    }
    for (const entry of entries) {
        const amount = '₹' + Number(entry.amount).toLocaleString('en-IN');
        const date = new Date(entry.payment_date).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' });
        const row = document.createElement('div');
        row.className = 'payment-line';
        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = amount + ' jama hue';
        const meta = document.createElement('small');
        meta.textContent = date + ' · ' + entry.code + ' · EMI ' + entry.installment;
        info.append(title, meta);
        const share = document.createElement('button');
        share.type = 'button';
        share.textContent = navigator.share ? 'Receipt share' : 'Receipt copy';
        share.onclick = async () => {
            const text = ['Abhishek Management', name, title.textContent, meta.textContent, 'Aaj ka kul baaki: ₹' + balance.toLocaleString('en-IN')].join('\n');
            try {
                if (navigator.share) await navigator.share({ text });
                else {
                    await navigator.clipboard.writeText(text);
                    share.textContent = 'Copy ho gayi';
                }
            } catch (error) {
                if (error.name !== 'AbortError') window.prompt('Receipt copy karein', text);
            }
        };
        row.append(info, share);
        panel.append(row);
    }
}
