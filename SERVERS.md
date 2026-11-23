# CrewCamp v2.7 — Servers (Discord-style) · handoff notes

## Model
- **Server = namespace** for: custom roles (tags, e.g. COLLECTION/BILLING → private `<role>-chat`), chat channels+messages, shared-calendar tasks, and **positions** (admin=Head / host=Supervisor / staff).
- **CEPALCO Server** (`id:'cepalco'`) = the default server, created by default admin `u_admin`. It uses the ORIGINAL un-prefixed keys and the global `users[].role/hostIds/tagIds` → **no data migration**. Everyone with an account is in it.
- **User servers** (`id:'s_<8hex>'`): any user can create (max 5 owned, 100 members). Creator = Head + owner. Data keys prefixed `sv:<id>:` (`shared`, `tags`, `chat:*`).
- Still **global**: accounts/passwords, personal boards, friends, DMs, profiles/posts, notifications, avatars, sessions, presence.

## Storage
- `servers` = `[{id,name,ownerId,created,code,members:{<uid>:{role,hostIds,tagIds}}}]` (CEPALCO is implicit, not stored).
- `svKey(id,k)` maps `^(shared|tags|chat:)` → `sv:<id>:<k>` (non-default only).

## API (`netlify/functions/api.mjs`)
- Active server = request header **`X-Server`** (absent/`cepalco` = default). Non-member → 403 `You are not a member of that server.` (front end then resets to CEPALCO).
- `scoped(bs, ()=>SV)` wraps the blob store per request, so ALL existing chat/shared/tags routes work unchanged per server.
- After auth: `allUs` = all accounts; `us` = members of active server with `role/hostIds/tagIds` overlaid from membership; `me` = overlay of caller; `nameUs` = `us` + others (names of ex-members). Friends/DM routes use `allUs`.
- New routes (global, ignore X-Server):
  `GET /servers` · `POST /servers {name}` · `POST /servers/join {code}` · `PUT /servers/<id> {name}` (Head) · `POST /servers/<id>/invite` (new code, Head) · `POST /servers/<id>/leave` · `DELETE /servers/<id>` (owner only; wipes scoped keys).
- Inside a user server the admin-gated routes behave as: `POST /users {username,role,hostIds,tagIds}` = add EXISTING account; `PUT /users/<id>` = change position/roles; `DELETE /users/<id>` = remove member; `PUT/DELETE /tags/<id>` edit membership; `/backup` → 403; `/personal-all` + overview = CEPALCO only. `/me` returns `server:{id,name}`.
- Typing indicator stores `sv` in presence so it doesn't leak across servers. Deleting an account removes it from all servers.

## Front end
- `public/auth.js`: `api()` adds `X-Server` from `localStorage.stb_sv`; 403 "not a member" → clears it + reload.
- `public/servers.js` (new, loaded by index/users/overview): left rail (64px icons → 244px on hover, ☰ tab on phones), ＋ Add (create / join by code), ⓘ Server info (creator, members, invite code, rename, leave, delete, link to Users page). Switching = set `stb_sv` + reload. On `users.html` in a user server it hides name/password/active inputs and relabels the form "Add member (existing account)".

## Known limits / ideas
- Only the CEPALCO admin creates accounts; others join via invite code or username add.
- Server "Active" toggle/password fields on Users page are ignored in user servers.
- Server Heads can view hidden profiles of their members (same rule as CEPALCO Heads).
- Not done: server icons/uploads, per-server backups, transfer ownership, bans.

## Tests
`npm test` → all original checks + new server checks (isolation of chat/roles/tasks, join/leave/delete, permissions).

## Platform admin (v2.7)
The default admin (`u_admin`) stays Head of **CEPALCO Server** exactly as before, and is now also the platform admin.
- Left rail → **🛡 Admin** (default admin only) → `admin-servers.html`: every server with owner, created date, invite code, people + positions + roles, channels, task count.
- Actions per server: **Open** (enter it as Head), **Manage people & roles** (Users page of that server), rename, new invite code, **make owner** (transfer), **delete**; plus **Create a server** for any user (they become Head + owner). This also rescues servers whose owner account was deleted.
- API (default admin only, else 403): `GET /admin/servers` · `POST /admin/servers {name, owner?}` · `PUT /admin/servers/<id>/owner {userId}`. `/servers` returns `superAdmin`, `/me` returns `user.superAdmin`.
- `X-Server` for the default admin may be ANY server without being a member: he acts as Head there (all existing chat/calendar/roles/users routes work) and is not listed as a member. Rename / new code / delete of any server also allowed for him. Everyone else is unchanged (members only; delete = owner only).
- Role channels (`<role>-chat`) are private to holders; the platform admin sees them only if he adds himself to the server and takes the role.
- Still open: deleting an account does not clean its tasks in user servers (shows "Deleted user").

## Cross-server Calendar (default landing page)
- `public/cross.html` – month calendar + "coming up" list of **my personal notes + every task assigned to me in every server I belong to** (CEPALCO included). Filter chips per source; colored edge = server. A day opens a list with **Mark my part done** (acts in that task's server) and **Open in <server>**.
- Rail item **🗓 Cross-server Calendar** (top of the server list, `servers.js`). Clicking a server from this page opens that server on the normal calendar (`index.html`).
- API `GET /api/cross` (global, ignores `X-Server`) → `{servers, personal, shared:[{…taskDTO, serverId, serverName}]}`; only tasks where the caller is an assignee and status is active.
- Default page: login → `cross.html`; an already signed-in visit to `login.html` → `cross.html`; `/` is rewritten to `cross.html` (`netlify.toml`).
- **No peek before login**: `auth.js` hides every page except `login.html` (`#authGate`) until `/api/me` confirms the session; no session → straight to `login.html`.

## Server logo (v2.9)
- Server Heads (and the platform admin) set it in the rail → ⓘ Server info → **Server logo**. One change per **15 days**, enforced by the API (429). First upload is free. CEPALCO's logo can be changed by its Head too.
- Cheap on Netlify: the browser shrinks the picture to a 96×96 WebP (≈2–6 KB, hard cap 24 KB) before upload; `GET /api/server-logo/<id>?v=<logoAt>` is public (no session/user reads, one tiny blob read) and sent with `Cache-Control: public, max-age=31536000, immutable` + `Netlify-CDN-Cache-Control … durable`, so each logo is fetched once per change. `logoAt` rides along in the `/servers` list that is already loaded (no extra requests); CEPALCO uses one small `svmeta:cepalco` blob.
- API: `POST /servers/<id|cepalco>/logo {image: dataURL}` → `{logoAt, logoNext}`. Logo blob key `svlogo:<id>`; deleted with the server.

## Notifications live in the server menu (v2.10)
- The 🔔 button moved from the page header into the server rail (`servers.js`, so it works on every page, with an unread badge). The panel opens next to the rail (bottom sheet on phones).
- Task notifications (`assigned`, `done`, `all_done`, `closed`) carry `sv` + `svName` and show **(Server name)** after the text (current name from the server list, falling back to the saved one). Friend requests/accepts, post likes and thread replies are global and show **no** server label.
- Clicking: task → switches to that server's Shared calendar and opens the task's date (`sessionStorage.stb_open`); friend → Friends panel; post → your profile.

## Menu order + Theme (v2.11)
- Server menu top → bottom: 🔔 Notifications · Servers header · 🗓 Cross-server Calendar · servers · ＋ Add · Friends · 🎨 **Theme** · (Admin) · ⓘ Server info · profile · log out.
- The Theme picker moved from the calendar header into the menu (`servers.js`, all pages). Index page saves via its board (`window.__cwSetTheme`); other pages call `POST /api/theme {theme}` (no board-revision bump).

## Efficiency pass (v2.12)
- One `/api/me` per page load (the gate's answer is shared with every script for 5 s); server list cached 20 s per tab (cleared on server changes, login, logout); notifications poll every 90 s and the cross calendar every 120 s, only while the tab is visible.

## Unread badges on server icons
`POST /api/servers/unread` (global) returns unread chat counts for every server I am in; `servers.js` shows them as red badges on the rail icons (polls every 60 s while visible; the open server is updated live by chat.js via the `cw:unread` event). Read marks are per server: `cw_seen` (CEPALCO) / `cw_seen_<id>`.

## Accounts moved to Admin settings (global)
- Account CRUD (add / edit name, active, temp password / delete) and Backup export/import now live in `admin-accounts.html` (Admin → 👥 Accounts & backup), platform admin only, **not tied to any server**. Table shows each account's servers.
- API (platform admin only): `GET/POST /admin/accounts` · `PUT/DELETE /admin/accounts/<id>`. Old `POST /users`, `DELETE /users/<id>`, `/backup` on CEPALCO now return 403 for non-platform-admins.
- CEPALCO's Manage Users page keeps positions, supervisors and custom roles only (no create/delete/backup).

## CEPALCO invite code (v2.13.1)
- Stored in `svmeta:cepalco` (`code`). `POST /servers/cepalco/invite` = create/renew, `DELETE` = turn off (Head or platform admin). `/servers` returns `code` for Heads only.
- Public `POST /signup {code, username, name, password}` creates a Staff account (password chosen by the person) and logs them in. 5 wrong codes per IP → 15 min lock.
