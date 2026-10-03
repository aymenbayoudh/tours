# Inventaire des sources de transport — SERM de Touraine

État vérifié le 3 octobre 2026. Ce fichier distingue les données déjà intégrées des sources candidates : un jeu de données listé ici n'est pas automatiquement pris en compte dans le calcul.

## Intégré

### Fil Bleu — Syndicat des Mobilités de Touraine

- Statut : **intégré** (bus ; tram A reste géré par la couche tram existante).
- Source officielle : Tours Métropole Val de Loire / Syndicat des Mobilités de Touraine.
- Catalogue PAN : https://transport.data.gouv.fr/datasets/fil-bleu-syndicat-des-mobilites-gtfs-gtfs-rt
- GTFS courant observé : validité 30/09/2026 → 01/01/2027.
- Licence : Licence Ouverte 2.0.
- Le fichier distingue arrêts physiques et zones/stations commerciales ; les arrêts physiques sont conservés séparément dans le moteur.
- Réduction utilisée par le site : semaine de référence du 5 au 11 octobre 2026, motifs représentatifs, permissions de montée/descente conservées, attente par ligne dérivée des intervalles observés.

## Sources actuelles à intégrer dans un lot ultérieur

### Rémi — Région Centre-Val de Loire

- Rôle : réseau interurbain, notamment Rémi 37 et Rémi 41 pour la majorité des EPCI du SERM hors Tours Métropole.
- Ressource PAN : https://transport.data.gouv.fr/resources/83530
- GTFS observé le 03/10/2026 : validité générale à partir du 29/09/2026 ; couverture Rémi 37 jusqu'au 01/11/2026 et Rémi 41 jusqu'au 28/02/2027.
- Ne pas importer tout le réseau régional sans filtrage spatial et de services : sélectionner les lignes réellement utiles au périmètre et aux connexions du SERM.

### Azalys — CA de Blois « Agglopolys »

- Statut : source GTFS actuelle, **non intégrée**.
- Jeu : https://transport.data.gouv.fr/datasets/agglopolys-offre-theorique-mobilite-reseau-urbain-azalys-de-blois
- Ressource : https://transport.data.gouv.fr/resources/83526
- Validité observée : jusqu'au 18/10/2026 ; environ 73 lignes, 758 points d'arrêt sur la ressource courante.

### MOVE — CA Territoires Vendômois

- Statut : source GTFS actuelle, **non intégrée**.
- Jeu : https://transport.data.gouv.fr/datasets/gtfs-move-vendome
- Ressource : https://transport.data.gouv.fr/resources/82832
- Validité observée : 01/09/2026 → 31/08/2033 ; 11 lignes et 166 points d'arrêt.

### CVL Mobilité — CC Chinon, Vienne et Loire

- Statut : source GTFS actuelle, **non intégrée**.
- Jeu : https://transport.data.gouv.fr/datasets/reseau-cvlmobilite-plan-de-transport-theorique-ligne-a-format-gtfs
- Une ligne régulière relie notamment Saint-Benoît-la-Forêt, Chinon, Beaumont-en-Véron, Avoine, Port-Boulet et Bourgueil.
- Validité observée : 31/08/2026 → 31/08/2028.
- Cette source est importante pour ne pas confondre la suspension ferroviaire P21 avec une absence générale de transports dans le secteur.

### Le Bus — Ville d'Amboise

- Statut : source GTFS actuelle, **non intégrée**.
- Jeu : https://transport.data.gouv.fr/datasets/ville-damboise-offre-theorique-mobilite-reseau-urbain
- Ressource : https://transport.data.gouv.fr/resources/83528
- Validité observée sur la ressource courante : 12/09/2026 → 31/12/2026 ; 1 ligne, 24 points d'arrêt.

## Source à ne pas intégrer telle quelle actuellement

### Ogalo — CA Saumur Val de Loire

- Jeu : https://transport.data.gouv.fr/datasets/lignes-arrets-et-horaires-theorique-du-reseau-de-transport-gtfs-netex-saumur-val-de-loire-agglomeration
- Ressource GTFS directe : https://transport.data.gouv.fr/resources/81416
- Le GTFS publié directement au PAN est indiqué **périmé** et s'arrête au 31/08/2026.
- Ne pas utiliser silencieusement ce fichier pour la semaine du 5 au 11 octobre 2026. Chercher une ressource actuelle (producteur, agrégat régional ou autre source officielle) avant intégration.

## EPCI sans réseau local identifié ici

Pour Val d'Amboise hors service municipal d'Amboise, Loches Sud Touraine, Touraine Val de Vienne, Touraine Vallée de l'Indre, Touraine Ouest Val de Loire, Touraine-Est Vallées, Gâtine-Racan, Castelrenaudais et Autour de Chenonceaux Bléré-Val de Cher :

- Rémi 37 / Rémi 41 est la première source structurée à examiner ;
- vérifier ensuite les navettes locales, TAD et éventuels services propres avant de conclure à une absence d'offre ;
- ne pas supposer qu'un GTFS unique couvre tous les 14 EPCI.

## Ordre d'intégration proposé

1. Stabiliser Fil Bleu et la marche sur voirie.
2. Ajouter Rémi 37/41 avec filtrage spatial et contrôle des doublons avec le rail.
3. Ajouter les réseaux locaux actuels : Amboise, CVL Mobilité, Azalys et MOVE.
4. Traiter Saumur seulement avec une source valide pour octobre 2026.
