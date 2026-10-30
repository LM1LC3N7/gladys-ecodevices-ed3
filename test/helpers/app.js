// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a fake Eco-Devices 3 and the virtual clock
// of the shared test kit: every read of `now()` or `monotonic()` moves the
// time by 1 µs, so a decision reading the clock twice is caught.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { testClock } from '../kit/index.mjs';
import { Ed3App, macId } from '../../src/app.js';
import { normalizeConfig } from '../../src/config.js';
import { counterKind } from '../../src/constants.js';
import { buildDevice } from '../../src/devices.js';
import { registerHandlers } from '../../src/handlers.js';
import { memoryStore } from '../../src/store.js';
import { KEY, MAC, fakeEd3 } from './fakeEd3.js';

export const SELECTOR = 'ed3';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const START = Date.UTC(2026, 9, 27, 12, 0, 0);
export const ADDRESS = '192.168.1.60';
export const CONFIG = { host: ADDRESS, api_key: KEY, poll_interval: 10 };

/** The external id of a feature: `F('relay', 'r1', 'switch')`. */
export const F = (kind, code, key) => `ext:${SELECTOR}:${kind}:${code}:${key}`;

/** A device as the user created it from the Discovery list. */
export function created(kind, code, { relayKind, extra = [], counter, last, id } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const n = Number(/(\d+)$/.exec(code)?.[1] ?? 0);
  const target = { code, kind, n, counter: counter ?? counterKind(n) };
  const device = buildDevice(gladys, target, { language: 'fr', relayKind });
  for (const key of extra) {
    const more = buildDevice(gladys, target, { language: 'fr', relayKind: key });
    device.features.push(...more.features);
  }
  device.id = id ?? `device-${code}`;
  if (last) {
    // The value Gladys holds for the index feature (`{ value, at }`).
    device.features[0].last_value = last.value;
    device.features[0].last_value_changed = new Date(last.at).toISOString();
  }
  return device;
}

/** The salt of /data in the tests (the `random` of the app). */
export const SALT = '0123456789abcdef0123456789abcdef';

/**
 * A /data that says the devices belong to the ED3 of `raw` (by its MAC, or by its address
 * when `mac` is null): the state of an installation that read its ED3 before.
 */
export function boundMemory(raw, mac = MAC) {
  const config = normalizeConfig(raw);
  const owner = mac
    ? { kind: 'mac', id: macId(SALT, mac), at: config.key }
    : { kind: 'address', id: config.key, at: config.key };
  return { format: 1, salt: SALT, owner, key: config.key, guards: [], indexes: {} };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

export async function setup({
  config,
  devices = [],
  store,
  clock = testClock({ start: START }),
  world = fakeEd3(),
  getConfig,
  fresh = false,
} = {}) {
  const cfg = config ?? CONFIG;
  const gladys = createFakeGladys({ selector: SELECTOR, config: cfg, devices });
  await gladys.connect();
  if (getConfig) gladys.getConfig = getConfig;
  world.clock = clock;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const kept = store ?? memoryStore();
  // Unless asked for a fresh install: the devices given belong to the ED3 configured.
  if (!fresh && kept.data === null) kept.data = boundMemory(cfg, world.mac ?? null);
  const app = new Ed3App({
    gladys,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    transport: world.transport,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: kept,
    random: () => SALT,
  });
  registerHandlers(gladys, app, { error: log });
  const start = async (raw = cfg) => {
    await app.connected(raw);
    await wait(1000);
  };
  async function wait(ms) {
    await clock.advance(ms);
    await settle();
  }
  /** Awaits a promise while the virtual clock moves (10 ms steps). */
  const act = async (promise, max = 30_000) => {
    let done = false;
    const result = promise.then(
      (value) => {
        done = true;
        return { value };
      },
      (error) => {
        done = true;
        return { error };
      },
    );
    await settle();
    for (let t = 0; !done && t < max; t += 10) {
      await clock.advance(10);
      await settle(3);
    }
    if (!done) throw new Error('the promise did not settle');
    const { value, error } = await result;
    if (error) throw error;
    return value;
  };
  /** A command through the fake Gladys; its ack awaited while the clock moves. */
  const cmd = (device, featureId, value) => {
    const feature = device.features.find((f) => f.external_id === featureId);
    return act(gladys.fake.setValue(device, feature ?? { external_id: featureId }, value));
  };
  /** The time since the start of the clock (ms). */
  const elapsed = () => clock.elapsed;
  return { app, gladys, clock, store: kept, world, start, wait, act, cmd, lines, elapsed };
}
