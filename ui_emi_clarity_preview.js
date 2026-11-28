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

    function formatDate(iso) {
        return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', {
            day:'numeric', month:'short', year:'numeric', timeZone:'UTC'
        });
    }

    function emiStatus(emi) {
        const amount = Math.max(0, Number(emi?.amount) || 0);
        const paid = paidAmount(emi);
        const rem = remainingAmount(emi);
        const due = publicInstallmentDate(emi);
        const today = businessDate();
        if (amount > 0 && rem <= 0) return { key:'paid', label:'Paid' };
        if (!due) return { key:'incomplete', label:paid > 0 ? 'Partially paid' : 'Pending' };
        if (validIso(due) && due < today) return { key:'overdue', label:paid > 0 ? 'Partial • Overdue' : 'Overdue' };
        if (validIso(due) && due === today) return { key:'today', label:paid > 0 ? 'Partial • Due today' : 'Due today' };
        if (paid > 0) return { key:'partial', label:'Partial' };
        return { key:'upcoming', label:'Upcoming' };
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
            const emi = publicNextInstallment(loan.emis || []);
            const button = card.querySelector('.public-loan-mini-open');
            if (!button) return;

            const box = document.createElement('button');
            box.type = 'button';
            box.className = 'emi-clarity-next';
            if (!loan.emis?.length) {
                box.innerHTML = '<span class="emi-clarity-kicker">Next EMI</span><strong>Schedule pending</strong>';
            } else if (!emi) {
                box.classList.add('paid');
                box.innerHTML = '<span class="emi-clarity-kicker">Next EMI</span><strong>✅ All EMIs paid</strong><small>View schedule</small>';
            } else {
                const state = emiStatus(emi);
                box.classList.add(state.key);
                box.innerHTML = `
                    <span class="emi-clarity-kicker">Next EMI</span>
                    <span class="emi-clarity-main"><strong>${money(remainingAmount(emi))}</strong><b>${publicInstallmentDate(emi) ? esc(formatDate(publicInstallmentDate(emi))) : 'Due date not set'}</b></span>
                    <small>${publicInstallmentDate(emi) ? esc(publicDueLabel(emi)) + ' • ' : ''}EMI #${Number(emi.installment_number || 0)} • ${esc(state.label)}</small>`;
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
        const emis = [...(loan.emis || [])].sort((a,b) => a.installment_number - b.installment_number);
        const list = body.querySelector('.public-emi-list');
        if (!list || !emis.length) return;
        if (!body.querySelector('.emi-clarity-guide')) {
            const guide = document.createElement('div');
            guide.className = 'emi-clarity-guide';
            guide.innerHTML = '<strong>Installment schedule</strong>';
            list.before(guide);
        }
        [...list.querySelectorAll('.public-emi-row')].forEach((row, index) => {
            const emi = emis[index];
            if (!emi || row.querySelector('.emi-history-toggle')) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'emi-history-toggle';
            button.textContent = 'Payment history';
            button.setAttribute('aria-label', 'Payment history for installment ' + emi.installment_number);
            button.setAttribute('aria-expanded', 'false');
            const more = document.createElement('div');
            more.className = 'emi-clarity-more';
            more.id = 'emi-history-' + index;
            button.setAttribute('aria-controls', more.id);
            const payments = Array.isArray(emi.payments) ? emi.payments : [];
            const recorded = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
            const previous = Math.max(paidAmount(emi) - recorded, 0);
            const items = payments.map(payment =>
                `<li><time datetime="${esc(payment.payment_date)}">${esc(formatDate(payment.payment_date))}</time><b>${money(payment.amount)}</b></li>`);
            if (previous) items.push(`<li><span>Earlier payments <small>Dates unavailable</small></span><b>${money(previous)}</b></li>`);
            more.innerHTML = items.length ? '<ul>' + items.join('') + '</ul>' : '<p>No payments recorded.</p>';
            row.querySelector('.public-emi-row-head').append(button);
            row.append(more);
            button.addEventListener('click', () => {
                const expanded = row.classList.toggle('emi-clarity-open');
                button.setAttribute('aria-expanded', String(expanded));
            });
            row.addEventListener('click', event => {
                if (!event.target.closest('button,a,input,select,textarea,.upi-public-actions,.emi-clarity-more')) button.click();
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
            .public-emi-row{cursor:pointer}.emi-history-toggle{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:3px 2px;background:none;border:0;font:inherit;font-size:12px;font-weight:650;color:#185abc;cursor:pointer}.emi-history-toggle::after{content:'';width:6px;height:6px;border-right:2px solid;border-bottom:2px solid;transform:rotate(45deg);transition:transform .16s ease}.emi-history-toggle[aria-expanded=true]::after{transform:rotate(225deg)}.emi-history-toggle:focus-visible{outline:2px solid currentColor;outline-offset:2px}
            .emi-clarity-more{display:none;grid-column:1/-1;border-top:1px solid #dbe4f0;padding-top:4px;cursor:auto}.public-emi-row.emi-clarity-open .emi-clarity-more{display:block}.emi-clarity-more ul{list-style:none;padding:0;margin:0}.emi-clarity-more li{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:7px 2px;font-size:13px}.emi-clarity-more b{font-variant-numeric:tabular-nums}.emi-clarity-more p,.emi-clarity-more small{font-size:12px;color:#556579}.emi-clarity-more small{display:block}body.dark-mode .emi-history-toggle{color:#9cc6ff}body.dark-mode .emi-clarity-more p{color:#cbd5e1}@media(prefers-reduced-motion:reduce){.emi-history-toggle::after{transition:none}}
            body.dark-mode .emi-clarity-next{background:#1f2937;color:#f8fafc;border-color:#334155}body.dark-mode .emi-clarity-next:hover{background:#243247;border-color:#475569}body.dark-mode .emi-clarity-next.overdue{background:#3a1717;border-color:#7f1d1d}body.dark-mode .emi-clarity-next.today{background:#3a2f0c;border-color:#854d0e}body.dark-mode .emi-clarity-next.paid{background:#0f2d1b;border-color:#166534}body.dark-mode .emi-clarity-main b,body.dark-mode .emi-clarity-more strong{color:#f8fafc}body.dark-mode .emi-clarity-next small,body.dark-mode .emi-clarity-kicker,body.dark-mode .emi-clarity-guide span,body.dark-mode .emi-clarity-more small{color:#94a3b8}body.dark-mode .emi-clarity-guide{background:#172554;border-color:#1e3a8a}body.dark-mode .emi-clarity-more{border-color:#334155}body.dark-mode .emi-clarity-more>div{background:#111827}
            @media(max-width:430px){.emi-clarity-next{min-height:60px;padding:8px 9px}.emi-clarity-main strong{font-size:18px}.emi-clarity-main b{font-size:12px}.emi-clarity-next small{font-size:10px}}
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
                enhanceDetail(loanId);
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
