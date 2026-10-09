// Rendu HTML de l'affiche et du site à partir de la fiche. Aucun texte commercial en dur ici.
import { LANGS } from './schema.js';
import { readFileSync } from 'node:fs';
import { FORMATS } from './formats.js';
const MEASURE_JS = readFileSync(new URL('../public/svg-measure.js', import.meta.url), 'utf8');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = LANGS[0];
const t = (d, k) => d[`${k}_${L}`] || '';
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const pairs = (s) => lines(s).map((l) => { const [a, ...b] = l.split('|'); return [a.trim(), b.join('|').trim()]; });
const safeColor = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : d);
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const font = (f, fb) => `'${String(f || '').replace(/[^\w \-]/g, '')}',${fb}`;
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export const venueKnown = (d) => d.venue_status === 'confirmé';
export const venueLabel = (d) => (venueKnown(d) ? [t(d, 'venue_name'), t(d, 'venue_city')].filter(Boolean).join(', ') : 'Venue to be announced');
export const dateLabel = (d) => {
  const a = fmtDate(d.date_start), b = fmtDate(d.date_end);
  return a && b && a !== b ? `${a} – ${b}` : a || b || 'Dates to be announced';
};

// Polices proposées par format d'affiche (installées avec Windows) ; sans choix, on garde les polices de la fiche du spectacle.
export const FONTS = {
  'Georgia': 'serif', 'Times New Roman': 'serif', 'Palatino Linotype': 'serif', 'Book Antiqua': 'serif', 'Cambria': 'serif', 'Constantia': 'serif', 'Rockwell': 'serif',
  'Segoe UI': 'sans', 'Arial': 'sans', 'Calibri': 'sans', 'Candara': 'sans', 'Corbel': 'sans', 'Trebuchet MS': 'sans', 'Verdana': 'sans', 'Tahoma': 'sans',
  'Century Gothic': 'sans', 'Franklin Gothic Medium': 'sans', 'Bahnschrift': 'sans', 'Impact': 'sans', 'Segoe Script': 'sans',
};
const fontOf = (name) => font(name, FONTS[name] === 'serif' ? 'Georgia,serif' : 'Segoe UI,Arial,sans-serif');

function brand(d, g = {}) {
  return {
    p: safeColor(d.color_primary, '#1b1b2f'), s: safeColor(d.color_secondary, '#c8a24a'), x: safeColor(d.color_text, '#f5f1e8'),
    ft: FONTS[g.ft] ? fontOf(g.ft) : font(d.font_title, 'Georgia,serif'), fb: FONTS[g.fb] ? fontOf(g.fb) : font(d.font_body, 'Segoe UI,Arial,sans-serif'),
  };
}

// ---------------------------------------------------------------- affiche
// Éléments de l'affiche, sélectionnables et réglables un par un (position, taille, couleur, texte, visibilité).
export const POSTER_ELEMENTS = {
  logo: 'Logo', top: 'Phrase du haut', kicker: 'Accroche', band: 'Bandeau', title: 'Titre', dates: 'Dates',
  info: 'Lieu / infos', cta: 'Bouton de réservation', host: 'Adresse du site', partners: 'Logos partenaires',
};
export const elementsFor = (style, layout = 'portrait') => {
  if (layout === 'banner') return ['logo', 'title', 'info', 'cta', 'partners'];
  return style === 'bandeau'
    ? ['logo', 'top', 'band', 'title', 'dates', 'info', 'partners']
    : ['logo', 'kicker', 'title', 'info', 'cta', 'host', 'partners'];
};

// Dégradé de lisibilité sous le texte : décrit une seule fois, utilisé par le rendu HTML ET par l'export SVG.
// to = direction CSS ; stops = [position 0..1, opacité] de la couleur principale.
export function gradientSpec(g, layout) {
  const gr = g.gradient / 100;
  if (layout === 'banner' || layout === 'landscape') return { to: 'right', stops: [[0, gr], [0.45, gr * 0.8], [0.85, 0]] };
  if (g.text_pos === 'haut') return { to: 'bottom', stops: [[0, gr], [0.4, gr * 0.85], [0.8, 0]] };
  if (g.text_pos === 'milieu') return { to: 'bottom', stops: [[0.05, 0], [0.35, gr], [0.65, gr], [0.95, 0]] };
  return { to: 'top', stops: [[0, gr], [0.4, gr * 0.85], [0.8, 0]] };
}

// La composition est recalculée pour chaque forme (portrait, carré, paysage, bannière), pas étirée.
export function renderPoster(ed, fmt, g, { heroSrc, logoSrc, partnerSrcs = [], draft, edit = false, measure = false, print = false }) {
  const d = ed.data, c = brand(d, g);
  const spec = FORMATS[fmt] || FORMATS['4x5'];
  const { w: W, h: H, layout } = spec;
  const wide = layout === 'landscape', banner = layout === 'banner';
  const tall = H / W > 1.5;
  const band = g.style === 'bandeau' && !banner;
  const u = wide ? Math.min(W, H) / 1080 : 1; // échelle typographique des formats paysage
  const safeTop = spec.safe.top, side = spec.safe.side, safeBottom = spec.safe.bottom;
  const hasPartners = partnerSrcs.length > 0;
  const bottom = safeBottom + (hasPartners && !wide && !banner ? 120 : 0); // le texte remonte pour laisser la place aux logos
  const partnersBottom = wide || banner ? safeBottom : Math.max(20, safeBottom - (tall ? 50 : 30));
  const titleBase = banner ? 80 : wide ? 118 * u : band ? (tall ? 140 : 116) : (tall ? 150 : 128);
  const titleSize = Math.round(titleBase * g.title_scale / 100);
  const gr = g.gradient / 100;
  const gs = gradientSpec(g, layout);
  const grad = `linear-gradient(to ${gs.to},${gs.stops.map(([p, a]) => `${rgba(c.p, a)} ${p * 100}%`).join(',')})`;
  const pos = g.text_pos === 'haut' ? `top:${safeTop + (logoSrc ? 140 * (wide ? u : 1) : 0)}px` : g.text_pos === 'milieu' ? 'top:50%;transform:translateY(-50%)' : `bottom:${bottom}px`;
  const bgData = `data-px="${g.posx}" data-py="${g.posy}" data-z="${g.zoom}"`;
  const bg = heroSrc
    ? `<img class="bg" ${bgData} data-slot="hero" src="${heroSrc}" alt="">`
    : `<div class="bg ph" ${bgData}><span>PLACEHOLDER IMAGE</span></div>`;
  const host = d.booking_url ? (() => { try { return new URL(d.booking_url).host; } catch { return ''; } })() : '';
  const top = t(d, 'top_line');

  // --- réglages par élément
  const ov = (id) => (g.els && g.els[id]) || {};
  const shown = (id) => !ov(id).hide;
  const attrs = (id) => {
    const o = ov(id), st = [];
    if (o.dx || o.dy) st.push(`translate:${o.dx || 0}px ${o.dy || 0}px`);
    if (o.s && o.s !== 100) st.push(`scale:${o.s / 100}`);
    if (o.color) st.push(`--oc:${o.color}`);
    if (o.align) st.push(`text-align:${o.align}`);
    return ` data-el="${id}" data-dx="${o.dx || 0}" data-dy="${o.dy || 0}" data-s="${o.s || 100}"${o.color ? ' data-oc="1"' : ''}${st.length ? ` style="${st.join(';')}"` : ''}`;
  };
  const text = (id, fallback) => (ov(id).text ? esc(ov(id).text).replace(/\n/g, '<br>') : fallback);
  const lines2 = (id) => { // texte libre : 1re ligne en gras, 2e en accent, suite normale
    const [a, b, ...r] = ov(id).text.split('\n');
    return `<b>${esc(a)}</b>${b !== undefined ? `<i>${esc(b)}</i>` : ''}${r.map((x) => `<span>${esc(x)}</span>`).join('')}`;
  };

  const partners = hasPartners && shown('partners') ? `<div class="partners"${attrs('partners')}>${partnerSrcs.slice(0, 5).map((s, i) => `<img data-slot="partner${i}" src="${s}" alt="">`).join('')}</div>` : '';
  const logo = logoSrc && shown('logo') ? `<img class="logo" data-slot="logo"${attrs('logo')} src="${logoSrc}" alt="">` : '';
  const logoH = Math.round(110 * (wide ? u : 1)) * (banner ? 0.7 : 1);

  const css = `
*{box-sizing:border-box;margin:0}html,body{width:${W}px;height:${H}px;overflow:hidden;background:${c.p}}
.p{position:relative;width:${W}px;height:${H}px;overflow:hidden;color:${c.x};font-family:${c.fb}}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${g.posx}% ${g.posy}%;transform:scale(${g.zoom / 100});transform-origin:${g.posx}% ${g.posy}%}
.ph{background:linear-gradient(135deg,${c.p},${c.s});display:flex;align-items:center;justify-content:center;font:700 44px ${c.fb};letter-spacing:.2em;color:${rgba(c.x, .35)}}
.grad{position:absolute;inset:0;background:${grad}}
[data-el]{transform-origin:${band ? 'center' : '0 0'}}
[data-oc],[data-oc] *{color:var(--oc)!important}
.logo{position:absolute;left:${side}px;top:${safeTop}px;max-height:${logoH}px;max-width:${Math.round(340 * (wide ? u : 1))}px}
.kick{font-size:${Math.round((tall ? 40 : 34) * (wide ? u : 1))}px;letter-spacing:.14em;text-transform:uppercase;color:${c.s};margin-bottom:${Math.round(18 * (wide ? u : 1))}px}
.info{font-size:${Math.round((tall ? 44 : 38) * (wide ? u : 1))}px;line-height:1.35;margin-bottom:${Math.round(34 * (wide ? u : 1))}px}.info b{color:${c.s};font-weight:600}
.cta{display:inline-block;background:${c.s};color:${c.p};font:700 ${Math.round((tall ? 44 : 38) * (wide ? u : 1))}px ${c.fb};padding:${Math.round(22 * (wide ? u : 1))}px ${Math.round(48 * (wide ? u : 1))}px;border-radius:999px}
.host{margin-top:18px;font-size:${Math.round(30 * (wide ? u : 1))}px;opacity:.85}
.partners{position:absolute;left:${side}px;right:${side}px;bottom:${partnersBottom}px;display:flex;gap:${Math.round(48 * (wide ? u : 1))}px;justify-content:${band ? 'center' : wide ? 'flex-end' : 'flex-start'};align-items:center}
.partners img{max-height:${Math.round((tall ? 96 : 76) * (wide ? u : 1))}px;max-width:${Math.round(300 * (wide ? u : 1))}px;object-fit:contain}
.draft{position:absolute;top:0;left:0;right:0;background:#b3261e;color:#fff;text-align:center;font:700 ${Math.round(26 * (wide || banner ? Math.max(u, .6) : 1))}px ${c.fb};padding:${banner ? 4 : 10}px;letter-spacing:.08em;pointer-events:none}`;

  // --- composition « classique »
  const textBlock = `
${shown('kicker') ? `<div class="kick"${attrs('kicker')}>${text('kicker', esc(t(d, 'tagline')))}</div>` : ''}
${shown('title') ? `<h1${attrs('title')}>${text('title', esc(t(d, 'title')))}</h1>` : ''}
${shown('info') ? `<div class="info"${attrs('info')}>${ov('info').text ? lines2('info') : `<b>${esc(dateLabel(d))}</b><br>${esc(venueLabel(d))}`}</div>` : ''}
${shown('cta') ? `<div><span class="cta"${attrs('cta')}>${text('cta', esc(t(d, 'cta_book') || 'Book your tickets'))}</span></div>` : ''}
${host && shown('host') ? `<div class="host"${attrs('host')}>${text('host', esc(host))}</div>` : ''}`;
  const classic = `
<style>${css}
.txt{position:absolute;left:${side}px;${wide ? 'width:58%;' : `right:${side}px;`}${pos}}
h1{font:700 ${titleSize}px/1.02 ${c.ft};margin-bottom:${Math.round(28 * (wide ? u : 1))}px}</style>
<div class="txt">${textBlock}</div>`;

  // --- composition « bandeau » : phrase en haut, titre incliné sur fond sombre, lieu + site en bas
  const bandeau = `
<style>${css}
.top{position:absolute;left:${side}px;right:${side}px;top:${safeTop + (logoSrc ? 120 * (wide ? u : 1) : 0)}px;text-align:center;font:700 ${Math.round((tall ? 38 : 32) * (wide ? u : 1))}px ${c.fb};letter-spacing:.16em;text-transform:uppercase}
.band{position:absolute;left:50%;top:${g.text_pos === 'haut' ? '32%' : g.text_pos === 'bas' ? '58%' : '45%'};width:${wide ? 70 : 88}%;transform:translate(-50%,-50%) rotate(-5deg);background:${rgba(c.p, .93)};border:4px solid ${c.x};padding:${Math.round((tall ? 54 : 40) * (wide ? u : 1))}px 36px;text-align:center}
.band h1{font:800 ${titleSize}px/1.0 ${c.ft};text-transform:uppercase;letter-spacing:.02em}
.band small{display:block;margin-top:${Math.round(18 * (wide ? u : 1))}px;font:600 ${Math.round((tall ? 36 : 30) * (wide ? u : 1))}px ${c.fb};letter-spacing:.14em;text-transform:uppercase;color:${c.s}}
.foot{position:absolute;left:${side}px;right:${side}px;bottom:${bottom}px;text-align:center}
.foot b{display:block;font:700 ${Math.round((tall ? 54 : 46) * (wide ? u : 1))}px ${c.fb};text-transform:uppercase;letter-spacing:.04em}
.foot i{display:block;margin-top:12px;font:italic 600 ${Math.round((tall ? 44 : 38) * (wide ? u : 1))}px ${c.fb};color:${c.s}}
.foot span{display:block;margin-top:10px;font-size:${Math.round((tall ? 36 : 30) * (wide ? u : 1))}px;opacity:.9}</style>
${top && shown('top') ? `<div class="top"${attrs('top')}>${text('top', esc(top))}</div>` : ''}
${shown('band') ? `<div class="band"${attrs('band')}>${shown('title') ? `<h1${attrs('title')}>${text('title', esc(t(d, 'title')))}</h1>` : ''}${shown('dates') ? `<small${attrs('dates')}>${text('dates', esc(dateLabel(d)))}</small>` : ''}</div>` : ''}
${shown('info') ? `<div class="foot"${attrs('info')}>${ov('info').text ? lines2('info') : `<b>${esc(venueLabel(d))}</b>${host ? `<i>${esc(host)}</i>` : `<span>${esc(t(d, 'cta_book') || '')}</span>`}`}</div>` : ''}`;

  // --- composition « bannière » (3:1) : une seule ligne
  const bannerHtml = `
<style>${css}
.row{position:absolute;left:${side}px;right:${side}px;top:${safeTop}px;bottom:${safeBottom}px;display:flex;align-items:center;gap:36px}
.row .logo,.row .partners{position:static;max-height:${Math.round(H * .5)}px}.row .partners{gap:24px}.row .partners img{max-height:60px}
.row h1{font:700 ${titleSize}px/1.02 ${c.ft};flex:1}
.row .info{font-size:28px;margin:0;text-align:right}
.row .cta{font-size:28px;padding:16px 34px;white-space:nowrap}</style>
<div class="row">${logo}${shown('title') ? `<h1${attrs('title')}>${text('title', esc(t(d, 'title')))}</h1>` : ''}
${shown('info') ? `<div class="info"${attrs('info')}>${ov('info').text ? lines2('info') : `<b>${esc(dateLabel(d))}</b><br>${esc(venueLabel(d))}`}</div>` : ''}
${shown('cta') ? `<span class="cta"${attrs('cta')}>${text('cta', esc(t(d, 'cta_book') || 'Book your tickets'))}</span>` : ''}${hasPartners && shown('partners') ? partners.replace('class="partners"', 'class="partners"') : ''}</div>`;

  const editor = edit ? `<script src="/poster-editor.js"></script>` : measure ? `<script>${MEASURE_JS}</script>` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${print ? `<style>@page{size:${W}px ${H}px;margin:0}html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>` : ''}</head><body><div class="p" data-w="${W}" data-h="${H}">${bg}<div class="grad"></div>
${banner ? '' : logo}${banner ? bannerHtml : band ? bandeau : classic}${banner ? '' : partners}
${draft ? '<div class="draft">DRAFT — NOT FOR PUBLICATION</div>' : ''}</div>${editor}</body></html>`;
}

// Affiche REÇUE de l'extérieur (SVG ou image finie) : l'image est toute la composition, on ne la recompose pas.
// fit : cover = remplit en recadrant · contain = entière sur fond uni · blur = entière sur sa propre copie floutée.
// Le cadrage (posx/posy) et le zoom servent comme pour une photo. Aucun texte n'est ajouté par-dessus.
export function renderImportedPoster(fmt, g, { src, draft, edit = false, print = false }) {
  const { w: W, h: H } = FORMATS[fmt] || FORMATS['4x5'];
  const fit = g.fit === 'cover' || g.fit === 'contain' ? g.fit : 'blur';
  const bgc = safeColor(g.bgc, '#000000');
  const bgData = `data-px="${g.posx}" data-py="${g.posy}" data-z="${g.zoom}"`;
  const img = src ? `<img class="bg" ${bgData} data-slot="hero" src="${src}" alt="">` : `<div class="bg ph" ${bgData}><span>PLACEHOLDER IMAGE</span></div>`;
  const blur = src && fit === 'blur' ? `<img class="bgb" src="${src}" alt="">` : '';
  const css = `*{box-sizing:border-box;margin:0}html,body{width:${W}px;height:${H}px;overflow:hidden;background:${bgc}}
.p{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${bgc};font-family:Segoe UI,Arial,sans-serif}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:${fit === 'cover' ? 'cover' : 'contain'};object-position:${g.posx}% ${g.posy}%;transform:scale(${g.zoom / 100});transform-origin:${g.posx}% ${g.posy}%}
.bgb{position:absolute;left:-6%;top:-6%;width:112%;height:112%;object-fit:cover;filter:blur(36px) brightness(.55)}
.ph{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#333,#777);font:700 44px sans-serif;letter-spacing:.2em;color:rgba(255,255,255,.4)}
.draft{position:absolute;top:0;left:0;right:0;background:#b3261e;color:#fff;text-align:center;font:700 26px Segoe UI,Arial,sans-serif;padding:10px;letter-spacing:.08em;pointer-events:none}
${print ? `@page{size:${W}px ${H}px;margin:0}html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}` : ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="p" data-w="${W}" data-h="${H}">${blur}${img}${draft ? '<div class="draft">DRAFT — NOT FOR PUBLICATION</div>' : ''}</div>${edit ? '<script src="/poster-editor.js"></script>' : ''}</body></html>`;
}

// ---------------------------------------------------------------- site
export const SITE_PAGES = [
  ['home', 'Home'], ['experience', 'The experience'], ['gallery', 'Gallery'], ['booking', 'Book'],
  ['access', 'Getting there'], ['faq', 'FAQ'], ['contact', 'Contact'],
];

function slots(d) {
  const [h1, m1] = (d.session_first || '').split(':').map(Number), [h2, m2] = (d.session_last || '').split(':').map(Number);
  const step = Number(d.slot_minutes) || 15;
  if ([h1, m1, h2, m2].some(Number.isNaN)) return [];
  const out = [];
  for (let m = h1 * 60 + m1; m <= h2 * 60 + m2 && out.length < 60; m += step) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return out;
}
function days(d) {
  if (!d.date_start || !d.date_end) return [];
  const out = []; const a = new Date(d.date_start + 'T00:00:00'), b = new Date(d.date_end + 'T00:00:00');
  for (let x = a; x <= b && out.length < 45; x = new Date(x.getTime() + 864e5)) out.push(x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
  return out;
}

export function renderSite(ed, page, { assets, base, draftReasons }) {
  const d = ed.data, c = brand(d);
  const img = (role) => assets.filter((a) => a.role === role && a.kind === 'image');
  const hero = img('hero')[0], logo = img('logo')[0], gallery = [...img('gallery'), ...img('hero')];
  const partners = img('partner'), mapImg = img('map')[0];
  const src = (a) => `/files/${a.id}`;
  const on = (k) => d[`show_${k}`] === '1';
  const split = d.hero_layout === 'image + texte';
  const book = d.booking_url ? `<a class="btn" href="${esc(d.booking_url)}">${esc(t(d, 'cta_book'))}</a>` : `<a class="btn" href="${base}/booking">${esc(t(d, 'cta_book'))}</a>`;
  const h = (txt) => `<h2>${esc(txt)}</h2>`;
  const sec = (inner) => `<section>${inner}</section>`;
  const facts = [
    d.duration_min && ['Duration', `about ${d.duration_min} min`],
    d.audio_languages && ['Languages', d.audio_languages],
    ['When', dateLabel(d)], ['Where', venueLabel(d)],
  ].filter(Boolean).map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('');

  const blocks = {
    home: () => `
<div class="hero ${split ? 'split' : ''}">${hero ? `<img src="${src(hero)}" alt="">` : '<div class="phimg">PLACEHOLDER IMAGE</div>'}
<div class="herotxt"><p class="kick">${esc(t(d, 'tagline'))}</p><h1>${esc(t(d, 'hero_title') || t(d, 'title'))}</h1><p>${esc(venueLabel(d))} · ${esc(dateLabel(d))}</p>${book}</div></div>
${sec(`<p class="lead">${esc(t(d, 'description'))}</p><div class="facts">${facts}</div>`)}
${on('highlights') && lines(t(d, 'highlights')).length ? sec(`${h('Highlights')}<ul class="cards">${lines(t(d, 'highlights')).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`) : ''}
${lines(t(d, 'audiences')).length ? sec(`${h('Who is it for?')}<div class="chips">${lines(t(d, 'audiences')).map((x) => `<span>${esc(x)}</span>`).join('')}</div>`) : ''}
${on('route') && t(d, 'route') ? sec(`${h('The route')}<p>${esc(t(d, 'route'))}</p>${mapImg ? `<img class="map" src="${src(mapImg)}" alt="">` : ''}`) : ''}
${on('tickets') ? sec(`${h('Tickets')}${ticketsTable(d)}${book}`) : ''}
${on('gallery') ? sec(`${h('Gallery')}${galleryHtml(gallery, src)}`) : ''}
${on('map') ? sec(`${h('Getting there')}${accessHtml(d)}`) : ''}`,
    experience: () => sec(`${h('The experience')}<p class="lead">${esc(t(d, 'description'))}</p>
<ul class="cards">${lines(t(d, 'highlights')).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
${t(d, 'route') ? `${h('The route')}<p>${esc(t(d, 'route'))}</p>${mapImg ? `<img class="map" src="${src(mapImg)}" alt="">` : ''}` : ''}
${t(d, 'accessibility') ? `${h('Accessibility')}<p>${esc(t(d, 'accessibility'))}</p>` : ''}
${t(d, 'dress_code') ? `${h('What to wear')}<p>${esc(t(d, 'dress_code'))}</p>` : ''}
${t(d, 'weather_policy') ? `${h('Weather')}<p>${esc(t(d, 'weather_policy'))}</p>` : ''}`),
    gallery: () => sec(`${h('Gallery')}${galleryHtml(gallery, src)}`),
    booking: () => sec(`${h('Book your tickets')}<p class="sim">SIMULATION — the ticketing provider is not connected. Dates, slots and prices below are indicative only.</p>
${h('Dates')}<div class="chips">${days(d).map((x) => `<span>${esc(x)}</span>`).join('') || '<em>Dates to be announced</em>'}</div>
${h('Entry times')}<div class="chips">${slots(d).map((x) => `<span>${x}</span>`).join('') || '<em>To be announced</em>'}</div>
${h('Tickets')}${ticketsTable(d)}<span class="btn off">Reservations not open</span>`),
    access: () => sec(`${h('Getting there')}${accessHtml(d)}`),
    faq: () => sec(`${h('FAQ')}${pairs(t(d, 'faq')).map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('') || '<em>No questions yet.</em>'}`),
    contact: () => sec(`${h('Contact')}<p>${d.contact_email ? `<a href="mailto:${esc(d.contact_email)}">${esc(d.contact_email)}</a><br>` : ''}${esc(d.contact_phone || '')}</p>
<p>${['instagram', 'facebook', 'tiktok'].filter((k) => d[`social_${k}`]).map((k) => `<a href="${esc(d[`social_${k}`])}">${k}</a>`).join(' · ')}</p>`),
  };
  const body = (blocks[page] || blocks.home)();
  const nav = SITE_PAGES.map(([k, n]) => `<a href="${base}/${k === 'home' ? '' : k}"${k === page ? ' class="on"' : ''}>${n}</a>`).join('');
  return `<!doctype html><html lang="${L}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t(d, 'title'))}</title><style>
*{box-sizing:border-box}body{margin:0;background:${c.p};color:${c.x};font:17px/1.6 ${c.fb}}a{color:${c.s}}
.pv{background:#b3261e;color:#fff;padding:8px 16px;font:600 13px system-ui;text-align:center}
nav{display:flex;gap:20px;flex-wrap:wrap;align-items:center;padding:16px 32px;border-bottom:1px solid ${rgba(c.x, .15)}}nav img{height:36px}nav a{color:${c.x};text-decoration:none;opacity:.75}nav a.on{opacity:1;border-bottom:2px solid ${c.s}}
.hero{position:relative;min-height:70vh;display:flex;align-items:flex-end}.hero>img,.phimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.phimg{background:linear-gradient(135deg,${c.p},${c.s});display:flex;align-items:center;justify-content:center;font-weight:700;letter-spacing:.2em;opacity:.7}
.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(to top,${rgba(c.p, .92)},transparent 70%)}
.hero.split{display:grid;grid-template-columns:1fr 1fr;min-height:60vh}.hero.split>img,.hero.split .phimg{position:static}.hero.split:after{display:none}.hero.split .herotxt{align-self:center}
.herotxt{position:relative;z-index:1;padding:48px 32px;max-width:760px}.kick{text-transform:uppercase;letter-spacing:.14em;color:${c.s};margin:0}
h1{font:700 clamp(40px,7vw,84px)/1.05 ${c.ft};margin:.2em 0}h2{font:700 30px ${c.ft};margin:1.6em 0 .5em}
section{max-width:960px;margin:0 auto;padding:24px 32px}.lead{font-size:21px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:24px}.facts div{border-left:3px solid ${c.s};padding-left:12px}.facts small{display:block;opacity:.65;text-transform:uppercase;letter-spacing:.1em;font-size:12px}
.cards{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.cards li{background:${rgba(c.x, .07)};padding:20px;border-radius:10px}
.btn{display:inline-block;background:${c.s};color:${c.p};padding:14px 32px;border-radius:999px;font-weight:700;text-decoration:none;margin-top:16px}.btn.off{opacity:.45}
table{border-collapse:collapse;width:100%}td{padding:10px 0;border-bottom:1px solid ${rgba(c.x, .15)}}td+td{text-align:right}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chips span{border:1px solid ${rgba(c.x, .3)};padding:6px 14px;border-radius:99px;font-size:15px}
.sim{background:${rgba('#b3261e', .25)};padding:12px;border-radius:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.grid img,.grid .phimg{position:static;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px}
details{border-bottom:1px solid ${rgba(c.x, .15)};padding:12px 0}summary{cursor:pointer;font-weight:600}
.map{width:100%;border-radius:10px;margin-top:16px}.partners{display:flex;gap:40px;justify-content:center;align-items:center;flex-wrap:wrap;padding:24px 16px;background:#fff}.partners img{max-height:56px;max-width:180px;object-fit:contain}
footer{text-align:center;padding:40px 16px;opacity:.6;font-size:14px}
@media(max-width:700px){.hero.split{grid-template-columns:1fr}nav{padding:12px 16px}}
</style></head><body>
<div class="pv">PREVIEW — not published${draftReasons.length ? ` · ${esc(draftReasons.length)} blocking item(s)` : ''}</div>
<nav>${logo ? `<img src="${src(logo)}" alt="">` : `<b>${esc(t(d, 'title'))}</b>`}${nav}</nav>
${body}${partners.length ? `<div class="partners">${partners.map((a) => `<img src="${src(a)}" alt="">`).join('')}</div>` : ''}<footer>${esc(t(d, 'title'))} · ${esc(venueLabel(d))}</footer></body></html>`;
}

function ticketsTable(d) {
  const rows = pairs(d.tickets), extras = pairs(d.addons);
  const tr = (r) => r.map(([n, p]) => `<tr><td>${esc(n)}</td><td>${esc(p)}</td></tr>`).join('');
  return rows.length ? `<table>${tr(rows)}${extras.length ? `<tr><td colspan="2"><small>Options</small></td></tr>${tr(extras)}` : ''}</table><small>Indicative prices — the ticketing system is the reference.</small>` : '<em>Prices to be announced</em>';
}
function galleryHtml(list, src) {
  return list.length ? `<div class="grid">${list.map((a) => `<img src="${src(a)}" alt="">`).join('')}</div>`
    : '<div class="grid">' + [1, 2, 3].map(() => '<div class="phimg">PLACEHOLDER</div>').join('') + '</div>';
}
function accessHtml(d) {
  if (!venueKnown(d)) return '<p>The location will be announced soon.</p>';
  const addr = [t(d, 'venue_name'), t(d, 'venue_address'), t(d, 'venue_city')].filter(Boolean).join(', ');
  return `<p>${esc(addr)}</p><p><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}">Open in maps</a></p>${t(d, 'practical') ? `<p>${esc(t(d, 'practical'))}</p>` : ''}`;
}
