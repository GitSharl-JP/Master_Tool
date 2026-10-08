# Test du parcours complet — en solo

But : refaire **seul(e)**, sans terminal ni code, le parcours « campagne → variantes → export → association », et **chronométrer** pour savoir où le temps part. Durée : 30 à 45 minutes la première fois. L'atelier est conçu pour une personne seule : tout ce qui suit se fait avec un seul compte.

Avant de commencer : double-cliquez sur `Demarrer.bat`. Pour s'entraîner sans risque, créez un projet « ESSAI » : rien de ce que vous y faites ne touche aux vrais projets.

## Le chemin court (3 actions par variante)

1. **Projet prêt** (une seule fois par projet). *Fiche* : titre, dates, lieu, couleurs ; passez les sections en « approuvé » ; « Lieu confirmé » = *confirmé* **seulement si c'est vrai** ; décochez « provisoire ». *Assets* : photo, logo, film, marqués « approuvé » quand ils sont définitifs.
   En tête du projet, **« À faire maintenant »** liste ce qui reste ; le bandeau de la fiche dit « Fiche prête » quand c'est bon. Sinon vos exports seront marqués BROUILLON (voulu).
2. **Relier la campagne créée dans Meta** (une fois par campagne) : onglet *Campagnes*. Le nom et le statut Meta sont **saisis par vous** (marqués « saisi à la main ») ; le **brief interne** (objectif, message, audience souhaitée, hypothèse) est séparé.
3. **Créer la variante** (action 1) : *Variantes* > « + Nouvelle variante ». Choisissez l'intention, vérifiez l'hypothèse proposée, la campagne, la photo. Les formats se **préremplissent** : depuis une campagne, le lien « Créer une variante » de l'ensemble coche les formats manquants.
4. **Approuver et exporter** (action 2) : sur la page de la variante, **« Prochaine étape »** vous dit quoi faire. Les **contrôles automatiques** remplacent une relecture extérieure : « À corriger » empêche d'approuver, « À savoir » prévient. Si vous voulez relire plus tard avec un regard neuf : « Mettre de côté ».
5. **Associer à la campagne** (action 3) : un clic (« Associer à l'ensemble … »). L'association démarre en **brouillon**, liée à l'export précis.
6. *(quand vous êtes prêt à diffuser)* page de la campagne : « Approuver pour cette campagne » → « Transmettre… » (récapitulatif, confirmation) → vous déposez vous-même dans Ads Manager → « Marquer comme publiée… ».
7. **Calendrier** : « Planifier à rebours » depuis la date de publication visée ; l'onglet *Calendrier* affiche aussi « À faire maintenant ».

Corrections : *Textes de la variante* puis « Ajuster » sur chaque format (clic/glisser sur l'aperçu), sous-titres pour la vidéo. Toute modification après approbation → « à relire » ; **la version approuvée et ses fichiers ne changent pas** ; « Revenir à la version approuvée » la rétablit.

## Trois mots à ne jamais confondre

**Exporté** = un fichier existe sur l'ordinateur · **Transmis** = vous l'avez envoyé à Meta (déclaration manuelle) · **Publié** = diffusé dans Meta.

## Si quelque chose ne marche pas

Un message explique quoi faire. Un export vidéo en erreur se relance avec le même bouton, sans doublon. Si une page semble figée : fermez la fenêtre noire de `Demarrer.bat` et relancez-la (vos données sont conservées).

## Chronomètre (à remplir)

| Étape | Durée | Où ça bloque / ce qui est lent |
|---|---|---|
| Projet prêt (fiche, assets) | | |
| Campagne reliée + brief | | |
| Création de la variante | | |
| Corrections (textes, cadrage, sous-titres) | | |
| Approuver et exporter | | |
| Associer à la campagne | | |
| Dépôt dans Meta + déclaration | | |
| **Total pour la 1re variante** | | |
| **Total pour la 2e variante** (c'est elle qui compte) | | |

Repères mesurés par le test automatisé `tests/parcours.mjs` : **3 actions** de la création de la variante à son association à la campagne ; la partie machine (exports d'affiches, vidéo, sauvegarde, restauration) du parcours entier dure **moins d'une minute**. Tout le reste est du travail humain : c'est ce que ce chronomètre doit mesurer.
