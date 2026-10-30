// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
//
// Target codes (what the user types and reads in the device names), always
// stored lower case: `r1`, `r2` the ED3's relays; `x8r<id>-<n>` output n of
// the X-8R whose ED3 id is <id> (read only); `xthl<id>`; `c<n>` counter n
// (0-29); `t<n>` current clamp n (1-8); `mains` the voltage.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { API, LIMITS_ED3, POLL_INTERVAL, RELAY_KINDS } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * The address typed by the user: `{ host, port }`, `{ error: 'path' }` when it
 * holds a path, a query or credentials (a pasted URL, maybe with the key),
 * `{ error: 'https' }`, `{ error: 'invalid' }`, `{}` when empty.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return {};
  }
  if (/^https:\/\//i.test(text)) {
    return { error: 'https' };
  }
  text = text.replace(/^http:\/\//i, '').replace(/\/$/, '');
  if (/[/?#@\s]/.test(text)) {
    return { error: 'path' };
  }
  let host = text;
  let port;
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(text);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2];
  } else if (isIP(text) !== 6) {
    const withPort = /^([^:]+):(\d{1,5})$/.exec(text);
    if (withPort) {
      host = withPort[1];
      port = withPort[2];
    } else if (text.includes(':')) {
      return { error: 'invalid' };
    }
  }
  if (isIP(host) === 0 && !HOSTNAME.test(host)) {
    return { error: 'invalid' };
  }
  if (isIP(host) === 4 && /^(0\.|255\.255\.255\.255$|22[4-9]\.|23\d\.)/.test(host)) {
    // Neither "this network", the broadcast nor a multicast group.
    return { error: 'invalid' };
  }
  const portNumber = port === undefined ? API.defaultPort : Number(port);
  if (portNumber < 1 || portNumber > 65535) {
    return { error: 'invalid' };
  }
  return { host: host.toLowerCase(), port: portNumber };
}

/** The key of an ED3 in /data: a hash of its address and port (never the API key). */
export const controllerKey = (host, port) =>
  host ? createHash('sha256').update(`ed3:${host}:${port}`, 'utf8').digest('hex').slice(0, 32) : '';

/** An API key: printable ASCII without space, 1 to 128 characters; '' when absent; null when invalid. */
export function parseApiKey(raw) {
  if (raw === undefined || raw === null) {
    return '';
  }
  const text = String(raw).trim();
  if (text === '') {
    return '';
  }
  return /^[\x21-\x7e]{1,128}$/.test(text) ? text : null;
}

const RELAY = /^r?([0-9]{1,2})$/;

/** A relay code of the ED3 (`r1`, `r2`); undefined when invalid. */
export function relayCode(text) {
  const match = RELAY.exec(String(text).trim().toLowerCase());
  if (!match) return undefined;
  const n = Number(match[1]);
  return n >= 1 && n <= LIMITS_ED3.relays ? `r${n}` : undefined;
}

/**
 * The relays Gladys may drive: `R1, R2:light` -> Map(code -> kind). A bare
 * number is a relay of the ED3 (`2` = `R2`); no kind = a switch. Every other
 * relay (the X-8R outputs included, read only in this version) is read only.
 * Wrong entries are reported, not fatal.
 */
export function parseRelays(raw) {
  const relays = new Map();
  const errors = [];
  for (const entry of String(raw ?? '').split(/[,;\n]+/)) {
    const text = entry.trim();
    if (text === '') continue;
    const match = /^([^:=\s]+)\s*(?:[:=]\s*([a-z]+))?$/i.exec(text);
    const code = match ? relayCode(match[1]) : undefined;
    const kind = (match?.[2] ?? 'switch').toLowerCase();
    if (!code || !RELAY_KINDS.includes(kind)) {
      errors.push(text.slice(0, 20));
      continue;
    }
    relays.set(code, kind);
  }
  return { relays, errors: errors.slice(0, 10) };
}

const number = (value) =>
  value === undefined || value === null || value === '' ? NaN : Number(value);

const clamp = (value, { min, max }, fallback) =>
  Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;

export function normalizeConfig(raw = {}) {
  const address = parseAddress(raw?.host);
  const port = address.port ?? API.defaultPort;
  const apiKey = parseApiKey(raw?.api_key);
  const relays = parseRelays(raw?.relays);
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  return {
    host: address.host ?? '',
    port,
    addressError: address.error,
    key: controllerKey(address.host, port),
    apiKey: apiKey ?? '',
    apiKeyInvalid: apiKey === null,
    relays: relays.relays,
    relayErrors: relays.errors,
    pollInterval: clamp(number(raw?.poll_interval), POLL_INTERVAL, DEFAULTS.poll_interval),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}

/**
 * Up to SLOTS ED3 in one integration (Gladys runs one instance of it). The
 * first one has the keys `host`, `api_key`, `relays`; the n-th one has them
 * with `_<n>` (`host_2`...). The poll interval and the language are shared.
 */
export const SLOTS = 3;

const SLOT_KEYS = ['host', 'api_key', 'relays'];
const SHARED_KEYS = ['poll_interval', 'language'];

/** The configuration of one slot, in the shape of the first one (for normalizeConfig). */
export function slotConfig(raw, slot) {
  if (slot === 1) return raw ?? {};
  const out = {};
  for (const key of SLOT_KEYS) out[key] = raw?.[`${key}_${slot}`];
  for (const key of SHARED_KEYS) out[key] = raw?.[key];
  return out;
}

/** True when a slot after the first one has an address or a key typed. */
export const slotTyped = (raw, slot) =>
  slot === 1 ||
  String(raw?.[`host_${slot}`] ?? '').trim() !== '' ||
  String(raw?.[`api_key_${slot}`] ?? '').trim() !== '';

/** True when the address and the key are there and valid. */
export const isComplete = (config) =>
  config.host !== '' &&
  config.addressError === undefined &&
  config.apiKey !== '' &&
  !config.apiKeyInvalid;

/** What a session depends on: a change starts again (and lifts a refused key). */
export const sessionKey = (config) =>
  JSON.stringify([config.host, config.port, config.apiKey, config.addressError]);
