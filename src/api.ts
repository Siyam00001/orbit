// One API surface, two backends: the Express server (laptop, `npm start`) or IndexedDB on the
// device (phone app, `npm run build:app`). Routes and validation mirror server.js exactly.
// The on-device backend also records every change as a sync key (see logic.ts) for sync.ts.
import { dayField, dayPatchKeys, mergePatch, parseKey, setDayField, ymd, type Day, type Item } from './logic.ts';

export const LOCAL = import.meta.env.MODE === 'app';

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (LOCAL) return local(path, method, body) as Promise<T>;
  const raw = body instanceof Blob;
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': raw ? body.type : 'application/json' },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `${res.status} ${res.statusText}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

export const photoUrl = (ph: Item): string => ph.url ?? `/photos/${ph.file}`;

/** Phone photos are huge: shrink to ≤1600px JPEG (also turns HEIC into JPEG wherever the browser can decode it). */
export async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not process photo'))), 'image/jpeg', 0.85));
  } catch {
    return file; // undecodable here — let the backend accept or reject the original
  }
}

// ── on-device backend (IndexedDB) ──

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTS = new Set(['velo', 'dms', 'apps', 'replies', 'spent', 'earned', 'cravings']);
const DEFAULTS = { name: 'Siyam', city: 'Lahore', startCash: 0, veloLimit: 8, notes: '' };
const STORES = ['days', 'settings', 'items'];

let dbp: Promise<IDBDatabase> | undefined;
const db = () => dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open('orbit', 2);
  r.onupgradeneeded = e => {
    const d = r.result;
    if (e.oldVersion < 1) {
      d.createObjectStore('days');
      d.createObjectStore('settings');
      d.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
    }
    if (e.oldVersion < 2) {
      d.createObjectStore('outbox');  // sync key → time of the local change not yet pushed
      d.createObjectStore('fieldts'); // sync key → time of the version we hold (local or pulled)
      d.createObjectStore('meta');    // sync secret, pull cursor, last sync time
    }
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
export const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Run fn inside one transaction and resolve only once it has committed. */
export async function tx<T>(stores: string | string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const t = (await db()).transaction(stores, mode);
  const done = new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  const out = await fn(t);
  await done;
  return out;
}
const entries = (s: IDBObjectStore) => Promise.all([req(s.getAllKeys()), req(s.getAll())])
  .then(([k, v]) => Object.fromEntries(k.map((key, i) => [key, v[i]])));

export const meta = <T = any>(k: string) => tx('meta', 'readonly', t => req<T>(t.objectStore('meta').get(k)));
export const setMeta = (k: string, v: unknown) => tx('meta', 'readwrite', t => { v === undefined ? t.objectStore('meta').delete(k) : t.objectStore('meta').put(v, k); });

/** Globally unique item ids, so photos and letters made on different devices never collide. */
const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

/** Mark sync keys as changed locally (now), and tell sync.ts there is something to push. */
export async function dirty(keys: string[]) {
  if (!keys.length) return;
  const t = Date.now();
  await tx(['outbox', 'fieldts'], 'readwrite', x => { for (const k of keys) { x.objectStore('outbox').put(t, k); x.objectStore('fieldts').put(t, k); } });
  dispatchEvent(new Event('orbit:dirty'));
}

const fail = (msg: string): never => { throw new Error(msg); };
const items = (kind: string) => tx('items', 'readonly', t => req(t.objectStore('items').getAll()))
  .then(all => all.filter(i => i.kind === kind).sort((a, b) => b.id - a.id));
const settings = () => tx('settings', 'readonly', t => entries(t.objectStore('settings'))).then(s => ({ ...DEFAULTS, ...s }));
const capsule = (c: Item) => { const open = c.opens <= ymd(); return { ...c, open, text: open ? c.text : null }; };

const urls = new Map<number, string>(); // one object URL per photo, reused across reloads
const withUrl = ({ blob, ...p }: Item) => { if (!urls.has(p.id)) urls.set(p.id, URL.createObjectURL(blob)); return { ...p, url: urls.get(p.id) }; };
const forget = (id: number) => { if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)!); urls.delete(id); } };

async function remove(kind: string, id: number) {
  await tx('items', 'readwrite', async t => {
    const s = t.objectStore('items'), it = await req(s.get(id));
    if (it?.kind === kind) s.delete(id);
  });
  forget(id);
  await dirty([`i|${id}`]);
}

let wx: { at: number; city: string; data: unknown } = { at: 0, city: '', data: null };
async function weather() {
  const { city } = await settings();
  if (wx.city === city && Date.now() - wx.at < 30 * 60e3) return wx.data;
  // fuzzy search ranks e.g. "Santa Catarina Tlaxila" (Mexico) above "Taxila" (Pakistan): prefer an exact name match
  const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=10&name=${encodeURIComponent(city)}`)).json();
  const p = geo.results?.find((r: { name: string }) => r.name.toLowerCase() === city.trim().toLowerCase()) ?? geo.results?.[0] ?? fail(`city "${city}" not found`);
  const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}` +
    '&current=temperature_2m,weather_code&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1')).json();
  wx = { at: Date.now(), city, data: {
    city: p.name, temp: Math.round(f.current.temperature_2m), code: f.current.weather_code,
    rain: f.daily.precipitation_probability_max[0] ?? 0, hi: Math.round(f.daily.temperature_2m_max[0]), lo: Math.round(f.daily.temperature_2m_min[0]),
  } };
  return wx.data;
}

const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

// ── sync support: read/write state by sync key ──

/** Every sync key this device currently holds data for. */
export async function allKeys() {
  const [days, set, its] = await tx(STORES, 'readonly', t => Promise.all([
    entries(t.objectStore('days')), entries(t.objectStore('settings')), req(t.objectStore('items').getAllKeys())]));
  return [
    ...Object.entries(days as Record<string, Day>).flatMap(([date, d]) => dayPatchKeys(date, d as Record<string, unknown>)),
    ...Object.keys(set).map(k => `s|${k}`),
    ...its.map(id => `i|${id}`),
  ];
}
export const enqueueAll = async () => dirty(await allKeys());

/** Current value for each sync key (null = deleted); photos travel as data URLs. */
export async function readValues(keys: string[]) {
  const [days, set, its] = await tx(STORES, 'readonly', t => Promise.all([
    entries(t.objectStore('days')), entries(t.objectStore('settings')), req(t.objectStore('items').getAll())]));
  const byId = new Map(its.map(i => [String(i.id), i]));
  return Promise.all(keys.map(async k => {
    const { type, a, b } = parseKey(k);
    if (type === 'd') return dayField(days[a], b);
    if (type === 's') return set[a] ?? null;
    const it = byId.get(a);
    if (!it) return null;
    const { blob, id, ...rest } = it;
    return blob ? { ...rest, image: await toDataUrl(blob) } : rest;
  }));
}

/** Apply changes from other devices, newest edit wins per key. Returns how many were applied. */
export async function applyRemote(changes: { k: string; v: any; t: number }[]) {
  // decode photos before the transaction — awaiting fetch inside it would let it auto-commit half-done
  const ready = await Promise.all(changes.map(async c => {
    if (!c.v?.image) return c;
    const { image, ...rest } = c.v;
    return { ...c, v: { ...rest, blob: await (await fetch(image)).blob() } };
  }));
  let applied = 0;
  const touched: number[] = [];
  await tx([...STORES, 'outbox', 'fieldts'], 'readwrite', async t => {
    const fts = t.objectStore('fieldts'), out = t.objectStore('outbox');
    for (const c of ready) {
      const [have, pending] = await Promise.all([req<number | undefined>(fts.get(c.k)), req<number | undefined>(out.get(c.k))]);
      if ((have ?? 0) >= c.t || (pending ?? 0) >= c.t) continue; // we hold the same or a newer version
      applied++;
      fts.put(c.t, c.k);
      const { type, a, b } = parseKey(c.k);
      if (type === 'd') {
        const s = t.objectStore('days'), d = setDayField((await req<Day | undefined>(s.get(a))) ?? {}, b, c.v);
        if (Object.keys(d).length) s.put(d, a); else s.delete(a);
      } else if (type === 's') {
        c.v == null ? t.objectStore('settings').delete(a) : t.objectStore('settings').put(c.v, a);
      } else if (type === 'i') {
        const id = Number(a);
        c.v == null ? t.objectStore('items').delete(id) : t.objectStore('items').put({ ...c.v, id });
        touched.push(id);
      }
    }
  });
  touched.forEach(forget);
  return applied;
}

/** Give pre-sync items (small auto-increment ids) unique ids so two devices' "item 3" can't collide. */
export async function remapIds() {
  const moved = await tx('items', 'readwrite', async t => {
    const s = t.objectStore('items'), old = (await req(s.getAll())).filter(i => i.id < 1e12);
    const base = Date.now() * 1000;
    return old.map((it, i) => { const id = base + i; s.delete(it.id); s.put({ ...it, id }); return id; });
  });
  urls.forEach(u => URL.revokeObjectURL(u));
  urls.clear();
  await dirty(moved.map(id => `i|${id}`));
}

async function local(path: string, method: string, body: any): Promise<unknown> {
  const url = new URL(path, 'http://local');
  const [, a, b, c] = url.pathname.split('/'); // e.g. /days/2026-10-11/bump
  const route = `${method} ${a}${b ? '/:' : ''}${c ? `/${c}` : ''}`;
  switch (route) {
    case 'GET days': return tx('days', 'readonly', t => entries(t.objectStore('days')));
    case 'PATCH days/:': {
      if (!DATE.test(b) || typeof body !== 'object' || !body) fail('bad date or body');
      const d = await tx('days', 'readwrite', async t => {
        const s = t.objectStore('days'), d = mergePatch((await req(s.get(b))) ?? {}, body);
        s.put(d, b);
        return d;
      });
      await dirty(dayPatchKeys(b, body));
      return d;
    }
    case 'POST days/:/bump': {
      if (c !== 'bump' || !DATE.test(b) || !COUNTS.has(body?.key) || !Number.isFinite(body?.by)) fail('bad date, key or amount');
      const d = await tx('days', 'readwrite', async t => { // read-modify-write inside one transaction: rapid taps can't lose updates
        const s = t.objectStore('days'), d = (await req(s.get(b))) ?? {};
        d[body.key] = Math.max(0, (d[body.key] ?? 0) + body.by);
        s.put(d, b);
        return d;
      });
      await dirty([`d|${b}|${body.key}`]);
      return d;
    }

    case 'GET photos': return (await items('photos')).map(withUrl);
    case 'POST photos': {
      if (!(body instanceof Blob) || !body.type.startsWith('image/')) fail('Send a photo');
      const date = url.searchParams.get('date') ?? '';
      const it = { id: newId(), kind: 'photos', blob: body, name: (url.searchParams.get('name') ?? '').slice(0, 80), date: DATE.test(date) ? date : ymd() };
      await tx('items', 'readwrite', t => req(t.objectStore('items').add(it)));
      await dirty([`i|${it.id}`]);
      return withUrl(it);
    }
    case 'DELETE photos/:': return remove('photos', +b);

    case 'GET capsules': return (await items('capsule')).map(capsule);
    case 'POST capsules': {
      const { text, days } = body ?? {};
      if (typeof text !== 'string' || !text.trim() || !Number.isInteger(days) || days < 1 || days > 3650) fail('Write something and pick when it opens');
      const it = { id: newId(), kind: 'capsule', text: text.slice(0, 5000), created: ymd(), opens: ymd(new Date(Date.now() + days * 864e5)) };
      await tx('items', 'readwrite', t => req(t.objectStore('items').add(it)));
      await dirty([`i|${it.id}`]);
      return capsule(it);
    }
    case 'DELETE capsules/:': return remove('capsule', +b);

    case 'GET settings': return settings();
    case 'PATCH settings': {
      const keys = Object.keys(body ?? {}).filter(k => k in DEFAULTS);
      await tx('settings', 'readwrite', t => { for (const k of keys) t.objectStore('settings').put(body[k], k); });
      await dirty(keys.map(k => `s|${k}`));
      return settings();
    }

    case 'GET weather': return weather();

    // backup: everything (photos inlined) in one JSON file, and back again
    case 'GET export': {
      const [days, set, all] = await tx(STORES, 'readonly', t => Promise.all([
        entries(t.objectStore('days')), entries(t.objectStore('settings')), req(t.objectStore('items').getAll())]));
      const its = await Promise.all(all.map(async ({ blob, ...it }) => (blob ? { ...it, image: await toDataUrl(blob) } : it)));
      return { app: 'orbit', version: 1, exported: ymd(), days, settings: set, items: its };
    }
    case 'POST import': {
      if (body?.app !== 'orbit' || typeof body.days !== 'object' || !Array.isArray(body.items)) fail('That file is not an Orbit backup');
      // decode images before the transaction — awaiting fetch inside it would let it auto-commit half-done
      const its = await Promise.all(body.items.map(async ({ image, ...it }: Item) => (image ? { ...it, blob: await (await fetch(image)).blob() } : it)));
      await tx(STORES, 'readwrite', t => {
        STORES.forEach(s => t.objectStore(s).clear());
        for (const [k, v] of Object.entries(body.days)) t.objectStore('days').put(v, k);
        for (const [k, v] of Object.entries(body.settings ?? {})) t.objectStore('settings').put(v, k);
        for (const it of its) t.objectStore('items').put(it);
      });
      urls.forEach(u => URL.revokeObjectURL(u));
      urls.clear();
      if (await meta('secret')) { await remapIds(); await enqueueAll(); } // a restore is a deliberate edit: it wins on sync
      return;
    }
  }
  return fail(`Unknown route ${route}`);
}
