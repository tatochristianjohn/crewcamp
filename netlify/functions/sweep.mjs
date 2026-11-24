// CrewCamp - scheduled clean-up of expired chat attachments (runs every 15 minutes on the published deploy).
// Shared files live 15 minutes. api.mjs already refuses (and deletes) an expired file the moment someone asks for it;
// this sweep removes the ones nobody asked for again, so storage stays near zero. The expiry is part of each blob key
// (att:<expiry ms>_<random>), so the sweep only LISTS keys: no blob is read, and with no files it is a single cheap call.
import { getStore } from '@netlify/blobs';

export default async () => {
  const st = getStore({ name: 'taskboard', consistency: 'strong' });
  const now = Date.now();
  let gone = 0;
  const { blobs } = await st.list({ prefix: 'att:' });
  for (const b of blobs) {
    const exp = Number(String(b.key).slice(4, 17));
    if (Number.isFinite(exp) && exp <= now) { await st.delete(b.key).catch(() => {}); gone++; }
  }
  console.log(`sweep: ${blobs.length} attachment(s) found, ${gone} expired removed`);
  // chess: drop finished/abandoned game blobs (lobby index entries already expire on their own). Only runs a read per game, so it is skipped when there are none.
  const GAME_KEEP = 10 * 60e3, WAIT_KEEP = 2 * 60e3, ACTIVE_KEEP = 2 * 60e3;   // nothing is saved: abandoned tables go after ~1-2 min of nobody being there, finished games after 10 min
  const games = (await st.list({ prefix: 'chess:g:' })).blobs; let cg = 0;
  for (const b of games) {
    const g = await st.get(b.key, { type: 'json' }).catch(() => null);
    if (!g) continue;
    const age = now - Math.max(g.updated || 0, g.created || 0, g.seen?.white || 0, g.seen?.black || 0), lim = g.status === 'finished' ? GAME_KEEP : g.status === 'waiting' ? WAIT_KEEP : ACTIVE_KEEP;
    if (age > lim) { await st.delete(b.key).catch(() => {}); cg++; }
  }
  console.log(`sweep: ${games.length} chess game(s) found, ${cg} removed`);
};

export const config = { schedule: '*/15 * * * *' };
