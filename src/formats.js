// Catalogue des formats et des canaux. Un format = une forme (dimensions + zones de sécurité + type de composition).
// Les mêmes formats servent aux affiches ET aux vidéos. Pour ajouter un format ou un canal : modifier ce fichier seulement.
//
// ATTENTION : ces dimensions sont les recommandations courantes des plateformes, qui changent régulièrement.
// À re-vérifier dans l'aide officielle de chaque plateforme avant une campagne.
//
// layout : portrait | square | landscape | banner  (la composition est recalculée par forme, pas étirée)
// safe   : marges (px) à garder libres de texte (interfaces de Stories/TikTok qui recouvrent l'image)
export const FORMATS = {
  '4x5':    { label: '4:5 — post feed',            ratio: '4:5',    w: 1080, h: 1350, layout: 'portrait',  safe: { top: 70,  bottom: 80,  side: 72 } },
  '1x1':    { label: '1:1 — carré',                ratio: '1:1',    w: 1080, h: 1080, layout: 'square',    safe: { top: 70,  bottom: 80,  side: 72 } },
  '9x16':   { label: '9:16 — Stories / Reels',     ratio: '9:16',   w: 1080, h: 1920, layout: 'portrait',  safe: { top: 250, bottom: 300, side: 72 } },
  'tiktok': { label: '9:16 — TikTok',              ratio: '9:16',   w: 1080, h: 1920, layout: 'portrait',  safe: { top: 160, bottom: 420, side: 120 } },
  '16x9':   { label: '16:9 — X / YouTube',         ratio: '16:9',   w: 1600, h: 900,  layout: 'landscape', safe: { top: 60,  bottom: 60,  side: 80 } },
  'link':   { label: '1,91:1 — lien partagé',      ratio: '1.91:1', w: 1200, h: 630,  layout: 'landscape', safe: { top: 40,  bottom: 40,  side: 56 } },
  'banner': { label: '3:1 — bannière / en-tête',   ratio: '3:1',    w: 1500, h: 500,  layout: 'banner',    safe: { top: 30,  bottom: 30,  side: 60 } },
};

// Formats proposés pour les vidéos (la bannière n'a pas de sens en vidéo).
export const VIDEO_FORMATS = ['9x16', 'tiktok', '4x5', '1x1', '16x9'];

export const CHANNELS = {
  instagram: { label: 'Instagram', uses: [['4x5', 'Post (feed)'], ['1x1', 'Post carré'], ['9x16', 'Story / Reel']] },
  facebook:  { label: 'Facebook',  uses: [['4x5', 'Post (feed)'], ['9x16', 'Story'], ['link', 'Lien partagé'], ['banner', 'Couverture (à recadrer)']] },
  tiktok:    { label: 'TikTok',    uses: [['tiktok', 'Vidéo / photo']] },
  x:         { label: 'X',         uses: [['16x9', 'Post image'], ['1x1', 'Post carré'], ['banner', 'En-tête']] },
  youtube:   { label: 'YouTube',   uses: [['16x9', 'Miniature / vidéo'], ['9x16', 'Shorts']] },
  linkedin:  { label: 'LinkedIn',  uses: [['link', 'Post lien'], ['1x1', 'Post carré']] },
};

// Liste des formats distincts nécessaires pour un ensemble de canaux.
export const formatsForChannels = (keys) => [...new Set(keys.filter((k) => CHANNELS[k]).flatMap((k) => CHANNELS[k].uses.map(([f]) => f)))];
// Canaux qui utilisent un format donné.
export const channelsOf = (fmt) => Object.values(CHANNELS).filter((c) => c.uses.some(([f]) => f === fmt)).map((c) => c.label);
