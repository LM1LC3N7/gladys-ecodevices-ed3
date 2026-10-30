// -----------------------------------------------------------------------------
// End to end: the app against the SDK's fake Gladys, a fake Eco-Devices 3 and
// a virtual clock whose reads always move (poll interval 10 s in the tests).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMINGS } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { KEY, fakeEd3 } from './helpers/fakeEd3.js';
import { ADDRESS, CONFIG, F, SECOND, created, settle, setup } from './helpers/app.js';

/** The rounds: the full read of `object/ed3/0` (the read backs ask `filter_state`). */
const rounds = (world) =>
  world.requests.filter((r) => /\/api\/object\/ed3\/0\?ApiKey/.test(r.path));
const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';

const relays = (list = 'R1, R2:light') => ({ ...CONFIG, relays: list });

// --- Reads ----------------------------------------------------------------------

test('start: the ED3, its counters, X-8R and X-THL discovered, connected; nothing secret in /data', async () => {
  const { app, gladys, start, store, world } = await setup();
  await start();
  assert.equal(rounds(world).length, 1);
  assert.equal(world.peak, 1, 'one request at a time');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    message(gladys),
    /Eco-Devices 3: 10 relay\(s\), 5 counter\(s\), 2 clamp\(s\), 1 X-THL/,
  );
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  for (const id of ['relay:r1', 'relay:x8r4259840-8', 'counter:c0', 'counter:c25', 'clamp:t2']) {
    assert.ok(ids.includes(`ext:ed3:${id}`), id);
  }
  assert.ok(ids.includes('ext:ed3:mains:mains'));
  assert.ok(ids.includes('ext:ed3:thl:xthl4325376'));
  assert.ok(!ids.includes('ext:ed3:counter:c12'), 'a counter at 0 is not offered');
  assert.ok(!ids.includes('ext:ed3:clamp:t3'), 'a clamp without counter is not offered');
  const relay = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:ed3:relay:r1');
  assert.equal(relay.features.length, 1);
  assert.equal(relay.features[0].external_id, F('relay', 'r1', 'readonly'));
  assert.equal(relay.features[0].read_only, true, 'a relay not declared is read only');
  const names = gladys.fake.discoveredDevices.map((d) => d.name);
  assert.ok(names.includes('Cuisine · Consommation (C11)'), names.join(' | '));
  assert.ok(names.includes('X8R N°0 relais 2 (X8R4259840-2)'));
  const json = JSON.stringify(store.data);
  assert.doesNotMatch(json, new RegExp(KEY));
  assert.doesNotMatch(json, /192\.168/);
  assert.equal(gladys.fake.states.length, 0, 'no state before a device is created');
  app.stop();
});

test('values: clamps in W, the voltage, X-THL, relays (X-8R state, not command); the categories', async () => {
  const devices = [
    created('clamp', 't1'),
    created('mains', 'mains'),
    created('thl', 'xthl4325376'),
    created('relay', 'x8r4259840-1'),
    created('relay', 'r2'),
  ];
  const world = fakeEd3();
  world.relays[1] = true;
  world.x8r[0].state[0] = false;
  const { app, gladys, start } = await setup({ devices, world });
  await start();
  await app.flush();
  assert.equal(gladys.fake.lastState(F('clamp', 't1', 'power')), 56.5);
  assert.equal(gladys.fake.lastState(F('mains', 'mains', 'voltage')), 236.4);
  assert.equal(gladys.fake.lastState(F('thl', 'xthl4325376', 'temperature')), 21.5);
  assert.equal(gladys.fake.lastState(F('thl', 'xthl4325376', 'luminosity')), 300);
  assert.equal(gladys.fake.lastState(F('relay', 'x8r4259840-1', 'readonly')), 0);
  assert.equal(gladys.fake.lastState(F('relay', 'r2', 'readonly')), 1);
  const features = Object.fromEntries(
    gladys.fake.discoveredDevices.flatMap((d) => d.features).map((f) => [f.external_id, f]),
  );
  const kind = (id) => [features[id].category, features[id].type, features[id].unit].join('/');
  assert.equal(kind(F('counter', 'c0', 'index')), 'energy-sensor/index/kilowatt-hour');
  assert.equal(kind(F('counter', 'c11', 'index')), 'energy-sensor/index/kilowatt-hour');
  assert.equal(kind(F('counter', 'c19', 'index')), 'grid-sensor/output-index/kilowatt-hour');
  assert.equal(kind(F('counter', 'c20', 'index')), 'energy-production-sensor/index/kilowatt-hour');
  assert.equal(kind(F('counter', 'c25', 'index')), 'volume-sensor/decimal/cubicmeter');
  assert.equal(kind(F('clamp', 't1', 'power')), 'energy-sensor/power/watt');
  app.stop();
});

test('pace: never two rounds within the interval, whatever asks; restart keeps the pace', async () => {
  const { app, gladys, start, wait, world, store, clock } = await setup();
  await start();
  assert.equal(rounds(world).length, 1);
  await gladys.fake.scanRequest();
  await gladys.fake.configUpdated({ ...CONFIG, language: 'en' });
  await app.testConnection();
  await app.connected(CONFIG);
  await wait(5 * SECOND);
  assert.equal(rounds(world).length, 1, 'nothing before the interval');
  await wait(5 * SECOND);
  assert.equal(rounds(world).length, 2);
  await wait(60 * SECOND);
  assert.equal(rounds(world).length, 8);
  app.stop();
  const again = await setup({ store, clock });
  await again.start();
  assert.equal(rounds(again.world).length, 0, 'read less than an interval ago');
  await again.wait(10 * SECOND);
  assert.equal(rounds(again.world).length, 1);
  again.app.stop();
});

test('a text, a missing key or 0 V is never published as 0', async () => {
  const devices = [
    created('thl', 'xthl4325376'),
    created('mains', 'mains'),
    created('relay', 'r1'),
  ];
  const world = fakeEd3();
  world.xthl[0].Temperature = 'n/a';
  world.xthl[0].Luminosite = null;
  world.urms = 0;
  world.relays[0] = '';
  const { app, gladys, start } = await setup({ world, devices });
  await start();
  await app.flush();
  const ids = gladys.fake.states.map((s) => s.device_feature_external_id);
  assert.ok(!ids.includes(F('thl', 'xthl4325376', 'temperature')));
  assert.ok(!ids.includes(F('thl', 'xthl4325376', 'luminosity')));
  assert.equal(gladys.fake.lastState(F('thl', 'xthl4325376', 'humidity')), 45);
  assert.ok(!ids.includes(F('mains', 'mains', 'voltage')));
  assert.ok(!ids.includes(F('relay', 'r1', 'readonly')));
  app.stop();
});

test('a secondary read failing (even 401) never stops the round; the ED3 itself does', async () => {
  const world = fakeEd3();
  const devices = [created('relay', 'r1'), created('thl', 'xthl4325376')];
  const { app, gladys, start, wait } = await setup({ world, devices });
  await start();
  world.failPaths.set('ebx/x8r', 500);
  world.failPaths.set('ebx/xthl', 401);
  world.failPaths.set('object/core_logger', 404);
  world.relays[0] = true;
  await wait(10 * SECOND);
  await app.flush();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(app.refusedApplies(), false, 'a 401 of a secondary read is no refused key');
  assert.match(message(gladys), /Not read this time.*counters.*X-8R.*X-THL/);
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'readonly')), 1);
  assert.ok(app.model.has('x8r4259840-3'), 'the X-8R read before is kept');
  assert.equal(app.model.get('x8r4259840-3').value, undefined, 'not read: no value');
  assert.equal(app.model.get('xthl4325376').value, undefined);
  assert.equal(app.model.get('c0').value, undefined);
  assert.ok(
    gladys.fake.discoveredDevices.some((d) => d.external_id === 'ext:ed3:counter:c0'),
    'a counter seen before stays in Discover',
  );
  world.failPaths.set('object/ed3/0', 500);
  await wait(10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  app.stop();
});

test('a failed round pauses (kept in /data); a refused key stops the reads until it changes', async () => {
  const world = fakeEd3();
  const { app, gladys, start, wait, store } = await setup({ world });
  world.queue.push(new Error('boom'));
  world.queue.push({ status: 503, json: {} });
  await start();
  await wait(10 * SECOND);
  assert.match(message(gladys), /asks to wait/);
  assert.equal(store.data.pause.code, 'busy');
  // The 503 came at about 0 s (the identity check took the first answer): nothing until 60 s.
  const before = world.requests.length;
  await wait(48 * SECOND);
  assert.deepEqual(world.requests.slice(before), [], 'a minute at least when the ED3 asks to wait');
  app.stop();

  const refused = await setup({ config: { ...CONFIG, api_key: 'wrong-key' } });
  await refused.start();
  assert.match(message(refused.gladys), /refused the API key/);
  assert.ok(refused.store.data.refused);
  assert.doesNotMatch(JSON.stringify(refused.store.data), /wrong-key/);
  const count = refused.world.requests.length;
  await refused.wait(10 * 60 * SECOND);
  assert.equal(refused.world.requests.length, count, 'no read by itself');
  await refused.gladys.fake.configUpdated(CONFIG);
  await refused.wait(1000);
  assert.equal(refused.gladys.fake.connectionStatus.connected, true, 'a new key reads again');
  refused.app.stop();
});

test('getConfig failing in "connected" is tried again with a status, then the integration starts', async () => {
  let calls = 0;
  const { app, gladys, wait, world } = await setup({
    getConfig: async () => {
      calls += 1;
      if (calls === 1) throw new Error('Gladys busy');
      return CONFIG;
    },
  });
  await app.onConnected(() => gladys.getConfig());
  assert.match(message(gladys), /could not be read from Gladys: new try in 5 s/);
  assert.equal(world.requests.length, 0);
  await wait(6 * SECOND);
  assert.equal(calls, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(rounds(world).length, 1);
  // A reconnection to Gladys reads the configuration again, without a new round.
  await app.onConnected(() => gladys.getConfig());
  await wait(100);
  assert.equal(rounds(world).length, 1);
  app.stop();
});

// --- Commands: relays -------------------------------------------------------------

test('a relay not declared is read only: refused, nothing sent, whatever its feature; X-8R too', async () => {
  const device = created('relay', 'r2', { relayKind: 'switch' });
  const x8r = created('relay', 'x8r4259840-1', { relayKind: 'switch' });
  const { app, start, cmd, world } = await setup({ config: relays('R1'), devices: [device, x8r] });
  await start();
  const ack = await cmd(device, F('relay', 'r2', 'switch'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /lecture seule/);
  const off = await cmd(device, F('relay', 'r2', 'switch'), 0);
  assert.match(off.error, /lecture seule/, 'even a switch-off of an undeclared relay');
  const ext = await cmd(x8r, F('relay', 'x8r4259840-1', 'switch'), 0);
  assert.match(ext.error, /lecture seule/);
  const sensor = await cmd(device, F('clamp', 't1', 'power'), 0);
  assert.match(sensor.error, /lecture seule/);
  assert.equal(world.writes().length, 0);
  app.stop();
});

test('a declared relay: on and off written, confirmed by a read back that left after the write', async () => {
  const device = created('relay', 'r2', { relayKind: 'light' });
  const { app, start, cmd, world, gladys } = await setup({ config: relays(), devices: [device] });
  await start();
  const on = await cmd(device, F('relay', 'r2', 'light'), 1);
  assert.equal(on.success, true, on.error);
  assert.equal(world.relays[1], true);
  const writes = world.writes();
  assert.match(writes[0].path, /^\/api\/object\/ed3\/0\/SetOnR\/2\?ApiKey=/);
  const readBack = world.requests.at(-1);
  assert.match(readBack.path, /option=filter_state/);
  assert.ok(readBack.sentAt > writes[0].end, 'the read back left after the answer of the write');
  await app.flush();
  assert.equal(gladys.fake.lastState(F('relay', 'r2', 'light')), 1);
  const off = await cmd(device, F('relay', 'r2', 'light'), 0);
  assert.equal(off.success, true, off.error);
  assert.match(world.writes()[1].path, /SetOffR\/2/);
  app.stop();
});

test('a read back equal to the state before is "not applied yet"; a lost answer is "sent, without confirmation"', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeEd3();
  const { app, start, cmd } = await setup({ config: relays(), devices: [device], world });
  await start();
  world.ignoreWrites = true;
  const ack = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(ack.error, /lit éteint \(demandé : allumé\) : pas encore appliquée/);
  world.ignoreWrites = false;
  world.latency = (r) => (/SetOnR/.test(r.path) ? 10 * SECOND : 20);
  const lost = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(lost.error, /Envoyée, sans confirmation/);
  world.latency = 20;
  world.refuseConnect = 1;
  const refused = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.match(refused.error, /rien n’a été envoyé/, 'refused before leaving: not sent');
  app.stop();
});

test('a scene on both relays of a slow ED3 (900 ms a request) sets both, acks within 5 s', async () => {
  const devices = [1, 2].map((n) => created('relay', `r${n}`, { relayKind: 'switch' }));
  const world = fakeEd3();
  const { app, start, act, gladys, elapsed } = await setup({
    config: relays('R1, R2'),
    devices,
    world,
  });
  await start();
  world.latency = 900;
  const t0 = elapsed();
  const acks = await act(
    Promise.all(devices.map((d) => gladys.fake.setValue(d, d.features[0], 1))),
  );
  assert.ok(elapsed() - t0 < 5 * SECOND);
  for (const ack of acks) assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.relays, [true, true]);
  assert.equal(world.peak, 1);
  app.stop();
});

test('the switch-off goes during a pause, with the queue full, and cuts a slow read', async () => {
  const r1 = created('relay', 'r1', { relayKind: 'switch' });
  const r2 = created('relay', 'r2', { relayKind: 'switch' });
  // Known by its address (no MAC in system/info): a failed round leaves nothing to re-check.
  const world = fakeEd3({ mac: undefined });
  world.relays = [true, true];
  const { app, start, cmd, act, gladys, wait, elapsed } = await setup({
    config: relays('R1, R2'),
    devices: [r1, r2],
    world,
  });
  await start();
  // A slow read in flight (4 s): the switch-off cuts it, leaves at once, no failure.
  world.latency = (r) => (/core_logger/.test(r.path) && !world.fast ? 4 * SECOND : 20);
  await wait(10 * SECOND);
  assert.equal(world.inFlight, 1, 'a read in flight');
  const t0 = elapsed();
  world.fast = true;
  const off = await cmd(r1, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  const write = world.writes()[0];
  assert.ok(write.sentAt - t0 < 50, `the switch-off left ${write.sentAt - t0} ms after the click`);
  assert.equal(world.peak, 1, 'the read was closed before the switch-off opened its connection');
  assert.equal(gladys.fake.connectionStatus.connected, true, 'a cut read is not a failure');
  assert.equal(app.pause, undefined);
  // A pause: the ED3 failing its reads.
  world.relays[0] = true;
  world.failReads = 500;
  await wait(10 * SECOND);
  assert.ok(app.pause, 'paused');
  const on = await cmd(r2, F('relay', 'r2', 'switch'), 1);
  assert.match(on.error, /ne répond pas/, 'a switch-on is refused during the pause');
  const off2 = await cmd(r1, F('relay', 'r1', 'switch'), 0);
  assert.match(off2.error, /Envoyée/, 'sent (its read back failed with the reads)');
  assert.equal(world.relays[0], false);
  world.failReads = undefined;
  // The queue full of slow commands.
  world.relays[0] = true;
  app.pause = undefined;
  world.latency = 2 * SECOND;
  const many = [];
  for (let i = 0; i < 20; i += 1) many.push(gladys.fake.setValue(r2, r2.features[0], 1));
  const stop = gladys.fake.setValue(r1, r1.features[0], 0);
  const acks = await act(Promise.all([...many, stop]));
  assert.ok(
    acks.slice(0, 20).some((a) => /Trop de commandes/.test(a.error ?? '')),
    'the queue was full',
  );
  assert.equal(acks[20].success, true, acks[20].error);
  assert.equal(world.relays[0], false);
  app.stop();
});

test('a refused key: the switch-off is still tried', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeEd3({ key: 'another' });
  const { app, start, cmd } = await setup({ config: relays('R1'), devices: [device], world });
  await start();
  assert.ok(app.refusedApplies());
  const before = world.requests.length;
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, false);
  assert.ok(world.requests.length > before, 'tried');
  assert.match(off.error, /refusé la clé d’API/);
  app.stop();
});

test('right after a restart, before any read: the switch-off leaves (the relays are known)', async () => {
  const device = created('relay', 'r2', { relayKind: 'switch' });
  const first = await setup({ config: relays('R2'), devices: [device] });
  await first.start();
  first.app.stop();
  const world = fakeEd3();
  world.relays[1] = true;
  // Every read hangs: the switch-off must not wait for one (the MAC check included).
  world.latency = (r) => (/SetOffR/.test(r.path) ? 20 : 60 * SECOND);
  const second = await setup({
    config: relays('R2'),
    devices: [device],
    store: first.store,
    clock: first.clock,
    world,
  });
  await second.app.connected(relays('R2'));
  const off = await second.cmd(device, F('relay', 'r2', 'switch'), 0);
  assert.equal(world.relays[1], false);
  assert.match(world.writes()[0].path, /SetOffR\/2/);
  assert.notEqual(off.error, undefined, 'unconfirmed while the reads hang');
  second.app.stop();
});

test('nothing asked before a switch-off leaves after it: the waiting switch-on is cancelled', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeEd3();
  const { app, start, act, gladys } = await setup({
    config: relays('R1'),
    devices: [device],
    world,
  });
  await start();
  world.latency = 1500;
  const feature = device.features[0];
  const results = await act(
    Promise.all([
      gladys.fake.setValue(device, feature, 1),
      gladys.fake.setValue(device, feature, 1),
      settle(2).then(() => gladys.fake.setValue(device, feature, 0)),
    ]),
  );
  assert.equal(world.relays[0], false, 'the switch-off is the last written');
  const writes = world.writes().map((w) => /Set(On|Off)R/.exec(w.path)[1]);
  assert.equal(writes.at(-1), 'Off');
  assert.ok(writes.filter((w) => w === 'On').length <= 1, 'the second switch-on never left');
  assert.match(results[1].error, /Annulée|Interrompue/);
  app.stop();
});

test('a switch-off the ED3 does not apply is sent again by the reads, 3 times at most, then told; never lifted by time', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, cmd, wait, gladys, store } = await setup({
    config: relays('R1'),
    devices: [device],
    world,
  });
  await start();
  world.ignoreWrites = true;
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.match(off.error, /pas encore appliquée/);
  for (let i = 0; i < 6; i += 1) await wait(10 * SECOND);
  const writes = world.writes().filter((w) => /SetOffR\/1/.test(w.path));
  assert.equal(writes.length, 1 + TIMINGS.resendMax);
  assert.match(message(gladys), /not applied after 3 tries.*R1/);
  assert.equal(store.data.guards[0].code, 'r1');
  await wait(3600 * SECOND);
  assert.ok(app.guards.has('r1'), 'never lifted by time');
  // Applied at last (by hand on the ED3): confirmed.
  world.relays[0] = false;
  await wait(10 * SECOND);
  assert.equal(app.guards.get('r1').confirmed, true);
  app.stop();
});

test('a confirmed switch-off is released by another value read twice in a row, not once', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, cmd, wait } = await setup({ config: relays('R1'), devices: [device], world });
  await start();
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(app.guards.get('r1').confirmed, true);
  // After the follow-up reads of the command (5 s, 20 s), just after a round.
  await wait(25 * SECOND);
  world.relays[0] = true;
  await wait(10 * SECOND);
  assert.ok(app.guards.has('r1'), 'read once: still held');
  await wait(10 * SECOND);
  assert.ok(!app.guards.has('r1'), 'read twice: changed on the ED3');
  assert.equal(world.writes().length, 1, 'never sent again over a change made on the ED3');
  app.stop();
});

test('a later switch-on that left lifts the guard; refused by the ED3 (429), it does not', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, cmd } = await setup({ config: relays('R1'), devices: [device], world });
  await start();
  world.ignoreWrites = true;
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.ok(app.guards.has('r1'));
  world.queue.push((r) => (/SetOnR/.test(r.path) ? { status: 429, json: {} } : undefined));
  await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.ok(app.guards.has('r1'), 'a 429 is not a newer command');
  world.ignoreWrites = false;
  const on = await cmd(device, F('relay', 'r1', 'switch'), 1);
  assert.equal(on.success, true, on.error);
  assert.ok(!app.guards.has('r1'));
  app.stop();
});

test('the API key is never in the logs, the statuses nor /data, even on failures', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const world = fakeEd3();
  const { app, start, cmd, wait, lines, store, gladys } = await setup({
    config: relays('R1'),
    devices: [device],
    world,
  });
  await start();
  world.queue.push(new Error(`GET http://${ADDRESS}/api/object/ed3/0?ApiKey=${KEY}`));
  await wait(10 * SECOND);
  world.refuseConnect = 50;
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  await wait(30 * SECOND);
  const all = [
    ...lines,
    JSON.stringify(store.data),
    JSON.stringify(gladys.fake.connectionStatuses),
    JSON.stringify(gladys.fake.discoveredDevices),
  ].join('\n');
  assert.ok(!all.includes(KEY), 'the key leaked');
  app.stop();
});

test('/data unreadable is not empty: nothing written over it, no index, the switch-off still goes', async () => {
  const device = created('relay', 'r1', { relayKind: 'switch' });
  const counter = created('counter', 'c0');
  const store = memoryStore({ key: 'x', guards: [] });
  store.unreadable = true;
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, cmd, gladys } = await setup({
    config: relays('R1'),
    devices: [device, counter],
    store,
    world,
  });
  await start();
  assert.equal(store.saves, 0);
  assert.match(message(gladys), /\/data/);
  const off = await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(world.relays[0], false);
  await app.flush();
  assert.equal(gladys.fake.lastState(F('counter', 'c0', 'index')), undefined, 'no index');
  app.stop();
});

test('nothing stale at "connected" nor at a device created long after the last read', async () => {
  const device = created('relay', 'r1');
  const world = fakeEd3();
  const { app, start, gladys, wait } = await setup({ world });
  await start();
  world.queue.push(new Error('down'), new Error('down'), new Error('down'));
  await wait(10 * SECOND);
  const count = gladys.fake.states.length;
  await gladys.fake.deviceCreated(device);
  await app.connected(CONFIG);
  await app.flush();
  assert.equal(gladys.fake.states.length, count, 'no old value republished');
  app.stop();
});

test('the test button reads now once due, refused key included, and stays paced', async () => {
  const { app, start, world, wait, act } = await setup({
    config: { ...CONFIG, api_key: 'nope' },
  });
  await start();
  const before = rounds(world).length;
  await wait(10 * SECOND);
  world.key = 'nope';
  const text = await act(app.testConnection());
  assert.match(text.en, /Connected/);
  assert.equal(rounds(world).length, before + 1);
  assert.equal(app.refusedApplies(), false);
  const again = await act(app.testConnection());
  assert.equal(rounds(world).length, before + 1, 'cooldown');
  assert.ok(again);
  app.stop();
});

test('only R1 and R2 are ever written: an X-8R output or a sensor never, whatever asks', async () => {
  const { app, start, world } = await setup({ config: relays('R1, R2') });
  await start();
  const client = app.client;
  for (const target of [
    app.model.get('x8r4259840-1'),
    app.model.get('t1'),
    { code: 'r3', kind: 'relay', n: 3 },
  ]) {
    await assert.rejects(app.write(client, target, 0, 0, {}), { code: 'bad_request' });
  }
  await assert.rejects(app.write(client, app.model.get('r1'), 2, 0, {}), { code: 'bad_request' });
  assert.equal(world.writes().length, 0);
  app.stop();
});
