// -----------------------------------------------------------------------------
// A fake Eco-Devices 3 behind the transport of the client (no network), on
// the virtual clock of the tests: each request takes `latency` ms of that
// clock (a timer), may take a while to connect (a cut then: nothing left),
// can be cut (onStart), times out at its deadline, applies a write when it
// is received, and records everything. It also counts the requests in flight
// at once (`peak`): the lane must keep it at 1.
//
// GET /api/system/info, object/ed3/0 (and ?option=filter_state),
// object/core_logger?option=filter_state|filter_name, ebx/x8r, ebx/xthl,
// object/ed3/0/SetOnR/<n>, object/ed3/0/SetOffR/<n>; ?ApiKey=<key>.
// The answers follow the GCE Postman examples (API ED3).
// -----------------------------------------------------------------------------

import { Ed3Error } from '../../src/ed3/http.js';

export const KEY = 'S3cretKey-42';
/** The MAC address of the fake (`system/info`, as the IPX800 V5 spells it). */
export const MAC = '00:04:a3:5e:00:01';
export const COUNTER_BASE = 851968;

export function fakeEd3(options = {}) {
  const { key = KEY } = options;
  // `mac: undefined` given: an ED3 whose `system/info` answers no MAC.
  const mac = 'mac' in options ? options.mac : MAC;
  const world = {
    key,
    /** `system/info` `macAdress`; undefined: an answer without it. */
    mac,
    requests: [],
    inFlight: 0,
    peak: 0,
    /** ms of the virtual clock per request, or a function of the request. */
    latency: 20,
    /** Answers to give first: an Ed3Error | { status, json } | (req) => answer | undefined. */
    queue: [],
    /** Writes accepted but not applied (the ED3 answers 200, nothing changes). */
    ignoreWrites: false,
    /** Connections refused before anything leaves, for this many requests. */
    refuseConnect: 0,
    /** ms (or a function of the request) to connect: a cut meanwhile means nothing left. */
    connectDelay: 0,
    clock: undefined,
    relays: [false, false],
    relayNames: ['Relay 1', 'Relay 2'],
    /** Clamps: their counter (0 = none) and power (mW). */
    loggers: [COUNTER_BASE + 11, COUNTER_BASE + 12, 0, 0, 0, 0, 0, 0],
    power: [56511, 2279, 0, 0, 0, 0, 0, 0],
    urms: 236.35,
    /** Counter n -> index (Wh or mL); the others 0. */
    index: new Map([
      [0, 12_662_000],
      [11, 4_072_301],
      [19, 1_000],
      [20, 250_000],
      [25, 123_456_000],
    ]),
    names: new Map([
      [0, 'TIC'],
      [11, 'Cuisine'],
    ]),
    x8r: [
      {
        _id: 4259840,
        name: 'X8R N°0',
        codeExt: '20ab1211',
        errorStatus: '0x0000',
        bConnect: true,
        state: [true, false, false, false, false, false, false, false],
        command: [true, false, false, false, false, false, false, false],
      },
    ],
    xthl: [
      {
        _id: 4325376,
        name: 'Salon',
        codeExt: '1a2b3c4d',
        errorStatus: '0x0000',
        bVersion2: false,
        Humidite: 45,
        Luminosite: 300,
        Temperature: 21.5,
        ioFault: false,
      },
    ],
    /** Every read (not the writes) answers this status when set. */
    failReads: undefined,
    /** Another GCE box at the address: 'ipx800v5' | 'xdevices' (IPX800 V4, Eco-Devices RT2). */
    other: undefined,
    /** Paths that fail: `ebx/x8r` -> status (`object/core_logger` too). */
    failPaths: new Map(),
    sleep(ms) {
      return new Promise((resolve) => world.clock.timers.setTimeout(resolve, ms));
    },
    transport: (options, hooks) => transport(world, options, hooks),
    writes() {
      return world.requests.filter((r) => /Set(On|Off)R/.test(r.path) || r.method === 'PUT');
    },
    reads() {
      return world.requests.filter((r) => !/Set(On|Off)R/.test(r.path) && r.method !== 'PUT');
    },
  };
  return world;
}

const json = (body, status = 200) => ({ status, body: Buffer.from(JSON.stringify(body), 'utf8') });

async function transport(world, options, { monotonic, deadline, beforeSend, onSent, onStart }) {
  const record = {
    method: options.method,
    path: options.path,
    body: options.body,
    at: monotonic(),
  };
  world.requests.push(record);
  world.inFlight += 1;
  world.peak = Math.max(world.peak, world.inFlight);
  let sent = false;
  let cut;
  const cutPromise = new Promise((_, reject) => {
    cut = () => reject(new Ed3Error('cut', 'cut by a protective command', { sent }));
  });
  cutPromise.catch(() => {});
  onStart?.(() => cut());
  try {
    const connect =
      typeof world.connectDelay === 'function' ? world.connectDelay(record) : world.connectDelay;
    if (connect > 0) await Promise.race([world.sleep(connect), cutPromise]);
    if (deadline !== undefined && monotonic() >= deadline) {
      throw new Ed3Error('late', 'no time left to send');
    }
    if (world.refuseConnect > 0) {
      world.refuseConnect -= 1;
      throw new Ed3Error('network', 'connection refused', { reason: 'ECONNREFUSED' });
    }
    beforeSend?.();
    if (deadline !== undefined && monotonic() >= deadline) {
      throw new Ed3Error('late', 'no time left to send');
    }
    sent = true;
    onSent?.();
    record.sentAt = monotonic();
    const latency = typeof world.latency === 'function' ? world.latency(record) : world.latency;
    const left = deadline === undefined ? Infinity : deadline - monotonic();
    const answer = respond(world, record);
    if (latency > 0 || left < Infinity) {
      const outcome = await Promise.race([
        world.sleep(Math.min(latency, left)).then(() => (latency >= left ? 'timeout' : 'ok')),
        cutPromise,
      ]);
      if (outcome === 'timeout') {
        throw new Ed3Error('timeout', 'no answer in time', { sent: true });
      }
    }
    record.end = monotonic();
    if (answer instanceof Error) throw answer;
    return answer;
  } finally {
    world.inFlight -= 1;
  }
}

function respond(world, record) {
  let next = world.queue.shift();
  if (typeof next === 'function') next = next(record);
  if (next instanceof Error) return next;
  if (next) return json(next.json ?? {}, next.status ?? 200);
  const url = new URL(record.path, 'http://ed3');
  if (world.other) return other(world, url);
  const write = /Set(On|Off)R/.test(record.path);
  if (world.failReads && !write) return json({}, world.failReads);
  if (url.searchParams.get('ApiKey') !== world.key) return json({ error: 'unauthorized' }, 401);
  const path = url.pathname.replace(/^\/api\//, '');
  if (world.failPaths.has(path)) return json({}, world.failPaths.get(path));
  return ed3(world, record.method, path, url.searchParams.get('option'));
}

function ed3(world, method, path, option) {
  if (method !== 'GET') return json({}, 400);
  if (path === 'system/info') {
    return json({
      hostName: 'ECODEVICES3',
      version: '1.0.0',
      ...(world.mac === undefined ? {} : { macAdress: world.mac }),
    });
  }
  const relay = /^object\/ed3\/0\/Set(On|Off)R\/(\d)$/.exec(path);
  if (relay) {
    const n = Number(relay[2]);
    if (n < 1 || n > 2) return json({}, 404);
    if (!world.ignoreWrites) world.relays[n - 1] = relay[1] === 'On';
    return json({ status: 'Success' });
  }
  if (path === 'object/ed3/0') {
    const states = {
      _id: 1245184,
      Relay_state: [...world.relays],
      Relay_command: [...world.relays],
      Pulse_state: [false, false, false, false],
      Pulse_cpt: [0, 0, 0, 0],
      puissance: [...world.power],
      urms: world.urms,
    };
    if (option === 'filter_state') return json(states);
    return json({
      ...states,
      name: 'ED3',
      errorStatus: '0x0000',
      ID_Logger_tore: [...world.loggers],
      ToreName: ['Tore 1', 'Tore 2', 'Tore 3', 'Tore 4', 'Tore 5', 'Tore 6', 'Tore 7', 'Tore 8'],
      RelayName: [...world.relayNames],
      RelayMemoryMode: true,
    });
  }
  if (path === 'object/core_logger') {
    const items = [];
    for (let n = 0; n < 30; n += 1) {
      if (option === 'filter_name') {
        items.push({ _id: COUNTER_BASE + n, name: world.names.get(n) ?? `Compteur ${n}` });
      } else {
        const index = world.index.get(n) ?? 0;
        items.push({
          _id: COUNTER_BASE + n,
          index,
          indexprix: 0,
          moyenne: 0,
          instMax: 0,
          instMin: 0,
          tarif: 0,
        });
      }
    }
    return json(items);
  }
  if (path === 'ebx/x8r') return json(world.x8r);
  if (path === 'ebx/xthl') return json(world.xthl);
  return json({}, 404);
}

/** Another GCE box: an IPX800 V5 answers `system/ipx`, a V4 / RT2 `xdevices.json`; else 404. */
function other(world, url) {
  if (world.other === 'ipx800v5' && url.pathname.startsWith('/api/')) {
    if (url.searchParams.get('ApiKey') !== world.key) return json({}, 401);
    if (url.pathname === '/api/system/ipx') return json({ ioRelays_id: [1, 2, 3, 4, 5, 6, 7, 8] });
    if (url.pathname === '/api/system/info') return json({ macAdress: '00:04:a3:99:99:99' });
    return json({}, 404);
  }
  if (world.other === 'xdevices' && url.pathname === '/api/xdevices.json') {
    return url.searchParams.get('key') === world.key
      ? json({ product: 'IPX800_V4', status: 'Success' })
      : json({ status: 'Error' }, 401);
  }
  return json({}, 404);
}
