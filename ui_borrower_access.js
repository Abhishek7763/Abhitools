// Keep the account credential only for this open view.
let accountAccess = null;
let phoneRequest = null;
let accessTimer;
const phoneDialog = document.getElementById('phoneDialog');
const phoneInput = document.getElementById('accountPhone');
const phoneFeedback = document.getElementById('phoneFeedback');
const phoneSubmit = document.getElementById('phoneSubmit');

function clearBorrowerAccess() {
    accountAccess = null;
    phoneRequest = null;
    clearTimeout(accessTimer);
    loans = [];
    currentOpenFolder = null;
    if (phoneDialog.open) phoneDialog.close();
    phoneInput.value = '';
    for (const id of ['loanList','currentFolderName','monthDateList','currentMonthName']) document.getElementById(id)?.replaceChildren();
    document.querySelectorAll('#mgrBorrower,.abhi-print-sheet,#publicLoanDetailOverlay,#abhiBorrowerDuesOverlay,#upiReferenceOverlay,#upiPublicNotice').forEach(el=>el.remove());
    document.body.classList.remove('public-detail-active','public-dues-open','public-loan-detail-open');
}

async function fetchVerifiedLoans() {
    const access = accountAccess;
    if (!access) throw new Error('Account band hai.');
    const response = await fetch('/api/loans?action=account',{cache:'no-store',headers:{Authorization:'Bearer '+access.token}});
    if (response.status === 401 && accountAccess === access) switchTab('folder');
    if (!response.ok) throw new Error('Account refresh nahi hua.');
    return response.json();
}

function requestBorrowerAccess(member,month = '') {
    clearTimeout(accessTimer);
    accountAccess = null;
    loans = [];
    phoneRequest = { key:member.key, month };
    document.getElementById('phoneTitle').textContent = member.name;
    phoneInput.value = '';
    phoneInput.removeAttribute('aria-invalid');
    phoneFeedback.textContent = '';
    phoneDialog.dataset.state = '';
    phoneSubmit.disabled = false;
    phoneSubmit.textContent = 'Account kholein →';
    if (!phoneDialog.open) phoneDialog.showModal();
    phoneInput.focus();
}

function cancelBorrowerPrompt() {
    phoneRequest = null;
    phoneInput.value = '';
    phoneDialog.close();
}
document.getElementById('phoneClose').onclick = cancelBorrowerPrompt;
phoneDialog.addEventListener('cancel',event=>{ event.preventDefault(); cancelBorrowerPrompt(); });
phoneDialog.addEventListener('click',event=>{ if (event.target === phoneDialog) cancelBorrowerPrompt(); });
phoneInput.addEventListener('input',()=>{
    if (phoneDialog.dataset.state !== 'error') return;
    phoneDialog.dataset.state = '';
    phoneFeedback.textContent = '';
    phoneInput.removeAttribute('aria-invalid');
});
document.getElementById('phoneForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const request = phoneRequest;
    if (!request || phoneSubmit.disabled) return;
    const errorState = message => {
        phoneDialog.dataset.state = 'error';
        phoneInput.setAttribute('aria-invalid','true');
        phoneFeedback.textContent = message;
        phoneSubmit.disabled = false;
        phoneSubmit.textContent = 'Account kholein →';
        phoneInput.focus();
    };
    const number = phoneInput.value.trim();
    if (!/^(?:91|0)?\d{10}$/.test(number.replace(/[\s()+.\-]/g,''))) {
        errorState('10 digit ka mobile number daalein.');
        return;
    }
    phoneSubmit.disabled = true;
    phoneSubmit.textContent = 'Check ho raha hai…';
    phoneFeedback.textContent = '';
    try {
        const response = await fetch('/api/loans?action=unlock',{method:'POST',cache:'no-store',
            headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:request.key,phone:number})});
        const data = await response.json();
        if (phoneRequest !== request) return;
        if (!response.ok) { errorState(data.error || 'Number check nahi hua.'); return; }
        phoneInput.value = '';
        phoneDialog.dataset.state = 'success';
        phoneFeedback.textContent = '✓ Number match ho gaya';
        phoneSubmit.textContent = 'Account khul raha hai…';
        await new Promise(resolve=>setTimeout(resolve,320));
        if (phoneRequest !== request) return;
        phoneRequest = null;
        accountAccess = { ...request,token:data.token,expires:data.expires };
        accessTimer = setTimeout(()=>switchTab('folder'),Math.max(0,data.expires-Date.now()));
        loans = data.loans;
        phoneDialog.close();
        if (request.month) showVerifiedMonth(request.month);
        else openFolder(request.key);
    } catch {
        if (phoneRequest === request) errorState('Connection check karke dobara koshish karein.');
    }
});
window.addEventListener('pagehide',()=>clearBorrowerAccess());
window.addEventListener('pageshow',event=>{if(event.persisted) switchTab('folder');});
