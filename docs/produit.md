# Logique produit et modèle de données

À consulter pour toute tâche touchant projets, designs, variantes, contenus, campagnes, calendrier, Meta, sauvegardes. Détails : `wordpress.md`, `sauvegarde-restauration.md`, `procedure-test-parcours.md`, `verification-illustrator/`.

## Principe : une personne seule, peu de temps

L'atelier est conçu pour **une seule personne**. Rien ne suppose un relecteur ou un second compte (ils restent facultatifs). Les contrôles automatiques remplacent la relecture extérieure ; un parcours standard coûte **3 actions** (créer la variante, « Approuver et exporter », « Associer à la campagne ») ; « À faire maintenant » et « Prochaine étape » disent quoi faire sans chercher. Toute fonction doit réduire le temps ou les erreurs d'une personne qui n'a pas le temps.

## Nomenclature

```
Projet                         (table `editions`, appelé « projet » dans l'interface)
├── Accueil                    tableau de travail : à reprendre, à relire, échéances, « À faire maintenant » ; calendrier en sous-vue
├── Contenus                   affiches · vidéos · textes, chacun dans UN espace à quatre étapes (voir plus bas)
├── Campagnes                  créées dans Meta, reliées ici → ensembles → annonces ; contenus associés (version épinglée)
├── Bibliothèque               Fichiers sources (assets) · Designs et modèles (kits graphiques, modèles de contenu)
├── Site web                   UN site par projet, sur SON domaine (identifiants propres au projet ; voir wordpress.md)
└── Paramètres du projet       fiche du spectacle, charte, connexion Meta (manuelle), gestion du projet (renommer, archiver, supprimer)
```

Un projet a plusieurs campagnes, toutes vers le même site ; créer une campagne ne crée pas de site. Un contenu existe sans campagne (organique) et s'associe à un ou plusieurs niveaux.

## Contenu et espace de travail (vocabulaire de l'interface : « contenu »)

- Interne : un contenu affiche/vidéo = ligne `variants` (URL `/variants/:id`) ; un texte = ligne `contents` de type `texte` (URL `/texts/:id`). Aucune migration : seule la couche d'affichage est commune.
- **Créer un contenu** : type (affiche / vidéo / texte), nom proposé, campagne facultative, point de départ (zéro, copie d'un contenu, fichier de la bibliothèque, modèle). Pas d'hypothèse à écrire : « Mode test détaillé » (`?mode=test`) garde intention, angle, audience, hypothèse pour les vrais tests créatifs ; sinon un panneau « Brief marketing » replié.
- **Quatre étapes**, accessibles dans n'importe quel ordre, avec le même en-tête dans les éditeurs d'affiche et de vidéo : Matériel (import direct utilisé aussitôt, affiche reçue, modèle, formats) → Création (textes communs, éditeur de chaque format, « Enregistrer comme modèle ») → Vérification et exports (contrôles, approbation figée, export) → Diffusion (campagne Meta, publication organique, téléchargement ; rien n'est envoyé à Meta).
- Les sorties exportées deviennent seules des `contents` associables : aucune saisie manuelle.

## Validations ciblées (`schema.js` : `posterNeeds`, `videoNeeds`, `explainNeeds`)

Un contenu n'exige de la fiche que ce qu'il affiche : une affiche composée → sections Identité, Charte, + Lieu et dates si l'info lieu/dates est affichée, + Réservation si bouton ou site affichés, et « non provisoire » ; une vidéo → seulement son écran de fin (s'il est activé) ; une affiche reçue ou un texte → rien de la fiche (seul un fichier « provisoire » rend l'export BROUILLON). `publishBlockers` (large : lieu confirmé + 8 sections approuvées + non provisoire) ne reste exigé que pour le site. Préparer en brouillon est toujours permis ; l'écart est expliqué avec un lien vers la section à corriger (`/settings#sec-<id>`). Choix de sécurité : une affiche reçue ou une vidéo ne bloque pas sur un lieu non confirmé, mais l'atelier le signale (conseil) avant diffusion.

## Modèles et kit graphique (`library.js`, colonne `design_templates.kind`)

- `modele` : la composition d'UN contenu (formats, éléments modifiables, style vidéo), enregistré depuis le contenu ; réutilisable dans « Créer un contenu » sans jamais modifier l'original (dupliquer pour changer). Refusé pour un contenu basé sur une affiche reçue.
- `kit` : charte, logo, styles communs (dégradé, composition, position du texte, partenaires) et style vidéo ; s'applique au projet (photos et textes intacts) ; jamais proposé comme point de départ d'un contenu.
- `projet` : l'ancien « design complet du projet », conservé (replié).

## Statuts (vocabulaire unique)

- Variante / contenu : `brouillon → à relire → approuvé` (+ `archivé`).
- Parcours d'une sortie : `brouillon · à relire · approuvé · exporté · transmis · publié`.
  **Exporté** = un fichier existe ; **transmis** = envoyé à Meta (déclaration manuelle tant que l'API n'est pas connectée) ; **publié** = diffusé dans Meta. Ne jamais les confondre.
- Association contenu↔niveau : `brouillon · à relire · approuvé · transmis · publié · erreur`. `transmis` et `publié` = **version diffusée figée**.

## Variantes (`variants.js`)

Une variante = une **intention** (angle, audience, langue, format, relance) + une **hypothèse** obligatoire ; refus d'une quasi-copie (même angle+audience+langue dans la même campagne). Ses designs vivent sous la clé `v<id>_<format>` (éditeur d'affiche réutilisé via `?variant=`), vidéo et sous-titres sous la portée `v<id>`.
« Approuver » enregistre une **version immuable** (designs, sous-titres, fiche à cet instant). L'**export officiel part toujours de la version approuvée** ; clé de contenu identique = pas de doublon (reprise après erreur comprise). Toute modification après approbation → `à relire`, sans toucher à la version approuvée ni à ses exports. Les sorties exportées deviennent des `contents` associables.

## Points d'entrée libres (`intake.js`, `svgclean.js`)

On ne part pas toujours de la fiche : le même parcours (design → variante → export → contenu → campagne) doit marcher quel que soit le point de départ et l'ordre.

- **Affiche reçue** (SVG, ou PNG/JPG/WebP ; un `.ai`/PDF doit d'abord être exporté en SVG, il n'est pas converti) : l'asset (rôle `poster`) devient le design de chaque format via les clés `ext`/`fit`/`bgc` du design (absentes des designs composés, pour ne pas changer l'empreinte des variantes déjà approuvées). `fit` : `cover` (proportions à ±8 %), sinon `blur` (entière sur sa copie floutée) ; `contain` = fond uni. Aucun texte de la fiche n'est ajouté ; ses textes ne s'éditent pas (on corrige le fichier et on le réimporte). Le SVG est nettoyé à l'envoi (script, `on*`, DOCTYPE, `foreignObject` retirés ; dimensions garanties). Avertissements (« conseil », jamais bloquants) : texte vivant, images liées, filtres/masques. Les exports restent en BROUILLON tant que la fiche n'est pas prête ou que l'asset est « provisoire ». Variantes : `poster=<asset>` à la création ; les contrôles ne demandent alors ni photo, ni logo, ni titre de fiche.
- **Document** (concept, script, brief : `.docx`/`.odt` lus par le tar de Windows, `.txt`/`.md`, sinon fichier joint sans texte) : devient un contenu `texte` (`contents.body`, `contents.asset_id`). Un contenu texte s'associe à une campagne **sans export** et suit le même parcours de validation ; il peut préremplir l'assistant de variante (`/variants/new?content=ID`, rien n'est repris automatiquement).
- Limites connues : une affiche reçue n'entre pas dans la bibliothèque de designs (modèles) ; pas d'export SVG recomposé pour elle (on rend le fichier d'origine) ; PDF/PowerPoint non lus.

## Garde-fous Meta (ne pas contourner)

- L'atelier n'écrit **rien** dans Meta (API non connectée) ; `transmis`/`publié` sont des **déclarations manuelles**, affichées comme telles, qui exigent un **récapitulatif + confirmation** (empreinte du récapitulatif, périmé = refusé).
- Une association est épinglée sur un export précis ; un nouvel export ne la remplace jamais (badge « nouvelle version disponible »).
- Une campagne **active** n'interdit pas de travailler : on prépare de nouvelles variantes **en brouillon** ; seules les associations `transmis`/`publié` sont figées et ne se retirent pas.
- `approuvé`/`transmis` exigent un contenu approuvé et un export non BROUILLON.
- Chaque niveau sépare **configuration Meta** (`meta_*` : provisoire/saisie à la main tant que non synchronisée, `meta_synced_at` vide) et **brief interne** (`brief_*`). Budget prévu ≠ budget configuré ; audience souhaitée ≠ ciblage réel ; objectif interne ≠ objectif Meta.

## API Meta (documentation officielle, à reconfirmer à la mise en place)

- Hiérarchie : campagne → ensemble → annonce → création. Lecture : `ads_read` ; gestion : `ads_management`. Résultats par niveau, avec ventilation par image/vidéo ; envoi d'images/vidéos par `adimages`/`advideos`.
- **Source officielle** (page « Authorization » du Marketing API) : l'accès *standard* à `ads_read` et `ads_management` suffit pour gérer **ses propres** comptes publicitaires ; l'accès *avancé* (examen de l'application) concerne les comptes d'**autres** personnes. La vérification d'entreprise est exigée « pour accéder à des données sensibles » : **non établi pour notre cas** — ne pas la présenter comme obligatoire sans l'avoir constaté dans le tableau de bord de l'application. La page ne dit pas explicitement ce que permet le mode développement.

## Données (SQLite `data/atelier.db`)

`editions` (projets) · `assets` · `designs`/`design_history` (réglages par format ou variante) · `design_templates`/`design_versions`/`design_applications` (bibliothèque) · `variants`/`variant_versions` · `exports` (+ `variant_id`, `variant_version`, `fmt`, `content_key`) · `jobs` (vidéo) · `subtitles2` (par portée) · `contents`/`content_links` · `campaigns`/`adsets`/`ads` · `results` · `plan_items` (calendrier) · `settings`/`backups`.

## Export éditable des designs

- **.ai non produit** (propriétaire). **SVG** : groupe nommé par élément, texte vivant (1 ligne = 1 objet), images intégrées, dégradé réel, rotation du bandeau conservée. **PDF vectoriel** : texte et formes vectoriels.
- **Illustrator (constaté par l'utilisateur, 2026-10-08, version japonaise)** : calques nommés présents (sous-calques d'un « Calque 1 »), rendu fidèle, texte modifiable avec la bonne police. **Corrigé après ce test (à revérifier par vous)** : le détourage du Fond a été supprimé, l'image est recadrée aux bords du format dans le fichier (plus de clip-path, donc plus d'avertissement attendu). **Non testé** : remplacement d'image, PDF, effets. Procédure : `docs/verification-illustrator/`.
