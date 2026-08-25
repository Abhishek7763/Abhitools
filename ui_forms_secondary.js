// AbhiTools Design Build 4 — forms + secondary screens responsive presentation only.
(() => {
    'use strict';

    if (!document.body?.classList.contains('has-mobile-app-nav')) return;
    if (window.__ABHITOOLS_FORMS_SECONDARY_V4__) return;
    window.__ABHITOOLS_FORMS_SECONDARY_V4__ = true;

    const body = document.body;
    const mobileMq = window.matchMedia('(max-width: 760px)');
    const LOAN_CODE_MAX_LENGTH = 80;

    function visible(el) {
        if (!el) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function normalizeLoanCode(value) {
        return String(value ?? '').trim();
    }

    function ensureLoanCodeField() {
        const existing = document.getElementById('loanCode');
        if (existing) return existing;

        const amountInput = document.getElementById('loanAmount');
        const amountGroup = amountInput?.closest('.form-group');
        const coreGrid = amountGroup?.parentElement;
        if (!amountGroup || !coreGrid) return null;

        const group = document.createElement('div');
        group.className = 'form-group ui-loan-code-field';

        const label = document.createElement('label');
        label.htmlFor = 'loanCode';
        label.textContent = '🆔 Loan ID *';

        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'loanCode';
        input.maxLength = LOAN_CODE_MAX_LENGTH;
        input.placeholder = 'e.g. APP-LOAN-123';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('autocapitalize', 'none');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('aria-label', 'Loan ID');
        input.title = 'Dusre loan app ki exact Loan ID yahan enter karein.';

        group.append(label, input);
        coreGrid.insertBefore(group, amountGroup);
        return input;
    }

    function markPrimaryForm(containerId, kind) {
        const container = document.getElementById(containerId);
        if (!container || container.dataset.uiV4Enhanced === 'yes') return;
        container.dataset.uiV4Enhanced = 'yes';
        container.classList.add('ui-primary-form', `ui-${kind}-form`);

        const title = container.querySelector(':scope > h3');
        if (title) {
            title.classList.add('ui-form-header');
            if (!title.querySelector('.ui-form-close-btn')) {
                const close = document.createElement('button');
                close.type = 'button';
                close.className = 'ui-form-close-btn';
                close.setAttribute('aria-label', `Close ${kind} form`);
                close.textContent = '✕';
                close.addEventListener('click', () => {
                    if (kind === 'borrower' && typeof window.hideBorrowerForm === 'function') window.hideBorrowerForm();
                    if (kind === 'loan' && typeof window.hideForm === 'function') window.hideForm();
                });
                title.appendChild(close);
            }
        }

        if (kind === 'borrower') {
            container.querySelector('#borrowerForm > div')?.classList.add('ui-borrower-fields');
            const form = container.querySelector('#borrowerForm');
            form?.nextElementSibling?.classList.add('ui-form-action-bar');
        }

        if (kind === 'loan') {
            const candidates = Array.from(container.children).filter(el => el.tagName === 'DIV');
            const coreGrid = candidates.find(el => String(el.getAttribute('style') || '').includes('grid-template-columns:1fr 1fr 1fr'));
            coreGrid?.classList.add('ui-loan-core-fields');
            ensureLoanCodeField();
            const actionRow = candidates.find(el => Array.from(el.querySelectorAll('button')).some(btn => String(btn.getAttribute('onclick') || '').includes('saveLoan')));
            actionRow?.classList.add('ui-form-action-bar');
            document.getElementById('dynamicEmiContainer')?.classList.add('ui-emi-editor-list');
            markEmiRows();
        }
    }

    function markEmiRows() {
        document.querySelectorAll('#dynamicEmiContainer .emi-row').forEach((row, index) => {
            row.classList.add('ui-emi-editor-row');
            row.dataset.uiEmiIndex = String(index + 1);
            const inputs = row.querySelectorAll('input');
            const labels = ['Day', 'Month', 'Year', 'Amount'];
            inputs.forEach((input, i) => {
                if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', `EMI ${index + 1} ${labels[i] || 'field'}`);
            });
            row.querySelector('button')?.setAttribute('aria-label', `Remove EMI ${index + 1}`);
        });
    }

    function installLoanCodeIntegration() {
        if (window.__ABHITOOLS_MANUAL_LOAN_CODE__) return;
        if (typeof adminFetch !== 'function' || typeof showForm !== 'function' || typeof editLoan !== 'function') return;

        const coreAdminFetch = adminFetch;
        const coreShowForm = showForm;
        const coreEditLoan = editLoan;

        showForm = function(...args) {
            const result = coreShowForm.apply(this, args);
            const input = ensureLoanCodeField();
            if (input) {
                input.disabled = false;
                input.value = '';
                input.placeholder = 'e.g. APP-LOAN-123';
            }
            return result;
        };

        editLoan = async function(loanId) {
            const result = await coreEditLoan.call(this, loanId);
            const input = ensureLoanCodeField();
            const loan = typeof loans !== 'undefined' && Array.isArray(loans)
                ? loans.find(row => row.id === loanId)
                : null;
            if (input) {
                input.disabled = false;
                input.value = normalizeLoanCode(loan?.loan_code);
                input.placeholder = 'e.g. APP-LOAN-123';
            }
            return result;
        };

        adminFetch = async function(url, options = {}) {
            const target = String(url || '');
            const isLoanAdd = target === '/api/loans?action=add';
            const isLoanUpdate = target === '/api/loans?action=update';
            if (!isLoanAdd && !isLoanUpdate) return coreAdminFetch(url, options);

            const input = ensureLoanCodeField();
            if (!input) throw new Error('Loan ID field load nahi hui. Page refresh karke phir try karein.');

            const loanCode = normalizeLoanCode(input.value);
            if (!loanCode) throw new Error('Loan ID required hai. Dusre app wali exact Loan ID enter karein.');
            if (loanCode.length > LOAN_CODE_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(loanCode)) {
                throw new Error(`Loan ID 1-${LOAN_CODE_MAX_LENGTH} normal characters me honi chahiye.`);
            }

            let payload;
            try {
                payload = JSON.parse(String(options?.body || '{}'));
            } catch {
                throw new Error('Loan save request invalid hai. Page refresh karke phir try karein.');
            }

            const currentLoanId = String(payload.loan_id || document.getElementById('editLoanId')?.value || '').trim();
            const duplicateActive = typeof loans !== 'undefined' && Array.isArray(loans)
                ? loans.some(row => row.id !== currentLoanId && normalizeLoanCode(row.loan_code) === loanCode)
                : false;
            if (duplicateActive) throw new Error('Ye Loan ID kisi aur loan me already use ho rahi hai.');

            payload.loan_code = loanCode;
            return coreAdminFetch(url, { ...options, body: JSON.stringify(payload) });
        };

        window.__ABHITOOLS_MANUAL_LOAN_CODE__ = true;
    }

    function syncPrimaryFormState() {
        const borrower = document.getElementById('borrowerFormContainer');
        const loan = document.getElementById('loanFormContainer');
        const open = visible(borrower) || visible(loan);
        body.classList.toggle('ui-primary-form-open', open && mobileMq.matches);
        if (open && mobileMq.matches) {
            const current = visible(borrower) ? borrower : loan;
            current?.setAttribute('role', 'dialog');
            current?.setAttribute('aria-modal', 'true');
        }
    }

    const modalCloseMap = [
        ['dueCenterModal','closeDueCenter'],
        ['paymentModal','closePaymentModal'],
        ['dataSafetyModal','closeDataSafetyCenter'],
        ['borrowerDirectoryModal','closeBorrowerDirectory'],
        ['borrowerProfileModal','closeBorrowerProfile'],
        ['whatsappCenterModal','closeWhatsAppCenter'],
        ['advancedDashboardModal','closeAdvancedDashboard'],
        ['collectionCalendarModal','closeCollectionCalendar'],
        ['advancedSearchModal','closeAdvancedSearch'],
        ['settlementModal','closeSettlementCenter'],
        ['recycleBinModal','closeRecycleBin'],
        ['activityHistoryModal','closeActivityHistory'],
        ['reportsCenterModal','closeReportsCenter'],
        ['reminderCenterModal','closeReminderCenter'],
        ['dataQualityModal','closeDataQualityCenter'],
        ['collectionInsightsModal','closeCollectionInsights'],
        ['followupCenterModal','closeFollowupCenter'],
        ['settingsCenterModal','closeSettingsCenter'],
        ['releaseCenterModal','closeReleaseCenter']
    ];

    function closeTopVisibleLayer() {
        if (document.getElementById('uiLoanDetailOverlay') && typeof window.uiCloseLoanDetail === 'function') {
            window.uiCloseLoanDetail();
            return true;
        }
        if (document.getElementById('uiCollectionsOverlay')) {
            const close = document.querySelector('#uiCollectionsOverlay [data-ui-collections-close="yes"]');
            close?.click();
            return true;
        }
        if (document.getElementById('uiMoreOverlay') && !document.getElementById('uiMoreOverlay').hidden) return false;

        for (const [id, fnName] of modalCloseMap) {
            const modal = document.getElementById(id);
            if (!visible(modal)) continue;
            const fn = window[fnName];
            if (typeof fn === 'function') {
                fn();
                return true;
            }
        }

        if (visible(document.getElementById('borrowerFormContainer')) && typeof window.hideBorrowerForm === 'function') {
            window.hideBorrowerForm();
            return true;
        }
        if (visible(document.getElementById('loanFormContainer')) && typeof window.hideForm === 'function') {
            window.hideForm();
            return true;
        }
        return false;
    }

    function annotateSecondaryScreens() {
        const selectors = [
            '.due-card','.payment-card','.data-safety-card','.profile-card','.wa-card','.adv-dashboard-card',
            '.calendar-card','.search-pro-card','.settlement-card','.recycle-card','.audit-card','.reports-card',
            '.reminder-card','.dq-card','.ci-card','.followup-card','.settings-card','.release-card'
        ];
        document.querySelectorAll(selectors.join(',')).forEach(card => card.classList.add('ui-secondary-screen'));

        const overlaySelectors = [
            '.due-overlay','.payment-overlay','.data-safety-overlay','.profile-overlay','.wa-overlay','.adv-dashboard-overlay',
            '.calendar-overlay','.search-pro-overlay','.settlement-overlay','.recycle-overlay','.audit-overlay','.reports-overlay',
            '.reminder-overlay','.dq-overlay','.ci-overlay','.followup-overlay','.settings-overlay','.release-overlay'
        ];
        document.querySelectorAll(overlaySelectors.join(',')).forEach(overlay => overlay.classList.add('ui-secondary-overlay'));

        document.querySelector('.search-pro-filters')?.classList.add('ui-responsive-fields');
        document.querySelector('.reports-filters')?.classList.add('ui-responsive-fields');
        document.querySelector('.audit-filters')?.classList.add('ui-responsive-fields');
        document.querySelector('.followup-form-grid')?.classList.add('ui-responsive-fields');
        document.querySelector('.settlement-form-grid')?.classList.add('ui-responsive-fields');
        document.querySelector('.settings-grid')?.classList.add('ui-responsive-fields');
        document.querySelector('.wa-grid')?.classList.add('ui-responsive-fields');
        document.querySelector('.payment-form-grid')?.classList.add('ui-responsive-fields');
        document.querySelector('.profile-doc-upload-grid')?.classList.add('ui-responsive-fields');
        document.querySelector('.dq-meta-grid')?.classList.add('ui-responsive-fields');
    }

    function improveIconButtons() {
        document.querySelectorAll('button').forEach(btn => {
            const text = String(btn.textContent || '').trim();
            if ((text === '✕' || text === '×') && !btn.getAttribute('aria-label')) btn.setAttribute('aria-label', 'Close');
        });
    }

    markPrimaryForm('borrowerFormContainer', 'borrower');
    markPrimaryForm('loanFormContainer', 'loan');
    installLoanCodeIntegration();
    annotateSecondaryScreens();
    improveIconButtons();
    syncPrimaryFormState();

    const emiContainer = document.getElementById('dynamicEmiContainer');
    if (emiContainer) new MutationObserver(markEmiRows).observe(emiContainer, { childList:true });

    ['borrowerFormContainer','loanFormContainer'].forEach(id => {
        const el = document.getElementById(id);
        if (el) new MutationObserver(syncPrimaryFormState).observe(el, { attributes:true, attributeFilter:['style','class'] });
    });

    mobileMq.addEventListener?.('change', syncPrimaryFormState);

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (document.getElementById('uiMoreOverlay') && !document.getElementById('uiMoreOverlay').hidden) return;
        if (closeTopVisibleLayer()) event.preventDefault();
    });

    // Old Phase-15 quick nav is superseded by the Build-1 primary bottom nav.
    document.querySelectorAll('.phase15-mobile-nav').forEach(nav => {
        nav.setAttribute('aria-hidden', 'true');
        nav.classList.add('ui-legacy-nav-hidden');
    });

    body.classList.add('ui-forms-secondary-ready');
})();
