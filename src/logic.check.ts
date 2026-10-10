// npm run check — fails loudly if the date/money/streak math breaks
import assert from 'node:assert/strict';
import { HABITS, addDays, daysBetween, streak, needsFollowUp, thirst, money, xp } from './logic.ts';

assert.equal(addDays('2026-03-31', 1), '2026-04-01');
assert.equal(daysBetween('2026-10-01', '2026-10-04'), 3);

const all = { habits: Object.fromEntries(HABITS.map(([id]) => [id, true])) };
assert.equal(streak({ '2026-10-08': all, '2026-10-09': all }, '2026-10-10'), 2, 'unfinished today keeps streak');
assert.equal(streak({ '2026-10-09': all, '2026-10-10': all }, '2026-10-10'), 2);
assert.equal(streak({ '2026-10-08': all }, '2026-10-10'), 0, 'gap breaks streak');

assert.ok(needsFollowUp({ id: 1, stage: 'Sent', date: '2026-10-07' }, '2026-10-10'));
assert.ok(!needsFollowUp({ id: 1, stage: 'Replied', date: '2026-10-01' }, '2026-10-10'));
assert.equal(thirst({ id: 1, lastWatered: '2026-10-08', every: '2' }, '2026-10-10'), 1);

const m = money([
  { id: 1, type: 'Income', amount: '5000', date: '2026-10-01' },
  { id: 2, type: 'Expense', amount: '1000', date: '2026-10-01' },
], 10000, '2026-10-10');
assert.equal(m.cash, 14000);
assert.equal(m.runway, 140, '1000 over 10 days = 100/day');
assert.equal(money([], 500, '2026-10-10').runway, Infinity);

assert.equal(xp({}, [], [], []).level, 1);
assert.equal(xp({ '2026-10-10': all }, [{ id: 1, stage: 'Won' }], [], []).level, 2); // 60 + 150 = 210 XP; level 3 starts at 400
console.log('✓ logic ok');
