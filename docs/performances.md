# Performances — mesures de référence

Outil : panneau de mesure (F3) et banc de test automatique (Maj + F3), ajoutés à l'étape 0.
Le banc place la caméra au centre de chaque étage, la fait tourner sur 360° pendant 2,5 s
après 0,8 s de chauffe, et relève les compteurs cumulés sur toutes les passes de rendu
(ombres, SSAO, bloom, FXAA).

## Mesure « avant » (étape 0, 17 novembre 2026)

Machine du développeur, Safari, en mission.

| Qualité | Étage | FPS | ms/image | Draw calls | Triangles rendus | Meshes visibles | Triangles visibles | castShadow | Géométries uniques | Matériaux uniques | Textures | Programmes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| faible | RDC | 28.8* | 34.7 | 581 | 236 230 | 1230 | 551 260 | 466 | 1165 | 253 | 134 | 46 |
| faible | R+1 | 60.0 | 16.7 | 592 | 235 670 | 1434 | 607 586 | 615 | 1362 | 293 | 134 | 46 |
| faible | R+2 | 60.0 | 16.7 | 531 | 201 382 | 1230 | 545 186 | 459 | 1163 | 262 | 162 | 46 |
| moyen | RDC | 59.6 | 16.8 | 965 | 574 362 | 1230 | 551 260 | 466 | 1165 | 253 | 175 | 46 |
| moyen | R+1 | 58.4 | 17.1 | 1177 | 704 290 | 1434 | 607 586 | 615 | 1362 | 293 | 186 | 46 |
| moyen | R+2 | 60.0 | 16.7 | 958 | 549 745 | 1230 | 545 186 | 459 | 1163 | 262 | 197 | 46 |
| eleve (SSAO) | RDC | 44.7 | 22.4 | 1911 | 1 146 543 | 1230 | 551 260 | 466 | 1165 | 253 | 214 | 46 |
| eleve (SSAO) | R+1 | 42.8 | 23.4 | 2335 | 1 403 938 | 1434 | 607 586 | 615 | 1362 | 293 | 231 | 46 |
| eleve (SSAO) | R+2 | 45.8 | 21.8 | 1893 | 1 092 898 | 1230 | 545 186 | 459 | 1163 | 262 | 248 | 46 |
| ultra (SSAO) | RDC | 35.1 | 28.5 | 1915 | 1 147 049 | 1230 | 551 260 | 466 | 1165 | 253 | 265 | 46 |
| ultra (SSAO) | R+1 | 33.2 | 30.1 | 2343 | 1 408 575 | 1434 | 607 586 | 615 | 1362 | 293 | 282 | 46 |
| ultra (SSAO) | R+2 | 19.4* | 51.6 | 1923 | 1 110 008 | 1230 | 545 186 | 459 | 1163 | 262 | 299 | 46 |

\* Valeurs à confirmer (voir « Limites de la mesure »).

Vue la plus chargée relevée hors banc (écran d'accueil, caméra vers la cafétéria, Élevé) :
**23,6 FPS, 42,3 ms par image, 3 231 draw calls, 1,8 million de triangles.**

## Lecture

- Les ombres doublent les draw calls (Faible → Moyen), le SSAO les double encore (Moyen → Élevé).
- À 60 FPS, Faible et Moyen sont plafonnés par la synchronisation verticale de l'écran :
  on ne voit pas la marge réelle. Les draw calls (600 à 1 200) restent 2 à 4 fois au-dessus de la cible.
- Élevé tourne autour de 45 FPS au centre des étages, mais tombe à ~24 FPS sur les vues larges.
- Ultra n'ajoute aucun objet : seuls la résolution et la taille des ombres changent.

## Limites de la mesure

- **Fuite de textures à chaque changement de qualité** : la colonne Textures monte de 134 à 299
  au fil du banc. `configurerRendu()` libère les deux cibles du composeur mais pas celles du SSAO,
  du bloom ni la cible HDR initiale. À corriger au lot 2 (chantier 5) ; c'est probablement la cause
  de la chute d'Ultra R+2 en fin de banc.
- **Première configuration pénalisée** (Faible RDC) : compilation des shaders et envoi des textures
  pendant la chauffe de 0,8 s.

## Cibles du lot 2

Par étage : < 300 draw calls, < 300 000 triangles, < 60 matériaux.
60 FPS en Moyen sur portable à GPU intégré, ≥ 45 FPS en Élevé.
