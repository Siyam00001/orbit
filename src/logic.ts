// Pure logic shared by the UI and logic.check.ts — no React, no fetch.
export type Item = { id: number; [field: string]: any };
export type Count = 'velo' | 'dms' | 'apps' | 'replies' | 'spent' | 'earned';
export type Day = { habits?: Record<string, boolean>; mood?: number } & { [K in Count]?: number };
export type Settings = { name: string; city: string; startCash: number; veloLimit: number; notes: string };

export const HABITS = [
  ['move', '💪', 'Workout or 30-min walk'],
  ['dms', '✉️', '5–10 cold DMs'],
  ['apps', '📄', '3 job applications'],
  ['fiverr', '🟢', 'Check Fiverr inbox'],
  ['protein', '🥚', 'Protein every meal'],
  ['garden', '🌿', 'Check the garden'],
] as const;
export const COUNTERS = [['dms', '✉️', 'DMs sent'], ['apps', '📄', 'Applications'], ['replies', '💬', 'Replies']] as const;
export const TITLES = ['Rookie', 'Hustler', 'Builder', 'Shipper', 'Operator', 'Closer', 'Legend'];

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (s: string, n: number) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const pkr = (n: number) => 'Rs ' + Math.round(n).toLocaleString('en-PK');

export const doneCount = (d?: Day) => HABITS.filter(([id]) => d?.habits?.[id]).length;
const perfect = (d?: Day) => doneCount(d) === HABITS.length;

/** Consecutive perfect days; an unfinished today doesn't break the streak yet. */
export function streak(days: Record<string, Day>, today: string) {
  let d = perfect(days[today]) ? today : addDays(today, -1), n = 0;
  while (perfect(days[d])) { n++; d = addDays(d, -1); }
  return n;
}

/** A counter summed over the last 7 days, today included. */
export const weekTotal = (days: Record<string, Day>, k: Count, today: string) =>
  Array.from({ length: 7 }, (_, i) => days[addDays(today, -i)]?.[k] ?? 0).reduce((a, b) => a + b, 0);

/** Cash on hand and how many days it lasts at the recent spend rate. */
export function money(days: Record<string, Day>, startCash: number, today: string) {
  const entries = Object.entries(days);
  const cash = entries.reduce((a, [, d]) => a + (d.earned ?? 0) - (d.spent ?? 0), +startCash);
  const recent = entries.filter(([k, d]) => d.spent && daysBetween(k, today) >= 0 && daysBetween(k, today) < 30);
  const span = recent.length ? Math.max(...recent.map(([k]) => daysBetween(k, today))) + 1 : 0; // days of data, ≤30
  const spent = recent.reduce((a, [, d]) => a + d.spent!, 0);
  const month = entries.filter(([k]) => k.startsWith(today.slice(0, 7)));
  const sum = (k: Count) => month.reduce((a, [, d]) => a + (d[k] ?? 0), 0);
  return { cash, runway: spent ? Math.max(0, Math.floor(cash / (spent / span))) : Infinity, earned: sum('earned'), spent: sum('spent') };
}

/** Everything you do earns XP; level n starts at (n-1)² × 100. */
export function xp(days: Record<string, Day>, photos: number) {
  const total = Object.values(days).reduce((a, d) =>
    a + doneCount(d) * 10 + (d.mood ? 2 : 0) + (d.dms ?? 0) + (d.apps ?? 0) * 2 + (d.replies ?? 0) * 10, 0) + photos * 3;
  const level = Math.floor(Math.sqrt(total / 100)) + 1;
  const from = (level - 1) ** 2 * 100, to = level ** 2 * 100;
  return { total, level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], pct: (total - from) / (to - from), toNext: to - total };
}
