// Points d'entrée « venus de l'extérieur » : une affiche déjà faite (SVG ou image) ou un document (concept, script, brief).
// Principe : quel que soit le point de départ, on retombe sur le même parcours (design → variante → export → contenu → campagne).
//  - une AFFICHE reçue devient le design de chaque format (`ext`) : mêmes variantes, mêmes exports, mêmes contrôles ;
//  - un DOCUMENT devient un contenu texte (concept, script, légende) qui s'associe à une campagne comme un visuel.
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { getAsset, assetPath, getDesign, saveDesign } from './studio.js';
import { WIN_TAR } from './studio.js';
import { cleanSvg, svgWarnings, rasterSize } from './svgclean.js';
import { createContent } from './campaigns.js';
import { FORMATS } from './formats.js';
import { storage } from './storage.js';

// ---------------------------------------------------------------- affiche reçue
// Proportions de l'image (largeur / hauteur), ou 0 si on ne sait pas les lire.
export function aspectOf(a) {
  try {
    if (!a || !storage.exists(a.stored)) return 0;
    const buf = readFileSync(assetPath(a));
    if (extname(a.stored).toLowerCase() === '.svg') { const c = cleanSvg(buf.toString('utf8')); return c.ok ? c.w / c.h : 0; }
    const s = rasterSize(buf);
    return s && s.h ? s.w / s.h : 0;
  } catch { return 0; }
}
// Recadrer une affiche finie coupe son texte : on ne le fait que si les proportions sont presque identiques.
export function autoFit(a, fmt, aspect = aspectOf(a)) {
  const f = FORMATS[fmt];
  if (!aspect || !f) return 'blur';
  return Math.abs(aspect / (f.w / f.h) - 1) <= 0.08 ? 'cover' : 'blur';
}

export function usePoster(editionId, assetId, who) {
  const a = getAsset(Number(assetId));
  if (!a || a.edition_id !== editionId) return { ok: false, error: 'Fichier introuvable dans ce projet.' };
  if (a.kind !== 'image') return { ok: false, error: 'Une affiche reçue doit être un SVG ou une image (PNG, JPG, WebP). Pour un fichier .ai ou .pdf : exportez-le d’abord en SVG (Illustrator : Fichier › Exporter › Exporter sous… › SVG).' };
  const aspect = aspectOf(a);
  if (!aspect) return { ok: false, error: 'Ce fichier est illisible ou vide : réexportez-le puis renvoyez-le.' };
  const fits = {};
  for (const fmt of Object.keys(FORMATS)) {
    const cur = getDesign(editionId, `poster_${fmt}`);
    fits[fmt] = autoFit(a, fmt, aspect);
    saveDesign(editionId, `poster_${fmt}`, { ...cur, ext: a.id, fit: fits[fmt], bgc: cur.bgc || '#000000', posx: 50, posy: 50, zoom: 100 }, who, `Affiche reçue « ${a.name} »`);
  }
  return { ok: true, fits, warnings: posterWarnings(a) };
}

// Retour aux affiches composées par l'atelier (les réglages d'origine de chaque format sont conservés dans le design).
export function removePoster(editionId, who) {
  let n = 0;
  for (const fmt of Object.keys(FORMATS)) {
    const cur = getDesign(editionId, `poster_${fmt}`);
    if (!cur.ext) continue;
    const { ext, fit, bgc, ...rest } = cur;
    saveDesign(editionId, `poster_${fmt}`, rest, who, 'Retour à l’affiche composée par l’atelier');
    n++;
  }
  return n;
}

export function posterWarnings(a) {
  try { return a && extname(a.stored).toLowerCase() === '.svg' && storage.exists(a.stored) ? svgWarnings(readFileSync(assetPath(a), 'utf8')) : []; } catch { return []; }
}

// ---------------------------------------------------------------- documents (concept, script, brief)
const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Texte brut d'un document : .docx / .odt (archives zip lues avec le tar de Windows), .txt, .md. null si on ne sait pas le lire.
export function documentText(a) {
  if (!a || !storage.exists(a.stored)) return null;
  const ext = extname(a.stored).toLowerCase();
  let raw = null;
  if (['.txt', '.md', '.srt', '.vtt'].includes(ext)) raw = readFileSync(assetPath(a), 'utf8').replace(/^﻿/, '');
  else if (ext === '.docx' || ext === '.odt') {
    const dir = mkdtempSync(join(tmpdir(), 'atelier-doc-'));
    try {
      const inner = ext === '.docx' ? 'word/document.xml' : 'content.xml';
      const tar = existsSync(WIN_TAR) ? WIN_TAR : 'tar';
      spawnSync(tar, ['-xf', assetPath(a), '-C', dir, inner], { timeout: 30000 });
      const f = join(dir, inner);
      if (!existsSync(f)) return null;
      const xml = readFileSync(f, 'utf8');
      raw = decode(xml
        .replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:br\b[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n')
        .replace(/<text:tab\b[^>]*\/>/g, '\t').replace(/<text:line-break\b[^>]*\/>/g, '\n').replace(/<\/text:(?:p|h)>/g, '\n')
        .replace(/<[^>]+>/g, ''));
    } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return raw === null ? null : raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Crée un contenu texte à partir d'un fichier envoyé. Si le texte ne peut pas être lu (PDF, PowerPoint…), le contenu est créé
// quand même, avec le fichier en pièce jointe : rien ne bloque, on complète à la main.
export function contentFromAsset(editionId, assetId, who) {
  const a = getAsset(Number(assetId));
  if (!a || a.edition_id !== editionId) return { ok: false, error: 'Fichier introuvable dans ce projet.' };
  if (!['document', 'text', 'source'].includes(a.kind)) return { ok: false, error: 'Ce fichier n’est pas un document (concept, script, brief…).' };
  const body = documentText(a);
  const title = a.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || a.name;
  const r = createContent(editionId, { title, kind: 'texte', body: body || '', asset_id: a.id, notes: body ? 'Importé depuis ' + a.name : 'Texte non lu automatiquement : le fichier d’origine est joint, recopiez l’essentiel ici.' }, who);
  return r.ok ? { ...r, read: body !== null && body !== '' } : r;
}

// Ajoute à la suite du texte d'un contenu celui d'un document déjà envoyé (le fichier d'origine reste joint).
import { db } from './db.js';
import { getContent, updateContent } from './campaigns.js';
export function importIntoContent(editionId, contentId, assetId, who) {
  const c = getContent(Number(contentId)), a = getAsset(Number(assetId));
  if (!c || c.project_id !== editionId || c.kind !== 'texte') return { ok: false, error: 'Texte introuvable.' };
  if (!a || a.edition_id !== editionId || !['document', 'text', 'source'].includes(a.kind)) return { ok: false, error: 'Ce fichier n’est pas un document de ce projet.' };
  const text = documentText(a);
  updateContent(c.id, { title: c.title, angle: c.angle, audience: c.audience, language: c.language, channel: c.channel, status: c.status === 'approuvé' ? 'à relire' : c.status, notes: c.notes, body: text ? (c.body ? c.body + '\n\n' : '') + text : c.body }, who);
  db.prepare('UPDATE contents SET asset_id=? WHERE id=?').run(a.id, c.id);
  return { ok: true, read: !!text };
}
