# Un tour à Tours

## Bus locaux hors SMT intégrés — 4 octobre 2026

Reprise après `f724bb6`, en conservant les derniers correctifs de continuité TER.
Les sources collectées dans l’autre conversation sont maintenant raccordées à la carte, aux trajets et aux isochrones : **56 lignes, 1 077 identifiants d’arrêt et 249 profils horaires** (hors réseau Fil Bleu déjà présent).

| Réseau | Lignes ajoutées |
|---|---|
| Azalys / Agglopolys | 29 : A–H, N1/N2 de journée et lignes L régulières |
| MOVE / Territoires Vendômois | A, TGV, partie annuelle sans réservation de M |
| CVL Mobilité | A, incluant sa desserte de Bourgueil / Port-Boulet, sans doublon par EPCI |
| Le Bus Amboise | Nav1 |
| Ogalo | A–D, L1–L7, L10–L12, L14–L17 et navette ZI Clos Bonnet–Chacé |
| Fil Rouge | Château-Renault, horaire actuel jusqu’au 30 octobre 2026 |
| Le Lien Bléré | Navette entre gare, centre-ville, zones d’activité et A85 |
| Le Lien Loches | Deux boucles consécutives du même véhicule |

Les identifiants des réseaux sont séparés : Azalys A ne devient pas Fil Bleu A ; ses navettes N1/N2 ne sont pas les lignes nocturnes Fil Bleu exclues. Chaque motif horaire conserve un vecteur complet d’une vraie course, ses permissions et son sens. MOVE M est contrôlée contre la fiche du 9 septembre 2026 : seules les colonnes annuelles sans réservation sont retenues, sans les cellules scolaires de début de course au retour. La période de référence reste le 5–11 octobre 2026, sans simulation d’une heure de départ exacte.

Paramètres → **Réseaux de bus** : activation de chaque réseau et couleurs par ligne. Désactiver un réseau retire ses trajets du calcul et son dessin ; le choix est conservé localement et dans le lien partagé (`offbus`). Les marges et le multiplicateur d’attente bus s’appliquent à tous les réseaux.

Les nouveaux arrêts dans le SERM sont raccordés au même graphe IGN contracté que le site, avec un maximum de 150 m d’accroche et 650 m de correspondance routière. Les paires historiques et accès manuels de gares sont conservés. Aucun graphe routier supplémentaire n’est chargé.

Préparation reproductible, à partir des archives intactes :

```bash
python3 scripts/prepare_local_bus_gtfs.py
python3 build_data.py --prepare-transfers --output /tmp/tours-new-buses.json
node scripts/prepare_local_bus_transfers.mjs /tmp/tours-new-buses.json
python3 build_data.py
python3 scripts/sync_root_page.py
```

Le mode `--prepare-transfers` exige un fichier intermédiaire séparé ; une publication normale continue de refuser une table piétonne incomplète.

**Lot local préparé :** les services fixes identifiés sont intégrés. Les lignes entièrement sur réservation sont absentes ; les lignes mixtes gardent leurs courses publiques régulières. Les circuits scolaires, nocturnes et saisonniers restent exclus. Les lignes Rémi restent pour le lot régional. Voir [l’état détaillé](data/tours/LOCAL-BUS-INTEGRATION-2026-10-04.md).

Copies des états d’origine dans `archive/tours-before-local-bus-integration-2026-10-04/` et `archive/tours-before-local-network-completion-2026-10-04/`.

## Marche sur voirie réactivée — 4 octobre 2026

La marche directe, l’accès départ→arrêt et arrêt→destination suivent de nouveau le graphe IGN dans le SERM. Les recherches et les raccords de grille sont exécutés dans un **Web Worker**, sans parcourir le gros graphe sur le fil de l’interface. Une seule recherche est envoyée à la fois ; les demandes intermédiaires d’un glissement sont remplacées par la dernière. Les fonds cartographiques, tracés et raccords de grille sont réutilisés. La vitesse et le choix voirie/ligne droite sont réglables dans Paramètres → Marche et dans le lien partagé (`walkspeed`, `walking`).

Le calcul des points sélectionnés conserve les raccords stricts (75 m maximum) et les vrais détours du graphe. **La surface affichée est une approximation distincte** : extension des valeurs du réseau jusqu’à 350 m autour des rues, en ajoutant le coût local de marche ; elle ne crée aucun arc et ne sert pas au temps du point choisi. Les valeurs absentes ou supérieures à la fenêtre affichée sont plafonnées au-dessus des seuils pour dessiner des intersections finies, plutôt que supprimer des morceaux de contour. Les couleurs sont interpolées. Une isochrone peut comporter plusieurs îlots accessibles légitimes ; elle ne garantit pas un accès privé, une parcelle ou un franchissement depuis tout pixel coloré.

Pendant un déplacement, les recherches sont limitées au plus grand seuil affiché + 15 min ; elles sont complétées au relâchement pour les temps au-delà. La carte se recalcule pendant le glissement et le pointeur ne doit pas attendre le Worker. Un résultat peut avoir quelques dizaines de millisecondes de retard sur le point pendant son calcul. Hors couverture, les portions géométriques sont signalées. Au premier chargement, un aperçu en ligne droite reste visible avec la mention de préparation, puis est remplacé par le calcul sur voirie ; une erreur de chargement est signalée explicitement.

Validation : tests de routage/transferts/bus existants, 7 999 cellules de surface finies, **aucune extrémité isolée de contour à l’intérieur de la couverture** dans le viewport testé, file de calcul coalescée, détour Jumeaux conservé (~594 m, ~7,42 min à 4,8 km/h). Mesures Node de la nouvelle surface 100×80 : premier calcul ~410–531 ms ; déplacements suivants ~37–74 ms, hors dessin/transfert Worker. Aperçus bureau et 390×844 vérifiés ; aucune garantie de performance sur un téléphone physique. Le chargement froid conserve environ 5,6 Mo gzip de voirie supplémentaires, désormais préparés hors du fil de l’interface.

Pour la suite, la marche sur voirie est réactivée, mais garder les contrôles de barrières/accès et de téléphone réel ouverts ; ne pas présenter le raster comme une précision cadastrale. Vélo et bus hors SMT restent des lots séparés.

Carte interactive des trajets estimés en TER, tram, BHNS et bus Fil Bleu, Azalys, MOVE, CVL Mobilité et Le Bus Amboise. Elle s'ouvre sur les 14 EPCI du SERM de Touraine tout en laissant explorer les lignes connectées au-delà. La carte se déplace directement par glisser-déposer ; les anciens boutons « main » et verrouillage de l'arrivée ont été supprimés.

Les isochrones surfaciques restent limités au périmètre SERM. Hors SERM, les gares accessibles sont signalées ponctuellement sans fabriquer de grand halo territorial. Les courbes restent centrées sur le **départ** quand une arrivée est ajoutée. Les limites des 425 communes IGN du SERM sont visibles ; leurs noms apparaissent au zoom rapproché. Les lignes et petits arrêts de bus sont progressivement masqués au dézoom pour préserver la lisibilité, mais restent présents dans le calcul.

Le **tram B et le BHNS C**, prévus pour 2028, sont inclus par défaut dans les temps estimés. L'option « Inclure tram B et BHNS C » permet de les exclure et recalcule les trajets. Les bus Fil Bleu sont issus du GTFS officiel courant ; 56 lignes locales supplémentaires sont intégrées : Azalys (29), MOVE A/TGV/M (3), CVL Mobilité A, Le Bus Amboise Nav1, Ogalo (19), Fil Rouge et Le Lien Bléré/Loches.

L'[audit systémique des bus](BUS-AUDIT-2026-10-03.md) corrige l'import des courses
sur réservation et le mélange des jours/branches dans les attentes. Les services
conditionnels restent visibles, mais sont exclus des estimations régulières ;
leurs temps GTFS de zone ne doivent pas être interprétés comme des déplacements
instantanés. Le détail des 48 lignes et les contrôles sont consignés dans l'audit.

## Lancer le site

```bash
python3 -m http.server 8000 --directory site
```

Ouvrir <http://localhost:8000>. Les données prêtes à afficher sont dans `site/data/commute_map_data.json`. Pour les recalculer hors ligne :

```bash
python3 build_data.py
python3 scripts/sync_root_page.py
```

Les données bus normalisées et le fichier de données du site sont désormais
versionnés avec leurs correspondances piétonnes validées. Le déploiement reconstruit
et teste cet ensemble sans télécharger un GTFS mutable. Actualiser Fil Bleu est
une opération explicite : télécharger le GTFS officiel, exécuter son extraction
ci-dessous, reconstruire et vérifier la couverture de la table piétonne avant de
publier les fichiers obtenus ensemble. Une modification des arrêts peut nécessiter
de régénérer cette table ; ne pas contourner son contrôle de couverture.

### Reprise et performance — 3 octobre 2026

La reprise de `c225f22` confirme que les bus SMT et les correspondances BD TOPO
sont déjà déployés. La reconstruction locale de référence produit exactement le
même fichier que le site public (SHA-256
`e91edbf770cc3fec787f7353b6757515daf67e5386ae9e413ed013248a2baf8c`).
Elle contient 48 lignes de bus Fil Bleu, 1 674 points de transport au total et
334 motifs horaires. Les 338 959 assertions de routage et le test topologique
passent, y compris le franchissement Porte de Loire–Place Choiseul.

Le calcul numérique de la grille utilise maintenant un index spatial des arrêts.
La borne « meilleur temps d'arrivée du groupe + distance minimale au groupe »
permet d'écarter les groupes incapables d'améliorer le résultat, sans limiter
arbitrairement la recherche aux arrêts les plus proches. Les détails d'itinéraire
conservent le parcours précédent pour préserver le choix entre ex æquo.

`node tests/spatial_estimate.test.mjs` vérifie 38 149 destinations/configurations
contre un calcul exhaustif : aucun écart dans le jeu courant. Dans trois passages
sur la même machine, les 29 084 cellules passent de 1 366–1 798 ms à 70–88 ms.
Ces mesures concernent le calcul Node, pas le dessin ni une garantie mobile.

**Reste à faire dans la passation :** contrôles complémentaires des accès/barrières et sur téléphone physique ; vélo et réseaux bus hors SMT.

## Données

- **Limites administratives** : [IGN Admin Express COG CARTO PE, édition 2026](https://geoservices.ign.fr/adminexpress), couches `commune` et `epci` du WFS `ADMINEXPRESS-COG-CARTO-PE.2026`. Les 14 EPCI du KML de référence représentent 425 communes dans cette édition.
- **Tracés TER, gares et correspondances** : les formes de base et les points de gares viennent de [SNCF Réseau](https://data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/) et de sa [liste des gares](https://data.sncf.com/explore/dataset/liste-des-gares/). Les 15 lignes TER colorées, leurs branches et la navette Tours–Saint-Pierre-des-Corps suivent l'[export KML de la carte Google My Maps fournie](https://www.google.com/maps/d/viewer?mid=1ws2mYKFUnvG7nW2U_bYkL8RS0R7bEps). Une halte présente dans ce KML, Fondettes–Saint-Cyr-sur-Loire, est ajoutée séparément car absente de l'extrait SNCF utilisé. Les tracés colorés reprennent la carte de référence ; le réseau ferré SNCF apparaît en fond gris.
- **Tram A et bus Fil Bleu** : [GTFS Fil Bleu / Syndicat des Mobilités de Touraine](https://transport.data.gouv.fr/datasets/fil-bleu-syndicat-des-mobilites-gtfs-gtfs-rt), ressource officielle courante (validité observée 30 septembre 2026 → 1er janvier 2027), avec `routes.txt`, `shapes.txt`, `stops.txt`, `trips.txt`, `stop_times.txt` et calendriers. Les arrêts physiques restent distincts des stations commerciales.
- **Tram B et BHNS C** : tracés et arrêts de l'export KML de la carte fournie. Leurs vitesses commerciales retenues sont [18,4 km/h pour le tram B](https://lignes2tram.fr/les-nouvelles-lignes/) et [18 km/h pour le BHNS C](https://lignes2tram.fr/wp-content/uploads/2025/06/L2T_Depliant-BHNS_WEB.pdf), d'après les documents du projet Lignes2tram.

Les extraits normalisés sont dans `data/tours/`. Le script `scripts/prepare_official_data.py` permet de régénérer les couches historiques à partir des exports officiels et des KML de référence. `scripts/prepare_filbleu_bus.py` réduit le GTFS Fil Bleu courant ; `scripts/prepare_road_graph.py` construit hors ligne le graphe piéton IGN BD TOPO (Licence Ouverte Etalab 2.0) et `scripts/prepare_walking_transfers.py` en extrait la petite table `walking_transfers.json` utilisée par le site. Le graphe routier brut (~500 000 nœuds) n'est pas envoyé au navigateur. L'[inventaire des autres réseaux du SERM](data/tours/TRANSPORT-SOURCES.md) suit les sources encore à intégrer.

### Calcul des temps (révision du 3 octobre 2026)

Les TER, le tram A et les bus Fil Bleu utilisent les **horaires officiels**, et non une vitesse uniforme par corridor. Le GTFS SNCF daté du 3 octobre 2026 et le GTFS Fil Bleu courant sont filtrés sur les services circulant au moins une fois du **5 au 11 octobre 2026**. Les trajets par car sont exclus du jeu SNCF ferroviaire puis réintégrés uniquement via une source bus dédiée. Chaque séquence d'arrêts conserve un trajet réel représentatif, avec sa direction, ses temps d'arrêt et ses permissions d'embarquement/débarquement.

Le moteur compare la marche directe aux trajets en transport :

1. **Accès au réseau et marche directe** : marche sur la voirie IGN dans le SERM, à 4,8 km/h par défaut ; accès et sortie réglables, à 1,8 minute par défaut. Le mode en ligne droite reste une option explicite, et le repli hors couverture est signalé.
2. Attente estimée : TER 15 min, navette 5 min, trams 4 min, BHNS C 3,25 min. Pour chaque ligne de bus Fil Bleu, l'attente est dérivée de la moitié de l'intervalle médian observé sur les services retenus, bornée pour éviter des valeurs aberrantes.
3. Temps à bord issus du trajet horaire représentatif ; rester dans le même véhicule n'ajoute pas une nouvelle attente.
4. Changement dans la même gare/arrêt : 3,5 min + attente. Entre deux arrêts distincts du SERM, une correspondance n'est créée que si le chemin piéton préparé sur **IGN BD TOPO** reste dans la limite de 650 m ; sa longueur de voirie + 2 min de marge + l'attente sont utilisées. Seuls les vrais endpoints topologiques BD TOPO sont fusionnés : un simple croisement géométrique, par exemple une voie passant sous un pont, ne crée pas de connexion. Hors de cette couverture préparée, le modèle conserve explicitement le repli antérieur à vol d'oiseau jusqu'à 650 m. Les hubs de correspondance gardent ce graphe compact.
5. À l'arrivée : 1,8 minute de sortie, puis marche vers le point choisi. Dijkstra retient le minimum parmi les possibilités.

Cela reproduit les intervalles B–C du **trajet de référence**, pas ceux de tous les trains. Il n'y a pas de choix de date/heure : un enchaînement peut combiner des services circulant à des heures ou des jours différents. Les correspondances ne sont pas synchronisées à une heure de départ précise : le modèle représente une offre et des attentes estimées, pas un calculateur horaire. La voirie réelle est utilisée pour les correspondances, l’accès et la marche finale/directe dans le SERM en mode voirie. Une exception documentée relie le point SNCF de **St-Pierre-des-Corps**, situé dans le complexe ferroviaire, au parvis via l'arrêt officiel « St Pierre Gare » sur la distance entre leurs coordonnées officielles (~194 m), car l'accès intérieur n'est pas représenté dans le graphe routier. Les autres accès de bâtiments, quais, escaliers et obstacles fins ne sont pas tous garantis.

**Exceptions** : tram B à 18,4 km/h et BHNS C à 18 km/h restent des projets estimés. **P21 Tours–Chinon est volontairement conservée dans le modèle**, même lorsque la semaine GTFS de référence ne contient aucun train à cause de travaux temporaires : elle utilise alors le corridor ferroviaire de référence et sa vitesse commerciale estimée, afin de représenter l'offre structurelle demandée plutôt que l'interruption ponctuelle. Le bouton des projets retire B/C et leurs correspondances. Les autres gares TER sans desserte ni corridor calculable sont masquées plutôt que présentées comme accessibles.

La grille de couleur s'affine au zoom ; lorsqu'une petite poche accessible est ratée par les centres de maille, un anneau coloré ponctuel signale la gare sans simuler une surface géographique. Le pourcentage suit le plus grand contour choisi, ou le curseur si aucun contour n'est coché. Contours 15/30/45/60/90/120 min ; curseur jusqu'à 180 min ; zoom maximal ×120. Le plein écran occupe toute la fenêtre, sans dépendre d'une API native absente sur certains mobiles.

Sous la carte : **Voir le trajet retenu** et **Comment sont calculés les temps ?** exposent les étapes et hypothèses.

Pour actualiser les horaires depuis les archives officielles téléchargées :

```bash
python3 scripts/prepare_timetables.py --sncf /chemin/sncf.zip --filbleu /chemin/filbleu.zip
python3 scripts/prepare_filbleu_bus.py --gtfs /chemin/filbleu.zip
python3 build_data.py
python3 scripts/sync_root_page.py
python3 tests/walking_graph.test.py
node tests/routing.test.mjs
python3 scripts/audit_timetables.py --sncf /chemin/sncf.zip --filbleu /chemin/filbleu.zip

# Pour régénérer les correspondances piétonnes BD TOPO :
python3 scripts/prepare_road_graph.py
python3 scripts/prepare_walking_transfers.py
python3 build_data.py
python3 tests/walking_graph.test.py
node tests/routing.test.mjs
```

Sources horaires : [SNCF sur transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/horaires-sncf), [archive SNCF officielle](https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip), [fiche tram A rentrée 2026](https://www.filbleu.fr/fileadmin/productions/05_Hiver26-27/01_sept26/ficheslignes/Filbleu_A_Rentree26.pdf). L'extraction Fil Bleu est à relancer avec celle des horaires avant reconstruction.

Résultats, contrôles et limites historiques : [AUDIT.md](AUDIT.md). L'état courant doit toujours être vérifié par les tests et les derniers workflows, l'audit pouvant décrire une version antérieure.

`site/` est le contenu publié par GitHub Actions. L'entrée `index.html` à la racine permet aussi la publication Pages depuis `main` ; elle est régénérée par `scripts/sync_root_page.py`.

## Sauvegardes

- `archive/paris-original/` contient la copie des fichiers du site parisien avant remplacement, y compris ses données, son script et sa page.
- `archive/kml-reference/` contient des copies des trois KML fournis et l'export de la carte Google My Maps, sans modifier les originaux dans `Downloads`.
- Les dossiers `archive/tours-before-*-2026-10-03/` conservent les fichiers touchés avant les lots de correction, déploiement, optimisation des correspondances et préparation BD TOPO.

Inspiré du [NYC Transit Time Cartogram](https://castrio.me/nyc/) et du [cartogramme de Paris](https://julesgrandin.github.io/paris-temps-transport/).

### Attentes issues des horaires (mise à jour du 3 octobre 2026)

Le tram A, les TER et la navette utilisent désormais les départs de leurs GTFS officiels (SNCF et Fil Bleu), sur la semaine du 5 au 11 octobre 2026. Comme pour les bus, les intervalles sont séparés par date, sens et origine de service ; la moitié de leur médiane fournit une attente par ligne, bornée entre 2 et 30 minutes. Les groupes avec deux ou trois départs utilisent un intervalle de repli de 60 minutes ; sans intervalle disponible, le repli est de 30 minutes d’attente. Le plafond peut sous-estimer les services rares : ce modèle reste une comparaison d’accessibilité, sans choix d’heure de départ.

Dans **Paramètres → Attentes**, les multiplicateurs TER, tram, bus et navette sont indépendants. ×0 supprime l’attente à chaque embarquement et sa mention dans les bulles ; les durées de parcours et les malus restent appliqués. Le tram B, sans horaires, conserve sa base de 4 minutes et utilise le multiplicateur tram. Le BHNS C conserve son attente forfaitaire modifiable. Les anciens réglages d’attente en minutes sont convertis en multiplicateurs par rapport aux anciennes bases (TER 15, tram 4, navette 5 minutes).

**Paramètres → Réseau → Étiquettes des arrêts de bus** masque les noms uniquement ; le réseau et son calcul restent actifs. Ce choix d’affichage est mémorisé localement.


### Préparer la voirie compacte

Le graphe et ses scripts sont conservés dans le dépôt. Pour régénérer le binaire depuis une acquisition IGN auditée :

```sh
python3 scripts/prepare_point_walking.py --road /chemin/road_graph.json --artifact-run 37151657397
node tests/point_walking.test.mjs
node tests/walking_surface.test.mjs
```

Le manifeste `site/data/point_walking.meta.json` conserve la source, le SHA-256 et les tailles. Aucun téléchargement WFS lourd n’est lancé à chaque publication.

## Corrections bus et affichage — 4 octobre 2026

Les lignes scolaires/spéciales 66, 67, 69, 70, 72 et 73 et les lignes nocturnes N1/N2 sont retirées de la carte et du calcul, selon les catégories officielles Fil Bleu (https://www.filbleu.fr/services/le-reseau-bus-tram). Les autres lignes régulières conservent leurs durées GTFS représentatives.

Paramètres → Malus permet de régler séparément accès bus, sortie bus, correspondance bus au même arrêt et correspondance bus à pied. Valeurs initiales : 1,8 / 1,8 / 3,5 / 2 minutes, pour préserver les durées précédentes. Les correspondances avec un autre mode utilisent les marges générales. Les réglages sont mémorisés, partagés dans l’URL et réinitialisables.

Le trajet retenu se recalcule au changement de mode de marche et aux réglages suivants : son cache distingue désormais voirie et vol d’oiseau. Les anneaux ponctuels introduits par 909637d sont remplacés par de petites poches remplies avec la couleur réelle du temps et un contour noir, seulement lorsque la surface n’est pas visible au point accessible. Ces poches ont une taille minimale d’affichage ; elles ne modifient ni le temps ni la zone géographique calculée. Leur seuil est celui des contours sélectionnés.

## Placement des points — 4 octobre 2026

Paramètres → Placement des points : magnétisme TER activé par défaut, rayon de 1 km réglable de 0,1 à 3 km. Lors du placement ou du déplacement du départ ou de l’arrivée, le point se cale sur les coordonnées physiques de la gare TER desservie la plus proche dans ce rayon, dans et hors SERM. Les gares sans ligne calculable sont exclues. Désactiver le magnétisme permet de placer librement un point à proximité d’une gare. Les liens existants et la géolocalisation conservent leurs coordonnées ; les réglages du magnétisme sont mémorisés et partagés. Les poches isochrones ponctuelles sont rapprochées de la taille du symbole de gare/arrêt (rayon du symbole + 1,4 à 2,2 pixels selon le zoom).

## Magnétisme au relâchement et taille des poches — 4 octobre 2026

Dans le SERM, le magnétisme facultatif est désactivé sous un seuil de zoom réglable (défaut : 1×, la vue initiale). Hors SERM, le point glisse sur les tracés durant le geste, puis rejoint obligatoirement la gare TER desservie la plus proche au relâchement, indépendamment du rayon et du bouton de magnétisme SERM. Les points hors SERM d’un lien existant sont également calés à l’ouverture. La taille des petites zones isochrones est réglable dans Placement des points, avec un multiplicateur initial de 1,3 par rapport au commit précédent.

## Cars Rémi — 5 octobre 2026

Les 27 lignes choisies dans le KML fourni sont confrontées au GTFS régional archivé dans `data/tours/remi-2026-10-05/`. 25 lignes, 989 points physiques et 232 profils horaires sont intégrés. TB et TH sont écartées : les courses disponibles dans la semaine de référence comportent une réservation. Les courses conditionnelles des autres lignes sont également exclues ; les lignes ayant une offre régulière restent incluses. La semaine du 5 au 11 octobre évite les services uniquement estivaux ; les courses de nuit sont exclues.

Cinq courses de la ligne 800 contenant un intervalle physiquement impossible sont écartées (contrôle de tous les intervalles, plafond 100 km/h avec une minute de tolérance pour les horaires arrondis).

Chaque profil conserve le vecteur complet d'une course réelle représentative, sans assembler des minima d'horaires par tronçon. Les points de cars situés dans les gares restent distincts des points ferroviaires : passage car→train = marche, marge de correspondance et attente selon les paramètres. Les transferts dans le SERM sont préparés sur le graphe IGN compact ; les accès internes manquants à Saint-Patrice et au sud de Saint-Pierre-des-Corps sont des connexions documentées de 120 et 200 mètres estimés. À l'extérieur, le modèle conserve son repli piéton géométrique existant.

Les paramètres bus (attente, accès, sortie, correspondance, étiquettes) s'appliquent aux cars. Le groupe **Cars Rémi** permet de désactiver le réseau. Les règles empêchant de descendre puis remonter sur la même ligne s'appliquent également. Les horaires sont représentatifs : le site ne garantit pas une correspondance à une heure de départ précise.

Régénération : `python3 scripts/prepare_remi_bus.py`, puis préparation incrémentale de la table piétonne avec `scripts/prepare_local_bus_transfers.mjs` si des arrêts changent, puis `python3 build_data.py`. Les originaux fournis sont conservés.

## Services sur réservation réintégrés — 5 octobre 2026

Les services sur réservation sont désormais inclus dans les réseaux Fil Bleu, Rémi et les réseaux locaux préparés. Les horaires fixes restent issus de leurs courses réelles ; les cellules conditionnelles Ogalo deviennent utilisables. Le trajet retenu ajoute « (sur réservation) » lorsqu'un point de montée ou de descente du service utilisé l'exige. Les portions régulières des lignes mixtes ne sont pas étiquetées par erreur.

Pour les zones Fil Bleu dont le GTFS donne la même heure à plusieurs arrêts éloignés, il ne s'agit pas d'un horaire d'itinéraire : les liaisons permises par les droits de montée/descente sont estimées à 20 km/h, distance géométrique × 1,35 et 2 minutes de service. Ces profils sont identifiés `estimated-zonal-20kmh-distance-factor-1.35-plus-2min`, jamais présentés comme des durées horaires mesurées. Les règles de correspondance et les multiplicateurs bus restent applicables. Les sauvegardes avant réintégration sont dans `archive/before-reservation-2026-10-05/`.


### Déplacement des isochrones

En marche directe, le point, les couleurs et les contours sont recalculés ensemble à chaque image du déplacement. Les marches d’accès des derniers parcours sont réévaluées à la position courante, pendant qu’un worker actualise les choix de parcours. Au relâchement, le worker effectue aussi le calcul complet, affine la grille et prépare le trajet détaillé ; l’interface continue d’afficher un aperçu courant pendant cet affinage. Le graphe et ses coûts sont préparés une fois par configuration ; seule la variante de parcours utilisée par la carte directe est calculée. Les deux variantes restent disponibles pour la marche sur voirie et les diagnostics. Les étiquettes d’arrêts et leur placement sont mis en cache lorsque la vue reste fixe. L’aimantation du départ est appliquée au relâchement.

`node tests/direct_worker.test.mjs` vérifie le calcul final en arrière-plan, la réutilisation des résultats et les transferts de buffers. `node tests/live_routing.test.mjs` vérifie les temps, la grille numérique, la borne du score de l’aperçu et le regroupement des positions envoyées au worker. `node tools/benchmark_live.mjs` compare le moteur initial et le calcul optimisé sur le même jeu de données. Le benchmark requiert le commit historique `75d550e` dans le clone Git. Le paramètre `perf=1` active des mesures de rendu dans les attributs du Canvas, sans panneau supplémentaire. Les durées mesurées dépendent du navigateur, de la machine et de la vue.
