// node test/chess.mjs : engine perft + API flow (fool's mate) with an in-memory blob store
import assert from 'node:assert';
import * as E from '../netlify/functions/chess-engine.mjs';
import { chessApi } from '../netlify/functions/chess-api.mjs';
assert.equal(E.perft(E.parseFen(E.START_FEN), 3), 8902);
assert.equal(E.perft(E.parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), 3), 97862);
const mem = new Map(), etag = new Map();
const bs = { async get(k) { return mem.has(k) ? JSON.parse(mem.get(k)) : null; }, async getWithMetadata(k) { return mem.has(k) ? { data: JSON.parse(mem.get(k)), etag: etag.get(k) } : null; },
  async setJSON(k, d) { mem.set(k, JSON.stringify(d)); etag.set(k, String(Math.random())); return { modified: true }; } };
async function mutate(st, key, init, fn) { const r = await st.getWithMetadata(key); const data = r ? r.data : await init(); const out = await fn(data); await st.setJSON(key, data); return out; }
class HE extends Error { constructor(s, m) { super(m); this.status = s; } }
const H = (m, s = 400) => new HE(s, m), J = d => d;
const notes = [];
const notify = async (st, ids, n) => { notes.push({ ids, ...n }); };
const FR = new Set(['a>b', 'b>a']);
const call = async (me, path, m = 'GET', body = {}, q = '') => chessApi({ path, m, body, me, bs, mutate, J, H, query: new URLSearchParams(q), notify, areFriends: async id => FR.has(me.id + '>' + id) });
const A = { id: 'a', name: 'Ann' }, B = { id: 'b', name: 'Bob' };
const { game } = await call(A, '/chess/new', 'POST', { color: 'white', minutes: 5 });
assert.equal((await call(B, '/chess/lobby')).open.length, 1);
await call(B, '/chess/join', 'POST', { id: game.id });
await assert.rejects(call(B, '/chess/move', 'POST', { id: game.id, from: 'e7', to: 'e5' }), /not your turn/);
for (const [u, f, t] of [[A, 'f2', 'f3'], [B, 'e7', 'e5'], [A, 'g2', 'g4'], [B, 'd8', 'h4']]) await call(u, '/chess/move', 'POST', { id: game.id, from: f, to: t });
const end = (await call(A, '/chess/game', 'GET', {}, 'id=' + game.id)).game;
assert.equal(end.status, 'finished'); assert.equal(end.winner, 'black'); assert.equal(end.result_reason, 'checkmate'); assert.equal(end.moves[3].san, 'Qh4#');

// chat: players only, trimmed, capped
const C = { id: 'c', name: 'Cy' };
await call(A, '/chess/chat', 'POST', { id: game.id, text: '  gg  ' });
await assert.rejects(call(C, '/chess/chat', 'POST', { id: game.id, text: 'hi' }), /Only the players/);
await assert.rejects(call(B, '/chess/chat', 'POST', { id: game.id, text: '   ' }), /Type a message/);
let v = (await call(B, '/chess/game', 'GET', {}, 'id=' + game.id)).game;
assert.equal(v.chat.length, 1); assert.equal(v.chat[0].text, 'gg'); assert.equal(v.chat[0].mine, false);
assert.equal((await call(A, '/chess/game', 'GET', {}, 'id=' + game.id)).game.chat[0].mine, true);
// rematch: swaps colours, reserved for the opponent, second click joins
await assert.rejects(call(C, '/chess/rematch', 'POST', { id: game.id }), /Only the players/);
const r1 = (await call(A, '/chess/rematch', 'POST', { id: game.id })).game;
assert.equal(r1.status, 'waiting'); assert.equal(r1.my_color, 'black');
assert.equal((await call(C, '/chess/lobby')).open.length, 0);
assert.equal((await call(B, '/chess/lobby')).open[0].rematch, true);
await assert.rejects(call(C, '/chess/join', 'POST', { id: r1.id }), /reserved/);
assert.equal((await call(A, '/chess/rematch', 'POST', { id: game.id })).game.id, r1.id);
const r2 = (await call(B, '/chess/rematch', 'POST', { id: game.id })).game;
assert.equal(r2.id, r1.id); assert.equal(r2.status, 'active'); assert.equal(r2.my_color, 'white');
// draw offers: offer, decline, accept, mutual offer, recipient move clears
const g2 = r2.id;
await assert.rejects(call(C, '/chess/draw', 'POST', { id: g2, action: 'offer' }), /Only the players/);
await call(B, '/chess/move', 'POST', { id: g2, from: 'e2', to: 'e4' });
let d1 = (await call(B, '/chess/draw', 'POST', { id: g2, action: 'offer' })).game;
assert.equal(d1.draw.by_me, true);
await assert.rejects(call(B, '/chess/draw', 'POST', { id: g2, action: 'accept' }), /no draw offer/);
assert.equal((await call(A, '/chess/game', 'GET', {}, 'id=' + g2)).game.draw.by_me, false);
assert.equal((await call(A, '/chess/draw', 'POST', { id: g2, action: 'decline' })).game.draw, null);
await call(A, '/chess/move', 'POST', { id: g2, from: 'e7', to: 'e5' });
await call(B, '/chess/move', 'POST', { id: g2, from: 'g1', to: 'f3' });
// A offers again after moving; B cannot spam, and a mutual offer ends the game as a draw
await call(A, '/chess/draw', 'POST', { id: g2, action: 'offer' });
await assert.rejects(call(A, '/chess/draw', 'POST', { id: g2, action: 'offer' }), /already offered/);
const agreed = (await call(B, '/chess/draw', 'POST', { id: g2, action: 'offer' })).game;
assert.equal(agreed.status, 'finished'); assert.equal(agreed.winner, null); assert.equal(agreed.result_reason, 'agreement');
// accept path + recipient move clears the offer
const g3 = (await call(A, '/chess/rematch', 'POST', { id: g2 })).game; await call(B, '/chess/rematch', 'POST', { id: g2 });
const x = (await call(A, '/chess/game', 'GET', {}, 'id=' + g3.id)).game; assert.equal(x.status, 'active');
const white = x.my_color === 'white' ? A : B, black = white === A ? B : A;
await call(white, '/chess/move', 'POST', { id: g3.id, from: 'e2', to: 'e4' });
await call(white, '/chess/draw', 'POST', { id: g3.id, action: 'offer' });
await call(black, '/chess/move', 'POST', { id: g3.id, from: 'e7', to: 'e5' });
assert.equal((await call(white, '/chess/game', 'GET', {}, 'id=' + g3.id)).game.draw, null);
await call(white, '/chess/move', 'POST', { id: g3.id, from: 'g1', to: 'f3' });
await call(black, '/chess/draw', 'POST', { id: g3.id, action: 'offer' });
const acc = (await call(white, '/chess/draw', 'POST', { id: g3.id, action: 'accept' })).game;
assert.equal(acc.status, 'finished'); assert.equal(acc.result_reason, 'agreement');
console.log('chess tests passed');

// increment, positions for move review, notifications
notes.length = 0;
const D = { id: 'd', name: 'Di' }, F = { id: 'f', name: 'Flo' };
const ig = (await call(D, '/chess/new', 'POST', { color: 'white', minutes: 3, inc: 2 })).game;
assert.equal(ig.inc, 2); assert.equal((await call(F, '/chess/lobby')).open[0].inc, 2);
await call(F, '/chess/join', 'POST', { id: ig.id });
assert.ok(notes.some(n => n.type === 'chess_join' && n.ids[0] === 'd' && n.gid === ig.id), 'host is told when someone joins');
const m1 = (await call(D, '/chess/move', 'POST', { id: ig.id, from: 'e2', to: 'e4' })).game;
assert.ok(m1.white_time_ms > 3 * 60e3, 'increment added to the mover');
assert.equal(m1.places.length, 2); assert.equal(m1.moves[0].uci, 'e2e4');
assert.ok(notes.some(n => n.type === 'chess_turn' && n.ids[0] === 'f'), 'a quiet opponent is told it is their turn');
notes.length = 0;
await call(F, '/chess/move', 'POST', { id: ig.id, from: 'e7', to: 'e5' });
await call(D, '/chess/move', 'POST', { id: ig.id, from: 'g1', to: 'f3' });
assert.ok(!notes.some(n => n.type === 'chess_turn'), 'no ping while the opponent is actively playing');
assert.equal((await call(await Promise.resolve(F), '/chess/new', 'POST', { minutes: 5, inc: 7 })).game.inc, 0, 'unknown increment falls back to none');
await call(D, '/chess/resign', 'POST', { id: ig.id });
notes.length = 0; await call(D, '/chess/rematch', 'POST', { id: ig.id });
assert.ok(notes.some(n => n.type === 'chess_rematch' && n.ids[0] === 'f'));

// spectating: live games appear for non-players only, and can be read
{ const X = { id: 'x', name: 'Xi' }, Y = { id: 'y', name: 'Yo' }, Z = { id: 'z', name: 'Zed' };
  const g = (await call(X, '/chess/new', 'POST', { color: 'white', minutes: 3 })).game;
  assert.equal((await call(Z, '/chess/lobby')).live.length, 0);
  await call(Y, '/chess/join', 'POST', { id: g.id });
  const l = await call(Z, '/chess/lobby');
  assert.equal(l.live.length, 1); assert.equal(l.live[0].white, 'Xi'); assert.equal(l.live[0].black, 'Yo');
  assert.equal((await call(X, '/chess/lobby')).live.length, 0);
  const sv = (await call(Z, '/chess/game', 'GET', {}, 'id=' + g.id)).game;
  assert.equal(sv.my_color, null); assert.deepEqual(sv.legal_moves, []);
  console.log('spectator tests passed'); }

// presence + auto-abort
{ const P = { id: 'p', name: 'Pia' }, Q = { id: 'q', name: 'Quin' };
  const g = (await call(P, '/chess/new', 'POST', { color: 'white', minutes: 3 })).game;
  const j = (await call(Q, '/chess/join', 'POST', { id: g.id })).game;
  assert.deepEqual(j.online, { white: true, black: true }, 'both start online');
  const key = 'chess:g:' + g.id, raw = JSON.parse(mem.get(key));
  raw.seen.black = Date.now() - 120e3; mem.set(key, JSON.stringify(raw));
  const v1 = (await call(P, '/chess/game', 'GET', {}, 'id=' + g.id)).game;
  assert.equal(v1.online.black, false, 'a silent player shows as away');
  const v2 = (await call(Q, '/chess/game', 'GET', {}, 'id=' + g.id)).game;
  assert.equal(v2.online.black, true, 'reading the game marks you online again');
  // nobody moves for 90 s: aborted, no winner
  const raw2 = JSON.parse(mem.get(key)); raw2.turnAt = Date.now() - 100e3; mem.set(key, JSON.stringify(raw2));
  const v3 = (await call(P, '/chess/game', 'GET', {}, 'id=' + g.id)).game;
  assert.equal(v3.status, 'finished'); assert.equal(v3.result_reason, 'aborted'); assert.equal(v3.winner, null);
  assert.equal((await call(P, '/chess/lobby')).mine.some(x => x.id === g.id), false, 'aborted game leaves the lobby');
  // after two moves the abort rule no longer applies
  const h = (await call(P, '/chess/new', 'POST', { color: 'white', minutes: 3 })).game; await call(Q, '/chess/join', 'POST', { id: h.id });
  await call(P, '/chess/move', 'POST', { id: h.id, from: 'e2', to: 'e4' }); await call(Q, '/chess/move', 'POST', { id: h.id, from: 'e7', to: 'e5' });
  const r3 = JSON.parse(mem.get('chess:g:' + h.id)); r3.turnAt = Date.now() - 100e3; mem.set('chess:g:' + h.id, JSON.stringify(r3));
  assert.equal((await call(P, '/chess/game', 'GET', {}, 'id=' + h.id)).game.status, 'active');
  console.log('presence + abort tests passed'); }

// friend challenge: only friends, reserved table, notification, others cannot join or see it
{
  const D = { id: 'd', name: 'Di' };
  await assert.rejects(call(A, '/chess/new', 'POST', { minutes: 5, to: 'd' }), /only challenge your friends/);
  await assert.rejects(call(A, '/chess/new', 'POST', { minutes: 5, to: 'a' }), /only challenge your friends/);
  notes.length = 0;
  const ch = (await call(A, '/chess/new', 'POST', { minutes: 3, inc: 2, color: 'white', to: 'b' })).game;
  assert.ok(notes.some(n => n.type === 'chess_challenge' && n.ids[0] === 'b' && n.gid === ch.id));
  const lb = (await call(B, '/chess/lobby')).open.find(x => x.id === ch.id);
  assert.equal(lb.challenge, true); assert.equal(lb.rematch, false);
  assert.equal((await call(D, '/chess/lobby')).open.some(x => x.id === ch.id), false);
  await assert.rejects(call(D, '/chess/join', 'POST', { id: ch.id }), /reserved/);
  const j = (await call(B, '/chess/join', 'POST', { id: ch.id })).game;
  assert.equal(j.status, 'active'); assert.equal(j.inc, 2);
  console.log('challenge tests passed');
}

// long-poll: a held request wakes as soon as the opponent moves; a stale rev answers at once
{
  const P = { id: 'p', name: 'Pat' }, Q = { id: 'q', name: 'Quin' };
  const gm = (await call(P, '/chess/new', 'POST', { color: 'white', minutes: 5 })).game;
  await call(Q, '/chess/join', 'POST', { id: gm.id });
  const cur = (await call(Q, '/chess/game', 'GET', {}, 'id=' + gm.id)).game;
  let t0 = Date.now();
  const held = call(Q, '/chess/game', 'GET', {}, 'id=' + gm.id + '&since=' + cur.rev + '&wait=1');
  setTimeout(() => call(P, '/chess/move', 'POST', { id: gm.id, from: 'e2', to: 'e4' }), 120);
  const woke = (await held).game;
  assert.equal(woke.moves.length, 1); assert.ok(Date.now() - t0 < 1500, 'long-poll should wake fast');
  t0 = Date.now();
  const stale = (await call(Q, '/chess/game', 'GET', {}, 'id=' + gm.id + '&since=1&wait=1')).game;   // old rev: no waiting
  assert.equal(stale.moves.length, 1); assert.ok(Date.now() - t0 < 300);
  // a flagged mover is settled inside the move call itself
  await call(Q, '/chess/move', 'POST', { id: gm.id, from: 'e7', to: 'e5' });
  const raw = JSON.parse(mem.get('chess:g:' + gm.id)); raw.turnAt = Date.now() - 10 * 60e3; mem.set('chess:g:' + gm.id, JSON.stringify(raw));
  const late = (await call(P, '/chess/move', 'POST', { id: gm.id, from: 'g1', to: 'f3' })).game;
  assert.equal(late.status, 'finished'); assert.equal(late.result_reason, 'timeout'); assert.equal(late.winner, 'black');
  console.log('long-poll + inline settle tests passed');
}

// abandonment: a table nobody has been on for 1 minute disappears; finished games are not kept
{
  const U = { id: 'u', name: 'Uma' }, W = { id: 'w', name: 'Wes' };
  const old = (id, ms) => { const r = JSON.parse(mem.get('chess:g:' + id)); r.created = r.updated = Date.now() - ms; r.seen = { white: Date.now() - ms, black: Date.now() - ms }; mem.set('chess:g:' + id, JSON.stringify(r)); };
  const age = (ms) => { const ix = JSON.parse(mem.get('chess:idx')); ix.games.forEach(x => { if (x.host.id === 'u') x.t = Date.now() - ms; }); mem.set('chess:idx', JSON.stringify(ix)); };
  const t1 = (await call(U, '/chess/new', 'POST', { color: 'white', minutes: 5 })).game;
  assert.equal((await call(W, '/chess/lobby')).open.filter(o => o.host === 'Uma').length, 1);
  old(t1.id, 70e3); age(70e3);
  assert.equal((await call(W, '/chess/lobby')).open.filter(o => o.host === 'Uma').length, 0, 'abandoned table leaves the lobby');
  await assert.rejects(call(W, '/chess/join', 'POST', { id: t1.id }), /expired/);
  await assert.rejects(call(U, '/chess/game', 'GET', {}, 'id=' + t1.id), /closed|not found/);
  const t2 = (await call(U, '/chess/new', 'POST', { color: 'white', minutes: 5 })).game;
  await call(W, '/chess/join', 'POST', { id: t2.id });
  old(t2.id, 70e3); age(70e3);
  await assert.rejects(call(W, '/chess/game', 'GET', {}, 'id=' + t2.id), /closed|not found/);
  console.log('abandon tests passed');
}
