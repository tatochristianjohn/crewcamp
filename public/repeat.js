/* "Log repeating task" (Personal calendar only).
   Pick a title, a start and end date and the weekdays (e.g. Mon/Wed/Fri) -> one sticky note per matching day.
   Speed: the pane is built the first time it is opened (nothing runs on page load), all notes are added to the board in memory
   in a single pass, and the board is saved ONCE (one request), then the calendar is redrawn once.
   Needs app.js (P, COLORS, save, renderAll, toast, todayStr, addDays, holidays, key helpers). */
(() => {
  const MAX_DAYS = 366;                 // longest range per run
  const MAX_BOARD_CHARS = 9e5;          // the server refuses boards over ~1,000,000 characters; stay safely under it
  const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];   // value = JS weekday (Sun = 0)
  const PRESETS = [['Weekdays', [1, 2, 3, 4, 5]], ['M · W · F', [1, 3, 5]], ['T · Th', [2, 4]], ['Every day', [0, 1, 2, 3, 4, 5, 6]], ['Clear', []]];
  let pane = null, opener = null;

  const dow = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const fmt = s => new Date(s + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

  function build() {
    pane = document.createElement('div');
    pane.id = 'rep'; pane.className = 'overlay'; pane.hidden = true;
    pane.innerHTML = `
<form class="panel dlg repdlg" id="repF" role="dialog" aria-modal="true" aria-labelledby="repT" novalidate>
  <h2 id="repT">🔁 Log repeating task</h2>
  <p class="sub">Adds one sticky note on every chosen weekday between the two dates.</p>
  <input id="rTitle" placeholder="Task title (e.g. Gym)" maxlength="120" autocomplete="off" required>
  <input id="rDesc" placeholder="Description (optional)" maxlength="500" autocomplete="off">
  <select id="rPri" aria-label="Priority"><option value="Now">🔴 Now</option><option value="Next" selected>🟡 Next</option><option value="Later">🟢 Later</option></select>
  <div class="reprange">
    <label>Start date<input id="rStart" type="date" required></label>
    <label>End date<input id="rEnd" type="date" required></label>
  </div>
  <div>
    <div class="sub" style="margin-bottom:6px"><b>Repeat on:</b></div>
    <div class="people repdays" id="rDays">${DAYS.map(([v, n]) => `<label class="pchip"><input type="checkbox" value="${v}"><span>${n}</span></label>`).join('')}</div>
    <div class="reppre">${PRESETS.map(([n, d], i) => `<button type="button" class="mini" data-p="${i}">${n}</button>`).join('')}</div>
  </div>
  <label class="repck"><input type="checkbox" id="rHol"> Skip Philippine holidays</label>
  <div class="repsum" id="rSum" aria-live="polite"></div>
  <div class="row"><button class="btn pri" type="submit" id="rGo">＋ Create notes</button><button class="btn" type="button" id="rX">Cancel</button></div>
</form>`;
    document.body.append(pane);
    const $r = s => pane.querySelector(s);
    const t = todayStr();
    $r('#rStart').value = t; $r('#rEnd').value = addDays(t, 27);

    pane.addEventListener('click', e => {
      if (e.target === pane) return close();
      const p = e.target.closest('[data-p]');
      if (p) { const on = PRESETS[p.dataset.p][1]; pane.querySelectorAll('#rDays input').forEach(i => { i.checked = on.includes(Number(i.value)); }); summary(); }
    });
    $r('#rX').onclick = close;
    pane.addEventListener('input', summary);
    pane.addEventListener('change', summary);
    $r('#repF').onsubmit = e => { e.preventDefault(); create(); };
    pane.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  }

  /* the matching dates, computed with plain string/weekday maths (at most 366 loop steps) */
  function plan() {
    const s = pane.querySelector('#rStart').value, e = pane.querySelector('#rEnd').value;
    const want = new Set([...pane.querySelectorAll('#rDays input:checked')].map(i => Number(i.value)));
    const skipHol = pane.querySelector('#rHol').checked;
    if (!validDate(s) || !validDate(e)) return { err: 'Pick a start and an end date.' };
    if (e < s) return { err: 'The end date is before the start date.' };
    const span = Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
    if (span > MAX_DAYS) return { err: `Choose a range of at most ${MAX_DAYS} days (about a year).` };
    if (!want.size) return { err: 'Pick at least one weekday.' };
    const dates = []; let w = dow(s), skipped = 0, hy = 0, H = null;
    for (let i = 0; i < span; i++, w = (w + 1) % 7) {
      if (!want.has(w)) continue;
      const d = addDays(s, i);
      if (skipHol) { const y = Number(d.slice(0, 4)); if (y !== hy) { hy = y; H = holidays(y); } if (H[d]) { skipped++; continue; } }
      dates.push(d);
    }
    return { dates, skipped, s, e };
  }
  function summary() {
    const el = pane.querySelector('#rSum'), go = pane.querySelector('#rGo'), r = plan();
    if (r.err) { el.textContent = r.err; el.className = 'repsum warn'; go.disabled = true; return r; }
    if (!r.dates.length) { el.textContent = 'No matching days in that range.'; el.className = 'repsum warn'; go.disabled = true; return r; }
    el.className = 'repsum';
    el.textContent = `📝 ${r.dates.length} sticky note${r.dates.length > 1 ? 's' : ''} · ${fmt(r.dates[0])} → ${fmt(r.dates.at(-1))}` + (r.skipped ? ` · ${r.skipped} holiday${r.skipped > 1 ? 's' : ''} skipped` : '');
    go.disabled = false; return r;
  }

  function create() {
    const title = pane.querySelector('#rTitle').value.trim();
    if (!title) { toast('Please type a task title!'); return pane.querySelector('#rTitle').focus(); }
    const r = summary(); if (r.err || !r.dates.length) return;
    const description = pane.querySelector('#rDesc').value.trim(), priority = pane.querySelector('#rPri').value, pal = COLORS[priority];
    const stamp = Date.now().toString(36), created = todayStr(), base = P.tasks.length;
    const fresh = r.dates.map((date, i) => ({ id: 't' + stamp + i, date, title, description, priority, status: 'active', pinned: false, favorite: false, color: pal[(base + i) % pal.length], created }));
    if (JSON.stringify(P).length + JSON.stringify(fresh).length > MAX_BOARD_CHARS) return toast('⚠️ Your board is too full for that many notes. Erase some old ones first.');
    P.tasks.push(...fresh);                                   // all notes in memory first …
    save();                                                   // … then ONE save request (app.js debounces it) …
    const [y, m] = r.dates[0].split('-').map(Number); vy = y; vm = m - 1;
    close(); renderAll();                                     // … and ONE redraw
    toast(`${fresh.length} repeating note${fresh.length > 1 ? 's' : ''} added`);
  }

  function open() {
    if (mode !== 'personal') return;
    if (!pane) build();
    opener = document.activeElement; pane.hidden = false; document.body.classList.add('lock');
    summary(); pane.querySelector('#rTitle').focus();
  }
  function close() {
    if (!pane) return;
    pane.hidden = true; document.body.classList.remove('lock');
    pane.querySelector('#rTitle').value = ''; pane.querySelector('#rDesc').value = '';
    if (opener && opener.focus) opener.focus();
  }
  document.getElementById('repBtn').onclick = open;
})();
