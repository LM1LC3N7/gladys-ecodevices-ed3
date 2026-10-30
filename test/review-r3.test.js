// -----------------------------------------------------------------------------
// The points of the ED3 review r3 (8b59dc6): the wait of a slot for the earlier
// ones, once per start and never between a read and its use, and a round never
// applied over a newer command or read back (I-5: m9a, m9b, r3-stale); the
// mutants P4, P5, P7 and P11 (m-15); the counters held without
// `ID_Logger_tore` (m-16); a /data load that hangs for good (m-17).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ed3App } from '../src/app.js';
import { TIMINGS } from '../src/constants.js';
import { PRIORITY } from '../src/ed3/client.js';
import { memoryStore, normalizeMemory } from '../src/store.js';
import { testClock } from './kit/index.mjs';
import { KEY, fakeEd3 } from './helpers/fakeEd3.js';
import { CONFIG, F, MINUTE, SECOND, START, created, settle, setup } from './helpers/app.js';
import { hubOf } from './helpers/hub.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const R1 = { ...CONFIG, relays: 'R1' };
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
/** The rounds of a fake ED3: when each full `object/ed3/0` read was asked (virtual ms). */
const rounds = (world, from = 0) =>
  world.requests
    .slice(from)
    .filter((r) => /^\/api\/object\/ed3\/0\?ApiKey=/.test(r.path))
    .map((r) => r.at);
const gapsOf = (times) => times.slice(1).map((t, i) => t - times[i]);
const twoSlots = (extra = {}) => ({
  ...R1,
  host: 'a.lan',
  host_2: 'b.lan',
  api_key_2: KEY,
  relays_2: 'R1',
  ...extra,
});

/** Two ED3 (two MAC addresses): `a.lan` in slot 1, `b.lan` in slot 2. */
function twoBoxes() {
  const a = fakeEd3({ mac: '00:04:a3:5e:00:21' });
  const b = fakeEd3({ mac: '00:04:a3:5e:00:22' });
  const boxOf = (host) => (host === 'a.lan' ? a : b);
  const onClock = (clock) => {
    a.clock = clock;
    b.clock = clock;
  };
  return { a, b, boxOf, onClock };
}

/**
 * A first run of `config` (`before` on its hub), then a restart a second after it; returns
 * the second hub once started, and where the requests of `b` were at the restart.
 */
async function restart(config, boxes, before) {
  const first = await hubOf(config, boxes.boxOf);
  boxes.onClock(first.clock);
  await first.hub.onConnected(() => first.gladys.getConfig());
  await first.wait(30 * SECOND);
  await before?.(first);
  await first.hub.shutdown();
  const second = await hubOf(config, boxes.boxOf, first.stores, {
    devices: first.gladys.devices,
    start: START + first.clock.elapsed + SECOND,
  });
  boxes.onClock(second.clock);
  const from = boxes.b.requests.length;
  second.hub.onConnected(() => second.gladys.getConfig());
  return { first, second, from };
}

// --- I-5: the wait for the earlier slots ---------------------------------------------

test('I-5 (m9a): slot 1 refused (kept in /data), a restart: slot 2 read at once, then every 10 s', async () => {
  const boxes = twoBoxes();
  const config = twoSlots({ api_key: 'wrong-key-1' });
  const { first, second, from } = await restart(config, boxes);
  assert.match(message(first.gladys), /ED3 #1: The Eco-Devices 3 refused the API key/);
  await second.wait(60 * SECOND);
  const times = rounds(boxes.b, from);
  assert.ok(times[0] < 2 * SECOND, `first round of slot 2 at ${times[0]} ms`);
  assert.ok(times.length >= 6, `${times.length} rounds`);
  for (const gap of gapsOf(times)) assert.ok(gap >= 9_900 && gap < 10_500, `gap ${gap} ms`);
  second.hub.stop();
});

test('I-5 (m9b): slot 1 paused (503, kept in /data), a restart: slot 2 read at once, then every 10 s', async () => {
  const boxes = twoBoxes();
  boxes.a.failReads = 503;
  const { first, second, from } = await restart(twoSlots(), boxes);
  assert.match(message(first.gladys), /ED3 #1: .*HTTP 503/);
  await second.wait(60 * SECOND);
  const times = rounds(boxes.b, from);
  assert.ok(times[0] < 2 * SECOND, `first round of slot 2 at ${times[0]} ms`);
  assert.ok(times.length >= 6, `${times.length} rounds`);
  for (const gap of gapsOf(times)) assert.ok(gap >= 9_900 && gap < 10_500, `gap ${gap} ms`);
  second.hub.stop();
});

test('I-5 (r3-stale): a switch-off of slot 2 right after its round is never undone by that round', async () => {
  const boxes = twoBoxes();
  const config = twoSlots({ api_key: 'wrong-key-1' });
  const { second, from } = await restart(config, boxes, async (first) => {
    const d = first.gladys.fake.discoveredDevices.find(
      (x) => x.external_id === 'ext:ed3:ed32:relay:r1',
    );
    await first.gladys.fake.deviceCreated({ id: 'dev-ed32-r1', ...d });
    boxes.b.relays[0] = true;
  });
  const feature = 'ext:ed3:ed32:relay:r1:switch';
  for (let i = 0; i < 400 && rounds(boxes.b, from).length === 0; i += 1) await second.wait(50);
  await second.wait(2 * SECOND);
  const device = second.gladys.devices.find((d) => d.external_id === 'ext:ed3:ed32:relay:r1');
  const states = () =>
    second.gladys.fake.states.filter((s) => s.device_feature_external_id === feature);
  const off = second.gladys.fake.setValue(device, { external_id: feature }, 0);
  let ack;
  off.then((value) => (ack = value));
  for (let i = 0; i < 500 && ack === undefined; i += 1) await second.wait(10);
  assert.equal(ack?.success, true, ack?.error);
  const afterOff = states().length;
  await second.wait(26 * SECOND);
  assert.equal(boxes.b.relays[0], false);
  assert.ok(
    states()
      .slice(afterOff - 1)
      .every((s) => s.state === 0),
    `states ${states().map((s) => s.state)}`,
  );
  second.hub.stop();
});

test('I-5: a round during which a read back left is not applied (its reads are older)', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeEd3();
  const { app, gladys, start, wait, clock } = await setup({ config: R1, devices: [device], world });
  await start();
  await wait(2 * SECOND);
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'switch')), 0);
  // The next round: its counters answer slowly. Once it has read the relay (off), the relay
  // is switched on at the ED3 itself and a read back (a follow-up) leaves meanwhile.
  world.latency = (r) => (r.path.includes('core_logger?option=filter_state') ? 3 * SECOND : 20);
  const n = rounds(world).length;
  for (let i = 0; i < 2000 && rounds(world).length === n; i += 1) await wait(10);
  await wait(100);
  world.relays[0] = true;
  const back = app.readBack(PRIORITY.CONFIRM, clock.monotonic() + 10 * SECOND, { resend: true });
  await wait(5 * SECOND);
  assert.equal((await back).values.get('r1'), 1);
  await app.flush();
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'switch')), 1, 'the read back stands');
  assert.equal(app.model.get('r1').value, 1);
  // The next round applies as usual.
  await wait(10 * SECOND);
  await app.flush();
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'switch')), 1);
  app.stop();
});

test('I-5: after its wait for slot 1, slot 2 reads every interval from its own first read', async () => {
  const boxes = twoBoxes();
  boxes.a.latency = 1500;
  const { hub, gladys, wait, clock } = await hubOf(twoSlots(), boxes.boxOf);
  boxes.onClock(clock);
  hub.onConnected(() => gladys.getConfig());
  await wait(45 * SECOND);
  const times = rounds(boxes.b);
  assert.ok(times[0] > 5 * SECOND, `slot 2 waited for slot 1 (${times[0]} ms)`);
  assert.ok(times.length >= 3);
  for (const gap of gapsOf(times)) assert.ok(gap >= 9_900, `gap ${gap} ms`);
  assert.equal(hub.settleListeners.size, 0, 'no listener left once the wait ended');
  hub.stop();
});

test('I-5: both slots saved again onto the same ED3: slot 2 waits again, never offered', async () => {
  const boxes = twoBoxes();
  // A under another name answers slowly (1.5 s more per request).
  const slowA = {
    transport: (o, h) => boxes.a.sleep(1500).then(() => boxes.a.transport(o, h)),
  };
  const boxOf = (host) => (host === 'b.lan' ? boxes.b : host === 'a2.lan' ? slowA : boxes.a);
  const { hub, gladys, wait, ids, clock } = await hubOf(twoSlots(), boxOf);
  boxes.onClock(clock);
  hub.onConnected(() => gladys.getConfig());
  await wait(30 * SECOND);
  assert.ok(ids().some((id) => id.includes(':ed32:')));
  // Slot 1 now reads A by that slow name, slot 2 A by its first one: both start again, and
  // slot 2 waits for the new first round of slot 1, not the one of its previous start.
  const saving = hub.configUpdated(twoSlots({ host: 'a2.lan', host_2: 'a.lan' }));
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    await wait(100);
    for (const id of ids()) seen.add(id);
  }
  await saving;
  assert.ok(![...seen].some((id) => id.includes(':ed32:')), 'slot 2 never offered');
  assert.match(message(gladys), /ED3 #2: The same Eco-Devices 3 \(same MAC address\) as ED3 #1/);
  hub.stop();
});

test('I-5: a stop during the wait ends the round at once: nothing read, no attempt kept', async () => {
  const boxes = twoBoxes();
  boxes.a.latency = 1500;
  const { hub, gladys, wait, clock, stores } = await hubOf(twoSlots(), boxes.boxOf);
  boxes.onClock(clock);
  hub.onConnected(() => gladys.getConfig());
  await wait(2 * SECOND);
  const two = hub.controllers.get(2);
  assert.ok(two.earlierWait, 'slot 2 waits for slot 1');
  assert.ok(two.running);
  await hub.shutdown();
  await settle();
  assert.equal(two.running, undefined, 'its round ended with the stop');
  assert.equal(two.earlierWait, undefined);
  assert.equal(boxes.b.requests.length, 0);
  assert.equal(stores.get(2).data.lastAttemptAt, null, 'no attempt written');
});

test('I-5: the wait itself: once per start, bounded, ended by the earlier slots or a stop', async () => {
  const clock = testClock({ start: START });
  let settled = false;
  const listeners = new Set();
  const peers = {
    macSeen() {},
    earlierSettled: () => settled,
    onSettled: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const app = new Ed3App({
    gladys: {},
    logger: quiet,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: memoryStore(),
    slot: 2,
    peers,
  });
  let ended = false;
  const end = (wait) => wait.then(() => (ended = true));
  // Bounded.
  end(app.waitEarlierSlots());
  assert.equal(app.waitEarlierSlots(), undefined, 'once per start');
  await clock.advance(TIMINGS.roundBudget - 100);
  await settle();
  assert.equal(ended, false);
  await clock.advance(200);
  await settle();
  assert.equal(ended, true, 'bounded');
  assert.equal(listeners.size, 0);
  assert.equal(app.earlierWait, undefined);
  // A new start waits again, until every earlier slot is done.
  app.reset();
  ended = false;
  end(app.waitEarlierSlots());
  for (const listener of [...listeners]) listener();
  await settle();
  assert.equal(ended, false, 'not before all of them');
  settled = true;
  for (const listener of [...listeners]) listener();
  await settle();
  assert.equal(ended, true);
  assert.equal(listeners.size, 0);
  assert.equal(clock.pending, 0, 'its timer cleared');
  assert.equal(app.earlierWait, undefined);
  // Already done: no wait at all.
  app.reset();
  assert.equal(app.waitEarlierSlots(), undefined);
  // A stop ends it.
  settled = false;
  app.reset();
  ended = false;
  end(app.waitEarlierSlots());
  app.stop();
  await settle();
  assert.equal(ended, true);
  assert.equal(listeners.size, 0);
  assert.equal(clock.pending, 0);
});

// --- m-15 -----------------------------------------------------------------------------

test('m-15 (P4): slot 1 unreachable: slot 2 offered within seconds (a failed round ends the wait)', async () => {
  const boxes = twoBoxes();
  boxes.a.refuseConnect = 1e6;
  const { hub, gladys, wait, ids, clock } = await hubOf(twoSlots(), boxes.boxOf);
  boxes.onClock(clock);
  hub.onConnected(() => gladys.getConfig());
  await wait(8 * SECOND);
  assert.ok(
    ids().some((id) => id.includes(':ed32:')),
    'slot 2 offered',
  );
  hub.stop();
});

test('m-15 (P5): slot 1 not configured: slot 2 offered within seconds', async () => {
  const boxes = twoBoxes();
  const config = { host_2: 'b.lan', api_key_2: KEY, relays_2: 'R1', poll_interval: 10 };
  const { hub, gladys, wait, ids, clock } = await hubOf(config, boxes.boxOf);
  boxes.onClock(clock);
  hub.onConnected(() => gladys.getConfig());
  await wait(8 * SECOND);
  assert.ok(
    ids().some((id) => id.includes(':ed32:')),
    'slot 2 offered',
  );
  hub.stop();
});

test('m-15 (P7): a save stuck 8 s, then done: the saves and the indexes come back', async () => {
  const counter = created('counter', 'c0', { last: { value: 12662, at: START - MINUTE } });
  const clock = testClock({ start: START });
  const store = memoryStore();
  const save = store.save.bind(store);
  let hang = false;
  store.save = (data) => {
    if (!hang) return save(data);
    hang = false;
    return new Promise((resolve) => {
      clock.timers.setTimeout(() => save(data).then(resolve), 8 * SECOND);
    });
  };
  const world = fakeEd3();
  const { app, gladys, start, wait } = await setup({ devices: [counter], store, world, clock });
  await start();
  await wait(70 * SECOND);
  assert.equal(gladys.fake.lastState(F('counter', 'c0', 'index')), 12662);
  hang = true;
  await wait(20 * SECOND);
  world.index.set(0, 12_662_500);
  await wait(2 * MINUTE);
  assert.equal(gladys.fake.lastState(F('counter', 'c0', 'index')), 12662.5);
  assert.equal(app.saveFailed, false);
  assert.doesNotMatch(message(gladys), /\/data/);
  app.stop();
});

test('m-15 (P11): the earlier slot of a duplicate pause read from /data is checked', () => {
  const now = START;
  const raw = (of) => ({
    key: 'a'.repeat(32),
    pause: { until: now + MINUTE, failures: 1, code: 'duplicate', of },
  });
  assert.deepEqual(normalizeMemory(raw(1), now).pause, {
    until: now + MINUTE,
    failures: 1,
    code: 'duplicate',
    of: 1,
  });
  assert.equal(normalizeMemory(raw(2), now).pause.of, 2);
  for (const of of [9, 0, 3, -1, 1.5, '1', null, undefined]) {
    const { pause } = normalizeMemory(raw(of), now);
    assert.equal(pause.code, 'failed', String(of));
    assert.equal('of' in pause, false, String(of));
  }
});

// --- m-16 -----------------------------------------------------------------------------

test('m-16: without ID_Logger_tore, the counters 11 to 24 are held, their source said unknown', async () => {
  const world = fakeEd3();
  world.loggers = null;
  world.index.set(12, 407_230_100);
  const { app, gladys, start } = await setup({ world });
  await start();
  const ids = (gladys.fake.discoveredDevices ?? []).map((d) => d.external_id);
  for (const n of [11, 12, 19, 20]) assert.ok(!ids.includes(`ext:ed3:counter:c${n}`), `C${n}`);
  assert.ok(ids.includes('ext:ed3:counter:c0'));
  assert.match(
    message(gladys),
    /C11, C12, C19, C20 \(source unknown: the ED3 does not list the counters its clamps feed, each may be one\): not offered until the unit of those counters is confirmed/,
  );
  assert.doesNotMatch(message(gladys), /fed by a clamp/);
  assert.match(message(gladys, 'fr'), /C11, C12, C19, C20 \(source inconnue : l’ED3 ne liste pas/);
  assert.doesNotMatch(message(gladys, 'fr'), /\(alimentés par un tore\)/);
  app.stop();
});

// --- m-17 -----------------------------------------------------------------------------

test('m-17: a /data load hanging for good: the test button answers, the rounds keep their pace', async () => {
  const store = memoryStore();
  let loads = 0;
  store.load = () => {
    loads += 1;
    return new Promise(() => {});
  };
  const world = fakeEd3();
  const { app, wait, act } = await setup({ store, world });
  await act(app.connected(CONFIG));
  // Between two rounds (every 10 s from the start, 5 s in).
  await wait(43 * SECOND);
  assert.equal(loads, 1, 'never asked again while it hangs');
  const times = rounds(world);
  assert.ok(times.length >= 4, `${times.length} rounds`);
  for (const gap of gapsOf(times)) assert.ok(gap < 10_500, `gap ${gap} ms`);
  const text = await act(app.testConnection());
  assert.doesNotMatch(text.en, /already running/);
  assert.match(text.en, /\/data cannot be read/);
  app.stop();
});

test('m-17: a /data load stuck 8 s at start, then answering: read again, its owner kept', async () => {
  const clock = testClock({ start: START });
  const store = memoryStore();
  const load = store.load.bind(store);
  let first = true;
  store.load = () => {
    if (!first) return load();
    first = false;
    return new Promise((resolve) => {
      clock.timers.setTimeout(() => load().then(resolve), 8 * SECOND);
    });
  };
  const world = fakeEd3();
  const { app, gladys, wait, act } = await setup({ store, world, clock });
  await act(app.connected(CONFIG));
  assert.equal(app.storeUnreadable, true);
  await wait(30 * SECOND);
  assert.equal(app.storeUnreadable, false);
  assert.equal(app.verdict, 'same');
  assert.match(message(gladys), /Connected/);
  assert.doesNotMatch(message(gladys), /\/data/);
  app.stop();
});
