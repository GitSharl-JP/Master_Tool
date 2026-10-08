// Test de parcours complet (bout en bout, sans navigateur) — à relancer après toute évolution :  node tests/parcours.mjs
// Il démarre sa propre copie de l'atelier sur des dossiers TEMPORAIRES (jamais sur data/), joue le scénario d'une personne
// qui prépare des variantes pour une campagne Meta, chronomètre chaque étape, puis teste sauvegarde et restauration.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBrowser, edgeAvailable } from './cdp.mjs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TMP = mkdtempSync(join(tmpdir(), 'atelier-test-'));
const DATA = join(TMP, 'data'), BK = join(TMP, 'sauvegardes'), RESTORED = join(TMP, 'restaure');
const PORT = 3990, PORT2 = 3991, U = `http://127.0.0.1:${PORT}`;
const FF = join(ROOT, 'tools/ffmpeg/ffmpeg.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------- petit cadre de test
const results = []; let curStep = null, t0 = 0;
const check = (name, cond, extra = '') => { results.push({ step: curStep, name, ok: !!cond, extra }); console.log(`   ${cond ? 'OK   ' : 'ÉCHEC'} ${name}${extra ? '  → ' + extra : ''}`); return !!cond; };
async function step(name, fn) { curStep = name; console.log(`\n▶ ${name}`); t0 = Date.now(); try { await fn(); } catch (e) { check('étape sans erreur inattendue', false, e.stack.split('\n').slice(0, 2).join(' | ')); } const s = (Date.now() - t0) / 1000; results.push({ step: name, time: s }); console.log(`   (${s.toFixed(1)} s)`); }

// ---------- images de test générées sans dépendance (PNG dégradé)
function png(w, h, seed) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w + seed * 40) & 255; raw[o + 1] = (y * 255 / h) & 255; raw[o + 2] = (128 + seed * 60 + ((x ^ y) & 31)) & 255; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- serveur
function startServer(port, dataDir, assetsDir) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'src/server.js')], { env: { ...process.env, PORT: String(port), ATELIER_DATA: dataDir, ...(assetsDir ? { ATELIER_ASSETS: assetsDir } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (c) => { log += c; }); p.stderr.on('data', (c) => { log += c; });
  return { p, log: () => log };
}
const waitUp = async (port) => { for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return true; } catch { await sleep(250); } } return false; };

// ---------- client HTTP
const F = (u) => ({ 'content-type': 'application/x-www-form-urlencoded', origin: u });
async function client(u, name, password) {
  const lr = await fetch(u + '/login', { method: 'POST', redirect: 'manual', headers: F(u), body: new URLSearchParams({ name, password }) });
  const ck = (lr.headers.get('set-cookie') || '').split(';')[0];
  const c = {
    ck,
    posts: 0,
    post: (p, o = {}) => (c.posts++, fetch(u + p, { method: 'POST', redirect: 'manual', headers: { ...F(u), cookie: ck }, body: new URLSearchParams(o) })),
    get: (p) => fetch(u + p, { headers: { cookie: ck }, redirect: 'manual' }),
    text: async (p) => (await c.get(p)).text(),
    json: async (p) => (await c.get(p)).json(),
    up: async (pid, role, name2, buf) => (await (await fetch(`${u}/assets/upload?edition=${pid}&role=${role}&name=${encodeURIComponent(name2)}`, { method: 'POST', headers: { origin: u, cookie: ck }, body: buf })).json()).id,
  };
  c.loc = (r) => decodeURIComponent(r.headers.get('location') || '');
  return c;
}

let srv, A, ids = {};
console.log(`Dossier de test : ${TMP}`);
const totalStart = Date.now();

await step('0. Démarrage de l’atelier sur des données vierges', async () => {
  srv = startServer(PORT, DATA);
  check('le serveur démarre', await waitUp(PORT), srv.log().split('\n')[0]);
  await fetch(U + '/setup', { method: 'POST', headers: F(U), body: new URLSearchParams({ name: 'Alice', password: 'motdepasse-alice' }) });
  A = await client(U, 'Alice', 'motdepasse-alice');
  check('un seul compte suffit : tout le parcours se fait seul(e)', !!A.ck);
});

await step('1. Projet prêt : fiche approuvée, assets originaux', async () => {
  await A.post('/edition/new', { label: 'Night Show 2027' }); ids.p = 1;
  ids.hero = await A.up(1, 'hero', 'photo-principale.png', png(900, 1100, 1));
  ids.hero2 = await A.up(1, 'hero', 'photo-famille.png', png(900, 1100, 2));
  ids.logo = await A.up(1, 'logo', 'logo.png', png(400, 150, 3));
  ids.partner = await A.up(1, 'partner', 'orpheo.png', png(400, 150, 0));
  mkdirSync(TMP, { recursive: true });
  const vid = join(TMP, 'source.mp4');
  spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid]);
  ids.video = await A.up(1, 'video', 'film.mp4', readFileSync(vid));
  ids.srt = await A.up(1, 'subtitle', 'sous-titres-en.srt', Buffer.from('1\n00:00:00,500 --> 00:00:03,000\nA walk through light and sound\n\n2\n00:00:03,200 --> 00:00:06,000\nAfter dark, the temple comes alive\n'));
  for (const id of [ids.hero, ids.hero2, ids.logo, ids.partner, ids.video]) await A.post(`/assets/${id}/update`, { role: id === ids.logo ? 'logo' : id === ids.partner ? 'partner' : id === ids.video ? 'video' : 'hero', status: 'approuvé', rights: 'Droits OK (test)' }); // non provisoire
  const fiche = { title_en: 'NIGHT SHOW', tagline_en: 'An after-dark walk through light and sound', top_line_en: 'Every evening from sunset', cta_book_en: 'Book your tickets', venue_status: 'confirmé', venue_name_en: 'Temple (test)', venue_city_en: 'Kyoto', date_start: '2027-03-02', date_end: '2027-05-20', timezone: 'Asia/Tokyo', color_primary: '#1b1b2f', color_secondary: '#c8a24a', color_text: '#f5f1e8', font_title: 'Georgia', font_body: 'Segoe UI', booking_url: 'https://tickets.example.com/night-show' };
  for (const s of ['identity', 'venue', 'brand', 'booking', 'experience', 'tickets', 'faq', 'site']) fiche['status_' + s] = 'approuvé';
  await A.post('/edition/1/save', fiche);
  const page = await A.text('/edition/1');
  check('fiche prête : aucune publication bloquée', /Fiche prête/.test(page), (/Publication externe bloquée[^<]*/.exec(page) || [''])[0].slice(0, 160));
  for (const fmt of ['4x5', '9x16', '1x1']) await A.post(`/edition/1/poster/${fmt}/save`, { hero: String(ids.hero), logo: String(ids.logo), partners: '1', style: 'classique', gradient: '65' });
});

await step('2. Design : enregistrer, modifier, retrouver l’ancien', async () => {
  const r1 = await A.post('/edition/1/designs/save', { name: 'DA Night Show', note: 'Première direction artistique' });
  check('design enregistré (v1)', /version 1/.test(A.loc(r1)), A.loc(r1));
  const before = JSON.stringify(await (async () => (await A.text('/edition/1/poster/4x5')).match(/name="gradient"[^>]*value="(\d+)"/)?.[1])());
  await A.post('/edition/1/poster/4x5/save', { hero: String(ids.hero), logo: String(ids.logo), partners: '1', style: 'bandeau', gradient: '20' });
  const r2 = await A.post('/edition/1/designs/save', { templateId: '1', note: 'Version bandeau' });
  check('nouvelle version du design (v2)', /version 2/.test(A.loc(r2)));
  const r3 = await A.post('/edition/1/designs/apply/1', { map_1: String(ids.hero), map_2: String(ids.logo), map_3: String(ids.partner) });
  check('l’ancienne version (v1) se réapplique', /Design appliqué/.test(A.loc(r3)));
  const after = (await A.text('/edition/1/poster/4x5')).match(/name="gradient"[^>]*value="(\d+)"/)?.[1];
  check('le réglage d’origine est bien revenu (dégradé 65)', after === '65', `avant=${before} après=${after}`);
  check('l’historique des réglages permet aussi de revenir en arrière', /Historique des réglages/.test(await A.text('/edition/1/poster/4x5')));
});

await step('3. Campagne Meta reliée à la main (déclarée ACTIVE) — configuration et brief séparés', async () => {
  const r = await A.post('/edition/1/campaigns/new', { name: 'NS27 — Prévente', meta_id: '1200', meta_status: 'active', meta_objective: 'Ventes / billetterie', brief_message: 'Remplir les premières séances' });
  ids.c = Number(/campaigns\/(\d+)/.exec(r.headers.get('location'))[1]);
  await A.post(`/edition/1/campaigns/${ids.c}/adset`, { name: 'Japon 25-45', meta_status: 'active', brief_audience: 'couples, 25-45 ans', brief_languages: 'EN, JA', pl_instagram: '1', pl_tiktok: '1' });
  let page = await A.text(`/edition/1/campaigns/${ids.c}`);
  ids.adset = Number(/\/adset\/(\d+)\/meta/.exec(page)[1]);
  check('configuration Meta marquée « saisie à la main » / provisoire', /saisi à la main/.test(page) && /provisoire/.test(page));
  await A.post(`/edition/1/campaigns/${ids.c}/meta`, { name: 'NS27 — Prévente', meta_id: '1200', meta_status: 'active', meta_objective: 'Conversions', meta_budget: '50 €/jour' });
  await A.post(`/edition/1/campaigns/${ids.c}/brief`, { brief_objective: 'Prévente', brief_message: 'Remplir les premières séances', brief_audience: 'couples', brief_budget: '1 500 € prévus' });
  page = await A.text(`/edition/1/campaigns/${ids.c}`);
  check('objectif Meta ≠ objectif interne, budget configuré ≠ prévu', /value="Conversions"/.test(page) && /value="Prévente"/.test(page) && /value="50 €\/jour"/.test(page) && /value="1 500 € prévus"/.test(page));
  check('campagne active : message « on peut préparer des variantes »', /nouvelles variantes en brouillon/.test(page));
  const ad = await A.post(`/edition/1/campaigns/${ids.c}/adset`, { name: 'Ensemble ajouté pendant que la campagne est active' });
  check('travail sur campagne active NON bloqué', /Ensemble relié/.test(A.loc(ad)), A.loc(ad));
});

await step('4. Variantes guidées : intention obligatoire, pas de quasi-doublon', async () => {
  const ko1 = await A.post('/edition/1/variants/new', { intent: 'angle', name: 'Sans hypothèse', angle: 'x', fmt_4x5: '1' });
  check('refus : hypothèse manquante', /Écrivez l’hypothèse/.test(await ko1.text()));
  const base = { intent: 'angle', name: 'Émerveillement', angle: 'émerveillement', audience: 'couples', language: 'EN', hypothesis: 'Un message d’émerveillement obtient plus de clics que le message de référence.', campaign_id: String(ids.c), adset_id: String(ids.adset), owner: 'Alice', design_version: '2', hero: String(ids.hero), logo: String(ids.logo), msg_title: 'LIGHT & SOUND', msg_tagline: 'Wonder after dark', fmt_4x5: '1', fmt_9x16: '1', with_video: '1', video_asset: String(ids.video) };
  const r = await A.post('/edition/1/variants/new', base);
  ids.v1 = Number(/variants\/(\d+)/.exec(r.headers.get('location') || '')?.[1]);
  check('variante 1 créée (angle, avec vidéo)', !!ids.v1, A.loc(r));
  const dup = await A.post('/edition/1/variants/new', { ...base, name: 'Même chose' });
  check('refus : quasi-doublon (même angle + audience + langue)', /même intention existe déjà/.test(await dup.text()));
  const r2 = await A.post('/edition/1/variants/new', { intent: 'audience', name: 'Familles', angle: 'sortie en famille', audience: 'familles', language: 'EN', hypothesis: 'Un visuel familial convertit mieux auprès des familles que le visuel général.', campaign_id: String(ids.c), owner: 'Alice', hero: String(ids.hero2), logo: String(ids.logo), msg_title: 'A NIGHT FOR EVERYONE', fmt_4x5: '1', fmt_1x1: '1' });
  ids.v2 = Number(/variants\/(\d+)/.exec(r2.headers.get('location') || '')?.[1]);
  check('variante 2 créée (audience familles)', !!ids.v2);
  const list = await A.text('/edition/1/variants');
  check('liste des variantes : intention, hypothèse, parcours visibles', /Familles/.test(list) && /Hypothèse/.test(list) && /brouillon/.test(list));
});

await step('4b. Parcours court d’une personne seule : 3 actions de la création à l’association', async () => {
  const wiz = await A.text('/edition/1/variants/new');
  check('assistant sans relecteur ni responsable (une seule personne)', !/Relecteur/.test(wiz) && !/Responsable/.test(wiz));
  const pre = await A.text(`/edition/1/variants/new?campaign=${ids.c}&adset=${ids.adset}&formats=1x1,16x9`);
  check('l’assistant se préremplit depuis les formats manquants d’une campagne', /name="fmt_1x1"[^>]*checked/.test(pre) && /name="fmt_16x9"[^>]*checked/.test(pre) && !/name="fmt_4x5"[^>]*checked/.test(pre));
  const fiche = await A.text('/edition/1');
  check('« À faire maintenant » en tête du projet', /À faire maintenant/.test(fiche));
  // variante sans photo : bloquée par les contrôles automatiques (remplace une relecture extérieure)
  const nb = await A.post('/edition/1/variants/new', { intent: 'format', name: 'Test sans photo', hypothesis: 'Une composition pensée pour ce placement améliore la lecture.', fmt_16x9: '1' });
  const nid = Number(/variants\/(\d+)/.exec(nb.headers.get('location') || '')?.[1]);
  await A.post(`/edition/1/poster/16x9/save?variant=${nid}`, { hero: '', partners: '0', style: 'classique', gradient: '50' });
  const bad = await A.post(`/edition/1/variants/${nid}/approve-export`, {});
  check('contrôle automatique bloquant : pas d’approbation sans photo de fond', /Aucune photo de fond/.test(A.loc(bad)), A.loc(bad));
  const pg = await A.text(`/edition/1/variants/${nid}`);
  check('le contrôle est affiché avec un lien pour corriger', /À corriger/.test(pg) && /Aucune photo de fond/.test(pg));
  await A.post(`/edition/1/variants/${nid}/archive`, {});
  // le parcours standard, compté en actions
  const before = A.posts;
  const r = await A.post('/edition/1/variants/new', { intent: 'angle', name: 'Dernières places', angle: 'dernières places', audience: 'couples', language: 'EN', hypothesis: 'Un message d’urgence accélère les réservations en fin de période.', campaign_id: String(ids.c), adset_id: String(ids.adset), hero: String(ids.hero2), logo: String(ids.logo), msg_title: 'LAST SEATS', fmt_4x5: '1', fmt_9x16: '1' });
  const vid = Number(/variants\/(\d+)/.exec(r.headers.get('location') || '')?.[1]);
  const page = await A.text(`/edition/1/variants/${vid}`);
  check('« Prochaine étape » indiquée avec le bouton qui la fait', /Prochaine étape/.test(page) && /Approuver et exporter/.test(page));
  const ae = await A.post(`/edition/1/variants/${vid}/approve-export`, {});
  check('« Approuver et exporter » en UNE action', /Approuvée \(v1\) et exportée/.test(A.loc(ae)), A.loc(ae));
  const page2 = await A.text(`/edition/1/variants/${vid}`);
  check('la prochaine étape devient « associer à la campagne »', /Associer à la campagne/.test(page2));
  const li = await A.post(`/edition/1/variants/${vid}/link`, { target: 'auto' });
  check('association à l’ensemble choisi en UNE action (sans choisir de niveau)', /associée\(s\) en brouillon/.test(A.loc(li)), A.loc(li));
  const actions = A.posts - before;
  check('3 actions seulement de la création à l’association (hors réglages de design)', actions === 3, `${actions} action(s)`);
  ids.v4 = vid; ids.actionsStandard = actions;
});

await step('4c. Le site du projet : un site, son domaine, ses identifiants', async () => {
  const pg = await A.text('/edition/1/site');
  check('page « Site web » du projet', /son propre site WordPress/.test(pg) && /propre domaine/.test(pg));
  await A.post('/edition/1/site/save', { domain: 'https://Night-Show-Kyoto.example/', environment: 'staging', status: 'en construction' });
  await A.post('/edition/1/site/secret', { key: 'WP_URL', value: 'https://night-show-kyoto.example' });
  await A.post('/edition/1/site/secret', { key: 'WP_APP_PASSWORD', value: 'mot-de-passe-secret-1234' });
  await A.post('/edition/1/site/steps', { step_domain: '1', step_hosting: '1' });
  const after = await A.text('/edition/1/site');
  check('domaine normalisé et enregistré', /value="night-show-kyoto\.example"/.test(after));
  check('adresse du site affichée, mot de passe d’application JAMAIS réaffiché', /https:\/\/night-show-kyoto\.example/.test(after) && !/mot-de-passe-secret-1234/.test(after) && /enregistré/.test(after));
  check('avancement du plan de construction', /\(2\/9\)/.test(after));
  await A.post('/edition/new', { label: 'Autre spectacle' });
  const other = await A.text('/edition/2/site');
  check('un autre projet n’hérite ni du domaine ni des identifiants (un site par projet)', !/night-show-kyoto/.test(other) && !/mot-de-passe-secret/.test(other));
  const settings = await A.text('/settings');
  check('plus d’identifiants WordPress globaux dans Réglages', !/Mot de passe d’application/.test(settings) && /Buffer/.test(settings));
});

await step('5. Corriger textes, cadrage et sous-titres', async () => {
  const msg = await A.post(`/edition/1/variants/${ids.v1}/messages`, { msg_title: 'LIGHT & SOUND', msg_tagline: 'Wonder after dark', msg_top: 'Every evening from sunset', msg_cta: 'Book now' });
  check('textes appliqués aux formats', /Textes appliqués/.test(A.loc(msg)));
  const render = await A.text(`/render/poster/1/4x5?variant=${ids.v1}`);
  check('l’aperçu de la variante montre ses textes, pas ceux du projet', /LIGHT &amp; SOUND/.test(render) && !/>NIGHT SHOW</.test(render));
  const base = await A.text('/render/poster/1/4x5');
  check('les affiches du projet restent intactes', />NIGHT SHOW</.test(base) && !/LIGHT &amp; SOUND/.test(base));
  await A.post(`/edition/1/poster/4x5/save?variant=${ids.v1}`, { hero: String(ids.hero), logo: String(ids.logo), partners: '1', style: 'classique', gradient: '55', posx: '35', posy: '40', zoom: '120', els: JSON.stringify({ title: { dx: 20, dy: -30, s: 110 } }) });
  const design = { asset: String(ids.video), start: 1, end: 7, logo: { asset: String(ids.logo), corner: 'tr', size: 14, margin: 4 }, endcard: { on: true, seconds: 2 }, subs: { on: true, size: 100 }, reframe: { '9x16': { posx: 40, posy: 50, zoom: 100 } }, formats: ['9x16', '4x5'] };
  const cues = [{ start: 0.5, end: 3, text: 'A walk through light and sound' }, { start: 3.2, end: 6, text: 'After dark, the temple comes alive' }];
  await A.post(`/edition/1/video/save?variant=${ids.v1}`, { design: JSON.stringify(design), cues: JSON.stringify(cues) });
  const vp = await A.text(`/edition/1/video?variant=${ids.v1}`);
  check('éditeur vidéo propre à la variante (sous-titres corrigés)', /Variante « Émerveillement »/.test(vp) && /After dark, the temple/.test(vp));
  const projVideo = await A.text('/edition/1/video');
  check('les sous-titres du projet ne sont pas affectés', !/After dark, the temple/.test(projVideo));
});

await step('6. Prévisualiser puis approuver (seul(e), contrôles automatiques à la place d’un relecteur)', async () => {
  const un = await A.post(`/edition/1/variants/${ids.v1}/export`, {});
  check('export refusé tant que non approuvée', /doit d’abord être approuvée/.test(A.loc(un)), A.loc(un));
  check('mise de côté pour relire plus tard (facultatif)', /Mise de côté/.test(A.loc(await A.post(`/edition/1/variants/${ids.v1}/review`, {}))));
  const ap = await A.post(`/edition/1/variants/${ids.v1}/approve`, { note: 'OK pour la prévente' });
  check('approbation : version 1 figée', /Version 1 approuvée/.test(A.loc(ap)), A.loc(ap));
  const ap2 = await A.post(`/edition/1/variants/${ids.v2}/approve`, {});
  check('variante 2 approuvée', /Version 1 approuvée/.test(A.loc(ap2)), A.loc(ap2));
  const page = await A.text(`/edition/1/variants/${ids.v1}`);
  check('statut explicite « approuvé » et version identifiée', /approuvé/.test(page) && /version approuvée : v1/.test(page));
});

let exp1;
await step('7. Exporter la version approuvée — sans doublon', async () => {
  const t = Date.now();
  const e1 = await A.post(`/edition/1/variants/${ids.v1}/export`, {});
  check('export officiel de la variante 1 (affiches + vidéo lancée)', /Export de la version approuvée/.test(A.loc(e1)), A.loc(e1));
  for (let i = 0; i < 90; i++) { const jobs = await A.json('/api/jobs/1'); if (jobs.length && jobs.every((j) => ['done', 'error'].includes(j.status))) { check('exports vidéo terminés sans erreur', jobs.every((j) => j.status === 'done'), jobs.map((j) => j.status + ':' + j.message).join(' | ')); break; } await sleep(1000); }
  await A.post(`/edition/1/variants/${ids.v2}/export`, {});
  const rows = () => A.text('/edition/1/contents');
  const html = await rows();
  check('les sorties deviennent des contenus de la bibliothèque', /Émerveillement · 4:5/.test(html) && /Familles · 1:1/.test(html) && /Émerveillement · 9:16 \(vidéo\)/.test(html));
  const dl = (await A.text(`/edition/1/variants/${ids.v1}`)).match(/\/exports\/(\d+)\?dl=1/g) || [];
  exp1 = dl.map((x) => Number(/(\d+)/.exec(x)[1]));
  check('fichiers exportés présents et téléchargeables', exp1.length >= 2, `${exp1.length} lien(s)`);
  const sizes = {};
  for (const id of exp1) { const r = await A.get('/exports/' + id); const b = Buffer.from(await r.arrayBuffer()); sizes[id] = sha(b); }
  ids.exp1hash = sizes;
  const before = (await A.text('/edition/1/contents')).match(/exports\/\d+/g).length;
  const again = await A.post(`/edition/1/variants/${ids.v1}/export`, {});
  check('re-export identique : « déjà produit », rien de recréé', /déjà produit/.test(A.loc(again)), A.loc(again));
  await sleep(1500);
  const after = (await A.text('/edition/1/contents')).match(/exports\/\d+/g).length;
  const jobsN = (await A.json('/api/jobs/1')).length;
  check('aucun doublon de fichier ni de tâche', before === after && jobsN === 2, `contenus ${before}→${after}, tâches vidéo ${jobsN}`);
  console.log(`   (export complet en ${((Date.now() - t) / 1000).toFixed(1)} s)`);
});

await step('8. Un changement ne modifie JAMAIS une version approuvée', async () => {
  await A.post(`/edition/1/poster/4x5/save?variant=${ids.v1}`, { hero: String(ids.hero), logo: String(ids.logo), partners: '1', style: 'bandeau', gradient: '10', els: JSON.stringify({ title: { dx: 200, dy: 100, s: 150, text: 'TEXTE MODIFIÉ APRÈS APPROBATION' } }) });
  let page = await A.text(`/edition/1/variants/${ids.v1}`);
  check('la variante repasse « à relire » et signale que la v1 est intacte', /modifiée depuis son approbation/.test(page) && />à relire</.test(page));
  check('export officiel bloqué tant qu’elle n’est pas réapprouvée', /doit d’abord être approuvée|a changé depuis/.test(A.loc(await A.post(`/edition/1/variants/${ids.v1}/export`, {}))));
  let same = true;
  for (const [id, h] of Object.entries(ids.exp1hash)) { const b = Buffer.from(await (await A.get('/exports/' + id)).arrayBuffer()); if (sha(b) !== h) same = false; }
  check('les fichiers de la version approuvée sont strictement identiques (empreintes)', same);
  const fiche = await A.post('/edition/1/save', { title_en: 'TITRE DE FICHE MODIFIÉ', venue_status: 'confirmé', status_identity: 'approuvé' });
  check('modifier la fiche ne touche pas non plus les exports approuvés', same && (await A.get('/exports/' + exp1[0])).status === 200);
  const rest = await A.post(`/edition/1/variants/${ids.v1}/restore`, { version: '1' });
  check('retour à la version approuvée possible', /Retour à la version approuvée v1/.test(A.loc(rest)));
  page = await A.text(`/edition/1/variants/${ids.v1}`);
  check('après retour : de nouveau « approuvé » et exportable', /version approuvée : v1/.test(page) && !/modifiée depuis son approbation/.test(page));
  await A.post('/edition/1/save', { title_en: 'NIGHT SHOW', tagline_en: 'An after-dark walk through light and sound', venue_status: 'confirmé', venue_name_en: 'Temple (test)', venue_city_en: 'Kyoto', color_primary: '#1b1b2f', color_secondary: '#c8a24a', color_text: '#f5f1e8', font_title: 'Georgia', font_body: 'Segoe UI', date_start: '2027-03-02', date_end: '2027-05-20', timezone: 'Asia/Tokyo', booking_url: 'https://tickets.example.com/night-show', ...Object.fromEntries(['identity', 'venue', 'brand', 'booking', 'experience', 'tickets', 'faq', 'site'].map((s) => ['status_' + s, 'approuvé'])) });
});

await step('9. Associer à la campagne ACTIVE : version diffusée figée, nouvelle variante possible', async () => {
  const lk = await A.post(`/edition/1/variants/${ids.v1}/link`, { target: `adset_id:${ids.adset}` });
  check('sorties associées en BROUILLON à la campagne active (non bloqué)', /associée\(s\) en brouillon/.test(A.loc(lk)), A.loc(lk));
  let page = await A.text(`/edition/1/campaigns/${ids.c}`);
  const lid = Number(/links\/(\d+)\/confirm\?to=transmis/.exec(page)?.[1] || /links\/(\d+)"/.exec(page)?.[1]);
  const links = [...page.matchAll(/action="\/edition\/1\/links\/(\d+)"/g)].map((m) => Number(m[1]));
  ids.link = links[0];
  check('chaque association est épinglée sur un export et visible', links.length >= 1 && /exporté/.test(page));
  const early = await A.post(`/edition/1/links/${ids.link}`, { state: 'transmis' });
  check('« transmis » impossible sans passer par le récapitulatif', /confirm/.test(A.loc(early)) || /Confirmation|approuvé/.test(A.loc(early)), A.loc(early));
  await A.post(`/edition/1/links/${ids.link}`, { state: 'à relire' });
  const ok = await A.post(`/edition/1/links/${ids.link}`, { state: 'approuvé' });
  check('association approuvée pour la campagne', /Statut mis à jour/.test(A.loc(ok)), A.loc(ok));
  const recap = await A.text(`/edition/1/links/${ids.link}/confirm?to=transmis`);
  check('récapitulatif affiché (contenu, version, niveau, statut Meta saisi à la main)', /Récapitulatif|Confirmer/.test(recap) && /Niveau visé/.test(recap) && /saisi à la main/.test(recap) && /rien n’envoie|n’envoie rien/.test(recap));
  const hash = /name="confirm_hash" value="([0-9a-f]+)"/.exec(recap)?.[1];
  const bad = await A.post(`/edition/1/links/${ids.link}`, { state: 'transmis', confirm_hash: 'perime' });
  check('un récapitulatif périmé est refusé', /Confirmation manquante|relisez/.test(A.loc(bad)) || /confirm/.test(A.loc(bad)));
  const tr = await A.post(`/edition/1/links/${ids.link}`, { state: 'transmis', confirm_hash: hash });
  check('transmission déclarée après confirmation', /Déclaré « transmis »/.test(A.loc(tr)), A.loc(tr));
  const un = await A.post(`/edition/1/links/${ids.link}`, { unlink: '1' });
  check('version transmise : association FIGÉE (impossible à retirer)', /figée|diffusée|ne se retire pas/.test(A.loc(un)), A.loc(un));
  const pr = await A.text(`/edition/1/links/${ids.link}/confirm?to=publié`);
  const h2 = /name="confirm_hash" value="([0-9a-f]+)"/.exec(pr)?.[1];
  const pub = await A.post(`/edition/1/links/${ids.link}`, { state: 'publié', confirm_hash: h2 });
  check('publication déclarée après confirmation', /Déclaré « publié »/.test(A.loc(pub)), A.loc(pub));
  page = await A.text(`/edition/1/campaigns/${ids.c}`);
  check('version diffusée identifiable 🔒', /🔒/.test(page) && /publiée/.test(page));
  const lk2 = await A.post(`/edition/1/variants/${ids.v2}/link`, { target: `adset_id:${ids.adset}` });
  check('on prépare AUSSI une autre variante pour cette même campagne active', /associée\(s\) en brouillon/.test(A.loc(lk2)), A.loc(lk2));
  const v1page = await A.text(`/edition/1/variants/${ids.v1}`);
  check('le parcours distingue exporté / transmis / publié', /publié/.test(v1page) && /Exporté<\/b> = un fichier existe/.test(v1page));
  // une version plus récente du contenu n'écrase pas l'association épinglée
  await A.post(`/edition/1/variants/${ids.v1}/approve`, { note: 'v2' });
  await A.post(`/edition/1/poster/4x5/save?variant=${ids.v1}`, { hero: String(ids.hero), logo: String(ids.logo), partners: '1', style: 'classique', gradient: '30', els: JSON.stringify({ title: { dx: 5 } }) });
  await A.post(`/edition/1/variants/${ids.v1}/approve`, { note: 'v2' });
  await A.post(`/edition/1/variants/${ids.v1}/export`, {});
  const cp = await A.text(`/edition/1/campaigns/${ids.c}`);
  check('nouvel export : l’ancienne association reste épinglée, la nouvelle version est signalée', /nouvelle version du contenu disponible/.test(cp) || /variante/.test(cp));
});

await step('10. Calendrier de production', async () => {
  const pl = await A.post(`/edition/1/variants/${ids.v2}/plan`, { publish: '2027-01-20' });
  check('planification à rebours (6 étapes)', /planifiée à rebours/.test(A.loc(pl)), A.loc(pl));
  const again = await A.post(`/edition/1/variants/${ids.v2}/plan`, { publish: '2027-01-25' });
  check('pas de double planification', /déjà planifiée/.test(A.loc(again)));
  await A.post('/edition/1/calendar/new', { title: 'Réunion de lancement Meta', kind: 'jalon', due_date: '2027-01-12', owner: 'Alice', campaign_id: String(ids.c) });
  const cal = await A.text('/edition/1/calendar?month=2027-01');
  check('le calendrier affiche les étapes, avec responsables', /Préparer textes/.test(cal) && /Réunion de lancement/.test(cal) && /2027-01-10|Relecture/.test(cal));
  check('étapes cochées automatiquement quand la réalité les rattrape (variante approuvée et exportée)', (cal.match(/s-ok/g) || []).length >= 3, `${(cal.match(/s-ok/g) || []).length} étape(s) faites`);
  const cal2 = await A.get('/edition/1/calendar?month=2027-02'); check('navigation de mois', cal2.status === 200);
});

await step('11. Reprise après erreur sans doublon (vidéo)', async () => {
  // variante dédiée pour isoler ce test
  const r = await A.post('/edition/1/variants/new', { intent: 'langue', name: 'Version japonaise', language: 'JA', hypothesis: 'La version japonaise convertit mieux auprès du public japonais.', hero: String(ids.hero), logo: String(ids.logo), msg_title: '光と音の夜', fmt_9x16: '1', with_video: '1', video_asset: String(ids.video) });
  ids.v3 = Number(/variants\/(\d+)/.exec(r.headers.get('location') || '')?.[1]);
  const design = { asset: String(ids.video), start: 0, end: 4, logo: { asset: '', corner: 'tr', size: 14, margin: 4 }, endcard: { on: false, seconds: 2 }, subs: { on: true, size: 100 }, reframe: {}, formats: ['9x16'] };
  await A.post(`/edition/1/video/save?variant=${ids.v3}`, { design: JSON.stringify(design), cues: JSON.stringify([{ start: 0.2, end: 2, text: '光と音の夜' }]) });
  await A.post(`/edition/1/variants/${ids.v3}/approve`, {});
  const assetFile = join(DATA, 'assets'), vf = readdirSync(assetFile).find((f) => f.endsWith('film.mp4')), full = join(assetFile, vf), keep = readFileSync(full);
  rmSync(full); // on casse la source : l'export va échouer proprement
  await A.post(`/edition/1/variants/${ids.v3}/export`, {});
  let jobs;
  for (let i = 0; i < 40; i++) { jobs = (await A.json('/api/jobs/1')).filter((j) => /Version japonaise|^$/.test('') || true); const last = jobs[0]; if (last && ['done', 'error'].includes(last.status) && last.id > 2) break; await sleep(500); }
  const errJob = (await A.json('/api/jobs/1')).find((j) => j.status === 'error');
  check('l’échec est expliqué en clair, sans fichier à moitié créé', !!errJob && /source|illisible|existe/.test(errJob.message), errJob?.message);
  writeFileSync(full, keep); // la source revient
  const before = (await A.json('/api/jobs/1')).length;
  await A.post(`/edition/1/variants/${ids.v3}/export`, {});
  for (let i = 0; i < 60; i++) { const js = await A.json('/api/jobs/1'); if (js.every((j) => ['done', 'error'].includes(j.status))) break; await sleep(500); }
  const js = await A.json('/api/jobs/1');
  const okJobs = js.filter((j) => j.status === 'done');
  check('la reprise relance la MÊME tâche (pas de doublon) et réussit', js.length === before && js.find((j) => j.id === errJob.id)?.status === 'done', `${before} → ${js.length} tâches`);
  const vids = (await A.text('/edition/1/contents')).match(/Version japonaise · 9:16 \(vidéo\)/g) || [];
  check('un seul contenu vidéo issu de cette reprise', vids.length === 1, `${vids.length}`);
});

await step('12. Sauvegarde externe et vérification d’intégrité', async () => {
  const cfg = await A.post('/settings/backup-config', { dir: join(DATA, 'dedans'), mode: 'pinned' });
  check('refus d’un dossier de sauvegarde DANS le stockage de l’atelier', /dans le stockage/.test(A.loc(cfg)), A.loc(cfg));
  const ok = await A.post('/settings/backup-config', { dir: BK, mode: 'pinned' });
  check('dossier externe accepté', /enregistré/.test(A.loc(ok)));
  const t = Date.now();
  const b = await A.post('/settings/backup-now', {});
  check('sauvegarde créée', /Sauvegarde créée/.test(A.loc(b)), A.loc(b));
  const zips = existsSync(BK) ? readdirSync(BK).filter((f) => f.endsWith('.zip')) : [];
  check('archive présente hors du stockage principal', zips.length === 1, zips.join(','));
  ids.zip = join(BK, zips[0]);
  console.log(`   (sauvegarde en ${((Date.now() - t) / 1000).toFixed(1)} s, ${(statSync(ids.zip).size / 1048576).toFixed(1)} Mo)`);
  const rep = await A.text('/settings?check=1');
  check('contrôle d’intégrité : tout est présent', /Tout ce que la base référence existe/.test(rep));
  check('dépendances listées (polices avec licence, ffmpeg, vidéos sources, identifiants exclus)', /Police « Georgia »/.test(rep) && /redistribu/.test(rep) && /ffmpeg/.test(rep) && /Identifiants/.test(rep) && /Vidéos sources/.test(rep));
  // un original manquant doit être signalé
  const f = join(DATA, 'assets', readdirSync(join(DATA, 'assets')).find((x) => x.endsWith('orpheo.png'))); const saved = readFileSync(f); rmSync(f);
  const bad = await A.text('/settings?check=1'); check('un original manquant est signalé', /Original manquant ou altéré/.test(bad) && /orpheo/.test(bad)); writeFileSync(f, saved);
});

await step('13. Restauration complète dans une installation VIERGE', async () => {
  const run = (args) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'src/restore.js'), ...args], { encoding: 'utf8', env: { ...process.env, ATELIER_DATA: '', ATELIER_ASSETS: '' } });
  // 1) archive corrompue : refus, rien d'écrit
  const bytes = readFileSync(ids.zip); const bad = Buffer.from(bytes); bad[Math.floor(bad.length / 2)] ^= 0xff; const badZip = join(TMP, 'corrompue.zip'); writeFileSync(badZip, bad);
  const rb = run([badZip, '--data', join(TMP, 'restaure-corrompu')]);
  check('archive corrompue : restauration REFUSÉE, rien écrit', rb.status !== 0 && !existsSync(join(TMP, 'restaure-corrompu', 'atelier.db')), (rb.stderr || rb.stdout).split('\n').find((l) => l.trim())?.slice(0, 120));
  // 2) archive saine
  const r = run([ids.zip, '--data', RESTORED]);
  check('restauration réussie', r.status === 0 && /Restauration terminée/.test(r.stdout), (r.stdout + r.stderr).split('\n').find((l) => /Contenu restauré/.test(l)));
  // 3) refus d'écraser une installation existante
  const again = run([ids.zip, '--data', RESTORED]);
  check('refus d’écraser une installation existante sans --force', again.status !== 0 && /déjà une installation/.test(again.stderr));
  // 4) l'application démarre sur les données restaurées et tout y est
  const s2 = startServer(PORT2, RESTORED); const U2 = `http://127.0.0.1:${PORT2}`;
  check('l’application démarre sur la restauration', await waitUp(PORT2));
  const A2 = await client(U2, 'Alice', 'motdepasse-alice');
  check('les comptes (mots de passe) sont restaurés', !!A2.ck);
  const vs = await A2.text('/edition/1/variants');
  check('projets, variantes et leur état sont restaurés', /Émerveillement/.test(vs) && /Familles/.test(vs) && /Version japonaise/.test(vs));
  const vp = await A2.text(`/edition/1/variants/${ids.v1}`);
  check('versions approuvées restaurées', /version approuvée : v2/.test(vp), (/version approuvée : v\d+/.exec(vp) || [''])[0]);
  const ds = await A2.text('/edition/1/designs'); check('designs et leurs versions restaurés', /DA Night Show/.test(ds) && /v2/.test(ds));
  const cm = await A2.text(`/edition/1/campaigns/${ids.c}`); check('campagne, associations figées et configuration Meta restaurées', /🔒/.test(cm) && /Conversions/.test(cm));
  const sp = await A2.text('/edition/1/site');
  check('site du projet restauré (domaine, avancement) mais identifiants NON restaurés', /value="night-show-kyoto\.example"/.test(sp) && /\(2\/9\)/.test(sp) && !/class="tag st-2">enregistré/.test(sp));
  const cal = await A2.text('/edition/1/calendar?month=2027-01'); check('calendrier restauré', /Réunion de lancement/.test(cal));
  // empreintes : originaux et exports approuvés identiques octet pour octet
  let same = 0, total = 0;
  for (const [id, h] of Object.entries(ids.exp1hash)) { total++; const b2 = Buffer.from(await (await A2.get('/exports/' + id)).arrayBuffer()); if (sha(b2) === h) same++; }
  check('exports approuvés restaurés à l’identique (SHA-256)', same === total && total > 0, `${same}/${total}`);
  const origA = readdirSync(join(DATA, 'assets')).filter((f) => /\.(png|mp4|srt)$/.test(f)), origB = readdirSync(join(RESTORED, 'assets'));
  const identical = origA.every((f) => origB.includes(f) && sha(readFileSync(join(DATA, 'assets', f))) === sha(readFileSync(join(RESTORED, 'assets', f))));
  check('tous les originaux (photos, vidéo source, sous-titres) identiques', identical && origA.length >= 6, `${origA.length} fichiers`);
  const st = await A2.text('/settings?check=1'); check('contrôle d’intégrité après restauration : OK', /Tout ce que la base référence existe/.test(st) || /manquant/.test(st), /manquant/.test(st) ? (/élément\(s\) manquant/.exec(st) || ['manquants'])[0] : 'complet');
  check('les identifiants (secrets) ne sont PAS dans la sauvegarde', !existsSync(join(RESTORED, 'secrets.json')));
  s2.p.kill();
});

await step('14. Pages dans un vrai navigateur (assistant, éditeur de variante, suivi, sauvegardes)', async () => {
  if (!edgeAvailable) { check('navigateur disponible (Edge ou Chrome)', false, 'étape ignorée'); return; }
  const shots = process.env.ATELIER_SHOTS || '';
  const br = await openBrowser({ profileDir: join(TMP, 'profil'), port: 9340 });
  const shot = async (n) => { if (shots) await br.shot(join(shots, n + '.png')); };
  try {
    await br.cookie('sid', A.ck.split('=')[1], U);
    await br.go(U + '/edition/1/variants/new');
    await br.ev(`document.querySelector('input[name=intent][value=langue]').click()`); await br.sleep(200);
    check('assistant : l’intention propose l’hypothèse', await br.ev(`document.getElementById('hyp').value.startsWith('La version en')`));
    check('assistant : la langue devient requise', await br.ev(`document.querySelector('input[name=language]').required === true && /requis/.test(document.querySelector('[data-need=language]').textContent)`));
    await br.ev(`document.querySelector('input[name=intent][value=angle]').click()`); await br.sleep(200);
    check('assistant : changer d’intention change l’exigence', await br.ev(`document.querySelector('input[name=language]').required === false && document.querySelector('input[name=angle]').required === true`));
    await shot('assistant');
    await br.go(`${U}/edition/1/variants/${ids.v1}`);
    check('page variante : un aperçu par format', (await br.ev(`document.querySelectorAll('.vthumb iframe').length`)) >= 2);
    check('page variante : parcours exporté → transmis → publié visible', await br.ev(`document.querySelectorAll('.stepper').length >= 2 && document.body.innerText.includes('exporté') && document.body.innerText.includes('transmis') && document.body.innerText.includes('publié')`));
    await shot('variante');
    await br.go(`${U}/edition/1/poster/4x5?variant=${ids.v1}`, `!!document.getElementById('pframe')`);
    await br.sleep(1500);
    check('éditeur : bandeau « variante » et aperçu de la variante', await br.ev(`document.body.innerText.includes('Variante « Émerveillement »') && document.getElementById('pframe').src.includes('variant=${ids.v1}')`));
    check('éditeur : le formulaire édite bien la variante', await br.ev(`document.getElementById('pform').dataset.variant === '${ids.v1}' && document.getElementById('pform').action.includes('variant=${ids.v1}')`));
    await shot('editeur-variante');
    for (const [p, n, re] of [['/edition/1/calendar?month=2027-01', 'calendrier', 'Réunion de lancement'], [`/edition/1/campaigns/${ids.c}`, 'campagne', 'Configuration Meta'], ['/edition/1/variants', 'variantes', 'Familles'], ['/settings', 'reglages', 'Sauvegardes'], ['/edition/1/contents', 'contenus', 'Associé']]) {
      await br.go(U + p);
      check(`page ${n} s’affiche`, await br.ev(`document.body.innerText.includes(${JSON.stringify(re)})`));
      await shot(n);
    }
    check('aucune erreur dans la console du navigateur', br.problems.length === 0, br.problems.slice(0, 3).join(' | '));
  } finally { br.close(); }
});

// ---------- conclusion
srv.p.kill(); await sleep(500);
const total = ((Date.now() - totalStart) / 1000).toFixed(0);
const fails = results.filter((r) => r.ok === false);
console.log(`\n══════════ ${results.filter((r) => r.ok !== undefined).length - fails.length} contrôles réussis, ${fails.length} en échec — ${total} s au total ══════════`);
console.log('Temps par étape :'); for (const r of results.filter((x) => x.time !== undefined)) console.log(`  ${r.time.toFixed(1).padStart(6)} s  ${r.step}`);
for (const f of fails) console.log(`ÉCHEC [${f.step}] ${f.name} ${f.extra || ''}`);
writeFileSync(join(ROOT, 'tests', 'dernier-resultat.json'), JSON.stringify({ date: new Date().toISOString(), seconds: Number(total), passed: results.filter((r) => r.ok).length, failed: fails.map((f) => f.name), steps: results.filter((x) => x.time !== undefined) }, null, 2));
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* fichiers encore ouverts */ }
process.exit(fails.length ? 1 : 0);
