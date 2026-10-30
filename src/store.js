// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), bounded and checked when read back:
//   - the time of the last read attempt (a restart never reads sooner);
//   - the owner: the ED3 the devices of this slot were created for (a salted
//     hash of its MAC address, or its controller key when it gives none),
//     whatever the controller configured now;
//   - for the controller it belongs to (a hash of its address and port), the
//     pause after failed reads, the refused API key (a salted 8-bit tag,
//     never the key) and the switch-offs to send again (guards);
//   - the guard of each counter index (its reference and a value held back),
//     for the device it belongs to.
// Never the API key nor the address. A small JSON file, written through a
// temporary file and a rename, one save after the other, readable by the
// container user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { LIMITS, TIMINGS } from './constants.js';

export const STATE_FILE = '/data/ed3-state.json';
/** The file of a slot. */
export const stateFile = (slot = 1) =>
  slot === 1 ? STATE_FILE : `/data/ed3-state-${Number(slot)}.json`;
export const FORMAT = 1;
/** A larger file is not ours: refused (read bounded). */
const MAX_STATE_BYTES = 256 * 1024;

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    /** null when there is no file (a fresh install); throws when it cannot be read or parsed. */
    async load() {
      let text;
      try {
        text = await readFile(path, 'utf8');
      } catch (err) {
        if (err?.code === 'ENOENT') {
          return null;
        }
        throw err;
      }
      if (Buffer.byteLength(text) > MAX_STATE_BYTES) {
        throw new Error('state file too large');
      }
      return JSON.parse(text);
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.writeFile(text, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** The same in memory (tests). `fail`: the next saves throw; `unreadable`: load throws. */
export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    fail: false,
    unreadable: false,
    async load() {
      if (this.unreadable) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      if (this.fail) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

const time = (value) => (Number.isFinite(value) && value > 0 ? value : undefined);

/** A guard read back: `{ code, value, resends, confirmed, other }`; undefined when not valid. */
function guardOf(raw) {
  // Only what a protective command writes: one of the ED3's relays off (0).
  const valid = /^r[12]$/.test(raw?.code ?? '') && raw.kind === 'relay' && raw.value === 0;
  if (!valid) {
    return undefined;
  }
  return {
    code: raw.code,
    kind: raw.kind,
    value: raw.value,
    resends: Number.isInteger(raw.resends) ? Math.min(Math.max(raw.resends, 0), 99) : 0,
    confirmed: raw.confirmed === true,
    other: raw.other === 0 || raw.other === 1 ? raw.other : undefined,
  };
}

const HEX32 = /^[0-9a-f]{32}$/;

/** An owner read back: `{ kind: 'mac' | 'address', id, at }`; null when not valid. */
function ownerOf(raw) {
  if (!raw || typeof raw !== 'object' || !['mac', 'address'].includes(raw.kind)) return null;
  if (typeof raw.id !== 'string' || !HEX32.test(raw.id)) return null;
  const at = typeof raw.at === 'string' && HEX32.test(raw.at) ? raw.at : '';
  return { kind: raw.kind, id: raw.id, at };
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** A counter index state read back: `{ device, last, held }` (src/guard.js checks it again). */
function indexOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const device =
    typeof raw.device === 'string' && /^[\x20-\x7e]{1,64}$/.test(raw.device) ? raw.device : null;
  const last =
    raw.last && finite(raw.last.value) && finite(raw.last.at)
      ? { value: raw.last.value, at: raw.last.at }
      : null;
  const h = raw.held;
  const held =
    h &&
    (h.direction === 'up' || h.direction === 'down') &&
    ['from', 'to', 'threshold', 'at'].every((k) => finite(h[k]))
      ? { direction: h.direction, from: h.from, to: h.to, threshold: h.threshold, at: h.at }
      : null;
  return { device, last, held };
}

/** An empty memory. */
export const emptyMemory = () => ({
  format: FORMAT,
  lastAttemptAt: null,
  salt: '',
  owner: null,
  key: '',
  pause: null,
  refused: null,
  guards: [],
  indexes: {},
});

/**
 * The persisted state, repaired; dates in the future are brought to `now`
 * (wall clock), the end of a pause is capped from `now`, so a clock jump or
 * a hand-edited file never stops the reads for good.
 */
export function normalizeMemory(raw, now = Date.now()) {
  const memory = emptyMemory();
  const lastAttemptAt = time(raw?.lastAttemptAt);
  memory.lastAttemptAt = lastAttemptAt === undefined ? null : Math.min(lastAttemptAt, now);
  const key = typeof raw?.key === 'string' && HEX32.test(raw.key) ? raw.key : '';
  memory.salt = typeof raw?.salt === 'string' && HEX32.test(raw.salt) ? raw.salt : '';
  memory.owner = ownerOf(raw?.owner);
  if (raw?.indexes && typeof raw.indexes === 'object' && !Array.isArray(raw.indexes)) {
    // The counters c0..c29 only: nothing else becomes a key.
    for (const [code, value] of Object.entries(raw.indexes)) {
      if (!/^c(?:[12]?\d)$/.test(code) || Number(code.slice(1)) > 29) continue;
      const index = indexOf(value);
      if (index) memory.indexes[code] = index;
    }
  }
  if (!key) {
    return memory;
  }
  memory.key = key;
  const p = raw?.pause;
  if (p && typeof p === 'object' && time(p.until)) {
    memory.pause = {
      until: Math.min(p.until, now + TIMINGS.pauseMax),
      failures: Number.isInteger(p.failures) && p.failures >= 0 ? Math.min(p.failures, 10) : 0,
      code: ['busy', 'duplicate'].includes(p.code) ? p.code : 'failed',
    };
    // The earlier slot holding the same ED3 (a pause of a duplicate slot).
    if (memory.pause.code === 'duplicate') {
      if ([1, 2].includes(p.of)) memory.pause.of = p.of;
      else memory.pause.code = 'failed';
    }
  }
  const r = raw?.refused;
  if (
    r &&
    typeof r.salt === 'string' &&
    HEX32.test(r.salt) &&
    Number.isInteger(r.tag) &&
    r.tag >= 0 &&
    r.tag < 256
  ) {
    memory.refused = { salt: r.salt, tag: r.tag };
  }
  if (Array.isArray(raw?.guards)) {
    const seen = new Set();
    for (const entry of raw.guards.slice(0, LIMITS.guards)) {
      const guard = guardOf(entry);
      if (guard && !seen.has(guard.code)) {
        seen.add(guard.code);
        memory.guards.push(guard);
      }
    }
  }
  return memory;
}
