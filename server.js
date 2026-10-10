import express from 'express';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createServer as createVite } from 'vite';
import react from '@vitejs/plugin-react';

const PORT = process.env.PORT || 4321;
const KINDS = new Set(['jobs', 'money', 'body', 'plants']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULTS = { name: 'Siyam', city: 'Lahore', startCash: 0, veloLimit: 8, goalWeight: 0, notes: '' };

mkdirSync('data', { recursive: true });
const db = new DatabaseSync('data/orbit.db');
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

// items: one generic store for jobs / money / body / plants, updated with JSON merge-patch
app.param('kind', (req, res, next, kind) => KINDS.has(kind) ? next() : res.status(404).json({ error: 'unknown kind' }));
app.get('/api/items/:kind', (req, res) =>
  res.json(db.prepare('select * from items where kind = ? order by id desc').all(req.params.kind).map(row)));
app.post('/api/items/:kind', (req, res) => {
  if (!isObj(req.body)) return bad(res, 'body must be an object');
  const r = db.prepare('insert into items (kind, data) values (?, ?) returning *').get(req.params.kind, JSON.stringify(req.body));
  res.status(201).json(row(r));
});
app.patch('/api/items/:kind/:id', (req, res) => {
  if (!isObj(req.body)) return bad(res, 'body must be an object');
  const r = db.prepare('update items set data = json_patch(data, ?) where id = ? and kind = ? returning *')
    .get(JSON.stringify(req.body), Number(req.params.id), req.params.kind);
  r ? res.json(row(r)) : res.status(404).json({ error: 'not found' });
});
app.delete('/api/items/:kind/:id', (req, res) => {
  db.prepare('delete from items where id = ? and kind = ?').run(Number(req.params.id), req.params.kind);
  res.status(204).end();
});

// days: habits / mood / velo per date
app.get('/api/days', (req, res) =>
  res.json(Object.fromEntries(db.prepare('select * from days').all().map(r => [r.date, JSON.parse(r.data)]))));
app.patch('/api/days/:date', (req, res) => {
  if (!DATE.test(req.params.date) || !isObj(req.body)) return bad(res, 'bad date or body');
  const r = db.prepare(`insert into days (date, data) values (?, json_patch('{}', ?))
    on conflict (date) do update set data = json_patch(data, excluded.data) returning data`)
    .get(req.params.date, JSON.stringify(req.body));
  res.json(JSON.parse(r.data));
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
    const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`)).json();
    const p = geo.results?.[0];
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
const vite = await createVite({ plugins: [react()], server: { middlewareMode: true }, appType: 'spa' });
app.use(vite.middlewares);
app.listen(PORT, '127.0.0.1', () => console.log(`🪐 Orbit running → http://localhost:${PORT}`));
