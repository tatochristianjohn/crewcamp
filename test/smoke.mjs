// Dependency-free smoke test for the API.  Run:  npm test
// Runs the real netlify/functions/api.mjs against an in-memory stand-in for Netlify Blobs.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MOCK = `
const data = new Map(); let ver = 0;
export function getStore() { return {
  async get(k) { const r = data.get(k); return r ? structuredClone(r.v) : null; },
  async getWithMetadata(k) { const r = data.get(k); return r ? { data: structuredClone(r.v), etag: r.e, metadata: r.m || {} } : null; },
  async setJSON(k, v, o = {}) { const r = data.get(k);
    if (o.onlyIfNew && r) return { modified: false };
    if (o.onlyIfMatch && (!r || r.e !== o.onlyIfMatch)) return { modified: false };
    data.set(k, { v: structuredClone(v), e: String(++ver) }); return { modified: true }; },
  async set(k, v, o = {}) { data.set(k, { v: structuredClone(v), e: String(++ver), m: o.metadata || {} }); return { modified: true }; },
  async list(o = {}) { return { blobs: [...data.keys()].filter(k => k.startsWith(o.prefix || '')).map(key => ({ key, etag: '1' })), directories: [] }; },
  async delete(k) { data.delete(k); } }; }
export { data };`;

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stb-'));
fs.writeFileSync(path.join(tmp, 'blobs-mock.mjs'), MOCK);
fs.writeFileSync(path.join(tmp, 'api.mjs'), fs.readFileSync(path.join(here, '../netlify/functions/api.mjs'), 'utf8').replace("'@netlify/blobs'", "'./blobs-mock.mjs'"));
process.env.ADMIN_INITIAL_PASSWORD = 'test-password-123';
const mockData = (await import(pathToFileURL(path.join(tmp, 'blobs-mock.mjs')).href)).data;
const handler = (await import(pathToFileURL(path.join(tmp, 'api.mjs')).href)).default;
fs.writeFileSync(path.join(tmp, 'sweep.mjs'), fs.readFileSync(path.join(here, '../netlify/functions/sweep.mjs'), 'utf8').replace("'@netlify/blobs'", "'./blobs-mock.mjs'"));
const sweep = (await import(pathToFileURL(path.join(tmp, 'sweep.mjs')).href));

// a "browser": own cookie jar, calls the API exactly like public/auth.js (JSON header always, body only if given)
const browser = () => {
  let jar = '';
  return async (p, method = 'GET', body, rawBody) => {
    const hm = p.match(/#sv=(\S+)$/); if (hm) p = p.replace(hm[0], '');   // test shortcut: '/x#sv=<serverId>' sends the X-Server header
    const res = await handler(new Request('https://x.test/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(hm ? { 'X-Server': hm[1] } : {}), ...(jar ? { cookie: jar } : {}) }, body: rawBody ?? (body ? JSON.stringify(body) : undefined) }));
    const sc = res.headers.get('set-cookie');
    if (sc) { const [pair, ...a] = sc.split(/;\s*/); jar = a.some(x => /^Max-Age=0$/i.test(x)) ? '' : pair; }
    let d = {}; try { d = await res.json(); } catch {}
    return { status: res.status, d, cookie: jar };
  };
};

let failed = 0;
const check = (name, ok) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name); if (!ok) failed++; };
const ADMIN = { username: 'admin', password: 'test-password-123' };

console.log('Login / logout');
const A = browser();
check('wrong password is rejected (401)', (await A('/login', 'POST', { username: 'admin', password: 'nope-nope-1' })).status === 401);
check('login works', (await A('/login', 'POST', ADMIN)).status === 200);
check('/me works when logged in', (await A('/me')).status === 200);
const oldCookie = (await A('/me')).cookie;
check('logout with no body works (the original auto-login bug)', (await A('/logout', 'POST')).status === 200);
check('/me is 401 after logout, so the login page will not auto-login', (await A('/me')).status === 401);
const replay = browser(); await replay('/me');   // fresh jar, then replay the OLD cookie
const r = await handler(new Request('https://x.test/api/me', { headers: { cookie: oldCookie } }));
check('the old session cookie is revoked server-side', r.status === 401);
check('logout still succeeds with no session at all', (await browser()('/logout', 'POST')).status === 200);
check('malformed JSON is still rejected (400)', (await browser()('/login', 'POST', null, '{not json')).status === 400);

console.log('Board: no silent overwrite between devices');
const D1 = browser(), D2 = browser();
await D1('/login', 'POST', ADMIN); await D2('/login', 'POST', ADMIN);
const b1 = await D1('/board', 'PUT', { theme: 'white', tasks: [], rev: 0 });
check('first save returns revision 1', b1.status === 200 && b1.d.rev === 1);
const b2 = await D2('/board', 'PUT', { theme: 'white', tasks: [{ id: 'x', title: 'from device 2', date: '2026-01-02' }], rev: 0 });
check('a stale device is refused (409) instead of overwriting', b2.status === 409);
check('...and the first device\'s data is intact', (await D2('/me')).d.board.rev === 1);
const b3 = await D1('/board', 'PUT', { theme: 'white', tasks: [], rev: 1 });
check('saving with the current revision works (rev 2)', b3.status === 200 && b3.d.rev === 2);
check('an older client that sends no revision still works', (await D1('/board', 'PUT', { theme: 'white', tasks: [] })).status === 200);

console.log('Passwords revoke other sessions');
const P1 = browser(), P2 = browser();
await P1('/login', 'POST', ADMIN); await P2('/login', 'POST', ADMIN);
check('changing password succeeds', (await P1('/change-password', 'POST', { currentPassword: ADMIN.password, newPassword: 'new-password-456' })).status === 200);
check('the device that changed it stays signed in', (await P1('/me')).status === 200);
check('every other device is signed out', (await P2('/me')).status === 401);
check('the old password no longer works', (await browser()('/login', 'POST', ADMIN)).status === 401);
const N = browser(); check('the new password works', (await N('/login', 'POST', { username: 'admin', password: 'new-password-456' })).status === 200);

console.log('Admin reset signs the user out; dates use Manila time');
const real = Date.now, fake = Date.parse('2026-01-01T17:00:00Z');   // 01:00 on 2 Jan in Manila, still 1 Jan in UTC
Date.now = () => fake;
await N('/users', 'POST', { username: 'staff1', name: 'Staff One', role: 'staff', password: 'temp-pass-1' });
Date.now = real;
const created = (await N('/users')).d.users.find(u => u.username === 'staff1');
check('records created after midnight in Manila get the Manila date', created.created === '2026-01-02');
const S = browser(); check('staff can log in', (await S('/login', 'POST', { username: 'staff1', password: 'temp-pass-1' })).status === 200);
await N('/users/' + created.id, 'PUT', { name: 'Staff One', role: 'staff', active: true, hostIds: [], password: 'reset-pass-2' });
check('admin password reset signs that user out everywhere', (await S('/me')).status === 401);
check('admin changing their own password via Users keeps their session', (await N('/users/u_admin', 'PUT', { name: 'Administrator', role: 'admin', active: true, password: 'admin-new-789' })).status === 200 && (await N('/me')).status === 200);

console.log('Heads (admins) never receive tasks');
await N('/users', 'POST', { username: 'head2', name: 'Second Head', role: 'admin', password: 'head-pass-2' });
await N('/users', 'POST', { username: 'sup1', name: 'Supervisor', role: 'host', password: 'sup-pass-12' });
const users = (await N('/users')).d.users, id = u => users.find(x => x.username === u).id;
await N('/users', 'POST', { username: 'staff2', name: 'Staff Two', role: 'staff', password: 'staff-pass-2', hostIds: [id('sup1')] });
const staff2 = (await N('/users')).d.users.find(x => x.username === 'staff2').id;
const task = a => ({ title: 'Do it', description: '', priority: 'Now', date: '2026-02-01', assignees: a });
const people = (await N('/people')).d.people.map(x => x.username);
check("the Head's 'assign to' list excludes every Head (including the default admin)", !people.includes('admin') && !people.includes('head2'));
check("...but still lists supervisors and staff", people.includes('sup1') && people.includes('staff2'));
check('a Head cannot assign a task to themselves', (await N('/shared', 'POST', task(['u_admin']))).status === 403);
check('a Head cannot assign a task to another Head', (await N('/shared', 'POST', task([id('head2')]))).status === 403);
check('a Head cannot assign to [staff + a Head] together', (await N('/shared', 'POST', task([staff2, id('head2')]))).status === 403);
const ok = await N('/shared', 'POST', task([staff2, id('sup1')]));
check('a Head can still assign to staff and supervisors', ok.status === 201);
check('a Head cannot add a Head to an existing task', (await N('/shared/' + ok.d.id, 'PUT', { assignees: [staff2, 'u_admin'] })).status === 403);
const H2 = browser(); await H2('/login', 'POST', { username: 'head2', password: 'head-pass-2' });
check('a NEW Head cannot assign a task to the default admin', (await H2('/shared', 'POST', task(['u_admin']))).status === 403);
check('a NEW Head cannot assign a task to themselves', (await H2('/shared', 'POST', task([id('head2')]))).status === 403);
check('a NEW Head can assign to staff', (await H2('/shared', 'POST', task([staff2]))).status === 201);

console.log('All-users personal overview (default admin only)');
check('the default admin is flagged for the overview', (await N('/me')).d.user.overview === true);
check('a NEW Head is not flagged', (await H2('/me')).d.user.overview === false);
check('a NEW Head is refused the overview (403)', (await H2('/personal-all')).status === 403);
check('logged-out visitors are refused (401)', (await browser()('/personal-all')).status === 401);
const hb = await H2('/me');
check('a user can save a personal note', (await H2('/board', 'PUT', { theme: 'white', tasks: [{ id: 'ov1', title: 'head2 private note', date: '2026-03-05' }], rev: hb.d.board?.rev ?? 0 })).status === 200);
const ov = await N('/personal-all');
check('the default admin sees every user and their notes', ov.status === 200 && ov.d.users.length >= 2 && ov.d.tasks.some(t => t.title === 'head2 private note' && t.userId === id('head2')));
check('the overview also returns every shared task (incl. ones the admin is not assigned to)', Array.isArray(ov.d.shared) && ov.d.shared.length >= 2 && ov.d.shared.every(x => x.assignees && x.createdByName));
check('the overview never exposes password hashes', !JSON.stringify(ov.d).includes('hash') && !JSON.stringify(ov.d).includes('salt'));
check('the overview is read-only (no write route)', (await N('/personal-all', 'PUT', {})).status === 404);

console.log('Profile picture');
const PNG = 'data:image/png;base64,' + Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).toString('base64');
check('avatar: no picture yet -> 404', (await H2('/avatar')).status === 404);
check('avatar: non-image is rejected', (await H2('/avatar', 'POST', { image: 'data:text/html;base64,PGI+' })).status === 400);
check('avatar: fake image bytes are rejected', (await H2('/avatar', 'POST', { image: 'data:image/png;base64,AAAAAAAA' })).status === 400);
const up1 = await H2('/avatar', 'POST', { image: PNG });
check('avatar: first upload works', up1.status === 200 && up1.d.avatarNext > Date.now() + 14 * 864e5);
check('avatar: /me shows avatarAt', (await H2('/me')).d.user.avatarAt > 0);
check('avatar: can be fetched back', (await H2('/avatar')).status === 200);
const up2 = await H2('/avatar', 'POST', { image: PNG });
check('avatar: second change within 15 days is refused (429)', up2.status === 429);
check('avatar: logged-out visitors are refused', (await browser()('/avatar', 'POST', { image: PNG })).status === 401);

console.log('Group chat');
const SS = browser(); await SS('/login', 'POST', { username: 'staff2', password: 'staff-pass-2' });
check('chat: logged-out visitors are refused (401)', (await browser()('/chat')).status === 401);
const c0 = await SS('/chat?ch=general&rev=-1');
check('chat: starts with a general channel and nobody else online yet', c0.status === 200 && c0.d.channels[0].id === 'general' && c0.d.msgs.length === 0);
check('chat: the poller counts as online', c0.d.online.some(u => u.name === 'Staff Two'));
check('chat: empty messages are refused', (await SS('/chat/send', 'POST', { ch: 'general', text: '   ' })).status === 400);
check('chat: unknown channel is refused', (await SS('/chat/send', 'POST', { ch: 'nope', text: 'hi' })).status === 404);
const m1 = await SS('/chat/send', 'POST', { ch: 'general', text: 'hello <b>team</b>' });
check('chat: staff can send a message', m1.status === 201 && m1.d.mine === true && m1.d.canDel === true);
const seenNow = 'general:' + (m1.d.ts - 1);
const hp1 = await H2('/chat?ch=general&rev=-1&seen=' + seenNow);
check("chat: another user sees it with the sender's name and role", hp1.d.msgs.length === 1 && hp1.d.msgs[0].name === 'Staff Two' && hp1.d.msgs[0].mine === false);
check('chat: the other user gets an unread count', hp1.d.channels[0].unread === 1);
check('chat: unread clears once seen', (await H2('/chat?ch=general&rev=-1&seen=general:' + m1.d.ts)).d.channels[0].unread === 0);
check('chat: an up-to-date client (same rev) is not resent the messages', (await H2('/chat?ch=general&rev=' + hp1.d.rev)).d.msgs === undefined);
check('chat: online list shows both people, Heads first', (await H2('/chat')).d.online.map(u => u.role).join() === 'admin,staff');
check('chat: typing shows to others', (await SS('/chat?ch=general&typing=general')).status === 200 && (await H2('/chat?ch=general')).d.online.find(u => u.name === 'Staff Two').typing === true);
check('chat: typing in another channel is not shown here', (await SS('/chat?ch=general')) && (await H2('/chat?ch=general')).d.online.find(u => u.name === 'Staff Two').typing === false);
check("chat: nobody can edit someone else's message", (await H2('/chat/msg/' + m1.d.id + '?ch=general', 'PUT', { text: 'hacked' })).status === 403);
const ed = await SS('/chat/msg/' + m1.d.id + '?ch=general', 'PUT', { text: 'edited' });
check('chat: the author can edit (and it is marked edited)', ed.status === 200 && ed.d.edited === true && ed.d.text === 'edited');
check('chat: an edit bumps the revision so others refresh', (await H2('/chat?ch=general&rev=' + hp1.d.rev)).d.msgs?.[0].text === 'edited');
const hotPoll = await SS('/chat?ch=general&rev=-1');
check('chat: poll reports "hot" (ms since last activity) so the browser can poll faster during a live conversation', typeof hotPoll.d.hot === 'number');
const other = await SS('/chat/send', 'POST', { ch: 'general', text: 'second' });
check("chat: a regular user cannot delete someone else's message", (await H2('/chat/send', 'POST', { ch: 'general', text: 'from head2' })).status === 201 && (await SS('/chat/msg/' + (await H2('/chat?ch=general&rev=-1')).d.msgs.at(-1).id + '?ch=general', 'DELETE')).status === 403);
check('chat: a Head can delete anyone\'s message', (await N('/chat/msg/' + other.d.id + '?ch=general', 'DELETE')).status === 200);
check('chat: the author can delete their own', (await SS('/chat/msg/' + m1.d.id + '?ch=general', 'DELETE')).status === 200);
check('chat: deleted messages are gone', !(await SS('/chat?ch=general&rev=-1')).d.msgs.some(x => x.id === m1.d.id || x.id === other.d.id));
check('chat: staff cannot add channels', (await SS('/chat/channels', 'POST', { name: 'random' })).status === 403);
check('chat: a Head can add a channel', (await N('/chat/channels', 'POST', { name: 'Random Stuff!' })).d.id === 'random-stuff');
check('chat: duplicate channel names are refused', (await N('/chat/channels', 'POST', { name: 'random-stuff' })).status === 400);
check('chat: new channel shows for everyone', (await SS('/chat')).d.channels.map(c => c.id).join() === 'general,random-stuff');
check('chat: messages go to the right channel', (await SS('/chat/send', 'POST', { ch: 'random-stuff', text: 'off topic' })).status === 201 && (await SS('/chat?ch=general&rev=-1')).d.msgs.every(x => x.text !== 'off topic'));
check('chat: general cannot be removed', (await N('/chat/channels/general', 'DELETE')).status === 400);
check('chat: a Head can remove a channel', (await N('/chat/channels/random-stuff', 'DELETE')).status === 200 && (await SS('/chat')).d.channels.length === 1);
await N('/chat/channels', 'POST', { name: 'quiet' });
check('chat: an empty channel seen at 0 still counts later messages as unread (regression)', (await SS('/chat/send', 'POST', { ch: 'quiet', text: 'first!' })).status === 201 && (await H2('/chat?seen=general:0,quiet:0')).d.channels.find(c => c.id === 'quiet').unread === 1);
check('chat: a channel missing from a known "seen" list counts as all-unread; a brand-new browser (no list) sees 0', (await H2('/chat?seen=general:0')).d.channels.find(c => c.id === 'quiet').unread === 1 && (await H2('/chat')).d.channels.find(c => c.id === 'quiet').unread === 0);
await N('/chat/channels/quiet', 'DELETE');
check('chat: 1000+ character messages are trimmed', (await SS('/chat/send', 'POST', { ch: 'general', text: 'x'.repeat(5000) })).d.text.length === 1000);
check("chat: teammates' profile pictures can be fetched", (await N('/avatar/' + id('head2'))).status === 200);
check('chat: a stranger cannot fetch profile pictures', (await browser()('/avatar/' + id('head2'))).status === 401);

console.log('Custom roles & private role chats');
const sup = browser(); await sup('/login', 'POST', { username: 'sup1', password: 'sup-pass-12' });
check('roles: staff cannot list or create roles (403)', (await SS('/tags')).status === 403 && (await SS('/tags', 'POST', { name: 'DSD' })).status === 403);
check('roles: empty names are refused', (await N('/tags', 'POST', { name: '  !!  ' })).status === 400);
const t1 = await N('/tags', 'POST', { name: 'DSD' });
check('roles: a Head can create a role; it gets a dsd-chat channel', t1.status === 201 && t1.d.id === 'dsd' && t1.d.channel === 'dsd-chat');
check('roles: duplicate role is refused', (await N('/tags', 'POST', { name: 'dsd' })).status === 400);
check('roles: a role nobody holds is invisible in everyone\'s chat', (await SS('/chat')).d.channels.every(c => c.id !== 'dsd-chat') && (await N('/chat')).d.channels.every(c => c.id !== 'dsd-chat'));
check('roles: tag staff2 + sup1 at once ("distribute to many users")', (await N('/tags/dsd', 'PUT', { userIds: [staff2, id('sup1')] })).status === 200);
check('roles: users list shows who holds it', (await N('/users')).d.users.find(u => u.id === staff2).tagIds.join() === 'dsd' && (await N('/tags')).d.tags[0].members === 2);
const dsd = await SS('/chat?ch=dsd-chat&rev=-1');
check('roles: a holder sees dsd-chat (marked private)', dsd.d.channels.some(c => c.id === 'dsd-chat' && c.tag === 'dsd') && dsd.d.ch === 'dsd-chat');
check('roles: ...and can post in it', (await SS('/chat/send', 'POST', { ch: 'dsd-chat', text: 'dsd only' })).status === 201);
check('roles: another holder can read it', (await sup('/chat?ch=dsd-chat&rev=-1')).d.msgs.some(m => m.text === 'dsd only'));
const outsider = await H2('/chat?ch=dsd-chat&rev=-1');
check('roles: a user WITHOUT the role does not see the channel, its messages or its unread count', outsider.d.channels.every(c => c.id !== 'dsd-chat') && outsider.d.msgs === undefined && outsider.d.ch === null);
check('roles: ...cannot post to it (404)', (await H2('/chat/send', 'POST', { ch: 'dsd-chat', text: 'sneaky' })).status === 404);
const dm = (await SS('/chat?ch=dsd-chat&rev=-1')).d.msgs.at(-1);
check('roles: ...cannot edit or delete its messages (404)', (await H2('/chat/msg/' + dm.id + '?ch=dsd-chat', 'PUT', { text: 'x' })).status === 404 && (await H2('/chat/msg/' + dm.id + '?ch=dsd-chat', 'DELETE')).status === 404);
check('roles: a Head who does not hold the role is also locked out', (await N('/chat?ch=dsd-chat&rev=-1')).d.msgs === undefined && (await N('/chat/send', 'POST', { ch: 'dsd-chat', text: 'x' })).status === 404);
const onl = (await SS('/chat?ch=dsd-chat')).d.online.map(u => u.name);
check('roles: the online list inside a role channel only shows its members', onl.includes('Staff Two') && !onl.includes('Second Head'));
check('roles: general is still visible to everyone', (await H2('/chat')).d.channels.some(c => c.id === 'general'));
check('roles: a role channel cannot be removed on its own', (await N('/chat/channels/dsd-chat', 'DELETE')).status === 400);
check('roles: a manual channel cannot steal a role channel name', (await N('/chat/channels', 'POST', { name: 'dsd-chat' })).status === 400);
check('roles: unknown role ids are ignored when tagging a user', (await N('/users/' + staff2, 'PUT', { name: 'Staff Two', role: 'staff', active: true, hostIds: [id('sup1')], tagIds: ['dsd', 'ghost'] })).status === 200 && (await N('/users')).d.users.find(u => u.id === staff2).tagIds.join() === 'dsd');
check('roles: editing a user without tagIds keeps their roles', (await N('/users/' + staff2, 'PUT', { name: 'Staff Two', role: 'staff', active: true, hostIds: [id('sup1')] })).status === 200 && (await N('/users')).d.users.find(u => u.id === staff2).tagIds.join() === 'dsd');
check('roles: an existing user can be tagged from the edit form', (await N('/users/' + id('head2'), 'PUT', { name: 'Second Head', role: 'admin', active: true, tagIds: ['dsd'] })).status === 200 && (await H2('/chat?ch=dsd-chat&rev=-1')).d.msgs?.some(m => m.text === 'dsd only'));
await N('/tags', 'POST', { name: 'Billing Team' });
check('roles: new users can be created with roles', (await N('/users', 'POST', { username: 'bill1', name: 'Bill', role: 'staff', password: 'bill-pass-12', tagIds: ['billing-team', 'nope'] })).status === 200 && (await N('/users')).d.users.find(u => u.username === 'bill1').tagIds.join() === 'billing-team');
const BB = browser(); await BB('/login', 'POST', { username: 'bill1', password: 'bill-pass-12' });
check('roles: a user in a different role sees only their own role channel', (await BB('/chat')).d.channels.map(c => c.id).join() === 'general,billing-team-chat');
check('roles: removing someone from a role removes the channel from them at once', (await N('/tags/dsd', 'PUT', { userIds: [staff2] })).status === 200 && (await H2('/chat?ch=dsd-chat&rev=-1')).d.channels.every(c => c.id !== 'dsd-chat') && (await sup('/chat')).d.channels.every(c => c.id !== 'dsd-chat'));
check('roles: role channels do not count toward the 6-channel limit', (await Promise.all(['a1', 'a2', 'a3', 'a4', 'a5'].map(n => N('/chat/channels', 'POST', { name: n })))).every(r => r.status === 201) && (await N('/chat/channels', 'POST', { name: 'a6' })).status === 400);
for (const n of ['a1', 'a2', 'a3', 'a4', 'a5']) await N('/chat/channels/' + n, 'DELETE');
const bk = await N('/backup');
check('roles: backups include the roles', bk.d.version === 5 && bk.d.tags.length === 2);
check('roles: deleting a role removes it from users and deletes its channel + messages', (await N('/tags/dsd', 'DELETE')).status === 200
  && (await N('/users')).d.users.every(u => !u.tagIds.includes('dsd')) && (await SS('/chat')).d.channels.every(c => c.id !== 'dsd-chat'));
check('roles: re-creating the role starts with an empty channel', (await N('/tags', 'POST', { name: 'DSD' })).status === 201 && (await N('/tags/dsd', 'PUT', { userIds: [staff2] })).status === 200 && (await SS('/chat?ch=dsd-chat&rev=-1')).d.msgs.length === 0);
check('roles: restoring a backup brings the roles and who holds them back', (await N('/backup', 'POST', bk.d)).status === 200 && (await N('/tags')).d.tags.length === 2 && (await N('/users')).d.users.find(u => u.id === staff2).tagIds.join() === 'dsd');
check('roles: an older backup (no roles) still restores and drops stale role ids', (await N('/backup', 'POST', { ...bk.d, version: 4, tags: undefined, users: bk.d.users.map(u => ({ ...u, tagIds: ['dsd', 'zzz'] })) })).status === 200 && (await N('/users')).d.users.every(u => u.tagIds.every(t => ['dsd', 'billing-team'].includes(t))));


console.log('Profiles: view online/offline users, hide profile');
const s1id = (await N('/users')).d.users.find(x => x.username === 'staff1').id;
const V = browser(); await V('/login', 'POST', { username: 'sup1', password: 'sup-pass-12' });   // a plain viewer
await SS('/chat');   // staff2 heartbeat -> online
const pOn = await V('/profile/' + staff2), pOff = await SS('/profile/' + s1id);
check('profile: anyone can view an online user', pOn.status === 200 && pOn.d.online === true && pOn.d.username === 'staff2' && !pOn.d.hidden);
check('profile: anyone can view an offline user (with last seen when known)', pOff.status === 200 && pOff.d.online === false && pOff.d.hidden === false);
check('profile: chat lists offline people too', (await SS('/chat')).d.offUsers.some(u => u.id === s1id));
check('profile: unknown id is 404', (await V('/profile/nope')).status === 404);
check('profile: hiding needs login', (await browser()('/profile-visibility', 'POST', { hidden: true })).status === 401);
check('profile: a user can hide their own profile', (await SS('/profile-visibility', 'POST', { hidden: true })).d.profileHidden === true && (await SS('/me')).d.user.profileHidden === true);
const hv = await V('/profile/' + staff2);
check('profile: others then see only the name', hv.d.hidden === true && hv.d.name && !hv.d.role && !hv.d.username && !hv.d.lastSeen && !('avatarAt' in hv.d));
check('profile: the owner still sees their own full profile', (await SS('/profile/' + staff2)).d.hidden === false);
check('profile: a Head can still see a hidden profile', (await N('/profile/' + staff2)).d.hidden === false);
check('profile: hidden photo is not served to others', (await V('/avatar/' + staff2)).status === 404);
check('profile: chat cards drop the hidden photo version for others', !((await V('/chat')).d.avs || {})[staff2]);
check('profile: un-hiding works', (await SS('/profile-visibility', 'POST', { hidden: false })).d.profileHidden === false && (await V('/profile/' + staff2)).d.hidden === false);

console.log('Notifications (bell)');
const nb = (await SS('/notifications')).d;
check('notify: assignee got an "assigned" notification, unread', nb.items.some(n => n.type === 'assigned' && n.title === 'Do it' && !n.read) && nb.unread >= 1);
check('notify: the assigner is not notified about their own action', !(await N('/notifications')).d.items.some(n => n.type === 'assigned'));
const nt = await N('/shared', 'POST', task([staff2]));
check('notify: a new assignment adds another unread item', (await SS('/notifications')).d.unread === nb.unread + 1);
await SS('/shared/' + nt.d.id, 'PUT', { done: true });
const an = (await N('/notifications')).d;
check('notify: assigner is told when the assignee marks done', an.items.some(n => (n.type === 'done' || n.type === 'all_done') && n.taskId === nt.d.id && n.byName === 'Staff Two'));
const one = (await SS('/notifications')).d.items[0];
await SS('/notifications/read', 'POST', { ids: [one.id] });
check('notify: marking one as read lowers the unread count by one', (await SS('/notifications')).d.unread === nb.unread);
await SS('/notifications/read', 'POST', {});
check('notify: mark all as read clears the badge', (await SS('/notifications')).d.unread === 0);
check('notify: needs login', (await browser()('/notifications')).status === 401);
check('notify: people only see their own notifications', !(await V('/notifications')).d.items.some(n => n.taskId === nt.d.id && n.type === 'assigned'));

console.log('Friends + private messages');
const head2 = id('head2');
check('friends: needs login', (await browser()('/friends')).status === 401 && (await browser()('/dm/send', 'POST', { to: head2, text: 'x' })).status === 401);
check('friends: nobody is a friend at first', (await SS('/friends')).d.friends.length === 0 && (await SS('/friends')).d.others.every(u => u.state === 'none'));
check('friends: cannot add yourself or a stranger id', (await SS('/friends/request', 'POST', { userId: staff2 })).status === 404 && (await SS('/friends/request', 'POST', { userId: 'u_nope' })).status === 404);
check('friends: unknown action is not a route', [403, 404].includes((await SS('/friends/block', 'POST', { userId: head2 })).status));
const rq = await SS('/friends/request', 'POST', { userId: head2 });
check('friends: staff can send a friend request', rq.status === 201 && rq.d.state === 'sent');
check('friends: sending it twice is harmless', (await SS('/friends/request', 'POST', { userId: head2 })).d.state === 'sent');
check('friends: the receiver sees it in Requests and in the poll', (await H2('/friends')).d.incoming.some(u => u.id === staff2) && (await H2('/chat')).d.reqIn.some(u => u.id === staff2));
check('friends: the sender sees it as sent', (await SS('/friends')).d.outgoing.some(u => u.id === head2) && (await SS('/chat')).d.reqOut.includes(head2));
check('friends: receiver is notified (bell)', (await H2('/notifications')).d.items.some(n => n.type === 'friend_req' && n.byName === 'Staff Two'));
check('friends: profile shows the state to each side', (await SS('/profile/' + head2)).d.friend === 'sent' && (await H2('/profile/' + staff2)).d.friend === 'received' && (await SS('/profile/' + staff2)).d.friend === 'self');
check('friends: no private messages before the request is accepted', (await SS('/dm/send', 'POST', { to: head2, text: 'hi' })).status === 403);
check('friends: only the receiver can accept', (await SS('/friends/accept', 'POST', { userId: head2 })).status === 404);
check('friends: the receiver can decline', (await H2('/friends/decline', 'POST', { userId: staff2 })).d.state === 'none' && (await SS('/profile/' + head2)).d.friend === 'none' && (await H2('/friends')).d.incoming.length === 0);
await SS('/friends/request', 'POST', { userId: head2 });
check('friends: the sender can cancel', (await SS('/friends/cancel', 'POST', { userId: head2 })).d.state === 'none' && (await H2('/friends')).d.incoming.length === 0);
await SS('/friends/request', 'POST', { userId: head2 });
check('friends: the receiver can accept', (await H2('/friends/accept', 'POST', { userId: staff2 })).d.state === 'friends');
check('friends: both lists now show each other', (await SS('/friends')).d.friends.some(u => u.id === head2) && (await H2('/friends')).d.friends.some(u => u.id === staff2) && (await SS('/friends')).d.incoming.length === 0 && (await SS('/friends')).d.outgoing.length === 0);
check('friends: the sender is told it was accepted', (await SS('/notifications')).d.items.some(n => n.type === 'friend_ok' && n.byName));
check('friends: asking someone who already asked you makes you friends (no double request)', await (async () => {
  await N('/users', 'POST', { username: 'tmpfriend', name: 'Tmp Friend', role: 'staff', password: 'tmp-pass-12' });
  const tmp1 = (await N('/users')).d.users.find(x => x.username === 'tmpfriend').id, T = browser(); await T('/login', 'POST', { username: 'tmpfriend', password: 'tmp-pass-12' });
  await SS('/friends/request', 'POST', { userId: tmp1 });
  const r = await T('/friends/request', 'POST', { userId: staff2 });
  return r.d.state === 'friends' && (await SS('/friends')).d.friends.some(u => u.id === tmp1);
})());
const hello = await SS('/dm/send', 'POST', { to: head2, text: 'hello <b>friend</b>' });
check('dm: friends can send a private message', hello.status === 201 && hello.d.mine === true && hello.d.text === 'hello <b>friend</b>');
const fp = await H2('/chat?dm=' + staff2 + '&drev=' + staff2 + ':-1&dseen=' + staff2 + ':0');
const fe = fp.d.friends.find(f => f.id === staff2);
check('dm: the friend gets an unread count and a preview', fe && fe.unread === 1 && fe.prev.startsWith('hello') && fe.pm === false && fe.last === hello.d.ts);
check('dm: an open conversation comes with its messages (marked not mine)', fp.d.dms[staff2].msgs.length === 1 && fp.d.dms[staff2].msgs[0].mine === false);
check('dm: unread clears once seen', (await H2('/chat?dseen=' + staff2 + ':' + hello.d.ts)).d.friends.find(f => f.id === staff2).unread === 0);
check('dm: an up-to-date client is not resent the messages', (await H2('/chat?dm=' + staff2 + '&drev=' + staff2 + ':' + fp.d.dms[staff2].rev)).d.dms[staff2].msgs === undefined);
check('dm: a brand-new browser (no seen list) starts with nothing unread', (await H2('/chat')).d.friends.find(f => f.id === staff2).unread === 0);
check('dm: a conversation that is not open is not sent', (await H2('/chat')).d.dms[staff2] === undefined);
check('dm: empty message refused, long one trimmed', (await SS('/dm/send', 'POST', { to: head2, text: '  ' })).status === 400 && (await SS('/dm/send', 'POST', { to: head2, text: 'x'.repeat(3000) })).d.text.length === 1000);
check('dm: typing shows to the friend', (await SS('/chat?dtyping=' + head2)).status === 200 && (await H2('/chat')).d.friends.find(f => f.id === staff2).typing === true);
check('dm: typing stops showing for someone else', (await H2('/chat')).d.friends.find(f => f.id === staff2).typing === true && (await SS('/chat')) && (await H2('/chat')).d.friends.find(f => f.id === staff2).typing === false);
const supId = id('sup1');
check('dm: a non-friend cannot message you', (await sup('/dm/send', 'POST', { to: staff2, text: 'psst' })).status === 403);
const spy = await sup('/chat?dm=' + staff2 + '&drev=' + staff2 + ':-1');
check('dm: nobody else can read the conversation (not even by asking for it)', !JSON.stringify(spy.d).includes('hello <b>friend</b>') && spy.d.dms[staff2] === undefined);
const adm = await N('/chat?dm=' + staff2 + '&drev=' + staff2 + ':-1');
check('dm: Heads cannot read private messages either', !JSON.stringify(adm.d).includes('hello <b>friend</b>'));
check("dm: nobody can edit or delete someone else's message", (await H2('/dm/msg/' + hello.d.id + '?with=' + staff2, 'PUT', { text: 'hacked' })).status === 403 && (await H2('/dm/msg/' + hello.d.id + '?with=' + staff2, 'DELETE')).status === 403 && (await N('/dm/msg/' + hello.d.id + '?with=' + staff2, 'DELETE')).status === 404);
const dedit = await SS('/dm/msg/' + hello.d.id + '?with=' + head2, 'PUT', { text: 'edited hello' });
check('dm: the author can edit (marked edited) and it bumps the revision', dedit.status === 200 && dedit.d.edited === true && (await H2('/chat?dm=' + staff2 + '&drev=' + staff2 + ':' + fp.d.dms[staff2].rev)).d.dms[staff2].msgs[0].text === 'edited hello');
check('dm: the author can delete', (await SS('/dm/msg/' + hello.d.id + '?with=' + head2, 'DELETE')).status === 200 && !(await H2('/chat?dm=' + staff2 + '&drev=' + staff2 + ':-1')).d.dms[staff2].msgs.some(x => x.id === hello.d.id));
check('dm: quick polls count as live activity ("hot")', typeof (await H2('/chat')).d.hot === 'number');
check('friends: a friend request never leaks into the group-chat people list', !JSON.stringify((await H2('/chat')).d.online).includes('reqIn'));
check('friends: unfriending removes both sides', (await H2('/friends/' + staff2, 'DELETE')).status === 200 && !(await SS('/friends')).d.friends.some(u => u.id === head2) && !(await H2('/chat')).d.friends.some(f => f.id === staff2));
check('friends: after unfriending, messages are refused again', (await SS('/dm/send', 'POST', { to: head2, text: 'still there?' })).status === 403 && (await H2('/dm/send', 'POST', { to: staff2, text: 'hello?' })).status === 403);
check('friends: declining cannot be used to unfriend someone', await (async () => { const t2 = (await N('/users')).d.users.find(x => x.username === 'tmpfriend').id; return (await SS('/friends/decline', 'POST', { userId: t2 })).status === 400; })());
const tmpId = (await N('/users')).d.users.find(x => x.username === 'tmpfriend').id;
check('friends: deleting an account removes it from friend lists', (await N('/users/' + tmpId, 'DELETE')).status === 200 && !(await SS('/friends')).d.friends.some(u => u.id === tmpId) && !(await SS('/chat')).d.friends.some(f => f.id === tmpId));
check('friends: friends + pending requests are capped', await (async () => {
  const ids = [];
  for (let i = 0; i < 42; i++) { await N('/users', 'POST', { username: 'cap' + i, name: 'Cap ' + i, role: 'staff', password: 'cap-pass-12' }); }
  const all = (await N('/users')).d.users.filter(x => x.username.startsWith('cap')).map(x => x.id);
  const C = browser(); await C('/login', 'POST', { username: 'cap0', password: 'cap-pass-12' });
  let last = 0;
  for (const o of all.slice(1)) { const r = await C('/friends/request', 'POST', { userId: o }); last = r.status; if (r.status !== 201) break; }
  return last === 400;
})());

console.log('Profile posts (Threads style)');
const sleep = ms => new Promise(r => setTimeout(r, ms));
await N('/users', 'POST', { username: 'poster3', name: 'Poster Three', role: 'staff', password: 'poster-pass-3' });
const P3 = browser(); await P3('/login', 'POST', { username: 'poster3', password: 'poster-pass-3' });   // a plain staff member with no special powers
const likeN = async () => (await SS('/notifications')).d.items.filter(n => n.type === 'post_like').length;
check('posts: need login', (await browser()('/posts/' + staff2)).status === 401 && (await browser()('/posts', 'POST', { text: 'x' })).status === 401);
check('posts: a new profile has none; "mine" is true only for the owner', (await P3('/posts/' + staff2)).d.posts.length === 0 && (await SS('/posts/' + staff2)).d.mine === true && (await P3('/posts/' + staff2)).d.mine === false);
check('posts: blank posts are refused', (await SS('/posts', 'POST', { text: '   ' })).status === 400 && (await SS('/posts', 'POST', {})).status === 400);
const p1 = await SS('/posts', 'POST', { text: 'Hello <b>team</b>\n\n\n\nsecond line' });
check('posts: you can post on your own profile (plain text, extra blank lines trimmed)', p1.status === 201 && p1.d.text === 'Hello <b>team</b>\n\nsecond line' && p1.d.canDelete === true && p1.d.likes === 0);
check('posts: posting twice within 2 s is slowed down (429)', (await SS('/posts', 'POST', { text: 'again' })).status === 429);
const seen = (await P3('/posts/' + staff2)).d.posts;
check('posts: others see the post but cannot delete it', seen.length === 1 && seen[0].text.includes('<b>team</b>') && seen[0].canDelete === false);
const pid = p1.d.id;
check('posts: like toggles, counts, and is "liked" only for the liker', (await P3(`/posts/${staff2}/${pid}/like`, 'POST', {})).d.liked === true && (await P3('/posts/' + staff2)).d.posts[0].likes === 1 && (await P3('/posts/' + staff2)).d.posts[0].liked === true && (await SS('/posts/' + staff2)).d.posts[0].liked === false);
check('posts: the author gets a bell notification for a like', (await likeN()) === 1);
await P3(`/posts/${staff2}/${pid}/like`, 'POST', {}); await P3(`/posts/${staff2}/${pid}/like`, 'POST', {});
check('posts: unlike then like again does not notify twice', (await likeN()) === 1 && (await P3('/posts/' + staff2)).d.posts[0].likes === 1);
check('posts: liking your own post works but never notifies you', (await SS(`/posts/${staff2}/${pid}/like`, 'POST', {})).d.liked === true && (await likeN()) === 1);
check('posts: unknown post / person is 404', (await P3(`/posts/${staff2}/p_nope/like`, 'POST', {})).status === 404 && (await P3(`/posts/${staff2}/p_nope/reply`, 'POST', { text: 'hi' })).status === 404 && (await P3('/posts/u_nope')).status === 404);
check('posts: blank replies are refused', (await P3(`/posts/${staff2}/${pid}/reply`, 'POST', { text: '  ' })).status === 400);
const rp = await P3(`/posts/${staff2}/${pid}/reply`, 'POST', { text: 'Nice one' });
check('posts: anyone who can see the profile can reply; the author is notified', rp.status === 201 && (await SS('/notifications')).d.items.some(n => n.type === 'post_reply' && n.pid === pid));
const withReply = (await SS('/posts/' + staff2)).d.posts[0];
check('posts: the reply shows its writer, and the post owner may delete it', withReply.replies.length === 1 && withReply.replies[0].text === 'Nice one' && withReply.replies[0].name === 'Poster Three' && withReply.replies[0].canDelete === true);
check("posts: a stranger cannot delete someone else's reply or post (403)", (await sup(`/posts/${staff2}/${pid}/reply/${rp.d.id}`, 'DELETE')).status === 403 && (await P3(`/posts/${staff2}/${pid}`, 'DELETE')).status === 403);
check('posts: the reply author can delete their own reply', (await P3(`/posts/${staff2}/${pid}/reply/${rp.d.id}`, 'DELETE')).status === 200 && (await SS('/posts/' + staff2)).d.posts[0].replies.length === 0);
await sleep(2100);
const long = await SS('/posts', 'POST', { text: 'x'.repeat(900) });
check('posts: text is cut to 500 characters', long.status === 201 && long.d.text.length === 500);
check('posts: newest first', (await P3('/posts/' + staff2)).d.posts.map(p => p.id).join() === [long.d.id, pid].join());
await SS('/profile-visibility', 'POST', { hidden: true });
check('posts: a hidden profile hides its posts, and blocks likes and replies', (await P3('/posts/' + staff2)).d.hidden === true && (await P3('/posts/' + staff2)).d.posts.length === 0 && (await P3(`/posts/${staff2}/${pid}/like`, 'POST', {})).status === 403 && (await P3(`/posts/${staff2}/${pid}/reply`, 'POST', { text: 'hi' })).status === 403);
check('posts: ...but Heads and the owner still see them', (await H2('/posts/' + staff2)).d.posts.length === 2 && (await SS('/posts/' + staff2)).d.posts.length === 2);
await SS('/profile-visibility', 'POST', { hidden: false });
check('posts: the owner can delete a post, and a Head can delete anyone\'s', (await SS(`/posts/${staff2}/${long.d.id}`, 'DELETE')).status === 200 && (await H2(`/posts/${staff2}/${pid}`, 'DELETE')).status === 200 && (await P3('/posts/' + staff2)).d.posts.length === 0);
check('posts: deleting an already-deleted post is 404', (await SS(`/posts/${staff2}/${pid}`, 'DELETE')).status === 404);
check('posts: deleting an account removes its profile', await (async () => {
  const P3id = (await N('/users')).d.users.find(x => x.username === 'poster3').id;
  await P3('/posts', 'POST', { text: 'bye' });
  return (await N('/users/' + P3id, 'DELETE')).status === 200 && (await SS('/posts/' + P3id)).status === 404;
})());

console.log('Admin: notes across servers');
{
  const r = await N('/admin/notes');
  check('admin notes: default admin gets every server + user + personal notes', r.status === 200 && r.d.servers[0].id === 'cepalco' && Array.isArray(r.d.users) && Array.isArray(r.d.tasks) && Array.isArray(r.d.shared) && r.d.users.every(u => Array.isArray(u.servers)));
  check('admin notes: other users are refused', (await SS('/admin/notes')).status === 403);
}
console.log('Servers');
{
  const d0 = (await N('/servers')).d.servers;
  check('servers: CEPALCO Server is listed first, default, created by the default admin', d0[0].id === 'cepalco' && d0[0].name === 'CEPALCO Server' && d0[0].isDefault && d0[0].createdBy === 'Administrator');
  const mk = await SS('/servers', 'POST', { name: 'Billing Crew' });
  const SID = mk.d.id, CODE = mk.d.code, q = '#sv=' + SID;
  check('servers: any user can create a server', mk.status === 201 && /^s_[a-f0-9]{8}$/.test(SID) && CODE.length === 8);
  check('servers: bad name is rejected', (await SS('/servers', 'POST', { name: 'x' })).status === 400);
  const me = (await SS('/me' + q)).d;
  check('servers: creator is Head of their server', me.user.role === 'admin' && me.server.name === 'Billing Crew' && me.user.overview === false);
  check('servers: non-members get 403 (the platform admin is the one exception, see below)', (await H2('/me' + q)).status === 403 && (await H2('/chat' + q)).status === 403 && (await N('/chat#sv=s_00000000')).status === 403);
  check('servers: invalid invite code is 404', (await N('/servers/join', 'POST', { code: 'ZZZZZZZZ' })).status === 404);
  check('servers: join by invite code makes you Staff', (await N('/servers/join', 'POST', { code: CODE.toLowerCase() })).status === 200 && (await N('/me' + q)).d.user.role === 'staff');
  check('servers: joining twice is refused', (await N('/servers/join', 'POST', { code: CODE })).status === 400);
  const ks = (await SS('/servers')).d.servers.find(x => x.id === SID).codes;
  check('servers: a server has 3 passkeys (Head / Supervisor / Staff), all different', ks.admin.length === 8 && ks.host.length === 8 && ks.staff === CODE && new Set([ks.admin, ks.host, ks.staff]).size === 3);
  check('servers: the Supervisor passkey makes you a Supervisor', (await H2('/servers/join', 'POST', { code: ks.host })).d.role === 'host' && (await H2('/me' + q)).d.user.role === 'host');
  const nid0 = (await N('/me' + q)).d.user.id;
  check('team: a Supervisor must create a (named) Section before picking Staff', (await H2('/team' + q, 'POST', { add: [nid0] })).status === 400 && (await H2('/sections' + q, 'POST', { name: '' })).status === 400);
  check('sections: a Supervisor names a Section = a new role with its own chatbox', (await H2('/sections' + q, 'POST', { name: 'Dispatch' })).status === 201 && (await N('/sections' + q, 'POST', { name: 'Nope' })).status === 403);
  const tm = (await H2('/team' + q)).d, nid = (await N('/me' + q)).d.user.id;
  check('team: a Supervisor can pick his Staff', tm.kind === 'staff' && tm.candidates.some(c => c.id === nid) && (await H2('/team' + q, 'POST', { add: [nid] })).status === 200 && (await H2('/team' + q)).d.candidates.find(c => c.id === nid).mine === true);
  check('team: a Head picks his Supervisors; Staff cannot have a team', (await SS('/team' + q, 'POST', { add: [(await H2('/me' + q)).d.user.id] })).status === 200 && (await SS('/team' + q)).d.candidates.some(c => c.mine) && (await N('/team' + q)).status === 403);
  check('sections: the Section role goes to the Supervisor and all his picked Staff', (await H2('/me' + q)).d.user.tagIds.includes('dispatch') && (await N('/me' + q)).d.user.tagIds.includes('dispatch') && (await N('/chat' + q)).d.channels.some(c => c.id === 'dispatch-chat'));
  check('sections: the Head who picked the Supervisor gets the role too', (await SS('/me' + q)).d.user.tagIds.includes('dispatch') && (await SS('/sections' + q)).d.sections.some(x => x.id === 'dispatch'));
  const dp = await SS('/departments' + q, 'POST', { name: 'Operations', sectionIds: ['dispatch', 'bogus'] });
  check('departments: a Head groups his Supervisors\' Sections (unknown ones ignored)', dp.status === 201 && (await SS('/sections' + q)).d.departments[0].sectionIds.join() === 'dispatch' && (await H2('/departments' + q, 'POST', { name: 'X' })).status === 403);
  check('departments: edit and delete', (await SS('/departments/operations' + q, 'PUT', { name: 'Ops', sectionIds: [] })).status === 200 && (await SS('/sections' + q)).d.departments[0].name === 'Ops' && (await SS('/departments/operations' + q, 'DELETE')).status === 200 && (await SS('/sections' + q)).d.departments.length === 0);
  const c1 = await SS('/call?ch=general' + q), c2 = await SS('/call?ch=general' + q), c3 = await SS('/call?ch=nope' + q);
  check('video: a channel gets a private, stable Jitsi room; unknown channel is 404', c1.status === 200 && /^https:\/\/meet\.jit\.si\/CrewCamp-[a-f0-9]{24}#/.test(c1.d.url) && c1.d.url === c2.d.url && c3.status === 404 && (await SS('/call?ch=general')).d.url.split('#')[0] !== c1.d.url.split('#')[0]);
  check('video: you can only call friends', (await SS('/call?dm=' + nid + q)).status === 403);
  check('team: removing works and takes the Section role away from that Staff', (await H2('/team' + q, 'POST', { remove: [nid] })).status === 200 && !(await H2('/team' + q)).d.candidates.find(c => c.id === nid).mine && !(await N('/me' + q)).d.user.tagIds.includes('dispatch'));
  check('servers: only a Head can renew a given passkey', (await SS('/servers/' + SID + '/invite', 'POST', { role: 'admin' })).d.code !== ks.admin && (await H2('/servers/' + SID + '/invite', 'POST', { role: 'admin' })).status === 403);
  check('servers: a server Staff cannot manage members', (await N('/users' + q, 'POST', { username: 'staff2' })).status === 403);
  check('servers: only the Head sees the invite code', (await SS('/servers')).d.servers.find(x => x.id === SID).code === CODE && (await N('/servers')).d.servers.find(x => x.id === SID).code === undefined);
  // friends, DMs and profiles are NOT bound to a server: head2 is a friend of staff2 but is not in this server
  await SS('/friends/request', 'POST', { userId: head2 }); await H2('/friends/accept', 'POST', { userId: staff2 });
  check('servers: friend outside the server is still a friend', (await SS('/friends' + q)).d.friends.some(f => f.id === head2));
  check('servers: can still view a friend\'s profile from another server (no server role leaked)', await (async () => { const r = await SS('/profile/' + head2 + q); return r.status === 200 && r.d.id === head2 && r.d.role === undefined && r.d.tagNames === undefined; })());
  check('servers: can still PM a friend who is not in the server', (await SS('/dm/send' + q, 'POST', { to: head2, text: 'hello from another server' })).status === 201);
  // roles + positions are per server
  check('servers: custom roles are per server', (await SS('/tags' + q, 'POST', { name: 'Billing' })).status === 201 && (await SS('/tags' + q)).d.tags.some(t => t.id === 'billing') && !(await N('/tags')).d.tags.some(t => t.id === 'billing'));
  const adminId = (await N('/me')).d.user.id;
  check('servers: Head gives a role + position to a member', (await SS('/users/' + adminId + q, 'PUT', { role: 'host', tagIds: ['billing'] })).status === 200 && (await N('/me' + q)).d.user.role === 'host' && (await N('/me' + q)).d.user.tagIds[0] === 'billing');
  check('servers: that does NOT change the CEPALCO position', (await N('/me')).d.user.role === 'admin');
  // chat isolation
  check('servers: chat message stays inside its server', (await SS('/chat/send' + q, 'POST', { ch: 'general', text: 'hello billing' })).status === 201
    && (await SS('/chat?ch=general' + q)).d.msgs.some(m => m.text === 'hello billing') && !((await SS('/chat?ch=general')).d.msgs || []).some(m => m.text === 'hello billing'));
  check('servers: role channel exists only for its holders', (await N('/chat' + q)).d.channels.some(c => c.id === 'billing-chat') && !(await SS('/chat' + q)).d.channels.some(c => c.id === 'billing-chat'));
  // shared tasks isolation
  check('servers: shared calendar is per server', (await SS('/shared' + q)).d.tasks.length === 0 && (await N('/shared')).status === 200);
  // add by username
  await N('/users', 'POST', { username: 'svguy', password: 'svguy-pass-1', name: 'Sv Guy', role: 'staff' });
  check('servers: Head adds an existing account by username', (await SS('/users' + q, 'POST', { username: 'svguy', role: 'staff' })).status === 200 && (await SS('/users' + q)).d.users.some(u => u.username === 'svguy'));
  check('servers: unknown username is 404', (await SS('/users' + q, 'POST', { username: 'nobody-here' })).status === 404);
  check('servers: backup is blocked inside a user server', (await SS('/backup' + q)).status === 403);
  check('servers: rename + new invite code', (await SS('/servers/' + SID, 'PUT', { name: 'Billing Team' })).status === 200 && (await SS('/servers/' + SID + '/invite', 'POST')).d.code !== CODE);
  check('servers: owner cannot leave, member can', (await SS('/servers/' + SID + '/leave', 'POST')).status === 400 && (await N('/servers/' + SID + '/leave', 'POST')).status === 200 && !(await N('/servers')).d.servers.some(x => x.id === SID));
  check('servers: Head removes a member', (await SS('/users/' + (await SS('/users' + q)).d.users.find(u => u.username === 'svguy').id + q, 'DELETE')).status === 200);
  check('servers: only the owner (or the platform admin) can delete the server', (await H2('/servers/' + SID, 'DELETE')).status === 403 && (await SS('/servers/' + SID, 'DELETE')).status === 200);
  check('servers: deleted server is gone', (await SS('/me' + q)).status === 403 && !(await SS('/servers')).d.servers.some(x => x.id === SID));
}

console.log('Platform admin (default admin)');
{
  const mk = await SS('/servers', 'POST', { name: 'Staff Own Server' }), SID = mk.d.id, q = '#sv=' + SID;
  const staff2Id = (await SS('/me')).d.user.id;
  check('admin: only the default admin sees the Admin entry', (await N('/servers')).d.superAdmin === true && (await SS('/servers')).d.superAdmin === false);
  check('admin: a normal user cannot use /admin routes', (await SS('/admin/servers')).status === 403 && (await SS('/admin/servers', 'POST', { name: 'Nope' })).status === 403);
  const all = (await N('/admin/servers')).d.servers, sv = all.find(x => x.id === SID);
  check('admin: lists CEPALCO first, then every user server with owner + members', all[0].id === 'cepalco' && all[0].isDefault && sv && sv.owner && sv.members.length === 1 && sv.members[0].role === 'admin' && sv.code.length === 8);
  check('admin: default admin is NOT a member but can enter any server as Head', !(await N('/servers')).d.servers.some(x => x.id === SID) && (await N('/me' + q)).d.user.role === 'admin' && (await N('/me' + q)).d.user.superAdmin === true);
  check('admin: he is not listed in that server\'s people', !(await N('/users' + q)).d.users.some(u => u.username === 'admin'));
  check('admin: can create roles, channels and members there', (await N('/tags' + q, 'POST', { name: 'Audit' })).status === 201 && (await N('/chat/channels' + q, 'POST', { name: 'ops' })).status === 201 && (await N('/users' + q, 'POST', { username: 'svguy', role: 'host' })).status === 200);
  check('admin: can change a member\'s position and remove them', await (async () => { const id = (await N('/users' + q)).d.users.find(u => u.username === 'svguy').id; return (await N('/users/' + id + q, 'PUT', { role: 'staff' })).status === 200 && (await N('/users/' + id + q, 'DELETE')).status === 200; })());
  check('admin: his CEPALCO position is untouched', (await N('/me')).d.user.role === 'admin' && (await N('/me')).d.user.overview === true);
  check('admin: can rename and re-code any server', (await N('/servers/' + SID, 'PUT', { name: 'Renamed By Admin' })).status === 200 && (await N('/servers/' + SID + '/invite', 'POST')).status === 200 && (await N('/admin/servers')).d.servers.find(x => x.id === SID).name === 'Renamed By Admin');
  const mk2 = await N('/admin/servers', 'POST', { name: 'Made By Admin', owner: 'staff2' });
  check('admin: can create a server for another user (they become Head + owner)', mk2.status === 201 && (await SS('/me#sv=' + mk2.d.id)).d.user.role === 'admin' && (await N('/admin/servers', 'POST', { name: 'X1', owner: 'nobody-here' })).status === 404);
  check('admin: can transfer ownership (orphan fix)', (await N('/admin/servers/' + mk2.d.id + '/owner', 'PUT', { userId: 'u_admin' })).status === 200 && (await N('/admin/servers')).d.servers.find(x => x.id === mk2.d.id).owner !== 'Unknown');
  check('admin: can delete any server (not only his own)', (await N('/servers/' + mk2.d.id, 'DELETE')).status === 200 && (await N('/servers/' + SID, 'DELETE')).status === 200 && !(await N('/admin/servers')).d.servers.some(x => x.id === SID || x.id === mk2.d.id));
  check('admin: another Head (not the default admin) still cannot enter or delete someone else\'s server', (await SS('/servers', 'POST', { name: 'Private' })).status === 201 && await (async () => { const o = (await SS('/servers')).d.servers.find(x => x.name === 'Private').id; return (await H2('/me#sv=' + o)).status === 403 && (await H2('/servers/' + o, 'DELETE')).status === 403; })());
  const ac = await N('/admin/accounts', 'POST', { username: 'glob1', name: 'Global One', password: 'secret123' });
  check('accounts: platform admin creates a global account (any server header)', ac.status === 200 && (await N('/admin/accounts')).d.accounts.some(u => u.username === 'glob1' && u.servers.includes('CEPALCO Server')));
  check('accounts: duplicate / weak password rejected', (await N('/admin/accounts', 'POST', { username: 'glob1', password: 'secret123' })).status === 400 && (await N('/admin/accounts', 'POST', { username: 'glob2', password: '123' })).status === 400);
  check('accounts: edit name, disable, delete', await (async () => { const id = (await N('/admin/accounts')).d.accounts.find(u => u.username === 'glob1').id; return (await N('/admin/accounts/' + id, 'PUT', { name: 'Renamed', active: false })).status === 200 && (await N('/admin/accounts')).d.accounts.find(u => u.id === id).active === false && (await N('/admin/accounts/' + id, 'DELETE')).status === 200 && !(await N('/admin/accounts')).d.accounts.some(u => u.id === id); })());
  check('accounts: non-platform-admin gets 403', (await SS('/admin/accounts')).status === 403 && (await SS('/admin/accounts', 'POST', { username: 'zz9', password: 'secret123' })).status === 403);
  const ic = await N('/servers/cepalco/invite', 'POST');
  check('cepalco code: Head creates it and sees it in the server list', ic.status === 200 && /^[A-Z2-9]{8}$/.test(ic.d.code) && (await N('/servers')).d.servers.find(v => v.id === 'cepalco').code === ic.d.code);
  check('cepalco code: non-Head cannot create or see it', (await SS('/servers/cepalco/invite', 'POST')).status === 403 && (await SS('/servers')).d.servers.find(v => v.id === 'cepalco').code === undefined);
  const NS = browser();
  check('cepalco code: wrong code rejected', (await NS('/signup', 'POST', { code: 'AAAAAAAA', username: 'newbie', password: 'secret123' })).status === 404);
  const su = await NS('/signup', 'POST', { code: ic.d.code, username: 'newbie', name: 'New Bie', password: 'secret123' });
  check('cepalco code: sign up with the code creates a Staff account and logs in', su.status === 201 && (await NS('/me')).d.user.role === 'staff' && (await N('/admin/accounts')).d.accounts.some(u => u.username === 'newbie'));
  check('cepalco code: duplicate username / weak password rejected', (await NS('/signup', 'POST', { code: ic.d.code, username: 'newbie', password: 'secret123' })).status === 400 && (await NS('/signup', 'POST', { code: ic.d.code, username: 'newbie2', password: '12' })).status === 400);
  check('cepalco code: turning it off blocks sign-up', (await N('/servers/cepalco/invite', 'DELETE')).status === 200 && (await NS('/signup', 'POST', { code: ic.d.code, username: 'late', password: 'secret123' })).status === 404);
  check('cepalco: Add member (existing account) sets position/role, unknown username is refused', await (async () => { const me = (await N('/admin/accounts')).d.accounts.find(u => u.username === 'newbie'); return (await N('/users', 'POST', { username: 'newbie', role: 'host' })).status === 200 && (await N('/users')).d.users.find(u => u.username === 'newbie').role === 'host' && (await N('/users', 'POST', { username: 'does-not-exist', role: 'staff' })).status === 404 && !!me; })());
  check('accounts: admin cannot delete himself', (await N('/admin/accounts/u_admin', 'DELETE')).status === 400);
}

console.log('New accounts belong to no server');
{
  await N('/users', 'POST', { username: 'fresh1', name: 'Fresh One', role: 'staff', password: 'fresh-pass-1' });
  const rec = mockData.get('users'); rec.v.find(u => u.username === 'fresh1').noDef = true;   // what Google sign-up does: account exists, no server yet
  const F = browser(); await F('/login', 'POST', { username: 'fresh1', password: 'fresh-pass-1' });
  const me0 = await F('/me');
  check('new account: no server yet (me says noServer, not CEPALCO)', me0.status === 200 && me0.d.user.noServer === true);
  check('new account: cannot enter CEPALCO by default', (await F('/chat')).status === 403 && (await F('/users')).status === 403 && !(await F('/servers')).d.servers.some(x => x.id === 'cepalco'));
  check('new account: is not listed as a CEPALCO member', !(await N('/users')).d.users.some(u => u.username === 'fresh1'));
  check('new account: wrong passkey is refused', (await F('/servers/join', 'POST', { code: 'ZZZZZZZZ' })).status === 404);
  const dk = (await N('/servers')).d.servers[0].codes;
  check('CEPALCO has 3 passkeys too (renewable per position)', (await N('/servers/cepalco/invite', 'POST', { role: 'host' })).status === 200 && (await N('/servers')).d.servers[0].codes.host.length === 8);
  const dk2 = (await N('/servers')).d.servers[0].codes;
  check('new account: the CEPALCO Supervisor passkey joins CEPALCO as Supervisor', (await F('/servers/join', 'POST', { code: dk2.host })).d.role === 'host' && (await F('/me')).d.user.role === 'host' && (await N('/users')).d.users.some(u => u.username === 'fresh1'));
}

console.log('Cross-server calendar');
{
  const mk = await SS('/servers', 'POST', { name: 'Cross Crew' }), SID = mk.d.id, q = '#sv=' + SID;
  await SS('/users' + q, 'POST', { username: 'svguy', role: 'staff' });   // svguy joins the user server (account made in the Servers block above)
  const G = browser(); await G('/login', 'POST', { username: 'svguy', password: 'svguy-pass-1' });
  const tk = (title, ids) => ({ title, description: '', priority: 'Now', date: '2026-03-05', assignees: ids });
  const svguy = (await N('/users')).d.users.find(u => u.username === 'svguy').id;
  const a = await SS('/shared' + q, 'POST', tk('Cross-server task', [svguy]));
  const b = await N('/shared', 'POST', tk('CEPALCO task for svguy', [svguy]));
  await SS('/users' + q, 'POST', { username: 'bill1', role: 'staff' });
  const bill = (await N('/users')).d.users.find(u => u.username === 'bill1').id;
  const other = await SS('/shared' + q, 'POST', tk('Not for svguy', [bill]));
  await G('/board', 'PUT', { tasks: [{ id: 'p1', title: 'My private note', date: '2026-03-06', priority: 'Next', status: 'active', color: '#fff3a1' }], rev: 0, theme: 'white' });
  check('cross: setup tasks created', a.status === 201 && b.status === 201 && other.status === 201);
  const c = await G('/cross');
  check('cross: lists CEPALCO + each server I belong to', c.status === 200 && c.d.servers.some(x => x.id === 'cepalco') && c.d.servers.some(x => x.id === SID));
  check('cross: includes tasks assigned to me from every server, tagged with the server', c.d.shared.some(t => t.title === 'Cross-server task' && t.serverId === SID && t.serverName === 'Cross Crew') && c.d.shared.some(t => t.title === 'CEPALCO task for svguy' && t.serverId === 'cepalco'));
  check('cross: does NOT include tasks assigned to someone else', !c.d.shared.some(t => t.title === 'Not for svguy'));
  check('cross: includes my personal notes, tagged with the server they live in', c.d.personal.some(t => t.title === 'My private note' && t.serverId === 'cepalco'));
  await G('/board' + q, 'PUT', { tasks: [{ id: 'p2', title: 'Note in Cross Crew', date: '2026-03-07', priority: 'Next', status: 'active', color: '#fff3a1' }], rev: 0, theme: 'white' });
  const c2 = (await G('/cross')).d;
  check('personal notes stay in their own server (CEPALCO board unchanged, server board separate)', c2.personal.some(t => t.title === 'Note in Cross Crew' && t.serverId === SID) && !c2.personal.some(t => t.title === 'My private note' && t.serverId === SID) && (await G('/me')).d.board.tasks.every(t => t.title !== 'Note in Cross Crew') && (await G('/me' + q)).d.board.tasks.map(t => t.title).join() === 'Note in Cross Crew');
  check('theme stays global across servers', (await G('/me' + q)).d.board.theme === 'white');
  check('cross: ignores the X-Server header (always all servers)', (await G('/cross#sv=' + SID)).d.shared.length === c.d.shared.length);
  const X = browser(); await X('/login', 'POST', { username: 'sup1', password: 'sup-pass-12' });
  const xc = (await X('/cross')).d;
  check('cross: servers/tasks of servers I am not in are not leaked', !xc.servers.some(s => s.id === SID) && !xc.shared.some(t => t.serverId === SID));
  check('cross: needs login', (await browser()('/cross')).status === 401);
  check('cross: marking my part done works from the cross view (X-Server of that task)', (await G('/shared/' + a.d.id + q, 'PUT', { done: true })).status === 200 && (await G('/cross')).d.shared.find(t => t.id === a.d.id).myDone === true);
}

console.log('Server logo');
{
  // tiny real WebP (1x1) + a fake PNG header
  const webp = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
  const mk = await SS('/servers', 'POST', { name: 'Logo Crew' }), SID = mk.d.id;
  const pubGet = async id => handler(new Request('https://x.test/api/server-logo/' + id));   // no cookie: it is a public image
  check('logo: none yet -> 404', (await pubGet(SID)).status === 404);
  check('logo: bad data is rejected', (await SS('/servers/' + SID + '/logo', 'POST', { image: 'data:image/webp;base64,AAAA' })).status === 400);
  check('logo: a non-Head cannot change it', (await V('/servers/join', 'POST', { code: mk.d.code })).status === 200 && (await V('/servers/' + SID + '/logo', 'POST', { image: webp })).status === 403);
  check('logo: oversize is rejected', (await SS('/servers/' + SID + '/logo', 'POST', { image: 'data:image/webp;base64,UklGR' + 'A'.repeat(40000) })).status === 413);
  const up = await SS('/servers/' + SID + '/logo', 'POST', { image: webp });
  check('logo: server Head can upload', up.status === 200 && up.d.logoAt > 0 && up.d.logoNext === up.d.logoAt + 15 * 864e5);
  const g = await pubGet(SID);
  check('logo: served publicly with long immutable cache', g.status === 200 && g.headers.get('content-type') === 'image/webp' && /immutable/.test(g.headers.get('cache-control')) && /max-age=31536000/.test(g.headers.get('cache-control')));
  check('logo: /servers exposes logoAt (the cache-busting version) to members', (await SS('/servers')).d.servers.find(x => x.id === SID).logoAt === up.d.logoAt && (await V('/servers')).d.servers.find(x => x.id === SID).logoAt === up.d.logoAt);
  check('logo: second change within 15 days is blocked (429)', (await SS('/servers/' + SID + '/logo', 'POST', { image: webp })).status === 429);
  const real = Date.now; Date.now = () => real() + 16 * 864e5;
  const again = await SS('/servers/' + SID + '/logo', 'POST', { image: webp }); Date.now = real;
  check('logo: allowed again after 15 days', again.status === 200);
  check('logo: CEPALCO logo is changeable by its Head only', (await SS('/servers/cepalco/logo', 'POST', { image: webp })).status === 403 && (await N('/servers/cepalco/logo', 'POST', { image: webp })).status === 200 && (await N('/servers')).d.servers[0].logoAt > 0 && (await pubGet('cepalco')).status === 200);
  check('logo: deleting the server removes its logo', (await SS('/servers/' + SID, 'DELETE')).status === 200 && (await pubGet(SID)).status === 404);
}

console.log('Notifications carry their server');
{
  const mk = await SS('/servers', 'POST', { name: 'Notif Crew' }), SID = mk.d.id, q = '#sv=' + SID;
  const G = browser(); await G('/login', 'POST', { username: 'svguy', password: 'svguy-pass-1' });
  const gid = (await N('/users')).d.users.find(u => u.username === 'svguy').id;
  await SS('/users' + q, 'POST', { username: 'svguy', role: 'staff' });
  await SS('/shared' + q, 'POST', { title: 'Server-tagged task', description: '', priority: 'Now', date: '2026-04-01', assignees: [gid] });
  await N('/shared', 'POST', { title: 'CEPALCO-tagged task', description: '', priority: 'Now', date: '2026-04-02', assignees: [gid] });
  const items = (await G('/notifications')).d.items;
  const a = items.find(n => n.title === 'Server-tagged task'), b = items.find(n => n.title === 'CEPALCO-tagged task');
  check('notif: task notification records which server it came from', a && a.sv === SID && a.svName === 'Notif Crew');
  check('notif: CEPALCO tasks are tagged with the default server', b && b.sv === 'cepalco' && b.svName === 'CEPALCO Server');
  await G('/friends/request', 'POST', { userId: staff2 });
  const fr = (await SS('/notifications')).d.items.find(n => n.type === 'friend_req' && n.by === gid);
  check('notif: friend requests are NOT tied to a server', fr && fr.sv === undefined && fr.svName === undefined);
}

console.log('Theme from the server menu');
{
  check('theme: POST /theme saves it to my profile board', (await SS('/theme', 'POST', { theme: 'ocean' })).status === 200 && (await SS('/me')).d.board.theme === 'ocean');
  const r0 = (await SS('/me')).d.board.rev; await SS('/theme', 'POST', { theme: 'forest' });
  check('theme: does not bump the board revision (no false 409 on other devices)', (await SS('/me')).d.board.rev === r0);
  check('theme: unknown theme is rejected', (await SS('/theme', 'POST', { theme: 'neon' })).status === 400);
  check('theme: needs login', (await browser()('/theme', 'POST', { theme: 'dark' })).status === 401);
}

console.log('Server rail: unread chat badges');
{
  const mk = await SS('/servers', 'POST', { name: 'Badge Crew' });
  const BID = mk.d.id, bq = '#sv=' + BID;
  await N('/servers/join', 'POST', { code: mk.d.code });
  check('unread: needs login', (await browser()('/servers/unread', 'POST', { seen: {} })).status === 401);
  await SS('/chat/send' + bq, 'POST', { ch: 'general', text: 'first in badge crew' });
  const r0 = (await N('/servers/unread', 'POST', { seen: {} })).d.servers;
  check('unread: every server I am in is listed (CEPALCO + the ones I joined), not others', !!r0.cepalco && !!r0[BID] && !(await H2('/servers/unread', 'POST', { seen: {} })).d.servers[BID]);
  check('unread: a server this browser never opened starts at 0 and hands back a baseline', r0[BID].unread === 0 && r0[BID].last.general > 0);
  const last = r0[BID].last.general;
  check('unread: messages after what I have read are counted', (await N('/servers/unread', 'POST', { seen: { [BID]: 'general:0' } })).d.servers[BID].unread === 1);
  check('unread: nothing is unread once I have read up to the latest', (await N('/servers/unread', 'POST', { seen: { [BID]: 'general:' + last } })).d.servers[BID].unread === 0);
  check('unread: my own messages never count', (await SS('/servers/unread', 'POST', { seen: { [BID]: 'general:0' } })).d.servers[BID].unread === 0);
  await SS('/chat/send' + bq, 'POST', { ch: 'general', text: 'second one' });
  check('unread: a new message raises it again', (await N('/servers/unread', 'POST', { seen: { [BID]: 'general:' + last } })).d.servers[BID].unread === 1);
  // role channels count only for people holding the role
  await SS('/tags' + bq, 'POST', { name: 'Secret' });
  await SS('/tags/secret' + bq, 'PUT', { userIds: [staff2] });
  check('unread: a role channel is invisible to people without the role', (await SS('/chat/send' + bq, 'POST', { ch: 'secret-chat', text: 'psst' })).status === 201
    && (await N('/servers/unread', 'POST', { seen: { [BID]: 'general:' + last + ',secret-chat:0' } })).d.servers[BID].unread === 1
    && (await N('/servers/unread', 'POST', { seen: {} })).d.servers[BID].last['secret-chat'] === undefined);
  await SS('/tags/secret' + bq, 'PUT', { userIds: [staff2, (await N('/me')).d.user.id] });
  check('unread: ...and counts once you hold the role (a channel I have never seen is all unread)', (await N('/servers/unread', 'POST', { seen: { [BID]: 'general:' + (await N('/servers/unread', 'POST', { seen: {} })).d.servers[BID].last.general } })).d.servers[BID].unread === 1);
  check('unread: different servers keep separate read marks for the same channel name', (await N('/servers/unread', 'POST', { seen: { cepalco: 'general:9999999999999', [BID]: 'general:0' } })).d.servers.cepalco.unread === 0);
  const cl = (await N('/servers/unread', 'POST', { seen: {} })).d.servers.cepalco.last.general;
  check('unread: CEPALCO counts other people\'s messages, with its own read marks', (await N('/servers/unread', 'POST', { seen: { cepalco: 'general:0' } })).d.servers.cepalco.unread > 0 && (await N('/servers/unread', 'POST', { seen: { cepalco: 'general:' + cl } })).d.servers.cepalco.unread === 0);
  check('unread: junk input is harmless', (await N('/servers/unread', 'POST', { seen: 'nonsense' })).status === 200 && (await N('/servers/unread', 'POST', { seen: [1, 2] })).status === 200 && (await N('/servers/unread', 'POST', {})).status === 200 && (await N('/servers/unread', 'POST', { seen: { [BID]: 'x:y,,:' } })).status === 200);
  check('unread: the count is capped at 99', await (async () => { for (let i = 0; i < 3; i++) await SS('/chat/send' + bq, 'POST', { ch: 'general', text: 'm' + i }); return (await N('/servers/unread', 'POST', { seen: { [BID]: 'general:0' } })).d.servers[BID].unread <= 99; })());
}

// ---- Google sign-in (Google's tokeninfo endpoint is mocked) ----
{
  const realFetch = globalThis.fetch; let tok = {};
  globalThis.fetch = async u => String(u).startsWith('https://oauth2.googleapis.com/tokeninfo') ? { ok: !!tok, json: async () => tok } : realFetch(u);
  const jwt = 'aaa.bbb.ccc', good = { aud: 'cid-123', iss: 'https://accounts.google.com', sub: 'g-1', exp: String(Math.floor(Date.now() / 1000) + 600), email: 'Jane.Doe@example.com', email_verified: 'true', name: 'Jane Doe' };
  const B = browser();
  delete process.env.GOOGLE_CLIENT_ID;
  check('google: /config reports no client ID when unset', (await B('/config')).d.googleClientId === '');
  check('google: refused (503) when GOOGLE_CLIENT_ID is not set', (await B('/google', 'POST', { credential: jwt })).status === 503);
  process.env.GOOGLE_CLIENT_ID = 'cid-123';
  check('google: /config exposes the client ID', (await B('/config')).d.googleClientId === 'cid-123');
  check('google: junk credential rejected', (await B('/google', 'POST', { credential: 'nope' })).status === 401);
  tok = { ...good, aud: 'someone-else' }; check('google: token for another app rejected', (await B('/google', 'POST', { credential: jwt })).status === 401);
  tok = { ...good, email_verified: 'false' }; check('google: unverified email rejected', (await B('/google', 'POST', { credential: jwt })).status === 401);
  tok = { ...good, exp: '1' }; check('google: expired token rejected', (await B('/google', 'POST', { credential: jwt })).status === 401);
  tok = null; check('google: token Google does not recognise is rejected', (await B('/google', 'POST', { credential: jwt })).status === 401);
  const SU = { mode: 'signup', firstName: 'Jane', lastName: 'D', username: 'jane_d', password: 'secret1' };
  tok = good;
  check('google: signing in before signing up does NOT create an account', (await B('/google', 'POST', { credential: jwt })).status === 404);
  check('google: sign-up needs a display name', (await B('/google', 'POST', { ...SU, firstName: ' ', credential: jwt })).status === 400);
  check('google: sign-up needs a valid username', (await B('/google', 'POST', { ...SU, username: 'a b', credential: jwt })).status === 400);
  check('google: sign-up needs a password of 6+ characters', (await B('/google', 'POST', { ...SU, password: '123', credential: jwt })).status === 400);
  check('google: nothing was created by the failed attempts', (await B('/google', 'POST', { credential: jwt })).status === 404);
  const r1 = await B('/google', 'POST', { ...SU, credential: jwt });
  check('google: sign-up creates a staff account with the chosen name + username, and a session', r1.status === 201 && r1.d.created && r1.d.user.role === 'staff' && r1.d.user.username === 'jane_d' && r1.d.user.name === 'Jane D' && (await B('/me')).status === 200);
  const B2 = browser(); const r2 = await B2('/google', 'POST', { credential: jwt });
  check('google: afterwards Log in with Google reaches the same account', r2.status === 200 && !r2.d.created && r2.d.user.id === r1.d.user.id);
  check('google: signing up again with the same Google account is refused (409)', (await browser()('/google', 'POST', { ...SU, username: 'other_name', credential: jwt })).status === 409);
  const rp = await browser()('/login', 'POST', { username: 'jane_d', password: 'secret1' });
  check('google: the password they chose also works on the normal Log in form', rp.status === 200 && rp.d.user.id === r1.d.user.id);
  tok = { ...good, sub: 'g-2', email: 'someone.else@other.com' };
  check('google: a username that is already taken is refused', (await browser()('/google', 'POST', { ...SU, credential: jwt })).status === 400);
  const r3 = await browser()('/google', 'POST', { ...SU, username: 'jane_d2', firstName: 'Other', lastName: 'Jane', credential: jwt });
  check('google: a second person signs up with their own details', r3.status === 201 && r3.d.user.username === 'jane_d2' && r3.d.user.name === 'Other Jane');
  process.env.GOOGLE_ALLOWED_DOMAINS = 'example.com'; tok = { ...good, sub: 'g-3', email: 'x@evil.com' };
  check('google: GOOGLE_ALLOWED_DOMAINS blocks other domains', (await browser()('/google', 'POST', { ...SU, username: 'evil_x', credential: jwt })).status === 403);
  delete process.env.GOOGLE_ALLOWED_DOMAINS; delete process.env.GOOGLE_CLIENT_ID; globalThis.fetch = realFetch;
}

console.log('Ongoing call notice');
{
  const real = Date.now, t0 = real();
  const ch = async (B, qs = '') => (await B('/chat' + (qs ? '?' + qs : ''))).d;
  const gen = d => d.channels.find(c => c.id === 'general');
  check('call: no call, no notice', gen(await ch(SS)).call === null && gen(await ch(N)).call === null);
  const a = gen(await ch(SS, `call=ch:general&cs=${t0 - 60000}`));
  check('call: the person who starts it is counted (1 in call, started when they clicked, "me")', a.call && a.call.n === 1 && a.call.me === true && a.call.since === t0 - 60000);
  const b = gen(await ch(N));
  check('call: everyone else sees it on their next poll (not "me")', b.call && b.call.n === 1 && b.call.me === false && b.call.since === t0 - 60000);
  const c = gen(await ch(N, `call=ch:general&cs=${t0 - 5000}`));
  check('call: a second person joining makes 2; the start time stays the first person\'s', c.call.n === 2 && c.call.me === true && c.call.since === t0 - 60000);
  const keepN = `call=ch:general&cs=${t0 - 5000}`;   // a browser that is still in the call keeps sending it on every poll
  check('call: a channel nobody called in has no notice (same server)', (await ch(N, keepN)).channels.filter(x => x.id !== 'general').every(x => x.call === null));
  check('call: junk is ignored (unknown channel, bad scope)', gen(await ch(H2, 'call=ch:nope&cs=1')).call.n === 2 && gen(await ch(H2, 'call=zzz')).call.n === 2);
  check('call: a start time in the future is replaced by "now" and never moves the real start', gen(await ch(H2, `call=ch:general&cs=${t0 + 9e9}`)).call.since === t0 - 60000);
  await ch(H2);   // H2 leaves again
  Date.now = () => real() + 100000;
  const late = gen(await ch(N));   // 100 s later nobody has refreshed: the call is over
  Date.now = real;
  check('call: it ends by itself once nobody has refreshed for ~90 s', late.call === null);
  gen(await ch(SS, 'call=ch:general'));
  check('call: a call started now shows up with a start of "now"', Math.abs(gen(await ch(N)).call.since - real()) < 5000 && gen(await ch(N)).call.n === 1);
  await ch(SS);   // SS stops sending it = left the call
  check('call: leaving (the browser stops sending it) removes you at once', gen(await ch(N)).call === null);
  // private calls: only the two friends
  await SS('/friends/request', 'POST', { userId: head2 }); await H2('/friends/accept', 'POST', { userId: staff2 });
  const dmOf = (d, id) => d.friends.find(f => f.id === id);
  const d1 = dmOf(await ch(SS, `call=dm:${head2}&cs=${t0 - 30000}`), head2);
  check('call: a private call counts me and shows on that friend', d1.call && d1.call.n === 1 && d1.call.me === true && d1.call.since === t0 - 30000);
  const d2 = dmOf(await ch(H2), staff2);
  check('call: the friend sees it on the conversation with me', d2.call && d2.call.n === 1 && d2.call.me === false && d2.call.since === t0 - 30000);
  check('call: it does not appear in the group channels', gen(await ch(N)).call === null && gen(await ch(H2)).call === null);
  check('call: a non-friend cannot be "called" (ignored)', (await ch(SS, `call=dm:${(await N('/me')).d.user.id}`)).friends.every(f => f.call === null));
  await ch(SS);
}

console.log('File attachments (15-minute files in group chat + private messages)');
{
  const png = Buffer.from(PNG.split(',')[1], 'base64');
  const cookieOf = async B => (await B('/me')).cookie;
  // raw call like the browser does for uploads / downloads: bytes in, bytes out
  const rawCall = async (B, p, method = 'GET', bytes, extra = {}) => {
    const ck = await cookieOf(B);
    const res = await handler(new Request('https://x.test/api' + p, { method, headers: { ...(bytes ? { 'Content-Type': 'application/octet-stream' } : {}), ...(ck ? { cookie: ck } : {}), ...extra }, body: bytes }));
    const buf = Buffer.from(await res.arrayBuffer()); let d = {}; try { d = JSON.parse(buf.toString()); } catch {}
    return { status: res.status, buf, d, h: res.headers };
  };
  const up = (B, qs, bytes) => rawCall(B, '/attach?' + qs, 'POST', bytes);
  check('attach: needs login', (await rawCall(browser(), '/attach?ch=general&name=a.png', 'POST', png)).status === 401 && (await rawCall(browser(), '/attach/1700000000000_0123456789abcdef')).status === 401);

  const g = await up(SS, 'ch=general&name=pic.png&text=look%20at%20this', png);
  check('attach: a picture is shared in the group chat (201) with its caption', g.status === 201 && g.d.text === 'look at this' && g.d.att && g.d.att.img === true && g.d.att.type === 'image/png' && g.d.att.size === png.length && g.d.att.name === 'pic.png');
  check('attach: it lives exactly 15 minutes', Math.abs(g.d.att.exp - (real() + 15 * 60e3)) < 5000 && g.d.att.gone === false);
  const seenMsg = (await SS('/chat?ch=general&rev=-1')).d.msgs.find(x => x.id === g.d.id);
  check('attach: the next poll carries only light metadata, never the file bytes', seenMsg && seenMsg.att.id === g.d.att.id && !JSON.stringify(seenMsg).includes('b64') && JSON.stringify(seenMsg.att).length < 220);
  const dl = await rawCall(N, '/attach/' + g.d.att.id);
  check('attach: another member downloads the same bytes; pictures show inline, locked down', dl.status === 200 && dl.buf.equals(png) && dl.h.get('content-type') === 'image/png' && /^inline/.test(dl.h.get('content-disposition')) && /sandbox/.test(dl.h.get('content-security-policy')) && dl.h.get('x-content-type-options') === 'nosniff');
  check('attach: the browser may keep it only until it expires', /private, max-age=(8\d\d|900)$/.test(dl.h.get('cache-control')));

  // other file types: always a download, never rendered by the browser
  const txt = await up(SS, 'ch=general&name=notes.txt', Buffer.from('hello team'));
  const txtDl = await rawCall(H2, '/attach/' + txt.d.att.id);
  check('attach: a plain file is shared (no caption needed) and always downloads', txt.status === 201 && txt.d.text === '' && txt.d.att.img === false && txtDl.status === 200 && txtDl.h.get('content-type') === 'application/octet-stream' && /^attachment/.test(txtDl.h.get('content-disposition')) && txtDl.buf.toString() === 'hello team');
  const liar = await up(SS, 'ch=general&name=fake.png', Buffer.from('<script>alert(1)</script>'));
  check('attach: a file only counts as a picture if its bytes say so (name is ignored)', liar.status === 201 && liar.d.att.img === false && liar.d.att.type === 'application/octet-stream');

  // rules
  check('attach: web pages / scripts / programs are refused', (await up(SS, 'ch=general&name=evil.html', Buffer.from('x'))).status === 415 && (await up(SS, 'ch=general&name=a.EXE', Buffer.from('x'))).status === 415 && (await up(SS, 'ch=general&name=p.svg', Buffer.from('x'))).status === 415);
  check('attach: empty and over-1 MB files are refused (413)', (await up(SS, 'ch=general&name=e.txt', Buffer.alloc(0))).status === 400 && (await up(SS, 'ch=general&name=big.bin', Buffer.alloc(1024 * 1024 + 1))).status === 413);
  check('attach: exactly 1 MB is fine', (await up(N, 'ch=general&name=max.bin', Buffer.alloc(1024 * 1024, 7))).status === 201);
  check('attach: unknown channel / no target refused', (await up(SS, 'ch=nope&name=a.txt', Buffer.from('x'))).status === 404 && (await up(SS, 'name=a.txt', Buffer.from('x'))).status === 404);
  check('attach: path tricks in the name are stripped', (await up(SS, 'ch=general&name=' + encodeURIComponent('../../etc/pass"wd.txt'), Buffer.from('x'))).d.att.name === 'passwd.txt');

  // private messages: only the two friends
  const dm = await up(SS, 'to=' + head2 + '&name=secret.pdf', Buffer.from('%PDF-1.4 hi'));
  check('attach: a file is sent privately to a friend', dm.status === 201 && dm.d.att && dm.d.att.name === 'secret.pdf' && dm.d.mine === true);
  check('attach: the friend can open it', (await rawCall(H2, '/attach/' + dm.d.att.id)).status === 200 && (await H2('/chat?dm=' + staff2 + '&drev=' + staff2 + ':-1')).d.dms[staff2].msgs.some(x => x.att && x.att.id === dm.d.att.id));
  check('attach: nobody else can open it (not a Head, not another member)', (await rawCall(N, '/attach/' + dm.d.att.id)).status === 403 && (await rawCall(sup, '/attach/' + dm.d.att.id)).status === 403);
  check('attach: the conversation list previews a file-only message', (await H2('/chat')).d.friends.find(f => f.id === staff2).prev === '📎 secret.pdf');
  check('attach: a non-friend cannot be sent a file', (await up(sup, 'to=' + staff2 + '&name=a.txt', Buffer.from('x'))).status === 403 && (await up(SS, 'to=' + supId + '&name=a.txt', Buffer.from('x'))).status === 403);

  // messages: editing keeps the file, deleting removes it
  const ed = await SS('/chat/msg/' + g.d.id + '?ch=general', 'PUT', { text: 'edited caption' });
  check('attach: editing the caption keeps the file', ed.status === 200 && ed.d.att && ed.d.att.id === g.d.att.id);
  check('attach: a file message cannot lose its text AND file; plain messages still need text', (await SS('/chat/msg/' + g.d.id + '?ch=general', 'PUT', { text: '' })).status === 200 && (await SS('/chat/send', 'POST', { ch: 'general', text: ' ' })).status === 400);
  const del = await SS('/chat/msg/' + txt.d.id + '?ch=general', 'DELETE');
  check('attach: deleting the message deletes the file', del.status === 200 && !mockData.has('att:' + txt.d.att.id) && (await rawCall(H2, '/attach/' + txt.d.att.id)).status === 410);
  const ddel = await SS('/dm/msg/' + dm.d.id + '?with=' + head2, 'DELETE');
  check('attach: same for private messages', ddel.status === 200 && !mockData.has('att:' + dm.d.att.id));

  // 15 minutes later
  const keep = await up(SS, 'ch=general&name=late.txt', Buffer.from('later')), fresh14 = keep.d.att.id;
  Date.now = () => real() + 14 * 60e3;
  const still = await rawCall(H2, '/attach/' + fresh14);
  Date.now = () => real() + 15 * 60e3 + 2000;
  const stale = await rawCall(H2, '/attach/' + fresh14), polled = (await SS('/chat?ch=general&rev=-1')).d.msgs.find(x => x.id === keep.d.id);
  Date.now = real;
  check('attach: still there at 14 minutes', still.status === 200);
  check('attach: gone after 15 minutes: refused (410), flagged expired in the chat, and deleted from storage', stale.status === 410 && polled.att.gone === true && !mockData.has('att:' + fresh14));

  // the scheduled sweep clears files nobody asked for again, reading nothing
  const old = await up(N, 'ch=general&name=old.txt', Buffer.from('x')), live = await up(N, 'ch=general&name=live.txt', Buffer.from('y'));
  Date.now = () => real() + 16 * 60e3; await sweep.default(); Date.now = real;
  check('attach: the scheduled sweep removes every expired file and nothing else', ![...mockData.keys()].some(k => k.startsWith('att:') && Number(k.slice(4, 17)) <= real() + 16 * 60e3) && !mockData.has('att:' + old.d.att.id) && !mockData.has('att:' + live.d.att.id));
  check('attach: the sweep is scheduled every 15 minutes', /schedule: '\*\/15 \* \* \* \*'/.test(fs.readFileSync(path.join(here, '../netlify/functions/sweep.mjs'), 'utf8')));
  const live2 = await up(N, 'ch=general&name=live2.txt', Buffer.from('z'));
  await sweep.default();
  check('attach: a file that has not expired survives the sweep', mockData.has('att:' + live2.d.att.id));

  // quota: keeps storage and function usage small
  const Q = N;
  mockData.delete('attq:u_admin');
  let ok6 = 0; for (let i = 0; i < 6; i++) ok6 += (await up(Q, 'ch=general&name=q' + i + '.txt', Buffer.from('q'))).status === 201 ? 1 : 0;
  check('attach: one person can share 6 files per 15 minutes, then gets a friendly 429', ok6 === 6 && (await up(Q, 'ch=general&name=q7.txt', Buffer.from('q'))).status === 429);
  Date.now = () => real() + 16 * 60e3; const after = await up(Q, 'ch=general&name=q8.txt', Buffer.from('q')); Date.now = real;
  check('attach: the allowance comes back once the old files have expired', after.status === 201);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
