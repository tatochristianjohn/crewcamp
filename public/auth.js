/* Shared by all pages: API helper (cookie session), theme, login/logout. */
const THEMES=['white','dark','midnight','graphite','ocean','forest','lavender','sunset','sand','pink','cepalco'];
function applyTheme(t){
  if(!THEMES.includes(t))t='white';
  [...document.body.classList].filter(c=>c.startsWith('th-')).forEach(c=>document.body.classList.remove(c));
  document.body.classList.add('th-'+t);
  document.querySelectorAll('[data-th]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.th===t)));
  const m=document.querySelector('meta[name=theme-color]');if(m)m.content=getComputedStyle(document.body).getPropertyValue('--bg').trim()||m.content;
}
applyTheme(localStorage.getItem('stb_theme')||'white');
document.addEventListener('DOMContentLoaded',()=>applyTheme(localStorage.getItem('stb_theme')||'white'));

async function api(path,method='GET',body,server){   // server (optional) = act inside that server for this one call
  const h={'Content-Type':'application/json'},sv=server||localStorage.getItem('stb_sv');
  if(sv&&sv!=='cepalco'&&!/^\/api\/(login|logout|servers|google|config)/.test(path))h['X-Server']=sv;   // active server (default CEPALCO sends nothing)
  if(method!=='GET'&&/^\/api\/(admin\/)?servers/.test(path))sessionStorage.removeItem('stb_svl');   // any server change invalidates the cached list
  let r;try{r=await fetch(path,{method,headers:h,body:body?JSON.stringify(body):undefined,credentials:'same-origin'})}
  catch(_){const e=new Error('You seem to be offline. Check your connection and try again.');e.status=0;e.offline=true;throw e}   // network failure, not a bug
  let d={};try{d=await r.json()}catch(e){}
  if(r.status===403&&!server&&/not a member of that server/i.test(d.error||'')){   // kicked / server deleted / never joined: move to a server I am in, else to the hub
    const l=await fetch('/api/servers',{credentials:'same-origin'}).then(x=>x.json()).catch(()=>({})),f=(l.servers||[])[0],cur=localStorage.getItem('stb_sv')||'cepalco';
    if(f&&f.id!==cur){f.id==='cepalco'?localStorage.removeItem('stb_sv'):localStorage.setItem('stb_sv',f.id);location.reload()}
    else if(!/(^|\/)(cross|admin-accounts)?(\.html)?$/.test(location.pathname))location.replace('cross.html');
    throw new Error(d.error)}
  if(!r.ok){const e=new Error(d.error||(r.status>=500?'The server had a problem. Please try again in a moment.':'Something went wrong ('+r.status+').'));e.status=r.status;throw e}
  return d;
}
const login=(u,p)=>{sessionStorage.removeItem('stb_svl');return api('/api/login','POST',{username:u,password:p}).then(d=>d.user)};
async function currentUser(){   // {user,board} or null. The first call on a page reuses the gate's request below.
  if(window.__authP&&Date.now()-window.__authT<5000)return window.__authP;   // the gate's /me answer is shared by every script on the page load (one request, not three)
  try{return await api('/api/me')}catch(e){return null}
}

/* ---- No peek at the app before login ----
   Every page except login.html stays blank (theme colour only) until the server confirms the session;
   if there is no session we go straight to the login page, so signed-out visitors never see app content. */
if(!/(^|\/)(login|register)(\.html)?$/.test(location.pathname)){
  const g=document.createElement('style');g.id='authGate';g.textContent='body>*{visibility:hidden!important}';document.head.append(g);
  window.__authT=Date.now();window.__authP=api('/api/me').catch(()=>null);
  window.__authP.then(me=>{
    if(!me)return location.replace('login.html');
    if(me.user&&me.user.noServer&&!/(^|\/)(cross|admin-accounts)?(\.html)?$/.test(location.pathname))return location.replace('cross.html');   // not in any server yet
    g.remove();
  });
}
async function logout(){
  // Only leave the page once the server confirms the session is gone; otherwise the login page would see the
  // still-valid cookie and sign you straight back in.
  sessionStorage.removeItem('stb_svl');
  try{await api('/api/logout','POST',{})}
  catch(e){alert('Could not log out ('+(e.message||'network error')+'). Please check your connection and try again.');return}
  location.replace('login.html');
}
// Back/forward cache: never show a signed-in page from memory after logging out.
addEventListener('pageshow',async e=>{
  if(!e.persisted||/(login|register)\.html$/.test(location.pathname))return;
  if(!(await api('/api/me').catch(()=>null)))location.replace('login.html');
});

/* Show/hide toggle (👁) on every password field: works on login, change-password and the admin Users page. */
(function(){
  const css=document.createElement('style');
  css.textContent='.pwx{position:relative;display:block;width:100%}.pwx>input{width:100%;padding-right:44px!important;box-sizing:border-box}.pwx>button{z-index:3;touch-action:manipulation;position:absolute;right:4px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;border-radius:10px;background:transparent;color:inherit;font-size:1.05rem;cursor:pointer;opacity:.65;padding:0;line-height:1}.pwx>button:hover,.pwx>button:focus-visible{opacity:1;background:rgba(127,127,127,.18)}';
  document.head.append(css);
  const wrap=i=>{
    if(i.dataset.pwx||i.type!=='password')return;i.dataset.pwx=1;
    const w=document.createElement('span');w.className='pwx';i.replaceWith(w);w.append(i);
    const b=document.createElement('button');b.type='button';b.textContent='👁';b.title='Show password';b.setAttribute('aria-label','Show password');b.setAttribute('aria-pressed','false');
    b.addEventListener('mousedown',e=>e.preventDefault());b.onclick=e=>{e.preventDefault();e.stopPropagation();const on=i.type==='password';i.type=on?'text':'password';b.textContent=on?'🙈':'👁';b.title=on?'Hide password':'Show password';b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(on))};
    w.append(b);
  };
  const run=()=>document.querySelectorAll('input[type=password]').forEach(wrap);
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',run):run();
})();

/* 📹 free video call: asks the server for the private room of a channel (?ch=) or of a friend (?dm=) and opens it in a new tab.
   While that tab stays open, the chat poll tells the server "I am in this call" (callParams below), which is what feeds the small
   "Call in progress · since 3:42 PM · 2 in call" notice in the chat boxes. */
window.__cwCall=null;let callT=0;   // the call this tab opened: {q:'ch=general'|'dm=<id>', sv, since, w}
function callLive(){const c=window.__cwCall;if(!c)return null;if(c.w&&c.w.closed){setCall(null);return null}return c}
function setCall(c){window.__cwCall=c;clearInterval(callT);if(c)callT=setInterval(callLive,2000);   // notice quickly when the call tab is closed
  window.dispatchEvent(new Event('cw:call'))}   // chat.js polls right away, so everybody sees the change in seconds
function callParams(sv){   // extra query for /api/chat while I am in a call
  const c=callLive();if(!c)return null;
  const i=c.q.indexOf('='),k=c.q.slice(0,i),v=decodeURIComponent(c.q.slice(i+1));
  if(k==='ch'&&c.sv!==sv)return null;   // a channel call belongs to one server
  return{call:k+':'+v,cs:c.since}}
async function startCall(q,server,since){   // since = when the call started, if it is already running (so joining keeps the first person's time)
  const w=window.open('','_blank');   // open synchronously so popup blockers allow it
  try{const d=await api('/api/call?'+q,'GET',undefined,server);
    if(w){w.location.href=d.url;setCall({q,sv:server||localStorage.getItem('stb_sv')||'cepalco',since:since||Date.now(),w})}else location.href=d.url}
  catch(e){if(w)w.close();alert(e.message||'Could not start the call.')}
}

/* ---- Friendly errors: never show raw JavaScript messages ("Cannot read properties of undefined") to people ---- */
function friendly(e){
  const m=String((e&&e.message)||e||'');
  if(e&&e.offline)return m;
  if(/^(TypeError|ReferenceError|SyntaxError|RangeError)\b|cannot read propert|is not a function|is not defined|is not iterable|undefined|null|JSON|Unexpected token|Failed to fetch|NetworkError|Load failed/i.test(m))
    return navigator.onLine===false?'You seem to be offline. Check your connection and try again.':'Something went wrong on our side. Please refresh the page and try again.';
  return m||'Something went wrong. Please try again.';
}
(function(){   // offline banner + last-resort handler so one failed request never leaves a silent broken page
  function bar(t,bad){let b=document.getElementById('ccNet');if(!t){if(b)b.remove();return}
    if(!b){b=document.createElement('div');b.id='ccNet';b.setAttribute('role','status');b.style.cssText='position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;padding:8px 14px;border-radius:10px;font:600 .85rem system-ui,sans-serif;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:92vw;text-align:center';document.body.append(b)}
    b.style.background=bad?'#b91c1c':'#15803d';b.textContent=t}
  addEventListener('offline',()=>bar('You are offline. Changes will not save until you reconnect.',true));
  addEventListener('online',()=>{bar('Back online.',false);setTimeout(()=>bar(''),2500)});
  addEventListener('DOMContentLoaded',()=>{if(navigator.onLine===false)bar('You are offline. Changes will not save until you reconnect.',true)});
  let last=0;addEventListener('unhandledrejection',e=>{const x=e.reason;if(x&&x.status===401)return;console.error(x);
    if(Date.now()-last<5000)return;last=Date.now();if(document.body)bar(friendly(x),true),setTimeout(()=>bar(''),4000)});
})();

/* ---- PWA: installable app + offline fallback ---- */
if('serviceWorker' in navigator&&location.protocol==='https:'||location.hostname==='localhost')
  addEventListener('load',()=>{navigator.serviceWorker&&navigator.serviceWorker.register('sw.js').catch(()=>{})});
