// -----------------------------------------------------------------------------
// The answers of a real Eco-Devices 3 (cce66's, firmware 1.3.0), replayed:
// the MAC with dashes as the identity, a `core_logger` of 26 entries numbered
// by their `_id`, the units (Wh, mL), the counters 11 to 24 held without the
// clamp links, and with his `object/ed3` (post 9): every counter named after
// the clamp or pulse input feeding it, the clamp power in W. See
// test/fixtures/cce66-ed3.js.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macId } from '../src/app.js';
import { counterKind } from '../src/constants.js';
import { parseCounters, parseEd3, parseMac } from '../src/ed3/model.js';
import { memoryStore } from '../src/store.js';
import { fakeEd3 } from './helpers/fakeEd3.js';
import { CONFIG, F, MINUTE, SALT, boundMemory, created, setup } from './helpers/app.js';
import {
  CORE_LOGGER,
  HELD,
  LINKS,
  MISSING,
  OBJECT_ED3,
  REAL_MAC,
  REAL_MAC_NORMALIZED,
  SYSTEM_INFO,
} from './fixtures/cce66-ed3.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const discovered = (gladys) => (gladys.fake.discoveredDevices ?? []).map((d) => d.external_id);
const last = (gladys, code) => gladys.fake.lastState(F('counter', code, 'index'));

/** A fake ED3 answering cce66's `system/info` and `core_logger`; no `ID_Logger_tore` (not given). */
function realEd3() {
  const world = fakeEd3({ mac: REAL_MAC });
  world.loggers = null;
  world.answers.set('system/info', SYSTEM_INFO);
  world.answers.set('object/core_logger?option=filter_state', CORE_LOGGER);
  return world;
}

/** The ED3 of the tests, bound by the MAC as the integration keeps it (lower case, colons). */
const boundStore = () => {
  const store = memoryStore();
  store.data = boundMemory(CONFIG, REAL_MAC_NORMALIZED);
  return store;
};

test('cce66: the MAC of system/info (dashes, upper case) is read; the firmware text is not used', () => {
  assert.equal(parseMac(SYSTEM_INFO), REAL_MAC_NORMALIZED);
  assert.equal(parseMac({ ...SYSTEM_INFO, macAdress: ` ${REAL_MAC} ` }), REAL_MAC_NORMALIZED);
  assert.equal(parseMac({ ...SYSTEM_INFO, macAdress: 'XX-X4-X3-31-X1-X8' }), undefined, 'masked');
  assert.equal(SYSTEM_INFO.firmwareVersion, '1.3.0 ', 'the fixture keeps the trailing space');
});

test('cce66: 26 counters, numbered by their _id (never their place); units Wh and mL', () => {
  assert.equal(CORE_LOGGER.length, 26);
  const { targets, skipped } = parseCounters(CORE_LOGGER, undefined, new Set());
  const value = (n) => targets.get(`c${n}`)?.value;
  assert.equal(value(0), 132533.861, 'Wh -> kWh');
  assert.equal(value(11), 3293.592);
  assert.equal(value(19), 122.117, 'the 18th entry is counter 19 (851987), not counter 17');
  assert.equal(value(20), 439.831);
  assert.equal(value(23), 274.442);
  assert.equal(value(25), 60.707, 'mL -> m³ (60 707 000 mL)');
  assert.equal(targets.get('c25').counter, counterKind(25));
  for (const n of MISSING) assert.equal(targets.has(`c${n}`), false, `C${n} is not in the list`);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 26, 28, 29]) {
    assert.equal(targets.get(`c${n}`)?.idle, true, `C${n} at 0: not offered`);
    assert.equal(value(n), undefined, `C${n} at 0: no value`);
  }
  assert.deepEqual(skipped, []);
  assert.equal(targets.size, 26);
  // The same entries in another order: the same counters.
  const shuffled = parseCounters([...CORE_LOGGER].reverse(), undefined, new Set());
  for (const [code, target] of targets)
    assert.equal(shuffled.targets.get(code)?.value, target.value);
});

test('cce66: without ID_Logger_tore, the counters 11 to 24 holding an index are held, named', () => {
  const ed3 = parseEd3({
    Relay_state: [false, false],
    puissance: [0, 0, 0, 0, 0, 0, 0, 0],
    urms: 236,
  });
  assert.equal(ed3.linksRead, false);
  const { targets, skipped } = parseCounters(CORE_LOGGER, undefined, ed3.held, ed3.sources);
  assert.deepEqual(skipped, HELD);
  for (let n = 11; n <= 24; n += 1) assert.equal(targets.has(`c${n}`), false, `C${n}`);
  assert.equal(targets.get('c0').value, 132533.861);
  assert.equal(targets.get('c25').value, 60.707);
});

test('cce66 end to end, new install: owner by the MAC with dashes; C0 and C25 offered, the rest not', async (t) => {
  const world = realEd3();
  const { app, gladys, start, store } = await setup({ world, fresh: true });
  t.after(() => app.stop());
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, true, message(gladys));
  assert.deepEqual(store.data.owner.kind, 'mac');
  assert.equal(store.data.owner.id, macId(SALT, REAL_MAC_NORMALIZED));
  assert.doesNotMatch(JSON.stringify(store.data), /a3:31|A3-31/i, 'the MAC is never kept in clear');
  const ids = discovered(gladys);
  assert.ok(ids.includes('ext:ed3:counter:c0'), ids.join(' '));
  assert.ok(ids.includes('ext:ed3:counter:c25'));
  for (let n = 1; n <= 29; n += 1) {
    if (n === 25) continue;
    assert.ok(!ids.includes(`ext:ed3:counter:c${n}`), `C${n} not offered`);
  }
  assert.match(
    message(gladys),
    /C11, C12, C13, C15, C16 and 5 more not offered: this ED3 does not/,
  );
  assert.match(message(gladys, 'fr'), /C11, C12, C13, C15, C16 et 5 autre\(s\) non proposés/);
  assert.match(message(gladys), /2 counter\(s\)/, 'C0 and C25');
});

test('cce66 end to end, devices bound by the MAC: values in kWh and m³; a list of 30 later shifts nothing', async (t) => {
  const devices = [created('counter', 'c0'), created('counter', 'c25'), created('counter', 'c18')];
  const world = realEd3();
  const { app, gladys, start, wait, store } = await setup({ devices, world, store: boundStore() });
  t.after(() => app.stop());
  await start();
  await app.flush();
  assert.equal(gladys.fake.connectionStatus.connected, true, message(gladys));
  assert.doesNotMatch(message(gladys), /not the one|n’est pas celui/);
  assert.equal(last(gladys, 'c0'), 132533.861);
  assert.equal(last(gladys, 'c25'), 60.707);
  assert.equal(last(gladys, 'c18'), undefined, 'C18 is not in his list: nothing published');
  assert.equal(store.data.indexes.c0.last.value, 132533.861);
  // A later answer with the 30 entries (C18 back at 0), the indexes moved a little.
  world.answers.set('object/core_logger?option=filter_state', () => {
    const full = CORE_LOGGER.map((e) => ({ ...e }));
    for (const n of MISSING) full.push({ ...full[1], _id: 851968 + n });
    full.sort((a, b) => a._id - b._id);
    full[0].index += 143;
    full[25].index += 12_000;
    return full;
  });
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c0'), 132534.004);
  assert.equal(last(gladys, 'c25'), 60.719);
  assert.equal(last(gladys, 'c18'), undefined, 'at 0: never published');
  assert.doesNotMatch(message(gladys), /held back/);
});

// --- post 9: his `object/ed3`, the clamp and pulse links -----------------------------------

test('cce66 object/ed3: every counter linked to its clamp (positive / negative) or pulse input', () => {
  const ed3 = parseEd3(OBJECT_ED3);
  assert.equal(ed3.linksRead, true);
  assert.deepEqual([...ed3.held], [], 'the links read: nothing held');
  for (const [n, from, input, negative, name] of LINKS) {
    assert.deepEqual(ed3.sources.get(n), { from, input, negative, name }, `C${n}`);
  }
  assert.equal(ed3.sources.size, LINKS.length);
  assert.equal(ed3.sources.has(0), false, 'the teleinfo has no input');
  // Every clamp feeds a counter (T2, T3, T5: their negative one only; T8: its positive one).
  for (let n = 1; n <= 8; n += 1) assert.ok(ed3.targets.has(`t${n}`), `T${n}`);
  assert.equal(ed3.targets.get('t1').name, 'T1-EDF');
  assert.equal(ed3.targets.get('t7').name, 'T7-Batterie +');
  assert.equal(ed3.targets.get('mains').value, 235.5);
});

test('cce66 object/ed3: puissance is mW (irms mA x urms V x cosphi %), published in W, signed', () => {
  const ed3 = parseEd3(OBJECT_ED3);
  const watts = [1455.5, -13.2, 0, 0, -12.6, 0, -63.8, -67];
  watts.forEach((w, i) => assert.equal(ed3.targets.get(`t${i + 1}`).value, w, `T${i + 1}`));
  // His values hold together: P (mW) = Irms (mA) x U (V) x cos phi (%) / 100, within 0.5 %.
  OBJECT_ED3.puissance.forEach((mw, i) => {
    const computed = (Number(OBJECT_ED3.irms[i]) * OBJECT_ED3.urms * OBJECT_ED3.cosphi[i]) / 100;
    assert.ok(
      Math.abs(mw - computed) <= Math.max(5, Math.abs(mw) * 0.005),
      `T${i + 1}: ${mw} ~ ${computed}`,
    );
  });
});

test('cce66 object/ed3: the clamp counters are published in kWh (Wh), named after their input', () => {
  const ed3 = parseEd3(OBJECT_ED3);
  const { targets, skipped } = parseCounters(CORE_LOGGER, undefined, ed3.held, ed3.sources);
  assert.deepEqual(skipped, []);
  assert.equal(targets.get('c11').value, 3293.592, 'T1-EDF: 3 293 592 Wh');
  assert.equal(targets.get('c19').value, 122.117, 'T1-EDF negative: injection');
  assert.equal(targets.get('c23').value, 274.442);
  assert.equal(targets.get('c25').value, 60.707, 'water still in m³');
  assert.equal(targets.get('c11').source.name, 'T1-EDF');
  assert.equal(targets.get('c19').source.negative, true);
  assert.equal(targets.get('c14').idle, true, 'T4-Load at 0: not offered');
});

test('format guard: links of another form (firmware) are never guessed: counters 11 to 24 held', () => {
  const variants = {
    'counter numbers, not _id': { ID_Logger_tore: [11, 0, 0, 14, 0, 20, 22, 16] },
    'ten entries': { ID_Logger_tore: [...OBJECT_ED3.ID_Logger_tore, 0, 0] },
    'seven entries': { ID_Logger_tore: OBJECT_ED3.ID_Logger_tore.slice(0, 7) },
    'a text': { ID_Logger_tore: ['851979', 0, 0, 0, 0, 0, 0, 0] },
    'null inside': { ID_Logger_tore: [851979, null, 0, 0, 0, 0, 0, 0] },
    'an object': { ID_Logger_tore: { 0: 851979 } },
    'an _id beyond the counters': { ID_Logger_tore: [851968 + 30, 0, 0, 0, 0, 0, 0, 0] },
    'the negative list of another form': { ID_Logger_tore_neg: [19, 12, 13, 0, 15, 17, 23, 0] },
    'the negative list too short': { ID_Logger_tore_neg: [851987] },
    absent: { ID_Logger_tore: undefined },
  };
  for (const [what, change] of Object.entries(variants)) {
    const ed3 = parseEd3({ ...OBJECT_ED3, ...change });
    assert.equal(ed3.linksRead, false, what);
    assert.equal(ed3.sources.size, 0, what);
    const { targets, skipped } = parseCounters(CORE_LOGGER, undefined, ed3.held, ed3.sources);
    assert.deepEqual(skipped, HELD, what);
    for (let n = 11; n <= 24; n += 1) assert.equal(targets.has(`c${n}`), false, `${what}: C${n}`);
    assert.equal(targets.get('c0').value, 132533.861, what);
    assert.equal(targets.get('c25').value, 60.707, what);
    assert.equal(targets.get('c25').source, undefined, `${what}: no pulse name either`);
  }
});

test('format guard: GCE example (no negative list), pulse list of another form, a counter twice', () => {
  // GCE's example answer has no `ID_Logger_tore_neg` (an older firmware): the links are read.
  const { ID_Logger_tore_neg: _drop, ...older } = OBJECT_ED3;
  const gce = parseEd3(older);
  assert.equal(gce.linksRead, true);
  assert.equal(gce.sources.get(11).name, 'T1-EDF');
  assert.equal(gce.sources.has(19), false);
  assert.ok(gce.targets.has('t8') && !gce.targets.has('t2'), 'T2 feeds no counter there');
  // A pulse list of another form: no pulse names, the clamp counters not held (see the
  // 0.2.1 tests below for the electricity counters no clamp feeds).
  const pulse = parseEd3({ ...OBJECT_ED3, ID_Logger_pulse: [25, 26, 28, 29] });
  assert.equal(pulse.linksRead, true);
  assert.equal(pulse.held.size, 0);
  assert.equal(pulse.sources.has(25), false);
  assert.equal(pulse.sources.get(11).name, 'T1-EDF');
  // One counter listed twice (two clamps, or both directions): its source is ambiguous.
  const twice = parseEd3({
    ...OBJECT_ED3,
    ID_Logger_tore_neg: [851979, 851980, 851981, 0, 851983, 851985, 851991, 0],
  });
  assert.equal(twice.linksRead, true);
  assert.equal(twice.sources.has(11), false);
  assert.equal(twice.sources.has(12), true);
  // All zeros: no clamp offered, nothing held.
  const none = parseEd3({
    ...OBJECT_ED3,
    ID_Logger_tore: [0, 0, 0, 0, 0, 0, 0, 0],
    ID_Logger_tore_neg: [0, 0, 0, 0, 0, 0, 0, 0],
  });
  assert.equal(none.linksRead, true);
  assert.equal(
    [...none.targets.keys()].some((c) => c.startsWith('t')),
    false,
  );
});

test('cce66 end to end with his object/ed3: clamp counters offered by name, published in kWh', async (t) => {
  const devices = [
    created('counter', 'c11'),
    created('counter', 'c19'),
    created('clamp', 't1'),
    created('clamp', 't7'),
  ];
  const world = realEd3();
  world.answers.set('object/ed3/0', OBJECT_ED3);
  const { app, gladys, start, store } = await setup({ devices, world, store: boundStore() });
  t.after(() => app.stop());
  await start();
  await app.flush();
  assert.equal(gladys.fake.connectionStatus.connected, true, message(gladys));
  assert.doesNotMatch(message(gladys), /not offered/);
  assert.equal(last(gladys, 'c11'), 3293.592);
  assert.equal(last(gladys, 'c19'), 122.117);
  assert.equal(gladys.fake.lastState(F('clamp', 't1', 'power')), 1455.5);
  assert.equal(gladys.fake.lastState(F('clamp', 't7', 'power')), -63.8);
  const list = gladys.fake.discoveredDevices ?? [];
  const nameOf = (code) => list.find((d) => d.external_id.endsWith(`:${code}`))?.name;
  const ids = list.map((d) => d.external_id);
  for (const n of [0, 11, 12, 13, 15, 16, 17, 19, 20, 22, 23, 25]) {
    assert.ok(ids.includes(`ext:ed3:counter:c${n}`), `C${n} offered`);
  }
  for (const n of [14, 26, 28, 29]) assert.ok(!ids.includes(`ext:ed3:counter:c${n}`), `C${n} at 0`);
  assert.equal(nameOf('c11'), 'Consommation 11 (C11)', 'created: its name in Gladys is kept');
  assert.match(
    nameOf('c12'),
    /^T2-Maison \((negative|négatif)\) · (Consumption|Consommation) \(C12\)$/,
  );
  assert.match(
    nameOf('c23'),
    /^T7-Batterie \+ \((negative|négatif)\) · (Storage|Stockage) \(C23\)$/,
  );
  assert.match(nameOf('c20'), /^T6-Solaire · Production \(C20\)$/);
  assert.match(nameOf('c25'), /^Eau · (Water|Eau) \(C25\)$/);
  assert.match(nameOf('t2'), /^T2-Maison \(T2\)$/);
  assert.equal(store.data.indexes.c11.last.value, 3293.592);
});

test('input guard: a clamp linked out of 11-24 is another form; a pulse feeding electricity is held', () => {
  for (const [what, change] of Object.entries({
    'clamp to water (C25)': { ID_Logger_tore: [851993, 0, 0, 0, 0, 0, 0, 0] },
    'clamp to gas (C29)': { ID_Logger_tore_neg: [851997, 0, 0, 0, 0, 0, 0, 0] },
    'clamp to the teleinfo (C0)': { ID_Logger_tore: [851968, 0, 0, 0, 0, 0, 0, 0] },
    'clamp to a tariff (C10)': { ID_Logger_tore_neg: [851978, 0, 0, 0, 0, 0, 0, 0] },
  })) {
    const ed3 = parseEd3({ ...OBJECT_ED3, ...change });
    assert.equal(ed3.linksRead, false, what);
    assert.deepEqual(
      [...ed3.held],
      [...Array(14)].map((_, i) => 11 + i),
      what,
    );
  }
  // Clamps at the bounds: 11 and 24 are fine.
  const bounds = parseEd3({
    ...OBJECT_ED3,
    ID_Logger_tore: [851979, 0, 0, 0, 0, 0, 0, 851992],
    ID_Logger_tore_neg: [0, 0, 0, 0, 0, 0, 0, 0],
  });
  assert.equal(bounds.linksRead, true);
  // A pulse input feeding C11 (Wh not checked for a pulse) and C26 (water): C11 held, said.
  const ed3 = parseEd3({
    ...OBJECT_ED3,
    ID_Logger_tore: [0, 0, 0, 0, 0, 0, 0, 0],
    ID_Logger_tore_neg: [0, 0, 0, 0, 0, 0, 0, 0],
    ID_Logger_pulse: [851979, 851994, 0, 0],
  });
  assert.equal(ed3.linksRead, true);
  const { targets, skipped, pulseSkipped } = parseCounters(
    CORE_LOGGER,
    undefined,
    ed3.held,
    ed3.sources,
  );
  assert.deepEqual(skipped, []);
  assert.deepEqual(pulseSkipped, [11]);
  assert.equal(targets.has('c11'), false);
  assert.equal(targets.get('c12').value, 1064.294, 'not fed by a pulse: published');
  assert.equal(targets.get('c26').source.name, 'Pulse 2');
});

test('input guard end to end: a pulse feeding C11 is named in the status, never offered', async (t) => {
  const world = realEd3();
  world.answers.set('object/ed3/0', {
    ...OBJECT_ED3,
    ID_Logger_tore: [0, 0, 0, 851982, 0, 0, 0, 0],
    ID_Logger_pulse: [851979, 0, 0, 0],
  });
  const { app, gladys, start } = await setup({ world, store: boundStore() });
  t.after(() => app.stop());
  await start();
  assert.match(message(gladys), /C11 \(fed by a pulse input\) not offered/);
  assert.match(message(gladys, 'fr'), /C11 \(alimentés par une entrée impulsions\) non proposés/);
  assert.ok(!discovered(gladys).includes('ext:ed3:counter:c11'));
  assert.ok(discovered(gladys).includes('ext:ed3:counter:c12'));
});

// --- 0.2.1 (review cce66-n9 r2, m2): a pulse input that may feed an electricity counter -----

/** The electricity counters (0-24) no clamp feeds in OBJECT_ED3. */
const NOT_CLAMP_FED = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 18, 21, 24];

test('pulse list of another form: the electricity counters no clamp feeds are held', () => {
  for (const [what, value] of Object.entries({
    'counter numbers, not _id': [11, 0, 0, 0],
    'three entries': [851993, 851994, 851996],
    'five entries': [851993, 851994, 851996, 851997, 0],
    'a text': ['851993', 0, 0, 0],
    'null inside': [851993, null, 0, 0],
    'an object': { 0: 851993 },
    null: null,
  })) {
    const ed3 = parseEd3({ ...OBJECT_ED3, ID_Logger_pulse: value });
    assert.equal(ed3.linksRead, true, what);
    assert.deepEqual(
      [...ed3.pulse.unread].sort((a, b) => a - b),
      NOT_CLAMP_FED,
      what,
    );
    const parsed = parseCounters(CORE_LOGGER, undefined, ed3.held, ed3.sources, ed3.pulse);
    assert.deepEqual(parsed.skipped, [], what);
    assert.deepEqual(parsed.pulseSkipped, [], what);
    assert.deepEqual(parsed.pulseUnreadSkipped, [0], `${what}: C0 holds an index`);
    assert.equal(parsed.targets.has('c0'), false, `${what}: C0 held`);
    assert.equal(parsed.targets.get('c11').value, 3293.592, `${what}: fed by a clamp`);
    assert.equal(parsed.targets.get('c19').value, 122.117, `${what}: fed by a clamp`);
    assert.equal(parsed.targets.get('c25').value, 60.707, `${what}: water stays`);
  }
  // Absent (an older firmware, as `ID_Logger_tore_neg` in GCE's example): nothing more held.
  const { ID_Logger_pulse: _drop, ...older } = OBJECT_ED3;
  const absent = parseEd3(older);
  assert.equal(absent.pulse.unread.size, 0);
  const parsed = parseCounters(CORE_LOGGER, undefined, absent.held, absent.sources, absent.pulse);
  assert.equal(parsed.targets.get('c0').value, 132533.861);
  // His own list (well formed): nothing held, C0 published.
  const real = parseEd3(OBJECT_ED3);
  assert.equal(real.pulse.unread.size, 0);
  assert.equal(real.pulse.fed.size, 0, 'his pulse inputs feed water and gas only');
  const his = parseCounters(CORE_LOGGER, undefined, real.held, real.sources, real.pulse);
  assert.deepEqual(his.pulseUnreadSkipped, []);
  assert.equal(his.targets.get('c0').value, 132533.861);
});

test('pulse list of another form and clamp links unreadable: every electricity counter held', () => {
  const ed3 = parseEd3({
    ...OBJECT_ED3,
    ID_Logger_tore: [11, 0, 0, 14, 0, 20, 22, 16],
    ID_Logger_pulse: [25, 26, 28, 29],
  });
  assert.equal(ed3.linksRead, false);
  assert.deepEqual(
    [...ed3.pulse.unread].sort((a, b) => a - b),
    [...Array(25)].map((_, i) => i),
  );
  const parsed = parseCounters(CORE_LOGGER, undefined, ed3.held, ed3.sources, ed3.pulse);
  assert.deepEqual(parsed.skipped, HELD, 'the clamp counters said as before');
  assert.deepEqual(parsed.pulseUnreadSkipped, [0]);
  assert.equal(parsed.targets.has('c0'), false);
  assert.equal(parsed.targets.get('c25').value, 60.707);
});

test('a counter listed by a clamp and by a pulse input is held; a pulse to C0 too', () => {
  // C11 fed by T1 (positive) and by pulse input 1: ambiguous, no name, held.
  const twice = parseEd3({ ...OBJECT_ED3, ID_Logger_pulse: [851979, 851994, 0, 0] });
  assert.equal(twice.linksRead, true);
  assert.equal(twice.sources.has(11), false);
  assert.deepEqual([...twice.pulse.fed], [11], 'water (C26) is not held');
  const parsed = parseCounters(CORE_LOGGER, undefined, twice.held, twice.sources, twice.pulse);
  assert.deepEqual(parsed.pulseSkipped, [11]);
  assert.equal(parsed.targets.has('c11'), false);
  assert.equal(parsed.targets.get('c12').value, 1064.294, 'not fed by a pulse: published');
  assert.equal(parsed.targets.get('c0').value, 132533.861);
  // A pulse feeding C0 while the clamp links are unreadable (no source read): still held.
  const unread = parseEd3({
    ...OBJECT_ED3,
    ID_Logger_tore: [11, 0, 0, 14, 0, 20, 22, 16],
    ID_Logger_pulse: [851968, 0, 0, 0],
  });
  assert.equal(unread.linksRead, false);
  assert.equal(unread.sources.size, 0);
  const c0 = parseCounters(CORE_LOGGER, undefined, unread.held, unread.sources, unread.pulse);
  assert.deepEqual(c0.pulseSkipped, [0]);
  assert.equal(c0.targets.has('c0'), false);
});

test('pulse list of another form end to end: C0 named in the status, never offered', async (t) => {
  const world = realEd3();
  world.answers.set('object/ed3/0', { ...OBJECT_ED3, ID_Logger_pulse: [25, 26, 28, 29] });
  const { app, gladys, start } = await setup({ world, store: boundStore() });
  t.after(() => app.stop());
  await start();
  assert.match(message(gladys), /C0 not offered: this ED3 does not list the counters its pulse/);
  assert.match(
    message(gladys, 'fr'),
    /C0 non proposés : cet ED3 ne liste pas les compteurs alimentés par ses entrées impulsions/,
  );
  assert.ok(!discovered(gladys).includes('ext:ed3:counter:c0'));
  assert.ok(discovered(gladys).includes('ext:ed3:counter:c11'));
  assert.ok(discovered(gladys).includes('ext:ed3:counter:c25'));
  assert.equal(last(gladys, 'c0'), undefined);
});

test('a counter listed by a clamp and a pulse input end to end: held, named in the status', async (t) => {
  const world = realEd3();
  world.answers.set('object/ed3/0', { ...OBJECT_ED3, ID_Logger_pulse: [851979, 0, 0, 0] });
  const { app, gladys, start } = await setup({ world, store: boundStore() });
  t.after(() => app.stop());
  await start();
  assert.match(message(gladys), /C11 \(fed by a pulse input\) not offered/);
  assert.ok(!discovered(gladys).includes('ext:ed3:counter:c11'));
  assert.ok(discovered(gladys).includes('ext:ed3:counter:c0'));
});
