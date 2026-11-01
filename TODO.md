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
- [ ] **First real device**: cce66 (forum t/11448), who has the boxes:
      his answers of 2026-10-31 received (identity, counters, units of the
      teleinfo and water), replayed in the tests; the questions left below.
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
- `GET object/core_logger?option=filter_state`: up to 30 counters (a real
  ED3 listed 26) `{ _id, index,
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

## Answers of cce66 (t/11448 post 7, 2026-10-31)

His ED3, firmware 1.3.0, replayed in test/cce66.test.js (fixtures in
test/fixtures/cce66-ed3.js, his masked MAC replaced by an invented one):

- [x] Q1 `system/info`: `macAdress` "XX-XX-XX-XX-XX-XX" (dashes, upper
      case), `productName` "ECODEVICES3", `firmwareVersion` "1.3.0 " (a
      trailing space). The MAC is the identity (`parseMac` already took
      dashes); the firmware is neither shown nor compared anywhere.
- [x] Q2, teleinfo and water: counter 0 = 132 533 861, his Eco-Devices RT2
      read the same Linky at 132 533 718 a few minutes apart (143 apart, an
      average of 811 W: about 10 minutes in Wh, impossible in kWh): **Wh**,
      published in kWh. Water (counter 25) 60 707 000: mL as GCE says,
      60.707 m³, plausible; published in m³ (`volume-sensor`).
- [ ] Q2, clamps: not settled (no `object/ed3/0`, no comparison with the
      ED3's page). Held, see "Decisions after cce66's answers".
- [x] Q3: unused counters at 0 (index and all fields); **not always 30
      entries**: his list has 26 (851986, 851989, 851992, 851995 missing:
      counters 18, 21, 24, 27). The number of a counter is its `_id` -
      851968, never its place (already so; now tested on his list).
- [ ] Q4 to Q10: no answer (his X-8R is to be rewired). Not asked again,
      their default being safe: Q4 storage 22 charge / 23-24 discharge or
      22-24 storage (plain sensors either way), Q6 `codeExt` of an object
      not paired ("0" or empty: neither offered), Q8 the body of `SetOnR`
      (any 2xx, the read back confirms), Q9 HTTPS (http only).

## Questions left for cce66 (short, for the forum)

1. L’adresse `http://<ED3>/api/object/ed3/0?ApiKey=…` (clé retirée) : la
   réponse complète, surtout `ID_Logger_tore` et `ToreName`. Elle dit quels
   compteurs viennent de vos pinces.
2. Pour un de ces compteurs de pince (par exemple le 11, index 3 293 592) :
   quelle valeur affiche la page de l’ED3, et dans quelle unité (kWh, Wh) ?
3. Une fois le X-8R recâblé : l’adresse `…/api/ebx/x8r?ApiKey=…`, puis
   `…/api/ebx/x8r/0/SetOnR/1?ApiKey=…` allume-t-elle la sortie 1 (0 = la
   place dans la liste), ou faut-il `…/api/ebx/x8r/4259840/SetOnR/1` (le
   `_id`) ? Et ce que répond l’ED3 à cet appel.
4. Une pince qui mesure une production (solaire) : la puissance est-elle
   négative ?
5. Les noms dans la Découverte et la ligne d’état : clairs pour vous ?

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

## Decisions after cce66's answers (2026-11-01)

- **Clamp counters still not offered.** His values lean to Wh: counter 11
  = 3 293 592 with an average of 585 W is 3 294 kWh (about 235 days of
  that average) in Wh, but 3.3 kWh (under 6 hours) in mWh; and its
  `indexprix` gives about 59 units per price unit for the counters 11, 12,
  13, 20, 23 (0.17 per kWh in Wh, 170 per kWh in mWh). Still not a proof:
  no comparison with the ED3's page, the unit of `indexprix` is not
  documented, and without `object/ed3/0` (`ID_Logger_tore`) which of his
  counters 11 to 24 come from a clamp is not known. A lifetime index 1000
  times off cannot be taken back from Gladys's energy history (rule:
  units checked against the reference): held until questions 1 and 2.
- **Teleinfo in Wh, water in mL: confirmed** (see Q2 above), no change.
- **Fewer than 30 counters**: nothing to change (the parser numbers by
  `_id`); docs and comments now say "up to 30".
- **Firmware with a trailing space**: not used anywhere (only the MAC is
  read from `system/info`); nothing to trim.
- The fake ED3 of the tests takes raw answers by path (`world.answers`).
- test/manifest.test.js no longer pins the version to 0.1.0: the Release
  workflow made it 0.1.1, and CI on main failed since.

## Decisions after the review r3 (2026-10-30)

- **I-5** (the m-9 wait made every round 25 s long and applied reads older
  than a switch-off): a slot n > 1 waits for the earlier slots once per
  start, before the reads of its first round (never between a read and its
  use), 25 s at most (`waitEarlierSlots`, src/hub.js `earlierSettled`). An
  earlier slot counts as done once its first round ended (read, failed, the
  same ED3 as an earlier one) or when it reads nothing soon: no
  configuration, a refused key or a pause kept in /data at start. A round
  during which a write, a read back or an identity check left (the lane
  counts them, `client.sentAhead`) is not applied at all: its reads are
  older than that one; the next round comes at its time.
- **m-15**: tests for P4, P5, P7 and P11 (test/review-r3.test.js). The
  corrections of this round were mutated too (29 mutants: the wait, its
  bound, its end by a stop, once per start, the settled slots, the round
  not applied, the frozen load, the wording without `ID_Logger_tore`): all
  killed; the equivalent mutants are still E2, E8, R17 and R24 only.
- **m-16**: without `ID_Logger_tore`, the counters 11 to 24 are held for the
  same reason (unit unconfirmed) but said of unknown source, never "fed by
  a clamp".
- **m-17**: a /data load still hanging makes the next ones fail at once, as
  a save does (`loadMemory`); /data is read again once it ends.

## Decisions after the review r2 (2026-10-30)

- **I-4**: owner unknown with devices there (/data deleted, empty, restored on
  another machine, unreadable or never written): a switch-off goes to the
  address typed, whatever /data; switching on and the values wait for
  "Attach the devices". Refusals only on proof: another MAC, another GCE box,
  a duplicate slot.
- **m-9**: a slot n > 1 that read a MAC waits (25 s at most) for the first
  round of every earlier slot before it binds, offers or publishes anything
  (replaced after r3, see I-5).
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

## Next patch (review r4, 0436564)

- m-18: a request that leaves ahead of a polling round drops the whole round; only the relay states (and the MAC after an identity check) are stale. Apply counters, clamps, voltage and X-THL, skip only those, and add a test (reviewer's r4-steady.mjs: commands every 2 s apply 2 of 7 rounds).
