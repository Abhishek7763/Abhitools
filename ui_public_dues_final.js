// AbhiTools Public Dues Final — one stable script for complete month-wise EMI lists.
(() => {
    'use strict';

    if (window.__ABHITOOLS_PUBLIC_DUES_FINAL__) return;
    window.__ABHITOOLS_PUBLIC_DUES_FINAL__ = true;

    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const MONTH_NAMES = {
        JAN:'January', FEB:'February', MAR:'March', APR:'April', MAY:'May', JUN:'June',
        JUL:'July', AUG:'August', SEP:'September', OCT:'October', NOV:'November', DEC:'December'
    };

    const esc = value => typeof publicEscapeHtml === 'function'
        ? publicEscapeHtml(value)
        : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

    const money = value => `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const validIso = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
    const normalizeName = value => String(value || '').trim().toUpperCase();

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
        const overdue = !incomplete && remaining > 0 && validIso(business) && due < business;
        const today = !incomplete && remaining > 0 && validIso(business) && due === business;

        if (remaining <= 0 && amount > 0) return { key:'paid', label:'✅ PAID' };
        if (overdue && paid > 0) return { key:'overdue', label:'🟠 PARTIAL' };
        if (overdue) return { key:'overdue', label:'🔴 OVERDUE' };
        if (today && paid > 0) return { key:'today', label:'🟠 PARTIAL' };
        if (today) return { key:'today', label:'🔔 TODAY' };
        if (incomplete && paid > 0) return { key:'incomplete', label:'🟠 PARTIAL' };
        if (incomplete) return { key:'incomplete', label:'🧩 DATE ?' };
        if (paid > 0) return { key:'partial', label:'🟠 PARTIAL' };
        return { key:'pending', label:'⏳ PENDING' };
    }

    function dateParts(emi) {
        const due = String(emi?.due_date || '').slice(0, 10);
        if (emi?.due_year && validIso(due)) {
            const d = new Date(`${due}T00:00:00Z`);
            if (!Number.isNaN(d.getTime())) {
                return { day:d.getUTCDate(), month:MONTHS[d.getUTCMonth()], year:d.getUTCFullYear() };
            }
        }

        const rawMonth = String(emi?.due_month || '').trim().toUpperCase().slice(0, 3);
        const year = Number(emi?.due_year);
        return {
            day:Number(emi?.due_day) || 0,
            month:MONTHS.includes(rawMonth) ? rawMonth : 'UNK',
            year:Number.isInteger(year) && year > 1900 ? year : null
        };
    }

    function monthHeading(group) {
        const name = MONTH_NAMES[group.month] || (group.month === 'UNK' ? 'Date Incomplete' : group.month);
        return group.year ? `${name} ${group.year}` : name;
    }

    function rowDate(row) {
        const day = row.parts.day || '—';
        return row.parts.month === 'UNK' ? String(day) : `${day} ${row.parts.month}`;
    }

    async function fetchFreshLoans() {
        const response = await fetch('/api/loans?dues_refresh=1', {
            method:'GET',
            cache:'no-store',
            credentials:'same-origin',
            headers:{ Accept:'application/json' }
        });
        if (!response.ok) throw new Error(`Loan API ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Loan API response invalid');
        return data;
    }

    function currentLoans() {
        return typeof loans !== 'undefined' && Array.isArray(loans) ? loans : [];
    }

    function buildGroups(sourceLoans, borrowerName) {
        const wanted = normalizeName(borrowerName);
        const map = new Map();

        for (const loan of (Array.isArray(sourceLoans) ? sourceLoans : [])) {
            if (normalizeName(loan?.borrowers?.name) !== wanted) continue;
            for (const emi of (Array.isArray(loan?.emis) ? loan.emis : [])) {
                const parts = dateParts(emi);
                const key = `${parts.year || 'unknown'}-${parts.month}`;
                if (!map.has(key)) map.set(key, { key, year:parts.year, month:parts.month, rows:[] });
                map.get(key).rows.push({ loan, emi, parts, state:statusFor(emi) });
            }
        }

        const groups = [...map.values()].sort((a, b) => {
            if (a.year && b.year && a.year !== b.year) return a.year - b.year;
            if (a.year && !b.year) return -1;
            if (!a.year && b.year) return 1;
            return (MONTHS.indexOf(a.month) < 0 ? 99 : MONTHS.indexOf(a.month)) -
                   (MONTHS.indexOf(b.month) < 0 ? 99 : MONTHS.indexOf(b.month));
        });

        for (const group of groups) {
            group.rows.sort((a, b) => {
                const day = (a.parts.day || 99) - (b.parts.day || 99);
                if (day) return day;
                const code = String(a.loan?.loan_code || '').localeCompare(String(b.loan?.loan_code || ''));
                if (code) return code;
                return Number(a.emi?.installment_number || 0) - Number(b.emi?.installment_number || 0);
            });
        }
        return groups;
    }

    function injectStyles() {
        if (document.getElementById('abhiPublicDuesFinalStyles')) return;
        const style = document.createElement('style');
        style.id = 'abhiPublicDuesFinalStyles';
        style.textContent = `
            body.public-dues-open { overflow:hidden!important; }
            .public-detail-actions>div { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
            .public-dues-open-btn { background:#0f766e!important; color:#fff!important; border-color:#0f766e!important; }

            /* Keep the existing public EMI detail centered on desktop. */
            @media(min-width:720px) {
                .public-loan-detail-panel {
                    top:50%!important; bottom:auto!important; left:50%!important; right:auto!important;
                    transform:translate(-50%,-50%)!important;
                    width:min(720px,calc(100vw - 40px))!important;
                    max-height:calc(100dvh - 44px)!important;
                }
            }

            .abhi-dues-overlay { position:fixed; inset:0; z-index:32500; }
            .abhi-dues-backdrop { position:absolute; inset:0; background:rgba(15,23,42,.62); backdrop-filter:blur(2px); }
            .abhi-dues-panel {
                position:absolute; left:6px; right:6px; bottom:6px; height:90dvh; max-height:90dvh;
                display:flex; flex-direction:column; overflow:hidden; background:#f8fafc; color:#0f172a;
                border:1px solid #dbe4f0; border-radius:20px 20px 14px 14px; box-shadow:0 28px 80px rgba(0,0,0,.28);
            }
            .abhi-dues-head {
                flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px;
                padding:12px 14px; background:#fff; border-bottom:1px solid #e5e7eb;
            }
            .abhi-dues-head small { display:block; color:#64748b; font-size:11px; font-weight:700; line-height:1.25; }
            .abhi-dues-head h3 { margin:3px 0 0; color:#1d4ed8; font-size:18px; line-height:1.2; }
            .abhi-dues-close {
                flex:0 0 44px; width:44px; height:44px; border:1px solid #e2e8f0; border-radius:12px;
                background:#f8fafc; color:#0f172a; cursor:pointer; font-size:19px;
            }
            .abhi-dues-body {
                flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain;
                padding:12px 9px calc(22px + env(safe-area-inset-bottom)); scroll-behavior:smooth;
            }
            .abhi-dues-loading,
            .abhi-dues-empty { padding:28px 14px; text-align:center; color:#64748b; font-size:13px; font-weight:700; }
            .abhi-dues-warning {
                margin-bottom:12px; padding:9px 11px; border:1px solid #fde68a; border-radius:10px;
                background:#fffbeb; color:#92400e; font-size:11px; line-height:1.35; font-weight:700;
            }
            .abhi-dues-month {
                display:block!important; width:100%; height:auto!important; min-height:0!important; max-height:none!important;
                margin:0 0 14px; overflow:visible!important; border:1px solid #d7e2ef; border-radius:16px;
                background:#fff; box-shadow:0 5px 18px rgba(15,23,42,.055); flex:none!important;
            }
            .abhi-dues-month:last-child { margin-bottom:0; }
            .abhi-dues-month-head {
                min-height:48px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px;
                padding:10px 13px; background:#eff6ff; color:#1d4ed8; border-radius:15px 15px 0 0;
                border-bottom:1px solid #dbeafe; white-space:nowrap;
            }
            .abhi-dues-month-head strong { grid-column:2; font-size:17px; line-height:1.15; font-weight:900; }
            .abhi-dues-count {
                grid-column:3; justify-self:end; padding:5px 8px; border-radius:999px;
                background:#dbeafe; color:#1e40af; font-size:10px; line-height:1; font-weight:900;
            }
            .abhi-dues-columns,
            .abhi-dues-row {
                display:grid; grid-template-columns:62px minmax(0,1fr) 70px max-content; align-items:center;
                column-gap:8px; width:100%; min-width:0;
            }
            .abhi-dues-columns {
                padding:7px 12px; background:#f8fafc; border-bottom:1px solid #e8eef6;
                color:#64748b; font-size:9px; line-height:1; font-weight:850; letter-spacing:.04em;
            }
            .abhi-dues-row {
                min-height:46px; padding:9px 12px; border-bottom:1px solid #edf2f7;
                background:#fff; color:#334155; font-size:12.5px; line-height:1.15; font-variant-numeric:tabular-nums;
            }
            .abhi-dues-row:nth-child(even) { background:#fbfdff; }
            .abhi-dues-row:last-child { border-bottom:0; border-radius:0 0 15px 15px; }
            .abhi-dues-date,
            .abhi-dues-loan,
            .abhi-dues-amount,
            .abhi-dues-status { white-space:nowrap; }
            .abhi-dues-date { font-weight:900; color:#0f172a; }
            .abhi-dues-loan {
                min-width:0; overflow:hidden; text-overflow:ellipsis; color:#1d4ed8; font-weight:850;
            }
            .abhi-dues-amount { text-align:right; font-weight:900; color:#0f172a; }
            .abhi-dues-status {
                justify-self:end; padding:6px 8px; border-radius:999px; background:#f1f5f9; color:#475569;
                font-size:9px; line-height:1; font-weight:900; box-shadow:inset 0 0 0 1px rgba(148,163,184,.18);
            }
            .abhi-dues-row.paid .abhi-dues-status { background:#dcfce7; color:#166534; }
            .abhi-dues-row.overdue .abhi-dues-status { background:#fee2e2; color:#991b1b; }
            .abhi-dues-row.today .abhi-dues-status { background:#fef3c7; color:#92400e; }
            .abhi-dues-row.partial .abhi-dues-status { background:#ffedd5; color:#9a3412; }
            .abhi-dues-row.incomplete .abhi-dues-status { background:#f3e8ff; color:#6b21a8; }

            body.dark-mode .abhi-dues-panel { background:#171717; color:#f8fafc; border-color:#3a3a3a; }
            body.dark-mode .abhi-dues-head,
            body.dark-mode .abhi-dues-month { background:#1f1f1f; border-color:#3a3a3a; }
            body.dark-mode .abhi-dues-head { border-bottom-color:#3a3a3a; }
            body.dark-mode .abhi-dues-close { background:#2a2a2a; color:#f8fafc; border-color:#3a3a3a; }
            body.dark-mode .abhi-dues-month-head { background:#202a3a; border-color:#334155; color:#93c5fd; }
            body.dark-mode .abhi-dues-count { background:#263a5a; color:#bfdbfe; }
            body.dark-mode .abhi-dues-columns { background:#202020; border-color:#303030; color:#94a3b8; }
            body.dark-mode .abhi-dues-row { background:#1f1f1f; border-color:#303030; color:#cbd5e1; }
            body.dark-mode .abhi-dues-row:nth-child(even) { background:#232323; }
            body.dark-mode .abhi-dues-date,
            body.dark-mode .abhi-dues-amount { color:#f8fafc; }

            @media(max-width:430px) {
                .public-detail-actions>div { width:100%; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; }
                .public-detail-actions>div .btn { min-width:0!important; justify-content:center!important; padding:10px 7px!important; font-size:12px!important; }
                .abhi-dues-panel { left:4px; right:4px; bottom:4px; height:91dvh; max-height:91dvh; }
                .abhi-dues-head { padding:10px 11px; }
                .abhi-dues-head h3 { font-size:16px; }
                .abhi-dues-body { padding:10px 6px calc(18px + env(safe-area-inset-bottom)); }
                .abhi-dues-month { margin-bottom:11px; border-radius:14px; }
                .abhi-dues-month-head { min-height:46px; padding:9px 9px; border-radius:13px 13px 0 0; }
                .abhi-dues-month-head strong { font-size:15.5px; }
                .abhi-dues-count { padding:4px 6px; font-size:9px; }
                .abhi-dues-columns { display:none; }
                .abhi-dues-row {
                    grid-template-columns:50px minmax(0,1fr) 58px max-content; column-gap:6px;
                    min-height:46px; padding:9px 9px; font-size:11.5px;
                }
                .abhi-dues-status { padding:5px 6px; font-size:8.5px; }
            }

            @media(min-width:720px) {
                .abhi-dues-panel {
                    top:50%; bottom:auto; left:50%; right:auto; transform:translate(-50%,-50%);
                    width:min(980px,calc(100vw - 60px)); height:min(86dvh,820px); max-height:min(86dvh,820px);
                    border-radius:19px;
                }
                .abhi-dues-body { padding:15px 16px 28px; }
                .abhi-dues-month { margin-bottom:18px; }
                .abhi-dues-month-head { min-height:52px; }
                .abhi-dues-month-head strong { font-size:18px; }
                .abhi-dues-columns,
                .abhi-dues-row { grid-template-columns:105px minmax(0,1fr) 120px 150px; column-gap:16px; }
                .abhi-dues-columns { padding:9px 18px; font-size:10px; }
                .abhi-dues-row { min-height:50px; padding:10px 18px; font-size:14px; }
                .abhi-dues-loan { overflow:visible; text-overflow:clip; }
                .abhi-dues-amount { text-align:left; }
                .abhi-dues-status { justify-self:start; padding:7px 10px; font-size:10px; }
            }
        `;
        document.head.appendChild(style);
    }

    function closeDues() {
        document.getElementById('abhiBorrowerDuesOverlay')?.remove();
        document.getElementById('publicBorrowerDuesOverlay')?.remove();
        document.body.classList.remove('public-dues-open');
    }

    function renderMonths(groups, warning = '') {
        const months = groups.map(group => {
            const rows = group.rows.map(row => `
                <div class="abhi-dues-row ${esc(row.state.key)}">
                    <span class="abhi-dues-date">${esc(rowDate(row))}</span>
                    <span class="abhi-dues-loan" title="${esc(row.loan?.loan_code || 'Loan')}">${esc(row.loan?.loan_code || 'Loan')}</span>
                    <span class="abhi-dues-amount">${money(row.emi?.amount)}</span>
                    <span class="abhi-dues-status">${esc(row.state.label)}</span>
                </div>`).join('');

            return `<section class="abhi-dues-month" data-expected-rows="${group.rows.length}">
                <div class="abhi-dues-month-head">
                    <strong>${esc(monthHeading(group))}</strong>
                    <span class="abhi-dues-count">${group.rows.length} EMI</span>
                </div>
                <div class="abhi-dues-columns" aria-hidden="true">
                    <span>DATE</span><span>LOAN ID</span><span>EMI</span><span>STATUS</span>
                </div>
                <div class="abhi-dues-list">${rows}</div>
            </section>`;
        }).join('');

        return `${warning ? `<div class="abhi-dues-warning">${esc(warning)}</div>` : ''}${months || '<div class="abhi-dues-empty">Is profile me koi EMI schedule nahi mila.</div>'}`;
    }

    function verifyRows(body, groups) {
        const cards = [...body.querySelectorAll('.abhi-dues-month')];
        return cards.length === groups.length && cards.every((card, index) => {
            const actual = card.querySelectorAll('.abhi-dues-row').length;
            const expected = groups[index]?.rows?.length || 0;
            return actual === expected && Number(card.dataset.expectedRows || 0) === expected;
        });
    }

    async function openDues() {
        const borrowerName = typeof currentOpenFolder !== 'undefined' ? String(currentOpenFolder || '') : '';
        if (!borrowerName) return;
        if (typeof window.publicCloseLoanCompactDetail === 'function') window.publicCloseLoanCompactDetail();
        closeDues();

        const overlay = document.createElement('div');
        overlay.id = 'abhiBorrowerDuesOverlay';
        overlay.className = 'abhi-dues-overlay no-print';
        overlay.innerHTML = `<div class="abhi-dues-backdrop" data-abhi-dues-close="yes"></div>
            <section class="abhi-dues-panel" role="dialog" aria-modal="true" aria-labelledby="abhiBorrowerDuesTitle">
                <header class="abhi-dues-head">
                    <div><small>Complete month-wise EMI schedule</small><h3 id="abhiBorrowerDuesTitle">📅 ${esc(borrowerName)} — Dues</h3></div>
                    <button type="button" class="abhi-dues-close" data-abhi-dues-close="yes" aria-label="Close">✕</button>
                </header>
                <div class="abhi-dues-body"><div class="abhi-dues-loading">🔄 Complete EMI schedule load ho raha hai…</div></div>
            </section>`;
        document.body.appendChild(overlay);
        document.body.classList.add('public-dues-open');
        window.setTimeout(() => overlay.querySelector('.abhi-dues-close')?.focus(), 0);

        const body = overlay.querySelector('.abhi-dues-body');
        try {
            const fresh = await fetchFreshLoans();
            if (!document.body.contains(overlay)) return;
            const groups = buildGroups(fresh, borrowerName);
            body.innerHTML = renderMonths(groups);
            if (!verifyRows(body, groups)) throw new Error('Rendered EMI row count mismatch');
            body.scrollTop = 0;
        } catch (error) {
            console.warn('Fresh dues render failed, using current dashboard data:', error);
            if (!document.body.contains(overlay)) return;
            const groups = buildGroups(currentLoans(), borrowerName);
            body.innerHTML = renderMonths(groups, 'Live refresh verify nahi ho saka; current dashboard data dikhaya ja raha hai. Dues dobara open karke retry karein.');
            body.scrollTop = 0;
        }
    }

    function ensureDuesButton() {
        const actionGroup = document.querySelector('#detailView .public-detail-actions > div');
        if (!actionGroup) return false;
        const old = document.getElementById('publicBorrowerDuesBtn');
        if (old) old.remove();

        const button = document.createElement('button');
        button.id = 'publicBorrowerDuesBtn';
        button.type = 'button';
        button.className = 'btn btn-view public-dues-open-btn no-print';
        button.textContent = '📅 Dues';
        button.addEventListener('click', openDues);
        actionGroup.appendChild(button);
        return true;
    }

    function decoratePaidUi() {
        document.querySelectorAll('#loanList .public-loan-mini-chip').forEach(chip => {
            const text = String(chip.textContent || '').trim();
            if (/^Paid\s+/i.test(text) && !text.startsWith('✅')) chip.textContent = text.replace(/^Paid\s+/i, '✅ PAID ');
        });
        document.querySelectorAll('#loanList .public-loan-mini-status.paid').forEach(status => { status.textContent = '✅ PAID'; });
        document.querySelectorAll('.public-loan-detail-overlay .public-emi-row.paid .public-emi-state').forEach(status => { status.textContent = '✅ PAID'; });
    }

    function patchRenderWhenReady() {
        let attempts = 0;
        const timer = window.setInterval(() => {
            attempts += 1;
            const ready = typeof window.renderLoanList === 'function';
            if (!ready && attempts < 200) return;
            window.clearInterval(timer);
            if (!ready) return;

            const originalRender = window.renderLoanList;
            if (!originalRender.__abhiDuesFinalWrapped) {
                const wrapped = function(...args) {
                    const result = originalRender.apply(this, args);
                    ensureDuesButton();
                    decoratePaidUi();
                    return result;
                };
                wrapped.__abhiDuesFinalWrapped = true;
                window.renderLoanList = wrapped;
            }

            const originalOpenDetail = window.publicOpenLoanCompactDetail;
            if (typeof originalOpenDetail === 'function' && !originalOpenDetail.__abhiDuesFinalWrapped) {
                const wrappedOpen = function(...args) {
                    const result = originalOpenDetail.apply(this, args);
                    window.requestAnimationFrame(decoratePaidUi);
                    return result;
                };
                wrappedOpen.__abhiDuesFinalWrapped = true;
                window.publicOpenLoanCompactDetail = wrappedOpen;
            }

            ensureDuesButton();
            decoratePaidUi();
        }, 50);
    }

    document.addEventListener('click', event => {
        if (event.target.closest('[data-abhi-dues-close="yes"]')) {
            event.preventDefault();
            closeDues();
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById('abhiBorrowerDuesOverlay')) closeDues();
    });

    window.publicOpenBorrowerDues = openDues;
    window.publicCloseBorrowerDues = closeDues;

    injectStyles();
    ensureDuesButton();
    decoratePaidUi();
    patchRenderWhenReady();
})();
