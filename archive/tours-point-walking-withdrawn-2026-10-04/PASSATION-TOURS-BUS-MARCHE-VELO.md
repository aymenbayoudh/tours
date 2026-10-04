# Passation — fiabiliser Tours, ajouter les bus, la marche sur voirie et le vélo

## Mise à jour — 4 octobre 2026 : lot marche depuis/vers les points libres

Le lot 1 demandé lors de la reprise (finir la marche sur voirie) est publié et validé au commit `59457ba` : accès départ→arrêt, arrêt→destination et marche seule utilisent le graphe IGN préparé dans le SERM. Hors couverture, le repli géométrique est signalé ; un point du SERM sans raccord court plausible n’est pas relié artificiellement en ligne droite. Les raccords locaux et l’accès manuel St-Pierre restent des approximations explicites.

Préparation : `scripts/prepare_point_walking.py`. Moteur : `site/walking.mjs` et `site/routing.mjs`. Tests de contraction, franchissements et accès : `tests/point_walking_preparation.test.py`, `tests/point_walking.test.mjs`. Données statiques compactes, environ 5,6 Mo gzip supplémentaires au chargement initial. Le glissement conserve un calcul courant borné aux seuils affichés, complété au relâchement. Détails et limites : README et WALKING-AUDIT du dépôt.

**Prochaine étape fonctionnelle : vélo seul et vélo jusqu’à une gare/un arrêt.** Les réseaux bus hors SMT restent également à intégrer. La validation tactile sur téléphone réel et l’accessibilité au clavier restent des vérifications distinctes.

Les sections plus anciennes ci-dessous restent la feuille de route historique ; ne pas réimplémenter les lots déjà livrés.

## Point de reprise — 3 octobre 2026, commit `6d2c554`

Les sections suivantes constituent la feuille de route initiale, pas une liste de
travaux tous encore absents. Reprise effectuée après `c225f22`, avec conservation
des nouveaux commits jusqu'à `8c0f451` :

- Bus SMT déjà intégrés : 48 lignes Fil Bleu, 1 674 points de transport au total,
  334 motifs horaires représentatifs. Les sources normalisées bus et le fichier
  complet du site sont désormais versionnés : tests locaux et déploiement utilisent
  les mêmes données validées. Mise à jour GTFS explicite, plus de téléchargement
  mutable à chaque publication.
- Correspondances piétonnes BD TOPO : tests réussis, y compris Porte de Loire–Place
  Choiseul, Jumeaux et les accès de gare documentés. Voir `WALKING-AUDIT-2026-10-03.md`
  dans le dépôt. Les accès depuis un point libre et la marche directe/finale ne
  sont pas encore calculés sur voirie.
- Index spatial exact ajouté au moteur pour accélérer la grille : 38 149
  comparaisons exhaustives, aucun écart. Trois mesures sur la même machine :
  70–88 ms contre 1 366–1 798 ms pour la grille seule. Les 338 959 assertions de
  routage passent également. Test ajouté : `tests/spatial_estimate.test.mjs`.
- Préparation vélo arrivée dans des commits concurrents, conservés par rebase :
  profil BD TOPO dirigé, tests de profil verts et outil `scripts/audit_bike_graph.py`.
  Ce n'est pas encore un mode vélo intégré à l'interface et au moteur multimodal.
- Sauvegarde : `archive/tours-before-resume-2026-10-03/`.

Prochaine étape fonctionnelle : terminer les accès piétons depuis/vers des points
libres avec une architecture mesurée, puis intégrer les modes vélo. Lire les
nouveaux commits avant toute reprise : le dépôt a continué d'évoluer pendant cette
intervention. Ne pas réimplémenter les lots ci-dessus.

## 1. Demande de l’utilisateur

Faire évoluer le site existant, sans perdre sa simplicité ni sa réactivité :

1. Corriger les bugs relevés dans l’audit.
2. Optimiser les calculs lorsque les mesures montrent que c’est nécessaire.
3. Ajouter les bus et leurs arrêts à partir des données ouvertes du SMT / Fil Bleu.
4. Améliorer les accès à pied et les correspondances en utilisant la voirie réelle.
5. Ajouter le vélo.

**Les scénarios de changement de fréquence sont abandonnés.** Ne pas développer d’éditeur de fréquences, de comparaison de scénarios de desserte ou de calcul sur plusieurs heures de départ. Le site reste un outil d’estimation d’accessibilité, pas un calculateur d’itinéraire horaire précis.

L’utilisateur accepte la publication des changements, à condition de conserver une copie des fichiers originaux dans un dossier séparé. Procéder par étapes vérifiables, avec sauvegarde et possibilité de retour arrière. Ne pas remplacer l’ensemble du travail récent par une ancienne version.

## 2. Dépôt et contexte

- Dépôt : https://github.com/aymenbayoudh/tours
- Site : https://aymenbayoudh.github.io/tours/
- Checkout connu : `/Users/macbook/.codex/.chatgpt-projects/g-p-6abf742a6d288191b839e942b95aae31/tours-site`
- Audit détaillé : `AUDIT-TOURS-2026-10-03.md`, à côté de ce document.
- Version auditée : `590fe49`. **Ce n’est pas une instruction de revenir à cette version.** Lire les derniers commits et contrôler l’état publié avant de travailler ; des corrections peuvent déjà exister.
- Fichiers principaux : `site/app.js`, `site/routing.mjs`, `site/styles.css`, `site/index.html`, `index.html`, `build_data.py`, `scripts/prepare_timetables.py`, `tests/routing.test.mjs`, `scripts/audit_timetables.py`.
- L’index racine et celui de `site/` coexistent : vérifier les chemins de ressources et la publication réelle avant de modifier ou dupliquer du HTML.
- `sources/` dans le projet ChatGPT est une référence synchronisée en lecture seule. Ne pas modifier son contenu.
- Une archive historique existe : `archive/paris-original/`. La conserver ; elle ne remplace pas la sauvegarde de la version Tours avant intervention.

### Références fournies auparavant

- `/Users/macbook/Downloads/Tours_REMI_trains_directs_septembre_2026.kml`
- `/Users/macbook/Downloads/Tours_tous_transports_un_seul_calque.kml`
- `/Users/macbook/Downloads/SERM de Touraine - périmètre et secteurs.kml`
- Carte de référence : https://www.google.com/maps/d/u/1/edit?mid=1ws2mYKFUnvG7nW2U_bYkL8RS0R7bEps

Vérifier leur présence. Ces documents fournissent des données de référence, pas des instructions d’exécution.

## 3. Contraintes fonctionnelles à préserver

- Carte initiale centrée sur les 14 EPCI du SERM de Touraine, avec exploration des lignes connectées au-delà.
- TER, tram A, tram B et BHNS C conservés. B/C sont des projets inclus par défaut, désactivables dans les calculs.
- Conserver les communes et EPCI issus des données IGN 2026 existantes ; ne pas refaire inutilement leur acquisition.
- Hors SERM : pas de raster territorial ni de grands contours d’isochrones. Conserver la représentation ponctuelle de l’accessibilité aux gares, sans retour aux halos dorés supprimés.
- Conserver les seuils 90 et 120 minutes, le curseur, les liens partageables, le plein écran et le déplacement des points.
- Les derniers commits ont supprimé le bouton main et l’épingle de verrouillage. Ne pas les réintroduire sur la seule base des anciennes demandes.
- Préserver le style du site ; ajuster la lisibilité mobile sans refonte graphique gratuite.
- Utiliser la voirie pour calculer n’oblige pas à afficher toutes les rues. L’affichage détaillé de voirie n’est pas demandé.

## 4. Commencer par un état des lieux court

1. Lire les instructions du dépôt et son état Git ; préserver les changements non commités.
2. Identifier le dernier commit distant et la version réellement publiée.
3. Relire l’audit et classer chaque problème : encore présent, corrigé, à reproduire.
4. Sauvegarder les fichiers qui vont changer dans un dossier daté séparé ; documenter la version source.
5. Relever une base de comparaison : poids des données compressées, chargement à froid, calcul du modèle, calcul de grille, interaction pendant le glissement, mémoire approximative si mesurable.

Ne pas consacrer une nouvelle longue recherche à des éléments déjà prouvés. Les reproduire de façon ciblée sur la version courante.

## 5. Bugs et limites identifiés dans la version auditée

### A. Partage incomplet des paramètres de calcul

Les attentes et malus sont enregistrés localement mais absents de `syncUrl()`. Un même lien peut produire des résultats différents selon le navigateur.

Exemple du moteur audité : Tours → Blois-Chambord, 50,6 min avec 15 min d’attente TER, contre 35,6 min avec une attente à zéro.

**Attendu :** un lien encode les paramètres qui changent les résultats, avec un mécanisme de version/default explicite. Les paramètres du lien priment sur les préférences locales. Préserver la compatibilité des anciens liens autant que possible.

### B. Petites poches d’isochrone perdues au dézoom

La grille générale contient 29 084 cellules d’environ 585 × 542 m. Exemples depuis Tours, paramètres par défaut :

| Gare | Temps exact au point | Seuil | Minimum des quatre centres de cellules voisins |
|---|---:|---:|---:|
| Cinq-Mars-la-Pile | 29,60 min | 30 min | 31,66 min |
| Montlouis | 29,60 min | 30 min | 33,01 min |
| Chenonceaux-Chisseaux | 43,60 min | 45 min | 46,98 min |
| Rotière | 28,72 min | 30 min | 31,15 min |

Le calcul à la gare est cohérent, mais le raster peut manquer la poche. Le renforcement ponctuel est limité aux gares hors SERM. La dernière couleur du dégradé est entièrement transparente, ce qui peut aussi effacer la représentation au plafond.

**Attendu :** rendre visibles les petites accessibilités sans falsifier leur superficie. Préférer un échantillonnage adaptatif intégrant les gares ; si une taille minimale de symbole est utilisée, la distinguer d’une surface géographique réelle. Vérifier intérieur et extérieur du SERM et éviter de doubler les effets déjà lisibles.

### C. Exception P21 Tours–Chinon mal qualifiée

Dans la version auditée, P21 utilise une estimation géométrique à 50 km/h et non un motif ferroviaire GTFS. Tours → Chinon donne environ 78,45 min, dont 59,85 min à bord estimées. Les autres motifs sans horaires sont les projets B/C.

**Attendu :** vérifier les données officielles disponibles pour la période retenue et identifier clairement le mode et la provenance du temps. Ne pas inventer un train ni présenter cette estimation comme une durée horaire vérifiée. Ne pas conclure de l’absence dans une sélection GTFS à une fermeture permanente de ligne.

### D. Suite de tests devenue incohérente avec le moteur

`tests/routing.test.mjs` échoue sur l’oracle de plus court chemin. Diagnostic précédent : les correspondances recalculées depuis les coordonnées arrondies diffèrent des coûts enregistrés d’au plus 0,056 seconde dans le cas comparé.

**Attendu :** corriger l’oracle indépendant pour représenter les coûts actuels ; garder des tolérances justifiées. Ne pas supprimer l’assertion ni déclarer tous les calculs erronés sur ce seul écart.

### E. Lisibilité et détails d’interface

- Textes de bulle d’arrivée à 8–9 px : améliorer la lisibilité tout en gardant une bulle compacte.
- Vue mobile 390 × 844 : en-tête long, outils sur deux lignes, bulle de Tours et labels encombrants.
- Le remplissage EPCI opaque peut masquer les réglages de couleur des communes.
- Message « survolez pour choisir un départ » incompatible avec l’interaction actuelle.
- Légende du curseur et durée utilisée pour le pourcentage peuvent différer : clarifier leur rôle.
- Carte Canvas sans alternative complète au clavier : une sélection textuelle des gares/arrêts serait utile, à proportion du travail demandé.

## 6. État du moteur : acquis à préserver

Au moment de l’audit :

- 237 arrêts, 139 motifs horaires représentatifs.
- 1 428 horaires d’arrêt vérifiés contre les archives GTFS ; aucun arrêt omis dans les trajets sélectionnés.
- 8 392 intervalles entre arrêts contrôlés avant l’échec final de l’oracle.
- Durées à bord et arrêts intermédiaires conservés depuis un trajet réel représentatif par desserte.
- Entrée/sortie par défaut : 1,8 min chacune ; attente TER 15 min, navette 5 min, tram 4 min, BHNS 3,25 min.
- Correspondance même gare : 3,5 min + attente du nouveau service. Entre arrêts distincts reliés jusqu’à 650 m : marche + 2 min + attente.
- Rester à bord d’un même service ne déclenche pas une nouvelle attente.
- Marcher directement est une possibilité concurrente du transport.
- Désactiver les projets retire leurs états du calcul et ne doit jamais améliorer un temps, à hypothèses constantes.

Les données horaires retenaient la semaine du 5 au 11 octobre 2026. Les correspondances ne sont pas synchronisées à une heure précise. Conserver une explication honnête de cette limite ; les scénarios de fréquence et l’échantillonnage de multiples heures de départ sont hors périmètre.

## 7. Optimisation : mesurer avant de réécrire

Le calcul de la grille seule prenait 152–177 ms sur cinq passages Node, hors dessin. Les données représentaient 3,11 Mo décompressés et environ 483 ko transférés compressés. Ce sont des mesures historiques, pas des objectifs ni des garanties mobiles.

### Travail recommandé

1. Séparer le coût du moteur transport, des accès piétons/vélo, de la grille et du dessin.
2. Réutiliser les résultats lorsque seuls le déplacement de carte ou le style changent.
3. Préparer des listes d’accès pertinentes par cellule ; éviter de tester chaque arrêt pour chaque cellule.
4. Utiliser un index spatial pour les recherches de proximité.
5. Déporter les calculs coûteux dans un worker, avec identifiants de requête pour ignorer les résultats périmés. Le worker préserve la réactivité mais ne réduit pas, à lui seul, le travail effectué.
6. Pendant un glissement, produire un aperçu moins détaillé ou déplacer le rendu précédent ; affiner à la fin. Préserver la cohérence entre marqueurs, temps et couche affichée.
7. Simplifier les géométries uniquement pour l’affichage. Ne pas dériver les temps d’un tracé simplifié.

**Attention :** ne pas retenir arbitrairement « les trois arrêts les plus proches ». Un arrêt légèrement plus éloigné peut offrir une desserte beaucoup plus rapide. Toute réduction des candidats doit avoir une justification et être comparée à une référence exhaustive sur des cas ciblés.

Commencer avec une architecture statique compatible GitHub Pages. Si les mesures montrent qu’un serveur est nécessaire, expliquer le coût et le compromis avant de choisir un service payant ou une dépendance d’exploitation.

## 8. Bus — données et intégration

### Sources souhaitées

L’utilisateur veut utiliser les données ouvertes officielles du **SMT / Fil Bleu** pour les lignes et arrêts. Chercher les jeux actuels sur le portail Tours Métropole et les ressources de l’autorité organisatrice. Un GTFS statique est préférable pour identifier les services et leurs durées ; un flux GTFS-RT seul ne le remplace pas.

Pour les EPCI hors du réseau SMT, la source n’est pas encore choisie. Dresser d’abord un inventaire des réseaux pertinents : autorités organisatrices locales, Région/Rémi, ressources référencées sur transport.data.gouv.fr. Vérifier la couverture effective ; ne pas supposer qu’un fichier couvre les 14 EPCI et ne pas bloquer l’intégration SMT en attendant le reste.

### Préparation

- Télécharger les sources identifiées, relever URL, licence, date de récupération et période de validité.
- Conserver un manifeste reproductible et une procédure de reconstruction ; respecter les licences et attributions.
- Distinguer `routes`, `trips`, `stops`, `stop_times`, calendriers et `shapes` si GTFS disponible.
- Un tracé/KML n’est pas une table de durées ni une preuve de fréquence.
- Préserver les directions, branches, variantes et restrictions de montée/descente. Éviter de fabriquer un trajet en mélangeant plusieurs services incompatibles.
- Dédupliquer avec prudence les arrêts physiques partagés, sans fusionner les deux côtés d’une route ou les quais incompatibles.
- Réutiliser les principes des motifs représentatifs actuels lorsque cela convient. Signaler les temps estimés et les données manquantes.
- L’attente des bus doit être une hypothèse explicite ou une valeur documentée ; ne pas leur appliquer silencieusement les 15 min des TER. Les réglages existants peuvent être étendus sobrement, sans éditeur de fréquence.
- Vérifier les correspondances bus–bus, bus–tram et bus–train, d’abord avec les accès existants puis avec les cheminements réels.

### Affichage

Les bus doivent participer au calcul même lorsque leurs tracés ou leurs petits arrêts sont masqués au dézoom. Adapter les détails visibles au zoom pour éviter un amas de lignes et de noms. Indiquer clairement les filtres qui modifient seulement l’affichage et ceux qui modifient le calcul.

Le pourcentage d’arrêts accessibles change de sens quand des centaines d’arrêts de bus sont ajoutés. Préciser son dénominateur et le réseau retenu ; ne pas présenter sa variation comme une mesure directe du nombre d’habitants desservis.

## 9. Marche — voirie officielle et préparation en amont

L’utilisateur mentionne notamment la **BD TOPO de l’Indre-et-Loire** comme source disponible. C’est une piste prioritaire à examiner, pas une preuve que tous les attributs nécessaires y sont exploitables sans préparation.

### Vérifier avant de choisir

- Édition disponible, licence, système de coordonnées, couverture géographique et actualité.
- Connectivité, ponts, tunnels, passages à niveaux, escaliers, voies privées et restrictions piétons/vélos.
- Un croisement géométrique ne constitue pas forcément une connexion : respecter les différences de niveau.
- Les géométries doivent former un graphe navigable ; la proximité de deux extrémités ne justifie pas automatiquement de les raccorder.
- L’Indre-et-Loire ne couvre pas nécessairement tous les secteurs du SERM ni les gares lointaines. Définir la couverture et traiter explicitement ses limites.

Si des informations indispensables manquent, comparer une autre source officielle ou un complément OpenStreetMap, en documentant les raisons et licences. Ne pas charger un export départemental brut complet dans chaque navigateur.

### Architecture proposée, à valider par mesure

- Construire hors ligne un graphe piéton compact, avec accès des gares/arrêts raccordés de façon plausible.
- Préparer les temps entre arrêts proches et les accès entre cellules cartographiques et arrêts pertinents.
- Calculer à l’exécution les accès depuis un départ arbitraire et la marche directe, sur un graphe local/compact ou une structure accélérée.
- Réutiliser les tables fixes tant que la voirie et le profil de marche ne changent pas.
- Ne pas confondre un simple raccord au segment le plus proche avec un accès réellement possible : vérifier gares, quais, rivières et voies rapides.
- Éviter de cumuler deux fois une même durée d’accès réelle et un ancien malus prévu pour la représenter. Conserver séparément les marges résiduelles, documentées.

Pour les secteurs hors couverture, annoncer clairement l’approximation conservée ou l’indisponibilité. Ne pas alterner silencieusement entre marche sur voirie et marche à vol d’oiseau.

## 10. Vélo — modes simples et explicites

Prévoir au minimum :

1. **Vélo seul** : trajet complet sur voirie autorisée au vélo.
2. **Vélo jusqu’à une gare/un arrêt + transports** : vélo laissé au point d’embarquement, puis marche et transports. Après embarquement, le vélo ne doit pas réapparaître à destination ou à une correspondance.

La marche + transports reste disponible. Ne pas ajouter implicitement le vélo embarqué, le vélo partagé à destination ou l’autorisation d’emporter son vélo dans tous les bus/trams.

Utiliser un graphe/profil vélo distinct du profil piéton : sens de circulation et exceptions cyclables, voies interdites, escaliers et sections à parcourir à pied si prises en charge. Ne pas rendre cyclables toutes les arêtes piétonnes en changeant simplement leur vitesse.

Choisir et afficher une hypothèse de vitesse documentée. Un profil vélo électrique est facultatif et vient après une première version correcte. Ne pas promettre pente, confort ou sécurité si les données et le modèle ne les prennent pas réellement en compte.

Prévoir le temps de stationnement du vélo comme hypothèse explicite. La disponibilité d’un stationnement sécurisé n’est pas garantie sans données spécifiques.

## 11. Vérifications attendues à chaque étape

La présente passation prévoit explicitement des tests et mesures :

- Comparaison des durées du moteur avant/après une optimisation sans changement de modèle ; aucune différence inexpliquée.
- Intervalle B → C conservé dans un même service, sans nouvelle attente à chaque arrêt.
- Correspondances entre motifs différents, y compris sur un même numéro de ligne ; montée/descente interdites respectées.
- Aucun résultat d’un calcul ancien n’écrase celui du dernier déplacement.
- Ajout d’un mode optionnel ne dégrade pas le minimum théorique à hypothèses identiques ; désactivation retire réellement ses arcs/états.
- Tests de partage dans un contexte avec préférences locales différentes.
- Petites poches aux gares citées, limites du SERM, dézoom/zoom et plafond du dégradé.
- Marche : franchissement de Loire/Cher par un pont autorisé, barrière ferroviaire, impasse, accès de gare.
- Vélo : interdiction routière, sens unique avec ou sans exception documentée, vélo laissé à la gare et non disponible après le train.
- Bus : variante courte, terminus, trajet sans arrêt, correspondance intermodale et arrêt sur la rive opposée.
- Interface mobile, glissement des deux points, déplacement de carte, zoom, plein écran, options, fermeture des panneaux et absence d’erreur console.
- Mesures chargement froid/chaud, données compressées et latence de calcul, avec environnement précisé. Un navigateur redimensionné ne remplace pas une vérification tactile sur téléphone réel ; signaler ce qui n’a pas été testé.

## 12. Découpage et livraison

Avancer par lots courts :

1. Bugs confirmés et remise en état des tests.
2. Optimisations mesurées, sans modifier les résultats.
3. Bus SMT, avec inventaire séparé des réseaux hors SMT restant à intégrer.
4. Marche sur voirie et correspondances réelles.
5. Vélo et contrôles de non-régression.

Pour chaque lot : décrire les changements, fournir les résultats des vérifications, les limites restantes et la procédure de retour arrière. Ne pas annoncer « toutes les correspondances sont bonnes » si seule la cohérence du graphe a été contrôlée.

Avant publication, vérifier la page réellement servie, les chemins des ressources et l’invalidation des caches. Après publication, vérifier le chargement du site public. Conserver la sauvegarde demandée et ne pas supprimer les archives précédentes.

## 13. Manière de travailler

L’objectif est de limiter le coût et les allers-retours : réutiliser l’audit et les scripts existants, traiter un lot à la fois, éviter les recherches redondantes et les refontes sans bénéfice mesuré. Expliquer les choix en français simple. Demander une précision uniquement si elle bloque un choix important ; sinon prendre une décision raisonnable, réversible et documentée.

Ne pas installer une infrastructure lourde, souscrire une API payante ou ajouter un serveur permanent par anticipation. Présenter un besoin concret et mesuré si la solution statique atteint ses limites.
