// CrewCamp Games: Chess API (routes /api/chess/*). Server-authoritative like ChessLAN; polling instead of websockets (Netlify Functions).
// Storage (Netlify Blobs, base store): chess:g:<id> = one game, chess:idx = lobby index of waiting/active games. Games are global (not per server).
import { randomBytes } from 'node:crypto';
import * as E from './chess-engine.mjs';

const ID = /^[a-f0-9]{10}$/, IDX = 'chess:idx', GK = id => 'chess:g:' + id;
const WAIT_MS = 30 * 60e3, STALE_MS = 2 * 864e5, MINUTES = [1, 3, 5, 10, 15, 30], INCS = [0, 1, 2, 3, 5, 10], PING_GAP = 45e3, ABORT_MS = 90e3, SEEN_GAP = 15e3, ONLINE_MS = 40e3, MAX_OPEN = 30, CHAT_MAX = 100;
const PUB = u => ({ id: u.id, name: u.name || u.username });

export async function chessApi({ path, m, body, me, bs, mutate, J, H, query, notify, areFriends }) {
  const now = Date.now();
  const idxMut = fn => mutate(bs, IDX, () => ({ games: [] }), d => { d.games = d.games.filter(g => now - g.t < (g.s === 'waiting' ? WAIT_MS : STALE_MS)); return fn(d); });
  const load = async id => { if (!ID.test(String(id || ''))) throw H('Game not found.', 404); const g = await bs.get(GK(id), { type: 'json' }); if (!g) throw H('Game not found.', 404); return g; };
  const mine = g => g.white?.id === me.id ? 'white' : g.black?.id === me.id ? 'black' : null;
  const clocks = g => {
    let w = g.whiteMs, b = g.blackMs;
    if (g.status === 'active') { const el = now - g.turnAt; if (g.turn === 'white') w = Math.max(0, w - el); else b = Math.max(0, b - el); }
    return [w, b];
  };
  const finish = (g, winner, reason) => { const [w, b] = clocks(g); g.whiteMs = w; g.blackMs = b; g.status = 'finished'; g.winner = winner; g.reason = reason; g.updated = now; };
  const view = g => {
    const s = E.parseFen(g.fen), my = mine(g), [w, b] = clocks(g);
    const legal = g.status === 'active' && my && my === g.turn ? E.legalMoves(s).map(E.uci) : [];
    const last = g.moves.length ? g.moves[g.moves.length - 1].uci : null;
    const chk = g.status !== 'waiting' && E.inCheck(s);
    return {
      id: g.id, status: g.status, fen: g.fen, turn: g.turn, winner: g.winner, result_reason: g.reason, minutes: g.minutes, inc: g.inc || 0,
      white: g.white, black: g.black, my_color: my, white_time_ms: w, black_time_ms: b, moves: g.moves.map(x => ({ san: x.san, color: x.color, uci: x.uci })), places: g.hist.map(k => k.split(' ')[0]),
      last_move: last ? { from: last.slice(0, 2), to: last.slice(2, 4) } : null, legal_moves: legal,
      in_check: chk, in_check_square: chk ? E.sqName(E.parseFen(g.fen).b.indexOf(s.turn === 'white' ? 'K' : 'k')) : null,
      captured: E.captured(s), rev: g.updated,
      online: g.status === 'active' ? { white: now - (g.seen?.white || 0) < ONLINE_MS, black: now - (g.seen?.black || 0) < ONLINE_MS } : null,
      chat: (g.chat || []).slice(-50).map(c => ({ name: c.n, mine: c.i === me.id, t: c.t, text: c.x })),
      draw: g.status === 'active' && g.draw ? { by_me: g.draw.by === my } : null,
      rematch: g.rematch ? { id: g.rematch.id, by_me: g.rematch.by === me.id } : null,
    };
  };
  // flag a timeout on read, so a vanished opponent still loses on time
  const settle = async id => mutate(bs, GK(id), () => { throw H('Game not found.', 404); }, async g => {
    if (g.status === 'active' && g.moves.length < 2 && now - g.turnAt > ABORT_MS) { finish(g, null, 'aborted'); await idxMut(d => { d.games = d.games.filter(x => x.id !== g.id); }); return g; }   // nobody opened with a move: abort, no result
    if (g.status === 'active') { const [w, b] = clocks(g); if ((g.turn === 'white' ? w : b) <= 0) { finish(g, g.turn === 'white' ? 'black' : 'white', 'timeout'); await idxMut(d => { d.games = d.games.filter(x => x.id !== g.id); }); } }
    return g;
  });

  if (path === '/chess/lobby' && m === 'GET') {
    const d = (await bs.get(IDX, { type: 'json' })) || { games: [] };
    const open = d.games.filter(g => g.s === 'waiting' && now - g.t < WAIT_MS && g.host.id !== me.id && (!g.inv || g.inv === me.id)).map(g => ({ id: g.id, host: g.host.name, minutes: g.minutes, inc: g.inc || 0, color: g.hostColor, rematch: !!g.rem, challenge: !!g.inv && !g.rem }));
    const own = d.games.filter(g => g.p.includes(me.id) && (g.s === 'waiting' ? now - g.t < WAIT_MS : now - g.t < STALE_MS)).map(g => ({ id: g.id, status: g.s, minutes: g.minutes, inc: g.inc || 0, vs: g.s === 'waiting' ? null : g.p2name[g.host.id === me.id ? 1 : 0] }));
    const live = d.games.filter(g => g.s === 'active' && !g.p.includes(me.id) && now - g.t < STALE_MS).sort((a, b) => b.t - a.t).slice(0, 20).map(g => ({ id: g.id, white: g.p2name[0], black: g.p2name[1], minutes: g.minutes, inc: g.inc || 0 }));
    return J({ open, mine: own, live });
  }
  if (path === '/chess/game' && m === 'GET') {
    const id = query.get('id'); await load(id);
    const g = await settle(id);
    if (!mine(g) && g.status === 'waiting') throw H('That game is waiting for an opponent. Join it from the lobby.', 403);
    const my = mine(g);
    if (my && g.status === 'active' && now - (g.seen?.[my] || 0) > SEEN_GAP) {   // throttled presence stamp; does not touch rev
      try { const g2 = await mutate(bs, GK(id), () => { throw H('Game not found.', 404); }, x => { x.seen = { ...(x.seen || {}), [my]: now }; return x; }); return J({ game: view(g2) }); } catch (e) { /* presence is best effort */ }
    }
    return J({ game: view(g) });
  }
  if (path === '/chess/new' && m === 'POST') {
    const minutes = MINUTES.includes(+body.minutes) ? +body.minutes : 10;
    const inc = INCS.includes(+body.inc) ? +body.inc : 0;
    const pick = ['white', 'black', 'random'].includes(body.color) ? body.color : 'random';
    const color = pick === 'random' ? (randomBytes(1)[0] & 1 ? 'white' : 'black') : pick;
    const to = body.to ? String(body.to) : '';
    if (to && (to === me.id || !areFriends || !(await areFriends(to)))) throw H('You can only challenge your friends.', 403);
    const id = randomBytes(5).toString('hex');
    const g = { id, white: color === 'white' ? PUB(me) : null, black: color === 'black' ? PUB(me) : null, ...(to ? { invite: to } : {}), minutes, whiteMs: minutes * 6e4, blackMs: minutes * 6e4, inc, turnAt: 0,
      status: 'waiting', turn: 'white', fen: E.START_FEN, hist: [E.posKey(E.START_FEN)], moves: [], chat: [], winner: null, reason: null, created: now, updated: now };
    await idxMut(d => {
      if (d.games.some(x => x.s === 'waiting' && x.host.id === me.id)) throw H('You already have an open game. Cancel it first.');
      if (d.games.filter(x => x.s === 'waiting').length >= MAX_OPEN) throw H('The lobby is full. Join a game instead.');
      d.games.push({ id, s: 'waiting', t: now, host: PUB(me), hostColor: color, minutes, inc, p: [me.id], p2name: [], ...(to ? { inv: to } : {}) });
    });
    await bs.setJSON(GK(id), g);
    if (to && notify) await notify(bs, [to], { type: 'chess_challenge', by: me.id, byName: PUB(me).name, gid: id });
    return J({ game: view(g) });
  }
  const doJoin = async id => {
    await load(id);
    const g = await mutate(bs, GK(id), () => { throw H('Game not found.', 404); }, g => {
      if (g.status !== 'waiting') throw H('That game already started.');
      if (mine(g)) throw H('You created this game. Wait for an opponent.');
      if (g.invite && g.invite !== me.id) throw H('That table is reserved for another player.', 403);
      if (now - g.created > WAIT_MS) throw H('That game expired.');
      if (!g.white) g.white = PUB(me); else g.black = PUB(me);
      g.status = 'active'; g.turnAt = now; g.updated = now; g.seen = { white: now, black: now }; return g;
    });
    await idxMut(d => { const x = d.games.find(y => y.id === g.id); if (x) { x.s = 'active'; x.t = now; x.p = [g.white.id, g.black.id]; x.p2name = [g.white.name, g.black.name]; } });
    const host = g.white.id === me.id ? g.black : g.white;
    if (notify && host) await notify(bs, [host.id], { type: 'chess_join', by: me.id, byName: PUB(me).name, gid: g.id });
    return g;
  };
  if (path === '/chess/join' && m === 'POST') return J({ game: view(await doJoin(body.id)) });
  if (path === '/chess/chat' && m === 'POST') {
    await load(body.id);
    const text = String(body.text || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
    if (!text) throw H('Type a message first.');
    const g = await mutate(bs, GK(body.id), () => { throw H('Game not found.', 404); }, g => {
      if (!mine(g)) throw H('Only the players can chat.', 403);
      if (!g.white || !g.black) throw H('Chat opens when an opponent joins.');
      g.chat = g.chat || [];
      if (g.chat.length && g.chat[g.chat.length - 1].i === me.id && now - g.chat[g.chat.length - 1].t < 500) throw H('Slow down a little.', 429);
      g.chat.push({ i: me.id, n: PUB(me).name, t: now, x: text }); if (g.chat.length > CHAT_MAX) g.chat = g.chat.slice(-CHAT_MAX);
      g.updated = now; return g;
    });
    return J({ game: view(g) });
  }
  if (path === '/chess/rematch' && m === 'POST') {
    await load(body.id);
    const nid = randomBytes(5).toString('hex'); let made = false, opp = null, color = 'white', minutes = 10, inc = 0;
    const old = await mutate(bs, GK(body.id), () => { throw H('Game not found.', 404); }, g => {
      made = false;
      const my = mine(g); if (!my) throw H('Only the players can rematch.', 403);
      if (g.status !== 'finished' || !g.white || !g.black || g.reason === 'cancelled') throw H('Only a finished game can be replayed.');
      if (!g.rematch) { g.rematch = { id: nid, by: me.id }; made = true; }
      opp = my === 'white' ? g.black : g.white; color = my === 'white' ? 'black' : 'white'; minutes = g.minutes; inc = g.inc || 0;
      return g;
    });
    const rid = old.rematch.id;
    if (made) {
      const g = { id: rid, white: color === 'white' ? PUB(me) : null, black: color === 'black' ? PUB(me) : null, invite: opp.id, minutes, inc, whiteMs: minutes * 6e4, blackMs: minutes * 6e4, turnAt: 0,
        status: 'waiting', turn: 'white', fen: E.START_FEN, hist: [E.posKey(E.START_FEN)], moves: [], chat: [], winner: null, reason: null, created: now, updated: now };
      await idxMut(d => { d.games.push({ id: rid, s: 'waiting', t: now, host: PUB(me), hostColor: color, minutes, inc, p: [me.id], p2name: [], inv: opp.id, rem: 1 }); });
      await bs.setJSON(GK(rid), g);
      if (notify) await notify(bs, [opp.id], { type: 'chess_rematch', by: me.id, byName: PUB(me).name, gid: rid });
      return J({ game: view(g) });
    }
    if (old.rematch.by === me.id) return J({ game: view(await load(rid)) });
    try { return J({ game: view(await doJoin(rid)) }); }
    catch (e) { if (e.status === 404 || /already started|expired/.test(e.message)) throw H('That rematch is no longer available. Start a new game from the lobby.'); throw e; }
  }
  if (path === '/chess/cancel' && m === 'POST') {
    await load(body.id);
    await mutate(bs, GK(body.id), () => ({}), g => { if (!mine(g) || g.status !== 'waiting') throw H('Cannot cancel this game.'); g.status = 'finished'; g.reason = 'cancelled'; g.updated = now; });
    await idxMut(d => { d.games = d.games.filter(x => x.id !== body.id); });
    return J({ ok: 1 });
  }
  if (path === '/chess/move' && m === 'POST') {
    await load(body.id); await settle(body.id);
    let ended = false, ping = null;
    const g = await mutate(bs, GK(body.id), () => { throw H('Game not found.', 404); }, g => {
      ping = null;
      const my = mine(g);
      if (!my) throw H('You are not a player in this game.', 403);
      if (g.status !== 'active') throw H('The game is not active.');
      if (g.turn !== my) throw H('It is not your turn.');
      const s = E.parseFen(g.fen), from = E.sqIdx(String(body.from || '')), to = E.sqIdx(String(body.to || ''));
      if (!/^[a-h][1-8]$/.test(String(body.from)) || !/^[a-h][1-8]$/.test(String(body.to))) throw H('Malformed move.');
      const cands = E.legalMoves(s).filter(x => x.from === from && x.to === to);
      if (!cands.length) throw H('Illegal move.');
      const promo = String(body.promotion || '').toLowerCase();
      let mv = cands[0];
      if (cands.some(x => x.promo)) { if (!'qrbn'.includes(promo) || !promo) { const e = H('Choose a promotion piece.'); e.extra = { promotion_required: true }; throw e; } mv = cands.find(x => x.promo === promo); }
      if (g.draw && g.draw.by !== my) g.draw = null;   // moving on = declining the offer
      const [w, b] = clocks(g); g.whiteMs = w; g.blackMs = b; g.turnAt = now;
      if (g.inc) { if (my === 'white') g.whiteMs += g.inc * 1000; else g.blackMs += g.inc * 1000; }
      const opp = my === 'white' ? 'black' : 'white', oppSeen = g.act?.[opp] || 0;
      g.act = { ...(g.act || {}), [my]: now };
      const sanTxt = E.san(s, mv), ns = E.apply(s, mv), fen = E.toFen(ns);
      g.moves.push({ san: sanTxt, uci: E.uci(mv), color: my }); g.fen = fen; g.turn = ns.turn; g.hist.push(E.posKey(fen)); g.updated = now;
      const o = E.outcome(ns, g.hist); if (o) { finish(g, o.winner, o.reason); ended = true; }
      if (!ended && now - oppSeen > PING_GAP) ping = g[opp].id;   // opponent has been quiet: nudge them (live players already see the board)
      return g;
    });
    if (ended) await idxMut(d => { d.games = d.games.filter(x => x.id !== g.id); }); else await idxMut(d => { const x = d.games.find(y => y.id === g.id); if (x) x.t = now; });
    if (ping && notify) await notify(bs, [ping], { type: 'chess_turn', by: me.id, byName: PUB(me).name, gid: g.id });
    return J({ game: view(g) });
  }
  if (path === '/chess/draw' && m === 'POST') {
    await load(body.id); await settle(body.id);
    const act = ['offer', 'accept', 'decline'].includes(body.action) ? body.action : 'offer';
    let ended = false;
    const g = await mutate(bs, GK(body.id), () => { throw H('Game not found.', 404); }, g => {
      const my = mine(g); if (!my) throw H('Only the players can offer a draw.', 403);
      if (g.status !== 'active') throw H('The game is not active.');
      if (act === 'offer') {
        if (g.draw && g.draw.by !== my) { finish(g, null, 'agreement'); g.draw = null; ended = true; return g; }   // both want it
        if (g.draw) throw H('You already offered a draw.');
        if (g.drawn?.[my] != null && g.moves.length <= g.drawn[my]) throw H('Make a move before offering again.');
        g.drawn = { ...(g.drawn || {}), [my]: g.moves.length }; g.draw = { by: my }; g.updated = now; return g;
      }
      if (!g.draw || g.draw.by === my) throw H('There is no draw offer to answer.');
      if (act === 'accept') { finish(g, null, 'agreement'); ended = true; } else g.updated = now;
      g.draw = null; return g;
    });
    if (ended) await idxMut(d => { d.games = d.games.filter(x => x.id !== g.id); });
    return J({ game: view(g) });
  }
  if (path === '/chess/resign' && m === 'POST') {
    await load(body.id);
    const g = await mutate(bs, GK(body.id), () => ({}), g => {
      const my = mine(g); if (!my || g.status !== 'active') throw H('Cannot resign this game.');
      finish(g, my === 'white' ? 'black' : 'white', 'resignation'); return g;
    });
    await idxMut(d => { d.games = d.games.filter(x => x.id !== g.id); });
    return J({ game: view(g) });
  }
  return null;   // not a chess route
}
