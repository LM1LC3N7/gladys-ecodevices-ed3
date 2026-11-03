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

// -----------------------------------------------------------------------------
// `GET /api/object/ed3?ApiKey=…` of the same ED3 (t/11448 post 9, 2026-11-02),
// copied as he gave it: the links of his 8 clamps (`ID_Logger_tore` positive,
// `ID_Logger_tore_neg` negative) and 4 pulse inputs to their counters (`_id`,
// 0 = none), their names, and the measures (`puissance` mW, `irms` mA as
// signed texts, `cosphi` %, `urms` V).
// -----------------------------------------------------------------------------

export const OBJECT_ED3 = {
  _id: 1245184,
  name: 'ED3',
  errorStatus: '0x0000',
  ID_Logger_tore: [851979, 0, 0, 851982, 0, 851988, 851990, 851984],
  ID_Logger_tore_neg: [851987, 851980, 851981, 0, 851983, 851985, 851991, 0],
  ConsoTore: [50, 50, 20, 50, 50, 20, 20, 20],
  ToreName: [
    'T1-EDF',
    'T2-Maison',
    'T3-Piscine',
    'T4-Load',
    'T5-Grid',
    'T6-Solaire',
    'T7-Batterie +',
    'T8-Batterie -',
  ],
  ID_Logger_pulse: [851993, 851994, 851996, 851997],
  ConsoPulse: [1000, 1, 1000000, 1],
  PulseName: ['Eau', 'Pulse 2', 'Tri', 'Pulse 4'],
  RelayName: ['Relay 1', 'Relay 2'],
  RelayMemoryMode: true,
  refPowerFactor: 0,
  Relay_state: [false, false],
  Relay_command: [false, false],
  Pulse_state: [false, false, false, false],
  Pulse_cpt: [0, 0, 0, 0],
  Pulse_inst: [0, 0, 0, 0],
  Pulse_conso: [0, 0, 0, 0],
  powerFactor: 66.65819,
  cosphi: [93.94736, 5.895676, 0, 0, 5.707409, 0, 52.18113, 53.8461],
  irms: ['6580', '-947', '0', '0', '-939', '0', '-519', '-528'],
  conso: [0, 0, 0, 0, 0, 0, 0, 857],
  puissance: [1455467, -13160, 0, 0, -12625, 0, -63810, -67039],
  urms: 235.5297,
};

/** Each counter of his and the input feeding it (clamp or pulse, its number, negative). */
export const LINKS = [
  [11, 'clamp', 1, false, 'T1-EDF'],
  [19, 'clamp', 1, true, 'T1-EDF'],
  [12, 'clamp', 2, true, 'T2-Maison'],
  [13, 'clamp', 3, true, 'T3-Piscine'],
  [14, 'clamp', 4, false, 'T4-Load'],
  [15, 'clamp', 5, true, 'T5-Grid'],
  [20, 'clamp', 6, false, 'T6-Solaire'],
  [17, 'clamp', 6, true, 'T6-Solaire'],
  [22, 'clamp', 7, false, 'T7-Batterie +'],
  [23, 'clamp', 7, true, 'T7-Batterie +'],
  [16, 'clamp', 8, false, 'T8-Batterie -'],
  [25, 'pulse', 1, false, 'Eau'],
  [26, 'pulse', 2, false, 'Pulse 2'],
  [28, 'pulse', 3, false, 'Tri'],
  [29, 'pulse', 4, false, 'Pulse 4'],
];
