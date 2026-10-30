// -----------------------------------------------------------------------------
// What the answers of the ED3 mean, on the examples of the GCE Postman
// documentation (API ED3) and of cce66's Api-Deck: strict numbers, units
// converted, bounded lists, nothing of the answer as an object key.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTER_KINDS, KINDS, counterKind } from '../src/constants.js';
import {
  counterNumber,
  indexValue,
  parseCounterNames,
  parseCounters,
  parseEd3,
  parseEd3States,
  parseMac,
  parseX8r,
  parseXthl,
} from '../src/ed3/model.js';

/** `GET /api/object/ed3/0` as GCE documents it (Postman "Get ED3"). */
const GCE_ED3 = {
  _id: 1245184,
  name: 'ED3',
  errorStatus: '0x0000',
  ID_Logger_tore: [851979, 851980, 851981, 851984, 0, 0, 0, 0],
  ConsoTore: [20, 20, 20, 50, 20, 20, 20, 50],
  ToreName: ['Tore 1', 'Tore 2', 'Tore 3', 'Tore 4', 'Tore 5', 'Tore 6', 'Tore 7', 'Tore 8'],
  ID_Logger_pulse: [0, 0, 0, 0],
  RelayName: ['Relay 1', 'Relay 2'],
  RelayMemoryMode: true,
  Relay_state: [false, true],
  Relay_command: [false, true],
  irms: [432, 0, 236, 0, 0, 0, 0, 0],
  puissance: [56511, 0, 2279, 0, 0, 0, 0, 0],
  urms: 236.35,
};

test('ED3: relays, the clamps linked to a counter (mW -> W), the mains voltage', () => {
  const { targets } = parseEd3(GCE_ED3);
  assert.equal(targets.get('r1').value, 0);
  assert.equal(targets.get('r2').value, 1);
  assert.equal(targets.get('r1').name, 'Relay 1');
  assert.deepEqual(
    [...targets.keys()].filter((c) => c.startsWith('t')),
    ['t1', 't2', 't3', 't4'],
  );
  // 56511 mW = 56.5 W: 432 mA at 236 V with a power factor of 0.55 (the GCE example).
  assert.equal(targets.get('t1').value, 56.5);
  assert.equal(targets.get('t3').value, 2.3);
  assert.equal(targets.get('t2').value, 0);
  assert.equal(targets.get('mains').value, 236.4);
});

test('ED3: not an ED3 without Relay_state; strict values (a text, null, 0 V are no measures)', () => {
  assert.deepEqual(parseEd3([]), { error: 'bad_response' });
  assert.deepEqual(parseEd3({ status: 'Success' }), { error: 'bad_response' });
  assert.deepEqual(parseEd3({ Relay_state: [true] }), { error: 'bad_response' });
  const { targets } = parseEd3({
    Relay_state: ['1', null],
    ID_Logger_tore: [851979, '851980', -1, 2e9],
    puissance: ['56511', 1e12],
    urms: 0,
    RelayName: ['\u0000\u0007', 'x'.repeat(200)],
  });
  assert.equal(targets.get('r1').value, undefined);
  assert.equal(targets.get('r2').value, undefined);
  assert.equal(targets.get('r1').name, undefined);
  assert.equal(targets.get('r2').name.length, 60);
  assert.deepEqual(
    [...targets.keys()].filter((c) => c.startsWith('t')),
    ['t1'],
  );
  assert.equal(targets.get('t1').value, undefined);
  assert.ok(!targets.has('mains'), '0 V is no measurement');
  assert.deepEqual(
    [...parseEd3States({ Relay_state: [true, false] }).values],
    [
      ['r1', 1],
      ['r2', 0],
    ],
  );
  assert.deepEqual(parseEd3States({}), { error: 'bad_response' });
});

test('counters: _id 851968 + n, kind by number, Wh -> kWh, mL -> m³, 0 is no index', () => {
  assert.equal(counterNumber(851968), 0);
  assert.equal(counterNumber(851997), 29);
  assert.equal(counterNumber(851998), undefined);
  assert.equal(counterNumber('851968'), undefined);
  assert.deepEqual([0, 1, 10, 11, 18, 19, 20, 21, 22, 24, 25, 27, 28, 29, 30].map(counterKind), [
    COUNTER_KINDS.TIC_TOTAL,
    COUNTER_KINDS.TIC_TARIFF,
    COUNTER_KINDS.TIC_TARIFF,
    COUNTER_KINDS.CONSUMPTION,
    COUNTER_KINDS.CONSUMPTION,
    COUNTER_KINDS.INJECTION,
    COUNTER_KINDS.PRODUCTION,
    COUNTER_KINDS.PRODUCTION,
    COUNTER_KINDS.STORAGE,
    COUNTER_KINDS.STORAGE,
    COUNTER_KINDS.WATER,
    COUNTER_KINDS.WATER,
    COUNTER_KINDS.GAS,
    COUNTER_KINDS.GAS,
    undefined,
  ]);
  assert.equal(indexValue(22534, COUNTER_KINDS.TIC_TOTAL), 22.534);
  assert.equal(indexValue(123_456_789, COUNTER_KINDS.WATER), 123.457);
  assert.equal(indexValue(1_500_000, COUNTER_KINDS.GAS), 1.5);
  for (const bad of [0, -5, 1.5, '22534', null, undefined, NaN, 499]) {
    assert.equal(indexValue(bad, COUNTER_KINDS.WATER), undefined, String(bad));
  }
  // The GCE example of `core_logger?option=filter_state` (shortened), and a counter twice.
  const names = parseCounterNames([
    { _id: 851968, name: 'TIC' },
    { _id: 851979, name: 'Cuisine' },
    { _id: 1, name: 'nope' },
  ]);
  assert.deepEqual(
    [...names],
    [
      [0, 'TIC'],
      [11, 'Cuisine'],
    ],
  );
  const { targets } = parseCounters(
    [
      { _id: 851968, index: 22534, indexprix: 6206, moyenne: 95, tarif: 0 },
      { _id: 851979, index: 407230100, indexprix: 12714166 },
      { _id: 851981, index: 0 },
      { _id: 851968, index: 1 },
      { _id: 42, index: 5 },
      JSON.parse('{"__proto__": {"index": 5}, "_id": 851993, "index": 2000000}'),
    ],
    names,
  );
  assert.deepEqual([...targets.keys()], ['c0', 'c11', 'c13', 'c25']);
  assert.equal(targets.get('c0').value, 22.534);
  assert.equal(targets.get('c0').name, 'TIC');
  assert.equal(targets.get('c0').kind, KINDS.COUNTER);
  assert.equal(targets.get('c11').value, 407230.1);
  assert.equal(targets.get('c13').value, undefined);
  assert.equal(targets.get('c13').idle, true);
  assert.equal(targets.get('c25').value, 2);
  assert.equal(targets.get('c25').counter, COUNTER_KINDS.WATER);
  assert.deepEqual(parseCounters({}), { error: 'bad_response' });
  assert.equal({}.index, undefined);
});

test('X-8R: 8 read-only outputs per paired extension (by its _id); X-THL with its fault', () => {
  // The GCE example of `ebx/x8r`.
  const x8r = parseX8r([
    {
      _id: 4259840,
      name: 'X8R N°0',
      codeExt: '20ab1211',
      bConnect: true,
      state: [false, true, false, false, false, false, false, false],
      command: [true, false, false, false, false, false, false, false],
    },
    { _id: 4259841, name: 'X8R N°1', codeExt: '0', state: Array(8).fill(true) },
  ]).targets;
  assert.equal(x8r.size, 8);
  assert.equal(x8r.get('x8r4259840-1').value, 0, 'the state, not the command');
  assert.equal(x8r.get('x8r4259840-2').value, 1);
  assert.equal(x8r.get('x8r4259840-2').extName, 'X8R N°0');
  assert.deepEqual(parseX8r({}), { error: 'bad_response' });
  // The GCE example of `ebx/xthl` has codeExt "0": an object created, nothing paired.
  assert.equal(
    parseXthl([{ _id: 4325376, codeExt: '0', Temperature: 0, Humidite: 0, Luminosite: 0 }]).targets
      .size,
    0,
  );
  const xthl = parseXthl([
    { _id: 1, codeExt: 'ab12', name: 'Salon', Temperature: 21.5, Humidite: 45, Luminosite: '300' },
    { _id: 2, codeExt: 'ab13', Temperature: 99, Humidite: 45, Luminosite: 3, ioFault: true },
    { _id: 3, codeExt: 'ab14', Temperature: 200, Humidite: -1 },
  ]).targets;
  assert.deepEqual(xthl.get('xthl1').value, {
    temperature: 21.5,
    humidity: 45,
    luminosity: undefined,
  });
  assert.equal(xthl.get('xthl2').value, undefined);
  assert.equal(xthl.get('xthl2').fault, true);
  assert.equal(xthl.get('xthl3').value, undefined, 'out of range everywhere: no value');
});

test('parseMac: the MAC of system/info, normalized; anything else is unreadable, never another ED3', () => {
  assert.equal(parseMac({ macAdress: '00:04:A3:12:34:56' }), '00:04:a3:12:34:56');
  assert.equal(parseMac({ macAddress: '00-04-a3-12-34-56' }), '00:04:a3:12:34:56');
  assert.equal(parseMac({ mac: '0004a3123456' }), '00:04:a3:12:34:56');
  for (const bad of [
    {},
    null,
    [],
    { macAdress: '' },
    { macAdress: '00:00:00:00:00:00' },
    { macAdress: 'ff:ff:ff:ff:ff:ff' },
    { macAdress: '00:04:a3:12:34' },
    { macAdress: 42 },
    { macAdress: '00:04:a3:12:34:5g' },
    JSON.parse('{"__proto__": {"macAdress": "00:04:a3:12:34:56"}}'),
  ]) {
    assert.equal(parseMac(bad), undefined, JSON.stringify(bad));
  }
});
