#!/bin/bash
# macOS : équivalent de Restaurer.bat. Usage : ./Restaurer.command chemin/sauvegarde.zip [--force]
cd "$(dirname "$0")"
if [ -z "$1" ]; then
  echo "Lancez : ./Restaurer.command chemin/sauvegarde.zip"
  read -r -p "Appuyez sur Entrée pour fermer…"
  exit 1
fi
node --disable-warning=ExperimentalWarning src/restore.js "$@"
read -r -p "Appuyez sur Entrée pour fermer…"
