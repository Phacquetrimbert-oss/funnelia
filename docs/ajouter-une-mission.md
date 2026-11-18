# Ajouter ou modifier une mission

Une mission de Funnelia est **un objet JavaScript** qui décrit une situation commerciale : textes du briefing, paramètres, mise en place du décor, règles de réussite. Le moteur du jeu (accueil, briefing, HUD, bilan, sauvegarde, export CSV) est commun aux cinq missions et appelle les fonctions de cet objet.

Les cinq missions s'appellent `M1` à `M5` dans `script.js` et sont rangées dans la liste `NIVEAUX` :

| Objet | `id` (ne pas changer : il est enregistré dans les sauvegardes) | Mission |
|---|---|---|
| `M1` | `notoriete` | Prospection |
| `M2` | `interet` | Captation |
| `M3` | `consideration` | Qualification |
| `M4` | `decision` | Closing |
| `M5` | `fidelisation` | Fidélisation (bonus) |

## 1. Modifier une mission existante (le plus simple)

- **Changer un objectif ou la difficulté** : modifiez `params.standard` et `params.confirme` (par exemple `objectifContacts`, `budget`). Les textes du briefing (`mission`, `criteres`) se recalculent à partir de ces valeurs.
- **Changer un texte** : modifiez la version française **et** la version anglaise, puis lancez `python3 outils/verifier-textes.py`.
- **Changer un compte client** de la Qualification ou du Closing : les comptes du territoire sont dans `textes/catalogue.js` (section `comptes`).

Ne changez pas les `id` : les résultats déjà enregistrés par les joueurs y sont rattachés.

## 2. Le contrat d'une mission

### Textes et présentation

| Champ | Contenu |
|---|---|
| `id` | Identifiant stable, sans accent. |
| `phase` | Nom court de l'étape (« Prospection »). |
| `couleur`, `texteCouleur` | Couleur de l'étape (bandeau, cartes, animation) et couleur du texte posé dessus. |
| `transition` | `[de, vers]`, par exemple `["Lead", "Opportunité"]`. |
| `bonus` | `true` pour une mission hors tunnel (comme la Fidélisation). |
| `titre`, `contexte`, `objectifBusiness` | Briefing : titre, situation, objectif métier. |
| `objectifTableau` | Résumé de l'étape, affiché au survol de sa carte sur l'accueil. |
| `activitesTableau`, `kpiTableau`, `mode` | Activités, indicateurs et mode de travail de l'étape. Plus affichés depuis la simplification de l'accueil (lot 4), mais gardés comme fiche de l'étape : remplissez-les. |
| `mission(p)` | Phrase d'objectif, affichée dans le briefing et dans le HUD. |
| `consignes(p)`, `criteres(p)` | Listes de phrases : consignes de jeu ; critères de réussite, maîtrise, excellence et erreurs. |
| `profilNote()` | Ce qui change entre terrain et sédentaire. |
| `reflexeRequin` | Le frein à la conversion à éviter, présenté dans les détails du briefing. |
| `aRetenir`, `conseilEchec` | Message pédagogique du bilan, conseil en cas d'échec. |

### Paramètres et déroulement

| Champ | Rôle |
|---|---|
| `params` | `{ standard: {…}, confirme: {…} }` : valeurs selon l'exigence choisie. Reçues partout sous le nom `p`. |
| `periode(p)` | `{ debut, fin, rythme, affichage }` : horaires simulés (en minutes ; `JOURNEE` = 540) et vitesse du temps. |
| `depart()` | `{ x, z, angle }` : position du joueur au départ. |
| `demarrer(n, p)` | Prépare la mission : remplit l'état `n` (objet propre à la mission), place les personnages et objets. |
| `auDemarrage(n)` | *(facultatif)* Action au lancement, par exemple ouvrir une fenêtre de préparation. |
| `maj(n, dt, dmin)` | Appelée à chaque image : fait vivre la mission. |
| `finTemps(n)` | Appelée à l'heure de fin : calcule le résultat et appelle `terminerNiveau(succes, etoiles, texte)`. |

### Affichage

| Champ | Rôle |
|---|---|
| `hud(n)` | Met à jour la jauge (`hudJauge`) et les indicateurs (`hudKpis`). |
| `tunnel(n)` | *(facultatif)* `{ de, vers, etapes: [{ label, court, valeur }] }` : mini-tunnel de la mission (HUD, CRM, bilan, accueil). |
| `panneau(n)` | HTML du panneau CRM. |
| `commande(n, cmd, id, val)` | Réagit aux boutons du CRM (`data-cmd`, `data-id`, `data-val`). |
| `kpis(n)` | Liste `{ nom, valeur, cible, ok }` affichée au bilan et exportée en CSV. |
| `ciblesCarte(n)` | *(facultatif)* Points à signaler sur le plan. |

Le plus court chemin pour démarrer : **copier la mission la plus proche** de votre idée, changer son `id`, puis adapter les fonctions une à une. La mission 1 (`M1`) est la plus courte.

### Imprévus

Les mises en situation qui surviennent pendant une mission (appel d'un journaliste, client mécontent…) sont rangées par `id` dans `IMPREVUS`. Une nouvelle mission sans entrée dans `IMPREVUS` fonctionne : elle n'aura simplement pas d'imprévu.

## 3. Ajouter une sixième mission : ce qu'il faut toucher

Le moteur a été écrit pour quatre étapes et un bonus. Ajouter une mission demande donc, en plus de l'objet :

1. **`NIVEAUX`** : ajouter l'objet à la liste.
2. **`NB_ETAPES`** : passer de 5 à 6.
3. **Sauvegardes existantes** : les joueurs ont des tableaux de 5 cases (`meilleurs`, `etoiles`, `tentatives`, `tunnels`). Dans `chargerResultats()`, complétez chaque tableau trop court avec des `0` (ou `null` pour `tunnels`). Sans cela, la nouvelle mission lirait `undefined`. Ne supprimez rien.
4. **Mission recommandée** (`etapeRecommandee()`) et **héros de l'accueil** (`afficherHero()`) : ils supposent quatre étapes puis un bonus (`i < 4`, « 1 / 4 »).
5. **Badges** (`BADGES`) : ajouter, si besoin, un badge avec `etape:` égal à l'indice de la nouvelle mission.
6. **Textes** : français et anglais pour chaque champ, vérifiés par `outils/verifier-textes.py`.

Puis testez :

- la nouvelle mission jusqu'au bilan, en français puis en anglais, profil terrain et sédentaire ;
- **avec une sauvegarde d'avant le changement** : l'accueil, le classement et l'export CSV doivent rester justes ;
- les performances (touche F3) si la mission ajoute des objets 3D.

## 4. Où mettre les textes

L'extraction des textes vers le dossier `textes/` se fait par étapes. Pour une nouvelle mission, privilégiez un fichier `textes/mission-<id>.js` :

```js
/* Funnelia – textes de la mission « … » (CC BY-SA 4.0, voir LICENSE-CONTENUS). */
window.FUNNELIA_TEXTES = window.FUNNELIA_TEXTES || {};
window.FUNNELIA_TEXTES.missionExemple = {
  phase: { fr: "Négociation", en: "Negotiation" },
  titre: { fr: "…", en: "…" }
};
```

Ajoutez la balise `<script src="textes/mission-<id>.js"></script>` dans `index.html`, **avant** `script.js`, puis, dans la mission : `const TX = traduire(TEXTES.missionExemple);` et `phase: TX.phase`. Les phrases qui contiennent des valeurs calculées (`${p.objectif}`) restent pour l'instant dans `script.js`, écrites avec `T("…", "…")`.
