// Calendrier de production : qui fait quoi, pour quand. Les dates sont des jours calendaires du fuseau du projet
// (fiche : fuseau horaire, par défaut Asia/Tokyo) ; l'heure est facultative.
//
// « Planifier à rebours » : à partir de la date de publication visée, crée les étapes standard d'une variante.
// Les étapes se cochent automatiquement quand la réalité les rattrape (variante approuvée, export produit,
// association transmise / publiée) ; l'atelier ne publie jamais lui-même.
import { db, log } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS plan_items(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, campaign_id INTEGER, variant_id INTEGER,
  kind TEXT NOT NULL, title TEXT NOT NULL, due_date TEXT NOT NULL, due_time TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'à faire', note TEXT NOT NULL DEFAULT '', auto INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, created_by TEXT NOT NULL, done_at TEXT)`);
const now = () => new Date().toISOString();
const txt = (v, n = 200) => String(v ?? '').trim().slice(0, n);

export const KINDS = { production: 'Production', relecture: 'Relecture', approbation: 'Approbation', export: 'Export', transmission: 'Transmission à Meta', publication: 'Publication', jalon: 'Jalon' };
export const PLAN_STATUSES = ['à faire', 'en cours', 'fait', 'bloqué'];
// Décalage en jours AVANT la publication (J-n).
const STEPS = [
  ['production', 'Préparer textes, cadrages et sous-titres', 10], ['relecture', 'Relecture', 7], ['approbation', 'Approuver le contenu', 6],
  ['export', 'Exporter les fichiers', 5], ['transmission', 'Transmettre à Meta (déclaration manuelle tant que l’API n’est pas connectée)', 3], ['publication', 'Publication / mise en diffusion', 0],
];
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const today = () => new Date().toISOString().slice(0, 10);
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));

export function planVariant(variantId, publishDate, who, opts = {}) {
  const v = db.prepare('SELECT * FROM variants WHERE id=?').get(variantId);
  if (!v) return { ok: false, error: 'Contenu introuvable.' };
  if (!validDate(publishDate)) return { ok: false, error: 'Indiquez la date de publication visée.' };
  if (db.prepare('SELECT 1 FROM plan_items WHERE variant_id=? AND auto=1').get(variantId)) return { ok: false, error: 'Ce contenu est déjà planifié : modifiez les dates directement dans le calendrier.' };
  const owner = txt(opts.owner, 60) || v.owner || who;
  for (const [kind, title, off] of STEPS) {
    const who2 = kind === 'approbation' || kind === 'relecture' ? (v.reviewer || owner) : owner;
    db.prepare('INSERT INTO plan_items(project_id,campaign_id,variant_id,kind,title,due_date,owner,status,auto,created,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(v.project_id, v.campaign_id, variantId, kind, `${title} — ${v.name}`, addDays(publishDate, -off), who2, 'à faire', 1, now(), who);
  }
  log(who, `Contenu « ${v.name} » planifié à rebours (publication visée le ${publishDate})`);
  syncVariant(variantId);
  return { ok: true };
}
// Jalon commercial du brief (ex. ouverture des préventes) : UNE tâche « jalon » par campagne (auto=2), tenue à jour
// à chaque enregistrement du brief ; supprimée si le brief n'a plus de date de jalon.
export function syncCampaignMilestone(campaignId, who) {
  const c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
  if (!c) return;
  const it = db.prepare("SELECT * FROM plan_items WHERE campaign_id=? AND kind='jalon' AND auto=2").get(campaignId);
  if (!validDate(c.brief_milestone_date)) { if (it) db.prepare('DELETE FROM plan_items WHERE id=?').run(it.id); return; }
  const title = `${txt(c.brief_milestone) || 'Jalon'} — ${c.name}`;
  if (it) db.prepare('UPDATE plan_items SET title=?, due_date=? WHERE id=?').run(title, c.brief_milestone_date, it.id);
  else db.prepare('INSERT INTO plan_items(project_id,campaign_id,kind,title,due_date,owner,status,auto,created,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(c.project_id, c.id, 'jalon', title, c.brief_milestone_date, who, 'à faire', 2, now(), who);
}

// « Planifier la campagne » : planifie à rebours chaque contenu de la campagne qui ne l'est pas encore.
// Date de diffusion = début de la période visée (ou la date choisie) ; les relances (intention « relance ») à la fin.
// Si la première étape (J-10) tombe déjà dans le passé, rien n'est créé sans l'accord explicite de la personne (force).
export const unplannedCount = (campaignId) => db.prepare("SELECT COUNT(*) AS n FROM variants WHERE campaign_id=? AND status<>'archivé' AND id NOT IN (SELECT variant_id FROM plan_items WHERE variant_id IS NOT NULL AND auto=1)").get(campaignId).n;
export function planCampaign(campaignId, who, opts = {}) {
  const c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
  if (!c) return { ok: false, error: 'Campagne introuvable.' };
  const start = validDate(opts.publish) ? opts.publish : c.brief_start;
  if (!validDate(start)) return { ok: false, error: 'Indiquez la date de diffusion, ou la période visée dans le brief.' };
  const end = validDate(c.brief_end) && c.brief_end >= start ? c.brief_end : start;
  const todo = db.prepare("SELECT * FROM variants WHERE campaign_id=? AND status<>'archivé' AND id NOT IN (SELECT variant_id FROM plan_items WHERE variant_id IS NOT NULL AND auto=1) ORDER BY id").all(campaignId);
  if (!todo.length) return { ok: false, error: 'Tous les contenus de cette campagne sont déjà planifiés (ou la campagne n’a aucun contenu).' };
  const dateOf = (v) => (v.intent === 'relance' ? end : start);
  const late = todo.filter((v) => addDays(dateOf(v), -STEPS[0][2]) < today());
  if (late.length && !opts.force) return { ok: false, late: late.map((v) => v.name), error: `${late.length} contenu${late.length > 1 ? 's' : ''} n’aurai${late.length > 1 ? 'ent' : 't'} pas les 10 jours de préparation prévus (${late.map((v) => v.name).join(', ')}). Choisissez une date plus tardive, ou cochez « Planifier quand même » : les premières étapes seront alors déjà en retard.` };
  for (const v of todo) planVariant(v.id, dateOf(v), who, opts);
  log(who, `Campagne « ${c.name} » planifiée : ${todo.length} contenu(s)`);
  return { ok: true, count: todo.length };
}
export function addItem(pid, b, who) {
  if (!txt(b.title)) return { ok: false, error: 'Donnez un titre à la tâche.' };
  if (!validDate(b.due_date)) return { ok: false, error: 'Indiquez une date.' };
  db.prepare('INSERT INTO plan_items(project_id,campaign_id,variant_id,kind,title,due_date,due_time,owner,status,note,auto,created,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(pid, Number(b.campaign_id) || null, Number(b.variant_id) || null, KINDS[b.kind] ? b.kind : 'jalon', txt(b.title), b.due_date, /^\d{2}:\d{2}$/.test(b.due_time || '') ? b.due_time : '', txt(b.owner, 60) || who, 'à faire', txt(b.note, 300), 0, now(), who);
  return { ok: true };
}
export function updateItem(id, b, who) {
  const it = db.prepare('SELECT * FROM plan_items WHERE id=?').get(id);
  if (!it) return;
  const status = PLAN_STATUSES.includes(b.status) ? b.status : it.status;
  db.prepare('UPDATE plan_items SET due_date=?,due_time=?,owner=?,status=?,note=?,done_at=? WHERE id=?')
    .run(validDate(b.due_date) ? b.due_date : it.due_date, /^\d{2}:\d{2}$/.test(b.due_time || '') ? b.due_time : (b.due_time === '' ? '' : it.due_time), txt(b.owner, 60) || it.owner, status, txt(b.note ?? it.note, 300), status === 'fait' ? (it.done_at || now()) : null, id);
  log(who, `Calendrier : « ${it.title} » → ${status}`);
}
export const removeItem = (id, who) => { db.prepare('DELETE FROM plan_items WHERE id=?').run(id); log(who, `Calendrier : tâche ${id} supprimée`); };
export const listItems = (pid, { from, to, campaignId, variantId } = {}) => db.prepare(`SELECT p.*, v.name AS variant_name, c.name AS campaign_name FROM plan_items p LEFT JOIN variants v ON v.id=p.variant_id LEFT JOIN campaigns c ON c.id=p.campaign_id
  WHERE p.project_id=? ${from ? 'AND p.due_date>=?' : ''} ${to ? 'AND p.due_date<=?' : ''} ${campaignId ? 'AND p.campaign_id=?' : ''} ${variantId ? 'AND p.variant_id=?' : ''} ORDER BY p.due_date, p.due_time, p.id`)
  .all(...[pid, from, to, campaignId, variantId].filter((x) => x !== undefined && x !== null && x !== ''));

// La réalité coche les étapes automatiques (jamais l'inverse).
export function syncVariant(variantId) {
  const v = db.prepare('SELECT * FROM variants WHERE id=?').get(variantId);
  if (!v) return;
  const exported = !!db.prepare("SELECT 1 FROM exports WHERE variant_id=? AND variant_version=? AND variant_version>0").get(variantId, v.approved_version);
  const links = db.prepare('SELECT l.state FROM content_links l JOIN contents c ON c.id=l.content_id WHERE c.variant_id=?').all(variantId).map((x) => x.state);
  const done = {
    production: v.status !== 'brouillon', relecture: v.status === 'approuvé', approbation: v.status === 'approuvé' && v.approved_version > 0,
    export: exported, transmission: links.some((s) => ['transmis', 'publié'].includes(s)), publication: links.includes('publié'),
  };
  for (const it of db.prepare('SELECT * FROM plan_items WHERE variant_id=? AND auto=1').all(variantId)) {
    if (done[it.kind] && it.status !== 'fait') db.prepare("UPDATE plan_items SET status='fait', done_at=? WHERE id=?").run(now(), it.id);
  }
}

// Grille d'un mois : semaines du lundi au dimanche. month = 'YYYY-MM'.
export function monthGrid(month) {
  const first = new Date(month + '-01T00:00:00Z');
  const start = new Date(first); start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) { const x = new Date(start); x.setUTCDate(start.getUTCDate() + w * 7 + d); row.push({ date: x.toISOString().slice(0, 10), inMonth: x.getUTCMonth() === first.getUTCMonth() }); }
    if (w >= 4 && !row.some((c) => c.inMonth)) break;
    weeks.push(row);
  }
  return weeks;
}
export const shiftMonth = (month, n) => { const d = new Date(month + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
