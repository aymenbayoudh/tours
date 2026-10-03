# Tours selon le temps qu'il faut pour y aller

Carte interactive des trajets estimés en TER, tram et BHNS. Elle s'ouvre sur les 14 EPCI du SERM de Touraine. Le bouton **main**, sous le zoom, permet de déplacer librement la carte et de placer le départ sur les lignes jusqu'à Paris, Caen et les autres destinations affichées. Les isochrones se calculent aussi hors du périmètre SERM lorsque le départ ou la vue s'y trouve.

Les courbes restent centrées sur le **départ** quand une arrivée est ajoutée. Les épingles montrent la commune en titre et la gare ou l'arrêt le plus proche avec sa ligne en petit. Les limites des 425 communes IGN du SERM sont visibles ; leurs noms apparaissent au zoom rapproché. Les gares des lignes TER au-delà du SERM sont étiquetées, avec un nom plus grand pour les terminus. Pour un point hors des communes IGN chargées, le nom du lieu est déduit de la gare la plus proche.

Le **tram B et le BHNS C**, prévus pour 2028, sont inclus par défaut dans les temps estimés. L'option « Inclure tram B et BHNS C » permet de les exclure et recalcule les trajets. Les autres bus seront ajoutés ultérieurement.

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
- **Tram A et arrêts** : [GTFS Fil Bleu / Syndicat des Mobilités de Touraine](https://data.tours-metropole.fr/explore/dataset/horaires-temps-reel-gtfsrt-reseau-filbleu-tmvl/), export du 30 septembre 2026, avec `shapes.txt`, `stops.txt`, `trips.txt` et `stop_times.txt`.
- **Tram B et BHNS C** : tracés et arrêts de l'export KML de la carte fournie. Leurs vitesses commerciales retenues sont [18,4 km/h pour le tram B](https://lignes2tram.fr/les-nouvelles-lignes/) et [18 km/h pour le BHNS C](https://lignes2tram.fr/wp-content/uploads/2025/06/L2T_Depliant-BHNS_WEB.pdf), d'après les documents du projet Lignes2tram.

Les extraits normalisés sont dans `data/tours/`. Le script `scripts/prepare_official_data.py` permet de les régénérer à partir des exports officiels et des KML de référence.

### Calcul des temps (révision du 3 octobre 2026)

Les TER et le tram A utilisent désormais les **horaires officiels**, et non une vitesse uniforme par corridor. Le GTFS SNCF daté du 2 octobre 2026 est filtré sur les services circulant au moins une fois du **5 au 11 octobre 2026**. Les trajets par car sont exclus même lorsque leur ligne GTFS est classée ferroviaire. Chaque séquence d'arrêts conserve un trajet réel de durée médiane, avec sa direction, ses temps d'arrêt et ses permissions d'embarquement/débarquement.

Le moteur compare la marche directe aux trajets en transport :

1. Marche à 4,8 km/h, en ligne droite, vers tous les arrêts possibles ; 1,8 minute d'accès.
2. Attente estimée : TER 15 min, navette 5 min, trams 4 min, BHNS C 3,25 min.
3. Temps à bord issus du trajet horaire représentatif ; rester dans le même véhicule n'ajoute pas une nouvelle attente.
4. Changement dans la même gare : 3,5 min + attente. Entre arrêts distants de 650 m au plus : marche + 2 min + attente. Les changements entre deux dessertes du même code TER sont possibles.
5. À l'arrivée : 1,8 minute de sortie, puis marche vers le point choisi. Dijkstra retient le minimum parmi les possibilités.

Cela reproduit les intervalles B–C du **trajet de référence**, pas ceux de tous les trains. Il n'y a pas de choix de date/heure : un enchaînement peut combiner des services circulant à des heures ou des jours différents. Fréquences, correspondances réelles, retards, cheminements piétons, obstacles et accessibilité ne sont pas garantis.

**Exceptions** : tram B à 18,4 km/h, BHNS C à 18 km/h, P21 vers Chinon à 50 km/h le long du tracé. Le GTFS retenu ne contient pas de train P21 ; cette ligne reste explicitement une hypothèse ferroviaire. Le bouton des projets retire B/C et leurs correspondances. Vendôme-Villiers-sur-Loir reste visible sans embarquement car le réseau sélectionné ne contient pas sa desserte TGV.

La grille de couleur s'affine au zoom ; les halos dorés évaluent les gares directement, même si une zone est trop petite pour une maille. Le pourcentage suit le plus grand contour choisi, ou le curseur si aucun contour n'est coché. Contours 15/30/45/60/90/120 min ; curseur jusqu'à 180 min ; zoom maximal ×120. L'épingle dans la bulle d'arrivée la verrouille, y compris via un bouton tactile. Le plein écran occupe toute la fenêtre, sans dépendre d'une API native absente sur certains mobiles.

Sous la carte : **Voir le trajet retenu** et **Comment sont calculés les temps ?** exposent les étapes et hypothèses.

Pour actualiser les horaires depuis les archives officielles téléchargées :

```bash
python3 scripts/prepare_timetables.py --sncf /chemin/sncf.zip --filbleu /chemin/filbleu.zip
python3 build_data.py
python3 scripts/sync_root_page.py
node tests/routing.test.mjs
python3 scripts/audit_timetables.py --sncf /chemin/sncf.zip --filbleu /chemin/filbleu.zip
```

Sources horaires : [SNCF sur transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/horaires-sncf), [archive SNCF officielle](https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip), [fiche tram A rentrée 2026](https://www.filbleu.fr/fileadmin/productions/05_Hiver26-27/01_sept26/ficheslignes/Filbleu_A_Rentree26.pdf). L'extraction Fil Bleu est à relancer avec celle des horaires avant reconstruction.

Résultats, contrôles et limites : [AUDIT.md](AUDIT.md).

`site/` est le contenu publié par GitHub Actions. L'entrée `index.html` à la racine permet aussi la publication Pages depuis `main` ; elle est régénérée par `scripts/sync_root_page.py`.

## Sauvegardes

- `archive/paris-original/` contient la copie des fichiers du site parisien avant remplacement, y compris ses données, son script et sa page.
- `archive/kml-reference/` contient des copies des trois KML fournis et l'export de la carte Google My Maps, sans modifier les originaux dans `Downloads`.

Inspiré du [NYC Transit Time Cartogram](https://castrio.me/nyc/) et du [cartogramme de Paris](https://julesgrandin.github.io/paris-temps-transport/).
