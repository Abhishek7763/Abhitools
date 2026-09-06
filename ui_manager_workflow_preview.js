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
function monthCardAmount(card){
 const match=String(card?.textContent||'').match(/Total\s*:\s*₹\s*([\d,]+(?:\.\d+)?)/i);
 return match?Number(match[1].replace(/,/g,''))||0:0;
}
function sortMonthCards(){
 const view=document.getElementById('monthView'); if(!view)return;
 const cards=[...view.querySelectorAll('.month-folder')]; if(!cards.length)return;
 cards.forEach((card,index)=>{if(card.dataset.monthOriginalIndex==null)card.dataset.monthOriginalIndex=String(index)});
 const mode=document.getElementById('sortSelect')?.value||'name';
 if(mode==='highest')cards.sort((a,b)=>monthCardAmount(b)-monthCardAmount(a));
 else if(mode==='lowest')cards.sort((a,b)=>monthCardAmount(a)-monthCardAmount(b));
 else cards.sort((a,b)=>(+a.dataset.monthOriginalIndex||0)-(+b.dataset.monthOriginalIndex||0));
 const frag=document.createDocumentFragment();
 cards.forEach(card=>frag.appendChild(card));
 view.appendChild(frag);
}
function applyMonthLayout(){
 const view=document.getElementById('monthView');
 if(view)view.classList.toggle('grid-view',!!isGridView);
 const btn=document.getElementById('layoutToggleBtn');
 if(btn)btn.innerText=isGridView?'📜 List View':'🔲 Grid View';
}
function syncBrowseControls({sortMonth=false}={}){
 const search=document.querySelector('.search-container');
 const viewControls=document.getElementById('viewControlsContainer');
 const sort=document.getElementById('sortSelect');
 const first=sort?.querySelector('option[value="name"]');
 const monthMode=typeof currentTab!=='undefined'&&currentTab==='month';
 if(search)search.style.display='flex';
 if(viewControls)viewControls.style.display='flex';
 if(first)first.textContent=monthMode?'📅 Sort by Month':'🔤 Sort by Name';
 if(monthMode){
   applyMonthLayout();
   if(sortMonth)sortMonthCards();
 }else{
   const btn=document.getElementById('layoutToggleBtn');
   if(btn)btn.innerText=isGridView?'📜 List View':'🔲 Grid View';
 }
}
function css(){
 if(document.getElementById('mgrCss'))return;
 const s=document.createElement('style');s.id='mgrCss';
 s.textContent=`
.mgr-borrower{max-width:660px;margin:-8px auto 12px;display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.mgr-borrower>div{padding:8px;border-radius:12px;background:#f8fbff;border:1px solid #dbeafe;display:grid;min-width:0}
.mgr-borrower small{font-size:9px;color:#64748b}.mgr-borrower b{color:#1d4ed8;font-size:14px}.mgr-borrower span{font-size:9px;color:#64748b}
.dark-mode .mgr-borrower>div{background:#1f2937;color:#f8fafc;border-color:#334155}.dark-mode .mgr-borrower small,.dark-mode .mgr-borrower span{color:#94a3b8}
.search-container{align-items:stretch!important;gap:7px!important}
#sortSelect{flex:0 1 34%!important;min-width:0!important}
#viewControlsContainer{flex:0 0 auto!important;margin:0!important}
#layoutToggleBtn{min-width:118px!important;white-space:nowrap!important;padding-left:12px!important;padding-right:12px!important}
#monthView.grid-view{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
#monthView.grid-view .month-folder{margin:0!important;min-width:0;min-height:118px;padding:14px 10px!important;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:8px}
#monthView.grid-view .month-folder>div{text-align:center!important;min-width:0}
body.dark-mode{color-scheme:dark}
body.dark-mode .monthly-item{background:#2b2b2b!important;color:#e5e7eb!important;border-color:#444!important}
body.dark-mode .monthly-item>div:last-child{color:#f3f4f6!important}body.dark-mode .monthly-item>div:last-child small{color:#cbd5e1!important}
body.dark-mode .monthly-item>div:first-child small{color:#b8c0cc!important}body.dark-mode .monthly-item strong{color:#79b8ff!important}
body.dark-mode .month-header{background:#2b2b2b!important;color:#7db7ff!important;border-color:#4b5563!important}
body.dark-mode #monthDateList .monthly-item{box-shadow:0 1px 0 rgba(255,255,255,.03)}
#currentMonthName{overflow-wrap:anywhere;line-height:1.4}.monthly-item{gap:10px;min-width:0}.monthly-item>div:first-child{min-width:0;overflow-wrap:anywhere}.monthly-item>div:last-child{flex:0 0 auto;min-width:max-content}
@media(max-width:520px){.mgr-borrower{padding:0 12px;gap:6px}.mgr-borrower>div{padding:7px}.mgr-borrower b{font-size:13px}}
@media(max-width:430px){.search-container{gap:5px!important}.search-container #searchInput{min-width:0!important}#sortSelect{flex-basis:35%!important;padding-left:8px!important;padding-right:22px!important;font-size:11px!important}#layoutToggleBtn{min-width:108px!important;padding:8px 9px!important;font-size:11px!important}#monthView.grid-view{gap:9px}#monthView.grid-view .month-folder{min-height:108px;padding:11px 8px!important}.monthly-item{padding:11px 10px;align-items:flex-start}.monthly-item>div:last-child{font-size:13px!important;line-height:1.35}.monthly-item>div:last-child small{font-size:11px;white-space:nowrap}}
@media(max-width:340px){.monthly-item{flex-direction:column}.monthly-item>div:last-child{min-width:0;width:100%;text-align:left!important}}
`;
 document.head.appendChild(s);
}
function install(){
 css();
 document.getElementById('mgrSmartDue')?.remove();
 document.getElementById('mgrModal')?.remove();
 const o=window.openFolder;
 if(typeof o==='function'&&!o.__mgr){const w=function(...a){const r=o.apply(this,a);requestAnimationFrame(enhanceBorrower);return r};w.__mgr=1;window.openFolder=w}
 const sw=window.switchTab;
 if(typeof sw==='function'&&!sw.__mgrBrowse){const w=function(...a){const r=sw.apply(this,a);requestAnimationFrame(()=>syncBrowseControls({sortMonth:currentTab==='month'}));return r};w.__mgrBrowse=1;window.switchTab=w}
 const hs=window.handleSearch;
 if(typeof hs==='function'&&!hs.__mgrBrowse){const w=function(...a){if(typeof currentTab!=='undefined'&&currentTab==='month'){sortMonthCards();return}return hs.apply(this,a)};w.__mgrBrowse=1;window.handleSearch=w}
 const tl=window.toggleLayout;
 if(typeof tl==='function'&&!tl.__mgrBrowse){const w=function(...a){
   if(typeof currentTab!=='undefined'&&currentTab==='month'){
     isGridView=!isGridView;
     localStorage.setItem('abhishek_layout_pref',isGridView?'grid':'list');
     applyMonthLayout();
     return;
   }
   const r=tl.apply(this,a);
   requestAnimationFrame(()=>syncBrowseControls());
   return r;
 };w.__mgrBrowse=1;window.toggleLayout=w}
 const rm=window.renderMonthFolders;
 if(typeof rm==='function'&&!rm.__mgrBrowse){const w=function(...a){const r=rm.apply(this,a);requestAnimationFrame(()=>syncBrowseControls({sortMonth:true}));return r};w.__mgrBrowse=1;window.renderMonthFolders=w}
 if(currentOpenFolder)requestAnimationFrame(enhanceBorrower);
 syncBrowseControls({sortMonth:typeof currentTab!=='undefined'&&currentTab==='month'});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();