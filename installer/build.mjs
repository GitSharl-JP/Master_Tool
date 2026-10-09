// Construit l'installateur Windows :  node installer/build.mjs   (ou double-clic sur Construire-installateur.bat)
// Résultat : dist/Installer-Atelier-marketing.exe — un seul fichier, à copier sur n'importe quel PC Windows 10/11.
//  1. reconstruit Atelier.exe (lanceur) ;
//  2. rassemble le programme (src, public, Atelier.exe, node.exe, ffmpeg) SANS data/ ni tests/ ni .git ;
//  3. le compresse (tar de Windows) en payload.zip, embarqué dans l'installateur ;
//  4. compile le désinstalleur, puis l'installateur (csc.exe fourni par Windows).
// Rien ici ne lit ni ne copie le dossier data/ (projets, secrets).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), OBJ = join(ROOT, 'installer', 'obj'), DIST = join(ROOT, 'dist');
const say = (m) => console.log(m);
const fail = (m) => { console.error('✗ ' + m); process.exit(1); };
const mo = (n) => (n / 1048576).toFixed(0) + ' Mo';
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

// --- 1. lanceur
let r = run(process.execPath, [join(ROOT, 'launcher', 'build.mjs')]);
if (r.status !== 0) fail('Construction du lanceur échouée :\n' + r.stdout + r.stderr);
say('✓ Lanceur Atelier.exe à jour');

// --- 2. programme à embarquer (liste blanche : on n'ajoute que ce qui est nécessaire)
const stage = mkdtempSync(join(tmpdir(), 'atelier-installateur-'));
const want = [['src'], ['public'], ['package.json'], ['Atelier.exe'], ['Demarrer.bat'], ['Restaurer.bat'], ['README.md'], ['tools', 'node', 'node.exe'], ['tools', 'ffmpeg', 'ffmpeg.exe'], ['tools', 'ffmpeg', 'ffprobe.exe']];
for (const parts of want) {
  const from = join(ROOT, ...parts);
  if (!existsSync(from)) { if (parts[1] === 'ffmpeg') { say('⚠ ' + parts.join('/') + ' absent : les exports vidéo seront indisponibles dans l’installateur.'); continue; } fail('Fichier manquant : ' + parts.join('/')); }
  mkdirSync(dirname(join(stage, ...parts)), { recursive: true });
  cpSync(from, join(stage, ...parts), { recursive: true });
}
if (existsSync(join(stage, 'data'))) fail('data/ ne doit jamais être embarqué.');
const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
say('✓ Programme rassemblé (' + mo(size(stage)) + ')');

// --- 3. archive
mkdirSync(OBJ, { recursive: true }); mkdirSync(DIST, { recursive: true });
const ZIP = join(OBJ, 'payload.zip'), TAR = join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe');
rmSync(ZIP, { force: true });
r = run(TAR, ['-a', '-c', '-f', ZIP, '-C', stage, '.']);
rmSync(stage, { recursive: true, force: true });
if (r.status !== 0 || !existsSync(ZIP)) fail('Compression échouée :\n' + (r.stderr || ''));
say('✓ Archive créée (' + mo(statSync(ZIP).size) + ' compressés)');

// --- 4. compilation
const fw = join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET', 'Framework64');
const versions = existsSync(fw) ? readdirSync(fw).filter((d) => existsSync(join(fw, d, 'csc.exe'))).sort() : [];
if (!versions.length) fail('csc.exe (compilateur C# de Windows) introuvable.');
const CSC = join(fw, versions.at(-1), 'csc.exe'), ICO = join(ROOT, 'launcher', 'atelier.ico');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const numero = (pkg.version || '1.0') + ' (' + new Date().toISOString().slice(0, 10) + ')';
writeFileSync(join(OBJ, 'Version.cs'), `static class VersionApp { public const string Numero = "${numero}"; }\n`);
const common = ['/nologo', '/codepage:65001', '/target:winexe', '/optimize+', `/win32icon:${ICO}`, '/r:System.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:Microsoft.CSharp.dll', '/r:System.Core.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll'];
const SRC = [join(ROOT, 'installer', 'Setup.cs'), join(OBJ, 'Version.cs')];
const DES = join(OBJ, 'Desinstaller.exe'), SETUP = join(DIST, 'Installer-Atelier-marketing.exe');
r = run(CSC, [...common, '/define:UNINSTALLER', `/out:${DES}`, ...SRC]);
if (r.status !== 0 || !existsSync(DES)) fail('Compilation du désinstalleur échouée :\n' + r.stdout + r.stderr);
r = run(CSC, [...common, `/out:${SETUP}`, `/resource:${ZIP},payload.zip`, `/resource:${DES},Desinstaller.exe`, ...SRC]);
if (r.status !== 0 || !existsSync(SETUP)) fail('Compilation de l’installateur échouée :\n' + r.stdout + r.stderr);
rmSync(ZIP, { force: true });
say('✓ Installateur construit : dist/Installer-Atelier-marketing.exe (' + mo(statSync(SETUP).size) + ')');
say('\nCopiez ce fichier sur le PC voulu et double-cliquez dessus. Les données ne sont jamais incluses.');
