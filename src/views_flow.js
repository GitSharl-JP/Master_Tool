// Pages du parcours de production : variantes, calendrier, contenus, campagnes, transmission, sauvegardes.
import { esc, fr, tabs } from './views.js';
import { FORMATS, CHANNELS, VIDEO_FORMATS } from './formats.js';
import { INTENTS, STAGES } from './variants.js';
import { META_STATUSES, CONTENT_STATUSES, LINK_STATES, OBJECTIVES, isFrozenState, coverage, trackedUrl, metaInfo } from './campaigns.js';
import { KINDS, PLAN_STATUSES, monthGrid, shiftMonth, today } from './plan.js';
import { SITE_PAGES } from './render.js';
import { PROJECT_DEFS, isSet, preview } from './secrets.js';
import { ENVIRONMENTS, SITE_STATUSES, STEPS } from './site.js';

const sel = (name, list, cur, attrs = '') => `<select name="${name}"${attrs}>${list.map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
const chip = (s) => `<span class="tag ${['approuvé', 'exporté', 'transmis', 'publié', 'fait'].includes(s) ? 'st-2' : ['à relire', 'bloqué', 'erreur'].includes(s) ? 'warn' : ''}">${esc(s)}</span>`;
const fmtTag = (f) => (f && FORMATS[f] ? `<span class="tag">${esc(FORMATS[f].ratio)}</span>` : '');
const flash = (m) => (m ? `<p class="flash">${esc(m)}</p>` : '');
const userOpts = (users, cur) => `<option value="">—</option>${users.map((u) => opt(u, u, cur)).join('')}`;

// Statut tel que Meta le déclare : toujours dire d'où vient l'information.
const metaChip = (row) => { const m = metaInfo(row); return `<span class="tag ${m.status === 'active' ? 'st-2' : ''}">${esc(m.status)}</span> <span class="tag warn">${m.manual ? 'saisi à la main' : 'synchronisé ' + fr(m.syncedAt)}</span>`; };

// Parcours d'une sortie : brouillon → à relire → approuvé → exporté → transmis → publié. Trois mots à ne jamais confondre.
const stepper = (stage) => {
  const cur = STAGES.indexOf(stage);
  return `<span class="stepper">${STAGES.map((s, i) => `<span class="step${i <= cur ? ' on' : ''}${i === cur ? ' now' : ''}">${s}</span>`).join('')}</span>`;
};
export const STAGE_LEGEND = '<small class="legend"><b>Exporté</b> = un fichier existe sur cet ordinateur · <b>Transmis</b> = envoyé à Meta (déclaré à la main tant que l’API n’est pas connectée) · <b>Publié</b> = diffusé dans Meta. Ces trois étapes ne se confondent jamais.</small>';

const thumb = (ed, fmt, vid) => {
  const f = FORMATS[fmt], k = 150 / f.w;
  return `<div class="vthumb" style="width:150px;height:${Math.round(f.h * k)}px"><iframe src="/render/poster/${ed.id}/${fmt}${vid ? '?variant=' + vid : ''}" style="width:${f.w}px;height:${f.h}px;transform:scale(${k})" loading="lazy" title="${esc(f.label)}"></iframe></div>`;
};

// ------------------------------------------------------------------ variantes
export function variantsPage(ed, { variants, campaigns, outputs, msg, filter, solo }) {
  const camp = (id) => campaigns.find((c) => c.id === id);
  return `${tabs(ed, 'variantes')}${flash(msg)}
<p class="lead">Une <b>variante</b> a toujours une <b>intention</b> (angle, audience, langue, format ou relance) et une <b>hypothèse</b> à tester. L’atelier refuse de créer deux variantes quasi identiques : mieux vaut peu de versions, chacune utile.</p>
<div class="inline"><a class="btn" href="/edition/${ed.id}/variants/new${filter ? '?campaign=' + filter : ''}">+ Nouvelle variante</a>
<form method="get" class="inline"><select name="campaign" onchange="this.form.submit()"><option value="">Toutes les campagnes</option>${campaigns.map((c) => opt(c.id, c.name, filter)).join('')}</select></form></div>
${variants.map((v) => `<div class="card vcard"><div class="vtop"><h2><a href="/edition/${ed.id}/variants/${v.id}">${esc(v.name)}</a> ${chip(v.status)} ${v.approved_version ? `<span class="tag">approuvée v${v.approved_version}</span>` : ''}</h2>
<small>${esc(INTENTS[v.intent]?.label || v.intent)}${v.campaign_id ? ' · campagne « ' + esc(camp(v.campaign_id)?.name || '?') + ' »' : ' · hors campagne (organique / réserve)'}</small></div>
<p>${v.angle ? `<span class="tag">angle : ${esc(v.angle)}</span> ` : ''}${v.audience ? `<span class="tag">audience : ${esc(v.audience)}</span> ` : ''}${v.language ? `<span class="tag">langue : ${esc(v.language)}</span>` : ''}</p>
<p class="hyp">Hypothèse : ${esc(v.hypothesis)}</p>
${(outputs[v.id] || []).map((o) => `<div class="orow">${o.kind === 'video' ? '<b>Vidéo</b>' : `<b>${esc(FORMATS[o.fmt].ratio)}</b>`} ${stepper(o.stage)}</div>`).join('')}
${solo ? '' : `<small>Responsable : ${esc(v.owner || '—')} · relecture : ${esc(v.reviewer || '—')}</small>`}</div>`).join('') || '<p>Aucune variante pour l’instant. Créez la première depuis le bouton ci-dessus.</p>'}
${STAGE_LEGEND}`;
}

export function variantNewPage(ed, c) {
  const { campaigns, adsets, assets, templates, users, values: v = {}, error, who, solo } = c;
  const presetFormats = c.preset?.formats || ['4x5', '9x16'];
  const imgs = assets.filter((a) => a.kind === 'image'), videos = assets.filter((a) => a.kind === 'video');
  const fmts = Object.keys(FORMATS);
  return `${tabs(ed, 'variantes')}${error ? `<p class="status warn">${esc(error)}</p>` : ''}
<h2>Nouvelle variante</h2>
<form method="post" action="/edition/${ed.id}/variants/new" class="vwizard" id="vform2">
<div class="card"><h2>1 · Pourquoi cette variante ?</h2>
${Object.entries(INTENTS).map(([k, i]) => `<label class="check intent"><input type="radio" name="intent" value="${k}" data-hyp="${esc(i.hypothesis)}" data-needs="${i.needs.join(',')}"${v.intent === k ? ' checked' : ''} required> <span><b>${esc(i.label)}</b><br><small>${esc(i.help)}</small></span></label>`).join('')}</div>
<div class="card"><h2>2 · Ce qui change et ce qu’on veut apprendre</h2><div class="grid">
<label>Nom de la variante<input name="name" value="${esc(v.name)}" placeholder="Ex. Famille — émerveillement" required></label>
<label><span>Angle créatif <small data-need="angle"></small></span><input name="angle" value="${esc(v.angle)}" placeholder="Ex. émerveillement, exclusivité, dernières places"></label>
<label><span>Audience visée <small data-need="audience"></small></span><input name="audience" value="${esc(v.audience)}" placeholder="Ex. familles, couples, touristes"></label>
<label><span>Langue <small data-need="language"></small></span><input name="language" value="${esc(v.language)}" placeholder="Ex. EN, JA"></label></div>
<label>Hypothèse à tester <small>— une phrase qu’on pourra confirmer ou infirmer avec les résultats</small><textarea name="hypothesis" id="hyp" rows="2" required>${esc(v.hypothesis)}</textarea></label></div>
<div class="card"><h2>3 · Campagne et responsables</h2><div class="grid">
<label>Campagne Meta reliée <small>(facultatif : une variante peut exister sans campagne)</small><select name="campaign_id"><option value="">Aucune (organique / réserve)</option>${campaigns.map((x) => opt(x.id, x.name, v.campaign_id || c.preset?.campaign_id)).join('')}</select></label>
<label>Ensemble de publicités<select name="adset_id"><option value="">—</option>${adsets.map((x) => opt(x.id, `${x.campaign_name} › ${x.name}`, v.adset_id || c.preset?.adset_id)).join('')}</select></label>
${solo ? `<input type="hidden" name="owner" value="${esc(who)}">` : `<label>Responsable<select name="owner">${userOpts(users, v.owner || who)}</select></label>
<label>Relecteur <small>(facultatif)</small><select name="reviewer">${userOpts(users, v.reviewer)}</select></label>`}</div></div>
<div class="card"><h2>4 · Point de départ</h2><div class="grid">
<label>Design<select name="design_version"><option value="">Réglages actuels des affiches du projet</option>${templates.map((t) => opt(t.version_id, `${t.name} — v${t.version}`, v.design_version)).join('')}</select></label>
<label>Photo de fond<select name="hero"><option value="">Celle du design</option>${imgs.filter((a) => a.role !== 'logo').map((a) => opt(a.id, a.name + (a.provisional ? ' (provisoire)' : ''), v.hero)).join('')}</select></label>
<label>Logo<select name="logo"><option value="">Celui du design</option>${imgs.filter((a) => a.role === 'logo').map((a) => opt(a.id, a.name, v.logo)).join('')}</select></label></div></div>
<div class="card"><h2>5 · Textes de cette variante</h2><small>Laissez vide pour garder le texte de la fiche. Vous pourrez tout retoucher ensuite, format par format, directement sur l’aperçu.</small><div class="grid">
<label>Titre<input name="msg_title" value="${esc(v.msg_title)}"></label><label>Accroche<input name="msg_tagline" value="${esc(v.msg_tagline)}"></label>
<label>Phrase du haut<input name="msg_top" value="${esc(v.msg_top)}"></label><label>Bouton<input name="msg_cta" value="${esc(v.msg_cta)}" placeholder="Ex. Book your tickets"></label></div></div>
<div class="card"><h2>6 · Sorties</h2><div class="chanlist inline">${fmts.map((k) => `<label class="check"><input type="checkbox" name="fmt_${k}" value="1"${v['fmt_' + k] || (!Object.keys(v).length && presetFormats.includes(k)) ? ' checked' : ''}> ${esc(FORMATS[k].label)}</label>`).join('')}</div>
<label class="check"><input type="checkbox" name="with_video" value="1"${v.with_video ? ' checked' : ''}> Prévoir aussi une vidéo (sous-titres propres à cette variante)</label>
<label>Vidéo source<select name="video_asset"><option value="">Celle du projet</option>${videos.map((a) => opt(a.id, a.name, v.video_asset)).join('')}</select></label></div>
<button class="primary">Créer la variante</button> <a href="/edition/${ed.id}/variants">Annuler</a></form>`;
}

export function variantPage(ed, c) {
  const { v, outputs, versions, pristine, campaigns, adsets, users, planItems, msg, exportResult, templates, solo, next, checksList = [], autoLabel } = c;
  const exportable = v.status === 'approuvé' && pristine;
  const nextBanner = next ? `<div class="next"><b>Prochaine étape</b> — ${esc(next.text)}
${next.action === 'approve-export' ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/approve-export" class="inline"><button class="primary">${esc(next.label)}</button></form>` : ''}
${next.action === 'export' ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/export" class="inline"><button class="primary">${esc(next.label)}</button></form>` : ''}
${next.action === 'link-auto' ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/link" class="inline"><input type="hidden" name="target" value="auto"><button class="primary">${esc(next.label)}${autoLabel ? ' : ' + esc(autoLabel) : ''}</button></form>` : ''}
${!next.action && next.href ? `<a class="btn" href="${esc(next.href)}">${esc(next.label || 'Ouvrir')}</a>` : ''}</div>` : '';
  const checksCard = `<div class="card"><h2>Contrôles automatiques avant approbation</h2>${checksList.length
    ? `<ul class="log checks">${checksList.map((k) => `<li class="${k.level}">${k.level === 'bloquant' ? '🔴 <b>À corriger</b>' : '🟡 <b>À savoir</b>'} — ${esc(k.text)} ${k.href ? `<a href="${esc(k.href)}">corriger</a>` : ''}</li>`).join('')}</ul><small>« À corriger » empêche d’approuver ; « À savoir » se signale mais n’empêche rien.</small>`
    : '<p>✅ Aucun problème détecté : photo, titre, formats et vidéo sont en ordre.</p>'}</div>`;
  const why = v.status === 'archivé' ? 'La variante est archivée.' : v.status !== 'approuvé' ? 'La variante doit d’abord être approuvée.' : !pristine ? 'La variante a changé depuis son approbation : relisez puis approuvez à nouveau.' : '';
  return `${tabs(ed, 'variantes')}${flash(msg)}
<p><a href="/edition/${ed.id}/variants">← Variantes</a></p>
${nextBanner}
<div class="card"><h2>${esc(v.name)} ${chip(v.status)} ${v.approved_version ? `<span class="tag">version approuvée : v${v.approved_version}</span>` : ''}</h2>
${v.approved_version && !pristine ? `<p class="status warn">Cette variante a été <b>modifiée depuis son approbation</b>. La version approuvée <b>v${v.approved_version}</b> et ses exports sont <b>intacts</b> ; la version en cours de travail attend une nouvelle relecture. <form method="post" action="/edition/${ed.id}/variants/${v.id}/restore" class="inline"><input type="hidden" name="version" value="${v.approved_version}"><button class="link">Revenir à la version approuvée v${v.approved_version}</button></form></p>` : ''}
<form method="post" action="/edition/${ed.id}/variants/${v.id}/update" class="grid">
<label>Nom<input name="name" value="${esc(v.name)}"></label><label>Angle<input name="angle" value="${esc(v.angle)}"></label>
<label>Audience visée<input name="audience" value="${esc(v.audience)}"></label><label>Langue<input name="language" value="${esc(v.language)}"></label>
<label style="grid-column:1/-1">Hypothèse à tester<textarea name="hypothesis" rows="2">${esc(v.hypothesis)}</textarea></label>
<label>Campagne<select name="campaign_id"><option value="">Aucune (organique / réserve)</option>${campaigns.map((x) => opt(x.id, x.name, v.campaign_id)).join('')}</select></label>
<label>Ensemble<select name="adset_id"><option value="">—</option>${adsets.map((x) => opt(x.id, `${x.campaign_name} › ${x.name}`, v.adset_id)).join('')}</select></label>
${solo ? '' : `<label>Responsable<select name="owner">${userOpts(users, v.owner)}</select></label><label>Relecteur <small>(facultatif)</small><select name="reviewer">${userOpts(users, v.reviewer)}</select></label>`}
<div><button>Enregistrer l’intention</button></div></form>
<small>${esc(INTENTS[v.intent]?.label)} · créée par ${esc(v.created_by)} le ${fr(v.created)}</small></div>

<div class="card"><h2>Textes de la variante</h2><small>Appliqués à tous les formats ; retouchez ensuite un format précis directement sur son aperçu.</small>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/messages" class="grid">
<label>Titre<input name="msg_title" value="${esc(v.msg_title)}"></label><label>Accroche<input name="msg_tagline" value="${esc(v.msg_tagline)}"></label>
<label>Phrase du haut<input name="msg_top" value="${esc(v.msg_top)}"></label><label>Bouton<input name="msg_cta" value="${esc(v.msg_cta)}"></label>
<div><button>Appliquer aux formats</button></div></form></div>

<div class="card"><h2>Sorties</h2>
${outputs.map((o) => `<div class="out">${o.kind === 'video' ? '<div class="vthumb vid"><span>vidéo</span></div>' : thumb(ed, o.fmt, v.id)}
<div class="outm"><b>${o.kind === 'video' ? 'Vidéo' : esc(FORMATS[o.fmt].label)}</b> ${stepper(o.stage)}
${o.frozen ? '<span class="tag st-2">🔒 version diffusée figée</span>' : ''}
<p><a class="btn sm" href="${o.kind === 'video' ? `/edition/${ed.id}/video?variant=${v.id}` : `/edition/${ed.id}/poster/${o.fmt}?variant=${v.id}`}">Ajuster (textes, cadrage${o.kind === 'video' ? ', sous-titres' : ''})</a></p>
${o.exports.map((e) => `<small>Export v${e.variant_version} du ${fr(e.created)} ${e.draft ? '<span class="tag warn">BROUILLON</span>' : ''} — <a href="/exports/${e.id}?dl=1">télécharger</a></small>`).slice(0, 2).join('<br>')}
${o.trial ? `<small>Essai (non officiel) du ${fr(o.trial.created)} — <a href="/exports/${o.trial.id}" target="_blank">voir</a></small>` : ''}
${o.links.map((l) => `<small>${chip(l.state)} ${l.ad_name ? 'annonce « ' + esc(l.ad_name) + ' »' : l.adset_name ? 'ensemble « ' + esc(l.adset_name) + ' »' : 'campagne « ' + esc(l.campaign_name) + ' »'}</small>`).join('<br>')}</div></div>`).join('')}
${STAGE_LEGEND}</div>

${checksCard}
<div class="card"><h2>Validation</h2>
<p>« Approuver » <b>fige une version</b> (textes, cadrages, sous-titres, informations de la fiche à cet instant). Les exports officiels partent <b>toujours</b> de cette version. Si vous modifiez ensuite la variante, elle repasse « à relire » sans toucher à la version approuvée. Vous travaillez seul(e) : les contrôles ci-dessus remplacent une relecture extérieure ; « mettre de côté » sert à relire plus tard avec un regard neuf.</p>
<div class="inline">
<form method="post" action="/edition/${ed.id}/variants/${v.id}/approve-export" class="inline"><input name="note" placeholder="Note de version (facultatif)"><button class="primary"${v.status === 'archivé' ? ' disabled' : ''}>Approuver et exporter</button></form>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/approve"><button${v.status === 'archivé' ? ' disabled' : ''}>Approuver seulement</button></form>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/review"><button class="link"${v.status === 'approuvé' || v.status === 'archivé' ? ' disabled' : ''}>Mettre de côté pour relire plus tard</button></form></div>
${versions.length ? `<ul class="log">${versions.map((x) => `<li><b>v${x.version}</b> approuvée par ${esc(x.approved_by)} le ${fr(x.approved_at)}${x.note ? ' · ' + esc(x.note) : ''}
<form method="post" action="/edition/${ed.id}/variants/${v.id}/restore" class="inline"><input type="hidden" name="version" value="${x.version}"><button class="link">Restaurer cette version</button></form></li>`).join('')}</ul>` : '<small>Aucune version approuvée.</small>'}</div>

<div class="card"><h2>Export</h2>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/export"><button class="primary"${exportable ? '' : ' disabled'}>Exporter la version approuvée${v.approved_version ? ' (v' + v.approved_version + ')' : ''}</button></form>
${exportable ? '<small>Un export identique à un export existant n’est pas refait : pas de doublon. Un nouvel export ne remplace jamais l’ancien ni une association à une campagne.</small>' : `<small>${esc(why)}</small>`}
${exportResult ? `<ul class="log">${exportResult.map((o) => `<li>${esc(o.fmt)} : ${esc(o.state)}</li>`).join('')}</ul>` : ''}</div>

<div class="card"><h2>Associer à une campagne</h2>
<small>Associe les sorties <b>exportées</b> de la version approuvée à un niveau de la campagne. Chaque association est épinglée sur un export précis et démarre en <b>brouillon</b> : rien n’est transmis.</small>
${v.campaign_id && autoLabel ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/link" class="inline"><input type="hidden" name="target" value="auto"><button class="primary">Associer à ${esc(autoLabel)}</button></form><small>ou choisir un autre niveau :</small>` : ''}
<form method="post" action="/edition/${ed.id}/variants/${v.id}/link" class="inline">
<select name="target" required><option value="">Choisir le niveau…</option>${campaigns.map((x) => `<option value="campaign_id:${x.id}">Campagne : ${esc(x.name)}</option>${(adsets.filter((a) => a.campaign_id === x.id)).map((a) => `<option value="adset_id:${a.id}">&nbsp;&nbsp;Ensemble : ${esc(a.name)}</option>`).join('')}`).join('')}</select>
<button>Associer en brouillon</button></form>
${v.campaign_id ? `<small>Suite du parcours (relecture, transmission, publication) : <a href="/edition/${ed.id}/campaigns/${v.campaign_id}">page de la campagne</a>.</small>` : ''}</div>

<div class="card"><h2>Planning</h2>
${planItems.length ? `<ul class="log">${planItems.map((p) => `<li><b>${esc(p.due_date)}</b> ${esc(p.title)} ${chip(p.status)} <small>${esc(p.owner)}</small></li>`).join('')}</ul><a href="/edition/${ed.id}/calendar">Ouvrir le calendrier</a>`
    : `<form method="post" action="/edition/${ed.id}/variants/${v.id}/plan" class="inline"><label>Date de publication visée<input type="date" name="publish" required></label><button>Planifier à rebours</button></form><small>Crée les étapes (préparer, relire, approuver, exporter, transmettre, publier) en remontant le temps depuis cette date.</small>`}</div>

<div class="card"><h2>Dupliquer pour une nouvelle intention</h2>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/duplicate" class="grid">
<label>Nom de la nouvelle variante<input name="name" required></label><label>Angle<input name="angle" value="${esc(v.angle)}"></label>
<label>Audience<input name="audience" value="${esc(v.audience)}"></label><label>Langue<input name="language" value="${esc(v.language)}"></label>
<label style="grid-column:1/-1">Hypothèse<textarea name="hypothesis" rows="2" required></textarea></label><div><button>Dupliquer</button></div></form>
<small>Au moins l’angle, l’audience ou la langue doit changer : sinon vous obtiendriez une version presque identique.</small>
${v.status !== 'archivé' ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/archive" class="inline"><button class="link">Archiver cette variante</button></form>` : ''}</div>`;
}

// ------------------------------------------------------------------ calendrier
export function calendarPage(ed, c) {
  const { month, items, campaigns, variants, users, msg, campaignFilter, solo, todo = [] } = c;
  const grid = monthGrid(month), byDate = {}, td = today();
  for (const it of items) (byDate[it.due_date] ||= []).push(it);
  const late = items.filter((i) => i.status !== 'fait' && i.due_date < td);
  const name = new Date(month + '-01T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const q = campaignFilter ? `&campaign=${campaignFilter}` : '';
  return `${tabs(ed, 'calendrier')}${flash(msg)}${todoCard(todo)}
<p class="lead">Dates en jours calendaires du fuseau du projet (<b>${esc(ed.data.timezone || 'Asia/Tokyo')}</b>). Les étapes d’une variante se cochent d’elles-mêmes quand la réalité les rattrape ; l’atelier ne publie jamais à votre place.</p>
<div class="inline"><a href="?month=${shiftMonth(month, -1)}${q}">← mois précédent</a><b>${esc(name)}</b><a href="?month=${shiftMonth(month, 1)}${q}">mois suivant →</a>
<form method="get" class="inline"><input type="hidden" name="month" value="${month}"><select name="campaign" onchange="this.form.submit()"><option value="">Toutes les campagnes</option>${campaigns.map((x) => opt(x.id, x.name, campaignFilter)).join('')}</select></form></div>
${late.length ? `<p class="status warn"><b>${late.length} tâche(s) en retard :</b> ${late.slice(0, 4).map((l) => esc(l.title)).join(' · ')}</p>` : ''}
<table class="cal"><tr>${['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d) => `<th>${d}</th>`).join('')}</tr>
${grid.map((w) => `<tr>${w.map((d) => `<td class="${d.inMonth ? '' : 'off'}${d.date === td ? ' today' : ''}"><span class="dn">${Number(d.date.slice(8))}</span>
${(byDate[d.date] || []).slice(0, 3).map((i) => `<a class="ci k-${i.kind} s-${i.status === 'fait' ? 'ok' : i.due_date < td ? 'late' : 'todo'}" href="${i.variant_id ? `/edition/${ed.id}/variants/${i.variant_id}` : '#liste'}" title="${esc(i.title)}">${i.due_time ? esc(i.due_time) + ' ' : ''}${esc(KINDS[i.kind])}</a>`).join('')}${(byDate[d.date] || []).length > 3 ? `<small>+${byDate[d.date].length - 3}</small>` : ''}</td>`).join('')}</tr>`).join('')}</table>
<div class="card" id="liste"><h2>Tâches du mois</h2>
${items.map((i) => `<form method="post" action="/edition/${ed.id}/calendar/${i.id}" class="prow"><span class="tag k-${i.kind}">${esc(KINDS[i.kind])}</span> <b>${esc(i.title)}</b> ${i.variant_name ? `<small>variante « ${esc(i.variant_name)} »</small>` : ''}
<input type="date" name="due_date" value="${esc(i.due_date)}"><input type="time" name="due_time" value="${esc(i.due_time)}">${solo ? '' : `<select name="owner">${userOpts(users, i.owner)}</select>`}${sel('status', PLAN_STATUSES, i.status)}<button>OK</button><button name="remove" value="1" class="link">Supprimer</button></form>`).join('') || '<p>Rien de planifié ce mois-ci.</p>'}</div>
<div class="card"><h2>Ajouter une tâche</h2><form method="post" action="/edition/${ed.id}/calendar/new" class="grid">
<label>Titre<input name="title" required></label><label>Type${sel('kind', Object.keys(KINDS), 'jalon')}</label>
<label>Date<input type="date" name="due_date" required></label><label>Heure (facultatif)<input type="time" name="due_time"></label>
${solo ? '' : `<label>Responsable<select name="owner">${userOpts(users, '')}</select></label>`}
<label>Variante<select name="variant_id"><option value="">—</option>${variants.map((x) => opt(x.id, x.name, '')).join('')}</select></label>
<label>Campagne<select name="campaign_id"><option value="">—</option>${campaigns.map((x) => opt(x.id, x.name, '')).join('')}</select></label><div><button>Ajouter</button></div></form></div>`;
}

// ------------------------------------------------------------------ contenus
export function contentsPage(ed, c) {
  const { contents, exports, linksBy, msg } = c;
  const used = new Set(contents.map((x) => x.export_id));
  const free = exports.filter((e) => ['affiche', 'video', 'pack'].includes(e.kind) && !used.has(e.id) && !e.variant_id);
  const th = (x) => (x.kind === 'image' && x.export_id ? `<img src="/exports/${x.export_id}" alt="">` : x.kind === 'video' && x.export_id ? `<video src="/exports/${x.export_id}" preload="metadata" muted></video>` : `<span>${esc(x.kind)}</span>`);
  return `${tabs(ed, 'contenus')}${flash(msg)}
<p class="lead">Les <b>contenus</b> sont les créations prêtes à l’emploi de ce projet. Ils existent <b>sans campagne</b> (publications organiques, réserve) et peuvent être associés à une ou plusieurs campagnes. Chaque association est <b>épinglée sur une version précise</b> : refaire un export ne la modifie jamais. Les contenus issus d’une variante apparaissent ici automatiquement après l’export de sa version approuvée.</p>
<div class="card"><h2>Ajouter un contenu depuis un export</h2>
<form method="post" action="/edition/${ed.id}/contents/new" class="grid">
<label>Fichier (export de ce projet)<select name="export_id" required><option value="">— choisir —</option>${free.map((e) => `<option value="${e.id}">${esc(e.label)} · ${fr(e.created)}${e.draft ? ' · BROUILLON' : ''}</option>`).join('')}</select></label>
<label>Titre<input name="title" placeholder="Par défaut : le nom de l’export"></label><label>Angle créatif<input name="angle"></label><label>Audience visée<input name="audience"></label>
<label>Langue<input name="language" value="EN"></label><div><button>Ajouter à la bibliothèque</button></div></form></div>
${contents.map((x) => `<div class="card dcard"><div class="dthumb">${th(x)}</div><div class="dmeta">
<form method="post" action="/edition/${ed.id}/contents/${x.id}/update" class="grid">
<label>Titre<input name="title" value="${esc(x.title)}"></label><label>Statut${sel('status', CONTENT_STATUSES, x.status)}</label>
<label>Angle<input name="angle" value="${esc(x.angle)}"></label><label>Audience<input name="audience" value="${esc(x.audience)}"></label>
<label>Langue<input name="language" value="${esc(x.language)}"></label><label>Notes<input name="notes" value="${esc(x.notes)}"></label><div><button>Enregistrer</button></div></form>
<small>${esc(x.kind)} ${fmtTag(x.format)} ${x.export_id ? '<span class="tag st-2">exporté</span>' : ''} ${x.draft ? '<span class="tag warn">BROUILLON</span>' : ''} ${x.variant_id ? `<a href="/edition/${ed.id}/variants/${x.variant_id}">variante v${x.variant_version || '?'}</a>` : ''} · version du ${fr(x.export_created)}</small>
${(linksBy[x.id] || []).length ? `<ul class="log">${linksBy[x.id].map((l) => `<li>${chip(l.state)} ${l.ad_name ? `annonce « ${esc(l.ad_name)} »` : l.adset_name ? `ensemble « ${esc(l.adset_name)} »` : `campagne « ${esc(l.campaign_name)} »`}${l.export_id !== x.export_id ? ' <span class="tag warn">version épinglée plus ancienne</span>' : ''}${isFrozenState(l.state) ? ' 🔒' : ''}</li>`).join('')}</ul>` : '<small>Associé à aucune campagne (utilisable en organique).</small>'}
${x.variant_id ? '' : `<form method="post" action="/edition/${ed.id}/contents/${x.id}/version" class="inline"><select name="export_id"><option value="">Nouvelle version : choisir un export…</option>${exports.filter((e) => e.kind === (x.kind === 'image' ? 'affiche' : x.kind) && e.id !== x.export_id).map((e) => `<option value="${e.id}">${esc(e.label)} · ${fr(e.created)}</option>`).join('')}</select><button class="link">Remplacer</button></form>`}
</div></div>`).join('') || '<p>Aucun contenu pour l’instant.</p>'}`;
}

// ------------------------------------------------------------------ campagnes
export function campaignsPage(ed, c) {
  const { meta, campaigns, counts, msg } = c;
  return `${tabs(ed, 'campagnes')}${flash(msg)}
<p class="lead">Les campagnes sont <b>créées et gérées dans Meta</b> (Ads Manager). Ici, vous les <b>reliez</b> à ce projet pour organiser la production de leurs contenus. Un projet peut avoir plusieurs campagnes, qui renvoient toutes vers <b>le même site</b> : en créer une ne crée pas de site. Travailler sur une campagne active reste possible : vous préparez de nouvelles variantes en brouillon.</p>
<div class="card"><h2>Connexion Meta <span class="tag warn">non connectée — saisie à la main</span></h2>
<p class="status warn">Aucune synchronisation n’a eu lieu (${meta.synced_at ? 'dernière : ' + fr(meta.synced_at) : 'jamais'}). Tout ce qui est marqué « Meta » ci-dessous est <b>saisi à la main et non vérifié</b> ; le brief interne, lui, est à vous. Rien n’est envoyé à Meta, rien n’y est modifié. <b>L’absence de connexion ne bloque aucun travail de production.</b></p>
<form method="post" action="/edition/${ed.id}/campaigns/meta" class="grid">
<label>Compte publicitaire (ID)<input name="ad_account" value="${esc(meta.ad_account)}" placeholder="act_1234567890"></label>
<label>Page Facebook<input name="page_name" value="${esc(meta.page_name)}"></label><label>Compte Instagram<input name="instagram" value="${esc(meta.instagram)}"></label>
<label>Note<input name="note" value="${esc(meta.note)}"></label><div><button>Enregistrer</button></div></form>
<details><summary>Ce que l’API Meta permettra, et ce qu’il faudra toujours saisir</summary>
<table><tr><th>Récupérable via l’API</th><th>Toujours à vous (brief interne)</th><th>Avec récapitulatif et confirmation</th></tr>
<tr><td>Campagnes, ensembles, annonces : noms, identifiants, statuts, objectif Meta, budget configuré, ciblage réel<br>Résultats par niveau, avec ventilation par image ou vidéo</td>
<td>Objectif interne, angle, intention, audience souhaitée, hypothèse, message, langues, budget prévu, consignes</td>
<td>Envoyer un visuel ou une vidéo vers Meta<br>Toute modification dans Meta (jamais automatique)</td></tr></table>
<small><b>Accès (source officielle Meta, à reconfirmer à la mise en place)</b> : l’accès « standard » aux permissions <code>ads_read</code> et <code>ads_management</code> suffit pour gérer <b>ses propres</b> comptes publicitaires ; l’accès avancé (avec examen de l’application) concerne la gestion de comptes d’<b>autres</b> personnes. La vérification d’entreprise est demandée pour accéder à des données sensibles : <b>non établi pour notre cas</b>, à vérifier dans le tableau de bord de l’application. Un jeton de lecture suffit pour commencer.</small></details></div>
<div class="card"><h2>Relier une campagne créée dans Meta</h2>
<form method="post" action="/edition/${ed.id}/campaigns/new" class="grid">
<label>Nom (comme dans Meta)<input name="name" required></label><label>Identifiant Meta (facultatif)<input name="meta_id"></label>
<label>Statut dans Meta <small>(saisi)</small>${sel('meta_status', META_STATUSES, 'inconnu')}</label><label>Objectif dans Meta <small>(saisi)</small>${sel('meta_objective', ['', ...OBJECTIVES], '')}</label>
<label style="grid-column:1/-1">Objectif interne et message clé<textarea name="brief_message" rows="2" placeholder="Ce qu’on veut obtenir et ce qu’on veut dire"></textarea></label>
<div><button class="primary">Relier la campagne</button></div></form></div>
${campaigns.map((x) => `<div class="card"><h2><a href="/edition/${ed.id}/campaigns/${x.id}">${esc(x.name)}</a> ${metaChip(x)}</h2>
<small>${x.meta_id ? 'ID Meta ' + esc(x.meta_id) + ' · ' : ''}${counts[x.id]?.variants || 0} variante(s) · ${counts[x.id]?.links || 0} association(s)</small>
${x.brief_message ? `<p class="hyp">Brief : ${esc(x.brief_message)}</p>` : ''}</div>`).join('') || '<p>Aucune campagne reliée.</p>'}`;
}

const linkActions = (ed, l) => {
  const f = (state, label, cls = '') => `<form method="post" action="/edition/${ed.id}/links/${l.id}" class="inline"><input type="hidden" name="state" value="${state}"><button class="${cls || 'link'}">${label}</button></form>`;
  const rm = `<form method="post" action="/edition/${ed.id}/links/${l.id}" class="inline"><input type="hidden" name="unlink" value="1"><button class="link">Retirer</button></form>`;
  const go = (to, label) => `<a class="btn sm" href="/edition/${ed.id}/links/${l.id}/confirm?to=${to}">${label}</a>`;
  if (l.state === 'publié') return '<span class="tag st-2">🔒 publiée — figée</span>';
  if (l.state === 'transmis') return `<span class="tag st-2">🔒 transmise — figée</span> ${go('publié', 'Marquer comme publiée…')} ${f('erreur', 'Signaler une erreur')}`;
  if (l.state === 'approuvé') return `${go('transmis', 'Transmettre…')} ${f('brouillon', 'Repasser en brouillon')} ${rm}`;
  if (l.state === 'à relire') return `${f('approuvé', 'Approuver pour cette campagne', 'btn sm')} ${f('brouillon', 'Repasser en brouillon')} ${rm}`;
  if (l.state === 'erreur') return `${f('brouillon', 'Repasser en brouillon')} ${rm}`;
  return `${f('à relire', 'Demander la relecture')} ${f('approuvé', 'Approuver pour cette campagne')} ${rm}`;
};
const linkList = (ed, links) => (links.length ? `<ul class="log links">${links.map((l) => `<li>
${l.kind === 'image' && l.export_id ? `<a href="/exports/${l.export_id}" target="_blank"><img src="/exports/${l.export_id}" class="lthumb" alt=""></a>` : ''}
<span><b>${esc(l.title)}</b> ${fmtTag(l.format)} ${chip(l.state)} ${l.export_id ? '<span class="tag st-2">exporté</span>' : ''} ${l.draft ? '<span class="tag warn">BROUILLON</span>' : ''}
${l.variant_id ? `<a href="/edition/${ed.id}/variants/${l.variant_id}">variante</a>` : ''}
${l.export_id !== l.current_export ? '<span class="tag warn">nouvelle version du contenu disponible — non appliquée</span>' : ''}<br>
<small>version épinglée du ${fr(l.linked_at)} · ${esc(l.angle || 'sans angle')} · ${esc(l.language || '')}${l.transmitted_at ? ' · marquée transmise le ' + fr(l.transmitted_at) : ''}</small><br>${linkActions(ed, l)}</span></li>`).join('')}</ul>` : '<small>Aucun contenu associé à ce niveau.</small>');

export function campaignPage(ed, c) {
  const { camp, adsets, contents, compare, variants, msg, users } = c;
  const active = camp.meta_status === 'active';
  const linkForm = (field, id) => `<form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/link" class="inline"><input type="hidden" name="${field}" value="${id}">
<select name="content_id" required><option value="">Associer un contenu (en brouillon)…</option>${contents.map((x) => `<option value="${x.id}">${esc(x.title)} ${x.format ? '(' + esc(FORMATS[x.format]?.ratio || '') + ')' : ''} — ${esc(x.status)}</option>`).join('')}</select><button>Associer</button></form>`;
  const pageOpts = (cur) => `<option value="">Page de réservation de la fiche</option>${SITE_PAGES.map(([k, n]) => { const u = `/site/${ed.id}/${k === 'home' ? '' : k}`; return opt(u, 'Site du projet : ' + n, cur); }).join('')}`;
  const metaForm = (action, r, extra) => `<form method="post" action="${action}" class="grid"><label>Nom dans Meta<input name="name" value="${esc(r.name)}"></label><label>Identifiant Meta<input name="meta_id" value="${esc(r.meta_id)}"></label>
<label>Statut dans Meta ${r.meta_source === 'meta' ? '' : '<small>(saisi)</small>'}${sel('meta_status', META_STATUSES, r.meta_status)}</label>${extra}<div><button>Enregistrer la configuration Meta saisie</button></div></form>`;
  const adsetHtml = adsets.map((s) => {
    const cov = coverage(s, s.links);
    return `<div class="card"><h2>Ensemble : ${esc(s.name)} ${metaChip(s)}</h2>
<div class="two"><div><h3>Configuration Meta <small class="tag warn">provisoire</small></h3>${metaForm(`/edition/${ed.id}/campaigns/${camp.id}/adset/${s.id}/meta`, s, `<label>Ciblage réel dans Meta <small>(saisi)</small><input name="meta_targeting" value="${esc(s.meta_targeting)}"></label>`)}</div>
<div><h3>Brief interne</h3><form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/adset/${s.id}/brief" class="grid">
<label>Audience souhaitée<input name="brief_audience" value="${esc(s.brief_audience)}"></label><label>Langues<input name="brief_languages" value="${esc(s.brief_languages)}"></label>
<label style="grid-column:1/-1">Hypothèse<input name="brief_hypothesis" value="${esc(s.brief_hypothesis)}"></label>
<label>Destination<select name="landing">${pageOpts(s.landing)}</select></label>
<div style="grid-column:1/-1"><b>Placements souhaités</b><div class="chanlist inline">${Object.entries(CHANNELS).map(([k, ch]) => `<label class="check"><input type="checkbox" name="pl_${k}" value="1"${s.brief_placements.includes(k) ? ' checked' : ''}> ${esc(ch.label)}</label>`).join('')}</div></div>
<div><button>Enregistrer le brief</button></div></form></div></div>
${s.brief_placements.length ? `<div class="cover"><b>Formats à produire (selon les placements souhaités) :</b> ${cov.need.map((f) => `<span class="tag ${cov.have.includes(f) ? 'st-2' : 'warn'}">${esc(FORMATS[f].ratio)} ${cov.have.includes(f) ? '✓' : 'manquant'}</span>`).join(' ')}
${cov.missing.length ? `<small>→ <a href="/edition/${ed.id}/variants/new?campaign=${camp.id}&adset=${s.id}&formats=${cov.missing.join(',')}">Créer une variante</a> pour les formats manquants, l’approuver et l’exporter.</small>` : '<small>Tous les formats nécessaires sont couverts.</small>'}</div>` : ''}
${linkList(ed, s.links)}${linkForm('adset_id', s.id)}
${s.ads.map((a) => `<div class="adrow"><h3>Annonce : ${esc(a.name)} ${metaChip(a)}</h3><small>${a.meta_id ? 'ID Meta ' + esc(a.meta_id) + ' · ' : ''}${esc(a.notes)}</small>
${(() => { const u = trackedUrl(a.landing || s.landing || ed.data.booking_url, { channel: 'meta', campaign: camp.name, content: a.name }); return u ? `<br><small>Lien suivi : <code>${esc(u)}</code></small>` : '<br><small>Aucune URL de destination : renseignez l’URL de réservation dans la fiche.</small>'; })()}
${linkList(ed, a.links)}${linkForm('ad_id', a.id)}</div>`).join('')}
<details><summary>+ Relier une annonce créée dans Meta</summary><form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/ad" class="grid"><input type="hidden" name="adset_id" value="${s.id}">
<label>Nom<input name="name" required></label><label>ID Meta (facultatif)<input name="meta_id"></label><label>Statut dans Meta <small>(saisi)</small>${sel('meta_status', META_STATUSES, 'inconnu')}</label>
<label>Destination<select name="landing">${pageOpts('')}</select></label><label>Notes<input name="notes"></label><div><button>Relier</button></div></form></details></div>`;
  }).join('');
  const num = (v, d = 2) => (v === null ? '—' : v.toFixed(d));
  return `${tabs(ed, 'campagnes')}${flash(msg)}
<p><a href="/edition/${ed.id}/campaigns">← Campagnes</a></p>
<div class="card"><h2>${esc(camp.name)} ${metaChip(camp)}</h2>
${active ? '<p class="status ok"><b>Campagne active dans Meta</b> (statut saisi à la main). Les versions diffusées (associations « transmises » ou « publiées ») sont <b>figées</b> et identifiables 🔒. Vous pouvez continuer à préparer de <b>nouvelles variantes en brouillon</b> pour cette campagne ; rien ne part vers Meta sans récapitulatif et confirmation de votre part.</p>' : ''}
<div class="two"><div><h3>Configuration Meta <small class="tag warn">${camp.meta_source === 'meta' ? 'synchronisée ' + fr(camp.meta_synced_at) : 'provisoire : saisie à la main, jamais synchronisée'}</small></h3>
${metaForm(`/edition/${ed.id}/campaigns/${camp.id}/meta`, { ...camp, name: camp.name }, `<label>Objectif dans Meta<input name="meta_objective" value="${esc(camp.meta_objective)}"></label><label>Budget configuré dans Meta<input name="meta_budget" value="${esc(camp.meta_budget)}"></label>
<label>Début (Meta)<input type="date" name="meta_start" value="${esc(camp.meta_start)}"></label><label>Fin (Meta)<input type="date" name="meta_end" value="${esc(camp.meta_end)}"></label>`)}
<small>Ces champs seront remplacés par les valeurs réelles de Meta dès que la connexion sera active.</small></div>
<div><h3>Brief interne <small class="tag">à nous, jamais écrasé par Meta</small></h3><form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/brief" class="grid">
<label>Objectif interne<input name="brief_objective" value="${esc(camp.brief_objective)}"></label><label>Langues visées<input name="brief_languages" value="${esc(camp.brief_languages)}"></label>
<label style="grid-column:1/-1">Message clé<textarea name="brief_message" rows="2">${esc(camp.brief_message)}</textarea></label>
<label>Audience souhaitée<input name="brief_audience" value="${esc(camp.brief_audience)}"></label><label>Budget prévu<input name="brief_budget" value="${esc(camp.brief_budget)}"></label>
<label style="grid-column:1/-1">Hypothèse à tester<input name="brief_hypothesis" value="${esc(camp.brief_hypothesis)}"></label>
<label style="grid-column:1/-1">Consignes et notes<textarea name="brief_notes" rows="2">${esc(camp.brief_notes)}</textarea></label><div><button>Enregistrer le brief</button></div></form>
<small>Budget prévu ≠ budget configuré · audience souhaitée ≠ ciblage réel · objectif interne ≠ objectif Meta.</small></div></div></div>
<div class="card"><h2>Variantes de cette campagne</h2>
${variants.map((v) => `<div class="orow"><a href="/edition/${ed.id}/variants/${v.id}"><b>${esc(v.name)}</b></a> ${chip(v.status)} <small>${esc(INTENTS[v.intent]?.label)}</small></div>`).join('') || '<small>Aucune variante.</small>'}
<p><a class="btn" href="/edition/${ed.id}/variants/new?campaign=${camp.id}">+ Nouvelle variante pour cette campagne</a></p></div>
<div class="card"><h2>Contenus associés à la campagne entière</h2>${linkList(ed, c.campLinks)}${linkForm('campaign_id', camp.id)}</div>
${adsetHtml}
<div class="card"><h2>+ Relier un ensemble de publicités créé dans Meta</h2><form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/adset" class="grid">
<label>Nom (dans Meta)<input name="name" required></label><label>ID Meta (facultatif)<input name="meta_id"></label><label>Statut dans Meta <small>(saisi)</small>${sel('meta_status', META_STATUSES, 'inconnu')}</label>
<label>Audience souhaitée<input name="brief_audience"></label><label>Langues<input name="brief_languages" placeholder="EN, JA"></label>
<label>Destination<select name="landing">${pageOpts('')}</select></label>
<div style="grid-column:1/-1"><b>Placements souhaités</b><div class="chanlist inline">${Object.entries(CHANNELS).map(([k, ch]) => `<label class="check"><input type="checkbox" name="pl_${k}" value="1"> ${esc(ch.label)}</label>`).join('')}</div></div>
<label>Notes<input name="notes"></label><div><button>Relier l’ensemble</button></div></form></div>
<div class="card"><h2>Résultats et comparaison <span class="tag warn">saisie manuelle</span></h2>
<small>À défaut de connexion à Meta, recopiez ici les chiffres d’Ads Manager par association. Ce sont des repères pour préparer les prochaines variantes, pas une décision automatique.</small>
${compare.length ? `<table><tr><th>Contenu</th><th>Angle</th><th>Audience</th><th>Format</th><th>Affich.</th><th>Clics</th><th>CTR</th><th>Dépense</th><th>CPC</th><th>Résultats</th><th>Coût/résultat</th></tr>${compare.map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(r.angle)}</td><td>${esc(r.audience)}</td><td>${esc(FORMATS[r.format]?.ratio || '')}</td><td>${r.imp}</td><td>${r.clk}</td><td>${r.ctr === null ? '—' : (r.ctr * 100).toFixed(2) + ' %'}</td><td>${num(r.spend)}</td><td>${num(r.cpc)}</td><td>${r.conv}</td><td>${num(r.cpa)}</td></tr>`).join('')}</table>` : '<p><small>Aucun résultat saisi.</small></p>'}
<form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/result" class="grid">
<label>Association<select name="link_id" required><option value="">— choisir —</option>${c.allLinks.map((l) => `<option value="${l.id}">${esc(l.title)} (${esc(FORMATS[l.format]?.ratio || '')}) — ${l.ad_id ? 'annonce' : l.adset_id ? 'ensemble' : 'campagne'} #${l.id}</option>`).join('')}</select></label>
<label>Période<input name="period" placeholder="2027-01-05 → 2027-01-12"></label><label>Affichages<input name="impressions" type="number" min="0"></label><label>Clics<input name="clicks" type="number" min="0"></label>
<label>Dépense<input name="spend" type="number" step="0.01" min="0"></label><label>Résultats<input name="conversions" type="number" min="0"></label><div><button>Ajouter</button></div></form></div>`;
}

// Récapitulatif obligatoire avant « transmis » / « publié »
export function transitionPage(ed, r, campaignId) {
  const rows = Object.entries({ 'Contenu': r.recap.contenu, 'Format': FORMATS[r.recap.format]?.label || r.recap.format, 'Fichier (version épinglée)': r.recap.fichier, 'Version du': fr(r.recap.version_du), 'Niveau visé': `${r.recap.niveau} « ${r.recap.cible} »`, 'Identifiant Meta': r.recap.id_meta, 'Statut Meta connu': r.recap.statut_meta, 'Changement': `${r.recap.de} → ${r.recap.vers}` });
  return `${tabs(ed, 'campagnes')}<h2>Confirmer : « ${esc(r.recap.vers)} »</h2>
<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v || '—')}</td></tr>`).join('')}</table>
${r.errors.map((e) => `<p class="status warn">${esc(e)}</p>`).join('')}${r.warnings.map((e) => `<p class="status warn">${esc(e)}</p>`).join('')}
${r.errors.length ? `<p><a href="/edition/${ed.id}/campaigns/${campaignId}">← Retour à la campagne</a></p>` : `<form method="post" action="/edition/${ed.id}/links/${r.link.id}" class="card">
<input type="hidden" name="state" value="${esc(r.recap.vers)}"><input type="hidden" name="confirm_hash" value="${r.hash}">
<label class="check"><input type="checkbox" required> Je confirme que ce récapitulatif est exact et que j’ai fait (ou fais) cette action dans Meta moi-même.</label>
<button class="primary">Confirmer « ${esc(r.recap.vers)} »</button> <a href="/edition/${ed.id}/campaigns/${campaignId}">Annuler</a></form>`}`;
}

// ------------------------------------------------------------------ sauvegardes (carte des Réglages)
export function backupCard(c) {
  const { status, backups, report, deps, msg } = c;
  const when = status.last ? `${fr(status.last)} (il y a ${Math.floor(status.ageDays)} j)` : 'jamais';
  return `<div class="card"><h2>Sauvegardes</h2>${flash(msg)}
${status.stale ? `<p class="status warn"><b>${status.dir ? 'Aucune sauvegarde récente.' : 'Aucun dossier de sauvegarde externe configuré.'}</b> Tant que tout reste dans le dossier de l’atelier, la perte de cet ordinateur ou de ce disque emporte les projets, les originaux, les designs et les versions.</p>` : '<p class="status ok">Sauvegarde externe à jour.</p>'}
<p>Les données vivent dans <code>data/</code> : <b>atelier.db</b> (projets, fiches, designs, versions, variantes, contenus, campagnes, calendrier, sous-titres), <b>assets/</b> (originaux : photos, vidéos sources, logos, sous-titres, copies des designs), <b>exports/</b> (fichiers produits).</p>
<form method="post" action="/settings/backup-config" class="grid">
<label>Dossier de sauvegarde externe <small>(autre disque, OneDrive, partage réseau…)</small><input name="dir" value="${esc(status.dir)}" placeholder="D:\\Sauvegardes\\Atelier"></label>
<label>Exports à inclure<select name="mode"><option value="pinned"${status.exportsMode === 'pinned' ? ' selected' : ''}>Approuvés, associés à une campagne et archives (recommandé)</option><option value="all"${status.exportsMode === 'all' ? ' selected' : ''}>Tous les exports (volumineux)</option><option value="none"${status.exportsMode === 'none' ? ' selected' : ''}>Aucun (originaux et designs seulement)</option></select></label>
<div><button>Enregistrer</button></div></form>
<div class="inline"><form method="post" action="/settings/backup-now"><button class="primary">Sauvegarder maintenant</button></form><a href="/settings?check=1#sauvegardes">Vérifier l’intégrité et les dépendances</a></div>
<small>Dernière sauvegarde réussie : <b>${esc(when)}</b>. Une sauvegarde est faite automatiquement chaque jour tant que l’atelier est ouvert. Les 8 dernières sont conservées. Les identifiants (WordPress, Buffer, Meta) ne sont <b>jamais</b> sauvegardés.</small>
${backups.length ? `<table><tr><th>Date</th><th>Résultat</th><th>Taille</th><th>Fichiers</th><th>Par</th></tr>${backups.map((b) => `<tr><td>${fr(b.created)}</td><td>${chip(b.status === 'ok' ? 'exporté' : 'erreur')} ${esc(b.status === 'ok' ? '' : b.note)}</td><td>${(b.bytes / 1048576).toFixed(1)} Mo</td><td>${b.files}</td><td>${esc(b.created_by)}</td></tr>`).join('')}</table>` : ''}
${report ? `<h3 id="sauvegardes">Intégrité</h3>${report.ok ? '<p class="status ok">Tout ce que la base référence existe : originaux, designs et exports.</p>' : `<p class="status warn"><b>${report.totalMissing} élément(s) manquant(s) ou altéré(s) :</b></p><ul class="log">${report.missing.map((m) => `<li>${esc(m.what)} — ${esc(m.ref)}</li>`).join('')}</ul>`}
<small>${Object.entries(report.counts).map(([k, v]) => `${v} ${k}`).join(' · ')}</small>` : ''}
${deps ? `<h3>Dépendances</h3><table><tr><th>Élément</th><th>Statut</th><th>Remarque</th></tr>
${deps.items.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.status)}</td><td>${esc(d.note)}</td></tr>`).join('')}
${deps.fonts.map((f) => `<tr><td>Police « ${esc(f.name)} »</td><td>${esc(f.status)}${f.installed ? ' · installée sur ce poste' : ' · non détectée sur ce poste'}</td><td>${esc(f.note)}</td></tr>`).join('')}</table>` : ''}
<details><summary>Restaurer dans une installation vierge</summary><ol><li>Copier le dossier de l’atelier sur le nouvel ordinateur (Node 24+ requis) et y remettre <code>tools/ffmpeg/</code>.</li>
<li>Glisser le fichier <code>atelier-sauvegarde-….zip</code> sur <code>Restaurer.bat</code>. Il vérifie chaque fichier (empreinte SHA-256) <b>avant</b> d’écrire quoi que ce soit, et met de côté toute installation existante.</li>
<li>Lancer <code>Demarrer.bat</code>, ressaisir les identifiants dans Réglages, réinstaller les polices signalées ci-dessus.</li></ol></details></div>`;
}

// ------------------------------------------------------------------ « À faire maintenant » (une personne seule, peu de temps)
export function todoCard(items) {
  if (!items.length) return '<div class="card todo"><h2>À faire maintenant</h2><p>✅ Rien d’urgent. Les variantes et les campagnes de ce projet sont à jour.</p></div>';
  return `<div class="card todo"><h2>À faire maintenant</h2><ul class="log todo">${items.map((i) => `<li class="${i.level}">${i.level === 'urgent' ? '🔴' : '▸'} <a href="${esc(i.href)}">${esc(i.text)}</a></li>`).join('')}</ul></div>`;
}

// ------------------------------------------------------------------ le site WordPress du projet
export function sitePage(ed, c) {
  const { site, msg } = c;
  const done = STEPS.filter(([k]) => site.steps[k]).length;
  return `${tabs(ed, 'site')}${flash(msg)}
<p class="lead">Chaque projet possède <b>son propre site WordPress</b>, sur <b>son propre domaine</b>. Les campagnes Meta y renvoient (plusieurs campagnes peuvent viser le même site) mais ne le créent ni ne le pilotent. Les autres sites (par exemple celui d’Acoustiguide) ne servent que d’exemples : ils ne sont jamais regroupés avec celui-ci.</p>
<div class="card"><h2>Identité du site</h2>
<form method="post" action="/edition/${ed.id}/site/save" class="grid">
<label>Nom de domaine <small>(sans https://)</small><input name="domain" value="${esc(site.domain)}" placeholder="ex. monspectacle.com"></label>
<label>Où en est le site<select name="environment">${ENVIRONMENTS.map(([k, n]) => opt(k, n, site.environment)).join('')}</select></label>
<label>État<select name="status">${SITE_STATUSES.map((s) => opt(s, s, site.status)).join('')}</select></label>
<label>Notes<input name="notes" value="${esc(site.notes)}"></label><div><button>Enregistrer</button></div></form>
${site.environment === 'production' ? '<p class="status warn"><b>Site en production.</b> L’atelier ne modifie jamais un site en ligne sans demande explicite de votre part ; il prépare toujours des <b>brouillons</b>.</p>' : ''}</div>
<div class="card"><h2>Connexion WordPress de ce projet <span class="tag warn">champs sécurisés</span></h2>
<p>Ces valeurs sont propres à <b>ce projet</b>, stockées uniquement sur cet ordinateur, <b>jamais réaffichées</b>, jamais incluses dans une sauvegarde. Ne les envoyez jamais dans une conversation ou un e-mail. Elles ne servent que lorsque la création des pages en brouillon sera branchée (voir plus bas).</p>
${PROJECT_DEFS.map((d) => { const set = isSet(d.key, 'p' + ed.id), pv = preview(d, 'p' + ed.id); return `<form method="post" action="/edition/${ed.id}/site/secret" class="secret"><input type="hidden" name="key" value="${d.key}">
<label>${esc(d.label)} ${set ? '<span class="tag st-2">enregistré</span>' : '<span class="tag">non renseigné</span>'}${pv ? `<small>Valeur actuelle : ${esc(pv)}</small>` : ''}
<input name="value" type="${d.secret ? 'password' : 'text'}" autocomplete="off" placeholder="${set ? 'Saisir pour remplacer' : 'Saisir la valeur'}">${d.help ? `<small>${esc(d.help)}</small>` : ''}</label><button>Enregistrer</button>${set ? '<button name="clear" value="1" class="link">Effacer</button>' : ''}</form>`; }).join('')}</div>
<div class="card"><h2>Aperçu des pages</h2>
<p>Un aperçu fabriqué depuis la fiche du projet, pour <b>valider le contenu et la structure</b> avant de construire le vrai site WordPress. Sections affichées ou masquées : fiche, section « Options du site ».</p>
<p>${SITE_PAGES.map(([k, n]) => `<a class="btn sm" target="_blank" href="/site/${ed.id}/${k === 'home' ? '' : k}">${esc(n)}</a>`).join(' ')}</p></div>
<div class="card"><h2>Plan de construction <small>(${done}/${STEPS.length})</small></h2>
<form method="post" action="/edition/${ed.id}/site/steps">${STEPS.map(([k, n]) => `<label class="check"><input type="checkbox" name="step_${k}" value="1"${site.steps[k] ? ' checked' : ''}> ${esc(n)}</label>`).join('')}<button>Enregistrer l’avancement</button></form>
<small>Ce plan est un pense-bête : il ne déclenche rien. Le dernier point (mise en ligne) reste toujours une décision de votre part.</small></div>
<div class="card"><h2>Ce que l’atelier fera, et ce qu’il ne fait pas encore</h2>
<ul><li><b>Déjà</b> : aperçu des pages, charte (couleurs, polices) et informations du projet, identifiants propres au projet.</li>
<li><b>Pas encore</b> : création des pages WordPress en brouillon depuis le projet, thème du site, billetterie. Ils se construisent une fois le domaine et l’hébergement choisis.</li>
<li><b>Jamais</b> : publier ou modifier un site en ligne sans votre demande explicite.</li></ul></div>`;
}
