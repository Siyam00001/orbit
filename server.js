import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer as createVite } from 'vite';

const PORT = process.env.PORT || 4321;
const DATA = process.env.ORBIT_DATA || join(import.meta.dirname, 'data');
const PHOTOS = join(DATA, 'photos');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IMAGE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const DEFAULTS = { name: 'Siyam', city: 'Lahore', startCash: 0, veloLimit: 8, notes: '' };

mkdirSync(PHOTOS, { recursive: true });
const db = new DatabaseSync(join(DATA, 'orbit.db'));
db.exec(`
  create table if not exists items (id integer primary key, kind text not null, data text not null, created text default (datetime('now')));
  create table if not exists days (date text primary key, data text not null);
  create table if not exists settings (key text primary key, value text not null);
`);

const row = r => ({ ...JSON.parse(r.data), id: r.id });
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const bad = (res, error) => res.status(400).json({ error });
const settings = () => ({ ...DEFAULTS, ...Object.fromEntries(db.prepare('select * from settings').all().map(r => [r.key, JSON.parse(r.value)])) });

const app = express();
app.use(express.json());
app.use('/photos', express.static(PHOTOS));

// garden photos: raw image body in, file on disk + row in items
app.get('/api/photos', (req, res) =>
  res.json(db.prepare(`select * from items where kind = 'photos' order by id desc`).all().map(row)));
app.post('/api/photos', express.raw({ type: 'image/*', limit: '20mb' }), (req, res) => {
  const ext = IMAGE[req.headers['content-type']];
  if (!ext || !req.body?.length) return bad(res, 'Send a JPG, PNG, WebP or GIF photo');
  const file = `${randomUUID()}.${ext}`;
  writeFileSync(join(PHOTOS, file), req.body);
  const data = { file, name: String(req.query.name ?? '').slice(0, 80), date: DATE.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10) };
  const r = db.prepare(`insert into items (kind, data) values ('photos', ?) returning *`).get(JSON.stringify(data));
  res.status(201).json(row(r));
});
app.delete('/api/photos/:id', (req, res) => {
  const r = db.prepare(`delete from items where id = ? and kind = 'photos' returning data`).get(Number(req.params.id));
  if (r) rmSync(join(PHOTOS, basename(JSON.parse(r.data).file)), { force: true });
  res.status(204).end();
});

// days: habits / mood / counters per date, merged with JSON merge-patch
app.get('/api/days', (req, res) =>
  res.json(Object.fromEntries(db.prepare('select * from days').all().map(r => [r.date, JSON.parse(r.data)]))));
app.patch('/api/days/:date', (req, res) => {
  if (!DATE.test(req.params.date) || !isObj(req.body)) return bad(res, 'bad date or body');
  // ?2 applied to the stored row directly, so null deletes a key (merge-patch semantics)
  const r = db.prepare(`insert into days (date, data) values (?1, json_patch('{}', ?2))
    on conflict (date) do update set data = json_patch(data, ?2) returning data`)
    .get(req.params.date, JSON.stringify(req.body));
  res.json(JSON.parse(r.data));
});

// counters increment server-side, so rapid taps never overwrite each other
const COUNTS = new Set(['velo', 'dms', 'apps', 'replies', 'spent', 'earned', 'cravings']);
app.post('/api/days/:date/bump', (req, res) => {
  const { key, by } = req.body ?? {};
  if (!DATE.test(req.params.date) || !COUNTS.has(key) || !Number.isFinite(by)) return bad(res, 'bad date, key or amount');
  const r = db.prepare(`insert into days (date, data) values (?1, json_object(?2, max(0, ?3)))
    on conflict (date) do update set data = json_set(data, '$.' || ?2, max(0, coalesce(json_extract(data, '$.' || ?2), 0) + ?3))
    returning data`).get(req.params.date, key, by);
  res.json(JSON.parse(r.data));
});

// time capsules: the server withholds the text until the open date, so there's no peeking
const localDate = (d = new Date()) => d.toLocaleDateString('en-CA');
const capsule = c => { const open = c.opens <= localDate(); return { ...c, open, text: open ? c.text : null }; };
app.get('/api/capsules', (req, res) =>
  res.json(db.prepare(`select * from items where kind = 'capsule' order by id desc`).all().map(row).map(capsule)));
app.post('/api/capsules', (req, res) => {
  const { text, days } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim() || !Number.isInteger(days) || days < 1 || days > 3650) return bad(res, 'Write something and pick when it opens');
  const data = { text: text.slice(0, 5000), created: localDate(), opens: localDate(new Date(Date.now() + days * 864e5)) };
  res.status(201).json(capsule(row(db.prepare(`insert into items (kind, data) values ('capsule', ?) returning *`).get(JSON.stringify(data)))));
});
app.delete('/api/capsules/:id', (req, res) => {
  db.prepare(`delete from items where id = ? and kind = 'capsule'`).run(Number(req.params.id));
  res.status(204).end();
});

app.get('/api/settings', (req, res) => res.json(settings()));
app.patch('/api/settings', (req, res) => {
  if (!isObj(req.body)) return bad(res, 'body must be an object');
  const up = db.prepare('insert into settings values (?, ?) on conflict (key) do update set value = excluded.value');
  for (const [k, v] of Object.entries(req.body)) if (k in DEFAULTS) up.run(k, JSON.stringify(v));
  res.json(settings());
});

// weather via Open-Meteo (free, no key), cached 30 min
let wx = { at: 0, city: '', data: null };
app.get('/api/weather', async (req, res) => {
  const { city } = settings();
  if (wx.city === city && Date.now() - wx.at < 30 * 60e3) return res.json(wx.data);
  try {
    // fuzzy search ranks e.g. "Santa Catarina Tlaxila" (Mexico) above "Taxila" (Pakistan): prefer an exact name match
    const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=10&name=${encodeURIComponent(city)}`)).json();
    const p = geo.results?.find(r => r.name.toLowerCase() === city.trim().toLowerCase()) ?? geo.results?.[0];
    if (!p) return res.status(404).json({ error: `city "${city}" not found` });
    const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}` +
      '&current=temperature_2m,weather_code&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1')).json();
    wx = { at: Date.now(), city, data: {
      city: p.name, temp: Math.round(f.current.temperature_2m), code: f.current.weather_code,
      rain: f.daily.precipitation_probability_max[0] ?? 0, hi: Math.round(f.daily.temperature_2m_max[0]), lo: Math.round(f.daily.temperature_2m_min[0]),
    } };
    res.json(wx.data);
  } catch {
    res.status(502).json({ error: 'weather unavailable' });
  }
});

// ponytail: Vite middleware serves the UI from this same process; add `vite build` + express.static if it's ever deployed
const vite = await createVite({ root: import.meta.dirname, server: { middlewareMode: true }, appType: 'spa' }); // plugins: vite.config.js
app.use(vite.middlewares);
app.listen(PORT, '127.0.0.1', () => console.log(`🪐 Orbit running → http://localhost:${PORT}`));
