// Procédure de vérification Illustrator, jointe à chaque archive de design.
// Principe : ne JAMAIS annoncer une compatibilité tant qu'elle n'a pas été constatée dans Illustrator.
export function illustratorChecklist({ fonts = [], designName = '', version = '' } = {}) {
  return `VÉRIFICATION DANS ADOBE ILLUSTRATOR — design « ${designName} » v${version}
====================================================================

STATUT : NON VALIDÉ DANS ILLUSTRATOR.
Aucun test n'a pu être réalisé dans Illustrator (logiciel indisponible là où l'atelier a été conçu).
Tant que la procédure ci-dessous n'a pas été faite par vous, n'affirmez pas que l'export est « compatible Illustrator ».

CE QUI EST DÉJÀ ÉTABLI (sans Illustrator)                                      | niveau de preuve
-----------------------------------------------------------------------------+-----------------------------------
Chaque élément (Titre, Dates, Logo, Bandeau…) est un groupe SVG séparé, nommé  | constaté en lisant le fichier
Le texte est du vrai texte SVG (une ligne = un objet texte), pas des contours  | constaté en lisant le fichier
Les images sont intégrées dans le fichier (pas de lien externe)                | constaté en lisant le fichier
Le dégradé est un vrai dégradé (couleur + opacité), pas une image             | constaté en lisant le fichier
Le rendu du SVG ouvert dans Edge est identique à l'affiche d'origine           | comparé visuellement
Le design reste réutilisable dans l'atelier (design.json), sans Illustrator    | testé (import / application)

CE QUI RESTE À VÉRIFIER PAR VOUS                                               | à noter dans le tableau
-----------------------------------------------------------------------------+-----------------------------------
Illustrator ouvre-t-il le SVG sans erreur ?                                    |
Les groupes nommés apparaissent-ils comme de VRAIS CALQUES (panneau Calques)   | (sinon : sous-calques ou groupes)
ou seulement comme des groupes dans un calque unique ?                         |
Le texte est-il éditable (outil Texte), avec la bonne police ?                 | polices à installer : ${fonts.join(', ') || '(aucune détectée)'}
Un titre sur 2 lignes donne-t-il 2 objets texte (attendu) ?                    |
Le PDF : le texte reste-t-il du texte, ou devient-il des contours ?            |
Les effets : dégradé, rotation du bandeau, espacement des lettres, opacité     |

PROCÉDURE (environ 30 minutes, avec le dossier svg/ et pdf/ de cette archive)
-----------------------------------------------------------------------------
Installez d'abord les polices ci-dessus (sinon Illustrator les remplace et le texte change d'aspect).

 1. Fichier > Ouvrir > svg/4x5.svg.
    Notez : la version d'Illustrator ; tout message d'erreur ; toute alerte de polices manquantes.
 2. Ouvrez le panneau Calques (Fenêtre > Calques). Dépliez tout.
    Notez : voyez-vous des calques nommés Fond, Degrade, Logo, Bandeau, Titre… ?
    Sont-ils des calques, des sous-calques ou des groupes ? (Si ce sont des groupes dans un seul calque :
    sélectionnez-les, menu du panneau Calques > « Libérer sur les calques (séquence) ».)
 3. MODIFIER LE TITRE. Outil Texte (T), cliquez dans le titre, remplacez le texte.
    Notez : le texte est-il modifiable ? La police est-elle la bonne ? Chaque ligne est-elle un objet séparé ?
 4. DÉPLACER LE LOGO. Outil Sélection (V), cliquez sur le logo, déplacez-le de 50 px vers la droite.
    Notez : le logo se sélectionne-t-il seul ? Est-il « Incorporé » (panneau Liens) ?
 5. REMPLACER UNE IMAGE. Sélectionnez la photo de fond (calque Fond), panneau Liens ou Propriétés > « Remplacer »
    (ou « Incorporer » puis placer une autre image). Notez : est-ce possible, et le cadrage reste-t-il correct ?
 6. VÉRIFIER dégradé, polices et effets en comparant avec apercus/4x5.png :
      - le dégradé sombre en bas (ou à gauche) est-il présent, avec la bonne transparence ?
      - le bandeau est-il incliné de -5° avec son contour clair ?
      - l'espacement des lettres (lignes en capitales) est-il conservé ?
      - les couleurs du titre / du bouton sont-elles identiques ?
 7. ENREGISTRER sous « essai.ai », fermez, rouvrez. Exportez aussi en PNG 1080 px de large
    (Fichier > Exporter > Exporter sous…) et comparez à apercus/4x5.png : superposez les deux images à 50 %
    dans n'importe quel outil ; notez les différences (décalage de texte, police, couleur).
 8. Refaites les étapes 1 à 3 avec pdf/4x5.pdf (Fichier > Ouvrir). Notez : texte éditable ou contours ?
    Notez aussi si les polices sont remplacées.

TABLEAU DE RÉSULTATS (à remplir, puis à nous transmettre avec 2 ou 3 captures d'écran)
-----------------------------------------------------------------------------
Version d'Illustrator : ______
                               SVG                         PDF
Ouvre sans erreur            : [ ] oui [ ] non           [ ] oui [ ] non
Calques réels                : [ ] oui [ ] sous-calques [ ] groupes seulement   (PDF : habituellement non)
Texte éditable               : [ ] oui [ ] avec police remplacée [ ] contours
Titre 2 lignes = 2 objets    : [ ] oui [ ] non
Logo déplaçable seul         : [ ] oui [ ] non
Image remplaçable            : [ ] oui [ ] non
Dégradé conservé             : [ ] oui [ ] altéré
Rotation du bandeau          : [ ] oui [ ] altérée
Espacement des lettres       : [ ] oui [ ] perdu
Rendu final = aperçu PNG     : [ ] identique [ ] différences mineures [ ] différences gênantes
Remarques : ______________________________________________

COMMENT INTERPRÉTER
 - Tout est « oui » pour le SVG : l'export Illustrator est validé pour ce type de design.
 - Seuls texte et images posent problème : privilégiez le SVG pour le texte et le PDF pour la mise en page, et
   gardez l'atelier pour les modifications de contenu (le design y reste entièrement modifiable).
 - Dans tous les cas, l'export Illustrator est un COMPLÉMENT : le design vit dans l'atelier (design.json) et
   peut y être modifié, dupliqué et réappliqué même si Illustrator ne le lit pas parfaitement.

LIMITES CONNUES, DÉJÀ ANNONCÉES
 - Le format .ai n'est pas produit (format propriétaire d'Adobe). Vous pouvez en créer un depuis Illustrator.
 - Un paragraphe est découpé en lignes (une ligne = un objet texte) : pas de reflux automatique du texte.
 - Les ombres et effets propres au navigateur ne sont pas restitués (aucun n'est utilisé dans les modèles actuels).
 - Les polices Microsoft (Georgia, Segoe UI…) ne peuvent pas être jointes à l'archive (licence).
`;
}
