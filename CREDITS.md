# Crédits

Funnelia est publié par les contributeurs de Funnelia : code sous licence MIT
(`LICENSE`), contenus sous licence CC BY-SA 4.0 (`LICENSE-CONTENUS`).
Ce fichier liste les éléments créés par d'autres et leur licence. Tous autorisent
la redistribution dans un dépôt public.

## Bibliothèques

| Élément | Auteur | Licence | Emplacement |
|---|---|---|---|
| Three.js r128 (et `examples/js` : post-traitement, GLTFLoader, SkeletonUtils) | three.js authors | MIT | `vendor/three-r128/` (licence : `vendor/three-r128/LICENSE`) |
| Police Inter | Rasmus Andersson | SIL Open Font License 1.1 | `fonts/` (licence : `fonts/OFL.txt`) |

## Personnages 3D

| Modèle | Auteur | Licence | Source | Fichiers |
|---|---|---|---|---|
| Man in Suit — porte les animations masculines (Idle, Sitting, Standing, Walk, Clapping) | Quaternius | CC0 1.0 (domaine public) | https://poly.pizza/m/mQnGoME1ez | `assets/personnages/sources/homme-costume.glb` (original), `assets/personnages/homme-costume.glb` / `.js` (version allégée) |
| Man in Long Sleeves | Quaternius | CC0 1.0 | https://poly.pizza/m/DLptRuewTn | `homme-chemise` |
| Woman (veste) — porte les animations féminines | Quaternius | CC0 1.0 | https://poly.pizza/m/AQsd9ngvKU | `femme-veste` |
| Woman Casual | Quaternius | CC0 1.0 | https://poly.pizza/m/jpKRgGDxhk | `femme-decontractee` |
| Woman in Dress | Quaternius | CC0 1.0 | https://poly.pizza/m/zMyPlQXBzq | `femme-robe` |

Les versions allégées sont produites par `outils/preparer-personnage.py` : seules les animations
utiles au bureau sont conservées, et le fichier est encodé en base64 pour fonctionner en `file://`.
Les couleurs des tenues sont redéfinies dans le jeu.

## Textes de référence

| Élément | Auteur | Licence | Fichier |
|---|---|---|---|
| Code de conduite Contributor Covenant 2.1 (traduction française officielle) | Contributor Covenant / Organization for Ethical Source | CC BY 4.0 | `CODE_OF_CONDUCT.md` |
| Texte de la licence CC BY-SA 4.0 | Creative Commons | CC0 1.0 (texte de licence) | `LICENSE-CONTENUS` |

## Créé pour Funnelia (aucun élément de tiers)

- **Décor, textures, ciel et ville** : générés par le code au chargement (aucune image externe).
- **Sons** : synthétisés par le navigateur (Web Audio), aucun fichier audio.
- **Logo** (entonnoir en quatre bandes) : dessiné en SVG dans `script.js`.
- **Entreprises, personnes, chiffres et scénarios** : inventés pour le jeu.
- **Captures d'écran et aperçu animé** (`docs/img/`, `docs/maquettes/img/`) : réalisés à partir du jeu, sous licence CC BY-SA 4.0.
