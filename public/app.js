// Envoi de fichiers et studio d'affiche (panneau d'éléments + aperçu éditable).
const $ = (id) => document.getElementById(id);

// Garde de travail (affiche, vidéo) : état visible, vérification qu'un autre onglet n'a pas modifié le même travail, et aucune navigation
// qui perdrait des modifications sans le dire. Un brouillon n'est JAMAIS approuvé ni publié par cette garde : elle ne fait qu'enregistrer.
window.AtelierGuard = (() => {
  const TEXT = { clean: 'Enregistré', dirty: 'Modifications non enregistrées', saving: 'Enregistrement…', error: 'Échec de l’enregistrement' };
  function dialog(title, text, buttons) {
    return new Promise((resolve) => {
      const back = Object.assign(document.createElement('div'), { className: 'guardback' });
      const box = Object.assign(document.createElement('div'), { className: 'guardbox' });
      box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
      box.append(Object.assign(document.createElement('h3'), { textContent: title }), Object.assign(document.createElement('p'), { textContent: text }));
      const row = Object.assign(document.createElement('div'), { className: 'guardbtns' });
      const done = (v) => { back.remove(); document.removeEventListener('keydown', esc, true); resolve(v); };
      const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(buttons[buttons.length - 1].value); } };
      for (const b of buttons) { const el = Object.assign(document.createElement('button'), { type: 'button', textContent: b.label, className: b.primary ? 'primary' : '' }); el.addEventListener('click', () => done(b.value)); row.append(el); }
      box.append(row); back.append(box); document.body.append(back); document.addEventListener('keydown', esc, true);
      row.querySelector('.primary, button').focus();
    });
  }
  function install({ form, isDirty, markClean, label }) {
    let state = 'clean', leaving = false, passthrough = false;
    const show = (s) => { state = s; if (!label) return; label.hidden = false; label.textContent = TEXT[s]; label.dataset.state = s; label.className = 'savestate ' + s; };
    const refresh = () => { if (state !== 'saving' && !(state === 'error' && isDirty())) show(isDirty() ? 'dirty' : 'clean'); };
    const send = async (check) => {
      try {
        const r = await fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch', ...(check ? { 'X-Check': '1' } : {}) }, body: new URLSearchParams(new FormData(form)) });
        const j = await r.json().catch(() => ({}));
        return r.ok ? j : { ...j, ok: false, status: r.status };
      } catch { return { ok: false, network: true }; }
    };
    // false = l'utilisateur renonce ou la sauvegarde a échoué (son travail reste à l'écran)
    const settle = async (check) => {
      show('saving');
      for (;;) {
        const r = await send(check);
        if (r.ok) { if (form.elements.rev && r.rev !== undefined) form.elements.rev.value = r.rev; if (!check) markClean(); show(isDirty() ? 'dirty' : 'clean'); return true; }
        if (r.conflict) {
          const c = await dialog('Ce travail a été modifié ailleurs', 'Un autre onglet ou une autre personne l’a enregistré depuis que vous l’avez ouvert. Écraser avec votre version, ou rester ici pour copier vos changements avant de recharger ?', [{ label: 'Écraser avec ma version', value: 'over', primary: true }, { label: 'Rester', value: 'stay' }]);
          if (c !== 'over') { show('dirty'); return false; }
          form.elements.rev.value = r.rev; continue;
        }
        show('error');
        const c = await dialog('Enregistrement impossible', r.network ? 'Le serveur ne répond pas. Vos modifications sont toujours à l’écran : rien n’est perdu tant que vous restez sur cette page.' : 'Le serveur a refusé l’enregistrement. Vos modifications sont toujours à l’écran.', [{ label: 'Réessayer', value: 'retry', primary: true }, { label: 'Rester', value: 'stay' }]);
        if (c !== 'retry') return false;
        show('saving');
      }
    };
    form.addEventListener('submit', async (e) => {
      if (passthrough) { passthrough = false; leaving = true; return; }
      e.preventDefault();
      const sub = e.submitter;
      if (!(await settle(true))) return;
      passthrough = true; form.requestSubmit(sub || undefined);
    });
    document.addEventListener('click', async (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || !isDirty() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank' || a.hasAttribute('download')) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search && u.hash)) return;
      e.preventDefault();
      const c = await dialog('Modifications non enregistrées', 'Vous avez changé des réglages qui ne sont pas encore enregistrés.', [{ label: 'Enregistrer', value: 'save', primary: true }, { label: 'Quitter sans enregistrer', value: 'drop' }, { label: 'Rester', value: 'stay' }]);
      if (c === 'drop') { markClean(); leaving = true; location.href = u.href; }
      else if (c === 'save' && (await settle(false))) { leaving = true; location.href = u.href; }
    }, true);
    window.addEventListener('beforeunload', (ev) => { if (isDirty() && !leaving) { ev.preventDefault(); ev.returnValue = ''; } });
    window.addEventListener('pageshow', () => { leaving = false; });
    show('clean');
    return { refresh, show, settle, state: () => state };
  }
  return { install, dialog };
})();

// Chaque curseur reçoit un champ numérique : on peut glisser OU taper la valeur exacte.
function enhance(range) {
  const num = Object.assign(document.createElement('input'), { type: 'number', className: 'num', min: range.min, max: range.max, step: range.step || 1, value: range.value });
  range.after(num);
  range._num = num;
  range.addEventListener('input', () => { if (!range._typing) num.value = range.value; });
  num.addEventListener('input', () => {
    if (num.value === '' || num.value === '-') return;
    range._typing = true;
    range.value = Math.min(Number(range.max), Math.max(Number(range.min), Number(num.value)));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range._typing = false;
  });
  num.addEventListener('change', () => { num.value = range.value; }); // remet la valeur bornée à la sortie du champ
}
const setV = (range, v) => { range.value = v; if (range._num) range._num.value = range.value; };
document.querySelectorAll('.rng input[type=range]').forEach(enhance);

// Envoi d'un ou plusieurs fichiers, un envoi par fichier. Le type n'est pas demandé : le serveur le devine (il se corrige ensuite dans la liste).
async function sendFiles(files, { edition, variant, msg }) {
  const list = [...files], ok = [], bad = []; let last = null;
  for (const [i, f] of list.entries()) {
    msg.textContent = list.length > 1 ? `Envoi ${i + 1}/${list.length} : ${f.name}…` : `Envoi de ${f.name}…`;
    const q = new URLSearchParams({ edition, name: f.name });
    if (variant) { q.set('variant', variant); q.set('what', 'add'); }
    try {
      const r = await fetch('/assets/upload?' + q, { method: 'POST', body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Échec');
      ok.push(f.name); last = j;
    } catch (err) { bad.push(`${f.name} (${err.message})`); }
  }
  return { ok, bad, last };
}
// Zone de dépôt : on peut glisser des fichiers dessus (plusieurs à la fois) ; `onFiles` reçoit la liste.
function dropZone(zone, onFiles) {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { stop(e); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, (e) => { stop(e); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files); });
}
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

const up = $('up');
if (up) {
  const msg = $('upmsg'), input = $('upfile');
  const run = async (files) => {
    if (!files || !files.length) return;
    const { ok, bad } = await sendFiles(files, { edition: up.dataset.edition, msg });
    if (!ok.length) { msg.textContent = 'Erreur : ' + bad.join(' ; '); return; }
    location.href = `/edition/${up.dataset.edition}/assets?m=` + encodeURIComponent(`${plural(ok.length, 'fichier ajouté', 'fichiers ajoutés')}.${bad.length ? ' Refusé : ' + bad.join(' ; ') : ''}`);
  };
  up.addEventListener('submit', (e) => { e.preventDefault(); run(input.files); });
  input.addEventListener('change', () => run(input.files));
  dropZone(up, run);
}

// Sélecteur de point de départ (Atelier / SVG / Document / Autre) : envoi puis arrivée sur la page suivante du parcours.
document.querySelectorAll('form.upx').forEach((form) => {
  const modes = JSON.parse(form.dataset.modes), file = form.querySelector('input[type=file]'), btn = form.querySelector('.modefile button');
  const mode = () => modes[form.querySelector('input[name=mode]:checked').value];
  const sync = () => {
    const m = mode(), tool = !m.go;
    form.querySelector('.modehelp').textContent = m.help;
    form.querySelector('.modetool').hidden = !tool;
    form.querySelector('.modefile').hidden = tool;
    file.required = !tool; file.accept = m.accept || ''; file.value = ''; btn.textContent = m.go || '';
  };
  form.addEventListener('change', (e) => { if (e.target.name === 'mode') sync(); });
  sync();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = file.files[0], msg = form.querySelector('.upmsg'), m = mode();
    if (!f || !m.go) return;
    msg.textContent = `Envoi de ${f.name}…`;
    const q = new URLSearchParams({ edition: form.dataset.edition, role: m.role, name: f.name });
    if (m.use) q.set('use', m.use);
    try {
      const r = await fetch('/assets/upload?' + q, { method: 'POST', body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Échec');
      location.href = j.url || `/edition/${form.dataset.edition}/assets?m=` + encodeURIComponent('Fichier ajouté.');
    } catch (err) { msg.textContent = 'Erreur : ' + err.message; }
  });
});

// Matériel d'un contenu : le fichier est envoyé puis utilisé tout de suite dans ce contenu.
document.querySelectorAll('form.upm').forEach((form) => {
  const msg0 = form.parentElement.querySelector('.upmsg') || form.nextElementSibling;
  if (form.elements.what.value === 'add') { // ajout libre au matériel : plusieurs fichiers, glisser-déposer, type deviné
    const input = form.querySelector('input[type=file]');
    const run = async (files) => {
      if (!files || !files.length) return;
      const { ok, bad, last } = await sendFiles(files, { edition: form.dataset.edition, variant: form.dataset.variant, msg: msg0 });
      if (!ok.length) { msg0.textContent = 'Erreur : ' + bad.join(' ; '); return; }
      const base = `/edition/${form.dataset.edition}/variants/${form.dataset.variant}?step=materiel&m=`;
      location.href = ok.length === 1 && !bad.length && last?.url ? last.url
        : base + encodeURIComponent(`${plural(ok.length, 'fichier ajouté', 'fichiers ajoutés')} : choisissez ci-dessous où les utiliser (photo de fond, logo, affiche reçue).${bad.length ? ' Refusé : ' + bad.join(' ; ') : ''}`);
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); run(input.files); });
    input.addEventListener('change', () => run(input.files));
    dropZone(form, run);
    return;
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.querySelector('input[type=file]').files[0], msg = msg0, what = form.elements.what.value;
    if (!f) return;
    msg.textContent = `Envoi de ${f.name}…`;
    const role = { hero: 'hero', logo: 'logo', poster: 'poster', video: 'video', doc: 'brief' }[what] || (f.type.startsWith('video/') ? 'video' : 'other');
    const q = new URLSearchParams({ edition: form.dataset.edition, role, name: f.name, what });
    if (form.dataset.variant) q.set('variant', form.dataset.variant);
    if (form.dataset.text) q.set('text', form.dataset.text);
    try {
      const r = await fetch('/assets/upload?' + q, { method: 'POST', body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Échec');
      location.href = j.url || location.href;
    } catch (err) { msg.textContent = 'Erreur : ' + err.message; }
  });
});

const pform = $('pform');
if (pform) {
  const frame = $('pframe'), wrap = $('pwrap');
  const elsInput = pform.elements.els;
  const ids = JSON.parse(pform.dataset.elements); // [[id, libellé], ...]
  const labels = Object.fromEntries(ids);
  let els = {};
  try { els = JSON.parse(elsInput.value || '{}'); } catch { els = {}; }
  const PW = Number(pform.dataset.w), PH = Number(pform.dataset.h), nat = {}; // nat : centre d'origine de chaque élément dans la composition
  let cur = null, present = null; // present : éléments réellement dessinés sur l'aperçu (null tant qu'il n'est pas chargé)
  const orig = {}; // texte d'origine de chaque élément (pour ne pas enregistrer un texte inchangé)

  // état de sauvegarde : le formulaire (sans la révision) est comparé à son état enregistré
  const ser = () => JSON.stringify([...new FormData(pform)].filter(([k]) => k !== 'rev'));
  let snap = null, guard = null;
  const recheck = () => { clearTimeout(recheck.t); recheck.t = setTimeout(() => guard && snap !== null && guard.refresh(), 80); };
  const save = () => { elsInput.value = JSON.stringify(els); recheck(); };
  const query = () => { const p = new URLSearchParams(new FormData(pform)); p.set('edit', '1'); if (pform.dataset.variant) p.set('variant', pform.dataset.variant); return p; };
  const reload = () => { frame.src = `/render/poster/${pform.dataset.edition}/${pform.dataset.fmt}?` + query(); };
  const post = (m) => frame.contentWindow && frame.contentWindow.postMessage(m, location.origin);
  const fit = () => {
    const W = Number(pform.dataset.w), H = Number(pform.dataset.h);
    const locked = matchMedia('(min-width: 901px)').matches; // grand écran : l'aperçu est verrouillé, hauteur imposée par la page
    if (!locked) wrap.style.height = '';
    const k = Math.min(1, wrap.clientWidth / W, locked ? wrap.clientHeight / H : 1);
    frame.style.transform = `scale(${k})`;
    frame.style.left = Math.max(0, (wrap.clientWidth - W * k) / 2) + 'px';
    frame.style.top = locked ? Math.max(0, (wrap.clientHeight - H * k) / 2) + 'px' : '0px';
    if (!locked) wrap.style.height = H * k + 'px';
  };

  // --- liste des éléments
  const list = $('ellist');
  function renderList() {
    list.innerHTML = '';
    for (const [id, label] of ids) {
      const li = document.createElement('li');
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !els[id]?.hide, title: 'Afficher / masquer' });
      cb.addEventListener('change', () => { setEl(id, { hide: !cb.checked }); save(); reload(); });
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, className: 'elbtn' + (id === cur ? ' on' : ''), title: 'Sélectionner cet élément pour le régler' });
      b.addEventListener('click', () => { post({ type: 'select', id }); if (els[id]?.hide) showPanel(id, {}); });
      li.append(cb, b);
      if (present && !els[id]?.hide && !present.includes(id)) {
        const why = { host: 'rien à afficher : ajoutez l’adresse de réservation dans les infos du spectacle', partners: 'rien à afficher : importez des assets « Logo partenaire »', logo: 'rien à afficher : choisissez un logo ci-dessous', cta: 'non disponible dans cette composition' }[id] || 'absent de cette composition';
        cb.disabled = true; cb.checked = false; li.append(Object.assign(document.createElement('small'), { textContent: ' — ' + why }));
      }
      if (els[id] && Object.keys(els[id]).some((k) => k !== 'hide')) li.append(Object.assign(document.createElement('small'), { textContent: ' modifié' }));
      list.append(li);
    }
  }

  // --- état d'un élément (on ne garde que ce qui s'écarte des valeurs par défaut)
  function setEl(id, patch) {
    const e = { ...(els[id] || {}), ...patch };
    if (!e.dx) delete e.dx;
    if (!e.dy) delete e.dy;
    if (!e.s || e.s === 100) delete e.s;
    if (!e.hide) delete e.hide;
    if (!e.color) delete e.color;
    if (!e.align) delete e.align;
    if (!e.text) delete e.text;
    if (Object.keys(e).length) els[id] = e; else delete els[id];
  }

  // --- panneau de l'élément sélectionné
  const panel = $('elsel');
  const f = { dx: $('el_dx'), dy: $('el_dy'), s: $('el_s'), color: $('el_color'), text: $('el_text') };
  function showPanel(id, v) {
    cur = id;
    const hint = $('elhint'); if (hint) hint.hidden = !!id;
    if (!id) { panel.hidden = true; renderList(); return; }
    panel.hidden = false;
    $('elname').textContent = labels[id] || id;
    const e = els[id] || {};
    if (v.cx !== undefined) nat[id] = { cx: v.cx, cy: v.cy };
    const n = nat[id] || { cx: PW / 2, cy: PH / 2 };
    setV(f.dx, Math.round(n.cx + (v.dx ?? e.dx ?? 0))); setV(f.dy, Math.round(n.cy + (v.dy ?? e.dy ?? 0))); setV(f.s, v.s ?? e.s ?? 100);
    $('el_align').value = e.align || '';
    $('el_alignl').hidden = id === 'logo' || id === 'partners';
    f.color.value = e.color || '#ffffff';
    f.text.value = e.text || '';
    f.text.placeholder = orig[id] ?? '';
    renderList();
  }
  // le curseur affiche une position sur l'affiche ; on enregistre le décalage par rapport à la place d'origine
  const offsets = () => { const n = nat[cur] || { cx: PW / 2, cy: PH / 2 }; return { dx: Math.round(Number(f.dx.value) - n.cx), dy: Math.round(Number(f.dy.value) - n.cy), s: Number(f.s.value) }; };
  const center = (k, v) => { setV(f[k], v); f[k].dispatchEvent(new Event('input')); };
  $('el_cx').addEventListener('click', () => cur && center('dx', PW / 2));
  $('el_cy').addEventListener('click', () => cur && center('dy', PH / 2));
  $('el_align').addEventListener('change', () => { if (!cur) return; setEl(cur, { align: $('el_align').value }); save(); post({ type: 'apply', id: cur, ...offsets(), align: $('el_align').value }); renderList(); });
  for (const k of ['dx', 'dy', 's']) {
    f[k].addEventListener('input', () => {
      if (!cur) return;
      const v = offsets();
      setEl(cur, v); save(); post({ type: 'apply', id: cur, ...v });
    });
  }
  f.color.addEventListener('input', () => { if (!cur) return; setEl(cur, { color: f.color.value }); save(); post({ type: 'apply', id: cur, ...offsets(), color: f.color.value }); renderList(); });
  $('el_color_reset').addEventListener('click', () => { if (!cur) return; setEl(cur, { color: '' }); save(); reload(); });
  let tt;
  f.text.addEventListener('input', () => { if (!cur) return; setEl(cur, { text: f.text.value }); save(); clearTimeout(tt); tt = setTimeout(reload, 600); });
  $('el_text_reset').addEventListener('click', () => { if (!cur) return; setEl(cur, { text: '' }); f.text.value = ''; save(); reload(); });
  $('el_reset').addEventListener('click', () => { if (!cur) return; delete els[cur]; save(); reload(); showPanel(null); });
  $('el_hide').addEventListener('click', () => { if (!cur) return; setEl(cur, { hide: true }); save(); reload(); showPanel(null); });
  $('el_all_reset').addEventListener('click', () => { if (!confirm('Remettre tous les éléments à leur place d’origine ?')) return; els = {}; save(); reload(); showPanel(null); });

  // --- messages venant de l'aperçu
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.type === 'ready') { present = m.present || []; renderList(); }
    else if (m.type === 'select') {
      if (m.id && orig[m.id] === undefined) orig[m.id] = m.text;
      showPanel(m.id || null, m);
    } else if (m.type === 'els') {
      setEl(m.id, { dx: m.dx, dy: m.dy, s: m.s }); save();
      if (cur === m.id) showPanel(m.id, m); else renderList();
    } else if (m.type === 'text') {
      if (m.text === orig[m.id] || m.text === '') setEl(m.id, { text: '' }); else setEl(m.id, { text: m.text });
      save(); if (cur === m.id) showPanel(m.id, {}); else renderList();
    } else if (m.type === 'hide') {
      setEl(m.id, { hide: true }); save(); reload(); showPanel(null);
    } else if (m.type === 'bg') {
      for (const k of ['posx', 'posy', 'zoom']) {
        setV(pform.elements[k], Math.round(m[k]));
      }
      recheck();
    }
  });

  // --- réglages généraux (dégradé, photo, style…) : on recharge l'aperçu en gardant les éléments
  pform.addEventListener('input', (e) => {
    if (!e.target.name) return;
    if (e.target.name === 'gradient' || e.target.name === 'posx' || e.target.name === 'posy' || e.target.name === 'zoom') { post({ type: 'bg', posx: Number(pform.elements.posx.value), posy: Number(pform.elements.posy.value), zoom: Number(pform.elements.zoom.value) }); }
    clearTimeout(pform._t); pform._t = setTimeout(reload, e.target.type === 'range' ? 250 : 0);
  });
  // aperçu agrandi : le menu du haut est masqué pour donner toute la hauteur à l'affiche (choix mémorisé)
  const big = $('bigtoggle');
  const setBig = (on) => { document.body.classList.toggle('big', on); big.textContent = on ? 'Afficher le menu' : 'Agrandir l’aperçu'; try { localStorage.setItem('atelier.big', on ? '1' : '0'); } catch {} fit(); };
  big.addEventListener('click', () => setBig(!document.body.classList.contains('big')));
  let wantBig = true; try { wantBig = localStorage.getItem('atelier.big') !== '0'; } catch {}
  frame.addEventListener('load', () => { cur = null; panel.hidden = true; renderList(); fit(); });
  guard = AtelierGuard.install({ form: pform, label: $('savestate'), isDirty: () => snap !== null && ser() !== snap, markClean: () => { snap = ser(); } });
  frame.addEventListener('load', () => setTimeout(() => { if (snap === null) { snap = ser(); guard.refresh(); } }, 400), { once: true });
  for (const ev of ['input', 'change', 'click']) pform.addEventListener(ev, recheck);
  window.__poster = { dirty: () => snap !== null && ser() !== snap, state: () => guard.state() }; // lecture seule pour les tests
  window.addEventListener('resize', fit);
  save(); renderList(); reload(); setBig(wantBig);
}

// Import d'une archive de design (.zip)
const imp = $('importform');
if (imp) {
  imp.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = $('importfile').files[0], msg = $('importmsg');
    if (!f) return;
    msg.textContent = `Import de ${f.name}…`;
    try {
      const r = await fetch('/library/import?project=' + imp.dataset.edition, { method: 'POST', body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Échec');
      location.href = `/edition/${imp.dataset.edition}/designs?m=` + encodeURIComponent('Design importé. Vous pouvez l’appliquer à ce projet.');
    } catch (err) { msg.textContent = 'Erreur : ' + err.message; }
  });
}

// Assistant de variante : l'intention choisie propose une hypothèse et indique ce qui est requis.
const wiz = $('vform2');
if (wiz) {
  const hyp = $('hyp');
  const fill = () => {
    const r = wiz.querySelector('input[name=intent]:checked');
    if (!r) return;
    const needs = (r.dataset.needs || '').split(',').filter(Boolean);
    wiz.querySelectorAll('[data-need]').forEach((el) => {
      const need = needs.includes(el.dataset.need);
      el.textContent = need ? '(requis pour cette intention)' : '';
      el.closest('label').querySelector('input').required = need;
    });
    if (!hyp.dataset.touched) {
      const v = (n) => (wiz.elements[n].value || '…').trim();
      hyp.value = r.dataset.hyp.replace('{angle}', v('angle')).replace('{audience}', v('audience')).replace('{language}', v('language'));
    }
  };
  hyp.addEventListener('input', () => { hyp.dataset.touched = '1'; });
  wiz.addEventListener('change', fill);
  wiz.addEventListener('input', (e) => { if (['angle', 'audience', 'language'].includes(e.target.name)) fill(); });
  fill();
}

// --- Guide Ads Manager : boutons « Copier », compteurs de caractères, lecture d'un rapport .csv
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('button.copy');
  if (!b) return;
  const v = b.dataset.copy || '';
  try { await navigator.clipboard.writeText(v); }
  catch { const t = document.createElement('textarea'); t.value = v; document.body.append(t); t.select(); try { document.execCommand('copy'); } catch { /* copie impossible */ } t.remove(); }
  const old = b.textContent; b.textContent = 'Copié ✓'; b.classList.add('done'); setTimeout(() => { b.textContent = old; b.classList.remove('done'); }, 1500);
});
document.querySelectorAll('[data-count]').forEach((el) => {
  const out = el.parentElement.querySelector('.cnt'), max = Number(el.dataset.count);
  const upd = () => { if (out) { out.textContent = `${el.value.length} / ${max}`; out.style.color = el.value.length > max ? '#b3261e' : ''; } };
  el.addEventListener('input', upd); upd();
});
const csvfile = document.getElementById('csvfile');
if (csvfile) csvfile.addEventListener('change', async () => { const f = csvfile.files[0]; if (!f) return; csvfile.form.elements.csv.value = await f.text(); });

// Calendrier : au survol d'une tâche, une bulle avec ses détails et un aperçu du visuel (sans cliquer).
(() => {
  const items = document.querySelectorAll('table.cal [data-tip]');
  if (!items.length) return;
  const tip = Object.assign(document.createElement('div'), { id: 'caltip', hidden: true });
  document.body.append(tip);
  const row = (k, v) => (v ? `<div><span>${k}</span>${v}</div>` : '');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const show = (el) => {
    let d; try { d = JSON.parse(el.dataset.tip); } catch { return; }
    const media = d.thumb ? `<img src="${esc(d.thumb)}" alt="">` : d.live ? `<div class="live"><iframe src="${esc(d.live)}" title="Aperçu" loading="lazy"></iframe></div>` : '';
    tip.innerHTML = `${media}<div class="body"><b>${esc(d.title)}</b><small class="state s-${d.state === 'en retard' ? 'late' : d.state === 'fait' ? 'ok' : 'todo'}">${esc(d.kind)} · ${esc(d.state)}</small>${row('Quand', esc(d.when))}${row('Responsable', esc(d.owner))}${row('Contenu', esc(d.content))}${row('Campagne', esc(d.campaign))}${row('Note', esc(d.note))}${d.go ? `<em>${esc(d.go)}</em>` : ''}</div>`;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
    if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 8);
    tip.style.left = Math.min(Math.max(8, x), innerWidth - w - 8) + 'px';
    tip.style.top = y + 'px';
  };
  items.forEach((el) => {
    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('focus', () => show(el));
    el.addEventListener('mouseleave', () => { tip.hidden = true; });
    el.addEventListener('blur', () => { tip.hidden = true; });
  });
})();
