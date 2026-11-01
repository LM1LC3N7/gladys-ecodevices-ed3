// -----------------------------------------------------------------------------
// The answers of a real Eco-Devices 3 (cce66's, firmware 1.3.0, forum t/11448
// post 7, 2026-10-31), copied as he gave them. No API key here; his MAC was
// masked by him (`XX-X4-X3-31-X1-X8`): replaced by an invented one of the
// same format (upper case, dashes). Where he shortened an entry (`…`, "all at
// 0"), the fields left out are 0, as in the entries he gave in full.
//
// What they show: `macAdress` with dashes; `firmwareVersion` with a trailing
// space; `core_logger` with 26 entries, not 30 (851986, 851989, 851992 and
// 851995 are missing: counters 18, 21, 24 and 27), so the number of a counter
// is its `_id` - 851968, never its place in the list; the unused counters at
// 0; counter 0 (teleinfo total) in Wh (132 533 861, his Eco-Devices RT2 read
// the same Linky at 132 533 718 a few minutes apart); counter 25 (water) in
// mL (60 707 000 = 60.707 m³).
// -----------------------------------------------------------------------------

/** The invented MAC, as the ED3 spells it; and as the integration keeps it. */
export const REAL_MAC = '02-14-A3-31-C1-D8';
export const REAL_MAC_NORMALIZED = '02:14:a3:31:c1:d8';

export const SYSTEM_INFO = {
  productName: 'ECODEVICES3',
  familyDevice: 'X-Devices',
  macAdress: REAL_MAC,
  hostName: 'ECODEVICES3',
  firmwareVersion: '1.3.0 ',
  compiled: 'Aug 20 2026 14:51:29',
};

const entry = (_id, index = 0, indexprix = 0, moyenne = 0, instMax = 0, instMin = 0) => ({
  _id,
  index,
  indexprix,
  moyenne,
  instMax,
  instMin,
  tarif: 0,
});

/** `GET /api/object/core_logger?option=filter_state`: 26 entries. */
export const CORE_LOGGER = [
  entry(851968, 132533861, 96058, 811, 3180, 570),
  ...Array.from({ length: 10 }, (_, i) => entry(851969 + i)),
  entry(851979, 3293592, 56101, 585, 3066, 330),
  entry(851980, 1064294, 18029, 11, 48, 0),
  entry(851981, 1475571, 24210),
  entry(851982),
  entry(851983, 1063454, 18014, 9, 34, 0),
  entry(851984, 131571, 2429),
  entry(851985, 1172, 8),
  entry(851987, 122117, 131),
  entry(851988, 439831, 7396),
  entry(851990, 19610, 249),
  entry(851991, 274442, 4715, 57, 75, 0),
  entry(851993, 60707000, 17067),
  entry(851994),
  entry(851996),
  entry(851997),
];

/** The counters (numbers) whose `_id` is not in his list. */
export const MISSING = [18, 21, 24, 27];

/** The counters 11 to 24 that hold an index (their source is not known: no `ID_Logger_tore`). */
export const HELD = [11, 12, 13, 15, 16, 17, 19, 20, 22, 23];
