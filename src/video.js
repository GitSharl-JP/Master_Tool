// Vidéo : réglages, sous-titres éditables et exports (tâches ffmpeg suivies, reprenables sans doublon).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { db, log, DATA_DIR, getEdition } from './db.js';
import { FFMPEG, probe, reframe, parseSubtitles, toAss } from './media.js';
import { getAsset, assetPath, getDesign, buildPosterHtml, htmlToPng, EXPORT_PATH, fireDesignSaved } from './studio.js';
import { FORMATS, VIDEO_FORMATS } from './formats.js';
import { publishBlockers } from './schema.js';

db.exec(`
CREATE TABLE IF NOT EXISTS subtitles(edition_id INTEGER PRIMARY KEY, json TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subtitles2(edition_id INTEGER NOT NULL, scope TEXT NOT NULL DEFAULT '', json TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL, PRIMARY KEY(edition_id, scope));
INSERT OR IGNORE INTO subtitles2(edition_id,scope,json,source,updated) SELECT edition_id,'',json,source,updated FROM subtitles;
CREATE TABLE IF NOT EXISTS jobs(
  id INTEGER PRIMARY KEY, edition_id INTEGER NOT NULL, kind TEXT NOT NULL, fmt TEXT NOT NULL, key TEXT NOT NULL,
  params TEXT NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '',
  export_id INTEGER, created TEXT NOT NULL, updated TEXT NOT NULL, created_by TEXT NOT NULL);
`);
for (const c of ['variant_id INTEGER', 'variant_version INTEGER']) {
  if (!db.prepare('PRAGMA table_info(jobs)').all().some((x) => x.name === c.split(' ')[0])) db.exec(`ALTER TABLE jobs ADD COLUMN ${c}`);
}
// Un redémarrage interrompt les exports en cours : ils passent en erreur et sont relançables.
db.prepare("UPDATE jobs SET status='error', message='Interrompu (l’atelier a été redémarré). Relancez l’export.' WHERE status IN ('queued','running')").run();

const now = () => new Date().toISOString();
const TMP = DATA_DIR + 'tmp/';
mkdirSync(TMP, { recursive: true });

// --- réglages
export const VIDEO_DEFAULTS = {
  asset: '', start: 0, end: 0,
  logo: { asset: '', corner: 'tr', size: 14, margin: 4 },
  endcard: { on: true, seconds: 3 },
  subs: { on: true, size: 100 },
  reframe: {}, formats: ['9x16', '4x5', '1x1', '16x9'],
};
const vkey = (scope) => (scope ? `video_${scope}` : 'video');
export const getVideoDesign = (editionId, scope = '') => {
  const r = db.prepare('SELECT json FROM designs WHERE edition_id=? AND key=?').get(editionId, vkey(scope));
  const s = r ? JSON.parse(r.json) : {};
  return { ...VIDEO_DEFAULTS, ...s, logo: { ...VIDEO_DEFAULTS.logo, ...s.logo }, endcard: { ...VIDEO_DEFAULTS.endcard, ...s.endcard }, subs: { ...VIDEO_DEFAULTS.subs, ...s.subs } };
};
export function saveVideoDesign(editionId, raw, scope = '', who = '') {
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  let i = raw;
  if (typeof raw === 'string') { try { i = JSON.parse(raw); } catch { i = {}; } }
  const own = (id, kinds) => { const a = id ? getAsset(Number(id)) : null; return a && a.edition_id === editionId && kinds.includes(a.kind) ? String(a.id) : ''; };
  const rf = {};
  for (const fmt of VIDEO_FORMATS) {
    const r = i.reframe?.[fmt];
    if (r) rf[fmt] = { posx: num(r.posx, 0, 100, 50), posy: num(r.posy, 0, 100, 50), zoom: num(r.zoom, 100, 300, 100) };
  }
  const d = {
    asset: own(i.asset, ['video']), start: num(i.start, 0, 86400, 0), end: num(i.end, 0, 86400, 0),
    logo: { asset: own(i.logo?.asset, ['image']), corner: ['tl', 'tr', 'bl', 'br'].includes(i.logo?.corner) ? i.logo.corner : 'tr', size: num(i.logo?.size, 5, 40, 14), margin: num(i.logo?.margin, 0, 15, 4) },
    endcard: { on: i.endcard?.on === true || i.endcard?.on === '1', seconds: num(i.endcard?.seconds, 1, 10, 3) },
    subs: { on: i.subs?.on === true || i.subs?.on === '1', size: num(i.subs?.size, 60, 160, 100) },
    reframe: rf, formats: (i.formats || []).filter((f) => VIDEO_FORMATS.includes(f)),
  };
  db.prepare('INSERT INTO designs VALUES(?,?,?,?) ON CONFLICT(edition_id,key) DO UPDATE SET json=excluded.json, updated=excluded.updated').run(editionId, vkey(scope), JSON.stringify(d), now());
  fireDesignSaved(editionId, vkey(scope), who);
  return d;
}

// --- sous-titres
export const getCues = (editionId, scope = '') => {
  const r = db.prepare('SELECT json, source FROM subtitles2 WHERE edition_id=? AND scope=?').get(editionId, scope);
  return r ? { cues: JSON.parse(r.json), source: r.source } : { cues: [], source: '' };
};
export function saveCues(editionId, raw, who, source, scope = '') {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { list = []; } }
  const cues = (Array.isArray(list) ? list : []).slice(0, 3000)
    .map((c) => ({ start: Math.max(0, Number(c.start) || 0), end: Math.max(0, Number(c.end) || 0), text: String(c.text || '').slice(0, 500).trim() }))
    .filter((c) => c.text && c.end > c.start).sort((a, b) => a.start - b.start);
  const prev = getCues(editionId, scope);
  const same = JSON.stringify(prev.cues) === JSON.stringify(cues);
  db.prepare('INSERT INTO subtitles2 VALUES(?,?,?,?,?) ON CONFLICT(edition_id,scope) DO UPDATE SET json=excluded.json, source=excluded.source, updated=excluded.updated')
    .run(editionId, scope, JSON.stringify(cues), source ?? prev.source, now());
  if (!same) { log(who, `Sous-titres enregistrés (${cues.length} lignes)${scope ? ' — variante' : ''}`); fireDesignSaved(editionId, scope ? `cues_${scope}` : 'cues', who); }
  return cues;
}
export function importCues(editionId, assetId, who, scope = '') {
  const a = getAsset(Number(assetId));
  if (!a || a.edition_id !== editionId || a.kind !== 'text') return { ok: false, error: 'Choisissez un fichier de sous-titres (SRT ou VTT).' };
  const cues = parseSubtitles(readFileSync(assetPath(a), 'utf8'));
  if (!cues.length) return { ok: false, error: 'Aucun sous-titre lisible dans ce fichier.' };
  saveCues(editionId, cues, who, a.name, scope);
  return { ok: true, count: cues.length };
}

// --- tâches d'export
export const listJobs = (editionId) => db.prepare('SELECT j.id,j.fmt,j.status,j.progress,j.message,j.export_id,j.created,j.updated,j.created_by,e.draft FROM jobs j LEFT JOIN exports e ON e.id=j.export_id WHERE j.edition_id=? ORDER BY j.id DESC LIMIT 30').all(editionId);

function jobKey(ed, fmt, d, cues, ctx = {}) {
  const src = getAsset(Number(d.asset)), logo = d.logo.asset ? getAsset(Number(d.logo.asset)) : null;
  return createHash('sha1').update(JSON.stringify({
    e: ed.id, fmt, d, srcFile: src && [src.stored, src.size], logo: logo && logo.stored, edUpdated: ed.updated,
    cues: d.subs.on ? cues : null, poster: d.endcard.on ? (ctx.posterDesigns?.[fmt] || getDesign(ed.id, `poster_${fmt}`)) : null,
    draft: ctx.draft ?? publishBlockers(ed).length > 0, variant: ctx.variant ? [ctx.variant.id, ctx.variant.version] : null,
  })).digest('hex');
}

// Crée (ou relance) un export par format. Même réglages = même clé : pas de doublon, pas de relance inutile.
// opts.scope : portée (variante) ; opts.state : { design, cues, fiche, posterDesigns, draft, variant:{id,version} } = état approuvé figé.
export function planExports(ed, who, opts = {}) {
  const st = opts.state;
  const d = st ? st.design : getVideoDesign(ed.id, opts.scope || ''), cues = st ? st.cues : getCues(ed.id, opts.scope || '').cues;
  if (!d.asset) return { ok: false, error: 'Choisissez d’abord une vidéo source.' };
  if (!d.formats.length) return { ok: false, error: 'Cochez au moins un format.' };
  const out = [];
  for (const fmt of d.formats) {
    const ctx = st ? { draft: st.draft, variant: st.variant, posterDesigns: st.posterDesigns } : {};
    const key = jobKey(st ? { ...ed, data: st.fiche, updated: 'v' + st.variant.version } : ed, fmt, d, cues, ctx);
    const same = db.prepare('SELECT * FROM jobs WHERE edition_id=? AND key=? ORDER BY id DESC LIMIT 1').get(ed.id, key);
    const fileOk = same?.export_id && existsSync(EXPORT_PATH + db.prepare('SELECT file FROM exports WHERE id=?').get(same.export_id)?.file);
    if (same && ['queued', 'running'].includes(same.status)) { out.push([fmt, 'déjà en cours']); continue; }
    if (same && same.status === 'done' && fileOk) { out.push([fmt, 'déjà produit (réutilisé)']); continue; }
    const params = JSON.stringify({ design: d, cues, state: st ? { fiche: st.fiche, posterDesigns: st.posterDesigns, draft: st.draft, variant: st.variant } : null });
    let id;
    if (same) { // échec ou fichier disparu : on reprend la même tâche
      id = same.id;
      db.prepare("UPDATE jobs SET status='queued', progress=0, message='', params=?, updated=? WHERE id=?").run(params, now(), id);
    } else {
      id = Number(db.prepare('INSERT INTO jobs(edition_id,kind,fmt,key,params,status,created,updated,created_by,variant_id,variant_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(ed.id, 'video', fmt, key, params, 'queued', now(), now(), who, st?.variant.id ?? null, st?.variant.version ?? null).lastInsertRowid);
    }
    queue.push(id);
    out.push([fmt, same ? 'relancé' : 'lancé']);
  }
  pump();
  return { ok: true, out };
}

const queue = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const id = queue.shift();
    try { await runJob(id); } catch (e) { fail(id, 'Erreur inattendue : ' + e.message); }
  }
  busy = false;
}
const setJob = (id, patch) => {
  const keys = Object.keys(patch);
  db.prepare(`UPDATE jobs SET ${keys.map((k) => k + '=?').join(',')}, updated=? WHERE id=?`).run(...keys.map((k) => patch[k]), now(), id);
};
const fail = (id, message) => setJob(id, { status: 'error', message });

async function runJob(id) {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  const ed0 = getEdition(job.edition_id);
  const { design: d, cues, state } = JSON.parse(job.params);
  const ed = state ? { ...ed0, data: state.fiche } : ed0; // version approuvée : la fiche figée au moment de l'approbation
  const fmt = job.fmt, f = FORMATS[fmt];
  setJob(id, { status: 'running', progress: 0, message: 'Préparation…' });

  const src = getAsset(Number(d.asset));
  if (!src) return fail(id, 'La vidéo source n’existe plus dans la bibliothèque.');
  const file = assetPath(src);
  const info = probe(file);
  if (!info) return fail(id, 'Vidéo illisible (fichier abîmé ou format non pris en charge).');
  const start = Math.min(d.start, Math.max(0, info.duration - 0.5));
  const end = Math.min(d.end > start ? d.end : info.duration, info.duration);
  const dur = end - start;
  if (dur < 0.3) return fail(id, 'Extrait trop court : vérifiez début et fin.');

  const tmp = TMP + 'job' + id + '/';
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const blockers = state ? (state.draft ? ['figé'] : []) : publishBlockers(ed0);
  const draft = state ? state.draft : blockers.length > 0 || src.provisional === 1;

  // écran de fin = l'affiche de ce format (même direction artistique)
  const endSecs = d.endcard.on ? d.endcard.seconds : 0;
  if (endSecs) {
    setJob(id, { message: 'Création de l’écran de fin…' });
    const ok = await htmlToPng(buildPosterHtml(ed, fmt, blockers, { design: state?.posterDesigns?.[fmt] }).html, fmt, tmp + 'end.png');
    if (!ok) return fail(id, 'Impossible de créer l’écran de fin (Edge ou Chrome introuvable ?).');
  }
  // sous-titres recalés sur l'extrait, avec les marges propres à ce format
  let ass = false;
  if (d.subs.on && cues.length) {
    const txt = toAss(cues, { W: f.w, H: f.h, fontSize: Math.round(f.w * 0.045 * d.subs.size / 100), marginV: f.safe.bottom + Math.round(f.h * 0.02), marginSide: f.safe.side, from: start, to: end });
    if (txt.includes('Dialogue:')) { writeFileSync(tmp + 'subs.ass', txt); ass = true; }
  }
  const logoAsset = d.logo.asset ? getAsset(Number(d.logo.asset)) : null;

  // --- commande
  const args = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-ss', String(start), '-t', String(dur), '-i', file.replace(/\\/g, '/')];
  let n = 1;
  const idx = {};
  if (logoAsset) { args.push('-i', assetPath(logoAsset).replace(/\\/g, '/')); idx.logo = n++; }
  if (endSecs) { args.push('-loop', '1', '-framerate', '30', '-t', String(endSecs), '-i', 'end.png'); idx.end = n++; }
  args.push('-f', 'lavfi', '-t', String(endSecs || 1), '-i', 'anullsrc=r=48000:cl=stereo'); idx.sil = n++;
  if (!info.hasAudio) { args.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=48000:cl=stereo'); idx.sil0 = n++; }

  const box = reframe(info.w, info.h, f.w, f.h, d.reframe[fmt]);
  const fg = [`[0:v]scale=${box.iw}:${box.ih}:flags=lanczos,crop=${f.w}:${f.h}:${box.x}:${box.y},setsar=1,fps=30,format=yuv420p[v0]`];
  let cur = 'v0';
  if (logoAsset) {
    const lw = Math.round(f.w * d.logo.size / 100), m = Math.round(f.w * d.logo.margin / 100);
    const c = d.logo.corner;
    const x = c.endsWith('l') ? m : `W-overlay_w-${m}`;
    const y = c.startsWith('t') ? Math.max(m, f.safe.top) : `H-overlay_h-${Math.max(m, f.safe.bottom)}`;
    fg.push(`[${idx.logo}:v]scale=${lw}:-1,format=rgba[lg]`, `[${cur}][lg]overlay=${x}:${y}:format=auto[v1]`);
    cur = 'v1';
  }
  if (ass) { fg.push(`[${cur}]ass=subs.ass:fontsdir='C\\:/Windows/Fonts'[v2]`); cur = 'v2'; }
  if (draft) {
    fg.push(`[${cur}]drawbox=x=0:y=0:w=iw:h=${Math.round(f.h * 0.028)}:color=0xb3261e@1:t=fill,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='DRAFT - NOT FOR PUBLICATION':fontcolor=white:fontsize=${Math.round(f.h * 0.017)}:x=(w-text_w)/2:y=${Math.round(f.h * 0.0045)}[v3]`);
    cur = 'v3';
  }
  const aMain = info.hasAudio ? '[0:a]' : `[${idx.sil0}:a]`;
  fg.push(`${aMain}aresample=48000,aformat=channel_layouts=stereo,atrim=0:${dur},asetpts=N/SR/TB[a0]`);
  if (endSecs) {
    fg.push(`[${idx.end}:v]scale=${f.w}:${f.h},setsar=1,fps=30,format=yuv420p[ev]`, `[${idx.sil}:a]aformat=channel_layouts=stereo,atrim=0:${endSecs},asetpts=N/SR/TB[ea]`,
      `[${cur}][a0][ev][ea]concat=n=2:v=1:a=1[vout][aout]`);
  } else fg.push(`[${cur}]null[vout]`, '[a0]anull[aout]');
  writeFileSync(tmp + 'graph.txt', fg.join(';\n'));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `video-${ed.id}-${fmt}-${stamp}${draft ? '-DRAFT' : ''}.mp4`;
  args.push('-/filter_complex', 'graph.txt', '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', EXPORT_PATH + base);

  const total = dur + endSecs;
  setJob(id, { message: 'Encodage…' });
  const code = await new Promise((resolve) => {
    const p = spawn(FFMPEG, args, { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (c) => { err = (err + c).slice(-4000); });
    let buf = '';
    p.stdout.on('data', (c) => {
      buf += c;
      const m = [...buf.matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop();
      if (m) setJob(id, { progress: Math.min(0.99, Number(m[1]) / 1e6 / total) });
      buf = buf.slice(-400);
    });
    p.on('close', (c) => resolve({ c, err }));
    p.on('error', (e) => resolve({ c: -1, err: e.message }));
  });
  const outFile = EXPORT_PATH + base;
  if (code.c !== 0 || !existsSync(outFile) || statSync(outFile).size < 1000) {
    const tail = code.err.split('\n').filter((l) => l.trim()).slice(-3).join(' | ').slice(0, 400);
    rmSync(outFile, { force: true });
    return fail(id, `L’export a échoué. ${tail}`);
  }
  const res = db.prepare('INSERT INTO exports(edition_id,kind,label,file,draft,source_ids,created,created_by,variant_id,variant_version,fmt,content_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(ed.id, 'video', `${state ? `Variante v${state.variant.version} — ` : ''}Vidéo ${f.label}`, base, draft ? 1 : 0, JSON.stringify([d.asset, d.logo.asset].filter(Boolean)), now(), job.created_by, state?.variant.id ?? null, state?.variant.version ?? null, fmt, job.key);
  setJob(id, { status: 'done', progress: 1, message: draft ? 'Terminé (BROUILLON : fiche non prête ou source provisoire).' : 'Terminé.', export_id: Number(res.lastInsertRowid) });
  log(job.created_by, `Vidéo exportée (${f.label})${draft ? ' — BROUILLON' : ''}`);
  rmSync(tmp, { recursive: true, force: true });
}
