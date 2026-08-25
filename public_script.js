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
let currentTab = 'folder';
let currentOpenFolder = null;
let isGridView = false;
let autoSyncInterval = null;
let publicDueData = null;

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
async function fetchFromCloud() {
    const badge = document.getElementById('lastUpdatedBadge');
    try {
        if (badge) badge.innerHTML = `<span class="spin-icon">🔄</span><br>Updating ✨`;

        // Refresh due/overdue statuses first on the server, then fetch the loan list.
        const dueResponse = await fetch('/api/due', { cache: 'no-store' });
        if (!dueResponse.ok) throw new Error('Due API error');
        publicDueData = await dueResponse.json();

        const response = await fetch('/api/loans', { cache: 'no-store' });
        if (!response.ok) throw new Error('API error');
        loans = await response.json();

        updateDashboard();
        renderFolders();
        if (currentTab === 'month') renderMonthFolders();
        if (currentOpenFolder) openFolder(currentOpenFolder);

        if (badge) {
            badge.innerHTML = `Updated! ✅🥰`;
            setTimeout(() => {
                badge.innerHTML = `Updated:<br>${new Date().toLocaleString('en-IN', {
                    day: '2-digit', month: 'short',
                    hour: '2-digit', minute: '2-digit', hour12: true
                })}`;
            }, 2000);
        }

    } catch (err) {
        console.error('Fetch error:', err);
        if (badge) badge.innerHTML = `Offline ❌`;
        alert('Data load nahi hua. Internet check karein.');
    }
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
    let totalAmount = 0;
    loans.forEach(loan => { if (loan.status === 'active') totalAmount += parseInt(loan.amount) || 0; });

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
    el('totalLoansCount', loans.filter(l => l.status === 'active').length);
    el('totalAmountSum', '₹' + totalAmount.toLocaleString('en-IN'));
    el('dueThisMonthSum', '₹' + Number(month.amount || 0).toLocaleString('en-IN'));
    el('publicOverdueSum', '₹' + Number(overdue.amount || 0).toLocaleString('en-IN'));
    el('publicOverdueCount', `${Number(overdue.count || 0)} EMI`);
    el('publicTomorrowDue', '₹' + Number(tomorrow.amount || 0).toLocaleString('en-IN'));
    el('publicNext7Due', '₹' + Number(next7.amount || 0).toLocaleString('en-IN'));

    const todayBadge = document.getElementById('todayDueBadge');
    if (todayBadge) {
        const parts = [];
        if (Number(overdue.amount || 0) > 0) parts.push(`🔴 Overdue: ₹${Number(overdue.amount).toLocaleString('en-IN')}`);
        if (Number(today.amount || 0) > 0) parts.push(`🔔 Aaj Due: ₹${Number(today.amount).toLocaleString('en-IN')}`);
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
function switchTab(tab) {
    currentTab = tab;
    currentOpenFolder = null;
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
    const folders = {};

    loans.forEach(loan => {
        if (loan.status !== 'active') return;
        const borrower = loan.borrowers;
        if (!borrower) return;
        const name = borrower.name.toUpperCase();

        if (searchQuery && !name.includes(searchQuery) && !loan.loan_code?.toUpperCase().includes(searchQuery)) return;

        if (!folders[name]) folders[name] = { count: 0, sum: 0 };
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
        const folderButton = document.createElement('button');
        const loanLabel = f.count === 1 ? 'Loan' : 'Loans';
        folderButton.type = 'button';
        folderButton.className = 'folder';
        folderButton.setAttribute('aria-label', `${name}: ${f.count} ${loanLabel}, active loan total ₹${f.sum.toLocaleString('en-IN')}`);
        folderButton.onclick = () => openFolder(name);
        folderButton.innerHTML = `
            <div>📁 ${publicEscapeHtml(name)}</div>
            <div>
                <span>${f.count} ${loanLabel} • ₹${f.sum.toLocaleString('en-IN')}</span>
            </div>
        `;
        folderDiv.appendChild(folderButton);
    });

    if (names.length === 0) {
        folderDiv.innerHTML = '<p style="text-align:center;color:#777;margin-top:20px;grid-column:1/-1;">Koi record nahi mila.</p>';
    }
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
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function goBackToFolders() {
    currentOpenFolder = null;
    document.body.classList.remove('public-detail-active');
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('folderView').style.display = 'block';
    document.getElementById('viewControlsContainer').style.display = 'flex';
    handleSearch();
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
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
    const monthData = {};

    loans.forEach(loan => {
        (loan.emis || []).forEach(e => {
            const key = `${e.due_month} ${e.due_year || 'YEAR-NOT-SET'}`;
            if (!monthData[key]) monthData[key] = { total: 0, collected: 0, items: [], month: e.due_month, year: e.due_year || null };
            monthData[key].total += parseInt(e.amount) || 0;
            monthData[key].collected += publicEmiPaid(e);
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
    document.body.classList.add('public-detail-active');
    document.getElementById('monthView').style.display = 'none';
    document.getElementById('monthDetailView').style.display = 'block';
    document.getElementById('currentMonthName').innerText =
        `📅 ${key} - Total: ₹${monthObj.total.toLocaleString('en-IN')} | Collected: ₹${monthObj.collected.toLocaleString('en-IN')}`;

    const list = document.getElementById('monthDateList');
    list.innerHTML = '';

    monthObj.items.sort((a, b) => a.due_day - b.due_day).forEach(item => {
        const itemPaid = publicEmiPaid(item);
        const itemRemaining = publicEmiRemaining(item);
        const itemPastDue = item.status === 'overdue' || publicEmiPastDue(item);
        const statusColor = itemRemaining === 0 ? '#34a853' : itemPastDue ? '#ea4335' : itemPaid > 0 ? '#f57c00' : '#fbbc05';
        const statusIcon = itemRemaining === 0 ? '✅' : itemPastDue ? '🔴' : itemPaid > 0 ? '🟠' : '⏳';
        const div = document.createElement('div');
        div.className = 'monthly-item';
        div.style.borderLeftColor = statusColor;
        div.innerHTML = `
            <div>
                <span style="background:${statusColor};color:white;padding:2px 6px;border-radius:4px;margin-right:5px;">${item.due_day}</span>
                <strong>${publicEscapeHtml(item.name || 'Unknown')}</strong> ${statusIcon}<br>
                <small style="color:#888;">${publicEscapeHtml(item.loan_code || '')}</small>
            </div>
            <div style="font-size:14px;font-weight:600;color:#333;text-align:right;">₹${parseInt(item.amount).toLocaleString('en-IN')}<br><small>Paid ₹${itemPaid.toLocaleString('en-IN')} • Rem ₹${itemRemaining.toLocaleString('en-IN')}</small></div>
        `;
        list.appendChild(div);
    });
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
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
    if (currentTab === 'folder') {
        if (currentOpenFolder) {
            currentOpenFolder = null;
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hideContactPage() {
    document.getElementById('contactPageContainer').style.display = 'none';
}

window.onload = initApp;
