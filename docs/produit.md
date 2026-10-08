# Logique produit et modèle de données

À consulter pour toute tâche touchant projets, designs, variantes, contenus, campagnes, calendrier, Meta, sauvegardes. Détails : `wordpress.md`, `sauvegarde-restauration.md`, `procedure-test-parcours.md`, `verification-illustrator/`.

## Principe : une personne seule, peu de temps

L'atelier est conçu pour **une seule personne**. Rien ne suppose un relecteur ou un second compte (ils restent facultatifs). Les contrôles automatiques remplacent la relecture extérieure ; un parcours standard coûte **3 actions** (créer la variante, « Approuver et exporter », « Associer à la campagne ») ; « À faire maintenant » et « Prochaine étape » disent quoi faire sans chercher. Toute fonction doit réduire le temps ou les erreurs d'une personne qui n'a pas le temps.

## Nomenclature

```
Projet                         (table `editions`, appelé « projet » dans l'interface)
├── Site WordPress             UN site par projet, sur SON domaine (onglet Site web ; identifiants propres au projet ; voir wordpress.md)
├── Bibliothèque               assets · designs (versionnés, réappliquables) · contenus
├── Création                   variantes guidées · affiches (7 formats) · vidéos
├── Calendrier de production
└── Connexion Meta (manuelle)
    └── Campagnes              créées dans Meta, reliées ici → ensembles → annonces
        └── contenus associés (version épinglée) : production, validation, transmission, suivi
```

Un projet a plusieurs campagnes, toutes vers le même site ; créer une campagne ne crée pas de site. Un contenu existe sans campagne (organique) et s'associe à un ou plusieurs niveaux.

## Statuts (vocabulaire unique)

- Variante / contenu : `brouillon → à relire → approuvé` (+ `archivé`).
- Parcours d'une sortie : `brouillon · à relire · approuvé · exporté · transmis · publié`.
  **Exporté** = un fichier existe ; **transmis** = envoyé à Meta (déclaration manuelle tant que l'API n'est pas connectée) ; **publié** = diffusé dans Meta. Ne jamais les confondre.
- Association contenu↔niveau : `brouillon · à relire · approuvé · transmis · publié · erreur`. `transmis` et `publié` = **version diffusée figée**.

## Variantes (`variants.js`)

Une variante = une **intention** (angle, audience, langue, format, relance) + une **hypothèse** obligatoire ; refus d'une quasi-copie (même angle+audience+langue dans la même campagne). Ses designs vivent sous la clé `v<id>_<format>` (éditeur d'affiche réutilisé via `?variant=`), vidéo et sous-titres sous la portée `v<id>`.
« Approuver » enregistre une **version immuable** (designs, sous-titres, fiche à cet instant). L'**export officiel part toujours de la version approuvée** ; clé de contenu identique = pas de doublon (reprise après erreur comprise). Toute modification après approbation → `à relire`, sans toucher à la version approuvée ni à ses exports. Les sorties exportées deviennent des `contents` associables.

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
