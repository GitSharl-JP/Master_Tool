import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import * as db from './db.js';
import { setSecret, clearSecret, SECRET_DEFS, PROJECT_DEFS } from './secrets.js';
import { fieldKeys, SECTIONS, VALIDATION } from './schema.js';
import { createReadStream, createWriteStream, statSync, existsSync, unlinkSync } from 'node:fs';
import { extname } from 'node:path';
import * as studio from './studio.js';
import { storage } from './storage.js';
import * as video from './video.js';
import * as designexport from './designexport.js';
import * as library from './library.js';
import * as variants from './variants.js';
import * as intake from './intake.js';
import * as projects from './projects.js';
import * as metaimport from './metaimport.js';
import * as plan from './plan.js';
import * as backup from './backup.js';
import * as todo from './todo.js';
import * as siteMod from './site.js';
import { contentNewPage, textPage, projectHomePage, variantsPage, variantNewPage, variantPage, calendarPage, todoCard, sitePage, contentsPage, campaignsPage, campaignPage, metaGuidePage, transitionPage, backupCard } from './views_flow.js';
import * as campaigns from './campaigns.js';
import { probe, ffmpegReady, toSrt } from './media.js';
import { renderPoster, renderImportedPoster, renderSite, SITE_PAGES, FIT_CSP } from './render.js';
import { publishBlockers } from './schema.js';
import { deleteProjectPage, layout, assetsPage, posterPage, videoPage, designsPage, applyDesignPage, loginPage, setupPage, homePage, editionPage, settingsPage } from './views.js';

const POSTER_OK = 'Affiche reçue importée pour tous les formats. Vérifiez le cadrage de chacun.';
const DOC_OK = 'Document importé : le texte est dans la bibliothèque de contenus.';
const DOC_UNREAD = 'Contenu créé : le texte n’a pas pu être lu automatiquement, le fichier d’origine est joint.';
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // local uniquement ; passer HOST=0.0.0.0 lors d'une migration serveur
let lastBackup = '';

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
// multi : champs répétés (cases à cocher de même nom) rendus en tableau
const readBody = (req, { multi = [] } = {}) => new Promise((res) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { const p = new URLSearchParams(b), o = Object.fromEntries(p); for (const k of multi) o[k] = p.getAll(k); res(o); });
});
const sendJson = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const STALE_MSG = 'Ce travail a été modifié ailleurs (autre onglet ou autre personne) depuis que vous l’avez ouvert : rien n’a été écrasé. Rechargez la page pour voir la version enregistrée.';
// Contrôle de révision d'un enregistrement : 'done' = réponse déjà envoyée (vérification seule, ou conflit signalé à la page) ; 'stale' = formulaire classique périmé ; null = on peut enregistrer.
function revisionGate(req, res, b, cur) {
  const ajax = req.headers['x-requested-with'] === 'fetch', stale = b.rev !== undefined && String(b.rev) !== cur;
  if (stale) { if (ajax) { sendJson(res, 200, { ok: false, conflict: true, rev: cur }); return 'done'; } return 'stale'; }
  if (ajax && req.headers['x-check']) { sendJson(res, 200, { ok: true, rev: cur }); return 'done'; }
  return null;
}
const send = (res, status, html, headers = {}) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:", ...headers }); res.end(html); };
const redirect = (res, to, headers = {}) => { res.writeHead(303, { Location: to, ...headers }); res.end(); };
// Nom de fichier lisible au téléchargement : « projet-contenu-4x5-v1-BROUILLON.png » (le fichier stocké garde son nom technique).
const slug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40);
function downloadName(e) {
  const ext = (e.file.match(/\.\w+$/) || ['.png'])[0];
  if (ext === '.zip') return e.file;
  const v = e.variant_id ? variants.getVariant(e.variant_id) : null, ed = db.getEdition(e.edition_id);
  return [slug(ed?.label), slug(v?.name), e.fmt, e.variant_version ? 'v' + e.variant_version : 'essai', e.draft ? 'BROUILLON' : ''].filter(Boolean).join('-') + ext;
}
const setCookie = (t, max) => ({ 'Set-Cookie': `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${max}` });

function fieldsBySection() {
  const out = {};
  for (const f of fieldKeys()) (out[f.section] ||= []).push(f);
  return out;
}

// Envoi d'un fichier avec lecture partielle (Range) : nécessaire pour avancer dans une vidéo.
function serve(req, res, size, headers, open) {
  const h = { 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', ...headers };
  const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (rg && (rg[1] || rg[2])) {
    const start = rg[1] ? Number(rg[1]) : Math.max(0, size - Number(rg[2]));
    const end = rg[1] && rg[2] ? Math.min(Number(rg[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return open({ start, end }).pipe(res);
  }
  res.writeHead(200, { ...h, 'Content-Length': size });
  return open().pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (path === '/brand/logo.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' }); return res.end(readFileSync(new URL('../public/brand/logo.png', import.meta.url))); }
    if (path === '/brand/icon.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' }); return res.end(readFileSync(new URL('../public/brand/icon.png', import.meta.url))); }
    // Santé du serveur, pour le lanceur Atelier.exe : démarré ? des exports vidéo en cours ? (aucune donnée du projet)
    if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ ok: true, busy: db.db.prepare("SELECT COUNT(*) c FROM jobs WHERE status IN ('queued','running')").get().c })); }
    if (path === '/video.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(readFileSync(new URL('../public/video.js', import.meta.url))); }
    if (path === '/poster-editor.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(readFileSync(new URL('../public/poster-editor.js', import.meta.url))); }
    if (path === '/app.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(readFileSync(new URL('../public/app.js', import.meta.url))); }
    if (path === '/style.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(readFileSync(new URL('../public/style.css', import.meta.url))); }

    // Protection CSRF : un POST doit venir de notre propre origine.
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, 'Origine refusée');
    }

    const sid = cookies(req).sid;
    const user = db.sessionUser(sid);
    const page = (title, body, flash) => send(res, 200, layout(title, body, user, flash));

    if (db.userCount() === 0) {
      if (path === '/setup' && req.method === 'POST') {
        const b = await readBody(req);
        if (!b.name?.trim() || (b.password || '').length < 10) return send(res, 400, layout('Première utilisation', setupPage('Prénom requis et mot de passe de 10 caractères minimum.')));
        db.createUser(b.name.trim(), b.password);
        const u = db.checkLogin(b.name.trim(), b.password); // connecté tout de suite : pas de seconde saisie du mot de passe
        return redirect(res, '/', u ? setCookie(db.newSession(u.id), 7 * 86400) : undefined);
      }
      return send(res, 200, layout('Première utilisation', setupPage()));
    }

    if (path === '/login' && req.method === 'POST') {
      const b = await readBody(req);
      const u = db.checkLogin((b.name || '').trim(), b.password || '');
      if (!u) return send(res, 401, layout('Connexion', loginPage('Nom ou mot de passe incorrect.')));
      return redirect(res, '/', setCookie(db.newSession(u.id), 7 * 86400));
    }
    if (!user) return send(res, 200, layout('Connexion', loginPage()));
    if (path === '/logout' && req.method === 'POST') { db.endSession(sid); return redirect(res, '/', setCookie('', 0)); }

    if (path === '/' && req.method === 'GET') return page('Projets', homePage(db.listEditions(), db.recentActivity()), url.searchParams.get('m'));

    if (path === '/edition/new' && req.method === 'POST') {
      const b = await readBody(req);
      return redirect(res, `/edition/${db.createEdition(b.label.trim(), user.name)}`);
    }

    if (path === '/edition/test' && req.method === 'POST') return redirect(res, `/edition/${projects.createTestEdition(user.name)}?m=${encodeURIComponent('Projet d’essai créé : fiche d’exemple provisoire. Vous pouvez tout tester, puis le supprimer.')}`);
    {
      const pm = path.match(/^\/edition\/(\d+)\/(rename|archive|unarchive|delete)$/);
      const ped = pm && db.getEdition(Number(pm[1]));
      if (pm && !ped) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      if (pm && req.method === 'GET' && pm[2] === 'delete') return page('Supprimer le projet', deleteProjectPage(ped, projects.projectCounts(ped.id)), url.searchParams.get('m'));
      if (pm && req.method === 'POST') {
        const b = await readBody(req), home = (m) => redirect(res, `/?m=${encodeURIComponent(m)}`);
        if (pm[2] === 'rename') { const o = projects.renameEdition(ped.id, b.label, user.name); return redirect(res, `${b.from === 'home' ? '/' : '/edition/' + ped.id + '/settings'}?m=${encodeURIComponent(o.ok ? 'Projet renommé.' : o.error)}`); }
        if (pm[2] === 'archive') { projects.setArchived(ped.id, true, user.name); return home(`« ${ped.label} » est archivé (masqué de la liste, rien n’est supprimé). Retrouvez-le en bas de page.`); }
        if (pm[2] === 'unarchive') { projects.setArchived(ped.id, false, user.name); return home(`« ${ped.label} » est de retour dans la liste.`); }
        const o = projects.deleteEdition(ped.id, b.confirm, user.name);
        return o.ok ? home(`Projet « ${o.label} » supprimé.`) : redirect(res, `/edition/${ped.id}/delete?m=${encodeURIComponent(o.error)}`);
      }
    }

    // ---------- assets, affiches, site (aperçu)
    const RENDER_CSP = { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:" };
    const msgOf = () => url.searchParams.get('m');
    let r;
    if ((r = path.match(/^\/edition\/(\d+)\/assets$/)) && req.method === 'GET') {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const sp = url.searchParams;
      return page('Assets', assetsPage(ed, studio.listAssets(ed.id).map((a) => ({ ...a, warn: intake.imageWarnings(a)[0] || '' })), msgOf(), `${storage.driver} — ${storage.location}`, { q: (sp.get('q') || '').trim(), kind: sp.get('kind') || '', status: sp.get('status') || '' }, studio.listExports(ed.id)));
    }
    if (path === '/assets/upload' && req.method === 'POST') {
      const ed = db.getEdition(Number(url.searchParams.get('edition')));
      const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (!ed) return json(404, { error: 'Projet introuvable' });
      try {
        const id = await studio.saveUpload(req, { editionId: ed.id, name: url.searchParams.get('name') || 'fichier', role: url.searchParams.get('role'), who: user.name });
        const vId = Number(url.searchParams.get('variant')), tId = Number(url.searchParams.get('text')), what = url.searchParams.get('what');
        if (vId && what && variants.getVariant(vId)?.project_id === ed.id) { // matériel d'un contenu affiche / vidéo
          // « add » : le fichier rejoint la bibliothèque ; sa destination (photo, logo, affiche) se choisit ensuite. Une vidéo n'a qu'un usage : elle devient la source.
          const isVideo = what === 'add' && studio.getAsset(id)?.kind === 'video' && variants.getVariant(vId).with_video;
          const key = isVideo ? 'video_asset' : { hero: 'hero', logo: 'logo', poster: 'poster', video: 'video_asset' }[what];
          const o = key ? variants.applyMaterial(vId, { [key]: String(id) }, user.name) : { ok: true, msg: 'Fichier ajouté : choisissez ci-dessous où l’utiliser (photo de fond, logo, affiche reçue).' };
          const warn = intake.imageWarnings(studio.getAsset(id))[0];
          return json(200, { id, url: `/edition/${ed.id}/variants/${vId}?step=materiel&m=${encodeURIComponent((o.ok ? o.msg : o.error) + (warn ? ' ' + warn : ''))}` });
        }
        if (tId && what === 'doc') { // document importé dans un contenu texte
          const o = intake.importIntoContent(ed.id, tId, id, user.name);
          return json(200, { id, url: `/edition/${ed.id}/texts/${tId}?step=creation&m=${encodeURIComponent(o.ok ? (o.read ? 'Texte importé à la suite : relisez-le.' : 'Fichier joint ; son texte n’a pas pu être lu automatiquement.') : o.error)}` });
        }
        const use = url.searchParams.get('use');
        if (use === 'poster') { // « Partir d'une affiche reçue » : le fichier devient l'affiche de tous les formats
          const o = intake.usePoster(ed.id, id, user.name);
          return json(200, { id, url: `/edition/${ed.id}/poster/4x5?m=${encodeURIComponent(o.ok ? POSTER_OK : o.error)}` });
        }
        if (use === 'content') { // « Partir d'un document » : le fichier devient un contenu texte
          const o = intake.contentFromAsset(ed.id, id, user.name);
          return json(200, { id, url: `/edition/${ed.id}/contents?m=${encodeURIComponent(o.ok ? (o.read ? DOC_OK : DOC_UNREAD) : o.error)}` });
        }
        return json(200, { id, warning: intake.imageWarnings(studio.getAsset(id))[0] || '' });
      } catch (e) { return json(400, { error: e.message }); }
    }
    if ((r = path.match(/^\/assets\/(\d+)\/(use-poster|to-content)$/)) && req.method === 'POST') {
      const a = studio.getAsset(Number(r[1]));
      if (!a) return send(res, 404, 'Introuvable');
      const to = (m, p = 'assets') => redirect(res, `/edition/${a.edition_id}/${p}?m=${encodeURIComponent(m)}`);
      if (r[2] === 'use-poster') { const o = intake.usePoster(a.edition_id, a.id, user.name); return o.ok ? to(POSTER_OK, 'poster/4x5') : to(o.error); }
      const o = intake.contentFromAsset(a.edition_id, a.id, user.name);
      return o.ok ? to(o.read ? DOC_OK : DOC_UNREAD, 'contents') : to(o.error);
    }
    if ((r = path.match(/^\/edition\/(\d+)\/poster-import$/)) && req.method === 'POST') {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, 'Introuvable');
      const b = await readBody(req), to = (m) => redirect(res, `/edition/${ed.id}/poster/4x5?m=${encodeURIComponent(m)}`);
      if (b.remove) { const n = intake.removePoster(ed.id, user.name); return to(n ? 'Retour aux affiches composées par l’atelier.' : 'Aucune affiche reçue à retirer.'); }
      const o = intake.usePoster(ed.id, Number(b.asset), user.name);
      return to(o.ok ? POSTER_OK : o.error);
    }
    if ((r = path.match(/^\/assets\/(\d+)\/update$/)) && req.method === 'POST') {
      const a = studio.getAsset(Number(r[1]));
      if (!a) return send(res, 404, 'Introuvable');
      const b = await readBody(req);
      studio.updateAsset(a.id, { role: b.role, provisional: b.provisional === '1', rights: b.rights, status: b.status, label: b.label }, user.name);
      return redirect(res, `/edition/${a.edition_id}/assets?m=${encodeURIComponent('Enregistré.')}`);
    }
    if ((r = path.match(/^\/files\/(\d+)$/))) {
      const a = studio.getAsset(Number(r[1]));
      if (!a || !storage.exists(a.stored)) return send(res, 404, 'Introuvable');
      const ext = extname(a.stored).toLowerCase();
      return serve(req, res, storage.size(a.stored), { 'Content-Type': studio.MIME[ext] || 'application/octet-stream', 'Content-Security-Policy': 'sandbox' }, (o) => storage.read(a.stored, o));
    }
    if ((r = path.match(/^\/exports\/(\d+)$/))) {
      const e = studio.getExport(Number(r[1]));
      if (!e || !existsSync(studio.exportPath(e))) return send(res, 404, 'Introuvable');
      const type = e.file.endsWith('.zip') ? 'application/zip' : e.file.endsWith('.mp4') ? 'video/mp4' : 'image/png';
      const download = url.searchParams.get('dl') || type === 'application/zip';
      return serve(req, res, statSync(studio.exportPath(e)).size, { 'Content-Type': type, ...(download ? { 'Content-Disposition': `attachment; filename="${downloadName(e)}"` } : {}) }, (o) => createReadStream(studio.exportPath(e), o));
    }
    if ((r = path.match(/^\/edition\/(\d+)\/pack$/)) && req.method === 'POST') {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, 'Introuvable');
      const b = await readBody(req);
      const out = studio.exportPack(ed, Object.keys(b).filter((k) => k.startsWith('ch_')).map((k) => k.slice(3)), user.name, null);
      return redirect(res, `/edition/${ed.id}/poster/4x5?m=${encodeURIComponent(out.ok ? `Pack créé (${out.count} formats)${out.draft ? ', marqué BROUILLON (fiche non prête).' : '.'}` : out.error)}`);
    }
    if ((r = path.match(/^\/edition\/(\d+)\/poster\/([a-z0-9]+)(?:\/(save|export|sync|svg|pdf))?$/))) {
      const ed = db.getEdition(Number(r[1])), fmt = r[2];
      if (!ed || !studio.POSTER_FORMATS[fmt]) return send(res, 404, layout('Introuvable', '<h1>Projet ou format introuvable</h1>', user));
      let blockers = [];
      const vid = Number(url.searchParams.get('variant')) || 0, variant = vid ? variants.getVariant(vid) : null;
      if (vid && (!variant || variant.project_id !== ed.id)) return send(res, 404, layout('Introuvable', '<h1>Contenu introuvable</h1>', user));
      const dkey = vid ? `v${vid}_${fmt}` : `poster_${fmt}`, pq = vid ? `variant=${vid}&` : '';
      blockers = studio.posterBlockers(ed, [[fmt, studio.getDesign(ed.id, dkey)]]);
      const asrc = vid && url.searchParams.get('approved') === '1' ? variants.approvedSource(vid) : null; // fichiers éditables de la version APPROUVÉE
      if (vid && url.searchParams.get('approved') === '1' && (!asrc || !asrc.designs[fmt])) return send(res, 404, layout('Introuvable', '<h1>Aucune version approuvée pour ce format</h1><p>Approuvez le contenu avant de produire des fichiers éditables.</p>', user));
      const builder = asrc ? (fl) => studio.buildPosterHtml(asrc.ed, fmt, [], { noDraft: true, design: asrc.designs[fmt], ...fl }) : vid ? (fl) => studio.buildPosterHtml(ed, fmt, [], { noDraft: true, designKey: dkey, ...fl }) : undefined;
      if (req.method === 'GET' && (r[3] === 'svg' || r[3] === 'pdf')) { // exports éditables pour Illustrator
        const base = [slug(ed.label), variant && slug(variant.name), fmt, asrc ? 'v' + asrc.version : 'essai'].filter(Boolean).join('-');
        const cur = asrc ? asrc.designs[fmt] : studio.getDesign(ed.id, dkey), orig = cur.ext ? studio.getAsset(Number(cur.ext)) : null;
        if (r[3] === 'svg' && orig) { // affiche reçue : il n'y a rien à recomposer, on rend le fichier d'origine
          if (!/\.svg$/i.test(orig.stored)) return send(res, 400, layout('Erreur', '<h1>Pas de SVG pour cette affiche</h1><p>L’affiche reçue est une image (PNG/JPG) : téléchargez-la depuis l’onglet Assets.</p>', user));
          res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${orig.name}"` });
          return res.end(readFileSync(studio.assetPath(orig)));
        }
        if (r[3] === 'svg') {
          const o = await designexport.posterSvg(ed, fmt, builder);
          if (!o.ok) return send(res, 500, layout('Erreur', `<h1>Export SVG impossible</h1><p>${o.error}</p>`, user));
          res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.svg"` });
          return res.end(o.svg);
        }
        const tmp = studio.EXPORT_PATH + `tmp-${Date.now()}.pdf`;
        if (!(await designexport.posterPdf(ed, fmt, tmp, builder))) return send(res, 500, layout('Erreur', '<h1>Export PDF impossible</h1>', user));
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${base}.pdf"` });
        const buf = readFileSync(tmp); unlinkSync(tmp);
        return res.end(buf);
      }
      if (req.method === 'GET' && !r[3]) return page('Affiches', posterPage(ed, fmt, studio.getDesign(ed.id, dkey), studio.listAssets(ed.id), studio.listExports(ed.id).filter((e) => (vid ? e.variant_id === vid : !e.variant_id)), msgOf(), blockers.length, studio.listDesignHistory(ed.id, dkey), variant, { ws: vid ? variants.workspaceInfo(vid) : undefined, warnings: intake.posterWarnings(studio.getAsset(Number(studio.getDesign(ed.id, dkey).ext))), rev: studio.designRev(ed.id, dkey) }));
      if (req.method === 'POST') {
        const pbody = await readBody(req), gate = revisionGate(req, res, pbody, studio.designRev(ed.id, dkey));
        if (gate === 'done') return;
        if (gate === 'stale') return redirect(res, `/edition/${ed.id}/poster/${fmt}?${pq}m=${encodeURIComponent(STALE_MSG)}`);
        studio.saveDesign(ed.id, dkey, pbody, user.name);
        if (req.headers['x-requested-with'] === 'fetch') return sendJson(res, 200, { ok: true, rev: studio.designRev(ed.id, dkey) });
        blockers = studio.posterBlockers(ed, [[fmt, studio.getDesign(ed.id, dkey)]]);
        if (r[3] === 'sync') {
          const keys = (variant ? variant.formats : Object.keys(studio.POSTER_FORMATS)).map((f) => (vid ? `v${vid}_${f}` : `poster_${f}`));
          const n = studio.applyToOtherFormats(ed.id, dkey, keys, user.name, { positions: url.searchParams.get('positions') === '1' });
          return redirect(res, `/edition/${ed.id}/poster/${fmt}?${pq}m=${encodeURIComponent(n ? `Réglages reportés sur ${n} autre(s) format(s) : photo, logo, style, dégradé, polices, couleurs et textes. ${url.searchParams.get('positions') === '1' ? 'Positions et tailles reportées en proportion : vérifiez chaque aperçu.' : 'Positions et tailles propres à chaque format conservées.'}` : 'Aucun autre format à mettre à jour.')}`);
        }
        if (r[3] === 'export') {
          const out = studio.exportPoster(ed, fmt, user.name, blockers, { designKey: dkey, variantId: vid || undefined });
          return redirect(res, `/edition/${ed.id}/poster/${fmt}?${pq}m=${encodeURIComponent(out.ok ? (out.draft ? 'Image exportée, marquée BROUILLON (fiche non prête).' : 'Image exportée.') : out.error)}`);
        }
        return redirect(res, `/edition/${ed.id}/poster/${fmt}?${pq}m=${encodeURIComponent('Réglages enregistrés.')}`);
      }
    }
    if ((r = path.match(/^\/render\/poster\/(\d+)\/([a-z0-9]+)$/)) && req.method === 'GET') {
      const ed = db.getEdition(Number(r[1]));
      if (!ed || !studio.POSTER_FORMATS[r[2]]) return send(res, 404, 'Introuvable');
      const pv = Number(url.searchParams.get('variant')) || 0;
      const g = studio.saveDesignPreview(ed.id, pv ? `v${pv}_${r[2]}` : `poster_${r[2]}`, Object.fromEntries(url.searchParams));
      const asset = (id) => { const a = id ? studio.getAsset(Number(id)) : null; return a && a.edition_id === ed.id ? `/files/${a.id}` : null; };
      if (g.ext) return send(res, 200, renderImportedPoster(r[2], g, { src: asset(g.ext), draft: studio.posterBlockers(ed, [[r[2], g]]).length > 0 || studio.getAsset(Number(g.ext))?.provisional === 1, edit: url.searchParams.get('edit') === '1' }), { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'self'" });
      return send(res, 200, renderPoster(ed, r[2], g, { heroSrc: asset(g.hero), logoSrc: asset(g.logo), partnerSrcs: g.partners === '1' ? studio.assetsByRole(ed.id, 'partner').filter((a) => a.kind === 'image').reverse().map((a) => `/files/${a.id}`) : [], draft: studio.posterBlockers(ed, [[r[2], g]]).length > 0, edit: url.searchParams.get('edit') === '1' }), { 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self' ${FIT_CSP}` });
    }
    if ((r = path.match(/^\/site\/(\d+)(?:\/([a-z]*))?$/)) && req.method === 'GET') {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, 'Introuvable');
      const pg = r[2] || 'home';
      if (!SITE_PAGES.some(([k]) => k === pg)) return send(res, 404, 'Page introuvable');
      return send(res, 200, renderSite(ed, pg, { assets: studio.listAssets(ed.id), base: `/site/${ed.id}`, draftReasons: publishBlockers(ed) }), { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:" });
    }

    // ---------- vidéo
    if ((r = path.match(/^\/api\/video-info\/(\d+)$/)) && req.method === 'GET') { // durée et propriétés d'une vidéo de la bibliothèque (ajout d'un clip à la timeline)
      const info = video.clipInfo(Number(r[1]));
      res.writeHead(info ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(info || { error: 'Vidéo illisible ou introuvable.' }));
    }
    if ((r = path.match(/^\/api\/jobs\/(\d+)$/)) && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(video.listJobs(Number(r[1]))));
    }
    if ((r = path.match(/^\/edition\/(\d+)\/video(?:\/(save|export|subs-import|subs\.srt))?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const vid = Number(url.searchParams.get('variant')) || 0, variant = vid ? variants.getVariant(vid) : null, scope = vid ? `v${vid}` : '';
      if (vid && (!variant || variant.project_id !== ed.id)) return send(res, 404, layout('Introuvable', '<h1>Contenu introuvable</h1>', user));
      const sub = r[2], back = (m) => redirect(res, `/edition/${ed.id}/video?${vid ? 'variant=' + vid + '&' : ''}m=${encodeURIComponent(m)}`);
      if (req.method === 'GET' && sub === 'subs.srt') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="sous-titres.srt"' });
        return res.end(toSrt(video.getCues(ed.id, scope).cues));
      }
      if (req.method === 'GET' && !sub) {
        const m = video.getTlModel(ed.id, scope), design = m.design;
        const provisional = m.tl.clips.some((c) => studio.getAsset(Number(c.asset))?.provisional === 1);
        return page('Vidéos', videoPage(ed, { ws: vid ? variants.workspaceInfo(vid) : undefined, variant, design, tl: m.tl, cues: m.cues, infos: video.clipInfos(m.tl), assets: studio.listAssets(ed.id), rev: video.videoRev(ed.id, scope), ready: ffmpegReady(), draft: (design.endcard?.on && studio.posterBlockers(ed, [['9x16', studio.getDesign(ed.id, scope ? `${scope}_9x16` : 'poster_9x16')]]).length > 0) || provisional }), msgOf());
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (sub === 'subs-import') { const o = video.importCues(ed.id, b.asset, user.name, scope); return back(o.ok ? `${o.count} sous-titres importés.` : o.error); }
        if (sub !== 'export' || b.design) {
          const gate = revisionGate(req, res, b, video.videoRev(ed.id, scope));
          if (gate === 'done') return;
          if (gate === 'stale') return back(STALE_MSG);
        }
        if (b.design) video.saveVideoDesign(ed.id, b.design, scope, user.name);
        if (b.cues !== undefined) video.saveCues(ed.id, b.cues, user.name, undefined, scope);
        if (sub === 'export') {
          const o = video.planExports(db.getEdition(ed.id), user.name, { scope });
          return back(o.ok ? 'Exports : ' + o.out.map(([f, s]) => `${studio.POSTER_FORMATS[f].ratio} ${s}`).join(' · ') : o.error);
        }
        if (req.headers['x-requested-with'] === 'fetch') return sendJson(res, 200, { ok: true, rev: video.videoRev(ed.id, scope) });
        return back('Réglages enregistrés.');
      }
    }
    // ---------- bibliothèque de designs
    if ((r = path.match(/^\/library\/thumb\/(\d+)$/)) && req.method === 'GET') {
      const v = library.getVersion(Number(r[1]));
      if (!v || !v.thumb || !storage.exists(v.thumb)) return send(res, 404, 'Introuvable');
      return serve(req, res, storage.size(v.thumb), { 'Content-Type': 'image/png' }, (o) => storage.read(v.thumb, o));
    }
    if ((r = path.match(/^\/library\/asset\/(\d+)\/(\d+)$/)) && req.method === 'GET') {
      const a = library.getVersion(Number(r[1]))?.snapshot.assets[r[2]];
      if (!a || !storage.exists(a.key)) return send(res, 404, 'Introuvable');
      return serve(req, res, storage.size(a.key), { 'Content-Type': studio.MIME[extname(a.key).toLowerCase()] || 'application/octet-stream', 'Content-Security-Policy': 'sandbox' }, (o) => storage.read(a.key, o));
    }
    if (path === '/library/import' && req.method === 'POST') {
      const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const tmp = studio.EXPORT_PATH + `upload-${Date.now()}.zip`;
      await new Promise((ok, ko) => { const w = createWriteStream(tmp); req.pipe(w); w.on('finish', ok); w.on('error', ko); });
      const out = library.importBundle(tmp, Number(url.searchParams.get('project')) || null, user.name);
      try { unlinkSync(tmp); } catch { /* déjà supprimé */ }
      return json(out.ok ? 200 : 400, out);
    }
    if ((r = path.match(/^\/edition\/(\d+)\/designs(?:\/(save|save-kit|apply|duplicate|bundle)(?:\/(\d+))?)?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const back = (m) => redirect(res, `/edition/${ed.id}/designs?m=${encodeURIComponent(m)}`);
      if (req.method === 'GET' && !r[2]) {
        const templates = library.listTemplates();
        return page('Designs', designsPage(ed, { brands: Object.fromEntries(templates.filter((t) => t.kind === 'kit').map((t) => [t.id, library.getVersion(library.listVersions(t.id)[0].id)?.snapshot.brand || {}])), templates, versions: Object.fromEntries(templates.map((t) => [t.id, library.listVersions(t.id)])), applications: library.listApplications(ed.id), bundles: studio.listExports(ed.id).filter((e) => e.kind === 'bundle'), msg: msgOf() }));
      }
      if (req.method === 'GET' && r[2] === 'apply') {
        const v = library.getVersion(Number(r[3]));
        if (!v) return send(res, 404, layout('Introuvable', '<h1>Version introuvable</h1>', user));
        return page('Appliquer un design', applyDesignPage(ed, library.getTemplate(v.template_id), v, studio.listAssets(ed.id)));
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (r[2] === 'save-kit') { const o = await library.saveKit(ed, { templateId: b.templateId, name: b.name, note: b.note }, user.name); return back(o.ok ? `Kit graphique enregistré (version ${o.version}).` : o.error); }
        if (r[2] === 'save') { const o = await library.saveToLibrary(ed, { templateId: b.templateId, name: b.name, note: b.note }, user.name); return back(o.ok ? `Design enregistré (version ${o.version}).` : o.error); }
        if (r[2] === 'duplicate') { const o = library.duplicateTemplate(Number(r[3]), b.name, user.name); return back(o.ok ? 'Design dupliqué : vous pouvez maintenant le modifier indépendamment.' : o.error); }
        if (r[2] === 'bundle') { const o = await library.exportBundle(Number(r[3]), ed.id, user.name); return back(o.ok ? 'Archive créée : voir « Archives » ci-dessous.' : o.error); }
        if (r[2] === 'apply') {
          const map = Object.fromEntries(Object.entries(b).filter(([k]) => k.startsWith('map_')).map(([k, v2]) => [k.slice(4), v2]));
          const o = library.applyVersion(ed.id, Number(r[3]), { map, brand: b.brand === '1', texts: b.texts === '1', video: b.video === '1' }, user.name);
          return o.ok ? redirect(res, `/edition/${ed.id}/poster/4x5?m=${encodeURIComponent('Design appliqué. Vérifiez chaque format : l’historique permet de revenir en arrière.')}`) : back(o.error);
        }
      }
    }
    if ((r = path.match(/^\/edition\/(\d+)\/poster\/([a-z0-9]+)\/restore\/(\d+)$/)) && req.method === 'POST') {
      const ed = db.getEdition(Number(r[1]));
      if (!ed || !studio.POSTER_FORMATS[r[2]]) return send(res, 404, 'Introuvable');
      const rv = Number(url.searchParams.get('variant')) || 0;
      studio.restoreDesign(ed.id, rv ? `v${rv}_${r[2]}` : `poster_${r[2]}`, Number(r[3]), user.name);
      return redirect(res, `/edition/${ed.id}/poster/${r[2]}?${rv ? 'variant=' + rv + '&' : ''}m=${encodeURIComponent('Version précédente restaurée.')}`);
    }

    // ---------- contenus
    if ((r = path.match(/^\/edition\/(\d+)\/contents(?:\/(new|(\d+)\/(update|version)))?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const back = (m) => redirect(res, `/edition/${ed.id}/contents?m=${encodeURIComponent(m)}`);
      if (req.method === 'GET' && !r[2]) {
        variants.syncProject(ed.id, user.name);
        const contents = campaigns.listContents(ed.id);
        return page('Contenus', contentsPage(ed, { contents, exports: studio.listExports(ed.id), linksBy: Object.fromEntries(contents.map((x) => [x.id, campaigns.linksOfContent(x.id)])) }), msgOf());
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (r[2] === 'new') { const o = campaigns.createContent(ed.id, b, user.name); return back(o.ok ? 'Contenu ajouté.' : o.error); }
        const cont = campaigns.getContent(Number(r[3]));
        if (!cont || cont.project_id !== ed.id) return send(res, 404, 'Introuvable');
        if (r[4] === 'update') { campaigns.updateContent(cont.id, b, user.name); return back('Contenu enregistré.'); }
        if (r[4] === 'version') return back(campaigns.setContentExport(cont.id, b.export_id, user.name) ? 'Nouvelle version enregistrée : les associations existantes gardent leur ancienne version.' : 'Choisissez un export de ce projet.');
      }
    }

    // ---------- associations contenu ↔ campagne (avec récapitulatif avant transmission / publication)
    if ((r = path.match(/^\/edition\/(\d+)\/links\/(\d+)(?:\/(confirm))?$/))) {
      const ed = db.getEdition(Number(r[1])), link = campaigns.getLink(Number(r[2]));
      if (!ed || !link) return send(res, 404, 'Introuvable');
      const cid = campaigns.campaignIdOfLink(link);
      const toCampaign = (m) => redirect(res, `/edition/${ed.id}/campaigns/${cid || ''}?m=${encodeURIComponent(m)}`);
      if (req.method === 'GET' && r[3] === 'confirm') {
        const rec = campaigns.transitionRecap(link.id, url.searchParams.get('to'));
        if (!rec) return send(res, 404, 'Introuvable');
        return page('Confirmer', transitionPage(ed, rec, cid));
      }
      if (req.method === 'POST' && !r[3]) {
        const b = await readBody(req);
        const syncPlan = () => { const c = campaigns.getContent(link.content_id); if (c?.variant_id) plan.syncVariant(c.variant_id); };
        if (b.unlink) { const o = campaigns.unlink(link.id, user.name); syncPlan(); return toCampaign(o.error || 'Association retirée.'); }
        const o = campaigns.setLinkState(link.id, b.state, user.name, b.confirm_hash);
        if (o.needsRecap) return redirect(res, `/edition/${ed.id}/links/${link.id}/confirm?to=${encodeURIComponent(b.state)}`);
        syncPlan();
        return toCampaign(o.error || (['transmis', 'publié'].includes(b.state) ? `Déclaré « ${b.state} » (rien n’a été envoyé à Meta par l’atelier).` : 'Statut mis à jour.'));
      }
    }

    // ---------- campagnes (créées dans Meta, reliées ici)
    if ((r = path.match(/^\/edition\/(\d+)\/campaigns(?:\/(meta|new|(\d+)(?:\/(meta|brief|adset|ad|link|result|guide|adcopy|import-results|apply-results|reconcile|approve-all)|\/adset\/(\d+)\/(meta|brief))?))?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      // on revient sur la vue de la campagne où l'action a été faite (diffusion, résultats, brief)
      const VUE = { 'approve-all': 'diffusion', adset: 'diffusion', ad: 'diffusion', link: 'diffusion', result: 'resultats', reconcile: 'resultats', brief: 'brief', meta: 'brief' };
      const back = (m, cid) => { const v = cid ? (r[6] ? 'diffusion' : VUE[r[4]] || '') : ''; return redirect(res, `/edition/${ed.id}/campaigns${cid ? '/' + cid : ''}?${v ? 'vue=' + v + '&' : ''}m=${encodeURIComponent(m)}`); };
      if (req.method === 'GET' && !r[2]) {
        const list = campaigns.listCampaigns(ed.id);
        const counts = Object.fromEntries(list.map((x) => [x.id, { variants: variants.listVariants(ed.id, x.id).filter((v) => v.status !== 'archivé').length, links: campaigns.allLinksOfCampaign(x.id), missing: campaigns.listAdsets(x.id).reduce((n, s) => n + campaigns.coverage(s, campaigns.linksFor('adset_id', s.id)).missing.length, 0) }]));
        return page('Campagnes', campaignsPage(ed, { meta: campaigns.getMetaLink(ed.id), campaigns: list, counts }), msgOf());
      }
      const guideData = (camp, extra = {}) => ({ camp, meta: campaigns.getMetaLink(ed.id), texts: campaigns.listContents(ed.id).filter((x) => x.kind === 'texte' && x.status !== 'archivé'), adsets: campaigns.listAdsets(camp.id).map((s) => ({ ...s, links: campaigns.linksFor('adset_id', s.id), ads: campaigns.listAds(s.id).map((a) => ({ ...a, links: campaigns.linksFor('ad_id', a.id) })) })), msg: msgOf(), ...extra });
      if (req.method === 'GET' && r[3] && r[4] === 'guide') {
        const camp = campaigns.getCampaign(Number(r[3]));
        if (!camp || camp.project_id !== ed.id) return send(res, 404, layout('Introuvable', '<h1>Campagne introuvable</h1>', user));
        variants.syncProject(ed.id, user.name);
        return page('Guide Ads Manager', metaGuidePage(ed, guideData(camp)));
      }
      if (req.method === 'GET' && r[3] && !r[4] && !r[5]) {
        const camp = campaigns.getCampaign(Number(r[3]));
        if (!camp || camp.project_id !== ed.id) return send(res, 404, layout('Introuvable', '<h1>Campagne introuvable</h1>', user));
        variants.syncProject(ed.id, user.name);
        const sp = url.searchParams, gallery = (cid) => { const filter = { q: (sp.get('q') || '').trim(), type: sp.get('type') || '', status: sp.get('status') || '', sort: sp.get('sort') || '' }; return { filter, gallery: projects.allWork(ed.id, { ...filter, campaign: cid }), campaignsList: campaigns.listCampaigns(ed.id) }; };
        const why = (ls) => ls.map((l) => ({ ...l, why: ['brouillon', 'à relire'].includes(l.state) ? campaigns.transitionRecap(l.id, 'approuvé')?.errors[0] || '' : '' }));
        const adsets = campaigns.listAdsets(camp.id).map((s) => ({ ...s, links: why(campaigns.linksFor('adset_id', s.id)), ads: campaigns.listAds(s.id).map((a) => ({ ...a, links: why(campaigns.linksFor('ad_id', a.id)) })) }));
        return page(camp.name, campaignPage(ed, { camp, adsets, pending: why(campaigns.allLinksOfCampaign(camp.id).filter((l) => ['brouillon', 'à relire'].includes(l.state))), texts: db.db.prepare("SELECT DISTINCT c.* FROM contents c JOIN content_links l ON l.content_id=c.id WHERE c.kind='texte' AND c.status<>'archivé' AND (l.campaign_id=? OR l.adset_id IN (SELECT id FROM adsets WHERE campaign_id=?) OR l.ad_id IN (SELECT a.id FROM ads a JOIN adsets s ON s.id=a.adset_id WHERE s.campaign_id=?)) ORDER BY c.id DESC").all(camp.id, camp.id, camp.id), contents: campaigns.listContents(ed.id).filter((x) => (x.export_id || x.kind === 'texte') && x.status !== 'archivé'), campLinks: why(campaigns.linksFor('campaign_id', camp.id)), allLinks: campaigns.allLinksOfCampaign(camp.id), compare: campaigns.compare(camp.id), conflicts: campaigns.resultConflicts(camp.id), vue: url.searchParams.get('vue') || '', variants: variants.listVariants(ed.id, camp.id).filter((v) => v.status !== 'archivé').map((v) => ({ ...v, pristine: variants.isPristine(v) })), outputs: Object.fromEntries(variants.listVariants(ed.id, camp.id).map((v) => [v.id, variants.outputsOf(v.id)])), nexts: Object.fromEntries(variants.listVariants(ed.id, camp.id).map((v) => [v.id, variants.nextStep(v.id)?.text || ''])), users: db.listUsers().map((u) => u.name), ...gallery(camp.id) }), msgOf());
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (r[2] === 'meta') { campaigns.saveMetaLink(ed.id, b); return b.from === 'settings' ? redirect(res, `/edition/${ed.id}/settings?m=${encodeURIComponent('Connexion Meta enregistrée (saisie manuelle).')}#connexions`) : back('Connexion enregistrée (saisie manuelle).'); }
        if (r[2] === 'new') { const o = campaigns.createCampaign(ed.id, b, user.name); return o.ok ? back('Campagne créée. Ajoutez maintenant son premier contenu.', o.id) : back(o.error); }
        const camp = campaigns.getCampaign(Number(r[3]));
        if (!camp || camp.project_id !== ed.id) return send(res, 404, 'Introuvable');
        if (r[5]) { // /adset/:sid/(meta|brief)
          const s = campaigns.getAdset(Number(r[5]));
          if (!s || s.campaign_id !== camp.id) return send(res, 404, 'Introuvable');
          if (r[6] === 'meta') campaigns.updateAdsetMeta(s.id, b, user.name); else campaigns.updateAdsetBrief(s.id, b, user.name);
          return back(r[6] === 'meta' ? 'Configuration Meta de l’ensemble enregistrée (saisie manuelle).' : 'Brief de l’ensemble enregistré.', camp.id);
        }
        if (r[4] === 'meta') { campaigns.updateCampaignMeta(camp.id, b, user.name); return back('Configuration Meta enregistrée (saisie manuelle, non vérifiée).', camp.id); }
        if (r[4] === 'brief') { campaigns.updateCampaignBrief(camp.id, b, user.name); return back('Brief interne enregistré.', camp.id); }
        if (r[4] === 'approve-all') { // valide pour la campagne tout ce qui peut l'être ; dit précisément ce qui reste bloqué et pourquoi
          const todo = campaigns.allLinksOfCampaign(camp.id).filter((l) => ['brouillon', 'à relire'].includes(l.state));
          const ko = []; let ok = 0;
          for (const l of todo) { const o = campaigns.setLinkState(l.id, 'approuvé', user.name); if (o.ok) ok++; else ko.push(o.error); }
          const reasons = [...new Set(ko)];
          return back(`${ok} contenu(s) approuvé(s) pour la campagne.${ko.length ? ` ${ko.length} restent en brouillon : ${reasons.join(' ; ')}` : ''}`, camp.id);
        }
        if (r[4] === 'adset') { const o = campaigns.createAdset(camp.id, b, user.name); return back(o.ok ? 'Ensemble relié.' : o.error, camp.id); }
        if (r[4] === 'ad') { const o = campaigns.createAd(Number(b.adset_id), b, user.name); return back(o.ok ? 'Annonce reliée.' : o.error, camp.id); }
        if (r[4] === 'link') { const o = campaigns.linkContent(Number(b.content_id), { campaign_id: b.campaign_id, adset_id: b.adset_id, ad_id: b.ad_id }, user.name); return back(o.ok ? 'Contenu associé en brouillon (version épinglée).' : o.error, camp.id); }
        if (r[4] === 'adcopy') {
          const a = campaigns.getAd(Number(b.ad_id)); if (!a || a.campaign_id !== camp.id) return send(res, 404, 'Introuvable');
          const src = b.from_text ? campaigns.getContent(Number(b.from_text)) : null;
          if (src && (src.project_id !== ed.id || src.kind !== 'texte')) return send(res, 404, 'Introuvable');
          campaigns.updateAdCopy(a.id, src ? { ...a, copy_primary: src.body, copy_headline: src.ad_headline || a.copy_headline, copy_description: src.ad_description || a.copy_description } : b, user.name); return redirect(res, `/edition/${ed.id}/campaigns/${camp.id}/guide?m=${encodeURIComponent('Publicité enregistrée.')}#ad${a.id}`); }
        if (r[4] === 'import-results') { const picks = {}; for (const k of Object.keys(b)) { const m = /^pick_(\d+)$/.exec(k); if (m && b[k]) picks[m[1]] = Number(b[k]); } return page('Guide Ads Manager', metaGuidePage(ed, guideData(camp, { importPreview: metaimport.previewImport(camp.id, b.csv, picks, { dec: b.dec }) }))); }
        if (r[4] === 'apply-results') {
          let rows = []; try { rows = JSON.parse(b.payload || '[]'); } catch { /* charge utile invalide */ }
          rows = Array.isArray(rows) ? rows : []; let hasC = []; try { hasC = JSON.parse(b.conflicts || '[]'); } catch { /* ignoré */ }
          rows.forEach((x, k) => { if (hasC[k]) { const act = b['act_' + k]; x.replace = act === 'replace'; x.both = act === 'both'; if (!x.replace && !x.both) x.skip = 'conflit non tranché'; } });
          const o = metaimport.applyImport(camp.id, rows, user.name);
          return redirect(res, `/edition/${ed.id}/campaigns/${camp.id}?m=${encodeURIComponent(`Résultats importés : ${o.added} ligne(s)${o.replaced ? `, ${o.replaced} mesure(s) remplacée(s) (anciennes conservées, hors totaux)` : ''}${o.duplicates ? `, ${o.duplicates} déjà présente(s) ignorée(s)` : ''}${o.conflicts ? `, ${o.conflicts} conflit(s) non importé(s)` : ''}.`)}`);
        }
        if (r[4] === 'reconcile') { // deux mesures aux périodes qui se croisent : on garde l'une, l'autre est mise de côté (conservée, hors totaux)
          const keep = Number(b.keep), drop = Number(b.drop), lids = new Set(campaigns.allLinksOfCampaign(camp.id).map((l) => l.id));
          const rk = db.db.prepare('SELECT link_id FROM results WHERE id=?').get(keep), rd = db.db.prepare('SELECT link_id FROM results WHERE id=?').get(drop);
          if (!rk || !rd || rk.link_id !== rd.link_id || !lids.has(rk.link_id)) return back('Mesures introuvables.', camp.id);
          campaigns.supersedeResult(drop, keep, user.name);
          return back('Mesure mise de côté : elle reste enregistrée mais n’entre plus dans les totaux.', camp.id);
        }
        if (r[4] === 'result') return back(campaigns.addResult(Number(b.link_id), b, user.name) ? 'Résultats ajoutés.' : 'Association introuvable.', camp.id);
      }
    }

    // ---------- textes (concepts, scripts, légendes) : espace de travail en quatre étapes
    if ((r = path.match(/^\/edition\/(\d+)\/texts\/(\d+)(?:\/(save|import|approve|review|link|plan|download))?$/))) {
      const ed = db.getEdition(Number(r[1])), t = campaigns.getContent(Number(r[2]));
      if (!ed || !t || t.project_id !== ed.id || t.kind !== 'texte') return send(res, 404, layout('Introuvable', '<h1>Texte introuvable</h1>', user));
      const base = `/edition/${ed.id}/texts/${t.id}`, to = (step, m) => redirect(res, `${base}?step=${step}&m=${encodeURIComponent(m)}`);
      if (req.method === 'GET' && r[3] === 'download') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${t.title.replace(/[^\w.\- ]+/g, '_').slice(0, 60) || 'texte'}.txt"` });
        return res.end(t.body || '');
      }
      if (req.method === 'GET' && !r[3]) {
        const links = campaigns.linksOfContent(t.id), body = String(t.body || '').trim();
        const camp0 = links.find((l) => l.campaign_id || l.campaign_name);
        const ws = { campaignId: camp0?.campaign_id || null, campaignName: camp0?.campaign_name || '', steps: [{ key: 'materiel', label: 'Matériel', done: !!(body || t.asset_id), note: '' }, { key: 'creation', label: 'Création', done: !!body, note: '' }, { key: 'verification', label: 'Vérification et exports', done: t.status === 'approuvé', note: body ? '' : '1 à corriger' }, { key: 'diffusion', label: 'Diffusion', done: links.some((l) => ['approuvé', 'transmis', 'publié'].includes(l.state)), note: links.length ? 'rangé dans sa campagne' : '' }] };
        const camps2 = campaigns.listCampaigns(ed.id);
        const step = ['materiel', 'creation', 'verification', 'diffusion'].includes(url.searchParams.get('step')) ? url.searchParams.get('step') : (body ? 'verification' : 'materiel');
        return page(t.title, textPage(ed, { t, ws, step, assets: studio.listAssets(ed.id), campaigns: camps2, adsets: camps2.flatMap((c2) => campaigns.listAdsets(c2.id).map((a) => ({ ...a, campaign_name: c2.name }))), links, planItems: plan.listItems(ed.id).filter((p) => p.title === `Publier : ${t.title}`) }), msgOf());
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (r[3] === 'save') { campaigns.updateContent(t.id, { ...b, channel: t.channel, status: t.status === 'approuvé' ? 'à relire' : t.status, notes: t.notes }, user.name); return to('creation', 'Texte enregistré.'); }
        if (r[3] === 'import') { const o = intake.importIntoContent(ed.id, t.id, Number(b.asset), user.name); return to('creation', o.ok ? (o.read ? 'Texte importé à la suite : relisez-le.' : 'Fichier joint ; son texte n’a pas pu être lu automatiquement.') : o.error); }
        if (r[3] === 'approve') { if (!String(t.body || '').trim()) return to('verification', 'Le texte est vide : rédigez-le avant de l’approuver.'); campaigns.updateContent(t.id, { ...t, status: 'approuvé', body: t.body }, user.name); return to('verification', 'Texte approuvé.'); }
        if (r[3] === 'review') { campaigns.updateContent(t.id, { ...t, status: 'à relire', body: t.body }, user.name); return to('verification', 'Mis de côté « à relire ».'); }
        if (r[3] === 'link') { const [field, val] = String(b.target || '').split(':'); if (!['campaign_id', 'adset_id'].includes(field)) return to('diffusion', 'Choisissez le niveau de la campagne.'); const o = campaigns.linkContent(t.id, { [field]: val }, user.name); return to('diffusion', o.ok ? 'Texte associé en brouillon (rien n’est transmis).' : o.error); }
        if (r[3] === 'plan') { const o = plan.addItem(ed.id, { title: `Publier : ${t.title}`, due_date: b.due, kind: 'publication' }, user.name); return to('diffusion', o.ok ? 'Ajouté au calendrier.' : o.error); }
      }
    }

    // ---------- variantes guidées
    if ((r = path.match(/^\/edition\/(\d+)\/variants\/batch$/)) && req.method === 'POST') { // galerie : action groupée sur la sélection
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const b = await readBody(req, { multi: ['ids'] });
      const ids = [].concat(b.ids || []).filter((x) => /^[vt]\d+$/.test(x));
      const o = b.action === 'delete' ? projects.deleteContents(ed.id, ids, user.name) : projects.batchContents(ed.id, ids, b.action, b.target, user.name);
      const back = /^\/edition\/\d+\/(variants|campaigns\/\d+)(\?[\w=&%-]*)?$/.test(b.back || '') ? b.back : `/edition/${ed.id}/variants`;
      const done = { move: `${o.n} contenu(s) déplacé(s).`, archive: `${o.n} contenu(s) archivé(s).`, variant: `${o.n} variante(s) créée(s).`, delete: `${o.n} contenu(s) supprimé(s) définitivement.${o.kept?.length ? ` Non supprimé(s), déjà transmis à Meta ou export en cours (archivez-les) : ${o.kept.join(', ')}.` : ''}` }[b.action] || `${o.n} contenu(s) traité(s).`;
      return redirect(res, `${back}${back.includes('?') ? '&' : '?'}m=${encodeURIComponent(o.ok ? done : o.error)}`);
    }
    if ((r = path.match(/^\/edition\/(\d+)\/variants(?:\/(new)|\/(\d+)(?:\/(update|messages|review|assign|approve-export|approve|restore|export|link|plan|duplicate|archive|material|save-model))?)?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const camps = campaigns.listCampaigns(ed.id), users = db.listUsers().map((u) => u.name);
      const adsets = camps.flatMap((c) => campaigns.listAdsets(c.id).map((a) => ({ ...a, campaign_name: c.name })));
      const templates = library.listTemplates().filter((t) => t.kind !== 'kit').map((t) => ({ name: t.name, version: t.last_version, version_id: library.listVersions(t.id)[0]?.id })).filter((t) => t.version_id);
      const srcContent = campaigns.getContent(Number(url.searchParams.get('content'))), prefill = srcContent && srcContent.project_id === ed.id ? { name: srcContent.title, angle: srcContent.angle, audience: srcContent.audience, language: srcContent.language, source_text: srcContent.body, source_title: srcContent.title } : {};
      const newForm = (values = {}, error = '') => page('Test détaillé', variantNewPage(ed, { prefill, campaigns: camps, adsets, assets: studio.listAssets(ed.id), templates, users, values, error, who: user.name, solo: false, preset: { campaign_id: Number(url.searchParams.get('campaign')) || '', adset_id: Number(url.searchParams.get('adset')) || '', formats: (url.searchParams.get('formats') || '').split(',').filter((k) => studio.POSTER_FORMATS[k]).length ? (url.searchParams.get('formats') || '').split(',').filter((k) => studio.POSTER_FORMATS[k]) : undefined } }));
      const presetL = { campaign_id: Number(url.searchParams.get('campaign')) || '', adset_id: Number(url.searchParams.get('adset')) || '', formats: (url.searchParams.get('formats') || '').split(',').filter((k) => studio.POSTER_FORMATS[k]) };
      const fromAsset = studio.getAsset(Number(url.searchParams.get('asset'))), fromDesign = Number(url.searchParams.get('design')) || '';
      const from = { asset: fromAsset && fromAsset.edition_id === ed.id ? fromAsset : null, design_version: fromDesign, type: fromAsset?.edition_id === ed.id ? (fromAsset.kind === 'video' ? 'video' : fromAsset.kind === 'image' ? 'affiche' : 'texte') : '' };
      const dv = fromDesign && !templates.some((t) => String(t.version_id) === String(fromDesign)) ? library.getVersion(fromDesign) : null; // version précise demandée, même si ce n'est pas la dernière
      const templatesL = dv ? [...templates, { name: library.getTemplate(dv.template_id).name, version: dv.version, version_id: dv.id }] : templates;
      const light = (values = {}, error = '') => page('Créer un contenu', contentNewPage(ed, { videoReady: ffmpegReady(), from, templates: templatesL, campaigns: camps, variants: variants.listVariants(ed.id).filter((x) => x.status !== 'archivé'), values, error, prefill, preset: presetL }));
      if (r[2] === 'new') {
        if (req.method === 'GET') return url.searchParams.get('mode') === 'test' ? newForm() : light();
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (b.type) { // « Ajouter un contenu » : type, nom, campagne (par défaut « Hors campagne »), point de départ
            if (!Number(b.campaign_id)) b.campaign_id = String(campaigns.ensureOffCampaign(ed.id, user.name));
            if (b.type === 'texte') {
              const o = campaigns.createContent(ed.id, { title: b.name || `Texte — ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`, body: b.copy ? (campaigns.getContent(Number(b.copy))?.body || '') : '', language: 'EN' }, user.name);
              if (o.ok) { db.db.prepare("UPDATE contents SET status='brouillon' WHERE id=?").run(o.id); campaigns.linkContent(o.id, { campaign_id: Number(b.campaign_id) }, user.name); } // le texte démarre en brouillon et appartient à sa campagne
              if (o.ok && b.asset) intake.importIntoContent(ed.id, o.id, Number(b.asset), user.name);
              return o.ok ? redirect(res, `/edition/${ed.id}/texts/${o.id}?step=materiel&m=${encodeURIComponent('Texte créé. Importez un document ou passez à la rédaction.')}`) : light(b, o.error);
            }
            const src = b.copy ? variants.getVariant(Number(b.copy)) : null;
            const o = src && src.project_id === ed.id ? variants.duplicateVariant(src.id, { ...b, simple: '1' }, user.name) : variants.createVariant(ed.id, { ...b, simple: '1' }, user.name);
            if (o.ok) { // le fichier ou le design choisi au départ est appliqué tout de suite
              const as = b.asset ? studio.getAsset(Number(b.asset)) : null, ok = as && as.edition_id === ed.id;
              const m = {};
              if (ok && b.type === 'video' && as.kind === 'video') m.video_asset = String(as.id);
              else if (ok && as.kind === 'image') m[as.role === 'poster' ? 'poster' : as.role === 'logo' ? 'logo' : 'hero'] = String(as.id);
              if (b.design_version) m.design_version = b.design_version;
              if (Object.keys(m).length) variants.applyMaterial(o.id, m, user.name);
            }
            return o.ok ? redirect(res, `/edition/${ed.id}/variants/${o.id}?step=materiel&m=${encodeURIComponent('Contenu créé. Choisissez le matériel, puis passez à la création.')}`) : light(b, o.error);
          }
          const o = variants.createVariant(ed.id, b, user.name);
          return o.ok ? redirect(res, `/edition/${ed.id}/variants/${o.id}?m=${encodeURIComponent('Variante créée. Ajustez textes et cadrages, puis demandez la relecture.')}`) : newForm(b, o.error);
        }
      }
      if (!r[3] && req.method === 'GET') {
        const sp = url.searchParams, filter = { q: (sp.get('q') || '').trim(), type: sp.get('type') || '', status: sp.get('status') || '', campaign: Number(sp.get('campaign')) || '', sort: sp.get('sort') || '' };
        const all = projects.allWork(ed.id, {}), counts = Object.fromEntries(camps.map((x) => [x.id, all.filter((w) => w.campaigns.includes(x.id)).length]));
        return page('Contenus', variantsPage(ed, { rows: projects.allWork(ed.id, filter), total: all.length, campaigns: camps, filter, counts }), msgOf());
      }
      if (r[3]) {
        const v = variants.getVariant(Number(r[3]));
        if (!v || v.project_id !== ed.id) return send(res, 404, layout('Introuvable', '<h1>Contenu introuvable</h1>', user));
        const back = (m) => redirect(res, `/edition/${ed.id}/variants/${v.id}?m=${encodeURIComponent(m)}`);
        if (req.method === 'GET' && !r[4]) {
          // « Création » d'une affiche : on arrive directement dans l'éditeur du premier format. La page d'ensemble (textes communs, vidéo, modèle) reste à ?all=1.
          if (url.searchParams.get('step') === 'creation' && !url.searchParams.has('all') && v.formats.length) return redirect(res, `/edition/${ed.id}/poster/${v.formats[0]}?variant=${v.id}`);
          const autoAdset = v.adset_id ? adsets.find((a) => a.id === v.adset_id) : null, autoCamp = v.campaign_id ? camps.find((c2) => c2.id === v.campaign_id) : null;
          return page(v.name, variantPage(ed, { solo: false, next: variants.nextStep(v.id), checksList: variants.checks(v.id), autoLabel: autoAdset ? `ensemble « ${autoAdset.name} »` : autoCamp ? `campagne « ${autoCamp.name} »` : '', v, outputs: variants.outputsOf(v.id), versions: variants.listVersions(v.id), pristine: variants.isPristine(v), campaigns: camps, adsets, users, planItems: plan.listItems(ed.id, { variantId: v.id }), step: url.searchParams.get('step'), ws: variants.workspaceInfo(v.id), assets: studio.listAssets(ed.id).map((a) => ({ ...a, warn: intake.imageWarnings(a)[0] || '' })), templates, models: library.listTemplates().filter((t) => t.kind === 'modele'), design0: v.formats.length ? studio.getDesign(ed.id, `v${v.id}_${v.formats[0]}`) : null, vdesign: v.with_video ? video.getVideoDesign(ed.id, `v${v.id}`) : null }), msgOf());
        }
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (r[4] === 'save-model') { const o = await library.saveModel(ed, v, b, user.name); return redirect(res, `/edition/${ed.id}/variants/${v.id}?step=creation&all=1&m=${encodeURIComponent(o.ok ? `Modèle enregistré (version ${o.version}). Vous le retrouvez dans « Créer un contenu » et dans Bibliothèque › Designs et modèles.` : o.error)}`); }
          if (r[4] === 'material') { const o = variants.applyMaterial(v.id, b, user.name); return redirect(res, `/edition/${ed.id}/variants/${v.id}?step=materiel&m=${encodeURIComponent(o.ok ? o.msg : o.error)}`); }
          if (r[4] === 'update') { variants.updateVariant(v.id, b, user.name); return back('Intention enregistrée.'); }
          if (r[4] === 'messages') { variants.updateMessages(v.id, b, user.name); return redirect(res, `/edition/${ed.id}/variants/${v.id}?step=creation&all=1&m=${encodeURIComponent('Textes appliqués aux formats : voir les aperçus ci-dessous.')}#textes`); }
          if (r[4] === 'assign') { const o = variants.assign(v.id, b, user.name); return back(o.ok ? 'Responsable, relecteur et échéance enregistrés.' : o.error); }
          if (r[4] === 'review') { const o = variants.requestReview(v.id, user.name); plan.syncVariant(v.id); return back(o.ok ? 'Mise de côté « à relire » : revenez-y avec un regard neuf, puis approuvez.' : o.error); }
          if (r[4] === 'approve-export') {
            const o = await variants.approveAndExport(v.id, user.name, b.note); plan.syncVariant(v.id);
            if (!o.ok) return back(o.error);
            const ko = o.out.filter((x) => x.failed), fmtOf = (x) => studio.POSTER_FORMATS[x.fmt].ratio;
            // l'approbation et l'export sont deux résultats distincts : jamais « approuvée et exportée : échec »
            if (ko.length) return back(`Version v${o.approvedVersion} approuvée. Export ${ko.length === o.out.length ? 'ÉCHOUÉ' : 'PARTIEL'} : ${ko.length === o.out.length ? 'aucun fichier produit' : `${o.out.length - ko.length} format(s) prêt(s)`}, échec sur ${ko.map(fmtOf).join(', ')}. « Reprendre l’export » refait uniquement ce qui manque, sans doublon.`);
            return back(`Approuvée (v${o.approvedVersion}) et exportée : ` + o.out.map((x) => `${fmtOf(x)} ${x.state}`).join(' · ') + (o.video?.ok ? ' · vidéo en cours' : '') + (o.draft ? ' — exports marqués BROUILLON (fiche non prête ou source provisoire).' : ''));
          }
          if (r[4] === 'approve') { const o = variants.approve(v.id, user.name, b.note); plan.syncVariant(v.id); return back(o.ok ? `Version ${o.version} approuvée et figée.${o.draft ? ' Les exports seront marqués BROUILLON tant que la fiche n’est pas prête ou que les sources sont provisoires.' : ''}` : o.error); }
          if (r[4] === 'restore') { const o = variants.restoreApproved(v.id, Number(b.version), user.name); return back(o.ok ? `Retour à la version approuvée v${b.version}.` : o.error); }
          if (r[4] === 'export') {
            const only = b.sel ? Object.keys(b).filter((k) => k.startsWith('o_')).map((k) => k.slice(2)) : null;
            if (only && !only.length) return back('Cochez au moins une sortie à exporter.');
            const o = await variants.exportApproved(v.id, user.name, only); plan.syncVariant(v.id);
            return back(o.ok ? 'Export de la version approuvée : ' + o.out.map((x) => `${studio.POSTER_FORMATS[x.fmt].ratio} ${x.state}`).join(' · ') + (o.video?.ok ? ' · vidéo : ' + o.video.out.map(([f, s]) => `${studio.POSTER_FORMATS[f].ratio} ${s}`).join(', ') : '') : o.error);
          }
          if (r[4] === 'link') {
            const [field, val] = b.target === 'auto' ? (v.adset_id ? ['adset_id', String(v.adset_id)] : v.campaign_id ? ['campaign_id', String(v.campaign_id)] : ['', '']) : String(b.target || '').split(':');
            if (!['campaign_id', 'adset_id', 'ad_id'].includes(field)) return back('Choisissez le niveau de la campagne (ou renseignez la campagne du contenu).');
            const o = variants.linkOutputs(v.id, { [field]: val }, user.name); plan.syncVariant(v.id);
            return redirect(res, `/edition/${ed.id}/variants/${v.id}?step=diffusion&m=${encodeURIComponent(`${o.ok} sortie(s) associée(s) en brouillon (version épinglée).${o.skipped.length ? ' Ignorées : ' + o.skipped.join(' ; ') : ''}`)}`);
          }
          if (r[4] === 'plan') { const o = plan.planVariant(v.id, b.publish, user.name); return redirect(res, `/edition/${ed.id}/variants/${v.id}?step=diffusion&m=${encodeURIComponent(o.ok ? 'Planifié à rebours : voir le calendrier.' : o.error)}`); }
          if (r[4] === 'duplicate') {
            // « Créer une variante » en un clic : copie complète (formats, photos, cadrages, textes), nom « … — B », ouverte directement dans l'éditeur
            if (b.quick) { const o = variants.duplicateVariant(v.id, { simple: '1', name: variants.nextVariantName(v) }, user.name); return o.ok ? redirect(res, `/edition/${ed.id}/variants/${o.id}?step=creation&m=${encodeURIComponent(`Variante « ${variants.getVariant(o.id).name} » créée : copie complète de « ${v.name} ». Changez ce qui doit changer.`)}`) : back(o.error); }
            const o = variants.duplicateVariant(v.id, b, user.name); return o.ok ? redirect(res, `/edition/${ed.id}/variants/${o.id}?m=${encodeURIComponent('Variante dupliquée.')}`) : back(o.error);
          }
          if (r[4] === 'archive') { variants.archive(v.id, user.name); return redirect(res, `/edition/${ed.id}/variants?m=${encodeURIComponent('Variante archivée.')}`); }
        }
      }
    }

    // ---------- calendrier de production
    if ((r = path.match(/^\/edition\/(\d+)\/calendar(?:\/(new|(\d+)))?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const back = (m) => redirect(res, `/edition/${ed.id}/calendar?m=${encodeURIComponent(m)}`);
      if (req.method === 'GET' && !r[2]) {
        // sans mois demandé : le mois courant s'il contient une tâche à faire, sinon celui de la prochaine tâche (on ne tombe pas sur un mois vide)
        const cm = plan.today().slice(0, 7), upcoming = plan.listItems(ed.id, { from: plan.today() }).filter((i) => i.status !== 'fait').sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
        const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : upcoming && !plan.listItems(ed.id, { from: cm + '-01', to: cm + '-31' }).some((i) => i.status !== 'fait') ? upcoming.due_date.slice(0, 7) : cm;
        const campaignFilter = Number(url.searchParams.get('campaign')) || '';
        const grid = plan.monthGrid(month), from = grid[0][0].date, to = grid[grid.length - 1][6].date;
        return page('Calendrier', calendarPage(ed, { thumbs: Object.fromEntries(studio.listExports(ed.id).filter((e) => e.kind === 'affiche' && e.variant_id).reverse().map((e) => [e.variant_id, `/exports/${e.id}`])), month, items: plan.listItems(ed.id, { from, to, campaignId: campaignFilter || undefined }), campaigns: campaigns.listCampaigns(ed.id), variants: variants.listVariants(ed.id), users: db.listUsers().map((u) => u.name), solo: db.listUsers().length <= 1, todo: todo.nextActions(ed.id), campaignFilter }), msgOf());
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (r[2] === 'new') { const o = plan.addItem(ed.id, b, user.name); return back(o.ok ? 'Tâche ajoutée.' : o.error); }
        if (b.remove) { plan.removeItem(Number(r[3]), user.name); return back('Tâche supprimée.'); }
        plan.updateItem(Number(r[3]), b, user.name); return back('Tâche mise à jour.');
      }
    }

    // ---------- le site WordPress du projet (un site par projet)
    if ((r = path.match(/^\/edition\/(\d+)\/site(?:\/(save|secret|steps))?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const back = (m) => redirect(res, `/edition/${ed.id}/site?m=${encodeURIComponent(m)}`);
      if (req.method === 'GET' && !r[2]) return page('Site web', sitePage(ed, { site: siteMod.getSite(ed.id) }), msgOf());
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (r[2] === 'save') { siteMod.saveSite(ed.id, b, user.name); return back('Site du projet enregistré.'); }
        if (r[2] === 'secret' && PROJECT_DEFS.some((d) => d.key === b.key)) {
          if (b.clear) { clearSecret(b.key, 'p' + ed.id); db.log(user.name, `Site du projet ${ed.id} : ${b.key} effacé`); return back('Effacé.'); }
          if (setSecret(b.key, (b.value || '').trim(), 'p' + ed.id)) { db.log(user.name, `Site du projet ${ed.id} : ${b.key} enregistré`); return back('Enregistré (propre à ce projet).'); }
          return back('Valeur vide : rien changé.');
        }
        if (r[2] === 'steps') { for (const [k] of siteMod.STEPS) siteMod.setStep(ed.id, k, b['step_' + k] === '1', user.name); return back('Avancement enregistré.'); }
      }
    }

    // ---------- sauvegardes (Réglages)
    if (path === '/settings/backup-config' && req.method === 'POST') {
      const b = await readBody(req), bad = backup.checkBackupDir(b.dir);
      if (bad) return redirect(res, `/settings?m=${encodeURIComponent(bad)}`);
      backup.setSetting('backup_dir', b.dir.trim()); backup.setSetting('backup_exports', ['pinned', 'all', 'none'].includes(b.mode) ? b.mode : 'pinned');
      return redirect(res, `/settings?m=${encodeURIComponent('Dossier de sauvegarde enregistré.')}`);
    }
    if (path === '/settings/backup-now' && req.method === 'POST') {
      const o = await backup.createBackup({ dir: backup.getSetting('backup_dir'), exportsMode: backup.getSetting('backup_exports', 'pinned'), who: user.name });
      return redirect(res, `/settings?m=${encodeURIComponent(o.ok ? `Sauvegarde créée : ${o.files} fichiers, ${(o.bytes / 1048576).toFixed(1)} Mo.${o.missing.length ? ' Éléments déjà manquants : ' + o.missing.length : ''}` : o.error)}#sauvegardes`);
    }

    const m = path.match(/^\/edition\/(\d+)(?:\/(save|duplicate|settings|restore\/(\d+)))?$/);
    if (m) {
      const id = Number(m[1]);
      const ed = db.getEdition(id);
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      if (!m[2] && req.method === 'GET') return page(ed.label, projectHomePage(ed, projects.homeData(ed)), url.searchParams.get('m')); // Accueil : tableau de travail
      if (m[2] === 'settings' && req.method === 'GET') return page(`Paramètres — ${ed.label}`, editionPage(ed, fieldsBySection(), db.listVersions(id), '', campaigns.getMetaLink(id)), url.searchParams.get('m')); // la fiche du spectacle est ici
      if (req.method !== 'POST') return send(res, 405, 'Méthode non autorisée');
      const b = await readBody(req);
      if (m[2] === 'save') {
        const data = { provisional: b.provisional === '1' ? '1' : '0' };
        for (const f of fieldKeys()) data[f.key] = f.type === 'checkbox' ? (b[f.key] === '1' ? '1' : '0') : (b[f.key] ?? '').toString().slice(0, 5000);
        // Statut affiché dans le formulaire = statut avant enregistrement : on ne l'applique que si l'utilisateur l'a changé.
        const shown = Object.fromEntries(SECTIONS.map((s) => [s.id, ed.validation[s.id]?.status || 'brouillon']));
        db.saveEdition(id, data, user.name);
        for (const s of SECTIONS) {
          const want = b[`status_${s.id}`];
          if (VALIDATION.includes(want) && want !== shown[s.id]) db.setValidation(id, s.id, want, user.name);
        }
        return redirect(res, `/edition/${id}/settings?m=${encodeURIComponent('Enregistré.')}`);
      }
      if (m[2] === 'duplicate') return redirect(res, `/edition/${db.duplicateEdition(id, b.label.trim(), user.name)}?m=${encodeURIComponent('Copie du projet créée en brouillon.')}`);
      if (m[3]) { db.restoreVersion(id, Number(m[3]), user.name); return redirect(res, `/edition/${id}/settings?m=${encodeURIComponent('Version restaurée.')}`); }
    }

    if (path === '/settings' && req.method === 'GET') return page('Réglages', settingsPage(db.listUsers(), lastBackup, url.searchParams.get('m')) + backupCard({ status: backup.backupStatus(), backups: backup.listBackups(), report: url.searchParams.get('check') ? backup.integrity() : null, deps: url.searchParams.get('check') ? backup.dependencies() : null }));
    if (path.startsWith('/settings/') && req.method === 'POST') {
      const b = await readBody(req);
      let msg = '';
      if (path === '/settings/secret' && SECRET_DEFS.some((d) => d.key === b.key)) {
        if (b.clear) { clearSecret(b.key); db.log(user.name, `Réglage effacé : ${b.key}`); msg = 'Effacé.'; }
        else if (setSecret(b.key, (b.value || '').trim())) { db.log(user.name, `Réglage enregistré : ${b.key}`); msg = 'Enregistré.'; }
        else msg = 'Valeur vide : rien changé.';
      } else if (path === '/settings/user' && db.listUsers().length < 6 && (b.password || '').length >= 10 && b.name?.trim()) {
        try { db.createUser(b.name.trim(), b.password); db.log(user.name, `Utilisateur ajouté : ${b.name.trim()}`); msg = 'Utilisateur ajouté.'; } catch { msg = 'Ce nom existe déjà.'; }
      } else if (path === '/settings/backup') { lastBackup = db.backup(); msg = 'Sauvegarde effectuée.'; }
      return redirect(res, `/settings?m=${encodeURIComponent(msg)}`);
    }

    send(res, 404, layout('Introuvable', '<h1>Page introuvable</h1>', user));
  } catch (e) {
    console.error(e);
    send(res, 500, layout('Erreur', '<h1>Une erreur est survenue</h1><p>Une erreur inattendue s’est produite sur cette page. Vos versions approuvées et vos exports ne sont pas modifiés par cette erreur ; si vous étiez en train d’enregistrer, vérifiez que vos dernières modifications sont bien présentes. Notez ce que vous faisiez et prévenez le développeur.</p>'));
  }
});

backup.startAutoBackup();
server.listen(PORT, HOST, () => console.log(`Atelier prêt : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
