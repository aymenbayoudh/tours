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

### Vitesses TER

Le calcul utilise des vitesses commerciales **par corridor**, au lieu d'une vitesse uniforme. Elles sont calibrées sur les meilleurs horaires directs publiés par SNCF Connect, divisés par la distance approximative du corridor, puis arrondies. Repères : [Tours–Orléans](https://www.sncf-connect.com/train/horaires/tours/orleans) ≈ 82 km/h, [Tours–Le Mans](https://www.sncf-connect.com/train/horaires/tours/le-mans) ≈ 79 km/h, [Tours–Saumur](https://www.sncf-connect.com/train/horaires/tours/saumur) ≈ 96 km/h, [Tours–Vierzon](https://www.sncf-connect.com/train/horaires/tours/vierzon) ≈ 78 km/h, [Tours–Poitiers](https://www.sncf-connect.com/train/horaires/tours/poitiers) ≈ 70 km/h, [Tours–Loches](https://www.sncf-connect.com/train/horaires/tours/loches) ≈ 52–58 km/h, [Tours–Chinon](https://www.sncf-connect.com/train/trajet/tours/chinon) ≈ 50 km/h, [Tours–Chartres](https://www.sncf-connect.com/train/trajet/tours/chartres) ≈ 55 km/h et [Tours–Paris-Austerlitz](https://www.sncf-connect.com/train/horaires/tours/paris) ≈ 95 km/h. Les valeurs exactes par ligne sont dans `TER_SPEED_KMH` de `build_data.py` ; les lignes d'un même corridor partagent parfois une même vitesse représentative.

Les résultats restent des **estimations** : marche d'accès, attente et correspondances simplifiées ; pas de prise en compte des horaires réels, jours de circulation, retards ni des arrêts effectivement desservis par chaque train. Le passage d'une ligne devant une gare dans le KML sert d'approximation de desserte. Le tram B et le BHNS C représentent leur réseau projeté en 2028.

`site/` est le contenu publié par GitHub Actions. L'entrée `index.html` à la racine permet aussi la publication Pages depuis `main` ; elle est régénérée par `scripts/sync_root_page.py`.

## Sauvegardes

- `archive/paris-original/` contient la copie des fichiers du site parisien avant remplacement, y compris ses données, son script et sa page.
- `archive/kml-reference/` contient des copies des trois KML fournis et l'export de la carte Google My Maps, sans modifier les originaux dans `Downloads`.

Inspiré du [NYC Transit Time Cartogram](https://castrio.me/nyc/) et du [cartogramme de Paris](https://julesgrandin.github.io/paris-temps-transport/).
