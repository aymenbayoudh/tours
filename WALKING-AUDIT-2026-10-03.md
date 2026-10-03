# Marche sur voirie — état du 3 octobre 2026

Ce document décrit l'état courant du lot **marche** prévu par `PASSATION-TOURS-BUS-MARCHE-VELO.md`. Il complète l'audit historique sans prétendre que toute la marche du site utilise déjà la voirie.

## Ce qui est effectivement utilisé

Dans le SERM de Touraine, les **correspondances entre arrêts physiques distincts** sont filtrées et mesurées sur un graphe piéton préparé depuis **IGN BD TOPO v3 — Tronçons de route**, diffusée sous **Licence Ouverte Etalab 2.0**.

Le navigateur ne reçoit pas le graphe BD TOPO complet. Le traitement hors ligne produit `data/tours/walking_transfers.json`, une table fixe de paires d'arrêts dont le chemin piéton reste dans la limite de 650 m. Le moteur conserve séparément la distance de marche, la marge de correspondance à pied et l'attente du nouveau service.

Hors de la couverture préparée du SERM, le repli historique entre arrêts proches reste une distance à vol d'oiseau jusqu'à 650 m.

L'accès **départ arbitraire → arrêt**, la marche **arrêt final → destination** et la **marche directe** restent à ce stade calculés en ligne droite à 4,8 km/h. Ils ne doivent pas être présentés comme des cheminements BD TOPO.

### Exception documentée d'accès de gare

Le point SNCF de **St-Pierre-des-Corps** est situé à l'intérieur du complexe ferroviaire et le graphe routier BD TOPO ne restitue pas correctement le cheminement intérieur jusqu'au parvis. Une unique liaison explicite relie donc :

- `SNCF:87571240` — St-Pierre-des-Corps ;
- `FILBLEU:TTR:SPGAB-1A` — arrêt officiel **St Pierre Gare** ;
- distance retenue : **193,8 m**, distance entre leurs coordonnées officielles.

Cette paire est stockée séparément dans `manualPairs`, avec sa justification, afin de ne pas la confondre avec un chemin BD TOPO. Aucune règle générale de raccord automatique des gares n'est créée.

## Préparation BD TOPO

Le graphe piéton est construit hors ligne par `scripts/prepare_road_graph.py`.

Mesures du workflow `Build road graph audit` réussi, run `37151657397`, sur le correctif topologique `88683524` :

- 445 874 tronçons BD TOPO uniques récupérés sur les enveloppes des 14 EPCI ;
- 337 544 parties de lignes retenues ;
- 1 946 objets rejetés par les règles piétonnes ;
- **496 301 nœuds** ;
- **576 121 arêtes piétonnes** ;
- **22 426 534 octets** en JSON ;
- **7 093 931 octets** compressés gzip.

La topologie ne fusionne que les **vrais endpoints BD TOPO**. Les points créés artificiellement pour découper les longs tronçons restent propres à leur tronçon source. Ainsi, un croisement géométrique sans nœud topologique — par exemple une route sous un pont — ne devient pas automatiquement une connexion, tandis que les extrémités réelles d'un ouvrage restent raccordées à ses voies d'accès.

Le téléchargement WFS IGN est paginé par EPCI, dédupliqué, et tolère jusqu'à cinq échecs transitoires par page avant abandon. Cela ne modifie pas les règles de filtrage ni le graphe obtenu.

## Table compacte de correspondances

La table est construite par `scripts/prepare_walking_transfers.py`.

Mesures après correction topologique :

- **1 577** arrêts/stations du SERM couverts ;
- **12 658** paires candidates à moins de 650 m à vol d'oiseau ;
- **7 482** paires réellement reliées dans 650 m sur le graphe préparé ;
- distance de raccord arrêt→graphe : médiane **19,2 m**, maximum **67,6 m** ;
- **96** groupes de points de même nom réellement colocalisés (≤ 5 m), soit 195 points, partagent leur nœud de raccord sans fusionner leurs enregistrements de transport ;
- **1 seule composante pour les 1 577 arrêts**, contre 23 composantes auparavant, dont la plus grande n'en contenait que 634 ;
- le graphe routier lui-même comporte 262 composantes, mais la composante principale contient 494 920 nœuds et les 1 577 arrêts raccordés ;
- table compacte : environ **424 ko** avant l'ajout marginal de la paire manuelle St-Pierre.

Le gros graphe n'est donc pas servi à chaque navigateur.

## Vérifications

Le déploiement du commit `73f733c69` passe avec :

- **338 959 assertions** dans la suite de routage ;
- test topologique d'impasse : succès ;
- 1 674 arrêts/stations ;
- 334 motifs horaires représentatifs ;
- 101 745 intervalles horaires vérifiés ;
- 17 210 états de transport ;
- **43 684 arêtes** dans le graphe final ;
- **14 954 arêtes de correspondance** portant une distance de marche préparée ou l'accès explicite St-Pierre ;
- temps maximal de construction du modèle sur les origines de test : **42,6 ms** dans ce run GitHub Actions ;
- 29 084 cellules de grille : **2 536,8 ms** dans ce run.

Le temps de grille varie fortement entre runners GitHub Actions et ne doit pas être interprété seul comme une mesure mobile. Les temps de transport de référence restent inchangés :

- Tours → Blois-Chambord : 50,6 min ;
- Tours → Orléans : 81,6 min ;
- Tours → Le Mans : 78,6 min ;
- Tours → Paris-Austerlitz : 151,6 min ;
- Rotière → Jean Jaurès : 30,0 min.

### Fixtures géographiques

Les tests protègent désormais plusieurs cas concrets :

- **Jumeaux** : environ 26 m à vol d'oiseau mais **593,6 m** sur le graphe préparé ;
- **Île Aucard → Loire** : environ 234 m géométriques, mais aucune correspondance de moins de 650 m n'est créée ;
- **Porte de Loire → Place Choiseul** : le franchissement réel de Loire est rétabli par la voirie, **610,2 m** ;
- **Gare de Tours → tram/arrêt Gare de Tours** : accès BD TOPO court, environ **71,1 m** ;
- **St-Pierre-des-Corps → St Pierre Gare** : accès intérieur explicite **193,8 m**, identifié comme approximation documentée et non comme chemin BD TOPO ;
- une impasse synthétique vérifie que deux branches géométriquement proches mais non connectées restent injoignables.

Ces contrôles ne signifient pas que tous les accès de bâtiments, quais, passages souterrains ou escaliers sont exhaustivement modélisés.

## Pourquoi le graphe complet n'est pas chargé dans le navigateur

Des prototypes de contraction et d'ancrage du graphe complet ont été mesurés. Même en contractant fortement les chaînes de degré 2, conserver assez de points pour raccorder correctement un clic arbitraire conduit encore à plusieurs mégaoctets compressés et augmente sensiblement la mémoire côté téléphone.

Cette hausse est disproportionnée par rapport au site actuel. Le graphe complet n'est donc pas publié sans architecture plus ciblée — par exemple tuilage, tables d'accès pré-calculées ou worker — et comparaison mobile réelle.

En conséquence, **origine arbitraire, destination arbitraire et marche directe restent explicitement à vol d'oiseau** pour cette version.

## Reconstruction

Après avoir généré les données de transport courantes :

```bash
python3 scripts/prepare_road_graph.py
python3 scripts/prepare_walking_transfers.py
python3 build_data.py
python3 tests/walking_graph.test.py
node tests/routing.test.mjs
```

Le fichier `walking_transfers.json` doit couvrir tous les arrêts actuellement situés dans le SERM ; `build_data.py` échoue volontairement si une table générée est devenue obsolète par rapport aux arrêts.

## Retour arrière

Les versions antérieures des fichiers touchés restent sous `archive/tours-before-*-2026-10-03/`. Les sauvegardes spécifiques aux corrections de topologie, aux retries WFS et à l'accès St-Pierre sont conservées.

Pour revenir avant l'utilisation des correspondances BD TOPO, utiliser les commits/archives du lot de hubs de correspondance antérieur à `236c4bb29` → `f8a8f0fc5`. Ne pas restaurer l'ensemble du dépôt à `590fe49` : de nombreux correctifs bus, P21, affichage, partage et performance sont postérieurs.
