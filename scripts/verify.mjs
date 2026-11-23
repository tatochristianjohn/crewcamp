// Post-deploy smoke check:  node scripts/verify.mjs https://<your-site>.netlify.app
// Confirms the pages, the API function and the attachment routes are live (no login needed, nothing is created).
const base = (process.argv[2] || process.env.SITE_URL || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.error('Usage: node scripts/verify.mjs https://<your-site>.netlify.app'); process.exit(2); }
let bad = 0;
const check = (name, ok, extra = '') => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  ' + extra)); if (!ok) bad++; };
const get = async (p, o) => { try { const r = await fetch(base + p, { redirect: 'manual', ...o }); return { r, t: await r.text() }; } catch (e) { return { r: { status: 0, headers: new Headers() }, t: String(e) }; } };

let x = await get('/login.html');
check('login page is served', x.r.status === 200 && /<form|<input/i.test(x.t), 'HTTP ' + x.r.status);
x = await get('/api/config');
let j = {}; try { j = JSON.parse(x.t); } catch { /* not JSON */ }
check('API function is live (/api/config returns JSON)', x.r.status === 200 && 'googleClientId' in j, 'HTTP ' + x.r.status + ' ' + x.t.slice(0, 80));
x = await get('/api/me');
check('API refuses a logged-out visitor (401)', x.r.status === 401, 'HTTP ' + x.r.status);
x = await get('/api/attach/1700000000000_0123456789abcdef');
check('attachment download route is live and protected (401, not a 404 page)', x.r.status === 401 && /Not logged in/.test(x.t), 'HTTP ' + x.r.status);
x = await get('/api/attach?ch=general&name=a.txt', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'x' });
check('attachment upload route is live and protected (401)', x.r.status === 401, 'HTTP ' + x.r.status);
x = await get('/chat.js');
check('chat script includes the attachment feature', x.r.status === 200 && x.t.includes('/api/attach'), 'HTTP ' + x.r.status);
console.log(bad ? `\n${bad} check(s) FAILED` : '\nLive site looks good');
process.exit(bad ? 1 : 0);
