// Définition de la fiche spectacle. Les langues et champs se modifient ici (pas ailleurs).
export const LANGS = ['en'];

export const VALIDATION = ['brouillon', 'à relire', 'approuvé'];

// perLang: le champ est décliné par langue (clé: title_en, title_ja…)
export const SECTIONS = [
  {
    id: 'identity', title: 'Identité',
    fields: [
      { key: 'show_code', label: 'Identifiant spectacle', type: 'text', help: 'Court, sans espaces (ex. nightshow)' },
      { key: 'edition_code', label: 'Identifiant édition', type: 'text', help: 'Ex. 2027' },
      { key: 'title', label: 'Titre', type: 'text', perLang: true },
      { key: 'tagline', label: 'Accroche', type: 'text', perLang: true },
      { key: 'top_line', label: 'Phrase en haut de l’affiche', type: 'text', perLang: true, help: 'Ex. « Every evening from sunset ». Optionnelle.' },
      { key: 'description', label: 'Description', type: 'textarea', perLang: true },
    ],
  },
  {
    id: 'venue', title: 'Lieu et dates',
    fields: [
      { key: 'venue_status', label: 'Lieu confirmé ?', type: 'select', options: ['à confirmer', 'confirmé'], help: 'Tant que ce n’est pas « confirmé », rien ne peut être publié.' },
      { key: 'venue_name', label: 'Nom du lieu', type: 'text', perLang: true },
      { key: 'venue_city', label: 'Ville', type: 'text', perLang: true },
      { key: 'venue_address', label: 'Adresse', type: 'textarea', perLang: true },
      { key: 'date_start', label: 'Première date', type: 'date' },
      { key: 'date_end', label: 'Dernière date', type: 'date' },
      { key: 'timezone', label: 'Fuseau horaire', type: 'text', help: 'Ex. Asia/Tokyo' },
      { key: 'practical', label: 'Informations pratiques', type: 'textarea', perLang: true },
    ],
  },
  {
    id: 'brand', title: 'Charte graphique',
    fields: [
      { key: 'color_primary', label: 'Couleur principale', type: 'color' },
      { key: 'color_secondary', label: 'Couleur secondaire', type: 'color' },
      { key: 'color_text', label: 'Couleur du texte', type: 'color' },
      { key: 'font_title', label: 'Police du titre', type: 'text' },
      { key: 'font_body', label: 'Police du texte', type: 'text' },
      { key: 'brand_rules', label: 'Règles graphiques', type: 'textarea', help: 'Marges, usages interdits du logo…' },
    ],
  },
  {
    id: 'booking', title: 'Réservation et contact',
    fields: [
      { key: 'booking_url', label: 'URL de réservation', type: 'url' },
      { key: 'contact_email', label: 'E-mail de contact', type: 'text' },
      { key: 'contact_phone', label: 'Téléphone', type: 'text' },
      { key: 'social_instagram', label: 'Instagram (URL)', type: 'url' },
      { key: 'social_facebook', label: 'Facebook (URL)', type: 'url' },
      { key: 'social_tiktok', label: 'TikTok (URL)', type: 'url' },
    ],
  },
  {
    id: 'experience', title: 'Expérience et parcours',
    fields: [
      { key: 'hero_title', label: 'Titre d’accueil du site', type: 'text', perLang: true },
      { key: 'highlights', label: 'Points forts', type: 'textarea', perLang: true, help: 'Un par ligne (3 à 5 recommandés).' },
      { key: 'audiences', label: 'Pour qui ?', type: 'textarea', perLang: true, help: 'Un public par ligne (familles, couples, amis…).' },
      { key: 'duration_min', label: 'Durée du parcours (minutes)', type: 'number' },
      { key: 'route', label: 'Description du parcours', type: 'textarea', perLang: true, help: 'Longueur, dénivelé, passages difficiles…' },
      { key: 'accessibility', label: 'Accessibilité', type: 'textarea', perLang: true, help: 'Poussettes, fauteuils, mobilité réduite : soyez explicite.' },
      { key: 'dress_code', label: 'Tenue conseillée', type: 'textarea', perLang: true },
      { key: 'audio_languages', label: 'Langues du spectacle', type: 'text', help: 'Ex. EN, JA' },
      { key: 'weather_policy', label: 'Météo et annulation', type: 'textarea', perLang: true },
    ],
  },
  {
    id: 'tickets', title: 'Séances et tarifs (affichage)',
    fields: [
      { key: 'session_first', label: 'Première entrée', type: 'time', help: 'À valider avec le coucher du soleil et le lieu.' },
      { key: 'session_last', label: 'Dernière entrée', type: 'time' },
      { key: 'slot_minutes', label: 'Intervalle entre entrées (minutes)', type: 'number' },
      { key: 'tickets', label: 'Tarifs affichés', type: 'textarea', help: 'Un par ligne : Nom | Prix. INDICATIF : la billetterie reste la référence pour prix, places et commandes.' },
      { key: 'addons', label: 'Options / extras affichés', type: 'textarea', help: 'Un par ligne : Nom | Prix (ex. dégustation, panier). Indicatif, comme les tarifs.' },
      { key: 'cta_book', label: 'Texte du bouton de réservation', type: 'text', perLang: true },
    ],
  },
  {
    id: 'faq', title: 'FAQ',
    fields: [
      { key: 'faq', label: 'Questions fréquentes', type: 'textarea', perLang: true, help: 'Une par ligne : Question | Réponse' },
    ],
  },
  {
    id: 'site', title: 'Options du site',
    fields: [
      { key: 'show_highlights', label: 'Afficher les points forts', type: 'checkbox' },
      { key: 'show_route', label: 'Afficher le parcours', type: 'checkbox' },
      { key: 'show_tickets', label: 'Afficher les tarifs', type: 'checkbox' },
      { key: 'show_gallery', label: 'Afficher la galerie', type: 'checkbox' },
      { key: 'show_faq', label: 'Afficher la FAQ', type: 'checkbox' },
      { key: 'show_map', label: 'Afficher la carte d’accès', type: 'checkbox' },
      { key: 'hero_layout', label: 'Présentation de l’en-tête', type: 'select', options: ['plein écran', 'image + texte'] },
    ],
  },
];

export function fieldKeys() {
  const out = [];
  for (const s of SECTIONS) for (const f of s.fields) {
    if (f.perLang) for (const l of LANGS) out.push({ ...f, key: `${f.key}_${l}`, label: `${f.label} (${l.toUpperCase()})`, section: s.id });
    else out.push({ ...f, section: s.id });
  }
  return out;
}

export function defaults() {
  return {
    venue_status: 'à confirmer', timezone: 'Asia/Tokyo',
    color_primary: '#1b1b2f', color_secondary: '#c8a24a', color_text: '#f5f1e8',
    font_title: 'Georgia', font_body: 'Segoe UI',
    title_en: 'Night Show', tagline_en: 'An after-dark walk through light and sound',
    description_en: 'Placeholder: a short description of the experience will go here.',
    hero_title_en: 'Step into the night',
    highlights_en: 'Immersive light projections\nOriginal soundtrack\nA unique setting after dark',
    duration_min: '60', route_en: 'Placeholder: route length, terrain and difficulty.',
    accessibility_en: 'Placeholder: accessibility information to be confirmed.',
    dress_code_en: 'Placeholder: dress for the weather; comfortable walking shoes.',
    audio_languages: 'EN', weather_policy_en: 'Placeholder: weather and cancellation policy.',
    session_first: '18:00', session_last: '21:00', slot_minutes: '15',
    tickets: 'Adult | 00.00\nChild | 00.00\nFamily | 00.00',
    cta_book_en: 'Book your tickets',
    top_line_en: 'Every evening from sunset',
    audiences_en: 'Families\nCouples\nFriends',
    addons: '',
    faq_en: 'Where is the show held? | To be announced.\nHow long does it last? | About 60 minutes (placeholder).\nWhat if it rains? | Placeholder policy.',
    show_highlights: '1', show_route: '1', show_tickets: '1', show_gallery: '1', show_faq: '1', show_map: '1',
    hero_layout: 'plein écran', provisional: '1',
  };
}

// Bloque la publication externe tant que le lieu et la fiche ne sont pas validés.
export function publishBlockers(ed) {
  const why = [];
  if (ed.data.venue_status !== 'confirmé') why.push('Le lieu n’est pas confirmé.');
  for (const s of SECTIONS) if ((ed.validation[s.id]?.status) !== 'approuvé') why.push(`Section « ${s.title} » non approuvée.`);
  if (ed.data.provisional === '1') why.push('Contenu marqué provisoire.');
  return why;
}

// ---------------------------------------------------------------------------------------------------------------
// Exigences CIBLÉES : un contenu n'exige de la fiche que ce qu'il affiche réellement. Une FAQ, des tarifs ou les options du site
// non approuvés ne bloquent donc pas une affiche qui ne les montre pas. publishBlockers (ci-dessus) reste l'exigence LARGE,
// celle du site complet.
import { FORMATS as FMT } from './formats.js';
export const SECTION_TITLES = Object.fromEntries(SECTIONS.map((s) => [s.id, s.title]));
// pairs : [[format, design]] des affiches concernées. Les affiches reçues de l'extérieur (design.ext) ne montrent rien de la fiche.
export function posterNeeds(pairs) {
  const need = { sections: new Set(), venue: false, provisional: false };
  for (const [fmt, g] of pairs) {
    if (!g || g.ext) continue;
    const shown = (id) => !(g.els && g.els[id] && g.els[id].hide);
    const banner = FMT[fmt]?.layout === 'banner', band = g.style === 'bandeau' && !banner;
    need.sections.add('identity'); need.sections.add('brand'); need.provisional = true;
    if (shown('info') || (band && shown('dates'))) need.venue = true;
    if (banner ? shown('cta') : band ? shown('info') : shown('cta') || shown('host')) need.sections.add('booking');
  }
  if (need.venue) need.sections.add('venue');
  return need;
}
// Une vidéo ne montre la fiche que par son écran de fin (c'est l'affiche du format).
export function videoNeeds(videoDesign, posterPairs) {
  return videoDesign?.endcard?.on ? posterNeeds(posterPairs) : { sections: new Set(), venue: false, provisional: false };
}
export function explainNeeds(ed, need) {
  const why = [];
  if (need.venue && ed.data.venue_status !== 'confirmé') why.push({ section: 'venue', text: 'Le lieu n’est pas confirmé (il est cité sur ce contenu).' });
  for (const s of need.sections) if (ed.validation[s]?.status !== 'approuvé') why.push({ section: s, text: `Section « ${SECTION_TITLES[s]} » non approuvée (utilisée par ce contenu).` });
  if (need.provisional && ed.data.provisional === '1') why.push({ section: 'identity', text: 'Fiche marquée « provisoire » (textes d’exemple).' });
  return why;
}
export const blockersFor = (ed, need) => explainNeeds(ed, need).map((w) => w.text);
export const posterBlockers = (ed, pairs) => blockersFor(ed, posterNeeds(pairs));
