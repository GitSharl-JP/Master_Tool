import { SECTIONS, LANGS, VALIDATION, publishBlockers } from './schema.js';
import { SECRET_DEFS, isSet, preview } from './secrets.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fr = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function layout(title, body, user, flash) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Atelier</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@400;600;700&display=swap">
<link rel="icon" href="/brand/logo.png"><link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script></head><body>
<header><a class="brand" href="/"><img src="/brand/logo.png" alt="Acoustiguide Japan"><span>Atelier marketing</span></a>${user ? `<nav><a href="/">Projets</a><a href="/settings">Réglages</a>
<div class="dd"><button type="button" class="ddb">${esc(user.name)}</button><div class="ddm right"><form method="post" action="/logout"><button class="ddi">Se déconnecter</button></form></div></div></nav>` : ''}</header>
<main>${flash ? `<p class="flash">${esc(flash)}</p>` : ''}${body}</main></body></html>`;
}

export const loginPage = (err) => `<h1>Connexion</h1>${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" action="/login" class="card narrow"><label>Nom<input name="name" autofocus required></label>
<label>Mot de passe<input type="password" name="password" required></label><button>Se connecter</button></form>`;

export const setupPage = (err) => `<h1>Première utilisation</h1><p>Créez votre compte. Vous travaillez seul(e) : un second accès est facultatif (Réglages), jamais nécessaire.</p>
${err ? `<p class="err">${esc(err)}</p>` : ''}<form method="post" action="/setup" class="card narrow">
<label>Votre prénom<input name="name" required></label>
<label>Mot de passe (10 caractères minimum)<input type="password" name="password" minlength="10" required></label><button>Créer le compte</button></form>`;

export function homePage(editions, activity) {
  const rows = editions.map((e) => {
    const approved = SECTIONS.filter((s) => e.validation[s.id]?.status === 'approuvé').length;
    return `<tr><td><a href="/edition/${e.id}">${esc(e.label)}</a>${e.data.provisional === '1' ? ' <span class="tag warn">provisoire</span>' : ''}</td>
<td>${esc(e.data.venue_status)}</td><td>${approved}/${SECTIONS.length} sections approuvées</td><td>${fr(e.updated)}</td></tr>`;
  }).join('');
  return `<h1>Projets</h1>
<table><thead><tr><th>Projet</th><th>Lieu</th><th>Validation</th><th>Modifiée</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Aucun projet.</td></tr>'}</tbody></table>
<form method="post" action="/edition/new" class="inline"><input name="label" placeholder="Nom du nouveau projet" required><button>Créer</button></form>
<h2>Activité récente</h2><ul class="log">${activity.map((a) => `<li><time>${fr(a.at)}</time> <b>${esc(a.who)}</b> ${esc(a.what)}</li>`).join('') || '<li>Rien pour l’instant.</li>'}</ul>`;
}

function fieldHtml(f, v) {
  const id = `f_${f.key}`;
  const help = f.help ? `<small>${esc(f.help)}</small>` : '';
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.key}" rows="3">${esc(v)}</textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" name="${f.key}">${f.options.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (f.type === 'checkbox') return `<label class="check" for="${id}"><input id="${id}" type="checkbox" name="${f.key}" value="1"${v === '1' ? ' checked' : ''}> ${esc(f.label)}</label>`;
  else input = `<input id="${id}" name="${f.key}" type="${f.type}" value="${esc(v)}">`;
  return `<label for="${id}">${esc(f.label)}${input}${help}</label>`;
}

export function editionPage(ed, fieldsBySection, versions, top = '') {
  const blockers = publishBlockers(ed);
  const sections = SECTIONS.map((s) => {
    const val = ed.validation[s.id] || { status: 'brouillon' };
    const fields = fieldsBySection[s.id].map((f) => fieldHtml(f, ed.data[f.key] ?? '')).join('');
    const opts = VALIDATION.map((o) => `<option${o === val.status ? ' selected' : ''}>${o}</option>`).join('');
    return `<section class="card"><h2>${esc(s.title)} <span class="tag st-${VALIDATION.indexOf(val.status)}">${esc(val.status)}</span></h2>
<div class="grid">${fields}</div>
<div class="validate">${val.by ? `<small>Dernier statut : ${esc(val.by)}, ${fr(val.at)}</small>` : ''}
<label>Statut de cette section<select name="status_${s.id}">${opts}</select></label></div></section>`;
  }).join('');
  const prov = ed.data.provisional === '1';
  return `${tabs(ed, 'fiche')}${top}
<p class="status ${blockers.length ? 'warn' : 'ok'}">${blockers.length
    ? `<b>Publication externe bloquée</b> : ${blockers.map(esc).join(' ')}`
    : '<b>Fiche prête</b> : aucun blocage pour la publication.'}</p>
<form method="post" action="/edition/${ed.id}/save">
<label class="check"><input type="checkbox" name="provisional" value="1"${prov ? ' checked' : ''}> Contenu provisoire (à décocher quand les vrais textes sont en place)</label>
${sections}
<button class="primary">Enregistrer</button>
<small>Modifier une section déjà approuvée la repasse automatiquement « à relire ». Langues actives : ${LANGS.join(', ').toUpperCase()}.</small></form>
<div class="card"><h2>Dupliquer ce projet</h2><form method="post" action="/edition/${ed.id}/duplicate" class="inline">
<input name="label" placeholder="Nom de la copie" required><button>Dupliquer</button></form>
<small>La copie repart en brouillon, lieu « à confirmer », sans aucune validation.</small></div>
<div class="card"><h2>Historique des versions</h2><ul class="log">${versions.map((v) => `<li><time>${fr(v.saved_at)}</time> ${esc(v.saved_by)} · ${esc(v.note || '')}
<form method="post" action="/edition/${ed.id}/restore/${v.id}" class="inline"><button class="link">Restaurer</button></form></li>`).join('')}</ul></div>`;
}

export function settingsPage(users, backups, msg) {
  const secrets = SECRET_DEFS.map((d) => {
    const set = isSet(d.key);
    const pv = preview(d);
    return `<form method="post" action="/settings/secret" class="secret"><input type="hidden" name="key" value="${d.key}">
<label>${esc(d.label)} ${set ? '<span class="tag st-2">enregistré</span>' : '<span class="tag">non renseigné</span>'}
${pv ? `<small>Valeur actuelle : ${esc(pv)}</small>` : ''}
<input name="value" type="${d.secret ? 'password' : 'text'}" autocomplete="off" placeholder="${set ? 'Saisir pour remplacer' : 'Saisir la valeur'}">
${d.help ? `<small>${esc(d.help)}</small>` : ''}</label><button>Enregistrer</button>${set ? '<button name="clear" value="1" class="link">Effacer</button>' : ''}</form>`;
  }).join('');
  return `<h1>Réglages</h1>${msg ? `<p class="flash">${esc(msg)}</p>` : ''}
<div class="card"><h2>Connexions (champs sécurisés)</h2>
<p>Ces valeurs sont stockées uniquement sur cet ordinateur (<code>data/secrets.json</code>, hors Git). Elles ne sont <b>jamais réaffichées</b> une fois enregistrées et ne doivent jamais être envoyées dans une conversation ou un e-mail.</p>${secrets}</div>
<div class="card"><h2>Accès</h2><p><small>L’atelier fonctionne très bien avec un seul accès. Ajouter un second accès (facultatif) ne change rien à votre façon de travailler : tout reste faisable seul(e).</small></p><ul>${users.map((u) => `<li>${esc(u.name)}</li>`).join('')}</ul>
${users.length < 2 ? `<form method="post" action="/settings/user" class="inline"><input name="name" placeholder="Prénom" required>
<input type="password" name="password" placeholder="Mot de passe (10+ car.)" minlength="10" required><button>Ajouter</button></form>` : '<small>Second accès en place.</small>'}</div>`;
}

// ---------------------------------------------------------------- onglets / assets / affiches
import { ROLES, POSTER_FORMATS } from './studio.js';
import { POSTER_ELEMENTS, elementsFor } from './render.js';
import { CHANNELS, channelsOf } from './formats.js';

// Navigation d'un projet, organisée comme la logique du produit : le projet possède son site et sa bibliothèque ;
// la création sert à produire ; les campagnes (créées dans Meta) puisent dans la bibliothèque.
export const tabs = (ed, active) => {
  const groups = [
    ['Projet', [['fiche', 'Fiche spectacle', 'Les informations de référence', `/edition/${ed.id}`], ['site', 'Site web', 'Pages du site du projet', `/edition/${ed.id}/site`], ['calendrier', 'Calendrier', 'Planning des publications', `/edition/${ed.id}/calendar`]]],
    ['Bibliothèque', [['assets', 'Assets', 'Photos, vidéos, audio, sources', `/edition/${ed.id}/assets`], ['designs', 'Designs', 'Modèles d’affiches et de vidéos', `/edition/${ed.id}/designs`], ['contenus', 'Contenus', 'Textes et légendes', `/edition/${ed.id}/contents`]]],
    ['Création', [['variantes', 'Variantes', 'Déclinaisons guidées', `/edition/${ed.id}/variants`], ['affiches', 'Affiches', 'Éditeur d’affiche', `/edition/${ed.id}/poster/4x5`], ['videos', 'Vidéos', 'Montage et sous-titres', `/edition/${ed.id}/video`]]],
    ['Meta', [['campagnes', 'Campagnes', 'Préparer et suivre', `/edition/${ed.id}/campaigns`]]],
  ];
  const cur = groups.find(([, items]) => items.some(([k]) => k === active));
  const curItem = cur && cur[1].find(([k]) => k === active);
  return `<h1>${esc(ed.label)} <small class="crumb">projet</small></h1><div class="pmenu">${groups.map(([g, items]) => `<div class="dd${cur && cur[0] === g ? ' on' : ''}"><button type="button" class="ddb">${g}</button><div class="ddm">${items.map(([k, n, d, h]) => `<a href="${h}" class="ddi${k === active ? ' on' : ''}"><b>${n}</b><small>${d}</small></a>`).join('')}</div></div>`).join('')}</div>
${curItem ? `<p class="where">${cur[0]} › <b>${curItem[1]}</b></p>` : ''}`;
};

const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

export function assetsPage(ed, assets, msg, storageInfo = '') {
  const rows = assets.map((a) => `<form method="post" action="/assets/${a.id}/update" class="card asset">
<div class="thumb">${a.kind === 'image' ? `<img src="/files/${a.id}" alt="">`
    : a.kind === 'video' ? `<video src="/files/${a.id}#t=0.5" preload="metadata" controls></video>`
      : a.kind === 'audio' ? `<audio src="/files/${a.id}" preload="none" controls></audio>`
        : `<span>${esc(a.kind)}</span>`}<a href="/files/${a.id}" target="_blank"><small>Ouvrir</small></a></div>
<div class="meta"><b>${esc(a.name)}</b> <small>${kb(a.size)} · ${esc(a.uploaded_by)} · ${fr(a.created)}</small>
<div class="grid">
<label>Rôle<select name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === a.role ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
<label>Statut<select name="status">${VALIDATION.map((s) => `<option${s === a.status ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
<label>Droits / autorisation<input name="rights" value="${esc(a.rights)}" placeholder="Ex. Orfeo, usage promo OK jusqu'en 2028"></label></div>
<label class="check"><input type="checkbox" name="provisional" value="1"${a.provisional ? ' checked' : ''}> Provisoire (à remplacer par le visuel final)</label>
<button>Enregistrer</button></div></form>`).join('');
  return `${tabs(ed, 'assets')}${msg ? `<p class="flash">${esc(msg)}</p>` : ''}
<div class="card"><h2>Ajouter un fichier</h2>
<form id="up" data-edition="${ed.id}" class="inline"><input type="file" id="upfile" required>
<select id="uprole">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><button>Envoyer</button></form>
<small>Photos (JPG, PNG, WebP, GIF), vidéos (MP4, MOV, WebM), audio (MP3, WAV, M4A), sous-titres (SRT, VTT) et fichiers sources du graphiste (PSD, AI, PDF, ZIP, FIG). Stockage actuel : ${esc(storageInfo)}.
Une affiche aplatie ne permet pas de déplacer ses éléments : demandez les fichiers sources.</small><p id="upmsg"></p></div>
${rows || '<p>Aucun fichier pour l’instant. Tant qu’aucune photo n’est ajoutée, les affiches et le site utilisent une image « PLACEHOLDER ».</p>'}`;
}

export function posterPage(ed, fmt, design, assets, exports, msg, blockers, history = [], variant = null) {
  const vq = variant ? `variant=${variant.id}` : '', qs = vq ? `?${vq}` : '', qa = vq ? `&${vq}` : '';
  const imgs = assets.filter((a) => a.kind === 'image');
  const opt = (list, cur) => `<option value="">— aucune —</option>${list.map((a) => `<option value="${a.id}"${String(a.id) === String(cur) ? ' selected' : ''}>${esc(a.name)}${a.provisional ? ' (provisoire)' : ''}</option>`).join('')}`;
  // curseur + champ numérique (ajouté par app.js) pour saisir la valeur exacte
  const range = (k, label, lo, hi) => `<label>${label}<span class="rng"><input type="range" name="${k}" min="${lo}" max="${hi}" value="${design[k]}"></span></label>`;
  const f = POSTER_FORMATS[fmt];
  return `<span id="lockpage"></span>${tabs(ed, variant ? 'variantes' : 'affiches')}${msg ? `<p class="flash">${esc(msg)}</p>` : ''}
${variant ? `<p class="status ok"><b>Variante « ${esc(variant.name)} »</b> — vous modifiez uniquement les affiches de cette variante (jamais celles du projet). <a href="/edition/${ed.id}/variants/${variant.id}">← Retour à la variante</a>${variant.status === 'approuvé' ? ' <br><small>Toute modification la repassera « à relire » ; la version approuvée et ses exports restent intacts. Ici, « Exporter en PNG » produit un <b>essai</b> ; l’export officiel se fait depuis la page de la variante.</small>' : ''}</p>` : ''}
<div class="tabs sub">${Object.entries(POSTER_FORMATS).filter(([k]) => !variant || variant.formats.includes(k)).map(([k, v]) => `<a href="/edition/${ed.id}/poster/${k}${qs}"${k === fmt ? ' class="on"' : ''}>${v.label}</a>`).join('')}</div>
<p class="fmtnote"><b>${esc(f.ratio)} · ${f.w}×${f.h}</b> — utilisé pour : ${esc(channelsOf(fmt).join(', ') || '—')}. Zones de sécurité (haut / bas) : ${f.safe.top} / ${f.safe.bottom} px. <small>Tailles courantes recommandées par les plateformes : à re-vérifier avant campagne.</small></p>
<div class="studio"><div class="stack"><form id="pform" method="post" action="/edition/${ed.id}/poster/${fmt}/save${qs}" class="card" data-variant="${variant ? variant.id : ''}" data-edition="${ed.id}" data-fmt="${fmt}" data-w="${f.w}" data-h="${f.h}" data-elements="${esc(JSON.stringify(elementsFor(design.style, f.layout).map((k) => [k, POSTER_ELEMENTS[k]])))}">
<input type="hidden" name="els" value="${esc(JSON.stringify(design.els || {}))}">
<div class="actions"><button class="primary">Enregistrer</button><button formaction="/edition/${ed.id}/poster/${fmt}/export${qs}">${variant ? 'Export d’essai (PNG)' : 'Exporter en PNG'}</button></div>
<div class="inline"><a href="/edition/${ed.id}/poster/${fmt}/svg${qs}">SVG (Illustrator)</a> · <a href="/edition/${ed.id}/poster/${fmt}/pdf${qs}">PDF vectoriel</a>${variant ? '' : ` · <a href="/edition/${ed.id}/designs">Enregistrer dans la bibliothèque de designs</a>`}</div>
<small>Titre, dates, lieu et couleurs viennent de la <a href="/edition/${ed.id}">fiche</a>. ${blockers ? 'L’export sera marqué BROUILLON tant que la fiche n’est pas prête.' : ''}</small>
<div class="elpanel"><h2>Éléments de l’affiche</h2>
<small>Sur l’aperçu : <b>clic</b> pour sélectionner, <b>glisser</b> pour déplacer, <b>poignée</b> bleue pour la taille, <b>double-clic</b> pour modifier le texte, <b>flèches</b> pour ajuster (Maj = plus vite), <b>Suppr</b> pour masquer. Glisser dans le vide recadre la photo, la molette la zoome.</small>
<ul id="ellist" class="ellist"></ul>
<div id="elsel" hidden><h3 id="elname"></h3>
<label>Position horizontale<span class="rng"><input type="range" id="el_dx" min="-1500" max="1500" value="0"></span></label>
<label>Position verticale<span class="rng"><input type="range" id="el_dy" min="-2000" max="2000" value="0"></span></label>
<label>Taille (%)<span class="rng"><input type="range" id="el_s" min="20" max="400" value="100"></span></label>
<label>Couleur<span class="inline"><input type="color" id="el_color" value="#ffffff"><button type="button" id="el_color_reset" class="link">Couleur d’origine</button></span></label>
<label>Texte (cette affiche seulement)<textarea id="el_text" rows="2"></textarea><small>Vide = texte de la fiche. La fiche n’est pas modifiée.</small></label>
<span class="inline"><button type="button" id="el_text_reset" class="link">Texte de la fiche</button><button type="button" id="el_reset" class="link">Réinitialiser l’élément</button><button type="button" id="el_hide" class="link">Masquer</button></span></div>
<button type="button" id="el_all_reset" class="link">Tout remettre à zéro</button></div>
<label>Photo de fond<select name="hero">${opt(imgs.filter((a) => a.role !== 'logo'), design.hero)}</select></label>
<label>Logo<select name="logo">${opt(imgs.filter((a) => a.role === 'logo'), design.logo)}</select></label>
${range('gradient', 'Intensité du dégradé', 0, 100)}${range('posx', 'Cadrage horizontal de la photo', 0, 100)}${range('posy', 'Cadrage vertical de la photo', 0, 100)}
${range('zoom', 'Zoom de la photo', 100, 250)}
<label>Composition<select name="style">${[['classique', 'Classique (texte sur photo)'], ['bandeau', 'Bandeau (titre incliné)']].map(([k, n]) => `<option value="${k}"${k === design.style ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
<label class="check"><input type="checkbox" name="partners" value="1"${design.partners === '1' ? ' checked' : ''}> Afficher les logos partenaires (assets « Logo partenaire »)</label>
<label>Position du texte<select name="text_pos">${['haut', 'milieu', 'bas'].map((p) => `<option${p === design.text_pos ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
</form>
<div class="card"><h2>Historique des réglages de ce format</h2><ul class="log hist">${history.map((h) => `<li><time>${fr(h.saved_at)}</time> ${esc(h.saved_by)} · ${esc(h.reason)} <form method="post" action="/edition/${ed.id}/poster/${fmt}/restore/${h.id}${qs}" class="inline"><button class="link">Restaurer</button></form></li>`).join('') || '<li>Aucun enregistrement.</li>'}</ul></div>
<form class="card" method="post" action="/edition/${ed.id}/pack"><h2>Pack campagne par canal</h2>
<small>Produit d’un coup tous les formats utiles aux canaux cochés, à partir des réglages de chaque format (photo, logo, dégradé repris du dernier format réglé ; positions propres à chaque forme). Un zip classé par canal est créé.</small>
<div class="chanlist">${Object.entries(CHANNELS).map(([k, c]) => `<label class="check"><input type="checkbox" name="ch_${k}" value="1"> <span><b>${esc(c.label)}</b> <small>${c.uses.map(([fm, use]) => `${esc(use)} ${esc(POSTER_FORMATS[fm].ratio)}`).join(' · ')}</small></span></label>`).join('')}</div>
<button>Créer le pack (zip)</button></form>
<div class="card"><h2>Exports (fichiers produits — rien n’est publié)</h2>${exports.filter((e) => e.kind === 'pack').map((e) => `<div class="exp"><div><b>${esc(e.label)}</b> ${e.draft ? '<span class="tag warn">BROUILLON</span>' : '<span class="tag st-2">propre</span>'}<br><small>${fr(e.created)} · ${esc(e.created_by)} · <a href="/exports/${e.id}?dl=1">Télécharger le zip</a></small></div></div>`).join('')}${exports.filter((e) => e.kind === 'affiche').map((e) => `<div class="exp"><a href="/exports/${e.id}"><img src="/exports/${e.id}" alt=""></a>
<div><b>${esc(e.label)}</b> ${e.draft ? '<span class="tag warn">BROUILLON</span>' : '<span class="tag st-2">propre</span>'}<br><small>${fr(e.created)} · ${esc(e.created_by)} · <a href="/exports/${e.id}?dl=1">Télécharger</a></small></div></div>`).join('') || '<p>Aucun export.</p>'}</div></div>
<div class="preview" id="pwrap"><iframe id="pframe" src="/render/poster/${ed.id}/${fmt}${qs}" title="Aperçu" width="${f.w}" height="${f.h}"></iframe></div></div>`;
}

// ---------------------------------------------------------------- vidéo
import { FORMATS, VIDEO_FORMATS } from './formats.js';

export function videoPage(ed, c) {
  const { design: d, cues, info, assets, ready, draft, msg, variant } = c;
  const qs = variant ? `?variant=${variant.id}` : '';
  const videos = assets.filter((a) => a.kind === 'video');
  const logos = assets.filter((a) => a.kind === 'image' && (a.role === 'logo' || a.role === 'partner'));
  const texts = assets.filter((a) => a.kind === 'text');
  const opt = (list, cur, none = '— aucun —') => `<option value="">${none}</option>${list.map((a) => `<option value="${a.id}"${String(a.id) === String(cur) ? ' selected' : ''}>${esc(a.name)}${a.provisional ? ' (provisoire)' : ''}</option>`).join('')}`;
  const rng = (id, label, lo, hi, v, step = 1) => `<label>${label}<span class="rng"><input type="range" id="${id}" min="${lo}" max="${hi}" step="${step}" value="${v}"></span></label>`;
  const fm = Object.fromEntries(VIDEO_FORMATS.map((k) => [k, { w: FORMATS[k].w, h: FORMATS[k].h, safe: FORMATS[k].safe, label: FORMATS[k].label }]));
  return `<span id="lockpage"></span>${tabs(ed, variant ? 'variantes' : 'videos')}${variant ? `<p class="status ok"><b>Variante « ${esc(variant.name)} »</b> — sous-titres, cadrages et réglages propres à cette variante. <a href="/edition/${ed.id}/variants/${variant.id}">← Retour à la variante</a><br><small>« Lancer les exports » produit ici des <b>essais</b> ; l’export officiel (version approuvée) se fait depuis la page de la variante.</small></p>` : ''}${msg ? `<p class="flash">${esc(msg)}</p>` : ''}
${ready ? '' : '<p class="status warn"><b>ffmpeg est introuvable</b> : les exports vidéo sont impossibles. Il doit se trouver dans <code>tools/ffmpeg/</code>.</p>'}
<div class="studio"><div class="stack">
<form id="vform" method="post" action="/edition/${ed.id}/video/save${qs}" class="card" data-edition="${ed.id}" data-draft="${draft ? 1 : 0}"
 data-design="${esc(JSON.stringify(d))}" data-cues="${esc(JSON.stringify(cues))}" data-info="${esc(JSON.stringify(info || null))}" data-formats="${esc(JSON.stringify(fm))}">
<input type="hidden" name="design"><input type="hidden" name="cues">
<div class="actions"><button class="primary">Enregistrer</button><button formaction="/edition/${ed.id}/video/export${qs}"${ready ? '' : ' disabled'}>Lancer les exports</button></div>
<small>Rien n’est publié : un export est un fichier produit. ${draft ? 'Les vidéos seront marquées BROUILLON (fiche non prête ou source provisoire).' : ''}</small>

<div class="elpanel"><h2>1 · Vidéo source</h2>
<label>Fichier<select id="v_asset">${opt(videos, d.asset, '— choisir une vidéo —')}</select></label>
${videos.length ? '' : `<small>Aucune vidéo : ajoutez-en une dans l’onglet <a href="/edition/${ed.id}/assets">Assets</a> (rôle « Vidéo »).</small>`}
${info ? `<small>${info.w}×${info.h} · ${info.duration.toFixed(1)} s · ${info.fps} i/s · ${info.hasAudio ? 'avec son' : 'sans son'}</small>` : ''}</div>

<div class="elpanel"><h2>2 · Extrait à exporter</h2>
${rng('v_start', 'Début (s)', 0, Math.max(1, Math.floor(info?.duration || 60)), d.start, 0.1)}
${rng('v_end', 'Fin (s) — 0 = jusqu’à la fin', 0, Math.max(1, Math.floor(info?.duration || 60)), d.end, 0.1)}
<span class="inline"><button type="button" id="v_setstart" class="link">Début = position du lecteur</button><button type="button" id="v_setend" class="link">Fin = position du lecteur</button><button type="button" id="v_playclip" class="link">▶ Lire l’extrait</button></span></div>

<div class="elpanel"><h2>3 · Cadrage par format</h2>
<small>Chaque format a son propre cadrage : l’aperçu montre exactement ce qui sera exporté.</small>
<div class="tabs sub" id="v_fmtTabs">${VIDEO_FORMATS.map((k) => `<a href="#" data-fmt="${k}">${esc(FORMATS[k].label)}</a>`).join('')}</div>
${rng('v_posx', 'Cadrage horizontal', 0, 100, 50)}${rng('v_posy', 'Cadrage vertical', 0, 100, 50)}${rng('v_zoom', 'Zoom', 100, 300, 100)}
<label class="check"><input type="checkbox" id="v_guides" checked> Afficher les zones de sécurité (interfaces des Stories / TikTok)</label></div>

<div class="elpanel"><h2>4 · Logo</h2>
<label>Logo à incruster<select id="v_logo">${opt(logos, d.logo.asset)}</select></label>
<label>Coin<select id="v_corner">${[['tl', 'Haut gauche'], ['tr', 'Haut droite'], ['bl', 'Bas gauche'], ['br', 'Bas droite']].map(([k, n]) => `<option value="${k}"${k === d.logo.corner ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
${rng('v_lsize', 'Taille (% de la largeur)', 5, 40, d.logo.size)}${rng('v_lmargin', 'Marge (% de la largeur)', 0, 15, d.logo.margin)}</div>

<div class="elpanel"><h2>5 · Écran de fin</h2>
<label class="check"><input type="checkbox" id="v_end"${d.endcard.on ? ' checked' : ''}> Ajouter un écran de fin</label>
${rng('v_endsec', 'Durée (s)', 1, 10, d.endcard.seconds)}
<small>Reprend l’affiche de ce format (onglet <a href="/edition/${ed.id}/poster/4x5">Affiches</a>) : même direction artistique, titre, dates et bouton.</small></div>

<div class="elpanel"><h2>6 · Sous-titres</h2>
<label class="check"><input type="checkbox" id="v_subs"${d.subs.on ? ' checked' : ''}> Incruster les sous-titres</label>
${rng('v_ssize', 'Taille (%)', 60, 160, d.subs.size)}
<small>Placés au-dessus de la zone réservée par chaque plateforme. À relire avant export : les temps sont ceux de la vidéo complète.</small>
<div id="v_cues" class="cues"></div>
<span class="inline"><button type="button" id="v_addcue" class="link">+ Ajouter à la position du lecteur</button><a href="/edition/${ed.id}/video/subs.srt${qs}">Télécharger .srt</a></span></div>

<div class="elpanel"><h2>7 · Formats à exporter</h2>
${VIDEO_FORMATS.map((k) => `<label class="check"><input type="checkbox" class="v_fmtchk" value="${k}"${d.formats.includes(k) ? ' checked' : ''}> ${esc(FORMATS[k].label)} <small>${FORMATS[k].w}×${FORMATS[k].h}</small></label>`).join('')}</div>
</form>

<form class="card" method="post" action="/edition/${ed.id}/video/subs-import${qs}"><h2>Importer des sous-titres</h2>
<label>Fichier SRT / VTT (asset)<select name="asset">${opt(texts, '', '— choisir —')}</select></label>
<small>Remplace les sous-titres actuels (${cues.length} ligne(s)). Pour ajouter un fichier : onglet <a href="/edition/${ed.id}/assets">Assets</a>, rôle « Sous-titres ».
La transcription automatique et la traduction ne sont pas encore disponibles.</small>
<button>Importer</button></form>

<div class="card"><h2>Exports vidéo</h2><div id="v_jobs"><small>Chargement…</small></div></div>
</div>
<div class="preview" id="pwrap"><div id="vframe" class="vframe"><video id="vplayer" playsinline preload="metadata"></video><img id="vlogo" alt=""><div id="vguides"></div><div id="vsub"></div><div id="vdraft">DRAFT — NOT FOR PUBLICATION</div></div>
<div class="vbar"><button type="button" id="vplay">▶</button><input type="range" id="vscrub" min="0" max="1000" value="0"><span id="vtime">0:00</span></div></div></div>
<script src="/video.js" defer></script>`;
}

// ---------------------------------------------------------------- bibliothèque de designs
export function designsPage(ed, c) {
  const { templates, versions, applications, bundles, msg } = c;
  const mine = templates.filter((t) => t.project_id === ed.id), others = templates.filter((t) => t.project_id !== ed.id);
  const card = (t) => `<div class="card dcard"><div class="dthumb">${versions[t.id][0]?.thumb ? `<img src="/library/thumb/${versions[t.id][0].id}" alt="">` : '<span>pas d’aperçu</span>'}</div>
<div class="dmeta"><h2>${esc(t.name)}</h2><small>${t.versions} version(s) · modifié ${fr(t.updated)}${t.parent_id ? ' · copie d’un autre design' : ''}</small>
<ul class="log">${versions[t.id].map((v) => `<li><b>v${v.version}</b> <time>${fr(v.created)}</time> ${esc(v.created_by)}${v.note ? ' · ' + esc(v.note) : ''}
<span class="inline"><a href="/edition/${ed.id}/designs/apply/${v.id}">Appliquer à ce projet</a>
<form method="post" action="/edition/${ed.id}/designs/bundle/${v.id}" class="inline"><button class="link">Créer l’archive (.zip)</button></form></span></li>`).join('')}</ul>
<form method="post" action="/edition/${ed.id}/designs/duplicate/${t.id}" class="inline"><input name="name" placeholder="Nom de la copie (ex. « ${esc(t.name)} — variante »)"><button>Dupliquer</button></form></div></div>`;
  return `${tabs(ed, 'designs')}${msg ? `<p class="flash">${esc(msg)}</p>` : ''}
<div class="card"><h2>Enregistrer le design de ce projet</h2>
<p>Conserve <b>tout le travail graphique actuel</b> de « ${esc(ed.label)} » : composition de chaque format, éléments séparés (position, taille, couleur, texte), images et logos utilisés (copies conservées avec le design), charte et style vidéo. Le résultat reste <b>modifiable</b> : ce n’est pas une image aplatie.</p>
<form method="post" action="/edition/${ed.id}/designs/save" class="grid">
<label>Ajouter à un design existant (nouvelle version)<select name="templateId"><option value="">— nouveau design —</option>${templates.map((t) => `<option value="${t.id}">${esc(t.name)} (v${t.last_version})</option>`).join('')}</select></label>
<label>Nom (nouveau design)<input name="name" placeholder="Ex. Night show — direction artistique 2027"></label>
<label>Note de version<input name="note" placeholder="Ce qui a changé, pour s’en souvenir plus tard"></label>
<div><button class="primary">Enregistrer dans la bibliothèque</button></div></form>
<small>Format .ai d’Illustrator : non produit (format propriétaire). Chaque design s’exporte en <b>SVG</b> (un calque par élément, texte modifiable) et <b>PDF vectoriel</b>, inclus dans l’archive .zip.</small></div>
${mine.length ? `<h2>Designs de ce projet</h2>${mine.map(card).join('')}` : ''}
${others.length ? `<h2>Designs d’autres projets <small>— à réappliquer ici avec vos assets et vos informations</small></h2>${others.map(card).join('')}` : ''}
${!templates.length ? '<p>Aucun design enregistré pour l’instant.</p>' : ''}
<div class="card"><h2>Archives</h2>${bundles.map((e) => `<div class="exp"><div><b>${esc(e.label)}</b><br><small>${fr(e.created)} · ${esc(e.created_by)} · <a href="/exports/${e.id}?dl=1">Télécharger</a></small></div></div>`).join('') || '<small>Aucune archive créée.</small>'}
<h3>Importer une archive</h3><form id="importform" class="inline" data-edition="${ed.id}"><input type="file" id="importfile" accept=".zip" required><button>Importer</button></form><small id="importmsg">Retrouve un design enregistré sur une autre installation ou des années plus tôt.</small></div>
${applications.length ? `<div class="card"><h2>Applications récentes à ce projet</h2><ul class="log">${applications.map((a) => `<li><time>${fr(a.applied_at)}</time> ${esc(a.applied_by)} · « ${esc(a.name)} » v${a.version}${a.summary ? ' · ' + esc(a.summary) : ''}</li>`).join('')}</ul></div>` : ''}`;
}

export function applyDesignPage(ed, t, v, projectAssets) {
  const imgs = projectAssets.filter((a) => a.kind === 'image');
  const rows = Object.entries(v.snapshot.assets).map(([id, a]) => {
    const same = imgs.filter((p) => p.role === a.role);
    return `<div class="card slot"><div class="dthumb sm"><img src="/library/asset/${v.id}/${id}" alt=""></div><div>
<b>${esc(a.name)}</b> <small>(${esc(ROLES[a.role] || a.role)} dans le design)</small>
<label>Remplacer par<select name="map_${id}">
<option value="${same[0] ? same[0].id : 'copy'}">${same[0] ? 'Le même rôle dans ce projet : ' + esc(same[0].name) : 'Garder l’image du design (copie, marquée provisoire)'}</option>
${same.slice(1).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
${same[0] ? '<option value="copy">Garder l’image du design (copie)</option>' : ''}
${imgs.filter((p) => p.role !== a.role).map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(ROLES[p.role] || p.role)})</option>`).join('')}
<option value="">— aucune —</option></select></label></div></div>`;
  }).join('');
  return `${tabs(ed, 'designs')}
<h2>Appliquer « ${esc(t.name)} » v${v.version} à « ${esc(ed.label)} »</h2>
<div class="dthumb big">${v.thumb ? `<img src="/library/thumb/${v.id}" alt="">` : ''}</div>
<p>La <b>composition</b> de chaque format est reprise (positions, tailles, couleurs, styles). Vous choisissez ci-dessous les <b>assets</b> qui remplacent ceux du design. Les <b>informations</b> (titre, dates, lieu, textes) restent celles de ce projet.</p>
<p class="status warn">Les réglages actuels des affiches de ce projet sont remplacés, mais l’historique les conserve : vous pourrez revenir en arrière depuis l’onglet Affiches.</p>
<form method="post" action="/edition/${ed.id}/designs/apply/${v.id}">${rows}
<div class="card"><h2>Options</h2>
<label class="check"><input type="checkbox" name="brand" value="1"> Reprendre aussi la charte du design (couleurs et polices) <small>— la section « Charte graphique » du projet repassera « à relire »</small></label>
<label class="check"><input type="checkbox" name="texts" value="1"> Conserver les textes modifiés à la main sur les affiches du design <small>— sinon les textes viennent de la fiche du projet</small></label>
<label class="check"><input type="checkbox" name="video" value="1" checked> Reprendre le style vidéo (logo, écran de fin, sous-titres)</label></div>
<button class="primary">Appliquer ce design</button> <a href="/edition/${ed.id}/designs">Annuler</a></form>`;
}

