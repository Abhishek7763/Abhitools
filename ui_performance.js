// AbhiTools Frontend Performance — low-risk interaction/request coalescing + sync/action feedback.
(() => {
    'use strict';

    if (window.__ABHITOOLS_PERFORMANCE_PHASE_B__) return;
    window.__ABHITOOLS_PERFORMANCE_PHASE_B__ = true;

    const body = document.body;
    const isAdmin = /(?:^|\/)admin\.html$/i.test(window.location.pathname);
    const isPublic = window.location.pathname === '/' || /(?:^|\/)index\.html$/i.test(window.location.pathname);
    const syncStorageKey = isAdmin ? 'abhi_last_sync_admin_v1' : 'abhi_last_sync_public_v1';
    const syncFailureAlert = 'Data load nahi hua. Internet check karein.';
    const actionProcessingTimeoutMs = 7000;
    const modalSelectors = [
        '#uiMoreOverlay:not([hidden])',
        '#uiLoanDetailOverlay',
        '#publicLoanDetailOverlay',
        '.upi-ref-overlay',
        '.upi-admin-overlay'
    ];
    const processingButtons = new WeakMap();

    function coalesceAsync(name) {
        const original = window[name];
        if (typeof original !== 'function' || original.__abhiCoalesced) return;
        let inFlight = null;
        const wrapped = function(...args) {
            if (inFlight) return inFlight;
            let result;
            try {
                result = original.apply(this, args);
            } catch (error) {
                throw error;
            }
            inFlight = Promise.resolve(result).finally(() => { inFlight = null; });
            return inFlight;
        };
        wrapped.__abhiCoalesced = true;
        wrapped.__abhiOriginal = original;
        window[name] = wrapped;
    }

    function installSearchDebounce() {
        const input = document.getElementById('searchInput');
        if (!input || input.dataset.abhiPerfSearch === 'yes') return;
        input.dataset.abhiPerfSearch = 'yes';

        // Legacy inline keyup rebuilds the full borrower list on every keystroke.
        // Keep sort changes immediate, but debounce typing into one render.
        input.onkeyup = null;
        let timer = null;
        let composing = false;

        const run = () => {
            clearTimeout(timer);
            timer = null;
            window.requestAnimationFrame(() => {
                if (typeof window.handleSearch === 'function') window.handleSearch();
            });
        };

        input.addEventListener('compositionstart', () => { composing = true; });
        input.addEventListener('compositionend', () => {
            composing = false;
            clearTimeout(timer);
            timer = window.setTimeout(run, 70);
        });
        input.addEventListener('input', () => {
            if (composing) return;
            clearTimeout(timer);
            timer = window.setTimeout(run, 130);
        }, { passive: true });

        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') run();
            else if (event.key === 'Escape' && input.value) {
                input.value = '';
                run();
            }
        });
    }

    function lastSyncTimestamp() {
        const value = Number(localStorage.getItem(syncStorageKey) || 0);
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function formatLastSync(value = lastSyncTimestamp()) {
        if (!value) return '';
        try {
            return new Date(value).toLocaleString('en-IN', {
                day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit', hour12: true
            });
        } catch {
            return '';
        }
    }

    function rememberSuccessfulSync() {
        try { localStorage.setItem(syncStorageKey, String(Date.now())); } catch {}
    }

    function decorateFailedSyncBadge() {
        const badge = document.getElementById('lastUpdatedBadge');
        if (!badge) return;
        const last = formatLastSync();
        badge.innerHTML = last ? `Sync issue ⚠️<br>Last: ${last}` : 'Sync issue ⚠️';
    }

    function dismissReadFailureNotice() {
        document.getElementById('abhiReadFailureToast')?.remove();
    }

    function showReadFailureNotice() {
        dismissReadFailureNotice();
        const toast = document.createElement('div');
        toast.id = 'abhiReadFailureToast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.style.cssText = 'position:fixed;z-index:29998;right:14px;bottom:88px;left:max(14px,calc(100vw - 390px));padding:12px 13px;border-radius:12px;background:#92400e;color:#fff;box-shadow:0 12px 30px rgba(0,0,0,.26);font:500 13px/1.4 system-ui,-apple-system,sans-serif';

        const title = document.createElement('div');
        title.style.cssText = 'font-weight:800;margin-bottom:3px';
        title.textContent = navigator.onLine ? '⚠️ Server response nahi mila' : '📴 Internet connection offline hai';

        const detail = document.createElement('div');
        detail.style.cssText = 'opacity:.9;margin-bottom:9px';
        const last = formatLastSync();
        detail.textContent = last
            ? `Purana data screen par rehne diya gaya hai. Last successful sync: ${last}.`
            : 'Existing screen ko disturb nahi kiya gaya. Connection milte hi Sync dobara try karein.';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;align-items:center';
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = 'Dismiss';
        dismiss.style.cssText = 'border:0;border-radius:8px;padding:7px 10px;background:rgba(255,255,255,.16);color:#fff;cursor:pointer';
        dismiss.onclick = dismissReadFailureNotice;

        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '🔄 Retry Sync';
        retry.style.cssText = 'border:0;border-radius:8px;padding:7px 11px;background:#fff;color:#78350f;font-weight:800;cursor:pointer';
        retry.onclick = async () => {
            if (typeof window.manualSync !== 'function') return;
            retry.disabled = true;
            retry.textContent = 'Retrying…';
            try {
                await window.manualSync();
                const badgeText = document.getElementById('lastUpdatedBadge')?.textContent || '';
                if (!/(?:Offline|Error|Sync issue)/i.test(badgeText)) dismissReadFailureNotice();
            } finally {
                if (document.body.contains(retry)) {
                    retry.disabled = false;
                    retry.textContent = '🔄 Retry Sync';
                }
            }
        };

        row.append(dismiss, retry);
        toast.append(title, detail, row);
        document.body?.appendChild(toast);
    }

    function installReadFailureSoftener() {
        if (!isPublic && !isAdmin) return;
        const currentAlert = window.alert;
        if (currentAlert?.__abhiReadFailureSoftener) return;
        const nativeAlert = currentAlert.bind(window);
        const wrappedAlert = function(message, ...args) {
            if (String(message ?? '').trim() === syncFailureAlert) {
                decorateFailedSyncBadge();
                showReadFailureNotice();
                return;
            }
            return nativeAlert(message, ...args);
        };
        wrappedAlert.__abhiReadFailureSoftener = true;
        wrappedAlert.__abhiNativeAlert = currentAlert;
        window.alert = wrappedAlert;
    }

    function installSyncFeedbackGuard() {
        const badge = document.getElementById('lastUpdatedBadge');
        if (!badge || badge.dataset.abhiPerfSync === 'yes') return;
        badge.dataset.abhiPerfSync = 'yes';
        badge.setAttribute('aria-live', 'polite');
        badge.setAttribute('role', 'status');

        const inspect = () => {
            const text = String(badge.textContent || '').replace(/\s+/g, ' ').trim();
            const success = /^Updated!/i.test(text) || (/^Updated:/i.test(text) && !/N\/A/i.test(text));
            if (success) {
                rememberSuccessfulSync();
                dismissReadFailureNotice();
            }
        };
        new MutationObserver(inspect).observe(badge, { childList: true, subtree: true, characterData: true });
        inspect();

        const initialText = String(badge.textContent || '');
        if (/(?:Offline|Error)/i.test(initialText)) {
            decorateFailedSyncBadge();
            showReadFailureNotice();
        }
    }

    function clearActionProcessing(button) {
        const state = processingButtons.get(button);
        if (!state) return;
        state.observer.disconnect();
        clearTimeout(state.timeoutId);
        button.classList.remove('abhi-action-processing');
        delete button.dataset.abhiActionProcessing;
        if (state.previousAriaBusy == null) button.removeAttribute('aria-busy');
        else button.setAttribute('aria-busy', state.previousAriaBusy);
        processingButtons.delete(button);
    }

    function markActionProcessing(button) {
        if (!(button instanceof HTMLButtonElement) || processingButtons.has(button) || !button.disabled) return;
        const observer = new MutationObserver(() => {
            if (!button.isConnected || !button.disabled) clearActionProcessing(button);
        });
        const previousAriaBusy = button.getAttribute('aria-busy');
        button.classList.add('abhi-action-processing');
        button.dataset.abhiActionProcessing = 'yes';
        button.setAttribute('aria-busy', 'true');
        observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
        const timeoutId = window.setTimeout(() => clearActionProcessing(button), actionProcessingTimeoutMs);
        processingButtons.set(button, { observer, timeoutId, previousAriaBusy });
    }

    function scheduleProcessingCheck(button) {
        [0, 45, 140].forEach(delay => {
            window.setTimeout(() => {
                if (button.isConnected && button.disabled) markActionProcessing(button);
            }, delay);
        });
    }

    function installActionFeedback() {
        if (document.documentElement.dataset.abhiActionFeedback === 'yes') return;
        document.documentElement.dataset.abhiActionFeedback = 'yes';

        document.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target.closest('button,.btn,[role="button"]') : null;
            if (!(target instanceof HTMLElement)) return;
            if (target.matches(':disabled,[aria-disabled="true"]')) return;

            target.classList.add('abhi-action-tap');
            window.setTimeout(() => target.classList.remove('abhi-action-tap'), 190);

            if (target instanceof HTMLButtonElement) scheduleProcessingCheck(target);
        }, true);
    }

    function installModalStatePolish() {
        if (!body || body.dataset.abhiModalPolish === 'yes') return;
        body.dataset.abhiModalPolish = 'yes';
        let frame = 0;
        const sync = () => {
            frame = 0;
            const modalOpen = modalSelectors.some(selector => document.querySelector(selector));
            body.classList.toggle('abhi-modal-active', modalOpen);
        };
        const schedule = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(sync);
        };
        new MutationObserver(schedule).observe(body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['hidden']
        });
        sync();
    }

    if (isPublic) {
        coalesceAsync('fetchFromCloud');
        coalesceAsync('manualSync');
    }

    if (isAdmin) {
        coalesceAsync('loadAllData');
        coalesceAsync('manualSync');
        coalesceAsync('refreshDueData');
        coalesceAsync('refreshReminderBadge');
        coalesceAsync('refreshHomeCommandCenter');
    }

    installReadFailureSoftener();
    installSearchDebounce();
    installSyncFeedbackGuard();
    installActionFeedback();
    installModalStatePolish();
    window.addEventListener('online', () => {
        if (document.getElementById('abhiReadFailureToast')) showReadFailureNotice();
    });
    body?.classList.add('ui-performance-ready');
})();
