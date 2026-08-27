// AbhiTools Public Dues V3 — complete fresh EMI fetch + larger scrollable month view.
(() => {
    'use strict';

    if (window.__ABHITOOLS_PUBLIC_DUES_V3__) return;
    window.__ABHITOOLS_PUBLIC_DUES_V3__ = true;

    const legacyClose = typeof window.publicCloseBorrowerDues === 'function'
        ? window.publicCloseBorrowerDues
        : null;

    const esc = value => typeof publicEscapeHtml === 'function'
        ? publicEscapeHtml(value)
        : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const money = value => `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const validIso = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
    const monthOrder = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const monthNames = {
        JAN:'January', FEB:'February', MAR:'March', APR:'April', MAY:'May', JUN:'June',
        JUL:'July', AUG:'August', SEP:'September', OCT:'October', NOV:'November', DEC:'December'
    };

    function paidAmount(emi) {
        if (typeof publicEmiPaid === 'function') return publicEmiPaid(emi);
        const amount = Math.max(0, Number(emi?.amount) || 0);
        return Math.min(Math.max(Number(emi?.paid_amount) || 0, 0), amount);
    }

    function remainingAmount(emi) {
        if (typeof publicEmiRemaining === 'function') return publicEmiRemaining(emi);
        return Math.max((Number(emi?.amount) || 0) - paidAmount(emi), 0);
    }

    function stateFor(emi) {
        const amount = Math.max(0, Number(emi?.amount) || 0);
        const paid = paidAmount(emi);
        const remaining = remainingAmount(emi);
        const due = String(emi?.due_date || '').slice(0, 10);
        const business = String(typeof publicDueData !== 'undefined' ? publicDueData?.businessDate || '' : '').slice(0, 10);
        const incomplete = !emi?.due_year || !validIso(due);
        const overdue = !incomplete && remaining > 0 && validIso(business) && due < business;
        const today = !incomplete && remaining > 0 && validIso(business) && due === business;

        if (remaining <= 0 && amount > 0) return { key:'paid', label:'✅ PAID' };
        if (overdue && paid > 0) return { key:'overdue', label:'🟠 PARTIAL • OVERDUE' };
        if (overdue) return { key:'overdue', label:'🔴 OVERDUE' };
        if (today && paid > 0) return { key:'today', label:'🟠 PARTIAL • TODAY' };
        if (today) return { key:'today', label:'🔔 DUE TODAY' };
        if (incomplete && paid > 0) return { key:'incomplete', label:'🟠 PARTIAL' };
        if (incomplete) return { key:'incomplete', label:'🧩 DATE INCOMPLETE' };
        if (paid > 0) return { key:'partial', label:'🟠 PARTIAL' };
        return { key:'pending', label:'⏳ PENDING' };
    }

    function dateParts(emi) {
        const due = String(emi?.due_date || '').slice(0, 10);
        if (emi?.due_year && validIso(due)) {
            const d = new Date(`${due}T00:00:00Z`);
            if (!Number.isNaN(d.getTime())) {
                return { day:d.getUTCDate(), month:monthOrder[d.getUTCMonth()], year:d.getUTCFullYear(), verified:true };
            }
        }
        const rawMonth = String(emi?.due_month || '').trim().toUpperCase().slice(0, 3);
        const year = Number(emi?.due_year);
        return {
            day:Number(emi?.due_day) || 0,
            month:monthOrder.includes(rawMonth) ? rawMonth : 'UNK',
            year:Number.isInteger(year) && year > 1900 ? year : null,
            verified:false
        };
    }

    function normalizeName(value) {
        return String(value || '').trim().toUpperCase();
    }

    async function fetchFreshLoans() {
        const response = await fetch('/api/loans?dues_refresh=1', {
            method:'GET',
            cache:'no-store',
            credentials:'same-origin',
            headers:{ 'Accept':'application/json' }
        });
        if (!response.ok) throw new Error(`Loan API ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Loan API response invalid');
        return data;
    }

    function fallbackLoans() {
        return typeof loans !== 'undefined' && Array.isArray(loans) ? loans : [];
    }

    function borrowerLoans(sourceLoans, borrowerName) {
        const wanted = normalizeName(borrowerName);
        return (Array.isArray(sourceLoans) ? sourceLoans : []).filter(loan => normalizeName(loan?.borrowers?.name) === wanted);
    }

    function groupsForBorrower(sourceLoans, borrowerName) {
        const map = new Map();
        for (const loan of borrowerLoans(sourceLoans, borrowerName)) {
            const emiRows = Array.isArray(loan?.emis) ? loan.emis : [];
            for (const emi of emiRows) {
                const parts = dateParts(emi);
                const key = `${parts.year || 'unknown'}-${parts.month}`;
                if (!map.has(key)) map.set(key, { key, year:parts.year, month:parts.month, rows:[] });
                map.get(key).rows.push({ loan, emi, parts, state:stateFor(emi) });
            }
        }

        const groups = [...map.values()].sort((a, b) => {
            if (a.year && b.year && a.year !== b.year) return a.year - b.year;
            if (a.year && !b.year) return -1;
            if (!a.year && b.year) return 1;
            const ai = monthOrder.indexOf(a.month);
            const bi = monthOrder.indexOf(b.month);
            if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
            return String(a.key).localeCompare(String(b.key));
        });

        groups.forEach(group => group.rows.sort((a, b) => {
            const day = (a.parts.day || 99) - (b.parts.day || 99);
            if (day) return day;
            const loanCode = String(a.loan?.loan_code || '').localeCompare(String(b.loan?.loan_code || ''));
            if (loanCode) return loanCode;
            return Number(a.emi?.installment_number || 0) - Number(b.emi?.installment_number || 0);
        }));
        return groups;
    }

    function monthHeading(group) {
        const name = monthNames[group.month] || (group.month === 'UNK' ? 'Date Incomplete' : group.month);
        return group.year ? `${name} ${group.year}` : name;
    }

    function rowDate(row) {
        const day = row.parts.day || '—';
        const month = row.parts.month === 'UNK' ? '' : row.parts.month;
        return `${day}${month ? ` ${month}` : ''}`;
    }

    function injectStyles() {
        document.getElementById('abhiPublicDuesCompactV2Styles')?.remove();
        document.getElementById('abhiPublicDuesV3Styles')?.remove();
        const style = document.createElement('style');
        style.id = 'abhiPublicDuesV3Styles';
        style.textContent = `
            .public-dues-panel {
                height:88dvh!important; max-height:88dvh!important;
            }
            .public-dues-v3-body {
                min-height:0; flex:1 1 auto; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain;
                padding:12px 10px calc(22px + env(safe-area-inset-bottom)); display:grid; gap:14px; align-content:start;
                scroll-behavior:smooth;
            }
            .public-dues-v3-loading {
                min-height:140px; display:flex; align-items:center; justify-content:center; text-align:center;
                color:#64748b; font-size:13px; font-weight:700;
            }
            .public-dues-v3-month {
                overflow:hidden; border:1px solid #d7e2ef; border-radius:16px; background:#fff;
                box-shadow:0 5px 18px rgba(15,23,42,.06);
            }
            .public-dues-v3-month-title {
                min-height:48px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px;
                padding:10px 14px; background:#eff6ff; color:#1d4ed8; border-bottom:1px solid #dbeafe;
                white-space:nowrap;
            }
            .public-dues-v3-month-title strong {
                grid-column:2; font-size:17px; line-height:1.15; font-weight:900; letter-spacing:.01em;
            }
            .public-dues-v3-month-count {
                grid-column:3; justify-self:end; padding:4px 8px; border-radius:999px; background:#dbeafe; color:#1e40af;
                font-size:10.5px; line-height:1; font-weight:850;
            }
            .public-dues-v3-list { overflow-x:auto; scrollbar-width:thin; }
            .public-dues-v3-row {
                min-width:max-content; min-height:46px; display:flex; flex-wrap:nowrap; align-items:center; gap:10px;
                padding:10px 14px; border-bottom:1px solid #edf2f7; font-size:13.5px; line-height:1.2;
                white-space:nowrap; color:#334155; font-variant-numeric:tabular-nums; background:#fff;
            }
            .public-dues-v3-row:nth-child(even) { background:#fbfdff; }
            .public-dues-v3-row:last-child { border-bottom:0; }
            .public-dues-v3-row .sep { color:#94a3b8; font-weight:850; }
            .public-dues-v3-date { min-width:52px; font-weight:900; color:#0f172a; }
            .public-dues-v3-loan { font-weight:850; color:#1d4ed8; }
            .public-dues-v3-amount { min-width:66px; font-weight:900; color:#0f172a; }
            .public-dues-v3-status {
                padding:6px 10px; border-radius:999px; background:#f1f5f9; color:#475569; font-size:10.5px;
                line-height:1.05; font-weight:900; box-shadow:inset 0 0 0 1px rgba(148,163,184,.18);
            }
            .public-dues-v3-row.paid .public-dues-v3-status { background:#dcfce7; color:#166534; }
            .public-dues-v3-row.overdue .public-dues-v3-status { background:#fee2e2; color:#991b1b; }
            .public-dues-v3-row.today .public-dues-v3-status { background:#fef3c7; color:#92400e; }
            .public-dues-v3-row.partial .public-dues-v3-status { background:#ffedd5; color:#9a3412; }
            .public-dues-v3-row.incomplete .public-dues-v3-status { background:#f3e8ff; color:#6b21a8; }
            .public-dues-v3-note {
                padding:9px 11px; border:1px solid #fde68a; border-radius:10px; background:#fffbeb; color:#92400e;
                font-size:11px; line-height:1.35; font-weight:700;
            }
            .public-dues-v3-empty {
                padding:24px 12px; text-align:center; color:#64748b; font-size:13px; background:#fff;
                border:1px solid #dbe4f0; border-radius:13px;
            }

            body.dark-mode .public-dues-v3-month { background:#1f1f1f; border-color:#3a3a3a; box-shadow:none; }
            body.dark-mode .public-dues-v3-month-title { background:#202a3a; border-color:#334155; color:#93c5fd; }
            body.dark-mode .public-dues-v3-month-count { background:#263a5a; color:#bfdbfe; }
            body.dark-mode .public-dues-v3-row { color:#cbd5e1; border-bottom-color:#303030; background:#1f1f1f; }
            body.dark-mode .public-dues-v3-row:nth-child(even) { background:#232323; }
            body.dark-mode .public-dues-v3-date,
            body.dark-mode .public-dues-v3-amount { color:#f8fafc; }
            body.dark-mode .public-dues-v3-note { background:#3a2d13; color:#fde68a; border-color:#6b531e; }

            @media(max-width:430px) {
                .public-dues-panel { height:90dvh!important; max-height:90dvh!important; }
                .public-dues-v3-body { padding:9px 6px calc(18px + env(safe-area-inset-bottom)); gap:10px; }
                .public-dues-v3-month { border-radius:13px; }
                .public-dues-v3-month-title { min-height:45px; padding:8px 9px; }
                .public-dues-v3-month-title strong { font-size:15.5px; }
                .public-dues-v3-month-count { font-size:9.5px; padding:4px 6px; }
                .public-dues-v3-row { min-height:44px; gap:7px; padding:9px 10px; font-size:12px; }
                .public-dues-v3-date { min-width:45px; }
                .public-dues-v3-amount { min-width:58px; }
                .public-dues-v3-status { padding:5px 8px; font-size:9.5px; }
            }
            @media(min-width:720px) {
                .public-dues-panel {
                    top:50%!important; bottom:auto!important; left:50%!important; right:auto!important;
                    transform:translate(-50%,-50%)!important; width:min(960px,calc(100vw - 56px))!important;
                    height:min(84dvh,780px)!important; max-height:min(84dvh,780px)!important; border-radius:18px!important;
                }
                .public-dues-v3-body { padding:14px 14px 24px; gap:16px; }
                .public-dues-v3-row { min-height:48px; padding:11px 16px; font-size:14px; }
                .public-dues-v3-month-title strong { font-size:18px; }
            }
        `;
        document.head.appendChild(style);
    }

    function closeDues() {
        document.getElementById('publicBorrowerDuesOverlay')?.remove();
        document.body.classList.remove('public-dues-open');
    }

    function renderMonths(groups, warningText = '') {
        const months = groups.map(group => {
            const rows = group.rows.map(row => `
                <div class="public-dues-v3-row ${esc(row.state.key)}">
                    <span class="public-dues-v3-date">${esc(rowDate(row))}</span>
                    <span class="sep">/</span>
                    <span class="public-dues-v3-loan">${esc(row.loan?.loan_code || 'Loan')}</span>
                    <span class="sep">/</span>
                    <span class="public-dues-v3-amount">${money(row.emi?.amount)}</span>
                    <span class="sep">/</span>
                    <span class="public-dues-v3-status">${esc(row.state.label)}</span>
                </div>`).join('');

            return `<section class="public-dues-v3-month">
                <div class="public-dues-v3-month-title">
                    <strong>${esc(monthHeading(group))}</strong>
                    <span class="public-dues-v3-month-count">${group.rows.length} EMI</span>
                </div>
                <div class="public-dues-v3-list">${rows}</div>
            </section>`;
        }).join('');

        return `${warningText ? `<div class="public-dues-v3-note">${esc(warningText)}</div>` : ''}${months || '<div class="public-dues-v3-empty">Is profile me koi EMI schedule nahi mila.</div>'}`;
    }

    async function openDues() {
        const borrowerName = typeof currentOpenFolder !== 'undefined' ? String(currentOpenFolder || '') : '';
        if (!borrowerName) return;
        if (typeof window.publicCloseLoanCompactDetail === 'function') window.publicCloseLoanCompactDetail();
        if (legacyClose) legacyClose();
        closeDues();

        const overlay = document.createElement('div');
        overlay.id = 'publicBorrowerDuesOverlay';
        overlay.className = 'public-dues-overlay no-print';
        overlay.innerHTML = `<div class="public-dues-backdrop" data-public-dues-v3-close="yes"></div>
            <section class="public-dues-panel" role="dialog" aria-modal="true" aria-labelledby="publicBorrowerDuesTitle">
                <header class="public-dues-head">
                    <div><small>Complete month-wise EMI schedule</small><h3 id="publicBorrowerDuesTitle">📅 ${esc(borrowerName)} — Dues</h3></div>
                    <button type="button" class="public-dues-close" data-public-dues-v3-close="yes" aria-label="Close">✕</button>
                </header>
                <div class="public-dues-v3-body"><div class="public-dues-v3-loading">🔄 Complete EMI schedule load ho raha hai…</div></div>
            </section>`;
        document.body.appendChild(overlay);
        document.body.classList.add('public-dues-open');
        window.setTimeout(() => overlay.querySelector('.public-dues-close')?.focus(), 0);

        const body = overlay.querySelector('.public-dues-v3-body');
        try {
            const freshLoans = await fetchFreshLoans();
            if (!document.body.contains(overlay)) return;
            const groups = groupsForBorrower(freshLoans, borrowerName);
            body.innerHTML = renderMonths(groups);
            body.scrollTop = 0;
        } catch (error) {
            console.warn('Fresh borrower dues fetch failed, using current dashboard data:', error);
            if (!document.body.contains(overlay)) return;
            const groups = groupsForBorrower(fallbackLoans(), borrowerName);
            body.innerHTML = renderMonths(groups, 'Live refresh nahi ho saka; current dashboard data dikhaya ja raha hai. Dobara Dues open karke retry karein.');
            body.scrollTop = 0;
        }
    }

    function rebindDuesButton() {
        const oldButton = document.getElementById('publicBorrowerDuesBtn');
        if (!oldButton) return false;
        if (oldButton.dataset.duesV3 === 'yes') return true;
        const button = oldButton.cloneNode(true);
        button.dataset.duesV3 = 'yes';
        delete button.dataset.compactV2;
        button.textContent = '📅 Dues';
        button.addEventListener('click', openDues);
        oldButton.replaceWith(button);
        return true;
    }

    document.addEventListener('click', event => {
        if (event.target.closest('[data-public-dues-v3-close="yes"]')) {
            event.preventDefault();
            closeDues();
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById('publicBorrowerDuesOverlay')) closeDues();
    });

    window.publicOpenBorrowerDues = openDues;
    window.publicCloseBorrowerDues = closeDues;

    injectStyles();
    if (!rebindDuesButton()) {
        let attempts = 0;
        const timer = window.setInterval(() => {
            attempts += 1;
            if (rebindDuesButton() || attempts >= 200) window.clearInterval(timer);
        }, 50);
    }
})();
