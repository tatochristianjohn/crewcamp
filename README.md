# CrewCamp

One app, two calendars:

| | 👤 **Personal** | 👥 **Shared** |
|---|---|---|
| Who sees it | Only you | You + the people involved |
| What it is | Your own sticky-note board per date | Tasks a supervisor/head **assigns** to staff |
| Who can add | Everyone | Supervisors and the Head only |

Switch with the two big buttons under the header (or press **P** / **S**). Your last choice is remembered.

## Roles
- **Head (admin)** – assigns tasks to Supervisors and Staff (never to themselves or any other Head, including the default `admin`), manages users, links staff to supervisors, exports/imports backups.
- **Supervisor (host)** – assigns tasks to *their own* staff, edits/closes/trashes them, sees progress per person.
- **Staff** – sees tasks assigned to them, taps **✔ Mark done** for their part. A staff member can report to several supervisors.

A task assigned to several people is complete when **everyone** has marked their part done (shown as `1/3 done`); a supervisor can also **Close** it for everyone.

## Features
Group chat dock (bottom-right) · Philippine holiday calendar · date boards with drag & drop (Now / Next / Later, Complete, Trash) · "coming up" list · filter shared tasks by person · 4 themes · password change · login lockout (5 tries → 15 min) · admin user manager · full backup/restore.

## Deploy (GitHub → Netlify)
1. Push this folder to a GitHub repo.
2. Netlify → **Add new site → Import from Git**. Settings come from `netlify.toml` (no build command, publish dir `public`).
3. Add the environment variable **`ADMIN_INITIAL_PASSWORD`** (8+ chars) under *Site configuration → Environment variables*, then deploy.
4. Open the site, log in as `admin` with that password.
5. **Users** page → add Supervisors, then Staff (tick who they report to). New/reset passwords are temporary; people must choose their own at first login.

> Must deploy from Git or the Netlify CLI (not drag-and-drop) so the function's dependency installs.

## Local dev
```
npm install
npm i -g netlify-cli
echo ADMIN_INITIAL_PASSWORD=choose-one-123 > .env
netlify dev
```

## Tests
```
npm test
```
Runs 223 checks against the real API with an in-memory stand-in for Netlify Blobs (no network, no extra dependencies).
See `IMPROVEMENTS.md` for the review, the logout fix, and earlier fixes (see `CHANGES.md` for v2.6).

## Custom roles & private role chats
Besides Head / Supervisor / Staff, a Head can create any number of **custom roles** (e.g. `DSD`) on the **Users** page and give them to as many people as they like.
- **Create:** Users → *Custom roles* → type a name → **Create role**. Up to 20 roles.
- **Give it to people:** tick it in a user's *Add / Edit* form, or click **👥 Members** on the role to tick many people at once.
- **Chat:** every role gets a private channel named `<role>-chat` (e.g. `🔒 # dsd-chat`). Only people holding the role can see it, read it, post in it, or see its unread badge. Removing someone from the role removes the channel from them on their next refresh.
- **Heads are not added automatically.** A Head who isn't tagged can't see a role channel (tag yourself to join). Heads can't delete a role channel directly; **deleting the role** deletes its channel and messages.
- Role channels don't count toward the 6-channel limit. Inside a role channel the *Online now* list shows only that role's members.
- Backups (v5) include the roles and who holds them; chat messages are still not part of a backup. Older backups restore fine (current roles are kept).
- Storage: `tags` = `[{id,name}]`, `users[].tagIds`, and role channels are entries in `chat:channels` with a `tag` field. API: `GET/POST /api/tags`, `PUT /api/tags/<id>` (`{userIds}`), `DELETE /api/tags/<id>`; `tagIds` is accepted by `POST/PUT /api/users`.

## Group chat
A small 💬 **Group chat** pill sits in the bottom-right corner of every page (like the Facebook chat dock). Click it to open the chat, or drag it anywhere you like (position is remembered).
- **Drag the chat window** by its header and the **Online now** list pops out beside it (Discord-style member list, grouped Heads / Supervisors / Staff, with a typing indicator). On touch screens use the 👥 button. Double-click the header to snap the window back to the corner.
- **Channels** (`# general` always exists). Heads can add or remove channels (＋ / 🗑); up to 6.
- Everyone can **edit** their own messages and **delete** their own; Heads can delete anyone's. Links are clickable, messages are plain text (no HTML), 1000 characters max, last 300 kept per channel.
- Unread badges per channel and on the pill. Works with all four themes; on phones it becomes a bottom sheet.
- **How it updates:** Netlify has no websockets, so the browser polls `GET /api/chat` (every 5 s while the chat is open, 30 s while minimized, 60 s in a background tab; change `POLL` at the top of `public/chat.js`). Each poll is one function call, so a busy team uses noticeably more Netlify function calls than before. "Online" means polled in the last 75 s.
- Storage (same `taskboard` blob store): `chat:channels`, `chat:<channel>`, `pres:<userId>`. Chat is not part of the Users-page backup/restore.
- Files: `public/chat.js`, `public/chat.css`, chat routes in `api.mjs`, plus `GET /api/avatar/<id>` so teammates' profile pictures show in the chat.

## Friends & private messages
Works like Facebook: send a friend request, and once it is accepted the two of you can message each other privately.
- **Add a friend:** click anyone's name or photo (group chat, Online list) to open their profile and press **➕ Add friend**, or open **✉️ / 🧑‍🤝‍🧑 Friends** and use **Find people**. The other person gets a bell notification and a badge, and can **Accept** or **Decline** under *Requests*. You can cancel a request you sent, or **Unfriend** later. If two people ask each other, they simply become friends.
- **Private chat:** open a friend from the *Friends* tab (or **💬 Message** on their profile). Each conversation is a small window docked beside the group chat (up to 3 at once; click the header to minimize). New messages pop up minimized with a badge; unread counts show on the Friends button. You can edit/delete your own messages. On phones it is a bottom sheet.
- **Privacy:** only the two friends can read a conversation (Heads cannot). Unfriending stops sending; deleting an account removes its friendships and conversations.
- **Limits:** 40 friends + pending requests per person, last 100 messages kept per conversation, 1000 characters per message.
- **📎 Files (group chat and private chats):** the paperclip sends a picture or a file (pictures are shrunk automatically; other files up to 1 MB). Files can be opened for **15 minutes**, then they disappear from the chat and from storage. Max 6 files per person per 15 minutes.
- **How it updates:** same poll as the group chat (`GET /api/chat` now also returns `friends`, `reqIn`, `reqOut`, `dms`), so no extra polling; each friend adds one blob read per poll.
- **Storage:** `fr:<userId>` = `{f,in,out}`, `dm:<idA>~<idB>` = `{rev,msgs}`. Not part of backup/restore.
- **API:** `GET /api/friends`, `POST /api/friends/{request|accept|decline|cancel}` (`{userId}`), `DELETE /api/friends/<id>`, `POST /api/dm/send` (`{to,text}`), `PUT|DELETE /api/dm/msg/<id>?with=<friendId>`; open conversations are requested via `/api/chat?dm=<ids>&drev=<id:rev>&dseen=<id:ts>`.
- **Files:** `public/friends.js`, `public/friends.css`, hooks in `chat.js`, routes in `api.mjs`, notification types in `app.js`.

## Log repeating task (Personal calendar)
On the **Personal** calendar a **🔁 Log repeating task** button sits just above the keyboard-shortcut tip (it is hidden on Shared). It opens a pane where you enter a title (and optional description / priority), a **start** and **end** date, and the **weekdays** to repeat on (quick presets: Weekdays, M·W·F, T·Th, Every day). A live line shows how many sticky notes will be created; optionally skip Philippine holidays. **Create notes** adds one normal sticky note per matching day (max 366 days per run).
- Speed: the pane is built only when first opened; all notes are created in memory and saved with **one** `PUT /api/board` request, then the calendar redraws once. No server change.
- Files: `public/repeat.js` (logic), a button in `public/index.html`, styles at the end of `public/style.css`. Details in `CHANGES.md`.

## Profile posts (Threads style)
Every profile has a **Threads** section: short text posts, likes and replies.
- **Post:** open **👤 Profile** in the header, type under *Start a thread…* and press **Post** (500 characters, line breaks kept, links clickable, plain text only). Newest first; the last 200 are kept per person; you can delete your own posts.
- **See others':** click anyone's name or photo (group chat, Online list, Friends) to open their profile; their posts are listed under their details. Anyone who can see the profile can **like** (♥, tap again to unlike) and **reply** (300 characters, up to 100 per post). The post owner, the reply's author and Heads can delete a reply; Heads can delete any post.
- **Bell:** the author gets a notification when someone likes (once per person per post) or replies. Tapping it opens your profile.
- **Privacy:** if a person hides their profile, their posts are hidden too (Heads and the owner still see them), and likes/replies are refused. Posting is limited to one post every 2 seconds.
- **Storage:** `posts:<userId>` = `{items:[{id,ts,text,likes:[userId],replies:[{id,uid,ts,text}]}]}`. Deleted with the account. Not part of backup/restore.
- **API:** `GET /api/posts/<userId>`, `POST /api/posts` (`{text}`), `DELETE /api/posts/<userId>/<postId>`, `POST /api/posts/<userId>/<postId>/like`, `POST .../reply` (`{text}`), `DELETE .../reply/<replyId>`.
- **Files:** `public/posts.js`, `public/posts.css`, hooks in `app.js` (own profile + bell) and `chat.js` (profile viewer), routes in `api.mjs`. No extra polling: posts load when a profile is opened.

## Servers (Discord-style)
A hover menu on the left lists your servers. **CEPALCO Server** (created by the default admin) holds the existing positions (Head/Supervisor/Staff), custom roles and group chat. Anyone can create their own server (＋ Add a server), share its invite code, and manage their own positions, roles, chat and shared calendar there. Full notes: `SERVERS.md`.

## Upgrading from the earlier calendar-only version
Same storage name, so existing accounts and personal boards carry over. Old `user` accounts become **Staff**; everyone is logged out once (new cookie sessions). Existing admin passwords are unchanged (`ADMIN_INITIAL_PASSWORD` is only used when no users exist yet).

## Layout
```
public/                static site (index, login, users, app.js, repeat.js, style.css)
netlify/functions/api.mjs   API at /api/*  (Netlify Blobs storage)
```
Data keys in the `taskboard` blob store: `users`, `shared`, `board:<userId>` (includes a `rev` revision number), `sess:<token>` (includes the user's password version `pv`).

## Profile picture
Click **👤 Profile** in the header to see your photo and upload a new one (JPG/PNG/WebP, auto-cropped square and resized). The first upload is free; after that it can only be changed **once every 15 days** (enforced by the server). The photo also shows beside your name in the header.
