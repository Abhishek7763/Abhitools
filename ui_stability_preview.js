// Preview-only stability layer: borrower EMI remaining + dark-mode readability.
(() => {
  'use strict';
  if (window.__ABHITOOLS_STABILITY_PREVIEW__) return;
  window.__ABHITOOLS_STABILITY_PREVIEW__ = true;

  const money = value => `₹${Math.max(0, Number(value) || 0).toLocaleString('en-IN')}`;
  const remaining = emi => typeof publicEmiRemaining === 'function'
    ? Number(publicEmiRemaining(emi)) || 0
    : Math.max((Number(emi?.amount) || 0) - (Number(emi?.paid_amount) || 0), 0);

  function injectStyles() {
    if (document.getElementById('abhiStabilityPreviewStyles')) return;
    const style = document.createElement('style');
    style.id = 'abhiStabilityPreviewStyles';
    style.textContent = `
      /* Dark-mode month view readability */
      body.dark-mode .monthly-item {
        background:#2b2b2b!important;
        color:#e5e7eb!important;
        border-color:#444!important;
      }
      body.dark-mode .monthly-item > div:last-child,
      body.dark-mode .monthly-item > div:last-child strong {
        color:#f8fafc!important;
      }
      body.dark-mode .monthly-item small {
        color:#cbd5e1!important;
      }
      body.dark-mode .monthly-item strong {
        color:#66b2ff!important;
      }
      body.dark-mode .month-header {
        background:#2b2b2b!important;
        color:#7db7ff!important;
        border-color:#4b5563!important;
      }
      body.dark-mode #monthDateList .monthly-item {
        box-shadow:0 1px 0 rgba(255,255,255,.03);
      }

      /* Keep borrower summary compact: only add remaining to the existing badge. */
      #currentFolderName .stability-remaining {
        white-space:nowrap;
      }
      @media(max-width:430px) {
        #currentFolderName > span {
          max-width:100%;
          white-space:normal!important;
          line-height:1.45!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function updateBorrowerRemaining() {
    const name = String(typeof currentOpenFolder !== 'undefined' ? currentOpenFolder || '' : '').trim();
    const heading = document.getElementById('currentFolderName');
    if (!name || !heading || typeof loans === 'undefined' || !Array.isArray(loans)) return;

    const activeLoans = loans.filter(loan =>
      loan?.status === 'active' &&
      String(loan?.borrowers?.name || '').trim().toUpperCase() === name.toUpperCase()
    );
    const totalRemaining = activeLoans.reduce((sum, loan) =>
      sum + (Array.isArray(loan?.emis) ? loan.emis : []).reduce((emiSum, emi) => emiSum + remaining(emi), 0), 0);

    const badge = heading.querySelector('span');
    if (!badge) return;
    badge.querySelector('.stability-remaining')?.remove();
    const extra = document.createElement('span');
    extra.className = 'stability-remaining';
    extra.innerHTML = ` &nbsp;•&nbsp; EMI Remaining: <b>${money(totalRemaining)}</b>`;
    badge.appendChild(extra);
  }

  function install() {
    injectStyles();
    document.getElementById('mgrBorrower')?.remove();
    document.getElementById('mgrSmartDue')?.remove();
    document.getElementById('mgrModal')?.remove();

    const openFolderCore = window.openFolder;
    if (typeof openFolderCore === 'function' && !openFolderCore.__stabilityPreviewWrapped) {
      const wrapped = function(...args) {
        const result = openFolderCore.apply(this, args);
        window.requestAnimationFrame(updateBorrowerRemaining);
        window.setTimeout(updateBorrowerRemaining, 80);
        return result;
      };
      wrapped.__stabilityPreviewWrapped = true;
      window.openFolder = wrapped;
    }
    updateBorrowerRemaining();
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    install();
    if (typeof window.openFolder === 'function' || attempts > 100) {
      window.clearInterval(timer);
      install();
    }
  }, 60);
  install();
})();