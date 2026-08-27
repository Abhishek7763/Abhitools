// AbhiTools Public Paid-First Ordering — display priority only; no financial state changes.
(() => {
    'use strict';

    if (window.__ABHITOOLS_PUBLIC_PAID_FIRST__) return;
    window.__ABHITOOLS_PUBLIC_PAID_FIRST__ = true;

    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

    function paidAmount(emi) {
        if (typeof publicEmiPaid === 'function') return Number(publicEmiPaid(emi)) || 0;
        const amount = Math.max(0, Number(emi?.amount) || 0);
        return Math.min(Math.max(Number(emi?.paid_amount) || 0, 0), amount);
    }

    function remainingAmount(emi) {
        if (typeof publicEmiRemaining === 'function') return Number(publicEmiRemaining(emi)) || 0;
        return Math.max((Number(emi?.amount) || 0) - paidAmount(emi), 0);
    }

    function fullyPaidEmi(emi) {
        const amount = Math.max(0, Number(emi?.amount) || 0);
        return amount > 0 && remainingAmount(emi) <= 0;
    }

    function dueSortValue(emi) {
        const due = String(emi?.due_date || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return `${due}-${String(Number(emi?.installment_number || 0)).padStart(5, '0')}`;

        const year = Number(emi?.due_year);
        const month = MONTHS.indexOf(String(emi?.due_month || '').trim().toUpperCase().slice(0, 3));
        const day = Number(emi?.due_day) || 99;
        const installment = Number(emi?.installment_number) || 0;
        const safeYear = Number.isInteger(year) && year > 1900 ? year : 9999;
        const safeMonth = month >= 0 ? month + 1 : 99;
        return `${String(safeYear).padStart(4, '0')}-${String(safeMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}-${String(installment).padStart(5, '0')}`;
    }

    function paidFirstEmis(items) {
        return (Array.isArray(items) ? items : [])
            .map((item, index) => ({ item, index }))
            .sort((a, b) => {
                const paidRank = Number(!fullyPaidEmi(a.item)) - Number(!fullyPaidEmi(b.item));
                if (paidRank) return paidRank;
                const dateRank = dueSortValue(a.item).localeCompare(dueSortValue(b.item));
                if (dateRank) return dateRank;
                return a.index - b.index;
            })
            .map(entry => entry.item);
    }

    function fullyPaidLoanCard(card) {
        return card?.classList?.contains('state-paid') || card?.querySelector?.('.public-loan-mini-status.paid');
    }

    function reorderChildren(container, selector, isPaid) {
        if (!container) return false;
        const rows = [...container.children].filter(child => child.matches?.(selector));
        if (rows.length < 2) return false;
        const sorted = [...rows.filter(isPaid), ...rows.filter(row => !isPaid(row))];
        const alreadySorted = rows.every((row, index) => row === sorted[index]);
        if (alreadySorted) return false;
        sorted.forEach(row => container.appendChild(row));
        return true;
    }

    function reorderLoanCards() {
        reorderChildren(document.getElementById('loanList'), '.public-loan-mini-card', fullyPaidLoanCard);
    }

    function reorderCompactEmis() {
        document.querySelectorAll('.public-emi-list').forEach(list => {
            reorderChildren(list, '.public-emi-row', row => row.classList.contains('paid'));
        });
    }

    function reorderDues() {
        document.querySelectorAll('.abhi-dues-list').forEach(list => {
            reorderChildren(list, '.abhi-dues-row', row => row.classList.contains('paid'));
        });
    }

    function decoratePaidUi() {
        document.querySelectorAll('#loanList .public-loan-mini-status.paid').forEach(status => {
            status.textContent = '✅ PAID';
        });
        document.querySelectorAll('#loanList .public-loan-mini-chip').forEach(chip => {
            const text = String(chip.textContent || '').trim();
            if (/^Paid\s+/i.test(text) && !text.startsWith('✅')) chip.textContent = text.replace(/^Paid\s+/i, '✅ PAID ');
        });
        document.querySelectorAll('.public-emi-row.paid .public-emi-state').forEach(status => {
            status.textContent = '✅ PAID';
        });
    }

    // Core/fallback EMI schedule: paid first, then normal due order.
    const originalRenderEmiItems = window.renderEmiItems;
    if (typeof originalRenderEmiItems === 'function' && !originalRenderEmiItems.__abhiPaidFirstWrapped) {
        const wrappedRenderEmiItems = function(emis, ...rest) {
            return originalRenderEmiItems.call(this, paidFirstEmis(emis), ...rest);
        };
        wrappedRenderEmiItems.__abhiPaidFirstWrapped = true;
        window.renderEmiItems = wrappedRenderEmiItems;
    }

    // Month detail: paid EMI rows always first; paid group itself remains date-wise.
    const originalOpenMonthDetail = window.openMonthDetail;
    if (typeof originalOpenMonthDetail === 'function' && !originalOpenMonthDetail.__abhiPaidFirstWrapped) {
        const wrappedOpenMonthDetail = function(key, monthObj) {
            const clone = { ...(monthObj || {}) };
            const sortedItems = paidFirstEmis(monthObj?.items);
            // Legacy renderer calls items.sort(due_day). Shadow sort so paid-first remains authoritative.
            sortedItems.sort = function() {
                return Array.prototype.sort.call(this, (a, b) => {
                    const paidRank = Number(!fullyPaidEmi(a)) - Number(!fullyPaidEmi(b));
                    if (paidRank) return paidRank;
                    const dateRank = dueSortValue(a).localeCompare(dueSortValue(b));
                    if (dateRank) return dateRank;
                    return 0;
                });
            };
            clone.items = sortedItems;
            return originalOpenMonthDetail.call(this, key, clone);
        };
        wrappedOpenMonthDetail.__abhiPaidFirstWrapped = true;
        window.openMonthDetail = wrappedOpenMonthDetail;
    }

    function patchCompactUi() {
        const render = window.renderLoanList;
        if (typeof render === 'function' && window.__ABHITOOLS_PUBLIC_COMPACT_UI_B6__ && !render.__abhiPaidFirstWrapped) {
            const wrappedRender = function(...args) {
                const result = render.apply(this, args);
                reorderLoanCards();
                decoratePaidUi();
                return result;
            };
            wrappedRender.__abhiPaidFirstWrapped = true;
            window.renderLoanList = wrappedRender;
        }

        const open = window.publicOpenLoanCompactDetail;
        if (typeof open === 'function' && !open.__abhiPaidFirstWrapped) {
            const wrappedOpen = function(...args) {
                const result = open.apply(this, args);
                window.requestAnimationFrame(() => {
                    reorderCompactEmis();
                    decoratePaidUi();
                });
                return result;
            };
            wrappedOpen.__abhiPaidFirstWrapped = true;
            window.publicOpenLoanCompactDetail = wrappedOpen;
        }

        reorderLoanCards();
        reorderCompactEmis();
        reorderDues();
        decoratePaidUi();
    }

    // Dues rows arrive asynchronously after fresh /api/loans fetch, so observe only public list surfaces.
    let observerQueued = false;
    const observer = new MutationObserver(() => {
        if (observerQueued) return;
        observerQueued = true;
        window.requestAnimationFrame(() => {
            observerQueued = false;
            reorderLoanCards();
            reorderCompactEmis();
            reorderDues();
            decoratePaidUi();
        });
    });
    observer.observe(document.body, { childList:true, subtree:true });

    let attempts = 0;
    const timer = window.setInterval(() => {
        attempts += 1;
        patchCompactUi();
        if ((window.__ABHITOOLS_PUBLIC_COMPACT_UI_B6__ && typeof window.publicOpenLoanCompactDetail === 'function') || attempts >= 240) {
            window.clearInterval(timer);
            patchCompactUi();
        }
    }, 50);

    patchCompactUi();
})();
