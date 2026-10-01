# Paris selon le temps qu'il faut pour y aller

Cartogramme interactif des temps de trajet en **métro** et **RER**, inspiré du [NYC Transit Time Cartogram](https://castrio.me/nyc/).

La carte se colore autour d'un point de départ selon le temps en métro et RER.

## Lancer

```bash
python3 build_data.py
python3 -m http.server 8000 --directory site
```

Puis ouvrir [http://localhost:8000](http://localhost:8000).

## Données

- Stations et tracés Île-de-France Mobilités (métro + RER)
- Arrondissements de Paris et communes de petite couronne
- Bois de Boulogne et Bois de Vincennes

Les temps sont estimés à partir des distances le long des lignes (vitesse commerciale selon le mode), plus un accès piéton, une attente en station et une pénalité de correspondance. Pas de bus, tram, Transilien ni horaires temps réel.

## Recalculer le réseau

Les GeoJSON sources sont dans `data/`. Relancer `python3 build_data.py` régénère `site/data/commute_map_data.json`.
