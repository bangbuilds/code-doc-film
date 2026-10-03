// World builders: ready-made environments (terrain + water + trees + palette) that return a
// world from kit.makeWorld plus a few facts about their own geometry, so a scene can place
// actors and cameras without guessing coordinates. Units are metres; y is up.
//
//   riverWorld   valley or gorge with a river (calm crossing, rapids, dry canyon)
//   valleyWorld  a flat valley floor between two ranges, optional stream
//   lakeWorld    a still lake ringed by forested hills
//   passWorld    a snow slope climbing to a mountain pass
//   bogWorld     flat marsh: tussocks and black pools to the horizon
//   loessWorld   loess plateau: flat-topped tableland cut by gullies (optionally one main gully)
//   slotWorld    a slot canyon a few metres wide with a stream
//   flatWorld    plain ground for streets, courtyards, parade grounds
//   tabletop     an interior table lit by a lamp or window (no terrain)
//   seaWorld     open ocean to the horizon (fleets, voyages)
//   coastWorld   a shore: bay, headlands and hills behind, open sea in front (harbours, landfalls)
//
// Every builder takes { seed } — the same seed always gives the same place.
import * as THREE from 'three';
import { makeWorld, slopeFn, scatterTrees, viewFov } from './kit.js';
import { makeNoise, smooth, lerp, rng, canvasTexture, VIEW, track, easeInOut } from './engine.js';
import { seaHeight } from './sea.js';

const fn = (v, d) => (typeof v === 'function' ? v : () => (v ?? d));

// ── river / gorge ─────────────────────────────────────────────────────────────
// The river runs along `axis` ('z' or 'x'). Cross-section, from the centre line out:
//   bed (below water) → bank → optional flat shelf (towns, camps) → valley wall → ridges.
// halfWidth, center (the river's centre line), shelfW, shelfH may be numbers or functions of
// (s, side): s = position along the river, side = ±1. `origin` moves the terrain's middle.
export function riverHeight(o = {}) {
  const n = makeNoise(o.seed ?? 1);
  const axis = o.axis || 'z';
  const cx = fn(o.center, 0), hw = fn(o.halfWidth, 100);
  const bed = o.bed || [-5, 3.5];                    // depth at centre, rise to the edge
  const bank = o.bank || [2, 6];                     // bank height, run
  const shelfW = fn(o.shelfW, 0), shelfH = fn(o.shelfH, bank[0]);
  const wall = { h: 90, hVar: 70, hScale: 0.002, run: 240, base: 0.5, ridge: 0.7, ridgeScale: 0.004, oct: 5, fadeIn: 0, spurs: 0, ...o.wall };
  const det = { amp: 3, scale: 0.03, fade: 20, oct: 3, ...o.detail };
  const H = (x, z) => {
    const s = axis === 'z' ? z : x, c = axis === 'z' ? x : z;
    const off = c - cx(s), side = off > 0 ? 1 : -1, d = Math.abs(off), w = hw(s, side);
    if (d < w) return bed[0] + (d / w) * bed[1];
    const e = d - w;
    let y = shelfH(s, side) * smooth(e / bank[1]);
    const e2 = Math.max(0, e - shelfW(s, side));
    let m = (wall.h + wall.hVar * n.fbm(x * wall.hScale, z * wall.hScale, 2)) * (1 - Math.exp(-e2 / wall.run))
      * (wall.base + wall.ridge * n.ridged(x * wall.ridgeScale, z * wall.ridgeScale, wall.oct));
    if (wall.spurs) m += n.fbm(x * 0.009, z * 0.009, 4) * wall.spurs * smooth(e2 / 50);
    y += wall.fadeIn ? m * smooth(e2 / wall.fadeIn) : m;
    return y + n.fbm(x * det.scale, z * det.scale, det.oct) * det.amp * smooth(e / det.fade);
  };
  H.center = cx; H.halfWidth = hw; H.axis = axis;
  return H;
}

const PALETTES = {
  green: { grass: '#2e3a26', grass2: '#3f4a2e', rock: '#4a4a44', rock2: '#686458', sand: '#57503f' },
  lush: { grass: '#34452a', grass2: '#4a5a34', rock: '#4d4d45', rock2: '#686458', sand: '#5c5544' },
  dry: { grass: '#645a3a', grass2: '#7d6c45', rock: '#6e5a44', rock2: '#9a7c58', sand: '#a08c66' },
  alpine: { grass: '#4f6232', grass2: '#65783e', rock: '#5a584f', rock2: '#6f6c62', sand: '#56693a', snow: '#e8ecee' },
  snow: { grass: '#8d9196', grass2: '#9da2a6', rock: '#4b4c4f', rock2: '#5d5e60', sand: '#bfc4c8', snow: '#e9edf0' },
  bog: { grass: '#57563a', grass2: '#6d6a45', rock: '#4a473a', rock2: '#5a5646', sand: '#3f3c2e' },
  loess: { grass: '#9a7c4a', grass2: '#ae8f58', rock: '#a07e52', rock2: '#bd9965', sand: '#8a6f45' },
  canyon: { grass: '#3c3b33', grass2: '#46453b', rock: '#4a4740', rock2: '#5d5950', sand: '#34322c' },
  tropic: { grass: '#3f6a34', grass2: '#587f3c', rock: '#5d584a', rock2: '#7a705c', sand: '#d6c69c' },
  savanna: { grass: '#8f7f46', grass2: '#a8914e', rock: '#7a6a4a', rock2: '#96835a', sand: '#d8c292' },
  arid: { grass: '#a98a5e', grass2: '#b89868', rock: '#8a6a4a', rock2: '#b08458', sand: '#d2b98c' },
  quay: { grass: '#566040', grass2: '#6c6c44', rock: '#5a5148', rock2: '#74695c', sand: '#8f8062' },
};
const WATERS = {
  calm: { speed: 1.2, deep: '#0e1418', shallow: '#1b2428', foam: 0.06, amp: 0.6 },
  slow: { speed: 2.2, deep: '#12181a', shallow: '#252c2a', foam: 0.15 },
  stream: { speed: 3.5, deep: '#17221f', shallow: '#2d3a31', foam: 0.14 },
  rapids: { speed: 6.5, deep: '#1b231f', shallow: '#434b3e', foam: 0.6 },
  muddy: { speed: 5, deep: '#5a4526', shallow: '#8c6d3e', foam: 0.3 },
  still: { speed: 0.15, deep: '#1c2a2e', shallow: '#2f4146', foam: 0, amp: 0.3 },
};
export { PALETTES, WATERS };

// trees: { count, color, scale:[a,b], maxSlope, minY, maxY, shape, clear:(x,y,z)=>bool to keep an area empty }
function addTrees(W, area, t, seed) {
  if (!t) return;
  const slope = slopeFn(W.H);
  for (const [i, spec] of (Array.isArray(t) ? t : [t]).entries()) {
    W.scene.add(scatterTrees({ count: spec.count ?? 8000, area: spec.area || area, heightFn: W.H, seed: seed + i, scale: spec.scale || [4, 9], color: spec.color || '#34422a', shape: spec.shape || 'blob',
      accept: (x, y, z) => y > (spec.minY ?? 4) && y < (spec.maxY ?? 1e9) && slope(x, z) < (spec.maxSlope ?? 2.2) && !(spec.clear && spec.clear(x, y, z)) }));
  }
}

export function riverWorld(o = {}) {
  const H = o.heightFn || riverHeight(o);
  const axis = o.axis || 'z';
  const size = o.size || [2000, 2400], center = o.origin || [0, 0];   // origin = [x, z] of the terrain's middle
  const maxHW = o.waterHalfWidth ?? 160;
  const along = axis === 'z' ? size[1] : size[0];
  const water = { size: axis === 'z' ? [maxHW * 2, along] : [along, maxHW * 2], seg: axis === 'z' ? [Math.round(maxHW / 1.5), Math.round(along / 6)] : [Math.round(along / 6), Math.round(maxHW / 1.5)],
    center: axis === 'z' ? [0, center[1]] : [center[0], 0], flow: axis === 'z' ? [0, 1] : [1, 0], ...WATERS[o.water || 'slow'], ...(typeof o.water === 'object' ? o.water : {}), ...o.waterOpts };
  const W = makeWorld({ name: o.name || 'river', heightFn: H, size, seg: o.seg || [Math.round(size[0] / 5), Math.round(size[1] / 5)], center,
    palette: typeof o.palette === 'object' ? o.palette : PALETTES[o.palette || 'green'], snowLine: o.snowLine, water, detail: o.detail3d ?? 1 });
  addTrees(W, [center[0] - size[0] * 0.4, center[0] + size[0] * 0.4, center[1] - size[1] * 0.4, center[1] + size[1] * 0.4], o.trees, (o.seed ?? 1) + 100);
  const cx = H.center || fn(o.center0, 0), hw = H.halfWidth || fn(o.halfWidth, 100);
  // river facts + helpers. s = position along the river; side = -1 | +1
  W.river = {
    axis, center: cx, halfWidth: hw,
    // world [x, z] for (s along, c across-from-centre)
    xz: (s, c) => (axis === 'z' ? [cx(s) + c, s] : [s, cx(s) + c]),
    // a point on the bank, `inset` metres back from the water's edge
    bank: (side, s, inset = 6) => { const c = side * (hw(s, side) + inset); return axis === 'z' ? [cx(s) + c, s] : [s, cx(s) + c]; },
  };
  return W;
}

// ── valley: a flat floor between two ranges, with an optional stream (meetings, marches, camps)
export function valleyWorld(o = {}) {
  const n = makeNoise(o.seed ?? 1), half = o.floorHalf ?? 150, stream = o.stream !== false;
  const wall = { h: 380, hVar: 120, run: 260, ...o.wall };
  const cz = (x) => 20 * Math.sin(x / 200);
  const H = (x, z) => {
    const d = Math.abs(z - cz(x)), floor = 2 + n.fbm(x * 0.01, z * 0.01, 3) * 1.5;
    if (stream && d < 14) return lerp(-0.6, floor, smooth((d - 5) / 9));       // the stream bed, below the water
    return d < half ? floor : floor + (wall.h + wall.hVar * n.fbm(x * 0.002, 3.3, 2)) * (1 - Math.exp(-(d - half) / wall.run)) * (0.5 + 0.7 * n.ridged(x * 0.004, z * 0.004, 5));
  };
  const size = o.size || [2000, 1600];
  const W = makeWorld({ name: o.name || 'valley', heightFn: H, size, seg: [Math.round(size[0] / 5), Math.round(size[1] / 5)], snowLine: o.snowLine ?? 330, palette: PALETTES[o.palette || 'alpine'],
    water: stream ? { size: [size[0], 70], seg: [200, 14], flow: [1, 0], speed: 2, deep: '#2a3a3c', shallow: '#4c5e5c', foam: 0.2, y: 0.3, amp: 0.25 } : null });
  addTrees(W, [-size[0] * 0.45, size[0] * 0.45, -size[1] * 0.45, size[1] * 0.45], o.trees ?? { count: 9000, color: '#3d5130', minY: 8, maxY: 300 }, (o.seed ?? 1) + 100);
  W.valley = { center: cz, floorHalf: half };
  return W;
}

// ── lake ─────────────────────────────────────────────────────────────────────
export function lakeWorld(o = {}) {
  const n = makeNoise(o.seed ?? 1), R = o.radius ?? 230, sq = o.squash ?? 1.4;
  const hill = { h: 220, hVar: 80, run: 260, ...o.hills };
  const H = (x, z) => {
    const d = Math.hypot(x / sq, z);
    if (d < R) return -6 + (d / R) * 5.5;
    const e = d - R;
    return smooth(e / 6) + (hill.h + hill.hVar * n.fbm(x * 0.002, z * 0.002, 2)) * (1 - Math.exp(-e / hill.run)) * (0.5 + 0.7 * n.ridged(x * 0.004, z * 0.004, 5)) + n.fbm(x * 0.04, z * 0.04, 3) * 2 * smooth(e / 12);
  };
  const size = o.size || [2000, 1600];
  const W = makeWorld({ name: o.name || 'lake', heightFn: H, size, seg: [Math.round(size[0] / 5), Math.round(size[1] / 5)], palette: PALETTES[o.palette || 'lush'],
    water: { size: [R * sq * 2 + 120, R * 2 + 120], seg: [80, 60], flow: [1, 0.2], ...WATERS.still, ...o.waterOpts } });
  addTrees(W, [-size[0] * 0.45, size[0] * 0.45, -size[1] * 0.45, size[1] * 0.45], o.trees, (o.seed ?? 1) + 100);
  // a point on the shore at angle a (radians), `inset` metres from the water
  W.lake = { radius: R, squash: sq, shore: (a, inset = 12) => [Math.cos(a) * (R + inset) * sq, Math.sin(a) * (R + inset)] };
  return W;
}

// ── snow pass: a slope that climbs toward +z, with a lower saddle at x≈0 and peaks either side
export function passWorld(o = {}) {
  const n = makeNoise(o.seed ?? 1);
  const H = (x, z) => {
    const saddle = (o.height ?? 520) - 160 * Math.exp(-(x * x) / (2 * 220 * 220));
    const rise = saddle * smooth((z + 300) / 1100);
    const peaks = 420 * Math.pow(n.ridged(x * 0.0025, z * 0.0025, 6), 2.2) * smooth((Math.abs(x) - 120) / 400);
    return rise + peaks + n.fbm(x * 0.02, z * 0.02, 4) * 10;
  };
  const W = makeWorld({ name: o.name || 'pass', heightFn: H, size: [2200, 2000], seg: [440, 400], center: [0, 300], snowLine: o.snowLine ?? -50, palette: PALETTES[o.palette || 'snow'] });
  // the trail zig-zags up the slope: [[x, z], …] from the foot (z≈-80) to the pass (z≈820)
  W.pass = { trail: [...Array(16)].map((_, i) => [Math.sin(i * 1.3) * 45 + i * 4, -80 + i * 60]) };
  return W;
}

// ── bog / grassland marsh ────────────────────────────────────────────────────
export function bogWorld(o = {}) {
  const n = makeNoise(o.seed ?? 1);
  const H = (x, z) => {
    const pool = n.fbm(x * 0.012, z * 0.012, 4);
    const hills = 30 * smooth((Math.hypot(x, z) - 700) / 600) * (0.5 + n.fbm(x * 0.002, z * 0.002, 2));
    return (pool < -0.12 ? -0.45 : 0.4) + n.fbm(x * 0.35, z * 0.35, 2) * 0.35 + hills;
  };
  const W = makeWorld({ name: o.name || 'bog', heightFn: H, size: [2400, 2400], seg: [600, 600], palette: PALETTES.bog, detail: 0.5,
    water: { size: [2400, 2400], seg: [60, 60], flow: [1, 0], speed: 0.05, deep: '#1c2022', shallow: '#2a3032', foam: 0, y: -0.1, amp: 0.05 } });
  // firm ground height (never below the tussocks) — use for paths and camps
  W.firm = (x, z) => Math.max(0.2, H(x, z));
  return W;
}

// ── loess plateau ────────────────────────────────────────────────────────────
// main: { halfFloor, wall } carves one straight main gully along X (town, cave dwellings).
// plateauR: keep a flat tableland of that radius around the origin (gatherings).
export function loessHeight(seed, { main = null, plateauR = 0 } = {}) {
  const n = makeNoise(seed);
  return (x, z) => {
    const top = 150 + 20 * n.fbm(x * 0.001, z * 0.001, 2);
    const keep = plateauR ? smooth((Math.hypot(x, z) - plateauR) / 180) : 1;
    const g1 = Math.pow(n.ridged(x * 0.0022, z * 0.0022, 3), 5) * keep;
    const g2 = Math.pow(n.ridged(x * 0.006 + 3, z * 0.006 + 7, 2), 7) * 0.5 * keep;
    let depth = (g1 + g2) * 130;
    if (main) {
      const d = Math.abs(z);
      const m = d < main.halfFloor ? 1 : d < main.halfFloor + 6 ? 1 - 0.18 * smooth((d - main.halfFloor) / 6) : Math.max(0, 0.82 - (d - main.halfFloor - 6) / main.wall);
      depth = Math.max(depth, 140 * m);
    }
    let y = top - depth;
    const step = 5, q = Math.floor(y / step) * step;
    y = lerp(y, q + smooth((y - q) / step) * step, 0.55);          // soft terracing (梯田)
    return y + n.fbm(x * 0.05, z * 0.05, 2) * 1.2;
  };
}
export function loessWorld(o = {}) {
  const H = loessHeight(o.seed ?? 1, o);
  const size = o.size || [1800, 1600];
  const W = makeWorld({ name: o.name || 'loess', heightFn: H, size, seg: [Math.round(size[0] / 4), Math.round(size[1] / 4)], palette: PALETTES.loess, detail: 0.7 });
  addTrees(W, [-size[0] * 0.45, size[0] * 0.45, -size[1] * 0.45, size[1] * 0.45], o.trees ?? { count: 1400, scale: [2.5, 5], color: '#5d6a3a', maxSlope: 0.5, minY: -1e9, clear: o.clear }, (o.seed ?? 1) + 100);
  // floorY: the main gully floor (if any); topY: the tableland height at the origin
  W.loess = { floorY: o.main ? H(0, 0) : null, topY: H(0, 0), halfFloor: o.main?.halfFloor };
  return W;
}
// cave dwellings (窑洞): arched fronts set into the foot of a gully wall. z = wall line, facing -z
export function addCaveDwellings(W, { from = -70, count = 11, gap = 11, z, floorY, lit = (i) => i % 3 === 1, seed = 5 }) {
  const arch = (w, h) => { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, 0); return s; };
  const earth = new THREE.MeshStandardMaterial({ color: '#b39263', roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1d140d', roughness: 1 });
  const glow = new THREE.MeshStandardMaterial({ color: '#2a1a0c', emissive: new THREE.Color('#ffae55'), emissiveIntensity: 1.6 });
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = from + i * gap + r() * 2;
    const face = new THREE.Mesh(new THREE.ShapeGeometry(arch(5.2, 6.2), 16), earth); face.position.set(x, floorY - 0.1, z - 0.3); face.rotation.y = Math.PI; W.scene.add(face);
    const inner = new THREE.Mesh(new THREE.ShapeGeometry(arch(4.0, 5.2), 16), lit(i) ? glow : dark); inner.position.set(x, floorY, z - 0.4); inner.rotation.y = Math.PI; W.scene.add(inner);
  }
}

// ── slot canyon: a stream along X between sheer walls; the gap widens at x≈0 (mouth, bridge)
export function slotWorld(o = {}) {
  const n = makeNoise(o.seed ?? 1);
  const gap = o.gap ?? 5.5, mouth = o.mouth ?? 8, wallH = o.wallHeight ?? 110;
  const wAt = (x) => gap + mouth * (1 - smooth((Math.abs(x) - 14) / 14)) + n.fbm(x * 0.05, 1.3, 2) * 1.2;
  const H = (x, z) => {
    const w = wAt(x), d = Math.abs(z);
    if (d < 3.5) return -2.2 + (d / 3.5) * 1.0;
    if (d < w) return 0.4 + n.fbm(x * 0.2, z * 0.2, 2) * 0.3;
    return 0.4 + (wallH + 60 * n.fbm(x * 0.006, z * 0.006, 3)) * smooth((d - w) / 2.4) + n.ridged(x * 0.03, z * 0.03, 4) * 6 * smooth((d - w) / 1.5) + (d - w) * 0.15;
  };
  const W = makeWorld({ name: o.name || 'slot', heightFn: H, size: [700, 500], seg: [700, 500], palette: PALETTES.canyon,
    water: { size: [700, 30], seg: [240, 12], flow: [1, 0], speed: 4, deep: '#141a1c', shallow: '#2a3234', foam: 0.5, y: -1.2 } });
  W.slot = { halfWidth: wAt, floorY: 0.4, streamHalf: 3.5 };
  return W;
}

// ── flat ground (streets, courtyards) ───────────────────────────────────────
export function flatWorld(o = {}) {
  return makeWorld({ name: o.name || 'flat', heightFn: () => 0, size: o.size || [600, 600], seg: [10, 10], detail: 0.6,
    palette: o.palette || { grass: '#2a2a26', grass2: '#2f2f2a', rock: '#333', rock2: '#3a3a3a', sand: '#2e2c28' } });
}

// ── tabletop: a wooden table in a dark room (documents, maps, lamps) ────────
// Returns { scene, camera, cam(pos, at, fov), table } — no terrain, so no camera guards.
export function tabletop({ bg = '#050404', fog = 0.03, wood = '#3b2716', seed = 4 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.FogExp2(bg, fog);
  const tex = canvasTexture(1024, 512, (g, w, h) => {
    g.fillStyle = wood; g.fillRect(0, 0, w, h);
    const r = rng(seed);
    for (let i = 0; i < 180; i++) {
      const y = r() * h; g.strokeStyle = `rgba(${20 + r() * 30},${10 + r() * 15},5,${0.15 + r() * 0.3})`; g.lineWidth = 1 + r() * 3;
      g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 6 + (r() - 0.5) * 2); g.stroke();
    }
  }, [2, 2]);
  const table = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 2.0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78 }));
  table.position.y = -0.04; table.receiveShadow = true;
  scene.add(table);
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 50);
  return { name: 'tabletop', scene, camera, table,
    cam(pos, at, fov = 32) { camera.fov = viewFov(fov); camera.aspect = VIEW.aspect; camera.updateProjectionMatrix(); camera.position.set(...pos); camera.lookAt(...at); camera.updateMatrixWorld(); },
    // camera from keyframes, like world.track: keys = { pos: [[t,[x,y,z]],…], at: [[t,[x,y,z]],…] }
    track(lt, keys, fov = 32, ease = easeInOut) { this.cam(track(keys.pos, ease)(lt), track(keys.at, ease)(lt), fov); } };
}

// ── open sea ─────────────────────────────────────────────────────────────────
// SEAS: body colours, whitecaps, swell height (amp 1 = moderate sea, 0.2 = sheltered harbour).
export const SEAS = {
  ocean: { deep: '#0a2130', shallow: '#1f5f6b', foam: 0.5, amp: 1, chop: 1 },
  tropic: { deep: '#0b3542', shallow: '#2f9088', foam: 0.3, amp: 0.7, chop: 0.9 },
  harbor: { deep: '#12303a', shallow: '#2c6a6c', foam: 0.04, amp: 0.2, chop: 0.7 },
  heavy: { deep: '#0a1c26', shallow: '#2a5a60', foam: 0.9, amp: 1.9, chop: 1.3 },
  muddy: { deep: '#3d3a26', shallow: '#7a6a42', foam: 0.1, amp: 0.25, chop: 0.8 },
};
const seaOpts = (o) => ({ kind: 'sea', wind: o.wind ?? 0.6, ...SEAS[typeof o.sea === 'string' ? o.sea : 'ocean'], ...(typeof o.sea === 'object' ? o.sea : {}) });
const seaFacts = (W, sea) => { W.sea = { ...sea, height: (x, z, t) => seaHeight(x, z, t, sea) }; return W; };

// wind: the direction the waves run towards, radians from +x towards +z.
// W.sea.height(x, z, t) is the water surface — ships from sea.js ride it.
export function seaWorld(o = {}) {
  const sea = seaOpts(o);
  return seaFacts(makeWorld({ name: o.name || 'sea', water: sea }), sea);
}

// A coast. Land lies towards -z, sea towards +z; the shoreline is z = W.coast.shore(x).
//   bay: { width, depth }   a bay cut into the land around x = 0 (depth 0 = straight coast)
//   beach: [height, run]    how high and how far the beach climbs before the hills start
//   flat: metres of level ground behind the beach (towns, depots, markets)
//   hills: { h, hVar, run, ridge }   the land behind
//   islands: [{ x, z, r, h }]
export function coastWorld(o = {}) {
  const n = makeNoise(o.seed ?? 1), sea = seaOpts({ sea: 'harbor', ...o });
  const bay = { width: 380, depth: 260, ...o.bay }, beach = o.beach || [2.2, 45], flat = o.flat ?? 120;
  const hills = { h: 120, hVar: 80, run: 320, base: 0.45, ridge: 0.75, ...o.hills };
  const shore = (x) => -bay.depth * Math.exp(-((x / bay.width) ** 2)) + 26 * n.fbm(x * 0.004, 7.7, 3) + (o.shoreZ ?? 0);
  const H = (x, z) => {
    const d = shore(x) - z;                                           // metres inland (negative = out at sea)
    let y;
    if (d <= 0) y = -0.4 - 9 * smooth(-d / 140);
    else {
      const e = Math.max(0, d - beach[1] - flat);
      y = beach[0] * smooth(d / beach[1]) + n.fbm(x * 0.02, z * 0.02, 3) * 0.8 * smooth(d / 30)
        + (hills.h + hills.hVar * n.fbm(x * 0.0018, z * 0.0018, 2)) * (1 - Math.exp(-e / hills.run)) * (hills.base + hills.ridge * n.ridged(x * 0.0035, z * 0.0035, 5));
    }
    for (const is of o.islands || []) {
      const k = Math.hypot(x - is.x, z - is.z) / is.r;
      if (k < 1.6) y = Math.max(y, -3 + (is.h + 3) * Math.pow(Math.max(0, 1 - k * k * 0.62), 1.5) * (0.75 + 0.5 * n.fbm(x * 0.01, z * 0.01, 3)));
    }
    return y;
  };
  const size = o.size || [3600, 2800], origin = o.origin || [0, -size[1] / 2 + 700];
  const W = makeWorld({ name: o.name || 'coast', heightFn: H, size, seg: o.seg || [Math.round(size[0] / 6), Math.round(size[1] / 6)], center: origin,
    palette: typeof o.palette === 'object' ? o.palette : PALETTES[o.palette || 'lush'], water: sea, detail: o.detail3d ?? 1 });
  addTrees(W, [origin[0] - size[0] * 0.45, origin[0] + size[0] * 0.45, origin[1] - size[1] * 0.45, origin[1] + size[1] * 0.45], o.trees, (o.seed ?? 1) + 100);
  W.coast = { shore, bay, inland: (x, d) => [x, shore(x) - d] };
  return seaFacts(W, sea);
}
