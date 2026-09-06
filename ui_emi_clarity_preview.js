// Preview-only EMI clarity layer: next-due visibility + tappable EMI details.
// No financial/API/database behavior is changed here.
(() => {
    'use strict';
    if (window.__ABHITOOLS_EMI_CLARITY_PREVIEW__) return;
    window.__ABHITOOLS_EMI_CLARITY_PREVIEW__ = true;

    const esc = value => typeof publicEscapeHtml === 'function'
        ? publicEscapeHtml(value)
        : String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const money = value => `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const validIso = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));

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
        const value = String(typeof publicDueData !== 'undefined' ? publicDueData?.businessDate || '' : '').slice(0, 10);
        return validIso(value) ? value : new Date().toISOString().slice(0, 10);
    }

    function dueIso(emi) {
        const direct = String(emi?.due_date || '').slice(0, 10);
        if (validIso(direct)) return direct;
        const year = Number(emi?.due_year);
        const monthRaw = String(emi?.due_month || '').trim().toUpperCase().slice(0, 3);
        const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        const month = months.indexOf(monthRaw) + 1;
        const day = Number(emi?.due_day);
        if (!year || month < 1 || !day) return '';
        return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }

    function formatDate(emi) {
        const iso = dueIso(emi);
        if (validIso(iso)) {
            const d = new Date(`${iso}T00:00:00Z`);
            return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
        }
        const day = Number(emi?.due_day) || '—';
        const month = String(emi?.due_month || '').trim().toUpperCase() || '—';
        return `${day} ${month}${emi?.due_year ? ` ${emi.due_year}` : ''}`;
    }

    function dayLabel(emi) {
        const due = dueIso(emi);
        const today = businessDate();
        if (!validIso(due) || !validIso(today)) return 'Date check';
        const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
        if (days < 0) return `${Math.abs(days)} day overdue`;
        if (days === 0) return 'Due today';
        if (days === 1) return 'Due tomorrow';
        return `${days} days left`;
    }

    function emiStatus(emi) {
        const amount = Math.max(0, Number(emi?.amount) || 0);
        const paid = paidAmount(emi);
        const rem = remainingAmount(emi);
        const due = dueIso(emi);
        const today = businessDate();
        if (amount > 0 && rem <= 0) return { key:'paid', label:'Paid' };
        if (validIso(due) && due < today) return { key:'overdue', label:paid > 0 ? 'Partial • Overdue' : 'Overdue' };
        if (validIso(due) && due === today) return { key:'today', label:paid > 0 ? 'Partial • Due today' : 'Due today' };
        if (paid > 0) return { key:'partial', label:'Partial' };
        return { key:'upcoming', label:'Upcoming' };
    }

    function nextEmi(loan) {
        const pending = (Array.isArray(loan?.emis) ? loan.emis : []).filter(emi => remainingAmount(emi) > 0);
        pending.sort((a, b) => {
            const ad = dueIso(a) || '9999-12-31';
            const bd = dueIso(b) || '9999-12-31';
            if (ad !== bd) return ad.localeCompare(bd);
            return Number(a?.installment_number || 0) - Number(b?.installment_number || 0);
        });
        return pending[0] || null;
    }

    function loanFromCard(card) {
        const open = card?.querySelector('.public-loan-mini-open');
        const onclick = String(open?.getAttribute('onclick') || '');
        const match = onclick.match(/publicOpenLoanCompactDetail\(['"]([^'"]+)['"]\)/);
        const id = match?.[1];
        if (!id || typeof loans === 'undefined' || !Array.isArray(loans)) return null;
        return loans.find(item => String(item?.id) === String(id)) || null;
    }

    function decorateCards() {
        document.querySelectorAll('#loanList .public-loan-mini-card').forEach(card => {
            card.querySelector('.emi-clarity-next')?.remove();
            const loan = loanFromCard(card);
            if (!loan) return;
            const emi = nextEmi(loan);
            const button = card.querySelector('.public-loan-mini-open');
            if (!button) return;

            const box = document.createElement('button');
            box.type = 'button';
            box.className = 'emi-clarity-next';
            if (!emi) {
                box.classList.add('paid');
                box.innerHTML = '<span class="emi-clarity-kicker">Next EMI</span><strong>✅ All EMIs paid</strong><small>Complete schedule dekhne ke liye tap karein</small>';
            } else {
                const state = emiStatus(emi);
                box.classList.add(state.key);
                box.innerHTML = `
                    <span class="emi-clarity-kicker">Next EMI</span>
                    <span class="emi-clarity-main"><strong>${money(remainingAmount(emi))}</strong><b>${esc(formatDate(emi))}</b></span>
                    <small>${esc(dayLabel(emi))} • EMI #${Number(emi.installment_number || 0)} • ${esc(state.label)}</small>`;
            }
            box.addEventListener('click', () => window.publicOpenLoanCompactDetail?.(String(loan.id)));
            const footer = card.querySelector('.public-loan-mini-footer');
            (footer || button).insertAdjacentElement('beforebegin', box);
        });
    }

    function enhanceDetail(loanId) {
        const overlay = document.getElementById('publicLoanDetailOverlay');
        if (!overlay || typeof loans === 'undefined' || !Array.isArray(loans)) return;
        const loan = loans.find(item => String(item?.id) === String(loanId));
        if (!loan) return;

        const body = overlay.querySelector('.public-loan-detail-body');
        if (!body) return;
        body.querySelector('.emi-clarity-guide')?.remove();
        const guide = document.createElement('div');
        guide.className = 'emi-clarity-guide';
        guide.innerHTML = '<strong>EMI Schedule</strong><span>Kisi EMI ko tap karke payment status aur complete details dekhein.</span>';
        const list = body.querySelector('.public-emi-list');
        if (list) list.insertAdjacentElement('beforebegin', guide);

        const emis = [...(loan.emis || [])].sort((a,b) => Number(a.installment_number || 0) - Number(b.installment_number || 0));
        const rows = [...overlay.querySelectorAll('.public-emi-row')];
        rows.forEach((row, index) => {
            if (row.dataset.emiClarityReady === 'yes') return;
            const emi = emis[index];
            if (!emi) return;
            row.dataset.emiClarityReady = 'yes';
            row.tabIndex = 0;
            row.setAttribute('role', 'button');
            row.setAttribute('aria-expanded', 'false');

            const state = emiStatus(emi);
            const more = document.createElement('div');
            more.className = 'emi-clarity-more';
            more.innerHTML = `
                <div><small>Installment</small><strong>#${Number(emi.installment_number || 0)}</strong></div>
                <div><small>Due date</small><strong>${esc(formatDate(emi))}</strong></div>
                <div><small>EMI amount</small><strong>${money(emi.amount)}</strong></div>
                <div><small>Paid</small><strong>${money(paidAmount(emi))}</strong></div>
                <div><small>Remaining</small><strong>${money(remainingAmount(emi))}</strong></div>
                <div><small>Status</small><strong>${esc(state.label)}</strong></div>`;
            row.appendChild(more);

            const toggle = event => {
                if (event.target.closest('button,a,input,select,textarea,.upi-public-actions')) return;
                const open = row.classList.toggle('emi-clarity-open');
                row.setAttribute('aria-expanded', open ? 'true' : 'false');
            };
            row.addEventListener('click', toggle);
            row.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle(event);
                }
            });
        });
    }

    function injectStyles() {
        if (document.getElementById('emiClarityPreviewStyles')) return;
        const style = document.createElement('style');
        style.id = 'emiClarityPreviewStyles';
        style.textContent = `
            .emi-clarity-next{width:100%;min-height:64px;border:1px solid #dbeafe;border-radius:12px;padding:9px 11px;background:#f8fbff;color:#0f172a;text-align:left;display:grid;gap:4px;cursor:pointer;font:inherit;box-shadow:none}
            .emi-clarity-next:hover{border-color:#93c5fd;background:#eff6ff}.emi-clarity-next.overdue{border-color:#fecaca;background:#fff7f7}.emi-clarity-next.today{border-color:#fde68a;background:#fffbeb}.emi-clarity-next.paid{border-color:#bbf7d0;background:#f0fdf4}.emi-clarity-kicker{font-size:10px;font-weight:850;letter-spacing:.05em;text-transform:uppercase;color:#64748b}.emi-clarity-main{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.emi-clarity-main strong{font-size:19px;color:#1d4ed8;font-variant-numeric:tabular-nums}.emi-clarity-main b{font-size:13px;color:#0f172a;white-space:nowrap}.emi-clarity-next small{font-size:10.5px;color:#64748b;font-weight:700;line-height:1.3}
            .emi-clarity-guide{margin:2px 0 8px;padding:9px 10px;border:1px solid #dbeafe;border-radius:10px;background:#eff6ff;display:grid;gap:2px}.emi-clarity-guide strong{font-size:12px;color:#1d4ed8}.emi-clarity-guide span{font-size:10.5px;color:#64748b;line-height:1.35}
            .public-emi-row{cursor:pointer}.public-emi-row:focus-visible{outline:3px solid rgba(37,99,235,.22);outline-offset:2px}.emi-clarity-more{display:none;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;width:100%;grid-column:1/-1;padding-top:9px;margin-top:8px;border-top:1px dashed #dbe4f0}.public-emi-row.emi-clarity-open .emi-clarity-more{display:grid}.emi-clarity-more>div{min-width:0;padding:7px 8px;border-radius:9px;background:#f8fafc}.emi-clarity-more small,.emi-clarity-more strong{display:block}.emi-clarity-more small{font-size:8.5px;color:#64748b;font-weight:750;text-transform:uppercase;letter-spacing:.03em}.emi-clarity-more strong{margin-top:2px;font-size:11px;color:#0f172a;word-break:break-word}
            body.dark-mode .emi-clarity-next{background:#1f2937;color:#f8fafc;border-color:#334155}body.dark-mode .emi-clarity-next:hover{background:#243247;border-color:#475569}body.dark-mode .emi-clarity-next.overdue{background:#3a1717;border-color:#7f1d1d}body.dark-mode .emi-clarity-next.today{background:#3a2f0c;border-color:#854d0e}body.dark-mode .emi-clarity-next.paid{background:#0f2d1b;border-color:#166534}body.dark-mode .emi-clarity-main b,body.dark-mode .emi-clarity-more strong{color:#f8fafc}body.dark-mode .emi-clarity-next small,body.dark-mode .emi-clarity-kicker,body.dark-mode .emi-clarity-guide span,body.dark-mode .emi-clarity-more small{color:#94a3b8}body.dark-mode .emi-clarity-guide{background:#172554;border-color:#1e3a8a}body.dark-mode .emi-clarity-more{border-color:#334155}body.dark-mode .emi-clarity-more>div{background:#111827}
            @media(max-width:430px){.emi-clarity-next{min-height:60px;padding:8px 9px}.emi-clarity-main strong{font-size:18px}.emi-clarity-main b{font-size:12px}.emi-clarity-next small{font-size:10px}.emi-clarity-more{grid-template-columns:repeat(2,minmax(0,1fr))}}
        `;
        document.head.appendChild(style);
    }

    function install() {
        injectStyles();
        const render = window.renderLoanList;
        if (typeof render === 'function' && !render.__emiClarityPreviewWrapped) {
            const wrapped = function(...args) {
                const result = render.apply(this, args);
                window.requestAnimationFrame(decorateCards);
                return result;
            };
            wrapped.__emiClarityPreviewWrapped = true;
            window.renderLoanList = wrapped;
        }

        const open = window.publicOpenLoanCompactDetail;
        if (typeof open === 'function' && !open.__emiClarityPreviewWrapped) {
            const wrappedOpen = function(loanId, ...rest) {
                const result = open.call(this, loanId, ...rest);
                window.setTimeout(() => enhanceDetail(loanId), 25);
                window.setTimeout(() => enhanceDetail(loanId), 250);
                return result;
            };
            wrappedOpen.__emiClarityPreviewWrapped = true;
            window.publicOpenLoanCompactDetail = wrappedOpen;
        }
        decorateCards();
    }

    let attempts = 0;
    const timer = window.setInterval(() => {
        attempts += 1;
        install();
        if ((typeof window.renderLoanList === 'function' && typeof window.publicOpenLoanCompactDetail === 'function') || attempts > 160) {
            window.clearInterval(timer);
            install();
        }
    }, 50);
    install();
})();
