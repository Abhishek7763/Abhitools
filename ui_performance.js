// AbhiTools Frontend Performance Phase B — low-risk interaction/request coalescing.
(() => {
    'use strict';

    if (window.__ABHITOOLS_PERFORMANCE_PHASE_B__) return;
    window.__ABHITOOLS_PERFORMANCE_PHASE_B__ = true;

    const body = document.body;
    const isAdmin = /(?:^|\/)admin\.html$/i.test(window.location.pathname);
    const isPublic = window.location.pathname === '/' || /(?:^|\/)index\.html$/i.test(window.location.pathname);

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

    function installSyncFeedbackGuard() {
        const badge = document.getElementById('lastUpdatedBadge');
        if (!badge || badge.dataset.abhiPerfSync === 'yes') return;
        badge.dataset.abhiPerfSync = 'yes';
        badge.setAttribute('aria-live', 'polite');
        badge.setAttribute('role', 'status');
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

    installSearchDebounce();
    installSyncFeedbackGuard();
    body?.classList.add('ui-performance-ready');
})();
