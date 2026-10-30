# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`).

No third-party code is copied or ported into it. The facts about the API of
the Eco-Devices 3 (paths, fields, units, the numbering of the counters) come
from:

- GCE Electronics' own documentation of the API, "API ED3"
  (https://documenter.getpostman.com/view/34094433/2sBXc8o3Dq), read for its
  descriptions and examples;
- the free tools of cce66,
  [Utilitaires_IPX800_X-Pool_Ecodevices_X-Display-V2_ScanDevice_Broker-Monitor_Modbus2Mqtt_Hub](https://github.com/cce66/Utilitaires_IPX800_X-Pool_Ecodevices_X-Display-V2_ScanDevice_Broker-Monitor_Modbus2Mqtt_Hub)
  (MIT licence, Copyright (c) 2026 cce66): `GCE_ED3_Api-Deck v2.1.html` and
  `GCE_ED3_Mqtt-Deck v2.html`, read as a second source for the same facts
  (testers written by a user, not a GCE specification). Nothing of their code
  is used.

The structure of the client, the lane of requests, the identity of the box,
the guards of the protective commands and the index guard come from the
author's own integrations `gladys-ipx800` and `gladys-ecodevices`
(Apache-2.0).

## gladys-testkit (tests only)

`test/kit/` copies parts of the shared test kit of the same author
(Apache-2.0); it is not in the image.
