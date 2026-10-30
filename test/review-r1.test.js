// -----------------------------------------------------------------------------
// The points of the ED3 review r1 (2f0c6a5): /data never writable (I-1), the
// same ED3 in two slots (I-2), a write answered without JSON (I-3), and the
// minors (an unknown slot id, Attach without a MAC, /data that hangs, the
// mutants left alive, a false "not applied", a switch-off to another box,
// the counters fed by a clamp).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Ed3Hub } from '../src/hub.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { testClock } from './kit/index.mjs';
import { KEY, MAC, fakeEd3 } from './helpers/fakeEd3.js';
import {
  CONFIG,
  F,
  MINUTE,
  SALT,
  SECOND,
  START,
  boundMemory,
  created,
  settle,
  setup,
} from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const switchOf = (code) => created('relay', code, { relayKind: 'switch' });
const R1 = { ...CONFIG, relays: 'R1' };
const later = (clock, ms, fn) => new Promise((r) => clock.timers.setTimeout(r, ms)).then(fn);
const last = (gladys, code) => gladys.fake.lastState(F('counter', code, 'index'));

// --- I-1 -----------------------------------------------------------------------------

test('I-1: no file, devices there, /data never writable: the switch-off goes, nothing else', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  store.fail = true;
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, gladys, start, cmd, act } = await setup({
    config: R1,
    devices: [device, created('counter', 'c0')],
    store,
    world,
    fresh: true,
  });
  await start();
  assert.equal(app.storeLost, true);
  assert.match(message(gladys), /cannot be written to \/data and holds nothing yet/);
  const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(on.error, /\/data ne peut être ni lu ni écrit/);
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(world.relays[0], false);
  await app.flush();
  assert.equal(last(gladys, 'c0'), undefined, 'no value published');
  assert.match((await act(app.attach())).en, /cannot be written to \/data/);
  assert.match((await act(app.attach())).en, /cannot be written to \/data/);
  assert.equal(store.data, null);
  app.stop();
});

test('I-1: /data writable again: as a /data lost, "Attach the devices" binds them', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  store.fail = true;
  const { app, gladys, start, cmd, wait } = await setup({
    config: R1,
    devices: [device],
    store,
    fresh: true,
  });
  await start();
  store.fail = false;
  await wait(10 * SECOND);
  assert.equal(app.storeLost, false);
  assert.match(message(gladys), /not known to belong to the Eco-Devices 3 read/);
  await gladys.fake.action('attach_devices', { ed3: '1' });
  await gladys.fake.action('attach_devices', { ed3: '1' });
  assert.ok(store.data.owner);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  app.stop();
});

// --- I-2 -----------------------------------------------------------------------------

/** A hub of two slots on fake ED3 behind one transport, `boxOf(hostname)` choosing the box. */
async function twoSlots(config, boxOf) {
  const clock = testClock({ start: START });
  const gladys = createFakeGladys({ selector: 'ed3', config });
  await gladys.connect();
  const quiet = () => {};
  const hub = new Ed3Hub({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    transport: (o, h) => boxOf(o.hostname).transport(o, h),
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    storeOf: () => memoryStore(),
    random: () => SALT,
  });
  registerHandlers(gladys, hub);
  const act = async (promise) => {
    let done = false;
    const out = promise.then(
      (v) => ((done = true), v),
      (e) => ((done = true), { error: e }),
    );
    for (let t = 0; !done && t < 30_000; t += 10) {
      await clock.advance(10);
      await settle(3);
    }
    return out;
  };
  const wait = async (ms) => {
    await clock.advance(ms);
    await settle();
  };
  await act(hub.onConnected(() => gladys.getConfig()));
  await wait(1000);
  const ids = () => (gladys.fake.discoveredDevices ?? []).map((d) => d.external_id);
  return { hub, gladys, act, wait, ids, clock };
}

test('I-2: the same address in two slots: the second is not read nor used', async () => {
  const box = fakeEd3();
  const config = { ...R1, host_2: CONFIG.host, api_key_2: KEY, relays_2: 'R1' };
  const { hub, gladys, act, wait, ids, clock } = await twoSlots(config, () => box);
  box.clock = clock;
  await wait(30 * SECOND);
  assert.match(message(gladys), /ED3 #2: Same address as ED3 #1/);
  assert.ok(!ids().some((id) => id.includes(':ed32:')));
  assert.ok(ids().includes('ext:ed3:counter:c0'));
  const off = await act(
    gladys.fake.setValue(
      { external_id: 'ext:ed3:ed32:relay:r1' },
      { external_id: 'ext:ed3:ed32:relay:r1:switch' },
      0,
    ),
  );
  assert.match(off.error, /même Eco-Devices 3 que l’ED3 n°1/);
  assert.equal(box.writes().length, 0);
  assert.equal(box.peak, 1, 'one lane to the box');
  hub.stop();
});

test('I-2: the same ED3 under an IP and a host name (same MAC): the second is not used', async () => {
  const box = fakeEd3();
  const config = { ...R1, host_2: 'ed3.lan', api_key_2: KEY, relays_2: 'R1' };
  let second = 0;
  const { hub, gladys, act, wait, ids, clock } = await twoSlots(config, (host) => {
    if (host === 'ed3.lan') second += 1;
    return box;
  });
  box.clock = clock;
  await wait(30 * SECOND);
  assert.match(message(gladys), /ED3 #2: The same Eco-Devices 3 \(same MAC address\) as ED3 #1/);
  assert.ok(!ids().some((id) => id.includes(':ed32:')), 'nothing of #2 in Discover');
  const before = second;
  await wait(2 * MINUTE);
  assert.ok(
    second - before <= 8,
    `the second slot is not read every interval (${second - before})`,
  );
  const ack = await act(
    gladys.fake.setValue(
      { external_id: 'ext:ed3:ed32:relay:r1' },
      { external_id: 'ext:ed3:ed32:relay:r1:switch' },
      0,
    ),
  );
  assert.match(ack.error, /même Eco-Devices 3/);
  hub.stop();
});

// --- I-3 -----------------------------------------------------------------------------

for (const [name, body] of [
  ['an empty body', ''],
  ['a text', 'OK'],
]) {
  test(`I-3: a write answered 200 with ${name}: accepted, confirmed by the read back`, async () => {
    const device = switchOf('r1');
    const world = fakeEd3();
    world.writeBody = body;
    const { app, gladys, start, cmd, wait } = await setup({ config: R1, devices: [device], world });
    await start();
    const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
    assert.equal(on.success, true, on.error);
    assert.equal(world.relays[0], true);
    const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
    assert.equal(off.success, true, off.error);
    await wait(25 * SECOND);
    assert.doesNotMatch(message(gladys), /not applied/);
    app.stop();
  });
}

// --- m-1 -----------------------------------------------------------------------------

test('m-1: an id of a slot this version does not have gets a plain refusal', async () => {
  const box = fakeEd3();
  const { hub, gladys, act, clock } = await twoSlots(R1, () => box);
  box.clock = clock;
  for (const slot of [4, 9]) {
    const ack = await act(
      gladys.fake.setValue(
        { external_id: `ext:ed3:ed3${slot}:relay:r1` },
        { external_id: `ext:ed3:ed3${slot}:relay:r1:switch` },
        0,
      ),
    );
    assert.equal(ack.success, false);
    assert.match(ack.error, /n’est pas connu|not known/);
    await hub.deviceCreated({ external_id: `ext:ed3:ed3${slot}:relay:r1`, features: [] });
    await hub.deviceDeleted({ external_id: `ext:ed3:ed3${slot}:relay:r1` });
  }
  assert.equal(box.writes().length, 0);
  hub.stop();
});

// --- m-2 -----------------------------------------------------------------------------

test('m-2: a MAC that stays unreadable: Attach by the address, then the relay obeys', async () => {
  const device = switchOf('r1');
  const world = fakeEd3({ mac: undefined });
  const { app, gladys, start, cmd, store } = await setup({
    config: R1,
    devices: [device],
    world,
    store: memoryStore(boundMemory(CONFIG, MAC)),
  });
  await start();
  assert.equal(app.verdict, 'unverified');
  const first = await gladys.fake.action('attach_devices', { ed3: '1' });
  assert.match(first.data.message.en, /known by its address \(its MAC address cannot be read\)/);
  await gladys.fake.action('attach_devices', { ed3: '1' });
  assert.equal(store.data.owner.kind, 'address');
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  app.stop();
});

// --- m-3 -----------------------------------------------------------------------------

test('m-3: a save that hangs holds neither the rounds nor the switch-offs; the status says /data', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  const world = fakeEd3();
  const { app, gladys, start, cmd, wait } = await setup({
    config: R1,
    devices: [device],
    store,
    world,
  });
  await start();
  store.save = () => new Promise(() => {});
  const rounds = () =>
    world.requests.filter((r) => /\/api\/object\/ed3\/0\?ApiKey/.test(r.path)).length;
  const before = rounds();
  for (let i = 0; i < 3; i += 1) {
    world.relays[0] = true;
    assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 0)).success, true);
  }
  await wait(40 * SECOND);
  assert.ok(rounds() - before >= 2, `${rounds() - before} rounds`);
  assert.match(message(gladys), /cannot be written to \/data/);
  app.stop();
});

test('m-3: a /data load that hangs at start: a switch-off clicked meanwhile still leaves', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  store.load = () => new Promise(() => {});
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, gladys, act, wait } = await setup({ config: R1, devices: [device], store, world });
  const starting = app.connected(R1);
  const ack = await act(gladys.fake.setValue(device, device.features[0], 0));
  assert.ok(ack.success || /gardée et envoyée/.test(ack.error), ack.error);
  await act(starting);
  await wait(2 * SECOND);
  assert.ok(
    world.writes().some((w) => /SetOffR\/1/.test(w.path)),
    'the switch-off left',
  );
  assert.equal(world.relays[0], false);
  assert.match(message(gladys), /cannot be read/);
  app.stop();
});

// --- m-4: the mutants left alive ------------------------------------------------------

test('E10: a held jump whose threshold moved between the clicks is not taken', async () => {
  const world = fakeEd3();
  const { app, gladys, start, wait, act } = await setup({
    devices: [created('counter', 'c11')],
    world,
  });
  await start();
  world.index.set(11, 14_072_301);
  await wait(MINUTE);
  await act(app.acceptHeldIndex());
  world.index.set(11, 10_000_000);
  await wait(MINUTE);
  world.index.set(11, 14_072_301);
  await wait(MINUTE);
  const done = await act(app.acceptHeldIndex());
  assert.match(done.en, /Changed since the first click/);
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c11'), 4072.301);
  app.stop();
});

test('E11: a held jump that starts from another value between the clicks is not taken', async () => {
  const world = fakeEd3();
  const { app, gladys, start, wait, act } = await setup({
    devices: [created('counter', 'c11')],
    world,
  });
  await start();
  world.index.set(11, 14_072_301);
  await wait(MINUTE);
  await act(app.acceptHeldIndex());
  world.index.set(11, 4_072_400);
  await wait(MINUTE);
  world.index.set(11, 14_072_301);
  await wait(MINUTE);
  const done = await act(app.acceptHeldIndex());
  assert.match(done.en, /Changed since the first click/);
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c11'), 4072.4);
  app.stop();
});

test('E18: water has its own limit (10 m³/h): 1 m³ in a minute is held', async () => {
  const world = fakeEd3();
  const { app, gladys, start, wait } = await setup({ devices: [created('counter', 'c25')], world });
  await start();
  world.index.set(25, 124_456_000);
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c25'), 123.456);
  assert.ok(app.indexGuards.get('c25').held);
  app.stop();
});

test('R3: a resend checks the ED3 again right before its first byte', async () => {
  const device = switchOf('r1');
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, cmd, act, clock } = await setup({ config: R1, devices: [device], world });
  await start();
  world.ignoreWrites = true;
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  const guard = app.guards.get('r1');
  const before = world.writes().filter((w) => w.sentAt !== undefined).length;
  world.connectDelay = (r) => (/SetOffR/.test(r.path) ? 100 : 0);
  app.resendGuard(guard);
  await act(later(clock, 50, () => (app.verdict = 'different')));
  await act(new Promise((r) => clock.timers.setTimeout(r, 500)));
  assert.equal(world.writes().filter((w) => w.sentAt !== undefined).length, before);
  app.stop();
});

test('R4, R25: another ED3 found between the click and the first byte: nothing sent, nothing kept', async () => {
  const device = switchOf('r1');
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, act, gladys, clock, store } = await setup({
    config: R1,
    devices: [device],
    world,
  });
  await start();
  world.connectDelay = (r) => (/SetOffR/.test(r.path) ? 100 : 0);
  const off = gladys.fake.setValue(device, device.features[0], 0);
  const [ack] = await act(Promise.all([off, later(clock, 50, () => (app.verdict = 'different'))]));
  assert.match(ack.error, /n’est pas celui/);
  assert.ok(!world.writes().some((w) => w.sentAt !== undefined));
  assert.equal(app.guards.has('r1'), false);
  assert.deepEqual(store.data.guards, []);
  app.stop();
});

test('R27: Attach with /data unreadable is refused, the switch-on still too', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  store.unreadable = true;
  const { app, start, cmd, act } = await setup({
    config: R1,
    devices: [device],
    store,
    fresh: true,
  });
  await start();
  for (let i = 0; i < 2; i += 1) assert.match((await act(app.attach())).en, /\/data/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  app.stop();
});

// --- m-5, m-6, m-8 ---------------------------------------------------------------------

test('m-5: a switch-on cut by a switch-off, the read back showing off: no "not applied"', async () => {
  const device = switchOf('r1');
  const world = fakeEd3();
  const { app, gladys, start, act, wait, clock } = await setup({
    config: R1,
    devices: [device],
    world,
  });
  await start();
  world.latency = (r) => (/SetOnR/.test(r.path) ? 2 * SECOND : 20);
  const feature = device.features[0];
  const [, off] = await act(
    Promise.all([
      gladys.fake.setValue(device, feature, 1),
      later(clock, 200, () => gladys.fake.setValue(device, feature, 0)),
    ]),
  );
  assert.equal(off.success, true, off.error);
  await wait(25 * SECOND);
  assert.equal(world.relays[0], false);
  assert.doesNotMatch(message(gladys), /not applied/);
  app.stop();
});

test('m-6: an IPX800 V5 found where the ED3 was: no switch-off sent to it, kept ones dropped', async () => {
  const device = switchOf('r1');
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, cmd, wait, gladys, store } = await setup({
    config: R1,
    devices: [device],
    world,
  });
  await start();
  world.ignoreWrites = true;
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(store.data.guards.length, 1, 'a switch-off kept');
  await wait(25 * SECOND);
  world.other = 'ipx800v5';
  const offs = () => world.requests.filter((r) => /SetOffR/.test(r.path)).length;
  const before = offs();
  await wait(10 * SECOND);
  assert.match(message(gladys), /answers as an IPX800 V5/);
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.match(off.error, /répond comme un IPX800 V5/);
  await wait(30 * SECOND);
  assert.equal(offs(), before, 'nothing sent to the other box');
  assert.equal(app.guards.size, 0);
  assert.deepEqual(store.data.guards, []);
  app.stop();
});

test('m-8: a counter fed by a clamp is never published as an energy index (unit not confirmed)', async () => {
  const world = fakeEd3();
  world.index.set(12, 407_230_100);
  const { app, gladys, start } = await setup({ devices: [created('counter', 'c12')], world });
  await start();
  await app.flush();
  assert.ok(!gladys.fake.discoveredDevices.some((d) => d.external_id === 'ext:ed3:counter:c12'));
  assert.equal(last(gladys, 'c12'), undefined);
  assert.ok(gladys.fake.discoveredDevices.some((d) => d.external_id === 'ext:ed3:clamp:t1'));
  // Without the list of the clamps: counters 11 to 24 are taken as fed by one.
  const { parseCounters } = await import('../src/ed3/model.js');
  const { parseEd3 } = await import('../src/ed3/model.js');
  const { clampCounters } = parseEd3({ Relay_state: [false, false] });
  const { targets } = parseCounters(
    [11, 19, 24, 25].map((n) => ({ _id: 851968 + n, index: 1000 })),
    undefined,
    clampCounters,
  );
  assert.deepEqual([...targets.keys()], ['c25']);
  app.stop();
});

test('a slot found a duplicate: nothing in Discover, no command may leave, whatever asks', async () => {
  const { app, gladys, start } = await setup({ config: R1, devices: [switchOf('r1')] });
  await start();
  app.duplicateOf = 1;
  app.published = undefined;
  await app.publishDevices();
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.equal(app.mayDrive(true), false);
  assert.equal(app.mayDrive(false), false);
  app.stop();
});

test('/data unreadable, no device: the ED3 read is never set as the owner over the file', async () => {
  const store = memoryStore();
  store.unreadable = true;
  const { app, start, wait } = await setup({ store, fresh: true });
  await start();
  await wait(10 * SECOND);
  assert.equal(app.verdict, 'unbound');
  assert.equal(app.memory.owner, null);
  app.stop();
});

test('Attach: the second click when /data cannot be written keeps nothing and says so', async () => {
  const device = switchOf('r1');
  const world = fakeEd3({ mac: undefined });
  const { app, gladys, start, cmd, wait, store } = await setup({
    config: R1,
    devices: [device],
    world,
  });
  await start();
  const before = store.data.owner;
  await gladys.fake.configUpdated({ ...R1, host: '192.168.1.62' });
  await wait(10 * SECOND);
  assert.equal(app.verdict, 'different');
  await gladys.fake.action('attach_devices', { ed3: '1' });
  store.fail = true;
  const second = await gladys.fake.action('attach_devices', { ed3: '1' });
  assert.match(second.data.message.en, /\/data/);
  assert.equal(app.verdict, 'different');
  assert.deepEqual(app.memory.owner, before);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  app.stop();
});
