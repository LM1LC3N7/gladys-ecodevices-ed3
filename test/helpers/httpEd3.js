// -----------------------------------------------------------------------------
// A fake Eco-Devices 3 on a REAL local HTTP server (127.0.0.1, the kit's
// httpServer), for the scenarios on a real clock: two of them stand for two
// boxes of one house. `kind: 'ipx800v5'` answers as an IPX800 V5
// (`system/ipx` only), `kind: 'xdevices'` as an IPX800 V4 / Eco-Devices RT2
// (`/api/xdevices.json`): anything else is a 404. Every write is recorded.
// -----------------------------------------------------------------------------

import { httpServer, reply } from '../kit/index.mjs';
import { COUNTER_BASE } from './fakeEd3.js';

/** `{ srv, state, writes(), address }`: close with `srv.close()`. */
export async function httpEd3({
  kind = 'ed3',
  key = 'k',
  mac = '00:04:a3:12:34:56',
  latencyMs = 3,
  info = true,
} = {}) {
  const state = {
    kind,
    key,
    mac,
    /** false: `system/info` answers 404 (an older firmware, say). */
    info,
    relays: [false, false],
    index: new Map([
      [0, 12_662_000],
      [11, 4_072_301],
    ]),
    writes: [],
  };
  const ed3 = (r) => {
    if (r.query.ApiKey !== state.key) return reply(401, { error: 'unauthorized' });
    const path = r.path.replace(/^\/api\//, '');
    if (r.method !== 'GET') return reply(400, {});
    if (path === 'system/info') {
      return state.info
        ? { macAdress: state.mac, version: '1.0.0', hostName: 'ECODEVICES3' }
        : reply(404, 'not found');
    }
    const relay = /^object\/ed3\/0\/Set(On|Off)R\/([12])$/.exec(path);
    if (relay) {
      state.writes.push(`R${relay[2]}=${relay[1]}`);
      state.relays[Number(relay[2]) - 1] = relay[1] === 'On';
      return { status: 'Success' };
    }
    if (path === 'object/ed3/0') {
      return {
        _id: 1245184,
        Relay_state: [...state.relays],
        RelayName: ['Relay 1', 'Relay 2'],
        ID_Logger_tore: [COUNTER_BASE + 11, 0, 0, 0, 0, 0, 0, 0],
        puissance: [56511, 0, 0, 0, 0, 0, 0, 0],
        urms: 236.35,
      };
    }
    if (path === 'object/core_logger') {
      const items = [];
      for (let n = 0; n < 30; n += 1) {
        items.push(
          r.query.option === 'filter_name'
            ? { _id: COUNTER_BASE + n, name: `Compteur ${n}` }
            : { _id: COUNTER_BASE + n, index: state.index.get(n) ?? 0 },
        );
      }
      return items;
    }
    if (path === 'ebx/x8r' || path === 'ebx/xthl') return [];
    return reply(404, 'not found');
  };
  const route = (r) => {
    if (state.kind === 'ed3' && r.path.startsWith('/api/')) return ed3(r);
    if (state.kind === 'ipx800v5' && r.path === '/api/system/ipx') {
      return r.query.ApiKey === state.key
        ? { ioRelays_id: [1, 2, 3, 4, 5, 6, 7, 8] }
        : reply(401, {});
    }
    if (state.kind === 'xdevices' && r.path === '/api/xdevices.json') {
      return r.query.key === state.key
        ? { product: 'IPX800_V4', status: 'Success', R1: 0 }
        : reply(401, { status: 'Error' });
    }
    return reply(404, 'not found');
  };
  const srv = await httpServer({ latencyMs, routes: {} });
  // Every path through one handler (the kit matches exact paths only).
  srv.routes = new Proxy({}, { get: () => route });
  return {
    srv,
    state,
    address: `127.0.0.1:${srv.port}`,
    writes: () => [...state.writes],
  };
}
