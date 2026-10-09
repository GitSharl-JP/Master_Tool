// Contenus et campagnes. Les campagnes sont CRÉÉES DANS META ; l'atelier les relie à un projet puis organise la production.
//
//   Projet ── Connexion Meta ── Campagne ── Ensemble de publicités ── Annonce      (niveaux de Meta, jamais confondus)
//        └── Contenus (images, vidéos…) : existent sans campagne, puis sont associés à un niveau précis.
//
// Chaque niveau sépare TROIS choses, pour éviter la double saisie et les confusions :
//   - CONFIGURATION META (`meta_*`) : ce que Meta contient réellement (objectif Meta, budget configuré, ciblage réel,
//     statut…). Tant que l'API n'est pas connectée, ces champs sont saisis à la main et marqués « provisoire / saisi à
//     la main » ; `meta_synced_at` reste vide. Une future synchronisation les remplacera.
//   - BRIEF INTERNE (`brief_*`) : nos intentions (objectif interne, message, audience souhaitée, hypothèse, langues,
//     budget prévu). Jamais écrasé par Meta, jamais envoyé à Meta.
//   - Les deux ne se mélangent jamais : budget prévu ≠ budget configuré, audience souhaitée ≠ ciblage réel,
//     objectif interne ≠ objectif Meta.
//
// Règles de sécurité des publicités :
//   - une association est « épinglée » sur UN export précis : un nouvel export ne la remplace jamais ;
//   - une association « transmis » ou « publié » est FIGÉE (version diffusée) : elle ne se retire ni ne se modifie ;
//   - travailler sur une campagne active reste possible : on prépare de nouvelles variantes en brouillon ;
//   - passer à « transmis » ou « publié » exige une confirmation explicite après un récapitulatif ;
//   - rien n'est écrit dans Meta par ce module : tant que l'API n'est pas connectée, ces statuts sont des
//     déclarations manuelles et sont affichés comme tels.
import { createHash } from 'node:crypto';
import { db, log } from './db.js';
import { listExports, getExport } from './studio.js';
import { CHANNELS, formatsForChannels, FORMATS } from './formats.js';

db.exec(`
CREATE TABLE IF NOT EXISTS meta_links(project_id INTEGER PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'manuel', ad_account TEXT NOT NULL DEFAULT '', page_name TEXT NOT NULL DEFAULT '', instagram TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', synced_at TEXT, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS campaigns(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, objective TEXT NOT NULL DEFAULT '', meta_id TEXT NOT NULL DEFAULT '', meta_status TEXT NOT NULL DEFAULT 'inconnu', source TEXT NOT NULL DEFAULT 'manuel', brief TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '', budget_note TEXT NOT NULL DEFAULT '', starts TEXT NOT NULL DEFAULT '', ends TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, created_by TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS adsets(id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL, name TEXT NOT NULL, meta_id TEXT NOT NULL DEFAULT '', meta_status TEXT NOT NULL DEFAULT 'inconnu', audience TEXT NOT NULL DEFAULT '', placements TEXT NOT NULL DEFAULT '[]', languages TEXT NOT NULL DEFAULT '', landing TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ads(id INTEGER PRIMARY KEY, adset_id INTEGER NOT NULL, name TEXT NOT NULL, meta_id TEXT NOT NULL DEFAULT '', meta_status TEXT NOT NULL DEFAULT 'inconnu', landing TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contents(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, export_id INTEGER, format TEXT NOT NULL DEFAULT '', angle TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'à relire', notes TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, created_by TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS content_links(id INTEGER PRIMARY KEY, content_id INTEGER NOT NULL, campaign_id INTEGER, adset_id INTEGER, ad_id INTEGER, export_id INTEGER, state TEXT NOT NULL DEFAULT 'brouillon', note TEXT NOT NULL DEFAULT '', linked_at TEXT NOT NULL, linked_by TEXT NOT NULL, transmitted_at TEXT);
CREATE TABLE IF NOT EXISTS results(id INTEGER PRIMARY KEY, link_id INTEGER NOT NULL, period TEXT NOT NULL DEFAULT '', impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, spend REAL NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'manuel', entered_by TEXT NOT NULL, entered_at TEXT NOT NULL);
`);

// --- migrations (idempotentes : on ajoute les colonnes manquantes, on ne supprime rien)
function addCol(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
const T = "TEXT NOT NULL DEFAULT ''";
for (const [c, d] of [['meta_objective', T], ['meta_budget', T], ['meta_start', T], ['meta_end', T], ['meta_synced_at', 'TEXT'], ['meta_source', "TEXT NOT NULL DEFAULT 'manuel'"],
  ['brief_objective', T], ['brief_message', T], ['brief_audience', T], ['brief_hypothesis', T], ['brief_languages', T], ['brief_budget', T], ['brief_notes', T]]) addCol('campaigns', c, d);
for (const [c, d] of [['meta_targeting', T], ['meta_placements', "TEXT NOT NULL DEFAULT ''"], ['meta_synced_at', 'TEXT'], ['meta_source', "TEXT NOT NULL DEFAULT 'manuel'"],
  ['brief_audience', T], ['brief_placements', "TEXT NOT NULL DEFAULT '[]'"], ['brief_languages', T], ['brief_hypothesis', T]]) addCol('adsets', c, d);
for (const [c, d] of [['meta_synced_at', 'TEXT'], ['meta_source', "TEXT NOT NULL DEFAULT 'manuel'"], ['brief_angle', T]]) addCol('ads', c, d);
for (const [c, d] of [['variant_id', 'INTEGER'], ['variant_version', 'INTEGER'], ['body', T], ['asset_id', 'INTEGER']]) addCol('contents', c, d);
// anciennes valeurs -> nouveau vocabulaire ; anciens champs recopiés vers la configuration Meta / le brief interne
db.exec(`
UPDATE content_links SET state='brouillon' WHERE state='prévu';
UPDATE content_links SET state='approuvé' WHERE state='validé';
UPDATE campaigns SET meta_objective=objective, meta_start=starts, meta_end=ends, brief_message=brief, brief_audience=audience, brief_budget=budget_note WHERE meta_objective='' AND brief_message='' AND brief_audience='' AND brief_budget='' AND (objective<>'' OR starts<>'' OR ends<>'' OR brief<>'' OR audience<>'' OR budget_note<>'');
UPDATE adsets SET brief_audience=audience, brief_placements=placements, brief_languages=languages WHERE brief_audience='' AND brief_placements='[]' AND brief_languages='' AND (audience<>'' OR placements<>'[]' OR languages<>'');
`);

const now = () => new Date().toISOString();
const txt = (v, n = 300) => String(v ?? '').trim().slice(0, n);

export const META_STATUSES = ['inconnu', 'brouillon', 'active', 'en pause', 'terminée'];
export const CONTENT_STATUSES = ['brouillon', 'à relire', 'approuvé', 'archivé'];
// Vocabulaire explicite : EXPORTÉ (un fichier existe) ≠ TRANSMIS (envoyé à Meta) ≠ PUBLIÉ (diffusé dans Meta).
export const LINK_STATES = ['brouillon', 'à relire', 'approuvé', 'transmis', 'publié', 'erreur'];
export const OBJECTIVES = ['Notoriété', 'Trafic', 'Engagement', 'Prospects', 'Ventes / billetterie', 'Autre'];
export const isFrozenState = (s) => s === 'transmis' || s === 'publié'; // version diffusée : figée
const statusOf = (v) => (META_STATUSES.includes(v) ? v : 'inconnu');

// Statut Meta tel qu'on le connaît : provenance et date de synchronisation.
export const metaInfo = (row) => ({ status: row.meta_status, manual: row.meta_source !== 'meta', syncedAt: row.meta_synced_at || null });

// --- connexion Meta (manuelle tant que l'API n'est pas branchée)
export const getMetaLink = (pid) => db.prepare('SELECT * FROM meta_links WHERE project_id=?').get(pid) || { project_id: pid, mode: 'manuel', ad_account: '', page_name: '', instagram: '', note: '', synced_at: null };
export function saveMetaLink(pid, b) {
  db.prepare('INSERT INTO meta_links(project_id,mode,ad_account,page_name,instagram,note,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET ad_account=excluded.ad_account,page_name=excluded.page_name,instagram=excluded.instagram,note=excluded.note,updated=excluded.updated')
    .run(pid, 'manuel', txt(b.ad_account, 60), txt(b.page_name, 120), txt(b.instagram, 120), txt(b.note, 400), now());
}

// --- contenus
const fmtOf = (file) => { const m = /^(?:poster|video)-\d+-([a-z0-9]+)-/.exec(file || ''); return m && FORMATS[m[1]] ? m[1] : ''; };
export const listContents = (pid) => db.prepare('SELECT c.*, e.file, e.draft, e.created AS export_created FROM contents c LEFT JOIN exports e ON e.id=c.export_id WHERE c.project_id=? ORDER BY c.id DESC').all(pid);
export const getContent = (id) => db.prepare('SELECT c.*, e.file, e.draft FROM contents c LEFT JOIN exports e ON e.id=c.export_id WHERE c.id=?').get(id);
export function createContent(pid, b, who) {
  const e = b.export_id ? getExport(Number(b.export_id)) : null;
  if (e && e.edition_id !== pid) return { ok: false, error: 'Cet export n’appartient pas à ce projet.' };
  const kind = e ? (e.kind === 'video' ? 'video' : e.kind === 'pack' ? 'pack' : 'image') : 'texte';
  const title = txt(b.title, 140) || e?.label || '';
  if (!title) return { ok: false, error: 'Donnez un titre au contenu.' };
  const srcAsset = b.asset_id ? db.prepare('SELECT id FROM assets WHERE id=? AND edition_id=?').get(Number(b.asset_id), pid) : null;
  const r = db.prepare('INSERT INTO contents(project_id,kind,title,export_id,format,angle,audience,language,channel,status,notes,body,asset_id,created,created_by,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(pid, kind, title, e ? e.id : null, e ? fmtOf(e.file) : txt(b.format, 20), txt(b.angle, 140), txt(b.audience, 140), txt(b.language, 40), txt(b.channel, 40), 'à relire', txt(b.notes, 500), txt(b.body, 20000), srcAsset ? srcAsset.id : null, now(), who, now());
  log(who, `Contenu ajouté : ${title}`);
  return { ok: true, id: Number(r.lastInsertRowid) };
}
export function updateContent(id, b, who) {
  const c = getContent(id);
  if (!c) return;
  db.prepare('UPDATE contents SET title=?,angle=?,audience=?,language=?,channel=?,status=?,notes=?,body=?,updated=? WHERE id=?')
    .run(txt(b.title, 140) || c.title, txt(b.angle, 140), txt(b.audience, 140), txt(b.language, 40), txt(b.channel, 40), CONTENT_STATUSES.includes(b.status) ? b.status : c.status, txt(b.notes, 500), b.body === undefined ? c.body : txt(b.body, 20000), now(), id);
  log(who, `Contenu modifié : ${c.title}`);
}
// Nouvelle version d'un contenu : n'affecte AUCUNE association existante (elles restent épinglées sur leur export).
export function setContentExport(id, exportId, who, status = 'à relire') {
  const c = getContent(id), e = getExport(Number(exportId));
  if (!c || !e || e.edition_id !== c.project_id) return false;
  db.prepare('UPDATE contents SET export_id=?, format=?, status=?, updated=? WHERE id=?').run(e.id, fmtOf(e.file) || c.format, status, now(), id);
  log(who, `Contenu « ${c.title} » : nouvelle version (les associations existantes ne changent pas)`);
  return true;
}

// --- campagnes / ensembles / annonces
export const listCampaigns = (pid) => db.prepare('SELECT * FROM campaigns WHERE project_id=? ORDER BY id DESC').all(pid);
export const getCampaign = (id) => db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);
export const listAdsets = (cid) => db.prepare('SELECT * FROM adsets WHERE campaign_id=? ORDER BY id').all(cid).map((a) => ({ ...a, brief_placements: JSON.parse(a.brief_placements || '[]') }));
export const getAdset = (id) => { const a = db.prepare('SELECT * FROM adsets WHERE id=?').get(id); return a && { ...a, brief_placements: JSON.parse(a.brief_placements || '[]') }; };
export const listAds = (asid) => db.prepare('SELECT * FROM ads WHERE adset_id=? ORDER BY id').all(asid);

const metaCampFields = (b) => [txt(b.name, 140), txt(b.meta_id, 40), statusOf(b.meta_status), txt(b.meta_objective, 60), txt(b.meta_budget, 120), txt(b.meta_start, 10), txt(b.meta_end, 10)];
const briefCampFields = (b) => [txt(b.brief_objective, 140), txt(b.brief_message, 800), txt(b.brief_audience, 300), txt(b.brief_hypothesis, 500), txt(b.brief_languages, 80), txt(b.brief_budget, 120), txt(b.brief_notes, 500)];
export function createCampaign(pid, b, who) {
  const name = txt(b.name, 140);
  if (!name) return { ok: false, error: 'Indiquez le nom de la campagne (celui de Meta, idéalement).' };
  const r = db.prepare('INSERT INTO campaigns(project_id,name,meta_id,meta_status,meta_objective,meta_budget,meta_start,meta_end,brief_objective,brief_message,brief_audience,brief_hypothesis,brief_languages,brief_budget,brief_notes,meta_source,source,created,created_by,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(pid, ...metaCampFields(b), ...briefCampFields(b), 'manuel', 'manuel', now(), who, now());
  log(who, `Campagne reliée (association manuelle) : ${name}`);
  return { ok: true, id: Number(r.lastInsertRowid) };
}
// Deux formulaires distincts : la configuration Meta et le brief interne ne s'écrasent jamais.
export function updateCampaignMeta(id, b, who) {
  const c = getCampaign(id);
  if (!c) return;
  if (c.meta_source === 'meta') return; // champs synchronisés : en lecture seule (la synchronisation les met à jour)
  db.prepare('UPDATE campaigns SET name=?,meta_id=?,meta_status=?,meta_objective=?,meta_budget=?,meta_start=?,meta_end=?,updated=? WHERE id=?').run(...metaCampFields({ ...b, name: txt(b.name) || c.name }), now(), id);
  log(who, `Configuration Meta (saisie à la main) modifiée : ${c.name}`);
}
export function updateCampaignBrief(id, b, who) {
  const c = getCampaign(id);
  if (!c) return;
  db.prepare('UPDATE campaigns SET brief_objective=?,brief_message=?,brief_audience=?,brief_hypothesis=?,brief_languages=?,brief_budget=?,brief_notes=?,updated=? WHERE id=?').run(...briefCampFields(b), now(), id);
  log(who, `Brief interne modifié : ${c.name}`);
}
export function createAdset(cid, b, who) {
  const c = getCampaign(cid);
  if (!c) return { ok: false, error: 'Campagne introuvable.' };
  const name = txt(b.name, 140);
  if (!name) return { ok: false, error: 'Indiquez le nom de l’ensemble de publicités.' };
  const wanted = Object.keys(CHANNELS).filter((k) => b['pl_' + k]);
  db.prepare('INSERT INTO adsets(campaign_id,name,meta_id,meta_status,meta_targeting,brief_audience,brief_placements,brief_languages,brief_hypothesis,landing,notes,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(cid, name, txt(b.meta_id, 40), statusOf(b.meta_status), txt(b.meta_targeting, 300), txt(b.brief_audience, 300), JSON.stringify(wanted), txt(b.brief_languages, 80), txt(b.brief_hypothesis, 400), txt(b.landing, 300), txt(b.notes, 300), now());
  log(who, `Ensemble relié : ${name}`);
  return { ok: true };
}
export function updateAdsetMeta(id, b, who) {
  const a = getAdset(id);
  if (!a || a.meta_source === 'meta') return;
  db.prepare('UPDATE adsets SET name=?,meta_id=?,meta_status=?,meta_targeting=? WHERE id=?').run(txt(b.name, 140) || a.name, txt(b.meta_id, 40), statusOf(b.meta_status), txt(b.meta_targeting, 300), id);
  log(who, `Ensemble : configuration Meta (saisie à la main) modifiée : ${a.name}`);
}
export function updateAdsetBrief(id, b, who) {
  const a = getAdset(id);
  if (!a) return;
  const wanted = Object.keys(CHANNELS).filter((k) => b['pl_' + k]);
  db.prepare('UPDATE adsets SET brief_audience=?,brief_placements=?,brief_languages=?,brief_hypothesis=?,landing=? WHERE id=?').run(txt(b.brief_audience, 300), JSON.stringify(wanted), txt(b.brief_languages, 80), txt(b.brief_hypothesis, 400), txt(b.landing, 300), id);
  log(who, `Ensemble : brief interne modifié : ${a.name}`);
}
export function createAd(asid, b, who) {
  if (!getAdset(asid)) return { ok: false, error: 'Ensemble introuvable.' };
  const name = txt(b.name, 140);
  if (!name) return { ok: false, error: 'Indiquez le nom de l’annonce.' };
  db.prepare('INSERT INTO ads(adset_id,name,meta_id,meta_status,brief_angle,landing,notes,created) VALUES(?,?,?,?,?,?,?,?)').run(asid, name, txt(b.meta_id, 40), statusOf(b.meta_status), txt(b.brief_angle, 140), txt(b.landing, 300), txt(b.notes, 300), now());
  log(who, `Annonce reliée : ${name}`);
  return { ok: true };
}

// --- associations contenu ↔ niveau
const levelOf = (l) => (l.ad_id ? 'ad' : l.adset_id ? 'adset' : 'campaign');
function targetOf(l) {
  if (l.ad_id) { const a = db.prepare('SELECT a.*, s.campaign_id FROM ads a JOIN adsets s ON s.id=a.adset_id WHERE a.id=?').get(l.ad_id); return a && { level: 'annonce', name: a.name, meta_id: a.meta_id, meta: metaInfo(a), campaign_id: a.campaign_id }; }
  if (l.adset_id) { const a = db.prepare('SELECT * FROM adsets WHERE id=?').get(l.adset_id); return a && { level: 'ensemble', name: a.name, meta_id: a.meta_id, meta: metaInfo(a), campaign_id: a.campaign_id }; }
  const c = getCampaign(l.campaign_id);
  return c && { level: 'campagne', name: c.name, meta_id: c.meta_id, meta: metaInfo(c), campaign_id: c.id };
}
export const campaignIdOfLink = (l) => targetOf(l)?.campaign_id || null;
export function linkContent(contentId, target, who) { // target : { campaign_id } | { adset_id } | { ad_id }
  const c = getContent(contentId);
  // Un contenu texte (concept, script, légende) s'associe sans fichier ; un visuel ou une vidéo exige son export.
  if (!c || (!c.export_id && c.kind !== 'texte')) return { ok: false, error: 'Ce contenu n’a pas encore de fichier (export) à associer.' };
  const t = { campaign_id: Number(target.campaign_id) || null, adset_id: Number(target.adset_id) || null, ad_id: Number(target.ad_id) || null };
  if ([t.campaign_id, t.adset_id, t.ad_id].filter(Boolean).length !== 1) return { ok: false, error: 'Une association vise un seul niveau : campagne, ensemble OU annonce.' };
  if (!targetOf(t)) return { ok: false, error: 'Niveau introuvable.' };
  if (db.prepare('SELECT 1 FROM content_links WHERE content_id=? AND campaign_id IS ? AND adset_id IS ? AND ad_id IS ? AND export_id IS ?').get(contentId, t.campaign_id, t.adset_id, t.ad_id, c.export_id)) return { ok: false, error: 'Déjà associé à ce niveau (même version).' };
  // Associer reste possible même si le niveau est actif dans Meta : on prépare une variante en BROUILLON, sans rien toucher à la diffusion.
  db.prepare('INSERT INTO content_links(content_id,campaign_id,adset_id,ad_id,export_id,state,linked_at,linked_by) VALUES(?,?,?,?,?,?,?,?)').run(contentId, t.campaign_id, t.adset_id, t.ad_id, c.export_id || null, 'brouillon', now(), who);
  log(who, `Contenu « ${c.title} » associé (${levelOf(t)}) en brouillon — version épinglée`);
  return { ok: true };
}

// Récapitulatif obligatoire avant « transmis » / « publié ». Le hachage empêche de confirmer un récapitulatif périmé.
export function transitionRecap(linkId, toState) {
  const l = db.prepare('SELECT * FROM content_links WHERE id=?').get(linkId);
  if (!l || !LINK_STATES.includes(toState)) return null;
  const c = getContent(l.content_id), e = l.export_id ? getExport(l.export_id) : null, tg = targetOf(l);
  const errors = [], warnings = [];
  if (isFrozenState(l.state) && toState !== 'publié' && toState !== 'erreur') errors.push(`Cette association est déjà « ${l.state} » : version diffusée, figée.`);
  if (l.state === 'publié') errors.push('Cette association est déjà publiée : elle ne change plus depuis l’atelier.');
  if (['approuvé', 'transmis', 'publié'].includes(toState)) {
    if (!c || c.status !== 'approuvé') errors.push('Le contenu doit d’abord être approuvé (page du contenu, étape Vérification).');
    if (e && e.draft) errors.push('Cette version est marquée BROUILLON (fiche non prête ou source provisoire) : refaites un export une fois la fiche prête.');
  }
  if (toState === 'transmis' && l.state !== 'approuvé') errors.push('Une association doit être « approuvée » avant d’être transmise.');
  if (toState === 'publié' && l.state !== 'transmis') errors.push('Une association doit être « transmise » avant d’être marquée publiée.');
  if (tg?.meta.status === 'active') warnings.push('Ce niveau est ACTIF dans Meta (statut saisi à la main) : vérifiez que vous ne remplacez pas une publicité en cours.');
  if (['transmis', 'publié'].includes(toState)) warnings.push('Aucune connexion à Meta : l’atelier n’envoie rien. Ce changement est une déclaration manuelle de ce qui a été fait dans Ads Manager.');
  const recap = {
    de: l.state, vers: toState, contenu: c?.title, format: c?.format, version_export: l.export_id, fichier: e?.file, version_du: e?.created,
    niveau: tg?.level, cible: tg?.name, id_meta: tg?.meta_id || '(non renseigné)', statut_meta: `${tg?.meta.status} — ${tg?.meta.manual ? 'saisi à la main' : 'synchronisé le ' + tg?.meta.syncedAt}`,
  };
  return { link: l, recap, errors, warnings, hash: createHash('sha1').update(JSON.stringify(recap)).digest('hex').slice(0, 12) };
}
export function setLinkState(linkId, state, who, confirmHash) {
  const r = transitionRecap(linkId, state);
  if (!r) return { ok: false, error: 'Association introuvable.' };
  const needsConfirm = ['transmis', 'publié'].includes(state);
  if (r.errors.length && state !== r.link.state) return { ok: false, error: r.errors[0] };
  if (needsConfirm && confirmHash !== r.hash) return { ok: false, error: 'Confirmation manquante ou périmée : relisez le récapitulatif.', needsRecap: true };
  if (isFrozenState(r.link.state) && !['publié', 'erreur'].includes(state)) return { ok: false, error: 'Version diffusée : association figée.' };
  db.prepare('UPDATE content_links SET state=?, transmitted_at=CASE WHEN ?=\'transmis\' THEN ? ELSE transmitted_at END WHERE id=?').run(state, state, now(), linkId);
  log(who, `Association ${linkId} : ${r.link.state} → ${state}${needsConfirm ? ' (déclaration manuelle confirmée : rien n’a été envoyé à Meta par l’atelier)' : ''}`);
  return { ok: true };
}
export function unlink(linkId, who) {
  const l = db.prepare('SELECT * FROM content_links WHERE id=?').get(linkId);
  if (!l) return { ok: false };
  if (isFrozenState(l.state)) return { ok: false, error: 'Version diffusée (transmise ou publiée) : l’association ne se retire pas depuis l’atelier.' };
  db.prepare('DELETE FROM content_links WHERE id=?').run(linkId);
  log(who, `Association retirée (${linkId})`);
  return { ok: true };
}
export const getLink = (id) => db.prepare('SELECT * FROM content_links WHERE id=?').get(id);
export const linksFor = (where, id) => db.prepare(`SELECT l.*, c.title, c.kind, c.format, c.angle, c.audience, c.language, c.status AS cstatus, c.export_id AS current_export, c.variant_id, e.file, e.draft
  FROM content_links l JOIN contents c ON c.id=l.content_id LEFT JOIN exports e ON e.id=l.export_id WHERE l.${where}=? ORDER BY l.id DESC`).all(id);
export const linksOfContent = (cid) => db.prepare(`SELECT l.*, ca.name AS campaign_name, s.name AS adset_name, a.name AS ad_name FROM content_links l
  LEFT JOIN campaigns ca ON ca.id=l.campaign_id LEFT JOIN adsets s ON s.id=l.adset_id LEFT JOIN ads a ON a.id=l.ad_id WHERE l.content_id=? ORDER BY l.id DESC`).all(cid);
export const allLinksOfCampaign = (cid) => db.prepare(`SELECT l.*, c.title, c.format, c.angle, c.audience, c.language FROM content_links l JOIN contents c ON c.id=l.content_id
  WHERE l.campaign_id=? OR l.adset_id IN (SELECT id FROM adsets WHERE campaign_id=?) OR l.ad_id IN (SELECT a.id FROM ads a JOIN adsets s ON s.id=a.adset_id WHERE s.campaign_id=?)`).all(cid, cid, cid);

// Couverture de production d'un ensemble : formats nécessaires selon les placements SOUHAITÉS (brief), et ceux déjà couverts.
export function coverage(adset, links) {
  const need = formatsForChannels(adset.brief_placements);
  const have = new Set(links.map((l) => l.format).filter(Boolean));
  return { need, have: need.filter((f) => have.has(f)), missing: need.filter((f) => !have.has(f)) };
}

// --- résultats saisis à la main (l'API Meta pourra les alimenter plus tard) + comparaison
export function addResult(linkId, b, who) {
  if (!db.prepare('SELECT 1 FROM content_links WHERE id=?').get(linkId)) return false;
  const n = (v) => Math.max(0, Number(String(v).replace(',', '.')) || 0);
  db.prepare('INSERT INTO results(link_id,period,impressions,clicks,spend,conversions,source,entered_by,entered_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(linkId, txt(b.period, 60), Math.round(n(b.impressions)), Math.round(n(b.clicks)), n(b.spend), Math.round(n(b.conversions)), 'manuel', who, now());
  log(who, `Résultats saisis à la main (association ${linkId})`);
  return true;
}
export function compare(campaignId) {
  const rows = db.prepare(`SELECT c.title, c.angle, c.audience, c.language, c.format, SUM(r.impressions) imp, SUM(r.clicks) clk, SUM(r.spend) spend, SUM(r.conversions) conv, COUNT(r.id) n
    FROM results r JOIN content_links l ON l.id=r.link_id JOIN contents c ON c.id=l.content_id
    WHERE l.campaign_id=? OR l.adset_id IN (SELECT id FROM adsets WHERE campaign_id=?) OR l.ad_id IN (SELECT a.id FROM ads a JOIN adsets s ON s.id=a.adset_id WHERE s.campaign_id=?)
    GROUP BY c.id`).all(campaignId, campaignId, campaignId);
  return rows.map((r) => ({ ...r, ctr: r.imp ? r.clk / r.imp : null, cpc: r.clk ? r.spend / r.clk : null, cpa: r.conv ? r.spend / r.conv : null }));
}

// Lien suivi (UTM) pour une annonce : base = page de destination choisie, sinon URL de réservation de la fiche.
export function trackedUrl(base, { channel = 'meta', campaign = '', content = '' }) {
  if (!base) return '';
  const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    const u = new URL(base);
    u.searchParams.set('utm_source', channel); u.searchParams.set('utm_medium', 'paid_social');
    if (campaign) u.searchParams.set('utm_campaign', slug(campaign));
    if (content) u.searchParams.set('utm_content', slug(content));
    return u.toString();
  } catch { return ''; }
}
export { listExports };
