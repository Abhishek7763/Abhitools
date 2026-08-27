// AbhiTools Public Borrower Dues — read-only profile dues + desktop modal centering.
(() => {
    'use strict';

    if (window.__ABHITOOLS_PUBLIC_DUES_V1__) return;
    window.__ABHITOOLS_PUBLIC_DUES_V1__ = true;

    const esc = value => typeof publicEscapeHtml === 'function'
        ? publicEscapeHtml(value)
        : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));

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

    function statusFor(emi) {
        const amount = Math.max(0, Number(emi?.amount) || 0);
        const paid = paidAmount(emi);
        const remaining = remainingAmount(emi);
        const due = String(emi?.due_date || '').slice(0, 10);
        const business = String(typeof publicDueData !== 'undefined' ? publicDueData?.businessDate || '' : '').slice(0, 10);
        const incomplete = !emi?.due_year || !validIso(due);
        const pastDue = !incomplete && remaining > 0 && validIso(business) && due < business;
        const dueToday = !incomplete && remaining > 0 && validIso(business) && due === business;

        if (remaining <= 0 && amount > 0) return { key:'paid', label:'✅ PAID', amount, paid, remaining, incomplete:false };
        if (incomplete && paid > 0) return { key:'incomplete', label:'🧩 PARTIAL', amount, paid, remaining, incomplete:true };
        if (incomplete) return { key:'incomplete', label:'🧩 DATE INCOMPLETE', amount, paid, remaining, incomplete:true };
        if (pastDue && paid > 0) return { key:'overdue', label:'🟠 PARTIAL • OVERDUE', amount, paid, remaining, incomplete:false };
        if (pastDue) return { key:'overdue', label:'🔴 OVERDUE', amount, paid, remaining, incomplete:false };
        if (dueToday && paid > 0) return { key:'today', label:'🟠 PARTIAL • DUE TODAY', amount, paid, remaining, incomplete:false };
        if (dueToday) return { key:'today', label:'🔔 DUE TODAY', amount, paid, remaining, incomplete:false };
        if (paid > 0) return { key:'partial', label:'🟠 PARTIAL', amount, paid, remaining, incomplete:false };
        return { key:'pending', label:'⏳ PENDING', amount, paid, remaining, incomplete:false };
    }

    function scheduleParts(emi) {
        const due = String(emi?.due_date || '').slice(0, 10);
        if (emi?.due_year && validIso(due)) {
            const d = new Date(`${due}T00:00:00Z`);
            if (!Number.isNaN(d.getTime())) {
                return {
                    day: d.getUTCDate(),
                    month: monthOrder[d.getUTCMonth()],
                    year: d.getUTCFullYear(),
                    verified: true
                };
            }
        }

        const rawMonth = String(emi?.due_month || '').trim().toUpperCase().slice(0, 3);
        const month = monthOrder.includes(rawMonth) ? rawMonth : 'UNK';
        const numericYear = Number(emi?.due_year);
        return {
            day: Number(emi?.due_day) || 0,
            month,
            year: Number.isInteger(numericYear) && numericYear > 1900 ? numericYear : null,
            verified: false
        };
    }

    function selectedBorrowerLoans() {
        if (typeof loans === 'undefined' || !Array.isArray(loans) || typeof currentOpenFolder === 'undefined' || !currentOpenFolder) return [];
        const selected = String(currentOpenFolder).toUpperCase();
        return loans.filter(loan => String(loan?.borrowers?.name || '').toUpperCase() === selected);
    }

    function buildGroups() {
        const groups = new Map();
        let total = 0;
        let paid = 0;
        let remaining = 0;
        let paidCount = 0;
        let emiCount = 0;
        let incompleteCount = 0;

        for (const loan of selectedBorrowerLoans()) {
            for (const emi of (Array.isArray(loan?.emis) ? loan.emis : [])) {
                const state = statusFor(emi);
                const parts = scheduleParts(emi);
                const groupKey = `${parts.year || 'unknown'}-${parts.month}`;
                if (!groups.has(groupKey)) {
                    groups.set(groupKey, {
                        key: groupKey,
                        month: parts.month,
                        year: parts.year,
                        verified: parts.verified,
                        rows: [],
                        total: 0,
                        paid: 0,
                        remaining: 0,
                        paidCount: 0
                    });
                }
                const group = groups.get(groupKey);
                if (!parts.verified) group.verified = false;
                group.rows.push({ loan, emi, state, parts });
                group.total += state.amount;
                group.paid += state.paid;
                group.remaining += state.remaining;
                if (state.key === 'paid') group.paidCount += 1;

                total += state.amount;
                paid += state.paid;
                remaining += state.remaining;
                emiCount += 1;
                if (state.key === 'paid') paidCount += 1;
                if (state.incomplete && state.remaining > 0) incompleteCount += 1;
            }
        }

        const sorted = [...groups.values()].sort((a, b) => {
            if (a.year && b.year && a.year !== b.year) return a.year - b.year;
            if (a.year && !b.year) return -1;
            if (!a.year && b.year) return 1;
            const ai = monthOrder.indexOf(a.month);
            const bi = monthOrder.indexOf(b.month);
            if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
            return String(a.key).localeCompare(String(b.key));
        });

        for (const group of sorted) {
            group.rows.sort((a, b) => {
                const dayDiff = (a.parts.day || 99) - (b.parts.day || 99);
                if (dayDiff) return dayDiff;
                const codeDiff = String(a.loan?.loan_code || '').localeCompare(String(b.loan?.loan_code || ''));
                if (codeDiff) return codeDiff;
                return Number(a.emi?.installment_number || 0) - Number(b.emi?.installment_number || 0);
            });
        }

        return { groups: sorted, total, paid, remaining, paidCount, emiCount, incompleteCount };
    }

    function monthTitle(group) {
        const name = monthNames[group.month] || (group.month === 'UNK' ? 'Date incomplete' : group.month);
        return group.year ? `${name} ${group.year}` : `${name} • Year not set`;
    }

    function rowDate(row) {
        const day = row.parts.day || '—';
        const month = row.parts.month === 'UNK' ? '' : row.parts.month;
        return `${day}${month ? ` ${month}` : ''}`;
    }

    function injectStyles() {
        if (document.getElementById('abhiPublicDuesStyles')) return;
        const style = document.createElement('style');
        style.id = 'abhiPublicDuesStyles';
        style.textContent = `
            body.public-dues-open { overflow:hidden!important; }
            .public-detail-actions>div { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
            .public-dues-open-btn { background:#0f766e!important; color:#fff!important; border-color:#0f766e!important; }

            /* Desktop-only fix: View EMI stays horizontally + vertically centered. Mobile sheet remains unchanged. */
            @media(min-width:720px) {
                .public-loan-detail-panel {
                    top:50%!important; bottom:auto!important; left:50%!important; right:auto!important;
                    transform:translate(-50%,-50%)!important;
                    width:min(720px,calc(100vw - 40px))!important;
                    max-height:calc(100dvh - 44px)!important;
                }
            }

            .public-dues-overlay { position:fixed; inset:0; z-index:32500; }
            .public-dues-backdrop { position:absolute; inset:0; background:rgba(15,23,42,.62); backdrop-filter:blur(2px); }
            .public-dues-panel {
                position:absolute; left:5px; right:5px; bottom:5px; max-height:calc(100dvh - 10px); overflow:hidden;
                display:flex; flex-direction:column; background:#f8fafc; color:#0f172a; border:1px solid #e2e8f0;
                border-radius:18px 18px 13px 13px; box-shadow:0 28px 80px rgba(0,0,0,.28);
            }
            .public-dues-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 12px; background:#fff; border-bottom:1px solid #e5e7eb; }
            .public-dues-head small { display:block; color:#64748b; font-size:11px; font-weight:650; line-height:1.3; }
            .public-dues-head h3 { margin:2px 0 0; color:#1d4ed8; font-size:17px; line-height:1.2; }
            .public-dues-close { flex:0 0 40px; width:40px; height:40px; border:1px solid #e5e7eb; border-radius:10px; background:#f8fafc; color:#0f172a; cursor:pointer; font-size:16px; }
            .public-dues-body { overflow:auto; overscroll-behavior:contain; padding:8px 8px calc(14px + env(safe-area-inset-bottom)); display:grid; gap:9px; }
            .public-dues-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
            .public-dues-summary>div { min-width:0; padding:8px; border:1px solid #dbe4f0; border-radius:10px; background:#fff; }
            .public-dues-summary small { display:block; color:#64748b; font-size:10.5px; line-height:1.2; font-weight:650; }
            .public-dues-summary strong { display:block; margin-top:3px; font-size:14px; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums; }
            .public-dues-note { padding:8px 9px; border:1px solid #e9d5ff; border-radius:9px; background:#faf5ff; color:#6b21a8; font-size:10.5px; line-height:1.4; font-weight:650; }
            .public-dues-month { overflow:hidden; border:1px solid #dbe4f0; border-radius:13px; background:#fff; }
            .public-dues-month-head { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center; padding:9px 10px; background:#eff6ff; border-bottom:1px solid #dbeafe; }
            .public-dues-month-title { min-width:0; }
            .public-dues-month-title strong { display:block; color:#1d4ed8; font-size:14px; line-height:1.2; }
            .public-dues-month-title small { display:block; margin-top:2px; color:#64748b; font-size:10.5px; line-height:1.3; }
            .public-dues-month-total { text-align:right; }
            .public-dues-month-total strong { display:block; font-size:13px; line-height:1.2; }
            .public-dues-month-total small { display:block; margin-top:2px; color:#64748b; font-size:10px; white-space:nowrap; }
            .public-dues-list { display:grid; }
            .public-dues-row { display:grid; grid-template-columns:64px minmax(0,1fr) auto; gap:8px; align-items:center; padding:9px 10px; border-bottom:1px solid #eef2f7; }
            .public-dues-row:last-child { border-bottom:0; }
            .public-dues-date { font-size:11.5px; line-height:1.2; font-weight:850; color:#334155; white-space:nowrap; }
            .public-dues-loan { min-width:0; }
            .public-dues-loan strong { display:block; color:#0f172a; font-size:12.5px; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .public-dues-loan small { display:block; margin-top:2px; color:#64748b; font-size:10.5px; line-height:1.25; }
            .public-dues-side { text-align:right; min-width:106px; }
            .public-dues-side>strong { display:block; font-size:13.5px; line-height:1.2; font-variant-numeric:tabular-nums; }
            .public-dues-status { display:inline-block; margin-top:4px; padding:4px 7px; border-radius:999px; background:#f1f5f9; color:#475569; font-size:9.5px; line-height:1.1; font-weight:850; white-space:nowrap; }
            .public-dues-row.paid .public-dues-status { background:#dcfce7; color:#166534; }
            .public-dues-row.overdue .public-dues-status { background:#fee2e2; color:#991b1b; }
            .public-dues-row.today .public-dues-status { background:#fef3c7; color:#92400e; }
            .public-dues-row.partial .public-dues-status { background:#ffedd5; color:#9a3412; }
            .public-dues-row.incomplete .public-dues-status { background:#f3e8ff; color:#6b21a8; }
            .public-dues-empty { padding:22px 12px; text-align:center; color:#64748b; font-size:12px; background:#fff; border:1px solid #dbe4f0; border-radius:12px; }

            body.dark-mode .public-dues-panel { background:#171717; color:#f8fafc; border-color:#3a3a3a; }
            body.dark-mode .public-dues-head,
            body.dark-mode .public-dues-summary>div,
            body.dark-mode .public-dues-month { background:#1f1f1f; border-color:#3a3a3a; }
            body.dark-mode .public-dues-head { border-bottom-color:#3a3a3a; }
            body.dark-mode .public-dues-close { background:#2a2a2a; color:#f8fafc; border-color:#3a3a3a; }
            body.dark-mode .public-dues-month-head { background:#202a3a; border-color:#334155; }
            body.dark-mode .public-dues-loan strong { color:#f8fafc; }
            body.dark-mode .public-dues-date { color:#cbd5e1; }
            body.dark-mode .public-dues-row { border-bottom-color:#303030; }

            @media(max-width:430px) {
                .public-detail-actions>div { width:100%; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; }
                .public-detail-actions>div .btn { min-width:0!important; justify-content:center!important; padding:10px 7px!important; font-size:12px!important; }
                .public-dues-panel { left:4px; right:4px; bottom:4px; max-height:calc(100dvh - 8px); }
                .public-dues-head { padding:9px 10px; }
                .public-dues-head h3 { font-size:15.5px; }
                .public-dues-summary { gap:5px; }
                .public-dues-summary>div { padding:7px 6px; }
                .public-dues-summary strong { font-size:13px; }
                .public-dues-row { grid-template-columns:55px minmax(0,1fr) auto; gap:6px; padding:8px; }
                .public-dues-date { font-size:10.5px; }
                .public-dues-loan strong { font-size:11.5px; }
                .public-dues-loan small { font-size:9.8px; }
                .public-dues-side { min-width:92px; }
                .public-dues-side>strong { font-size:12.5px; }
                .public-dues-status { max-width:106px; white-space:normal; text-align:center; }
            }
            @media(min-width:720px) {
                .public-dues-panel {
                    top:50%; bottom:auto; left:50%; right:auto; transform:translate(-50%,-50%);
                    width:min(820px,calc(100vw - 42px)); max-height:calc(100dvh - 46px); border-radius:17px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function closeDues() {
        document.getElementById('publicBorrowerDuesOverlay')?.remove();
        document.body.classList.remove('public-dues-open');
    }

    function openDues() {
        const borrowerName = typeof currentOpenFolder !== 'undefined' ? String(currentOpenFolder || '') : '';
        if (!borrowerName) return;
        if (typeof window.publicCloseLoanCompactDetail === 'function') window.publicCloseLoanCompactDetail();
        closeDues();

        const data = buildGroups();
        const monthHtml = data.groups.map(group => {
            const rows = group.rows.map(row => {
                const installment = Number(row.emi?.installment_number || 0);
                const scheduleNote = row.parts.verified ? `EMI #${installment || '—'}` : `EMI #${installment || '—'} • Date incomplete`;
                return `<div class="public-dues-row ${esc(row.state.key)}">
                    <div class="public-dues-date">${esc(rowDate(row))}</div>
                    <div class="public-dues-loan"><strong>${esc(row.loan?.loan_code || 'Loan')}</strong><small>${esc(scheduleNote)}</small></div>
                    <div class="public-dues-side"><strong>${money(row.state.amount)}</strong><span class="public-dues-status">${esc(row.state.label)}</span></div>
                </div>`;
            }).join('');

            const verifiedNote = group.verified ? `${group.rows.length} EMI` : `${group.rows.length} EMI • contains incomplete date`;
            return `<section class="public-dues-month">
                <div class="public-dues-month-head">
                    <div class="public-dues-month-title"><strong>${esc(monthTitle(group))}</strong><small>${esc(verifiedNote)}</small></div>
                    <div class="public-dues-month-total"><strong>${money(group.total)}</strong><small>Paid ${money(group.paid)} • Rem ${money(group.remaining)}</small></div>
                </div>
                <div class="public-dues-list">${rows}</div>
            </section>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.id = 'publicBorrowerDuesOverlay';
        overlay.className = 'public-dues-overlay no-print';
        overlay.innerHTML = `<div class="public-dues-backdrop" data-public-dues-close="yes"></div>
            <section class="public-dues-panel" role="dialog" aria-modal="true" aria-labelledby="publicBorrowerDuesTitle">
                <header class="public-dues-head">
                    <div><small>Selected profile only</small><h3 id="publicBorrowerDuesTitle">📅 ${esc(borrowerName)} — Dues</h3></div>
                    <button type="button" class="public-dues-close" data-public-dues-close="yes" aria-label="Close">✕</button>
                </header>
                <div class="public-dues-body">
                    <div class="public-dues-summary">
                        <div><small>EMI Scheduled</small><strong>${money(data.total)}</strong></div>
                        <div><small>✅ Paid</small><strong>${money(data.paid)}</strong></div>
                        <div><small>Remaining</small><strong>${money(data.remaining)}</strong></div>
                    </div>
                    ${data.incompleteCount ? `<div class="public-dues-note">🧩 ${data.incompleteCount} unpaid EMI date${data.incompleteCount === 1 ? '' : 's'} incomplete. Missing year/date is shown as incomplete and is never guessed.</div>` : ''}
                    ${monthHtml || '<div class="public-dues-empty">Is profile me koi EMI schedule nahi mila.</div>'}
                </div>
            </section>`;
        document.body.appendChild(overlay);
        document.body.classList.add('public-dues-open');
        window.setTimeout(() => overlay.querySelector('.public-dues-close')?.focus(), 0);
    }

    function ensureDuesButton() {
        const actionGroup = document.querySelector('#detailView .public-detail-actions > div');
        if (!actionGroup || document.getElementById('publicBorrowerDuesBtn')) return;
        const button = document.createElement('button');
        button.id = 'publicBorrowerDuesBtn';
        button.type = 'button';
        button.className = 'btn btn-view public-dues-open-btn no-print';
        button.textContent = '📅 Dues';
        button.addEventListener('click', openDues);
        actionGroup.appendChild(button);
    }

    function decoratePaidUi() {
        document.querySelectorAll('#loanList .public-loan-mini-chip').forEach(chip => {
            const text = String(chip.textContent || '').trim();
            if (/^Paid\s+/i.test(text) && !text.startsWith('✅')) {
                chip.textContent = text.replace(/^Paid\s+/i, '✅ PAID ');
            }
        });
        document.querySelectorAll('#loanList .public-loan-mini-status.paid').forEach(status => {
            if (!String(status.textContent || '').includes('✅')) status.textContent = '✅ PAID';
        });
        document.querySelectorAll('.public-loan-detail-overlay .public-emi-row.paid .public-emi-state').forEach(status => {
            status.textContent = '✅ PAID';
        });
    }

    function patchCompactUiWhenReady() {
        let attempts = 0;
        const timer = window.setInterval(() => {
            attempts += 1;
            const ready = Boolean(window.__ABHITOOLS_PUBLIC_COMPACT_UI_B6__) && typeof window.renderLoanList === 'function';
            if (!ready && attempts < 200) return;
            window.clearInterval(timer);
            if (!ready) return;

            const originalRender = window.renderLoanList;
            if (!originalRender.__abhiDuesWrapped) {
                const wrappedRender = function(...args) {
                    const result = originalRender.apply(this, args);
                    decoratePaidUi();
                    ensureDuesButton();
                    return result;
                };
                wrappedRender.__abhiDuesWrapped = true;
                window.renderLoanList = wrappedRender;
            }

            const originalOpenDetail = window.publicOpenLoanCompactDetail;
            if (typeof originalOpenDetail === 'function' && !originalOpenDetail.__abhiDuesWrapped) {
                const wrappedOpenDetail = function(...args) {
                    const result = originalOpenDetail.apply(this, args);
                    window.requestAnimationFrame(decoratePaidUi);
                    return result;
                };
                wrappedOpenDetail.__abhiDuesWrapped = true;
                window.publicOpenLoanCompactDetail = wrappedOpenDetail;
            }

            decoratePaidUi();
            ensureDuesButton();
            if (typeof currentOpenFolder !== 'undefined' && currentOpenFolder) window.renderLoanList(currentOpenFolder);
        }, 50);
    }

    document.addEventListener('click', event => {
        if (event.target.closest('[data-public-dues-close="yes"]')) {
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
    ensureDuesButton();
    patchCompactUiWhenReady();
})();
