// Run: node merge.test.mjs — checks the two-device merge rule and the muscle-map word mapping.
import assert from 'node:assert';
import { merge } from './store.js';
const phone  = { id: 'a', name: 'Mika', color: '#ffe600', u: 1, seen: 50, checks: { w0d0i0: { v: 1, t: 10 }, w0d1i0: { v: 1, t: 5 } } };
const laptop = { id: 'a', name: 'Mikhail', color: '#ff4d4d', u: 2, seen: 40, checks: { w0d1i0: { v: 0, t: 9 }, w0d2i0: { v: 1, t: 1 } } };
const m = merge(phone, laptop);
assert.equal(m.name, 'Mikhail', 'newer profile wins');
assert.equal(m.seen, 50, 'latest seen kept');
assert.ok(m.checks.w0d0i0.v && m.checks.w0d2i0.v, 'ticks from both devices kept');
assert.equal(m.checks.w0d1i0.v, 0, 'newer untick wins');
assert.deepEqual(merge(laptop, phone), m, 'order does not matter');
assert.deepEqual(merge(m, phone), m, 'idempotent');
assert.equal(merge(undefined, phone), phone);
console.log('merge ok');

import { lastKg, kgHistory } from './store.js';
const log = { '2026-10-06|kg:lat-pulldown': { v: 30 }, '2026-10-13|kg:lat-pulldown': { v: 32.5 }, '2026-10-10|kg:lat-pulldown': { v: 0 },
  '2026-10-08|kg:lat-pulldown-light': { v: 10 }, '2026-10-20|kg:lat-pulldown': { v: 35 } };
assert.deepEqual(lastKg(log, '2026-10-20', 'lat-pulldown'), { date: '2026-10-13', kg: 32.5 }, 'latest earlier day, cleared days skipped');
assert.equal(lastKg(log, '2026-10-06', 'lat-pulldown'), null, 'nothing before the first log');
assert.deepEqual(lastKg(log, '2026-10-09', 'lat-pulldown'), { date: '2026-10-06', kg: 30 }, 'other exercise with same prefix ignored');
assert.equal(lastKg({ '2026-10-01|kg:x': { v: '<img onerror=alert(1)>' } }, '2026-10-02', 'x'), null, 'non-numbers never come back');
assert.deepEqual(kgHistory(log, 'lat-pulldown', '2026-10-13').map(p => p.kg), [30, 32.5], 'history: oldest first, up to the day, no cleared entries');
assert.deepEqual(kgHistory({ '2026-10-01|kg:x': { v: 'bad' }, '2026-10-02|kg:x': { v: Infinity } }, 'x', '2026-12-31'), [], 'history drops non-numbers');
console.log('kg ok');

import { groupsOf } from './muscles.js';
assert.deepEqual(groupsOf('Biceps, Brachialis, Forearms'), ['biceps', 'forearms'], 'Forearms is not Arms');
assert.deepEqual(groupsOf('Medial + Rear Delt'), ['shoulders', 'reardelts']);
assert.deepEqual(groupsOf('Lats, Rhomboids, Traps, Biceps'), ['lats', 'traps', 'biceps']);
assert.deepEqual(groupsOf('Achilles Tendon, Calves'), ['calves']);
assert.deepEqual(groupsOf('Lower Abs, Hip Flexors'), ['abs', 'hipflexors'], 'Hip flexors are their own group');
console.log('muscles ok');
