// Preview-only loan-card priority: Due today -> 1 day left -> 2 days left -> future dates.
// Presentation order only; no financial/API/database behavior is changed.
(() => {
    'use strict';
    if (window.__ABHITOOLS_EMI_DUE_PRIORITY_PREVIEW__) return;
    window.__ABHITOOLS_EMI_DUE_PRIORITY_PREVIEW__ = true;

    const validIso = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

    function paidAmount(emi) {
        if (typeof publicEmiPaid === 'function') return Number(publicEmiPaid(emi)) || 0;
        const amount = Math.max(0, Number(emi?.amount) || 0);
        return Math.min(Math.max(Number(emi?.paid_amount) || 0, 0), amount);
    }

    function remainingAmount(emi) {
        if (typeof publicEmiRemaining === 'function') return Number(publicEmiRemaining(emi)) || 0;
        return Math.max((Number(emi?.amount) || 0) - paidAmount(emi), 0);
    }

    function businessDate() {
        const apiDate = String(typeof publicDueData !== 'undefined' ? publicDueData?.businessDate || '' : '').slice(0, 10);
        if (validIso(apiDate)) return apiDate;
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit'
        }).formatToParts(new Date());
        const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${map.year}-${map.month}-${map.day}`;
    }

    function dueIso(emi) {
        const direct = String(emi?.due_date || '').slice(0, 10);
        if (validIso(direct)) return direct;
        const year = Number(emi?.due_year);
        const month = months.indexOf(String(emi?.due_month || '').trim().toUpperCase().slice(0, 3)) + 1;
        const day = Number(emi?.due_day);
        if (!Number.isInteger(year) || year < 1900 || month < 1 || !Number.isInteger(day) || day < 1) return '';
        return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }

    function nextPending(loan) {
        return (Array.isArray(loan?.emis) ? loan.emis : [])
            .filter(emi => remainingAmount(emi) > 0)
            .map(emi => ({ emi, due:dueIso(emi) }))
            .sort((a,b) => {
                const ad = a.due || '9999-12-31';
                const bd = b.due || '9999-12-31';
                if (ad !== bd) return ad.localeCompare(bd);
                return Number(a.emi?.installment_number || 0) - Number(b.emi?.installment_number || 0);
            })[0] || null;
    }

    function loanForCard(card) {
        const open = card?.querySelector('.public-loan-mini-open');
        const onclick = String(open?.getAttribute('onclick') || '');
        const match = onclick.match(/publicOpenLoanCompactDetail\(['\"]([^'\"]+)['\"]\)/);
        const id = match?.[1];
        if (!id || typeof loans === 'undefined' || !Array.isArray(loans)) return null;
        return loans.find(item => String(item?.id) === String(id)) || null;
    }

    function priorityFor(loan) {
        const next = nextPending(loan);
        if (!next) return { group:5, days:999999, due:'9999-12-31' }; // all paid / no pending
        if (!validIso(next.due)) return { group:4, days:999998, due:'9999-12-30' }; // incomplete date

        const today = businessDate();
        const days = Math.round((Date.parse(`${next.due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

        // Exact requested order: due today first, then 1 day left, 2 days left, etc.
        if (days === 0) return { group:0, days:0, due:next.due };
        if (days > 0) return { group:1, days, due:next.due };
        // Already overdue remains urgent, but is kept after today's/future day-left queue in this preview.
        return { group:2, days:Math.abs(days), due:next.due };
    }

    function reorderLoanCards() {
        const list = document.getElementById('loanList');
        if (!list || typeof loans === 'undefined' || !Array.isArray(loans)) return;
        const cards = [...list.querySelectorAll(':scope > .public-loan-mini-card')];
        if (cards.length < 2) return;

        const ranked = cards.map((card, index) => {
            const loan = loanForCard(card);
            const p = loan ? priorityFor(loan) : { group:9, days:999999, due:'9999-12-31' };
            return { card, index, ...p };
        }).sort((a,b) => {
            if (a.group !== b.group) return a.group - b.group;
            if (a.days !== b.days) return a.days - b.days;
            if (a.due !== b.due) return a.due.localeCompare(b.due);
            return a.index - b.index;
        });

        ranked.forEach(item => list.appendChild(item.card));
    }

    function install() {
        const render = window.renderLoanList;
        if (typeof render === 'function' && !render.__emiDuePriorityPreviewWrapped) {
            const wrapped = function(...args) {
                const result = render.apply(this, args);
                window.requestAnimationFrame(reorderLoanCards);
                return result;
            };
            wrapped.__emiDuePriorityPreviewWrapped = true;
            window.renderLoanList = wrapped;
        }
        reorderLoanCards();
    }

    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        window.requestAnimationFrame(() => {
            queued = false;
            reorderLoanCards();
        });
    });
    observer.observe(document.body, { childList:true, subtree:true });

    let attempts = 0;
    const timer = window.setInterval(() => {
        attempts += 1;
        install();
        if (typeof window.renderLoanList === 'function' || attempts > 160) {
            window.clearInterval(timer);
            install();
        }
    }, 50);
    install();
})();
