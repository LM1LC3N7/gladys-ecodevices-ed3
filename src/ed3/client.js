// -----------------------------------------------------------------------------
// The client of one Eco-Devices 3: its requests through ONE lane: one
// request at a time (a small embedded server), in the order of their
// priority:
//   0  protective commands clicked (a listed relay switched off);
//   1  protective commands sent again by the integration (guards), and the
//      read back of a protective command;
//   2  the other commands;
//   3  the read backs of the other commands (after the
//      writes waiting: a scene on several targets writes them all, then reads once);
//   4  the reads of the polling.
// A protective command clicked cuts the request in flight, whatever it is,
// unless it is another protective command clicked (a read cut does not count
// as a failure; a command cut that may have left is "sent, without
// confirmation"); any other write cuts a read of the polling. A request not
// started by its deadline leaves the queue ("nothing sent"). The next request
// opens its connection only once the previous one is closed (see http.js).
//
// The API key goes in the query string, as the API wants it: the paths are
// built here and never leave this file but to the transport.
// -----------------------------------------------------------------------------

import { API, LIMITS, LIMITS_ED3, TIMINGS } from '../constants.js';
import { Ed3Error, request } from './http.js';

export const PRIORITY = { PROTECTIVE: 0, GUARD: 1, COMMAND: 2, CONFIRM: 3, READ: 4 };

const EBX = /^[a-z0-9]{1,8}$/;

export class Ed3Client {
  constructor({ host, port, apiKey, transport = request, monotonic, timers }) {
    this.host = host;
    this.port = port;
    this.apiKey = apiKey;
    this.transport = transport;
    this.monotonic = monotonic ?? (() => performance.now());
    this.timers = timers ?? globalThis;
    /** Jobs waiting: { priority, run, resolve, reject }. */
    this.queue = [];
    /** The job running: { priority, cut }. */
    this.current = undefined;
    this.closed = false;
  }

  /** Ends the client: what waits is refused (nothing sent), the request in flight is cut. */
  close() {
    this.closed = true;
    for (const job of this.queue.splice(0)) {
      this.timers.clearTimeout(job.timer);
      job.reject(new Ed3Error('late', 'the connection to the ED3 was closed'));
    }
    this.current?.cut?.();
  }

  /** True when a job of this priority (or a more urgent one) is waiting or running. */
  busyWith(priority) {
    return (
      (this.current !== undefined && this.current.priority <= priority) ||
      this.queue.some((job) => job.priority <= priority)
    );
  }

  /** One request through the lane. */
  send(priority, options, hooks = {}) {
    if (this.closed) {
      return Promise.reject(new Ed3Error('late', 'the connection to the ED3 was closed'));
    }
    return new Promise((resolve, reject) => {
      const job = { priority, options, hooks, resolve, reject };
      // FIFO within a priority, the more urgent first.
      const at = this.queue.findIndex((j) => j.priority > priority);
      if (at === -1) this.queue.push(job);
      else this.queue.splice(at, 0, job);
      if (hooks.deadline !== undefined) {
        // Not started by its deadline: out of the queue, nothing sent.
        job.timer = this.timers.setTimeout(
          () => {
            const index = this.queue.indexOf(job);
            if (index !== -1) {
              this.queue.splice(index, 1);
              reject(new Ed3Error('late', 'no time left to send'));
            }
          },
          Math.max(0, hooks.deadline - this.monotonic()),
        );
      }
      // A protective command clicked cuts whatever is not one; any other write cuts a read of
      // the polling (idempotent, read again at the next round): a write never waits behind one.
      if (
        this.current &&
        ((priority === PRIORITY.PROTECTIVE && this.current.priority > priority) ||
          (priority <= PRIORITY.COMMAND && this.current.priority === PRIORITY.READ))
      ) {
        this.current.cut?.();
      } else if (
        priority === PRIORITY.PROTECTIVE &&
        this.current?.priority === PRIORITY.PROTECTIVE
      ) {
        // Another protective command that gets no answer for 1 s is cut too (it may have
        // left: "sent, without confirmation"); this one does not wait for its deadline.
        const running = this.current;
        this.timers.setTimeout(
          () => {
            if (this.current === running) running.cut?.();
          },
          Math.max(0, running.startedAt + TIMINGS.stuckProtective - this.monotonic()),
        );
      }
      this.pump();
    });
  }

  pump() {
    if (this.current || this.cooling || this.queue.length === 0) {
      return;
    }
    const job = this.queue.shift();
    this.timers.clearTimeout(job.timer);
    const running = { priority: job.priority, cutAsked: false, startedAt: this.monotonic() };
    // Until the transport hands its own cut, a cut asked is remembered.
    running.cut = () => {
      running.cutAsked = true;
    };
    this.current = running;
    const { deadline, beforeSend, onSent } = job.hooks;
    this.transport(
      { hostname: this.host, port: this.port, ...job.options },
      {
        monotonic: this.monotonic,
        deadline: deadline ?? this.monotonic() + TIMINGS.requestTimeout,
        maxBytes: LIMITS.responseBytes,
        beforeSend,
        onSent,
        onStart: (cut) => {
          running.cut = cut;
          if (running.cutAsked) cut();
        },
      },
    )
      .then(job.resolve, job.reject)
      .finally(() => {
        this.current = undefined;
        // The next job a little later: the caller of this one may queue its own follow-up
        // first (the read back of a protective command goes before the commands waiting),
        // and the ED3 has seen the previous connection closed before the next one opens.
        this.cooling = true;
        this.timers.setTimeout(() => {
          this.cooling = false;
          this.pump();
        }, TIMINGS.laneGap);
      });
  }

  /** A JSON answer of a 200, or the error of the status. */
  async json(priority, options, hooks) {
    const { status, body } = await this.send(priority, options, hooks);
    if (status === 401 || status === 403) {
      throw new Ed3Error('refused', 'API key refused', { status, sent: true });
    }
    if (status === 429 || status === 503) {
      throw new Ed3Error('busy', 'the ED3 asks to wait', { status, sent: true });
    }
    if (status < 200 || status > 299) {
      throw new Ed3Error('http', 'unexpected answer', { status, sent: true });
    }
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      throw new Ed3Error('bad_response', 'not a JSON answer', { sent: true });
    }
  }

  path(path, query = '') {
    return `${API.base}${path}?${query ? `${query}&` : ''}${API.keyParam}=${encodeURIComponent(this.apiKey)}`;
  }

  get(path, query, priority, hooks) {
    return this.json(priority, { method: 'GET', path: this.path(path, query) }, hooks);
  }

  /** `system/info`: where a MAC address is looked for (undocumented fields). */
  info(priority = PRIORITY.READ, hooks) {
    return this.get('system/info', '', priority, hooks);
  }

  /** `object/ed3/0`: relays, clamps, voltage, names. */
  ed3(priority = PRIORITY.READ, hooks) {
    return this.get('object/ed3/0', '', priority, hooks);
  }

  /** `object/ed3/0?option=filter_state`: the states only (the read back of a relay). */
  ed3States(priority = PRIORITY.READ, hooks) {
    return this.get('object/ed3/0', 'option=filter_state', priority, hooks);
  }

  /** The 30 counters (`core_logger?option=filter_state`). */
  counters(priority = PRIORITY.READ, hooks) {
    return this.get('object/core_logger', 'option=filter_state', priority, hooks);
  }

  /** The names of the counters (`core_logger?option=filter_name`). */
  counterNames(priority = PRIORITY.READ, hooks) {
    return this.get('object/core_logger', 'option=filter_name', priority, hooks);
  }

  /** `ebx/x8r` / `ebx/xthl`. */
  async extensions(type, priority = PRIORITY.READ, hooks) {
    if (!EBX.test(type)) throw new Ed3Error('bad_request', 'invalid extension type');
    return this.get(`ebx/${type}`, '', priority, hooks);
  }

  /** One relay of the ED3 on or off (`GET object/ed3/0/SetOnR/<n>` / `SetOffR/<n>`). */
  async relay(n, on, priority, hooks) {
    if (!Number.isInteger(n) || n < 1 || n > LIMITS_ED3.relays || typeof on !== 'boolean') {
      throw new Ed3Error('bad_request', 'invalid write');
    }
    await this.get(`object/ed3/0/${on ? 'SetOnR' : 'SetOffR'}/${n}`, '', priority, hooks);
  }

  /**
   * After a round that failed with an answer that is not an ED3's: is it
   * another GCE box at this address? One read with the same key: an IPX800
   * V5 (`system/ipx`), or an IPX800 V4 / Eco-Devices RT2 (`xdevices.json`).
   * Resolves 'ipx800v5', 'xdevices' or undefined.
   */
  async otherDevice(priority = PRIORITY.READ, hooks) {
    try {
      const json = await this.get('system/ipx', 'option=filter_id', priority, hooks);
      if (json && typeof json === 'object' && Array.isArray(json.ioRelays_id)) return 'ipx800v5';
    } catch {
      // Not an IPX800 V5.
    }
    try {
      const json = await this.json(
        priority,
        {
          method: 'GET',
          path: `/api/xdevices.json?key=${encodeURIComponent(this.apiKey)}&Get=all`,
        },
        { ...hooks, deadline: this.monotonic() + TIMINGS.requestTimeout },
      );
      if (json && typeof json === 'object' && json.status === 'Success') return 'xdevices';
    } catch {
      // Nothing known.
    }
    return undefined;
  }
}
