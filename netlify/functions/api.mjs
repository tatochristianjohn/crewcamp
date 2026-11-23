// CrewCamp - Netlify Function API (routes: /api/*)
// Storage: Netlify Blobs. Sessions: HttpOnly cookie + revocable server-side session blob.
import { getStore } from '@netlify/blobs';
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
const H = (m, s = 400) => new HttpError(s, m);

const base = () => getStore({ name: 'taskboard', consistency: 'strong' });
// SERVERS: keys shared / tags / chat:* live in a per-server namespace (sv:<id>:<key>); the default 'cepalco' server keeps the original un-prefixed keys. Everything else (users, boards, friends, DMs, posts, notifications, sessions) is global.
const SCOPED = /^(shared|tags|chat:|board:|depts)/;   // board:<uid> = that person's PERSONAL notes, kept inside each server (CEPALCO keeps the original un-prefixed keys)
const DEF_SV = 'cepalco', SV_ID = /^s_[a-f0-9]{8}$/, MAX_OWN = 5, MAX_MEM = 100, SV_NAME = 'CEPALCO Server';
const svKey = (id, k) => id !== DEF_SV && SCOPED.test(k) ? `sv:${id}:${k}` : k;
const scoped = (b, cur) => ({ get: (k, o) => b.get(svKey(cur(), k), o), getWithMetadata: (k, o) => b.getWithMetadata(svKey(cur(), k), o), setJSON: (k, d, o) => b.setJSON(svKey(cur(), k), d, o), delete: k => b.delete(svKey(cur(), k)) });
const LOGO_COOLDOWN = 15 * 864e5, LOGO_MAX = 24 * 1024;   // server logo: one change per 15 days; the browser sends a ~96px WebP (typically 2-6 KB), hard cap 24 KB
const LOGO_MAGIC = { 'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8, 'image/png': b => b.subarray(1, 4).toString() === 'PNG', 'image/webp': b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' };
const KEYROLE = [['adminCode', 'admin'], ['hostCode', 'host'], ['code', 'staff']];   // 3 passkeys per server: Head / Supervisor / Staff ('code' = the original staff invite code)
const roleByCode = (rec, code) => { for (const [f, role] of KEYROLE) if (rec && rec[f] && same(rec[f], code)) return role; return null; };
const codesOf = rec => ({ admin: rec?.adminCode || '', host: rec?.hostCode || '', staff: rec?.code || '' });
const newCode = () => Array.from(randomBytes(8), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
const J = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h } });
const today = () => new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10);   // Manila date (UTC+8), not the server's UTC date
const hp = (pw, salt) => scryptSync(pw, salt, 64).toString('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const uniq = a => [...new Set(Array.isArray(a) ? a.map(String) : [])];

const ROLES = ['admin', 'host', 'staff'];            // admin = head, host = supervisor, staff
const DEFAULT_ADMIN = 'u_admin';                       // only the original admin account may use the all-users overview
const PRIORITIES = ['Now', 'Next', 'Later'];
const THEMES = ['white', 'dark', 'midnight', 'graphite', 'ocean', 'forest', 'lavender', 'sunset', 'sand', 'pink', 'cepalco'];
const PALETTE = { Now: ['#cbfec9', '#ebd3ff', '#dfc3ff'], Next: ['#fff3a1', '#c3e2ff'], Later: ['#ffd1ea', '#cbfec9'] };
const UN = /^[a-z0-9_.-]{3,30}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-f]{3,8}$/i;
const COOKIE = 'stb_sess', SESSION_MS = 30 * 864e5;
const AVATAR_COOLDOWN = 15 * 864e5, AVATAR_MAX = 250 * 1024;   // profile picture: one change per 15 days, <= 250 KB
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
const CH_ID = /^[a-z0-9-]{1,24}$/, CHAT_MAX = 300, CHAT_SHOW = 80, MAX_CH = 6;   // group chat: channel slug, messages kept per channel, messages sent per poll, channel cap
const CALL_MS = 90e3;   // "in a call" = my browser said so in one of its polls in the last 90 s (a background tab polls at least every 25 s while a call is open)
const ONLINE_MS = 75e3, TYPING_MS = 7e3;                                          // "online" = polled in the last 75 s (a background tab polls every 60 s); "typing" = typed in the last 7 s
const ROLE_ORDER = { admin: 0, host: 1, staff: 2 };
const MAX_TAGS = 20, TAG_ID = /^[a-z0-9-]{1,18}$/;   // custom roles ("tags"): id = slug of the name; each one owns a private chat channel called <id>-chat (<= 23 chars)
const slug = (v, n) => String(v || '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+/, '').slice(0, n).replace(/-+$/, '');
const tagChan = id => id + '-chat';
const POST_MAX = 500, REPLY_MAX = 300, POST_KEEP = 200, REPLY_KEEP = 100;   // profile posts: characters per post · per reply · posts kept per person · replies per post
const MAX_FR = 40, DM_MAX = 100, DM_OPEN = 3, UID = /^[\w-]{1,40}$/;   // friends: cap per person · private messages kept per conversation · conversations sent per poll · user-id shape
// File attachments (group chat + private messages). Kept deliberately light on Netlify: the browser shrinks pictures to ~100-300 KB first,
// anything else is capped at 1 MB, the file travels as raw bytes (no base64), polls only carry ~100 bytes of metadata per file, and every file
// disappears 15 minutes after it was shared (download refused + blob deleted on access, and swept by netlify/functions/sweep.mjs every 15 min).
const ATT_MS = 15 * 60e3, ATT_MAX = 1024 * 1024, ATT_PER_USER = 6;   // lifetime · max bytes · files one person may share per lifetime window
const ATT_ID = /^\d{13}_[a-f0-9]{16}$/;                              // <expiry ms>_<random>: the expiry is part of the blob key, so a sweep needs no reads
const ATT_BAD_EXT = /\.(exe|bat|cmd|com|scr|msi|dll|js|mjs|vbs|ps1|jar|apk|html?|svg|xhtml|php|sh)$/i;
const ATT_IMG = { 'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8, 'image/png': b => b.subarray(1, 4).toString() === 'PNG', 'image/webp': b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP', 'image/gif': b => b.subarray(0, 3).toString() === 'GIF' };
const attDTO = a => ({ id: a.id, name: a.name, type: a.type, size: a.size, exp: a.exp, img: !!ATT_IMG[a.type], gone: Date.now() >= a.exp });
const attName = v => String(v || 'file').replace(/[\\/]+/g, '/').split('/').pop().replace(/[\u0000-\u001f"<>:*?|]/g, '').trim().slice(0, 80) || 'file';

// ---------- storage helpers ----------
// Read-modify-write with optimistic concurrency (retries if someone else wrote first).
async function mutate(st, key, init, fn) {
  for (let i = 0; i < 6; i++) {
    const r = await st.getWithMetadata(key, { type: 'json' });
    const data = r ? r.data : await init();
    const out = await fn(data);
    const w = await st.setJSON(key, data, r ? { onlyIfMatch: r.etag } : { onlyIfNew: true });
    if (w && w.modified === false) continue;
    return out;
  }
  throw H('Busy, please try again.', 409);
}

const normUser = u => ({ ...u, role: ROLES.includes(u.role) ? u.role : 'staff', hostIds: Array.isArray(u.hostIds) ? u.hostIds : [], tagIds: Array.isArray(u.tagIds) ? uniq(u.tagIds) : [], pv: Number.isInteger(u.pv) ? u.pv : 0, profileHidden: !!u.profileHidden });

async function usersInit() {
  const pw = process.env.ADMIN_INITIAL_PASSWORD;
  if (!pw || pw.length < 8) throw H('Setup needed: set the ADMIN_INITIAL_PASSWORD environment variable (8+ characters) in Netlify, then redeploy.', 500);
  const salt = randomBytes(8).toString('hex');
  return [{ id: 'u_admin', username: 'admin', name: 'Administrator', role: 'admin', active: true, salt, hash: hp(pw, salt), created: today(), hostIds: [] }];
}
async function getUsers(st) {
  let r = await st.getWithMetadata('users', { type: 'json' });
  if (!r) { await st.setJSON('users', await usersInit(), { onlyIfNew: true }); r = await st.getWithMetadata('users', { type: 'json' }); }
  return r.data.map(normUser);
}
const mutUsers = (st, fn) => mutate(st, 'users', usersInit, us => { us.forEach(u => Object.assign(u, normUser(u))); return fn(us); });
const mutShared = (st, fn) => mutate(st, 'shared', () => ({ tasks: [] }), fn);

// ---------- friends + private messages ----------
// Storage: fr:<userId> = { f:[friend ids], in:[requests I received], out:[requests I sent] } · dm:<idA>~<idB> (ids sorted) = { rev, msgs[] }.
// Each side keeps its own list, so a request touches two blobs; the lists are only trusted from the viewer's own side.
const frInit = () => ({ f: [], in: [], out: [] });
const frGet = async (st, id) => { const d = await st.get('fr:' + id, { type: 'json' }); return d ? { f: uniq(d.f), in: uniq(d.in), out: uniq(d.out) } : frInit(); };
const mutFr = (st, id, fn) => mutate(st, 'fr:' + id, frInit, d => { d.f = uniq(d.f); d.in = uniq(d.in); d.out = uniq(d.out); return fn(d); });
const frState = (f, id) => f.f.includes(id) ? 'friends' : f.out.includes(id) ? 'sent' : f.in.includes(id) ? 'received' : 'none';
const dmKey = (a, b) => 'dm:' + [a, b].sort().join('~');
// a and b become friends (any pending request between them is cleared)
const frLink = async (st, a, b) => { for (const [x, y] of [[a, b], [b, a]]) await mutFr(st, x, d => { d.in = d.in.filter(i => i !== y); d.out = d.out.filter(i => i !== y); if (!d.f.includes(y)) d.f.push(y); }); };
// remove every tie between a and b: decline, cancel or unfriend
const frDrop = async (st, a, b) => { for (const [x, y] of [[a, b], [b, a]]) await mutFr(st, x, d => { d.f = d.f.filter(i => i !== y); d.in = d.in.filter(i => i !== y); d.out = d.out.filter(i => i !== y); }); };
const dmMsg = (m, me) => ({ id: m.id, uid: m.uid, text: m.text, ts: m.ts, edited: !!m.edited, mine: m.uid === me.id, ...(m.att ? { att: attDTO(m.att) } : {}) });   // private: only the author may edit or delete, nobody else (Heads included) can read

// ---------- notifications (bell next to the profile picture) ----------
const NOTIF_MAX = 50;   // newest notifications kept per user
// Push one notification to each recipient (never to the actor). Best-effort: a failure here must not break the task action.
async function notify(st, toIds, n) {
  for (const id of uniq(toIds)) {
    if (id === n.by) continue;
    try {
      await mutate(st, 'notif:' + id, () => ({ items: [] }), d => {
        d.items.unshift({ id: 'n_' + randomBytes(5).toString('hex'), t: Date.now(), read: false, ...n });
        d.items.length = Math.min(d.items.length, NOTIF_MAX);
      });
    } catch {}
  }
}

// ---------- custom roles ("tags") ----------
// Storage: tags = [{id,name}] · users[].tagIds = [tagId] · chat:channels entries with a `tag` field are private to people holding that tag.
const tagsRaw = async st => (await st.get('tags', { type: 'json' })) || [];
const mutTags = (st, fn) => mutate(st, 'tags', () => [], fn);
const cleanTags = (ids, tags) => uniq(ids).filter(id => tags.some(t => t.id === id));
// Make chat:channels match the tag list (one <id>-chat channel per tag, none for deleted tags). Returns the channel ids it removed.
const ensureTagChannels = (st, tags) => mutate(st, 'chat:channels', () => [{ id: 'general', name: 'general' }], list => {
  const gone = [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].tag && !tags.some(t => t.id === list[i].tag)) gone.push(list.splice(i, 1)[0].id);
  for (const t of tags) if (!list.some(c => c.tag === t.id)) list.push({ id: tagChan(t.id), name: tagChan(t.id), tag: t.id });
  return gone;
});

const pub = (u, all) => ({
  id: u.id, username: u.username, name: u.name, role: u.role, active: u.active, created: u.created, mustChange: !!u.mustChange,
  avatarAt: u.avatarAt || 0, avatarNext: u.avatarAt ? u.avatarAt + AVATAR_COOLDOWN : 0, profileHidden: !!u.profileHidden,
  hostIds: u.role === 'staff' ? u.hostIds : [], headIds: u.role === 'host' ? (u.headIds || []) : [], tagIds: u.tagIds || [],
  hostNames: u.role === 'staff' ? u.hostIds.map(id => all.find(x => x.id === id)?.name).filter(Boolean) : [],
});
// A person who set their profile to "hidden for viewing" shows only their name and role to others; Heads (admins) and the person themself still see everything.
const canSee = (u, me, inSrv = true) => !u.profileHidden || u.id === me.id || (me.role === 'admin' && inSrv);   // Heads see hidden profiles only of people in their own server (profiles themselves are global)
const avAt = (u, me) => (u && u.avatarAt && canSee(u, me) ? u.avatarAt : 0);
const activeAdmins = us => us.filter(u => u.role === 'admin' && u.active).length;

// ---------- permissions & DTOs ----------
const assignable = (me, us) =>
  me.role === 'admin' ? us.filter(u => u.active && u.role !== 'admin')   // Heads assign to Supervisors and Staff only: never to themselves or any other Head (incl. the default admin)
  : me.role === 'host' ? us.filter(u => u.active && u.role === 'staff' && u.hostIds.includes(me.id)) : [];
const hostsFor = (ids, us) => uniq(ids.flatMap(id => { const u = us.find(x => x.id === id); return u && u.role === 'staff' ? u.hostIds : []; }));
const canManage = (me, t) => me.role === 'admin' || (me.role === 'host' && (t.createdBy === me.id || t.hostIds.includes(me.id)));
const isMine = (me, t) => t.assignees.find(a => a.id === me.id);
const visible = (me, t) => canManage(me, t) || (isMine(me, t) && t.status === 'active');

function taskDTO(t, me, us) {
  const nm = id => us.find(u => u.id === id)?.name || 'Deleted user';
  const mine = isMine(me, t);
  return {
    id: t.id, title: t.title, description: t.description, priority: t.priority, date: t.date, status: t.status,
    pinned: !!t.pinned, color: t.color, created: t.created, createdBy: t.createdBy, createdByName: nm(t.createdBy),
    assignees: t.assignees.map(a => ({ id: a.id, name: nm(a.id), done: !!a.done, doneAt: a.doneAt || null })),
    complete: t.assignees.length > 0 && t.assignees.every(a => a.done),
    canManage: canManage(me, t), mine: !!mine, myDone: !!(mine && mine.done),
  };
}

function cleanFields(b, creating) {
  const o = {};
  if (creating || 'title' in b) { const v = String(b.title || '').trim().slice(0, 120); if (!v) throw H('Task title is required'); o.title = v; }
  if (creating || 'description' in b) o.description = String(b.description || '').trim().slice(0, 500);
  if (creating || 'priority' in b) { if (!PRIORITIES.includes(b.priority)) throw H('Invalid priority'); o.priority = b.priority; }
  if (creating || 'date' in b) { if (!DATE.test(String(b.date || ''))) throw H('Pick a valid date'); o.date = b.date; }
  if ('pinned' in b) o.pinned = !!b.pinned;
  return o;
}

function cleanBoard(b) {
  const s = (v, n) => String(v ?? '').slice(0, n);
  return {
    theme: THEMES.includes(b.theme) ? b.theme : 'white',
    tasks: b.tasks.slice(0, 5000).map(t => ({
      id: s(t.id, 40), date: DATE.test(String(t.date)) ? t.date : today(), title: s(t.title, 120), description: s(t.description, 500),
      priority: PRIORITIES.includes(t.priority) ? t.priority : 'Next', status: ['active', 'done', 'trash'].includes(t.status) ? t.status : 'active',
      pinned: !!t.pinned, favorite: !!t.favorite, color: COLOR.test(String(t.color)) ? t.color : '#fff3a1',
      created: s(t.created, 10), completed: s(t.completed, 10),
    })).filter(t => t.id && t.title),
  };
}

// ---------- group chat ----------
// Storage: chat:channels = [{id,name}] · chat:<channel> = { rev, msgs[] } (rev bumps on every send/edit/delete) · pres:<userId> = { t, ty } (heartbeat + typing)
const chanRaw = async st => (await st.get('chat:channels', { type: 'json' })) || [{ id: 'general', name: 'general' }];
const chanList = async (st, me) => (await chanRaw(st)).filter(c => !c.tag || me.tagIds.includes(c.tag));   // a role's channel exists only for people holding that role (Heads included: they must tag themselves to join)
const mutChat = (st, ch, fn) => mutate(st, 'chat:' + ch, () => ({ rev: 0, msgs: [] }), fn);
const chatMsg = (m, me, us) => {
  const u = us.find(x => x.id === m.uid);
  return { id: m.id, uid: m.uid, name: u ? (u.name || u.username) : 'Deleted user', role: u ? u.role : 'staff', avatarAt: avAt(u, me),
    text: m.text, ts: m.ts, edited: !!m.edited, mine: m.uid === me.id, canDel: m.uid === me.id || me.role === 'admin', ...(m.att ? { att: attDTO(m.att) } : {}) };   // Heads can remove anyone's message; only the author can edit
};
const chatText = (v, allowEmpty) => { const t = String(v ?? '').trim().slice(0, 1000); if (!t && !allowEmpty) throw H('Type a message first.'); return t; };
const parseSeenU = q => Object.fromEntries(String(q || '').split(',').map(p => p.split(':')).filter(([k, v]) => UID.test(k || '') && v !== '' && Number(v) >= 0).map(([k, v]) => [k, Number(v)]));   // same as parseSeen but for user ids (letters, digits, _ -)
const parseSeen = q => Object.fromEntries(String(q || '').split(',').map(p => p.split(':')).filter(([k, v]) => CH_ID.test(k || '') && v !== '' && Number(v) >= 0).map(([k, v]) => [k, Number(v)]));

// ---------- handler ----------
export default async (req) => {
  try {
    const bs = base();
    let SV = DEF_SV;
    const st = scoped(bs, () => SV);
    const path = new URL(req.url).pathname.replace(/^\/api/, '').replace(/\/$/, '');
    const m = req.method;
    let body = {};
    if ((m === 'POST' || m === 'PUT') && !(m === 'POST' && path === '/attach')) {   // /attach carries raw file bytes, not JSON
      if (!(req.headers.get('content-type') || '').includes('application/json')) throw H('JSON required', 415);
      const raw = await req.text();
      try { body = raw.trim() ? (JSON.parse(raw) || {}) : {}; } catch { throw H('Bad JSON'); }
    }

    // ----- server logo (public image, immutable: the URL carries ?v=<logoAt>, so browsers/CDN fetch it once per change) -----
    const lg = path.match(/^\/server-logo\/(cepalco|s_[a-f0-9]{8})$/);
    if (lg && m === 'GET') {
      const a = await bs.get('svlogo:' + lg[1], { type: 'json' });
      if (!a) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
      return new Response(Buffer.from(a.b64, 'base64'), { status: 200, headers: { 'Content-Type': a.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Netlify-CDN-Cache-Control': 'public, max-age=31536000, durable', 'X-Content-Type-Options': 'nosniff' } });
    }

    // ----- sign up with the CEPALCO Server invite code (public) -----
    if (path === '/signup' && m === 'POST') {
      const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const ip = String(req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'x').split(',')[0].replace(/[^0-9a-fA-F.:]/g, '').slice(0, 45) || 'x';
      const fk = 'fail:signup:' + ip, f = await st.get(fk, { type: 'json' }), now = Date.now();
      if (f && f.until > now) throw H('Too many wrong codes. Try again in 15 minutes.', 429);
      const meta = await bs.get('svmeta:cepalco', { type: 'json' });
      const sRole = code.length === 8 ? roleByCode(meta, code) : null;
      if (!sRole) {
        const n = (f && !(f.until && f.until <= now) ? f.count : 0) + 1;
        await st.setJSON(fk, { count: n, until: n >= MAX_FAILS ? now + LOCK_MS : 0 });
        await new Promise(r => setTimeout(r, 400));
        throw H('Invalid invite code.', 404);
      }
      const un = String(body.username || '').trim().toLowerCase();
      if (!UN.test(un)) throw H('Username: 3–30 letters, numbers, . _ -');
      if (String(body.password || '').length < 6) throw H('Password must be at least 6 characters.');
      let nu;
      await mutUsers(st, list => {
        if (list.some(x => x.username === un)) throw H('Username already exists.');
        if (list.length >= 500) throw H('This server is full.');
        const salt = randomBytes(8).toString('hex');
        nu = { id: 'u_' + randomBytes(6).toString('hex'), username: un, name: String(body.name || '').trim().slice(0, 60) || un, role: sRole, active: true, salt, hash: hp(body.password, salt), created: today(), hostIds: [], tagIds: [] };
        list.push(nu);
      });
      if (f) await st.delete(fk);
      const token = randomBytes(24).toString('hex');
      await st.setJSON('sess:' + token, { id: nu.id, pv: nu.pv, exp: now + SESSION_MS });
      return J({ user: pub(nu, await getUsers(st)) }, 201, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS / 1000}` });
    }

    // ----- login (public) -----
    if (path === '/login' && m === 'POST') {
      const un = String(body.username || '').trim().toLowerCase(), pw = String(body.password || '');
      if (!un || !pw) throw H('Enter your username and password.');
      const fk = 'fail:' + (un.replace(/[^a-z0-9_.-]/g, '').slice(0, 40) || 'x');
      const f = await st.get(fk, { type: 'json' });
      const now = Date.now();
      if (f && f.until > now) throw H('Too many failed attempts. Try again in 15 minutes.', 429);
      const us = await getUsers(st);
      const u = us.find(x => x.username === un);
      const ok = u ? (hp(pw, u.salt), u.active && same(u.hash, hp(pw, u.salt))) : (hp(pw, '00'), false);
      if (!ok) {
        const n = (f && !(f.until && f.until <= now) ? f.count : 0) + 1;
        await st.setJSON(fk, { count: n, until: n >= MAX_FAILS ? now + LOCK_MS : 0 });
        await new Promise(r => setTimeout(r, 400));
        throw H('Wrong username or password, or account disabled.', 401);
      }
      if (f) await st.delete(fk);
      const token = randomBytes(24).toString('hex');
      await st.setJSON('sess:' + token, { id: u.id, pv: u.pv, exp: now + SESSION_MS });
      return J({ user: pub(u, us) }, 200, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS / 1000}` });
    }

    // ----- Google sign-in config (public: the client ID is not a secret) -----
    if (path === '/config' && m === 'GET') return J({ googleClientId: process.env.GOOGLE_CLIENT_ID || '', video: true });

    // ----- Google sign up / sign in (public) -----
    // The browser sends the ID token from Google Identity Services; Google's tokeninfo endpoint verifies its signature and expiry,
    // and we check it was issued for OUR client ID and that the email is verified. First time = account created, after that = log in.
    if (path === '/google' && m === 'POST') {
      const cid = process.env.GOOGLE_CLIENT_ID;
      if (!cid) throw H('Google sign-in is not set up yet (GOOGLE_CLIENT_ID is missing).', 503);
      const cred = String(body.credential || '');
      if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(cred) || cred.length > 4096) throw H('Invalid Google sign-in.', 401);
      const vf = body.mode === 'verify', su = body.mode === 'signup';   // verify = step 1 of sign up (Google button first, nothing created); signup = step 2 with first/last name, user ID and password; otherwise log in (existing accounts only)
      let sd = null;
      if (su) {
        const fn = String(body.firstName || '').trim().slice(0, 30), ln = String(body.lastName || '').trim().slice(0, 30);
        sd = { fn, ln, nm: (fn + ' ' + ln).trim(), un: String(body.username || '').trim().toLowerCase(), pw: String(body.password || '') };
        if (!fn) throw H('Enter your first name.');
        if (!ln) throw H('Enter your last name.');
        if (!UN.test(sd.un)) throw H('User ID: 3–30 letters, numbers, . _ -');
        if (sd.pw.length < 6) throw H('Password must be at least 6 characters.');
      }
      let g;
      try {
        const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred));
        g = r.ok ? await r.json() : null;
      } catch { throw H('Could not reach Google. Try again.', 502); }
      const now = Date.now();
      if (!g || g.aud !== cid || !['accounts.google.com', 'https://accounts.google.com'].includes(g.iss) || !g.sub || Number(g.exp) * 1000 < now || String(g.email_verified) !== 'true' || !g.email)
        throw H('Google sign-in failed. Please try again.', 401);
      const email = String(g.email).trim().toLowerCase();
      const allowed = String(process.env.GOOGLE_ALLOWED_DOMAINS || '').toLowerCase().split(/[\s,]+/).filter(Boolean);   // optional: e.g. "mycompany.com"
      if (allowed.length && !allowed.includes(email.split('@')[1])) throw H('This Google account is not allowed to join.', 403);
      if (vf) {   // step 1: the Google account is real; tell the page its name + whether it already has an account. Nothing is created yet.
        const ex = (await getUsers(st)).find(x => x.googleSub === g.sub || x.email === email);
        if (ex) throw H('This Google account already has an account. Tap Log in instead.', 409);
        return J({ email, firstName: String(g.given_name || '').slice(0, 30), lastName: String(g.family_name || '').slice(0, 30) });
      }
      let u, created = false;
      await mutUsers(st, list => {
        u = list.find(x => x.googleSub === g.sub) || list.find(x => x.email === email);
        if (u) {
          if (su) throw H('This Google account already has an account. Tap Log in instead.', 409);
          if (!u.active) throw H('This account is disabled.', 401);
          if (!u.googleSub) u.googleSub = g.sub;
          return;
        }
        if (!su) throw H('No account for this Google account yet. Tap Register first.', 404);
        if (list.length >= 500) throw H('This server is full.');
        if (list.some(x => x.username === sd.un)) throw H('That user ID is already taken.');
        const salt = randomBytes(8).toString('hex');
        u = { id: 'u_' + randomBytes(6).toString('hex'), username: sd.un, name: sd.nm, firstName: sd.fn, lastName: sd.ln, role: 'staff', active: true, salt, hash: hp(sd.pw, salt), created: today(), hostIds: [], tagIds: [], noDef: true, email, googleSub: g.sub };   // new accounts belong to NO server until they use a passkey / link   // the password they chose also works for the normal Log in form
        list.push(u); created = true;
      });
      const token = randomBytes(24).toString('hex');
      await st.setJSON('sess:' + token, { id: u.id, pv: u.pv || 0, exp: now + SESSION_MS });
      return J({ user: pub(u, await getUsers(st)), created }, created ? 201 : 200, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS / 1000}` });
    }

    // ----- session cookie -----
    const ck = (req.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
    const token = ck ? ck.slice(COOKIE.length + 1) : '';

    // ----- logout (public on purpose: it must work even if the session already expired) -----
    if (path === '/logout' && m === 'POST') {
      if (/^[a-f0-9]{48}$/.test(token)) await st.delete('sess:' + token);
      return J({ ok: 1 }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
    }

    // ----- everything below needs a session -----
    const sess = /^[a-f0-9]{48}$/.test(token) ? await st.get('sess:' + token, { type: 'json' }) : null;
    if (!sess || sess.exp < Date.now()) throw H('Not logged in', 401);
    const allUs = await getUsers(st);   // every account (global)
    const meG = allUs.find(x => x.id === sess.id && x.active);
    if (!meG || (sess.pv || 0) !== meG.pv) throw H('Not logged in', 401);   // disabled user, or password changed/reset since this login

    const isSuper = meG.id === DEFAULT_ADMIN;   // the default admin is also the platform admin: sees and manages every server (Admin page)
    // ----- servers registry (global, works whatever X-Server says) -----
    const srvList = async () => (await st.get('servers', { type: 'json' })) || [];
    const mutSrv = fn => mutate(st, 'servers', () => [], fn);
    const svName = n => { const t = String(n || '').trim().replace(/\s+/g, ' ').slice(0, 30); if (t.length < 2) throw H('Server name: 2–30 characters.'); return t; };
    const dropMember = async (sid, uid) => {   // remove a person's position/role traces from one server's shared tasks + other members' supervisor links
      await mutate(bs, svKey(sid, 'shared'), () => ({ tasks: [] }), sh => sh.tasks.forEach(t => { t.assignees = t.assignees.filter(a => a.id !== uid); t.hostIds = t.hostIds.filter(h => h !== uid); if (!t.assignees.length) t.status = 'trash'; }));
    };
    // ----- unread chat per server (the badges on the server rail): every server I am in, every channel I can see there (global; ignores X-Server) -----
    // body.seen = { <serverId>: "ch:ts,ch:ts" } (what this browser has read). A server missing from it was never opened in this browser: nothing is unread yet, and `last` lets the browser record a baseline.
    if (path === '/servers/unread' && m === 'POST') {
      const list = await srvList(), sn = body.seen && typeof body.seen === 'object' ? body.seen : {};
      const svs = [DEF_SV, ...list.filter(x => x.members[meG.id]).map(x => x.id)];
      const out = {};
      await Promise.all(svs.map(async sid => {
        const tagIds = sid === DEF_SV ? (meG.tagIds || []) : (list.find(v => v.id === sid).members[meG.id].tagIds || []);
        const chans = ((await bs.get(svKey(sid, 'chat:channels'), { type: 'json' })) || [{ id: 'general', name: 'general' }]).filter(c => !c.tag || tagIds.includes(c.tag));   // same rule as the chat itself: role channels only for people holding the role
        const datas = await Promise.all(chans.map(c => bs.get(svKey(sid, 'chat:' + c.id), { type: 'json' })));
        const known = typeof sn[sid] === 'string' && sn[sid] ? parseSeen(sn[sid]) : null, last = {};
        let unread = 0;
        chans.forEach((c, i) => {
          const msgs = (datas[i] || { msgs: [] }).msgs;
          last[c.id] = msgs.at(-1)?.ts || 0;
          if (known) unread += msgs.filter(x => x.uid !== meG.id && x.ts > (known[c.id] ?? 0)).length;   // a channel created since the browser last looked: all of it is new
        });
        out[sid] = { unread: Math.min(99, unread), last };
      }));
      return J({ servers: out });
    }
    if (path === '/servers' && m === 'GET') {
      const list = await srvList();
      const dm = await bs.get('svmeta:cepalco', { type: 'json' });
      const def = { logoAt: dm?.logoAt || 0, ...((meG.role === 'admin' || isSuper) ? { code: dm?.code || '', codes: codesOf(dm) } : {}), id: DEF_SV, name: SV_NAME, owner: meG.id === DEFAULT_ADMIN, role: meG.role, members: allUs.filter(u => u.active && !u.noDef).length, createdBy: allUs.find(u => u.id === DEFAULT_ADMIN)?.name || 'Administrator', isDefault: true };
      const mine = list.filter(x => x.members[meG.id]).map(x => ({ logoAt: x.logoAt || 0, id: x.id, name: x.name, owner: x.ownerId === meG.id, role: x.members[meG.id].role, members: Object.keys(x.members).length, createdBy: allUs.find(u => u.id === x.ownerId)?.name || 'Unknown', ...(x.members[meG.id].role === 'admin' ? { code: x.code, codes: codesOf(x) } : {}) }));
      return J({ servers: [...(meG.noDef && !isSuper ? [] : [def]), ...mine], superAdmin: isSuper, noServer: !!meG.noDef && !isSuper && !mine.length });
    }
    if (path === '/servers' && m === 'POST') {
      const name = svName(body.name);
      const out = await mutSrv(list => {
        if (list.filter(x => x.ownerId === meG.id).length >= MAX_OWN) throw H(`You can own up to ${MAX_OWN} servers.`);
        const x = { id: 's_' + randomBytes(4).toString('hex'), name, ownerId: meG.id, created: today(), code: newCode(), hostCode: newCode(), adminCode: newCode(), members: { [meG.id]: { role: 'admin', hostIds: [], tagIds: [] } } };
        list.push(x); return x;
      });
      return J({ id: out.id, name: out.name, code: out.code }, 201);
    }
    if (path === '/servers/join' && m === 'POST') {   // any of a server's 3 passkeys: Head / Supervisor / Staff
      const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 8) throw H('Enter the 8-character passkey.');
      const dmeta = await bs.get('svmeta:cepalco', { type: 'json' }), dRole = roleByCode(dmeta, code);
      if (dRole) {   // CEPALCO Server: membership = account without the noDef flag
        let already = false;
        await mutUsers(st, list => { const u = list.find(x => x.id === meG.id); if (!u.noDef) { already = true; return; } delete u.noDef; u.role = dRole; u.hostIds = []; });
        if (already) throw H('You are already in that server.');
        return J({ id: DEF_SV, name: SV_NAME, role: dRole });
      }
      let role = 'staff';
      const out = await mutSrv(list => {
        const x = list.find(v => roleByCode(v, code));
        if (!x) throw H('Invalid passkey.', 404);
        if (x.members[meG.id]) throw H('You are already in that server.');
        if (Object.keys(x.members).length >= MAX_MEM) throw H('That server is full.');
        role = roleByCode(x, code);
        x.members[meG.id] = { role, hostIds: [], tagIds: [] }; return x;
      });
      return J({ id: out.id, name: out.name, role });
    }
    const lgm = path.match(/^\/servers\/(cepalco|s_[a-f0-9]{8})\/logo$/);
    if (lgm && m === 'POST') {   // change the server logo (server Head); once per 15 days, enforced here
      const sid = lgm[1];
      const mt = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(body.image || ''));
      if (!mt) throw H('Please choose a JPG, PNG or WebP image.');
      const buf = Buffer.from(mt[2], 'base64');
      if (buf.length > LOGO_MAX) throw H('Logo is too large (max 24 KB after resizing).', 413);
      if (!LOGO_MAGIC[mt[1]](buf)) throw H('That file is not a valid image.');
      let at = 0;
      const apply = async rec => {   // rec = the object that holds logoAt
        const wait = (rec.logoAt || 0) + LOGO_COOLDOWN - Date.now();
        if (rec.logoAt && wait > 0) throw H(`The server logo can be changed again in ${Math.ceil(wait / 864e5)} day(s).`, 429);
        await bs.setJSON('svlogo:' + sid, { type: mt[1], b64: mt[2] });
        rec.logoAt = at = Date.now();
      };
      if (sid === DEF_SV) {
        if (meG.role !== 'admin' && !isSuper) throw H('Only a server Head can change the logo.', 403);
        await mutate(bs, 'svmeta:cepalco', () => ({}), apply);
      } else {
        await mutSrv(async list => { const x = list.find(v => v.id === sid); if (!x || (x.members[meG.id]?.role !== 'admin' && !isSuper)) throw H('Only a server Head can change the logo.', 403); await apply(x); });
      }
      return J({ ok: 1, logoAt: at, logoNext: at + LOGO_COOLDOWN });
    }
    if (path === '/servers/cepalco/invite' && (m === 'POST' || m === 'DELETE')) {   // CEPALCO sign-up code: create / renew (POST) or turn off (DELETE)
      if (meG.role !== 'admin' && !isSuper) throw H('Only a server Head can do that.', 403);
      const f = (KEYROLE.find(([, rl]) => rl === body.role) || KEYROLE[2])[0];   // which passkey (default: staff)
      const code = await mutate(bs, 'svmeta:cepalco', () => ({}), rec => { if (m === 'POST') rec[f] = newCode(); else delete rec[f]; return rec[f] || null; });
      return J({ code, role: KEYROLE.find(([g]) => g === f)[1] });
    }
    const svm = path.match(/^\/servers\/(s_[a-f0-9]{8})(?:\/(leave|invite))?$/);
    if (svm) {
      const sid = svm[1], act = svm[2];
      if (!act && m === 'PUT') {   // rename (server Head)
        const name = svName(body.name);
        await mutSrv(list => { const x = list.find(v => v.id === sid); if (!x || (x.members[meG.id]?.role !== 'admin' && !isSuper)) throw H('Only a server Head can rename it.', 403); x.name = name; });
        return J({ ok: 1 });
      }
      if (act === 'invite' && m === 'POST') {   // new invite code (server Head)
        const code = await mutSrv(list => { const x = list.find(v => v.id === sid); if (!x || (x.members[meG.id]?.role !== 'admin' && !isSuper)) throw H('Only a server Head can do that.', 403); const f = (KEYROLE.find(([, rl]) => rl === body.role) || KEYROLE[2])[0]; return (x[f] = newCode()); });
        return J({ code });
      }
      if (act === 'leave' && m === 'POST') {
        await mutSrv(list => {
          const x = list.find(v => v.id === sid); if (!x || !x.members[meG.id]) throw H('Server not found', 404);
          if (x.ownerId === meG.id) throw H('The owner cannot leave. Delete the server instead.');
          delete x.members[meG.id];
          Object.values(x.members).forEach(mm => { mm.hostIds = mm.hostIds.filter(h => h !== meG.id); });
        });
        await dropMember(sid, meG.id);
        return J({ ok: 1 });
      }
      if (!act && m === 'DELETE') {   // owner deletes the server and everything in it
        let gone;
        await mutSrv(list => {
          const i = list.findIndex(v => v.id === sid); if (i < 0) throw H('Server not found', 404);
          if (list[i].ownerId !== meG.id && !isSuper) throw H('Only the server owner can delete it.', 403);
          gone = list.splice(i, 1)[0];
        });
        const chans = (await bs.get(svKey(sid, 'chat:channels'), { type: 'json' })) || [];
        for (const k of ['shared', 'tags', 'chat:channels', 'chat:general', ...chans.map(c => 'chat:' + c.id)]) await bs.delete(svKey(sid, k));
        for (const uid of Object.keys(gone?.members || {})) await bs.delete(svKey(sid, 'board:' + uid));
        await bs.delete('svlogo:' + sid);
        return J({ ok: 1 });
      }
    }


    // ----- platform admin (default admin only): every server, its people and contents; create / transfer / delete -----
    if (path.startsWith('/admin/')) {
      if (!isSuper) throw H('Not allowed', 403);
      const nameOf = id => allUs.find(u => u.id === id)?.name || allUs.find(u => u.id === id)?.username || null;
      // ----- global accounts (not tied to any server): list / create / edit / delete -----
      if (path === '/admin/accounts' && m === 'GET') {
        const svs = await srvList();
        return J({ accounts: allUs.map(u => ({ id: u.id, username: u.username, name: u.name, active: u.active, admin: u.id === DEFAULT_ADMIN, mustChange: !!u.mustChange, created: u.created, servers: [SV_NAME, ...svs.filter(x => x.members && x.members[u.id]).map(x => x.name)] })) });
      }
      if (path === '/admin/accounts' && m === 'POST') {
        const un = String(body.username || '').trim().toLowerCase();
        if (!UN.test(un)) throw H('Username: 3–30 letters, numbers, . _ -');
        if (String(body.password || '').length < 6) throw H('Password must be at least 6 characters.');
        await mutUsers(st, list => {
          if (list.some(x => x.username === un)) throw H('Username already exists.');
          const salt = randomBytes(8).toString('hex');
          list.push({ id: 'u_' + randomBytes(6).toString('hex'), username: un, name: String(body.name || '').trim().slice(0, 60) || un, role: 'staff', active: body.active !== false, salt, hash: hp(body.password, salt), created: today(), hostIds: [], tagIds: [], mustChange: true });
        });
        return J({ ok: 1 });
      }
      const acm = path.match(/^\/admin\/accounts\/([\w-]+)$/);
      if (acm && m === 'PUT') {
        const id = acm[1];
        await mutUsers(st, list => {
          const u = list.find(x => x.id === id);
          if (!u) throw H('User not found', 404);
          const active = body.active !== false;
          if (u.id === meG.id && !active) throw H("You can't disable your own account.");
          if (u.role === 'admin' && u.active && !active && activeAdmins(list) < 2) throw H('Keep at least one active admin.');
          u.name = String(body.name || '').trim().slice(0, 60) || u.username; u.active = active;
          if (body.password) {
            if (String(body.password).length < 6) throw H('Password must be at least 6 characters.');
            u.salt = randomBytes(8).toString('hex'); u.hash = hp(body.password, u.salt); u.pv = (u.pv || 0) + 1;
            if (u.id !== meG.id) u.mustChange = true;
          }
        });
        return J({ ok: 1 });
      }
      if (acm && m === 'DELETE') {
        const id = acm[1];
        if (id === meG.id) throw H("You can't delete your own account.");
        await mutUsers(st, list => {
          const i = list.findIndex(x => x.id === id);
          if (i < 0) throw H('User not found', 404);
          if (list[i].role === 'admin' && list[i].active && activeAdmins(list) < 2) throw H('Keep at least one active admin.');
          list.splice(i, 1);
          list.forEach(u => { u.hostIds = (u.hostIds || []).filter(h => h !== id); });
        });
        for (const x of [{ id: DEF_SV }, ...(await srvList())]) await bs.delete(svKey(x.id, 'board:' + id));
        await st.delete('avatar:' + id); await st.delete('pres:' + id); await st.delete('posts:' + id);
        const fo = await frGet(st, id);
        for (const o of uniq([...fo.f, ...fo.in, ...fo.out])) { await frDrop(st, id, o); await st.delete(dmKey(id, o)); }
        await st.delete('fr:' + id);
        await mutate(st, 'servers', () => [], l => l.forEach(x => { delete x.members[id]; Object.values(x.members).forEach(v => { v.hostIds = (v.hostIds || []).filter(h => h !== id); }); }));
        await mutShared(st, sh => sh.tasks.forEach(t => {
          t.assignees = t.assignees.filter(a => a.id !== id); t.hostIds = t.hostIds.filter(h => h !== id);
          if (!t.assignees.length) t.status = 'trash';
        }));
        return J({ ok: 1 });
      }
      const detail = async x => {
        const [tags, chans, sh] = await Promise.all(['tags', 'chat:channels', 'shared'].map(k => bs.get(svKey(x.id, k), { type: 'json' })));
        const tg = tags || [], mem = x.members || {};
        return { logoAt: x.logoAt || 0, id: x.id, name: x.name, created: x.created, code: x.code, ownerId: x.ownerId, owner: nameOf(x.ownerId) || 'Unknown (account deleted)',
          roles: tg.map(t => t.name), channels: (chans || [{ id: 'general', name: 'general' }]).filter(c => !c.tag).map(c => c.name), tasks: (sh?.tasks || []).length,
          members: Object.entries(mem).map(([id, v]) => ({ id, name: nameOf(id) || 'Deleted user', username: allUs.find(u => u.id === id)?.username || '', role: v.role, roles: (v.tagIds || []).map(t => tg.find(g => g.id === t)?.name).filter(Boolean) })) };
      };
      if (path === '/admin/servers' && m === 'GET') {
        const [tg, ch, sh] = await Promise.all(['tags', 'chat:channels', 'shared'].map(k => bs.get(k, { type: 'json' })));
        const dmeta = await bs.get('svmeta:cepalco', { type: 'json' });
        const def = { id: DEF_SV, code: dmeta?.code || '', name: SV_NAME, isDefault: true, created: '', ownerId: DEFAULT_ADMIN, owner: nameOf(DEFAULT_ADMIN) || 'Administrator', roles: (tg || []).map(t => t.name), channels: (ch || [{ id: 'general', name: 'general' }]).filter(c => !c.tag).map(c => c.name), tasks: (sh?.tasks || []).length,
          members: allUs.filter(u => u.active && !u.noDef).map(u => ({ id: u.id, name: u.name || u.username, username: u.username, role: u.role, roles: (u.tagIds || []).map(t => (tg || []).find(g => g.id === t)?.name).filter(Boolean) })) };
        return J({ servers: [def, ...(await Promise.all((await srvList()).map(detail)))] });
      }
      if (path === '/admin/servers' && m === 'POST') {   // create a server for anyone (default: for yourself)
        const name = svName(body.name), un = String(body.owner || '').trim().toLowerCase();
        const own = un ? allUs.find(u => u.username === un && u.active) : meG;
        if (!own) throw H('No active account with that username.', 404);
        const out = await mutSrv(list => { const x = { id: 's_' + randomBytes(4).toString('hex'), name, ownerId: own.id, created: today(), code: newCode(), hostCode: newCode(), adminCode: newCode(), members: { [own.id]: { role: 'admin', hostIds: [], tagIds: [] } } }; list.push(x); return x; });
        return J({ id: out.id, name: out.name, code: out.code }, 201);
      }
      if (path === '/admin/notes' && m === 'GET') {   // every account's personal notes + every server's shared tasks, tagged by server (read-only)
        const list = await srvList();
        const svs = [{ id: DEF_SV, name: SV_NAME, members: allUs.filter(u => u.active && !u.noDef).map(u => u.id) }, ...list.map(x => ({ id: x.id, name: x.name, members: Object.keys(x.members || {}) }))];
        const users = allUs.map(u => ({ id: u.id, name: u.name || u.username, username: u.username, role: u.role, active: u.active, servers: svs.filter(v => v.members.includes(u.id)).map(v => v.id) }));
        const tasks = [], shared = [];
        for (const v of svs) {
          for (const uid of v.members) { const b = await bs.get(svKey(v.id, 'board:' + uid), { type: 'json' }); for (const t of (b?.tasks || [])) tasks.push({ ...t, userId: uid, serverId: v.id, serverName: v.name }); }   // personal notes stay in the server they were written in
 const sh = (await bs.get(svKey(v.id, 'shared'), { type: 'json' })) || { tasks: [] }; for (const t of sh.tasks) shared.push({ ...taskDTO(t, meG, allUs), serverId: v.id, serverName: v.name }); }
        return J({ servers: svs.map(v => ({ id: v.id, name: v.name })), users, tasks, shared });
      }
      const ao = path.match(/^\/admin\/servers\/(s_[a-f0-9]{8})\/owner$/);
      if (ao && m === 'PUT') {   // hand a server to another account (made Head if needed)
        const acc = allUs.find(u => u.id === body.userId && u.active);
        if (!acc) throw H('No active account with that id.', 404);
        await mutSrv(list => {
          const x = list.find(v => v.id === ao[1]); if (!x) throw H('Server not found', 404);
          if (Object.keys(x.members).length >= MAX_MEM && !x.members[acc.id]) throw H('That server is full.');
          x.members[acc.id] = { hostIds: [], tagIds: [], ...x.members[acc.id], role: 'admin' }; x.ownerId = acc.id;
        });
        return J({ ok: 1 });
      }
      throw H('Not found', 404);
    }

    // ----- cross-server calendar: my personal notes + every task assigned to me, across ALL my servers (global; ignores X-Server) -----
    if (path === '/cross' && m === 'GET') {
      const list = await srvList();
      const svs = [...(meG.noDef && !isSuper ? [] : [{ id: DEF_SV, name: SV_NAME }]), ...list.filter(x => x.members[meG.id]).map(x => ({ id: x.id, name: x.name }))];
      const tasks = [], personal = [];
      for (const sv of svs) {
        let usS = allUs, meS = meG;
        if (sv.id !== DEF_SV) {
          const x = list.find(v => v.id === sv.id);
          usS = allUs.filter(u => u.active && x.members[u.id]).map(u => { const mm = x.members[u.id]; return { ...u, role: mm.role, hostIds: mm.role === 'staff' ? mm.hostIds : [], headIds: mm.role === 'host' ? (mm.headIds || []) : [], tagIds: mm.tagIds }; });
          meS = usS.find(u => u.id === meG.id);
          if (!meS) continue;
        }
        const pb = (await bs.get(svKey(sv.id, 'board:' + meG.id), { type: 'json' })) || { tasks: [] };   // my personal notes of THIS server
        for (const t of (pb.tasks || [])) if (t.status !== 'trash') personal.push({ ...t, serverId: sv.id, serverName: sv.name });
        const sh = (await bs.get(svKey(sv.id, 'shared'), { type: 'json' })) || { tasks: [] };
        for (const t of sh.tasks) {
          if (t.status !== 'active' || !isMine(meS, t)) continue;   // only tasks given to me
          tasks.push({ ...taskDTO(t, meS, allUs), serverId: sv.id, serverName: sv.name });
        }
      }
      return J({ servers: svs, personal, shared: tasks });
    }

    if (path === '/me' && m === 'GET' && meG.noDef && !isSuper && !req.headers.get('x-server')) return J({ user: { ...pub(meG, allUs), noServer: true }, server: null, board: null });   // no server yet: the app sends them to the hub to join one

    // ----- attachment download (plain GET so <img>/<a> work; no X-Server header: the file remembers where it was shared) -----
    const atm = path.match(/^\/attach\/(\d{13}_[a-f0-9]{16})$/);
    if (atm && m === 'GET') {
      const key = 'att:' + atm[1], left = Number(atm[1].slice(0, 13)) - Date.now();
      if (left <= 0) { await bs.delete(key).catch(() => {}); throw H('This file has expired.', 410); }
      const r = await bs.getWithMetadata(key, { type: 'arrayBuffer' });
      if (!r) throw H('This file is no longer available.', 410);
      const md = r.metadata || {};
      let ok = false;
      if (md.s === 'd') ok = md.o === meG.id || md.p === meG.id;                         // private: only the two people
      else if (md.s === 'g') {                                                            // group: members of that server who can see that channel
        let member = false, tagIds = [];
        if (md.sv === DEF_SV) { const u = allUs.find(x => x.id === meG.id && !x.noDef); member = !!u; tagIds = u?.tagIds || []; }
        else { const x = SV_ID.test(md.sv) ? (await srvList()).find(v => v.id === md.sv) : null, mm = x?.members?.[meG.id]; member = !!mm || (isSuper && !!x); tagIds = mm?.tagIds || []; }
        if (member) { const c = ((await bs.get(svKey(md.sv, 'chat:channels'), { type: 'json' })) || [{ id: 'general', name: 'general' }]).find(c => c.id === md.ch); ok = !!c && (!c.tag || tagIds.includes(c.tag)); }
      }
      if (!ok) throw H('You cannot open this file.', 403);
      const img = !!ATT_IMG[md.t], nm = attName(md.n);
      return new Response(r.data, { status: 200, headers: {
        'Content-Type': img ? md.t : 'application/octet-stream', 'Content-Length': String(r.data.byteLength),
        'Content-Disposition': `${img ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(nm)}`,
        'Cache-Control': `private, max-age=${Math.max(0, Math.floor(left / 1000))}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
    }

    // ----- pick the active server: X-Server header (default = CEPALCO). 'us' = the people of THIS server with their server position/roles -----
    let us = allUs.filter(u => !u.noDef);   // CEPALCO members only (new sign-ups are in no server until they join one)
    const want = req.headers.get('x-server') || DEF_SV;
    if (want !== DEF_SV) {
      const x = SV_ID.test(want) ? (await srvList()).find(v => v.id === want) : null;
      if (!x || !(x.members[meG.id] || isSuper)) throw H('You are not a member of that server.', 403);
      SV = want;
      us = allUs.filter(u => u.active && x.members[u.id]).map(u => { const mm = x.members[u.id]; return { ...u, role: mm.role, hostIds: mm.role === 'staff' ? mm.hostIds : [], headIds: mm.role === 'host' ? (mm.headIds || []) : [], tagIds: mm.tagIds }; });
    }
    const me = us.find(u => u.id === meG.id) || (isSuper && SV !== DEF_SV ? { ...meG, role: 'admin', hostIds: [], tagIds: [] } : null);   // platform admin inside a server he is not a member of: acts as Head, is not listed as a member
    if (!me) throw H('You are not a member of that server.', 403);
    const svNameNow = async () => SV === DEF_SV ? SV_NAME : ((await srvList()).find(v => v.id === SV)?.name || '');   // which server a task notification came from
    const nameUs = us.concat(allUs.filter(g => !us.some(u => u.id === g.id)));   // server people first, then anyone else (old chat senders, friends)

    const myBoard = async () => {   // personal notes of THIS server; the theme is global (kept in the default board)
      const b = await st.get('board:' + me.id, { type: 'json' });
      if (SV === DEF_SV) return b;
      const th = (await bs.get('board:' + me.id, { type: 'json' }))?.theme;
      return { tasks: [], rev: 0, ...(b || {}), ...(th ? { theme: th } : {}) };
    };
    if (path === '/me' && m === 'GET') return J({ user: { ...pub(me, us), overview: me.id === DEFAULT_ADMIN && SV === DEF_SV, superAdmin: isSuper }, server: { id: SV, name: SV === DEF_SV ? SV_NAME : (await srvList()).find(v => v.id === SV)?.name }, board: await myBoard() });

    if (path === '/change-password' && m === 'POST') {
      const cur = String(body.currentPassword || ''), next = String(body.newPassword || '');
      if (!same(me.hash, hp(cur, me.salt))) throw H('Current password is incorrect.', 401);
      if (next.length < 8) throw H('New password must be at least 8 characters.');
      let pv = 0;
      await mutUsers(st, list => { const u = list.find(x => x.id === me.id); u.salt = randomBytes(8).toString('hex'); u.hash = hp(next, u.salt); u.pv = (u.pv || 0) + 1; pv = u.pv; delete u.mustChange; });
      await st.setJSON('sess:' + token, { ...sess, pv });   // this device stays signed in; every other session is now invalid
      return J({ ok: 1 });
    }

    // ----- profile picture -----
    const am = path.match(/^\/avatar(?:\/([\w-]+))?$/);   // /avatar = mine, /avatar/<id> = a teammate's (shown in the group chat)
    if (am && m === 'GET') {
      const owner = am[1] ? nameUs.find(x => x.id === am[1]) : me;
      if (owner && !canSee(owner, me)) throw H('No profile picture', 404);   // hidden profile: the photo is not served to others
      const a = await st.get('avatar:' + (am[1] || me.id), { type: 'json' });
      if (!a) throw H('No profile picture', 404);
      return new Response(Buffer.from(a.b64, 'base64'), { status: 200, headers: { 'Content-Type': a.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (path === '/avatar' && m === 'POST') {
      const mt = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(body.image || ''));
      if (!mt) throw H('Please choose a JPG, PNG or WebP image.');
      const buf = Buffer.from(mt[2], 'base64');
      if (buf.length > AVATAR_MAX) throw H('Picture is too large (max 250 KB after resizing).', 413);
      const magic = { 'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8, 'image/png': b => b.subarray(1, 4).toString() === 'PNG', 'image/webp': b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' };
      if (!magic[mt[1]](buf)) throw H('That file is not a valid image.');
      let at = 0;
      await mutUsers(st, async list => {
        const u = list.find(x => x.id === me.id);
        const wait = (u.avatarAt || 0) + AVATAR_COOLDOWN - Date.now();   // enforced here, not just in the browser
        if (u.avatarAt && wait > 0) throw H(`You can change your picture again in ${Math.ceil(wait / 864e5)} day(s).`, 429);
        await st.setJSON('avatar:' + me.id, { type: mt[1], b64: mt[2] });
        u.avatarAt = at = Date.now();
      });
      return J({ ok: 1, avatarAt: at, avatarNext: at + AVATAR_COOLDOWN });
    }

    // ----- profile visibility + viewing someone's profile (online or offline) -----
    if (path === '/profile-visibility' && m === 'POST') {
      const hidden = body.hidden === true;
      await mutUsers(st, async list => { list.find(x => x.id === me.id).profileHidden = hidden; });
      return J({ ok: 1, profileHidden: hidden });
    }
    const pm = path.match(/^\/profile\/([\w-]+)$/);
    if (pm && m === 'GET') {
      const t = nameUs.find(x => x.id === pm[1]);
      if (!t || (!t.active && me.role !== 'admin')) throw H('Profile not found', 404);
      const pr = t.id === me.id ? { t: Date.now() } : await st.get('pres:' + t.id, { type: 'json' });
      const online = !!pr && Date.now() - pr.t < ONLINE_MS;
      const base = { id: t.id, name: t.name || t.username, online, mine: t.id === me.id, hiddenByUser: !!t.profileHidden, friend: t.id === me.id ? 'self' : frState(await frGet(st, me.id), t.id) };   // no server role/tags: a profile belongs to the person, not to a server
      if (!canSee(t, me, us.some(x => x.id === t.id))) return J({ ...base, hidden: true });
      return J({ ...base, hidden: false, username: t.username, avatarAt: t.avatarAt || 0, created: t.created || 0, lastSeen: pr ? pr.t : 0 });
    }

    // ----- profile posts (Threads style): short text posts on your profile, with likes and replies -----
    // Storage: posts:<userId> = { items: [{ id, ts, text, likes: [userId], replies: [{ id, uid, ts, text }] }] }, newest first.
    const postClean = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
    const postsGet = async id => { const d = await st.get('posts:' + id, { type: 'json' }); return d && Array.isArray(d.items) ? d : { items: [] }; };
    const mutPosts = (id, fn) => mutate(st, 'posts:' + id, () => ({ items: [] }), d => { if (!Array.isArray(d.items)) d.items = []; return fn(d); });
    const postOwner = id => {   // the person whose profile the post lives on: must exist and be viewable by me
      const t = nameUs.find(x => x.id === id);
      if (!t || (!t.active && me.role !== 'admin')) throw H('Profile not found', 404);
      if (!canSee(t, me, us.some(x => x.id === t.id))) throw H('This profile is hidden.', 403);
      return t;
    };
    const snip = s => s.length > 60 ? s.slice(0, 57) + '…' : s;
    const postDTO = (p, owner) => ({
      id: p.id, ts: p.ts, text: p.text, likes: p.likes.length, liked: p.likes.includes(me.id), canDelete: owner.id === me.id || me.role === 'admin',
      replies: p.replies.map(r => { const u = nameUs.find(x => x.id === r.uid); return { id: r.id, uid: r.uid, name: u ? (u.name || u.username) : 'Deleted user', avatarAt: avAt(u, me), ts: r.ts, text: r.text, canDelete: r.uid === me.id || owner.id === me.id || me.role === 'admin' }; }),
    });
    const pm1 = path.match(/^\/posts\/([\w-]+)$/), pm2 = path.match(/^\/posts\/([\w-]+)\/([\w-]+)$/),
      pm3 = path.match(/^\/posts\/([\w-]+)\/([\w-]+)\/(like|reply)$/), pm4 = path.match(/^\/posts\/([\w-]+)\/([\w-]+)\/reply\/([\w-]+)$/);
    if (path === '/posts' && m === 'POST') {   // new post on MY profile
      const text = postClean(body.text, POST_MAX);
      if (!text) throw H('Write something first.');
      let dto = null;
      await mutPosts(me.id, d => {
        if (d.items[0] && Date.now() - d.items[0].ts < 2000) throw H('Slow down a little.', 429);
        const p = { id: 'p_' + randomBytes(5).toString('hex'), ts: Date.now(), text, likes: [], replies: [] };
        d.items.unshift(p); d.items.length = Math.min(d.items.length, POST_KEEP);
        dto = postDTO(p, me);
      });
      return J(dto, 201);
    }
    if (pm1 && m === 'GET') {
      const t = nameUs.find(x => x.id === pm1[1]);
      if (!t || (!t.active && me.role !== 'admin')) throw H('Profile not found', 404);
      if (!canSee(t, me, us.some(x => x.id === t.id))) return J({ hidden: true, mine: false, posts: [] });
      return J({ hidden: false, mine: t.id === me.id, max: POST_MAX, replyMax: REPLY_MAX, posts: (await postsGet(t.id)).items.map(p => postDTO(p, t)) });
    }
    if (pm2 && m === 'DELETE') {
      const owner = postOwner(pm2[1]);
      if (owner.id !== me.id && me.role !== 'admin') throw H('You can only delete your own posts.', 403);
      await mutPosts(owner.id, d => { const i = d.items.findIndex(p => p.id === pm2[2]); if (i < 0) throw H('Post not found', 404); d.items.splice(i, 1); });
      return J({ ok: 1 });
    }
    if (pm3 && m === 'POST') {
      const owner = postOwner(pm3[1]), byName = me.name || me.username;
      if (pm3[3] === 'like') {
        let out = null;
        await mutPosts(owner.id, d => {
          const p = d.items.find(x => x.id === pm3[2]); if (!p) throw H('Post not found', 404);
          const i = p.likes.indexOf(me.id); if (i >= 0) p.likes.splice(i, 1); else p.likes.push(me.id);
          out = { liked: i < 0, likes: p.likes.length, text: p.text };
        });
        if (out.liked && owner.id !== me.id) {   // tell the author once per person per post (re-liking after an unlike stays quiet)
          const nd = (await st.get('notif:' + owner.id, { type: 'json' })) || { items: [] };
          if (!nd.items.some(n => n.type === 'post_like' && n.by === me.id && n.pid === pm3[2])) await notify(st, [owner.id], { type: 'post_like', by: me.id, byName, title: snip(out.text), pid: pm3[2] });
        }
        return J({ liked: out.liked, likes: out.likes });
      }
      const text = postClean(body.text, REPLY_MAX);
      if (!text) throw H('Write a reply first.');
      let reply = null, ptext = '';
      await mutPosts(owner.id, d => {
        const p = d.items.find(x => x.id === pm3[2]); if (!p) throw H('Post not found', 404);
        if (p.replies.length >= REPLY_KEEP) throw H('This post has reached its reply limit.');
        reply = { id: 'r_' + randomBytes(5).toString('hex'), uid: me.id, ts: Date.now(), text };
        p.replies.push(reply); ptext = p.text;
      });
      await notify(st, [owner.id], { type: 'post_reply', by: me.id, byName, title: snip(ptext), pid: pm3[2] });
      return J({ id: reply.id, uid: me.id, name: byName, avatarAt: me.avatarAt || 0, ts: reply.ts, text, canDelete: true }, 201);
    }
    if (pm4 && m === 'DELETE') {
      const owner = postOwner(pm4[1]);
      await mutPosts(owner.id, d => {
        const p = d.items.find(x => x.id === pm4[2]); if (!p) throw H('Post not found', 404);
        const i = p.replies.findIndex(r => r.id === pm4[3]); if (i < 0) throw H('Reply not found', 404);
        if (p.replies[i].uid !== me.id && owner.id !== me.id && me.role !== 'admin') throw H('You can only delete your own replies.', 403);
        p.replies.splice(i, 1);
      });
      return J({ ok: 1 });
    }

    // ----- friends (requests, accept, unfriend) -----
    const fcard = u => ({ id: u.id, name: u.name || u.username, avatarAt: avAt(u, me) });
    if (path === '/friends' && m === 'GET') {
      const f = await frGet(st, me.id);
      const pick = ids => ids.map(id => allUs.find(u => u.id === id && u.active)).filter(Boolean).map(fcard);
      return J({ friends: pick(f.f), incoming: pick(f.in), outgoing: pick(f.out),
        others: allUs.filter(u => u.active && u.id !== me.id).sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(u => ({ ...fcard(u), state: frState(f, u.id) })) });
    }
    const fm = path.match(/^\/friends\/(request|accept|decline|cancel)$/);
    if (fm && m === 'POST') {
      const other = allUs.find(u => u.id === String(body.userId || '') && u.active);
      if (!other || other.id === me.id) throw H('Person not found', 404);
      const mine = await frGet(st, me.id), act = fm[1], byName = me.name || me.username;
      const link = async () => {
        if (mine.f.length >= MAX_FR || (await frGet(st, other.id)).f.length >= MAX_FR) throw H(`Friend lists are limited to ${MAX_FR} people.`);
        await frLink(st, me.id, other.id);
        await notify(st, [other.id], { type: 'friend_ok', by: me.id, byName });
        return J({ state: 'friends' });
      };
      if (act === 'request') {
        if (mine.f.includes(other.id)) throw H('You are already friends.');
        if (mine.in.includes(other.id)) return link();                       // they already asked me: asking back = accepting
        if (mine.out.includes(other.id)) return J({ state: 'sent' });
        if (mine.f.length + mine.out.length >= MAX_FR) throw H(`You can have up to ${MAX_FR} friends and pending requests.`);
        await mutFr(st, other.id, d => { if (!d.in.includes(me.id)) { if (d.in.length >= MAX_FR * 2) throw H('This person has too many pending requests.'); d.in.push(me.id); } });   // them first: it can refuse
        await mutFr(st, me.id, d => { if (!d.out.includes(other.id)) d.out.push(other.id); });
        await notify(st, [other.id], { type: 'friend_req', by: me.id, byName });
        return J({ state: 'sent' }, 201);
      }
      if (act === 'accept') {
        if (!mine.in.includes(other.id)) throw H('There is no friend request from this person.', 404);
        return link();
      }
      if (mine.f.includes(other.id)) throw H('You are already friends.');   // decline / cancel only ever touch pending requests
      await frDrop(st, me.id, other.id);
      return J({ state: 'none' });
    }
    const fum = path.match(/^\/friends\/([\w-]+)$/);
    if (fum && m === 'DELETE') {   // unfriend (the conversation is kept, but sending stops until you are friends again)
      await frDrop(st, me.id, fum[1]);
      return J({ ok: 1 });
    }

    // ----- private messages between friends (shown in the chat dock; polled together with /api/chat) -----
    const dmPeer = async id => {
      const u = allUs.find(x => x.id === String(id || '') && x.active);
      if (!u || u.id === me.id || !(await frGet(st, me.id)).f.includes(u.id) || !(await frGet(st, u.id)).f.includes(me.id)) throw H('You can only message your friends.', 403);
      return u;
    };
    if (path === '/dm/send' && m === 'POST') {
      const peer = await dmPeer(body.to), text = chatText(body.text);
      let msg;
      await mutate(st, dmKey(me.id, peer.id), () => ({ rev: 0, msgs: [] }), d => {
        msg = { id: 'd_' + randomBytes(6).toString('hex'), uid: me.id, text, ts: Math.max(Date.now(), (d.msgs.at(-1)?.ts || 0) + 1) };
        d.msgs.push(msg); if (d.msgs.length > DM_MAX) d.msgs.splice(0, d.msgs.length - DM_MAX); d.rev = (d.rev || 0) + 1;
      });
      return J(dmMsg(msg, me), 201);
    }
    const dmm = path.match(/^\/dm\/msg\/([\w-]+)$/);
    if (dmm && (m === 'PUT' || m === 'DELETE')) {
      const wid = new URL(req.url).searchParams.get('with') || '';
      if (m === 'PUT') await dmPeer(wid);
      else if (!UID.test(wid) || wid === me.id) throw H('Conversation not found', 404);
      const text = m === 'PUT' ? chatText(body.text, true) : '';
      let delAtt = '';
      const out = await mutate(st, dmKey(me.id, wid), () => ({ rev: 0, msgs: [] }), d => {
        const i = d.msgs.findIndex(x => x.id === dmm[1]), x = d.msgs[i];
        if (!x) throw H('Message not found', 404);
        if (x.uid !== me.id) throw H(m === 'PUT' ? 'You can only edit your own messages.' : 'You can only delete your own messages.', 403);
        if (m === 'PUT' && !text && !x.att) throw H('Type a message first.');
        d.rev = (d.rev || 0) + 1;
        if (m === 'DELETE') { d.msgs.splice(i, 1); delAtt = x.att?.id; return null; }
        x.text = text; x.edited = true; return x;
      });
      if (delAtt) await bs.delete('att:' + delAtt).catch(() => {});
      return out ? J(dmMsg(out, me)) : J({ ok: 1 });
    }

    // ----- group chat (floating dock) -----
    if (path === '/chat' && m === 'GET') {
      const q = new URL(req.url).searchParams, now = Date.now();
      const [chans, fr] = await Promise.all([chanList(st, me), frGet(st, me.id)]);
      const ch = chans.find(c => c.id === q.get('ch'))?.id || null;
      const ty = chans.find(c => c.id === q.get('typing'))?.id || null;
      const chTag = chans.find(c => c.id === ch)?.tag || null;                                          // in a role channel, "online" lists only that role's members
      const people = us.filter(u => u.active && (!chTag || u.tagIds.includes(chTag)));
      const fids = fr.f.filter(id => allUs.some(u => u.id === id && u.active)).slice(0, MAX_FR);                  // my friends (active accounts only)
      const dmOpen = uniq(String(q.get('dm') || '').split(',')).filter(id => fids.includes(id)).slice(0, DM_OPEN);   // private conversations the browser has open right now
      const dmTy = fids.includes(q.get('dtyping')) ? q.get('dtyping') : null;
      // the video call this browser is in (it keeps sending ?call=ch:<channel> or dm:<friendId> while its call tab is open): a channel I can see / a friend. Counted like presence, nothing extra is stored.
      const cq = String(q.get('call') || ''), cn = Number(q.get('cs'));
      const callScope = /^ch:/.test(cq) && chans.some(c => c.id === cq.slice(3)) ? 'ch:' + SV + ':' + cq.slice(3) : /^dm:/.test(cq) && fids.includes(cq.slice(3)) ? 'dm:' + [me.id, cq.slice(3)].sort().join(':') : null;
      const callSince = Number.isFinite(cn) && cn <= now && cn > now - 12 * 36e5 ? cn : now;   // when the call started (the first person's click)
      const mePres = { t: now, ty: ty ? { c: ty, t: now, sv: SV } : null, dty: dmTy ? { to: dmTy, t: now } : null, call: callScope ? { s: callScope, st: callSince, t: now } : null };
      const popAll = us.filter(u => u.active);                                                           // everyone of this server: a call in another channel needs their presence too
      const pIds = [...new Set([...popAll.map(u => u.id), ...people.map(u => u.id), ...fids])];
      // Everything below is independent, so run it all at once instead of one blob read after another (this was most of the server-side delay).
      const [, presList, datas, dmDatas] = await Promise.all([
        st.setJSON('pres:' + me.id, mePres),                                                              // heartbeat: one key per person, so polls never collide
        Promise.all(pIds.map(async id => [id, id === me.id ? mePres : await st.get('pres:' + id, { type: 'json' })])),
        Promise.all(chans.map(c => st.get('chat:' + c.id, { type: 'json' }))),
        Promise.all(fids.map(id => st.get(dmKey(me.id, id), { type: 'json' }))),
      ]);
      const pres = Object.fromEntries(presList);
      const on = people.filter(u => pres[u.id] && now - pres[u.id].t < ONLINE_MS);
      const callOf = (scope, cand) => {   // { n people in the call, since when it started, am I in it } or null
        let n = 0, since = Infinity, mine = false;
        for (const u of cand) { const c = (u.id === me.id ? mePres : pres[u.id])?.call; if (c && c.s === scope && now - c.t < CALL_MS) { n++; since = Math.min(since, c.st || now); if (u.id === me.id) mine = true; } }
        return n ? { n, since, me: mine } : null;
      };
      const seen = parseSeen(q.get('seen')), unseen = q.get('seen') ? 0 : Infinity;   // no 'seen' at all = brand-new browser (nothing unread); a channel missing from a known list = created since, so all of it is unread
      let rev = 0, msgs, newest = 0;
      const channels = [];
      chans.forEach((c, i) => {
        const d = datas[i] || { rev: 0, msgs: [] };
        const last = d.msgs.at(-1)?.ts || 0; newest = Math.max(newest, last);
        channels.push({ id: c.id, name: c.name, tag: c.tag || null, last, call: callOf('ch:' + SV + ':' + c.id, popAll.concat(popAll.some(u => u.id === me.id) ? [] : [me]).filter(u => !c.tag || u.tagIds.includes(c.tag))), unread: Math.min(99, d.msgs.filter(x => x.uid !== me.id && x.ts > (seen[c.id] ?? unseen)).length) });
        if (c.id === ch) { rev = d.rev || 0; if (rev !== Number(q.get('rev'))) msgs = d.msgs.slice(-CHAT_SHOW).map(x => chatMsg(x, me, nameUs)); }
      });
      // "hot" = ms since the last sign of a live conversation (a new message, or someone else typing). The browser polls faster only while the chat is hot.
      const typingNow = on.some(u => u.id !== me.id && pres[u.id].ty?.c === ch && pres[u.id].ty.sv === SV && now - pres[u.id].ty.t < TYPING_MS);
      const card = u => ({ id: u.id, name: u.name || u.username, role: u.role, avatarAt: avAt(u, me) });
      // private messages: one entry per friend (unread count, last message preview, online, typing) + the messages of the conversations that are open
      const dseenQ = q.get('dseen'), dseen = parseSeenU(dseenQ), dun = dseenQ ? 0 : Infinity, drev = parseSeenU(q.get('drev')), dms = {};
      let dmTyping = false;
      const friends = fids.map((id, i) => {
        const u = allUs.find(x => x.id === id), d = dmDatas[i] || { rev: 0, msgs: [] }, lm = d.msgs.at(-1), p = pres[id];
        const online = !!p && now - p.t < ONLINE_MS, typing = online && p.dty?.to === me.id && now - p.dty.t < TYPING_MS;
        if (typing) dmTyping = true;
        if (dmOpen.includes(id)) { const r = d.rev || 0; dms[id] = { rev: r, ...(r !== (drev[id] ?? -1) ? { msgs: d.msgs.slice(-CHAT_SHOW).map(x => dmMsg(x, me)) } : {}) }; }
        newest = Math.max(newest, lm?.ts || 0);
        return { ...card(u), online, typing, call: callOf('dm:' + [me.id, id].sort().join(':'), [me, u]), last: lm?.ts || 0, prev: lm ? (lm.text || (lm.att ? '📎 ' + lm.att.name : '')).slice(0, 60) : '', pm: !!lm && lm.uid === me.id,
          unread: Math.min(99, d.msgs.filter(x => x.uid !== me.id && x.ts > (dseen[id] ?? dun)).length) };
      });
      const asCards = ids => ids.map(id => allUs.find(u => u.id === id && u.active)).filter(Boolean).map(card);
      const hot = typingNow || dmTyping ? 0 : newest ? Math.max(0, now - newest) : 1e9;
      return J({
        me: card(me), ch, rev, hot, channels, friends, dms, reqIn: asCards(fr.in), reqOut: fr.out, avs: Object.fromEntries(allUs.filter(u => avAt(u, me)).map(u => [u.id, u.avatarAt])),   // current photo version per person, so chat avatars refresh even when no message changed
         ...(msgs ? { msgs } : {}),
        online: on.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.name || '').localeCompare(b.name || '')).map(u => ({ ...card(u), typing: u.id !== me.id && pres[u.id].ty?.c === ch && pres[u.id].ty.sv === SV && now - pres[u.id].ty.t < TYPING_MS })),
        offline: people.length - on.length,
        offUsers: people.filter(u => !on.includes(u)).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.name || '').localeCompare(b.name || '')).map(card),
      });
    }
    if (path === '/chat/send' && m === 'POST') {
      const ch = (await chanList(st, me)).find(c => c.id === body.ch)?.id;
      if (!ch) throw H('Channel not found', 404);
      const text = chatText(body.text);
      let msg;
      await mutChat(st, ch, d => {
        msg = { id: 'm_' + randomBytes(6).toString('hex'), uid: me.id, text, ts: Math.max(Date.now(), (d.msgs.at(-1)?.ts || 0) + 1) };   // ts is strictly increasing per channel
        d.msgs.push(msg); if (d.msgs.length > CHAT_MAX) d.msgs.splice(0, d.msgs.length - CHAT_MAX); d.rev = (d.rev || 0) + 1;
      });
      return J(chatMsg(msg, me, nameUs), 201);
    }
    // ----- share a file in a channel (?ch=) or privately with a friend (?to=): body = the raw bytes. Creates the message in the same call. -----
    if (path === '/attach' && m === 'POST') {
      const q = new URL(req.url).searchParams, now = Date.now();
      if (Number(req.headers.get('content-length') || 0) > ATT_MAX + 4096) throw H('That file is too big (max 1 MB).', 413);
      const buf = Buffer.from(await req.arrayBuffer());
      if (!buf.length) throw H('That file is empty.');
      if (buf.length > ATT_MAX) throw H('That file is too big (max 1 MB).', 413);
      const name = attName(q.get('name'));
      if (ATT_BAD_EXT.test(name)) throw H('That file type is not allowed.', 415);
      const type = Object.keys(ATT_IMG).find(t => ATT_IMG[t](buf)) || 'application/octet-stream';   // pictures are recognised by their bytes, never by the name the browser claims
      const caption = chatText(q.get('text'), true);
      let scope;
      if (q.get('to')) { const peer = await dmPeer(q.get('to')); scope = { s: 'd', p: peer.id }; }
      else { const ch = (await chanList(st, me)).find(c => c.id === q.get('ch'))?.id; if (!ch) throw H('Channel not found', 404); scope = { s: 'g', sv: SV, ch }; }
      await mutate(bs, 'attq:' + me.id, () => [], l => {                                   // at most ATT_PER_USER live files per person
        const live = l.filter(t => t > now - ATT_MS); l.length = 0; l.push(...live);
        if (l.length >= ATT_PER_USER) throw H(`You can share up to ${ATT_PER_USER} files every 15 minutes. Try again in a few minutes.`, 429);
        l.push(now);
      });
      const exp = now + ATT_MS, id = exp + '_' + randomBytes(8).toString('hex');
      await bs.set('att:' + id, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { metadata: { o: me.id, n: name, t: type, ...scope } });
      const att = { id, name, type, size: buf.length, exp };
      let msg;
      const put = d => { msg = { id: (scope.s === 'd' ? 'd_' : 'm_') + randomBytes(6).toString('hex'), uid: me.id, text: caption, att, ts: Math.max(Date.now(), (d.msgs.at(-1)?.ts || 0) + 1) }; d.msgs.push(msg); if (d.msgs.length > (scope.s === 'd' ? DM_MAX : CHAT_MAX)) d.msgs.splice(0, d.msgs.length - (scope.s === 'd' ? DM_MAX : CHAT_MAX)); d.rev = (d.rev || 0) + 1; };
      try {
        if (scope.s === 'd') await mutate(st, dmKey(me.id, scope.p), () => ({ rev: 0, msgs: [] }), put);
        else await mutChat(st, scope.ch, put);
      } catch (e) { await bs.delete('att:' + id).catch(() => {}); throw e; }
      return J(scope.s === 'd' ? dmMsg(msg, me) : chatMsg(msg, me, nameUs), 201);
    }
    const cm = path.match(/^\/chat\/msg\/([\w-]+)$/);
    if (cm && (m === 'PUT' || m === 'DELETE')) {
      const ch = (await chanList(st, me)).find(c => c.id === new URL(req.url).searchParams.get('ch'))?.id;
      if (!ch) throw H('Channel not found', 404);
      const text = m === 'PUT' ? chatText(body.text, true) : '';
      let delAtt = '';
      const out = await mutChat(st, ch, d => {
        const i = d.msgs.findIndex(x => x.id === cm[1]), x = d.msgs[i];
        if (!x) throw H('Message not found', 404);
        if (m === 'DELETE') { if (x.uid !== me.id && me.role !== 'admin') throw H('You can only delete your own messages.', 403); d.msgs.splice(i, 1); d.rev = (d.rev || 0) + 1; delAtt = x.att?.id; return null; }
        if (x.uid !== me.id) throw H('You can only edit your own messages.', 403);
        if (!text && !x.att) throw H('Type a message first.');
        x.text = text; x.edited = true; d.rev = (d.rev || 0) + 1; return x;
      });
      if (delAtt) await bs.delete('att:' + delAtt).catch(() => {});   // the message is gone, so is its file
      return out ? J(chatMsg(out, me, nameUs)) : J({ ok: 1 });
    }
    if (path === '/chat/channels' && m === 'POST') {
      if (me.role !== 'admin') throw H('Only Heads can add channels.', 403);
      const id = String(body.name || '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 24);
      if (!CH_ID.test(id)) throw H('Channel name: letters, numbers and dashes.');
      await mutate(st, 'chat:channels', () => [{ id: 'general', name: 'general' }], list => {
        if (list.some(c => c.id === id)) throw H('That channel already exists.');
        if (list.filter(c => !c.tag).length >= MAX_CH) throw H(`You can have up to ${MAX_CH} channels (role channels don't count).`);
        list.push({ id, name: id });
      });
      return J({ ok: 1, id }, 201);
    }
    const chm = path.match(/^\/chat\/channels\/([a-z0-9-]+)$/);
    if (chm && m === 'DELETE') {
      if (me.role !== 'admin') throw H('Only Heads can remove channels.', 403);
      if (chm[1] === 'general') throw H('The general channel cannot be removed.');
      await mutate(st, 'chat:channels', () => [{ id: 'general', name: 'general' }], list => {
        const i = list.findIndex(c => c.id === chm[1]);
        if (i < 0) throw H('Channel not found', 404);
        if (list[i].tag) throw H('This channel belongs to a custom role. Delete the role (Users page) to remove it.');
        list.splice(i, 1);
      });
      await st.delete('chat:' + chm[1]);
      return J({ ok: 1 });
    }

    // ----- video call: a private, unguessable Jitsi room per channel / per pair of friends (free; nothing is stored or relayed by this app) -----
    if (path === '/call' && m === 'GET') {
      const q = new URL(req.url).searchParams, ch = q.get('ch'), dm = q.get('dm');
      let scope;
      if (dm) { if (dm === me.id || frState(await frGet(st, me.id), dm) !== 'friends') throw H('You can only call your friends.', 403); scope = 'dm:' + [me.id, dm].sort().join(':'); }
      else { if (!(await chanList(st, me)).some(c => c.id === (ch || 'general'))) throw H('Channel not found', 404); scope = 'ch:' + SV + ':' + (ch || 'general'); }
      const key = await mutate(bs, 'callkey', () => ({}), r => { if (!r.k) r.k = randomBytes(24).toString('hex'); return r.k; });
      const room = 'CrewCamp-' + createHmac('sha256', key).update(scope).digest('hex').slice(0, 24);
      const host = String(process.env.VIDEO_HOST || 'meet.jit.si').replace(/[^a-z0-9.-]/gi, '');
      return J({ url: `https://${host}/${room}#config.prejoinPageEnabled=false&config.disableDeepLinking=true&userInfo.displayName=${encodeURIComponent(JSON.stringify(me.name || me.username))}` });
    }

    // ----- my team, sections (roles a Supervisor creates) and departments (a Head groups sections) -----
    const isSup = me.role === 'host', isHead = me.role === 'admin';
    const editRecs = fn => SV === DEF_SV
      ? mutUsers(st, list => fn(list.filter(u => u.active && !u.noDef).map(u => [u.id, u])))
      : mutSrv(list => { const x = list.find(v => v.id === SV); fn(Object.entries(x.members)); });
    // Section roles are managed: owner Supervisor + his Staff + the Heads who picked him hold the role (and so can use its chatbox)
    const syncSections = (ents, tags) => {
      const byId = new Map(ents);
      for (const t of tags) if (t.sup) {
        const sup = byId.get(t.sup);
        for (const [id, rc] of ents) {
          const should = id === t.sup ? !!sup : rc.role === 'staff' ? (rc.hostIds || []).includes(t.sup) : rc.role === 'admin' ? !!sup && (sup.headIds || []).includes(id) : false;
          rc.tagIds = rc.tagIds || [];
          const has = rc.tagIds.includes(t.id);
          if (should && !has) rc.tagIds.push(t.id); else if (!should && has) rc.tagIds = rc.tagIds.filter(x => x !== t.id);
        }
      }
    };
    const depts = async () => (await st.get('depts', { type: 'json' })) || [];
    if (path === '/team' && (m === 'GET' || m === 'POST')) {
      if (!isSup && !isHead) throw H('Only Supervisors and Heads have a team.', 403);
      const kind = isSup ? 'staff' : 'host', field = isSup ? 'hostIds' : 'headIds', tags = await tagsRaw(st);
      if (m === 'GET') return J({ kind, mySections: tags.filter(t => t.sup === me.id).length, candidates: us.filter(u => u.active && u.role === kind && u.id !== me.id).map(u => { const l = (isSup ? u.hostIds : u.headIds) || []; return { id: u.id, name: u.name || u.username, mine: l.includes(me.id), others: l.filter(h => h !== me.id).length, staff: kind === 'host' ? us.filter(x => x.role === 'staff' && (x.hostIds || []).includes(u.id)).length : undefined, sections: kind === 'host' ? tags.filter(t => t.sup === u.id).map(t => t.name) : undefined }; }) });
      const add = uniq(body.add), rem = uniq(body.remove);
      if (isSup && add.length && !tags.some(t => t.sup === me.id)) throw H('Create your Section first (give it a name), then pick your Staff.');
      await editRecs(ents => {
        const get = id => (ents.find(([x]) => x === id) || [])[1];
        for (const id of add) { const rc = get(id); if (rc && rc.role === kind) rc[field] = uniq([...(rc[field] || []), me.id]); }
        for (const id of rem) { const rc = get(id); if (rc) rc[field] = (rc[field] || []).filter(h => h !== me.id); }
        syncSections(ents, tags);
      });
      return J({ ok: 1 });
    }
    if (path === '/sections' && m === 'GET') {
      const tags = (await tagsRaw(st)).filter(t => t.sup), dl = await depts();
      const vis = isSup ? tags.filter(t => t.sup === me.id) : isHead ? tags.filter(t => (us.find(u => u.id === t.sup)?.headIds || []).includes(me.id)) : [];
      return J({ sections: vis.map(t => ({ id: t.id, name: t.name, sup: t.sup, supName: nameUs.find(u => u.id === t.sup)?.name || '', mine: t.sup === me.id, members: us.filter(u => u.tagIds.includes(t.id)).length, channel: tagChan(t.id) })), departments: isHead ? dl.filter(d => d.headId === me.id) : [] });
    }
    if (path === '/sections' && m === 'POST') {   // a Supervisor names a Section = a new role + its own chatbox, given to him, his Staff and his Heads
      if (!isSup) throw H('Only a Supervisor can create a Section.', 403);
      const name = String(body.name || '').trim().slice(0, 30), id = slug(name, 18);
      if (!name || !TAG_ID.test(id)) throw H('Name your Section: letters, numbers and dashes (e.g. Billing).');
      if ((await chanRaw(st)).some(c => c.id === tagChan(id) && c.tag !== id)) throw H(`A channel called ${tagChan(id)} already exists. Pick another name.`);
      let tags;
      await mutTags(st, list => {
        if (list.some(t => t.id === id)) throw H('That Section/role name is already taken.');
        if (list.length >= MAX_TAGS) throw H(`This server can have up to ${MAX_TAGS} roles/sections.`);
        list.push({ id, name, sup: me.id }); tags = [...list];
      });
      await ensureTagChannels(st, tags);
      await editRecs(ents => syncSections(ents, tags));
      return J({ ok: 1, id, channel: tagChan(id) }, 201);
    }
    const sec = path.match(/^\/sections\/([a-z0-9-]+)$/);
    if (sec && m === 'DELETE') {
      let tags;
      await mutTags(st, list => { const i = list.findIndex(t => t.id === sec[1] && t.sup); if (i < 0) throw H('Section not found', 404); if (list[i].sup !== me.id && !isHead) throw H('Only its Supervisor or a Head can delete a Section.', 403); list.splice(i, 1); tags = [...list]; });
      await editRecs(ents => ents.forEach(([, rc]) => { rc.tagIds = (rc.tagIds || []).filter(x => x !== sec[1]); }));
      for (const c of await ensureTagChannels(st, tags)) await st.delete('chat:' + c);
      await mutate(st, 'depts', () => [], l => l.forEach(d => { d.sectionIds = d.sectionIds.filter(x => x !== sec[1]); }));
      return J({ ok: 1 });
    }
    if (path === '/departments' || path.startsWith('/departments/')) {   // a Head groups Sections of the Supervisors he picked
      if (!isHead) throw H('Only a Head can manage Departments.', 403);
      const dm = path.match(/^\/departments\/([a-z0-9-]+)$/);
      const okIds = async ids => { const tags = (await tagsRaw(st)).filter(t => t.sup && (us.find(u => u.id === t.sup)?.headIds || []).includes(me.id)); return uniq(ids).filter(i => tags.some(t => t.id === i)); };
      if (m === 'GET') return J({ departments: (await depts()).filter(d => d.headId === me.id) });
      if (m === 'POST') {
        const name = String(body.name || '').trim().slice(0, 30), id = slug(name, 18);
        if (!name || !TAG_ID.test(id)) throw H('Name your Department: letters, numbers and dashes.');
        const sectionIds = await okIds(body.sectionIds);
        await mutate(st, 'depts', () => [], l => { if (l.some(d => d.id === id)) throw H('That Department already exists.'); if (l.length >= 30) throw H('Too many Departments.'); l.push({ id, name, headId: me.id, sectionIds }); });
        return J({ ok: 1, id }, 201);
      }
      if (!dm) throw H('Not found', 404);
      const secIds = 'sectionIds' in body ? await okIds(body.sectionIds) : null;
      await mutate(st, 'depts', () => [], l => {
        const i = l.findIndex(d => d.id === dm[1] && d.headId === me.id); if (i < 0) throw H('Department not found', 404);
        if (m === 'DELETE') l.splice(i, 1); else { if (body.name) l[i].name = String(body.name).trim().slice(0, 30) || l[i].name; if (secIds) l[i].sectionIds = secIds; }
      });
      return J({ ok: 1 });
    }

    // ----- personal board -----
    if (path === '/board' && m === 'PUT') {
      if (!Array.isArray(body.tasks) || JSON.stringify(body).length > 1e6) throw H('Invalid board');
      const key = 'board:' + me.id, cur = await st.getWithMetadata(key, { type: 'json' }), curRev = cur?.data?.rev || 0;
      const stale = () => H('Changed on another device. Latest version loaded; please redo your last change.', 409);
      if (Number.isInteger(body.rev) && body.rev !== curRev) throw stale();
      const w = await st.setJSON(key, { ...cleanBoard(body), rev: curRev + 1 }, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
      if (w && w.modified === false) throw stale();
      if (SV !== DEF_SV && THEMES.includes(body.theme)) await mutate(bs, 'board:' + me.id, () => ({ tasks: [], rev: 0 }), d => { d.theme = body.theme; });
      return J({ ok: 1, rev: curRev + 1 });
    }

    if (path === '/theme' && m === 'POST') {   // theme picked from the server menu on any page (does not bump the board revision)
      const t = String(body.theme || '');
      if (!THEMES.includes(t)) throw H('Unknown theme');
      await mutate(bs, 'board:' + me.id, () => ({ tasks: [], rev: 0 }), d => { d.theme = t; });   // global: always the default board
      return J({ ok: 1 });
    }

    // ----- people I can assign tasks to -----
    if (path === '/people' && m === 'GET') {
      return J({ people: assignable(me, us).map(u => ({ id: u.id, name: u.name, username: u.username, role: u.role })) });
    }

    // ----- shared calendar -----
    if (path === '/shared' && m === 'GET') {
      const sh = (await st.get('shared', { type: 'json' })) || { tasks: [] };
      return J({ tasks: sh.tasks.filter(t => visible(me, t)).map(t => taskDTO(t, me, us)) });
    }
    if (path === '/shared' && m === 'POST') {
      if (me.role === 'staff') throw H('Only supervisors can assign tasks.', 403);
      const f = cleanFields(body, true);
      const ids = uniq(body.assignees);
      if (!ids.length) throw H('Pick at least one person to assign.');
      const ok = assignable(me, us).map(u => u.id);
      if (ids.some(i => !ok.includes(i))) throw H('You can only assign tasks to your own team.', 403);
      const pal = PALETTE[f.priority];
      const t = { id: 's_' + randomBytes(6).toString('hex'), ...f, pinned: !!body.pinned, status: 'active', color: pal[Math.floor(Math.random() * pal.length)],
        created: today(), createdBy: me.id, hostIds: me.role === 'host' ? [me.id] : hostsFor(ids, us), assignees: ids.map(id => ({ id, done: false, doneAt: null })) };
      await mutShared(st, sh => { sh.tasks.push(t); });
      await notify(st, ids, { sv: SV, svName: await svNameNow(), type: 'assigned', by: me.id, byName: me.name || me.username, taskId: t.id, title: t.title, date: t.date });
      return J(taskDTO(t, me, us), 201);
    }
    const sm = path.match(/^\/shared\/([\w-]+)$/);
    if (sm && (m === 'PUT' || m === 'DELETE')) {
      const ev = [];   // notifications to send once the task is saved
      const out = await mutShared(st, sh => {
        ev.length = 0;
        const i = sh.tasks.findIndex(x => x.id === sm[1]);
        const t = sh.tasks[i];
        if (!t || !visible(me, t)) throw H('Task not found', 404);
        const manage = canManage(me, t), mine = isMine(me, t);

        if (m === 'DELETE') {
          if (!manage) throw H("You don't have permission to do that.", 403);
          if (t.status !== 'trash') throw H('Move the task to Trash first.');
          sh.tasks.splice(i, 1);
          return null;
        }
        if ('done' in body) {
          const v = !!body.done, stamp = v ? today() : null;
          if (body.all) { if (!manage) throw H("You don't have permission to do that.", 403); t.assignees.forEach(a => { a.done = v; a.doneAt = stamp; }); }
          else { if (!mine) throw H('This task is not assigned to you.', 403); mine.done = v; mine.doneAt = stamp; }
          const base = { by: me.id, byName: me.name || me.username, taskId: t.id, title: t.title, date: t.date };
          if (v && !body.all) ev.push({ to: [t.createdBy, ...t.hostIds], n: { ...base, type: t.assignees.every(a => a.done) ? 'all_done' : 'done' } });
          if (v && body.all) ev.push({ to: t.assignees.map(a => a.id), n: { ...base, type: 'closed' } });
        }
        if (['title', 'description', 'priority', 'date', 'pinned', 'assignees', 'status'].some(k => k in body)) {
          if (!manage) throw H("You don't have permission to do that.", 403);
          Object.assign(t, cleanFields(body, false));
          if ('status' in body) { if (!['active', 'trash'].includes(body.status)) throw H('Invalid status'); t.status = body.status; }
          if ('assignees' in body) {
            const ids = uniq(body.assignees);
            if (!ids.length) throw H('Pick at least one person to assign.');
            const allowed = new Set([...assignable(me, us).map(u => u.id), ...t.assignees.map(a => a.id)]);
            if (ids.some(x => !allowed.has(x))) throw H('You can only assign tasks to your own team.', 403);
            const fresh = ids.filter(id => !t.assignees.some(a => a.id === id));
            if (fresh.length) ev.push({ to: fresh, n: { type: 'assigned', by: me.id, byName: me.name || me.username, taskId: t.id, title: t.title, date: t.date } });
            t.assignees = ids.map(id => t.assignees.find(a => a.id === id) || { id, done: false, doneAt: null });
            if (me.role === 'admin') t.hostIds = hostsFor(ids, us);
          }
        }
        return t;
      });
      if (ev.length) { const sn = await svNameNow(); for (const e of ev) await notify(st, e.to, { ...e.n, sv: SV, svName: sn }); }
      return out ? J(taskDTO(out, me, us)) : J({ ok: 1 });
    }

    // ----- notifications -----
    if (path === '/notifications' && m === 'GET') {
      const d = (await st.get('notif:' + me.id, { type: 'json' })) || { items: [] };
      return J({ items: d.items, unread: d.items.filter(x => !x.read).length });
    }
    if (path === '/notifications/read' && m === 'POST') {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;   // null/omitted = mark all
      await mutate(st, 'notif:' + me.id, () => ({ items: [] }), d => { d.items.forEach(x => { if (!ids || ids.includes(x.id)) x.read = true; }); });
      return J({ ok: 1 });
    }

    // ----- default admin only: read-only view of every user's personal sticky notes -----
    if (path === '/personal-all' && m === 'GET') {
      if (me.id !== DEFAULT_ADMIN || SV !== DEF_SV) throw H('Not allowed', 403);
      const tasks = [];
      for (const u of us) { const b = await st.get('board:' + u.id, { type: 'json' }); for (const t of (b?.tasks || [])) tasks.push({ ...t, userId: u.id }); }
      const sh = (await st.get('shared', { type: 'json' })) || { tasks: [] };   // the admin can manage every shared task, so the DTO shows all of them (incl. trash)
      return J({ users: us.map(u => ({ id: u.id, name: u.name || u.username, username: u.username, role: u.role, active: u.active })), tasks, shared: sh.tasks.map(t => taskDTO(t, me, us)) });
    }

    // ----- admin only -----
    if (me.role !== 'admin') throw H('Admins only', 403);

    if (SV !== DEF_SV) {   // inside a user-made server: members are existing accounts with a per-server position + roles
      const mutMem = fn => mutSrv(list => { const x = list.find(v => v.id === SV); if (!x) throw H('Server not found', 404); return fn(x); });
      const hostsOk = (x, ids) => uniq(ids).filter(h => x.members[h]?.role === 'host');
      const headCount = x => Object.values(x.members).filter(v => v.role === 'admin').length;
      if (path === '/users' && m === 'POST') {   // add an existing account by username
        const un = String(body.username || '').trim().toLowerCase(), acc = allUs.find(u => u.username === un && u.active);
        if (!acc) throw H('No active account with that username. Accounts are created by the CEPALCO admin; or share the invite code.', 404);
        const role = ROLES.includes(body.role) ? body.role : 'staff', tags = await tagsRaw(st);
        await mutMem(x => {
          if (x.members[acc.id]) throw H('Already a member.');
          if (Object.keys(x.members).length >= MAX_MEM) throw H('That server is full.');
          x.members[acc.id] = { role, hostIds: role === 'staff' ? hostsOk(x, body.hostIds) : [], tagIds: cleanTags(body.tagIds, tags) };
        });
        return J({ ok: 1 });
      }
      const sum = path.match(/^\/users\/([\w-]+)$/);
      if (sum && m === 'PUT') {
        const tags = await tagsRaw(st);
        await mutMem(x => {
          const mm = x.members[sum[1]]; if (!mm) throw H('User not found', 404);
          const role = ROLES.includes(body.role) ? body.role : mm.role;
          if (sum[1] === me.id && role !== 'admin') throw H("You can't remove your own Head role.");
          if (sum[1] === x.ownerId && role !== 'admin') throw H("The owner must stay a Head.");
          mm.role = role; mm.hostIds = role === 'staff' ? hostsOk(x, body.hostIds) : [];
          if ('tagIds' in body) mm.tagIds = cleanTags(body.tagIds, tags);
          if (role !== 'host') Object.values(x.members).forEach(v => { v.hostIds = v.hostIds.filter(h => h !== sum[1] || role === 'host'); });
        });
        return J({ ok: 1 });
      }
      if (sum && m === 'DELETE') {
        if (sum[1] === me.id) throw H("You can't remove yourself. Use Leave server.");
        await mutMem(x => {
          if (!x.members[sum[1]]) throw H('User not found', 404);
          if (sum[1] === x.ownerId) throw H("You can't remove the owner.");
          delete x.members[sum[1]]; Object.values(x.members).forEach(v => { v.hostIds = v.hostIds.filter(h => h !== sum[1]); });
        });
        await dropMember(SV, sum[1]);
        return J({ ok: 1 });
      }
      const stm = path.match(/^\/tags\/([a-z0-9-]+)$/);
      if (stm && m === 'PUT') {
        if (!(await tagsRaw(st)).some(t => t.id === stm[1])) throw H('Role not found', 404);
        const want = new Set(uniq(body.userIds));
        await mutMem(x => Object.entries(x.members).forEach(([id, v]) => { const has = v.tagIds.includes(stm[1]); if (want.has(id) && !has) v.tagIds.push(stm[1]); else if (!want.has(id) && has) v.tagIds = v.tagIds.filter(t => t !== stm[1]); }));
        return J({ ok: 1 });
      }
      if (stm && m === 'DELETE') {
        const tags = await mutTags(st, list => { const i = list.findIndex(t => t.id === stm[1]); if (i < 0) throw H('Role not found', 404); list.splice(i, 1); return [...list]; });
        await mutMem(x => Object.values(x.members).forEach(v => { v.tagIds = v.tagIds.filter(t => t !== stm[1]); }));
        for (const c of await ensureTagChannels(st, tags)) await st.delete('chat:' + c);
        return J({ ok: 1 });
      }
      if (path === '/backup') throw H('Backup/restore is available in CEPALCO Server only.', 403);
    }
    if (path === '/users' && m === 'GET') return J({ users: us.map(u => pub(u, us)) });
    if (path === '/users' && m === 'POST') {
      const un = String(body.username || '').trim().toLowerCase();
      if (allUs.some(x => x.username === un)) {   // CEPALCO: "Add member (existing account)" = give an existing account its position / roles here (and re-enable it)
        const tg = await tagsRaw(st), rl = ROLES.includes(body.role) ? body.role : 'staff';
        await mutUsers(st, list => {
          const u = list.find(x => x.username === un);
          u.role = rl; u.active = true;
          u.hostIds = rl === 'staff' ? uniq(body.hostIds).filter(h => list.some(x => x.id === h && x.role === 'host')) : [];
          if ('tagIds' in body) u.tagIds = cleanTags(body.tagIds, tg);
        });
        return J({ ok: 1, existing: 1 });
      }
      if (!isSuper || !body.password) throw H('No account with that username. Create accounts in Admin → Accounts.', 404);
      if (!UN.test(un)) throw H('Username: 3–30 letters, numbers, . _ -');
      if (String(body.password || '').length < 6) throw H('Password must be at least 6 characters.');
      const role = ROLES.includes(body.role) ? body.role : 'staff';
      const tags = await tagsRaw(st);
      await mutUsers(st, list => {
        if (list.some(x => x.username === un)) throw H('Username already exists.');
        const salt = randomBytes(8).toString('hex');
        const hostIds = role === 'staff' ? uniq(body.hostIds).filter(id => list.some(h => h.id === id && h.role === 'host')) : [];
        list.push({ id: 'u_' + randomBytes(6).toString('hex'), username: un, name: String(body.name || '').trim().slice(0, 60) || un, role, active: body.active !== false, salt, hash: hp(body.password, salt), created: today(), hostIds, tagIds: cleanTags(body.tagIds, tags), mustChange: true });
      });
      return J({ ok: 1 });
    }
    const um = path.match(/^\/users\/([\w-]+)$/);
    if (um) {
      const id = um[1];
      if (m === 'DELETE' && !isSuper) throw H('Deleting accounts is in Admin settings (platform admin only).', 403);
      if (m === 'PUT') {
        let selfPv = null;
        const tags = await tagsRaw(st);
        await mutUsers(st, list => {
          const u = list.find(x => x.id === id);
          if (!u) throw H('User not found', 404);
          const role = ROLES.includes(body.role) ? body.role : u.role, active = body.active !== false;
          if (u.id === me.id && (!active || role !== 'admin')) throw H("You can't disable your own account or remove your own admin role.");
          if (u.role === 'admin' && u.active && (role !== 'admin' || !active) && activeAdmins(list) < 2) throw H('Keep at least one active admin.');
          u.name = String(body.name || '').trim().slice(0, 60) || u.username; u.role = role; u.active = active;
          u.hostIds = role === 'staff' ? uniq(body.hostIds).filter(h => list.some(x => x.id === h && x.role === 'host')) : [];
          if ('tagIds' in body) u.tagIds = cleanTags(body.tagIds, tags);   // omitted = keep their roles as they are
          if (body.password) {
            if (String(body.password).length < 6) throw H('Password must be at least 6 characters.');
            u.salt = randomBytes(8).toString('hex'); u.hash = hp(body.password, u.salt); u.pv = (u.pv || 0) + 1;
            if (u.id === me.id) { delete u.mustChange; selfPv = u.pv; } else u.mustChange = true;
          }
        });
        if (selfPv !== null) await st.setJSON('sess:' + token, { ...sess, pv: selfPv });   // admin changing their own password keeps this session
        return J({ ok: 1 });
      }
      if (m === 'DELETE') {
        if (id === me.id) throw H("You can't delete your own account.");
        await mutUsers(st, list => {
          const i = list.findIndex(x => x.id === id);
          if (i < 0) throw H('User not found', 404);
          if (list[i].role === 'admin' && list[i].active && activeAdmins(list) < 2) throw H('Keep at least one active admin.');
          list.splice(i, 1);
          list.forEach(u => { u.hostIds = u.hostIds.filter(h => h !== id); });
        });
        for (const x of [{ id: DEF_SV }, ...(await srvList())]) await bs.delete(svKey(x.id, 'board:' + id));   // personal notes in every server
        await st.delete('avatar:' + id);
        await st.delete('pres:' + id);
        await st.delete('posts:' + id);
        const fo = await frGet(st, id);   // remove them from everyone's friend lists and delete their private conversations
        for (const o of uniq([...fo.f, ...fo.in, ...fo.out])) { await frDrop(st, id, o); await st.delete(dmKey(id, o)); }
        await st.delete('fr:' + id);
        await mutate(st, 'servers', () => [], l => l.forEach(x => { delete x.members[id]; Object.values(x.members).forEach(v => { v.hostIds = v.hostIds.filter(h => h !== id); }); }));   // leave every user-made server
        await mutShared(st, sh => sh.tasks.forEach(t => {
          t.assignees = t.assignees.filter(a => a.id !== id); t.hostIds = t.hostIds.filter(h => h !== id);
          if (!t.assignees.length) t.status = 'trash';
        }));
        return J({ ok: 1 });
      }
    }
    // ----- custom roles (tags): admin creates them, hands them to many users; each gets a private <name>-chat channel -----
    if (path === '/tags' && m === 'GET') {
      return J({ tags: (await tagsRaw(st)).map(t => ({ id: t.id, name: t.name, channel: tagChan(t.id), members: us.filter(u => u.tagIds.includes(t.id)).length })) });
    }
    if (path === '/tags' && m === 'POST') {
      const name = String(body.name || '').trim().slice(0, 30), id = slug(name, 18);
      if (!TAG_ID.test(id)) throw H('Role name: letters, numbers and dashes (e.g. DSD).');
      if ((await chanRaw(st)).some(c => c.id === tagChan(id) && c.tag !== id)) throw H(`A channel called ${tagChan(id)} already exists. Remove it first or pick another role name.`);
      let tags;
      await mutTags(st, list => {
        if (list.some(t => t.id === id)) throw H('That role already exists.');
        if (list.length >= MAX_TAGS) throw H(`You can have up to ${MAX_TAGS} custom roles.`);
        list.push({ id, name }); tags = [...list];
      });
      await ensureTagChannels(st, tags);
      return J({ ok: 1, id, channel: tagChan(id) }, 201);
    }
    const tm = path.match(/^\/tags\/([a-z0-9-]+)$/);
    if (tm && m === 'PUT') {   // set exactly who holds this role: { userIds: [...] }
      if (!(await tagsRaw(st)).some(t => t.id === tm[1])) throw H('Role not found', 404);
      const want = new Set(uniq(body.userIds));
      await mutUsers(st, list => list.forEach(u => {
        const has = u.tagIds.includes(tm[1]);
        if (want.has(u.id) && !has) u.tagIds.push(tm[1]); else if (!want.has(u.id) && has) u.tagIds = u.tagIds.filter(x => x !== tm[1]);
      }));
      return J({ ok: 1 });
    }
    if (tm && m === 'DELETE') {
      const tags = await mutTags(st, list => {
        const i = list.findIndex(t => t.id === tm[1]);
        if (i < 0) throw H('Role not found', 404);
        list.splice(i, 1); return [...list];
      });
      await mutUsers(st, list => list.forEach(u => { u.tagIds = u.tagIds.filter(x => x !== tm[1]); }));
      for (const c of await ensureTagChannels(st, tags)) await st.delete('chat:' + c);   // the role's channel and its messages go with it
      return J({ ok: 1 });
    }

    if (path === '/backup' && !isSuper) throw H('Backup/restore is in Admin settings (platform admin only).', 403);
    if (path === '/backup' && m === 'GET') {
      const boards = {};
      for (const u of us) { const b = await st.get('board:' + u.id, { type: 'json' }); if (b) boards[u.id] = b; }
      return J({ version: 5, exportedAt: new Date().toISOString(), users: us, tags: await tagsRaw(st), boards, shared: (await st.get('shared', { type: 'json' })) || { tasks: [] } });
    }
    if (path === '/backup' && m === 'POST') {
      if (![3, 4, 5].includes(body.version) || !Array.isArray(body.users)) throw H('Invalid backup file');
      const tags = Array.isArray(body.tags)
        ? body.tags.map(t => ({ id: String(t?.id || ''), name: String(t?.name || '').trim().slice(0, 30), ...(t?.sup ? { sup: String(t.sup) } : {}) })).filter((t, i, a) => TAG_ID.test(t.id) && t.name && a.findIndex(x => x.id === t.id) === i).slice(0, MAX_TAGS)
        : await tagsRaw(st);   // older backups have no roles: keep the current ones
      const users = body.users.map(normUser);
      users.forEach(u => { u.tagIds = cleanTags(u.tagIds, tags); });
      if (!users.some(u => u.role === 'admin' && u.active)) throw H('Backup must contain an active admin.');
      for (const u of us) await st.delete('board:' + u.id);
      await st.setJSON('users', users);
      await st.setJSON('tags', tags);
      for (const c of await ensureTagChannels(st, tags)) await st.delete('chat:' + c);
      for (const [id, b] of Object.entries(body.boards || {})) if (Array.isArray(b?.tasks)) await st.setJSON('board:' + String(id).replace(/[^\w-]/g, ''), cleanBoard(b));
      await st.setJSON('shared', { tasks: Array.isArray(body.shared?.tasks) ? body.shared.tasks : [] });
      return J({ ok: 1 });
    }
    throw H('Not found', 404);
  } catch (e) {
    if (e instanceof HttpError) return J({ error: e.message }, e.status);
    console.error(e);
    return J({ error: 'Server error' }, 500);
  }
};

export const config = { path: '/api/*' };
