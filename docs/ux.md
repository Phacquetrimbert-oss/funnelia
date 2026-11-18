# Interface (lot 4) : HUD en trois couches, accueil simplifié

Maquette validée avant le code : [maquettes/lot-4-ux.html](maquettes/lot-4-ux.html).

## Principe

Un joueur qui découvre le jeu ne lit qu'une information à la fois. Avant le lot 4, il recevait tout dès la première seconde. Le principe retenu :

- **Couche 1, permanente** : ce qui sert à chaque seconde (objectif, temps, erreurs, menu, étage, action possible au viseur).
- **Couche 2, contextuelle** : ce qui sert à un moment précis, puis s'efface (boussole quand il y a un objectif, KPI qui viennent de changer, messages, didacticiel).
- **Couche 3, à la demande** : ce qui sert à réfléchir (CRM avec tunnel, progression, KPI complets et raccourcis ; menu Échap).

## Mesures AVANT / APRÈS

Navigateur sans affichage, fenêtre de 1400 × 850, sauvegarde neuve, mission « Prospection ». Les mesures AVANT ont été relevées sur la branche `lot-3-personnages`.

| Mesure | AVANT | APRÈS (FR / EN) |
|---|---|---|
| Éléments du HUD visibles en permanence (même sélecteur) | 15 + 3 KPI + mini-carte + boussole | 7, KPI et mini-carte masqués, boussole seulement avec un objectif |
| Boutons dans la barre du HUD | 7 | 2 (» accélérer, ☰ Menu) |
| Mots sur l'accueil (onglet de suivi compris) | 715 | 312 / 287 |
| Mots au-dessus des étapes (barre, présentation, profil) | 315 | 91 / 81 |
| Hauteur de l'accueil | 1 609 px | 897 px |
| Boutons et champs sur l'accueil | 23 | 17 |
| Saisie obligatoire avant de jouer | oui (portefeuille) | non (50 clients par défaut, signalé) |
| Mots sur le briefing (visibles) | 596 | 242 / 221 (le reste sous « Détails ») |
| Hauteur du briefing | 1 557 px | 670 px |
| Messages simultanés au démarrage d'une mission | 5 | 1, puis le didacticiel une fois l'animation finie |

## Choix à défendre

- **Portefeuille par défaut (50 clients).** Le champ obligatoire bloquait le joueur avant même de jouer. La valeur par défaut est marquée « défaut » dans le HUD, le bilan et le CSV (colonne « Valeur du portefeuille » : réelle ou par défaut), donc la CLV affichée reste honnête. Aucune sauvegarde n'est modifiée : tant que rien n'est saisi, la sauvegarde contient `null` et le jeu applique 50.
- **Le CRM reste ouvert pendant la mission.** La maquette le prévoyait derrière Tab, mais c'est là que l'on agit (appeler, qualifier, relancer). Le cacher aurait ajouté une touche à chaque action. Il devient donc la couche 3 « réfléchir » : il reçoit le tunnel, la progression et les KPI complets, plus une ligne de raccourcis cliquables (K, O, G, P, H).
- **Le bouton » reste dans la barre.** Accélérer le temps sert souvent ; à la souris ou au tactile, il ne doit pas être enfoui dans un menu.
- **KPI temporaires.** Un KPI s'affiche 4 s quand il change ; un KPI en alerte reste affiché. Mesuré sur 60 s de jeu : 1 changement par minute dans trois missions, 6 à 7 dans Prospection (compteur de visiteurs) et Fidélisation.
- **Seule l'animation de départ se passe.** Une touche ou un clic la ferme. Les animations de passage d'étape en cours de mission ne se ferment pas au clavier, sinon un joueur qui marche (touche maintenue) ne les verrait jamais.
- **Fil de l'entreprise silencieux 45 s.** Les messages sont conservés, mais pas affichés pendant que le joueur apprend à se déplacer.
- **Raccourcis inchangés.** K, O, G, H, M, F, P, Tab et Échap font exactement la même chose qu'avant ; seuls les boutons ont bougé (menu de pause et pied du CRM).

## Tests automatiques (FR et EN)

Portefeuille par défaut (15 contrôles), accueil (10), briefing, menu de pause (13), couche 2 (10), CRM (10), 60 premières secondes (11), et régression des 5 missions, fenêtres et ascenseur (15) : tous passent dans les deux langues, sans erreur JavaScript.
