#!/usr/bin/env python3
"""Vérifie que les textes FR et EN de Funnelia restent synchronisés.

Usage : python3 outils/verifier-textes.py

Dans les fichiers du dossier textes/, chaque texte s'écrit { fr: "…", en: "…" }.
Le script signale :
  - une langue manquante ou vide ;
  - des repères différents entre les deux langues ({Il}, {nom}…), qui
    afficheraient un texte incomplet dans l'une des langues ;
Il compte aussi les textes bilingues encore écrits dans script.js et index.html
(extraction progressive), pour suivre l'avancement.
Code de sortie 1 en cas d'erreur, pour pouvoir l'utiliser dans GitHub Actions.
"""
import pathlib
import re
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
CHAINE = r'"(?:[^"\\]|\\.)*"'
PAIRE = re.compile(r'\{\s*fr:\s*(' + CHAINE + r')\s*,\s*en:\s*(' + CHAINE + r')\s*\}')
REPERE = re.compile(r'\{[A-Za-zÀ-ÿ]+\}')


def verifier_fichier(chemin):
    texte = chemin.read_text(encoding="utf-8")
    erreurs, paires = [], 0
    for m in PAIRE.finditer(texte):
        paires += 1
        ligne = texte.count("\n", 0, m.start()) + 1
        fr, en = m.group(1)[1:-1], m.group(2)[1:-1]
        if not fr.strip() or not en.strip():
            erreurs.append(f"{chemin.name}:{ligne} : texte vide ({'fr' if not fr.strip() else 'en'})")
        if sorted(REPERE.findall(fr)) != sorted(REPERE.findall(en)):
            erreurs.append(f"{chemin.name}:{ligne} : repères différents {REPERE.findall(fr)} / {REPERE.findall(en)}")
    # Une clé fr: ou en: hors d'une paire complète = traduction oubliée
    reste = PAIRE.sub("", texte)
    reste = re.sub(CHAINE, '""', reste)
    for m in re.finditer(r'\b(fr|en)\s*:', reste):
        ligne = reste.count("\n", 0, m.start()) + 1
        erreurs.append(f"{chemin.name} (vers la ligne {ligne}) : « {m.group(1)}: » sans sa traduction")
    return paires, erreurs


def main():
    fichiers = sorted((RACINE / "textes").glob("*.js"))
    total, erreurs = 0, []
    for f in fichiers:
        n, e = verifier_fichier(f)
        total += n
        erreurs += e
        print(f"textes/{f.name} : {n} textes FR/EN")
    script = (RACINE / "script.js").read_text(encoding="utf-8")
    html = (RACINE / "index.html").read_text(encoding="utf-8")
    restants = len(re.findall(r'\(EN \? ', script)) + len(re.findall(r'\bT\(', script))
    print(f"Encore dans script.js : {restants} textes bilingues ; index.html : {html.count('data-en')} attributs data-en")
    for e in erreurs:
        print("ERREUR", e)
    print("OK" if not erreurs else f"{len(erreurs)} erreur(s)")
    return 1 if erreurs else 0


if __name__ == "__main__":
    sys.exit(main())
