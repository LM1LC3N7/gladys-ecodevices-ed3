import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  normalizeConfig,
  parseAddress,
  parseApiKey,
  parseRelays,
  sessionKey,
  slotConfig,
  slotTyped,
} from '../src/config.js';

test('addresses: IP, name, port; a pasted URL with the key, https, broadcast refused', () => {
  assert.deepEqual(parseAddress('192.168.1.60'), { host: '192.168.1.60', port: 80 });
  assert.deepEqual(parseAddress('http://ed3.lan:8080/'), { host: 'ed3.lan', port: 8080 });
  assert.deepEqual(parseAddress('http://192.168.1.60/api/object/ed3/0?ApiKey=abc'), {
    error: 'path',
  });
  assert.deepEqual(parseAddress('https://192.168.1.60'), { error: 'https' });
  assert.deepEqual(parseAddress('255.255.255.255'), { error: 'invalid' });
  assert.deepEqual(parseAddress('224.0.0.1'), { error: 'invalid' });
  assert.deepEqual(parseAddress('0.0.0.0'), { error: 'invalid' });
  assert.deepEqual(parseAddress('a\r\nb'), { error: 'path' });
  assert.deepEqual(parseAddress(''), {});
});

test('API key: printable, no space, no control character', () => {
  assert.equal(parseApiKey(' abc-123 '), 'abc-123');
  assert.equal(parseApiKey(''), '');
  assert.equal(parseApiKey(undefined), '');
  assert.equal(parseApiKey('ab\r\nX-Evil: 1'), null);
  assert.equal(parseApiKey('a b'), null);
  assert.equal(parseApiKey('x'.repeat(129)), null);
});

test('relays Gladys may drive: R1 and R2 only; kinds switch or light; errors reported', () => {
  const { relays, errors } = parseRelays('R1, 2:light; R3\nX8R4259840-1, R2:pump, r0');
  assert.deepEqual(
    [...relays],
    [
      ['r1', 'switch'],
      ['r2', 'light'],
    ],
  );
  assert.deepEqual(errors, ['R3', 'X8R4259840-1', 'R2:pump', 'r0']);
});

test('defaults: 15 s (10 s at least); a session is the address, port and key', () => {
  const config = normalizeConfig({});
  assert.equal(config.pollInterval, DEFAULTS.poll_interval);
  assert.equal(config.pollInterval, 15);
  assert.equal(normalizeConfig({ poll_interval: 1 }).pollInterval, 10);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollInterval, 15);
  assert.equal(normalizeConfig({ poll_interval: 999 }).pollInterval, 300);
  const a = normalizeConfig({ host: '10.0.0.2', api_key: 'k1' });
  const b = normalizeConfig({ host: '10.0.0.2', api_key: 'k1', relays: 'R1' });
  const c = normalizeConfig({ host: '10.0.0.2', api_key: 'k2' });
  const d = normalizeConfig({ host: '10.0.0.2:8080', api_key: 'k1' });
  assert.equal(sessionKey(a), sessionKey(b));
  assert.notEqual(sessionKey(a), sessionKey(c));
  assert.notEqual(sessionKey(a), sessionKey(d));
  assert.equal(d.port, 8080);
  assert.notEqual(a.key, d.key, 'the port is part of the identity by address');
  assert.ok(!a.key.includes('k1'));
  assert.ok(!JSON.stringify([...Object.values(a)]).includes('k1') || a.apiKey === 'k1');
});

test('slots: the n-th ED3 has its own keys, the options are shared', () => {
  const raw = { host: 'a', host_2: 'b', api_key_2: 'k2', relays_2: 'R1', poll_interval: 30 };
  assert.deepEqual(slotConfig(raw, 2), {
    host: 'b',
    api_key: 'k2',
    relays: 'R1',
    poll_interval: 30,
    language: undefined,
  });
  assert.equal(slotTyped(raw, 2), true);
  assert.equal(slotTyped(raw, 3), false);
  assert.equal(slotTyped({ api_key_3: ' x ' }, 3), true);
});
