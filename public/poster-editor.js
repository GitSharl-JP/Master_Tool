// Édition directe de l'affiche (chargé uniquement dans l'aperçu, jamais dans l'export).
// Clic = sélectionner · glisser = déplacer · poignée = taille · double-clic = texte
// flèches = ajuster (Maj = ×10) · Suppr = masquer · glisser dans le vide = recadrer la photo · molette = zoom photo
(() => {
  const root = document.querySelector('.p');
  const W = Number(root.dataset.w), H = Number(root.dataset.h);
  const ORIGIN = location.origin;
  const send = (m) => parent.postMessage(m, ORIGIN);
  const css = document.createElement('style');
  css.textContent = `[data-el]{cursor:move}[data-el][contenteditable]{cursor:text;outline:3px solid #2f80ff!important}
#selbox{position:fixed;border:3px dashed #2f80ff;pointer-events:none;z-index:50;display:none}
#selhandle{position:fixed;width:34px;height:34px;background:#2f80ff;border:4px solid #fff;border-radius:50%;z-index:51;cursor:nwse-resize;display:none}
.hov{outline:2px dashed rgba(47,128,255,.55)}`;
  document.head.append(css);
  const box = Object.assign(document.createElement('div'), { id: 'selbox' });
  const handle = Object.assign(document.createElement('div'), { id: 'selhandle' });
  document.body.append(box, handle);

  let sel = null;
  const val = (el) => ({ dx: Number(el.dataset.dx), dy: Number(el.dataset.dy), s: Number(el.dataset.s) });
  const apply = (el, v) => {
    el.dataset.dx = Math.round(v.dx); el.dataset.dy = Math.round(v.dy); el.dataset.s = Math.round(v.s);
    el.style.translate = v.dx || v.dy ? `${Math.round(v.dx)}px ${Math.round(v.dy)}px` : '';
    el.style.scale = v.s !== 100 ? String(v.s / 100) : '';
    place();
  };
  const place = () => {
    if (!sel) { box.style.display = handle.style.display = 'none'; return; }
    const r = sel.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' });
    Object.assign(handle.style, { display: 'block', left: r.right - 17 + 'px', top: r.bottom - 17 + 'px' });
  };
  const select = (el, notify = true) => {
    sel = el; place();
    if (notify) send({ type: 'select', id: el ? el.dataset.el : null, ...(el ? { ...val(el), text: el.innerText } : {}) });
  };
  const emit = () => sel && send({ type: 'els', id: sel.dataset.el, ...val(sel) });
  const target = (e) => e.target.closest && e.target.closest('[data-el]');

  // --- glisser / sélectionner
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.target === handle) {
      const r = sel.getBoundingClientRect();
      drag = { mode: 'scale', x: e.clientX, w: r.width, v: val(sel) };
    } else {
      const el = target(e);
      if (el && el.isContentEditable) return;
      if (el) { select(el); drag = { mode: 'move', x: e.clientX, y: e.clientY, v: val(el), el }; }
      else {
        select(null);
        const img = document.querySelector('.bg');
        drag = { mode: 'bg', x: e.clientX, y: e.clientY, bg: { ...window.__bg } };
        if (!img) drag = null;
      }
    }
    if (drag) { document.setPointerCapture?.(e.pointerId); e.preventDefault(); }
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.mode === 'move') apply(drag.el, { ...drag.v, dx: drag.v.dx + (e.clientX - drag.x), dy: drag.v.dy + (e.clientY - drag.y) });
    else if (drag.mode === 'scale') apply(sel, { ...drag.v, s: Math.min(400, Math.max(20, drag.v.s * (1 + (e.clientX - drag.x) / drag.w))) });
    else if (drag.mode === 'bg') {
      const img = document.querySelector('img.bg');
      if (!img || !img.naturalWidth) return;
      // Débord de l'image (couverture + zoom) : sans débord, il n'y a rien à déplacer dans ce sens.
      const z = drag.bg.zoom / 100, k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const ox = img.naturalWidth * k * z - W, oy = img.naturalHeight * k * z - H;
      const pan = (p, delta, over) => (over > 2 ? Math.min(100, Math.max(0, p - (delta / over) * 100)) : p);
      const posx = pan(drag.bg.posx, e.clientX - drag.x, ox);
      const posy = pan(drag.bg.posy, e.clientY - drag.y, oy);
      setBg({ posx, posy, zoom: drag.bg.zoom });
    }
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.mode === 'bg') send({ type: 'bg', ...window.__bg }); else emit();
    drag = null;
  });

  // --- photo de fond : recadrage et zoom
  const bgEl = document.querySelector('.bg');
  window.__bg = bgEl ? { posx: Number(bgEl.dataset.px), posy: Number(bgEl.dataset.py), zoom: Number(bgEl.dataset.z) } : { posx: 50, posy: 50, zoom: 100 };
  function setBg(v) {
    window.__bg = v;
    if (!bgEl) return;
    bgEl.style.objectPosition = `${v.posx}% ${v.posy}%`;
    bgEl.style.transformOrigin = `${v.posx}% ${v.posy}%`;
    bgEl.style.transform = `scale(${v.zoom / 100})`;
  }
  document.addEventListener('wheel', (e) => {
    if (!bgEl || target(e)) return;
    e.preventDefault();
    const z = Math.min(250, Math.max(100, window.__bg.zoom - Math.sign(e.deltaY) * 5));
    setBg({ ...window.__bg, zoom: z });
    clearTimeout(setBg.t); setBg.t = setTimeout(() => send({ type: 'bg', ...window.__bg }), 150);
  }, { passive: false });

  // --- texte en place
  document.addEventListener('dblclick', (e) => {
    const el = target(e);
    if (!el || el.tagName === 'IMG' || el.dataset.el === 'partners' || el.dataset.el === 'band') return;
    el.contentEditable = 'plaintext-only';
    el.focus();
    getSelection().selectAllChildren(el);
    const done = () => {
      el.removeEventListener('blur', done);
      el.removeAttribute('contenteditable');
      send({ type: 'text', id: el.dataset.el, text: el.innerText.trim() });
      place();
    };
    el.addEventListener('blur', done);
    el.addEventListener('keydown', (k) => { if (k.key === 'Escape') el.blur(); });
  });

  // --- clavier
  document.addEventListener('keydown', (e) => {
    if (!sel || sel.isContentEditable) return;
    const step = e.shiftKey ? 10 : 1, v = val(sel);
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { e.preventDefault(); apply(sel, { ...v, dx: v.dx + mv[0], dy: v.dy + mv[1] }); clearTimeout(emit.t); emit.t = setTimeout(emit, 200); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); send({ type: 'hide', id: sel.dataset.el }); }
    else if (e.key === 'Escape') select(null);
  });

  // --- survol + messages du panneau
  document.addEventListener('pointerover', (e) => { const el = target(e); document.querySelectorAll('.hov').forEach((x) => x.classList.remove('hov')); if (el && !drag) el.classList.add('hov'); });
  window.addEventListener('message', (e) => {
    if (e.origin !== ORIGIN || e.source !== parent) return;
    const m = e.data || {};
    if (m.type === 'select') { const el = m.id && document.querySelector(`[data-el="${m.id}"]`); select(el || null, false); if (el) send({ type: 'select', id: m.id, ...val(el), text: el.innerText }); }
    if (m.type === 'apply') {
      const el = document.querySelector(`[data-el="${m.id}"]`);
      if (!el) return;
      apply(el, { dx: m.dx, dy: m.dy, s: m.s });
      if (m.color !== undefined) { if (m.color) { el.style.setProperty('--oc', m.color); el.dataset.oc = '1'; } else { el.style.removeProperty('--oc'); delete el.dataset.oc; } }
    }
    if (m.type === 'bg') setBg(m);
  });
  window.addEventListener('resize', place);
  send({ type: 'ready', present: [...document.querySelectorAll('[data-el]')].map((x) => x.dataset.el) });
})();
