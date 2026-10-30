// -----------------------------------------------------------------------------
// The targets of the Eco-Devices 3 -> Gladys devices and states (pure).
//
// `ext:<selector>:<kind>:<code>`: one Gladys device per relay (`r1`, `r2`,
// `x8r<id>-<n>`), X-THL (`xthl<id>`), counter (`c0`..`c29`), current clamp
// (`t1`..`t8`) and the mains (`mains`). The ED3 n of the configuration
// (n >= 2) puts `ed3<n>:` before the kind (`ext:<selector>:ed32:relay:r1`).
// The kinds, the slot prefix and the feature keys are published forever:
// never rename them. Which ED3 a slot's devices belong to is kept in /data
// (the owner, see src/app.js), never in the ids.
//
// Relays: read only (`readonly`, a state nobody can drive) unless the user
// declared them in "Relays Gladys may drive", as a switch (`switch`) or a
// light (`light`). A switch or a light obeys every "turn everything off"
// (Google, Alexa, the MCP, the scenes): only the relays the user declares
// get one. The feature key is the kind: declaring a relay adds a feature and
// keeps the old one (and its history). The X-8R outputs are read only in
// this version. Commands are checked against the configuration of now in
// src/app.js, whatever feature they come from.
//
// Counters (energy rules of the Gladys core, as gladys-ecodevices): the
// index is cumulative and guarded (src/guard.js: never 0, a drop or a jump
// held). Its category says what Gladys counts:
//   - the teleinfo total (c0) and the consumption counters (c11-c18):
//     `energy-sensor` / `index` (kWh), the consumption and its cost;
//   - production (c20, c21): `energy-production-sensor` / `index` (kWh);
//   - injection (c19): `grid-sensor` / `output-index` (kWh), never an
//     energy-sensor index (it would be counted as consumption);
//   - the teleinfo tariff indexes (c1-c10) and storage (c22-c24): a plain
//     sensor, the unit in the name (as indexes they would be counted twice,
//     or as consumption);
//   - water (c25-c27), gas (c28, c29): `volume-sensor` in m³, never in the
//     energy monitoring.
// Clamps: `energy-sensor` / `power` (W, signed: the sign of a clamp reading
// a production is not documented). The mains: `energy-sensor` / `voltage`.
// Units: only those the core lists for the category.
//
// A device published again never loses a feature: those of the device
// already created in Gladys are kept as they are.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { COUNTER_KINDS as CK, FEATURES as F, KINDS, RANGES } from './constants.js';
import { FEATURE_NAMES, indexName, slotName, targetName, word } from './i18n.js';

const KIND_LIST = Object.values(KINDS);

/** "Eco-Devices 3", "Eco-Devices 3 X-8R"... from the code. */
export const modelOf = (code) => {
  const prefix = /^(x8r|xthl)\d/.exec(code)?.[1];
  return prefix ? `Eco-Devices 3 ${prefix === 'x8r' ? 'X-8R' : 'X-THL'}` : 'Eco-Devices 3';
};

/** The features of a kind (a relay: of its declared kind). */
export function featureKeys(kind, relayKind) {
  switch (kind) {
    case KINDS.RELAY:
      return [relayKind ?? F.READONLY];
    case KINDS.COUNTER:
      return [F.INDEX];
    case KINDS.CLAMP:
      return [F.POWER];
    case KINDS.MAINS:
      return [F.VOLTAGE];
    default:
      return [F.TEMPERATURE, F.HUMIDITY, F.LUMINOSITY];
  }
}

const sensor = { read_only: true, has_feedback: false, keep_history: true };

/** The definition of an index feature, by what the counter measures. */
export function indexDefinition(counter) {
  const range = { min: RANGES.index.min, max: RANGES.index.max };
  switch (counter) {
    case CK.TIC_TOTAL:
    case CK.CONSUMPTION:
      return {
        category: C.ENERGY_SENSOR,
        type: T.ENERGY_SENSOR.INDEX,
        unit: U.KILOWATT_HOUR,
        ...range,
        ...sensor,
      };
    case CK.PRODUCTION:
      return {
        category: C.ENERGY_PRODUCTION_SENSOR,
        type: T.ENERGY_PRODUCTION_SENSOR.INDEX,
        unit: U.KILOWATT_HOUR,
        ...range,
        ...sensor,
      };
    case CK.INJECTION:
      return {
        category: C.GRID_SENSOR,
        type: T.GRID_SENSOR.OUTPUT_INDEX,
        unit: U.KILOWATT_HOUR,
        ...range,
        ...sensor,
      };
    case CK.WATER:
    case CK.GAS:
      return {
        category: C.VOLUME_SENSOR,
        type: T.VOLUME_SENSOR.DECIMAL,
        unit: U.CUBIC_METER,
        ...range,
        ...sensor,
      };
    default:
      // Teleinfo tariff indexes, storage: plain sensors (kWh in the feature name).
      return { category: C.UNKNOWN, type: T.SENSOR.DECIMAL, ...range, ...sensor };
  }
}

/** The definition of a feature, by key (`counter`: what an index measures). */
export function definitionOf(key, counter) {
  const binary = { min: 0, max: 1, keep_history: true };
  switch (key) {
    case F.READONLY:
      return {
        category: C.SWITCH,
        type: T.SWITCH.BINARY,
        ...binary,
        read_only: true,
        has_feedback: false,
      };
    case F.SWITCH:
      return {
        category: C.SWITCH,
        type: T.SWITCH.BINARY,
        ...binary,
        read_only: false,
        has_feedback: true,
      };
    case F.LIGHT:
      return {
        category: C.LIGHT,
        type: T.LIGHT.BINARY,
        ...binary,
        read_only: false,
        has_feedback: true,
      };
    case F.TEMPERATURE:
      return {
        category: C.TEMPERATURE_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.CELSIUS,
        ...RANGES.temperature,
        ...sensor,
      };
    case F.HUMIDITY:
      return {
        category: C.HUMIDITY_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.PERCENT,
        ...RANGES.humidity,
        ...sensor,
      };
    case F.LUMINOSITY:
      return {
        category: C.LIGHT_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.LUX,
        ...RANGES.luminosity,
        ...sensor,
      };
    case F.INDEX:
      return indexDefinition(counter);
    case F.POWER:
      return {
        category: C.ENERGY_SENSOR,
        type: T.ENERGY_SENSOR.POWER,
        unit: U.WATT,
        ...RANGES.power,
        ...sensor,
      };
    case F.VOLTAGE:
      return {
        category: C.ENERGY_SENSOR,
        type: T.ENERGY_SENSOR.VOLTAGE,
        unit: U.VOLT,
        ...RANGES.voltage,
        ...sensor,
      };
    default:
      throw new Error(`unknown feature ${key}`);
  }
}

/** The fields of a feature Gladys stores (what is kept of a created feature). */
const DECLARED = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
];

export const idsOf = (gladys, kind, code) => gladys.externalIds(kind, code);

/** What a slot puts before the kind in its ids: '' for the first one, `ed3<n>:` after. */
export const slotPrefix = (slot = 1) => (slot === 1 ? '' : `ed3${slot}:`);

const ID = /:(relay|thl|counter|clamp|mains):([a-z0-9-]{2,24})(?::([a-z]{1,20}))?$/;

/** The kind, code and feature key of one of our external ids of `slot`; undefined otherwise. */
export function parseExternalId(externalId, selector, slot = 1) {
  const head = `ext:${selector}:${slotPrefix(slot)}`;
  if (typeof externalId !== 'string' || !externalId.startsWith(head)) {
    return undefined;
  }
  const match = ID.exec(externalId);
  if (!match || !KIND_LIST.includes(match[1])) return undefined;
  if (externalId !== `${head}${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ''}`) {
    return undefined;
  }
  return { kind: match[1], code: match[2], key: match[3] };
}

/** The slot of one of our external ids (`ext:<selector>:ed32:...` -> 2); 1 otherwise. */
export function slotOf(externalId, selector) {
  const match = /^ed3([2-9]):/.exec(
    typeof externalId === 'string' && externalId.startsWith(`ext:${selector}:`)
      ? externalId.slice(`ext:${selector}:`.length)
      : '',
  );
  return match ? Number(match[1]) : 1;
}

/**
 * The states of a target read: `[key, state]` pairs, only for the values
 * read (an unknown value publishes nothing, never 0). A relay's state goes
 * to every relay key (`keys`: those of the created device). The index of a
 * counter is not here: it goes through its guard (src/app.js).
 */
export function targetStates(target, keys) {
  const value = target.value;
  if (value === undefined) return [];
  switch (target.kind) {
    case KINDS.RELAY:
      return [F.READONLY, F.SWITCH, F.LIGHT]
        .filter((key) => keys?.has(key))
        .map((key) => [key, { state: value }]);
    case KINDS.CLAMP:
      return [[F.POWER, { state: value }]];
    case KINDS.MAINS:
      return [[F.VOLTAGE, { state: value }]];
    case KINDS.THL:
      return [
        [F.TEMPERATURE, value.temperature],
        [F.HUMIDITY, value.humidity],
        [F.LUMINOSITY, value.luminosity],
      ]
        .filter(([, v]) => v !== undefined)
        .map(([key, v]) => [key, { state: v }]);
    default:
      return [];
  }
}

/**
 * The Gladys device of a target. `created`: the device already created in
 * Gladys, whose name and features are kept.
 */
export function buildDevice(gladys, target, { language, relayKind, created, slot = 1 }) {
  const ids = idsOf(gladys, target.kind, target.code);
  const built = {
    name: created?.name ?? word(slotName(slot, targetName(target)), language),
    external_id: ids.device,
    model: modelOf(target.code),
    should_poll: false,
    features: featureKeys(target.kind, relayKind).map((key) => ({
      name: word(key === F.INDEX ? indexName(target.counter) : FEATURE_NAMES[key], language),
      external_id: ids.feature(key),
      ...definitionOf(key, target.counter),
    })),
    params: [{ name: 'code', value: target.code.toUpperCase() }],
  };
  if (!created) {
    return built;
  }
  const have = new Set(built.features.map((f) => f.external_id));
  const kept = (created.features ?? [])
    .filter((f) => typeof f?.external_id === 'string' && !have.has(f.external_id))
    .map((f) =>
      Object.fromEntries(
        DECLARED.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
      ),
    );
  return { ...built, features: [...built.features, ...kept] };
}
