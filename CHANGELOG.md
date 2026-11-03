# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The counters fed by a current clamp are offered, in kWh: their index is in
  Wh as the teleinfo's (GCE's documentation, and checked on a real
  Eco-Devices 3: the counter of its battery clamp grew at the power the
  clamp measured, in Wh).
  Each counter fed by a clamp or a pulse input is named after it in Discover,
  as the ED3 lists them (`ID_Logger_tore`, `ID_Logger_tore_neg`,
  `ID_Logger_pulse`): "T1-EDF · Consumption (C11)", "T1-EDF (negative) ·
  Injection (C19)", "Eau · Water (C25)".
- A clamp feeding only a counter of its negative direction is offered too.

### Changed

- The clamp power (W) is checked on a real ED3 (current × voltage × power
  factor); its sign is documented: positive in the direction of the clamp's
  `ID_Logger_tore` counter, negative in that of its `ID_Logger_tore_neg`
  one (consumption or production: the counter says it).
- An electricity counter fed by a pulse input is no longer offered (its
  unit is not checked; the status names it); a clamp linked to a counter
  outside 11 to 24 counts as a list of another form.
- A list of clamp links in another form than a real ED3 gives (another
  length, counter numbers instead of ids: another firmware) is never
  guessed: the counters 11 to 24 are then held, as before, and the status
  says why.
- A polling round during which a command, a read back or an identity check
  left is now applied, but for the relays R1 and R2 (they keep the newer
  value), when it read the ED3 the devices belong to; before, the whole
  round was dropped (under frequent commands, one round in three applied).
- The water unit (mL) is confirmed against a real water meter. The docs say
  what was checked on a real ED3 and with what.

### Fixed

- The docs of 0.1.2 said the counters of a clamp were not offered; on a
  firmware that lists `ID_Logger_tore_neg`, 0.1.2 did offer those of the
  negative direction (only `ID_Logger_tore` was read), in kWh, with the
  same values as now: nothing to redo for them.

## [0.1.2] - 2026-11-01

### Changed

- Checked against the answers of a real Eco-Devices 3 (firmware 1.3.0): its
  MAC address (`macAdress`, with dashes) is its identity, a list of fewer
  than 30 counters is read by their ids, the teleinfo indexes are in Wh and
  the water ones in mL as assumed; replayed in the tests. The counters fed by
  a clamp stay not offered until their unit is compared with the ED3's page.
  Docs say so.

## [0.1.1] - 2026-10-30

### Added

- First version: up to three GCE Eco-Devices 3 through their local HTTP API
  (`/api/...?ApiKey=`): the 30 counters (teleinfo total and tariffs,
  consumption, injection, production, storage, water, gas) as lifetime
  indexes behind a guard (never 0 nor a drop, a jump or a drop held back
  until "Accept the held index" is clicked twice, the guard in `/data` before
  Gladys gets an index), the power of the current clamps, the mains voltage,
  the relays R1 and R2 (read only unless listed; switching a listed relay off
  goes before anything, kept and sent again until the reads show it), the
  X-8R outputs (read only), the X-THL sensors.
- The devices of each Eco-Devices 3 belong to it (its MAC address when
  `system/info` gives one, else its address and port): another one never gets
  their values nor their commands; "Attach the devices" (two clicks) after a
  replacement. Another GCE box at the address (IPX800 V5, IPX800 V4,
  Eco-Devices RT2) is said in the status.
- "Test the connection"; French and English guides.
- The same Eco-Devices 3 in two slots (same address, or same MAC under
  another name) is refused: its counters would be counted twice.
- A /data that was never writable, or that hangs, no longer blocks: only
  switch-offs leave while the owner of the devices is unknown.
- With the owner of the devices unknown (/data deleted or restored on
  another machine), switch-offs still go to the address typed.
- Counters fed by a current clamp are not offered until their unit (Wh or
  mWh) is confirmed; the clamp power stays. Without the list of the clamps,
  counters 11 to 24 are held the same way, said of unknown source.
- At start, a slot after the first reads once the earlier slots have read
  their ED3 (25 s at most, once per start), so that the same ED3 is told
  first; a round during which a command or a read back left is not applied
  (its values are older).
- A /data load that hangs makes the next ones fail at once, as a save does.

[Unreleased]: https://github.com/LM1LC3N7/gladys-ecodevices-ed3/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-ecodevices-ed3/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-ecodevices-ed3/releases/tag/v0.1.1
