// -----------------------------------------------------------------------------
// The points of the ED3 review r2 (363e44e): a switch-off with the owner
// unknown whatever /data (I-4), the start order of the slots (m-9), a
// duplicate said after a restart (m-10), the counters fed by a clamp named
// (m-11), the mutants N17 and N18 (m-12), a frozen /data and the buttons
// (m-13).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../src/store.js';
import { KEY, fakeEd3 } from './helpers/fakeEd3.js';
import { CONFIG, F, SECOND, created, setup } from './helpers/app.js';
import { hubOf } from './helpers/hub.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const switchOf = (code) => created('relay', code, { relayKind: 'switch' });
const R1 = { ...CONFIG, relays: 'R1' };

// --- I-4 -----------------------------------------------------------------------------

test('I-4 (d3): /data deleted, writable, devices there: the switch-off goes, nothing else', async () => {
  const device = switchOf('r1');
  const counter = created('counter', 'c0');
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, gladys, start, cmd, store } = await setup({
    config: R1,
    devices: [device, counter],
    world,
    fresh: true,
  });
  await start();
  await app.flush();
  assert.equal(app.storeLost, false, '/data is writable');
  assert.equal(app.verdict, 'unbound');
  assert.match(message(gladys), /only switch-offs are sent, to the address typed/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  assert.equal(world.writes().length, 0);
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(world.relays[0], false);
  assert.equal(gladys.fake.lastState(F('counter', 'c0', 'index')), undefined, 'no value');
  assert.equal(store.data.owner, null);
  app.stop();
});

test('I-4 (d9): /data read only, then writable again: the switch-off goes in both', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  store.fail = true;
  const world = fakeEd3();
  const { app, start, cmd, wait } = await setup({
    config: R1,
    devices: [device],
    store,
    world,
    fresh: true,
  });
  await start();
  assert.equal(app.storeLost, true);
  world.relays[0] = true;
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 0)).success, true);
  store.fail = false;
  await wait(10 * SECOND);
  assert.equal(app.storeLost, false);
  world.relays[0] = true;
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(world.relays[0], false);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  app.stop();
});

// --- Two slots -----------------------------------------------------------------------

test('m-9 (s2c): slot 1 slower than slot 2, same ED3: slot 2 is never offered in Discover', async () => {
  const slow = fakeEd3();
  const fast = fakeEd3();
  slow.latency = 1500;
  const config = { ...R1, host_2: 'ed3.lan', api_key_2: KEY, relays_2: 'R1' };
  const { hub, gladys, wait, ids, clock } = await hubOf(config, (host) =>
    host === 'ed3.lan' ? fast : slow,
  );
  slow.clock = clock;
  fast.clock = clock;
  const seen = new Set();
  const connecting = hub.onConnected(() => gladys.getConfig());
  for (let i = 0; i < 300; i += 1) {
    await wait(100);
    for (const id of ids()) seen.add(id);
  }
  await connecting;
  assert.ok(![...seen].some((id) => id.includes(':ed32:')), 'never offered');
  assert.match(message(gladys), /ED3 #2: The same Eco-Devices 3 \(same MAC address\) as ED3 #1/);
  hub.stop();
});

test('m-10 (s5): after a restart, a duplicate slot is still said to be one, no "/data lost"', async () => {
  const box = fakeEd3();
  const config = { ...R1, host_2: 'ed3.lan', api_key_2: KEY, relays_2: 'R1' };
  const first = await hubOf(config, () => box);
  box.clock = first.clock;
  await first.hub.onConnected(() => first.gladys.getConfig());
  await first.wait(30 * SECOND);
  assert.match(message(first.gladys), /ED3 #2: The same Eco-Devices 3/);
  await first.hub.shutdown();
  const second = await hubOf(config, () => box, first.stores);
  box.clock = second.clock;
  second.hub.onConnected(() => second.gladys.getConfig());
  await second.wait(2 * SECOND);
  const line = message(second.gladys).split('\n')[1] ?? '';
  assert.match(line, /The same Eco-Devices 3/);
  assert.doesNotMatch(message(second.gladys), /not known to belong|was lost/);
  second.hub.stop();
});

test('N18: a slot moved to another address forgets the MAC it read before', async () => {
  const a = fakeEd3();
  const b = fakeEd3({ mac: '00:04:a3:5e:00:0b' });
  b.refuseConnect = 1e6;
  const config = { ...R1 };
  const { hub, gladys, wait, ids, clock } = await hubOf(config, (host) =>
    host === 'ed3-b.lan' ? b : a,
  );
  a.clock = clock;
  b.clock = clock;
  await hub.onConnected(() => gladys.getConfig());
  await wait(2 * SECOND);
  // Slot 1 now at B (unreachable), slot 2 at A, the ED3 slot 1 read before.
  await hub.configUpdated({
    ...R1,
    host: 'ed3-b.lan',
    host_2: CONFIG.host,
    api_key_2: KEY,
    relays_2: 'R1',
  });
  await wait(40 * SECOND);
  assert.doesNotMatch(message(gladys), /same Eco-Devices 3/);
  assert.ok(
    ids().some((id) => id.includes(':ed32:')),
    'slot 2 used',
  );
  hub.stop();
});

// --- m-11 ----------------------------------------------------------------------------

test('m-11: the counters fed by a clamp are named in the status', async () => {
  const world = fakeEd3();
  world.index.set(12, 407_230_100);
  world.index.set(14, 1_000);
  const { app, gladys, start } = await setup({ world });
  await start();
  assert.match(
    message(gladys),
    /C12, C14 \(fed by a clamp\): not offered until their unit is confirmed/,
  );
  assert.match(message(gladys, 'fr'), /C12, C14 \(alimentés par un tore\) : non proposés/);
  app.stop();
});

// --- m-12: N17 ---------------------------------------------------------------------------

test('N17: /data never writable, the devices all deleted: no owner set over it', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  store.fail = true;
  const { app, gladys, start, wait } = await setup({
    config: R1,
    devices: [device],
    store,
    fresh: true,
  });
  await start();
  assert.equal(app.storeLost, true);
  gladys.devices = [];
  await wait(10 * SECOND);
  assert.equal(app.verdict, 'unbound');
  assert.equal(app.memory.owner, null);
  app.stop();
});

// --- m-13 ----------------------------------------------------------------------------

test('m-13: a frozen save leaves the test button answering, the rounds paced', async () => {
  const store = memoryStore();
  const world = fakeEd3();
  const { app, start, wait, act } = await setup({ store, world });
  await start();
  store.save = () => new Promise(() => {});
  await wait(30 * SECOND);
  const text = await act(app.testConnection());
  assert.doesNotMatch(text.en, /already running/);
  assert.match(text.en, /\/data|Connected|read less than an interval/);
  app.stop();
});

test('m-13: a /data load that hangs at start: the ack of a switch-off names /data', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  store.load = () => new Promise(() => {});
  const world = fakeEd3();
  const { app, gladys, act } = await setup({ config: R1, devices: [device], store, world });
  const starting = app.connected(R1);
  const ack = await act(gladys.fake.setValue(device, device.features[0], 0));
  assert.match(ack.error ?? '', /\/data ne répond pas encore/);
  await act(starting);
  app.stop();
});

test('m-10: a slot without device nor owner says "Connecting" at start, never "/data lost"', async () => {
  const world = fakeEd3();
  world.latency = 3000;
  const { app, gladys, wait } = await setup({ world, fresh: true });
  app.connected(CONFIG);
  await wait(500);
  assert.match(message(gladys), /Connecting/);
  assert.doesNotMatch(message(gladys), /not known to belong/);
  app.stop();
});

test('m-9: a slot after a duplicate one is not held by it (its wait ends with that round)', async () => {
  const box = fakeEd3();
  const other = fakeEd3({ mac: '00:04:a3:5e:00:03' });
  const config = {
    ...R1,
    host_2: 'ed3.lan',
    api_key_2: KEY,
    relays_2: 'R1',
    host_3: 'other.lan',
    api_key_3: KEY,
    relays_3: 'R1',
  };
  const { hub, gladys, wait, ids, clock } = await hubOf(config, (host) =>
    host === 'other.lan' ? other : box,
  );
  box.clock = clock;
  other.clock = clock;
  hub.onConnected(() => gladys.getConfig());
  await wait(8 * SECOND);
  assert.ok(
    ids().some((id) => id.includes(':ed33:')),
    'slot 3 offered within seconds',
  );
  assert.ok(!ids().some((id) => id.includes(':ed32:')));
  hub.stop();
});
