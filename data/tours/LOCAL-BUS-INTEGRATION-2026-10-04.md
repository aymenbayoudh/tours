# Reprise des bus locaux hors SMT — 4 octobre 2026

## Travail récupéré

La conversation « Autorisation publication commit » préparait un commit `cc01244` dans un autre environnement, sans intégration au moteur et sans push réussi. Ce commit n’existe pas sur la branche GitHub récupérée. Les archives, l’inventaire et les fiches déjà publiés dans `local-networks-2026-10-04/` ont permis de reconstruire le lot ici, après `f724bb6`, sans annuler les correctifs TER récents.

## Intégré dans ce lot

| Réseau | Lignes | Arrêts physiques | Motifs horaires |
|---|---:|---:|---:|
| Azalys | 29 | 568 | 114 |
| MOVE A / TGV / M régulière | 3 | 99 | 13 |
| CVL Mobilité A | 1 | 59 | 4 |
| Le Bus Amboise Nav1 | 1 | 24 | 11 |
| Total supplémentaire | 34 | 750 | 142 |

Les motifs, arrêts et tracés proviennent des archives officielles intactes dont l’empreinte SHA-256 est contrôlée. Les données sont dans `local_bus.json` ; la préparation est reproduite par `scripts/prepare_local_bus_gtfs.py`. La période retenue est le 5–11 octobre 2026, sur les jours de circulation du calendrier et de ses exceptions.

Les réseaux ont leurs propres identifiants : `MOVE:…`, `AZALYS:…`, `CVL:…`, `AMBOISE:…`. Les lignes sont nommées `BUS MOVE A`, `BUS Azalys A`, etc. Aucun rapprochement n’est fait uniquement à partir du numéro ou du nom d’arrêt.

Les services explicitement scolaires, nocturnes, touristiques saisonniers et conditionnels sont exclus conformément à l’inventaire. Les variantes de calendrier nommées SCOLAIRE ne sont pas supprimées lorsqu’elles sont la version de période scolaire d’une ligne régulière annuelle. N1/N2 d’Azalys sont des navettes de centre-ville, pas les services nocturnes Fil Bleu portant les mêmes numéros.

MOVE M : la fiche officielle `move-m.pdf`, valable du 9 septembre 2026 au 4 juillet 2027, distingue courses annuelles, cellules scolaires et réservation. Les courses annuelles sans réservation de 06:19 et 09:30 à l’aller, 12:18 et 18:13 au retour sont retenues ; au retour les cellules scolaires Lycée Ronsard et Jean Emond sont retirées, et le trajet commence à la gare TER. Les autres colonnes ne sont pas converties en offre permanente. Le temps reste celui de la course entière choisie, sans composer des minima arrêt par arrêt.

Les attentes sont calculées par date, sens et origine : moitié de la médiane des intervalles, bornée à 2–30 min, avec un repli de 30 min pour les services trop rares. Le multiplicateur et les marges bus existants s’appliquent à ces réseaux. Ce plafond peut sous-estimer une ligne rare ; aucune correspondance à une heure précise n’est garantie.

## Marche et interface

748 nouveaux arrêts sont dans le SERM : ils ont tous une accroche sur le graphe IGN contracté, dans un rayon de 150 m. L’extension ajoute 1 701 paires arrêt-à-arrêt de voirie de 650 m maximum. Les anciennes paires et tous les accès manuels de gares sont conservés. Les deux arrêts hors SERM gardent le repli extérieur existant, explicitement approximatif.

Paramètres → Réseaux de bus permet de désactiver chaque réseau pour le calcul et le dessin, ou de modifier les couleurs par ligne. La désactivation est conservée dans le stockage local et les liens partagés `offbus`. L’arrêt décrit dans la bulle ne provient pas d’un réseau désactivé.

La voirie chargée par le navigateur est inchangée. Le fichier de transport passe d’environ 7,5 à 9,6 Mo non compressés ; sa taille gzip est de 1 286 097 octets. Les anciens caches sont remplacés par `2026-10-04s`.

## Contrôles

- Aucune couverture piétonne manquante.
- 20 614 intervalles B–C supplémentaires vérifiés : aucun temps négatif ni saut dépassant 100 km/h après tolérance d’une minute pour l’arrondi GTFS.
- Les huit validations existantes du workflow de publication passent : topologie piétonne, contraction, marche aux points, surface, routage, continuité TER, bus et estimation spatiale.
- Quatre trajets avec voirie et attente bus à ×0 utilisent effectivement les nouveaux réseaux. Les désactiver retire leurs étapes et augmente le temps de ces exemples.
- Le panneau et sa désactivation ont été vérifiés dans le navigateur ; aucun message d’erreur de l’application observé. Les mesures de calcul locales ne constituent pas une garantie de fluidité sur téléphone physique.

Le détail chiffré est dans `local-bus-integration-audit.json`.

## Complément terminé

Ogalo, Fil Rouge et Le Lien Bléré/Loches sont désormais intégrés. Le total est de 56 lignes locales hors Fil Bleu, 1 077 identifiants d’arrêt et 249 profils. Voir [le compte rendu du complément](LOCAL-BUS-COMPLETION-2026-10-04.md) pour les sélections, exclusions, tracés et validations actuelles.

Les cars régionaux Centre-Val de Loire restent pour le lot suivant. Les services à réservation, scolaires exclus et saisonniers ne sont pas des réseaux locaux manquants à importer comme offre permanente.
