/* ==========================================================================
   PACK JAM — 3D stage, input, juice, boosters, win/fail flow.
   ========================================================================== */
(function () {
  'use strict';
  const E = window.PJ;
  const $ = s => document.querySelector(s);
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- look ---------- */
  const PALETTE = ['#FF4D5A', '#FF8A1F', '#FFC53D', '#5FCB43', '#14BFAE', '#2F7FF0', '#8B5CF6', '#FF5FA8'];
  const GATE_COLORS = ['#F2BA45', '#22AFA3', '#EE5FA0', '#62B84C', '#3B7FE0', '#F0862E'];
  const SOCK_STRIPES = ['#FF4D5A', '#2F7FF0', '#5FCB43', '#FF8A1F', '#8B5CF6', '#14BFAE'];
  const GAP = 0.08, WALL_T = 0.34, WALL_H = 0.42;
  const H_HARD = 0.56, H_SOCK = 0.46, H_CAP = 0.17;
  const OUT = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
  const CHEV_ROT = { left: 0, right: Math.PI, top: -Math.PI / 2, bottom: Math.PI / 2 };
  const BOOSTERS = { undo: 5, vac: 2, shake: 2 };

  const ITEM_NAME = { perfume: 'parfüm', passport: 'pasaport', console: 'konsol', towel: 'havlu', kit: 'ilk yardım', jewelry: 'takı kutusu', organizer: 'organizer', lid: 'şeffaf kapak', joker: 'joker', divider: 'sabit bölme' };
  const ITEM_H = { perfume: 0.5, joker: 0.5, passport: 0.34, console: 0.3, towel: 0.72, kit: 0.52, jewelry: 0.42, organizer: 0.6, divider: 0.435 };
  const ITEM_COLOR = { perfume: '#F0399E', joker: '#F2B93B', passport: '#2C3EAE', console: '#F39434', towel: '#F4A7C3', kit: '#F2695E', jewelry: '#A55BE6', lid: '#DDF3FF', organizer: '#4DBDB7', divider: '#3F4A5C' };
  const itemOf = b => b.sock || b.type === 'sock' ? 'joker' : b.type === 'cap' ? 'lid' : b.fixed ? 'divider' : b.soft ? 'towel' : b.base ? 'jewelry' : (b.item && ITEM_H[b.item] ? b.item : E.itemForShape(b.w, b.h));
  const heightOf = b => ITEM_H[itemOf(b)] || H_HARD;
  const colorOf = b => ITEM_COLOR[itemOf(b)] || '#FFFFFF';
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

  /* ---------- state ---------- */
  const G = {
    idx: 0, level: null, st: null, queue: [], undo: [], boost: Object.assign({}, BOOSTERS),
    moves: 0, boostersUsed: 0, powerUsed: 0, t0: null, screen: 'home', nextId: 5000, mode: 'idle', selected: false, busy: 0, won: false, failOpen: false
  };
  window.__pj = { G, E };

  /* ======================================================================
     AUDIO — synthesized ASMR (no samples to fetch)
     ====================================================================== */
  const sfx = (() => {
    let ctx = null, master = null, noiseBuf = null, muted = false;
    try { muted = localStorage.getItem('pj-muted') === '1'; } catch (e) { /* storage blocked */ }
    function unlock() {
      if (!ctx) {
        try {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ctx.destination);
          noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        } catch (e) { ctx = null; }
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
    }
    function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
    function tone(f, dur, type, vol, fEnd, delay) {
      if (!ctx || muted) return;
      const t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
      env(g, t, 0.005, vol || 0.2, dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.06);
    }
    function noise(dur, ftype, f0, f1, vol, q, delay) {
      if (!ctx || muted) return;
      const t = ctx.currentTime + (delay || 0), s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; f.type = ftype; f.Q.value = q || 0.8; f.frequency.setValueAtTime(f0, t);
      if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      env(g, t, 0.004, vol || 0.2, dur); s.connect(f); f.connect(g); g.connect(master);
      s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.06);
    }
    return {
      unlock,
      get muted() { return muted; },
      setMuted(v) { muted = v; if (master) master.gain.value = v ? 0 : 0.55; try { localStorage.setItem('pj-muted', v ? '1' : '0'); } catch (e) { /* ignore */ } },
      thock(k) { k = k || 1; tone(150 * k, 0.15, 'sine', 0.42, 58); noise(0.06, 'lowpass', 1500, 280, 0.26); },
      click() { tone(1800, 0.025, 'square', 0.045); noise(0.025, 'highpass', 3200, null, 0.1); },
      pick() { tone(520, 0.06, 'sine', 0.1, 760); },
      slide(d) { noise(0.1 + d * 0.035, 'bandpass', 500, 1500, 0.07, 0.7); },
      bump() { tone(105, 0.08, 'sine', 0.2, 70); },
      squish() { noise(0.3, 'bandpass', 1500, 240, 0.32, 2.2); tone(320, 0.24, 'sine', 0.12, 110); },
      whoosh() { noise(0.5, 'bandpass', 2400, 260, 0.3, 1.1); },
      pop() { tone(620, 0.08, 'triangle', 0.16, 980); },
      deny() { tone(230, 0.08, 'square', 0.05); tone(180, 0.12, 'square', 0.05, null, 0.09); },
      snap() { tone(1500, 0.035, 'square', 0.06); tone(880, 0.1, 'sine', 0.2, 1320, 0.02); },
      rattle() { for (let i = 0; i < 8; i++) { tone(100 + Math.random() * 140, 0.06, 'sine', 0.2, 60, i * 0.05); noise(0.04, 'lowpass', 1700, 500, 0.12, 0.8, i * 0.05); } },
      zip(dur) { const n = 30; for (let i = 0; i < n; i++) noise(0.012, 'highpass', 2600, null, 0.2, 1, Math.pow(i / n, 0.85) * dur); },
      thump() { tone(88, 0.32, 'sine', 0.55, 42); noise(0.14, 'lowpass', 900, 140, 0.32); },
      win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.28, 'triangle', 0.2, null, i * 0.11)); },
      fail() { tone(392, 0.18, 'triangle', 0.18, 370); tone(311, 0.3, 'triangle', 0.18, 280, 0.18); },
      undo() { tone(720, 0.07, 'sine', 0.13, 420); },
      star(i) { const f = 660 * Math.pow(1.26, i); tone(f, 0.22, 'triangle', 0.22); tone(f * 2, 0.16, 'sine', 0.08, null, 0.05); noise(0.12, 'highpass', 5000, null, 0.06); },
      coin() { for (let k = 0; k < 4; k++) { tone(1500 + k * 260, 0.06, 'square', 0.035, null, k * 0.07); tone(2600 + k * 200, 0.08, 'sine', 0.05, null, k * 0.07 + 0.02); } }
    };
  })();
  const haptic = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not allowed */ } };

  /* ======================================================================
     THREE SETUP
     ====================================================================== */
  const app = $('#app'), canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 200);

  (function environment() {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), new THREE.MeshBasicMaterial({ color: 0x3c4a5c, side: THREE.BackSide })));
    const panel = (w, h, pos, rot, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k * 1.02), side: THREE.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]); m.rotation.set(rot[0], rot[1], rot[2]); s.add(m);
    };
    panel(12, 6, [0, 6.9, 0], [Math.PI / 2, 0, 0], 2.2);
    panel(8, 4, [-11.9, 3, -2], [0, Math.PI / 2, 0], 1.4);
    panel(8, 3, [11.9, 2, 3], [0, -Math.PI / 2, 0], 0.8);
    panel(10, 3, [0, 2.5, 11.9], [0, Math.PI, 0], 1.0);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(s, 0.04).texture;
    pm.dispose();
  })();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8095ad, 0.45));
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.35);
  sun.position.set(-4.5, 13, 6.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.025;
  scene.add(sun); scene.add(sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.66; ground.receiveShadow = true;
  scene.add(ground);
  const root = new THREE.Group(); scene.add(root);
  window.__pj.renderer = renderer; window.__pj.scene = scene; window.__pj.sun = sun; window.__pj.camera = camera; window.__pj.root = root;
  window.__pj.screenOf = (gx, gy, y) => { const v = new THREE.Vector3(gx - G.st.W / 2, y || 0.3, gy - G.st.H / 2); root.localToWorld(v); v.project(camera); const r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; };

  /* ---------- geometry helpers ---------- */
  const geoCache = new Map();
  function roundedBox(w, h, d, r, seg) {
    seg = seg || 3;
    const key = ['rb', w.toFixed(3), h.toFixed(3), d.toFixed(3), r.toFixed(3), seg].join('|');
    if (geoCache.has(key)) return geoCache.get(key);
    const s = seg * 2 + 1; r = Math.min(w / 2, h / 2, d / 2, r);
    const box = new THREE.BoxGeometry(1, 1, 1, s, s, s), g = box.toNonIndexed(); box.dispose();
    const pos = g.attributes.position.array, nor = g.attributes.normal.array;
    const half = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r), hs = 0.5 / s, p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      p.fromArray(pos, i); n.copy(p);
      n.x -= Math.sign(n.x) * hs; n.y -= Math.sign(n.y) * hs; n.z -= Math.sign(n.z) * hs; n.normalize();
      pos[i] = half.x * Math.sign(p.x) + n.x * r; pos[i + 1] = half.y * Math.sign(p.y) + n.y * r; pos[i + 2] = half.z * Math.sign(p.z) + n.z * r;
      nor[i] = n.x; nor[i + 1] = n.y; nor[i + 2] = n.z;
    }
    g.translate(0, h / 2, 0);
    /* re-project UVs from the final (rounded) positions so printed faces are not
       stretched; face order follows BoxGeometry: +x, -x, +y, -y, +z, -z */
    const uv = g.attributes.uv;
    for (const gr of g.groups) {
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        let u, v;
        switch (gr.materialIndex) {
          case 0: u = (d / 2 - z) / d; v = y / h; break;
          case 1: u = (z + d / 2) / d; v = y / h; break;
          case 2: u = (x + w / 2) / w; v = (d / 2 - z) / d; break;
          case 3: u = (x + w / 2) / w; v = (z + d / 2) / d; break;
          case 4: u = (x + w / 2) / w; v = y / h; break;
          default: u = (w / 2 - x) / w; v = y / h;
        }
        uv.setXY(i, u, v);
      }
    }
    uv.needsUpdate = true;
    g.computeBoundingBox(); g.computeBoundingSphere();
    geoCache.set(key, g);
    return g;
  }
  function studGeo(r, h) {
    const key = 'stud|' + r + '|' + h;
    if (geoCache.has(key)) return geoCache.get(key);
    const pts = [[0, 0], [r, 0], [r, h - 0.024], [r - 0.01, h - 0.006], [r - 0.03, h], [0, h]].map(q => new THREE.Vector2(q[0], q[1]));
    const g = new THREE.LatheGeometry(pts, 22);
    geoCache.set(key, g);
    return g;
  }
  function arrowGeo(len) {
    const key = 'arrow|' + len.toFixed(2);
    if (geoCache.has(key)) return geoCache.get(key);
    const t = 0.12, hw = 0.34, hl = 0.22, L = len / 2, s = new THREE.Shape();
    s.moveTo(-L, 0); s.lineTo(-L + hl, hw / 2); s.lineTo(-L + hl, t / 2); s.lineTo(L - hl, t / 2); s.lineTo(L - hl, hw / 2);
    s.lineTo(L, 0); s.lineTo(L - hl, -hw / 2); s.lineTo(L - hl, -t / 2); s.lineTo(-L + hl, -t / 2); s.lineTo(-L + hl, -hw / 2); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.018, bevelSegments: 2, curveSegments: 1 });
    g.rotateX(-Math.PI / 2); g.translate(0, 0.02, 0);
    geoCache.set(key, g);
    return g;
  }
  const planeCache = new Map();
  function planeGeo(w, h) {
    const key = w.toFixed(3) + 'x' + h.toFixed(3);
    if (!planeCache.has(key)) planeCache.set(key, new THREE.PlaneGeometry(w, h));
    return planeCache.get(key);
  }

  /* ---------- canvas textures ---------- */
  function rrPath(c, x, y, w, h, r) { c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
    draw(c.getContext('2d'), c.width, c.height);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  const texCache = new Map();
  const cachedTex = (key, w, h, draw) => { if (!texCache.has(key)) texCache.set(key, canvasTex(w, h, draw)); return texCache.get(key); };
  const PX = 128;

  /* ---------- travel items: printed surfaces ----------
     Every item is modelled in a landscape frame (long side L along x, short
     side S along z) and rotated when it lies vertically. Surface textures are
     drawn in real units (PXU px per grid cell) and already contain the item's
     colour, so the materials that carry them stay white. */
  const PXU = 160;
  function uTex(key, wu, hu, draw) {
    const W = Math.max(8, Math.round(wu * PXU)), H = Math.max(8, Math.round(hu * PXU));
    return cachedTex(key + '|' + W + 'x' + H, W, H, (c, w, h) => draw(c, w, h, PXU));
  }
  let grainSeed = 7;
  const rnd = () => { grainSeed = (grainSeed * 16807) % 2147483647; return grainSeed / 2147483647; };
  function grain(c, w, h, a, s) {
    const n = Math.round(w * h / (s * s) * 0.45);
    for (let i = 0; i < n; i++) { c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; c.fillRect(rnd() * w, rnd() * h, s, s); }
  }
  function dashed(c, u, color, lw, dash, gap) { c.setLineDash([dash * u, gap * u]); c.lineCap = 'round'; c.lineWidth = lw * u; c.strokeStyle = color; c.stroke(); c.setLineDash([]); }
  function vshade(c, w, h, top, bottom) { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, top); g.addColorStop(1, bottom); c.fillStyle = g; c.fillRect(0, 0, w, h); }
  function hline(c, x0, x1, y, lw, col) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.lineWidth = lw; c.strokeStyle = col; c.stroke(); }
  function vline(c, x, y0, y1, lw, col) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.lineWidth = lw; c.strokeStyle = col; c.stroke(); }
  function dome(c, w, h, hi, lo) {
    const g = c.createRadialGradient(w * 0.4, h * 0.36, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    g.addColorStop(0, hi); g.addColorStop(1, lo); c.fillStyle = g; c.fillRect(0, 0, w, h);
  }

  /* Pasaport cüzdanı — blue leather, gold stitching, globe, boarding pass in a slot */
  function passportTop(L, S) {
    return uTex('passTop', L, S, (c, w, h, u) => {
      c.fillStyle = '#2C3EAE'; c.fillRect(0, 0, w, h);
      dome(c, w, h, 'rgba(130,150,255,0.18)', 'rgba(6,10,60,0.24)');
      grain(c, w, h, 0.05, 2);
      rr(c, 0.1 * u, 0.1 * u, w - 0.2 * u, h - 0.2 * u, 0.15 * u); dashed(c, u, '#EDBE4E', 0.024, 0.06, 0.045);
      const long = w > h * 1.4, gx = long ? w * 0.36 : w / 2, gy = h / 2, R = Math.min(w, h) * 0.25;
      c.strokeStyle = '#EAB847'; c.lineWidth = 0.03 * u; c.lineCap = 'round';
      c.beginPath(); c.arc(gx, gy, R, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.ellipse(gx, gy, R * 0.45, R, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(gx, gy - R); c.lineTo(gx, gy + R); c.stroke();
      for (const k of [-0.52, 0, 0.52]) {
        const hw = R * Math.sqrt(1 - k * k), bow = k * R * 0.14;
        c.beginPath(); c.moveTo(gx - hw, gy + k * R); c.quadraticCurveTo(gx, gy + k * R + bow, gx + hw, gy + k * R); c.stroke();
      }
      if (!long) return;
      const sx = w * 0.66, cw = 0.38 * u, ch = h * 0.5, cy = gy - ch / 2;
      c.fillStyle = 'rgba(0,0,30,0.35)'; rr(c, sx + 0.025 * u, cy + 0.03 * u, cw, ch, 0.04 * u); c.fill();
      c.fillStyle = '#FFFFFF'; rr(c, sx, cy, cw, ch, 0.04 * u); c.fill();
      c.fillStyle = '#2F9BEA'; c.fillRect(sx + cw - 0.09 * u, cy, 0.09 * u, ch);
      c.save(); c.translate(sx + cw - 0.045 * u, gy); c.fillStyle = '#FFFFFF';
      c.beginPath(); c.moveTo(0, -0.05 * u); c.lineTo(0.012 * u, -0.012 * u); c.lineTo(0.035 * u, 0); c.lineTo(0.012 * u, 0.012 * u); c.lineTo(0, 0.05 * u); c.lineTo(-0.012 * u, 0.012 * u); c.lineTo(-0.03 * u, 0.006 * u); c.lineTo(-0.03 * u, -0.006 * u); c.lineTo(-0.012 * u, -0.012 * u); c.closePath(); c.fill(); c.restore();
      c.fillStyle = '#1B2140';
      for (let y = cy + 0.06 * u; y < cy + ch * 0.62; y += 0.016 * u) c.fillRect(sx + 0.045 * u, y, 0.07 * u, rnd() < 0.4 ? 0.01 * u : 0.005 * u);
      c.fillStyle = 'rgba(40,50,80,0.55)';
      for (let k = 0; k < 4; k++) c.fillRect(sx + 0.15 * u + k * 0.035 * u, cy + 0.06 * u, 0.012 * u, ch * (0.35 + 0.12 * (k % 2)));
      c.fillStyle = '#2F9BEA'; c.fillRect(sx + 0.15 * u, cy + ch - 0.12 * u, 0.1 * u, 0.012 * u);
      c.strokeStyle = 'rgba(5,8,40,0.75)'; c.lineWidth = 0.035 * u; c.lineCap = 'round';
      c.beginPath(); c.moveTo(sx - 0.005 * u, cy - 0.06 * u); c.lineTo(sx - 0.005 * u, cy + ch + 0.06 * u); c.stroke();
    });
  }
  function passportSide(len, hgt) {
    return uTex('passSide', len, hgt, (c, w, h, u) => {
      vshade(c, w, h, '#2E40B0', '#1D2C86'); grain(c, w, h, 0.05, 2);
      c.beginPath(); c.moveTo(0.04 * u, h * 0.62); c.lineTo(w - 0.04 * u, h * 0.62); dashed(c, u, '#E9B84A', 0.022, 0.06, 0.045);
    });
  }

  /* El konsolu — orange shell, ridged grips; screen, d-pad and buttons are meshes */
  function consoleTop(L, S) {
    return uTex('consTop', L, S, (c, w, h, u) => {
      c.fillStyle = '#F39434'; c.fillRect(0, 0, w, h);
      dome(c, w, h, 'rgba(255,220,160,0.22)', 'rgba(150,60,0,0.16)');
      for (const end of [0, 1]) for (let i = 0; i < 5; i++) {
        const x = end ? w - (0.08 + i * 0.07) * u : (0.08 + i * 0.07) * u;
        vline(c, x, 0.06 * u, h - 0.06 * u, 0.024 * u, '#C9661E');
        vline(c, x + (end ? -1 : 1) * 0.016 * u, 0.06 * u, h - 0.06 * u, 0.012 * u, 'rgba(255,205,140,0.85)');
      }
      c.strokeStyle = 'rgba(190,90,20,0.55)'; c.lineWidth = 0.016 * u;
      const px = 0.48 * u;
      c.beginPath(); c.moveTo(px, 0.07 * u); c.bezierCurveTo(px + 0.16 * u, 0.07 * u, px + 0.1 * u, h * 0.3, px + 0.26 * u, h * 0.3);
      c.lineTo(w - px - 0.26 * u, h * 0.3); c.bezierCurveTo(w - px - 0.1 * u, h * 0.3, w - px - 0.16 * u, 0.07 * u, w - px, 0.07 * u); c.stroke();
      c.fillStyle = '#C9661E';
      rr(c, w * 0.5 - 0.62 * u, h - 0.17 * u, 0.09 * u, 0.035 * u, 0.017 * u); c.fill();
      rr(c, w * 0.5 + 0.53 * u, h - 0.17 * u, 0.09 * u, 0.035 * u, 0.017 * u); c.fill();
    });
  }
  function consoleSide(len, hgt, isEnd) {
    return uTex('consSide' + (isEnd ? 'E' : 'L'), len, hgt, (c, w, h, u) => {
      vshade(c, w, h, '#F6993A', '#D9741F');
      hline(c, 0, w, h * 0.5, 0.012 * u, 'rgba(160,70,10,0.6)');
      if (isEnd) { for (let i = 1; i <= 3; i++) hline(c, 0.08 * u, w - 0.08 * u, h * i / 4, 0.02 * u, 'rgba(170,80,15,0.55)'); return; }
      for (const end of [0, 1]) for (let i = 0; i < 5; i++) {
        const x = end ? w - (0.08 + i * 0.07) * u : (0.08 + i * 0.07) * u;
        vline(c, x, 0, h, 0.022 * u, '#C9661E');
      }
    });
  }

  /* İlk yardım çantası — coral case, white stitching, white disc with a red cross */
  function kitTop(L, S) {
    return uTex('kitTop', L, S, (c, w, h, u) => {
      c.fillStyle = '#F2695E'; c.fillRect(0, 0, w, h);
      dome(c, w, h, 'rgba(255,200,190,0.35)', 'rgba(150,20,20,0.18)');
      rr(c, 0.2 * u, 0.2 * u, w - 0.4 * u, h - 0.4 * u, 0.2 * u); dashed(c, u, 'rgba(255,255,255,0.95)', 0.022, 0.07, 0.055);
      const cx = w / 2, cy = h / 2, R = 0.37 * u;
      c.fillStyle = 'rgba(120,20,20,0.18)'; c.beginPath(); c.arc(cx + 0.015 * u, cy + 0.02 * u, R, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
      const a = 0.26 * u, t = 0.09 * u;
      c.fillStyle = '#E2262E'; rr(c, cx - a, cy - t, a * 2, t * 2, 0.02 * u); c.fill(); rr(c, cx - t, cy - a, t * 2, a * 2, 0.02 * u); c.fill();
    });
  }
  function kitSide(len, hgt) {
    return uTex('kitSide', len, hgt, (c, w, h, u) => {
      vshade(c, w, h, '#F06A5F', '#C94C42');
      hline(c, 0, w, h * 0.43, 0.026 * u, 'rgba(120,25,20,0.55)');
      hline(c, 0, w, h * 0.43 + 0.022 * u, 0.012 * u, 'rgba(255,170,160,0.75)');
    });
  }

  /* Organizer — teal fabric, black zip trim with stitching, dark mesh window */
  function organizerTop(L, S) {
    return uTex('orgTop', L, S, (c, w, h, u) => {
      c.fillStyle = '#4DBDB7'; c.fillRect(0, 0, w, h); grain(c, w, h, 0.06, 2);
      c.fillStyle = '#1D2125'; rr(c, 0.07 * u, 0.07 * u, w - 0.14 * u, h - 0.14 * u, 0.32 * u); c.fill();
      rr(c, 0.15 * u, 0.15 * u, w - 0.3 * u, h - 0.3 * u, 0.26 * u); dashed(c, u, 'rgba(255,255,255,0.85)', 0.012, 0.035, 0.03);
      const ix = 0.24 * u;
      c.save(); rr(c, ix, ix, w - 2 * ix, h - 2 * ix, 0.2 * u); c.clip();
      c.fillStyle = '#2B3336'; c.fillRect(0, 0, w, h);
      const sp = 0.045 * u, rad = 0.012 * u;
      c.fillStyle = 'rgba(86,170,165,0.85)';
      for (let j = 0, y = ix; y < h - ix; y += sp * 0.866, j++) for (let x = ix + (j % 2) * sp / 2; x < w - ix; x += sp) { c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill(); }
      const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(0.45, 'rgba(0,0,0,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0.05)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.restore();
      c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 0.02 * u; rr(c, ix, ix, w - 2 * ix, h - 2 * ix, 0.2 * u); c.stroke();
    });
  }
  function organizerSide(len, hgt) {
    return uTex('orgSide', len, hgt, (c, w, h, u) => {
      vshade(c, w, h, '#50C1BB', '#3A9E99'); grain(c, w, h, 0.07, 2);
      c.strokeStyle = 'rgba(0,40,40,0.06)'; c.lineWidth = 1;
      for (let x = 0; x < w; x += 4) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
      const band = 0.15 * u;
      c.fillStyle = '#1D2125'; c.fillRect(0, 0, w, band);
      c.fillStyle = '#3B4146'; for (let x = 0.02 * u; x < w; x += 0.024 * u) c.fillRect(x, band * 0.38, 0.012 * u, band * 0.24);
      c.beginPath(); c.moveTo(0, band + 0.03 * u); c.lineTo(w, band + 0.03 * u); dashed(c, u, 'rgba(255,255,255,0.8)', 0.012, 0.035, 0.03);
      c.beginPath(); c.moveTo(0, h - 0.07 * u); c.lineTo(w, h - 0.07 * u); dashed(c, u, 'rgba(255,255,255,0.55)', 0.01, 0.035, 0.03);
    });
  }

  /* Plaj havlusu — striped fleece roll, spiral ends */
  function towelSkin(len, compressed) {
    return uTex('towelSkin' + (compressed ? 'C' : ''), 1.6, len, (c, w, h, u) => {
      const bands = compressed ? 7 : 6, bw = h / bands;
      for (let i = 0; i < bands; i++) {
        c.fillStyle = i % 2 ? '#FDE7EF' : '#F290B6';
        c.fillRect(0, i * bw, w, bw + 1);
      }
      for (let i = 1; i < bands; i++) { const g = c.createLinearGradient(0, i * bw - 6, 0, i * bw + 6); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, i * bw - 6, w, 12); }
      if (compressed) { c.strokeStyle = 'rgba(160,60,100,0.18)'; c.lineWidth = 3; for (let i = 0; i < bands * 2; i++) { const y = (i + 0.5) * bw / 2; c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= w; x += 20) c.lineTo(x, y + Math.sin(x * 0.05 + i) * 2); c.stroke(); } }
      grain(c, w, h, 0.06, 3);
    });
  }
  const towelEnd = () => cachedTex('towelEnd', 256, 256, (c, w, h) => {
    c.fillStyle = '#F290B6'; c.fillRect(0, 0, w, h);
    c.save(); c.translate(w / 2, h / 2);
    const turns = 3.2, maxR = w * 0.48;
    for (const [col, lw, off] of [['rgba(170,60,105,0.45)', 9, 3], ['#FCDDE8', 6, 0]]) {
      c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
      for (let a = 0; a < turns * Math.PI * 2; a += 0.05) { const r = maxR * a / (turns * Math.PI * 2); const x = Math.cos(a) * r + off, y = Math.sin(a) * r + off; if (a) c.lineTo(x, y); else c.moveTo(x, y); }
      c.stroke();
    }
    c.restore(); grain(c, w, h, 0.07, 3);
  });

  /* Sabit bölme — slate lock plate with a hazard-striped frame */
  function dividerTop(L, S) {
    return uTex('divTop', L, S, (c, w, h, u) => {
      c.fillStyle = '#3F4A5C'; c.fillRect(0, 0, w, h);
      dome(c, w, h, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.2)');
      const o = 0.07 * u, i = 0.25 * u;
      c.save(); c.beginPath(); rrPath(c, o, o, w - 2 * o, h - 2 * o, 0.1 * u); rrPath(c, i, i, w - 2 * i, h - 2 * i, 0.06 * u); c.clip('evenodd');
      c.fillStyle = '#FFD21F';
      for (let k = -h; k < w + h; k += 0.14 * u) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 0.065 * u, 0); c.lineTo(k + 0.065 * u - h, h); c.lineTo(k - h, h); c.closePath(); c.fill(); }
      c.restore();
      const g = c.createLinearGradient(i, i, w - i, h - i); g.addColorStop(0, '#2B3443'); g.addColorStop(1, '#465266');
      c.fillStyle = g; rr(c, i, i, w - 2 * i, h - 2 * i, 0.06 * u); c.fill();
      c.fillStyle = '#38424F'; rr(c, i + 0.02 * u, i + 0.025 * u, w - 2 * i - 0.04 * u, h - 2 * i - 0.04 * u, 0.05 * u); c.fill();
    });
  }

  function sparkleTex() {
    return cachedTex('sparkle', PX, PX, (c, w, h) => {
      const star = (x, y, r) => { c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr2 = i % 2 ? r * 0.35 : r; c.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); } c.closePath(); c.fill(); };
      c.fillStyle = '#FFFFFF'; star(w * 0.2, h * 0.22, 14); star(w * 0.8, h * 0.78, 11); c.fillStyle = '#FFF2C2'; star(w * 0.8, h * 0.2, 8);
    });
  }
  const chevBase = canvasTex(128, 192, (c, w, h) => {
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 22; c.strokeStyle = '#ffffff';
    c.beginPath(); c.moveTo(w / 2 - 22, 38); c.lineTo(w / 2 + 24, h / 2); c.lineTo(w / 2 - 22, h - 38); c.stroke();
  });
  const puffTex = canvasTex(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  function markTex(pw, ph) {
    return cachedTex(['mark', pw, ph].join('|'), pw * 96, ph * 96, (c, w, h) => {
      c.setLineDash([16, 12]); c.lineWidth = 8; c.strokeStyle = '#ffffff'; rr(c, 8, 8, w - 16, h - 16, 18); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.18)'; c.fill();
    });
  }
  function floorTex(W, H) {
    const S = 96;
    return canvasTex(W * S, H * S, (c, w, h) => {
      c.fillStyle = '#1B2441'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,255,255,0.035)'; c.lineWidth = 2;
      for (let i = -h; i < w; i += 13) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke(); }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const px = x * S + 6, py = y * S + 6, s = S - 12;
        rr(c, px, py, s, s, 16); c.fillStyle = '#25315A'; c.fill();
        const gr = c.createLinearGradient(0, py, 0, py + s); gr.addColorStop(0, 'rgba(0,0,0,0.32)'); gr.addColorStop(0.3, 'rgba(0,0,0,0)');
        c.fillStyle = gr; c.fill(); c.strokeStyle = 'rgba(150,180,240,0.16)'; c.lineWidth = 2; c.stroke();
      }
    });
  }

  /* ---------- materials ---------- */
  const matCache = new Map();
  function plastic(hex) {
    const k = 'p' + hex;
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshPhysicalMaterial({ color: lin(hex), roughness: 0.34, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 0.4 }));
    return matCache.get(k);
  }
  function decalMat(tex) {
    const k = 'd' + tex.uuid;
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    return matCache.get(k);
  }
  const M = {
    shell: new THREE.MeshPhysicalMaterial({ color: lin('#1F2C52'), roughness: 0.45, clearcoat: 0.35, envMapIntensity: 0.35 }),
    wall: new THREE.MeshPhysicalMaterial({ color: lin('#2B3D72'), roughness: 0.4, clearcoat: 0.5, envMapIntensity: 0.4 }),
    corner: new THREE.MeshStandardMaterial({ color: lin('#121729'), roughness: 0.5, envMapIntensity: 0.3 }),
    gold: new THREE.MeshStandardMaterial({ color: lin('#F2C14E'), metalness: 1, roughness: 0.26, envMapIntensity: 1.1 }),
    metal: new THREE.MeshStandardMaterial({ color: lin('#C9CED8'), metalness: 1, roughness: 0.3, envMapIntensity: 1.0 }),
    zip: new THREE.MeshStandardMaterial({ color: lin('#232838'), metalness: 0.6, roughness: 0.35 }),
    arrow: new THREE.MeshPhysicalMaterial({ color: lin('#FFFFFF'), roughness: 0.3, clearcoat: 0.8, envMapIntensity: 0.35 }),
    hit: new THREE.MeshBasicMaterial({ visible: false }),
    rubber: new THREE.MeshStandardMaterial({ color: lin('#232838'), roughness: 0.6 }),
    lidGlass: new THREE.MeshPhysicalMaterial({ color: lin('#D6F1FF'), roughness: 0.04, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.4, depthWrite: false, envMapIntensity: 1.3 }),
    ghost: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }),
    /* travel items (colours from the item art) */
    perfumeCore: new THREE.MeshPhysicalMaterial({ color: lin('#FF72C2'), roughness: 0.18, clearcoat: 0.6, envMapIntensity: 0.6, emissive: lin('#5A0B33'), emissiveIntensity: 0.3 }),
    perfumeGlass: new THREE.MeshPhysicalMaterial({ color: lin('#F0399E'), roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.55, depthWrite: false, envMapIntensity: 1.4 }),
    jokerCore: new THREE.MeshPhysicalMaterial({ color: lin('#FFE39A'), roughness: 0.18, clearcoat: 0.6, envMapIntensity: 0.6, emissive: lin('#5A3A00'), emissiveIntensity: 0.3 }),
    jokerGlass: new THREE.MeshPhysicalMaterial({ color: lin('#F2B93B'), roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.5, depthWrite: false, envMapIntensity: 1.4 }),
    capDark: new THREE.MeshPhysicalMaterial({ color: lin('#30353E'), roughness: 0.35, clearcoat: 0.4, envMapIntensity: 0.5 }),
    leather: new THREE.MeshPhysicalMaterial({ color: lin('#2C3EAE'), roughness: 0.62, clearcoat: 0.18, clearcoatRoughness: 0.5, envMapIntensity: 0.3 }),
    plasticOrange: new THREE.MeshPhysicalMaterial({ color: lin('#F39434'), roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 0.45 }),
    bezel: new THREE.MeshStandardMaterial({ color: lin('#1D2440'), roughness: 0.5, envMapIntensity: 0.3 }),
    screen: new THREE.MeshPhysicalMaterial({ color: lin('#22388A'), roughness: 0.05, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3 }),
    dpad: new THREE.MeshPhysicalMaterial({ color: lin('#2A2326'), roughness: 0.4, clearcoat: 0.3, envMapIntensity: 0.4 }),
    button: new THREE.MeshPhysicalMaterial({ color: lin('#F4F2EE'), roughness: 0.3, clearcoat: 0.5, envMapIntensity: 0.4 }),
    plasticCoral: new THREE.MeshPhysicalMaterial({ color: lin('#F2695E'), roughness: 0.26, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.5 }),
    fabricTeal: new THREE.MeshStandardMaterial({ color: lin('#4DBDB7'), roughness: 0.9, envMapIntensity: 0.25 }),
    fleece: new THREE.MeshStandardMaterial({ color: lin('#F4A7C3'), roughness: 0.95, envMapIntensity: 0.2 }),
    belt: new THREE.MeshPhysicalMaterial({ color: lin('#6E4231'), roughness: 0.55, clearcoat: 0.2, envMapIntensity: 0.3 }),
    fringe: new THREE.MeshStandardMaterial({ color: lin('#F49DBE'), roughness: 0.95 }),
    plasticPurple: new THREE.MeshPhysicalMaterial({ color: lin('#A55BE6'), roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.15, envMapIntensity: 0.5 }),
    velvet: new THREE.MeshStandardMaterial({ color: lin('#6A2AA6'), roughness: 0.95, envMapIntensity: 0.15 }),
    velvetDark: new THREE.MeshStandardMaterial({ color: lin('#58208F'), roughness: 0.95, envMapIntensity: 0.15 }),
    gem: new THREE.MeshPhysicalMaterial({ color: lin('#2F7FF0'), roughness: 0.05, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.5 }),
    pearl: new THREE.MeshPhysicalMaterial({ color: lin('#F8F3EA'), roughness: 0.22, clearcoat: 0.8, envMapIntensity: 1.0 }),
    earring: new THREE.MeshPhysicalMaterial({ color: lin('#FF7FB0'), roughness: 0.15, clearcoat: 1, envMapIntensity: 0.8 }),
    strap: new THREE.MeshStandardMaterial({ color: lin('#6B3A2C'), roughness: 0.6 }),
    watchFace: new THREE.MeshPhysicalMaterial({ color: lin('#FBFAF6'), roughness: 0.25, clearcoat: 0.6, envMapIntensity: 0.5 }),
    roseGold: new THREE.MeshStandardMaterial({ color: lin('#E0A784'), metalness: 1, roughness: 0.3, envMapIntensity: 1.1 }),
    slate: new THREE.MeshPhysicalMaterial({ color: lin('#3F4A5C'), roughness: 0.5, clearcoat: 0.25, envMapIntensity: 0.35 }),
    lockBody: new THREE.MeshPhysicalMaterial({ color: lin('#1F2531'), roughness: 0.4, clearcoat: 0.3, envMapIntensity: 0.4 }),
    hazard: new THREE.MeshStandardMaterial({ color: lin('#FFD21F'), roughness: 0.5, envMapIntensity: 0.3 })
  };

  /* ======================================================================
     WORLD BUILDERS
     ====================================================================== */
  let suit = null, floorMesh = null, emptyOverlay = null, emptyCanvas = null, halo = null;
  const gateViews = [], gateHits = [];
  const meshes = new Map();

  const W = () => G.st.W, Hh = () => G.st.H;
  function localOf(gx, gy) { return { x: gx - G.st.W / 2, z: gy - G.st.H / 2 }; }
  function blockCenter(b, x, y) { const p = localOf((x == null ? b.x : x) + b.w / 2, (y == null ? b.y : y) + b.h / 2); return new THREE.Vector3(p.x, 0, p.z); }
  function sideCenter(side, a) {
    const w = G.st.W, h = G.st.H;
    if (side === 'left') return { x: -w / 2, z: a - h / 2 };
    if (side === 'right') return { x: w / 2, z: a - h / 2 };
    if (side === 'top') return { x: a - w / 2, z: -h / 2 };
    return { x: a - w / 2, z: h / 2 };
  }

  function buildSuitcase() {
    if (suit) root.remove(suit);
    gateViews.length = 0; gateHits.length = 0;
    suit = new THREE.Group(); root.add(suit);
    const w = G.st.W, h = G.st.H, T = WALL_T;

    const shell = new THREE.Mesh(roundedBox(w + 2 * T + 0.16, 0.62, h + 2 * T + 0.16, 0.24, 3), M.shell);
    shell.position.y = -0.64; shell.castShadow = true; shell.receiveShadow = true; suit.add(shell);

    floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: floorTex(w, h), roughness: 0.92, envMapIntensity: 0.2 }));
    floorMesh.rotation.x = -Math.PI / 2; floorMesh.receiveShadow = true; suit.add(floorMesh);

    emptyCanvas = document.createElement('canvas'); emptyCanvas.width = w * 64; emptyCanvas.height = h * 64;
    const et = new THREE.CanvasTexture(emptyCanvas); et.encoding = THREE.sRGBEncoding;
    emptyOverlay = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: et, transparent: true, depthWrite: false, opacity: 0.6 }));
    emptyOverlay.rotation.x = -Math.PI / 2; emptyOverlay.position.y = 0.012; emptyOverlay.visible = false; suit.add(emptyOverlay);

    for (const side of E.SIDES) {
      const ax = E.sideAxis(side), L = ax === 'x' ? h : w, out = OUT[side];
      const spans = G.st.gates.filter(g => g.side === side).map(g => [g.start, g.start + g.len]).sort((a, b) => a[0] - b[0]);
      let cur = 0; const segs = [];
      for (const [a, b] of spans) { if (a > cur) segs.push([cur, a]); cur = Math.max(cur, b); }
      if (cur < L) segs.push([cur, L]);
      for (const [a, b] of segs) {
        const len = b - a, c = sideCenter(side, (a + b) / 2);
        const m = new THREE.Mesh(roundedBox(ax === 'x' ? T : len, WALL_H, ax === 'x' ? len : T, 0.08, 2), M.wall);
        m.position.set(c.x + out[0] * T / 2, 0, c.z + out[1] * T / 2); m.castShadow = true; m.receiveShadow = true; suit.add(m);
      }
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const m = new THREE.Mesh(roundedBox(T + 0.14, WALL_H + 0.08, T + 0.14, 0.14, 2), M.corner);
      m.position.set(sx * (w / 2 + T / 2), 0, sz * (h / 2 + T / 2)); m.castShadow = true; suit.add(m);
    }

    G.st.gates.forEach((gate, gi) => {
      const col = GATE_COLORS[gi % GATE_COLORS.length], ax = E.sideAxis(gate.side), out = OUT[gate.side];
      const mat = new THREE.MeshPhysicalMaterial({ color: lin(col), roughness: 0.34, clearcoat: 0.5, envMapIntensity: 0.4, emissive: lin(col), emissiveIntensity: 0 });
      const c = sideCenter(gate.side, gate.start + gate.len / 2), depth = T + 0.62, across = gate.len - 0.08;
      const mod = new THREE.Mesh(roundedBox(ax === 'x' ? depth : across, 0.66, ax === 'x' ? across : depth, 0.1, 2), mat);
      mod.position.set(c.x + out[0] * depth / 2, -0.61, c.z + out[1] * depth / 2); mod.castShadow = true; mod.receiveShadow = true; suit.add(mod);

      const tex = chevBase.clone(); tex.needsUpdate = true; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2, gate.len);
      const chevMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 });
      const chev = new THREE.Mesh(new THREE.PlaneGeometry(0.52, Math.max(0.5, gate.len - 0.3)), chevMat);
      chev.rotation.set(-Math.PI / 2, 0, CHEV_ROT[gate.side]);
      chev.position.set(c.x + out[0] * (T + 0.33), 0.058, c.z + out[1] * (T + 0.33)); suit.add(chev);

      const L = ax === 'x' ? h : w;
      for (const [bnd, sgn] of [[gate.start, -1], [gate.start + gate.len, 1]]) {
        if (bnd <= 0 || bnd >= L) continue;
        const pc = sideCenter(gate.side, bnd + sgn * T / 2);
        const post = new THREE.Mesh(roundedBox(T * 0.9, WALL_H + 0.16, T * 0.9, 0.1, 2), mat);
        post.position.set(pc.x + out[0] * T / 2, 0, pc.z + out[1] * T / 2); post.castShadow = true; suit.add(post);
      }
      const hd = T + 1.5, inset = 0.5;
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(ax === 'x' ? hd + inset : gate.len + 0.24, ax === 'x' ? gate.len + 0.24 : hd + inset), M.hit);
      hit.rotation.x = -Math.PI / 2; hit.position.set(c.x + out[0] * (hd - inset) / 2, 0.15, c.z + out[1] * (hd - inset) / 2);
      hit.userData.gate = gi; suit.add(hit); gateHits.push(hit);
      gateViews.push({ gi, mat, chevMat, tex, valid: false, flash: 0 });
    });

    halo = new THREE.Mesh(planeGeo(1, 1), new THREE.MeshBasicMaterial({ color: lin('#FFE08A'), transparent: true, opacity: 0.5, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.01; halo.visible = false; suit.add(halo);

    const half = Math.max(w, h) / 2 + 3;
    const sc = sun.shadow.camera; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 40; sc.updateProjectionMatrix();
  }

  /* ---------- blocks (travel items) ---------- */
  function meshKey(b) { return [itemOf(b), b.w, b.h, +!!b.compressed, +!!b.capped, b.axis, b.softAxis].join('|'); }
  function addDecal(group, tex, w, d, y) {
    const m = new THREE.Mesh(planeGeo(w, d), decalMat(tex));
    m.rotation.x = -Math.PI / 2; m.position.y = y + 0.004; m.renderOrder = 2; group.add(m);
    return m;
  }
  function addMesh(group, geo, mat, x, y, z, shadow) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = shadow !== false; m.receiveShadow = true; group.add(m); return m;
  }
  function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
  const cylGeo = (r, h, seg) => cached('cyl|' + r + '|' + h + '|' + (seg || 24), () => { const g = new THREE.CylinderGeometry(r, r, h, seg || 24); g.translate(0, h / 2, 0); return g; });
  const sphereGeo = (r, half) => cached('sph|' + r + '|' + !!half, () => new THREE.SphereGeometry(r, 18, half ? 8 : 14, 0, Math.PI * 2, 0, half ? Math.PI / 2 : Math.PI));
  function rrShape(w, h, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  /* rounded-rectangle ring extruded upward (frames, rims) — sits on y = 0 */
  function ringGeo(ow, od, or, iw, id, ir, depth, bev) {
    return cached(['ring', ow, od, or, iw, id, ir, depth, bev].map(v => typeof v === 'number' ? v.toFixed(3) : v).join('|'), () => {
      const s = rrShape(ow - 2 * bev, od - 2 * bev, Math.max(0.01, or - bev));
      s.holes.push(rrShape(iw + 2 * bev, id + 2 * bev, ir + bev));
      const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.005, depth - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 10 });
      g.rotateX(-Math.PI / 2); g.translate(0, bev, 0);
      return g;
    });
  }
  const crossGeo = (a, t, depth) => cached(['cross', a, t, depth].join('|'), () => {
    const s = new THREE.Shape();
    s.moveTo(-t, -a); s.lineTo(t, -a); s.lineTo(t, -t); s.lineTo(a, -t); s.lineTo(a, t); s.lineTo(t, t); s.lineTo(t, a);
    s.lineTo(-t, a); s.lineTo(-t, t); s.lineTo(-a, t); s.lineTo(-a, -t); s.lineTo(-t, -t); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 2 });
    g.rotateX(-Math.PI / 2); return g;
  });
  function rollGeo(r, len, open) {
    return cached(['roll', r, len, !!open].map(v => typeof v === 'number' ? v.toFixed(3) : v).join('|'), () => {
      const g = new THREE.CylinderGeometry(r, r, len, 40, 1, !!open); g.rotateZ(Math.PI / 2); return g;
    });
  }
  /* box materials by face: BoxGeometry groups are +x, -x, +y, -y, +z, -z */
  function withMap(base, tex) {
    const k = base.uuid + '|' + tex.uuid;
    if (!matCache.has(k)) { const m = base.clone(); m.map = tex; m.color.set('#ffffff'); matCache.set(k, m); }
    return matCache.get(k);
  }
  function faceMats(base, top, endSide, longSide) {
    const t = top ? withMap(base, top) : base, e = endSide ? withMap(base, endSide) : base, l = longSide ? withMap(base, longSide) : base;
    return [e, e, t, base, l, l];
  }

  function buildPerfume(L, S, joker) {
    const g = new THREE.Group(), bw = Math.min(L, S) * 0.86, bh = 0.5;
    addMesh(g, roundedBox(bw - 0.12, bh - 0.1, bw - 0.12, 0.08, 2), joker ? M.jokerCore : M.perfumeCore, 0, 0.04, 0);
    const shell = addMesh(g, roundedBox(bw, bh, bw, 0.13, 3), joker ? M.jokerGlass : M.perfumeGlass, 0, 0, 0, false);
    shell.renderOrder = 3;
    addMesh(g, cylGeo(0.12, 0.085), M.gold, 0, bh - 0.005, 0);
    addMesh(g, studGeo(0.096, 0.13), joker ? M.gold : M.capDark, 0, bh + 0.075, 0);
    if (joker) addDecal(g, sparkleTex(), bw - 0.1, bw - 0.1, bh).renderOrder = 4;
    return g;
  }
  function buildPassport(L, S) {
    const g = new THREE.Group(), h = 0.34;
    addMesh(g, roundedBox(L, h, S, 0.12, 3), faceMats(M.leather, passportTop(L, S), passportSide(S, h), passportSide(L, h)));
    return g;
  }
  function buildConsole(L, S) {
    const g = new THREE.Group(), h = 0.3;
    addMesh(g, roundedBox(L, h, S, 0.12, 3), faceMats(M.plasticOrange, consoleTop(L, S), consoleSide(S, h, true), consoleSide(L, h, false)));
    const long = L > S * 1.6, sw = long ? Math.min(0.96, L * 0.34) : L * 0.6, sh = S * 0.62;
    addMesh(g, roundedBox(sw + 0.06, 0.02, sh + 0.06, 0.04, 2), M.bezel, 0, h - 0.012, 0, false);
    addMesh(g, roundedBox(sw, 0.03, sh, 0.035, 2), M.screen, 0, h - 0.008, 0, false);
    if (!long) return g;
    const px = L / 2 - (L / 2 - sw / 2) * 0.52 - 0.02;
    addMesh(g, crossGeo(0.1, 0.034, 0.03), M.dpad, -px, h - 0.004, 0.02);
    addMesh(g, studGeo(0.052, 0.035), M.button, px - 0.07, h - 0.006, -0.1);
    addMesh(g, studGeo(0.052, 0.035), M.button, px + 0.07, h - 0.006, 0.06);
    return g;
  }
  function buildKit(L, S) {
    const g = new THREE.Group(), h = 0.52;
    addMesh(g, roundedBox(L, h, S, 0.15, 3), faceMats(M.plasticCoral, kitTop(L, S), kitSide(S, h), kitSide(L, h)));
    const handle = addMesh(g, cached('kitHandle', () => new THREE.TorusGeometry(0.16, 0.034, 10, 22, Math.PI)), M.rubber, -L * 0.22, h * 0.42, S / 2 - 0.035);
    handle.rotation.x = Math.PI / 2; handle.scale.set(1, 0.42, 1);
    return g;
  }
  function buildOrganizer(L, S) {
    const g = new THREE.Group(), h = 0.6;
    addMesh(g, roundedBox(L, h, S, 0.2, 3), faceMats(M.fabricTeal, organizerTop(L, S), organizerSide(S, h), organizerSide(L, h)));
    for (const dx of [0, 0.075]) {
      const tab = addMesh(g, roundedBox(0.05, 0.13, 0.018, 0.012, 2), M.metal, L * 0.2 + dx, h - 0.2, S / 2 + 0.002);
      tab.rotation.z = dx ? -0.12 : 0.1;
      addMesh(g, roundedBox(0.06, 0.03, 0.03, 0.01, 2), M.metal, L * 0.2 + dx, h - 0.08, S / 2 - 0.005, false);
    }
    return g;
  }
  function buildTowel(L, S, compressed) {
    const g = new THREE.Group(), R = S * 0.5 - 0.015, fr = 0.07, len = L - 2 * fr, ky = compressed ? 0.86 : 0.8;
    const roll = addMesh(g, rollGeo(R, len), [withMap(M.fleece, towelSkin(len, compressed)), withMap(M.fleece, towelEnd()), withMap(M.fleece, towelEnd())], 0, R * ky, 0);
    roll.scale.y = ky;
    const bx = len * 0.08, top = 2 * R * ky;
    const belt = addMesh(g, rollGeo(R * 1.035, 0.17, true), M.belt, bx, R * ky, 0); belt.scale.y = ky;
    addMesh(g, ringGeo(0.16, 0.2, 0.03, 0.1, 0.13, 0.015, 0.03, 0.008), M.gold, bx, top - 0.004, -0.02);
    addMesh(g, roundedBox(0.012, 0.012, 0.15, 0.005, 1), M.gold, bx, top + 0.018, -0.02, false);
    const tongue = addMesh(g, roundedBox(0.15, 0.014, 0.16, 0.006, 1), M.belt, bx, top - 0.012, 0.13);
    tongue.rotation.x = 0.32;
    for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
      const a = Math.PI * (0.26 + k * 0.12);
      const t = addMesh(g, roundedBox(0.06, 0.028, 0.024, 0.01, 1), M.fringe, s * (len / 2 + 0.03), R * ky + Math.sin(a) * R * ky * 0.92, Math.cos(a) * R * 0.92, false);
      t.rotation.z = s * (0.25 + (k % 3) * 0.12); t.rotation.y = (k % 2 ? 0.2 : -0.15);
    }
    return g;
  }
  const JEWEL_H = 0.42;
  function buildLidGroup(L, S) {
    const cap = new THREE.Group();
    addMesh(cap, ringGeo(L - 0.04, S - 0.04, 0.17, L - 0.2, S - 0.2, 0.09, 0.055, 0.014), M.gold);
    const pane = addMesh(cap, roundedBox(L - 0.16, 0.02, S - 0.16, 0.06, 1), M.lidGlass, 0, 0.015, 0, false); pane.renderOrder = 4;
    addMesh(cap, cylGeo(0.028, 0.06), M.gold, 0, 0.03, 0);
    addMesh(cap, studGeo(0.075, 0.035), M.gold, 0, 0.085, 0);
    return cap;
  }
  function buildJewelry(L, S, capped, id) {
    const g = new THREE.Group(), rim = 0.16, bev = 0.03, Hj = JEWEL_H, floorY = 0.15;
    const iw = L - 2 * rim, id_ = S - 2 * rim;
    addMesh(g, ringGeo(L, S, 0.16, iw, id_, 0.07, Hj, bev), M.plasticPurple);
    addMesh(g, roundedBox(iw + 0.04, floorY, id_ + 0.04, 0.03, 1), M.velvet, 0, 0, 0, false);
    addMesh(g, roundedBox(iw, 0.1, 0.035, 0.012, 1), M.velvetDark, 0, floorY, 0);
    addMesh(g, roundedBox(0.035, 0.1, id_, 0.012, 1), M.velvetDark, 0, floorY, 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addMesh(g, sphereGeo(0.055, true), M.gold, sx * (L / 2 - rim / 2), Hj - 0.005, sz * (S / 2 - rim / 2));
    const q = iw / 4, f = floorY;
    // ring with a blue stone (far left)
    const ring = addMesh(g, cached('ringBand', () => new THREE.TorusGeometry(0.075, 0.019, 10, 26)), M.gold, -q, f + 0.09, -q);
    ring.rotation.set(-0.95, 0.5, 0);
    const gem = addMesh(g, cached('gem', () => new THREE.OctahedronGeometry(0.04)), M.gem, -q + 0.035, f + 0.16, -q - 0.06); gem.scale.y = 0.7;
    // pearl bracelet (far right)
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; addMesh(g, sphereGeo(0.026), M.pearl, q + Math.cos(a) * 0.13, f + 0.026, -q + Math.sin(a) * 0.13); }
    // drop earrings (near left)
    for (const ox of [-0.075, 0.075]) {
      const drop = addMesh(g, sphereGeo(0.042), M.earring, -q + ox, f + 0.03, q + 0.03); drop.scale.set(1, 0.55, 1.35);
      const hook = addMesh(g, cached('hook', () => new THREE.TorusGeometry(0.03, 0.007, 6, 14, Math.PI * 1.3)), M.gold, -q + ox, f + 0.03, q - 0.06, false);
      hook.rotation.x = -Math.PI / 2;
    }
    // watch (near right)
    const wg = new THREE.Group(); wg.position.set(q, f, q); wg.rotation.y = 0.45; g.add(wg);
    for (const s of [-1, 1]) addMesh(wg, roundedBox(0.075, 0.016, 0.12, 0.008, 1), M.strap, 0, 0, s * 0.12);
    addMesh(wg, cylGeo(0.088, 0.035, 28), M.watchFace, 0, 0.012, 0);
    const bez = addMesh(wg, cached('bezel', () => new THREE.TorusGeometry(0.088, 0.014, 8, 28)), M.roseGold, 0, 0.047, 0); bez.rotation.x = Math.PI / 2;
    addMesh(wg, roundedBox(0.008, 0.006, 0.055, 0.002, 1), M.capDark, 0, 0.048, -0.022, false);
    const minute = addMesh(wg, roundedBox(0.008, 0.006, 0.07, 0.002, 1), M.capDark, 0.02, 0.05, 0.01, false); minute.rotation.y = 1.1;
    if (capped) { const cap = buildLidGroup(L, S); cap.name = 'cap'; cap.position.y = Hj - 0.004; g.add(cap); }
    return g;
  }
  function buildDivider(L, S) {
    const g = new THREE.Group();
    addMesh(g, roundedBox(L, 0.2, S, 0.07, 2), M.slate);
    const uw = L - 0.05, ud = S - 0.05;
    addMesh(g, roundedBox(uw, 0.22, ud, 0.08, 2), faceMats(M.slate, dividerTop(uw, ud), null, null), 0, 0.215, 0);
    const top = 0.435;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addMesh(g, sphereGeo(0.038, true), M.metal, sx * (uw / 2 - 0.1), top - 0.004, sz * (ud / 2 - 0.1));
    addMesh(g, roundedBox(0.2, 0.045, 0.16, 0.03, 2), M.lockBody, 0, top - 0.004, 0.035);
    const shackle = addMesh(g, cached('shackle', () => new THREE.TorusGeometry(0.058, 0.018, 8, 18, Math.PI)), M.lockBody, 0, top + 0.02, -0.04);
    shackle.rotation.x = -Math.PI / 2;
    addMesh(g, cylGeo(0.022, 0.008, 16), M.hazard, 0, top + 0.04, 0.02, false);
    addMesh(g, roundedBox(0.016, 0.008, 0.04, 0.004, 1), M.hazard, 0, top + 0.04, 0.05, false);
    return g;
  }

  function buildBlockGroup(b) {
    const g = new THREE.Group(), kind = itemOf(b), top = heightOf(b);
    const vertical = b.h > b.w, L = (vertical ? b.h : b.w) - GAP, S = (vertical ? b.w : b.h) - GAP;
    let inner;
    if (kind === 'divider') inner = buildDivider(L, S);
    else if (kind === 'perfume' || kind === 'joker') inner = buildPerfume(L, S, kind === 'joker');
    else if (kind === 'towel') inner = buildTowel(L, S, !!b.compressed);
    else if (kind === 'passport') inner = buildPassport(L, S);
    else if (kind === 'console') inner = buildConsole(L, S);
    else if (kind === 'kit') inner = buildKit(L, S);
    else if (kind === 'organizer') inner = buildOrganizer(L, S);
    else if (kind === 'jewelry') inner = buildJewelry(L, S, !!b.capped, b.id);
    else { inner = new THREE.Group(); addMesh(inner, roundedBox(L, top, S, 0.1, 3), plastic(colorOf(b))); }
    if (vertical) inner.rotation.y = Math.PI / 2;
    g.add(inner);
    if (b.axis === 'h' || b.axis === 'v') {
      const long = (b.axis === 'h' ? b.w : b.h) - 0.42;
      const a = new THREE.Mesh(arrowGeo(Math.max(0.55, long)), M.arrow);
      a.position.y = top + 0.006; if (b.axis === 'v') a.rotation.y = Math.PI / 2; a.castShadow = true; a.renderOrder = 5; g.add(a);
    }
    g.traverse(o => { if (o.isMesh) o.userData.blockId = b.id; });
    return g;
  }
  function ensureMesh(b) {
    let m = meshes.get(b.id);
    const key = meshKey(b);
    if (m && m.key === key) return m;
    const prevPos = m ? m.group.position.clone() : null;
    if (m) { gsap.killTweensOf(m.group.position); gsap.killTweensOf(m.group.scale); root.remove(m.group); }
    const group = buildBlockGroup(b);
    if (prevPos) group.position.copy(prevPos); else group.position.copy(blockCenter(b));
    root.add(group);
    m = { group, key, side: b.enteredFrom, w: b.w, h: b.h, id: b.id };
    meshes.set(b.id, m);
    return m;
  }
  function removeMesh(id, animate) {
    const m = meshes.get(id); if (!m) return;
    meshes.delete(id);
    const g = m.group;
    gsap.killTweensOf(g.position); gsap.killTweensOf(g.scale);
    if (!animate || REDUCED) { root.remove(g); return; }
    const o = OUT[m.side];
    if (o) {
      gsap.to(g.position, { x: g.position.x + o[0] * (m.w + 1.8), z: g.position.z + o[1] * (m.h + 1.8), duration: 0.34, ease: 'power2.in' });
      gsap.to(g.scale, { x: 0.4, y: 0.4, z: 0.4, duration: 0.3, delay: 0.1, ease: 'power2.in', onComplete: () => root.remove(g) });
    } else {
      gsap.to(g.position, { y: 2.4, duration: 0.3, ease: 'power2.in' });
      gsap.to(g.scale, { x: 0.3, y: 0.3, z: 0.3, duration: 0.3, onComplete: () => root.remove(g) });
    }
  }
  function clearMeshes() { for (const m of meshes.values()) { gsap.killTweensOf(m.group.position); gsap.killTweensOf(m.group.scale); root.remove(m.group); } meshes.clear(); }

  function syncAll(animate) {
    const ids = new Set(G.st.blocks.map(b => b.id));
    for (const id of Array.from(meshes.keys())) if (!ids.has(id)) removeMesh(id, animate);
    for (const b of G.st.blocks) {
      const existed = meshes.has(b.id);
      const m = ensureMesh(b);
      const t = blockCenter(b);
      gsap.killTweensOf(m.group.position);
      if (animate && !REDUCED) {
        if (!existed) { m.group.scale.setScalar(0.3); gsap.to(m.group.scale, { x: 1, y: 1, z: 1, duration: 0.35, ease: 'back.out(2.5)' }); }
        gsap.to(m.group.position, { x: t.x, y: 0, z: t.z, duration: 0.28, ease: 'power2.out' });
      } else { m.group.position.copy(t); m.group.scale.set(1, 1, 1); }
    }
  }

  /* ---------- juice ---------- */
  const puffMat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0.85 });
  function puff(x, z, n, spread, y) {
    if (REDUCED) return;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(puffMat.clone());
      s.position.set(x + (Math.random() - 0.5) * spread, (y || 0.12) + Math.random() * 0.1, z + (Math.random() - 0.5) * spread);
      s.scale.setScalar(0.12); root.add(s);
      const dur = 0.45 + Math.random() * 0.25;
      gsap.to(s.scale, { x: 0.5 + Math.random() * 0.25, y: 0.5 + Math.random() * 0.25, duration: dur, ease: 'power2.out' });
      gsap.to(s.position, { y: s.position.y + 0.35, x: s.position.x + (Math.random() - 0.5) * 0.5, z: s.position.z + (Math.random() - 0.5) * 0.5, duration: dur });
      gsap.to(s.material, { opacity: 0, duration: dur, ease: 'power1.in', onComplete: () => { root.remove(s); s.material.dispose(); } });
    }
  }
  function squash(group, axis, k) {
    if (REDUCED) return;
    k = k || 1;
    gsap.killTweensOf(group.scale);
    const a = 1 - 0.13 * k, p = 1 + 0.08 * k;
    group.scale.set(axis === 'x' ? a : p, 1 - 0.06 * k, axis === 'y' ? a : p);
    gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: 0.55, ease: 'elastic.out(1, 0.38)' });
  }
  function landFx(b, axis, dir) {
    const m = meshes.get(b.id); if (!m) return;
    squash(m.group, axis, 1);
    const c = blockCenter(b);
    if (axis === 'x') puff(c.x + dir * b.w / 2, c.z, 4, b.h * 0.8);
    else puff(c.x, c.z + dir * b.h / 2, 4, b.w * 0.8);
    sfx.thock(0.9 + Math.random() * 0.2); haptic(10);
  }
  function wiggle(id) {
    const m = meshes.get(id); if (!m || REDUCED) return;
    gsap.fromTo(m.group.rotation, { y: 0 }, { y: 0.09, duration: 0.06, yoyo: true, repeat: 5, ease: 'sine.inOut', onComplete: () => { m.group.rotation.y = 0; } });
  }

  /* ======================================================================
     HUD
     ====================================================================== */
  const el = {
    belt: $('#belt'), hint: $('#hint'), fillBar: $('#fillBar'), fillPct: $('#fillPct'), fillCells: $('#fillCells'),
    nUndo: $('#nUndo'), nVac: $('#nVac'), nShake: $('#nShake'), bUndo: $('#bUndo'), bVac: $('#bVac'), bShake: $('#bShake'),
    toast: $('#toast'), failOv: $('#failOv'), helpOv: $('#helpOv'), shakePick: $('#shakePick'),
    hudTop: $('#hudTop'), hudBottom: $('#hudBottom'), btnSound: $('#setSound'), fillTarget: $('#fillTarget'), gapChip: $('#gapChip'),
    queueOv: $('#queueOv'), queueGrid: $('#queueGrid'), btnQueue: $('#btnQueue'), qCount: $('#qCount'),
    home: $('#home'), homeTop: $('#homeTop'), homeCta: $('#homeCta'), tabbar: $('#tabbar'), panelShop: $('#panelShop'), panelMap: $('#panelMap'),
    btnChest: $('#btnChest'), result: $('#result'), buyOv: $('#buyOv'), settingsOv: $('#settingsOv')
  };
  let toastTimer = 0;
  function toast(msg, ms) {
    el.toast.textContent = msg; el.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms || 2400);
  }
  const SVG = {
    h: '<svg viewBox="0 0 40 20"><path d="M3 10h34M10 3 3 10l7 7M30 3l7 7-7 7" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    v: '<svg viewBox="0 0 20 40"><path d="M10 3v34M3 10l7-7 7 7M3 30l7 7 7-7" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    spring: '<svg viewBox="0 0 44 20"><path d="M4 10l5-7 6 14 6-14 6 14 6-14 6 7" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    springV: '<svg viewBox="0 0 20 44"><path d="M10 4l-7 5 14 6-14 6 14 6-14 6 7 6" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>'
  };
  function itemLabel(it, spoken) {
    const k = itemOf(it), name = ITEM_NAME[k] || (it.w + '×' + it.h);
    if (!spoken) return name;
    const lock = it.axis === 'h' ? ', sadece yatay kayar' : it.axis === 'v' ? ', sadece dikey kayar' : '';
    return name + ' ' + it.w + '×' + it.h + lock;
  }
  /* small footprint grid: tells the player the next item's size and orientation */
  function footprintSVG(it, cell) {
    const k = itemOf(it), w = it.w, h = it.h, gap = 2;
    const W = w * cell + (w - 1) * gap, H = h * cell + (h - 1) * gap;
    let rects = '';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const squeeze = k === 'towel' && ((w > h && x === w - 1) || (h > w && y === h - 1));
      rects += `<rect x="${x * (cell + gap) + 0.6}" y="${y * (cell + gap) + 0.6}" width="${cell - 1.2}" height="${cell - 1.2}" rx="1.6"${squeeze ? ' class="soft"' : k === 'lid' ? ' class="lid"' : ''}/>`;
    }
    return `<svg class="fp" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${rects}</svg>`;
  }
  const iconOf = k => (window.PJ_ICONS || {})[k === 'joker' ? 'perfume' : k] || '';
  function miniHTML(it, box) {
    const k = itemOf(it), locked = it.axis === 'h' || it.axis === 'v';
    return `<span class="ico it-${k}" style="--box:${box}px"><img src="${iconOf(k)}" alt="" draggable="false">` +
      (k === 'joker' ? '<span class="joker-star" aria-hidden="true">★</span>' : '') + '</span>' +
      (locked ? `<span class="axis-badge" aria-hidden="true">${it.axis === 'h' ? '↔' : '↕'}</span>` : '') +
      footprintSVG(it, box > 52 ? 7 : box > 40 ? 6 : 4.5);
  }
  let lastHeadId = null;
  function renderQueue() {
    const all = G.queue, head = all[0];
    const shifted = lastHeadId !== null && !!head && head.id !== lastHeadId;
    lastHeadId = head ? head.id : null;
    if (lane && lane.item !== head) cancelLane();
    el.qCount.textContent = all.length;
    el.btnQueue.disabled = !all.length;
    if (!el.queueOv.hidden) renderQueueSheet();
    if (!all.length) { el.belt.innerHTML = '<span class="empty-belt">Kuyruk boş</span>'; updateBeltFade(); return; }
    const keep = el.belt.scrollLeft;
    el.belt.innerHTML = all.map((it, i) => {
      const isHead = i === 0, near = i < 3, name = itemLabel(it);
      const cls = 'tray' + (isHead ? ' head' : near ? '' : ' far') + (isHead && G.selected ? ' selected' : '') + (shifted && !REDUCED ? ' enter' : '');
      const attrs = isHead ? ` id="headTray" aria-label="Sıradaki eşya: ${itemLabel(it, true)}"` : ` aria-label="${i + 1}. sıra: ${itemLabel(it, true)}"`;
      const lbl = near ? `<span class="tray-lbl${name.length > 10 ? ' long' : ''}">${name}</span>` : '';
      const num = isHead ? '' : `<span class="tray-num">${i + 1}</span>`;
      return `<${isHead ? 'button type="button"' : 'div'} class="${cls}"${attrs} style="--from:${isHead ? 86 : 90}px">${miniHTML(it, isHead ? 62 : near ? 48 : 34)}${lbl}${num}</${isHead ? 'button' : 'div'}>`;
    }).join('');
    if (shifted) el.belt.scrollTo({ left: 0, behavior: REDUCED ? 'auto' : 'smooth' }); else el.belt.scrollLeft = keep;
    if (shifted && !REDUCED) { el.belt.classList.remove('roll'); void el.belt.offsetWidth; el.belt.classList.add('roll'); }
    const ht = $('#headTray');
    if (ht) {
      ht.addEventListener('pointerdown', onTrayDown);
      ht.addEventListener('click', e => { if (e.detail === 0 && G.queue[0] && !G.busy && !G.won) onTrayTap(G.queue[0]); });
    }
    updateBeltFade();
  }
  function updateBeltFade() {
    const b = el.belt, max = b.scrollWidth - b.clientWidth;
    b.classList.toggle('fade-l', b.scrollLeft > 4);
    b.classList.toggle('fade-r', b.scrollLeft < max - 4);
  }
  function renderQueueSheet() {
    const all = G.queue;
    $('#queueSub').textContent = all.length ? `${all.length} eşya bu sırayla gelecek. İlk kutu şu an sırada.` : 'Kuyruk boş.';
    el.queueGrid.innerHTML = all.map((it, i) => {
      const squeeze = it.soft ? ` → ${it.w > it.h ? (it.w - 1) + '×' + it.h : it.w + '×' + (it.h - 1)}` : '';
      return `<li class="q-item${i === 0 ? ' now' : ''}"><span class="q-n">${i === 0 ? 'SIRADA' : i + 1}</span>${miniHTML(it, 46)}<span class="q-name">${itemLabel(it)}</span><span class="q-size">${it.w}×${it.h}${squeeze}</span></li>`;
    }).join('');
  }
  function openQueueSheet() {
    if (!G.queue.length) return;
    stopTut(true);
    renderQueueSheet(); el.queueOv.hidden = false; sfx.pop();
    $('#queueClose').focus({ preventScroll: true });
  }
  function closeQueueSheet() { el.queueOv.hidden = true; }
  function hintText() {
    const head = G.queue[0];
    if (G.mode === 'vacuum') return 'Küçültülecek bloğa dokun';
    if (!head) return 'Tamamlandı';
    if (head.type === 'sock') return 'Boş bir kareye dokun';
    if (head.type === 'cap') {
      const b = E.blockById(G.st, head.baseId);
      return b && E.isSnug(G.st, b) ? 'Kapak hazır: takı kutusuna dokun' : 'Takı kutusunun etrafını doldur';
    }
    return gateViews.some(v => v.valid) ? 'Kapıya dokun ya da sürükle' : 'Kapılar dolu: içeride yer aç';
  }
  function updateGates() {
    const head = G.queue[0], g = E.occ(G.st);
    for (const v of gateViews) v.valid = !!head && head.type === 'block' && G.mode === 'idle' && E.entryOptions(G.st, head, G.st.gates[v.gi], g).length > 0;
  }
  function updateHalo() {
    const head = G.queue[0];
    if (!halo) return;
    if (head && head.type === 'cap' && G.mode === 'idle') {
      const b = E.blockById(G.st, head.baseId);
      if (b) {
        const c = blockCenter(b); halo.visible = true; halo.position.set(c.x, 0.01, c.z); halo.scale.set(b.w + 0.24, b.h + 0.24, 1);
        halo.material.color.set(E.isSnug(G.st, b) ? '#FFE08A' : '#FF8A5C').convertSRGBToLinear();
        return;
      }
    }
    halo.visible = false;
  }
  function updateEmptyOverlay() {
    if (!emptyOverlay) return;
    const head = G.queue[0], show = !!head && head.type === 'sock' && G.mode === 'idle';
    emptyOverlay.visible = show;
    if (!show) return;
    const c = emptyCanvas.getContext('2d'), g = E.occ(G.st), S = 64;
    c.clearRect(0, 0, emptyCanvas.width, emptyCanvas.height);
    for (let y = 0; y < G.st.H; y++) for (let x = 0; x < G.st.W; x++) {
      if (g[y * G.st.W + x]) continue;
      rr(c, x * S + 8, y * S + 8, S - 16, S - 16, 12); c.fillStyle = 'rgba(255,230,160,0.55)'; c.fill();
      c.setLineDash([8, 6]); c.lineWidth = 3; c.strokeStyle = '#FFE6A0'; c.stroke(); c.setLineDash([]);
    }
    emptyOverlay.material.map.needsUpdate = true;
  }
  function updateHUD() {
    const total = G.st.W * G.st.H, filled = E.filledCount(G.st), pct = Math.round(filled / total * 100);
    const target = G.level.targetCells, tPct = Math.round(target / total * 100), zero = target === total, boss = zero && G.level.cfg.phase > 1;
    el.fillBar.style.width = pct + '%'; el.fillBar.classList.toggle('full', filled >= target);
    el.fillTarget.style.left = tPct + '%'; el.fillTarget.hidden = zero;
    el.fillPct.textContent = pct + '%'; el.fillCells.textContent = zero ? filled + '/' + total : 'hedef %' + tPct;
    const budget = E.gapBudget(G.st, G.queue);
    el.gapChip.classList.toggle('zero', boss);
    el.gapChip.classList.toggle('tight', !zero && budget <= 1);
    el.gapChip.innerHTML = boss ? '<b>ZERO GAP</b> boşluk yok' : `Boşluk hakkı <b>${Math.max(0, budget)}</b>`;
    for (const [k, badge, btn] of [['undo', el.nUndo, el.bUndo], ['vac', el.nVac, el.bVac], ['shake', el.nShake, el.bShake]]) {
      const left = boostLeft(k);
      badge.textContent = left > 0 ? left : '+';
      badge.classList.toggle('buy', left <= 0);
      btn.setAttribute('aria-disabled', String(k === 'undo' ? (!G.undo.length) : false));
    }
    el.bVac.classList.toggle('armed', G.mode === 'vacuum');
    updateGates(); updateHalo(); updateEmptyOverlay();
    el.hint.textContent = hintText();
  }
  function setSoundIcon() { el.btnSound.innerHTML = (sfx.muted ? SVG.soundOff : SVG.soundOn) + `<span>Ses: ${sfx.muted ? 'Kapalı' : 'Açık'}</span>`; }

  /* ======================================================================
     CAMERA FIT — frame the suitcase inside the space between the HUD bands
     ====================================================================== */
  const PITCH = THREE.MathUtils.degToRad(61);
  function fitCamera() {
    const w = app.clientWidth, h = app.clientHeight;
    if (!w || !h || !G.st) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const ar = app.getBoundingClientRect();
    const top = Math.max(0, el.hudTop.getBoundingClientRect().bottom - ar.top);
    const bot = Math.max(0, ar.bottom - el.hudBottom.getBoundingClientRect().top);
    app.style.setProperty('--bot', bot + 'px');
    const freeH = Math.max(140, h - top - bot);
    const shift = (top + freeH / 2) - h / 2;
    camera.setViewOffset(w, h, 0, -shift, w, h);
    const dir = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
    const target = new THREE.Vector3(0, 0, 0.15);
    const hx = G.st.W / 2 + WALL_T + 0.78, hz = G.st.H / 2 + WALL_T + 0.78;
    const pts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [-0.6, 0.9]) pts.push(new THREE.Vector3(sx * hx, y, sz * hz));
    const padX = 12, padY = 8, v = new THREE.Vector3();
    let lo = 4, hi = 160;
    for (let i = 0; i < 30; i++) {
      const d = (lo + hi) / 2;
      camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target);
      camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      let ok = true;
      for (const p of pts) {
        v.copy(p).project(camera);
        const px = (v.x + 1) / 2 * w, py = (1 - v.y) / 2 * h;
        if (px < padX || px > w - padX || py < top + padY || py > h - bot - padY) { ok = false; break; }
      }
      if (ok) hi = d; else lo = d;
    }
    camera.position.copy(target).addScaledVector(dir, hi); camera.lookAt(target);
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  }

  /* ======================================================================
     PICKING
     ====================================================================== */
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.32), tmpV = new THREE.Vector3();
  function setRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function pointerGrid(e) {
    setRay(e);
    if (!raycaster.ray.intersectPlane(dragPlane, tmpV)) return null;
    root.worldToLocal(tmpV);
    return { gx: tmpV.x + G.st.W / 2, gy: tmpV.z + G.st.H / 2 };
  }
  function pickBlock(e) {
    setRay(e);
    const groups = Array.from(meshes.values()).map(m => m.group);
    const hits = raycaster.intersectObjects(groups, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.blockId == null) o = o.parent;
      if (o) { const b = E.blockById(G.st, o.userData.blockId); if (b) return b; }
    }
    return null;
  }
  function pickGate(e) {
    setRay(e);
    const hits = raycaster.intersectObjects(gateHits, false);
    if (!hits.length) return null;
    const p = suit.worldToLocal(hits[0].point.clone()), gi = hits[0].object.userData.gate, gate = G.st.gates[gi];
    const along = E.sideAxis(gate.side) === 'x' ? p.z + G.st.H / 2 : p.x + G.st.W / 2;
    return { gi, along };
  }

  /* ======================================================================
     ACTIONS
     ====================================================================== */
  const lock = () => { G.busy++; };
  const unlock = () => { G.busy = Math.max(0, G.busy - 1); };
  function snapshot() { return { blocks: E.cloneBlocks(G.st.blocks), queue: G.queue.slice(), nextId: G.nextId, moves: G.moves }; }
  function pushUndo() { if (!G.t0) G.t0 = performance.now(); G.undo.push(snapshot()); if (G.undo.length > 60) G.undo.shift(); }

  function bestOption(item, gate, along) {
    const opts = E.entryOptions(G.st, item, gate);
    if (!opts.length) return null;
    const cross = E.sideAxis(gate.side) === 'x' ? item.h : item.w;
    if (along == null) return opts[0];
    let best = opts[0], bd = Infinity;
    for (const o of opts) { const dd = Math.abs(o.offset + cross / 2 - along); if (dd < bd) { bd = dd; best = o; } }
    return best;
  }
  function rejectGate(gi, item) {
    const gate = G.st.gates[gi], why = E.entryBlockReason(G.st, item, gate), cross = E.sideAxis(gate.side) === 'x' ? item.h : item.w;
    const msg = {
      'axis-h': 'Bu eşya sadece ↔ yatay kayar: sol ya da sağ kapıyı kullan.',
      'axis-v': 'Bu eşya sadece ↕ dikey kayar: üst ya da alt kapıyı kullan.',
      narrow: `Kapı ${gate.len} kare, eşya ${cross} kare genişliğinde. Sığmıyor.`,
      blocked: 'Bu kapının önü dolu. Önce içeride yer aç.'
    }[why];
    toast(msg); sfx.deny(); haptic([8, 40, 8]);
    const v = gateViews[gi]; if (v) v.flash = 1;
  }
  function outsideCenter(b, side) {
    const p = blockCenter(b), off = WALL_T + 0.8;
    if (side === 'left') p.x = -G.st.W / 2 - off - b.w / 2;
    else if (side === 'right') p.x = G.st.W / 2 + off + b.w / 2;
    else if (side === 'top') p.z = -G.st.H / 2 - off - b.h / 2;
    else p.z = G.st.H / 2 + off + b.h / 2;
    return p;
  }
  function doEnter(item, gi, opt, onDone) {
    const gate = G.st.gates[gi];
    pushUndo();
    G.queue.shift(); G.selected = false;
    markTut('gate'); if (item.axis === 'h' || item.axis === 'v') markTut('axis');
    const b = E.applyEnter(G.st, item, gate, opt);
    G.moves++;
    const m = ensureMesh(b), start = outsideCenter(b, gate.side), end = blockCenter(b);
    const axis = E.sideAxis(gate.side), dir = (gate.side === 'left' || gate.side === 'top') ? 1 : -1;
    m.group.position.copy(start);
    renderQueue(); updateHUD(); hideGhost();
    const v = gateViews[gi]; if (v) v.flash = 1;
    if (REDUCED) { m.group.position.copy(end); sfx.thock(); afterAction(); if (onDone) onDone(); return; }
    lock();
    m.group.scale.setScalar(0.45);
    const dist = start.distanceTo(end);
    gsap.timeline({ onComplete: () => { unlock(); afterAction(); if (onDone) onDone(); } })
      .to(m.group.scale, { x: 1, y: 1, z: 1, duration: 0.15, ease: 'back.out(3)', onStart: () => sfx.pop() })
      .to(m.group.position, { x: end.x, z: end.z, duration: 0.12 + dist * 0.045, ease: 'power2.in', onStart: () => sfx.slide(dist) }, '-=0.03')
      .add(() => landFx(b, axis, dir));
  }
  function placeSock(cx, cy, onDone) {
    const item = G.queue[0];
    if (!item || item.type !== 'sock') return;
    const g = E.occ(G.st);
    if (cx < 0 || cy < 0 || cx >= G.st.W || cy >= G.st.H || g[cy * G.st.W + cx]) { toast('Joker parfüm sadece boş bir kareye bırakılır.'); sfx.deny(); return; }
    pushUndo(); G.queue.shift(); G.moves++;
    const b = { id: item.id, w: 1, h: 1, x: cx, y: cy, color: item.color, axis: 'free', soft: false, softAxis: null, compressed: false, base: false, capped: false, fixed: false, sock: true, enteredFrom: 'drop' };
    G.st.blocks.push(b);
    const m = ensureMesh(b), end = blockCenter(b);
    renderQueue(); updateHUD(); hideGhost();
    if (REDUCED) { m.group.position.copy(end); afterAction(); if (onDone) onDone(); return; }
    lock();
    m.group.position.set(end.x, 3.2, end.z); m.group.scale.set(0.8, 1.25, 0.8);
    gsap.timeline({ onComplete: () => { unlock(); afterAction(); if (onDone) onDone(); } })
      .to(m.group.position, { y: 0, duration: 0.32, ease: 'power3.in' })
      .add(() => { sfx.thock(1.3); haptic(8); puff(end.x, end.z, 5, 0.6); m.group.scale.set(1.18, 0.7, 1.18); })
      .to(m.group.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'elastic.out(1,0.35)' });
  }
  function placeCap(onDone) {
    const item = G.queue[0];
    if (!item || item.type !== 'cap') return;
    const b = E.blockById(G.st, item.baseId);
    if (!b) return;
    if (!E.isSnug(G.st, b)) {
      wiggle(b.id); sfx.deny();
      toast('Şeffaf kapak için önce takı kutusu yerine oturmalı: hiçbir yöne kayamayacak hale gelsin.', 3000);
      return;
    }
    pushUndo(); G.queue.shift(); b.capped = true; G.moves++; markTut('lid');
    const m = ensureMesh(b), cap = m.group.getObjectByName('cap');
    renderQueue(); updateHUD(); hideGhost();
    if (!cap || REDUCED) { sfx.snap(); afterAction(); if (onDone) onDone(); return; }
    lock();
    const rest = cap.position.clone(), c = blockCenter(b);
    const dl = c.x + G.st.W / 2, dr = G.st.W / 2 - c.x, dt = c.z + G.st.H / 2, db = G.st.H / 2 - c.z, mn = Math.min(dl, dr, dt, db);
    const ox = mn === dl ? -1 : mn === dr ? 1 : 0, oz = ox ? 0 : (mn === dt ? -1 : 1), far = mn + 1.6;
    cap.position.set(rest.x + ox * far, rest.y + 0.32, rest.z + oz * far);
    gsap.timeline({ onComplete: () => { unlock(); afterAction(); if (onDone) onDone(); } })
      .to(cap.position, { x: rest.x, z: rest.z, duration: 0.42, ease: 'power2.out', onStart: () => sfx.slide(2) })
      .to(cap.position, { y: rest.y, duration: 0.12, ease: 'power3.in' })
      .add(() => { sfx.snap(); haptic(12); squash(m.group, 'y', 0.8); puff(c.x, c.z, 4, Math.max(b.w, b.h) * 0.7, 0.6); });
  }
  function commitSlide(b, x, y, animate) {
    pushUndo(); b.x = x; b.y = y; G.moves++;
    const m = ensureMesh(b), t = blockCenter(b);
    if (animate && !REDUCED) gsap.to(m.group.position, { x: t.x, y: 0, z: t.z, duration: 0.2, ease: 'power2.out' });
    else m.group.position.copy(t);
  }
  function commitCompress(b, fromX, fromY, dir) {
    const probe = Object.assign({}, b, { x: fromX, y: fromY });
    const c = E.compressInfo(G.st, probe, dir, E.occ(G.st, b.id));
    if (!c) return false;
    pushUndo();
    Object.assign(b, c); b.compressed = true; G.moves++; markTut('towel');
    const m = ensureMesh(b), t = blockCenter(b), ax = b.softAxis;
    m.group.position.set(t.x, 0, t.z);
    if (!REDUCED) {
      if (ax === 'x') m.group.scale.set(1.45, 0.9, 1); else m.group.scale.set(1, 0.9, 1.45);
      gsap.to(m.group.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'elastic.out(1,0.33)' });
      const trail = -dir;
      if (ax === 'x') puff(t.x + trail * (b.w / 2 + 0.4), t.z, 6, 0.7); else puff(t.x, t.z + trail * (b.h / 2 + 0.4), 6, 0.7);
    }
    sfx.squish(); haptic([10, 30, 14]);
    toast('Sıkıştı! 1×3 → 1×2');
    return true;
  }

  function tryVacuum(b) {
    if (b.fixed || b.sock || b.base || b.capped) {
      toast(b.base ? 'Takı kutusu vakumlanamaz: kapağı ona göre.' : 'Vakum bu eşyada çalışmaz.'); sfx.deny(); wiggle(b.id); return;
    }
    const s = E.shrinkInfo(b);
    if (!s) { toast('Bu blok zaten en küçük boyutta.'); sfx.deny(); return; }
    pushUndo();
    useBoost('vac'); G.mode = 'idle';
    const oldW = b.w, oldH = b.h, oldC = blockCenter(b);
    b.w = s.w; b.h = s.h;
    if (b.soft) b.compressed = true;
    const socks = [];
    for (let i = 0; i < s.freed; i++) socks.push({ type: 'sock', id: G.nextId++, color: (G.nextId + i) % SOCK_STRIPES.length, w: 1, h: 1 });
    G.queue.unshift(...socks);
    G.moves++;
    const m = ensureMesh(b), t = blockCenter(b);
    sfx.whoosh(); haptic(20);
    if (!REDUCED) {
      m.group.position.copy(oldC);
      m.group.scale.set(oldW / b.w, 1.12, oldH / b.h);
      gsap.to(m.group.position, { x: t.x, z: t.z, duration: 0.4, ease: 'power2.inOut' });
      gsap.to(m.group.scale, { x: 1, y: 1, z: 1, duration: 0.7, ease: 'elastic.out(1,0.4)' });
      puff(oldC.x, oldC.z, 10, Math.max(oldW, oldH) * 0.8, 0.5);
    } else m.group.position.copy(t);
    toast(`Vakumlandı! ${s.freed} joker parfüm kuyruğun başına eklendi.`, 2800);
    renderQueue(); updateHUD(); afterAction();
  }

  function doShake(dirName) {
    el.shakePick.hidden = true;
    const vec = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dirName];
    const trial = { W: G.st.W, H: G.st.H, gates: G.st.gates, blocks: E.cloneBlocks(G.st.blocks) };
    if (!E.pressAll(trial, vec)) { toast('Bu yönde kapanacak boşluk yok. Booster harcanmadı.'); sfx.deny(); G.mode = 'idle'; updateHUD(); return; }
    pushUndo();
    const before = new Map(G.st.blocks.map(b => [b.id, { x: b.x, y: b.y }]));
    G.st.blocks = trial.blocks;
    useBoost('shake'); G.moves++; G.mode = 'idle';
    updateHUD();
    lock(); sfx.rattle(); haptic([15, 30, 15, 30, 15]);
    const tl = gsap.timeline({ onComplete: () => { unlock(); afterAction(); } });
    if (!REDUCED) {
      tl.to(root.rotation, { z: 0.035, duration: 0.05, yoyo: true, repeat: 5, ease: 'sine.inOut' }, 0)
        .to(root.position, { x: vec[0] * 0.18, z: vec[1] * 0.18, duration: 0.06, yoyo: true, repeat: 5, ease: 'sine.inOut' }, 0)
        .add(() => { root.rotation.z = 0; root.position.set(0, 0, 0); });
    }
    const ax = vec[0] ? 'x' : 'y', sign = vec[0] || vec[1];
    let k = 0;
    const list = G.st.blocks.slice().sort((a, b) => sign > 0 ? (ax === 'x' ? (b.x + b.w) - (a.x + a.w) : (b.y + b.h) - (a.y + a.h)) : (ax === 'x' ? a.x - b.x : a.y - b.y));
    for (const b of list) {
      const was = before.get(b.id); if (!was || (was.x === b.x && was.y === b.y)) continue;
      const m = ensureMesh(b), t = blockCenter(b), d = Math.abs(was.x - b.x) + Math.abs(was.y - b.y);
      if (REDUCED) { m.group.position.copy(t); continue; }
      tl.to(m.group.position, { x: t.x, z: t.z, duration: 0.12 + d * 0.05, ease: 'power3.in', onComplete: () => { squash(m.group, ax, 0.8); sfx.thock(1 + Math.random() * 0.3); } }, 0.32 + k * 0.05);
      k++;
    }
  }

  function doUndo() {
    if (G.busy || G.won) return;
    if (!G.undo.length) { toast('Geri alınacak hamle yok.'); sfx.deny(); return; }
    if (boostLeft('undo') <= 0) { offerBoost('undo'); return; }
    useBoost('undo');
    const snap = G.undo.pop();
    G.st.blocks = E.cloneBlocks(snap.blocks); G.queue = snap.queue.slice(); G.nextId = snap.nextId; G.moves = snap.moves;
    G.mode = 'idle'; G.selected = false;
    closeFail();
    syncAll(true); renderQueue(); updateHUD(); sfx.undo();
  }

  function afterAction() {
    updateHUD();
    if (G.won) return;
    const full = E.filledCount(G.st) === G.st.W * G.st.H;
    if (G.queue.length === 0) { winSequence(); return; }
    if (!tut.kind) scheduleTut(800);
    if (!E.anyActionPossible(G.st, G.queue)) {
      setTimeout(() => { if (!G.won && !G.busy && !E.anyActionPossible(G.st, G.queue)) openFail(full); }, 420);
    }
  }

  /* ======================================================================
     INPUT — blocks on the board
     ====================================================================== */
  let drag = null;
  function startBlockDrag(b, e, gp) {
    if (b.fixed) { wiggle(b.id); sfx.deny(); toast('Sabit bölme: bavulun iç dikişi, yerinden oynamaz.'); return; }
    if (b.capped) { wiggle(b.id); sfx.deny(); toast('Kapağı takılan blok kilitlendi.'); return; }
    const m = meshes.get(b.id); if (!m) return;
    gsap.killTweensOf(m.group.position); gsap.killTweensOf(m.group.scale);
    m.group.position.copy(blockCenter(b)); m.group.scale.set(1, 1, 1);
    drag = { id: b.id, pid: e.pointerId, sx: gp.gx, sy: gp.gy, ox: b.x, oy: b.y, fx: b.x, fy: b.y, axis: null, done: false, atLimit: false, occ: E.occ(G.st, b.id), moved: false };
    gsap.to(m.group.position, { y: 0.07, duration: 0.1 });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    canvas.classList.add('grabbing');
    sfx.pick();
  }
  function moveBlockDrag(gp) {
    const d = drag, b = E.blockById(G.st, d.id);
    if (!b || d.done || !gp) return;
    const tx = d.ox + (gp.gx - d.sx), ty = d.oy + (gp.gy - d.sy);
    const canX = E.canAxis(b, 'x'), canY = E.canAxis(b, 'y');
    if (!d.axis) {
      const mx = Math.abs(tx - d.fx), my = Math.abs(ty - d.fy);
      if (Math.max(mx, my) < 0.14) return;
      let ax = mx >= my ? 'x' : 'y';
      if (ax === 'x' && !canX) ax = canY ? 'y' : null;
      if (ax === 'y' && !canY) ax = canX ? 'x' : null;
      if (!ax) return;
      d.axis = ax;
    }
    const other = d.axis === 'x' ? 'y' : 'x';
    const curA = d.axis === 'x' ? d.fx : d.fy, nearA = Math.round(curA);
    const perp = other === 'x' ? tx - d.fx : ty - d.fy, par = d.axis === 'x' ? tx - d.fx : ty - d.fy;
    if (E.canAxis(b, other) && Math.abs(curA - nearA) < 0.26 && Math.abs(perp) > 0.4 && Math.abs(perp) > Math.abs(par) * 0.85) {
      const probe = Object.assign({}, b, { x: d.axis === 'x' ? nearA : Math.round(d.fx), y: d.axis === 'y' ? nearA : Math.round(d.fy) });
      const r = E.slideRange(G.st, probe, other, d.occ), curO = other === 'x' ? probe.x : probe.y;
      if ((perp < 0 && r.min < curO) || (perp > 0 && r.max > curO)) {
        if (d.axis === 'x') d.fx = nearA; else d.fy = nearA;
        d.axis = other;
      }
    }
    const probe = Object.assign({}, b, { x: d.axis === 'x' ? Math.round(d.fx) : d.fx, y: d.axis === 'y' ? Math.round(d.fy) : d.fy });
    const r = E.slideRange(G.st, probe, d.axis, d.occ);
    const want = d.axis === 'x' ? tx : ty;
    const v = Math.min(r.max, Math.max(r.min, want)), over = want - v;
    if (d.axis === 'x') d.fx = v; else d.fy = v;
    if (Math.round(d.fx) !== d.ox || Math.round(d.fy) !== d.oy) d.moved = true;

    const atLimit = Math.abs(over) > 0.02 && (v === r.max || v === r.min);
    if (atLimit && !d.atLimit) { sfx.bump(); haptic(6); }
    d.atLimit = atLimit;

    if (b.soft && !b.compressed && b.softAxis === d.axis && Math.abs(over) > 0.62) {
      const dir = over > 0 ? 1 : -1;
      if (commitCompress(b, Math.round(d.fx), Math.round(d.fy), dir)) { d.done = true; d.compressed = true; afterAction(); return; }
    }
    const m = meshes.get(b.id), p = localOf(d.fx + b.w / 2, d.fy + b.h / 2);
    m.group.position.x = p.x; m.group.position.z = p.z;
    if (!REDUCED) {
      const s = Math.min(Math.abs(over), 0.7), k = b.soft ? 0.36 : 0.09;
      const a = 1 - k * s, q = 1 + k * s * 0.55;
      m.group.scale.set(d.axis === 'x' ? a : q, 1 - k * s * 0.3, d.axis === 'y' ? a : q);
    }
  }
  function endBlockDrag() {
    const d = drag; drag = null;
    canvas.classList.remove('grabbing');
    const b = E.blockById(G.st, d.id), m = b && meshes.get(b.id);
    if (!b || !m) return;
    if (d.done) return;
    const nx = Math.round(d.fx), ny = Math.round(d.fy);
    const changed = nx !== b.x || ny !== b.y;
    if (changed) { pushUndo(); b.x = nx; b.y = ny; G.moves++; sfx.click(); haptic(6); markTut('slide'); if (b.axis === 'h' || b.axis === 'v') markTut('axis'); }
    const t = blockCenter(b);
    gsap.to(m.group.position, { x: t.x, z: t.z, y: 0, duration: 0.18, ease: 'back.out(2.2)' });
    gsap.to(m.group.scale, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'elastic.out(1,0.45)' });
    if (changed) afterAction();
    else if (!d.axis) {
      const head = G.queue[0];
      if (head && head.type === 'cap' && head.baseId === b.id) placeCap();
    }
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    sfx.unlock();
    if (G.screen !== 'play') return;
    if (tut.kind) stopTut(true);
    if (G.won || G.busy || drag || qdrag) return;
    const gp = pointerGrid(e), head = G.queue[0], b = pickBlock(e);
    if (lane && !lane.holding) { const g2 = pickGate(e); if (!g2 || g2.gi !== lane.gi || !head || head.type !== 'block') cancelLane(); }
    if (G.mode === 'vacuum') {
      if (b) tryVacuum(b); else { G.mode = 'idle'; updateHUD(); toast('Vakum iptal edildi.'); }
      return;
    }
    if (head && head.type === 'cap' && b && b.id === head.baseId) { placeCap(); return; }
    if (b) { startBlockDrag(b, e, gp); return; }
    const onBoard = gp && gp.gx >= 0 && gp.gy >= 0 && gp.gx < G.st.W && gp.gy < G.st.H;
    if (head && head.type === 'sock' && onBoard) { placeSock(Math.floor(gp.gx), Math.floor(gp.gy)); return; }
    const gh = pickGate(e);
    if (gh) {
      if (head && head.type === 'block') { gateDown(e, gh); return; }
      if (head && head.type === 'sock') { toast('Joker parfüm kapıdan girmez: boş bir kareye dokun.'); return; }
      if (head && head.type === 'cap') { toast('Şeffaf kapak takı kutusunun üstüne oturur: kutuya dokun.'); return; }
    }
    if (head && head.type === 'block' && gp && gp.gx >= 0 && gp.gy >= 0 && gp.gx < G.st.W && gp.gy < G.st.H) toast('Sıradaki eşya bir kapıdan girer: parlayan oklu kapılara dokun.');
  });
  canvas.addEventListener('pointermove', e => {
    if (drag && e.pointerId === drag.pid) { moveBlockDrag(pointerGrid(e)); return; }
    if (lane && lane.holding && e.pointerId === lane.pid) { laneMove(e); return; }
    if (G.screen === 'play' && e.pointerType === 'mouse' && !qdrag && !lane && !G.busy && !G.won) hoverPreview(e);
  });
  const endCanvas = e => {
    if (lane && lane.holding && e.pointerId === lane.pid) { laneUp(e, e.type === 'pointercancel'); return; }
    if (drag && e.pointerId === drag.pid) { try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ } endBlockDrag(); } };
  canvas.addEventListener('pointerup', endCanvas);
  canvas.addEventListener('pointercancel', endCanvas);
  canvas.addEventListener('pointerleave', () => { if (!qdrag && !drag && !lane) { hideGhost(); canvas.classList.remove('can-grab', 'can-tap'); } });

  /* ---------- ghost preview ---------- */
  let ghost = null;
  function showGhost(item, gx, gy, snapped, lift) {
    const key = item.type + '|' + item.w + 'x' + item.h;
    if (!ghost || ghost.key !== key) {
      if (ghost) root.remove(ghost.group);
      const grp = new THREE.Group(), hgt = item.type === 'cap' ? H_CAP : item.type === 'sock' ? H_SOCK : H_HARD;
      const body = new THREE.Mesh(roundedBox(item.w - GAP, hgt, item.h - GAP, item.type === 'sock' ? 0.2 : 0.1, 2), M.ghost.clone());
      const mark = new THREE.Mesh(planeGeo(item.w - 0.06, item.h - 0.06), new THREE.MeshBasicMaterial({ map: markTex(item.w, item.h), transparent: true, depthWrite: false }));
      mark.rotation.x = -Math.PI / 2; mark.position.y = 0.02;
      grp.add(body); grp.add(mark); root.add(grp);
      ghost = { group: grp, key, body, mark };
    }
    const col = colorOf(item);
    ghost.body.material.color.set(col).convertSRGBToLinear();
    ghost.body.material.opacity = snapped ? 0.55 : 0.32;
    ghost.mark.visible = !!snapped;
    ghost.mark.position.y = 0.02 - (lift || 0);
    const p = localOf(gx + item.w / 2, gy + item.h / 2);
    ghost.group.position.set(p.x, lift || 0, p.z);
    ghost.group.visible = true;
  }
  function hideGhost() { if (ghost) ghost.group.visible = false; }
  function hoverPreview(e) {
    const head = G.queue[0], b = pickBlock(e);
    canvas.classList.toggle('can-grab', !!b && !b.fixed && !b.capped && G.mode === 'idle');
    if (!head || G.mode !== 'idle') { hideGhost(); canvas.classList.toggle('can-tap', G.mode === 'vacuum' && !!b); return; }
    if (b) { hideGhost(); canvas.classList.toggle('can-tap', head.type === 'cap' && b.id === head.baseId); return; }
    if (head.type === 'block') {
      const gh = pickGate(e);
      canvas.classList.toggle('can-tap', !!gh);
      if (gh) { const opt = bestOption(head, G.st.gates[gh.gi], gh.along); if (opt) { showGhost(head, opt.ex, opt.ey, true); return; } }
      hideGhost(); return;
    }
    if (head.type === 'sock') {
      const gp = pointerGrid(e);
      if (gp) { const cx = Math.floor(gp.gx), cy = Math.floor(gp.gy); if (cx >= 0 && cy >= 0 && cx < G.st.W && cy < G.st.H && !E.occ(G.st)[cy * G.st.W + cx]) { canvas.classList.add('can-tap'); showGhost(head, cx, cy, true, 0.25); return; } }
      canvas.classList.remove('can-tap');
    }
    hideGhost();
  }


  /* ======================================================================
     HOLOGRAMS — translucent copies of items (lane preview + ghost hand)
     ====================================================================== */
  const holoMats = new Map();
  function holoMat(m) {
    let h = holoMats.get(m.uuid);
    if (!h) {
      h = m.clone(); h.transparent = true; h.depthWrite = false;
      h.userData.base = (m.transparent ? m.opacity : 1) * 0.58;
      h.opacity = h.userData.base;
      if (h.emissive) { h.emissive = new THREE.Color(0xffffff); h.emissiveIntensity = 0.16; }
      holoMats.set(m.uuid, h);
    }
    return h;
  }
  function holoify(group) {
    group.traverse(o => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(holoMat) : holoMat(o.material);
      o.castShadow = false; o.receiveShadow = false; o.renderOrder = 7; o.userData.blockId = null;
    });
    return group;
  }
  function setHoloAlpha(k) { for (const h of holoMats.values()) h.opacity = h.userData.base * k; }
  function itemBlock(item, x, y) {
    return { id: -1, x: x || 0, y: y || 0, w: item.w, h: item.h, item: item.item, color: item.color, axis: item.axis || 'free',
      soft: !!item.soft, softAxis: item.softAxis || null, compressed: !!item.compressed, base: !!item.base, capped: false, fixed: !!item.fixed, sock: !!item.sock };
  }
  const holoOf = b => holoify(buildBlockGroup(b));
  const tv = new THREE.Vector3();
  function toScreen(p, ar, cr) {
    tv.copy(p); root.localToWorld(tv); tv.project(camera);
    return { x: cr.left - ar.left + (tv.x + 1) / 2 * cr.width, y: cr.top - ar.top + (1 - tv.y) / 2 * cr.height };
  }
  /* root-local point over the gate module, in front of a lane */
  function mouthPoint(gate, offset, cross, y) {
    const c = sideCenter(gate.side, offset + cross / 2), out = OUT[gate.side];
    return new THREE.Vector3(c.x + out[0] * (WALL_T + 0.33), y == null ? 0.07 : y, c.z + out[1] * (WALL_T + 0.33));
  }

  /* ======================================================================
     LANE PICKING — a wide gate with several lanes previews the item at the
     gate mouth; slide along the gate and release, or tap the lane again
     ====================================================================== */
  let lane = null, laneVis = null, laneHintShown = false;
  const laneDotGeo = new THREE.CircleGeometry(0.11, 22);
  const laneCross = (gate, item) => E.sideAxis(gate.side) === 'x' ? item.h : item.w;
  function nearestLane(item, gate, opts, along) {
    const cross = laneCross(gate, item);
    let k = 0, bd = Infinity;
    opts.forEach((o, i) => { const d = Math.abs(o.offset + cross / 2 - along); if (d < bd) { bd = d; k = i; } });
    return k;
  }
  function showLane() {
    hideLane();
    const { item, gi, opts } = lane, gate = G.st.gates[gi], cross = laneCross(gate, item);
    const grp = new THREE.Group(); root.add(grp);
    const ghostG = holoOf(itemBlock(item)); grp.add(ghostG);
    const mark = new THREE.Mesh(planeGeo(item.w - 0.06, item.h - 0.06), new THREE.MeshBasicMaterial({ map: markTex(item.w, item.h), transparent: true, depthWrite: false }));
    mark.rotation.x = -Math.PI / 2; mark.renderOrder = 6; grp.add(mark);
    const strip = new THREE.Mesh(planeGeo(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
    strip.rotation.x = -Math.PI / 2; strip.renderOrder = 5; grp.add(strip);
    const dots = opts.map(o => {
      const d = new THREE.Mesh(laneDotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      d.rotation.x = -Math.PI / 2; d.position.copy(mouthPoint(gate, o.offset, cross)); d.renderOrder = 8; grp.add(d);
      return d;
    });
    laneVis = { grp, ghostG, mark, strip, dots };
    updateLane();
  }
  function updateLane() {
    if (!lane || !laneVis) return;
    const { item, opts, sel } = lane, o = opts[sel];
    const mouth = blockCenter(item, o.x, o.y), land = blockCenter(item, o.ex, o.ey);
    laneVis.ghostG.position.set(mouth.x, 0.01, mouth.z);
    const travels = o.x !== o.ex || o.y !== o.ey;
    laneVis.mark.visible = laneVis.strip.visible = travels;
    if (travels) {
      laneVis.mark.position.set(land.x, 0.022, land.z);
      const x0 = Math.min(o.x, o.ex), y0 = Math.min(o.y, o.ey), x1 = Math.max(o.x, o.ex) + item.w, y1 = Math.max(o.y, o.ey) + item.h;
      const c = localOf((x0 + x1) / 2, (y0 + y1) / 2);
      laneVis.strip.position.set(c.x, 0.014, c.z);
      laneVis.strip.scale.set(x1 - x0 - 0.16, y1 - y0 - 0.16, 1);
    }
    laneVis.dots.forEach((d, i) => {
      const on = i === sel;
      d.scale.setScalar(on ? 1.5 : 0.9);
      d.material.color.set(on ? '#18213D' : '#FFFFFF');
      d.material.opacity = on ? 0.95 : 0.75;
    });
  }
  function hideLane() {
    if (!laneVis) return;
    root.remove(laneVis.grp);
    laneVis.dots.forEach(d => d.material.dispose());
    laneVis.mark.material.dispose(); laneVis.strip.material.dispose();
    laneVis = null;
    setHoloAlpha(1);
  }
  function cancelLane() { lane = null; hideLane(); }
  function gateDown(e, gh) {
    const item = G.queue[0], gate = G.st.gates[gh.gi], opts = E.entryOptions(G.st, item, gate);
    if (!opts.length) { cancelLane(); rejectGate(gh.gi, item); return; }
    if (opts.length === 1) { cancelLane(); doEnter(item, gh.gi, opts[0]); return; }
    const again = !!(lane && lane.pending && lane.gi === gh.gi && lane.item === item);
    const prev = again ? lane.sel : null;
    lane = { gi: gh.gi, item, opts, sel: nearestLane(item, gate, opts, gh.along), prev, pid: e.pointerId, t0: performance.now(), sx: e.clientX, sy: e.clientY, moved: false, pending: false, holding: true };
    if (again && laneVis) updateLane(); else showLane();
    hideGhost(); sfx.pick(); haptic(5);
    const v = gateViews[gh.gi]; if (v) v.flash = 1;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function laneMove(e) {
    const gp = pointerGrid(e); if (!gp) return;
    const gate = G.st.gates[lane.gi], along = E.sideAxis(gate.side) === 'x' ? gp.gy : gp.gx;
    if (Math.hypot(e.clientX - lane.sx, e.clientY - lane.sy) > 10) lane.moved = true;
    const k = nearestLane(lane.item, gate, lane.opts, along);
    if (k !== lane.sel) { lane.sel = k; updateLane(); sfx.click(); haptic(4); }
  }
  function laneUp(e, cancelled) {
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    lane.holding = false;
    if (cancelled) { lane.pending = true; return; }
    const quick = !lane.moved && performance.now() - lane.t0 < 320;
    if (!quick || (lane.prev !== null && lane.prev === lane.sel)) { confirmLane(); return; }
    lane.pending = true;
    if (!laneHintShown) { laneHintShown = true; toast('Bu kapıda birden fazla şerit var: parmağını kapı boyunca kaydırıp bırak ya da aynı şeride tekrar dokun.', 3800); }
  }
  function confirmLane() {
    const { item, gi, opts, sel } = lane, o = opts[sel];
    cancelLane();
    if (G.queue[0] !== item || G.busy || G.won) return;
    doEnter(item, gi, o);
  }

  /* ======================================================================
     GHOST HAND — short looping demos the first time a mechanic opens
     ====================================================================== */
  const TUT_AT = { 1: 'gate', 4: 'slide', 21: 'axis', 36: 'towel', 61: 'lid' };
  const tutMem = {};
  const tut = { kind: null, tl: null, holo: null, p: new THREE.Vector3(), press: 0, alpha: 0, fade: 0, trail: null, trailAlpha: 0, timer: 0, quietUntil: 0, hiddenId: null };
  function showReal(id, v) { const m = meshes.get(id); if (m) m.group.visible = v; tut.hiddenId = v ? null : id; }
  const tutEl = { root: $('#tut'), hand: $('#tutHand'), ripple: $('#tutRipple'), no: $('#tutNo'), path: $('#tutPath') };
  function tutDone(k) { if (tutMem[k]) return true; try { return localStorage.getItem('pj-tut-' + k) === '1'; } catch (e) { return false; } }
  function markTut(k) {
    tutMem[k] = true;
    try { localStorage.setItem('pj-tut-' + k, '1'); } catch (e) { /* ignore */ }
    if (tut.kind === k) stopTut(false);
  }
  function resetTuts() {
    tut.quietUntil = 0;
    for (const k of Object.values(TUT_AT)) { delete tutMem[k]; try { localStorage.removeItem('pj-tut-' + k); } catch (e) { /* ignore */ } }
  }
  /* after the player interrupts a demo, give them a quiet spell before it returns */
  function scheduleTut(ms) { clearTimeout(tut.timer); tut.timer = setTimeout(tryTut, Math.max(ms, tut.quietUntil - performance.now())); }
  function tutBlocked() {
    return G.screen !== 'play' || G.won || G.busy > 0 || !!drag || !!qdrag || !!lane || G.mode !== 'idle' || !el.helpOv.hidden || !el.buyOv.hidden || !el.settingsOv.hidden ||
      !el.failOv.hidden || !el.shakePick.hidden || !el.queueOv.hidden;
  }
  function tryTut() {
    if (tut.kind) return;
    const kind = TUT_AT[G.idx + 1];
    if (!kind || tutDone(kind)) return;
    if (tutBlocked()) { scheduleTut(900); return; }
    const plan = planTut(kind);
    if (plan) playTut(kind, plan);
  }
  function stopTut(interrupted) {
    clearTimeout(tut.timer);
    const was = tut.kind;
    if (tut.tl) { tut.tl.kill(); tut.tl = null; }
    if (tut.holo) { root.remove(tut.holo); tut.holo = null; }
    if (tut.hiddenId != null) showReal(tut.hiddenId, true);
    tut.kind = null; tut.trail = null; tut.alpha = 0; tut.trailAlpha = 0; tut.press = 0;
    tutEl.root.hidden = true; tutEl.no.classList.remove('on');
    if (!laneVis) setHoloAlpha(1);
    if (interrupted && was && !tutDone(was)) { tut.quietUntil = performance.now() + 6000; scheduleTut(6000); }
  }
  function slideTarget(b, axes) {
    const g = E.occ(G.st, b.id);
    let best = null;
    for (const ax of axes) {
      if (!E.canAxis(b, ax)) continue;
      const r = E.slideRange(G.st, b, ax, g), cur = ax === 'x' ? b.x : b.y;
      for (const t of [r.min, r.max]) { const d = Math.abs(t - cur); if (d && (!best || d > best.d)) best = { ax, t, d }; }
    }
    return best && { axis: best.ax, x: best.ax === 'x' ? best.t : b.x, y: best.ax === 'y' ? best.t : b.y, d: best.d };
  }
  function gatePlan(item) {
    if (!item || item.type !== 'block') return null;
    let best = null;
    G.st.gates.forEach((gate, gi) => {
      const opts = E.entryOptions(G.st, item, gate);
      if (opts.length && (!best || opts.length > best.opts.length)) best = { gi, opts };
    });
    return best && { type: 'gate', item, gi: best.gi, opts: best.opts };
  }
  function planTut(kind) {
    const head = G.queue[0], bl = G.st.blocks;
    if (kind === 'gate') return gatePlan(head);
    if (kind === 'slide') {
      const c = bl.filter(b => !b.fixed && !b.capped).map(b => ({ b, to: slideTarget(b, ['x', 'y']) })).filter(o => o.to);
      c.sort((a, o) => (itemOf(o.b) === 'console') - (itemOf(a.b) === 'console') || o.to.d - a.to.d);
      return c.length ? { type: 'slide', b: c[0].b, to: c[0].to } : null;
    }
    if (kind === 'axis') {
      for (const b of bl) {
        if ((b.axis !== 'h' && b.axis !== 'v') || b.capped) continue;
        const to = slideTarget(b, [b.axis === 'h' ? 'x' : 'y']);
        if (to) return { type: 'axis', b, to };
      }
      return head && head.type === 'block' && head.axis !== 'free' ? gatePlan(head) : null;
    }
    if (kind === 'towel') {
      for (const b of bl) {
        if (!b.soft || b.compressed) continue;
        const ax = b.softAxis, g = E.occ(G.st, b.id);
        for (const dir of [1, -1]) if (E.compressInfo(G.st, b, dir, g)) return { type: 'towel', b, dir, slide: null };
        const r = E.slideRange(G.st, b, ax, g), cur = ax === 'x' ? b.x : b.y;
        for (const dir of [1, -1]) {
          const t = dir > 0 ? r.max : r.min;
          if (t === cur) continue;
          const probe = Object.assign({}, b, ax === 'x' ? { x: t } : { y: t });
          if (E.compressInfo(G.st, probe, dir, g)) return { type: 'towel', b, dir, slide: { x: probe.x, y: probe.y } };
        }
      }
      return null;
    }
    if (kind === 'lid') {
      if (!head || head.type !== 'cap') return null;
      const b = E.blockById(G.st, head.baseId);
      return b && E.isSnug(G.st, b) ? { type: 'lid', b } : null;
    }
    return null;
  }
  function topOf(b, x, y, extra) { const c = blockCenter(b, x, y); c.y = heightOf(b) + (extra == null ? 0.06 : extra); return c; }
  function tutRipple() { tutEl.ripple.classList.remove('go'); void tutEl.ripple.offsetWidth; tutEl.ripple.classList.add('go'); }
  function playTut(kind, plan) {
    stopTut(false);
    tut.kind = kind;
    tutEl.root.hidden = false;
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.9 });
    tut.tl = tl;
    const P = tut.p;
    const moveHand = (pt, d, ease) => tl.to(P, { x: pt.x, y: pt.y, z: pt.z, duration: d, ease: ease || 'power2.inOut' });
    const press = () => { tl.to(tut, { press: 1, duration: 0.14, ease: 'power2.out' }); tl.call(tutRipple, null, '<'); };
    const release = () => tl.to(tut, { press: 0, duration: 0.16 });
    const trail = (a, b) => { tl.call(() => { tut.trail = [a, b]; }); tl.to(tut, { trailAlpha: 1, duration: 0.2 }); };
    const begin = (start, holo, holoPos) => {
      tl.set(P, { x: start.x, y: start.y, z: start.z }, 0);
      tl.set(tut, { alpha: 0, press: 0, fade: 0, trailAlpha: 0 }, 0);
      tl.call(() => { tut.trail = null; tutEl.no.classList.remove('on'); }, null, 0);
      if (holo) { tl.set(holo.position, { x: holoPos.x, y: holoPos.y, z: holoPos.z }, 0); tl.set(holo.scale, { x: 1, y: 1, z: 1 }, 0); tl.set(holo.rotation, { y: 0 }, 0); }
    };
    const away = p => new THREE.Vector3(p.x + 0.7, p.y + 1.1, p.z + 0.9);
    const end = () => { tl.to(tut, { alpha: 0, fade: 0, trailAlpha: 0, duration: 0.3 }, '+=0.5'); };

    if (plan.type === 'gate') {
      const { item, gi, opts } = plan, gate = G.st.gates[gi], cross = laneCross(gate, item);
      const o0 = opts[0], o1 = opts[opts.length - 1];
      const m0 = mouthPoint(gate, o0.offset, cross, 0.22), m1 = mouthPoint(gate, o1.offset, cross, 0.22);
      const h0 = blockCenter(item, o0.x, o0.y), h1 = blockCenter(item, o1.x, o1.y), land = blockCenter(item, o1.ex, o1.ey);
      const holo = holoOf(itemBlock(item)); root.add(holo); tut.holo = holo;
      const out = OUT[gate.side];
      begin(new THREE.Vector3(m0.x + out[0] * 0.9 + 0.3, 1.1, m0.z + out[1] * 0.9 + 0.6), holo, h0);
      moveHand(m0, 0.6); tl.to(tut, { alpha: 1, duration: 0.3 }, '<');
      press(); tl.to(tut, { fade: 1, duration: 0.2 }, '<');
      if (opts.length > 1) {
        trail(m0, m1);
        moveHand(m1, 0.85); tl.to(holo.position, { x: h1.x, z: h1.z, duration: 0.85, ease: 'power2.inOut' }, '<');
        tl.to({}, { duration: 0.15 });
      }
      release();
      tl.to(tut, { trailAlpha: 0, duration: 0.2 }, '<');
      tl.to(holo.position, { x: land.x, z: land.z, duration: 0.2 + 0.05 * h1.distanceTo(land), ease: 'power2.in' }, '<');
      tl.to(holo.scale, { x: 1.08, y: 0.9, z: 1.08, duration: 0.08, yoyo: true, repeat: 1 });
      end();
    } else if (plan.type === 'slide' || plan.type === 'axis') {
      const { b, to } = plan;
      const holo = holoOf(Object.assign({}, b)); root.add(holo); tut.holo = holo;
      const c0 = blockCenter(b), c1 = blockCenter(b, to.x, to.y), p0 = topOf(b), p1 = topOf(b, to.x, to.y);
      begin(away(p0), holo, new THREE.Vector3(c0.x, 0.02, c0.z));
      moveHand(p0, 0.55); tl.to(tut, { alpha: 1, duration: 0.3 }, '<');
      press(); tl.to(tut, { fade: 1, duration: 0.2 }, '<');
      if (plan.type === 'axis') {
        const wrong = p0.clone(); if (to.axis === 'x') wrong.z += 0.6; else wrong.x += 0.6;
        moveHand(wrong, 0.32);
        tl.call(() => tutEl.no.classList.add('on'));
        tl.to(holo.rotation, { y: 0.09, duration: 0.06, yoyo: true, repeat: 3 }, '<');
        moveHand(p0, 0.3, 'power2.out');
        tl.call(() => tutEl.no.classList.remove('on'));
      }
      trail(p0, p1);
      const d = 0.4 + c0.distanceTo(c1) * 0.12;
      moveHand(p1, d); tl.to(holo.position, { x: c1.x, z: c1.z, duration: d, ease: 'power2.inOut' }, '<');
      release();
      end();
    } else if (plan.type === 'towel') {
      const { b, dir, slide } = plan, ax = b.softAxis, k = ax === 'x' ? 'x' : 'z';
      const s = slide || { x: b.x, y: b.y };
      const holo = holoOf(Object.assign({}, b)); root.add(holo); tut.holo = holo;
      const c0 = blockCenter(b), c1 = blockCenter(b, s.x, s.y), p0 = topOf(b), p1 = topOf(b, s.x, s.y);
      const push = p1.clone(); push[k] += dir * 0.65;
      const squeezed = c1.clone(); squeezed[k] += dir * 0.5;
      begin(away(p0), holo, new THREE.Vector3(c0.x, 0.02, c0.z));
      tl.call(() => showReal(b.id, true), null, 0);
      moveHand(p0, 0.55); tl.to(tut, { alpha: 1, duration: 0.3 }, '<');
      press(); tl.to(tut, { fade: 1.5, duration: 0.2 }, '<'); tl.call(() => showReal(b.id, false));
      trail(p0, push);
      if (slide) {
        const d = 0.35 + c0.distanceTo(c1) * 0.1;
        moveHand(p1, d); tl.to(holo.position, { x: c1.x, z: c1.z, duration: d, ease: 'power2.inOut' }, '<');
      }
      moveHand(push, 0.5, 'power2.in');
      tl.to(holo.position, { [k]: squeezed[k], duration: 0.5, ease: 'power2.in' }, '<');
      tl.to(holo.scale, { [k]: 2 / 3, duration: 0.5, ease: 'power2.in' }, '<');
      tl.call(() => puff(squeezed.x - (k === 'x' ? dir : 0) * 1.1, squeezed.z - (k === 'z' ? dir : 0) * 1.1, 4, 0.5));
      tl.to(holo.scale, { y: 0.86, duration: 0.1, yoyo: true, repeat: 1 });
      release();
      tl.to({}, { duration: 0.35 });
      tl.call(() => showReal(b.id, true));
      tl.to(tut, { alpha: 0, fade: 0, trailAlpha: 0, duration: 0.35 });
    } else if (plan.type === 'lid') {
      const { b } = plan;
      const holo = holoify(buildLidGroup(b.w - GAP, b.h - GAP)); root.add(holo); tut.holo = holo;
      const c = blockCenter(b), p = topOf(b, null, null, 0.2);
      p.x += 0.42; p.z += 0.42;
      /* same path as the real lid: slides in from the nearest suitcase edge, then drops */
      const dl = c.x + G.st.W / 2, dr = G.st.W / 2 - c.x, dt = c.z + G.st.H / 2, db = G.st.H / 2 - c.z, mn = Math.min(dl, dr, dt, db);
      const ox = mn === dl ? -1 : mn === dr ? 1 : 0, oz = ox ? 0 : (mn === dt ? -1 : 1), far = mn + 1.4;
      const hi = new THREE.Vector3(c.x + ox * far, JEWEL_H + 0.3, c.z + oz * far), over = new THREE.Vector3(c.x, JEWEL_H + 0.3, c.z);
      begin(away(p), holo, hi);
      moveHand(p, 0.55); tl.to(tut, { alpha: 1, duration: 0.3 }, '<');
      press(); tl.to(tut, { fade: 1.7, duration: 0.25 }, '<');
      trail(hi.clone(), over);
      release();
      tl.to(holo.position, { x: over.x, z: over.z, duration: 0.55, ease: 'power2.out' }, '<');
      tl.to(holo.position, { y: JEWEL_H - 0.004, duration: 0.18, ease: 'power3.in' });
      tl.to(tut, { trailAlpha: 0, duration: 0.2 }, '-=0.2');
      tl.to({}, { duration: 0.4 });
      end();
    }
  }


  /* ======================================================================
     META — progress save, stars, coins, home screen, result screen
     ====================================================================== */
  const SAVE_KEY = 'pj-save-v1';
  const PRICES = { undo: 30, vac: 60, shake: 50 };
  const BOOST_NAME = { undo: 'Geri Al', vac: 'Vakum', shake: 'Silkele' };
  const CHEST_EVERY = 15, MAX_LEVEL = 100;
  const PHASES = [
    { n: 1, from: 1, to: 15, name: 'Temel Yerleşim' }, { n: 2, from: 16, to: 35, name: 'İlk Boşluklar' },
    { n: 3, from: 36, to: 60, name: 'Plaj Havlusu' }, { n: 4, from: 61, to: 85, name: 'Takı Kutusu ve Organizer' },
    { n: 5, from: 86, to: 100, name: 'Ultra Valiz' }
  ];
  const ZERO_GAP_LEVELS = new Set([90, 95, 100]);
  function loadSave() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') {
      let old = 0; try { old = parseInt(localStorage.getItem('pj-level') || '0', 10) || 0; } catch (e) { old = 0; }
      s = { stars: {}, best: {}, coins: 50, extras: {}, chests: 0, unlocked: Math.max(1, old + 1) };
    }
    s.stars = s.stars || {}; s.best = s.best || {}; s.extras = Object.assign({ undo: 0, vac: 0, shake: 0 }, s.extras || {});
    s.coins = Math.max(0, s.coins | 0); s.chests = s.chests | 0; s.unlocked = Math.max(1, s.unlocked | 0);
    return s;
  }
  const save = loadSave();
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage blocked: progress lives for this session */ } }
  function totalStars() { let t = 0; for (const k in save.stars) if (+k <= MAX_LEVEL) t += save.stars[k]; return t; }
  function chestState() { const t = totalStars(), into = t - save.chests * CHEST_EVERY; return { into: Math.max(0, into), ready: into >= CHEST_EVERY }; }

  /* boosters: the level's own allowance first, then spare ones bought in the market */
  const boostLeft = k => G.boost[k] + (save.extras[k] || 0);
  function useBoost(k) {
    if (G.boost[k] > 0) G.boost[k]--;
    else if (save.extras[k] > 0) { save.extras[k]--; persist(); }
    G.boostersUsed++;
    if (k !== 'undo') G.powerUsed++;
  }
  let buyKind = null;
  function offerBoost(k) {
    buyKind = k;
    const price = PRICES[k], can = save.coins >= price;
    $('#buyTitle').textContent = `${BOOST_NAME[k]} hakkın bitti`;
    $('#buyText').textContent = can ? `${price} jetonla 1 ${BOOST_NAME[k]} al. Jetonun: ${save.coins}.` : `Yeterli jetonun yok: ${price} gerekiyor, sende ${save.coins} var. Bölüm bitirerek jeton kazanırsın.`;
    $('#buyIcon').innerHTML = boosterOrb(k);
    const b = $('#buyOk'); b.disabled = !can; b.innerHTML = `${coinSVG(20)} ${price} jetonla al`;
    el.buyOv.hidden = false; sfx.pop();
  }
  function buyBoost(k) {
    const price = PRICES[k];
    if (save.coins < price) { sfx.deny(); return false; }
    save.coins -= price; save.extras[k] = (save.extras[k] || 0) + 1; persist();
    sfx.coin(); return true;
  }

  /* ---------- icons ---------- */
  function coinSVG(sz) {
    return `<svg class="coin-ico" width="${sz}" height="${sz}" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="21.5" r="17" fill="#B86A0B"/><circle cx="20" cy="19.5" r="17" fill="#FFC93C"/><circle cx="20" cy="19.5" r="12.5" fill="#FFB020" stroke="#FFE38A" stroke-width="2"/><rect x="13.5" y="16" width="13" height="10" rx="2.5" fill="#C9770A"/><path d="M17 16v-2.4a1.4 1.4 0 0 1 1.4-1.4h3.2a1.4 1.4 0 0 1 1.4 1.4V16" fill="none" stroke="#C9770A" stroke-width="2"/><path d="M8 13a14 14 0 0 1 9-7" stroke="#FFF3C4" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`;
  }
  const STAR_PATH = 'M50 6 63.5 34.5 94 38.5 71.5 59.5 77.5 90 50 75 22.5 90 28.5 59.5 6 38.5 36.5 34.5Z';
  function starSVG(filled, sz) {
    return `<svg width="${sz}" height="${sz}" viewBox="0 0 100 100" aria-hidden="true"><path d="${STAR_PATH}" fill="${filled ? '#FFB81C' : '#C9D1E0'}" stroke="${filled ? '#E88A00' : '#AEB8CB'}" stroke-width="7" stroke-linejoin="round"/></svg>`;
  }
  let starUid = 0;
  function bigStarSVG() {
    const id = 'sg' + (starUid++);
    return `<svg viewBox="-8 -8 116 116" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE15C"/><stop offset=".55" stop-color="#FFB319"/><stop offset="1" stop-color="#FF8A00"/></linearGradient></defs>
      <path class="slot" d="${STAR_PATH}" fill="#222B52" stroke="#323D6E" stroke-width="12" stroke-linejoin="round"/>
      <g class="gold"><path d="${STAR_PATH}" fill="#C3C0F2" stroke="#C3C0F2" stroke-width="16" stroke-linejoin="round" transform="translate(0 5)"/><path d="${STAR_PATH}" fill="url(#${id})" stroke="#D9D6FF" stroke-width="9" stroke-linejoin="round"/><path d="M50 18 59 37.5 80 40.5 64.5 55" fill="none" stroke="#FFF3B0" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/></g></svg>`;
  }
  const CHEST_SVG = `<svg viewBox="0 0 80 70" aria-hidden="true"><path d="M8 30h64v30a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z" fill="#8B4A22"/><path d="M8 30a32 18 0 0 1 64 0z" fill="#B0602C"/><g class="lid"><path d="M8 30a32 18 0 0 1 64 0z" fill="#B0602C"/><path d="M14 27a26 13 0 0 1 52 0" fill="none" stroke="#D98A4A" stroke-width="3"/></g><rect x="8" y="28" width="64" height="6" fill="#F2B53A"/><rect x="18" y="14" width="6" height="52" fill="#F2B53A"/><rect x="56" y="14" width="6" height="52" fill="#F2B53A"/><rect x="31" y="30" width="18" height="18" rx="4" fill="#FFD84A" stroke="#B87A12" stroke-width="2.5"/><path d="M40 34.5l1.9 3.8 4.2.6-3 2.9.7 4.2-3.8-2-3.8 2 .7-4.2-3-2.9 4.2-.6z" fill="#B87A12"/></svg>`;
  function boosterOrb(k) {
    const src = document.querySelector({ undo: '#bUndo', vac: '#bVac', shake: '#bShake' }[k]);
    return src ? src.querySelector('.orb').outerHTML.replace('class="orb"', `class="orb" style="--b:${src.style.getPropertyValue('--b')};--bd:${src.style.getPropertyValue('--bd')}"`) : '';
  }
  function animateCount(node, from, to, ms) {
    if (REDUCED || from === to) { node.textContent = to; return; }
    const o = { v: from };
    gsap.to(o, { v: to, duration: (ms || 700) / 1000, ease: 'power2.out', onUpdate: () => { node.textContent = Math.round(o.v); } });
  }
  const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function levelName(n) { try { return (n <= MAX_LEVEL ? E.designLevel(n, 0) : E.endlessLevel(n, 0)).name; } catch (e) { return 'Bölüm ' + n; } }
  function levelCode(n) { try { return (n <= MAX_LEVEL ? E.designLevel(n, 0) : E.endlessLevel(n, 0)).code; } catch (e) { return ''; } }
  function levelGrid(n) { try { const c = n <= MAX_LEVEL ? E.designLevel(n, 0) : E.endlessLevel(n, 0); return c.W + '×' + c.H; } catch (e) { return ''; } }

  /* ======================================================================
     3D HERO — the next trip's suitcase on a baggage turntable (home)
     ====================================================================== */
  let hero = null, heroTagFor = 0;
  function heroTagTex(n) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 384;
    const x = c.getContext('2d');
    x.fillStyle = '#F1D7A2'; rr(x, 8, 8, 240, 368, 34); x.fill();
    x.strokeStyle = '#C79A4E'; x.lineWidth = 6; rr(x, 8, 8, 240, 368, 34); x.stroke();
    x.fillStyle = '#B6DDE4'; x.beginPath(); x.arc(128, 52, 18, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#FFF3D6'; x.lineWidth = 6; x.stroke();
    x.setLineDash([12, 9]); x.strokeStyle = 'rgba(74,52,18,.35)'; x.lineWidth = 4; x.beginPath(); x.moveTo(28, 92); x.lineTo(228, 92); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#4A3412'; x.textAlign = 'center';
    x.font = '500 26px "DM Mono", ui-monospace, monospace'; x.fillText('BÖLÜM', 128, 138);
    const num = String(n), fs = num.length > 2 ? 96 : 128;
    x.font = `400 ${fs}px "Bungee", "Arial Black", sans-serif`; x.fillText(num, 128, 138 + fs * 0.95);
    x.font = '500 24px "DM Mono", ui-monospace, monospace'; x.fillText(levelCode(n), 128, 330);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  function stickerTex(kind) {
    return cachedTex('sticker|' + kind, 192, 192, (x, w, h) => {
      x.save(); x.translate(w / 2, h / 2);
      if (kind === 'ist') {
        x.fillStyle = '#FFFFFF'; x.beginPath(); x.arc(0, 0, 90, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#E5484D'; x.beginPath(); x.arc(0, 0, 80, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#FFFFFF'; x.font = '400 54px "Bungee", "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('IST', 0, 4);
      } else if (kind === 'plane') {
        x.fillStyle = '#FFFFFF'; rr(x, -88, -64, 176, 128, 26); x.fill();
        x.fillStyle = '#2F7FF0'; rr(x, -80, -56, 160, 112, 20); x.fill();
        x.fillStyle = '#FFFFFF'; x.rotate(-0.5);
        x.beginPath(); x.moveTo(-60, 0); x.lineTo(60, -8); x.lineTo(70, 0); x.lineTo(60, 8); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(0, -4); x.lineTo(-20, -46); x.lineTo(-6, -46); x.lineTo(26, -4); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(0, 4); x.lineTo(-20, 46); x.lineTo(-6, 46); x.lineTo(26, 4); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(-48, -2); x.lineTo(-62, -24); x.lineTo(-52, -24); x.lineTo(-38, -2); x.closePath(); x.fill();
      } else {
        x.rotate(-0.12);
        x.fillStyle = '#FFFFFF'; rr(x, -92, -40, 184, 80, 14); x.fill();
        x.fillStyle = '#18213D'; rr(x, -84, -32, 168, 64, 10); x.fill();
        x.fillStyle = '#FFD84A'; x.font = '400 34px "Bungee", "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('0 GAP', 0, 3);
      }
      x.restore();
    });
  }
  function buildHero() {
    const g = new THREE.Group(); g.position.y = -0.66; g.visible = false; scene.add(g);
    const base = new THREE.MeshPhysicalMaterial({ color: lin('#24345F'), roughness: 0.45, clearcoat: 0.4, envMapIntensity: 0.4 });
    const top = new THREE.MeshPhysicalMaterial({ color: lin('#30457A'), roughness: 0.5, clearcoat: 0.3, envMapIntensity: 0.35 });
    const ringM = new THREE.MeshStandardMaterial({ color: lin('#FFC53D'), roughness: 0.4, emissive: lin('#FFB020'), emissiveIntensity: 0.3 });
    addMesh(g, cylGeo(1.95, 0.24, 56), base);
    addMesh(g, cylGeo(1.72, 0.05, 56), top, 0, 0.24, 0);
    const ring = addMesh(g, new THREE.TorusGeometry(1.84, 0.05, 10, 72), ringM, 0, 0.27, 0, false); ring.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; addMesh(g, roundedBox(0.3, 0.03, 0.13, 0.02, 1), top, Math.cos(a) * 1.45, 0.29, Math.sin(a) * 1.45, false).rotation.y = -a; }
    const s = new THREE.Group(); s.position.y = 0.62; g.add(s);
    const shell = new THREE.MeshPhysicalMaterial({ color: lin('#FF6A3D'), roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15, envMapIntensity: 0.5 });
    const rib = new THREE.MeshPhysicalMaterial({ color: lin('#FF8659'), roughness: 0.3, clearcoat: 0.7, envMapIntensity: 0.5 });
    const navy = new THREE.MeshPhysicalMaterial({ color: lin('#1D2440'), roughness: 0.45, clearcoat: 0.3, envMapIntensity: 0.35 });
    const W = 2.3, Hb = 2.9, D = 1.1;
    addMesh(s, roundedBox(W, Hb, D, 0.3, 3), shell);
    addMesh(s, roundedBox(W + 0.04, Hb + 0.04, 0.07, 0.3, 3), navy, 0, -0.02, 0);
    for (const rx of [-0.66, 0, 0.66]) { addMesh(s, roundedBox(0.34, 2.25, 0.05, 0.05, 2), rib, rx, 0.32, D / 2 - 0.01); addMesh(s, roundedBox(0.34, 2.25, 0.05, 0.05, 2), rib, rx, 0.32, -D / 2 - 0.04); }
    for (const [cx, cz] of [[-0.82, 0.34], [0.82, 0.34], [-0.82, -0.34], [0.82, -0.34]]) {
      addMesh(s, roundedBox(0.26, 0.12, 0.26, 0.05, 1), navy, cx, -0.1, cz);
      const wh = addMesh(s, cylGeo(0.12, 0.1, 18), M.rubber, cx, -0.2, cz); wh.rotation.z = Math.PI / 2; wh.position.x = cx - 0.05;
    }
    for (const hx of [-0.42, 0.42]) addMesh(s, cylGeo(0.04, 0.95, 12), M.metal, hx, Hb - 0.02, -0.18);
    addMesh(s, roundedBox(1.08, 0.16, 0.2, 0.07, 2), navy, 0, Hb + 0.9, -0.18);
    const carry = addMesh(s, new THREE.TorusGeometry(0.3, 0.06, 10, 22, Math.PI), navy, 0, Hb - 0.02, 0.18); carry.scale.set(1, 0.55, 1);
    const tag = new THREE.Group(); tag.position.set(0.5, Hb - 0.02, D / 2 + 0.07); s.add(tag);
    addMesh(tag, roundedBox(0.06, 0.32, 0.03, 0.015, 1), navy, 0, -0.3, 0);
    const tagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
    const plate = addMesh(tag, roundedBox(0.64, 0.96, 0.035, 0.06, 2), [M.slate, M.slate, M.slate, M.slate, tagMat, M.slate], 0, -1.24, 0);
    plate.rotation.z = 0.08;
    const stickers = [['ist', -0.62, 1.95, 0.62], ['plane', 0.52, 0.78, 0.6], ['gap', -0.25, 0.55, 0.66]];
    for (const [k, sx, sy, sz] of stickers) {
      const m = new THREE.Mesh(planeGeo(sz, sz), new THREE.MeshStandardMaterial({ map: stickerTex(k), transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.position.set(sx, sy, D / 2 + 0.045); m.rotation.z = (k === 'plane' ? 0.12 : k === 'gap' ? -0.06 : 0); s.add(m);
    }
    hero = { g, s, tag, tagMat, ringM, box: new THREE.Box3() };
    hero.box.setFromObject(g).expandByScalar(0.15);
  }
  function setHeroLevel(n) {
    if (!hero) buildHero();
    if (heroTagFor === n) return;
    if (hero.tagMat.map) hero.tagMat.map.dispose();
    hero.tagMat.map = heroTagTex(n); hero.tagMat.needsUpdate = true; heroTagFor = n;
  }
  function fitHomeCamera() {
    const w = app.clientWidth, h = app.clientHeight;
    if (!w || !h || !hero) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const ar = app.getBoundingClientRect();
    const top = Math.max(0, el.homeTop.getBoundingClientRect().bottom - ar.top);
    const ctaTop = el.homeCta.hidden ? el.tabbar.getBoundingClientRect().top : el.homeCta.getBoundingClientRect().top;
    const bot = Math.max(0, ar.bottom - ctaTop);
    const freeH = Math.max(160, h - top - bot);
    camera.setViewOffset(w, h, 0, -((top + freeH / 2) - h / 2), w, h);
    const target = hero.box.getCenter(new THREE.Vector3()), dir = new THREE.Vector3(0, Math.sin(0.2), Math.cos(0.2));
    const pts = [], b = hero.box, v = new THREE.Vector3();
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new THREE.Vector3(x, y, z));
    let lo = 4, hi = 120;
    for (let i = 0; i < 28; i++) {
      const d = (lo + hi) / 2;
      camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      let ok = true;
      for (const p of pts) { v.copy(p).project(camera); const px = (v.x + 1) / 2 * w, py = (1 - v.y) / 2 * h; if (px < 24 || px > w - 24 || py < top + 6 || py > h - bot - 6) { ok = false; break; } }
      if (ok) hi = d; else lo = d;
    }
    camera.position.copy(target).addScaledVector(dir, hi); camera.lookAt(target); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    const sc = sun.shadow.camera; sc.left = -5; sc.right = 5; sc.top = 5; sc.bottom = -5; sc.updateProjectionMatrix();
  }
  function fitView() { if (G.screen === 'play') fitCamera(); else fitHomeCamera(); }

  /* ======================================================================
     SCREENS
     ====================================================================== */
  function nextLevel() { return save.unlocked; }
  function showHome(tab, opts) {
    opts = opts || {};
    G.screen = 'home';
    stopTut(false); cancelLane(); closeFail(); closeQueueSheet();
    el.helpOv.hidden = true; el.shakePick.hidden = true; el.result.hidden = true;
    gsap.killTweensOf(root.position); root.visible = false;
    el.hudTop.hidden = true; el.hudBottom.hidden = true; el.home.hidden = false;
    setHeroLevel(nextLevel()); hero.g.visible = true;
    setTab(tab || 'home');
    updateHome(opts.fromCoins);
    fitHomeCamera();
  }
  function enterPlay(i) {
    G.screen = 'play';
    el.home.hidden = true; el.result.hidden = true; el.settingsOv.hidden = true;
    el.hudTop.hidden = false; el.hudBottom.hidden = false;
    if (hero) hero.g.visible = false;
    root.visible = true;
    loadLevel(i);
    fitCamera();
    let seen = false; try { seen = localStorage.getItem('pj-seen-help') === '1'; } catch (e) { /* ignore */ }
    if (!seen) el.helpOv.hidden = false;
  }
  function updateHome(fromCoins) {
    const n = nextLevel(), t = totalStars(), ch = chestState();
    $('#hStars').textContent = t;
    if (fromCoins != null) animateCount($('#hCoins'), fromCoins, save.coins, 900); else $('#hCoins').textContent = save.coins;
    $('#playNum').textContent = n;
    $('#playTrip').textContent = `${levelName(n)} · ${levelCode(n)} · ${levelGrid(n)}`;
    $('#chestFill').style.width = Math.min(100, ch.into / CHEST_EVERY * 100) + '%';
    $('#chestTxt').textContent = ch.ready ? 'AÇ!' : `${ch.into}/${CHEST_EVERY}`;
    el.btnChest.classList.toggle('ready', ch.ready);
    el.btnChest.setAttribute('aria-label', ch.ready ? 'Yıldız sandığı hazır: aç' : `Yıldız sandığı: ${ch.into}/${CHEST_EVERY} yıldız`);
  }
  let homeTab = 'home';
  function setTab(tab) {
    homeTab = tab;
    document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    el.panelShop.hidden = tab !== 'shop'; el.panelMap.hidden = tab !== 'map';
    el.homeCta.hidden = tab !== 'home';
    if (tab === 'shop') renderShop();
    if (tab === 'map') renderMap();
    if (G.screen === 'home') fitHomeCamera();
  }
  function renderShop() {
    $('#shopCoins').innerHTML = `${coinSVG(22)} <b>${save.coins}</b>`;
    const desc = { undo: 'Son hamleyi geri alır.', vac: 'Bir eşyayı bir boy küçültür, boşluğa joker parfüm verir.', shake: 'Bavulu sallar, eşyaları bir yöne presler.' };
    $('#shopList').innerHTML = ['undo', 'vac', 'shake'].map(k => `<li class="shop-item">${boosterOrb(k)}<div class="si-txt"><b>${BOOST_NAME[k]}</b><span>${desc[k]}</span><small>Yedek: ${save.extras[k]}</small></div><button class="buy-btn" type="button" data-buy="${k}"${save.coins < PRICES[k] ? ' disabled' : ''}>${coinSVG(20)}<span>${PRICES[k]}</span></button></li>`).join('');
  }
  function renderMap() {
    const t = totalStars(), cur = nextLevel();
    $('#mapStars').innerHTML = `${starSVG(true, 18)} <b>${t}</b>/300`;
    let html = '';
    for (const ph of PHASES) {
      let got = 0; for (let n = ph.from; n <= ph.to; n++) got += save.stars[n] || 0;
      html += `<section class="map-sec"><h3><span>Faz ${ph.n} · ${ph.name}</span><span>${got}/${(ph.to - ph.from + 1) * 3}</span></h3><div class="map-grid">`;
      for (let n = ph.from; n <= ph.to; n++) {
        const locked = n > cur, st = save.stars[n] || 0, isCur = n === cur;
        const stars = locked ? `<span class="lock">${LOCK_SVG}</span>` : `<span class="st">${starSVG(st > 0, 12)}${starSVG(st > 1, 12)}${starSVG(st > 2, 12)}</span>`;
        html += `<button type="button" class="lv${ZERO_GAP_LEVELS.has(n) ? ' zg' : ''}${isCur ? ' cur' : ''}${locked ? ' locked' : ''}" data-lv="${n}"${locked ? ' aria-disabled="true"' : ''} aria-label="Bölüm ${n}${locked ? ', kilitli' : `, ${st} yıldız`}"><span class="lv-n">${n}</span>${stars}</button>`;
      }
      html += '</div></section>';
    }
    if (cur > MAX_LEVEL) html += `<section class="map-sec"><h3><span>Sonsuz Sefer</span><span>${cur - MAX_LEVEL - 1} bavul</span></h3><div class="map-grid"><button type="button" class="lv cur endless" data-lv="${cur}"><span class="lv-n">${cur}</span><span class="st">∞</span></button></div></section>`;
    $('#mapList').innerHTML = html;
    const c = $('#mapList .lv.cur');
    if (c) requestAnimationFrame(() => { el.panelMap.scrollTop = Math.max(0, c.offsetTop - el.panelMap.clientHeight / 2); });
  }
  const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.5" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  function openChest() {
    const ch = chestState();
    if (!ch.ready) { toast(`Sandık ${CHEST_EVERY} yıldızda açılır. ${CHEST_EVERY - ch.into} yıldız kaldı.`); sfx.deny(); return; }
    const before = save.coins, k = ['undo', 'vac', 'shake'][save.chests % 3];
    save.chests++; save.coins += 60; save.extras[k]++; persist();
    sfx.win(); haptic(30);
    if (!REDUCED) gsap.fromTo(el.btnChest, { scale: 1 }, { scale: 1.25, duration: 0.15, yoyo: true, repeat: 1, ease: 'power2.out' });
    toast(`Yıldız sandığı açıldı: +60 jeton ve +1 ${BOOST_NAME[k]}.`, 3200);
    updateHome(before);
  }

  /* ======================================================================
     RESULT — stars, time, goals, coins after the suitcase closes
     ====================================================================== */
  let resTl = null, resReady = false;
  function showResult() {
    G.screen = 'result';
    const n = G.idx + 1, par = G.level.solution.length, target = Math.ceil(par * 1.1) + 1;
    const goals = [
      { ok: true, text: 'Bavulu kapat', val: '' },
      { ok: G.powerUsed === 0, text: 'Vakum ve Silkele kullanma', val: G.powerUsed ? `${G.powerUsed} kez` : '' },
      { ok: G.moves <= target, text: `En fazla ${target} hamle`, val: `${G.moves} hamle` }
    ];
    const stars = goals.filter(g => g.ok).length;
    const prev = save.stars[n] || 0, first = !(n in save.stars);
    const coins = first ? 10 + 5 * stars : 5 * Math.max(0, stars - prev);
    const coinsBefore = save.coins;
    save.stars[n] = Math.max(prev, stars);
    save.best[n] = Math.min(save.best[n] || 1e9, G.moves);
    save.coins += coins;
    save.unlocked = Math.max(save.unlocked, n + 1);
    persist();
    try { localStorage.setItem('pj-level', String(save.unlocked - 1)); } catch (e) { /* ignore */ }
    const secs = G.t0 ? (performance.now() - G.t0) / 1000 : 0;
    const total = G.st.W * G.st.H, pct = Math.round(E.filledCount(G.st) / total * 100), zero = G.level.gapCount === 0;
    $('#resTitle').textContent = stars === 3 ? 'Muhteşem!' : stars === 2 ? 'Harika!' : 'Paketlendi!';
    $('#resFill').textContent = zero ? 'ZERO GAP · %100 DOLU' : `%${pct} DOLU · HEDEF %${Math.round(G.level.targetCells / total * 100)}`;
    $('#resTime').textContent = fmtTime(secs);
    $('#resGoals').innerHTML = goals.map(g => `<li class="${g.ok ? 'ok' : ''}"><span class="gi">${starSVG(g.ok, 20)}</span><span>${g.text}</span><span class="gv">${g.ok ? '✓' : ''}${g.val ? ' ' + g.val : ''}</span></li>`).join('');
    $('#resCoins').textContent = '+0';
    $('#resNote').textContent = coins ? (first ? 'İlk kez paketledin.' : `Yeni rekor: +${stars - prev} yıldız.`) : (prev >= 3 ? 'Bu bavulda zaten 3 yıldızın var.' : `En iyin ${prev} yıldız. Jeton için rekorunu geç.`);
    const starEls = Array.from(document.querySelectorAll('#resStars .rstar'));
    starEls.forEach((s, i) => { s.classList.toggle('won', i < stars); });
    el.result.hidden = false; resReady = false;
    el.hudTop.hidden = true; el.hudBottom.hidden = true;
    if (resTl) resTl.kill();
    const tl = gsap.timeline({ onComplete: () => { resReady = true; } });
    resTl = tl;
    const golds = starEls.map(s => s.querySelector('.gold'));
    gsap.set(golds, { opacity: 0, scale: 2.3, rotation: -35, transformOrigin: '50% 50%' });
    gsap.set(['#resTitle', '#resFill', '.res-time', '#resGoals li', '.res-coins', '#resNote', '.res-tap', '#btnResReplay'], { opacity: 0, y: 14 });
    tl.fromTo('#resTitle', { opacity: 0, scale: 0.4, y: 0 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2.2)' }, 0.1)
      .to('#resFill', { opacity: 1, y: 0, duration: 0.3 }, 0.35);
    for (let i = 0; i < stars; i++) {
      tl.to(golds[i], { opacity: 1, scale: 1, rotation: 0, duration: 0.42, ease: 'back.out(2.4)', onStart: () => { sfx.star(i); haptic(12); } }, 0.6 + i * 0.32)
        .call(() => starBurst(starEls[i]), null, 0.85 + i * 0.32);
    }
    const after = 0.7 + stars * 0.32;
    tl.to('.res-time', { opacity: 1, y: 0, duration: 0.3 }, after)
      .to('#resGoals li', { opacity: 1, y: 0, duration: 0.28, stagger: 0.08 }, after + 0.1)
      .to('.res-coins', { opacity: 1, y: 0, duration: 0.3 }, after + 0.4)
      .call(() => { if (coins) { const o = { v: 0 }; gsap.to(o, { v: coins, duration: 0.65, onUpdate: () => { $('#resCoins').textContent = '+' + Math.round(o.v); } }); sfx.coin(); } }, null, after + 0.5)
      .to('#resNote', { opacity: 1, y: 0, duration: 0.3 }, after + 0.7)
      .to(['.res-tap', '#btnResReplay'], { opacity: 1, y: 0, duration: 0.3 }, after + 0.9);
    if (REDUCED) tl.progress(1);
    el.result.dataset.coinsBefore = coinsBefore;
  }
  function starBurst(node) {
    if (REDUCED || !node) return;
    for (let k = 0; k < 10; k++) {
      const s = document.createElement('span'); s.className = 'spark'; node.appendChild(s);
      const a = k / 10 * Math.PI * 2, d = 60 + Math.random() * 30;
      gsap.fromTo(s, { x: 0, y: 0, scale: 1, opacity: 1 }, { x: Math.cos(a) * d, y: Math.sin(a) * d, scale: 0.2, opacity: 0, duration: 0.6, ease: 'power2.out', onComplete: () => s.remove() });
    }
  }
  function leaveResult(replay) {
    if (!resReady && resTl) { resTl.progress(1); return; }
    const before = +el.result.dataset.coinsBefore || save.coins;
    el.result.hidden = true;
    if (replay) enterPlay(G.idx); else showHome('home', { fromCoins: before });
  }

  /* ======================================================================
     INPUT — the conveyor tray (tap to select, drag onto a gate)
     ====================================================================== */
  let qdrag = null;
  function onTrayDown(e) {
    sfx.unlock();
    if (tut.kind) stopTut(true);
    cancelLane();
    if (G.busy || G.won || drag) return;
    if (!G.queue[0]) return;
    e.preventDefault();
    qdrag = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, active: false, snap: null, el: e.currentTarget };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function nearestEntry(item, gp) {
    let best = null, bd = 1.9;
    G.st.gates.forEach((gate, gi) => {
      const ax = E.sideAxis(gate.side), cross = ax === 'x' ? item.h : item.w;
      for (const o of E.entryOptions(G.st, item, gate)) {
        const mid = o.offset + cross / 2;
        const mx = gate.side === 'left' ? -0.4 : gate.side === 'right' ? G.st.W + 0.4 : mid;
        const my = gate.side === 'top' ? -0.4 : gate.side === 'bottom' ? G.st.H + 0.4 : mid;
        const dd = Math.hypot(gp.gx - mx, gp.gy - my);
        if (dd < bd) { bd = dd; best = { gi, opt: o }; }
      }
    });
    return best;
  }
  function updateQueueDrag(e) {
    const item = G.queue[0], gp = pointerGrid(e);
    if (!item || !gp) { hideGhost(); return; }
    qdrag.snap = null;
    if (item.type === 'block') {
      const n = nearestEntry(item, gp);
      if (n) { qdrag.snap = n; showGhost(item, n.opt.ex, n.opt.ey, true); return; }
      showGhost(item, gp.gx - item.w / 2, gp.gy - item.h / 2, false, 0.45);
    } else if (item.type === 'sock') {
      const cx = Math.floor(gp.gx), cy = Math.floor(gp.gy);
      if (cx >= 0 && cy >= 0 && cx < G.st.W && cy < G.st.H && !E.occ(G.st)[cy * G.st.W + cx]) { qdrag.snap = { cx, cy }; showGhost(item, cx, cy, true, 0.25); }
      else showGhost(item, gp.gx - 0.5, gp.gy - 0.5, false, 0.6);
    } else if (item.type === 'cap') {
      const b = E.blockById(G.st, item.baseId);
      if (b && gp.gx >= b.x - 0.6 && gp.gx <= b.x + b.w + 0.6 && gp.gy >= b.y - 0.6 && gp.gy <= b.y + b.h + 0.6) { qdrag.snap = { cap: true }; showGhost(item, b.x, b.y, true, heightOf(b)); }
      else showGhost(item, gp.gx - item.w / 2, gp.gy - item.h / 2, false, 0.9);
    }
  }
  window.addEventListener('pointermove', e => {
    if (!qdrag || e.pointerId !== qdrag.pid) return;
    if (!qdrag.active && Math.hypot(e.clientX - qdrag.sx, e.clientY - qdrag.sy) > 9) {
      qdrag.active = true; G.selected = false;
      if (qdrag.el) qdrag.el.classList.add('dragging');
      sfx.pick();
    }
    if (qdrag.active) updateQueueDrag(e);
  });
  function endQueueDrag(e, cancelled) {
    if (!qdrag || e.pointerId !== qdrag.pid) return;
    const q = qdrag; qdrag = null;
    if (q.el) q.el.classList.remove('dragging');
    const item = G.queue[0];
    if (!item) { hideGhost(); return; }
    if (!q.active) { if (!cancelled) onTrayTap(item); return; }
    hideGhost();
    if (cancelled || !q.snap) { renderQueue(); return; }
    if (item.type === 'block') doEnter(item, q.snap.gi, q.snap.opt);
    else if (item.type === 'sock') placeSock(q.snap.cx, q.snap.cy);
    else if (item.type === 'cap') placeCap();
  }
  window.addEventListener('pointerup', e => endQueueDrag(e, false));
  window.addEventListener('pointercancel', e => endQueueDrag(e, true));
  function onTrayTap(item) {
    if (item.type === 'cap') { placeCap(); return; }
    if (item.type === 'sock') { toast('Joker parfüm: bavulda boş bir kareye dokun.'); sfx.pop(); return; }
    G.selected = !G.selected;
    sfx.pop();
    if (G.selected) {
      const any = gateViews.some(v => v.valid);
      toast(any ? 'Şimdi parlayan bir kapıya dokun.' : 'Hiçbir kapı uygun değil: içerideki blokları kaydır.');
      gateViews.forEach(v => { if (v.valid) v.flash = 1; });
    }
    renderQueue();
  }

  /* ======================================================================
     BOOSTER + MENU BUTTONS
     ====================================================================== */
  el.bUndo.addEventListener('click', () => { sfx.unlock(); stopTut(true); cancelLane(); doUndo(); });
  el.bVac.addEventListener('click', () => {
    sfx.unlock();
    if (G.busy || G.won) return;
    stopTut(true); cancelLane();
    if (G.mode === 'vacuum') { G.mode = 'idle'; updateHUD(); toast('Vakum iptal edildi.'); return; }
    if (boostLeft('vac') <= 0) { offerBoost('vac'); return; }
    if (!G.st.blocks.some(b => !b.fixed && !b.sock && !b.base && !b.capped && b.w * b.h > 1)) { toast('İçeride vakumlanacak blok yok.'); sfx.deny(); return; }
    G.mode = 'vacuum'; G.selected = false; closeFail(); updateHUD(); renderQueue();
    toast('Vakum hazır: küçültmek istediğin bloğa dokun.', 2600); sfx.pop();
  });
  el.bShake.addEventListener('click', () => {
    sfx.unlock();
    if (G.busy || G.won) return;
    if (boostLeft('shake') <= 0) { offerBoost('shake'); return; }
    stopTut(true); cancelLane();
    G.mode = 'idle'; closeFail(); updateHUD();
    el.shakePick.hidden = false; sfx.pop();
    const first = el.shakePick.querySelector('button[data-dir]'); if (first) first.focus({ preventScroll: true });
  });
  el.shakePick.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) { if (e.target === el.shakePick) el.shakePick.hidden = true; return; }
    if (btn.id === 'shakeCancel') { el.shakePick.hidden = true; return; }
    if (btn.dataset.dir) doShake(btn.dataset.dir);
  });
  $('#btnRestart').addEventListener('click', () => { sfx.unlock(); if (G.won && G.busy) return; loadLevel(G.idx); toast('Bavul boşaltıldı, baştan başla.'); });
  el.btnSound.addEventListener('click', () => { sfx.unlock(); sfx.setMuted(!sfx.muted); setSoundIcon(); });
  $('#btnHome').addEventListener('click', () => { sfx.unlock(); if (G.won && G.busy) return; showHome('home'); });
  $('#btnPlay').addEventListener('click', () => { sfx.unlock(); sfx.pop(); enterPlay(nextLevel() - 1); });
  el.btnChest.addEventListener('click', () => { sfx.unlock(); openChest(); });
  el.tabbar.addEventListener('click', e => { const b = e.target.closest('.tab'); if (!b) return; sfx.unlock(); sfx.click(); setTab(b.dataset.tab); });
  $('#mapList').addEventListener('click', e => {
    const b = e.target.closest('.lv'); if (!b) return; sfx.unlock();
    const n = +b.dataset.lv;
    if (n > nextLevel()) { sfx.deny(); toast(`Bölüm ${n} kilitli. Önce Bölüm ${nextLevel()}'i bitir.`); return; }
    sfx.pop(); enterPlay(n - 1);
  });
  $('#shopList').addEventListener('click', e => {
    const b = e.target.closest('[data-buy]'); if (!b) return; sfx.unlock();
    const k = b.dataset.buy, before = save.coins;
    if (buyBoost(k)) { toast(`+1 ${BOOST_NAME[k]} yedeğe eklendi.`); renderShop(); animateCount($('#hCoins'), before, save.coins, 500); }
  });
  $('#btnSettings').addEventListener('click', () => { sfx.unlock(); setSoundIcon(); $('#setReset').dataset.armed = ''; $('#setReset').textContent = 'İlerlemeyi sıfırla'; el.settingsOv.hidden = false; });
  $('#setClose').addEventListener('click', () => { el.settingsOv.hidden = true; });
  el.settingsOv.addEventListener('click', e => { if (e.target === el.settingsOv) el.settingsOv.hidden = true; });
  $('#setTips').addEventListener('click', () => { resetTuts(); toast('El ipuçları 1, 4, 21, 36 ve 61. bölümlerde yeniden görünecek.', 3000); });
  $('#setReset').addEventListener('click', e => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Emin misin? Tekrar dokun: yıldızlar ve jetonlar silinir'; return; }
    Object.assign(save, { stars: {}, best: {}, coins: 50, extras: { undo: 0, vac: 0, shake: 0 }, chests: 0, unlocked: 1 }); persist(); resetTuts();
    try { localStorage.setItem('pj-level', '0'); } catch (err) { /* ignore */ }
    el.settingsOv.hidden = true; heroTagFor = 0; showHome('home'); toast('İlerleme sıfırlandı.');
  });
  $('#buyOk').addEventListener('click', () => {
    if (!buyKind) return;
    if (buyBoost(buyKind)) { el.buyOv.hidden = true; updateHUD(); toast(`+1 ${BOOST_NAME[buyKind]} alındı. Kullanmak için tekrar dokun.`); }
  });
  $('#buyNo').addEventListener('click', () => { el.buyOv.hidden = true; });
  el.buyOv.addEventListener('click', e => { if (e.target === el.buyOv) el.buyOv.hidden = true; });
  el.result.addEventListener('click', e => { if (e.target.closest('#btnResReplay')) { if (resReady) leaveResult(true); else leaveResult(false); return; } leaveResult(false); });
  $('#btnHelp').addEventListener('click', () => { stopTut(true); cancelLane(); el.helpOv.hidden = false; $('#btnStart').focus({ preventScroll: true }); });
  $('#btnStart').addEventListener('click', () => { sfx.unlock(); el.helpOv.hidden = true; try { localStorage.setItem('pj-seen-help', '1'); } catch (e) { /* ignore */ } toast(G.level.cfg.intro || 'İyi paketlemeler!', 4200); scheduleTut(700); });
  $('#btnTips').addEventListener('click', () => {
    resetTuts(); el.helpOv.hidden = true; scheduleTut(500);
    toast(TUT_AT[G.idx + 1] ? 'El ipuçları yeniden açıldı.' : 'El ipuçları yeniden açıldı: 1, 4, 21, 36 ve 61. bölümlerde görünür.', 3200);
  });
  el.btnQueue.addEventListener('click', () => { sfx.unlock(); openQueueSheet(); });
  $('#queueClose').addEventListener('click', closeQueueSheet);
  el.queueOv.addEventListener('click', e => { if (e.target === el.queueOv) closeQueueSheet(); });
  el.belt.addEventListener('scroll', updateBeltFade, { passive: true });
  $('#stamp').addEventListener('click', () => {
    const lv = G.level, n = lv.queue.filter(q => q.type === 'block').length;
    const gaps = lv.gapCount ? `${lv.gapCount} kare planlı boşluk bırakılarak` : 'tek boşluk bırakmadan';
    toast(`Tersine üretildi: ${lv.W}×${lv.H} bavul ${gaps} döşendi, ${n} eşya kapılardan çıkarıldı, ${lv.solution.length} adımlık çözüm kurallarla yeniden oynanıp doğrulandı.`, 5600);
  });
  $('#fUndo').addEventListener('click', () => { doUndo(); });
  $('#fRestart').addEventListener('click', () => { closeFail(); loadLevel(G.idx); });
  $('#fClose').addEventListener('click', () => { closeFail(); toast('Vakum ya da Silkele ile yer açmayı dene.'); });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { el.shakePick.hidden = true; el.buyOv.hidden = true; el.settingsOv.hidden = true; closeQueueSheet(); cancelLane(); if (G.mode === 'vacuum') { G.mode = 'idle'; updateHUD(); } }
    if (G.screen === 'play' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
  });

  function openFail(full) {
    if (G.failOpen) return;
    G.failOpen = true;
    const head = G.queue[0];
    let txt = 'Sıradaki eşya hiçbir kapıdan giremiyor ve içeride kıpırdayabilen blok kalmadı.';
    if (full) txt = 'Bavul doldu ama kuyrukta eşya kaldı. Havluları sıkıştırmak ya da Vakum kullanmak yer açar.';
    else if (head && head.type === 'cap') txt = 'Kapak sırada ama takı kutusu yerine oturmuyor ve hiçbir eşya kıpırdayamıyor.';
    else if (G.level.gapCount > 0) txt = 'Yer var ama dağınık: sıradaki eşya hiçbir kapıdan giremiyor ve içeride kıpırdayabilen eşya kalmadı.';
    $('#failText').textContent = txt;
    $('#fUndo').textContent = boostLeft('undo') > 0 && G.undo.length ? `Son hamleyi geri al (${boostLeft('undo')})` : G.undo.length ? `Geri al (${PRICES.undo} jeton)` : 'Geri alınacak hamle yok';
    $('#fUndo').disabled = !G.undo.length;
    el.failOv.hidden = false; sfx.fail(); haptic([30, 60, 30]);
  }
  function closeFail() { el.failOv.hidden = true; G.failOpen = false; }

  /* ======================================================================
     WIN SEQUENCE — lid swings shut, zipper runs, contents press, confetti
     ====================================================================== */
  function buildLid() {
    const w = G.st.W, h = G.st.H, T = WALL_T, OW = w + 2 * T + 0.16, OH = h + 2 * T + 0.16, skirt = 0.62;
    const mat = new THREE.MeshPhysicalMaterial({ color: lin('#7FB8FF'), roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 });
    const rim = new THREE.MeshPhysicalMaterial({ color: lin('#2A3A66'), roughness: 0.4, clearcoat: 0.4, transparent: true, opacity: 0 });
    const pivot = new THREE.Group(); pivot.position.set(0, WALL_H, -OH / 2); suit.add(pivot);
    const lid = new THREE.Group(); pivot.add(lid);
    const plate = new THREE.Mesh(roundedBox(OW, 0.12, OH, 0.22, 3), mat); plate.position.set(0, skirt, OH / 2); plate.renderOrder = 5; lid.add(plate);
    const sk = 0.12;
    for (const [sw, sd, x, z] of [[OW, sk, 0, sk / 2], [OW, sk, 0, OH - sk / 2], [sk, OH, -OW / 2 + sk / 2, OH / 2], [sk, OH, OW / 2 - sk / 2, OH / 2]]) {
      const s = new THREE.Mesh(roundedBox(sw, skirt, sd, 0.05, 2), rim); s.position.set(x, 0, z); lid.add(s);
    }
    for (const k of [-1, 0, 1]) {
      const rib = new THREE.Mesh(roundedBox(0.16, 0.05, OH - 0.8, 0.025, 2), rim); rib.position.set(k * OW * 0.26, skirt + 0.12, OH / 2); lid.add(rib);
    }
    const handle = new THREE.Mesh(roundedBox(1.4, 0.12, 0.26, 0.06, 2), rim); handle.position.set(0, skirt + 0.12, OH - 0.45); lid.add(handle);
    return { pivot, mats: [mat, rim], OW, OH };
  }
  function buildZipper(OW, OH) {
    const y = WALL_H + 0.01, x = OW / 2 + 0.03, z = OH / 2 + 0.03, r = 0.3;
    const V = (a, b) => new THREE.Vector3(a, y, b);
    const path = new THREE.CurvePath();
    path.add(new THREE.LineCurve3(V(-x + r, -z), V(x - r, -z)));
    path.add(new THREE.QuadraticBezierCurve3(V(x - r, -z), V(x, -z), V(x, -z + r)));
    path.add(new THREE.LineCurve3(V(x, -z + r), V(x, z - r)));
    path.add(new THREE.QuadraticBezierCurve3(V(x, z - r), V(x, z), V(x - r, z)));
    path.add(new THREE.LineCurve3(V(x - r, z), V(-x + r, z)));
    path.add(new THREE.QuadraticBezierCurve3(V(-x + r, z), V(-x, z), V(-x, z - r)));
    path.add(new THREE.LineCurve3(V(-x, z - r), V(-x, -z + r)));
    path.add(new THREE.QuadraticBezierCurve3(V(-x, -z + r), V(-x, -z), V(-x + r, -z)));
    const SEG = 320, RAD = 6;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(path, SEG, 0.045, RAD, false), M.zip);
    tube.geometry.setDrawRange(0, 0); suit.add(tube);
    const pull = new THREE.Group();
    const tab = new THREE.Mesh(roundedBox(0.2, 0.07, 0.34, 0.03, 2), M.metal); tab.castShadow = true; pull.add(tab);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 8, 18), M.metal); ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.06, 0.2); pull.add(ring);
    pull.visible = false; suit.add(pull);
    return { tube, pull, path, SEG, RAD };
  }
  function winSequence() {
    if (G.won) return;
    G.won = true; G.mode = 'idle'; G.selected = false; hideGhost(); closeFail(); el.shakePick.hidden = true; stopTut(false); cancelLane();
    updateHUD();
    lock();
    const lid = buildLid(), zip = buildZipper(lid.OW, lid.OH);
    lid.pivot.rotation.x = -1.95;
    const groups = Array.from(meshes.values()).map(m => m.group);
    const tl = gsap.timeline({ onComplete: () => { unlock(); setTimeout(showResult, REDUCED ? 0 : 900); } });
    tl.add(() => { sfx.win(); toast((G.level.gapCount === 0 ? 'PERFECT PACK!' : 'PACKED!') + ' Bavul kapanıyor…', 1600); }, 0.1)
      .to(lid.mats, { opacity: (i) => i === 0 ? 0.5 : 0.95, duration: 0.3 }, 0.2)
      .to(lid.pivot.rotation, { x: 0, duration: REDUCED ? 0.01 : 0.62, ease: 'power2.in' }, 0.3)
      .add(() => {
        sfx.thump(); haptic(30);
        groups.forEach(g => { gsap.killTweensOf(g.scale); g.scale.set(1, 1, 1); });
        if (!REDUCED) {
          gsap.to(groups.map(g => g.scale), { y: 0.86, duration: 0.1, ease: 'power2.out', yoyo: true, repeat: 1 });
          gsap.fromTo(root.scale, { y: 0.94, x: 1.03, z: 1.03 }, { y: 1, x: 1, z: 1, duration: 0.6, ease: 'elastic.out(1,0.4)' });
          puff(0, -lid.OH / 2, 8, lid.OW * 0.8, 0.5);
        }
      })
      .add(() => { zip.pull.visible = true; sfx.zip(0.95); })
      .to({ t: 0 }, {
        t: 1, duration: REDUCED ? 0.01 : 0.95, ease: 'power1.inOut',
        onUpdate: function () {
          const t = Math.min(0.9999, this.targets()[0].t);
          zip.tube.geometry.setDrawRange(0, Math.floor(t * zip.SEG) * zip.RAD * 6);
          const p = zip.path.getPointAt(t), tg = zip.path.getTangentAt(t);
          zip.pull.position.set(p.x, p.y + 0.05, p.z); zip.pull.rotation.y = Math.atan2(tg.x, tg.z);
        }
      })
      .add(() => { zip.tube.geometry.setDrawRange(0, Infinity); haptic(15); })
      .to(groups.map(g => g.scale), { y: 0.93, duration: 0.25, ease: 'power2.out' })
      .add(() => { confetti(); }, '-=0.1');
  }


  /* ---------- confetti (2D canvas) ---------- */
  const fx = $('#fx'), fctx = fx.getContext('2d');
  let confRaf = 0;
  function confetti() {
    if (REDUCED) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = app.clientWidth, h = app.clientHeight;
    fx.width = w * dpr; fx.height = h * dpr; fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = PALETTE.concat(['#FFFFFF', '#FFE08A']), parts = [];
    for (let i = 0; i < 190; i++) {
      const left = i % 2 === 0, ang = (left ? -1 : -2.14) + (Math.random() - 0.5) * 0.7, sp = 9 + Math.random() * 9;
      parts.push({ x: left ? -10 : w + 10, y: h * 0.62, vx: Math.cos(ang) * sp * (left ? 1 : 1), vy: Math.sin(ang) * sp, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        w: 6 + Math.random() * 7, h: 4 + Math.random() * 5, c: cols[i % cols.length], wob: Math.random() * 6 });
    }
    const t0 = performance.now();
    cancelAnimationFrame(confRaf);
    (function frame(now) {
      const t = (now - t0) / 1000;
      fctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.wob += 0.15;
        fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.r); fctx.scale(1, Math.abs(Math.cos(p.wob)) * 0.8 + 0.2);
        fctx.fillStyle = p.c; fctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); fctx.restore();
      }
      if (t < 4.2) confRaf = requestAnimationFrame(frame); else fctx.clearRect(0, 0, w, h);
    })(t0);
  }

  /* ======================================================================
     LEVEL LIFECYCLE
     ====================================================================== */
  let introTimer = 0;
  function loadLevel(i) {
    stopTut(false); cancelLane(); closeQueueSheet();
    gsap.globalTimeline.clear();
    cancelAnimationFrame(confRaf); fctx.clearRect(0, 0, fx.width, fx.height);
    const lv = E.buildLevel(i);
    if (!lv) { toast('Bu bavul üretilemedi, sıradakine geçiliyor.'); if (i < 200) loadLevel(i + 1); return; }
    G.idx = i; G.level = lv;
    G.st = { W: lv.W, H: lv.H, gates: lv.gates, blocks: E.cloneBlocks(lv.initial) };
    G.queue = lv.queue.slice(); G.undo = []; G.boost = Object.assign({}, BOOSTERS, lv.cfg.boosters || {});
    G.moves = 0; G.boostersUsed = 0; G.powerUsed = 0; G.t0 = null; G.nextId = 5000; G.mode = 'idle'; G.selected = false; G.busy = 0; G.won = false;
    lastHeadId = null; closeFail(); el.buyOv.hidden = true; el.shakePick.hidden = true; hideGhost();
    root.rotation.set(0, 0, 0); root.position.set(0, 0, 0); root.scale.set(1, 1, 1);
    clearMeshes();
    if (ghost) { root.remove(ghost.group); ghost = null; }
    buildSuitcase();
    syncAll(false);
    $('#lvlNum').textContent = String(i + 1).padStart(2, '0');
    $('#lvlName').textContent = lv.cfg.name;
    $('#lvlCode').textContent = lv.cfg.code;
    $('#lvlSize').textContent = lv.W + '×' + lv.H;
    renderQueue(); updateHUD(); fitCamera();
    clearTimeout(introTimer);
    if (lv.cfg.intro && el.helpOv.hidden) introTimer = setTimeout(() => toast(lv.cfg.intro, 4200), 900);
    if (!REDUCED) {
      lock();
      let k = 0;
      const tl = gsap.timeline({ onComplete: unlock });
      for (const m of meshes.values()) {
        const y0 = m.group.position.y;
        m.group.position.y = 3.4;
        tl.to(m.group.position, { y: y0, duration: 0.42, ease: 'bounce.out' }, 0.1 + k * 0.08);
        k++;
      }
      suit.scale.set(0.92, 0.92, 0.92);
      tl.to(suit.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(2)' }, 0);
      if (!k) tl.to({}, { duration: 0.1 });
    }
    try { localStorage.setItem('pj-level', String(i)); } catch (e) { /* ignore */ }
    scheduleTut(1800);
  }

  /* ======================================================================
     RENDER LOOP
     ====================================================================== */
  let last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000; last = now;
    for (const v of gateViews) {
      v.flash = Math.max(0, v.flash - dt * 2.2);
      if (v.valid) {
        v.tex.offset.x -= dt * (G.selected ? 1.6 : 0.85);
        v.chevMat.opacity = 0.95;
        v.mat.emissiveIntensity = (G.selected ? 0.22 : 0.1) + (G.selected ? 0.14 : 0.06) * Math.sin(t * 5) + v.flash * 0.5;
      } else {
        v.chevMat.opacity = 0.28 + v.flash * 0.5;
        v.mat.emissiveIntensity = v.flash * 0.4;
      }
    }
    if (halo && halo.visible) halo.material.opacity = 0.4 + 0.28 * Math.sin(t * 5);
    if (hero && hero.g.visible && !REDUCED) { hero.s.rotation.y = Math.sin(t * 0.55) * 0.34; hero.tag.rotation.z = Math.sin(t * 1.7) * 0.07; hero.ringM.emissiveIntensity = 0.25 + 0.15 * Math.sin(t * 2.4); }
    if (emptyOverlay && emptyOverlay.visible) emptyOverlay.material.opacity = 0.55 + 0.3 * Math.sin(t * 4);
    if (tut.kind) {
      const ar = app.getBoundingClientRect(), cr = canvas.getBoundingClientRect(), s = toScreen(tut.p, ar, cr);
      tutEl.hand.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) scale(${(1 - 0.14 * tut.press).toFixed(3)})`;
      tutEl.hand.style.opacity = tut.alpha.toFixed(3);
      if (tut.trail && tut.trailAlpha > 0.01) {
        const a = toScreen(tut.trail[0], ar, cr), b = toScreen(tut.trail[1], ar, cr), len = Math.hypot(b.x - a.x, b.y - a.y) || 1, k = Math.max(0, (len - 16) / len);
        tutEl.path.setAttribute('d', `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${(a.x + (b.x - a.x) * k).toFixed(1)} ${(a.y + (b.y - a.y) * k).toFixed(1)}`);
        tutEl.path.style.opacity = tut.trailAlpha.toFixed(3);
      } else tutEl.path.style.opacity = '0';
      if (!laneVis) setHoloAlpha(tut.fade);
    } else if (laneVis) setHoloAlpha(0.72 + 0.28 * Math.sin(t * 6));
    renderer.render(scene, camera);
  }

  /* ---------- test hook: plays the generator's reference solution ---------- */
  window.__pj.pointerGrid = (x, y) => pointerGrid({ clientX: x, clientY: y });
  window.__pj.refresh = () => { syncAll(false); renderQueue(); afterAction(); };
  window.__pj.save = () => save; window.__pj.showHome = (t) => showHome(t); window.__pj.enterPlay = i => enterPlay(i);
  window.__pj.tut = tut; window.__pj.lane = () => lane; window.__pj.tryTut = tryTut; window.__pj.planTut = planTut; window.__pj.resetTuts = resetTuts; window.__pj.screenOfPoint = p => toScreen(p, app.getBoundingClientRect(), canvas.getBoundingClientRect());
  window.__pj.autoplay = function (speed) {
    speed = speed || 1;
    const sol = G.level.solution.slice();
    loadLevel(G.idx);
    let i = 0;
    const step = () => {
      if (G.busy) { setTimeout(step, 40); return; }
      if (i >= sol.length) return;
      const a = sol[i++];
      if (a.t === 'enter') { const item = G.queue[0]; const opt = E.entryOptions(G.st, item, G.st.gates[a.gi]).find(o => o.offset === a.offset); doEnter(item, a.gi, opt); }
      else if (a.t === 'slide') { const b = E.blockById(G.st, a.id); commitSlide(b, a.to.x, a.to.y, true); afterAction(); }
      else if (a.t === 'compress') { const b = E.blockById(G.st, a.id); commitCompress(b, b.x, b.y, a.dir); afterAction(); }
      else if (a.t === 'cap') placeCap();
      setTimeout(step, 260 / speed);
    };
    setTimeout(step, 1200);
  };

  /* ---------- boot ---------- */
  function start(data) {
    setSoundIcon();
    $('#helpItems').innerHTML = ['perfume', 'passport', 'console', 'towel', 'kit', 'organizer', 'jewelry', 'lid', 'divider']
      .map(k => `<img src="${iconOf(k)}" alt="" title="${ITEM_NAME[k]}">`).join('');
    $('#hCoinIco').innerHTML = coinSVG(32);
    $('#chestIco').innerHTML = CHEST_SVG;
    document.querySelectorAll('#resStars .rstar').forEach(n => { n.innerHTML = bigStarSVG(); });
    $('#resPile').innerHTML = [[8, 40, 52], [44, 44, 56], [80, 40, 52], [26, 18, 54], [62, 18, 54], [44, 0, 58]].map(([x, y, z]) => `<span style="position:absolute;left:${x}px;top:${y}px">${coinSVG(z)}</span>`).join('');
    buildHero();
    const q = /[?&#]level=(\d+)/.exec(location.search + location.hash);
    if (q) enterPlay(Math.max(1, parseInt(q[1], 10)) - 1);
    else if (data && data.screen === 'play' && typeof data.idx === 'number') enterPlay(data.idx);
    else showHome('home');
    const ro = new ResizeObserver(() => fitView()); ro.observe(app); ro.observe(el.hudBottom); ro.observe(el.hudTop); ro.observe(el.home);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { heroTagFor = 0; setHeroLevel(nextLevel()); fitView(); });
    requestAnimationFrame(tick);
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) { try { hot.snapshot(() => ({ idx: G.idx, screen: G.screen })); } catch (e) { /* ignore */ } }
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})();
