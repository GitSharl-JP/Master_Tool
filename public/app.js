// Envoi de fichiers et studio d'affiche (panneau d'éléments + aperçu éditable).
const $ = (id) => document.getElementById(id);

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

const up = $('up');
if (up) {
  up.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = $('upfile').files[0];
    const msg = $('upmsg');
    if (!f) return;
    msg.textContent = `Envoi de ${f.name}…`;
    const q = new URLSearchParams({ edition: up.dataset.edition, role: $('uprole').value, name: f.name });
    try {
      const r = await fetch('/assets/upload?' + q, { method: 'POST', body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Échec');
      location.href = `/edition/${up.dataset.edition}/assets?m=` + encodeURIComponent('Fichier ajouté.');
    } catch (err) { msg.textContent = 'Erreur : ' + err.message; }
  });
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.querySelector('input[type=file]').files[0], msg = form.parentElement.querySelector('.upmsg') || form.nextElementSibling, what = form.elements.what.value;
    if (!f) return;
    msg.textContent = `Envoi de ${f.name}…`;
    const role = { hero: 'hero', logo: 'logo', poster: 'poster', video: 'video', doc: 'brief' }[what] || 'other';
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
  let cur = null, present = null; // present : éléments réellement dessinés sur l'aperçu (null tant qu'il n'est pas chargé)
  const orig = {}; // texte d'origine de chaque élément (pour ne pas enregistrer un texte inchangé)

  const save = () => { elsInput.value = JSON.stringify(els); };
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
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, className: 'link' + (id === cur ? ' on' : '') });
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
    if (!e.text) delete e.text;
    if (Object.keys(e).length) els[id] = e; else delete els[id];
  }

  // --- panneau de l'élément sélectionné
  const panel = $('elsel');
  const f = { dx: $('el_dx'), dy: $('el_dy'), s: $('el_s'), color: $('el_color'), text: $('el_text') };
  function showPanel(id, v) {
    cur = id;
    if (!id) { panel.hidden = true; renderList(); return; }
    panel.hidden = false;
    $('elname').textContent = labels[id] || id;
    const e = els[id] || {};
    setV(f.dx, v.dx ?? e.dx ?? 0); setV(f.dy, v.dy ?? e.dy ?? 0); setV(f.s, v.s ?? e.s ?? 100);
    f.color.value = e.color || '#ffffff';
    f.text.value = e.text || '';
    f.text.placeholder = orig[id] ?? '';
    renderList();
  }
  for (const k of ['dx', 'dy', 's']) {
    f[k].addEventListener('input', () => {
      if (!cur) return;
      const v = { dx: Number(f.dx.value), dy: Number(f.dy.value), s: Number(f.s.value) };
      setEl(cur, v); save(); post({ type: 'apply', id: cur, ...v });
    });
  }
  f.color.addEventListener('input', () => { if (!cur) return; setEl(cur, { color: f.color.value }); save(); post({ type: 'apply', id: cur, dx: Number(f.dx.value), dy: Number(f.dy.value), s: Number(f.s.value), color: f.color.value }); renderList(); });
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
    }
  });

  // --- réglages généraux (dégradé, photo, style…) : on recharge l'aperçu en gardant les éléments
  pform.addEventListener('input', (e) => {
    if (!e.target.name) return;
    if (e.target.name === 'gradient' || e.target.name === 'posx' || e.target.name === 'posy' || e.target.name === 'zoom') { post({ type: 'bg', posx: Number(pform.elements.posx.value), posy: Number(pform.elements.posy.value), zoom: Number(pform.elements.zoom.value) }); }
    clearTimeout(pform._t); pform._t = setTimeout(reload, e.target.type === 'range' ? 250 : 0);
  });
  frame.addEventListener('load', () => { cur = null; panel.hidden = true; renderList(); fit(); });
  window.addEventListener('resize', fit);
  save(); renderList(); reload(); fit();
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
