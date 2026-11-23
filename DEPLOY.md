# CrewCamp v2.17.0 — Deploy Guide (GitHub → Netlify)

> Site: https://crewcamp.netlify.app — in Netlify go to Site configuration → Change site name and set it to `crewcamp`.

## Full deployment mode (recommended): one command, or automatic on every push

You need two values from Netlify (your token is never written into the repo):

| Value | Where to find it |
|---|---|
| `NETLIFY_AUTH_TOKEN` | Netlify → User settings → Applications → **Personal access tokens** → New |
| `NETLIFY_SITE_ID` | your site → Site configuration → General → **Site information → API ID** |

**A. From your computer** (Node 20+):
```
# create a file called .env.deploy (git-ignored) with these lines:
#   NETLIFY_AUTH_TOKEN=...
#   NETLIFY_SITE_ID=...
#   ADMIN_INITIAL_PASSWORD=choose-8+-chars     (first deploy only)
npm run deploy
```
It installs, runs the tests, saves the admin password, deploys `public/` + the functions to production and then checks the live site. Re-check any time with `npm run verify -- https://<your-site>.netlify.app`.

**B. Automatically from GitHub:** repo → Settings → Secrets and variables → Actions → add `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` (and `ADMIN_INITIAL_PASSWORD` for the first run). Every push to `main` then deploys through `.github/workflows/deploy.yml`.

**What gets deployed:** `api.mjs` (the whole API, `/api/*`) and `sweep.mjs` (scheduled every 15 minutes; deletes expired chat attachments). Scheduled functions run on the published (production) deploy; you can see it under Netlify → Logs → Functions. Nothing else to configure.

### File attachments and your Netlify usage
Files shared in chats last 15 minutes. Cost per shared file: 1 function call + a few blob operations (+1 call per viewer per picture, once per browser). Polling costs are unchanged. The sweep adds ~96 tiny calls per day. Limits that keep it small: pictures shrunk in the browser (~100–300 KB), other files ≤ 1 MB, ≤ 6 files per person per 15 minutes.

---

## Manual setup through the Netlify website (alternative)
## 1. Push to GitHub
```
git init && git add . && git commit -m "CrewCamp v2.13.2"
git branch -M main
git remote add origin <your-repo-url> && git push -u origin main
```

## 2. Create the Netlify site
1. Netlify → **Add new site → Import from Git** → pick the repo.
2. Settings are read from `netlify.toml` (no build command, publish dir `public`, functions in `netlify/functions`).
3. **Site configuration → Environment variables** → add `ADMIN_INITIAL_PASSWORD` (8+ characters).
4. **Deploy site.**

> Deploy from Git or the Netlify CLI. Drag-and-drop will NOT install `@netlify/blobs`.

## 3. First login
Open the site → log in as `admin` with your `ADMIN_INITIAL_PASSWORD` → **Admin → 👥 Accounts & backup** → create accounts, then set positions/roles per server (Admin → Manage people & roles). Temporary passwords must be changed at first login.

## 4. Verify (2 minutes)
- `https://<site>/api/` responds (JSON error or data, not a 404 page).
- Group chat → 📎 → send a picture: it shows with a "15 min left" countdown; open it from a second account.
- Login works, both calendars (Personal / Shared) load.
- Group chat dock opens; create a Server and join with its invite code.

## Local check before pushing
```
npm install
npm test        # runs the full check suite, no network needed
```

## Troubleshooting
| Symptom | Fix |
|---|---|
| "Setup needed: set ADMIN_INITIAL_PASSWORD" | Add the variable in Netlify, then **Trigger deploy**. |
| 404 on `/api/...` | Site was drag-dropped; redeploy from Git. |
| Locked out (5 tries) | Wait 15 minutes. |
| Changed the env password but admin still uses the old one | The variable only seeds the first admin; change the password inside the app. |

Docs: `README.md` (features/roles), `SERVERS.md` (servers feature), `CHANGES.md` (v2.6 changes).

## Google sign up / sign in

1. Google Cloud Console → APIs & Services → Credentials → **Create credentials → OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins** add `https://crewcamp.netlify.app` (and `http://localhost:8888` for `netlify dev`). No redirect URI is needed.
3. In Netlify → Site configuration → Environment variables add `GOOGLE_CLIENT_ID` (the client ID from step 1), then redeploy.
4. Optional: `GOOGLE_ALLOWED_DOMAINS=yourcompany.com` limits who may join (comma-separated). Without it, **any** Google account can sign up as Staff.

Until `GOOGLE_CLIENT_ID` is set, the login page shows only the username/password form.

**Sign up:** the person opens the **Sign up** tab, chooses a display name, username and password, then taps **Sign up with Google** (the button stays covered until all three are valid). The account is created as Staff and can afterwards log in with Google or with that username + password. **Log in** with Google only works for accounts that already exist. Existing username/password accounts keep working (the admin login is unchanged).
