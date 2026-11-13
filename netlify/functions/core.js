const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const say=(m,t,cb)=>{if(!m)return;const d=document.createElement('div');d.className='ov';d.innerHTML=`<div class="pop" role="alertdialog"><b>${esc(t||'Notice')}</b><p>${esc(m)}</p><button>OK</button></div>`;d.onclick=e=>{if(e.target===d||e.target.tagName==='BUTTON'){d.remove();cb&&cb()}};document.body.append(d)};
const ok=(m,t,cb)=>say(m,t||'Done',cb);
const ask=(t,m,ph)=>new Promise(res=>{const d=document.createElement('div');d.className='ov';d.innerHTML=`<div class="pop" role="dialog"><b>${esc(t)}</b><p>${esc(m)}</p>${ph?`<input placeholder="${esc(ph)}" autocapitalize="off" autocomplete="off">`:''}<button>Confirm</button><button class="o" style="margin-top:8px">Cancel</button></div>`;document.body.append(d);const i=d.querySelector('input'),[c,x]=d.querySelectorAll('button');c.onclick=()=>{d.remove();res(i?i.value:'')};x.onclick=()=>{d.remove();res(null)}});
const PL={youtube:'YouTube',instagram:'Instagram'};
const tok=localStorage.getItem('fp_t'),page=document.body.dataset.page,plat=localStorage.getItem('plat')||'youtube';
if((!tok||tok==='undefined')&&!['admin','setup-admin'].includes(page)){location.href='index.html'}
if(!plat&&!['home','buy','refer','store','admin','setup-admin'].includes(page)){location.href='home.html'}
const setPts=n=>{localStorage.setItem('fp_p',n);$('#pts').textContent=n;$('#pw').hidden=false};
if(localStorage.getItem('fp_p')){$('#pts').textContent=localStorage.getItem('fp_p');$('#pw').hidden=false}
async function api0(action,x={}){
  let r,j;
  try{r=await fetch('/api',{method:'POST',body:JSON.stringify({action,token:tok,...x})});j=await r.json()}catch(e){throw new Error('Cannot reach the server. Check your internet.')}
  if(r.status===401){localStorage.removeItem('fp_t');location.href='index.html';throw new Error('Please sign in again')}
  if(!r.ok)throw new Error(j.error||'Server error');
  return j;
}
let fly=0;
const hideLd=()=>{const l=$('#ld');if(l)l.remove()};
async function api(a,x){fly++;try{return await api0(a,x)}finally{if(--fly===0)setTimeout(hideLd,60)}}
setTimeout(hideLd,10000);
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[href]');if(a&&/\.html/.test(a.getAttribute('href')))document.body.classList.add('go')});
addEventListener('pageshow',()=>document.body.classList.remove('go'));
const start=async()=>{try{const r=await api('me');setPts(r.user.points);
  const c=localStorage.getItem('fp_ref');if(c&&!r.user.refBy&&!(r.user.spent>0))api('useRef',{code:c}).catch(()=>{}).finally(()=>localStorage.removeItem('fp_ref'));
  return r}catch(e){say(e.message);throw e}};
const box=(t,h)=>{const d=document.createElement('div');d.className='ov';d.innerHTML=`<div class="pop" role="dialog"><b>${esc(t)}</b><div style="margin:.6em 0 1em">${h}</div><button>Close</button></div>`;d.onclick=e=>{if(e.target===d||e.target.tagName==='BUTTON')d.remove()};document.body.append(d)};
const platBar=()=>`<div class="tabs">${['youtube','instagram'].map(p=>`<button class="${p===plat?'':'o'}" data-sp="${p}">${I(p==='youtube'?'yt':'ig')} ${PL[p]}</button>`).join('')}</div>`;
const platBind=()=>document.querySelectorAll('[data-sp]').forEach(b=>b.onclick=()=>{localStorage.setItem('plat',b.dataset.sp);location.reload()});
const logout=()=>{localStorage.removeItem('fp_t');localStorage.removeItem('fp_p');sessionStorage.clear();location.href='index.html'};
const I=n=>`<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const CFG={apiKey:"AIzaSyBxl8tOaw6eJpRbl4Elx5YGvfaWGbry-_g",authDomain:"followpay-a7dfe.firebaseapp.com",projectId:"followpay-a7dfe",appId:"1:361285479601:web:3725e5d93893022b8dc690"};
async function upgrade(){
  try{const V='https://www.gstatic.com/firebasejs/10.12.2/',[A,B]=await Promise.all([import(V+'firebase-app.js'),import(V+'firebase-auth.js')]);
    const c=await B.signInWithPopup(B.getAuth(A.initializeApp(CFG)),new B.GoogleAuthProvider());
    await api('linkGoogle',{idToken:await c.user.getIdToken()});
    ok('Your account is now linked to Google. You can sign in with Google any time.','Account upgraded',()=>location.reload());
  }catch(e){say(e.code==='auth/popup-closed-by-user'?'Sign-in window was closed.':e.code==='auth/unauthorized-domain'?'Add follow-pay.netlify.app in Firebase authorized domains.':e.message,'Could not upgrade')}
                   }
