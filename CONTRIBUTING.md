# Contribuer à Funnelia

Merci de votre intérêt. Funnelia est un jeu pédagogique : chaque contribution doit garder le jeu **jouable**, **bilingue** et **simple à ouvrir**.

## Les cinq règles du projet

1. **Le jeu s'ouvre par double-clic sur `index.html`.** Beaucoup de formateurs et d'élèves n'ont ni serveur ni droits d'installation. Donc : pas de module ES (`import`/`export`), pas de `fetch` ou `XMLHttpRequest` vers un fichier local, pas de bibliothèque chargée depuis internet. Un nouveau fichier de données s'ajoute par une balise `<script>` dans `index.html`.
2. **Three.js reste en r128.** Les versions récentes n'existent plus qu'en modules ES (règle 1) et changent l'éclairage et les couleurs : tout le décor devrait être réglé de nouveau.
3. **Français et anglais toujours synchronisés.** Aucun texte visible ne s'ajoute dans une seule langue (voir plus bas).
4. **Les sauvegardes des joueurs ne se perdent jamais.** Si vous changez une clé `localStorage` ou la forme des résultats, ajoutez une migration (voir `ANCIENNES_CLES` et `chargerResultats()` dans `script.js`) et n'effacez jamais l'ancienne clé.
5. **Données fictives uniquement.** Pas de nom de personne, d'entreprise, d'adresse e-mail ou de chiffre réels dans les textes, les images ou les fichiers d'exemple.

## Écrire un texte en deux langues

- **Dans le dossier `textes/`** (méthode à privilégier) : chaque texte s'écrit `{ fr: "…", en: "…" }`. Dans `script.js`, `traduire(…)` remplace chaque paire par la langue du joueur.
- **Dans `script.js`** (textes pas encore extraits) : `T("texte français", "English text")` ou `(EN ? "English" : "français")`.
- **Dans `index.html`** : le texte français dans l'élément, l'anglais dans `data-en` (ou `data-en-title`, `data-en-placeholder`, `data-en-aria-label`).

Avant chaque proposition, lancez :

```
python3 outils/verifier-textes.py
```

Il signale une traduction manquante ou vide, et des repères différents entre les deux langues (par exemple `{Il}` présent en français mais absent en anglais).

## Proposer une modification

1. Créez une branche à partir de `main`.
2. Faites de **petits commits**, un sujet par commit, avec un message en français qui dit ce qui change et pourquoi.
3. Vérifiez à la main :
   - le jeu s'ouvre par double-clic sur `index.html`, sans erreur dans la console (F12) ;
   - la mission touchée se joue jusqu'au bilan, **en français puis en anglais** (bouton FR/EN de l'accueil) ;
   - une sauvegarde existante est toujours lue (jouez une mission avant votre modification, puis rechargez après) ;
   - si vous touchez au rendu 3D, comparez les mesures du panneau F3 (images par seconde, appels de dessin, triangles) avant et après, et notez-les dans la demande de fusion.
4. Ouvrez une *pull request* qui décrit le changement, les tests faits et les mesures avant/après.

## Ajouter un élément de tiers

Modèle 3D, son, image ou bibliothèque : uniquement sous une licence qui autorise la redistribution dans un dépôt public (CC0, CC BY, MIT, OFL…). Ajoutez une ligne dans [CREDITS.md](CREDITS.md) avec l'auteur, la licence et le lien vers la source.

## Pour aller plus loin

- [Ajouter ou modifier une mission](docs/ajouter-une-mission.md)
- [Mesures de performance](docs/performances.md)
- [Choix d'interface](docs/ux.md)

En contribuant, vous acceptez que votre code soit publié sous licence MIT et vos contenus sous licence CC BY-SA 4.0, et vous vous engagez à respecter le [code de conduite](CODE_OF_CONDUCT.md).
