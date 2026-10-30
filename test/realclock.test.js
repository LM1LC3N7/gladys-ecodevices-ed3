// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout), sped
// up 20 times, against a real local HTTP server playing an Eco-Devices 3: the
// rounds start at the interval, never sooner, never a cycle late; a command
// still reads back and resolves; the indexes go once a minute at most. The
// real clock moves between any two reads.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Ed3App } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn } from './kit/index.mjs';
import { httpEd3 } from './helpers/httpEd3.js';
import { boundMemory, created } from './helpers/app.js';

const SPEED = 20;
const INTERVAL = POLL_INTERVAL.default * 1000;

test('real clock x20: one round per interval (measured), a command confirmed, indexes paced', async (t) => {
  const box = await httpEd3({ key: 'k', latencyMs: 5 });
  const clock = realClock({ speed: SPEED });
  // Registered first, run last (t.after runs in reverse order).
  t.after(async () => {
    clock.close();
    await box.srv.close();
  });
  const gladys = createFakeGladys({
    selector: 'ed3',
    config: {},
    devices: [created('counter', 'c0')],
  });
  await gladys.connect();
  const quiet = () => {};
  const app = new Ed3App({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    // The counter device belongs to this ED3 (its MAC, as httpEd3 gives it).
    store: memoryStore(boundMemory({ host: box.address, api_key: 'k' }, '00:04:a3:12:34:56')),
  });
  registerHandlers(gladys, app);
  t.after(() => app.stop());
  const spy = spyOn(app, 'readRound', clock);
  const guarded = spyOn(app, 'logHold', clock);
  await app.connected({ host: box.address, api_key: 'k', relays: 'R1' });
  const gaps = await measurePeriod(spy, { count: 5, period: INTERVAL });
  assert.equal(gaps.length, 4);
  // 5 rounds over 60 s: the index of c0 through its guard twice at most (at 0 s and 60 s).
  assert.ok(guarded.calls.length >= 1 && guarded.calls.length <= 2, `${guarded.calls.length}`);
  assert.equal(gladys.fake.lastState('ext:ed3:counter:c0:index'), 12662);
  const feature = { external_id: 'ext:ed3:relay:r1:switch' };
  const ack = await gladys.fake.setValue({ external_id: 'ext:ed3:relay:r1' }, feature, 1);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(box.writes(), ['R1=On']);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  app.stop();
  // About 13 timers a round (a deadline and a gap per request): no timer piling up.
  assert.ok(clock.timersSet < 150, `${clock.timersSet} timers`);
});
