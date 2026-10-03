// Props: set pieces a scene can drop into a world. Architecture and objects only —
// nothing here depicts an identifiable person.
import * as THREE from 'three';
import { rng, hash1, canvasTexture } from './engine.js';
import { roofGeometry, createBuilding, createSoldiers, setPose } from './figures.js';
import { addRockDetail, createParticles } from './nature.js';

// ── torch reflections on water: additive streaks laid on the surface, pointing at the camera
export function createTorchReflections(scene, n, { waterY = 0.55, length = 30, opacity = 0.55 } = {}) {
  const tex = canvasTexture(64, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,170,80,0.9)'); gr.addColorStop(0.4, 'rgba(255,140,60,0.35)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const hg = g.createLinearGradient(0, 0, w, 0); hg.addColorStop(0, 'rgba(0,0,0,1)'); hg.addColorStop(0.5, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = hg; g.fillRect(0, 0, w, h);
  });
  const geo = new THREE.PlaneGeometry(0.9, length); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, length / 2);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }), n);
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  scene.add(mesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0), up = new THREE.Vector3(0, 1, 0);
  // points: (i) → Vector3 | null (null = no torch over water there). Call AFTER the camera is set.
  mesh.userData.pose = (t, camera, points) => {
    for (let i = 0; i < n; i++) {
      const pt = points(i);
      if (!pt) { mesh.setMatrixAt(i, zero); continue; }
      q.setFromAxisAngle(up, Math.atan2(camera.position.x - pt.x, camera.position.z - pt.z));
      const fl = 0.7 + 0.5 * hash1(i * 7 + Math.floor(t * 12));
      p.set(pt.x, waterY, pt.z); s.set(fl, 1, 0.8 + fl * 0.4);
      m.compose(p, q, s); mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}

// ── two-storey hall with arcaded verandas (grey brick, hip roof); centre upstairs windows lit
export function createArcadeHall({ w = 26, d = 12, floorH = 4.4, arches = 7, lit = (floor, i) => floor === 1 && i >= 2 && i <= 4, seed = 12 } = {}) {
  const brick = canvasTexture(512, 512, (g, W, H) => {
    g.fillStyle = '#5d6166'; g.fillRect(0, 0, W, H);
    const r = rng(seed);
    for (let y = 0; y < H; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < W; x += 32) { const c = 80 + r() * 25; g.fillStyle = `rgb(${c},${c + 3},${c + 8})`; g.fillRect(x + 1, y + 1, 30, 14); }
  }, [6, 3]);
  const wallMat = new THREE.MeshStandardMaterial({ map: brick, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: '#5a2c22', roughness: 0.8 });
  const glow = new THREE.MeshStandardMaterial({ color: '#2a1a0c', emissive: new THREE.Color('#ffb257'), emissiveIntensity: 2.2 });
  const dark = new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.3, metalness: 0.2 });
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.BoxGeometry(w - 2, floorH * 2, d - 3.2), wallMat);
  core.position.set(0, floorH, -1.6); core.castShadow = core.receiveShadow = true; g.add(core);
  const span = w / arches;
  for (const y of [0, floorH]) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2, floorH); shape.lineTo(-w / 2, floorH); shape.lineTo(-w / 2, 0);
    for (let i = 0; i < arches; i++) {
      const cx = -w / 2 + span * (i + 0.5), hw = span * 0.36, top = floorH * 0.62;
      const hole = new THREE.Path();
      hole.moveTo(cx - hw, 0.35); hole.lineTo(cx + hw, 0.35); hole.lineTo(cx + hw, top); hole.absarc(cx, top, hw, 0, Math.PI, false); hole.lineTo(cx - hw, 0.35);
      shape.holes.push(hole);
    }
    const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false, curveSegments: 12 }), wallMat);
    panel.position.set(0, y, d / 2 - 0.6); panel.castShadow = panel.receiveShadow = true; g.add(panel);
  }
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), trim); slab.position.set(0, floorH, 0); g.add(slab);
  for (let f = 0; f < 2; f++) for (let i = 0; i < arches; i++) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.3), lit(f, i) ? glow : dark);
    win.position.set(-w / 2 + span * (i + 0.5), f * floorH + 1.9, d / 2 - 3.25); g.add(win);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.5, 0.08), trim); fr.position.copy(win.position).add(new THREE.Vector3(0, 0, -0.05)); g.add(fr);
  }
  const roof = new THREE.Mesh(roofGeometry(w, d, 3.6, 1.4, 0.35), new THREE.MeshStandardMaterial({ color: '#1f2224', roughness: 0.7, side: THREE.DoubleSide }));
  roof.position.y = floorH * 2 + 0.1; roof.castShadow = true; g.add(roof);
  const light = new THREE.PointLight('#ffb257', 60, 30, 1.6); light.position.set(0, floorH + 2.2, d / 2 - 4.2); g.add(light);
  // flicker(k): k≈1 — call each frame for a living window glow
  g.userData.flicker = (k) => { light.intensity = 60 * k; glow.emissiveIntensity = 2.2 * k; };
  g.userData.wallMat = wallMat;
  return g;
}

// a street of plain houses either side of a point (rows along z)
export function addHouses(scene, n, place, { seed = 51, wall = '#3b3a38', roof = '#1f2224' } = {}) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const b = createBuilding({ w: 7 + r() * 5, d: 6 + r() * 3, wallH: 3.5 + r() * 2.5, roofH: 2 + r(), wall, roof, stories: r() < 0.3 ? 2 : 1 });
    const [x, y, z, rot] = place(i, r);
    b.position.set(x, y, z); b.rotation.y = rot ?? r() * 0.2;
    scene.add(b);
  }
}

// ── round stone blockhouse with firing slits; returns the group and the slit positions (world)
export function createBunker({ at = [0, 0, 0], scale = 1 } = {}) {
  const stone = new THREE.MeshStandardMaterial({ color: '#5a5750', roughness: 1 }); addRockDetail(stone, 0.8);
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 7, 16), stone); tower.position.y = 3.5; tower.castShadow = true; g.add(tower);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.3, 0.6, 16), stone); cap.position.y = 7.2; g.add(cap);
  const slit = new THREE.MeshBasicMaterial({ color: '#050505' });
  const slits = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.047;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.3), slit); s.position.set(Math.cos(a) * 3.3, 4.6, Math.sin(a) * 3.3); s.lookAt(0, 4.6, 0); g.add(s);
    slits.push(new THREE.Vector3(at[0] + Math.cos(a) * 3.5 * scale, at[1] + 4.6 * scale, at[2] + Math.sin(a) * 3.5 * scale));
  }
  g.scale.setScalar(scale); g.position.set(...at);
  g.userData.slits = slits;
  return g;
}

// ── oil lamp: brass base, glass chimney, flame; returns group with userData.update(t) for the flicker
export function createOilLamp({ at = [0, 0, 0], intensity = 2.6 } = {}) {
  const g = new THREE.Group();
  const V = (pts) => pts.map(([x, y]) => new THREE.Vector2(x, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(V([[0, 0], [0.13, 0], [0.14, 0.02], [0.09, 0.07], [0.12, 0.13], [0.08, 0.17], [0.03, 0.2]]), 24), new THREE.MeshStandardMaterial({ color: '#8a6a3a', metalness: 0.8, roughness: 0.35 })));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(V([[0.045, 0.2], [0.075, 0.26], [0.08, 0.32], [0.05, 0.42], [0.045, 0.5]]), 24),
    new THREE.MeshPhysicalMaterial({ color: '#fff4e0', transparent: true, opacity: 0.18, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false })));
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd28a').multiplyScalar(2.2) }));
  core.scale.set(1, 2.4, 1); core.position.y = 0.27; g.add(core);
  g.traverse((o) => (o.castShadow = true));
  const flame = createParticles({ kind: 'fire', count: 60, origins: [[0, 0.25, 0]], originJitter: [0.01, 0.005, 0.01], size: 0.02, life: 0.5, rise: 0.07, spread: 0.008, colA: '#ffd98a', colB: '#ff7a2a', opacity: 0.6, seed: 3 });
  g.add(flame);
  const light = new THREE.PointLight('#ffb866', intensity, 8, 1.6);
  light.position.y = 0.3; light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -0.002; g.add(light);
  g.position.set(...at);
  g.userData.update = (t) => {
    flame.userData.update(t);
    const fl = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3) + 0.08 * (hash1(Math.floor(t * 24)) - 0.5);
    light.intensity = intensity * fl; core.scale.set(1, 2.4 * (0.9 + 0.2 * fl), 1);
  };
  return g;
}

// ── a sheet of paper lying on a table, textured from a canvas you draw on.
// draw(g, w, h, lt) is called by sheet.userData.redraw(lt) — animate the drawing from time.
export function createPaper({ w = 2.4, px = [2048, 1400], draw, curl = 1, rotZ = 0.06, y = 0.012 } = {}) {
  const cvs = document.createElement('canvas'); cvs.width = px[0]; cvs.height = px[1];
  const g2 = cvs.getContext('2d');
  const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * px[1] / px[0], 24, 16), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide }));
  const p = mesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, (Math.sin(p.getX(i) * 2.2) * 0.012 + Math.cos(p.getY(i) * 3.1) * 0.008) * curl);
  mesh.geometry.computeVertexNormals();
  mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = rotZ; mesh.position.y = y; mesh.receiveShadow = true;
  mesh.userData.redraw = (lt = 0) => { draw(g2, px[0], px[1], lt); tex.needsUpdate = true; };
  mesh.userData.redraw(0);
  return mesh;
}

// aged-paper background for createPaper's draw()
export function paperGround(g, w, h, { tone = '#d8c9a4', seed = 9 } = {}) {
  const r = rng(seed);
  g.fillStyle = tone; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(90,70,40,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 2 + r() * 8, 2 + r() * 8); }
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(70,45,20,0.45)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
}

// a newspaper page with NO readable text: a masthead of blank blocks and columns of marks.
// (Real mastheads and headlines are someone's property and can carry wrong claims.)
export function drawNewspaper(g, w, h, seed = 8) {
  const r = rng(seed);
  g.fillStyle = '#d9cfb4'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2b261d'; g.fillRect(60, 50, w - 120, 110);
  g.fillStyle = '#d9cfb4'; for (let i = 0; i < 9; i++) g.fillRect(90 + i * ((w - 180) / 9), 70, (w - 180) / 9 - 45, 70);
  g.fillStyle = 'rgba(40,34,26,0.8)'; g.fillRect(60, 180, w - 120, 4);
  const cw = (w - 120) / 6;
  for (let c = 0; c < 6; c++) for (let l = 0; l < Math.floor((h - 240) / 22); l++) {
    const x0 = 60 + c * cw + 8, y0 = 210 + l * 22, len = (cw - 24) * (0.6 + r() * 0.4);
    g.fillStyle = `rgba(45,38,28,${0.35 + r() * 0.3})`;
    for (let x = 0; x < len; x += 9 + r() * 5) g.fillRect(x0 + x, y0, 6 + r() * 5, 9);
  }
  g.fillStyle = 'rgba(45,38,28,0.9)'; g.fillRect(60 + 2 * cw, 205, cw * 2, 40);
}

// ── campfire with a pot on three stones and figures seated round it
export function createCampfire(scene, { at, sitters = 7, groundY }) {
  const [cx, cz] = at, cy = groundY;
  const g = new THREE.Group(); g.position.set(cx, cy, cz);
  const stone = new THREE.MeshStandardMaterial({ color: '#3d3a35', roughness: 1 });
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), stone); s.position.set(Math.cos(i * 2.09) * 0.32, 0.12, Math.sin(i * 2.09) * 0.32); g.add(s); }
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.36, 18, 1, true), new THREE.MeshStandardMaterial({ color: '#1e1c1a', metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }));
  pot.position.y = 0.52; g.add(pot);
  const broth = new THREE.Mesh(new THREE.CircleGeometry(0.32, 18), new THREE.MeshStandardMaterial({ color: '#3a3020', roughness: 0.3 }));
  broth.rotation.x = -Math.PI / 2; broth.position.y = 0.62; g.add(broth);
  scene.add(g);
  const fire = createParticles({ kind: 'fire', count: 220, origins: [[cx, cy + 0.12, cz]], originJitter: [0.4, 0.05, 0.4], size: 0.9, life: 0.8, rise: 0.9, spread: 0.3, colA: '#ffc766', colB: '#d2401e', seed: 6 });
  const steam = createParticles({ kind: 'smoke', count: 70, origins: [[cx, cy + 0.7, cz]], originJitter: [0.3, 0.05, 0.3], size: 0.9, life: 3, rise: 2.0, spread: 0.3, wind: 0.3, colA: '#8a8884', colB: '#a8a6a2', opacity: 0.18, additive: false, seed: 7 });
  const light = new THREE.PointLight('#ff9a45', 0, 16, 1.6); light.position.set(cx, cy + 0.8, cz);
  scene.add(fire, steam, light);
  const men = createSoldiers(sitters); scene.add(men);
  for (let i = 0; i < sitters; i++) { const a = i * 0.72 + 1.9, r = 1.5 + (i % 2) * 0.25; const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; setPose(men, i, x, cy - 0.62, z, Math.atan2(cx - x, cz - z), 0.22, 0, 1); }
  men.instanceMatrix.needsUpdate = true;
  return {
    center: [cx, cy, cz],
    show(on, t = 0) {
      g.visible = fire.visible = steam.visible = men.visible = on;
      light.intensity = on ? 9 * (0.85 + 0.25 * hash1(Math.floor(t * 14))) : 0;
      if (on) { fire.userData.update(t); steam.userData.update(t); }
    },
  };
}

// plank bridge on posts (short spans over streams/gullies)
export function createWoodBridge({ length = 11, width = 2.4, y = 2.2, postsAt = [-3.4, 3.4] } = {}) {
  const wood = new THREE.MeshStandardMaterial({ color: '#4a3826', roughness: 0.95 });
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, length), wood); deck.position.y = y; deck.castShadow = true; g.add(deck);
  for (const s of [-1, 1]) for (const z of postsAt) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, y + 2.3, 0.2), wood); post.position.set(s * (width / 2 - 0.1), (y + 2.3) / 2 - 1.6, z); g.add(post); }
  g.userData.deckY = y + 0.15;
  return g;
}

// ════════════════════════════════════════════════════════════════════════════
// Voyage props: harbours, trade towns, monuments, animals, navigation instruments
// ════════════════════════════════════════════════════════════════════════════
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o });
const shadowed = (m) => { m.castShadow = m.receiveShadow = true; return m; };

// ── wooden pier on posts, from the shore out over the water ─────────────────
// from/to: [x, z] · y: deck height above the water
export function createPier({ from, to, width = 5, y = 1.6, color = '#5a4632' } = {}) {
  const g = new THREE.Group(), len = Math.hypot(to[0] - from[0], to[1] - from[1]), ang = Math.atan2(to[0] - from[0], to[1] - from[1]);
  const deck = shadowed(new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, len), std(color)));
  deck.position.set(0, y, len / 2); g.add(deck);
  const n = Math.max(2, Math.round(len / 7)), posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.26, y + 5, 6), std('#3a2c20'), n * 2), m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) { m.makeTranslation(s * (width / 2 - 0.3), (y - 5) / 2 + 0.3, (i + 0.5) * len / n); posts.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m); }
  g.add(shadowed(posts));
  g.position.set(from[0], 0, from[1]); g.rotation.y = ang;
  g.userData = { deckY: y + 0.15, length: len };
  return g;
}

// ── stockaded depot: a palisade with gate towers, long storehouses inside (官厂) ──
// at: [x, z] centre · groundY: number or (x, z) => y
export function createDepot({ at = [0, 0], w = 150, d = 100, groundY = 0, houses = 6, seed = 21, rot = 0 } = {}) {
  const g = new THREE.Group(), r = rng(seed), gy = typeof groundY === 'function' ? groundY : () => groundY;
  const base = gy(at[0], at[1]);
  // palisade: sharpened logs, with a gap at each gate
  const perim = [], step = 1.1, gate = 9;
  for (let x = -w / 2; x <= w / 2; x += step) for (const z of [-d / 2, d / 2]) if (Math.abs(x) > gate / 2) perim.push([x, z]);
  for (let z = -d / 2; z <= d / 2; z += step) for (const x of [-w / 2, w / 2]) if (Math.abs(z) > gate / 2) perim.push([x, z]);
  const log = new THREE.CylinderGeometry(0.02, 0.42, 5.4, 5); log.translate(0, 2.7, 0);
  const logs = new THREE.InstancedMesh(log, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true }), perim.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  perim.forEach(([x, z], i) => { m.makeScale(1, 0.9 + r() * 0.2, 1); m.setPosition(x, 0, z); logs.setMatrixAt(i, m); logs.setColorAt(i, c.set('#5c4630').multiplyScalar(0.8 + r() * 0.4)); });
  g.add(shadowed(logs));
  // four gates, each with a drum tower over it
  for (const [x, z, ry] of [[0, -d / 2, 0], [0, d / 2, 0], [-w / 2, 0, Math.PI / 2], [w / 2, 0, Math.PI / 2]]) {
    const t = createBuilding({ w: 11, d: 6, wallH: 3.2, roofH: 2.6, wall: '#6a3b2a', roof: '#2a2623', base: { w: 12, h: 5.4, d: 6.5, color: '#4e3d2c' } });
    t.position.set(x, 0, z); t.rotation.y = ry; g.add(t);
  }
  // storehouses in two rows
  const cols = Math.ceil(houses / 2);
  for (let i = 0; i < houses; i++) {
    const b = createBuilding({ w: w / cols * 0.7, d: d * 0.2, wallH: 4.2, roofH: 3, wall: '#7a6a52', roof: '#33302c' });
    b.position.set((Math.floor(i / 2) - (cols - 1) / 2) * (w / cols) * 0.92, 0, (i % 2 ? 1 : -1) * d * 0.22); g.add(b);
  }
  const flag = createFlagPole(13, '#b3261e');
  flag.position.set(0, 0, 0); g.add(flag);
  g.position.set(at[0], base, at[1]); g.rotation.y = rot;
  g.userData = { w, d, flag };
  return g;
}

// a tall pole with a long banner; userData.update(t) makes it fly
export function createFlagPole(h = 12, color = '#b3261e', bw = 4.2, bh = 2.4) {
  const g = new THREE.Group();
  g.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, h, 6).translate(0, h / 2, 0), std('#3a2e22'))));
  const geo = new THREE.PlaneGeometry(bw, bh, 14, 6); geo.translate(bw / 2, h - bh / 2 - 0.2, 0);
  const base = geo.attributes.position.array.slice();
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8, emissive: new THREE.Color(color).multiplyScalar(0.18) }));
  flag.castShadow = true; g.add(flag);
  // wind 0 = hanging limp, 1 = streaming
  g.userData.update = (t, wind = 1) => {
    const a = geo.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], k = x / bw;
      a.setZ(i, (Math.sin(x * 1.6 - t * 6.0) * 0.5 * k + Math.sin(y * 1.2 - t * 3.7) * 0.12 * k) * wind);
      a.setX(i, x * (0.25 + 0.75 * wind) + 0.0);
      a.setY(i, y - k * k * bw * 0.55 * (1 - wind));
    }
    a.needsUpdate = true; geo.computeVertexNormals();
  };
  g.userData.update(0, 1);
  return g;
}

// ── flat-roofed mud-brick town (Gulf / Red Sea ports), a few domes and towers ──
// place(i, rnd) → [x, y, z]
export function addFlatHouses(scene, n, place, { seed = 61, wall = '#b79a72', domes = 0.12, towers = 0.06, size = 1 } = {}) {
  const r = rng(seed), g = new THREE.Group(), c = new THREE.Color();
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const houses = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = place(i, r), w = (6 + r() * 7) * size, d = (6 + r() * 6) * size, tower = r() < towers, h = (tower ? 12 + r() * 8 : 3.5 + r() * 4.5) * size;
    q.setFromAxisAngle(up, (r() - 0.5) * 0.5); s.set(tower ? 3.5 * size : w, h, tower ? 3.5 * size : d); p.set(x, y - 0.4, z);
    m.compose(p, q, s); houses.setMatrixAt(i, m);
    houses.setColorAt(i, c.set(wall).multiplyScalar(0.82 + r() * 0.36));
    if (!tower && r() < domes) { const dome = shadowed(new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.36, 14, 8, 0, 6.3, 0, 1.6), std(mix(wall, '#ffffff', 0.25)))); dome.position.set(x, y + h - 0.5, z); g.add(dome); }
  }
  g.add(shadowed(houses));
  scene.add(g);
  return g;
}
const mix = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

// ── market: awnings on poles with goods under them. place(i, rnd) → [x, y, z, rot]
export function createStalls(scene, n, place, { seed = 33, cloth = ['#b5462e', '#c9a23f', '#3f6f7a', '#d8c9a4', '#7a3f6a'] } = {}) {
  const r = rng(seed), g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const [x, y, z, rot] = place(i, r), st = new THREE.Group(), w = 3.4 + r() * 1.6, d = 2.6 + r();
    const aw = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), std(cloth[Math.floor(r() * cloth.length)], { side: THREE.DoubleSide })));
    aw.position.y = 2.6; aw.rotation.x = 0.16; st.add(aw);
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 5), std('#4a3a2a')); pole.position.set(px * (w / 2 - 0.15), 1.35, pz * (d / 2 - 0.15)); st.add(pole); }
    for (let j = 0; j < 5; j++) {                                        // jars, bales, chests
      const kind = r(), col = ['#c8b48a', '#5a6f7a', '#7a4a2a', '#d9d2c0', '#3a3a34'][Math.floor(r() * 5)];
      const item = shadowed(kind < 0.45 ? new THREE.Mesh(new THREE.SphereGeometry(0.3 + r() * 0.15, 8, 6), std(col)) : new THREE.Mesh(new THREE.BoxGeometry(0.6 + r() * 0.5, 0.4 + r() * 0.4, 0.5 + r() * 0.4), std(col)));
      item.position.set((r() - 0.5) * (w - 0.8), 0.3, (r() - 0.5) * (d - 0.8)); st.add(item);
    }
    st.position.set(x, y, z); st.rotation.y = rot ?? r() * 6.28; g.add(st);
  }
  scene.add(g);
  return g;
}

// ── inscribed stone stele on a plinth. The inscription is three blocks of marks in three
// different hands (columns / rounded rows / flowing rows) — texture only, no readable text.
export function createStele({ h = 1.45, w = 0.77, thick = 0.13, seed = 14, stone = '#8d8a80' } = {}) {
  const g = new THREE.Group();
  const face = canvasTexture(512, 960, (c, W, H) => {
    const r = rng(seed);
    c.fillStyle = stone; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) { c.fillStyle = `rgba(${r() > 0.5 ? '255,255,250' : '20,20,18'},${0.03 + r() * 0.06})`; c.fillRect(r() * W, r() * H, 1 + r() * 4, 1 + r() * 4); }
    c.strokeStyle = 'rgba(40,38,34,0.75)'; c.lineCap = 'round';
    c.lineWidth = 5; c.strokeRect(22, 150, W - 44, H - 190);
    // crown: two facing scrolls
    c.lineWidth = 4;
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(W / 2 + s * (60 + k * 34), 84 + (k % 2) * 16, 26 - k * 3, s > 0 ? 0.4 : Math.PI - 3.6, s > 0 ? 4.6 : Math.PI - 0.4 + 6.283, false); c.stroke(); }
    // right half: columns of square marks
    c.lineWidth = 2.6;
    for (let col = 0; col < 5; col++) for (let row = 0; row < 19; row++) {
      const x = W - 62 - col * 44, y = 185 + row * 38;
      for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(x - 12 + r() * 24, y + r() * 26); c.lineTo(x - 12 + r() * 24, y + r() * 26); c.stroke(); }
    }
    // upper left: rounded marks in rows
    for (let row = 0; row < 9; row++) for (let k = 0; k < 9; k++) {
      const x = 48 + k * 24, y = 200 + row * 36;
      c.beginPath(); c.arc(x, y, 6 + r() * 4, r() * 3, r() * 3 + 3.6 + r() * 2); c.stroke();
      if (r() > 0.5) { c.beginPath(); c.moveTo(x + 6, y - 8); c.lineTo(x + 8, y + 9); c.stroke(); }
    }
    // lower left: flowing connected strokes with dots
    for (let row = 0; row < 9; row++) {
      const y = 570 + row * 38; c.beginPath(); c.moveTo(250, y);
      for (let x = 250; x > 44; x -= 13) c.quadraticCurveTo(x - 6, y - 14 * r() + 7 * Math.sin(x), x - 13, y + (r() - 0.5) * 8);
      c.stroke();
      for (let k = 0; k < 6; k++) c.fillRect(50 + r() * 190, y - 16 + r() * 28, 3, 3);
    }
  });
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2, h - w * 0.22); shape.quadraticCurveTo(w / 2, h, 0, h); shape.quadraticCurveTo(-w / 2, h, -w / 2, h - w * 0.22); shape.closePath();
  const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
  slabGeo.translate(0, 0, -thick / 2);
  const stoneMat = std(stone, { roughness: 1 });
  addRockDetail(stoneMat, 0.5);
  const slab = shadowed(new THREE.Mesh(slabGeo, stoneMat));
  slab.position.y = 0.34; g.add(slab);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, h * 0.985), new THREE.MeshStandardMaterial({ map: face, roughness: 1 }));
  front.position.set(0, 0.34 + h * 0.49, thick / 2 + 0.014); front.receiveShadow = true; g.add(front);
  const plinth = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w * 1.5, 0.34, thick * 4.2), std(mix(stone, '#000000', 0.2), { roughness: 1 })));
  plinth.position.y = 0.17; g.add(plinth);
  g.userData = { height: h + 0.34, w };
  return g;
}

// ── giraffe (about 5 m tall). userData.update(t) sways the neck and tail ─────
export function createGiraffe({ seed = 5 } = {}) {
  const g = new THREE.Group();
  const hide = canvasTexture(256, 256, (c, W, H) => {
    const r = rng(seed);
    c.fillStyle = '#e2c98f'; c.fillRect(0, 0, W, H); c.fillStyle = '#8a5526';
    for (let i = 0; i < 46; i++) {
      const x = r() * W, y = r() * H, s = 12 + r() * 14, n = 5 + Math.floor(r() * 3);
      c.beginPath();
      for (let k = 0; k < n; k++) { const a = (k / n) * 6.283, d = s * (0.7 + r() * 0.45); k ? c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d) : c.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d); }
      c.fill();
    }
  }, [2, 2]);
  const mat = new THREE.MeshStandardMaterial({ map: hide, roughness: 0.95 }), dark = std('#4a3220');
  const part = (geo, m = mat) => shadowed(new THREE.Mesh(geo, m));
  const body = part(new THREE.SphereGeometry(1, 14, 10)); body.scale.set(0.5, 0.62, 1.12); body.position.set(0, 2.72, 0); body.rotation.x = -0.2; g.add(body);
  for (const [x, z, len] of [[-0.27, 0.72, 2.45], [0.27, 0.72, 2.45], [-0.25, -0.72, 2.2], [0.25, -0.72, 2.2]]) {
    const leg = part(new THREE.CylinderGeometry(0.13, 0.075, len, 7)); leg.position.set(x, len / 2, z); g.add(leg);
    const hoof = part(new THREE.CylinderGeometry(0.09, 0.1, 0.14, 7), dark); hoof.position.set(x, 0.07, z); g.add(hoof);
  }
  const neck = new THREE.Group(); neck.position.set(0, 3.05, 0.85);
  const nk = part(new THREE.CylinderGeometry(0.16, 0.34, 2.5, 8)); nk.position.y = 1.2; neck.add(nk);
  const mane = part(new THREE.BoxGeometry(0.05, 2.3, 0.12), dark); mane.position.set(0, 1.2, -0.24); neck.add(mane);
  const head = new THREE.Group(); head.position.set(0, 2.5, 0.05);
  const skull = part(new THREE.BoxGeometry(0.24, 0.26, 0.62)); skull.position.z = 0.22; head.add(skull);
  const muzzle = part(new THREE.BoxGeometry(0.17, 0.17, 0.3)); muzzle.position.set(0, -0.05, 0.6); head.add(muzzle);
  for (const s of [-1, 1]) {
    const horn = part(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 5), dark); horn.position.set(s * 0.07, 0.22, 0.05); head.add(horn);
    const ear = part(new THREE.ConeGeometry(0.06, 0.2, 4)); ear.position.set(s * 0.17, 0.1, 0); ear.rotation.z = -s * 1.2; head.add(ear);
  }
  head.rotation.x = 0.55; neck.add(head);
  neck.rotation.x = 0.42; g.add(neck);
  const tail = part(new THREE.CylinderGeometry(0.03, 0.02, 1.1, 5), dark); tail.geometry.translate(0, -0.55, 0); tail.position.set(0, 2.75, -1.05); g.add(tail);
  g.userData.update = (t) => { neck.rotation.x = 0.42 + Math.sin(t * 0.5) * 0.05; neck.rotation.z = Math.sin(t * 0.37 + 1) * 0.04; head.rotation.y = Math.sin(t * 0.6) * 0.25; tail.rotation.x = 0.15 + Math.sin(t * 1.7) * 0.2; };
  g.userData.height = 5.4;
  return g;
}

// ── camel caravan: n loaded camels walking a path, as one instanced mesh ─────
// caravan.pose(t, path, { head, spacing }) — same idea as kit.createColumn
export function createCaravan(scene, n, { seed = 44 } = {}) {
  const parts = [], P = (geo, color) => { const g2 = geo.index ? geo.toNonIndexed() : geo; const c = new THREE.Color(color), a = new Float32Array(g2.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } g2.setAttribute('color', new THREE.BufferAttribute(a, 3)); g2.deleteAttribute('uv'); return g2; };
  const hideC = '#b8925e';
  parts.push(P(new THREE.SphereGeometry(1, 10, 8).scale(0.42, 0.5, 1.0).translate(0, 1.75, 0), hideC));
  parts.push(P(new THREE.SphereGeometry(0.36, 8, 6).scale(0.8, 1, 1).translate(0, 2.3, -0.1), hideC));
  parts.push(P(new THREE.CylinderGeometry(0.12, 0.2, 1.1, 6).rotateX(0.75).translate(0, 2.15, 1.1), hideC));
  parts.push(P(new THREE.BoxGeometry(0.2, 0.22, 0.5).translate(0, 2.6, 1.65), hideC));
  for (const [x, z] of [[-0.2, 0.62], [0.2, 0.62], [-0.2, -0.62], [0.2, -0.62]]) parts.push(P(new THREE.CylinderGeometry(0.09, 0.06, 1.5, 5).translate(x, 0.75, z), hideC));
  for (const s of [-1, 1]) parts.push(P(new THREE.BoxGeometry(0.34, 0.6, 0.9).translate(s * 0.52, 1.85, -0.05), s > 0 ? '#7a3b2a' : '#3f5a66'));
  parts.push(P(new THREE.BoxGeometry(0.9, 0.12, 1.0).translate(0, 2.18, -0.05), '#c9b488'));
  const total = parts.reduce((s2, g2) => s2 + g2.attributes.position.count, 0), pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g2 of parts) { pos.set(g2.attributes.position.array, o * 3); col.set(g2.attributes.color.array, o * 3); o += g2.attributes.position.count; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const mesh = shadowed(new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), n));
  mesh.frustumCulled = false;
  scene.add(mesh);
  const m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), sc = new THREE.Vector3(), r = rng(seed), size = [...Array(n)].map(() => 0.9 + r() * 0.25);
  return {
    mesh, count: n,
    hide() { for (let i = 0; i < n; i++) mesh.setMatrixAt(i, zero); mesh.instanceMatrix.needsUpdate = true; },
    pose(t, path, { head = 0.6, spacing = 5.5 } = {}) {
      const ds = spacing / (path.meters || 1000);
      for (let i = 0; i < n; i++) {
        const s = head - i * ds;
        if (s < 0 || s > 1) { mesh.setMatrixAt(i, zero); continue; }
        const p = path(s), p2 = path(Math.min(1, s + 0.002)), ph = t * 3.2 + i * 1.7;
        e.set(Math.sin(ph) * 0.03, Math.atan2(p2.x - p.x, p2.z - p.z), Math.sin(ph * 0.5) * 0.035);
        q.setFromEuler(e); sc.setScalar(size[i]); p.y += Math.abs(Math.sin(ph)) * 0.05;
        m.compose(p, q, sc); mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ── mariner's water compass (水罗盘): a floating needle in a bowl at the centre of a dial
// marked with the 24 traditional bearings. userData.update(t, heading) — the needle swings and settles.
const BEARINGS = '子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥壬';
export function createCompass({ radius = 0.17 } = {}) {
  const g = new THREE.Group();
  const dial = canvasTexture(1024, 1024, (c, W) => {
    const o = W / 2;
    c.fillStyle = '#6b4a2a'; c.fillRect(0, 0, W, W);
    c.fillStyle = '#c9a66a'; c.beginPath(); c.arc(o, o, 500, 0, 6.3); c.fill();
    c.fillStyle = '#b8935a'; c.beginPath(); c.arc(o, o, 380, 0, 6.3); c.fill();
    c.strokeStyle = '#3a2614'; c.lineWidth = 6;
    for (const rr of [500, 380, 250]) { c.beginPath(); c.arc(o, o, rr - 3, 0, 6.3); c.stroke(); }
    c.fillStyle = '#2a1a0c'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '600 74px "Songti SC","STSong","Noto Serif CJK SC","Noto Serif SC","Source Han Serif SC","SimSun",serif';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 6.2832;
      c.save(); c.translate(o + Math.sin(a) * 440, o - Math.cos(a) * 440); c.rotate(a); c.fillText(BEARINGS[i], 0, 0); c.restore();
      c.lineWidth = 4; c.beginPath(); c.moveTo(o + Math.sin(a + 0.1309) * 380, o - Math.cos(a + 0.1309) * 380); c.lineTo(o + Math.sin(a + 0.1309) * 497, o - Math.cos(a + 0.1309) * 497); c.stroke();
    }
    for (let i = 0; i < 48; i++) { const a = (i / 48) * 6.2832; c.lineWidth = 3; c.beginPath(); c.moveTo(o + Math.sin(a) * 250, o - Math.cos(a) * 250); c.lineTo(o + Math.sin(a) * (i % 2 ? 285 : 320), o - Math.cos(a) * (i % 2 ? 285 : 320)); c.stroke(); }
  });
  const disc = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.02, 0.035, 48), [std('#5a3d22'), new THREE.MeshStandardMaterial({ map: dial, roughness: 0.7 }), std('#5a3d22')]));
  disc.position.y = 0.0175; disc.rotation.y = Math.PI / 2; g.add(disc);          // 子 (north) towards -z, 午 (south) towards +z
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.46, radius * 0.46, 0.006, 40), new THREE.MeshPhysicalMaterial({ color: '#10222a', roughness: 0.05, metalness: 0.2, clearcoat: 1 }));
  bowl.position.y = 0.039; g.add(bowl);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.47, 0.006, 8, 48), std('#8a6a3a', { metalness: 0.7, roughness: 0.35 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.041; g.add(rim);
  const needle = new THREE.Group();
  const iron = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, radius * 0.8, 6), std('#c9ccd0', { metalness: 0.95, roughness: 0.25 })));
  iron.rotation.x = Math.PI / 2; needle.add(iron);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.03, 6), std('#c8281c', { emissive: '#5a0f08' })); tip.rotation.x = -Math.PI / 2; tip.position.z = -radius * 0.4; needle.add(tip);
  const float = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.018, 6), std('#a89a78')); float.rotation.z = Math.PI / 2; needle.add(float);
  needle.position.y = 0.046; g.add(needle);
  // The red tip seeks south (午), as a Chinese compass does. It starts about a radian off, swings and
  // settles like a damped spring. turn: rotate the whole instrument (the ship's heading) in radians.
  g.userData.update = (t, turn = 0) => { g.rotation.y = turn; needle.rotation.y = Math.PI - turn + Math.exp(-t * 0.75) * Math.cos(t * 3.1) * 1.0 + Math.sin(t * 1.3) * 0.02; };
  g.userData.update(0);
  return g;
}

// ── star board (牵星板): a square of dark wood on a cord, held at arm's length so its lower
// edge sits on the horizon and its upper edge on the star. Returns the group; face it at the camera.
export function createStarBoard({ size = 0.2 } = {}) {
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(size, size, 0.012), new THREE.MeshBasicMaterial({ color: '#1d130b' }));
  g.add(board);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, 0.012)), new THREE.LineBasicMaterial({ color: '#8a6c46' }));
  g.add(edge);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 1, 4), new THREE.MeshBasicMaterial({ color: '#8a7a60' }));
  g.add(cord);
  const _e = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  // Hold the board `dist` metres from the camera along `dir` (unit Vector3), facing the eye; the cord
  // runs back to a point `drop` metres below the lens (the hand at the chin). Call after the camera is set.
  g.userData = { size,
    place(camera, dir, dist = 0.7, drop = 0.16) {
      g.position.copy(camera.position).addScaledVector(dir, dist);
      g.lookAt(camera.position); g.updateMatrixWorld(true);
      _e.copy(camera.position); _e.y -= drop; g.worldToLocal(_e);
      const len = _e.length();
      cord.position.copy(_e).multiplyScalar(0.5); cord.scale.set(1, len, 1);
      cord.quaternion.setFromUnitVectors(_up, _e.normalize());
    } };
  return g;
}

// ── a white bell-shaped stupa (dagoba) on a stepped base ─────────────────────
export function createStupa({ r = 12, color = '#e9e4d6' } = {}) {
  const g = new THREE.Group(), V = (pts) => pts.map(([x, y]) => new THREE.Vector2(x * r, y * r));
  const mat = std(color, { roughness: 0.85 });
  for (let i = 0; i < 3; i++) { const t = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r * (1.3 - i * 0.1), r * (1.36 - i * 0.1), r * 0.14, 32), mat)); t.position.y = r * (0.07 + i * 0.14); g.add(t); }
  const bell = shadowed(new THREE.Mesh(new THREE.LatheGeometry(V([[1.05, 0], [1.02, 0.25], [0.9, 0.6], [0.66, 0.9], [0.36, 1.08], [0.2, 1.12]]), 32), mat));
  bell.position.y = r * 0.42; g.add(bell);
  const box = shadowed(new THREE.Mesh(new THREE.BoxGeometry(r * 0.46, r * 0.26, r * 0.46), mat)); box.position.y = r * 1.66; g.add(box);
  const spire = shadowed(new THREE.Mesh(new THREE.ConeGeometry(r * 0.15, r * 0.95, 12), std('#d9c27a', { metalness: 0.4, roughness: 0.5 }))); spire.position.y = r * 2.26; g.add(spire);
  g.userData.height = r * 2.74;
  return g;
}
