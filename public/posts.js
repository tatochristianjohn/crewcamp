/* CrewCamp profile posts (Threads style).
   Short text posts on a person's profile: the owner writes them, anyone who can see the profile can like and reply.
   Mounted into the "My profile" dialog (app.js) and into the profile viewer (chat.js) via window.__cwP.mount(host, userId).
   Needs auth.js (api helper) and chat.js (window.__cwCore). */
(() => {
  const core = window.__cwCore;
  if (!core || window.__cwP) return;
  const { esc, link, avatar } = core;

  const ago = ts => {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'now';
    const m = s / 60; if (m < 60) return Math.floor(m) + 'm';
    const h = m / 60; if (h < 24) return Math.floor(h) + 'h';
    const d = h / 24; if (d < 7) return Math.floor(d) + 'd';
    return new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  };
  const body = t => link(t).replace(/\n/g, '<br>');   // plain text only: escaped, links clickable, line breaks kept
  const heart = on => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.1C.9 8.6 2.6 5 6 5c2 0 3.4 1.1 4 2.3h4C14.6 6.1 16 5 18 5c3.4 0 5.1 3.6 3.6 6.9C19.5 16.4 12 21 12 21z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  const bubble = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  function mount(host, userId, opts = {}) {
    host.textContent = '';
    const box = document.createElement('section');
    box.className = 'cwp'; box.setAttribute('aria-label', 'Posts');
    box.innerHTML = '<h3 class="cwp-h">Threads</h3><p class="sub cwp-load">Loading posts…</p>';
    host.append(box);
    let data = null, openReply = null, gone = false;

    const fail = (el, x) => { el.textContent = x.message || 'Something went wrong.'; };
    const stale = () => gone || !box.isConnected;

    async function load() {
      try { data = await api('/api/posts/' + encodeURIComponent(userId)); }
      catch (x) { if (stale()) return; box.innerHTML = `<h3 class="cwp-h">Threads</h3><p class="sub">${esc(friendly(x) || 'Could not load posts.')}</p>`; return; }
      if (stale()) return;
      render();
    }

    function postEl(p) {
      const el = document.createElement('article'); el.className = 'cwp-post'; el.dataset.id = p.id;
      const open = openReply === p.id;
      el.innerHTML = `<div class="cwp-top"><span class="sub">${ago(p.ts)}</span>${p.canDelete ? '<button type="button" class="cwp-x" data-a="del" aria-label="Delete post" title="Delete post">🗑</button>' : ''}</div>
        <div class="cwp-txt">${body(p.text)}</div>
        <div class="cwp-bar"><button type="button" class="cwp-b${p.liked ? ' on' : ''}" data-a="like" aria-pressed="${p.liked}" aria-label="Like">${heart(p.liked)}<span>${p.likes || ''}</span></button>
          <button type="button" class="cwp-b${open ? ' on' : ''}" data-a="toggle" aria-expanded="${open}" aria-label="Replies">${bubble}<span>${p.replies.length || ''}</span></button></div>
        <p class="cwp-err" role="alert"></p>`;
      if (open) {
        const th = document.createElement('div'); th.className = 'cwp-thread';
        p.replies.forEach(r => {
          const row = document.createElement('div'); row.className = 'cwp-reply'; row.dataset.rid = r.id;
          row.append(avatar({ id: r.uid, name: r.name, avatarAt: r.avatarAt }));
          const c = document.createElement('div'); c.className = 'cwp-rc';
          c.innerHTML = `<div class="cwp-rh"><b>${esc(r.name)}</b><span class="sub">${ago(r.ts)}</span>${r.canDelete ? '<button type="button" class="cwp-x" data-a="rdel" aria-label="Delete reply" title="Delete reply">✕</button>' : ''}</div><div class="cwp-txt">${body(r.text)}</div>`;
          row.append(c); th.append(row);
        });
        const f = document.createElement('form'); f.className = 'cwp-rf';
        f.innerHTML = `<textarea rows="1" maxlength="${data.replyMax}" placeholder="Reply…" aria-label="Reply"></textarea><button class="btn pri mini-b" type="submit" disabled>Reply</button>`;
        const ta = f.querySelector('textarea'), sb = f.querySelector('button');
        ta.oninput = () => { sb.disabled = !ta.value.trim(); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
        f.onsubmit = async e => {
          e.preventDefault(); const t = ta.value.trim(); if (!t) return; sb.disabled = true;
          try { const r = await api(`/api/posts/${encodeURIComponent(userId)}/${p.id}/reply`, 'POST', { text: t }); p.replies.push(r); render(); }
          catch (x) { sb.disabled = false; fail(el.querySelector('.cwp-err'), x); }
        };
        th.append(f); el.append(th);
        setTimeout(() => { if (!stale()) { const t = el.querySelector('.cwp-rf textarea'); if (t && opts.focusReply !== false) t.focus({ preventScroll: true }); } }, 0);
      }
      return el;
    }

    function render() {
      const keep = box.querySelector('.cwp-compose textarea'), draft = keep ? keep.value : '';
      box.innerHTML = '<h3 class="cwp-h">Threads</h3>';
      if (data.hidden) { box.insertAdjacentHTML('beforeend', '<p class="sub cwp-empty">🔒 Posts are hidden because this profile is hidden.</p>'); return; }
      if (data.mine) {
        const f = document.createElement('form'); f.className = 'cwp-compose';
        f.innerHTML = `<textarea rows="2" maxlength="${data.max}" placeholder="Start a thread…" aria-label="New post"></textarea>
          <div class="cwp-cf"><span class="sub cwp-cnt">${data.max}</span><button class="btn pri mini-b" type="submit" disabled>Post</button></div><p class="cwp-err" role="alert"></p>`;
        const ta = f.querySelector('textarea'), sb = f.querySelector('button'), cnt = f.querySelector('.cwp-cnt');
        const sync = () => { sb.disabled = !ta.value.trim(); cnt.textContent = data.max - ta.value.length; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
        ta.value = draft; ta.oninput = sync; sync();
        f.onsubmit = async e => {
          e.preventDefault(); const t = ta.value.trim(); if (!t) return; sb.disabled = true;
          try { const p = await api('/api/posts', 'POST', { text: t }); data.posts.unshift(p); ta.value = ''; render(); }
          catch (x) { sb.disabled = false; fail(f.querySelector('.cwp-err'), x); }
        };
        box.append(f);
      }
      if (!data.posts.length) box.insertAdjacentHTML('beforeend', `<p class="sub cwp-empty">${data.mine ? 'Nothing posted yet. Say something!' : 'No posts yet.'}</p>`);
      const list = document.createElement('div'); list.className = 'cwp-list';
      data.posts.forEach(p => list.append(postEl(p)));
      box.append(list);
    }

    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-a]'); if (!b || !data) return;
      const el = b.closest('.cwp-post'), p = data.posts.find(x => x.id === el.dataset.id); if (!p) return;
      const err = el.querySelector('.cwp-err'); err.textContent = '';
      const base = `/api/posts/${encodeURIComponent(userId)}/${p.id}`;
      const a = b.dataset.a;
      if (a === 'toggle') { openReply = openReply === p.id ? null : p.id; render(); return; }
      b.disabled = true;
      try {
        if (a === 'like') { const r = await api(base + '/like', 'POST', {}); p.liked = r.liked; p.likes = r.likes; render(); }
        else if (a === 'del') { if (!confirm('Delete this post and its replies?')) { b.disabled = false; return; } await api(base, 'DELETE'); data.posts = data.posts.filter(x => x.id !== p.id); render(); }
        else if (a === 'rdel') { const rid = b.closest('.cwp-reply').dataset.rid; await api(base + '/reply/' + rid, 'DELETE'); p.replies = p.replies.filter(x => x.id !== rid); render(); }
      } catch (x) { b.disabled = false; fail(err, x); }
    });

    load();
    return { destroy() { gone = true; box.remove(); } };
  }

  window.__cwP = { mount };
})();
