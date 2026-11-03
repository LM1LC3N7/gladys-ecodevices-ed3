// -----------------------------------------------------------------------------
// 0.2.0, m-18 (review r4): a round during which a command or a read back left
// is applied but for the ED3's relays (the only states such a request makes
// older), and only when it read the owner of the devices; a round that read
// another MAC is still dropped whole.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIORITY } from '../src/ed3/client.js';
import { fakeEd3 } from './helpers/fakeEd3.js';
import { CONFIG, F, SECOND, created, setup } from './helpers/app.js';

const R1 = { ...CONFIG, relays: 'R1' };
/** The full `object/ed3/0` reads of a fake ED3 (one per round), from the request `from` on. */
const rounds = (world, from = 0) =>
  world.requests.slice(from).filter((r) => /^\/api\/object\/ed3\/0\?ApiKey=/.test(r.path));

test('m-18: read backs every 2 s (the follow-ups of commands): every round is applied', async (t) => {
  const relay = created('relay', 'r1', { relayKind: 'switch' });
  const clamp = created('clamp', 't1');
  const world = fakeEd3();
  // The counters answer slowly: a read back leaves inside nearly every round. (A write would
  // cut the round instead: src/ed3/client.js.)
  world.latency = (r) => (r.path.includes('core_logger?option=filter_state') ? 1500 : 20);
  const { app, gladys, start, wait, clock } = await setup({
    config: R1,
    devices: [relay, clamp],
    world,
  });
  t.after(() => app.stop());
  await start();
  await wait(2 * SECOND);
  const from = world.requests.length;
  const powers = () =>
    gladys.fake.states
      .filter((s) => s.device_feature_external_id === F('clamp', 't1', 'power'))
      .map((s) => s.state);
  const before = powers().length;
  // 60 s: the clamp power changes every second (1 W, 2 W...), a read back every 2 s; R1 is
  // switched on at the ED3 itself halfway.
  for (let k = 1; k <= 60; k += 1) {
    world.power[0] = k * 1000;
    if (k === 30) world.relays[0] = true;
    // Never awaited (the virtual clock moves only by `wait`).
    if (k % 2 === 0) app.readBack(PRIORITY.CONFIRM, clock.monotonic() + 4 * SECOND).catch(() => {});
    await wait(SECOND);
  }
  await app.flush();
  const done = rounds(world, from).length;
  assert.ok(done >= 5, `${done} rounds`);
  const overtaken = world.requests
    .slice(from)
    .filter((r) =>
      /filter_state&ApiKey|option=filter_state\?|ed3\/0\?option=filter_state/.test(r.path),
    );
  assert.ok(overtaken.length >= 25, `${overtaken.length} read backs`);
  const published = new Set(powers().slice(before));
  // Every round but the last one (its states may still wait for the flush) is applied.
  assert.ok(published.size >= done - 1, `${published.size} powers for ${done} rounds`);
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'switch')), 1);
});

test('m-18: an overtaken round keeps the newer relay state and applies the clamps', async (t) => {
  const relay = created('relay', 'r1', { relayKind: 'switch' });
  const clamp = created('clamp', 't1');
  const world = fakeEd3();
  const { app, gladys, start, wait, clock } = await setup({
    config: R1,
    devices: [relay, clamp],
    world,
  });
  t.after(() => app.stop());
  await start();
  await wait(2 * SECOND);
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'switch')), 0);
  // The next round reads a new clamp power; its counters answer slowly; once it has read R1
  // (off), R1 is switched on at the ED3 itself and a read back leaves meanwhile.
  world.power[0] = 777_000;
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
  // The power that overtaken round read is applied (it was dropped with the round before).
  assert.equal(app.model.get('t1').value, 777);
  assert.equal(gladys.fake.lastState(F('clamp', 't1', 'power')), 777);
});

test('m-18: an overtaken round that read another MAC is not applied at all', async (t) => {
  const relay = created('relay', 'r1', { relayKind: 'switch' });
  const clamp = created('clamp', 't1');
  const world = fakeEd3();
  const { app, gladys, start, wait, clock } = await setup({
    config: R1,
    devices: [relay, clamp],
    world,
  });
  t.after(() => app.stop());
  await start();
  await wait(2 * SECOND);
  const power = gladys.fake.lastState(F('clamp', 't1', 'power'));
  world.latency = (r) => (r.path.includes('core_logger?option=filter_state') ? 3 * SECOND : 20);
  // Another ED3 at the address from the next round on (its MAC), its clamp reading 999 W.
  world.mac = '02-00-00-00-00-99';
  world.power[0] = 999_000;
  const n = rounds(world).length;
  for (let i = 0; i < 2000 && rounds(world).length === n; i += 1) await wait(10);
  await wait(100);
  // Never awaited (the virtual clock moves only by `wait`).
  app.readBack(PRIORITY.CONFIRM, clock.monotonic() + 10 * SECOND).catch(() => {});
  await wait(5 * SECOND);
  await app.flush();
  assert.equal(gladys.fake.lastState(F('clamp', 't1', 'power')), power, 'nothing of it published');
  assert.notEqual(app.model.get('t1')?.value, 999);
  // The next round (not overtaken) judges it: another ED3, nothing published either.
  await wait(10 * SECOND);
  await app.flush();
  assert.equal(gladys.fake.lastState(F('clamp', 't1', 'power')), power);
  assert.equal(app.verdict, 'different');
});
