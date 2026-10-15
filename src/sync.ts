// Device sync for the phone/web app: push locally changed keys, pull everything newer, newest edit wins per key.
// Devices share one random secret (the "sync code"); the server only ever sees its SHA-256.
import { allKeys, applyRemote, dirty, enqueueAll, meta, readValues, remapIds, req, setMeta, tx } from './api.ts';

const SYNC = import.meta.env.VITE_SYNC_URL || 'https://orbit-sync.poofapps.workers.dev';
const BATCH = 20; // keys per push (photos make requests big)

export type SyncStatus = { on: boolean; last?: number; error?: string; code?: string };

let running: Promise<void> | null = null;
let again = false;
let lastError = '';

async function post(secret: string, since: number, changes: { k: string; v: unknown; t: number }[]) {
  const res = await fetch(`${SYNC}/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ since, changes }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `sync failed (${res.status})`);
  return res.json() as Promise<{ changes: { k: string; v: unknown; t: number }[]; cursor: number; more: boolean }>;
}

async function run() {
  const secret = await meta<string>('secret');
  if (!secret) return;
  let cursor = (await meta<number>('cursor')) ?? 0, applied = 0;
  for (let guard = 0; guard < 500; guard++) {
    const pending = await tx('outbox', 'readonly', t => Promise.all([req(t.objectStore('outbox').getAllKeys()), req(t.objectStore('outbox').getAll())]))
      .then(([k, v]) => k.map((key, i) => ({ k: String(key), t: v[i] as number })).sort((a, b) => a.t - b.t).slice(0, BATCH));
    const values = await readValues(pending.map(p => p.k));
    const res = await post(secret, cursor, pending.map((p, i) => ({ k: p.k, v: values[i], t: p.t })));
    // clear only what we pushed — a key edited again meanwhile keeps its newer timestamp and goes next round
    await tx('outbox', 'readwrite', async t => {
      const s = t.objectStore('outbox');
      for (const p of pending) if ((await req(s.get(p.k))) === p.t) s.delete(p.k);
    });
    applied += await applyRemote(res.changes as never);
    cursor = res.cursor;
    await setMeta('cursor', cursor);
    const left = await tx('outbox', 'readonly', t => req(t.objectStore('outbox').count()));
    if (!left && !res.more) break;
  }
  await setMeta('last', Date.now());
  lastError = '';
  if (applied) dispatchEvent(new Event('orbit:synced'));
}

/** Sync now (coalesces overlapping calls into one follow-up run). Never throws; errors show in syncStatus. */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = run().catch(e => { lastError = navigator.onLine ? (e as Error).message : 'offline — will sync when you are back online'; })
    .finally(() => { running = null; if (again) { again = false; syncNow(); } });
  return running;
}

export async function syncStatus(): Promise<SyncStatus> {
  const code = await meta<string>('secret');
  return { on: !!code, code, last: await meta<number>('last'), error: lastError || undefined };
}

const newCode = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_');

/** First device: create the sync space and upload everything here. Returns the code for other devices. */
export async function enableSync() {
  const code = newCode();
  await setMeta('secret', code);
  await setMeta('cursor', 0);
  await remapIds();
  await enqueueAll();
  await syncNow();
  return code;
}

/** Another device: pull what's already synced (newest edit wins), then upload what only this device has. */
export async function joinSync(input: string) {
  const code = input.trim();
  if (!/^[A-Za-z0-9_-]{32,}$/.test(code)) throw new Error('That doesn\'t look like a sync code — copy it again from your other device.');
  let cursor = 0;
  const remote = new Set<string>();
  for (let guard = 0; guard < 500; guard++) {
    const res = await post(code, cursor, []); // also proves the code works before we commit to it
    res.changes.forEach(c => remote.add(c.k));
    await applyRemote(res.changes as never);
    cursor = res.cursor;
    if (!res.more) break;
  }
  await setMeta('secret', code);
  await setMeta('cursor', cursor);
  await remapIds();
  const pending = new Set(await tx('outbox', 'readonly', t => req(t.objectStore('outbox').getAllKeys())).then(k => k.map(String)));
  await dirty((await allKeys()).filter(k => !remote.has(k) && !pending.has(k)));
  await syncNow();
  dispatchEvent(new Event('orbit:synced'));
}

/** Stop syncing on this device. Its data stays; other devices are unaffected. */
export async function disableSync() {
  await setMeta('secret', undefined);
  await setMeta('cursor', undefined);
  await setMeta('last', undefined);
}

/** Background triggers: after local edits (debounced), on open, when coming back to the app or online, and every minute. */
export function startAutoSync() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  addEventListener('orbit:dirty', () => { clearTimeout(timer); timer = setTimeout(syncNow, 1500); });
  addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60e3);
  syncNow();
}
