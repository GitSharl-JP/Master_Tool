// Guide Ads Manager : traduit les données de l'atelier en ce qu'il faut SAISIR dans Meta, écran par écran, avec des valeurs à copier.
// L'interface de Meta change souvent (libellés, ordre des écrans) : tout le vocabulaire propre à Meta est regroupé ici, dans ce seul fichier,
// pour qu'une mise à jour ne touche rien d'autre. Rien n'est envoyé à Meta : l'atelier prépare, vous saisissez dans Ads Manager.
import { FORMATS, CHANNELS } from './formats.js';
import { trackedUrl } from './campaigns.js';

// Nos objectifs internes → libellé de l'objectif de campagne tel que Meta le propose (à reconfirmer dans Ads Manager).
export const META_OBJECTIVES = {
  'Notoriété': { meta: 'Notoriété', hint: 'Faire connaître le spectacle au plus grand nombre.' },
  'Trafic': { meta: 'Trafic', hint: 'Envoyer des personnes vers le site ou la billetterie (le plus simple pour démarrer).' },
  'Engagement': { meta: 'Interactions', hint: 'Obtenir des réactions, messages, vues de vidéo.' },
  'Prospects': { meta: 'Prospects', hint: 'Collecter des contacts (formulaire).' },
  'Ventes / billetterie': { meta: 'Ventes', hint: 'En général, cet objectif suppose un suivi des achats (pixel ou API de conversion) sur le site de billetterie ; sans cela, « Trafic » est plus simple.' },
  'Autre': { meta: '', hint: 'Choisissez l’objectif le plus proche dans Ads Manager.' },
};
// Boutons d'appel à l'action : choisir dans la liste de Meta le libellé le plus proche.
export const META_CTAS = ['Réserver', 'En savoir plus', 'Acheter', 'S’inscrire', 'Nous contacter'];
// Longueurs conseillées (au-delà, Meta tronque l'affichage ; ce n'est pas une limite stricte).
export const LIMITS = { primary: 125, headline: 40, description: 30 };

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Noms conseillés : les noms saisis dans Meta servent ensuite à retrouver les résultats (import du rapport) ; garder cette forme.
export const suggestAdsetName = (camp, adset) => [camp.name, adset.brief_audience, adset.brief_languages].filter(Boolean).join(' | ');
export const suggestAdName = (adset, ad, link) => [adset.name, ad.brief_angle || link?.angle, link?.format && FORMATS[link.format] ? FORMATS[link.format].ratio : ''].filter(Boolean).join(' | ');

// Emplacements souhaités → ce qu'il faut cocher / préparer.
export function placementsHelp(keys) {
  const lines = keys.filter((k) => CHANNELS[k]).map((k) => `${CHANNELS[k].label} : ${CHANNELS[k].uses.map(([f, use]) => `${use}${FORMATS[f] ? ' ' + FORMATS[f].ratio : ''}`).join(', ')}`);
  return lines;
}

// Fiche d'une publicité : valeurs à copier, fichiers à téléverser, points à vérifier avant de publier.
export function adSheet({ ed, meta, camp, adset, ad, links }) {
  const warnings = [], fields = [];
  const f = (label, value, note = '', opts = {}) => fields.push({ label, value: value || '', note, ...opts });
  f('Nom de la publicité', ad.name, 'Gardez exactement ce nom dans Meta : il sert à retrouver les résultats.');
  f('Page Facebook', meta.page_name, meta.page_name ? 'Identité de la publicité (rubrique « Identité »).' : 'Non renseignée : à saisir dans Paramètres du projet › Connexions.');
  f('Compte Instagram', meta.instagram, 'Identité de la publicité.');
  f('Texte principal', ad.copy_primary, `Le texte au-dessus de l’image. Conseillé : ${LIMITS.primary} caractères ou moins.`, { max: LIMITS.primary, multiline: true });
  f('Titre', ad.copy_headline, `Court, sous l’image. Conseillé : ${LIMITS.headline} caractères ou moins.`, { max: LIMITS.headline });
  f('Description', ad.copy_description, 'Facultatif (non affichée partout).', { max: LIMITS.description });
  f('Bouton (appel à l’action)', ad.cta, 'Choisissez le libellé le plus proche dans la liste de Meta.');
  const base = ad.landing || adset.landing || ed.data.booking_url || '';
  const isAbs = /^https?:\/\//i.test(base);
  const url = isAbs ? trackedUrl(base, { channel: 'meta', campaign: camp.name, content: ad.name }) : '';
  const plain = isAbs ? base : '';
  f('URL du site web', plain, isAbs ? 'La page où mène la publicité.' : (base ? 'La destination est une page du site de l’atelier : son adresse publique n’existe pas encore (site non publié).' : 'Aucune destination : renseignez l’URL de réservation dans les paramètres du projet.'));
  const params = url ? url.slice(url.indexOf('?') + 1) : '';
  f('Paramètres d’URL', params, 'À coller dans « Paramètres d’URL » (rubrique Suivi), sans le « ? » : permet de voir d’où viennent les visites.');
  if (!ad.copy_primary) warnings.push('Texte principal à rédiger.');
  if (!ad.copy_headline) warnings.push('Titre à rédiger.');
  if (!ad.cta) warnings.push('Bouton à choisir.');
  if (!isAbs) warnings.push('URL de destination absente ou non publique.');
  for (const x of fields) if (x.max && x.value && x.value.length > x.max) warnings.push(`« ${x.label} » dépasse ${x.max} caractères (${x.value.length}) : Meta risque de le tronquer.`);
  const files = links.map((l) => ({ title: l.title, format: l.format, kind: l.kind, exportId: l.export_id, draft: !!l.draft, state: l.state, cstatus: l.cstatus,
    dims: FORMATS[l.format] ? `${FORMATS[l.format].w}×${FORMATS[l.format].h}` : '', ratio: FORMATS[l.format]?.ratio || '' }));
  if (!files.length) warnings.push('Aucun visuel ou vidéo associé à cette publicité (associez-en un dans la campagne).');
  for (const x of files) { if (x.draft) warnings.push(`« ${x.title} » est un export BROUILLON : refaites-le une fois la fiche prête.`); else if (x.cstatus && x.cstatus !== 'approuvé') warnings.push(`« ${x.title} » n’est pas approuvé.`); }
  return { fields, files, warnings, tracked: url };
}

// Étapes dans l'ordre d'Ads Manager (3 niveaux). Les libellés peuvent différer légèrement selon la version de l'interface.
export const GUIDE_STEPS = [
  ['Campagne', 'Choisissez l’objectif, nommez la campagne, indiquez le budget et les dates.'],
  ['Ensemble de publicités', 'Audience, emplacements, budget et calendrier, destination.'],
  ['Publicité', 'Identité (Page et compte Instagram), visuel ou vidéo, textes, bouton, URL, paramètres d’URL.'],
  ['Vérifier avant de publier', 'Aperçus par emplacement, orthographe, lien qui fonctionne, fichiers approuvés.'],
  ['Revenir ici', 'Notez les identifiants Meta et déclarez « transmis » puis « publié » (déclarations manuelles).'],
];
