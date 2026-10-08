// Génère le fichier REPRÉSENTATIF à ouvrir dans Illustrator : docs/verification-illustrator/
//   node tests/illustrator-sample.mjs
// Le design réunit tout ce que la procédure vérifie : titre sur 2 lignes, bandeau incliné, logo, photo remplaçable,
// dégradé, lignes en capitales espacées, couleur et taille modifiées à la main.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TMP = mkdtempSync(join(tmpdir(), 'ai-sample-')), PORT = 3988, U = `http://127.0.0.1:${PORT}`;
const OUT = join(ROOT, 'docs', 'verification-illustrator');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function png(w, h, seed) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const ring = Math.abs(Math.hypot(x - w / 2, y - h * 0.35) - h * 0.2) < 6; raw[o] = ring ? 255 : (30 + x * 60 / w + seed * 30) & 255; raw[o + 1] = ring ? 220 : (20 + y * 50 / h) & 255; raw[o + 2] = ring ? 120 : (70 + seed * 50 + y * 90 / h) & 255; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'src/server.js')], { env: { ...process.env, PORT: String(PORT), ATELIER_DATA: TMP }, stdio: 'ignore' });
try {
  await sleep(2500);
  const F = { 'content-type': 'application/x-www-form-urlencoded', origin: U };
  await fetch(U + '/setup', { method: 'POST', headers: F, body: new URLSearchParams({ name: 'Test', password: 'motdepasse-test' }) });
  const lr = await fetch(U + '/login', { method: 'POST', redirect: 'manual', headers: F, body: new URLSearchParams({ name: 'Test', password: 'motdepasse-test' }) });
  const ck = lr.headers.get('set-cookie').split(';')[0];
  const post = (p, o) => fetch(U + p, { method: 'POST', redirect: 'manual', headers: { ...F, cookie: ck }, body: new URLSearchParams(o) });
  const up = async (role, name, buf) => (await (await fetch(`${U}/assets/upload?edition=1&role=${role}&name=${name}`, { method: 'POST', headers: { origin: U, cookie: ck }, body: buf })).json()).id;
  await post('/edition/new', { label: 'Fichier test Illustrator' });
  const hero = await up('hero', 'photo-de-fond.png', png(1080, 1350, 1)), logo = await up('logo', 'logo.png', png(420, 160, 2)), partner = await up('partner', 'partenaire.png', png(420, 160, 0));
  await post('/edition/1/save', { title_en: 'NIGHT SHOW', tagline_en: 'An after-dark walk through light and sound', top_line_en: 'Every evening from sunset', cta_book_en: 'Book your tickets', venue_status: 'à confirmer', color_primary: '#1b1b2f', color_secondary: '#c8a24a', color_text: '#f5f1e8', font_title: 'Georgia', font_body: 'Segoe UI', booking_url: 'https://tickets.example.com/night-show', date_start: '2027-03-02', date_end: '2027-05-20' });
  const base = { hero: String(hero), logo: String(logo), partners: '1', gradient: '65' };
  await post('/edition/1/poster/4x5/save', { ...base, style: 'bandeau', els: JSON.stringify({ title: { dx: 10, dy: -20, s: 108, color: '#ffd166' }, top: { s: 110 } }) });
  await post('/edition/1/poster/16x9/save', { ...base, style: 'classique', els: JSON.stringify({ title: { dx: 0, dy: -10 } }) });
  await post('/edition/1/designs/save', { name: 'Design représentatif (test Illustrator)', note: 'Titre 2 lignes, bandeau incliné, logo, photo, dégradé' });
  const b = await post('/edition/1/designs/bundle/1', {});
  const page = await (await fetch(U + '/edition/1/designs', { headers: { cookie: ck } })).text();
  const id = /exports\/(\d+)\?dl=1">Télécharger/.exec(page)?.[1];
  const zip = join(TMP, 'archive.zip');
  writeFileSync(zip, Buffer.from(await (await fetch(`${U}/exports/${id}`, { headers: { cookie: ck } })).arrayBuffer()));
  const ex = join(TMP, 'x'); mkdirSync(ex);
  spawnSync('C:/Windows/System32/tar.exe', ['-x', '-f', zip, '-C', ex]);
  const top = readdirSync(ex)[0];
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
  for (const f of ['svg/4x5.svg', 'svg/16x9.svg', 'pdf/4x5.pdf', 'pdf/16x9.pdf', 'apercus/4x5.png', 'apercus/16x9.png', 'VERIFICATION-ILLUSTRATOR.txt', 'design.json']) {
    mkdirSync(join(OUT, f.includes('/') ? f.split('/')[0] : '.'), { recursive: true });
    cpSync(join(ex, top, f), join(OUT, f));
  }
  writeFileSync(join(OUT, 'LISEZMOI.txt'), 'Fichiers représentatifs pour tester l’export Illustrator.\r\nSuivez VERIFICATION-ILLUSTRATOR.txt (30 minutes). svg/ et pdf/ : à ouvrir dans Illustrator ; apercus/ : le rendu attendu.\r\nCe dossier est généré par : node tests/illustrator-sample.mjs\r\n');
  console.log('Fichier de test Illustrator généré dans', OUT, existsSync(join(OUT, 'svg', '4x5.svg')) ? '(ok)' : '(ÉCHEC)', b.status);
} finally { srv.kill(); await sleep(400); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignoré */ } }
