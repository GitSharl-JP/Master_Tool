# Sauvegarde et restauration

Distinction utilisée partout : **TESTÉ** = réalisé et constaté (test `tests/parcours.mjs`, étapes 12 et 13) ; **THÉORIQUE** = prévu par la conception, non constaté.

## Où sont conservées les données (tout est local)

| Élément | Emplacement | Contenu |
|---|---|---|
| Base | `data/atelier.db` | projets, fiches, **designs et versions**, variantes et **versions approuvées**, contenus, campagnes (saisies à la main), calendrier, **sous-titres corrigés**, comptes (mots de passe hachés), historique |
| Originaux | `data/assets/` (ou `ATELIER_ASSETS`) | photos, **vidéos sources**, logos, fichiers de sous-titres d'origine, et les **copies d'images propres à chaque design** (`designs/…`) |
| Exports | `data/exports/` | affiches, vidéos, packs, archives de design |
| Identifiants | `data/secrets.json` | WordPress, Buffer, Meta : **jamais sauvegardés** |
| Outils | `tools/ffmpeg/` | ffmpeg portable : non sauvegardé, réinstallable |

Un seul point de défaillance si rien d'autre n'est fait : le disque de cet ordinateur. D'où la sauvegarde externe ci-dessous.

## Ce que contient une sauvegarde complète (`atelier-sauvegarde-….zip`)

`atelier.db` (copie cohérente, même serveur ouvert) · `assets/` **en entier** · `exports/` selon le choix (par défaut : approuvés, associés à une campagne, archives ; option « tous » ou « aucun ») · `manifest.json` (chaque fichier : taille + empreinte SHA-256, exclusions, éléments déjà manquants).

| Dépendance | Statut dans la sauvegarde |
|---|---|
| Originaux, vidéos sources, sous-titres (fichiers) | **inclus** |
| Sous-titres corrigés, textes, réglages, versions approuvées | **inclus** (dans la base) |
| Designs : compositions + images utilisées | **inclus** (copies propres) |
| Exports approuvés ou épinglés à une campagne | **inclus** (mode par défaut) ; les autres sont régénérables depuis les designs et versions approuvées |
| Polices | **non incluses**. Polices Microsoft (Georgia, Segoe UI, Arial…) : licence interdisant la redistribution, présentes sur Windows/Office. Polices libres (Inter, Noto) : redistribuables (SIL OFL), téléchargeables sur Google Fonts. Autres : licence à vérifier. Le rapport « Dépendances » (Réglages > Sauvegardes) liste les polices réellement utilisées et si elles sont détectées sur ce poste. |
| ffmpeg, Edge/Chrome, Node | **référencés** (non inclus) : réinstallables |
| Identifiants | **exclus volontairement** : à ressaisir |
| Contenu de WordPress et de Meta | **hors périmètre** : l'atelier n'en garde que des références saisies à la main |

Les **originaux** et les **versions approuvées** ne sont jamais écartés d'une sauvegarde. Les éléments manquants sont signalés (contrôle d'intégrité : Réglages > Sauvegardes > « Vérifier l'intégrité ») et listés dans le manifeste.

## Sauvegarder en dehors du stockage principal

1. Réglages > Sauvegardes : indiquer un dossier **hors de `data/`** (autre disque, dossier OneDrive synchronisé, partage réseau). L'atelier refuse un dossier situé dans son propre stockage. — *testé*
2. « Sauvegarder maintenant », ou laisser faire : **une sauvegarde automatique par jour** tant que l'atelier est ouvert ; les 8 dernières sont conservées. — manuel *testé* ; automatique : *théorique* (même fonction, déclenchée au démarrage + toutes les heures ; non observée sur 24 h).
3. Un bandeau d'alerte s'affiche si aucune sauvegarde externe n'a eu lieu depuis plus de 7 jours.
4. Recommandé : copier de temps en temps le dossier de sauvegarde sur un second support.

## Restaurer dans une installation vierge

1. Copier le dossier de l'atelier sur le nouvel ordinateur (Node 24+), remettre `tools/ffmpeg/`.
2. Glisser le zip sur **`Restaurer.bat`** (ou `node src/restore.js sauvegarde.zip`).
3. Le script : extrait → **vérifie chaque fichier (taille + SHA-256)** → n'écrit qu'ensuite → met de côté (jamais d'écrasement) une installation existante, sauf `--force` → contrôle la base restaurée → affiche ce qui manque.
4. Lancer `Demarrer.bat`, ressaisir les identifiants (Réglages), réinstaller les polices signalées.

**Testé (réellement exécuté)** : sauvegarde d'un projet complet (originaux, vidéo, 3 variantes, 4 versions approuvées, designs, campagne avec associations figées, calendrier) → restauration dans un dossier vierge → l'application démarre dessus → connexion avec les mêmes comptes → variantes, versions approuvées, designs, campagne (🔒), calendrier et configuration Meta présents → **exports approuvés et originaux identiques octet pour octet (SHA-256)** → contrôle d'intégrité complet. Archive volontairement corrompue : restauration **refusée, rien écrit**. Refus d'écraser une installation existante : **constaté**.

**Théorique, non testé** : restauration sur un autre ordinateur physique ; restauration de gros volumes (plusieurs Go de vidéos) ; sauvegarde vers un partage réseau ; restauration d'**un seul projet** dans une installation contenant déjà d'autres projets (non implémentée : on restaure l'installation entière, ou on réimporte un **design** via son archive).

## Archive d'un design (`design-….zip`, onglet Designs)

Contient `design.json` (le design complet, modifiable et réutilisable), `assets/` (images utilisées), `svg/`, `pdf/`, `apercus/`, `LISEZMOI.txt`, `VERIFICATION-ILLUSTRATOR.txt`. Réimportable dans l'atelier (*testé*). Elle ne contient ni la fiche complète du projet ni ses vidéos sources : ce n'est pas une sauvegarde de projet.
