// Relief map built from real terrain (AWS Terrain Tiles) + Natural Earth rivers.
// Draws terrain, rivers, routes and place markers only — never national or provincial
// borders (a wrong border on a map of China is a legal problem, so none are drawn).
import * as THREE from 'three';
import { clamp, smooth, lerp, VIEW } from './engine.js';

const V_SCALE = 1 / 300;   // metres → map px (vertical exaggeration built in)

export async function loadGeo(base = '') {
  const res = await fetch(base + 'assets/geo.json');
  if (!res.ok) return null;                      // films without a map have no geo.json
  const geo = await res.json();
  const img = new Image();
  // onload, not img.decode(): decode() never settles in a hidden/background page
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('terrain image failed')); img.src = base + geo.image; });
  const [w, h] = geo.size;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  const elev = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) elev[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  geo.elev = elev;
  return geo;
}

// land colour by elevation (metres). style.ramp replaces it; RAMPS.warm suits maps that are mostly sea.
export const RAMPS = {
  ink: [[0, '#15191a'], [200, '#23261f'], [600, '#34352a'], [1200, '#4b4636'], [2200, '#6e6249'], [3300, '#93826a'], [4300, '#b8a888'], [5200, '#d8ccb0'], [6500, '#efe6d2']],
  warm: [[0, '#4a4330'], [150, '#564d36'], [500, '#665a3e'], [1200, '#7f6f4c'], [2400, '#a08c66'], [3800, '#c2b08a'], [5200, '#ddd0b0'], [6500, '#f1e8d4']],
};
// sea colours: shallow shelf → deep basin, plus a thin light rim along every coast
export const SEAS = {
  ink: { shallow: '#10171a', deep: '#0a0d0f', coast: '#1a2529' },
  teal: { shallow: '#1d5263', deep: '#0b2230', coast: '#4f97a3' },
};
const _rc = new THREE.Color();

// flat ribbon along a polyline, draped on the terrain; aDist = distance along the line
function ribbon(points, width, sampleY, lift = 0.4) {
  const pos = [], dist = [], idx = [], side = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz * width / 2, nz = dx * width / 2;
    if (i > 0) acc += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    for (const s of [-1, 1]) { pos.push(p.x, sampleY(p.x, p.z) + lift, p.z); side.push(nx * s, nz * s); dist.push(acc); }
    if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 2));
  g.setIndex(idx);
  g.userData.length = acc;
  return g;
}
// Lines are drawn as ribbons whose width (and dash length, and the glowing head) grow with the camera
// distance — LINE_SCALE is shared by every line and set by setCamera — so a route is as readable from
// 3000 px up as from 300.
const LINE_SCALE = { value: 1 };
const lineMat = (color, { dash = 0, glow = 0 } = {}) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uDraw: { value: 0 }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 }, uDash: { value: dash }, uGlow: { value: glow }, uScale: LINE_SCALE },
  vertexShader: `attribute float aDist; attribute vec2 aSide; uniform float uScale; varying float vD;
    void main(){ vD = aDist; vec3 p = position; p.xz += aSide * uScale; gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
  fragmentShader: `uniform float uDraw, uAlpha, uDash, uGlow, uScale; uniform vec3 uColor; varying float vD;
    void main(){ if (vD > uDraw) discard; if (uDash > 0.0 && mod(vD, uDash * uScale) > uDash * uScale * 0.55) discard;
      float head = smoothstep(uDraw - 14.0 * uScale, uDraw, vD);
      gl_FragColor = vec4(uColor * (1.0 + head * uGlow), uAlpha); }`,
});

export function buildMap(geo, style = {}) {
  const [w, h] = geo.size;
  const E = geo.elev;
  const sample = (u, v) => {
    u = clamp(u, 0, w - 1.001); v = clamp(v, 0, h - 1.001);
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    return (E[y0 * w + x0] * (1 - fx) + E[y0 * w + x0 + 1] * fx) * (1 - fy) + (E[(y0 + 1) * w + x0] * (1 - fx) + E[(y0 + 1) * w + x0 + 1] * fx) * fy;
  };
  const yAt = (x, z) => Math.max(0, sample(x + w / 2, z + h / 2)) * V_SCALE;
  // lon/lat → world (Web-Mercator pixel space of the stitched image, centred)
  const N = 2 ** geo.zoom * 256, [OX, OY] = geo.origin;
  const llToWorld = ([lon, lat]) => ({
    x: (lon + 180) / 360 * N - OX - w / 2,
    z: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * N - OY - h / 2,
  });

  const scene = new THREE.Scene();
  const ink = style.ink || '#0b0c0d';
  scene.background = new THREE.Color(ink);
  scene.fog = new THREE.Fog(ink, 600, 1500);

  // terrain. Colour comes from a full-resolution texture (elevation ramp × hillshade) so relief and
  // coastlines stay crisp however coarse the mesh is. The texture's alpha carries the elevation
  // around sea level; the shader cuts the coast from it with screen-space anti-aliasing, so the
  // shoreline is a clean line at any zoom instead of a blur of map pixels.
  const ramp = (typeof style.ramp === 'string' ? RAMPS[style.ramp] : style.ramp) || RAMPS.ink;
  const lut = new Uint8Array(701 * 3);                                // 0…7000 m in 10 m steps, sRGB bytes
  for (let i = 0; i <= 700; i++) {
    const e = i * 10; let j = 0;
    while (j < ramp.length - 2 && e > ramp[j + 1][0]) j++;
    _rc.set(ramp[j][1]).lerp(new THREE.Color(ramp[j + 1][1]), clamp((e - ramp[j][0]) / (ramp[j + 1][0] - ramp[j][0])));
    const hex = _rc.getHex(THREE.SRGBColorSpace);
    lut[i * 3] = hex >> 16; lut[i * 3 + 1] = (hex >> 8) & 255; lut[i * 3 + 2] = hex & 255;
  }
  const px = new Uint8Array(w * h * 4), relief = style.relief ?? 1;
  let wet = 0;
  for (let y = 0; y < h; y++) {
    const row = (h - 1 - y) * w * 4, ya = Math.max(0, y - 1) * w, yb = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const e = E[y * w + x], xa = Math.max(0, x - 1), xb = Math.min(w - 1, x + 1);
      // hillshade, light from the north-west
      const gx = (Math.max(0, E[y * w + xb]) - Math.max(0, E[y * w + xa])) * 0.0011 * relief, gy = (Math.max(0, E[yb + x]) - Math.max(0, E[ya + x])) * 0.0011 * relief;
      const sh = clamp(1 + (-gx * 0.62 - gy * 0.5) / Math.sqrt(1 + gx * gx + gy * gy) * 0.9, 0.5, 1.45);
      const li = Math.min(700, Math.max(0, Math.round(e / 10))) * 3, o = row + x * 4;
      px[o] = Math.min(255, lut[li] * sh); px[o + 1] = Math.min(255, lut[li + 1] * sh); px[o + 2] = Math.min(255, lut[li + 2] * sh);
      px[o + 3] = Math.round(127.5 + 127.5 * Math.sign(e) * Math.sqrt(Math.min(1, Math.abs(e) / 6000)));
      if (e < -2) wet++;
    }
  }
  const tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true;
  const seaStyle = style.sea === true ? SEAS.teal : typeof style.sea === 'string' ? SEAS[style.sea] : typeof style.sea === 'object' && style.sea ? { ...SEAS.teal, ...style.sea } : SEAS.ink;
  const seg = Math.min(1100, w), stepX = w / seg, stepZ = stepX;
  const tg = new THREE.PlaneGeometry(w, h, Math.floor(w / stepX), Math.floor(h / stepZ));
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(0, sample(pos.getX(i) + w / 2, pos.getZ(i) + h / 2)) * V_SCALE);
  tg.computeVertexNormals();
  const tmat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
  tmat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uSeaShallow: { value: new THREE.Color(seaStyle.shallow) }, uSeaDeep: { value: new THREE.Color(seaStyle.deep) }, uCoast: { value: new THREE.Color(seaStyle.coast) }, uEdge: { value: style.edgeFade ?? 0.14 } });
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSeaShallow, uSeaDeep, uCoast; uniform float uEdge;')
      .replace('#include <map_fragment>', `
        vec4 tx = texture2D(map, vMapUv);
        float aa = fwidth(tx.a) * 0.9 + 0.0008;
        float land = smoothstep(0.5 - aa, 0.5 + aa, tx.a);
        float depth = clamp((0.5 - tx.a) * 2.0, 0.0, 1.0);                       // 0 at the shore … 1 at 6000 m (square-root scale)
        vec3 seaCol = mix(uSeaShallow, uSeaDeep, smoothstep(0.03, 0.72, depth)) + uCoast * exp(-depth * 30.0) * 0.55;
        vec2 em = min(vMapUv, 1.0 - vMapUv) / uEdge;                             // fade the rim of the map into the ink
        float ef = 0.25 + 0.75 * smoothstep(0.0, 1.0, min(em.x, em.y));
        diffuseColor = vec4(mix(seaCol, tx.rgb, land) * ef, 1.0);`);
  };
  scene.add(new THREE.Mesh(tg, tmat));
  geo.seaShare = wet / (w * h);
  const sun = new THREE.DirectionalLight('#fff1d8', 2.4);
  sun.position.set(-400, 260, -300);
  scene.add(sun, new THREE.HemisphereLight('#c9c0b0', '#1a1814', 0.9));

  // rivers
  const riverMat = lineMat(style.river || '#56727d');
  riverMat.uniforms.uDraw.value = 1e9; riverMat.uniforms.uAlpha.value = 0.85;
  for (const r of geo.rivers || []) {
    if (r.rank > 8) continue;
    scene.add(new THREE.Mesh(ribbon(r.pts.map(llToWorld), r.rank <= 2 ? 1.6 : r.rank <= 5 ? 1.1 : 0.7, yAt, 0.25), riverMat));
  }

  // routes: "main" glows; others are drawn with the same progressive-draw material
  const routes = {};
  for (const [name, lls] of Object.entries(geo.routes || {})) {
    const curve = new THREE.CatmullRomCurve3(lls.map((p) => { const q = llToWorld(p); return new THREE.Vector3(q.x, 0, q.z); }), false, 'catmullrom', 0.3);
    const pts = curve.getSpacedPoints(Math.max(200, lls.length * 30)).map((v) => ({ x: v.x, z: v.z }));
    const g = ribbon(pts, name === 'main' ? 2.6 : 2.2, yAt, name === 'main' ? 0.9 : 1.0);
    const mat = lineMat(name === 'main' ? (style.route || '#d0392b') : (style.route2 || '#e0503c'), { glow: 1.6 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 2;
    scene.add(mesh);
    // distance along the smoothed route at each named node
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const nodes = {};
    for (const [node, idx] of Object.entries((geo.nodes || {})[name] || {})) {
      const t = llToWorld(lls[idx]);
      let best = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i].x - t.x, pts[i].z - t.z); if (d < bd) { bd = d; best = i; } }
      nodes[node] = acc[best];
    }
    routes[name] = { mesh, mat, len: acc[acc.length - 1], nodes };
  }

  // place markers — labels are DOM pins positioned by projection
  const places = {};
  const dotGeo = new THREE.SphereGeometry(1.4, 12, 8);
  for (const [name, p] of Object.entries(geo.places || {})) {
    const q = llToWorld(p.ll || p);
    const y = yAt(q.x, q.z) + 1.2;
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(style.dot || '#e7b35a').multiplyScalar(1.5), transparent: true }));
    dot.position.set(q.x, y, q.z);
    dot.visible = false;
    scene.add(dot);
    places[name] = { pos: new THREE.Vector3(q.x, y, q.z), dot };
  }

  // decorations (lines / arrows / rings), built on first use and cached by id
  const decos = {};
  function buildDeco(d) {
    const g = new THREE.Group();
    let pts;
    if (d.type === 'ring') {
      const ctr = xz(d.center); pts = [];
      for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2 + (d.start || 0); pts.push({ x: ctr[0] + Math.cos(a) * d.r, z: ctr[1] + Math.sin(a) * d.r }); }
    } else {
      const curve = new THREE.CatmullRomCurve3(d.pts.map((p) => { const q = xz(p); return new THREE.Vector3(q[0], 0, q[1]); }), false, 'catmullrom', 0.4);
      pts = curve.getSpacedPoints(Math.max(20, d.pts.length * 30)).map((v) => ({ x: v.x, z: v.z }));
    }
    const geoR = ribbon(pts, d.width || 1.6, yAt, d.lift || 1.1);
    const mat = lineMat(d.color || '#8e9aa3', { dash: d.dash || 0 });
    const mesh = new THREE.Mesh(geoR, mat);
    mesh.renderOrder = 3;
    g.add(mesh);
    let head = null;
    if (d.type === 'arrow') {
      const hg = new THREE.ConeGeometry((d.width || 1.6) * 2.2, (d.width || 1.6) * 5, 3);
      hg.rotateX(Math.PI / 2);
      head = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: d.color || '#8e9aa3', transparent: true, depthWrite: false }));
      head.renderOrder = 3;
      g.add(head);
    }
    scene.add(g);
    return { g, mat, head, pts, len: geoR.userData.length, base: new THREE.Color(d.color || '#8e9aa3') };
  }
  // d: { id, type: line|arrow|ring, pts|center+r, width, color, dash, draw:[t0,t1],
  //      alpha, fadeIn:[t0,t1], fadeOut:[t0,t1], pulse: Hz, flashAt: t, flashColor }
  function decor(t, list) {
    const active = new Set();
    for (const d of list || []) {
      active.add(d.id);
      const D = (decos[d.id] ||= buildDeco(d));
      D.g.visible = true;
      const [t0, t1] = d.draw || [0, 0.001];
      const k = smooth((t - t0) / Math.max(0.001, t1 - t0));
      let a = d.alpha ?? 1;
      if (d.fadeIn) a *= smooth((t - d.fadeIn[0]) / Math.max(0.001, d.fadeIn[1] - d.fadeIn[0]));
      if (d.fadeOut) a *= 1 - smooth((t - d.fadeOut[0]) / Math.max(0.001, d.fadeOut[1] - d.fadeOut[0]));
      if (d.pulse) a *= 0.6 + 0.4 * Math.sin(t * d.pulse * Math.PI * 2);
      D.mat.uniforms.uDraw.value = D.len * k;
      D.mat.uniforms.uAlpha.value = a;
      D.mat.uniforms.uColor.value.copy(d.flashAt != null && t > d.flashAt ? _rc.set(d.flashColor || '#b8403a') : D.base);
      if (D.head) {
        const i = Math.min(D.pts.length - 1, Math.floor(k * (D.pts.length - 1)));
        const p = D.pts[i], q = D.pts[Math.max(0, i - 1)], y = yAt(p.x, p.z) + 1.2;
        D.head.position.set(p.x, y, p.z);
        D.head.lookAt(p.x + (p.x - q.x), y, p.z + (p.z - q.z));
        D.head.visible = k > 0.02;
        D.head.material.opacity = a;
      }
    }
    for (const [id, D] of Object.entries(decos)) if (!active.has(id)) D.g.visible = false;
  }

  const camera = new THREE.PerspectiveCamera(34, VIEW.aspect, 1, Math.max(6000, w * 2.5));

  // a point given as a place name, [lon, lat], {place|ll, dx, dz} (dx/dz in map px) or {xz:[x,z]}
  function xz(p) {
    if (typeof p === 'string') { if (!places[p]) throw new Error(`map: unknown place "${p}"`); return [places[p].pos.x, places[p].pos.z]; }
    if (Array.isArray(p)) { const q = llToWorld(p); return [q.x, q.z]; }
    if (p.xz) return p.xz;
    const b = xz(p.place ?? p.ll);
    return [b[0] + (p.dx || 0), b[1] + (p.dz || 0)];
  }
  // a distance along a route: number | "node" | "node+30" | "total" | "start" | {between:[a,b], k}
  function dist(spec, route = 'main') {
    const R = routes[route];
    if (typeof spec === 'number') return spec;
    if (spec === 'total') return R.len;
    if (spec === 'start') return 0;
    if (typeof spec === 'object') return lerp(dist(spec.between[0], route), dist(spec.between[1], route), spec.k ?? 0.5);
    const m = /^(.*?)([+-]\d+(\.\d+)?)?$/.exec(spec);
    if (!(m[1] in R.nodes)) throw new Error(`map: route "${route}" has no node "${m[1]}"`);
    return R.nodes[m[1]] + (m[2] ? parseFloat(m[2]) : 0);
  }
  // Camera target + distance that frame a set of points for a given pitch and yaw. The points are
  // projected through the real camera and fitted into the part of the picture that is free of
  // overlays (title block top-left, subtitles along the bottom), so nothing asked for ends up
  // off-screen or under the text. margin > 1 leaves more air around them.
  const SAFE = { x0: -0.80, x1: 0.80, y0: -0.52, y1: 0.66 };            // NDC
  const _p = new THREE.Vector3();
  function fit(points, pitch = 60, margin = 1.1, yaw = 0) {
    const P = points.map(xz);
    let cx = (Math.min(...P.map((p) => p[0])) + Math.max(...P.map((p) => p[0]))) / 2, cz = (Math.min(...P.map((p) => p[1])) + Math.max(...P.map((p) => p[1]))) / 2, d = 600;
    const vf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), hf = vf * VIEW.aspect, pr = THREE.MathUtils.degToRad(pitch), yr = THREE.MathUtils.degToRad(yaw);
    const sw = (SAFE.x1 - SAFE.x0) / margin, sh = (SAFE.y1 - SAFE.y0) / margin, sx = (SAFE.x0 + SAFE.x1) / 2, sy = (SAFE.y0 + SAFE.y1) / 2;
    for (let it = 0; it < 14; it++) {
      api.setCamera({ at: { xz: [cx, cz] }, dist: d, pitch, yaw });
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [x, z] of P) { _p.set(x, yAt(x, z), z).project(camera); x0 = Math.min(x0, _p.x); x1 = Math.max(x1, _p.x); y0 = Math.min(y0, _p.y); y1 = Math.max(y1, _p.y); }
      // slide the target so the points' box sits in the middle of the free area, then scale the distance
      const ex = (x0 + x1) / 2 - sx, ey = (y0 + y1) / 2 - sy;
      // on the ground: screen-right is (cos yaw, -sin yaw), screen-up is (-sin yaw, -cos yaw)
      const right = ex * d * hf, fwd = ey * d * vf / Math.max(0.3, Math.sin(pr));
      cx += right * Math.cos(yr) - fwd * Math.sin(yr); cz += -right * Math.sin(yr) - fwd * Math.cos(yr);
      d = Math.max(120, d * Math.max((x1 - x0) / sw, (y1 - y0) / sh, 0.02));
    }
    return { at: { xz: [cx, cz] }, dist: d };
  }

  const api = {
    scene, camera, places, routes, yAt, llToWorld, xz, dist, fit, decor,
    setCamera({ at, dist: d = 420, pitch = 52, yaw = 0 }) {
      const [tx, tz] = xz(at);
      const tgt = new THREE.Vector3(tx, yAt(tx, tz), tz);
      const pr = THREE.MathUtils.degToRad(pitch), yr = THREE.MathUtils.degToRad(yaw);
      camera.aspect = VIEW.aspect; camera.updateProjectionMatrix();
      camera.position.set(tgt.x + Math.sin(yr) * Math.cos(pr) * d, tgt.y + Math.sin(pr) * d, tgt.z + Math.cos(yr) * Math.cos(pr) * d);
      camera.lookAt(tgt);
      camera.updateMatrixWorld();
      scene.fog.near = d * 0.9; scene.fog.far = d * 2.6;
      const ls = Math.max(1, d / 520);                       // lines, arrows and dots keep their on-screen size when the camera pulls back
      LINE_SCALE.value = ls;
      for (const p of Object.values(places)) p.dot.scale.setScalar(ls);
      for (const D of Object.values(decos)) if (D.head) D.head.scale.setScalar(ls);
    },
    // draw a route up to a distance along it
    setDraw(d, route = 'main', alpha = 1) { const R = routes[route]; R.mesh.visible = d > 0; R.mat.uniforms.uDraw.value = d; R.mat.uniforms.uAlpha.value = alpha; },
    showDots(names) { for (const [n, p] of Object.entries(places)) p.dot.visible = (names || []).includes(n); },
    // per-shot reset so one shot's state never leaks into the next
    reset() {
      for (const [n, R] of Object.entries(routes)) { R.mat.uniforms.uAlpha.value = 1; if (n !== 'main') { R.mesh.visible = false; R.mat.uniforms.uDraw.value = 0; } }
      decor(0, []);
    },
  };
  return api;
}
