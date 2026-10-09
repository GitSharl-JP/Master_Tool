import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { defaults, fieldKeys } from './schema.js';

export { db };
// ATELIER_DATA permet de déplacer le dossier de données (tests, ou migration serveur).
const fromUrl = decodeURIComponent(new URL('../data/', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
export const DATA_DIR = process.env.ATELIER_DATA ? process.env.ATELIER_DATA.replace(/\\/g, '/').replace(/\/?$/, '/') : fromUrl;
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DATA_DIR + 'atelier.db');
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS editions(
  id INTEGER PRIMARY KEY, label TEXT NOT NULL, data TEXT NOT NULL, validation TEXT NOT NULL,
  source_id INTEGER, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS edition_versions(
  id INTEGER PRIMARY KEY, edition_id INTEGER NOT NULL, data TEXT NOT NULL, validation TEXT NOT NULL,
  saved_by TEXT NOT NULL, saved_at TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY, at TEXT NOT NULL, who TEXT NOT NULL, what TEXT NOT NULL);
`);

const now = () => new Date().toISOString();
export const log = (who, what) => db.prepare('INSERT INTO activity(at,who,what) VALUES(?,?,?)').run(now(), who, what);
export const recentActivity = (n = 15) => db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?').all(n);

// --- utilisateurs / sessions
export const userCount = () => db.prepare('SELECT COUNT(*) c FROM users').get().c;
export const listUsers = () => db.prepare('SELECT id,name,created FROM users ORDER BY id').all();
export function createUser(name, password) {
  const salt = randomBytes(16).toString('hex');
  const hash = salt + ':' + scryptSync(password, salt, 64).toString('hex');
  db.prepare('INSERT INTO users(name,hash,created) VALUES(?,?,?)').run(name, hash, now());
}
export function checkLogin(name, password) {
  const u = db.prepare('SELECT * FROM users WHERE name=?').get(name);
  if (!u) return null;
  const [salt, h] = u.hash.split(':');
  const given = scryptSync(password, salt, 64);
  return timingSafeEqual(given, Buffer.from(h, 'hex')) ? u : null;
}
export function newSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, userId, Date.now() + 7 * 864e5);
  return token;
}
export function sessionUser(token) {
  if (!token) return null;
  const r = db.prepare('SELECT u.id,u.name,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(token);
  if (!r || r.expires < Date.now()) return null;
  return { id: r.id, name: r.name };
}
export const endSession = (token) => db.prepare('DELETE FROM sessions WHERE token=?').run(token);

// --- éditions
// Les champs ajoutés après la création d'une édition reçoivent leur valeur par défaut (sans écraser la saisie).
const parse = (r) => r && { ...r, data: { ...defaults(), ...JSON.parse(r.data) }, validation: JSON.parse(r.validation) };
export const listEditions = () => db.prepare('SELECT * FROM editions ORDER BY updated DESC').all().map(parse);
export const getEdition = (id) => parse(db.prepare('SELECT * FROM editions WHERE id=?').get(id));
export const listVersions = (id) => db.prepare('SELECT id,saved_by,saved_at,note FROM edition_versions WHERE edition_id=? ORDER BY id DESC').all(id);

function snapshot(id, who, note) {
  const e = db.prepare('SELECT data,validation FROM editions WHERE id=?').get(id);
  db.prepare('INSERT INTO edition_versions(edition_id,data,validation,saved_by,saved_at,note) VALUES(?,?,?,?,?,?)')
    .run(id, e.data, e.validation, who, now(), note);
}

export function createEdition(label, who) {
  const t = now();
  const r = db.prepare('INSERT INTO editions(label,data,validation,created,updated) VALUES(?,?,?,?,?)')
    .run(label, JSON.stringify(defaults()), '{}', t, t);
  snapshot(r.lastInsertRowid, who, 'Création');
  log(who, `Édition créée : ${label}`);
  return Number(r.lastInsertRowid);
}

// Duplication : copie les données, remet toute validation à zéro et le lieu « à confirmer ».
export function duplicateEdition(id, label, who) {
  const src = getEdition(id);
  const data = { ...src.data, venue_status: 'à confirmer', edition_code: '' };
  const t = now();
  const r = db.prepare('INSERT INTO editions(label,data,validation,source_id,created,updated) VALUES(?,?,?,?,?,?)')
    .run(label, JSON.stringify(data), '{}', id, t, t);
  snapshot(r.lastInsertRowid, who, `Dupliquée depuis « ${src.label} »`);
  log(who, `Édition dupliquée : ${src.label} → ${label}`);
  return Number(r.lastInsertRowid);
}

export function saveEdition(id, data, who) {
  const cur = getEdition(id);
  // Toute modification d'une section approuvée la repasse « à relire » (pas de changement silencieux).
  const validation = { ...cur.validation };
  for (const sid of Object.keys(validation)) {
    if (validation[sid].status === 'approuvé' && sectionChanged(sid, cur.data, data)) {
      validation[sid] = { status: 'à relire', by: who, at: now() };
    }
  }
  db.prepare('UPDATE editions SET data=?, validation=?, updated=? WHERE id=?')
    .run(JSON.stringify(data), JSON.stringify(validation), now(), id);
  snapshot(id, who, 'Enregistrement');
}

function sectionChanged(sid, a, b) {
  return fieldKeys().filter((f) => f.section === sid).some((f) => (a[f.key] || '') !== (b[f.key] || ''));
}

export function setValidation(id, sid, status, who) {
  const e = getEdition(id);
  e.validation[sid] = { status, by: who, at: now() };
  db.prepare('UPDATE editions SET validation=?, updated=? WHERE id=?').run(JSON.stringify(e.validation), now(), id);
  snapshot(id, who, `Section ${sid} → ${status}`);
  log(who, `Édition « ${e.label} » : ${sid} → ${status}`);
}

export function restoreVersion(editionId, versionId, who) {
  const v = db.prepare('SELECT * FROM edition_versions WHERE id=? AND edition_id=?').get(versionId, editionId);
  if (!v) return false;
  db.prepare('UPDATE editions SET data=?, validation=?, updated=? WHERE id=?').run(v.data, v.validation, now(), editionId);
  snapshot(editionId, who, `Restauration de la version ${versionId}`);
  log(who, `Version ${versionId} restaurée (édition ${editionId})`);
  return true;
}

// --- sauvegarde (copie de la base, 10 dernières conservées)
export function backup() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const dir = DATA_DIR + 'backups/';
  mkdirSync(dir, { recursive: true });
  const name = `atelier-${now().replace(/[:.]/g, '-')}.db`;
  copyFileSync(DATA_DIR + 'atelier.db', dir + name);
  const all = readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  for (const old of all.slice(0, -10)) unlinkSync(dir + old);
  return name;
}
export const hasDb = () => existsSync(DATA_DIR + 'atelier.db');

// Changement de mot de passe (outil local src/comptes.js) : coupe aussi les sessions ouvertes de ce compte.
export function setPassword(name, password) {
  const u = db.prepare('SELECT id FROM users WHERE name=?').get(name);
  if (!u) return false;
  const salt = randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET hash=? WHERE id=?').run(salt + ':' + scryptSync(password, salt, 64).toString('hex'), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  log('système', `Mot de passe changé (outil local) : ${name}`);
  return true;
}
