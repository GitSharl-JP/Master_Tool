// Construit Atelier.exe (lanceur Windows) à la racine du projet :  node launcher/build.mjs   (ou double-clic sur Construire-exe.bat)
//  1. fabrique l'icône Windows (launcher/atelier.ico) à partir de public/brand/icon.png (ffmpeg, déjà dans tools/) ;
//  2. place une copie de node.exe dans tools/node/ pour que le dossier soit autonome (rien d'autre à installer) ;
//  3. compile launcher/Atelier.cs avec csc.exe, fourni par Windows (.NET Framework), en y intégrant l'icône.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const say = (m) => console.log(m);
const fail = (m) => { console.error('✗ ' + m); process.exit(1); };

// --- 1. icône (PNG intégrés dans un .ico : accepté par Windows depuis Vista)
const FF = join(ROOT, 'tools', 'ffmpeg', 'ffmpeg.exe'), SRC = join(ROOT, 'public', 'brand', 'icon.png'), ICO = join(ROOT, 'launcher', 'atelier.ico');
if (!existsSync(SRC)) fail('public/brand/icon.png introuvable.');
if (!existsSync(FF)) fail('ffmpeg introuvable dans tools/ffmpeg (nécessaire pour redimensionner l’icône).');
const tmp = mkdtempSync(join(tmpdir(), 'atelier-ico-'));
const sizes = [16, 24, 32, 48, 64, 128, 256], pngs = [];
for (const s of sizes) {
  const out = join(tmp, `i${s}.png`);
  const r = spawnSync(FF, ['-v', 'error', '-y', '-i', SRC, '-vf', `scale=${s}:${s}:flags=lanczos`, '-frames:v', '1', out]);
  if (r.status !== 0 || !existsSync(out)) fail('Redimensionnement de l’icône impossible (' + s + ' px).');
  pngs.push(readFileSync(out));
}
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12); offset += pngs[i].length;
  return e;
});
writeFileSync(ICO, Buffer.concat([head, ...dir, ...pngs]));
rmSync(tmp, { recursive: true, force: true });
say('✓ Icône créée : launcher/atelier.ico (' + sizes.join(', ') + ' px)');

// --- 2. Node embarqué (le dossier devient autonome)
const NODE = join(ROOT, 'tools', 'node', 'node.exe');
if (!existsSync(NODE)) { mkdirSync(dirname(NODE), { recursive: true }); copyFileSync(process.execPath, NODE); say('✓ node.exe copié dans tools/node/ (' + process.version + ')'); }
else say('✓ tools/node/node.exe déjà présent');

// --- 3. compilation
const fw = join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET', 'Framework64');
const versions = existsSync(fw) ? readdirSync(fw).filter((d) => existsSync(join(fw, d, 'csc.exe'))).sort() : [];
if (!versions.length) fail('Le compilateur C# de Windows (csc.exe) est introuvable : .NET Framework 4 est normalement fourni avec Windows.');
const CSC = join(fw, versions.at(-1), 'csc.exe'), EXE = join(ROOT, 'Atelier.exe');
const r = spawnSync(CSC, ['/nologo', '/target:winexe', '/optimize+', `/out:${EXE}`, `/win32icon:${ICO}`, '/r:System.dll', '/r:System.Windows.Forms.dll', join(ROOT, 'launcher', 'Atelier.cs')], { encoding: 'utf8' });
if (r.status !== 0 || !existsSync(EXE)) fail('Compilation échouée :\n' + (r.stdout || '') + (r.stderr || ''));
say('✓ Atelier.exe construit (' + Math.round(readFileSync(EXE).length / 1024) + ' Ko)');
say('\nDouble-cliquez sur Atelier.exe pour lancer l’atelier. Pour un raccourci avec l’icône : clic droit › Envoyer vers › Bureau (créer un raccourci).');
