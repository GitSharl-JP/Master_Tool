// Export éditable des designs : SVG (calques nommés, texte vivant, images intégrées) et PDF vectoriel.
//
// Pourquoi pas .ai : le format .ai est propriétaire d'Adobe. Sa structure interne repose sur le PDF, mais produire un vrai
// .ai fiable sans Illustrator n'est pas possible. Illustrator ouvre le SVG et le PDF ; c'est donc ce que fournit l'atelier.
//
// SVG : une couche par élément (Titre, Dates, Logo…), chaque ligne de texte est un objet texte modifiable, les images sont
//       intégrées, le dégradé est un vrai dégradé. Il faut avoir les polices installées pour que le texte reste le même.
// Limites : un paragraphe est découpé en lignes (une ligne = un objet texte) ; les effets propres au navigateur
//       (ombres, certains espacements) ne sont pas restitués.
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { buildPosterHtml, browserPath, EXPORT_PATH } from './studio.js';
import { FORMATS } from './formats.js';
import { gradientSpec, POSTER_ELEMENTS } from './render.js';

const X = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 100) / 100;
const NAMES = { logo: 'Logo', top: 'Phrase-du-haut', kicker: 'Accroche', band: 'Bandeau', title: 'Titre', dates: 'Dates', info: 'Lieu-infos', cta: 'Bouton', host: 'Site-web', partners: 'Logos-partenaires' };

function run(args, { capture = false, timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    const exe = browserPath();
    if (!exe) return resolve({ ok: false, error: 'Aucun navigateur (Edge ou Chrome) trouvé.' });
    const p = spawn(exe, args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'] });
    let out = '';
    if (capture) p.stdout.on('data', (c) => { out += c; });
    const timer = setTimeout(() => p.kill(), timeout);
    p.on('close', () => { clearTimeout(timer); resolve({ ok: true, out }); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
  });
}
const withFile = async (html, fn) => {
  const f = EXPORT_PATH + `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`;
  writeFileSync(f, html);
  try { return await fn('file:///' + f.replace(/\\/g, '/')); } finally { try { unlinkSync(f); } catch { /* déjà supprimé */ } }
};

// --- PDF vectoriel (texte vivant, formes vectorielles) : une page aux dimensions exactes du format
// builder(flags) -> { html, srcs, design } : par défaut l'état actuel du projet ; la bibliothèque fournit celui d'une version enregistrée.
const current = (ed, fmt) => (flags) => buildPosterHtml(ed, fmt, [], { noDraft: true, ...flags });

export async function posterPdf(ed, fmt, outFile, builder = current(ed, fmt)) {
  const { html } = builder({ print: true });
  const r = await withFile(html, (u) => run(['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${outFile}`, u]));
  return r.ok && existsSync(outFile);
}

// --- SVG
export async function posterSvg(ed, fmt, builder = current(ed, fmt)) {
  const spec = FORMATS[fmt];
  const { html, srcs, design } = builder({ measure: true });
  const dom = await withFile(html, (u) => run(['--headless=new', '--disable-gpu', '--dump-dom', u], { capture: true }));
  if (!dom.ok) return { ok: false, error: dom.error };
  const m = /<script type="application\/json" id="__geo">([\s\S]*?)<\/script>/.exec(dom.out);
  if (!m) return { ok: false, error: 'Relevé de mise en page introuvable (le navigateur n’a pas répondu).' };
  const geo = JSON.parse(m[1]);
  const d = ed.data;
  const c = { p: /^#[0-9a-f]{6}$/i.test(d.color_primary) ? d.color_primary : '#1b1b2f', s: /^#[0-9a-f]{6}$/i.test(d.color_secondary) ? d.color_secondary : '#c8a24a' };
  const fonts = new Set();
  const gs = gradientSpec(design, spec.layout);
  const gv = { right: [0, 0, 1, 0], bottom: [0, 0, 0, 1], top: [0, 1, 0, 0] }[gs.to];

  const text = (t) => { fonts.add(t.family.split(',')[0].replace(/["']/g, '').trim());
    return `<text x="${n(t.x)}" y="${n(t.y)}" font-family="${X(t.family.replace(/"/g, "'"))}" font-size="${n(t.size)}" font-weight="${t.weight}"${t.style !== 'normal' ? ` font-style="${t.style}"` : ''} fill="${t.color}"${t.alpha < 1 ? ` fill-opacity="${t.alpha}"` : ''}${t.ls ? ` letter-spacing="${n(t.ls)}"` : ''} xml:space="preserve">${X(t.text)}</text>`; };
  const node = (e) => {
    const T = [];
    if (e.dx || e.dy) T.push(`translate(${e.dx} ${e.dy})`);
    if (e.s !== 1) T.push(`translate(${n(e.ox)} ${n(e.oy)}) scale(${e.s}) translate(${-n(e.ox)} ${-n(e.oy)})`);
    if (e.rot) T.push(`rotate(${e.rot} ${n(e.rect.x + e.rect.w / 2)} ${n(e.rect.y + e.rect.h / 2)})`);
    let inner = '';
    if (e.box) {
      const b = e.box, sw = b.strokeW, r = e.rect;
      inner += `<rect x="${n(r.x + sw / 2)}" y="${n(r.y + sw / 2)}" width="${n(r.w - sw)}" height="${n(r.h - sw)}"${b.rx ? ` rx="${n(Math.min(b.rx, (r.h - sw) / 2, (r.w - sw) / 2))}"` : ''} fill="${b.fill || 'none'}"${b.fill && b.fillAlpha < 1 ? ` fill-opacity="${n(b.fillAlpha)}"` : ''}${b.stroke ? ` stroke="${b.stroke}" stroke-width="${sw}"` : ''}/>`;
    }
    if (e.img && srcs[e.img.slot]) inner += `<image x="${n(e.rect.x)}" y="${n(e.rect.y)}" width="${n(e.rect.w)}" height="${n(e.rect.h)}" preserveAspectRatio="xMidYMid meet" xlink:href="${srcs[e.img.slot]}"/>`;
    inner += e.text.map(text).join('') + e.kids.map(node).join('');
    const name = /^partner[0-9]+$/.test(e.id) ? 'Logo-partenaire-' + e.id.slice(7) : NAMES[e.id] || e.id;
    return `<g id="${name}"${T.length ? ` transform="${T.join(' ')}"` : ''}${e.opacity < 1 ? ` opacity="${e.opacity}"` : ''}>${inner}</g>`;
  };

  let bg;
  if (geo.bg.placeholder) bg = `<rect width="${geo.W}" height="${geo.H}" fill="url(#ph)"/>`;
  else if (geo.bg.crop) bg = `<image x="${n(geo.bg.crop.x)}" y="${n(geo.bg.crop.y)}" width="${n(geo.bg.crop.w)}" height="${n(geo.bg.crop.h)}" preserveAspectRatio="none" xlink:href="${geo.bg.crop.src}"/>`;
  else bg = `<image x="${n(geo.bg.x)}" y="${n(geo.bg.y)}" width="${n(geo.bg.w)}" height="${n(geo.bg.h)}" preserveAspectRatio="none" xlink:href="${srcs.hero}"/>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${geo.W}" height="${geo.H}" viewBox="0 0 ${geo.W} ${geo.H}">
<title>${X(ed.label)} — ${X(spec.label)}</title>
<defs>
<linearGradient id="fade" x1="${gv[0]}" y1="${gv[1]}" x2="${gv[2]}" y2="${gv[3]}">${gs.stops.map(([p, a]) => `<stop offset="${p}" stop-color="${c.p}" stop-opacity="${n(a)}"/>`).join('')}</linearGradient>
<linearGradient id="ph" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.p}"/><stop offset="1" stop-color="${c.s}"/></linearGradient>
</defs>
<g id="Fond"><rect width="${geo.W}" height="${geo.H}" fill="${c.p}"/>${bg}</g>
<g id="Degrade"><rect width="${geo.W}" height="${geo.H}" fill="url(#fade)"/></g>
${geo.els.map(node).join('\n')}
</svg>
`;
  return { ok: true, svg, fonts: [...fonts], layers: geo.els.map((e) => POSTER_ELEMENTS[e.id] || e.id) };
}
