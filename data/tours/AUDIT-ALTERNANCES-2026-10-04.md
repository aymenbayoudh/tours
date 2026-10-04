# Audit systémique des alternances — 4 octobre 2026

## Conclusion

**Le défaut TER persiste après `d9b139c`.** La correction locale de Baule→Le Vieux-Briollay et celle de Tours→Saint-Pierre→Orléans ne suffisent pas à valider la continuité du réseau entier. Des alternances A→B→A existent encore sur 12 codes TER ; 9 de ces codes ont au moins un cas où les profils chargés offrent un service continu dans le même sens.

Ce lot est un diagnostic : il ne modifie ni le moteur ni les données publiées. Il ne présente pas un changement de test ou une nouvelle pénalité comme une correction de ces parcours.

## Méthode et périmètre

- Version auditée : `d9b139c14d9469ca7b8518876a43ef86ee920923`.
- Matrice ferroviaire complète : 181 gares × 181 gares × attente ×0/×0,5/×1 = **98 283 recalculs**.
- Contrôle multimodal : 393 origines (première, milieu et dernière gare/arrêt de chaque profil, plus les points des lignes estimées), 1 678 destinations, attente ×0/×1 = **1 318 908 recalculs**. Les origines permettent l'embarquement sur les **60 codes effectivement calculables** du graphe, avec les projets activés. Les dix lignes BUS R3–R12 sont présentes dans le catalogue mais sans embarquement (`calculationAvailable: false`, courses sur réservation exclues) : elles ne sont pas testées comme services calculables.
- Accès initial/final en ligne droite. Les correspondances préparées entre arrêts conservent les données du graphe publié. Ce contrôle ne couvre pas chaque point arbitraire avec accès par voirie, ni toutes les valeurs des marges, vitesses et options.
- Une répétition signifie que le trajet quitte un code de ligne puis l'utilise à nouveau, ou enchaîne deux profils distincts sous le même code. Les compteurs sont des **événements de retour**, pas nécessairement des trajets distincts.
- Une alternative continue signifie qu'un profil chargé contient le premier embarquement et la dernière descente dans cet ordre. Ce signal ne vérifie pas les calendriers, les permissions d'embarquement, une heure de départ ou les attentes synchronisées : il ne prouve pas que tous les cas signalés correspondent au même train disponible le même jour.

## Résultats ferroviaires

| Code | Retours observés | Profil continu chargé pour le segment répété |
|---|---:|---:|
| TER K39 | 994 | 429 |
| TER K15 | 178 | 4 |
| TER P15 | 14 | 14 |
| TER P14 | 240 | 4 |
| TER K1 | 1073 | 1073 |
| TER P7 | 18 | 6 |
| TER P1 | 24 | 7 |
| TER P16 | 46 | 46 |
| TER P65 | 44 | 0 |
| TER P30 | 176 | 165 |
| TER P166 | 2 | 0 |
| TER P5 | 8 | 0 |

Total : **2 817 retours**, dont **1 748 avec un profil continu candidat**. Les retours sans profil continu doivent être examinés séparément ; certaines dessertes partielles nécessitent une vraie correspondance. Interdire toutes les répétitions indistinctement ferait perdre des liaisons.

Exemples confirmés avec attente ×0 :

1. Alençon→Azay-le-Rideau : K39 Alençon→Le Mans, P30 Le Mans→Château-du-Loir, K39 Château-du-Loir→Tours, puis P21. Un profil K39 continu Alençon→Tours est chargé.
2. Avord→Ancenis : après P7 jusqu'à Tours, K1 Tours→Saumur, P1 Saumur→Angers, K1 Angers→Ancenis. Un profil K1 continu Tours→Ancenis est chargé.
3. La Hutte-Coulombiers→Amboise : P30→K39→P30→K39 puis P166. Un profil P30 continu couvre la portion répétée.
4. Thouaré→Alençon : le trajet inclut Angers→Angers Maître École sur P15 puis le retour à Angers sur K15. Cet aller-retour mérite aussi un contrôle de cohérence indépendant des seuls codes répétés.

## Bus, tram et BHNS

Aucun retour sur un code bus, tram ou BHNS déjà quitté n'a été détecté dans le contrôle multimodal décrit ci-dessus. Ce résultat est limité à cet échantillon et aux réglages testés.

Le contrôle structurel de toutes les arêtes trouve **0 liaison de hub vers le même code de ligne** et **0 correspondance ferroviaire au même arrêt permettant de rattraper un train qui desservait la gare immédiatement précédente**. Ces contraintes fonctionnent ; elles ne suffisent pas à prévenir toutes les alternances indirectes.

## Pourquoi le correctif précédent reste insuffisant

Le test de `d9b139c` porte sur la gare précédente du profil entrant. Un rapide peut sauter cette gare tout en desservant une gare visitée plus tôt par le voyageur. Il reste alors possible de quitter puis reprendre un service déjà accessible plus tôt.

Les changements P↔K sont neutres dans le score de préférence ; une chaîne K→P→K peut donc échapper au coût d'un changement K→K. Des profils horaires différents restent combinables. Des poids et interdictions portant seulement sur l'arête locale ne représentent pas la continuité du voyage complet.

## Exigences pour la prochaine correction

1. Traiter la continuité du service et l'historique effectif du voyage, y compris les gares traversées dans chaque profil, plutôt que le seul dernier arrêt ou le code de ligne.
2. Préserver un profil complet cohérent pour une portion réalisable sans changer de train. Ne pas fusionner les libellés pour cacher un vrai changement de véhicule.
3. Préserver les rabattements utiles vers un rapide non disponible à l'arrêt d'origine et les prolongements de dessertes partielles. Ne pas interdire une correspondance simplement parce qu'un autre profil de la ligne sert une gare où ce voyageur n'est pas passé.
4. Éviter une correction consistant seulement à parcourir les prédécesseurs du meilleur chemin et à rejeter une remontée : avec un unique état par nœud, un autre préfixe valable peut avoir été éliminé. Toute contrainte liée à l'historique doit conserver les états alternatifs nécessaires, avec une stratégie de dominance et des mesures de coût.
5. Rejouer cet audit, contrôler les retours de gares (pas uniquement les codes), les profils continus, les calendriers disponibles et les accès, puis mesurer le chargement et le déplacement du point sur mobile.

## Reproduction

`node scripts/audit_route_alternation.mjs rail`

`node scripts/audit_route_alternation.mjs network`

Résultats et exemples détaillés : `data/tours/audit-alternances-2026-10-04.json`.
