# Audit final — carte des trajets de Tours

Audit réalisé le 3 octobre 2026 sur le GTFS SNCF version du 2 octobre 2026 et le GTFS Fil Bleu extrait le 30 septembre 2026.

## Vérifications de données et de graphe

- 139 parcours horaires représentatifs (15 lignes TER/navette et tram A), 237 gares et arrêts, 2 976 états arrivée/départ.
- Vérification indépendante de 1 428 horaires d'arrêt choisis, permissions de montée/descente et séquences : aucun horaire retenu ne diffère de son GTFS source ; aucune desserte par car n'est comptée comme train.
- 8 392 intervalles gare-à-gare calculés depuis les horaires d'un train réel et cohérents avec les temps d'arrivée/départ de son vecteur complet.
- 70 221 assertions passent : intervalles, coûts d'arêtes positifs, transferts en gare et entre arrêts proches, exclusion des projets, monotonie des parts accessibles et décomposition marche/attente/temps à bord. Le calcul des plus courts trajets concorde avec un Dijkstra indépendant.
- 9 291 possibilités de changement entre parcours du même code TER sont présentes ; 59 paires d'arrêts tram/TER proches ont des liens de correspondance directionnels.
- Temps de calcul mesurés dans Node sur cette machine : modèle de trajet ~9 ms ; évaluation de la grille SERM 29 084 mailles ~89 ms.
- Les arrêts du tram A sont replacés sur leur tracé officiel : écart résiduel maximal 1,86 m. Plusieurs points avaient été décalés jusqu'à 185 m dans la version précédente.

## Exemples comparés aux horaires source

Les minutes « à bord » ci-dessous sont les intervalles du parcours réel médian de sa séquence d'arrêts. La marche est nulle car l'origine et la destination sont au droit des arrêts ; l'estimation inclut ensuite 1,8 min d'accès, 15 min d'attente TER et 1,8 min de sortie.

| Départ → arrivée | À bord (GTFS) | Total estimé |
|---|---:|---:|
| Tours → Blois-Chambord | 32 min | 50,6 min |
| Tours → Orléans | 63 min | 81,6 min |
| Tours → Le Mans | 60 min | 78,6 min |
| Tours → Paris-Austerlitz | 133 min | 151,6 min |
| Rotière → Jean Jaurès (tram A) | 22 min 24 s | 30 min |

À Jean Jaurès, une petite région de quelques minutes peut apparaître avec une estimation de 30 min ; au dézoom, elle peut être plus petite qu'une maille. Le halo de gare est dessiné selon son temps calculé directement. Le total à 30 minutes depuis Rotière concorde avec l'horaire retenu et les marges fixes.

## Correspondances testées

Le graphe permet de changer dans une même gare entre les séquences qui s'y arrêtent, y compris entre deux services du même code TER, avec une marge de 3,5 min et l'attente estimée du nouveau parcours. Il permet aussi les transferts entre arrêts distincts distants de 650 m maximum, en ajoutant la marche droite, 2 min de marge et l'attente.

Exemples produits par le calcul : K39→K1 à Saint-Pierre-des-Corps ; K39→tram A à Tours ; tram A→tram B au point Liberté. Les correspondances futures de B/C sont incluses par défaut et leur décochage les supprime du graphe.

## Tests d'affichage

- Courbes 15/30/45/60/90/120 min, curseur jusqu'à 180 min et seuil textuel dynamique.
- Agrandissement CSS jusqu'à la fenêtre entière, compatible avec les navigateurs intégrés et mobiles ; retour par le même bouton ou Échap.
- Épingle de 44 px verrouillant l'arrivée, y compris sur écran tactile ; état repris par le lien partagé.
- Contrôles à 390 × 844 px : aucune barre horizontale, carte utilisable, actions réparties sur quatre boutons en haut.
- Échelle de carte jusqu'à ×120 ; points placés au-delà du SERM (dont Paris) conservent une grille calculée dans la vue et leurs gares d'arrivée.
- Console navigateur : aucune erreur ni avertissement lors du parcours vérifié.

## Limites à connaître

Cette carte ne simule pas un départ à une heure précise. Les temps d'attente sont des marges fixes (TER 15 min, navette 5, tram 4, BHNS C 3,25) ; deux horaires retenus peuvent circuler des jours ou à des heures incompatibles. Elle donne une estimation de réseau, pas une garantie de correspondance ou un itinéraire exploitable immédiatement. Les cheminements sont à vol d'oiseau et ne comprennent ni accès intérieur aux gares, ni accessibilité PMR, barrières, dénivelés, retards ou perturbations.

Le tram B et le BHNS C sont des projets 2028 et utilisent une vitesse moyenne le long du tracé, sans horaires. La ligne P21 vers Chinon est également une estimation ferroviaire le long de l'ancien tracé : le flux SNCF extrait décrit une substitution par car, que le graphe exclut. Vendôme-Villiers-sur-Loir (gare TGV) reste affichée, mais sans embarquement dans les dessertes retenues. Les destinations hors des polygones IGN locaux sont nommées par la gare la plus proche.

Le périmètre de l'extrait SNCF choisi porte sur Tours et les corridors des lignes présentes dans le KML fourni ; la carte des lignes reste celle du KML de référence, tandis que les arrêts desservis et durées viennent du GTFS. Aucun fichier de référence n'est modifié. La copie antérieure du site parisien reste dans `archive/paris-original/`.
