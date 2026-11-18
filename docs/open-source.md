# Ouverture du code (lot 5)

Objectif : que n'importe quel formateur, étudiant ou développeur puisse **jouer**, **réutiliser** et **améliorer** Funnelia, en sachant ce qu'il a le droit de faire, sans exposer de donnée personnelle.

## Choix à défendre

- **Deux licences, une règle par dossier.** Le code est sous MIT : la licence la plus simple et la plus répandue, qui autorise tout usage, y compris dans une formation payante. Les contenus pédagogiques (`textes/`, `docs/`, README) sont sous CC BY-SA 4.0 : on peut les adapter, à condition de citer Funnelia et de partager l'adaptation sous la même licence, pour que les améliorations reviennent à la communauté. La frontière suit les dossiers, ce qui la rend vérifiable d'un coup d'œil.
- **Éléments de tiers compatibles.** Three.js (MIT), la police Inter (OFL) et les personnages Quaternius (CC0) autorisent tous la redistribution. Tout le reste (décor, textures, sons, logo) est généré par le code. Chaque élément est listé dans `CREDITS.md`.
- **Textes dans des fichiers `.js`, pas `.json`.** Un fichier JSON se charge par `fetch`, que les navigateurs bloquent quand on ouvre `index.html` par double-clic (`file://`). Un fichier `.js` chargé par une balise `<script>` fonctionne partout, sans serveur.
- **Le français et l'anglais côte à côte.** Chaque texte s'écrit `{ fr: "…", en: "…" }` : un traducteur voit les deux versions ensemble, et `outils/verifier-textes.py` refuse une paire incomplète. C'est la règle « FR et EN toujours synchronisés » rendue vérifiable par une machine.
- **Extraction progressive.** Le catalogue commercial (offres, modules, motivations SONCAS, concurrents, comptes, cible) passe en premier : ce sont des données pures, sans logique. Preuve que rien n'a changé : les 9 objets produits sont identiques, octet pour octet, avant et après, en français comme en anglais. Les textes mêlés à la logique des missions suivront mission par mission, chacune avec la même preuve.
- **Publication automatique.** À chaque envoi sur `main`, GitHub Actions vérifie les textes et l'absence de données personnelles, puis publie le jeu. Une erreur bloque la publication. Le site ne contient que les fichiers chargés par le jeu.
- **Historique nettoyé, pas effacé.** L'adresse e-mail personnelle figurait comme auteur des commits. Elle a été remplacée dans tout l'historique ; le contenu de chaque branche est identique (mêmes arbres git), et tous les petits commits du projet restent lisibles. Une sauvegarde de l'historique précédent est conservée localement dans `.git/`, qui n'est jamais publié.

## Mesures AVANT / APRÈS

| Mesure | AVANT (lot 4) | APRÈS (lot 5) |
|---|---|---|
| Licence | aucune (tous droits réservés par défaut) | MIT (code) + CC BY-SA 4.0 (contenus) |
| Documents pour contribuer (README, CONTRIBUTING, code de conduite, guides) | 0 | 5 (+ CREDITS complété) |
| Textes FR/EN dans des fichiers de données | 0 | 121 |
| Textes bilingues encore dans `script.js` | 2 759 | 2 640 (−4 %) |
| Traduction manquante repérée et corrigée | – | 1 (KPI « Impressions » de la mission 1) |
| Commits portant une adresse e-mail personnelle | 32 sur 32 | 0 (aucun commit) |
| Données personnelles détectées (fichiers et historique, 70 versions de fichiers) | non vérifié | 0 |
| Taille publiée sur GitHub Pages | – | 4,0 Mo, 30 fichiers (les modèles `.glb`, 4,1 Mo, restent dans le dépôt seulement) |
| Ouverture par double-clic, régression des 5 missions (FR et EN) | oui, 15/15 | oui, 15/15, et 15/15 sur la copie publiée servie en HTTP |

## Limites connues

- **Les noms de personnes** ne se détectent pas automatiquement. Ceux du jeu sont inventés ; la règle est rappelée dans `CONTRIBUTING.md`, et une mention de fiction figure dans le README.
- **Il reste 2 640 textes bilingues dans `script.js`.** Ils sont bien synchronisés (écrits par paires `T("…", "…")`), mais pas encore modifiables par quelqu'un qui ne lit pas le code.
- **Pas d'adresse de contact dédiée** : le contact passe par les *issues* GitHub, et les signalements liés au code de conduite par la fonction privée *Report content* de GitHub. Une adresse dédiée au projet pourra s'y ajouter si la communauté grandit.
