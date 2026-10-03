// Scene kit: lighting looks, world setup with a SAFE camera, marching columns, pontoon
// bridges, gunfire/tracers/blasts, particle presets, and the standard map shot.
// Everything is a function of time — nothing here reads a clock.
import * as THREE from 'three';
import { createSky, setSky, toScreen, hash1, rng, lerp, clamp, smooth, easeInOut, easeOut, range, makeNoise, track, VIEW, QA, canvasTexture, mixColor } from './engine.js';
import { buildTerrain, createWater, scatterTrees, addRockDetail, createParticles } from './nature.js';
import { createSoldiers, setPose, setGait, createTorchHeads } from './figures.js';
import { createSea } from './sea.js';
import { windowAlpha } from './overlay.js';

// ── lighting looks ──────────────────────────────────────────────────────────
// A look sets sky, sun, fog, hemisphere light and water tint in one call: world.look(LOOKS.x).
// Copy and tweak with { ...LOOKS.night, fog: ['#1d1612', 0.0017] } rather than editing these.
export const LOOKS = {
  morning: { top: '#8c9aa3', horizon: '#d9d6cc', bottom: '#6c6f6c', sunColor: '#fff0d8', glow: 0.35, cloud: 0.7, cloudColor: '#c5c7c4', fog: ['#b3b8b7', 0.0016], sun: 1.4, sunDir: [0.4, 0.35, -0.8], hemi: 1.0, waterLight: 1 },
  day: { top: '#5f7a92', horizon: '#cfd3cf', bottom: '#5a5a52', sunColor: '#fff3de', glow: 0.5, cloud: 0.5, cloudColor: '#e4e2dc', fog: ['#b9c0c2', 0.0009], sun: 2.4, sunDir: [0.5, 0.7, 0.3], hemi: 0.9, waterLight: 1 },
  hot: { top: '#6a8aa6', horizon: '#e4d9c0', bottom: '#8a7a5e', sunColor: '#fff0c8', glow: 0.6, cloud: 0.3, cloudColor: '#eee6d6', fog: ['#d1c7b0', 0.0006], sun: 2.8, sunDir: [0.3, 0.8, 0.4], hemi: 1.0, waterLight: 1 },
  afternoon: { top: '#55636d', horizon: '#c9bfa9', bottom: '#4a463e', sunColor: '#ffd9a0', glow: 0.55, cloud: 0.62, cloudColor: '#a59c90', fog: ['#8b918f', 0.0011], sun: 1.8, sunDir: [-0.5, 0.36, 0.45], hemi: 0.6, waterLight: 1 },
  golden: { top: '#5a6f86', horizon: '#f0c98e', bottom: '#6b5236', sunColor: '#ffc27a', glow: 1.0, cloud: 0.45, cloudColor: '#e8b88a', fog: ['#c9a57a', 0.0010], sun: 2.6, sunDir: [-0.7, 0.22, 0.3], hemi: 0.55, waterLight: 1 },
  dusk: { top: '#2c3446', horizon: '#b98262', bottom: '#2e2a26', sunColor: '#ff9d5c', glow: 0.9, cloud: 0.55, cloudColor: '#7b5e55', fog: ['#5b4d48', 0.0016], sun: 1.1, sunDir: [-0.8, 0.12, 0.2], hemi: 0.35, waterLight: 0.7 },
  overcast: { top: '#6c7278', horizon: '#a9aca8', bottom: '#4c4e4a', sunColor: '#e6e2d8', glow: 0.15, cloud: 0.85, cloudColor: '#8e918f', fog: ['#9a9e9c', 0.0020], sun: 0.9, sunDir: [0.2, 0.8, 0.3], hemi: 1.1, waterLight: 0.9 },
  night: { top: '#05080d', horizon: '#141b22', bottom: '#07090b', sunColor: '#9fb3d6', glow: 0.1, cloud: 0.85, cloudColor: '#10151b', fog: ['#121a22', 0.0019], sun: 0.45, sunDir: [0.2, 0.6, -0.7], hemi: 0.3, waterLight: 0.35 },
  moon: { top: '#0b1424', horizon: '#2c3a52', bottom: '#0a0c10', sunColor: '#b9c9e6', glow: 0.35, cloud: 0.4, cloudColor: '#1c2432', fog: ['#222c3d', 0.0012], sun: 1.3, sunDir: [-0.3, 0.5, -0.8], hemi: 0.6, waterLight: 0.5, stars: 0.8 },
  winterNight: { top: '#0c1119', horizon: '#232b36', bottom: '#0b0d10', sunColor: '#c5d0e0', glow: 0.1, cloud: 0.8, cloudColor: '#1a2029', fog: ['#1c232c', 0.0022], sun: 0.35, sunDir: [0.3, 0.6, 0.6], hemi: 0.3, waterLight: 0.4 },
  // open-sea looks: the fog colour is the horizon colour, so the water melts into the sky
  seaDawn: { top: '#34485f', horizon: '#dba77c', bottom: '#2a3038', sunColor: '#ffbe84', glow: 0.5, cloud: 0.42, cloudColor: '#b98d7e', fog: ['#cf9f7c', 0.00030], sun: 1.9, sunDir: [0.3, 0.085, -1], hemi: 0.55, waterLight: 0.9 },
  seaDay: { top: '#3c6e9f', horizon: '#cadde4', bottom: '#27485a', sunColor: '#fff4dc', glow: 0.5, cloud: 0.42, cloudColor: '#f2f0ea', fog: ['#c6d9e0', 0.00030], sun: 2.7, sunDir: [0.45, 0.7, 0.35], hemi: 0.9, waterLight: 1 },
  tropic: { top: '#2f7fb8', horizon: '#d6ebe6', bottom: '#2a5a5c', sunColor: '#fff6e0', glow: 0.55, cloud: 0.36, cloudColor: '#ffffff', fog: ['#d0e6e2', 0.00032], sun: 3.0, sunDir: [0.35, 0.8, 0.3], hemi: 1.0, waterLight: 1.05 },
  seaGolden: { top: '#55698a', horizon: '#f3c283', bottom: '#4a3a2a', sunColor: '#ffb866', glow: 1.1, cloud: 0.45, cloudColor: '#e3a878', fog: ['#e6b57c', 0.00045], sun: 2.4, sunDir: [-0.55, 0.13, -0.8], hemi: 0.5, waterLight: 1 },
  seaDusk: { top: '#252d44', horizon: '#c07a58', bottom: '#1c1a1e', sunColor: '#ff9458', glow: 0.9, cloud: 0.5, cloudColor: '#6d5258', fog: ['#96614e', 0.00055], sun: 1.0, sunDir: [-0.5, 0.05, -0.85], hemi: 0.32, waterLight: 0.8 },
  seaNight: { top: '#050a16', horizon: '#18233a', bottom: '#04060a', sunColor: '#b4c6ea', glow: 0.25, cloud: 0.25, cloudColor: '#101826', fog: ['#141d30', 0.0006], sun: 0.9, sunDir: [-0.3, 0.55, -0.75], hemi: 0.42, waterLight: 0.55, stars: 1 },
  blizzard: { top: '#9aa3ab', horizon: '#d6dadc', bottom: '#b9bec1', sunColor: '#eef2f5', glow: 0.1, cloud: 0.95, cloudColor: '#c8cdd0', fog: ['#c9ced1', 0.0055], sun: 1.0, sunDir: [0.3, 0.6, 0.5], hemi: 1.3, waterLight: 1 },
};

// vertical field of view actually used: portrait frames widen it so the subject still fits
export function viewFov(fov) {
  return VIEW.portrait ? Math.min(74, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * 1.75))) : fov;
}

// ── world: scene + sky + sun + fog (+ terrain, water) with a camera that cannot go underground
export function makeWorld({ heightFn = null, size = [1800, 2400], seg = [360, 480], center = [0, 0], palette, snowLine, water = null, detail = 1, name = 'world' }) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#9aa0a0', 0.0012);
  const sky = createSky();
  scene.add(sky);
  const terrain = heightFn ? buildTerrain({ size, seg, heightFn, center, palette, snowLine, detail }) : null;
  if (terrain) scene.add(terrain);
  let waterMesh = null;
  if (water) { waterMesh = water.kind === 'sea' ? createSea(water) : createWater(water); scene.add(waterMesh); }
  const waterY = water ? (water.y ?? 0) : -Infinity;
  const sun = new THREE.DirectionalLight('#ffe0b0', 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 1200 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#b8c0c4', '#3a3528', 0.8);
  scene.add(hemi);
  const camera = new THREE.PerspectiveCamera(38, VIEW.aspect, 0.3, 7000);
  // ground level seen by the camera: terrain or water surface, whichever is higher
  const ground = (x, z) => Math.max(heightFn ? heightFn(x, z) : 0, waterY > -1e9 ? waterY + 0.6 : -Infinity);
  const world = { name, scene, sky, terrain, water: waterMesh, sun, hemi, camera, H: heightFn, ground };

  world.look = (L, focus = new THREE.Vector3()) => {
    setSky(sky, { top: L.top, horizon: L.horizon, bottom: L.bottom, sunColor: L.sunColor, glow: L.glow, cloud: L.cloud, cloudColor: L.cloudColor,
      stars: L.stars ?? 0, sunDir: new THREE.Vector3(...L.sunDir) });
    scene.fog.color.set(L.fog[0]); scene.fog.density = L.fog[1];
    sun.intensity = L.sun; sun.color.set(L.sunColor); hemi.intensity = L.hemi;
    const d = new THREE.Vector3(...L.sunDir).normalize();
    sun.position.copy(focus).addScaledVector(d, 500); sun.target.position.copy(focus);
    if (waterMesh) {
      const u = waterMesh.material.uniforms;
      u.uSky.value.set(L.horizon); u.uSkyTop?.value.set(L.top); u.uSunColor.value.set(L.sunColor); u.uSunDir.value.copy(d);
      u.uLight.value = L.waterLight ?? 1; u.fogColor.value.set(L.fog[0]); u.fogDensity.value = L.fog[1];
      u.uEmberCol.value.set(L.ember || '#000000');
    }
    return L;
  };

  // Safe camera. pos/at are [x, y, z] in metres. Two guards, both deterministic:
  //  1. clearance — the camera is lifted to at least `clear` metres above ground/water;
  //  2. line of sight — if terrain blocks the view of the target, the camera rises until it clears.
  // Each correction is reported to QA so the author can fix the shot instead of relying on it.
  world.cam = (pos, at, fov = 38, { clear = 1.5, los = true } = {}) => {
    let [x, y, z] = pos;
    const minY = ground(x, z) + clear;
    if (y < minY) { QA.warn(`${name}: camera at y=${y.toFixed(1)} is under the ground (${(minY - clear).toFixed(1)}) — lifted to ${minY.toFixed(1)}`); y = minY; }
    if (los && heightFn) {
      let raised = 0;
      for (let it = 0; it < 30; it++) {
        let blocked = false;
        for (let i = 1; i <= 24; i++) {
          const k = (i / 24) * 0.85;
          if (ground(lerp(x, at[0], k), lerp(z, at[2], k)) > lerp(y, at[1], k) + 0.6) { blocked = true; break; }
        }
        if (!blocked) break;
        y += 4; raised += 4;
      }
      if (raised) QA.warn(`${name}: terrain blocks the view of the target — camera raised ${raised} m`);
    }
    camera.fov = viewFov(fov); camera.aspect = VIEW.aspect; camera.updateProjectionMatrix();
    camera.position.set(x, y, z); camera.lookAt(at[0], at[1], at[2]); camera.updateMatrixWorld();
    sky.position.copy(camera.position);
    waterMesh?.userData.follow?.(camera);                 // open sea: keep the fine grid and the wakes with the camera
  };
  // camera from keyframes: world.track(lt, { pos: [[t,[x,y,z]],…], at: [[t,[x,y,z]],…] }, fov, ease)
  world.track = (lt, keys, fov = 38, ease = easeInOut, opts) => world.cam(track(keys.pos, ease)(lt), track(keys.at, ease)(lt), fov, opts);
  // a point on the ground: [x, groundY + lift, z]
  world.on = (x, z, lift = 0) => [x, Math.max(heightFn ? heightFn(x, z) : 0, waterY > -1e9 ? waterY : -Infinity) + lift, z];
  world.tick = (t) => {
    sky.material.uniforms.uTime.value = t;
    if (waterMesh) { waterMesh.material.uniforms.uTime.value = t; if (waterMesh.userData.ships) waterMesh.userData.ships.length = 0; }
  };
  return world;
}

export function slopeFn(H) {
  return (x, z) => { const e = 3; return Math.hypot(H(x + e, z) - H(x - e, z), H(x, z + e) - H(x, z - e)) / (2 * e); };
}

export function pinAt(cam, p, text, alpha, kind) {
  const s = toScreen(cam, ...p);
  // a label is only shown while its point is inside the frame — a label pulled back in from
  // off-screen would sit on the wrong place (a town's name on the wrong island)
  const inside = s.visible && s.x > -10 && s.x < VIEW.W + 10 && s.y > -10 && s.y < VIEW.H + 10;
  return { text, x: s.x, y: s.y, alpha: inside ? alpha : 0, kind };
}

// ── paths ───────────────────────────────────────────────────────────────────
// Arc-length parametrised path through [[x,z],…]; y comes from yFn(x,z) (+lift).
export function polyPath(points, yFn, lift = 0.2) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], 0, p[p.length - 1])), false, 'catmullrom', 0.3);
  const f = (s) => { const v = curve.getPointAt(clamp(s, 0, 1)); if (yFn) v.y = yFn(v.x, v.z) + lift; return v; };
  f.meters = curve.getLength();   // total path length (a function's own .length is read-only)
  return f;
}

// ── marching column: soldiers along a path(s∈[0,1]) → Vector3, with a walk cycle ──
export function createColumn(scene, n, { torches = false, scale = 1, figure } = {}) {
  const men = createSoldiers(n, figure);
  scene.add(men);
  const heads = torches ? createTorchHeads(n) : null;
  if (heads) scene.add(heads);
  const m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), v = new THREE.Vector3();
  return {
    men, heads, count: n,
    hide() { for (let i = 0; i < n; i++) { men.setMatrixAt(i, zero); heads?.setMatrixAt(i, zero); } men.instanceMatrix.needsUpdate = true; if (heads) heads.instanceMatrix.needsUpdate = true; },
    // head: path param of the first man · spacing: gap between rows in METRES · speed: walk cadence
    pose(t, path, { head = 0.5, spacing = 3.5, lanes = 1, laneGap = 1.1, pitch = 0.1, bob = 0.05, speed = 6.5, gait = 1, visible = () => true } = {}) {
      const ds = spacing / (path.meters || 1000);
      for (let i = 0; i < n; i++) {
        const lane = i % lanes, row = Math.floor(i / lanes);
        const s = head - row * ds;
        if (s < 0 || s > 1 || !visible(i, s)) { men.setMatrixAt(i, zero); heads?.setMatrixAt(i, zero); continue; }
        const p = path(s), q = path(Math.min(1, s + 0.001));
        const hd = Math.atan2(q.x - p.x, q.z - p.z);
        const off = (lane - (lanes - 1) / 2) * laneGap;
        const x = p.x + Math.cos(hd) * off, z = p.z - Math.sin(hd) * off;
        const ph = t * speed + i * 1.3;
        const b = Math.abs(Math.sin(ph)) * bob;
        setPose(men, i, x, p.y + b, z, hd, pitch, 0, scale);
        setGait(men, i, ph, gait);
        if (heads) {
          const fl = 0.8 + 0.4 * hash1(i * 13 + Math.floor(t * 20));
          m.makeTranslation(x + Math.cos(hd) * 0.3 * scale, p.y + 2.05 * scale + b, z - Math.sin(hd) * 0.3 * scale);
          m.scale(v.set(fl, fl * 1.3, fl));
          heads.setMatrixAt(i, m);
        }
      }
      men.instanceMatrix.needsUpdate = true;
      if (heads) heads.instanceMatrix.needsUpdate = true;
    },
  };
}

// a standing crowd scattered by a placement function (i, rnd) → [x, y, z, heading]
// figure: { uniform, skin, gear, wrap, rifle } — e.g. { uniform: '#5b4a38', rifle: false } for civilians
export function createCrowd(scene, n, place, { seed = 7, pitch = 0.03, figure } = {}) {
  const men = createSoldiers(n, figure);
  const r = rng(seed);
  for (let i = 0; i < n; i++) { const [x, y, z, hd] = place(i, r); setPose(men, i, x, y, z, hd ?? r() * 6.28, pitch, 0, 1); }
  men.instanceMatrix.needsUpdate = true;
  scene.add(men);
  return men;
}

// ── pontoon bridge: boats in a row with planks across (浮桥) ──────────────
export function createPontoon({ from, to, boats = 14 }) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: '#3f2f22', roughness: 0.9 });
  const plankMat = new THREE.MeshStandardMaterial({ color: '#6a5238', roughness: 0.95 });
  const dx = to[0] - from[0], dz = to[1] - from[1], L = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
  for (let i = 0; i < boats; i++) {
    const k = (i + 0.5) / boats;
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 6.5), hullMat);
    b.position.set(from[0] + dx * k, 0.15, from[1] + dz * k);
    b.rotation.y = ang + Math.PI / 2;
    b.castShadow = true;
    g.add(b);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, L), plankMat);
  deck.position.set(from[0] + dx / 2, 0.72, from[1] + dz / 2);
  deck.rotation.y = ang;
  deck.castShadow = deck.receiveShadow = true;
  g.add(deck);
  // is (x,z) on the deck?  deckY = walking height
  g.userData.deckY = 0.78;
  g.userData.on = (x, z) => {
    const k = ((x - from[0]) * dx + (z - from[1]) * dz) / (L * L);
    return k > 0 && k < 1 && Math.abs((x - from[0]) * dz - (z - from[1]) * dx) / L < 3;
  };
  return g;
}

// ── muzzle flashes + tracers (time-sliced, deterministic) ─────────────────
export function createGunfire(scene, maxSpots = 24, maxTracers = 40) {
  const flashes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd98a').multiplyScalar(2.5) }), maxSpots);
  flashes.frustumCulled = false;
  const light = new THREE.PointLight('#ffd27a', 0, 90, 1.8);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxTracers * 6), 3));
  const tracers = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color('#ffcf7a').multiplyScalar(5), transparent: true, opacity: 0.9 }));
  tracers.frustumCulled = false;
  scene.add(flashes, light, tracers);
  const m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    off() { for (let i = 0; i < maxSpots; i++) flashes.setMatrixAt(i, zero); flashes.instanceMatrix.needsUpdate = true; light.intensity = 0; tracers.visible = false; },
    // spots: Vector3[] the fire comes from · target(a,b,c∈[0,1)) → Vector3 it lands on · rate: 0.6 heavy … 0.9 sparse
    fire(t, spots, target, { rate = 0.72, tracer = true } = {}) {
      let lit = 0; const lp = new THREE.Vector3();
      for (let i = 0; i < maxSpots; i++) {
        if (i >= spots.length) { flashes.setMatrixAt(i, zero); continue; }
        const on = hash1(i * 971 + Math.floor(t * 15 + i * 0.37) * 13) > rate;
        m.makeScale(on ? 1 : 0, on ? 1 : 0, on ? 1 : 0).setPosition(spots[i]);
        flashes.setMatrixAt(i, m);
        if (on) { lit++; lp.add(spots[i]); }
      }
      flashes.instanceMatrix.needsUpdate = true;
      light.intensity = lit ? 25 * Math.min(lit, 4) : 0;
      if (lit) light.position.copy(lp.multiplyScalar(1 / lit));
      tracers.visible = tracer;
      if (!tracer) return;
      const a = geo.attributes.position.array;
      for (let k = 0; k < maxTracers; k++) {
        const per = 0.55, ph = hash1(k * 131) * per;
        const cyc = Math.floor((t + ph) / per), p = ((t + ph) % per) / 0.2, i6 = k * 6;
        if (p > 1 || hash1(k * 7 + cyc * 31) < 0.45) { a.fill(0, i6, i6 + 6); continue; }
        const from = spots[(k + cyc) % spots.length];
        const tg = target(hash1(k * 17 + cyc * 3), hash1(k * 29 + cyc * 5), hash1(k * 41 + cyc * 11));
        const dir = tg.clone().sub(from); const L = dir.length(); dir.normalize();
        const head = from.clone().addScaledVector(dir, L * p), tail = head.clone().addScaledVector(dir, -Math.min(7, L * p));
        a[i6] = tail.x; a[i6 + 1] = tail.y; a[i6 + 2] = tail.z; a[i6 + 3] = head.x; a[i6 + 4] = head.y; a[i6 + 5] = head.z;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ── explosions: a soft glow that expands and dies, a light, and (over water) a spray burst
const GLOW_VS = `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`;
const GLOW_FS = `uniform vec3 uColor; uniform float opacity; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(max(dot(vN, vV), 0.0), 2.5); gl_FragColor = vec4(uColor * f, f * opacity); }`;
export function glowMaterial(color, strength = 3) {
  return new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(strength) }, opacity: { value: 1 } }, vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}
export function createBlasts(scene, n = 6) {
  const balls = [...Array(n)].map(() => { const b = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), glowMaterial('#ffb060', 3)); b.visible = false; scene.add(b); return b; });
  const bursts = [...Array(n)].map((_, i) => { const p = createParticles({ kind: 'burst', count: 260, origins: [[0, 0, 0]], originJitter: [3, 0.3, 3], size: 1.6, life: 1.8, spread: 8, colA: '#d9dcd8', additive: false, opacity: 0.85, seed: 40 + i }); p.visible = false; scene.add(p); return p; });
  const light = new THREE.PointLight('#ff9a50', 0, 200, 1.6);
  scene.add(light);
  return {
    // events: [{ t0, pos: Vector3, size, water: true|false }] — at most n
    update(t, events) {
      let li = 0, lp = null;
      balls.forEach((b, i) => {
        const e = events[i], bu = bursts[i];
        if (e && e.water !== false && t >= e.t0 && t < e.t0 + 2.4) { bu.visible = true; bu.position.set(e.pos.x, 0.2, e.pos.z); bu.material.uniforms.uTime.value = t - e.t0; } else bu.visible = false;
        if (!e || t < e.t0 || t > e.t0 + 0.6) { b.visible = false; return; }
        const k = (t - e.t0) / 0.6;
        b.visible = true; b.position.copy(e.pos); b.scale.setScalar(e.size * (0.4 + k * 0.9));
        b.material.uniforms.opacity.value = (1 - k) * (1 - k);
        const I = (1 - k) * (1 - k) * 4000 * (e.size / 6);
        if (I > li) { li = I; lp = e.pos; }
      });
      light.intensity = li;
      if (lp) light.position.copy(lp).add(new THREE.Vector3(0, 4, 0));
    },
  };
}

// ── particle presets (values that worked on screen; override any field) ───────
export const fx = {
  fire: (origins, o = {}) => createParticles({ kind: 'fire', count: 520, origins, originJitter: [8, 1.5, 6], size: 4.6, life: 1.25, rise: 9, spread: 2.2, wind: 1.2, colA: '#ffc766', colB: '#d2401e', seed: 2, ...o }),
  smoke: (origins, o = {}) => createParticles({ kind: 'smoke', count: 280, origins, originJitter: [10, 3, 8], size: 12, life: 7, rise: 60, spread: 5, wind: 0.8, colA: '#2e2a27', colB: '#6f6a64', opacity: 0.5, additive: false, seed: 3, ...o }),
  embers: (origins, o = {}) => createParticles({ kind: 'ember', count: 160, origins, originJitter: [12, 3, 8], size: 0.35, life: 3.5, rise: 24, spread: 1.5, wind: 1.5, colA: '#ffae50', opacity: 0.6, seed: 4, ...o }),
  // low mist over water/ground. spread = [x, y, z] extent of the bank of mist
  mist: (center, spread = [240, 3, 220], o = {}) => createParticles({ kind: 'smoke', count: 150, origins: [center], originJitter: spread, size: 40, life: 16, rise: 5, spread: 10, wind: 0.3, colA: '#c9cdcd', colB: '#dfe2e0', opacity: 0.2, additive: false, seed: 8, ...o }),
  dust: (center, spread = [300, 30, 200], o = {}) => createParticles({ kind: 'smoke', count: 70, origins: [center], originJitter: spread, size: 50, life: 20, rise: 8, spread: 10, wind: 0.6, colA: '#d8c8a4', colB: '#e2d6b8', opacity: 0.07, additive: false, seed: 11, ...o }),
  // rain/snow fall inside a box that you keep in front of the camera each frame: p.position.copy(cam.position)…
  rain: (o = {}) => createParticles({ kind: 'rain', count: 7000, origins: [[0, 0, 0]], size: 0.4, box: [200, 90, 200], wind: 0.3, colA: '#aebdcc', opacity: 0.6, streak: 1, additive: false, seed: 7, ...o }),
  snow: (o = {}) => createParticles({ kind: 'snow', count: 9000, origins: [[0, 0, 0]], size: 0.55, box: [160, 70, 160], spread: 0.6, wind: 1.6, colA: '#f2f5f7', opacity: 0.85, streak: 0.4, additive: false, seed: 5, ...o }),
  splashes: (origins, o = {}) => createParticles({ kind: 'spray', count: 300, origins, size: 0.6, life: 0.8, spread: 3.2, colA: '#e4e6e2', additive: false, opacity: 0.8, seed: 6, ...o }),
};

// ── the standard map shot (driven by the JSON in film.json) ───────────────────
// cfg: { from, to, fit:[points], dist:n|[a,b], pitch:n|[a,b], yaw:n|[a,b], margin,
//        draw:{ route, from, to, t:[t0,t1] }, extra:[{ route, from, to, t:[t0,t1] }],
//        dots:[places], pins:[{ place|ll, text, a, b, kind, dx, dz }], decor:[…], post:{…} }
export function mapShot(map, t, dur, cfg, out) {
  const k = easeInOut(clamp(t / Math.max(0.001, dur)));
  const pair = (v, d) => (Array.isArray(v) ? v : v != null ? [v, v] : d);
  const pitch = pair(cfg.pitch, [60, 60]), yaw = pair(cfg.yaw, [0, 0]);
  let a, b, dist;
  if (cfg.fit && !Array.isArray(cfg.fit)) {      // fit: { from: [points…], to: [points…] } — glide from one framing to another
    const fa = map.fit(cfg.fit.from, pitch[0], cfg.margin ?? 1.1, yaw[0]), fb = map.fit(cfg.fit.to ?? cfg.fit.from, pitch[1], cfg.margin ?? 1.1, yaw[1]);
    a = map.xz(fa.at); b = map.xz(fb.at); dist = pair(cfg.dist, [fa.dist, fb.dist]);
  } else if (cfg.fit) { const f = map.fit(cfg.fit, pitch[0], cfg.margin ?? 1.1, yaw[0]); a = b = map.xz(f.at); dist = pair(cfg.dist, [f.dist, f.dist]); }
  else { a = map.xz(cfg.from); b = map.xz(cfg.to ?? cfg.from); dist = pair(cfg.dist, [420, 420]); }
  if (VIEW.portrait && !cfg.fit) dist = dist.map((d) => d * 1.35);
  map.reset();
  map.setCamera({ at: { xz: [lerp(a[0], b[0], k), lerp(a[1], b[1], k)] }, dist: lerp(dist[0], dist[1], k), pitch: lerp(pitch[0], pitch[1], k), yaw: lerp(yaw[0], yaw[1], k) });
  const drawOne = (d, route) => {
    const [t0, t1] = d.t || [0, dur];
    const alpha = d.fadeOut ? 1 - smooth(range(t, d.fadeOut[0], d.fadeOut[1])) : 1;
    map.setDraw(lerp(map.dist(d.from ?? 'start', route), map.dist(d.to ?? 'total', route), smooth(range(t, t0, t1))), route, alpha);
  };
  if (cfg.draw) drawOne(cfg.draw, cfg.draw.route || 'main'); else map.setDraw(0);
  for (const e of cfg.extra || []) drawOne(e, e.route);
  map.showDots(cfg.dots || []);
  map.decor(t, cfg.decor || []);
  out.scene = map.scene; out.camera = map.camera;
  for (const p of cfg.pins || []) {
    const [x, z] = map.xz(p.place ?? p.ll);
    const pos = [x + (p.dx || 0), map.yAt(x, z) + 2, z + (p.dz || 0)];
    out.pins.push(pinAt(map.camera, pos, p.text ?? p.place, windowAlpha(t, p.a ?? 0.1, p.b ?? dur, 0.3, 0.25), p.kind ?? 'gold'));
  }
  out.post = { exposure: 1.0, bloom: 0.7, bloomThreshold: 0.7, sat: 0.9, ...(cfg.post || {}) };
  return out;
}

export const fmt = (n) => Math.round(n).toLocaleString('en-US');
export { THREE, hash1, rng, lerp, clamp, smooth, easeInOut, easeOut, range, track, makeNoise, windowAlpha, scatterTrees, addRockDetail, createParticles, setPose, setGait, buildTerrain, createWater, VIEW, canvasTexture, mixColor, setSky };
