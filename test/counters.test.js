// -----------------------------------------------------------------------------
// The counter indexes end to end: lifetime meters through their guard (never
// 0, a jump or a drop held until the user accepts it in two clicks), /data
// written before Gladys gets an index, once a minute at most, on the session
// clock (never the wall clock alone).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../src/store.js';
import { fakeEd3 } from './helpers/fakeEd3.js';
import { CONFIG, F, MINUTE, SECOND, START, boundMemory, created, setup } from './helpers/app.js';
import { testClock } from './kit/index.mjs';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const indexStates = (gladys, code) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === F('counter', code, 'index'));
const last = (gladys, code) => gladys.fake.lastState(F('counter', code, 'index'));

test('an index goes in kWh / m³, once a minute at most, after /data holds its guard', async () => {
  const devices = [created('counter', 'c0'), created('counter', 'c25'), created('counter', 'c12')];
  const world = fakeEd3();
  const { app, gladys, start, wait, store } = await setup({ devices, world });
  await start();
  await app.flush();
  assert.equal(last(gladys, 'c0'), 12662);
  assert.equal(last(gladys, 'c25'), 123.456, 'mL -> m³');
  assert.equal(last(gladys, 'c12'), undefined, 'a counter at 0 is never published');
  assert.deepEqual(store.data.indexes.c0.last.value, 12662);
  assert.equal(store.data.indexes.c0.device, 'device-c0');
  world.index.set(0, 12_663_000);
  await wait(10 * SECOND);
  await app.flush();
  assert.equal(last(gladys, 'c0'), 12662, 'not before a minute');
  await wait(50 * SECOND);
  await app.flush();
  assert.equal(last(gladys, 'c0'), 12663);
  // /data cannot be written: no index goes.
  store.fail = true;
  world.index.set(0, 12_664_000);
  await wait(2 * MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c0'), 12663);
  assert.match(message(gladys), /\/data/);
  store.fail = false;
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c0'), 12664);
  app.stop();
});

test('a jump is held (the last value sent again), said in the status, kept across a restart', async () => {
  const devices = [created('counter', 'c11')];
  const world = fakeEd3();
  const first = await setup({ devices, world });
  await first.start();
  await first.app.flush();
  assert.equal(last(first.gladys, 'c11'), 4072.301);
  // 10 MWh more in a minute: a wrong unit, a glitch, another meter.
  world.index.set(11, 14_072_301);
  await first.wait(MINUTE);
  await first.app.flush();
  assert.equal(last(first.gladys, 'c11'), 4072.301);
  assert.match(message(first.gladys), /Index held back.*C11 \(↑ 4072\.301 → 14072\.301 kWh\)/);
  assert.match(message(first.gladys, 'fr'), /Accepter l’index retenu/);
  for (let i = 0; i < 30; i += 1) await first.wait(MINUTE);
  await first.app.flush();
  assert.equal(last(first.gladys, 'c11'), 4072.301, 'never taken by time');
  assert.equal(first.store.data.indexes.c11.held.to, 14072.301);
  first.app.stop();
  const second = await setup({ devices, world, store: first.store, clock: first.clock });
  await second.start();
  await second.wait(MINUTE);
  await second.app.flush();
  assert.notEqual(last(second.gladys, 'c11'), 14072.301, 'still held after a restart');
  assert.match(message(second.gladys), /Index held back/);
  second.app.stop();
});

test('"Accept the held index": two clicks 3 s to 5 min apart; exactly the value listed', async () => {
  const devices = [created('counter', 'c0'), created('counter', 'c28')];
  const world = fakeEd3();
  world.index.set(28, 5_000_000);
  const { app, gladys, start, wait, act } = await setup({ devices, world });
  await start();
  assert.match((await act(app.acceptHeldIndex())).en, /No index is held back/);
  // A drop on c0 (a counter reset on the ED3), a jump on c28 (a gas meter replaced).
  world.index.set(0, 1_000);
  world.index.set(28, 900_000_000);
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c0'), 12662);
  assert.equal(last(gladys, 'c28'), 5);
  const first = await act(app.acceptHeldIndex());
  assert.match(first.en, /Held back: C0 \(↓ 12662 → 1 kWh\), C28 \(↑ 5 → 900 m³\)/);
  assert.match(first.en, /nothing is accepted yet/);
  // Too soon: a first click again.
  await wait(SECOND);
  assert.match((await act(app.acceptHeldIndex())).en, /Held back/);
  // Too late: a first click again.
  await wait(6 * MINUTE);
  assert.match((await act(app.acceptHeldIndex())).en, /Held back/);
  await wait(5 * SECOND);
  const done = await act(app.acceptHeldIndex());
  assert.match(done.en, /Accepted: C0 1 kWh, C28 900 m³/);
  await wait(10 * SECOND);
  await app.flush();
  assert.equal(last(gladys, 'c0'), 1);
  assert.equal(last(gladys, 'c28'), 900);
  assert.doesNotMatch(message(gladys), /held back/);
  // From there the values rise as usual.
  world.index.set(0, 2_000);
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c0'), 2);
  app.stop();
});

test('accept: a value that changed between the clicks is not taken', async () => {
  const devices = [created('counter', 'c11')];
  const world = fakeEd3();
  const { app, gladys, start, wait, act } = await setup({ devices, world });
  await start();
  world.index.set(11, 14_072_301);
  await wait(MINUTE);
  await act(app.acceptHeldIndex());
  // Another jump before the second click: the threshold held moved.
  world.index.set(11, 1_000);
  await wait(MINUTE);
  const done = await act(app.acceptHeldIndex());
  assert.match(done.en, /Changed since the first click, not accepted.*C11/);
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c11'), 4072.301);
  app.stop();
});

test('the guard dates on the session clock: a wall clock jumping forward widens nothing', async () => {
  const devices = [created('counter', 'c11')];
  const world = fakeEd3();
  const base = testClock({ start: START });
  let skew = 0;
  const clock = Object.create(base);
  clock.now = () => base.now() + skew;
  const { app, gladys, start, wait } = await setup({ devices, world, clock });
  await start();
  // The wall clock jumps 10 days ahead (NTP, a hand-set clock); 100 kWh more a minute later:
  // over 100 kW, held (a wall-clock guard would see 10 days and take it).
  skew = 10 * 24 * 3600 * SECOND;
  world.index.set(11, 4_172_301);
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c11'), 4072.301);
  assert.ok(app.indexGuards.get('c11').held);
  app.stop();
});

test('a counter device created again starts from what Gladys holds, not the old guard', async () => {
  const old = created('counter', 'c11');
  const world = fakeEd3();
  const { app, gladys, start, wait, store } = await setup({ devices: [old], world });
  await start();
  world.index.set(11, 14_072_301);
  await wait(MINUTE);
  assert.ok(store.data.indexes.c11.held);
  await gladys.fake.deviceDeleted(old);
  assert.equal(store.data.indexes.c11, undefined, 'its guard goes with it');
  const again = created('counter', 'c11', {
    id: 'device-c11-new',
    last: { value: 14072.301, at: START },
  });
  gladys.devices = [again];
  await gladys.fake.deviceCreated(again);
  world.index.set(11, 14_072_401);
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c11'), 14072.401, 'from the value Gladys holds');
  app.stop();
});

test('a counter going to 0 (unplugged meter) is never published as 0, nor any value after', async () => {
  const devices = [created('counter', 'c0')];
  const world = fakeEd3();
  const { app, gladys, start, wait } = await setup({ devices, world });
  await start();
  await app.flush();
  const count = indexStates(gladys, 'c0').length;
  world.index.set(0, 0);
  await wait(3 * MINUTE);
  await app.flush();
  assert.ok(indexStates(gladys, 'c0').every((s) => s.state !== 0));
  assert.ok(indexStates(gladys, 'c0').length >= count);
  app.stop();
});

test('/data unreadable at start: no guard, no index; readable again: the file’s references', async () => {
  const devices = [created('counter', 'c0')];
  const store = memoryStore({
    ...boundMemory(CONFIG),
    indexes: { c0: { device: 'device-c0', last: { value: 12000, at: START - 3600_000 } } },
  });
  store.unreadable = true;
  const { app, gladys, start, wait } = await setup({ devices, store });
  await start();
  await app.flush();
  assert.equal(last(gladys, 'c0'), undefined);
  store.unreadable = false;
  await wait(2 * MINUTE);
  await app.flush();
  // 662 kWh in an hour from the file's reference: over 100 kW, held.
  assert.equal(last(gladys, 'c0'), 12000);
  assert.match(message(gladys), /held back/);
  app.stop();
});

test('indexStates asks no guard while /data is unreadable, even with the ED3 known', async () => {
  const devices = [created('counter', 'c0')];
  const { app, start } = await setup({ devices });
  await start();
  app.storeUnreadable = true;
  app.lastIndexAt = undefined;
  app.currentGuard = () => {
    throw new Error('a guard asked while /data is unreadable');
  };
  const at = app.model.get('c0').at;
  assert.deepEqual(app.indexStates(at), []);
  app.stop();
});

test('a guard kept in /data for another device of the counter is never its reference', async () => {
  const at = START - 60_000;
  const store = memoryStore({
    ...boundMemory(CONFIG),
    indexes: {
      c11: {
        device: 'device-c11-old',
        last: { value: 1, at },
        held: { direction: 'up', from: 1, to: 4072.301, threshold: 4072.301, at },
      },
    },
  });
  const device = created('counter', 'c11', {
    id: 'device-c11-new',
    last: { value: 4072.2, at: START },
  });
  const { app, gladys, start } = await setup({ devices: [device], store });
  await start();
  await app.flush();
  assert.equal(last(gladys, 'c11'), 4072.301, 'from the value Gladys holds for this device');
  assert.equal(store.data.indexes.c11.device, 'device-c11-new');
  app.stop();
});

test('a counter device replaced in Gladys without an event: its guard starts again from it', async () => {
  const old = created('counter', 'c11');
  const world = fakeEd3();
  const { app, gladys, start, wait } = await setup({ devices: [old], world });
  await start();
  world.index.set(11, 14_072_301);
  await wait(MINUTE);
  assert.ok(app.indexGuards.get('c11').held);
  // Deleted and created again while the integration missed the events.
  gladys.devices = [
    created('counter', 'c11', { id: 'device-c11-other', last: { value: 14072.2, at: START } }),
  ];
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c11'), 14072.301);
  assert.equal(app.indexGuards.get('c11').held, undefined);
  app.stop();
});

test('accept: a held jump that grew beyond the margin between the clicks is not taken', async () => {
  const devices = [created('counter', 'c11')];
  const world = fakeEd3();
  const { app, gladys, start, wait, act } = await setup({ devices, world });
  await start();
  world.index.set(11, 14_072_301);
  await wait(MINUTE);
  await act(app.acceptHeldIndex());
  // Same jump (same start, same threshold), 36 MWh more within a minute.
  world.index.set(11, 50_000_000);
  await wait(MINUTE);
  const done = await act(app.acceptHeldIndex());
  assert.match(done.en, /Changed since the first click, not accepted.*C11/);
  await wait(MINUTE);
  await app.flush();
  assert.equal(last(gladys, 'c11'), 4072.301);
  app.stop();
});

test('accept: nothing taken while /data cannot be read', async () => {
  const devices = [created('counter', 'c11')];
  const world = fakeEd3();
  const { app, start, wait, act } = await setup({ devices, world });
  await start();
  world.index.set(11, 14_072_301);
  await wait(MINUTE);
  app.storeUnreadable = true;
  assert.match(
    (await act(app.acceptHeldIndex())).en,
    /cannot be read or written: nothing accepted/,
  );
  assert.equal(app.acceptAsk, undefined);
  app.stop();
});
