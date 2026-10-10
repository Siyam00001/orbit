// Pure logic shared by the UI and logic.check.ts — no React, no fetch.
export type Item = { id: number; [field: string]: any };
export type Day = { habits?: Record<string, boolean>; mood?: number; velo?: number };
export type Settings = { name: string; city: string; startCash: number; veloLimit: number; goalWeight: number; notes: string };

export const HABITS = [
  ['move', '💪', 'Workout or 30-min walk'],
  ['dms', '✉️', '5–10 cold DMs'],
  ['apps', '📄', '3 job applications'],
  ['fiverr', '🟢', 'Check Fiverr inbox'],
  ['protein', '🥚', 'Protein every meal'],
  ['garden', '🌿', 'Check the garden'],
] as const;
export const STAGES = ['Sent', 'Replied', 'Call', 'Won', 'No'] as const;
const STAGE_XP: Record<string, number> = { Sent: 5, Replied: 20, Call: 40, Won: 150, No: 5 };
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

export const needsFollowUp = (j: Item, today: string) => j.stage === 'Sent' && daysBetween(j.date, today) >= 3;

/** 0 = just watered, ≥1 = due. */
export const thirst = (p: Item, today: string) => daysBetween(p.lastWatered, today) / Math.max(1, +p.every);

/** Cash on hand and how many days it lasts at the recent spend rate. */
export function money(entries: Item[], startCash: number, today: string) {
  const cash = entries.reduce((a, e) => a + (e.type === 'Income' ? 1 : -1) * +e.amount, +startCash);
  const recent = entries.filter(e => e.type === 'Expense' && daysBetween(e.date, today) >= 0 && daysBetween(e.date, today) < 30);
  const span = recent.length ? Math.max(...recent.map(e => daysBetween(e.date, today))) + 1 : 0; // days of data, ≤30
  const spent = recent.reduce((a, e) => a + +e.amount, 0);
  const month = entries.filter(e => e.date.startsWith(today.slice(0, 7)));
  const sum = (t: string) => month.filter(e => e.type === t).reduce((a, e) => a + +e.amount, 0);
  return { cash, runway: spent ? Math.max(0, Math.floor(cash / (spent / span))) : Infinity, income: sum('Income'), expense: sum('Expense') };
}

/** Everything you do earns XP; level n starts at (n-1)² × 100. */
export function xp(days: Record<string, Day>, jobs: Item[], plants: Item[], body: Item[]) {
  const total = Object.values(days).reduce((a, d) => a + doneCount(d) * 10 + (d.mood ? 2 : 0), 0)
    + jobs.reduce((a, j) => a + (STAGE_XP[j.stage] ?? 0), 0)
    + plants.reduce((a, p) => a + (+p.waterCount || 0) * 3, 0)
    + body.length * 5;
  const level = Math.floor(Math.sqrt(total / 100)) + 1;
  const from = (level - 1) ** 2 * 100, to = level ** 2 * 100;
  return { total, level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], pct: (total - from) / (to - from), toNext: to - total };
}
