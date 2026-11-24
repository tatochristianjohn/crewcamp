// Server-side chess rules (JS port of the python-chess logic used by ChessLAN). The client never decides legality.
// Board: array of 64, index 0 = a8 ... 63 = h1. Pieces: 'PNBRQK' white, 'pnbrqk' black, null empty.
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const F = 'abcdefgh';
export const sqName = i => F[i % 8] + (8 - (i >> 3));
export const sqIdx = s => (8 - Number(s[1])) * 8 + F.indexOf(s[0]);
const isW = p => p === p.toUpperCase();
const N_D = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const K_D = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const B_D = [[-1, -1], [-1, 1], [1, -1], [1, 1]], R_D = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function parseFen(fen) {
  const [pl, turn, cas, ep, hm, fm] = fen.split(' ');
  const b = [];
  for (const ch of pl) { if (ch === '/') continue; if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) b.push(null); else b.push(ch); }
  return { b, turn: turn === 'w' ? 'white' : 'black', cas: cas === '-' ? '' : cas, ep: ep === '-' ? null : sqIdx(ep), hm: +hm || 0, fm: +fm || 1 };
}
export function toFen(s) {
  let out = '';
  for (let r = 0; r < 8; r++) { let e = 0; for (let f = 0; f < 8; f++) { const p = s.b[r * 8 + f]; if (!p) e++; else { if (e) out += e; e = 0; out += p; } } if (e) out += e; if (r < 7) out += '/'; }
  return `${out} ${s.turn === 'white' ? 'w' : 'b'} ${s.cas || '-'} ${s.ep == null ? '-' : sqName(s.ep)} ${s.hm} ${s.fm}`;
}
export const posKey = fen => fen.split(' ').slice(0, 4).join(' ');

function attacked(s, sq, byWhite) {   // is `sq` attacked by the given colour?
  const { b } = s, r = sq >> 3, f = sq & 7, at = (rr, ff) => (rr < 0 || rr > 7 || ff < 0 || ff > 7) ? null : b[rr * 8 + ff];
  const pr = byWhite ? r + 1 : r - 1;
  for (const df of [-1, 1]) if (at(pr, f + df) === (byWhite ? 'P' : 'p')) return true;
  for (const [dr, df] of N_D) if (at(r + dr, f + df) === (byWhite ? 'N' : 'n')) return true;
  for (const [dr, df] of K_D) if (at(r + dr, f + df) === (byWhite ? 'K' : 'k')) return true;
  for (const [ds, set] of [[B_D, byWhite ? 'BQ' : 'bq'], [R_D, byWhite ? 'RQ' : 'rq']])
    for (const [dr, df] of ds) { let rr = r + dr, ff = f + df; while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) { const p = b[rr * 8 + ff]; if (p) { if (set.includes(p)) return true; break; } rr += dr; ff += df; } }
  return false;
}
const kingSq = (s, white) => s.b.indexOf(white ? 'K' : 'k');
export const inCheck = (s, white = s.turn === 'white') => attacked(s, kingSq(s, white), !white);

function pseudo(s) {
  const mv = [], w = s.turn === 'white', { b } = s;
  for (let i = 0; i < 64; i++) {
    const p = b[i]; if (!p || isW(p) !== w) continue;
    const r = i >> 3, f = i & 7, t = p.toLowerCase();
    const add = (to, extra = {}) => mv.push({ from: i, to, ...extra });
    if (t === 'p') {
      const dir = w ? -1 : 1, start = w ? 6 : 1, last = w ? 0 : 7, r1 = r + dir;
      const push = to => { if ((to >> 3) === last) for (const pr of 'qrbn') add(to, { promo: pr }); else add(to); };
      if (r1 >= 0 && r1 < 8 && !b[r1 * 8 + f]) { push(r1 * 8 + f); if (r === start && !b[(r + 2 * dir) * 8 + f]) add((r + 2 * dir) * 8 + f, { dbl: true }); }
      for (const df of [-1, 1]) { const ff = f + df; if (ff < 0 || ff > 7 || r1 < 0 || r1 > 7) continue; const to = r1 * 8 + ff, q = b[to];
        if (q && isW(q) !== w) push(to); else if (!q && s.ep === to) add(to, { ep: true }); }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, df] of (t === 'n' ? N_D : K_D)) { const rr = r + dr, ff = f + df; if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue; const q = b[rr * 8 + ff]; if (!q || isW(q) !== w) add(rr * 8 + ff); }
      if (t === 'k') {   // castling: king not in check, path empty and not attacked
        const row = w ? 7 : 0, ks = w ? 'K' : 'k', qs = w ? 'Q' : 'q';
        if (i === row * 8 + 4 && !attacked(s, i, !w)) {
          if (s.cas.includes(ks) && !b[row * 8 + 5] && !b[row * 8 + 6] && b[row * 8 + 7] === (w ? 'R' : 'r') && !attacked(s, row * 8 + 5, !w) && !attacked(s, row * 8 + 6, !w)) add(row * 8 + 6, { castle: 'k' });
          if (s.cas.includes(qs) && !b[row * 8 + 3] && !b[row * 8 + 2] && !b[row * 8 + 1] && b[row * 8] === (w ? 'R' : 'r') && !attacked(s, row * 8 + 3, !w) && !attacked(s, row * 8 + 2, !w)) add(row * 8 + 2, { castle: 'q' });
        }
      }
    } else {
      const ds = t === 'b' ? B_D : t === 'r' ? R_D : [...B_D, ...R_D];
      for (const [dr, df] of ds) { let rr = r + dr, ff = f + df; while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) { const q = b[rr * 8 + ff]; if (!q) add(rr * 8 + ff); else { if (isW(q) !== w) add(rr * 8 + ff); break; } rr += dr; ff += df; } }
    }
  }
  return mv;
}

export function apply(s, m) {   // returns a NEW state
  const b = s.b.slice(), w = s.turn === 'white', p = b[m.from], t = p.toLowerCase(), cap = b[m.to] || m.ep;
  b[m.to] = m.promo ? (w ? m.promo.toUpperCase() : m.promo) : p; b[m.from] = null;
  if (m.ep) b[m.to + (w ? 8 : -8)] = null;
  if (m.castle) { const row = w ? 7 : 0; if (m.castle === 'k') { b[row * 8 + 5] = b[row * 8 + 7]; b[row * 8 + 7] = null; } else { b[row * 8 + 3] = b[row * 8]; b[row * 8] = null; } }
  let cas = s.cas; const strip = c => { cas = cas.replace(c, ''); };
  if (t === 'k') w ? (strip('K'), strip('Q')) : (strip('k'), strip('q'));
  for (const [sq, c] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === sq || m.to === sq) strip(c);
  return { b, turn: w ? 'black' : 'white', cas, ep: m.dbl ? (m.from + m.to) / 2 : null, hm: (t === 'p' || cap) ? 0 : s.hm + 1, fm: s.fm + (w ? 0 : 1) };
}
export function legalMoves(s) { const w = s.turn === 'white'; return pseudo(s).filter(m => !inCheck(apply(s, m), w)); }
export const uci = m => sqName(m.from) + sqName(m.to) + (m.promo || '');

export function san(s, m, legal = legalMoves(s)) {
  const p = s.b[m.from], t = p.toUpperCase(); let out;
  if (m.castle) out = m.castle === 'k' ? 'O-O' : 'O-O-O';
  else {
    const cap = s.b[m.to] || m.ep;
    if (t === 'P') out = (cap ? F[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    else {
      const others = legal.filter(o => o.to === m.to && o.from !== m.from && s.b[o.from] === p);
      let dis = ''; if (others.length) { const sf = others.some(o => (o.from & 7) === (m.from & 7)), sr = others.some(o => (o.from >> 3) === (m.from >> 3)); dis = !sf ? F[m.from & 7] : !sr ? String(8 - (m.from >> 3)) : sqName(m.from); }
      out = t + dis + (cap ? 'x' : '') + sqName(m.to);
    }
  }
  const n = apply(s, m), nl = legalMoves(n);
  return out + (inCheck(n) ? (nl.length ? '+' : '#') : '');
}

export function insufficient(s) {
  const ps = s.b.map((p, i) => p && p.toLowerCase() !== 'k' ? [p.toLowerCase(), i] : null).filter(Boolean);
  if (!ps.length) return true;
  if (ps.length === 1 && 'bn'.includes(ps[0][0])) return true;
  if (ps.every(([t]) => t === 'b')) { const c = new Set(ps.map(([, i]) => ((i >> 3) + (i & 7)) % 2)); return c.size === 1; }
  return false;
}

// Result after a move. `hist` = array of posKey strings for every position reached (including `s`).
export function outcome(s, hist) {
  const legal = legalMoves(s);
  if (!legal.length) return inCheck(s) ? { winner: s.turn === 'white' ? 'black' : 'white', reason: 'checkmate' } : { winner: null, reason: 'stalemate' };
  if (insufficient(s)) return { winner: null, reason: 'insufficient_material' };
  const k = posKey(toFen(s)), reps = hist.filter(x => x === k).length;
  if (s.hm >= 150) return { winner: null, reason: 'seventyfive_move_rule' };
  if (reps >= 5) return { winner: null, reason: 'fivefold_repetition' };
  if (s.hm >= 100) return { winner: null, reason: 'fifty_move_rule' };
  if (reps >= 3) return { winner: null, reason: 'threefold_repetition' };
  return null;
}
export function captured(s) {
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 }, out = { white: [], black: [] };
  for (const [t, n] of Object.entries(start)) {
    const wn = s.b.filter(p => p === t.toUpperCase()).length, bn = s.b.filter(p => p === t).length;
    for (let i = 0; i < n - wn; i++) out.white.push(t);   // white pieces that were taken
    for (let i = 0; i < n - bn; i++) out.black.push(t);
  }
  return out;
}
// perft for self-test
export function perft(s, d) { if (!d) return 1; let n = 0; for (const m of legalMoves(s)) n += perft(apply(s, m), d - 1); return n; }
