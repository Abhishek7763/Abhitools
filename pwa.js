// Phase 16 PWA helper — hardened static shell only; API/financial responses are never cached.
(() => {
    'use strict';

    const SW_URL = '/service-worker.js';
    const installButtons = () => Array.from(document.querySelectorAll('[data-pwa-install]'));
    const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
    let deferredInstallPrompt = null;
    let refreshing = false;

    const ADMIN_LOGIN_URL = '/advanced_admin_login_panel.html';
    const adminPath = /(?:^|\/)admin\.html$/i.test(window.location.pathname);
    const publicPath = window.location.pathname === '/' || /(?:^|\/)index\.html$/i.test(window.location.pathname);

    // Security/UI guard: never render the admin page before the signed session is verified.
    // This is presentation hardening; /api/* remains the actual server-side security boundary.
    if (adminPath) {
        document.documentElement.classList.add('abhi-admin-auth-pending');
        if (!document.getElementById('abhiAdminAuthGuardStyle')) {
            const guard = document.createElement('style');
            guard.id = 'abhiAdminAuthGuardStyle';
            guard.textContent = 'html.abhi-admin-auth-pending body{visibility:hidden!important}';
            document.head.appendChild(guard);
        }
    }

    function setInstallButtons(visible) {
        installButtons().forEach(btn => {
            btn.style.display = visible ? 'inline-flex' : 'none';
            btn.setAttribute('aria-hidden', visible ? 'false' : 'true');
        });
    }

    async function installApp() {
        if (isStandalone()) {
            setInstallButtons(false);
            return;
        }
        if (deferredInstallPrompt) {
            const prompt = deferredInstallPrompt;
            deferredInstallPrompt = null;
            setInstallButtons(false);
            await prompt.prompt();
            try { await prompt.userChoice; } catch {}
            return;
        }
        if (isIos) {
            alert('iPhone/iPad par install karne ke liye Safari ka Share button kholen aur “Add to Home Screen” choose karein.');
            return;
        }
        alert('Install option browser ke menu me “Install app” ya “Add to Home screen” ke naam se mil sakta hai.');
    }

    function bindInstallButtons() {
        installButtons().forEach(btn => {
            if (btn.dataset.pwaBound === 'yes') return;
            btn.dataset.pwaBound = 'yes';
            btn.addEventListener('click', installApp);
        });
        if (!isStandalone() && isIos) setInstallButtons(true);
        if (isStandalone()) {
            document.body?.classList.add('pwa-standalone');
            setInstallButtons(false);
        }
    }

    function ensureConnectionBar() {
        let bar = document.getElementById('pwaConnectionBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'pwaConnectionBar';
            bar.setAttribute('role', 'status');
            bar.setAttribute('aria-live', 'polite');
            bar.style.cssText = 'display:none;position:fixed;left:12px;right:12px;top:10px;z-index:30000;padding:10px 14px;border-radius:10px;background:#7f1d1d;color:#fff;font:600 13px/1.35 system-ui,-apple-system,sans-serif;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.25)';
            bar.textContent = '📴 Offline — live loan data unavailable. Internet aane par app automatically reconnect karega.';
            document.body?.appendChild(bar);
        }
        return bar;
    }

    function updateConnectionState() {
        const offline = !navigator.onLine;
        document.documentElement.classList.toggle('is-offline', offline);
        const bar = ensureConnectionBar();
        if (bar) bar.style.display = offline ? 'block' : 'none';
    }

    function showUpdateToast(registration) {
        if (!registration?.waiting || document.getElementById('pwaUpdateToast')) return;
        const toast = document.createElement('div');
        toast.id = 'pwaUpdateToast';
        toast.style.cssText = 'position:fixed;z-index:29999;right:14px;bottom:88px;max-width:330px;padding:12px;border-radius:12px;background:#111827;color:#fff;box-shadow:0 12px 32px rgba(0,0,0,.3);font:500 13px/1.4 system-ui,-apple-system,sans-serif';
        toast.innerHTML = '<div style="font-weight:700;margin-bottom:4px">✨ AbhiTools update ready</div><div style="opacity:.8;margin-bottom:10px">Latest version load karne ke liye update karein.</div>';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
        const later = document.createElement('button');
        later.type = 'button'; later.textContent = 'Later';
        later.style.cssText = 'border:0;border-radius:8px;padding:7px 10px;background:#374151;color:#fff;cursor:pointer';
        later.onclick = () => toast.remove();
        const update = document.createElement('button');
        update.type = 'button'; update.textContent = 'Update';
        update.style.cssText = 'border:0;border-radius:8px;padding:7px 12px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer';
        update.onclick = () => {
            update.disabled = true;
            update.textContent = 'Updating…';
            registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
        };
        row.append(later, update);
        toast.appendChild(row);
        document.body?.appendChild(toast);
    }

    async function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        try {
            const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
            if (registration.waiting) showUpdateToast(registration);
            registration.addEventListener('updatefound', () => {
                const worker = registration.installing;
                if (!worker) return;
                worker.addEventListener('statechange', () => {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(registration);
                });
            });
            // Check for a newer static shell when the app is opened, without blocking startup.
            setTimeout(() => registration.update().catch(() => {}), 1500);
        } catch (error) {
            console.warn('PWA service worker registration failed:', error);
        }

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });
    }

    function adminUiPage() {
        // Only the real admin document is auth-gated. The public index page also
        // uses has-mobile-app-nav, so class-based detection must never be used here.
        return adminPath;
    }

    function revealAuthorizedAdmin() {
        document.documentElement.classList.remove('abhi-admin-auth-pending');
        document.documentElement.classList.add('abhi-admin-auth-ok');
    }

    async function verifyAdminSessionForUi() {
        if (!adminUiPage()) return true;
        if (!document.documentElement.classList.contains('abhi-admin-auth-pending')) {
            document.documentElement.classList.add('abhi-admin-auth-pending');
        }
        try {
            const response = await fetch('/api/auth', {
                method: 'GET',
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) {
                window.location.replace(ADMIN_LOGIN_URL);
                return false;
            }
            return true;
        } catch (error) {
            console.warn('Admin UI auth verification failed:', error);
            window.location.replace(ADMIN_LOGIN_URL);
            return false;
        }
    }

    function addStylesheet(href, dataKey) {
        if (document.querySelector(`link[${dataKey}]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.setAttribute(dataKey, 'yes');
        document.head.appendChild(link);
    }

    function loadScriptInOrder(src, dataKey) {
        const existing = document.querySelector(`script[${dataKey}]`);
        if (existing?.dataset.loaded === 'yes') return Promise.resolve();
        if (existing) {
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', resolve, { once:true });
                existing.addEventListener('error', reject, { once:true });
            });
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.setAttribute(dataKey, 'yes');
            script.addEventListener('load', () => { script.dataset.loaded = 'yes'; resolve(); }, { once:true });
            script.addEventListener('error', () => reject(new Error(`UI layer load failed: ${src}`)), { once:true });
            document.body.appendChild(script);
        });
    }

    async function waitForAdminCore(timeoutMs = 10000) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const ready = typeof window.renderLoanList === 'function'
                && typeof window.renderEmiList === 'function'
                && typeof window.openReminderCenter === 'function'
                && typeof window.openFollowupCenter === 'function';
            if (ready) return true;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
    }

    async function waitForPublicCore(timeoutMs = 10000) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const ready = typeof window.renderLoanList === 'function'
                && typeof window.renderFolders === 'function'
                && typeof window.publicEmiPaid === 'function'
                && typeof window.publicEmiRemaining === 'function';
            if (ready) return true;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
    }

    async function loadPublicUiLayer() {
        if (!publicPath || adminPath) return;
        try {
            const coreReady = await waitForPublicCore();
            if (!coreReady) throw new Error('Public loan handlers were not ready in time');
            await loadScriptInOrder('/ui_public_compact.js', 'data-abhi-public-compact-ui');
            await loadScriptInOrder('/ui_upi_payments.js', 'data-abhi-upi-payments-ui');
        } catch (error) {
            console.error('Public compact UI layer failed; using core public UI:', error);
        }
    }

    // Hotfix: authenticated, deterministic UI loading. Dynamic scripts are loaded sequentially
    // after admin_script.js has defined the existing financial/action handlers.
    async function loadAdminUiShell() {
        if (!adminUiPage()) return;
        const authorized = await verifyAdminSessionForUi();
        if (!authorized) return;

        try {
            const coreReady = await waitForAdminCore();
            if (!coreReady) throw new Error('Admin core handlers were not ready in time');

            addStylesheet('/ui_shell.css', 'data-abhi-ui-shell');
            addStylesheet('/ui_loans.css', 'data-abhi-loans-ui');
            addStylesheet('/ui_home_collections.css', 'data-abhi-home-collections-ui');
            addStylesheet('/ui_forms_secondary.css', 'data-abhi-forms-secondary-ui');

            await loadScriptInOrder('/ui_shell.js', 'data-abhi-ui-shell');
            await loadScriptInOrder('/ui_loans.js', 'data-abhi-loans-ui');
            await loadScriptInOrder('/ui_home_collections.js', 'data-abhi-home-collections-ui');
            await loadScriptInOrder('/ui_forms_secondary.js', 'data-abhi-forms-secondary-ui');
            await loadScriptInOrder('/ui_upi_payments.js', 'data-abhi-upi-payments-ui');
        } catch (error) {
            // Authorized users fall back to the existing admin UI instead of being locked out.
            console.error('Admin UI enhancement layer failed; using core UI:', error);
        } finally {
            revealAuthorizedAdmin();
        }
    }

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        bindInstallButtons();
        setInstallButtons(true);
    });
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        document.body?.classList.add('pwa-standalone');
        setInstallButtons(false);
    });
    window.addEventListener('online', updateConnectionState);
    window.addEventListener('offline', updateConnectionState);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            loadAdminUiShell();
            loadPublicUiLayer();
            bindInstallButtons();
            updateConnectionState();
            registerServiceWorker();
        }, { once: true });
    } else {
        loadAdminUiShell();
        loadPublicUiLayer();
        bindInstallButtons();
        updateConnectionState();
        registerServiceWorker();
    }
})();
