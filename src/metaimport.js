// Import du rapport exporté d'Ads Manager (CSV ou tableau copié) : les chiffres sont rattachés aux publicités sans ressaisie.
// Tolérant : séparateur « ; », « , » ou tabulation, nombres à la française (1 234,56) ou à l'anglaise, colonnes en français ou en anglais.
// Rien n'est enregistré à l'analyse : l'utilisateur voit un aperçu, puis confirme.
// Règles de fiabilité :
//   - rattachement : identifiant Meta de la publicité d'abord, puis nom UNIQUE ; si plusieurs publicités portent le nom, la ligne attend un choix ;
//   - un même rapport importé deux fois ne crée pas de doublon ; un rapport CORRIGÉ (même période, autres chiffres) ou une période qui en croise une autre
//     ne s'additionne jamais : conflit à trancher (remplacer = l'ancienne mesure est mise de côté, pas supprimée) ;
//   - une colonne absente ou une valeur illisible reste « inconnue » (jamais un zéro inventé) ; un nombre ambigu (12.345) demande le format.
import { db } from './db.js';
import { addResult, allLinksOfCampaign, listAdsets, listAds, parseDay, conflictsFor, supersedeResult } from './campaigns.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// colonnes reconnues : [clé, libellés exacts (repliés), préfixes]
const COLS = [
  ['name', ['nom de la publicite', 'nom de l annonce', 'nom de la pub', 'ad name'], []],
  ['adId', ['id de la publicite', 'id de l annonce', 'identifiant de la publicite', 'ad id'], []],
  ['impressions', ['impressions', 'affichages'], []],
  ['linkClicks', ['clics sur un lien', 'clics sur le lien', 'link clicks'], []],
  ['allClicks', ['clics tous', 'clics', 'clicks all', 'clicks'], []],
  ['spend', [], ['montant depense', 'amount spent', 'depense']],
  ['conversions', ['resultats', 'results'], []],
  ['resultType', ['type de resultat', 'indicateur de resultat', 'result type', 'result indicator'], []],
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
const cleanNum = (v) => String(v ?? '').replace(/[   ]/g, '').replace(/[^\d.,-]/g, '');
// « 12.345 » ou « 1,234 » : un seul séparateur suivi d'exactement 3 chiffres = milliers OU décimales, selon la locale du fichier.
export const isAmbiguousNumber = (v) => /^-?\d{1,3}[.,]\d{3}$/.test(cleanNum(v));
// opts.dec : '.' ou ',' = séparateur décimal du fichier (l'autre est celui des milliers) ; absent = déduction usuelle.
export function parseNumber(v, opts = {}) {
  let s = cleanNum(v);
  if (s === '' || s === '-') return null;
  if (opts.dec === '.') s = s.replace(/,/g, '');
  else if (opts.dec === ',') s = s.replace(/\./g, '').replace(',', '.');
  else {
    const hasC = s.includes(','), hasD = s.includes('.');
    if (hasC && hasD) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (hasC) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (hasD && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Publicités de la campagne : par identifiant Meta, et par nom (plusieurs publicités peuvent porter le même nom).
function adIndex(campaignId) {
  const links = allLinksOfCampaign(campaignId), byName = new Map(), byId = new Map();
  for (const s of listAdsets(campaignId)) for (const a of listAds(s.id)) {
    const own = links.filter((l) => l.ad_id === a.id);
    const live = own.filter((l) => ['transmis', 'publié'].includes(l.state)), pick = live.length === 1 ? live : own.length === 1 ? own : [];
    const cand = { adId: a.id, label: `${s.name} › ${a.name}`, linkId: pick[0]?.id || null, none: own.length ? 'plusieurs contenus associés : saisie manuelle' : 'aucun contenu associé à cette publicité' };
    const k = fold(a.name); byName.set(k, [...(byName.get(k) || []), cand]);
    if (a.meta_id) byId.set(String(a.meta_id).trim(), cand);
  }
  return { byName, byId };
}
const sameNumbers = (x, r) => x.impressions === r.impressions && x.clicks === r.clicks && Math.abs(x.spend - r.spend) < 0.005 && x.conversions === r.conversions;
const exists = (linkId, r) => db.prepare('SELECT * FROM results WHERE link_id=? AND period=? AND superseded_by IS NULL').all(linkId, r.period).some((x) => sameNumbers(x, r));
const zero = (v) => (v === null || v === undefined ? 0 : v);

export function previewImport(campaignId, raw, choices = {}, opts = {}) {
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
  const clicksAt = at.linkClicks ?? at.allClicks, clicksKind = at.linkClicks !== undefined ? 'lien' : at.allClicks !== undefined ? 'tous' : '';
  const currency = at.spend === undefined ? '' : ((/\(([A-Za-z]{3})\)\s*$/.exec(table[0][at.spend].trim()) || [])[1] || '').toUpperCase();
  const { byName, byId } = adIndex(campaignId), dec = opts.dec === '.' || opts.dec === ',' ? opts.dec : '';
  const rows = []; let ambiguous = false;
  for (const cells of table.slice(1)) {
    const name = (cells[at.name] || '').trim();
    if (!name || /^(total|résultats de|results from)/i.test(name)) continue;
    const warn = [], missing = [];
    const cell = (k) => (k === undefined ? undefined : cells[k]);
    // null = inconnu (colonne absente, cellule vide) ; erreur signalée si la cellule contient autre chose qu'un nombre
    const num = (k, label) => {
      const c = cell(k);
      if (c === undefined || String(c).trim() === '') { missing.push(label); return null; }
      if (!dec && isAmbiguousNumber(c)) { ambiguous = true; warn.push(`nombre ambigu « ${String(c).trim()} » (${label})`); return null; }
      const v = parseNumber(c, { dec });
      if (v === null) { warn.push(`valeur illisible « ${String(c).trim()} » (${label})`); missing.push(label); }
      return v;
    };
    const start = at.start === undefined ? '' : (cells[at.start] || '').trim(), end = at.end === undefined ? '' : (cells[at.end] || '').trim();
    const from = parseDay(start), to = parseDay(end) || from;
    const r = {
      name, impressions: num(at.impressions, 'affichages'), clicks: num(clicksAt, 'clics'), spend: num(at.spend, 'dépense'), conversions: num(at.conversions, 'résultats'),
      period: start && end && start !== end ? `${start} → ${end}` : start || end, from, to, currency, clicksKind,
      resultType: at.resultType === undefined ? '' : (cells[at.resultType] || '').trim(), missing,
    };
    if (warn.length) r.warn = warn.join(' ; ');
    const idCell = at.adId === undefined ? '' : String(cells[at.adId] || '').trim();
    let cand = null;
    if (idCell && byId.has(idCell)) { cand = byId.get(idCell); r.reason = 'identifiant Meta de la publicité'; }
    else {
      const named = byName.get(fold(name)) || byId.get(name) && [byId.get(name)] || [];
      if (named.length === 1) { cand = named[0]; r.reason = 'nom unique dans la campagne'; }
      else if (named.length > 1) {
        r.choices = named.filter((c) => c.linkId).map((c) => ({ label: c.label, linkId: c.linkId }));
        const chosen = Number(choices[rows.length]);
        const sel = chosen && r.choices.find((c) => c.linkId === chosen);
        if (sel) { cand = named.find((c) => c.linkId === sel.linkId); r.reason = 'choix explicite'; } else {
          r.skip = `plusieurs publicités portent ce nom (${named.map((c) => c.label).join(' · ')}) : choisissez`;
          rows.push(r); continue;
        }
      }
    }
    if (!cand) { r.skip = 'publicité inconnue'; rows.push(r); continue; }
    r.target = cand.label;
    if (!cand.linkId) r.skip = cand.none;
    else {
      r.linkId = cand.linkId;
      const val = { period: r.period, impressions: zero(r.impressions), clicks: zero(r.clicks), spend: zero(r.spend), conversions: zero(r.conversions) };
      if (r.warn) r.skip = /ambigu/.test(r.warn) ? 'nombre ambigu : indiquez le format du fichier' : 'valeur illisible : corrigez le fichier';
      else if (exists(r.linkId, val)) r.skip = 'déjà enregistré';
      else {
        const conf = conflictsFor(r.linkId, from ? { from, to } : null).filter((x) => !sameNumbers(x, val));
        if (conf.length) r.conflict = conf;
      }
    }
    rows.push(r);
  }
  if (!rows.length) return { raw: text, error: 'Aucune ligne de données exploitable.' };
  return { raw: text, mapped, unmapped, rows, ambiguous, dec, currency };
}

// rows : lignes de l'aperçu ; r.replace = remplacer les mesures en conflit (mises de côté) ; r.both = importer en plus (je vérifie).
export function applyImport(campaignId, rows, who) {
  const ok = new Set(allLinksOfCampaign(campaignId).map((l) => l.id));
  const out = { added: 0, duplicates: 0, replaced: 0, conflicts: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!ok.has(Number(r.linkId)) || r.skip) continue;
    const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const vals = { impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend), conversions: num(r.conversions) };
    const row = { period: String(r.period || '').slice(0, 60), impressions: Math.round(zero(vals.impressions)), clicks: Math.round(zero(vals.clicks)), spend: zero(vals.spend), conversions: Math.round(zero(vals.conversions)) };
    const linkId = Number(r.linkId);
    if (exists(linkId, row)) { out.duplicates++; continue; }
    const range = r.from ? { from: String(r.from), to: String(r.to || r.from) } : null;
    const conf = conflictsFor(linkId, range).filter((x) => !sameNumbers(x, row));
    if (conf.length && !r.replace && !r.both) { out.conflicts++; continue; }
    const missing = ['impressions', 'clicks', 'spend', 'conversions'].filter((k) => vals[k] === null).join(',');
    const id = addResult(linkId, { ...row, source: 'import', from: range?.from || '', to: range?.to || '', currency: r.currency, result_type: r.resultType, clicks_kind: r.clicksKind, missing }, who);
    if (conf.length && r.replace) { for (const x of conf) supersedeResult(x.id, id, who); out.replaced++; } else out.added++;
  }
  return out;
}
