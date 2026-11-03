// -----------------------------------------------------------------------------
// 0.2.0 review r1 (I-1, I-2): One ED3, one slot, also when a round is overtaken
// by a read back (m-18). The reviewer's scenarios s1, s2 and s3: the same ED3
// in two slots after a configuration change or a restart; the first round of
// slot 1 (I-1: its MAC must still reach the hub) or of slot 2 (I-2: the
// duplicate check of mayApplyOvertaken) overtaken by a read back. Slot 2 never
// offers nor publishes anything of that ED3 (its energy would count twice).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIORITY } from '../src/ed3/client.js';
import { KEY, fakeEd3 } from './helpers/fakeEd3.js';
import { CONFIG, SECOND, START } from './helpers/app.js';
import { hubOf } from './helpers/hub.js';

const R1 = { ...CONFIG, relays: 'R1' };
const slots = (h1, h2) => ({ ...R1, host: h1, host_2: h2, api_key_2: KEY, relays_2: 'R1' });
const C0 = 'ext:ed3:ed32:counter:c0:index';
/** Full `object/ed3/0` reads of a fake ED3 since the request `from`. */
const roundsOf = (box, from) =>
  box.requests.slice(from).filter((r) => /^\/api\/object\/ed3\/0\?ApiKey=/.test(r.path)).length;
const slow = (box) => ({ transport: (o, h) => box.sleep(1500).then(() => box.transport(o, h)) });

for (const overtaken of [false, true]) {
  test(`s1: the same ED3 in two slots after a change, slot 1 first round ${overtaken ? 'overtaken' : 'plain'}: slot 2 never offered`, async (t) => {
    const a = fakeEd3({ mac: '00:04:a3:5e:00:21' });
    const b = fakeEd3({ mac: '00:04:a3:5e:00:22' });
    const slowA = slow(a);
    const boxOf = (host) => (host === 'b.lan' ? b : host === 'a2.lan' ? slowA : a);
    const { hub, gladys, wait, ids, clock } = await hubOf(slots('a.lan', 'b.lan'), boxOf);
    t.after(() => hub.stop());
    a.clock = clock;
    b.clock = clock;
    hub.onConnected(() => gladys.getConfig());
    await wait(30 * SECOND);
    assert.ok(ids().some((id) => id.includes(':ed32:')));
    const from = a.requests.length;
    const saving = hub.configUpdated(slots('a2.lan', 'a.lan'));
    const seen = new Set();
    let sent = false;
    const one = hub.controllers.get(1);
    for (let i = 0; i < 300; i += 1) {
      await wait(100);
      if (overtaken && !sent && roundsOf(a, from) > 0) {
        sent = true;
        one.readBack(PRIORITY.CONFIRM, clock.monotonic() + 10 * SECOND).catch(() => {});
      }
      for (const id of ids()) seen.add(id);
    }
    await saving;
    assert.equal(sent, overtaken);
    assert.deepEqual(
      [...seen].filter((id) => id.includes(':ed32:')),
      [],
      'slot 2 never offered',
    );
  });
}

/**
 * Slot 2 owns ED3 A (c0 created); slot 1 is then set to A too; a restart 3 days later, A's
 * index 30 kWh higher. `slot`: whose first round is overtaken by a read back (none: plain).
 */
async function restartedDuplicate(t, slot) {
  const a = fakeEd3({ mac: '00:04:a3:5e:00:21' });
  const c = fakeEd3({ mac: '00:04:a3:5e:00:23' });
  // s2: slot 1 (a2.lan) slow; s3: slot 2 (a.lan) slow, so its first round can be overtaken.
  const fast = { transport: (o, h) => a.transport(o, h) };
  const boxOf =
    slot === 2
      ? (host) => (host === 'c.lan' ? c : host === 'a2.lan' ? fast : slow(a))
      : (host) => (host === 'c.lan' ? c : host === 'a2.lan' ? slow(a) : a);
  const run1 = await hubOf(slots('c.lan', 'a.lan'), boxOf);
  a.clock = run1.clock;
  c.clock = run1.clock;
  await run1.hub.onConnected(() => run1.gladys.getConfig());
  await run1.wait(30 * SECOND);
  const d = run1.gladys.fake.discoveredDevices.find(
    (x) => x.external_id === 'ext:ed3:ed32:counter:c0',
  );
  assert.ok(d, 'slot 2 offers A c0');
  await run1.gladys.fake.deviceCreated({ id: 'dev-ed32-c0', ...d });
  await run1.wait(30 * SECOND);
  await run1.hub.configUpdated(slots('a2.lan', 'a.lan'));
  await run1.wait(60 * SECOND);
  await run1.hub.shutdown();
  const run2 = await hubOf(slots('a2.lan', 'a.lan'), boxOf, run1.stores, {
    devices: run1.gladys.devices,
    start: START + run1.clock.elapsed + 3 * 24 * 3600 * SECOND,
  });
  t.after(() => run2.hub.stop());
  a.clock = run2.clock;
  c.clock = run2.clock;
  a.index.set(0, a.index.get(0) + 30_000);
  const from = a.requests.length;
  run2.hub.onConnected(() => run2.gladys.getConfig());
  const app = slot ? run2.hub.controllers.get(slot) : undefined;
  // Slot 2's first round is the second `object/ed3/0` read of A (slot 1 reads first).
  const after = slot === 2 ? 2 : 1;
  let sent = false;
  for (let i = 0; i < 300; i += 1) {
    await run2.wait(100);
    if (app && !sent && roundsOf(a, from) >= after) {
      sent = true;
      app.readBack(PRIORITY.CONFIRM, run2.clock.monotonic() + 10 * SECOND).catch(() => {});
    }
  }
  assert.equal(sent, Boolean(slot));
  return run2.gladys.fake.states.filter((s) => s.device_feature_external_id === C0);
}

for (const slot of [undefined, 1]) {
  test(`s2 (I-1): slot 2's ED3 also in slot 1, restart, slot 1 first round ${slot ? 'overtaken' : 'plain'}: slot 2 publishes nothing`, async (t) => {
    assert.deepEqual(await restartedDuplicate(t, slot), []);
  });
}

test('s3 (I-2): the same, slot 2 first round overtaken: slot 2 publishes nothing', async (t) => {
  assert.deepEqual(await restartedDuplicate(t, 2), []);
});
