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
 * never "another ED3"). A real ED3 (firmware 1.3.0) gives `macAdress` as
 * "XX-XX-XX-XX-XX-XX" (dashes, upper case), as the IPX800 V5; the usual
 * other names are tried too.
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
 * One list of counter links of `object/ed3/0` (`ID_Logger_tore`, `ID_Logger_tore_neg`,
 * `ID_Logger_pulse`): `{ ids }` (per input, the counter number or undefined for 0),
 * `{ absent: true }` or `{ bad: true }`. Only the form a real ED3 gives (firmware 1.3.0) and
 * GCE documents is taken: a list of exactly `size` entries, each 0 or a counter `_id`
 * (851968 + n), within `range` when given (a clamp feeds only 11 to 24, GCE). Another
 * length, a counter number (0-29) instead of an `_id`, a text, a clamp linked to a teleinfo,
 * water or gas counter: bad (another firmware), never guessed.
 */
function linkList(value, size, range) {
  if (value === undefined) return { absent: true };
  if (!Array.isArray(value) || value.length !== size) return { bad: true };
  const ids = [];
  for (const id of value) {
    if (id === 0) {
      ids.push(undefined);
      continue;
    }
    const n = counterNumber(id);
    if (n === undefined || (range && (n < range.first || n > range.last))) return { bad: true };
    ids.push(n);
  }
  return { ids };
}

/**
 * The inputs that feed each counter: Map(n -> { from: 'clamp' | 'pulse', input, negative,
 * name }). A counter listed twice (two inputs, or both directions) is ambiguous: no source.
 */
function counterSources(lists, json) {
  const sources = new Map();
  const twice = new Set();
  const clampNames = own(json, 'ToreName');
  const pulseNames = own(json, 'PulseName');
  for (const [from, negative, list, names] of [
    ['clamp', false, lists.tore, clampNames],
    ['clamp', true, lists.toreNeg, clampNames],
    ['pulse', false, lists.pulse, pulseNames],
  ]) {
    if (!list?.ids) continue;
    list.ids.forEach((n, i) => {
      if (n === undefined) return;
      if (sources.has(n)) twice.add(n);
      sources.set(n, {
        from,
        input: i + 1,
        negative,
        name: cleanName(Array.isArray(names) ? names[i] : undefined),
      });
    });
  }
  for (const n of twice) sources.delete(n);
  return sources;
}

/** The counters a clamp may feed (consumption, injection, production, storage). */
const CLAMP_COUNTERS = { first: 11, last: 24 };

/** An electricity counter (0-24: teleinfo, consumption, injection, production, storage). */
const isElectricity = (n) => !isVolume(counterKind(n));

/**
 * The electricity counters a pulse input may feed, held (their unit is not checked for a
 * pulse input): `fed`, every one `ID_Logger_pulse` lists, a counter listed twice included
 * (its source ambiguous, a pulse input among them); `unread`, when `ID_Logger_pulse` is
 * given in another form (another firmware): every electricity counter no clamp is known to
 * feed (all of them without the clamp links in the expected form).
 */
function pulseHolds(lists, linksRead) {
  const fed = new Set((lists.pulse.ids ?? []).filter((n) => n !== undefined && isElectricity(n)));
  const unread = new Set();
  if (lists.pulse.bad) {
    const clampFed = new Set(
      linksRead
        ? [...lists.tore.ids, ...(lists.toreNeg.ids ?? [])].filter((n) => n !== undefined)
        : [],
    );
    for (let n = 0; n < COUNTERS; n += 1) {
      if (isElectricity(n) && !clampFed.has(n)) unread.add(n);
    }
  }
  return { fed, unread };
}

/**
 * `object/ed3/0` -> Map(code -> target): the two relays, the clamps linked to a counter
 * (`ID_Logger_tore` or `ID_Logger_tore_neg` not 0: a clamp not set up is not offered), the
 * mains voltage; `sources`: the input feeding each counter (its name in Gladys); `held`: the
 * counters not published. An answer without `Relay_state` is not an ED3.
 *
 * The index of a counter fed by a clamp is in Wh as the teleinfo's (GCE: `index` "en wH"
 * for the Core Loggers of the teleinfo and the clamps). Checked on a real ED3 (firmware
 * 1.3.0): the counter of its battery clamp T7 (negative) grew 4 029 in 71 h, 56.7 W on
 * average in Wh, while T7 read -63.8 W (`puissance`, mW, itself checked against
 * irms x urms x cosphi) and 59 W in `objDescriptor`: Wh, never mWh (0.06 W). That was checked
 * with the links in the form above only: without them (absent, or in another form: another
 * firmware), the counters 11 to 24 are held as before, their source unknown. A counter fed
 * by a pulse input is published only as water or gas (mL, checked with a meter): an
 * electricity counter fed by one, or that may be (listed twice, or `ID_Logger_pulse` in
 * another form), is held (`pulse`, see pulseHolds and parseCounters), its unit not checked.
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
  const rawTore = own(json, 'ID_Logger_tore');
  const rawToreNeg = own(json, 'ID_Logger_tore_neg');
  const lists = {
    tore: linkList(rawTore, LIMITS_ED3.clamps, CLAMP_COUNTERS),
    toreNeg: linkList(rawToreNeg, LIMITS_ED3.clamps, CLAMP_COUNTERS),
    pulse: linkList(own(json, 'ID_Logger_pulse'), LIMITS_ED3.pulses),
  };
  // The links are read when `ID_Logger_tore` has the expected form, and `ID_Logger_tore_neg`
  // too when given (GCE's example has none: an older firmware).
  const linksRead = lists.tore.ids !== undefined && !lists.toreNeg.bad;
  const sources = linksRead ? counterSources(lists, json) : new Map();
  const held = new Set();
  if (!linksRead) {
    for (let n = CLAMP_COUNTERS.first; n <= CLAMP_COUNTERS.last; n += 1) held.add(n);
  }
  const pulse = pulseHolds(lists, linksRead);
  // A clamp is offered when a counter takes its measure; with links of another form, when
  // either list holds something else than 0 there (a clamp not set up holds 0).
  const linked = (n) =>
    linksRead
      ? lists.tore.ids[n - 1] !== undefined || lists.toreNeg.ids?.[n - 1] !== undefined
      : [rawTore, rawToreNeg].some(
          (raw) => Array.isArray(raw) && isId(raw[n - 1]) && raw[n - 1] !== 0,
        );
  const clampNames = own(json, 'ToreName');
  const powers = own(json, 'puissance');
  for (let n = 1; n <= LIMITS_ED3.clamps; n += 1) {
    if (!linked(n)) continue;
    // `puissance`: mW (GCE: "Puissance lue à chaque entrée Tore en mW"; a real ED3: 1 455 467
    // for 6 580 mA x 235.53 V x cos phi 0.9395 = 1 456 W), signed: positive while the clamp
    // feeds its `ID_Logger_tore` counter, negative its `ID_Logger_tore_neg` one.
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
  const urms = own(json, 'urms');
  const volts = typeof urms === 'number' ? measure(round(urms, 1), RANGES.voltage) : undefined;
  if (volts !== undefined) {
    targets.set('mains', { code: 'mains', kind: KINDS.MAINS, value: volts });
  }
  return { targets, held, sources, linksRead, pulse };
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
 * listed (by its `_id`) but those held (`held`, see parseEd3), its index
 * converted; `names`: Map(n -> name) when read; `sources`: Map(n -> the input
 * feeding it, parseEd3); `pulse`: the electricity counters a pulse input feeds or may
 * feed (parseEd3), held. Not a list: not an ED3 answer.
 */
export function parseCounters(json, names, held, sources, pulse) {
  const items = list(json);
  if (!items) return { error: 'bad_response' };
  const targets = new Map();
  const seen = new Set();
  /** Counters held that hold an index: not offered, named in the status. */
  const skipped = [];
  /** Electricity counters fed by a pulse input holding an index: the same, said apart. */
  const pulseSkipped = [];
  /** Electricity counters a pulse input may feed (`ID_Logger_pulse` in another form): the same. */
  const pulseUnreadSkipped = [];
  for (const item of items) {
    const n = counterNumber(own(item, '_id'));
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    // Held (its source unknown, see parseEd3): never an index.
    if (held?.has(n)) {
      if (indexValue(own(item, 'index'), counterKind(n)) !== undefined) skipped.push(n);
      continue;
    }
    const kind = counterKind(n);
    const value = indexValue(own(item, 'index'), kind);
    // Fed by a pulse input but not water nor gas: its unit is not checked (Wh assumed): held.
    if ((sources?.get(n)?.from === 'pulse' || pulse?.fed?.has(n)) && !isVolume(kind)) {
      if (value !== undefined) pulseSkipped.push(n);
      continue;
    }
    // Maybe fed by one (the pulse links unreadable): held the same.
    if (pulse?.unread?.has(n)) {
      if (value !== undefined) pulseUnreadSkipped.push(n);
      continue;
    }
    targets.set(`c${n}`, {
      code: `c${n}`,
      kind: KINDS.COUNTER,
      n,
      counter: kind,
      name: names?.get(n),
      source: sources?.get(n),
      value,
      // No index (0: not set up, or not read by the ED3 yet): not offered in Discover.
      idle: value === undefined,
    });
  }
  return {
    targets,
    skipped: skipped.sort((a, b) => a - b),
    pulseSkipped: pulseSkipped.sort((a, b) => a - b),
    pulseUnreadSkipped: pulseUnreadSkipped.sort((a, b) => a - b),
  };
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
