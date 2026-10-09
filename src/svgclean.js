// Nettoyage et lecture des SVG reçus de l'extérieur (graphiste, musée, média). Aucune dépendance.
// Un SVG affiché dans une balise <img> n'exécute ni script ni ressource externe ; on nettoie quand même le fichier,
// car il peut être ouvert tel quel depuis l'atelier ou réutilisé ailleurs.

const num = (s) => { const n = parseFloat(String(s || '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };

// Retourne { ok, svg, w, h, warnings } ou { ok:false, error }.
export function cleanSvg(input) {
  let s = String(input || '').replace(/^﻿/, '');
  const root = /<svg\b[^>]*>/i.exec(s);
  if (!root) return { ok: false, error: 'Ce fichier n’est pas un SVG lisible (balise <svg> introuvable). Dans Illustrator : Fichier › Exporter › Exporter sous… › SVG.' };
  s = s.slice(Math.max(0, s.search(/<\?xml|<!DOCTYPE|<svg\b/i)));
  s = s.replace(/<!DOCTYPE[\s\S]*?(\]>|>)/gi, '')                       // entités externes / internes : inutiles et risquées
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')                // onclick=, onload=…
    .replace(/((?:xlink:)?href\s*=\s*)("|')\s*javascript:[^"']*\2/gi, '$1$2#$2');

  const tag = /<svg\b[^>]*>/i.exec(s)[0];
  const attr = (n) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const vb = (attr('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let w = num(attr('width')), h = num(attr('height'));
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  if (String(attr('width') || '').includes('%')) w = 0;
  if (String(attr('height') || '').includes('%')) h = 0;
  if (!hasVb && !(w && h)) return { ok: false, error: 'Dimensions introuvables dans ce SVG (ni viewBox, ni largeur/hauteur). Réexportez-le depuis Illustrator.' };
  let fixed = tag;
  if (!hasVb) fixed = fixed.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
  if (hasVb && !(w && h)) {
    fixed = fixed.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '').replace(/<svg\b/i, `<svg width="${vb[2]}" height="${vb[3]}"`);
  }
  s = s.replace(tag, fixed);
  const W = hasVb ? vb[2] : w, H = hasVb ? vb[3] : h;
  return { ok: true, svg: s, w: W, h: H, warnings: svgWarnings(s) };
}

// Ce qui peut faire changer le rendu entre Illustrator et l'atelier : à dire avant l'export, pas après.
export function svgWarnings(s) {
  const out = [];
  if (/<text\b/i.test(s)) out.push('Le SVG contient du texte « vivant » : si la police n’est pas installée sur cet ordinateur, le rendu change. Dans Illustrator, convertissez le texte en tracés (Texte › Vectoriser) avant d’exporter.');
  if (/<image\b[^>]*(?:xlink:)?href\s*=\s*["'](?!data:|#)/i.test(s)) out.push('Le SVG appelle des images extérieures (« liées ») qui ne sont pas incluses : elles apparaîtront vides. Dans Illustrator, intégrez les images (Fenêtre › Liens › Intégrer) avant d’exporter.');
  if (/<(?:filter|mask)\b/i.test(s)) out.push('Le SVG utilise des filtres ou des masques : le rendu de l’atelier est celui d’Edge/Chrome ; vérifiez l’aperçu.');
  return out;
}

// Dimensions d'une image raster (PNG, JPEG, GIF, WebP) lues dans l'en-tête, sans dépendance. null si inconnu.
export function rasterSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const k = buf.toString('latin1', 12, 16);
    if (k === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (k === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (k === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
  }
  return null;
}
