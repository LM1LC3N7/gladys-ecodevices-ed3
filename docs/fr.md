# Eco-Devices 3 pour Gladys

Amène dans Gladys **jusqu’à trois Eco-Devices 3 (ED3) de GCE Electronics**
par leur API HTTP locale : leurs compteurs (téléinfo, consommation,
production, injection, stockage, eau, gaz), la puissance de leurs tores, la
tension secteur, leurs deux relais, les sorties de leurs extensions X-8R et
leurs capteurs X-THL (température, humidité, luminosité).

> Jamais testé avec un vrai appareil : écrit d’après la documentation de
> l’API ED3 de GCE (Postman « API ED3 », liée depuis l’ED3) et les outils
> libres de cce66 (Api-Deck et Mqtt-Deck ED3). Dites-nous ce que vous voyez
> sur le vôtre. Sans lien avec GCE Electronics.

## Installation

1. Dans l’ED3, menu Configuration : définissez une **clé API** et notez-la.
2. Dans Gladys, Intégrations > Eco-Devices 3 : saisissez l’adresse de l’ED3
   (par ex. `192.168.1.60`, avec `:port` seulement si vous avez changé celui
   de son serveur web ; donnez-lui une adresse fixe dans votre box) et la
   clé API. Sur la même page, listez dans « Relais pilotables par Gladys »
   les relais que Gladys doit piloter, et eux seulement (`R1`, `R2` ; voir
   « Relais » plus bas : jamais une pompe, une VMC, une gâche…). Puis
   enregistrez.
3. « Tester la connexion » lit l’ED3 tout de suite (une fois un intervalle
   passé depuis la dernière lecture) et montre ce qu’il a trouvé.
4. Dans Découverte, créez les appareils voulus. Un relais listé arrive en
   interrupteur (ou en lumière) ; les autres arrivent **en lecture seule**
   (« État (lecture seule) ») : Gladys montre leur état, rien ne peut les
   commuter.

Un relais listé **après** sa création reste en lecture seule jusqu’à ce que
vous cliquiez **« Mettre à jour »** sur lui dans Découverte : il reçoit alors
son interrupteur (ou sa lumière), à côté de son « État (lecture seule) »,
qui reste. L’état de l’intégration dit combien de relais sont en lecture
seule tant qu’aucun n’est listé, et quels relais listés attendent encore
« Mettre à jour ».

L’ED3 veut la clé API dans l’adresse de chaque requête, en http simple : qui
peut écouter votre réseau local peut la lire, comme avec la page de l’ED3
elle-même. La clé est gardée par Gladys dans sa base, jamais réaffichée,
envoyée seulement à l’ED3, et jamais écrite dans les journaux ni dans les
fichiers de l’intégration.

Si l’adresse répond comme un autre boîtier GCE (un IPX800 V5, un IPX800 V4
ou un Eco-Devices RT2), l’état et « Tester la connexion » le disent : aucune
valeur n’est publiée et aucune commande n’est envoyée, pas même une
extinction, et les extinctions gardées sont abandonnées. Utilisez
l’intégration de ce boîtier.

## Ce que vous obtenez

| Sur l’ED3                                | Dans Gladys                                                      | Code (dans le nom) |
| ---------------------------------------- | ---------------------------------------------------------------- | ------------------ |
| Relais 1 et 2                            | lecture seule, ou interrupteur / lumière si vous le listez       | `R1`, `R2`         |
| Sortie d’un X-8R                         | lecture seule (état)                                             | `X8R4259840-3`     |
| Compteur 0 (total téléinfo), 11 à 18 (¹) | index de consommation (kWh), compté par Gladys (énergie et coût) | `C0`, `C11`        |
| Compteurs 20 et 21 (production) (¹)      | index de production (kWh), compté par Gladys                     | `C20`              |
| Compteur 19 (injection) (¹)              | index d’énergie injectée sur le réseau (kWh), affiché seulement  | `C19`              |
| Compteurs 1 à 10 (tarifs téléinfo)       | capteur simple « Index du tarif (kWh) », pas compté deux fois    | `C1`               |
| Compteurs 22 à 24 (stockage) (¹)         | capteur simple « Index de stockage (kWh) »                       | `C22`              |
| Compteurs 25 à 27 (eau), 28 et 29 (gaz)  | volume (m³), hors suivi d’énergie                                | `C25`, `C28`       |
| Tore relié à un compteur                 | puissance (W)                                                    | `T1`               |
| Tension d’alimentation                   | tension (V)                                                      | `U`                |
| X-THL                                    | température (°C), humidité (%), luminosité (lux)                 | `XTHL4325376`      |

Les numéros des compteurs sont ceux de l’ED3 (GCE les attribue par
catégorie). Les noms que vous leur avez donnés sur l’ED3 sont repris dans
Découverte (relus toutes les 10 minutes) ; un nom changé ensuite sur l’ED3
ne renomme pas un appareil déjà créé. Un compteur à 0 (pas configuré, ou pas
encore lu par l’ED3) n’est pas proposé ; un tore sans compteur non plus.

(¹) **Un compteur alimenté par un tore n’est pas proposé dans cette version**
(ceux que l’ED3 relie à un tore dans `ID_Logger_tore` ; sans cette liste,
tous les compteurs 11 à 24) : l’unité de son index n’est pas confirmée (Wh
selon GCE, mais l’exemple de GCE lui-même fait penser à des mWh, ce qui
donnerait des valeurs 1000 fois trop grandes). La puissance du tore, elle,
est confirmée (mW, publiée en W). Il le sera une fois l’unité vérifiée sur
un vrai ED3.

L’ED3 est lu toutes les 15 secondes par défaut (10 s au moins). Une valeur
que l’ED3 ne donne pas (absente, un texte, hors plage, une tension de 0 V)
n’est pas publiée : jamais comme 0. Un X-THL en défaut de mesure (`ioFault`)
ne publie rien tant qu’il le reste, et l’état le nomme. Un X-8R ou un X-THL
sans code d’extension (objet créé, rien d’appairé) n’est pas proposé.

## Compteurs : index à vie, jamais 0, une baisse ou un saut retenu

L’index d’un compteur est un compteur à vie : Gladys en tire la consommation
(et son coût) et la production ; l’index d’injection est affiché, Gladys ne
calcule rien dessus. L’intégration le passe par un garde-fou :

- un index à 0 n’est jamais envoyé ;
- un index qui baisse, ou qui monte plus que ce que la maison peut tirer
  (100 kW en électricité, 10 m³/h d’eau, 16 m³/h de gaz, plus une petite
  marge), est **retenu** : la dernière valeur acceptée est renvoyée, l’état
  le dit (« Index retenu : C11 (↑ 4072.301 → 14072.301 kWh) »), et il reste
  retenu au redémarrage. Ni le temps ni la répétition ne le font accepter ;
- seulement s’il est juste (index remis à zéro sur l’ED3), cliquez **deux
  fois « Accepter l’index retenu »**. **Gladys compte un saut accepté en
  entier, d’un coup** (consommation et coût) ; une baisse acceptée est
  publiée et rien n’est compté pour elle. Après « Rattacher les appareils »
  vers un autre ED3 dont l’index est plus haut, n’acceptez pas : supprimez
  puis recréez l’appareil du compteur (son historique repart de zéro). Le
  premier clic liste les
  valeurs retenues et ne prend rien ; le second, de 3 secondes à 5 minutes
  plus tard, prend exactement ces valeurs (plus ce que le compteur a pu
  mesurer entre les clics), pour chaque compteur dont la valeur retenue n’a
  pas changé autrement. Enregistrer la configuration n’accepte jamais ;
- l’état du garde-fou est écrit dans `/data` **avant** que Gladys reçoive
  l’index : si `/data` ne peut pas être écrit ou lu (ou ne répond pas en
  5 s), aucun index ne part, et l’état le dit ;
- un index part une fois par minute au plus.

Le garde-fou compte le temps sur l’horloge de la session (l’heure murale au
démarrage, puis le temps écoulé) : une heure système qui saute n’élargit pas
sa marge. Un appareil de compteur supprimé puis recréé repart de la valeur
que Gladys garde pour lui.

## Relais : en lecture seule sauf ceux que vous listez

Un relais que vous ne listez pas est **en lecture seule**. Pour en piloter
un depuis Gladys, listez-le dans « Relais pilotables par Gladys », par ex.
`R1, R2:light` (`:light` en fait une lumière, sinon un interrupteur), de
préférence avant de le créer dans Découverte ; déjà créé, cliquez « Mettre à
jour » sur lui dans Découverte. Un interrupteur ou une lumière obéit à tout
« éteins tout » de Google, Alexa, du MCP et des scènes : n’y mettez jamais
une pompe, un congélateur, une VMC, un chauffage, une gâche ni une vanne.
Seuls R1 et R2 se listent : les sorties X-8R restent en lecture seule dans
cette version. Un relais retiré de la liste repasse aussitôt en lecture
seule : ses commandes sont refusées, et une extinction que l’intégration
tenait encore pour lui est abandonnée (en mémoire et dans `/data`, au
redémarrage aussi). Son interrupteur reste sur l’appareil dans Gladys (sans
effet) : Gladys ne supprime pas une fonctionnalité seule.

Les commandes passent par `GET /api/object/ed3/0/SetOnR/<n>` et
`SetOffR/<n>` (absolues : jamais une bascule).

### Éteindre un relais listé passe avant tout

L’extinction d’un relais listé n’a besoin d’aucune option et passe avant
tout le reste : pendant une pause après des lectures en échec, avec une clé
API refusée, avec la file de commandes pleine, et avant la première lecture
après un redémarrage. Cliquée, elle interrompt toute requête en cours (une
lecture, une relecture, une commande, un renvoi), sauf une autre extinction
cliquée juste avant (interrompue à son tour si elle reste sans réponse
depuis 1 s).

Elle n’est refusée que si : l’adresse ou la clé API manque ; le relais
n’est pas listé, ou n’est pas R1 ou R2 ; la valeur n’est pas 0 ou 1 ; l’ED3
lu n’est pas celui de l’appareil, ou rien ne permet de le savoir (voir
« Chaque ED3 garde ses appareils ») ; l’adresse répond comme un autre
boîtier GCE ; l’emplacement contient le même ED3 qu’un emplacement
précédent (voir « Plusieurs ED3 »). Cliquée avant que la configuration soit
lue dans Gladys (la clé API n’est gardée que là, jamais dans `/data`), elle
la demande aussitôt à Gladys et attend 3 s ; si elle n’est pas venue, elle
est gardée en mémoire et envoyée dès que la clé est connue, avant tout envoi
vers Gladys ; si le relais s’avère non listé, l’état le dit. Quand l’ED3 ne
la prend pas dans les 3,5 s (pas de connexion), elle est gardée (dans
`/data`) et renvoyée dès que l’ED3 est libre, avant les relectures, par les
lectures suivantes qui montrent le relais allumé, et après un redémarrage.

Une extinction que les lectures ne montrent pas est renvoyée, 3 fois au
plus ; puis l’état le dit (vérifiez sur place). Elle reste tenue jusqu’à ce
qu’une commande plus récente sur ce relais parte (votre clic), ou, une fois
appliquée, un autre état lu deux fois de suite (changé sur l’ED3 lui-même,
par ses scénarios ou sa page) : jamais par le temps. Un allumage demandé
avant l’extinction et pas encore envoyé est annulé : rien ne part après
elle. Un allumage envoyé avant l’extinction et resté sans réponse, si l’ED3
l’applique quand même dans les 5 s après son départ, n’est pas un changement
sur l’ED3 : l’extinction est renvoyée.

## Commandes

Une commande est écrite dans les 3,5 s du clic ou refusée avec « rien n’a été
envoyé ». Elle est ensuite relue sur l’ED3 : la valeur demandée est un
succès ; l’état d’avant est « pas encore appliquée » ; pas de réponse à
temps donne « envoyée, sans confirmation ». Deux lectures suivent, 5 s et
20 s après. Les commandes d’une scène sont écrites l’une après l’autre, puis
relues une fois. Une seule requête à la fois vers l’ED3.

## Plusieurs ED3

Gardez le premier dans les champs du haut, et mettez le deuxième dans
**« Eco-Devices 3 n°2 »** (adresse, clé API, ses relais pilotables), un
troisième dans « Eco-Devices 3 n°3 ». Chacun a ses propres appareils dans
Découverte (« ED3 n°2 · Relais 1 (R1) »), sa liste de relais pilotables et
son état sur sa ligne. L’intervalle de lecture et la langue sont communs ;
« Accepter l’index retenu » vaut pour tous.

**Ne changez pas un emplacement d’ED3 pour en essayer un autre** : les
appareils déjà créés restent avec leur emplacement.

**Un ED3 ne va que dans un emplacement** : ses compteurs seraient comptés
deux fois. Un emplacement dont l’adresse est celle d’un emplacement
précédent n’est pas lu ; un emplacement qui lit le même ED3 qu’un
emplacement précédent (même adresse MAC, par ex. son IP ici et son nom
là) n’est pas utilisé, relu toutes les 5 minutes seulement. Dans les deux
cas, rien n’est publié pour lui, aucune commande n’en part (pas même une
extinction : les appareils de l’emplacement précédent pilotent ce même
ED3), et l’état le dit.

## Chaque ED3 garde ses appareils

Un appareil créé pour un ED3 ne reçoit jamais les valeurs d’un autre ED3 et
ne commande jamais ses relais, même si vous changez l’adresse de son
emplacement (sauf la limite ci-dessous, sans adresse MAC). L’intégration retient, dans `/data`, à quel ED3 appartiennent
les appareils de chaque emplacement :

- par son **adresse MAC** si `GET /api/system/info` en donne une (relue à
  chaque lecture, gardée sous forme d’empreinte salée, jamais en clair) ;
- sinon par son **adresse et son port**. **Limite** : l’API de l’ED3 ne
  documente pas d’adresse MAC ; s’il n’en donne pas, un autre ED3 mis à la
  même adresse ne se distingue pas du vôtre, et un changement d’adresse
  demande « Rattacher les appareils ».

Si l’ED3 lu n’est pas le leur, alors : aucune commande ne part vers lui, pas
même une extinction ; les extinctions gardées pour l’ancien sont
abandonnées ; aucune de ses valeurs n’est publiée sur ces appareils ; la
Découverte est vide pour cet emplacement ; l’état le dit.

Remettez alors l’adresse de leur ED3. Si vous l’avez **remplacé** (ou s’il
a changé d’adresse sans adresse MAC lisible), cliquez **deux fois
« Rattacher les appareils »** (dans la minute), en choisissant
l’emplacement : ses valeurs vont alors à ces appareils et ses relais listés
leur obéissent. Les index restent gardés : un nouvel ED3 dont les compteurs
diffèrent voit ses index retenus jusqu’à ce que vous les acceptiez. Un
emplacement sans aucun appareil créé prend simplement l’ED3 qu’il lit.

Quand l’adresse MAC d’un ED3 qui en donnait une ne peut pas être lue,
seules les extinctions partent, et seulement vers l’adresse où il a été
vérifié en dernier ; si elle reste illisible, « Rattacher les appareils »
(deux clics) le rattache par son adresse. Au démarrage, et après une lecture en échec, son adresse
MAC est relue avant tout envoi : les extinctions gardées partent après cette
vérification, et une extinction cliquée l’attend 1,5 s au plus, puis part
vers l’adresse où il a été vérifié en dernier.

Si `/data` ne peut pas être lu, ou s’il est vide alors que des appareils
existent et ne peut pas être écrit (un volume en lecture seule, par ex.),
on ne sait pas à quel ED3 appartiennent les appareils : seules les
extinctions partent, vers l’adresse saisie ; rien n’est publié, « Rattacher
les appareils » est refusé, et l’état le dit. Une lecture ou une écriture de
`/data` qui ne répond pas en 5 s compte comme un échec : elle ne retient ni
les lectures ni les commandes.

## Pauses et refus

Une lecture en échec met en pause 10 s, 30 s, 1 min, 2 min puis 5 min (une
minute au moins quand l’ED3 répond 429 ou 503), pause gardée au
redémarrage ; l’allumage d’un relais est refusé jusqu’à la fin de la pause.
Une clé API refusée par l’ED3 (401, 403 sur sa lecture principale) arrête
les lectures jusqu’à ce que vous changiez la clé ou que « Tester la
connexion » aboutisse. Une lecture secondaire en échec (compteurs, noms,
X-8R, X-THL, `system/info`), même en 401, n’arrête rien : ce qu’elle donnait
reste connu, sans valeur, et l’état le dit. Tant qu’un ED3 ne peut pas être
lu (ou refuse la clé), ses appareils quittent la Découverte ; un Scan ne les y
remet pas. Ils reviennent à la première lecture réussie.

## Limites

- Relais R1 et R2, compteurs, tores, tension, X-8R (lecture seule) et
  X-THL ; pas la trame téléinfo détaillée (puissance apparente, tarif en
  cours), les entrées impulsions, les commandes X-8R, les plannings, les
  variables virtuelles ni le Modbus dans cette version.
- Le signe de la puissance d’un tore qui mesure une production n’est pas
  documenté : la puissance est publiée telle que l’ED3 la donne (en W).
- L’intégration lit l’API HTTP locale, pas le MQTT de l’ED3.
- Trois ED3 au plus par intégration.
- http seulement (l’ED3 répond en http sur le réseau local).
