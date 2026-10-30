# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the GCE Eco-Devices 3 (ED3):
a Node.js service (Node 22+, ESM, no build step) in its own sandboxed Docker
container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the ED3 through its local HTTP API
(`/api/...?ApiKey=<key>`). Its structure is the one of `gladys-ipx800`
(lane, identity, protective commands) with the index guard of
`gladys-ecodevices`.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store .   # store admission checks
node scripts/cover.mjs cover.png          # the store cover (dev only)
```

## Architecture

```
index.js              SDK wiring only: handlers registered before connect()
src/handlers.js       the SDK handlers, shared with the tests
src/hub.js            Ed3Hub: up to 3 Ed3App (slots), one view of Gladys each
src/app.js            Ed3App: one ED3: lifecycle, rounds, identity (owner),
                      guards of the switch-offs, counter indexes, commands, status
src/guard.js          the index guard (from gladys-ecodevices, do not copy back)
src/ed3/http.js       one HTTP request: bounded, deadline, cut, settles once closed
src/ed3/client.js     the lane (one request at a time, priorities) and the API paths
src/ed3/model.js      what the answers mean (pure): relays, counters, clamps, X-8R, X-THL
src/devices.js        targets -> Gladys devices and states (pure)
src/publisher.js      states within the Gladys rate limit
src/store.js          /data: pace, pause, refused key tag, owner, guards, indexes
src/config.js         DEFAULTS (mirror the manifest) + normalization, codes
src/constants.js      API, counter kinds, keys, limits, timings
src/i18n.js           French and English texts
test/helpers/         fake ED3 on the virtual clock and over real HTTP
                      (httpEd3.js), app setup
test/kit/             parts of the shared test kit (clocks, HTTP server)
```

Safety rules (see TODO.md "Decisions"): relays read only unless listed (R1,
R2 only; the X-8R outputs read only); switching a listed relay off is
protective: never refused by a pause, a queue or a read, it cuts the request
in flight, is kept in /data and sent again; one request to the ED3 at a
time; the API key (in the query string of every request) is never logged,
nor put in an error, a status or /data; success only after a read back.
Counter indexes: never 0 nor a drop published, a jump or a drop held until
the user accepts it in two clicks, the guard in /data before Gladys gets an
index, dated on the session clock.

## Rules

- **External ids are forever** (`ext:<selector>:<kind>:<code>`, the slot
  n >= 2 as `ext:<selector>:ed3<n>:<kind>:<code>`), and so are the feature
  keys and the manifest keys (`<key>_<n>` for the slots).
- **A device never gets the values of, nor drives, another ED3**: the owner
  of each slot is in /data (salted hash of the MAC of `system/info` when it
  gives one, else the controller key: address and port).
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow**; `test/manifest.test.js` checks
  they agree.
- **Changelog** under `## [Unreleased]`.
- **Manifest texts** are `{ "en", "fr" }`; user-facing text is bilingual.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network beyond 127.0.0.1.
