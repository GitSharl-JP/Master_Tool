// Relevé de géométrie pour l'export SVG (exécuté par Edge en mode « dump-dom », jamais dans l'interface).
// Principe : on retire les décalages/échelles propres à chaque élément pour mesurer sa mise en page « naturelle »,
// puis on les restitue comme transformations SVG. Les lignes de texte sont relevées une à une (texte vivant).
(() => {
  const run = () => {
  const P = document.querySelector('.p');
  const W = Number(P.dataset.w), H = Number(P.dataset.h);
  const ctx = document.createElement('canvas').getContext('2d');
  const hex = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return { c: '#000000', a: 1 }; const p = m[1].split(',').map(Number); return { c: '#' + p.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join(''), a: p.length > 3 ? p[3] : 1 }; };
  const els = [...P.querySelectorAll('[data-el]')];

  // 1. mémoriser puis neutraliser translate / scale (et la rotation du bandeau)
  const saved = els.map((e) => ({ e, tr: e.style.translate, sc: e.style.scale, t: e.style.transform }));
  const rot = new Map();
  for (const e of els) {
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(e).transform);
    if (m) { const v = m[1].split(',').map(Number); const a = Math.round(Math.atan2(v[1], v[0]) * 1800 / Math.PI) / 10; if (a) { rot.set(e, a); e.style.transform = 'translate(-50%,-50%)'; } }
    e.style.translate = 'none'; e.style.scale = 'none';
  }

  // 2. mesure
  const out = { W, H, bg: null, els: [] };
  const bg = P.querySelector('.bg');
  if (bg.tagName === 'IMG') {
    const nw = bg.naturalWidth, nh = bg.naturalHeight, px = Number(bg.dataset.px), py = Number(bg.dataset.py), z = Number(bg.dataset.z) / 100;
    const k = Math.max(W / nw, H / nh), iw = nw * k, ih = nh * k, ox = (W - iw) * px / 100, oy = (H - ih) * py / 100;
    const Ox = W * px / 100, Oy = H * py / 100;
    out.bg = { slot: 'hero', x: Ox + (ox - Ox) * z, y: Oy + (oy - Oy) * z, w: iw * z, h: ih * z };
    // recadrage réel aux bords du format (pas de détourage : Illustrator le perd) ; résolution source conservée
    const b = out.bg, vx = Math.max(0, b.x), vy = Math.max(0, b.y), vr = Math.min(W, b.x + b.w), vb = Math.min(H, b.y + b.h);
    if (vr > vx && vb > vy) {
      const sx = (vx - b.x) / b.w * nw, sy = (vy - b.y) / b.h * nh, sw = (vr - vx) / b.w * nw, sh = (vb - vy) / b.h * nh;
      try {
        const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(sw)); cv.height = Math.max(1, Math.round(sh));
        cv.getContext('2d').drawImage(bg, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
        b.crop = { x: vx, y: vy, w: vr - vx, h: vb - vy, src: cv.toDataURL('image/jpeg', 0.94) };
      } catch (e) { b.crop = null; }
    }
  } else out.bg = { placeholder: true };

  const rectOf = (e) => { const r = e.getBoundingClientRect(), p = P.getBoundingClientRect(); return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height }; };
  const runsOf = (el) => {
    const lines = [];
    const walk = (node) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 1) { if (ch.hasAttribute('data-el')) continue; if (ch.tagName === 'BR') { lines.push({ br: true }); continue; } walk(ch); } else if (ch.nodeType === 3 && ch.textContent.trim() !== '') {
          const cs = getComputedStyle(ch.parentElement);
          const text = ch.textContent;
          let cur = null;
          for (let i = 0; i < text.length; i++) {
            const r = document.createRange(); r.setStart(ch, i); r.setEnd(ch, i + 1);
            const b = r.getClientRects()[0];
            if (!b || b.width === 0) { if (cur && /\s/.test(text[i])) cur.pending = true; continue; }
            const p = P.getBoundingClientRect();
            const top = b.top - p.top, left = b.left - p.left;
            if (!cur || Math.abs(top - cur.top) > cs.fontSize.replace('px', '') * 0.5) { cur = { top, x: left, text: '', node: ch.parentElement }; lines.push(cur); }
            if (cur.pending) { cur.text += ' '; cur.pending = false; }
            cur.text += text[i];
          }
        }
      }
    };
    walk(el);
    return lines.filter((l) => !l.br).map((l) => {
      const cs = getComputedStyle(l.node);
      const size = parseFloat(cs.fontSize);
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      const asc = ctx.measureText('Hg').fontBoundingBoxAscent;
      const col = hex(cs.color);
      return {
        text: cs.textTransform === 'uppercase' ? l.text.toUpperCase() : l.text, x: l.x, y: l.top + asc,
        family: cs.fontFamily, size, weight: cs.fontWeight, style: cs.fontStyle, color: col.c, alpha: col.a,
        ls: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
      };
    });
  };
  const visual = (e) => {
    const cs = getComputedStyle(e), bgc = hex(cs.backgroundColor), bw = parseFloat(cs.borderTopWidth) || 0;
    if (bgc.a === 0 && !bw) return null;
    return { fill: bgc.a ? bgc.c : null, fillAlpha: bgc.a, stroke: bw ? hex(cs.borderTopColor).c : null, strokeW: bw, rx: parseFloat(cs.borderTopLeftRadius) || 0 };
  };
  const build = (e) => {
    const cs = getComputedStyle(e), r = rectOf(e), o = cs.transformOrigin.split(' ').map(parseFloat);
    const node = {
      id: e.dataset.el, dx: Number(e.dataset.dx), dy: Number(e.dataset.dy), s: Number(e.dataset.s) / 100,
      ox: r.x + o[0], oy: r.y + o[1], rot: rot.get(e) || 0, rect: r, opacity: Number(cs.opacity),
      box: visual(e), img: e.tagName === 'IMG' ? { slot: e.dataset.slot } : null, text: e.tagName === 'IMG' ? [] : runsOf(e), kids: [],
    };
    for (const k of e.children) if (k.hasAttribute && k.hasAttribute('data-el')) node.kids.push(build(k));
    for (const k of e.querySelectorAll(':scope > img[data-slot]')) if (!k.hasAttribute('data-el')) node.kids.push({ id: k.dataset.slot, dx: 0, dy: 0, s: 1, ox: 0, oy: 0, rot: 0, rect: rectOf(k), opacity: 1, box: null, img: { slot: k.dataset.slot }, text: [], kids: [] });
    return node;
  };
  for (const e of els) if (!e.parentElement.closest('[data-el]')) out.els.push(build(e));

  // 3. restituer l'état d'origine et publier le relevé (sans les images, pour garder un document léger)
  for (const s of saved) { s.e.style.translate = s.tr; s.e.style.scale = s.sc; s.e.style.transform = s.t; }
  for (const i of P.querySelectorAll('img')) i.removeAttribute('src');
  const pre = document.createElement('script');
  pre.type = 'application/json'; pre.id = '__geo'; pre.textContent = JSON.stringify(out);
  document.body.append(pre);
  };
  if (document.readyState === 'complete') run(); else window.addEventListener('load', run);
})();
