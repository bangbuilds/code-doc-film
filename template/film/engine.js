// Shared engine: renderer + post chain, deterministic math (seeded noise, keyframes),
// sky dome, and small helpers. Everything renders from a time value — never a clock.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Output size. 16:9 → 1920×1080, 9:16 → 1080×1920, 1:1 → 1080×1080. Set once by film.js
// before anything is created; everything else reads VIEW.
export const VIEW = { W: 1920, H: 1080, get aspect() { return this.W / this.H; }, get portrait() { return this.H > this.W; } };
export function setView(w, h) { VIEW.W = w; VIEW.H = h; }

// QA collector: guards (camera lifted, view blocked, …) report here instead of failing silently.
// film.js resets `now` before each frame and shows it in QA builds; `all` accumulates for reports.
export const QA = {
  on: false, ctx: '', now: [], all: new Set(),
  reset(ctx) { this.ctx = ctx || ''; this.now = []; },
  warn(msg) { const m = this.ctx ? `[${this.ctx}] ${msg}` : msg; if (!this.now.includes(m)) this.now.push(m); this.all.add(m); },
};

// ── math ────────────────────────────────────────────────────────────────────
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = (t) => Math.pow(clamp(t), 3);
export const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const range = (t, a, b) => clamp((t - a) / (b - a));

// Mulberry32 — seeded RNG; the same seed always yields the same scene.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Integer hash → [0,1) (used for per-time-slot flicker, tracer picks, …)
export function hash1(n) {
  let x = (n | 0) * 374761393;
  x = (x ^ (x >>> 13)) * 1274126177;
  x = x ^ (x >>> 16);
  return ((x >>> 0) % 100000) / 100000;
}

// 2D value noise + fbm (seeded permutation table)
export function makeNoise(seed = 1) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256).map(() => r() * 2 - 1);
  const f = (t) => t * t * (3 - 2 * t);
  function n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = val[perm[(xi & 255) + perm[yi & 255]]];
    const b = val[perm[((xi + 1) & 255) + perm[yi & 255]]];
    const c = val[perm[(xi & 255) + perm[(yi + 1) & 255]]];
    const d = val[perm[((xi + 1) & 255) + perm[(yi + 1) & 255]]];
    const u = f(xf), v = f(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, y, oct = 5, lac = 2.0, gain = 0.5) {
    let s = 0, amp = 1, fr = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += amp * n2(x * fr, y * fr); norm += amp; amp *= gain; fr *= lac; }
    return s / norm;
  }
  function ridged(x, y, oct = 5) {
    let s = 0, amp = 1, fr = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += amp * (1 - Math.abs(n2(x * fr, y * fr))); norm += amp; amp *= 0.5; fr *= 2.03; }
    return s / norm;
  }
  return { n2, fbm, ridged };
}

// Keyframe track: keys = [[t, value(number|array)], …]; eased per segment.
export function track(keys, ease = easeInOut) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
      if (t <= t1) {
        const k = ease((t - t0) / (t1 - t0));
        return Array.isArray(v0) ? v0.map((x, j) => lerp(x, v1[j], k)) : lerp(v0, v1, k);
      }
    }
    return keys[keys.length - 1][1];
  };
}

// ── renderer + post ─────────────────────────────────────────────────────────
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.045 },
    uSat: { value: 0.82 },
    uTint: { value: new THREE.Vector3(1.03, 1.0, 0.94) },
    uFade: { value: 1.0 },       // 0 = black, 1 = picture
    uFadeColor: { value: new THREE.Vector3(0, 0, 0) },
    uRes: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uSat, uFade; uniform vec3 uTint, uFadeColor; uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(l), c, uSat) * uTint;
      c = c * 1.04 - 0.012;                      // gentle contrast
      vec2 q = vUv - 0.5; q.x *= min(1.35, uRes.x / uRes.y * 0.76);
      c *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(q));
      float g = h(floor(vUv * uRes) + floor(uTime * 24.0) * 17.13) - 0.5;
      c += g * uGrain;
      c = mix(uFadeColor, c, uFade);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(VIEW.W, VIEW.H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const W = VIEW.W, H = VIEW.H;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.6, 0.82);
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uRes.value.set(W, H);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(grade);
  return {
    renderer, composer, bloom, grade,
    render(scene, camera, t, opts = {}) {
      renderPass.scene = scene;
      renderPass.camera = camera;
      renderer.toneMappingExposure = opts.exposure ?? 1.0;
      bloom.strength = opts.bloom ?? 0.55;
      bloom.threshold = opts.bloomThreshold ?? 0.82;
      grade.uniforms.uTime.value = t;
      grade.uniforms.uFade.value = opts.fade ?? 1.0;
      grade.uniforms.uSat.value = opts.sat ?? 0.82;
      grade.uniforms.uVignette.value = opts.vignette ?? 0.55;
      if (opts.fadeColor) grade.uniforms.uFadeColor.value.set(...opts.fadeColor);
      else grade.uniforms.uFadeColor.value.set(0, 0, 0);
      composer.render();
    },
  };
}

// ── sky dome: gradient + sun/moon glow + drifting cloud bands ───────────────
export function createSky(radius = 4000) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#2b3a4a') },
      uHorizon: { value: new THREE.Color('#c9b79a') },
      uBottom: { value: new THREE.Color('#3a3530') },
      uSunDir: { value: new THREE.Vector3(0.3, 0.2, -1).normalize() },
      uSunColor: { value: new THREE.Color('#ffd9a0') },
      uSunSize: { value: 0.9994 },
      uGlow: { value: 0.6 },
      uCloud: { value: 0.55 },
      uCloudColor: { value: new THREE.Color('#9a9086') },
      uTime: { value: 0 },
      uStars: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor, uCloudColor; uniform float uSunSize, uGlow, uCloud, uTime, uStars;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = y > 0.0 ? mix(uHorizon, uTop, pow(clamp(y,0.0,1.0), 0.55)) : mix(uHorizon, uBottom, pow(clamp(-y*3.0,0.0,1.0),0.7));
        float sd = dot(d, normalize(uSunDir));
        col += uSunColor * uGlow * (pow(max(sd,0.0), 12.0) * 0.35 + pow(max(sd,0.0), 200.0) * 0.8);
        col = mix(col, uSunColor * 1.6, smoothstep(uSunSize, uSunSize + 0.0004, sd));
        if (y > 0.0) {
          vec2 uv = d.xz / (y + 0.12) * 1.3 + vec2(uTime * 0.012, uTime * 0.004);
          float c = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.35, fbm(uv));
          vec3 cc = uCloudColor * (0.85 + 0.35 * pow(max(sd,0.0), 4.0));
          col = mix(col, cc, c * smoothstep(0.0, 0.18, y) * 0.9);
          float st = step(0.9975, hash(floor(d.xz / (y+0.2) * 420.0))) * uStars * smoothstep(0.05, 0.4, y);
          col += vec3(st);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function setSky(sky, o) {
  const u = sky.material.uniforms;
  if (o.top) u.uTop.value.set(o.top);
  if (o.horizon) u.uHorizon.value.set(o.horizon);
  if (o.bottom) u.uBottom.value.set(o.bottom);
  if (o.sunDir) u.uSunDir.value.copy(o.sunDir).normalize();
  if (o.sunColor) u.uSunColor.value.set(o.sunColor);
  if (o.sunSize != null) u.uSunSize.value = o.sunSize;
  if (o.glow != null) u.uGlow.value = o.glow;
  if (o.cloud != null) u.uCloud.value = o.cloud;
  if (o.cloudColor) u.uCloudColor.value.set(o.cloudColor);
  if (o.stars != null) u.uStars.value = o.stars;
}

// Mix two hex colors (for lighting transitions between shots)
export function mixColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), clamp(t));
}

// Canvas texture helper (procedural, synchronous)
export function canvasTexture(w, h, draw, repeat = null) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(...repeat); }
  return tex;
}

// Project a world point to overlay pixel coords (for DOM labels pinned to 3D)
const _v = new THREE.Vector3();
export function toScreen(camera, x, y, z) {
  _v.set(x, y, z).project(camera);
  return { x: (_v.x * 0.5 + 0.5) * VIEW.W, y: (-_v.y * 0.5 + 0.5) * VIEW.H, visible: _v.z < 1 && _v.z > -1 };
}
