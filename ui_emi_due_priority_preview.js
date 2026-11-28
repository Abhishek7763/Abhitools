// Preview-only loan-card priority: Due today -> 1 day left -> 2 days left -> future dates.
// Presentation order only; no financial/API/database behavior is changed.
(() => {
    'use strict';
    if (window.__ABHITOOLS_EMI_DUE_PRIORITY_PREVIEW__) return;
    window.__ABHITOOLS_EMI_DUE_PRIORITY_PREVIEW__ = true;

    const validIso = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
    function businessDate() {
        const apiDate = String(typeof publicDueData !== 'undefined' ? publicDueData?.businessDate || '' : '').slice(0, 10);
        if (validIso(apiDate)) return apiDate;
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit'
        }).formatToParts(new Date());
        const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${map.year}-${map.month}-${map.day}`;
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
        const emi = publicNextInstallment(loan.emis || []);
        if (!emi) return { group:5, days:0, due:'' };
        const due = publicInstallmentDate(emi);
        if (!due) return { group:4, days:0, due:'' };

        const today = businessDate();
        const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

        // Exact requested order: due today first, then 1 day left, 2 days left, etc.
        if (days === 0) return { group:0, days:0, due:due };
        if (days > 0) return { group:1, days, due:due };
        // Already overdue remains urgent, but is kept after today's/future day-left queue in this preview.
        return { group:2, days:Math.abs(days), due:due };
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

        if (ranked.every((item, index) => item.card === cards[index])) return;
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
