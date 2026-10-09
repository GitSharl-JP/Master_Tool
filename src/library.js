// Bibliothèque de designs : un design = un état complet et MODIFIABLE du travail graphique d'un projet.
//
// Ce qui est conservé dans chaque version :
//  - la composition de chaque format (style, dégradé, cadrage, position/taille/couleur/texte de chaque élément) ;
//  - les images et logos utilisés (copies propres au design : elles survivent même si le projet d'origine change) ;
//  - la charte (couleurs, polices) et un jeu de textes d'exemple pour pouvoir ré-afficher le design seul ;
//  - les réglages de style vidéo (logo, écran de fin, sous-titres).
// Une version est immuable. Réappliquer un design à un autre projet remplace les assets et laisse les informations
// du projet (fiche) intactes, sauf demande contraire.
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { db, log, getEdition, saveEdition } from './db.js';
import { storage } from './storage.js';
import { FORMATS } from './formats.js';
import { renderPoster } from './render.js';
import { listAssets, getAsset, assetsByRole, getDesign, saveDesign, MIME, htmlToPng, EXPORT_PATH, WIN_TAR, POSTER_DEFAULTS } from './studio.js';
import { getVideoDesign, saveVideoDesign } from './video.js';
import { posterSvg, posterPdf } from './designexport.js';
import { illustratorChecklist } from './illustrator-check.js';

db.exec(`
CREATE TABLE IF NOT EXISTS design_templates(id INTEGER PRIMARY KEY, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', parent_id INTEGER, project_id INTEGER, created TEXT NOT NULL, created_by TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS design_versions(id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL, version INTEGER NOT NULL, snapshot TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', thumb TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, created_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS design_applications(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, version_id INTEGER NOT NULL, applied_at TEXT NOT NULL, applied_by TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '');
`);
if (!db.prepare('PRAGMA table_info(design_templates)').all().some((c) => c.name === 'kind')) db.exec("ALTER TABLE design_templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'projet'");
// projet = tout le travail graphique d'un projet (historique) · modele = la composition d'UN contenu et ses déclinaisons · kit = charte et styles communs
export const KIND_LABELS = { projet: 'Design du projet', modele: 'Modèle de contenu', kit: 'Kit graphique' };
const now = () => new Date().toISOString();
const safe = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-60);

// --- lecture
export const listTemplates = () => db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM design_versions v WHERE v.template_id=t.id) AS versions,
  (SELECT MAX(version) FROM design_versions v WHERE v.template_id=t.id) AS last_version FROM design_templates t ORDER BY t.updated DESC`).all();
export const getTemplate = (id) => db.prepare('SELECT * FROM design_templates WHERE id=?').get(id);
export const listVersions = (templateId) => db.prepare('SELECT id,template_id,version,note,thumb,created,created_by FROM design_versions WHERE template_id=? ORDER BY version DESC').all(templateId);
export const getVersion = (id) => { const v = db.prepare('SELECT * FROM design_versions WHERE id=?').get(id); return v && { ...v, snapshot: JSON.parse(v.snapshot) }; };
export const listApplications = (projectId) => db.prepare('SELECT a.*, t.name, v.version FROM design_applications a JOIN design_versions v ON v.id=a.version_id JOIN design_templates t ON t.id=v.template_id WHERE a.project_id=? ORDER BY a.id DESC LIMIT 10').all(projectId);

const dataUriKey = (key) => `data:${MIME[extname(key).toLowerCase()] || 'application/octet-stream'};base64,${readFileSync(storage.path(key)).toString('base64')}`;

// --- état courant d'un projet -> instantané
export function buildSnapshot(ed, opts = {}) {
  const formats = {}, used = new Set(), scope = opts.variantId ? `v${opts.variantId}` : '';
  let partners = false;
  for (const fmt of (opts.formats || Object.keys(FORMATS))) {
    const d = getDesign(ed.id, scope ? `${scope}_${fmt}` : `poster_${fmt}`);
    formats[fmt] = d;
    if (d.hero) used.add(String(d.hero));
    if (d.logo) used.add(String(d.logo));
    if (d.partners === '1') partners = true;
  }
  if (partners) for (const a of assetsByRole(ed.id, 'partner')) if (a.kind === 'image') used.add(String(a.id));
  const v = getVideoDesign(ed.id, scope);
  if (v.logo.asset) used.add(String(v.logo.asset));
  const d = ed.data;
  return {
    schema: 1, kind: opts.kind || 'projet', savedAt: now(), projectLabel: ed.label,
    brand: Object.fromEntries(['color_primary', 'color_secondary', 'color_text', 'font_title', 'font_body', 'brand_rules'].map((k) => [k, d[k] ?? ''])),
    sample: d, used: [...used], formats,
    video: { logo: { corner: v.logo.corner, size: v.logo.size, margin: v.logo.margin, asset: v.logo.asset }, endcard: v.endcard, subs: v.subs },
  };
}

// --- enregistrement : nouvelle version d'un design existant, ou nouveau design
export async function saveToLibrary(ed, { templateId, name, note = '', kind = 'projet', variantId, formats, snapshot }, who) {
  const snap = snapshot || buildSnapshot(ed, { kind, variantId, formats });
  let t = templateId ? getTemplate(Number(templateId)) : null;
  if (t && (t.kind || 'projet') !== kind) return { ok: false, error: `Ce design est de type « ${KIND_LABELS[t.kind] || t.kind} » : ajoutez-y une version du même type, ou créez-en un nouveau.` };
  if (!t) {
    if (!String(name || '').trim()) return { ok: false, error: 'Donnez un nom au design.' };
    const r = db.prepare('INSERT INTO design_templates(name,project_id,kind,created,created_by,updated) VALUES(?,?,?,?,?,?)').run(String(name).trim().slice(0, 120), ed.id, kind, now(), who, now());
    t = getTemplate(Number(r.lastInsertRowid));
  }
  const version = (db.prepare('SELECT MAX(version) m FROM design_versions WHERE template_id=?').get(t.id).m || 0) + 1;
  const base = `designs/t${t.id}/v${version}/`;
  snap.assets = {};
  for (const id of snap.used) {
    const a = getAsset(Number(id));
    if (!a || !storage.exists(a.stored)) continue;
    const key = `${base}${a.id}_${safe(a.name)}`;
    storage.copy(a.stored, key);
    snap.assets[id] = { key, name: a.name, role: a.role };
  }
  delete snap.used;
  const thumbFile = EXPORT_PATH + `thumb-${t.id}-${version}.png`;
  const fmt = snap.formats['4x5'] ? '4x5' : Object.keys(snap.formats)[0];
  const ok = fmt ? await htmlToPng(renderFromSnapshot(snap, fmt).html, fmt, thumbFile) : false;
  let thumb = '';
  if (ok) { thumb = base + 'apercu.png'; storage.put(thumb, thumbFile); rmSync(thumbFile, { force: true }); }
  db.prepare('INSERT INTO design_versions(template_id,version,snapshot,note,thumb,created,created_by) VALUES(?,?,?,?,?,?,?)').run(t.id, version, JSON.stringify(snap), String(note).slice(0, 300), thumb, now(), who);
  db.prepare('UPDATE design_templates SET updated=? WHERE id=?').run(now(), t.id);
  log(who, `Design « ${t.name} » enregistré (version ${version})`);
  return { ok: true, templateId: t.id, version };
}

// --- rendu d'un instantané (indépendant du projet d'origine)
export function renderFromSnapshot(snap, fmt, flags = {}) {
  const g = { ...POSTER_DEFAULTS, ...snap.formats[fmt] };
  const ref = (id) => (id && snap.assets[id] && storage.exists(snap.assets[id].key) ? dataUriKey(snap.assets[id].key) : null);
  const partnerIds = Object.entries(snap.assets).filter(([, a]) => a.role === 'partner').map(([id]) => id).sort((a, b) => Number(a) - Number(b));
  const srcs = { hero: ref(g.hero), logo: ref(g.logo) };
  const partnerSrcs = g.partners === '1' ? partnerIds.map(ref).filter(Boolean) : [];
  partnerSrcs.forEach((p, i) => { srcs['partner' + i] = p; });
  const ed = { id: 0, label: snap.projectLabel, data: snap.sample };
  return { html: renderPoster(ed, fmt, g, { heroSrc: srcs.hero, logoSrc: srcs.logo, partnerSrcs, draft: false, measure: !!flags.measure, print: !!flags.print }), srcs, design: g, ed };
}

// --- duplication : nouveau design indépendant, copie de la dernière version (garde la filiation)
export function duplicateTemplate(templateId, name, who) {
  const t = getTemplate(templateId), last = db.prepare('SELECT * FROM design_versions WHERE template_id=? ORDER BY version DESC LIMIT 1').get(templateId);
  if (!t || !last) return { ok: false, error: 'Design introuvable.' };
  const r = db.prepare('INSERT INTO design_templates(name,notes,parent_id,project_id,created,created_by,updated) VALUES(?,?,?,?,?,?,?)').run(String(name || `Copie de ${t.name}`).slice(0, 120), t.notes, t.id, t.project_id, now(), who, now());
  const nid = Number(r.lastInsertRowid), snap = JSON.parse(last.snapshot);
  db.prepare('UPDATE design_templates SET kind=? WHERE id=?').run(t.kind || 'projet', nid);
  for (const a of Object.values(snap.assets)) {
    const key = `designs/t${nid}/v1/${basename(a.key)}`;
    if (storage.exists(a.key)) storage.copy(a.key, key);
    a.key = key;
  }
  let thumb = '';
  if (last.thumb && storage.exists(last.thumb)) { thumb = `designs/t${nid}/v1/apercu.png`; storage.copy(last.thumb, thumb); }
  db.prepare('INSERT INTO design_versions(template_id,version,snapshot,note,thumb,created,created_by) VALUES(?,?,?,?,?,?,?)').run(nid, 1, JSON.stringify(snap), `Copie de « ${t.name} » version ${last.version}`, thumb, now(), who);
  log(who, `Design dupliqué : ${t.name} → ${name || 'copie'}`);
  return { ok: true, templateId: nid };
}

// --- application à un projet
// map : { [idAssetDuDesign]: idAssetDuProjet | 'copy' | '' }
export function applyVersion(projectId, versionId, opts, who) {
  const v = getVersion(versionId), ed = getEdition(projectId);
  if (!v || !ed) return { ok: false, error: 'Design ou projet introuvable.' };
  const snap = v.snapshot, map = opts.map || {}, chosen = {};
  const notes = [];
  for (const [oldId, a] of Object.entries(snap.assets)) {
    const m = map[oldId];
    if (m === 'copy') { // reprendre l'image du design telle quelle (marquée provisoire)
      if (!storage.exists(a.key)) { chosen[oldId] = ''; continue; }
      const stored = `${Date.now()}_${safe(a.name)}`;
      storage.copy(a.key, stored);
      const r = db.prepare('INSERT INTO assets(edition_id,name,stored,kind,role,size,uploaded_by,created) VALUES(?,?,?,?,?,?,?,?)')
        .run(projectId, safe(a.name), stored, 'image', a.role, storage.size(stored), who, now());
      chosen[oldId] = String(r.lastInsertRowid);
      notes.push(`image reprise : ${a.name}`);
    } else {
      const t = m ? getAsset(Number(m)) : null;
      chosen[oldId] = t && t.edition_id === projectId && t.kind === 'image' ? String(t.id) : '';
    }
  }
  const strip = (els) => Object.fromEntries(Object.entries(els || {}).map(([k, e]) => { const { text, ...rest } = e; return [k, opts.texts ? e : rest]; }));
  for (const fmt of Object.keys(snap.formats)) {
    const f = snap.formats[fmt];
    saveDesign(projectId, `poster_${fmt}`, { ...f, hero: chosen[f.hero] || '', logo: chosen[f.logo] || '', els: strip(f.els) }, who, `Design « ${getTemplate(v.template_id).name} » v${v.version} appliqué`);
  }
  if (snap.kit) { // kit graphique : on ne touche ni aux photos ni aux textes, seulement aux styles communs et au logo
    for (const fmt of Object.keys(FORMATS)) {
      const cur = getDesign(projectId, `poster_${fmt}`);
      saveDesign(projectId, `poster_${fmt}`, { ...cur, ...snap.kit.style, logo: chosen[snap.kit.logo] || cur.logo }, who, `Kit graphique « ${getTemplate(v.template_id).name} » v${v.version} appliqué`);
    }
    notes.push('styles communs (dégradé, composition, texte, partenaires) et logo repris');
  }
  if (opts.brand) {
    const data = { ...ed.data };
    for (const [k, val] of Object.entries(snap.brand)) if (val) data[k] = val;
    saveEdition(projectId, data, who); // repasse la section « Charte » à relire si elle était approuvée
    notes.push('charte (couleurs, polices) reprise');
  }
  if (opts.video && snap.video) {
    const cur = getVideoDesign(projectId);
    saveVideoDesign(projectId, { ...cur, logo: { ...cur.logo, corner: snap.video.logo.corner, size: snap.video.logo.size, margin: snap.video.logo.margin, asset: chosen[snap.video.logo.asset] || cur.logo.asset }, endcard: snap.video.endcard, subs: snap.video.subs });
    notes.push('style vidéo repris');
  }
  const t = getTemplate(v.template_id);
  db.prepare('INSERT INTO design_applications(project_id,version_id,applied_at,applied_by,summary) VALUES(?,?,?,?,?)').run(projectId, versionId, now(), who, notes.join(' ; '));
  log(who, `Design « ${t.name} » v${v.version} appliqué au projet « ${ed.label} »`);
  return { ok: true, notes };
}

// --- archive portable (.zip) : tout ce qu'il faut pour retrouver et rééditer le design des années plus tard
export async function exportBundle(versionId, projectId, who) {
  const v = getVersion(versionId), t = v && getTemplate(v.template_id);
  if (!v) return { ok: false, error: 'Version introuvable.' };
  const snap = v.snapshot, name = `design-${safe(t.name)}-v${v.version}`;
  const dir = EXPORT_PATH + `bundle-${Date.now()}/`, root = dir + name + '/';
  mkdirSync(root + 'assets', { recursive: true }); mkdirSync(root + 'apercus', { recursive: true }); mkdirSync(root + 'svg', { recursive: true }); mkdirSync(root + 'pdf', { recursive: true });
  const out = JSON.parse(JSON.stringify(snap));
  for (const [id, a] of Object.entries(out.assets)) {
    const file = `assets/${id}_${safe(a.name)}`;
    if (storage.exists(a.key)) { writeFileSync(root + file, readFileSync(storage.path(a.key))); a.file = file; }
  }
  const fonts = new Set(), fmts = Object.keys(snap.formats);
  for (let i = 0; i < fmts.length; i += 3) { // 3 rendus en parallèle
    await Promise.all(fmts.slice(i, i + 3).map(async (fmt) => {
      await htmlToPng(renderFromSnapshot(snap, fmt).html, fmt, root + `apercus/${fmt}.png`);
      const builder = (flags) => renderFromSnapshot(snap, fmt, flags);
      const s = await posterSvg(builder(0).ed, fmt, builder);
      if (s.ok) { writeFileSync(root + `svg/${fmt}.svg`, s.svg); s.fonts.forEach((f) => fonts.add(f)); }
      await posterPdf(builder(0).ed, fmt, root + `pdf/${fmt}.pdf`, builder);
    }));
  }
  writeFileSync(root + 'design.json', JSON.stringify({ name: t.name, version: v.version, notes: t.notes, ...out }, null, 2));
  writeFileSync(root + 'VERIFICATION-ILLUSTRATOR.txt', illustratorChecklist({ fonts: [...fonts], designName: t.name, version: v.version }));
  writeFileSync(root + 'LISEZMOI.txt', `Design « ${t.name} » — version ${v.version}\nEnregistré le ${v.created} par ${v.created_by} (projet d'origine : ${snap.projectLabel}).\n\n` +
    `CONTENU\n- design.json : le design complet et modifiable (compositions, positions, tailles, couleurs, textes d'exemple). C'est ce fichier qui permet de le réutiliser dans l'Atelier.\n- assets/ : images et logos utilisés.\n- svg/ : une version SVG par format, un calque par élément, texte modifiable. S'ouvre dans Adobe Illustrator.\n- pdf/ : une version PDF vectorielle par format.\n- apercus/ : images PNG de contrôle.\n- VERIFICATION-ILLUSTRATOR.txt : procédure pour vérifier l'ouverture dans Illustrator (NON validée à ce jour : lisez ce fichier avant de promettre une compatibilité).\n\n` +
    `POUR LE RÉUTILISER\nDans l'Atelier : Designs > Importer une archive, puis « Appliquer à un projet ». Les assets et les informations du projet sont remplacés.\n\n` +
    `POLICES À INSTALLER POUR ÉDITER LE TEXTE DANS ILLUSTRATOR : ${[...fonts].join(', ') || '(aucune détectée)'}\nSans ces polices, Illustrator les remplace et le texte change d'aspect.\n\n` +
    `LIMITES : un paragraphe est découpé en lignes (une ligne = un objet texte) ; les ombres et effets propres au navigateur ne sont pas restitués ; le format .ai d'Adobe n'est pas produit (propriétaire) : utilisez le SVG ou le PDF.\n`);
  const zip = EXPORT_PATH + name + `-${Date.now()}.zip`;
  spawnSync(WIN_TAR, ['-a', '-c', '-f', zip, '-C', dir, name], { timeout: 120000 });
  rmSync(dir, { recursive: true, force: true });
  if (!existsSync(zip)) return { ok: false, error: 'L’archive n’a pas pu être créée.' };
  const r = db.prepare('INSERT INTO exports(edition_id,kind,label,file,draft,source_ids,created,created_by) VALUES(?,?,?,?,?,?,?,?)').run(projectId, 'bundle', `Archive du design « ${t.name} » v${v.version}`, basename(zip), 0, '[]', now(), who);
  log(who, `Archive du design « ${t.name} » v${v.version} créée`);
  return { ok: true, exportId: Number(r.lastInsertRowid) };
}

// --- import d'une archive (retrouver un design sur une autre installation, ou des années plus tard)
export function importBundle(zipFile, projectId, who) {
  const tmp = EXPORT_PATH + `import-${Date.now()}/`;
  mkdirSync(tmp, { recursive: true });
  try {
    const x = spawnSync(WIN_TAR, ['-x', '-f', zipFile, '-C', tmp], { timeout: 120000 });
    const top = readdirSync(tmp).find((d) => existsSync(tmp + d + '/design.json'));
    if (x.status !== 0 || !top) return { ok: false, error: 'Archive non reconnue (design.json introuvable).' };
    const root = tmp + top + '/', j = JSON.parse(readFileSync(root + 'design.json', 'utf8'));
    if (j.schema !== 1 || !j.formats || !j.assets) return { ok: false, error: 'Version d’archive non prise en charge.' };
    const r = db.prepare('INSERT INTO design_templates(name,notes,project_id,created,created_by,updated) VALUES(?,?,?,?,?,?)').run(String(j.name || top).slice(0, 120) + ' (importé)', j.notes || '', projectId, now(), who, now());
    const tid = Number(r.lastInsertRowid);
    db.prepare('UPDATE design_templates SET kind=? WHERE id=?').run(KIND_LABELS[j.kind] ? j.kind : 'projet', tid);
    for (const [id, a] of Object.entries(j.assets)) {
      const file = a.file || '';
      if (!file.startsWith('assets/') || file.includes('..') || !existsSync(root + file)) { delete j.assets[id]; continue; }
      const key = `designs/t${tid}/v1/${basename(file)}`;
      storage.put(key, root + file);
      a.key = key; delete a.file;
    }
    const { name, version, notes, ...snap } = j;
    let thumb = '';
    const png = root + 'apercus/4x5.png';
    if (existsSync(png)) { thumb = `designs/t${tid}/v1/apercu.png`; storage.put(thumb, png); }
    db.prepare('INSERT INTO design_versions(template_id,version,snapshot,note,thumb,created,created_by) VALUES(?,?,?,?,?,?,?)').run(tid, 1, JSON.stringify(snap), `Importé depuis une archive (version d'origine ${version || '?'})`, thumb, now(), who);
    log(who, `Design importé : ${name || top}`);
    return { ok: true, templateId: tid };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// Design d'une version enregistrée, adapté à un projet SANS rien modifier dans le projet (utilisé par les variantes).
export function designFromVersion(versionId, fmt, { projectId, hero, logo }) {
  const v = getVersion(versionId), f = v?.snapshot.formats[fmt];
  if (!f) return null;
  const own = (id) => { const a = id ? getAsset(Number(id)) : null; return a && a.edition_id === projectId && a.kind === 'image' ? String(a.id) : ''; };
  const { ...d } = f;
  d.els = Object.fromEntries(Object.entries(f.els || {}).map(([k, e]) => { const { text, ...rest } = e; return [k, rest]; }));
  return { ...d, hero: own(hero), logo: own(logo) };
}

// --- « Enregistrer comme modèle » : la composition d'UN contenu (ses formats, éléments éditables, style vidéo)
export function saveModel(ed, variant, { templateId, name, note }, who) {
  const designs = variant.formats.map((f) => getDesign(ed.id, `v${variant.id}_${f}`));
  if (designs.some((d) => d.ext)) return Promise.resolve({ ok: false, error: 'Un contenu basé sur une affiche reçue ne s’enregistre pas comme modèle : l’affiche est déjà votre fichier source.' });
  if (!variant.formats.length && !variant.with_video) return Promise.resolve({ ok: false, error: 'Ce contenu n’a rien à enregistrer.' });
  return saveToLibrary(ed, { templateId, name: name || variant.name, note, kind: 'modele', variantId: variant.id, formats: variant.formats }, who);
}

// --- « Enregistrer le kit graphique du projet » : charte, logo et styles communs, sans contenu particulier
export function buildKitSnapshot(ed) {
  const used = new Set(), p = getDesign(ed.id, 'poster_4x5'), d = ed.data;
  if (p.logo) used.add(String(p.logo));
  if (p.partners === '1') for (const a of assetsByRole(ed.id, 'partner')) if (a.kind === 'image') used.add(String(a.id));
  const v = getVideoDesign(ed.id);
  if (v.logo.asset) used.add(String(v.logo.asset));
  return {
    schema: 1, kind: 'kit', savedAt: now(), projectLabel: ed.label,
    brand: Object.fromEntries(['color_primary', 'color_secondary', 'color_text', 'font_title', 'font_body', 'brand_rules'].map((k) => [k, d[k] ?? ''])),
    sample: d, used: [...used], formats: {},
    kit: { style: { gradient: p.gradient, style: p.style, text_pos: p.text_pos, partners: p.partners, title_scale: p.title_scale }, logo: p.logo || '' },
    video: { logo: { corner: v.logo.corner, size: v.logo.size, margin: v.logo.margin, asset: v.logo.asset }, endcard: v.endcard, subs: v.subs },
  };
}
export const saveKit = (ed, { templateId, name, note }, who) => saveToLibrary(ed, { templateId, name, note, kind: 'kit', snapshot: buildKitSnapshot(ed) }, who);
