/* ==========================================================================
   PACK JAM ENGINE — pure puzzle rules + reverse level generator.
   Grid coords: x = column (0 = left), y = row (0 = top / far side).
   Every rule the player experiences lives here, and the generator's
   verifier replays the reference solution through these same functions.
   All generator randomness uses + - * and comparisons only, so a seed
   produces the same suitcase in every JS engine.
   ========================================================================== */
(function (global) {
  'use strict';

  const SIDES = ['top', 'right', 'bottom', 'left'];
  /* direction a block travels when it ENTERS through a gate on this side */
  const INWARD = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };
  const sideAxis = s => (s === 'left' || s === 'right') ? 'x' : 'y';

  /* travel items → footprints. towel (soft 1×3→1×2) and jewelry (pinned 2×2 + lid)
     are seeded separately from `soft` / `caps`. */
  const ITEM_SHAPES = {
    perfume: [[1, 1]],
    passport: [[2, 1], [1, 2]],
    console: [[3, 1], [1, 3]],
    kit: [[2, 2]],
    organizer: [[3, 2], [2, 3]]
  };
  const DEFAULT_ITEMS = { perfume: 0.15, passport: 1.15, console: 1.25, kit: 1.3, organizer: 0.85 };
  function itemForShape(w, h) {
    const a = w * h;
    return a === 1 ? 'perfume' : a === 2 ? 'passport' : a === 3 ? 'console' : a === 4 ? 'kit' : 'organizer';
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const pick = (arr, R) => arr[Math.floor(R() * arr.length)];
  function shuffleInPlace(arr, R) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  /* weighted permutation by successive draws (no Math.pow → bit-exact everywhere) */
  function weightedOrder(list, R) {
    const pool = list.slice(), out = [];
    while (pool.length) {
      let sum = 0; for (const s of pool) sum += s.wt;
      let r = R() * sum, k = 0;
      for (; k < pool.length - 1; k++) { r -= pool[k].wt; if (r < 0) break; }
      out.push(pool.splice(k, 1)[0]);
    }
    return out;
  }

  const cloneBlocks = bs => bs.map(b => Object.assign({}, b));

  /* ---------- occupancy ---------- */
  function occ(st, ignoreId) {
    const g = new Int32Array(st.W * st.H);
    for (const b of st.blocks) {
      if (b.id === ignoreId) continue;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) g[y * st.W + x] = b.id;
    }
    return g;
  }
  function rectFree(st, g, x, y, w, h) {
    if (x < 0 || y < 0 || x + w > st.W || y + h > st.H) return false;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (g[yy * st.W + xx]) return false;
    return true;
  }
  function blockById(st, id) { for (const b of st.blocks) if (b.id === id) return b; return null; }
  function filledCount(st) { let n = 0; for (const b of st.blocks) n += b.w * b.h; return n; }

  /* ---------- sliding ---------- */
  function canAxis(b, axis) {
    if (b.fixed || b.capped) return false;
    if (b.axis === 'h') return axis === 'x';
    if (b.axis === 'v') return axis === 'y';
    return true;
  }
  function slideRange(st, b, axis, g) {
    g = g || occ(st, b.id);
    if (axis === 'x') {
      let mn = b.x, mx = b.x;
      while (rectFree(st, g, mn - 1, b.y, 1, b.h)) mn--;
      while (rectFree(st, g, mx + b.w, b.y, 1, b.h)) mx++;
      return { min: mn, max: mx };
    }
    let mn = b.y, mx = b.y;
    while (rectFree(st, g, b.x, mn - 1, b.w, 1)) mn--;
    while (rectFree(st, g, b.x, mx + b.h, b.w, 1)) mx++;
    return { min: mn, max: mx };
  }
  function canSlideTo(st, b, x, y) {
    if (x !== b.x && y !== b.y) return false;
    if (x === b.x && y === b.y) return false;
    const axis = x !== b.x ? 'x' : 'y';
    if (!canAxis(b, axis)) return false;
    const r = slideRange(st, b, axis);
    const v = axis === 'x' ? x : y;
    return v >= r.min && v <= r.max;
  }

  /* ---------- gates ---------- */
  /* item = {w,h,axis}; every legal entry: offset along the gate, the first
     fully-inside position (x,y) and the landing spot (ex,ey) after the block
     slides in until it hits something. */
  function entryOptions(st, item, gate, g) {
    const ax = sideAxis(gate.side);
    if (item.axis === 'h' && ax !== 'x') return [];
    if (item.axis === 'v' && ax !== 'y') return [];
    const cross = ax === 'x' ? item.h : item.w;
    if (cross > gate.len) return [];
    g = g || occ(st);
    const [dx, dy] = INWARD[gate.side];
    const out = [];
    for (let o = gate.start; o <= gate.start + gate.len - cross; o++) {
      let x, y;
      if (gate.side === 'left') { x = 0; y = o; }
      else if (gate.side === 'right') { x = st.W - item.w; y = o; }
      else if (gate.side === 'top') { x = o; y = 0; }
      else { x = o; y = st.H - item.h; }
      if (!rectFree(st, g, x, y, item.w, item.h)) continue;
      let ex = x, ey = y;
      while (rectFree(st, g, ex + dx, ey + dy, item.w, item.h)) { ex += dx; ey += dy; }
      out.push({ offset: o, x, y, ex, ey });
    }
    return out;
  }
  function entryBlockReason(st, item, gate) {
    const ax = sideAxis(gate.side);
    if (item.axis === 'h' && ax !== 'x') return 'axis-h';
    if (item.axis === 'v' && ax !== 'y') return 'axis-v';
    const cross = ax === 'x' ? item.h : item.w;
    if (cross > gate.len) return 'narrow';
    return 'blocked';
  }
  function makeBlock(item) {
    return {
      id: item.id, w: item.w, h: item.h, x: 0, y: 0, color: item.color, item: item.item || itemForShape(item.w, item.h),
      axis: item.axis || 'free', soft: !!item.soft, softAxis: item.softAxis || null,
      compressed: false, base: !!item.base, capped: false, fixed: false, sock: false,
      enteredFrom: null
    };
  }
  function applyEnter(st, item, gate, opt) {
    const b = makeBlock(item);
    b.x = opt.ex; b.y = opt.ey; b.enteredFrom = gate.side;
    st.blocks.push(b);
    return b;
  }

  /* ---------- compressible beach towels ---------- */
  function isHard(st, g, x, y) {
    if (x < 0 || y < 0 || x >= st.W || y >= st.H) return true;     // suitcase wall
    const id = g[y * st.W + x];
    if (!id) return false;
    const o = blockById(st, id);
    return !!o && !(o.soft || o.sock);
  }
  function leadLine(b, axis, dir) {
    const line = [];
    if (axis === 'x') { const lx = dir > 0 ? b.x + b.w : b.x - 1; for (let y = b.y; y < b.y + b.h; y++) line.push([lx, y]); }
    else { const ly = dir > 0 ? b.y + b.h : b.y - 1; for (let x = b.x; x < b.x + b.w; x++) line.push([x, ly]); }
    return line;
  }
  /* pushing a 1×3 towel in `dir` against a wall or hard item squeezes it to 1×2;
     the leading end stays against the obstacle, the trailing cell is freed */
  function compressInfo(st, b, dir, g) {
    if (!b.soft || b.compressed || b.capped) return null;
    g = g || occ(st, b.id);
    const ax = b.softAxis;
    if (!leadLine(b, ax, dir).some(([x, y]) => isHard(st, g, x, y))) return null;
    const c = { x: b.x, y: b.y, w: b.w, h: b.h };
    if (ax === 'x') { c.w = b.w - 1; if (dir > 0) c.x = b.x + 1; }
    else { c.h = b.h - 1; if (dir > 0) c.y = b.y + 1; }
    return c;
  }
  /* reverse of compressInfo (generator only) */
  function expandInfo(st, b, dir, g) {
    if (!b.soft || !b.compressed) return null;
    g = g || occ(st, b.id);
    const ax = b.softAxis;
    if (!leadLine(b, ax, dir).some(([x, y]) => isHard(st, g, x, y))) return null;
    const e = { x: b.x, y: b.y, w: b.w, h: b.h };
    if (ax === 'x') { e.w = b.w + 1; if (dir > 0) e.x = b.x - 1; }
    else { e.h = b.h + 1; if (dir > 0) e.y = b.y - 1; }
    if (!rectFree(st, g, e.x, e.y, e.w, e.h)) return null;
    return e;
  }

  /* ---------- state queries ---------- */
  function isSnug(st, b) {
    const g = occ(st, b.id);
    for (const ax of ['x', 'y']) {
      if (b.axis === 'h' && ax !== 'x') continue;
      if (b.axis === 'v' && ax !== 'y') continue;
      const r = slideRange(st, b, ax, g), cur = ax === 'x' ? b.x : b.y;
      if (r.min !== cur || r.max !== cur) return false;
    }
    return true;
  }
  function blockCanMove(st, b) {
    if (b.fixed || b.capped) return false;
    const g = occ(st, b.id);
    for (const ax of ['x', 'y']) {
      if (!canAxis(b, ax)) continue;
      const r = slideRange(st, b, ax, g), cur = ax === 'x' ? b.x : b.y;
      if (r.min < cur || r.max > cur) return true;
    }
    if (b.soft && !b.compressed) for (const d of [1, -1]) if (compressInfo(st, b, d, g)) return true;
    return false;
  }
  function headPossible(st, item) {
    if (!item) return false;
    if (item.type === 'block') { const g = occ(st); return st.gates.some(gt => entryOptions(st, item, gt, g).length > 0); }
    if (item.type === 'sock') return filledCount(st) < st.W * st.H;
    if (item.type === 'cap') { const b = blockById(st, item.baseId); return !!b && !b.capped && isSnug(st, b); }
    return false;
  }
  function anyActionPossible(st, queue) {
    if (headPossible(st, queue[0])) return true;
    for (const b of st.blocks) if (blockCanMove(st, b)) return true;
    return false;
  }
  /* area the remaining queue still needs once every towel is squeezed */
  function queueArea(queue) {
    let n = 0;
    for (const it of queue) {
      if (it.type === 'block') n += it.soft ? it.w * it.h - 1 : it.w * it.h;
      else if (it.type === 'sock') n += 1;
    }
    return n;
  }
  /* empty cells the player can still afford to leave behind
     (an unsqueezed towel inside already counts 3 → it eats one cell) */
  function gapBudget(st, queue) {
    return st.W * st.H - filledCount(st) - queueArea(queue);
  }

  /* ---------- boosters ---------- */
  function pressAll(st, vec) {
    const [dx, dy] = vec, ax = dx ? 'x' : 'y';
    let changed = false;
    for (let guard = 0; guard < 40; guard++) {
      let moved = false;
      const list = st.blocks.filter(b => canAxis(b, ax));
      list.sort((a, b) => dx > 0 ? (b.x + b.w) - (a.x + a.w) : dx < 0 ? a.x - b.x : dy > 0 ? (b.y + b.h) - (a.y + a.h) : a.y - b.y);
      for (const b of list) {
        const r = slideRange(st, b, ax), t = (dx > 0 || dy > 0) ? r.max : r.min;
        if (ax === 'x' && t !== b.x) { b.x = t; moved = true; }
        if (ax === 'y' && t !== b.y) { b.y = t; moved = true; }
      }
      if (!moved) break;
      changed = true;
    }
    return changed;
  }
  function shrinkInfo(b) {
    if (b.w * b.h <= 1) return null;
    let w = b.w, h = b.h;
    if (w > h) w--; else h--;
    return { w, h, freed: b.w * b.h - w * h };
  }

  /* ======================================================================
     GENERATOR
     1. seed the level's signature items (jewelry boxes, organizers, towels)
     2. pick planned gap cells (scatter or pocket) + fixed dividers
     3. exact-cover the rest with weighted travel items
     4. pull everything OUT through the gates with legal moves (reverse sim)
     5. reverse that log into the player's queue + reference solution
     6. replay the solution through the real rules with the real queue
     ====================================================================== */
  function tileGrid(W, H, pre, R, maxOnes, shapes) {
    const filled = pre.slice();
    const pieces = [];
    let ones = 0, nodes = 0;
    const first = () => { for (let i = 0; i < W * H; i++) if (!filled[i]) return i; return -1; };
    const fits = (x, y, w, h) => {
      if (x + w > W || y + h > H) return false;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (filled[yy * W + xx]) return false;
      return true;
    };
    const set = (x, y, w, h, v) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) filled[yy * W + xx] = v; };
    function rec() {
      if (++nodes > 12000) return false;
      const c = first();
      if (c < 0) return true;
      const x = c % W, y = (c / W) | 0;
      for (const s of weightedOrder(shapes, R)) {
        const one = s.w * s.h === 1;
        if (one && ones >= maxOnes) continue;
        if (!fits(x, y, s.w, s.h)) continue;
        set(x, y, s.w, s.h, 1); pieces.push({ x, y, w: s.w, h: s.h, item: s.item }); if (one) ones++;
        if (rec()) return true;
        set(x, y, s.w, s.h, 0); pieces.pop(); if (one) ones--;
      }
      return false;
    }
    return rec() ? pieces : null;
  }

  function gateMouths(W, H, gates) {
    const m = new Uint8Array(W * H);
    for (const g of gates) for (let a = g.start; a < g.start + g.len; a++) {
      const x = g.side === 'left' ? 0 : g.side === 'right' ? W - 1 : a;
      const y = g.side === 'top' ? 0 : g.side === 'bottom' ? H - 1 : a;
      if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 1;
    }
    return m;
  }
  /* planned empty cells; never on a gate mouth, never on a seeded item, and
     never completing a whole empty side of a jewelry box (it could not seat) */
  function pickGaps(W, H, n, pattern, R, gates, blocked, boxes) {
    const cells = new Uint8Array(W * H);
    if (n <= 0) return cells;
    const mouth = gateMouths(W, H, gates);
    const sides = [];
    for (const p of boxes) sides.push(
      [[p.x, p.y - 1], [p.x + 1, p.y - 1]], [[p.x, p.y + 2], [p.x + 1, p.y + 2]],
      [[p.x - 1, p.y], [p.x - 1, p.y + 1]], [[p.x + 2, p.y], [p.x + 2, p.y + 1]]);
    const seatOk = (x, y) => {
      for (const sd of sides) {
        const k = sd.findIndex(([sx, sy]) => sx === x && sy === y);
        if (k < 0) continue;
        const [ox, oy] = sd[1 - k];
        if (ox < 0 || oy < 0 || ox >= W || oy >= H || cells[oy * W + ox]) return false;
      }
      return true;
    };
    let placed = 0, guard = 0;
    while (placed < n && guard++ < 6000) {
      const x = Math.floor(R() * W), y = Math.floor(R() * H), i = y * W + x;
      if (cells[i] || mouth[i] || blocked[i]) continue;
      let nb = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && cells[yy * W + xx]) nb++;
      }
      if (pattern === 'scatter' && nb > 0) continue;
      if (pattern === 'pocket' && placed % 3 !== 0 && nb === 0) continue;
      if (!seatOk(x, y)) continue;
      cells[i] = 1; placed++;
    }
    return placed === n ? cells : null;
  }

  function exitOk(st, b, gate, g) {
    const ax = sideAxis(gate.side);
    if (!canAxis(b, ax)) return false;
    const c0 = ax === 'x' ? b.y : b.x, cl = ax === 'x' ? b.h : b.w;
    if (!(c0 >= gate.start && c0 + cl <= gate.start + gate.len)) return false;
    g = g || occ(st, b.id);
    if (gate.side === 'left') return b.x === 0 || rectFree(st, g, 0, b.y, b.x, b.h);
    if (gate.side === 'right') return b.x + b.w === st.W || rectFree(st, g, b.x + b.w, b.y, st.W - b.x - b.w, b.h);
    if (gate.side === 'top') return b.y === 0 || rectFree(st, g, b.x, 0, b.w, b.y);
    return b.y + b.h === st.H || rectFree(st, g, b.x, b.y + b.h, b.w, st.H - b.y - b.h);
  }
  function allSlides(st) {
    const out = [];
    for (const b of st.blocks) {
      if (b.fixed) continue;
      const g = occ(st, b.id);
      for (const ax of ['x', 'y']) {
        if (!canAxis(b, ax)) continue;
        const r = slideRange(st, b, ax, g), cur = ax === 'x' ? b.x : b.y;
        for (let v = r.min; v <= r.max; v++) if (v !== cur) out.push({ b, x: ax === 'x' ? v : b.x, y: ax === 'y' ? v : b.y });
      }
    }
    return out;
  }
  function exitScore(st) {
    let n = 0;
    for (const b of st.blocks) {
      if (b.fixed) continue;
      const g = occ(st, b.id);
      if (b.soft && b.compressed) { for (const d of [1, -1]) if (expandInfo(st, b, d, g)) n++; continue; }
      for (const gate of st.gates) if (exitOk(st, b, gate, g)) n++;
    }
    return n;
  }

  /* pull blocks OUT through gates using only legal (reversible) moves */
  function reverseSim(st, R, cfg) {
    const log = [];
    let steps = 0, last = null;
    const movableCount = () => st.blocks.reduce((n, b) => n + (b.fixed ? 0 : 1), 0);
    const extract = c => {
      log.push({ t: 'extract', id: c.b.id, gi: c.gi, block: Object.assign({}, c.b) });
      st.blocks.splice(st.blocks.indexOf(c.b), 1);
      last = null;
    };
    while (movableCount() > cfg.preplaced) {
      if (++steps > (cfg.maxSteps || 260)) return null;
      const exits = [], expands = [];
      for (const b of st.blocks) {
        if (b.fixed) continue;
        const g = occ(st, b.id);
        if (b.soft && b.compressed) {
          for (const dir of [1, -1]) { const e = expandInfo(st, b, dir, g); if (e) expands.push({ b, dir, e }); }
          continue;
        }
        st.gates.forEach((gate, gi) => { if (exitOk(st, b, gate, g)) exits.push({ b, gi }); });
      }
      if (expands.length && (!exits.length || R() < 0.5)) {
        const c = pick(expands, R);
        log.push({ t: 'expand', id: c.b.id, dir: c.dir });
        Object.assign(c.b, c.e); c.b.compressed = false; last = null;
        continue;
      }
      if (exits.length && R() >= (cfg.shuffle || 0)) { extract(pick(exits, R)); continue; }
      let slides = allSlides(st);
      if (last) slides = slides.filter(s => !(s.b.id === last.id && s.x === last.x && s.y === last.y));
      if (!slides.length) { if (exits.length) { extract(pick(exits, R)); continue; } return null; }
      let choice;
      if (!exits.length) {
        let best = -1, bestList = [];
        for (const s of slides) {
          const ox = s.b.x, oy = s.b.y;
          s.b.x = s.x; s.b.y = s.y;
          const sc = exitScore(st);
          s.b.x = ox; s.b.y = oy;
          if (sc > best) { best = sc; bestList = [s]; } else if (sc === best) bestList.push(s);
        }
        choice = pick(bestList, R);
      } else choice = pick(slides, R);
      log.push({ t: 'move', id: choice.b.id, from: { x: choice.b.x, y: choice.b.y }, to: { x: choice.x, y: choice.y } });
      last = { id: choice.b.id, x: choice.b.x, y: choice.b.y };
      choice.b.x = choice.x; choice.b.y = choice.y;
    }
    for (let k = 0; k < (cfg.preShuffle || 0); k++) {
      const slides = allSlides(st);
      if (!slides.length) break;
      const c = pick(slides, R);
      log.push({ t: 'move', id: c.b.id, from: { x: c.b.x, y: c.b.y }, to: { x: c.x, y: c.y } });
      c.b.x = c.x; c.b.y = c.y;
    }
    return log;
  }

  function itemFromBlock(b) {
    return { type: 'block', id: b.id, w: b.w, h: b.h, color: b.color, item: b.item, axis: b.axis, soft: !!b.soft, softAxis: b.softAxis, base: !!b.base };
  }

  /* one forward action through the real rules; `queue` (optional) is consumed */
  function applyAct(st, a, items, queue) {
    if (a.t === 'enter') {
      const item = queue ? queue[0] : items[a.id];
      if (!item || item.type !== 'block' || item.id !== a.id) return false;
      const opt = entryOptions(st, item, st.gates[a.gi]).find(o => o.offset === a.offset);
      if (!opt) return false;
      if (queue) queue.shift();
      applyEnter(st, item, st.gates[a.gi], opt);
      return true;
    }
    if (a.t === 'slide') {
      const b = blockById(st, a.id);
      if (!b || !canSlideTo(st, b, a.to.x, a.to.y)) return false;
      b.x = a.to.x; b.y = a.to.y;
      return true;
    }
    if (a.t === 'compress') {
      const b = blockById(st, a.id), c = b && compressInfo(st, b, a.dir);
      if (!c) return false;
      Object.assign(b, c); b.compressed = true;
      return true;
    }
    if (a.t === 'cap') {
      if (queue) { const it = queue[0]; if (!it || it.type !== 'cap' || it.baseId !== a.baseId) return false; }
      const b = blockById(st, a.baseId);
      if (!b || b.capped || !isSnug(st, b)) return false;
      if (queue) queue.shift();
      b.capped = true;
      return true;
    }
    return false;
  }

  function buildSolution(W, H, gates, initial, log) {
    const st = { W, H, gates, blocks: cloneBlocks(initial) };
    const acts = [], items = {};
    for (let i = log.length - 1; i >= 0; i--) {
      const a = log[i];
      if (a.t === 'move') {
        const b = blockById(st, a.id);
        if (!b || !canSlideTo(st, b, a.from.x, a.from.y)) return null;
        acts.push({ t: 'slide', id: a.id, to: { x: a.from.x, y: a.from.y } });
        b.x = a.from.x; b.y = a.from.y;
      } else if (a.t === 'expand') {
        const b = blockById(st, a.id), c = b && compressInfo(st, b, a.dir);
        if (!c) return null;
        acts.push({ t: 'compress', id: a.id, dir: a.dir });
        Object.assign(b, c); b.compressed = true;
      } else {
        const src = a.block, item = itemFromBlock(src), gate = gates[a.gi];
        const offset = sideAxis(gate.side) === 'x' ? src.y : src.x;
        const opt = entryOptions(st, item, gate).find(o => o.offset === offset);
        if (!opt) return null;
        acts.push({ t: 'enter', id: item.id, gi: a.gi, offset });
        items[item.id] = item;
        const b = applyEnter(st, item, gate, opt);
        if (b.x !== src.x || b.y !== src.y) {
          if (!canSlideTo(st, b, src.x, src.y)) return null;
          acts.push({ t: 'slide', id: b.id, to: { x: src.x, y: src.y } });
          b.x = src.x; b.y = src.y;
        }
      }
    }
    return { acts, items };
  }

  /* lids join the queue right after their jewelry box is seated for good */
  function insertCaps(W, H, gates, initial, acts, items, baseIds) {
    if (!baseIds.length) return acts.slice();
    const st = { W, H, gates, blocks: cloneBlocks(initial) };
    const lastMove = {}, snug = {};
    baseIds.forEach(id => { lastMove[id] = -1; snug[id] = []; });
    const record = i => { for (const id of baseIds) { const b = blockById(st, id); snug[id][i + 1] = !!b && isSnug(st, b); } };
    record(-1);
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      if (!applyAct(st, a, items, null)) return null;
      if ((a.t === 'enter' || a.t === 'slide') && baseIds.includes(a.id)) lastMove[a.id] = i;
      record(i);
    }
    const ins = {};
    for (const id of baseIds) {
      let k = null;
      for (let i = lastMove[id]; i < acts.length; i++) if (snug[id][i + 1]) { k = i; break; }
      if (k === null) return null;
      (ins[k] = ins[k] || []).push(id);
    }
    const out = [];
    if (ins[-1]) ins[-1].forEach(id => out.push({ t: 'cap', baseId: id }));
    acts.forEach((a, i) => { out.push(a); if (ins[i]) ins[i].forEach(id => out.push({ t: 'cap', baseId: id })); });
    return out;
  }

  /* independent replay with the real queue — the solvability proof */
  function verifyLevel(level) {
    const st = { W: level.W, H: level.H, gates: level.gates, blocks: cloneBlocks(level.initial) };
    const q = level.queue.slice();
    for (const a of level.solution) if (!applyAct(st, a, null, q)) return false;
    return q.length === 0 && filledCount(st) === level.targetCells && st.blocks.every(b => !b.base || b.capped);
  }

  function touching(a, b) {
    const ox = a.x < b.x + b.w && b.x < a.x + a.w, oy = a.y < b.y + b.h && b.y < a.y + a.h;
    const ax = a.x + a.w === b.x || b.x + b.w === a.x, ay = a.y + a.h === b.y || b.y + b.h === a.y;
    return (ox && ay) || (oy && ax);
  }
  function assignColors(blocks, R, n) {
    const mov = blocks.filter(b => !b.fixed);
    const recent = [];
    for (const b of mov) {
      const used = new Set(mov.filter(o => o !== b && o._c && touching(o, b)).map(o => o.color));
      let cand = []; for (let i = 0; i < n; i++) if (!used.has(i) && !recent.includes(i)) cand.push(i);
      if (!cand.length) for (let i = 0; i < n; i++) if (!used.has(i)) cand.push(i);
      if (!cand.length) cand = [0];
      b.color = pick(cand, R); b._c = true;
      recent.push(b.color); if (recent.length > 2) recent.shift();
    }
    mov.forEach(b => { delete b._c; });
  }

  function randomGates(W, H, R) {
    for (let t = 0; t < 60; t++) {
      const gates = [];
      for (const side of SIDES) {
        const L = (side === 'left' || side === 'right') ? H : W;
        if (L >= 7 && R() < 0.35) {
          const l1 = 2, l2 = 2 + (R() < 0.5 ? 1 : 0), s1 = Math.floor(R() * 2);
          const room = L - (s1 + l1 + 1) - l2;
          if (room >= 0) { const s2 = s1 + l1 + 1 + Math.floor(R() * (room + 1)); gates.push({ side, start: s1, len: l1 }, { side, start: s2, len: l2 }); continue; }
        }
        const len = 2 + Math.floor(R() * 3), start = Math.floor(R() * (L - len + 1));
        gates.push({ side, start, len });
      }
      if (gates.filter(g => g.len >= 3).length >= 2) return gates;
    }
    return SIDES.map(side => ({ side, start: 1, len: 3 }));
  }

  function newBlock(id, p, extra) {
    return Object.assign({ id, x: p.x, y: p.y, w: p.w, h: p.h, item: p.item, fixed: false, color: 0, axis: 'free', soft: false, softAxis: null, compressed: false, base: false, capped: false, sock: false }, extra || {});
  }

  function attemptLevel(cfg, attempt) {
    const W = cfg.W, H = cfg.H, N = W * H;
    const R = mulberry32(Math.imul((cfg.seed | 0) + 1, 0x9E3779B1) ^ Math.imul(attempt + 1, 0x85EBCA77));
    const gates = cfg.gates ? cfg.gates.map(g => Object.assign({}, g)) : randomGates(W, H, R);
    const fillTarget = cfg.fillTarget == null ? 1 : cfg.fillTarget;
    const gapN = Math.round(N * (1 - fillTarget));
    const weights = Object.assign({}, DEFAULT_ITEMS, cfg.items || {});
    const shapes = [];
    for (const k of Object.keys(ITEM_SHAPES)) if (weights[k] > 0) for (const [w, h] of ITEM_SHAPES[k]) shapes.push({ w, h, wt: weights[k], item: k });
    if (!shapes.length) return null;

    /* 1. signature items first, so low-fill boards still carry them */
    const mask = new Uint8Array(N), seeded = [];
    const req = [];
    for (let k = 0; k < (cfg.caps || 0); k++) req.push(['jewelry', [[2, 2]]]);
    for (const [k, n] of Object.entries(cfg.minItems || {})) if (ITEM_SHAPES[k]) for (let j = 0; j < n; j++) req.push([k, ITEM_SHAPES[k]]);
    for (let k = 0; k < (cfg.soft || 0); k++) req.push(['towel', [[2, 1], [1, 2]]]);
    for (const [item, opts] of req) {
      let done = false;
      for (let t = 0; t < 60 && !done; t++) {
        const [sw, sh] = opts[Math.floor(R() * opts.length)];
        const x = Math.floor(R() * (W - sw + 1)), y = Math.floor(R() * (H - sh + 1));
        let free = true;
        for (let yy = y; yy < y + sh && free; yy++) for (let xx = x; xx < x + sw; xx++) if (mask[yy * W + xx]) { free = false; break; }
        if (!free) continue;
        for (let yy = y; yy < y + sh; yy++) for (let xx = x; xx < x + sw; xx++) mask[yy * W + xx] = 1;
        seeded.push({ x, y, w: sw, h: sh, item });
        done = true;
      }
      if (!done) return null;
    }
    /* 2. planned gaps + fixed dividers */
    const gaps = pickGaps(W, H, gapN, cfg.gapPattern || 'scatter', R, gates, mask, seeded.filter(p => p.item === 'jewelry'));
    if (!gaps) return null;
    const pre = new Uint8Array(N);
    for (let i = 0; i < N; i++) pre[i] = mask[i] || gaps[i] ? 1 : 0;
    const blocks = [];
    let nid = 1;
    for (let k = 0; k < (cfg.obstacles || 0); k++) {
      for (let tries = 0; tries < 40; tries++) {
        const x = 1 + Math.floor(R() * (W - 2)), y = 1 + Math.floor(R() * (H - 2));
        let ok = !pre[y * W + x];
        for (const b of blocks) if (Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1) ok = false;
        if (!ok) continue;
        pre[y * W + x] = 1;
        blocks.push(newBlock(nid++, { x, y, w: 1, h: 1, item: 'divider' }, { fixed: true, color: -1 }));
        break;
      }
    }
    /* 3. exact cover of what is left */
    const pieces = tileGrid(W, H, pre, R, cfg.maxOnes == null ? 1 : cfg.maxOnes, shapes);
    if (!pieces) return null;
    for (const p of seeded) {
      if (p.item === 'jewelry') blocks.push(newBlock(nid++, p, { base: true }));
      else if (p.item === 'towel') blocks.push(newBlock(nid++, p, { soft: true, compressed: true, softAxis: p.w === 2 ? 'x' : 'y' }));
      else blocks.push(newBlock(nid++, p));
    }
    for (const p of pieces) blocks.push(newBlock(nid++, p));
    const axisBy = cfg.axisByItem || null;
    for (const b of blocks) {
      if (b.fixed || b.soft || b.base || b.w === b.h) continue;
      const pAxis = axisBy ? (axisBy[b.item] || 0) : (cfg.axisProb || 0);
      if (R() < pAxis) b.axis = b.w > b.h ? 'h' : 'v';
    }
    assignColors(blocks, R, 8);

    /* 4–6. reverse, rebuild, verify */
    const st = { W, H, gates, blocks: cloneBlocks(blocks) };
    const log = reverseSim(st, R, cfg);
    if (!log) return null;
    const initial = cloneBlocks(st.blocks);
    if (initial.some(b => b.soft)) return null;            // towels must arrive via the queue
    const sol = buildSolution(W, H, gates, initial, log);
    if (!sol) return null;
    const baseIds = blocks.filter(b => b.base).map(b => b.id);
    const acts = insertCaps(W, H, gates, initial, sol.acts, sol.items, baseIds);
    if (!acts) return null;
    const byId = {}; blocks.forEach(b => { byId[b.id] = b; });
    const queue = [];
    for (const a of acts) {
      if (a.t === 'enter') queue.push(sol.items[a.id]);
      else if (a.t === 'cap') { const bb = byId[a.baseId]; queue.push({ type: 'cap', id: 'cap-' + a.baseId, baseId: a.baseId, item: 'lid', w: bb.w, h: bb.h, color: bb.color }); }
    }
    if (queue.filter(q => q.type === 'block').length < (cfg.minQueue || 6)) return null;
    const usedGates = new Set(acts.filter(a => a.t === 'enter').map(a => a.gi));
    if (usedGates.size < Math.min(cfg.minGatesUsed || 2, gates.length)) return null;
    const level = {
      W, H, gates, initial, queue, solution: acts, solvedLayout: blocks, attempt, seed: cfg.seed,
      gapCount: gapN, targetCells: N - gapN, fillTarget: (N - gapN) / N, gapCells: Array.from(gaps)
    };
    return verifyLevel(level) ? level : null;
  }

  function generateLevel(cfg) {
    const start = cfg.attempt || 0, span = cfg.attempts || 2000;
    for (let attempt = start; attempt < start + span; attempt++) {
      const lv = attemptLevel(cfg, attempt);
      if (lv) return lv;
    }
    return null;
  }

  global.PJ = {
    SIDES, INWARD, ITEM_SHAPES, sideAxis, mulberry32, cloneBlocks, occ, rectFree, blockById, filledCount,
    canAxis, slideRange, canSlideTo, entryOptions, entryBlockReason, makeBlock, applyEnter, itemForShape,
    compressInfo, expandInfo, isSnug, blockCanMove, headPossible, anyActionPossible, queueArea, gapBudget,
    pressAll, shrinkInfo, tileGrid, reverseSim, buildSolution, insertCaps, verifyLevel,
    generateLevel, attemptLevel, randomGates, applyAct
  };
})(typeof window !== 'undefined' ? window : globalThis);
