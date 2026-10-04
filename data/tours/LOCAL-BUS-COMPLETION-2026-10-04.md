# Clôture du lot des réseaux locaux — 5 octobre 2026

Les lignes locales présentes dans les horaires officiels sont maintenant intégrées à la carte et au calcul. Le fichier commun contient **56 lignes hors Fil Bleu, 1 077 arrêts et 249 profils de courses complètes**.

| Réseau | Lignes | Arrêts | Profils |
|---|---:|---:|---:|
| Azalys | 29 | 568 | 114 |
| MOVE | 3 | 99 | 13 |
| CVL Mobilité | 1 | 59 | 4 |
| Le Bus Amboise | 1 | 24 | 11 |
| Ogalo | 19 | 268 | 98 |
| Fil Rouge | 1 | 30 | 6 |
| Le Lien Bléré | 1 | 10 | 2 |
| Le Lien Loches | 1 | 19 | 1 |

Ogalo comprend les lignes urbaines et périurbaines validées depuis les fiches actuelles ainsi que la navette Clos Bonnet–Chacé. La ligne L2 (Loudun–Épieds–Saumur) est maintenant incluse à partir de sa fiche actuelle ; les profils dont les arrêts ne correspondent pas au tracé disponible ou dont les horaires impliquent une vitesse impossible sont écartés en entier. L9 reste hors calcul : avec les positions d’arrêt actuellement disponibles, ses trois colonnes publiques extraites impliquent des vitesses impossibles entre arrêts voisins ; je ne publie pas ces trajets avant d’avoir validé les positions sur une source cartographique fiable. L8 (Rémi SO14) est gardée pour le lot régional. Les horaires de l’ancien GTFS expiré ne servent pas au calcul.

Fil Rouge conserve ses horaires ouverts au public pour les périodes de circulation décrites dans la fiche actuelle. Les deux circuits de Loches sont chaînés dans le même véhicule selon les horaires publiés. Bléré conserve les horaires de chaque sens sans composer des courses différentes.

## Réservation et autres exclusions

Les lignes **entièrement sur réservation** sont retirées des données, des tracés, des arrêts affichés et des paramètres : Fil Bleu R3 à R12. Les lignes mixtes gardent leurs courses régulières ouvertes au public ; les courses conditionnelles ne sont pas utilisées comme si elles étaient accessibles sans réservation. Les autres exclusions documentées (service scolaire dédié, nocturne, saisonnier et lignes régionales) restent hors de ce lot. Les cars Rémi/Centre-Val de Loire seront traités séparément.

## Géométrie, marche et calcul

Les horaires donnent les durées entre les arrêts. Les tracés utilisent les géométries officielles quand elles existent ; sinon les positions documentées ont été raccordées à la voirie publique hors navigateur. Les arrêts proches de leur trait sont ancrés dans la géométrie simplifiée : l’écart mesuré après génération est de **0 m** pour les lignes locales testées. Aucun transfert piéton n’est généré pour descendre puis remonter sur la même ligne de bus.

La table de marche a été complétée avec **50 arrêts et 46 paires** de transfert supplémentaires ; aucun de ces arrêts n’est resté sans accrochage à la voirie. Elle relie Ogalo, Fil Rouge, Loches et Bléré aux gares et navettes proches. Le graphe routier préparatoire n’est pas envoyé au navigateur.

Le JSON de carte généré fait 10 743 947 octets et environ 1 406 402 octets compressé gzip. Les mesures sont faites sur le poste de développement ; elles ne préjugent pas des performances de chaque téléphone.

## Validation

- Génération de la carte : 2 642 stations, 32 568 états de ligne, 481 segments de ligne et 29 084 cellules.
- Durées entre arrêts vérifiées par les tests bus : valeurs non négatives et vitesses plausibles ; les colonnes incohérentes sont exclues à la génération.
- Décalage maximal des arrêts locaux par rapport aux lignes simplifiées : 0 m dans le test automatisé.
- 0 transfert artificiel pour descendre puis reprendre la même ligne de bus.
- Scénarios de désactivation vérifiés pour les quatre réseaux ajoutés : Bléré, Fil Rouge, Loches et Ogalo.
- Les tests de marche, transfert rail, continuité TER, données bus, calcul spatial et surface d’isochrone passent.

Les scripts, tables horaires, correspondances d’arrêts, audits de géométrie et sources utilisées sont conservés dans ce dossier et `local-networks-2026-10-04/`. Les fichiers d’origine antérieurs au complément sont sauvegardés dans `archive/tours-before-local-network-completion-2026-10-04/`.
