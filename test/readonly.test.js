// -----------------------------------------------------------------------------
// Relays read only by default (the lesson of the first real IPX800 V5, the
// same rules here): the status says so and says what to do (list them, then
// "Update" in Discovery); the X-8R outputs stay read only in this version;
// the X-THL fault.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from '../src/i18n.js';
import { fakeEd3 } from './helpers/fakeEd3.js';
import { CONFIG, F, SECOND, created, settle, setup } from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const discovered = (gladys, code) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === `ext:ed3:relay:${code}`);

// --- Read only, said in the status --------------------------------------------------

test('no relay listed: the status counts the ED3 relays read only and says where to list them', async () => {
  const { app, gladys, start } = await setup();
  await start();
  assert.match(
    message(gladys),
    /2 relays read only: list in Configuration → Relays Gladys may drive those Gladys must drive \(R1, R2; never a pump, a ventilation, a door strike…\)\./,
  );
  assert.match(
    message(gladys, 'fr'),
    /2 relais en lecture seule : listez dans Configuration → Relais pilotables par Gladys ceux que Gladys doit piloter \(R1, R2 ; jamais une pompe, une VMC, une gâche…\)\./,
  );
  const relay = discovered(gladys, 'r1');
  assert.deepEqual(
    relay.features.map((f) => [f.external_id, f.read_only]),
    [[F('relay', 'r1', 'readonly'), true]],
  );
  assert.equal(relay.features[0].name, 'État (lecture seule)');
  // An X-8R output: read only, with no switch even when the user tries to list it.
  assert.equal(discovered(gladys, 'x8r4259840-1').features[0].read_only, true);
  app.stop();
});

test('one relay listed: no "read only" hint any more (the others stay read only, silently)', async () => {
  const { app, gladys, start } = await setup({ config: { ...CONFIG, relays: 'R1' } });
  await start();
  assert.doesNotMatch(message(gladys), /read only/);
  assert.doesNotMatch(message(gladys, 'fr'), /lecture seule/);
  assert.equal(discovered(gladys, 'r2').features[0].read_only, true);
  assert.equal(discovered(gladys, 'r1').features[0].read_only, false);
  app.stop();
});

test('an X-8R output or R3 listed is not understood, said in the status; nothing drivable', async () => {
  const { app, gladys, start } = await setup({
    config: { ...CONFIG, relays: 'X8R4259840-1, R3' },
  });
  await start();
  assert.match(message(gladys), /2 relays read only/);
  assert.match(message(gladys), /Relays not understood \(R1 and R2 only\): X8R4259840-1, R3\./);
  assert.equal(discovered(gladys, 'x8r4259840-1').features[0].read_only, true);
  app.stop();
});

// --- Listed, waiting for "Update" in Discovery -----------------------------------------

test('relays listed after their creation: the status names those waiting for "Update", until it is done', async () => {
  const devices = [created('relay', 'r1'), created('relay', 'r2')];
  const { app, gladys, start, wait } = await setup({ devices });
  await start();
  assert.match(message(gladys), /2 relays read only/);
  assert.doesNotMatch(message(gladys), /Update/);
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1, R2:light' });
  await wait(SECOND);
  assert.doesNotMatch(message(gladys), /read only/);
  assert.match(
    message(gladys),
    /Relays listed, waiting for "Update" in Discover to be driven: R1, R2\./,
  );
  assert.match(
    message(gladys, 'fr'),
    /Relais listés, en attente de « Mettre à jour » dans Découverte pour être pilotés : R1, R2\./,
  );
  // Discovery offers the new feature next to the old one (kept).
  assert.deepEqual(
    discovered(gladys, 'r1')
      .features.map((f) => f.external_id)
      .sort(),
    [F('relay', 'r1', 'readonly'), F('relay', 'r1', 'switch')],
  );
  await gladys.fake.deviceUpdated(discovered(gladys, 'r1'));
  assert.match(message(gladys), /waiting for "Update" in Discover to be driven: R2\./);
  await gladys.fake.deviceUpdated(discovered(gladys, 'r2'));
  assert.doesNotMatch(message(gladys), /Update/);
  // Deleting a relay device takes it out of the reckoning as well.
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1' });
  await wait(SECOND);
  app.stop();
});

test('one relay read only: said in the singular, still with the caution', () => {
  const one = T.relaysReadOnly(1);
  assert.match(
    one.en,
    /^1 relay read only: list it in .* only if Gladys must drive it \(never a pump/,
  );
  assert.match(
    one.fr,
    /^1 relais en lecture seule : listez-le dans .* seulement si Gladys doit le piloter \(jamais une pompe/,
  );
});

test('a relay listed after its creation and updated: its feature names stay right in both states', async () => {
  const before = created('relay', 'r1');
  const { app, gladys, start, wait } = await setup({ devices: [before] });
  await start();
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1' });
  await wait(SECOND);
  await gladys.fake.deviceUpdated(discovered(gladys, 'r1'));
  const r1 = gladys.devices.find((d) => d.external_id === 'ext:ed3:relay:r1');
  const names = r1.features.map((f) => `${f.name} ${f.read_only ? 'ro' : 'rw'}`).sort();
  assert.deepEqual(names, ['Interrupteur rw', 'État (lecture seule) ro']);
  assert.doesNotMatch(message(gladys), /read only|Update/);
  app.stop();
});

test('a relay updated in Discovery is drivable: its switch works', async () => {
  const before = created('relay', 'r1');
  const { app, gladys, start, wait, cmd, world } = await setup({ devices: [before] });
  await start();
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1' });
  await wait(SECOND);
  const updated = discovered(gladys, 'r1');
  await gladys.fake.deviceUpdated(updated);
  const ack = await cmd(updated, F('relay', 'r1', 'switch'), 1);
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.equal(world.relays[0], true);
  app.stop();
});

test('the status is not rewritten by a device event during a failure', async () => {
  const devices = [created('relay', 'r1')];
  const world = fakeEd3();
  const { app, gladys, start, wait } = await setup({
    world,
    config: { ...CONFIG, relays: 'R1' },
    devices,
  });
  await start();
  assert.match(message(gladys), /waiting for "Update"/);
  world.failReads = 500;
  await wait(10 * SECOND);
  assert.match(message(gladys), /could not be read/);
  await gladys.fake.deviceUpdated({ ...devices[0] });
  assert.match(message(gladys), /could not be read/);
  app.stop();
});

test('X-THL in fault end to end: nothing published, the status names it, back once it clears', async () => {
  const world = fakeEd3();
  world.xthl[0].ioFault = true;
  const { app, gladys, start, wait } = await setup({
    world,
    devices: [created('thl', 'xthl4325376')],
  });
  await start();
  await app.flush();
  assert.equal(gladys.fake.lastState(F('thl', 'xthl4325376', 'temperature')), undefined);
  assert.match(
    message(gladys),
    /X-THL reporting a measurement fault, values not published: XTHL4325376\./,
  );
  world.xthl[0].ioFault = false;
  await wait(10 * SECOND);
  await app.flush();
  assert.equal(gladys.fake.lastState(F('thl', 'xthl4325376', 'temperature')), 21.5);
  assert.doesNotMatch(message(gladys), /fault/);
  // Not read this round: no longer said in fault (nothing known).
  world.xthl[0].ioFault = true;
  await wait(10 * SECOND);
  assert.match(message(gladys), /measurement fault/);
  world.failPaths.set('ebx/xthl', 500);
  await wait(10 * SECOND);
  assert.match(message(gladys), /Not read this time.*X-THL/);
  assert.doesNotMatch(message(gladys), /fault/, 'a fault not read is not shown');
  app.stop();
});

test('a device event before the first read never shows "Connected"', async () => {
  const world = fakeEd3();
  world.latency = 4000;
  const device = created('relay', 'r1');
  const { app, gladys, act, wait } = await setup({
    world,
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
  });
  const starting = app.connected({ ...CONFIG, relays: 'R1' });
  await settle();
  assert.doesNotMatch(message(gladys), /Connected/);
  await gladys.fake.deviceUpdated(device);
  await gladys.fake.deviceDeleted(device);
  assert.doesNotMatch(message(gladys), /Connected/, 'nothing read yet');
  world.latency = 20;
  await act(starting);
  await wait(30 * SECOND);
  await gladys.fake.deviceUpdated(device);
  assert.match(message(gladys), /Connected/, 'once read, the status is redone');
  app.stop();
});
