/* Discord-style server rail (left, hover to expand) + create/join/settings dialogs. Needs auth.js (api()). */
(function(){
const DEF='cepalco',KEY='stb_sv',cur=()=>localStorage.getItem(KEY)||DEF,ONX=/cross\.html$/.test(location.pathname);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ROLE={admin:'Head',host:'Supervisor',staff:'Staff'};
const css=`
#svDlg .kb{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--bd,#ddd);border-radius:12px}#svDlg .kb small{opacity:.7;font-size:.72rem}#svDlg .kb .code{font-size:1.05rem;padding:6px}
#svRail{position:fixed;left:0;top:0;bottom:0;width:72px;z-index:60;display:flex;flex-direction:column;gap:4px;padding:12px 12px;background:var(--panel,#fff);color:var(--ink,#111);border-right:1px solid var(--bd,#ddd);box-shadow:var(--sh,none);overflow:hidden;transition:width .18s ease,box-shadow .18s}
#svRail:hover,#svRail:focus-within,#svRail.open{width:248px;box-shadow:6px 0 24px rgba(0,0,0,.14)}
#svRail .svl{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:4px;overflow:hidden auto;scrollbar-width:none;margin:0 -12px;padding:0 12px}
#svRail .svl::-webkit-scrollbar{display:none}
#svRail{font-family:Quicksand,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
.th-cepalco #svRail{border-right-width:3px}
#svRail .svh{font:800 .55rem/1 Quicksand,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;opacity:.55;height:14px;line-height:14px;white-space:nowrap;padding-left:0;text-align:center;overflow:hidden}
#svRail:hover .svh,#svRail:focus-within .svh,#svRail.open .svh{font-size:.65rem;letter-spacing:.08em;padding-left:4px;text-align:left}
#svRail hr{border:0;border-top:1px solid var(--bd,#ddd);margin:6px 4px;flex:0 0 auto;width:calc(100% - 8px)}
.svi{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:48px;padding:2px;border:0;background:none;color:inherit;font:700 .9rem Quicksand,system-ui,sans-serif;text-align:left;cursor:pointer;border-radius:16px;border:1px solid transparent;transition:background-color .15s,border-color .15s,transform .12s;white-space:nowrap;flex:0 0 auto;text-decoration:none}
.svi:hover{background:var(--soft,rgba(127,127,127,.14));border-color:var(--bd,#ddd)}
.svi:active{transform:scale(.98)}
.svi:focus-visible{outline:2px solid var(--acc,#2f66b8);outline-offset:1px}
.svi i,.svi .av{flex:0 0 42px;width:42px;height:42px;border-radius:14px;display:grid;place-items:center;font:800 .95rem Fredoka,Quicksand,system-ui,sans-serif;font-style:normal;color:#fff;transition:border-radius .15s,transform .15s;overflow:hidden}
.svi i{position:relative}
.svi i img,#svDlg .lgp img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
#svDlg .lgp{position:relative;width:56px;height:56px;flex:0 0 56px!important;border-radius:14px;overflow:hidden;display:grid;place-items:center;color:#fff;font:800 1.05rem Fredoka,sans-serif}
.svi .av img{width:100%;height:100%;object-fit:cover;display:block}
.svi:hover i,.svi.on i,.svi:hover .av{border-radius:11px}
.svi:active i{transform:scale(.94)}
.svi.on{background:var(--pri,#2f66b8);color:var(--pi,#fff);border-color:var(--pri,#2f66b8);box-shadow:var(--sh,none)}
.svi.on small{opacity:.85}
.svi.on i{box-shadow:0 0 0 2px rgba(255,255,255,.55)}
.svi>span:not(.av){overflow:hidden;text-overflow:ellipsis;display:flex;flex-direction:column;min-width:0;line-height:1.2;font-family:Fredoka,Quicksand,system-ui,sans-serif;font-weight:500;font-size:.95rem}
.svi small{font:600 .7rem Quicksand,system-ui,sans-serif;opacity:.65;overflow:hidden;text-overflow:ellipsis}
.svi.add i,.svi.cfg i{background:var(--soft,rgba(127,127,127,.2));border:1px solid var(--bd,#ddd);color:inherit;font-size:1.2rem}
.svi.add:hover i{background:#16a34a;color:#fff}
.svi.out i{background:rgba(220,38,38,.12);color:#dc2626;font-size:1.05rem}
.svi.out:hover{background:rgba(220,38,38,.12)}
.svi.out:hover i{background:#dc2626;color:#fff}
.svi.me .av{background:var(--pri,#2f66b8);color:var(--pi,#fff);font-family:Fredoka,sans-serif}
body.hasrail{padding-left:72px}
.svb{position:absolute;left:30px;top:0;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#dc2626;color:#fff;font:800 .65rem/18px system-ui,sans-serif;text-align:center;border:2px solid var(--panel,#fff);box-sizing:content-box}
.svb[hidden]{display:none}
.svi.fr i,#svTm i{background:var(--soft,rgba(127,127,127,.2));border:1px solid var(--bd,#ddd);color:inherit;font-size:1.2rem}
.svi.fr i .i,#svTm i .i{width:1.35em;height:1.35em;vertical-align:0}
.svi.fr.on i{background:var(--pri,#2f66b8);color:var(--pi,#fff)}
#svTab{display:none}
@media(max-width:700px){
 body.hasrail{padding-left:calc(18px + var(--safe-l,0px));padding-right:calc(18px + var(--safe-r,0px))}
 #svRail{width:248px;transform:translateX(-100%);transition:transform .18s}
 #svRail.open{transform:none}
 #svTab{font-family:Quicksand,system-ui,sans-serif;display:grid;position:fixed;left:0;top:50%;z-index:59;width:18px;height:56px;font-size:.8rem;padding:0;place-items:center;border:1px solid var(--bd,#ddd);border-left:0;border-radius:0 12px 12px 0;background:var(--panel,#fff);color:var(--ink,#111);cursor:pointer;box-shadow:var(--sh,none)}
}
@media(max-width:700px){body:has(.cw-win:not([hidden])) #svTab,body:has(.cwf-win) #svTab,body:has(.cwf-panel:not([hidden])) #svTab{display:none}}   /* the menu tab must not sit on top of an open chat / private message on phones */
@media(prefers-reduced-motion:reduce){#svRail,.svi i{transition:none}}
#svNp{position:fixed;left:84px;bottom:12px;z-index:70;width:380px;max-width:calc(100vw - 96px);max-height:min(560px,80dvh);display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--ink,#111);border:1px solid var(--bd,#ddd);border-radius:18px;box-shadow:var(--sh,none),0 12px 40px rgba(0,0,0,.18);overflow:hidden;font-family:Quicksand,system-ui,sans-serif}
.th-cepalco #svNp{border-width:3px}
#svNp[hidden],#svTh2[hidden]{display:none}
#svTh2{position:fixed;left:84px;bottom:12px;z-index:70;width:300px;max-width:calc(100vw - 96px);padding:12px;background:var(--panel,#fff);color:var(--ink,#111);border:1px solid var(--bd,#ddd);border-radius:18px;box-shadow:var(--sh,none),0 12px 40px rgba(0,0,0,.18);font-family:Quicksand,system-ui,sans-serif}
.th-cepalco #svTh2{border-width:3px}
#svTh2 h4{margin:2px 6px 8px;font:600 1.1rem Fredoka,Quicksand,sans-serif}
#svTh2 .swopt[aria-pressed=true]{border-color:var(--pri,#2f66b8)}
#svNp .nhead{display:flex;justify-content:space-between;align-items:center;padding:14px 16px 4px}
#svNp h4{margin:0;font:600 1.25rem Fredoka,Quicksand,sans-serif}
#svNp .nlink{background:none;border:0;color:var(--pri,#2f66b8);font:800 .78rem Quicksand,sans-serif;cursor:pointer;min-height:32px}
#svNp .ntabs{display:flex;gap:6px;padding:6px 12px}
#svNp .ntab{min-height:32px;padding:0 14px;border-radius:99px;border:0;background:transparent;font:800 .82rem Quicksand,sans-serif;opacity:.7;cursor:pointer;color:inherit}
#svNp .ntab.on{background:var(--soft,#f1f5f9);opacity:1;color:var(--pri,#2f66b8)}
#svNp .nlist{list-style:none;margin:0;padding:4px 8px 10px;overflow-y:auto;overscroll-behavior:contain}
#svNp .nitem{display:flex;align-items:center;gap:12px;padding:10px 8px;border-radius:14px;cursor:pointer}
#svNp .nitem:hover{background:var(--soft,#f1f5f9)}
#svNp .nic{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;font-size:1.25rem;background:var(--soft,#f1f5f9);flex:none;border:1px solid var(--bd,#ddd)}
#svNp .ntxt{flex:1;min-width:0;font-size:.85rem;line-height:1.3;overflow-wrap:anywhere}
#svNp .ntxt .nsv{font-weight:800;opacity:.75}
#svNp .ntxt small{display:block;margin-top:2px;font-size:.72rem;font-weight:700;opacity:.6}
#svNp .nitem.unread .ntxt small{color:var(--pri,#2f66b8);opacity:1}
#svNp .ndot{width:12px;height:12px;border-radius:50%;background:var(--pri,#2f66b8);flex:none;visibility:hidden}
#svNp .nitem.unread .ndot{visibility:visible}
#svNp .nempty{text-align:center;padding:28px 12px;opacity:.6;font-size:.85rem}
.svi.nt.ring i{animation:svring .6s ease-in-out 2}
@keyframes svring{0%,100%{transform:rotate(0)}20%{transform:rotate(14deg)}40%{transform:rotate(-12deg)}60%{transform:rotate(8deg)}80%{transform:rotate(-6deg)}}
@media(max-width:700px){#svTh2{left:10px;right:10px;width:auto;max-width:none;bottom:calc(10px + env(safe-area-inset-bottom,0px))}#svNp{left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));width:auto;max-width:none}}
#svDlg{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(15,23,42,.6)}
#svDlg[hidden]{display:none}
#svDlg .box{font-family:Quicksand,system-ui,sans-serif;box-shadow:var(--sh,none);width:min(420px,100%);max-height:90dvh;overflow:auto;padding:20px;border-radius:18px;background:var(--panel,#fff);color:var(--ink,#111);border:1px solid var(--bd,#ddd);display:flex;flex-direction:column;gap:10px}
#svDlg h3{margin:0;font:600 1.2rem Fredoka,Quicksand,sans-serif}.th-cepalco #svDlg .box{border-width:3px}#svDlg p,#svDlg label{margin:0;font-size:.82rem;opacity:.8}
#svDlg input{width:100%;min-height:var(--ctl,44px);padding:10px 12px;border-radius:var(--r,12px);border:1px solid var(--bd,#ccc);background:transparent;color:inherit;font:inherit}
#svDlg .r{display:flex;gap:8px;flex-wrap:wrap}#svDlg .r>*{flex:1 1 auto}
#svDlg .code{font:800 1.3rem Fredoka,ui-monospace,monospace;letter-spacing:.18em;text-align:center;padding:10px;border:1px dashed var(--bd,#999);border-radius:10px;user-select:all}
#svDlg .err{color:#dc2626;font-size:.8rem;min-height:1em}
#svDlg .danger{color:#dc2626}`;
const st=document.createElement('style');st.textContent=css;document.head.append(st);
let LIST=[],ME=null,SUPER=false;
const hue=id=>{let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))%360;return h};
const ini=n=>(String(n).match(/[A-Za-z0-9]/g)||['?']).slice(0,2).join('').toUpperCase();
const LOGO_DAYS=15,LOGO_MS=LOGO_DAYS*864e5;
const sbg=s=>s.id===DEF?'background:#000;color:#facc15':`background:hsl(${hue(s.id)} 55% 45%)`;
const sini=s=>s.id===DEF?'CE':esc(ini(s.name));
const limg=s=>s.logoAt?`<img src="/api/server-logo/${esc(s.id)}?v=${+s.logoAt}" alt="" width="96" height="96" decoding="async" onerror="this.remove()">`:'';   // versioned URL -> cached forever by the browser/CDN
const icon=s=>`<i style="${sbg(s)}">${sini(s)}${limg(s)}</i>`;
// shrink a picked photo to a 96x96 centre-cropped WebP (JPEG if WebP is unsupported), <= ~20 KB, before it is uploaded
async function shrink(file){
  const bmp=await createImageBitmap(file),S=96,c=document.createElement('canvas');c.width=c.height=S;
  const k=Math.min(bmp.width,bmp.height),x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,S,S);x.drawImage(bmp,(bmp.width-k)/2,(bmp.height-k)/2,k,k,0,0,S,S);
  let type='image/webp',out=c.toDataURL(type,.8);if(!out.startsWith('data:image/webp')){type='image/jpeg';out=c.toDataURL(type,.8)}
  for(let q=.7;(out.length-23)*.75>20000&&q>.3;q-=.1)out=c.toDataURL(type,q);
  if((out.length-23)*.75>22000)throw new Error('That picture is too detailed. Try a simpler one.');
  return out;
}
function go(id){if(id===cur()&&!ONX)return;id===DEF?localStorage.removeItem(KEY):localStorage.setItem(KEY,id);ONX?location.assign('index.html'):location.reload()}
function dlg(html){let d=document.getElementById('svDlg');if(!d){d=document.createElement('div');d.id='svDlg';d.hidden=true;d.addEventListener('mousedown',e=>{if(e.target===d)d.hidden=true});document.body.append(d)}d.innerHTML='<div class="box">'+html+'</div>';d.hidden=false;return d}
const close=()=>{const d=document.getElementById('svDlg');if(d)d.hidden=true};
async function act(d,fn){const e=d.querySelector('.err');sessionStorage.removeItem('stb_svl');try{e.textContent='';await fn()}catch(x){e.textContent=x.message||'Something went wrong'}}
function addDlg(){
  const d=dlg(`<h3>Add a server</h3><p>Create your own, or join one with a passkey (8 characters) from a server Head.</p>
  <input id="svN" placeholder="Server name" maxlength="30"><div class="r"><button class="btn pri" id="svC">＋ Create server</button></div>
  <p style="text-align:center">— or —</p>
  <input id="svJ" placeholder="Passkey (8 characters)" maxlength="12" autocapitalize="characters"><div class="r"><button class="btn" id="svJb">Join server</button></div>
  <div class="err"></div><div class="r"><button class="btn" id="svX">Close</button></div>`);
  d.querySelector('#svX').onclick=close;
  d.querySelector('#svC').onclick=()=>act(d,async()=>{const r=await api('/api/servers','POST',{name:d.querySelector('#svN').value});go(r.id)});
  d.querySelector('#svJb').onclick=()=>act(d,async()=>{const r=await api('/api/servers/join','POST',{code:d.querySelector('#svJ').value});go(r.id)});
}
async function teamDlg(){
  const s=LIST.find(x=>x.id===cur())||LIST[0],sup=s.role==='host';
  const d=dlg(`<h3>👥 My team</h3><div id="tmB">Loading…</div><div class="err"></div><div class="r"><button class="btn pri" id="tmS">Save team</button><button class="btn" id="svX">Close</button></div>`);
  const $=q=>d.querySelector(q),L=h=>`<div class="kb">${h}</div>`;$('#svX').onclick=close;
  let T={candidates:[]},S={sections:[],departments:[]};
  try{[T,S]=await Promise.all([api('/api/team'),api('/api/sections')])}catch(x){$('.err').textContent=x.message}
  const chk=(id,on,txt,sm)=>`<label style="display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:10px;background:rgba(127,127,127,.1);font-size:.85rem"><input type="checkbox" data-id="${esc(id)}"${on?' checked':''} style="width:auto"><span style="flex:1">${txt}</span><small style="opacity:.6">${sm||''}</small></label>`;
  let h='';
  if(sup){
    h+=L(`<b>🏷 My sections</b><small>Name a Section first. It becomes a role with its own chatbox, given to you and every Staff you pick (and to the Head who picks you).</small>`
      +(S.sections.map(x=>`<div class="r" style="align-items:center;flex-wrap:nowrap"><span style="flex:1">🏷 <b>${esc(x.name)}</b> · ${x.members} member${x.members===1?'':'s'}</span><button class="btn danger" data-ds="${esc(x.id)}" style="flex:none">Delete</button></div>`).join(''))
      +`<div class="r"><input id="scN" placeholder="Section name (e.g. Billing)" maxlength="30"><button class="btn pri" id="scC" style="flex:none">＋ Create</button></div>`);
    h+=T.mySections?L(`<b>Pick your Staff</b>${T.candidates.length?'<div id="tmL" style="display:flex;flex-direction:column;gap:4px;max-height:34dvh;overflow:auto">'+T.candidates.map(c=>chk(c.id,c.mine,esc(c.name),c.others?'also with '+c.others+' other':'')).join('')+'</div>':'<small>No Staff yet. Share a Staff passkey from Server info.</small>'}`):L('<small>🔒 Create a Section above to unlock picking your Staff.</small>');
  }else{
    h+=L(`<b>Pick your Supervisors</b><small>You also get each Supervisor's Sections (roles + chatboxes) and oversee their Staff.</small>${T.candidates.length?'<div id="tmL" style="display:flex;flex-direction:column;gap:4px;max-height:30dvh;overflow:auto">'+T.candidates.map(c=>chk(c.id,c.mine,esc(c.name),(c.sections.length?c.sections.map(esc).join(', ')+' · ':'')+c.staff+' staff')).join('')+'</div>':'<small>No Supervisors yet. Share a Supervisor passkey from Server info.</small>'}`);
    const bySup={};S.sections.forEach(x=>(bySup[x.supName]=bySup[x.supName]||[]).push(x));
    h+=L(`<b>🏢 Departments</b><small>Group Sections of the Supervisors you picked under a Department.</small>`
      +S.departments.map(dp=>`<div class="kb" data-dp="${esc(dp.id)}"><div class="r" style="align-items:center;flex-wrap:nowrap"><b style="flex:1">🏢 ${esc(dp.name)}</b><button class="btn" data-dsave="${esc(dp.id)}" style="flex:none">Save</button><button class="btn danger" data-ddel="${esc(dp.id)}" style="flex:none">Delete</button></div>${S.sections.length?S.sections.map(x=>chk(x.id,dp.sectionIds.includes(x.id),esc(x.name),esc(x.supName))).join(''):'<small>No Sections yet.</small>'}</div>`).join('')
      +`<div class="kb" id="dpNew"><input id="dpN" placeholder="New Department name" maxlength="30">${S.sections.length?S.sections.map(x=>chk(x.id,false,esc(x.name),esc(x.supName))).join(''):'<small>Pick a Supervisor with a Section first.</small>'}<div class="r"><button class="btn pri" id="dpC">＋ Create Department</button></div></div>`);
  }
  $('#tmB').innerHTML=h;
  const ids=el=>[...el.querySelectorAll('input[type=checkbox]:checked')].map(i=>i.dataset.id);
  $('#tmS').onclick=()=>act(d,async()=>{const add=[],remove=[];d.querySelectorAll('#tmL input').forEach(i=>{const c=T.candidates.find(x=>x.id===i.dataset.id);if(i.checked&&!c.mine)add.push(c.id);if(!i.checked&&c.mine)remove.push(c.id)});await api('/api/team','POST',{add,remove});teamDlg()});
  if($('#scC'))$('#scC').onclick=()=>act(d,async()=>{await api('/api/sections','POST',{name:$('#scN').value});teamDlg()});
  d.querySelectorAll('[data-ds]').forEach(b=>b.onclick=()=>confirm('Delete this Section and its chatbox messages?')&&act(d,async()=>{await api('/api/sections/'+b.dataset.ds,'DELETE');teamDlg()}));
  if($('#dpC'))$('#dpC').onclick=()=>act(d,async()=>{await api('/api/departments','POST',{name:$('#dpN').value,sectionIds:ids($('#dpNew'))});teamDlg()});
  d.querySelectorAll('[data-dsave]').forEach(b=>b.onclick=()=>act(d,async()=>{await api('/api/departments/'+b.dataset.dsave,'PUT',{sectionIds:ids(b.closest('[data-dp]'))});b.textContent='Saved ✓'}));
  d.querySelectorAll('[data-ddel]').forEach(b=>b.onclick=()=>confirm('Delete this Department? (Its Sections stay.)')&&act(d,async()=>{await api('/api/departments/'+b.dataset.ddel,'DELETE');teamDlg()}));
}
function infoDlg(){
  const s=LIST.find(x=>x.id===cur())||LIST[0],isH=s.role==='admin',def=s.id===DEF;
  const d=dlg(`<h3>${esc(s.name)}</h3><p>Created by <b>${esc(s.createdBy)}</b> · ${s.members} member${s.members===1?'':'s'} · your position: <b>${ROLE[s.role]||s.role}</b></p>
  ${def?'<p>Positions (Head / Supervisor / Staff) and custom roles (e.g. COLLECTION, BILLING) belong to this server.</p>':''}
  ${isH?'<label>Passkeys &amp; direct links <span style="opacity:.7">(share the one for the position you want to give)</span></label><div id="svKeys"></div>':''}
  ${isH?`<label>Server logo <span style="opacity:.7">(one change every ${LOGO_DAYS} days)</span></label><div class="r" style="align-items:center;flex-wrap:nowrap"><span class="lgp" id="svLg" style="${sbg(s)}">${sini(s)}${limg(s)}</span><button class="btn" id="svLp" type="button">Choose image</button><button class="btn pri" id="svLs" type="button" disabled>Save logo</button></div><input type="file" id="svLf" accept="image/jpeg,image/png,image/webp" hidden><p id="svLn"></p>`:''}
  ${!def&&isH?`<label>Rename server</label><input id="svRn" value="${esc(s.name)}" maxlength="30"><div class="r"><button class="btn" id="svRb">Save name</button></div>`:''}
  ${isH?'<div class="r"><a class="btn" href="users.html">Manage people &amp; roles</a></div>':''}
  ${!def&&!s.owner&&!s.via?'<div class="r"><button class="btn danger" id="svL">Leave server</button></div>':''}
  ${!def&&(s.owner||SUPER)?'<div class="r"><button class="btn danger" id="svD">Delete server</button></div>':''}
  <div class="err"></div><div class="r"><button class="btn" id="svX">Close</button></div>`);
  const $=q=>d.querySelector(q);$('#svX').onclick=close;
  if($('#svKeys')){
    const P=[['admin','👑 Head','Can manage the whole server and picks his Supervisors'],['host','🧭 Supervisor','Can assign tasks and picks his own Staff'],['staff','🙋 Staff','Sees and completes assigned tasks']],link=c=>location.origin+'/register.html?join='+c;
    const paint=()=>{const cs=s.codes||{staff:s.code||''};$('#svKeys').innerHTML=P.map(([r,n,t])=>`<div class="kb"><b>${n}</b><small>${t}</small>${cs[r]?`<div class="code">${esc(cs[r])}</div><div class="r"><button class="btn" data-k="cp" data-r="${r}">Copy code</button><button class="btn" data-k="ln" data-r="${r}">🔗 Copy link</button><button class="btn" data-k="rs" data-r="${r}">New</button>${def||r!=='staff'?`<button class="btn" data-k="off" data-r="${r}">Off</button>`:''}</div>`:`<div class="r"><button class="btn" data-k="rs" data-r="${r}">Create ${n.split(' ')[1]} passkey</button></div>`}</div>`).join('')};
    paint();
    $('#svKeys').onclick=e=>{const b=e.target.closest('[data-k]');if(!b)return;const r=b.dataset.r,cs=s.codes=s.codes||{staff:s.code||''};
      if(b.dataset.k==='cp'||b.dataset.k==='ln'){const v=b.dataset.k==='cp'?cs[r]:link(cs[r]);return navigator.clipboard&&navigator.clipboard.writeText(v).then(()=>{const t=b.textContent;b.textContent='Copied ✓';setTimeout(()=>b.textContent=t,1200)})}
      if(b.dataset.k==='off'&&!confirm('Turn off this passkey? Its code and link stop working until you create a new one.'))return;
      act(d,async()=>{const u='/api/servers/'+(def?'cepalco':s.id)+'/invite';if(b.dataset.k==='off'){await api(u,'DELETE',{role:r});cs[r]=''}else{cs[r]=(await api(u,'POST',{role:r})).code}if(r==='staff')s.code=cs[r];paint()})};
  }
  if($('#svLp')){
    const left=s.logoAt?s.logoAt+LOGO_MS-Date.now():0,locked=left>0;let pic=null;
    $('#svLn').textContent=locked?`🔒 Changed recently. You can change it again in ${Math.ceil(left/864e5)} day${Math.ceil(left/864e5)===1?'':'s'}.`:(s.logoAt?'You can change the logo now. After saving, it locks for 15 days.':'Add a logo. After saving, it can be changed once every 15 days.');
    $('#svLp').disabled=locked;
    $('#svLp').onclick=()=>$('#svLf').click();
    $('#svLf').onchange=e=>act(d,async()=>{const f=e.target.files[0];if(!f)return;if(!/^image\/(jpeg|png|webp)$/.test(f.type))throw new Error('Please choose a JPG, PNG or WebP image.');
      pic=await shrink(f);$('#svLg').innerHTML=`<img alt="" src="${pic}">`;$('#svLs').disabled=false});
    $('#svLs').onclick=()=>pic&&act(d,async()=>{$('#svLs').disabled=true;try{await api('/api/servers/'+s.id+'/logo','POST',{image:pic});location.reload()}catch(x){$('#svLs').disabled=false;throw x}});
  }
  if($('#svRb'))$('#svRb').onclick=()=>act(d,async()=>{await api('/api/servers/'+s.id,'PUT',{name:$('#svRn').value});location.reload()});
  if($('#svL'))$('#svL').onclick=()=>confirm('Leave "'+s.name+'"?')&&act(d,async()=>{await api('/api/servers/'+s.id+'/leave','POST',{});go(DEF)});
  if($('#svD'))$('#svD').onclick=()=>confirm('Delete "'+s.name+'" with its chat, roles and shared tasks? This cannot be undone.')&&act(d,async()=>{await api('/api/servers/'+s.id,'DELETE');go(DEF)});
}
/* ---------- notifications (bell lives in the server menu) ---------- */
const TASKT=['assigned','done','all_done','closed'];   // only task notifications belong to a server -> shown as (Server name); friend requests, posts and replies are global
const NI={assigned:'📌',done:'✅',all_done:'🎉',closed:'🔒',friend_req:'🤝',friend_ok:'🤝',post_like:'❤️',post_reply:'💬'};
const ago=ms=>{const s=Math.max(1,Math.floor((Date.now()-ms)/1000));if(s<60)return 'Just now';const m=Math.floor(s/60);if(m<60)return m+'m ago';const h=Math.floor(m/60);if(h<24)return h+'h ago';const d=Math.floor(h/24);return d<7?d+'d ago':new Date(ms).toLocaleDateString('en-PH',{month:'short',day:'numeric',timeZone:'Asia/Manila'})};
const NT={items:[],f:'all',last:-1,
  svName(n){if(!TASKT.includes(n.type)||!n.sv)return '';const x=LIST.find(v=>v.id===n.sv);return x?x.name:(n.svName||'')},   // current name if I'm still in that server, else the name saved with the notification
  text(n){const b=`<b>${esc(n.byName||'Someone')}</b>`,t=`<b>${esc(n.title||'a task')}</b>`;
    return n.type==='assigned'?`${b} assigned you a task: ${t}`:n.type==='done'?`${b} marked ${t} as done`:n.type==='all_done'?`Everyone finished ${t} (last: ${b})`:n.type==='closed'?`${b} closed ${t} for everyone`
      :n.type==='friend_req'?`${b} sent you a friend request`:n.type==='friend_ok'?`${b} accepted your friend request`:n.type==='post_like'?`${b} liked your post: ${t}`:n.type==='post_reply'?`${b} replied to your post: ${t}`:`${b} updated ${t}`},
  render(){
    const un=this.items.filter(n=>!n.read).length,bd=document.querySelector('#svNt .svb');
    if(bd){bd.textContent=un>9?'9+':un;bd.hidden=!un}
    const bt=document.getElementById('svNt');if(bt)bt.setAttribute('aria-label',un?`Notifications, ${un} unread`:'Notifications');
    const ul=document.getElementById('nList');if(!ul)return;
    const L=this.items.filter(n=>this.f==='all'||!n.read);
    ul.innerHTML=L.length?L.map(n=>{const sv=this.svName(n);return `<li class="nitem${n.read?'':' unread'}" data-id="${esc(n.id)}" data-t="${esc(n.type)}" data-d="${esc(n.date||'')}" data-sv="${esc(n.sv||'')}"><span class="nic">${NI[n.type]||'🔔'}</span><div class="ntxt">${this.text(n)}${sv?` <span class="nsv">(${esc(sv)})</span>`:''}<small>${ago(n.t)}</small></div><span class="ndot"></span></li>`}).join(''):`<li class="nempty">${this.f==='all'?'No notifications yet':'No unread notifications'}</li>`;
  },
  async load(){
    try{const r=await api('/api/notifications');this.items=r.items||[];
      if(this.last>=0&&r.unread>this.last){const b=document.getElementById('svNt');if(b){b.classList.remove('ring');void b.offsetWidth;b.classList.add('ring')}}
      if(this.last>=0&&r.unread>this.last&&document.hidden&&window.Notification&&Notification.permission==='granted'&&navigator.serviceWorker){
        const n=this.items.find(x=>!x.read);const t=n?this.text(n).replace(/<[^>]+>/g,''):'You have new notifications';
        navigator.serviceWorker.ready.then(g=>g.showNotification('CrewCamp',{body:t,icon:'icon-192.png',badge:'icon-192.png',tag:'cc-nt',renotify:true,data:{url:'cross.html'}})).catch(()=>{})}
      this.last=r.unread;this.render()}catch(e){}
  },
  async read(ids){
    this.items.forEach(n=>{if(!ids||ids.includes(n.id))n.read=true});this.last=this.items.filter(n=>!n.read).length;this.render();
    try{await api('/api/notifications/read','POST',ids?{ids}:{})}catch(e){}
  },
  toggle(open){const p=document.getElementById('svNp');if(open!==false)TH.toggle(false);open=open===undefined?p.hidden:open;p.hidden=!open;if(open&&window.Notification&&Notification.permission==='default')try{Notification.requestPermission()}catch(e){}document.getElementById('svNt').setAttribute('aria-expanded',String(open));if(open)this.load()},
  init(){
    const p=document.createElement('div');p.id='svNp';p.hidden=true;p.setAttribute('role','dialog');p.setAttribute('aria-label','Notifications');
    p.innerHTML='<div class="nhead"><h4>Notifications</h4><button class="nlink" id="nMarkAll" type="button">Mark all as read</button></div><div class="ntabs"><button class="ntab on" data-f="all" type="button">All</button><button class="ntab" data-f="unread" type="button">Unread</button></div><ul class="nlist" id="nList"></ul>';
    document.body.append(p);
    p.querySelector('#nMarkAll').onclick=()=>this.read(null);
    p.querySelectorAll('.ntab').forEach(b=>b.onclick=()=>{p.querySelectorAll('.ntab').forEach(x=>x.classList.toggle('on',x===b));this.f=b.dataset.f;this.render()});
    p.querySelector('#nList').onclick=e=>{
      const li=e.target.closest('.nitem');if(!li)return;const t=li.dataset.t;
      this.read([li.dataset.id]);this.toggle(false);
      if(t==='friend_req'||t==='friend_ok')return window.__cwF?window.__cwF.openPanel(t==='friend_req'?'requests':'friends'):location.assign('index.html?friends=1');
      if(t==='post_like'||t==='post_reply')return window.openProfile?window.openProfile():location.assign('index.html?profile=1');
      const d=li.dataset.d,sv=li.dataset.sv||DEF;   // task: open that server's Shared calendar on the task's date
      localStorage.setItem('stb_mode','shared');sv===DEF?localStorage.removeItem(KEY):localStorage.setItem(KEY,sv);
      if(/^\d{4}-\d{2}-\d{2}$/.test(d))sessionStorage.setItem('stb_open',d);
      location.assign('index.html');
    };
    document.addEventListener('click',e=>{if(!p.hidden&&!p.contains(e.target)&&!e.target.closest('#svNt'))this.toggle(false)});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!p.hidden)this.toggle(false)});
    this.load();
    setInterval(()=>{if(!document.hidden||(window.Notification&&Notification.permission==='granted'))this.load()},90000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.load()});
  }};
/* ---------- theme picker (lives in the server menu, below Friends) ---------- */
const THEMES=[['white','Classic','#2f66b8','#f6f7f9'],['dark','Dark','#10b981','#0b0f19'],['midnight','Midnight','#7aa7e6','#0f1020'],['graphite','Graphite','#e5e5e5','#121212'],['ocean','Ocean','#0284c7','#eef6fb'],['forest','Forest','#2f855a','#f1f5ee'],['lavender','Lavender','#7c3aed','#f5f3ff'],['sunset','Sunset','#ea580c','#fff7ed'],['sand','Sand','#92400e','#f5f1e8'],['pink','Pink','#e11d48','#fff1f2'],['cepalco','CEPALCO','#000000','#facc15']];
const TH={
  mark(){const c=localStorage.getItem('stb_theme')||'white';document.querySelectorAll('#svTh2 [data-th]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.th===c)))},
  toggle(open){const p=document.getElementById('svTh2');open=open===undefined?p.hidden:open;if(open&&typeof NT!=='undefined'&&!document.getElementById('svNp').hidden)NT.toggle(false);p.hidden=!open;document.getElementById('svTh').setAttribute('aria-expanded',String(open));if(open)this.mark()},
  init(){
    const p=document.createElement('div');p.id='svTh2';p.hidden=true;p.setAttribute('role','group');p.setAttribute('aria-label','Theme');
    p.innerHTML='<h4>Theme</h4><div class="themegrid">'+THEMES.map(([id,n,a,b])=>`<button class="swopt" type="button" data-th="${id}" aria-pressed="false"><i class="dotc" style="--a:${a};--b:${b}"></i>${n}</button>`).join('')+'</div>';
    document.body.append(p);
    p.onclick=e=>{const b=e.target.closest('[data-th]');if(!b)return;const t=b.dataset.th;
      localStorage.setItem('stb_theme',t);applyTheme(t);this.mark();
      if(window.__cwSetTheme)window.__cwSetTheme(t);else api('/api/theme','POST',{theme:t}).catch(()=>{});   // index page saves via its own board; other pages use the small /theme call
      this.toggle(false)};
    document.addEventListener('click',e=>{if(!p.hidden&&!p.contains(e.target)&&!e.target.closest('#svTh'))this.toggle(false)});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!p.hidden)this.toggle(false)});
  }};
/* ---------- unread chat on the server icons (Discord style): any channel, any server I am in ---------- */
const SEENK=id=>id===DEF?'cw_seen':'cw_seen_'+id;   // same keys chat.js uses for what I have read
const UN={};let unBusy=false,unChat=false;
function paintUn(){
  document.querySelectorAll('#svRail .svb[data-sv]').forEach(b=>{
    const n=UN[b.dataset.sv]||0;b.hidden=!n;b.textContent=n>99?'99+':n;
    const bt=b.closest('.svi'),nm=bt&&bt.title;if(bt)bt.setAttribute('aria-label',n?`${nm}, ${n} unread chat message${n===1?'':'s'}`:nm);
  });
}
let chatSv=null;window.__svUnread=()=>UN;
window.addEventListener('cw:unread',e=>{chatSv=e.detail.sv||cur();UN[chatSv]=e.detail.n;unChat=true;paintUn()});   // this server: chat.js knows exactly what is on screen
async function pollUn(){
  if(unBusy||document.hidden||!LIST.length)return;unBusy=true;
  try{
    const seen={};
    for(const x of LIST){let o=null;try{o=JSON.parse(localStorage.getItem(SEENK(x.id))||'null')}catch(e){}
      const v=o&&typeof o==='object'?Object.entries(o).map(([k,t])=>k+':'+t).join(','):'';if(v)seen[x.id]=v}
    const d=await api('/api/servers/unread','POST',{seen});
    for(const [id,x] of Object.entries(d.servers||{})){
      if(!(id===(chatSv||cur())&&unChat))UN[id]=x.unread;
      if(id!==cur()&&!(id in seen)){try{localStorage.setItem(SEENK(id),JSON.stringify(x.last))}catch(e){}}   // first look at a server from this browser: what is already there counts as read (the open server is left to chat.js)
    }
    paintUn();
  }catch(e){}finally{unBusy=false}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollUn()});
setInterval(pollUn,60000);   // one small request per minute while the tab is visible
function build(){
  const cs=LIST.find(x=>x.id===cur());if(!cs){localStorage.removeItem(KEY);if(cur()!==DEF)return location.reload()}
  document.body.classList.add('hasrail');
  const r=document.createElement('nav');r.id='svRail';r.setAttribute('aria-label','Servers');
  const nm=ME?(ME.name||ME.username):'Profile',av=ME&&ME.avatarAt?`<img alt="" src="/api/avatar?v=${ME.avatarAt}" onerror="this.remove()">`:'';
  r.innerHTML='<div class="svl"><button class="svi nt" id="svNt" title="Notifications" aria-label="Notifications" aria-haspopup="true" aria-expanded="false"><i style="background:var(--soft,#eee);color:inherit;border:1px solid var(--bd,#ddd);font-size:1.15rem">🔔</i><em class="svb" hidden></em><span>Notifications<small>Tasks, friends &amp; posts</small></span></button><hr style="margin:2px 4px"><div class="svh">Servers</div><button class="svi xs'+(ONX?' on':'')+'" id="svCross" title="Cross-server Calendar" aria-label="Cross-server Calendar"'+(ONX?' aria-current="page"':'')+'><i style="background:#2f66b8">🗓</i><span>Cross-server Calendar<small>All servers · personal + shared</small></span></button><hr style="margin:2px 4px">'+LIST.map(s=>`<button class="svi${s.id===cur()&&!ONX?' on':''}" data-id="${esc(s.id)}" title="${esc(s.name)}" aria-label="${esc(s.name)}"${s.id===cur()?' aria-current="true"':''}>${icon(s)}<em class="svb" data-sv="${esc(s.id)}" hidden></em><span>${esc(s.name)}<small>${esc(ROLE[s.role]||'')}</small></span></button>`).join('')
   +'<button class="svi add" id="svAdd" title="Create or join a server"><i>＋</i><span>Add a server</span></button></div>'
   +'<hr><button class="svi fr" id="svFr" title="Friends &amp; private messages" aria-label="Friends and private messages"><i>🧑‍🤝‍🧑</i><em class="svb" hidden></em><span>Friends<small>Private messages</small></span></button>'
   +'<button class="svi cfg" id="svTh" title="Theme" aria-label="Theme" aria-haspopup="true" aria-expanded="false"><i style="font-size:1.1rem">🎨</i><span>Theme<small>Colors &amp; look</small></span></button>'
   +(SUPER?'<button class="svi cfg" id="svAdm" title="Admin: all servers"><i>🛡</i><span>Admin<small>All servers · manage anything</small></span></button>':'')
   +((LIST.find(x=>x.id===cur())||{}).role==='host'||(LIST.find(x=>x.id===cur())||{}).role==='admin'?'<button class="svi" id="svTm" title="My team"><i>👥</i><span>My team<small>Pick your '+((LIST.find(x=>x.id===cur())||{}).role==='host'?'staff':'supervisors')+'</small></span></button>':'')
   +'<button class="svi cfg" id="svCfg" title="Server info"><i>ⓘ</i><span>Server info</span></button>'
   +`<button class="svi me" id="svMe" title="My profile (all servers)"><span class="av">${av||esc(ini(nm))}</span><span>${esc(nm)}<small>My profile · all servers</small></span></button>`
   +'<button class="svi out" id="svOut" title="Log out"><i>⎋</i><span>Log out</span></button>';
  r.onclick=e=>{const b=e.target.closest('.svi');if(!b)return;if(b.id==='svTh'){e.stopPropagation();r.classList.remove('open');return TH.toggle()}if(b.id==='svNt'){e.stopPropagation();r.classList.remove('open');return NT.toggle()}if(b.id==='svCross')return ONX?r.classList.remove('open'):location.assign('cross.html');if(b.id==='svAdd')return addDlg();if(b.id==='svCfg')return infoDlg();if(b.id==='svTm'){r.classList.remove('open');return teamDlg()}if(b.id==='svAdm')return location.assign('admin-servers.html');if(b.id==='svFr'){r.classList.remove('open');return window.__cwF?window.__cwF.toggle():location.assign('index.html?friends=1')}if(b.id==='svOut')return logout();if(b.id==='svMe')return window.openProfile?window.openProfile():location.assign('index.html?profile=1');go(b.dataset.id)};
  document.body.append(r);if(window.__cwF)window.__cwF.badges();NT.init();TH.init();
  const t=document.createElement('button');t.id='svTab';t.textContent='☰';t.setAttribute('aria-label','Servers');t.onclick=e=>{e.stopPropagation();r.classList.toggle('open')};document.body.append(t);
  document.addEventListener('click',e=>{if(!r.contains(e.target))r.classList.remove('open')});
  if(cs&&cs.id!==DEF)document.title=cs.name+' · '+document.title;
  // Users page inside a user-made server: people are existing accounts (added by username), not new accounts
  if(/users\.html$/.test(location.pathname)){
    const st=document.createElement('style');st.textContent='.pwx:has(#fp){display:none!important}';document.head.append(st);const hide=['#fn','#fp','#fa'];hide.forEach(q=>{const e=document.querySelector(q);if(e)(e.closest('label')||e).hidden=true});
    const h=document.querySelector('#ft');if(h)h.textContent='Add member (existing account)';
    const fu=document.querySelector('#fu');if(fu)fu.placeholder='Username of an existing account';
  }
}
async function init(){let r0;try{
  const c=JSON.parse(sessionStorage.getItem('stb_svl')||'null');   // server list cached 20 s per tab: page-to-page navigation costs no request; cleared on any server change, login and logout
  if(c&&Date.now()-c.t<20000)r0=c.d;else{r0=await api('/api/servers');sessionStorage.setItem('stb_svl',JSON.stringify({t:Date.now(),d:r0}))}
  LIST=r0.servers;SUPER=!!r0.superAdmin}catch(e){return}
  if(SUPER&&cur()!==DEF&&!LIST.some(x=>x.id===cur())){try{const a=(await api('/api/admin/servers')).servers.find(x=>x.id===cur());if(a)LIST.push({id:a.id,name:a.name,owner:false,via:true,role:'admin',members:a.members.length,createdBy:a.owner,code:a.code,logoAt:a.logoAt})}catch(e){}}   // platform admin viewing a server he is not a member of
  try{ME=(await currentUser()).user}catch(e){}build();paintUn();pollUn()}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
window.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
})();
