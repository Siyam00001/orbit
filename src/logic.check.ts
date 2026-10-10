// npm run check — fails loudly if the date/money/streak math breaks
import assert from 'node:assert/strict';
import { HABITS, addDays, daysBetween, streak, weekTotal, money, xp } from './logic.ts';

assert.equal(addDays('2026-03-31', 1), '2026-04-01');
assert.equal(daysBetween('2026-10-01', '2026-10-04'), 3);

const all = { habits: Object.fromEntries(HABITS.map(([id]) => [id, true])) };
assert.equal(streak({ '2026-10-08': all, '2026-10-09': all }, '2026-10-10'), 2, 'unfinished today keeps streak');
assert.equal(streak({ '2026-10-09': all, '2026-10-10': all }, '2026-10-10'), 2);
assert.equal(streak({ '2026-10-08': all }, '2026-10-10'), 0, 'gap breaks streak');

assert.equal(weekTotal({ '2026-10-03': { dms: 9 }, '2026-10-05': { dms: 2 }, '2026-10-10': { dms: 3 } }, 'dms', '2026-10-10'), 5, 'only last 7 days');

const m = money({ '2026-10-01': { earned: 5000, spent: 1000 } }, 10000, '2026-10-10');
assert.equal(m.cash, 14000);
assert.equal(m.runway, 140, '1000 over 10 days = 100/day');
assert.equal(money({}, 500, '2026-10-10').runway, Infinity);

assert.equal(xp({}, 0).level, 1);
assert.equal(xp({ '2026-10-10': { ...all, replies: 15 } }, 0).level, 2); // 60 + 150 = 210 XP
console.log('✓ logic ok');
