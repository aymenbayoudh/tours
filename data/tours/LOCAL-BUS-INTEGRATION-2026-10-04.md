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

## Travail restant, distinct du lot publié

| Réseau / territoire | Première étape nécessaire |
|---|---|
| Ogalo / Saumur Val de Loire | Reconstruire les courses actuelles à partir des fiches urbaines et périurbaines, puis vérifier chaque arrêt/tracé. Le GTFS dédié finit au 31 août 2026. Le contrôle répété de l’agrégat régional actuel ne trouve aucune agence Ogalo ; ne pas prolonger artificiellement son calendrier. Attention aux travaux de la ligne D et aux lignes partagées avec Aléop. |
| Fil Rouge / Château-Renault | Géoréférencer les arrêts et le tracé avec une source vérifiable, puis transcrire les courses régulières de la fiche actuelle. Conserver la version du 2 novembre séparément, avec une date d’application explicite. Les arrêts « sur demande » ne sont pas assimilés automatiquement à une réservation de course. |
| Le Lien / Bléré | Normaliser les cinq rotations de la fiche en image, puis raccorder les coordonnées et le tracé officiels. L’annonce de lancement en juin n’en fait pas une ligne d’été. |
| Le Lien / Loches | Le plan des deux boucles est collecté, mais il manque un horaire complet vérifié et les coordonnées/tracés à normaliser. La page touristique « A plus dans l’bus » traite de cars estivaux Rémi : elle ne justifie pas les horaires du Lien. |
| MOVE non urbain | Reprendre les fiches 7, 8, 9, 13-440, 14 et 492, absentes du GTFS urbain. Vérifier l’autorité et les courses régulières avant de confondre ces lignes locales avec le futur lot régional. |
| Autres EPCI sans offre fixe identifiée | Maintenir l’état « pas de source régulière identifiée », plutôt qu’inventer une ligne à partir d’un service sur réservation. |
| Cars régionaux Centre-Val de Loire | Lot différé selon la demande de l’utilisateur. |

Les sources et versions sont dans `TRANSPORT-SOURCES.md` et `local-networks-2026-10-04/`. Les fichiers originaux avant ce lot sont sauvegardés dans `archive/tours-before-local-bus-integration-2026-10-04/`.
