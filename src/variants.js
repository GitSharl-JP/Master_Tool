// Variantes guidées : une variante = UNE intention marketing identifiable (angle, audience, langue, format, relance),
// une hypothèse à tester, des sorties (affiches par format, vidéo éventuelle) et un cycle de validation.
//
// Garanties :
//  - pas de variante sans intention ni hypothèse, et pas de quasi-doublon (même angle + audience + langue) ;
//  - APPROUVER fige une version (instantané : designs, sous-titres, fiche) qui ne bouge plus ; toute modification
//    ultérieure remet la variante « à relire » sans toucher à la version approuvée ni à ses exports ;
//  - l'export officiel part TOUJOURS de la version approuvée (jamais de l'état en cours de travail) ;
//  - mêmes entrées = même clé = pas de doublon d'export, y compris après une reprise sur erreur ;
//  - un nouvel export ne remplace jamais un export existant ni une association à une campagne (épinglée).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { db, log, getEdition } from './db.js';
import { getDesign, saveDesign, getAsset, listAssets, buildPosterHtml, htmlToPng, EXPORT_PATH, designSaveHooks } from './studio.js';
import { getVideoDesign, saveVideoDesign, getCues, saveCues, planExports } from './video.js';
import { designFromVersion } from './library.js';
import { createContent, setContentExport, linkContent, linksOfContent, isFrozenState } from './campaigns.js';
import { publishBlockers } from './schema.js';
import { FORMATS } from './formats.js';

db.exec(`
CREATE TABLE IF NOT EXISTS variants(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, campaign_id INTEGER, adset_id INTEGER,
  name TEXT NOT NULL, intent TEXT NOT NULL, angle TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT '',
  hypothesis TEXT NOT NULL DEFAULT '', msg_title TEXT NOT NULL DEFAULT '', msg_tagline TEXT NOT NULL DEFAULT '', msg_top TEXT NOT NULL DEFAULT '', msg_cta TEXT NOT NULL DEFAULT '',
  formats TEXT NOT NULL DEFAULT '[]', with_video INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'brouillon',
  owner TEXT NOT NULL DEFAULT '', reviewer TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', parent_id INTEGER,
  approved_version INTEGER NOT NULL DEFAULT 0, approved_by TEXT NOT NULL DEFAULT '', approved_at TEXT,
  created TEXT NOT NULL, created_by TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS variant_versions(id INTEGER PRIMARY KEY, variant_id INTEGER NOT NULL, version INTEGER NOT NULL, snapshot TEXT NOT NULL, hash TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
`);
const now = () => new Date().toISOString();
const txt = (v, n = 300) => String(v ?? '').trim().slice(0, n);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const scope = (id) => 'v' + id;
const dkey = (id, fmt) => `v${id}_${fmt}`;
const sha = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex');

// L'intention guide la création : ce qu'il faut renseigner et une formulation d'hypothèse proposée.
export const INTENTS = {
  angle: { label: 'Tester un angle créatif', help: 'Même cible, message différent : lequel fait réagir le plus ?', needs: ['angle'], hypothesis: 'Un message centré sur « {angle} » obtient plus de clics que le message de référence.' },
  audience: { label: 'Parler à une audience précise', help: 'Adapter le message à un public (familles, couples, touristes…).', needs: ['audience'], hypothesis: 'Un message adapté à « {audience} » convertit mieux que le message général.' },
  langue: { label: 'Version dans une autre langue', help: 'Traduire textes et sous-titres pour un autre marché.', needs: ['language'], hypothesis: 'La version en {language} touche le marché {language} mieux que la version actuelle.' },
  format: { label: 'Adapter à un placement', help: 'Recomposer pour un format ou un canal (Stories, TikTok, bannière…).', needs: [], hypothesis: 'Une composition pensée pour ce placement améliore la lecture et les clics.' },
  relance: { label: 'Relancer / créer l’urgence', help: 'Dernières places, rappel de date, derniers jours.', needs: ['angle'], hypothesis: 'Un message d’urgence (« {angle} ») accélère les réservations en fin de période.' },
};
export const VARIANT_STATUSES = ['brouillon', 'à relire', 'approuvé', 'archivé'];

const parse = (r) => r && { ...r, formats: JSON.parse(r.formats || '[]') };
export const getVariant = (id) => parse(db.prepare('SELECT * FROM variants WHERE id=?').get(id));
export const listVariants = (pid, campaignId) => db.prepare(`SELECT * FROM variants WHERE project_id=? ${campaignId ? 'AND campaign_id=?' : ''} ORDER BY id DESC`).all(...(campaignId ? [pid, campaignId] : [pid])).map(parse);
export const listVersions = (vid) => db.prepare('SELECT id,version,approved_by,approved_at,note,hash FROM variant_versions WHERE variant_id=? ORDER BY version DESC').all(vid);
const versionRow = (vid, version) => { const r = db.prepare('SELECT * FROM variant_versions WHERE variant_id=? AND version=?').get(vid, version); return r && { ...r, snapshot: JSON.parse(r.snapshot) }; };

// --- état de travail (ce qui définit les sorties) et son empreinte
export function workingState(v) {
  const designs = {};
  for (const fmt of [...v.formats].sort()) designs[fmt] = getDesign(v.project_id, dkey(v.id, fmt));
  const video = v.with_video ? { design: getVideoDesign(v.project_id, scope(v.id)), cues: getCues(v.project_id, scope(v.id)).cues } : null;
  return { designs, video };
}
export const stateHash = (v) => sha(workingState(v));
export const isPristine = (v) => v.approved_version > 0 && versionRow(v.id, v.approved_version)?.hash === stateHash(v);

// --- création guidée
function guard(pid, b, exceptId) {
  const intent = INTENTS[b.intent];
  if (!intent) return 'Choisissez l’intention de la variante.';
  if (!txt(b.name)) return 'Donnez un nom à la variante.';
  for (const need of intent.needs) if (!txt(b[need])) return `Cette intention demande de préciser : ${{ angle: 'l’angle créatif', audience: 'l’audience visée', language: 'la langue' }[need]}.`;
  if (txt(b.hypothesis).length < 12) return 'Écrivez l’hypothèse à tester (au moins une phrase) : sans elle, la variante n’apporte rien à comparer.';
  const key = [b.angle, b.audience, b.language].map(norm).join('|');
  const twin = db.prepare("SELECT id,name,angle,audience,language FROM variants WHERE project_id=? AND status<>'archivé' AND IFNULL(campaign_id,0)=? AND id<>?").all(pid, Number(b.campaign_id) || 0, exceptId || 0)
    .find((x) => [x.angle, x.audience, x.language].map(norm).join('|') === key);
  if (twin) return `Une variante avec la même intention existe déjà : « ${twin.name} ». Changez l’angle, l’audience ou la langue, sinon vous comparerez deux versions presque identiques.`;
  return null;
}
const chosenFormats = (b) => Object.keys(FORMATS).filter((k) => b['fmt_' + k]);

function setMessages(designs, v) {
  const out = {};
  for (const [fmt, d] of Object.entries(designs)) {
    const els = { ...(d.els || {}) };
    const put = (id, text) => { const e = { ...(els[id] || {}) }; if (text) e.text = text; else delete e.text; if (Object.keys(e).length) els[id] = e; else delete els[id]; };
    put('title', v.msg_title); put('kicker', v.msg_tagline); put('top', v.msg_top); put('cta', v.msg_cta);
    out[fmt] = { ...d, els };
  }
  return out;
}

export function createVariant(pid, b, who, source) { // source : variante à dupliquer (facultatif)
  const err = guard(pid, b);
  if (err) return { ok: false, error: err };
  const formats = chosenFormats(b);
  if (!formats.length && !b.with_video) return { ok: false, error: 'Cochez au moins un format de sortie (ou la vidéo).' };
  const r = db.prepare(`INSERT INTO variants(project_id,campaign_id,adset_id,name,intent,angle,audience,language,hypothesis,msg_title,msg_tagline,msg_top,msg_cta,formats,with_video,status,owner,reviewer,notes,parent_id,created,created_by,updated)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(pid, Number(b.campaign_id) || null, Number(b.adset_id) || null, txt(b.name, 140), b.intent, txt(b.angle, 140), txt(b.audience, 140), txt(b.language, 40), txt(b.hypothesis, 500),
      txt(b.msg_title, 200), txt(b.msg_tagline, 200), txt(b.msg_top, 200), txt(b.msg_cta, 80), JSON.stringify(formats), b.with_video ? 1 : 0, 'brouillon', txt(b.owner, 60) || who, txt(b.reviewer, 60), txt(b.notes, 500), source?.id || null, now(), who, now());
  const id = Number(r.lastInsertRowid), v = getVariant(id);
  const designs = {};
  for (const fmt of formats) {
    let d;
    if (source) d = getDesign(pid, dkey(source.id, fmt));
    else if (b.design_version) d = designFromVersion(Number(b.design_version), fmt, { projectId: pid, hero: b.hero, logo: b.logo });
    d = d || getDesign(pid, `poster_${fmt}`);
    const own = (x) => { const a = x ? getAsset(Number(x)) : null; return a && a.edition_id === pid && a.kind === 'image' ? String(a.id) : null; };
    designs[fmt] = { ...d, hero: own(b.hero) ?? d.hero, logo: own(b.logo) ?? d.logo };
  }
  for (const [fmt, d] of Object.entries(setMessages(designs, v))) saveDesign(pid, dkey(id, fmt), d, who, `Création de la variante « ${v.name} »`);
  if (v.with_video) {
    const vd = source?.with_video ? getVideoDesign(pid, scope(source.id)) : getVideoDesign(pid);
    saveVideoDesign(pid, { ...vd, asset: b.video_asset || vd.asset }, scope(id), who);
    saveCues(pid, source?.with_video ? getCues(pid, scope(source.id)).cues : getCues(pid).cues, who, '', scope(id));
  }
  log(who, `Variante créée : « ${v.name} » (${INTENTS[v.intent].label})`);
  return { ok: true, id };
}
export function duplicateVariant(id, b, who) {
  const src = getVariant(id);
  if (!src) return { ok: false, error: 'Variante introuvable.' };
  const merged = { ...b, intent: b.intent || src.intent, campaign_id: b.campaign_id ?? src.campaign_id, adset_id: b.adset_id ?? src.adset_id,
    msg_title: b.msg_title ?? src.msg_title, msg_tagline: b.msg_tagline ?? src.msg_tagline, msg_top: b.msg_top ?? src.msg_top, msg_cta: b.msg_cta ?? src.msg_cta,
    with_video: src.with_video, owner: b.owner ?? src.owner, reviewer: b.reviewer ?? src.reviewer };
  for (const f of src.formats) merged['fmt_' + f] = '1';
  return createVariant(src.project_id, merged, who, src);
}

// --- modification des intentions / textes
export function updateVariant(id, b, who) {
  const v = getVariant(id);
  if (!v) return;
  db.prepare('UPDATE variants SET name=?,angle=?,audience=?,language=?,hypothesis=?,owner=?,reviewer=?,notes=?,campaign_id=?,adset_id=?,updated=? WHERE id=?')
    .run(txt(b.name, 140) || v.name, txt(b.angle, 140), txt(b.audience, 140), txt(b.language, 40), txt(b.hypothesis, 500), txt(b.owner, 60), txt(b.reviewer, 60), txt(b.notes, 500), Number(b.campaign_id) || null, Number(b.adset_id) || null, now(), id);
  log(who, `Variante modifiée : « ${v.name} »`);
}
export function updateMessages(id, b, who) { // enregistre les textes ET les applique à chaque format
  const v = getVariant(id);
  if (!v) return;
  db.prepare('UPDATE variants SET msg_title=?,msg_tagline=?,msg_top=?,msg_cta=?,updated=? WHERE id=?').run(txt(b.msg_title, 200), txt(b.msg_tagline, 200), txt(b.msg_top, 200), txt(b.msg_cta, 80), now(), id);
  const nv = getVariant(id);
  for (const [fmt, d] of Object.entries(setMessages(workingState(nv).designs, nv))) saveDesign(v.project_id, dkey(id, fmt), d, who, 'Textes de la variante');
}

// --- validation
export function requestReview(id, who) {
  const v = getVariant(id);
  if (!v || v.status === 'approuvé' || v.status === 'archivé') return { ok: false, error: 'Rien à relire : la variante est déjà approuvée ou archivée.' };
  db.prepare("UPDATE variants SET status='à relire', updated=? WHERE id=?").run(now(), id);
  log(who, `Variante « ${v.name} » : relecture demandée${v.reviewer ? ' à ' + v.reviewer : ''}`);
  return { ok: true };
}
export function approve(id, who, note = '') {
  const v = getVariant(id);
  if (!v || v.status === 'archivé') return { ok: false, error: 'Variante introuvable ou archivée.' };
  const ed = getEdition(v.project_id), st = workingState(v);
  const blocking = checks(id).filter((c) => c.level === 'bloquant');
  if (blocking.length) return { ok: false, error: `${blocking[0].text}${blocking.length > 1 ? ` (+ ${blocking.length - 1} autre(s) point(s) à corriger)` : ''}` };
  if (v.approved_version > 0 && isPristine(v)) return { ok: false, error: 'Cette version est déjà approuvée et n’a pas changé.' };
  const blockers = publishBlockers(ed);
  const provisional = Object.values(st.designs).some((d) => getAsset(Number(d.hero))?.provisional === 1) || (st.video && getAsset(Number(st.video.design.asset))?.provisional === 1);
  const version = (db.prepare('SELECT MAX(version) m FROM variant_versions WHERE variant_id=?').get(id).m || 0) + 1;
  const snapshot = { fiche: ed.data, designs: st.designs, video: st.video, blockers, draft: blockers.length > 0 || provisional,
    intent: { name: v.name, intent: v.intent, angle: v.angle, audience: v.audience, language: v.language, hypothesis: v.hypothesis }, formats: v.formats };
  db.prepare('INSERT INTO variant_versions(variant_id,version,snapshot,hash,approved_by,approved_at,note) VALUES(?,?,?,?,?,?,?)').run(id, version, JSON.stringify(snapshot), stateHash(v), who, now(), txt(note, 200));
  db.prepare("UPDATE variants SET status='approuvé', approved_version=?, approved_by=?, approved_at=?, updated=? WHERE id=?").run(version, who, now(), now(), id);
  log(who, `Variante « ${v.name} » approuvée (version ${version})${snapshot.draft ? ' — export BROUILLON tant que la fiche n’est pas prête' : ''}`);
  return { ok: true, version, draft: snapshot.draft };
}
// Toute modification après approbation remet « à relire » ; la version approuvée et ses exports ne bougent pas.
export function touch(id, who = '') {
  const v = getVariant(id);
  if (!v || v.status !== 'approuvé' || isPristine(v)) return;
  db.prepare("UPDATE variants SET status='à relire', updated=? WHERE id=?").run(now(), id);
  log(who || 'système', `Variante « ${v.name} » modifiée après approbation : repasse « à relire » (la version approuvée v${v.approved_version} reste intacte)`);
}
designSaveHooks.push((pid, key, who) => {
  const m = /^(?:v(\d+)_|video_v(\d+)$|cues_v(\d+)$)/.exec(key);
  if (m) touch(Number(m[1] || m[2] || m[3]), who);
});
export function restoreApproved(id, version, who) {
  const v = getVariant(id), ver = v && versionRow(id, Number(version));
  if (!ver) return { ok: false, error: 'Version introuvable.' };
  const s = ver.snapshot;
  for (const [fmt, d] of Object.entries(s.designs)) saveDesign(v.project_id, dkey(id, fmt), d, who, `Retour à la version approuvée v${ver.version}`);
  if (s.video) { saveVideoDesign(v.project_id, s.video.design, scope(id), who); saveCues(v.project_id, s.video.cues, who, '', scope(id)); }
  db.prepare("UPDATE variants SET status='approuvé', approved_version=?, updated=? WHERE id=?").run(ver.version, now(), id);
  log(who, `Variante « ${v.name} » : retour à la version approuvée v${ver.version}`);
  return { ok: true };
}
export function archive(id, who) { const v = getVariant(id); if (v) { db.prepare("UPDATE variants SET status='archivé', updated=? WHERE id=?").run(now(), id); log(who, `Variante archivée : « ${v.name} »`); } }

// --- export officiel : toujours depuis la version APPROUVÉE
export async function exportApproved(id, who) {
  const v = getVariant(id);
  if (!v) return { ok: false, error: 'Variante introuvable.' };
  if (v.status !== 'approuvé' || !isPristine(v)) return { ok: false, error: v.status === 'approuvé' ? 'La variante a changé depuis son approbation : relisez et approuvez à nouveau.' : 'La variante doit d’abord être approuvée.' };
  const ver = versionRow(id, v.approved_version), snap = ver.snapshot, ed = getEdition(v.project_id), edSnap = { ...ed, data: snap.fiche };
  const refs = listAssets(v.project_id).filter((a) => ['hero', 'logo', 'partner'].includes(a.role)).map((a) => [a.id, a.stored, a.size]).sort();
  const out = [];
  for (const fmt of v.formats) {
    const design = snap.designs[fmt];
    const key = sha({ id, version: ver.version, fmt, design, fiche: snap.fiche, refs, draft: snap.blockers });
    const hit = db.prepare("SELECT * FROM exports WHERE variant_id=? AND fmt=? AND content_key=? AND kind='affiche'").get(id, fmt, key);
    if (hit && existsSync(EXPORT_PATH + hit.file)) { out.push({ fmt, state: 'déjà produit (réutilisé)', exportId: hit.id }); continue; }
    const { html, draft } = buildPosterHtml(edSnap, fmt, snap.blockers, { design });
    const file = `variante-${id}-v${ver.version}-${fmt}-${new Date().toISOString().replace(/[:.]/g, '-')}${draft ? '-DRAFT' : ''}.png`;
    if (!(await htmlToPng(html, fmt, EXPORT_PATH + file))) { out.push({ fmt, state: 'échec : réessayez, rien n’a été enregistré' }); continue; }
    const res = db.prepare('INSERT INTO exports(edition_id,kind,label,file,draft,source_ids,created,created_by,variant_id,variant_version,fmt,content_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(v.project_id, 'affiche', `Variante « ${v.name} » v${ver.version} — Affiche ${FORMATS[fmt].label}`, file, draft ? 1 : 0, JSON.stringify([design.hero, design.logo].filter(Boolean)), now(), who, id, ver.version, fmt, key);
    out.push({ fmt, state: draft ? 'créé (BROUILLON)' : 'créé', exportId: Number(res.lastInsertRowid) });
  }
  let video = null;
  if (snap.video?.design.asset) {
    video = planExports(ed, who, { state: { design: { ...snap.video.design, formats: snap.video.design.formats?.length ? snap.video.design.formats : ['9x16'] }, cues: snap.video.cues, fiche: snap.fiche, posterDesigns: snap.designs, draft: snap.draft, variant: { id, version: ver.version } } });
  }
  log(who, `Variante « ${v.name} » v${ver.version} : export (${out.map((o) => o.fmt).join(', ')}${video?.ok ? ' + vidéo' : ''})`);
  syncContents(id, who);
  return { ok: true, out, video };
}

// Les sorties officielles de la version approuvée deviennent des contenus de la bibliothèque (associables aux campagnes).
export function syncContents(id, who = '') {
  const v = getVariant(id);
  if (!v || !v.approved_version) return;
  const exps = db.prepare('SELECT * FROM exports WHERE variant_id=? AND variant_version=? ORDER BY id DESC').all(id, v.approved_version);
  const seen = new Set();
  for (const e of exps) {
    const kind = e.kind === 'video' ? 'video' : 'image', k = `${kind}:${e.fmt}`;
    if (seen.has(k)) continue; seen.add(k);
    const c = db.prepare('SELECT * FROM contents WHERE variant_id=? AND format=? AND kind=?').get(id, e.fmt, kind);
    if (c) { if (c.export_id !== e.id) { setContentExport(c.id, e.id, who, 'approuvé'); db.prepare('UPDATE contents SET variant_version=? WHERE id=?').run(v.approved_version, c.id); } continue; }
    const o = createContent(v.project_id, { export_id: e.id, title: `${v.name} · ${FORMATS[e.fmt].ratio}${kind === 'video' ? ' (vidéo)' : ''}`, angle: v.angle, audience: v.audience, language: v.language }, who || 'système');
    if (o.ok) db.prepare("UPDATE contents SET variant_id=?, variant_version=?, format=?, status='approuvé' WHERE id=?").run(id, v.approved_version, e.fmt, o.id);
  }
}
export const contentsOf = (id) => db.prepare('SELECT c.*, e.file, e.draft FROM contents c LEFT JOIN exports e ON e.id=c.export_id WHERE c.variant_id=? ORDER BY c.format, c.kind').all(id);
export function linkOutputs(id, target, who) {
  syncContents(id, who);
  const res = { ok: 0, skipped: [] };
  for (const c of contentsOf(id)) { const r = linkContent(c.id, target, who); if (r.ok) res.ok++; else res.skipped.push(`${FORMATS[c.format]?.ratio || ''} : ${r.error}`); }
  return res;
}

// --- suivi des sorties : brouillon → à relire → approuvé → exporté → transmis → publié (jamais confondus)
export const STAGES = ['brouillon', 'à relire', 'approuvé', 'exporté', 'transmis', 'publié'];
export function outputsOf(id) {
  const v = getVariant(id);
  const base = v.status === 'approuvé' ? 'approuvé' : v.status === 'à relire' ? 'à relire' : 'brouillon';
  syncContents(id);
  const rows = v.formats.map((fmt) => ({ fmt, kind: 'image' }));
  if (v.with_video) rows.push({ fmt: 'video', kind: 'video' });
  return rows.map((r) => {
    const fmts = r.kind === 'video' ? (getVideoDesign(v.project_id, scope(id)).formats || []) : [r.fmt];
    const exps = db.prepare("SELECT * FROM exports WHERE variant_id=? AND variant_version=? AND kind=? ORDER BY id DESC").all(id, v.approved_version, r.kind === 'video' ? 'video' : 'affiche').filter((e) => fmts.includes(e.fmt));
    const trial = r.kind === 'image' ? db.prepare("SELECT * FROM exports WHERE variant_id=? AND variant_version IS NULL AND fmt=? ORDER BY id DESC LIMIT 1").get(id, r.fmt) : null;
    const contents = db.prepare('SELECT * FROM contents WHERE variant_id=? AND kind=?').all(id, r.kind).filter((c) => fmts.includes(c.format));
    const links = contents.flatMap((c) => linksOfContent(c.id));
    let stage = base;
    if (exps.length && v.status === 'approuvé') stage = 'exporté';
    if (links.some((l) => l.state === 'transmis')) stage = 'transmis';
    if (links.some((l) => l.state === 'publié')) stage = 'publié';
    return { ...r, exports: exps, trial, contents, links, stage, frozen: links.some((l) => isFrozenState(l.state)) };
  });
}
export const variantsForContent = (cid) => db.prepare('SELECT v.* FROM variants v JOIN contents c ON c.variant_id=v.id WHERE c.id=?').get(cid);

// Met à jour la bibliothèque de contenus pour tout le projet (appelé à l'ouverture des pages qui les listent).
export function syncProject(pid, who = '') {
  for (const v of listVariants(pid)) if (v.approved_version && v.status !== 'archivé') syncContents(v.id, who);
}

// ---------------------------------------------------------------------------------------------------------------
// Travail en solo : à la place d'une relecture par une autre personne, des CONTRÔLES AUTOMATIQUES avant approbation.
//   « bloquant » : on ne peut pas approuver ; « conseil » : signalé, on peut passer outre en connaissance de cause.
export function checks(id) {
  const v = getVariant(id);
  if (!v) return [];
  const ed = getEdition(v.project_id), st = workingState(v), d = ed.data, out = [];
  const add = (level, text, href) => out.push({ level, text, href });
  const posterHref = (fmt) => `/edition/${v.project_id}/poster/${fmt}?variant=${id}`;
  for (const [fmt, g] of Object.entries(st.designs)) {
    if (!g.hero) add('bloquant', `Aucune photo de fond pour le format ${FORMATS[fmt].ratio} : choisissez-en une.`, posterHref(fmt));
    else if (getAsset(Number(g.hero))?.provisional === 1) add('conseil', `La photo du format ${FORMATS[fmt].ratio} est marquée « provisoire » : l’export sera en BROUILLON.`, `/edition/${v.project_id}/assets`);
  }
  if (Object.values(st.designs).length && Object.values(st.designs).every((g) => !g.logo)) add('conseil', 'Aucun logo choisi sur les affiches.', posterHref(v.formats[0]));
  const title = (v.msg_title || d.title_en || '').trim();
  if (!title) add('bloquant', 'Le titre est vide (ni titre de variante, ni titre dans la fiche).', `/edition/${v.project_id}/variants/${id}`);
  if (title.length > 48) add('conseil', `Titre long (${title.length} caractères) : il risque de déborder sur les petits formats. Vérifiez les aperçus.`, `/edition/${v.project_id}/variants/${id}`);
  const shown = [title, v.msg_tagline || d.tagline_en, v.msg_top || d.top_line_en, v.msg_cta || d.cta_book_en].join(' ');
  if (/placeholder|provisoire|lorem/i.test(shown)) add('conseil', 'Un texte affiché contient encore « placeholder » ou « provisoire ».', `/edition/${v.project_id}/variants/${id}`);
  if (!d.booking_url) add('conseil', 'Aucune adresse de réservation dans la fiche : le bouton ou le lien ne mènera nulle part.', `/edition/${v.project_id}`);
  const notReady = publishBlockers(ed);
  if (notReady.length) add('conseil', `La fiche n’est pas prête (${notReady.length} point(s)) : les exports seront marqués BROUILLON et ne pourront pas être transmis.`, `/edition/${v.project_id}`);
  if (st.video) {
    const vd = st.video.design;
    if (!vd.asset) add('bloquant', 'La vidéo n’a pas de source : choisissez-la dans l’éditeur vidéo de la variante.', `/edition/${v.project_id}/video?variant=${id}`);
    else if (vd.end > 0 && vd.end <= vd.start) add('bloquant', 'Extrait vidéo invalide : la fin est avant le début.', `/edition/${v.project_id}/video?variant=${id}`);
    if (vd.asset && vd.subs?.on && !st.video.cues.length) add('conseil', 'Les sous-titres sont activés mais vides.', `/edition/${v.project_id}/video?variant=${id}`);
  }
  return out;
}

// Une seule phrase qui dit quoi faire maintenant, avec le bouton qui le fait.
export function nextStep(id) {
  const v = getVariant(id);
  if (!v || v.status === 'archivé') return null;
  const blocking = checks(id).filter((c) => c.level === 'bloquant');
  const pristine = isPristine(v);
  if (v.status !== 'approuvé' || !pristine) {
    if (blocking.length) return { text: `À corriger avant d’approuver : ${blocking[0].text}`, href: blocking[0].href };
    if (v.approved_version && !pristine) return { text: `Vous avez modifié la variante depuis son approbation. Vérifiez les aperçus, puis approuvez à nouveau (la version v${v.approved_version} reste intacte).`, action: 'approve-export', label: 'Approuver et exporter' };
    return { text: 'Vérifiez les aperçus et les textes. Quand c’est bon, une seule action suffit.', action: 'approve-export', label: 'Approuver et exporter' };
  }
  const outs = outputsOf(id);
  if (!outs.some((o) => o.exports.length)) return { text: 'Version approuvée : il reste à produire les fichiers.', action: 'export', label: 'Exporter la version approuvée' };
  const links = outs.flatMap((o) => o.links);
  if (!links.length) return v.campaign_id
    ? { text: 'Fichiers prêts. Associez-les à la campagne (en brouillon, rien n’est transmis).', action: 'link-auto', label: 'Associer à la campagne' }
    : { text: 'Fichiers prêts. Utilisables tels quels (organique) ou associez-les à une campagne ci-dessous.' };
  const camp = v.campaign_id ? `/edition/${v.project_id}/campaigns/${v.campaign_id}` : `/edition/${v.project_id}/campaigns`;
  if (links.some((l) => ['brouillon', 'à relire'].includes(l.state))) return { text: 'Associée en brouillon. Validez-la pour la campagne.', href: camp, label: 'Ouvrir la campagne' };
  if (links.some((l) => l.state === 'approuvé')) return { text: 'Prête à transmettre : récapitulatif, puis dépôt dans Ads Manager.', href: camp, label: 'Ouvrir la campagne' };
  if (links.some((l) => l.state === 'transmis')) return { text: 'Transmise. Quand elle est en ligne dans Meta, marquez-la « publiée ».', href: camp, label: 'Ouvrir la campagne' };
  return { text: 'Terminé. Pensez à saisir les résultats après quelques jours (page de la campagne).', href: camp, label: 'Ouvrir la campagne' };
}

// Approuver puis exporter en une seule action (parcours courant d'une personne seule).
export async function approveAndExport(id, who, note = '') {
  const a = approve(id, who, note);
  if (!a.ok && !/déjà approuvée/.test(a.error)) return a;
  const e = await exportApproved(id, who);
  return e.ok ? { ...e, approvedVersion: a.ok ? a.version : getVariant(id).approved_version, draft: a.draft } : e;
}
