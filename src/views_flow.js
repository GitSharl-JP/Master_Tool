// Pages du parcours de production : variantes, calendrier, contenus, campagnes, transmission, sauvegardes.
import { esc, fr, tabs, entryCards, workspaceHeader } from './views.js';
import { FORMATS, CHANNELS, VIDEO_FORMATS } from './formats.js';
import { INTENTS, STAGES, variantType } from './variants.js';
import { OFF_CAMPAIGN, META_STATUSES, CONTENT_STATUSES, LINK_STATES, OBJECTIVES, isFrozenState, coverage, trackedUrl, metaInfo } from './campaigns.js';
import { KINDS, PLAN_STATUSES, monthGrid, shiftMonth, today } from './plan.js';
import { SITE_PAGES } from './render.js';
import { adSheet, META_OBJECTIVES, META_CTAS, LIMITS, GUIDE_STEPS, placementsHelp, suggestAdsetName, suggestAdName } from './metaguide.js';
import { PROJECT_DEFS, isSet, preview } from './secrets.js';
import { ENVIRONMENTS, SITE_STATUSES, STEPS } from './site.js';

const sel = (name, list, cur, attrs = '') => `<select name="${name}"${attrs}>${list.map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
const chip = (s) => `<span class="tag ${['approuvé', 'exporté', 'transmis', 'publié', 'fait'].includes(s) ? 'st-2' : ['à relire', 'bloqué', 'erreur'].includes(s) ? 'warn' : ''}">${esc(s)}</span>`;
const fmtTag = (f) => (f && FORMATS[f] ? `<span class="tag">${esc(FORMATS[f].ratio)}</span>` : '');
const flash = (m) => (m ? `<p class="flash">${esc(m)}</p>` : '');
const userOpts = (users, cur) => `<option value="">—</option>${users.map((u) => opt(u, u, cur)).join('')}`;

// Statut tel que Meta le déclare : toujours dire d'où vient l'information.
const metaChip = (row) => {
  const m = metaInfo(row);
  if (m.manual && m.status === 'inconnu' && !row.meta_id) return '<span class="tag" title="Rien n’a encore été saisi depuis Meta : c’est normal tant que la campagne n’y est pas créée.">pas encore dans Meta</span>';
  return `<span class="tag ${m.status === 'active' ? 'st-2' : ''}">${esc(m.status)}</span> <span class="tag warn">${m.manual ? 'saisi à la main' : 'synchronisé ' + fr(m.syncedAt)}</span>`;
};

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
export function variantsPage(ed, { rows, total, campaigns, msg, filter }) {
  const camp = (id) => campaigns.find((c) => c.id === id);
  const active = filter.q || filter.type || filter.status || filter.campaign;
  const so = (name, list, cur) => `<select name="${name}" onchange="this.form.submit()">${list.map(([v, l]) => opt(v, l, cur)).join('')}</select>`;
  return `${tabs(ed, 'variantes')}${flash(msg)}
<p class="lead">Tout ce que vous fabriquez : affiches, vidéos et textes, au même endroit. Ouvrez un contenu pour le terminer étape par étape ; ses formats, versions et fichiers exportés restent dans sa page.</p>
<div class="inline"><a class="btn primary" href="/edition/${ed.id}/variants/new${filter.campaign ? '?campaign=' + filter.campaign : ''}">+ Ajouter un contenu</a></div>
<form method="get" class="filters inline">
<input type="search" name="q" value="${esc(filter.q)}" placeholder="Rechercher par nom">
${so('type', [['', 'Tous les types'], ['affiche', 'Affiches'], ['video', 'Vidéos'], ['texte', 'Textes']], filter.type)}
${so('status', [['', 'Statuts actifs'], ['brouillon', 'Brouillon'], ['à relire', 'À relire'], ['approuvé', 'Approuvé'], ['archivé', 'Archivés']], filter.status)}
${so('campaign', [['', 'Toutes les campagnes'], ...campaigns.map((c) => [c.id, c.name])], filter.campaign)}
<button>Filtrer</button>${active ? ` <a href="/edition/${ed.id}/variants">Tout afficher</a>` : ''}</form>
<p><small>${rows.length} contenu(s)${active ? ` sur ${total}` : ''}.</small></p>
${rows.map((r) => `<div class="card vcard"><div class="vtop"><h2><a href="${r.href}">${esc(r.name)}</a> <span class="tag">${esc(r.type)}</span> ${chip(r.status)}</h2>
<small>${r.campaigns.length ? 'campagne « ' + esc(r.campaigns.map((id) => camp(id)?.name || '?').join(' », « ')) + ' »' : 'hors campagne'}${r.files ? ' · ' + esc(r.files) : ''} · modifié ${fr(r.updated)}</small></div>
${r.next ? `<p class="rownext">${esc(r.next)} <a class="btn sm" href="${r.href}">Ouvrir</a></p>` : ''}</div>`).join('') || (active ? '<p>Aucun contenu ne correspond à ces filtres.</p>' : '<p>Aucun contenu pour l’instant. Créez le premier depuis le bouton ci-dessus.</p>')}`;
}

export function variantNewPage(ed, c) {
  const { campaigns, adsets, assets, templates, users, values: raw = {}, error, who, solo, prefill = {} } = c;
  const v = { ...prefill, ...raw };
  const presetFormats = c.preset?.formats || ['4x5', '9x16'];
  const imgs = assets.filter((a) => a.kind === 'image'), videos = assets.filter((a) => a.kind === 'video');
  const fmts = Object.keys(FORMATS);
  return `${tabs(ed, 'variantes')}${error ? `<p class="status warn">${esc(error)}</p>` : ''}
<h2>Nouveau contenu — mode test détaillé</h2>
<form method="post" action="/edition/${ed.id}/variants/new" class="vwizard" id="vform2">
<div class="card"><h2>1 · Pourquoi ce contenu ?</h2>
${Object.entries(INTENTS).map(([k, i]) => `<label class="check intent"><input type="radio" name="intent" value="${k}" data-hyp="${esc(i.hypothesis)}" data-needs="${i.needs.join(',')}"${v.intent === k ? ' checked' : ''} required> <span><b>${esc(i.label)}</b><br><small>${esc(i.help)}</small></span></label>`).join('')}</div>
<div class="card"><h2>2 · Ce qui change et ce qu’on veut apprendre</h2><div class="grid">
<label>Nom du contenu<input name="name" value="${esc(v.name)}" placeholder="Ex. Famille — émerveillement" required></label>
<label><span>Angle créatif <small data-need="angle"></small></span><input name="angle" value="${esc(v.angle)}" placeholder="Ex. émerveillement, exclusivité, dernières places"></label>
<label><span>Audience visée <small data-need="audience"></small></span><input name="audience" value="${esc(v.audience)}" placeholder="Ex. familles, couples, touristes"></label>
<label><span>Langue <small data-need="language"></small></span><input name="language" value="${esc(v.language)}" placeholder="Ex. EN, JA"></label></div>
<label><span>Hypothèse à tester <small>— une phrase qu’on pourra confirmer ou infirmer avec les résultats</small></span><textarea name="hypothesis" id="hyp" rows="2" required>${esc(v.hypothesis)}</textarea></label></div>
<div class="card"><h2>3 · Campagne et responsables</h2><div class="grid">
<label><span>Campagne Meta reliée <small>(facultatif : un contenu peut exister sans campagne)</small></span><select name="campaign_id"><option value="">Aucune (organique / réserve)</option>${campaigns.map((x) => opt(x.id, x.name, v.campaign_id || c.preset?.campaign_id)).join('')}</select></label>
<label>Ensemble de publicités<select name="adset_id"><option value="">—</option>${adsets.map((x) => opt(x.id, `${x.campaign_name} › ${x.name}`, v.adset_id || c.preset?.adset_id)).join('')}</select></label>
${solo ? `<input type="hidden" name="owner" value="${esc(who)}">` : `<label>Responsable<select name="owner">${userOpts(users, v.owner || who)}</select></label>
<label><span>Relecteur <small>(facultatif)</small></span><select name="reviewer">${userOpts(users, v.reviewer)}</select></label>`}</div></div>
<div class="card"><h2>4 · Point de départ</h2>${imgs.some((a) => a.role === 'poster') ? '' : '<small>Vous avez reçu une affiche déjà faite (SVG, PNG, JPG) ? Envoyez-la depuis l’onglet <a href="/edition/' + ed.id + '/poster/4x5">Affiches</a> ou <a href="/edition/' + ed.id + '/assets">Assets</a> (rôle « Affiche reçue »), elle apparaîtra ici.</small>'}<div class="grid">
<label><span>Affiche reçue <small>(facultatif — remplace les affiches composées par l’atelier)</small></span><select name="poster"><option value="">Non : composer avec l’atelier</option>${imgs.filter((a) => a.role === 'poster').map((a) => opt(a.id, a.name + (a.provisional ? ' (provisoire)' : ''), v.poster)).join('')}</select></label>
<label>Design<select name="design_version"><option value="">Réglages actuels des affiches du projet</option>${templates.map((t) => opt(t.version_id, `${t.name} — v${t.version}`, v.design_version)).join('')}</select></label>
<label>Photo de fond<select name="hero"><option value="">Celle du design</option>${imgs.filter((a) => a.role !== 'logo').map((a) => opt(a.id, a.name + (a.provisional ? ' (provisoire)' : ''), v.hero)).join('')}</select></label>
<label>Logo<select name="logo"><option value="">Celui du design</option>${imgs.filter((a) => a.role === 'logo').map((a) => opt(a.id, a.name, v.logo)).join('')}</select></label></div></div>
${v.source_text ? `<details class="card" open><summary><b>Texte de départ : ${esc(v.source_title || 'contenu')}</b></summary><pre class="srctext">${esc(v.source_text)}</pre><small>À relire en remplissant les champs ci-dessous (angle, audience, hypothèse, textes). Rien n’est repris automatiquement.</small></details>` : ''}
<div class="card"><h2>5 · Textes de ce contenu</h2><small>Laissez vide pour garder le texte de la fiche (sans effet sur une affiche reçue : ses textes sont dans l’image). Vous pourrez tout retoucher ensuite, format par format, directement sur l’aperçu.</small><div class="grid">
<label>Titre<input name="msg_title" value="${esc(v.msg_title)}"></label><label>Accroche<input name="msg_tagline" value="${esc(v.msg_tagline)}"></label>
<label>Phrase du haut<input name="msg_top" value="${esc(v.msg_top)}"></label><label>Bouton<input name="msg_cta" value="${esc(v.msg_cta)}" placeholder="Ex. Book your tickets"></label></div></div>
<div class="card"><h2>6 · Sorties</h2><div class="chanlist inline">${fmts.map((k) => `<label class="check"><input type="checkbox" name="fmt_${k}" value="1"${v['fmt_' + k] || (!Object.keys(raw).length && presetFormats.includes(k)) ? ' checked' : ''}> ${esc(FORMATS[k].label)}</label>`).join('')}</div>
<label class="check"><input type="checkbox" name="with_video" value="1"${v.with_video ? ' checked' : ''}> Prévoir aussi une vidéo (sous-titres propres à ce contenu)</label>
<label>Vidéo source<select name="video_asset"><option value="">Celle du projet</option>${videos.map((a) => opt(a.id, a.name, v.video_asset)).join('')}</select></label></div>
<button class="primary">Créer la variante</button> <a href="/edition/${ed.id}/variants">Annuler</a></form>`;
}

export function variantPage(ed, c) {
  const { v, outputs, versions, pristine, campaigns, adsets, users, planItems, msg, exportResult, templates, solo, next, checksList = [], autoLabel, ws, assets = [], design0 = null, vdesign = null } = c;
  const step = ["materiel", "creation", "verification", "diffusion"].includes(c.step) ? c.step : "verification";
  const exportable = v.status === 'approuvé' && pristine;
  const nextBanner = next ? `<div class="next"><b>Prochaine étape</b> — ${esc(next.text)}
${next.action === 'approve-export' ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/approve-export" class="inline"><button class="primary">${esc(next.label)}</button></form>` : ''}
${next.action === 'export' ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/export" class="inline"><button class="primary">${esc(next.label)}</button></form>` : ''}
${next.action === 'link-auto' ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/link" class="inline"><input type="hidden" name="target" value="auto"><button class="primary">${esc(next.label)}${autoLabel ? ' : ' + esc(autoLabel) : ''}</button></form>` : ''}
${!next.action && next.href ? `<a class="btn" href="${esc(next.href)}">${esc(next.label || 'Ouvrir')}</a>` : ''}</div>` : '';
  const checksCard = `<div class="card"><h2>Contrôles automatiques avant approbation</h2>${checksList.length
    ? `<ul class="log checks">${checksList.map((k) => `<li class="${k.level}">${k.level === 'bloquant' ? '🔴 <b>À corriger</b>' : k.level === 'transmission' ? '🟠 <b>Bloque la transmission</b>' : '🟡 <b>À savoir</b>'} — ${esc(k.text)} ${k.href ? `<a href="${esc(k.href)}">${k.level === 'conseil' ? 'voir' : 'corriger'}</a>` : ''}</li>`).join('')}</ul><small>« À corriger » empêche d’approuver · « Bloque la transmission » : on peut approuver et exporter (brouillon), pas transmettre ni publier · « À savoir » : avertissement. La préparation et les exports d’essai restent possibles.</small>`
    : '<p>✅ Aucun problème détecté : photo, titre, formats et vidéo sont en ordre.</p>'}</div>`;
  const why = v.status === 'archivé' ? 'Ce contenu est archivé.' : v.status !== 'approuvé' ? 'Le contenu doit d’abord être approuvé.' : !pristine ? 'Le contenu a changé depuis son approbation : relisez puis approuvez à nouveau.' : '';
  const P_INTENT = `<div class="card"><h2>${esc(v.name)} ${chip(v.status)} ${v.approved_version ? `<span class="tag">version approuvée : v${v.approved_version}</span>` : ''}</h2>
${v.approved_version && !pristine ? `<p class="status warn">Ce contenu a été <b>modifiée depuis son approbation</b>. La version approuvée <b>v${v.approved_version}</b> et ses exports sont <b>intacts</b> ; la version en cours de travail attend une nouvelle relecture. <form method="post" action="/edition/${ed.id}/variants/${v.id}/restore" class="inline"><input type="hidden" name="version" value="${v.approved_version}"><button class="link">Revenir à la version approuvée v${v.approved_version}</button></form></p>` : ''}
<form method="post" action="/edition/${ed.id}/variants/${v.id}/update" class="grid">
<label>Nom<input name="name" value="${esc(v.name)}"></label><label>Angle<input name="angle" value="${esc(v.angle)}"></label>
<label>Audience visée<input name="audience" value="${esc(v.audience)}"></label><label>Langue<input name="language" value="${esc(v.language)}"></label>
<label style="grid-column:1/-1">Hypothèse à tester<textarea name="hypothesis" rows="2">${esc(v.hypothesis)}</textarea></label>
<label>Campagne<select name="campaign_id"><option value="">Aucune (organique / réserve)</option>${campaigns.map((x) => opt(x.id, x.name, v.campaign_id)).join('')}</select></label>
<label>Ensemble<select name="adset_id"><option value="">—</option>${adsets.map((x) => opt(x.id, `${x.campaign_name} › ${x.name}`, v.adset_id)).join('')}</select></label>
${solo ? '' : `<label>Responsable<select name="owner">${userOpts(users, v.owner)}</select></label><label><span>Relecteur <small>(facultatif)</small></span><select name="reviewer">${userOpts(users, v.reviewer)}</select></label>`}
<div><button>Enregistrer l’intention</button></div></form>
<small>${esc(INTENTS[v.intent]?.label)} · créée par ${esc(v.created_by)} le ${fr(v.created)}</small></div>`;
  const P_TEXTES = `<div class="card" id="textes"><h2>Textes du contenu</h2><small>Appliqués à tous les formats ; retouchez ensuite un format précis directement sur son aperçu.</small>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/messages" class="grid">
<label>Titre<input name="msg_title" value="${esc(v.msg_title)}"></label><label>Accroche<input name="msg_tagline" value="${esc(v.msg_tagline)}"></label>
<label>Phrase du haut<input name="msg_top" value="${esc(v.msg_top)}"></label><label>Bouton<input name="msg_cta" value="${esc(v.msg_cta)}"></label>
<div><button>Appliquer aux formats</button></div></form></div>`;
  const es = ws.status;
  const fmtLabel = (f) => FORMATS[f]?.label || f;
  const P_ETATS = es ? `<div class="card"><h2>Où en est ce contenu ?</h2><p><b>${esc(es.summary)}</b></p>
<details${es.errors.length || (v.approved_version && !es.complete) ? ' open' : ''}><summary>Détail des états</summary><ul class="etats">
<li><b>Création</b><span>${esc(es.creation)}</span></li>
<li><b>Exports</b><span>${esc(es.state)}${es.total ? ` — ${es.have}/${es.total} fichier(s)` : ''}</span></li>
<li><b>Préparation à la diffusion</b><span>${es.prep === 'informations manquantes' ? 'informations manquantes : ' + esc(es.blockers.join(' ; ') || 'des fichiers sont en BROUILLON') : esc(es.prep)}</span></li>
<li><b>Diffusion</b><span>${esc(es.diff)}</span></li></ul>
<small>Une approbation ne prouve ni la réussite d’un export ni une publication : chaque ligne est calculée à part.</small></details>
${es.errors.map((e) => `<p class="status warn ko">⚠ ${esc(fmtLabel(e.fmt))} : ${esc(e.message)}</p>`).join('')}
${v.approved_version && !es.complete && !es.running ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/export" class="inline"><button class="primary"${exportable ? '' : ' disabled'}>Reprendre l’export (${es.missing.length} fichier(s) manquant(s))</button><small>Seuls les fichiers manquants sont refaits : pas de doublon.</small></form>` : ''}</div>` : '';
  const P_SORTIES = `<div class="card"><h2>Sorties</h2>
${outputs.map((o) => `<div class="out">${o.kind === 'video' ? '<div class="vthumb vid"><span>vidéo</span></div>' : thumb(ed, o.fmt, v.id)}
<div class="outm"><b>${o.kind === 'video' ? 'Vidéo' : esc(FORMATS[o.fmt].label)}</b> ${stepper(o.stage)}
${o.frozen ? '<span class="tag st-2">🔒 version diffusée figée</span>' : ''}
<p><a class="btn sm" href="${o.kind === 'video' ? `/edition/${ed.id}/video?variant=${v.id}` : `/edition/${ed.id}/poster/${o.fmt}?variant=${v.id}`}">Ajuster (textes, cadrage${o.kind === 'video' ? ', sous-titres' : ''})</a></p>
${o.exports.map((e) => `<small>Export v${e.variant_version} du ${fr(e.created)} ${e.draft ? '<span class="tag warn">BROUILLON</span>' : ''} — <a href="/exports/${e.id}?dl=1">télécharger</a></small>`).slice(0, 2).join('<br>')}
${o.trial ? `<small>Essai (non officiel) du ${fr(o.trial.created)} — <a href="/exports/${o.trial.id}" target="_blank">voir</a></small>` : ''}
${o.links.map((l) => `<small>${chip(l.state)} ${l.ad_name ? 'annonce « ' + esc(l.ad_name) + ' »' : l.adset_name ? 'ensemble « ' + esc(l.adset_name) + ' »' : 'campagne « ' + esc(l.campaign_name) + ' »'}</small>`).join('<br>')}</div></div>`).join('')}
${STAGE_LEGEND}</div>`;
  const who = v.owner || v.reviewer ? '' : '';
  const P_RESP = `<div class="card"><h2>Qui s’en occupe ?</h2>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/assign" class="grid">
<label>Responsable du contenu<select name="owner">${userOpts(users, v.owner)}</select></label>
<label><span>Relecteur <small>(facultatif)</small></span><select name="reviewer">${userOpts(users, v.reviewer)}</select></label>
<label>Échéance<input type="date" name="due_date" value="${esc(v.due_date || '')}"></label>
<div><button>Enregistrer</button></div></form>
<small>${v.status === 'archivé' ? '' : (v.status === 'à relire' ? v.reviewer || v.owner : v.owner) ? `Prochaine action attendue : <b>${esc(v.status === 'à relire' ? v.reviewer || v.owner : v.owner)}</b>.` : 'Personne n’est désigné : n’importe qui peut approuver.'} Aucune validation à deux n’est obligatoire.</small></div>`;
  const P_VALID = `${checksCard}
${P_RESP}
<div class="card"><h2>Validation</h2>
<p>« Approuver » <b>fige une version</b> (textes, cadrages, sous-titres, informations de la fiche à cet instant). Les exports officiels partent <b>toujours</b> de cette version. Si vous modifiez ensuite le contenu, il repasse « à relire » sans toucher à la version approuvée. Les contrôles ci-dessus assistent la relecture : ils ne garantissent ni la qualité artistique, ni la traduction, ni l’exactitude commerciale. Un relecteur est facultatif ; « mettre de côté » sert à relire plus tard avec un regard neuf.</p>
<div class="inline">
<form method="post" action="/edition/${ed.id}/variants/${v.id}/approve-export" class="inline"><input name="note" placeholder="Note de version (facultatif)"><button class="primary"${v.status === 'archivé' ? ' disabled' : ''}>Approuver et exporter</button></form>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/approve"><button${v.status === 'archivé' ? ' disabled' : ''}>Approuver seulement</button></form>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/review"><button class="link"${v.status === 'approuvé' || v.status === 'archivé' ? ' disabled' : ''}>Mettre de côté pour relire plus tard</button></form></div>
${versions.length ? `<ul class="log">${versions.map((x) => `<li><b>v${x.version}</b> approuvée par ${esc(x.approved_by)} le ${fr(x.approved_at)}${x.note ? ' · ' + esc(x.note) : ''}
<form method="post" action="/edition/${ed.id}/variants/${v.id}/restore" class="inline"><input type="hidden" name="version" value="${x.version}"><button class="link">Restaurer cette version</button></form></li>`).join('')}</ul>` : '<small>Aucune version approuvée.</small>'}</div>`;
  const hasPostersV = v.formats.length > 0;
  const P_EXP = `<div class="card"><h2>Exports finaux de la version approuvée${v.approved_version ? ' (v' + v.approved_version + ')' : ''}</h2>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/export"><input type="hidden" name="sel" value="1">
<div class="chanlist inline">${outputs.map((o) => `<label class="check"><input type="checkbox" name="o_${o.kind === 'video' ? 'video' : o.fmt}" value="1" checked${exportable ? '' : ' disabled'}> ${o.kind === 'video' ? 'Vidéo' : esc(FORMATS[o.fmt].label)}</label>`).join('')}</div>
<button class="primary"${exportable ? '' : ' disabled'}>Exporter les sorties cochées${v.approved_version ? ' (v' + v.approved_version + ')' : ''}</button></form>
${exportable ? '<small>Un export identique à un export existant n’est pas refait : pas de doublon. Un nouvel export ne remplace jamais l’ancien ni une association à une campagne.</small>' : `<small>${esc(why)}</small>`}
${exportResult ? `<ul class="log">${exportResult.map((o) => `<li>${esc(o.fmt)} : ${esc(o.state)}</li>`).join('')}</ul>` : ''}
${v.approved_version && hasPostersV ? `<p><b>Fichiers éditables (Illustrator)</b> de la version approuvée v${v.approved_version} : ${v.formats.map((f) => `${esc(FORMATS[f].ratio)} <a href="/edition/${ed.id}/poster/${f}/svg?variant=${v.id}&approved=1">SVG</a> · <a href="/edition/${ed.id}/poster/${f}/pdf?variant=${v.id}&approved=1">PDF</a>`).join(' &nbsp;|&nbsp; ')}<br><small>Produits depuis la version approuvée, jamais depuis le brouillon en cours.</small></p>` : ''}</div>`;
  const P_ASSOC = `<div class="card"><h2>Associer à une campagne</h2>
<small>Associe les sorties <b>exportées</b> de la version approuvée à un niveau de la campagne. Chaque association est épinglée sur un export précis et démarre en <b>brouillon</b> : rien n’est transmis.</small>
${v.campaign_id && autoLabel ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/link" class="inline"><input type="hidden" name="target" value="auto"><button class="primary">Associer à ${esc(autoLabel)}</button></form><small>ou choisir un autre niveau :</small>` : ''}
<form method="post" action="/edition/${ed.id}/variants/${v.id}/link" class="inline">
<select name="target" required><option value="">Choisir le niveau…</option>${campaigns.map((x) => `<option value="campaign_id:${x.id}">Campagne : ${esc(x.name)}</option>${(adsets.filter((a) => a.campaign_id === x.id)).map((a) => `<option value="adset_id:${a.id}">&nbsp;&nbsp;Ensemble : ${esc(a.name)}</option>`).join('')}`).join('')}</select>
<button>Associer en brouillon</button></form>
${v.campaign_id ? `<small>Suite du parcours (relecture, transmission, publication) : <a href="/edition/${ed.id}/campaigns/${v.campaign_id}">page de la campagne</a>.</small>` : ''}</div>`;
  const P_PLAN = `<div class="card"><h2>Planning</h2>
${planItems.length ? `<ul class="log">${planItems.map((p) => `<li><b>${esc(p.due_date)}</b> ${esc(p.title)} ${chip(p.status)} <small>${esc(p.owner)}</small></li>`).join('')}</ul><a href="/edition/${ed.id}/calendar">Ouvrir le calendrier</a>`
    : `<form method="post" action="/edition/${ed.id}/variants/${v.id}/plan" class="inline"><label>Date de publication visée<input type="date" name="publish" required></label><button>Planifier à rebours</button></form><small>Crée les étapes (préparer, relire, approuver, exporter, transmettre, publier) en remontant le temps depuis cette date.</small>`}</div>`;
  const P_DUP = `<div class="card"><h2>Dupliquer pour une nouvelle intention</h2>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/duplicate" class="grid">
<label>Nom du nouveau test<input name="name" required></label><label>Angle<input name="angle" value="${esc(v.angle)}"></label>
<label>Audience<input name="audience" value="${esc(v.audience)}"></label><label>Langue<input name="language" value="${esc(v.language)}"></label>
<label style="grid-column:1/-1">Hypothèse<textarea name="hypothesis" rows="2" required></textarea></label><div><button>Dupliquer</button></div></form>
<small>Au moins l’angle, l’audience ou la langue doit changer : sinon vous obtiendriez une version presque identique.</small>
${v.status !== 'archivé' ? `<form method="post" action="/edition/${ed.id}/variants/${v.id}/archive" class="inline"><button class="link">Archiver ce contenu</button></form>` : ''}</div>`;

  const base = `/edition/${ed.id}/variants/${v.id}`;
  const imgs = assets.filter((a) => a.kind === 'image'), posters = assets.filter((a) => a.kind === 'image' && a.role === 'poster');
  const next2 = (to, label) => `<p class="stepnext"><a class="btn primary" href="${base}?step=${to}">${label} →</a></p>`;
  const optA = (list, cur, none) => `<option value="">${none}</option>${list.map((a) => `<option value="${a.id}"${String(a.id) === String(cur) ? ' selected' : ''}>${esc(a.name)}${a.provisional ? ' (provisoire)' : ''}</option>`).join('')}`;
  const hasPosters = v.formats.length > 0, hasVideo = !!v.with_video;
  const nameOf = (id) => (id ? assets.find((a) => String(a.id) === String(id))?.name : '');
  // --- Matériel : tout ce qui alimente le contenu, sans quitter cet espace
  const materiel = `
<div class="card"><h2>Ajouter un fichier</h2><small>Photo, logo, affiche déjà faite ou vidéo : ajoutez-le d’abord à la bibliothèque du projet, vous choisissez ensuite où il sert. <b>Un même fichier peut être à la fois photo de fond et logo</b>, sans le renvoyer.</small>
<form class="upm dropbox" data-edition="${ed.id}" data-variant="${v.id}"><input type="hidden" name="what" value="add"><p><b>Glissez-déposez vos fichiers ici</b>, un seul ou plusieurs</p>
<label class="btn primary filebtn">Choisir des fichiers<input type="file" multiple hidden></label></form><p class="upmsg"></p></div>
${hasPosters ? `<div class="card"><h2>Affiche</h2>
${design0?.ext ? `<p class="status ok">Affiche reçue en place : <b>${esc(assets.find((a) => String(a.id) === String(design0.ext))?.name || 'fichier')}</b>. Ses textes sont dans l’image.</p>
<form method="post" action="${base}/material" class="inline"><input type="hidden" name="poster" value="none"><button class="link">Revenir à une affiche composée par l’atelier</button></form>` : `<p>Photo de fond : <b>${esc(nameOf(design0?.hero) || 'aucune')}</b> · Logo : <b>${esc(nameOf(design0?.logo) || 'aucun')}</b> <small>— cliquez sur un fichier ci-dessous ; recliquez pour retirer.</small></p>`}
${imgs.length ? `<div class="matgrid">${imgs.filter((a) => a.role !== 'partner').slice(0, 18).map((a) => {
  const isH = String(design0?.hero) === String(a.id), isL = String(design0?.logo) === String(a.id), isP = String(design0?.ext) === String(a.id);
  const mat = (field, label, on, off) => `<form method="post" action="${base}/material"><input type="hidden" name="${field}" value="${on ? off : a.id}"><button class="sm${on ? ' on' : ''}">${on ? '✓ ' : ''}${label}</button></form>`;
  return `<div class="matitem${a.warn ? ' warn' : ''}"><img src="/files/${a.id}" alt=""><span class="name" title="${esc(a.name)}">${esc(a.name)}${a.provisional ? ' (provisoire)' : ''}</span>${a.warn ? '<small class="why">⚠ vide ou transparent : il n’apparaîtra pas</small>' : ''}<div class="inline">${design0?.ext ? '' : mat('hero', 'Photo de fond', isH, '') + mat('logo', 'Logo', isL, '')}${mat('poster', 'Affiche reçue', isP, 'none')}</div></div>`;
}).join('')}</div>` : '<p><small>Aucune image dans ce projet pour l’instant : ajoutez un fichier ci-dessus.</small></p>'}
${templates.length ? `<form method="post" action="${base}/material" class="inline"><select name="design_version" required><option value="">Reprendre un design enregistré…</option>${templates.map((t) => opt(t.version_id, `${t.name} — v${t.version}`, '')).join('')}</select><button>Appliquer</button></form><small>Un design enregistré remplace la composition ; vos textes sont conservés. L’original n’est jamais modifié.</small>` : '<small>Aucun design enregistré pour l’instant (Bibliothèque › Designs et modèles).</small>'}</div>` : ''}
${hasVideo ? `<div class="card"><h2>Vidéo</h2><form method="post" action="${base}/material" class="inline"><select name="video_asset" required>${optA(assets.filter((a) => a.kind === 'video'), vdesign?.asset, 'Choisir la vidéo source…')}</select><button>Utiliser cette vidéo</button></form></div>` : ''}
${hasVideo ? `<div class="card"><h2>Formats de la vidéo</h2><form method="post" action="${base}/material" class="vwizard"><input type="hidden" name="set_vformats" value="1">
<div class="chanlist inline">${VIDEO_FORMATS.map((k) => `<label class="check"><input type="checkbox" name="vfmt_${k}" value="1"${(vdesign?.formats?.length ? vdesign.formats : ['9x16']).includes(k) ? ' checked' : ''}> ${esc(FORMATS[k].label)}</label>`).join('')}</div>
<button>Enregistrer les formats vidéo</button></form><small>Une vidéo par format coché, recadrée pour chacun.</small></div>` : ''}
${hasPosters ? `<div class="card"><h2>Formats de l’affiche</h2><form method="post" action="${base}/material" class="vwizard"><input type="hidden" name="set_formats" value="1">
<div class="chanlist inline">${Object.keys(FORMATS).map((k) => `<label class="check"><input type="checkbox" name="fmt_${k}" value="1"${v.formats.includes(k) ? ' checked' : ''}> ${esc(FORMATS[k].label)}</label>`).join('')}</div>
<label class="check"><input type="checkbox" name="with_video" value="1"${hasVideo ? ' checked' : ''}> Avec aussi une vidéo</label><button>Enregistrer les formats</button></form></div>`
  : `<details class="card"><summary><b>Ajouter aussi des affiches</b> <small>(images fixes tirées de la même campagne)</small></summary><form method="post" action="${base}/material" class="vwizard"><input type="hidden" name="set_formats" value="1"><input type="hidden" name="with_video" value="1">
<div class="chanlist inline">${Object.keys(FORMATS).map((k) => `<label class="check"><input type="checkbox" name="fmt_${k}" value="1"> ${esc(FORMATS[k].label)}</label>`).join('')}</div><button>Ajouter ces affiches</button></form></details>`}
${next2('creation', 'Continuer vers la création')}`;
  const SAVE_MODEL = `<details class="card"><summary><b>Enregistrer comme modèle</b> <small>(réutilisable dans « Créer un contenu »)</small></summary>
<form method="post" action="${base}/save-model" class="grid"><label>Nom du modèle<input name="name" value="${esc(v.name)}"></label>
<label>Ajouter à un modèle existant<select name="templateId"><option value="">— nouveau modèle —</option>${(c.models || []).map((m) => `<option value="${m.id}">${esc(m.name)} (v${m.last_version})</option>`).join('')}</select></label>
<label>Note de version<input name="note" placeholder="Ce qui change, pour s’en souvenir"></label><div><button>Enregistrer comme modèle</button></div></form>
<small>Garde la composition de ce contenu, ses éléments modifiables et ses formats${hasVideo ? ', ainsi que le style de sa vidéo' : ''}. Le contenu et ses exports ne changent pas.</small></details>`;
  // --- Création : les textes communs, puis l'éditeur de chaque format
  const creation = `
${hasPosters ? (design0?.ext ? '<p class="status ok">Affiche reçue : les textes sont dans l’image, il reste le cadrage de chaque format.</p>' : P_TEXTES) : ''}
${hasPosters ? `<div class="card"><h2>Affiches</h2><div class="fgrid">${v.formats.map((fmt) => `<div class="fcell">${thumb(ed, fmt, v.id)}<b>${esc(FORMATS[fmt].label)}</b><a class="btn sm" href="/edition/${ed.id}/poster/${fmt}?variant=${v.id}">Modifier ce format</a></div>`).join('')}</div></div>` : ''}
${hasVideo ? `<div class="card"><h2>Vidéo</h2><p>${vdesign?.asset ? 'Source : <b>' + esc(assets.find((a) => String(a.id) === String(vdesign.asset))?.name || 'fichier') + '</b>.' : 'Aucune vidéo source choisie.'}</p><a class="btn" href="/edition/${ed.id}/video?variant=${v.id}">Ouvrir l’éditeur vidéo (extrait, cadrage, logo, sous-titres)</a></div>` : ''}
${hasPosters || hasVideo ? SAVE_MODEL : ''}
${next2('verification', 'Continuer vers la vérification')}`;
  // --- Diffusion : trois destinations, dont aucune n'envoie quoi que ce soit à Meta
  const files = outputs.flatMap((o) => o.exports.slice(0, 1).map((e) => ({ o, e })));
  const diffusion = `
${files.length ? '' : `<p class="status warn">Rien à diffuser pour l’instant : il faut d’abord approuver et exporter. <a href="${base}?step=verification">Aller à la vérification</a></p>`}
<p class="lead"><b>Où va ce contenu ?</b> L’atelier prépare et organise ; il n’envoie rien à Meta et ne publie rien lui-même.</p>
${P_ASSOC}
<div class="card"><h2>Publication organique (sans campagne)</h2><small>Planifiez la publication sur vos propres comptes ; la mise en ligne reste à faire à la main.</small></div>
${P_PLAN}
<div class="card"><h2>Télécharger uniquement</h2>${files.length ? `<ul class="log">${files.map(({ o, e }) => `<li>${o.kind === 'video' ? 'Vidéo' : esc(FORMATS[o.fmt].label)} — <a href="/exports/${e.id}?dl=1">télécharger</a> ${e.draft ? '<span class="tag warn">BROUILLON</span>' : ''}</li>`).join('')}</ul>` : '<small>Aucun fichier exporté.</small>'}</div>
<details class="card"><summary><b>Autres actions</b> : dupliquer, archiver</summary>
<form method="post" action="${base}/duplicate" class="inline"><input type="hidden" name="simple" value="1"><input name="name" placeholder="Nom de la copie" required><button>Dupliquer ce contenu</button></form>
${v.status !== 'archivé' ? `<form method="post" action="${base}/archive" class="inline"><button class="link">Archiver ce contenu</button></form>` : ''}
<details><summary>Dupliquer pour un nouveau test marketing</summary>${P_DUP}</details></details>`;
  const brief = `<details class="card brief"><summary><b>Brief marketing</b> <small>(angle, audience, hypothèse — facultatif)</small></summary>${P_INTENT}</details>`;
  const bodies = { materiel, creation, verification: `${P_ETATS}\n${P_VALID}\n${P_SORTIES}\n${P_EXP}`, diffusion };
  return `${tabs(ed, 'campagnes')}${flash(msg)}
${workspaceHeader(ed, { name: v.name, type: ws.type, status: v.status, version: v.approved_version, base, backHref: v.campaign_id ? `/edition/${ed.id}/campaigns/${v.campaign_id}` : `/edition/${ed.id}/campaigns`, backLabel: v.campaign_id ? 'Retour à la campagne' : 'Campagnes', campName: ws.campaignName, dup: v.status === 'archivé' ? '' : base + '/duplicate', steps: ws.steps, summary: ws.summary, step, note: v.status === 'approuvé' ? '' : '' })}
${nextBanner}
${brief}
${bodies[step]}`;
}

// ------------------------------------------------------------------ calendrier
export function calendarPage(ed, c) {
  const { month, items, campaigns, variants, users, msg, campaignFilter, solo, todo = [], thumbs = {} } = c;
  const fmtOfVariant = Object.fromEntries(variants.map((x) => [x.id, x.formats?.[0]]));
  // Détails d'une tâche, affichés dans une bulle au survol : type, date, état, responsable, contenu, campagne, note, aperçu du visuel.
  const tip = (i) => esc(JSON.stringify({
    kind: KINDS[i.kind], title: i.title, when: `${new Date(i.due_date + 'T00:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}${i.due_time ? ' · ' + i.due_time : ''}`,
    state: i.status === 'fait' ? 'fait' : i.due_date < today() ? 'en retard' : i.status, owner: i.owner || '', content: i.variant_name || '', campaign: i.campaign_name || '', note: i.note || '',
    thumb: thumbs[i.variant_id] || '', live: !thumbs[i.variant_id] && fmtOfVariant[i.variant_id] ? `/render/poster/${ed.id}/${fmtOfVariant[i.variant_id]}?variant=${i.variant_id}` : '', go: i.variant_id ? 'Clic : ouvrir le contenu' : '',
  }));
  const grid = monthGrid(month), byDate = {}, td = today();
  for (const it of items) (byDate[it.due_date] ||= []).push(it);
  const late = items.filter((i) => i.status !== 'fait' && i.due_date < td);
  const name = new Date(month + '-01T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const q = campaignFilter ? `&campaign=${campaignFilter}` : '';
  return `${tabs(ed, 'calendrier')}${flash(msg)}${todoCard(todo)}
<p class="lead">Dates en jours calendaires du fuseau du projet (<b>${esc(ed.data.timezone || 'Asia/Tokyo')}</b>). Les étapes d’un contenu se cochent d’elles-mêmes quand la réalité les rattrape ; l’atelier ne publie jamais à votre place.</p>
<div class="inline"><a href="?month=${shiftMonth(month, -1)}${q}">← mois précédent</a><b>${esc(name)}</b><a href="?month=${shiftMonth(month, 1)}${q}">mois suivant →</a>
<form method="get" class="inline"><input type="hidden" name="month" value="${month}"><select name="campaign" onchange="this.form.submit()"><option value="">Toutes les campagnes</option>${campaigns.map((x) => opt(x.id, x.name, campaignFilter)).join('')}</select></form></div>
${late.length ? `<p class="status warn"><b>${late.length} tâche(s) en retard :</b> ${late.slice(0, 4).map((l) => esc(l.title)).join(' · ')}</p>` : ''}
<table class="cal"><tr>${['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d) => `<th>${d}</th>`).join('')}</tr>
${grid.map((w) => `<tr>${w.map((d) => `<td class="${d.inMonth ? '' : 'off'}${d.date === td ? ' today' : ''}"><span class="dn">${Number(d.date.slice(8))}</span>
${(byDate[d.date] || []).slice(0, 3).map((i) => `<a class="ci k-${i.kind} s-${i.status === 'fait' ? 'ok' : i.due_date < td ? 'late' : 'todo'}" href="${i.variant_id ? `/edition/${ed.id}/variants/${i.variant_id}` : '#liste'}" data-tip="${tip(i)}" aria-label="${esc(i.title)}">${i.due_time ? esc(i.due_time) + ' ' : ''}${esc(KINDS[i.kind])}</a>`).join('')}${(byDate[d.date] || []).length > 3 ? `<small>+${byDate[d.date].length - 3}</small>` : ''}</td>`).join('')}</tr>`).join('')}</table>
<div class="card" id="liste"><h2>Tâches du mois</h2>
${items.map((i) => `<form method="post" action="/edition/${ed.id}/calendar/${i.id}" class="prow"><span class="tag k-${i.kind}">${esc(KINDS[i.kind])}</span> <b>${esc(i.title)}</b> ${i.variant_name ? `<small>contenu « ${esc(i.variant_name)} »</small>` : ''}
<input type="date" name="due_date" value="${esc(i.due_date)}"><input type="time" name="due_time" value="${esc(i.due_time)}">${solo ? '' : `<select name="owner">${userOpts(users, i.owner)}</select>`}${sel('status', PLAN_STATUSES, i.status)}<button>OK</button><button name="remove" value="1" class="link">Supprimer</button></form>`).join('') || '<p>Rien de planifié ce mois-ci.</p>'}</div>
<div class="card"><h2>Ajouter une tâche</h2><form method="post" action="/edition/${ed.id}/calendar/new" class="grid">
<label>Titre<input name="title" required></label><label>Type${sel('kind', Object.keys(KINDS), 'jalon')}</label>
<label>Date<input type="date" name="due_date" required></label><label>Heure (facultatif)<input type="time" name="due_time"></label>
${solo ? '' : `<label>Responsable<select name="owner">${userOpts(users, '')}</select></label>`}
<label>Contenu<select name="variant_id"><option value="">—</option>${variants.map((x) => opt(x.id, x.name, '')).join('')}</select></label>
<label>Campagne<select name="campaign_id"><option value="">—</option>${campaigns.map((x) => opt(x.id, x.name, '')).join('')}</select></label><div><button>Ajouter</button></div></form></div>`;
}

// ------------------------------------------------------------------ contenus
export function contentsPage(ed, c) {
  const { contents, exports, linksBy, msg } = c;
  const used = new Set(contents.map((x) => x.export_id));
  const free = exports.filter((e) => ['affiche', 'video', 'pack'].includes(e.kind) && !used.has(e.id) && !e.variant_id);
  const th = (x) => (x.kind === 'texte' ? '<span>📝 texte</span>' : x.kind === 'image' && x.export_id ?`<img src="/exports/${x.export_id}" alt="">` : x.kind === 'video' && x.export_id ? `<video src="/exports/${x.export_id}" preload="metadata" muted></video>` : `<span>${esc(x.kind)}</span>`);
  return `${tabs(ed, 'contenus')}${flash(msg)}
<p class="lead">Les <b>contenus</b> sont les créations prêtes à l’emploi de ce projet. Ils existent <b>sans campagne</b> (publications organiques, réserve) et peuvent être associés à une ou plusieurs campagnes. Chaque association est <b>épinglée sur une version précise</b> : refaire un export ne la modifie jamais. Les affiches et vidéos exportées apparaissent ici automatiquement après l’export de leur version approuvée. Un <b>concept, un script ou une légende</b> est aussi un contenu : il s’associe à une campagne comme un visuel, sans fichier à exporter.</p>
${entryCards(ed, 'doc')}
<div class="card"><h2>Écrire un concept, un script ou un texte</h2>
<form method="post" action="/edition/${ed.id}/contents/new" class="grid">
<label>Titre<input name="title" placeholder="Ex. Concept teaser — la lumière du soir" required></label><label>Langue<input name="language" value="EN"></label>
<label>Angle créatif<input name="angle"></label><label>Audience visée<input name="audience"></label>
<label style="grid-column:1/-1">Texte<textarea name="body" rows="6" placeholder="Concept, script, légende, brief…"></textarea></label><div><button>Ajouter à la bibliothèque</button></div></form></div>
<div class="card"><h2>Ajouter un contenu depuis un export</h2>
<form method="post" action="/edition/${ed.id}/contents/new" class="grid">
<label>Fichier (export de ce projet)<select name="export_id" required><option value="">— choisir —</option>${free.map((e) => `<option value="${e.id}">${esc(e.label)} · ${fr(e.created)}${e.draft ? ' · BROUILLON' : ''}</option>`).join('')}</select></label>
<label>Titre<input name="title" placeholder="Par défaut : le nom de l’export"></label><label>Angle créatif<input name="angle"></label><label>Audience visée<input name="audience"></label>
<label>Langue<input name="language" value="EN"></label><div><button>Ajouter à la bibliothèque</button></div></form></div>
${contents.map((x) => `<div class="card dcard"><div class="dthumb">${th(x)}</div><div class="dmeta">
<form method="post" action="/edition/${ed.id}/contents/${x.id}/update" class="grid">
<label>Titre<input name="title" value="${esc(x.title)}"></label><label>Statut${sel('status', CONTENT_STATUSES, x.status)}</label>
<label>Angle<input name="angle" value="${esc(x.angle)}"></label><label>Audience<input name="audience" value="${esc(x.audience)}"></label>
<label>Langue<input name="language" value="${esc(x.language)}"></label><label>Notes<input name="notes" value="${esc(x.notes)}"></label>
${x.kind === 'texte' ? `<label style="grid-column:1/-1">Texte<textarea name="body" rows="6">${esc(x.body)}</textarea></label>` : ''}<div><button>Enregistrer</button></div></form>
${x.kind === 'texte' ? `<p class="inline">${x.asset_id ? `<a href="/files/${x.asset_id}" target="_blank">Fichier d’origine</a> · ` : ''}<a class="btn sm" href="/edition/${ed.id}/texts/${x.id}">Ouvrir</a> <a class="btn sm" href="/edition/${ed.id}/variants/new?content=${x.id}">Créer une affiche ou une vidéo à partir de ce texte</a></p>` : ''}
<small>${esc(x.kind)} ${fmtTag(x.format)} ${x.export_id ? '<span class="tag st-2">exporté</span>' : ''} ${x.draft ? '<span class="tag warn">BROUILLON</span>' : ''} ${x.variant_id ? `<a href="/edition/${ed.id}/variants/${x.variant_id}">variante v${x.variant_version || '?'}</a>` : ''}${x.export_id ? ` · version du ${fr(x.export_created)}` : ''}</small>
${(linksBy[x.id] || []).length ? `<ul class="log">${linksBy[x.id].map((l) => `<li>${chip(l.state)} ${l.ad_name ? `annonce « ${esc(l.ad_name)} »` : l.adset_name ? `ensemble « ${esc(l.adset_name)} »` : `campagne « ${esc(l.campaign_name)} »`}${l.export_id !== x.export_id ? ' <span class="tag warn">version épinglée plus ancienne</span>' : ''}${isFrozenState(l.state) ? ' 🔒' : ''}</li>`).join('')}</ul>` : '<small>Associé à aucune campagne (utilisable en organique).</small>'}
${x.variant_id ? '' : `<form method="post" action="/edition/${ed.id}/contents/${x.id}/version" class="inline"><select name="export_id"><option value="">Nouvelle version : choisir un export…</option>${exports.filter((e) => e.kind === (x.kind === 'image' ? 'affiche' : x.kind) && e.id !== x.export_id).map((e) => `<option value="${e.id}">${esc(e.label)} · ${fr(e.created)}</option>`).join('')}</select><button class="link">Remplacer</button></form>`}
</div></div>`).join('') || '<p>Aucun contenu pour l’instant.</p>'}`;
}

// ------------------------------------------------------------------ campagnes
// Où en est une campagne : ses associations par état, d'un coup d'œil.
const progressChips = (links) => {
  const n = (s) => links.filter((l) => l.state === s).length;
  const parts = [[n('brouillon') + n('à relire'), 'en préparation', 'en préparation', ''], [n('approuvé'), 'prêt à transmettre', 'prêts à transmettre', 'st-2'], [n('transmis'), 'transmis', 'transmis', 'st-2'], [n('publié'), 'publié', 'publiés', 'st-2'], [n('erreur'), 'en erreur', 'en erreur', 'warn']].filter(([k]) => k);
  return parts.length ? parts.map(([k, one, many, cls]) => `<span class="tag ${cls}">${k} ${k > 1 ? many : one}</span>`).join(' ') : '<span class="tag">rien de prêt à diffuser pour l’instant</span>';
};

export function campaignsPage(ed, c) {
  const { meta, campaigns, counts, msg } = c;
  const settings = `/edition/${ed.id}/settings#connexions`;
  const link = meta.ad_account || meta.page_name || meta.instagram;
  return `${tabs(ed, 'campagnes')}${flash(msg)}
<div class="metabar"><b>Meta :</b> <span class="tag warn">non connecté</span> <span class="tag">${link ? 'données saisies à la main' : 'aucune donnée saisie'}</span>
<small>L’atelier prépare et organise ; il n’envoie rien à Meta. <a href="${settings}">Connexions du projet</a></small></div>
<p class="lead">Une campagne rassemble <b>tout</b> ce qui la concerne : son brief, ses contenus (affiches, vidéos, textes), leur validation, leurs exports, puis son lien avec Meta. On la crée ici, on y crée ses contenus, et on la relie à Meta une fois prête.</p>
${campaigns.map((x) => `<div class="card campcard"><div class="vtop"><h2><a href="/edition/${ed.id}/campaigns/${x.id}">${esc(x.name)}</a> ${x.name === OFF_CAMPAIGN ? '<span class="tag">organique · sans Meta</span>' : metaChip(x)}</h2></div>
<p>${progressChips(counts[x.id]?.links || [])}</p>
<small>${x.meta_id ? 'ID Meta ' + esc(x.meta_id) + ' · ' : ''}${counts[x.id]?.variants || 0} contenu(s) à vous · ${(counts[x.id]?.links || []).length} association(s)${counts[x.id]?.missing ? ` · <b>${counts[x.id].missing} format(s) à produire</b>` : ''}</small>
${x.brief_message ? `<p class="hyp">Brief : ${esc(x.brief_message)}</p>` : ''}
<p class="inline"><a class="btn sm primary" href="/edition/${ed.id}/campaigns/${x.id}">Ouvrir</a> <a class="btn sm" href="/edition/${ed.id}/variants/new?campaign=${x.id}">+ Ajouter un contenu</a></p></div>`).join('') || '<p>Aucune campagne pour l’instant : créez la première ci-dessous.</p>'}
<details class="card"${campaigns.length ? '' : ' open'}><summary><b>+ Nouvelle campagne</b></summary>
<form method="post" action="/edition/${ed.id}/campaigns/new" class="grid">
<label>Nom de la campagne <small>(le même nom sera utilisé dans Meta)</small><input name="name" required placeholder="Ex. Lancement préventes — EN"></label>
<label>Objectif <small>(interne)</small><select name="brief_objective"><option value="">À préciser</option>${OBJECTIVES.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>
<label style="grid-column:1/-1">Message clé <small>(ce qu’on veut obtenir et ce qu’on veut dire)</small><textarea name="brief_message" rows="2" placeholder="Ce qu’on veut obtenir et ce qu’on veut dire"></textarea></label>
<label>Audience souhaitée <small>(facultatif)</small><input name="brief_audience" placeholder="Ex. Touristes anglophones à Kyoto"></label>
<div><button class="primary">Créer la campagne</button></div></form>
<small>Le lien avec Meta se fait plus tard, depuis la campagne, quand ses contenus sont prêts. Une campagne « Hors campagne » reçoit les contenus créés sans campagne (publications organiques, visuels du site).</small></details>`;
}

const linkActions = (ed, l) => {
  const f = (state, label, cls = '') => `<form method="post" action="/edition/${ed.id}/links/${l.id}" class="inline"><input type="hidden" name="state" value="${state}"><button class="${cls || 'link'}">${label}</button></form>`;
  const rm = `<form method="post" action="/edition/${ed.id}/links/${l.id}" class="inline"><input type="hidden" name="unlink" value="1"><button class="link">Retirer</button></form>`;
  const go = (to, label) => `<a class="btn sm" href="/edition/${ed.id}/links/${l.id}/confirm?to=${to}">${label}</a>`;
  if (l.state === 'publié') return '<span class="tag st-2">🔒 publiée — figée</span>';
  if (l.state === 'transmis') return `<span class="tag st-2">🔒 transmise — figée</span> ${go('publié', 'Marquer comme publiée…')} ${f('erreur', 'Signaler une erreur')}`;
  if (l.state === 'approuvé') return `${go('transmis', 'Transmettre…')} ${f('brouillon', 'Repasser en brouillon')} ${rm}`;
  // bloqué : le bouton est grisé et la raison est dite AVANT le clic
  const ap = (cls) => (l.why ? `<button class="${cls || 'link'}" disabled title="${esc(l.why)}">Approuver pour cette campagne</button> <small class="why">⛔ ${esc(l.why)}</small>` : f('approuvé', 'Approuver pour cette campagne', cls));
  if (l.state === 'à relire') return `${ap('btn sm')} ${f('brouillon', 'Repasser en brouillon')} ${rm}`;
  if (l.state === 'erreur') return `${f('brouillon', 'Repasser en brouillon')} ${rm}`;
  return `${ap()} ${f('à relire', 'Demander la relecture')} ${rm}`;
};
const linkList = (ed, links) => (links.length ? `<ul class="log links">${links.map((l) => `<li>
${l.kind === 'image' && l.export_id ? `<a href="/exports/${l.export_id}" target="_blank"><img src="/exports/${l.export_id}" class="lthumb" alt=""></a>` : ''}
<span><b>${esc(l.title)}</b> ${fmtTag(l.format)} ${l.kind === 'texte' ? (l.text_version_id ? `<span class="tag" title="Version figée du texte au moment de l’association">texte v${l.text_version_id}</span>` : '<span class="tag warn" title="Association antérieure aux versions de texte : l’original n’est pas garanti">version historique non garantie</span>') : ''} ${chip(l.state)} ${l.export_id ? '<span class="tag st-2">exporté</span>' : ''} ${l.draft ? '<span class="tag warn" title="Le fichier porte le bandeau DRAFT : fiche non prête ou source provisoire">fichier BROUILLON</span>' : ''}
${l.variant_id ? `<a href="/edition/${ed.id}/variants/${l.variant_id}">variante</a>` : ''}
${l.export_id !== l.current_export ? '<span class="tag warn">nouvelle version du contenu disponible — non appliquée</span>' : ''}<br>
<small>version épinglée du ${fr(l.linked_at)} · ${esc(l.angle || 'sans angle')} · ${esc(l.language || '')}${l.transmitted_at ? ' · marquée transmise le ' + fr(l.transmitted_at) : ''}</small><br>${linkActions(ed, l)}</span></li>`).join('')}</ul>` : '<small>Aucun contenu associé à ce niveau.</small>');

// Le fil d'une campagne : Brief › Contenus › Validation › Export › Meta. L'état vient des données réelles ; le premier pas non fait est mis en avant.
function campaignSteps(ed, camp, variants, c) {
  // « Validation » = la version ACTUELLE est approuvée (une ancienne approbation ne couvre pas un brouillon modifié) ; « Export » = tous les fichiers attendus existent.
  const todo = variants.find((v) => !(v.approved_version > 0 && v.pristine));
  const expected = variants.flatMap((v) => (c.outputs?.[v.id] || []).filter((r) => !r.removed));
  const ready = expected.filter((r) => r.exports.length > 0).length;
  const steps = [
    ['Brief', !!(camp.brief_objective || camp.brief_message), `/edition/${ed.id}/campaigns/${camp.id}?vue=brief`, 'Objectif et message clé'],
    ['Contenus', variants.length > 0, `/edition/${ed.id}/variants/new?campaign=${camp.id}`, variants.length ? `${variants.length} contenu(s)` : 'Ajouter un premier contenu'],
    ['Validation', variants.length > 0 && !todo, todo ? `/edition/${ed.id}/variants/${todo.id}?step=verification` : '#', variants.length ? (todo ? (todo.approved_version > 0 ? `« ${todo.name} » modifié depuis son approbation` : `« ${todo.name} » à approuver`) : 'Tout est approuvé') : 'Après les contenus'],
    ['Export', !todo && expected.length > 0 && ready === expected.length, todo ? `/edition/${ed.id}/variants/${todo.id}?step=verification` : `/edition/${ed.id}/variants`, expected.length ? `${ready}/${expected.length} fichier(s) prêt(s)` : 'Fichiers prêts à téléverser'],
    ['Meta', !!camp.meta_id || c.allLinks.some((l) => ['transmis', 'publié'].includes(l.state)), `/edition/${ed.id}/campaigns/${camp.id}/guide`, 'Relier et déclarer (saisie à la main)'],
  ];
  const cur = steps.findIndex((s) => !s[1]);
  return `<ol class="frise">${steps.map(([n, done, href, hint], i) => `<li class="${done ? 'done' : i === cur ? 'now' : ''}"><a href="${href}"><b>${i + 1}. ${n}</b><small>${esc(hint)}</small></a></li>`).join('')}</ol>`;
}

// Une seule action pour valider tous les contenus prêts de la campagne ; ce qui est bloqué est annoncé avant le clic, avec sa raison.
function approveAllBox(ed, camp, pending) {
  if (!pending.length) return '';
  const ready = pending.filter((l) => !l.why), reasons = [...new Set(pending.filter((l) => l.why).map((l) => l.why))];
  return `<div class="approve-all${ready.length ? '' : ' blocked'}">${ready.length ? `<form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/approve-all" class="inline"><button class="primary">Tout approuver pour la campagne (${ready.length})</button></form>` : `<b>Rien d’approuvable pour l’instant</b>`}
${reasons.length ? `<div class="why">⛔ ${pending.length - ready.length} contenu(s) en attente :<ul>${reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '<small>Les contenus restent à déposer vous-même dans Ads Manager : rien n’est envoyé.</small>'}</div>`;
}

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
<div class="two"><div><h3>Configuration Meta <small class="tag warn">provisoire</small></h3>${metaForm(`/edition/${ed.id}/campaigns/${camp.id}/adset/${s.id}/meta`, s, `<label><span>Ciblage réel dans Meta <small>(saisi)</small></span><input name="meta_targeting" value="${esc(s.meta_targeting)}"></label>`)}</div>
<div><h3>Brief interne</h3><form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/adset/${s.id}/brief" class="grid">
<label>Audience souhaitée<input name="brief_audience" value="${esc(s.brief_audience)}"></label><label>Langues<input name="brief_languages" value="${esc(s.brief_languages)}"></label>
<label style="grid-column:1/-1">Hypothèse<input name="brief_hypothesis" value="${esc(s.brief_hypothesis)}"></label>
<label>Destination<select name="landing">${pageOpts(s.landing)}</select></label>
<div style="grid-column:1/-1"><b>Placements souhaités</b><div class="chanlist inline">${Object.entries(CHANNELS).map(([k, ch]) => `<label class="check"><input type="checkbox" name="pl_${k}" value="1"${s.brief_placements.includes(k) ? ' checked' : ''}> ${esc(ch.label)}</label>`).join('')}</div></div>
<div><button>Enregistrer le brief</button></div></form></div></div>
${s.brief_placements.length ? `<div class="cover"><b>Formats à produire (selon les placements souhaités) :</b> ${cov.need.map((f) => `<span class="tag ${cov.have.includes(f) ? 'st-2' : 'warn'}">${esc(FORMATS[f].ratio)} ${cov.have.includes(f) ? '✓' : 'manquant'}</span>`).join(' ')}
${cov.missing.length ? `<small>→ <a href="/edition/${ed.id}/variants/new?campaign=${camp.id}&adset=${s.id}&formats=${cov.missing.join(',')}">Créer un contenu</a> pour les formats manquants, l’approuver et l’exporter.</small>` : '<small>Tous les formats nécessaires sont couverts.</small>'}</div>` : ''}
${linkList(ed, s.links)}${linkForm('adset_id', s.id)}
${s.ads.map((a) => `<div class="adrow"><h3>Annonce : ${esc(a.name)} ${metaChip(a)}</h3><small>${a.meta_id ? 'ID Meta ' + esc(a.meta_id) + ' · ' : ''}${esc(a.notes)}</small>
${(() => { const u = trackedUrl(a.landing || s.landing || ed.data.booking_url, { channel: 'meta', campaign: camp.name, content: a.name }); return u ? `<br><small>Lien suivi : <code>${esc(u)}</code></small>` : '<br><small>Aucune URL de destination : renseignez l’URL de réservation dans la fiche.</small>'; })()}
${linkList(ed, a.links)}${linkForm('ad_id', a.id)}</div>`).join('')}
<details><summary>+ Relier une annonce créée dans Meta</summary><form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/ad" class="grid"><input type="hidden" name="adset_id" value="${s.id}">
<label>Nom<input name="name" required></label><label>ID Meta (facultatif)<input name="meta_id"></label><label><span>Statut dans Meta <small>(saisi)</small></span>${sel('meta_status', META_STATUSES, 'inconnu')}</label>
<label>Destination<select name="landing">${pageOpts('')}</select></label><label>Notes<input name="notes"></label><div><button>Relier</button></div></form></details></div>`;
  }).join('');
  const num = (v, d = 2) => (v === null ? '—' : v.toFixed(d));
  // un seul sujet à la fois : Contenus (inventaire unique), Diffusion (ensembles, annonces, associations), Résultats, Brief
  const vue = ['contenus', 'diffusion', 'resultats', 'brief'].includes(c.vue) ? c.vue : 'contenus';
  const show = (v, html) => (vue === v ? html : '');
  const vbase = `/edition/${ed.id}/campaigns/${camp.id}`;
  const vtabs = `<nav class="tabs sub campviews" aria-label="Vues de la campagne">${[['contenus', `Contenus (${variants.length + (c.texts || []).length})`], ['diffusion', `Diffusion (${adsets.length} ensemble${adsets.length > 1 ? 's' : ''})`], ['resultats', 'Résultats'], ['brief', 'Brief']].map(([k, n]) => `<a href="${vbase}?vue=${k}"${vue === k ? ' class="on" aria-current="page"' : ''}>${n}</a>`).join('')}</nav>`;
  return `${tabs(ed, 'campagnes')}${flash(msg)}
<p class="crumbs" role="navigation" aria-label="Vous êtes ici"><a href="/edition/${ed.id}/campaigns">Campagnes</a> › <b>${esc(camp.name)}</b></p>
<div class="card"><h2>${esc(camp.name)} ${camp.name === OFF_CAMPAIGN ? '<span class="tag">organique · sans Meta</span>' : metaChip(camp)}</h2>
${campaignSteps(ed, camp, variants, c)}
<p>${progressChips(c.allLinks)}</p>
${approveAllBox(ed, camp, c.pending || [])}
${active ? '<p class="status ok"><b>Campagne active dans Meta</b> (statut saisi à la main). Les versions diffusées (associations « transmises » ou « publiées ») sont <b>figées</b> et identifiables 🔒. Vous pouvez continuer à préparer de <b>nouveaux contenus en brouillon</b> pour cette campagne ; rien ne part vers Meta sans récapitulatif et confirmation de votre part.</p>' : ''}
<p class="inline"><a class="btn primary" href="/edition/${ed.id}/variants/new?campaign=${camp.id}">+ Ajouter un contenu</a> <a class="btn" href="/edition/${ed.id}/campaigns/${camp.id}/guide">Guide Ads Manager : quoi saisir dans Meta</a></p></div>
${vtabs}
${show('contenus', `<div class="card"><h2>Contenus de cette campagne</h2>
${variants.map((v) => `<div class="orow"><a href="/edition/${ed.id}/variants/${v.id}"><b>${esc(v.name)}</b></a> <span class="tag">${esc(variantType(v))}</span> ${chip(v.status)}
<span class="outs">${(c.outputs?.[v.id] || []).map((o) => `<span class="tag ${['exporté', 'transmis', 'publié', 'approuvé'].includes(o.stage) ? 'st-2' : ''}">${o.kind === 'video' ? 'Vidéo' : esc(FORMATS[o.fmt]?.ratio || '')} · ${esc(o.stage)}</span>`).join(' ')}</span>
<form method="post" action="/edition/${ed.id}/variants/${v.id}/duplicate" class="inline"><input type="hidden" name="quick" value="1"><button class="mini" title="Copie complète (formats, photos, cadrages, textes) pour un test A/B">⧉ Créer une variante</button></form>
${c.nexts?.[v.id] ? `<br><small>${esc(c.nexts[v.id])}</small>` : ''}</div>`).join('')}
${(c.texts || []).map((t) => `<div class="orow"><a href="/edition/${ed.id}/texts/${t.id}"><b>${esc(t.title)}</b></a> <span class="tag">Texte</span> ${chip(t.status)}${t.body ? `<br><small>${esc(String(t.body).slice(0, 140))}${String(t.body).length > 140 ? '…' : ''}</small>` : ''}</div>`).join('')}
${variants.length || (c.texts || []).length ? '' : '<small>Aucun contenu pour cette campagne : utilisez « + Ajouter un contenu » ci-dessus.</small>'}</div>`)}
${show('diffusion', `<div class="card"><h2>Contenus associés à la campagne entière</h2>${linkList(ed, c.campLinks)}${linkForm('campaign_id', camp.id).replace('Associer un contenu (en brouillon)…', 'Associer un contenu existant à toute la campagne (en brouillon)…')}</div>

${adsetHtml}`)}
${show('brief', `<div class="card" id="config"><h2>Brief interne <small class="tag">à nous, jamais écrasé par Meta</small></h2><form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/brief" class="grid">
<label>Objectif interne<input name="brief_objective" value="${esc(camp.brief_objective)}"></label><label>Langues visées<input name="brief_languages" value="${esc(camp.brief_languages)}"></label>
<label style="grid-column:1/-1">Message clé<textarea name="brief_message" rows="2">${esc(camp.brief_message)}</textarea></label>
<label>Audience souhaitée<input name="brief_audience" value="${esc(camp.brief_audience)}"></label><label>Budget prévu<input name="brief_budget" value="${esc(camp.brief_budget)}"></label>
<label style="grid-column:1/-1">Hypothèse à tester<input name="brief_hypothesis" value="${esc(camp.brief_hypothesis)}"></label>
<label style="grid-column:1/-1">Consignes et notes<textarea name="brief_notes" rows="2">${esc(camp.brief_notes)}</textarea></label><div><button>Enregistrer le brief</button></div></form>
<small>Budget prévu ≠ budget configuré · audience souhaitée ≠ ciblage réel · objectif interne ≠ objectif Meta.</small></div>
<details class="card"><summary><b>Configuration Meta</b> <small>(à remplir une fois la campagne créée dans Ads Manager)</small></summary><h3>Configuration Meta <small class="tag warn">${camp.meta_source === 'meta' ? 'synchronisée ' + fr(camp.meta_synced_at) : 'provisoire : saisie à la main, jamais synchronisée'}</small></h3>
${metaForm(`/edition/${ed.id}/campaigns/${camp.id}/meta`, { ...camp, name: camp.name }, `<label>Objectif dans Meta<input name="meta_objective" value="${esc(camp.meta_objective)}"></label><label>Budget configuré dans Meta<input name="meta_budget" value="${esc(camp.meta_budget)}"></label>
<label>Début (Meta)<input type="date" name="meta_start" value="${esc(camp.meta_start)}"></label><label>Fin (Meta)<input type="date" name="meta_end" value="${esc(camp.meta_end)}"></label>`)}
<small>Ces champs seront remplacés par les valeurs réelles de Meta dès que la connexion sera active.</small></details>`)}
${show('diffusion', `<div class="card"><h2>+ Relier un ensemble de publicités créé dans Meta</h2><form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/adset" class="grid">
<label>Nom (dans Meta)<input name="name" required></label><label>ID Meta (facultatif)<input name="meta_id"></label><label><span>Statut dans Meta <small>(saisi)</small></span>${sel('meta_status', META_STATUSES, 'inconnu')}</label>
<label>Audience souhaitée<input name="brief_audience"></label><label>Langues<input name="brief_languages" placeholder="EN, JA"></label>
<label>Destination<select name="landing">${pageOpts('')}</select></label>
<div style="grid-column:1/-1"><b>Placements souhaités</b><div class="chanlist inline">${Object.entries(CHANNELS).map(([k, ch]) => `<label class="check"><input type="checkbox" name="pl_${k}" value="1"> ${esc(ch.label)}</label>`).join('')}</div></div>
<label>Notes<input name="notes"></label><div><button>Relier l’ensemble</button></div></form></div>`)}
${show('resultats', `<div class="card"><h2>Résultats et comparaison <span class="tag warn">saisie manuelle</span></h2>
<small>À défaut de connexion à Meta, recopiez ici les chiffres d’Ads Manager par association. Ce sont des repères pour préparer les prochains contenus, pas une décision automatique.</small>
${compare.length ? `<table><tr><th>Contenu</th><th>Angle</th><th>Audience</th><th>Format</th><th>Affich.</th><th>Clics</th><th>CTR</th><th>Dépense</th><th>CPC</th><th>Résultats</th><th>Coût/résultat</th></tr>${compare.map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(r.angle)}</td><td>${esc(r.audience)}</td><td>${esc(FORMATS[r.format]?.ratio || '')}</td><td>${r.imp}</td><td>${r.clk}</td><td>${r.ctr === null ? '—' : (r.ctr * 100).toFixed(2) + ' %'}</td><td>${num(r.spend)}${r.currency ? ' ' + esc(r.currency) : ''}${r.mixedCurrency ? ' <span class="tag warn" title="Plusieurs devises : aucun coût unitaire n’est calculé">devises mélangées</span>' : ''}</td><td>${num(r.cpc)}</td><td>${r.conv}${r.mixedType ? ' <span class="tag warn" title="Types de résultat différents (vues, messages, achats…) : à ne pas additionner">types mélangés</span>' : ''}</td><td>${num(r.cpa)}</td></tr>`).join('')}</table>` : '<p><small>Aucun résultat saisi.</small></p>'}
${(c.conflicts || []).length ? `<div class="status warn" id="reconcile"><b>Mesures à réconcilier</b><br><small>Ces mesures concernent la même publicité sur des périodes qui se croisent : les additionner compterait deux fois les mêmes jours. Gardez celle qui est juste ; l’autre est mise de côté (conservée, hors totaux).</small><ul>${c.conflicts.map((k) => `<li>${esc(k.link.title)} : <b>${esc(k.a.period || '—')}</b> (${k.a.impressions} affich., ${num(k.a.spend)}) et <b>${esc(k.b.period || '—')}</b> (${k.b.impressions} affich., ${num(k.b.spend)}) <form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/reconcile" class="inline"><input type="hidden" name="keep" value="${k.a.id}"><input type="hidden" name="drop" value="${k.b.id}"><button class="mini">Garder la première</button></form> <form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/reconcile" class="inline"><input type="hidden" name="keep" value="${k.b.id}"><input type="hidden" name="drop" value="${k.a.id}"><button class="mini">Garder la seconde</button></form></li>`).join('')}</ul></div>` : ''}
<form method="post" action="/edition/${ed.id}/campaigns/${camp.id}/result" class="grid">
<label>Association<select name="link_id" required><option value="">— choisir —</option>${c.allLinks.map((l) => `<option value="${l.id}">${esc(l.title)} (${esc(FORMATS[l.format]?.ratio || '')}) — ${l.ad_id ? 'annonce' : l.adset_id ? 'ensemble' : 'campagne'} #${l.id}</option>`).join('')}</select></label>
<label>Période : du<input type="date" name="period_from"></label><label>au<input type="date" name="period_to"></label><label>Affichages<input name="impressions" type="number" min="0"></label><label>Clics<input name="clicks" type="number" min="0"></label>
<label>Dépense<input name="spend" type="number" step="0.01" min="0"></label><label>Résultats<input name="conversions" type="number" min="0"></label><div><button>Ajouter</button></div></form></div>`)}`;
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
<p>Les données vivent dans <code>data/</code> : <b>atelier.db</b> (projets, fiches, designs, versions, contenus (affiches, vidéos, textes), campagnes, calendrier, sous-titres), <b>assets/</b> (originaux : photos, vidéos sources, logos, sous-titres, copies des designs), <b>exports/</b> (fichiers produits).</p>
<form method="post" action="/settings/backup-config" class="grid">
<label><span>Dossier de sauvegarde externe <small>(autre disque, OneDrive, partage réseau…)</small></span><input name="dir" value="${esc(status.dir)}" placeholder="D:\\Sauvegardes\\Atelier"></label>
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
export function todoCard(items, title = 'À faire maintenant') {
  if (!items.length) return `<div class="card todo"><h2>${title}</h2><p>✅ Rien d’urgent. Vos contenus et vos campagnes sont à jour.</p></div>`;
  return `<div class="card todo"><h2>${title}</h2><ul class="log todo">${items.map((i) => `<li class="${i.level}">${i.level === 'urgent' ? '🔴' : '▸'} <a href="${esc(i.href)}">${esc(i.text)}</a></li>`).join('')}</ul></div>`;
}

// ------------------------------------------------------------------ le site WordPress du projet
export function sitePage(ed, c) {
  const { site, msg } = c;
  const done = STEPS.filter(([k]) => site.steps[k]).length;
  return `${tabs(ed, 'site')}${flash(msg)}
<p class="lead">Chaque projet possède <b>son propre site WordPress</b>, sur <b>son propre domaine</b>. Les campagnes Meta y renvoient (plusieurs campagnes peuvent viser le même site) mais ne le créent ni ne le pilotent. Les autres sites (par exemple celui d’Acoustiguide) ne servent que d’exemples : ils ne sont jamais regroupés avec celui-ci.</p>
<div class="card"><h2>Identité du site</h2>
<form method="post" action="/edition/${ed.id}/site/save" class="grid">
<label><span>Nom de domaine <small>(sans https://)</small></span><input name="domain" value="${esc(site.domain)}" placeholder="ex. monspectacle.com"></label>
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

// ------------------------------------------------------------------ accueil du projet : un tableau de travail, pas une fiche
export function projectHomePage(ed, d, msg) {
  const next = d.pipeline.next;
  const work = (list, empty) => list.length
    ? `<ul class="worklist">${list.map((w) => `<li><a href="${esc(w.href)}"><b>${esc(w.name)}</b></a> <span class="tag">${esc(w.type)}</span> ${chip(w.status)}${w.next ? `<small>${esc(w.next)}</small>` : ''}${w.summary ? `<small class="sum">${esc(w.summary)}</small>` : ''}</li>`).join('')}</ul>`
    : `<p class="empty">${empty}</p>`;
  return `${tabs(ed, 'accueil')}${flash(msg)}
<ol class="frise home-frise" aria-label="Le parcours du projet">${d.pipeline.steps.map((st) => `<li class="${st.done ? 'done' : next && st.n === next.n ? 'now' : ''}"><a href="${esc(st.href)}"><b>${st.done ? '✓' : st.n}. ${esc(st.label)}</b><small>${esc(st.hint)}</small></a></li>`).join('')}</ol>
<div class="home-actions">${next ? `<a class="btn primary big" href="${esc(next.href)}">Continuer : ${esc(next.label)} →</a><a class="btn big" href="/edition/${ed.id}/campaigns">Mes campagnes</a>` : `<a class="btn primary big" href="/edition/${ed.id}/campaigns">Mes campagnes : créer ou ouvrir</a>`}<a class="btn big" href="/edition/${ed.id}/calendar">Calendrier</a></div>
<div class="home-grid">
<div class="card"><h2>Production à reprendre</h2>${work(d.recent, d.toReview.length ? 'Rien d’autre à produire.' : 'Rien en cours. Ouvrez une campagne pour y créer un contenu.')}</div>
<div class="card"><h2>Validations attendues</h2>${work(d.toReview, 'Rien en attente de relecture.')}</div>
<div class="card"><h2>Prochaines échéances</h2>${d.late ? `<p class="status warn">${d.late} échéance(s) en retard — <a href="/edition/${ed.id}/calendar">voir le calendrier</a></p>` : ''}${d.items.length
    ? `<ul class="worklist">${d.items.map((i) => `<li><b>${esc(i.due_date)}</b> ${esc(i.title)}</li>`).join('')}</ul>` : '<p class="empty">Aucune échéance dans les 14 prochains jours.</p>'}
<p><a href="/edition/${ed.id}/calendar">Ouvrir le calendrier</a></p></div>
${todoCard(d.todo, 'Suivi et configuration')}
</div>
`;
}

// ------------------------------------------------------------------ « Créer un contenu » : trois choix, rien d'autre au départ
export function contentNewPage(ed, c) {
  const { campaigns, variants, error, values: v = {}, prefill = {}, preset = {}, from = {}, templates = [] } = c;
  const types = [['affiche', '🖼️ Affiche / image', 'Un visuel décliné en plusieurs formats'], ['video', '🎬 Vidéo', c.videoReady === false ? '⚠ Montage possible, mais l’export vidéo est impossible sur cet ordinateur (ffmpeg incomplet)' : 'Un extrait, recadré par format, avec sous-titres'], ['texte', '📝 Texte', 'Texte de publicité (texte principal, titre, description), script, légende']];
  const cur = v.type || from.type || 'affiche';
  return `${tabs(ed, 'campagnes')}${error ? `<p class="status warn">${esc(error)}</p>` : ''}
<h2>Ajouter un contenu</h2>
<form method="post" action="/edition/${ed.id}/variants/new" class="vwizard">
<div class="typepick">${types.map(([k, n, h]) => `<label class="typecard"><input type="radio" name="type" value="${k}"${k === cur ? ' checked' : ''} required><span><b>${n}</b><small>${h}</small></span></label>`).join('')}</div>
<div class="card"><div class="grid">
<label><span>Nom <small>(facultatif : une proposition est faite)</small></span><input name="name" value="${esc(v.name || prefill.name)}" placeholder="Ex. Teaser Stories"></label>
<label><span>Campagne <small>(le contenu en fait partie)</small></span><select name="campaign_id"><option value="">Hors campagne (publication organique, site…)</option>${campaigns.filter((x) => x.name !== OFF_CAMPAIGN).map((x) => opt(x.id, x.name, v.campaign_id || preset.campaign_id)).join('')}</select></label>
${from.asset ? `<input type="hidden" name="asset" value="${esc(from.asset.id)}"><p class="status ok">Fichier de départ : <b>${esc(from.asset.name)}</b> — il sera utilisé dès la création.</p>` : ''}
<label><span>Design enregistré <small>(facultatif)</small></span><select name="design_version"><option value="">Aucun</option>${templates.map((t) => opt(t.version_id, `${t.name} — v${t.version}`, v.design_version || from.design_version)).join('')}</select></label>
<label>Point de départ<select name="copy"><option value="">Partir de zéro (informations du spectacle)</option>${variants.map((x) => opt(x.id, `Copier « ${x.name} »`, v.copy)).join('')}</select></label></div>
${preset.adset_id ? `<input type="hidden" name="adset_id" value="${esc(preset.adset_id)}">` : ''}${(preset.formats || []).map((f) => `<input type="hidden" name="fmt_${esc(f)}" value="1">`).join('')}
<small>Le matériel (photos, affiche reçue, vidéo, document) se choisit à l’étape suivante.</small></div>
${prefill.source_text ? `<details class="card" open><summary><b>Texte de départ : ${esc(prefill.source_title || 'contenu')}</b></summary><pre class="srctext">${esc(prefill.source_text)}</pre></details>` : ''}
<button class="primary">Créer et commencer</button> <a href="/edition/${ed.id}/variants">Annuler</a>
<p><small>Besoin de documenter un test marketing (angle, audience, hypothèse) ? <a href="/edition/${ed.id}/variants/new?mode=test">Mode test détaillé</a>.</small></p></form>`;
}

// ------------------------------------------------------------------ un texte (concept, script, légende) : mêmes quatre étapes
export function textPage(ed, c) {
  const { t, ws, step, assets, campaigns, adsets, links, msg, planItems } = c;
  const base = `/edition/${ed.id}/texts/${t.id}`;
  const next2 = (to, label) => `<p class="stepnext"><a class="btn primary" href="${base}?step=${to}">${label} →</a></p>`;
  const docs = assets.filter((a) => ['document', 'text', 'source'].includes(a.kind));
  const checksL = [!String(t.body || '').trim() && ['bloquant', 'Le texte est vide : rédigez-le à l’étape Création.'], !t.language && ['conseil', 'Aucune langue indiquée.']].filter(Boolean);
  const bodies = {
    materiel: `<div class="card"><h2>Importer un document</h2><small>Word (.docx), OpenDocument (.odt), .txt ou .md : son texte est ajouté à la suite de celui-ci. Un PDF ou un PowerPoint est joint sans être lu.</small>
<form class="upm inline" data-edition="${ed.id}" data-text="${t.id}"><input type="hidden" name="what" value="doc"><input type="file" required accept=".docx,.odt,.doc,.rtf,.txt,.md,.pdf,.pptx"><button class="primary">Envoyer et importer</button></form><p class="upmsg"></p>
${docs.length ? `<form method="post" action="${base}/import" class="inline"><select name="asset" required>${docs.map((a) => opt(a.id, a.name, '')).join('')}</select><button>Importer le texte de ce fichier</button></form>` : ''}</div>
${t.asset_id ? `<p><a href="/files/${t.asset_id}" target="_blank">Fichier d’origine</a></p>` : ''}${next2('creation', 'Continuer vers la rédaction')}`,
    creation: `<div class="card"><h2>Rédaction</h2><form method="post" action="${base}/save" class="grid">
<label>Titre<input name="title" value="${esc(t.title)}" required></label><label>Langue<input name="language" value="${esc(t.language)}" placeholder="EN, JA…"></label>
<label><span>Angle <small>(facultatif)</small></span><input name="angle" value="${esc(t.angle)}"></label><label><span>Audience <small>(facultatif)</small></span><input name="audience" value="${esc(t.audience)}"></label>
<label style="grid-column:1/-1"><span>Texte principal <small>(au-dessus du visuel dans Meta ; conseillé : ${LIMITS.primary} caractères ou moins — ou un script, un concept plus long)</small></span><textarea name="body" rows="8" data-count="${LIMITS.primary}">${esc(t.body)}</textarea><small class="cnt"></small></label>
<label><span>Titre de la publicité <small>(facultatif, ≤ ${LIMITS.headline})</small></span><input name="ad_headline" value="${esc(t.ad_headline)}" data-count="${LIMITS.headline}"><small class="cnt"></small></label>
<label><span>Description <small>(facultatif, ≤ ${LIMITS.description})</small></span><input name="ad_description" value="${esc(t.ad_description)}" data-count="${LIMITS.description}"><small class="cnt"></small></label>
<div><button class="primary">Enregistrer</button></div></form>
<p><a class="btn sm" href="/edition/${ed.id}/variants/new?content=${t.id}">Créer une affiche ou une vidéo à partir de ce texte</a></p></div>${next2('verification', 'Continuer vers la vérification')}`,
    verification: `<div class="card"><h2>Contrôles</h2>${checksL.length ? `<ul class="log checks">${checksL.map(([l, x]) => `<li class="${l}">${l === 'bloquant' ? '🔴 <b>À corriger</b>' : '🟡 <b>À savoir</b>'} — ${esc(x)}</li>`).join('')}</ul>` : '<p>✅ Rien à signaler.</p>'}</div>
<div class="card"><h2>Validation</h2><p>Statut : ${chip(t.status)}. Approuver confirme que ce texte est prêt à être utilisé.</p><div class="inline">
<form method="post" action="${base}/approve"><button class="primary"${t.status === 'approuvé' ? ' disabled' : ''}>Approuver</button></form>
<form method="post" action="${base}/review"><button class="link"${t.status === 'à relire' ? ' disabled' : ''}>Mettre de côté pour relire plus tard</button></form>
<a class="btn sm" href="${base}/download">Télécharger en .txt</a></div></div>`,
    diffusion: `<p class="lead"><b>Où va ce texte ?</b> L’atelier prépare et organise ; il n’envoie rien à Meta et ne publie rien lui-même.</p>
<div class="card"><h2>Associer à une campagne</h2><small>L’association démarre en brouillon ; la suite (relecture, transmission, publication) se déclare sur la page de la campagne.</small>
<form method="post" action="${base}/link" class="inline"><select name="target" required><option value="">Choisir le niveau…</option>${campaigns.map((x) => `<option value="campaign_id:${x.id}">Campagne : ${esc(x.name)}</option>${adsets.filter((a) => a.campaign_id === x.id).map((a) => `<option value="adset_id:${a.id}">&nbsp;&nbsp;Ensemble : ${esc(a.name)}</option>`).join('')}`).join('')}</select><button>Associer en brouillon</button></form>
${links.length ? `<ul class="log">${links.map((l) => `<li>${chip(l.state)} ${l.ad_name ? 'annonce « ' + esc(l.ad_name) + ' »' : l.adset_name ? 'ensemble « ' + esc(l.adset_name) + ' »' : 'campagne « ' + esc(l.campaign_name) + ' »'}${isFrozenState(l.state) ? ' 🔒' : ''}</li>`).join('')}</ul>` : '<small>Aucune association.</small>'}</div>
<div class="card"><h2>Publication organique</h2>${planItems.length ? `<ul class="log">${planItems.map((p) => `<li><b>${esc(p.due_date)}</b> ${esc(p.title)} ${chip(p.status)}</li>`).join('')}</ul>` : ''}
<form method="post" action="${base}/plan" class="inline"><label>Date visée<input type="date" name="due" required></label><button>Ajouter au calendrier</button></form><small>Rappel dans le calendrier ; la publication reste à faire à la main.</small></div>
<div class="card"><h2>Télécharger uniquement</h2><a class="btn sm" href="${base}/download">Télécharger en .txt</a></div>`,
  };
  return `${tabs(ed, 'campagnes')}${flash(msg)}
${workspaceHeader(ed, { name: t.title, type: 'Texte', status: t.status, version: 0, base, backHref: ws.campaignId ? `/edition/${ed.id}/campaigns/${ws.campaignId}` : `/edition/${ed.id}/campaigns`, campName: ws.campaignName, steps: ws.steps, step })}
${bodies[step]}`;
}

// ------------------------------------------------------------------ Guide Ads Manager : quoi saisir, dans quel ordre, avec des valeurs à copier
export function metaGuidePage(ed, c) {
  const { camp, meta, adsets, msg } = c;
  const base = `/edition/${ed.id}/campaigns/${camp.id}`;
  const copyBtn = (v) => (v ? `<button type="button" class="copy" data-copy="${esc(v)}">Copier</button>` : '');
  const row = (label, value, note = '') => `<div class="grow"><div class="gl">${esc(label)}</div><div class="gv">${value ? `<code>${esc(value)}</code>` : '<span class="muted">— à renseigner</span>'}</div><div class="gc">${copyBtn(value)}</div>${note ? `<small class="gn">${esc(note)}</small>` : ''}</div>`;
  const obj = META_OBJECTIVES[camp.brief_objective] || null;
  const metaObj = obj?.meta || camp.meta_objective || '';
  const dates = [camp.meta_start || camp.starts, camp.meta_end || camp.ends].filter(Boolean).join(' → ');
  const sheets = adsets.map((s) => ({ s, ads: s.ads.map((a) => ({ a, sheet: adSheet({ ed, meta, camp, adset: s, ad: a, links: a.links }) })) }));
  const nWarn = sheets.reduce((n, x) => n + x.ads.reduce((m, y) => m + y.sheet.warnings.length, 0), 0) + adsets.reduce((n, s) => n + coverage(s, s.links).missing.length, 0);
  const texts = c.texts || [];
  const fromText = (a) => (texts.length ? `<form method="post" action="${base}/adcopy" class="inline"><input type="hidden" name="ad_id" value="${a.id}"><select name="from_text" required><option value="">Reprendre un texte du projet…</option>${texts.map((t) => `<option value="${t.id}">${esc(t.title)}${t.status === 'approuvé' ? ' ✓' : ''}</option>`).join('')}</select><button>Reprendre</button></form><small>Texte principal, titre et description sont recopiés ; le texte d’origine ne change pas.</small>` : '');
  const copyForm = (s, a) => `<details class="copyform"><summary>Modifier les textes et références de cette publicité</summary>
${fromText(a)}
<form method="post" action="${base}/adcopy" class="grid"><input type="hidden" name="ad_id" value="${a.id}">
<label>Nom de la publicité<input name="name" value="${esc(a.name)}"></label>
<label>Bouton<select name="cta"><option value="">— choisir —</option>${META_CTAS.map((x) => `<option${x === a.cta ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
<label style="grid-column:1/-1"><span>Texte principal <small>(conseillé : ${LIMITS.primary} caractères ou moins)</small></span><textarea name="copy_primary" rows="3" data-count="${LIMITS.primary}">${esc(a.copy_primary)}</textarea><small class="cnt"></small></label>
<label><span>Titre <small>(≤ ${LIMITS.headline})</small></span><input name="copy_headline" value="${esc(a.copy_headline)}" data-count="${LIMITS.headline}"><small class="cnt"></small></label>
<label><span>Description <small>(facultatif)</small></span><input name="copy_description" value="${esc(a.copy_description)}"></label>
<label><span>Identifiant Meta <small>(une fois créée dans Ads Manager)</small></span><input name="meta_id" value="${esc(a.meta_id)}"></label>
<div><button class="primary">Enregistrer</button></div></form></details>`;
  const adHtml = (s, a, sheet) => `<div class="card gad"><h3>Publicité : ${esc(a.name)} ${a.meta_id ? `<span class="tag st-2">créée dans Meta (ID ${esc(a.meta_id)})</span>` : '<span class="tag">à créer dans Meta</span>'}</h3>
<h4>1 · Fichiers à téléverser</h4>
${sheet.files.length ? `<ul class="gfiles">${sheet.files.map((x) => `<li><b>${esc(x.title)}</b> ${x.kind === 'video' ? '<span class="tag">vidéo</span>' : ''} <span class="tag">${esc(x.ratio)} · ${esc(x.dims)}</span> ${x.draft ? '<span class="tag warn">BROUILLON</span>' : ''} ${x.exportId ? `<a class="btn sm" href="/exports/${x.exportId}?dl=1">Télécharger</a>` : '<small>pas encore de fichier</small>'}</li>`).join('')}</ul>` : '<p class="status warn">Aucun fichier associé : associez un contenu à cette publicité dans la campagne.</p>'}
<h4>2 · Textes et réglages à recopier</h4>${sheet.fields.map((x) => row(x.label, x.value, x.note)).join('')}
${sheet.warnings.length ? `<ul class="log checks">${sheet.warnings.map((w) => `<li class="conseil">🟡 ${esc(w)}</li>`).join('')}</ul>` : '<p class="status ok">✅ Prête à saisir dans Ads Manager.</p>'}
${copyForm(s, a)}</div>`;
  const adsetHtml = sheets.map(({ s, ads }) => {
    const cov = coverage(s, s.links), pl = placementsHelp(s.brief_placements);
    return `<div class="card"><h2>Ensemble de publicités : ${esc(s.name)}</h2>
${row('Nom de l’ensemble', s.name, 'Nom conseillé : ' + suggestAdsetName(camp, s))}
${row('Audience souhaitée', s.brief_audience, 'À traduire en ciblage dans Ads Manager (lieux, âge, centres d’intérêt). Ce que vous saisissez vraiment dans Meta se note dans « Ciblage réel » de la campagne.')}
${row('Langues', s.brief_languages)}
${row('Destination', /^https?:/.test(s.landing) ? s.landing : ed.data.booking_url, 'Page où mènent les publicités de cet ensemble.')}
<div class="grow"><div class="gl">Emplacements</div><div class="gv">${pl.length ? pl.map((x) => esc(x)).join('<br>') : '<span class="muted">— aucun placement souhaité : choisissez-les dans la campagne</span>'}</div><div class="gc"></div><small class="gn">Si vous laissez les emplacements automatiques, Meta diffusera sur tous les formats : préparez au moins 4:5 (fil) et 9:16 (stories / reels).</small></div>
${cov.need.length ? `<p><b>Formats à produire :</b> ${cov.need.map((f) => `<span class="tag ${cov.have.includes(f) ? 'st-2' : 'warn'}">${esc(FORMATS[f]?.ratio || f)} ${cov.have.includes(f) ? '✓' : 'manquant'}</span>`).join(' ')}${cov.missing.length ? ` <a href="/edition/${ed.id}/variants/new?campaign=${camp.id}&adset=${s.id}&formats=${cov.missing.join(',')}">Créer les formats manquants</a>` : ''}</p>` : ''}
${ads.map(({ a, sheet }) => adHtml(s, a, sheet)).join('') || '<p><small>Aucune publicité prévue dans cet ensemble : ajoutez-en une ci-dessous.</small></p>'}
<details><summary>+ Prévoir une publicité dans cet ensemble</summary><form method="post" action="${base}/ad" class="grid"><input type="hidden" name="adset_id" value="${s.id}">
<label>Nom de la publicité<input name="name" required placeholder="${esc(suggestAdName(s, {}, null))}"></label><label>Angle<input name="brief_angle"></label>
<label>Bouton<select name="cta"><option value="">— choisir —</option>${META_CTAS.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
<label style="grid-column:1/-1">Texte principal<textarea name="copy_primary" rows="2"></textarea></label><label>Titre<input name="copy_headline"></label><div><button>Prévoir</button></div></form></details></div>`;
  }).join('');
  return `${tabs(ed, 'campagnes')}${flash(msg)}
<p><a href="${base}">← ${esc(camp.name)}</a></p>
<h1>Guide Ads Manager</h1>
<p class="lead">Préparez ici, saisissez dans Ads Manager : chaque valeur a un bouton « Copier ». <b>Rien n’est envoyé à Meta</b> et l’atelier ne se connecte pas à Meta.</p>
<p class="status warn">Meta change souvent ses écrans et ses libellés. Les noms ci-dessous suivent la structure stable <b>Campagne › Ensemble de publicités › Publicité</b> ; si un libellé diffère chez vous, la valeur à copier reste la bonne. Dernière relecture du vocabulaire : à reconfirmer à chaque nouvelle interface.</p>
<ol class="gsteps">${GUIDE_STEPS.map(([t, d]) => `<li><b>${esc(t)}</b><small>${esc(d)}</small></li>`).join('')}</ol>
<p>${nWarn ? `<span class="tag warn">${nWarn} point(s) à régler avant de publier</span>` : '<span class="tag st-2">Rien à régler</span>'}</p>
<div class="card"><h2>1 · Campagne</h2>
${row('Nom de la campagne', camp.name)}
${row('Objectif de campagne', metaObj, obj?.hint || 'Choisissez l’objectif le plus proche dans Ads Manager.')}
${row('Budget prévu', camp.brief_budget, 'Selon le mode choisi dans Meta, le budget se saisit au niveau de la campagne ou de chaque ensemble.')}
${row('Dates', dates)}
${row('Message clé', camp.brief_message, 'Pour inspirer les textes ; non envoyé à Meta.')}</div>
${adsetHtml || '<div class="card"><p>Aucun ensemble : ajoutez-en un depuis la page de la campagne.</p></div>'}
<div class="card"><h2>4 · Avant de publier dans Meta</h2><ul class="log"><li>Vérifiez l’aperçu de chaque publicité par emplacement (fil, stories, reels…).</li><li>Relisez l’orthographe et testez le lien (le paramétrage d’URL ne doit pas casser la page).</li><li>Les fichiers téléversés doivent être les exports <b>approuvés</b> ci-dessus, pas des brouillons.</li></ul></div>
<div class="card"><h2>5 · Une fois créé dans Meta, revenez ici</h2><ul class="log"><li>Notez l’identifiant de la campagne / de l’ensemble / de la publicité (champ « Identifiant Meta »).</li><li>Sur la page de la campagne : <b>Transmettre</b> puis <b>Marquer comme publiée</b> (déclarations manuelles, avec récapitulatif).</li><li>Après quelques jours : <a href="${base}/guide#resultats">importez le rapport exporté d’Ads Manager</a> pour renseigner les résultats sans les recopier.</li></ul>
<p><a class="btn" href="${base}">Retour à la campagne</a></p></div>
${resultsImportCard(ed, camp, c.importPreview)}`;
}

// ------------------------------------------------------------------ import du rapport Ads Manager (CSV exporté)
function resultsImportCard(ed, camp, prev) {
  const base = `/edition/${ed.id}/campaigns/${camp.id}`;
  return `<div class="card" id="resultats"><h2>Résultats : importer le rapport d’Ads Manager</h2>
<small>Dans Ads Manager, onglet <b>Publicités</b> : choisissez la période, puis <b>Exporter › Exporter les données du tableau (.csv)</b> (ou copiez le tableau). Collez le contenu ci-dessous ou choisissez le fichier. Les publicités sont reconnues par leur nom ; vous voyez un aperçu avant d’enregistrer quoi que ce soit.</small>
${prev ? importPreviewHtml(ed, camp, prev) : ''}
<form method="post" action="${base}/import-results" id="importform" class="grid"><label style="grid-column:1/-1">Contenu du rapport (CSV ou tableau copié)<textarea name="csv" rows="6" placeholder="Nom de la publicité;Impressions;Clics sur un lien;Montant dépensé (EUR);Résultats…">${prev ? esc(prev.raw) : ''}</textarea></label>
<label>Fichier .csv <input type="file" id="csvfile" accept=".csv,.txt,text/csv"></label><div><button>Analyser (aperçu)</button></div></form></div>`;
}
function importPreviewHtml(ed, camp, p) {
  const base = `/edition/${ed.id}/campaigns/${camp.id}`;
  if (p.error) return `<p class="status warn">${esc(p.error)}</p>`;
  const num = (v) => (v === null || v === undefined ? '—' : String(v));
  const money = (v) => (v === null || v === undefined ? '—' : `${v}${p.currency ? ' ' + esc(p.currency) : ''}`);
  const ok = p.rows.filter((r) => r.linkId && (!r.skip || r.conflict));
  const rowOk = (r) => r.linkId && !r.skip;
  const cand = p.rows.filter(rowOk);
  const target = (r, i) => (r.choices
    ? `<select name="pick_${i}" form="importform" aria-label="Annonce visée pour ${esc(r.name)}"><option value="">— choisir l’annonce —</option>${r.choices.map((c) => `<option value="${c.linkId}">${esc(c.label)}</option>`).join('')}</select>`
    : r.target ? `${esc(r.target)}<br><small>${esc(r.reason || '')}</small>` : '<span class="tag warn">non reconnue</span>');
  const status = (r) => (r.conflict ? `<span class="tag warn">conflit</span> <small>${r.conflict.map((x) => `déjà : ${esc(x.period)} (${x.impressions} affich., ${x.spend})`).join(' ; ')}</small>` : r.skip ? `<small>${esc(r.skip)}</small>` : '✓');
  const pick = (r) => r.conflict ? `<select name="act_${cand.indexOf(r)}" form="applyform" aria-label="Que faire du conflit pour ${esc(r.name)}"><option value="skip">Ne pas importer</option><option value="replace">Remplacer l’ancienne mesure (conservée, hors totaux)</option><option value="both">Garder les deux</option></select>` : '';
  return `<h3>Aperçu</h3><p><small>Colonnes reconnues : ${p.mapped.map(esc).join(', ') || '—'}.${p.unmapped.length ? ' Ignorées : ' + p.unmapped.map(esc).join(', ') + '.' : ''} Un « — » veut dire inconnu (colonne absente ou cellule vide), pas zéro.</small></p>
${p.ambiguous ? `<p class="status warn">Certains nombres sont ambigus (ex. « 12.345 »). Indiquez le format du fichier puis relancez l’analyse : <select name="dec" form="importform" aria-label="Format des nombres"><option value="">— choisir —</option><option value=","${p.dec === ',' ? ' selected' : ''}>Virgule décimale (12,5 · 1 234,56)</option><option value="."${p.dec === '.' ? ' selected' : ''}>Point décimal (12.5 · 1,234.56)</option></select></p>` : (p.dec ? `<input type="hidden" name="dec" value="${esc(p.dec)}" form="importform">` : '')}
${p.rows.some((r) => r.choices) ? '<p class="status warn">Plusieurs publicités portent le même nom : choisissez laquelle est visée (liste ci-dessous), puis cliquez sur « Analyser » pour mettre l’aperçu à jour.</p>' : ''}
<table><tr><th>Publicité dans le rapport</th><th>Associée à</th><th>Affich.</th><th>Clics</th><th>Dépense</th><th>Résultats</th><th>Période</th><th>État</th></tr>${p.rows.map((r, i) => `<tr><td>${esc(r.name)}${r.warn ? `<br><small>${esc(r.warn)}</small>` : ''}</td><td>${target(r, i)}</td><td>${num(r.impressions)}</td><td>${num(r.clicks)}</td><td>${money(r.spend)}</td><td>${num(r.conversions)}${r.resultType ? `<br><small>${esc(r.resultType)}</small>` : ''}</td><td>${esc(r.period)}</td><td>${status(r)}${r.conflict ? '<br>' + pick(r) : ''}</td></tr>`).join('')}</table>
${p.rows.some((r) => r.linkId && (!r.skip || r.conflict)) ? '' : ''}${(() => { const all = p.rows.filter((r) => r.linkId && (!r.skip || r.conflict)); const send = all.map((r) => ({ linkId: r.linkId, period: r.period, from: r.from, to: r.to, impressions: r.impressions, clicks: r.clicks, spend: r.spend, conversions: r.conversions, currency: r.currency, resultType: r.resultType, clicksKind: r.clicksKind })); return all.length ? `<form method="post" action="${base}/apply-results" id="applyform" class="inline"><input type="hidden" name="payload" value="${esc(JSON.stringify(send))}"><input type="hidden" name="conflicts" value="${esc(JSON.stringify(all.map((r) => !!r.conflict)))}"><button class="primary">Enregistrer ${all.filter((r) => !r.conflict).length} ligne(s)${all.some((r) => r.conflict) ? ` et appliquer vos choix sur ${all.filter((r) => r.conflict).length} conflit(s)` : ''}</button></form><small>Un même rapport importé deux fois ne crée pas de doublon. Un rapport corrigé ou une période qui en croise une autre n’est jamais additionné : vous choisissez.</small>` : '<p class="status warn">Aucune ligne n’a pu être enregistrée : voir la colonne « État » (publicité à choisir, nombre ambigu, ou nom absent de cette campagne).</p>'; })()}`;
}
