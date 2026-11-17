# Crédits

## Bibliothèques

| Élément | Auteur | Licence | Emplacement |
|---|---|---|---|
| Three.js r128 (et `examples/js` : post-traitement, GLTFLoader, SkeletonUtils) | three.js authors | MIT | `vendor/three-r128/` (licence : `vendor/three-r128/LICENSE`) |
| Police Inter | Rasmus Andersson | SIL Open Font License 1.1 | `fonts/` (licence : `fonts/OFL.txt`) |

## Personnages 3D

| Modèle | Auteur | Licence | Source | Fichiers |
|---|---|---|---|---|
| Man in Suit (animations : Idle, Sitting, Standing, Walk, Clapping) | Quaternius | CC0 1.0 (domaine public) | https://poly.pizza/m/mQnGoME1ez | `assets/personnages/sources/homme-costume.glb` (original), `assets/personnages/homme-costume.glb` / `.js` (version allégée) |

Les versions allégées sont produites par `outils/preparer-personnage.py` : seules les animations
utiles au bureau sont conservées, et le fichier est encodé en base64 pour fonctionner en `file://`.
Les couleurs des tenues sont redéfinies dans le jeu.
