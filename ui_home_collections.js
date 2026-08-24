// AbhiTools Design Build 3 — compact Home + Collections presentation layer only.
(() => {
    'use strict';

    if (!document.body?.classList.contains('has-mobile-app-nav')) return;
    if (window.__ABHITOOLS_HOME_COLLECTIONS_UI_V3__) return;
    window.__ABHITOOLS_HOME_COLLECTIONS_UI_V3__ = true;

    const esc = value => typeof escapeHtml === 'function'
        ? escapeHtml(value)
        : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
    const money = value => `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
    const validIso = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
    let collectionTab = 'priority';
    let collectionRefreshing = false;
    let corePatched = false;

    function formatDate(value) {
        const raw = String(value || '').slice(0, 10);
        if (!validIso(raw)) return raw || 'Date not set';
        const d = new Date(`${raw}T00:00:00Z`);
        return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
    }

    function homeSummary() {
        const due = (typeof dueCenterData !== 'undefined' && dueCenterData?.summary) ? dueCenterData.summary : {};
        const home = (typeof homeCommandData !== 'undefined' && homeCommandData) ? homeCommandData : {};
        return {
            businessDate: home?.businessDate || (typeof dueCenterData !== 'undefined' ? dueCenterData?.businessDate : '') || '',
            overdue: due.overdue || { amount:0, count:0 },
            today: due.today || { amount:0, count:0 },
            next7: due.next7 || { amount:0, count:0 },
            month: due.month || { amount:0, count:0 },
            todayCollected: Number(home?.money?.todayCollected || 0),
            priorities: Array.isArray(home?.priorities) ? home.priorities : [],
            recentActivity: Array.isArray(home?.recentActivity) ? home.recentActivity : [],
            summary: home?.summary || {}
        };
    }

    function ensureHomeMount() {
        let section = document.getElementById('uiCompactHome');
        if (section) return section;
        section = document.createElement('section');
        section.id = 'uiCompactHome';
        section.className = 'ui-home no-print';
        const header = document.querySelector('.header-container');
        if (header?.parentNode) header.insertAdjacentElement('afterend', section);
        else document.body.prepend(section);
        return section;
    }

    function homePriorityRow(item) {
        const overdue = validIso(item?.due_date) && validIso(homeSummary().businessDate) && String(item.due_date).slice(0,10) < String(homeSummary().businessDate).slice(0,10);
        const hasContact = Boolean(item?.has_contact || item?.phone || item?.whatsapp);
        return `<article class="ui-home-priority ${overdue ? 'overdue' : ''}">
            <div class="ui-home-priority-main">
                <div><strong>${esc(item?.borrower_name || 'Borrower')}</strong><span>${esc(item?.loan_code || '')} • EMI #${Number(item?.installment_number || 0)}</span></div>
                <small>${formatDate(item?.due_date)} • ${money(item?.remaining)} remaining${Number(item?.paid || 0) ? ` • ${money(item.paid)} paid` : ''}</small>
            </div>
            <div class="ui-home-priority-actions">
                ${item?.emi_id ? `<button class="btn btn-success" onclick="uiHomeCollectionsAction('pay','${esc(item.emi_id)}')">Pay</button>` : ''}
                ${hasContact ? `<button class="btn btn-view" onclick="uiHomeCollectionsAction('whatsapp','${esc(item.emi_id || '')}','${esc(item.borrower_id || '')}','${overdue ? 'overdue' : 'due'}')">💬</button>` : ''}
                ${item?.borrower_id ? `<button class="btn btn-secondary" onclick="uiHomeCollectionsAction('profile','${esc(item.borrower_id)}')">👤</button>` : ''}
            </div>
        </article>`;
    }

    function renderCompactHome() {
        const section = ensureHomeMount();
        const data = homeSummary();
        const priorityRows = data.priorities.slice(0, 3);
        const urgentCount = Number(data.overdue.count || 0) + Number(data.today.count || 0);
        const followupCount = Number(data.summary?.uncontactedUrgent || 0);
        section.innerHTML = `
            <header class="ui-home-head">
                <div><small>TODAY • ${esc(data.businessDate ? formatDate(data.businessDate) : 'Business date')}</small><h2>Collection Snapshot</h2><p>${urgentCount ? `${urgentCount} urgent EMI action${urgentCount === 1 ? '' : 's'} today` : 'No urgent dated EMI action right now'}${followupCount ? ` • ${followupCount} follow-up pending` : ''}</p></div>
                <button type="button" class="ui-home-refresh" onclick="uiRefreshHomeCollections()" aria-label="Refresh home summary">↻</button>
            </header>
            <div class="ui-home-kpis">
                <button type="button" class="ui-home-kpi danger" onclick="uiOpenCollectionsHub('overdue')"><small>Overdue</small><strong>${money(data.overdue.amount)}</strong><span>${Number(data.overdue.count || 0)} EMI</span></button>
                <button type="button" class="ui-home-kpi today" onclick="uiOpenCollectionsHub('today')"><small>Due Today</small><strong>${money(data.today.amount)}</strong><span>${Number(data.today.count || 0)} EMI</span></button>
                <button type="button" class="ui-home-kpi upcoming" onclick="uiOpenCollectionsHub('upcoming')"><small>Next 7 Days</small><strong>${money(data.next7.amount)}</strong><span>${Number(data.next7.count || 0)} EMI</span></button>
                <button type="button" class="ui-home-kpi collected" onclick="uiHomeCollectionsAction('activity')"><small>Collected Today</small><strong>${money(data.todayCollected)}</strong><span>View activity</span></button>
            </div>
            <div class="ui-home-actions" aria-label="Quick actions">
                <button type="button" onclick="uiHomeCollectionsAction('borrower')"><span>＋</span>Add Borrower</button>
                <button type="button" onclick="uiHomeCollectionsAction('loan')"><span>₹</span>Add Loan</button>
                <button type="button" onclick="uiOpenCollectionsHub('priority')"><span>◷</span>Collections</button>
                <button type="button" onclick="uiHomeCollectionsAction('search')"><span>⌕</span>Search</button>
            </div>
            <section class="ui-home-queue">
                <div class="ui-home-section-head"><div><small>Priority queue</small><strong>${priorityRows.length ? 'Action now' : 'Queue clear'}</strong></div><button type="button" onclick="uiOpenCollectionsHub('priority')">View all</button></div>
                <div class="ui-home-priority-list">${priorityRows.length ? priorityRows.map(homePriorityRow).join('') : '<div class="ui-home-empty">✓ No dated urgent/upcoming item in the current priority feed.</div>'}</div>
            </section>
        `;
        document.body.classList.add('ui-home-ready');
    }

    function closeMoreIfOpen() {
        const more = document.getElementById('uiMoreOverlay');
        if (more && !more.hidden) more.hidden = true;
        document.body.classList.remove('ui-more-open');
    }

    function closeLoanDetailIfOpen() {
        if (typeof window.uiCloseLoanDetail === 'function') window.uiCloseLoanDetail();
    }

    function setCollectionsNavActive() {
        document.querySelectorAll('[data-ui-destination]').forEach(btn => {
            const active = btn.dataset.uiDestination === 'collections';
            btn.classList.toggle('active', active);
            if (active) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
    }

    function closeCollectionsHub() {
        document.getElementById('uiCollectionsOverlay')?.remove();
        document.body.classList.remove('ui-collections-open');
    }

    function ensureCollectionsOverlay() {
        closeCollectionsHub();
        closeMoreIfOpen();
        closeLoanDetailIfOpen();
        const overlay = document.createElement('div');
        overlay.id = 'uiCollectionsOverlay';
        overlay.className = 'ui-collections-overlay no-print';
        overlay.innerHTML = `<div class="ui-collections-backdrop" data-ui-collections-close="yes"></div><section class="ui-collections-panel" role="dialog" aria-modal="true" aria-labelledby="uiCollectionsTitle"><div id="uiCollectionsMount"></div></section>`;
        document.body.appendChild(overlay);
        document.body.classList.add('ui-collections-open');
        setCollectionsNavActive();
        return overlay;
    }

    function dueBucketItems(bucket) {
        const buckets = (typeof dueCenterData !== 'undefined' && dueCenterData?.buckets) ? dueCenterData.buckets : {};
        if (bucket === 'priority') {
            const seen = new Set();
            return [...(buckets.overdue || []), ...(buckets.today || [])].filter(x => {
                const key = x.emi_id || `${x.loan_code}-${x.installment_number}-${x.due_date}`;
                if (seen.has(key)) return false;
                seen.add(key); return true;
            });
        }
        if (bucket === 'upcoming') {
            const seen = new Set();
            return [...(buckets.tomorrow || []), ...(buckets.next7 || [])].filter(x => {
                const key = x.emi_id || `${x.loan_code}-${x.installment_number}-${x.due_date}`;
                if (seen.has(key)) return false;
                seen.add(key); return true;
            });
        }
        return [...(buckets[bucket] || [])];
    }

    function dueContext(item) {
        if (item?.emi_id && typeof findEmiContext === 'function') {
            const ctx = findEmiContext(item.emi_id);
            if (ctx) return {
                borrowerId: ctx.loan?.borrower_id || ctx.loan?.borrowers?.id || item.borrower_id || '',
                loanId: ctx.loan?.id || item.loan_id || '',
                borrower: ctx.loan?.borrowers || {},
                loan: ctx.loan || {}
            };
        }
        return { borrowerId:item?.borrower_id || '', loanId:item?.loan_id || '', borrower:{}, loan:{} };
    }

    function dueRow(item, bucket) {
        const ctx = dueContext(item);
        const paid = Math.max(0, Number(item?.paid_amount || item?.paid || 0));
        const remaining = Math.max(0, Number(item?.remaining || 0));
        const isOverdue = bucket === 'overdue' || (validIso(item?.due_date) && validIso(typeof dueCenterData !== 'undefined' ? dueCenterData?.businessDate : '') && String(item.due_date).slice(0,10) < String(dueCenterData.businessDate).slice(0,10));
        const hasContact = Boolean(item?.has_contact || ctx.borrower?.whatsapp || ctx.borrower?.phone || item?.whatsapp || item?.phone);
        return `<article class="ui-collection-row ${isOverdue ? 'overdue' : ''}">
            <div class="ui-collection-date"><strong>${esc(formatDate(item?.due_date))}</strong><span>${isOverdue ? 'OVERDUE' : bucket === 'today' ? 'TODAY' : 'DUE'}</span></div>
            <div class="ui-collection-main"><div><strong>${esc(item?.borrower_name || ctx.borrower?.name || 'Borrower')}</strong><span>${esc(item?.loan_code || ctx.loan?.loan_code || '')} • EMI #${Number(item?.installment_number || 0)}</span></div><small>${paid ? `${money(paid)} paid • ` : ''}${money(remaining)} remaining</small></div>
            <div class="ui-collection-actions">
                ${item?.emi_id ? `<button class="btn btn-success" onclick="uiHomeCollectionsAction('pay','${esc(item.emi_id)}')">Pay</button>` : ''}
                ${hasContact && item?.emi_id ? `<button class="btn btn-view" onclick="uiHomeCollectionsAction('whatsapp','${esc(item.emi_id)}','${esc(ctx.borrowerId)}','${isOverdue ? 'overdue' : 'due'}')">💬</button>` : ''}
                ${ctx.borrowerId ? `<button class="btn btn-secondary" onclick="uiHomeCollectionsAction('followup','${esc(ctx.borrowerId)}','${esc(ctx.loanId)}','${esc(item?.emi_id || '')}')">📋</button>` : ''}
            </div>
        </article>`;
    }

    function ptpRows() {
        const items = (typeof followupCenterData !== 'undefined' && Array.isArray(followupCenterData?.items)) ? followupCenterData.items : [];
        return items.filter(item => item.promise_status && item.promise_status !== 'none' && (item.status === 'open' || ['pending','broken'].includes(item.promise_status)))
            .sort((a,b) => String(a.promise_date || a.next_followup_date || '9999').localeCompare(String(b.promise_date || b.next_followup_date || '9999')));
    }

    function ptpRow(item) {
        const broken = item.promise_status === 'broken';
        return `<article class="ui-collection-row ptp ${broken ? 'overdue' : ''}">
            <div class="ui-collection-date"><strong>${esc(formatDate(item.promise_date || item.next_followup_date))}</strong><span>${broken ? 'BROKEN PTP' : 'PTP'}</span></div>
            <div class="ui-collection-main"><div><strong>${esc(item.borrower_name || 'Borrower')}</strong><span>${esc(item.loan_code || 'Borrower-level')} ${item.installment_number ? `• EMI #${Number(item.installment_number)}` : ''}</span></div><small>${money(item.promise_amount)} promised${item.notes ? ` • ${esc(item.notes).slice(0,80)}` : ''}</small></div>
            <div class="ui-collection-actions">
                ${item.emi_id && Number(item.emi_remaining || 0) > 0 ? `<button class="btn btn-success" onclick="uiHomeCollectionsAction('pay','${esc(item.emi_id)}')">Pay</button>` : ''}
                <button class="btn btn-view" onclick="uiHomeCollectionsAction('followups','${esc(item.borrower_id || '')}')">Open</button>
                ${item.borrower_id ? `<button class="btn btn-secondary" onclick="uiHomeCollectionsAction('profile','${esc(item.borrower_id)}')">👤</button>` : ''}
            </div>
        </article>`;
    }

    function collectionsCounts() {
        const s = (typeof dueCenterData !== 'undefined' && dueCenterData?.summary) ? dueCenterData.summary : {};
        const f = (typeof followupCenterData !== 'undefined' && followupCenterData?.summary) ? followupCenterData.summary : {};
        return {
            overdue: s.overdue || { count:0, amount:0 },
            today: s.today || { count:0, amount:0 },
            next7: s.next7 || { count:0, amount:0 },
            legacy: s.yearNotSet || { count:0, amount:0 },
            ptp: ptpRows().length
        };
    }

    function renderCollectionsBody() {
        const list = document.getElementById('uiCollectionsList');
        if (!list) return;
        let rows = '';
        if (collectionTab === 'ptp') {
            const items = ptpRows();
            rows = items.length ? items.map(ptpRow).join('') : '<div class="ui-collections-empty">✓ No open Promise-to-Pay item in this view.</div>';
        } else {
            const items = dueBucketItems(collectionTab);
            rows = items.length ? items.map(item => dueRow(item, collectionTab)).join('') : '<div class="ui-collections-empty">✓ Is queue me koi dated EMI nahi hai.</div>';
        }
        list.innerHTML = rows;
        document.querySelectorAll('[data-ui-collection-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.uiCollectionTab === collectionTab));
    }

    function renderCollectionsHub() {
        const mount = document.getElementById('uiCollectionsMount');
        if (!mount) return;
        const counts = collectionsCounts();
        const businessDate = (typeof dueCenterData !== 'undefined' ? dueCenterData?.businessDate : '') || '';
        mount.innerHTML = `
            <header class="ui-collections-head">
                <div><small>COLLECTIONS • ${esc(businessDate ? formatDate(businessDate) : 'Business date')}</small><h3 id="uiCollectionsTitle">Collections Hub</h3><p>Due, reminder and PTP actions in one workspace. Financial logic remains unchanged.</p></div>
                <div class="ui-collections-head-actions"><button type="button" class="ui-collections-refresh" onclick="uiRefreshCollectionsHub()" aria-label="Refresh Collections Hub">↻</button><button type="button" class="ui-collections-close" data-ui-collections-close="yes" aria-label="Close Collections Hub">✕</button></div>
            </header>
            <div class="ui-collections-summary">
                <button onclick="uiSetCollectionsTab('overdue')"><small>Overdue</small><strong>${money(counts.overdue.amount)}</strong><span>${Number(counts.overdue.count || 0)} EMI</span></button>
                <button onclick="uiSetCollectionsTab('today')"><small>Today</small><strong>${money(counts.today.amount)}</strong><span>${Number(counts.today.count || 0)} EMI</span></button>
                <button onclick="uiSetCollectionsTab('upcoming')"><small>Next 7</small><strong>${money(counts.next7.amount)}</strong><span>${Number(counts.next7.count || 0)} EMI</span></button>
                <button onclick="uiSetCollectionsTab('ptp')"><small>PTP Action</small><strong>${Number(counts.ptp || 0)}</strong><span>open/action</span></button>
            </div>
            <nav class="ui-collections-tabs" aria-label="Collections filters">
                <button data-ui-collection-tab="priority" onclick="uiSetCollectionsTab('priority')">Priority</button>
                <button data-ui-collection-tab="overdue" onclick="uiSetCollectionsTab('overdue')">Overdue</button>
                <button data-ui-collection-tab="today" onclick="uiSetCollectionsTab('today')">Today</button>
                <button data-ui-collection-tab="upcoming" onclick="uiSetCollectionsTab('upcoming')">Upcoming</button>
                <button data-ui-collection-tab="ptp" onclick="uiSetCollectionsTab('ptp')">PTP</button>
            </nav>
            ${Number(counts.legacy.count || 0) > 0 ? `<div class="ui-collections-legacy">🧩 ${Number(counts.legacy.count)} legacy EMI date incomplete • ${money(counts.legacy.amount)} remaining. These records are intentionally excluded from automatic overdue/today queues.</div>` : ''}
            <div id="uiCollectionsLoading" class="ui-collections-loading" hidden>Refreshing collection data…</div>
            <div id="uiCollectionsList" class="ui-collections-list"></div>
            <footer class="ui-collections-footer"><button class="btn btn-view" onclick="uiHomeCollectionsAction('reminders')">🔔 Reminder Center</button><button class="btn btn-secondary" onclick="uiHomeCollectionsAction('followups')">📋 Follow-up Center</button><button class="btn btn-view" onclick="uiHomeCollectionsAction('calendar')">🗓️ Calendar</button></footer>
        `;
        renderCollectionsBody();
    }

    async function refreshCollectionsHub() {
        if (collectionRefreshing) return;
        collectionRefreshing = true;
        const loading = document.getElementById('uiCollectionsLoading');
        if (loading) loading.hidden = false;
        try {
            const tasks = [];
            if (typeof refreshDueData === 'function') tasks.push(refreshDueData().then(data => { if (typeof dueCenterData !== 'undefined') dueCenterData = data; }));
            if (typeof adminFetch === 'function') {
                tasks.push(adminFetch('/api/dashboard?mode=reminders', { cache:'no-store' }).then(r => r.json()).then(data => { if (typeof reminderCenterData !== 'undefined') reminderCenterData = data; }));
                tasks.push(adminFetch('/api/dashboard?mode=followups', { cache:'no-store' }).then(r => r.json()).then(data => { if (typeof followupCenterData !== 'undefined') followupCenterData = data; }));
            }
            await Promise.all(tasks);
            renderCollectionsHub();
            renderCompactHome();
        } catch (error) {
            console.warn('Collections Hub refresh failed:', error);
            if (loading) { loading.hidden = false; loading.textContent = 'Refresh failed. Existing loaded data is still shown.'; }
        } finally {
            collectionRefreshing = false;
        }
    }

    function openCollectionsHub(tab = 'priority') {
        collectionTab = ['priority','overdue','today','upcoming','ptp'].includes(tab) ? tab : 'priority';
        ensureCollectionsOverlay();
        renderCollectionsHub();
        refreshCollectionsHub();
        window.setTimeout(() => document.querySelector('.ui-collections-close')?.focus(), 0);
    }

    function setCollectionsTab(tab) {
        collectionTab = ['priority','overdue','today','upcoming','ptp'].includes(tab) ? tab : 'priority';
        renderCollectionsBody();
    }

    async function refreshHomeCollections() {
        const btn = document.querySelector('.ui-home-refresh');
        if (btn) btn.disabled = true;
        try {
            if (typeof loadAllData === 'function') await loadAllData();
            else renderCompactHome();
        } catch (error) {
            console.warn('Compact Home refresh failed:', error);
        } finally {
            if (btn) btn.disabled = false;
            renderCompactHome();
        }
    }

    window.uiOpenCollectionsHub = openCollectionsHub;
    window.uiCloseCollectionsHub = closeCollectionsHub;
    window.uiSetCollectionsTab = setCollectionsTab;
    window.uiRefreshCollectionsHub = refreshCollectionsHub;
    window.uiRefreshHomeCollections = refreshHomeCollections;
    window.uiHomeCollectionsAction = function(action, id = '', aux = '', extra = '') {
        closeCollectionsHub();
        window.setTimeout(() => {
            if (action === 'borrower' && typeof showBorrowerForm === 'function') showBorrowerForm();
            else if (action === 'loan' && typeof showForm === 'function') showForm();
            else if (action === 'search' && typeof openAdvancedSearch === 'function') openAdvancedSearch();
            else if (action === 'activity' && typeof openActivityHistory === 'function') openActivityHistory();
            else if (action === 'pay' && typeof openPaymentModal === 'function') openPaymentModal(id);
            else if (action === 'profile' && typeof openBorrowerProfile === 'function') openBorrowerProfile(id);
            else if (action === 'whatsapp' && typeof openWhatsAppCenter === 'function') {
                let borrowerId = aux || '';
                let loanId = '';
                if (id && typeof findEmiContext === 'function') {
                    const ctx = findEmiContext(id);
                    if (ctx) { borrowerId = borrowerId || ctx.loan?.borrower_id || ctx.loan?.borrowers?.id || ''; loanId = ctx.loan?.id || ''; }
                }
                openWhatsAppCenter({ borrowerId, loanId, emiId:id, template:extra || 'due' });
            }
            else if (action === 'followup' && typeof openFollowupCenter === 'function') openFollowupCenter({ borrowerId:id, loanId:aux || '', emiId:extra || '', showForm:true });
            else if (action === 'followups' && typeof openFollowupCenter === 'function') openFollowupCenter(id ? { borrowerId:id } : {});
            else if (action === 'reminders' && typeof openReminderCenter === 'function') openReminderCenter('all');
            else if (action === 'calendar' && typeof openCollectionCalendar === 'function') openCollectionCalendar();
        }, 20);
    };

    function patchCoreRenderers() {
        if (corePatched) return true;
        if (typeof updateDashboard !== 'function' || typeof renderHomeCommandCenter !== 'function') return false;
        corePatched = true;

        const oldUpdateDashboard = updateDashboard;
        updateDashboard = function(...args) {
            const result = oldUpdateDashboard.apply(this, args);
            window.setTimeout(renderCompactHome, 0);
            return result;
        };

        const oldRenderHome = renderHomeCommandCenter;
        renderHomeCommandCenter = function(...args) {
            const result = oldRenderHome.apply(this, args);
            window.setTimeout(renderCompactHome, 0);
            return result;
        };

        if (typeof renderReminderCenter === 'function') {
            const oldReminder = renderReminderCenter;
            renderReminderCenter = function(...args) {
                const result = oldReminder.apply(this, args);
                window.setTimeout(() => { if (document.getElementById('uiCollectionsOverlay')) renderCollectionsHub(); }, 0);
                return result;
            };
        }

        if (typeof renderFollowupCenter === 'function') {
            const oldFollowup = renderFollowupCenter;
            renderFollowupCenter = function(...args) {
                const result = oldFollowup.apply(this, args);
                window.setTimeout(() => { if (document.getElementById('uiCollectionsOverlay')) renderCollectionsHub(); }, 0);
                return result;
            };
        }
        return true;
    }

    // Collections bottom-nav gets the new hub; other destinations close it and keep the Build 1 shell behavior.
    document.addEventListener('click', event => {
        const destination = event.target.closest('[data-ui-destination]');
        if (destination?.dataset.uiDestination === 'collections') {
            event.preventDefault();
            event.stopImmediatePropagation();
            openCollectionsHub('priority');
            return;
        }
        if (destination && destination.dataset.uiDestination !== 'collections') closeCollectionsHub();
    }, true);

    document.addEventListener('click', event => {
        const close = event.target.closest('[data-ui-collections-close="yes"]');
        if (close) { event.preventDefault(); closeCollectionsHub(); }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById('uiCollectionsOverlay')) closeCollectionsHub();
    });

    let tries = 0;
    const boot = () => {
        tries += 1;
        const patched = patchCoreRenderers();
        if (patched) {
            renderCompactHome();
            return;
        }
        if (tries < 40) window.setTimeout(boot, 100);
    };
    boot();
})();
