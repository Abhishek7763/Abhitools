// AbhiTools Public Dues Compact V2 — month heading + strict single-line rows.
(() => {
    'use strict';

    if (window.__ABHITOOLS_PUBLIC_DUES_COMPACT_V2__) return;
    window.__ABHITOOLS_PUBLIC_DUES_COMPACT_V2__ = true;

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

    function borrowerLoans() {
        if (typeof loans === 'undefined' || !Array.isArray(loans) || typeof currentOpenFolder === 'undefined' || !currentOpenFolder) return [];
        const name = String(currentOpenFolder).toUpperCase();
        return loans.filter(loan => String(loan?.borrowers?.name || '').toUpperCase() === name);
    }

    function groupsForBorrower() {
        const map = new Map();
        for (const loan of borrowerLoans()) {
            for (const emi of (Array.isArray(loan?.emis) ? loan.emis : [])) {
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
            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        });

        groups.forEach(group => group.rows.sort((a, b) => {
            const day = (a.parts.day || 99) - (b.parts.day || 99);
            if (day) return day;
            return String(a.loan?.loan_code || '').localeCompare(String(b.loan?.loan_code || ''));
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
        if (document.getElementById('abhiPublicDuesCompactV2Styles')) return;
        const style = document.createElement('style');
        style.id = 'abhiPublicDuesCompactV2Styles';
        style.textContent = `
            .public-dues-v2-body { overflow:auto; overscroll-behavior:contain; padding:7px 7px calc(14px + env(safe-area-inset-bottom)); display:grid; gap:8px; }
            .public-dues-v2-month { overflow:hidden; border:1px solid #dbe4f0; border-radius:11px; background:#fff; }
            .public-dues-v2-month-title {
                padding:7px 9px; text-align:center; background:#eff6ff; color:#1d4ed8;
                border-bottom:1px solid #dbeafe; font-size:14px; line-height:1.15; font-weight:850; white-space:nowrap;
            }
            .public-dues-v2-list { overflow-x:auto; scrollbar-width:thin; }
            .public-dues-v2-row {
                min-width:max-content; display:flex; flex-wrap:nowrap; align-items:center; gap:6px;
                padding:7px 9px; border-bottom:1px solid #eef2f7; font-size:11.5px; line-height:1.15;
                white-space:nowrap; color:#334155; font-variant-numeric:tabular-nums;
            }
            .public-dues-v2-row:last-child { border-bottom:0; }
            .public-dues-v2-row .sep { color:#94a3b8; font-weight:700; }
            .public-dues-v2-date { min-width:44px; font-weight:850; color:#0f172a; }
            .public-dues-v2-loan { font-weight:800; color:#1d4ed8; }
            .public-dues-v2-amount { font-weight:800; color:#0f172a; }
            .public-dues-v2-status { padding:3px 6px; border-radius:999px; background:#f1f5f9; color:#475569; font-size:9.5px; font-weight:850; }
            .public-dues-v2-row.paid .public-dues-v2-status { background:#dcfce7; color:#166534; }
            .public-dues-v2-row.overdue .public-dues-v2-status { background:#fee2e2; color:#991b1b; }
            .public-dues-v2-row.today .public-dues-v2-status { background:#fef3c7; color:#92400e; }
            .public-dues-v2-row.partial .public-dues-v2-status { background:#ffedd5; color:#9a3412; }
            .public-dues-v2-row.incomplete .public-dues-v2-status { background:#f3e8ff; color:#6b21a8; }
            .public-dues-v2-empty { padding:18px 10px; text-align:center; color:#64748b; font-size:12px; background:#fff; border:1px solid #dbe4f0; border-radius:11px; }

            body.dark-mode .public-dues-v2-month { background:#1f1f1f; border-color:#3a3a3a; }
            body.dark-mode .public-dues-v2-month-title { background:#202a3a; border-color:#334155; color:#93c5fd; }
            body.dark-mode .public-dues-v2-row { color:#cbd5e1; border-bottom-color:#303030; }
            body.dark-mode .public-dues-v2-date,
            body.dark-mode .public-dues-v2-amount { color:#f8fafc; }

            @media(max-width:430px) {
                .public-dues-v2-body { padding:6px 5px calc(12px + env(safe-area-inset-bottom)); gap:6px; }
                .public-dues-v2-month-title { padding:6px 7px; font-size:13px; }
                .public-dues-v2-row { gap:4px; padding:6px 7px; font-size:10.5px; }
                .public-dues-v2-date { min-width:39px; }
                .public-dues-v2-status { padding:3px 5px; font-size:9px; }
            }
        `;
        document.head.appendChild(style);
    }

    function closeCompactDues() {
        document.getElementById('publicBorrowerDuesOverlay')?.remove();
        document.body.classList.remove('public-dues-open');
    }

    function openCompactDues() {
        if (typeof currentOpenFolder === 'undefined' || !currentOpenFolder) return;
        if (typeof window.publicCloseLoanCompactDetail === 'function') window.publicCloseLoanCompactDetail();
        if (legacyClose) legacyClose();
        closeCompactDues();

        const groups = groupsForBorrower();
        const months = groups.map(group => {
            const rows = group.rows.map(row => `
                <div class="public-dues-v2-row ${esc(row.state.key)}">
                    <span class="public-dues-v2-date">${esc(rowDate(row))}</span>
                    <span class="sep">/</span>
                    <span class="public-dues-v2-loan">${esc(row.loan?.loan_code || 'Loan')}</span>
                    <span class="sep">/</span>
                    <span class="public-dues-v2-amount">${money(row.loan?.amount)}</span>
                    <span class="sep">/</span>
                    <span class="public-dues-v2-status">${esc(row.state.label)}</span>
                </div>`).join('');

            return `<section class="public-dues-v2-month">
                <div class="public-dues-v2-month-title">${esc(monthHeading(group))}</div>
                <div class="public-dues-v2-list">${rows}</div>
            </section>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.id = 'publicBorrowerDuesOverlay';
        overlay.className = 'public-dues-overlay no-print';
        overlay.innerHTML = `<div class="public-dues-backdrop" data-public-dues-v2-close="yes"></div>
            <section class="public-dues-panel" role="dialog" aria-modal="true" aria-labelledby="publicBorrowerDuesTitle">
                <header class="public-dues-head">
                    <div><small>Selected profile only</small><h3 id="publicBorrowerDuesTitle">📅 ${esc(currentOpenFolder)} — Dues</h3></div>
                    <button type="button" class="public-dues-close" data-public-dues-v2-close="yes" aria-label="Close">✕</button>
                </header>
                <div class="public-dues-v2-body">${months || '<div class="public-dues-v2-empty">Is profile me koi EMI schedule nahi mila.</div>'}</div>
            </section>`;
        document.body.appendChild(overlay);
        document.body.classList.add('public-dues-open');
        window.setTimeout(() => overlay.querySelector('.public-dues-close')?.focus(), 0);
    }

    function rebindDuesButton() {
        const oldButton = document.getElementById('publicBorrowerDuesBtn');
        if (!oldButton || oldButton.dataset.compactV2 === 'yes') return Boolean(oldButton);
        const button = oldButton.cloneNode(true);
        button.dataset.compactV2 = 'yes';
        button.textContent = '📅 Dues';
        button.addEventListener('click', openCompactDues);
        oldButton.replaceWith(button);
        return true;
    }

    document.addEventListener('click', event => {
        if (event.target.closest('[data-public-dues-v2-close="yes"]')) {
            event.preventDefault();
            closeCompactDues();
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById('publicBorrowerDuesOverlay')) closeCompactDues();
    });

    window.publicOpenBorrowerDues = openCompactDues;
    window.publicCloseBorrowerDues = closeCompactDues;

    injectStyles();
    if (!rebindDuesButton()) {
        let attempts = 0;
        const timer = window.setInterval(() => {
            attempts += 1;
            if (rebindDuesButton() || attempts >= 200) window.clearInterval(timer);
        }, 50);
    }
})();
