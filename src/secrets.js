// Coffre à secrets local : écriture seule depuis l'interface, jamais ré-affiché.
// Fichier : data/secrets.json (ignoré par Git, jamais sauvegardé). Seul le code serveur le lit, au moment d'appeler un service.
//
// Deux portées :
//  - COMPTE (une valeur pour tout l'atelier) : Buffer, Meta ;
//  - PROJET (une valeur par projet) : le site WordPress. Un projet possède SON site, sur SON domaine : ses identifiants
//    ne se partagent jamais avec un autre projet (clé stockée « p<id>:WP_URL »).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DATA_DIR } from './db.js';

const FILE = DATA_DIR + 'secrets.json';

// Secrets de compte (Réglages)
export const SECRET_DEFS = [
  { key: 'BUFFER_TOKEN', label: 'Buffer — jeton d’accès', secret: true },
  { key: 'META_TOKEN', label: 'Meta — jeton d’accès (lecture suffit pour commencer)', secret: true },
];
// Secrets de projet (onglet « Site web » du projet)
export const PROJECT_DEFS = [
  { key: 'WP_URL', label: 'Adresse du site WordPress', secret: false, help: 'Ex. https://monspectacle.com (sans / final)' },
  { key: 'WP_USER', label: 'Identifiant WordPress', secret: false },
  { key: 'WP_APP_PASSWORD', label: 'Mot de passe d’application', secret: true, help: 'À créer dans WordPress : Utilisateurs → Profil → Mots de passe d’application. N’utilisez PAS votre mot de passe de connexion.' },
];

const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {});
const full = (key, scope) => (scope ? `${scope}:${key}` : key);
const defsOf = (scope) => (scope ? PROJECT_DEFS : SECRET_DEFS);

export function setSecret(key, value, scope = '') {
  if (!defsOf(scope).some((d) => d.key === key) || !value) return false;
  const all = load();
  all[full(key, scope)] = value;
  writeFileSync(FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
  return true;
}
export function clearSecret(key, scope = '') {
  const all = load();
  delete all[full(key, scope)];
  writeFileSync(FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
}
export const getSecret = (key, scope = '') => load()[full(key, scope)] || null; // usage serveur uniquement
export const isSet = (key, scope = '') => Boolean(load()[full(key, scope)]);
// Pour les champs non secrets (URL, identifiant), un aperçu est autorisé.
export const preview = (def, scope = '') => (!def.secret && isSet(def.key, scope) ? load()[full(def.key, scope)] : null);
