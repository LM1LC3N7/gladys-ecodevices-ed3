// -----------------------------------------------------------------------------
// What the answers of the Eco-Devices 3 mean (pure): the targets the
// integration knows and their values. A target is
//   { code, kind, n?, name?, value, ... }
// `value`: 0 / 1 for a relay, `{ temperature, humidity, luminosity }` for an
// X-THL, the index in kWh (electricity) or m³ (water, gas) for a counter, W
// for a clamp, V for the mains; `undefined` when the answer does not give it
// (absent, a text, out of range, a counter at 0: never 0).
//
// Every number is checked strictly (a text, '' or null is not 0), every list
// and name is bounded, and nothing the ED3 sends becomes an object key (Maps
// only): no prototype pollution.
// -----------------------------------------------------------------------------

import {
  COUNTERS,
  COUNTER_BASE,
  KINDS,
  LIMITS,
  LIMITS_ED3,
  RANGES,
  counterKind,
  isVolume,
} from '../constants.js';

const own = (object, key) =>
  object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key)
    ? object[key]
    : undefined;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A finite number within a range, undefined otherwise (never a text). */
const measure = (value, range) =>
  typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max
    ? value
    : undefined;

/** An ED3 id: a non-negative integer. */
const isId = (value) => Number.isInteger(value) && value >= 0 && value <= LIMITS_ED3.maxId;

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** A name the ED3 gives: printable, bounded; undefined otherwise. */
export function cleanName(raw) {
  if (typeof raw !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
  return text === '' ? undefined : text.slice(0, LIMITS.nameLength);
}

/** A list (bounded); undefined when not a list. */
const list = (json) => (Array.isArray(json) ? json.slice(0, LIMITS.items) : undefined);

/** A paired extension: a code that is not empty nor "0" (an object created, nothing paired). */
const paired = (codeExt) =>
  typeof codeExt === 'string' && /^[0-9a-f]{1,16}$/i.test(codeExt) && !/^0+$/.test(codeExt);

/**
 * The MAC address of a `system/info` answer, lower case with colons;
 * undefined when absent, malformed, all zeros or all ones (no identity,
 * never "another ED3"). The field is not documented for the ED3: the names
 * of the IPX800 V5 (`macAdress`, same firmware family) and the usual ones.
 */
export function parseMac(json) {
  if (!isObject(json)) return undefined;
  const raw =
    own(json, 'macAdress') ?? own(json, 'macAddress') ?? own(json, 'mac') ?? own(json, 'MAC');
  if (typeof raw !== 'string') return undefined;
  const hex = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{2}(?:[:-]?[0-9a-f]{2}){5}$/.test(hex)) return undefined;
  const digits = hex.replace(/[:-]/g, '');
  if (/^0{12}$|^f{12}$/.test(digits)) return undefined;
  return digits.match(/../g).join(':');
}

/** The relay states of an `object/ed3/0` answer (full or `filter_state`); undefined when absent. */
function relayStates(json) {
  const states = own(json, 'Relay_state');
  if (!Array.isArray(states) || states.length < LIMITS_ED3.relays) return undefined;
  return states
    .slice(0, LIMITS_ED3.relays)
    .map((on) => (typeof on === 'boolean' ? (on ? 1 : 0) : undefined));
}

/**
 * `object/ed3/0` -> Map(code -> target): the two relays, the clamps linked
 * to a counter (`ID_Logger_tore` not 0: a clamp not set up is not offered),
 * the mains voltage. An answer without `Relay_state` is not an ED3.
 */
export function parseEd3(json) {
  if (!isObject(json)) return { error: 'bad_response' };
  const relays = relayStates(json);
  if (!relays) return { error: 'bad_response' };
  const targets = new Map();
  const relayNames = own(json, 'RelayName');
  for (let n = 1; n <= LIMITS_ED3.relays; n += 1) {
    targets.set(`r${n}`, {
      code: `r${n}`,
      kind: KINDS.RELAY,
      n,
      name: cleanName(Array.isArray(relayNames) ? relayNames[n - 1] : undefined),
      value: relays[n - 1],
    });
  }
  const loggers = own(json, 'ID_Logger_tore');
  const powers = own(json, 'puissance');
  // The counters fed by a clamp: their index unit is not confirmed (Wh or mWh, see TODO.md),
  // so they are not published as energy indexes. Without the list (`clampsListed` false), the
  // source of the counters a clamp may feed (11 to 24) is unknown: all of them are held.
  const clampCounters = new Set();
  if (Array.isArray(loggers)) {
    for (const id of loggers.slice(0, LIMITS_ED3.clamps)) {
      const n = counterNumber(id);
      if (n !== undefined) clampCounters.add(n);
    }
  } else {
    for (let n = 11; n <= 24; n += 1) clampCounters.add(n);
  }
  const clampNames = own(json, 'ToreName');
  if (Array.isArray(loggers)) {
    for (let n = 1; n <= LIMITS_ED3.clamps; n += 1) {
      const logger = loggers[n - 1];
      if (!isId(logger) || logger === 0) continue;
      // `puissance`: mW (GCE: "Puissance lue à chaque entrée Tore en mW").
      const mw = Array.isArray(powers) ? powers[n - 1] : undefined;
      const watts = typeof mw === 'number' ? measure(round(mw / 1000, 1), RANGES.power) : undefined;
      targets.set(`t${n}`, {
        code: `t${n}`,
        kind: KINDS.CLAMP,
        n,
        name: cleanName(Array.isArray(clampNames) ? clampNames[n - 1] : undefined),
        value: watts,
      });
    }
  }
  const urms = own(json, 'urms');
  const volts = typeof urms === 'number' ? measure(round(urms, 1), RANGES.voltage) : undefined;
  if (volts !== undefined) {
    targets.set('mains', { code: 'mains', kind: KINDS.MAINS, value: volts });
  }
  return { targets, clampCounters, clampsListed: Array.isArray(loggers) };
}

/** The relay states of a read back (`object/ed3/0?option=filter_state`): Map(code -> 0 | 1 | undefined). */
export function parseEd3States(json) {
  const relays = isObject(json) ? relayStates(json) : undefined;
  if (!relays) return { error: 'bad_response' };
  const values = new Map();
  for (let n = 1; n <= LIMITS_ED3.relays; n += 1) values.set(`r${n}`, relays[n - 1]);
  return { values };
}

/** The number (0-29) of a counter `_id`; undefined when not one. */
export const counterNumber = (id) =>
  Number.isInteger(id) && id >= COUNTER_BASE && id < COUNTER_BASE + COUNTERS
    ? id - COUNTER_BASE
    : undefined;

/** `{ _id, name }` list -> Map(n -> name). */
export function parseCounterNames(json) {
  const names = new Map();
  for (const item of list(json) ?? []) {
    const n = counterNumber(own(item, '_id'));
    const name = cleanName(own(item, 'name'));
    if (n !== undefined && name !== undefined) names.set(n, name);
  }
  return names;
}

/**
 * The index of a counter in the unit published: Wh -> kWh, mL -> m³ (3
 * decimals: 1 Wh, 1 L). 0 is no index (a counter not set up, or one the ED3
 * did not read yet): undefined, never published.
 */
export function indexValue(raw, kind) {
  if (!Number.isInteger(raw) || raw <= 0) return undefined;
  const value = isVolume(kind) ? round(raw / 1e6, 3) : round(raw / 1000, 3);
  return value > 0 ? measure(value, RANGES.index) : undefined;
}

/**
 * `core_logger?option=filter_state` -> Map(code -> target): every counter
 * listed (by its `_id`) but those fed by a clamp (`clampCounters`), its index
 * converted; `names`: Map(n -> name) when read. Not a list: not an ED3 answer.
 */
export function parseCounters(json, names, clampCounters) {
  const items = list(json);
  if (!items) return { error: 'bad_response' };
  const targets = new Map();
  const seen = new Set();
  /** Counters fed by a clamp that hold an index: not offered, named in the status. */
  const skipped = [];
  for (const item of items) {
    const n = counterNumber(own(item, '_id'));
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    // Fed by a clamp: its unit is not confirmed (Wh or mWh): never an index (TODO.md).
    if (clampCounters?.has(n)) {
      if (indexValue(own(item, 'index'), counterKind(n)) !== undefined) skipped.push(n);
      continue;
    }
    const kind = counterKind(n);
    const value = indexValue(own(item, 'index'), kind);
    targets.set(`c${n}`, {
      code: `c${n}`,
      kind: KINDS.COUNTER,
      n,
      counter: kind,
      name: names?.get(n),
      value,
      // No index (0: not set up, or not read by the ED3 yet): not offered in Discover.
      idle: value === undefined,
    });
  }
  return { targets, skipped: skipped.sort((a, b) => a - b) };
}

/** `ebx/x8r` -> Map(code -> target): the 8 outputs of each X-8R paired (read only). */
export function parseX8r(json) {
  const items = list(json);
  if (!items) return { error: 'bad_response' };
  const targets = new Map();
  for (const ext of items.slice(0, LIMITS_ED3.extensions)) {
    const id = own(ext, '_id');
    const states = own(ext, 'state');
    if (!isId(id) || !paired(own(ext, 'codeExt')) || !Array.isArray(states)) continue;
    const extName = cleanName(own(ext, 'name'));
    for (let k = 1; k <= LIMITS_ED3.x8; k += 1) {
      const on = states[k - 1];
      const code = `x8r${id}-${k}`;
      targets.set(code, {
        code,
        kind: KINDS.RELAY,
        ext: id,
        extName,
        n: k,
        value: typeof on === 'boolean' ? (on ? 1 : 0) : undefined,
      });
    }
  }
  return { targets };
}

/** `ebx/xthl` -> Map(code -> target): each X-THL paired; a sensor in fault gives no value. */
export function parseXthl(json) {
  const items = list(json);
  if (!items) return { error: 'bad_response' };
  const targets = new Map();
  for (const ext of items.slice(0, LIMITS_ED3.extensions)) {
    const id = own(ext, '_id');
    if (!isId(id) || !paired(own(ext, 'codeExt'))) continue;
    const fault = own(ext, 'ioFault') === true;
    const value = fault
      ? undefined
      : {
          temperature: measure(own(ext, 'Temperature'), RANGES.temperature),
          humidity: measure(own(ext, 'Humidite'), RANGES.humidity),
          luminosity: measure(own(ext, 'Luminosite'), RANGES.luminosity),
        };
    const empty =
      value &&
      value.temperature === undefined &&
      value.humidity === undefined &&
      value.luminosity === undefined;
    const code = `xthl${id}`;
    targets.set(code, {
      code,
      kind: KINDS.THL,
      ext: id,
      extName: cleanName(own(ext, 'name')),
      value: empty ? undefined : value,
      fault,
    });
  }
  return { targets };
}
