// AbhiTools Design Build 5 — ultra-compact public loans + dedicated print/PDF.
(() => {
    'use strict';

    if (window.__ABHITOOLS_PUBLIC_COMPACT_UI_B5__) return;
    window.__ABHITOOLS_PUBLIC_COMPACT_UI_B5__ = true;

    const esc = value => typeof publicEscapeHtml === 'function'
        ? publicEscapeHtml(value)
        : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

    // Full Indian currency only — never K/L/Cr abbreviations.
    const money = value => `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const validIso = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));

    function injectStyles() {
        document.getElementById('abhiPublicCompactStyles')?.remove();
        const style = document.createElement('style');
        style.id = 'abhiPublicCompactStyles';
        style.textContent = `
            body.public-compact-ready #folderView { gap:8px!important; }
            body.public-compact-ready #folderView .folder {
                min-height:56px!important; padding:9px 11px!important; margin-bottom:8px!important;
                border-radius:11px!important; gap:6px!important;
            }
            body.public-compact-ready #folderView .folder>div:first-child {
                font-size:13px!important; font-weight:750!important; min-width:0;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
            }
            body.public-compact-ready #folderView .folder>div:last-child,
            body.public-compact-ready #folderView .folder span { font-size:10px!important; }

            body.public-compact-ready #detailView>.controls { margin-bottom:7px!important; }
            body.public-compact-ready #currentFolderName { margin:7px 0 10px!important; line-height:1.15!important; }
            body.public-compact-ready #currentFolderName>span { margin-top:4px!important; padding:4px 10px!important; font-size:11px!important; }
            body.public-compact-ready #loanList {
                display:grid!important; grid-template-columns:repeat(auto-fit,minmax(245px,1fr))!important;
                gap:8px!important; align-items:start!important;
            }

            .public-loan-mini-card {
                min-height:0!important; height:auto!important; margin:0!important; padding:10px 11px!important;
                border:1px solid #e2e8f0!important; border-left:3px solid #1a73e8!important;
                border-radius:13px!important; background:#fff!important;
                box-shadow:0 2px 10px rgba(15,23,42,.055)!important;
                display:grid!important; gap:7px!important;
            }
            .public-loan-mini-card.state-overdue { border-left-color:#dc2626!important; }
            .public-loan-mini-card.state-incomplete { border-left-color:#7c3aed!important; }
            .public-loan-mini-card.state-paid,.public-loan-mini-card.state-closed { border-left-color:#16a34a!important; }

            .public-loan-mini-head { display:flex; align-items:center; justify-content:space-between; gap:8px; min-width:0; }
            .public-loan-mini-id { min-width:0; line-height:1.1; }
            .public-loan-mini-id small { display:block; color:#64748b; font-size:8px; margin-bottom:1px; }
            .public-loan-mini-id strong { display:block; color:#1d4ed8; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .public-loan-mini-status {
                flex:0 0 auto; max-width:48%; padding:3px 6px; border-radius:999px; border:1px solid #dbeafe;
                background:#eff6ff; color:#1d4ed8; font-size:7px; line-height:1.15; font-weight:850;
                letter-spacing:.025em; text-align:center;
            }
            .public-loan-mini-status.overdue { color:#991b1b; background:#fef2f2; border-color:#fecaca; }
            .public-loan-mini-status.incomplete { color:#6b21a8; background:#faf5ff; border-color:#e9d5ff; }
            .public-loan-mini-status.paid,.public-loan-mini-status.closed { color:#166534; background:#f0fdf4; border-color:#bbf7d0; }

            .public-loan-mini-metrics {
                display:grid; grid-template-columns:1.15fr 1.15fr .72fr; gap:5px;
                padding:6px 7px; border:1px solid #e5e7eb; border-radius:10px; background:#f8fafc;
            }
            .public-loan-mini-metric { min-width:0; }
            .public-loan-mini-metric+ .public-loan-mini-metric { border-left:1px solid #e2e8f0; padding-left:7px; }
            .public-loan-mini-metric small { display:block; color:#64748b; font-size:7px; line-height:1.15; }
            .public-loan-mini-metric strong {
                display:block; color:#0f172a; font-size:12px; line-height:1.2; margin-top:2px;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums;
            }

            .public-loan-mini-info {
                min-height:27px; display:flex; align-items:center; gap:5px; flex-wrap:wrap;
                color:#64748b; font-size:8px;
            }
            .public-loan-mini-chip { padding:3px 6px; border-radius:999px; background:#f1f5f9; color:#475569; font-weight:700; }
            .public-loan-mini-quality { color:#6b21a8; font-weight:750; }
            .public-loan-mini-overdue { color:#991b1b; font-weight:750; }

            .public-loan-mini-footer {
                display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px;
                padding-top:1px;
            }
            .public-loan-mini-progress { min-width:0; display:grid; grid-template-columns:auto 1fr auto; gap:5px; align-items:center; }
            .public-loan-mini-progress small,.public-loan-mini-progress b { font-size:7px; color:#64748b; white-space:nowrap; }
            .public-loan-mini-track { height:5px; overflow:hidden; border-radius:999px; background:#e5e7eb; }
            .public-loan-mini-track i { display:block; height:100%; border-radius:inherit; background:#16a34a; }
            .public-loan-mini-open {
                min-height:38px; padding:7px 10px; border:0; border-radius:9px; background:#1a73e8; color:#fff;
                font:750 9px/1.15 'Poppins',system-ui,sans-serif; white-space:nowrap; cursor:pointer;
            }

            body.dark-mode .public-loan-mini-card { background:#1f1f1f!important; border-color:#3a3a3a!important; }
            body.dark-mode .public-loan-mini-metrics { background:#292929; border-color:#3a3a3a; }
            body.dark-mode .public-loan-mini-metric+ .public-loan-mini-metric { border-left-color:#3a3a3a; }
            body.dark-mode .public-loan-mini-metric strong { color:#f8fafc; }
            body.dark-mode .public-loan-mini-chip { background:#2a2a2a; color:#cbd5e1; }
            body.dark-mode .public-loan-mini-id small,
            body.dark-mode .public-loan-mini-metric small,
            body.dark-mode .public-loan-mini-progress small,
            body.dark-mode .public-loan-mini-progress b { color:#a8b0bb; }
            body.dark-mode .public-loan-mini-track { background:#3a3a3a; }

            /* Compact public bottom nav: still comfortable to tap, less screen occupation. */
            @media(max-width:720px) {
                body.public-compact-ready { padding-bottom:calc(68px + env(safe-area-inset-bottom))!important; }
                body.public-compact-ready .phase15-mobile-nav {
                    left:6px; right:6px; bottom:calc(5px + env(safe-area-inset-bottom)); min-height:52px;
                    padding:3px 4px; border-radius:14px;
                }
                body.public-compact-ready .phase15-mobile-nav button { min-height:44px; padding:3px 1px; gap:0; }
                body.public-compact-ready .phase15-mobile-nav button span { font-size:17px; line-height:19px; }
                body.public-compact-ready .phase15-mobile-nav button small { font-size:7px; line-height:10px; }
                body.public-compact-ready #loanList { padding-bottom:8px; }
            }
            @media(max-width:430px) {
                body.public-compact-ready #loanList { grid-template-columns:1fr!important; gap:7px!important; }
                .public-loan-mini-card { padding:9px 10px!important; gap:6px!important; }
                .public-loan-mini-metrics { padding:5px 6px; }
                .public-loan-mini-metric strong { font-size:11px; }
                .public-loan-mini-footer { gap:6px; }
                .public-loan-mini-open { padding:7px 9px; }
            }
            @media(min-width:720px) {
                body.public-compact-ready #loanList { grid-template-columns:repeat(auto-fit,minmax(270px,1fr))!important; }
            }
            @media(min-width:1100px) {
                body.public-compact-ready #loanList { grid-template-columns:repeat(3,minmax(0,1fr))!important; }
            }

            /* Read-only EMI detail sheet */
            .public-loan-detail-overlay { position:fixed; inset:0; z-index:32000; }
            .public-loan-detail-backdrop { position:absolute; inset:0; background:rgba(15,23,42,.58); backdrop-filter:blur(2px); }
            .public-loan-detail-panel {
                position:absolute; left:5px; right:5px; bottom:5px; max-height:calc(100dvh - 10px); overflow:hidden;
                border:1px solid #e2e8f0; border-radius:18px 18px 13px 13px; background:#fff; color:#0f172a;
                box-shadow:0 28px 80px rgba(0,0,0,.28); display:flex; flex-direction:column;
            }
            .public-loan-detail-head { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 11px; border-bottom:1px solid #e5e7eb; }
            .public-loan-detail-head small { display:block; color:#64748b; font-size:8px; }
            .public-loan-detail-head h3 { margin:1px 0 0; font-size:14px; color:#1d4ed8; }
            .public-loan-detail-close { flex:0 0 40px; width:40px; height:40px; border:1px solid #e5e7eb; border-radius:10px; background:#f8fafc; color:#0f172a; cursor:pointer; font-size:16px; }
            .public-loan-detail-body { overflow:auto; overscroll-behavior:contain; padding:8px 8px calc(14px + env(safe-area-inset-bottom)); display:grid; gap:7px; }
            .public-loan-detail-summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; }
            .public-loan-detail-summary>div { padding:7px 8px; border:1px solid #e5e7eb; border-radius:9px; background:#f8fafc; }
            .public-loan-detail-summary small { display:block; color:#64748b; font-size:8px; }
            .public-loan-detail-summary strong { display:block; margin-top:1px; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .public-loan-detail-note { padding:7px 8px; border-radius:8px; background:#faf5ff; color:#6b21a8; font-size:8px; }
            .public-emi-list { display:grid; gap:5px; }
            .public-emi-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:7px; align-items:center; padding:8px 9px; border:1px solid #e5e7eb; border-radius:10px; background:#fff; }
            .public-emi-row.overdue { border-left:3px solid #dc2626; }
            .public-emi-row.incomplete { border-left:3px solid #7c3aed; }
            .public-emi-row.paid { border-left:3px solid #16a34a; }
            .public-emi-row-head { min-width:0; }
            .public-emi-row-head strong { display:block; font-size:10px; }
            .public-emi-row-head small { display:block; color:#64748b; font-size:8px; margin-top:1px; }
            .public-emi-row-side { text-align:right; }
            .public-emi-row-side>strong { display:block; font-size:11px; white-space:nowrap; }
            .public-emi-state { display:inline-block; margin-top:2px; font-size:7px; font-weight:800; border-radius:999px; padding:2px 5px; background:#f1f5f9; color:#475569; }
            .public-emi-row-side small { display:block; color:#64748b; font-size:7px; margin-top:2px; white-space:nowrap; }
            body.public-loan-detail-open { overflow:hidden!important; }
            body.dark-mode .public-loan-detail-panel,body.dark-mode .public-emi-row { background:#1f1f1f; color:#f8fafc; border-color:#3a3a3a; }
            body.dark-mode .public-loan-detail-head { border-color:#3a3a3a; }
            body.dark-mode .public-loan-detail-close,body.dark-mode .public-loan-detail-summary>div { background:#2a2a2a; color:#f8fafc; border-color:#3a3a3a; }
            @media(min-width:720px) {
                .public-loan-detail-panel { left:50%; right:auto; bottom:22px; width:min(720px,calc(100vw - 40px)); max-height:calc(100dvh - 44px); transform:translateX(-50%); border-radius:17px; }
                .public-loan-detail-summary { grid-template-columns:repeat(4,minmax(0,1fr)); }
            }

            /* Dedicated A4 print/PDF layout — not a screenshot of the app. */
            .abhi-print-sheet { display:none; }
            @media print {
                @page { size:A4 portrait; margin:11mm 10mm 12mm; }
                html,body { background:#fff!important; color:#111!important; padding:0!important; margin:0!important; }
                body>*:not(.abhi-print-sheet) { display:none!important; }
                .abhi-print-sheet { display:block!important; font-family:Arial,Helvetica,sans-serif; color:#111; }
                .abhi-print-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; border-bottom:2px solid #1a73e8; padding-bottom:7px; margin-bottom:9px; }
                .abhi-print-brand h1 { margin:0; color:#1a73e8; font-size:19px; letter-spacing:.02em; }
                .abhi-print-brand p { margin:2px 0 0; font-size:9px; color:#555; }
                .abhi-print-meta { text-align:right; font-size:8px; line-height:1.5; color:#555; }
                .abhi-print-borrower { margin:0 0 8px; padding:7px 9px; background:#f6f8fb; border:1px solid #d9e2ef; border-radius:6px; }
                .abhi-print-borrower strong { font-size:13px; }
                .abhi-print-borrower span { display:block; margin-top:2px; font-size:8px; color:#555; }
                .abhi-print-loan { page-break-inside:avoid; break-inside:avoid; margin:0 0 9px; border:1px solid #cfd8e3; border-radius:6px; overflow:hidden; }
                .abhi-print-loan-head { display:flex; justify-content:space-between; gap:10px; padding:6px 8px; background:#eef5ff; border-bottom:1px solid #cfd8e3; }
                .abhi-print-loan-head strong { font-size:10px; color:#174ea6; }
                .abhi-print-loan-head span { font-size:8px; font-weight:700; }
                .abhi-print-kpis { display:grid; grid-template-columns:repeat(5,1fr); border-bottom:1px solid #dfe5ec; }
                .abhi-print-kpis>div { padding:5px 6px; border-right:1px solid #e5e9ef; }
                .abhi-print-kpis>div:last-child { border-right:0; }
                .abhi-print-kpis small { display:block; color:#666; font-size:6.5px; text-transform:uppercase; }
                .abhi-print-kpis b { display:block; margin-top:1px; font-size:9px; }
                .abhi-print-table { width:100%; border-collapse:collapse; font-size:7.5px; }
                .abhi-print-table th,.abhi-print-table td { border-bottom:1px solid #e6e9ed; padding:4px 5px; text-align:left; }
                .abhi-print-table th { background:#f8fafc; color:#555; font-size:6.5px; text-transform:uppercase; }
                .abhi-print-table th:nth-child(n+3),.abhi-print-table td:nth-child(n+3) { text-align:right; }
                .abhi-print-table tr:last-child td { border-bottom:0; }
                .abhi-print-warning { padding:4px 7px; font-size:7px; color:#6b21a8; background:#faf5ff; border-top:1px solid #eadcf7; }
                .abhi-print-footer { margin-top:8px; padding-top:5px; border-top:1px solid #bbb; font-size:6.5px; color:#666; text-align:center; }
            }
        `;
        document.head.appendChild(style);
    }

    function emiState(emi) {
        const amount = Math.max(0, Number(emi?.amount) || 0);
        const paid = typeof publicEmiPaid === 'function'
            ? publicEmiPaid(emi)
            : Math.min(Math.max(Number(emi?.paid_amount) || 0, 0), amount);
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
        if (loan?.status === 'defaulted') return { key:'overdue', label:'DEFAULTED' };
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
                    <div class="public-emi-row-head"><strong>EMI #${Number(emi.installment_number || 0)}</strong><small>${esc(dateText(emi))}</small></div>
                    <div class="public-emi-row-side"><strong>${money(s.amount)}</strong><span class="public-emi-state">${esc(s.label)}</span><small>Paid ${money(s.paid)} • Rem ${money(s.remaining)}</small></div>
                </article>`;
            }).join('') || '<div style="padding:16px;text-align:center;color:#64748b;font-size:10px;">Koi EMI schedule nahi.</div>';

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
                    ${totals.incomplete ? `<div class="public-loan-detail-note">🧩 ${totals.incomplete} EMI date incomplete. Missing year is not treated as overdue.</div>` : ''}
                    <div class="public-emi-list">${rows}</div>
                </div>
            </section>`;
        document.body.appendChild(overlay);
        document.body.classList.add('public-loan-detail-open');
        window.setTimeout(() => overlay.querySelector('.public-loan-detail-close')?.focus(), 0);
    }

    // Final compact public loan cards.
    window.renderLoanList = function(nameFilter) {
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
            card.className = `card public-loan-mini-card state-${state.key}`;
            const quality = totals.overdue > 0
                ? `<span class="public-loan-mini-overdue">🔴 Overdue ${money(totals.overdue)}</span>`
                : totals.incomplete > 0
                    ? `<span class="public-loan-mini-quality">🧩 ${totals.incomplete} date incomplete</span>`
                    : '';
            const paidChip = totals.paid > 0 ? `<span class="public-loan-mini-chip">Paid ${money(totals.paid)}</span>` : '';

            card.innerHTML = `<div class="public-loan-mini-head">
                    <div class="public-loan-mini-id"><small>Loan ID</small><strong>${esc(loan.loan_code || '—')}</strong></div>
                    <span class="public-loan-mini-status ${state.key}">${state.label}</span>
                </div>
                <div class="public-loan-mini-metrics">
                    <div class="public-loan-mini-metric"><small>Total</small><strong title="${money(loan.amount)}">${money(loan.amount)}</strong></div>
                    <div class="public-loan-mini-metric"><small>Remaining</small><strong title="${money(totals.remaining)}">${money(totals.remaining)}</strong></div>
                    <div class="public-loan-mini-metric"><small>EMI</small><strong>${totals.paidCount}/${totals.emiCount}</strong></div>
                </div>
                <div class="public-loan-mini-info">
                    <span class="public-loan-mini-chip">Year: ${esc(loan.loan_year || 'Not set')}</span>
                    ${paidChip}${quality}
                </div>
                <div class="public-loan-mini-footer">
                    <div class="public-loan-mini-progress"><small>Progress</small><div class="public-loan-mini-track"><i style="width:${totals.progress.toFixed(1)}%"></i></div><b>${Math.round(totals.progress)}%</b></div>
                    <button type="button" class="public-loan-mini-open no-print" onclick="publicOpenLoanCompactDetail('${esc(loan.id)}')">EMI Details</button>
                </div>`;
            list.appendChild(card);
        });
    };

    function buildPrintSheet() {
        if (!currentOpenFolder) return null;
        const matching = loans.filter(loan => String(loan.borrowers?.name || '').toUpperCase() === String(currentOpenFolder || '').toUpperCase());
        if (!matching.length) return null;

        document.querySelector('.abhi-print-sheet')?.remove();
        const now = new Date();
        const generated = now.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
        const totalPrincipal = matching.reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);
        const sheet = document.createElement('main');
        sheet.className = 'abhi-print-sheet';

        const loanHtml = matching.map(loan => {
            const totals = totalsFor(loan);
            const state = loanState(loan, totals);
            const rows = [...(loan.emis || [])]
                .sort((a,b) => Number(a.installment_number || 0) - Number(b.installment_number || 0))
                .map(emi => {
                    const s = emiState(emi);
                    return `<tr><td>${Number(emi.installment_number || 0)}</td><td>${esc(dateText(emi))}</td><td>${money(s.amount)}</td><td>${money(s.paid)}</td><td>${money(s.remaining)}</td><td>${esc(s.label)}</td></tr>`;
                }).join('') || '<tr><td colspan="6">No EMI schedule</td></tr>';

            return `<section class="abhi-print-loan">
                <div class="abhi-print-loan-head"><strong>${esc(loan.loan_code || 'Loan')}</strong><span>${esc(state.label)}</span></div>
                <div class="abhi-print-kpis">
                    <div><small>Principal</small><b>${money(loan.amount)}</b></div>
                    <div><small>EMI Total</small><b>${money(totals.emiTotal)}</b></div>
                    <div><small>Paid</small><b>${money(totals.paid)}</b></div>
                    <div><small>Remaining</small><b>${money(totals.remaining)}</b></div>
                    <div><small>Loan Year</small><b>${esc(loan.loan_year || 'Not set')}</b></div>
                </div>
                <table class="abhi-print-table"><thead><tr><th>EMI</th><th>Due</th><th>Amount</th><th>Paid</th><th>Remaining</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
                ${totals.incomplete ? `<div class="abhi-print-warning">${totals.incomplete} EMI date(s) incomplete. Missing year/date is not automatically treated as overdue.</div>` : ''}
            </section>`;
        }).join('');

        sheet.innerHTML = `<div class="abhi-print-head">
                <div class="abhi-print-brand"><h1>Abhishek Management</h1><p>Loan Account Statement</p></div>
                <div class="abhi-print-meta">Generated: ${esc(generated)}<br>Read-only statement</div>
            </div>
            <div class="abhi-print-borrower"><strong>${esc(currentOpenFolder)}</strong><span>${matching.length} loan(s) • Principal ${money(totalPrincipal)}</span></div>
            ${loanHtml}
            <div class="abhi-print-footer">Generated from AbhiTools. Verify incomplete legacy dates before using due/overdue conclusions.</div>`;
        document.body.appendChild(sheet);
        return sheet;
    }

    // Dedicated statement print/PDF instead of printing the on-screen cards.
    window.printStatement = function() {
        const sheet = buildPrintSheet();
        if (!sheet) {
            alert('Print ke liye borrower folder open karein.');
            return;
        }
        const cleanup = () => {
            sheet.remove();
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.setTimeout(() => window.print(), 40);
        window.setTimeout(() => {
            if (document.body.contains(sheet) && !window.matchMedia('print').matches) cleanup();
        }, 5000);
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
    if (typeof currentOpenFolder !== 'undefined' && currentOpenFolder) window.renderLoanList(currentOpenFolder);

    // Build 5.1 clarity: verified due figures must not make incomplete legacy schedules look like zero obligations.
    function publicIncompleteScheduleSummary() {
        let incompleteCount = 0;
        let incompleteAmount = 0;
        let currentMonthIncompleteCount = 0;
        let currentMonthIncompleteAmount = 0;

        const businessDate = String(window.publicDueData?.businessDate || '').slice(0, 10);
        let currentMonth = '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
            currentMonth = new Date(`${businessDate}T00:00:00Z`)
                .toLocaleString('en-US', { month:'short', timeZone:'UTC' })
                .toUpperCase();
        }

        for (const loan of (window.loans || [])) {
            if (loan?.status && loan.status !== 'active') continue;
            for (const emi of (loan?.emis || [])) {
                const amount = Math.max(0, Number(emi?.amount) || 0);
                const paid = typeof window.publicEmiPaid === 'function'
                    ? window.publicEmiPaid(emi)
                    : Math.min(Math.max(Number(emi?.paid_amount) || 0, 0), amount);
                const remaining = Math.max(amount - paid, 0);
                if (remaining <= 0) continue;

                const due = String(emi?.due_date || '').slice(0, 10);
                const incomplete = !emi?.due_year || !/^\d{4}-\d{2}-\d{2}$/.test(due);
                if (!incomplete) continue;

                incompleteCount += 1;
                incompleteAmount += remaining;

                if (currentMonth && String(emi?.due_month || '').toUpperCase() === currentMonth) {
                    currentMonthIncompleteCount += 1;
                    currentMonthIncompleteAmount += remaining;
                }
            }
        }

        return {
            currentMonth,
            incompleteCount,
            incompleteAmount,
            currentMonthIncompleteCount,
            currentMonthIncompleteAmount
        };
    }

    function renderPublicDueClarity() {
        const dashboard = document.getElementById('dashboard');
        if (!dashboard) return;

        const summary = publicIncompleteScheduleSummary();
        const dueLabel = document.getElementById('dueThisMonthLabel');
        if (dueLabel) dueLabel.textContent = summary.currentMonth
            ? `Verified Due in ${summary.currentMonth}`
            : 'Verified Due This Month';

        const overdueBox = document.getElementById('publicOverdueSum')?.closest('.dash-box');
        const overdueHeading = overdueBox?.querySelector('h4');
        if (overdueHeading) overdueHeading.textContent = 'Verified Overdue';

        let banner = document.getElementById('publicDateIncompleteBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'publicDateIncompleteBanner';
            banner.className = 'no-print';
            dashboard.insertAdjacentElement('afterend', banner);
        }

        if (!summary.incompleteCount) {
            banner.style.display = 'none';
            return;
        }

        banner.style.display = 'block';
        banner.innerHTML = `
            <div class="public-dq-main">
                <strong>🧩 Date incomplete: ${summary.incompleteCount} EMI • ${money(summary.incompleteAmount)} remaining</strong>
                <span>Missing year/date wali EMI verified Due/Overdue totals me count nahi hoti.</span>
            </div>
            ${summary.currentMonthIncompleteCount ? `
                <div class="public-dq-month">
                    <b>${esc(summary.currentMonth)} schedule without year</b>
                    <span>${summary.currentMonthIncompleteCount} EMI • ${money(summary.currentMonthIncompleteAmount)}</span>
                </div>
            ` : ''}
        `;
    }

    const legacyUpdateDashboard = window.updateDashboard;
    if (typeof legacyUpdateDashboard === 'function') {
        window.updateDashboard = function(...args) {
            const result = legacyUpdateDashboard.apply(this, args);
            try { renderPublicDueClarity(); } catch (error) { console.warn('Due clarity UI failed:', error); }
            return result;
        };
    }
    setTimeout(() => {
        try { renderPublicDueClarity(); } catch {}
    }, 0);

})();
