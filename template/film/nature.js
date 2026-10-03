// Terrain (procedural valleys), river water shader, and time-driven particle systems.
import * as THREE from 'three';
import { makeNoise, rng, clamp, smooth, lerp } from './engine.js';

// ── procedural valley terrain ───────────────────────────────────────────────
// heightFn(x, z) → metres. Vertex colours by height + slope: sand near water,
// grass/scrub on gentle slopes, rock on cliffs, snow above snowLine.
export function buildTerrain({ size = [1600, 2400], seg = [320, 480], heightFn, palette = {}, snowLine = Infinity, center = [0, 0], detail = 1 }) {
  const [sx, sz] = size;
  const geo = new THREE.PlaneGeometry(sx, sz, seg[0], seg[1]);
  geo.rotateX(-Math.PI / 2);
  geo.translate(center[0], 0, center[1]);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightFn(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const P = {
    sand: new THREE.Color(palette.sand || '#8a7a60'),
    grass: new THREE.Color(palette.grass || '#3f4a2c'),
    grass2: new THREE.Color(palette.grass2 || '#58603a'),
    rock: new THREE.Color(palette.rock || '#5d564d'),
    rock2: new THREE.Color(palette.rock2 || '#7a7064'),
    snow: new THREE.Color(palette.snow || '#e8ecef'),
  };
  const noise = makeNoise(77);
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - nrm.getY(i);
    const n = noise.fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5;
    c.copy(P.grass).lerp(P.grass2, n);
    c.lerp(P.rock, smooth((slope - 0.18) / 0.25));
    c.lerp(P.rock2, smooth((slope - 0.45) / 0.3) * n);
    c.lerp(P.rock2, 0.18 * (0.5 + 0.5 * Math.sin(y * 0.09 + n * 4.0)) * smooth((slope - 0.3) / 0.3));  // strata bands on cliffs
    c.multiplyScalar(0.88 + 0.24 * noise.fbm(x * 0.08, z * 0.08, 2));
    c.lerp(P.sand, smooth((6 - y) / 5));
    if (y > snowLine) c.lerp(P.snow, smooth((y - snowLine) / 60) * (1 - smooth((slope - 0.55) / 0.3) * 0.6));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
  addRockDetail(mat, detail);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

// Procedural rock detail in the fragment shader: world-space 3D noise perturbs the
// normal (cracks, ledges) and modulates albedo — far more detail than the vertex grid.
const NOISE3 = `
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h3(i+vec3(0,0,0)),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }
  float fbm3(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*n3(p); p=p*2.13+vec3(3.1,1.7,5.3); a*=0.5; } return s; }
`;
export function addRockDetail(mat, strength = 1) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform float uDetail;' + NOISE3)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(1.0, 0.84 + 0.32 * fbm3(vWPos * 0.09) , uDetail);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { vec3 p = vWPos * vec3(0.22, 0.45, 0.22); float e = 0.35; float n0 = fbm3(p);
    vec3 g = vec3(fbm3(p + vec3(e,0,0)) - n0, fbm3(p + vec3(0,e,0)) - n0, fbm3(p + vec3(0,0,e)) - n0) / e;
    normal = normalize(normal - mat3(viewMatrix) * g * 0.75 * uDetail); }`);
  };
}

// Canyon height function: river runs along Z; riverX(z) meanders; walls rise steeply.
export function canyonHeight({ seed = 3, halfWidth = 48, wallHeight = 520, wallSteep = 0.9, meander = (z) => 0 }) {
  const n = makeNoise(seed);
  return (x, z) => {
    const d = Math.abs(x - meander(z));
    const bed = -6;
    if (d < halfWidth) return bed + (d / halfWidth) * 4;
    const e = d - halfWidth;
    const bank = Math.min(e * 0.55, 10) + 2;                  // low bank/terrace near water
    const wall = wallHeight * (1 - Math.exp(-Math.pow(e / 260, 1.35) * wallSteep * 1.8));
    const ridg = n.ridged(x * 0.0042, z * 0.0042, 5);
    const detail = n.fbm(x * 0.02, z * 0.02, 4) * 18;
    return bank + wall * (0.55 + 0.75 * ridg) + detail * smooth(e / 30);
  };
}

// ── river water ─────────────────────────────────────────────────────────────
export function createWater({ size = [1600, 2400], seg = [160, 240], flow = [0, -1], speed = 5, deep = '#1d2a28', shallow = '#4f5a4c', foam = 0.55, y = 0, center = [0, 0], amp = 1 }) {
  const geo = new THREE.PlaneGeometry(size[0], size[1], seg[0], seg[1]);
  geo.rotateX(-Math.PI / 2);
  geo.translate(center[0], y, center[1]);
  const mat = new THREE.ShaderMaterial({
    fog: true,
    transparent: false,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uFlow: { value: new THREE.Vector2(...flow).normalize() },
      uSpeed: { value: speed },
      uDeep: { value: new THREE.Color(deep) },
      uShallow: { value: new THREE.Color(shallow) },
      uSky: { value: new THREE.Color('#9aa3a8') },
      uSunDir: { value: new THREE.Vector3(0.3, 0.5, -0.4).normalize() },
      uSunColor: { value: new THREE.Color('#ffe2b0') },
      uFoam: { value: foam },
      uLight: { value: 1.0 },
      uEmberCol: { value: new THREE.Color('#000000') },
      uAmp: { value: amp },
    }]),
    vertexShader: `
      uniform float uTime, uSpeed, uAmp; uniform vec2 uFlow;
      varying vec3 vWorld; varying vec2 vFlowUv;
      #include <fog_pars_vertex>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec3 p = position;
        vec2 fp = p.xz - uFlow * uTime * uSpeed;
        p.y += ((noise(fp * 0.08) - 0.5) * 0.9 + (noise(p.xz * 0.05 + uTime * 0.3) - 0.5) * 0.5) * uAmp;
        vWorld = (modelMatrix * vec4(p,1.0)).xyz; vFlowUv = fp;
        vec4 mvPosition = modelViewMatrix * vec4(p,1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime, uSpeed, uFoam, uLight; uniform vec2 uFlow;
      uniform vec3 uDeep, uShallow, uSky, uSunDir, uSunColor, uEmberCol;
      varying vec3 vWorld; varying vec2 vFlowUv;
      #include <fog_pars_fragment>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.07+vec2(1.7,9.2); a*=0.5;} return s; }
      void main(){
        vec2 fl = normalize(uFlow), pr = vec2(fl.y, -fl.x);
        float along = dot(vWorld.xz, fl) - uTime * uSpeed, across = dot(vWorld.xz, pr);
        // anisotropic fields: long streaks along the current, fine chop on top
        #define ST(ac, al) (fbm(vec2((ac) * 0.2, (al) * 0.03)) * 0.6 + fbm(vec2((ac) * 0.9, (al) * 0.22 - uTime * 0.6)) * 0.4)
        float big = fbm(vec2(across * 0.025, along * 0.01));
        float h0 = ST(across, along), e = 0.6;
        float hx = ST(across + e, along), hz = ST(across, along + e);
        vec3 nl = vec3(-(hx - h0) / e * 2.2, 1.0, -(hz - h0) / e * 2.2);
        vec3 n = normalize(vec3(nl.x * pr.x + nl.z * fl.x, 1.0, nl.x * pr.y + nl.z * fl.y));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 base = mix(uDeep, uShallow, smoothstep(0.3, 0.75, big));
        vec3 col = mix(base, uSky * 0.75, 0.04 + fres * 0.3);
        vec3 H = normalize(normalize(uSunDir) + V);
        col += uSunColor * pow(max(dot(n, H), 0.0), 220.0) * 1.2;
        float streak = fbm(vec2(across * 0.35, along * 0.045));
        float foam = smoothstep(0.64, 0.82, streak * 0.75 + big * 0.35) * smoothstep(0.35, 0.65, h0);
        col = mix(col, vec3(0.74, 0.74, 0.7), foam * uFoam);
        col *= uLight;
        col += uEmberCol * (0.4 + 0.6 * fres);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return mesh;
}

// ── particles: every particle's state is a pure function of (seed, t) ──────
// kind: 'fire' | 'smoke' | 'spray' | 'rain' | 'snow' | 'ember' | 'torch'
const PARTICLE_VS = `
  attribute float aSeed; attribute vec3 aOrigin;
  uniform float uTime, uSize, uLife, uRise, uSpread, uKind, uWind;
  uniform vec3 uBox;
  varying float vAge; varying float vSeed;
  float h(float n){ return fract(sin(n*12.9898)*43758.5453); }
  void main(){
    float life = uLife * (0.6 + 0.8 * h(aSeed*3.1));
    float t = uTime + h(aSeed) * life * 7.0;
    float age = mod(t, life) / life;       // 0..1 within this particle's life
    float cyc = floor(t / life);
    if (uKind > 4.5) { age = uTime / life; cyc = 0.0; }   // burst: one shot from uTime = 0
    vec3 o = aOrigin;
    vec3 p = o;
    float s1 = h(aSeed + cyc*1.37), s2 = h(aSeed*1.7 + cyc*2.11), s3 = h(aSeed*2.9 + cyc*0.73);
    if (uKind < 0.5) {            // fire: rises, narrows, flickers
      p += vec3((s1-0.5)*uSpread*(1.0-age*0.6), age*uRise*(0.7+0.6*s2), (s3-0.5)*uSpread*(1.0-age*0.6));
      p.x += sin(age*9.0 + aSeed)*0.25*age + uWind*age*age;
    } else if (uKind < 1.5) {     // smoke: rises & widens, drifts with wind
      p += vec3((s1-0.5)*uSpread*(0.4+age*2.0) + uWind*age*uRise*0.6, age*uRise, (s3-0.5)*uSpread*(0.4+age*2.0));
    } else if (uKind < 2.5 || uKind > 4.5) {     // spray / burst: ballistic from origin
      vec3 v = vec3((s1-0.5)*2.0, 0.8+s2*1.6, (s3-0.5)*2.0) * uSpread;
      p += v*age*1.2 + vec3(0.0, -9.8*age*age*0.9, 0.0);
    } else if (uKind < 3.5) {     // rain / snow: falls through a box around origin
      vec3 q = vec3(s1, 1.0 - age, s3) * uBox - uBox*0.5;
      p = o + q + vec3(uWind*(1.0-age)*uBox.y*0.3, 0.0, 0.0);
      p.x += sin(age*6.2831*2.0 + aSeed)*uSpread;
    } else {                      // ember: slow rise with wander
      p += vec3(sin(age*7.0+aSeed)*uSpread + uWind*age*4.0, age*uRise, cos(age*5.0+aSeed)*uSpread);
    }
    vAge = age; vSeed = s2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float sz = uSize;
    if (uKind < 0.5) sz *= (1.0 - age*0.7);
    else if (uKind < 1.5) sz *= (0.5 + age*2.2);
    else if (uKind < 2.5 || uKind > 4.5) sz *= (1.0 - age*0.5);
    if (age > 1.0 || age < 0.0) sz = 0.0;
    gl_PointSize = sz * (900.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const PARTICLE_FS = `
  uniform float uKind, uOpacity; uniform vec3 uColA, uColB;
  varying float vAge; varying float vSeed;
  void main(){
    vec2 c = gl_PointCoord - 0.5; float r = length(c);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    vec3 col; float a;
    if (uKind < 0.5) { float s2 = soft*soft; col = mix(uColA, uColB, smoothstep(0.0, 0.7, vAge)); col = mix(col, vec3(0.15,0.05,0.03), smoothstep(0.6,1.0,vAge)); a = s2 * (1.0 - vAge) * (1.0 - vAge) * 0.55 * uOpacity; col *= 1.0 + (1.0-vAge)*0.8; }
    else if (uKind < 1.5) { col = mix(uColA, uColB, vAge); a = soft * 0.5 * sin(vAge*3.1416) * uOpacity; }
    else if (uKind < 2.5 || uKind > 4.5) { col = uColA; a = soft * (1.0 - vAge) * uOpacity; }
    else if (uKind < 3.5) { col = uColA; float streak = smoothstep(0.12, 0.0, abs(c.x)); a = mix(soft, streak, uColB.r) * uOpacity * (0.6+0.4*vSeed); }
    else { col = uColA * 2.0; a = soft * (1.0 - vAge) * uOpacity; }
    gl_FragColor = vec4(col, a);
  }`;
const KINDS = { fire: 0, smoke: 1, spray: 2, rain: 3, snow: 3, ember: 4, torch: 0, burst: 5 };

export function createParticles({ kind = 'fire', count = 200, origins, originJitter = [0, 0, 0], size = 1, life = 1.2, rise = 4, spread = 1, wind = 0,
  colA = '#ffcf6a', colB = '#b3261e', opacity = 1, box = [60, 40, 60], additive = null, seed = 1, streak = 0 }) {
  const r = rng(seed);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), org = new Float32Array(count * 3), sd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = origins[i % origins.length];
    org[i * 3] = o[0] + (r() - 0.5) * originJitter[0];
    org[i * 3 + 1] = o[1] + (r() - 0.5) * originJitter[1];
    org[i * 3 + 2] = o[2] + (r() - 0.5) * originJitter[2];
    sd[i] = r() * 1000;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aOrigin', new THREE.BufferAttribute(org, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  const isAdd = additive ?? (kind === 'fire' || kind === 'ember' || kind === 'torch');
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSize: { value: size }, uLife: { value: life }, uRise: { value: rise }, uSpread: { value: spread },
      uKind: { value: KINDS[kind] }, uWind: { value: wind }, uBox: { value: new THREE.Vector3(...box) },
      uColA: { value: new THREE.Color(colA) }, uColB: { value: kind === 'rain' || kind === 'snow' ? new THREE.Color(streak, 0, 0) : new THREE.Color(colB) },
      uOpacity: { value: opacity },
    },
    vertexShader: PARTICLE_VS,
    fragmentShader: PARTICLE_FS,
    transparent: true,
    depthWrite: false,
    blending: isAdd ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.update = (t) => { mat.uniforms.uTime.value = t; };
  return pts;
}

// ── scattered trees (instanced cones + trunks) on terrain ──────────────────
// tree shapes with their own colours (unit size ≈ 3 tall; scatterTrees scales them)
function tinted(g, color) {
  const n = g.index ? g.toNonIndexed() : g, c = new THREE.Color(color), a = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  n.setAttribute('color', new THREE.BufferAttribute(a, 3)); n.deleteAttribute('uv');
  return n;
}
function mergeSimple(list) {
  const total = list.reduce((s, g) => s + g.attributes.position.count, 0), pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
function palmGeometry(seed) {
  const r = rng(seed + 3), parts = [];
  const trunk = new THREE.CylinderGeometry(0.06, 0.1, 2.6, 5, 4); trunk.translate(0, 1.3, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) + 0.18 * Math.pow(tp.getY(i) / 2.6, 2));      // a lean
  parts.push(tinted(trunk, '#6e5c46'));
  for (let f = 0; f < 9; f++) {
    const a = (f / 9) * 6.283 + r() * 0.4, len = 1.25 + r() * 0.35, droop = 0.55 + r() * 0.3, v = [];
    for (let j = 0; j < 4; j++) {
      const k0 = j / 4, k1 = (j + 1) / 4;
      const pt = (k, side) => { const rad = k * len, y = 2.6 + 0.4 * Math.sin(k * 2.4) - droop * k * k, w = 0.2 * (1 - 0.75 * k) * side; return [0.18 + Math.cos(a) * rad - Math.sin(a) * w, y, Math.sin(a) * rad + Math.cos(a) * w]; };
      v.push(...pt(k0, -1), ...pt(k0, 1), ...pt(k1, -1), ...pt(k0, 1), ...pt(k1, 1), ...pt(k1, -1));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    parts.push(tinted(g, f % 2 ? '#41703a' : '#356032'));
  }
  return mergeSimple(parts);
}
function acaciaGeometry(seed) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.05, 0.1, 1.5, 5); trunk.translate(0, 0.75, 0);
  parts.push(tinted(trunk, '#4a3a2a'));
  for (const [x, z, s] of [[0, 0, 1], [0.5, 0.2, 0.7], [-0.45, -0.25, 0.75]]) {
    const b = new THREE.CylinderGeometry(0.03, 0.05, 0.9, 4); b.rotateZ(-x * 1.1); b.rotateX(z * 1.1); b.translate(x * 0.5, 1.6, z * 0.5);
    parts.push(tinted(b, '#4a3a2a'));
    const c = new THREE.IcosahedronGeometry(1, 1); c.scale(1.25 * s, 0.2 * s, 1.25 * s); c.translate(x, 2.05 + 0.1 * s, z);
    parts.push(tinted(c, '#66763a'));
  }
  return mergeSimple(parts);
}

export function scatterTrees({ count = 1500, area, heightFn, accept = () => true, seed = 5, color = '#2e3a24', scale = [6, 14], shape = 'blob' }) {
  const r = rng(seed);
  let cone;
  if (shape === 'cone') { cone = new THREE.ConeGeometry(1, 2.4, 6); cone.translate(0, 1.6, 0); }
  else if (shape === 'palm') cone = palmGeometry(seed);
  else if (shape === 'acacia') cone = acaciaGeometry(seed);
  else {  // irregular canopy blob
    cone = new THREE.IcosahedronGeometry(1, 1);
    const pa = cone.attributes.position, rr = rng(seed + 1);
    for (let i = 0; i < pa.count; i++) { const k = 0.8 + rr() * 0.4; pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k * 0.9, pa.getZ(i) * k); }
    cone.computeVertexNormals();
    cone.translate(0, 1.1, 0);
  }
  // white base: per-instance colour (setColorAt) multiplies the material colour
  const own = !!cone.attributes.color;          // palm / acacia carry their own trunk + leaf colours
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, vertexColors: own, side: own ? THREE.DoubleSide : THREE.FrontSide });
  const mesh = new THREE.InstancedMesh(cone, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const tint = new THREE.Color();
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 20) {
    const x = lerp(area[0], area[1], r()), z = lerp(area[2], area[3], r());
    const y = heightFn(x, z);
    if (!accept(x, y, z)) continue;
    const k = lerp(scale[0], scale[1], r());
    p.set(x, y - 0.5, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
    s.set(k * 0.45, k * 0.6, k * 0.45);
    m.compose(p, q, s);
    mesh.setMatrixAt(n, m);
    if (own) tint.setScalar(0.8 + r() * 0.4); else tint.set(color).multiplyScalar(0.75 + r() * 0.5);
    mesh.setColorAt(n, tint);
    n++;
  }
  mesh.count = n;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
