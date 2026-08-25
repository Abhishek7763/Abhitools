// AbhiTools Design Build 1 — responsive app shell/navigation only.
(() => {
    'use strict';

    if (!document.body?.classList.contains('has-mobile-app-nav')) return;
    if (document.getElementById('uiShellBottomNav')) return;

    const STORAGE_KEY = 'abhitools_sidebar_expanded';
    const body = document.body;

    const invoke = (name, args = [], afterId = '') => {
        closeMore();
        window.setTimeout(() => {
            const fn = window[name];
            if (typeof fn !== 'function') {
                showShellToast('Ye tool abhi load nahi hua. Page refresh karke dobara try karein.');
                return;
            }
            try {
                fn(...args);
                if (afterId) {
                    window.setTimeout(() => document.getElementById(afterId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
                }
            } catch (error) {
                console.error(`UI shell action failed: ${name}`, error);
                showShellToast('Action open nahi hua. Dobara try karein.');
            }
        }, 0);
    };

    const groups = [
        {
            title: 'Management',
            items: [
                ['👥', 'Borrowers', 'openBorrowerDirectory'],
                ['👤', 'Add Borrower', 'showBorrowerForm', [], 'borrowerFormContainer'],
                ['➕', 'Add Loan', 'showForm', [], 'loanFormContainer'],
                ['📋', 'Follow-ups / PTP', 'openFollowupCenter'],
                ['🔔', 'Reminders', 'openReminderCenter', ['all']],
                ['🗓️', 'Calendar', 'openCollectionCalendar'],
                ['💬', 'WhatsApp', 'openWhatsAppCenter']
            ]
        },
        {
            title: 'Analytics',
            items: [
                ['📊', 'Advanced Dashboard', 'openAdvancedDashboard'],
                ['📈', 'Reports', 'openReportsCenter'],
                ['🎯', 'Collection Insights', 'openCollectionInsights'],
                ['🕘', 'Activity History', 'openActivityHistory']
            ]
        },
        {
            title: 'Tools',
            items: [
                ['⏰', 'Due Center', 'openDueCenter', ['overdue']],
                ['🧩', 'Data Quality', 'openDataQualityCenter'],
                ['📥', 'Import / Restore', 'openDataSafetyCenter', ['import']],
                ['♻️', 'Recycle Bin', 'openRecycleBin']
            ]
        },
        {
            title: 'System',
            items: [
                ['⚙️', 'Settings & Rules', 'openSettingsCenter'],
                ['💾', 'Full Backup', 'downloadFullBackup'],
                ['🧰', 'Release & Recovery', 'openReleaseCenter'],
                ['🚪', 'Logout', 'logoutAdmin', [], '', 'danger']
            ]
        }
    ];

    const makeNavButton = (key, icon, label, extra = '') =>
        `<button type="button" class="ui-nav-btn ${extra}" data-ui-destination="${key}" aria-label="${label}">
            <span class="ui-nav-icon" aria-hidden="true">${icon}</span>
            <span class="ui-nav-label">${label}</span>
            ${key === 'collections' ? '<span class="ui-nav-badge ui-collection-badge" hidden>0</span>' : ''}
        </button>`;

    const bottomNav = document.createElement('nav');
    bottomNav.id = 'uiShellBottomNav';
    bottomNav.className = 'ui-bottom-nav no-print';
    bottomNav.setAttribute('aria-label', 'Primary navigation');
    bottomNav.innerHTML = [
        makeNavButton('home', '⌂', 'Home', 'active'),
        makeNavButton('loans', '₹', 'Loans'),
        makeNavButton('collections', '◷', 'Collections'),
        makeNavButton('search', '⌕', 'Search'),
        makeNavButton('more', '☰', 'More')
    ].join('');

    const sidebar = document.createElement('aside');
    sidebar.id = 'uiShellSidebar';
    sidebar.className = 'ui-sidebar no-print';
    sidebar.setAttribute('aria-label', 'Desktop navigation');
    sidebar.innerHTML = `
        <div class="ui-sidebar-brand">
            <span class="ui-sidebar-logo">AT</span>
            <span class="ui-sidebar-brand-text"><strong>AbhiTools</strong><small>Management</small></span>
        </div>
        <div class="ui-sidebar-main">
            ${makeNavButton('home', '⌂', 'Home', 'active')}
            ${makeNavButton('loans', '₹', 'Loans')}
            ${makeNavButton('collections', '◷', 'Collections')}
            ${makeNavButton('search', '⌕', 'Search')}
            ${makeNavButton('more', '☰', 'More')}
        </div>
        <button type="button" id="uiSidebarLogout" class="ui-sidebar-toggle ui-sidebar-logout" aria-label="Logout admin" title="Logout">
            <span aria-hidden="true">🚪</span><span class="ui-sidebar-toggle-text">Logout</span>
        </button>
        <button type="button" id="uiSidebarToggle" class="ui-sidebar-toggle" style="margin-top:8px" aria-label="Expand sidebar" title="Expand/collapse sidebar">
            <span aria-hidden="true">⇥</span><span class="ui-sidebar-toggle-text">Expand</span>
        </button>
    `;

    const overlay = document.createElement('div');
    overlay.id = 'uiMoreOverlay';
    overlay.className = 'ui-more-overlay no-print';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="ui-more-backdrop" data-ui-close-more="yes"></div>
        <section class="ui-more-panel" role="dialog" aria-modal="true" aria-labelledby="uiMoreTitle">
            <header class="ui-more-header">
                <div>
                    <small>All tools</small>
                    <h3 id="uiMoreTitle">More</h3>
                </div>
                <button type="button" class="ui-icon-btn" data-ui-close-more="yes" aria-label="Close menu">✕</button>
            </header>
            <div class="ui-more-content">
                ${groups.map(group => `
                    <section class="ui-more-group">
                        <h4>${group.title}</h4>
                        <div class="ui-more-grid">
                            ${group.items.map(([icon, label, action, args = [], afterId = '', tone = '']) => `
                                <button type="button"
                                    class="ui-more-action ${tone === 'danger' ? 'danger' : ''}"
                                    data-ui-action="${action}"
                                    data-ui-args='${JSON.stringify(args)}'
                                    data-ui-after="${afterId}">
                                    <span aria-hidden="true">${icon}</span>
                                    <b>${label}</b>
                                </button>
                            `).join('')}
                        </div>
                    </section>
                `).join('')}
            </div>
        </section>
    `;

    body.append(sidebar, bottomNav, overlay);

    function setActive(key) {
        document.querySelectorAll('[data-ui-destination]').forEach(btn => {
            const active = btn.dataset.uiDestination === key;
            btn.classList.toggle('active', active);
            if (active) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
    }

    function openMore() {
        overlay.hidden = false;
        body.classList.add('ui-more-open');
        setActive('more');
        window.setTimeout(() => overlay.querySelector('.ui-icon-btn')?.focus(), 0);
    }

    function closeMore() {
        if (!overlay || overlay.hidden) return;
        overlay.hidden = true;
        body.classList.remove('ui-more-open');
    }

    function goHome() {
        closeMore();
        setActive('home');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function goLoans() {
        closeMore();
        setActive('loans');
        if (typeof window.switchTab === 'function') window.switchTab('folder');
        else document.getElementById('tabFolder')?.click();
        window.setTimeout(() => {
            const target = document.getElementById('folderView') || document.querySelector('.search-container') || document.querySelector('.tabs');
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 30);
    }

    function goCollections() {
        closeMore();
        setActive('collections');
        if (typeof window.openReminderCenter === 'function') invoke('openReminderCenter', ['all']);
        else invoke('openDueCenter', ['overdue']);
    }

    function goSearch() {
        closeMore();
        setActive('search');
        if (typeof window.openAdvancedSearch === 'function') {
            invoke('openAdvancedSearch');
            return;
        }
        const input = document.getElementById('searchInput');
        input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => input?.focus(), 120);
    }

    function handleDestination(key) {
        if (key === 'home') goHome();
        else if (key === 'loans') goLoans();
        else if (key === 'collections') goCollections();
        else if (key === 'search') goSearch();
        else if (key === 'more') openMore();
    }

    function showShellToast(message) {
        let toast = document.getElementById('uiShellToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'uiShellToast';
            toast.className = 'ui-shell-toast no-print';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(showShellToast.timer);
        showShellToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
    }

    function syncReminderBadge() {
        const source = document.getElementById('reminderActionBadge');
        const badges = Array.from(document.querySelectorAll('.ui-collection-badge'));
        if (!badges.length || !source) return;
        const count = Number.parseInt(source.textContent || '0', 10) || 0;
        badges.forEach(badge => {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.hidden = count <= 0;
        });
    }

    document.addEventListener('click', event => {
        const destination = event.target.closest('[data-ui-destination]');
        if (destination) {
            event.preventDefault();
            handleDestination(destination.dataset.uiDestination || 'home');
            return;
        }

        const close = event.target.closest('[data-ui-close-more="yes"]');
        if (close) {
            event.preventDefault();
            closeMore();
            return;
        }

        const action = event.target.closest('.ui-more-action');
        if (action) {
            event.preventDefault();
            let args = [];
            try { args = JSON.parse(action.dataset.uiArgs || '[]'); } catch {}
            invoke(action.dataset.uiAction || '', args, action.dataset.uiAfter || '');
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !overlay.hidden) {
            closeMore();
            document.querySelector('[data-ui-destination="more"]')?.focus();
        }
    });

    const sidebarLogout = document.getElementById('uiSidebarLogout');
    sidebarLogout?.addEventListener('click', () => invoke('logoutAdmin'));

    const sidebarToggle = document.getElementById('uiSidebarToggle');
    const savedExpanded = localStorage.getItem(STORAGE_KEY) === 'yes';
    body.classList.toggle('ui-sidebar-expanded', savedExpanded);

    sidebarToggle?.addEventListener('click', () => {
        const expanded = !body.classList.contains('ui-sidebar-expanded');
        body.classList.toggle('ui-sidebar-expanded', expanded);
        localStorage.setItem(STORAGE_KEY, expanded ? 'yes' : 'no');
        sidebarToggle.setAttribute('aria-label', expanded ? 'Collapse sidebar' : 'Expand sidebar');
        const label = sidebarToggle.querySelector('.ui-sidebar-toggle-text');
        if (label) label.textContent = expanded ? 'Collapse' : 'Expand';
    });

    const reminderSource = document.getElementById('reminderActionBadge');
    if (reminderSource) {
        new MutationObserver(syncReminderBadge).observe(reminderSource, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['style']
        });
        syncReminderBadge();
    }

    async function syncStableReleaseMeta() {
        const fallback = { release:'2.3.1', label:'V2.3.1 Stable', backup_format_version:7, release_date:'2026-08-25' };
        let manifest = fallback;
        try {
            const response = await fetch('/version.json', { cache:'no-store', credentials:'same-origin' });
            if (response.ok) manifest = { ...fallback, ...(await response.json()) };
        } catch {}

        const version = String(manifest.release || fallback.release);
        const label = String(manifest.label || `V${version} Stable`);
        const backupVersion = Math.max(1, Number(manifest.backup_format_version || fallback.backup_format_version));
        const set = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
        set('releaseVersionBadge', label);
        set('releaseStableLabel', label);
        set('releaseVersionCode', version);
        set('releaseHealthVersion', version);
        set('releaseBackupFormat', `v${backupVersion}`);

        const releaseMeta = document.getElementById('releaseCenterMeta');
        if (releaseMeta) {
            releaseMeta.textContent = `${label} • released ${manifest.release_date || fallback.release_date} • production recovery toolkit`;
        }

        document.querySelectorAll('.settings-status-panel > div').forEach(tile => {
            const title = tile.querySelector('small');
            const value = tile.querySelector('strong');
            if (title && value && title.textContent.trim().toLowerCase() === 'backup format') {
                value.textContent = `v${backupVersion} • settings included`;
            }
        });

        document.querySelectorAll('.release-checklist > div').forEach(row => {
            if (/App settings backup format v\d+/i.test(row.textContent || '')) {
                row.innerHTML = `<span>✓</span> App settings backup format v${backupVersion} me snapshots ke saath included hain.`;
            }
        });
    }

    syncStableReleaseMeta();

    // Hide the old giant top-level controls only after the replacement shell is fully available.
    body.classList.add('ui-shell-ready');
})();
