#!/usr/bin/env python3
"""Cherche des données personnelles dans le dépôt ET dans tout l'historique git.

Usage : python3 outils/verifier-donnees.py

À lancer avant chaque publication. Le script parcourt toutes les versions de
tous les fichiers texte de toutes les branches, ainsi que les adresses des
auteurs de commits, et signale :
  - les adresses e-mail (sauf les adresses « noreply » et celles des licences) ;
  - les numéros de téléphone français ;
  - les IBAN et numéros SIRET/SIREN ;
  - les chemins de dossiers personnels (/Users/…, /home/…, C:\\Users\\…).
Les noms de personnes ne peuvent pas être détectés automatiquement : ceux du
jeu sont inventés, et toute nouvelle personne doit l'être aussi (CONTRIBUTING.md).
Code de sortie 1 si quelque chose est trouvé.
"""
import re
import subprocess
import sys

MOTIFS = {
    "adresse e-mail": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "téléphone": re.compile(r"(?<![\d.,])(?:\+33 ?|0)[1-9](?:[ .-]?\d{2}){4}(?!\d|[.,]\d)"),
    "IBAN": re.compile(r"\bFR\d{2}(?: ?\d{4}){5}"),
    "SIRET/SIREN": re.compile(r"\b(?:SIRE[NT])\b\D{0,5}\d{3} ?\d{3} ?\d{3}", re.I),
    "dossier personnel": re.compile(r"(?:/Users/|/home/|C:\\\\Users\\\\)[A-Za-z]"),
}
# Adresses publiques attendues : licences, crédits, co-auteur des commits
AUTORISEES = re.compile(r"(noreply|users\.noreply\.github\.com|@anthropic\.com$|example\.)", re.I)
# Fichiers de tiers (bibliothèques, police, modèles) : non écrits pour Funnelia
EXCLUS = ("vendor/", "fonts/", "assets/")


def git(*args):
    return subprocess.run(("git",) + args, capture_output=True, text=True, check=True).stdout


def main():
    trouve = []
    for ligne in git("log", "--branches", "--tags", "--remotes", "--format=%h %ae %ce").splitlines():
        h, *adresses = ligne.split()
        for a in adresses:
            if not AUTORISEES.search(a):
                trouve.append(f"commit {h} : adresse d'auteur {a}")
    vus = set()
    for commit in git("rev-list", "--branches", "--tags", "--remotes").split():
        for entree in git("ls-tree", "-r", commit).splitlines():
            infos, chemin = entree.split("\t", 1)
            blob = infos.split()[2]
            if blob in vus or chemin.startswith(EXCLUS):
                continue
            vus.add(blob)
            try:
                texte = git("cat-file", "-p", blob)
            except (subprocess.CalledProcessError, UnicodeDecodeError):
                continue  # fichier binaire
            for nom, motif in MOTIFS.items():
                for m in motif.finditer(texte):
                    if nom == "adresse e-mail" and AUTORISEES.search(m.group(0)):
                        continue
                    trouve.append(f"{chemin} (version {commit[:7]}) : {nom} « {m.group(0)} »")
    print(f"{len(vus)} versions de fichiers analysées.")
    for t in sorted(set(trouve)):
        print("À VÉRIFIER", t)
    print("OK : aucune donnée personnelle détectée." if not trouve else f"{len(set(trouve))} élément(s) à vérifier.")
    return 1 if trouve else 0


if __name__ == "__main__":
    sys.exit(main())
