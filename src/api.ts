// One API surface, two backends: the Express server (laptop, `npm start`) or IndexedDB on the
// device (phone app, `npm run build:app`). Routes and validation mirror server.js exactly.
import { mergePatch, ymd, type Item } from './logic.ts';

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
  const r = indexedDB.open('orbit', 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore('days');
    r.result.createObjectStore('settings');
    r.result.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Run fn inside one transaction and resolve only once it has committed. */
async function tx<T>(stores: string | string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const t = (await db()).transaction(stores, mode);
  const done = new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  const out = await fn(t);
  await done;
  return out;
}
const entries = (s: IDBObjectStore) => Promise.all([req(s.getAllKeys()), req(s.getAll())])
  .then(([k, v]) => Object.fromEntries(k.map((key, i) => [key, v[i]])));

const fail = (msg: string): never => { throw new Error(msg); };
const items = (kind: string) => tx('items', 'readonly', t => req(t.objectStore('items').getAll()))
  .then(all => all.filter(i => i.kind === kind).reverse());
const settings = () => tx('settings', 'readonly', t => entries(t.objectStore('settings'))).then(s => ({ ...DEFAULTS, ...s }));
const capsule = (c: Item) => { const open = c.opens <= ymd(); return { ...c, open, text: open ? c.text : null }; };

const urls = new Map<number, string>(); // one object URL per photo, reused across reloads
const withUrl = ({ blob, ...p }: Item) => { if (!urls.has(p.id)) urls.set(p.id, URL.createObjectURL(blob)); return { ...p, url: urls.get(p.id) }; };

async function remove(kind: string, id: number) {
  await tx('items', 'readwrite', async t => {
    const s = t.objectStore('items'), it = await req(s.get(id));
    if (it?.kind === kind) s.delete(id);
  });
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)!); urls.delete(id); }
}

let wx: { at: number; city: string; data: unknown } = { at: 0, city: '', data: null };
async function weather() {
  const { city } = await settings();
  if (wx.city === city && Date.now() - wx.at < 30 * 60e3) return wx.data;
  const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`)).json();
  const p = geo.results?.[0] ?? fail(`city "${city}" not found`);
  const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}` +
    '&current=temperature_2m,weather_code&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1')).json();
  wx = { at: Date.now(), city, data: {
    city: p.name, temp: Math.round(f.current.temperature_2m), code: f.current.weather_code,
    rain: f.daily.precipitation_probability_max[0] ?? 0, hi: Math.round(f.daily.temperature_2m_max[0]), lo: Math.round(f.daily.temperature_2m_min[0]),
  } };
  return wx.data;
}

const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

async function local(path: string, method: string, body: any): Promise<unknown> {
  const url = new URL(path, 'http://local');
  const [, a, b, c] = url.pathname.split('/'); // e.g. /days/2026-10-11/bump
  const route = `${method} ${a}${b ? '/:' : ''}${c ? `/${c}` : ''}`;
  switch (route) {
    case 'GET days': return tx('days', 'readonly', t => entries(t.objectStore('days')));
    case 'PATCH days/:':
      if (!DATE.test(b) || typeof body !== 'object' || !body) fail('bad date or body');
      return tx('days', 'readwrite', async t => {
        const s = t.objectStore('days'), d = mergePatch((await req(s.get(b))) ?? {}, body);
        s.put(d, b);
        return d;
      });
    case 'POST days/:/bump':
      if (c !== 'bump' || !DATE.test(b) || !COUNTS.has(body?.key) || !Number.isFinite(body?.by)) fail('bad date, key or amount');
      return tx('days', 'readwrite', async t => { // read-modify-write inside one transaction: rapid taps can't lose updates
        const s = t.objectStore('days'), d = (await req(s.get(b))) ?? {};
        d[body.key] = Math.max(0, (d[body.key] ?? 0) + body.by);
        s.put(d, b);
        return d;
      });

    case 'GET photos': return (await items('photos')).map(withUrl);
    case 'POST photos': {
      if (!(body instanceof Blob) || !body.type.startsWith('image/')) fail('Send a photo');
      const date = url.searchParams.get('date') ?? '';
      const it = { kind: 'photos', blob: body, name: (url.searchParams.get('name') ?? '').slice(0, 80), date: DATE.test(date) ? date : ymd() };
      const id = await tx('items', 'readwrite', t => req(t.objectStore('items').add(it)));
      return withUrl({ ...it, id: id as number });
    }
    case 'DELETE photos/:': return remove('photos', +b);

    case 'GET capsules': return (await items('capsule')).map(capsule);
    case 'POST capsules': {
      const { text, days } = body ?? {};
      if (typeof text !== 'string' || !text.trim() || !Number.isInteger(days) || days < 1 || days > 3650) fail('Write something and pick when it opens');
      const it = { kind: 'capsule', text: text.slice(0, 5000), created: ymd(), opens: ymd(new Date(Date.now() + days * 864e5)) };
      const id = await tx('items', 'readwrite', t => req(t.objectStore('items').add(it)));
      return capsule({ ...it, id: id as number });
    }
    case 'DELETE capsules/:': return remove('capsule', +b);

    case 'GET settings': return settings();
    case 'PATCH settings':
      await tx('settings', 'readwrite', t => {
        for (const [k, v] of Object.entries(body ?? {})) if (k in DEFAULTS) t.objectStore('settings').put(v, k);
      });
      return settings();

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
      return;
    }
  }
  return fail(`Unknown route ${route}`);
}
