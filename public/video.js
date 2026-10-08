// Page vidéo : aperçu fidèle de ce qui sera exporté (même formule de cadrage que ffmpeg), sous-titres, suivi des exports.
(() => {
  const form = $('vform');
  if (!form) return;
  const d = JSON.parse(form.dataset.design);
  let cues = JSON.parse(form.dataset.cues);
  const info = JSON.parse(form.dataset.info);
  const FM = JSON.parse(form.dataset.formats);
  const draft = form.dataset.draft === '1';
  const edition = form.dataset.edition;
  const video = $('vplayer'), frame = $('vframe'), wrap = $('pwrap');
  let fmt = Object.keys(FM)[0];
  d.reframe = d.reframe || {};

  // Même formule que src/media.js (reframe) : l'aperçu et l'export donnent le même cadrage.
  const reframe = (sw, sh, W, H, r = {}) => {
    const z = (Number(r.zoom) || 100) / 100, s = Math.max(W / sw, H / sh) * z;
    const iw = Math.max(W, Math.round(sw * s)), ih = Math.max(H, Math.round(sh * s));
    return { iw, ih, x: Math.round((iw - W) * Number(r.posx ?? 50) / 100), y: Math.round((ih - H) * Number(r.posy ?? 50) / 100) };
  };
  const clipEnd = () => (d.end > d.start ? d.end : (info ? info.duration : 0));
  const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  // --- état -> champs cachés (envoyés à l'enregistrement)
  const sync = () => {
    form.elements.design.value = JSON.stringify(d);
    form.elements.cues.value = JSON.stringify(cues);
  };

  // --- aperçu
  function layout() {
    const f = FM[fmt];
    frame.style.width = f.w + 'px'; frame.style.height = f.h + 'px';
    if (info) {
      const b = reframe(info.w, info.h, f.w, f.h, d.reframe[fmt]);
      Object.assign(video.style, { width: b.iw + 'px', height: b.ih + 'px', left: -b.x + 'px', top: -b.y + 'px' });
    }
    const availW = wrap.clientWidth, availH = wrap.clientHeight - 56;
    const k = Math.min(1, availW / f.w, availH / f.h);
    frame.style.transform = `scale(${k})`;
    frame.style.left = Math.max(0, (availW - f.w * k) / 2) + 'px';
    frame.style.top = Math.max(0, (availH - f.h * k) / 2) + 'px';

    const logo = $('vlogo');
    if (d.logo.asset) {
      const lw = Math.round(f.w * d.logo.size / 100), m = Math.round(f.w * d.logo.margin / 100), c = d.logo.corner;
      logo.src = `/files/${d.logo.asset}`; logo.style.display = 'block'; logo.style.width = lw + 'px';
      logo.style.left = c.endsWith('l') ? m + 'px' : 'auto'; logo.style.right = c.endsWith('r') ? m + 'px' : 'auto';
      logo.style.top = c.startsWith('t') ? Math.max(m, f.safe.top) + 'px' : 'auto';
      logo.style.bottom = c.startsWith('b') ? Math.max(m, f.safe.bottom) + 'px' : 'auto';
    } else logo.style.display = 'none';

    const g = $('vguides');
    g.style.display = $('v_guides').checked ? 'block' : 'none';
    Object.assign(g.style, { top: f.safe.top + 'px', bottom: f.safe.bottom + 'px', left: f.safe.side + 'px', right: f.safe.side + 'px' });
    Object.assign($('vsub').style, { left: f.safe.side + 'px', right: f.safe.side + 'px', bottom: f.safe.bottom + Math.round(f.h * 0.02) + 'px', fontSize: Math.round(f.w * 0.045 * d.subs.size / 100) + 'px' });
    Object.assign($('vdraft').style, { display: draft ? 'block' : 'none', height: Math.round(f.h * 0.028) + 'px', fontSize: Math.round(f.h * 0.017) + 'px', lineHeight: Math.round(f.h * 0.028) + 'px' });
    updateSub();
  }
  function updateSub() {
    const t = video.currentTime, el = $('vsub');
    const c = d.subs.on ? cues.find((x) => t >= x.start && t < x.end) : null;
    el.textContent = c ? c.text : '';
    el.style.display = c ? 'block' : 'none';
  }

  // --- lecteur (limité à l'extrait)
  if (info && d.asset) video.src = `/files/${d.asset}#t=${d.start || 0.01}`;
  const pos = () => {
    const s = d.start, e = clipEnd();
    $('vscrub').value = e > s ? Math.round(1000 * Math.min(1, Math.max(0, (video.currentTime - s) / (e - s)))) : 0;
    $('vtime').textContent = `${fmtT(Math.max(0, video.currentTime - s))} / ${fmtT(Math.max(0, e - s))}`;
  };
  video.addEventListener('timeupdate', () => {
    if (video.currentTime >= clipEnd() && !video.paused) { video.pause(); video.currentTime = d.start; }
    pos(); updateSub();
  });
  video.addEventListener('pause', () => { $('vplay').textContent = '▶'; });
  video.addEventListener('play', () => { $('vplay').textContent = '❚❚'; });
  $('vplay').addEventListener('click', () => {
    if (video.paused) { if (video.currentTime < d.start || video.currentTime >= clipEnd()) video.currentTime = d.start; video.play(); } else video.pause();
  });
  $('vscrub').addEventListener('input', () => { video.currentTime = d.start + (clipEnd() - d.start) * Number($('vscrub').value) / 1000; });
  $('v_playclip').addEventListener('click', () => { video.currentTime = d.start; video.play(); });

  // --- source
  $('v_asset').addEventListener('change', () => { d.asset = $('v_asset').value; sync(); form.requestSubmit(); });

  // --- extrait
  const bindRange = (id, apply) => $(id).addEventListener('input', () => { apply(Number($(id).value)); sync(); layout(); });
  bindRange('v_start', (v) => { d.start = v; video.currentTime = v; });
  bindRange('v_end', (v) => { d.end = v; });
  $('v_setstart').addEventListener('click', () => { d.start = Math.round(video.currentTime * 10) / 10; setV($('v_start'), d.start); sync(); });
  $('v_setend').addEventListener('click', () => { d.end = Math.round(video.currentTime * 10) / 10; setV($('v_end'), d.end); sync(); });

  // --- cadrage par format
  const loadReframe = () => {
    const r = d.reframe[fmt] || {};
    setV($('v_posx'), r.posx ?? 50); setV($('v_posy'), r.posy ?? 50); setV($('v_zoom'), r.zoom ?? 100);
    document.querySelectorAll('#v_fmtTabs a').forEach((a) => a.classList.toggle('on', a.dataset.fmt === fmt));
  };
  document.querySelectorAll('#v_fmtTabs a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); fmt = a.dataset.fmt; loadReframe(); layout(); }));
  for (const [id, k] of [['v_posx', 'posx'], ['v_posy', 'posy'], ['v_zoom', 'zoom']]) {
    $(id).addEventListener('input', () => {
      d.reframe[fmt] = { posx: 50, posy: 50, zoom: 100, ...d.reframe[fmt], [k]: Number($(id).value) };
      sync(); layout();
    });
  }
  $('v_guides').addEventListener('change', layout);

  // --- logo, écran de fin, sous-titres
  $('v_logo').addEventListener('change', () => { d.logo.asset = $('v_logo').value; sync(); layout(); });
  $('v_corner').addEventListener('change', () => { d.logo.corner = $('v_corner').value; sync(); layout(); });
  bindRange('v_lsize', (v) => { d.logo.size = v; });
  bindRange('v_lmargin', (v) => { d.logo.margin = v; });
  $('v_end').addEventListener('change', () => { d.endcard.on = $('v_end').checked; sync(); });
  bindRange('v_endsec', (v) => { d.endcard.seconds = v; });
  $('v_subs').addEventListener('change', () => { d.subs.on = $('v_subs').checked; sync(); layout(); });
  bindRange('v_ssize', (v) => { d.subs.size = v; });
  document.querySelectorAll('.v_fmtchk').forEach((c) => c.addEventListener('change', () => {
    d.formats = [...document.querySelectorAll('.v_fmtchk:checked')].map((x) => x.value); sync();
  }));

  // --- éditeur de sous-titres
  function renderCues() {
    const box = $('v_cues');
    box.innerHTML = cues.length ? '' : '<small>Aucun sous-titre. Importez un fichier SRT/VTT ou ajoutez des lignes.</small>';
    cues.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'cue';
      row.innerHTML = '<input type="number" step="0.1" min="0" class="cs" title="Début (s)"><input type="number" step="0.1" min="0" class="ce" title="Fin (s)"><textarea rows="2"></textarea><button type="button" class="link go" title="Aller à cette ligne">⏵</button><button type="button" class="link del" title="Supprimer">✕</button>';
      const [cs, ce] = row.querySelectorAll('input'), ta = row.querySelector('textarea');
      cs.value = c.start; ce.value = c.end; ta.value = c.text;
      cs.addEventListener('input', () => { c.start = Number(cs.value); sync(); updateSub(); });
      ce.addEventListener('input', () => { c.end = Number(ce.value); sync(); updateSub(); });
      ta.addEventListener('input', () => { c.text = ta.value; sync(); updateSub(); });
      row.querySelector('.go').addEventListener('click', () => { video.currentTime = c.start; });
      row.querySelector('.del').addEventListener('click', () => { cues.splice(i, 1); sync(); renderCues(); });
      box.append(row);
    });
  }
  $('v_addcue').addEventListener('click', () => {
    const t = Math.round(video.currentTime * 10) / 10;
    cues.push({ start: t, end: t + 2, text: 'Nouveau sous-titre' });
    cues.sort((a, b) => a.start - b.start);
    sync(); renderCues();
  });

  // --- suivi des exports
  const LABEL = { queued: 'En attente', running: 'En cours', done: 'Terminé', error: 'Erreur' };
  async function poll() {
    let active = false;
    try {
      const jobs = await (await fetch(`/api/jobs/${edition}`)).json();
      active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
      $('v_jobs').innerHTML = jobs.length ? jobs.map((j) => `<div class="job ${j.status}"><div><b>${FM[j.fmt]?.label || j.fmt}</b>
        <span class="tag ${j.status === 'done' ? 'st-2' : j.status === 'error' ? 'warn' : ''}">${LABEL[j.status]}${j.status === 'running' ? ' ' + Math.round(j.progress * 100) + ' %' : ''}</span>
        ${j.draft ? '<span class="tag warn">BROUILLON</span>' : ''}</div>
        ${j.status === 'running' || j.status === 'queued' ? `<progress max="1" value="${j.progress}"></progress>` : ''}
        <small>${j.message ? j.message.replace(/[<>&]/g, '') : ''}</small>
        ${j.export_id ? `<div><video src="/exports/${j.export_id}" controls preload="metadata" class="jobvideo"></video><br><a href="/exports/${j.export_id}?dl=1">Télécharger</a></div>` : ''}</div>`).join('')
        : '<small>Aucun export pour l’instant. « Lancer les exports » produit un fichier par format coché.</small>';
    } catch { /* réseau : on réessaie */ }
    setTimeout(poll, active ? 1500 : 6000);
  }

  window.addEventListener('resize', layout);
  video.addEventListener('loadedmetadata', () => { if (d.start) video.currentTime = d.start; layout(); });
  loadReframe(); renderCues(); sync(); layout(); poll();
  if (!info) wrap.insertAdjacentHTML('beforeend', '<div class="vhint">Choisissez une vidéo source pour voir l’aperçu.</div>');
})();
