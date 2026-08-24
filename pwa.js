// Phase 16 PWA helper — hardened static shell only; API/financial responses are never cached.
(() => {
    'use strict';

    const SW_URL = '/service-worker.js';
    const installButtons = () => Array.from(document.querySelectorAll('[data-pwa-install]'));
    const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
    let deferredInstallPrompt = null;
    let refreshing = false;

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

    // Design Build 1: load the isolated admin UI shell without rewriting admin.html/admin_script.js.
    function loadAdminUiShell() {
        if (!document.body?.classList.contains('has-mobile-app-nav')) return;

        if (!document.querySelector('link[data-abhi-ui-shell]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/ui_shell.css';
            link.dataset.abhiUiShell = 'yes';
            document.head.appendChild(link);
        }

        if (!document.querySelector('script[data-abhi-ui-shell]')) {
            const script = document.createElement('script');
            script.src = '/ui_shell.js';
            script.defer = true;
            script.dataset.abhiUiShell = 'yes';
            document.body.appendChild(script);
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
            bindInstallButtons();
            updateConnectionState();
            registerServiceWorker();
        }, { once: true });
    } else {
        loadAdminUiShell();
        bindInstallButtons();
        updateConnectionState();
        registerServiceWorker();
    }
})();
