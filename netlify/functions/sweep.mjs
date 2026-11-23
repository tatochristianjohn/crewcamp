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
};

export const config = { schedule: '*/15 * * * *' };
