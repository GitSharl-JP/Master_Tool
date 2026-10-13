// Import du rapport exporté d'Ads Manager (CSV ou tableau copié) : les chiffres sont rattachés aux publicités par leur NOM, sans ressaisie.
// Tolérant : séparateur « ; », « , » ou tabulation, nombres à la française (1 234,56) ou à l'anglaise, colonnes en français ou en anglais.
// Rien n'est enregistré à l'analyse : l'utilisateur voit un aperçu, puis confirme. Un même rapport importé deux fois ne crée pas de doublon.
import { db } from './db.js';
import { addResult, allLinksOfCampaign, listAdsets, listAds } from './campaigns.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// colonnes reconnues : [clé, libellés exacts (repliés), préfixes]
const COLS = [
  ['name', ['nom de la publicite', 'nom de l annonce', 'nom de la pub', 'ad name'], []],
  ['impressions', ['impressions', 'affichages'], []],
  ['linkClicks', ['clics sur un lien', 'clics sur le lien', 'link clicks'], []],
  ['allClicks', ['clics tous', 'clics', 'clicks all', 'clicks'], []],
  ['spend', [], ['montant depense', 'amount spent', 'depense']],
  ['conversions', ['resultats', 'results'], []],
  ['start', ['debut des rapports', 'reporting starts', 'jour', 'day'], []],
  ['end', ['fin des rapports', 'reporting ends'], []],
];

function detectDelimiter(line) {
  const n = (c) => (line.match(new RegExp(c === '\t' ? '\\t' : '\\' + c, 'g')) || []).length;
  return [['\t', n('\t')], [';', n(';')], [',', n(',')]].sort((a, b) => b[1] - a[1])[0][0];
}
function parseCsv(text, delim) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
export function parseNumber(v) {
  let s = String(v ?? '').replace(/[\u00a0\u202f ]/g, '').replace(/[^\d.,-]/g, '');
  if (s === '' || s === '-') return null;
  const hasC = s.includes(','), hasD = s.includes('.');
  if (hasC && hasD) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (hasC) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  else if (hasD && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Publicités de la campagne, retrouvées par nom (ou identifiant Meta) ; l'association visée est celle déjà transmise / publiée, sinon l'unique.
function adIndex(campaignId) {
  const links = allLinksOfCampaign(campaignId), idx = new Map();
  for (const s of listAdsets(campaignId)) for (const a of listAds(s.id)) {
    const own = links.filter((l) => l.ad_id === a.id);
    idx.set(fold(a.name), { label: `${s.name} › ${a.name}`, links: own });
    if (a.meta_id) idx.set(fold(a.meta_id), { label: `${s.name} › ${a.name}`, links: own });
  }
  return idx;
}
const exists = (linkId, r) => !!db.prepare('SELECT 1 FROM results WHERE link_id=? AND period=? AND impressions=? AND clicks=? AND ABS(spend-?)<0.005 AND conversions=?').get(linkId, r.period, r.impressions, r.clicks, r.spend, r.conversions);

export function previewImport(campaignId, raw) {
  const text = String(raw || '').replace(/^﻿/, '');
  if (!text.trim()) return { raw: text, error: 'Collez le contenu du rapport ou choisissez un fichier .csv.' };
  const delim = detectDelimiter(text.split(/\r?\n/).find((l) => l.trim()) || '');
  const table = parseCsv(text, delim);
  if (table.length < 2) return { raw: text, error: 'Le rapport doit contenir une ligne d’en-têtes puis au moins une ligne de données.' };
  const head = table[0].map(fold), at = {}, mapped = [];
  head.forEach((h, i) => {
    for (const [key, exact, pre] of COLS) { if (at[key] !== undefined) continue; if (exact.includes(h) || pre.some((p) => h.startsWith(p))) { at[key] = i; mapped.push(table[0][i].trim()); break; } }
  });
  const unmapped = table[0].filter((h, i) => !Object.values(at).includes(i)).map((h) => h.trim()).filter(Boolean);
  if (at.name === undefined) return { raw: text, error: 'Colonne « Nom de la publicité » introuvable : dans Ads Manager, exportez depuis l’onglet Publicités (pas Campagnes ni Ensembles).' };
  const clicksAt = at.linkClicks ?? at.allClicks, idx = adIndex(campaignId);
  const rows = [];
  for (const cells of table.slice(1)) {
    const name = (cells[at.name] || '').trim();
    if (!name || /^(total|résultats de|results from)/i.test(name)) continue;
    const g = (k) => (at[k] === undefined ? null : parseNumber(cells[at[k]]));
    const start = at.start === undefined ? '' : (cells[at.start] || '').trim(), end = at.end === undefined ? '' : (cells[at.end] || '').trim();
    const r = { name, impressions: g('impressions') ?? 0, clicks: clicksAt === undefined ? 0 : parseNumber(cells[clicksAt]) ?? 0, spend: g('spend') ?? 0, conversions: g('conversions') ?? 0, period: start && end && start !== end ? `${start} → ${end}` : start || end };
    const hit = idx.get(fold(name));
    if (!hit) { r.skip = 'publicité inconnue'; rows.push(r); continue; }
    r.target = hit.label;
    const live = hit.links.filter((l) => ['transmis', 'publié'].includes(l.state)), pick = live.length === 1 ? live : hit.links.length === 1 ? hit.links : [];
    if (!pick.length) r.skip = hit.links.length ? 'plusieurs contenus associés : saisie manuelle' : 'aucun contenu associé à cette publicité';
    else { r.linkId = pick[0].id; if (exists(r.linkId, r)) r.skip = 'déjà enregistré'; }
    rows.push(r);
  }
  if (!rows.length) return { raw: text, error: 'Aucune ligne de données exploitable.' };
  return { raw: text, mapped, unmapped, rows };
}

export function applyImport(campaignId, rows, who) {
  const ok = new Set(allLinksOfCampaign(campaignId).map((l) => l.id));
  let n = 0, dup = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!ok.has(Number(r.linkId))) continue;
    const row = { period: String(r.period || '').slice(0, 60), impressions: Math.round(Number(r.impressions) || 0), clicks: Math.round(Number(r.clicks) || 0), spend: Number(r.spend) || 0, conversions: Math.round(Number(r.conversions) || 0) };
    if (exists(Number(r.linkId), row)) { dup++; continue; }
    addResult(Number(r.linkId), { ...row, source: 'import' }, who);
    n++;
  }
  return { added: n, duplicates: dup };
}
