// -----------------------------------------------------------------------------
// Constants: the local HTTP API of the GCE Eco-Devices 3 (ED3), the targets
// the integration knows, the manifest keys, the limits and the timings.
//
// The API, as GCE documents it (Postman "API ED3", linked from the ED3 page)
// and as cce66's ED3 Api-Deck v2.1 uses it (MIT, a tester written by a user):
//   GET|PUT /api/<path>?ApiKey=<API key>
//   - `object/ed3/0`: the ED3 itself: `RelayName` (2), `Relay_state` (2
//     booleans), `ToreName` (8), `ID_Logger_tore` (8: the counter of each
//     clamp, 0 = none), `puissance` (8, mW), `urms` (V);
//     `?option=filter_state` the states only (the read back of a relay);
//   - `object/ed3/0/SetOnR/<1|2>` / `SetOffR/<1|2>` (GET): one relay on / off;
//   - `object/core_logger?option=filter_state`: the counters (up to 30; a
//     real ED3, firmware 1.3.0, listed 26: an entry may be missing, a counter
//     is known by its `_id` only) `{ _id, index, indexprix, moyenne, instMax,
//     instMin, tarif }`, `index` in Wh (electricity) or mL (water, gas),
//     "strictly increasing";
//     `?option=filter_name`: `{ _id, name }`;
//   - `ebx/x8r`: the X-8R extensions `{ _id, name, codeExt, state[8], command[8] }`;
//   - `ebx/xthl`: the X-THL `{ _id, name, codeExt, Temperature, Humidite,
//     Luminosite, ioFault }`;
//   - `system/info`: `productName` "ECODEVICES3", `macAdress`
//     ("XX-XX-XX-XX-XX-XX"), `hostName`, `firmwareVersion` ("1.3.0 ", with a
//     trailing space), `compiled` (a real ED3, cce66, 2026-10-31); only the
//     MAC is used (src/ed3/model.js).
// The API key travels in the query string: a URL is never logged, nor put in
// an error, a status or /data.
//
// Counters: the `_id` of counter n (0-29) is 851968 + n (0xD0000), their
// kind by number (GCE "Objet Core Logger", the same table in cce66's
// Mqtt-Deck): 0 the teleinfo total, 1-10 the teleinfo tariff indexes, 11-18
// consumption, 19 injection, 20-21 production, 22-24 storage, 25-27 water,
// 28-29 gas.
// -----------------------------------------------------------------------------

export const API = {
  defaultPort: 80,
  base: '/api/',
  keyParam: 'ApiKey',
};

/** The `_id` of counter 0; counter n is BASE + n. */
export const COUNTER_BASE = 851968;
export const COUNTERS = 30;

/** What a counter measures, by its number. */
export const COUNTER_KINDS = {
  TIC_TOTAL: 'tic-total',
  TIC_TARIFF: 'tic-tariff',
  CONSUMPTION: 'consumption',
  INJECTION: 'injection',
  PRODUCTION: 'production',
  STORAGE: 'storage',
  WATER: 'water',
  GAS: 'gas',
};

export function counterKind(n) {
  if (!Number.isInteger(n) || n < 0 || n >= COUNTERS) return undefined;
  if (n === 0) return COUNTER_KINDS.TIC_TOTAL;
  if (n <= 10) return COUNTER_KINDS.TIC_TARIFF;
  if (n <= 18) return COUNTER_KINDS.CONSUMPTION;
  if (n === 19) return COUNTER_KINDS.INJECTION;
  if (n <= 21) return COUNTER_KINDS.PRODUCTION;
  if (n <= 24) return COUNTER_KINDS.STORAGE;
  if (n <= 27) return COUNTER_KINDS.WATER;
  return COUNTER_KINDS.GAS;
}

/** Water and gas counters count mL; the others Wh. */
export const isVolume = (kind) => kind === COUNTER_KINDS.WATER || kind === COUNTER_KINDS.GAS;

/**
 * The margins of the index guard (src/guard.js), per hour, in the unit
 * published (kWh, m³): a jump beyond them is held until the user accepts it.
 */
export const GUARD_LIMITS = {
  /** A home: 100 kW at most (a 36 kVA contract is far below), 0.5 kWh slack. */
  electricity: { maxKw: 100, slackKwh: 0.5 },
  /** Water: 10 m³/h at most (a home meter gives 2.5 to 4), 0.05 m³ slack. */
  water: { maxKw: 10, slackKwh: 0.05 },
  /** Gas: 16 m³/h at most (a G4 meter gives 6, a G10 16), 0.05 m³ slack. */
  gas: { maxKw: 16, slackKwh: 0.05 },
};

export const guardLimitsOf = (kind) =>
  kind === COUNTER_KINDS.WATER
    ? GUARD_LIMITS.water
    : kind === COUNTER_KINDS.GAS
      ? GUARD_LIMITS.gas
      : GUARD_LIMITS.electricity;

/** Kinds of targets (the type part of the external ids): frozen. */
export const KINDS = {
  RELAY: 'relay',
  THL: 'thl',
  COUNTER: 'counter',
  CLAMP: 'clamp',
  MAINS: 'mains',
};

/** Feature keys (the last part of the feature external ids): frozen. */
export const FEATURES = {
  /** Relays: the key is the kind the user gave it (a new kind adds a feature). */
  READONLY: 'readonly',
  SWITCH: 'switch',
  LIGHT: 'light',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  LUMINOSITY: 'luminosity',
  INDEX: 'index',
  POWER: 'power',
  VOLTAGE: 'voltage',
};

/** What a relay declared in the configuration becomes. */
export const RELAY_KINDS = [FEATURES.SWITCH, FEATURES.LIGHT];

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  ATTACH: 'attach_devices',
  ACCEPT_INDEX: 'accept_held_index',
};

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = { min: 10, max: 300, default: 15 };

/** The ED3's own relays; outputs per X-8R; extensions read per type. */
export const LIMITS_ED3 = {
  relays: 2,
  clamps: 8,
  x8: 8,
  extensions: 8,
  /** The largest id taken (objects, extensions). */
  maxId: 1e9,
};

/** A measurement out of these ranges is not one (never published). */
export const RANGES = {
  temperature: { min: -40, max: 85 },
  humidity: { min: 0, max: 100 },
  luminosity: { min: 0, max: 200_000 },
  /** W: a clamp may read a production (its sign is not documented: signed). */
  power: { min: -100_000, max: 100_000 },
  /** V: 0 is no measurement (the ED3 not powered by the mains it measures). */
  voltage: { min: 80, max: 300 },
  /** kWh / m³ published: below 1e9 (Gladys stores a double; a larger one is a glitch). */
  index: { min: 0, max: 1e9 },
};

export const LIMITS = {
  /** Gladys: 300 states per minute; a margin is kept. */
  statesPerMinute: 250,
  statesPerRequest: 100,
  /** An answer is read up to this size, then dropped (the counters: ~4 KB). */
  responseBytes: 256 * 1024,
  /** Items of a list kept (counters, extensions): more is not an ED3. */
  items: 256,
  /** Names are cut to this length. */
  nameLength: 60,
  /** Non-protective commands waiting (a scene); protective ones are never refused for room. */
  commandQueue: 16,
  /** Protective commands kept in /data to send again. */
  guards: 16,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** One request of the polling. */
  requestTimeout: 5 * SECOND,
  /** A round (identity, ED3, counters, names, extensions) takes no longer than this. */
  roundBudget: 25 * SECOND,
  /** Failed rounds: 10 s, 30 s, 1, 2 then 5 min, never shorter than the interval. */
  backoff: [10 * SECOND, 30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE],
  /** The ED3 asks to wait (429, 503): at least a minute. */
  busyPause: MINUTE,
  /** A pause is never longer than this, whatever /data holds. */
  pauseMax: HOUR,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** The counter indexes go to Gladys once a minute at most. */
  indexInterval: MINUTE,
  indexSlack: SECOND,
  /** The counter names are read again this often (they change only on the ED3 page). */
  namesInterval: 10 * MINUTE,
  /** "Test the connection" reads at most this often; it answers within 25 s (Gladys waits 30 s). */
  testCooldown: 10 * SECOND,
  testBudget: 25 * SECOND,
  /**
   * Commands (Gladys waits 5 s for the ack): written by 3.5 s after the
   * click or refused unsent; the read back awaited until 4.3 s, after which
   * the command is "sent, without confirmation" and read again later.
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** A protective command not sent at once is tried again during this budget. */
  protectiveRetry: 250,
  protectiveRetryGap: 50,
  /** A protective write without answer for this long is cut when another one waits. */
  stuckProtective: SECOND,
  /** Between two requests to the ED3 (after the previous connection is closed). */
  laneGap: 10,
  /** A request cut by a protective command is closed within this (socket destroyed). */
  cutWait: 500,
  /** Reads after a command: its effect, then a check. */
  followUps: [5 * SECOND, 20 * SECOND],
  /** A protective command contradicted by the reads is sent again this many times at most. */
  resendMax: 3,
  /** The configuration of Gladys not read: new tries 5 s, 15 s, then every minute. */
  configRetry: [5 * SECOND, 15 * SECOND, MINUTE],
  /** A click while the configuration is unread asks for it at once (2 s apart at most) and waits this long. */
  configAskGap: 2 * SECOND,
  configWait: 3 * SECOND,
  /** At start, an Off waits this long at most for the MAC of the ED3 to be read. */
  identityWait: 1_500,
  /** "Attach the devices": the second click within this. */
  attachConfirm: MINUTE,
  /** A /data load or save that has not answered after this is a failure (never awaited for good). */
  storeWait: 5 * SECOND,
  /** The same ED3 as an earlier slot (its MAC): read again this often only. */
  duplicatePause: 5 * MINUTE,
  /** "Accept the held index": the second click 3 s to 5 min after the first. */
  acceptAfter: 3 * SECOND,
  acceptWithin: 5 * MINUTE,
};
