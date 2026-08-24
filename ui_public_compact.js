// AbhiTools public compact loan view — read-only presentation layer.
(() => {
    'use strict';

    if (window.__ABHITOOLS_PUBLIC_COMPACT_UI__) return;
    window.__ABHITOOLS_PUBLIC_COMPACT_UI__ = true;

    const esc = value => typeof publicEscapeHtml === 'function'
        ? publicEscapeHtml(value)
        : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

    // Keep exact/full Indian currency formatting. Never abbreviate to K/L/Cr.
    const money = value => `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const validIso = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));

    function injectStyles() {
        if (document.getElementById('abhiPublicCompactStyles')) return;
        const style = document.createElement('style');
        style.id = 'abhiPublicCompactStyles';
        style.textContent = `
            body.public-compact-ready #folderView {
                gap: 9px !important;
            }
            body.public-compact-ready #folderView .folder {
                min-height: 62px !important;
                padding: 10px 12px !important;
                border-radius: 12px !important;
                gap: 6px !important;
            }
            body.public-compact-ready #folderView .folder > div:first-child {
                font-size: 14px !important;
                font-weight: 700 !important;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            body.public-compact-ready #folderView .folder > div:last-child {
                font-size: 11px !important;
            }
            body.public-compact-ready #loanList {
                display: grid !important;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)) !important;
                gap: 10px !important;
                align-items: start !important;
            }
            body.public-compact-ready #loanList .public-loan-compact-card {
                min-height: 0 !important;
                height: auto !important;
                padding: 12px !important;
                margin: 0 !important;
                border-radius: 14px !important;
                border: 1px solid #e2e8f0 !important;
                border-left: 3px solid #1a73e8 !important;
                background: #fff;
                box-shadow: 0 3px 12px rgba(15,23,42,.06) !important;
                display: grid !important;
                gap: 9px !important;
            }
            body.public-compact-ready #loanList .public-loan-compact-card.state-overdue { border-left-color:#dc2626 !important; }
            body.public-compact-ready #loanList .public-loan-compact-card.state-incomplete { border-left-color:#7c3aed !important; }
            body.public-compact-ready #loanList .public-loan-compact-card.state-paid,
            body.public-compact-ready #loanList .public-loan-compact-card.state-closed { border-left-color:#16a34a !important; }
            .public-loan-compact-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
            .public-loan-compact-id { min-width:0; }
            .public-loan-compact-id small { display:block; color:#64748b; font-size:10px; }
            .public-loan-compact-id strong { display:block; color:#1d4ed8; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .public-loan-status { flex:0 0 auto; padding:4px 7px; border-radius:999px; font-size:8px; line-height:1.15; font-weight:800; letter-spacing:.03em; border:1px solid #dbeafe; background:#eff6ff; color:#1d4ed8; }
            .public-loan-status.overdue { color:#991b1b; background:#fef2f2; border-color:#fecaca; }
            .public-loan-status.incomplete { color:#6b21a8; background:#faf5ff; border-color:#e9d5ff; }
            .public-loan-status.paid,.public-loan-status.closed { color:#166534; background:#f0fdf4; border-color:#bbf7d0; }
            .public-loan-money-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
            .public-loan-money-grid > div { min-width:0; padding:8px 9px; border:1px solid #e5e7eb; border-radius:10px; background:#f8fafc; }
            .public-loan-money-grid small { display:block; color:#64748b; font-size:9px; margin-bottom:1px; }
            .public-loan-money-grid strong { display:block; color:#0f172a; font-size:14px; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums; }
            .public-loan-compact-meta { display:flex; gap:6px; flex-wrap:wrap; align-items:center; color:#64748b; font-size:9px; }
            .public-loan-chip { padding:4px 7px; border-radius:999px; background:#f1f5f9; color:#475569; font-weight:650; }
            .public-loan-alert { padding:7px 8px; border-radius:9px; background:#f8fafc; color:#475569; font-size:10px; line-height:1.35; }
            .public-loan-alert.overdue { color:#991b1b; background:#fef2f2; }
            .public-loan-alert.incomplete { color:#6b21a8; background:#faf5ff; }
            .public-loan-progress-line { display:grid; gap:4px; }
            .public-loan-progress-line > div:first-child { display:flex; justify-content:space-between; gap:8px; color:#64748b; font-size:9px; }
            .public-loan-progress-track { height:6px; overflow:hidden; border-radius:999px; background:#e5e7eb; }
            .public-loan-progress-track i { display:block; height:100%; border-radius:inherit; background:#16a34a; }
            .public-loan-open-btn { min-height:38px; width:100%; border:0; border-radius:10px; background:#1a73e8; color:#fff; font:700 11px/1.2 'Poppins',system-ui,sans-serif; cursor:pointer; }

            body.dark-mode .public-loan-compact-card { background:#1f1f1f !important; border-color:#3a3a3a !important; }
            body.dark-mode .public-loan-money-grid > div,
            body.dark-mode .public-loan-alert,
            body.dark-mode .public-loan-chip { background:#2a2a2a; border-color:#3a3a3a; color:#cbd5e1; }
            body.dark-mode .public-loan-money-grid strong { color:#f8fafc; }
            body.dark-mode .public-loan-compact-id small,
            body.dark-mode .public-loan-compact-meta,
            body.dark-mode .public-loan-progress-line > div:first-child { color:#a8b0bb; }

            .public-loan-detail-overlay { position:fixed; inset:0; z-index:32000; }
            .public-loan-detail-backdrop { position:absolute; inset:0; background:rgba(15,23,42,.58); backdrop-filter:blur(2px); }
            .public-loan-detail-panel { position:absolute; left:6px; right:6px; bottom:6px; max-height:calc(100dvh - 12px); overflow:hidden; border:1px solid #e2e8f0; border-radius:20px 20px 14px 14px; background:#fff; color:#0f172a; box-shadow:0 28px 80px rgba(0,0,0,.28); display:flex; flex-direction:column; }
            .public-loan-detail-head { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px 13px; border-bottom:1px solid #e5e7eb; }
            .public-loan-detail-head small { display:block; color:#64748b; font-size:9px; }
            .public-loan-detail-head h3 { margin:1px 0 0; font-size:15px; color:#1d4ed8; }
            .public-loan-detail-close { flex:0 0 40px; width:40px; height:40px; border:1px solid #e5e7eb; border-radius:11px; background:#f8fafc; color:#0f172a; cursor:pointer; font-size:17px; }
            .public-loan-detail-body { overflow:auto; overscroll-behavior:contain; padding:10px 10px calc(18px + env(safe-area-inset-bottom)); display:grid; gap:9px; }
            .public-loan-detail-summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
            .public-loan-detail-summary > div { padding:8px 9px; border:1px solid #e5e7eb; border-radius:10px; background:#f8fafc; }
            .public-loan-detail-summary small { display:block; color:#64748b; font-size:9px; }
            .public-loan-detail-summary strong { display:block; margin-top:2px; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .public-emi-list { display:grid; gap:7px; }
            .public-emi-row { display:grid; gap:6px; padding:9px 10px; border:1px solid #e5e7eb; border-radius:11px; background:#fff; }
            .public-emi-row.overdue { border-left:3px solid #dc2626; }
            .public-emi-row.incomplete { border-left:3px solid #7c3aed; }
            .public-emi-row.paid { border-left:3px solid #16a34a; }
            .public-emi-row-head { display:flex; justify-content:space-between; gap:8px; align-items:flex-start; }
            .public-emi-row-head strong { font-size:11px; }
            .public-emi-row-head small { display:block; color:#64748b; font-size:9px; }
            .public-emi-state { font-size:8px; font-weight:800; border-radius:999px; padding:4px 6px; background:#f1f5f9; color:#475569; }
            .public-emi-row-values { display:flex; justify-content:space-between; gap:8px; align-items:flex-end; }
            .public-emi-row-values > strong { font-size:15px; white-space:nowrap; }
            .public-emi-row-values small { color:#64748b; font-size:9px; text-align:right; }
            body.public-loan-detail-open { overflow:hidden !important; }
            body.dark-mode .public-loan-detail-panel,
            body.dark-mode .public-emi-row { background:#1f1f1f; color:#f8fafc; border-color:#3a3a3a; }
            body.dark-mode .public-loan-detail-head { border-color:#3a3a3a; }
            body.dark-mode .public-loan-detail-close,
            body.dark-mode .public-loan-detail-summary > div { background:#2a2a2a; color:#f8fafc; border-color:#3a3a3a; }

            @media (min-width:720px) {
                body.public-compact-ready #loanList { grid-template-columns:repeat(auto-fit,minmax(280px,1fr)) !important; }
                .public-loan-detail-panel { left:50%; right:auto; bottom:24px; width:min(720px,calc(100vw - 40px)); max-height:calc(100dvh - 48px); transform:translateX(-50%); border-radius:18px; }
                .public-loan-detail-summary { grid-template-columns:repeat(4,minmax(0,1fr)); }
                .public-emi-row { grid-template-columns:minmax(0,1fr) minmax(180px,.8fr); align-items:center; }
                .public-emi-row-values { align-items:center; }
            }
            @media (min-width:1100px) {
                body.public-compact-ready #loanList { grid-template-columns:repeat(3,minmax(0,1fr)) !important; }
            }
            @media (max-width:430px) {
                body.public-compact-ready #loanList { grid-template-columns:1fr !important; }
                .public-loan-money-grid strong { font-size:13px; }
                .public-loan-detail-panel { left:4px; right:4px; bottom:4px; max-height:calc(100dvh - 8px); }
            }
            @media print {
                .public-loan-detail-overlay { display:none !important; }
            }
        `;
        document.head.appendChild(style);
    }

    function emiState(emi) {
        const amount = Math.max(0, Number(emi?.amount) || 0);
        const paid = typeof publicEmiPaid === 'function' ? publicEmiPaid(emi) : Math.min(Math.max(Number(emi?.paid_amount) || 0, 0), amount);
        const remaining = Math.max(amount - paid, 0);
        const due = String(emi?.due_date || '').slice(0, 10);
        const business = String(publicDueData?.businessDate || '').slice(0, 10);
        const incomplete = !emi?.due_year || !validIso(due);
        const pastDue = !incomplete && remaining > 0 && validIso(business) && due < business;
        const dueToday = !incomplete && remaining > 0 && validIso(business) && due === business;

        if (remaining <= 0 && amount > 0) return { key:'paid', label:'PAID', amount, paid, remaining, incomplete:false };
        if (incomplete && paid > 0) return { key:'incomplete', label:'PARTIAL • DATE INCOMPLETE', amount, paid, remaining, incomplete:true };
        if (incomplete) return { key:'incomplete', label:'DATE INCOMPLETE', amount, paid, remaining, incomplete:true };
        if (pastDue && paid > 0) return { key:'overdue', label:'PARTIAL • OVERDUE', amount, paid, remaining, incomplete:false };
        if (pastDue) return { key:'overdue', label:'OVERDUE', amount, paid, remaining, incomplete:false };
        if (dueToday && paid > 0) return { key:'today', label:'PARTIAL • DUE TODAY', amount, paid, remaining, incomplete:false };
        if (dueToday) return { key:'today', label:'DUE TODAY', amount, paid, remaining, incomplete:false };
        if (paid > 0) return { key:'partial', label:'PARTIAL', amount, paid, remaining, incomplete:false };
        return { key:'pending', label:'PENDING', amount, paid, remaining, incomplete:false };
    }

    function dateText(emi) {
        const due = String(emi?.due_date || '').slice(0, 10);
        if (emi?.due_year && validIso(due)) {
            const d = new Date(`${due}T00:00:00Z`);
            if (!Number.isNaN(d.getTime())) {
                return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
            }
        }
        const day = Number(emi?.due_day) || '—';
        const month = String(emi?.due_month || '').toUpperCase() || '—';
        return `${day} ${month} • Year not set`;
    }

    function totalsFor(loan) {
        const emis = Array.isArray(loan?.emis) ? loan.emis : [];
        let emiTotal = 0, paid = 0, overdue = 0, incomplete = 0, paidCount = 0;
        for (const emi of emis) {
            const s = emiState(emi);
            emiTotal += s.amount;
            paid += s.paid;
            if (s.key === 'overdue') overdue += s.remaining;
            if (s.incomplete && s.remaining > 0) incomplete += 1;
            if (s.remaining <= 0 && s.amount > 0) paidCount += 1;
        }
        const remaining = Math.max(emiTotal - paid, 0);
        const progress = emiTotal > 0 ? Math.max(0, Math.min(100, (paid / emiTotal) * 100)) : 0;
        return { emiTotal, paid, remaining, overdue, incomplete, paidCount, emiCount:emis.length, progress };
    }

    function loanState(loan, totals) {
        if (loan?.status === 'closed') return { key:'closed', label:'CLOSED' };
        if (totals.overdue > 0) return { key:'overdue', label:'OVERDUE' };
        if (totals.incomplete > 0) return { key:'incomplete', label:'DATE INCOMPLETE' };
        if (totals.remaining <= 0 && totals.emiTotal > 0) return { key:'paid', label:'PAID' };
        return { key:'active', label:'ACTIVE' };
    }

    function closeDetail() {
        document.getElementById('publicLoanDetailOverlay')?.remove();
        document.body.classList.remove('public-loan-detail-open');
    }

    function openDetail(loanId) {
        const loan = loans.find(item => String(item.id) === String(loanId));
        if (!loan) return;
        closeDetail();
        const totals = totalsFor(loan);
        const borrower = loan.borrowers || {};
        const rows = [...(loan.emis || [])]
            .sort((a,b) => Number(a.installment_number || 0) - Number(b.installment_number || 0))
            .map(emi => {
                const s = emiState(emi);
                return `<article class="public-emi-row ${s.key}">
                    <div class="public-emi-row-head">
                        <div><strong>EMI #${Number(emi.installment_number || 0)}</strong><small>${esc(dateText(emi))}</small></div>
                        <span class="public-emi-state">${esc(s.label)}</span>
                    </div>
                    <div class="public-emi-row-values">
                        <strong>${money(s.amount)}</strong>
                        <small>Paid ${money(s.paid)}<br>Remaining ${money(s.remaining)}</small>
                    </div>
                </article>`;
            }).join('') || '<div style="padding:18px;text-align:center;color:#64748b;">Koi EMI schedule nahi.</div>';

        const overlay = document.createElement('div');
        overlay.id = 'publicLoanDetailOverlay';
        overlay.className = 'public-loan-detail-overlay no-print';
        overlay.innerHTML = `<div class="public-loan-detail-backdrop" data-public-loan-close="yes"></div>
            <section class="public-loan-detail-panel" role="dialog" aria-modal="true" aria-labelledby="publicLoanDetailTitle">
                <header class="public-loan-detail-head">
                    <div><small>${esc(borrower.name || currentOpenFolder || 'Borrower')}</small><h3 id="publicLoanDetailTitle">${esc(loan.loan_code || 'Loan')}</h3></div>
                    <button type="button" class="public-loan-detail-close" data-public-loan-close="yes" aria-label="Close">✕</button>
                </header>
                <div class="public-loan-detail-body">
                    <div class="public-loan-detail-summary">
                        <div><small>Total Amount</small><strong>${money(loan.amount)}</strong></div>
                        <div><small>EMI Total</small><strong>${money(totals.emiTotal)}</strong></div>
                        <div><small>Paid</small><strong>${money(totals.paid)}</strong></div>
                        <div><small>Remaining</small><strong>${money(totals.remaining)}</strong></div>
                    </div>
                    ${totals.incomplete ? `<div class="public-loan-alert incomplete">🧩 ${totals.incomplete} EMI date incomplete. Missing year is not treated as overdue.</div>` : ''}
                    <div class="public-emi-list">${rows}</div>
                </div>
            </section>`;
        document.body.appendChild(overlay);
        document.body.classList.add('public-loan-detail-open');
        setTimeout(() => overlay.querySelector('.public-loan-detail-close')?.focus(), 0);
    }

    // Replace the public folder's tall always-expanded EMI columns with short loan summaries.
    renderLoanList = function(nameFilter) {
        const list = document.getElementById('loanList');
        if (!list) return;
        list.innerHTML = '';

        const matching = loans.filter(loan => String(loan.borrowers?.name || '').toUpperCase() === String(nameFilter || '').toUpperCase());
        if (!matching.length) {
            list.innerHTML = '<p style="text-align:center;color:#777;grid-column:1/-1;">Koi loan nahi mila.</p>';
            return;
        }

        matching.forEach(loan => {
            const totals = totalsFor(loan);
            const state = loanState(loan, totals);
            const card = document.createElement('article');
            card.className = `card public-loan-compact-card state-${state.key}`;
            card.innerHTML = `<div class="public-loan-compact-head">
                    <div class="public-loan-compact-id"><small>Loan ID</small><strong>${esc(loan.loan_code || '—')}</strong></div>
                    <span class="public-loan-status ${state.key}">${state.label}</span>
                </div>
                <div class="public-loan-money-grid">
                    <div><small>Total Amount</small><strong title="${money(loan.amount)}">${money(loan.amount)}</strong></div>
                    <div><small>Remaining</small><strong title="${money(totals.remaining)}">${money(totals.remaining)}</strong></div>
                </div>
                <div class="public-loan-compact-meta">
                    <span class="public-loan-chip">Year: ${esc(loan.loan_year || 'Not set')}</span>
                    <span class="public-loan-chip">EMI ${totals.paidCount}/${totals.emiCount}</span>
                    <span class="public-loan-chip">Paid ${money(totals.paid)}</span>
                </div>
                ${totals.overdue > 0 ? `<div class="public-loan-alert overdue">🔴 Verified overdue: <b>${money(totals.overdue)}</b></div>` : totals.incomplete > 0 ? `<div class="public-loan-alert incomplete">🧩 ${totals.incomplete} EMI date incomplete</div>` : `<div class="public-loan-alert">EMI total: <b>${money(totals.emiTotal)}</b></div>`}
                <div class="public-loan-progress-line"><div><span>Repayment progress</span><b>${Math.round(totals.progress)}%</b></div><div class="public-loan-progress-track"><i style="width:${totals.progress.toFixed(1)}%"></i></div></div>
                <button type="button" class="public-loan-open-btn no-print" onclick="publicOpenLoanCompactDetail('${esc(loan.id)}')">View EMI Schedule</button>`;
            list.appendChild(card);
        });
    };

    window.publicOpenLoanCompactDetail = openDetail;
    window.publicCloseLoanCompactDetail = closeDetail;

    document.addEventListener('click', event => {
        if (event.target.closest('[data-public-loan-close="yes"]')) {
            event.preventDefault();
            closeDetail();
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById('publicLoanDetailOverlay')) closeDetail();
    });

    injectStyles();
    document.body.classList.add('public-compact-ready');
    if (typeof currentOpenFolder !== 'undefined' && currentOpenFolder) renderLoanList(currentOpenFolder);
})();
