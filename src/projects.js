// Gestion des projets : projet d'essai, renommer, archiver (masqué mais récupérable), supprimer (définitif).
// Supprimer retire TOUT ce qui appartient au projet (fiche, assets, designs, variantes, exports, contenus, campagnes, calendrier, site)
// et ses fichiers ; la bibliothèque de designs (modèles partagés entre projets) n'est pas touchée.
import { existsSync, unlinkSync } from 'node:fs';
import { db, log, createEdition, saveEdition, getEdition, backup } from './db.js';
import { defaults, publishBlockers } from './schema.js';
import './studio.js'; import './video.js'; import './variants.js'; import './campaigns.js'; import './plan.js'; import './site.js'; import './library.js';
import { storage } from './storage.js';
import { EXPORT_PATH } from './studio.js';
import { PROJECT_DEFS, clearSecret } from './secrets.js';

const now = () => new Date().toISOString();
if (!db.prepare('PRAGMA table_info(editions)').all().some((c) => c.name === 'archived')) db.exec('ALTER TABLE editions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');

export function renameEdition(id, label, who) {
  const name = String(label || '').trim().slice(0, 140), ed = getEdition(id);
  if (!ed) return { ok: false, error: 'Projet introuvable.' };
  if (!name) return { ok: false, error: 'Le nom ne peut pas être vide.' };
  db.prepare('UPDATE editions SET label=?, updated=? WHERE id=?').run(name, now(), id);
  log(who, `Projet renommé : « ${ed.label} » → « ${name} »`);
  return { ok: true };
}

export function setArchived(id, flag, who) {
  const ed = getEdition(id);
  if (!ed) return { ok: false, error: 'Projet introuvable.' };
  db.prepare('UPDATE editions SET archived=? WHERE id=?').run(flag ? 1 : 0, id);
  log(who, `Projet « ${ed.label} » ${flag ? 'archivé' : 'remis dans la liste'}`);
  return { ok: true };
}

// Projet d'essai : fiche d'exemple marquée « provisoire », pour tester un parcours sans toucher aux vrais projets.
export function createTestEdition(who) {
  const n = db.prepare("SELECT COUNT(*) c FROM editions WHERE label LIKE 'Essai%'").get().c + 1;
  const id = createEdition(`Essai ${n}`, who);
  saveEdition(id, {
    ...defaults(), provisional: '1', title_en: 'TEST SHOW', tagline_en: 'An after-dark walk (test text)', top_line_en: 'Test project',
    cta_book_en: 'Book your tickets', date_start: '2027-03-02', date_end: '2027-05-20', venue_status: 'à confirmer',
  }, who);
  log(who, `Projet d'essai créé : Essai ${n}`);
  return id;
}

const n = (sql, ...a) => db.prepare(sql).get(...a).c;
export function projectCounts(id) {
  return {
    assets: n('SELECT COUNT(*) c FROM assets WHERE edition_id=?', id), variants: n('SELECT COUNT(*) c FROM variants WHERE project_id=?', id),
    exports: n('SELECT COUNT(*) c FROM exports WHERE edition_id=?', id), contents: n('SELECT COUNT(*) c FROM contents WHERE project_id=?', id),
    campaigns: n('SELECT COUNT(*) c FROM campaigns WHERE project_id=?', id),
    diffused: n("SELECT COUNT(*) c FROM content_links l JOIN contents c ON c.id=l.content_id WHERE c.project_id=? AND l.state IN ('transmis','publié')", id),
  };
}

// Suppression définitive. Une copie de la base est faite juste avant (les fichiers, eux, sont effacés pour de bon).
export function deleteEdition(id, typedName, who) {
  const ed = getEdition(id);
  if (!ed) return { ok: false, error: 'Projet introuvable.' };
  if (String(typedName || '').trim() !== ed.label) return { ok: false, error: 'Le nom saisi ne correspond pas : rien n’a été supprimé.' };
  backup();
  const files = {
    assets: db.prepare('SELECT stored FROM assets WHERE edition_id=?').all(id).map((r) => r.stored),
    exports: db.prepare('SELECT file FROM exports WHERE edition_id=?').all(id).map((r) => r.file),
  };
  const cm = '(SELECT id FROM campaigns WHERE project_id=?)', ad = `(SELECT id FROM adsets WHERE campaign_id IN ${cm})`, ct = '(SELECT id FROM contents WHERE project_id=?)';
  const steps = [
    [`DELETE FROM results WHERE link_id IN (SELECT id FROM content_links WHERE content_id IN ${ct})`], [`DELETE FROM content_links WHERE content_id IN ${ct}`],
    ['DELETE FROM contents WHERE project_id=?'], [`DELETE FROM ads WHERE adset_id IN ${ad}`], [`DELETE FROM adsets WHERE campaign_id IN ${cm}`],
    ['DELETE FROM campaigns WHERE project_id=?'], ['DELETE FROM meta_links WHERE project_id=?'], ['DELETE FROM plan_items WHERE project_id=?'],
    ['DELETE FROM variant_versions WHERE variant_id IN (SELECT id FROM variants WHERE project_id=?)'], ['DELETE FROM variants WHERE project_id=?'],
    ['DELETE FROM design_applications WHERE project_id=?'], ['DELETE FROM project_site WHERE project_id=?'],
    ['DELETE FROM designs WHERE edition_id=?'], ['DELETE FROM design_history WHERE edition_id=?'], ['DELETE FROM exports WHERE edition_id=?'],
    ['DELETE FROM jobs WHERE edition_id=?'], ['DELETE FROM subtitles WHERE edition_id=?'], ['DELETE FROM subtitles2 WHERE edition_id=?'],
    ['DELETE FROM assets WHERE edition_id=?'], ['DELETE FROM edition_versions WHERE edition_id=?'], ['DELETE FROM editions WHERE id=?'],
  ];
  db.exec('BEGIN');
  try { for (const [sql] of steps) db.prepare(sql).run(id); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); return { ok: false, error: 'Suppression annulée (erreur interne) : ' + e.message }; }
  for (const k of files.assets) storage.remove(k);
  for (const f of files.exports) { try { if (existsSync(EXPORT_PATH + f)) unlinkSync(EXPORT_PATH + f); } catch { /* déjà absent */ } }
  for (const d of PROJECT_DEFS) clearSecret(d.key, 'p' + id);
  log(who, `Projet supprimé : « ${ed.label} » (${files.assets.length} fichier(s), ${files.exports.length} export(s))`);
  return { ok: true, label: ed.label };
}

// Parcours d'un projet, dans l'ordre naturel : où j'en suis, quoi faire ensuite. L'ordre n'est pas imposé (on peut commencer par
// n'importe quelle étape) : la première étape non faite est simplement proposée comme « prochaine ».
export function pipeline(ed) {
  const id = ed.id, c = projectCounts(id);
  const blockers = publishBlockers(ed).length;
  const approved = n("SELECT COUNT(*) c FROM variants WHERE project_id=? AND approved_version>0", id);
  const exported = n('SELECT COUNT(*) c FROM exports WHERE edition_id=? AND variant_id IS NOT NULL', id);
  const links = n('SELECT COUNT(*) c FROM content_links l JOIN contents c ON c.id=l.content_id WHERE c.project_id=?', id);
  const steps = [
    { n: 1, label: 'Décrire le spectacle', page: ['fiche'], done: blockers === 0, hint: blockers ? `${blockers} point(s) à compléter (surtout utiles pour le site)` : 'Infos complètes', href: `/edition/${id}` },
    { n: 2, label: 'Ajouter le matériel', page: ['assets', 'designs', 'contenus'], done: c.assets > 0, hint: c.assets ? `${c.assets} fichier(s)` : 'Photos, affiche reçue ou document', href: `/edition/${id}/assets` },
    { n: 3, label: 'Créer les pubs', page: ['variantes', 'affiches', 'videos'], done: c.variants > 0, hint: c.variants ? `${c.variants} creative(s)` : 'Une première creative', href: c.variants ? `/edition/${id}/variants` : `/edition/${id}/variants/new` },
    { n: 4, label: 'Approuver et exporter', page: [], done: approved > 0 && exported > 0, hint: exported ? `${exported} fichier(s) exporté(s)` : 'Un clic sur la creative', href: `/edition/${id}/variants` },
    { n: 5, label: 'Mettre en campagne', page: ['campagnes'], done: links > 0, hint: links ? `${links} association(s)` : 'Relier à une campagne Meta', href: `/edition/${id}/campaigns` },
  ];
  const next = steps.find((s) => !s.done) || null;
  return { steps, next };
}

// Données de l'Accueil d'un projet : où reprendre, quoi relire, quelles échéances. Tout est calculé depuis l'état réel.
import * as variantsMod from './variants.js';
import * as campaignsMod from './campaigns.js';
import * as planMod from './plan.js';
import { nextActions } from './todo.js';

const plusDays = (iso, k) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
export function homeData(ed) {
  const pid = ed.id, vs = variantsMod.listVariants(pid).filter((v) => v.status !== 'archivé');
  const texts = campaignsMod.listContents(pid).filter((c) => c.kind === 'texte' && c.status !== 'archivé');
  const asWork = [
    ...vs.map((v) => ({ type: v.with_video && !v.formats.length ? 'Vidéo' : v.with_video ? 'Affiche + vidéo' : 'Affiche', name: v.name, status: v.status, updated: v.updated, href: `/edition/${pid}/variants/${v.id}`, next: variantsMod.nextStep(v.id)?.text || '' })),
    ...texts.map((c) => ({ type: 'Texte', name: c.title, status: c.status, updated: c.updated, href: `/edition/${pid}/contents`, next: c.status === 'approuvé' ? '' : 'À relire et approuver' })),
  ].sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return {
    pipeline: pipeline(ed), recent: asWork.slice(0, 6), toReview: asWork.filter((w) => ['brouillon', 'à relire'].includes(w.status)).slice(0, 6),
    items: planMod.listItems(pid, { from: planMod.today(), to: plusDays(planMod.today(), 14) }).filter((i) => i.status !== 'fait').slice(0, 6),
    late: planMod.listItems(pid, { to: plusDays(planMod.today(), -1) }).filter((i) => i.status !== 'fait').length,
    todo: nextActions(pid, 6), counts: { work: asWork.length, campaigns: campaignsMod.listCampaigns(pid).length },
  };
}
