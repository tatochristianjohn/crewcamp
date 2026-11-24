# CrewCamp: Chess integration handoff

## What was asked
1. A **Games** button below the server list in the left rail.
2. A **chess game** using the rules logic from ChessLAN (Python/Flask/python-chess/Socket.IO).
3. UI must match CrewCamp's style.

## Status: working end to end; polish/features remain
Verified: engine perft (start pos d3 = 8902, Kiwipete d3 = 97862, plus 2 more positions) and an API flow test (fool's mate) via `node test/chess.mjs`. **Not verified in a browser** (no browser in the build env). First thing to do: deploy/preview, open `games.html` with two accounts, play a game, check all themes + phone width.

## Architecture decisions
- ChessLAN is server-authoritative (client only draws FEN + `legal_moves`, sends moves). Kept that model.
- CrewCamp runs on Netlify Functions + Netlify Blobs (no websockets, no Python). So python-chess was **ported to JS** and Socket.IO was replaced by **polling** (1.2 s when waiting on opponent, 2.5 s otherwise, 5 s in hidden tab).
- Games are **global** (not per server); any logged-in user can play anyone.
- Clocks: server stores remaining ms + `turnAt`; computed on read. A flagged player loses when anyone reads the game (the client polls on flag).

## Files added / changed
| File | Change |
|---|---|
| `netlify/functions/chess-engine.mjs` | NEW. Pure rules: FEN, legal moves, castling, en passant, promotion, SAN, check/mate/stalemate, insufficient material, 50/75 move, 3/5-fold repetition, captured pieces. |
| `netlify/functions/chess-api.mjs` | NEW. Routes `/api/chess/{lobby,game,new,join,move,resign,cancel}`. Blobs keys `chess:g:<id>`, `chess:idx` (lobby index). |
| `netlify/functions/api.mjs` | 2 edits: import + a `path.startsWith('/chess/')` delegate placed right before `/cross` (after session auth); error handler now spreads `e.extra`. |
| `public/games.html`, `public/chess.js`, `public/chess.css` | NEW. Lobby (new game: time + colour, open tables, my games) and board view (clocks, captured, move list, promotion dialog, resign, cancel). Game id lives in `location.hash`. |
| `public/servers.js` | Games button (`#svGames`, flag `ONG`) after "Add a server"; click goes to `games.html`; server buttons not highlighted on games page. |
| `test/chess.mjs`, `package.json`, `DESIGN.md` | Tests, `npm test` runs both, design note. |

## Done in session 2
- **In-game chat**: `POST /chess/chat {id,text}`; stored as `chat` (cap 100, 200 chars each) on the game blob; players only write, spectators can read; `view()` returns the last 50. UI card under Moves.
- **Rematch**: `POST /chess/rematch {id}` on a finished game. First click makes a new table (colours swapped, same time control) reserved for the opponent (`invite` on the blob, `inv` in the lobby index, shown as "rematch" in their Open tables). The opponent's click joins it directly. Old game stores `rematch:{id,by}`.
- **Cleanup**: `sweep.mjs` deletes chess game blobs (finished > 7 d, waiting > 1 d, active > 3 d idle).
- **Service worker**: `games.html`, `chess.js`, `chess.css` added to SHELL, cache bumped to `cc-v4`.
- **Tests**: chat + rematch + invite checks in `test/chess.mjs`; fixed `test/smoke.mjs` (it did not copy `chess-api`/`chess-engine` into its temp dir, so `npm test` was failing on import).

## Done in session 3
- **Draw offers**: `POST /chess/draw {id, action: offer|accept|decline}`. Offer state on the blob as `draw:{by}`, exposed in `view()` as `draw:{by_me}`. A mutual offer ends the game; the recipient moving on counts as declining; you must move before re-offering (`drawn`). Result reason `agreement` ("Draw by agreement"). UI: Offer draw button + accept/decline card in `games.html`/`chess.js`. Tests added. SW cache bumped to `cc-v5`.

## Done in session 4
- **Increment** (Bonus per move: 0/1/2/3/5/10 s): `inc` on the game, added to the mover's clock on each move, carried into rematches, shown as `3+2` in the lobby.
- **Turn notifications** (`chess_turn`, `chess_join`, `chess_rematch`) through CrewCamp's bell; `notify` is passed into `chessApi`. A turn ping is sent only if the opponent has not moved for 45 s (`PING_GAP`), so live games do not flood the bell. Click opens `games.html#<id>`.
- **Move review**: `view()` now returns `places` (piece placement per ply) and `uci` per move. Click a move, use the arrow buttons, or the arrow keys. Moving is blocked while reviewing.
- **Flip board** button, **move sounds** (WebAudio, no assets) with a mute toggle kept in localStorage.
- SW cache `cc-v6`. Tests extended. Still **not browser-verified**.

## Done in session 5
- **Spectator UI**: `/chess/lobby` now returns `live` (active games you are not in, newest first, max 20). Lobby shows a "Live games" list under Open tables with a Watch button (opens the existing read-only board, "Spectating"). Test added. SW cache `cc-v7`.

## Done in session 6
- **Auto-abort**: an active game with fewer than 2 moves and no move for 90 s (`ABORT_MS`) is settled on read as `aborted` (no winner, leaves the lobby index). Rematch still allowed.
- **Presence dots**: `g.seen[color]` is stamped on `/chess/game` reads by players, throttled to 15 s (`SEEN_GAP`) and without touching `rev`; `view().online = {white,black}` (online if seen < 40 s). UI: filled dot = online, hollow = away, next to the name strip.
- **Drag and drop** (pointer events, 6 px threshold, ghost piece; tap-to-move unchanged). Board now uses `touch-action:none`.
- **Copy PGN** button (client-side, headers + SAN + result + TimeControl).
- SW cache `cc-v8`. Tests added (`presence + abort tests passed`). Still **not browser-verified**: drag on touch devices is the riskiest new piece.

## Done in session 7
- **Challenge a friend**: `POST /chess/new` accepts `to` (a friend's user id). `api.mjs` passes an `areFriends(id)` callback (mutual `fr:` lists) into `chessApi`; non-friends get 403. The table is reserved with `invite`/`inv` (same mechanism as rematch), the friend gets a `chess_challenge` bell notification ("X challenged you to chess", opens `games.html#<id>`), and it shows as "challenge" in their Open tables. Rematch index entries now carry `rem:1` so the lobby can tell rematch from challenge. UI: **Opponent** select in the New game card, filled from `/api/friends`.
- SW cache `cc-v9`. `test/chess.mjs` gained challenge tests (`challenge tests passed`). Still **not browser-verified**.

## Done in session 8: speed (real-time feel on Netlify)
- **Long-poll instead of 1.2-2.5 s polling**: `GET /chess/game?id=&since=<rev>&wait=1` holds up to 6 s (`HOLD_MS`), re-reading the blob every 250 ms (`TICK_MS`), and answers the moment `rev` changes, a clock flags or an abort is due. Client re-polls right after each answer (`pollSeq` drops stale responses). Netlify Functions have no websockets, so this is the closest in-platform option.
- **Optimistic moves**: the client draws your move at once (castling, en passant, promotion handled in `withOpt`) and the server reply replaces it; on error it snaps back.
- **Fewer blob ops**: `settle` is read-only unless a game must actually be settled (was a read+write on every poll); `/chess/move` no longer does `load`+`settle` first (timeout/abort settled inside the same mutate), lobby-index keep-alive only every 10 min (`IDX_TOUCH`), index update and notification run in parallel; rematch now bumps `rev` so it wakes long-polls.
- SW cache `cc-v10`. Tests: `long-poll + inline settle tests passed`. If true websockets are ever wanted: Ably/Pusher/Supabase Realtime publish from `chess-api.mjs` after each write (needs `connect-src` in netlify.toml).

## Done in session 9: nothing is kept
- A table (waiting or active) with nobody on it for 60 s (`WAIT_MS`/`STALE_MS`) is abandoned: removed from the lobby and its blob deleted on the next read of the lobby or game (`gone`/`drop`). Presence is the long-poll stamp (`seen`, every 15 s), which also keeps the lobby index entry alive. Joining an expired table fails ("expired").
- Finished games live 10 min (`FIN_KEEP`, enough for rematch/PGN), then 404 and delete. `sweep.mjs` (every 15 min) removes whatever nobody read again.

## Still to do (updated)
1. **Browser check** (no browser in the build env): two accounts, play, chat, rematch, challenge, drag on touch, all themes, phone width.
2. Share a game into a channel as a "Join my chess table" card.
3. SVG piece sets instead of Unicode glyphs (needs visual checking in a browser, so do it after step 1).
4. Takebacks (build like draw offers), ratings/leaderboard, correspondence mode, a second game.

## Still to do (older list, superseded by session 7 above)
1. **Browser check** (still not done): two accounts, play a game, chat, rematch, all themes, phone width.
2. ~~Draw offers~~ done.
3. ~~Presence dots~~ done.
4. ~~Spectator UI~~ done.
5. Turn notifications via CrewCamp `/notifications`.
6. Sound / move animation, drag and drop, board flip toggle, piece set.

## Gotchas
- `api.mjs` passes `mutate`, `J`, `H` into `chessApi` (so chess-api has no dependency on api.mjs internals).
- `mutate()` retries 6x on etag conflict; callbacks must be side-effect free (they are).
- CSP in `netlify.toml` already allows everything used (no new origins).
- Theme rule in `DESIGN.md`: no hard-coded hex in components. Exceptions in chess.css: red for check/low clock and piece fill colours (white/black pieces need fixed contrast).

## Improvement ideas (proposed, nothing built yet)

### 1. Make it feel alive (biggest payoff)
- **Turn notifications** via CrewCamp `/notifications` ("Ann moved, your turn"). Today a game only progresses if both players keep the tab open.
- **Challenge a friend directly**: button on a friend's profile or in chat that creates a reserved table (reuse the rematch `invite` field).
- **Share a game into chat**: post a "Join my chess table" card into a server channel.

### 2. Play feel
- Drag and drop alongside tap-to-move; move animation.
- Sound for move/capture/check/game end, with a mute toggle.
- Inline SVG piece sets (e.g. cburnett) instead of Unicode glyphs, which vary a lot by device; 2-3 sets that follow the theme.
- Premoves and a flip-board toggle (important in 1-3 min games).
- Move-list navigation: click a move or use arrow keys to review earlier positions.

### 3. Game depth
- Correspondence mode (e.g. 1 day per move); with notifications this suits a friend group best, and the storage model mostly supports it (a clock option).
- Increment (e.g. 3+2).
- Takebacks (request/accept), built like draw offers.
- Ratings (Elo/Glicko), a small leaderboard, per-user W/D/L stats.
- Game history and PGN export, plus copy FEN/PGN. Finished games are swept after 7 days, so keep a short per-user record.

### 4. Social and spectating
- Live games list so others can watch (API already allows spectator reads; no UI yet).
- Presence dots (`lastSeen` per player on `/chess/game` reads).
- Chat quick-phrases/reactions ("gg", "rematch?") and an unread badge on the chat card.

### 5. Robustness (do before adding much more)
- Browser test first: two accounts, all themes, phone width.
- Polling cost: 1.2 s polling per active game adds up on Netlify Functions. Use `rev`/ETag checks returning 304, or a longer interval when it is not the opponent's turn.
- Reconnect/timeout: flag detection only happens on read, so abandoned games sit "active" until the sweep. Auto-abort if the first move is not made within ~60 s.
- Accessibility: screen-reader move announcements, high-contrast board option, keyboard move entry (type "e4").

### 6. Beyond chess
- The lobby already uses a Games tile list; tic-tac-toe, Connect Four or checkers would reuse the table, chat, rematch and notification plumbing.

### Suggested first batch
Browser check, turn notifications, direct friend challenges, move-list navigation, SVG pieces, increment.
Quick wins: sound, flip board, increment, move-list navigation. Larger: ratings, correspondence mode, a second game.
