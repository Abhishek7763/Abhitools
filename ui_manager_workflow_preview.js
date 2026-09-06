// Preview-only borrower summary enhancements. Extra action tabs removed for a simpler UI.
(() => {
'use strict';
if (window.__ABHI_MANAGER_PREVIEW__) return; window.__ABHI_MANAGER_PREVIEW__=true;
const M=v=>`₹${Math.max(0,Number(v)||0).toLocaleString('en-IN')}`;
const rem=e=>typeof publicEmiRemaining==='function'?publicEmiRemaining(e):Math.max((+e.amount||0)-(+e.paid_amount||0),0);
const iso=e=>String(e?.due_date||'').slice(0,10);
const today=()=>String(publicDueData?.businessDate||new Date().toISOString()).slice(0,10);
const days=e=>/^\d{4}-\d{2}-\d{2}$/.test(iso(e))?Math.round((Date.parse(iso(e)+'T00:00:00Z')-Date.parse(today()+'T00:00:00Z'))/86400000):99999;
const active=()=>Array.isArray(loans)?loans.filter(l=>l.status==='active'):[];
function borrowerLoans(){return active().filter(l=>String(l.borrowers?.name||'').toUpperCase()===String(currentOpenFolder||'').toUpperCase())}
function enhanceBorrower(){
 if(!currentOpenFolder)return;
 const h=document.getElementById('currentFolderName'); if(!h)return;
 const ls=borrowerLoans();
 const r=ls.reduce((s,l)=>s+(l.emis||[]).reduce((a,e)=>a+rem(e),0),0);
 const p=ls.flatMap(l=>(l.emis||[]).map(e=>({l,e,d:days(e)}))).filter(x=>rem(x.e)>0).sort((a,b)=>a.d-b.d)[0];
 let b=document.getElementById('mgrBorrower');
 if(!b){b=document.createElement('div');b.id='mgrBorrower';b.className='mgr-borrower';h.insertAdjacentElement('afterend',b)}
 b.innerHTML=`<div><small>EMI Remaining</small><b>${M(r)}</b></div><div><small>Next Due</small><b>${p?M(rem(p.e)):'₹0'}</b><span>${p?(p.d===0?'Today':p.d===1?'Tomorrow':p.d>1?p.d+' days left':Math.abs(p.d)+' days overdue'):'All paid'}</span></div><div><small>Active Loans</small><b>${ls.length}</b></div>`;
}
function css(){
 if(document.getElementById('mgrCss'))return;
 const s=document.createElement('style');s.id='mgrCss';
 s.textContent=`.mgr-borrower{max-width:660px;margin:-8px auto 12px;display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.mgr-borrower>div{padding:8px;border-radius:12px;background:#f8fbff;border:1px solid #dbeafe;display:grid;min-width:0}.mgr-borrower small{font-size:9px;color:#64748b}.mgr-borrower b{color:#1d4ed8;font-size:14px}.mgr-borrower span{font-size:9px;color:#64748b}.dark-mode .mgr-borrower>div{background:#1f2937;color:#f8fafc;border-color:#334155}.dark-mode .mgr-borrower small,.dark-mode .mgr-borrower span{color:#94a3b8}@media(max-width:520px){.mgr-borrower{padding:0 12px;gap:6px}.mgr-borrower>div{padding:7px}.mgr-borrower b{font-size:13px}}`;
 document.head.appendChild(s);
}
function install(){css();document.getElementById('mgrSmartDue')?.remove();document.getElementById('mgrModal')?.remove();const o=window.openFolder;if(typeof o==='function'&&!o.__mgr){const w=function(...a){const r=o.apply(this,a);setTimeout(enhanceBorrower,60);return r};w.__mgr=1;window.openFolder=w}if(currentOpenFolder)enhanceBorrower()}
let n=0,t=setInterval(()=>{install();if(++n>100)clearInterval(t)},100);install();
})();