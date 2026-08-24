// AbhiTools Design Build 2 — compact Loans + EMI presentation only.
(() => {
    'use strict';

    if (!document.body?.classList.contains('has-mobile-app-nav')) return;
    if (window.__ABHITOOLS_LOANS_UI_V2__) return;
    window.__ABHITOOLS_LOANS_UI_V2__ = true;

    const money = value => `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
    const moneyCompact = value => {
        const amount = Math.max(0, Number(value) || 0);
        const fmt = (divisor, suffix) => {
            const scaled = amount / divisor;
            const digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
            return `₹${Number(scaled.toFixed(digits))}${suffix}`;
        };
        if (amount >= 10000000) return fmt(10000000, 'Cr');
        if (amount >= 100000) return fmt(100000, 'L');
        if (amount >= 1000) return fmt(1000, 'K');
        return money(amount);
    };
    const esc = value => typeof escapeHtml === 'function' ? escapeHtml(value) : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
    const validIso = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
    const isDateIncomplete = emi => !validIso(emi?.due_date) || !emi?.due_year;

    function businessDate() {
        return validIso(dueCenterData?.businessDate) ? String(dueCenterData.businessDate).slice(0, 10) : '';
    }

    function formatIso(value) {
        const raw = String(value || '').slice(0, 10);
        if (!validIso(raw)) return '';
        const d = new Date(`${raw}T00:00:00Z`);
        return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
    }

    function emiDateMeta(emi) {
        if (validIso(emi?.due_date) && emi?.due_year) {
            return { label: formatIso(emi.due_date), incomplete: false, hint: '' };
        }
        const base = `${emi?.due_day || '—'} ${String(emi?.due_month || '').toUpperCase()}`.trim();
        return { label: base || 'Date not set', incomplete: true, hint: 'Year not verified' };
    }

    function safeEmiState(emi) {
        const scheduled = Math.max(0, Number(emi?.amount) || 0);
        const paid = Math.max(0, Math.min(Number(emi?.paid_amount) || 0, scheduled));
        const remaining = Math.max(scheduled - paid, 0);
        const incomplete = isDateIncomplete(emi);
        const bd = businessDate();
        const due = String(emi?.due_date || '').slice(0, 10);
        const pastDue = !incomplete && remaining > 0 && validIso(bd) && validIso(due) && due < bd;
        const dueToday = !incomplete && remaining > 0 && validIso(bd) && validIso(due) && due === bd;

        if (remaining <= 0 && scheduled > 0) return { key:'paid', label:'PAID', icon:'✓', paid, remaining, incomplete };
        if (incomplete && paid > 0) return { key:'incomplete-partial', label:'PARTIAL • DATE INCOMPLETE', icon:'!', paid, remaining, incomplete:true };
        if (incomplete) return { key:'incomplete', label:'DATE INCOMPLETE', icon:'!', paid, remaining, incomplete:true };
        if (pastDue && paid > 0) return { key:'overdue', label:'PARTIAL • OVERDUE', icon:'!', paid, remaining, incomplete:false };
        if (pastDue) return { key:'overdue', label:'OVERDUE', icon:'!', paid, remaining, incomplete:false };
        if (dueToday && paid > 0) return { key:'today', label:'PARTIAL • DUE TODAY', icon:'•', paid, remaining, incomplete:false };
        if (dueToday) return { key:'today', label:'DUE TODAY', icon:'•', paid, remaining, incomplete:false };
        if (paid > 0) return { key:'partial', label:'PARTIAL', icon:'•', paid, remaining, incomplete:false };
        return { key:'pending', label:'PENDING', icon:'•', paid, remaining, incomplete:false };
    }

    function loanTotals(loan) {
        const emis = Array.isArray(loan?.emis) ? loan.emis : [];
        let scheduled = 0;
        let paid = 0;
        let overdue = 0;
        let incomplete = 0;
        let incompleteRemaining = 0;
        let next = null;
        let paidCount = 0;

        for (const emi of emis) {
            const amount = Math.max(0, Number(emi.amount) || 0);
            const p = Math.max(0, Math.min(Number(emi.paid_amount) || 0, amount));
            const r = Math.max(amount - p, 0);
            const state = safeEmiState(emi);
            scheduled += amount;
            paid += p;
            if (r <= 0 && amount > 0) paidCount += 1;
            if (state.key === 'overdue') overdue += r;
            if (state.incomplete && r > 0) { incomplete += 1; incompleteRemaining += r; }
            if (!state.incomplete && r > 0 && validIso(emi.due_date)) {
                const due = String(emi.due_date).slice(0, 10);
                if (!next || due < next.due) next = { due, emi };
            }
        }

        const settlement = typeof activeLoanSettlement === 'function' ? activeLoanSettlement(loan) : null;
        const waived = settlement ? Math.max(0, Number(settlement.waived_amount) || 0) : 0;
        const rawRemaining = Math.max(scheduled - paid, 0);
        const remaining = settlement ? Math.max(rawRemaining - waived, 0) : rawRemaining;
        if (settlement) overdue = 0;
        const progress = scheduled > 0 ? Math.max(0, Math.min(100, (paid / scheduled) * 100)) : 0;

        return { scheduled, paid, overdue, incomplete, incompleteRemaining, next, waived, rawRemaining, remaining, progress, paidCount, emiCount: emis.length, settlement };
    }

    function loanState(loan, totals) {
        if (loan?.status === 'closed') return { key:'closed', label:'CLOSED' };
        if (loan?.status === 'defaulted') return { key:'defaulted', label:'DEFAULTED' };
        if (totals.overdue > 0) return { key:'overdue', label:'OVERDUE' };
        if (totals.incomplete > 0) return { key:'incomplete', label:'DATE INCOMPLETE' };
        if (totals.remaining <= 0 && totals.scheduled > 0) return { key:'paid', label:'PAID UP' };
        return { key:'active', label:'ACTIVE' };
    }

    function nextDueText(totals) {
        if (totals.incomplete > 0 && !totals.next) return `${totals.incomplete} EMI date incomplete`;
        if (totals.next) {
            const extra = totals.incomplete > 0 ? ` • ${totals.incomplete} incomplete` : '';
            return `Next ${formatIso(totals.next.due)}${extra}`;
        }
        if (totals.remaining <= 0) return 'No pending EMI';
        return totals.incomplete > 0 ? `${totals.incomplete} EMI date incomplete` : 'Next due not available';
    }

    function closeLoanDetail() {
        const overlay = document.getElementById('uiLoanDetailOverlay');
        if (overlay) overlay.remove();
        document.body.classList.remove('ui-loan-detail-open');
    }

    function ensureLoanDetailOverlay() {
        closeLoanDetail();
        const overlay = document.createElement('div');
        overlay.id = 'uiLoanDetailOverlay';
        overlay.className = 'ui-loan-detail-overlay no-print';
        overlay.innerHTML = `<div class="ui-loan-detail-backdrop" data-ui-loan-close="yes"></div><section class="ui-loan-detail-panel" role="dialog" aria-modal="true" aria-labelledby="uiLoanDetailTitle"><div id="uiLoanDetailMount"></div></section>`;
        document.body.appendChild(overlay);
        document.body.classList.add('ui-loan-detail-open');
        return overlay;
    }

    function actionButton(label, cls, onclick, attrs = '') {
        return `<button type="button" class="btn ${cls}" onclick="${onclick}" ${attrs}>${label}</button>`;
    }

    function renderOverview(loan, totals) {
        const borrower = loan.borrowers || {};
        const state = loanState(loan, totals);
        return `<div class="ui-loan-overview">
            <div class="ui-loan-kpis">
                <div><small>Original</small><strong>${money(loan.amount)}</strong></div>
                <div><small>Collected</small><strong>${money(totals.paid)}</strong></div>
                <div><small>Outstanding</small><strong>${money(totals.remaining)}</strong></div>
                <div><small>EMIs</small><strong>${totals.paidCount}/${totals.emiCount}</strong></div>
            </div>
            <div class="ui-loan-progress-block">
                <div><span>Repayment progress</span><strong>${Math.round(totals.progress)}%</strong></div>
                <div class="ui-loan-progress"><i style="width:${totals.progress.toFixed(1)}%"></i></div>
            </div>
            <div class="ui-loan-info-grid">
                <div><small>Borrower</small><strong>${esc(borrower.name || 'Unknown')}</strong></div>
                <div><small>Loan ID</small><strong>${esc(loan.loan_code || '—')}</strong></div>
                <div><small>Loan year</small><strong>${loan.loan_year || 'Not set'}</strong></div>
                <div><small>Status</small><strong><span class="ui-loan-status ${state.key}">${state.label}</span></strong></div>
                <div><small>Next due</small><strong>${esc(nextDueText(totals))}</strong></div>
                <div><small>Overdue</small><strong>${money(totals.overdue)}</strong></div>
                ${totals.waived ? `<div><small>Waived / adjusted</small><strong>${money(totals.waived)}</strong></div>` : ''}
                ${totals.incomplete ? `<div class="warning"><small>Data quality</small><strong>${totals.incomplete} EMI date incomplete</strong></div>` : ''}
            </div>
            ${loan.notes ? `<div class="ui-loan-note"><small>Loan notes</small><p>${esc(loan.notes)}</p></div>` : ''}
        </div>`;
    }

    function renderPaymentsTab(loan) {
        const emis = [...(loan.emis || [])].sort((a,b) => Number(a.installment_number||0)-Number(b.installment_number||0));
        if (!emis.length) return '<div class="ui-loan-empty">No EMI/payment schedule.</div>';
        return `<div class="ui-payment-list">${emis.map(emi => {
            const state = safeEmiState(emi);
            const date = emiDateMeta(emi);
            const canPay = state.remaining > 0 && loan.status !== 'closed';
            return `<div class="ui-payment-row">
                <div><strong>EMI #${Number(emi.installment_number || 0)}</strong><small>${esc(date.label)}${date.hint ? ` • ${esc(date.hint)}` : ''}</small></div>
                <div><span>Paid <b>${money(state.paid)}</b></span><span>Remaining <b>${money(state.remaining)}</b></span></div>
                <button class="btn ${canPay ? 'btn-success' : 'btn-secondary'}" onclick="uiLoanAction('payment','${esc(emi.id)}')">${canPay ? '💰 Pay' : '🧾 History'}</button>
            </div>`;
        }).join('')}</div>`;
    }

    function renderDocumentsTab(loan) {
        const borrowerId = loan.borrower_id || loan.borrowers?.id || '';
        return `<div class="ui-loan-tool-card"><span>📎</span><div><strong>Documents</strong><p>Borrower profile me loan agreements, receipts, ID proofs aur uploaded files manage karein.</p></div>${actionButton('Open Documents','btn-view',`uiLoanAction('profile','${esc(borrowerId)}')`)}</div>`;
    }

    function renderFollowupTab(loan) {
        const borrowerId = loan.borrower_id || loan.borrowers?.id || '';
        return `<div class="ui-loan-tool-card"><span>📋</span><div><strong>Follow-up / PTP</strong><p>Is loan ke liye contact note, callback ya Promise-to-Pay record karein.</p></div>${actionButton('Add Follow-up','btn-view',`uiLoanAction('followup','${esc(loan.id)}','${esc(borrowerId)}')`)}</div>`;
    }

    function renderMoreTab(loan, totals) {
        const borrower = loan.borrowers || {};
        const borrowerId = loan.borrower_id || borrower.id || '';
        const hasContact = Boolean(borrower.whatsapp || borrower.phone);
        return `<div class="ui-loan-more-grid">
            ${loan.status !== 'closed' ? actionButton('✏️ Edit Loan','btn-warning',`uiLoanAction('edit','${esc(loan.id)}')`) : ''}
            ${actionButton('🧾 Statement','btn-view',`uiLoanAction('statement','${esc(loan.id)}')`)}
            ${actionButton(loan.status === 'closed' ? '🔒 Settlement' : '🤝 Settle / Close','btn-secondary',`uiLoanAction('settlement','${esc(loan.id)}')`)}
            ${actionButton('💬 WhatsApp','btn-success',`uiLoanAction('whatsapp','${esc(loan.id)}','${esc(borrowerId)}')`, hasContact ? '' : 'disabled')}
            ${totals.incomplete ? actionButton('🧩 Fix EMI Dates','btn-view',`uiLoanAction('quality','${esc(loan.loan_code || '')}')`) : ''}
            ${actionButton('♻️ Recycle Loan','btn-danger',`uiLoanAction('recycle','${esc(loan.id)}')`)}
        </div>`;
    }

    function setLoanDetailTab(tab) {
        const panel = document.getElementById('uiLoanDetailPanelContent');
        const overlay = document.getElementById('uiLoanDetailOverlay');
        if (!panel || !overlay) return;
        const loanId = overlay.dataset.loanId;
        const loan = loans.find(l => l.id === loanId);
        if (!loan) return;
        const totals = loanTotals(loan);
        overlay.dataset.tab = tab;
        overlay.querySelectorAll('[data-ui-loan-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.uiLoanTab === tab));
        if (tab === 'overview') panel.innerHTML = renderOverview(loan, totals);
        else if (tab === 'emi') panel.innerHTML = `<div class="ui-emi-detail-list">${renderEmiList(loan.emis || [], loan.id)}</div>`;
        else if (tab === 'payments') panel.innerHTML = renderPaymentsTab(loan);
        else if (tab === 'documents') panel.innerHTML = renderDocumentsTab(loan);
        else if (tab === 'followup') panel.innerHTML = renderFollowupTab(loan);
        else panel.innerHTML = renderMoreTab(loan, totals);
    }

    function openLoanDetail(loanId, initialTab = 'overview') {
        const loan = loans.find(l => l.id === loanId);
        if (!loan) return;
        const totals = loanTotals(loan);
        const state = loanState(loan, totals);
        const borrower = loan.borrowers || {};
        const overlay = ensureLoanDetailOverlay();
        overlay.dataset.loanId = loanId;
        const mount = document.getElementById('uiLoanDetailMount');
        mount.innerHTML = `<header class="ui-loan-detail-head">
            <div class="ui-loan-detail-title"><small>${esc(borrower.name || 'Borrower')}</small><h3 id="uiLoanDetailTitle">${esc(loan.loan_code || 'Loan')}</h3><span class="ui-loan-status ${state.key}">${state.label}</span></div>
            <button class="ui-loan-detail-close" type="button" data-ui-loan-close="yes" aria-label="Close loan details">✕</button>
        </header>
        <nav class="ui-loan-tabs" aria-label="Loan detail sections">
            <button data-ui-loan-tab="overview">Overview</button>
            <button data-ui-loan-tab="emi">EMI Schedule</button>
            <button data-ui-loan-tab="payments">Payments</button>
            <button data-ui-loan-tab="documents">Documents</button>
            <button data-ui-loan-tab="followup">Follow-up</button>
            <button data-ui-loan-tab="more">More</button>
        </nav>
        <div id="uiLoanDetailPanelContent" class="ui-loan-detail-content"></div>`;
        setLoanDetailTab(initialTab);
        window.setTimeout(() => overlay.querySelector('.ui-loan-detail-close')?.focus(), 0);
    }

    // Replaces the old full-EMI-in-every-card view with compact loan summaries.
    renderLoanList = function(nameFilter) {
        const list = document.getElementById('loanList');
        if (!list) return;
        list.innerHTML = '';
        const matching = loans.filter(loan => String(loan.borrowers?.name || '').toUpperCase() === String(nameFilter || '').toUpperCase());

        if (!matching.length) {
            list.innerHTML = '<div class="ui-loan-empty">No loans found for this borrower.</div>';
            return;
        }

        matching
            .sort((a,b) => (a.status === 'closed') - (b.status === 'closed') || String(b.loan_date || '').localeCompare(String(a.loan_date || '')))
            .forEach(loan => {
                const totals = loanTotals(loan);
                const state = loanState(loan, totals);
                const borrower = loan.borrowers || {};
                const card = document.createElement('article');
                card.className = `card ui-loan-card state-${state.key}`;
                card.dataset.loanId = loan.id;
                card.innerHTML = `<div class="ui-loan-card-top">
                    <div class="ui-loan-card-title"><small>${esc(borrower.name || nameFilter || 'Borrower')}</small><strong>${esc(loan.loan_code || 'Loan')}</strong></div>
                    <span class="ui-loan-status ${state.key}">${state.label}</span>
                </div>
                <div class="ui-loan-card-money">
                    <div><small>Original</small><strong title="${money(loan.amount)}">${moneyCompact(loan.amount)}</strong></div>
                    <div><small>Outstanding</small><strong title="${money(totals.remaining)}">${moneyCompact(totals.remaining)}</strong></div>
                </div>
                <div class="ui-loan-card-due ${totals.incomplete ? 'has-incomplete' : ''}"><span>${totals.incomplete ? '🧩' : '📅'}</span><strong>${esc(nextDueText(totals))}</strong>${totals.overdue ? `<b title="${money(totals.overdue)} overdue">${moneyCompact(totals.overdue)} overdue</b>` : ''}</div>
                <div class="ui-loan-card-progress"><div><span>${totals.paidCount}/${totals.emiCount} EMIs paid</span><strong>${Math.round(totals.progress)}%</strong></div><div class="ui-loan-progress"><i style="width:${totals.progress.toFixed(1)}%"></i></div></div>
                <div class="ui-loan-card-actions no-print"><button class="btn btn-view" onclick="uiOpenLoanDetail('${esc(loan.id)}')">Open</button><button class="ui-loan-more-btn" aria-label="More loan actions" title="More actions" onclick="uiOpenLoanDetail('${esc(loan.id)}','more')">•••</button></div>`;
                list.appendChild(card);
            });
    };

    // Safe EMI renderer: unknown-year/date rows can never be visually labelled overdue.
    renderEmiList = function(emis, loanId) {
        if (!Array.isArray(emis) || !emis.length) return '<div class="ui-loan-empty">No EMI schedule.</div>';
        const loan = loans.find(l => l.id === loanId) || {};
        return [...emis].sort((a,b) => Number(a.installment_number||0)-Number(b.installment_number||0)).map(emi => {
            const state = safeEmiState(emi);
            const date = emiDateMeta(emi);
            const amount = Math.max(0, Number(emi.amount) || 0);
            const canPay = state.remaining > 0 && loan.status !== 'closed';
            const canCorrectStatus = !state.incomplete && state.paid === 0 && loan.status !== 'closed';
            return `<article class="ui-emi-card state-${state.key}">
                <div class="ui-emi-head"><div><strong>EMI #${Number(emi.installment_number || 0)}</strong><small>${esc(date.label)}</small></div><span class="ui-emi-status ${state.key}">${state.label}</span></div>
                <div class="ui-emi-amount"><strong>${money(amount)}</strong>${state.paid > 0 ? `<small>Paid ${money(state.paid)} • Remaining ${money(state.remaining)}</small>` : `<small>${date.hint ? esc(date.hint) : 'Payment pending'}</small>`}</div>
                ${date.hint ? `<div class="ui-emi-warning">${esc(date.hint)} • automatic overdue calculation disabled</div>` : ''}
                <div class="ui-emi-actions no-print">
                    ${canPay ? `<button class="btn btn-success" onclick="openPaymentModal('${esc(emi.id)}')">💰 Record Payment</button>` : `<button class="btn btn-secondary" onclick="openPaymentModal('${esc(emi.id)}')">🧾 Payment History</button>`}
                    ${state.incomplete && state.remaining > 0 ? `<button class="btn btn-view" onclick="uiLoanAction('quality','${esc(loan.loan_code || '')}')">🧩 Fix Date</button>` : ''}
                    ${canCorrectStatus ? `<details class="ui-emi-more"><summary>More</summary><div><label>Status correction<select onchange="changeEmiStatus('${esc(emi.id)}',this.value);this.value=''"><option value="">Choose…</option><option value="pending">Pending</option><option value="overdue">Overdue</option></select></label></div></details>` : ''}
                </div>
            </article>`;
        }).join('');
    };

    window.uiOpenLoanDetail = openLoanDetail;
    window.uiCloseLoanDetail = closeLoanDetail;
    window.uiSetLoanDetailTab = setLoanDetailTab;
    window.uiLoanAction = function(action, id = '', aux = '') {
        closeLoanDetail();
        window.setTimeout(() => {
            if (action === 'payment') openPaymentModal(id);
            else if (action === 'profile') openBorrowerProfile(id);
            else if (action === 'followup') openFollowupCenter({ borrowerId:aux, loanId:id, showForm:true });
            else if (action === 'edit') editLoan(id);
            else if (action === 'statement') printLoanAccountStatement(id);
            else if (action === 'settlement') openSettlementCenter(id);
            else if (action === 'whatsapp') openWhatsAppCenter({ borrowerId:aux, loanId:id, template:'due' });
            else if (action === 'quality') {
                openDataQualityCenter('dates');
                window.setTimeout(() => {
                    const q = document.getElementById('dqSearch');
                    if (q && id) { q.value = id; if (typeof renderDataQualityList === 'function') renderDataQualityList(); }
                }, 500);
            }
            else if (action === 'recycle') deleteLoan(id);
        }, 20);
    };

    document.addEventListener('click', event => {
        const close = event.target.closest('[data-ui-loan-close="yes"]');
        if (close) { event.preventDefault(); closeLoanDetail(); return; }
        const tab = event.target.closest('[data-ui-loan-tab]');
        if (tab) { event.preventDefault(); setLoanDetailTab(tab.dataset.uiLoanTab || 'overview'); }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById('uiLoanDetailOverlay')) closeLoanDetail();
    });

    // Re-render an already-open borrower folder with the new compact presentation.
    if (typeof currentOpenFolder !== 'undefined' && currentOpenFolder) renderLoanList(currentOpenFolder);
})();
