// Small soldier silhouettes (never portraits), wooden boats, iron-chain bridge,
// Chinese hip-roof buildings, flags. Everything instanced and posed from time.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp, lerp } from './engine.js';

// ── soldier: merged low-poly body; grey uniform, soft cap, leg wraps, bedroll, rifle.
// Limbs carry a part id so the vertex shader can swing them (walk cycle):
//   0 body · 1 left leg · 2 right leg · 3 left arm · 4 right arm
function part(geo, color, [x, y, z], rot = [0, 0, 0], id = 0) {
  geo.rotateX(rot[0]); geo.rotateY(rot[1]); geo.rotateZ(rot[2]);
  geo.translate(x, y, z);
  geo = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3), pid = new Float32Array(n).fill(id);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aPart', new THREE.BufferAttribute(pid, 1));
  geo.deleteAttribute('uv');
  return geo;
}
export const HIP_Y = 0.82, SHOULDER_Y = 1.38;
// hat: 'cap' (soft army cap) | 'conical' (straw hat) | 'turban' | 'none' · pack: bedroll + satchel ·
// robe: a knee-length robe over the legs. Soldiers are the default; for sailors, porters, townspeople
// use e.g. { rifle: false, pack: false, hat: 'conical', robe: true, uniform: '#6a5a44' }.
export function soldierGeometry({ uniform = '#4f5752', skin = '#8a6a52', gear = '#3a3128', wrap = '#6a6a5e', rifle = true, hat = 'cap', hatColor = '#c8b078', pack = true, robe = false } = {}) {
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const parts = [
    part(B(0.42, 0.56, 0.25), uniform, [0, 1.12, 0]),                                  // torso
    part(B(0.46, 0.1, 0.27), uniform, [0, 1.42, 0]),                                   // shoulders
    part(B(0.4, 0.06, 0.27), gear, [0, 0.86, 0]),                                      // belt
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 6), skin, [0, 1.48, 0]),         // neck
    part(new THREE.SphereGeometry(0.125, 8, 6), skin, [0, 1.6, 0]),                    // head
    // legs: thigh + wrapped lower leg + shoe (swing about the hip)
    part(B(0.17, 0.4, 0.2), uniform, [-0.115, 0.62, 0], [0, 0, 0], 1), part(B(0.15, 0.36, 0.17), wrap, [-0.115, 0.26, 0], [0, 0, 0], 1), part(B(0.13, 0.08, 0.26), '#2a2622', [-0.115, 0.04, 0.04], [0, 0, 0], 1),
    part(B(0.17, 0.4, 0.2), uniform, [0.115, 0.62, 0], [0, 0, 0], 2), part(B(0.15, 0.36, 0.17), wrap, [0.115, 0.26, 0], [0, 0, 0], 2), part(B(0.13, 0.08, 0.26), '#2a2622', [0.115, 0.04, 0.04], [0, 0, 0], 2),
    // arms: sleeve + hand (swing about the shoulder)
    part(B(0.12, 0.52, 0.13), uniform, [-0.29, 1.13, 0.01], [0, 0, 0.1], 3), part(B(0.09, 0.1, 0.1), skin, [-0.32, 0.83, 0.02], [0, 0, 0], 3),
    part(B(0.12, 0.52, 0.13), uniform, [0.29, 1.13, 0.01], [0, 0, -0.1], 4), part(B(0.09, 0.1, 0.1), skin, [0.32, 0.83, 0.02], [0, 0, 0], 4),
  ];
  if (hat === 'cap') parts.push(part(new THREE.CylinderGeometry(0.14, 0.15, 0.09, 10), uniform, [0, 1.71, 0]), part(B(0.2, 0.025, 0.1), uniform, [0, 1.675, 0.15]));
  else if (hat === 'conical') parts.push(part(new THREE.ConeGeometry(0.31, 0.17, 10), hatColor, [0, 1.76, 0]));
  else if (hat === 'turban') parts.push(part(new THREE.SphereGeometry(0.15, 8, 5).scale(1, 0.72, 1), hatColor, [0, 1.7, 0]));
  if (pack) parts.push(part(new THREE.TorusGeometry(0.2, 0.065, 6, 12), gear, [0, 1.2, -0.19]), part(B(0.16, 0.2, 0.09), gear, [0.2, 0.9, 0.06], [0, 0, 0.1]));
  if (robe) parts.push(part(B(0.45, 0.5, 0.29), uniform, [0, 0.62, 0]));
  if (rifle) parts.push(part(B(0.045, 1.15, 0.05), '#2b241d', [0.14, 1.2, -0.2], [0, 0, 0.33]));
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

// count soldiers as one InstancedMesh. Per instance: a matrix (setPose) and a gait
// (setGait: phase in radians, amplitude 0..1). Amplitude 0 = standing still.
export function createSoldiers(count, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart; attribute vec2 aGait;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  if (aPart > 0.5 && aGait.y > 0.001) {
    float sgn = (abs(aPart - 1.0) < 0.1 || abs(aPart - 4.0) < 0.1) ? 1.0 : -1.0;
    float isLeg = step(aPart, 2.5);
    float pivot = mix(${SHOULDER_Y.toFixed(2)}, ${HIP_Y.toFixed(2)}, isLeg);
    float ang = sin(aGait.x) * aGait.y * mix(0.5, 0.62, isLeg) * sgn;
    float c = cos(ang), s = sin(ang);
    vec2 yz = vec2(transformed.y - pivot, transformed.z);
    transformed.y = pivot + yz.x * c - yz.y * s;
    transformed.z = yz.x * s + yz.y * c;
  }`);
  };
  const geo = soldierGeometry(opts);
  geo.setAttribute('aGait', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
export function setGait(mesh, i, phase, amp = 1) {
  const a = mesh.geometry.attributes.aGait;
  a.array[i * 2] = phase; a.array[i * 2 + 1] = amp;
  a.needsUpdate = true;
}

// Pose helpers — set instance i: position, heading (rad about Y), pitch (rad), bob, scale
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function setPose(mesh, i, x, y, z, heading = 0, pitch = 0, roll = 0, scale = 1) {
  _e.set(pitch, heading, roll, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.setScalar(scale);
  _m.compose(_p, _q, _s);
  mesh.setMatrixAt(i, _m);
}

// ── torches carried by marchers (a light-emitting head on a stick) ─────────
export function createTorchHeads(count) {
  const g = new THREE.SphereGeometry(0.12, 6, 4);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb24a').multiplyScalar(4) });
  const mesh = new THREE.InstancedMesh(g, mat, count);
  mesh.frustumCulled = false;
  return mesh;
}

// ── wooden boat ────────────────────────────────────────────────────────────
export function boatGeometry(len = 9, beam = 2.2) {
  const shape = new THREE.Shape();
  shape.moveTo(-len / 2, 0.3);
  shape.quadraticCurveTo(-len / 2 + 0.6, -0.5, -len / 2 + 1.6, -0.6);
  shape.lineTo(len / 2 - 1.6, -0.6);
  shape.quadraticCurveTo(len / 2 - 0.6, -0.5, len / 2, 0.4);
  shape.lineTo(-len / 2, 0.3);
  const hull = new THREE.ExtrudeGeometry(shape, { depth: beam, bevelEnabled: false, curveSegments: 8 });
  hull.translate(0, 0, -beam / 2);
  return hull;
}
export function createBoat() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(boatGeometry(), new THREE.MeshStandardMaterial({ color: '#4a3726', roughness: 0.9 }));
  hull.castShadow = true;
  g.add(hull);
  const oar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 4.2), new THREE.MeshStandardMaterial({ color: '#5b4632' }));
  oar.position.set(-3.8, 0.8, 0); oar.rotation.x = 0.4; oar.rotation.y = 0.3;
  g.add(oar);
  return g;
}

// ── iron-chain suspension bridge: 9 floor chains + 2×2 handrail chains = 13 ─
export function chainY(x, span, deckY, sag) {
  const u = x / (span / 2);
  return deckY - sag * (1 - u * u);
}
export function createChainBridge({ span = 104, deckY = 14, sag = 2.2, width = 2.9, linkLen = 0.17 }) {
  const group = new THREE.Group();
  const floorZ = [];
  for (let k = 0; k < 9; k++) floorZ.push(lerp(-width / 2, width / 2, k / 8));
  const chains = floorZ.map((z) => ({ z, dy: 0 }));
  for (const side of [-1, 1]) {
    chains.push({ z: side * (width / 2 + 0.25), dy: 0.85 });
    chains.push({ z: side * (width / 2 + 0.25), dy: 1.45 });
  }
  const perChain = Math.floor(span / linkLen);
  const link = new THREE.TorusGeometry(0.07, 0.019, 5, 12);
  link.scale(1.9, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: '#262422', metalness: 0.8, roughness: 0.5 });
  const mesh = new THREE.InstancedMesh(link, mat, perChain * chains.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const eTwist = new THREE.Euler();
  let n = 0;
  for (const ch of chains) {
    for (let i = 0; i < perChain; i++) {
      const x = -span / 2 + (i + 0.5) * linkLen;
      const y = chainY(x, span, deckY + ch.dy, sag);
      const slope = Math.atan2(chainY(x + 0.01, span, deckY + ch.dy, sag) - y, 0.01);
      eTwist.set(i % 2 ? Math.PI / 2 : 0, 0, slope);
      q.setFromEuler(eTwist);
      p.set(x, y, ch.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(n++, m);
    }
  }
  mesh.castShadow = true;
  group.add(mesh);
  group.userData.chains = chains;
  return group;
}

// Remaining planks near the far (east) end: gaps where boards were pulled away
export function createPlanks({ span = 104, deckY = 14, sag = 2.2, from = 22, to = 52, width = 2.9, seed = 9 }) {
  const r = rng(seed);
  const g = new THREE.BoxGeometry(0.24, 0.07, width + 0.2);
  const mat = new THREE.MeshStandardMaterial({ color: '#5a4430', roughness: 0.95 });
  const count = Math.floor((to - from) / 0.28);
  const mesh = new THREE.InstancedMesh(g, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  let n = 0;
  for (let i = 0; i < count; i++) {
    const x = from + i * 0.28;
    const keep = r() < lerp(0.35, 0.98, (x - from) / (to - from));
    if (!keep) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.08);
    p.set(x, chainY(x, span, deckY, sag) + 0.06, (r() - 0.5) * 0.3);
    m.compose(p, q, s);
    mesh.setMatrixAt(n++, m);
  }
  mesh.count = n;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ── Chinese hip-and-gable style roof over a rectangular footprint ──────────
export function roofGeometry(w, d, h, overhang = 1.2, lift = 0.9, seg = 24) {
  const W2 = w / 2 + overhang, D2 = d / 2 + overhang;
  const geo = new THREE.PlaneGeometry(2, 2, seg, seg);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), v = pos.getY(i);
    const ridge = 0.35;                                // ridge along X
    const mu = Math.max(0, (Math.abs(u) - ridge) / (1 - ridge));
    const m = Math.max(mu, Math.abs(v));
    let y = h * Math.pow(1 - m, 1.7);                  // concave slopes
    y += lift * Math.pow(Math.abs(u) * Math.abs(v), 6); // upturned corners
    pos.setXYZ(i, u * W2, y, v * D2);
  }
  geo.computeVertexNormals();
  return geo;
}
export function createBuilding({ w = 10, d = 7, wallH = 5, roofH = 3.2, wall = '#5b2e24', roof = '#2a2b2d', base = null, stories = 1 }) {
  const g = new THREE.Group();
  let y = 0;
  if (base) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(base.w, base.h, base.d), new THREE.MeshStandardMaterial({ color: base.color || '#6d6860', roughness: 1 }));
    b.position.y = base.h / 2; b.castShadow = b.receiveShadow = true; g.add(b); y = base.h;
  }
  for (let s = 0; s < stories; s++) {
    const k = 1 - s * 0.18;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w * k, wallH, d * k), new THREE.MeshStandardMaterial({ color: wall, roughness: 0.9 }));
    body.position.y = y + wallH / 2; body.castShadow = body.receiveShadow = true; g.add(body);
    const rf = new THREE.Mesh(roofGeometry(w * k, d * k, roofH * k, 1.2 * k, 0.9 * k), new THREE.MeshStandardMaterial({ color: roof, roughness: 0.8, side: THREE.DoubleSide }));
    rf.position.y = y + wallH; rf.castShadow = true; g.add(rf);
    y += wallH + roofH * 0.35;
  }
  g.userData.height = y;
  return g;
}

// ── cloth flag: plane displaced by time ────────────────────────────────────
export function createFlag({ w = 1.6, h = 1.0, color = '#b3261e', pole = 3.2 } = {}) {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, pole, 6), new THREE.MeshStandardMaterial({ color: '#3a2e22' }));
  p.position.y = pole / 2; g.add(p);
  const geo = new THREE.PlaneGeometry(w, h, 16, 8);
  geo.translate(w / 2, pole - h / 2, 0);
  const base = geo.attributes.position.array.slice();
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8, emissive: new THREE.Color(color).multiplyScalar(0.15) }));
  flag.castShadow = true;
  g.add(flag);
  g.userData.update = (t) => {
    const a = geo.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const k = x / w;
      a.setZ(i, Math.sin(x * 3.2 - t * 7.0) * 0.18 * k + Math.sin(y * 2.0 - t * 4.3) * 0.05 * k);
    }
    a.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return g;
}
