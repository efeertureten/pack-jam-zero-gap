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
  const FABRIC = ['#F39BB2', '#8FCDF0', '#B7A3F5', '#FFCB85', '#9EE0C3', '#F7B39A', '#A9D7A0', '#F2A0D6'];
  const GATE_COLORS = ['#FFC53D', '#14BFAE', '#FF5FA8', '#5FCB43', '#2F7FF0', '#FF8A1F'];
  const SOCK_STRIPES = ['#FF4D5A', '#2F7FF0', '#5FCB43', '#FF8A1F', '#8B5CF6', '#14BFAE'];
  const GAP = 0.08, WALL_T = 0.34, WALL_H = 0.42;
  const H_HARD = 0.56, H_SOCK = 0.46, H_CAP = 0.17;
  const OUT = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
  const CHEV_ROT = { left: 0, right: Math.PI, top: -Math.PI / 2, bottom: Math.PI / 2 };
  const BOOSTERS = { undo: 5, vac: 2, shake: 2 };

  const ITEM_NAME = { perfume: 'parfüm', passport: 'pasaport', console: 'konsol', towel: 'havlu', kit: 'ilk yardım', jewelry: 'takı kutusu', organizer: 'organizer', lid: 'şeffaf kapak', joker: 'joker', divider: 'sabit bölme' };
  const ITEM_H = { perfume: 0.46, joker: 0.46, passport: 0.36, console: 0.4, towel: 0.5, kit: 0.56, jewelry: 0.5, organizer: 0.62, divider: 0.4 };
  const itemOf = b => b.sock || b.type === 'sock' ? 'joker' : b.type === 'cap' ? 'lid' : b.fixed ? 'divider' : b.soft ? 'towel' : b.base ? 'jewelry' : (b.item && ITEM_H[b.item] ? b.item : E.itemForShape(b.w, b.h));
  const heightOf = b => ITEM_H[itemOf(b)] || H_HARD;
  const plasticHex = c => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length];
  const colorOf = b => b.sock ? '#FFF6E8' : b.soft ? FABRIC[((b.color % FABRIC.length) + FABRIC.length) % FABRIC.length] : plasticHex(b.color);
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  function lighten(hex, t) { const c = new THREE.Color(hex); c.lerp(new THREE.Color('#ffffff'), t); return '#' + c.getHexString(); }

  /* ---------- state ---------- */
  const G = {
    idx: 0, level: null, st: null, queue: [], undo: [], boost: Object.assign({}, BOOSTERS),
    moves: 0, boostersUsed: 0, nextId: 5000, mode: 'idle', selected: false, busy: 0, won: false, failOpen: false
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
      undo() { tone(720, 0.07, 'sine', 0.13, 420); }
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
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
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.9);
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

  function obstacleTex() {
    return cachedTex('obst', PX, PX, (c, w, h) => {
      c.save(); rr(c, 0, 0, w, h, 16); c.clip();
      c.strokeStyle = 'rgba(255,197,61,0.5)'; c.lineWidth = 11;
      for (let i = -h; i < w + h; i += 32) { c.beginPath(); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke(); }
      c.restore();
      const cx = w / 2, cy = h / 2 + 8;
      c.fillStyle = '#20263A'; rr(c, cx - 24, cy - 16, 48, 38, 8); c.fill();
      c.strokeStyle = '#20263A'; c.lineWidth = 9; c.beginPath(); c.arc(cx, cy - 16, 14, Math.PI, 0); c.stroke();
      c.fillStyle = '#FFC53D'; c.beginPath(); c.arc(cx, cy + 2, 5, 0, Math.PI * 2); c.fill();
    });
  }
  /* ---------- travel items: decals ---------- */
  /* draws in a landscape frame centred on 0,0 — L = long side, S = short side (px) */
  function itemTex(key, pw, ph, draw) {
    return cachedTex(key + '|' + pw.toFixed(2) + 'x' + ph.toFixed(2), pw * PX, ph * PX, (c, w, h) => {
      const vertical = h > w;
      c.save(); c.translate(w / 2, h / 2); if (vertical) c.rotate(Math.PI / 2);
      draw(c, vertical ? h : w, vertical ? w : h);
      c.restore();
    });
  }
  function passportTex(pw, ph) {
    return itemTex('pass', pw, ph, (c, L, S) => {
      const gold = '#F3D58C', long = L > S * 1.4;
      c.setLineDash([12, 9]); c.lineWidth = 5; c.strokeStyle = 'rgba(243,213,140,0.85)'; rr(c, -L / 2 + 10, -S / 2 + 10, L - 20, S - 20, 14); c.stroke(); c.setLineDash([]);
      const ex = long ? -L * 0.22 : 0, R0 = S * 0.25;
      c.strokeStyle = gold; c.lineWidth = 5;
      c.beginPath(); c.arc(ex, 0, R0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.ellipse(ex, 0, R0 * 0.45, R0, 0, 0, Math.PI * 2); c.stroke();
      for (const k of [-0.5, 0, 0.5]) { const hw = R0 * Math.sqrt(1 - k * k); c.beginPath(); c.moveTo(ex - hw, k * R0); c.lineTo(ex + hw, k * R0); c.stroke(); }
      if (!long) return;
      c.fillStyle = gold; c.font = `700 ${Math.round(S * 0.15)}px ui-monospace, Menlo, Consolas, monospace`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('PASAPORT', L * 0.17, -S * 0.15);
      c.save(); c.translate(L * 0.2, S * 0.17); c.rotate(-0.06);
      c.fillStyle = '#FFFFFF'; rr(c, -L * 0.15, -S * 0.11, L * 0.3, S * 0.22, 6); c.fill();
      c.fillStyle = '#2F7FF0'; c.fillRect(-L * 0.15, -S * 0.11, L * 0.05, S * 0.22);
      c.fillStyle = '#18213D'; for (let i = 0; i < 12; i++) c.fillRect(-L * 0.07 + i * L * 0.016, -S * 0.06, i % 3 ? 2 : 4, S * 0.12);
      c.restore();
    });
  }
  function consoleTex(pw, ph) {
    return itemTex('cons', pw, ph, (c, L, S) => {
      const roomy = L >= S * 1.7, sw = roomy ? Math.min(L * 0.44, L - S * 1.3) : L * 0.62, sh = S * 0.62;
      c.fillStyle = 'rgba(24,33,61,0.92)'; rr(c, -sw / 2 - 8, -sh / 2 - 8, sw + 16, sh + 16, 14); c.fill();
      const gr = c.createLinearGradient(-sw / 2, -sh / 2, sw / 2, sh / 2);
      gr.addColorStop(0, '#4A6FA8'); gr.addColorStop(0.5, '#243A63'); gr.addColorStop(1, '#16213C');
      c.fillStyle = gr; rr(c, -sw / 2, -sh / 2, sw, sh, 8); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.moveTo(-sw / 2, -sh / 2); c.lineTo(-sw / 2 + sw * 0.42, -sh / 2); c.lineTo(-sw / 2 + sw * 0.16, sh / 2); c.lineTo(-sw / 2, sh / 2); c.closePath(); c.fill();
      if (!roomy) return;
      const side = (L / 2 - sw / 2) / 2 + sw / 2, arm = S * 0.19, th = S * 0.1;
      c.fillStyle = '#20263A'; rr(c, -side - arm, -th / 2, arm * 2, th, 4); c.fill(); rr(c, -side - th / 2, -arm, th, arm * 2, 4); c.fill();
      const br = S * 0.08; c.fillStyle = '#FFFFFF'; c.strokeStyle = '#20263A'; c.lineWidth = 4;
      for (const [ox, oy] of [[-br * 1.15, br * 1.15], [br * 1.15, -br * 1.15]]) { c.beginPath(); c.arc(side + ox, oy, br, 0, Math.PI * 2); c.fill(); c.stroke(); }
    });
  }
  function towelTex(pw, ph, compressed) {
    return itemTex('towel|' + compressed, pw, ph, (c, L, S) => {
      const band = compressed ? S * 0.15 : S * 0.22;
      c.save(); rr(c, -L / 2, -S / 2, L, S, 20); c.clip();
      for (let x = -L / 2, i = 0; x < L / 2; x += band, i++) if (i % 2) { c.fillStyle = 'rgba(255,255,255,0.72)'; c.fillRect(x, -S / 2, band * 0.6, S); }
      c.restore();
      const bw = S * 0.3;
      c.fillStyle = '#8A5A33'; c.fillRect(-bw / 2, -S / 2, bw, S);
      c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 3; c.strokeRect(-bw / 2 + 2, -S / 2, bw - 4, S);
      c.strokeStyle = '#F2C14E'; c.lineWidth = 6; rr(c, -bw * 0.42, -S * 0.16, bw * 0.84, S * 0.32, 4); c.stroke();
      c.fillStyle = '#F2C14E'; c.fillRect(-3, -S * 0.16, 6, S * 0.32);
      if (compressed) return;
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round';
      const cx = L / 2 - S * 0.3, a = S * 0.12;
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * cx, -a); c.lineTo(s * cx - s * a, 0); c.lineTo(s * cx, a); c.stroke(); }
    });
  }
  function kitTex(pw, ph) {
    return itemTex('kit', pw, ph, (c, L, S) => {
      c.setLineDash([10, 7]); c.lineWidth = 6; c.strokeStyle = 'rgba(24,33,61,0.45)'; rr(c, -L / 2 + 12, -S / 2 + 12, L - 24, S - 24, 18); c.stroke(); c.setLineDash([]);
      const r = Math.min(L, S) * 0.27, a = r * 0.62, t = r * 0.36;
      c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(0, S * 0.06, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#E8414B'; rr(c, -a, S * 0.06 - t / 2, a * 2, t, 4); c.fill(); rr(c, -t / 2, S * 0.06 - a, t, a * 2, 4); c.fill();
    });
  }
  function jewelTex(pw, ph) {
    return itemTex('jewel', pw, ph, (c, L, S) => {
      const pad = 14, cw = (L - pad * 2) / 2, ch = (S - pad * 2) / 2;
      const draws = [
        (x, y) => { c.strokeStyle = '#F2C14E'; c.lineWidth = 6; c.beginPath(); c.arc(x, y + 6, 18, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#7FD6FF'; c.beginPath(); c.arc(x, y - 14, 8, 0, Math.PI * 2); c.fill(); },
        (x, y) => { c.fillStyle = '#FFF8EE'; for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(x - 24 + k * 12, y + Math.sin(k) * 6, 6, 0, Math.PI * 2); c.fill(); } },
        (x, y) => { c.strokeStyle = '#20263A'; c.lineWidth = 9; c.beginPath(); c.moveTo(x, y - 30); c.lineTo(x, y + 30); c.stroke(); c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(x, y, 17, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#F2C14E'; c.lineWidth = 4; c.stroke(); c.strokeStyle = '#20263A'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 10); c.moveTo(x, y); c.lineTo(x + 7, y + 3); c.stroke(); },
        (x, y) => { for (const ox of [-12, 12]) { c.strokeStyle = '#F2C14E'; c.lineWidth = 4; c.beginPath(); c.arc(x + ox, y - 8, 6, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#FF7AA8'; c.beginPath(); c.arc(x + ox, y + 8, 7, 0, Math.PI * 2); c.fill(); } }
      ];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const x = -L / 2 + pad + i * cw, y = -S / 2 + pad + j * ch;
        c.fillStyle = '#4B2A57'; rr(c, x + 5, y + 5, cw - 10, ch - 10, 12); c.fill();
        c.strokeStyle = '#E8C66A'; c.lineWidth = 4; c.stroke();
        draws[j * 2 + i](x + cw / 2, y + ch / 2);
      }
    });
  }
  function lidTex(pw, ph) {
    return itemTex('lid', pw, ph, (c, L, S) => {
      c.strokeStyle = '#F2C14E'; c.lineWidth = 7; rr(c, -L / 2 + 6, -S / 2 + 6, L - 12, S - 12, 16); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 9; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-L * 0.32, S * 0.08); c.lineTo(-L * 0.12, -S * 0.2); c.stroke();
      c.beginPath(); c.moveTo(-L * 0.22, S * 0.22); c.lineTo(-L * 0.04, -S * 0.02); c.stroke();
    });
  }
  function organizerTex(pw, ph) {
    return itemTex('org', pw, ph, (c, L, S) => {
      const mx = L * 0.12, my = S * 0.17, ww = L - 2 * mx, hh = S - 2 * my;
      c.fillStyle = 'rgba(16,22,40,0.28)'; rr(c, -ww / 2, -hh / 2, ww, hh, 16); c.fill();
      c.save(); rr(c, -ww / 2, -hh / 2, ww, hh, 16); c.clip();
      c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 2.5;
      for (let k = -L; k < L; k += 15) { c.beginPath(); c.moveTo(k, -S / 2); c.lineTo(k + S, S / 2); c.stroke(); c.beginPath(); c.moveTo(k, S / 2); c.lineTo(k + S, -S / 2); c.stroke(); }
      c.restore();
      c.strokeStyle = '#20263A'; c.lineWidth = 8; rr(c, -ww / 2 - 10, -hh / 2 - 10, ww + 20, hh + 20, 22); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2; c.setLineDash([3, 5]); rr(c, -ww / 2 - 10, -hh / 2 - 10, ww + 20, hh + 20, 22); c.stroke(); c.setLineDash([]);
      c.fillStyle = 'rgba(24,33,61,0.38)'; rr(c, L / 2 - mx * 0.78, -S * 0.17, mx * 0.46, S * 0.34, 6); c.fill();
    });
  }
  function sparkleTex() {
    return cachedTex('sparkle', PX, PX, (c, w, h) => {
      const star = (x, y, r) => { c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr2 = i % 2 ? r * 0.35 : r; c.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); } c.closePath(); c.fill(); };
      c.fillStyle = '#F2C14E'; star(w * 0.24, h * 0.26, 16); star(w * 0.78, h * 0.72, 12); c.fillStyle = '#FFFFFF'; star(w * 0.76, h * 0.24, 9);
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
  function fabric(hex) {
    const k = 'f' + hex;
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.88, metalness: 0, envMapIntensity: 0.25 }));
    return matCache.get(k);
  }
  function leather(hex) {
    const k = 'l' + hex;
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshPhysicalMaterial({ color: lin(hex), roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5, envMapIntensity: 0.3 }));
    return matCache.get(k);
  }
  function glass(hex) {
    const k = 'g' + hex;
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshPhysicalMaterial({ color: lin(hex), roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.0 }));
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
    obstacle: new THREE.MeshStandardMaterial({ color: lin('#3A4260'), roughness: 0.55, envMapIntensity: 0.3 }),
    gold: new THREE.MeshStandardMaterial({ color: lin('#F2C14E'), metalness: 1, roughness: 0.26, envMapIntensity: 1.1 }),
    metal: new THREE.MeshStandardMaterial({ color: lin('#C9CED8'), metalness: 1, roughness: 0.3, envMapIntensity: 1.0 }),
    zip: new THREE.MeshStandardMaterial({ color: lin('#232838'), metalness: 0.6, roughness: 0.35 }),
    arrow: new THREE.MeshPhysicalMaterial({ color: lin('#FFFFFF'), roughness: 0.3, clearcoat: 0.8, envMapIntensity: 0.35 }),
    hit: new THREE.MeshBasicMaterial({ visible: false }),
    rubber: new THREE.MeshStandardMaterial({ color: lin('#232838'), roughness: 0.6 }),
    lidGlass: new THREE.MeshPhysicalMaterial({ color: lin('#D6F1FF'), roughness: 0.04, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.4, depthWrite: false, envMapIntensity: 1.3 }),
    ghost: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false })
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
  function meshKey(b) { return [itemOf(b), b.w, b.h, +!!b.compressed, +!!b.capped, b.color, b.axis, b.softAxis].join('|'); }
  function addDecal(group, tex, w, d, y) {
    const m = new THREE.Mesh(planeGeo(w, d), decalMat(tex));
    m.rotation.x = -Math.PI / 2; m.position.y = y + 0.004; m.renderOrder = 2; group.add(m);
    return m;
  }
  function addMesh(group, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; group.add(m); return m;
  }
  function cylGeo(r, h) {
    const key = 'cyl|' + r + '|' + h;
    if (!geoCache.has(key)) { const g = new THREE.CylinderGeometry(r, r, h, 24); g.translate(0, h / 2, 0); geoCache.set(key, g); }
    return geoCache.get(key);
  }
  function buildBlockGroup(b) {
    const g = new THREE.Group(), w = b.w - GAP, d = b.h - GAP, kind = itemOf(b), top = heightOf(b), col = colorOf(b);
    let body;
    if (kind === 'divider') {
      body = new THREE.Mesh(roundedBox(w, top, d, 0.07, 2), M.obstacle);
      addDecal(g, obstacleTex(), w - 0.14, d - 0.14, top);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addMesh(g, studGeo(0.045, 0.03), M.metal, sx * (w / 2 - 0.1), top - 0.005, sz * (d / 2 - 0.1));
    } else if (kind === 'perfume' || kind === 'joker') {
      const bw = w * 0.84, bd = d * 0.84;
      body = new THREE.Mesh(roundedBox(bw, top, bd, 0.14, 3), glass(kind === 'joker' ? '#FFF6E8' : lighten(col, 0.12)));
      addMesh(g, cylGeo(0.13, 0.05), M.gold, 0, top - 0.01, 0);
      addMesh(g, roundedBox(0.22, 0.15, 0.22, 0.06, 2), kind === 'joker' ? M.gold : plastic('#20263A'), 0, top + 0.035, 0);
      if (kind === 'joker') addDecal(g, sparkleTex(), bw - 0.24, bd - 0.24, top);
    } else if (kind === 'towel') {
      const r = 0.19;
      body = new THREE.Mesh(roundedBox(w, top, d, r, 3), fabric(col));
      const dw = w - 2 * r + 0.06, dd = d - 2 * r + 0.06;
      addDecal(g, towelTex(dw, dd, !!b.compressed), dw, dd, top);
    } else if (kind === 'passport') {
      body = new THREE.Mesh(roundedBox(w, top, d, 0.08, 3), leather(col));
      addDecal(g, passportTex(w - 0.12, d - 0.12), w - 0.12, d - 0.12, top);
    } else if (kind === 'console') {
      body = new THREE.Mesh(roundedBox(w, top, d, 0.13, 3), plastic(col));
      addDecal(g, consoleTex(w - 0.16, d - 0.16), w - 0.16, d - 0.16, top);
    } else if (kind === 'kit') {
      body = new THREE.Mesh(roundedBox(w, top, d, 0.14, 3), plastic(col));
      addDecal(g, kitTex(w - 0.16, d - 0.16), w - 0.16, d - 0.16, top);
      const hr = Math.min(w, d) * 0.22;
      const handle = addMesh(g, new THREE.TorusGeometry(hr, 0.045, 8, 20, Math.PI), M.rubber, 0, top - 0.01, -d / 2 + 0.24);
      if (d > w) handle.rotation.y = Math.PI / 2, handle.position.set(-w / 2 + 0.24, top - 0.01, 0);
    } else if (kind === 'organizer') {
      body = new THREE.Mesh(roundedBox(w, top, d, 0.2, 3), fabric(col));
      addDecal(g, organizerTex(w - 0.26, d - 0.26), w - 0.26, d - 0.26, top);
      addMesh(g, roundedBox(0.1, 0.05, 0.2, 0.025, 2), M.metal, -w / 2 + 0.28, top - 0.01, -d / 2 + 0.3);
    } else if (kind === 'jewelry') {
      body = new THREE.Mesh(roundedBox(w, top, d, 0.12, 3), plastic(col));
      addDecal(g, jewelTex(w - 0.16, d - 0.16), w - 0.16, d - 0.16, top);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addMesh(g, studGeo(0.085, 0.12), M.gold, sx * (w / 2 - 0.14), top - 0.006, sz * (d / 2 - 0.14));
      if (b.capped) {
        const capG = new THREE.Group(); capG.name = 'cap';
        const lid = new THREE.Mesh(roundedBox(w - 0.02, H_CAP, d - 0.02, 0.08, 2), M.lidGlass);
        lid.userData.blockId = b.id; lid.renderOrder = 4; capG.add(lid);
        const frame = addDecal(capG, lidTex(w - 0.06, d - 0.06), w - 0.06, d - 0.06, H_CAP); frame.renderOrder = 5;
        addMesh(capG, roundedBox(0.26, 0.1, 0.06, 0.02, 2), M.gold, 0, 0.03, d / 2 - 0.02);
        capG.position.y = top - 0.01; g.add(capG);
      }
    } else {
      body = new THREE.Mesh(roundedBox(w, top, d, 0.1, 3), plastic(col));
    }
    if (b.axis === 'h' || b.axis === 'v') {
      const long = (b.axis === 'h' ? b.w : b.h) - 0.42;
      const a = new THREE.Mesh(arrowGeo(Math.max(0.55, long)), M.arrow);
      a.position.y = top + 0.006; if (b.axis === 'v') a.rotation.y = Math.PI / 2; a.castShadow = true; a.renderOrder = 3; g.add(a);
    }
    body.castShadow = true; body.receiveShadow = true; body.userData.blockId = b.id;
    g.add(body);
    g.userData.body = body;
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
    toast: $('#toast'), winOv: $('#winOv'), failOv: $('#failOv'), helpOv: $('#helpOv'), shakePick: $('#shakePick'),
    hudTop: $('#hudTop'), hudBottom: $('#hudBottom'), btnSound: $('#btnSound'), fillTarget: $('#fillTarget'), gapChip: $('#gapChip')
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
  const GLYPH = {
    perfume: '<path d="M8 10.5a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3V18a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><path d="M10.5 7.5V5h3v2.5M12 5V3.2"/>',
    joker: '<path d="M8 10.5a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3V18a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><path d="M10.5 7.5V5h3v2.5"/><path d="M12 11.5l.9 1.8 1.9.3-1.4 1.3.4 1.9-1.8-1-1.8 1 .4-1.9-1.4-1.3 1.9-.3z" fill="currentColor" stroke="none"/>',
    passport: '<circle cx="12" cy="12" r="6.5"/><ellipse cx="12" cy="12" rx="2.8" ry="6.5"/><path d="M5.5 12h13M6.6 8.8h10.8M6.6 15.2h10.8"/>',
    console: '<rect x="8" y="7.5" width="8" height="9" rx="1.6"/><path d="M2.8 12h3.4M4.5 10.3v3.4"/><circle cx="19" cy="10.8" r=".9" fill="currentColor"/><circle cx="20.6" cy="13.2" r=".9" fill="currentColor"/>',
    towel: '<rect x="9.8" y="3" width="4.4" height="18" rx="1"/><rect x="10.6" y="9.8" width="2.8" height="4.4" rx=".6"/><path d="M4 9l2 3-2 3M20 9l-2 3 2 3"/>',
    kit: '<circle cx="12" cy="12" r="6.6" fill="#fff" stroke="none"/><path d="M12 8.6v6.8M8.6 12h6.8" stroke="#E8414B" stroke-width="2.6"/>',
    jewelry: '<path d="M7.5 9.5 10 6.5h4l2.5 3L12 18z"/><path d="M7.5 9.5h9M10 6.5l2 3 2-3M12 9.5V18"/>',
    organizer: '<rect x="4" y="6.5" width="16" height="11" rx="2.5" stroke-dasharray="2.2 1.8"/><path d="M7 9.5h10M7 12h10M7 14.5h10" opacity=".7"/>',
    lid: '<rect x="5" y="7" width="14" height="10" rx="2"/><path d="M8 13l3-3M9.5 15l4.5-4.5" opacity=".8"/>'
  };
  function itemLabel(it) {
    const k = itemOf(it), name = ITEM_NAME[k] || (it.w + '×' + it.h);
    if (it.axis === 'h') return '↔ ' + name;
    if (it.axis === 'v') return '↕ ' + name;
    return name;
  }
  function miniHTML(it, box) {
    const k = itemOf(it);
    const c = Math.max(9, Math.floor(Math.min(box / it.w, (box - 8) / it.h, it.w * it.h === 1 ? 34 : 21)));
    let col;
    if (k === 'joker') col = '#FFF1D6';
    else if (k === 'lid') col = '#CFEFFF';
    else if (k === 'towel') col = FABRIC[((it.color % FABRIC.length) + FABRIC.length) % FABRIC.length];
    else col = plasticHex(it.color);
    const locked = it.axis === 'h' || it.axis === 'v';
    const vert = it.h > it.w ? ' vert' : '';
    const inner = locked ? SVG[it.axis] : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPH[k] || ''}</svg>`;
    return `<span class="mini it-${k}${locked ? ' axis' : ''}${vert}" style="--w:${it.w};--h:${it.h};--c:${c}px;--col:${col}">${inner}</span>`;
  }
  let lastHeadId = null;
  function renderQueue() {
    const items = G.queue.slice(0, 3), rest = G.queue.length - items.length;
    const shifted = lastHeadId !== null && items.length && items[0].id !== lastHeadId;
    lastHeadId = items.length ? items[0].id : null;
    if (!items.length) { el.belt.innerHTML = '<span class="empty-belt">Kuyruk boş</span>'; return; }
    el.belt.innerHTML = items.map((it, i) => {
      const head = i === 0;
      return `<${head ? 'button type="button"' : 'div'} class="tray${head ? ' head' : ''}${head && G.selected ? ' selected' : ''}${shifted && !REDUCED ? ' enter' : ''}" ${head ? 'id="headTray" aria-label="Sıradaki eşya: ' + itemLabel(it) + '"' : ''} style="--from:${head ? 86 : 90}px">${miniHTML(it, head ? 64 : 52)}<span class="tray-lbl">${itemLabel(it)}</span></${head ? 'button' : 'div'}>`;
    }).join('') + (rest > 0 ? `<span class="more" aria-label="${rest} eşya daha">+${rest}</span>` : '');
    if (shifted && !REDUCED) { el.belt.classList.remove('roll'); void el.belt.offsetWidth; el.belt.classList.add('roll'); }
    const ht = $('#headTray');
    if (ht) {
      ht.addEventListener('pointerdown', onTrayDown);
      ht.addEventListener('click', e => { if (e.detail === 0 && G.queue[0] && !G.busy && !G.won) onTrayTap(G.queue[0]); });
    }
  }
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
    el.nUndo.textContent = G.boost.undo; el.nVac.textContent = G.boost.vac; el.nShake.textContent = G.boost.shake;
    el.bUndo.setAttribute('aria-disabled', String(G.boost.undo <= 0 || !G.undo.length));
    el.bVac.setAttribute('aria-disabled', String(G.boost.vac <= 0));
    el.bShake.setAttribute('aria-disabled', String(G.boost.shake <= 0));
    el.bVac.classList.toggle('armed', G.mode === 'vacuum');
    updateGates(); updateHalo(); updateEmptyOverlay();
    el.hint.textContent = hintText();
  }
  function setSoundIcon() { el.btnSound.innerHTML = sfx.muted ? SVG.soundOff : SVG.soundOn; el.btnSound.setAttribute('aria-label', sfx.muted ? 'Sesi aç' : 'Sesi kapat'); }

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
  function pushUndo() { G.undo.push(snapshot()); if (G.undo.length > 60) G.undo.shift(); }

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
  function tryEnterAt(gi, along) {
    const item = G.queue[0];
    if (!item || item.type !== 'block') return;
    const opt = bestOption(item, G.st.gates[gi], along);
    if (!opt) { rejectGate(gi, item); return; }
    doEnter(item, gi, opt);
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
    pushUndo(); G.queue.shift(); b.capped = true; G.moves++;
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
    Object.assign(b, c); b.compressed = true; G.moves++;
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
    G.boost.vac--; G.boostersUsed++; G.mode = 'idle';
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
    G.boost.shake--; G.boostersUsed++; G.moves++; G.mode = 'idle';
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
    if (G.boost.undo <= 0) { toast('Geri alma hakkın bitti. Bölümü baştan başlatabilirsin.'); sfx.deny(); return; }
    G.boost.undo--; G.boostersUsed++;
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
    if (changed) { pushUndo(); b.x = nx; b.y = ny; G.moves++; sfx.click(); haptic(6); }
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
    if (G.won || G.busy || drag || qdrag) return;
    const gp = pointerGrid(e), head = G.queue[0], b = pickBlock(e);
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
      if (head && head.type === 'block') { tryEnterAt(gh.gi, gh.along); return; }
      if (head && head.type === 'sock') { toast('Joker parfüm kapıdan girmez: boş bir kareye dokun.'); return; }
      if (head && head.type === 'cap') { toast('Şeffaf kapak takı kutusunun üstüne oturur: kutuya dokun.'); return; }
    }
    if (head && head.type === 'block' && gp && gp.gx >= 0 && gp.gy >= 0 && gp.gx < G.st.W && gp.gy < G.st.H) toast('Sıradaki eşya bir kapıdan girer: parlayan oklu kapılara dokun.');
  });
  canvas.addEventListener('pointermove', e => {
    if (drag && e.pointerId === drag.pid) { moveBlockDrag(pointerGrid(e)); return; }
    if (e.pointerType === 'mouse' && !qdrag && !G.busy && !G.won) hoverPreview(e);
  });
  const endCanvas = e => { if (drag && e.pointerId === drag.pid) { try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ } endBlockDrag(); } };
  canvas.addEventListener('pointerup', endCanvas);
  canvas.addEventListener('pointercancel', endCanvas);
  canvas.addEventListener('pointerleave', () => { if (!qdrag && !drag) { hideGhost(); canvas.classList.remove('can-grab', 'can-tap'); } });

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
    const col = item.type === 'sock' ? '#FFF3D6' : item.type === 'cap' ? lighten(plasticHex(item.color), 0.38) : item.soft ? FABRIC[item.color % FABRIC.length] : plasticHex(item.color);
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
     INPUT — the conveyor tray (tap to select, drag onto a gate)
     ====================================================================== */
  let qdrag = null;
  function onTrayDown(e) {
    sfx.unlock();
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
  el.bUndo.addEventListener('click', () => { sfx.unlock(); doUndo(); });
  el.bVac.addEventListener('click', () => {
    sfx.unlock();
    if (G.busy || G.won) return;
    if (G.mode === 'vacuum') { G.mode = 'idle'; updateHUD(); toast('Vakum iptal edildi.'); return; }
    if (G.boost.vac <= 0) { toast('Vakum poşetin kalmadı.'); sfx.deny(); return; }
    if (!G.st.blocks.some(b => !b.fixed && !b.sock && !b.base && !b.capped && b.w * b.h > 1)) { toast('İçeride vakumlanacak blok yok.'); sfx.deny(); return; }
    G.mode = 'vacuum'; G.selected = false; closeFail(); updateHUD(); renderQueue();
    toast('Vakum hazır: küçültmek istediğin bloğa dokun.', 2600); sfx.pop();
  });
  el.bShake.addEventListener('click', () => {
    sfx.unlock();
    if (G.busy || G.won) return;
    if (G.boost.shake <= 0) { toast('Silkeleme hakkın kalmadı.'); sfx.deny(); return; }
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
  $('#btnHelp').addEventListener('click', () => { el.helpOv.hidden = false; $('#btnStart').focus({ preventScroll: true }); });
  $('#btnStart').addEventListener('click', () => { sfx.unlock(); el.helpOv.hidden = true; try { localStorage.setItem('pj-seen-help', '1'); } catch (e) { /* ignore */ } toast(G.level.cfg.intro || 'İyi paketlemeler!', 4200); });
  $('#stamp').addEventListener('click', () => {
    const lv = G.level, n = lv.queue.filter(q => q.type === 'block').length;
    const gaps = lv.gapCount ? `${lv.gapCount} kare planlı boşluk bırakılarak` : 'tek boşluk bırakmadan';
    toast(`Tersine üretildi: ${lv.W}×${lv.H} bavul ${gaps} döşendi, ${n} eşya kapılardan çıkarıldı, ${lv.solution.length} adımlık çözüm kurallarla yeniden oynanıp doğrulandı.`, 5600);
  });
  $('#btnNext').addEventListener('click', () => { sfx.unlock(); el.winOv.hidden = true; loadLevel(G.idx + 1); });
  $('#btnReplay').addEventListener('click', () => { sfx.unlock(); el.winOv.hidden = true; loadLevel(G.idx); });
  $('#fUndo').addEventListener('click', () => { doUndo(); });
  $('#fRestart').addEventListener('click', () => { closeFail(); loadLevel(G.idx); });
  $('#fClose').addEventListener('click', () => { closeFail(); toast('Vakum ya da Silkele ile yer açmayı dene.'); });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { el.shakePick.hidden = true; if (G.mode === 'vacuum') { G.mode = 'idle'; updateHUD(); } }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
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
    $('#fUndo').textContent = G.boost.undo > 0 && G.undo.length ? `Son hamleyi geri al (${G.boost.undo})` : 'Geri alma hakkı yok';
    $('#fUndo').disabled = !(G.boost.undo > 0 && G.undo.length);
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
    G.won = true; G.mode = 'idle'; G.selected = false; hideGhost(); closeFail(); el.shakePick.hidden = true;
    updateHUD();
    lock();
    const lid = buildLid(), zip = buildZipper(lid.OW, lid.OH);
    lid.pivot.rotation.x = -1.95;
    const groups = Array.from(meshes.values()).map(m => m.group);
    const tl = gsap.timeline({ onComplete: () => { unlock(); setTimeout(showWin, REDUCED ? 0 : 1000); } });
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
  function showWin() {
    const total = G.st.W * G.st.H, pct = Math.round(E.filledCount(G.st) / total * 100), zero = G.level.gapCount === 0;
    $('#winTitle').textContent = zero ? 'PERFECT PACK!' : 'PACKED!';
    $('#winStamp').textContent = zero ? '100% FULL' : '%' + pct + ' DOLU';
    $('#winNote').textContent = zero ? 'Tek boşluk yok. Zero Gap.' : `Hedef %${Math.round(G.level.targetCells / total * 100)} idi, ${total - E.filledCount(G.st)} kare boş kaldı.`;
    $('#btnNext').textContent = G.idx + 1 >= E.LEVEL_COUNT ? 'Sonsuz sefere çık' : 'Sonraki bavul';
    $('#wMoves').textContent = G.moves;
    $('#wItems').textContent = G.level.queue.length;
    $('#wBoost').textContent = G.boostersUsed;
    el.winOv.hidden = false;
    $('#btnNext').focus({ preventScroll: true });
    try { localStorage.setItem('pj-level', String(G.idx + 1)); } catch (e) { /* ignore */ }
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
    gsap.globalTimeline.clear();
    cancelAnimationFrame(confRaf); fctx.clearRect(0, 0, fx.width, fx.height);
    const lv = E.buildLevel(i);
    if (!lv) { toast('Bu bavul üretilemedi, sıradakine geçiliyor.'); if (i < 200) loadLevel(i + 1); return; }
    G.idx = i; G.level = lv;
    G.st = { W: lv.W, H: lv.H, gates: lv.gates, blocks: E.cloneBlocks(lv.initial) };
    G.queue = lv.queue.slice(); G.undo = []; G.boost = Object.assign({}, BOOSTERS, lv.cfg.boosters || {});
    G.moves = 0; G.boostersUsed = 0; G.nextId = 5000; G.mode = 'idle'; G.selected = false; G.busy = 0; G.won = false;
    lastHeadId = null; closeFail(); el.winOv.hidden = true; el.shakePick.hidden = true; hideGhost();
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
    if (emptyOverlay && emptyOverlay.visible) emptyOverlay.material.opacity = 0.55 + 0.3 * Math.sin(t * 4);
    renderer.render(scene, camera);
  }

  /* ---------- test hook: plays the generator's reference solution ---------- */
  window.__pj.pointerGrid = (x, y) => pointerGrid({ clientX: x, clientY: y });
  window.__pj.refresh = () => { syncAll(false); renderQueue(); afterAction(); };
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
    let idx = 0;
    if (data && typeof data.idx === 'number') idx = data.idx;
    else { try { idx = parseInt(localStorage.getItem('pj-level') || '0', 10) || 0; } catch (e) { idx = 0; } }
    const q = /[?&#]level=(\d+)/.exec(location.search + location.hash);
    if (q) idx = Math.max(1, parseInt(q[1], 10)) - 1;
    loadLevel(Math.max(0, idx));
    let seen = false; try { seen = localStorage.getItem('pj-seen-help') === '1'; } catch (e) { /* ignore */ }
    if (!seen) el.helpOv.hidden = false;
    const ro = new ResizeObserver(() => fitCamera()); ro.observe(app); ro.observe(el.hudBottom); ro.observe(el.hudTop);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitCamera());
    requestAnimationFrame(tick);
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) { try { hot.snapshot(() => ({ idx: G.idx })); } catch (e) { /* ignore */ } }
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})();
