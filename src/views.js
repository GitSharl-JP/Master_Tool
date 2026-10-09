import { SECTIONS, LANGS, VALIDATION, publishBlockers } from './schema.js';
import { SECRET_DEFS, isSet, preview } from './secrets.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fr = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function layout(title, body, user, flash) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Atelier</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@400;600;700&display=swap">
<link rel="icon" type="image/png" href="/brand/icon.png"><link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script></head><body>
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

// Gestionnaire de projets : ouvrir, renommer, archiver (récupérable), supprimer (définitif, nom à retaper).
export function homePage(editions, activity) {
  const row = (e, archived) => {
    const approved = SECTIONS.filter((s) => e.validation[s.id]?.status === 'approuvé').length;
    return `<tr><td><a href="/edition/${e.id}"><b>${esc(e.label)}</b></a>${e.data.provisional === '1' ? ' <span class="tag warn">provisoire</span>' : ''}
<details class="mini"><summary>Renommer</summary><form method="post" action="/edition/${e.id}/rename" class="inline"><input type="hidden" name="from" value="home"><input name="label" value="${esc(e.label)}" required><button>OK</button></form></details></td>
<td>${esc(e.data.venue_status)}</td><td>${approved}/${SECTIONS.length}</td><td>${fr(e.updated)}</td>
<td class="acts"><a class="btn sm" href="/edition/${e.id}">Ouvrir</a>
<form method="post" action="/edition/${e.id}/${archived ? 'unarchive' : 'archive'}" class="inline"><button class="link">${archived ? 'Remettre dans la liste' : 'Archiver'}</button></form>
<a class="danger" href="/edition/${e.id}/delete">Supprimer</a></td></tr>`;
  };
  const live = editions.filter((e) => !e.archived), old = editions.filter((e) => e.archived);
  const head = '<thead><tr><th>Projet</th><th>Lieu</th><th>Infos validées</th><th>Modifié</th><th>Actions</th></tr></thead>';
  return `<h1>Projets</h1>
<table class="projects">${head}<tbody>${live.map((e) => row(e, false)).join('') || '<tr><td colspan="5">Aucun projet.</td></tr>'}</tbody></table>
<div class="inline"><form method="post" action="/edition/new" class="inline"><input name="label" placeholder="Nom du nouveau projet" required><button>Créer</button></form>
<form method="post" action="/edition/test" class="inline"><button class="link" title="Crée un projet avec une fiche d'exemple provisoire, pour tester sans risque">+ Projet d’essai</button></form></div>
${old.length ? `<details class="card"><summary><b>Projets archivés (${old.length})</b></summary><table class="projects">${head}<tbody>${old.map((e) => row(e, true)).join('')}</tbody></table></details>` : ''}
<h2>Activité récente</h2><ul class="log">${activity.map((a) => `<li><time>${fr(a.at)}</time> <b>${esc(a.who)}</b> ${esc(a.what)}</li>`).join('') || '<li>Rien pour l’instant.</li>'}</ul>`;
}

export function deleteProjectPage(ed, c) {
  const items = [[c.assets, 'fichier(s)'], [c.variants, 'contenu(s) affiche/vidéo'], [c.exports, 'export(s)'], [c.contents, 'contenu(s)'], [c.campaigns, 'campagne(s) reliée(s)']].filter(([k]) => k).map(([k, n]) => `${k} ${n}`);
  return `<h1>Supprimer « ${esc(ed.label)} » ?</h1>
<div class="card"><p class="status warn"><b>Définitif.</b> Seront effacés pour de bon : ${items.join(', ') || 'la fiche et son historique'}, ainsi que le calendrier, le site et les identifiants WordPress de ce projet. La bibliothèque de designs (modèles) n’est pas touchée.</p>
${c.diffused ? `<p class="status warn"><b>${c.diffused} association(s) déjà « transmise(s) » ou « publiée(s) »</b> : ce qui est en ligne dans Meta n’est pas touché, mais l’atelier en perdra la trace.</p>` : ''}
<p>Pas sûr(e) ? <b>Archivez</b> plutôt : le projet disparaît de la liste mais reste intact.</p>
<form method="post" action="/edition/${ed.id}/delete"><label>Pour confirmer, retapez exactement le nom du projet : <b>${esc(ed.label)}</b><input name="confirm" autocomplete="off" required></label>
<div class="inline"><button class="danger-btn">Supprimer définitivement</button> <a href="/">Annuler</a></div></form>
<form method="post" action="/edition/${ed.id}/archive" class="inline"><button class="link">Archiver à la place</button></form></div>`;
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

// Connexions du projet : la configuration Meta (saisie à la main) vit ici, la page Campagnes n'en garde qu'un indicateur.
const metaConnectionCard = (ed, meta) => `<div class="card" id="connexions"><h2>Connexions du projet</h2>
<h3>Meta <span class="tag warn">non connecté — saisie à la main</span></h3>
<p class="status warn">Aucune synchronisation n’a eu lieu (${meta.synced_at ? 'dernière : ' + fr(meta.synced_at) : 'jamais'}). Ce qui est saisi ici est <b>non vérifié</b>. Rien n’est envoyé à Meta, rien n’y est modifié. <b>L’absence de connexion ne bloque aucun travail de production.</b></p>
<form method="post" action="/edition/${ed.id}/campaigns/meta" class="grid"><input type="hidden" name="from" value="settings">
<label>Compte publicitaire (ID)<input name="ad_account" value="${esc(meta.ad_account)}" placeholder="act_1234567890"></label>
<label>Page Facebook<input name="page_name" value="${esc(meta.page_name)}"></label><label>Compte Instagram<input name="instagram" value="${esc(meta.instagram)}"></label>
<label>Note<input name="note" value="${esc(meta.note)}"></label><div><button>Enregistrer</button></div></form>
<details><summary>Ce que l’API Meta permettra, et ce qu’il faudra toujours saisir</summary>
<table><tr><th>Récupérable via l’API</th><th>Toujours à vous (brief interne)</th><th>Avec récapitulatif et confirmation</th></tr>
<tr><td>Campagnes, ensembles, annonces : noms, identifiants, statuts, objectif Meta, budget configuré, ciblage réel<br>Résultats par niveau, avec ventilation par image ou vidéo</td>
<td>Objectif interne, angle, intention, audience souhaitée, hypothèse, message, langues, budget prévu, consignes</td>
<td>Envoyer un visuel ou une vidéo vers Meta<br>Toute modification dans Meta (jamais automatique)</td></tr></table>
<small>Accès (source officielle Meta, à reconfirmer à la mise en place) : l’accès « standard » aux permissions <code>ads_read</code> et <code>ads_management</code> suffit pour gérer <b>ses propres</b> comptes publicitaires ; l’accès avancé (avec examen de l’application) concerne les comptes d’<b>autres</b> personnes. La vérification d’entreprise n’est pas établie comme obligatoire pour notre cas.</small></details>
<h3>Site WordPress</h3><p>Le domaine et les identifiants du site de ce projet se règlent dans <a href="/edition/${ed.id}/site">Site web</a>.</p></div>`;

export function editionPage(ed, fieldsBySection, versions, top = '', meta = null) {
  const blockers = publishBlockers(ed);
  const sections = SECTIONS.map((s) => {
    const val = ed.validation[s.id] || { status: 'brouillon' };
    const fields = fieldsBySection[s.id].map((f) => fieldHtml(f, ed.data[f.key] ?? '')).join('');
    const opts = VALIDATION.map((o) => `<option${o === val.status ? ' selected' : ''}>${o}</option>`).join('');
    return `<section class="card" id="sec-${s.id}"><h2>${esc(s.title)} <span class="tag st-${VALIDATION.indexOf(val.status)}">${esc(val.status)}</span></h2>
<div class="grid">${fields}</div>
<div class="validate">${val.by ? `<small>Dernier statut : ${esc(val.by)}, ${fr(val.at)}</small>` : ''}
<label>Statut de cette section<select name="status_${s.id}">${opts}</select></label></div></section>`;
  }).join('');
  const prov = ed.data.provisional === '1';
  return `${tabs(ed, 'fiche')}${top}
<p class="lead"><b>Paramètres du projet</b> — les informations du spectacle (titre, dates, lieu, billets, charte). Elles alimentent les affiches, les vidéos et le site ; on y revient rarement.</p>
<p class="status ${blockers.length ? 'warn' : 'ok'}">${blockers.length
    ? `<b>Pour publier le site</b>, il reste : ${blockers.map(esc).join(' ')}<br><small>Une affiche ou une vidéo n’a besoin que des informations qu’elle affiche : elle n’est pas bloquée par le reste (voir les contrôles du contenu).</small>`
    : '<b>Fiche prête</b> : aucun blocage pour la publication.'}</p>
<form method="post" action="/edition/${ed.id}/save">
<label class="check"><input type="checkbox" name="provisional" value="1"${prov ? ' checked' : ''}> Contenu provisoire (à décocher quand les vrais textes sont en place)</label>
${sections}
<button class="primary">Enregistrer</button>
<small>Modifier une section déjà approuvée la repasse automatiquement « à relire ». Langues actives : ${LANGS.join(', ').toUpperCase()}.</small></form>
${meta ? metaConnectionCard(ed, meta) : ''}
<div class="card"><h2>Gérer ce projet</h2><form method="post" action="/edition/${ed.id}/rename" class="inline"><input name="label" value="${esc(ed.label)}" required><button>Renommer</button></form>
<form method="post" action="/edition/${ed.id}/archive" class="inline"><button class="link">Archiver</button></form> · <a class="danger" href="/edition/${ed.id}/delete">Supprimer…</a></div>
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
import { ROLES, POSTER_FORMATS, FITS } from './studio.js';
import { POSTER_ELEMENTS, elementsFor, FONTS } from './render.js';
import { CHANNELS, channelsOf } from './formats.js';

// Navigation d'un projet : cinq destinations, dans l'ordre du travail, et les paramètres à part (secondaires).
// `active` est la clé de la page courante ; chaque destination regroupe plusieurs pages qui servent le même travail.
const SECTIONS_NAV = [
  ['accueil', 'Accueil', (id) => `/edition/${id}`, ['accueil', 'calendrier']],
  ['contenus', 'Contenus', (id) => `/edition/${id}/variants`, ['variantes', 'affiches', 'videos', 'contenus']],
  ['campagnes', 'Campagnes', (id) => `/edition/${id}/campaigns`, ['campagnes']],
  ['biblio', 'Bibliothèque', (id) => `/edition/${id}/assets`, ['assets', 'designs']],
  ['site', 'Site web', (id) => `/edition/${id}/site`, ['site']],
];
const SUBTABS = {
  accueil: (id) => [['accueil', 'Tableau de travail', `/edition/${id}`], ['calendrier', 'Calendrier', `/edition/${id}/calendar`]],
  contenus: (id) => [['variantes', 'Affiches et vidéos', `/edition/${id}/variants`], ['contenus', 'Textes et fichiers prêts', `/edition/${id}/contents`], ['calendrier-lien', 'Calendrier', `/edition/${id}/calendar`]],
  biblio: (id) => [['assets', 'Fichiers sources', `/edition/${id}/assets`], ['designs', 'Designs et modèles', `/edition/${id}/designs`]],
};
export const tabs = (ed, active) => {
  const sec = SECTIONS_NAV.find((x) => x[3].includes(active));
  const params = active === 'fiche' || active === 'parametres';
  const sub = sec && SUBTABS[sec[0]] ? SUBTABS[sec[0]](ed.id) : null;
  const subActive = sub && (sub.find(([k]) => k === active) || (sec[0] === 'contenus' ? sub[0] : null));
  return `<h1>${esc(ed.label)} <small class="crumb">projet</small></h1>
<div class="pnav"><div class="pnav-main">${SECTIONS_NAV.map(([k, n, href]) => `<a href="${href(ed.id)}"${sec && sec[0] === k ? ' class="on" aria-current="page"' : ''}>${n}</a>`).join('')}</div>
<a href="/edition/${ed.id}/settings" class="pnav-set${params ? ' on' : ''}">Paramètres du projet</a></div>
${sub ? `<div class="subtabs">${sub.map(([k, n, href]) => `<a href="${href}"${subActive && subActive[0] === k ? ' class="on"' : ''}>${n}</a>`).join('')}</div>` : ''}`;
};

// Sélecteur de point de départ : Atelier (fiche) · SVG/image · Document · Autre. Un seul champ fichier, adapté au mode choisi.
export const MODES = {
  tool: { label: 'Atelier', help: 'On compose avec la fiche du spectacle : rien à envoyer.' },
  svg: { label: 'SVG / image', help: 'Affiche déjà faite : SVG de préférence (un .ai s’exporte en SVG : Illustrator › Fichier › Exporter › Exporter sous… › SVG), ou PNG / JPG / WebP. Elle devient l’affiche de tous les formats.', accept: '.svg,.png,.jpg,.jpeg,.webp,.gif,image/*', use: 'poster', role: 'poster', go: 'Importer l’affiche' },
  doc: { label: 'Document', help: 'Concept, script, brief : Word (.docx), OpenDocument (.odt), .txt, .md. Un PDF ou PowerPoint est joint (texte à recopier). Il devient un contenu texte.', accept: '.docx,.odt,.doc,.rtf,.txt,.md,.pdf,.pptx,.xlsx', use: 'content', role: 'brief', go: 'Importer le document' },
  other: { label: 'Autre', help: 'Tout autre fichier (photo, vidéo, audio, source…) : il est rangé dans les Assets, vous choisissez ensuite quoi en faire.', accept: '', use: '', role: 'other', go: 'Envoyer le fichier' },
};
export const entryCards = (ed, start = 'svg') => {
  const first = MODES[start] ? start : 'svg';
  return `<form class="card upx" data-edition="${ed.id}" data-modes="${esc(JSON.stringify(MODES))}"><h3>Par quoi commencer ?</h3>
<div class="seg">${Object.entries(MODES).map(([k, m]) => `<label><input type="radio" name="mode" value="${k}"${k === first ? ' checked' : ''}> ${esc(m.label)}</label>`).join('')}</div>
<small class="modehelp"></small>
<div class="inline modetool" hidden><a class="btn" href="/edition/${ed.id}/settings">Infos du spectacle</a> <a class="btn" href="/edition/${ed.id}/poster/4x5">Éditeur d’affiche</a> <a class="btn" href="/edition/${ed.id}/variants/new">Créer un contenu</a></div>
<div class="inline modefile"><input type="file" required><button class="primary"></button></div><p class="upmsg"></p></form>`;
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
<a class="btn sm" href="/edition/${ed.id}/variants/new?asset=${a.id}" title="Crée un contenu qui utilise déjà ce fichier">Créer un contenu avec ce fichier</a> <button>Enregistrer</button>${a.kind === 'image' && ['poster', 'other'].includes(a.role) ? ` <button formaction="/assets/${a.id}/use-poster" title="Remplace l’affiche de chaque format par ce fichier">Utiliser comme affiche reçue</button>` : ''}${['document', 'text', 'source'].includes(a.kind) ? ` <button formaction="/assets/${a.id}/to-content" title="Crée un contenu texte dans la bibliothèque">Créer un contenu texte</button>` : ''}</div></form>`).join('');
  return `${tabs(ed, 'assets')}${msg ? `<p class="flash">${esc(msg)}</p>` : ''}
${entryCards(ed)}
<div class="card"><h2>Ajouter un fichier</h2>
<form id="up" data-edition="${ed.id}" class="inline"><input type="file" id="upfile" required>
<select id="uprole">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><button>Envoyer</button></form>
<small>Photos (JPG, PNG, WebP, GIF), vidéos (MP4, MOV, WebM), audio (MP3, WAV, M4A), sous-titres (SRT, VTT) et fichiers sources du graphiste (PSD, AI, PDF, ZIP, FIG), SVG, documents Word / OpenDocument / Markdown. Stockage actuel : ${esc(storageInfo)}.
Une affiche déjà faite ne permet pas de déplacer ses éléments : importez-la avec « J’ai reçu une affiche » (cadrage et formats seulement) ; pour tout recomposer, demandez les fichiers sources.</small><p id="upmsg"></p></div>
${rows || '<p>Aucun fichier pour l’instant. Tant qu’aucune photo n’est ajoutée, les affiches et le site utilisent une image « PLACEHOLDER ».</p>'}`;
}

// En-tête de l'espace de travail d'un contenu : le même sur chaque étape et dans chaque éditeur.
// Matériel → Création → Vérification et exports → Diffusion ; on peut revenir à n'importe quelle étape.
const wsChip = (st) => `<span class="tag ${st === 'approuvé' ? 'st-2' : st === 'à relire' ? 'warn' : ''}">${esc(st)}</span>`;
export function workspaceHeader(ed, w) {
  return `<div class="ws"><div class="ws-top"><a href="${w.backHref}">← Contenus</a> <b>${esc(w.name)}</b> <span class="tag">${esc(w.type)}</span> ${wsChip(w.status)}${w.version ? ` <span class="tag">version ${w.version} approuvée</span>` : ''}</div>
<ol class="steps">${w.steps.map((st, i) => `<li class="${st.done ? 'done' : ''}${st.key === w.step ? ' here' : ''}"><a href="${w.base}?step=${st.key}"><b>${st.done ? '✓' : i + 1}</b><span>${esc(st.label)}${st.note ? `<small>${esc(st.note)}</small>` : ''}</span></a></li>`).join('')}</ol>
${w.note ? `<small class="ws-note">${esc(w.note)}</small>` : ''}</div>`;
}

// Panneau d'une affiche reçue : seuls le cadrage et l'ajustement au format ont un sens, les textes sont dans l'image.
function importedPanel(ed, design, assets, variant, extra) {
  const a = assets.find((x) => String(x.id) === String(design.ext));
  const range = (k, label, lo, hi) => `<label>${label}<span class="rng"><input type="range" name="${k}" min="${lo}" max="${hi}" value="${design[k]}"></span></label>`;
  const others = assets.filter((x) => x.kind === 'image' && x.role === 'poster' && String(x.id) !== String(design.ext));
  return `<div class="elpanel"><h2>Affiche reçue</h2>
<p class="status ok"><b>${a ? esc(a.name) : 'Fichier introuvable'}</b> — l’image est l’affiche entière : ses textes, son logo et sa photo ne se modifient pas ici. Pour changer un texte, corrigez le fichier d’origine puis importez-le à nouveau.${a ? ` <a href="/files/${a.id}" target="_blank">Ouvrir le fichier</a>` : ''}</p>
${(extra.warnings || []).map((w) => `<p class="status warn">${esc(w)}</p>`).join('')}
<label>Ajustement à ce format<select name="fit">${Object.entries(FITS).map(([k, n]) => `<option value="${k}"${k === (design.fit || 'blur') ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
<small>« Entière » garde tout le texte de l’affiche et complète les bords ; « Remplir » recadre (utile si les proportions sont presque les mêmes). Glissez dans l’aperçu pour déplacer, molette pour zoomer.</small>
<label>Couleur de fond (« Entière sur fond uni »)<input type="color" name="bgc" value="${esc(design.bgc || '#000000')}"></label>
${range('posx', 'Cadrage horizontal', 0, 100)}${range('posy', 'Cadrage vertical', 0, 100)}${range('zoom', 'Zoom', 100, 250)}
${variant ? '' : `<div class="inline">${others.length ? `<select name="asset" form="swapform">${others.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button form="swapform">Utiliser cette autre affiche</button>` : ''}<button form="rmform" class="link">Revenir aux affiches de l’atelier</button></div>`}</div>`;
}

const fontOpts = (cur, fiche) => `<option value="">Police de la fiche${fiche ? ` (${esc(fiche)})` : ''}</option>${Object.keys(FONTS).map((n) => `<option value="${esc(n)}"${n === cur ? ' selected' : ''} style="font-family:'${esc(n)}'">${esc(n)}</option>`).join('')}`;

export function posterPage(ed, fmt, design, assets, exports, msg, blockers, history = [], variant = null, extra = {}) {
  const vq = variant ? `variant=${variant.id}` : '', qs = vq ? `?${vq}` : '', qa = vq ? `&${vq}` : '';
  const imgs = assets.filter((a) => a.kind === 'image');
  const opt = (list, cur) => `<option value="">— aucune —</option>${list.map((a) => `<option value="${a.id}"${String(a.id) === String(cur) ? ' selected' : ''}>${esc(a.name)}${a.provisional ? ' (provisoire)' : ''}</option>`).join('')}`;
  // curseur + champ numérique (ajouté par app.js) pour saisir la valeur exacte
  const range = (k, label, lo, hi) => `<label>${label}<span class="rng"><input type="range" name="${k}" min="${lo}" max="${hi}" value="${design[k]}"></span></label>`;
  const f = POSTER_FORMATS[fmt];
  return `<span id="lockpage"></span>${tabs(ed, variant ? 'variantes' : 'affiches')}${msg ? `<p class="flash">${esc(msg)}</p>` : ''}
${variant ? workspaceHeader(ed, { name: variant.name, type: extra.ws?.type || 'Affiche', status: variant.status, version: variant.approved_version, base: `/edition/${ed.id}/variants/${variant.id}`, backHref: `/edition/${ed.id}/variants`, steps: extra.ws?.steps || [], step: 'creation', note: 'Ici « Exporter » produit un essai ; l’export officiel se fait à l’étape Vérification et exports.' }) : ''}
${design.ext || variant ? '' : entryCards(ed, 'svg')}
<div class="tabs sub">${Object.entries(POSTER_FORMATS).filter(([k]) => !variant || variant.formats.includes(k)).map(([k, v]) => `<a href="/edition/${ed.id}/poster/${k}${qs}"${k === fmt ? ' class="on"' : ''}>${v.label}</a>`).join('')}<button type="button" id="bigtoggle" class="link bigtoggle" title="Masque le menu du haut pour donner toute la hauteur à l’affiche">Agrandir l’aperçu</button></div>
<p class="fmtnote"><b>${esc(f.ratio)} · ${f.w}×${f.h}</b> — utilisé pour : ${esc(channelsOf(fmt).join(', ') || '—')}. Zones de sécurité (haut / bas) : ${f.safe.top} / ${f.safe.bottom} px. <small>Tailles courantes recommandées par les plateformes : à re-vérifier avant campagne.</small></p>
<div class="studio"><div class="stack"><form id="pform" method="post" action="/edition/${ed.id}/poster/${fmt}/save${qs}" class="card" data-variant="${variant ? variant.id : ''}" data-edition="${ed.id}" data-fmt="${fmt}" data-w="${f.w}" data-h="${f.h}" data-elements="${esc(JSON.stringify(elementsFor(design.style, f.layout).map((k) => [k, POSTER_ELEMENTS[k]])))}">
<input type="hidden" name="els" value="${esc(JSON.stringify(design.els || {}))}">${design.ext ? `<input type="hidden" name="ext" value="${esc(design.ext)}">` : ''}
<div class="actions"><button class="primary">Enregistrer</button><button formaction="/edition/${ed.id}/poster/${fmt}/export${qs}">${variant ? 'Export d’essai (PNG)' : 'Exporter en PNG'}</button></div>
${design.ext ? '' : `<button formaction="/edition/${ed.id}/poster/${fmt}/sync${qs}" title="Enregistre ce format puis reporte photo, logo, style, dégradé, polices, couleurs et textes sur les autres formats. Les positions de chaque format sont conservées.">Uniformiser : appliquer aux autres formats</button>`}
<div class="inline"><a href="/edition/${ed.id}/poster/${fmt}/svg${qs}">${design.ext ? 'Fichier d’origine (SVG)' : 'SVG (Illustrator)'}</a> · ${design.ext ? '' : `<a href="/edition/${ed.id}/poster/${fmt}/pdf${qs}">PDF vectoriel</a>`}${variant || design.ext ? '' : ` · <a href="/edition/${ed.id}/designs">Enregistrer dans la bibliothèque de designs</a>`}</div>
<small>Titre, dates, lieu et couleurs viennent des <a href="/edition/${ed.id}/settings">infos du spectacle</a>. ${blockers ? 'L’export sera marqué BROUILLON tant que la fiche n’est pas prête.' : ''}</small>
${design.ext ? importedPanel(ed, design, assets, variant, extra) + '<div hidden>' : ''}<div class="elpanel"><h2>Éléments de l’affiche</h2>
<small>Sur l’aperçu : <b>clic</b> pour sélectionner, <b>glisser</b> pour déplacer, <b>poignée</b> bleue pour la taille, <b>double-clic</b> pour modifier le texte, <b>flèches</b> pour ajuster (Maj = plus vite), <b>Suppr</b> pour masquer. Glisser dans le vide recadre la photo, la molette la zoome.</small>
<ul id="ellist" class="ellist"></ul>
<div id="elsel" hidden><h3 id="elname"></h3>
<label>Position X (px depuis la gauche, centre de l’élément)<span class="rng"><input type="range" id="el_dx" min="0" max="${f.w}" value="0"></span></label>
<label>Position Y (px depuis le haut, centre de l’élément)<span class="rng"><input type="range" id="el_dy" min="0" max="${f.h}" value="0"></span></label>
<span class="inline"><button type="button" id="el_cx" class="link">Centrer horizontalement</button><button type="button" id="el_cy" class="link">Centrer verticalement</button></span>
<label>Taille (%)<span class="rng"><input type="range" id="el_s" min="20" max="400" value="100"></span></label>
<label id="el_alignl">Alignement du texte<select id="el_align"><option value="">Par défaut</option><option value="left">À gauche</option><option value="center">Centré</option><option value="right">À droite</option></select></label>
<label>Couleur<span class="inline"><input type="color" id="el_color" value="#ffffff"><button type="button" id="el_color_reset" class="link">Couleur d’origine</button></span></label>
<label>Texte (cette affiche seulement)<textarea id="el_text" rows="2"></textarea><small>Vide = texte de la fiche. La fiche n’est pas modifiée.</small></label>
<span class="inline"><button type="button" id="el_text_reset" class="link">Texte de la fiche</button><button type="button" id="el_reset" class="link">Réinitialiser l’élément</button><button type="button" id="el_hide" class="link">Masquer</button></span></div>
<button type="button" id="el_all_reset" class="link">Tout remettre à zéro</button></div>
<label>Photo de fond<select name="hero">${opt(imgs.filter((a) => a.role !== 'logo'), design.hero)}</select></label>
<label>Logo<select name="logo">${opt(imgs.filter((a) => a.role === 'logo'), design.logo)}</select></label>
${range('gradient', 'Intensité du dégradé', 0, 100)}${design.ext ? '' : `${range('posx', 'Cadrage horizontal de la photo', 0, 100)}${range('posy', 'Cadrage vertical de la photo', 0, 100)}
${range('zoom', 'Zoom de la photo', 100, 250)}`}
<label>Composition<select name="style">${[['classique', 'Classique (texte sur photo)'], ['bandeau', 'Bandeau (titre incliné)']].map(([k, n]) => `<option value="${k}"${k === design.style ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
<label class="check"><input type="checkbox" name="partners" value="1"${design.partners === '1' ? ' checked' : ''}> Afficher les logos partenaires (assets « Logo partenaire »)</label>
${design.ext ? '' : `<label>Police du titre<select name="ft">${fontOpts(design.ft, ed.data.font_title)}</select></label><label>Police du texte<select name="fb">${fontOpts(design.fb, ed.data.font_body)}</select></label>`}
<label>Position du texte<select name="text_pos">${['haut', 'milieu', 'bas'].map((p) => `<option${p === design.text_pos ? ' selected' : ''}>${p}</option>`).join('')}</select></label>${design.ext ? '</div>' : ''}
</form>${design.ext && !variant ? `<form id="swapform" method="post" action="/edition/${ed.id}/poster-import"></form><form id="rmform" method="post" action="/edition/${ed.id}/poster-import"><input type="hidden" name="remove" value="1"></form>` : ''}
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
  return `<span id="lockpage"></span>${tabs(ed, variant ? 'variantes' : 'videos')}${variant ? workspaceHeader(ed, { name: variant.name, type: c.ws?.type || 'Vidéo', status: variant.status, version: variant.approved_version, base: `/edition/${ed.id}/variants/${variant.id}`, backHref: `/edition/${ed.id}/variants`, steps: c.ws?.steps || [], step: 'creation', note: 'Ici « Lancer les exports » produit des essais ; l’export officiel se fait à l’étape Vérification et exports.' }) : ''}${msg ? `<p class="flash">${esc(msg)}</p>` : ''}
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
  const KINDS_L = { projet: 'Design du projet', modele: 'Modèle de contenu', kit: 'Kit graphique' };
  const card = (t) => `<div class="card dcard"><div class="dthumb">${versions[t.id][0]?.thumb ? `<img src="/library/thumb/${versions[t.id][0].id}" alt="">` : t.kind === 'kit' ? `<div class="swatches">${Object.entries(c.brands?.[t.id] || {}).filter(([k, v2]) => /^color_/.test(k) && /^#[0-9a-f]{6}$/i.test(v2)).map(([k, v2]) => `<i style="background:${v2}" title="${esc(v2)}"></i>`).join('')}</div>` : '<span>pas d’aperçu</span>'}</div>
<div class="dmeta"><h2>${esc(t.name)} <span class="tag">${esc(KINDS_L[t.kind] || 'Design du projet')}</span></h2><small>${t.versions} version(s) · modifié ${fr(t.updated)}${t.parent_id ? ' · copie d’un autre design' : ''}</small>
<ul class="log">${versions[t.id].map((v) => `<li><b>v${v.version}</b> <time>${fr(v.created)}</time> ${esc(v.created_by)}${v.note ? ' · ' + esc(v.note) : ''}
<span class="inline">${t.kind === 'kit' ? '' : `<a class="btn sm" href="/edition/${ed.id}/variants/new?design=${v.id}">Créer un contenu avec ${t.kind === 'modele' ? 'ce modèle' : 'ce design'}</a> `}<a href="/edition/${ed.id}/designs/apply/${v.id}">${t.kind === 'kit' ? 'Appliquer le kit au projet' : 'Appliquer à tout le projet'}</a>
<form method="post" action="/edition/${ed.id}/designs/bundle/${v.id}" class="inline"><button class="link">Créer l’archive (.zip)</button></form></span></li>`).join('')}</ul>
<form method="post" action="/edition/${ed.id}/designs/duplicate/${t.id}" class="inline"><input name="name" placeholder="Nom de la copie (ex. « ${esc(t.name)} — test »)"><button>Dupliquer</button></form></div></div>`;
  return `${tabs(ed, 'designs')}${msg ? `<p class="flash">${esc(msg)}</p>` : ''}
<div class="card"><h2>Enregistrer dans la bibliothèque</h2>
<div class="two"><div><h3>Kit graphique du projet</h3><small>La charte (couleurs, polices), le logo et les styles communs (dégradé, composition, position du texte, partenaires), plus le style vidéo. Aucun contenu particulier.</small>
<form method="post" action="/edition/${ed.id}/designs/save-kit" class="grid"><label>Nom<input name="name" placeholder="Ex. Kit Night Show 2027"></label>
<label>Ajouter à un kit existant<select name="templateId"><option value="">— nouveau kit —</option>${templates.filter((t) => t.kind === 'kit').map((t) => `<option value="${t.id}">${esc(t.name)} (v${t.last_version})</option>`).join('')}</select></label>
<label>Note de version<input name="note"></label><div><button class="primary">Enregistrer le kit graphique</button></div></form></div>
<div><h3>Modèle de contenu</h3><p>Il s’enregistre <b>depuis un contenu</b> : ouvrez-le, étape « Création », puis « Enregistrer comme modèle ». Il garde sa composition, ses éléments modifiables et ses déclinaisons ; vous le retrouvez ensuite dans « Créer un contenu ».</p><a class="btn sm" href="/edition/${ed.id}/variants">Ouvrir mes contenus</a></div></div>
<p><small>Un modèle ou un kit s’utilise sans jamais être modifié : « Créer un contenu avec ce modèle » ou « Dupliquer » puis remplacez les fichiers et les informations.</small></p></div>
<details class="card"><summary><b>Enregistrer tout le travail graphique du projet</b> <small>(design complet, ancien mode)</small></summary>
<div class="card" style="border:0;padding:0;margin:12px 0 0"><h2>Design complet du projet</h2>
<p>Conserve <b>tout le travail graphique actuel</b> de « ${esc(ed.label)} » : composition de chaque format, éléments séparés (position, taille, couleur, texte), images et logos utilisés (copies conservées avec le design), charte et style vidéo. Le résultat reste <b>modifiable</b> : ce n’est pas une image aplatie.</p>
<form method="post" action="/edition/${ed.id}/designs/save" class="grid">
<label>Ajouter à un design existant (nouvelle version)<select name="templateId"><option value="">— nouveau design —</option>${templates.map((t) => `<option value="${t.id}">${esc(t.name)} (v${t.last_version})</option>`).join('')}</select></label>
<label>Nom (nouveau design)<input name="name" placeholder="Ex. Night show — direction artistique 2027"></label>
<label>Note de version<input name="note" placeholder="Ce qui a changé, pour s’en souvenir plus tard"></label>
<div><button class="primary">Enregistrer dans la bibliothèque</button></div></form>
<small>Format .ai d’Illustrator : non produit (format propriétaire). Chaque design s’exporte en <b>SVG</b> (un calque par élément, texte modifiable) et <b>PDF vectoriel</b>, inclus dans l’archive .zip.</small></div></div></details>
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
${t.kind === 'kit' ? '<p>Ce <b>kit graphique</b> reprend la charte, le logo et les styles communs (dégradé, composition, position du texte, partenaires). Vos photos et vos textes ne sont pas touchés.</p>' : ''}<p>La <b>composition</b> de chaque format est reprise (positions, tailles, couleurs, styles). Vous choisissez ci-dessous les <b>assets</b> qui remplacent ceux du design. Les <b>informations</b> (titre, dates, lieu, textes) restent celles de ce projet.</p>
<p class="status warn">Les réglages actuels des affiches de ce projet sont remplacés, mais l’historique les conserve : vous pourrez revenir en arrière depuis l’onglet Affiches.</p>
<form method="post" action="/edition/${ed.id}/designs/apply/${v.id}">${rows}
<div class="card"><h2>Options</h2>
<label class="check"><input type="checkbox" name="brand" value="1"${t.kind === 'kit' ? ' checked' : ''}> Reprendre aussi la charte du design (couleurs et polices) <small>— la section « Charte graphique » du projet repassera « à relire »</small></label>
<label class="check"><input type="checkbox" name="texts" value="1"> Conserver les textes modifiés à la main sur les affiches du design <small>— sinon les textes viennent de la fiche du projet</small></label>
<label class="check"><input type="checkbox" name="video" value="1" checked> Reprendre le style vidéo (logo, écran de fin, sous-titres)</label></div>
<button class="primary">Appliquer ce design</button> <a href="/edition/${ed.id}/designs">Annuler</a></form>`;
}

