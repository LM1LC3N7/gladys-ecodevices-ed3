// -----------------------------------------------------------------------------
// Several Eco-Devices 3 in one integration (src/hub.js): each slot its own
// ids, devices, lane and /data; one status, one Discover list, one publisher.
// Virtual clock with fake ED3 behind one transport (dispatched by address),
// then a real clock (x20) against two real local HTTP ED3.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Ed3Hub } from '../src/hub.js';
import { registerHandlers } from '../src/handlers.js';
import { parseExternalId, slotOf } from '../src/devices.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn, testClock } from './kit/index.mjs';
import { KEY, fakeEd3 } from './helpers/fakeEd3.js';
import { httpEd3 } from './helpers/httpEd3.js';
import { START, SALT, settle } from './helpers/app.js';

const HOST_1 = '192.168.1.60';
const HOST_2 = '192.168.1.62';
const CONFIG = {
  host: HOST_1,
  api_key: KEY,
  relays: 'R1',
  host_2: HOST_2,
  api_key_2: KEY,
  relays_2: 'R1, R2',
  poll_interval: 10,
};

async function hubSetup({ config = CONFIG, devices = [] } = {}) {
  const clock = testClock({ start: START });
  const w1 = fakeEd3();
  const w2 = fakeEd3({ mac: '00:04:a3:5e:00:02' });
  w1.clock = clock;
  w2.clock = clock;
  const gladys = createFakeGladys({ selector: 'ed3', config, devices });
  await gladys.connect();
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const stores = new Map([1, 2, 3].map((s) => [s, memoryStore()]));
  const hub = new Ed3Hub({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    transport: (o, h) => (o.hostname === HOST_2 ? w2 : w1).transport(o, h),
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    storeOf: (slot) => stores.get(slot),
    random: () => SALT,
  });
  registerHandlers(gladys, hub);
  const wait = async (ms) => {
    await clock.advance(ms);
    await settle();
  };
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
  const start = async () => {
    await act(hub.onConnected(() => gladys.getConfig()));
    await wait(1000);
  };
  const ids = () => (gladys.fake.discoveredDevices ?? []).map((d) => d.external_id);
  const create = async (id) => {
    const d = gladys.fake.discoveredDevices.find((x) => x.external_id === `ext:ed3:${id}`);
    await gladys.fake.deviceCreated(d);
    return gladys.devices.find((x) => x.external_id === d.external_id);
  };
  const set = (device, key, value) =>
    act(
      gladys.fake.setValue(
        device,
        device.features.find((f) => f.external_id.endsWith(`:${key}`)),
        value,
      ),
    );
  return { hub, gladys, w1, w2, stores, start, wait, act, ids, create, set, lines };
}

test('slots: ids and routing of the external ids', () => {
  assert.equal(slotOf('ext:ed3:relay:r1', 'ed3'), 1);
  assert.equal(slotOf('ext:ed3:ed32:relay:r1:switch', 'ed3'), 2);
  assert.equal(slotOf('ext:other:ed32:relay:r1', 'ed3'), 1);
  assert.deepEqual(parseExternalId('ext:ed3:ed32:relay:r1:switch', 'ed3', 2), {
    kind: 'relay',
    code: 'r1',
    key: 'switch',
  });
  assert.deepEqual(parseExternalId('ext:ed3:ed33:counter:c11:index', 'ed3', 3), {
    kind: 'counter',
    code: 'c11',
    key: 'index',
  });
  assert.equal(parseExternalId('ext:ed3:ed32:relay:r1:switch', 'ed3', 1), undefined);
  assert.equal(parseExternalId('ext:ed3:relay:r1:switch', 'ed3', 2), undefined);
  assert.equal(parseExternalId('ext:ed3:relay:r1:switch:x', 'ed3', 1), undefined);
});

test('two ED3: their own devices and values, each command to its own ED3 only', async () => {
  const { hub, gladys, w1, w2, start, ids, create, set, wait } = await hubSetup();
  w2.index.set(0, 99_000_000);
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const message = gladys.fake.connectionStatus.message;
  assert.match(
    message.en,
    /^ED3 #1: Connected to the Eco-Devices 3.*\nED3 #2: Connected to the Eco-Devices 3/s,
  );
  assert.match(message.fr, /ED3 n°2 : Connecté à l’Eco-Devices 3/);
  assert.ok(ids().includes('ext:ed3:relay:r1'));
  assert.ok(ids().includes('ext:ed3:ed32:relay:r1'));
  const name = gladys.fake.discoveredDevices.find(
    (d) => d.external_id === 'ext:ed3:ed32:relay:r2',
  ).name;
  assert.equal(name, 'ED3 n°2 · Relay 2 (R2)');
  const r1 = await create('relay:r1');
  const r1b = await create('ed32:relay:r1');
  await create('counter:c0');
  await create('ed32:counter:c0');
  assert.equal((await set(r1b, 'switch', 1)).success, true);
  assert.deepEqual(
    w2.writes().map((r) => /Set(On|Off)R\/\d/.exec(r.path)[0]),
    ['SetOnR/1'],
  );
  assert.equal(w1.writes().length, 0);
  assert.equal((await set(r1, 'switch', 0)).success, true);
  assert.equal(w1.writes().length, 1);
  assert.equal(w2.writes().length, 1);
  await wait(70_000);
  await hub.controllers.get(1).flush();
  assert.equal(gladys.fake.lastState('ext:ed3:counter:c0:index'), 12662);
  assert.equal(gladys.fake.lastState('ext:ed3:ed32:counter:c0:index'), 99000);
  // One publisher for the 300 states a minute of Gladys.
  const publishers = new Set([...hub.controllers.values()].map((a) => a.publisher));
  assert.equal(publishers.size, 1);
  hub.stop();
});

test('one slot used: its status as is; a failing slot leaves the others and the list', async () => {
  const one = await hubSetup({ config: { host: HOST_1, api_key: KEY } });
  await one.start();
  assert.match(one.gladys.fake.connectionStatus.message.en, /^Connected to the Eco-Devices 3/);
  one.hub.stop();

  const { gladys, w2, start, wait, ids, hub } = await hubSetup();
  await start();
  w2.refuseConnect = 99;
  await wait(10_000);
  assert.equal(gladys.fake.connectionStatus.connected, false, 'not all connected');
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /ED3 #2: The Eco-Devices 3 does not answer/,
  );
  assert.ok(!ids().some((id) => id.includes(':ed32:')), 'the devices of #2 leave Discover');
  assert.ok(ids().includes('ext:ed3:relay:r1'), 'those of #1 stay');
  await gladys.fake.scanRequest();
  assert.ok(!ids().some((id) => id.includes(':ed32:')));
  hub.stop();
});

test('a slot with devices but no address is shown; an unused slot is not', async () => {
  const { gladys, start, hub } = await hubSetup({
    config: { host: HOST_1, api_key: KEY },
    devices: [{ name: 'x', external_id: 'ext:ed3:ed32:relay:r1', features: [] }],
  });
  await start();
  const message = gladys.fake.connectionStatus.message.en;
  assert.match(message, /ED3 #2: Enter the address and the API key/);
  assert.doesNotMatch(message, /ED3 #3/);
  hub.stop();
});

test('the buttons answer for each ED3; Attach goes to the slot chosen', async () => {
  const { gladys, start, wait, hub } = await hubSetup();
  await start();
  await wait(10_000);
  const answer = await gladys.fake.action('test_connection', {});
  assert.match(answer.data.message.en, /ED3 #1: .*\nED3 #2: /s);
  const attach = await gladys.fake.action('attach_devices', { ed3: '2' });
  assert.match(attach.data.message.en, /devices of ED3 #2 already belong/);
  const none = await gladys.fake.action('attach_devices', { ed3: '7' });
  assert.match(none.data.message.en, /Choose an Eco-Devices 3/);
  const accept = await gladys.fake.action('accept_held_index', {});
  assert.match(accept.data.message.en, /ED3 #1: No index is held back.*\nED3 #2: No index/s);
  hub.stop();
});

test('real clock x20: two ED3 over HTTP, each read at the interval, each command to its own', async (t) => {
  const a = await httpEd3({ key: 'k1', mac: '00:04:a3:00:00:01' });
  const b = await httpEd3({ key: 'k2', mac: '00:04:a3:00:00:02' });
  const clock = realClock({ speed: 20 });
  t.after(async () => {
    clock.close();
    await a.srv.close();
    await b.srv.close();
  });
  const config = {
    host: a.address,
    api_key: 'k1',
    relays: 'R1',
    host_2: b.address,
    api_key_2: 'k2',
    relays_2: 'R1',
  };
  const gladys = createFakeGladys({ selector: 'ed3', config });
  await gladys.connect();
  const quiet = () => {};
  const hub = new Ed3Hub({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    storeOf: () => memoryStore(),
  });
  registerHandlers(gladys, hub);
  t.after(() => hub.stop());
  const spy1 = spyOn(hub.controllers.get(1), 'readRound', clock);
  const spy2 = spyOn(hub.controllers.get(2), 'readRound', clock);
  await hub.onConnected(() => gladys.getConfig());
  const period = POLL_INTERVAL.default * 1000;
  await Promise.all([
    measurePeriod(spy1, { count: 3, period }),
    measurePeriod(spy2, { count: 3, period }),
  ]);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const second = await gladys.fake.setValue(
    { external_id: 'ext:ed3:ed32:relay:r1' },
    { external_id: 'ext:ed3:ed32:relay:r1:switch' },
    1,
  );
  assert.equal(second.success, true, second.error);
  const first = await gladys.fake.setValue(
    { external_id: 'ext:ed3:relay:r1' },
    { external_id: 'ext:ed3:relay:r1:switch' },
    1,
  );
  assert.equal(first.success, true, first.error);
  assert.deepEqual(b.writes(), ['R1=On']);
  assert.deepEqual(a.writes(), ['R1=On']);
});

test('real clock: another box at the address (an IPX800 V5) is said, nothing written', async (t) => {
  const box = await httpEd3({ kind: 'ipx800v5', key: 'k' });
  t.after(() => box.srv.close());
  const gladys = createFakeGladys({
    selector: 'ed3',
    config: { host: box.address, api_key: 'k', relays: 'R1' },
  });
  await gladys.connect();
  const quiet = () => {};
  const hub = new Ed3Hub({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    storeOf: () => memoryStore(),
  });
  registerHandlers(gladys, hub);
  t.after(() => hub.stop());
  await hub.onConnected(() => gladys.getConfig());
  for (let i = 0; i < 100 && !/answers as/.test(gladys.fake.connectionStatus?.message?.en); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.match(gladys.fake.connectionStatus.message.en, /answers as an IPX800 V5/);
  assert.deepEqual(box.writes(), []);
});
