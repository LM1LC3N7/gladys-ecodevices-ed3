// -----------------------------------------------------------------------------
// The rules the IPX800 reviews (r1 to r3) found unguarded, on the relays of
// the ED3 (a switch-off is the protective command here): a clicked
// switch-off cuts any request, read backs and resends included; a guard put
// back never overwrites a newer one; a relay no longer listed is never driven
// again; a switch-off clicked before the configuration is read; one
// configuration at a time; acks within 5 s; an older command of ours handled
// late is no change on the ED3.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMINGS } from '../src/constants.js';
import { PRIORITY } from '../src/ed3/client.js';
import { memoryStore, normalizeMemory } from '../src/store.js';
import { fakeEd3 } from './helpers/fakeEd3.js';
import { CONFIG, F, SECOND, created, settle, setup } from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const cfg = (over = {}) => ({ ...CONFIG, relays: 'R1, R2', ...over });
const relayOf = (n) => created('relay', `r${n}`, { relayKind: 'switch' });
const both = () => [relayOf(1), relayOf(2)];

/** A promise whose settling time (virtual ms) is recorded. */
const timed = (clock, promise) => {
  const out = { at: undefined };
  out.promise = promise.then((value) => {
    out.at = clock.elapsed;
    return value;
  });
  return out;
};
/** The writes that left: `R1 Off`, `R2 On`. */
const leftWrites = (world) =>
  world
    .writes()
    .filter((w) => w.sentAt !== undefined)
    .map((w) => {
      const m = /Set(On|Off)R\/(\d)/.exec(w.path);
      return `R${m[2]} ${m[1]}`;
    });
const later = (clock, ms, fn) => new Promise((r) => clock.timers.setTimeout(r, ms)).then(fn);

test('B1: a clicked switch-off cuts the stuck read back of an earlier one and leaves at once', async () => {
  const relays = both();
  const world = fakeEd3();
  world.relays = [true, true];
  const { app, start, act, gladys, clock } = await setup({ config: cfg(), devices: relays, world });
  await start();
  // Every read hangs from now on (the ED3 takes the writes).
  world.latency = (r) => (/Set(On|Off)R/.test(r.path) ? 20 : 60 * SECOND);
  const first = gladys.fake.setValue(relays[0], relays[0].features[0], 0);
  await act(settle(5).then(() => new Promise((r) => clock.timers.setTimeout(r, 300))));
  const clicked = clock.elapsed;
  const acks = await act(
    Promise.all([first, gladys.fake.setValue(relays[1], relays[1].features[0], 0)]),
  );
  const write = world.writes().find((w) => /SetOffR\/2/.test(w.path));
  assert.ok(write, 'R2 off written');
  assert.ok(
    write.sentAt - clicked < 50,
    `R2 off left ${write.sentAt - clicked} ms after its click`,
  );
  assert.equal(world.relays[1], false);
  assert.equal(world.peak, 1);
  assert.ok(acks.every((a) => a.error === undefined || /Envoyée/.test(a.error)));
  app.stop();
});

test('B1: a clicked switch-off without answer for 1 s is cut when another one waits', async () => {
  const relays = both();
  const world = fakeEd3();
  world.relays = [true, true];
  const { app, start, act, gladys, clock } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: relays,
    world,
  });
  await start();
  world.latency = (r) => (/SetOffR\/1/.test(r.path) ? 5 * SECOND : 20);
  const t0 = clock.elapsed;
  const first = gladys.fake.setValue(relays[0], relays[0].features[0], 0);
  const second = settle(3).then(() => gladys.fake.setValue(relays[1], relays[1].features[0], 0));
  const [ack1, ack2] = await act(Promise.all([first, second]));
  assert.equal(ack2.success, true, ack2.error);
  assert.match(ack1.error, /Envoyée/);
  const write = world.writes().find((w) => /SetOffR\/2/.test(w.path) && w.sentAt !== undefined);
  assert.ok(write.sentAt - t0 < 1.2 * SECOND, `left at ${write.sentAt - t0} ms`);
  assert.equal(world.relays[1], false);
  app.stop();
});

test('B1: a switch-off that could not leave is sent again as soon as the lane frees, before any read', async () => {
  const device = relayOf(1);
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, act, gladys, clock } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: [device],
    world,
  });
  await start();
  // Refused for longer than the 250 ms of tries, then the ED3 answers again.
  world.refuseConnect = 6;
  const t0 = clock.elapsed;
  const ack = await act(gladys.fake.setValue(device, device.features[0], 0));
  assert.match(ack.error, /Pas encore envoyée.*renvoyée dès que l’Eco-Devices 3 est libre/);
  await act(new Promise((r) => clock.timers.setTimeout(r, 500)));
  const write = world.writes().find((w) => /SetOffR\/1/.test(w.path) && w.sentAt !== undefined);
  assert.ok(write, 'R1 off written');
  assert.ok(write.sentAt - t0 < SECOND, `left at ${write.sentAt - t0} ms`);
  assert.equal(world.relays[0], false);
  app.stop();
});

test('B3: a relay removed from the list is never switched again, nor after a restart', async () => {
  const relay = relayOf(1);
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, cmd, wait, gladys, store, clock } = await setup({
    config: cfg(),
    devices: [relay],
    world,
  });
  await start();
  world.ignoreWrites = true;
  await cmd(relay, F('relay', 'r1', 'switch'), 0);
  assert.ok(app.guards.has('r1'));
  await gladys.fake.configUpdated(cfg({ relays: 'R2' }));
  assert.equal(app.guards.has('r1'), false, 'dropped at once');
  assert.deepEqual(store.data.guards, [], 'and in /data');
  const count = world.writes().length;
  await wait(60 * SECOND);
  assert.equal(world.writes().length, count, 'no switch-off once unlisted');
  app.stop();
  // A guard of R1 in /data, R1 not listed: nothing at start.
  store.data.guards = [{ code: 'r1', kind: 'relay', value: 0, resends: 0, confirmed: false }];
  const again = await setup({ config: cfg({ relays: 'R2' }), store, clock, devices: [relay] });
  await again.start();
  await again.wait(30 * SECOND);
  assert.ok(!again.world.writes().some((w) => /SetOffR\/1/.test(w.path)));
  assert.deepEqual(again.store.data.guards, []);
  again.app.stop();
  again.app.guards.clear();
  again.app.adoptMemory(
    normalizeMemory(
      { key: again.app.config.key, guards: [{ code: 'r1', kind: 'relay', value: 0 }] },
      clock.now(),
    ),
    clock.now(),
    clock.monotonic(),
  );
  assert.equal(again.app.guards.has('r1'), false);
});

test('I1: a switch-off clicked before the configuration is read asks for it and leaves once it comes', async () => {
  let calls = 0;
  let fail = true;
  const device = relayOf(1);
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, gladys, wait, act } = await setup({
    config: cfg(),
    devices: [device],
    world,
    getConfig: async () => {
      calls += 1;
      if (fail) throw new Error('busy');
      return cfg();
    },
  });
  await app.onConnected(() => gladys.getConfig());
  await wait(SECOND);
  const before = calls;
  const ack = await act(gladys.fake.setValue(device, device.features[0], 0));
  assert.ok(calls > before, 'the click asked for the configuration');
  assert.match(ack.error, /gardée et envoyée dès sa lecture/);
  fail = false;
  await wait(6 * SECOND);
  assert.ok(
    world.writes().some((w) => /SetOffR\/1/.test(w.path)),
    'sent once read',
  );
  assert.equal(world.relays[0], false);
  const second = await setup({ config: cfg(), devices: [device], getConfig: async () => cfg() });
  second.app.configLoader = () => second.gladys.getConfig();
  const ok = await second.act(second.gladys.fake.setValue(device, device.features[0], 0));
  assert.equal(ok.success, true, ok.error);
  app.stop();
  second.app.stop();
});

test('I2: two saves in a row apply one after the other, the last wins, one request at a time', async () => {
  const world = fakeEd3();
  world.latency = 300;
  const store = memoryStore();
  const { app, start, act, clock } = await setup({ world, store });
  await start();
  const load = store.load.bind(store);
  let loads = 0;
  store.load = async () => {
    loads += 1;
    await new Promise((r) => clock.timers.setTimeout(r, 80));
    return load();
  };
  await act(
    Promise.all([
      app.configUpdated({ ...CONFIG, api_key: 'other-key' }),
      app.configUpdated({ ...CONFIG, api_key: 'last-key' }),
    ]),
  );
  await act(new Promise((r) => clock.timers.setTimeout(r, 2000)));
  assert.equal(world.peak, 1);
  assert.equal(loads, 1, 'the superseded configuration never starts');
  assert.equal(app.config.apiKey, 'last-key');
  assert.ok(
    !world.requests.some((r) => /other-key/.test(r.path)),
    'the superseded one never reads',
  );
  app.stop();
});

test('I3: relays clicked one after the other on a slow ED3: every ack within 5 s', async () => {
  const relays = both();
  const world = fakeEd3();
  const { app, start, act, gladys, clock } = await setup({ config: cfg(), devices: relays, world });
  await start();
  world.latency = 700;
  const acks = [];
  for (let i = 0; i < 8; i += 1) {
    const relay = relays[i % 2];
    const t = clock.elapsed;
    acks.push({ t, ack: timed(clock, gladys.fake.setValue(relay, relay.features[0], 1)) });
    await act(new Promise((r) => clock.timers.setTimeout(r, 600)));
  }
  await act(Promise.all(acks.map((a) => a.ack.promise)));
  for (const { t, ack } of acks) assert.ok(ack.at - t < 5000, `ack after ${ack.at - t} ms`);
  app.stop();
});

test('M2: switching off a listed relay goes during a pause; switching it on does not', async () => {
  const relay = relayOf(1);
  const world = fakeEd3({ mac: undefined });
  world.relays[0] = true;
  const { app, start, cmd, wait } = await setup({ config: cfg(), devices: [relay], world });
  await start();
  world.failReads = 500;
  await wait(10 * SECOND);
  assert.ok(app.pause);
  const before = world.requests.length;
  const on = await cmd(relay, F('relay', 'r1', 'switch'), 1);
  assert.match(on.error, /ne répond pas/);
  assert.equal(world.requests.length, before, 'nothing at all to a paused ED3 for a switch-on');
  await cmd(relay, F('relay', 'r1', 'switch'), 0);
  assert.ok(world.writes().some((w) => /SetOffR\/1/.test(w.path)));
  assert.equal(world.relays[0], false);
  app.stop();
});

test('M4: the list of relays is checked again right before the write', async () => {
  const relays = both();
  const world = fakeEd3();
  const { app, start, act, gladys } = await setup({ config: cfg(), devices: relays, world });
  await start();
  world.latency = 1000;
  const on1 = gladys.fake.setValue(relays[0], relays[0].features[0], 1);
  const on2 = gladys.fake.setValue(relays[1], relays[1].features[0], 1);
  await settle(5);
  await gladys.fake.configUpdated(cfg({ relays: 'R1' }));
  const [, second] = await act(Promise.all([on1, on2]));
  assert.match(second.error, /lecture seule/);
  assert.ok(!world.writes().some((w) => /SetOnR\/2/.test(w.path)));
  app.stop();
});

test('M7: unknown reads never release a confirmed switch-off', async () => {
  const device = relayOf(1);
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, cmd, wait } = await setup({ config: cfg(), devices: [device], world });
  await start();
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  await wait(25 * SECOND);
  world.relays[0] = 'on';
  await wait(30 * SECOND);
  assert.ok(app.guards.has('r1'), 'still held after unknown reads');
  app.stop();
});

test('M8: a read that left before the guard was sent never checks it', async () => {
  const { app, start } = await setup({ config: cfg() });
  await start();
  app.guards.set('r1', {
    code: 'r1',
    kind: 'relay',
    value: 0,
    resends: 0,
    confirmed: true,
    other: 1,
    seq: 1,
    sentAt: 1000,
    inFlight: false,
  });
  app.model.set('r1', { ...app.model.get('r1'), value: 1, at: 500 });
  app.applyRead(500);
  assert.ok(app.guards.has('r1'), 'an older read is not the second one');
  app.stop();
});

test('M10: a switch-on waiting behind a switch-off is refused at once, not at its turn', async () => {
  const relays = both();
  const world = fakeEd3();
  const { app, start, act, gladys, clock } = await setup({ config: cfg(), devices: relays, world });
  await start();
  world.latency = (r) => (/SetOnR\/2/.test(r.path) ? 1000 : 20);
  const busy = gladys.fake.setValue(relays[1], relays[1].features[0], 1);
  await settle(5);
  const waiting = timed(clock, gladys.fake.setValue(relays[0], relays[0].features[0], 1));
  await settle(5);
  const clicked = clock.elapsed;
  const off = gladys.fake.setValue(relays[0], relays[0].features[0], 0);
  const [, w] = await act(Promise.all([busy, waiting.promise, off]));
  assert.match(w.error, /Annulée|Interrompue/);
  assert.ok(waiting.at - clicked < 100, `refused ${waiting.at - clicked} ms after the switch-off`);
  assert.equal(world.relays[0], false);
  app.stop();
});

test('M11: a read back that left before a write is never shared with it', async () => {
  const world = fakeEd3();
  world.latency = 1000;
  const { app, start, clock, wait } = await setup({ config: cfg(), world });
  await start();
  await wait(8000);
  const first = app.readBack(PRIORITY.CONFIRM, clock.monotonic() + 5000);
  first.catch(() => {});
  await wait(20);
  assert.ok(app.readBackJob.started, 'the first read back left');
  const written = clock.monotonic();
  const second = app.readBack(PRIORITY.CONFIRM, clock.monotonic() + 5000, { after: written });
  second.catch(() => {});
  assert.notEqual(second, first);
  const third = app.readBack(PRIORITY.CONFIRM, clock.monotonic() + 5000, { after: written });
  assert.equal(third, second, 'one not left yet is shared');
  app.stop();
});

test('M17: a command the reads contradict is told in the status', async () => {
  const relay = relayOf(1);
  const world = fakeEd3();
  const { app, start, cmd, wait, gladys } = await setup({ config: cfg(), devices: [relay], world });
  await start();
  world.ignoreWrites = true;
  await cmd(relay, F('relay', 'r1', 'switch'), 1);
  await wait(10 * SECOND);
  assert.match(message(gladys), /Last command not applied.*R1/);
  app.stop();
});

test('M19: a guard kept in /data leaves at start, before any read', async () => {
  const store = memoryStore();
  const first = await setup({ config: cfg(), store });
  await first.start();
  first.app.stop();
  store.data.guards = [{ code: 'r1', kind: 'relay', value: 0, resends: 0, confirmed: false }];
  const world = fakeEd3();
  world.relays[0] = true;
  const second = await setup({ config: cfg(), store, clock: first.clock, world });
  await second.start();
  assert.ok(world.writes().some((w) => /SetOffR\/1/.test(w.path)));
  assert.deepEqual(
    world.reads().map((r) => r.path.split('?')[0]),
    ['/api/system/info'],
    'only its MAC: no round yet (read less than an interval ago)',
  );
  second.app.stop();
});

test('M22: a command cuts a slow read of the polling', async () => {
  const relay = relayOf(1);
  const world = fakeEd3();
  const { app, start, wait, act, gladys, elapsed } = await setup({
    config: cfg(),
    devices: [relay],
    world,
  });
  await start();
  world.latency = (r) => (/core_logger/.test(r.path) && !world.fast ? 4 * SECOND : 20);
  await wait(10 * SECOND);
  assert.equal(world.inFlight, 1);
  const t0 = elapsed();
  world.fast = true;
  await act(gladys.fake.setValue(relay, relay.features[0], 1));
  const write = world.writes()[0];
  assert.ok(write.sentAt - t0 < 50, `left ${write.sentAt - t0} ms after the click`);
  app.stop();
});

// --- Review r2 ----------------------------------------------------------------------

/** Gladys slow to take the status and the Discovery list (4 s each, virtual). */
const slowGladys = (gladys, clock) => {
  for (const name of ['publishDiscoveredDevices', 'setConnectionStatus']) {
    const original = gladys[name].bind(gladys);
    gladys[name] = async (...args) => {
      await new Promise((r) => clock.timers.setTimeout(r, 4 * SECOND));
      return original(...args);
    };
  }
};

test('r2 B1: a switch-off clicked during a slow start (Gladys slow) is sent in that start', async () => {
  let calls = 0;
  const device = relayOf(1);
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, gladys, wait, act, clock } = await setup({
    config: cfg(),
    devices: [device],
    world,
    getConfig: async () => {
      calls += 1;
      if (calls === 1) throw new Error('busy');
      return cfg();
    },
  });
  slowGladys(gladys, clock);
  app.onConnected(() => gladys.getConfig());
  await wait(SECOND);
  const t0 = clock.elapsed;
  const ack = await act(gladys.fake.setValue(device, device.features[0], 0));
  const write = world.writes().find((w) => /SetOffR\/1/.test(w.path) && w.sentAt !== undefined);
  assert.ok(write, `sent (ack: ${JSON.stringify(ack)})`);
  assert.ok(write.sentAt - t0 < 3.5 * SECOND, `left ${write.sentAt - t0} ms after the click`);
  assert.equal(app.pendingProtectives.size, 0, 'nothing left for a later start');
  app.stop();
  app.clearConfigTimer();
});

test('r2 B1: a switch-off kept in /data leaves within a second of the start, whatever Gladys does', async () => {
  const store = memoryStore();
  const first = await setup({ config: cfg(), store });
  await first.start();
  first.app.stop();
  store.data.guards = [{ code: 'r1', kind: 'relay', value: 0, resends: 0, confirmed: false }];
  const world = fakeEd3();
  world.relays[0] = true;
  const second = await setup({ config: cfg(), store, clock: first.clock, world });
  slowGladys(second.gladys, second.clock);
  const t0 = second.clock.elapsed;
  second.app.connected(cfg());
  await second.act(
    new Promise((resolve) => {
      const look = () =>
        world.writes().some((w) => w.sentAt !== undefined)
          ? resolve()
          : second.clock.timers.setTimeout(look, 10);
      look();
    }),
  );
  const write = world.writes().find((w) => /SetOffR\/1/.test(w.path) && w.sentAt !== undefined);
  assert.ok(write.sentAt - t0 < SECOND, `left ${write.sentAt - t0} ms after the start`);
  await second.wait(10 * SECOND);
  second.app.stop();
});

test('r2 B1: a switch-off waiting for the configuration, then of a relay not listed, is told', async () => {
  let calls = 0;
  const device = relayOf(2);
  const { app, gladys, wait, act } = await setup({
    config: cfg({ relays: 'R1' }),
    devices: [device],
    getConfig: async () => {
      calls += 1;
      if (calls <= 2) throw new Error('busy');
      return cfg({ relays: 'R1' });
    },
  });
  await app.onConnected(() => gladys.getConfig());
  await act(gladys.fake.setValue(device, device.features[0], 0));
  await wait(10 * SECOND);
  assert.match(message(gladys), /clicked before the configuration was read, not sent.*R2/);
  app.stop();
  app.clearConfigTimer();
});

test('r2 I1: a round left in the queue past its deadline is no failure of the ED3', async () => {
  const relays = both();
  const world = fakeEd3();
  const { app, start, act, gladys, clock, wait } = await setup({
    config: cfg(),
    devices: relays,
    world,
  });
  await start();
  await wait(8500);
  world.latency = 700;
  const acks = [];
  for (let i = 0; i < 8; i += 1) {
    acks.push(gladys.fake.setValue(relays[i % 2], relays[i % 2].features[0], 1));
    await act(new Promise((r) => clock.timers.setTimeout(r, 250)));
  }
  await act(Promise.all(acks));
  assert.equal(app.failures, 0);
  assert.equal(app.pause, undefined);
  assert.doesNotMatch(message(gladys), /does not answer/);
  const after = await act(gladys.fake.setValue(relays[0], relays[0].features[0], 0));
  assert.ok(after.success || /Envoyée/.test(after.error), after.error);
  app.stop();
});

test('r2: a switch-on clicked while a switch-off retries is refused; the switch-off wins', async () => {
  const device = relayOf(1);
  const world = fakeEd3();
  world.relays[0] = true;
  const { app, start, act, gladys } = await setup({ config: cfg(), devices: [device], world });
  await start();
  world.refuseConnect = 1;
  const feature = device.features[0];
  const [off, on] = await act(
    Promise.all([
      gladys.fake.setValue(device, feature, 0),
      gladys.fake.setValue(device, feature, 1),
    ]),
  );
  assert.equal(off.success, true, off.error);
  assert.match(on.error, /extinction/i);
  assert.deepEqual(leftWrites(world), ['R1 Off']);
  assert.equal(world.relays[0], false);
  app.stop();
});

test('r2: both relays switched off in a scene on a slow ED3: both before the read backs', async () => {
  const relays = both();
  const world = fakeEd3();
  world.relays = [true, true];
  const { app, start, act, gladys, wait } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: relays,
    world,
  });
  await start();
  world.latency = 900;
  await act(Promise.all(relays.map((r) => gladys.fake.setValue(r, r.features[0], 0))));
  await wait(3000);
  const sent = world.requests.filter((r) => r.sentAt !== undefined);
  const second = sent.findIndex((r) => /SetOffR\/2/.test(r.path));
  const readBack = sent.findIndex((r) => /ed3\/0\?option=filter_state/.test(r.path));
  assert.ok(second !== -1 && second < readBack, 'the second switch-off before the read backs');
  assert.deepEqual(world.relays, [false, false]);
  app.stop();
});

test('r2: /data is never written between the reset of a start and its read of /data', async () => {
  const store = memoryStore();
  const first = await setup({ config: cfg(), store });
  await first.start();
  first.app.stop();
  store.data.guards = [{ code: 'r1', kind: 'relay', value: 0, resends: 0, confirmed: false }];
  const second = await setup({ config: cfg(), store, clock: first.clock });
  const load = store.load.bind(store);
  store.load = async () => {
    await new Promise((r) => second.clock.timers.setTimeout(r, 80));
    return load();
  };
  const started = second.app.connected(cfg());
  await settle(5);
  await second.app.saveMemory();
  assert.equal(store.data.guards.length, 1, 'the kept switch-off is still in /data');
  await second.act(started);
  assert.ok(second.app.guards.has('r1') || second.world.relays[0] === false);
  second.app.stop();
});

// --- Review r3 ----------------------------------------------------------------------

test('r3 B1: a retry already queued is checked again right before it leaves', async () => {
  const relays = both();
  const world = fakeEd3();
  world.relays = [true, true];
  const { app, start, act, gladys, clock } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: relays,
    world,
  });
  await start();
  // R1 off refused at its first try; R2 off holds the lane 500 ms, so the retry of R1 waits
  // in the queue when R1 off is clicked again.
  world.refuseConnect = 1;
  world.latency = (r) => (/SetOffR\/2/.test(r.path) ? 500 : 20);
  const click = (ms, relay) =>
    later(clock, ms, () => gladys.fake.setValue(relay, relay.features[0], 0));
  const [f, , o] = await act(
    Promise.all([click(0, relays[0]), click(10, relays[1]), click(120, relays[0])]),
  );
  await act(new Promise((r) => clock.timers.setTimeout(r, 500)));
  assert.deepEqual(leftWrites(world), ['R2 Off', 'R1 Off'], 'one R1 switch-off left');
  assert.equal(world.relays[0], false);
  assert.match(f.error, /Annulée/);
  assert.equal(o.success, true, o.error);
  app.stop();
});

test('r3: an older switch-on cut by the switch-off, then handled late by the ED3, never lifts it', async () => {
  const device = relayOf(1);
  const world = fakeEd3();
  const { app, start, act, wait, gladys, clock, lines } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: [device],
    world,
  });
  await start();
  // This ED3 takes the switch-on 2 s after it came, though its request was cut.
  world.latency = (r) => (/SetOnR\/1/.test(r.path) ? 2 * SECOND : 20);
  world.queue.push((r) => {
    if (!/SetOnR\/1/.test(r.path)) return undefined;
    clock.timers.setTimeout(() => {
      world.relays[0] = true;
    }, 2 * SECOND);
    return { json: { status: 'Success' } };
  });
  const feature = device.features[0];
  const on = gladys.fake.setValue(device, feature, 1);
  const off = later(clock, 200, () => gladys.fake.setValue(device, feature, 0));
  const [c, o] = await act(Promise.all([on, off]));
  assert.match(c.error, /Envoyée, sans confirmation|Interrompue/);
  assert.equal(o.success, true, o.error);
  await wait(30 * SECOND);
  assert.equal(world.relays[0], false, 'switched off again over the late switch-on');
  assert.equal(app.guards.get('r1')?.value, 0, 'still held');
  assert.ok(lines.some((l) => /R1 shows an older command of the integration/.test(l)));
  app.stop();
});

test('r3: a switch-on of ours answered before the switch-off is no reason to keep it over a change on the ED3', async () => {
  const device = relayOf(1);
  const world = fakeEd3();
  const { app, start, act, wait, gladys, clock } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: [device],
    world,
  });
  await start();
  const feature = device.features[0];
  await act(
    Promise.all([
      gladys.fake.setValue(device, feature, 1),
      later(clock, SECOND, () => gladys.fake.setValue(device, feature, 0)),
    ]),
  );
  later(clock, SECOND, () => (world.relays[0] = true));
  await wait(30 * SECOND);
  assert.equal(app.guards.has('r1'), false, 'released: changed on the ED3');
  assert.equal(world.relays[0], true);
  // Refused by the ED3 (HTTP 500), then the switch-off, then switched on at the ED3 itself.
  world.relays[0] = false;
  world.queue.push((r) => (/SetOnR\/1/.test(r.path) ? { status: 500, json: {} } : undefined));
  const [refused] = await act(
    Promise.all([
      gladys.fake.setValue(device, feature, 1),
      later(clock, SECOND, () => gladys.fake.setValue(device, feature, 0)),
    ]),
  );
  assert.match(refused.error, /répondu une erreur/);
  later(clock, SECOND, () => (world.relays[0] = true));
  await wait(30 * SECOND);
  assert.equal(app.guards.has('r1'), false, 'released: changed on the ED3');
  app.stop();
});

test('r3: a switch-on of ours left unanswered more than 5 s before the switch-off is no reason either', async () => {
  const device = relayOf(1);
  const world = fakeEd3();
  const { app, start, act, wait, gladys, clock } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: [device],
    world,
  });
  await start();
  world.latency = (r) => (/SetOnR\/1/.test(r.path) ? 10 * SECOND : 20);
  const feature = device.features[0];
  const [c, o] = await act(
    Promise.all([
      gladys.fake.setValue(device, feature, 1),
      later(clock, 6 * SECOND, () => gladys.fake.setValue(device, feature, 0)),
    ]),
  );
  assert.match(c.error, /Envoyée, sans confirmation/);
  assert.equal(o.success, true, o.error);
  later(clock, SECOND, () => (world.relays[0] = true));
  await wait(30 * SECOND);
  assert.equal(app.guards.has('r1'), false, 'released: changed on the ED3');
  app.stop();
});

test('r3: after a restart (a new key), an old unanswered command of ours is no reason either', async () => {
  const device = relayOf(1);
  const world = fakeEd3();
  const { app, start, act, wait, gladys, clock } = await setup({
    config: cfg(),
    devices: [device],
    world,
  });
  await start();
  world.latency = (r) => (/SetOnR\/1/.test(r.path) ? 10 * SECOND : 20);
  const feature = device.features[0];
  await act(
    Promise.all([
      gladys.fake.setValue(device, feature, 1),
      later(clock, 6 * SECOND, () => gladys.fake.setValue(device, feature, 0)),
    ]),
  );
  world.latency = 20;
  await wait(10 * SECOND);
  assert.equal(app.guards.get('r1')?.confirmed, true);
  world.relays[0] = true;
  world.key = 'An0therKey-7';
  await app.configUpdated(cfg({ api_key: 'An0therKey-7' }));
  assert.equal(app.guards.get('r1')?.stale, undefined);
  await wait(30 * SECOND);
  assert.equal(app.guards.has('r1'), false, 'released: changed on the ED3');
  app.stop();
});

test('r3: an unanswered write of ours may land for one request time after it left, no longer', async () => {
  const { app } = await setup({ config: cfg() });
  app.lastWrites.set('r1', { value: 1, sentAt: 1000, answered: false });
  assert.ok(app.mayLand('r1', 0, 1000 + TIMINGS.requestTimeout - 1));
  assert.equal(app.mayLand('r1', 0, 1000 + TIMINGS.requestTimeout), undefined);
  assert.equal(app.mayLand('r1', 1, 1001), undefined, 'same value: not older');
  assert.equal(app.mayLand('r2', 0, 1001), undefined);
  app.stop();
});

/** A first start that read the ED3 (the pace kept in /data), then these guards in /data. */
const keptGuards = async (codes) => {
  const store = memoryStore();
  const first = await setup({ config: cfg({ poll_interval: 300 }), store });
  await first.start();
  first.app.stop();
  store.data.guards = codes.map((code) => ({
    code,
    kind: 'relay',
    value: 0,
    resends: 0,
    confirmed: false,
  }));
  return { store, clock: first.clock };
};

test('r3 R5: a switch-off clicked before the configuration leaves first at start, then the guards of /data', async () => {
  const { store, clock } = await keptGuards(['r2']);
  const relays = both();
  const world = fakeEd3();
  world.relays = [true, true];
  let calls = 0;
  const { app, gladys, wait, act } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: relays,
    world,
    store,
    clock,
    getConfig: async () => {
      calls += 1;
      if (calls <= 2) throw new Error('busy');
      return cfg({ poll_interval: 300 });
    },
  });
  await app.onConnected(() => gladys.getConfig());
  const kept = await act(gladys.fake.setValue(relays[0], relays[0].features[0], 0));
  assert.match(kept.error, /envoyée dès sa lecture/);
  await wait(10 * SECOND);
  const sent = world.writes().filter((w) => w.sentAt !== undefined);
  assert.deepEqual(leftWrites(world), ['R1 Off', 'R2 Off']);
  assert.ok(
    sent.every((w) => w.end !== undefined),
    'none cut',
  );
  assert.deepEqual(world.relays, [false, false]);
  app.stop();
  app.clearConfigTimer();
});

test('r3: a guard sent again and cut by a click before it left goes right behind that click', async () => {
  const { store, clock } = await keptGuards(['r2']);
  const relays = both();
  const world = fakeEd3({ mac: undefined });
  world.relays = [true, true];
  let slow = true;
  world.connectDelay = (r) => (/SetOffR\/2/.test(r.path) && slow ? ((slow = false), 200) : 0);
  store.data.owner = { kind: 'address', id: store.data.key, at: store.data.key };
  const { app, gladys, act } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: relays,
    world,
    store,
    clock,
  });
  const t0 = clock.elapsed;
  app.connected(cfg({ poll_interval: 300 }));
  const ack = await act(
    later(clock, 50, () => gladys.fake.setValue(relays[0], relays[0].features[0], 0)),
  );
  await act(new Promise((r) => clock.timers.setTimeout(r, 500)));
  assert.equal(world.writes()[0].sentAt, undefined, 'the first try of R2 never left');
  const r2 = world.writes().find((w) => /SetOffR\/2/.test(w.path) && w.sentAt !== undefined);
  assert.ok(r2, 'the guard of R2 left');
  assert.ok(r2.sentAt - t0 < SECOND, `left ${r2.sentAt - t0} ms after the start`);
  assert.equal(world.relays[1], false);
  assert.equal(ack.success, true, ack.error);
  app.stop();
});

test('r3: a guard cut before it left by a newer click on its own relay is not tried again', async () => {
  const { store, clock } = await keptGuards(['r2']);
  const relay = relayOf(2);
  const world = fakeEd3({ mac: undefined });
  world.relays[1] = true;
  world.connectDelay = (r) => (/SetOffR\/2/.test(r.path) && !world.clicked ? 200 : 0);
  store.data.owner = { kind: 'address', id: store.data.key, at: store.data.key };
  const { app, gladys, act } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: [relay],
    world,
    store,
    clock,
  });
  app.connected(cfg({ poll_interval: 300 }));
  const ack = await act(
    later(clock, 50, () => {
      world.clicked = true;
      return gladys.fake.setValue(relay, relay.features[0], 0);
    }),
  );
  await act(new Promise((r) => clock.timers.setTimeout(r, 500)));
  assert.deepEqual(leftWrites(world), ['R2 Off'], 'one switch-off left: the click');
  assert.equal(world.relays[1], false);
  assert.equal(ack.success, true, ack.error);
  app.stop();
});

test('a switch-on already taken from the queue, waiting for the lane, never leaves after a newer switch-off', async () => {
  const relays = both();
  const world = fakeEd3();
  const { app, start, act, gladys, clock } = await setup({
    config: cfg({ poll_interval: 300 }),
    devices: relays,
    world,
  });
  await start();
  // The read back of R2 takes 1 s: R1's switch-on waits behind it in the lane.
  world.latency = (r) => (/filter_state/.test(r.path) ? SECOND : 20);
  const click = (ms, relay, value) =>
    later(clock, ms, () => gladys.fake.setValue(relay, relay.features[0], value));
  const [, on, off] = await act(
    Promise.all([click(0, relays[1], 1), click(100, relays[0], 1), click(200, relays[0], 0)]),
  );
  await act(new Promise((r) => clock.timers.setTimeout(r, 2000)));
  assert.equal(off.success, true, off.error);
  assert.match(on.error, /Annulée/);
  assert.ok(!leftWrites(world).includes('R1 On'), `writes ${leftWrites(world)}`);
  assert.equal(world.relays[0], false);
  app.stop();
});
