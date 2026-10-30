// -----------------------------------------------------------------------------
// Which Eco-Devices 3 the devices belong to (the owner in /data: the salted
// hash of its MAC when `system/info` gives one, else its address and port):
// a device made for one ED3 never gets the values of another one nor drives
// its relays, a switch-off kept for the old one neither; another GCE box at
// the address is said; the Discover list shows only the ED3 really read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controllerKey, normalizeConfig } from '../src/config.js';
import { TIMINGS } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { MAC, fakeEd3 } from './helpers/fakeEd3.js';
import { CONFIG, F, SECOND, boundMemory, created, setup } from './helpers/app.js';

const OTHER_HOST = '192.168.1.61';
const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const discovered = (gladys) => (gladys.fake.discoveredDevices ?? []).map((d) => d.external_id);
const switchOf = (code) => created('relay', code, { relayKind: 'switch' });
const RELAYS = { ...CONFIG, relays: 'R1, R2' };

/** An ED3 at ADDRESS and another box at OTHER_HOST behind one transport (one house). */
function twoBoxes(other) {
  const ed3 = fakeEd3();
  const there = other ?? fakeEd3({ mac: '00:04:a3:5e:00:77' });
  const world = {
    set clock(clock) {
      ed3.clock = clock;
      there.clock = clock;
    },
    transport: (options, hooks) =>
      (options.hostname === OTHER_HOST ? there : ed3).transport(options, hooks),
  };
  return { world, ed3, there };
}

// --- Never another box -------------------------------------------------------------------

test('another ED3 typed at the address of the devices: nothing reaches it, nothing of it published', async () => {
  const devices = [switchOf('r1'), switchOf('r2'), created('counter', 'c0')];
  const { world, ed3, there } = twoBoxes();
  const { app, gladys, start, wait, cmd } = await setup({ config: RELAYS, devices, world });
  await start();
  assert.equal((await cmd(devices[0], F('relay', 'r1', 'switch'), 1)).success, true);
  assert.equal(ed3.writes().length, 1);
  there.relays[1] = true;
  there.index.set(0, 99_000_000);
  await gladys.fake.configUpdated({ ...RELAYS, host: OTHER_HOST });
  // Before it is even read: the owner is known by its MAC, to be checked first.
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, false);
  assert.match(off.error, /n’est pas celui pour lequel cet appareil a été créé|nouvelle adresse/);
  await wait(10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    message(gladys),
    /The Eco-Devices 3 \(MAC …5e:00:77\) at this address is not the one/,
  );
  assert.match(message(gladys), /"Attach the devices" twice/);
  assert.deepEqual(discovered(gladys), [], 'nothing of the other one under these ids');
  for (const value of [0, 1]) {
    const ack = await cmd(devices[1], F('relay', 'r2', 'switch'), value);
    assert.equal(ack.success, false);
  }
  assert.equal(there.writes().length, 0, 'not one write to the other ED3');
  await wait(2 * 60 * SECOND);
  await app.flush();
  assert.notEqual(gladys.fake.lastState(F('relay', 'r2', 'switch')), 1);
  assert.notEqual(gladys.fake.lastState(F('counter', 'c0', 'index')), 99000);
  app.stop();
});

test('an IPX800 V5, an IPX800 V4 or an Eco-Devices RT2 at the address: said, no key refused, nothing sent', async () => {
  for (const kind of ['ipx800v5', 'xdevices']) {
    const device = switchOf('r1');
    const world = fakeEd3({ mac: undefined });
    world.other = kind;
    const { app, gladys, store, start, cmd, wait } = await setup({
      config: { ...CONFIG, relays: 'R1' },
      devices: [device],
      world,
    });
    await start();
    const box = kind === 'ipx800v5' ? /an IPX800 V5/ : /an IPX800 V4 or an Eco-Devices RT2/;
    assert.match(message(gladys), /This address answers as/);
    assert.match(message(gladys), box);
    assert.match(message(gladys, 'fr'), /pas un Eco-Devices 3/);
    assert.equal(store.data.refused, null);
    assert.deepEqual(discovered(gladys), []);
    const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
    assert.equal(on.success, false);
    assert.equal(world.writes().length, 0);
    await wait(30 * SECOND);
    assert.match((await app.testConnection()).en, /answers as/);
    app.stop();
  }
});

test('a wrong key on an ED3 is still a refused key (no other box answers)', async () => {
  const { app, gladys, store, start } = await setup({
    config: { ...CONFIG, api_key: 'wrong' },
    fresh: true,
  });
  await start();
  assert.match(message(gladys), /refused the API key/);
  assert.ok(store.data.refused);
  app.stop();
});

test('an ED3 swapped at the same address: the switch-off kept for the old one is never sent to it', async () => {
  const device = switchOf('r1');
  const world = fakeEd3();
  world.relays[0] = true;
  const store = memoryStore();
  const config = { ...CONFIG, relays: 'R1' };
  const first = await setup({ config, devices: [device], world, store });
  await first.start();
  world.latency = (r) => (/SetOffR/.test(r.path) ? 6 * SECOND : 20);
  const ack = await first.cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.match(ack.error, /sans confirmation/);
  await first.app.shutdown();
  assert.deepEqual(
    store.data.guards.map((g) => g.code),
    ['r1'],
  );
  world.latency = 20;
  world.mac = '00:04:a3:5e:00:99';
  const before = world.writes().length;
  const again = await setup({ config, devices: [device], world, store, clock: first.clock });
  await again.start();
  assert.equal(world.writes().length, before, 'the switch-off kept never left for the new ED3');
  assert.deepEqual(store.data.guards, []);
  assert.match(
    message(again.gladys),
    /Eco-Devices 3 \(MAC …5e:00:99\) at this address is not the one/,
  );
  const off = await again.cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.match(off.error, /n’est pas celui/);
  assert.equal(world.writes().length, before);
  again.app.stop();
});

test('the same ED3 after a restart: its MAC first, then the switch-off kept goes', async () => {
  const device = switchOf('r1');
  const world = fakeEd3();
  world.relays[0] = true;
  const store = memoryStore();
  const config = { ...CONFIG, relays: 'R1' };
  const first = await setup({ config, devices: [device], world, store });
  await first.start();
  world.latency = (r) => (/SetOffR/.test(r.path) ? 6 * SECOND : 20);
  await first.cmd(device, F('relay', 'r1', 'switch'), 0);
  await first.app.shutdown();
  world.latency = 20;
  const from = world.requests.length;
  const again = await setup({ config, devices: [device], world, store, clock: first.clock });
  await again.start();
  const paths = world.requests.slice(from).map((r) => r.path.split('?')[0]);
  assert.deepEqual(paths.slice(0, 2), ['/api/system/info', '/api/object/ed3/0/SetOffR/1']);
  again.app.stop();
});

test('a round finding another MAC mid-session: the switch-offs kept are dropped, nothing sent any more', async () => {
  const device = switchOf('r1');
  const world = fakeEd3();
  const { app, store, start, wait, cmd, gladys } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
    world,
  });
  await start();
  world.ignoreWrites = true;
  world.relays[0] = true;
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(store.data.guards.length, 1, 'contradicted: kept');
  await wait(21 * SECOND);
  world.mac = '00:04:a3:5e:00:42';
  const writes = world.writes().length;
  await wait(30 * SECOND);
  assert.equal(world.writes().length, writes, 'no resend to the other ED3');
  assert.deepEqual(store.data.guards, []);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 0)).success, false);
  app.stop();
});

test('MAC unreadable (an owner known by it): a switch-off still goes, a switch-on is refused; at a new address nothing goes', async () => {
  const device = switchOf('r1');
  const world = fakeEd3({ mac: undefined });
  const { app, gladys, start, wait, cmd, store } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
    world,
    store: memoryStore(boundMemory(CONFIG, MAC)),
  });
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(store.data.owner.kind, 'mac');
  assert.match(message(gladys), /MAC address could not be read this time/);
  const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(on.error, /MAC de l’Eco-Devices 3 n’est pas encore lue/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 0)).success, true);
  assert.equal(world.writes().length, 1);
  await gladys.fake.configUpdated({ ...CONFIG, host: '192.168.1.77', relays: 'R1' });
  await wait(10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys), /At this new address, its MAC address could not be read/);
  assert.deepEqual(discovered(gladys), []);
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.match(off.error, /nouvelle adresse/);
  assert.equal(world.writes().length, 1);
  app.stop();
});

test('a fresh ED3 without MAC in system/info is known by its address, then by its MAC, never back', async () => {
  const world = fakeEd3({ mac: undefined });
  const { app, store, start, wait, gladys } = await setup({ world, fresh: true });
  await start();
  const key = normalizeConfig(CONFIG).key;
  assert.deepEqual(store.data.owner, { kind: 'address', id: key, at: key });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.doesNotMatch(message(gladys), /MAC/, 'no MAC is no warning when none was ever read');
  world.mac = MAC;
  await wait(10 * SECOND);
  assert.equal(store.data.owner.kind, 'mac');
  assert.doesNotMatch(JSON.stringify(store.data), /00:04:a3/, 'never the MAC itself');
  world.mac = undefined;
  await wait(10 * SECOND);
  assert.equal(store.data.owner.kind, 'mac', 'no downgrade');
  assert.equal(app.verdict, 'unverified');
  app.stop();
});

// --- Attach --------------------------------------------------------------------------

test('an ED3 known by its address, moved to another one: refused until "Attach the devices" is clicked twice', async () => {
  const device = switchOf('r1');
  const world = fakeEd3({ mac: undefined });
  const { app, gladys, store, start, wait, cmd } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
    world,
  });
  await start();
  const moved = { ...CONFIG, host: '192.168.1.62', relays: 'R1' };
  await gladys.fake.configUpdated(moved);
  await wait(10 * SECOND);
  assert.match(message(gladys), /The Eco-Devices 3 at this address is not the one/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  const first = await gladys.fake.action('attach_devices', { ed3: '1' });
  assert.match(first.data.message.en, /Click again within a minute to attach the 1 device\(s\)/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  assert.equal(world.writes().length, 0);
  await wait(TIMINGS.attachConfirm + SECOND);
  const late = await gladys.fake.action('attach_devices', { ed3: '1' });
  assert.match(late.data.message.en, /Click again/, 'a second click after a minute asks again');
  const done = await gladys.fake.action('attach_devices', { ed3: '1' });
  assert.match(done.data.message.fr, /C’est fait : les 1 appareil\(s\) de l’ED3 n°1/);
  assert.equal(store.data.owner.id, controllerKey('192.168.1.62', 80));
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(discovered(gladys).includes('ext:ed3:relay:r1'));
  const again = await gladys.fake.action('attach_devices', { ed3: '1' });
  assert.match(again.data.message.en, /already belong/);
  app.stop();
});

test('Attach: nothing read yet, or the ED3 not answering: refused', async () => {
  const world = fakeEd3();
  world.refuseConnect = 99;
  const { app, start } = await setup({ world, devices: [switchOf('r1')] });
  assert.match((await app.attach()).en, /No Eco-Devices 3 read right now/);
  await start();
  assert.match((await app.attach()).en, /No Eco-Devices 3 read right now/);
  app.stop();
});

test('a slot whose devices are all gone takes the ED3 read as its owner', async () => {
  const world = fakeEd3({ mac: '00:04:a3:5e:00:55' });
  const { app, gladys, store, start } = await setup({ world });
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(discovered(gladys).length > 0);
  assert.notDeepEqual(store.data.owner, boundMemory(CONFIG).owner);
  app.stop();
});

// --- /data unreadable ------------------------------------------------------------------

test('/data unreadable: no owner set over it, a switch-off goes, a switch-on waits for it', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  store.unreadable = true;
  const config = { ...CONFIG, relays: 'R1' };
  const { app, gladys, start, wait, cmd, world } = await setup({
    config,
    devices: [device],
    store,
    fresh: true,
  });
  await start();
  assert.match(message(gladys), /state in \/data cannot be read/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 0)).success, true);
  assert.equal(world.writes().length, 1);
  assert.equal(store.data, null, 'nothing written over it');
  store.unreadable = false;
  store.data = boundMemory(config);
  await wait(10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  app.stop();
});

// --- The Discover list -------------------------------------------------------------

test('Discover: only what was read; emptied by a failure, a refused key, a bogus address', async () => {
  const world = fakeEd3();
  world.latency = 2 * SECOND;
  const { app, gladys, start, wait } = await setup({ world });
  const starting = app.connected(CONFIG);
  await wait(500);
  assert.deepEqual(discovered(gladys), [], 'not read yet');
  await starting;
  await start();
  await wait(15 * SECOND);
  assert.ok(discovered(gladys).includes('ext:ed3:relay:r1'));
  world.latency = 20;
  world.refuseConnect = 99;
  await wait(20 * SECOND);
  assert.deepEqual(discovered(gladys), [], 'unreachable');
  await gladys.fake.scanRequest();
  assert.deepEqual(discovered(gladys), []);
  world.refuseConnect = 0;
  await wait(60 * SECOND);
  assert.ok(discovered(gladys).length > 0);
  await gladys.fake.configUpdated({ ...CONFIG, host: '' });
  assert.deepEqual(discovered(gladys), [], 'no address: the old list goes');
  app.stop();
});

test('a device deleted: the Discover list again at once, without the switch of the deleted one', async () => {
  const device = switchOf('r2');
  const { app, gladys, start } = await setup({ config: RELAYS, devices: [device] });
  await start();
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1' });
  const before = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:ed3:relay:r2');
  assert.deepEqual(
    before.features.map((f) => f.external_id.split(':').pop()),
    ['readonly', 'switch'],
  );
  await gladys.fake.deviceDeleted(gladys.devices.find((d) => d.external_id === device.external_id));
  const after = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:ed3:relay:r2');
  assert.deepEqual(
    after.features.map((f) => f.external_id.split(':').pop()),
    ['readonly'],
  );
  app.stop();
});

// --- At start, while the MAC is read ----------------------------------------------------

test('at start a click waits for the MAC: a switch-on then goes; a switch-off waits 1.5 s at most', async () => {
  const device = switchOf('r1');
  const world = fakeEd3();
  const store = memoryStore();
  const config = { ...CONFIG, relays: 'R1' };
  const first = await setup({ config, devices: [device], world, store });
  await first.start();
  first.app.stop();
  world.latency = (r) => (/system\/info/.test(r.path) ? 800 : 20);
  const again = await setup({ config, devices: [device], world, store, clock: first.clock });
  const starting = again.app.connected(config);
  await again.wait(10);
  const on = await again.cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.equal(on.success, true, on.error);
  await starting;
  again.app.stop();

  world.latency = (r) => (/system\/info/.test(r.path) ? 4 * SECOND : 20);
  const third = await setup({ config, devices: [device], world, store, clock: first.clock });
  const restarting = third.app.connected(config);
  await third.wait(10);
  const clicked = first.clock.monotonic();
  const ack = await third.cmd(device, F('relay', 'r1', 'switch'), 0);
  const write = world.writes().at(-1);
  assert.match(write.path, /SetOffR\/1/, 'the switch-off left (same address as last checked)');
  const waited = write.at - clicked;
  assert.ok(
    waited >= TIMINGS.identityWait - 50 && waited <= TIMINGS.identityWait + 200,
    `${waited} ms`,
  );
  assert.ok(ack.success || /sans confirmation/.test(ack.error), ack.error);
  await restarting;
  third.app.stop();
});

test('after a failed round, a switch-off reads the MAC first: another ED3 there gets nothing', async () => {
  const device = switchOf('r1');
  const world = fakeEd3();
  const { app, start, wait, cmd } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
    world,
  });
  await start();
  world.refuseConnect = 99;
  await wait(10 * SECOND);
  assert.equal(app.verdict, 'pending', 'no answer: to be checked again');
  world.refuseConnect = 0;
  world.mac = '00:04:a3:5e:00:66';
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.match(off.error, /n’est pas celui/);
  assert.equal(world.writes().length, 0);
  assert.deepEqual(
    world.requests.slice(-1).map((r) => r.path.split('?')[0]),
    ['/api/system/info'],
  );
  world.mac = MAC;
  app.verdict = 'same';
  app.recheck();
  const again = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(again.success, true, again.error);
  assert.equal(world.writes().length, 1);
  app.stop();
});

test('/data lost (a fresh file) with devices there: not bound to whatever answers, Attach asked', async () => {
  const device = switchOf('r1');
  const counter = created('counter', 'c0');
  const { app, gladys, store, start, cmd, world } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device, counter],
    fresh: true,
  });
  await start();
  await app.flush();
  assert.equal(store.data.owner, null);
  assert.match(message(gladys), /not known to belong to the Eco-Devices 3 read/);
  assert.equal(gladys.fake.lastState(F('counter', 'c0', 'index')), undefined, 'no value');
  for (const value of [0, 1]) {
    assert.equal((await cmd(device, F('relay', 'r1', 'switch'), value)).success, false);
  }
  assert.equal(world.writes().length, 0);
  await gladys.fake.action('attach_devices', { ed3: '1' });
  await gladys.fake.action('attach_devices', { ed3: '1' });
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  app.stop();
});

test('a command waiting in the queue is refused right before it leaves when another ED3 was found', async () => {
  const r1 = switchOf('r1');
  const r2 = switchOf('r2');
  const world = fakeEd3();
  const { app, start, act, gladys } = await setup({ config: RELAYS, devices: [r1, r2], world });
  await start();
  world.latency = (r) => (/SetOnR/.test(r.path) ? 1000 : 20);
  const first = gladys.fake.setValue(r1, { external_id: F('relay', 'r1', 'switch') }, 1);
  const second = gladys.fake.setValue(r2, { external_id: F('relay', 'r2', 'switch') }, 1);
  const flip = (async () => {
    while (world.writes().length === 0) await new Promise((r) => setImmediate(r));
    app.verdict = 'different';
  })();
  const [a, b] = await act(Promise.all([first, second, flip]));
  assert.equal(a.success !== undefined, true);
  assert.match(b.error, /n’est pas celui/);
  assert.equal(world.writes().length, 1, 'the second never left');
  app.stop();
});

test('a switch-on during a pause sends nothing at all, not even the check of the MAC', async () => {
  const device = switchOf('r1');
  const world = fakeEd3();
  const { app, start, wait, cmd } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
    world,
  });
  await start();
  world.failReads = 500;
  await wait(10 * SECOND);
  assert.ok(app.pause);
  assert.equal(app.verdict, 'pending', 'its MAC to be checked again');
  const before = world.requests.length;
  const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(on.error, /ne répond pas/);
  assert.equal(world.requests.length, before, 'no request to a paused ED3');
  app.stop();
});
