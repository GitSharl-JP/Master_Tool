// Stockage des fichiers (assets). Le reste de l'application ne manipule que des CLÉS (noms relatifs
// stockés en base), jamais de chemins : changer de stockage ne touche donc ni la base ni l'interface.
//
// Pilote actuel : "local" (un dossier). Le dossier se déplace avec ATELIER_ASSETS
// (ex. un autre disque ou un partage réseau) ; par défaut data/assets/.
// Migration serveur : ajouter un pilote (S3, stockage objet…) qui expose la même interface
// (write, read, size, exists, remove, path) et le sélectionner avec ATELIER_STORAGE.
// path(key) doit renvoyer un fichier LOCAL (les outils comme ffmpeg et le navigateur d'export en ont besoin) :
// un pilote distant le télécharge dans un cache temporaire.
import { mkdirSync, createWriteStream, createReadStream, statSync, existsSync, unlinkSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DATA_DIR } from './db.js';

const DRIVER = process.env.ATELIER_STORAGE || 'local';
if (DRIVER !== 'local') throw new Error(`Pilote de stockage « ${DRIVER} » non disponible (seul « local » est implémenté).`);

const dir = (process.env.ATELIER_ASSETS ? process.env.ATELIER_ASSETS.replace(/\\/g, '/').replace(/\/?$/, '/') : DATA_DIR + 'assets/');
mkdirSync(dir, { recursive: true });

export const storage = {
  driver: DRIVER,
  location: dir,
  write: (key) => { mkdirSync(dirname(dir + key), { recursive: true }); return createWriteStream(dir + key); },
  // copie d'un fichier vers une autre clé (les designs enregistrés gardent leurs propres copies des assets)
  copy: (from, to) => { mkdirSync(dirname(dir + to), { recursive: true }); copyFileSync(dir + from, dir + to); },
  // dépose un fichier local (hors stockage) sous une clé
  put: (key, localFile) => { mkdirSync(dirname(dir + key), { recursive: true }); copyFileSync(localFile, dir + key); },
  read: (key, range) => createReadStream(dir + key, range),
  size: (key) => statSync(dir + key).size,
  exists: (key) => existsSync(dir + key),
  remove: (key) => { try { unlinkSync(dir + key); } catch { /* déjà absent */ } },
  path: (key) => dir + key,
};
