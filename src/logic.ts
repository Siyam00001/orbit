// Pure logic shared by the UI and logic.check.ts — no React, no fetch.
export type Item = { id: number; [field: string]: any };
export type Count = 'velo' | 'dms' | 'apps' | 'replies' | 'spent' | 'earned' | 'cravings';
export type Day = { habits?: Record<string, boolean>; mood?: number; quest?: boolean } & { [K in Count]?: number };
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

// ── weekly boss fight: job-hunt counters deal damage, a new boss every Monday ──
export const BOSSES = [
  ['👻', 'The Ghoster', 40], ['🤖', 'ATS Bot 3000', 50], ['🐌', '"We\'ll get back to you"', 40], ['🧛', 'Unpaid Trial Vampire', 45],
  ['🦑', 'Recruiter Kraken', 60], ['🗿', 'Seen at 2pm', 45], ['🐉', 'The Hiring Freeze', 70], ['🎭', '"Exposure Pay" Client', 50],
] as const;
export const DAMAGE = { dms: 1, apps: 2, replies: 10 } as const;
const damage = (d?: Day) => (d?.dms ?? 0) * DAMAGE.dms + (d?.apps ?? 0) * DAMAGE.apps + (d?.replies ?? 0) * DAMAGE.replies;
export const mondayOf = (s: string) => addDays(s, -((new Date(s + 'T12:00').getDay() + 6) % 7));
const bossFor = (monday: string) => {
  const n = BOSSES.length, w = Math.floor(daysBetween('2026-01-05', monday) / 7); // 2026-01-05 is a Monday
  return BOSSES[((w % n) + n) % n];
};

export function boss(days: Record<string, Day>, today: string) {
  const monday = mondayOf(today), elapsed = daysBetween(monday, today);
  const dmg = Array.from({ length: elapsed + 1 }, (_, i) => damage(days[addDays(monday, i)])).reduce((a, b) => a + b, 0);
  const [emoji, name, hp] = bossFor(monday);
  return { emoji, name, hp, dmg, left: Math.max(0, hp - dmg), dead: dmg >= hp, daysLeft: 6 - elapsed };
}

export function bossesBeaten(days: Record<string, Day>) {
  const weeks: Record<string, number> = {};
  for (const [k, d] of Object.entries(days)) { const m = mondayOf(k); weeks[m] = (weeks[m] ?? 0) + damage(d); }
  return Object.entries(weeks).filter(([m, dmg]) => dmg >= bossFor(m)[2]).length;
}

// ── your world: a planet that mirrors the last 7 days ──
export function world(days: Record<string, Day>, today: string, photos: number, veloLimit: number) {
  const week = Array.from({ length: 7 }, (_, i) => doneCount(days[addDays(today, -i)]));
  return {
    health: week.reduce((a, b) => a + b, 0) / (7 * HABITS.length), // 0 barren … 1 lush
    moons: Math.min(streak(days, today), 7),
    trees: Math.min(photos, 14),
    smog: (days[today]?.velo ?? 0) > veloLimit,
    mood: days[today]?.mood ?? 0,
  };
}

// ── daily side quest: same quest all day, a new one tomorrow ──
export const QUESTS = [
  'Text an old friend you miss', 'Drink 2 glasses of water right now', '10-minute walk without your phone',
  'Stretch for 5 minutes', 'Eat one piece of fruit', 'Clean one small thing — just your desk',
  'Step outside and look at the sky for 2 minutes', 'Send someone a thank-you message', 'Learn one new AI trick and note it',
  'Water a plant and talk to it (seriously)', 'Call a family member', '20 push-ups, split up is fine',
  'In bed before 1am tonight', 'Write 3 things you\'re grateful for in Notes', 'Listen to one full album, no skipping',
  'Make chai for someone else', 'Post one thing you built on LinkedIn or X', 'Unfollow 5 accounts that drain you',
  'Photograph something beautiful', 'Ask someone how they\'re really doing',
];
export const questFor = (date: string) => QUESTS[(Math.imul(daysBetween('2026-01-01', date), 2654435761) >>> 0) % QUESTS.length];

/** XP one day earns — kept in one place so the level bar and the weekly recap agree. */
export const dayXp = (d: Day) => doneCount(d) * 10 + (d.mood ? 2 : 0) + (d.dms ?? 0) + (d.apps ?? 0) * 2
  + (d.replies ?? 0) * 10 + (d.cravings ?? 0) * 15 + (d.quest ? 20 : 0);

/** Last 7 days, today included, for the stories-style recap. */
export function wrapped(days: Record<string, Day>, photos: Item[], today: string, veloLimit: number) {
  const keys = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const ds = keys.map(k => days[k] ?? {});
  const sum = (k: Count) => ds.reduce((a, d) => a + (d[k] ?? 0), 0);
  const ticks = ds.map(doneCount), top = Math.max(...ticks);
  return {
    from: keys[0], ticks: ticks.reduce((a, b) => a + b, 0), perfect: ticks.filter(t => t === HABITS.length).length,
    best: top ? keys[ticks.indexOf(top)] : null, bestTicks: top,
    dms: sum('dms'), apps: sum('apps'), replies: sum('replies'), velo: sum('velo'), cravings: sum('cravings'),
    veloUnder: ds.filter(d => (d.velo ?? 0) <= veloLimit).length, quests: ds.filter(d => d.quest).length,
    photos: photos.filter(p => p.date >= keys[0] && p.date <= today), xp: ds.reduce((a, d) => a + dayXp(d), 0),
  };
}

/** Everything you do earns XP; level n starts at (n-1)² × 100. */
export function xp(days: Record<string, Day>, photos: number) {
  const total = Object.values(days).reduce((a, d) => a + dayXp(d), 0) + photos * 3 + bossesBeaten(days) * 100;
  const level = Math.floor(Math.sqrt(total / 100)) + 1;
  const from = (level - 1) ** 2 * 100, to = level ** 2 * 100;
  return { total, level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], pct: (total - from) / (to - from), toNext: to - total };
}
