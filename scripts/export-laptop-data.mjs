// One-time: turn the laptop server's data (data/orbit.db + data/photos) into an Orbit backup file
// that the web/phone app can Restore (⚙️ → Restore), so it can join sync.
// usage: node --disable-warning=ExperimentalWarning scripts/export-laptop-data.mjs
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const DATA = join(import.meta.dirname, '..', 'data');
const OUT = join(process.env.USERPROFILE, 'Downloads', 'orbit-laptop-backup.json');
const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

const db = new DatabaseSync(join(DATA, 'orbit.db'), { readOnly: true });
const days = Object.fromEntries(db.prepare('SELECT date, data FROM days').all().map(r => [r.date, JSON.parse(r.data)]));
const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, JSON.parse(r.value)]));
const items = db.prepare('SELECT id, kind, data FROM items').all().flatMap(r => {
  const d = JSON.parse(r.data);
  if (r.kind === 'capsule') return [{ id: r.id, kind: 'capsule', text: d.text, created: d.created, opens: d.opens }];
  if (r.kind !== 'photos') return [];
  const file = join(DATA, 'photos', d.file);
  if (!existsSync(file)) { console.warn('missing photo file, skipped:', d.file); return []; }
  const image = `data:${MIME[extname(d.file)] ?? 'image/jpeg'};base64,${readFileSync(file).toString('base64')}`;
  return [{ id: r.id, kind: 'photos', name: d.name ?? '', date: d.date, image }];
});

writeFileSync(OUT, JSON.stringify({ app: 'orbit', version: 1, exported: new Date().toISOString().slice(0, 10), days, settings, items }));
console.log(`wrote ${OUT}: ${Object.keys(days).length} days, ${Object.keys(settings).length} settings, ${items.length} photos/letters`);
