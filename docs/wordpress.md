# WordPress : ce qui existe et l'intégration recommandée

Inspection réalisée le 2026-10-08 (à titre d'exemple de pile et de conventions) sur le site local `acoustiguide-japan.local` (lecture seule : interface REST publique et fichiers du thème ; `wp-config.php` et la base n'ont pas été lus).

## Ce qui existe (constaté)

- Thème **sur mesure** `acoustiguide-japan` (« pas de builder »), **Carbon Fields** (champs des types de contenu et options du thème — c'est le composant mentionné plus tôt sous le nom « Carbon Shield »), **Polylang** (JA par défaut, EN sous `/en/`), **All-in-One WP Migration**. Application Passwords disponibles (point d'autorisation présent).
- Environnements décrits par le thème : Local → Staging (WordPress.com) → Production, migration manuelle ; règles : ne jamais modifier la production sans demande explicite, page d'accueil figée, contenu éditorial modifiable dans WP-Admin.
- Le thème se décrit comme un **site vitrine B2B**. Il n'a **aucun** modèle de billetterie, de calendrier de séances ni de réservation.
- Il possède déjà le type de contenu **`nightshow`** (« ナイトショー実績 », exposé dans l'API REST) et la page modèle `page-immersive-show.php` (JA + EN). 4 entrées publiées : Vercors en Lumières, Parc et Lumières, Remparts et Lumières, Entre Vignes et Lumières. Une entrée = titre, contenu, extrait, image mise en avant, lieu, étiquette, galerie photos. Ce sont des **références** de l'activité d'Orpheo, pas un site de vente.

## Décision (confirmée)

- **Un site WordPress par projet, sur son propre domaine**, construit pour le spectacle. Les autres sites (le site vitrine d'Acoustiguide, ceux de Vercors ou de Vignes) sont des **exemples** pour la structure et le ton ; ils ne sont **jamais regroupés** avec lui, et le site vitrine B2B n'est ni reconstruit ni modifié.
- Le site appartient au **projet**, pas à une campagne : plusieurs campagnes Meta peuvent renvoyer vers le même site ; créer une campagne ne crée pas de site.
- Dans l'atelier : onglet **Site web** du projet (domaine, environnement local/staging/production, état, plan de construction) et **identifiants propres au projet** (jamais partagés d'un projet à l'autre, jamais réaffichés, jamais sauvegardés).

## Construction recommandée (à faire ensuite, rien n'est commencé côté WordPress)

1. **Même pile** que l'existant pour rester maîtrisable : WordPress, thème sur mesure, Carbon Fields pour les champs, Polylang si plusieurs langues. Un **thème de base partagé** (maintenu une fois) habillé par la charte de chaque projet (couleurs, polices) : la réutilisation d'une édition à l'autre ne reconstruit rien.
2. **Pages** (Accueil, Expérience, Galerie, Calendrier/Réservation, Accès, FAQ, Contact) créées **en brouillon** depuis le projet via l'API REST et un mot de passe d'application ; aperçu avant publication ; jamais de publication automatique ; production touchée uniquement sur demande explicite.
3. **Billetterie** : dépend du prestataire (pas encore choisi) ; l'atelier ne fait jamais de la billetterie la source des prix ou des places.
4. **Plus tard, facultatif** : une fois le spectacle public, une entrée de référence dans le site vitrine existant (type de contenu `nightshow`), en brouillon, publiée par vous.

## Non vérifié (à confirmer avant de construire)

- L'écriture des champs Carbon Fields par l'API REST (probablement une exposition des méta côté thème : une intervention technique unique).
- Le rattachement des traductions par Polylang via l'API REST (selon la version du plugin).
- Les capacités de l'hébergement choisi pour le nouveau domaine (thème et extensions personnalisés), et le plugin de la billetterie.
- Le comportement exact d'une publication sur un staging.

## Ce qu'il faut décider pour avancer

L'hébergement et le domaine (choix à vous), puis le prestataire de billetterie. Ils ne bloquent ni la production des contenus ni les campagnes.
