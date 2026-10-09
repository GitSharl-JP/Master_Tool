# Project Status

## Current state
Local, fonctionnel, **conçu pour une personne seule** (un seul compte suffit ; relecteur/responsable facultatifs et masqués). Parcours testé de bout en bout (`tests/parcours.mjs` : 111 contrôles, ~50 s dont étape navigateur).

## Recently completed
- **Réorganisation en parcours de contenu** (non commité à la date de cette note) : navigation en cinq destinations (Accueil, Contenus, Campagnes, Bibliothèque, Site web) + Paramètres du projet ; « Créer un contenu » (affiche, vidéo, texte) ; espace à quatre étapes (Matériel → Création → Vérification et exports → Diffusion) y compris pour les textes ; affiche reçue (SVG/image) et documents comme points d'entrée ; gestionnaire de projets (essai, renommer, archiver, supprimer) ; campagnes organisées autour des contenus (configuration Meta déplacée dans les paramètres) ; validations ciblées par contenu ; modèles de contenu et kit graphique. Vérifié par `tests/parcours.mjs` (≈290 contrôles) et captures navigateur à 1400 px et 420 px. **Non vérifié** : export vidéo de bout en bout depuis le nouvel espace avec écran de fin, un vrai fichier Illustrator, les sections basses d'une campagne (ensembles, annonces, résultats) inchangées.
- **Refonte visuelle de la navigation** : bandeau unifié (Projets, Réglages, menu utilisateur), menu du projet en 4 menus déroulants (Projet, Bibliothèque, Création, Meta) avec description par entrée et fil d'Ariane, normes d'espacement/champs en fin de `public/style.css`. Non vérifié dans le navigateur ni par `tests/parcours.mjs` (à relancer) ; sections de fiche repliables envisagées, non faites.
- Parcours court en solo : **3 actions** de la création de la variante à son association (créer → « Approuver et exporter » → « Associer à la campagne »), mesuré par le test.
- Contrôles automatiques avant approbation (à la place d'une relecture extérieure : « à corriger » bloquant, « à savoir » informatif) ; « Prochaine étape » avec son bouton sur chaque variante ; « À faire maintenant » en tête du projet et du calendrier ; assistant préremplí depuis les formats manquants d'un ensemble.
- **Un site WordPress par projet, sur son domaine** : onglet Site web (domaine, environnement, état, plan de construction), identifiants WordPress propres au projet (plus de réglage global). Décision confirmée : les autres sites ne sont que des exemples. Documentation : `docs/wordpress.md`.
- **Illustrator** : SVG validé par vous (calques nommés, rendu, texte modifiable) ; détourage du fond supprimé ensuite (image recadrée dans le fichier), à revérifier ; remplacement d'image et PDF non testés.
- Avant : variantes guidées + approbation figée + export sans doublon ; campagnes actives travaillables (versions transmises/publiées figées) ; configuration Meta ≠ brief interne ; calendrier ; sauvegarde externe + restauration testée ; fichier de test Illustrator.

## Next
- **À faire par vous** : parcours chronométré en solo (`docs/procedure-test-parcours.md`, 30–45 min) ; finir le test Illustrator (remplacement d'image, PDF, plus d'avertissement) ; choisir un dossier de sauvegarde externe (Réglages).
- Choisir hébergement et domaine du site du spectacle, puis construire le site WordPress (thème de base + pages en brouillon depuis le projet) ; prestataire de billetterie.
- Connexion Meta en lecture (quand l'app Meta existe) ; Buffer ; transcription/traduction des sous-titres ; restauration d'un seul projet.

## Known issues
- Illustrator : validation partielle (voir ci-dessus).
- Aucune synchronisation Meta : tous les statuts Meta sont saisis à la main (affichés comme tels).
- Sauvegarde automatique quotidienne non observée sur 24 h (fonction testée en manuel).
- Restauration testée en local (même machine) ; autre machine / gros volumes non testés.
- Exports vidéo tournent dans le processus du serveur : fermer la fenêtre noire les interrompt (relançables).
- Polices Microsoft non redistribuables : jamais incluses dans les archives.

## Important decisions
- Un projet possède un seul site ; les campagnes (créées dans Meta) y renvoient sans le piloter.
- Terme « projet » dans l'UI, table `editions` conservée (aucune migration).
- Local d'abord, serveur plus tard. Windows prioritaire. V1 en EN seulement (ajouter une langue = `LANGS` dans `src/schema.js`).
- Dépôt Git initialisé à la demande ; aucun remote configuré.
