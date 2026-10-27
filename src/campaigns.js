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
CREATE TABLE IF NOT EXISTS text_versions(id INTEGER PRIMARY KEY, content_id INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS results(id INTEGER PRIMARY KEY, link_id INTEGER NOT NULL, period TEXT NOT NULL DEFAULT '', impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, spend REAL NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'manuel', entered_by TEXT NOT NULL, entered_at TEXT NOT NULL);
`);

// --- migrations (idempotentes : on ajoute les colonnes manquantes, on ne supprime rien)
function addCol(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
const T = "TEXT NOT NULL DEFAULT ''";
for (const [c, d] of [['meta_objective', T], ['meta_budget', T], ['meta_start', T], ['meta_end', T], ['meta_synced_at', 'TEXT'], ['meta_source', "TEXT NOT NULL DEFAULT 'manuel'"],
  ['brief_objective', T], ['brief_message', T], ['brief_audience', T], ['brief_hypothesis', T], ['brief_languages', T], ['brief_budget', T], ['brief_notes', T],
  ['brief_start', T], ['brief_end', T], ['brief_milestone', T], ['brief_milestone_date', T]]) addCol('campaigns', c, d);
for (const [c, d] of [['meta_targeting', T], ['meta_placements', "TEXT NOT NULL DEFAULT ''"], ['meta_synced_at', 'TEXT'], ['meta_source', "TEXT NOT NULL DEFAULT 'manuel'"],
  ['brief_audience', T], ['brief_placements', "TEXT NOT NULL DEFAULT '[]'"], ['brief_languages', T], ['brief_hypothesis', T]]) addCol('adsets', c, d);
for (const [c, d] of [['meta_synced_at', 'TEXT'], ['meta_source', "TEXT NOT NULL DEFAULT 'manuel'"], ['brief_angle', T], ['copy_primary', T], ['copy_headline', T], ['copy_description', T], ['cta', T]]) addCol('ads', c, d);
addCol('content_links', 'text_version_id', 'INTEGER');
// Grille de messages (angles d'une campagne) et audiences nommées du projet : listes de référence qui PRÉREMPLISSENT
// les variantes et les annonces (jamais d'écrasement d'un texte déjà saisi ; les colonnes texte existantes restent la vérité).
db.exec(`CREATE TABLE IF NOT EXISTS campaign_angles(id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', tagline TEXT NOT NULL DEFAULT '', cta TEXT NOT NULL DEFAULT '',
  copy_primary TEXT NOT NULL DEFAULT '', copy_headline TEXT NOT NULL DEFAULT '', copy_description TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audiences(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);`);
for (const [c, d] of [['superseded_by', 'INTEGER'], ['period_from', T], ['period_to', T], ['currency', T], ['result_type', T], ['clicks_kind', T], ['missing', T]]) addCol('results', c, d);
for (const [c, d] of [['variant_id', 'INTEGER'], ['variant_version', 'INTEGER'], ['body', T], ['asset_id', 'INTEGER']]) addCol('contents', c, d);
// texte de publicité : titre et description en plus du texte principal (body), figés avec lui dans chaque version
for (const c of ['ad_headline', 'ad_description']) addCol('contents', c, T);
for (const c of ['headline', 'description']) addCol('text_versions', c, T);
// anciennes valeurs -> nouveau vocabulaire ; anciens champs recopiés vers la configuration Meta / le brief interne
db.exec(`
UPDATE content_links SET state='brouillon' WHERE state='prévu';
UPDATE content_links SET state='approuvé' WHERE state='validé';
UPDATE campaigns SET meta_objective=objective, meta_start=starts, meta_end=ends, brief_message=brief, brief_audience=audience, brief_budget=budget_note WHERE meta_objective='' AND brief_message='' AND brief_audience='' AND brief_budget='' AND (objective<>'' OR starts<>'' OR ends<>'' OR brief<>'' OR audience<>'' OR budget_note<>'');
UPDATE adsets SET brief_audience=audience, brief_placements=placements, brief_languages=languages WHERE brief_audience='' AND brief_placements='[]' AND brief_languages='' AND (audience<>'' OR placements<>'[]' OR languages<>'');
`);

const now = () => new Date().toISOString();
const txt = (v, n = 300) => String(v ?? '').trim().slice(0, n);

export const OFF_CAMPAIGN = 'Hors campagne'; // reçoit les contenus créés sans campagne (organique, site…)
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
  db.prepare('UPDATE contents SET title=?,angle=?,audience=?,language=?,channel=?,status=?,notes=?,body=?,ad_headline=?,ad_description=?,updated=? WHERE id=?')
    .run(txt(b.title, 140) || c.title, txt(b.angle, 140), txt(b.audience, 140), txt(b.language, 40), txt(b.channel, 40), CONTENT_STATUSES.includes(b.status) ? b.status : c.status, txt(b.notes, 500), b.body === undefined ? c.body : txt(b.body, 20000),
      b.ad_headline === undefined ? c.ad_headline : txt(b.ad_headline, 200), b.ad_description === undefined ? c.ad_description : txt(b.ad_description, 200), now(), id);
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
// Période visée et jalon commercial : nos dates (≠ dates configurées dans Meta) ; elles servent au calendrier.
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) ? v : '');
const briefCampFields = (b) => [txt(b.brief_objective, 140), txt(b.brief_message, 800), txt(b.brief_audience, 300), txt(b.brief_hypothesis, 500), txt(b.brief_languages, 80), txt(b.brief_budget, 120), txt(b.brief_notes, 500),
  day(b.brief_start), day(b.brief_end), txt(b.brief_milestone, 140), day(b.brief_milestone_date)];
const BRIEF_COLS = 'brief_objective,brief_message,brief_audience,brief_hypothesis,brief_languages,brief_budget,brief_notes,brief_start,brief_end,brief_milestone,brief_milestone_date';
export function createCampaign(pid, b, who) {
  const name = txt(b.name, 140);
  if (!name) return { ok: false, error: 'Indiquez le nom de la campagne (celui de Meta, idéalement).' };
  const r = db.prepare(`INSERT INTO campaigns(project_id,name,meta_id,meta_status,meta_objective,meta_budget,meta_start,meta_end,${BRIEF_COLS},meta_source,source,created,created_by,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(pid, ...metaCampFields(b), ...briefCampFields(b), 'manuel', 'manuel', now(), who, now());
  log(who, `Campagne reliée (association manuelle) : ${name}`);
  return { ok: true, id: Number(r.lastInsertRowid) };
}
// La campagne « Hors campagne » du projet (créée au premier besoin) : tout contenu appartient ainsi à une campagne.
export function ensureOffCampaign(pid, who) {
  const ex = db.prepare('SELECT id FROM campaigns WHERE project_id=? AND name=?').get(pid, OFF_CAMPAIGN);
  if (ex) return ex.id;
  return createCampaign(pid, { name: OFF_CAMPAIGN, brief_objective: 'Publications organiques et visuels du site', meta_status: 'inconnu' }, who).id;
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
  if (!c) return { ok: false, error: 'Campagne introuvable.' };
  const f = briefCampFields(b);
  if (f[7] && f[8] && f[8] < f[7]) return { ok: false, error: 'La fin de la période visée est avant son début.' };
  db.prepare(`UPDATE campaigns SET ${BRIEF_COLS.split(',').map((k) => k + '=?').join(',')},updated=? WHERE id=?`).run(...f, now(), id);
  log(who, `Brief interne modifié : ${c.name}`);
  return { ok: true };
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
  const s = getAdset(asid);
  if (!s) return { ok: false, error: 'Ensemble introuvable.' };
  const name = txt(b.name, 140);
  if (!name) return { ok: false, error: 'Indiquez le nom de l’annonce.' };
  const ang = angleByName(s.campaign_id, b.brief_angle); // textes de l'angle repris pour les champs laissés vides
  if (ang) b = { ...b, copy_primary: txt(b.copy_primary) || ang.copy_primary, copy_headline: txt(b.copy_headline) || ang.copy_headline, copy_description: txt(b.copy_description) || ang.copy_description, cta: txt(b.cta) || ang.cta };
  db.prepare('INSERT INTO ads(adset_id,name,meta_id,meta_status,brief_angle,landing,notes,copy_primary,copy_headline,copy_description,cta,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(asid, name, txt(b.meta_id, 40), statusOf(b.meta_status), txt(b.brief_angle, 140), txt(b.landing, 300), txt(b.notes, 300), txt(b.copy_primary, 600), txt(b.copy_headline, 200), txt(b.copy_description, 200), txt(b.cta, 60), now());
  log(who, `Annonce reliée : ${name}`);
  return { ok: true };
}

export const getAd = (id) => db.prepare('SELECT a.*, s.campaign_id FROM ads a JOIN adsets s ON s.id=a.adset_id WHERE a.id=?').get(id);
// Textes de la publicité (ce qu'on saisira dans Ads Manager) et identifiant Meta une fois la publicité créée là-bas.
export function updateAdCopy(id, b, who) {
  const a = getAd(id);
  if (!a) return false;
  db.prepare('UPDATE ads SET name=?, copy_primary=?, copy_headline=?, copy_description=?, cta=?, meta_id=?, landing=? WHERE id=?')
    .run(txt(b.name, 140) || a.name, txt(b.copy_primary, 600), txt(b.copy_headline, 200), txt(b.copy_description, 200), txt(b.cta, 60), b.meta_id === undefined ? a.meta_id : txt(b.meta_id, 40), b.landing === undefined ? a.landing : txt(b.landing, 300), id);
  log(who, `Annonce « ${a.name} » : textes et références enregistrés`);
  return true;
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
// Version figée d'un texte : une association y est épinglée (comme un visuel l'est sur son export). Un texte identique réutilise la même version.
export const getTextVersion = (id) => (id ? db.prepare('SELECT * FROM text_versions WHERE id=?').get(id) : null);
function snapshotText(c, who) {
  const body = String(c.body || '');
  const h = c.ad_headline || '', ds = c.ad_description || '';
  const same = db.prepare('SELECT id FROM text_versions WHERE content_id=? AND body=? AND title=? AND language=? AND headline=? AND description=? ORDER BY id DESC').get(c.id, body, c.title, c.language || '', h, ds);
  if (same) return same.id;
  return Number(db.prepare('INSERT INTO text_versions(content_id,title,body,language,headline,description,created,created_by) VALUES(?,?,?,?,?,?,?,?)').run(c.id, c.title, body, c.language || '', h, ds, now(), who || '').lastInsertRowid);
}
export const textVersionsOf = (contentId) => db.prepare('SELECT * FROM text_versions WHERE content_id=? ORDER BY id DESC').all(contentId);
// Le texte réellement associé : la version figée ; `historical` = association antérieure aux versions (l'original n'est pas garanti).
export function linkedText(l) {
  const c = getContent(l.content_id);
  if (!c || c.kind !== 'texte') return null;
  const v = getTextVersion(l.text_version_id);
  return v ? { ...v, historical: false, current: v.body === c.body && v.title === c.title && v.headline === (c.ad_headline || '') && v.description === (c.ad_description || '') } : { id: null, body: c.body, title: c.title, language: c.language, historical: true, current: true };
}
export function linkContent(contentId, target, who) { // target : { campaign_id } | { adset_id } | { ad_id }
  const c = getContent(contentId);
  // Un contenu texte (concept, script, légende) s'associe sans fichier ; un visuel ou une vidéo exige son export.
  if (!c || (!c.export_id && c.kind !== 'texte')) return { ok: false, error: 'Ce contenu n’a pas encore de fichier (export) à associer.' };
  const t = { campaign_id: Number(target.campaign_id) || null, adset_id: Number(target.adset_id) || null, ad_id: Number(target.ad_id) || null };
  if ([t.campaign_id, t.adset_id, t.ad_id].filter(Boolean).length !== 1) return { ok: false, error: 'Une association vise un seul niveau : campagne, ensemble OU annonce.' };
  if (!targetOf(t)) return { ok: false, error: 'Niveau introuvable.' };
  const tv = c.kind === 'texte' ? snapshotText(c, who) : null;
  if (db.prepare('SELECT 1 FROM content_links WHERE content_id=? AND campaign_id IS ? AND adset_id IS ? AND ad_id IS ? AND export_id IS ? AND text_version_id IS ?').get(contentId, t.campaign_id, t.adset_id, t.ad_id, c.export_id, tv)) return { ok: false, error: 'Déjà associé à ce niveau (même version).' };
  // Associer reste possible même si le niveau est actif dans Meta : on prépare une variante en BROUILLON, sans rien toucher à la diffusion.
  db.prepare('INSERT INTO content_links(content_id,campaign_id,adset_id,ad_id,export_id,text_version_id,state,linked_at,linked_by) VALUES(?,?,?,?,?,?,?,?,?)').run(contentId, t.campaign_id, t.adset_id, t.ad_id, c.export_id || null, tv, 'brouillon', now(), who);
  log(who, `Contenu « ${c.title} » associé (${levelOf(t)}) en brouillon — version épinglée`);
  return { ok: true };
}

// Récapitulatif obligatoire avant « transmis » / « publié ». Le hachage empêche de confirmer un récapitulatif périmé.
export function transitionRecap(linkId, toState) {
  const l = db.prepare('SELECT * FROM content_links WHERE id=?').get(linkId);
  if (!l || !LINK_STATES.includes(toState)) return null;
  const c = getContent(l.content_id), e = l.export_id ? getExport(l.export_id) : null, tg = targetOf(l);
  const errors = [], warnings = [], tx = c?.kind === 'texte' ? linkedText(l) : null;
  // tant qu'une association de texte est en préparation, elle suit le texte actuel (re-épinglée à l'approbation) ; ensuite seulement, elle est figée
  const follows = tx && ['brouillon', 'à relire'].includes(l.state) && toState === 'approuvé';
  if (tx && !follows && !tx.historical && !tx.current && ['approuvé', 'transmis'].includes(toState)) errors.push('Le texte a été modifié depuis cette association : associez la version actuelle (l’ancienne reste telle quelle).');
  if (tx?.historical) warnings.push('Association antérieure aux versions de texte : l’original n’est pas garanti, le texte affiché est le texte actuel.');
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
    de: l.state, vers: toState, contenu: c?.title, format: c?.format, version_export: l.export_id, fichier: e?.file, version_du: e?.created, version_texte: tx ? (tx.historical ? 'historique non garantie' : `v${tx.id}`) : undefined, empreinte_texte: tx ? createHash('sha1').update(`${tx.title}
${tx.body}${tx.headline || tx.description ? `
${tx.headline}
${tx.description}` : ''}`).digest('hex').slice(0, 10) : undefined,
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
  const c = getContent(r.link.content_id);
  if (state === 'approuvé' && c?.kind === 'texte' && ['brouillon', 'à relire'].includes(r.link.state)) db.prepare('UPDATE content_links SET text_version_id=? WHERE id=?').run(snapshotText(c, who), linkId); // épinglé sur le texte approuvé
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
export const allLinksOfCampaign = (cid) => db.prepare(`SELECT l.*, c.title, c.kind, c.format, c.angle, c.audience, c.language, c.variant_id FROM content_links l JOIN contents c ON c.id=l.content_id
  WHERE l.campaign_id=? OR l.adset_id IN (SELECT id FROM adsets WHERE campaign_id=?) OR l.ad_id IN (SELECT a.id FROM ads a JOIN adsets s ON s.id=a.adset_id WHERE s.campaign_id=?)`).all(cid, cid, cid);

// Couverture de production d'un ensemble : formats nécessaires selon les placements SOUHAITÉS (brief), et ceux déjà couverts.
export function coverage(adset, links) {
  const need = formatsForChannels(adset.brief_placements);
  const have = new Set(links.map((l) => l.format).filter(Boolean));
  return { need, have: need.filter((f) => have.has(f)), missing: need.filter((f) => !have.has(f)) };
}

// --- résultats saisis à la main (l'API Meta pourra les alimenter plus tard) + comparaison
// Date de rapport -> AAAA-MM-JJ (ISO, ou JJ/MM/AAAA à la française) ; vide si illisible.
export function parseDay(s) {
  const v = String(s || '').trim(); let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v))) return m[0];
  if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(v))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
// Période d'un résultat : colonnes datées, sinon lue dans le texte « a → b » des anciens enregistrements.
export function rangeOf(r) {
  let from = r.period_from || '', to = r.period_to || '';
  if (!from && r.period) { const p = String(r.period).split('→').map((x) => parseDay(x)); from = p[0] || ''; to = p[1] || p[0] || ''; }
  return from ? { from, to: to || from } : null;
}
export const overlaps = (a, b) => !!a && !!b && a.from <= b.to && b.from <= a.to;
// Résultats déjà enregistrés pour cette association dont la période croise celle-ci (hors mesures mises de côté).
export function conflictsFor(linkId, range) {
  if (!range) return [];
  return db.prepare('SELECT * FROM results WHERE link_id=? AND superseded_by IS NULL').all(linkId).filter((x) => overlaps(rangeOf(x), range))
    .map((x) => ({ id: x.id, period: x.period, impressions: x.impressions, clicks: x.clicks, spend: x.spend, conversions: x.conversions, same: rangeOf(x).from === range.from && rangeOf(x).to === range.to }));
}
export function addResult(linkId, b, who) {
  if (!db.prepare('SELECT 1 FROM content_links WHERE id=?').get(linkId)) return false;
  const n = (v) => Math.max(0, Number(String(v).replace(',', '.')) || 0);
  const from = parseDay(b.period_from), to = parseDay(b.period_to) || from;
  const r = db.prepare('INSERT INTO results(link_id,period,impressions,clicks,spend,conversions,source,entered_by,entered_at,period_from,period_to,currency,result_type,clicks_kind,missing) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(linkId, txt(b.period || [b.period_from, b.period_to].filter(Boolean).join(' → '), 60), Math.round(n(b.impressions)), Math.round(n(b.clicks)), n(b.spend), Math.round(n(b.conversions)), b.source === 'import' ? 'import' : 'manuel', who, now(),
      b.from || from, b.to || to, txt(b.currency, 8), txt(b.result_type, 60), txt(b.clicks_kind, 10), txt(b.missing, 80));
  log(who, b.source === 'import' ? `Résultats importés du rapport Ads Manager (association ${linkId})` : `Résultats saisis à la main (association ${linkId})`);
  return Number(r.lastInsertRowid);
}
// Une mesure remplacée n'est jamais supprimée : elle est mise de côté (réversible) et sort des totaux.
export function supersedeResult(oldId, newId, who) {
  db.prepare('UPDATE results SET superseded_by=? WHERE id=? AND superseded_by IS NULL').run(newId, oldId);
  log(who, `Résultat ${oldId} remplacé par ${newId} (mesure précédente conservée, hors totaux)`);
}
export function restoreResult(id, who) {
  db.prepare('UPDATE results SET superseded_by=NULL WHERE id=?').run(id);
  log(who, `Résultat ${id} rétabli dans les totaux`);
}
// Mesures déjà enregistrées dont les périodes se croisent pour une même association (anciens imports) : à réconcilier, jamais supprimées automatiquement.
export function resultConflicts(campaignId) {
  const out = [];
  for (const l of allLinksOfCampaign(campaignId)) {
    const rs = db.prepare('SELECT * FROM results WHERE link_id=? AND superseded_by IS NULL ORDER BY id').all(l.id);
    for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) if (overlaps(rangeOf(rs[a]), rangeOf(rs[b]))) out.push({ link: l, a: rs[a], b: rs[b] });
  }
  return out;
}
export function compare(campaignId) {
  const rows = db.prepare(`SELECT c.title, c.angle, c.audience, c.language, c.format, SUM(r.impressions) imp, SUM(r.clicks) clk, SUM(r.spend) spend, SUM(r.conversions) conv, COUNT(r.id) n, COUNT(DISTINCT NULLIF(r.currency,'')) ncur, COUNT(DISTINCT NULLIF(r.result_type,'')) ntype, MAX(r.currency) currency, MAX(r.result_type) result_type, SUM(r.missing<>'') nmissing
    FROM results r JOIN content_links l ON l.id=r.link_id JOIN contents c ON c.id=l.content_id
    WHERE r.superseded_by IS NULL AND (l.campaign_id=? OR l.adset_id IN (SELECT id FROM adsets WHERE campaign_id=?) OR l.ad_id IN (SELECT a.id FROM ads a JOIN adsets s ON s.id=a.adset_id WHERE s.campaign_id=?))
    GROUP BY c.id`).all(campaignId, campaignId, campaignId);
  // Devises ou types de résultat différents : pas de coût unitaire calculé (additionner des mesures incompatibles serait faux).
  return rows.map((r) => ({ ...r, mixedCurrency: r.ncur > 1, mixedType: r.ntype > 1, ctr: r.imp ? r.clk / r.imp : null, cpc: r.clk && r.ncur <= 1 ? r.spend / r.clk : null, cpa: r.conv && r.ncur <= 1 && r.ntype <= 1 ? r.spend / r.conv : null }));
}

// Lien suivi (UTM) pour une annonce : base = page de destination choisie, sinon URL de réservation de la fiche.
// --- grille de messages : 1 à MAX_ANGLES angles par campagne ; un angle = un nom (repris tel quel comme « angle » des
// variantes et des annonces, donc comparable dans les résultats) + les textes de l'affiche et de la publicité.
export const MAX_ANGLES = 4;
const ANGLE_COLS = ['name', 'title', 'tagline', 'cta', 'copy_primary', 'copy_headline', 'copy_description'];
const angleFields = (b) => [txt(b.name, 140), txt(b.title, 200), txt(b.tagline, 200), txt(b.cta, 60), txt(b.copy_primary, 600), txt(b.copy_headline, 200), txt(b.copy_description, 200)];
export const listAngles = (cid) => db.prepare('SELECT * FROM campaign_angles WHERE campaign_id=? ORDER BY id').all(cid);
export const getAngle = (id) => db.prepare('SELECT * FROM campaign_angles WHERE id=?').get(id);
const key = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const angleByName = (cid, name) => (key(name) ? listAngles(cid).find((a) => key(a.name) === key(name)) : undefined);
export function saveAngle(cid, b, who) {
  const f = angleFields(b);
  if (!f[0]) return { ok: false, error: 'Donnez un nom à l’angle (ex. « nuit au temple »).' };
  const id = Number(b.angle_id) || 0, list = listAngles(cid);
  if (list.some((a) => a.id !== id && key(a.name) === key(f[0]))) return { ok: false, error: `L’angle « ${f[0]} » existe déjà dans cette campagne.` };
  if (id) {
    if (!list.some((a) => a.id === id)) return { ok: false, error: 'Angle introuvable.' };
    db.prepare(`UPDATE campaign_angles SET ${ANGLE_COLS.map((k) => k + '=?').join(',')} WHERE id=?`).run(...f, id);
  } else {
    if (list.length >= MAX_ANGLES) return { ok: false, error: `${MAX_ANGLES} angles au plus par campagne : au-delà, les résultats d’un petit budget ne sont plus comparables.` };
    db.prepare(`INSERT INTO campaign_angles(campaign_id,${ANGLE_COLS.join(',')},created) VALUES(?,?,?,?,?,?,?,?,?)`).run(cid, ...f, now());
  }
  log(who, `Grille de messages : angle « ${f[0]} » enregistré`);
  return { ok: true };
}
export const removeAngle = (id, who) => { const a = getAngle(id); if (a) { db.prepare('DELETE FROM campaign_angles WHERE id=?').run(id); log(who, `Grille de messages : angle « ${a.name} » retiré`); } };
// Préremplit un formulaire de variante depuis un angle (champs vides seulement).
export function withAngle(b) {
  const a = getAngle(Number(b.angle_id));
  if (!a) return b;
  return { ...b, angle: txt(b.angle) || a.name, msg_title: txt(b.msg_title) || a.title, msg_tagline: txt(b.msg_tagline) || a.tagline, msg_cta: txt(b.msg_cta) || a.cta };
}

// --- audiences nommées du projet : proposées partout où l'on saisit une audience (le champ reste libre).
export const listAudiences = (pid) => db.prepare('SELECT * FROM audiences WHERE project_id=? ORDER BY name').all(pid);
export function saveAudience(pid, b, who) {
  const name = txt(b.name, 140);
  if (!name) return { ok: false, error: 'Donnez un nom court à l’audience.' };
  const id = Number(b.audience_id) || 0;
  if (listAudiences(pid).some((a) => a.id !== id && key(a.name) === key(name))) return { ok: false, error: `L’audience « ${name} » existe déjà.` };
  if (id) db.prepare('UPDATE audiences SET name=?,description=?,language=? WHERE id=? AND project_id=?').run(name, txt(b.description, 400), txt(b.language, 40), id, pid);
  else db.prepare('INSERT INTO audiences(project_id,name,description,language,created) VALUES(?,?,?,?,?)').run(pid, name, txt(b.description, 400), txt(b.language, 40), now());
  log(who, `Audience « ${name} » enregistrée`);
  return { ok: true };
}
export const removeAudience = (pid, id) => db.prepare('DELETE FROM audiences WHERE id=? AND project_id=?').run(id, pid);
// Audiences tapées à la main (campagnes, ensembles, variantes) absentes de la liste : à ajouter au cas par cas.
export function strayAudiences(pid) {
  const known = new Set(listAudiences(pid).map((a) => key(a.name)));
  const used = db.prepare(`SELECT brief_audience AS a FROM campaigns WHERE project_id=? UNION SELECT s.brief_audience FROM adsets s JOIN campaigns c ON c.id=s.campaign_id WHERE c.project_id=?
    UNION SELECT audience FROM variants WHERE project_id=?`).all(pid, pid, pid).map((r) => txt(r.a, 140)).filter(Boolean);
  const out = new Map();
  for (const a of used) if (!known.has(key(a)) && !out.has(key(a))) out.set(key(a), a);
  return [...out.values()];
}

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
