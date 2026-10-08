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
import * as plan from './plan.js';
import * as backup from './backup.js';
import * as todo from './todo.js';
import * as siteMod from './site.js';
import { variantsPage, variantNewPage, variantPage, calendarPage, todoCard, sitePage, contentsPage, campaignsPage, campaignPage, transitionPage, backupCard } from './views_flow.js';
import * as campaigns from './campaigns.js';
import { probe, ffmpegReady, toSrt } from './media.js';
import { renderPoster, renderSite, SITE_PAGES } from './render.js';
import { publishBlockers } from './schema.js';
import { layout, assetsPage, posterPage, videoPage, designsPage, applyDesignPage, loginPage, setupPage, homePage, editionPage, settingsPage } from './views.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // local uniquement ; passer HOST=0.0.0.0 lors d'une migration serveur
let lastBackup = '';

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
const readBody = (req) => new Promise((res) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => res(Object.fromEntries(new URLSearchParams(b))));
});
const send = (res, status, html, headers = {}) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:", ...headers }); res.end(html); };
const redirect = (res, to, headers = {}) => { res.writeHead(303, { Location: to, ...headers }); res.end(); };
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
        return redirect(res, '/');
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

    // ---------- assets, affiches, site (aperçu)
    const RENDER_CSP = { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:" };
    const msgOf = () => url.searchParams.get('m');
    let r;
    if ((r = path.match(/^\/edition\/(\d+)\/assets$/)) && req.method === 'GET') {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      return page('Assets', assetsPage(ed, studio.listAssets(ed.id), msgOf(), `${storage.driver} — ${storage.location}`));
    }
    if (path === '/assets/upload' && req.method === 'POST') {
      const ed = db.getEdition(Number(url.searchParams.get('edition')));
      const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (!ed) return json(404, { error: 'Projet introuvable' });
      try {
        const id = await studio.saveUpload(req, { editionId: ed.id, name: url.searchParams.get('name') || 'fichier', role: url.searchParams.get('role'), who: user.name });
        return json(200, { id });
      } catch (e) { return json(400, { error: e.message }); }
    }
    if ((r = path.match(/^\/assets\/(\d+)\/update$/)) && req.method === 'POST') {
      const a = studio.getAsset(Number(r[1]));
      if (!a) return send(res, 404, 'Introuvable');
      const b = await readBody(req);
      studio.updateAsset(a.id, { role: b.role, provisional: b.provisional === '1', rights: b.rights, status: b.status }, user.name);
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
      return serve(req, res, statSync(studio.exportPath(e)).size, { 'Content-Type': type, ...(download ? { 'Content-Disposition': `attachment; filename="${e.file}"` } : {}) }, (o) => createReadStream(studio.exportPath(e), o));
    }
    if ((r = path.match(/^\/edition\/(\d+)\/pack$/)) && req.method === 'POST') {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, 'Introuvable');
      const b = await readBody(req);
      const out = studio.exportPack(ed, Object.keys(b).filter((k) => k.startsWith('ch_')).map((k) => k.slice(3)), user.name, publishBlockers(ed));
      return redirect(res, `/edition/${ed.id}/poster/4x5?m=${encodeURIComponent(out.ok ? `Pack créé (${out.count} formats)${out.draft ? ', marqué BROUILLON (fiche non prête).' : '.'}` : out.error)}`);
    }
    if ((r = path.match(/^\/edition\/(\d+)\/poster\/([a-z0-9]+)(?:\/(save|export|svg|pdf))?$/))) {
      const ed = db.getEdition(Number(r[1])), fmt = r[2];
      if (!ed || !studio.POSTER_FORMATS[fmt]) return send(res, 404, layout('Introuvable', '<h1>Projet ou format introuvable</h1>', user));
      const blockers = publishBlockers(ed);
      const vid = Number(url.searchParams.get('variant')) || 0, variant = vid ? variants.getVariant(vid) : null;
      if (vid && (!variant || variant.project_id !== ed.id)) return send(res, 404, layout('Introuvable', '<h1>Variante introuvable</h1>', user));
      const dkey = vid ? `v${vid}_${fmt}` : `poster_${fmt}`, pq = vid ? `variant=${vid}&` : '';
      const builder = vid ? (fl) => studio.buildPosterHtml(ed, fmt, [], { noDraft: true, designKey: dkey, ...fl }) : undefined;
      if (req.method === 'GET' && (r[3] === 'svg' || r[3] === 'pdf')) { // exports éditables pour Illustrator
        const base = `projet-${ed.id}-${fmt}`;
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
      if (req.method === 'GET' && !r[3]) return page('Affiches', posterPage(ed, fmt, studio.getDesign(ed.id, dkey), studio.listAssets(ed.id), studio.listExports(ed.id), msgOf(), blockers.length, studio.listDesignHistory(ed.id, dkey), variant));
      if (req.method === 'POST') {
        studio.saveDesign(ed.id, dkey, await readBody(req), user.name);
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
      return send(res, 200, renderPoster(ed, r[2], g, { heroSrc: asset(g.hero), logoSrc: asset(g.logo), partnerSrcs: g.partners === '1' ? studio.assetsByRole(ed.id, 'partner').filter((a) => a.kind === 'image').reverse().map((a) => `/files/${a.id}`) : [], draft: publishBlockers(ed).length > 0, edit: url.searchParams.get('edit') === '1' }), { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'self'" });
    }
    if ((r = path.match(/^\/site\/(\d+)(?:\/([a-z]*))?$/)) && req.method === 'GET') {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, 'Introuvable');
      const pg = r[2] || 'home';
      if (!SITE_PAGES.some(([k]) => k === pg)) return send(res, 404, 'Page introuvable');
      return send(res, 200, renderSite(ed, pg, { assets: studio.listAssets(ed.id), base: `/site/${ed.id}`, draftReasons: publishBlockers(ed) }), { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:" });
    }

    // ---------- vidéo
    if ((r = path.match(/^\/api\/jobs\/(\d+)$/)) && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(video.listJobs(Number(r[1]))));
    }
    if ((r = path.match(/^\/edition\/(\d+)\/video(?:\/(save|export|subs-import|subs\.srt))?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const vid = Number(url.searchParams.get('variant')) || 0, variant = vid ? variants.getVariant(vid) : null, scope = vid ? `v${vid}` : '';
      if (vid && (!variant || variant.project_id !== ed.id)) return send(res, 404, layout('Introuvable', '<h1>Variante introuvable</h1>', user));
      const sub = r[2], back = (m) => redirect(res, `/edition/${ed.id}/video?${vid ? 'variant=' + vid + '&' : ''}m=${encodeURIComponent(m)}`);
      if (req.method === 'GET' && sub === 'subs.srt') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="sous-titres.srt"' });
        return res.end(toSrt(video.getCues(ed.id, scope).cues));
      }
      if (req.method === 'GET' && !sub) {
        const design = video.getVideoDesign(ed.id, scope), asset = design.asset ? studio.getAsset(Number(design.asset)) : null;
        const info = asset && storage.exists(asset.stored) ? probe(studio.assetPath(asset)) : null;
        return page('Vidéos', videoPage(ed, { variant, design, cues: video.getCues(ed.id, scope).cues, info, assets: studio.listAssets(ed.id), ready: ffmpegReady(), draft: publishBlockers(ed).length > 0 || asset?.provisional === 1 }), msgOf());
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (sub === 'subs-import') { const o = video.importCues(ed.id, b.asset, user.name, scope); return back(o.ok ? `${o.count} sous-titres importés.` : o.error); }
        if (b.design) video.saveVideoDesign(ed.id, b.design, scope, user.name);
        if (b.cues !== undefined) video.saveCues(ed.id, b.cues, user.name, undefined, scope);
        if (sub === 'export') {
          const o = video.planExports(db.getEdition(ed.id), user.name, { scope });
          return back(o.ok ? 'Exports : ' + o.out.map(([f, s]) => `${studio.POSTER_FORMATS[f].ratio} ${s}`).join(' · ') : o.error);
        }
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
    if ((r = path.match(/^\/edition\/(\d+)\/designs(?:\/(save|apply|duplicate|bundle)(?:\/(\d+))?)?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const back = (m) => redirect(res, `/edition/${ed.id}/designs?m=${encodeURIComponent(m)}`);
      if (req.method === 'GET' && !r[2]) {
        const templates = library.listTemplates();
        return page('Designs', designsPage(ed, { templates, versions: Object.fromEntries(templates.map((t) => [t.id, library.listVersions(t.id)])), applications: library.listApplications(ed.id), bundles: studio.listExports(ed.id).filter((e) => e.kind === 'bundle'), msg: msgOf() }));
      }
      if (req.method === 'GET' && r[2] === 'apply') {
        const v = library.getVersion(Number(r[3]));
        if (!v) return send(res, 404, layout('Introuvable', '<h1>Version introuvable</h1>', user));
        return page('Appliquer un design', applyDesignPage(ed, library.getTemplate(v.template_id), v, studio.listAssets(ed.id)));
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
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
    if ((r = path.match(/^\/edition\/(\d+)\/campaigns(?:\/(meta|new|(\d+)(?:\/(meta|brief|adset|ad|link|result)|\/adset\/(\d+)\/(meta|brief))?))?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const back = (m, cid) => redirect(res, `/edition/${ed.id}/campaigns${cid ? '/' + cid : ''}?m=${encodeURIComponent(m)}`);
      if (req.method === 'GET' && !r[2]) {
        const list = campaigns.listCampaigns(ed.id);
        const counts = Object.fromEntries(list.map((x) => [x.id, { variants: variants.listVariants(ed.id, x.id).length, links: campaigns.allLinksOfCampaign(x.id).length }]));
        return page('Campagnes', campaignsPage(ed, { meta: campaigns.getMetaLink(ed.id), campaigns: list, counts }), msgOf());
      }
      if (req.method === 'GET' && r[3] && !r[4] && !r[5]) {
        const camp = campaigns.getCampaign(Number(r[3]));
        if (!camp || camp.project_id !== ed.id) return send(res, 404, layout('Introuvable', '<h1>Campagne introuvable</h1>', user));
        variants.syncProject(ed.id, user.name);
        const adsets = campaigns.listAdsets(camp.id).map((s) => ({ ...s, links: campaigns.linksFor('adset_id', s.id), ads: campaigns.listAds(s.id).map((a) => ({ ...a, links: campaigns.linksFor('ad_id', a.id) })) }));
        return page(camp.name, campaignPage(ed, { camp, adsets, contents: campaigns.listContents(ed.id).filter((x) => x.export_id && x.status !== 'archivé'), campLinks: campaigns.linksFor('campaign_id', camp.id), allLinks: campaigns.allLinksOfCampaign(camp.id), compare: campaigns.compare(camp.id), variants: variants.listVariants(ed.id, camp.id), users: db.listUsers().map((u) => u.name) }), msgOf());
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (r[2] === 'meta') { campaigns.saveMetaLink(ed.id, b); return back('Connexion enregistrée (saisie manuelle).'); }
        if (r[2] === 'new') { const o = campaigns.createCampaign(ed.id, b, user.name); return o.ok ? back('Campagne reliée.', o.id) : back(o.error); }
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
        if (r[4] === 'adset') { const o = campaigns.createAdset(camp.id, b, user.name); return back(o.ok ? 'Ensemble relié.' : o.error, camp.id); }
        if (r[4] === 'ad') { const o = campaigns.createAd(Number(b.adset_id), b, user.name); return back(o.ok ? 'Annonce reliée.' : o.error, camp.id); }
        if (r[4] === 'link') { const o = campaigns.linkContent(Number(b.content_id), { campaign_id: b.campaign_id, adset_id: b.adset_id, ad_id: b.ad_id }, user.name); return back(o.ok ? 'Contenu associé en brouillon (version épinglée).' : o.error, camp.id); }
        if (r[4] === 'result') return back(campaigns.addResult(Number(b.link_id), b, user.name) ? 'Résultats ajoutés.' : 'Association introuvable.', camp.id);
      }
    }

    // ---------- variantes guidées
    if ((r = path.match(/^\/edition\/(\d+)\/variants(?:\/(new)|\/(\d+)(?:\/(update|messages|review|approve-export|approve|restore|export|link|plan|duplicate|archive))?)?$/))) {
      const ed = db.getEdition(Number(r[1]));
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      const camps = campaigns.listCampaigns(ed.id), users = db.listUsers().map((u) => u.name);
      const adsets = camps.flatMap((c) => campaigns.listAdsets(c.id).map((a) => ({ ...a, campaign_name: c.name })));
      const templates = library.listTemplates().map((t) => ({ name: t.name, version: t.last_version, version_id: library.listVersions(t.id)[0]?.id })).filter((t) => t.version_id);
      const newForm = (values = {}, error = '') => page('Nouvelle variante', variantNewPage(ed, { campaigns: camps, adsets, assets: studio.listAssets(ed.id), templates, users, values, error, who: user.name, solo: users.length <= 1, preset: { campaign_id: Number(url.searchParams.get('campaign')) || '', adset_id: Number(url.searchParams.get('adset')) || '', formats: (url.searchParams.get('formats') || '').split(',').filter((k) => studio.POSTER_FORMATS[k]).length ? (url.searchParams.get('formats') || '').split(',').filter((k) => studio.POSTER_FORMATS[k]) : undefined } }));
      if (r[2] === 'new') {
        if (req.method === 'GET') return newForm();
        if (req.method === 'POST') {
          const b = await readBody(req), o = variants.createVariant(ed.id, b, user.name);
          return o.ok ? redirect(res, `/edition/${ed.id}/variants/${o.id}?m=${encodeURIComponent('Variante créée. Ajustez textes et cadrages, puis demandez la relecture.')}`) : newForm(b, o.error);
        }
      }
      if (!r[3] && req.method === 'GET') {
        const filter = Number(url.searchParams.get('campaign')) || '';
        const list = variants.listVariants(ed.id, filter || undefined);
        return page('Variantes', variantsPage(ed, { solo: users.length <= 1, variants: list, campaigns: camps, outputs: Object.fromEntries(list.map((v) => [v.id, variants.outputsOf(v.id)])), filter }), msgOf());
      }
      if (r[3]) {
        const v = variants.getVariant(Number(r[3]));
        if (!v || v.project_id !== ed.id) return send(res, 404, layout('Introuvable', '<h1>Variante introuvable</h1>', user));
        const back = (m) => redirect(res, `/edition/${ed.id}/variants/${v.id}?m=${encodeURIComponent(m)}`);
        if (req.method === 'GET' && !r[4]) {
          const autoAdset = v.adset_id ? adsets.find((a) => a.id === v.adset_id) : null, autoCamp = v.campaign_id ? camps.find((c2) => c2.id === v.campaign_id) : null;
          return page(v.name, variantPage(ed, { solo: users.length <= 1, next: variants.nextStep(v.id), checksList: variants.checks(v.id), autoLabel: autoAdset ? `ensemble « ${autoAdset.name} »` : autoCamp ? `campagne « ${autoCamp.name} »` : '', v, outputs: variants.outputsOf(v.id), versions: variants.listVersions(v.id), pristine: variants.isPristine(v), campaigns: camps, adsets, users, planItems: plan.listItems(ed.id, { variantId: v.id }) }), msgOf());
        }
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (r[4] === 'update') { variants.updateVariant(v.id, b, user.name); return back('Intention enregistrée.'); }
          if (r[4] === 'messages') { variants.updateMessages(v.id, b, user.name); return back('Textes appliqués aux formats.'); }
          if (r[4] === 'review') { const o = variants.requestReview(v.id, user.name); plan.syncVariant(v.id); return back(o.ok ? 'Mise de côté « à relire » : revenez-y avec un regard neuf, puis approuvez.' : o.error); }
          if (r[4] === 'approve-export') {
            const o = await variants.approveAndExport(v.id, user.name, b.note); plan.syncVariant(v.id);
            return back(o.ok ? `Approuvée (v${o.approvedVersion}) et exportée : ` + o.out.map((x) => `${studio.POSTER_FORMATS[x.fmt].ratio} ${x.state}`).join(' · ') + (o.video?.ok ? ' · vidéo en cours' : '') + (o.draft ? ' — exports marqués BROUILLON (fiche non prête ou source provisoire).' : '') : o.error);
          }
          if (r[4] === 'approve') { const o = variants.approve(v.id, user.name, b.note); plan.syncVariant(v.id); return back(o.ok ? `Version ${o.version} approuvée et figée.${o.draft ? ' Les exports seront marqués BROUILLON tant que la fiche n’est pas prête ou que les sources sont provisoires.' : ''}` : o.error); }
          if (r[4] === 'restore') { const o = variants.restoreApproved(v.id, Number(b.version), user.name); return back(o.ok ? `Retour à la version approuvée v${b.version}.` : o.error); }
          if (r[4] === 'export') {
            const o = await variants.exportApproved(v.id, user.name); plan.syncVariant(v.id);
            return back(o.ok ? 'Export de la version approuvée : ' + o.out.map((x) => `${studio.POSTER_FORMATS[x.fmt].ratio} ${x.state}`).join(' · ') + (o.video?.ok ? ' · vidéo : ' + o.video.out.map(([f, s]) => `${studio.POSTER_FORMATS[f].ratio} ${s}`).join(', ') : '') : o.error);
          }
          if (r[4] === 'link') {
            const [field, val] = b.target === 'auto' ? (v.adset_id ? ['adset_id', String(v.adset_id)] : v.campaign_id ? ['campaign_id', String(v.campaign_id)] : ['', '']) : String(b.target || '').split(':');
            if (!['campaign_id', 'adset_id', 'ad_id'].includes(field)) return back('Choisissez le niveau de la campagne (ou renseignez la campagne de la variante).');
            const o = variants.linkOutputs(v.id, { [field]: val }, user.name); plan.syncVariant(v.id);
            return back(`${o.ok} sortie(s) associée(s) en brouillon (version épinglée).${o.skipped.length ? ' Ignorées : ' + o.skipped.join(' ; ') : ''}`);
          }
          if (r[4] === 'plan') { const o = plan.planVariant(v.id, b.publish, user.name); return back(o.ok ? 'Variante planifiée à rebours : voir le calendrier.' : o.error); }
          if (r[4] === 'duplicate') { const o = variants.duplicateVariant(v.id, b, user.name); return o.ok ? redirect(res, `/edition/${ed.id}/variants/${o.id}?m=${encodeURIComponent('Variante dupliquée.')}`) : back(o.error); }
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
        const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : plan.today().slice(0, 7);
        const campaignFilter = Number(url.searchParams.get('campaign')) || '';
        const grid = plan.monthGrid(month), from = grid[0][0].date, to = grid[grid.length - 1][6].date;
        return page('Calendrier', calendarPage(ed, { month, items: plan.listItems(ed.id, { from, to, campaignId: campaignFilter || undefined }), campaigns: campaigns.listCampaigns(ed.id), variants: variants.listVariants(ed.id), users: db.listUsers().map((u) => u.name), solo: db.listUsers().length <= 1, todo: todo.nextActions(ed.id), campaignFilter }), msgOf());
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

    const m = path.match(/^\/edition\/(\d+)(?:\/(save|duplicate|restore\/(\d+)))?$/);
    if (m) {
      const id = Number(m[1]);
      const ed = db.getEdition(id);
      if (!ed) return send(res, 404, layout('Introuvable', '<h1>Projet introuvable</h1>', user));
      if (!m[2] && req.method === 'GET') return page(ed.label, editionPage(ed, fieldsBySection(), db.listVersions(id), todoCard(todo.nextActions(id))), url.searchParams.get('m'));
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
        return redirect(res, `/edition/${id}?m=${encodeURIComponent('Enregistré.')}`);
      }
      if (m[2] === 'duplicate') return redirect(res, `/edition/${db.duplicateEdition(id, b.label.trim(), user.name)}?m=${encodeURIComponent('Copie du projet créée en brouillon.')}`);
      if (m[3]) { db.restoreVersion(id, Number(m[3]), user.name); return redirect(res, `/edition/${id}?m=${encodeURIComponent('Version restaurée.')}`); }
    }

    if (path === '/settings' && req.method === 'GET') return page('Réglages', settingsPage(db.listUsers(), lastBackup, url.searchParams.get('m')) + backupCard({ status: backup.backupStatus(), backups: backup.listBackups(), report: url.searchParams.get('check') ? backup.integrity() : null, deps: url.searchParams.get('check') ? backup.dependencies() : null }));
    if (path.startsWith('/settings/') && req.method === 'POST') {
      const b = await readBody(req);
      let msg = '';
      if (path === '/settings/secret' && SECRET_DEFS.some((d) => d.key === b.key)) {
        if (b.clear) { clearSecret(b.key); db.log(user.name, `Réglage effacé : ${b.key}`); msg = 'Effacé.'; }
        else if (setSecret(b.key, (b.value || '').trim())) { db.log(user.name, `Réglage enregistré : ${b.key}`); msg = 'Enregistré.'; }
        else msg = 'Valeur vide : rien changé.';
      } else if (path === '/settings/user' && db.listUsers().length < 2 && (b.password || '').length >= 10 && b.name?.trim()) {
        try { db.createUser(b.name.trim(), b.password); db.log(user.name, `Utilisateur ajouté : ${b.name.trim()}`); msg = 'Utilisateur ajouté.'; } catch { msg = 'Ce nom existe déjà.'; }
      } else if (path === '/settings/backup') { lastBackup = db.backup(); msg = 'Sauvegarde effectuée.'; }
      return redirect(res, `/settings?m=${encodeURIComponent(msg)}`);
    }

    send(res, 404, layout('Introuvable', '<h1>Page introuvable</h1>', user));
  } catch (e) {
    console.error(e);
    send(res, 500, layout('Erreur', '<h1>Une erreur est survenue</h1><p>Rien n’a été perdu : vos versions sont conservées. Prévenez le développeur.</p>'));
  }
});

backup.startAutoBackup();
server.listen(PORT, HOST, () => console.log(`Atelier prêt : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
