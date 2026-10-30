import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore, normalizeMemory, stateFile } from '../src/store.js';

test('fileStore: atomic 0600 write, missing = null, unreadable throws', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ed3-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  const store = fileStore(path);
  assert.equal(await store.load(), null);
  await Promise.all([store.save({ a: 1 }), store.save({ a: 2 })]);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { a: 2 });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await writeFile(path, '{not json');
  await assert.rejects(store.load());
  await writeFile(path, `"${'x'.repeat(300 * 1024)}"`);
  await assert.rejects(store.load(), /too large/);
});

test('one file per slot', () => {
  assert.equal(stateFile(1), '/data/ed3-state.json');
  assert.equal(stateFile(3), '/data/ed3-state-3.json');
});

test('normalizeMemory: bounded, dates brought to now, guards checked, another key starts empty', () => {
  const now = Date.UTC(2026, 9, 30);
  const memory = normalizeMemory(
    {
      format: 1,
      lastAttemptAt: now + 3600_000,
      key: 'a'.repeat(32),
      pause: { until: now + 100 * 3600_000, failures: 99, code: 'busy' },
      refused: { salt: 'b'.repeat(32), tag: 300 },
      guards: [
        { code: 'r1', kind: 'relay', value: 0, resends: 2, confirmed: false },
        { code: 'r1', kind: 'relay', value: 0 },
        { code: '__proto__', kind: 'relay', value: 0 },
        { code: 'r2', kind: 'relay', value: 1 },
        { code: 'r3', kind: 'relay', value: 0 },
        { code: 'x8r4259840-1', kind: 'relay', value: 0 },
      ],
    },
    now,
  );
  assert.equal(memory.lastAttemptAt, now);
  assert.equal(memory.pause.until, now + 3600_000);
  assert.equal(memory.pause.failures, 10);
  assert.equal(memory.refused, null);
  assert.deepEqual(
    memory.guards.map((g) => g.code),
    ['r1'],
  );
  assert.equal(memory.guards[0].resends, 2);
  assert.deepEqual(normalizeMemory({ key: 'nope', guards: [{ code: 'r1' }] }).guards, []);
});

test('normalizeMemory: the owner, checked; it survives another controller key', () => {
  const key = 'c'.repeat(32);
  assert.equal(normalizeMemory({ key, guards: [] }).owner, null);
  assert.equal(normalizeMemory(null).owner, null, 'a fresh install');
  const owner = { kind: 'mac', id: 'd'.repeat(32), at: key };
  assert.deepEqual(normalizeMemory({ format: 1, key, owner, salt: 'e'.repeat(32) }).owner, owner);
  assert.equal(normalizeMemory({ format: 1, key, salt: 'e'.repeat(32) }).salt, 'e'.repeat(32));
  for (const bad of [
    { kind: 'serial', id: 'd'.repeat(32) },
    { kind: 'mac', id: '00:04:a3:00:00:01' },
    { kind: 'mac' },
    'mac',
  ]) {
    assert.equal(normalizeMemory({ format: 1, key, owner: bad }).owner, null, JSON.stringify(bad));
  }
  assert.equal(normalizeMemory({ format: 1, key, salt: 'nope' }).salt, '');
  assert.deepEqual(normalizeMemory({ format: 1, key: 'f'.repeat(32), owner }).owner, owner);
});

test('normalizeMemory: counter indexes c0-c29 only, values checked, no prototype key', () => {
  const at = Date.UTC(2026, 9, 30);
  const memory = normalizeMemory({
    indexes: JSON.parse(
      JSON.stringify({
        c0: { device: 'dev-1', last: { value: 12.5, at }, held: null },
        c29: {
          device: 'dev-2',
          last: { value: 1, at },
          held: { direction: 'up', from: 1, to: 9, threshold: 9, at },
        },
        c30: { device: 'x', last: { value: 1, at } },
        c11: { device: 'a\nb', last: { value: 'nope', at }, held: { direction: 'sideways' } },
        x: {},
      }).replace('"x":{}', '"__proto__":{"polluted":true}'),
    ),
  });
  assert.deepEqual(Object.keys(memory.indexes).sort(), ['c0', 'c11', 'c29']);
  assert.deepEqual(memory.indexes.c0, { device: 'dev-1', last: { value: 12.5, at }, held: null });
  assert.equal(memory.indexes.c29.held.to, 9);
  assert.deepEqual(memory.indexes.c11, { device: null, last: null, held: null });
  assert.equal({}.polluted, undefined);
  // The indexes belong to the devices: kept without a controller key.
  assert.ok(memory.indexes.c0);
});
