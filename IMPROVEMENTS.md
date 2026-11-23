# CrewCamp: review & improvements (v2.2)

This document covers the code review, the bug that was fixed, the improvements shipped in this release, and what was
deliberately left alone. **The UI is unchanged**: same screens, same look, no new buttons or settings.

## 1. Review summary

I reviewed the code (not the screens) and rated the app **8 / 10** before these changes.

| Area | Before | After* | Notes |
|---|---|---|---|
| Simplicity ("less is more") | 9.5 | 9.5 | About 700 lines of front end, one server file, one dependency. Still true. |
| Security | 8.5 | 9 | Sessions are now revoked when a password changes. |
| Data safety | 7 | 8.5 | Boards can no longer be silently overwritten from another device. |
| Correctness | 7.5 | 8.5 | Server dates now use Manila time; logout bug fixed. |
| Accessibility | 8 | 8 | Unchanged. |
| Speed | 8 | 8.5 | About half the background requests. |
| Maintainability | 7 | 8 | There is now an automated test (`npm test`). |

\*After-scores are my own estimate, not a measurement.

## 2. Bug fixed: "I log out and it logs me straight back in"

**Cause.** `logout()` sent a POST with no body. The server tried to parse JSON from it, failed with `400 Bad JSON`, and
never reached the logout code. The page ignored the error and redirected to the login page anyway. The session
cookie was still valid, so the login page saw you were signed in and sent you back to the app.

**Fix.**
- `api.mjs`: an empty POST body is accepted; `/logout` is public and always revokes the session (if any) and always clears the cookie.
- `auth.js`: `logout()` only leaves the page once the server confirms; on failure it says so instead of silently redirecting. Pressing Back after logout no longer shows the signed-in page from memory.

## 3. Improvements in this release

| # | Change | Why | Files |
|---|---|---|---|
| 1 | Server dates use **Manila time (UTC+8)** | The server runs in UTC, so between 12:00 and 8:00 am in the Philippines "created" and "done" dates were saved one day early. | `api.mjs` (`today()`) |
| 2 | **Changing or resetting a password signs out all other sessions** | Previously a stolen or forgotten-on-a-shared-PC session stayed valid for up to 30 days after a password change. Implemented with a per-user password version (`pv`) stored in each session. The device that made the change stays signed in. Existing sessions keep working until the next password change. | `api.mjs` (`normUser`, login, auth check, `/change-password`, `PUT /users/:id`) |
| 3 | **No silent overwrite between devices** | The personal board was saved as one whole file, last save wins. Each board now carries a revision number. A stale device is refused with a clear message, loads the latest version and asks you to redo your last change. Saves also run one at a time. | `api.mjs` (`PUT /board`), `app.js` (`save`, `reloadBoard`) |
| 4 | **Lighter background refresh** | Shared tasks were fetched every 30 s per open tab (2,880 requests a day). Now every 60 s while visible, never more than once per 15 s, and still refreshed when you return to the tab. | `app.js` (`refreshShared`, interval) |
| 5 | **Automated smoke test** (`npm test`) | The logout bug would have been caught by a 5-second test. 32 checks, no dependencies, uses an in-memory stand-in for Netlify Blobs. | `test/smoke.mjs`, `package.json` |
| 6 | **Heads (admins) can never be assigned tasks** | See section 3a. | `api.mjs` (`assignable`) |

### 3a. Rule: Heads never receive tasks
- A **Head (admin) can assign tasks only to Supervisors and Staff**. They cannot assign to themselves or to any other Head.
- This protects the **default `admin` account** from tasks given by any newly created Head, and every other Head too.
- It is enforced **on the server** (create and edit), not just hidden in the screen, so it cannot be bypassed. The "Assign to" list simply no longer shows Heads.
- Supervisors already could only assign to their own staff, so nothing changes for them.
- **Existing data:** tasks that were already assigned to a Head before this release are not deleted or changed. They keep working and the Head can untick themselves from the task. They just cannot be assigned again.

### Things you may notice
- After you change your password on one device, your **other devices ask you to sign in again**. That is intended.
- If you edit your board on two devices at once, the older one shows: *"Changed on another device. Latest version loaded; please redo your last change."* Nothing is lost on the device that saved first.
- Existing boards upgrade automatically: they start at revision 0 and move to 1 on the next save. No data migration is needed.
- After an admin **restores a backup**, other devices reload the restored board on their next save and may need to sign in again.

## 4. How it was verified
- `npm test` → 32 / 32 checks pass (login, logout, revoked cookies, board revisions, password revocation, admin reset, Manila date, Heads never assigned). Run against the previous version, the 11 original checks and the 7 new Head-rule checks fail.
- Real-browser tests (Chromium) with the real pages and real API code: logout stays on the login page, cookie removed, Back/reload/direct URL all go to login, and re-login works. Two simultaneous "devices": the stale device is refused and the first device's task is preserved. The Head's "Assign to" list shows only Supervisors and Staff.
- Not tested: a live Netlify deployment (Netlify Blobs was replaced by an in-memory stand-in locally). Please do a quick log in → log out → log in on the deployed site after deploying.

## 5. Deliberately not changed (optional next steps, in priority order)
1. **Fonts:** three Google font families load from outside the site. Trimming to one or two weights, or self-hosting, would look the same and load faster on mobile data.
2. **Holidays:** Chinese New Year is listed only for 2026–2028 and Eid'l Fitr / Eid'l Adha are not included. Add a small per-year table.
3. **Lockout:** the 5-attempt lock is per username, so anyone who knows a username can lock it for 15 minutes. Consider keying on username + IP.
4. **Password length:** admin-created passwords need 6 characters, self-chosen ones need 8. Make both 8.
5. **Content-Security-Policy:** needs the inline `onclick` handlers moved to listeners first.
6. **Housekeeping:** add `package-lock.json` for reproducible builds; expired `sess:` records are never cleaned up (only removed on logout).
7. **Offline/slow network:** a failed save only shows a toast; there is no automatic retry.

Not recommended, because it would work against "less is more": dashboards, notifications, a front-end framework, or more settings.

## 6. Deploy
No new environment variables or build steps. Push to Git (or `netlify deploy --prod`) as before, then run `npm test` locally if you like.
