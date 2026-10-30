// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, device and feature names,
// refusals of a command), in English and French.
// -----------------------------------------------------------------------------

import { COUNTER_KINDS as CK, FEATURES as F, KINDS } from './constants.js';

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

export const both = (en, fr) => ({ en, fr });

/** Several messages one after the other, in each language. */
export const join = (...messages) => {
  const parts = messages.filter(Boolean);
  return both(parts.map((m) => m.en).join(' '), parts.map((m) => m.fr).join(' '));
};

/** "45 s" / "25 min" / "3 h", for the waits. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

/** Lists the first 5 entries, then "and N more". */
export function listOf(entries) {
  const shown = entries.slice(0, 5);
  const more = entries.length - shown.length;
  return both(
    shown.join(', ') + (more > 0 ? ` and ${more} more` : ''),
    shown.join(', ') + (more > 0 ? ` et ${more} autre(s)` : ''),
  );
}

/** A value as the user reads it (a relay). */
export function describe(kind, value) {
  if (value === undefined) return both('unknown', 'inconnu');
  return value === 1 ? both('on', 'allumé') : both('off', 'éteint');
}

export const FEATURE_NAMES = {
  // Right in both states: a relay listed later keeps this feature next to its switch, under
  // the name it was created with (Gladys never renames it, and it cannot be deleted alone).
  // What to do lives in the status and the guide.
  [F.READONLY]: both('State (read only)', 'État (lecture seule)'),
  [F.SWITCH]: both('Switch', 'Interrupteur'),
  [F.LIGHT]: both('Light', 'Lumière'),
  [F.TEMPERATURE]: both('Temperature', 'Température'),
  [F.HUMIDITY]: both('Humidity', 'Humidité'),
  [F.LUMINOSITY]: both('Luminosity', 'Luminosité'),
  [F.POWER]: both('Power', 'Puissance'),
  [F.VOLTAGE]: both('Voltage', 'Tension'),
};

/** The name of the index feature of a counter (the unit in it for a plain sensor). */
export function indexName(counter) {
  switch (counter) {
    case CK.TIC_TARIFF:
      return both('Tariff index (kWh)', 'Index du tarif (kWh)');
    case CK.STORAGE:
      return both('Storage index (kWh)', 'Index de stockage (kWh)');
    case CK.INJECTION:
      return both('Injection index', 'Index d’injection');
    case CK.PRODUCTION:
      return both('Production index', 'Index de production');
    default:
      return both('Index', 'Index');
  }
}

const COUNTER_NAMES = {
  [CK.TIC_TOTAL]: both('Teleinfo total', 'Total téléinfo'),
  [CK.TIC_TARIFF]: both('Teleinfo tariff', 'Tarif téléinfo'),
  [CK.CONSUMPTION]: both('Consumption', 'Consommation'),
  [CK.INJECTION]: both('Injection', 'Injection'),
  [CK.PRODUCTION]: both('Production', 'Production'),
  [CK.STORAGE]: both('Storage', 'Stockage'),
  [CK.WATER]: both('Water', 'Eau'),
  [CK.GAS]: both('Gas', 'Gaz'),
};

/** The code as the user reads it: `R1`, `X8R4259840-3`, `C11`, `T2`. */
export const shownCode = (code) => (code === 'mains' ? 'U' : code.toUpperCase());

/** The name of a target in Gladys: "Relay 1 (R1)", "Garage relay 2 (X8R12-2)", "Counter 11 · Kitchen (C11)". */
export function targetName(target) {
  const code = shownCode(target.code);
  const ext = target.extName ? `${target.extName} ` : '';
  const named = (en, fr) =>
    target.name ? both(`${target.name} (${code})`, `${target.name} (${code})`) : both(en, fr);
  switch (target.kind) {
    case KINDS.RELAY:
      return target.ext !== undefined
        ? both(`${ext}relay ${target.n} (${code})`, `${ext}relais ${target.n} (${code})`)
        : named(`Relay ${target.n} (${code})`, `Relais ${target.n} (${code})`);
    case KINDS.COUNTER: {
      const kind = COUNTER_NAMES[target.counter] ?? both('Counter', 'Compteur');
      return target.name
        ? both(`${target.name} · ${kind.en} (${code})`, `${target.name} · ${kind.fr} (${code})`)
        : both(`${kind.en} ${target.n} (${code})`, `${kind.fr} ${target.n} (${code})`);
    }
    case KINDS.CLAMP:
      return named(`Clamp ${target.n} (${code})`, `Tore ${target.n} (${code})`);
    case KINDS.MAINS:
      return both('Mains voltage', 'Tension secteur');
    default:
      return both(
        `${target.extName ?? 'X-THL'} (${code})`,
        `${target.extName ?? 'X-THL'} (${code})`,
      );
  }
}

/** "ED3 #2 · Relay 1 (R1)" for the ED3 n >= 2 of the configuration; the name alone for the first. */
export const slotName = (slot, name) =>
  slot === 1 ? name : both(`ED3 #${slot} · ${name.en}`, `ED3 n°${slot} · ${name.fr}`);

/** The reason of a failure, in each language. */
export function reasonOf(err) {
  const status = err?.status ? ` (HTTP ${err.status})` : '';
  switch (err?.code) {
    case 'network':
      return both(`no connection (${err.message})`, `pas de connexion (${err.message})`);
    case 'timeout':
      return both('no answer in time', 'pas de réponse à temps');
    case 'late':
      return both('no time left to send', 'plus le temps d’envoyer');
    case 'cut':
      return both('interrupted', 'interrompue');
    case 'refused':
      return both(`API key refused${status}`, `clé d’API refusée${status}`);
    case 'busy':
      return both(`the ED3 asks to wait${status}`, `l’ED3 demande d’attendre${status}`);
    case 'http':
      return both(`unexpected answer${status}`, `réponse inattendue${status}`);
    case 'size':
      return both('answer too large', 'réponse trop grande');
    case 'bad_response':
      return both(
        'an answer that is not an Eco-Devices 3’s (not JSON, or another device)',
        'une réponse qui n’est pas celle d’un Eco-Devices 3 (pas du JSON, ou un autre appareil)',
      );
    default:
      return both('internal error', 'erreur interne');
  }
}

const OTHER_DEVICES = {
  ipx800v5: both('an IPX800 V5', 'un IPX800 V5'),
  xdevices: both('an IPX800 V4 or an Eco-Devices RT2', 'un IPX800 V4 ou un Eco-Devices RT2'),
};

/** One line per counter held: "C11 (jump 1,234.5 → 9,999.0 kWh)". */
export function heldList(entries) {
  return listOf(
    entries.map(
      (h) =>
        `${shownCode(h.code)} (${h.direction === 'up' ? '↑' : '↓'} ${h.from} → ${h.to} ${h.unit})`,
    ),
  );
}

export const T = {
  noConfig: both(
    'Enter the address and the API key of the Eco-Devices 3.',
    'Saisissez l’adresse et la clé d’API de l’Eco-Devices 3.',
  ),
  addressPath: both(
    'The address must be an IP address or a name, without path nor key (e.g. 192.168.1.60).',
    'L’adresse doit être une adresse IP ou un nom, sans chemin ni clé (par ex. 192.168.1.60).',
  ),
  addressHttps: both(
    'The Eco-Devices 3 is reached over http on your network: remove "https://".',
    'L’Eco-Devices 3 se joint en http sur votre réseau : retirez « https:// ».',
  ),
  addressInvalid: both('The address is not valid.', 'L’adresse n’est pas valide.'),
  apiKeyInvalid: both(
    'The API key is not valid (letters, digits and symbols, no space, 128 characters at most).',
    'La clé d’API n’est pas valide (lettres, chiffres et symboles, sans espace, 128 caractères au plus).',
  ),
  connecting: both('Connecting to the Eco-Devices 3…', 'Connexion à l’Eco-Devices 3…'),
  configNotRead: (wait) =>
    both(
      `The configuration could not be read from Gladys: new try in ${wait.en}.`,
      `La configuration n’a pas pu être lue dans Gladys : nouvel essai dans ${wait.fr}.`,
    ),
  connected: (counts) => {
    const parts = (lang) =>
      [
        [counts.relays, 'relay(s)', 'relais'],
        [counts.counters, 'counter(s)', 'compteur(s)'],
        [counts.clamps, 'clamp(s)', 'tore(s)'],
        [counts.thl, 'X-THL', 'X-THL'],
      ]
        .filter(([n]) => n > 0)
        .map(([n, en, fr]) => `${n} ${lang === 'en' ? en : fr}`)
        .join(', ');
    return both(
      `Connected to the Eco-Devices 3: ${parts('en') || 'nothing found'}.`,
      `Connecté à l’Eco-Devices 3 : ${parts('fr') || 'rien trouvé'}.`,
    );
  },
  unreachable: (reason, wait) =>
    both(
      `The Eco-Devices 3 could not be read (${reason.en}): new try in ${wait.en}.`,
      `L’Eco-Devices 3 n’a pas pu être lu (${reason.fr}) : nouvel essai dans ${wait.fr}.`,
    ),
  refused: both(
    'The Eco-Devices 3 refused the API key: no read until the key changes or "Test the connection" succeeds.',
    'L’Eco-Devices 3 a refusé la clé d’API : plus de lecture tant que la clé ne change pas ou que « Tester la connexion » n’aboutit pas.',
  ),
  relayErrors: (list) =>
    both(
      `Relays not understood (R1 and R2 only): ${list.en}.`,
      `Relais non compris (R1 et R2 seulement) : ${list.fr}.`,
    ),
  relaysReadOnly: (count) =>
    count === 1
      ? both(
          '1 relay read only: list it in Configuration → Relays Gladys may drive only if Gladys must drive it (never a pump, a ventilation, a door strike…).',
          '1 relais en lecture seule : listez-le dans Configuration → Relais pilotables par Gladys seulement si Gladys doit le piloter (jamais une pompe, une VMC, une gâche…).',
        )
      : both(
          `${count} relays read only: list in Configuration → Relays Gladys may drive those Gladys must drive (R1, R2; never a pump, a ventilation, a door strike…).`,
          `${count} relais en lecture seule : listez dans Configuration → Relais pilotables par Gladys ceux que Gladys doit piloter (R1, R2 ; jamais une pompe, une VMC, une gâche…).`,
        ),
  relaysToUpdate: (list) =>
    both(
      `Relays listed, waiting for "Update" in Discover to be driven: ${list.en}.`,
      `Relais listés, en attente de « Mettre à jour » dans Découverte pour être pilotés : ${list.fr}.`,
    ),
  thlFault: (list) =>
    both(
      `X-THL reporting a measurement fault, values not published: ${list.en}.`,
      `X-THL en défaut de mesure, valeurs non publiées : ${list.fr}.`,
    ),
  typesUnread: (list) =>
    both(
      `Not read this time (the previous ones are kept, without value): ${list.en}.`,
      `Non lus cette fois (les précédents sont gardés, sans valeur) : ${list.fr}.`,
    ),
  guardsPending: (list) =>
    both(
      `Switch-off not applied yet, sent again: ${list.en}.`,
      `Extinction pas encore appliquée, renvoyée : ${list.fr}.`,
    ),
  guardsFailed: (list) =>
    both(
      `Switch-off not applied after 3 tries, check on site: ${list.en}.`,
      `Extinction non appliquée après 3 essais, vérifiez sur place : ${list.fr}.`,
    ),
  notApplied: (list) =>
    both(
      `Last command not applied (read back differs): ${list.en}.`,
      `Dernière commande non appliquée (la relecture diffère) : ${list.fr}.`,
    ),
  pendingDropped: (list) =>
    both(
      `Switch-off clicked before the configuration was read, not sent (relay not listed or another Eco-Devices 3): ${list.en}.`,
      `Extinction cliquée avant la lecture de la configuration, non envoyée (relais non listé ou autre Eco-Devices 3) : ${list.fr}.`,
    ),
  clampCounters: (list) =>
    both(
      `${list.en} (fed by a clamp): not offered until their unit is confirmed.`,
      `${list.fr} (alimentés par un tore) : non proposés tant que leur unité n’est pas confirmée.`,
    ),
  indexHeld: (list) =>
    both(
      `Index held back (a jump or a drop, not sent to Gladys): ${list.en}. Only if it is right (a counter reset on the ED3), click "Accept the held index" twice: an accepted jump is counted in full by Gladys, at once.`,
      `Index retenu (un saut ou une baisse, non envoyé à Gladys) : ${list.fr}. Seulement s’il est juste (compteur remis à zéro sur l’ED3), cliquez deux fois « Accepter l’index retenu » : un saut accepté est compté en entier par Gladys, d’un coup.`,
    ),
  storeProblem: both(
    'The state cannot be written to /data: no counter index is sent to Gladys until it can.',
    'L’état ne peut pas être écrit dans /data : aucun index de compteur n’est envoyé à Gladys tant que c’est le cas.',
  ),
  otherDeviceReason: (other) =>
    both(`it answers as ${OTHER_DEVICES[other].en}`, `il répond comme ${OTHER_DEVICES[other].fr}`),
  otherDevice: (other) =>
    both(
      `This address answers as ${OTHER_DEVICES[other].en}, not an Eco-Devices 3: use the integration of that box (no value is published nor any command sent, a switch-off neither, meanwhile).`,
      `Cette adresse répond comme ${OTHER_DEVICES[other].fr}, pas un Eco-Devices 3 : utilisez l’intégration de ce boîtier (aucune valeur publiée ni commande envoyée, pas même une extinction, d’ici là).`,
    ),
  duplicateSlot: (other, byMac = false) =>
    both(
      `${byMac ? 'The same Eco-Devices 3 (same MAC address)' : 'Same address'} as ED3 #${other}: an ED3 goes in one slot only (its counters would be counted twice). This one is not used, no command is sent from it; empty its address.`,
      `${byMac ? 'Le même Eco-Devices 3 (même adresse MAC)' : 'Même adresse'} que l’ED3 n°${other} : un ED3 ne va que dans un emplacement (ses compteurs seraient comptés deux fois). Celui-ci n’est pas utilisé, aucune commande n’en part ; videz son adresse.`,
    ),
  ownerUnwritable: both(
    'The state cannot be written to /data and holds nothing yet: which Eco-Devices 3 the devices belong to is unknown. Only switch-offs are sent, to the address typed, until /data can be written.',
    'L’état ne peut pas être écrit dans /data, qui ne contient encore rien : on ne sait pas à quel Eco-Devices 3 appartiennent les appareils. Seules les extinctions sont envoyées, à l’adresse saisie, tant que /data ne peut pas être écrit.',
  ),
  identityUnreadable: both(
    'Its MAC address could not be read this time: only switch-offs are sent until it is.',
    'Son adresse MAC n’a pas pu être lue cette fois : seules les extinctions sont envoyées d’ici là.',
  ),
  identityUnreadableNew: both(
    'At this new address, its MAC address could not be read: nothing is sent to the devices until it is.',
    'À cette nouvelle adresse, son adresse MAC n’a pas pu être lue : rien n’est envoyé aux appareils d’ici là.',
  ),
  otherEd3: (slot, label) => {
    const mac = label ? ` (MAC …${label})` : '';
    return both(
      `The Eco-Devices 3${mac} at this address is not the one the devices of ED3 #${slot} were created for: none of their values is published nor commands sent, and their switch-offs kept are dropped. Put back the address of their ED3 (another ED3 goes in its own slot, see the guide), or, if you replaced it, click "Attach the devices" twice.`,
      `L’Eco-Devices 3${mac} à cette adresse n’est pas celui pour lequel les appareils de l’ED3 n°${slot} ont été créés : aucune de leurs valeurs n’est publiée ni commande envoyée, et leurs extinctions gardées sont abandonnées. Remettez l’adresse de leur ED3 (un autre ED3 va dans son propre emplacement, voir le guide), ou, si vous l’avez remplacé, cliquez deux fois « Rattacher les appareils ».`,
    );
  },
  notAttached: (slot) =>
    both(
      `The devices of ED3 #${slot} are not known to belong to the Eco-Devices 3 read (the state in /data was lost, or restored without it): none of their values is published, only switch-offs are sent, to the address typed. If they are its own, click "Attach the devices" twice.`,
      `Rien ne dit que les appareils de l’ED3 n°${slot} appartiennent à l’Eco-Devices 3 lu (l’état de /data a été perdu, ou restauré sans lui) : aucune de leurs valeurs n’est publiée, seules les extinctions sont envoyées, à l’adresse saisie. Si ce sont les siens, cliquez deux fois « Rattacher les appareils ».`,
    ),
  ownerUnreadable: both(
    'The state in /data cannot be read: which Eco-Devices 3 the devices belong to is unknown, only switch-offs are sent until it can.',
    'L’état de /data ne peut pas être lu : on ne sait pas à quel Eco-Devices 3 appartiennent les appareils, seules les extinctions sont envoyées d’ici là.',
  ),
  attach: {
    notRead: both(
      'No Eco-Devices 3 read right now: click "Test the connection" first.',
      'Aucun Eco-Devices 3 lu en ce moment : cliquez d’abord « Tester la connexion ».',
    ),
    already: (slot) =>
      both(
        `The devices of ED3 #${slot} already belong to the Eco-Devices 3 read: nothing to do.`,
        `Les appareils de l’ED3 n°${slot} appartiennent déjà à l’Eco-Devices 3 lu : rien à faire.`,
      ),
    unreadable: both(
      'The MAC address of this Eco-Devices 3 could not be read: try again after the next read.',
      'L’adresse MAC de cet Eco-Devices 3 n’a pas pu être lue : réessayez après la prochaine lecture.',
    ),
    confirm: (slot, label, count) => {
      const mac = label ? ` (MAC …${label})` : '';
      return both(
        `Click again within a minute to attach the ${count} device(s) of ED3 #${slot} to the Eco-Devices 3${mac} read now: its values go to them, its relays listed in the configuration obey them.`,
        `Cliquez à nouveau dans la minute pour rattacher les ${count} appareil(s) de l’ED3 n°${slot} à l’Eco-Devices 3${mac} lu en ce moment : ses valeurs leur sont publiées, ses relais listés dans la configuration leur obéissent.`,
      );
    },
    confirmAddress: (slot, count, macUnreadable) =>
      both(
        `Click again within a minute to attach the ${count} device(s) of ED3 #${slot} to the Eco-Devices 3 read now, known by its address${macUnreadable ? ' (its MAC address cannot be read)' : ''}: its values go to them, its relays listed in the configuration obey them.`,
        `Cliquez à nouveau dans la minute pour rattacher les ${count} appareil(s) de l’ED3 n°${slot} à l’Eco-Devices 3 lu en ce moment, reconnu par son adresse${macUnreadable ? ' (son adresse MAC ne peut pas être lue)' : ''} : ses valeurs leur sont publiées, ses relais listés dans la configuration leur obéissent.`,
      ),
    done: (slot, count) =>
      both(
        `Done: the ${count} device(s) of ED3 #${slot} belong to the Eco-Devices 3 read.`,
        `C’est fait : les ${count} appareil(s) de l’ED3 n°${slot} appartiennent à l’Eco-Devices 3 lu.`,
      ),
    noSlot: both(
      'Choose an Eco-Devices 3 of the configuration.',
      'Choisissez un Eco-Devices 3 de la configuration.',
    ),
  },
  accept: {
    nothing: both(
      'No index is held back: nothing to accept.',
      'Aucun index n’est retenu : rien à accepter.',
    ),
    unreadable: both(
      'The state in /data cannot be read or written: nothing accepted.',
      'L’état de /data ne peut être ni lu ni écrit : rien n’est accepté.',
    ),
    confirm: (list) =>
      both(
        `Held back: ${list.en}. Click again between 3 s and 5 min from now to accept exactly these values (nothing is accepted yet).`,
        `Retenus : ${list.fr}. Cliquez à nouveau entre 3 s et 5 min à partir de maintenant pour accepter exactement ces valeurs (rien n’est encore accepté).`,
      ),
    done: (accepted, changed) =>
      join(
        accepted.length > 0
          ? both(
              `Accepted: ${listOf(accepted).en}; sent to Gladys at the next read.`,
              `Accepté : ${listOf(accepted).fr} ; envoyé à Gladys à la prochaine lecture.`,
            )
          : undefined,
        changed.length > 0
          ? both(
              `Changed since the first click, not accepted (click twice again): ${listOf(changed).en}.`,
              `Changé depuis le premier clic, non accepté (cliquez encore deux fois) : ${listOf(changed).fr}.`,
            )
          : undefined,
      ),
  },
  test: {
    busy: both(
      'A read is already running: try again in a moment.',
      'Une lecture est déjà en cours : réessayez dans un instant.',
    ),
    wait: (wait) =>
      both(
        `The Eco-Devices 3 was read less than an interval ago: next read in ${wait.en}.`,
        `L’Eco-Devices 3 a été lu il y a moins d’un intervalle : prochaine lecture dans ${wait.fr}.`,
      ),
    slow: both(
      'The Eco-Devices 3 is slow to answer: see the status in a moment.',
      'L’Eco-Devices 3 tarde à répondre : voyez l’état dans un instant.',
    ),
  },
};

/** The refusals of a command (the message of the error Gladys shows). */
export const ERRORS = {
  readOnly: both(
    'This relay is read only: add it to "Relays Gladys may drive" to drive it (R1, R2). Nothing was sent.',
    'Ce relais est en lecture seule : ajoutez-le à « Relais pilotables par Gladys » pour le piloter (R1, R2). Rien n’a été envoyé.',
  ),
  notCommandable: both(
    'This feature is read only: nothing was sent.',
    'Cette fonctionnalité est en lecture seule : rien n’a été envoyé.',
  ),
  badValue: both(
    'This value is not valid: nothing was sent.',
    'Cette valeur n’est pas valide : rien n’a été envoyé.',
  ),
  configNotLoaded: both(
    'The configuration is not read yet: nothing was sent.',
    'La configuration n’est pas encore lue : rien n’a été envoyé.',
  ),
  noConfig: both(
    'The address or the API key of the Eco-Devices 3 is missing: nothing was sent.',
    'L’adresse ou la clé d’API de l’Eco-Devices 3 manque : rien n’a été envoyé.',
  ),
  unknownTarget: both(
    'This relay is not known on the Eco-Devices 3: nothing was sent.',
    'Ce relais n’est pas connu sur l’Eco-Devices 3 : rien n’a été envoyé.',
  ),
  paused: (reason) =>
    both(
      `The Eco-Devices 3 does not answer (${reason.en}): nothing was sent.`,
      `L’Eco-Devices 3 ne répond pas (${reason.fr}) : rien n’a été envoyé.`,
    ),
  keyRefused: both(
    'The Eco-Devices 3 refused the API key: nothing was sent.',
    'L’Eco-Devices 3 a refusé la clé d’API : rien n’a été envoyé.',
  ),
  stopPending: both(
    'A switch-off is being sent to this relay: nothing was sent.',
    'Une extinction est en cours d’envoi sur ce relais : rien n’a été envoyé.',
  ),
  cancelledByStop: both(
    'Cancelled by a later switch-off: nothing was sent.',
    'Annulée par une extinction plus récente : rien n’a été envoyé.',
  ),
  queueFull: both(
    'Too many commands waiting: nothing was sent.',
    'Trop de commandes en attente : rien n’a été envoyé.',
  ),
  late: (ahead) =>
    ahead > 0
      ? both(
          `The Eco-Devices 3 was too slow (${ahead} command(s) before this one): nothing was sent.`,
          `L’Eco-Devices 3 a été trop lent (${ahead} commande(s) avant celle-ci) : rien n’a été envoyé.`,
        )
      : both(
          'The Eco-Devices 3 was too slow: nothing was sent.',
          'L’Eco-Devices 3 a été trop lent : rien n’a été envoyé.',
        ),
  notSent: (reason) =>
    both(
      `Not sent (${reason.en}): nothing was sent.`,
      `Non envoyée (${reason.fr}) : rien n’a été envoyé.`,
    ),
  cut: both(
    'Interrupted by a switch-off: nothing was sent.',
    'Interrompue par une extinction : rien n’a été envoyé.',
  ),
  unconfirmed: both(
    'Sent, without confirmation: the Eco-Devices 3 is read again in a few seconds.',
    'Envoyée, sans confirmation : l’Eco-Devices 3 est relu dans quelques secondes.',
  ),
  rejected: both(
    'Sent, but the Eco-Devices 3 answered an error: it is read again in a few seconds.',
    'Envoyée, mais l’Eco-Devices 3 a répondu une erreur : il est relu dans quelques secondes.',
  ),
  notApplied: (read, wanted) =>
    both(
      `Sent, but the Eco-Devices 3 reads ${read.en} (asked: ${wanted.en}): not applied yet, read again in a few seconds.`,
      `Envoyée, mais l’Eco-Devices 3 lit ${read.fr} (demandé : ${wanted.fr}) : pas encore appliquée, relue dans quelques secondes.`,
    ),
  otherEd3: (slot) =>
    both(
      `The Eco-Devices 3 at this address is not the one this device was created for (ED3 #${slot}): nothing was sent.`,
      `L’Eco-Devices 3 à cette adresse n’est pas celui pour lequel cet appareil a été créé (ED3 n°${slot}) : rien n’a été envoyé.`,
    ),
  duplicateSlot: (other) =>
    both(
      `This slot holds the same Eco-Devices 3 as ED3 #${other} and is not used: nothing was sent.`,
      `Cet emplacement contient le même Eco-Devices 3 que l’ED3 n°${other} et n’est pas utilisé : rien n’a été envoyé.`,
    ),
  ownerUnknown: both(
    '/data cannot be read or written: which Eco-Devices 3 this device belongs to is unknown, only switch-offs are sent. Nothing was sent.',
    '/data ne peut être ni lu ni écrit : on ne sait pas à quel Eco-Devices 3 appartient cet appareil, seules les extinctions sont envoyées. Rien n’a été envoyé.',
  ),
  otherDevice: (other) =>
    both(
      `This address answers as ${OTHER_DEVICES[other].en}, not an Eco-Devices 3: nothing was sent.`,
      `Cette adresse répond comme ${OTHER_DEVICES[other].fr}, pas un Eco-Devices 3 : rien n’a été envoyé.`,
    ),
  newAddress: (slot) =>
    both(
      `The Eco-Devices 3 at the new address of ED3 #${slot} is not checked yet (its MAC address): nothing was sent.`,
      `L’Eco-Devices 3 à la nouvelle adresse de l’ED3 n°${slot} n’est pas encore vérifié (son adresse MAC) : rien n’a été envoyé.`,
    ),
  identityUnread: both(
    'The MAC address of the Eco-Devices 3 is not read yet: nothing was sent (a switch-off still is).',
    'L’adresse MAC de l’Eco-Devices 3 n’est pas encore lue : rien n’a été envoyé (une extinction l’est quand même).',
  ),
  notAttached: (slot) =>
    both(
      `It is not known that this device belongs to the Eco-Devices 3 read (ED3 #${slot}, see its status): nothing was sent.`,
      `Rien ne dit que cet appareil appartient à l’Eco-Devices 3 lu (ED3 n°${slot}, voir son état) : rien n’a été envoyé.`,
    ),
  saveFailed: both(
    'The state could not be written to /data: nothing was sent.',
    'L’état n’a pas pu être écrit dans /data : rien n’a été envoyé.',
  ),
  keptUntilConfig: both(
    'Not sent yet: the configuration is being read from Gladys; kept and sent as soon as it is read.',
    'Pas encore envoyée : la configuration est en cours de lecture dans Gladys ; gardée et envoyée dès sa lecture.',
  ),
  keptUntilStart: both(
    'Not sent yet: the integration is starting (/data does not answer yet); kept and sent as soon as the start ends (5 s at most).',
    'Pas encore envoyée : l’intégration démarre (/data ne répond pas encore) ; gardée et envoyée dès la fin du démarrage (5 s au plus).',
  ),
  protectiveKept: (reason) =>
    both(
      `Not sent yet (${reason.en}): kept and sent again as soon as the Eco-Devices 3 is free.`,
      `Pas encore envoyée (${reason.fr}) : gardée et renvoyée dès que l’Eco-Devices 3 est libre.`,
    ),
};
