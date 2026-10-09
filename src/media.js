// Outils média : ffmpeg/ffprobe, sous-titres (SRT/VTT/ASS) et calcul du cadrage.
// ffmpeg est cherché dans tools/ffmpeg/ (installation portable du projet), sinon dans le PATH, sinon via ATELIER_FFMPEG.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const LOCAL = decodeURIComponent(new URL('../tools/ffmpeg/', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const pick = (name) => process.env['ATELIER_' + name.toUpperCase()] || (existsSync(LOCAL + name + '.exe') ? LOCAL + name + '.exe' : name);
export const FFMPEG = pick('ffmpeg');
export const FFPROBE = pick('ffprobe');
export const ffmpegReady = () => { try { return spawnSync(FFMPEG, ['-version'], { timeout: 10000 }).status === 0; } catch { return false; } };

// { w, h, duration, fps, hasAudio } — w/h tiennent compte de la rotation des vidéos de téléphone.
export function probe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeout: 30000, maxBuffer: 5e6 });
  if (r.status !== 0) return null;
  const j = JSON.parse(r.stdout.toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  if (!v) return null;
  const rot = Math.abs(Number((v.side_data_list || []).find((x) => x.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0)) % 180;
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  return {
    w: rot === 90 ? v.height : v.width, h: rot === 90 ? v.width : v.height,
    duration: Number(j.format.duration) || Number(v.duration) || 0,
    fps: d ? Math.round((n / d) * 100) / 100 : 30,
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

// Fenêtre de recadrage d'une source (sw × sh) vers un format (W × H). Même formule dans l'aperçu et dans l'export.
export function reframe(sw, sh, W, H, r = {}) {
  const z = (Number(r.zoom) || 100) / 100;
  const s = Math.max(W / sw, H / sh) * z;
  const iw = Math.max(W, Math.round(sw * s)), ih = Math.max(H, Math.round(sh * s));
  const px = Number(r.posx ?? 50), py = Number(r.posy ?? 50);
  return { iw, ih, x: Math.round((iw - W) * px / 100), y: Math.round((ih - H) * py / 100) };
}

// --- sous-titres
const toSec = (t) => { const m = /^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$/.exec(t.trim()); return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000 : NaN; };
// SRT et VTT → [{ start, end, text }] (secondes)
export function parseSubtitles(src) {
  const blocks = String(src).replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/);
  const cues = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->').map((x) => x.trim().split(/\s+/)[0]);
    const start = toSec(a), end = toSec(z);
    const text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && text) cues.push({ start, end, text });
  }
  return cues.sort((p, q) => p.start - q.start);
}
const pad = (n, l = 2) => String(n).padStart(l, '0');
export function fmtTime(t, sep = ',') { const ms = Math.round(t * 1000); return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`; }
export const toSrt = (cues) => cues.map((c, i) => `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c.text}\n`).join('\n');

// ASS pour l'incrustation : taille et marges calculées pour CHAQUE format (zones de sécurité Stories / TikTok).
export function toAss(cues, { W, H, fontSize, marginV, marginSide, from, to }) {
  const ts = (t) => `${Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(Math.floor(t) % 60)}.${pad(Math.floor((t % 1) * 100))}`;
  const ev = cues
    .filter((c) => c.end > from && c.start < to)
    .map((c) => {
      const s = Math.max(0, c.start - from), e = Math.min(to - from, c.end - from);
      const txt = c.text.replace(/[{}]/g, '').replace(/\n/g, '\\N');
      return `Dialogue: 0,${ts(s)},${ts(e)},Default,,0,0,0,,${txt}`;
    });
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(fontSize / 14))},1,2,${marginSide},${marginSide},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`;
}
