// Open sea, sailing junks and fleets.
//
//   createSea(opts)        animated ocean surface (used by worlds.seaWorld / coastWorld)
//   seaHeight(x, z, t, o)  the same waves in JS, so ships ride the water they are drawn on
//   junkGeometry(opts)     a Chinese ocean-going junk: hull + castles + masts, battened sails
//   createFleet(scene, n)  n instanced junks: fleet.pose(t, i => ({ x, z, heading }), { sea: W })
//   formation(n, opts)     slot offsets for a fleet sailing in company
//
// Everything is a function of time. Ship forward is +z; heading 0 faces +z (atan2(dx, dz)).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp, lerp, canvasTexture } from './engine.js';

// ── waves ────────────────────────────────────────────────────────────────────
// [direction offset from the wind (rad), wavelength (m), amplitude (m)] at amp = 1 (a moderate sea).
const WAVES = [[0, 95, 0.55], [0.35, 61, 0.34], [-0.42, 37, 0.2], [0.9, 23, 0.11], [-1.1, 14, 0.06]];
const crest = (s) => 2 * Math.pow(0.5 + 0.5 * s, 1.3) - 1;          // sharper crests, flatter troughs
// wind = direction the waves travel towards, radians from +x towards +z
export function seaHeight(x, z, t, { amp = 1, wind = 0.6 } = {}) {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const [da, L, A] = WAVES[i], a = wind + da, k = 6.2831853 / L;
    h += A * crest(Math.sin(k * (Math.cos(a) * x + Math.sin(a) * z) - k * 1.25 * Math.sqrt(L) * t + i * 1.7));
  }
  return h * amp;
}
const WAVE_GLSL = `
  uniform float uTime, uAmp, uWind;
  float seaH(vec2 p){
    float h = 0.0;
    ${WAVES.map(([da, L, A], i) => `{ float a = uWind + ${da.toFixed(4)}; float k = ${(6.2831853 / L).toFixed(6)};
      float s = sin(k * (cos(a) * p.x + sin(a) * p.y) - ${(6.2831853 / L * 1.25 * Math.sqrt(L)).toFixed(6)} * uTime + ${(i * 1.7).toFixed(2)});
      h += ${A.toFixed(3)} * (2.0 * pow(0.5 + 0.5 * s, 1.3) - 1.0); }`).join('\n    ')}
    return h * uAmp;
  }`;

export const MAX_WAKES = 64;

// A square grid, fine in the middle and coarse at the rim, that follows the camera — so there is
// always detail under the lens and the surface still reaches the horizon.
function seaGrid(R, N) {
  const g = new THREE.PlaneGeometry(2, 2, N, N);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const warp = (u) => R * (0.12 * u + 0.88 * u * Math.pow(Math.abs(u), 1.7));
  for (let i = 0; i < p.count; i++) p.setXYZ(i, warp(p.getX(i)), 0, warp(p.getZ(i)));
  return g;
}

// deep/shallow: body colours · foam: whitecaps 0–1 · chop: small ripples 0–1.5 · amp: swell height
export function createSea({ radius = 6000, seg = 300, y = 0, amp = 1, wind = 0.6, deep = '#0a2130', shallow = '#1f5f6b', foam = 0.5, chop = 1 } = {}) {
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uAmp: { value: amp }, uWind: { value: wind }, uY: { value: y },
      uDeep: { value: new THREE.Color(deep) }, uShallow: { value: new THREE.Color(shallow) },
      uSky: { value: new THREE.Color('#c4d6dc') }, uSkyTop: { value: new THREE.Color('#3f6f9e') },
      uSunDir: { value: new THREE.Vector3(0.3, 0.5, -0.4).normalize() }, uSunColor: { value: new THREE.Color('#fff0d0') },
      uFoam: { value: foam }, uChop: { value: chop }, uLight: { value: 1 }, uEmberCol: { value: new THREE.Color('#000000') },
      uShips: { value: [...Array(MAX_WAKES)].map(() => new THREE.Vector4()) }, uShipCount: { value: 0 },
    }]),
    vertexShader: `
      uniform float uY; varying vec3 vWorld;
      ${WAVE_GLSL}
      #include <fog_pars_vertex>
      void main(){
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        wp.y = uY + seaH(wp.xz);
        vWorld = wp;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uFoam, uChop, uLight; uniform int uShipCount; uniform vec4 uShips[${MAX_WAKES}];
      uniform vec3 uDeep, uShallow, uSky, uSkyTop, uSunDir, uSunColor, uEmberCol;
      varying vec3 vWorld;
      ${WAVE_GLSL}
      #include <fog_pars_fragment>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*noise(p); p=p*2.07+vec2(1.7,9.2); a*=0.5;} return s; }
      float ripple(vec2 p, vec2 w){ return fbm(p * 0.42 - w * uTime * 0.9) * 0.6 + fbm(p * 1.7 + vec2(w.y, -w.x) * uTime * 0.5 - w * uTime * 1.3) * 0.25; }
      void main(){
        vec2 q = vWorld.xz, wd = vec2(cos(uWind), sin(uWind));
        float dist = length(cameraPosition - vWorld);
        // swell normal from the wave function itself, so lighting never depends on the mesh density
        float e = 0.4, h0 = seaH(q);
        vec3 n = vec3(-(seaH(q + vec2(e, 0.0)) - h0) / e, 1.0, -(seaH(q + vec2(0.0, e)) - h0) / e);
        // small ripples, faded with distance so the far sea does not sparkle with noise
        float near = 1.0 / (1.0 + dist * 0.006), r0 = ripple(q, wd);
        n.xz += vec2(-(ripple(q + vec2(0.25, 0.0), wd) - r0), -(ripple(q + vec2(0.0, 0.25), wd) - r0)) * 2.4 * uChop * (0.15 + 0.85 * near);
        n = normalize(n);
        vec3 V = normalize(cameraPosition - vWorld), S = normalize(uSunDir);
        float ndv = max(dot(n, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, n); R.y = abs(R.y);
        vec3 sky = mix(uSky, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.55));
        float sd = max(dot(R, S), 0.0);
        vec3 sun = uSunColor * (pow(sd, 700.0) * 5.0 + pow(sd, 80.0) * 0.5 + pow(sd, 10.0) * 0.07) * smoothstep(-0.05, 0.08, S.y);
        float up = smoothstep(-0.7, 1.3, h0 / max(uAmp, 0.05));
        vec3 body = mix(uDeep, uShallow, up * 0.7 + 0.3 * pow(1.0 - ndv, 2.0) * up);
        body *= 0.55 + 0.45 * max(dot(n, S), 0.0);
        vec3 col = mix(body, sky, F * 0.9) + sun;
        // whitecaps on the crests
        float cap = smoothstep(0.72, 1.0, up * 0.75 + fbm(q * 0.05 - wd * uTime * 0.5) * 0.5) * uFoam;
        // wakes: a foam trail behind each moving ship and a ring of foam along the hull
        float wake = 0.0;
        for (int i = 0; i < ${MAX_WAKES}; i++) {
          if (i >= uShipCount) break;
          vec4 s = uShips[i]; vec2 d = q - s.xy; float L = abs(s.w);
          if (dot(d, d) > L * L * 30.0) continue;
          vec2 f = vec2(sin(s.z), cos(s.z));
          float al = dot(d, f), ac = dot(d, vec2(f.y, -f.x)), moving = step(0.0, s.w);
          float a = -al - L * 0.40, w = L * 0.08 + max(a, 0.0) * 0.10;
          float trail = smoothstep(w, w * 0.3, abs(ac)) * smoothstep(-3.0, 4.0, a) * exp(-max(a, 0.0) / (L * 1.7));
          float hull = length(vec2(al / (L * 0.57), ac / (L * 0.165)));
          float ring = smoothstep(1.4, 1.08, hull) * smoothstep(0.82, 1.02, hull) * (0.35 + 0.65 * smoothstep(-L * 0.3, L * 0.5, al));
          wake = max(wake, (trail * 0.6 + ring * 0.8) * moving + ring * 0.1 * (1.0 - moving));
        }
        float lace = 0.45 + 0.55 * noise(q * 0.8 + wd * uTime * 0.7) * (0.6 + 0.4 * noise(q * 2.6));
        float white = clamp(cap * lace + wake * (0.35 + 0.65 * lace), 0.0, 1.0);
        vec3 foamCol = (uSky * 0.55 + uSunColor * 0.45) * (0.55 + 0.45 * max(S.y, 0.0) + 0.2);
        col = mix(col, foamCol, white);
        col *= uLight;
        col += uEmberCol * (0.4 + 0.6 * F);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(seaGrid(radius, seg), mat);
  mesh.frustumCulled = false;
  const step = radius * 0.12 * 2 / seg * 4, ships = [], _c = new THREE.Vector3();
  mesh.userData = {
    sea: true, ships,
    // keep the fine part of the grid under the camera (snapped, so vertices do not swim) and
    // send the wakes of the ships nearest the camera to the shader. Called by world.cam().
    follow(camera) {
      mesh.position.x = Math.round(camera.position.x / step) * step;
      mesh.position.z = Math.round(camera.position.z / step) * step;
      _c.copy(camera.position);
      const near = ships.length > MAX_WAKES ? [...ships].sort((a, b) => (a[0] - _c.x) ** 2 + (a[1] - _c.z) ** 2 - (b[0] - _c.x) ** 2 - (b[1] - _c.z) ** 2).slice(0, MAX_WAKES) : ships;
      near.forEach((s, i) => mat.uniforms.uShips.value[i].set(s[0], s[1], s[2], s[3]));
      mat.uniforms.uShipCount.value = near.length;
    },
  };
  return mesh;
}

// ── junk ─────────────────────────────────────────────────────────────────────
// scalar Catmull-Rom through [[u, value], …] (smooth hull lines, no flat spots at the keys)
function curve1(keys) {
  return (u) => {
    u = clamp(u, keys[0][0], keys[keys.length - 1][0]);
    let i = 0;
    while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
    const p0 = keys[Math.max(0, i - 1)][1], p1 = keys[i][1], p2 = keys[i + 1][1], p3 = keys[Math.min(keys.length - 1, i + 2)][1];
    const t = (u - keys[i][0]) / (keys[i + 1][0] - keys[i][0]), t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
  };
}
const _col = new THREE.Color();
function paint(geo, color, shade = null) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _col.set(typeof color === 'function' ? color(g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i)) : color);
    if (shade) _col.multiplyScalar(shade(i));
    c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}
const box = (w, h, d, x, y, z, color) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return paint(g, color); };

const PAINT = { keel: '#1b1613', plank: '#46301f', stripe: '#bfa97e', wale: '#6f2a1c', rail: '#231c17', deck: '#8c7450', cabin: '#74392a', trim: '#cdb88c', roof: '#27221e', mast: '#3a2a1e', flag: '#b3261e' };

// length: overall (m) · masts: 3 | 5 | 7 · sail: cloth colour. Returns
// { hull, sails, lanterns: [[x,y,z],…], length, beam, deckY(u) } in the ship's own frame.
export function junkGeometry({ length: L = 64, masts = 5, sail = '#a8643c', seed = 3, paintOverride = {} } = {}) {
  const P = { ...PAINT, ...paintOverride }, k = L / 64, B = L * 0.26, r = rng(seed);
  const beam = curve1([[0, 0.58], [0.12, 0.84], [0.32, 1], [0.6, 1], [0.84, 0.76], [1, 0.36]]);
  const sheer = curve1([[0, 0.150], [0.2, 0.104], [0.5, 0.072], [0.8, 0.094], [1, 0.134]]);
  const keel = curve1([[0, -0.022], [0.25, -0.048], [0.7, -0.048], [1, -0.008]]);
  const half = (u) => B / 2 * beam(u), top = (u) => sheer(u) * L, bot = (u) => keel(u) * L;
  const bul = 1.1 * k, deckY = (u) => top(u) - bul;
  const NS = 30, NV = 12, parts = [];

  // hull shell: a ring per station, port gunwale → keel → starboard gunwale
  const pos = [], col = [], idx = [], ring = 2 * NV + 1;
  for (let i = 0; i <= NS; i++) {
    const u = i / NS, z = (u - 0.5) * L, hb = half(u), t = top(u), b = bot(u);
    for (let j = 0; j < ring; j++) {
      const side = j < NV ? -1 : 1, v = Math.abs(j - NV) / NV;
      const x = side * hb * Math.pow(v, 0.42) * (1 + 0.05 * v), y = b + (t - b) * Math.pow(v, 1.35);
      pos.push(x, y, z);
      _col.set(v > 0.95 ? P.rail : v > 0.80 ? P.wale : v > 0.72 ? P.stripe : y < 0.3 * k ? P.keel : P.plank).multiplyScalar(0.9 + 0.2 * r());
      col.push(_col.r, _col.g, _col.b);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < ring - 1; j++) {
    const a = i * ring + j, b = a + ring;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  parts.push(shell.toNonIndexed());

  // deck and the two flat ends (junks have transoms, not pointed ends)
  const flat = (verts, color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    parts.push(paint(g, color, () => 0.92 + 0.16 * r()));
  };
  const dv = [];
  for (let i = 0; i < NS; i++) {
    const u0 = i / NS, u1 = (i + 1) / NS, z0 = (u0 - 0.5) * L, z1 = (u1 - 0.5) * L, a = half(u0) * 0.96, b = half(u1) * 0.96, y0 = deckY(u0), y1 = deckY(u1);
    dv.push(-a, y0, z0, a, y0, z0, -b, y1, z1, a, y0, z0, b, y1, z1, -b, y1, z1);
  }
  flat(dv, P.deck);
  for (const end of [0, NS]) {
    const tv = [], o = end * ring, cy = (top(end / NS) + bot(end / NS)) / 2, cz = pos[o * 3 + 2];
    for (let j = 0; j < ring - 1; j++) {
      const a = (o + j) * 3, b = (o + j + 1) * 3;
      if (end === 0) tv.push(0, cy, cz, pos[b], pos[b + 1], pos[b + 2], pos[a], pos[a + 1], pos[a + 2]);
      else tv.push(0, cy, cz, pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2]);
    }
    const a = o * 3, b = (o + ring - 1) * 3;                       // close the top between the gunwales
    if (end === 0) tv.push(0, cy, cz, pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2]);
    else tv.push(0, cy, cz, pos[b], pos[b + 1], pos[b + 2], pos[a], pos[a + 1], pos[a + 2]);
    flat(tv, P.wale);
  }

  // stern castle (two tiers) and forecastle
  const zAt = (u) => (u - 0.5) * L;
  const tier = (u0, u1, wK, y0, h, over = 0.5) => {
    const w = 2 * half((u0 + u1) / 2) * wK, d = (u1 - u0) * L, z = zAt((u0 + u1) / 2);
    parts.push(box(w, h, d, 0, y0 + h / 2, z, P.cabin));
    parts.push(box(w + 0.12 * k, 0.4 * k, d + 0.12 * k, 0, y0 + h - 0.45 * k, z, P.trim));          // painted band under the eaves
    parts.push(box(w + 0.1 * k, 0.8 * k, d * 0.82, 0, y0 + h * 0.5, z, P.roof));                  // a row of dark windows
    parts.push(box(w + over * 2 * k, 0.35 * k, d + over * 2 * k, 0, y0 + h + 0.17 * k, z, P.roof));
    return y0 + h + 0.35 * k;
  };
  const c1 = tier(0.015, 0.25, 0.94, deckY(0.25) - 0.3 * k, top(0.03) - deckY(0.25) + 1.2 * k);
  const c2 = tier(0.03, 0.17, 0.74, c1, 2.7 * k);
  tier(0.87, 0.985, 0.9, deckY(0.87) - 0.2 * k, top(1) - deckY(0.87) + 0.3 * k, 0.3);

  // rudder under the stern, a windlass and hatches on deck (small things that stop the deck looking bare)
  parts.push(box(0.5 * k, 6.5 * k, 3.4 * k, 0, bot(0.04) + 2.6 * k, zAt(0) - 1.4 * k, P.keel));
  for (const u of [0.44, 0.62, 0.79]) parts.push(box(half(u) * 0.7, 0.7 * k, 3.2 * k, 0, deckY(u) + 0.35 * k, zAt(u), P.cabin));
  parts.push(box(half(0.3) * 1.1, 1.9 * k, 5 * k, 0, deckY(0.3) + 0.95 * k, zAt(0.29), P.cabin), box(half(0.3) * 1.1 + 0.6 * k, 0.3 * k, 5.6 * k, 0, deckY(0.3) + 2.0 * k, zAt(0.29), P.roof));
  // masts: [position along the hull, height, base] — tallest amidships
  const plan = masts >= 7 ? [[0.93, 15], [0.80, 23], [0.65, 30], [0.50, 34], [0.36, 29], [0.23, 21, c1], [0.10, 14, c2]]
    : masts >= 5 ? [[0.90, 17], [0.72, 27], [0.52, 34], [0.33, 26], [0.13, 15, c2]]
      : [[0.84, 15], [0.52, 25], [0.2, 13, c1]];
  const sails = [], lanterns = [], mastTops = [];
  plan.forEach(([u, hRaw, base], m) => {
    const h = hRaw * k, y0 = base ?? deckY(u), z = zAt(u);
    const mg = new THREE.CylinderGeometry(0.2 * k, 0.42 * k, h, 7); mg.translate(0, y0 + h / 2, z);
    parts.push(paint(mg, P.mast));
    mastTops.push([0, y0 + h, z]);
    // pennant streaming from the masthead
    const pg = new THREE.BufferGeometry(), pl = 5.5 * k, ph = 1.1 * k, py = y0 + h - 0.3 * k;
    pg.setAttribute('position', new THREE.Float32BufferAttribute([0, py, z, 0, py - ph, z, pl * 0.3, py - ph * 0.4, z + pl, 0, py, z, pl * 0.3, py - ph * 0.4, z + pl, 0, py - ph, z], 3));
    pg.computeVertexNormals();
    parts.push(paint(pg, P.flag));
    // battened lug sail, set a little across the wind
    const w = h * 0.64, hs = h * 0.70, boom = y0 + h * 0.13, nb = Math.max(6, Math.round(hs / (2.6 * k)));
    const sg = new THREE.PlaneGeometry(w, hs, 8, nb * 3), sp = sg.attributes.position, trim = 0.98 + (m % 2 ? 0.08 : -0.06);     // radians off the beam: a fore-and-aft rig, eased out on a reach
    const boomAttr = new Float32Array(sp.count);
    for (let i = 0; i < sp.count; i++) {
      const xf = sp.getX(i) / w + 0.5, v = sp.getY(i) / hs + 0.5;
      const y = boom + v * hs + xf * v * 0.2 * hs;
      const x = (xf - 0.3) * w * (1 + 0.1 * Math.sin(Math.PI * v) * xf);
      const zz = 0.075 * w * Math.sin(Math.PI * xf) * (0.55 + 0.45 * Math.sin(Math.PI * v)) + 0.02 * w * Math.abs(Math.sin(Math.PI * v * nb)) * Math.sin(Math.PI * xf);
      sp.setXYZ(i, x * Math.cos(trim) + zz * Math.sin(trim), y, z - x * Math.sin(trim) + zz * Math.cos(trim) + 0.5 * k);
      boomAttr[i] = boom;
    }
    sg.computeVertexNormals();
    sg.setAttribute('aBoom', new THREE.BufferAttribute(boomAttr, 1));
    sails.push(sg);
    const bg = new THREE.CylinderGeometry(0.14 * k, 0.14 * k, w, 5); bg.rotateZ(Math.PI / 2); bg.translate(0.2 * w, 0, 0); bg.rotateY(trim); bg.translate(0, boom - 0.2 * k, z + 0.5 * k);
    parts.push(paint(bg, P.mast));
  });
  const main = mastTops.reduce((a, b) => (b[1] > a[1] ? b : a));
  lanterns.push([main[0], main[1] - 1.5 * k, main[2]], [-half(0.05) * 0.7, c2 + 0.8 * k, zAt(0.04)], [half(0.05) * 0.7, c2 + 0.8 * k, zAt(0.04)], [0, top(1) + 1.2 * k, zAt(0.97)]);

  const hull = mergeGeometries(parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; }));
  const sailGeo = mergeGeometries(sails);
  const sailTex = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = sail; g.fillRect(0, 0, w, h);
    const nb = 9;
    for (let i = 0; i < nb; i++) {                                    // each panel: lit belly, shaded under the batten
      const y0 = (i / nb) * h, gr = g.createLinearGradient(0, y0, 0, y0 + h / nb);
      gr.addColorStop(0, 'rgba(0,0,0,0.30)'); gr.addColorStop(0.35, 'rgba(255,235,200,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
      g.fillStyle = gr; g.fillRect(0, y0, w, h / nb);
      g.fillStyle = 'rgba(30,18,10,0.75)'; g.fillRect(0, y0, w, 3);
    }
    const rr = rng(seed + 9);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rr() > 0.5 ? '255,240,210' : '20,10,5'},${0.03 + rr() * 0.05})`; g.fillRect(rr() * w, rr() * h, 1 + rr() * 2, 6 + rr() * 26); }
    g.fillStyle = 'rgba(30,18,10,0.6)'; g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h);
  });
  return { hull, sails: sailGeo, sailTex, sailColor: sail, lanterns, length: L, beam: B, deckY, half };
}

const GLOW = () => canvasTexture(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,220,160,0.7)'); gr.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});

// ── fleet: n junks drawn as two instanced meshes (hulls, sails) ──────────────
// const fleet = createFleet(W.scene, 62, { length: 64, masts: 5 });
// fleet.pose(t, (i) => ({ x, z, heading, scale, moving }), { sea: W });   // call after W.tick(t), before W.cam()
// fleet.furl(k)      0 = sails set, 1 = lowered onto the booms
// fleet.lamps(k)     lantern brightness 0–1 (night)
export function createFleet(scene, n, opts = {}) {
  const J = junkGeometry(opts);
  const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  const furl = { value: 0 };
  const sailMat = new THREE.MeshStandardMaterial({ map: J.sailTex, roughness: 0.95, side: THREE.DoubleSide, emissive: new THREE.Color(J.sailColor).multiplyScalar(0.10) });
  sailMat.onBeforeCompile = (sh) => {
    sh.uniforms.uFurl = furl;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aBoom; uniform float uFurl;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y = aBoom + (transformed.y - aBoom) * (1.0 - 0.9 * uFurl);');
  };
  const hull = new THREE.InstancedMesh(J.hull, hullMat, n), sails = new THREE.InstancedMesh(J.sails, sailMat, n);
  hull.castShadow = hull.receiveShadow = true; sails.castShadow = true;
  hull.frustumCulled = sails.frustumCulled = false;
  const nl = J.lanterns.length, lampPos = new Float32Array(n * nl * 3);
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.BufferAttribute(lampPos, 3));
  const lampMat = new THREE.PointsMaterial({ map: GLOW(), color: '#ffb866', size: 9 * (J.length / 64), sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const lamps = new THREE.Points(lampGeo, lampMat);
  lamps.frustumCulled = false; lamps.visible = false;
  scene.add(hull, sails, lamps);
  const m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), q = new THREE.Quaternion(), eu = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const state = [...Array(n)].map(() => ({ x: 0, y: 0, z: 0, heading: 0, scale: 1, on: false }));
  return {
    ...J, count: n, hull, sails, lampPoints: lamps, state,
    hide() { for (let i = 0; i < n; i++) { hull.setMatrixAt(i, zero); sails.setMatrixAt(i, zero); state[i].on = false; } hull.instanceMatrix.needsUpdate = sails.instanceMatrix.needsUpdate = true; lamps.visible = false; },
    furl(k) { furl.value = clamp(k); sails.castShadow = k < 0.5; },
    lamps(k) { lampMat.opacity = clamp(k); lamps.visible = k > 0.01; },
    // place(i) → { x, z, heading, scale = 1, moving = true } or null to hide that ship.
    // sea: a world from seaWorld/coastWorld (ships ride its waves and leave wakes); omit on a river.
    pose(t, place, { sea = null, y = 0, sway = 1 } = {}) {
      const hAt = sea?.sea ? (x, z) => sea.sea.height(x, z, t) : () => y;
      const wakes = sea?.water?.userData?.ships;
      for (let i = 0; i < n; i++) {
        const a = place(i), st = state[i];
        if (!a) { hull.setMatrixAt(i, zero); sails.setMatrixAt(i, zero); st.on = false; for (let j = 0; j < nl; j++) lampPos[(i * nl + j) * 3 + 1] = -999; continue; }
        const sc = a.scale ?? 1, L = J.length * sc, hd = a.heading ?? 0, fx = Math.sin(hd), fz = Math.cos(hd);
        const hb = hAt(a.x + fx * L * 0.38, a.z + fz * L * 0.38), hs = hAt(a.x - fx * L * 0.38, a.z - fz * L * 0.38);
        const hr = hAt(a.x + fz * J.beam * 0.4 * sc, a.z - fx * J.beam * 0.4 * sc), hl = hAt(a.x - fz * J.beam * 0.4 * sc, a.z + fx * J.beam * 0.4 * sc);
        // a heavy hull follows the long swell, not every ripple: damped pitch and roll plus a slow roll of its own
        eu.set(Math.atan2(hs - hb, L * 0.76) * 0.55 * sway, hd, (Math.atan2(hr - hl, J.beam * 0.8 * sc) * 0.35 + Math.sin(t * 0.55 + i * 2.1) * 0.022) * sway);
        q.setFromEuler(eu);
        const yy = (hb + hs + hr + hl) / 4 * 0.6 + (a.y ?? 0);
        p.set(a.x, yy, a.z); s.setScalar(sc);
        m.compose(p, q, s);
        hull.setMatrixAt(i, m); sails.setMatrixAt(i, m);
        Object.assign(st, { x: a.x, y: yy, z: a.z, heading: hd, scale: sc, on: true });
        for (let j = 0; j < nl; j++) { v.set(...J.lanterns[j]).applyMatrix4(m); lampPos[(i * nl + j) * 3] = v.x; lampPos[(i * nl + j) * 3 + 1] = v.y; lampPos[(i * nl + j) * 3 + 2] = v.z; }
        if (wakes) wakes.push([a.x, a.z, hd, L * (a.moving === false ? -1 : 1)]);
      }
      hull.instanceMatrix.needsUpdate = sails.instanceMatrix.needsUpdate = true;
      lampGeo.attributes.position.needsUpdate = true;
    },
    // a point on ship i given in the ship's own frame (deck positions for crew, flags, lamps)
    at(i, local) { const st = state[i]; eu.set(0, st.heading, 0); return v.set(...local).multiplyScalar(st.scale).applyEuler(eu).add(p.set(st.x, st.y, st.z)).clone(); },
  };
}

// Slots for ships sailing in company: columns abreast, flagship (index 0) ahead in the middle.
// Returns [[across, along, scale], …] — across/along in metres relative to the flagship.
export function formation(n, { cols = 5, gapX = 150, gapZ = 190, jitter = 0.28, seed = 11, scale = [0.72, 1] } = {}) {
  const r = rng(seed), out = [[0, 0, 1]];
  for (let i = 1; i < n; i++) {
    const row = Math.floor((i - 1) / cols) + 1, c = (i - 1) % cols - (cols - 1) / 2;
    out.push([(c + (row % 2 ? 0.5 : 0) + (r() - 0.5) * jitter * 2) * gapX, -(row + (r() - 0.5) * jitter * 2) * gapZ - Math.abs(c) * gapZ * 0.25, lerp(scale[0], scale[1], r())]);
  }
  return out;
}
