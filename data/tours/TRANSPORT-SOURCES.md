# Mobilités locales — inventaire des 14 EPCI du SERM de Touraine

Recherche et téléchargements du **4 octobre 2026**. Périmètre de ce lot : services locaux réguliers de journée. Les cars interurbains de la Région Centre-Val de Loire seront traités ensuite. **56 lignes locales sont maintenant intégrées**, hors Fil Bleu : 29 Azalys, MOVE A/TGV/M (3), CVL Mobilité A, Le Bus Amboise Nav1, Ogalo (19), Fil Rouge et Le Lien Bléré/Loches. Les lignes entièrement sur réservation sont exclues ; les courses publiques des lignes mixtes sont conservées. Voir [le complément d’intégration](LOCAL-BUS-COMPLETION-2026-10-04.md).

## Résultat EPCI par EPCI

Le [référentiel national des AOM](https://transport.data.gouv.fr/aoms) est conservé dans `local-networks-2026-10-04/aoms.csv`. Une AOM ne se déduit pas du seul nom du réseau : une commune ou un EPCI peut organiser une navette alors que la Région exerce le rôle d’AOM par substitution.

| EPCI | AOM / périmètre | Offre locale identifiée et données |
|---|---|---|
| Tours Métropole Val de Loire — 243700754 | Syndicat des Mobilités de Touraine (SMT), 25 communes au total | **Fil Bleu déjà intégré**. [GTFS officiel](https://transport.data.gouv.fr/datasets/fil-bleu-syndicat-des-mobilites-gtfs-gtfs-rt). Les services scolaires et nocturnes sont exclus dans le site. |
| Touraine-Est Vallées — 200073161 | SMT pour Vouvray, Vernou-sur-Brenne et La Ville-aux-Dames ; Région par substitution pour les autres communes | Fil Bleu dans ces trois communes. [Guide local des mobilités](https://www.touraineestvallees.fr/guide-des-mobilites-a-touraine-est-vallees/) : TAD et services spécifiques à distinguer du réseau général. Pas de nouveau GTFS local régulier identifié pour les autres communes. |
| CA de Blois « Agglopolys » — 200030385 | CA de Blois Agglopolys | **Azalys : 29 lignes intégrées**, GTFS actuel téléchargé ; lignes urbaines A–H, navettes N1/N2 et lignes périurbaines L. [Horaires officiels](https://bus.azalys.agglopolys.fr/lignes-et-horaires). |
| CA Territoires Vendômois — 200072072 | CA Territoires Vendômois | **MOVE A/TGV et courses annuelles sélectionnées de M intégrées**, GTFS actuel téléchargé. [Fiches horaires](https://move-vendomois.fr/ligne/) également disponibles pour les lignes non urbaines absentes du GTFS. |
| CC Chinon, Vienne et Loire — 200043081 | CC Chinon, Vienne et Loire | **CVL Mobilité A intégrée**, GTFS actuel téléchargé. [Jeu officiel](https://transport.data.gouv.fr/datasets/reseau-cvlmobilite-plan-de-transport-theorique-ligne-a-format-gtfs). |
| CC Touraine Ouest Val de Loire — 200072981 | Région par substitution | **CVL Mobilité A** dessert aussi Bourgueil / Port-Boulet, au-delà de l’EPCI de son AOM : réutiliser la même ligne, pas créer un second réseau. [Présentation locale](https://cctoval.fr/mobilite/). Pas de GTFS supplémentaire local régulier identifié. |
| CC du Val d’Amboise — 200043065 | Région par substitution ; service municipal d’Amboise | **Le Bus Nav1 intégré**, GTFS actuel téléchargé, Nav1 Gare SNCF – Pôle Emploi – Nazelles. [Jeu officiel](https://transport.data.gouv.fr/datasets/ville-damboise-offre-theorique-mobilite-reseau-urbain). |
| CA Saumur Val de Loire — 200071876 | CA Saumur Val de Loire | **Ogalo** : GTFS dédié téléchargé mais périmé. [Fiches urbaines](https://ogalo-saumurvaldeloire.fr/fiches_horaires/fiches-horaires-du-reseau-urbain/) et [périurbaines actuelles](https://ogalo-saumurvaldeloire.fr/fiches_horaires/fiches-horaires-du-reseau-periurbain/) utilisées : A–D, L1–L7, L10–L12, L14–L17 et Clos Bonnet–Chacé intégrées. L9 est exclue temporairement : les positions d’arrêts disponibles rendent toutes les colonnes publiques extraites physiquement incohérentes. L8 (Rémi SO14) attend le lot régional. La Ronde est incluse dans L10. Les lignes TAD pures sont exclues, les arrêts conditionnels sont non embarquables. |
| CC du Castelrenaudais — 243700499 | Région par substitution ; CC AO2 pour les scolaires | **Fil Rouge**, service municipal de Château-Renault. [Horaires officiels](https://www.ville-chateau-renault.fr/mon-quotidien/se-deplacer/bus-urbain-municipal/) téléchargés, versions actuelle et 2 novembre 2026 séparées. Pas de GTFS actuel identifié ; service intégré à partir de la fiche officielle. |
| CC Autour de Chenonceaux Bléré-Val de Cher — 243700820 | Région par substitution ; navette organisée par la CC | **Le Lien – Bléré**, navette annuelle sans réservation, lundi–vendredi, cinq rotations quotidiennes. [Source CC](https://www.cc-autourdechenonceaux.fr/actualites/navette-le-lien/), [annonce municipale avec desserte](https://www.dierre37.fr/actualites/892443). Courses et tracés intégrés ; tableaux officiels conservés. Pas de GTFS actuel complet identifié. |
| CC Loches Sud Touraine — 200071587 | Région par substitution ; navette locale | **Le Lien**, deux boucles gratuites lundi–vendredi entre Loches, Beaulieu-lès-Loches et Perrusson. [Présentation de la communauté de communes](https://www.lochessudtouraine.com/les-solutions-pour-se-deplacer-en-sud-touraine/). Deux boucles intégrées en un profil continu vérifié contre les cinq colonnes officielles ; pas de GTFS actuel complet identifié. |
| CC de Gâtine-Racan — 200073237 | Région par substitution | [Rémi à la demande](https://www.gatine-racan.fr/transport/service-remi-a-la-demande-en-gatine-racan/) et mobilités solidaires identifiés ; pas de nouveau service local fixe avec GTFS identifié. Le TAD avec réservation ne doit pas être simulé comme un bus permanent. |
| CC Touraine Vallée de l’Indre — 200072650 | Région par substitution | [Transport scolaire organisé localement](https://tourainevalleedelindre.fr/services/famille/transport-scolaire/) exclu. Pas de nouveau GTFS local régulier identifié. Les services Rémi restent pour le lot régional. |
| CC Touraine Val de Vienne — 200072668 | Région par substitution | [Sources de la communauté de communes](https://www.cc-tvv.fr/) : TAD et transport régional ; pas de nouveau GTFS local régulier identifié. Les documents anciens de TAD ne constituent pas des horaires actuels de ligne fixe. |

« Pas identifié » décrit le résultat de la recherche dans le PAN et les publications locales ; cela ne prouve pas l’absence de transport. Les limites AOM du référentiel ne remplacent pas les limites IGN 2026 de la carte.

## GTFS originaux récupérés

| Réseau | Lignes dans le fichier brut | Enregistrements stops.txt | Étendue des calendriers | Licence du jeu |
|---|---:|---:|---|---|
| Azalys | 73 | 1 165 | 29/09/2026 – 18/10/2026 | ODbL |
| MOVE | 11 | 166 | 01/09/2026 – 31/08/2033 | Licence Ouverte 2.0 |
| CVL Mobilité | 1 | 92 | 31/08/2026 – 31/08/2028 | Licence Ouverte 2.0 |
| Le Bus Amboise | 1 | 47 | 12/09/2026 – 31/12/2026 | ODbL |
| Ogalo dédié | 20 | 1 080 | 05/04/2026 – 31/08/2026 | ODbL ; conditions particulières signalées par le PAN |

Les nombres d’arrêts comptent les entrées GTFS (quais, sens et parents), pas uniquement les arrêts commerciaux. Les dates sont l’étendue des calendriers du fichier, pas la garantie que chaque ligne circule chaque jour. Le calendrier MOVE jusqu’en 2033 est une valeur technique : les fiches de rentrée 2026 ont une échéance au 4 juillet 2027.

Les archives `.zip` sont conservées intactes, avec URL, empreinte SHA-256 et audit descriptif dans le dossier `local-networks-2026-10-04/`. Les métadonnées conservées sont limitées aux sources statiques. Aucun flux temps réel n’est utilisé.

## Sélection et exclusions préparées

`local-networks-2026-10-04/inventory.json` contient les décisions **par identifiant de ligne**, avec motif et statut. Ce manifeste n’est pas encore un GTFS filtré ni un fichier consommé par le moteur. Les statuts `review-*` imposent une vérification avant import.

### Azalys

- Candidats : A–H, **N1 et N2**, et lignes périurbaines L15 à L32 présentes dans le fichier (avec variantes L16-1/2 et L23-1/2).
- N1/N2 sont des **navettes de centre-ville de journée**, à conserver. [Source officielle](https://bus.azalys.agglopolys.fr/lignes-et-horaires/lignes-urbaines/navettes-centre-ville).
- Exclure les lignes S, Flexo SOIR et les navettes touristiques Châteaux NCH1/NCH2 du lot régulier annuel.
- Rémi16, bien que présent dans le fichier, est reporté au lot régional.
- Pour les lignes mixtes L, préserver les courses générales et vérifier les renforts scolaires au niveau des voyages. Un terminus près d’un lycée ne suffit pas à exclure toute une ligne.

### MOVE

- A et navette TGV : candidates annuelles. Les calendriers nommés `SCOLAIRE_*` et `VACANCES_*` sont ici des variantes normales de période : **ne pas supprimer tous les services portant le mot SCOLAIRE**.
- B–H : sélection générale les écarte provisoirement comme dessertes limitées à la période scolaire. Les PDF B/C et les descriptions GTFS confirment cette restriction. Ce sont des lignes présentées dans l’offre urbaine, pas toutes des circuits réservés aux élèves ; conserver cette distinction dans l’audit.
- M : ligne mixte, à filtrer **course par course**. Sa fiche distingue notamment des courses sur réservation pendant les vacances et des services qui ne fonctionnent pas pendant les vacances. Ne pas l’importer comme une ligne permanente sans conditions.
- ESAT : le GTFS indique PMR ; conditions d’accès à vérifier avant de traiter la ligne comme ouverte à tous.
- La page de fiches comprend également 7, 8, 9, 13-440, 14 et 492, **absentes de ce GTFS**. La [FAQ MOVE](https://move-vendomois.fr/foire-aux-questions-rentree-2026-2027/) distingue ses lignes interurbaines 7/8/9/13/14/M du transport régional. Ne pas reporter automatiquement toutes ces lignes au lot Rémi : vérifier organisateur, conditions et partie locale à partir des PDF référencés dans `official-timetable-links.json`. La FAQ cite aussi J/N non présents dans le GTFS : leur existence actuelle n’est pas confirmée par les fichiers téléchargés.

### CVL Mobilité / Amboise

- CVL A et Amboise Nav1 : candidates régulières, horaires structurés présents.
- CVL a regroupé les anciennes lignes A/B : ne pas ajouter une ancienne ligne B en doublon.
- Exclure la navette estivale de Chinon du lot annuel et distinguer le service Sitradem sur réservation de la ligne A.

### Ogalo

- **Ne pas importer le GTFS dédié expiré** comme offre actuelle. Le [PAN](https://transport.data.gouv.fr/datasets/lignes-arrets-et-horaires-theorique-du-reseau-de-transport-gtfs-netex-saumur-val-de-loire-agglomeration) confirme son échéance au 31 août 2026.
- Les fiches actuelles concernent A/B/C/D et les lignes périurbaines ; les nouvelles dessertes ne se déduisent pas des anciennes coordonnées sans contrôle.
- Écarter circuits scolaires, navettes gare–établissements et lignes estivales. Les courses à réservation dans les lignes mixtes demandent un traitement distinct.
- Les [navettes de zones industrielles](https://ogalo-saumurvaldeloire.fr/fiches_horaires/horaires-des-navettes-zones-industrielles/) Clos Bonnet / La Ronde sont des candidates de mobilité quotidienne, absentes de l’ancien inventaire. Vérifier leurs fiches et conditions, sans les assimiler à du transport scolaire à cause d’une période de circulation.
- Certaines fiches partagent une ligne avec Aléop, et L8 cite désormais Rémi SO14 : vérifier l’opérateur et éviter les doublons régionaux.
- Le référentiel AOM marque Saumur « à jour » via des données agrégées : cela **ne rend pas le GTFS dédié actuel**. Le contrôle de l’agrégat Pays de la Loire est enregistré dans `ogalo-aggregate-check.json` : aucune agence Ogalo/Saumur n’y est présente ; les correspondances trouvées vers Saumur relèvent notamment d’Aléop/SNCF, et ne remplacent pas les lignes urbaines Ogalo.

### Navettes sans GTFS

- Fil Rouge : séparer l’horaire actuel (jusqu’au 30 octobre) et le nouveau du 2 novembre ; ne pas fusionner leurs temps de trajet.
- Le Lien – Bléré : lancement en juin **ne signifie pas saisonnier** ; l’annonce précise un fonctionnement toute l’année sans réservation.
- Le Lien – Loches : deux boucles actuelles, ne pas réutiliser comme référence le vieux minibus social décrit dans les publications antérieures.
- Les PDF et images sont librement consultables ; aucune licence ouverte explicite n’a été identifiée pour ces documents. Les sources GTFS ont, elles, des licences déclarées. Les transcriptions doivent rester accompagnées de leur provenance.

## Suite de l’import

1. Actualiser Azalys au moment de l’import (le fichier collecté expire le 18 octobre).
2. Valider les courses générales des réseaux mixtes ; récupérer les horaires complets du Lien à Loches.
3. Transcrire les petites navettes et reconstruire Ogalo à partir des sources actuelles.
4. Importer par réseau avec identifiants préfixés, sens et permissions de montée/descente, temps entre arrêts tirés des horaires et calendriers cohérents.
5. Adapter les paramètres de bus, les étiquettes et le multiplicateur d’attente aux réseaux ajoutés ; contrôler les correspondances à pied et la taille des données avant publication.
6. Puis traiter les cars régionaux Centre-Val de Loire, avec dédoublonnage des lignes déjà présentes dans les fichiers locaux.

L’ancien inventaire est conservé dans `archive/tours-before-local-networks-inventory-2026-10-04/`.

## Clôture du complément local

Voir `LOCAL-BUS-COMPLETION-2026-10-04.md` : sources actuelles, exclusions finales de MOVE non urbain, validation des nouveaux arrêts et contrôle des correspondances. Les listes « candidats » ci-dessus retracent la phase de recherche, pas des lignes restant automatiquement à importer.
