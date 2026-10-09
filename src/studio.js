// Bibliothèque d'assets, réglages de design (affiches) et exports.
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { extname } from 'node:path';
import { db, DATA_DIR, log } from './db.js';
import { renderPoster, renderImportedPoster, POSTER_ELEMENTS, FONTS } from './render.js';
import { cleanSvg } from './svgclean.js';
import { posterBlockers as posterBlockersOf } from './schema.js';
export const posterBlockers = posterBlockersOf;
import { storage } from './storage.js';
import { FORMATS, CHANNELS, formatsForChannels } from './formats.js';

db.exec(`
CREATE TABLE IF NOT EXISTS assets(
  id INTEGER PRIMARY KEY, edition_id INTEGER NOT NULL, name TEXT NOT NULL, stored TEXT NOT NULL, kind TEXT NOT NULL,
  role TEXT NOT NULL, provisional INTEGER NOT NULL DEFAULT 1, rights TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'brouillon',
  size INTEGER NOT NULL, uploaded_by TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS designs(edition_id INTEGER NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY(edition_id,key));
CREATE TABLE IF NOT EXISTS exports(
  id INTEGER PRIMARY KEY, edition_id INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, file TEXT NOT NULL,
  draft INTEGER NOT NULL, source_ids TEXT NOT NULL, created TEXT NOT NULL, created_by TEXT NOT NULL);
`);

const EXPORT_DIR = DATA_DIR + 'exports/';
mkdirSync(EXPORT_DIR, { recursive: true });

export const ROLES = {
  hero: 'Photo principale', gallery: 'Galerie', logo: 'Logo', partner: 'Logo partenaire', map: 'Carte / plan du parcours',
  video: 'Vidéo', audio: 'Audio / musique', subtitle: 'Sous-titres', source: 'Fichier source (graphiste)', other: 'Autre',
  poster: 'Affiche reçue (SVG ou image finie)', brief: 'Document (concept, script, brief)',
};
// Types acceptés : ajouter une extension ici suffit pour accepter un nouveau type de fichier.
const KINDS = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image', '.gif': 'image',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.ogg': 'audio',
  '.srt': 'text', '.vtt': 'text', '.txt': 'text',
  '.svg': 'image',
  '.docx': 'document', '.doc': 'document', '.odt': 'document', '.rtf': 'document', '.md': 'document', '.pptx': 'document', '.xlsx': 'document',
  '.psd': 'source', '.ai': 'source', '.pdf': 'source', '.zip': 'source', '.fig': 'source', '.indd': 'source',
};
export const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml', '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
};
const MAX = (Number(process.env.ATELIER_MAX_UPLOAD_MB) || 4096) * 1024 * 1024;
const now = () => new Date().toISOString();

export const listAssets = (editionId) => db.prepare('SELECT * FROM assets WHERE edition_id=? ORDER BY id DESC').all(editionId);
export const getAsset = (id) => db.prepare('SELECT * FROM assets WHERE id=?').get(id);
export const assetPath = (a) => storage.path(a.stored);
export const assetsByRole = (editionId, role) => listAssets(editionId).filter((a) => a.role === role);

// Réception en flux (le navigateur envoie le fichier brut).
export function saveUpload(req, { editionId, name, role, who }) {
  return new Promise((resolve, reject) => {
    const ext = extname(name).toLowerCase();
    if (!KINDS[ext]) return reject(new Error(`Type de fichier non accepté (${ext || 'inconnu'}).`));
    if (!ROLES[role]) role = 'other';
    const safe = name.replace(/[^\w.\- ]+/g, '_').slice(-80);
    const stored = `${Date.now()}_${safe}`;
    const out = storage.write(stored);
    let size = 0, failed = false;
    req.on('data', (c) => { size += c.length; if (size > MAX && !failed) { failed = true; req.destroy(); out.destroy(); } });
    req.pipe(out);
    out.on('finish', () => {
      if (failed || size === 0) { storage.remove(stored); return reject(new Error(size ? 'Fichier trop volumineux.' : 'Fichier vide.')); }
      if (ext === '.svg') { // SVG reçu de l'extérieur : nettoyé et vérifié avant d'entrer dans l'atelier
        const c = cleanSvg(readFileSync(storage.path(stored), 'utf8'));
        if (!c.ok) { storage.remove(stored); return reject(new Error(c.error)); }
        writeFileSync(storage.path(stored), c.svg);
        size = Buffer.byteLength(c.svg);
      }
      const r = db.prepare('INSERT INTO assets(edition_id,name,stored,kind,role,size,uploaded_by,created) VALUES(?,?,?,?,?,?,?,?)')
        .run(editionId, safe, stored, KINDS[ext], role, size, who, now());
      log(who, `Asset ajouté : ${safe} (${ROLES[role]})`);
      resolve(Number(r.lastInsertRowid));
    });
    out.on('error', reject);
    req.on('error', reject);
  });
}

export function updateAsset(id, { role, provisional, rights, status }, who) {
  const a = getAsset(id);
  if (!a) return;
  db.prepare('UPDATE assets SET role=?, provisional=?, rights=?, status=? WHERE id=?')
    .run(ROLES[role] ? role : a.role, provisional ? 1 : 0, (rights || '').slice(0, 500), ['brouillon', 'à relire', 'approuvé'].includes(status) ? status : a.status, id);
  log(who, `Asset modifié : ${a.name}`);
}

// --- réglages de design (affiches), par édition et par format
export const POSTER_FORMATS = FORMATS; // compat : le catalogue complet est dans formats.js
// Affiche importée : `ext` (id d'un asset SVG/image), `fit` (cover | contain | blur), `bgc` (couleur de fond). Ces clés n'existent
// que sur les designs importés, pour ne pas changer l'empreinte des designs déjà approuvés.
export { FONTS };
const fontPart = (o) => ({ ...(FONTS[o.ft] ? { ft: o.ft } : {}), ...(FONTS[o.fb] ? { fb: o.fb } : {}) }); // clés présentes seulement si une police est choisie (empreinte des designs existants inchangée)
export const FITS = { cover: 'Remplir (recadre les bords)', contain: 'Entière sur fond uni', blur: 'Entière sur fond flou' };
export const POSTER_DEFAULTS = { hero: '', logo: '', gradient: 70, posx: 50, posy: 50, zoom: 100, title_scale: 100, text_pos: 'bas', style: 'classique', partners: '1', els: {} };

// Réglages par élément : on ne garde que des valeurs connues et bornées (le navigateur n'est pas digne de confiance).
export function cleanEls(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = {}; } }
  const out = {};
  const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n))) : 0; };
  for (const id of Object.keys(POSTER_ELEMENTS)) {
    const e = o && o[id];
    if (!e || typeof e !== 'object') continue;
    const r = {};
    if (e.dx) r.dx = num(e.dx, -2000, 2000);
    if (e.dy) r.dy = num(e.dy, -2500, 2500);
    if (e.s && Number(e.s) !== 100) r.s = num(e.s, 20, 400);
    if (e.hide) r.hide = true;
    if (/^#[0-9a-f]{6}$/i.test(e.color || '')) r.color = e.color;
    if (typeof e.text === 'string' && e.text.trim()) r.text = e.text.slice(0, 500);
    if (Object.keys(r).length) out[id] = r;
  }
  return out;
}

export function getDesign(editionId, key) {
  const r = db.prepare('SELECT json FROM designs WHERE edition_id=? AND key=?').get(editionId, key);
  if (r) return { ...POSTER_DEFAULTS, ...JSON.parse(r.json) };
  // Format jamais réglé : on reprend photo, logo, style et dégradé du dernier format réglé (les positions, propres à chaque forme, ne sont pas copiées).
  const other = db.prepare("SELECT json FROM designs WHERE edition_id=? AND key GLOB 'poster_*' ORDER BY updated DESC LIMIT 1").get(editionId);
  const o = other ? JSON.parse(other.json) : {};
  const first = (role) => listAssets(editionId).filter((a) => a.role === role && a.kind === 'image').pop();
  const imported = o.ext ? { ext: o.ext, fit: o.fit || 'blur', bgc: o.bgc || '#000000' } : {};
  return {
    ...imported,
    ...POSTER_DEFAULTS, hero: o.hero || String(first('hero')?.id || ''), logo: o.logo || String(first('logo')?.id || ''),
    gradient: o.gradient ?? POSTER_DEFAULTS.gradient, style: o.style || POSTER_DEFAULTS.style, partners: o.partners ?? POSTER_DEFAULTS.partners,
    zoom: o.zoom ?? POSTER_DEFAULTS.zoom, text_pos: o.text_pos || POSTER_DEFAULTS.text_pos, ...fontPart(o),
  };
}
// « Uniformiser » : reporte sur les autres formats ce qui doit être identique (photo, logo, style, dégradé, polices, couleurs et textes des éléments).
// Les positions et tailles (propres à chaque forme) et le cadrage de la photo restent ceux de chaque format.
export function applyToOtherFormats(editionId, fromKey, toKeys, who) {
  const src = getDesign(editionId, fromKey);
  if (src.ext) return 0;
  let n = 0;
  for (const key of toKeys) {
    if (key === fromKey) continue;
    const cur = getDesign(editionId, key);
    if (cur.ext) continue;
    const els = {};
    for (const id of new Set([...Object.keys(cur.els || {}), ...Object.keys(src.els || {})])) {
      const mine = cur.els?.[id] || {}, from = src.els?.[id] || {};
      els[id] = { ...(mine.dx ? { dx: mine.dx } : {}), ...(mine.dy ? { dy: mine.dy } : {}), ...(mine.s ? { s: mine.s } : {}), ...(from.hide ? { hide: true } : {}), ...(from.color ? { color: from.color } : {}), ...(from.text ? { text: from.text } : {}) };
    }
    const next = { ...cur, hero: src.hero, logo: src.logo, gradient: src.gradient, style: src.style, partners: src.partners, text_pos: src.text_pos, zoom: src.zoom, title_scale: src.title_scale, els };
    delete next.ft; delete next.fb;
    saveDesign(editionId, key, { ...next, ...fontPart(src) }, who, 'Uniformisé depuis un autre format');
    n++;
  }
  return n;
}

// Historique des réglages de chaque design (affiche par format) : on peut toujours revenir en arrière.
db.exec(`CREATE TABLE IF NOT EXISTS design_history(id INTEGER PRIMARY KEY, edition_id INTEGER NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, saved_at TEXT NOT NULL, saved_by TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '')`);
export const listDesignHistory = (editionId, key, n = 12) => db.prepare('SELECT id,saved_at,saved_by,reason FROM design_history WHERE edition_id=? AND key=? ORDER BY id DESC LIMIT ?').all(editionId, key, n);
export function restoreDesign(editionId, key, historyId, who) {
  const h = db.prepare('SELECT json FROM design_history WHERE id=? AND edition_id=? AND key=?').get(historyId, editionId, key);
  if (!h) return false;
  saveDesign(editionId, key, JSON.parse(h.json), who, `Restauration de la version ${historyId}`);
  return true;
}

// Part « affiche importée » d'un design : vide (aucune clé) si l'asset n'existe pas, n'est pas une image ou n'est pas de ce projet.
function importedPart(editionId, input) {
  const a = input.ext ? getAsset(Number(input.ext)) : null;
  if (!a || a.edition_id !== editionId || a.kind !== 'image') return {};
  return { ext: String(a.id), fit: FITS[input.fit] ? input.fit : 'blur', bgc: /^#[0-9a-f]{6}$/i.test(input.bgc || '') ? input.bgc : '#000000' };
}
export function saveDesign(editionId, key, input, who = '', reason = 'Enregistrement') {
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const d = {
    hero: String(input.hero || ''), logo: String(input.logo || ''),
    gradient: num(input.gradient, 0, 100, 70), posx: num(input.posx, 0, 100, 50), posy: num(input.posy, 0, 100, 50),
    zoom: num(input.zoom, 100, 250, 100), title_scale: num(input.title_scale, 60, 140, 100),
    text_pos: ['haut', 'milieu', 'bas'].includes(input.text_pos) ? input.text_pos : 'bas',
    style: ['classique', 'bandeau'].includes(input.style) ? input.style : 'classique',
    partners: input.partners === '1' ? '1' : '0',
    els: cleanEls(input.els),
    ...fontPart(input),
    ...importedPart(editionId, input),
  };
  db.prepare('INSERT INTO designs VALUES(?,?,?,?) ON CONFLICT(edition_id,key) DO UPDATE SET json=excluded.json, updated=excluded.updated')
    .run(editionId, key, JSON.stringify(d), now());
  // on ne garde pas deux fois de suite exactement le même état
  const last = db.prepare('SELECT json FROM design_history WHERE edition_id=? AND key=? ORDER BY id DESC LIMIT 1').get(editionId, key);
  if (!last || last.json !== JSON.stringify(d)) {
    db.prepare('INSERT INTO design_history(edition_id,key,json,saved_at,saved_by,reason) VALUES(?,?,?,?,?,?)').run(editionId, key, JSON.stringify(d), now(), who, reason);
    db.prepare('DELETE FROM design_history WHERE edition_id=? AND key=? AND id NOT IN (SELECT id FROM design_history WHERE edition_id=? AND key=? ORDER BY id DESC LIMIT 60)').run(editionId, key, editionId, key);
  }
  fireDesignSaved(editionId, key, who);
  return d;
}

// --- exports
export const listExports = (editionId) => db.prepare('SELECT * FROM exports WHERE edition_id=? ORDER BY id DESC').all(editionId);
export const getExport = (id) => db.prepare('SELECT * FROM exports WHERE id=?').get(id);
export const exportPath = (e) => EXPORT_DIR + e.file;

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const browser = () => BROWSERS.find((p) => existsSync(p));

function dataUri(a) {
  if (!a) return null;
  const ext = extname(a.stored).toLowerCase();
  return `data:${MIME[ext] || 'application/octet-stream'};base64,${readFileSync(assetPath(a)).toString('base64')}`;
}

// HTML autonome (images intégrées) d'une affiche, avec son statut brouillon : base commune de l'export d'affiche et de l'écran de fin des vidéos.
export function buildPosterHtml(ed, fmt, draftReasons, opts = {}) {
  const design = opts.design || getDesign(ed.id, opts.designKey || `poster_${fmt}`);
  if (design.ext) { // affiche reçue de l'extérieur : l'image est la composition entière
    const a = getAsset(Number(design.ext));
    const draft = opts.noDraft ? false : draftReasons.length > 0 || !a || a.provisional === 1;
    const src = a && storage.exists(a.stored) ? dataUri(a) : null;
    return { html: renderImportedPoster(fmt, design, { src, draft, print: !!opts.print }), design, draft, srcs: { hero: src } };
  }
  const hero = design.hero ? getAsset(Number(design.hero)) : null;
  const logo = design.logo ? getAsset(Number(design.logo)) : null;
  const draft = opts.noDraft ? false : draftReasons.length > 0 || hero?.provisional === 1 || !hero;
  const partnerSrcs = design.partners === '1' ? assetsByRole(ed.id, 'partner').filter((a) => a.kind === 'image').reverse().map(dataUri) : [];
  const srcs = { hero: dataUri(hero), logo: dataUri(logo) };
  partnerSrcs.forEach((p, i) => { srcs['partner' + i] = p; });
  return { html: renderPoster(ed, fmt, design, { heroSrc: srcs.hero, logoSrc: srcs.logo, partnerSrcs, draft, measure: !!opts.measure, print: !!opts.print }), design, draft, srcs };
}

// Version asynchrone (ne bloque pas le serveur) : écrit un PNG exactement aux dimensions du format.
export function htmlToPng(html, fmt, pngFile) {
  return new Promise((resolve) => {
    const exe = browser(), f = FORMATS[fmt];
    if (!exe || !f) return resolve(false);
    const htmlFile = pngFile.replace(/\.png$/, '.html');
    writeFileSync(htmlFile, html);
    const p = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${f.w},${f.h}`, `--screenshot=${pngFile}`, 'file:///' + htmlFile.replace(/\\/g, '/')], { stdio: 'ignore' });
    const timer = setTimeout(() => p.kill(), 60000);
    p.on('close', () => { clearTimeout(timer); try { unlinkSync(htmlFile); } catch {} resolve(existsSync(pngFile)); });
    p.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// Retourne { ok, id } ou { ok:false, error }. Le fichier PNG est un export : rien n'est publié.
export function exportPoster(ed, fmt, who, draftReasons, opts = {}) {
  const f = FORMATS[fmt];
  const exe = browser();
  if (!f) return { ok: false, error: 'Format inconnu.' };
  if (!exe) return { ok: false, error: 'Aucun navigateur (Edge ou Chrome) trouvé pour produire l’image.' };
  const { html, design, draft } = buildPosterHtml(ed, fmt, draftReasons, { designKey: opts.designKey });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `poster-${ed.id}-${fmt}-${stamp}${draft ? '-DRAFT' : ''}`;
  const htmlFile = EXPORT_DIR + base + '.html';
  const pngFile = EXPORT_DIR + base + '.png';
  writeFileSync(htmlFile, html);
  spawnSync(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${f.w},${f.h}`, `--screenshot=${pngFile}`, 'file:///' + htmlFile.replace(/\\/g, '/')], { timeout: 60000 });
  try { unlinkSync(htmlFile); } catch {}
  if (!existsSync(pngFile)) return { ok: false, error: 'La génération de l’image a échoué. Réessayez ; rien n’a été enregistré.' };
  const res = db.prepare('INSERT INTO exports(edition_id,kind,label,file,draft,source_ids,created,created_by,variant_id,fmt) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(ed.id, 'affiche', `${opts.variantId ? 'Essai variante — ' : ''}Affiche ${f.label}`, base + '.png', draft ? 1 : 0, JSON.stringify([design.ext || design.hero, design.logo].filter(Boolean)), now(), who, opts.variantId || null, fmt);
  log(who, `Affiche exportée (${f.label})${draft ? ' — BROUILLON' : ''}`);
  return { ok: true, id: Number(res.lastInsertRowid), draft };
}


// Aperçu en direct : applique les paramètres de l'URL sans les enregistrer.
export function saveDesignPreview(editionId, key, q) {
  const base = getDesign(editionId, key);
  if (!Object.keys(q).length) return base;
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    hero: q.hero ?? base.hero, logo: q.logo ?? base.logo,
    gradient: num(q.gradient, 0, 100, base.gradient), posx: num(q.posx, 0, 100, base.posx), posy: num(q.posy, 0, 100, base.posy),
    zoom: num(q.zoom, 100, 250, base.zoom), title_scale: num(q.title_scale, 60, 140, base.title_scale),
    text_pos: ['haut', 'milieu', 'bas'].includes(q.text_pos) ? q.text_pos : base.text_pos,
    style: ['classique', 'bandeau'].includes(q.style) ? q.style : base.style,
    partners: q.partners === '1' ? '1' : '0',
    els: q.els === undefined ? base.els : cleanEls(q.els),
    ...fontPart({ ft: q.ft ?? base.ft, fb: q.fb ?? base.fb }),
    ...importedPart(editionId, { ext: q.ext ?? base.ext, fit: q.fit ?? base.fit, bgc: q.bgc ?? base.bgc }),
  };
}

// --- pack campagne : un dossier par canal, avec tous les formats utiles, + un zip
import { mkdirSync as mk, copyFileSync as cp, rmSync as rm } from 'node:fs';
// tar de Windows (bsdtar) : sait créer des zip, contrairement au tar de Git qui peut passer devant dans le PATH.
export const WIN_TAR = (process.env.SystemRoot || 'C:/Windows').replace(/\\/g, '/') + '/System32/tar.exe';
export function exportPack(ed, channelKeys, who, draftReasons) {
  const keys = channelKeys.filter((k) => CHANNELS[k]);
  if (!keys.length) return { ok: false, error: 'Choisissez au moins un canal.' };
  const made = {}; // format -> { id, file } (un format partagé par plusieurs canaux n'est produit qu'une fois)
  for (const fmt of formatsForChannels(keys)) {
    const r = exportPoster(ed, fmt, who, draftReasons || posterBlockersOf(ed, [[fmt, getDesign(ed.id, `poster_${fmt}`)]]));
    if (!r.ok) return { ok: false, error: `Format ${FORMATS[fmt].label} : ${r.error}` };
    made[fmt] = { id: r.id, file: getExport(r.id).file };
  }
  const draft = Object.values(made).some((m) => getExport(m.id).draft);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `pack-${ed.id}-${stamp}${draft ? '-DRAFT' : ''}`;
  const dir = EXPORT_DIR + name + '/';
  for (const k of keys) {
    mk(dir + k, { recursive: true });
    for (const [fmt, use] of CHANNELS[k].uses) cp(EXPORT_DIR + made[fmt].file, `${dir}${k}/${use.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}_${fmt}.png`);
  }
  const zip = EXPORT_DIR + name + '.zip';
  spawnSync(WIN_TAR, ['-a', '-c', '-f', zip, '-C', EXPORT_DIR, name], { timeout: 60000 });
  rm(dir, { recursive: true, force: true });
  if (!existsSync(zip)) return { ok: false, error: 'Les images sont créées, mais le zip n’a pas pu être produit.' };
  const res = db.prepare('INSERT INTO exports(edition_id,kind,label,file,draft,source_ids,created,created_by) VALUES(?,?,?,?,?,?,?,?)')
    .run(ed.id, 'pack', 'Pack : ' + keys.map((k) => CHANNELS[k].label).join(', '), name + '.zip', draft ? 1 : 0, JSON.stringify(Object.values(made).map((m) => m.id)), now(), who);
  log(who, `Pack campagne exporté (${keys.join(', ')})${draft ? ' — BROUILLON' : ''}`);
  return { ok: true, id: Number(res.lastInsertRowid), draft, count: Object.keys(made).length };
}
export const EXPORT_PATH = EXPORT_DIR;

export const browserPath = browser;

// --- colonnes de suivi des variantes sur les exports (migration idempotente) + crochets de sauvegarde
for (const [c, d] of [['variant_id', 'INTEGER'], ['variant_version', 'INTEGER'], ['fmt', "TEXT NOT NULL DEFAULT ''"], ['content_key', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!db.prepare('PRAGMA table_info(exports)').all().some((x) => x.name === c)) db.exec(`ALTER TABLE exports ADD COLUMN ${c} ${d}`);
}
// Les modules (variantes…) s'abonnent pour être prévenus quand un design ou des sous-titres changent.
export const designSaveHooks = [];
export const fireDesignSaved = (editionId, key, who = '') => designSaveHooks.forEach((h) => h(editionId, key, who));
