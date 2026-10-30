# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
- Counters fed by a current clamp are not offered until their unit (Wh or
  mWh) is confirmed; the clamp power stays.
