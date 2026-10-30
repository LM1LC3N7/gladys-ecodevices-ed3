# gladys-ecodevices-ed3

[Gladys Assistant](https://gladysassistant.com) integration for the **GCE
Electronics Eco-Devices 3** (up to three in one installation), through its
local HTTP API and an API key: the counters (teleinfo, consumption,
production, injection, storage, water, gas), the power of the current
clamps, the mains voltage, the two relays (read only unless you list them),
the X-8R outputs (read only) and the X-THL sensors.

- Counters: lifetime indexes, never 0 nor a drop; a jump or a drop is held
  back until you accept it ("Accept the held index", two clicks).
- Relays: read only unless listed in "Relays Gladys may drive"; switching a
  listed relay off goes before anything.
- The API key is never written in the logs nor in `/data`.
- Each Eco-Devices 3 keeps its devices (known by its MAC address when its API
  gives one, else by its address): another one never gets their values nor
  their commands (but at the same address when it gives no MAC: see the guide).

Never tested with a real device. Not affiliated with GCE Electronics.

User guide: [English](docs/en.md) · [Français](docs/fr.md).

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
```

See `CLAUDE.md` (architecture, rules) and `TODO.md` (status, decisions).
Licensed under the Apache License 2.0; sources credited in
`THIRD_PARTY_NOTICES.md`.
