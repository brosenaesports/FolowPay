/* Premium Booster shared helpers. The only thing shared with the rest of the site is the sign-in token (your account). */
const $=(q,r=document)=>r.querySelector(q),$$=(q,r=document)=>[...r.querySelectorAll(q)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tok=localStorage.getItem('fp_t');
if(!tok||tok==='undefined')location.href='index.html';
const INR=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const dt=n=>n?new Date(n).toLocaleString():'';

const IC={
back:'<path d="M15 18l-6-6 6-6"/>',
bolt:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
list:'<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
wallet:'<path d="M3 7a2 2 0 0 1 2-2h13v3"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1z"/><circle cx="16" cy="14" r="1.2"/>',
yt:'<rect x="2.5" y="6" width="19" height="12" rx="3.5"/><path d="M10 9.5l5 2.5-5 2.5z"/>',
ig:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".8"/>',
telegram:'<path d="M21 4L3 11.2l5.5 2L10 19l3-3.5 4.5 3.3z"/><path d="M8.5 13.2L21 4"/>',
whatsapp:'<path d="M3.5 20.5l1.3-4.3A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 8.5c-.3 3 2.5 6.5 6.5 6.5l1-1.6-2.2-1-1 .9c-1-.5-1.9-1.4-2.4-2.4l.9-1-1-2.2z"/>',
x:'<path d="M4 4l16 16M20 4L4 20"/>',
facebook:'<path d="M14.5 8H17V4.5h-2.5a4 4 0 0 0-4 4V11H8v3.5h2.5V21h3.5v-6.5h2.5L17 11h-3V8.8c0-.5.3-.8.5-.8z"/>',
tiktok:'<path d="M14 3v11a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.4 2.6 2 4.2 5 4.4"/>',
spotify:'<circle cx="12" cy="12" r="9"/><path d="M7 9.5c3.5-1 7-.8 10 1M7.5 12.8c3-.8 6-.5 8.5 1M8 16c2.5-.6 4.7-.3 6.8.8"/>',
linkedin:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 11v6M8 7.5v.01M12 17v-6M12 13c0-2 4-2.5 4 0v4"/>',
snapchat:'<path d="M12 3c3 0 5 2 5 5v2l2 1-2 1c.5 2 2 3 3 3.5-1 1-3 1-4 1-.5 1-1.5 2-4 2s-3.5-1-4-2c-1 0-3 0-4-1 1-.5 2.5-1.5 3-3.5L5 11l2-1V8c0-3 2-5 5-5z"/>',
threads:'<path d="M16.5 8.5c-.7-2-2.3-3-4.5-3-3 0-5 2.2-5 6.5s2 6.5 5 6.5c2.8 0 4.5-1.6 4.5-3.5 0-2.2-2-3.2-4.5-3.2-1.700 0-2.700.8-2.700 1.900 0 1 .9 1.700 2.200 1.700 1.800 0 3-1.200 3-4.200"/>',
other:'<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
refresh:'<path d="M20 11a8 8 0 0 0-14.5-4M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4M20 19v-4h-4"/>',
ticket:'<path d="M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a3 3 0 0 0 0 6v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a3 3 0 0 0 0-6z"/><path d="M14 5v14" stroke-dasharray="2 2"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
info:'<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v5h1"/>',
shield:'<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
};
const I=n=>`<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]||IC.other}</svg>`;
const PICON={youtube:'yt',instagram:'ig'};
const pIcon=k=>I(PICON[k]||k);

function shell(active){
  const b=localStorage.getItem('pm_bal');
  $('#shell').innerHTML=`<header class="pmh"><a class="pmback" href="home.html" aria-label="Back to FollowPay">${I('back')}<span>FollowPay</span></a><div class="pmbrand">${I('bolt')}<b>Premium Booster</b></div><a class="pmw" href="premium-wallet.html" aria-label="Open wallet">${I('wallet')}<span id="pmbal">${b!=null?INR(b):'₹0.00'}</span></a></header>
<nav class="pmt" aria-label="Premium sections">${[['booster','premium.html','bolt','Booster'],['orders','premium-orders.html','list','Orders'],['wallet','premium-wallet.html','wallet','Wallet']].map(([k,h,i,n])=>`<a href="${h}"${k===active?' class="on" aria-current="page"':''}>${I(i)}<span>${n}</span></a>`).join('')}</nav>
<main class="pmm" id="app"></main>`;
}
const setBal=n=>{localStorage.setItem('pm_bal',n);const e=$('#pmbal');if(e)e.textContent=INR(n)};

async function api(action,x={}){
  let r,j;
  try{r=await fetch('/api',{method:'POST',body:JSON.stringify({action,token:tok,...x})});j=await r.json()}
  catch(e){throw new Error('Cannot reach the server. Check your internet.')}
  if(r.status===401){localStorage.removeItem('fp_t');location.href='index.html';throw new Error('Please sign in again')}
  if(!r.ok){const e=new Error(j.error||'Server error');e.short=!!j.short;throw e}
  return j;
}
const dlg=(t,h,btns=[['OK',1]])=>new Promise(res=>{
  const d=document.createElement('div');d.className='pmov';
  d.innerHTML=`<div class="pmpop" role="dialog" aria-modal="true"><b>${esc(t)}</b><div>${h}</div><div class="pmbtns">${btns.map(([n,v,c])=>`<button type="button" class="${c||''}" data-v="${v}">${n}</button>`).join('')}</div></div>`;
  d.onclick=e=>{const b=e.target.closest('[data-v]');if(b){d.remove();res(b.dataset.v==='1')}else if(e.target===d){d.remove();res(false)}};
  document.body.append(d);const f=d.querySelector('button:last-child');f&&f.focus();
});
const say=(m,t='Notice')=>dlg(t,`<p>${esc(m)}</p>`);
const yes=(t,m,ok='Confirm')=>dlg(t,`<p>${m}</p>`,[['Cancel',0,'ghost'],[ok,1]]);
const spin=(b,t)=>{b.disabled=true;b.dataset.h=b.innerHTML;b.innerHTML=`<span class="sp"></span> ${t}`};
const unspin=b=>{b.disabled=false;if(b.dataset.h)b.innerHTML=b.dataset.h};
const PN={youtube:'YouTube',instagram:'Instagram',telegram:'Telegram',whatsapp:'WhatsApp Channel',x:'X (Twitter)',facebook:'Facebook',tiktok:'TikTok',spotify:'Spotify',linkedin:'LinkedIn',snapchat:'Snapchat',threads:'Threads',other:'More'};
const guestNote=()=>`<div class="gw" role="note">${I('info')}<div><b>You are using a guest account.</b> If you clear your browser data, your account and wallet money will be lost. <a href="refer.html">Save your account</a></div></div>`;
