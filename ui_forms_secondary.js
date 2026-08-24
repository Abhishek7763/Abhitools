// AbhiTools Design Build 4 — forms + secondary screens responsive presentation only.
(() => {
    'use strict';

    if (!document.body?.classList.contains('has-mobile-app-nav')) return;
    if (window.__ABHITOOLS_FORMS_SECONDARY_V4__) return;
    window.__ABHITOOLS_FORMS_SECONDARY_V4__ = true;

    const body = document.body;
    const mobileMq = window.matchMedia('(max-width: 760px)');

    function visible(el) {
        if (!el) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
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
