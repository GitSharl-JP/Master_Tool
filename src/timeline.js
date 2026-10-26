// Montage à timeline : des clips mis bout à bout + des éléments (logo, image, texte, sous-titres) posés par-dessus.
// Chaque élément a la même fiche : position X/Y (centre, en px, par format), échelle, rotation, opacité, début/fin.
// Ce module contient le modèle (nettoyage, conversion de l'ancien format) et la construction de la commande ffmpeg.
import { writeFileSync } from 'node:fs';
import { FORMATS, VIDEO_FORMATS } from './formats.js';
import { probe, reframe, toAss } from './media.js';
import { getAsset, assetPath, renderTextBox } from './studio.js';
import { aspectOf } from './intake.js';
import { FONTS } from './render.js';
import { ASS_FONTSDIR, DRAFT_FONT } from './platform.js';

export const EL_TYPES = ['logo', 'image', 'text', 'subs', 'video'];
// Taille de base à 100 % : largeur de l'image = 20 % de la largeur du format ; texte = 6 % ; sous-titres = 4,5 %. (L'aperçu utilise les mêmes valeurs.)
export const BASE = { image: 0.20, text: 0.06, subs: 0.045, video: 1 }; // vidéo superposée : 100 % = toute la largeur du format
export const TEXT_REF_W = 2160; // les textes sont rendus à cette largeur de référence puis réduits : net sur tous les formats
export const DEFAULT_S = { logo: 70, image: 100, text: 100, subs: 100, video: 45 };

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// --- durée et propriétés d'une vidéo source (mises en cache : la lecture coûte un processus)
const infoCache = new Map();
export function infoOf(asset) {
  if (!asset) return null;
  const key = `${asset.stored}|${asset.size}`;
  if (!infoCache.has(key)) infoCache.set(key, probe(assetPath(asset)));
  return infoCache.get(key);
}

// --- nettoyage (tout ce qui vient du navigateur est revalidé)
const cleanPos = (m) => {
  const o = {};
  for (const fmt of VIDEO_FORMATS) {
    const p = m?.[fmt], f = FORMATS[fmt];
    if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) o[fmt] = { x: Math.round(num(p.x, -f.w, 2 * f.w, f.w / 2)), y: Math.round(num(p.y, -f.h, 2 * f.h, f.h / 2)) };
  }
  return o;
};
const cleanReframe = (m) => {
  const o = {};
  for (const fmt of VIDEO_FORMATS) { const r = m?.[fmt]; if (r) o[fmt] = { posx: num(r.posx, 0, 100, 50), posy: num(r.posy, 0, 100, 50), zoom: num(r.zoom, 100, 300, 100) }; }
  return o;
};
const uid = (v, taken, prefix) => {
  let id = /^[A-Za-z0-9_-]{1,14}$/.test(String(v || '')) ? String(v) : '', i = 1;
  while (!id || taken.has(id)) id = prefix + i++;
  taken.add(id);
  return id;
};
// own(id, kinds) : renvoie l'identifiant de l'asset s'il appartient au projet et a le bon type, sinon ''.
export function cleanTl(raw, own) {
  const ids = new Set(), clips = [], els = [];
  for (const c of (Array.isArray(raw?.clips) ? raw.clips : []).slice(0, 60)) {
    const asset = own(c?.asset, ['video']);
    if (!asset) continue;
    clips.push({ id: uid(c.id, ids, 'c'), asset, in: num(c.in, 0, 86400, 0), out: num(c.out, 0, 86400, 0), reframe: cleanReframe(c.reframe) });
  }
  for (const e of (Array.isArray(raw?.els) ? raw.els : []).slice(0, 80)) {
    const type = EL_TYPES.includes(e?.type) ? e.type : null;
    if (!type) continue;
    const asset = type === 'logo' || type === 'image' ? own(e.asset, ['image']) : type === 'video' ? own(e.asset, ['video']) : '';
    if ((type === 'logo' || type === 'image' || type === 'video') && !asset) continue;
    els.push({
      id: uid(e.id, ids, 'e'), type, ...(asset ? { asset } : {}),
      ...(type === 'subs' && Array.isArray(e.cues) ? { cues: cleanCues(e.cues) } : {}),
      ...(type === 'video' ? { in: num(e.in, 0, 86400, 0), out: num(e.out, 0, 86400, 0), vol: num(e.vol, 0, 100, 100) } : {}),
      ...(type === 'text' ? { text: String(e.text ?? '').slice(0, 500), font: FONTS[e.font] ? e.font : '', color: /^#[0-9a-fA-F]{6}$/.test(e.color || '') ? e.color : '#ffffff', bold: e.bold !== false && e.bold !== 0 && e.bold !== '0', outline: e.outline !== false && e.outline !== 0 && e.outline !== '0' } : {}),
      start: num(e.start, 0, 86400, 0), end: type === 'video' ? 0 : num(e.end, 0, 86400, 0), track: Math.round(num(e.track, 1, 40, els.length + 1)),
      fx: num(e.fx, 0, 1, 0.5), fy: num(e.fy, 0, 1, 0.5), pos: cleanPos(e.pos),
      s: num(e.s, 5, 400, DEFAULT_S[type]), rot: num(e.rot, -360, 360, 0), op: num(e.op, 0, 100, 100),
    });
  }
  return { clips, els };
}

// Pistes : un élément est sur une piste (1 = la plus basse, juste au-dessus de la piste principale) ; une piste plus haute est au-dessus.
// Sans numéro (montages plus anciens), chaque élément a sa propre piste, dans l'ordre de la liste : l'empilement ne change pas.
export const trackOf = (e, i) => e.track ?? i + 1;
export const orderEls = (els) => els.map((e, i) => [e, i]).sort((a, b) => trackOf(a[0], a[1]) - trackOf(b[0], b[1]) || a[1] - b[1]).map((x) => x[0]);

// Lignes de sous-titres d'un bloc : temps de la timeline, triées, sans ligne vide ni durée nulle.
export const cleanCues = (list) => (Array.isArray(list) ? list : []).slice(0, 1500)
  .map((c) => ({ start: num(c?.start, 0, 86400, 0), end: num(c?.end, 0, 86400, 0), text: String(c?.text ?? '').slice(0, 500).trim() }))
  .filter((c) => c.text && c.end > c.start).sort((a, b) => a.start - b.start);
// Les montages enregistrés avant que chaque bloc ait ses lignes : le premier bloc reprend les sous-titres communs du projet.
export function resolveSubs(tl, globalCues = []) {
  let first = true;
  return { ...tl, els: tl.els.map((e) => { if (e.type !== 'subs' || e.cues) return e; const c = first ? cleanCues(globalCues) : []; first = false; return { ...e, cues: c }; }) };
}
export const mergedCues = (tl) => tl.els.filter((e) => e.type === 'subs').flatMap((e) => e.cues || []).sort((a, b) => a.start - b.start);

// Position d'un élément dans un format : celle choisie pour ce format, sinon son emplacement d'origine (fractions de l'image).
export const posOf = (e, f, fmt) => e.pos?.[fmt] || { x: Math.round((e.fx ?? 0.5) * f.w), y: Math.round((e.fy ?? 0.5) * f.h) };

// --- ancien format (une vidéo, un logo dans un coin, des sous-titres en bas) -> timeline, avec les mêmes emplacements
export function legacyToTl(d, cues = []) {
  const clips = [], els = [];
  const src = d.asset ? getAsset(Number(d.asset)) : null;
  const info = infoOf(src);
  if (src) clips.push({ id: 'c1', asset: String(src.id), in: Number(d.start) || 0, out: Number(d.end) || 0, reframe: d.reframe || {} });
  const from = Number(d.start) || 0, to = d.end > from ? d.end : info?.duration || 0;
  if (d.logo?.asset) {
    const a = getAsset(Number(d.logo.asset)), asp = aspectOf(a) || 1, pos = {};
    for (const fmt of VIDEO_FORMATS) {
      const f = FORMATS[fmt], p = d.logo.pos?.[fmt];
      if (p) { pos[fmt] = { x: p.x, y: p.y }; continue; }
      const lw = Math.round(f.w * d.logo.size / 100), lh = lw / asp, m = Math.round(f.w * d.logo.margin / 100), c = d.logo.corner || 'tr';
      pos[fmt] = { x: Math.round(c.endsWith('l') ? m + lw / 2 : f.w - m - lw / 2), y: Math.round(c.startsWith('t') ? Math.max(m, f.safe.top) + lh / 2 : f.h - Math.max(m, f.safe.bottom) - lh / 2) };
    }
    els.push({ id: 'e1', type: 'logo', track: els.length + 1, asset: String(d.logo.asset), start: 0, end: 0, fx: 0.8, fy: 0.1, pos, s: Math.round(d.logo.size * 100 / (BASE.image * 100)), rot: 0, op: 100 });
  }
  if (d.subs?.on && cues.length) { // sous-titres activés mais vides : pas de piste vide à la conversion
    const pos = {};
    for (const fmt of VIDEO_FORMATS) {
      const f = FORMATS[fmt], p = d.subs.pos?.[fmt];
      if (p) { pos[fmt] = { x: p.x, y: p.y }; continue; }
      const fs = Math.round(f.w * BASE.subs * d.subs.size / 100);
      pos[fmt] = { x: Math.round(f.w / 2), y: Math.round(f.h - f.safe.bottom - Math.round(f.h * 0.02) - Math.round(fs * 0.7)) };
    }
    els.push({ id: 'e2', type: 'subs', track: els.length + 1, start: 0, end: 0, fx: 0.5, fy: 0.8, pos, s: d.subs.size, rot: 0, op: 100, cues: [] });
  }
  // les sous-titres de l'ancien format sont en temps de la vidéo source : on les recale sur la timeline (début de l'extrait = 0)
  const shifted = cues.map((c) => ({ start: Math.max(0, c.start - from), end: Math.min(Math.max(0, to - from) || Infinity, c.end - from), text: c.text })).filter((c) => c.end > c.start && c.text);
  const sub = els.find((e) => e.type === 'subs');
  if (sub) sub.cues = shifted;
  return { tl: { clips, els }, cues: shifted };
}

// Résumé de la timeline dans les champs historiques du design (asset, début, fin) : le reste de l'atelier (matériel d'un contenu, kits…) les lit encore.
export const tlSummary = (tl) => ({ asset: tl.clips[0]?.asset || '', start: tl.clips[0]?.in || 0, end: tl.clips[0]?.out || 0 });
export const tlAssetIds = (tl) => [...new Set([...tl.clips.map((c) => c.asset), ...tl.els.map((e) => e.asset).filter(Boolean)])];

// --- rendu du texte libre : un bloc HTML (même rendu que l'aperçu et que les affiches)
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export function fontStack(name) {
  const base = FONTS[name] === 'serif' ? 'Georgia,serif' : 'Segoe UI,Arial,sans-serif';
  return `${FONTS[name] ? `'${name}',` : ''}${base},'Yu Gothic','Meiryo',sans-serif`; // guillemets simples : la liste est placée dans un attribut style="…"
}
export function textBlockHtml(e, W) {
  const fs = W * BASE.text * e.s / 100, pad = Math.ceil(fs * 0.14);
  const stroke = e.outline ? `-webkit-text-stroke:${(fs / 12).toFixed(2)}px #000;paint-order:stroke fill;` : '';
  return `<div style="font:${e.bold ? 700 : 400} ${fs.toFixed(2)}px/1.2 ${fontStack(e.font)};color:${e.color};white-space:pre;text-align:center;padding:${pad}px;${stroke}">${esc(e.text)}</div>`;
}

// --- commande ffmpeg
// Retourne { args (entrées), graph (filtres), total (durée avec écran de fin), sourceIds } ou { error }.
// Les temps des éléments et des sous-titres sont ceux de la timeline (0 = début du premier clip).
export async function buildTlJob({ d, cues, fmt, f, tmp, draft, endSecs }) {
  const clips = [];
  for (const c of d.tl.clips) {
    const a = getAsset(Number(c.asset));
    if (!a) return { error: 'Un clip utilise une vidéo qui n’existe plus dans la bibliothèque.' };
    const info = infoOf(a);
    if (!info) return { error: `Vidéo illisible : « ${a.name} » (fichier abîmé ou format non pris en charge).` };
    const start = Math.min(c.in, Math.max(0, info.duration - 0.5)), end = Math.min(c.out > start ? c.out : info.duration, info.duration);
    if (end - start < 0.3) return { error: `Extrait trop court dans « ${a.name} » : vérifiez début et fin.` };
    clips.push({ c, a, info, start, dur: end - start });
  }
  if (!clips.length) return { error: 'Ajoutez au moins un clip à la timeline.' };
  const total = clips.reduce((s, k) => s + k.dur, 0);
  const args = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y'];
  const fg = [];
  let n = 0;
  clips.forEach((k) => {
    args.push('-ss', String(k.start), '-t', String(k.dur), '-i', assetPath(k.a).replace(/\\/g, '/')); k.v = n++;
    if (!k.info.hasAudio) { args.push('-f', 'lavfi', '-t', String(k.dur), '-i', 'anullsrc=r=48000:cl=stereo'); k.sil = n++; }
  });
  clips.forEach((k, i) => {
    const box = reframe(k.info.w, k.info.h, f.w, f.h, k.c.reframe?.[fmt]);
    fg.push(`[${k.v}:v]scale=${box.iw}:${box.ih}:flags=lanczos,crop=${f.w}:${f.h}:${box.x}:${box.y},setsar=1,fps=30,format=yuv420p[vc${i}]`);
    fg.push(`${k.info.hasAudio ? `[${k.v}:a]` : `[${k.sil}:a]`}aresample=48000,aformat=channel_layouts=stereo,atrim=0:${k.dur},asetpts=N/SR/TB[ac${i}]`);
  });
  fg.push(`${clips.map((_, i) => `[vc${i}][ac${i}]`).join('')}concat=n=${clips.length}:v=1:a=1[vm][am]`);
  let cur = 'vm';

  // éléments, de la piste la plus basse à la plus haute (une piste plus haute est au-dessus ; à égalité, l'ordre de la liste)
  const ordered = orderEls(resolveSubs(d.tl, cues).els);
  let z = 0, si = 0;
  const mixes = []; // sons des vidéos superposées, mélangés à celui des clips
  const win = (e, dur = 0) => { const s0 = Math.max(0, Math.min(e.start, total)); return [s0, e.type === 'video' ? Math.min(total, s0 + dur) : (e.end > 0 ? Math.min(e.end, total) : total)]; };
  for (const e of ordered) {
    if (e.type === 'subs') { // un bloc de sous-titres : positionné par son centre (\an5 + \pos), avec rotation et opacité
      const [s0, e0] = win(e);
      const list = (e.cues || []).map((c) => ({ ...c, start: Math.max(c.start, s0), end: Math.min(c.end, e0) })).filter((c) => c.end > c.start);
      const txt = toAss(list, { W: f.w, H: f.h, fontSize: Math.round(f.w * BASE.subs * e.s / 100), marginV: f.safe.bottom, marginSide: f.safe.side, from: 0, to: total, pos: posOf(e, f, fmt), rot: e.rot, opacity: e.op });
      if (!txt.includes('Dialogue:')) continue;
      writeFileSync(`${tmp}subs${si}.ass`, txt);
      fg.push(`[${cur}]ass=subs${si}.ass${ASS_FONTSDIR}[vs${si}]`); cur = `vs${si}`; si++;
      continue;
    }
    let file, wpx, vs = 0, vdur = 0, vinfo = null;
    if (e.type === 'video') {
      const a = getAsset(Number(e.asset));
      if (!a) continue;
      vinfo = infoOf(a);
      if (!vinfo) return { error: `Vidéo illisible : « ${a.name} » (fichier abîmé ou format non pris en charge).` };
      vs = Math.min(e.in, Math.max(0, vinfo.duration - 0.5)); vdur = Math.min(e.out > vs ? e.out : vinfo.duration, vinfo.duration) - vs;
      if (vdur < 0.1) continue;
      file = assetPath(a); wpx = Math.max(2, Math.round(f.w * BASE.video * e.s / 100));
    }
    const [s0, e0] = win(e, vdur);
    if (e0 - s0 < 0.05) continue;
    if (e.type === 'text') {
      if (!String(e.text || '').trim()) continue;
      const png = `${tmp}t${z}.png`, r = await renderTextBox(textBlockHtml(e, TEXT_REF_W), png);
      if (!r.ok) return { error: 'Impossible de créer un texte (Edge ou Chrome introuvable ?).' };
      file = png; wpx = Math.max(2, Math.round(r.w * f.w / TEXT_REF_W));
    } else if (e.type !== 'video') {
      const a = getAsset(Number(e.asset));
      if (!a) continue;
      file = assetPath(a); wpx = Math.max(2, Math.round(f.w * BASE.image * e.s / 100));
    }
    if (e.type === 'video') args.push('-ss', String(vs), '-t', String(vdur), '-i', file.replace(/\\/g, '/'));
    else args.push('-i', file.replace(/\\/g, '/'));
    const m = n++, p = posOf(e, f, fmt), rad = (e.rot * Math.PI / 180).toFixed(5);
    // une vidéo superposée est recalée sur la timeline (son premier instant arrive à s0) ; une image fixe n'a pas de temps propre
    let ch = e.type === 'video' ? `[${m}:v]setpts=PTS-STARTPTS+${s0}/TB,fps=30,scale=${wpx}:-1:flags=lanczos,format=rgba` : `[${m}:v]scale=${wpx}:-1:flags=lanczos,format=rgba`;
    if (e.rot) ch += `,rotate=${rad}:ow='rotw(${rad})':oh='roth(${rad})':c=none`;
    if (e.op < 100) ch += `,colorchannelmixer=aa=${(e.op / 100).toFixed(3)}`;
    fg.push(`${ch}[el${z}]`, `[${cur}][el${z}]overlay=x='${p.x}-overlay_w/2':y='${p.y}-overlay_h/2':enable='between(t,${s0},${e0})':format=auto[vo${z}]`);
    cur = `vo${z}`;
    if (e.type === 'video' && vinfo.hasAudio && (e.vol ?? 100) > 0) {
      const ms = Math.round(s0 * 1000);
      fg.push(`[${m}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${vdur},asetpts=N/SR/TB,adelay=${ms}|${ms},volume=${((e.vol ?? 100) / 100).toFixed(3)}[ova${z}]`);
      mixes.push(`[ova${z}]`);
    }
    z++;
  }
  let aOut = 'am';
  if (mixes.length) { fg.push(`[am]${mixes.join('')}amix=inputs=${1 + mixes.length}:duration=first:normalize=0[amx]`); aOut = 'amx'; }
  if (draft) {
    fg.push(`[${cur}]drawbox=x=0:y=0:w=iw:h=${Math.round(f.h * 0.028)}:color=0xb3261e@1:t=fill,drawtext=fontfile='${DRAFT_FONT}':text='DRAFT - NOT FOR PUBLICATION':fontcolor=white:fontsize=${Math.round(f.h * 0.017)}:x=(w-text_w)/2:y=${Math.round(f.h * 0.0045)}[vd]`);
    cur = 'vd';
  }
  if (endSecs) {
    args.push('-loop', '1', '-framerate', '30', '-t', String(endSecs), '-i', 'end.png'); const ie = n++;
    args.push('-f', 'lavfi', '-t', String(endSecs), '-i', 'anullsrc=r=48000:cl=stereo'); const is = n++;
    fg.push(`[${ie}:v]scale=${f.w}:${f.h},setsar=1,fps=30,format=yuv420p[ev]`, `[${is}:a]aformat=channel_layouts=stereo,atrim=0:${endSecs},asetpts=N/SR/TB[ea]`,
      `[${cur}][${aOut}][ev][ea]concat=n=2:v=1:a=1[vout][aout]`);
  } else fg.push(`[${cur}]null[vout]`, `[${aOut}]anull[aout]`);
  return { args, graph: fg.join(';\n'), total: total + endSecs, sourceIds: tlAssetIds(d.tl) };
}
