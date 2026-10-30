// -----------------------------------------------------------------------------
// The ED3 client and its HTTP layer against a real local HTTP server (the shared
// kit): the key in the query only, never in an error; bounded answers; a
// protective request cuts a slow read and opens its connection once the
// read's is closed; one request at a time.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { Ed3Client, PRIORITY } from '../src/ed3/client.js';
import { Ed3Error, errorReason } from '../src/ed3/http.js';
import { httpServer, reply } from './kit/index.mjs';

const KEY = 'K3y-Secret';

const client = (port) => new Ed3Client({ host: '127.0.0.1', port, apiKey: KEY });

test('reads: the key in the query (ApiKey), JSON asked; a relay by GET SetOnR / SetOffR', async (t) => {
  const srv = await httpServer({
    routes: {
      'GET /api/object/ed3/0': { Relay_state: [true, false] },
      'GET /api/object/core_logger': (r) => [{ _id: 851968, option: r.query.option }],
      'GET /api/object/ed3/0/SetOnR/2': { status: 'Success' },
      'GET /api/object/ed3/0/SetOffR/1': { status: 'Success' },
    },
  });
  t.after(() => srv.close());
  const c = client(srv.port);
  assert.deepEqual((await c.ed3()).Relay_state, [true, false]);
  assert.equal(srv.requests[0].query.ApiKey, KEY);
  assert.match(srv.requests[0].headers.accept, /application\/json/);
  assert.equal((await c.counters())[0].option, 'filter_state');
  assert.equal((await c.counterNames())[0].option, 'filter_name');
  await c.relay(2, true, PRIORITY.COMMAND);
  await c.relay(1, false, PRIORITY.PROTECTIVE);
  assert.deepEqual(
    srv.requests.slice(-2).map((r) => r.path),
    ['/api/object/ed3/0/SetOnR/2', '/api/object/ed3/0/SetOffR/1'],
  );
  for (const [n, on] of [
    [3, true],
    [0, false],
    [1.5, true],
    [1, 'yes'],
  ]) {
    await assert.rejects(c.relay(n, on, PRIORITY.COMMAND), { code: 'bad_request' });
  }
  await assert.rejects(() => c.extensions('../x', PRIORITY.READ), { code: 'bad_request' });
  assert.equal(srv.requests.length, 5, 'an invalid write never leaves');
});

test('statuses: 401 refused, 503 busy, 500 http, a text not JSON; the key and address never in a message', async (t) => {
  const srv = await httpServer({
    routes: {
      '/api/object/ed3/0': reply(401, { error: 'unauthorized' }),
      '/api/object/core_logger': reply(500, 'oops'),
      '/api/system/info': 'not json at all',
    },
  });
  t.after(() => srv.close());
  const c = client(srv.port);
  const errors = [];
  for (const call of [() => c.ed3(), () => c.counters(), () => c.info()]) {
    errors.push(await call().catch((err) => err));
  }
  srv.status5xx = 1;
  errors.push(await c.ed3().catch((err) => err));
  assert.deepEqual(
    errors.map((e) => e.code),
    ['refused', 'http', 'bad_response', 'busy'],
  );
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  errors.push(
    await client(port)
      .ed3()
      .catch((err) => err),
  );
  assert.equal(errors.at(-1).code, 'network');
  assert.equal(errors.at(-1).sent, false);
  for (const err of errors) {
    const text = `${err.message} ${errorReason(err)} ${err.stack}`;
    assert.ok(!text.includes(KEY), text);
    assert.ok(!text.includes('127.0.0.1'), text);
  }
});

test('an answer over the limit is cut before it is read whole', async (t) => {
  const srv = await httpServer({
    routes: { '/api/object/core_logger': [] },
    bigBody: 400_000,
  });
  t.after(() => srv.close());
  await assert.rejects(client(srv.port).counters(), { code: 'size' });
});

test('a silent ED3: timeout at the deadline, "sent"', async (t) => {
  const srv = await httpServer({ routes: { '/api/object/ed3/0': 'silent' } });
  t.after(() => srv.close());
  const c = client(srv.port);
  const started = performance.now();
  const err = await c.ed3(PRIORITY.READ, { deadline: performance.now() + 300 }).catch((e) => e);
  assert.equal(err.code, 'timeout');
  assert.equal(err.sent, true);
  assert.ok(performance.now() - started < 1500);
});

test('a protective request cuts a slow read, after its connection is closed; one request at a time', async (t) => {
  let open = 0;
  let peak = 0;
  const srv = await httpServer({
    latencyMs: (r) => (r.path === '/api/object/core_logger' ? 5000 : 10),
    routes: {
      '/api/object/core_logger': [],
      '/api/object/ed3/0/SetOffR/1': { status: 'Success' },
    },
  });
  t.after(() => srv.close());
  const c = new Ed3Client({
    host: '127.0.0.1',
    port: srv.port,
    apiKey: KEY,
    // Counts the requests open at once, from the client side (open -> settled).
    transport: async (options, hooks) => {
      const { request } = await import('../src/ed3/http.js');
      open += 1;
      peak = Math.max(peak, open);
      try {
        return await request(options, hooks);
      } finally {
        open -= 1;
      }
    },
  });
  const read = c.counters(PRIORITY.READ, { deadline: performance.now() + 10_000 }).catch((e) => e);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const started = performance.now();
  await c.relay(1, false, PRIORITY.PROTECTIVE);
  const took = performance.now() - started;
  const err = await read;
  assert.ok(err instanceof Ed3Error);
  assert.equal(err.code, 'cut');
  assert.ok(took < 1000, `the protective write took ${Math.round(took)} ms`);
  assert.equal(peak, 1, 'never two requests open at once');
  assert.equal(srv.requests.length, 2);
});

test('a server keeping the connection open: one connection at a time, the next opened after', async (t) => {
  const { tcpServer } = await import('./kit/index.mjs');
  const text = JSON.stringify({ status: 'Success', Relay_state: [false, false] });
  const dev = await tcpServer({
    onData: (c) =>
      c.toString('latin1').startsWith('GET')
        ? `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${text.length}\r\n\r\n${text}`
        : undefined,
  });
  t.after(() => dev.close());
  const c = client(dev.port);
  await c.ed3();
  await c.ed3();
  await Promise.all([
    c.relay(1, false, PRIORITY.PROTECTIVE).catch(() => {}),
    c.relay(2, false, PRIORITY.PROTECTIVE).catch(() => {}),
    c.ed3().catch(() => {}),
  ]);
  assert.equal(dev.connections, 5);
  assert.equal(dev.peak, 1, 'never two connections open at once');
});

test('the lane waits a little after a request before opening the next connection', async () => {
  const { testClock } = await import('./kit/index.mjs');
  const { TIMINGS } = await import('../src/constants.js');
  const clock = testClock();
  const started = [];
  const c = new Ed3Client({
    host: '127.0.0.1',
    port: 1,
    apiKey: KEY,
    monotonic: clock.monotonic,
    timers: clock.timers,
    transport: async () => {
      started.push(clock.elapsed);
      return { status: 200, body: Buffer.from('{"status":"Success"}') };
    },
  });
  const both = Promise.all([c.ed3(), c.ed3()]);
  await clock.advance(1);
  await clock.advance(TIMINGS.laneGap / 2);
  assert.equal(started.length, 1, 'the second waits');
  await clock.advance(TIMINGS.laneGap);
  await both;
  assert.equal(started.length, 2);
  assert.ok(started[1] - started[0] >= TIMINGS.laneGap);
});

test('another GCE box at the address: an IPX800 V5, an IPX800 V4 or Eco-Devices RT2, or nothing', async (t) => {
  const v5 = await httpServer({ routes: { '/api/system/ipx': { ioRelays_id: [1] } } });
  const v4 = await httpServer({ routes: { '/api/xdevices.json': { status: 'Success' } } });
  const none = await httpServer({ routes: {} });
  t.after(() => Promise.all([v5.close(), v4.close(), none.close()]));
  const deadline = () => ({ deadline: performance.now() + 2000 });
  assert.equal(await client(v5.port).otherDevice(PRIORITY.READ, deadline()), 'ipx800v5');
  assert.equal(await client(v4.port).otherDevice(PRIORITY.READ, deadline()), 'xdevices');
  assert.equal(v4.requests.at(-1).query.key, KEY);
  assert.equal(await client(none.port).otherDevice(PRIORITY.READ, deadline()), undefined);
});
