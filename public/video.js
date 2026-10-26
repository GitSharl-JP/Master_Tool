// Éditeur vidéo à timeline : des clips mis bout à bout, des éléments (logo, image, texte, sous-titres) posés par-dessus.
// Tous les éléments ont la même fiche : position X/Y (centre, par format), échelle, rotation, opacité, début/fin.
// L'aperçu et l'export utilisent les mêmes formules (src/timeline.js) : ce qui est montré ici est ce qui est exporté.
(() => {
  const form = $('vform');
  if (!form) return;
  const J = (k) => JSON.parse(form.dataset[k] || 'null');
  const base = J('design'), FM = J('formats'), FONTS = J('fonts') || {}, VIDEOS = J('videos') || [], IMAGES = J('images') || [], INFOS = J('infos') || {};
  const edition = form.dataset.edition, draft = form.dataset.draft === '1';
  let guard = null;
  const S = { tl: J('tl'), fmt: Object.keys(FM)[0], t: 0, sel: null, zoom: 60, playing: false, dirty: false, formats: [...(base.formats || [])], endcard: { ...base.endcard } };
  const BASE = { image: 0.20, text: 0.06, subs: 0.045, video: 1 }, DEF_S = { logo: 70, image: 100, text: 100, subs: 100, video: 45 };
  const NAMES = { logo: 'Logo', image: 'Image', text: 'Texte', subs: 'Sous-titres', video: 'Vidéo superposée' };
  const video = $('vplayer'), frame = $('vframe'), wrap = $('pwrap'), layer = $('vlayer'), selbox = $('vsel'), props = $('vprops'), inner = $('tlinner');

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r1 = (v) => Math.round(v * 10) / 10;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const uid = (p) => p + Math.random().toString(36).slice(2, 7);
  const F = () => FM[S.fmt];

  // ---------- modèle : durées, position des clips sur la timeline
  const srcDur = (c) => INFOS[c.asset]?.duration || 0;
  const clipDur = (c) => Math.max(0.1, (c.out > c.in ? (srcDur(c) ? Math.min(c.out, srcDur(c)) : c.out) : srcDur(c)) - c.in);
  const spans = () => { let t = 0; return S.tl.clips.map((c) => { const k = { c, start: t, dur: clipDur(c) }; t += k.dur; return k; }); };
  const total = () => spans().reduce((s, k) => s + k.dur, 0);
  const vdur = (e) => Math.max(0.1, (e.out > (e.in || 0) ? (srcDur(e) ? Math.min(e.out, srcDur(e)) : e.out) : srcDur(e)) - (e.in || 0)); // durée d'une vidéo superposée (extrait de sa source)
  const winOf = (e) => (e.type === 'video' ? [e.start || 0, (e.start || 0) + vdur(e)] : [e.start || 0, e.end > 0 ? e.end : Math.max(total(), e.start || 0)]);
  // pistes : 1 = la plus basse (juste au-dessus de la piste principale) ; une piste plus haute est au-dessus
  const maxTrack = () => S.tl.els.reduce((m, e) => Math.max(m, e.track || 0), 0);
  const overlaps = (a, b) => { const [a0, a1] = winOf(a), [b0, b1] = winOf(b); return a0 < b1 - 1e-6 && b0 < a1 - 1e-6; };
  const conflicts = (e, tr) => S.tl.els.some((o) => o !== e && o.track === tr && overlaps(e, o));
  function normalizeTracks() { // plus de piste vide : les numéros restent consécutifs, dans le même ordre
    const used = [...new Set(S.tl.els.map((e) => e.track))].sort((a, b) => a - b), map = new Map(used.map((t, i) => [t, i + 1]));
    S.tl.els.forEach((e) => { e.track = map.get(e.track); });
  }
  // Pose e sur la piste tr ; si un autre élément y occupe déjà le même moment, une nouvelle piste est créée juste au-dessus.
  function placeOnTrack(e, tr) {
    if (tr > maxTrack() || !conflicts(e, tr)) { e.track = tr; return; }
    for (const o of S.tl.els) if (o !== e && o.track > tr) o.track += 1;
    e.track = tr + 1;
  }
  // Monter (+1) ou descendre (-1) d'une piste : sur la piste voisine si elle est libre à cet instant, sinon une piste est insérée entre les deux
  function moveTrack(e, dir) {
    const tgt = e.track + dir;
    if (tgt < 1) return;
    if (tgt > maxTrack() || !conflicts(e, tgt)) e.track = tgt;
    else if (dir > 0) { for (const o of S.tl.els) if (o !== e && o.track > tgt) o.track += 1; e.track = tgt + 1; }
    else { for (const o of S.tl.els) if (o !== e && o.track >= tgt) o.track += 1; e.track = tgt; }
    normalizeTracks();
  }
  const orderedEls = () => S.tl.els.map((e, i) => [e, i]).sort((a, b) => (a[0].track ?? a[1] + 1) - (b[0].track ?? b[1] + 1) || a[1] - b[1]).map((x) => x[0]);
  const onAt = (e, t) => { const [a, b] = winOf(e); return t >= a - 1e-6 && t < b + 1e-6; };
  const posOf = (e) => (e.pos && e.pos[S.fmt]) || { x: Math.round((e.fx ?? 0.5) * F().w), y: Math.round((e.fy ?? 0.5) * F().h) };
  const byId = (id) => S.tl.els.find((e) => e.id === id);
  const curEl = () => (S.sel && S.sel.kind === 'el' ? byId(S.sel.id) : null);
  const curClip = () => (S.sel && S.sel.kind === 'clip' ? S.tl.clips.find((c) => c.id === S.sel.id) : null);
  const imgName = (id) => IMAGES.find((i) => String(i.id) === String(id))?.name || 'image';
  const sync = () => {
    form.elements.design.value = JSON.stringify({ ...base, formats: S.formats, endcard: S.endcard, tl: S.tl });
    form.elements.cues.value = JSON.stringify(allCues());
  };
  // les sous-titres communs du projet (téléchargement .srt, anciens montages) = les lignes de tous les blocs, dans l'ordre
  const allCues = () => S.tl.els.filter((e) => e.type === 'subs').flatMap((e) => e.cues || []).sort((a, b) => a.start - b.start);
  const touch = () => {
    S.dirty = true; guard && guard.refresh(); sync();
    if (!hist.restoring) { clearTimeout(hist.timer); hist.timer = setTimeout(commit, 350); updUndo(); } // plusieurs réglages rapprochés = une seule étape d'annulation
  };

  // ---------- annuler / rétablir (Ctrl+Z, Ctrl+Y) : on garde des instantanés du montage
  const hist = { stack: [], i: -1, timer: null, restoring: false };
  const snapState = () => JSON.stringify({ tl: S.tl, formats: S.formats, endcard: S.endcard });
  function commit() {
    hist.timer = null;
    const s = snapState();
    if (hist.stack[hist.i] === s) { updUndo(); return; }
    hist.stack = hist.stack.slice(0, hist.i + 1); hist.stack.push(s);
    if (hist.stack.length > 150) hist.stack.shift();
    hist.i = hist.stack.length - 1; updUndo();
  }
  function updUndo() {
    const pending = !!hist.timer;
    if ($('t_undo')) $('t_undo').disabled = hist.i <= 0 && !pending;
    if ($('t_redo')) $('t_redo').disabled = hist.i >= hist.stack.length - 1 || pending;
  }
  function restore(snap) {
    const o = JSON.parse(snap);
    hist.restoring = true;
    S.tl = o.tl; S.formats = o.formats; S.endcard = o.endcard;
    if (S.sel && !(S.sel.kind === 'clip' ? S.tl.clips.some((c) => c.id === S.sel.id) : S.tl.els.some((e) => e.id === S.sel.id))) S.sel = null;
    S.dirty = true; guard && guard.refresh(); sync();
    renderLayer(); renderTimeline(); renderProps(); showAt(S.t);
    hist.restoring = false; updUndo();
  }
  function undo() { if (hist.timer) { clearTimeout(hist.timer); commit(); } if (hist.i <= 0) return; hist.i--; restore(hist.stack[hist.i]); }
  function redo() { if (hist.timer) { clearTimeout(hist.timer); commit(); } if (hist.i >= hist.stack.length - 1) return; hist.i++; restore(hist.stack[hist.i]); }
  $('t_undo').addEventListener('click', undo); $('t_redo').addEventListener('click', redo);

  // ---------- aperçu : cadrage de la vidéo (même formule que src/media.js), éléments, sous-titres
  const reframe = (sw, sh, W, H, r = {}) => {
    const z = (Number(r.zoom) || 100) / 100, s = Math.max(W / sw, H / sh) * z;
    const iw = Math.max(W, Math.round(sw * s)), ih = Math.max(H, Math.round(sh * s));
    return { iw, ih, x: Math.round((iw - W) * Number(r.posx ?? 50) / 100), y: Math.round((ih - H) * Number(r.posy ?? 50) / 100) };
  };
  function fit() {
    const f = F();
    frame.style.width = f.w + 'px'; frame.style.height = f.h + 'px';
    const availW = wrap.clientWidth, availH = wrap.clientHeight - 52;
    const k = Math.min(1, availW / f.w, availH / f.h);
    frame.style.transform = `scale(${k})`;
    frame.style.left = Math.max(0, (availW - f.w * k) / 2) + 'px';
    frame.style.top = Math.max(0, (availH - f.h * k) / 2) + 'px';
    frame.style.setProperty('--inv', String(1 / k)); // les poignées gardent la même taille à l'écran
    const g = $('vguides');
    g.style.display = $('v_guides').checked ? 'block' : 'none';
    Object.assign(g.style, { top: f.safe.top + 'px', bottom: f.safe.bottom + 'px', left: f.safe.side + 'px', right: f.safe.side + 'px' });
    Object.assign($('vdraft').style, { display: draft ? 'block' : 'none', height: Math.round(f.h * 0.028) + 'px', fontSize: Math.round(f.h * 0.017) + 'px', lineHeight: Math.round(f.h * 0.028) + 'px' });
  }
  const clipAt = (t) => { const sp = spans(); return sp.find((k) => t < k.start + k.dur - 1e-6) || sp[sp.length - 1] || null; };
  let loaded = null, pendingSeek = null;
  function placeVideo(k) {
    if (!k) { video.style.display = 'none'; return; }
    video.style.display = '';
    const info = INFOS[k.c.asset], f = F();
    if (!info) return;
    const b = reframe(info.w, info.h, f.w, f.h, k.c.reframe?.[S.fmt]);
    Object.assign(video.style, { width: b.iw + 'px', height: b.ih + 'px', left: -b.x + 'px', top: -b.y + 'px' });
  }
  // se placer à l'instant t de la timeline : le bon clip, au bon endroit
  function showAt(t, seek = true) {
    S.t = clamp(t, 0, total());
    const k = clipAt(S.t);
    if (k) {
      const want = `/files/${k.c.asset}`, local = k.c.in + clamp(S.t - k.start, 0, k.dur);
      if (loaded !== k.c.id || !video.src.endsWith(want)) { loaded = k.c.id; pendingSeek = local; video.src = want; }
      else if (seek && !S.playing) { try { video.currentTime = local; } catch { /* pas encore prêt */ } }
    } else { loaded = null; video.removeAttribute('src'); }
    placeVideo(k);
    updateAll();
  }
  video.addEventListener('loadedmetadata', () => {
    if (pendingSeek !== null) { try { video.currentTime = pendingSeek; } catch { /* */ } pendingSeek = null; }
    if (S.playing) video.play().catch(() => {});
  });

  const FONT_STACK = (name) => `${FONTS[name] ? `'${name}',` : ''}${FONTS[name] === 'serif' ? 'Georgia,serif' : "'Segoe UI',Arial,sans-serif"},'Yu Gothic','Meiryo',sans-serif`;
  // cale un lecteur de vidéo superposée sur la tête de lecture (lecture : il suit tout seul, on ne corrige que les grands écarts)
  function syncOverlay(e, n, force = false) {
    const on = onAt(e, S.t);
    n.volume = clamp((e.vol ?? 100) / 100, 0, 1);
    if (!on) { if (!n.paused) n.pause(); return; }
    const target = (e.in || 0) + (S.t - (e.start || 0));
    if (S.playing) {
      if (n.paused) { try { n.currentTime = target; } catch { /* pas prêt */ } n.play().catch(() => {}); }
      else if (Math.abs(n.currentTime - target) > 0.35) { try { n.currentTime = target; } catch { /* */ } }
    } else {
      if (!n.paused) n.pause();
      if (force || Math.abs(n.currentTime - target) > 0.04) { try { n.currentTime = target; } catch { /* */ } }
    }
  }
  function mkNode(e) {
    if (e.type === 'video') {
      const v = document.createElement('video');
      v.className = 'vel'; v.dataset.id = e.id; v.playsInline = true; v.preload = 'auto'; v.src = `/files/${e.asset}`;
      v.addEventListener('loadedmetadata', () => { syncOverlay(e, v, true); updateSel(); });
      return v;
    }
    const n = document.createElement(e.type === 'logo' || e.type === 'image' ? 'img' : 'div');
    n.className = 'vel'; n.dataset.id = e.id;
    if (n.tagName === 'IMG') { n.alt = ''; n.draggable = false; n.addEventListener('load', updateSel); }
    return n;
  }
  function styleNode(n, e) {
    const f = F(), p = posOf(e);
    let show = onAt(e, S.t);
    if (e.type === 'video') {
      const info = INFOS[e.asset];
      n.style.width = Math.round(f.w * BASE.video * e.s / 100) + 'px'; if (info) n.style.aspectRatio = `${info.w} / ${info.h}`;
    } else if (e.type === 'logo' || e.type === 'image') {
      const src = `/files/${e.asset}`; if (!n.src.endsWith(src)) n.src = src;
      n.style.width = Math.round(f.w * BASE.image * e.s / 100) + 'px';
    } else if (e.type === 'text') {
      const fs = f.w * BASE.text * e.s / 100;
      n.textContent = e.text || ' ';
      Object.assign(n.style, { font: `${e.bold === false ? 400 : 700} ${fs.toFixed(2)}px/1.2 ${FONT_STACK(e.font)}`, color: e.color || '#ffffff', whiteSpace: 'pre', textAlign: 'center', padding: Math.ceil(fs * 0.14) + 'px' });
      n.style.webkitTextStroke = e.outline === false ? '' : `${(fs / 12).toFixed(2)}px #000`; n.style.paintOrder = 'stroke fill';
    } else { // sous-titres : la ligne active à cet instant ; sélectionnés sans ligne, un exemple reste visible pour pouvoir les déplacer
      const cs = e.cues || [], c = cs.find((x) => S.t >= x.start && S.t < x.end);
      const sample = !c && S.sel && S.sel.id === e.id;
      const fs = Math.round(f.w * BASE.subs * e.s / 100), ol = Math.max(2, Math.round(fs / 14));
      n.textContent = c ? c.text : sample ? (cs[0]?.text || 'Exemple de sous-titre') : '';
      Object.assign(n.style, { font: `700 ${fs}px/1.2 Arial,sans-serif`, color: '#fff', textAlign: 'center', whiteSpace: 'pre-wrap', maxWidth: f.w - 2 * f.safe.side + 'px', width: 'max-content' });
      n.style.webkitTextStroke = `${ol * 2}px #000`; n.style.paintOrder = 'stroke fill';
      n.classList.toggle('sample', !c && sample);
      show = show && (!!c || sample);
    }
    Object.assign(n.style, { left: p.x + 'px', top: p.y + 'px', transform: `translate(-50%,-50%) rotate(${e.rot || 0}deg)`, opacity: String((e.op ?? 100) / 100), display: show ? '' : 'none' });
    if (e.type === 'video') syncOverlay(e, n);
  }
  function renderLayer() {
    layer.innerHTML = '';
    for (const e of orderedEls()) layer.append(mkNode(e)); // une piste plus haute est au-dessus
    styleLayer();
  }
  function styleLayer() {
    for (const e of S.tl.els) { const n = layer.querySelector(`[data-id="${e.id}"]`); if (n) styleNode(n, e); }
  }
  function updateSel() {
    const e = curEl(), n = e && layer.querySelector(`[data-id="${e.id}"]`);
    if (!e || !n || n.style.display === 'none') { selbox.hidden = true; return; }
    const p = posOf(e);
    selbox.hidden = false;
    Object.assign(selbox.style, { left: p.x + 'px', top: p.y + 'px', width: n.offsetWidth + 'px', height: n.offsetHeight + 'px', transform: `translate(-50%,-50%) rotate(${e.rot || 0}deg)` });
  }
  const head = () => { $('tlhead').style.left = S.t * S.zoom + 'px'; $('vtime').textContent = `${fmtT(S.t)} / ${fmtT(total())}`; };
  function updateAll() { styleLayer(); updateSel(); head(); }

  // ---------- lecture : un seul lecteur, qui passe d'un clip au suivant
  function pause() { S.playing = false; video.pause(); layer.querySelectorAll('video').forEach((v) => v.pause()); $('vplay').textContent = '▶'; }
  function play() {
    if (!spans().length) return;
    if (S.t >= total() - 0.05) showAt(0);
    S.playing = true; $('vplay').textContent = '❚❚'; video.play().catch(() => {}); loop();
  }
  function loop() {
    if (!S.playing) return;
    const sp = spans(), i = sp.findIndex((x) => x.c.id === loaded), k = sp[i];
    if (k) {
      S.t = k.start + (video.currentTime - k.c.in);
      if (video.currentTime >= k.c.in + k.dur - 0.04) {
        if (sp[i + 1]) showAt(sp[i + 1].start); else { pause(); showAt(total()); return; }
      }
    }
    updateAll();
    requestAnimationFrame(loop);
  }
  $('vplay').addEventListener('click', () => (S.playing ? pause() : play()));

  // ---------- sélection
  function select(s) {
    S.sel = s; renderProps(); renderTimeline(); styleLayer(); updateSel();
  }

  // ---------- timeline
  function renderTimeline() {
    const z = S.zoom, sp = spans(), tot = total(), width = Math.max(tot + 3, 12) * z;
    inner.style.width = width + 'px';
    const step = z >= 90 ? 1 : z >= 45 ? 2 : z >= 25 ? 5 : 10;
    let ticks = '';
    for (let s = 0; s <= width / z; s += step) ticks += `<span style="left:${s * z}px">${fmtT(s)}</span>`;
    $('tlruler').innerHTML = ticks;
    const sl = S.sel;
    const elBlock = (e) => {
      const [a, b] = winOf(e), lab = e.type === 'text' ? `T : ${esc((e.text || '').slice(0, 24))}` : e.type === 'subs' ? `Sous-titres · ${(e.cues || []).length} ligne(s)` : e.type === 'video' ? `${esc(INFOS[e.asset]?.name || 'vidéo')} · ${r1(b - a)} s` : esc(imgName(e.asset));
      return `<div class="tlb el t-${e.type}${sl && sl.id === e.id ? ' on' : ''}" data-kind="el" data-id="${e.id}" style="left:${a * z}px;width:${Math.max(10, (b - a) * z)}px"><i class="tlh l"></i><span>${lab}</span><i class="tlh r"></i></div>`;
    };
    // une ligne par piste, la plus haute en haut ; la ligne du haut, vide, sert à créer une nouvelle piste (en y déposant un bloc)
    const maxT = maxTrack();
    let rows = '';
    for (let t = maxT + 1; t >= 1; t--) rows += `<div class="tlrow${t > maxT ? ' new' : ''}" data-track="${t}" title="${t > maxT ? 'Nouvelle piste' : 'Piste ' + t}">${S.tl.els.filter((e) => e.track === t).map(elBlock).join('')}${t > maxT ? '<em class="tlnew">Déposer un bloc ici : nouvelle piste</em>' : ''}</div>`;
    const clipRow = `<div class="tlrow vid" data-track="main" title="Piste principale">${sp.length ? sp.map((k) => `<div class="tlb clip${sl && sl.id === k.c.id ? ' on' : ''}" data-kind="clip" data-id="${k.c.id}" style="left:${k.start * z}px;width:${Math.max(10, k.dur * z)}px"><i class="tlh l"></i><span>${esc(INFOS[k.c.asset]?.name || 'clip')} · ${r1(k.dur)} s</span><i class="tlh r"></i></div>`).join('') : '<em class="tlempty">Ajoutez un clip vidéo pour commencer</em>'}</div>`;
    $('tltracks').innerHTML = rows + clipRow;
    head();
  }
  const snap = (v) => Math.round(v * 10) / 10;
  let drag = null;
  const seekFrom = (e) => { const r = inner.getBoundingClientRect(); if (S.playing) pause(); showAt(clamp((e.clientX - r.left) / S.zoom, 0, total())); };
  inner.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.tlb');
    if (!b) { seekFrom(e); drag = { mode: 'head' }; try { inner.setPointerCapture(e.pointerId); } catch { /* pointeur simulé */ } e.preventDefault(); return; }
    const kind = b.dataset.kind, id = b.dataset.id;
    select({ kind, id });
    const h = e.target.closest('.tlh');
    const it = kind === 'clip' ? S.tl.clips.find((c) => c.id === id) : byId(id);
    drag = { mode: h ? (h.classList.contains('l') ? 'trimL' : 'trimR') : 'move', kind, id, x0: e.clientX, it, s0: it.start, e0: it.end, in0: it.in, out0: it.out, start0: kind === 'clip' ? spans().find((k) => k.c.id === id).start : 0, dur0: kind === 'clip' ? clipDur(it) : 0, cues0: kind === 'el' && it.cues ? JSON.parse(JSON.stringify(it.cues)) : null };
    try { inner.setPointerCapture(e.pointerId); } catch { /* pointeur simulé */ }
    e.preventDefault();
  });
  inner.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.mode === 'head') { seekFrom(e); return; }
    const dt = (e.clientX - drag.x0) / S.zoom, it = drag.it, tot = total();
    if (drag.kind === 'el') {
      if (drag.mode === 'move') {
        it.start = Math.max(0, snap(drag.s0 + dt)); if (drag.e0 > 0 && it.type !== 'video') it.end = snap(it.start + (drag.e0 - drag.s0));
        if (drag.cues0) { const sh = it.start - drag.s0; it.cues = drag.cues0.map((c) => ({ ...c, start: r1(Math.max(0, c.start + sh)), end: r1(Math.max(0, c.end + sh)) })); } // les lignes suivent le bloc
        // verticalement : la piste qui se trouve sous le pointeur
        const row = [...$('tltracks').children].find((r) => { const b = r.getBoundingClientRect(); return e.clientY >= b.top - 2 && e.clientY < b.bottom + 3; });
        if (row && row.dataset.track && row.dataset.track !== 'main') it.track = Number(row.dataset.track);
      }
      else if (it.type === 'video') { // vidéo superposée : le bord gauche rogne le début de l'extrait (le contenu reste calé), le droit la fin
        const sd = srcDur(it), outEff = drag.out0 > drag.in0 ? drag.out0 : sd;
        if (drag.mode === 'trimL') { const nin = clamp(snap(drag.in0 + dt), 0, outEff - 0.2); it.in = nin; it.start = Math.max(0, snap(drag.s0 + (nin - drag.in0))); }
        else { const no = snap(outEff + dt); it.out = no >= sd - 0.05 ? 0 : clamp(no, it.in + 0.2, sd); }
      }
      else if (drag.mode === 'trimL') it.start = clamp(snap(drag.s0 + dt), 0, (drag.e0 > 0 ? drag.e0 : tot) - 0.1);
      else { const ne = snap((drag.e0 > 0 ? drag.e0 : tot) + dt); it.end = ne >= tot - 0.05 ? 0 : Math.max(it.start + 0.1, ne); }
    } else {
      const sd = srcDur(it), outEff = drag.out0 > drag.in0 ? drag.out0 : sd;
      if (drag.mode === 'trimL') it.in = clamp(snap(drag.in0 + dt), 0, outEff - 0.2);
      else if (drag.mode === 'trimR') { const no = snap(outEff + dt); it.out = no >= sd - 0.05 ? 0 : clamp(no, it.in + 0.2, sd); }
      else { // glisser un clip = changer son rang : on le place d'après le milieu de son bloc
        const mid = drag.start0 + drag.dur0 / 2 + dt, others = S.tl.clips.filter((c) => c !== it);
        let t = 0, idx = 0; for (const c of others) { const d = clipDur(c); if (t + d / 2 < mid) idx++; t += d; }
        const cur = S.tl.clips.indexOf(it);
        if (idx !== cur) { S.tl.clips.splice(cur, 1); S.tl.clips.splice(idx, 0, it); }
      }
    }
    renderTimeline(); updateAll();
  });
  const endTl = () => {
    if (drag && drag.mode !== 'head') {
      if (drag.kind === 'el') { placeOnTrack(drag.it, drag.it.track); normalizeTracks(); renderLayer(); } // deux éléments ne se chevauchent pas sur une même piste
      touch(); showAt(S.t); renderProps(); renderTimeline();
    }
    drag = null;
  };
  inner.addEventListener('pointerup', endTl); inner.addEventListener('pointercancel', endTl);
  $('t_zoom').addEventListener('input', () => { S.zoom = Number($('t_zoom').value); renderTimeline(); });

  // ---------- ajout / suppression / scission
  const pickBox = $('vpick'), pickList = $('vpick-list');
  const closePick = () => { pickBox.hidden = true; };
  $('vpick-close').addEventListener('click', closePick);
  pickBox.addEventListener('pointerdown', (e) => { if (e.target === pickBox) closePick(); });
  function pick(title, items, html, onPick) {
    $('vpick-title').textContent = title;
    pickList.innerHTML = items.length ? items.map((it) => `<button type="button" class="pk" data-id="${it.id}">${html(it)}</button>`).join('') : '<p>Rien dans la bibliothèque pour l’instant : ajoutez des fichiers dans l’onglet Bibliothèque.</p>';
    pickList.onclick = (ev) => { const b = ev.target.closest('.pk'); if (b) { closePick(); onPick(b.dataset.id); } };
    pickBox.hidden = false;
  }
  async function addClip(assetId) {
    if (!INFOS[assetId]) {
      const r = await fetch(`/api/video-info/${assetId}`);
      if (!r.ok) { alert((await r.json()).error || 'Vidéo illisible.'); return; }
      INFOS[assetId] = await r.json();
    }
    const c = { id: uid('c'), asset: String(assetId), in: 0, out: 0, reframe: {} };
    S.tl.clips.push(c); touch();
    select({ kind: 'clip', id: c.id });
    showAt(spans().find((k) => k.c.id === c.id).start);
  }
  function addEl(e) {
    const el = { id: uid('e'), start: 0, end: 0, fx: 0.5, fy: 0.5, pos: {}, s: DEF_S[e.type], rot: 0, op: 100, track: maxTrack() + 1, ...e };
    S.tl.els.push(el); touch(); renderLayer(); select({ kind: 'el', id: el.id });
  }
  $('t_addclip').addEventListener('click', () => pick('Ajouter un clip vidéo', VIDEOS, (v) => `${esc(v.name)}${v.provisional ? ' <small>(provisoire)</small>' : ''}`, addClip));
  async function addOverlay(assetId) {
    if (!INFOS[assetId]) {
      const r = await fetch(`/api/video-info/${assetId}`);
      if (!r.ok) { alert((await r.json()).error || 'Vidéo illisible.'); return; }
      INFOS[assetId] = await r.json();
    }
    addEl({ type: 'video', asset: String(assetId), in: 0, out: 0, vol: 100, start: r1(S.t), fy: 0.3 });
  }
  $('t_addvid').addEventListener('click', () => pick('Ajouter une vidéo superposée (sur une nouvelle piste)', VIDEOS, (v) => `${esc(v.name)}${v.provisional ? ' <small>(provisoire)</small>' : ''}`, addOverlay));
  $('t_addtext').addEventListener('click', () => addEl({ type: 'text', text: 'Votre texte', font: '', color: '#ffffff', bold: true, outline: true, start: r1(S.t), fy: 0.7 }));
  $('t_addimg').addEventListener('click', () => pick('Ajouter un logo ou une image', IMAGES, (i) => `<img src="/files/${i.id}" alt=""><span>${esc(i.name)}</span>`, (id) => { const im = IMAGES.find((x) => String(x.id) === String(id)); addEl({ type: im.role === 'logo' ? 'logo' : 'image', asset: String(id), start: r1(S.t), fx: im.role === 'logo' ? 0.82 : 0.5, fy: im.role === 'logo' ? 0.08 : 0.4 }); }));
  $('t_addsubs').addEventListener('click', () => {
    const pos = {};
    for (const [k, f] of Object.entries(FM)) { const fs = Math.round(f.w * BASE.subs); pos[k] = { x: Math.round(f.w / 2), y: Math.round(f.h - f.safe.bottom - Math.round(f.h * 0.02) - Math.round(fs * 0.7)) }; }
    const t = r1(S.t);
    // un bloc de sous-titres vide existe déjà : on le remplit plutôt que d'empiler une seconde piste
    const empty = S.tl.els.find((e) => e.type === 'subs' && !(e.cues || []).length);
    if (empty) { empty.cues = [{ start: t, end: r1(t + 3), text: 'Nouveau sous-titre' }]; touch(); renderLayer(); select({ kind: 'el', id: empty.id }); return; }
    addEl({ type: 'subs', pos, start: t, end: r1(t + 3), cues: [{ start: t, end: r1(t + 3), text: 'Nouveau sous-titre' }] });
  });
  function removeSel() {
    if (!S.sel) return;
    if (S.sel.kind === 'clip') S.tl.clips = S.tl.clips.filter((c) => c.id !== S.sel.id); else S.tl.els = S.tl.els.filter((e) => e.id !== S.sel.id);
    S.sel = null; normalizeTracks(); touch(); renderLayer(); renderProps(); renderTimeline(); showAt(S.t);
  }
  $('t_del').addEventListener('click', removeSel);
  // Scinder un élément en deux éléments indépendants (leurs lignes de sous-titres sont réparties) : chacun garde sa fiche, qu'on peut ensuite régler à part.
  function splitEl(e) {
    if (e.type === 'video') { // l'extrait est coupé en deux : la seconde moitié reprend là où la première s'arrête
      const t = r1(S.t), cut = r1((e.in || 0) + (t - e.start)), second = { ...JSON.parse(JSON.stringify(e)), id: uid('e'), start: t, in: cut };
      second.out = e.out; e.out = cut;
      S.tl.els.splice(S.tl.els.indexOf(e) + 1, 0, second);
      touch(); renderLayer(); select({ kind: 'el', id: second.id });
      return;
    }
    const t = r1(S.t), end0 = e.end, second = { ...JSON.parse(JSON.stringify(e)), id: uid('e') };
    e.end = t; second.start = t; second.end = end0;
    if (e.type === 'subs') {
      const all = e.cues || [];
      e.cues = all.filter((c) => c.start < t).map((c) => ({ ...c, end: Math.min(c.end, t) }));
      second.cues = all.filter((c) => c.end > t).map((c) => ({ ...c, start: Math.max(c.start, t) }));
    }
    S.tl.els.splice(S.tl.els.indexOf(e) + 1, 0, second);
    touch(); renderLayer(); select({ kind: 'el', id: second.id });
  }
  function toOver(c) { // clip de la piste principale -> vidéo superposée à la même place (la piste principale se referme)
    const k = spans().find((x) => x.c.id === c.id);
    const el = { id: uid('e'), type: 'video', asset: c.asset, in: c.in, out: c.out, vol: 100, start: r1(k.start), end: 0, track: maxTrack() + 1, fx: 0.5, fy: 0.5, pos: {}, s: 100, rot: 0, op: 100 };
    S.tl.clips = S.tl.clips.filter((x) => x !== c); S.tl.els.push(el);
    touch(); renderLayer(); select({ kind: 'el', id: el.id }); showAt(S.t);
  }
  function toMain(e) { // vidéo superposée -> clip de la piste principale, inséré selon son début
    const idx = spans().filter((k) => k.start < (e.start || 0) - 1e-6).length;
    const clip = { id: uid('c'), asset: e.asset, in: e.in || 0, out: e.out || 0, reframe: {} };
    S.tl.clips.splice(idx, 0, clip); S.tl.els = S.tl.els.filter((x) => x !== e); normalizeTracks();
    touch(); renderLayer(); select({ kind: 'clip', id: clip.id }); showAt(S.t);
  }
  function split() {
    const el = curEl();
    if (el) { const [a, b] = winOf(el); if (S.t - a > 0.1 && b - S.t > 0.1) return splitEl(el); }
    const k = clipAt(S.t);
    if (!k || S.t - k.start < 0.2 || k.start + k.dur - S.t < 0.2) { alert('Placez la tête de lecture à l’intérieur d’un clip (à plus de 0,2 s de ses bords) pour le couper.'); return; }
    const cut = r1(k.c.in + (S.t - k.start)), second = { ...JSON.parse(JSON.stringify(k.c)), id: uid('c'), in: cut };
    const out0 = k.c.out; k.c.out = cut; second.out = out0;
    S.tl.clips.splice(S.tl.clips.indexOf(k.c) + 1, 0, second);
    touch(); select({ kind: 'clip', id: second.id }); showAt(S.t);
  }
  $('t_split').addEventListener('click', split);

  // ---------- panneau de réglages : le même pour tous les éléments
  const slider = (k, label, min, max, step, val) => `<label class="pf"><span>${label}</span><span class="pr"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><input type="number" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}"></span></label>`;
  const num = (k, label, val, hint = '') => `<label class="pf"><span>${label}</span><span class="pr"><input type="number" data-k="${k}" min="0" step="0.1" value="${val}"></span>${hint ? `<small>${hint}</small>` : ''}</label>`;
  function renderProps() {
    const e = curEl(), c = curClip(), f = F();
    if (e) {
      const p = posOf(e);
      props.innerHTML = `<h3>${NAMES[e.type]}</h3>
${e.type === 'text' ? `<label class="pf"><span>Texte</span><textarea data-k="text" rows="3">${esc(e.text)}</textarea></label>
<label class="pf"><span>Police</span><select data-k="font"><option value="">Par défaut</option>${Object.keys(FONTS).map((n) => `<option${n === e.font ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
<div class="pf inl"><label>Couleur <input type="color" data-k="color" value="${esc(e.color || '#ffffff')}"></label><label class="check"><input type="checkbox" data-k="bold"${e.bold === false ? '' : ' checked'}> Gras</label><label class="check"><input type="checkbox" data-k="outline"${e.outline === false ? '' : ' checked'}> Contour</label></div>` : ''}
${e.type === 'video' ? `<small>${esc(INFOS[e.asset]?.name || '')}${INFOS[e.asset] ? ` · ${r1(srcDur(e))} s${INFOS[e.asset].hasAudio ? ' · avec son' : ' · sans son'}` : ''}</small>
<div class="pgroup"><b>Extrait de la vidéo source</b>${num('in', 'Début (s)', r1(e.in || 0))}${num('out', 'Fin (s)', r1(e.out || 0), '0 = jusqu’à la fin de la vidéo')}</div>` : ''}
${e.type === 'logo' || e.type === 'image' ? `<label class="pf"><span>Fichier</span><select data-k="asset">${IMAGES.map((i) => `<option value="${i.id}"${String(i.id) === String(e.asset) ? ' selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label>` : ''}
<div class="pgroup"><b>Position <small>(${esc(f.label)} · centre de l’élément, en px)</small></b>
${slider('x', 'X', -Math.round(f.w / 2), Math.round(f.w * 1.5), 1, p.x)}${slider('y', 'Y', -Math.round(f.h / 2), Math.round(f.h * 1.5), 1, p.y)}
<span class="inline"><button type="button" class="mini" data-a="cx">Centrer horizontalement</button><button type="button" class="mini" data-a="cy">Centrer verticalement</button><button type="button" class="mini" data-a="home">Position d’origine</button></span></div>
${slider('s', e.type === 'video' ? 'Taille (% de la largeur)' : 'Échelle (%)', 5, 400, 1, e.s)}${slider('rot', 'Rotation (°)', -180, 180, 1, e.rot || 0)}${slider('op', 'Opacité (%)', 0, 100, 1, e.op ?? 100)}${e.type === 'video' ? slider('vol', 'Volume (%)', 0, 100, 1, e.vol ?? 100) : ''}
<div class="pgroup"><b>Sur la timeline</b>${num('start', 'Début (s)', r1(e.start || 0))}${e.type === 'video' ? '' : num('end', 'Fin (s)', r1(e.end || 0), '0 = jusqu’à la fin du film')}</div>
<div class="pgroup"><b>Piste ${e.track}</b> <small>(une piste plus haute est au-dessus ; glissez aussi le bloc vers le haut ou le bas sur la timeline)</small><span class="inline"><button type="button" class="mini" data-a="trkup">↑ Monter d’une piste</button><button type="button" class="mini" data-a="trkdn">↓ Descendre d’une piste</button>${e.type === 'video' ? '<button type="button" class="mini" data-a="tomain">Mettre sur la piste principale</button>' : ''}</span></div>
${e.type === 'subs' ? cuesHtml() : ''}
<span class="inline"><button type="button" class="mini" data-a="dup">Dupliquer</button><button type="button" class="mini" data-a="del">Supprimer</button></span>`;
      if (e.type === 'subs') bindCues(e);
    } else if (c) {
      const r = c.reframe?.[S.fmt] || {}, d = srcDur(c);
      props.innerHTML = `<h3>Clip · ${esc(INFOS[c.asset]?.name || '')}</h3>
<small>${INFOS[c.asset] ? `${INFOS[c.asset].w}×${INFOS[c.asset].h} · ${r1(d)} s · ${INFOS[c.asset].hasAudio ? 'avec son' : 'sans son'}` : ''}</small>
<div class="pgroup"><b>Extrait de la vidéo source</b>${num('in', 'Début (s)', r1(c.in))}${num('out', 'Fin (s)', r1(c.out || 0), '0 = jusqu’à la fin de la vidéo')}</div>
<div class="pgroup"><b>Cadrage <small>(${esc(f.label)})</small></b>${slider('posx', 'Horizontal', 0, 100, 1, r.posx ?? 50)}${slider('posy', 'Vertical', 0, 100, 1, r.posy ?? 50)}${slider('zoom', 'Zoom', 100, 300, 1, r.zoom ?? 100)}</div>
<span class="inline"><button type="button" class="mini" data-a="split">✂ Scinder au curseur</button><button type="button" class="mini" data-a="toover">Superposer (nouvelle piste)</button><button type="button" class="mini" data-a="del">Supprimer le clip</button></span>`;
    } else {
      props.innerHTML = `<h3>Film</h3>
<small>${S.tl.clips.length} clip(s) · ${r1(total())} s${S.endcard.on ? ` + écran de fin ${S.endcard.seconds} s` : ''}. Cliquez sur un clip ou un élément de la timeline, ou directement sur l’aperçu, pour le régler.</small>
<div class="pgroup"><b>Formats à exporter</b>${Object.entries(FM).map(([k, ff]) => `<label class="check"><input type="checkbox" data-k="fmtchk" data-fmt="${k}"${S.formats.includes(k) ? ' checked' : ''}> ${esc(ff.label)} <small>${ff.w}×${ff.h}</small></label>`).join('')}</div>
<div class="pgroup"><b>Écran de fin</b><label class="check"><input type="checkbox" data-k="endon"${S.endcard.on ? ' checked' : ''}> Ajouter l’affiche du format à la fin</label>${slider('endsec', 'Durée (s)', 1, 10, 1, S.endcard.seconds || 3)}</div>`;
    }
  }
  // lignes de sous-titres d'un bloc (temps de la timeline) : chaque bloc a les siennes, avec sa propre position et son propre style
  const cuesHtml = () => `<div class="pgroup"><b>Lignes de ce bloc</b> <small>(temps de la timeline)</small><div id="v_cues" class="cues"></div><span class="inline"><button type="button" class="mini" id="v_addcue">+ Ajouter une ligne au curseur</button><a href="/edition/${edition}/video/subs.srt${location.search}">Télécharger .srt</a></span><small>« ✂ » coupe une ligne en deux au curseur. Pour séparer le bloc lui-même (position ou style différents), utilisez « Scinder au curseur » sous la timeline.</small></div>`;
  function bindCues(e) {
    e.cues = e.cues || [];
    const box = $('v_cues');
    const draw = () => {
      box.innerHTML = e.cues.length ? '' : '<small>Aucune ligne : ajoutez-en une ou importez un fichier SRT/VTT (plus bas).</small>';
      e.cues.forEach((c, i) => {
        const row = document.createElement('div'); row.className = 'cue';
        row.innerHTML = '<input type="number" step="0.1" min="0" class="cs" title="Début (s)"><input type="number" step="0.1" min="0" class="ce" title="Fin (s)"><button type="button" class="mini go" title="Aller à cette ligne">⏵</button><button type="button" class="mini cut" title="Couper cette ligne en deux à la position du curseur">✂</button><button type="button" class="mini del" title="Supprimer cette ligne">✕</button><textarea rows="2"></textarea>';
        const [cs, ce] = row.querySelectorAll('input'), ta = row.querySelector('textarea');
        cs.value = c.start; ce.value = c.end; ta.value = c.text;
        cs.addEventListener('input', () => { c.start = Number(cs.value); touch(); updateAll(); });
        ce.addEventListener('input', () => { c.end = Number(ce.value); touch(); updateAll(); });
        ta.addEventListener('input', () => { c.text = ta.value; touch(); updateAll(); });
        row.querySelector('.go').addEventListener('click', () => showAt(c.start));
        row.querySelector('.cut').addEventListener('click', () => {
          const t = r1(S.t);
          if (t <= c.start + 0.1 || t >= c.end - 0.1) { alert('Placez la tête de lecture à l’intérieur de cette ligne (à plus de 0,1 s de ses bords) pour la couper.'); return; }
          e.cues.splice(i + 1, 0, { start: t, end: c.end, text: c.text }); c.end = t; touch(); draw(); updateAll();
        });
        row.querySelector('.del').addEventListener('click', () => { e.cues.splice(i, 1); touch(); draw(); updateAll(); renderTimeline(); });
        box.append(row);
      });
    };
    draw();
    $('v_addcue').addEventListener('click', () => { const t = r1(S.t); e.cues.push({ start: t, end: r1(t + 2), text: 'Nouveau sous-titre' }); e.cues.sort((x, y) => x.start - y.start); touch(); draw(); updateAll(); renderTimeline(); });
  }
  // met à jour les valeurs affichées (position, taille…) sans reconstruire le panneau (le champ en cours de saisie garde le focus)
  function refreshValues() {
    const e = curEl(); if (!e) return;
    const p = posOf(e), vals = { x: p.x, y: p.y, s: e.s, rot: e.rot || 0, op: e.op ?? 100, vol: e.vol ?? 100, start: r1(e.start || 0), end: r1(e.end || 0) };
    props.querySelectorAll('[data-k]').forEach((x) => { if (x !== document.activeElement && x.dataset.k in vals) x.value = vals[x.dataset.k]; });
  }
  function setPos(e, x, y) { e.pos = { ...(e.pos || {}), [S.fmt]: { x: Math.round(x), y: Math.round(y) } }; }
  function applyEl(e, k, v) {
    if (k === 'x') setPos(e, v, posOf(e).y);
    else if (k === 'y') setPos(e, posOf(e).x, v);
    else if (k === 'end') e.end = v > 0 ? r1(v) : 0;
    else if (k === 'start') e.start = r1(Math.max(0, v));
    else if (k === 'asset') { e.asset = String(v); renderLayer(); }
    else if (k === 'in') e.in = r1(clamp(v, 0, Math.max(0, srcDur(e) - 0.2)));
    else if (k === 'out') e.out = v > (e.in || 0) ? r1(v) : 0;
    else e[k] = v;
    touch(); styleLayer(); updateSel(); if (['start', 'end', 'text', 'asset', 'in', 'out'].includes(k)) renderTimeline();
    refreshValues();
  }
  function applyClip(c, k, v) {
    if (k === 'in') c.in = r1(clamp(v, 0, Math.max(0, srcDur(c) - 0.2)));
    else if (k === 'out') c.out = v > c.in ? r1(v) : 0;
    else c.reframe = { ...(c.reframe || {}), [S.fmt]: { posx: 50, posy: 50, zoom: 100, ...(c.reframe?.[S.fmt] || {}), [k]: v } };
    touch(); renderTimeline(); showAt(S.t);
  }
  props.addEventListener('input', (ev) => {
    const t = ev.target, k = t.dataset.k; if (!k) return;
    const v = t.type === 'checkbox' ? t.checked : (t.type === 'number' || t.type === 'range') ? Number(t.value) : t.value;
    if (t.type !== 'checkbox') props.querySelectorAll(`[data-k="${k}"]`).forEach((x) => { if (x !== t && x.type !== 'checkbox') x.value = t.value; });
    const e = curEl(), c = curClip();
    if (e) applyEl(e, k, v);
    else if (c) applyClip(c, k, v);
    else if (k === 'fmtchk') { S.formats = [...props.querySelectorAll('[data-k="fmtchk"]:checked')].map((x) => x.dataset.fmt); touch(); }
    else if (k === 'endon') { S.endcard.on = v; touch(); }
    else if (k === 'endsec') { S.endcard.seconds = v; touch(); }
  });
  props.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const e = curEl(), f = F(), a = b.dataset.a;
    if (a === 'split') split();
    else if (a === 'del') removeSel();
    else if (a === 'toover' && curClip()) toOver(curClip());
    else if (e && a === 'tomain') toMain(e);
    else if (e && (a === 'trkup' || a === 'trkdn')) { moveTrack(e, a === 'trkup' ? 1 : -1); touch(); renderLayer(); renderTimeline(); renderProps(); }
    else if (e && a === 'cx') { setPos(e, f.w / 2, posOf(e).y); touch(); styleLayer(); updateSel(); refreshValues(); }
    else if (e && a === 'cy') { setPos(e, posOf(e).x, f.h / 2); touch(); styleLayer(); updateSel(); refreshValues(); }
    else if (e && a === 'home') { if (e.pos) delete e.pos[S.fmt]; touch(); styleLayer(); updateSel(); refreshValues(); }
    else if (e && a === 'dup') {
      const d = { ...JSON.parse(JSON.stringify(e)), id: uid('e') };
      d.fx = Math.min(1, (d.fx ?? 0.5) + 0.04);
      for (const kk of Object.keys(d.pos || {})) d.pos[kk] = { x: d.pos[kk].x + 30, y: d.pos[kk].y + 30 };
      S.tl.els.push(d); placeOnTrack(d, d.track); normalizeTracks(); touch(); renderLayer(); select({ kind: 'el', id: d.id });
    }
  });

  // ---------- aperçu : glisser, redimensionner, tourner (autour du centre)
  let pd = null;
  const screenCenter = (e) => { const r = frame.getBoundingClientRect(), k = r.width / F().w, p = posOf(e); return { x: r.left + p.x * k, y: r.top + p.y * k, k }; };
  frame.addEventListener('pointerdown', (ev) => {
    const h = ev.target.closest('[data-h]'), n = ev.target.closest('.vel');
    let e = null;
    if (h) e = curEl();
    else if (n) { e = byId(n.dataset.id); select({ kind: 'el', id: e.id }); }
    else { const k = clipAt(S.t); select(k ? { kind: 'clip', id: k.c.id } : null); return; }
    if (!e) return;
    const c = screenCenter(e), dist = Math.hypot(ev.clientX - c.x, ev.clientY - c.y), ang = Math.atan2(ev.clientY - c.y, ev.clientX - c.x);
    pd = { mode: h ? h.dataset.h : 'move', e, x0: ev.clientX, y0: ev.clientY, p0: { ...posOf(e) }, s0: e.s, rot0: e.rot || 0, d0: dist || 1, a0: ang, c };
    try { frame.setPointerCapture(ev.pointerId); } catch { /* pointeur simulé */ }
    ev.preventDefault();
  });
  frame.addEventListener('pointermove', (ev) => {
    if (!pd) return;
    const e = pd.e, f = F();
    if (pd.mode === 'move') { const k = pd.c.k; setPos(e, clamp(pd.p0.x + (ev.clientX - pd.x0) / k, -f.w / 2, f.w * 1.5), clamp(pd.p0.y + (ev.clientY - pd.y0) / k, -f.h / 2, f.h * 1.5)); }
    else if (pd.mode === 'scale') e.s = Math.round(clamp(pd.s0 * Math.hypot(ev.clientX - pd.c.x, ev.clientY - pd.c.y) / pd.d0, 5, 400));
    else { let r = pd.rot0 + (Math.atan2(ev.clientY - pd.c.y, ev.clientX - pd.c.x) - pd.a0) * 180 / Math.PI; r = ((r + 540) % 360) - 180; if (ev.shiftKey) r = Math.round(r / 15) * 15; e.rot = Math.round(r); }
    styleLayer(); updateSel(); refreshValues();
  });
  const endPd = () => { if (pd) { touch(); pd = null; } };
  frame.addEventListener('pointerup', endPd); frame.addEventListener('pointercancel', endPd);
  frame.addEventListener('dblclick', (ev) => { const n = ev.target.closest('.vel'); if (n && byId(n.dataset.id)?.type === 'text') props.querySelector('textarea')?.focus(); });

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ['z', 'y'].includes(ev.key.toLowerCase())) { // Ctrl+Z annuler · Ctrl+Y ou Ctrl+Maj+Z rétablir (dans un champ texte, c'est le navigateur qui annule la frappe)
      if (ev.target.tagName === 'TEXTAREA' || (ev.target.tagName === 'INPUT' && ev.target.type === 'text')) return;
      ev.preventDefault(); (ev.key.toLowerCase() === 'y' || ev.shiftKey) ? redo() : undo(); return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable) return;
    const e = curEl(), st = ev.shiftKey ? 10 : 1;
    if (ev.key === ' ') { ev.preventDefault(); S.playing ? pause() : play(); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { if (S.sel) { ev.preventDefault(); removeSel(); } }
    else if (ev.key === 'Escape') select(null);
    else if (e && ev.key.startsWith('Arrow')) {
      ev.preventDefault(); const p = posOf(e);
      setPos(e, p.x + ({ ArrowLeft: -st, ArrowRight: st }[ev.key] || 0), p.y + ({ ArrowUp: -st, ArrowDown: st }[ev.key] || 0));
      touch(); styleLayer(); updateSel(); refreshValues();
    }
  });

  // ---------- format affiché, zones de sécurité
  document.querySelectorAll('#v_fmtTabs a').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault(); S.fmt = a.dataset.fmt;
    document.querySelectorAll('#v_fmtTabs a').forEach((x) => x.classList.toggle('on', x === a));
    fit(); showAt(S.t); renderProps();
  }));
  $('v_guides').addEventListener('change', fit);

  // ---------- suivi des exports
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

  guard = AtelierGuard.install({ form, label: $('vdirty'), isDirty: () => S.dirty, markClean: () => { S.dirty = false; } });
  window.addEventListener('resize', () => { fit(); updateSel(); });

  // ---------- démarrage
  document.querySelector(`#v_fmtTabs a[data-fmt="${S.fmt}"]`)?.classList.add('on');
  S.tl.els.forEach((e, i) => { if (e.track == null) e.track = i + 1; }); normalizeTracks();
  sync(); commit();
  fit(); renderLayer(); renderTimeline(); renderProps(); showAt(0); poll();
  S.winOf = winOf; window.__video = S; // lecture seule pour les tests
})();
