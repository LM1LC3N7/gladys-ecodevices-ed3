// -----------------------------------------------------------------------------
// The answers of a real Eco-Devices 3 (cce66's, firmware 1.3.0), replayed:
// the MAC with dashes as the identity, a `core_logger` of 26 entries numbered
// by their `_id`, the units (Wh, mL) and the counters 11 to 24 held while
// their source and unit are unknown. See test/fixtures/cce66-ed3.js.
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
  MISSING,
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
  assert.equal(ed3.clampsListed, false);
  const { targets, skipped } = parseCounters(CORE_LOGGER, undefined, ed3.clampCounters);
  assert.deepEqual(skipped, HELD);
  for (let n = 11; n <= 24; n += 1) assert.equal(targets.has(`c${n}`), false, `C${n}`);
  assert.equal(targets.get('c0').value, 132533.861);
  assert.equal(targets.get('c25').value, 60.707);
});

test('cce66 end to end, new install: owner by the MAC with dashes; C0 and C25 offered, the rest not', async () => {
  const world = realEd3();
  const { app, gladys, start, store } = await setup({ world, fresh: true });
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
  assert.match(message(gladys), /C11, C12, C13, C15, C16 and 5 more \(source unknown/);
  assert.match(message(gladys, 'fr'), /C11, C12, C13, C15, C16 et 5 autre\(s\) \(source inconnue/);
  assert.match(message(gladys), /2 counter\(s\)/, 'C0 and C25');
  app.stop();
});

test('cce66 end to end, devices bound by the MAC: values in kWh and m³; a list of 30 later shifts nothing', async () => {
  const devices = [created('counter', 'c0'), created('counter', 'c25'), created('counter', 'c18')];
  const world = realEd3();
  const { app, gladys, start, wait, store } = await setup({ devices, world, store: boundStore() });
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
  app.stop();
});
