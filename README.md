# Tours selon le temps qu'il faut pour y aller

Carte interactive des trajets estimés en TER, tram, BHNS et bus Fil Bleu. Elle s'ouvre sur les 14 EPCI du SERM de Touraine tout en laissant explorer les lignes connectées au-delà. La carte se déplace directement par glisser-déposer ; les anciens boutons « main » et verrouillage de l'arrivée ont été supprimés.

Les isochrones surfaciques restent limités au périmètre SERM. Hors SERM, les gares accessibles sont signalées ponctuellement sans fabriquer de grand halo territorial. Les courbes restent centrées sur le **départ** quand une arrivée est ajoutée. Les limites des 425 communes IGN du SERM sont visibles ; leurs noms apparaissent au zoom rapproché. Les lignes et petits arrêts de bus sont progressivement masqués au dézoom pour préserver la lisibilité, mais restent présents dans le calcul.

Le **tram B et le BHNS C**, prévus pour 2028, sont inclus par défaut dans les temps estimés. L'option « Inclure tram B et BHNS C » permet de les exclure et recalcule les trajets. Les bus Fil Bleu sont issus du GTFS officiel courant ; les autres réseaux du SERM restent à intégrer séparément.

## Lancer le site

```bash
python3 -m http.server 8000 --directory site
```

Ouvrir <http://localhost:8000>. Les données prêtes à afficher sont dans `site/data/commute_map_data.json`. Pour les recalculer hors ligne :

```bash
python3 build_data.py
python3 scripts/sync_root_page.py
```

## Données

- **Limites administratives** : [IGN Admin Express COG CARTO PE, édition 2026](https://geoservices.ign.fr/adminexpress), couches `commune` et `epci` du WFS `ADMINEXPRESS-COG-CARTO-PE.2026`. Les 14 EPCI du KML de référence représentent 425 communes dans cette édition.
- **Tracés TER, gares et correspondances** : les formes de base et les points de gares viennent de [SNCF Réseau](https://data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/) et de sa [liste des gares](https://data.sncf.com/explore/dataset/liste-des-gares/). Les 15 lignes TER colorées, leurs branches et la navette Tours–Saint-Pierre-des-Corps suivent l'[export KML de la carte Google My Maps fournie](https://www.google.com/maps/d/viewer?mid=1ws2mYKFUnvG7nW2U_bYkL8RS0R7bEps). Une halte présente dans ce KML, Fondettes–Saint-Cyr-sur-Loire, est ajoutée séparément car absente de l'extrait SNCF utilisé. Les tracés colorés reprennent la carte de référence ; le réseau ferré SNCF apparaît en fond gris.
- **Tram A et bus Fil Bleu** : [GTFS Fil Bleu / Syndicat des Mobilités de Touraine](https://transport.data.gouv.fr/datasets/fil-bleu-syndicat-des-mobilites-gtfs-gtfs-rt), ressource officielle courante (validité observée 30 septembre 2026 → 1er janvier 2027), avec `routes.txt`, `shapes.txt`, `stops.txt`, `trips.txt`, `stop_times.txt` et calendriers. Les arrêts physiques restent distincts des stations commerciales.
- **Tram B et BHNS C** : tracés et arrêts de l'export KML de la carte fournie. Leurs vitesses commerciales retenues sont [18,4 km/h pour le tram B](https://lignes2tram.fr/les-nouvelles-lignes/) et [18 km/h pour le BHNS C](https://lignes2tram.fr/wp-content/uploads/2025/06/L2T_Depliant-BHNS_WEB.pdf), d'après les documents du projet Lignes2tram.

Les extraits normalisés sont dans `data/tours/`. Le script `scripts/prepare_official_data.py` permet de régénérer les couches historiques à partir des exports officiels et des KML de référence. `scripts/prepare_filbleu_bus.py` réduit le GTFS Fil Bleu courant ; `scripts/prepare_road_graph.py` construit hors ligne le graphe piéton IGN BD TOPO (Licence Ouverte Etalab 2.0) et `scripts/prepare_walking_transfers.py` en extrait la petite table `walking_transfers.json` utilisée par le site. Le graphe routier brut (~500 000 nœuds) n'est pas envoyé au navigateur. L'[inventaire des autres réseaux du SERM](data/tours/TRANSPORT-SOURCES.md) suit les sources encore à intégrer.

### Calcul des temps (révision du 3 octobre 2026)

Les TER, le tram A et les bus Fil Bleu utilisent les **horaires officiels**, et non une vitesse uniforme par corridor. Le GTFS SNCF daté du 2 octobre 2026 et le GTFS Fil Bleu courant sont filtrés sur les services circulant au moins une fois du **5 au 11 octobre 2026**. Les trajets par car sont exclus du jeu SNCF ferroviaire puis réintégrés uniquement via une source bus dédiée. Chaque séquence d'arrêts conserve un trajet réel représentatif, avec sa direction, ses temps d'arrêt et ses permissions d'embarquement/débarquement.

Le moteur compare la marche directe aux trajets en transport :

1. **Accès au réseau et marche directe** : marche à 4,8 km/h encore estimée en ligne droite depuis le départ vers les arrêts, puis de l'arrêt final vers la destination ; 1,8 minute d'accès et 1,8 minute de sortie par défaut. Cette partie n'utilise pas encore la voirie réelle.
2. Attente estimée : TER 15 min, navette 5 min, trams 4 min, BHNS C 3,25 min. Pour chaque ligne de bus Fil Bleu, l'attente est dérivée de la moitié de l'intervalle médian observé sur les services retenus, bornée pour éviter des valeurs aberrantes.
3. Temps à bord issus du trajet horaire représentatif ; rester dans le même véhicule n'ajoute pas une nouvelle attente.
4. Changement dans la même gare/arrêt : 3,5 min + attente. Entre deux arrêts distincts du SERM, une correspondance n'est créée que si le chemin piéton préparé sur **IGN BD TOPO** reste dans la limite de 650 m ; sa longueur de voirie + 2 min de marge + l'attente sont utilisées. Seuls les vrais endpoints topologiques BD TOPO sont fusionnés : un simple croisement géométrique, par exemple une voie passant sous un pont, ne crée pas de connexion. Hors de cette couverture préparée, le modèle conserve explicitement le repli antérieur à vol d'oiseau jusqu'à 650 m. Les hubs de correspondance gardent ce graphe compact.
5. À l'arrivée : 1,8 minute de sortie, puis marche vers le point choisi. Dijkstra retient le minimum parmi les possibilités.

Cela reproduit les intervalles B–C du **trajet de référence**, pas ceux de tous les trains. Il n'y a pas de choix de date/heure : un enchaînement peut combiner des services circulant à des heures ou des jours différents. Les correspondances ne sont pas synchronisées à une heure de départ précise : le modèle représente une offre et des attentes estimées, pas un calculateur horaire. La voirie réelle est actuellement utilisée pour les **correspondances arrêt-à-arrêt dans le SERM**, pas encore pour l'accès depuis un point arbitraire ni pour la marche finale/directe. Une exception documentée relie le point SNCF de **St-Pierre-des-Corps**, situé dans le complexe ferroviaire, au parvis via l'arrêt officiel « St Pierre Gare » sur la distance entre leurs coordonnées officielles (~194 m), car l'accès intérieur n'est pas représenté dans le graphe routier. Les autres accès de bâtiments, quais, escaliers et obstacles fins ne sont pas tous garantis.

**Exceptions** : tram B à 18,4 km/h et BHNS C à 18 km/h restent des projets estimés. Pour la semaine de référence du 5 au 11 octobre 2026, la circulation ferroviaire Tours–Chinon (P21) est suspendue pour travaux ; le moteur n'invente donc plus de desserte ferroviaire de remplacement. Les autocars de substitution doivent être intégrés comme bus avec leurs propres horaires. Le bouton des projets retire B/C et leurs correspondances. Les gares TER sans desserte retenue dans le calcul sont masquées plutôt que présentées comme accessibles.

La grille de couleur s'affine au zoom ; lorsqu'une petite poche accessible est ratée par les centres de maille, un anneau coloré ponctuel signale la gare sans simuler une surface géographique. Le pourcentage suit le plus grand contour choisi, ou le curseur si aucun contour n'est coché. Contours 15/30/45/60/90/120 min ; curseur jusqu'à 180 min ; zoom maximal ×120. Le plein écran occupe toute la fenêtre, sans dépendre d'une API native absente sur certains mobiles.

Sous la carte : **Voir le trajet retenu** et **Comment sont calculés les temps ?** exposent les étapes et hypothèses.

Pour actualiser les horaires depuis les archives officielles téléchargées :

```bash
python3 scripts/prepare_timetables.py --sncf /chemin/sncf.zip --filbleu /chemin/filbleu.zip
python3 scripts/prepare_filbleu_bus.py --gtfs /chemin/filbleu.zip
python3 build_data.py
python3 scripts/sync_root_page.py
node tests/routing.test.mjs
python3 scripts/audit_timetables.py --sncf /chemin/sncf.zip --filbleu /chemin/filbleu.zip

# Pour régénérer les correspondances piétonnes BD TOPO :
python3 scripts/prepare_road_graph.py
python3 scripts/prepare_walking_transfers.py
python3 build_data.py
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
