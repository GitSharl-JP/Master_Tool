// Restauration d'une sauvegarde dans une installation VIERGE (ou existante, avec --force).
// Autonome : n'importe aucun module de l'application (elle ne doit pas être démarrée).
//
//   node src/restore.js <sauvegarde.zip> [--data <dossier>] [--force]
//   (ou glisser le .zip sur Restaurer.bat)
//
// Étapes : 1) extraction dans un dossier temporaire  2) vérification de CHAQUE fichier (taille + SHA-256)
//          3) seulement si tout est bon : écriture dans le dossier de données  4) contrôle de la base restaurée.
// Rien n'est modifié si une vérification échoue. Une installation existante est mise de côté, jamais écrasée.
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const zip = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--data') + 1]);
const dataArg = args.includes('--data') ? args[args.indexOf('--data') + 1] : null;
const force = args.includes('--force');
const here = decodeURIComponent(new URL('../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const DATA = resolve(dataArg || process.env.ATELIER_DATA || here + 'data');
const ASSETS = resolve(process.env.ATELIER_ASSETS || join(DATA, 'assets'));
const TAR = (process.env.SystemRoot || 'C:/Windows').replace(/\\/g, '/') + '/System32/tar.exe';
const die = (m, code = 1) => { console.error('\n✗ ' + m); process.exit(code); };
const say = (m) => console.log(m);

if (!zip || !existsSync(zip)) die('Indiquez le fichier de sauvegarde (.zip) à restaurer.');
const sha = (f) => new Promise((ok, ko) => { const h = createHash('sha256'); createReadStream(f).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko); });

const hasData = existsSync(join(DATA, 'atelier.db')) && statSync(join(DATA, 'atelier.db')).size > 100 * 1024;
if (hasData && !force) die(`Le dossier de données contient déjà une installation (${DATA}).\nPour restaurer quand même, relancez avec --force : l'existant sera mis de côté, pas supprimé.`);

const tmp = DATA + '-restauration-' + Date.now();
mkdirSync(tmp, { recursive: true });
try {
  say('1/4 Extraction de la sauvegarde…');
  const x = spawnSync(TAR, ['-x', '-f', resolve(zip), '-C', tmp], { encoding: 'utf8', maxBuffer: 1e8 });
  const top = readdirSync(tmp).find((d) => existsSync(join(tmp, d, 'manifest.json')));
  if (x.status !== 0 || !top) die('Archive illisible ou incomplète (manifest.json introuvable).');
  const root = join(tmp, top), manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  if (manifest.app !== 'atelier-marketing') die('Ce zip n’est pas une sauvegarde de l’atelier.');

  say(`2/4 Vérification de ${manifest.files.length} fichiers (taille et empreinte SHA-256)…`);
  const bad = [];
  for (const f of manifest.files) {
    const p = join(root, f.path);
    if (!existsSync(p)) { bad.push(`manquant : ${f.path}`); continue; }
    if (statSync(p).size !== f.bytes) { bad.push(`taille différente : ${f.path}`); continue; }
    if ((await sha(p)) !== f.sha256) bad.push(`contenu altéré : ${f.path}`);
  }
  if (bad.length) die(`La sauvegarde est corrompue (${bad.length} problème(s)) ; rien n'a été restauré :\n  - ${bad.slice(0, 10).join('\n  - ')}`);

  say('3/4 Écriture dans le dossier de données…');
  mkdirSync(DATA, { recursive: true });
  if (hasData || existsSync(ASSETS) && readdirSync(ASSETS).length) {
    const aside = join(DATA, 'avant-restauration-' + Date.now());
    mkdirSync(aside, { recursive: true });
    for (const n of ['atelier.db', 'atelier.db-wal', 'atelier.db-shm', 'exports']) if (existsSync(join(DATA, n))) renameSync(join(DATA, n), join(aside, n));
    if (existsSync(ASSETS)) renameSync(ASSETS, join(aside, 'assets'));
    say('   Installation existante mise de côté : ' + aside);
  }
  for (const f of manifest.files) {
    const dest = f.path === 'atelier.db' ? join(DATA, 'atelier.db') : f.path.startsWith('assets/') ? join(ASSETS, f.path.slice(7)) : join(DATA, f.path);
    if (!resolve(dest).startsWith(resolve(DATA)) && !resolve(dest).startsWith(resolve(ASSETS))) die('Chemin suspect dans la sauvegarde : ' + f.path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(root, f.path), dest);
  }
  mkdirSync(join(DATA, 'exports'), { recursive: true });

  say('4/4 Contrôle de la base restaurée…');
  const db = new DatabaseSync(join(DATA, 'atelier.db'), { readOnly: true });
  const n = (sql) => db.prepare(sql).get().c;
  const stat = { projets: n('SELECT COUNT(*) c FROM editions'), assets: n('SELECT COUNT(*) c FROM assets'), designs: n('SELECT COUNT(*) c FROM design_versions'), variantes: n('SELECT COUNT(*) c FROM variants'), 'versions approuvées': n('SELECT COUNT(*) c FROM variant_versions'), contenus: n('SELECT COUNT(*) c FROM contents'), associations: n('SELECT COUNT(*) c FROM content_links') };
  const lostAssets = db.prepare('SELECT name,stored FROM assets').all().filter((a) => !existsSync(join(ASSETS, a.stored)));
  const lostExports = db.prepare('SELECT label,file,kind,variant_version FROM exports').all().filter((e) => !existsSync(join(DATA, 'exports', e.file)));
  db.close();
  console.log('\n✓ Restauration terminée.\n  Contenu restauré : ' + Object.entries(stat).map(([k, v]) => `${v} ${k}`).join(', '));
  if (lostAssets.length) console.log(`\n⚠ ${lostAssets.length} original(aux) référencé(s) mais absent(s) de la sauvegarde :\n   - ` + lostAssets.slice(0, 10).map((a) => a.name).join('\n   - '));
  const approvedLost = lostExports.filter((e) => e.variant_version || e.kind === 'bundle');
  console.log(`\n  Exports non inclus dans cette sauvegarde : ${lostExports.length} (dont ${approvedLost.length} approuvé(s)/archive(s)). Les affiches et vidéos se régénèrent depuis les designs et les versions approuvées.`);
  if (manifest.missingFromDisk?.length) console.log(`\n⚠ Déjà manquants au moment de la sauvegarde (${manifest.missingFromDisk.length}) : ` + manifest.missingFromDisk.slice(0, 5).join(' ; '));
  console.log(`\nÀ FAIRE ENSUITE\n  1. Lancer Demarrer.bat.\n  2. Réglages : ressaisir les identifiants (WordPress, Buffer, Meta) — jamais sauvegardés.\n  3. Vérifier que ffmpeg est dans tools/ffmpeg/ et que les polices du projet sont installées (Réglages > Sauvegardes > Dépendances).`);
} finally { rmSync(tmp, { recursive: true, force: true }); }
