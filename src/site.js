// Le site WordPress d'un projet : UN site par projet, sur SON domaine. Il appartient au projet, pas à une campagne :
// créer une campagne ne crée pas de site, et plusieurs campagnes peuvent renvoyer vers le même site.
// Les autres sites (par exemple le site vitrine d'Acoustiguide) ne sont que des exemples : ils ne sont jamais regroupés.
import { db, log } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS project_site(
  project_id INTEGER PRIMARY KEY, domain TEXT NOT NULL DEFAULT '', environment TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'à créer', steps TEXT NOT NULL DEFAULT '{}', notes TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL)`);
const now = () => new Date().toISOString();
const txt = (v, n = 200) => String(v ?? '').trim().slice(0, n);

export const ENVIRONMENTS = [['local', 'Local (sur cet ordinateur)'], ['staging', 'Pré-production (staging)'], ['production', 'Production (en ligne)']];
export const SITE_STATUSES = ['à créer', 'en construction', 'en ligne'];
// Plan de construction du site : ce qui doit exister avant la mise en ligne.
export const STEPS = [
  ['domain', 'Réserver le nom de domaine'], ['hosting', 'Choisir l’hébergement WordPress'], ['wp', 'Installer WordPress (en local d’abord, puis en pré-production)'],
  ['theme', 'Mettre en place le thème avec la charte du projet'], ['pages', 'Créer les pages depuis le projet (en brouillon)'], ['ticketing', 'Brancher la billetterie'],
  ['legal', 'Pages légales (conditions de vente, confidentialité)'], ['test', 'Tester en pré-production (mobile, réservation, paiement)'], ['live', 'Mise en ligne — action explicite uniquement'],
];

export const getSite = (pid) => {
  const r = db.prepare('SELECT * FROM project_site WHERE project_id=?').get(pid);
  return { project_id: pid, domain: '', environment: 'local', status: 'à créer', notes: '', ...(r || {}), steps: JSON.parse(r?.steps || '{}') };
};
export function saveSite(pid, b, who) {
  const cur = getSite(pid);
  const domain = txt(b.domain, 120).replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
  const env = ENVIRONMENTS.some(([k]) => k === b.environment) ? b.environment : cur.environment;
  const status = SITE_STATUSES.includes(b.status) ? b.status : cur.status;
  db.prepare('INSERT INTO project_site(project_id,domain,environment,status,steps,notes,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET domain=excluded.domain, environment=excluded.environment, status=excluded.status, notes=excluded.notes, updated=excluded.updated')
    .run(pid, domain, env, status, JSON.stringify(cur.steps), txt(b.notes, 400), now());
  log(who, `Site du projet : domaine « ${domain || '—'} », ${env}, ${status}`);
}
export function setStep(pid, key, done, who) {
  if (!STEPS.some(([k]) => k === key)) return;
  const cur = getSite(pid), steps = { ...cur.steps, [key]: !!done };
  db.prepare('INSERT INTO project_site(project_id,steps,updated) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET steps=excluded.steps, updated=excluded.updated').run(pid, JSON.stringify(steps), now());
  log(who, `Site du projet : étape « ${STEPS.find(([k]) => k === key)[1]} » ${done ? 'faite' : 'à refaire'}`);
}
