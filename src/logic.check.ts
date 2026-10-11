// npm run check — fails loudly if the date/money/streak math breaks
import assert from 'node:assert/strict';
import { HABITS, QUESTS, SKILLS, learned, nextSkill, addDays, mergePatch, boss, bossesBeaten, dayXp, daysBetween, money, questFor, streak, weekTotal, world, wrapped, xp } from './logic.ts';

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

// 2026-10-12 is a Monday; damage counts Mon→today only
const b = boss({ '2026-10-11': { dms: 99 }, '2026-10-12': { dms: 5, apps: 3 }, '2026-10-14': { replies: 1 } }, '2026-10-14');
assert.equal(b.dmg, 5 + 6 + 10, 'last week does not count');
assert.equal(b.daysLeft, 4);
assert.equal(bossesBeaten({ '2026-10-12': { replies: 7 } }), 1, '70 dmg beats any boss');
assert.equal(bossesBeaten({ '2026-10-12': { dms: 3 } }), 0);

const w = world({ '2026-10-10': all, '2026-10-09': all }, '2026-10-10', 20, 8);
assert.ok(Math.abs(w.health - 2 / 7) < 1e-9);
assert.equal(w.moons, 2);
assert.equal(w.trees, 14, 'tree count capped');
assert.equal(world({ '2026-10-10': { velo: 9 } }, '2026-10-10', 0, 8).smog, true);

assert.equal(questFor('2026-10-11'), questFor('2026-10-11'), 'same quest all day');
assert.ok(QUESTS.includes(questFor('2027-03-05')));
assert.ok(new Set(Array.from({ length: 30 }, (_, i) => questFor(addDays('2026-10-01', i)))).size > 10, 'quests vary');

assert.equal(dayXp({ ...all, cravings: 2, quest: true }), 60 + 30 + 20);
const wr = wrapped({ '2026-10-10': { ...all, dms: 4, velo: 9 }, '2026-10-01': { dms: 50 } }, [{ id: 1, date: '2026-10-09' }, { id: 2, date: '2026-09-01' }], '2026-10-10', 8);
assert.equal(wr.dms, 4, 'only last 7 days');
assert.equal(wr.perfect, 1);
assert.equal(wr.best, '2026-10-10');
assert.equal(wr.veloUnder, 6);
assert.equal(wr.photos.length, 1);

assert.deepEqual(mergePatch({ habits: { a: true }, velo: 3, x: 1 }, { habits: { b: true }, x: null }), { habits: { a: true, b: true }, velo: 3 });
assert.deepEqual(mergePatch(undefined, { a: { b: null, c: 1 } }), { a: { c: 1 } });

assert.equal(new Set(SKILLS.map(s => s.id)).size, SKILLS.length, 'skill ids unique');
assert.equal(nextSkill({})?.id, 'prompts');
const sk = { '2026-10-09': { skills: ['prompts'] }, '2026-10-10': { skills: ['structured', 'tools'] } };
assert.deepEqual(learned(sk), { prompts: '2026-10-09', structured: '2026-10-10', tools: '2026-10-10' });
assert.equal(nextSkill(sk)?.id, 'embeddings');
assert.equal(nextSkill({ x: { skills: SKILLS.map(s => s.id) } }), null, 'roadmap complete');
assert.equal(dayXp({ skills: ['a', 'b'] }), 80);
assert.equal(world(sk, '2026-10-10', 0, 8).satellites, 3);

assert.equal(xp({}, 0).level, 1);
assert.equal(xp({ '2026-10-10': { ...all, replies: 15 } }, 0).level, 2); // 60 + 150 = 210 XP
console.log('✓ logic ok');
