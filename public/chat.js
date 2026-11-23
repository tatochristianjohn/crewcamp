/* CrewCamp group chat — a floating dock in the bottom-right corner (Facebook style) with Discord-style content:
   channels, flat messages, a "who's online" member list. Drag the chat window and the member list pops out.
   Needs auth.js (api helper + theme). No websockets on Netlify, so it polls; the rates are in POLL below (each poll is one
   function call, so lower rates = lighter Netlify usage). While a conversation is live (a message or typing in the last HOT_MS)
   the open chat polls every POLL.hot instead of POLL.open, so replies show up in ~2 s; once things go quiet it drops back to the slow rate. */
(() => {
  if (window.__cw || /login\.html$/.test(location.pathname)) return;
  window.__cw = 1;

  const $ = s => root.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: just don't remember */ } },
  };
  const isMobile = () => matchMedia('(max-width:700px)').matches;
  const POLL = { open: 5000, hot: 2000, minimized: 30000, hidden: 60000 };   // ms between polls: chat open · dock minimized · browser tab in the background
  const HOT_MS = 45000;   // how long after the last message/typing the fast rate stays on
  const GROUPS = [['admin', 'Heads'], ['host', 'Supervisors'], ['staff', 'Staff']];
  /* The chat belongs to ONE server at a time. On a server page it is that server. On the Cross-server Calendar there is still only
     this single chat window: a header chip names its server and (if you are in several) lets you switch, so chat boxes never pile up. */
  const CROSS = document.body.hasAttribute('data-cross');
  const PAGE_SV = localStorage.getItem('stb_sv') || 'cepalco';
  const seenKey = sv => sv === 'cepalco' ? 'cw_seen' : 'cw_seen_' + sv;
  const chKey = sv => sv === PAGE_SV ? 'cw_ch' : 'cw_ch_' + sv;
  const SV0 = CROSS ? (LS.get('cw_sv', PAGE_SV) || PAGE_SV) : PAGE_SV;
  const SEEN_KEY0 = seenKey(SV0);
  //   // what I have read is remembered per server (channel names like #general exist in every server)

  /* ---------- state ---------- */
  const S = {
    sv: SV0, svs: [], open: LS.get('cw_open', false), ch: LS.get(chKey(SV0), 'general'), members: false,
    me: null, hot: 1e9, avs: {}, channels: [], msgs: [], rev: -1, loaded: false, online: [], offline: 0, seen: LS.get(SEEN_KEY0, {}),
    edit: null, pos: LS.get('cw_pos', null), lastType: 0, err: false,
    up: false, fresh: localStorage.getItem(SEEN_KEY0) === null,   // brand-new browser: existing messages start as "read"
  };
  const capi = (p, m, b) => api(p, m, b, S.sv);   // every group-chat call is made inside the chat's own server
  let busy = false, fails = 0, timer = 0, sending = false, noteT = 0, drag = null, sigM = '', sigC = '';

  /* ---------- DOM ---------- */
  const root = document.createElement('div');
  root.className = 'cw';
  root.innerHTML = `
<button class="cw-pill" id="cwPill" type="button" aria-label="Open group chat" title="Click to open · drag to move"><span aria-hidden="true">💬</span><span class="cw-pn" id="cwPn">Group chat</span><span class="cw-live" id="cwLive" hidden></span><span class="cw-pcall" id="cwPCall" hidden title="Call in progress" aria-label="Call in progress">📹</span><em class="cw-badge" id="cwBadge" hidden></em></button>
<section class="cw-win" id="cwWin" role="dialog" aria-label="Group chat" hidden>
  <header class="cw-head" id="cwHead" title="Drag to move · double-click to put it back">
    <div class="cw-title"><b id="cwTitle"># general</b><small id="cwSub">Connecting…</small></div>
    <button class="cw-ib" id="cwMem" type="button" aria-label="Who is online" aria-expanded="false" aria-controls="cwMembers" title="Who is online">👥</button>
    <button class="cw-ib cw-frb" id="cwFrBtn" type="button" aria-label="Friends and private messages" title="Friends &amp; private messages">✉️<em class="cw-badge" id="cwFrB" hidden></em></button>
    <button class="cw-ib" id="cwCall" type="button" aria-label="Start a video call in this channel" title="Video call (opens in a new tab)">📹 <span style="font-size:.7rem;font-weight:800">Call</span></button>
    <button class="cw-ib" id="cwMin" type="button" aria-label="Minimize chat" title="Minimize">—</button>
  </header>
  <div class="cw-svbar"><button class="cw-svchip" id="cwSv" type="button" aria-haspopup="listbox" aria-expanded="false" title="Server this chat belongs to"></button><div class="cw-svmenu" id="cwSvMenu" role="listbox" aria-label="Choose a server's chat" hidden></div></div>
  <nav class="cw-chans" id="cwChans" aria-label="Channels"></nav>
  <div class="cw-callbar" id="cwCallBar" role="status" hidden></div>
  <div class="cw-log" id="cwLog" role="log" aria-live="polite" tabindex="0"></div>
  <div class="cw-typing" id="cwTyping" aria-live="polite"></div>
  <div class="cw-edit" id="cwEdit" hidden><span>✎ Editing your message</span><button type="button" id="cwEditX">Cancel</button></div>
  <div class="cw-emo" id="cwEmo" role="group" aria-label="Emoji" hidden>${["🙂","😂","👍","🙏","❤️","🎉","👀","✅","🔥","😅","🤝","💡"].map(e=>`<button type="button" aria-label="${e}">${e}</button>`).join("")}</div>
  <form class="cw-form" id="cwForm"><button class="cw-emob cw-attb" id="cwAttBtn" type="button" aria-label="Attach a file (disappears after 15 minutes)" title="Attach a file · disappears after 15 minutes">📎</button><input type="file" id="cwFile" hidden><button class="cw-emob" id="cwEmoBtn" type="button" aria-label="Add emoji" aria-expanded="false" title="Emoji">🙂</button><textarea id="cwText" rows="1" maxlength="1000" placeholder="Message" aria-label="Message"></textarea><button class="btn pri cw-send" type="submit" aria-label="Send message">➤</button></form>
</section>
<aside class="cw-mem" id="cwMembers" aria-label="Online now" hidden></aside>`;
  document.body.append(root);
  document.body.classList.add('cw-on');
  const win = $('#cwWin'), mem = $('#cwMembers'), log = $('#cwLog'), ta = $('#cwText');

  /* ---------- emoji picker ---------- */
  const emo = $('#cwEmo'), emoBtn = $('#cwEmoBtn');
  emoBtn.onclick = () => { emo.hidden = !emo.hidden; emoBtn.setAttribute('aria-expanded', String(!emo.hidden)); };
  emo.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s;
    ta.value = ta.value.slice(0, s) + b.textContent + ta.value.slice(en);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + b.textContent.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /* ---------- helpers ---------- */
  const tf = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
  const df = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' });
  const dl = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' });
  const dayLabel = ts => { const k = df.format(ts); return k === df.format(Date.now()) ? 'Today' : k === df.format(Date.now() - 864e5) ? 'Yesterday' : dl.format(ts); };
  const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const link = t => esc(t).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);

  function avatar(u) {
    const d = document.createElement('span');
    d.className = 'av sm';
    d.style.background = `hsl(${hue(u.id)} 52% 40%)`; d.style.color = '#fff';
    d.textContent = String(u.name || '?').trim().split(/\s+/).slice(0, 2).map(w => [...w][0]).join('').toUpperCase() || '?';
    const at = (S.avs && S.avs[u.id]) || u.avatarAt;   // newest photo version known, not the one baked into an old message
    if (at) { const i = new Image(); i.alt = ''; i.onload = () => { d.textContent = ''; d.append(i); }; i.src = '/api/avatar/' + encodeURIComponent(u.id) + '?v=' + at; }
    return d;
  }
  /* ---------- file attachments (group chat + private messages; friends.js reuses these through __cwCore) ----------
     Built to be light on Netlify: pictures are shrunk here first (max 1280 px, WebP/JPEG, usually 80-300 KB), other files are capped at 1 MB,
     the bytes go up raw (no base64), a picture is downloaded once per browser (kept as an object URL), and polls only carry a few bytes of
     metadata. Every file expires 15 minutes after it was shared: the server refuses it and deletes it, and this page swaps it for "expired". */
  const ATT_MAX = 1024 * 1024, IMG_GOAL = 280 * 1024, IMG_SIDE = 1280;
  const sizeTxt = n => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const attBlobs = new Map(), attBusy = new Set();     // id -> object URL · ids being fetched right now
  const leftTxt = ms => ms >= 60000 ? Math.ceil(ms / 60000) + ' min left' : Math.max(1, Math.ceil(ms / 1000)) + ' s left';
  const attGone = a => `<div class="cw-att gone"><span aria-hidden="true">🕒</span><span class="cw-attn">${esc(a.name)}<small>Expired · removed after 15 minutes</small></span></div>`;
  function attHtml(a) {
    if (!a) return '';
    if (a.gone || a.exp <= Date.now()) return attGone(a);
    const sub = `${sizeTxt(a.size)} · <b class="cw-att-t" data-exp="${a.exp}">${leftTxt(a.exp - Date.now())}</b>`;
    if (a.img) { const u = attBlobs.get(a.id); return `<div class="cw-att img${u ? '' : ' loading'}" data-att="${esc(a.id)}" data-exp="${a.exp}" data-name="${esc(a.name)}"><button type="button" class="cw-attimg" data-a="attopen" aria-label="Open picture ${esc(a.name)}"><img alt="${esc(a.name)}"${u ? ` src="${u}"` : ''} loading="lazy"></button><small>${sub}</small></div>`; }
    return `<a class="cw-att file" href="/api/attach/${esc(a.id)}" download="${esc(a.name)}" data-att="${esc(a.id)}" data-exp="${a.exp}" rel="noopener"><span aria-hidden="true">📎</span><span class="cw-attn">${esc(a.name)}<small>${sub}</small></span></a>`;
  }
  async function attLoad(id) {                          // fetch a picture once, then show it from memory
    if (attBlobs.has(id) || attBusy.has(id)) return;
    attBusy.add(id);
    let ok = false;
    try { const r = await fetch('/api/attach/' + id, { credentials: 'same-origin' }); if (r.ok) { attBlobs.set(id, URL.createObjectURL(await r.blob())); ok = true; } }
    catch (e) { /* offline: leave the placeholder */ }
    attBusy.delete(id);
    document.querySelectorAll(`.cw-att[data-att="${id}"]`).forEach(el => {
      if (!el.classList.contains('img')) return;
      if (ok) { el.classList.remove('loading'); el.querySelector('img').src = attBlobs.get(id); } else { el.classList.remove('loading'); el.classList.add('bad'); el.querySelector('small').textContent = 'Could not load this picture (it may have expired).'; }
    });
  }
  const attHydrate = el => el.querySelectorAll('.cw-att.img.loading').forEach(x => attLoad(x.dataset.att));
  function attTick() {                                  // countdown labels; swap in "expired" the moment time is up
    if (document.hidden) return;
    const now = Date.now();
    document.querySelectorAll('.cw-att[data-exp]').forEach(el => {
      const left = Number(el.dataset.exp) - now;
      if (left <= 0) { const u = attBlobs.get(el.dataset.att); if (u) { URL.revokeObjectURL(u); attBlobs.delete(el.dataset.att); } el.outerHTML = attGone({ name: el.dataset.name || (el.querySelector('.cw-attn') ? el.querySelector('.cw-attn').firstChild.textContent : 'File') }); }
      else { const t = el.querySelector('.cw-att-t'); if (t) t.textContent = leftTxt(left); }
    });
  }
  setInterval(attTick, 5000);
  document.addEventListener('visibilitychange', attTick);
  const enc = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
  async function shrink(file) {                         // picture -> small WebP/JPEG
    const bmp = await createImageBitmap(file);
    let side = IMG_SIDE, q = .78, type = 'image/webp', out = null;
    for (let i = 0; i < 8; i++) {
      const k = Math.min(1, side / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      const g = c.getContext('2d'); if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(bmp, 0, 0, c.width, c.height);
      out = await enc(c, type, q);
      if (out && type === 'image/webp' && out.type !== 'image/webp') { type = 'image/jpeg'; i--; continue; }   // this browser cannot write WebP
      if (!out) throw new Error('shrink failed');
      if (out.size <= IMG_GOAL) break;
      q -= .12; if (q < .45) { side = Math.round(side * .8); q = .7; }
    }
    if (bmp.close) bmp.close();
    if (file.size <= out.size && file.size <= ATT_MAX && /^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, name: file.name };   // already smaller: keep the original
    return { blob: out, name: file.name.replace(/\.[^.]*$/, '') + (out.type === 'image/webp' ? '.webp' : '.jpg') };
  }
  async function attPrepare(file) {
    const pic = /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|heic|heif|bmp|avif)$/i.test(file.name);
    if (pic && !(file.type === 'image/gif' && file.size <= ATT_MAX)) { try { return await shrink(file); } catch (e) { /* not readable as a picture here: send it as a plain file if it is small enough */ } }
    if (file.size > ATT_MAX) throw new Error('File too big (max 1 MB; pictures are shrunk for you).');
    return { blob: file, name: file.name };
  }
  async function attSend(file, target, caption, sv) {   // target = { ch } or { to }; returns the new message
    const { blob, name } = await attPrepare(file);
    const q = new URLSearchParams({ name }); if (target.to) q.set('to', target.to); else q.set('ch', target.ch);
    if (caption) q.set('text', caption.slice(0, 300));
    const h = { 'Content-Type': 'application/octet-stream' }, v = sv || localStorage.getItem('stb_sv');
    if (v && v !== 'cepalco') h['X-Server'] = v;
    let r; try { r = await fetch('/api/attach?' + q, { method: 'POST', headers: h, body: blob, credentials: 'same-origin' }); }
    catch (e) { const x = new Error('You seem to be offline. Check your connection and try again.'); x.status = 0; throw x; }
    let d = {}; try { d = await r.json(); } catch (e) { /* no body */ }
    if (!r.ok) { const x = new Error(d.error || 'Could not send the file.'); x.status = r.status; throw x; }
    return d;
  }
  document.addEventListener('click', e => {             // tap a picture: open the full-size copy in a new tab
    const b = e.target.closest('.cw-attimg'); if (!b) return;
    const el = b.closest('.cw-att'), u = attBlobs.get(el.dataset.att);
    if (u) window.open(u, '_blank', 'noopener');
  });

  /* ---------- profile viewer (anyone, online or offline; hidden profiles show the name only) ---------- */
  const RL = { admin: 'Head', host: 'Supervisor', staff: 'Staff' };
  const ago = ts => { const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 90) return 'just now'; const m = s / 60; if (m < 60) return Math.round(m) + ' min ago'; const h = m / 60; if (h < 24) return Math.round(h) + ' h ago'; return Math.round(h / 24) + ' day(s) ago'; };
  const pdate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00+08:00').toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : '';
  let pv = null;
  function closeProfile() { if (pv) { pv.remove(); pv = null; } }
  async function openProfile(id) {
    closeProfile();
    pv = document.createElement('div'); pv.className = 'overlay cw-pv'; pv.style.zIndex = 60;
    pv.innerHTML = '<div class="panel dlg profdlg" role="dialog" aria-modal="true" aria-label="Profile"><div class="profcard"><p class="sub">Loading…</p></div></div>';
    pv.addEventListener('click', e => { if (e.target === pv) closeProfile(); });
    document.body.append(pv);
    let d; try { d = await api('/api/profile/' + encodeURIComponent(id)); } catch (x) { pv.firstChild.innerHTML = `<h2>Profile</h2><p class="sub">${esc(friendly(x) || 'Could not load profile.')}</p><button class="btn" type="button" data-x>Close</button>`; pv.querySelector('[data-x]').onclick = closeProfile; return; }
    const big = document.createElement('div'); big.className = 'avbig';
    const fall = document.createElement('span'); fall.className = 'av lg'; fall.style.background = `hsl(${hue(d.id)} 52% 40%)`; fall.style.color = '#fff';
    fall.textContent = String(d.name || '?').trim().split(/\s+/).slice(0, 2).map(w => [...w][0]).join('').toUpperCase() || '?'; big.append(fall);
    if (!d.hidden && d.avatarAt) { const i = new Image(); i.alt = ''; i.onload = () => { big.textContent = ''; big.append(i); }; i.src = '/api/avatar/' + encodeURIComponent(d.id) + '?v=' + d.avatarAt; }
    const status = d.online ? '<span class="pv-st on"><i class="cw-dot"></i>Online</span>' : '<span class="pv-st">Offline</span>';
    let rows = '';
    if (d.hidden) rows = '<p class="sub pv-hid">🔒 This person has hidden their profile.</p>';
    else {
      rows += `<dl class="pv-dl"><dt>Username</dt><dd>@${esc(d.username)}</dd>`;
      if (!d.online && d.lastSeen) rows += `<dt>Last seen</dt><dd>${ago(d.lastSeen)}</dd>`;
      if (pdate(d.created)) rows += `<dt>Member since</dt><dd>${pdate(d.created)}</dd>`;
      rows += '</dl>';
    }
    if (d.hiddenByUser && (d.mine || !d.hidden)) rows += `<p class="sub pv-hid">${d.mine ? 'Your profile is hidden from others.' : '🔒 Hidden from other users (you can see it as a Head).'}</p>`;
    const card = pv.firstChild; card.innerHTML = '';
    const pc = document.createElement('div'); pc.className = 'profcard'; pc.append(big);
    pc.insertAdjacentHTML('beforeend', `<b>${esc(d.name)}${d.mine ? ' <span class="cw-you">you</span>' : ''}</b>${status}`);
    card.append(pc); card.insertAdjacentHTML('beforeend', rows);
    if (window.__cwF && !d.mine && d.friend) card.append(window.__cwF.profileRow(d.id, d.friend, { reload: () => openProfile(id), close: closeProfile }));   // Add friend / Accept / Message ... (friends.js)
    if (!d.hidden && window.__cwP) { const ph = document.createElement('div'); card.append(ph); window.__cwP.mount(ph, d.id, { focusReply: false }); }   // Threads-style posts (posts.js)
    card.insertAdjacentHTML('beforeend', '<button class="btn" type="button" data-x>Close</button>');
    card.querySelector('[data-x]').onclick = closeProfile; card.querySelector('[data-x]').focus();
  }
  addEventListener('keydown', e => { if (e.key === 'Escape' && pv) { closeProfile(); e.stopPropagation(); } }, true);
  function note(msg) {                       // short error line above the composer
    const t = $('#cwTyping'); t.textContent = msg; t.classList.add('err');
    clearTimeout(noteT); noteT = setTimeout(() => { t.classList.remove('err'); renderTyping(); }, 3500);
  }

  /* ---------- render ---------- */
  const unreadOf = c => (S.open && !document.hidden && c.id === S.ch) ? 0 : c.unread;
  function renderPill() {
    const n = S.channels.reduce((a, c) => a + unreadOf(c), 0), b = $('#cwBadge'), l = $('#cwLive');
    b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
    $('#cwPCall').hidden = !S.channels.some(c => c.call);   // a call is running somewhere in this chat
    window.dispatchEvent(new CustomEvent('cw:unread', { detail: { n, sv: S.sv } }));   // the server rail shows the same count on this server's icon
    $('#cwPill').setAttribute('aria-label', 'Open group chat of ' + svName() + (n ? ', ' + n + ' unread' : ''));
    $('#cwPn').textContent = CROSS || S.svs.length > 1 ? svName() : 'Group chat'; $('#cwPill').title = svName() + ' · click to open · drag to move';
    l.hidden = !S.me; l.innerHTML = `<i class="cw-dot"></i>${S.online.length}`; l.title = S.online.length + ' online';
  }
  const svInfo = id => S.svs.find(x => x.id === (id || S.sv));
  const svName = id => { const x = svInfo(id); return x ? x.name : (S.sv === 'cepalco' ? 'CEPALCO Server' : 'Server'); };
  const svIcon = id => id === 'cepalco' ? '<i class="cw-svi" style="background:#000;color:#facc15">CE</i>' : `<i class="cw-svi" style="background:hsl(${hue(id)} 55% 45%)">${esc((String(svName(id)).match(/[A-Za-z0-9]/g) || ['?']).slice(0, 2).join('').toUpperCase())}</i>`;
  const unreadSv = id => id === S.sv ? S.channels.reduce((a, c) => a + unreadOf(c), 0) : ((window.__svUnread && window.__svUnread()[id]) || 0);
  function renderSv() {                      // header chip = which server this chat box belongs to
    const chip = $('#cwSv'), multi = CROSS && S.svs.length > 1;
    chip.innerHTML = svIcon() + `<span class="cw-svn">${esc(svName())}</span>` + (multi ? '<span class="cw-svc" aria-hidden="true">▾</span>' : '');
    chip.classList.toggle('multi', multi); chip.disabled = !multi; chip.setAttribute('aria-label', 'Chat of server ' + svName() + (multi ? '. Choose another server' : ''));
    const menu = $('#cwSvMenu');
    if (!multi) { menu.hidden = true; chip.setAttribute('aria-expanded', 'false'); return; }
    menu.innerHTML = S.svs.map(x => { const u = unreadSv(x.id); return `<button type="button" role="option" class="cw-svo${x.id === S.sv ? ' on' : ''}" data-sv="${esc(x.id)}" aria-selected="${x.id === S.sv}">${svIcon(x.id)}<span class="cw-svn">${esc(x.name)}</span>${u ? `<em class="cw-badge">${u > 99 ? '99+' : u}</em>` : ''}</button>`; }).join('');
  }
  async function loadServers() {
    try {
      const c = JSON.parse(sessionStorage.getItem('stb_svl') || 'null');
      S.svs = (c && Date.now() - c.t < 20000 ? c.d : await api('/api/servers')).servers || [];
    } catch (e) { S.svs = []; }
    if (S.svs.length && !S.svs.some(x => x.id === S.sv)) { setServer(PAGE_SV !== S.sv && S.svs.some(x => x.id === PAGE_SV) ? PAGE_SV : 'cepalco', true); }
    renderAll();
  }
  function setServer(id, quiet) {            // switch THE chat (not a new one) to another server
    if (id === S.sv && !quiet) return;
    S.sv = id; LS.set('cw_sv', id);
    S.ch = LS.get(chKey(id), 'general'); S.rev = -1; S.msgs = []; S.loaded = false; S.channels = []; S.online = []; S.offUsers = []; S.offline = 0; S.me = null; S.avs = {};
    S.seen = LS.get(seenKey(id), {}); S.fresh = localStorage.getItem(seenKey(id)) === null;
    cancelEdit(); sigC = ''; sigM = ''; $('#cwSvMenu').hidden = true; $('#cwSv').setAttribute('aria-expanded', 'false');
    if (quiet) return;
    renderAll(); renderLog(true); schedule(0);
  }
  function renderHead() {
    renderSv();
    const cur = S.channels.find(c => c.id === S.ch);
    $('#cwTitle').textContent = (cur && cur.tag ? '🔒 ' : '') + '# ' + S.ch;
    $('#cwSub').innerHTML = S.err ? 'Reconnecting…' : S.me ? `<i class="cw-dot"></i>${S.online.length} online` : 'Connecting…';
    ta.placeholder = 'Message #' + S.ch;
  }
  function renderChans() {
    const sig = JSON.stringify([S.ch, S.me && S.me.role, S.channels.map(c => [c.id, unreadOf(c), c.tag, !!c.call])]);
    if (sig === sigC) return; sigC = sig;
    const admin = S.me && S.me.role === 'admin', curTag = (S.channels.find(c => c.id === S.ch) || {}).tag;   // a role's channel is removed by deleting the role, not here
    $('#cwChans').innerHTML = S.channels.map(c => { const u = unreadOf(c);
      return `<button type="button" class="cw-ch${c.id === S.ch ? ' on' : ''}" data-ch="${esc(c.id)}" aria-pressed="${c.id === S.ch}"${c.tag ? ' title="Private: only people with this role can see it"' : ''}>${c.tag ? '🔒 ' : ''}# ${esc(c.name)}${c.call ? '<i class="cw-cv" title="Call in progress" aria-hidden="true">📹</i>' : ''}${u ? `<em class="cw-badge">${u}</em>` : ''}</button>`; }).join('')
      + (admin ? '<button type="button" class="cw-ch ghost" data-a="add" title="Add a channel" aria-label="Add a channel">＋</button>' : '')
      + (admin && S.ch !== 'general' && !curTag ? '<button type="button" class="cw-ch ghost" data-a="rm" title="Remove this channel" aria-label="Remove this channel">🗑</button>' : '');
  }
  function renderTyping() {
    const t = $('#cwTyping'); if (t.classList.contains('err') || S.up) return;
    const n = S.online.filter(u => u.typing).map(u => u.name.split(' ')[0]);
    t.textContent = !n.length ? '' : n.length === 1 ? n[0] + ' is typing…' : n.length === 2 ? n[0] + ' and ' + n[1] + ' are typing…' : 'Several people are typing…';
  }
  function renderLog(stick) {
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
    let h = '', day = '', prev = null;
    if (!S.loaded) h = '<p class="cw-empty">Loading…</p>';
    else if (!S.msgs.length) h = `<p class="cw-empty"><b>Welcome to #${esc(S.ch)}</b>Nothing here yet. Say hi 👋</p>`;
    S.msgs.forEach((m, i) => {
      const d = df.format(m.ts);
      if (d !== day) { h += `<div class="cw-day"><span>${dayLabel(m.ts)}</span></div>`; day = d; prev = null; }
      const grp = prev && prev.uid === m.uid && m.ts - prev.ts < 3e5;
      h += `<div class="cw-msg${grp ? ' grp' : ''}${m.mine ? ' mine' : ''}" data-id="${esc(m.id)}" tabindex="0">`
        + (grp ? `<span class="cw-gt">${tf.format(m.ts)}</span>` : `<span class="cw-av" data-i="${i}"></span>`)
        + `<div class="cw-body">${grp ? '' : `<div class="cw-meta"><b class="cw-nm r-${esc(m.role)}">${esc(m.name)}</b><time>${tf.format(m.ts)}</time></div>`}`
        + (m.text || !m.att ? `<div class="cw-tx">${link(m.text)}${m.edited ? '<i class="cw-ed">(edited)</i>' : ''}</div>` : '') + attHtml(m.att) + '</div>'
        + (m.mine || m.canDel ? `<span class="cw-act">${m.mine ? '<button type="button" data-a="edit" title="Edit" aria-label="Edit message">✎</button>' : ''}${m.canDel ? '<button type="button" data-a="del" title="Delete" aria-label="Delete message">🗑</button>' : ''}</span>` : '')
        + '</div>';
      prev = m;
    });
    log.className = 'cw-log' + (S.msgs.length ? ' has' : '');
    log.innerHTML = h;
    log.querySelectorAll('.cw-av').forEach(el => { const m = S.msgs[el.dataset.i]; el.replaceWith(avatar({ id: m.uid, name: m.name, avatarAt: m.avatarAt })); });   // a message's own id is NOT the sender's id: pass the sender (uid) or the photo URL 404s and only initials show
    attHydrate(log);
    if (stick || near) log.scrollTop = log.scrollHeight;
  }
  function renderMembers() {
    const sig = JSON.stringify([S.me && S.me.id, S.online.map(u => [u.id, u.typing, (S.avs && S.avs[u.id]) || u.avatarAt]), S.offline, (S.offUsers || []).map(u => [u.id, (S.avs && S.avs[u.id]) || u.avatarAt])]);
    if (sig === sigM) return; sigM = sig;
    let h = `<div class="cw-mh"><b>Online now</b><button class="cw-ib" type="button" data-a="closem" aria-label="Close list" title="Close">×</button></div>`;
    h += `<h4>Online — ${S.online.length}</h4>`;
    if (!S.online.length) h += '<p class="cw-none">Nobody yet.</p>';
    const idx = [];
    GROUPS.forEach(([r, label]) => {
      const g = S.online.filter(u => u.role === r); if (!g.length) return;
      h += `<h4>${label} — ${g.length}</h4>`;
      g.forEach(u => { idx.push(u); h += `<div class="cw-row" data-pid="${esc(u.id)}" role="button" tabindex="0" title="View profile"><span class="cw-st" data-i="${idx.length - 1}"></span><b>${esc(u.name)}</b>${S.me && u.id === S.me.id ? '<span class="cw-you">you</span>' : ''}${u.typing ? '<span class="cw-dots" title="typing"><i></i><i></i><i></i></span>' : ''}</div>`; });
    });
    h += `<h4>Offline — ${S.offline}</h4>`;
    if (!S.offline) h += '<p class="cw-none">Everyone is online.</p>';
    GROUPS.forEach(([r]) => (S.offUsers || []).filter(u => u.role === r).forEach(u => {
      idx.push(u); h += `<div class="cw-row off" data-pid="${esc(u.id)}" role="button" tabindex="0" title="View profile"><span class="cw-st" data-i="${idx.length - 1}"></span><b>${esc(u.name)}</b></div>`;
    }));
    mem.innerHTML = h;
    mem.querySelectorAll('.cw-st').forEach(el => el.append(avatar(idx[el.dataset.i])));
  }
  /* small "Call in progress · since 3:42 PM · 2 in call  [Join]" line under the channels (for the channel being viewed) */
  let sigCall = '';
  function renderCall() {
    const bar = $('#cwCallBar'), cur = S.channels.find(c => c.id === S.ch), k = cur && cur.call;
    const sig = k ? [S.ch, k.n, k.since, k.me].join() : '';
    if (sig === sigCall) return; sigCall = sig;
    bar.hidden = !k; if (!k) { bar.textContent = ''; return; }
    bar.innerHTML = `<i class="cw-cdot" aria-hidden="true"></i><span><b>Call in progress</b> · since ${tf.format(k.since)} · ${k.n} in call</span>` + (k.me ? '<em>you’re in</em>' : '<button type="button" class="cw-cjoin" data-a="joincall">Join</button>');
  }
  $('#cwCallBar').addEventListener('click', e => {
    const cur = S.channels.find(c => c.id === S.ch);
    if (e.target.closest('[data-a=joincall]')) startCall('ch=' + encodeURIComponent(S.ch), S.sv, cur && cur.call && cur.call.since);
  });
  const renderAll = () => { renderPill(); renderHead(); renderChans(); renderCall(); renderTyping(); renderMembers(); if (window.__cwF) window.__cwF.layout(); };

  /* ---------- window: open / minimize / position ---------- */
  function applyPos() {
    if (!S.pos || isMobile()) { win.classList.remove('moved'); win.style.left = win.style.top = ''; return placeMembers(); }
    const r = win.getBoundingClientRect(), w = r.width || 340, h = r.height || 520;
    S.pos = { x: Math.min(Math.max(8, S.pos.x), Math.max(8, innerWidth - w - 8)), y: Math.min(Math.max(8, S.pos.y), Math.max(8, innerHeight - h - 8)) };
    win.classList.add('moved'); win.style.left = S.pos.x + 'px'; win.style.top = S.pos.y + 'px';
    placeMembers();
  }
  function placeMembers() {                  // the member list docks beside the chat window, on whichever side has room
    if (mem.hidden) return;
    if (isMobile()) { mem.style.left = mem.style.top = mem.style.height = ''; return; }
    const r = win.getBoundingClientRect(), w = mem.offsetWidth || 232;
    let x = r.left - w - 10;
    if (x < 8) x = r.right + 10;
    if (x + w > innerWidth - 8) x = Math.max(8, innerWidth - w - 8);
    mem.style.left = x + 'px'; mem.style.top = r.top + 'px'; mem.style.height = r.height + 'px';
  }
  function setMembers(on) {
    S.members = on; mem.hidden = !on; $('#cwMem').setAttribute('aria-expanded', on);
    if (on) { renderMembers(); placeMembers(); }
  }
  function setOpen(on, focus) {
    S.open = on; LS.set('cw_open', on);
    win.hidden = !on; $('#cwPill').hidden = on;
    if (!on) { setMembers(false); cancelEdit(); }
    else { applyPos(); if (focus && !isMobile()) ta.focus(); log.scrollTop = log.scrollHeight; }
    renderAll(); schedule(on ? 0 : undefined);
  }
  function setPos(x, y) { S.pos = { x, y }; applyPos(); }

  /* ---------- drag the window → the online list pops out ---------- */
  const head = $('#cwHead');
  head.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button') || isMobile()) return;
    const r = win.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY, moved: false };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;      // a click is not a drag
      drag.moved = true; root.classList.add('dragging'); document.body.classList.add('cw-drag');
      setMembers(true);
    }
    setPos(e.clientX - drag.dx, e.clientY - drag.dy);
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) LS.set('cw_pos', S.pos);
    root.classList.remove('dragging'); document.body.classList.remove('cw-drag'); drag = null;
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);
  head.addEventListener('dblclick', e => { if (e.target.closest('button')) return; S.pos = null; LS.set('cw_pos', null); applyPos(); });
  addEventListener('resize', applyPos);

  /* ---------- polling ---------- */
  const delay = () => { const d = delay0(); return callLive() && d > 25000 ? 25000 : d; };   // in a call the tab is in the background: keep telling the server I am still in it
  const delay0 = () => fails ? Math.min(30000, 4000 * 2 ** Math.min(fails, 3)) : document.hidden ? POLL.hidden : (S.open || (window.__cwF && window.__cwF.active())) ? (S.hot < HOT_MS ? POLL.hot : POLL.open) : POLL.minimized;
  function schedule(ms) { clearTimeout(timer); if (S.none) return; timer = setTimeout(poll, ms == null ? delay() : ms); }
  async function poll() {
    if (S.none) return;
    if (busy) return;
    busy = true; clearTimeout(timer);
    const q = new URLSearchParams();
    if (S.open) { q.set('ch', S.ch); q.set('rev', S.rev); }
    const seen = Object.entries(S.seen).map(([k, v]) => k + ':' + v).join(',');
    if (seen) q.set('seen', seen);
    if (S.open && Date.now() - S.lastType < 5000) q.set('typing', S.ch);
    const cp = callParams(S.sv); if (cp) for (const k in cp) q.set(k, cp[k]);   // I am in a video call (auth.js)
    const fx = window.__cwF && window.__cwF.params(); if (fx) for (const k in fx) q.set(k, fx[k]);   // private conversations that are open + what was read (friends.js)
    try { const d = await capi('/api/chat?' + q); fails = 0; S.err = false; apply(d); }
    catch (e) { if (e.status === 401) return location.replace('login.html'); fails++; S.err = true; renderHead(); }
    finally { busy = false; schedule(); }
  }
  function apply(d) {
    const avChanged = JSON.stringify(d.avs || {}) !== JSON.stringify(S.avs);
    S.avs = d.avs || {};
    S.hot = typeof d.hot === 'number' ? d.hot : 1e9;
    S.me = d.me; S.channels = d.channels; S.online = d.online; S.offline = d.offline; S.offUsers = d.offUsers || [];
    d.channels.forEach(c => { if (S.seen[c.id] == null) S.seen[c.id] = S.fresh ? c.last : 0; });   // new browser: all read · channel created later: everything in it is unread
    S.fresh = false;
    if (!d.channels.some(c => c.id === S.ch)) { S.ch = d.channels[0].id; S.rev = -1; S.msgs = []; S.loaded = false; LS.set(chKey(S.sv), S.ch); }   // my channel was removed
    if (S.open && d.ch === S.ch && d.msgs) { S.msgs = d.msgs; S.rev = d.rev; S.loaded = true; renderLog(); }
    else if (S.open && S.loaded && avChanged) renderLog();   // someone's photo changed: redraw the avatars
    if (S.open && S.loaded && !document.hidden) {
      const c = d.channels.find(x => x.id === S.ch);
      if (c && S.seen[c.id] !== c.last) { S.seen[c.id] = c.last; }
    }
    LS.set(seenKey(S.sv), S.seen);
    try { if (window.__cwF) window.__cwF.apply(d); } catch (e) { console.error(e); }   // friends + private messages ride on the same poll
    renderAll();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderAll(); schedule(0); } });

  /* ---------- actions ---------- */
  function switchTo(id) {
    if (id === S.ch) return;
    S.ch = id; LS.set(chKey(S.sv), id); S.rev = -1; S.msgs = []; S.loaded = false; cancelEdit();
    sigC = ''; renderAll(); renderLog(true); schedule(0);
  }
  function cancelEdit() { S.edit = null; $('#cwEdit').hidden = true; if (ta.value && ta.dataset.edit) ta.value = ''; delete ta.dataset.edit; autosize(); }
  function startEdit(id) {
    const m = S.msgs.find(x => x.id === id); if (!m || !m.mine) return;
    S.edit = id; ta.dataset.edit = 1; ta.value = m.text; $('#cwEdit').hidden = false; autosize(); ta.focus();
  }
  async function send() {
    const text = ta.value.trim(); if (!text || sending) return;
    sending = true;
    try {
      if (S.edit) {
        const m = await capi(`/api/chat/msg/${encodeURIComponent(S.edit)}?ch=${encodeURIComponent(S.ch)}`, 'PUT', { text });
        const i = S.msgs.findIndex(x => x.id === S.edit); if (i >= 0) S.msgs[i] = m;
        cancelEdit(); ta.value = '';
      } else {
        const ch = S.ch, m = await capi('/api/chat/send', 'POST', { ch, text });
        if (ch === S.ch && !S.msgs.some(x => x.id === m.id)) S.msgs.push(m);   // a poll may already have brought it in
        ta.value = '';
      }
      S.hot = 0; autosize(); renderLog(true); schedule(1500);
    } catch (e) { if (e.status === 401) return location.replace('login.html'); note(e.message); }
    finally { sending = false; }
  }
  async function sendFile(file) {
    if (!file || sending) return;
    sending = true; S.up = true;
    const t = $('#cwTyping'); t.classList.remove('err'); t.textContent = '⏫ Sending ' + file.name + '…';
    try {
      const ch = S.ch, caption = S.edit ? '' : ta.value.trim(), m = await attSend(file, { ch }, caption, S.sv);
      if (ch === S.ch && !S.msgs.some(x => x.id === m.id)) S.msgs.push(m);
      if (caption) { ta.value = ''; autosize(); }
      S.up = false; t.textContent = ''; S.hot = 0; renderLog(true); schedule(1500);
    } catch (e) { S.up = false; if (e.status === 401) return location.replace('login.html'); note(e.message); }
    finally { sending = false; S.up = false; }
  }
  async function del(id) {
    if (!confirm('Delete this message for everyone?')) return;
    try { await capi(`/api/chat/msg/${encodeURIComponent(id)}?ch=${encodeURIComponent(S.ch)}`, 'DELETE'); S.msgs = S.msgs.filter(x => x.id !== id); if (S.edit === id) cancelEdit(); renderLog(); schedule(1500); }
    catch (e) { note(e.message); }
  }
  async function addChannel() {
    const name = prompt('New channel name (letters, numbers, dashes):'); if (!name) return;
    try { const r = await capi('/api/chat/channels', 'POST', { name }); switchTo(r.id); schedule(0); } catch (e) { note(e.message); }
  }
  async function rmChannel() {
    if (!confirm(`Remove #${S.ch} and all its messages for everyone?`)) return;
    const id = S.ch;
    try { await capi('/api/chat/channels/' + encodeURIComponent(id), 'DELETE'); S.channels = S.channels.filter(c => c.id !== id); switchTo('general'); } catch (e) { note(e.message); }
  }
  function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'; }

  /* ---------- events ---------- */
  /* pill: drag it anywhere (remembered); a plain click opens the chat */
  const pill = $('#cwPill'); let pd = null, pMoved = false;
  const placePill = () => {
    const P = LS.get('cw_pill', null);
    if (!P || isMobile()) { pill.style.left = pill.style.top = ''; pill.style.right = pill.style.bottom = ''; return; }
    const x = Math.min(Math.max(8, P.x), Math.max(8, innerWidth - pill.offsetWidth - 8)), y = Math.min(Math.max(8, P.y), Math.max(8, innerHeight - pill.offsetHeight - 8));
    pill.style.left = x + 'px'; pill.style.top = y + 'px'; pill.style.right = pill.style.bottom = 'auto';
  };
  pill.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const r = pill.getBoundingClientRect(); pd = { dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY }; pMoved = false;
    pill.setPointerCapture(e.pointerId);
  });
  pill.addEventListener('pointermove', e => {
    if (!pd) return;
    if (!pMoved && Math.hypot(e.clientX - pd.x, e.clientY - pd.y) < 6) return;
    pMoved = true; pill.classList.add('drag');
    pill.style.left = Math.min(Math.max(8, e.clientX - pd.dx), innerWidth - pill.offsetWidth - 8) + 'px';
    pill.style.top = Math.min(Math.max(8, e.clientY - pd.dy), innerHeight - pill.offsetHeight - 8) + 'px';
    pill.style.right = pill.style.bottom = 'auto';
  });
  const endPill = () => { if (!pd) return; if (pMoved) LS.set('cw_pill', { x: parseFloat(pill.style.left), y: parseFloat(pill.style.top) }); pill.classList.remove('drag'); pd = null; };
  pill.addEventListener('pointerup', endPill); pill.addEventListener('pointercancel', endPill);
  pill.onclick = () => { if (pMoved) { pMoved = false; return; } setOpen(true, true); };
  addEventListener('resize', placePill); placePill();
  $('#cwSv').onclick = e => { e.stopPropagation(); const m = $('#cwSvMenu'); m.hidden = !m.hidden; $('#cwSv').setAttribute('aria-expanded', String(!m.hidden)); if (!m.hidden) renderSv(); };
  $('#cwSvMenu').addEventListener('click', e => { const b = e.target.closest('[data-sv]'); if (b) setServer(b.dataset.sv); });
  document.addEventListener('click', e => { const m = $('#cwSvMenu'); if (!m.hidden && !m.contains(e.target)) { m.hidden = true; $('#cwSv').setAttribute('aria-expanded', 'false'); } });
  $('#cwCall').onclick = () => { const cur = S.channels.find(c => c.id === S.ch); startCall('ch=' + encodeURIComponent(S.ch), S.sv, cur && cur.call && cur.call.since); };
  addEventListener('cw:call', () => schedule(0));   // I just joined / left a call: tell the server now
  $('#cwMin').onclick = () => { setOpen(false); $('#cwPill').focus(); };
  $('#cwMem').onclick = () => setMembers(!S.members);
  mem.addEventListener('click', e => {
    if (e.target.closest('[data-a=closem]')) return setMembers(false);
    const r = e.target.closest('[data-pid]'); if (r) openProfile(r.dataset.pid);
  });
  mem.addEventListener('keydown', e => { const r = e.target.closest('[data-pid]'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openProfile(r.dataset.pid); } });
  $('#cwChans').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ch) switchTo(b.dataset.ch); else if (b.dataset.a === 'add') addChannel(); else if (b.dataset.a === 'rm') rmChannel();
  });
  log.addEventListener('click', e => {
    const who = e.target.closest('.av, .cw-nm'), mrow = e.target.closest('.cw-msg');
    if (who && mrow) { const m = S.msgs.find(x => x.id === mrow.dataset.id); if (m) return openProfile(m.uid); }
    const b = e.target.closest('[data-a]'), row = e.target.closest('.cw-msg'); if (!b || !row) return;
    if (b.dataset.a === 'edit') startEdit(row.dataset.id); else if (b.dataset.a === 'del') del(row.dataset.id);
  });
  $('#cwAttBtn').onclick = () => $('#cwFile').click();
  $('#cwFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; sendFile(f); };
  $('#cwEditX').onclick = () => { cancelEdit(); ta.value = ''; autosize(); ta.focus(); };
  $('#cwForm').onsubmit = e => { e.preventDefault(); send(); };
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    else if (e.key === 'Escape' && S.edit) { e.stopPropagation(); cancelEdit(); ta.value = ''; autosize(); }
  });
  ta.addEventListener('input', () => {
    autosize();
    if (!S.edit && Date.now() - S.lastType > 3000) { S.lastType = Date.now(); poll(); } else S.lastType = Date.now();   // tell the others I'm typing (first keystroke right away, then with each poll)
  });
  root.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!$('#cwSvMenu').hidden) { $('#cwSvMenu').hidden = true; return; }
    if (S.members) setMembers(false); else if (S.open) { setOpen(false); $('#cwPill').focus(); }
  });

  /* ---------- hand-over to friends.js (friends list + private messages) ---------- */
  window.__cwCore = { attHtml, attHydrate, attSend, esc, hue, link, tf, df, dayLabel, LS, avatar, isMobile, openProfile, win, pill: $('#cwPill'),
    refresh: ms => schedule(ms == null ? 0 : ms), hot: () => { S.hot = 0; }, closeWin: () => setOpen(false), openWin: () => setOpen(true, true), isOpen: () => S.open };

  /* ---------- go ---------- */
  /* An account that is in NO server has no group chat: hide the dock and never poll. Friends / private messages stay available. */
  (window.__authP || Promise.resolve(null)).then(me => {
    if (!(me && me.user && me.user.noServer)) return;
    S.none = true; clearTimeout(timer);
    root.classList.add('cw-none'); document.body.classList.remove('cw-on');
    win.hidden = true; mem.hidden = true; $('#cwPill').hidden = true;
  });
  win.hidden = !S.open; $('#cwPill').hidden = S.open;
  if (S.open) applyPos();
  renderLog(); renderAll();
  if (CROSS) loadServers().then(() => S.svs.length && poll()); else { poll(); loadServers(); }   // on the cross page, make sure the remembered server is still mine before the first poll
})();
