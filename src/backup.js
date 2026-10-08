// Sauvegarde complète de l'atelier, hors du stockage principal, et vérification d'intégrité.
//
// OÙ SONT LES DONNÉES (tout est local) :
//   data/atelier.db  projets, fiches, designs, versions, variantes, contenus, campagnes, calendrier, sous-titres
//   data/assets/     originaux (photos, vidéos sources, sous-titres, logos) + copies propres à chaque design (designs/…)
//   data/exports/    fichiers produits (PNG, MP4, zip)
//   data/secrets.json  identifiants saisis dans Réglages : JAMAIS inclus dans une sauvegarde
//
// Une sauvegarde = un zip { atelier.db, assets/, exports/, manifest.json } où le manifeste liste chaque fichier avec sa
// taille et son empreinte SHA-256 : la restauration vérifie tout avant d'écrire quoi que ce soit.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, rmSync, writeFileSync, linkSync, copyFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { db, DATA_DIR, log } from './db.js';
import { storage } from './storage.js';
import { EXPORT_PATH, WIN_TAR } from './studio.js';
import { FFMPEG } from './media.js';

db.exec(`
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS backups(id INTEGER PRIMARY KEY, created TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER NOT NULL, files INTEGER NOT NULL, exports_mode TEXT NOT NULL, created_by TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
`);
const now = () => new Date().toISOString();
export const getSetting = (k, d = '') => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? d;
export const setSetting = (k, v) => db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
export const listBackups = () => db.prepare('SELECT * FROM backups ORDER BY id DESC LIMIT 20').all();

const norm = (p) => resolve(p).replace(/\\/g, '/').toLowerCase().replace(/\/?$/, '/');
// Le dossier de sauvegarde doit être HORS du dossier de données (sinon une perte du stockage emporte aussi les sauvegardes).
export function checkBackupDir(dir) {
  if (!dir || !String(dir).trim()) return 'Indiquez un dossier de sauvegarde.';
  const d = norm(dir);
  if (d.startsWith(norm(DATA_DIR)) || d.startsWith(norm(storage.location))) return 'Ce dossier est dans le stockage de l’atelier : choisissez un autre disque, un dossier synchronisé (OneDrive…) ou un partage réseau.';
  try { mkdirSync(dir, { recursive: true }); const t = join(dir, '.test-' + Date.now()); writeFileSync(t, 'ok'); rmSync(t); } catch { return 'Impossible d’écrire dans ce dossier. Vérifiez qu’il existe et que le disque est branché.'; }
  return null;
}

// --- vérification d'intégrité : tout ce que la base référence existe-t-il ?
export function integrity() {
  const missing = [], counts = {};
  const need = (what, ref, ok) => { if (!ok) missing.push({ what, ref }); };
  const assets = db.prepare('SELECT id,name,stored,edition_id,size FROM assets').all();
  counts.assets = assets.length;
  for (const a of assets) {
    const ok = storage.exists(a.stored) && storage.size(a.stored) === a.size;
    need('Original manquant ou altéré', `${a.name} (projet ${a.edition_id})`, ok);
  }
  const versions = db.prepare('SELECT v.id, v.version, v.snapshot, v.thumb, t.name FROM design_versions v JOIN design_templates t ON t.id=v.template_id').all();
  counts.designVersions = versions.length;
  for (const v of versions) {
    for (const a of Object.values(JSON.parse(v.snapshot).assets || {})) need('Image d’un design manquante', `${v.name} v${v.version} : ${a.name}`, storage.exists(a.key));
    if (v.thumb) need('Aperçu d’un design manquant', `${v.name} v${v.version}`, storage.exists(v.thumb));
  }
  const exps = db.prepare('SELECT id,file,label,kind,variant_version,draft FROM exports').all();
  counts.exports = exps.length;
  for (const e of exps) need(e.variant_version || e.kind === 'bundle' ? 'Export approuvé / archive manquant' : 'Export manquant (régénérable)', e.label, existsSync(EXPORT_PATH + e.file));
  counts.projects = db.prepare('SELECT COUNT(*) c FROM editions').get().c;
  counts.variants = db.prepare('SELECT COUNT(*) c FROM variants').get().c;
  counts.approvedVersions = db.prepare('SELECT COUNT(*) c FROM variant_versions').get().c;
  counts.contents = db.prepare('SELECT COUNT(*) c FROM contents').get().c;
  counts.links = db.prepare('SELECT COUNT(*) c FROM content_links').get().c;
  return { ok: missing.length === 0, missing: missing.slice(0, 200), totalMissing: missing.length, counts };
}

// --- dépendances : inclus, référencé (non inclus) ou absent
const WIN_FONTS = ['georgia', 'segoe ui', 'arial', 'times new roman', 'verdana', 'tahoma', 'calibri', 'trebuchet ms', 'cambria', 'consolas', 'courier new'];
const OPEN_FONTS = ['inter', 'noto sans jp', 'noto serif jp', 'noto sans', 'noto serif', 'roboto', 'open sans', 'lato', 'montserrat', 'source sans pro'];
const fontFiles = () => { try { return readdirSync('C:/Windows/Fonts').map((f) => f.toLowerCase().replace(/[^a-z0-9]/g, '')); } catch { return []; } };
export function dependencies() {
  const used = new Set();
  for (const e of db.prepare('SELECT data FROM editions').all()) { const d = JSON.parse(e.data); for (const k of ['font_title', 'font_body']) if (d[k]) used.add(String(d[k]).trim()); }
  const files = fontFiles();
  const fonts = [...used].map((name) => {
    const l = name.toLowerCase(), key = l.replace(/[^a-z0-9]/g, '');
    const installed = files.some((f) => f.includes(key.slice(0, 7)));
    if (WIN_FONTS.includes(l)) return { name, status: 'référencé (non inclus)', installed, note: 'Police système Microsoft : sa licence interdit de la redistribuer, elle n’est jamais incluse. Elle est présente sur Windows/Office ; à réinstaller sur un autre poste.' };
    if (OPEN_FONTS.includes(l)) return { name, status: 'référencé (non inclus)', installed, note: 'Police à licence libre (SIL OFL) : redistribuable, téléchargeable sur Google Fonts. Non incluse par défaut.' };
    return { name, status: 'référencé (non inclus)', installed, note: 'Licence inconnue : vérifiez le droit de la partager avant de la joindre à une archive.' };
  });
  const ff = spawnSync(FFMPEG, ['-version'], { timeout: 8000, encoding: 'utf8' });
  const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
  const videos = db.prepare("SELECT COUNT(*) c FROM assets WHERE kind='video'").get().c, subs = db.prepare("SELECT COUNT(*) c FROM assets WHERE kind='text'").get().c;
  return {
    fonts,
    items: [
      { name: 'Vidéos sources', status: videos ? 'inclus' : 'aucune', note: `${videos} fichier(s) dans les originaux : toujours inclus dans la sauvegarde.` },
      { name: 'Sous-titres', status: 'inclus', note: `Textes corrigés dans la base ; ${subs} fichier(s) SRT/VTT d’origine dans les originaux.` },
      { name: 'ffmpeg', status: ff.status === 0 ? 'référencé (non inclus)' : 'absent', note: ff.status === 0 ? `${String(ff.stdout).split('\n')[0]} — réinstallable (voir CLAUDE.md : source, somme de contrôle).` : 'Introuvable : les exports vidéo sont impossibles tant qu’il n’est pas réinstallé dans tools/ffmpeg/.' },
      { name: 'Navigateur Edge / Chrome', status: edge ? 'référencé (non inclus)' : 'absent', note: edge ? 'Utilisé pour produire PNG, SVG et PDF.' : 'Introuvable : exports d’images impossibles.' },
      { name: 'Identifiants (WordPress, Buffer, Meta)', status: 'non inclus', note: 'Jamais sauvegardés, par sécurité : à ressaisir dans Réglages après une restauration.' },
      { name: 'Contenu de WordPress et de Meta', status: 'non inclus', note: 'Ces données vivent chez eux ; l’atelier n’en garde que des références saisies à la main.' },
    ],
  };
}

// --- fichiers
const walk = (dir) => { const out = []; const rec = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) rec(p); else out.push(p); } }; if (existsSync(dir)) rec(dir); return out; };
const sha256 = (file) => new Promise((ok, ko) => { const h = createHash('sha256'); createReadStream(file).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko); });
const place = (from, to) => { mkdirSync(join(to, '..'), { recursive: true }); try { linkSync(from, to); } catch { copyFileSync(from, to); } };
const run = (cmd, args, opts = {}) => new Promise((ok) => { const p = spawn(cmd, args, { stdio: 'ignore', ...opts }); p.on('close', (c) => ok(c)); p.on('error', () => ok(-1)); });

// Exports à inclure : 'all' | 'pinned' (approuvés, associés à une campagne, archives) | 'none'. Les originaux et les designs sont toujours inclus.
function exportsToKeep(mode) {
  const rows = db.prepare('SELECT id,file,kind,variant_version FROM exports').all();
  if (mode === 'all') return rows.map((r) => r.file);
  if (mode === 'none') return [];
  const pinned = new Set(db.prepare('SELECT export_id FROM content_links WHERE export_id IS NOT NULL').all().map((x) => x.export_id));
  for (const x of db.prepare("SELECT export_id FROM contents WHERE status='approuvé' AND export_id IS NOT NULL").all()) pinned.add(x.export_id);
  return rows.filter((r) => pinned.has(r.id) || r.variant_version || r.kind === 'bundle').map((r) => r.file);
}

export async function createBackup({ dir, exportsMode = 'pinned', who = 'système', note = '' }) {
  const bad = checkBackupDir(dir);
  if (bad) return { ok: false, error: bad };
  const stamp = now().replace(/[:.]/g, '-'), name = `atelier-sauvegarde-${stamp}`;
  const stage = join(DATA_DIR, 'tmp', name) + sep, root = stage + name + '/';
  mkdirSync(root, { recursive: true });
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec(`VACUUM INTO '${(root + 'atelier.db').replace(/'/g, "''")}'`); // copie cohérente de la base, même serveur en marche
    const manifest = { app: 'atelier-marketing', schema: 1, created: now(), exportsMode, files: [], excluded: ['secrets.json', 'tools/', 'tmp/', 'backups/'] };
    const add = async (from, rel) => { place(from, root + rel); manifest.files.push({ path: rel, bytes: statSync(from).size, sha256: await sha256(from) }); };
    manifest.files.push({ path: 'atelier.db', bytes: statSync(root + 'atelier.db').size, sha256: await sha256(root + 'atelier.db') });
    for (const f of walk(storage.location)) await add(f, 'assets/' + relative(storage.location, f).replace(/\\/g, '/'));
    for (const file of exportsToKeep(exportsMode)) if (existsSync(EXPORT_PATH + file)) await add(EXPORT_PATH + file, 'exports/' + file);
    manifest.missingFromDisk = integrity().missing.map((m) => `${m.what} : ${m.ref}`);
    writeFileSync(root + 'manifest.json', JSON.stringify(manifest, null, 2));
    const out = join(dir, name + '.zip');
    const code = await run(WIN_TAR, ['-a', '-c', '-f', out, '-C', stage, name]);
    if (code !== 0 || !existsSync(out)) throw new Error('La création de l’archive a échoué (espace disque ? droits d’écriture ?).');
    // contrôle : le zip contient bien tous les fichiers annoncés
    const listing = spawnSync(WIN_TAR, ['-tf', out], { encoding: 'utf8', maxBuffer: 1e8 }).stdout.split('\n').map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean);
    const lacking = manifest.files.filter((f) => !listing.includes(`${name}/${f.path}`));
    if (lacking.length) throw new Error(`Archive incomplète (${lacking.length} fichier(s) absent(s)) : sauvegarde refusée.`);
    const bytes = statSync(out).size;
    db.prepare('INSERT INTO backups(created,file,bytes,files,exports_mode,created_by,status,note) VALUES(?,?,?,?,?,?,?,?)').run(now(), out, bytes, manifest.files.length, exportsMode, who, 'ok', note);
    setSetting('last_backup_ok', now());
    log(who, `Sauvegarde créée : ${manifest.files.length} fichiers, ${(bytes / 1048576).toFixed(1)} Mo → ${dir}`);
    // on garde les 8 dernières dans ce dossier
    const mine = readdirSync(dir).filter((f) => /^atelier-sauvegarde-.*\.zip$/.test(f)).sort();
    for (const old of mine.slice(0, -8)) rmSync(join(dir, old), { force: true });
    return { ok: true, file: out, bytes, files: manifest.files.length, missing: manifest.missingFromDisk };
  } catch (e) {
    db.prepare('INSERT INTO backups(created,file,bytes,files,exports_mode,created_by,status,note) VALUES(?,?,?,?,?,?,?,?)').run(now(), dir, 0, 0, exportsMode, who, 'échec', e.message);
    return { ok: false, error: e.message };
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

// Sauvegarde automatique quotidienne si un dossier externe est configuré (au démarrage, puis toutes les heures).
let running = false;
export async function autoBackup() {
  const dir = getSetting('backup_dir');
  if (!dir || running) return;
  const last = getSetting('last_backup_ok');
  if (last && Date.now() - Date.parse(last) < 24 * 3600e3) return;
  running = true;
  try { await createBackup({ dir, exportsMode: getSetting('backup_exports', 'pinned'), who: 'automatique' }); } finally { running = false; }
}
export function startAutoBackup() { setTimeout(autoBackup, 30_000); setInterval(autoBackup, 3600e3).unref?.(); }

// État pour l'interface
export function backupStatus() {
  const dir = getSetting('backup_dir'), last = getSetting('last_backup_ok');
  const ageDays = last ? (Date.now() - Date.parse(last)) / 864e5 : null;
  return { dir, last, ageDays, exportsMode: getSetting('backup_exports', 'pinned'), stale: !dir || ageDays === null || ageDays > 7 };
}
