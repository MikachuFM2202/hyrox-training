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

import { groupsOf } from './muscles.js';
assert.deepEqual(groupsOf('Biceps, Brachialis, Forearms'), ['biceps', 'forearms'], 'Forearms is not Arms');
assert.deepEqual(groupsOf('Medial + Rear Delt'), ['shoulders', 'reardelts']);
assert.deepEqual(groupsOf('Lats, Rhomboids, Traps, Biceps'), ['lats', 'traps', 'biceps']);
assert.deepEqual(groupsOf('Achilles Tendon, Calves'), ['calves']);
console.log('muscles ok');
