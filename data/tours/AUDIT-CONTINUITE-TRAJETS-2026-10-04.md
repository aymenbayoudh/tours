# Continuité des trajets — audit du 4 octobre 2026

## Version réellement auditée

Reprise après `ab0029f`, récupération des commits distants. Le graphe JSON commité était ancien : hubs génériques, incompatibles avec les derniers tests. Reconstruction avec `build_data.py` : le résultat **est identique au graphe téléchargé sur GitHub Pages**. L’audit ci-dessous porte sur ce résultat, pas sur l’ancienne copie locale. La reconstruction remet le dépôt en cohérence sans changer le graphe actuellement publié.

## 1. La préférence après 60 minutes n’est pas une règle de validité

`routing.mjs` calcule deux modèles. Le premier minimise le temps ; le second minimise le temps plus une pénalité de 30 minutes par unité de confort. Certains changements pèsent deux unités, soit **60 minutes de préférence**. Ces minutes ne sont pas affichées dans la durée physique du trajet, mais elles décident du chemin. Le résultat bascule du premier au second quand le meilleur temps atteint 60 minutes.

Conséquences : le stitching reste permis sous 60 minutes, et n’est pas interdit au-dessus. Un détour peut contourner une pénalité. Les P→P différents sont pénalisés même s’ils correspondent à une vraie desserte complémentaire ; les P↔K sont maintenant neutres, sauf priorité particulière à Saint-Pierre.

Commits pertinents : `03ab226` (poids), `9cdb04f` (unité de 30 minutes), `e52b391` et `2e777ed` (cas Saint-Pierre). Ils changent les préférences, pas la possibilité physique d’une correspondance.

**Reproduction confirmée, attente ×0 :** Tours → Cinq-Mars-la-Pile sur P1 (11 min), puis Cinq-Mars → La Chapelle-sur-Loire sur un autre P1 (15 min). Le total vaut 33,1 min avec accès/marges. Un profil continu P1 dessert bien Tours et La Chapelle dans cet ordre. Ce découpage ne doit pas gagner simplement en assemblant des portions de trains différents.

## 2. L’interdiction bus/tram est incomplète

Dans `build_data.py`, la boucle locale des hubs interdit de passer de l’arrivée d’une ligne non-TER à son départ **au même arrêt physique**. Mais `connect_transfer_hubs`, qui crée les correspondances à pied entre arrêts, ne reprend pas cette interdiction.

Le graphe actuel contient ces liens de descente/marche/remontée sur la même ligne :

| Mode | Nombre de liens dirigés |
|---|---:|
| Bus | 11 936 |
| Tram | 58 |
| BHNS | 60 |
| TER | 859, incluant les changements au même arrêt |

Ces nombres décrivent des possibilités du graphe, pas autant de trajets erronés. Exemple tram : Gare de Tours → Jean Jaurès, liaison piétonne de 564,2 m, puis possibilité de reprendre TRAM A. Les deux côtés physiques d’un arrêt bus sont également concernés. Une interdiction locale « même arrêt » ne garantit donc pas l’absence de remontée sur la même ligne dans un trajet.

## 3. Les profils horaires restent trop faciles à mélanger

Chaque profil possède ses propres nœuds d’arrivée/départ et ses temps de stationnement. Le trajet continu d’un profil est cohérent. Les hubs regroupent néanmoins plusieurs profils sous un même code, et permettent d’en changer. Le moteur assemble alors les meilleures portions sans vérifier les départs réels de ces trains.

Échantillon : 8 origines, deux valeurs d’attente (×0 et ×1), toutes les destinations présentes, accès initial/final en ligne droite. **26 848 trajets inspectés, 120 avec deux jambes consécutives du même TER ; 72 possèdent une alternative continue dans les profils chargés** (présence et ordre des gares). Le script ne contrôle pas encore les permissions/calendar pour cette qualification d’alternative. Aucun trajet répétant tram/bus n’a été trouvé dans cet échantillon : leur possibilité structurelle est confirmée, pas leur fréquence d’apparition en utilisation sur voirie.

Attention : certaines répétitions correspondent à des dessertes réellement incomplètes. Exemple P65 Saumur → Chantonnay puis Chantonnay → Bournezeau : aucun profil continu chargé ne couvre Saumur → Bournezeau. Interdire toute répétition du même code supprimerait aussi ce type de prolongement ; il faut séparer stitching artificiel et correspondance indispensable, ou représenter les dessertes distinctes explicitement.

## 4. Le rabattement P1→K1 fonctionne actuellement

Attente ×0, dans le graphe publié :

- La Bohalle → Saumur : P1, 23 min en véhicule.
- La Bohalle → Tours : P1 jusqu’à Saumur puis K1, 62,1 min avec accès/marges, branche confort.
- La Ménitré → Tours : P1 jusqu’à Saumur puis K1, 51,1 min, branche temps minimal.

Le seuil n’empêche donc plus **ce cas précis** dans la dernière version. Il reste néanmoins une règle globale fragile, avec pénalisation excessive d’autres correspondances légitimes.

## 5. Saint-Pierre–Tours n’est pas canonisé

Le trajet exact Saint-Pierre → Tours, attente ×0, sélectionne déjà NAVETTE : 5 min en véhicule, 8,6 min avec accès/marges. Mais Saint-Pierre → Saumur sélectionne TER K16 pour les mêmes cinq minutes jusqu’à Tours, puis K1. La règle actuelle ne garantit pas la demande « cette liaison doit toujours être NAVETTE » : elle défavorise seulement certains changements selon le profil entrant.

Définir la liaison comme une connexion ferroviaire locale canonique nécessitera une règle de données et de calcul commune à tous les trajets. Renommer les jambes après calcul ne corrigera ni les coûts ni les bus concurrents. Il faut aussi distinguer le train qui continue réellement jusqu’à Tours d’une véritable descente pour emprunter la navette : la convention d’affichage ne doit pas créer un changement fictif.

## 6. Les tests peuvent passer malgré le problème

Les deux suites `routing.test.mjs` et `ter_profile_preference.test.mjs` passent après reconstruction. Elles vérifient surtout des métadonnées de pénalité et quelques exemples. Certaines fixtures attendent explicitement une sélection différente selon le seuil de 60 min. Leur réussite ne valide pas la continuité systémique des trajets.

Les prochains contrôles doivent vérifier les propriétés demandées : trajet continu lorsqu’une desserte existe, pas de descente/remontée artificielle avec un raccord piéton, conservation des rabattements P→K, prolongement nécessaire d’une desserte partielle, et même résultat dans le moteur sur voirie et sans voirie.

## Correction de fond à préparer

1. Séparer **validité** et **attente utilisateur** : les liaisons impossibles ne doivent pas devenir acceptables en réglant un multiplicateur à zéro.
2. Enregistrer la continuité du service sur les correspondances, y compris à pied entre deux quais/arrêts physiques. Conserver le trajet embarqué jusqu’à la descente réelle.
3. Pour les lignes omnibus, réduire les profils redondants à des dessertes cohérentes par sens. Garder un vecteur de temps issu d’un vrai train, avec stationnements. Garder les profils partiels nécessaires ; ne pas prendre indépendamment le minimum de chaque segment.
4. Préserver les services rapides/Krono et les correspondances vers une autre ligne. Une préférence générale pour P→P n’est pas une règle de réalité ferroviaire.
5. Remplacer le basculement arbitraire à 60 minutes par des contraintes de continuité ; traiter ensuite une éventuelle préférence de confort séparément et explicitement.
6. Définir la convention Saint-Pierre–Tours avant de canoniser les données.

## Modification publiée dans ce lot

Le seuil de magnétisme accepte maintenant des pas de **10 000** au lieu de 50 000, dans les deux entrées HTML. Le graphe commité a été remis à jour pour correspondre au graphe déjà publié. **Les règles de routage n’ont pas encore été changées par cet audit.**

Sources du diagnostic : `build_data.py`, `site/routing.mjs`, `site/walking-engine.mjs`, historique des commits ; script reproductible `scripts/audit_routing_continuity.mjs`, résultats `routing-continuity-audit-2026-10-04.json`. Les originaux sont conservés dans `archive/tours-before-routing-audit-2026-10-04/`.
