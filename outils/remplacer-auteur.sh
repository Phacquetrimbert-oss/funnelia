#!/bin/sh
# Remplace l'adresse e-mail (auteur et committeur) de tous les commits des
# branches par celle donnée, par exemple l'adresse « noreply » de GitHub
# (Settings > Emails sur github.com, forme 12345678+compte@users.noreply.github.com).
#
# À lancer AVANT la première publication : les identifiants des commits changent,
# leur contenu non. Une sauvegarde complète de l'historique est faite d'abord dans
# .git/ (fichier .bundle, jamais publié).
#
# Usage : sh outils/remplacer-auteur.sh <nouvelle-adresse>
set -e
NOUVELLE="$1"
[ -n "$NOUVELLE" ] || { echo "Usage : sh outils/remplacer-auteur.sh <nouvelle-adresse>"; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Validez ou mettez de côté vos modifications avant de lancer ce script."; exit 1; }

SAUVEGARDE="$(git rev-parse --git-dir)/funnelia-avant-reecriture-$(date +%Y%m%d-%H%M%S).bundle"
git bundle create "$SAUVEGARDE" --all
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter "
  GIT_AUTHOR_EMAIL='$NOUVELLE'; GIT_COMMITTER_EMAIL='$NOUVELLE'
  export GIT_AUTHOR_EMAIL GIT_COMMITTER_EMAIL
" -- --branches --tags
# Les références de secours de filter-branch garderaient l'ancienne adresse
git for-each-ref --format='%(refname)' refs/original/ | xargs -n 1 git update-ref -d
git config user.email "$NOUVELLE"
echo "Terminé. Sauvegarde de l'historique précédent : $SAUVEGARDE"
