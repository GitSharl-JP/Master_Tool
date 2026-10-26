#!/bin/bash
# macOS : double-cliquer pour lancer l'atelier (équivalent de Demarrer.bat).
cd "$(dirname "$0")"
(sleep 2 && open http://localhost:3000) &
node --disable-warning=ExperimentalWarning src/server.js
