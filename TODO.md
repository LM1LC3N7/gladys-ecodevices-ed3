# TODO - Eco-Devices 3 v1

Handoff document: what is done, what was decided, what comes next. Keep it up
to date at the end of every milestone.

## Status

- [x] **Milestone 1** (2026-10-30): the ED3 through its local HTTP API
      (`/api/...?ApiKey=`), up to three in one integration: counters
      (lifetime indexes behind the guard of gladys-ecodevices, "Accept the
      held index" in two clicks), clamps (W), mains voltage, relays R1 / R2
      (read only unless listed; switch-off protective), X-8R outputs (read
      only), X-THL; identity of the box (MAC when `system/info` gives one,
      else address and port), Discover emptied when the box is unreachable or
      another one, another GCE box at the address said; fr/en docs. Tested
      against an in-memory ED3 on a virtual clock, and a real local HTTP
      server on a real clock (x20). Never tested with a real device.
- [ ] **Review** (xhigh: relays, energy indexes), then corrections.
- [ ] **First real device**: cce66 (forum t/11448), who has the boxes; the
      questions below.
- [ ] **Milestone 2**: the teleinfo frame (`object/tic/0?option=filter_state`:
      `SINSTS` apparent power for the energy contracts, the current tariff
      `LTARF` / `NTARF`), X-8R commands once their path is confirmed, the
      pulse inputs, "Never tested" removed once cce66 confirms (ask Louis).
- [ ] **Release**: review, `gi ci`, Release workflow, topic.

## Sources, and what two of them confirm

No library exists for the ED3. Two sources were read side by side:

- **GCE**: the Postman documentation "API ED3"
  (https://documenter.getpostman.com/view/34094433/2sBXc8o3Dq), linked from
  cce66's tools; its JSON collection (descriptions and example answers).
- **cce66**: `GCE_ED3_Api-Deck v2.1.html` and `GCE_ED3_Mqtt-Deck v2.html`
  (https://github.com/cce66/Utilitaires_IPX800_X-Pool_Ecodevices_X-Display-V2_ScanDevice_Broker-Monitor_Modbus2Mqtt_Hub,
  MIT). The Api-Deck is built on the same Postman collection (same examples):
  a second reading of the same facts more than an independent source; the
  Mqtt-Deck is independent (the topics the ED3 publishes).

Confirmed by both (used):

- `GET|PUT /api/<path>?ApiKey=<key>`, the key in the query string.
- `GET object/ed3/0` (full) and `?option=filter_state`: `Relay_state` (2
  booleans), `RelayName`, `ID_Logger_tore`, `ToreName`, `puissance` (8),
  `urms`; GCE: `puissance` in mW (checked on the example: 432 mA × 236 V ×
  0.55 = 56 W, the answer says 56511), `urms` in V. Mqtt-Deck: `tore/<n>` in
  W, `relay_state/<n>` 0/1.
- `GET object/ed3/0/SetOnR/<n>`, `SetOffR/<n>`, `ToggleR/<n>` (GET, n = 1 or
  2). Only SetOnR / SetOffR are used (absolute).
- `GET object/core_logger?option=filter_state`: 30 counters `{ _id, index,
indexprix, moyenne, instMax, instMin, tarif }`, `_id` = 851968 + n; GCE:
  `index` "strictly increasing" in Wh (electricity) or mL (water, gas);
  `?option=filter_name` (`{ _id, name }`) is in cce66's Api-Deck only (not
  in the Postman): one source, used for the names only (a failure changes
  nothing but the names).
- The kinds of the counters by number: 0 teleinfo total, 1-10 teleinfo
  tariffs, 11-18 consumption, 19 injection, 20-21 production, 22-24 storage,
  25-27 water, 28-29 gas (GCE table; Mqtt-Deck table).
- `GET ebx/x8r` (`_id`, `name`, `codeExt`, `state` 8, `command` 8),
  `GET ebx/xthl` (`_id`, `name`, `codeExt`, `Temperature`, `Humidite`,
  `Luminosite`, `ioFault`).

## Questions for cce66 (his ED3)

1. The answer of `GET /api/system/info?ApiKey=…` (key removed): is there a
   MAC address, under which name (`macAdress` as the IPX800 V5)? Without it,
   the ED3 is known by its address only (the limit in the docs).
2. `GET /api/object/core_logger?option=filter_state`: the `index` of a
   teleinfo counter against the ED3's own page: Wh as GCE writes (22534 =
   22.534 kWh), or kWh / something else? And for a water counter: mL (GCE's
   Core Logger `unit` says "1 for litres")? **And one counter fed by a clamp
   (one listed in `ID_Logger_tore`) against the ED3's page**: Wh or mWh?
   GCE's own example has counters 11, 12, 19 to 23 near 407 million for
   clamps reading 56 W and 2 W (407 MWh in Wh), and `conso` per clamp is in
   mWh. Until he answers, the counters fed by a clamp are not offered (r1
   m-8); to be settled before any release to the store.
3. An unused counter: `index` 0 and the name empty (or "Compteur n")? Does
   the list always hold 30 entries?
4. Storage: is it 22 charge, 23-24 discharge (Mqtt-Deck) or 22-24 "storage"
   (GCE)? Published here as plain sensors either way.
5. `GET /api/ebx/x8r/<n>/SetOnR/<k>`: is `<n>` the position in the list (0
   in both examples) or the `_id` (4259840)? Until then the X-8R outputs are
   read only.
6. An X-8R or X-THL not paired: is its `codeExt` "0" (the GCE X-THL example)
   or empty? Such an object is not offered here.
7. A clamp measuring a production (solar): is `puissance` negative?
8. What does `SetOnR/1` answer (a body, a status)? Taken as accepted on any
   2xx, confirmed by the read back.
9. Does the ED3 answer HTTPS only on some firmwares (the Api-Deck offers
   both)? http only here.
10. The status line and the names in Discover: clear enough in his words?

## Decisions

- **Version 0.1.0, set by hand once** in `package.json`, `package-lock.json`,
  the manifest `version` and the `docker_image` tag; every later version
  comes from Actions > Release.
- **SDK 0.16.0** (the latest on npm on 2026-10-30, `^0.16.0`).
- **HTTP API only, no MQTT**: everything needed is in the HTTP API (states,
  counters, relays with absolute commands, read backs); MQTT would need a
  broker set up on the ED3 and in Gladys, and gives no read back of a
  command. Not needed, so not used.
- **Own client, no dependency**: no ED3 library exists; the structure of
  `gladys-ipx800` (approved after 4 reviews and a real V5) is reused: one
  lane of requests with priorities, the identity of the box, the guards of
  the protective commands, up to three boxes, Discover emptied. The index
  guard is `gladys-ecodevices/src/guard.js` as is.
- **Not in the manifest**: `keywords` and `countries` (need Gladys 5.3.0).
- **Categories**: `energy`, `lighting` (relays).
- **One round**: `system/info` (identity, secondary), `object/ed3/0` (the
  round fails without it), the counter names every 10 min (secondary), the
  counters, `ebx/x8r`, `ebx/xthl` (secondary: a failure, even 401, keeps the
  targets known without value, said in the status). Default interval 15 s
  (10 to 300).
- **Counters**: the index only (`moyenne` is reset every 5 minutes, not a
  live power: not used). Categories: c0 and c11-c18 `energy-sensor/index`
  kWh; c20-c21 `energy-production-sensor/index`; c19 `grid-sensor/
output-index` (never an energy-sensor index: it would be counted as
  consumption); c1-c10 and c22-c24 plain sensors (kWh in the name); c25-c29
  `volume-sensor` m³. Guard limits: 100 kW + 0.5 kWh, water 10 m³/h + 0.05,
  gas 16 m³/h + 0.05. Indexes once a minute at most (1 s of slack for the
  round's own time), /data written first; the guard on the session clock
  (wall at construction + monotonic elapsed). The counter indexes are the
  ED3's own (not built here): a drop is accepted like a jump (two clicks).
  The guard state belongs to the device (`device.id`): a device created
  again starts from Gladys's last value.
- **Clamps**: only those linked to a counter (`ID_Logger_tore` not 0), power
  in W, signed range (±100 kW): the sign of a production is not documented.
- **Relays read only by default** (lesson of Velbus / Qbus / IPX800): R1 and
  R2 become a switch or a light only when listed; X-8R outputs read only in
  this version (their write path is not confirmed, question 5).
- **Protective commands**: switching a listed relay off; the rules and
  refusals of `gladys-ipx800` (see its TODO "Decisions", B1 to r3): never
  refused by a pause, a refused key, the queue, a read or a command in
  progress; cuts the request in flight; tried again for 250 ms, then kept in
  /data and sent again (3 times at most, counted when sent); lifted by a
  newer command that left, or, once confirmed, by another state read twice
  in a row; never by the time. A switch-on during a pause is refused before
  anything leaves, the MAC check included.
- **Identity**: the owner by the MAC of `system/info` when it gives one
  (`macAdress`, `macAddress`, `mac`, `MAC` tried), else by the controller key
  (address and port). Verdicts and "Attach the devices" as in
  `gladys-ipx800` 0.1.3 (without its 0.1.2 migration: a new module). An
  owner known by its address becomes known by its MAC as soon as one is read
  (never the reverse).
- **Another box**: a round failing with an answer (404, not JSON, 401, size)
  asks `system/ipx` (IPX800 V5) then `xdevices.json` (IPX800 V4 / RT2) with
  the same key; an answer: status "This address answers as …", pause as a
  failure, no key refused, Discover empty.
- **Units**: °C, %, lux, W, V, kWh, m³ only (the core list).
- **Mutation pass**: milestone 1 left 7 mutants alive that the r1 review
  found (E10, E11, E18, R3, R4, R25, R27; the note here then said none, which
  was wrong); each has a test since (test/review-r1.test.js). Equivalent
  mutants, kept as such: E2 (`raw <= 0` in `indexValue`, also caught by
  `value > 0` after the conversion), E8 (`storeUnreadable` in
  `currentGuard`, also checked by `indexStates`), R17 and R24 (as the review
  classed them).

## Decisions after the review r2 (2026-10-30)

- **I-4**: owner unknown with devices there (/data deleted, empty, restored on
  another machine, unreadable or never written): a switch-off goes to the
  address typed, whatever /data; switching on and the values wait for
  "Attach the devices". Refusals only on proof: another MAC, another GCE box,
  a duplicate slot.
- **m-9**: a slot n > 1 that read a MAC waits (25 s at most) for the first
  round of every earlier slot before it binds, offers or publishes anything.
- **m-10**: the pause of a duplicate slot keeps its earlier slot in /data
  (`code: 'duplicate', of`): said again at start; a slot without device nor
  owner says "Connecting", never "/data lost".
- **m-11**: the counters fed by a clamp holding an index are named in the
  status.
- **m-12**: tests for N17 and N18 (test/review-r2.test.js).
- **m-13**: a save still hanging makes the next ones fail at once (no second
  5 s wait); a switch-off clicked while the start waits for /data says so.
- **m-14**: after "Attach the devices" by the address, the first MAC read
  becomes the identity without comparison (documented).

## Decisions after the review r1 (2026-10-30)

- **I-1**: no file, devices there, and the first save at start failing:
  owner unknown as with an unreadable /data (`storeLost`): switch-offs to
  the address typed, nothing else, Attach refused, a status; a later save
  that succeeds makes it a /data lost (Attach asked). Ported from
  gladys-ipx800 7786d42.
- **I-2**: a slot with the address of an earlier slot is not started
  (`duplicate_of`); a slot reading the MAC an earlier slot read (memory only,
  across the slots, never /data) is not used: nothing published, no command
  (a switch-off neither: the earlier slot drives that same ED3), read again
  every 5 min, a status.
- **I-3**: a relay write accepts any 2xx whatever the body (empty, text,
  JSON); the read back of the state confirms.
- **m-1**: an id of a slot this version does not have gets a plain refusal.
- **m-2**: Attach works by the address when the MAC of an owner known by it
  cannot be read any more.
- **m-3**: every /data load and save is bounded (5 s, then a failure): a
  frozen save holds neither a round nor a command, a frozen load at start is
  an unreadable /data.
- **m-5**: a switch-off that left clears the check of an older command of
  ours on the relay (its guard reports instead).
- **m-6**: another GCE box found at the address: no command at all, a
  switch-off neither, kept ones dropped (the status says so).
- **m-8**: the counters fed by a clamp (listed in `ID_Logger_tore`; without
  the list, 11 to 24) are not offered until their unit is confirmed
  (question 2); the clamp power (mW, two sources) is kept.
