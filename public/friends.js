/* CrewCamp friends + private messages (Facebook style).
   - Add friend / accept / decline / unfriend from anyone's profile, or from the Friends panel ("Find people").
   - Two people who are friends can chat privately: each conversation opens as a small window docked beside the group chat.
   Rides on chat.js: it adds its own fields to the same GET /api/chat poll (see window.__cwF.params / .apply), so there is
   no extra polling. Needs auth.js (api helper) and chat.js (window.__cwCore). */
(() => {
  const core = window.__cwCore;
  if (!core || window.__cwF) return;
  const { esc, hue, link, tf, df, dayLabel, LS, avatar, isMobile, attHtml, attHydrate, attSend } = core;
  const MAX_WIN = 3;                       // private windows open at once (matches the server's DM_OPEN)

  /* ---------- state ---------- */
  const F = {
    friends: [], reqIn: [], reqOut: [], others: null, loaded: false, once: false,
    panel: LS.get('cwf_panel', false), tab: 'friends', q: '',
    open: LS.get('cwf_open', []).filter(x => typeof x === 'string').slice(0, MAX_WIN), min: {},
    msgs: {}, revs: {}, edit: {}, typed: {}, prev: {},
    seen: LS.get('cwf_seen', {}), fresh: localStorage.getItem('cwf_seen') === null,
  };
  const win = core.win, pill = core.pill;
  const byId = id => F.friends.find(f => f.id === id);
  const unreadOf = f => (F.open.includes(f.id) && !F.min[f.id] && !document.hidden) ? 0 : f.unread;
  const total = () => F.friends.reduce((a, f) => a + unreadOf(f), 0) + F.reqIn.length;
  const ini = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => [...w][0]).join('').toUpperCase() || '?';
  const RL = { admin: 'Head', host: 'Supervisor', staff: 'Staff' };

  /* ---------- DOM ---------- */
  const root = document.createElement('div');
  root.className = 'cwf';
  root.innerHTML = `
<button class="cwf-fab" id="cwfFab" type="button" aria-label="Open friends and private messages" hidden><span aria-hidden="true">🧑‍🤝‍🧑</span><span>Friends</span><em class="cw-badge" id="cwfFabB" hidden></em></button>
<div class="cwf-dock" id="cwfDock">
  <section class="cwf-panel" id="cwfPanel" role="dialog" aria-label="Friends" hidden>
    <header class="cwf-ph"><b>Friends</b><button class="cw-ib" type="button" data-a="closep" aria-label="Close friends" title="Close">×</button></header>
    <div class="cwf-tabs" id="cwfTabs" role="tablist"></div>
    <div class="cwf-search"><input id="cwfQ" type="search" placeholder="Search by name" aria-label="Search by name" autocomplete="off"></div>
    <div class="cwf-note" id="cwfNote" role="status" aria-live="polite"></div>
    <div class="cwf-list" id="cwfList"></div>
  </section>
</div>`;
  document.body.append(root);
  const $ = s => root.querySelector(s);
  const dock = $('#cwfDock'), panel = $('#cwfPanel'), fab = $('#cwfFab'), list = $('#cwfList');
  const wins = new Map();                    // friend id -> { el, log, ta, ... }

  let noteT = 0;
  function note(msg, ok) {
    const n = $('#cwfNote'); n.textContent = msg; n.className = 'cwf-note' + (ok ? ' ok' : ' err');
    clearTimeout(noteT); noteT = setTimeout(() => { n.textContent = ''; n.className = 'cwf-note'; }, 4000);
  }

  /* ---------- tiny avatar with presence dot ---------- */
  function face(u, online) {
    const w = document.createElement('span'); w.className = 'cw-st' + (online ? '' : ' offl');
    w.append(avatar({ id: u.id, name: u.name, avatarAt: u.avatarAt }));
    return w;
  }

  /* ---------- actions (friend requests) ---------- */
  async function act(kind, id) {
    if (kind === 'message') { openWin(id); return; }
    if (kind === 'unfriend') { if (!confirm('Remove this friend? Your chat history is kept, but you can no longer message each other.')) return; await api('/api/friends/' + encodeURIComponent(id), 'DELETE'); closeWin(id); }
    else await api('/api/friends/' + kind, 'POST', { userId: id });
    await reload();
  }
  async function reload() {                  // fresh lists right away (the next poll would take a few seconds)
    try {
      const d = await api('/api/friends');
      F.others = d.others; F.reqIn = d.incoming; F.reqOut = d.outgoing.map(u => u.id);
      const keep = new Map(F.friends.map(f => [f.id, f]));
      F.friends = d.friends.map(u => ({ ...(keep.get(u.id) || { online: false, typing: false, last: 0, prev: '', pm: false, unread: 0 }), ...u }));
      F.open = F.open.filter(id => byId(id));
      render();
    } catch (e) { if (e.status === 401) return location.replace('login.html'); }
    core.refresh(0);
  }
  const guard = (fn, el) => async () => {
    if (el) el.disabled = true;
    try { await fn(); } catch (e) { if (e.status === 401) return location.replace('login.html'); note(e.message || 'Something went wrong.'); if (el) el.disabled = false; }
  };

  /* ---------- Friends panel ---------- */
  function setPanel(on) {
    if (on && isMobile()) { core.closeWin(); F.open.forEach(id => { F.min[id] = true; }); }
    F.panel = on; LS.set('cwf_panel', on); render();
    if (on) { reload(); if (!isMobile()) $('#cwfQ').focus(); }
  }
  function renderTabs() {
    const t = [['friends', 'Friends', 0], ['requests', 'Requests', F.reqIn.length], ['find', 'Find people', 0]];
    const sig = JSON.stringify([F.tab, t.map(x => x[2])]);
    const el = $('#cwfTabs'); if (el.dataset.sig === sig) return; el.dataset.sig = sig;
    el.innerHTML = t.map(([k, l, n]) => `<button type="button" role="tab" class="cwf-tab${F.tab === k ? ' on' : ''}" aria-selected="${F.tab === k}" data-t="${k}">${l}${n ? `<em class="cw-badge">${n}</em>` : ''}</button>`).join('');
  }
  function row(u, opts) {                    // one person: avatar, name, a line of text, and buttons
    const d = document.createElement('div'); d.className = 'cwf-row'; d.dataset.pid = u.id;
    d.append(face(u, opts.online));
    const m = document.createElement('div'); m.className = 'cwf-rm';
    m.innerHTML = `<b>${esc(u.name)}</b><small>${esc(opts.sub || '')}</small>`;
    d.append(m);
    if (opts.badge) d.insertAdjacentHTML('beforeend', `<em class="cw-badge">${opts.badge}</em>`);
    (opts.btns || []).forEach(([label, cls, fn]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn mini-b ' + (cls || ''); b.textContent = label;
      b.onclick = e => { e.stopPropagation(); guard(fn, b)(); };
      d.append(b);
    });
    return d;
  }
  let listSig = '';
  function renderList() {
    if (!F.panel) return;
    renderTabs();
    const sig = JSON.stringify([F.tab, F.q, F.loaded, F.friends.map(f => [f.id, f.name, f.avatarAt, f.online, f.typing, f.last, f.prev, f.pm, unreadOf(f), f.call ? f.call.n : 0]), F.reqIn.map(u => u.id), F.reqOut, F.others && F.others.map(u => [u.id, u.state])]);
    if (sig === listSig) return; listSig = sig;   // untouched list = no rebuild, so a click is never lost to a re-render
    const q = F.q.trim().toLowerCase(), match = u => !q || u.name.toLowerCase().includes(q);
    const frag = document.createDocumentFragment();
    const empty = t => { const p = document.createElement('p'); p.className = 'cw-none'; p.textContent = t; frag.append(p); };
    if (F.tab === 'friends') {
      const l = F.friends.filter(match).sort((a, b) => b.last - a.last || b.online - a.online || a.name.localeCompare(b.name));
      if (!F.loaded) empty('Loading…');
      else if (!l.length) empty(F.friends.length ? 'No friend matches that name.' : 'No friends yet. Open "Find people" to add teammates.');
      l.forEach(f => {
        const un = unreadOf(f), r = row(f, { online: f.online, sub: f.typing ? 'typing…' : f.call ? '📹 Call in progress' : f.prev ? (f.pm ? 'You: ' : '') + f.prev : (f.online ? 'Online' : ''), badge: un || '' });
        r.classList.toggle('unread', !!un); r.title = 'Send a private message';
        r.onclick = () => openWin(f.id);
        frag.append(r);
      });
    } else if (F.tab === 'requests') {
      if (!F.reqIn.length && !F.reqOut.length) empty('No pending friend requests.');
      if (F.reqIn.length) { const h = document.createElement('h4'); h.textContent = 'Received — ' + F.reqIn.length; frag.append(h); }
      F.reqIn.filter(match).forEach(u => frag.append(row(u, { online: false, sub: '', btns: [['Accept', 'pri', () => act('accept', u.id)], ['Decline', '', () => act('decline', u.id)]] })));
      const out = (F.others || []).filter(u => F.reqOut.includes(u.id) && match(u));
      if (out.length) { const h = document.createElement('h4'); h.textContent = 'Sent — ' + out.length; frag.append(h); }
      out.forEach(u => frag.append(row(u, { online: false, sub: 'Waiting for a reply', btns: [['Cancel', '', () => act('cancel', u.id)]] })));
    } else {
      if (!F.others) empty('Loading…');
      else {
        const l = F.others.filter(match);
        if (!l.length) empty(q ? 'Nobody matches that name.' : 'There is nobody else here yet.');
        l.forEach(u => {
          const sub = '';
          const btns = u.state === 'friends' ? [['💬 Message', '', () => act('message', u.id)]]
            : u.state === 'sent' ? [['Cancel request', '', () => act('cancel', u.id)]]
            : u.state === 'received' ? [['Accept', 'pri', () => act('accept', u.id)], ['Decline', '', () => act('decline', u.id)]]
            : [['➕ Add friend', 'pri', () => act('request', u.id)]];
          frag.append(row(u, { online: false, sub: u.state === 'friends' ? sub + ' · Friends' : u.state === 'sent' ? sub + ' · Request sent' : sub, btns }));
        });
      }
    }
    list.replaceChildren(frag);
  }
  panel.addEventListener('click', e => {
    if (e.target.closest('[data-a=closep]')) return setPanel(false);
    const t = e.target.closest('[data-t]'); if (t) { F.tab = t.dataset.t; $('#cwfTabs').dataset.sig = ''; if (F.tab !== 'friends') reload(); renderList(); return; }
    const r = e.target.closest('.cwf-row'); if (r && !e.target.closest('button') && F.tab !== 'friends') core.openProfile(r.dataset.pid);
  });
  $('#cwfQ').addEventListener('input', e => { F.q = e.target.value; renderList(); });
  fab.onclick = () => setPanel(true);
  const hb = document.getElementById('cwFrBtn');
  if (hb) hb.onclick = () => { if (isMobile()) core.closeWin(); setPanel(!F.panel); };

  /* ---------- private message windows (Facebook-style) ---------- */
  function openWin(id, o = {}) {
    const f = byId(id); if (!f) return;
    if (isMobile()) { core.closeWin(); F.panel = false; LS.set('cwf_panel', false); F.open.forEach(x => { F.min[x] = true; }); }
    if (!F.open.includes(id)) { F.open.push(id); while (F.open.length > MAX_WIN) closeWin(F.open[0], true); }
    F.min[id] = !!o.min;
    if (!o.min) { F.seen[id] = f.last; LS.set('cwf_seen', F.seen); core.hot(); }
    LS.set('cwf_open', F.open); render();
    if (!o.min) { const w = wins.get(id); if (w) { w.scroll(true); if (!isMobile()) w.ta.focus(); } core.refresh(0); }
  }
  function closeWin(id, silent) {
    F.open = F.open.filter(x => x !== id); delete F.min[id]; delete F.edit[id];
    const w = wins.get(id); if (w) { w.el.remove(); wins.delete(id); }
    LS.set('cwf_open', F.open); if (!silent) render();
  }
  function buildWin(id) {
    const el = document.createElement('section'); el.className = 'cwf-win'; el.setAttribute('role', 'dialog');
    el.innerHTML = `
<header class="cwf-wh" tabindex="0" role="button" title="Click to minimize or restore"><span class="cwf-wav"></span><div class="cwf-wt"><b></b><small></small></div><em class="cw-badge" hidden></em><button class="cw-ib" type="button" data-a="call" aria-label="Video call" title="Video call (opens in a new tab)">📹 <span style="font-size:.7rem;font-weight:800">Call</span></button><button class="cw-ib" type="button" data-a="min" aria-label="Minimize" title="Minimize">—</button><button class="cw-ib" type="button" data-a="x" aria-label="Close" title="Close">×</button></header>
<div class="cw-callbar" role="status" hidden></div>
<div class="cwf-log" role="log" aria-live="polite" tabindex="0"></div>
<div class="cw-typing"></div>
<div class="cw-edit" hidden><span>✎ Editing your message</span><button type="button" data-a="editx">Cancel</button></div>
<form class="cwf-form"><button class="cw-emob cw-attb" type="button" data-a="attach" aria-label="Attach a file (disappears after 15 minutes)" title="Attach a file · disappears after 15 minutes">📎</button><input type="file" hidden><textarea rows="1" maxlength="1000" placeholder="Aa" aria-label="Private message"></textarea><button class="btn pri cw-send" type="submit" aria-label="Send">➤</button></form>`;
    const w = { el, log: el.querySelector('.cwf-log'), ta: el.querySelector('textarea'), sig: '', sending: false };
    const autosize = () => { w.ta.style.height = 'auto'; w.ta.style.height = Math.min(w.ta.scrollHeight, 88) + 'px'; };
    w.autosize = autosize;
    w.scroll = force => { if (force) w.log.scrollTop = w.log.scrollHeight; };

    const send = async () => {
      const text = w.ta.value.trim(); if (!text || w.sending) return;
      w.sending = true;
      try {
        if (F.edit[id]) {
          const m = await api(`/api/dm/msg/${encodeURIComponent(F.edit[id])}?with=${encodeURIComponent(id)}`, 'PUT', { text });
          const i = (F.msgs[id] || []).findIndex(x => x.id === F.edit[id]); if (i >= 0) F.msgs[id][i] = m;
          stopEdit(id);
        } else {
          const m = await api('/api/dm/send', 'POST', { to: id, text });
          (F.msgs[id] = F.msgs[id] || []); if (!F.msgs[id].some(x => x.id === m.id)) F.msgs[id].push(m);
          const f = byId(id); if (f) { f.last = m.ts; f.prev = m.text.slice(0, 60); f.pm = true; F.seen[id] = m.ts; LS.set('cwf_seen', F.seen); }
        }
        w.ta.value = ''; autosize(); core.hot(); renderWin(id, true); core.refresh(1500); renderList();
      } catch (e) {
        if (e.status === 401) return location.replace('login.html');
        const t = el.querySelector('.cw-typing'); t.textContent = e.message; t.classList.add('err'); setTimeout(() => { t.classList.remove('err'); renderWin(id); }, 3500);
      } finally { w.sending = false; }
    };
    const sendFile = async file => {
      if (!file || w.sending) return;
      w.sending = true;
      const t = el.querySelector('.cw-typing'); t.classList.remove('err'); t.textContent = '⏫ Sending ' + file.name + '…'; w.up = true;
      try {
        const caption = F.edit[id] ? '' : w.ta.value.trim(), m = await attSend(file, { to: id }, caption);
        (F.msgs[id] = F.msgs[id] || []); if (!F.msgs[id].some(x => x.id === m.id)) F.msgs[id].push(m);
        const f = byId(id); if (f) { f.last = m.ts; f.prev = m.text || ('📎 ' + m.att.name); f.pm = true; F.seen[id] = m.ts; LS.set('cwf_seen', F.seen); }
        if (caption) { w.ta.value = ''; autosize(); }
        w.up = false; t.textContent = ''; core.hot(); renderWin(id, true); core.refresh(1500); renderList();
      } catch (e) {
        w.up = false;
        if (e.status === 401) return location.replace('login.html');
        t.textContent = e.message; t.classList.add('err'); setTimeout(() => { t.classList.remove('err'); renderWin(id); }, 3500);
      } finally { w.sending = false; w.up = false; }
    };
    const fi = el.querySelector('input[type=file]');
    fi.onchange = () => { const f = fi.files[0]; fi.value = ''; sendFile(f); };
    el.querySelector('form').onsubmit = e => { e.preventDefault(); send(); };
    w.ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      else if (e.key === 'Escape' && F.edit[id]) { e.stopPropagation(); stopEdit(id); }
    });
    w.ta.addEventListener('input', () => {
      autosize();
      const first = Date.now() - (F.typed[id] || 0) > 3000; F.typed[id] = Date.now();
      if (first && !F.edit[id]) core.refresh(0);          // tell them I'm typing (the next poll carries it)
    });
    w.ta.addEventListener('focus', () => { const f = byId(id); if (f && F.seen[id] !== f.last) { F.seen[id] = f.last; LS.set('cwf_seen', F.seen); render(); } });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (b) {
        const a = b.dataset.a, row = e.target.closest('.cwf-m');
        if (a === 'x') return closeWin(id);
        if (a === 'min') return toggleMin(id);
        if (a === 'call' || a === 'joincall') { const f = byId(id); return startCall('dm=' + encodeURIComponent(id), undefined, f && f.call && f.call.since); }
        if (a === 'editx') { stopEdit(id); w.ta.value = ''; autosize(); return; }
        if (a === 'edit' && row) return startEdit(id, row.dataset.id);
        if (a === 'del' && row) return delMsg(id, row.dataset.id);
        if (a === 'attach') return el.querySelector('input[type=file]').click();
        return;
      }
      if (e.target.closest('.cwf-wh') && !e.target.closest('button')) { if (F.min[id]) toggleMin(id); else if (e.target.closest('.cwf-wt, .cwf-wav')) core.openProfile(id); }
    });
    el.querySelector('.cwf-wh').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('cwf-wh')) { e.preventDefault(); toggleMin(id); } });
    el.addEventListener('keydown', e => { if (e.key === 'Escape' && !F.edit[id]) { closeWin(id); } });
    return w;
  }
  function toggleMin(id) {
    F.min[id] = !F.min[id];
    if (!F.min[id]) { const f = byId(id); if (f) { F.seen[id] = f.last; LS.set('cwf_seen', F.seen); } core.hot(); core.refresh(0); }
    render(); const w = wins.get(id); if (w && !F.min[id]) { w.scroll(true); if (!isMobile()) w.ta.focus(); }
  }
  function startEdit(id, mid) {
    const m = (F.msgs[id] || []).find(x => x.id === mid), w = wins.get(id); if (!m || !m.mine || !w) return;
    F.edit[id] = mid; w.ta.value = m.text; w.el.querySelector('.cw-edit').hidden = false; w.autosize(); w.ta.focus();
  }
  function stopEdit(id) { delete F.edit[id]; const w = wins.get(id); if (w) w.el.querySelector('.cw-edit').hidden = true; }
  async function delMsg(id, mid) {
    if (!confirm('Delete this message for both of you?')) return;
    try { await api(`/api/dm/msg/${encodeURIComponent(mid)}?with=${encodeURIComponent(id)}`, 'DELETE'); F.msgs[id] = (F.msgs[id] || []).filter(x => x.id !== mid); if (F.edit[id] === mid) stopEdit(id); renderWin(id); core.refresh(1500); }
    catch (e) { note(e.message); }
  }

  function renderWin(id, stick) {
    const f = byId(id), w = wins.get(id); if (!f || !w) return;
    const min = !!F.min[id], un = unreadOf(f);
    w.el.classList.toggle('min', min); w.el.classList.toggle('unread', min && un > 0);
    w.el.setAttribute('aria-label', 'Private chat with ' + f.name);
    const av = w.el.querySelector('.cwf-wav'); if (av.dataset.k !== f.id + ':' + f.avatarAt + ':' + f.online) { av.dataset.k = f.id + ':' + f.avatarAt + ':' + f.online; av.replaceChildren(face(f, f.online)); }
    w.el.querySelector('.cwf-wt b').textContent = f.name;
    w.el.querySelector('.cwf-wt small').innerHTML = f.online ? '<i class="cw-dot"></i>Online' : 'Offline';
    const bd = w.el.querySelector('.cwf-wh .cw-badge'); bd.hidden = !(min && un); bd.textContent = un > 99 ? '99+' : un;
    const ty = w.el.querySelector('.cw-typing'); if (!ty.classList.contains('err') && !w.up) ty.textContent = f.typing ? f.name.split(' ')[0] + ' is typing…' : '';
    const cb = w.el.querySelector('.cw-callbar'), k = f.call, cs = k ? [k.n, k.since, k.me].join() : '';
    if (cb.dataset.k !== cs) {   // small "Call in progress · since 3:42 PM · 2 in call  [Join]" line
      cb.dataset.k = cs; cb.hidden = !k;
      cb.innerHTML = k ? `<i class="cw-cdot" aria-hidden="true"></i><span><b>Call in progress</b> · since ${tf.format(k.since)} · ${k.n} in call</span>` + (k.me ? '<em>you’re in</em>' : '<button type="button" class="cw-cjoin" data-a="joincall">Join</button>') : '';
    }
    if (min) return;
    const msgs = F.msgs[id], sig = msgs ? msgs.map(m => m.id + (m.edited ? 'e' : '') + m.text.length + (m.att ? (m.att.gone ? 'x' : 'a') : '')).join('|') : 'x';
    if (sig === w.sig && !stick) return;
    w.sig = sig;
    const near = w.log.scrollHeight - w.log.scrollTop - w.log.clientHeight < 90;
    let h = '', day = '', prev = null;
    if (!msgs) h = '<p class="cw-empty">Loading…</p>';
    else if (!msgs.length) h = `<p class="cw-empty"><b>${esc(f.name)}</b>Only the two of you can see this chat. Say hi 👋</p>`;
    (msgs || []).forEach(m => {
      const d = df.format(m.ts);
      if (d !== day) { h += `<div class="cw-day"><span>${dayLabel(m.ts)}</span></div>`; day = d; prev = null; }
      const grp = prev && prev.uid === m.uid && m.ts - prev.ts < 3e5;
      h += `<div class="cwf-m${m.mine ? ' mine' : ''}${grp ? ' grp' : ''}" data-id="${esc(m.id)}" tabindex="0"><div class="cwf-b" title="${tf.format(m.ts)}">${m.text ? link(m.text) : ''}${m.edited && m.text ? '<i class="cw-ed">(edited)</i>' : ''}${m.att ? attHtml(m.att) : ''}</div>`
        + (m.mine ? '<span class="cw-act"><button type="button" data-a="edit" title="Edit" aria-label="Edit message">✎</button><button type="button" data-a="del" title="Delete" aria-label="Delete message">🗑</button></span>' : '')
        + `<time>${tf.format(m.ts)}</time></div>`;
      prev = m;
    });
    w.log.className = 'cwf-log' + (msgs && msgs.length ? ' has' : '');
    w.log.innerHTML = h;
    attHydrate(w.log);
    if (stick || near) w.log.scrollTop = w.log.scrollHeight;
  }

  /* ---------- layout + render ---------- */
  const railW = () => document.body.classList.contains('hasrail') && !isMobile() ? 72 : 0;
  function layout() {
    const mob = isMobile(), groupOpen = !win.hidden;
    if (mob && groupOpen && (F.panel || F.open.some(id => !F.min[id]))) { F.panel = false; F.open.forEach(id => { F.min[id] = true; }); }   // phones: one sheet at a time
    const sheet = mob && (F.panel || F.open.some(id => !F.min[id]));
    document.body.classList.toggle('cwf-sheet', sheet);                                    // phones: hide the group-chat pill behind an open sheet
    fab.hidden = groupOpen || sheet;
    // the dock sits right beside whatever the group chat currently is (open window or minimized pill)
    const a = groupOpen ? win : (!pill.hidden ? pill : null);
    if (!mob) {
      const r = a && a.getBoundingClientRect();
      let right = r && r.width ? innerWidth - r.left + 10 : 14;
      right = Math.max(14, Math.min(right, innerWidth - 330 - railW()));
      dock.style.right = right + 'px';
      if (!groupOpen && !pill.hidden) {       // the Friends button rides just above the group-chat pill
        const p = pill.getBoundingClientRect();
        if (p.width) { fab.style.right = Math.max(8, innerWidth - p.right) + 'px'; fab.style.bottom = (innerHeight - p.top + 8) + 'px'; }
      }
    } else { dock.style.right = ''; fab.style.right = fab.style.bottom = ''; }
    // desktop: keep only as many windows as fit
    if (!mob) {
      const room = Math.max(1, Math.floor((innerWidth - parseFloat(dock.style.right || 14) - 14 - railW() - (F.panel && innerWidth < 1100 ? 334 : 0)) / 312));
      while (F.open.length > Math.min(MAX_WIN, room)) closeWin(F.open[0], true);
    }
  }
  function badges() {
    const n = total(), t = n > 99 ? '99+' : n;
    const fb = $('#cwfFabB'); fb.hidden = !n; fb.textContent = t;
    const hb2 = document.getElementById('cwFrB'); if (hb2) { hb2.hidden = !n; hb2.textContent = t; }
    document.querySelectorAll('#svFr .svb').forEach(e => { e.hidden = !n; e.textContent = t; });   // badge on the server-rail Friends button
    document.querySelectorAll('#svFr').forEach(e => e.classList.toggle('on', F.panel));
    fab.setAttribute('aria-label', 'Open friends and private messages' + (n ? ', ' + n + ' new' : ''));
  }
  function render() {
    layout(); badges();
    panel.hidden = !F.panel;
    renderList();
    // windows: create / remove / order (the first in F.open ends up leftmost; the panel is always nearest the group chat)
    for (const id of [...wins.keys()]) if (!F.open.includes(id)) { wins.get(id).el.remove(); wins.delete(id); }
    F.open.forEach(id => { if (!wins.has(id) && byId(id)) { wins.set(id, buildWin(id)); } });
    if (panel.parentNode !== root) root.append(panel);                                                  // Friends panel = flyout next to the server rail
    const want = F.open.slice().reverse().map(id => wins.get(id)?.el).filter(Boolean);                 // dock is row-reverse: first child = nearest the group chat
    if (want.some((el, i) => dock.children[i] !== el)) want.forEach(el => dock.append(el));          // only reorder when needed (moving a node resets its scroll position)
    F.open.forEach(id => renderWin(id));
  }

  /* ---------- poll hooks (called by chat.js) ---------- */
  window.__cwF = {
    toggle() { if (isMobile()) core.closeWin(); setPanel(!F.panel); }, badges, 
    params() {
      const q = {}, ids = F.open.filter(id => !F.min[id]);
      if (ids.length) { q.dm = ids.join(','); q.drev = ids.map(id => id + ':' + (F.revs[id] ?? -1)).join(','); }
      const seen = Object.entries(F.seen).map(([k, v]) => k + ':' + v).join(','); if (seen) q.dseen = seen;
      const ty = F.open.find(id => !F.min[id] && Date.now() - (F.typed[id] || 0) < 5000); if (ty) q.dtyping = ty;
      return q;
    },
    apply(d) {
      F.friends = d.friends || []; F.reqIn = d.reqIn || []; F.reqOut = d.reqOut || []; F.loaded = true;
      for (const [id, x] of Object.entries(d.dms || {})) { F.revs[id] = x.rev; if (x.msgs) F.msgs[id] = x.msgs; }
      F.friends.forEach(f => { if (F.seen[f.id] == null) F.seen[f.id] = F.fresh ? f.last : 0; });   // new browser: existing messages count as read
      F.fresh = false;
      const gone = F.open.filter(id => !byId(id));                                                // unfriended me (or the account was removed)
      gone.forEach(id => closeWin(id, true));
      // a new message from a friend whose window is closed: pop it up minimized with a badge, like Facebook (never on the first poll, never on phones)
      F.friends.forEach(f => {
        if (F.once && !isMobile() && f.unread > (F.prev[f.id] || 0) && !F.open.includes(f.id) && F.seen[f.id] !== f.last) { F.open.push(f.id); F.min[f.id] = true; while (F.open.length > MAX_WIN) closeWin(F.open[0], true); LS.set('cwf_open', F.open); }
        F.prev[f.id] = f.unread;
      });
      F.open.forEach(id => { const f = byId(id); if (f && !F.min[id] && !document.hidden && F.seen[id] !== f.last) F.seen[id] = f.last; });   // reading it now
      LS.set('cwf_seen', F.seen); F.once = true;
      if (F.tab === 'find' && F.panel && F.others) F.others.forEach(u => { u.state = F.friends.some(f => f.id === u.id) ? 'friends' : F.reqOut.includes(u.id) ? 'sent' : F.reqIn.some(r => r.id === u.id) ? 'received' : 'none'; });
      render();
    },
    layout() { layout(); badges(); },
    active() { return F.panel || F.open.some(id => !F.min[id]); },
    openDm: openWin,
    openPanel(tab) { if (tab) F.tab = tab; $('#cwfTabs').dataset.sig = ''; setPanel(true); },
    /* buttons for the profile dialog: Add friend / Cancel / Accept·Decline / Message·Unfriend */
    profileRow(id, state, cb) {
      const row = document.createElement('div'); row.className = 'cwf-prow';
      const err = document.createElement('p'); err.className = 'cwf-perr'; err.setAttribute('role', 'alert');
      const add = (label, cls, fn) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (cls || ''); b.textContent = label;
        b.onclick = async () => { b.disabled = true; err.textContent = ''; try { await fn(); } catch (e) { err.textContent = e.message || 'Something went wrong.'; b.disabled = false; } };
        row.append(b);
      };
      const then = k => async () => { await act(k, id); cb.reload(); };
      if (state === 'friends') {
        add('💬 Message', 'pri', async () => { cb.close(); openWin(id); });
        add('Unfriend', '', then('unfriend'));
      } else if (state === 'sent') { add('Request sent · Cancel', '', then('cancel')); }
      else if (state === 'received') { add('Accept request', 'pri', then('accept')); add('Decline', '', then('decline')); }
      else add('➕ Add friend', 'pri', then('request'));
      row.append(err);
      return row;
    },
  };

  addEventListener('resize', () => { layout(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && F.panel && !e.defaultPrevented && !document.querySelector('.cw-pv') && !root.querySelector('.cwf-win:focus-within')) setPanel(false); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  render();
  core.refresh(0);                           // load friends right away instead of waiting for the next poll
  if (/[?&]friends=1/.test(location.search)) { history.replaceState(null, '', location.pathname); setPanel(true); }   // from the rail on other pages
})();
