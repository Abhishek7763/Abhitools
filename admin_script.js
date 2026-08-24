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

// Phase 15 PWA lifecycle/install handling lives in pwa.js.

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
let currentProfileBorrowerId = null;
let currentProfileData = null;
let currentWhatsAppPaymentId = null;
let advancedDashboardData = null;
let collectionCalendarData = null;
let calendarMonthKey = null;
let calendarSelectedDate = null;
let reportsCenterData = null;
let reportsAllDates = false;
let reportsPeriod = '12m';
let reminderCenterData = null;
let reminderBucket = 'all';
let homeCommandData = null;
let collectionInsightsData = null;
let releaseManifestData = null;

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

    loadReleaseVersionBadge().catch(err => console.warn('Release manifest load failed:', err));
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
        refreshReminderBadge(true).catch(err => console.warn('Reminder badge refresh failed:', err));
        refreshHomeCommandCenter(true).catch(err => console.warn('Home Command Center refresh failed:', err));

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
    const dueDate = String(emi.due_date).slice(0, 10);
    const businessDate = String(dueCenterData?.businessDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return false;
    return dueDate < businessDate;
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
// PHASE 19 - DASHBOARD UX PRO / COMMAND CENTER
// ==========================================
function homeMoney(value) {
    return `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
}

function homeSetText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function homeActivityIcon(category) {
    return ({payment:'💰',borrower:'👤',loan:'💳',document:'📎',recycle:'♻️',safety:'🛡️',reminder:'🔔',quality:'🧩',system:'⚙️'})[category] || '🕘';
}

function homeActivityLabel(action = '') {
    const key = String(action || '').toUpperCase();
    const labels = {
        ADD_BORROWER:'Borrower added', UPDATE_BORROWER:'Borrower updated', ADD_LOAN:'Loan added', UPDATE_LOAN:'Loan updated',
        ADD_EMI_PAYMENT:'Payment added', UPDATE_EMI_PAYMENT:'Payment corrected', REVERSE_EMI_PAYMENT:'Payment reversed',
        SETTLE_LOAN:'Loan settled', REOPEN_LOAN:'Settlement reopened', CONTACT_REMINDER:'Reminder contacted',
        LEGACY_DATE_CLEANUP:'Legacy dates cleaned', CREATE_BACKUP:'Backup created', RESTORE_BACKUP:'Backup restored',
        RECYCLE_BORROWER:'Borrower recycled', RECYCLE_LOAN:'Loan recycled', RESTORE_RECYCLE_ITEM:'Recycle item restored'
    };
    return labels[key] || key.split('_').filter(Boolean).map(x => x.charAt(0) + x.slice(1).toLowerCase()).join(' ') || 'Activity';
}

function homeDateTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true });
}

function homePriorityDueText(item) {
    const today = String(homeCommandData?.businessDate || '');
    const due = String(item?.due_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return due || '-';
    const diff = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (diff < 0) return `${Math.abs(diff)} day late`;
    if (diff === 0) return 'Due today';
    if (diff === 1) return 'Due tomorrow';
    return `Due in ${diff} days`;
}

function renderHomeCommandCenter(data) {
    homeCommandData = data;
    const summary = data?.summary || {};
    const money = data?.money || {};
    homeSetText('homeProMeta', `Business date: ${data?.businessDate || '-'} • Daily priorities • collections • safety`);
    homeSetText('homeUrgentCount', Number(summary.urgentCount || 0));
    homeSetText('homeUrgentAmount', homeMoney(summary.urgentAmount));
    homeSetText('homeOverdueCount', Number(summary.overdueCount || 0));
    homeSetText('homeOverdueAmount', homeMoney(summary.overdueAmount));
    homeSetText('homeTodayCount', Number(summary.todayCount || 0));
    homeSetText('homeTodayAmount', homeMoney(summary.todayAmount));
    homeSetText('homeContactedUrgent', Number(summary.contactedUrgent || 0));
    homeSetText('homeUncontactedUrgent', `${Number(summary.uncontactedUrgent || 0)} pending`);
    homeSetText('homeLegacyMissing', Number(summary.legacyMissingDates || 0));
    homeSetText('homeRecycleCount', Number(summary.recycleItems || 0));
    homeSetText('homeTodayCollected', homeMoney(money.todayCollected));
    homeSetText('homeMonthCollected', homeMoney(money.monthCollected));
    homeSetText('homeOutstanding', homeMoney(money.outstanding));
    homeSetText('homeRecoveryRate', `${Number(money.recoveryRate || 0).toLocaleString('en-IN')}%`);
    homeSetText('homeFollowupCount', `${Number(summary.uncontactedUrgent || 0)} urgent follow-up${Number(summary.uncontactedUrgent || 0) === 1 ? '' : 's'}`);
    homeSetText('homeMissingContact', `${Number(summary.missingContactUrgent || 0)} urgent without contact`);
    homeSetText('homeQualityText', `${Number(summary.legacyMissingDates || 0)} legacy dates pending`);
    homeSetText('homeRecycleText', Number(summary.recycleItems || 0) ? `${Number(summary.recycleItems || 0)} recoverable item(s)` : 'Recycle Bin empty');

    const rate = Math.max(0, Math.min(100, Number(money.recoveryRate || 0)));
    const bar = document.getElementById('homeRecoveryBar');
    if (bar) bar.style.width = `${rate}%`;
    homeSetText('homeRecoveryHint', `${homeMoney(money.outstanding)} outstanding • ${rate.toLocaleString('en-IN')}% scheduled recovery`);

    const backup = data?.latestBackup;
    homeSetText('homeBackupText', backup ? `Latest backup: ${homeDateTime(backup.created_at)}` : 'No snapshot found');

    const priorityBox = document.getElementById('homePriorityList');
    if (priorityBox) {
        const rows = Array.isArray(data?.priorities) ? data.priorities : [];
        priorityBox.innerHTML = rows.length ? rows.map(item => {
            const urgent = String(item.due_date || '') <= String(data?.businessDate || '');
            const status = item.contacted_today ? '<span class="home-pro-tag contacted">✓ Contacted</span>' : (!item.has_contact ? '<span class="home-pro-tag missing">No contact</span>' : '<span class="home-pro-tag pending">Follow-up</span>');
            return `<div class="home-pro-priority ${urgent ? 'urgent' : ''}">
                <div class="home-pro-priority-main">
                    <div><strong>${escapeHtml(item.borrower_name || 'Borrower')}</strong> ${status}</div>
                    <small>${escapeHtml(item.loan_code || '')} • EMI ${escapeHtml(item.installment_number ?? '-')} • ${escapeHtml(homePriorityDueText(item))}</small>
                    <span>${homeMoney(item.remaining)} remaining${Number(item.paid || 0) ? ` • ${homeMoney(item.paid)} paid` : ''}</span>
                </div>
                <div class="home-pro-priority-actions">
                    <button class="btn btn-success" onclick="openPaymentModal('${escapeHtml(item.emi_id)}')">💰 Pay</button>
                    <button class="btn btn-view" onclick="openWhatsAppCenter({borrowerId:'${escapeHtml(item.borrower_id)}',loanId:'${escapeHtml(item.loan_id)}',emiId:'${escapeHtml(item.emi_id)}',template:'${String(item.due_date || '') < String(data?.businessDate || '') ? 'overdue' : 'due'}'})" ${item.has_contact ? '' : 'disabled'}>💬</button>
                    <button class="btn btn-secondary" onclick="openBorrowerProfile('${escapeHtml(item.borrower_id)}')">👤</button>
                </div>
            </div>`;
        }).join('') : '<div class="home-pro-empty">✅ Abhi koi dated urgent/upcoming reminder nahi hai.</div>';
    }

    const activityBox = document.getElementById('homeRecentActivity');
    if (activityBox) {
        const rows = Array.isArray(data?.recentActivity) ? data.recentActivity : [];
        activityBox.innerHTML = rows.length ? rows.slice(0, 6).map(row => `<button class="home-pro-activity" onclick="openActivityHistory()">
            <span>${homeActivityIcon(row.category)}</span>
            <div><b>${escapeHtml(homeActivityLabel(row.action))}</b><small>${escapeHtml(row.description || 'Activity recorded')}</small></div>
            <time>${escapeHtml(homeDateTime(row.created_at))}</time>
        </button>`).join('') : '<div class="home-pro-empty">Recent activity abhi available nahi hai.</div>';
    }

    const badge = document.getElementById('reminderActionBadge');
    if (badge) {
        const count = Number(summary.uncontactedUrgent || 0);
        badge.textContent = String(count);
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
}

async function refreshHomeCommandCenter(silent = false) {
    const loading = document.getElementById('homeProLoading');
    const content = document.getElementById('homeProContent');
    if (!silent && loading) { loading.style.display = 'block'; loading.textContent = 'Command Center refresh ho raha hai...'; }
    try {
        const response = await adminFetch('/api/dashboard?mode=home');
        const data = await response.json();
        renderHomeCommandCenter(data);
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = localStorage.getItem('abhi_home_pro_compact') === 'yes' ? 'none' : 'block';
        updateHomeCommandToggle();
        return data;
    } catch (err) {
        if (loading) { loading.style.display = 'block'; loading.textContent = `Command Center load nahi hua: ${err.message}`; }
        throw err;
    }
}

function updateHomeCommandToggle() {
    const compact = localStorage.getItem('abhi_home_pro_compact') === 'yes';
    const btn = document.getElementById('homeProToggleBtn');
    if (btn) btn.textContent = compact ? '➕ Expand' : '➖ Compact';
}

function toggleHomeCommandCenter() {
    const content = document.getElementById('homeProContent');
    const compact = localStorage.getItem('abhi_home_pro_compact') === 'yes';
    localStorage.setItem('abhi_home_pro_compact', compact ? 'no' : 'yes');
    if (content) content.style.display = compact ? 'block' : 'none';
    updateHomeCommandToggle();
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
        const name = String(borrower.name || 'Unknown').toUpperCase();

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
            <div>📁 ${escapeHtml(name)}</div>
            <div>
                <span>${f.count} Loans | ₹${f.sum.toLocaleString('en-IN')}</span>
                ${f.phone ? `<br><small style="color:#34a853;">📱 ${escapeHtml(f.phone)}</small>` : ''}
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
        if (String(loan.borrowers?.name || '').toUpperCase() === String(name || '').toUpperCase() && loan.status === 'active') {
            totalAmount += parseInt(loan.amount) || 0;
            loanCount++;
        }
    });

    const badgeBg = document.body.classList.contains('dark-mode') ? '#333' : '#fce8e6';
    document.getElementById('currentFolderName').innerHTML = `
        📁 ${escapeHtml(name)}<br>
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
                ${item.emi_id ? `<button class="btn btn-success" onclick="closeDueCenter(); openPaymentModal('${item.emi_id}')">💰 Pay</button><button class="btn btn-view" onclick="openWhatsAppCenter({emiId:'${item.emi_id}',template:'${bucket === 'overdue' ? 'overdue' : 'due'}'})">💬</button>` : ''}
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
        if (String(loan.borrowers?.name || '').toUpperCase() !== String(nameFilter || '').toUpperCase()) return;

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

        const rawRemaining = Math.max(emiSum - paidSum, 0);
        const activeSettlement = activeLoanSettlement(loan);
        const waivedAmount = activeSettlement ? Math.max(0, Number(activeSettlement.waived_amount) || 0) : 0;
        const remaining = activeSettlement ? Math.max(rawRemaining - waivedAmount, 0) : rawRemaining;
        if (activeSettlement) overdueSum = 0;
        const borderColor = loan.status === 'closed' ? '#34a853' : (overdueSum > 0 ? '#ea4335' : (remaining === 0 && emiSum > 0 ? '#34a853' : '#fbbc05'));
        const statusBadge = loan.status === 'closed' ? '🔒 Settled / Closed' : loan.status === 'defaulted' ? '⚠️ Defaulted' : '✅ Active';

        const card = document.createElement('div');
        card.className = 'card';
        card.style.borderLeftColor = borderColor;

        const borrower = loan.borrowers || {};
        const whatsappNum = borrower.whatsapp || borrower.phone || '';

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
                    ${waivedAmount > 0 ? `<span style="color:#7c3aed;font-weight:600;">🤝 Waived: ₹${waivedAmount.toLocaleString('en-IN')}</span>` : ''}
                </div>
                ${overdueSum > 0 ? `<p style="color:#ea4335;font-size:12px;font-weight:600;">🔴 Overdue Remaining: ₹${overdueSum.toLocaleString('en-IN')}</p>` : ''}
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;" class="no-print">
                    ${loan.status !== 'closed' ? `<button class="btn btn-warning" onclick="editLoan('${loan.id}')" style="font-size:12px;padding:6px 10px;">✏️ Edit</button>` : ''}
                    <button class="btn btn-danger" onclick="deleteLoan('${loan.id}')" style="font-size:12px;padding:6px 10px;">♻️ Recycle</button>
                    <button class="btn ${loan.status === 'closed' ? 'btn-view' : 'btn-secondary'}" onclick="openSettlementCenter('${loan.id}')" style="font-size:12px;padding:6px 10px;">${loan.status === 'closed' ? '🔒 Settlement' : '🤝 Settle / Close'}</button>
                    ${whatsappNum ? `<button class="btn btn-success" onclick="openWhatsAppCenter({borrowerId:'${escapeHtml(loan.borrower_id || borrower.id || '')}',loanId:'${escapeHtml(loan.id)}',template:'due'})" style="font-size:12px;padding:6px 10px;">💬 Message</button>` : ''}
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
            const sourceLabel = p.source === 'settlement' ? ' • Settlement closing payment' : (!editable ? ' • Opening balance' : '');
            return `<div class="payment-history-item ${editable ? '' : 'baseline'}">
                <div class="payment-history-meta">
                    <strong>₹${Number(p.amount || 0).toLocaleString('en-IN')} • ${escapeHtml(p.paid_date || '')}</strong>
                    <small>${escapeHtml(p.method || 'Payment')}${p.notes ? ' • ' + escapeHtml(p.notes) : ''}${sourceLabel}</small>
                </div>
                ${editable ? `<div class="payment-history-actions"><button class="btn btn-view" onclick="printPaymentReceipt('${p.id}')" title="Print / Save PDF">🧾</button><button class="btn btn-success" onclick="openPaymentWhatsApp('${p.id}')" title="Payment received WhatsApp message">💬</button><button class="btn btn-warning" onclick="editPayment('${p.id}')">✏️</button><button class="btn btn-danger" onclick="deletePayment('${p.id}')">↩️ Undo</button></div>` : ''}
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
// PHASE 4 - ADVANCED BORROWER PROFILE
// ==========================================
function profileMoney(value) {
    return '₹' + Number(value || 0).toLocaleString('en-IN');
}

function safeProfilePhotoUrl(value) {
    const url = String(value || '').trim();
    return /^https:\/\//i.test(url) ? url : '';
}

function profileInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '👤';
    return parts.slice(0, 2).map(x => x[0]).join('').toUpperCase();
}

function openBorrowerDirectory() {
    const modal = document.getElementById('borrowerDirectoryModal');
    if (!modal) return;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    const search = document.getElementById('profileDirectorySearch');
    if (search) search.value = '';
    renderBorrowerDirectory('');
}

function closeBorrowerDirectory() {
    const modal = document.getElementById('borrowerDirectoryModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleDirectoryOverlayClick(event) {
    if (event.target?.id === 'borrowerDirectoryModal') closeBorrowerDirectory();
}

function renderBorrowerDirectory(query = '') {
    const list = document.getElementById('borrowerDirectoryList');
    if (!list) return;
    const q = String(query || '').trim().toUpperCase();
    const rows = borrowers.filter(b => {
        if (!q) return true;
        return String(b.name || '').toUpperCase().includes(q) ||
               String(b.phone || '').includes(q) ||
               String(b.whatsapp || '').includes(q);
    });
    if (!rows.length) {
        list.innerHTML = '<div class="profile-empty">Koi borrower nahi mila.</div>';
        return;
    }
    list.innerHTML = rows.map(b => {
        const related = loans.filter(l => l.borrower_id === b.id || l.borrowers?.id === b.id);
        const active = related.filter(l => l.status === 'active').length;
        const principal = related.reduce((sum,l) => sum + (Number(l.amount)||0), 0);
        return `<button class="profile-directory-item" onclick="closeBorrowerDirectory(); openBorrowerProfile('${b.id}')">
            <span class="profile-mini-avatar">${escapeHtml(profileInitials(b.name))}</span>
            <span class="profile-directory-main"><strong>${escapeHtml(b.name || 'Unknown')}</strong><small>${b.phone ? '📱 ' + escapeHtml(b.phone) + ' • ' : ''}${active} active loan</small></span>
            <span class="profile-directory-side">${profileMoney(principal)}</span>
        </button>`;
    }).join('');
}

function openBorrowerProfileByName(name) {
    const borrower = borrowers.find(b => String(b.name || '').toUpperCase() === String(name || '').toUpperCase());
    if (!borrower) {
        alert('Borrower profile nahi mila.');
        return;
    }
    openBorrowerProfile(borrower.id);
}

async function openBorrowerProfile(borrowerId) {
    currentProfileBorrowerId = borrowerId;
    currentProfileData = null;
    const modal = document.getElementById('borrowerProfileModal');
    const loading = document.getElementById('profileLoading');
    const content = document.getElementById('profileContent');
    if (!modal) return;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    if (loading) { loading.style.display = 'block'; loading.textContent = 'Loading borrower profile...'; }
    if (content) content.style.display = 'none';

    try {
        const response = await adminFetch(`/api/borrowers?action=profile&id=${encodeURIComponent(borrowerId)}`);
        const data = await response.json();
        currentProfileData = data;
        renderBorrowerProfile(data);
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = 'block';
    } catch (err) {
        if (loading) loading.textContent = err.message || 'Profile load nahi hua.';
    }
}

function closeBorrowerProfile() {
    const modal = document.getElementById('borrowerProfileModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    currentProfileBorrowerId = null;
    currentProfileData = null;
}

function handleProfileOverlayClick(event) {
    if (event.target?.id === 'borrowerProfileModal') closeBorrowerProfile();
}

function profileDetail(label, value, fallback = 'Not set') {
    const text = value ? escapeHtml(String(value)) : fallback;
    return `<div class="profile-detail"><small>${label}</small><strong>${text}</strong></div>`;
}

function renderBorrowerProfile(data) {
    const b = data?.borrower || {};
    const s = data?.summary || {};
    const profileTitle = document.getElementById('borrowerProfileTitle');
    const subtitle = document.getElementById('profileSubtitle');
    const avatar = document.getElementById('profileAvatar');
    if (profileTitle) profileTitle.textContent = b.name || 'Borrower Profile';
    if (subtitle) subtitle.textContent = `${Number(s.activeLoans || 0)} active • ${Number(s.closedLoans || 0)} closed • ${Number(s.totalLoans || 0)} total loan`;
    if (avatar) {
        const photoUrl = safeProfilePhotoUrl(b.photo_url);
        if (photoUrl) avatar.innerHTML = `<img src="${escapeHtml(photoUrl)}" alt="Borrower photo">`;
        else avatar.textContent = profileInitials(b.name);
    }

    const grid = document.getElementById('profileSummaryGrid');
    if (grid) grid.innerHTML = [
        ['💰 Principal', profileMoney(s.principalTotal)],
        ['✅ Collected', profileMoney(s.paidTotal)],
        ['⏳ Account Remaining', profileMoney(s.remainingTotal)],
        ['🤝 Waived', profileMoney(s.waivedTotal)],
        ['🔴 Overdue', profileMoney(s.overdueAmount)],
        ['📄 Loans', `${Number(s.totalLoans || 0)}`],
        ['📎 Documents', `${Number(s.documentCount || 0)}`]
    ].map(([label,value]) => `<div class="profile-summary-tile"><small>${label}</small><strong>${value}</strong></div>`).join('');

    const details = document.getElementById('profilePersonalDetails');
    if (details) details.innerHTML = [
        profileDetail('Name', b.name),
        profileDetail("Father's Name", b.father_name),
        profileDetail('Phone', b.phone),
        profileDetail('WhatsApp', b.whatsapp),
        profileDetail('Address', b.address),
        profileDetail('Aadhaar', b.aadhaar),
        profileDetail('PAN', b.pan),
        profileDetail('Notes', b.notes)
    ].join('');

    const contact = document.getElementById('profileContactActions');
    if (contact) {
        const phone = String(b.phone || '').replace(/[^0-9+]/g, '');
        const rawWa = String(b.whatsapp || b.phone || '').replace(/\D/g, '');
        const wa = rawWa.length === 10 ? `91${rawWa}` : rawWa;
        contact.innerHTML = `${phone ? `<a class="btn btn-view" href="tel:${escapeHtml(phone)}">📞 Call</a>` : ''}${wa ? `<button class="btn btn-success" onclick="openWhatsAppCenter({borrowerId:'${escapeHtml(b.id)}'})">💬 WhatsApp Center</button>` : ''}` || '<span class="profile-muted">Contact number not set.</span>';
    }

    const loanList = document.getElementById('profileLoanHistory');
    const profileLoans = data?.loans || [];
    if (loanList) {
        if (!profileLoans.length) loanList.innerHTML = '<div class="profile-empty">Is borrower ka koi loan nahi hai.</div>';
        else loanList.innerHTML = profileLoans.map(loan => {
            let scheduled = 0, paid = 0, overdue = 0;
            const emis = loan.emis || [];
            for (const e of emis) {
                const amount = Number(e.amount || 0);
                const p = Math.max(0, Math.min(Number(e.paid_amount || 0), amount));
                const r = Math.max(amount-p,0);
                scheduled += amount; paid += p;
                if (e.status === 'overdue') overdue += r;
            }
            const rawRemaining = Math.max(scheduled-paid,0);
            const profileSettlement = activeLoanSettlement(loan);
            const waived = profileSettlement ? Math.max(0, Number(profileSettlement.waived_amount)||0) : 0;
            const remaining = profileSettlement ? Math.max(rawRemaining-waived,0) : rawRemaining;
            if (profileSettlement) overdue = 0;
            const statusClass = loan.status === 'closed' ? 'closed' : loan.status === 'defaulted' ? 'defaulted' : 'active';
            const emiHtml = emis.length ? emis.map(e => {
                const amount = Number(e.amount || 0);
                const p = Math.max(0, Math.min(Number(e.paid_amount || 0), amount));
                const r = Math.max(amount-p,0);
                const dateLabel = `${e.due_day || ''} ${e.due_month || ''}${e.due_year ? ' ' + e.due_year : ' • year not set'}`;
                return `<div class="profile-emi-row"><span><strong>EMI #${Number(e.installment_number || 0)}</strong><small>${escapeHtml(dateLabel)} • ${escapeHtml(e.status || 'pending')}</small></span><span><strong>${profileMoney(r)}</strong><button class="btn btn-success" onclick="openProfilePayment('${e.id}')">${p > 0 ? '🧾' : '💰'}</button></span></div>`;
            }).join('') : '<div class="profile-muted">No EMI schedule.</div>';
            return `<div class="profile-loan-card ${statusClass}">
                <div class="profile-loan-head"><div><strong>${escapeHtml(loan.loan_code || '')}</strong><small>${loan.loan_year || 'Year not set'} • ${escapeHtml(loan.status || 'active')}</small></div><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end;"><strong>${profileMoney(loan.amount)}</strong><button class="btn btn-view no-print" style="width:auto;margin:0;padding:5px 7px;font-size:10px;" onclick="printLoanAccountStatement('${loan.id}')">🧾 Statement</button><button class="btn btn-success no-print" style="width:auto;margin:0;padding:5px 7px;font-size:10px;" onclick="openWhatsAppCenter({borrowerId:'${escapeHtml(b.id)}',loanId:'${loan.id}',template:'due'})">💬 Message</button><button class="btn btn-secondary no-print" style="width:auto;margin:0;padding:5px 7px;font-size:10px;" onclick="openSettlementCenter('${loan.id}')">${loan.status === 'closed' ? '🔒 Settlement' : '🤝 Settle'}</button></div></div>
                <div class="profile-loan-metrics"><span>Scheduled <b>${profileMoney(scheduled)}</b></span><span>Paid <b>${profileMoney(paid)}</b></span><span>Remaining <b>${profileMoney(remaining)}</b></span>${waived ? `<span>Waived <b>${profileMoney(waived)}</b></span>` : ''}${overdue ? `<span class="danger">Overdue <b>${profileMoney(overdue)}</b></span>` : ''}</div>
                <div class="profile-emi-list">${emiHtml}</div>
            </div>`;
        }).join('');
    }

    const count = document.getElementById('profileDocumentCount');
    if (count) count.textContent = `${Number(s.documentCount || 0)} files`;

    const loanSelect = document.getElementById('profileDocLoan');
    if (loanSelect) {
        const previous = loanSelect.value;
        loanSelect.innerHTML = '<option value="">Borrower level / no loan</option>' + profileLoans.map(loan =>
            `<option value="${escapeHtml(loan.id)}">${escapeHtml(loan.loan_code || 'Loan')} • ${profileMoney(loan.amount)}</option>`
        ).join('');
        if ([...loanSelect.options].some(o => o.value === previous)) loanSelect.value = previous;
    }

    const docs = document.getElementById('profileDocumentsPreview');
    const documents = data?.documents || [];
    if (docs) {
        docs.innerHTML = documents.length ? documents.map(d => {
            const typeLabel = profileDocumentTypeLabel(d.doc_type);
            const loan = profileLoans.find(l => l.id === d.loan_id);
            return `<div class="profile-doc-row">
                <span class="profile-doc-main"><strong>📄 ${escapeHtml(typeLabel)}</strong><small>${escapeHtml(d.file_name || '')}${loan ? ` • ${escapeHtml(loan.loan_code || 'Loan')}` : ''}</small></span>
                <span class="profile-doc-actions"><button class="btn btn-view" onclick="openProfileDocument('${d.id}')">👁️ View</button><button class="btn btn-danger" onclick="deleteProfileDocument('${d.id}')">🗑️</button></span>
            </div>`;
        }).join('') : '<div class="profile-empty compact">Koi document upload nahi hai.</div>';
    }
}

function profileDocumentTypeLabel(value) {
    return ({ aadhaar:'Aadhaar', pan:'PAN', agreement:'Loan Agreement', receipt:'Receipt', photo:'Photo', other:'Other Document' })[String(value || '').toLowerCase()] || 'Document';
}

function setProfileUploadStatus(message, kind = 'info') {
    const box = document.getElementById('profileUploadStatus');
    if (!box) return;
    box.style.display = message ? 'block' : 'none';
    box.className = `profile-upload-status ${kind}`;
    box.textContent = message || '';
}

function triggerBorrowerPhotoUpload() {
    if (!currentProfileBorrowerId) return;
    document.getElementById('profilePhotoInput')?.click();
}

async function uploadBorrowerPhoto(event) {
    const file = event?.target?.files?.[0];
    if (!file || !currentProfileBorrowerId) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
        alert('Photo JPG, PNG ya WEBP format me hona chahiye.');
        event.target.value = '';
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        alert('Photo 8 MB se chhota hona chahiye.');
        event.target.value = '';
        return;
    }

    const btn = document.getElementById('profilePhotoBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    setProfileUploadStatus('Borrower photo upload ho rahi hai...', 'info');
    try {
        const url = `/api/upload?bucket=photos&borrower_id=${encodeURIComponent(currentProfileBorrowerId)}&filename=${encodeURIComponent(file.name)}`;
        const response = await adminFetch(url, { method:'POST', headers:{ 'Content-Type': file.type }, body:file });
        await response.json();
        setProfileUploadStatus('✅ Borrower photo update ho gayi.', 'success');
        await openBorrowerProfile(currentProfileBorrowerId);
        await loadAllData();
    } catch (err) {
        setProfileUploadStatus(`❌ ${err.message || 'Photo upload failed'}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📷'; }
        event.target.value = '';
    }
}

async function uploadBorrowerDocument() {
    const borrowerId = currentProfileBorrowerId;
    const fileInput = document.getElementById('profileDocFile');
    const file = fileInput?.files?.[0];
    if (!borrowerId || !file) {
        setProfileUploadStatus('Pehle document file select karein.', 'error');
        return;
    }
    if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)) {
        setProfileUploadStatus('PDF, JPG, PNG ya WEBP file hi allowed hai.', 'error');
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        setProfileUploadStatus('File 8 MB se chhoti honi chahiye.', 'error');
        return;
    }

    const docType = document.getElementById('profileDocType')?.value || 'other';
    const loanId = document.getElementById('profileDocLoan')?.value || '';
    const btn = document.getElementById('profileDocUploadBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Uploading...'; }
    setProfileUploadStatus('Document private storage me upload ho raha hai...', 'info');

    try {
        const params = new URLSearchParams({ bucket:'documents', borrower_id:borrowerId, doc_type:docType, filename:file.name });
        if (loanId) params.set('loan_id', loanId);
        const response = await adminFetch(`/api/upload?${params.toString()}`, { method:'POST', headers:{ 'Content-Type': file.type }, body:file });
        await response.json();
        setProfileUploadStatus('✅ Document securely upload ho gaya.', 'success');
        fileInput.value = '';
        await openBorrowerProfile(borrowerId);
    } catch (err) {
        setProfileUploadStatus(`❌ ${err.message || 'Document upload failed'}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⬆️ Upload'; }
    }
}

async function openProfileDocument(documentId) {
    const tab = window.open('about:blank', '_blank');
    try {
        const response = await adminFetch(`/api/documents?action=signed&id=${encodeURIComponent(documentId)}`);
        const data = await response.json();
        if (!data?.url) throw new Error('Document link nahi mila');
        if (tab) tab.location.href = data.url;
        else window.location.href = data.url;
    } catch (err) {
        if (tab) tab.close();
        alert(err.message || 'Document open nahi hua.');
    }
}

async function deleteProfileDocument(documentId) {
    if (!confirm('Is document ko Recycle Bin me move karna hai? File abhi permanently delete nahi hogi.')) return;
    const borrowerId = currentProfileBorrowerId;
    setProfileUploadStatus('Document Recycle Bin me move ho raha hai...', 'info');
    try {
        await adminFetch('/api/documents?action=delete', {
            method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ id: documentId })
        });
        setProfileUploadStatus('✅ Document Recycle Bin me move ho gaya.', 'success');
        if (borrowerId) await openBorrowerProfile(borrowerId);
    } catch (err) {
        setProfileUploadStatus(`❌ ${err.message || 'Document recycle failed'}`, 'error');
    }
}

function editCurrentBorrowerProfile() {
    const id = currentProfileBorrowerId;
    if (!id) return;
    closeBorrowerProfile();
    showBorrowerForm(id);
}

function addLoanFromProfile() {
    const id = currentProfileBorrowerId;
    if (!id) return;
    closeBorrowerProfile();
    showForm(id);
}

function openProfilePayment(emiId) {
    closeBorrowerProfile();
    openPaymentModal(emiId);
}



// ==========================================
// PHASE 7 - WHATSAPP & CONTACT TOOLS
// ==========================================
function normalizeWhatsAppNumber(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10) digits = `91${digits}`;
    if (digits.length < 8 || digits.length > 15) return '';
    return digits;
}

function waMoney(value) {
    return `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
}

function waDateLabel(emi) {
    if (!emi) return 'date not set';
    if (emi.due_date) {
        const d = new Date(`${String(emi.due_date).slice(0,10)}T00:00:00Z`);
        if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
    }
    const base = `${emi.due_day || ''} ${emi.due_month || ''}`.trim();
    return `${base || 'Due date'}${emi.due_year ? ` ${emi.due_year}` : ' • Year not set'}`;
}

function waBorrowerForLoan(loan) {
    if (!loan) return null;
    return borrowers.find(b => b.id === loan.borrower_id || b.id === loan.borrowers?.id)
        || (loan.borrowers ? { ...loan.borrowers, id: loan.borrower_id || loan.borrowers.id } : null);
}

function getWhatsAppContext() {
    const borrowerId = document.getElementById('waBorrowerSelect')?.value || '';
    const loanId = document.getElementById('waLoanSelect')?.value || '';
    const emiId = document.getElementById('waEmiSelect')?.value || '';
    const borrower = borrowers.find(b => b.id === borrowerId) || currentProfileData?.borrower || null;
    const loan = loans.find(l => l.id === loanId) || (currentProfileData?.loans || []).find(l => l.id === loanId) || null;
    const emi = (loan?.emis || []).find(e => e.id === emiId) || null;
    const payment = currentWhatsAppPaymentId ? currentPaymentHistory.find(p => p.id === currentWhatsAppPaymentId) : null;
    return { borrower, loan, emi, payment };
}

function populateWaBorrowers(selectedId = '') {
    const select = document.getElementById('waBorrowerSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- Borrower select --</option>' + borrowers.map(b =>
        `<option value="${escapeHtml(b.id)}" ${b.id === selectedId ? 'selected' : ''}>${escapeHtml(b.name || 'Unknown')}</option>`
    ).join('');
}

function populateWaLoans(selectedId = '') {
    const borrowerId = document.getElementById('waBorrowerSelect')?.value || '';
    const select = document.getElementById('waLoanSelect');
    if (!select) return;
    const items = loans.filter(l => l.borrower_id === borrowerId || l.borrowers?.id === borrowerId);
    select.innerHTML = '<option value="">-- Loan optional --</option>' + items.map(l =>
        `<option value="${escapeHtml(l.id)}" ${l.id === selectedId ? 'selected' : ''}>${escapeHtml(l.loan_code || 'Loan')} • ${waMoney(l.amount)}</option>`
    ).join('');
}

function populateWaEmis(selectedId = '') {
    const loanId = document.getElementById('waLoanSelect')?.value || '';
    const select = document.getElementById('waEmiSelect');
    if (!select) return;
    const loan = loans.find(l => l.id === loanId) || (currentProfileData?.loans || []).find(l => l.id === loanId);
    const emis = [...(loan?.emis || [])].sort((a,b) => Number(a.installment_number||0)-Number(b.installment_number||0));
    select.innerHTML = '<option value="">-- EMI optional --</option>' + emis.map(e => {
        const remaining = Math.max((Number(e.amount)||0) - (Number(e.paid_amount)||0), 0);
        return `<option value="${escapeHtml(e.id)}" ${e.id === selectedId ? 'selected' : ''}>EMI #${Number(e.installment_number||0)} • ${escapeHtml(waDateLabel(e))} • ${waMoney(remaining)}</option>`;
    }).join('');
}

function updateWaContactPreview() {
    const input = document.getElementById('waPhoneInput');
    const preview = document.getElementById('waContactPreview');
    const chars = document.getElementById('waMessageChars');
    const message = document.getElementById('waMessageText');
    const normalized = normalizeWhatsAppNumber(input?.value || '');
    if (preview) preview.textContent = normalized ? `+${normalized}` : 'Invalid / not set';
    if (chars && message) chars.textContent = `${message.value.length} / 2000`;
}

function updateWhatsAppContextSummary() {
    const box = document.getElementById('waContextSummary');
    if (!box) return;
    const { borrower, loan, emi, payment } = getWhatsAppContext();
    const parts = [];
    if (borrower) parts.push(`<span>👤 ${escapeHtml(borrower.name || '')}</span>`);
    if (loan) parts.push(`<span>💳 ${escapeHtml(loan.loan_code || '')}</span>`);
    if (emi) parts.push(`<span>📅 EMI #${Number(emi.installment_number||0)} • ${escapeHtml(waDateLabel(emi))}</span>`);
    if (payment) parts.push(`<span>✅ Payment ${waMoney(payment.amount)}</span>`);
    box.innerHTML = parts.length ? parts.join('') : '<span>Borrower/loan select karke message context set karein.</span>';
}

function buildWhatsAppTemplate(type, ctx) {
    const borrower = ctx.borrower || {};
    const loan = ctx.loan || {};
    const emi = ctx.emi || {};
    const payment = ctx.payment || {};
    const name = borrower.name || 'Sir/Madam';
    const loanCode = loan.loan_code || '—';
    const scheduled = Math.max(0, Number(emi.amount) || 0);
    const paid = Math.max(0, Math.min(Number(emi.paid_amount) || 0, scheduled));
    const remaining = Math.max(scheduled - paid, 0);
    const emiNo = Number(emi.installment_number || 0);
    const date = waDateLabel(emi);
    const loanTotals = phase6LoanTotals(loan);

    if (type === 'custom') return `Namaskar ${name},\n\n`;
    if (type === 'overdue') {
        return `Namaskar ${name},\n\naapki EMI${emiNo ? ` #${emiNo}` : ''} overdue hai.\nLoan ID: ${loanCode}\nDue date: ${date}\nPending amount: ${waMoney(remaining || scheduled)}\n\nKripya payment jaldi complete karein. Agar payment already ho chuka hai to is message ko ignore karein.\n\n- Abhishek Management`;
    }
    if (type === 'payment') {
        const amount = Number(payment.amount) || paid;
        const paymentDate = payment.paid_date || payment.payment_date || emi.paid_date || new Date().toISOString().slice(0,10);
        return `Namaskar ${name},\n\naapka ${waMoney(amount)} payment receive ho gaya hai. ✅\nLoan ID: ${loanCode}${emiNo ? `\nEMI: #${emiNo}` : ''}\nPayment date: ${phase6Date(paymentDate)}\nEMI remaining: ${waMoney(remaining)}\n\nDhanyavaad.\n- Abhishek Management`;
    }
    if (type === 'closing') {
        return `Namaskar ${name},\n\nLoan ID ${loanCode} ka account ${loan.status === 'closed' || loanTotals.remaining <= 0 ? 'complete/closed' : 'closing review ke liye ready'} hai.\nPrincipal: ${waMoney(loan.amount)}\nCollected: ${waMoney(loanTotals.paid)}\nRemaining EMI balance: ${waMoney(loanTotals.remaining)}\n\nAapke cooperation ke liye dhanyavaad.\n- Abhishek Management`;
    }
    return `Namaskar ${name},\n\naapki EMI${emiNo ? ` #${emiNo}` : ''} ${date} ko due hai.\nLoan ID: ${loanCode}\nDue amount: ${waMoney(remaining || scheduled)}\n\nKripya due date tak payment complete karein. Agar payment already ho chuka hai to is message ko ignore karein.\n\n- Abhishek Management`;
}

function generateWhatsAppMessage() {
    const text = document.getElementById('waMessageText');
    const template = document.getElementById('waTemplateSelect')?.value || 'due';
    if (!text) return;
    text.value = buildWhatsAppTemplate(template, getWhatsAppContext());
    updateWhatsAppContextSummary();
    updateWaContactPreview();
}

function handleWaBorrowerChange() {
    currentWhatsAppPaymentId = null;
    const borrower = borrowers.find(b => b.id === document.getElementById('waBorrowerSelect')?.value);
    const phone = document.getElementById('waPhoneInput');
    if (phone) phone.value = borrower?.whatsapp || borrower?.phone || '';
    populateWaLoans('');
    populateWaEmis('');
    generateWhatsAppMessage();
}

function handleWaLoanChange() {
    currentWhatsAppPaymentId = null;
    populateWaEmis('');
    generateWhatsAppMessage();
}

function handleWaEmiChange() {
    currentWhatsAppPaymentId = null;
    generateWhatsAppMessage();
}

function openWhatsAppCenter(options = {}) {
    const modal = document.getElementById('whatsappCenterModal');
    if (!modal) return;
    currentWhatsAppPaymentId = options.paymentId || null;

    let borrowerId = options.borrowerId || '';
    let loanId = options.loanId || '';
    let emiId = options.emiId || '';
    if (emiId) {
        const ctx = findEmiContext(emiId);
        if (ctx) {
            loanId = ctx.loan.id;
            borrowerId = ctx.loan.borrower_id || ctx.loan.borrowers?.id || '';
        }
    }
    if (loanId && !borrowerId) {
        const loan = loans.find(l => l.id === loanId) || (currentProfileData?.loans || []).find(l => l.id === loanId);
        borrowerId = loan?.borrower_id || loan?.borrowers?.id || currentProfileData?.borrower?.id || '';
    }
    if (!borrowerId && currentProfileData?.borrower?.id) borrowerId = currentProfileData.borrower.id;

    populateWaBorrowers(borrowerId);
    populateWaLoans(loanId);
    populateWaEmis(emiId);

    const borrower = borrowers.find(b => b.id === borrowerId) || currentProfileData?.borrower;
    const phone = document.getElementById('waPhoneInput');
    if (phone) phone.value = borrower?.whatsapp || borrower?.phone || '';
    const template = document.getElementById('waTemplateSelect');
    if (template) template.value = ['due','overdue','payment','closing','custom'].includes(options.template) ? options.template : 'due';

    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    generateWhatsAppMessage();
    setTimeout(() => document.getElementById('waMessageText')?.focus(), 80);
}

function openPaymentWhatsApp(paymentId) {
    openWhatsAppCenter({ emiId: currentPaymentEmiId, paymentId, template:'payment' });
}

function closeWhatsAppCenter() {
    const modal = document.getElementById('whatsappCenterModal');
    if (modal) modal.style.display = 'none';
    currentWhatsAppPaymentId = null;
    document.body.style.overflow = '';
}

function handleWhatsAppOverlayClick(event) {
    if (event.target?.id === 'whatsappCenterModal') closeWhatsAppCenter();
}

async function copyWhatsAppMessage() {
    const text = document.getElementById('waMessageText')?.value || '';
    if (!text.trim()) return alert('Message empty hai.');
    try {
        await navigator.clipboard.writeText(text);
        alert('✅ Message copy ho gaya.');
    } catch {
        const box = document.getElementById('waMessageText');
        box?.select();
        document.execCommand?.('copy');
        alert('✅ Message copy ho gaya.');
    }
}

function launchWhatsAppMessage() {
    const input = document.getElementById('waPhoneInput')?.value || '';
    const number = normalizeWhatsAppNumber(input);
    const text = document.getElementById('waMessageText')?.value || '';
    if (!number) return alert('Valid WhatsApp number required hai.');
    if (!text.trim()) return alert('Message empty hai.');
    const url = `https://wa.me/${encodeURIComponent(number)}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
}


document.addEventListener('input', event => {
    if (event.target?.id === 'waMessageText') updateWaContactPreview();
});

// ==========================================
// PHASE 6 - LOAN STATEMENTS & PAYMENT RECEIPTS
// ==========================================
function phase6Date(value) {
    const raw = String(value || '').slice(0, 10);
    if (!raw) return 'Not set';
    const d = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(d.getTime())) return escapeHtml(raw);
    return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

function phase6GeneratedAt() {
    return new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric',
        hour:'2-digit', minute:'2-digit', hour12:true
    });
}

function phase6Money(value) {
    return `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
}

function activeLoanSettlement(loan) {
    return (loan?.loan_settlements || []).find(s => !s.reopened_at) || null;
}

function phase6LoanTotals(loan) {
    let scheduled = 0, paid = 0, overdue = 0;
    for (const e of (loan?.emis || [])) {
        const amount = Math.max(0, Number(e.amount) || 0);
        const collected = Math.max(0, Math.min(Number(e.paid_amount) || 0, amount));
        const remaining = Math.max(amount - collected, 0);
        scheduled += amount;
        paid += collected;
        if (e.status === 'overdue') overdue += remaining;
    }
    const rawRemaining = Math.max(scheduled-paid, 0);
    const settlement = activeLoanSettlement(loan);
    const waived = settlement ? Math.max(0, Number(settlement.waived_amount) || 0) : 0;
    const remaining = settlement ? Math.max(rawRemaining - waived, 0) : rawRemaining;
    if (settlement) overdue = 0;
    return { scheduled, paid, rawRemaining, waived, remaining, overdue, settlement };
}

function phase6PrintDocument(title, bodyHtml) {
    const win = window.open('', '_blank');
    if (!win) {
        alert('Print window block ho gayi. Browser me pop-ups allow karke dobara try karein.');
        return;
    }
    const safeTitle = escapeHtml(title || 'AbhiTools Statement');
    win.document.open();
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>
        *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;background:#eef2f7;padding:24px}
        .sheet{max-width:920px;margin:0 auto;background:#fff;padding:30px;border-radius:14px;box-shadow:0 12px 38px rgba(15,23,42,.12)}
        .brand{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid #1d4ed8;padding-bottom:14px;margin-bottom:18px}
        .brand h1{font-size:24px;margin:0;color:#1d4ed8}.brand p{margin:5px 0 0;color:#64748b}.doc-title{text-align:right}.doc-title strong{font-size:18px;display:block}.doc-title small{color:#64748b}
        .party{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:15px 0}.box{border:1px solid #dbe4f0;border-radius:9px;padding:11px}.box small{display:block;color:#64748b;margin-bottom:4px}.box strong{word-break:break-word}
        .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:16px 0}.metric{padding:11px;border:1px solid #dbe4f0;border-radius:9px;background:#f8fafc}.metric small,.metric strong{display:block}.metric small{color:#64748b;margin-bottom:4px}.metric strong{font-size:17px}
        h2{font-size:16px;margin:22px 0 8px;color:#0f172a} table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #dbe4f0;padding:8px;text-align:left;vertical-align:top}th{background:#f1f5f9}.right{text-align:right}.status{font-weight:700;text-transform:capitalize}.note{font-size:11px;color:#64748b;line-height:1.45;margin-top:14px}.footer{border-top:1px solid #dbe4f0;margin-top:24px;padding-top:10px;font-size:10px;color:#64748b;display:flex;justify-content:space-between;gap:15px}
        .receipt-amount{font-size:32px;font-weight:800;color:#15803d;margin:14px 0}.receipt-id{font-family:monospace;font-size:11px;color:#475569}
        @media(max-width:650px){body{padding:0;background:#fff}.sheet{padding:16px;box-shadow:none;border-radius:0}.party,.summary{grid-template-columns:1fr 1fr}.brand{flex-direction:column}.doc-title{text-align:left}table{font-size:10px}th,td{padding:5px}}
        @media print{body{background:#fff;padding:0}.sheet{max-width:none;box-shadow:none;border-radius:0;padding:10mm}.no-print{display:none!important}@page{size:A4;margin:8mm}}
    </style></head><body><main class="sheet">${bodyHtml}<div class="footer"><span>AbhiTools • Abhishek Management</span><span>Generated ${escapeHtml(phase6GeneratedAt())}</span></div></main><script>setTimeout(()=>window.print(),350);<\/script></body></html>`);
    win.document.close();
}

function phase6EmiRows(loan) {
    const emis = [...(loan?.emis || [])].sort((a,b) => Number(a.installment_number||0)-Number(b.installment_number||0));
    if (!emis.length) return '<tr><td colspan="7">No EMI schedule.</td></tr>';
    return emis.map(e => {
        const amount = Math.max(0, Number(e.amount)||0);
        const paid = Math.max(0, Math.min(Number(e.paid_amount)||0, amount));
        const remaining = Math.max(amount-paid,0);
        const due = e.due_date ? phase6Date(e.due_date) : `${escapeHtml(e.due_day || '')} ${escapeHtml(e.due_month || '')}${e.due_year ? ' ' + escapeHtml(e.due_year) : ' • Year not set'}`;
        return `<tr><td>#${Number(e.installment_number||0)}</td><td>${due}</td><td class="right">${phase6Money(amount)}</td><td class="right">${phase6Money(paid)}</td><td class="right">${phase6Money(remaining)}</td><td class="status">${escapeHtml(e.status || 'pending')}</td><td>${e.paid_date ? phase6Date(e.paid_date) : '—'}</td></tr>`;
    }).join('');
}

function printBorrowerAccountStatement() {
    const data = currentProfileData;
    const b = data?.borrower;
    if (!b) { alert('Borrower profile load karke statement banayein.'); return; }
    const s = data.summary || {};
    const loanRows = (data.loans || []).map(loan => {
        const t = phase6LoanTotals(loan);
        return `<tr><td>${escapeHtml(loan.loan_code || '')}</td><td>${loan.loan_year || 'Year not set'}</td><td class="status">${escapeHtml(loan.status || 'active')}</td><td class="right">${phase6Money(loan.amount)}</td><td class="right">${phase6Money(t.scheduled)}</td><td class="right">${phase6Money(t.paid)}</td><td class="right">${phase6Money(t.remaining)}</td></tr>`;
    }).join('') || '<tr><td colspan="7">No loans.</td></tr>';
    const emiSections = (data.loans || []).map(loan => `<h2>${escapeHtml(loan.loan_code || 'Loan')} • EMI Schedule</h2><table><thead><tr><th>EMI</th><th>Due</th><th class="right">Scheduled</th><th class="right">Paid</th><th class="right">Remaining</th><th>Status</th><th>Last Paid</th></tr></thead><tbody>${phase6EmiRows(loan)}</tbody></table>`).join('');
    phase6PrintDocument(`${b.name || 'Borrower'} Account Statement`, `
        <div class="brand"><div><h1>Abhishek Management</h1><p>Loan Account Management Statement</p></div><div class="doc-title"><strong>Borrower Account Statement</strong><small>Account Ref: ${escapeHtml(String(b.id || '').slice(0,8).toUpperCase())}</small></div></div>
        <div class="party"><div class="box"><small>Borrower</small><strong>${escapeHtml(b.name || '')}</strong></div><div class="box"><small>Phone</small><strong>${escapeHtml(b.phone || b.whatsapp || 'Not set')}</strong></div><div class="box"><small>Father's Name</small><strong>${escapeHtml(b.father_name || 'Not set')}</strong></div><div class="box"><small>Address</small><strong>${escapeHtml(b.address || 'Not set')}</strong></div></div>
        <div class="summary"><div class="metric"><small>Principal</small><strong>${phase6Money(s.principalTotal)}</strong></div><div class="metric"><small>Collected</small><strong>${phase6Money(s.paidTotal)}</strong></div><div class="metric"><small>EMI Remaining</small><strong>${phase6Money(s.remainingTotal)}</strong></div><div class="metric"><small>Overdue</small><strong>${phase6Money(s.overdueAmount)}</strong></div></div>
        <h2>Loan Summary</h2><table><thead><tr><th>Loan ID</th><th>Year</th><th>Status</th><th class="right">Principal</th><th class="right">EMI Total</th><th class="right">Collected</th><th class="right">Remaining</th></tr></thead><tbody>${loanRows}</tbody></table>
        ${emiSections}
        <p class="note">This statement is generated from records stored in AbhiTools. Legacy EMI entries with an unknown year are shown as “Year not set” rather than assigning an assumed date. Use the browser print dialog to print or Save as PDF.</p>
    `);
}

function printLoanAccountStatement(loanId) {
    const data = currentProfileData;
    const b = data?.borrower || {};
    const loan = (data?.loans || []).find(l => l.id === loanId) || loans.find(l => l.id === loanId);
    if (!loan) { alert('Loan statement data nahi mila.'); return; }
    const borrower = b.name ? b : (borrowers.find(x => x.id === loan.borrower_id) || loan.borrowers || {});
    const t = phase6LoanTotals(loan);
    phase6PrintDocument(`${loan.loan_code || 'Loan'} Statement`, `
        <div class="brand"><div><h1>Abhishek Management</h1><p>Loan Account Statement</p></div><div class="doc-title"><strong>Loan Statement</strong><small>${escapeHtml(loan.loan_code || '')}</small></div></div>
        <div class="party"><div class="box"><small>Borrower</small><strong>${escapeHtml(borrower.name || 'Unknown')}</strong></div><div class="box"><small>Phone</small><strong>${escapeHtml(borrower.phone || borrower.whatsapp || 'Not set')}</strong></div><div class="box"><small>Loan Year</small><strong>${loan.loan_year || 'Year not set'}</strong></div><div class="box"><small>Loan Status</small><strong>${escapeHtml(loan.status || 'active')}</strong></div></div>
        <div class="summary"><div class="metric"><small>Principal</small><strong>${phase6Money(loan.amount)}</strong></div><div class="metric"><small>Scheduled EMI</small><strong>${phase6Money(t.scheduled)}</strong></div><div class="metric"><small>Collected</small><strong>${phase6Money(t.paid)}</strong></div><div class="metric"><small>Account Remaining</small><strong>${phase6Money(t.remaining)}</strong></div></div>
        ${t.settlement ? `<h2>Settlement / Closing</h2><div class="party"><div class="box"><small>Closing Date</small><strong>${phase6Date(t.settlement.settlement_date)}</strong></div><div class="box"><small>Final Payment</small><strong>${phase6Money(t.settlement.final_payment_amount)}</strong></div><div class="box"><small>Waived / Adjusted</small><strong>${phase6Money(t.settlement.waived_amount)}</strong></div><div class="box"><small>Method</small><strong>${escapeHtml(t.settlement.method || 'Not set')}</strong></div></div>` : ''}
        <h2>EMI Schedule & Payment Status</h2><table><thead><tr><th>EMI</th><th>Due</th><th class="right">Scheduled</th><th class="right">Paid</th><th class="right">Remaining</th><th>Status</th><th>Last Paid</th></tr></thead><tbody>${phase6EmiRows(loan)}</tbody></table>
        ${loan.notes ? `<h2>Loan Notes</h2><div class="box">${escapeHtml(loan.notes)}</div>` : ''}
        <p class="note">Overdue total: <strong>${phase6Money(t.overdue)}</strong>. Browser print dialog se is statement ko print ya Save as PDF kiya ja sakta hai.</p>
    `);
}

function printPaymentReceipt(paymentId) {
    const payment = currentPaymentHistory.find(p => p.id === paymentId && p.source === 'manual');
    const ctx = findEmiContext(currentPaymentEmiId);
    if (!payment || !ctx) { alert('Payment receipt data nahi mila.'); return; }
    const emi = ctx.emi;
    const loan = ctx.loan;
    const scheduled = Math.max(0, Number(emi.amount)||0);
    const totalPaid = Math.max(0, Math.min(Number(emi.paid_amount)||0, scheduled));
    const remaining = Math.max(scheduled-totalPaid,0);
    const receiptNo = `ABHI-${String(payment.id || '').replaceAll('-','').slice(0,10).toUpperCase()}`;
    phase6PrintDocument(`${receiptNo} Payment Receipt`, `
        <div class="brand"><div><h1>Abhishek Management</h1><p>EMI Payment Receipt</p></div><div class="doc-title"><strong>Payment Receipt</strong><small class="receipt-id">${escapeHtml(receiptNo)}</small></div></div>
        <div class="party"><div class="box"><small>Received From</small><strong>${escapeHtml(loan.borrowers?.name || 'Borrower')}</strong></div><div class="box"><small>Loan ID</small><strong>${escapeHtml(loan.loan_code || '')}</strong></div><div class="box"><small>EMI</small><strong>#${Number(emi.installment_number||0)} • ${escapeHtml(emi.due_month || '')}${emi.due_year ? ' ' + escapeHtml(emi.due_year) : ' • Year not set'}</strong></div><div class="box"><small>Payment Date</small><strong>${phase6Date(payment.paid_date || payment.payment_date)}</strong></div></div>
        <div class="receipt-amount">${phase6Money(payment.amount)}</div>
        <div class="party"><div class="box"><small>Payment Method</small><strong>${escapeHtml(payment.method || 'Not set')}</strong></div><div class="box"><small>Payment Notes</small><strong>${escapeHtml(payment.notes || '—')}</strong></div><div class="box"><small>EMI Scheduled</small><strong>${phase6Money(scheduled)}</strong></div><div class="box"><small>EMI Remaining After Current Records</small><strong>${phase6Money(remaining)}</strong></div></div>
        <p class="note">Payment reference: ${escapeHtml(payment.id)}. This receipt reflects the payment entry recorded in AbhiTools. Corrections or reversals in the payment ledger change the account balance accordingly.</p>
    `);
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
    if (!confirm('Is loan ko Recycle Bin me move karna hai? EMI, payment aur settlement history recoverable rahegi.')) return;
    try {
        await adminFetch('/api/loans?action=delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loan_id: loanId })
        });
        await loadAllData();
        if (currentOpenFolder && loans.some(l => l.borrowers?.name?.toUpperCase() === currentOpenFolder.toUpperCase())) openFolder(currentOpenFolder);
        else goBackToFolders();
    } catch (err) {
        alert(err.message || 'Loan Recycle Bin me move nahi hua.');
    }
}

async function closeLoan(loanId) {
    // Backward-compatible alias: Phase 11 uses the audited Settlement Center.
    return openSettlementCenter(loanId);
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
            <div class="import-stat"><strong>${Number(c.settlements || 0)}</strong>Settlements</div>
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


// ==========================================
// PHASE 8 - ADVANCED DASHBOARD
// ==========================================
function advMoney(value) {
    return `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
}

function openAdvancedDashboard() {
    const modal = document.getElementById('advancedDashboardModal');
    if (!modal) return;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    refreshAdvancedDashboard();
}

function closeAdvancedDashboard() {
    const modal = document.getElementById('advancedDashboardModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleAdvancedDashboardOverlayClick(event) {
    if (event?.target?.id === 'advancedDashboardModal') closeAdvancedDashboard();
}

function advSetText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function advStatusBars(items, total) {
    const denominator = Math.max(Number(total) || 0, 1);
    return items.map(item => {
        const count = Math.max(0, Number(item.count) || 0);
        const percent = Math.max(0, Math.min(100, (count / denominator) * 100));
        return `<div class="adv-status-row" data-kind="${escapeHtml(item.kind)}">
            <span>${escapeHtml(item.label)}</span>
            <div class="adv-status-track"><div class="adv-status-fill" style="width:${percent.toFixed(1)}%"></div></div>
            <strong>${count}</strong>
        </div>`;
    }).join('');
}

function advMiniTile(label, value, extra = '') {
    return `<div class="adv-mini-tile"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong>${extra ? `<div class="profile-muted">${escapeHtml(extra)}</div>` : ''}</div>`;
}

function renderAdvancedDashboard(data) {
    advancedDashboardData = data;
    const money = data?.money || {};
    const loanStats = data?.loans || {};
    const emiStats = data?.emis || {};
    const legacy = data?.legacy || {};
    const due = dueCenterData?.summary || {};

    advSetText('advancedDashboardDate', `Business date: ${data?.businessDate || '-'} • ${data?.timezone || 'Asia/Kolkata'}`);
    advSetText('advTotalLent', advMoney(money.totalLent));
    advSetText('advTotalLoans', `${Number(loanStats.total || 0)} total loans`);
    advSetText('advCollected', advMoney(money.collectedTotal));
    advSetText('advRecoveryRate', `${Number(money.recoveryRate || 0).toLocaleString('en-IN')}% scheduled recovery`);
    advSetText('advOutstanding', advMoney(money.outstandingTotal));
    advSetText('advOverdue', advMoney(money.overdueAmount));
    advSetText('advOverdueEmis', `${Number(emiStats.overdue || 0)} overdue EMI`);
    advSetText('advTodayCollected', advMoney(money.todayCollected));
    advSetText('advTodayDue', `${advMoney(due?.today?.amount || 0)} due today`);
    advSetText('advMonthCollected', advMoney(money.monthCollected));
    advSetText('advMonthDue', `${advMoney(due?.month?.amount || 0)} due this month`);
    advSetText('advActivePrincipal', `${advMoney(money.activePrincipal)} active principal`);
    advSetText('advLegacyEmis', `${Number(legacy.yearNotSetCount || 0)} year-not-set EMI`);

    const loanBars = document.getElementById('advLoanStatusBars');
    if (loanBars) loanBars.innerHTML = advStatusBars([
        { kind:'active', label:'Active', count:loanStats.active },
        { kind:'closed', label:'Closed', count:loanStats.closed },
        { kind:'defaulted', label:'Defaulted', count:loanStats.defaulted }
    ], loanStats.total);

    const emiBars = document.getElementById('advEmiStatusBars');
    if (emiBars) emiBars.innerHTML = advStatusBars([
        { kind:'pending', label:'Pending', count:emiStats.pending },
        { kind:'partial', label:'Partial', count:emiStats.partial },
        { kind:'paid', label:'Paid', count:emiStats.paid },
        { kind:'overdue', label:'Overdue', count:emiStats.overdue }
    ], emiStats.total);

    const trend = Array.isArray(data?.collectionTrend) ? data.collectionTrend : [];
    const maxTrend = Math.max(...trend.map(x => Number(x.amount) || 0), 1);
    const trendBox = document.getElementById('advCollectionTrend');
    if (trendBox) {
        trendBox.innerHTML = trend.map(item => {
            const amount = Math.max(0, Number(item.amount) || 0);
            const height = amount > 0 ? Math.max(5, Math.round((amount / maxTrend) * 100)) : 2;
            return `<div class="adv-trend-col">
                <div class="adv-trend-value">${escapeHtml(advMoney(amount))}</div>
                <div class="adv-trend-bar-wrap"><div class="adv-trend-bar" style="height:${height}%"></div></div>
                <div class="adv-trend-label">${escapeHtml(item.label || '')}</div>
            </div>`;
        }).join('') || '<div class="profile-muted">Collection history abhi available nahi hai.</div>';
    }

    const dueBox = document.getElementById('advDueSnapshot');
    if (dueBox) dueBox.innerHTML = [
        advMiniTile('Overdue', advMoney(due?.overdue?.amount || 0), `${Number(due?.overdue?.count || 0)} EMI`),
        advMiniTile('Today', advMoney(due?.today?.amount || 0), `${Number(due?.today?.count || 0)} EMI`),
        advMiniTile('Tomorrow', advMoney(due?.tomorrow?.amount || 0), `${Number(due?.tomorrow?.count || 0)} EMI`),
        advMiniTile('Next 7 Days', advMoney(due?.next7?.amount || 0), `${Number(due?.next7?.count || 0)} EMI`)
    ].join('');

    const movementBox = document.getElementById('advMonthlyMovement');
    if (movementBox) movementBox.innerHTML = [
        advMiniTile('Lent This Month', advMoney(money.thisMonthLent)),
        advMiniTile('Collected This Month', advMoney(money.monthCollected)),
        advMiniTile('Scheduled EMI Total', advMoney(money.scheduledTotal)),
        advMiniTile('Year Not Set', advMoney(legacy.yearNotSetAmount || 0), `${Number(legacy.yearNotSetCount || 0)} EMI`)
    ].join('');
}

async function refreshAdvancedDashboard() {
    const loading = document.getElementById('advancedDashboardLoading');
    const content = document.getElementById('advancedDashboardContent');
    if (loading) {
        loading.style.display = 'block';
        loading.textContent = 'Dashboard calculate ho raha hai...';
    }
    if (content) content.style.display = 'none';

    try {
        const [dashboardRes, dueData] = await Promise.all([
            adminFetch('/api/dashboard'),
            refreshDueData()
        ]);
        const data = await dashboardRes.json();
        dueCenterData = dueData;
        renderAdvancedDashboard(data);
        updateDashboard();
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = 'block';
    } catch (err) {
        console.error('Advanced dashboard failed:', err);
        if (loading) {
            loading.style.display = 'block';
            loading.textContent = `Dashboard load nahi hua: ${err.message}`;
        }
    }
}



// ==========================================
// PHASE 9 - COLLECTION CALENDAR
// ==========================================
function calendarMoney(value) {
    return `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
}

function calendarBusinessDate() {
    if (collectionCalendarData?.businessDate) return collectionCalendarData.businessDate;
    if (dueCenterData?.businessDate) return dueCenterData.businessDate;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function calendarMonthTitle(monthKey) {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return 'Month';
    const [year, month] = monthKey.split('-').map(Number);
    return new Intl.DateTimeFormat('en-IN', { month:'long', year:'numeric', timeZone:'UTC' })
        .format(new Date(Date.UTC(year, month - 1, 1)));
}

function shiftMonthKey(monthKey, offset) {
    const [year, month] = String(monthKey).split('-').map(Number);
    const d = new Date(Date.UTC(year, (month - 1) + Number(offset || 0), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2,'0')}`;
}

function openCollectionCalendar(month = '') {
    const modal = document.getElementById('collectionCalendarModal');
    if (!modal) return;
    calendarMonthKey = /^\d{4}-\d{2}$/.test(month) ? month : calendarBusinessDate().slice(0, 7);
    calendarSelectedDate = null;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    refreshCollectionCalendar();
}

function closeCollectionCalendar() {
    const modal = document.getElementById('collectionCalendarModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleCalendarOverlayClick(event) {
    if (event?.target?.id === 'collectionCalendarModal') closeCollectionCalendar();
}

function shiftCalendarMonth(offset) {
    calendarMonthKey = shiftMonthKey(calendarMonthKey || calendarBusinessDate().slice(0,7), offset);
    calendarSelectedDate = null;
    refreshCollectionCalendar();
}

function goCalendarToday() {
    calendarMonthKey = calendarBusinessDate().slice(0,7);
    calendarSelectedDate = calendarBusinessDate();
    refreshCollectionCalendar();
}

function calendarStatusMeta(status) {
    const map = {
        paid: ['✅','Paid'],
        partial: ['🟠','Partial'],
        overdue: ['🔴','Overdue'],
        'partial-overdue': ['🔴','Partial • Overdue'],
        pending: ['⏳','Pending']
    };
    return map[status] || map.pending;
}

function renderCollectionCalendar() {
    const data = collectionCalendarData || {};
    const summary = data.summary || {};
    const days = data.days || {};
    const monthKey = data.month || calendarMonthKey;
    calendarMonthKey = monthKey;

    const label = document.getElementById('calendarMonthLabel');
    if (label) label.textContent = calendarMonthTitle(monthKey);
    const bd = document.getElementById('calendarBusinessDate');
    if (bd) bd.textContent = `Business date: ${data.businessDate || '-'} • ${data.timezone || 'Asia/Kolkata'} • Month label par tap = Today`;
    const set = (id, value) => { const el=document.getElementById(id); if (el) el.textContent=value; };
    set('calendarScheduled', calendarMoney(summary.scheduled));
    set('calendarCollected', calendarMoney(summary.collected));
    set('calendarRemaining', calendarMoney(summary.remaining));
    set('calendarOverdue', calendarMoney(summary.overdueRemaining));
    set('calendarDueCount', `${Number(summary.dueCount || 0)} EMI`);
    set('calendarPaymentCount', `${Number(summary.paymentCount || 0)} payments`);
    set('calendarLegacyCount', `${Number(summary.yearNotSetCount || 0)} year-not-set • ${calendarMoney(summary.yearNotSetAmount || 0)}`);

    const grid = document.getElementById('calendarGrid');
    if (!grid) return;
    const [year, month] = monthKey.split('-').map(Number);
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
    let html = '';
    for (let i=0; i<firstWeekday; i++) html += '<div class="calendar-cell calendar-cell-empty" aria-hidden="true"></div>';
    for (let dayNo=1; dayNo<=dayCount; dayNo++) {
        const iso = `${monthKey}-${String(dayNo).padStart(2,'0')}`;
        const day = days[iso] || { totals:{} };
        const t = day.totals || {};
        const hasDue = Number(t.dueCount || 0) > 0;
        const hasPayment = Number(t.paymentCount || 0) > 0;
        const hasOverdue = Number(t.overdueRemaining || 0) > 0;
        const classes = [
            'calendar-cell',
            iso === data.businessDate ? 'today' : '',
            iso === calendarSelectedDate ? 'selected' : '',
            hasDue ? 'has-due' : '',
            hasPayment ? 'has-payment' : '',
            hasOverdue ? 'has-overdue' : ''
        ].filter(Boolean).join(' ');
        html += `<button class="${classes}" onclick="selectCalendarDate('${iso}')">
            <span class="calendar-day-number">${dayNo}</span>
            <span class="calendar-cell-lines">
                ${hasDue ? `<small class="calendar-due-line">${Number(t.remaining || 0) > 0 ? `Due ${calendarMoney(t.remaining || 0)}` : 'EMI settled'}</small>` : ''}
                ${hasPayment ? `<small class="calendar-paid-line">Paid ${calendarMoney(t.collected || 0)}</small>` : ''}
                ${hasOverdue ? `<small class="calendar-overdue-line">Overdue ${calendarMoney(t.overdueRemaining || 0)}</small>` : ''}
            </span>
        </button>`;
    }
    grid.innerHTML = html;

    if (calendarSelectedDate && calendarSelectedDate.startsWith(monthKey)) {
        renderCalendarDayDetails(calendarSelectedDate);
    } else {
        const details = document.getElementById('calendarDayDetails');
        if (details) details.innerHTML = '<div class="profile-muted">Calendar me kisi date par tap karein.</div>';
        set('calendarSelectedDate', 'Select a date');
        set('calendarSelectedSummary', 'Day-wise EMI and collection details');
    }
}

function selectCalendarDate(date) {
    calendarSelectedDate = date || null;
    renderCollectionCalendar();
}

function renderCalendarDayDetails(date) {
    const day = collectionCalendarData?.days?.[date] || { due:[], payments:[], totals:{} };
    const due = day.due || [];
    const payments = day.payments || [];
    const t = day.totals || {};
    const title = document.getElementById('calendarSelectedDate');
    if (title) title.textContent = phase6Date(date);
    const summary = document.getElementById('calendarSelectedSummary');
    if (summary) summary.textContent = `${Number(t.dueCount || 0)} EMI • ${calendarMoney(t.remaining || 0)} remaining • ${calendarMoney(t.collected || 0)} collected`;
    const details = document.getElementById('calendarDayDetails');
    if (!details) return;

    let html = '';
    if (due.length) {
        html += '<div class="calendar-detail-section"><h5>📅 EMI Due</h5>';
        html += due.map(item => {
            const [icon, state] = calendarStatusMeta(item.status);
            const canPay = Number(item.remaining || 0) > 0 && item.loan_status !== 'closed';
            return `<div class="calendar-detail-row ${String(item.status || '').includes('overdue') ? 'overdue' : ''}">
                <div class="calendar-detail-main">
                    <strong>${icon} ${escapeHtml(item.borrower_name || 'Unknown')} • EMI ${Number(item.installment_number || 0)}</strong>
                    <small>${escapeHtml(item.loan_code || '')} • Scheduled ${calendarMoney(item.amount)} • Paid ${calendarMoney(item.paid_amount)} • Remaining ${calendarMoney(item.remaining)} • ${escapeHtml(state)}</small>
                </div>
                <div class="calendar-detail-actions">
                    ${item.borrower_id ? `<button class="btn btn-view" onclick="calendarOpenBorrower('${item.borrower_id}')">👤</button>` : ''}
                    ${canPay ? `<button class="btn btn-success" onclick="calendarOpenPayment('${item.emi_id}')">💰 Pay</button>` : `<button class="btn btn-secondary" onclick="calendarOpenPayment('${item.emi_id}')">🧾 History</button>`}
                    ${item.borrower_id ? `<button class="btn btn-success" onclick="calendarOpenWhatsApp('${item.borrower_id}','${item.loan_id}','${item.emi_id}','${String(item.status || '').includes('overdue') ? 'overdue' : 'due'}')">💬</button>` : ''}
                </div>
            </div>`;
        }).join('');
        html += '</div>';
    }

    if (payments.length) {
        html += '<div class="calendar-detail-section"><h5>💵 Payments Collected</h5>';
        html += payments.map(item => `<div class="calendar-detail-row paid">
            <div class="calendar-detail-main">
                <strong>✅ ${escapeHtml(item.borrower_name || 'Unknown')} • ${calendarMoney(item.amount)}</strong>
                <small>${escapeHtml(item.loan_code || '')}${item.installment_number ? ` • EMI ${Number(item.installment_number)}` : ''} • ${escapeHtml(item.method || 'Method not set')}${item.source === 'baseline' ? ' • Opening balance' : ''}</small>
            </div>
            <div class="calendar-detail-actions">
                ${item.borrower_id ? `<button class="btn btn-view" onclick="calendarOpenBorrower('${item.borrower_id}')">👤</button>` : ''}
                ${item.emi_id ? `<button class="btn btn-secondary" onclick="calendarOpenPayment('${item.emi_id}')">🧾 History</button>` : ''}
            </div>
        </div>`).join('');
        html += '</div>';
    }

    if (!html) html = '<div class="profile-muted">Is date par koi EMI due ya payment entry nahi hai.</div>';
    details.innerHTML = html;
}

function calendarOpenPayment(emiId) {
    closeCollectionCalendar();
    openPaymentModal(emiId);
}

function calendarOpenBorrower(borrowerId) {
    closeCollectionCalendar();
    openBorrowerProfile(borrowerId);
}

function calendarOpenWhatsApp(borrowerId, loanId, emiId, template) {
    closeCollectionCalendar();
    openWhatsAppCenter({ borrowerId, loanId, emiId, template });
}

async function refreshCollectionCalendar() {
    const loading = document.getElementById('calendarLoading');
    const content = document.getElementById('calendarContent');
    if (!calendarMonthKey) calendarMonthKey = calendarBusinessDate().slice(0,7);
    if (loading) { loading.style.display='block'; loading.textContent='Calendar load ho raha hai...'; }
    if (content) content.style.display='none';
    try {
        const response = await adminFetch(`/api/dashboard?mode=calendar&month=${encodeURIComponent(calendarMonthKey)}`);
        collectionCalendarData = await response.json();
        if (!calendarSelectedDate && collectionCalendarData.month === collectionCalendarData.businessDate?.slice(0,7)) {
            calendarSelectedDate = collectionCalendarData.businessDate;
        }
        renderCollectionCalendar();
        if (loading) loading.style.display='none';
        if (content) content.style.display='block';
    } catch (err) {
        console.error('Collection calendar failed:', err);
        if (loading) { loading.style.display='block'; loading.textContent=`Calendar load nahi hua: ${err.message}`; }
    }
}


// ==========================================
// PHASE 10 - ADVANCED SEARCH & FILTERS
// ==========================================
let advancedSearchData = null;

function openAdvancedSearch(preset = {}) {
    const modal = document.getElementById('advancedSearchModal');
    if (!modal) return;
    const basicQuery = String(document.getElementById('searchInput')?.value || '').trim();
    if (preset.query !== undefined) document.getElementById('advancedSearchQuery').value = String(preset.query || '');
    else if (!document.getElementById('advancedSearchQuery').value && basicQuery) document.getElementById('advancedSearchQuery').value = basicQuery;
    if (preset.type) document.getElementById('advancedSearchType').value = preset.type;
    if (preset.loanStatus) document.getElementById('advancedSearchLoanStatus').value = preset.loanStatus;
    if (preset.emiStatus) document.getElementById('advancedSearchEmiStatus').value = preset.emiStatus;
    if (preset.due) document.getElementById('advancedSearchDue').value = preset.due;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('advancedSearchQuery')?.focus(), 50);
    runAdvancedSearch();
}

function closeAdvancedSearch() {
    const modal = document.getElementById('advancedSearchModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleAdvancedSearchOverlayClick(event) {
    if (event?.target?.id === 'advancedSearchModal') closeAdvancedSearch();
}

function handleAdvancedSearchKey(event) {
    if (event?.key === 'Enter') {
        event.preventDefault();
        runAdvancedSearch();
    }
}

function resetAdvancedSearch() {
    const values = {
        advancedSearchQuery: '', advancedSearchType: 'all', advancedSearchLoanStatus: 'all',
        advancedSearchEmiStatus: 'all', advancedSearchDue: 'all', advancedSearchMinAmount: '',
        advancedSearchMaxAmount: '', advancedSearchSort: 'name'
    };
    for (const [id, value] of Object.entries(values)) {
        const node = document.getElementById(id);
        if (node) node.value = value;
    }
    runAdvancedSearch();
}

function advancedSearchParams() {
    const params = new URLSearchParams();
    const map = {
        q: 'advancedSearchQuery', type: 'advancedSearchType', loanStatus: 'advancedSearchLoanStatus',
        emiStatus: 'advancedSearchEmiStatus', due: 'advancedSearchDue', minAmount: 'advancedSearchMinAmount',
        maxAmount: 'advancedSearchMaxAmount', sort: 'advancedSearchSort'
    };
    for (const [key, id] of Object.entries(map)) {
        const value = String(document.getElementById(id)?.value ?? '').trim();
        if (value !== '') params.set(key, value);
    }
    params.set('limit', '200');
    return params;
}

function advancedSearchStatusMeta(status) {
    const map = {
        active: ['🟢','Active','success'], closed: ['✅','Closed','success'], defaulted: ['🔴','Defaulted','danger'],
        pending: ['⏳','Pending','warning'], partial: ['🟠','Partial','warning'], paid: ['✅','Paid','success'], overdue: ['🔴','Overdue','danger']
    };
    return map[status] || ['•', String(status || 'Unknown'), 'neutral'];
}

function advancedSearchAvatar(name) {
    return String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]?.toUpperCase() || '').join('') || '?';
}

function renderAdvancedSearchResult(item) {
    if (item.type === 'borrower') {
        const initials = advancedSearchAvatar(item.name);
        return `<article class="search-pro-result borrower">
            <div class="search-pro-result-icon">${item.photo_url ? `<img src="${escapeHtml(item.photo_url)}" alt="">` : escapeHtml(initials)}</div>
            <div class="search-pro-result-main">
                <div class="search-pro-result-top"><span class="search-pro-type">👤 Borrower</span><strong>${escapeHtml(item.name || 'Unknown')}</strong></div>
                <div class="search-pro-result-meta">${item.phone ? `📞 ${escapeHtml(item.phone)} • ` : ''}${Number(item.total_loans || 0)} loans • ${Number(item.active_loans || 0)} active • ${Number(item.overdue_emis || 0)} overdue EMI</div>
                <div class="search-pro-money"><span>Principal <b>${phase6Money(item.principal)}</b></span><span>Collected <b>${phase6Money(item.collected)}</b></span><span>Remaining <b>${phase6Money(item.remaining)}</b></span></div>
            </div>
            <div class="search-pro-actions">
                <button class="btn btn-view" onclick="advancedSearchOpenBorrower('${item.borrower_id}')">👤 Profile</button>
                <button class="btn btn-success" onclick="advancedSearchOpenWhatsApp('${item.borrower_id}')">💬 WhatsApp</button>
            </div>
        </article>`;
    }

    if (item.type === 'loan') {
        const [icon, label, tone] = advancedSearchStatusMeta(item.status);
        return `<article class="search-pro-result loan">
            <div class="search-pro-result-icon">💳</div>
            <div class="search-pro-result-main">
                <div class="search-pro-result-top"><span class="search-pro-type">Loan</span><strong>${escapeHtml(item.loan_code || 'Loan')}</strong><span class="search-pro-status ${tone}">${icon} ${escapeHtml(label)}</span></div>
                <div class="search-pro-result-meta">${escapeHtml(item.borrower_name || 'Unknown')} • ${item.loan_date ? phase6Date(item.loan_date) : (item.loan_year ? String(item.loan_year) : 'Year not set')} • ${Number(item.emi_count || 0)} EMI • ${Number(item.year_not_set || 0)} year-not-set</div>
                <div class="search-pro-money"><span>Principal <b>${phase6Money(item.amount)}</b></span><span>Collected <b>${phase6Money(item.collected)}</b></span><span>Remaining <b>${phase6Money(item.remaining)}</b></span></div>
            </div>
            <div class="search-pro-actions">
                <button class="btn btn-view" onclick="advancedSearchOpenBorrower('${item.borrower_id}')">👤</button>
                <button class="btn btn-warning" onclick="advancedSearchEditLoan('${item.loan_id}')">✏️ Edit</button>
                <button class="btn btn-secondary" onclick="advancedSearchLoanStatement('${item.loan_id}')">🧾 Statement</button>
                <button class="btn btn-view" onclick="advancedSearchOpenSettlement('${item.loan_id}')">${item.status === 'closed' ? '🔒' : '🤝'}</button>
                <button class="btn btn-success" onclick="advancedSearchOpenWhatsApp('${item.borrower_id}','${item.loan_id}')">💬</button>
            </div>
        </article>`;
    }

    const [icon, label, tone] = advancedSearchStatusMeta(item.status);
    const dueText = item.year_not_set ? `${Number(item.due_day || 0)} ${escapeHtml(item.due_month || '')} • Year not set` : phase6Date(item.due_date);
    return `<article class="search-pro-result emi">
        <div class="search-pro-result-icon">📅</div>
        <div class="search-pro-result-main">
            <div class="search-pro-result-top"><span class="search-pro-type">EMI ${Number(item.installment_number || 0)}</span><strong>${escapeHtml(item.borrower_name || 'Unknown')}</strong><span class="search-pro-status ${tone}">${icon} ${escapeHtml(label)}</span></div>
            <div class="search-pro-result-meta">${escapeHtml(item.loan_code || '')} • Due ${dueText} • Loan ${escapeHtml(item.loan_status || '')}</div>
            <div class="search-pro-money"><span>Scheduled <b>${phase6Money(item.amount)}</b></span><span>Paid <b>${phase6Money(item.paid_amount)}</b></span><span>Remaining <b>${phase6Money(item.remaining)}</b></span></div>
        </div>
        <div class="search-pro-actions">
            <button class="btn btn-view" onclick="advancedSearchOpenBorrower('${item.borrower_id}')">👤</button>
            <button class="btn ${Number(item.remaining || 0) > 0 ? 'btn-success' : 'btn-secondary'}" onclick="advancedSearchOpenPayment('${item.emi_id}')">${Number(item.remaining || 0) > 0 ? '💰 Pay' : '🧾 History'}</button>
            <button class="btn btn-success" onclick="advancedSearchOpenWhatsApp('${item.borrower_id}','${item.loan_id}','${item.emi_id}','${item.status === 'overdue' ? 'overdue' : 'due'}')">💬</button>
        </div>
    </article>`;
}

function renderAdvancedSearch(data) {
    const summary = data?.summary || {};
    const meta = document.getElementById('advancedSearchMeta');
    if (meta) meta.textContent = `Business date: ${data?.businessDate || '-'} • ${data?.timezone || 'Asia/Kolkata'}`;
    const summaryEl = document.getElementById('advancedSearchSummary');
    if (summaryEl) {
        const limitedNote = Number(summary.shown || 0) < Number(summary.total || 0) ? ` • first ${Number(summary.shown || 0)} shown` : '';
        summaryEl.innerHTML = `<strong>${Number(summary.total || 0)} results</strong>${limitedNote}<span>👤 ${Number(summary.borrower || 0)} borrowers</span><span>💳 ${Number(summary.loan || 0)} loans</span><span>📅 ${Number(summary.emi || 0)} EMIs</span>`;
    }
    const resultsEl = document.getElementById('advancedSearchResults');
    if (!resultsEl) return;
    const rows = data?.results || [];
    resultsEl.innerHTML = rows.length
        ? rows.map(renderAdvancedSearchResult).join('')
        : '<div class="search-pro-empty">🔎 Koi matching record nahi mila. Search term ya filters reset karke try karein.</div>';
}

async function runAdvancedSearch() {
    const loading = document.getElementById('advancedSearchLoading');
    const results = document.getElementById('advancedSearchResults');
    if (loading) loading.style.display = 'block';
    if (results) results.classList.add('is-loading');
    try {
        const response = await adminFetch(`/api/dashboard?mode=search&${advancedSearchParams().toString()}`);
        advancedSearchData = await response.json();
        renderAdvancedSearch(advancedSearchData);
    } catch (err) {
        console.error('Advanced search failed:', err);
        const summary = document.getElementById('advancedSearchSummary');
        if (summary) summary.textContent = `Search failed: ${err.message}`;
        if (results) results.innerHTML = '<div class="search-pro-empty danger">Search load nahi hua.</div>';
    } finally {
        if (loading) loading.style.display = 'none';
        if (results) results.classList.remove('is-loading');
    }
}

function advancedSearchOpenBorrower(borrowerId) {
    closeAdvancedSearch();
    openBorrowerProfile(borrowerId);
}

function advancedSearchOpenPayment(emiId) {
    closeAdvancedSearch();
    openPaymentModal(emiId);
}

function advancedSearchEditLoan(loanId) {
    closeAdvancedSearch();
    editLoan(loanId);
}

function advancedSearchLoanStatement(loanId) {
    closeAdvancedSearch();
    printLoanAccountStatement(loanId);
}

function advancedSearchOpenSettlement(loanId) {
    closeAdvancedSearch();
    openSettlementCenter(loanId);
}

function advancedSearchOpenWhatsApp(borrowerId, loanId = '', emiId = '', template = '') {
    closeAdvancedSearch();
    openWhatsAppCenter({ borrowerId, loanId, emiId, template });
}



// ==========================================
// PHASE 11 — LOAN SETTLEMENT & CLOSING
// ==========================================
let currentSettlementData = null;
let currentSettlementLoanId = null;

function settlementBusinessDate() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(x => [x.type,x.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function settlementMoney(value) { return `₹${Math.max(0, Number(value)||0).toLocaleString('en-IN')}`; }

async function openSettlementCenter(loanId) {
    currentSettlementLoanId = loanId;
    const modal = document.getElementById('settlementModal');
    const loading = document.getElementById('settlementLoading');
    const content = document.getElementById('settlementContent');
    if (modal) modal.style.display = 'flex';
    if (loading) loading.style.display = 'block';
    if (content) content.style.display = 'none';
    try {
        const response = await adminFetch(`/api/settlements?loan_id=${encodeURIComponent(loanId)}`);
        currentSettlementData = await response.json();
        renderSettlementCenter(currentSettlementData);
    } catch (err) {
        if (loading) loading.textContent = err.message || 'Settlement details load nahi hui.';
    }
}

function closeSettlementCenter() {
    const modal = document.getElementById('settlementModal');
    if (modal) modal.style.display = 'none';
    currentSettlementData = null;
    currentSettlementLoanId = null;
}
function handleSettlementOverlayClick(event) { if (event.target?.id === 'settlementModal') closeSettlementCenter(); }

function renderSettlementCenter(data) {
    const loan = data?.loan || {};
    const summary = data?.summary || {};
    const active = data?.active_settlement || null;
    const history = data?.history || [];
    document.getElementById('settlementTitle').textContent = `🤝 ${loan.loan_code || 'Loan'} Settlement`;
    document.getElementById('settlementSubtitle').textContent = `${loan.borrowers?.name || 'Borrower'} • ${loan.status || 'active'}`;
    document.getElementById('settlementScheduled').textContent = settlementMoney(summary.scheduled);
    document.getElementById('settlementCollected').textContent = settlementMoney(summary.paid);
    document.getElementById('settlementRawRemaining').textContent = settlementMoney(summary.raw_remaining);
    document.getElementById('settlementAccountRemaining').textContent = settlementMoney(summary.account_remaining);
    document.getElementById('settlementLoading').style.display = 'none';
    document.getElementById('settlementContent').style.display = 'block';
    const openSection = document.getElementById('settlementOpenSection');
    const closedSection = document.getElementById('settlementClosedSection');
    if (active) {
        openSection.style.display = 'none';
        closedSection.style.display = 'block';
        document.getElementById('settlementClosedMeta').textContent = `${phase6Date(active.settlement_date)} • ${active.method || 'Method not set'}`;
        document.getElementById('settlementClosedDetails').innerHTML = [
            ['Remaining Before', settlementMoney(active.scheduled_remaining_before)],
            ['Final Payment', settlementMoney(active.final_payment_amount)],
            ['Waived / Adjusted', settlementMoney(active.waived_amount)],
            ['Account Due', settlementMoney(summary.account_remaining)]
        ].map(([a,b]) => `<div><small>${a}</small><strong>${b}</strong></div>`).join('') + (active.notes ? `<div style="grid-column:1/-1"><small>Closing Note</small><strong>${escapeHtml(active.notes)}</strong></div>` : '');
    } else {
        openSection.style.display = 'block';
        closedSection.style.display = 'none';
        document.getElementById('settlementDate').value = settlementBusinessDate();
        document.getElementById('settlementFinalPayment').value = summary.raw_remaining || 0;
        document.getElementById('settlementFinalPayment').max = summary.raw_remaining || 0;
        document.getElementById('settlementNotes').value = '';
        document.getElementById('settlementConfirmText').value = '';
        updateSettlementPreview();
    }
    document.getElementById('settlementHistory').innerHTML = history.length ? history.map(st => `<div class="settlement-history-item ${st.reopened_at ? 'reopened' : ''}"><div><strong>${st.reopened_at ? '↩️ Reopened settlement' : '🔒 Closed settlement'} • ${phase6Date(st.settlement_date)}</strong><small>Final ${settlementMoney(st.final_payment_amount)} • Waived ${settlementMoney(st.waived_amount)}${st.notes ? ' • '+escapeHtml(st.notes) : ''}</small>${st.reopened_at ? `<small>Reopened: ${escapeHtml(String(st.reopened_at).slice(0,10))}${st.reopen_note ? ' • '+escapeHtml(st.reopen_note) : ''}</small>` : ''}</div><strong>${st.reopened_at ? 'History' : 'Active'}</strong></div>`).join('') : '<div class="profile-muted">Abhi koi settlement history nahi hai.</div>';
}

function updateSettlementPreview() {
    const raw = Math.max(0, Number(currentSettlementData?.summary?.raw_remaining) || 0);
    const input = document.getElementById('settlementFinalPayment');
    let finalAmount = Math.max(0, Number(input?.value) || 0);
    if (finalAmount > raw) finalAmount = raw;
    if (input && Number(input.value) > raw) input.value = raw;
    const waived = Math.max(raw-finalAmount,0);
    document.getElementById('settlementPreviewPayment').textContent = settlementMoney(finalAmount);
    document.getElementById('settlementPreviewWaived').textContent = settlementMoney(waived);
}

async function submitLoanSettlement() {
    const raw = Math.max(0, Number(currentSettlementData?.summary?.raw_remaining) || 0);
    const finalAmount = Math.max(0, Number(document.getElementById('settlementFinalPayment')?.value) || 0);
    const confirmText = String(document.getElementById('settlementConfirmText')?.value || '').trim().toUpperCase();
    if (finalAmount > raw) return alert('Final payment remaining amount se zyada nahi ho sakta.');
    if (confirmText !== 'SETTLE') return alert('Confirm field me SETTLE type karein.');
    const waived = Math.max(raw-finalAmount,0);
    if (!confirm(`Loan close hoga. Final payment ${settlementMoney(finalAmount)} aur waiver/adjustment ${settlementMoney(waived)} record hoga. Continue?`)) return;
    const btn = document.getElementById('settlementSubmitBtn');
    if (btn) btn.disabled = true;
    try {
        await adminFetch('/api/settlements?action=settle', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
            loan_id: currentSettlementLoanId,
            final_payment_amount: finalAmount,
            settlement_date: document.getElementById('settlementDate')?.value,
            method: document.getElementById('settlementMethod')?.value,
            notes: document.getElementById('settlementNotes')?.value,
            confirm:'SETTLE'
        })});
        await loadAllData();
        await openSettlementCenter(currentSettlementLoanId);
        if (currentProfileData?.borrower?.id) await openBorrowerProfile(currentProfileData.borrower.id);
        if (currentOpenFolder) openFolder(currentOpenFolder);
    } catch (err) { alert(err.message || 'Loan settlement nahi hua.'); }
    finally { if (btn) btn.disabled = false; }
}

async function reopenLoanSettlement() {
    const active = currentSettlementData?.active_settlement;
    if (!active?.id) return;
    const note = String(document.getElementById('settlementReopenNote')?.value || '').trim();
    const confirmText = String(document.getElementById('settlementReopenConfirm')?.value || '').trim().toUpperCase();
    if (note.length < 3) return alert('Reopen reason likhna zaruri hai.');
    if (confirmText !== 'REOPEN') return alert('Confirm field me REOPEN type karein.');
    if (!confirm('Settlement reopen karne par closing settlement payments reverse honge aur loan Active ho jayega. Continue?')) return;
    try {
        await adminFetch('/api/settlements?action=reopen', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ settlement_id:active.id,reopen_note:note,confirm:'REOPEN' }) });
        await loadAllData();
        await openSettlementCenter(currentSettlementLoanId);
        if (currentProfileData?.borrower?.id) await openBorrowerProfile(currentProfileData.borrower.id);
        if (currentOpenFolder) openFolder(currentOpenFolder);
    } catch (err) { alert(err.message || 'Loan reopen nahi hua.'); }
}

function printSettlementCertificate() {
    const data = currentSettlementData;
    const loan = data?.loan || {};
    const st = data?.active_settlement;
    if (!st) return alert('Active settlement record nahi mila.');
    const b = loan.borrowers || {};
    const ref = `SET-${String(st.id || '').replaceAll('-','').slice(0,10).toUpperCase()}`;
    phase6PrintDocument(`${loan.loan_code || 'Loan'} Closing Receipt`, `
        <div class="brand"><div><h1>Abhishek Management</h1><p>Loan Settlement & Closing Record</p></div><div class="doc-title"><strong>Loan Closing Receipt</strong><small class="receipt-id">${escapeHtml(ref)}</small></div></div>
        <div class="party"><div class="box"><small>Borrower</small><strong>${escapeHtml(b.name || 'Unknown')}</strong></div><div class="box"><small>Loan ID</small><strong>${escapeHtml(loan.loan_code || '')}</strong></div><div class="box"><small>Closing Date</small><strong>${phase6Date(st.settlement_date)}</strong></div><div class="box"><small>Method</small><strong>${escapeHtml(st.method || 'Not set')}</strong></div></div>
        <div class="summary"><div class="metric"><small>Remaining Before</small><strong>${phase6Money(st.scheduled_remaining_before)}</strong></div><div class="metric"><small>Final Payment</small><strong>${phase6Money(st.final_payment_amount)}</strong></div><div class="metric"><small>Waived / Adjusted</small><strong>${phase6Money(st.waived_amount)}</strong></div><div class="metric"><small>Account Remaining</small><strong>₹0</strong></div></div>
        ${st.notes ? `<h2>Settlement Note</h2><div class="box">${escapeHtml(st.notes)}</div>` : ''}
        <p class="note">This receipt records the settlement/closing entry stored in AbhiTools. Reopening this settlement reverses settlement-generated closing payment entries and restores the loan to Active status while retaining this audit record.</p>`);
}


// ==========================================
// PHASE 17 - NOTIFICATION & REMINDER CENTER
// ==========================================
function reminderMoney(value) {
    return `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
}

function reminderDate(value) {
    if (!value) return '-';
    const d = new Date(`${String(value).slice(0,10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? String(value).slice(0,10) : d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
}

function reminderContactTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
}

function reminderSetText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function updateReminderAlertButton() {
    const btn = document.getElementById('reminderBrowserAlertBtn');
    if (!btn) return;
    const enabled = localStorage.getItem('abhi_reminder_browser_alerts') === 'yes' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
    btn.textContent = enabled ? '🔔 Browser Alerts On' : '🔕 Browser Alerts';
    btn.classList.toggle('btn-success', enabled);
    btn.classList.toggle('btn-secondary', !enabled);
}

function updateReminderHomeState(data) {
    const summary = data?.summary || {};
    const count = Number(summary.uncontactedToday || 0);
    const badge = document.getElementById('reminderActionBadge');
    if (badge) {
        badge.textContent = String(count);
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
    const btn = document.getElementById('reminderCenterBtn');
    if (btn) btn.title = count > 0 ? `${count} reminder action pending` : 'Reminder queue clear';
}

async function maybeShowReminderBrowserAlert(data, force = false) {
    if (localStorage.getItem('abhi_reminder_browser_alerts') !== 'yes') return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const summary = data?.summary || {};
    const urgent = (data?.items || []).filter(x => !x.contacted_today && (x.bucket === 'overdue' || x.bucket === 'today'));
    if (!urgent.length) return;
    const today = data?.businessDate || '';
    const fingerprint = `${today}:${urgent.length}:${urgent.reduce((a,x)=>a+Number(x.remaining||0),0)}`;
    if (!force && localStorage.getItem('abhi_reminder_last_alert') === fingerprint) return;
    try {
        const registration = await navigator.serviceWorker?.ready;
        if (!registration) return;
        await registration.showNotification('AbhiTools • Collection Reminder', {
            body: `${urgent.length} urgent EMI • ${reminderMoney(urgent.reduce((a,x)=>a+Number(x.remaining||0),0))} follow-up pending`,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: `abhi-reminders-${today}`,
            renotify: false,
            data: { url: '/admin.html' }
        });
        localStorage.setItem('abhi_reminder_last_alert', fingerprint);
    } catch (err) {
        console.warn('Browser reminder notification failed:', err);
    }
}

async function enableReminderBrowserAlerts() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        alert('Is browser/device me notification support available nahi hai.');
        return;
    }
    if (Notification.permission === 'denied') {
        alert('Browser notification permission blocked hai. Browser/site settings se allow karna hoga.');
        return;
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission === 'granted') {
        localStorage.setItem('abhi_reminder_browser_alerts', 'yes');
        updateReminderAlertButton();
        if (reminderCenterData) await maybeShowReminderBrowserAlert(reminderCenterData, true);
        alert('✅ Browser alerts enabled. App open/refresh hone par urgent reminder summary dikh sakti hai.');
    } else {
        localStorage.removeItem('abhi_reminder_browser_alerts');
        updateReminderAlertButton();
    }
}

async function openReminderCenter(initialBucket = 'all') {
    const modal = document.getElementById('reminderCenterModal');
    if (!modal) return;
    reminderBucket = initialBucket || 'all';
    const search = document.getElementById('reminderSearch');
    if (search) search.value = '';
    const hide = document.getElementById('reminderHideContacted');
    if (hide) hide.checked = reminderBucket !== 'contacted';
    document.querySelectorAll('#reminderBuckets .reminder-bucket').forEach(btn => btn.classList.toggle('active', btn.dataset.bucket === reminderBucket));
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    updateReminderAlertButton();
    return refreshReminderCenter();
}

function closeReminderCenter() {
    const modal = document.getElementById('reminderCenterModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleReminderOverlayClick(event) {
    if (event?.target?.id === 'reminderCenterModal') closeReminderCenter();
}

function setReminderBucket(bucket, button = null) {
    reminderBucket = bucket || 'all';
    document.querySelectorAll('#reminderBuckets .reminder-bucket').forEach(btn => btn.classList.toggle('active', btn.dataset.bucket === reminderBucket));
    if (button?.classList?.contains('reminder-bucket')) button.classList.add('active');
    if (reminderBucket === 'contacted') {
        const hide = document.getElementById('reminderHideContacted');
        if (hide) hide.checked = false;
    }
    renderReminderList();
}

function reminderDueText(item) {
    if (item.bucket === 'overdue') return `${Number(item.days_from_due || 0)} day late`;
    if (item.bucket === 'today') return 'Due today';
    if (item.bucket === 'tomorrow') return 'Due tomorrow';
    const days = Math.abs(Number(item.days_from_due || 0));
    return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

function reminderPriorityMeta(item) {
    if (item.bucket === 'overdue') return ['critical','🔴 Overdue'];
    if (item.bucket === 'today') return ['high','🟠 Today'];
    if (item.bucket === 'tomorrow') return ['medium','🟡 Tomorrow'];
    return [item.partial ? 'medium' : 'normal', item.partial ? '🌓 Partial' : '🟢 Upcoming'];
}

function reminderFilteredItems() {
    let rows = Array.isArray(reminderCenterData?.items) ? [...reminderCenterData.items] : [];
    const q = String(document.getElementById('reminderSearch')?.value || '').trim().toLowerCase();
    const hideContacted = Boolean(document.getElementById('reminderHideContacted')?.checked);
    if (reminderBucket === 'overdue' || reminderBucket === 'today' || reminderBucket === 'tomorrow') rows = rows.filter(x => x.bucket === reminderBucket);
    else if (reminderBucket === 'next7') rows = rows.filter(x => x.bucket !== 'overdue');
    else if (reminderBucket === 'partial') rows = rows.filter(x => x.partial);
    else if (reminderBucket === 'uncontacted') rows = rows.filter(x => !x.contacted_today);
    else if (reminderBucket === 'contacted') rows = rows.filter(x => x.contacted_today);
    if (hideContacted && reminderBucket !== 'contacted') rows = rows.filter(x => !x.contacted_today);
    if (q) rows = rows.filter(x => [x.borrower_name,x.loan_code,x.installment_number,x.phone,x.whatsapp].map(v => String(v ?? '').toLowerCase()).join(' ').includes(q));
    return rows;
}

function renderReminderItem(item) {
    const [tone, label] = reminderPriorityMeta(item);
    const phone = String(item.whatsapp || item.phone || '').replace(/[^0-9+]/g, '');
    const contacted = item.contacted_today ? `<span class="reminder-contacted">✅ Contacted ${escapeHtml(reminderContactTime(item.contacted_at))}${item.contacted_channel ? ` • ${escapeHtml(item.contacted_channel)}` : ''}</span>` : '';
    return `<article class="reminder-item ${tone} ${item.contacted_today ? 'is-contacted' : ''}">
        <div class="reminder-priority"><span>${escapeHtml(label)}</span><small>${escapeHtml(reminderDueText(item))}</small></div>
        <div class="reminder-main">
            <div class="reminder-title"><strong>${escapeHtml(item.borrower_name || 'Unknown')}</strong><span>EMI #${Number(item.installment_number || 0)}</span>${contacted}</div>
            <div class="reminder-meta">${escapeHtml(item.loan_code || 'Loan')} • Due ${escapeHtml(reminderDate(item.due_date))}${item.partial ? ' • Partial payment' : ''}${!item.has_contact ? ' • ⚠️ Contact missing' : ''}</div>
            <div class="reminder-money"><span>Scheduled <b>${reminderMoney(item.amount)}</b></span><span>Paid <b>${reminderMoney(item.paid_amount)}</b></span><span>Remaining <b>${reminderMoney(item.remaining)}</b></span></div>
        </div>
        <div class="reminder-actions">
            <button class="btn btn-view" onclick="reminderOpenProfile('${item.borrower_id || ''}')">👤 Profile</button>
            <button class="btn btn-success" onclick="reminderOpenPayment('${item.emi_id}')">💰 Pay</button>
            <button class="btn btn-success" ${item.has_contact ? '' : 'disabled'} onclick="reminderOpenWhatsApp('${item.emi_id}','${item.bucket}')">💬 WhatsApp</button>
            <button class="btn btn-secondary" ${phone ? '' : 'disabled'} onclick="reminderCall('${escapeHtml(phone)}')">📞 Call</button>
            <button class="btn btn-warning" ${item.contacted_today ? 'disabled' : ''} onclick="markReminderContacted('${item.emi_id}')">${item.contacted_today ? '✅ Done Today' : '✓ Mark Contacted'}</button>
        </div>
    </article>`;
}

function renderReminderList() {
    const list = document.getElementById('reminderList');
    if (!list) return;
    const rows = reminderFilteredItems();
    list.innerHTML = rows.length ? rows.map(renderReminderItem).join('') : `<div class="reminder-empty">✅ Is filter me koi pending reminder nahi hai.</div>`;
}

function renderReminderCenter(data) {
    reminderCenterData = data;
    const s = data?.summary || {};
    reminderSetText('reminderCenterMeta', `Business date: ${data?.businessDate || '-'} • ${data?.timezone || 'Asia/Kolkata'} • Contacted status audit-log based`);
    reminderSetText('reminderActionNow', Number(s.uncontactedToday || 0));
    reminderSetText('reminderActionAmount', reminderMoney((data?.items || []).filter(x => !x.contacted_today).reduce((a,x)=>a+Number(x.remaining||0),0)));
    reminderSetText('reminderOverdueCount', Number(s.overdueCount || 0));
    reminderSetText('reminderOverdueAmount', reminderMoney(s.overdueAmount));
    reminderSetText('reminderTodayCount', Number(s.todayCount || 0));
    reminderSetText('reminderTodayAmount', reminderMoney(s.todayAmount));
    reminderSetText('reminderTomorrowCount', Number(s.tomorrowCount || 0));
    reminderSetText('reminderTomorrowAmount', reminderMoney(s.tomorrowAmount));
    reminderSetText('reminderNext7Count', Number(s.next7Count || 0));
    reminderSetText('reminderNext7Amount', reminderMoney(s.next7Amount));
    reminderSetText('reminderContactedCount', Number(s.contactedToday || 0));

    const legacy = document.getElementById('reminderLegacyNote');
    const legacyText = document.getElementById('reminderLegacyText');
    if (legacy) legacy.style.display = Number(s.yearNotSetCount || 0) > 0 ? 'flex' : 'none';
    if (legacyText) legacyText.textContent = `${Number(s.yearNotSetCount || 0)} EMI • ${reminderMoney(s.yearNotSetAmount)} remaining. Unknown year/date ko reminder engine intentionally guess nahi karta.`;
    updateReminderHomeState(data);
    updateReminderAlertButton();
    renderReminderList();
}

async function refreshReminderCenter() {
    const loading = document.getElementById('reminderLoading');
    if (loading) { loading.style.display = 'block'; loading.textContent = 'Reminder queue load ho rahi hai...'; }
    try {
        const response = await adminFetch('/api/dashboard?mode=reminders');
        const data = await response.json();
        renderReminderCenter(data);
        await maybeShowReminderBrowserAlert(data, false);
        if (loading) loading.style.display = 'none';
    } catch (err) {
        console.error('Reminder Center failed:', err);
        if (loading) { loading.style.display = 'block'; loading.textContent = `Reminder Center load nahi hua: ${err.message}`; }
    }
}

async function refreshReminderBadge(silent = true) {
    try {
        const response = await adminFetch('/api/dashboard?mode=reminders');
        const data = await response.json();
        reminderCenterData = data;
        updateReminderHomeState(data);
        updateReminderAlertButton();
        await maybeShowReminderBrowserAlert(data, false);
        return data;
    } catch (err) {
        if (!silent) throw err;
        return null;
    }
}

function reminderOpenProfile(borrowerId) {
    if (!borrowerId) return;
    closeReminderCenter();
    openBorrowerProfile(borrowerId);
}

function reminderOpenPayment(emiId) {
    closeReminderCenter();
    openPaymentModal(emiId);
}

function reminderOpenWhatsApp(emiId, bucket) {
    const item = (reminderCenterData?.items || []).find(x => x.emi_id === emiId);
    if (!item) return;
    closeReminderCenter();
    openWhatsAppCenter({ borrowerId:item.borrower_id, loanId:item.loan_id, emiId:item.emi_id, template:bucket === 'overdue' ? 'overdue' : 'due' });
}

function reminderCall(phone) {
    const safe = String(phone || '').replace(/[^0-9+]/g, '');
    if (!safe) return alert('Phone number available nahi hai.');
    window.location.href = `tel:${safe}`;
}

async function markReminderContacted(emiId) {
    if (!confirm('Is EMI reminder ko aaj Contacted mark karein? Ye Activity History me audit entry banayega.')) return;
    try {
        await adminFetch('/api/dashboard?mode=reminders', {
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            body:JSON.stringify({ action:'contacted', emi_id:emiId, channel:'manual' })
        });
        await refreshReminderCenter();
        await refreshHomeCommandCenter(true).catch(() => null);
    } catch (err) {
        alert(err.message || 'Contacted status save nahi hua.');
    }
}

function openReminderLegacySearch() {
    closeReminderCenter();
    openDataQualityCenter('dates');
}


window.onload = initApp;

// ==========================================
// PHASE 12 - RECYCLE BIN & SAFE RESTORE
// ==========================================
let recycleBinItems = [];

function recycleDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value).slice(0, 16) : d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function recycleSummaryText(item) {
    const s = item?.summary || {};
    if (item?.entity_type === 'borrower') return `${Number(s.loans || 0)} loans • ${Number(s.documents || 0)} documents`;
    if (item?.entity_type === 'loan') return `${Number(s.emis || 0)} EMIs • ${Number(s.documents || 0)} documents`;
    if (item?.entity_type === 'document') return `${String(s.doc_type || 'document').toUpperCase()}`;
    return '';
}

async function openRecycleBin() {
    const modal = document.getElementById('recycleBinModal');
    if (!modal) return;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    await loadRecycleBin();
}

function closeRecycleBin() {
    const modal = document.getElementById('recycleBinModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleRecycleOverlayClick(event) {
    if (event.target?.id === 'recycleBinModal') closeRecycleBin();
}

async function loadRecycleBin() {
    const loading = document.getElementById('recycleBinLoading');
    const list = document.getElementById('recycleBinList');
    const summary = document.getElementById('recycleBinSummary');
    if (loading) loading.style.display = 'block';
    if (list) list.innerHTML = '';
    try {
        const response = await adminFetch('/api/recycle?action=list');
        recycleBinItems = await response.json();
        const counts = recycleBinItems.reduce((acc, item) => { acc[item.entity_type] = (acc[item.entity_type] || 0) + 1; return acc; }, {});
        if (summary) summary.innerHTML = `<span>${recycleBinItems.length} total</span><span>👤 ${counts.borrower || 0} borrowers</span><span>💳 ${counts.loan || 0} loans</span><span>📎 ${counts.document || 0} documents</span>`;
        renderRecycleBin();
    } catch (err) {
        if (list) list.innerHTML = `<div class="recycle-empty">❌ ${escapeHtml(err.message || 'Recycle Bin load nahi hua.')}</div>`;
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderRecycleBin() {
    const list = document.getElementById('recycleBinList');
    if (!list) return;
    if (!recycleBinItems.length) {
        list.innerHTML = '<div class="recycle-empty">✅ Recycle Bin empty hai.</div>';
        return;
    }
    const icon = { borrower:'👤', loan:'💳', document:'📎' };
    list.innerHTML = recycleBinItems.map(item => `<div class="recycle-item">
        <div class="recycle-item-main">
            <small class="recycle-item-type">${icon[item.entity_type] || '♻️'} ${escapeHtml(item.entity_type || 'item')}</small>
            <strong>${escapeHtml(item.label || item.record_id || 'Deleted item')}</strong>
            <small>${escapeHtml(recycleSummaryText(item))}</small>
            <small>Moved: ${escapeHtml(recycleDate(item.deleted_at))}</small>
        </div>
        <div class="recycle-item-actions">
            <button class="btn btn-success" onclick="restoreRecycleItem('${item.id}')">↩️ Restore</button>
            <button class="btn btn-danger" onclick="purgeRecycleItem('${item.id}')">🔥 Permanent Delete</button>
        </div>
    </div>`).join('');
}

async function restoreRecycleItem(recycleId) {
    const item = recycleBinItems.find(x => x.id === recycleId);
    if (!item) return;
    if (!confirm(`Restore ${item.entity_type} “${item.label || ''}”? Same IDs/history ke saath active data me wapas aayega.`)) return;
    try {
        await adminFetch('/api/recycle?action=restore', {
            method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ recycle_id:recycleId, confirm:true })
        });
        await loadAllData();
        await loadRecycleBin();
    } catch (err) {
        alert(err.message || 'Restore nahi hua.');
    }
}

async function purgeRecycleItem(recycleId) {
    const item = recycleBinItems.find(x => x.id === recycleId);
    if (!item) return;
    if (!confirm(`PERMANENT DELETE: ${item.entity_type} “${item.label || ''}” aur uski dependent history/files permanently delete ho sakti hain. Continue?`)) return;
    const typed = prompt('Permanent delete confirm karne ke liye PURGE type karein:');
    if (String(typed || '').trim().toUpperCase() !== 'PURGE') return alert('Permanent delete cancel hua.');
    try {
        const response = await adminFetch('/api/recycle?action=purge', {
            method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ recycle_id:recycleId, confirm:'PURGE' })
        });
        const result = await response.json();
        if (result.storage_cleanup_warning) alert('Database item permanently delete ho gaya. Kuch storage cleanup entries retry/later cleanup ke liye reh sakti hain.');
        await loadAllData();
        await loadRecycleBin();
    } catch (err) {
        alert(err.message || 'Permanent delete nahi hua.');
    }
}

async function recycleCurrentBorrower() {
    const borrowerId = currentProfileBorrowerId;
    const name = currentProfileData?.borrower?.name || 'Borrower';
    if (!borrowerId) return;
    if (!confirm(`${name} ko Recycle Bin me move karna hai? Is borrower ke visible loans/documents bhi isi restore batch me temporarily hide honge.`)) return;
    try {
        await adminFetch('/api/borrowers?action=delete', {
            method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ id:borrowerId })
        });
        closeBorrowerProfile();
        await loadAllData();
        alert('Borrower Recycle Bin me move ho gaya. Restore kabhi bhi Recycle Bin se kar sakte hain.');
    } catch (err) {
        alert(err.message || 'Borrower recycle nahi hua.');
    }
}

// ==========================================
// PHASE 13 — ACTIVITY HISTORY & AUDIT TIMELINE
// ==========================================
let activityHistoryState = {
    period: '30d', page: 1, limit: 30, pages: 1, total: 0,
    actions: [], entities: [], items: []
};

function auditEsc(value) { return escapeHtml(String(value ?? '')); }
function auditMoney(value) { return '₹' + Number(value || 0).toLocaleString('en-IN'); }
function auditDateTime(value) {
    if (!value) return 'Unknown time';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });
}
function auditCategoryLabel(category) {
    return ({payment:'Payment',borrower:'Borrower',loan:'Loan',document:'Document',recycle:'Recycle',safety:'Safety',system:'System'})[category] || 'Activity';
}

async function openActivityHistory() {
    const modal = document.getElementById('activityHistoryModal');
    if (!modal) return;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    activityHistoryState.page = 1;
    await loadActivityHistory();
}

function closeActivityHistory() {
    const modal = document.getElementById('activityHistoryModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleActivityOverlayClick(event) {
    if (event.target?.id === 'activityHistoryModal') closeActivityHistory();
}

function handleActivitySearchKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        applyActivityFilters();
    }
}

function setActivityPeriod(period, button) {
    activityHistoryState.period = period;
    activityHistoryState.page = 1;
    document.querySelectorAll('.audit-period').forEach(el => el.classList.remove('active'));
    if (button) button.classList.add('active');
    document.getElementById('auditFrom').value = '';
    document.getElementById('auditTo').value = '';
    loadActivityHistory();
}

function currentActivityParams(includePage = true) {
    const params = new URLSearchParams();
    params.set('period', activityHistoryState.period || '30d');
    const q = document.getElementById('auditSearch')?.value?.trim();
    const category = document.getElementById('auditCategory')?.value || 'all';
    const action = document.getElementById('auditAction')?.value || 'all';
    const entity = document.getElementById('auditEntity')?.value || 'all';
    const from = document.getElementById('auditFrom')?.value || '';
    const to = document.getElementById('auditTo')?.value || '';
    if (q) params.set('q', q);
    params.set('category', category);
    params.set('action', action);
    params.set('entity', entity);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (includePage) {
        params.set('page', String(activityHistoryState.page || 1));
        params.set('limit', String(activityHistoryState.limit || 30));
    }
    return params;
}

function applyActivityFilters() {
    activityHistoryState.page = 1;
    loadActivityHistory();
}

function resetActivityFilters() {
    document.getElementById('auditSearch').value = '';
    document.getElementById('auditCategory').value = 'all';
    document.getElementById('auditAction').value = 'all';
    document.getElementById('auditEntity').value = 'all';
    document.getElementById('auditFrom').value = '';
    document.getElementById('auditTo').value = '';
    activityHistoryState.period = '30d';
    activityHistoryState.page = 1;
    document.querySelectorAll('.audit-period').forEach(el => el.classList.toggle('active', el.dataset.period === '30d'));
    loadActivityHistory();
}

async function refreshActivityHistory() {
    await loadActivityHistory();
}

function updateAuditSelectOptions(selectId, values, current, fallbackLabel) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const normalized = Array.isArray(values) ? values : [];
    select.innerHTML = `<option value="all">${auditEsc(fallbackLabel)}</option>` + normalized.map(v => `<option value="${auditEsc(v)}">${auditEsc(v)}</option>`).join('');
    select.value = normalized.includes(current) ? current : 'all';
}

async function loadActivityHistory() {
    const loading = document.getElementById('activityHistoryLoading');
    const timeline = document.getElementById('activityTimeline');
    const empty = document.getElementById('activityHistoryEmpty');
    if (loading) loading.style.display = 'block';
    if (timeline) timeline.innerHTML = '';
    if (empty) empty.style.display = 'none';
    try {
        const currentAction = document.getElementById('auditAction')?.value || 'all';
        const currentEntity = document.getElementById('auditEntity')?.value || 'all';
        const response = await adminFetch(`/api/dashboard?mode=activity&${currentActivityParams(true).toString()}`);
        const data = await response.json();
        activityHistoryState.items = data.items || [];
        activityHistoryState.actions = data.filters?.actions || [];
        activityHistoryState.entities = data.filters?.entities || [];
        activityHistoryState.pages = Number(data.pagination?.pages || 1);
        activityHistoryState.total = Number(data.pagination?.total || 0);
        activityHistoryState.page = Number(data.pagination?.page || 1);

        updateAuditSelectOptions('auditAction', activityHistoryState.actions, currentAction, 'All Actions');
        updateAuditSelectOptions('auditEntity', activityHistoryState.entities, currentEntity, 'All Entities');

        const summary = data.summary || {};
        document.getElementById('auditTotal').textContent = Number(summary.total || 0).toLocaleString('en-IN');
        document.getElementById('audit24h').textContent = Number(summary.last24h || 0).toLocaleString('en-IN');
        document.getElementById('audit7d').textContent = Number(summary.last7d || 0).toLocaleString('en-IN');
        document.getElementById('auditPayments').textContent = Number(summary.payments || 0).toLocaleString('en-IN');
        document.getElementById('auditSafety').textContent = Number(summary.safety || 0).toLocaleString('en-IN');
        document.getElementById('activityHistoryMeta').textContent = `${auditEsc(data.businessDate || '')} • ${auditEsc(data.timezone || 'Asia/Kolkata')} • ${Number(data.pagination?.total || 0)} filtered events`;
        document.getElementById('auditPageInfo').textContent = `Page ${activityHistoryState.page} / ${activityHistoryState.pages}`;
        document.getElementById('auditPrevBtn').disabled = activityHistoryState.page <= 1;
        document.getElementById('auditNextBtn').disabled = activityHistoryState.page >= activityHistoryState.pages;
        renderActivityTimeline(activityHistoryState.items);
    } catch (err) {
        if (timeline) timeline.innerHTML = `<div class="audit-empty">❌ ${auditEsc(err.message || 'Activity history load nahi hui.')}</div>`;
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function activityContextHtml(event) {
    const c = event.context || {};
    const chips = [];
    if (c.borrower_name) chips.push(`<span>👤 ${auditEsc(c.borrower_name)}</span>`);
    if (c.loan_code) chips.push(`<span>💳 ${auditEsc(c.loan_code)}</span>`);
    if (c.installment_number) chips.push(`<span>EMI ${auditEsc(c.installment_number)}</span>`);
    if (c.payment_amount !== null && c.payment_amount !== undefined) chips.push(`<span>💰 ${auditMoney(c.payment_amount)}</span>`);
    if (c.document_name) chips.push(`<span>📎 ${auditEsc(c.document_name)}</span>`);
    if (c.recycle_label) chips.push(`<span>♻️ ${auditEsc(c.recycle_label)}</span>`);
    return chips.length ? `<div class="audit-context">${chips.join('')}</div>` : '';
}

function activityActionsHtml(event) {
    const c = event.context || {};
    const buttons = [];
    if (c.borrower_id) buttons.push(`<button class="audit-link" onclick="openActivityBorrower('${auditEsc(c.borrower_id)}')">👤 Profile</button>`);
    if (c.loan_id) buttons.push(`<button class="audit-link" onclick="openActivityLoan('${auditEsc(c.loan_id)}')">💳 Loan</button>`);
    if (c.emi_id) buttons.push(`<button class="audit-link" onclick="openActivityEmi('${auditEsc(c.emi_id)}')">💰 EMI</button>`);
    if (c.recycle_id && !String(event.action || '').includes('PURGE')) buttons.push(`<button class="audit-link" onclick="openActivityRecycle()">♻️ Recycle Bin</button>`);
    return buttons.length ? `<div class="audit-item-actions">${buttons.join('')}</div>` : '';
}

function renderActivityTimeline(items) {
    const timeline = document.getElementById('activityTimeline');
    const empty = document.getElementById('activityHistoryEmpty');
    if (!timeline) return;
    if (!items?.length) {
        timeline.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    let lastDay = '';
    const out = [];
    for (const event of items) {
        const day = String(event.created_at || '').slice(0, 10);
        if (day !== lastDay) {
            const dayLabel = event.created_at ? new Date(event.created_at).toLocaleDateString('en-IN', { weekday:'short', day:'2-digit', month:'short', year:'numeric' }) : 'Unknown date';
            out.push(`<div class="audit-day-divider"><span>${auditEsc(dayLabel)}</span></div>`);
            lastDay = day;
        }
        out.push(`<article class="audit-item category-${auditEsc(event.category || 'system')}">
            <div class="audit-icon">${auditEsc(event.icon || '🕘')}</div>
            <div class="audit-body">
                <div class="audit-item-head"><div><strong>${auditEsc(event.label || event.action || 'Activity')}</strong><span class="audit-category">${auditEsc(auditCategoryLabel(event.category))}</span></div><time>${auditEsc(auditDateTime(event.created_at))}</time></div>
                <p>${auditEsc(event.description || 'No description')}</p>
                ${activityContextHtml(event)}
                <div class="audit-record"><code>${auditEsc(event.action || '')}</code>${event.table_name ? `<span>${auditEsc(event.table_name)}</span>` : ''}${event.record_id ? `<small title="Record ID">${auditEsc(event.record_id)}</small>` : ''}</div>
                ${activityActionsHtml(event)}
            </div>
        </article>`);
    }
    timeline.innerHTML = out.join('');
}

function changeActivityPage(delta) {
    const next = activityHistoryState.page + delta;
    if (next < 1 || next > activityHistoryState.pages) return;
    activityHistoryState.page = next;
    loadActivityHistory();
    document.querySelector('.audit-card')?.scrollTo({ top:0, behavior:'smooth' });
}

async function exportActivityHistoryCsv() {
    try {
        const params = currentActivityParams(false);
        params.set('format', 'csv');
        const response = await adminFetch(`/api/dashboard?mode=activity&${params.toString()}`);
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const filename = match?.[1] || `AbhiTools_Audit_History_${new Date().toISOString().slice(0,10)}.csv`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
        alert(err.message || 'Audit CSV export nahi hua.');
    }
}

async function openActivityBorrower(borrowerId) {
    closeActivityHistory();
    await openBorrowerProfile(borrowerId);
}

function openActivityLoan(loanId) {
    closeActivityHistory();
    printLoanAccountStatement(loanId);
}

async function openActivityEmi(emiId) {
    closeActivityHistory();
    await openPaymentModal(emiId);
}

function openActivityRecycle() {
    closeActivityHistory();
    openRecycleBin();
}


// ==========================================
// PHASE 14 — REPORTS & ANALYTICS
// ==========================================
function reportsMoney(value) {
    return `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
}

function reportsBusinessToday() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function reportsDateShift(iso, days = 0, months = 0) {
    const d = new Date(`${iso}T00:00:00Z`);
    if (months) d.setUTCMonth(d.getUTCMonth() + months);
    if (days) d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0,10);
}

function populateReportsBorrowers(items = borrowers) {
    const select = document.getElementById('reportsBorrower');
    if (!select) return;
    const current = select.value;
    const rows = (items || []).map(b => ({ id:b.id, name:b.name || 'Unnamed' }))
        .filter(b => b.id).sort((a,b) => a.name.localeCompare(b.name, 'en', { sensitivity:'base' }));
    select.innerHTML = '<option value="">All Borrowers</option>' + rows.map(b =>
        `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('');
    if (rows.some(b => b.id === current)) select.value = current;
}

function openReportsCenter() {
    const modal = document.getElementById('reportsCenterModal');
    if (!modal) return;
    populateReportsBorrowers();
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    if (!reportsCenterData) setReportsPeriod('12m');
    else refreshReportsCenter();
}

function closeReportsCenter() {
    const modal = document.getElementById('reportsCenterModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleReportsOverlayClick(event) {
    if (event?.target?.id === 'reportsCenterModal') closeReportsCenter();
}

function reportsActivatePeriod(period) {
    reportsPeriod = period;
    document.querySelectorAll('.reports-period').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === period);
    });
}

function setReportsPeriod(period, button = null) {
    const today = reportsBusinessToday();
    const from = document.getElementById('reportsFrom');
    const to = document.getElementById('reportsTo');
    reportsActivatePeriod(period);
    reportsAllDates = period === 'all';
    if (reportsAllDates) {
        if (from) from.value = '';
        if (to) to.value = '';
    } else if (period === '90d') {
        if (from) from.value = reportsDateShift(today, -89);
        if (to) to.value = today;
    } else if (period === 'year') {
        if (from) from.value = `${today.slice(0,4)}-01-01`;
        if (to) to.value = today;
    } else {
        const d = new Date(`${today}T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - 11, 1);
        if (from) from.value = d.toISOString().slice(0,10);
        if (to) to.value = today;
    }
    refreshReportsCenter();
}

function reportsManualDatesChanged() {
    reportsAllDates = false;
    reportsPeriod = 'custom';
    document.querySelectorAll('.reports-period').forEach(btn => btn.classList.remove('active'));
}

function resetReportsFilters() {
    const borrower = document.getElementById('reportsBorrower');
    const status = document.getElementById('reportsLoanStatus');
    if (borrower) borrower.value = '';
    if (status) status.value = 'all';
    setReportsPeriod('12m');
}

function currentReportsParams(includeFormat = false) {
    const params = new URLSearchParams();
    params.set('mode', 'reports');
    const from = document.getElementById('reportsFrom')?.value || '';
    const to = document.getElementById('reportsTo')?.value || '';
    const borrower = document.getElementById('reportsBorrower')?.value || '';
    const status = document.getElementById('reportsLoanStatus')?.value || 'all';
    if (reportsAllDates) params.set('all', '1');
    else {
        if (from) params.set('from', from);
        if (to) params.set('to', to);
    }
    if (borrower) params.set('borrower_id', borrower);
    if (status && status !== 'all') params.set('loan_status', status);
    if (includeFormat) params.set('format', 'csv');
    return params;
}

function applyReportsFilters() {
    refreshReportsCenter();
}

function reportsSetText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

async function refreshReportsCenter() {
    const loading = document.getElementById('reportsLoading');
    const content = document.getElementById('reportsContent');
    if (loading) { loading.style.display = 'block'; loading.textContent = 'Report calculate ho raha hai...'; }
    if (content) content.style.display = 'none';
    try {
        const params = currentReportsParams(false);
        const response = await adminFetch(`/api/dashboard?${params.toString()}`);
        const data = await response.json();
        reportsCenterData = data;
        if (Array.isArray(data.borrowersAvailable)) populateReportsBorrowers(data.borrowersAvailable);
        renderReportsCenter(data);
        if (content) content.style.display = 'block';
    } catch (err) {
        if (loading) loading.textContent = `❌ ${err.message || 'Report load nahi hua.'}`;
        return;
    }
    if (loading) loading.style.display = 'none';
}

function renderReportsCenter(data) {
    const s = data?.summary || {};
    const f = data?.filters || {};
    reportsSetText('reportsMeta', `${data?.businessDate || '-'} • ${data?.timezone || 'Asia/Kolkata'} • ${f.allDates ? 'All dated records' : `${f.from || '-'} → ${f.to || '-'}`}${f.borrowerName ? ` • ${f.borrowerName}` : ''}`);
    reportsSetText('reportsDisbursed', reportsMoney(s.periodDisbursedAmount));
    reportsSetText('reportsDisbursedCount', `${Number(s.periodDisbursedLoans || 0)} loans`);
    reportsSetText('reportsCollected', reportsMoney(s.periodCollectionAmount));
    reportsSetText('reportsPaymentCount', `${Number(s.periodPaymentCount || 0)} payments`);
    reportsSetText('reportsOutstanding', reportsMoney(s.outstandingTotal));
    reportsSetText('reportsPortfolioLoans', `${Number(s.portfolioLoans || 0)} portfolio loans`);
    reportsSetText('reportsOverdue', reportsMoney(s.overdueAmount));
    reportsSetText('reportsLegacyCount', `${Number(s.yearNotSetCount || 0)} year-not-set EMI`);
    reportsSetText('reportsSettlement', reportsMoney(s.periodSettlementPayment));
    reportsSetText('reportsWaived', `${reportsMoney(s.periodWaivedAmount)} waived`);
    reportsSetText('reportsRecovery', `${Number(s.recoveryRate || 0).toLocaleString('en-IN')}%`);
    reportsSetText('reportsScheduled', `${reportsMoney(s.scheduledTotal)} scheduled`);

    renderReportsTrend(data.monthly || []);
    renderReportsMonthly(data.monthly || []);
    renderReportsAging(data.aging || []);
    renderReportsStatus(data);
    renderReportsBorrowers(data.borrowers || []);

    const note = document.getElementById('reportsLegacyNote');
    if (note) {
        const count = Number(s.yearNotSetCount || 0);
        note.style.display = count ? 'block' : 'none';
        note.innerHTML = count ? `ℹ️ <strong>${count.toLocaleString('en-IN')} legacy EMI</strong> me due year/date set nahi hai (${reportsMoney(s.yearNotSetAmount)} remaining). In records ko aging ya historical due date me fake year assign nahi kiya gaya.` : '';
    }
}

function renderReportsTrend(monthly) {
    const box = document.getElementById('reportsTrend');
    if (!box) return;
    if (!monthly.length) { box.innerHTML = '<div class="reports-empty">Selected range me dated financial movement nahi mila.</div>'; return; }
    const max = Math.max(...monthly.flatMap(m => [Number(m.disbursed)||0, Number(m.collected)||0]), 1);
    box.innerHTML = monthly.map(m => {
        const d = Number(m.disbursed)||0, c = Number(m.collected)||0;
        const dh = d ? Math.max(5, Math.round((d/max)*100)) : 2;
        const ch = c ? Math.max(5, Math.round((c/max)*100)) : 2;
        return `<div class="reports-trend-col" title="${escapeHtml(m.label)} • Lent ${escapeHtml(reportsMoney(d))} • Collected ${escapeHtml(reportsMoney(c))}">
            <div class="reports-trend-bars"><i class="lent" style="height:${dh}%"></i><i class="collected" style="height:${ch}%"></i></div>
            <small>${escapeHtml(m.label || '')}</small>
        </div>`;
    }).join('');
}

function renderReportsMonthly(monthly) {
    const body = document.getElementById('reportsMonthlyBody');
    if (!body) return;
    body.innerHTML = monthly.length ? monthly.map(m => `<tr>
        <td><strong>${escapeHtml(m.label || '')}</strong></td><td>${Number(m.loanCount||0)}</td><td>${reportsMoney(m.disbursed)}</td>
        <td>${Number(m.paymentCount||0)}</td><td>${reportsMoney(m.collected)}</td><td>${Number(m.settlementCount||0)}</td><td>${reportsMoney(m.waived)}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="reports-empty-cell">No dated monthly activity.</td></tr>';
}

function renderReportsAging(aging) {
    const box = document.getElementById('reportsAging');
    if (!box) return;
    const max = Math.max(...aging.map(a => Number(a.amount)||0), 1);
    box.innerHTML = aging.map(a => {
        const amount = Number(a.amount)||0;
        const width = amount ? Math.max(3, Math.round((amount/max)*100)) : 0;
        return `<div class="reports-aging-row"><div><strong>${escapeHtml(a.label || '')}</strong><small>${Number(a.count||0)} EMI</small></div><div class="reports-aging-track"><i data-key="${escapeHtml(a.key || '')}" style="width:${width}%"></i></div><b>${reportsMoney(amount)}</b></div>`;
    }).join('');
}

function renderReportsStatus(data) {
    const loan = data?.loanStatus || {}, emi = data?.emiStatus || {};
    const status = document.getElementById('reportsStatus');
    if (status) status.innerHTML = `
        <div class="reports-status-group"><small>Loans</small><span>🟢 Active <b>${Number(loan.active||0)}</b></span><span>✅ Closed <b>${Number(loan.closed||0)}</b></span><span>⚠️ Defaulted <b>${Number(loan.defaulted||0)}</b></span></div>
        <div class="reports-status-group"><small>EMIs</small><span>⏳ Pending <b>${Number(emi.pending||0)}</b></span><span>🌓 Partial <b>${Number(emi.partial||0)}</b></span><span>✅ Paid <b>${Number(emi.paid||0)}</b></span><span>🔴 Overdue <b>${Number(emi.overdue||0)}</b></span></div>`;
    const methods = document.getElementById('reportsMethods');
    if (methods) {
        const rows = data?.paymentMethods || [];
        methods.innerHTML = `<h5>Period Payment Methods</h5>` + (rows.length ? rows.map(x => `<span>${escapeHtml(x.method || 'Not specified')} <b>${reportsMoney(x.amount)}</b> <small>${Number(x.count||0)}</small></span>`).join('') : '<div class="profile-muted">Is period me payment entries nahi hain.</div>');
    }
}

function renderReportsBorrowers(rows) {
    const body = document.getElementById('reportsBorrowerBody');
    if (!body) return;
    body.innerHTML = rows.length ? rows.map(b => `<tr>
        <td><strong>${escapeHtml(b.name || 'Unknown')}</strong></td><td>${Number(b.loanCount||0)}</td><td>${reportsMoney(b.principal)}</td><td>${reportsMoney(b.collected)}</td><td>${reportsMoney(b.outstanding)}</td><td>${reportsMoney(b.overdue)}</td>
        <td>${b.id ? `<button class="reports-row-btn" onclick="openReportsBorrower('${escapeHtml(b.id)}')">Profile</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="reports-empty-cell">No borrower portfolio in this filter.</td></tr>';
}

async function openReportsBorrower(id) {
    closeReportsCenter();
    await openBorrowerProfile(id);
}

async function exportReportsCsv() {
    try {
        const params = currentReportsParams(true);
        const response = await adminFetch(`/api/dashboard?${params.toString()}`);
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const filename = match?.[1] || `AbhiTools_Report_${reportsBusinessToday()}.csv`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
        alert(err.message || 'Report CSV export nahi hua.');
    }
}

function reportsPrintRows(items, columns) {
    if (!items?.length) return `<tr><td colspan="${columns.length}">No records.</td></tr>`;
    return items.map(item => `<tr>${columns.map(col => `<td class="${col.money ? 'right' : ''}">${col.money ? reportsMoney(item[col.key]) : escapeHtml(item[col.key] ?? '')}</td>`).join('')}</tr>`).join('');
}

function printReportsCenter() {
    const data = reportsCenterData;
    if (!data) { alert('Pehle report generate karein.'); return; }
    const s = data.summary || {}, f = data.filters || {};
    const monthlyRows = (data.monthly || []).map(m => `<tr><td>${escapeHtml(m.label||'')}</td><td>${Number(m.loanCount||0)}</td><td class="right">${reportsMoney(m.disbursed)}</td><td>${Number(m.paymentCount||0)}</td><td class="right">${reportsMoney(m.collected)}</td><td class="right">${reportsMoney(m.waived)}</td></tr>`).join('') || '<tr><td colspan="6">No dated activity.</td></tr>';
    const borrowerRows = (data.borrowers || []).slice(0,30).map(b => `<tr><td>${escapeHtml(b.name||'')}</td><td>${Number(b.loanCount||0)}</td><td class="right">${reportsMoney(b.principal)}</td><td class="right">${reportsMoney(b.collected)}</td><td class="right">${reportsMoney(b.outstanding)}</td><td class="right">${reportsMoney(b.overdue)}</td></tr>`).join('') || '<tr><td colspan="6">No borrower data.</td></tr>';
    phase6PrintDocument('AbhiTools Reports & Analytics', `
        <div class="brand"><div><h1>Abhishek Management</h1><p>Reports & Analytics</p></div><div class="doc-title"><strong>Financial Report</strong><small>${escapeHtml(f.allDates ? 'All dated records' : `${f.from || '-'} to ${f.to || '-'}`)}</small></div></div>
        <div class="party"><div class="box"><small>Borrower Filter</small><strong>${escapeHtml(f.borrowerName || 'All Borrowers')}</strong></div><div class="box"><small>Loan Status</small><strong>${escapeHtml(f.loanStatus || 'all')}</strong></div></div>
        <div class="summary"><div class="metric"><small>Period Disbursed</small><strong>${reportsMoney(s.periodDisbursedAmount)}</strong></div><div class="metric"><small>Period Collected</small><strong>${reportsMoney(s.periodCollectionAmount)}</strong></div><div class="metric"><small>Outstanding</small><strong>${reportsMoney(s.outstandingTotal)}</strong></div><div class="metric"><small>Overdue</small><strong>${reportsMoney(s.overdueAmount)}</strong></div></div>
        <h2>Monthly Movement</h2><table><thead><tr><th>Month</th><th>Loans</th><th class="right">Disbursed</th><th>Payments</th><th class="right">Collected</th><th class="right">Waived</th></tr></thead><tbody>${monthlyRows}</tbody></table>
        <h2>Borrower Performance</h2><table><thead><tr><th>Borrower</th><th>Loans</th><th class="right">Principal</th><th class="right">Collected</th><th class="right">Outstanding</th><th class="right">Overdue</th></tr></thead><tbody>${borrowerRows}</tbody></table>
        <p class="note">Recovery rate: ${Number(s.recoveryRate||0)}%. Settlement payment: ${reportsMoney(s.periodSettlementPayment)}. Waived: ${reportsMoney(s.periodWaivedAmount)}. Legacy year-not-set EMI: ${Number(s.yearNotSetCount||0)} (${reportsMoney(s.yearNotSetAmount)} remaining). Unknown legacy dates are never guessed.</p>
    `);
}

// ==========================================
// PHASE 18 — DATA QUALITY & LEGACY CLEANUP
// ==========================================
let dataQualityData = null;
let dataQualitySelectedLoanId = null;

function dqMoney(value) {
    return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function openDataQualityCenter(initialFilter = 'all') {
    const modal = document.getElementById('dataQualityModal');
    if (!modal) return;
    const search = document.getElementById('dqSearch');
    const filter = document.getElementById('dqFilter');
    if (search) search.value = '';
    if (filter) filter.value = initialFilter || 'all';
    closeDataQualityReview();
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    loadDataQualityCenter();
}

function closeDataQualityCenter() {
    const modal = document.getElementById('dataQualityModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    dataQualitySelectedLoanId = null;
}

function handleDataQualityOverlayClick(event) {
    if (event?.target?.id === 'dataQualityModal') closeDataQualityCenter();
}

function closeDataQualityReview() {
    const panel = document.getElementById('dqReviewPanel');
    if (panel) panel.style.display = 'none';
    dataQualitySelectedLoanId = null;
}

function setDataQualityFilter(value) {
    const filter = document.getElementById('dqFilter');
    if (filter) filter.value = value || 'all';
    renderDataQualityList();
}

function dqSetText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

async function loadDataQualityCenter() {
    const loading = document.getElementById('dqLoading');
    if (loading) { loading.style.display = 'block'; loading.textContent = 'Data quality audit load ho raha hai...'; }
    try {
        const response = await adminFetch('/api/dashboard?mode=data-quality');
        const data = await response.json();
        dataQualityData = data;
        const s = data?.summary || {};
        dqSetText('dqMissingEmis', Number(s.missing_emi_dates || 0));
        dqSetText('dqAffectedLoans', Number(s.affected_loans || 0));
        dqSetText('dqMissingLoanYear', Number(s.missing_loan_year || 0));
        dqSetText('dqMissingLoanDate', Number(s.missing_loan_date || 0));
        dqSetText('dqSequenceGaps', Number(s.loans_with_sequence_gaps || 0));
        dqSetText('dqInvalidSource', Number(s.invalid_source_dates || 0));
        dqSetText('dataQualityMeta', `${Number(s.affected_loans || 0)} affected loans • ${Number(s.missing_emi_dates || 0)} EMI dates need review • No guessing`);
        renderDataQualityList();
        if (loading) loading.style.display = 'none';
    } catch (err) {
        if (loading) { loading.style.display = 'block'; loading.textContent = `❌ ${err.message || 'Data quality audit load nahi hua.'}`; }
    }
}

function dataQualityFilteredItems() {
    let rows = Array.isArray(dataQualityData?.items) ? [...dataQualityData.items] : [];
    const q = String(document.getElementById('dqSearch')?.value || '').trim().toLowerCase();
    const filter = String(document.getElementById('dqFilter')?.value || 'all');
    if (filter === 'dates') rows = rows.filter(x => Number(x.missing_due_count || 0) > 0);
    if (filter === 'loan-meta') rows = rows.filter(x => !x.loan_year || !x.loan_date);
    if (filter === 'gaps') rows = rows.filter(x => Array.isArray(x.installment_gaps) && x.installment_gaps.length);
    if (filter === 'invalid') rows = rows.filter(x => Number(x.invalid_source_count || 0) > 0);
    if (q) rows = rows.filter(x => `${x.borrower_name || ''} ${x.loan_code || ''}`.toLowerCase().includes(q));
    return rows;
}

function renderDataQualityList() {
    const list = document.getElementById('dqList');
    if (!list) return;
    const rows = dataQualityFilteredItems();
    if (!rows.length) {
        list.innerHTML = '<div class="dq-empty">✅ Is filter me koi data-quality issue nahi mila.</div>';
        return;
    }
    list.innerHTML = rows.map(item => {
        const tags = [];
        if (item.missing_due_count) tags.push(`<span class="warn">${Number(item.missing_due_count)} EMI date missing</span>`);
        if (!item.loan_year) tags.push('<span>Loan year missing</span>');
        if (!item.loan_date) tags.push('<span>Loan date missing</span>');
        if (item.installment_gaps?.length) tags.push(`<span class="gap">Installment gap: ${item.installment_gaps.map(Number).join(', ')}</span>`);
        if (item.invalid_source_count) tags.push(`<span class="danger">${Number(item.invalid_source_count)} invalid day/month</span>`);
        return `<article class="dq-item ${item.invalid_source_count ? 'blocked' : ''}">
            <div class="dq-item-main"><div class="dq-item-title"><strong>${escapeHtml(item.borrower_name || 'Unknown')}</strong><b>${escapeHtml(item.loan_code || 'Loan')}</b></div>
            <div class="dq-item-meta">${dqMoney(item.amount)} • ${escapeHtml(item.status || 'active')} • ${item.emis?.length || 0} EMI rows</div>
            <div class="dq-tags">${tags.join('')}</div></div>
            <button class="btn ${item.invalid_source_count ? 'btn-warning' : 'btn-view'}" onclick="openDataQualityReview('${item.id}')">${item.invalid_source_count ? '⚠️ Review Blocker' : '🧩 Review & Fix'}</button>
        </article>`;
    }).join('');
}

function dqSelectedLoan() {
    return (dataQualityData?.items || []).find(x => x.id === dataQualitySelectedLoanId) || null;
}

function openDataQualityReview(loanId) {
    const item = (dataQualityData?.items || []).find(x => x.id === loanId);
    if (!item) return;
    dataQualitySelectedLoanId = loanId;
    const panel = document.getElementById('dqReviewPanel');
    if (!panel) return;
    dqSetText('dqReviewTitle', `${item.borrower_name || 'Unknown'} • ${item.loan_code || 'Loan'}`);
    dqSetText('dqReviewMeta', `${Number(item.missing_due_count || 0)} missing EMI date(s) • Existing month/day locked`);

    const loanYear = document.getElementById('dqLoanYear');
    const loanDate = document.getElementById('dqLoanDate');
    const firstYear = document.getElementById('dqFirstYear');
    const note = document.getElementById('dqNote');
    if (loanYear) { loanYear.value = item.loan_year || ''; loanYear.disabled = Boolean(item.loan_year); }
    if (loanDate) { loanDate.value = item.loan_date || ''; loanDate.disabled = Boolean(item.loan_date); }
    if (firstYear) firstYear.value = '';
    if (note) note.value = '';

    const alerts = [];
    if (item.installment_gaps?.length) alerts.push(`<div class="dq-alert gap"><b>Sequence gap detected:</b> EMI #${item.installment_gaps.map(Number).join(', #')} record(s) database me nahi hain. Phase 18 inhe create nahi karega.</div>`);
    if (item.invalid_source_count) alerts.push(`<div class="dq-alert danger"><b>Apply blocked:</b> ${Number(item.invalid_source_count)} legacy EMI row me invalid day/month hai. Pehle source schedule ko manually correct karna hoga.</div>`);
    if (!item.loan_year || !item.loan_date) alerts.push('<div class="dq-alert info">Loan year/date optional hain. Sirf tab bharein jab aapke paas verified information ho. Blank chhodna allowed hai.</div>');
    document.getElementById('dqReviewAlerts').innerHTML = alerts.join('');

    const body = document.getElementById('dqEmiBody');
    body.innerHTML = (item.emis || []).map(e => {
        if (!e.missing_date) {
            return `<tr><td>#${Number(e.installment_number || 0)}</td><td>${Number(e.due_day || 0)} ${escapeHtml(e.due_month || '')}</td><td>${dqMoney(e.amount)}</td><td>${e.due_year || '-'}</td><td>${escapeHtml(String(e.due_date || '-').slice(0,10))}</td><td><span class="dq-ok">Existing</span></td></tr>`;
        }
        const preset = e.due_year || (e.due_date ? String(e.due_date).slice(0,4) : '');
        const disabled = !e.source_date_valid ? 'disabled' : '';
        return `<tr class="dq-missing-row" data-emi-id="${e.id}" data-month="${escapeHtml(e.due_month || '')}" data-day="${Number(e.due_day || 0)}">
            <td>#${Number(e.installment_number || 0)}</td><td>${Number(e.due_day || 0)} ${escapeHtml(e.due_month || '')}</td><td>${dqMoney(e.amount)}</td>
            <td><input class="dq-year-input" type="number" min="2000" max="2200" value="${escapeHtml(preset)}" ${disabled} oninput="updateDataQualityPreview()"></td>
            <td><span class="dq-date-preview">${e.source_date_valid ? '—' : 'Invalid source'}</span></td>
            <td>${e.source_date_valid ? '<span class="dq-needs">Needs review</span>' : '<span class="dq-bad">Blocked</span>'}</td>
        </tr>`;
    }).join('');

    const applyBtn = document.getElementById('dqApplyBtn');
    if (applyBtn) applyBtn.disabled = Boolean(item.invalid_source_count);
    panel.style.display = 'block';
    updateDataQualityPreview();
    panel.scrollIntoView({ behavior:'smooth', block:'start' });
}

function dqIsoFor(day, month, year) {
    const m = monthOrder.indexOf(String(month || '').toUpperCase()) + 1;
    const d = Number(day);
    const y = Number(year);
    if (!m || !Number.isInteger(d) || d < 1 || !Number.isInteger(y) || y < 2000 || y > 2200) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function fillDataQualitySequence() {
    const item = dqSelectedLoan();
    if (!item) return;
    let year = Number.parseInt(document.getElementById('dqFirstYear')?.value, 10);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) return alert('Pehle first visible EMI ka verified year enter karein.');
    const rows = [...document.querySelectorAll('#dqEmiBody tr.dq-missing-row')];
    if (!rows.length) return alert('Is loan me EMI date gap nahi hai.');
    let previousMonth = null;
    for (const row of rows) {
        const currentMonth = monthOrder.indexOf(String(row.dataset.month || '').toUpperCase());
        if (currentMonth < 0) continue;
        if (previousMonth !== null && currentMonth < previousMonth) year += 1;
        const input = row.querySelector('.dq-year-input');
        if (input && !input.disabled) input.value = year;
        previousMonth = currentMonth;
    }
    updateDataQualityPreview();
}

function updateDataQualityPreview() {
    const item = dqSelectedLoan();
    if (!item) return;
    const rows = [...document.querySelectorAll('#dqEmiBody tr.dq-missing-row')];
    let valid = true;
    let reviewed = 0;
    for (const row of rows) {
        const input = row.querySelector('.dq-year-input');
        const preview = row.querySelector('.dq-date-preview');
        if (!input || input.disabled) { valid = false; continue; }
        const iso = dqIsoFor(Number(row.dataset.day), row.dataset.month, Number(input.value));
        if (preview) preview.textContent = iso || 'Invalid / missing year';
        input.classList.toggle('invalid', !iso);
        if (!iso) valid = false;
        else reviewed += 1;
    }
    const loanYear = document.getElementById('dqLoanYear')?.value || '';
    const loanDate = document.getElementById('dqLoanDate')?.value || '';
    if (loanYear && loanDate && Number(loanYear) !== Number(String(loanDate).slice(0,4))) valid = false;
    const status = document.getElementById('dqPreviewStatus');
    if (status) {
        if (item.invalid_source_count) status.textContent = 'Apply blocked: invalid legacy day/month detected.';
        else if (rows.length && reviewed !== rows.length) status.textContent = `${reviewed}/${rows.length} EMI years reviewed. Har missing EMI ka year required hai.`;
        else if (loanYear && loanDate && Number(loanYear) !== Number(String(loanDate).slice(0,4))) status.textContent = 'Loan year aur exact loan date ka year match hona chahiye.';
        else status.textContent = rows.length ? `✅ ${reviewed} EMI dates ready for final confirmation.` : '✅ EMI dates complete. Optional loan metadata can be saved.';
    }
    const applyBtn = document.getElementById('dqApplyBtn');
    if (applyBtn) applyBtn.disabled = Boolean(item.invalid_source_count) || !valid;
}

async function applyDataQualityReview() {
    const item = dqSelectedLoan();
    if (!item) return;
    if (item.invalid_source_count) return alert('Invalid legacy day/month ke karan apply blocked hai.');

    const updates = [];
    for (const row of document.querySelectorAll('#dqEmiBody tr.dq-missing-row')) {
        const input = row.querySelector('.dq-year-input');
        const year = Number.parseInt(input?.value, 10);
        const iso = dqIsoFor(Number(row.dataset.day), row.dataset.month, year);
        if (!iso) return alert(`EMI row ka reviewed year/date valid nahi hai: ${row.dataset.day} ${row.dataset.month}`);
        updates.push({ emi_id: row.dataset.emiId, due_year: year });
    }

    const loanYearRaw = document.getElementById('dqLoanYear')?.value || '';
    const loanDate = document.getElementById('dqLoanDate')?.value || '';
    const loanYear = loanYearRaw ? Number.parseInt(loanYearRaw, 10) : null;
    if (loanYear && (loanYear < 2000 || loanYear > 2200)) return alert('Loan year valid nahi hai.');
    if (loanDate && loanYear && Number(loanDate.slice(0,4)) !== loanYear) return alert('Loan year aur exact loan date ka year match hona chahiye.');
    if (!updates.length && !loanYear && !loanDate) return alert('Save karne ke liye koi reviewed change nahi hai.');

    const typed = prompt(`Safety confirmation\n\n${item.borrower_name} • ${item.loan_code}\n${updates.length} EMI date(s) update hongi. Apply se pehle automatic backup banega.\n\nType APPLY DATES to continue:`);
    if (String(typed || '').trim().toUpperCase() !== 'APPLY DATES') return;

    const applyBtn = document.getElementById('dqApplyBtn');
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Applying safely...'; }
    try {
        const response = await adminFetch('/api/dashboard?mode=data-quality', {
            method:'POST', headers:{ 'Content-Type':'application/json' },
            body:JSON.stringify({
                action:'apply_cleanup', loan_id:item.id, updates,
                loan_year:loanYear, loan_date:loanDate || null,
                note:document.getElementById('dqNote')?.value || '', confirm:'APPLY DATES'
            })
        });
        const result = await response.json();
        alert(`✅ Cleanup applied safely.\nUpdated EMI dates: ${Number(result.updated_emis || 0)}\nBackup snapshot: ${result.snapshot_id || 'created'}`);
        closeDataQualityReview();
        await loadAllData();
        await loadDataQualityCenter();
        await refreshReminderBadge(true);
    } catch (err) {
        alert(`Cleanup apply nahi hua: ${err.message}`);
    } finally {
        if (applyBtn) { applyBtn.textContent = '✅ Apply Reviewed Cleanup'; updateDataQualityPreview(); }
    }
}




// ==========================================
// PHASE 21 - V2 STABLE RELEASE & RECOVERY
// ==========================================
function releaseDateTime(value) {
    if (!value) return 'No snapshot';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Unknown time';
    return d.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });
}

async function loadReleaseVersionBadge() {
    try {
        const response = await fetch('/version.json', { cache:'no-store' });
        if (!response.ok) throw new Error(`Version manifest ${response.status}`);
        releaseManifestData = await response.json();
        const badge = document.getElementById('releaseVersionBadge');
        if (badge) badge.textContent = releaseManifestData?.label || `V${releaseManifestData?.release || '2.0.0'} Stable`;
        return releaseManifestData;
    } catch (err) {
        const badge = document.getElementById('releaseVersionBadge');
        if (badge) badge.textContent = 'V2.0 Stable';
        throw err;
    }
}

async function openReleaseCenter() {
    const modal = document.getElementById('releaseCenterModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    await refreshReleaseCenter();
}

function closeReleaseCenter() {
    const modal = document.getElementById('releaseCenterModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleReleaseOverlayClick(event) {
    if (event?.target?.id === 'releaseCenterModal') closeReleaseCenter();
}

async function refreshReleaseCenter() {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    try {
        const [manifestRes, backupsRes, homeRes] = await Promise.all([
            fetch('/version.json', { cache:'no-store' }),
            adminFetch('/api/backup?action=list', { cache:'no-store' }),
            adminFetch('/api/dashboard?mode=home', { cache:'no-store' })
        ]);
        const manifest = manifestRes.ok ? await manifestRes.json() : (releaseManifestData || {});
        const backups = await backupsRes.json();
        const home = await homeRes.json();
        releaseManifestData = manifest;

        const latest = Array.isArray(backups) ? backups[0] : null;
        const version = manifest?.release || '2.0.0';
        const label = manifest?.label || `V${version} Stable`;
        set('releaseCenterMeta', `${label} • released ${manifest?.release_date || '2026-08-24'} • production recovery toolkit`);
        set('releaseStableLabel', label);
        set('releaseVersionCode', version);
        set('releaseHealthVersion', version);
        set('releaseBackupFormat', `v${Number(manifest?.backup_format_version || 5)}`);
        set('releaseHealthBackup', latest ? 'Available' : 'None');
        set('releaseHealthBackupTime', latest ? releaseDateTime(latest.created_at) : 'Create one before next change');
        set('releaseHealthRecycle', String(Number(home?.summary?.recycleItems || 0)));
        set('releaseHealthQuality', String(Number(home?.summary?.legacyMissingDates || 0)));
        set('releaseBackupHint', latest ? `Latest server snapshot: ${releaseDateTime(latest.created_at)} • ${latest.label || latest.reason || 'Backup'}` : '⚠️ Server snapshot nahi mila. Next change se pehle create karein.');

        const badge = document.getElementById('releaseVersionBadge');
        if (badge) badge.textContent = label;
    } catch (err) {
        set('releaseBackupHint', `Release status refresh nahi hua: ${err.message}`);
    }
}

async function releaseCreateSnapshot() {
    const data = await createManualBackup();
    if (data) await refreshReleaseCenter();
}

function releaseOpenRestore() {
    closeReleaseCenter();
    openDataSafetyCenter('restore');
}

function releaseOpenActivity() {
    closeReleaseCenter();
    openActivityHistory();
}

function releaseOpenDataQuality() {
    closeReleaseCenter();
    openDataQualityCenter('all');
}

// ==========================================
// PHASE 20 - COLLECTION PRIORITY & ACCOUNT HEALTH INSIGHTS
// Operational collection support only; not a credit score or lending eligibility tool.
// ==========================================
function ciMoney(value) {
    return `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
}

function ciSetText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function ciTierMeta(tier) {
    return ({
        critical: { label:'Critical', icon:'🔴', className:'critical' },
        high: { label:'High', icon:'🟠', className:'high' },
        watch: { label:'Watch', icon:'🟡', className:'watch' },
        current: { label:'Current', icon:'🟢', className:'current' },
        data_incomplete: { label:'Data Incomplete', icon:'🧩', className:'incomplete' }
    })[tier] || { label:'Current', icon:'🟢', className:'current' };
}

function ciConfidenceLabel(value) {
    return ({ high:'High confidence', medium:'Medium confidence', low:'Low confidence' })[value] || 'Low confidence';
}

function ciContactTime(value) {
    if (!value) return 'No contact logged in last 30 days';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Contact logged';
    return `Last contact ${d.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true })}`;
}

function openCollectionInsights(initialTier = 'all') {
    const modal = document.getElementById('collectionInsightsModal');
    if (!modal) return;
    const tier = document.getElementById('ciTier');
    const search = document.getElementById('ciSearch');
    const sort = document.getElementById('ciSort');
    if (tier) tier.value = initialTier || 'all';
    if (search) search.value = '';
    if (sort) sort.value = 'priority';
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    refreshCollectionInsights();
}

function closeCollectionInsights() {
    const modal = document.getElementById('collectionInsightsModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function handleCollectionInsightsOverlayClick(event) {
    if (event?.target?.id === 'collectionInsightsModal') closeCollectionInsights();
}

function setCollectionInsightsTier(tier) {
    const select = document.getElementById('ciTier');
    if (select) select.value = tier || 'all';
    renderCollectionInsightsList();
}

async function refreshCollectionInsights() {
    const loading = document.getElementById('ciLoading');
    const content = document.getElementById('ciContent');
    if (loading) { loading.style.display = 'block'; loading.textContent = 'Collection insights calculate ho rahe hain...'; }
    if (content) content.style.display = 'none';
    try {
        const response = await adminFetch('/api/dashboard?mode=risk');
        const data = await response.json();
        collectionInsightsData = data;
        renderCollectionInsights(data);
        if (content) content.style.display = 'block';
        if (loading) loading.style.display = 'none';
        return data;
    } catch (err) {
        if (loading) { loading.style.display = 'block'; loading.textContent = `❌ ${err.message || 'Collection insights load nahi hue.'}`; }
        throw err;
    }
}

function renderCollectionInsights(data) {
    const s = data?.summary || {};
    const c = data?.concentration || {};
    ciSetText('ciMeta', `${data?.businessDate || '-'} • ${data?.timezone || 'Asia/Kolkata'} • Operational collection view • Not a credit score`);
    ciSetText('ciCritical', Number(s.critical || 0));
    ciSetText('ciHigh', Number(s.high || 0));
    ciSetText('ciWatch', Number(s.watch || 0));
    ciSetText('ciCurrent', Number(s.current || 0));
    ciSetText('ciIncomplete', Number(s.dataIncomplete || 0));
    ciSetText('ciOutstanding', ciMoney(s.totalOutstanding));
    ciSetText('ciOverdueAmount', `${ciMoney(s.totalOverdue)} overdue`);
    ciSetText('ciTopExposure', `${Number(c.topBorrowerShare || 0).toLocaleString('en-IN')}%`);
    ciSetText('ciTopExposureName', c.topBorrowerName ? `${c.topBorrowerName} • ${ciMoney(c.topBorrowerOutstanding)}` : 'No outstanding');
    ciSetText('ciTop3Share', `${Number(c.top3Share || 0).toLocaleString('en-IN')}%`);
    ciSetText('ciDataCompleteness', `${Number(s.dataCompleteness || 0).toLocaleString('en-IN')}%`);
    ciSetText('ciDataCoverageText', `${Number(s.datedEmis || 0)} / ${Number(s.totalEmis || 0)} EMI dated`);
    ciSetText('ciLateRate', `${Number(s.latePaymentRate || 0).toLocaleString('en-IN')}%`);
    ciSetText('ciLatePaidText', `${Number(s.latePaidEmis || 0)} late of ${Number(s.paidDatedEmis || 0)} dated paid EMI`);
    ciSetText('ciMissingContact', Number(s.missingContactBorrowers || 0));

    const warning = document.getElementById('ciDataWarning');
    if (warning) {
        const incomplete = Number(s.dataIncomplete || 0);
        const missing = Number(s.missingDates || 0);
        warning.style.display = (incomplete || missing) ? 'flex' : 'none';
        warning.innerHTML = (incomplete || missing)
            ? `<div><strong>🧩 Data-quality guard active</strong><span>${missing.toLocaleString('en-IN')} EMI due date(s) missing. ${incomplete.toLocaleString('en-IN')} borrower(s) ko false priority score dene ke bajay Data Incomplete dikhaya gaya hai.</span></div><button class="btn btn-view" onclick="ciOpenDataQuality()">Review Dates →</button>`
            : '';
    }
    renderCollectionInsightsList();
}

function collectionInsightsFilteredRows() {
    let rows = Array.isArray(collectionInsightsData?.borrowers) ? [...collectionInsightsData.borrowers] : [];
    const q = String(document.getElementById('ciSearch')?.value || '').trim().toLowerCase();
    const tier = String(document.getElementById('ciTier')?.value || 'all');
    const sort = String(document.getElementById('ciSort')?.value || 'priority');
    if (tier !== 'all') rows = rows.filter(x => x.tier === tier);
    if (q) rows = rows.filter(x => [x.name, x.phone, x.whatsapp].map(v => String(v || '').toLowerCase()).join(' ').includes(q));

    const priorityOrder = { critical:5, high:4, watch:3, data_incomplete:2, current:1 };
    if (sort === 'outstanding') rows.sort((a,b) => Number(b.outstanding||0)-Number(a.outstanding||0));
    else if (sort === 'overdue') rows.sort((a,b) => Number(b.overdue_amount||0)-Number(a.overdue_amount||0) || Number(b.max_days_overdue||0)-Number(a.max_days_overdue||0));
    else if (sort === 'recovery') rows.sort((a,b) => Number(a.recovery_rate||0)-Number(b.recovery_rate||0));
    else if (sort === 'completeness') rows.sort((a,b) => Number(a.data_completeness||0)-Number(b.data_completeness||0));
    else rows.sort((a,b) => (priorityOrder[b.tier]||0)-(priorityOrder[a.tier]||0) || Number(b.priority_score??-1)-Number(a.priority_score??-1) || Number(b.outstanding||0)-Number(a.outstanding||0));
    return rows;
}

function renderCollectionInsightsList() {
    const list = document.getElementById('ciList');
    if (!list) return;
    const rows = collectionInsightsFilteredRows();
    if (!rows.length) {
        list.innerHTML = '<div class="ci-empty">Is filter me koi borrower nahi mila.</div>';
        return;
    }
    list.innerHTML = rows.map(item => {
        const tier = ciTierMeta(item.tier);
        const score = item.priority_score === null || item.priority_score === undefined ? '—' : Number(item.priority_score);
        const reasons = (item.reasons || []).slice(0, 4).map(r => `<span>${escapeHtml(r)}</span>`).join('');
        const contactDigits = String(item.phone || item.whatsapp || '').replace(/\D/g, '');
        const dataIncomplete = item.tier === 'data_incomplete';
        return `<article class="ci-item ${tier.className}">
            <div class="ci-item-head">
                <div class="ci-person"><div><strong>${escapeHtml(item.name || 'Unknown Borrower')}</strong><span class="ci-tier ${tier.className}">${tier.icon} ${tier.label}</span></div><small>${Number(item.active_loan_count||0)} active / ${Number(item.loan_count||0)} total loans • ${item.has_contact ? 'Contact available' : '⚠️ Contact missing'}</small></div>
                <div class="ci-score ${tier.className}"><small>Priority</small><strong>${score}</strong><span>${dataIncomplete ? 'Score suppressed' : ciConfidenceLabel(item.confidence)}</span></div>
            </div>
            <div class="ci-metrics">
                <div><small>Outstanding</small><strong>${ciMoney(item.outstanding)}</strong></div>
                <div><small>Overdue</small><strong>${ciMoney(item.overdue_amount)}</strong><span>${Number(item.overdue_count||0)} EMI</span></div>
                <div><small>Max Overdue</small><strong>${Number(item.max_days_overdue||0)}d</strong></div>
                <div><small>Partial</small><strong>${Number(item.partial_count||0)}</strong></div>
                <div><small>Recovery</small><strong>${Number(item.recovery_rate||0).toLocaleString('en-IN')}%</strong></div>
                <div><small>Data Coverage</small><strong>${Number(item.data_completeness||0)}%</strong><span>${Number(item.missing_date_count||0)} missing</span></div>
            </div>
            <div class="ci-reasons">${reasons || '<span>No observed collection exception</span>'}</div>
            <div class="ci-followup"><span>🔔 ${Number(item.contact_attempts_30d||0)} contact attempt(s) in 30 days</span><small>${escapeHtml(ciContactTime(item.last_contact_at))}</small></div>
            <div class="ci-actions">
                <button class="btn btn-view" onclick="ciOpenBorrower('${escapeHtml(item.id)}')">👤 Profile</button>
                <button class="btn btn-warning" onclick="ciOpenReminders('${escapeHtml(item.id)}')">🔔 Reminders</button>
                <button class="btn btn-success" ${item.has_contact ? '' : 'disabled'} onclick="ciOpenWhatsApp('${escapeHtml(item.id)}')">💬 WhatsApp</button>
                <button class="btn btn-secondary" ${contactDigits ? '' : 'disabled'} onclick="ciCall('${escapeHtml(contactDigits)}')">📞 Call</button>
                ${dataIncomplete ? '<button class="btn btn-view" onclick="ciOpenDataQuality()">🧩 Fix Dates</button>' : ''}
            </div>
        </article>`;
    }).join('');
}

async function ciOpenBorrower(id) {
    closeCollectionInsights();
    await openBorrowerProfile(id);
}

function ciBorrowerById(id) {
    return (collectionInsightsData?.borrowers || []).find(x => x.id === id) || null;
}

async function ciOpenReminders(id) {
    const item = ciBorrowerById(id);
    closeCollectionInsights();
    try {
        await openReminderCenter('all');
        const search = document.getElementById('reminderSearch');
        if (search && item?.name) search.value = item.name;
        renderReminderList();
    } catch {}
}

function ciOpenWhatsApp(id) {
    closeCollectionInsights();
    openWhatsAppCenter({ borrowerId:id, template:'due' });
}

function ciCall(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return;
    window.location.href = `tel:${digits}`;
}

function ciOpenDataQuality() {
    closeCollectionInsights();
    openDataQualityCenter('dates');
}

async function exportCollectionInsightsCsv() {
    try {
        const response = await adminFetch('/api/dashboard?mode=risk&format=csv');
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const filename = match?.[1] || `AbhiTools_Collection_Insights.csv`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
        alert(err.message || 'Collection insights CSV export nahi hua.');
    }
}
