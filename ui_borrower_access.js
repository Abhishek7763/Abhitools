// Keep the account credential only for this open view.
let accountAccess = null;
let phoneRequest = null;
let accessTimer;
const phoneDialog = document.getElementById('phoneDialog');
const phoneInput = document.getElementById('accountPhone');
const phoneFeedback = document.getElementById('phoneFeedback');
const phoneSubmit = document.getElementById('phoneSubmit');

function stopPhoneRequest() {
    phoneRequest?.controller?.abort();
    phoneRequest = null;
}

function setPhoneState(state, message = '') {
    const labels = {
        idle: 'Open account',
        checking: 'Verifying number…',
        success: 'Opening account…',
        invalid: 'Verify number',
        error: 'Try again'
    };
    phoneDialog.dataset.state = state;
    phoneSubmit.textContent = labels[state];
    phoneSubmit.disabled = state === 'checking' || state === 'success';
    phoneInput.readOnly = phoneSubmit.disabled;
    phoneInput.setAttribute('aria-invalid', String(state === 'invalid'));
    phoneSubmit.setAttribute('aria-busy', String(state === 'checking'));
    phoneFeedback.textContent = message;
}

function clearBorrowerAccess() {
    accountAccess = null;
    stopPhoneRequest();
    clearTimeout(accessTimer);
    loans = [];
    currentOpenFolder = null;
    if (phoneDialog.open) phoneDialog.close();
    phoneInput.value = '';
    for (const id of ['loanList','currentFolderName','monthDateList','currentMonthName']) document.getElementById(id)?.replaceChildren();
    document.querySelectorAll('#mgrBorrower,.abhi-print-sheet,#publicLoanDetailOverlay,#abhiBorrowerDuesOverlay,#upiReferenceOverlay,#upiPublicNotice').forEach(el=>el.remove());
    document.body.classList.remove('public-detail-active','public-dues-open','public-loan-detail-open');
}

async function fetchVerifiedLoans(signal) {
    const access = accountAccess;
    if (!access) throw new Error('Account access has expired.');
    const response = await fetch('/api/loans?action=account',{cache:'no-store',signal,headers:{Authorization:'Bearer '+access.token}});
    if (response.status === 401 && accountAccess === access) switchTab('folder');
    if (!response.ok) throw new Error('Could not refresh this account.');
    return response.json();
}

function requestBorrowerAccess(member,month = '') {
    stopPhoneRequest();
    clearTimeout(accessTimer);
    accountAccess = null;
    loans = [];
    phoneRequest = { key:member.key, month };
    document.getElementById('phoneTitle').textContent = member.name;
    phoneInput.value = '';
    setPhoneState('idle');
    if (!phoneDialog.open) phoneDialog.showModal();
    phoneInput.focus();
}

function cancelBorrowerPrompt() {
    stopPhoneRequest();
    phoneInput.value = '';
    phoneDialog.close();
}
document.getElementById('phoneClose').onclick = cancelBorrowerPrompt;
phoneDialog.addEventListener('cancel',event=>{ event.preventDefault(); cancelBorrowerPrompt(); });
phoneDialog.addEventListener('click',event=>{ if (event.target === phoneDialog) cancelBorrowerPrompt(); });
phoneInput.addEventListener('input',()=>{
    if (['invalid', 'error'].includes(phoneDialog.dataset.state)) setPhoneState('idle');
});
document.getElementById('phoneForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const request = phoneRequest;
    if (!request || phoneSubmit.disabled) return;
    const number = phoneInput.value.trim();
    if (!/^(?:91|0)?\d{10}$/.test(number.replace(/[\s()+.\-]/g,''))) {
        setPhoneState('invalid', 'Enter a 10-digit mobile number.');
        phoneInput.focus();
        return;
    }
    setPhoneState('checking');
    const controller = new AbortController();
    request.controller = controller;
    const slowNotice = setTimeout(() => {
        if (phoneRequest === request && phoneDialog.dataset.state === 'checking') {
            phoneFeedback.textContent = 'Still waiting for the server…';
        }
    }, 3500);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch('/api/loans?action=unlock',{method:'POST',cache:'no-store',signal:controller.signal,
            headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:request.key,phone:number})});
        const data = await response.json();
        if (phoneRequest !== request) return;
        if (!response.ok) {
            const invalid = response.status === 400 || response.status === 403;
            setPhoneState(invalid ? 'invalid' : 'error', data.error || 'Could not verify this number.');
            if (invalid) phoneInput.focus();
            return;
        }
        phoneInput.value = '';
        setPhoneState('success', 'Number verified.');
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            await new Promise(resolve => setTimeout(resolve, 320));
        }
        if (phoneRequest !== request) return;
        phoneRequest = null;
        accountAccess = { key:request.key,month:request.month,token:data.token,expires:data.expires };
        accessTimer = setTimeout(()=>switchTab('folder'),Math.max(0,data.expires-Date.now()));
        loans = data.loans;
        phoneDialog.close();
        if (request.month) showVerifiedMonth(request.month);
        else openFolder(request.key);
        document.getElementById(request.month ? 'currentMonthName' : 'currentFolderName').focus({preventScroll:true});
    } catch {
        if (phoneRequest === request) {
            setPhoneState('error', controller.signal.aborted
                ? 'The request timed out. Try again.'
                : 'Check your connection and try again.');
        }
    } finally {
        clearTimeout(slowNotice);
        clearTimeout(timeout);
    }
});
window.addEventListener('pagehide',()=>clearBorrowerAccess());
window.addEventListener('pageshow',event=>{if(event.persisted) switchTab('folder');});
