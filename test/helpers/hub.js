// -----------------------------------------------------------------------------
// The hub (up to three ED3, src/hub.js) against the SDK's fake Gladys, one fake
// ED3 per address (`boxOf(hostname)`) and the virtual clock of the test kit.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Ed3Hub } from '../../src/hub.js';
import { registerHandlers } from '../../src/handlers.js';
import { memoryStore } from '../../src/store.js';
import { testClock } from '../kit/index.mjs';
import { SALT, START, settle } from './app.js';

/** A /data per slot (kept across two hubs to play a restart). */
export const slotStores = () => new Map([1, 2, 3].map((slot) => [slot, memoryStore()]));

/** `start`: the wall clock of this run (a restart comes after the previous one). */
export async function hubOf(
  config,
  boxOf,
  stores = slotStores(),
  { devices = [], start = START } = {},
) {
  const clock = testClock({ start });
  const gladys = createFakeGladys({ selector: 'ed3', config, devices });
  await gladys.connect();
  const quiet = () => {};
  const hub = new Ed3Hub({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    transport: (o, h) => boxOf(o.hostname).transport(o, h),
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
  const ids = () => (gladys.fake.discoveredDevices ?? []).map((d) => d.external_id);
  return { hub, gladys, wait, ids, clock, stores };
}
