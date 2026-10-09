# Master_tool

## Project
Atelier marketing réutilisable pour UNE personne seule, non technique, avec peu de temps (jamais supposer un 2e utilisateur ni un relecteur : le temps presse et la main-d'œuvre manque) pour un night show dans un temple japonais, avec Orfeo (FR). Une fiche spectacle commune alimente affiches, vidéos, site WordPress, publications, campagnes Meta. Lieu NON confirmé (Daigo-ji / Tokyo) : ne rien publier. Cible : site/préventes janv. 2027, ouverture mars 2027. UI en français, contenu V1 en anglais (EN).

## Stack
Node 25, zéro dépendance npm (http natif, `node:sqlite`), HTML rendu côté serveur. SQLite `data/atelier.db`. Windows prioritaire. ffmpeg portable dans `tools/ffmpeg/` (hors Git). Edge/Chrome headless pour PNG, SVG et PDF. Local d'abord, migration serveur possible (`HOST`/`PORT`).

## Environments
- Local dev: `C:\Users\Charles\Desktop\Master_tool` (source of truth).
- Staging/production: aucun pour l'instant (WordPress existant à inspecter ; accès admin dispo via Réglages). Never confuse local with production; never modify/deploy production without an explicit request.

## Important paths
- Vocabulaire : UI dit « projet » ; table `editions`. Lire `docs/produit.md` avant toute tâche sur designs, variantes, contenus, campagnes, calendrier, Meta ; `docs/sauvegarde-restauration.md` (données, sauvegardes) ; `docs/wordpress.md` (intégration WP) ; `docs/procedure-test-parcours.md`.
- `src/` : `schema` fiche · `db` données · `secrets` coffre · `storage` fichiers (clés, jamais de chemins) · `formats` formats+canaux · `render` HTML affiche/site · `studio` assets/designs/exports · `designexport` SVG/PDF · `library` designs/modèles/kits · `intake` entrées libres (affiche reçue, documents) · `svgclean` nettoyage SVG · `projects` gestion des projets et Accueil · `comptes` outil local de comptes (`node src/comptes.js`) · `variants` variantes guidées · `plan` calendrier · `campaigns` contenus/campagnes/Meta · `backup`+`restore` sauvegardes · `media`+`video` ffmpeg · `views`, `views_flow` pages · `server` routes. `site` site du projet (un par projet) · `todo` « À faire maintenant » · `public/` : `style.css` (charte du thème WP), `app.js`, `poster-editor.js`, `video.js`, `svg-measure.js`. `tests/parcours.mjs` : test bout en bout (~299 contrôles, ~2 min, données temporaires ; `ATELIER_SHOTS=<dossier>` enregistre des captures d'écran du navigateur) — à relancer après toute évolution : `node tests/parcours.mjs`.
- `data/` (base, secrets, assets, exports) : jamais tracké, ne jamais le lire. `ATELIER_DATA` / `ATELIER_ASSETS` = dossiers alternatifs : tester TOUJOURS sur un dossier temporaire, jamais sur `data/` (l'utilisateur peut avoir son serveur ouvert).
- État courant : `PROJECT_STATUS.md`.

## Core rules
- Secrets (passwords, API keys, tokens, JWT/webhook secrets, DB credentials) never go in tracked files, docs, examples or memory. Real `.env` stays untracked; `.env.example` has dummy values only.
- Mandatory security env vars: fail fast at startup (check exists + non-empty, log only the NAME, never the value). No `|| "change-me"` fallbacks.
- No commit/push/deploy unless explicitly asked. Before a commit: `git status`, `git diff`, check no real secret and no tracked `.env`.
- If a real secret is found in Git: never print it, report location/type, assume rotation needed, do not rewrite history.
- Meta : l'atelier n'écrit jamais dans Meta sans API validée ; `transmis`/`publié` = déclarations manuelles avec récapitulatif+confirmation. Une campagne active n'interdit pas de préparer des variantes en brouillon ; seules les associations `transmis`/`publié` sont figées. Association = épinglée sur un export précis. Configuration Meta (`meta_*`) ≠ brief interne (`brief_*`). Ne pas présenter app review / vérification d'entreprise comme obligatoires sans l'avoir établi.
- Illustrator : SVG validé par l'utilisateur pour calques nommés, rendu et texte modifiable ; clip-path du Fond supprimé depuis (à revérifier) ; remplacement d'image et PDF non testés. Ne pas annoncer plus. Distinguer testé / théorique dans toute réponse.
- Un projet = un site ; les campagnes ne créent ni ne pilotent le site.

## Workflow
- Lancer : **`Atelier.exe`** (application Windows : serveur en arrière-plan + fenêtre dédiée Edge/Chrome ; se construit avec `Construire-exe.bat` ou `node launcher/build.mjs`, icône `public/brand/icon.png`, source `launcher/Atelier.cs`), ou `Demarrer.bat` / `npm start` (http://localhost:3000). **Installateur** : `Construire-installateur.bat` (ou `node installer/build.mjs`) produit `dist/Installer-Atelier-marketing.exe` (un seul fichier, installation par utilisateur sans droits admin dans `%LOCALAPPDATA%ProgramsAtelier marketing`, raccourcis, désinstalleur ; n'embarque JAMAIS `data/`). Pas de build pour le serveur lui-même.
- Les connecteurs non branchés (billetterie, Buffer, Meta) doivent être étiquetés SIMULATION dans l'UI ; ne jamais présenter une simulation comme réelle. Aucune dépense pub automatique.
- Secrets : saisis par l'utilisateur dans Réglages (écriture seule). Ne jamais lire `data/secrets.json` ni demander de secret dans le chat.

## Claude efficiency rules
- Minimal context: use CLAUDE.md, read PROJECT_STATUS.md only if needed, then read only the likely files; targeted Grep/Glob first, widen only if necessary. No repo/parent-dir/filesystem scans, no reading all docs "just in case".
- No subagents (Explore/Agent/general-purpose/Plan) for simple or localized work (CSS, HTML, small JS/backend edits, text, UI, config, locating a known function). Use direct Read/Grep/Glob. Reserve subagents for genuinely complex, multi-system or parallel investigations.
- No `/run` and no Playwright/browser automation for routine edits: make the change and let the user check locally. Use only if the user asks, or the issue truly needs runtime/browser verification that lighter checks can't replace.
- Default to a standard model, medium effort, no extended thinking for simple tasks.
- Long task with a growing context: suggest `/compact`. After a finished feature: update PROJECT_STATUS.md, then `/clear` is safe. Never `/clear` mid-task before saving state.
- Update PROJECT_STATUS.md only when asked / at a milestone; update CLAUDE.md only when a permanent rule changes. Git is the history — no journals in these files.
