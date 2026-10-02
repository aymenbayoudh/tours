# Tours selon le temps qu'il faut pour y aller

Cartogramme interactif des trajets estimés en **TER et tram A** depuis Tours. La carte s'ouvre sur les 14 EPCI du périmètre SERM de Touraine. Le bouton **main**, sous le zoom, permet de déplacer librement la carte et de voir les lignes vers les destinations plus lointaines. Les bus seront ajoutés ultérieurement.

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
- **Lignes et gares** : [formes des lignes du réseau ferré national](https://data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/) et [liste des gares](https://data.sncf.com/explore/dataset/liste-des-gares/) de SNCF Réseau. Les géométries ferroviaires visibles viennent du RFN exploité. Le KML Rémi fourni sert à sélectionner les corridors directs et à attribuer les gares aux lignes.
- **Tram A et arrêts** : [GTFS Fil Bleu / Syndicat des Mobilités de Touraine](https://data.tours-metropole.fr/explore/dataset/horaires-temps-reel-gtfsrt-reseau-filbleu-tmvl/), export du 30 septembre 2026. Les tracés, 29 arrêts et séquences viennent des fichiers `shapes.txt`, `stops.txt`, `trips.txt` et `stop_times.txt`.

Les extraits normalisés sont dans `data/tours/`. Le script `scripts/prepare_official_data.py` permet de les régénérer à partir des exports officiels et du KML Rémi.

`site/` est l'artifact publié par GitHub Actions. L'entrée `index.html` à la racine permet aussi la publication Pages depuis la branche `main` ; elle est régénérée par `scripts/sync_root_page.py`.

Les temps sont des **estimations** : distance sur les tracés, vitesse moyenne, marche d'accès, attente et correspondances simplifiées. Ils ne tiennent pas compte des horaires, des jours de circulation, des retards ou des arrêts effectivement desservis par chaque train. En particulier, le passage d'une ligne devant une gare dans le KML sert d'approximation de desserte. La heatmap couvre les 14 EPCI ; les rails et gares hors périmètre restent visibles en mode main.

## Sauvegardes

- `archive/paris-original/` contient la copie des fichiers du site parisien avant remplacement, y compris ses données, son script et sa page.
- `archive/kml-reference/` contient des copies des trois KML fournis, sans modifier les originaux dans `Downloads`.

Inspiré du [NYC Transit Time Cartogram](https://castrio.me/nyc/) et du [cartogramme de Paris](https://julesgrandin.github.io/paris-temps-transport/). Bonne exploration !
