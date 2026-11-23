const $=s=>document.querySelector(s);
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const COLORS={Now:['#cbfec9','#ebd3ff','#dfc3ff'],Next:['#fff3a1','#c3e2ff'],Later:['#ffd1ea','#cbfec9']};
const ROLE={admin:'Head',host:'Supervisor',staff:'Staff'};
const PRI={Now:0,Next:1,Later:2};
const NEXTP={Now:'Next',Next:'Later',Later:'Now'};   // used by the tap-to-move button
const pad=n=>String(n).padStart(2,'0');
const key=(y,m,d)=>`${y}-${pad(m+1)}-${pad(d)}`;
const todayStr=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const col=c=>/^#[0-9a-f]{3,8}$/i.test(c)?c:'#fff3a1';
const toast=m=>{const d=document.createElement('div');d.textContent=m;$('#toast').append(d);setTimeout(()=>d.remove(),2800)};
const addDays=(s,n)=>{const [y,m,d]=s.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d+n));return `${t.getUTCFullYear()}-${pad(t.getUTCMonth()+1)}-${pad(t.getUTCDate())}`};

/* ---------- state ---------- */
let ME={id:'',role:'staff',hostNames:[]};
let P={tasks:[],theme:'white'};          // personal board (saved as a whole)
let SH=[];                                // shared tasks visible to me (from server)
let PEOPLE=[];                            // people I can assign to
let mode=localStorage.getItem('stb_mode')==='shared'?'shared':'personal';
let fil='all',lastAssign=[];
const t0=todayStr().split('-').map(Number);
let vy=t0[0],vm=t0[1]-1,openDate=null,view='board',editId=null,dragId=null,saveT;
const isMgr=()=>ME.role!=='staff';

/* ---------- Philippine holidays (common list; movable/Islamic ones need yearly proclamation) ---------- */
const hCache={};
function holidays(y){
  if(hCache[y])return hCache[y];
  const h={},add=(m,d,n)=>h[key(y,m-1,d)]=n;
  add(1,1,"New Year's Day");add(2,25,'EDSA Revolution Anniv.');add(4,9,'Araw ng Kagitingan');
  add(5,1,'Labor Day');add(6,12,'Independence Day');add(8,21,'Ninoy Aquino Day');
  add(11,1,"All Saints' Day");add(11,2,"All Souls' Day");add(11,30,'Bonifacio Day');
  add(12,8,'Immaculate Conception');add(12,24,'Christmas Eve');add(12,25,'Christmas Day');
  add(12,30,'Rizal Day');add(12,31,"New Year's Eve");
  const cny={2026:[2,17],2027:[2,6],2028:[1,26]};if(cny[y])add(cny[y][0],cny[y][1],'Chinese New Year');
  const d=new Date(Date.UTC(y,7,31));while(d.getUTCDay()!==1)d.setUTCDate(d.getUTCDate()-1);
  add(8,d.getUTCDate(),'National Heroes Day');
  const a=y%19,b=Math.floor(y/100),c=y%100,dd=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
  hh=(19*a+b-dd-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-hh-k)%7,m=Math.floor((a+11*hh+22*l)/451),
  mo=Math.floor((hh+l-7*m+114)/31),da=((hh+l-7*m+114)%31)+1;
  [[-3,'Maundy Thursday'],[-2,'Good Friday'],[-1,'Black Saturday'],[0,'Easter Sunday']].forEach(([o,n])=>{
    const t=new Date(Date.UTC(y,mo-1,da+o));add(t.getUTCMonth()+1,t.getUTCDate(),n)});
  return hCache[y]=h;
}

/* ---------- unified view of the current mode ----------
   state: 'active' | 'done' | 'trash'.  Shared: managers see a task done when everyone finished;
   an assignee sees it done when their own part is finished. */
const sState=t=>t.status==='trash'?'trash':((t.canManage?t.complete:t.myDone)?'done':'active');
const pState=t=>t.status;
function items(){
  if(mode==='personal')return P.tasks.map(t=>Object.assign({},t,{state:pState(t)}));
  return SH.filter(t=>fil==='all'||t.assignees.some(a=>a.id===fil)).map(t=>Object.assign({},t,{state:sState(t)}));
}
const byDate=(L,d,s)=>L.filter(t=>t.date===d&&t.state===s);
const sortAct=l=>l.slice().sort((a,b)=>((b.pinned?1:0)-(a.pinned?1:0))||0);
const find=id=>(mode==='personal'?P.tasks:SH).find(t=>t.id===id);

/* ---------- mode switch ---------- */
function setMode(m){
  mode=m;localStorage.setItem('stb_mode',m);document.body.dataset.mode=m;
  document.querySelectorAll('.mode').forEach(b=>{const on=b.dataset.mode===m;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)});
  $('#filWrap').hidden=!(m==='shared'&&isMgr()&&PEOPLE.length>0);
  renderAll();
}
document.querySelectorAll('.mode').forEach(b=>b.onclick=()=>{if(!openDate)setMode(b.dataset.mode)});
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||openDate||!$('#acct').hidden||!$('#prof').hidden||($('#rep')&&!$('#rep').hidden)||/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))return;
  const k=e.key.toLowerCase();
  if(k==='p')setMode('personal');else if(k==='s')setMode('shared');else if(k==='t')$('#goToday').click();
});
function updateModeLabels(){
  const pa=P.tasks.filter(t=>t.status==='active').length,sa=SH.filter(t=>sState(t)==='active').length;
  $('#bP').textContent=pa;$('#bS').textContent=sa;
  $('#bS').classList.toggle('hot',!isMgr()&&sa>0);
  $('#pSub').textContent='Your private notes';
  $('#sSub').textContent=ME.role==='staff'?(ME.hostNames.length?'Tasks from '+ME.hostNames.join(', '):'Tasks from your supervisors')
    :ME.role==='host'?'Assign tasks to your team':'Assign tasks to anyone';
}

/* ---------- calendar ---------- */
function renderCal(){
  $('#monthTitle').textContent=`${MONTHS[vm]} ${vy}`;
  const first=new Date(vy,vm,1).getDay(),dim=new Date(vy,vm+1,0).getDate(),tds=todayStr(),H=holidays(vy),L=items();
  let out='';
  for(let i=0;i<first;i++)out+='<div></div>';
  for(let d=1;d<=dim;d++){
    const k=key(vy,vm,d),list=sortAct(byDate(L,k,'active')),hol=H[k];
    out+=`<button class="cell${hol?' hol':''}${k===tds?' tdy':''}" data-d="${k}">
      <span class="n"><span>${d}</span>${list.length?`<em>${list.length}</em>`:''}</span>
      ${hol?`<span class="h">${esc(hol)}</span>`:''}
      ${list.slice(0,2).map(t=>`<span class="chip" style="background:${col(t.color)}">${esc(t.title)}</span>`).join('')}
      ${list.length>2?`<span class="h">+${list.length-2} more</span>`:''}</button>`;
  }
  $('#days').innerHTML=out;
  const A=L.filter(t=>t.state==='active');
  $('#sActive').textContent=A.length;
  $('#sDone').textContent=L.filter(t=>t.state==='done').length;
  $('#sOver').textContent=A.filter(t=>t.date<tds).length;
}
$('#days').onclick=e=>{const c=e.target.closest('.cell');if(c)openBoard(c.dataset.d)};
$('#prev').onclick=()=>{vm--;if(vm<0){vm=11;vy--}renderCal()};
$('#next').onclick=()=>{vm++;if(vm>11){vm=0;vy++}renderCal()};
$('#goToday').onclick=()=>{vy=t0[0];vm=t0[1]-1;renderCal()};
$('#fil').onchange=e=>{fil=e.target.value;renderAll()};

let agTab='soon';
function renderAgenda(){
  const tds=todayStr(),lim=addDays(tds,7),all=items();
  const lab=d=>d<tds?'Overdue':d===tds?'Today':d===addDays(tds,1)?'Tomorrow':new Date(d+'T00:00:00').toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'});
  const D=all.filter(t=>t.state==='done');
  $('#agDoneN').textContent=D.length;
  $('#agTitle').textContent=mode==='personal'?'My notes — due soon':(isMgr()?'Team tasks — due soon':'Assigned to me — due soon');
  document.querySelectorAll('.agtabs button').forEach(b=>{const on=b.dataset.ag===agTab;b.classList.toggle('on',on);b.setAttribute('aria-selected',on)});
  if(agTab==='done'){   // newest finished first; shared tasks show when everyone (managers) / you (assignees) finished
    const dd=t=>mode==='personal'?(t.completed||t.date):(t.canManage?(t.assignees.map(a=>a.doneAt).filter(Boolean).sort().pop()||t.date):((t.assignees.find(a=>a.id===ME.id)||{}).doneAt||t.date));
    const L=D.map(t=>({t,d:dd(t)})).sort((a,b)=>b.d.localeCompare(a.d));
    $('#agList').innerHTML=L.length?L.slice(0,30).map(({t,d})=>`<button class="ag" data-d="${t.date}">
      <span class="d" style="color:#059669">✔ ${esc(new Date(d+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric'}))}</span><span class="t">${esc(t.title)}</span>
      <span class="w">${mode==='shared'&&isMgr()?esc(t.assignees.map(a=>a.name).join(', ')):esc(t.priority)}</span></button>`).join('')
      :'<div class="empty">Nothing completed yet.</div>';
    return;
  }
  const L=all.filter(t=>t.state==='active'&&t.date<=lim).sort((a,b)=>a.date.localeCompare(b.date)||PRI[a.priority]-PRI[b.priority]);
  $('#agList').innerHTML=L.length?L.slice(0,10).map(t=>`<button class="ag" data-d="${t.date}">
    <span class="d${t.date<tds?' late':''}">${lab(t.date)}</span><span class="t">${esc(t.title)}</span>
    <span class="w">${mode==='shared'&&isMgr()?esc(t.assignees.map(a=>a.name).join(', ')):esc(t.priority)}</span></button>`).join('')
    :`<div class="empty">${mode==='shared'&&!isMgr()?'Nothing assigned to you right now 🎉':'All clear — nothing due soon 🎉'}</div>`;
}
document.querySelectorAll('.agtabs button').forEach(b=>b.onclick=()=>{agTab=b.dataset.ag;renderAgenda()});
$('#agList').onclick=e=>{const b=e.target.closest('.ag');if(!b)return;const [y,m]=b.dataset.d.split('-').map(Number);vy=y;vm=m-1;renderCal();openBoard(b.dataset.d)};
function renderAll(){updateModeLabels();renderCal();renderAgenda();if(openDate&&!editId)renderBoard()}

/* ---------- board modal ---------- */
function openBoard(d){openDate=d;view='board';editId=null;$('#modal').hidden=false;document.body.classList.add('lock');renderBoard()}
function closeBoard(){$('#modal').hidden=true;document.body.classList.remove('lock');openDate=null;editId=null;renderAll()}
$('#bClose').onclick=closeBoard;
$('#modal').onclick=e=>{if(e.target.id==='modal')closeBoard()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&openDate)closeBoard()});
document.querySelectorAll('#modal .tabs button').forEach(b=>b.onclick=()=>{view=b.dataset.v;editId=null;renderBoard()});

function peopleBox(sel,extra){
  const list=PEOPLE.slice();(extra||[]).forEach(a=>{if(!list.some(p=>p.id===a.id))list.push({id:a.id,name:a.name,role:''})});
  if(!list.length)return '<div class="empty full">No team members linked to you yet. Ask the Head to link staff to your account (Users page).</div>';
  return `<div class="people">${list.map(p=>`<label class="pchip"><input type="checkbox" value="${esc(p.id)}"${sel.includes(p.id)?' checked':''}><span>${esc(p.name)}${ME.role==='admin'&&p.role?` <small>${ROLE[p.role]}</small>`:''}</span></label>`).join('')}</div>
    <button type="button" class="mini" data-a="pall">☑ Select / clear all</button>`;
}
const picked=root=>[...root.querySelectorAll('.people input:checked')].map(i=>i.value);

function renderBoard(){
  const [y,m,d]=openDate.split('-').map(Number),shared=mode==='shared',trashOK=!(shared&&!isMgr());
  $('#bTitle').textContent=new Date(y,m-1,d).toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  $('#bHol').textContent=holidays(y)[openDate]?'🇵🇭 '+holidays(y)[openDate]:'';
  $('#bMode').textContent=shared?'👥 Shared calendar':'👤 Personal calendar';
  const L=items().filter(t=>t.date===openDate);
  $('#cDone').textContent=L.filter(t=>t.state==='done').length;$('#cTrash').textContent=L.filter(t=>t.state==='trash').length;
  $('#tabTrash').hidden=!trashOK;if(!trashOK&&view==='trash')view='board';
  document.querySelectorAll('#modal .tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===view));
  const B=$('#bBody');
  if(view==='board'){
    const act=L.filter(t=>t.state==='active');
    let top='';
    if(!shared)top=`<div class="add">
      <input id="nTitle" placeholder="What needs to be done? (Enter to add)" maxlength="120">
      <input id="nDesc" placeholder="Description (optional)" maxlength="500">
      <select id="nPri" aria-label="Priority"><option value="Now">🔴 Now</option><option value="Next">🟡 Next</option><option value="Later">🟢 Later</option></select>
      <button class="btn pri" id="nAdd">＋ Add</button></div>`;
    else if(isMgr())top=`<div class="add sh">
      <input id="nTitle" placeholder="Task for your team (Enter to assign)" maxlength="120">
      <input id="nDesc" placeholder="Details (optional)" maxlength="500">
      <select id="nPri" aria-label="Priority"><option value="Now">🔴 Now</option><option value="Next">🟡 Next</option><option value="Later">🟢 Later</option></select>
      <div class="full"><div class="sub" style="margin-bottom:4px"><b>Assign to:</b></div><div id="nPeople">${peopleBox(lastAssign)}</div></div>
      <button class="btn pri big full" id="nAdd">＋ Assign task</button></div>`;
    else top=`<div class="banner">👥 Tasks given to you by ${ME.hostNames.length?esc(ME.hostNames.join(', ')):'your supervisors'}. Tap <b>✔ Mark done</b> when your part is finished.</div>`;
    B.innerHTML=top+`<div class="cols">${['Now','Next','Later'].map(p=>{const l=sortAct(act.filter(t=>t.priority===p));
      return `<div class="col ${p}" data-p="${p}"><h3>${p} <small>${l.length}</small></h3><div class="list">${l.length?l.map(noteHTML).join(''):`<div class="empty">${shared&&!isMgr()?'Nothing assigned':'No sticky notes'}</div>`}</div></div>`}).join('')}</div>
      <div class="zones">${trashOK?'<div class="zone t" data-z="trash"><b>🗑</b>Trash</div>':''}<div class="zone c" data-z="done"><b>✔</b>${shared&&!isMgr()?'My part done':'Complete'}</div></div>`;
    $('#nAdd')&&($('#nAdd').onclick=addTask);$('#nTitle')&&($('#nTitle').onkeydown=e=>{if(e.key==='Enter')addTask()});
    wireDrag();
  }else{
    const l=L.filter(t=>t.state===view);
    B.innerHTML=l.length?l.map(t=>`<div class="item"><div><h4>${esc(t.title)}</h4><small>${esc(t.description)}${t.description?' · ':''}${t.priority}${shared?' · '+esc(t.assignees.map(a=>a.name).join(', ')):''}</small></div>
      <div class="nact">${listBtns(t)}</div></div>`).join('')
      :`<div class="empty">${view==='done'?'Nothing completed on this date yet 🎉':'Trash is empty ♻️'}</div>`;
  }
}
function listBtns(t){
  if(mode==='personal')return `<button data-a="restore" data-id="${t.id}">↩ Restore</button>`+(view==='done'?`<button data-a="trash" data-id="${t.id}">🗑 Trash</button>`:`<button data-a="erase" data-id="${t.id}">❌ Erase</button>`);
  if(view==='trash')return `<button data-a="srestore" data-id="${t.id}">↩ Restore</button><button data-a="serase" data-id="${t.id}">❌ Erase</button>`;
  return t.canManage?`<button data-a="sreopen" data-id="${t.id}">↩ Reopen</button><button data-a="strash" data-id="${t.id}">🗑 Trash</button>`:`<button data-a="sundo" data-id="${t.id}">↩ Undo</button>`;
}
function noteHTML(t){return mode==='personal'?pNote(t):sNote(t)}

/* ----- personal notes (saved as one board per user) ----- */
let saveQ=Promise.resolve();   // saves run one at a time so each carries the newest revision
function save(){clearTimeout(saveT);saveT=setTimeout(()=>{saveQ=saveQ.then(()=>api('/api/board','PUT',P).then(d=>{if(Number.isInteger(d.rev))P.rev=d.rev}).catch(async e=>{
  if(e.status===401)return location.replace('login.html');
  if(e.status===409)return reloadBoard(e.message);
  toast('⚠️ Not saved: '+friendly(e))}))},350)}
async function reloadBoard(msg){   // another device saved first: show its version instead of overwriting it
  const me=await currentUser();if(!me)return location.replace('login.html');
  P=me.board||{tasks:[],theme:'white'};if(!Array.isArray(P.tasks))P.tasks=[];P.rev=Number.isInteger(P.rev)?P.rev:0;
  editId=null;renderAll();toast('⚠️ '+msg);
}
function pNote(t){
  const edit=editId===t.id;
  return `<div class="note" draggable="${!edit}" data-id="${t.id}" style="background:${col(t.color)}"><div class="tape"></div>
  ${edit?`<input class="eT" value="${esc(t.title)}" maxlength="120"><textarea class="eD" rows="2" maxlength="500">${esc(t.description)}</textarea>
    <div class="nact"><button data-a="cancel">Cancel</button><span class="sp"></span><button data-a="save" data-id="${t.id}">💾 Save</button></div>`
  :`<h4>${esc(t.title)}</h4>${t.description?`<p>${esc(t.description)}</p>`:''}
    <div class="nact"><button data-a="pin" data-id="${t.id}">${t.pinned?'📌':'📍'}</button><button data-a="fav" data-id="${t.id}">${t.favorite?'⭐':'☆'}</button>
    <button data-a="edit" data-id="${t.id}">✏️</button><button data-a="mv" data-id="${t.id}" title="Move to ${NEXTP[t.priority]}">➡ ${NEXTP[t.priority]}</button><span class="sp"></span>
    <button data-a="done" data-id="${t.id}" title="Complete">✔</button><button data-a="trash" data-id="${t.id}" title="Trash">🗑</button></div>`}</div>`;
}
function addTask(){
  const title=$('#nTitle').value.trim();if(!title)return toast('Please type a task title!');
  if(mode==='shared')return addShared(title);
  const p=$('#nPri').value,pal=COLORS[p];
  P.tasks.push({id:'t'+Date.now(),date:openDate,title,description:$('#nDesc').value.trim(),priority:p,status:'active',pinned:false,favorite:false,color:pal[P.tasks.length%pal.length],created:todayStr()});
  save();toast('Note added');renderBoard();updateModeLabels();
}

/* ----- shared tasks (server is the source of truth) ----- */
function sNote(t){
  const edit=editId===t.id,drag=!edit&&(t.canManage||t.mine);
  if(edit)return `<div class="note" data-id="${t.id}" style="background:${col(t.color)}"><div class="tape"></div>
    <input class="eT" value="${esc(t.title)}" maxlength="120"><textarea class="eD" rows="2" maxlength="500">${esc(t.description)}</textarea>
    <select class="eP">${['Now','Next','Later'].map(p=>`<option${p===t.priority?' selected':''}>${p}</option>`).join('')}</select>
    <input class="eDt" type="date" value="${esc(t.date)}">
    <div class="eA">${peopleBox(t.assignees.map(a=>a.id),t.assignees)}</div>
    <div class="nact"><button data-a="scancel">Cancel</button><span class="sp"></span><button data-a="ssave" data-id="${t.id}">💾 Save</button></div></div>`;
  const n=t.assignees.length,dn=t.assignees.filter(a=>a.done).length;
  return `<div class="note" draggable="${drag}" data-id="${t.id}" style="background:${col(t.color)}"><div class="tape"></div>
    <h4>${esc(t.title)}</h4>${t.description?`<p>${esc(t.description)}</p>`:''}
    <div class="meta"><span>From <b>${esc(t.createdByName)}</b></span>${n>1?`<span>· ${dn}/${n} done</span>`:''}</div>
    <div class="meta">${t.assignees.map(a=>`<span class="who${a.done?' dn':''}">${a.done?'✔':'○'} ${esc(a.name)}</span>`).join('')}</div>
    <div class="nact">${t.mine&&!t.myDone?`<button class="go" data-a="sdone" data-id="${t.id}">✔ Mark done</button>`:''}<button class="share" data-a="sshare" data-id="${t.id}" title="Copy &amp; share on Messenger" aria-label="Share on Messenger">💬 Share</button>
    ${t.canManage?`<button data-a="spin" data-id="${t.id}">${t.pinned?'📌':'📍'}</button><button data-a="sedit" data-id="${t.id}">✏️</button><button data-a="smv" data-id="${t.id}" title="Move to ${NEXTP[t.priority]}">➡ ${NEXTP[t.priority]}</button><span class="sp"></span>
    <button data-a="sclose" data-id="${t.id}" title="Mark complete for everyone">✔ Close</button><button data-a="strash" data-id="${t.id}" title="Trash">🗑</button>`:''}</div></div>`;
}
const upsert=t=>{const i=SH.findIndex(x=>x.id===t.id);if(i<0)SH.push(t);else SH[i]=t};
async function call(path,method,body){
  try{return await api(path,method,body)}
  catch(e){if(e.status===401){location.replace('login.html');throw e}toast('⚠️ '+friendly(e));throw e}
}
async function addShared(title){
  const ids=picked($('#nPeople'));if(!ids.length)return toast('Pick at least one person to assign.');
  const btn=$('#nAdd');btn.disabled=true;
  try{
    const t=await call('/api/shared','POST',{title,description:$('#nDesc').value.trim(),priority:$('#nPri').value,date:openDate,assignees:ids});
    lastAssign=ids;upsert(t);toast('Task assigned to '+t.assignees.map(a=>a.name).join(', '));renderBoard();updateModeLabels();
  }catch(e){btn.disabled=false}
}
async function sUpdate(id,body,msg){
  try{const r=await call('/api/shared/'+id,'PUT',body);upsert(r);if(msg)toast(msg);editId=null;renderBoard();updateModeLabels()}catch(e){}
}
async function sClick(b,a){
  const id=b.dataset.id,t=find(id);
  if(a==='pall'){const r=b.closest('#nPeople')||b.closest('.eA');const bx=[...r.querySelectorAll('input')];const all=bx.every(i=>i.checked);bx.forEach(i=>i.checked=!all);return}
  if(a==='scancel'){editId=null;return renderBoard()}
  if(!t)return;
  if(a==='sedit'){editId=id;return renderBoard()}
  if(a==='ssave'){
    const n=b.closest('.note'),title=n.querySelector('.eT').value.trim(),ids=picked(n);
    if(!title)return toast('Title cannot be empty');if(!ids.length)return toast('Pick at least one person.');
    return sUpdate(id,{title,description:n.querySelector('.eD').value.trim(),priority:n.querySelector('.eP').value,date:n.querySelector('.eDt').value||t.date,assignees:ids},'Task updated');
  }
  if(a==='sshare')return shareTask(t);
  if(a==='spin')return sUpdate(id,{pinned:!t.pinned});
  if(a==='smv')return sUpdate(id,{priority:NEXTP[t.priority]},'Moved to '+NEXTP[t.priority]);
  if(a==='sdone')return sUpdate(id,{done:true},'Nice — marked done ✔');
  if(a==='sundo')return sUpdate(id,{done:false},'Moved back to the board');
  if(a==='sclose')return sUpdate(id,{done:true,all:true},'Closed for everyone ✔');
  if(a==='sreopen')return sUpdate(id,{done:false,all:true},'Reopened');
  if(a==='strash')return sUpdate(id,{status:'trash'},'Moved to Trash');
  if(a==='srestore')return sUpdate(id,{status:'active'},'Restored to board');
  if(a==='serase'){try{await call('/api/shared/'+id,'DELETE');SH=SH.filter(x=>x.id!==id);toast('Erased');renderBoard();updateModeLabels()}catch(e){}}
}
let lastShared=0;
async function refreshShared(){
  if(Date.now()-lastShared<15000)return;lastShared=Date.now();
  try{
    const r=await api('/api/shared');SH=r.tasks;
    if(openDate&&mode==='shared'&&(editId||/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&$('#modal').contains(document.activeElement))){renderCal();renderAgenda();updateModeLabels();return}
    renderAll();
  }catch(e){if(e.status===401)location.replace('login.html')}
}

/* ----- share a shared task to Facebook Messenger ----- */
function shareText(t){
  const [y,m,d]=t.date.split('-').map(Number);
  const due=new Date(y,m-1,d).toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const n=t.assignees.length,dn=t.assignees.filter(a=>a.done).length,icon={Now:'🔴',Next:'🟡',Later:'🟢'}[t.priority]||'⚪';
  const L=['📋 TASK ASSIGNMENT','━━━━━━━━━━━━━━',t.title];
  if(t.description)L.push('📝 '+t.description);
  L.push('','📅 Due: '+due,icon+' Priority: '+t.priority,'👤 Assigned by: '+t.createdByName,
    '👥 Assigned to:',...t.assignees.map(a=>(a.done?'  ✅ ':'  ⬜ ')+a.name),
    '📊 Progress: '+dn+'/'+n+' done','','— CrewCamp');
  return L.join('\n');
}
function copyText(txt){   // synchronous fallback works on http/older browsers; async API is tried first
  let ok=false;
  try{const ta=document.createElement('textarea');ta.value=txt;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.append(ta);ta.select();ta.setSelectionRange(0,txt.length);ok=document.execCommand('copy');ta.remove()}catch(e){}
  if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(txt).then(()=>true,()=>ok);
  return Promise.resolve(ok);
}
const isMobile=()=>/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&/Macintosh/.test(navigator.userAgent));
function shareTask(t){
  const txt=shareText(t),mobile=isMobile(),android=/Android/i.test(navigator.userAgent);
  const copied=copyText(txt);                       // starts inside the tap so the browser allows it
  if(!mobile){window.open('https://www.messenger.com/','_blank','noopener')}   // PC: Messenger website
  else if(navigator.share){                         // phone: native share sheet -> pick Messenger, text arrives pre-filled
    navigator.share({text:txt}).catch(e=>{if(!e||e.name!=='AbortError')location.href='https://m.me/'});
  }
  else{                                             // no share sheet support: try the Messenger app, then m.me
    let left=false;const onHide=()=>{if(document.hidden)left=true};
    document.addEventListener('visibilitychange',onHide);window.addEventListener('pagehide',onHide);
    location.href=android?'intent://#Intent;scheme=fb-messenger;package=com.facebook.orca;S.browser_fallback_url=https%3A%2F%2Fm.me%2F;end':'fb-messenger://';
    setTimeout(()=>{document.removeEventListener('visibilitychange',onHide);window.removeEventListener('pagehide',onHide);
      if(!left&&!document.hidden)location.href='https://m.me/'},2000);
  }
  copied.then(ok=>toast(ok?'📋 Copied! Open a chat in Messenger and paste':'⚠️ Could not copy — long-press the task text to copy it'));
}

/* ----- clicks inside the board ----- */
$('#bBody').onclick=e=>{
  const b=e.target.closest('[data-a]');if(!b)return;
  const a=b.dataset.a;
  if(a==='pall'||a[0]==='s'&&mode==='shared')return sClick(b,a);
  const t=find(b.dataset.id);
  if(a==='cancel'){editId=null}
  else if(!t)return;
  else if(a==='edit'){editId=t.id}
  else if(a==='save'){const n=b.closest('.note').querySelector('.eT').value.trim();if(!n)return toast('Title cannot be empty');
    t.title=n;t.description=b.closest('.note').querySelector('.eD').value.trim();editId=null}
  else if(a==='pin')t.pinned=!t.pinned;
  else if(a==='mv'){t.priority=NEXTP[t.priority];toast('Moved to '+t.priority)}
  else if(a==='fav')t.favorite=!t.favorite;
  else if(a==='done'){t.status='done';t.completed=todayStr();toast('Checked off ✔')}
  else if(a==='trash'){t.status='trash';toast('Moved to Trash')}
  else if(a==='restore'){t.status='active';toast('Restored to board')}
  else if(a==='erase'){P.tasks=P.tasks.filter(x=>x!==t);toast('Erased')}
  save();renderBoard();updateModeLabels();
};

/* ---------- drag & drop (columns, Complete, Trash) ---------- */
function wireDrag(){
  const B=$('#bBody');
  B.querySelectorAll('.note[draggable=true]').forEach(n=>{
    n.ondragstart=e=>{dragId=n.dataset.id;n.classList.add('drag');e.dataTransfer.setData('text/plain',dragId)};
    n.ondragend=()=>{n.classList.remove('drag');dragId=null};
  });
  B.querySelectorAll('.col,.zone').forEach(z=>{
    z.ondragover=e=>{e.preventDefault();z.classList.add('over')};
    z.ondragleave=()=>z.classList.remove('over');
    z.ondrop=e=>{e.preventDefault();z.classList.remove('over');
      const id=e.dataTransfer.getData('text/plain')||dragId,t=find(id);if(!t)return;
      if(mode==='shared'){
        if(z.dataset.z==='done'){if(t.canManage)sUpdate(id,{done:true,all:true},'Closed for everyone ✔');else if(t.mine)sUpdate(id,{done:true},'Nice — marked done ✔')}
        else if(!t.canManage)toast('Only supervisors can move tasks');
        else if(z.dataset.z==='trash')sUpdate(id,{status:'trash'},'Moved to Trash');
        else if(z.dataset.p!==t.priority)sUpdate(id,{priority:z.dataset.p},'Moved to '+z.dataset.p);
        return;
      }
      if(z.dataset.z==='done'){t.status='done';t.completed=todayStr();toast('Checked off ✔')}
      else if(z.dataset.z==='trash'){t.status='trash';toast('Moved to Trash')}
      else{t.priority=z.dataset.p;toast('Moved to '+t.priority)}
      save();renderBoard();updateModeLabels()};
  });
}

/* ---------- themes ---------- */
function setTheme(t){P.theme=t;localStorage.setItem('stb_theme',t);applyTheme(t);save()}
window.__cwSetTheme=setTheme;   // the server menu's Theme picker calls this on this page (keeps the personal board in sync)

/* ---------- change password ---------- */
let forced=false;
function openAcct(f){forced=!!f;$('#acctF').reset();$('#cpX').hidden=forced;$('#acctNote').textContent=forced?'An admin set a temporary password. Please choose your own to continue.':'Use at least 8 characters.';$('#acct').hidden=false;$('#cp0').focus()}
$('#acctBtn').onclick=()=>{$('#prof').hidden=true;openAcct(false)};
$('#cpX').onclick=()=>{$('#acct').hidden=true};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!forced&&!$('#acct').hidden)$('#acct').hidden=true});
$('#acctF').onsubmit=async e=>{
  e.preventDefault();
  if($('#cp1').value!==$('#cp2').value)return toast('New passwords do not match.');
  try{await api('/api/change-password','POST',{currentPassword:$('#cp0').value,newPassword:$('#cp1').value});forced=false;$('#acct').hidden=true;toast('Password changed ✔')}
  catch(x){toast('⚠️ '+friendly(x))}
};

/* ---------- profile picture (one change per 15 days; enforced by the server too) ---------- */
const initials=n=>String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';
function avatarEl(cls){
  const d=document.createElement('span');d.className='av '+(cls||'');
  const fall=()=>{d.textContent=initials(ME.name||ME.username)};
  if(ME.avatarAt){const i=new Image();i.alt='';i.src='/api/avatar?v='+ME.avatarAt;i.onerror=fall;d.append(i)}else fall();
  return d;
}
function renderWho(){
  $('#who').innerHTML='';
  $('#who').append(avatarEl('sm'));
  $('#who').insertAdjacentHTML('beforeend',`<b style="font-size:.85rem">${esc(ME.name||ME.username)}</b><span class="role">${ROLE[ME.role]}</span>`);
}
let newPic=null;
const fmtDate=ms=>new Date(ms).toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Manila'});
function renderProf(){
  const big=$('#avBig');big.innerHTML='';
  if(newPic){const i=new Image();i.alt='New photo preview';i.src=newPic;big.append(i)}else big.append(avatarEl('lg'));
  $('#profName').textContent=ME.name||ME.username;
  $('#profSub').textContent='@'+ME.username;   // profile is global: no server-specific role here
  const left=ME.avatarAt?ME.avatarNext-Date.now():0,locked=left>0;
  $('#avPick').disabled=locked;
  $('#avSave').disabled=locked||!newPic;
  $('#avNote').textContent=locked
    ?`🔒 You changed your photo recently. You can change it again on ${fmtDate(ME.avatarNext)} (${Math.ceil(left/864e5)} day${Math.ceil(left/864e5)===1?'':'s'} left).`
    :(ME.avatarAt?'You can change your photo now. After saving, it locks for 15 days.':'Add a photo. After saving, you can change it once every 15 days.');
}
let myPosts=null;
function openProf(){$('#hideProf').checked=!!ME.profileHidden;newPic=null;$('#avFile').value='';renderProf();$('#prof').hidden=false;
  if(myPosts)myPosts.destroy();myPosts=window.__cwP?window.__cwP.mount($('#profPosts'),ME.id,{focusReply:false}):null}   // posts.js (Threads-style posts on your profile)
window.openProfile=openProf;   // called from the server rail (servers.js)
if(/[?&]profile=1/.test(location.search)){history.replaceState(null,'',location.pathname);let n=0;const t=setInterval(()=>{if(ME.id||++n>50){clearInterval(t);if(ME.id)openProf()}},100)}
$('#hideProf').onchange=async e=>{
  const want=e.target.checked;e.target.disabled=true;
  try{const r=await api('/api/profile-visibility','POST',{hidden:want});ME.profileHidden=r.profileHidden;toast(want?'Profile hidden from other users':'Profile visible to other users')}
  catch(x){e.target.checked=!want;toast('⚠️ '+friendly(x))}
  e.target.disabled=false;
};
$('#profX').onclick=()=>{$('#prof').hidden=true};
$('#prof').addEventListener('click',e=>{if(e.target.id==='prof')$('#prof').hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#prof').hidden)$('#prof').hidden=true});
$('#avPick').onclick=()=>$('#avFile').click();
$('#avFile').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  if(!/^image\/(jpeg|png|webp)$/.test(f.type))return toast('Please choose a JPG, PNG or WebP image.');
  try{
    const bmp=await createImageBitmap(f),S=256,c=document.createElement('canvas');c.width=c.height=S;
    const k=Math.min(bmp.width,bmp.height),sx=(bmp.width-k)/2,sy=(bmp.height-k)/2,x=c.getContext('2d');   // centre-crop to a square
    x.fillStyle='#fff';x.fillRect(0,0,S,S);x.drawImage(bmp,sx,sy,k,k,0,0,S,S);
    newPic=c.toDataURL('image/jpeg',.85);renderProf();
  }catch(x){toast('⚠️ Could not read that image.')}
};
$('#avSave').onclick=async()=>{
  if(!newPic)return;const b=$('#avSave');b.disabled=true;
  try{
    const r=await api('/api/avatar','POST',{image:newPic});
    ME.avatarAt=r.avatarAt;ME.avatarNext=r.avatarNext;newPic=null;
    renderWho();renderProf();toast('Profile picture updated ✔');
  }catch(x){toast('⚠️ '+friendly(x));if(x.status===429)api('/api/me').then(d=>{ME=d.user;renderProf()}).catch(()=>{});renderProf()}
};

/* ---------- boot ---------- */
(async()=>{
  const me=await currentUser();if(!me)return location.replace('login.html');
  ME=me.user;P=me.board||{tasks:[],theme:'white'};if(!Array.isArray(P.tasks))P.tasks=[];P.rev=Number.isInteger(P.rev)?P.rev:0;
  if(P.theme&&P.theme!==(localStorage.getItem('stb_theme')||'white')){localStorage.setItem('stb_theme',P.theme);applyTheme(P.theme)}
  renderWho();
  $('#usersLink').hidden=ME.role!=='admin';
  try{
    const [s,p]=await Promise.all([api('/api/shared'),isMgr()?api('/api/people'):Promise.resolve({people:[]})]);
    SH=s.tasks;PEOPLE=p.people;
  }catch(e){if(e.status===401)return location.replace('login.html');toast('⚠️ Could not load shared tasks: '+friendly(e))}
  $('#fil').innerHTML='<option value="all">Everyone</option>'+PEOPLE.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  // Staff with no personal history but with tasks waiting → open Shared first time
  if(!localStorage.getItem('stb_mode')&&!isMgr()&&SH.some(t=>sState(t)==='active'))mode='shared';
  setMode(mode);
  const od=sessionStorage.getItem('stb_open');   // set by a notification click in the server menu: open that task's date
  if(od){sessionStorage.removeItem('stb_open');if(/^\d{4}-\d{2}-\d{2}$/.test(od)){const [y,m]=od.split('-').map(Number);vy=y;vm=m-1;renderCal();openBoard(od)}}
  if(ME.mustChange)openAcct(true);
  // keep Shared fresh: every 60s while visible, and when returning to the tab
  setInterval(()=>{if(!document.hidden)refreshShared()},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshShared()});
})();
