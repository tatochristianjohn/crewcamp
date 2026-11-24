/* CrewCamp Games > Chess client. Like ChessLAN: the browser only draws the server's FEN + legal_moves and sends moves; the server (netlify/functions/chess-engine.mjs) decides everything. */
(function(){
const $=s=>document.querySelector(s),esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FILES='abcdefgh',RANKS='87654321',GLY={k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const REASON={checkmate:'Checkmate',stalemate:'Stalemate, draw',insufficient_material:'Draw, insufficient material',seventyfive_move_rule:'Draw, 75-move rule',fivefold_repetition:'Draw, fivefold repetition',fifty_move_rule:'Draw, 50-move rule',threefold_repetition:'Draw, threefold repetition',resignation:'Resignation',agreement:'Draw by agreement',timeout:'Time out',aborted:'Game aborted, no one moved'};
let chatKey='',G=null,sel=null,gid=null,snapAt=0,pend=null,busy=false,ME=null,timer=null,rv=null,flipped=false,lastN=-1,lastId='',opt=null,pollSeq=0,mute=localStorage.getItem('cc_chess_mute')==='1';
const tc=g=>g.minutes+(g.inc?'+'+g.inc:'')+' min';
const fmt=ms=>{const t=Math.max(0,Math.ceil(ms/1000));return Math.floor(t/60)+':'+String(t%60).padStart(2,'0')};
const toast=m=>{const t=$('#toast');if(!t)return;t.innerHTML='<div>'+esc(m)+'</div>';clearTimeout(toast.t);toast.t=setTimeout(()=>{t.innerHTML=''},2600)};
const fenMap=fen=>{const m={};fen.split(' ')[0].split('/').forEach((row,ri)=>{let f=0;for(const ch of row){if(/\d/.test(ch))f+=+ch;else{m[FILES[f]+(8-ri)]=ch;f++}}});return m};

/* ---------- lobby ---------- */
async function lobby(){
  if(gid)return;
  try{
    const d=await api('/api/chess/lobby');
    $('#open').innerHTML=d.open.length?d.open.map(g=>`<li class="gm-item"><span><b>${esc(g.host)}</b> <small>${g.rematch?'rematch · ':g.challenge?'challenge · ':''}plays ${esc(g.color)} · ${tc(g)}</small></span><button class="btn pri" data-join="${g.id}" type="button">Join</button></li>`).join(''):'<li class="gm-empty">No open tables. Open one and wait for someone to join.</li>';
    $('#mine').innerHTML=d.mine.length?d.mine.map(g=>`<li class="gm-item"><span>${g.status==='waiting'?'Waiting for opponent':'vs <b>'+esc(g.vs||'')+'</b>'} <small>${tc(g)}</small></span><button class="btn" data-open="${g.id}" type="button">${g.status==='waiting'?'View':'Resume'}</button></li>`).join(''):'<li class="gm-empty">No games in progress.</li>';
    $('#live').innerHTML=(d.live||[]).length?d.live.map(g=>`<li class="gm-item"><span><b>${esc(g.white||'')}</b> vs <b>${esc(g.black||'')}</b> <small>${tc(g)}</small></span><button class="btn" data-open="${g.id}" type="button">Watch</button></li>`).join(''):'<li class="gm-empty">No games to watch right now.</li>';
  }catch(e){if(e.status===401)return location.replace('login.html')}
}
$('#nwGo').onclick=async()=>{$('#nwErr').textContent='';try{const d=await api('/api/chess/new','POST',{minutes:+$('#nwMin').value,inc:+$('#nwInc').value,color:$('#nwCol').value,to:$('#nwTo').value||undefined});openGame(d.game.id)}catch(e){$('#nwErr').textContent=e.message}};
document.addEventListener('click',async e=>{
  const j=e.target.closest('[data-join]'),o=e.target.closest('[data-open]');
  if(j){try{const d=await api('/api/chess/join','POST',{id:j.dataset.join});openGame(d.game.id)}catch(x){toast(x.message);lobby()}}
  if(o)openGame(o.dataset.open);
});

async function friendsPick(){
  try{const d=await api('/api/friends'),sel=$('#nwTo'),keep=sel.value;
    sel.innerHTML='<option value="">Anyone (open table)</option>'+d.friends.map(f=>`<option value="${esc(f.id)}">Friend: ${esc(f.name)}</option>`).join('');
    if(keep&&d.friends.some(f=>f.id===keep))sel.value=keep}catch(e){}
}
/* ---------- game view ---------- */
function openGame(id){gid=id;G=null;sel=null;rv=null;flipped=false;lastN=-1;lastId='';chatKey='';$('#chatL').innerHTML='';location.hash=id;$('#lobby').hidden=true;$('#play').hidden=false;$('#err').textContent='';poll()}
function closeGame(){gid=null;G=null;sel=null;history.replaceState(null,'',location.pathname);$('#play').hidden=true;$('#lobby').hidden=false;lobby()}
$('#back').onclick=closeGame;
$('#resign').onclick=async()=>{if(!confirm('Resign this game?'))return;try{set((await api('/api/chess/resign','POST',{id:gid})).game)}catch(e){$('#err').textContent=e.message}};
$('#draw').onclick=async()=>{try{set((await api('/api/chess/draw','POST',{id:gid,action:'offer'})).game)}catch(e){$('#err').textContent=e.message;toast(e.message)}};
for(const [id,a] of [['#drAcc','accept'],['#drDec','decline']])$(id).onclick=async()=>{try{set((await api('/api/chess/draw','POST',{id:gid,action:a})).game)}catch(e){$('#err').textContent=e.message;toast(e.message)}};
$('#cancel').onclick=async()=>{try{await api('/api/chess/cancel','POST',{id:gid});closeGame()}catch(e){$('#err').textContent=e.message}};
/* Long-poll: the request carries the rev we already have; the server answers the instant the game changes (or after ~6 s), so the opponent's move shows up in well under a second. */
async function poll(){
  clearTimeout(timer);if(!gid)return;
  const my=++pollSeq,id=gid,rev=G&&G.id===id?G.rev:0;
  try{const d=await api('/api/chess/game?id='+id+(rev?'&since='+rev+'&wait=1':''));if(my!==pollSeq||gid!==id)return;if(!busy)set(d.game)}
  catch(e){if(my!==pollSeq)return;if(e.status===401)return location.replace('login.html');if(e.status===404||e.status===403){toast(e.message);return closeGame()}timer=setTimeout(poll,2000);return}
  if(gid)timer=setTimeout(poll,document.hidden?1500:100);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&gid)poll()});
function set(g){G=g;snapAt=Date.now();if(!g.legal_moves.some(m=>sel&&m.startsWith(sel)))sel=null;render()}

function build(){
  const b=$('#board'),flip=isFlip(),fs=flip?[...FILES].reverse():[...FILES],rs=flip?[...RANKS].reverse():[...RANKS];b.innerHTML='';
  rs.forEach((r,ri)=>fs.forEach((f,fi)=>{const sq=f+r,d=document.createElement('div');d.className='gm-sq '+((FILES.indexOf(f)+RANKS.indexOf(r))%2?'d':'l');d.dataset.sq=sq;d.tabIndex=0;d.setAttribute('role','gridcell');
    if(ri===7||fi===7){const c=document.createElement('span');c.className='co';c.textContent=ri===7?f:r;d.append(c)}b.append(d)}));
  b.dataset.flip=flip;
}
function render(){
  if(!G)return;
  const b=$('#board');if(!b.children.length||b.dataset.flip!==String(isFlip()))build();
  const live=rv===null||rv>=G.moves.length,pm=live?withOpt(fenMap(G.fen)):fenMap(G.places[rv]+' w'),lm=live?(opt?{from:opt.from,to:opt.to}:G.last_move):(rv>0?{from:G.moves[rv-1].uci.slice(0,2),to:G.moves[rv-1].uci.slice(2,4)}:null);
  b.classList.toggle('rv',!live);
  b.querySelectorAll('.gm-sq').forEach(el=>{
    const sq=el.dataset.sq;el.classList.toggle('last',!!lm&&(sq===lm.from||sq===lm.to));el.classList.toggle('sel',sel===sq);el.classList.toggle('chk',live&&G.in_check_square===sq);
    el.querySelectorAll('.pc,.dot,.ring').forEach(x=>x.remove());
    const p=pm[sq];if(p){const s=document.createElement('span');s.className='pc '+(p===p.toUpperCase()?'w':'b');s.textContent=GLY[p.toLowerCase()];el.append(s)}
    if(live&&sel&&G.legal_moves.some(m=>m.startsWith(sel)&&m.slice(2,4)===sq)){const m=document.createElement('span');m.className=p?'ring':'dot';el.append(m)}
  });
  const mc=G.my_color,top=mc==='black'?'white':'black',bot=mc==='black'?'black':'white',nm=c=>G[c]?G[c].name:'Waiting for opponent…';
  $('#topN').textContent=nm(top);$('#botN').textContent=nm(bot);
  for(const [id,c] of [['#topN',top],['#botN',bot]]){const e=$(id);e.classList.toggle('on',!!(G.online&&G.online[c]&&G[c]));e.classList.toggle('off',!!(G.online&&!G.online[c]&&G[c]));e.title=G.online&&G[c]?(G.online[c]?'Online':'Away'):''}$('#topC').textContent=top+(G.inc?' · +'+G.inc+'s':'');$('#botC').textContent=bot+(mc?' (you)':'');
  $('#topS').classList.toggle('turn',G.status==='active'&&G.turn===top);$('#botS').classList.toggle('turn',G.status==='active'&&G.turn===bot);
  let s;if(G.status==='waiting')s='Waiting for an opponent to join…';
  else if(G.status==='finished')s=(G.winner?(G.winner==='white'?'White':'Black')+' wins. ':'')+(REASON[G.result_reason]||G.result_reason||'Game over');
  else s=!mc?'Spectating':G.turn===mc&&!opt?'Your move':'Opponent is thinking…';
  const st=$('#stat');st.textContent=s;st.classList.toggle('end',G.status==='finished');
  const act=G.status==='active'&&mc,dr=G.draw;
  $('#resign').hidden=!act;$('#draw').hidden=!act||!!dr;$('#draw').textContent='Offer draw';
  $('#drB').hidden=!(act&&dr);if(act&&dr){$('#drT').textContent=dr.by_me?'Draw offered. Waiting for your opponent…':'Your opponent offers a draw.';$('#drAcc').hidden=$('#drDec').hidden=dr.by_me}
$('#cancel').hidden=G.status!=='waiting';
  $('#capW').textContent=G.captured.white.map(t=>GLY[t]).join(' ')||'';$('#capB').textContent=G.captured.black.map(t=>GLY[t]).join(' ')||'';
  $('#capW').title='White pieces taken';$('#capB').title='Black pieces taken';
  let h='';for(let i=0;i<G.moves.length;i+=2){const cur=rv===null?G.moves.length:rv,mb=(k,m)=>m?`<span class="mvb${cur===k+1?' cur':''}" data-ply="${k+1}">${esc(m.san)}</span>`:'<span></span>';h+=`<span class="n">${i/2+1}.</span>${mb(i,G.moves[i])}${mb(i+1,G.moves[i+1])}`}
  const mv=$('#mv');mv.innerHTML=h;if(rv===null)mv.scrollTop=mv.scrollHeight;else{const c=mv.querySelector('.cur');if(c)c.scrollIntoView({block:'nearest'})}
  announce();
  const done=G.status==='finished'&&mc&&G.white&&G.black&&G.result_reason!=='cancelled',rm=$('#rematch');rm.hidden=!done;
  if(done){const r=G.rematch;rm.textContent=!r?'Rematch':r.by_me?'Open rematch table':'Accept rematch'}
  const both=!!(G.white&&G.black),cc=$('#chatC');cc.hidden=!both;$('#chatR').hidden=!mc;
  if(both){const k=G.id+':'+G.chat.length+':'+(G.chat.length?G.chat[G.chat.length-1].t:0);
    if(k!==chatKey){const l=$('#chatL'),atEnd=l.scrollHeight-l.scrollTop-l.clientHeight<40||!chatKey;chatKey=k;
      l.innerHTML=G.chat.length?G.chat.map(c=>`<div class="m${c.mine?' me':''}">${c.mine?'':'<small>'+esc(c.name)+'</small>'}${esc(c.text)}</div>`).join(''):'<div class="gm-empty">No messages yet.</div>';
      if(atEnd)l.scrollTop=l.scrollHeight}}
  clocks();
}
function clocks(){
  if(!G)return;let w=G.white_time_ms,b=G.black_time_ms;const tn=opt?(G.my_color==='white'?'black':'white'):G.turn;
  if(G.status==='active'){const el=Date.now()-snapAt;if(tn==='white')w=Math.max(0,w-el);else b=Math.max(0,b-el)}
  const top=G.my_color==='black'?'white':'black',v={white:w,black:b};
  for(const [id,c] of [['#topK',top],['#botK',top==='white'?'black':'white']]){const e=$(id);e.textContent=fmt(v[c]);e.classList.toggle('low',G.status==='active'&&v[c]<15000)}
  if(G.status==='active'&&(tn==='white'?w:b)<=0&&!clocks.p){clocks.p=1;poll();setTimeout(()=>clocks.p=0,2000)}   // someone flagged: ask the server to settle it
}
setInterval(clocks,250);

$('#rematch').onclick=async()=>{$('#err').textContent='';try{const d=await api('/api/chess/rematch','POST',{id:gid});openGame(d.game.id)}catch(e){$('#err').textContent=e.message;toast(e.message)}};
async function say(){const i=$('#chatI'),t=i.value.trim();if(!t||!gid)return;i.value='';try{set((await api('/api/chess/chat','POST',{id:gid,text:t})).game)}catch(e){i.value=t;toast(e.message)}}
$('#chatS').onclick=say;$('#chatI').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();say()}});

/* ---------- interaction ---------- */
$('#board').addEventListener('click',e=>{if(noClick)return;const el=e.target.closest('.gm-sq');if(el)tap(el.dataset.sq)});
$('#board').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const el=e.target.closest('.gm-sq');if(el){e.preventDefault();tap(el.dataset.sq)}}});
function tap(sq){
  if(!G||G.status!=='active'||G.turn!==G.my_color||rv!==null||opt)return;
  const pm=fenMap(G.fen),p=pm[sq],mine=p&&((p===p.toUpperCase())===(G.my_color==='white'));
  if(sel&&sel!==sq&&G.legal_moves.some(m=>m.startsWith(sel)&&m.slice(2,4)===sq)){
    const pawn=pm[sel]&&pm[sel].toLowerCase()==='p'&&(sq[1]==='8'||sq[1]==='1');
    if(pawn){pend={from:sel,to:sq};$('#promo').hidden=false;return}
    return send(sel,sq);
  }
  sel=mine?sq:null;render();
}
document.querySelectorAll('#promo [data-p]').forEach(b=>b.onclick=()=>{if(!pend)return;const m=pend;pend=null;$('#promo').hidden=true;send(m.from,m.to,b.dataset.p)});
$('#promo').onclick=e=>{if(e.target.id==='promo'){pend=null;$('#promo').hidden=true}};
function withOpt(pm){   // show my move on the board at once; the server's answer replaces it a moment later
  if(!opt)return pm;const {from,to,promo}=opt,p=pm[from];if(!p)return pm;
  const m={...pm},t=p.toLowerCase();delete m[from];
  if(t==='k'&&Math.abs(FILES.indexOf(to[0])-FILES.indexOf(from[0]))===2){const r=from[1],ks=to[0]==='g',rf=(ks?'h':'a')+r,rt=(ks?'f':'d')+r;if(m[rf]){m[rt]=m[rf];delete m[rf]}}
  if(t==='p'&&from[0]!==to[0]&&!pm[to])delete m[to[0]+from[1]];
  m[to]=promo?(p===p.toUpperCase()?promo.toUpperCase():promo.toLowerCase()):p;return m;
}
async function send(from,to,promotion){
  const cap=!!fenMap(G.fen)[to];
  busy=true;sel=null;$('#err').textContent='';opt={from,to,promo:promotion};sfx(cap?'cap':'move');lastN=G.moves.length+1;render();
  try{const d=await api('/api/chess/move','POST',{id:gid,from,to,promotion});opt=null;set(d.game)}
  catch(e){opt=null;lastN=G.moves.length;render();$('#err').textContent=e.message;toast(e.message)}
  finally{busy=false;poll()}
}


/* ---------- PGN ---------- */
function pgn(){
  const r=G.status!=='finished'?'*':G.winner?(G.winner==='white'?'1-0':'0-1'):(G.result_reason==='aborted'?'*':'1/2-1/2'),d=new Date().toISOString().slice(0,10).replace(/-/g,'.');
  const hd=[['Event','CrewCamp casual'],['Site','CrewCamp'],['Date',d],['White',G.white?G.white.name:'?'],['Black',G.black?G.black.name:'?'],['Result',r],['TimeControl',G.minutes*60+(G.inc?'+'+G.inc:'')]].map(([k,v])=>`[${k} "${String(v).replace(/"/g,"'")}"]`).join('\n');
  let t='';G.moves.forEach((m,i)=>{t+=(i%2?'':(i/2+1)+'. ')+m.san+' '});
  return hd+'\n\n'+t+r+'\n';
}
$('#pgn').onclick=async()=>{if(!G)return;const t=pgn();try{await navigator.clipboard.writeText(t);toast('PGN copied')}catch(e){const a=document.createElement('textarea');a.value=t;document.body.append(a);a.select();try{document.execCommand('copy');toast('PGN copied')}catch(x){toast('Could not copy')}a.remove()}};

/* ---------- drag and drop (tap-to-move still works) ---------- */
let drag=null,noClick=false;
$('#board').addEventListener('pointerdown',e=>{
  if(e.button>0||!G||G.status!=='active'||G.turn!==G.my_color||rv!==null||opt)return;
  const el=e.target.closest('.gm-sq');if(!el)return;const p=fenMap(G.fen)[el.dataset.sq];
  if(!p||((p===p.toUpperCase())!==(G.my_color==='white')))return;
  drag={sq:el.dataset.sq,x:e.clientX,y:e.clientY,on:false,id:e.pointerId,ghost:null};
});
window.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;
  if(!drag.on){if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6)return;
    const src=document.querySelector('.gm-sq[data-sq="'+drag.sq+'"] .pc');if(!src){drag=null;return}
    drag.on=true;sel=drag.sq;render();
    const s2=document.querySelector('.gm-sq[data-sq="'+drag.sq+'"] .pc'),r=s2.getBoundingClientRect(),g=s2.cloneNode(true);
    g.classList.add('drag');g.style.width=g.style.height=r.width+'px';g.style.fontSize=getComputedStyle(s2).fontSize;document.body.append(g);drag.ghost=g;s2.style.opacity='.25'}
  e.preventDefault();drag.ghost.style.left=e.clientX+'px';drag.ghost.style.top=e.clientY+'px';
},{passive:false});
const endDrag=e=>{
  if(!drag||(e&&e.pointerId!==drag.id))return;const d=drag;drag=null;
  if(!d.on)return;if(d.ghost)d.ghost.remove();noClick=true;setTimeout(()=>noClick=false,0);
  const t=e&&e.type==='pointerup'?document.elementFromPoint(e.clientX,e.clientY):null,el=t&&t.closest&&t.closest('.gm-sq');
  if(el&&el.dataset.sq!==d.sq){sel=d.sq;tap(el.dataset.sq)}else render();
};
window.addEventListener('pointerup',endDrag);window.addEventListener('pointercancel',endDrag);

/* ---------- flip, review, sound ---------- */
function isFlip(){return (G.my_color==='black')!==flipped}
$('#flip').onclick=()=>{flipped=!flipped;render()};
function goto(n){if(!G)return;const max=G.moves.length;n=Math.max(0,Math.min(max,n));rv=n>=max?null:n;render()}
$('#rvF').onclick=()=>goto(0);$('#rvP').onclick=()=>goto((rv===null?G.moves.length:rv)-1);$('#rvN').onclick=()=>goto((rv===null?G.moves.length:rv)+1);$('#rvL').onclick=()=>goto(1e9);
$('#mv').addEventListener('click',e=>{const b=e.target.closest('[data-ply]');if(b)goto(+b.dataset.ply)});
document.addEventListener('keydown',e=>{if(!gid||!G||/INPUT|SELECT|TEXTAREA/.test((e.target.tagName||'')))return;
  if(e.key==='ArrowLeft'){e.preventDefault();$('#rvP').click()}else if(e.key==='ArrowRight'){e.preventDefault();$('#rvN').click()}
  else if(e.key==='ArrowUp'){e.preventDefault();goto(0)}else if(e.key==='ArrowDown'){e.preventDefault();goto(1e9)}});
let ac=null;
function beep(f,d,t,v){try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();const o=ac.createOscillator(),g=ac.createGain(),n=ac.currentTime+(t||0);o.type='triangle';o.frequency.value=f;g.gain.setValueAtTime(v||.08,n);g.gain.exponentialRampToValueAtTime(.0001,n+d);o.connect(g);g.connect(ac.destination);o.start(n);o.stop(n+d)}catch(e){}}
function sfx(kind){if(mute)return;if(kind==='end'){beep(523,.18);beep(392,.3,.16)}else if(kind==='check'){beep(880,.12);beep(740,.14,.1)}else if(kind==='cap'){beep(220,.12,0,.12)}else beep(330,.08)}
function announce(){
  if(lastId!==G.id){lastId=G.id;lastN=G.moves.length;announce.st=G.status;return}
  if(G.moves.length>lastN){const san=G.moves[G.moves.length-1].san;sfx(G.status==='finished'?'end':/[+#]/.test(san)?'check':san.includes('x')?'cap':'move')}
  else if(G.status==='finished'&&announce.st==='active')sfx('end');   // resign, flag, draw
  lastN=G.moves.length;announce.st=G.status;
}
function sndLabel(){const b=$('#snd');b.textContent='Sound: '+(mute?'off':'on');b.setAttribute('aria-pressed',String(!mute))}
$('#snd').onclick=()=>{mute=!mute;try{localStorage.setItem('cc_chess_mute',mute?'1':'0')}catch(e){}sndLabel();if(!mute)beep(440,.08)};sndLabel();

window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(/^[a-f0-9]{10}$/.test(h)&&h!==gid)openGame(h)});
/* ---------- boot ---------- */
(async()=>{
  const me=await currentUser();if(!me)return location.replace('login.html');ME=me.user;
  const n=ME.name||ME.username,ini=String(n).trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?',av=document.createElement('span');av.className='av sm';
  if(ME.avatarAt){const i=new Image();i.alt='';i.src='/api/avatar?v='+ME.avatarAt;i.onerror=()=>{i.remove();av.textContent=ini};av.append(i)}else av.textContent=ini;
  $('#who').append(av);$('#who').insertAdjacentHTML('beforeend',`<b style="font-size:.85rem">${esc(n)}</b>`);
  friendsPick();const h=location.hash.slice(1);if(/^[a-f0-9]{10}$/.test(h))openGame(h);else lobby();
  setInterval(()=>{if(!document.hidden&&!gid)lobby()},4000);
})();
})();
