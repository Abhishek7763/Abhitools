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
        '.upi-admin-overlay',
        '#abhiStatementShareOverlay'
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

    function installAdminMonthDetailXssGuard() {
        if (!isAdmin || typeof window.openMonthDetail !== 'function') return;
        const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
        const paidAmount = item => {
            if (typeof window.emiPaidAmount === 'function') return Math.max(0, Number(window.emiPaidAmount(item)) || 0);
            return Math.max(0, Number(item?.paid_amount) || 0);
        };
        const remainingAmount = item => {
            if (typeof window.emiRemainingAmount === 'function') return Math.max(0, Number(window.emiRemainingAmount(item)) || 0);
            return Math.max((Number(item?.amount) || 0) - paidAmount(item), 0);
        };

        window.openMonthDetail = function(_key, monthObj) {
            document.getElementById('monthView').style.display = 'none';
            document.getElementById('monthDetailView').style.display = 'block';
            document.getElementById('currentMonthName').innerText = `📅 ${monthObj.month} ${monthObj.year || 'Year not set'} - Total: ₹${Number(monthObj.total || 0).toLocaleString('en-IN')} | Collected: ₹${Number(monthObj.collected || 0).toLocaleString('en-IN')}`;

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
                        <span style="background:${statusColor};color:white;padding:2px 6px;border-radius:4px;margin-right:5px;">${Number(item.due_day) || 0}</span>
                        <strong>${escape(item.name || 'Unknown')}</strong> ${statusIcon}<br>
                        <small style="color:#888;">${escape(item.loan_code || '')}</small>
                    </div>
                    <div style="font-size:14px;font-weight:600;color:#333;text-align:right;">₹${Number(item.amount || 0).toLocaleString('en-IN')}<br><small>Paid ₹${paidAmount(item).toLocaleString('en-IN')} • Rem ₹${remainingAmount(item).toLocaleString('en-IN')}</small></div>
                `;
                list.appendChild(div);
            });
        };
        window.openMonthDetail.__abhiEscapedV1 = true;
    }

    function base64UrlToUint8Array(value) {
        const padding = '='.repeat((4 - String(value).length % 4) % 4);
        const base64 = (String(value) + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
    }

    async function adminPushJson(url, options = {}) {
        const response = typeof window.adminFetch === 'function'
            ? await window.adminFetch(url, options)
            : await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
        return data;
    }

    function updateNotificationButton(button) {
        if (!button) return;
        if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            button.disabled = true;
            button.textContent = '🔕 Notifications Unsupported';
            return;
        }
        if (Notification.permission === 'denied') {
            button.textContent = '🔕 Notifications Blocked';
            return;
        }
        if (Notification.permission === 'granted') {
            button.textContent = '🔔 Payment Notifications Enabled';
            return;
        }
        button.textContent = '🔔 Enable Notifications';
    }

    async function enablePaymentClaimNotifications(button) {
        if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            alert('Is browser me Web Push notifications supported nahi hain.');
            return;
        }
        if (Notification.permission === 'denied') {
            alert('Notifications browser settings me blocked hain. Site permission ko Allow karke dobara try karein.');
            return;
        }

        const original = button?.textContent || '🔔 Enable Notifications';
        if (button) { button.disabled = true; button.textContent = 'Enabling…'; }
        try {
            const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
            if (permission !== 'granted') throw new Error('Notification permission allow nahi hui.');

            const keyData = await adminPushJson('/api/dashboard?mode=settings&action=push-public-key', { cache: 'no-store' });
            if (!keyData?.configured || !keyData?.public_key) throw new Error('Push notification server config abhi ready nahi hai.');

            const registration = await navigator.serviceWorker.ready;
            let subscription = await registration.pushManager.getSubscription();
            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: base64UrlToUint8Array(keyData.public_key)
                });
            }

            await adminPushJson('/api/dashboard?mode=settings&action=push-subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: subscription.toJSON() })
            });
            if (button) button.textContent = '🔔 Payment Notifications Enabled';
            alert('✅ UPI payment claim notifications enabled.');
        } catch (error) {
            alert(error?.message || 'Notifications enable nahi ho paayi.');
            if (button) button.textContent = original;
        } finally {
            if (button) { button.disabled = false; updateNotificationButton(button); }
        }
    }

    function installAdminNotificationButton() {
        if (!isAdmin || document.getElementById('abhiPaymentClaimPushButton')) return;
        const mount = document.getElementById('viewControlsContainer') || document.getElementById('dashboard') || document.body;
        if (!mount) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'abhiPaymentClaimPushButton';
        button.className = 'btn no-print';
        button.style.cssText = 'min-height:36px;border:1px solid #bfdbfe;border-radius:10px;padding:7px 10px;background:#eff6ff;color:#1d4ed8;font-weight:800;cursor:pointer;font-size:11px;margin:4px;';
        updateNotificationButton(button);
        button.addEventListener('click', () => enablePaymentClaimNotifications(button));
        mount.appendChild(button);
    }

    function statementText(title, bodyHtml) {
        const holder = document.createElement('div');
        holder.innerHTML = String(bodyHtml || '');
        const text = String(holder.innerText || holder.textContent || '').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        const generated = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
        return `${String(title || 'AbhiTools Statement')}\n\n${text}\n\nAbhiTools • Abhishek Management\nGenerated ${generated}`;
    }

    function openPrintWindow(title, bodyHtml) {
        const win = window.open('', '_blank');
        if (!win) {
            alert('Print window block ho gayi. Browser me pop-ups allow karke dobara try karein.');
            return;
        }
        const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
        const safeTitle = escape(title || 'AbhiTools Statement');
        const generated = escape(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
        win.document.open();
        win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>
            *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;background:#eef2f7;padding:24px}.sheet{max-width:920px;margin:0 auto;background:#fff;padding:30px;border-radius:14px;box-shadow:0 12px 38px rgba(15,23,42,.12)}
            .brand{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid #1d4ed8;padding-bottom:14px;margin-bottom:18px}.brand h1{font-size:24px;margin:0;color:#1d4ed8}.brand p{margin:5px 0 0;color:#64748b}.doc-title{text-align:right}.doc-title strong{font-size:18px;display:block}.doc-title small{color:#64748b}
            .party{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:15px 0}.box{border:1px solid #dbe4f0;border-radius:9px;padding:11px}.box small{display:block;color:#64748b;margin-bottom:4px}.box strong{word-break:break-word}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:16px 0}.metric{padding:11px;border:1px solid #dbe4f0;border-radius:9px;background:#f8fafc}.metric small,.metric strong{display:block}.metric small{color:#64748b;margin-bottom:4px}.metric strong{font-size:17px}
            h2{font-size:16px;margin:22px 0 8px;color:#0f172a}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #dbe4f0;padding:8px;text-align:left;vertical-align:top}th{background:#f1f5f9}.right{text-align:right}.status{font-weight:700;text-transform:capitalize}.note{font-size:11px;color:#64748b;line-height:1.45;margin-top:14px}.footer{border-top:1px solid #dbe4f0;margin-top:24px;padding-top:10px;font-size:10px;color:#64748b;display:flex;justify-content:space-between;gap:15px}.receipt-amount{font-size:32px;font-weight:800;color:#15803d;margin:14px 0}.receipt-id{font-family:monospace;font-size:11px;color:#475569}
            @media(max-width:650px){body{padding:0;background:#fff}.sheet{padding:16px;box-shadow:none;border-radius:0}.party,.summary{grid-template-columns:1fr 1fr}.brand{flex-direction:column}.doc-title{text-align:left}table{font-size:10px}th,td{padding:5px}}@media print{body{background:#fff;padding:0}.sheet{max-width:none;box-shadow:none;border-radius:0;padding:10mm}.no-print{display:none!important}@page{size:A4;margin:8mm}}
        </style></head><body><main class="sheet">${String(bodyHtml || '')}<div class="footer"><span>AbhiTools • Abhishek Management</span><span>Generated ${generated}</span></div></main><script>setTimeout(()=>window.print(),350);<\/script></body></html>`);
        win.document.close();
    }

    function installStatementShareUpgrade() {
        if (!isAdmin || typeof window.phase6PrintDocument !== 'function') return;
        window.phase6PrintDocument = function(title, bodyHtml) {
            if (typeof navigator.share !== 'function') {
                openPrintWindow(title, bodyHtml);
                return;
            }

            document.getElementById('abhiStatementShareOverlay')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'abhiStatementShareOverlay';
            overlay.className = 'no-print';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:36000;background:rgba(15,23,42,.72);display:grid;place-items:center;padding:16px;';
            const card = document.createElement('section');
            card.style.cssText = 'width:min(430px,100%);background:#fff;color:#111827;border-radius:18px;padding:16px;box-shadow:0 24px 70px rgba(0,0,0,.35);font-family:system-ui,-apple-system,sans-serif;';
            const heading = document.createElement('h3');
            heading.textContent = 'Statement Ready';
            heading.style.cssText = 'margin:0 0 5px;font-size:17px;';
            const hint = document.createElement('p');
            hint.textContent = 'WhatsApp share ke liye Share button dabayein. Native share sheet me WhatsApp choose karein. Print/PDF ke liye Print use karein.';
            hint.style.cssText = 'margin:0 0 14px;color:#64748b;font-size:12px;line-height:1.45;';
            const row = document.createElement('div');
            row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
            const share = document.createElement('button');
            share.type = 'button'; share.textContent = '💬 Share on WhatsApp';
            share.style.cssText = 'min-height:44px;border:0;border-radius:11px;background:#16a34a;color:#fff;font-weight:800;cursor:pointer;';
            const print = document.createElement('button');
            print.type = 'button'; print.textContent = '🖨️ Print / Save PDF';
            print.style.cssText = 'min-height:44px;border:0;border-radius:11px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;';
            const cancel = document.createElement('button');
            cancel.type = 'button'; cancel.textContent = 'Cancel';
            cancel.style.cssText = 'grid-column:1/-1;min-height:40px;border:0;border-radius:10px;background:#e5e7eb;color:#374151;font-weight:750;cursor:pointer;';
            const close = () => overlay.remove();
            share.addEventListener('click', async () => {
                share.disabled = true; share.textContent = 'Sharing…';
                try {
                    await navigator.share({ title: String(title || 'AbhiTools Statement'), text: statementText(title, bodyHtml) });
                    close();
                } catch (error) {
                    if (error?.name !== 'AbortError') alert('Statement share nahi hua. Print option use kar sakte hain.');
                    if (document.body.contains(share)) { share.disabled = false; share.textContent = '💬 Share on WhatsApp'; }
                }
            });
            print.addEventListener('click', () => { close(); openPrintWindow(title, bodyHtml); });
            cancel.addEventListener('click', close);
            overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
            row.append(share, print, cancel);
            card.append(heading, hint, row);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
        };
        window.phase6PrintDocument.__abhiShareUpgradeV1 = true;
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
    installAdminMonthDetailXssGuard();
    installStatementShareUpgrade();
    installAdminNotificationButton();
    window.addEventListener('online', () => {
        if (document.getElementById('abhiReadFailureToast')) showReadFailureNotice();
    });
    body?.classList.add('ui-performance-ready');
})();
