// Test de parcours complet (bout en bout, sans navigateur) — à relancer après toute évolution :  node tests/parcours.mjs
// Il démarre sa propre copie de l'atelier sur des dossiers TEMPORAIRES (jamais sur data/), joue le scénario d'une personne
// qui prépare des variantes pour une campagne Meta, chronomètre chaque étape, puis teste sauvegarde et restauration.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBrowser, edgeAvailable } from './cdp.mjs';

const ROOT = decodeURIComponent(new URL('../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
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
function png(w, h, seed, solid) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w + seed * 40) & 255; raw[o + 1] = (y * 255 / h) & 255; raw[o + 2] = (128 + seed * 60 + ((x ^ y) & 31)) & 255; if (solid) { raw[o] = solid[0]; raw[o + 1] = solid[1]; raw[o + 2] = solid[2]; } } }
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

await step('0b. Installé dans un dossier dont le nom contient un espace (cas de l’installateur)', async () => {
  const inst = join(TMP, 'Atelier marketing'); mkdirSync(inst, { recursive: true });
  for (const d of ['src', 'public']) cpSync(join(ROOT, d), join(inst, d), { recursive: true });
  cpSync(join(ROOT, 'package.json'), join(inst, 'package.json'));
  const env = { ...process.env, PORT: '3993' }; delete env.ATELIER_DATA; delete env.ATELIER_ASSETS;
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(inst, 'src', 'server.js')], { cwd: inst, env, stdio: 'ignore' });
  check('le serveur démarre depuis ce dossier', await waitUp(3993));
  await sleep(300);
  check('ses données sont créées dans « data » de ce dossier (pas dans un dossier « %20 »)', existsSync(join(inst, 'data', 'atelier.db')) && !readdirSync(TMP).some((n) => /%20/.test(n)), readdirSync(inst).join(', '));
  p.kill(); await sleep(400);
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
  const page = await A.text('/edition/1/settings');
  check('fiche prête : aucune publication bloquée', /Fiche prête/.test(page), (/Publication externe bloquée[^<]*/.exec(page) || [''])[0].slice(0, 160));
  for (const fmt of ['4x5', '9x16', '1x1']) await A.post(`/edition/1/poster/${fmt}/save`, { hero: String(ids.hero), logo: String(ids.logo), partners: '1', style: 'classique', gradient: '65' });
});

await step('1b. Polices par format et « Uniformiser » : un format réglé se reporte sur les autres', async () => {
  const body = { hero: String(ids.hero), logo: String(ids.logo), partners: '1', style: 'classique', gradient: '33', ft: 'Impact', fb: 'Verdana', text_pos: 'haut', els: JSON.stringify({ title: { dx: 40, color: '#ff0000' } }) };
  const p4 = await A.text('/edition/1/poster/4x5');
  check('choix de police du titre et du texte proposés', /name="ft"/.test(p4) && /name="fb"/.test(p4) && /Uniformiser/.test(p4));
  await A.post('/edition/1/poster/4x5/save', body);
  const render = await A.text('/render/poster/1/4x5');
  check('la police choisie est utilisée dans l’aperçu', /'Impact'/.test(render) && /'Verdana'/.test(render));
  const forged = await A.text('/render/poster/1/4x5?ft=' + encodeURIComponent("x';}</style><script>1</script>"));
  check('une police hors liste est ignorée', !/<script>1<\/script>/.test(forged));
  const r = await A.post('/edition/1/poster/4x5/sync', body);
  check('uniformisation confirmée', /Réglages reportés sur [1-9]/.test(decodeURIComponent(A.loc(r))), decodeURIComponent(A.loc(r)));
  const p1 = await A.text('/edition/1/poster/1x1');
  check('l’autre format reprend dégradé, police et position du texte', /name="gradient"[^>]*value="33"/.test(p1) && /<option value="Impact" selected/.test(p1) && /<option value="Verdana" selected/.test(p1) && /<option selected>haut/.test(p1));
  const els = /name="els" value="([^"]*)"/.exec(p1)?.[1] || '';
  check('la couleur de l’élément est reportée, pas sa position', /ff0000/.test(els) && !/&quot;dx&quot;:40/.test(els), els);
  for (const fmt of ['4x5', '9x16', '1x1']) await A.post('/edition/1/poster/' + fmt + '/save', { hero: String(ids.hero), logo: String(ids.logo), partners: '1', style: 'classique', gradient: '65' });
});

await step('1c. Bibliothèque : un seul dispositif d’ajout, aperçus, filtres, nom affiché distinct du fichier d’origine', async () => {
  const lib = await A.text('/edition/1/assets');
  check('un seul bloc d’ajout en haut, aide repliée', /Ajouter des fichiers/.test(lib) && !/class="card upx"/.test(lib) && /<details><summary>Aide : formats acceptés/.test(lib));
  check('chaque fichier propose « Créer un contenu avec ce fichier »', /Créer un contenu avec ce fichier/.test(lib));
  await A.post('/assets/' + ids.hero + '/update', { label: 'Photo salle principale', role: 'hero', status: 'approuvé', rights: '' });
  const l2 = await A.text('/edition/1/assets');
  check('nom affiché lisible, fichier d’origine conservé', /Photo salle principale/.test(l2) && /Fichier d’origine conservé/.test(l2));
  check('recherche par nom affiché', /Photo salle principale/.test(await A.text('/edition/1/assets?q=salle')) && /Aucun fichier ne correspond/.test(await A.text('/edition/1/assets?q=zzzzintrouvable')));
  check('filtre par type', /Aucun fichier ne correspond/.test(await A.text('/edition/1/assets?kind=video&q=salle')));
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
  check('campagne active : message « on peut préparer des variantes »', /nouveaux contenus en brouillon/.test(page));
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
  check('liste unique des contenus : noms, types, statuts, filtres', /Tous les contenus/.test(list) && /Émerveillement/.test(list) && /brouillon/.test(list) && /name="q"/.test(list) && /name="campaign"/.test(list));
  check('filtre par nom : trouve ou dit qu’il n’y a rien', /Aucun contenu ne correspond/.test(await A.text('/edition/1/variants?q=zzzintrouvable')) && /Émerveillement/.test(await A.text('/edition/1/variants?q=emerveillement')));
  check('filtre par type : les textes ne montrent pas les affiches', !/Émerveillement/.test(await A.text('/edition/1/variants?type=texte')) && /Émerveillement/.test(await A.text('/edition/1/variants?type=affiche')));
});

await step('4b. Parcours court d’une personne seule : 3 actions de la création à l’association', async () => {
  const wiz = await A.text('/edition/1/variants/new?mode=test');
  check('assistant détaillé : responsable et relecteur facultatif proposés', /Responsable/.test(wiz) && /Relecteur/.test(wiz));
  const pre = await A.text(`/edition/1/variants/new?mode=test&campaign=${ids.c}&adset=${ids.adset}&formats=1x1,16x9`);
  check('l’assistant se préremplit depuis les formats manquants d’une campagne', /name="fmt_1x1"[^>]*checked/.test(pre) && /name="fmt_16x9"[^>]*checked/.test(pre) && !/name="fmt_4x5"[^>]*checked/.test(pre));
  const fiche = await A.text('/edition/1');
  check('l’Accueil du projet distingue production et validations', /Production à reprendre/.test(fiche) && /Validations attendues/.test(fiche));
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

await step('4d. Points d’entrée libres : affiche reçue (SVG / image) et documents, dans un ordre quelconque', async () => {
  await A.post('/edition/new', { label: 'Entrées externes' }); const P = 3; // fiche volontairement vide : rien ne doit bloquer
  const rawUp = async (role, name, buf, use) => { const r = await fetch(`${U}/assets/upload?edition=${P}&role=${role}&name=${encodeURIComponent(name)}${use ? '&use=' + use : ''}`, { method: 'POST', headers: { origin: U, cookie: A.ck }, body: buf }); return { status: r.status, json: await r.json() }; };
  const dirty = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" onload="alert(1)"><script>alert(2)</script><rect width="1080" height="1350" fill="#224"/><circle cx="540" cy="600" r="300" fill="#c8a24a"/><text x="100" y="1200" font-size="80" fill="#fff">MUSEUM NIGHT</text></svg>`;
  const bad = await rawUp('poster', 'pas-un-svg.svg', Buffer.from('ceci n’est pas du svg'), 'poster');
  check('un faux SVG est refusé avec une explication', bad.status === 400 && /n’est pas un SVG/.test(bad.json.error), bad.json.error);
  const pdf = await rawUp('poster', 'affiche.pdf', Buffer.from('%PDF-1.4 test'), 'poster');
  check('un PDF/.ai reçu comme affiche : message qui explique comment l’exporter en SVG', /Exporter sous/.test(decodeURIComponent(pdf.json.url || '')), pdf.json.url);
  const up = await rawUp('poster', 'affiche-musee.svg', Buffer.from(dirty), 'poster');
  check('import d’une affiche SVG : arrivée directe sur les affiches', up.status === 200 && /poster\/4x5/.test(up.json.url) && /importée pour tous les formats/.test(decodeURIComponent(up.json.url)), up.json.url);
  const svgId = up.json.id, svgBack = await (await A.get(`/files/${svgId}`)).text();
  check('le SVG reçu est nettoyé (script, événements, DOCTYPE retirés)', !/<script|onload|DOCTYPE/i.test(svgBack) && /<circle/.test(svgBack));
  const pp = await A.text(`/edition/${P}/poster/9x16`);
  check('page affiche : panneau « Affiche reçue » avec ajustement et avertissement texte vivant', /Affiche reçue/.test(pp) && /name="fit"/.test(pp) && /texte « vivant »/.test(pp));
  const r45 = await A.text(`/render/poster/${P}/4x5`), r916 = await A.text(`/render/poster/${P}/9x16`);
  check('4:5 → l’affiche remplit le format (mêmes proportions), 9:16 → entière sur fond flou', /class="bg"/.test(r45) && !/class="bgb"/.test(r45) && /object-fit:cover/.test(r45) && /class="bgb"/.test(r916) && /object-fit:contain/.test(r916));
  check('aucun texte de la fiche n’est superposé à l’affiche reçue', !/NIGHT SHOW|PLACEHOLDER/.test(r45) && !/<h1/.test(r45));
  // variante : aucun blocage malgré l'absence de photo, de titre de fiche et de fiche prête
  const vr = await A.post(`/edition/${P}/variants/new`, { intent: 'format', name: 'Affiche musée — placements', hypothesis: 'Une composition pensée pour ce placement améliore la lecture.', poster: String(svgId), fmt_4x5: '1', fmt_9x16: '1' });
  const pv = Number(/variants\/(\d+)/.exec(vr.headers.get('location') || '')?.[1]);
  check('variante créée à partir de l’affiche reçue (sans photo, sans titre de fiche)', !!pv, A.loc(vr));
  const vp = await A.text(`/edition/${P}/variants/${pv}`);
  check('contrôles : pas de blocage ; avertissements SVG affichés (texte vivant)', !/🔴/.test(vp) && /🟡/.test(vp) && /texte « vivant »/.test(vp));
  const ae = await A.post(`/edition/${P}/variants/${pv}/approve-export`, {});
  check('approuver et exporter fonctionne sur une affiche reçue', /Approuvée \(v1\) et exportée/.test(A.loc(ae)), A.loc(ae));
  const vp2 = await A.text(`/edition/${P}/variants/${pv}`);
  const expId = Number(/\/exports\/(\d+)\?dl=1/.exec(vp2)?.[1]);
  const png2 = Buffer.from(await (await A.get(`/exports/${expId}`)).arrayBuffer());
  const dims = `${png2.readUInt32BE(16)}x${png2.readUInt32BE(20)}`;
  check('le PNG exporté est une vraie image aux bonnes dimensions', png2.length > 3000 && png2.readUInt32BE(0) === 0x89504e47 && ['1080x1350', '1080x1920'].includes(dims), `${dims}, ${png2.length} octets`);
  check('fiche non prête : l’export est marqué BROUILLON (rien de publiable par erreur)', /BROUILLON/.test(vp2));
  const og = await A.get(`/edition/${P}/poster/4x5/svg`);
  check('« Fichier d’origine » rend le SVG nettoyé de l’affiche reçue', og.status === 200 && /image\/svg/.test(og.headers.get('content-type')) && /<circle/.test(await og.text()));
  // image raster comme affiche reçue
  const pr = await rawUp('poster', 'affiche.png', png(900, 1100, 2), 'poster');
  check('une affiche PNG est acceptée de la même façon', /poster\/4x5/.test(pr.json.url) && /importée/.test(decodeURIComponent(pr.json.url)));
  // retour aux affiches de l'atelier
  const rm = await A.post(`/edition/${P}/poster-import`, { remove: '1' });
  check('retour aux affiches de l’atelier', /Retour aux affiches/.test(A.loc(rm)) && !/class="bgb"/.test(await A.text(`/render/poster/${P}/9x16`)));
  // documents : concept Word, texte, PDF illisible
  const dir = join(TMP, 'docx'); mkdirSync(join(dir, 'word'), { recursive: true });
  writeFileSync(join(dir, 'word', 'document.xml'), '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Concept : lanternes &amp; silence</w:t></w:r></w:p><w:p><w:r><w:t>Scène 1 — le pont de pierre</w:t></w:r></w:p></w:body></w:document>');
  spawnSync(join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe'), ['-a', '-c', '-f', join(TMP, 'concept.zip'), '-C', dir, 'word']);
  const dc = await rawUp('brief', 'concept-teaser.docx', readFileSync(join(TMP, 'concept.zip')), 'content');
  check('un document Word devient un contenu texte lu automatiquement', /Document import/.test(decodeURIComponent(dc.json.url || '')), dc.json.url || dc.json.error);
  const cp = await A.text(`/edition/${P}/contents`);
  check('le texte du document est dans la bibliothèque (accents et & conservés)', /Concept : lanternes &amp; silence/.test(cp) && /Scène 1 — le pont de pierre/.test(cp));
  const cid = Number(/\/contents\/(\d+)\/update/.exec(cp)?.[1]);
  const tx = await rawUp('brief', 'idees.txt', Buffer.from('Idée de légende : la nuit tombe sur le temple.'), 'content');
  check('un .txt devient aussi un contenu', /Document import/.test(decodeURIComponent(tx.json.url || '')));
  const fp = await rawUp('brief', 'brief.pdf', Buffer.from('%PDF-1.4 test'), 'content');
  check('un PDF (illisible) crée quand même le contenu, fichier joint, sans erreur', /n’a pas pu être lu/.test(decodeURIComponent(fp.json.url || '')), fp.json.url || fp.json.error);
  // un concept se range dans une campagne sans fichier à exporter, et sert de point de départ à une variante
  await A.post(`/edition/${P}/contents/${cid}/update`, { title: 'Concept teaser', status: 'approuvé', language: 'EN', body: 'Concept : lanternes & silence' });
  const cc = await A.post(`/edition/${P}/campaigns/new`, { name: 'Teaser musée' });
  const cmp = Number(/campaigns\/(\d+)/.exec(cc.headers.get('location'))?.[1]);
  const lk = await A.post(`/edition/${P}/campaigns/${cmp}/link`, { content_id: String(cid), campaign_id: String(cmp) });
  check('un contenu texte s’associe à une campagne sans export', /Contenu associé/.test(A.loc(lk)), A.loc(lk));
  const cpage = await A.text(`/edition/${P}/campaigns/${cmp}`);
  const linkId = Number(/\/links\/(\d+)/.exec(cpage)?.[1]);
  const st = await A.post(`/edition/${P}/links/${linkId}`, { state: 'approuvé' });
  check('…et suit le même parcours de validation que les visuels', /Statut mis à jour/.test(A.loc(st)), A.loc(st));
  const nv = await A.text(`/edition/${P}/variants/new?content=${cid}`);
  check('créer une variante depuis un texte : nom prérempli et texte source affiché', /value="Concept teaser"/.test(nv) && /Texte de départ/.test(nv) && /lanternes/.test(nv));
  // l'ordre ne compte pas : campagne vide, variante sans campagne, tout reste utilisable
  const free = await A.post(`/edition/${P}/variants/new`, { intent: 'langue', name: 'Version JA', language: 'JA', hypothesis: 'La version en JA touche le marché JA mieux que la version actuelle.', fmt_1x1: '1' });
  check('une variante sans photo ni affiche se crée (le blocage est signalé au bon moment, pas avant)', /variants\/\d+/.test(free.headers.get('location') || ''), A.loc(free));
});

await step('4e. Gestionnaire de projets : essai, renommer, archiver, supprimer', async () => {
  const t = await A.post('/edition/test'); const T = Number(/edition\/(\d+)/.exec(t.headers.get('location'))?.[1]);
  check('projet d’essai créé avec une fiche d’exemple provisoire', !!T && /provisoire/.test(await A.text('/')) && /TEST SHOW/.test(await A.text(`/edition/${T}/settings`)));
  const hp = await A.text(`/edition/${T}`);
  check('« Y aller » mène aux paramètres, section concernée (pas à l’accueil lui-même)', new RegExp(`href="/edition/${T}/settings#sec-[a-z]+"[^>]*>Y aller`).test(hp), (/Prochaine étape[^]*?Y aller/.exec(hp) || [''])[0].slice(-200));
  const aid = await A.up(T, 'hero', 'essai.png', png(300, 300, 1));
  const ex = await A.post(`/edition/${T}/poster/4x5/export`, { hero: String(aid), partners: '0', style: 'classique', gradient: '50' });
  check('un export existe dans le projet d’essai', /export/i.test(A.loc(ex)));
  const rn = await A.post(`/edition/${T}/rename`, { label: 'Essai renommé', from: 'home' });
  check('renommer', /Projet renommé/.test(A.loc(rn)) && /Essai renommé/.test(await A.text('/')));
  await A.post(`/edition/${T}/archive`);
  const hidden = await A.text('/');
  check('archiver masque le projet de la liste principale (sans rien supprimer)', /Projets archivés \(1\)/.test(hidden) && (await A.get(`/edition/${T}`)).status === 200);
  await A.post(`/edition/${T}/unarchive`);
  check('…et il revient dans la liste', !/Projets archivés/.test(await A.text('/')));
  const dp = await A.text(`/edition/${T}/delete`);
  check('page de suppression : ce qui sera effacé, et l’alternative « archiver »', /Définitif/.test(dp) && /1 fichier/.test(dp) && /Archiver à la place/.test(dp));
  const bad = await A.post(`/edition/${T}/delete`, { confirm: 'mauvais nom' });
  check('suppression refusée si le nom retapé est faux', /ne correspond pas/.test(A.loc(bad)) && (await A.get(`/edition/${T}`)).status === 200);
  const files = existsSync(join(DATA, 'assets')) ? readdirSync(join(DATA, 'assets')).length : 0;
  const ok = await A.post(`/edition/${T}/delete`, { confirm: 'Essai renommé' });
  check('suppression confirmée', /supprimé/.test(A.loc(ok)) && (await A.get(`/edition/${T}`)).status === 404);
  const after = existsSync(join(DATA, 'assets')) ? readdirSync(join(DATA, 'assets')).length : 0;
  check('ses fichiers sont effacés du disque', after === files - 1, `${files} → ${after}`);
  const p1 = await A.text('/edition/1/assets');
  check('les autres projets ne sont pas touchés', (await A.get('/edition/1')).status === 200 && /photo-principale/.test(p1));
});

await step('4f. Navigation simplifiée : Accueil de travail, cinq destinations, paramètres à part', async () => {
  const h = await A.text('/edition/1');
  check('cinq destinations + Paramètres du projet (plus de « Contenus » à part : un contenu naît dans une campagne)', ['Accueil', 'Campagnes', 'Calendrier', 'Site web', 'Bibliothèque', 'Paramètres du projet'].every((w) => h.includes(`>${w}<`)) && !h.includes('>Contenus<'));
  check('l’Accueil mène aux campagnes et au calendrier ; pas de création de contenu hors campagne', /Mes campagnes/.test(h) && /Calendrier du projet/.test(h) && !/\+ Créer un contenu/.test(h));
  check('l’Accueil n’est plus la fiche (pas de formulaire de fiche)', !/name="title_en"/.test(h) && !/Dupliquer ce projet/.test(h));
  check('l’Accueil distingue production à reprendre, validations, échéances, suivi et configuration', ['Production à reprendre', 'Validations attendues', 'Prochaines échéances', 'Suivi et configuration'].every((w) => h.includes(w)));
  check('un contenu n’apparaît qu’une fois sur l’Accueil', ((h.match(/Émerveillement/g) || []).length) <= 2);
  const s = await A.text('/edition/1/settings');
  check('la fiche du spectacle est dans Paramètres du projet', /name="title_en"/.test(s) && /Gérer ce projet/.test(s) && /Dupliquer ce projet/.test(s));
  const bib = await A.text('/edition/1/assets'), cal = await A.text('/edition/1/calendar');
  check('Bibliothèque : fichiers sources et designs ; Calendrier depuis l’Accueil', /Fichiers sources/.test(bib) && /Designs et modèles/.test(bib) && /Calendrier/.test(cal));
  check('le formulaire de la fiche enregistre depuis les paramètres', s.includes('action="/edition/1/save"'));
});

await step('4g. Espace de contenu : créer, matériel, création, vérification, diffusion (affiche, vidéo, texte)', async () => {
  const P = 3, rawUp = async (qs, buf) => { const r = await fetch(U + '/assets/upload?edition=' + P + '&' + qs, { method: 'POST', headers: { origin: U, cookie: A.ck }, body: buf }); return { status: r.status, json: await r.json() }; };
  const form = await A.text('/edition/' + P + '/variants/new');
  check('« Créer un contenu » : trois choix, nom, campagne facultative, point de départ', ['Affiche / image', 'Vidéo', 'Texte'].every((w) => form.includes(w)) && /name="campaign_id"/.test(form) && /name="copy"/.test(form) && !/Hypothèse à tester/.test(form));
  // ---- affiche
  const c1 = await A.post('/edition/' + P + '/variants/new', { type: 'affiche', name: '' });
  const v1 = Number(/variants\/(\d+)/.exec(c1.headers.get('location') || '')?.[1]);
  check('création sans nom ni hypothèse : un nom est proposé, arrivée sur le matériel', !!v1 && /step=materiel/.test(A.loc(c1)), A.loc(c1));
  const m1 = await A.text('/edition/' + P + '/variants/' + v1 + '?step=materiel');
  check('quatre étapes visibles : Matériel, Création, Vérification et exports, Diffusion', ['Matériel', 'Création', 'Vérification et exports', 'Diffusion'].every((w) => m1.includes(w)));
  check('matériel : import direct, affiche reçue, formats, brief marketing replié', /Ajouter un fichier/.test(m1) && /Aucune image dans ce projet|Affiche reçue/.test(m1) && /Formats de sortie/.test(m1) && /Brief marketing/.test(m1));
  const ph = await rawUp('role=hero&name=photo-test.png&what=hero&variant=' + v1, png(900, 1100, 1));
  check('un import depuis le matériel est utilisé tout de suite (sans quitter l’espace)', ph.status === 200 && /step=materiel/.test(ph.json.url) && /photo/i.test(decodeURIComponent(ph.json.url)), ph.json.url);
  check('…et il est dans la bibliothèque', /photo-test\.png/.test(await A.text('/edition/' + P + '/assets')));
  check('…et l’aperçu du contenu utilise cette photo', new RegExp('/files/' + ph.json.id + '"').test(await A.text('/render/poster/' + P + '/4x5?variant=' + v1)));
  const ad = await rawUp('role=other&name=double-usage.png&what=add&variant=' + v1, png(400, 400, 3));
  check('« Ajouter un fichier » : il rejoint la bibliothèque, sa destination se choisit ensuite', ad.status === 200 && /choisissez/i.test(decodeURIComponent(ad.json.url)) && /double-usage\.png/.test(await A.text('/edition/' + P + '/assets')), ad.json.url);
  const au1 = await rawUp('name=logo-orfeo-auto.png', png(200, 200, 4)), au2 = await rawUp('name=teaser-auto.mp4', Buffer.from('pas une vraie video')), au3 = await rawUp('name=sous-titres-auto.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello\n'));
  const lib = await A.text('/edition/' + P + '/assets');
  const roleOf = (name) => (new RegExp(name.replace(/[.]/g, '\\.') + '[^]*?<span class="tag">([^<]+)</span>').exec(lib) || [])[1];
  check('à l’ajout, le type est deviné sans rien demander (logo, vidéo, sous-titres)', au1.status === 200 && au2.status === 200 && au3.status === 200 && roleOf('logo-orfeo-auto.png') === 'Logo' && roleOf('teaser-auto.mp4') === 'Vidéo' && roleOf('sous-titres-auto.srt') === 'Sous-titres', [roleOf('logo-orfeo-auto.png'), roleOf('teaser-auto.mp4'), roleOf('sous-titres-auto.srt')].join(' / '));
  await A.post(`/edition/${P}/variants/${v1}/material`, { hero: String(ad.json.id) });
  await A.post(`/edition/${P}/variants/${v1}/material`, { logo: String(ad.json.id) });
  const dm = await A.text(`/edition/${P}/variants/${v1}?step=materiel`);
  check('le même fichier sert de photo de fond ET de logo, sans second envoi', (dm.match(/✓ Photo de fond/g) || []).length === 1 && (dm.match(/✓ Logo/g) || []).length === 1);
  await A.post(`/edition/${P}/variants/${v1}/material`, { hero: String(ph.json.id) });
  await A.post(`/edition/${P}/variants/${v1}/material`, { logo: '' });
  const dm2 = await A.text(`/edition/${P}/variants/${v1}?step=materiel`);
  check('on remet la photo d’origine et on retire le logo (un clic de plus)', (dm2.match(/✓ Photo de fond/g) || []).length === 1 && !/✓ Logo/.test(dm2));
  await rawUp('role=poster&name=musee.svg&what=poster&variant=' + v1, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#224"/><circle cx="540" cy="600" r="300" fill="#c8a24a"/></svg>'));
  check('une affiche SVG importée depuis le matériel remplace la composition pour ce contenu', /class="bgb"/.test(await A.text('/render/poster/' + P + '/9x16?variant=' + v1)));
  check('les autres contenus du projet ne sont pas touchés', !/class="bgb"/.test(await A.text('/render/poster/' + P + '/9x16')));
  await A.post('/edition/' + P + '/variants/' + v1 + '/material', { poster: 'none' });
  check('retour à la composition de l’atelier', !/class="bgb"/.test(await A.text('/render/poster/' + P + '/9x16?variant=' + v1)));
  const fm = await A.post('/edition/' + P + '/variants/' + v1 + '/material', { set_formats: '1', fmt_4x5: '1', fmt_1x1: '1' });
  const go = await A.get('/edition/' + P + '/variants/' + v1 + '?step=creation');
  check('« Création » d’une affiche ouvre directement l’éditeur du premier format', go.status >= 300 && go.status < 400 && new RegExp('/edition/' + P + '/poster/\\w+\\?variant=' + v1).test(A.loc(go)), A.loc(go));
  const cr = await A.text('/edition/' + P + '/variants/' + v1 + '?step=creation&all=1');
  check('formats modifiés : le nouveau format apparaît à la création, l’ancien disparaît', /Modifier ce format/.test(cr) && /1:1/.test(cr) && !/9:16 — Stories/.test(cr), A.loc(fm));
  const ed = await A.text('/edition/' + P + '/poster/1x1?variant=' + v1);
  check('l’éditeur d’affiche garde l’en-tête à quatre étapes et le retour', /class="ws"/.test(ed) && /step=verification/.test(ed) && /id="pform"/.test(ed));
  const vf = await A.text('/edition/' + P + '/variants/' + v1);
  check('étape par défaut : vérification et exports, avec contrôles et validation', /Contrôles automatiques/.test(vf) && /Approuver et exporter/.test(vf));
  const ae = await A.post('/edition/' + P + '/variants/' + v1 + '/approve-export', {});
  check('approuver et exporter sans avoir rédigé d’hypothèse', /Approuvée \(v1\) et exportée/.test(A.loc(ae)), A.loc(ae));
  const df = await A.text('/edition/' + P + '/variants/' + v1 + '?step=diffusion');
  check('diffusion : campagne, publication organique, téléchargement ; rien n’est envoyé à Meta', /Associer à une campagne/.test(df) && /Publication organique/.test(df) && /Télécharger uniquement/.test(df) && /n’envoie rien à Meta/.test(df) && /\/exports\/\d+\?dl=1/.test(df));
  const back = await A.text('/edition/' + P + '/variants/' + v1 + '?step=materiel');
  check('on peut revenir au matériel après l’export (rien n’est perdu)', /Ajouter un fichier/.test(back));
  const cpy = await A.post('/edition/' + P + '/variants/new', { type: 'affiche', name: 'Copie du premier', copy: String(v1) });
  check('créer un contenu en copiant un existant (sans hypothèse ni test)', /variants\/\d+\?step=materiel/.test(A.loc(cpy)), A.loc(cpy));
  // ---- vidéo
  const vp = join(TMP, 'court.mp4');
  spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vp]);
  const c2 = await A.post('/edition/' + P + '/variants/new', { type: 'video', name: 'Teaser vidéo' });
  const v2 = Number(/variants\/(\d+)/.exec(c2.headers.get('location') || '')?.[1]);
  const m2 = await A.text('/edition/' + P + '/variants/' + v2 + '?step=materiel');
  check('contenu vidéo : le matériel propose la vidéo source, pas la photo d’affiche', /Choisir la vidéo source/.test(m2) && !/Photo de fond<\/label>/.test(m2));
  const vu = await rawUp('role=video&name=court.mp4&what=video&variant=' + v2, readFileSync(vp));
  check('import de la vidéo depuis le matériel : utilisée aussitôt', vu.status === 200 && /vidéo source/i.test(decodeURIComponent(vu.json.url)), vu.json.url);
  const cv = await A.text('/edition/' + P + '/variants/' + v2 + '?step=creation&all=1');
  check('création vidéo : accès à l’éditeur (extrait, cadrage, logo, sous-titres)', /Ouvrir l’éditeur vidéo/.test(cv) && /court\.mp4/.test(cv));
  const ve = await A.text('/edition/' + P + '/video?variant=' + v2);
  check('l’éditeur vidéo garde l’en-tête de l’espace de travail', /class="ws"/.test(ve) && /step=materiel/.test(ve) && /id="vform"/.test(ve));
  const vv = await A.text('/edition/' + P + '/variants/' + v2);
  check('vérification d’une vidéo sans affiche : pas de faux blocage « titre vide »', !/Le titre est vide/.test(vv));
  // ---- texte
  const c3 = await A.post('/edition/' + P + '/variants/new', { type: 'texte', name: 'Script teaser' });
  const tid = Number(/texts\/(\d+)/.exec(c3.headers.get('location') || '')?.[1]);
  check('création d’un texte : arrivée sur son matériel', !!tid && /step=materiel/.test(A.loc(c3)), A.loc(c3));
  const tp = await A.text('/edition/' + P + '/texts/' + tid + '?step=materiel');
  check('un texte a les mêmes quatre étapes', ['Matériel', 'Création', 'Vérification et exports', 'Diffusion'].every((w) => tp.includes(w)) && /Importer un document/.test(tp));
  const d1 = await A.post('/edition/' + P + '/texts/' + tid + '/approve');
  check('un texte vide ne s’approuve pas', /vide/.test(A.loc(d1)));
  const dd = await rawUp('role=brief&name=script.docx&what=doc&text=' + tid, readFileSync(join(TMP, 'concept.zip')));
  check('un document Word importé depuis le matériel remplit le texte', dd.status === 200 && /Texte import/.test(decodeURIComponent(dd.json.url)) && /lanternes/.test(await A.text('/edition/' + P + '/texts/' + tid + '?step=creation')), dd.json.url || dd.json.error);
  await A.post('/edition/' + P + '/texts/' + tid + '/save', { title: 'Script teaser', language: 'EN', body: 'Scène 1 — le pont.' });
  const ap = await A.post('/edition/' + P + '/texts/' + tid + '/approve');
  check('texte approuvé', /approuvé/.test(A.loc(ap)));
  const camp = await A.post('/edition/' + P + '/campaigns/new', { name: 'Campagne des contenus' }), cmp = Number(/campaigns\/(\d+)/.exec(camp.headers.get('location'))?.[1]);
  const lk = await A.post('/edition/' + P + '/texts/' + tid + '/link', { target: 'campaign_id:' + cmp });
  check('texte associé à une campagne en brouillon', /associé en brouillon/.test(A.loc(lk)) && /Script teaser/.test(await A.text('/edition/' + P + '/campaigns/' + cmp)));
  const dl = await A.get('/edition/' + P + '/texts/' + tid + '/download');
  check('téléchargement du texte', dl.status === 200 && /Scène 1/.test(await dl.text()));
  const list = await A.text('/edition/' + P + '/variants');
  check('la liste « Contenus » montre affiches, vidéos et textes ensemble, avec leur type', /Teaser vidéo/.test(list) && /Script teaser/.test(list) && /Copie du premier/.test(list) && /class="tag">Vidéo</.test(list) && /class="tag">Texte</.test(list));
  const acc = await A.text('/edition/' + P);
  check('l’Accueil reprend le travail en cours (vidéo) et laisse de côté le texte déjà approuvé', /Teaser vidéo/.test(acc) && !/Script teaser/.test(acc));
  ids.w = { v1, v2, tid };
});

await step('4h. Campagnes, bibliothèque et calendrier reliés au parcours de contenu', async () => {
  const P = 3;
  // ---- campagnes : indicateur compact, avancement, configuration déplacée
  const list = await A.text('/edition/1/campaigns');
  check('Campagnes : indicateur Meta compact, plus de formulaire de configuration en tête', /Meta :/.test(list) && /non connecté/.test(list) && !/name="ad_account"/.test(list) && /Connexions du projet/.test(list));
  check('Campagnes : chaque campagne montre son avancement et ses actions', /publiés|transmis|en préparation/.test(list) && /\+ Ajouter un contenu/.test(list) && /Ouvrir/.test(list) && /\+ Nouvelle campagne/.test(list));
  const st = await A.text('/edition/1/settings');
  check('la connexion Meta (saisie à la main) est dans les Paramètres du projet', /id="connexions"/.test(st) && /name="ad_account"/.test(st) && /non connecté/.test(st));
  const sv = await A.post('/edition/1/campaigns/meta', { ad_account: 'act_42', page_name: 'Page test', from: 'settings' });
  check('enregistrer la connexion ramène aux paramètres, donnée conservée', /\/settings/.test(A.loc(sv)) && /value="act_42"/.test(await A.text('/edition/1/settings')));
  const cp = await A.text('/edition/1/campaigns/' + ids.c);
  check('page campagne : contenus et avancement avant la configuration Meta', cp.indexOf('Contenus de cette campagne') > 0 && cp.indexOf('Contenus de cette campagne') < cp.indexOf('Configuration Meta') && /Brief interne et lien avec Meta/.test(cp));
  check('page campagne : le fil Brief › Contenus › Validation › Export › Meta, avec le prochain pas', /class="frise"/.test(cp) && ['Brief', 'Contenus', 'Validation', 'Export', 'Meta'].every((w) => cp.includes(`. ${w}</b>`)) && /class="now"/.test(cp));
  const oc = await A.post('/edition/1/variants/new', { type: 'affiche', name: 'Visuel organique' }), ov = Number(/variants\/(\d+)/.exec(A.loc(oc))?.[1]);
  const lst = await A.text('/edition/1/campaigns');
  check('un contenu créé sans campagne va dans « Hors campagne » (créée au premier besoin, une seule fois)', ov > 0 && (lst.match(/campaigns\/\d+">Hors campagne/g) || []).length === 1);
  const ot = await A.post('/edition/1/variants/new', { type: 'texte', name: 'Légende organique' });
  const lst2 = await A.text('/edition/1/campaigns'), offId = Number(/campaigns\/(\d+)">Hors campagne/.exec(lst2)?.[1]);
  check('un texte créé sans campagne est rattaché à « Hors campagne », sans second « Hors campagne »', /Légende organique/.test(await A.text('/edition/1/campaigns/' + offId)) && (lst2.match(/campaigns\/\d+">Hors campagne/g) || []).length === 1, A.loc(ot));
  check('page campagne : créer un contenu pour cette campagne + associer un contenu existant', new RegExp('variants/new\\?campaign=' + ids.c).test(cp) && /Associer un contenu existant/.test(cp));
  check('page campagne : versions diffusées toujours figées et visibles', /🔒/.test(cp) && /nouveaux contenus en brouillon/.test(cp));
  // ---- créer un contenu pour une campagne : contexte prérempli
  const camp = await A.post('/edition/' + P + '/campaigns/new', { name: 'Campagne d’avancement', meta_status: 'active', brief_message: 'Test' }), cid = Number(/campaigns\/(\d+)/.exec(camp.headers.get('location'))?.[1]);
  const nf = await A.text('/edition/' + P + '/variants/new?campaign=' + cid);
  check('« Créer un contenu » depuis une campagne : la campagne est préremplie', new RegExp('<option value="' + cid + '" selected').test(nf));
  const nc = await A.post('/edition/' + P + '/variants/new', { type: 'affiche', name: 'Pour la campagne', campaign_id: String(cid) });
  const nv = Number(/variants\/(\d+)/.exec(nc.headers.get('location') || '')?.[1]);
  const cp2 = await A.text('/edition/' + P + '/campaigns/' + cid);
  check('campagne ACTIVE : on prépare un nouveau contenu en brouillon, il apparaît avec son avancement', !!nv && /Pour la campagne/.test(cp2) && /brouillon/.test(cp2) && /4:5 · brouillon/.test(cp2));
  const tl = await A.text('/edition/' + P + '/campaigns/' + cid);
  check('associer un contenu existant : les textes sont proposés au même titre que les visuels', /Script teaser/.test(tl));
  const li = await A.text('/edition/' + P + '/campaigns');
  check('la liste des campagnes compte les contenus de la campagne', /1 contenu\(s\) à vous/.test(li));
  // ---- bibliothèque → contenu
  const photo = await A.up(P, 'hero', 'depart.png', png(800, 1000, 2));
  const as = await A.text('/edition/' + P + '/assets');
  check('Bibliothèque : « Créer un contenu avec ce fichier » sur chaque fichier', as.includes('variants/new?asset=' + photo));
  const fa = await A.text('/edition/' + P + '/variants/new?asset=' + photo);
  check('depuis un fichier : le fichier de départ est annoncé', /Fichier de départ : <b>depart\.png/.test(fa) && /name="asset" value="/.test(fa));
  const ca = await A.post('/edition/' + P + '/variants/new', { type: 'affiche', name: 'Depuis un fichier', asset: String(photo) });
  const va = Number(/variants\/(\d+)/.exec(ca.headers.get('location') || '')?.[1]);
  check('le fichier est utilisé dès la création (aperçu)', new RegExp('/files/' + photo + '"').test(await A.text('/render/poster/' + P + '/4x5?variant=' + va)));
  const vfile = join(TMP, 'court.mp4');
  const vid = await A.up(P, 'video', 'depart.mp4', readFileSync(vfile));
  check('une vidéo de la bibliothèque prépare un contenu vidéo', /type" value="video" checked/.test(await A.text('/edition/' + P + '/variants/new?asset=' + vid)) || /value="video" checked/.test(await A.text('/edition/' + P + '/variants/new?asset=' + vid)));
  const cvid = await A.post('/edition/' + P + '/variants/new', { type: 'video', name: 'Vidéo depuis fichier', asset: String(vid) });
  const vv = Number(/variants\/(\d+)/.exec(cvid.headers.get('location') || '')?.[1]);
  check('…et la vidéo est la source dès la création', /depart\.mp4/.test(await A.text('/edition/' + P + '/variants/' + vv + '?step=creation')));
  // ---- design enregistré → contenu
  const ds = await A.text('/edition/1/designs');
  check('Designs : « Créer un contenu avec ce design »', /variants\/new\?design=\d+/.test(ds));
  const dform = await A.text('/edition/' + P + '/variants/new?design=1');
  check('depuis un design : il est présélectionné', /<option value="\d+" selected>DA Night Show/.test(dform));
  const cd = await A.post('/edition/' + P + '/variants/new', { type: 'affiche', name: 'Depuis un design', design_version: '1' });
  check('création depuis un design enregistré sans erreur', /variants\/\d+\?step=materiel/.test(A.loc(cd)), A.loc(cd));
  // ---- calendrier
  const ct = await A.text('/edition/' + P + '/variants');
  check('Contenus : le calendrier est à un clic', /href="\/edition\/3\/calendar">Calendrier</.test(ct));
  const cal = await A.text('/edition/1/calendar?month=2027-01');
  check('Calendrier : vocabulaire « contenu » et lien vers l’espace de travail', /<label>Contenu<select name="variant_id"/.test(cal) && !/<label>Variante</.test(cal));
});

await step('4i. Validations ciblées, modèles de contenu et kit graphique', async () => {
  // ---- un projet dont seules les sections UTILES aux affiches sont approuvées (FAQ, tarifs, site : non)
  const nr = await A.post('/edition/new', { label: 'Validations ciblées' }), Q = Number(/edition\/(\d+)/.exec(nr.headers.get('location'))?.[1]);
  const fiche = { title_en: 'CIBLE', tagline_en: 'Only what is shown matters', top_line_en: 'Every evening', cta_book_en: 'Book now', venue_status: 'confirmé', venue_name_en: 'Temple', venue_city_en: 'Kyoto', date_start: '2027-03-02', date_end: '2027-05-20', timezone: 'Asia/Tokyo', color_primary: '#102030', color_secondary: '#c8a24a', color_text: '#f5f1e8', font_title: 'Georgia', font_body: 'Segoe UI', booking_url: 'https://tickets.example.com/x' };
  for (const s of ['identity', 'venue', 'brand', 'booking']) fiche['status_' + s] = 'approuvé';
  await A.post('/edition/' + Q + '/save', fiche);
  const st = await A.text('/edition/' + Q + '/settings');
  check('le site, lui, garde son exigence large (FAQ, tarifs, options non approuvés)', /Pour publier le site/.test(st) && /Section « FAQ » non approuvée/.test(st) && /id="sec-faq"/.test(st));
  const hero = await A.up(Q, 'hero', 'fond.png', png(900, 1100, 1)); await A.post('/assets/' + hero + '/update', { role: 'hero', status: 'approuvé', rights: 'OK (test)' });
  const c1 = await A.post('/edition/' + Q + '/variants/new', { type: 'affiche', name: 'Affiche ciblée', asset: String(hero) });
  const v1 = Number(/variants\/(\d+)/.exec(c1.headers.get('location') || '')?.[1]);
  check('contrôles : rien ne manque pour cette affiche malgré FAQ, tarifs et site non approuvés', !/Pour sortir du BROUILLON/.test(await A.text('/edition/' + Q + '/variants/' + v1)));
  const ae = await A.post('/edition/' + Q + '/variants/' + v1 + '/approve-export', {});
  check('une affiche s’exporte « propre » : seules ses informations comptent', /Approuvée \(v1\) et exportée/.test(A.loc(ae)) && !/BROUILLON/.test(A.loc(ae)), A.loc(ae));
  const eid = Number(/\/exports\/(\d+)\?dl=1/.exec(await A.text('/edition/' + Q + '/variants/' + v1))?.[1]);
  const cd = (await A.get('/exports/' + eid + '?dl=1')).headers.get('content-disposition') || '';
  check('…le fichier n’est pas marqué DRAFT', eid > 0 && !/DRAFT/.test(cd), cd);
  // ---- une section utilisée par l'affiche n'est plus approuvée : BROUILLON, expliqué, avec le lien pour corriger
  await A.post('/edition/' + Q + '/save', { ...fiche, status_venue: 'à relire' });
  const c2 = await A.post('/edition/' + Q + '/variants/new', { type: 'affiche', name: 'Affiche lieu à relire', asset: String(hero) });
  const v2 = Number(/variants\/(\d+)/.exec(c2.headers.get('location') || '')?.[1]);
  const p2 = await A.text('/edition/' + Q + '/variants/' + v2);
  check('contrôles : la section utilisée est nommée, avec le lien qui y mène', /Pour sortir du BROUILLON/.test(p2) && /Lieu et dates/.test(p2) && new RegExp('settings#sec-venue').test(p2));
  const ae2 = await A.post('/edition/' + Q + '/variants/' + v2 + '/approve-export', {});
  check('la préparation reste permise : approuvé, exporté, marqué BROUILLON', /Approuvée \(v1\) et exportée/.test(A.loc(ae2)) && /BROUILLON/.test(A.loc(ae2)), A.loc(ae2));
  // ---- une vidéo sans écran de fin n'utilise pas la fiche
  const vf = join(TMP, 'court.mp4'), vid = await A.up(Q, 'video', 'seule.mp4', readFileSync(vf)); await A.post('/assets/' + vid + '/update', { role: 'video', status: 'approuvé', rights: 'OK (test)' });
  const c3 = await A.post('/edition/' + Q + '/variants/new', { type: 'video', name: 'Vidéo sans fiche', asset: String(vid) });
  const v3 = Number(/variants\/(\d+)/.exec(c3.headers.get('location') || '')?.[1]);
  const vd = JSON.stringify({ asset: String(vid), start: 0, end: 0, logo: { asset: '', corner: 'tr', size: 14, margin: 4 }, endcard: { on: false, seconds: 0 }, subs: { on: false, size: 100 }, reframe: {}, formats: ['9x16'] });
  await A.post('/edition/' + Q + '/video/save?variant=' + v3, { design: vd });
  const ae3 = await A.post('/edition/' + Q + '/variants/' + v3 + '/approve-export', {});
  await sleep(100);
  check('une vidéo sans écran de fin n’exige rien de la fiche (lieu à relire sans effet)', /Approuvée \(v1\) et exportée/.test(A.loc(ae3)) && !/BROUILLON/.test(A.loc(ae3)), A.loc(ae3));
  // ---- affiche reçue : exige seulement un fichier non provisoire
  const svg = await A.up(Q, 'poster', 'recue.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#224"/></svg>'));
  await A.post('/assets/' + svg + '/update', { role: 'poster', status: 'approuvé', rights: 'OK (test)' });
  const c4 = await A.post('/edition/' + Q + '/variants/new', { type: 'affiche', name: 'Affiche reçue propre', asset: String(svg) });
  const v4 = Number(/variants\/(\d+)/.exec(c4.headers.get('location') || '')?.[1]);
  const ae4 = await A.post('/edition/' + Q + '/variants/' + v4 + '/approve-export', {});
  check('une affiche reçue (fichier validé) s’exporte propre, sans dépendre des sections de la fiche', /Approuvée \(v1\) et exportée/.test(A.loc(ae4)) && !/BROUILLON/.test(A.loc(ae4)), A.loc(ae4));
  const ms = await A.post('/edition/' + Q + '/variants/' + v4 + '/save-model', { name: 'Modèle impossible' });
  check('une affiche reçue ne s’enregistre pas comme modèle (explication)', /affiche reçue/.test(A.loc(ms)) && /ne s’enregistre pas/.test(A.loc(ms)), A.loc(ms));
  // ---- modèle de contenu
  const m1 = await A.post('/edition/' + Q + '/variants/' + v1 + '/save-model', { name: 'Modèle affiche ciblée', note: 'Première version' });
  check('« Enregistrer comme modèle » depuis un contenu', /Modèle enregistré \(version 1\)/.test(A.loc(m1)), A.loc(m1));
  const ds = await A.text('/edition/' + Q + '/designs');
  check('Bibliothèque : le modèle est identifié comme tel', /Modèle affiche ciblée/.test(ds) && /Modèle de contenu/.test(ds));
  const tid = Number(/designs\/duplicate\/(\d+)/.exec(ds)?.[1]);
  const m2 = await A.post('/edition/' + Q + '/variants/' + v1 + '/save-model', { name: 'x', templateId: String(tid), note: 'Deuxième' });
  check('une nouvelle version du modèle s’ajoute sans toucher à la précédente', /version 2/.test(A.loc(m2)), A.loc(m2));
  const bad = await A.post('/edition/' + Q + '/variants/' + v1 + '/save-model', { name: 'x', templateId: '1' });
  check('on ne mélange pas les types : un modèle ne s’ajoute pas à un design de projet', /type/.test(A.loc(bad)) && /ne|même/.test(A.loc(bad)), A.loc(bad));
  const nf = await A.text('/edition/' + Q + '/variants/new');
  check('« Créer un contenu » propose le modèle', /Modèle affiche ciblée — v2/.test(nf));
  const c5 = await A.post('/edition/' + Q + '/variants/new', { type: 'affiche', name: 'Depuis le modèle', design_version: new RegExp('<option value="(\\d+)"[^>]*>Modèle affiche ciblée — v2').exec(nf)?.[1] || '' });
  check('créer un contenu depuis un modèle', /variants\/\d+\?step=materiel/.test(A.loc(c5)), A.loc(c5));
  const dup = await A.post('/edition/' + Q + '/designs/duplicate/' + tid, { name: 'Copie du modèle' });
  check('dupliquer un modèle : l’original reste intact, la copie est indépendante', /dupliqué/.test(A.loc(dup)) && /Copie du modèle/.test(await A.text('/edition/' + Q + '/designs')) && /Modèle affiche ciblée/.test(await A.text('/edition/' + Q + '/designs')));
  const fl = await A.text('/edition/' + Q + '/variants/' + v1 + '?step=creation&all=1');
  check('l’étape Création propose « Enregistrer comme modèle »', /Enregistrer comme modèle/.test(fl));
  // ---- kit graphique
  const kt = await A.text('/edition/1/designs');
  check('Designs : deux enregistrements distincts (kit graphique / modèle de contenu)', /Kit graphique du projet/.test(kt) && /Modèle de contenu/.test(kt) && /Enregistrer tout le travail graphique du projet/.test(kt));
  const k1 = await A.post('/edition/1/designs/save-kit', { name: 'Kit Night Show', note: 'Charte 2027' });
  check('« Enregistrer le kit graphique du projet »', /Kit graphique enregistré \(version 1\)/.test(A.loc(k1)), A.loc(k1));
  const kd = await A.text('/edition/1/designs');
  check('le kit est identifié, avec ses couleurs, et propose « Appliquer le kit au projet »', /Kit Night Show/.test(kd) && /Kit graphique<\/span>/.test(kd) && /background:#1b1b2f/.test(kd) && /Appliquer le kit au projet/.test(kd));
  check('un kit n’apparaît pas comme point de départ d’un contenu', !/Kit Night Show/.test(await A.text('/edition/' + Q + '/variants/new')) && !/Kit Night Show/.test(await A.text('/edition/1/variants/new')));
  const kv = Number(/designs\/apply\/(\d+)">Appliquer le kit au projet/.exec(kd)?.[1]);
  const ap = await A.text('/edition/' + Q + '/designs/apply/' + kv);
  check('appliquer un kit à un autre projet : la page l’explique (photos et textes intacts)', /kit graphique/.test(ap) && /ne sont pas touchés/.test(ap));
  const before = (await A.text('/edition/' + Q + '/poster/4x5')).match(/name="gradient"[^>]*value="(\d+)"/)?.[1];
  const ar = await A.post('/edition/' + Q + '/designs/apply/' + kv, { brand: '1' });
  const after = (await A.text('/edition/' + Q + '/poster/4x5')).match(/name="gradient"[^>]*value="(\d+)"/)?.[1];
  check('le kit reprend les styles communs (dégradé) et la charte, sans effacer la photo', /Design appliqué/.test(A.loc(ar)) && after === "65" && /selected/.test(await A.text("/edition/" + Q + "/poster/4x5")), 'gradient ' + before + ' → ' + after);
  const bz = await A.post('/edition/1/designs/bundle/' + kv, {});
  check('l’archive d’un kit se crée aussi (sans format)', /Archive créée/.test(A.loc(bz)), A.loc(bz));
});

await step('5. Corriger textes, cadrage et sous-titres', async () => {
  const msg = await A.post(`/edition/1/variants/${ids.v1}/messages`, { msg_title: 'LIGHT & SOUND', msg_tagline: 'Wonder after dark', msg_top: 'Every evening from sunset', msg_cta: 'Book now' });
  check('textes appliqués aux formats', /Textes appliqués/.test(A.loc(msg)));
  check('« Appliquer aux formats » reste sur l’étape Création (pas de saut vers la vérification), au bloc des textes', /step=creation/.test(A.loc(msg)) && /#textes$/.test(A.loc(msg)) && /id="textes"/.test(await A.text(`/edition/1/variants/${ids.v1}?step=creation&all=1`)), A.loc(msg));
  const render = await A.text(`/render/poster/1/4x5?variant=${ids.v1}`);
  check('l’aperçu de la variante montre ses textes, pas ceux du projet', /LIGHT &amp; SOUND/.test(render) && !/>NIGHT SHOW</.test(render));
  const base = await A.text('/render/poster/1/4x5');
  check('les affiches du projet restent intactes', />NIGHT SHOW</.test(base) && !/LIGHT &amp; SOUND/.test(base));
  await A.post(`/edition/1/poster/4x5/save?variant=${ids.v1}`, { hero: String(ids.hero), logo: String(ids.logo), partners: '1', style: 'classique', gradient: '55', posx: '35', posy: '40', zoom: '120', els: JSON.stringify({ title: { dx: 20, dy: -30, s: 110 } }) });
  const design = { asset: String(ids.video), start: 1, end: 7, logo: { asset: String(ids.logo), corner: 'tr', size: 14, margin: 4 }, endcard: { on: true, seconds: 2 }, subs: { on: true, size: 100 }, reframe: { '9x16': { posx: 40, posy: 50, zoom: 100 } }, formats: ['9x16', '4x5'] };
  const cues = [{ start: 0.5, end: 3, text: 'A walk through light and sound' }, { start: 3.2, end: 6, text: 'After dark, the temple comes alive' }];
  await A.post(`/edition/1/video/save?variant=${ids.v1}`, { design: JSON.stringify(design), cues: JSON.stringify(cues) });
  const vp = await A.text(`/edition/1/video?variant=${ids.v1}`);
  check('éditeur vidéo propre à la variante (sous-titres corrigés)', /class="ws"/.test(vp) && /Émerveillement/.test(vp) && /After dark, the temple/.test(vp));
  const projVideo = await A.text('/edition/1/video');
  check('les sous-titres du projet ne sont pas affectés', !/After dark, the temple/.test(projVideo));
});

await step('6. Prévisualiser puis approuver (seul(e), contrôles automatiques à la place d’un relecteur)', async () => {
  const un = await A.post(`/edition/1/variants/${ids.v1}/export`, {});
  check('export refusé tant que non approuvée', /doit d’abord être approuvé/.test(A.loc(un)), A.loc(un));
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
  const vp = await A.text(`/edition/1/variants/${ids.v1}?step=verification`);
  check('état compact : création, fichiers disponibles, diffusion', /Création approuvée \(v\d+\) · (\d+)\/\1 fichiers? disponibles?/.test(vp), (/Création approuvée[^<]*/.exec(vp) || [''])[0]);
  check('états détaillés distincts (création / exports / préparation / diffusion)', /Préparation à la diffusion/.test(vp) && /Une approbation ne prouve ni la réussite d’un export/.test(vp));
  check('Vérification et exports : sélection des sorties et fichiers éditables de la version approuvée', /name="o_4x5"/.test(vp) && /Exporter les sorties cochées/.test(vp) && /approved=1/.test(vp));
  const none = await A.post(`/edition/1/variants/${ids.v1}/export`, { sel: '1' });
  check('export sans aucune sortie cochée : message clair, rien lancé', /Cochez au moins une sortie/.test(decodeURIComponent(A.loc(none))), A.loc(none));
  const sv = await A.get(`/edition/1/poster/4x5/svg?variant=${ids.v1}&approved=1`);
  check('SVG de la version approuvée : produit, avec la version dans le nom', sv.status === 200 && /-v1\.svg/.test(sv.headers.get('content-disposition') || '') && /<svg/.test(await sv.text()), String(sv.status));
  check('le SVG éditable n’est pas servi pour un contenu sans version approuvée', (await A.get(`/edition/1/poster/4x5/svg?variant=999999&approved=1`)).status === 404);
  const asg = await A.post(`/edition/1/variants/${ids.v1}/assign`, { owner: 'Alice', reviewer: 'Alice', due_date: '2027-01-15' });
  check('responsable, relecteur facultatif et échéance enregistrés', /Responsable, relecteur et échéance enregistrés/.test(decodeURIComponent(A.loc(asg))), A.loc(asg));
  const vp2 = await A.text(`/edition/1/variants/${ids.v1}?step=verification`);
  check('personne attendue et échéance visibles dans le résumé', /attendu : Alice · échéance 2027-01-15/.test(vp2) && /Aucune validation à deux n’est obligatoire/.test(vp2) && !/Vous travaillez seul/.test(vp2));
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

await step('7b. Fichier d’export disparu : l’atelier le dit, la reprise ne crée aucun doublon', async () => {
  const c = await A.post('/edition/1/variants/new', { simple: '1', type: 'affiche', name: 'Test reprise export', fmt_4x5: '1', fmt_1x1: '1' });
  const vid = Number(/variants\/(\d+)/.exec(A.loc(c))?.[1]);
  check('contenu de test créé', !!vid, A.loc(c));
  await A.post(`/edition/1/variants/${vid}/approve-export`, {});
  const page = () => A.text(`/edition/1/variants/${vid}?step=verification`);
  const links = (h) => [...h.matchAll(/\/exports\/(\d+)\?dl=1/g)].map((m) => Number(m[1])).filter((x, i, a) => a.indexOf(x) === i).sort();
  let pg = await page();
  check('après l’export : 2/2 fichiers disponibles', /Création approuvée \(v\d+\) · 2\/2 fichiers disponibles/.test(pg), (/Création approuvée[^<]*/.exec(pg) || [''])[0]);
  const before = links(pg);
  const r = await A.get('/exports/' + before[0] + '?dl=1');
  const file = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1];
  await r.arrayBuffer();
  rmSync(join(DATA, 'exports', file), { force: true });
  pg = await page();
  check('fichier disparu : 1/2, cause expliquée, bouton de reprise', /1\/2 fichiers? disponibles?/.test(pg) && /n’est plus sur cet ordinateur/.test(pg) && /Reprendre l’export/.test(pg) && /partiels/.test(pg));
  check('le parcours ne coche pas « Vérification et exports » tant que tout n’existe pas', !/<li class="done[^"]*"><a href="[^"]*step=verification"/.test(pg));
  await A.post(`/edition/1/variants/${vid}/export`, {});
  pg = await page();
  check('après la reprise : 2/2 fichiers, aucun doublon (mêmes exports)', /2\/2 fichiers disponibles/.test(pg) && JSON.stringify(links(pg)) === JSON.stringify(before), links(pg).join(',') + ' / ' + before.join(','));
  check('le fichier est de nouveau téléchargeable', (await A.get('/exports/' + before[0] + '?dl=1')).status === 200);
});

await step('8. Un changement ne modifie JAMAIS une version approuvée', async () => {
  await A.post(`/edition/1/poster/4x5/save?variant=${ids.v1}`, { hero: String(ids.hero), logo: String(ids.logo), partners: '1', style: 'bandeau', gradient: '10', els: JSON.stringify({ title: { dx: 200, dy: 100, s: 150, text: 'TEXTE MODIFIÉ APRÈS APPROBATION' } }) });
  let page = await A.text(`/edition/1/variants/${ids.v1}`);
  check('la variante repasse « à relire » et signale que la v1 est intacte', /modifiée depuis son approbation/.test(page) && />à relire</.test(page));
  check('export officiel bloqué tant qu’elle n’est pas réapprouvée', /doit d’abord être approuvé|a changé depuis/.test(A.loc(await A.post(`/edition/1/variants/${ids.v1}/export`, {}))));
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

await step('9b. Guide Ads Manager : valeurs à copier, textes de publicité, import du rapport exporté', async () => {
  const C = `/edition/1/campaigns/${ids.c}`;
  const ad = await A.post(C + '/ad', { adset_id: String(ids.adset), name: 'Annonce guide', copy_primary: 'Une nuit de lumière dans un temple.', copy_headline: 'Night Show 2027', cta: 'Réserver' });
  check('publicité prévue avec ses textes', /Annonce reliée/.test(decodeURIComponent(A.loc(ad))), A.loc(ad));
  const cp = await A.text(C);
  const g = await A.text(C + '/guide');
  check('guide : trois niveaux, boutons Copier, rien envoyé à Meta', /Guide Ads Manager/.test(g) && /class="copy"/.test(g) && /Rien n’est envoyé à Meta/.test(g) && /Ensemble de publicités/.test(g) && /Nom de la publicité/.test(g));
  check('guide : textes de la publicité et bouton repris', /Une nuit de lumière dans un temple\./.test(g) && /Night Show 2027/.test(g) && /Réserver/.test(g));
  check('guide : objectif traduit et lien suivi (paramètres d’URL) proposés', /utm_source=meta/.test(g) && /Objectif de campagne/.test(g));
  check('guide : un visuel manquant est signalé', /Aucun fichier associé/.test(g) || /Aucun visuel/.test(g));
  const cid = /<option value="(\d+)">[^<]*— approuvé/.exec(cp)?.[1];
  const adIdReal = Number(/name="ad_id" value="(\d+)"/.exec(g)?.[1]);
  const lk = await A.post(C + '/link', { content_id: cid, ad_id: String(adIdReal) });
  check('contenu associé à la publicité', /associé en brouillon/.test(decodeURIComponent(A.loc(lk))), A.loc(lk));
  const g2 = await A.text(C + '/guide');
  check('guide : fichier à téléverser avec ses dimensions et lien de téléchargement', /Télécharger/.test(g2) && /\d{3,4}×\d{3,4}/.test(g2));
  const csv = 'Nom de la publicité;Début des rapports;Fin des rapports;Impressions;Clics sur un lien;Montant dépensé (EUR);Résultats\nAnnonce guide;2027-01-05;2027-01-12;"12 345";321;"45,67";9\nInconnue;2027-01-05;2027-01-12;10;1;"0,5";0\n';
  const pv = await (await A.post(C + '/import-results', { csv })).text();
  check('import : aperçu avec les nombres à la française lus correctement', /12345/.test(pv) && /45\.67/.test(pv) && /Annonce guide/.test(pv));
  check('import : publicité inconnue signalée, rien enregistré à l’analyse', /publicité inconnue/.test(pv) && !/Résultats importés/.test(pv));
  const payload = /name="payload" value="([^"]+)"/.exec(pv)?.[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const ap = await A.post(C + '/apply-results', { payload });
  check('import : lignes reconnues enregistrées', /Résultats importés : 1 ligne/.test(decodeURIComponent(A.loc(ap))), A.loc(ap));
  check('les résultats apparaissent dans la comparaison de la campagne', /12345/.test(await A.text(C)));
  const pv2 = await (await A.post(C + '/import-results', { csv })).text();
  check('même rapport réimporté : déjà enregistré, pas de doublon', /déjà enregistré/.test(pv2));
  const csvEn = 'Ad name,Reporting starts,Reporting ends,Impressions,Link clicks,Amount spent (USD),Results\nAnnonce guide,2027-02-01,2027-02-07,"1,500",30,12.5,2\n';
  const pv3 = await (await A.post(C + '/import-results', { csv: csvEn })).text();
  check('import : colonnes en anglais et séparateur virgule reconnus', /1500/.test(pv3) && /12\.5/.test(pv3));
  check('import : fichier sans colonne de publicité refusé avec explication', /Colonne « Nom de la publicité » introuvable/.test(await (await A.post(C + '/import-results', { csv: 'a;b\n1;2\n' })).text()));
  const cpy = await A.post(C + '/adcopy', { ad_id: String(adIdReal), name: 'Annonce guide', copy_primary: 'x'.repeat(200), copy_headline: 'Titre', cta: 'En savoir plus', meta_id: '1234567890' });
  const g3 = await A.text(C + '/guide');
  check('textes modifiables ; dépassement conseillé signalé ; identifiant Meta noté', /dépasse 125 caractères/.test(g3) && /ID 1234567890/.test(g3));
});

await step('10. Calendrier de production', async () => {
  const pl = await A.post(`/edition/1/variants/${ids.v2}/plan`, { publish: '2027-01-20' });
  check('planification à rebours (6 étapes)', /lanifié(e)? à rebours/.test(A.loc(pl)), A.loc(pl));
  const again = await A.post(`/edition/1/variants/${ids.v2}/plan`, { publish: '2027-01-25' });
  check('pas de double planification', /déjà planifié/.test(A.loc(again)));
  await A.post('/edition/1/calendar/new', { title: 'Réunion de lancement Meta', kind: 'jalon', due_date: '2027-01-12', owner: 'Alice', campaign_id: String(ids.c) });
  const cal = await A.text('/edition/1/calendar?month=2027-01');
  check('calendrier : chaque tâche porte ses détails pour la bulle au survol (titre, date, état, contenu)', /data-tip="[^"]*&quot;title&quot;:&quot;[^"]+&quot;when&quot;:/.test(cal) && /&quot;state&quot;:/.test(cal));
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

await step('11d. Timeline vidéo : clips bout à bout, éléments (échelle, rotation, opacité, début/fin), texte libre — l’export suit exactement', async () => {
  const t = await A.post('/edition/test'); const T = Number(/edition\/(\d+)/.exec(t.headers.get('location'))?.[1]);
  const clip = (color, name) => { const f = join(TMP, name); spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=' + color + ':size=640x360:rate=25:duration=1.5', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]); return f; };
  const vA = await A.up(T, 'video', 'rouge.mp4', readFileSync(clip('red', 'rouge.mp4'))), vB = await A.up(T, 'video', 'bleu.mp4', readFileSync(clip('blue', 'bleu.mp4')));
  const im = async (name, rgb) => String(await A.up(T, 'logo', name, png(200, 100, 0, rgb)));
  const mag = await im('magenta.png', [255, 0, 255]), grn = await im('vert.png', [0, 255, 0]), yel = await im('jaune.png', [255, 255, 0]);
  const P = (x, y) => ({ '9x16': { x, y } });
  const tl = { clips: [{ id: 'c1', asset: String(vA), in: 0, out: 0, reframe: {} }, { id: 'c2', asset: String(vB), in: 0, out: 0, reframe: {} }], els: [
    { id: 'e1', type: 'logo', asset: mag, start: 0, end: 0, pos: P(540, 500), s: 100 },
    { id: 'e2', type: 'image', asset: grn, start: 1.8, end: 0, pos: P(300, 1000), s: 100, rot: 90 },
    { id: 'e3', type: 'image', asset: yel, start: 0, end: 0, pos: P(800, 1500), s: 100, op: 50 },
    { id: 'e4', type: 'text', text: 'HELLO', color: '#00ffff', bold: true, outline: false, start: 0, end: 0, pos: P(540, 1300), s: 100 },
    { id: 'e5', type: 'subs', start: 0, end: 0, pos: P(300, 1700), s: 100 }] };
  const design = { asset: '', start: 0, end: 0, logo: { asset: '', corner: 'tr', size: 14, margin: 4 }, endcard: { on: false, seconds: 0 }, subs: { on: false, size: 100 }, reframe: {}, formats: ['9x16'], tl };
  await A.post('/edition/' + T + '/video/save', { design: JSON.stringify(design), cues: JSON.stringify([{ start: 0, end: 3, text: 'HELLO' }]) });
  const page = await A.text('/edition/' + T + '/video');
  check('le montage enregistré est relu tel quel (2 clips, 5 éléments, positions par format)', /rouge\.mp4|bleu\.mp4/.test(page) && (page.match(/&quot;type&quot;:&quot;/g) || []).length >= 5, '');
  await A.post('/edition/' + T + '/video/export', {});
  let job = null;
  for (let i = 0; i < 120; i++) { const js = await A.json('/api/jobs/' + T); job = js[0]; if (job && ['done', 'error'].includes(job.status)) break; await sleep(500); }
  check('export du montage terminé', job?.status === 'done', job?.message);
  if (job?.status !== 'done') return;
  const mp4 = join(TMP, 'tl-' + job.id + '.mp4');
  writeFileSync(mp4, Buffer.from(await (await A.get('/exports/' + job.export_id)).arrayBuffer()));
  const dur = Number(spawnSync(join(ROOT, 'tools/ffmpeg/ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).stdout.toString());
  check('durée = somme des deux clips (3 s)', Math.abs(dur - 3) < 0.25, String(dur));
  const frame = (sec) => spawnSync(FF, ['-v', 'error', '-ss', String(sec), '-i', mp4, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 30e6 }).stdout;
  const W = 1080, H = 1920, at = (rgb, x, y) => { const o = (y * W + x) * 3; return [rgb[o], rgb[o + 1], rgb[o + 2]]; };
  const bbox = (rgb, test) => { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let y = 120; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; if (test(rgb[o], rgb[o + 1], rgb[o + 2])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } } return x1 < 0 ? null : { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + 1, h: y1 - y0 + 1 }; };
  const f1 = frame(0.5), f2 = frame(2.2);
  const bg1 = at(f1, 100, 1800), bg2 = at(f2, 100, 1800);
  check('clips bout à bout : rouge au début, bleu ensuite', bg1[0] > 200 && bg1[1] < 70 && bg1[2] < 70 && bg2[2] > 200 && bg2[0] < 70, JSON.stringify([bg1, bg2]));
  const mg = (r, g, b) => r > 180 && g < 90 && b > 180, gr = (r, g, b) => g > 200 && r < 80 && b < 80, cy = (r, g, b) => r < 80 && g > 200 && b > 200, wh = (r, g, b) => r > 200 && g > 200 && b > 200;
  const m1 = bbox(f1, mg), m2 = bbox(f2, mg);
  check('logo : centre (540 × 500), largeur 20 % du format (216 px), sur toute la durée', !!m1 && !!m2 && Math.abs(m1.cx - 540) <= 3 && Math.abs(m1.cy - 500) <= 3 && Math.abs(m1.w - 216) <= 4 && Math.abs(m2.cx - 540) <= 3, JSON.stringify([m1, m2]));
  const g1 = bbox(f1, gr), g2 = bbox(f2, gr);
  check('image avec début différé (1,8 s) : absente avant, présente après', !g1 && !!g2, JSON.stringify([g1, g2]));
  check('rotation 90° : 200×100 devient 108×216 (taille 216 px de large), centre inchangé (300 × 1000)', !!g2 && Math.abs(g2.cx - 300) <= 3 && Math.abs(g2.cy - 1000) <= 3 && Math.abs(g2.w - 108) <= 4 && Math.abs(g2.h - 216) <= 4, JSON.stringify(g2));
  const op1 = at(f1, 800, 1500), op2 = at(f2, 800, 1500);
  check('opacité 50 % : jaune mêlé au fond rouge puis au fond bleu', op1[0] > 200 && op1[1] > 90 && op1[1] < 170 && op1[2] < 60 && op2[1] > 90 && op2[1] < 170 && op2[2] > 90 && op2[2] < 170, JSON.stringify([op1, op2]));
  const tx = bbox(f1, cy);
  check('texte libre : rendu par le navigateur, centre (540 × 1300)', !!tx && Math.abs(tx.cx - 540) <= 6 && Math.abs(tx.cy - 1300) <= 25, JSON.stringify(tx));
  const sb = bbox(f1, wh);
  check('sous-titres de la timeline : centre (300 × 1700)', !!sb && Math.abs(sb.cx - 300) <= 12 && Math.abs(sb.cy - 1700) <= 30, JSON.stringify(sb));
  // un montage dont le premier clip est remplacé par un autre écran (matériel du contenu) : la timeline suit
  const again = await A.post('/edition/' + T + '/video/export', {});
  check('relancer le même montage ne refait pas le travail (même clé)', /déjà produit/.test(A.loc(again)), A.loc(again));
});

await step('11c. Vidéo : logo et sous-titres placés par leur centre ; l’export suit exactement ce qui est choisi', async () => {
  const t = await A.post('/edition/test'); const T = Number(/edition\/(\d+)/.exec(t.headers.get('location'))?.[1]);
  const vf = join(TMP, 'noir.mp4');
  spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:size=640x360:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vf]);
  const vid = await A.up(T, 'video', 'noir.mp4', readFileSync(vf));
  const logo = await A.up(T, 'logo', 'magenta.png', png(200, 100, 0, [255, 0, 255]));
  const cues = [{ start: 0, end: 2, text: 'HELLO' }];
  const mk = (lsize, ssize, lpos, spos) => ({ asset: String(vid), start: 0, end: 0, logo: { asset: String(logo), corner: 'tr', size: lsize, margin: 4, ...(lpos ? { pos: { '9x16': lpos } } : {}) }, endcard: { on: false, seconds: 0 }, subs: { on: true, size: ssize, ...(spos ? { pos: { '9x16': spos } } : {}) }, reframe: {}, formats: ['9x16'] });
  const exportFrame = async (design) => {
    const before = (await A.json('/api/jobs/' + T)).length;
    await A.post('/edition/' + T + '/video/save', { design: JSON.stringify(design), cues: JSON.stringify(cues) });
    await A.post('/edition/' + T + '/video/export', {});
    let job = null;
    for (let i = 0; i < 90; i++) { const js = await A.json('/api/jobs/' + T); job = js[0]; if (js.length > before && job && ['done', 'error'].includes(job.status)) break; await sleep(500); }
    if (!job || job.status !== 'done') return { err: job ? job.message : 'aucun export' };
    const mp4 = join(TMP, 'pos-' + job.id + '.mp4');
    writeFileSync(mp4, Buffer.from(await (await A.get('/exports/' + job.export_id)).arrayBuffer()));
    const r = spawnSync(FF, ['-v', 'error', '-ss', '0.5', '-i', mp4, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 30e6 });
    return { rgb: r.stdout, W: 1080, H: 1920 };
  };
  // boîte englobante des pixels qui répondent au test, hors bandeau BROUILLON du haut
  const bbox = ({ rgb, W, H }, test) => { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let y = 120; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; if (test(rgb[o], rgb[o + 1], rgb[o + 2])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } } return x1 < 0 ? null : { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + 1, h: y1 - y0 + 1 }; };
  const magenta = (r, g, b) => r > 180 && g < 90 && b > 180, white = (r, g, b) => r > 200 && g > 200 && b > 200;
  const a = await exportFrame(mk(20, 100, { x: 540, y: 600 }, { x: 300, y: 1300 }));
  const b = await exportFrame(mk(40, 160, { x: 540, y: 600 }, { x: 300, y: 1300 }));
  check('export vidéo avec positions choisies : terminé', !a.err && !b.err, a.err || b.err);
  const la = a.rgb && bbox(a, magenta), lb = b.rgb && bbox(b, magenta), sa = a.rgb && bbox(a, white), sb = b.rgb && bbox(b, white);
  check('logo : placé par son centre (540 × 600) dans la vidéo exportée', !!la && Math.abs(la.cx - 540) <= 3 && Math.abs(la.cy - 600) <= 3, JSON.stringify(la));
  check('logo : agrandi (20 % → 40 %), son centre ne bouge pas', !!lb && lb.w > la.w * 1.8 && Math.abs(lb.cx - 540) <= 3 && Math.abs(lb.cy - 600) <= 3, JSON.stringify([la, lb]));
  check('sous-titres : placés par leur centre (300 × 1300), à la tolérance des polices près', !!sa && Math.abs(sa.cx - 300) <= 12 && Math.abs(sa.cy - 1300) <= 30, JSON.stringify(sa));
  check('sous-titres : taille 100 % → 160 %, leur centre ne bouge pas', !!sb && sb.w > sa.w * 1.4 && Math.abs(sb.cx - 300) <= 12 && Math.abs(sb.cy - 1300) <= 30, JSON.stringify([sa, sb]));
  const c = await exportFrame(mk(20, 100, null, null));
  const lc = c.rgb && bbox(c, magenta), sc = c.rgb && bbox(c, white);
  check('sans position choisie : le logo reste dans son coin d’origine (haut droite) et les sous-titres en bas, comme avant', !!lc && lc.cx > 800 && lc.cy < 400 && !!sc && Math.abs(sc.cx - 540) <= 12 && sc.cy > 1500, JSON.stringify([lc, sc]));
  const d = await A.json('/api/jobs/' + T);
  const saved = await A.text('/edition/' + T + '/video');
  check('l’éditeur vidéo est un éditeur à timeline : aperçu, réglages, pistes et boutons d’ajout', /id="tlinner"/.test(saved) && /id="vprops"/.test(saved) && /id="t_addclip"/.test(saved) && /id="t_addtext"/.test(saved) && /id="t_split"/.test(saved));
});

await step('11e. Montage à timeline approuvé : l’export part de la version figée, une modification ne la touche pas', async () => {
  const t = await A.post('/edition/test'); const T = Number(/edition\/(\d+)/.exec(t.headers.get('location'))?.[1]);
  const clip = (color, name) => { const f = join(TMP, name); spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=' + color + ':size=640x360:rate=25:duration=1.5', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]); return f; };
  const ok = async (name, f) => { const id = await A.up(T, 'video', name, readFileSync(f)); await A.post('/assets/' + id + '/update', { role: 'video', status: 'approuvé', rights: 'OK (test)' }); return id; };
  const vA = await ok('rouge-e.mp4', clip('red', 'rouge-e.mp4')), vB = await ok('bleu-e.mp4', clip('blue', 'bleu-e.mp4'));
  const c = await A.post('/edition/' + T + '/variants/new', { type: 'video', name: 'Montage à timeline', asset: String(vA) });
  const V = Number(/variants\/(\d+)/.exec(c.headers.get('location') || '')?.[1]);
  const mk = (text) => ({ asset: String(vA), start: 0, end: 0, logo: { asset: '', corner: 'tr', size: 14, margin: 4 }, endcard: { on: false, seconds: 0 }, subs: { on: false, size: 100 }, reframe: {}, formats: ['9x16'],
    tl: { clips: [{ id: 'c1', asset: String(vA), in: 0, out: 0, reframe: {} }, { id: 'c2', asset: String(vB), in: 0, out: 0, reframe: {} }], els: [{ id: 'e1', type: 'text', text, color: '#00ffff', bold: true, outline: false, start: 0, end: 0, pos: { '9x16': { x: 540, y: 900 } }, s: 100 }] } });
  await A.post('/edition/' + T + '/video/save?variant=' + V, { design: JSON.stringify(mk('FIGE')) });
  const ae = await A.post('/edition/' + T + '/variants/' + V + '/approve-export', {});
  check('approuver et exporter un montage à timeline', /Approuvée \(v1\) et exportée/.test(A.loc(ae)), A.loc(ae));
  let job = null;
  for (let i = 0; i < 120; i++) { const js = await A.json('/api/jobs/' + T); job = js[0]; if (job && ['done', 'error'].includes(job.status)) break; await sleep(500); }
  check('l’export de la version approuvée est terminé', job?.status === 'done', job?.message);
  if (job?.status !== 'done') return;
  const mp4 = join(TMP, 'fige-' + job.id + '.mp4');
  writeFileSync(mp4, Buffer.from(await (await A.get('/exports/' + job.export_id)).arrayBuffer()));
  const W = 1080, frame = (sec) => spawnSync(FF, ['-v', 'error', '-ss', String(sec), '-i', mp4, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 30e6 }).stdout;
  const at = (rgb, x, y) => { const o = (y * W + x) * 3; return [rgb[o], rgb[o + 1], rgb[o + 2]]; };
  const f1 = frame(0.5), f2 = frame(2.2), b1 = at(f1, 100, 1800), b2 = at(f2, 100, 1800);
  let x0 = 1e9, x1 = -1; for (let x = 0; x < W; x++) { const [r, g, b] = at(f1, x, 905); if (r < 80 && g > 200 && b > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; } }
  check('version approuvée : clips rouge puis bleu, texte « FIGE » centré (540) sur l’export', b1[0] > 200 && b2[2] > 200 && x1 > 0 && Math.abs((x0 + x1) / 2 - 540) <= 8, JSON.stringify([b1, b2, x0, x1]));
  await A.post('/edition/' + T + '/video/save?variant=' + V, { design: JSON.stringify(mk('AUTRE')) });
  const page = await A.text('/edition/' + T + '/variants/' + V);
  check('modifier le montage : le contenu repasse « à relire », la version approuvée v1 reste intacte', /modifi[ée]+ depuis son approbation/.test(page) && /v1/.test(page), '');
});

await step('11f. Plusieurs blocs de sous-titres : chacun a ses lignes, sa position, sa taille et son timing', async () => {
  const t = await A.post('/edition/test'); const T = Number(/edition\/(\d+)/.exec(t.headers.get('location'))?.[1]);
  const vf = join(TMP, 'noir-f.mp4');
  spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:size=640x360:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vf]);
  const vid = await A.up(T, 'video', 'noir-f.mp4', readFileSync(vf));
  const P = (x, y) => ({ '9x16': { x, y } });
  const tl = { clips: [{ id: 'c1', asset: String(vid), in: 0, out: 0, reframe: {} }], els: [
    { id: 'e1', type: 'subs', start: 0, end: 0, pos: P(300, 1700), s: 100, cues: [{ start: 0, end: 1, text: 'AAAA' }] },
    { id: 'e2', type: 'subs', start: 0, end: 0, pos: P(800, 1200), s: 160, cues: [{ start: 1, end: 2, text: 'BBBB' }] }] };
  const design = { asset: '', start: 0, end: 0, logo: { asset: '', corner: 'tr', size: 14, margin: 4 }, endcard: { on: false, seconds: 0 }, subs: { on: false, size: 100 }, reframe: {}, formats: ['9x16'], tl };
  await A.post('/edition/' + T + '/video/save', { design: JSON.stringify(design), cues: JSON.stringify([]) });
  const page = await A.text('/edition/' + T + '/video');
  check('deux blocs de sous-titres enregistrés, chacun avec ses lignes', /AAAA/.test(page) && /BBBB/.test(page) && (page.match(/&quot;type&quot;:&quot;subs&quot;/g) || []).length >= 2);
  await A.post('/edition/' + T + '/video/export', {});
  let job = null;
  for (let i = 0; i < 120; i++) { const js = await A.json('/api/jobs/' + T); job = js[0]; if (job && ['done', 'error'].includes(job.status)) break; await sleep(500); }
  check('export terminé', job?.status === 'done', job?.message);
  if (job?.status !== 'done') return;
  const mp4 = join(TMP, 'subs2-' + job.id + '.mp4');
  writeFileSync(mp4, Buffer.from(await (await A.get('/exports/' + job.export_id)).arrayBuffer()));
  const W = 1080, H = 1920, frame = (sec) => spawnSync(FF, ['-v', 'error', '-ss', String(sec), '-i', mp4, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 30e6 }).stdout;
  const bbox = (rgb) => { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let y = 120; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; if (rgb[o] > 200 && rgb[o + 1] > 200 && rgb[o + 2] > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } } return x1 < 0 ? null : { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + 1 }; };
  const a = bbox(frame(0.5)), b = bbox(frame(1.5));
  check('premier bloc : sa ligne seule à 0,5 s, centrée (300 × 1700)', !!a && Math.abs(a.cx - 300) <= 12 && Math.abs(a.cy - 1700) <= 30, JSON.stringify(a));
  check('second bloc : sa ligne seule à 1,5 s, centrée (800 × 1200), plus grand (taille 160 %)', !!b && Math.abs(b.cx - 800) <= 14 && Math.abs(b.cy - 1200) <= 30 && b.w > a.w * 1.4, JSON.stringify([a, b]));
});

await step('11g. Pistes : l’ordre des pistes décide de ce qui est au-dessus ; vidéo superposée (début, position, taille, son)', async () => {
  const t = await A.post('/edition/test'); const T = Number(/edition\/(\d+)/.exec(t.headers.get('location'))?.[1]);
  const mkv = (color, name, secs) => { const f = join(TMP, name); spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=' + color + ':size=640x360:rate=25:duration=' + secs, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=' + secs, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]); return readFileSync(f); };
  const main = await A.up(T, 'video', 'fond-g.mp4', mkv('black', 'fond-g.mp4', 3)), over = await A.up(T, 'video', 'rouge-g.mp4', mkv('red', 'rouge-g.mp4', 1.5));
  const im = async (name, rgb) => String(await A.up(T, 'logo', name, png(200, 100, 0, rgb)));
  const mag = await im('mag-g.png', [255, 0, 255]), grn = await im('vert-g.png', [0, 255, 0]);
  const P = (x, y) => ({ '9x16': { x, y } });
  const mk = (tM, tG) => ({ asset: '', start: 0, end: 0, logo: { asset: '', corner: 'tr', size: 14, margin: 4 }, endcard: { on: false, seconds: 0 }, subs: { on: false, size: 100 }, reframe: {}, formats: ['9x16'],
    tl: { clips: [{ id: 'c1', asset: String(main), in: 0, out: 0, reframe: {} }], els: [
      { id: 'e1', type: 'image', asset: mag, track: tM, start: 0, end: 0, pos: P(300, 500), s: 100 },
      { id: 'e2', type: 'image', asset: grn, track: tG, start: 0, end: 0, pos: P(300, 500), s: 100 },
      { id: 'e3', type: 'video', asset: String(over), track: 3, start: 1, in: 0, out: 0, pos: P(540, 1000), s: 50, vol: 100 }] } });
  const W = 1080, H = 1920;
  const run = async (design) => {
    const before = (await A.json('/api/jobs/' + T)).length;
    await A.post('/edition/' + T + '/video/save', { design: JSON.stringify(design), cues: JSON.stringify([]) });
    await A.post('/edition/' + T + '/video/export', {});
    let job = null;
    for (let i = 0; i < 120; i++) { const js = await A.json('/api/jobs/' + T); job = js[0]; if (js.length > before && job && ['done', 'error'].includes(job.status)) break; await sleep(500); }
    if (!job || job.status !== 'done') return { err: job ? job.message : 'aucun export' };
    const mp4 = join(TMP, 'pistes-' + job.id + '.mp4');
    writeFileSync(mp4, Buffer.from(await (await A.get('/exports/' + job.export_id)).arrayBuffer()));
    const frame = (sec) => spawnSync(FF, ['-v', 'error', '-ss', String(sec), '-i', mp4, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 30e6 }).stdout;
    const probe = spawnSync(join(ROOT, 'tools/ffmpeg/ffprobe.exe'), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', mp4]).stdout.toString();
    return { frame, audio: /audio/.test(probe) };
  };
  const at = (rgb, x, y) => { const o = (y * W + x) * 3; return [rgb[o], rgb[o + 1], rgb[o + 2]]; };
  const redBox = (rgb) => { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let y = 120; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; if (rgb[o] > 200 && rgb[o + 1] < 60 && rgb[o + 2] < 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } } return x1 < 0 ? null : { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + 1, h: y1 - y0 + 1 }; };
  const a = await run(mk(2, 1));
  check('export avec pistes et vidéo superposée : terminé, son présent', !a.err && a.audio, a.err || '');
  if (a.err) return;
  const f05 = a.frame(0.5), f15 = a.frame(1.5);
  const top1 = at(f05, 300, 500);
  check('piste 2 (magenta) au-dessus de la piste 1 (vert) là où ils se recouvrent', top1[0] > 200 && top1[1] < 80 && top1[2] > 200, JSON.stringify(top1));
  check('vidéo superposée : absente avant son début (1 s)', !redBox(f05), JSON.stringify(redBox(f05)));
  const rb = redBox(f15);
  check('vidéo superposée : présente à 1,5 s, centre (540 × 1000), largeur 50 % du format (540 px), proportions 16:9', !!rb && Math.abs(rb.cx - 540) <= 4 && Math.abs(rb.cy - 1000) <= 4 && Math.abs(rb.w - 540) <= 5 && Math.abs(rb.h - 304) <= 5, JSON.stringify(rb));
  const b = await run(mk(1, 2));
  const top2 = at(b.frame(0.5), 300, 500);
  check('les pistes échangées : le vert passe au-dessus du magenta', !b.err && top2[1] > 200 && top2[0] < 80 && top2[2] < 80, JSON.stringify(top2));
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
    await br.go(U + '/edition/1/variants/new?mode=test');
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
    check('éditeur : bandeau « variante » et aperçu de la variante', await br.ev(`document.body.innerText.includes('Émerveillement') && !!document.querySelector('.ws .steps') && document.getElementById('pframe').src.includes('variant=${ids.v1}')`));
    check('éditeur : le formulaire édite bien la variante', await br.ev(`document.getElementById('pform').dataset.variant === '${ids.v1}' && document.getElementById('pform').action.includes('variant=${ids.v1}')`));
    await br.ev(String.raw`document.getElementById('pframe').contentWindow.postMessage({ type: 'select', id: 'title' }, location.origin)`);
    await br.sleep(600);
    const X0 = await br.ev(String.raw`Number(document.getElementById('el_dx').value)`);
    check('position : le curseur affiche la position réelle sur l’affiche (pas 0)', X0 > 100, String(X0));
    await br.ev(String.raw`(() => { const r = document.getElementById('el_dx'); r.value = 456; r.dispatchEvent(new Event('input', { bubbles: true })); const y = document.getElementById('el_dy'); y.value = 345; y.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await br.sleep(500);
    const c = await br.ev(String.raw`(() => { const e = document.getElementById('pframe').contentDocument.querySelector('[data-el=title]').getBoundingClientRect(); return [Math.round(e.left + e.width / 2), Math.round(e.top + e.height / 2)]; })()`);
    check('position : centre de l’élément placé à 456 × 345 px', Math.abs(c[0] - 456) <= 2 && Math.abs(c[1] - 345) <= 2, JSON.stringify(c));
    // la taille se règle autour du centre : agrandir ou réduire ne déplace pas l'élément (la position en px reste vraie)
    const probe = String.raw`(() => { const e = document.getElementById('pframe').contentDocument.querySelector('[data-el=title]').getBoundingClientRect(); return [Math.round(e.left + e.width / 2), Math.round(e.top + e.height / 2), Math.round(e.width)]; })()`;
    const seen = [];
    for (const s of [200, 50, 100]) {
      await br.ev(String.raw`(() => { const r = document.getElementById('el_s'); r.value = ${s}; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await br.sleep(400);
      seen.push(await br.ev(probe));
    }
    check('taille : l’élément se redimensionne autour de son centre, sa position ne bouge pas', seen.every((p) => Math.abs(p[0] - 456) <= 2 && Math.abs(p[1] - 345) <= 2) && seen[0][2] > seen[2][2] && seen[1][2] < seen[2][2], JSON.stringify(seen));
    await shot('editeur-variante');
    for (const [p, n, re] of [['/edition/1/calendar?month=2027-01', 'calendrier', 'Réunion de lancement'], [`/edition/1/campaigns/${ids.c}`, 'campagne', 'Configuration Meta'], [`/edition/1/campaigns/${ids.c}/guide`, 'guide-meta', 'Guide Ads Manager'], ['/edition/1/variants', 'variantes', 'Tous les contenus'], ['/settings', 'reglages', 'Sauvegardes'], ['/edition/1/contents', 'contenus', 'Associé']]) {
      await br.go(U + p);
      check(`page ${n} s’affiche`, await br.ev(`document.body.innerText.includes(${JSON.stringify(re)})`));
      await shot(n);
    }
    for (const [p, n, re] of [['/edition/1', 'accueil', 'Production à reprendre'], ['/edition/1/settings', 'parametres', 'Paramètres du projet'], ['/edition/1/assets', 'bibliotheque', 'Fichiers sources'], ['/edition/3/poster/4x5', 'affiche-recue', 'Affiche'],
      ['/edition/3/variants/new', 'creer-contenu', 'Ajouter un contenu'], [`/edition/3/variants/${ids.w.v1}?step=materiel`, 'ws-materiel', 'Ajouter un fichier'], [`/edition/3/variants/${ids.w.v1}?step=creation&all=1`, 'ws-creation', 'Modifier ce format'],
      [`/edition/3/variants/${ids.w.v1}`, 'ws-verification', 'Contrôles automatiques'], [`/edition/3/variants/${ids.w.v1}?step=diffusion`, 'ws-diffusion', 'Télécharger uniquement'],
      [`/edition/3/poster/1x1?variant=${ids.w.v1}`, 'ws-editeur-affiche', 'Création'], [`/edition/3/video?variant=${ids.w.v2}`, 'ws-editeur-video', 'Création'], [`/edition/3/texts/${ids.w.tid}?step=creation`, 'ws-texte', 'Rédaction'], ['/edition/3/variants', 'contenus-liste', 'Script teaser'], ['/edition/1/campaigns', 'campagnes-liste', 'Meta :'], [`/edition/1/campaigns/${ids.c}`, 'campagne-detail', 'Contenus de cette campagne'], ['/edition/1/settings#connexions', 'connexions', 'Connexions du projet'], ['/edition/1/designs', 'designs-liste', 'Kit graphique du projet']]) {
      await br.go(U + p);
      check(`page ${n} s’affiche`, await br.ev(`document.body.innerText.includes(${JSON.stringify(re)})`));
      check(`page ${n} : pas de défilement horizontal (bureau)`, await br.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
      await shot(n);
    }
    await br.go(U + '/edition/1/calendar?month=2027-01');
    await br.ev("(() => { document.querySelector('table.cal [data-tip]').dispatchEvent(new MouseEvent('mouseenter')); return true; })()");
    check('calendrier : au survol, une bulle montre le détail de la tâche (sans cliquer)', await br.ev("(() => { const t = document.getElementById('caltip'); return !!t && !t.hidden && /Quand/.test(t.innerText) && t.innerText.length > 20; })()"));
    await shot('calendrier-survol');
    await br.ev("(() => { document.querySelector('table.cal [data-tip]').dispatchEvent(new MouseEvent('mouseleave')); return true; })()");
    check('calendrier : la bulle disparaît quand la souris s’en va', await br.ev("document.getElementById('caltip').hidden"));
    // éditeur vidéo à timeline : sélection, X/Y au centre, échelle, rotation, opacité, glisser, timeline, ajout, scission, suppression, enregistrement
    const press = (sel, dx = 0) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}), r = b.getBoundingClientRect(), o = { bubbles: true, cancelable: true, pointerId: 5, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; const tl = document.getElementById('tlinner'); b.dispatchEvent(new PointerEvent('pointerdown', o)); tl.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: o.clientX + ${dx} })); tl.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: o.clientX + ${dx} })); return true; })()`;
    const setK = (k, v) => `(() => { const i = document.querySelector('#vprops input[type=number][data-k="${k}"]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
    const nodeC = (i) => `(() => { const l = document.querySelectorAll('#vlayer .vel')[${i}], f = document.getElementById('vframe'), r = l.getBoundingClientRect(), fr = f.getBoundingClientRect(), k = fr.width / f.offsetWidth; return [Math.round((r.left + r.width / 2 - fr.left) / k), Math.round((r.top + r.height / 2 - fr.top) / k), Math.round(l.offsetWidth), +k.toFixed(4)]; })()`;
    await br.go(U + '/edition/1/video?variant=' + ids.v1);
    await br.sleep(2200);
    check('éditeur vidéo : aperçu, réglages, timeline et boutons d’ajout présents', await br.ev("['vframe', 'vprops', 'tlinner', 't_addclip', 't_addtext', 't_addimg', 't_addsubs', 't_split', 't_del', 'vplay'].every((id) => !!document.getElementById(id))"));
    check('ancien design converti en timeline : 1 clip de 6 s, un logo et des sous-titres, chacun sur sa piste', await br.ev("(() => { const S = window.__video; return S.tl.clips.length === 1 && S.tl.els.map((e) => e.type).join() === 'logo,subs' && document.querySelectorAll('#tltracks .tlb').length === 3 && /6 s/.test(document.querySelector('.tlb.clip').textContent); })()"));
    await shot('video-timeline');
    await br.ev(press('.tlb.el.t-logo'));
    check('timeline : cliquer un bloc sélectionne l’élément (même panneau de réglages pour tous)', await br.ev("document.querySelector('#vprops h3').textContent === 'Logo' && !!document.querySelector('#vprops [data-k=x]') && !!document.querySelector('#vprops [data-k=rot]') && !!document.querySelector('#vprops [data-k=op]') && !document.getElementById('vsel').hidden"));
    await br.ev(setK('x', 540)); await br.ev(setK('y', 700));
    const c1 = await br.ev(nodeC(0));
    check('réglages : X/Y placent le centre de l’élément exactement là', Math.abs(c1[0] - 540) <= 2 && Math.abs(c1[1] - 700) <= 2, JSON.stringify(c1));
    await br.ev(setK('s', 150));
    const c2 = await br.ev(nodeC(0));
    check('réglages : l’échelle grandit l’élément autour de son centre (ne le déplace pas)', c2[2] > c1[2] * 1.9 && Math.abs(c2[0] - 540) <= 2 && Math.abs(c2[1] - 700) <= 2, JSON.stringify([c1, c2]));
    await br.ev(setK('rot', 90)); await br.ev(setK('op', 50));
    const c3 = await br.ev(nodeC(0));
    check('réglages : rotation et opacité, centre inchangé', await br.ev("window.__video.tl.els[0].rot === 90 && document.querySelectorAll('#vlayer .vel')[0].style.opacity === '0.5' && /rotate\\(90deg\\)/.test(document.querySelectorAll('#vlayer .vel')[0].style.transform)") && Math.abs(c3[0] - 540) <= 2 && Math.abs(c3[1] - 700) <= 2, JSON.stringify(c3));
    await br.ev(setK('rot', 0)); await br.ev(setK('s', 100)); await br.ev(setK('op', 100));
    await br.ev(`(() => { const l = document.querySelectorAll('#vlayer .vel')[0], r = l.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, f = document.getElementById('vframe'); const ev = (t, el, dx) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, clientX: x + dx, clientY: y + dx / 2 })); ev('pointerdown', l, 0); ev('pointermove', f, 60); ev('pointerup', f, 60); return true; })()`);
    const c4 = await br.ev(nodeC(0)), kk = c4[3];
    check('aperçu : glisser un élément le déplace du même nombre de px dans le format', Math.abs(c4[0] - (540 + 60 / kk)) <= 3 && Math.abs(c4[1] - (700 + 30 / kk)) <= 3, JSON.stringify([c1, c4]));
    await br.ev("(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })); return true; })()");
    const c5 = await br.ev(nodeC(0));
    check('aperçu : les flèches ajustent la position (Maj = 10 px)', Math.abs(c5[0] - (c4[0] + 10)) <= 2, JSON.stringify([c4, c5]));
    await br.ev(press('.tlb.el.t-logo', 60));
    check('timeline : glisser un bloc d’élément change son début (60 px = 1 s)', await br.ev("Math.abs(window.__video.tl.els[0].start - 1) <= 0.15"), await br.ev("String(window.__video.tl.els[0].start)"));
    await br.ev(setK('start', 0));
    await br.ev("(() => { document.getElementById('t_addtext').click(); return true; })()");
    check('+ Texte : un texte apparaît sur la timeline avec son éditeur (texte, police, couleur, contour)', await br.ev("(() => { const S = window.__video, e = S.tl.els[S.tl.els.length - 1]; return e.type === 'text' && !!document.querySelector('#vprops textarea[data-k=text]') && !!document.querySelector('#vprops select[data-k=font]') && !!document.querySelector('#vprops input[data-k=color]'); })()"));
    await br.ev("(() => { const i = document.querySelector('#vprops textarea[data-k=text]'); i.value = 'BONJOUR'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
    check('texte : le contenu saisi s’affiche sur l’aperçu et sur la timeline', await br.ev("[...document.querySelectorAll('#vlayer .vel')].some((n) => n.textContent === 'BONJOUR') && /BONJOUR/.test(document.getElementById('tltracks').textContent)"));
    await br.ev("(() => { document.getElementById('t_addclip').click(); return true; })()");
    check('+ Clip : la fenêtre de choix liste les vidéos de la bibliothèque', await br.ev("!document.getElementById('vpick').hidden && document.querySelectorAll('#vpick-list .pk').length >= 1"));
    await br.ev("(() => { document.querySelector('#vpick-list .pk').click(); return true; })()");
    await br.sleep(1200);
    check('+ Clip : le clip s’ajoute à la suite des autres (la durée du film augmente)', await br.ev("window.__video.tl.clips.length === 2 && document.querySelectorAll('.tlb.clip').length === 2"));
    await br.ev(`(() => { const r = document.getElementById('tlruler'), b = r.getBoundingClientRect(), o = { bubbles: true, cancelable: true, pointerId: 6, clientX: b.left + 2 * window.__video.zoom, clientY: b.top + 8 }; r.dispatchEvent(new PointerEvent('pointerdown', o)); r.dispatchEvent(new PointerEvent('pointerup', o)); return true; })()`);
    await br.sleep(300);
    check('timeline : cliquer sur la règle place la tête de lecture', await br.ev("Math.abs(window.__video.t - 2) < 0.3"), await br.ev("String(window.__video.t)"));
    await br.ev("(() => { document.getElementById('t_split').click(); return true; })()");
    check('✂ Scinder : le clip est coupé en deux à la tête de lecture', await br.ev("window.__video.tl.clips.length === 3 && Math.abs(window.__video.tl.clips[0].out - 3) < 0.3"), await br.ev("JSON.stringify(window.__video.tl.clips.map((c) => [c.in, c.out]))"));
    await br.ev(press('.tlb.el.t-text'));
    await br.ev("(() => { document.getElementById('t_del').click(); return true; })()");
    check('Supprimer : le texte sélectionné disparaît de la timeline et de l’aperçu', await br.ev("window.__video.tl.els.every((e) => e.type !== 'text') && ![...document.querySelectorAll('#vlayer .vel')].some((n) => n.textContent === 'BONJOUR')"));
    check('les modifications non enregistrées sont signalées', await br.ev("!document.getElementById('vdirty').hidden"));
    await shot('video-elements');
    // enregistrement : le montage est relu tel quel après rechargement (page d'un autre projet : rien n'est exporté)
    await br.ev('window.__video.dirty = false'); // pas de vrai geste utilisateur ici : on évite l'avertissement « quitter la page »
    await br.go(U + '/edition/3/video?variant=' + ids.w.v2);
    await br.sleep(1800);
    await br.ev("(() => { document.getElementById('t_addtext').click(); const i = document.querySelector('#vprops textarea[data-k=text]'); i.value = 'PERSISTE'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('vform').requestSubmit(); return true; })()");
    await br.sleep(2500);
    check('enregistrer : le montage (clips, éléments, positions) est relu tel quel après rechargement', await br.ev("window.__video.tl.els.some((e) => e.type === 'text' && e.text === 'PERSISTE') && window.__video.tl.clips.length >= 1 && document.getElementById('vdirty').hidden"));
    // clips : réordonner par glisser, rogner un bord, atteindre le 2e clip en cliquant sur la règle
    await br.ev("(() => { document.getElementById('t_addclip').click(); return true; })()");
    await br.ev("(() => { document.querySelector('#vpick-list .pk').click(); return true; })()");
    await br.sleep(1200);
    const ids0 = await br.ev("window.__video.tl.clips.map((c) => c.id).join()");
    check('timeline : deux clips à la suite', ids0.split(',').length === 2, ids0);
    const wFirst = await br.ev("document.querySelector('.tlb.clip').getBoundingClientRect().width");
    await br.ev(press('.tlb.clip[data-id="' + ids0.split(',')[1] + '"]', -Math.round(wFirst) - 30));
    check('timeline : glisser un clip avant l’autre change leur ordre', await br.ev("window.__video.tl.clips.map((c) => c.id).join()") === ids0.split(',').reverse().join(), await br.ev("window.__video.tl.clips.map((c) => c.id).join()"));
    const dur0 = await br.ev("window.__video.tl.clips[0].out");
    await br.ev(press('.tlb.clip .tlh.r', -30));
    check('timeline : tirer le bord droit d’un clip le raccourcit (30 px = 0,5 s)', await br.ev("(() => { const c = window.__video.tl.clips[0]; return c.out > 0 && c.out > c.in + 0.2; })()"), await br.ev("JSON.stringify(window.__video.tl.clips[0])"));
    await br.ev(`(() => { const r = document.getElementById('tlruler'), b = r.getBoundingClientRect(), o = { bubbles: true, cancelable: true, pointerId: 6, clientX: b.left + (window.__video.tl.clips[0].out - window.__video.tl.clips[0].in + 0.5) * window.__video.zoom, clientY: b.top + 8 }; r.dispatchEvent(new PointerEvent('pointerdown', o)); r.dispatchEvent(new PointerEvent('pointerup', o)); return true; })()`);
    await br.sleep(500);
    check('lecture : la tête de lecture dans le 2e clip charge sa vidéo dans l’aperçu', await br.ev("document.getElementById('vplayer').src.endsWith('/files/' + window.__video.tl.clips[1].asset)"), await br.ev("document.getElementById('vplayer').src"));
    await br.ev('window.__video.dirty = false');
    // annuler / rétablir
    const key = (k, extra = '') => `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', ctrlKey: true, ${extra} bubbles: true, cancelable: true })); return true; })()`;
    const nEls = () => br.ev('window.__video.tl.els.length');
    const n0 = await nEls();
    await br.ev("(() => { document.getElementById('t_addtext').click(); return true; })()");
    await br.sleep(600);
    check('annuler : le bouton « Annuler » est actif après une modification', await br.ev("!document.getElementById('t_undo').disabled"));
    check('+ Texte : un élément de plus', (await nEls()) === n0 + 1);
    await br.ev(key('z')); await br.sleep(200);
    check('Ctrl+Z annule l’ajout du texte', (await nEls()) === n0, String(await nEls()));
    check('rétablir : le bouton « Rétablir » devient actif', await br.ev("!document.getElementById('t_redo').disabled"));
    await br.ev(key('y')); await br.sleep(200);
    check('Ctrl+Y rétablit le texte', (await nEls()) === n0 + 1, String(await nEls()));
    await br.ev(key('z')); await br.sleep(100); await br.ev(key('z', 'shiftKey: true,')); await br.sleep(200);
    check('Ctrl+Maj+Z rétablit aussi', (await nEls()) === n0 + 1);
    await br.ev(press('.tlb.el.t-text')); // l'annulation désélectionne un élément qui n'existait plus : on le sélectionne de nouveau
    await br.ev(setK('s', 180)); await br.sleep(600);
    await br.ev(setK('s', 90)); await br.sleep(600);
    await br.ev(key('z')); await br.sleep(200);
    check('annuler un réglage (échelle 90 → 180) : un Ctrl+Z revient à l’étape précédente', await br.ev("window.__video.tl.els[window.__video.tl.els.length - 1].s") === 180);
    await br.ev(key('z')); await br.sleep(200);
    check('et un second Ctrl+Z revient à l’échelle d’origine', await br.ev("window.__video.tl.els[window.__video.tl.els.length - 1].s") === 100);
    // plusieurs blocs de sous-titres, scission d'un bloc et d'une ligne
    const s0n = await br.ev("window.__video.tl.els.filter((e) => e.type === 'subs').length");
    await br.ev("(() => { document.getElementById('t_addsubs').click(); document.getElementById('t_addsubs').click(); return true; })()");
    await br.sleep(500);
    check('+ Sous-titres : chaque clic crée un nouveau bloc avec sa première ligne', await br.ev(`(() => { const s = window.__video.tl.els.filter((e) => e.type === 'subs'); return s.length === ${s0n + 2} && s.slice(-2).every((e) => e.cues.length === 1); })()`));
    const st = await br.ev(`window.__video.tl.els.filter((e) => e.type === 'subs')[${s0n}].start`);
    await br.ev(`(() => { const r = document.getElementById('tlruler'), b = r.getBoundingClientRect(), o = { bubbles: true, cancelable: true, pointerId: 6, clientX: b.left + (${st} + 1.5) * window.__video.zoom, clientY: b.top + 8 }; r.dispatchEvent(new PointerEvent('pointerdown', o)); r.dispatchEvent(new PointerEvent('pointerup', o)); return true; })()`);
    await br.sleep(400);
    await br.ev("(() => { document.querySelectorAll('.tlb.el.t-subs')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 5, clientX: document.querySelectorAll('.tlb.el.t-subs')[0].getBoundingClientRect().left + 40, clientY: document.querySelectorAll('.tlb.el.t-subs')[0].getBoundingClientRect().top + 8 })); document.getElementById('tlinner').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 5 })); return true; })()");
    await br.sleep(300);
    const tt = await br.ev("window.__video.t");
    await br.ev("(() => { document.getElementById('t_split').click(); return true; })()");
    await br.sleep(300);
    check('Scinder un bloc de sous-titres : deux blocs indépendants, leurs lignes réparties à la coupe', await br.ev(`(() => { const s = window.__video.tl.els.filter((e) => e.type === 'subs'); if (s.length !== ${s0n + 3}) return false; const a = s.find((e) => e.cues.length && Math.abs(e.cues[0].end - ${tt}) < 0.15), b = s.find((e) => e.cues.length && Math.abs(e.cues[0].start - ${tt}) < 0.15); return !!a && !!b && a.id !== b.id; })()`), await br.ev("JSON.stringify(window.__video.tl.els.filter((e) => e.type === 'subs').map((e) => [e.start, e.end, e.cues]))"));
    await br.ev(key('z')); await br.sleep(200);
    check('Ctrl+Z annule la scission', await br.ev("window.__video.tl.els.filter((e) => e.type === 'subs').length") === s0n + 2);
    await br.ev('window.__video.dirty = false');
    // pistes : vidéo superposée, changement de piste (boutons et glisser vertical), conversions piste principale <-> superposition
    const ordIds = () => br.ev("[...document.querySelectorAll('#vlayer .vel')].map((n) => n.dataset.id).join()");
    const noOverlap = () => br.ev("(() => { const S = window.__video; return S.tl.els.every((a, i) => S.tl.els.every((b, j) => i >= j || a.track !== b.track || (S.winOf(a)[0] >= S.winOf(b)[1] - 1e-6 || S.winOf(b)[0] >= S.winOf(a)[1] - 1e-6))); })()");
    await br.ev("(() => { document.getElementById('t_addvid').click(); return true; })()");
    check('+ Vidéo superposée : la fenêtre de choix liste les vidéos', await br.ev("!document.getElementById('vpick').hidden && document.querySelectorAll('#vpick-list .pk').length >= 1"));
    await br.ev("(() => { document.querySelector('#vpick-list .pk').click(); return true; })()");
    await br.sleep(1200);
    check('vidéo superposée : un bloc sur la piste la plus haute et un lecteur dans l’aperçu', await br.ev("(() => { const S = window.__video, v = S.tl.els.find((e) => e.type === 'video'); return !!v && v.track === Math.max(...S.tl.els.map((e) => e.track)) && !!document.querySelector('.tlb.t-video') && !!document.querySelector('#vlayer video.vel'); })()"));
    check('vidéo superposée : mêmes réglages que les autres éléments + volume + extrait', await br.ev("['x', 'y', 's', 'rot', 'op', 'vol', 'in', 'out'].every((k) => !!document.querySelector('#vprops [data-k=' + k + ']'))"));
    const z0 = (await ordIds()).split(','), vid0 = await br.ev("window.__video.tl.els.find((e) => e.type === 'video').id"), trk0 = await br.ev("window.__video.tl.els.find((e) => e.type === 'video').track");
    await br.ev("(() => { document.querySelector('#vprops [data-a=trkdn]').click(); return true; })()");
    const z1 = (await ordIds()).split(','), trk1 = await br.ev("window.__video.tl.els.find((e) => e.type === 'video').track");
    check('↓ Descendre d’une piste : la vidéo passe sous l’élément qui était juste en dessous (ordre d’empilement de l’aperçu)', trk1 === trk0 - 1 && z1.indexOf(vid0) < z0.indexOf(vid0) && (await noOverlap()), JSON.stringify([trk0, trk1, z0.indexOf(vid0), z1.indexOf(vid0)]));
    await br.ev("(() => { document.querySelector('#vprops [data-a=trkup]').click(); return true; })()");
    check('↑ Monter d’une piste : elle repasse au-dessus', await br.ev("window.__video.tl.els.find((e) => e.type === 'video').track") === trk0 && (await ordIds()).split(',').indexOf(vid0) === z0.indexOf(vid0));
    await br.ev(`(() => { const b = document.querySelector('.tlb.t-video'), r = b.getBoundingClientRect(), row = document.querySelector('#tltracks .tlrow[data-track="1"]').getBoundingClientRect(), o = { bubbles: true, cancelable: true, pointerId: 5, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, tl = document.getElementById('tlinner'); b.dispatchEvent(new PointerEvent('pointerdown', o)); tl.dispatchEvent(new PointerEvent('pointermove', { ...o, clientY: row.top + row.height / 2 })); tl.dispatchEvent(new PointerEvent('pointerup', { ...o, clientY: row.top + row.height / 2 })); return true; })()`);
    const trk2 = await br.ev("window.__video.tl.els.find((e) => e.type === 'video').track");
    check('glisser un bloc vers une autre piste le déplace (jamais deux éléments au même instant sur une même piste)', trk2 < trk0 && (await noOverlap()), JSON.stringify([trk0, trk2]));
    check('les pistes restent consécutives (1, 2, 3…) sans piste vide', await br.ev("(() => { const t = [...new Set(window.__video.tl.els.map((e) => e.track))].sort((a, b) => a - b); return t.every((v, i) => v === i + 1); })()"));
    const nClips0 = await br.ev("window.__video.tl.clips.length");
    await br.ev(press('.tlb.clip'));
    await br.ev("(() => { document.querySelector('#vprops [data-a=toover]').click(); return true; })()");
    check('Superposer : un clip de la piste principale devient une vidéo superposée (la piste principale se referme)', await br.ev("window.__video.tl.clips.length") === nClips0 - 1 && await br.ev("window.__video.tl.els.filter((e) => e.type === 'video').length") === 2);
    await br.ev("(() => { document.querySelector('#vprops [data-a=tomain]').click(); return true; })()");
    check('Mettre sur la piste principale : elle redevient un clip', await br.ev("window.__video.tl.clips.length") === nClips0 && await br.ev("window.__video.tl.els.filter((e) => e.type === 'video').length") === 1);
    await br.ev(key('z')); await br.sleep(200); await br.ev(key('z')); await br.sleep(200);
    check('Ctrl+Z annule aussi les changements de piste', await br.ev("window.__video.tl.clips.length") <= nClips0);
    await br.ev('window.__video.dirty = false');
    // ajout de plusieurs fichiers d'un coup (sélection multiple), puis glisser-déposer : sans choisir de type
    await br.go(U + '/edition/3/assets');
    await shot('bibliotheque-ajout');
    check('ajout de fichiers : sélection multiple, zone de dépôt, aucun choix de type', await br.ev("(() => { const i = document.getElementById('upfile'); return i.multiple && !!document.querySelector('form#up.dropbox') && !document.getElementById('uprole'); })()"));
    await br.ev("(() => { const f = document.getElementById('up'), dt = new DataTransfer(); dt.items.add(new File(['a'], 'multi-a.png', { type: 'image/png' })); dt.items.add(new File(['b'], 'multi-b.png', { type: 'image/png' })); document.getElementById('upfile').files = dt.files; f.requestSubmit(); return true; })()");
    await br.sleep(2500);
    check('plusieurs fichiers ajoutés en une fois', await br.ev("location.search.includes('m=') && /2 fichiers ajoutés/.test(document.body.innerText) && /multi-a\\.png/.test(document.body.innerText) && /multi-b\\.png/.test(document.body.innerText)"));
    await br.ev("(() => { const dt = new DataTransfer(); dt.items.add(new File(['c'], 'depose-c.png', { type: 'image/png' })); document.getElementById('up').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()");
    await br.sleep(2500);
    check('glisser-déposer : le fichier déposé est ajouté', await br.ev("/1 fichier ajouté/.test(document.body.innerText) && /depose-c\\.png/.test(document.body.innerText)"));
    // geste réel : choisir un fichier dans la page et l'envoyer (exécute le JavaScript des formulaires d'import)
    const pick = (sel, name, mime, text) => "(() => { const f = document.querySelector(" + JSON.stringify(sel) + "); const dt = new DataTransfer(); dt.items.add(new File([" + JSON.stringify(text) + "], " + JSON.stringify(name) + ", { type: " + JSON.stringify(mime) + " })); f.querySelector('input[type=file]').files = dt.files; f.requestSubmit(); return true; })()";
    await br.go(U + '/edition/3/variants/' + ids.w.v1 + '?step=materiel');
    await br.ev(pick('form.upm', 'affiche-navigateur.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#336"/></svg>'));
    await br.sleep(2500);
    check('envoi réel depuis le matériel (navigateur) : fichier utilisé, message affiché', await br.ev("location.search.includes('step=materiel') && document.body.innerText.includes('Affiche reçue')"));
    await br.go(U + '/edition/3/contents');
    await br.ev("(() => { const r = document.querySelector('form.upx input[value=doc]'); r.click(); return true; })()");
    check('sélecteur de point de départ : le mode « Document » change l’aide et le bouton', await br.ev("document.querySelector('form.upx .modefile button').textContent.includes('document') && !document.querySelector('form.upx .modefile').hidden && document.querySelector('form.upx .modetool').hidden"));
    await br.ev(pick('form.upx', 'concept-navigateur.txt', 'text/plain', 'Idée : la nuit tombe sur le temple.'));
    await br.sleep(4500);
    for (let k = 0; k < 20 && !(await br.ev("document.readyState === 'complete' && location.pathname.endsWith('/contents')")); k++) await br.sleep(500);
    { const rr = await A.get('/edition/3/contents'); const tx = await rr.text(); check('la page des contenus répond après l’import', rr.status === 200 && tx.includes('concept-navigateur'), rr.status + ' ' + tx.replace(/<[^>]+>/g, ' ').replace(/s+/g, ' ').slice(0, 200)); }
    check('envoi réel d’un document (navigateur) : contenu texte créé', await br.ev("location.pathname.endsWith('/contents') && document.body.innerText.includes('Document importé')"));
    check('aucune erreur dans la console du navigateur', br.problems.length === 0, br.problems.slice(0, 3).join(' | '));
  } finally { br.close(); }
  const mb = await openBrowser({ profileDir: join(TMP, 'profil-mobile'), port: 9341, width: 420, height: 900 });
  try {
    await mb.cookie('sid', A.ck.split('=')[1], U);
    for (const [p, n] of [['/edition/1', 'm-accueil'], ['/edition/1/variants', 'm-contenus'], ['/edition/1/assets', 'm-bibliotheque'], ['/edition/3/variants/new', 'm-creer'], ['/edition/1/campaigns', 'm-campagnes'], [`/edition/1/campaigns/${ids.c}/guide`, 'm-guide-meta'], [`/edition/1/campaigns/${ids.c}`, 'm-campagne-detail'], [`/edition/3/variants/${ids.w.v1}?step=materiel`, 'm-ws-materiel'], [`/edition/3/variants/${ids.w.v1}?step=creation`, 'm-ws-creation'], [`/edition/3/variants/${ids.w.v1}`, 'm-ws-verification'], [`/edition/3/poster/1x1?variant=${ids.w.v1}`, 'm-ws-editeur'], [`/edition/3/texts/${ids.w.tid}?step=creation`, 'm-ws-texte']]) {
      await mb.go(U + p);
      check(`largeur téléphone : ${n} sans défilement horizontal`, await mb.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'), String(await mb.ev("[...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 4).map((e) => e.tagName + '.' + e.className + '#' + (e.id || e.name || '') + ' ' + Math.round(e.getBoundingClientRect().right)).join(' | ')")));
      check(`largeur téléphone : ${n} navigation entièrement visible`, await mb.ev("[...document.querySelectorAll('.pnav-main a')].every((a) => a.getBoundingClientRect().right <= window.innerWidth + 1)"));
      if (shots) await mb.shot(join(shots, n + '.png'));
    }
    check('largeur téléphone : aucune erreur console', mb.problems.length === 0, mb.problems.slice(0, 3).join(' | '));
  } finally { mb.close(); }
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
