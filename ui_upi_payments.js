// AbhiTools final layer — public UPI repayment requests + admin verification + sync feedback.
// Safety rule: opening a UPI app NEVER marks an EMI paid. Only admin confirmation updates the ledger.
(() => {
    'use strict';

    if (window.__ABHITOOLS_UPI_REQUESTS_V1__) return;
    window.__ABHITOOLS_UPI_REQUESTS_V1__ = true;

    const body = document.body;
    const path = window.location.pathname;
    const isAdmin = /(?:^|\/)admin\.html$/i.test(path);
    const isPublic = !isAdmin && (body?.classList.contains('public-page') || path === '/' || /(?:^|\/)index\.html$/i.test(path));
    const money = value => `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

    function injectStyles() {
        if (document.getElementById('abhiUpiPaymentStyles')) return;
        const style = document.createElement('style');
        style.id = 'abhiUpiPaymentStyles';
        style.textContent = `
            /* Restore compact sync status on public mobile. */
            body.public-page #lastUpdatedBadge {
                display:block!important; min-width:68px; max-width:92px; padding:5px 7px!important;
                border-radius:9px!important; font-size:9px!important; line-height:1.25!important;
                white-space:normal; box-shadow:0 2px 8px rgba(26,115,232,.12);
            }
            @media(max-width:420px){
                body.public-page #lastUpdatedBadge{min-width:62px;max-width:76px;font-size:8.3px!important;padding:5px!important}
                body.public-page .header-container h2{font-size:14px!important}
            }

            #publicSyncLoader {
                position:fixed; z-index:31990; left:50%; top:50%; transform:translate(-50%,-50%);
                display:flex; align-items:center; gap:10px; padding:11px 15px; border:1px solid #dbeafe;
                border-radius:999px; background:rgba(255,255,255,.96); color:#1e3a8a;
                box-shadow:0 12px 35px rgba(15,23,42,.18); font:700 12px/1.2 ui-sans-serif,system-ui,sans-serif;
                backdrop-filter:blur(10px); pointer-events:none;
            }
            #publicSyncLoader[hidden]{display:none!important}
            .abhi-sync-ring { width:19px; height:19px; border:3px solid #bfdbfe; border-top-color:#2563eb; border-radius:50%; animation:abhiUpiSpin .75s linear infinite; }
            @keyframes abhiUpiSpin { to { transform:rotate(360deg); } }
            body.dark-mode #publicSyncLoader{background:rgba(17,24,39,.96);color:#dbeafe;border-color:#334155}

            .upi-public-actions { margin-top:8px; display:flex; align-items:center; justify-content:flex-end; gap:7px; flex-wrap:wrap; }
            .upi-public-pay {
                min-height:38px; border:0; border-radius:10px; padding:8px 12px; cursor:pointer;
                background:linear-gradient(135deg,#16a34a,#15803d); color:#fff; font:800 12px/1.15 ui-sans-serif,system-ui,sans-serif;
                box-shadow:0 3px 10px rgba(22,163,74,.2);
            }
            .upi-public-pay:disabled{opacity:.62;cursor:wait}
            .upi-public-pending { display:inline-flex; align-items:center; gap:5px; padding:6px 9px; border-radius:999px; background:#fff7ed; color:#9a3412; border:1px solid #fed7aa; font-size:10.5px; font-weight:800; }
            .upi-public-unavailable { color:#64748b; font-size:10px; font-weight:650; }
            body.dark-mode .upi-public-pending{background:#431407;color:#fed7aa;border-color:#7c2d12}
            body.dark-mode .upi-public-unavailable{color:#94a3b8}

            .upi-public-notice {
                position:fixed; z-index:33000; left:10px; right:10px; bottom:calc(76px + env(safe-area-inset-bottom));
                max-width:520px; margin:auto; border:1px solid #bbf7d0; border-radius:14px; padding:12px;
                background:#f0fdf4; color:#14532d; box-shadow:0 16px 44px rgba(15,23,42,.24);
                font:600 12px/1.45 ui-sans-serif,system-ui,sans-serif;
            }
            .upi-public-notice strong{display:block;font-size:13px;margin-bottom:3px}
            .upi-public-notice small{display:block;color:#166534;margin-top:4px}
            .upi-public-notice .upi-notice-actions{display:flex;gap:7px;margin-top:9px;flex-wrap:wrap}
            .upi-public-notice button{min-height:36px;border:0;border-radius:9px;padding:7px 10px;font-weight:750;cursor:pointer}
            .upi-public-notice .copy{background:#dcfce7;color:#166534}.upi-public-notice .close{background:#e5e7eb;color:#374151}
            body.dark-mode .upi-public-notice{background:#052e16;color:#dcfce7;border-color:#166534}
            body.dark-mode .upi-public-notice small{color:#86efac}

            .upi-admin-widget {
                margin:0 0 12px; padding:10px 12px; border:1px solid #bfdbfe; border-radius:12px;
                background:linear-gradient(135deg,#eff6ff,#f8fafc); display:flex; align-items:center; justify-content:space-between; gap:10px;
            }
            .upi-admin-widget>div{min-width:0}.upi-admin-widget strong,.upi-admin-widget small{display:block}.upi-admin-widget strong{font-size:13px;color:#1e3a8a}.upi-admin-widget small{font-size:10px;color:#64748b;margin-top:2px}
            .upi-admin-widget button{min-height:40px;border:0;border-radius:10px;padding:8px 12px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;white-space:nowrap}
            .upi-admin-count{display:inline-grid;place-items:center;min-width:22px;height:22px;margin-left:5px;padding:0 6px;border-radius:999px;background:#fff;color:#1d4ed8;font-size:10px}
            body.dark-mode .upi-admin-widget{background:#172033;border-color:#334155}.dark-mode .upi-admin-widget strong{color:#dbeafe}.dark-mode .upi-admin-widget small{color:#94a3b8}

            .upi-admin-overlay { position:fixed; inset:0; z-index:31000; background:rgba(15,23,42,.72); backdrop-filter:blur(4px); display:flex; align-items:flex-start; justify-content:center; padding:12px; overflow:auto; }
            .upi-admin-panel { width:min(980px,100%); max-height:calc(100dvh - 24px); overflow:auto; border-radius:18px; background:#fff; color:#0f172a; box-shadow:0 28px 80px rgba(0,0,0,.38); }
            .upi-admin-head { position:sticky; top:0; z-index:5; display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding:14px; border-bottom:1px solid #e2e8f0; background:rgba(255,255,255,.97); backdrop-filter:blur(10px); }
            .upi-admin-head h3{margin:0;font-size:17px}.upi-admin-head small{display:block;margin-top:3px;color:#64748b;font-size:10px}.upi-admin-head-actions{display:flex;gap:7px}.upi-admin-head button{min-height:38px;border:0;border-radius:9px;padding:7px 10px;cursor:pointer;font-weight:750}.upi-admin-refresh{background:#e0f2fe;color:#075985}.upi-admin-close{background:#fee2e2;color:#991b1b}
            .upi-admin-body{padding:13px;display:grid;gap:12px}
            .upi-config-card,.upi-request-card{border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:12px}
            .upi-config-card h4{margin:0 0 8px;font-size:13px}.upi-config-grid{display:grid;grid-template-columns:1.2fr 1fr auto;gap:8px;align-items:end}.upi-config-grid label span{display:block;font-size:10px;color:#64748b;font-weight:750;margin-bottom:4px}.upi-config-grid input[type=text]{width:100%;min-height:42px;padding:8px 9px;border:1px solid #cbd5e1;border-radius:9px;font:600 13px inherit}.upi-config-toggle{min-height:42px;display:flex!important;align-items:center;gap:7px;padding:0 8px;border:1px solid #cbd5e1;border-radius:9px}.upi-config-toggle span{margin:0!important}.upi-config-save{min-height:42px;border:0;border-radius:9px;padding:8px 12px;background:#16a34a;color:#fff;font-weight:800;cursor:pointer}
            .upi-config-note{margin-top:7px;padding:8px 9px;border-radius:9px;background:#f8fafc;color:#475569;font-size:10.5px;line-height:1.45}
            .upi-admin-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.upi-admin-summary>div{border:1px solid #e2e8f0;border-radius:11px;padding:9px;background:#f8fafc}.upi-admin-summary small,.upi-admin-summary strong{display:block}.upi-admin-summary small{font-size:9px;color:#64748b}.upi-admin-summary strong{font-size:18px;margin-top:2px}
            .upi-admin-filter{display:flex;gap:7px;overflow-x:auto}.upi-admin-filter button{flex:0 0 auto;min-height:36px;border:1px solid #cbd5e1;border-radius:999px;padding:6px 10px;background:#fff;color:#475569;font-weight:750;cursor:pointer}.upi-admin-filter button.active{background:#2563eb;color:#fff;border-color:#2563eb}
            .upi-request-list{display:grid;gap:8px}.upi-request-empty{text-align:center;padding:18px;color:#64748b;font-size:12px}.upi-request-card{display:grid;gap:9px}.upi-request-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.upi-request-title strong,.upi-request-title small{display:block}.upi-request-title strong{font-size:13px}.upi-request-title small{font-size:10px;color:#64748b;margin-top:2px}.upi-request-status{padding:5px 8px;border-radius:999px;font-size:9px;font-weight:850;text-transform:uppercase}.upi-request-status.pending{background:#fff7ed;color:#9a3412}.upi-request-status.confirmed{background:#f0fdf4;color:#166534}.upi-request-status.rejected{background:#fef2f2;color:#991b1b}.upi-request-status.expired{background:#f1f5f9;color:#475569}
            .upi-request-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.upi-request-meta>div{padding:7px 8px;border-radius:9px;background:#f8fafc}.upi-request-meta small,.upi-request-meta strong{display:block}.upi-request-meta small{font-size:8.5px;color:#64748b}.upi-request-meta strong{font-size:11.5px;margin-top:2px;word-break:break-word}
            .upi-confirm-grid{display:grid;grid-template-columns:120px 145px minmax(160px,1fr) auto auto;gap:7px;align-items:end;padding-top:8px;border-top:1px solid #e2e8f0}.upi-confirm-grid label span{display:block;font-size:9px;color:#64748b;font-weight:700;margin-bottom:4px}.upi-confirm-grid input{width:100%;min-height:38px;padding:7px 8px;border:1px solid #cbd5e1;border-radius:8px}.upi-confirm-grid button{min-height:38px;border:0;border-radius:8px;padding:7px 10px;font-weight:800;cursor:pointer;white-space:nowrap}.upi-confirm-btn{background:#16a34a;color:#fff}.upi-reject-btn{background:#fee2e2;color:#991b1b}
            body.dark-mode .upi-admin-panel,body.dark-mode .upi-config-card,body.dark-mode .upi-request-card{background:#172033;color:#e5e7eb;border-color:#334155}.dark-mode .upi-admin-head{background:rgba(23,32,51,.97);border-color:#334155}.dark-mode .upi-admin-head small,.dark-mode .upi-request-title small,.dark-mode .upi-config-grid label span,.dark-mode .upi-confirm-grid label span{color:#94a3b8}.dark-mode .upi-config-note,.dark-mode .upi-admin-summary>div,.dark-mode .upi-request-meta>div{background:#111827;color:#cbd5e1;border-color:#334155}.dark-mode .upi-config-grid input,.dark-mode .upi-confirm-grid input,.dark-mode .upi-admin-filter button{background:#111827;color:#f8fafc;border-color:#475569}.dark-mode .upi-admin-filter button.active{background:#2563eb;border-color:#2563eb}
            @media(max-width:720px){
                .upi-admin-overlay{padding:0}.upi-admin-panel{min-height:100dvh;max-height:none;border-radius:0}.upi-admin-head{padding:11px}.upi-admin-body{padding:10px}.upi-config-grid{grid-template-columns:1fr}.upi-config-toggle{justify-content:flex-start!important}.upi-admin-summary{grid-template-columns:1fr 1fr}.upi-request-meta{grid-template-columns:1fr 1fr}.upi-confirm-grid{grid-template-columns:1fr 1fr}.upi-confirm-grid label:nth-child(3){grid-column:1/-1}.upi-confirm-grid button{width:100%}
            }
        `;
        document.head.appendChild(style);
    }

    function publicRemaining(emi) {
        if (typeof publicEmiRemaining === 'function') return Math.max(0, Number(publicEmiRemaining(emi)) || 0);
        const scheduled = Math.max(0, Number(emi?.amount) || 0);
        const paid = Math.max(0, Number(emi?.paid_amount) || 0);
        return Math.max(scheduled - paid, 0);
    }

    function pendingStorageKey(loanCode, installment) {
        return `abhi_upi_pending:${String(loanCode || '').trim()}:${Number(installment || 0)}`;
    }

    function rememberPending(loanCode, installment, requestId) {
        try { sessionStorage.setItem(pendingStorageKey(loanCode, installment), requestId); } catch {}
    }

    function knownPending(loanCode, installment) {
        try { return sessionStorage.getItem(pendingStorageKey(loanCode, installment)) || ''; } catch { return ''; }
    }

    function forgetPending(loanCode, installment) {
        try { sessionStorage.removeItem(pendingStorageKey(loanCode, installment)); } catch {}
    }

    let publicConfig = null;
    async function loadPublicConfig(force = false) {
        if (publicConfig && !force) return publicConfig;
        try {
            const response = await fetch('/api/upi-payments?action=config', { cache:'no-store' });
            if (!response.ok) throw new Error('UPI config unavailable');
            publicConfig = await response.json();
        } catch {
            publicConfig = { enabled:false, payee_name:'Abhishek Management' };
        }
        return publicConfig;
    }

    function ensurePublicSyncLoader() {
        let loader = document.getElementById('publicSyncLoader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'publicSyncLoader';
            loader.hidden = true;
            loader.setAttribute('role', 'status');
            loader.setAttribute('aria-live', 'polite');
            loader.innerHTML = '<span class="abhi-sync-ring" aria-hidden="true"></span><span>Server se data sync ho raha hai…</span>';
            document.body.appendChild(loader);
        }
        return loader;
    }

    let syncLoaderTimer = null;
    function scheduleSyncLoader() {
        clearTimeout(syncLoaderTimer);
        syncLoaderTimer = setTimeout(() => { ensurePublicSyncLoader().hidden = false; }, 280);
    }

    function hideSyncLoader() {
        clearTimeout(syncLoaderTimer);
        const loader = document.getElementById('publicSyncLoader');
        if (loader) loader.hidden = true;
    }

    function installSyncFeedback() {
        const badge = document.getElementById('lastUpdatedBadge');
        if (badge) badge.style.display = 'block';

        if (typeof window.fetchFromCloud === 'function' && !window.fetchFromCloud.__abhiUpiWrapped) {
            const core = window.fetchFromCloud;
            const wrapped = async function(...args) {
                scheduleSyncLoader();
                try { return await core.apply(this, args); }
                finally { hideSyncLoader(); }
            };
            wrapped.__abhiUpiWrapped = true;
            window.fetchFromCloud = wrapped;
        }

        // Catch the initial load even when it began before this enhancement layer loaded.
        const text = String(badge?.textContent || '');
        if (/N\/A|Updating|Loading/i.test(text)) {
            scheduleSyncLoader();
            let checks = 0;
            const watcher = setInterval(() => {
                checks += 1;
                const current = String(document.getElementById('lastUpdatedBadge')?.textContent || '');
                if (/Updated|Offline|Error/i.test(current) || checks > 80) {
                    clearInterval(watcher);
                    hideSyncLoader();
                }
            }, 150);
        }
    }

    function showPublicNotice(data) {
        document.getElementById('upiPublicNotice')?.remove();
        const box = document.createElement('div');
        box.id = 'upiPublicNotice';
        box.className = 'upi-public-notice no-print';
        box.innerHTML = `<strong>⏳ Payment verification pending</strong>
            UPI app open ki gayi hai. Sirf app khulne se EMI paid nahi hoti.
            <small>Admin bank/UPI receipt verify karke Confirm Received karega, tabhi EMI status PAID hoga. Ref: ${esc(String(data.request_id || '').slice(0,8).toUpperCase())}</small>
            <div class="upi-notice-actions"><button type="button" class="copy">Copy UPI ID</button><button type="button" class="close">Close</button></div>`;
        box.querySelector('.copy')?.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(String(data.upi_id || ''));
                box.querySelector('.copy').textContent = 'Copied ✓';
            } catch { alert(`UPI ID: ${data.upi_id || ''}`); }
        });
        box.querySelector('.close')?.addEventListener('click', () => box.remove());
        document.body.appendChild(box);
    }

    async function startPublicPayment(loan, emi, button, mount) {
        const installment = Number(emi?.installment_number || 0);
        const loanCode = String(loan?.loan_code || '').trim();
        if (!loanCode || !installment) return;
        const original = button.textContent;
        button.disabled = true;
        button.textContent = 'Opening UPI…';
        try {
            const response = await fetch('/api/upi-payments?action=start', {
                method:'POST', cache:'no-store', headers:{ 'Content-Type':'application/json' },
                body:JSON.stringify({ loan_code:loanCode, installment_number:installment })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data?.error || 'UPI payment start nahi hua.');
            rememberPending(loanCode, installment, data.request_id);
            mount.innerHTML = `<span class="upi-public-pending">⏳ Pending verification</span>`;
            showPublicNotice(data);
            if (data.upi_uri) {
                window.setTimeout(() => { window.location.href = data.upi_uri; }, 90);
            }
        } catch (err) {
            alert(err.message || 'UPI payment start nahi hua.');
            button.disabled = false;
            button.textContent = original;
        }
    }

    async function refreshKnownPending(loan, emi, mount) {
        const requestId = knownPending(loan.loan_code, emi.installment_number);
        if (!requestId) return false;
        try {
            const response = await fetch(`/api/upi-payments?action=status&request_id=${encodeURIComponent(requestId)}`, { cache:'no-store' });
            if (!response.ok) return false;
            const data = await response.json();
            if (data.status === 'pending') {
                mount.innerHTML = '<span class="upi-public-pending">⏳ Pending verification</span>';
                return true;
            }
            forgetPending(loan.loan_code, emi.installment_number);
            if (data.status === 'confirmed' && typeof window.fetchFromCloud === 'function') window.fetchFromCloud().catch(() => {});
        } catch {}
        return false;
    }

    async function enhancePublicOverlay(loanId) {
        const overlay = document.getElementById('publicLoanDetailOverlay');
        if (!overlay || typeof loans === 'undefined' || !Array.isArray(loans)) return;
        const loan = loans.find(item => String(item.id) === String(loanId));
        if (!loan) return;
        const config = await loadPublicConfig();
        const emis = [...(loan.emis || [])].sort((a,b) => Number(a.installment_number || 0) - Number(b.installment_number || 0));
        const rows = Array.from(overlay.querySelectorAll('.public-emi-row'));
        rows.forEach((row, index) => {
            const emi = emis[index];
            if (!emi || row.querySelector('.upi-public-actions')) return;
            const remaining = publicRemaining(emi);
            if (remaining <= 0) {
                forgetPending(loan.loan_code, emi.installment_number);
                return;
            }
            const mount = document.createElement('div');
            mount.className = 'upi-public-actions';
            row.appendChild(mount);
            if (!config?.enabled) {
                mount.innerHTML = '<span class="upi-public-unavailable">UPI payment abhi enabled nahi hai.</span>';
                return;
            }
            if (knownPending(loan.loan_code, emi.installment_number)) {
                mount.innerHTML = '<span class="upi-public-pending">⏳ Checking pending payment…</span>';
                refreshKnownPending(loan, emi, mount).then(stillPending => {
                    if (!stillPending && document.body.contains(mount)) addPayButton();
                });
                return;
            }
            addPayButton();

            function addPayButton() {
                mount.innerHTML = '';
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'upi-public-pay';
                button.textContent = `Pay ${money(remaining)} via UPI`;
                button.addEventListener('click', () => startPublicPayment(loan, emi, button, mount));
                mount.appendChild(button);
            }
        });
    }

    function installPublicUi() {
        injectStyles();
        installSyncFeedback();
        loadPublicConfig().catch(() => {});
        if (typeof window.publicOpenLoanCompactDetail === 'function' && !window.publicOpenLoanCompactDetail.__abhiUpiWrapped) {
            const core = window.publicOpenLoanCompactDetail;
            const wrapped = function(loanId, ...rest) {
                const result = core.call(this, loanId, ...rest);
                window.setTimeout(() => enhancePublicOverlay(loanId), 0);
                return result;
            };
            wrapped.__abhiUpiWrapped = true;
            window.publicOpenLoanCompactDetail = wrapped;
        }
    }

    // ---------------- ADMIN ----------------
    let adminRequests = [];
    let adminFilter = 'pending';

    function adminBusinessDateSafe() {
        if (typeof adminBusinessDate === 'function') return adminBusinessDate();
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
        const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${map.year}-${map.month}-${map.day}`;
    }

    function formatAdminDate(value) {
        if (!value) return '—';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        return d.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true });
    }

    async function adminJson(url, options = {}) {
        const response = typeof adminFetch === 'function' ? await adminFetch(url, options) : await fetch(url, options);
        return response.json();
    }

    function ensureAdminWidget() {
        if (document.getElementById('upiAdminWidget')) return;
        const dashboard = document.getElementById('dashboard');
        if (!dashboard) return;
        const widget = document.createElement('div');
        widget.id = 'upiAdminWidget';
        widget.className = 'upi-admin-widget no-print';
        widget.innerHTML = `<div><strong>💳 Public UPI Payments</strong><small>User payment requests • admin verification required</small></div><button type="button">Open <span id="upiAdminPendingCount" class="upi-admin-count">0</span></button>`;
        widget.querySelector('button')?.addEventListener('click', openAdminCenter);
        dashboard.insertAdjacentElement('afterend', widget);
    }

    async function refreshAdminCount() {
        ensureAdminWidget();
        try {
            const data = await adminJson('/api/upi-payments?action=list', { cache:'no-store' });
            adminRequests = Array.isArray(data.requests) ? data.requests : [];
            const el = document.getElementById('upiAdminPendingCount');
            if (el) el.textContent = String(Number(data.pending || 0));
            return data;
        } catch (err) {
            console.warn('UPI request count refresh failed:', err);
            return null;
        }
    }

    function adminStatusCounts() {
        const out = { pending:0, confirmed:0, rejected:0, expired:0 };
        adminRequests.forEach(row => { if (Object.hasOwn(out, row.status)) out[row.status] += 1; });
        return out;
    }

    function renderAdminSummary() {
        const counts = adminStatusCounts();
        const box = document.getElementById('upiAdminSummary');
        if (!box) return;
        box.innerHTML = `<div><small>Pending</small><strong>${counts.pending}</strong></div><div><small>Confirmed</small><strong>${counts.confirmed}</strong></div><div><small>Rejected</small><strong>${counts.rejected}</strong></div><div><small>Expired</small><strong>${counts.expired}</strong></div>`;
    }

    function setAdminFilter(filter) {
        adminFilter = filter;
        document.querySelectorAll('.upi-admin-filter button').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === filter));
        renderAdminRequests();
    }

    function renderAdminRequests() {
        renderAdminSummary();
        const list = document.getElementById('upiRequestList');
        if (!list) return;
        const rows = adminRequests.filter(row => adminFilter === 'all' || row.status === adminFilter);
        if (!rows.length) {
            list.innerHTML = '<div class="upi-request-empty">Is filter me koi UPI payment request nahi hai.</div>';
            return;
        }
        list.innerHTML = rows.map(row => {
            const borrower = row.borrowers?.name || 'Borrower';
            const emi = row.emis || {};
            const due = emi.due_date ? String(emi.due_date).slice(0,10) : `${emi.due_day || '—'} ${emi.due_month || ''} ${emi.due_year || ''}`.trim();
            const pendingControls = row.status === 'pending' ? `<div class="upi-confirm-grid">
                <label><span>Received amount</span><input type="number" min="1" step="1" value="${Number(row.amount || 0)}" data-upi-amount="${esc(row.id)}"></label>
                <label><span>Payment date</span><input type="date" value="${adminBusinessDateSafe()}" data-upi-date="${esc(row.id)}"></label>
                <label><span>Admin note (optional)</span><input type="text" maxlength="500" placeholder="Bank/UPI reference note" data-upi-note="${esc(row.id)}"></label>
                <button type="button" class="upi-confirm-btn" data-upi-confirm="${esc(row.id)}">✓ Confirm Received</button>
                <button type="button" class="upi-reject-btn" data-upi-reject="${esc(row.id)}">Reject / No Payment</button>
            </div>` : (row.admin_note ? `<div class="upi-config-note">Admin note: ${esc(row.admin_note)}</div>` : '');
            return `<article class="upi-request-card" data-request-id="${esc(row.id)}">
                <div class="upi-request-top"><div class="upi-request-title"><strong>${esc(borrower)} • ${esc(row.loan_code)} • EMI #${Number(row.installment_number || 0)}</strong><small>Request ${esc(String(row.id).slice(0,8).toUpperCase())}</small></div><span class="upi-request-status ${esc(row.status)}">${esc(row.status)}</span></div>
                <div class="upi-request-meta"><div><small>Requested</small><strong>${money(row.amount)}</strong></div><div><small>EMI due</small><strong>${esc(due || '—')}</strong></div><div><small>Created</small><strong>${esc(formatAdminDate(row.created_at))}</strong></div><div><small>Expires / Resolved</small><strong>${esc(formatAdminDate(row.status === 'pending' ? row.expires_at : row.resolved_at))}</strong></div></div>
                ${pendingControls}
            </article>`;
        }).join('');
    }

    async function loadAdminConfig() {
        const data = await adminJson('/api/upi-payments?action=admin-config', { cache:'no-store' });
        const id = document.getElementById('upiConfigId');
        const name = document.getElementById('upiConfigName');
        const enabled = document.getElementById('upiConfigEnabled');
        if (id) id.value = data.upi_id || '';
        if (name) name.value = data.payee_name || 'Abhishek Management';
        if (enabled) enabled.checked = Boolean(data.enabled);
    }

    async function saveAdminConfig() {
        const button = document.getElementById('upiConfigSave');
        const upiId = String(document.getElementById('upiConfigId')?.value || '').trim();
        const payeeName = String(document.getElementById('upiConfigName')?.value || '').trim();
        const enabled = Boolean(document.getElementById('upiConfigEnabled')?.checked);
        if (button) { button.disabled = true; button.textContent = 'Saving…'; }
        try {
            await adminJson('/api/upi-payments?action=config', {
                method:'PUT', headers:{ 'Content-Type':'application/json' },
                body:JSON.stringify({ upi_id:upiId, payee_name:payeeName, enabled })
            });
            alert(`✅ UPI settings saved. Public Pay buttons ${enabled ? 'enabled' : 'disabled'} hain.`);
        } catch (err) {
            alert(err.message || 'UPI settings save nahi hui.');
        } finally {
            if (button) { button.disabled = false; button.textContent = 'Save UPI Settings'; }
        }
    }

    async function confirmAdminRequest(requestId) {
        const amount = Number(document.querySelector(`[data-upi-amount="${CSS.escape(requestId)}"]`)?.value || 0);
        const paymentDate = String(document.querySelector(`[data-upi-date="${CSS.escape(requestId)}"]`)?.value || '');
        const note = String(document.querySelector(`[data-upi-note="${CSS.escape(requestId)}"]`)?.value || '').trim();
        if (!Number.isInteger(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
            alert('Valid received amount aur payment date enter karein.');
            return;
        }
        if (!confirm(`Kya aapne bank/UPI account me ${money(amount)} ACTUALLY receive hona verify kar liya hai?\n\nConfirm karne par EMI ledger update ho jayega.`)) return;
        const button = document.querySelector(`[data-upi-confirm="${CSS.escape(requestId)}"]`);
        if (button) { button.disabled = true; button.textContent = 'Confirming…'; }
        try {
            await adminJson('/api/upi-payments?action=confirm', {
                method:'POST', headers:{ 'Content-Type':'application/json' },
                body:JSON.stringify({ request_id:requestId, amount, payment_date:paymentDate, admin_note:note })
            });
            if (typeof loadAllData === 'function') await loadAllData();
            await refreshAdminCenter();
            alert('✅ Payment verified aur EMI ledger me record ho gaya. User sync ke baad PAID status dekhega.');
        } catch (err) {
            alert(err.message || 'Payment confirm nahi hua.');
            if (button) { button.disabled = false; button.textContent = '✓ Confirm Received'; }
        }
    }

    async function rejectAdminRequest(requestId) {
        const note = prompt('No payment / fake attempt ka reason (optional):', 'Payment not received');
        if (note === null) return;
        if (!confirm('Is pending request ko reject karna hai? EMI ledger bilkul change nahi hoga.')) return;
        try {
            await adminJson('/api/upi-payments?action=reject', {
                method:'POST', headers:{ 'Content-Type':'application/json' },
                body:JSON.stringify({ request_id:requestId, admin_note:note })
            });
            await refreshAdminCenter();
        } catch (err) {
            alert(err.message || 'Request reject nahi hui.');
        }
    }

    function closeAdminCenter() {
        document.getElementById('upiAdminOverlay')?.remove();
        document.body.style.overflow = '';
    }

    async function refreshAdminCenter() {
        const refresh = document.getElementById('upiAdminRefresh');
        if (refresh) { refresh.disabled = true; refresh.textContent = 'Refreshing…'; }
        try {
            await Promise.all([refreshAdminCount(), loadAdminConfig()]);
            renderAdminRequests();
        } finally {
            if (refresh) { refresh.disabled = false; refresh.textContent = '↻ Refresh'; }
        }
    }

    async function openAdminCenter() {
        document.getElementById('upiAdminOverlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'upiAdminOverlay';
        overlay.className = 'upi-admin-overlay no-print';
        overlay.innerHTML = `<section class="upi-admin-panel" role="dialog" aria-modal="true" aria-labelledby="upiAdminTitle">
            <header class="upi-admin-head"><div><h3 id="upiAdminTitle">💳 Public UPI Payment Requests</h3><small>Pending request ≠ paid. Bank/UPI receipt verify karne ke baad hi Confirm Received karein.</small></div><div class="upi-admin-head-actions"><button type="button" id="upiAdminRefresh" class="upi-admin-refresh">↻ Refresh</button><button type="button" class="upi-admin-close">✕</button></div></header>
            <div class="upi-admin-body">
                <section class="upi-config-card"><h4>UPI Payment Settings</h4><div class="upi-config-grid"><label><span>Your UPI ID</span><input id="upiConfigId" type="text" maxlength="120" placeholder="name@bank" autocomplete="off"></label><label><span>Payee name</span><input id="upiConfigName" type="text" maxlength="100" placeholder="Abhishek Management"></label><label class="upi-config-toggle"><input id="upiConfigEnabled" type="checkbox"><span>Enable public Pay</span></label><button type="button" id="upiConfigSave" class="upi-config-save">Save UPI Settings</button></div><div class="upi-config-note">User Pay button generic UPI chooser kholta hai. Browser payment success ko trustworthy tarike se verify nahi kar sakta, isliye har request pehle Pending rahegi.</div></section>
                <div id="upiAdminSummary" class="upi-admin-summary"></div>
                <div class="upi-admin-filter"><button type="button" data-filter="pending" class="active">Pending</button><button type="button" data-filter="confirmed">Confirmed</button><button type="button" data-filter="rejected">Rejected</button><button type="button" data-filter="expired">Expired</button><button type="button" data-filter="all">All</button></div>
                <div id="upiRequestList" class="upi-request-list"><div class="upi-request-empty">Loading payment requests…</div></div>
            </div>
        </section>`;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        overlay.querySelector('.upi-admin-close')?.addEventListener('click', closeAdminCenter);
        overlay.addEventListener('click', event => { if (event.target === overlay) closeAdminCenter(); });
        document.getElementById('upiAdminRefresh')?.addEventListener('click', refreshAdminCenter);
        document.getElementById('upiConfigSave')?.addEventListener('click', saveAdminConfig);
        overlay.querySelector('.upi-admin-filter')?.addEventListener('click', event => {
            const btn = event.target.closest('button[data-filter]');
            if (btn) setAdminFilter(btn.dataset.filter || 'pending');
        });
        overlay.addEventListener('click', event => {
            const confirmBtn = event.target.closest('[data-upi-confirm]');
            if (confirmBtn) { confirmAdminRequest(confirmBtn.dataset.upiConfirm); return; }
            const rejectBtn = event.target.closest('[data-upi-reject]');
            if (rejectBtn) rejectAdminRequest(rejectBtn.dataset.upiReject);
        });
        await refreshAdminCenter();
    }

    function installAdminUi() {
        injectStyles();
        ensureAdminWidget();
        refreshAdminCount();
        window.setInterval(refreshAdminCount, 60000);
        window.openUpiPaymentCenter = openAdminCenter;
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.getElementById('upiAdminOverlay')) closeAdminCenter(); });
    }

    if (isPublic) installPublicUi();
    if (isAdmin) installAdminUi();
})();
