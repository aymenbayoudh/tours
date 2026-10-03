# Marche sur voirie — état du 3 octobre 2026

Ce document décrit l'état courant du lot **marche** prévu par `PASSATION-TOURS-BUS-MARCHE-VELO.md`. Il complète l'audit historique sans prétendre que toute la marche du site utilise déjà la voirie.

## Ce qui est effectivement utilisé

Dans le SERM de Touraine, les **correspondances entre arrêts physiques distincts** sont désormais filtrées et mesurées sur un graphe piéton préparé depuis **IGN BD TOPO v3 — Tronçons de route**.

Le navigateur ne reçoit pas le graphe BD TOPO complet. Le traitement hors ligne produit `data/tours/walking_transfers.json`, une table fixe de paires d'arrêts dont le chemin piéton reste dans la limite de 650 m. Le moteur conserve ensuite la marge de correspondance à pied et l'attente du nouveau service comme paramètres séparés.

Hors de la couverture préparée du SERM, le repli historique entre arrêts proches reste une distance à vol d'oiseau jusqu'à 650 m.

L'accès **départ arbitraire → arrêt**, la marche **arrêt final → destination** et la **marche directe** restent à ce stade calculés en ligne droite à 4,8 km/h. Ils ne doivent pas être présentés comme des cheminements BD TOPO.

## Préparation BD TOPO

Le graphe piéton est construit hors ligne par `scripts/prepare_road_graph.py`.

Mesures du workflow `Build road graph audit` (run 37149467547, commit `6c442007`) :

- 445 874 tronçons BD TOPO uniques récupérés sur les enveloppes des 14 EPCI ;
- 337 544 parties de lignes retenues ;
- 1 946 objets rejetés par les règles piétonnes ;
- 507 648 nœuds ;
- 576 105 arêtes piétonnes ;
- 24 692 062 octets en JSON, environ 7,28 Mo compressés ;
- le niveau `position_par_rapport_au_sol` appartient à la clé topologique afin de ne pas relier automatiquement un pont/tunnel à une voie située à un autre niveau.

La table de correspondances est construite par `scripts/prepare_walking_transfers.py` :

- 1 577 arrêts du SERM couverts ;
- 12 658 paires candidates à moins de 650 m à vol d'oiseau ;
- 7 141 paires réellement reliées dans 650 m sur le graphe préparé ;
- distance de raccord arrêt→graphe : médiane 19,2 m, maximum 67,6 m ;
- taille de `walking_transfers.json` : environ 406 ko.

Le gros graphe n'est donc pas servi à chaque navigateur.

## Vérifications

Le workflow de déploiement du commit `71ec51a7` passe avec 337 585 assertions.

État mesuré sur GitHub Actions :

- 1 674 arrêts/stations ;
- 334 motifs horaires représentatifs ;
- 101 745 intervalles horaires vérifiés par la suite de tests ;
- 17 210 états de transport ;
- 43 000 arêtes dans le graphe final ;
- 14 270 arêtes de correspondance portent une distance de marche préparée sur BD TOPO ;
- temps maximal de construction du modèle sur les origines de test : 30,8 ms ;
- évaluation des 29 084 cellules de la grille dans ce run : 1 221,9 ms.

Les trajets de référence restent inchangés : Tours→Blois-Chambord 50,6 min ; Tours→Orléans 81,6 min ; Tours→Le Mans 78,6 min ; Tours→Paris-Austerlitz 151,6 min ; Rotière→Jean Jaurès 30,0 min.

Deux fixtures géographiques protègent désormais la logique voirie :

- les deux points physiques **Jumeaux** sont distants d'environ 26 m géométriquement mais leur chemin préparé vaut environ 594 m ;
- **Île Aucard → Loire** est à environ 234 m à vol d'oiseau mais aucune correspondance de moins de 650 m n'est créée sur le graphe préparé.

Ces tests vérifient qu'une faible distance géométrique ne suffit plus à créer une connexion.

## Pourquoi le graphe complet n'est pas encore chargé dans le navigateur

Un prototype de contraction des chaînes de degré 2 réduit le graphe de 507 648 à environ 237 000 nœuds et de 576 105 à environ 306 000 arêtes. Mais conserver assez de points de raccord pour accrocher proprement un clic arbitraire aboutit encore à environ **7,5 Mo compressés** pour la structure expérimentale.

Cette hausse est disproportionnée par rapport au site actuel et risquerait de dégrader le chargement et la mémoire sur téléphone. Elle n'est donc pas publiée sans architecture plus ciblée (tuilage/structure d'accès pré-calculée/worker) et comparaison mobile.

## Reconstruction

Après avoir généré les données de transport courantes :

```bash
python3 scripts/prepare_road_graph.py
python3 scripts/prepare_walking_transfers.py
python3 build_data.py
node tests/routing.test.mjs
```

Le fichier `walking_transfers.json` doit couvrir tous les arrêts actuellement situés dans le SERM ; `build_data.py` échoue volontairement si une table générée est devenue obsolète par rapport aux arrêts.

## Retour arrière

Les versions antérieures des fichiers touchés restent sous `archive/tours-before-*-2026-10-03/`. Pour revenir avant l'utilisation des correspondances BD TOPO, le point de référence fonctionnel est le lot de hubs de correspondance avant les commits `236c4bb29` → `f8a8f0fc5`. Ne pas restaurer l'ensemble du dépôt à `590fe49` : de nombreux correctifs bus, P21, affichage et performance sont postérieurs.
