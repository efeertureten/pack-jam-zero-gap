/* ==========================================================================
   LEVEL BOOK — the 100-level difficulty curve (5 phases) + endless mode.
   designLevel(n, variant) turns the design table into generator params.
   tools/bake.js searches each level once and stores {variant, attempt}
   in levels.baked.js, so the game rebuilds every suitcase instantly.
   ========================================================================== */
(function (global) {
  'use strict';
  const PJ = global.PJ;

  const CITIES = [
    ['IST', 'İstanbul'], ['AMS', 'Amsterdam'], ['BCN', 'Barselona'], ['LIS', 'Lizbon'], ['FCO', 'Roma'],
    ['CDG', 'Paris'], ['LHR', 'Londra'], ['BER', 'Berlin'], ['VIE', 'Viyana'], ['PRG', 'Prag'],
    ['BUD', 'Budapeşte'], ['ATH', 'Atina'], ['ADB', 'İzmir'], ['AYT', 'Antalya'], ['BJV', 'Bodrum'],
    ['DLM', 'Dalaman'], ['ESB', 'Ankara'], ['TZX', 'Trabzon'], ['NAP', 'Napoli'], ['MXP', 'Milano'],
    ['ZRH', 'Zürih'], ['CPH', 'Kopenhag'], ['OSL', 'Oslo'], ['HEL', 'Helsinki'], ['KEF', 'Reykjavik'],
    ['DUB', 'Dublin'], ['EDI', 'Edinburgh'], ['MAD', 'Madrid'], ['AGP', 'Malaga'], ['PMI', 'Mallorca'],
    ['NCE', 'Nice'], ['MRS', 'Marsilya'], ['DBV', 'Dubrovnik'], ['SPU', 'Split'], ['TIA', 'Tiran'],
    ['SKG', 'Selanik'], ['JTR', 'Santorini'], ['LCA', 'Larnaka'], ['TLV', 'Tel Aviv'], ['CAI', 'Kahire'],
    ['RAK', 'Marakeş'], ['DXB', 'Dubai'], ['DOH', 'Doha'], ['BKK', 'Bangkok'], ['SIN', 'Singapur'],
    ['HND', 'Tokyo'], ['ICN', 'Seul'], ['SYD', 'Sidney'], ['JFK', 'New York'], ['GIG', 'Rio']
  ];
  const TRIP = ['', 'Kaçamağı', 'Aktarması', 'Tatili', 'Turu', 'Seferi'];
  const PHASE_NAMES = ['', 'Temel Yerleşim', 'İlk Boşluklar', 'Plaj Havlusu', 'Takı Kutusu & Organizer', 'Ultra Valiz'];
  const SPECIAL_NAMES = {
    15: 'Aktarma Kontrolü', 35: 'Kilitli Pasaportlar', 45: 'Sahil Dönüşü', 60: 'Havlu Finali',
    80: 'Gece Uçuşu', 85: 'Organizer Finali', 90: 'Zero Gap: Kabin', 95: 'Zero Gap: Bagaj', 100: 'Zero Gap: Dünya Turu'
  };
  const INTROS = {
    1: 'Pasaport cüzdanını bir kapıya dokunarak içeri gönder.',
    4: 'Yeni: el konsolu 1×3. Kayıp gittiyse tutup geri çekebilirsin.',
    7: 'Bavul büyüdü: 6×6.',
    13: 'İlk dar kapı: konsolun yönü hangi kapıdan gireceğini belirler.',
    15: 'Faz 1 sınavı: yatay konsollar dar üst ve alt kapılardan giremez.',
    16: 'Bu bavulda 1 boşluk hakkın var. Kuyruk bitince bavul kapanır.',
    18: 'Yeni: ilk yardım çantası 2×2.',
    21: 'Oklu pasaport cüzdanı sadece ok yönünde kayar ve o eksendeki kapılardan girer.',
    24: 'Bir kenarda hiç kapı yok.',
    26: 'Sabit bölme: bavulun iç dikişi, yerinden oynamaz.',
    31: 'Oklu konsollar geldi. Aynı kenarda iki dar kapı var.',
    36: 'Yeni: kemerli plaj havlusu. Duvara ya da sert bir eşyaya itmeye devam et, 1×3 → 1×2 büzüşür.',
    39: 'İki havlu. Havlu havluyu sıkıştırmaz, arkasına sert bir şey lazım.',
    45: 'Havlu sınavı: büzüşmeyen her havlu boşluk hakkından bir kare yer.',
    51: 'Boşluklar artık kümeli. Dağınık delikler büyük eşyaları sığmaz hale getirir.',
    61: 'Yeni: takı kutusu. Etrafı sarılıp hiç kıpırdamaz hale gelince şeffaf kapağını tak.',
    64: 'Yeni: organizer 2×3. Dar kapıdan sadece uzun yönüyle girer.',
    71: 'İki takı kutusu. Kutunun bir kenarını tamamen boş bırakırsan kapak takılmaz.',
    80: 'Boşluk bol, ama kutuların kenarları dolu kalmalı.',
    86: 'Ultra valiz: 7×8, bütün eşyalar bir arada.',
    90: 'ZERO GAP: boşluk hakkı yok. Bütün havlular büzüşmek zorunda.',
    95: 'ZERO GAP: tek kare bile boş kalmayacak.',
    100: 'FİNAL — ZERO GAP: bütün eşyalar, tek boşluk yok.'
  };

  const ZERO_GAP = new Set([90, 95, 100]);
  /* saw-tooth inside every block of 10: x1–x3 easy, x7 breather, x0 peak */
  const HEAT = [1.0, 0.1, 0.2, 0.3, 0.5, 0.6, 0.7, 0.3, 0.8, 0.9];
  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  const phaseOf = n => n <= 15 ? 1 : n <= 35 ? 2 : n <= 60 ? 3 : n <= 85 ? 4 : 5;

  function gridOf(n) {
    if (n <= 6) return [5, 5];
    if (n <= 35) return [6, 6];
    if (n <= 60) return [6, 7];
    if (n <= 85 || n === 90) return [7, 7];
    return [7, 8];
  }
  function fillOf(n) {
    if (n <= 15 || ZERO_GAP.has(n)) return 1;
    const t = (a, b, lo, hi) => lerp(lo, hi, (n - a) / (b - a));
    let f;
    if (n <= 20) f = n === 16 ? 0.97 : 0.945;
    else if (n <= 30) f = t(21, 30, 0.92, 0.88);
    else if (n <= 35) f = t(31, 35, 0.90, 0.88);
    else if (n <= 40) f = 0.85;
    else if (n <= 50) f = t(41, 50, 0.85, 0.80);
    else if (n <= 60) f = t(51, 60, 0.80, 0.75);
    else if (n <= 70) f = t(61, 70, 0.80, 0.76);
    else if (n <= 80) f = t(71, 80, 0.76, 0.70);
    else if (n <= 85) f = t(81, 85, 0.78, 0.75);
    else if (n <= 89) f = t(86, 89, 0.75, 0.72);
    else f = t(91, 99, 0.75, 0.70);
    if (n % 10 === 7 && n > 20) f = Math.min(0.95, f + 0.03);        // breather: a bit more room
    return f;
  }
  function towelsOf(n) {
    if (n < 36) return 0;
    if (n === 90 || n === 95) return 2;
    if (n === 100) return 3;
    let k = n <= 38 ? 1 : n <= 42 ? 2 : n <= 60 ? 3 : n <= 85 ? 1 : n <= 89 ? 2 : 3;
    if (n % 10 === 7 && k > 1) k--;
    return k;
  }
  function boxesOf(n) {
    if (n < 61) return 0;
    if (n === 95) return 2;
    if (n === 100) return 3;
    if (n <= 70) return 1;
    if (n <= 90) return 2;
    return 3;
  }
  function gateSpec(n) {
    const br = n % 10 === 7;
    let s;
    if (n <= 6) s = { count: 4, lens: [3, 3], minLong: 4 };
    else if (n <= 12) s = { count: 4, lens: [3, 4], minLong: 4 };
    else if (n <= 23) s = { count: 4, lens: [3, 4], narrow: 1, minLong: 3 };
    else if (n <= 30) s = { count: 3, lens: [2, 3], minLong: 2 };
    else if (n <= 35) s = { count: 4, paired: true, lens: [2, 3], minLong: 2 };
    else if (n <= 40) s = { count: 4, lens: [3, 4], minLong: 4 };
    else if (n <= 50) s = { count: 3, lens: [2, 3], minLong: 2 };
    else if (n <= 60) s = { count: 4, paired: true, lens: [2, 3], minLong: 2 };
    else if (n <= 63) s = { count: 4, lens: [3, 3], minLong: 4 };
    else if (n <= 70) s = { count: 4, lens: [2, 3], minLong: 2 };
    else if (n <= 80) s = { count: 5, lens: [2, 3], minLong: 1 };
    else if (ZERO_GAP.has(n)) s = { count: 6, lens: [2, 3], minLong: 3 };
    else if (n <= 89) s = { count: 5, lens: [2, 3], minLong: 2 };
    else s = { count: 4, lens: [2, 3], minLong: 1 };
    if (br) s = Object.assign({}, s, { lens: [Math.min(s.lens[0] + 1, 3), Math.max(s.lens[1], 3)], minLong: Math.max(s.minLong, 2) });
    return s;
  }
  function makeGates(W, H, spec, R) {
    const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
    const sides = ['top', 'right', 'bottom', 'left'];
    for (let t = 0; t < 300; t++) {
      const order = sides.slice();
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const per = { top: 1, right: 1, bottom: 1, left: 1 };
      if (spec.count === 3) per[order[0]] = 0;
      if (spec.count === 5) per[order[0]] = 2;
      if (spec.count === 6) { per[order[0]] = 2; per[order[1]] = 2; }
      if (spec.count === 4 && spec.paired) { per[order[0]] = 2; per[order[1]] = 0; }
      const gates = [];
      let ok = true;
      for (const side of sides) {
        const L = (side === 'left' || side === 'right') ? H : W;
        if (per[side] === 1) {
          const len = Math.min(L, ri(spec.lens[0], spec.lens[1]));
          gates.push({ side, start: ri(0, L - len), len });
        } else if (per[side] === 2) {
          const l1 = ri(2, Math.min(3, spec.lens[1])), l2 = ri(spec.lens[0], spec.lens[1]);
          if (l1 + l2 + 1 > L) { ok = false; break; }
          const s1 = ri(0, L - l1 - l2 - 1), s2 = ri(s1 + l1 + 1, L - l2);
          gates.push({ side, start: s1, len: l1 }, { side, start: s2, len: l2 });
        }
      }
      if (!ok) continue;
      for (let k = 0; k < (spec.narrow || 0); k++) { const g = gates[Math.floor(R() * gates.length)]; g.len = 2; }
      if (gates.filter(g => g.len >= 3).length < (spec.minLong || 0)) continue;
      return gates;
    }
    return sides.map(side => ({ side, start: 0, len: 3 }));
  }

  /* hand-written recipes override the curve for the three checkpoint levels */
  const RECIPES = {
    15: {
      items: { perfume: 0.15, passport: 1.1, console: 1.9, kit: 0, organizer: 0 }, axisByItem: {},
      gates: [{ side: 'top', start: 2, len: 2 }, { side: 'right', start: 0, len: 3 }, { side: 'bottom', start: 1, len: 2 }, { side: 'left', start: 3, len: 3 }],
      obstacles: 0, preplaced: 2, preShuffle: 1, shuffle: 0, soft: 0, caps: 0, maxOnes: 1, minQueue: 11, minGatesUsed: 4
    },
    45: {
      fillTarget: 0.81, gapPattern: 'scatter',
      items: { perfume: 0.1, passport: 1.1, console: 1.3, kit: 1.0, organizer: 0 }, axisByItem: { passport: 0.45, console: 0.3 },
      gates: [{ side: 'top', start: 1, len: 2 }, { side: 'right', start: 2, len: 3 }, { side: 'bottom', start: 3, len: 3 }],
      obstacles: 1, preplaced: 2, preShuffle: 2, shuffle: 0.05, soft: 3, caps: 0, maxOnes: 2, minQueue: 10, minGatesUsed: 3
    },
    80: {
      fillTarget: 0.71, gapPattern: 'pocket',
      items: { perfume: 0.1, passport: 1.0, console: 1.1, kit: 0.6, organizer: 1.7 }, axisByItem: { passport: 0.5, console: 0.4, organizer: 0.35 },
      minItems: { organizer: 2 },
      gates: [{ side: 'top', start: 0, len: 2 }, { side: 'top', start: 4, len: 3 }, { side: 'right', start: 3, len: 2 }, { side: 'bottom', start: 2, len: 3 }, { side: 'left', start: 1, len: 2 }],
      obstacles: 2, preplaced: 3, preShuffle: 2, shuffle: 0.06, soft: 1, caps: 2, maxOnes: 3, minQueue: 9, minGatesUsed: 4
    }
  };

  function designLevel(n, variant) {
    variant = variant || 0;
    const phase = phaseOf(n), h = HEAT[n % 10], [W, H] = gridOf(n), N = W * H;
    const fillTarget = fillOf(n), gapCount = Math.round(N * (1 - fillTarget));
    const items = {
      perfume: n <= 3 ? 0.35 : 0.15,
      passport: n <= 3 ? 1.4 : 1.15,
      console: n >= 4 ? 1.3 : 0,
      kit: n >= 18 ? 1.0 : 0,
      organizer: n >= 64 ? (n >= 71 ? 1.6 : 1.2) : 0
    };
    if (ZERO_GAP.has(n)) Object.assign(items, { perfume: 0.15, kit: 1.0, organizer: 1.0 });
    const axisByItem = {};
    if (n >= 21) axisByItem.passport = Math.min(0.55, lerp(0.3, 0.5, h) + (n >= 86 ? 0.05 : 0));
    if (n >= 31) axisByItem.console = n >= 86 ? 0.45 : lerp(0.25, 0.35, h);
    if (n >= 71) axisByItem.organizer = n >= 86 ? 0.45 : 0.35;
    if (n >= 36 && n <= 38) { axisByItem.passport = 0.2; axisByItem.console = 0; }   // towel intro: nothing else new
    if (n >= 61 && n <= 63) axisByItem.console = 0.2;
    if (n >= 64 && n <= 66) axisByItem.organizer = 0;
    const minItems = {};
    if (n >= 64) minItems.organizer = n >= 71 ? 2 : 1;
    if (ZERO_GAP.has(n)) minItems.organizer = n === 90 ? 1 : 2;
    const br = n % 10 === 7;
    let obstacles = n < 26 ? 0 : n <= 50 ? 1 : n <= 85 ? 2 : 3;
    if (ZERO_GAP.has(n)) obstacles = 2;
    if (br && obstacles > 0 && phase < 4) obstacles--;
    const preplaced = n <= 3 ? 3 : n <= 6 ? 2 : n <= 60 ? 2 : 3;
    let preShuffle = n < 15 ? 0 : n === 15 ? 1 : n <= 27 ? 0 : n <= 40 ? 1 : n <= 60 ? (h >= 0.5 ? 2 : 1) : n <= 90 ? 2 : 3;
    if (br) preShuffle = Math.max(0, preShuffle - 1);
    const maxOnes = n <= 3 ? 3 : fillTarget >= 1 ? 1 : fillTarget >= 0.76 ? 2 : 3;
    const targetCells = N - gapCount;
    const R = PJ.mulberry32(Math.imul(n + 1, 0x2C1B3C6D) ^ Math.imul(variant + 1, 0x297A2D39));
    const gates = makeGates(W, H, gateSpec(n), R);
    const city = CITIES[(n - 1) % CITIES.length];
    let cfg = {
      n, phase, phaseName: PHASE_NAMES[phase], name: SPECIAL_NAMES[n] || (city[1] + ' ' + TRIP[phase]),
      code: city[0] + '-' + String(n).padStart(2, '0'), W, H, seed: n * 101 + variant * 7919,
      fillTarget, gapPattern: fillTarget >= 0.88 ? 'scatter' : 'pocket', zeroGap: ZERO_GAP.has(n) || fillTarget >= 1,
      items, axisByItem, minItems, gates, obstacles, preplaced, preShuffle,
      shuffle: phase <= 2 ? 0 : phase === 3 ? 0.045 : phase === 4 ? 0.055 : 0.065,
      soft: towelsOf(n), caps: boxesOf(n), maxOnes,
      minQueue: Math.max(4, Math.round(targetCells / 3.4) - preplaced - 1),
      minGatesUsed: Math.min(gates.length, phase >= 4 ? 4 : 3),
      boosters: phase <= 3 ? { undo: 5, vac: 2, shake: 2 } : phase === 4 ? { undo: 4, vac: 1, shake: 2 } : { undo: 3, vac: 1, shake: 1 },
      intro: INTROS[n] || null
    };
    if (RECIPES[n]) {
      cfg = Object.assign(cfg, RECIPES[n]);
      cfg.gapPattern = RECIPES[n].gapPattern || cfg.gapPattern;
      cfg.zeroGap = cfg.fillTarget >= 1;
    }
    return cfg;
  }

  const ENDLESS_SIZES = [[7, 7], [7, 8], [6, 8], [7, 8]];
  function endlessLevel(n, variant) {
    variant = variant || 0;
    const k = n - 101, [W, H] = ENDLESS_SIZES[k % ENDLESS_SIZES.length], zero = n % 5 === 0;
    const R = PJ.mulberry32(Math.imul(n + 1, 0x2C1B3C6D) ^ Math.imul(variant + 1, 0x297A2D39));
    const city = CITIES[(n - 1) % CITIES.length];
    return {
      n, phase: 5, phaseName: 'Sonsuz Sefer', name: (zero ? 'Zero Gap: ' : '') + city[1] + ' Seferi', code: city[0] + '-' + n,
      W, H, seed: n * 101 + variant * 7919, fillTarget: zero ? 1 : 0.72 + (k % 4) * 0.02, gapPattern: 'pocket', zeroGap: zero,
      items: { perfume: 0.12, passport: 1.0, console: 1.1, kit: 0.8, organizer: 1.3 },
      axisByItem: { passport: 0.5, console: 0.4, organizer: 0.4 }, minItems: { organizer: 1 },
      gates: makeGates(W, H, zero ? { count: 6, lens: [2, 3], minLong: 3 } : { count: 5, lens: [2, 3], minLong: 2 }, R),
      obstacles: 2, preplaced: 3, preShuffle: 2, shuffle: 0.06, soft: 2, caps: 2, maxOnes: zero ? 1 : 3,
      minQueue: 8, minGatesUsed: 4, boosters: { undo: 3, vac: 1, shake: 1 }, intro: k === 0 ? 'Sonsuz sefer: rastgele rota, garantili çözüm.' : null
    };
  }

  /* 0-based index → generated, verified level */
  function buildLevel(i) {
    const n = i + 1, baked = (global.PJ.BAKED || {})[n];
    const make = v => n <= 100 ? designLevel(n, v) : endlessLevel(n, v);
    if (baked) {
      const cfg = Object.assign(make(baked.v), { attempt: baked.a, attempts: 600 });
      const lv = PJ.generateLevel(cfg);
      if (lv) { lv.cfg = cfg; lv.index = i; lv.baked = lv.attempt === baked.a; return lv; }
    }
    for (let v = 0; v < 12; v++) {
      const cfg = Object.assign(make(v), { attempts: 900 });
      const lv = PJ.generateLevel(cfg);
      if (lv) { lv.cfg = cfg; lv.index = i; lv.baked = false; return lv; }
    }
    return null;
  }

  PJ.designLevel = designLevel;
  PJ.endlessLevel = endlessLevel;
  PJ.buildLevel = buildLevel;
  PJ.phaseOf = phaseOf;
  PJ.LEVEL_COUNT = 100;
})(typeof window !== 'undefined' ? window : globalThis);
