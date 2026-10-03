// 锡兰山：海边立着一块石碑，三种字迹；背后山上是佛寺的白塔。
import { THREE, LOOKS, rng, createCrowd } from '../film/kit.js';
import { coastWorld } from '../film/worlds.js';
import { createFleet } from '../film/sea.js';
import { createStele, createStupa } from '../film/props.js';

const CIV = { uniform: '#7a6a50', gear: '#3a3026', wrap: '#8a7a5c', rifle: false, pack: false, robe: true, hat: 'conical', hatColor: '#c8b078' };

export default {
  setup() {
    const SX = 0, SD = 30;
    const W = coastWorld({ name: '锡兰山', seed: 52, sea: { deep: '#0b3542', shallow: '#2f9088', foam: 0.3, amp: 0.55, chop: 0.9 }, wind: -1.2, bay: { width: 380, depth: 40 }, flat: 70, beach: [5, 34],
      hills: { h: 95, hVar: 60, run: 240 }, palette: 'tropic',
      trees: [{ shape: 'palm', count: 1500, scale: [8, 13], minY: 4, maxY: 20, maxSlope: 0.6, clear: (x, y, z) => Math.abs(x - SX) < 34 },
        { count: 9000, color: '#2f5a2c', scale: [6, 12], minY: 14, clear: (x, y, z) => Math.hypot(x + 150, z + 250) < 48 }] });
    const [sx, sz] = W.coast.inland(SX, SD), sy = W.H(sx, sz);
    const stele = createStele();
    stele.scale.setScalar(1.3); stele.position.set(sx, sy, sz); W.scene.add(stele);
    const stupa = createStupa({ r: 15 });
    stupa.position.set(-150, W.H(-150, -250) - 1, -250); W.scene.add(stupa);
    const fleet = createFleet(W.scene, 10, { length: 60, masts: 5, seed: 7 });
    const r = rng(31);
    const berth = [...Array(10)].map((_, i) => ({ x: -300 + (i % 5) * 150 + (r() - 0.5) * 50, z: W.coast.shore(0) + 170 + Math.floor(i / 5) * 170 + (r() - 0.5) * 40, sc: 0.75 + r() * 0.25 }));
    createCrowd(W.scene, 16, (i, rr) => { const a = (i % 2 ? 1 : -1) * (1.25 + rr() * 0.75), d = 6 + rr() * 5; const x = sx + Math.sin(a) * d, z = sz + Math.cos(a) * d + 1; return [x, W.H(x, z), z, Math.atan2(sx - x, sz - z)]; }, { seed: 3, figure: CIV });
    return { worlds: [W], W, stele, fleet, berth, sx, sy, sz };
  },
  shots: {
    // 贴近石碑，慢慢绕
    stele({ t, k, S }) {
      const { W, sx, sy, sz } = S;
      W.tick(t); W.look({ ...LOOKS.tropic, sunDir: [0.5, 0.5, 0.7] }, new THREE.Vector3(sx, sy, sz));
      S.fleet.furl(1);
      S.fleet.pose(t, (i) => ({ x: S.berth[i].x, z: S.berth[i].z, heading: 1.9, scale: S.berth[i].sc, moving: false }), { sea: W });
      W.track(k, { pos: [[0, [sx + 2.4, sy + 0.9, sz + 5.0]], [1, [sx - 0.9, sy + 1.05, sz + 3.9]]], at: [[0, [sx, sy + 1.35, sz]], [1, [sx, sy + 1.45, sz]]] }, 38, undefined, { clear: 0.5 });
      return { world: W, post: { exposure: 1.0, bloom: 0.35, bloomThreshold: 0.9, sat: 0.98 } };
    },
    // 拉开：碑在岸上，船在海里，塔在山上
    coast({ t, k, S }) {
      const { W, sx, sy, sz } = S;
      W.tick(t); W.look({ ...LOOKS.seaGolden, top: '#5a7ca6', horizon: '#f2cf98', sunDir: [0.8, 0.22, 0.55], fog: ['#e6c592', 0.0004], hemi: 0.75 }, new THREE.Vector3(sx, sy, sz));
      S.fleet.furl(1);
      S.fleet.pose(t, (i) => ({ x: S.berth[i].x, z: S.berth[i].z, heading: 1.9, scale: S.berth[i].sc, moving: false }), { sea: W });
      W.track(k, { pos: [[0, [sx - 7, sy + 4.5, sz - 20]], [1, [sx - 11, sy + 8, sz - 31]]], at: [[0, [sx + 8, sy + 1.2, sz + 120]], [1, [sx + 8, sy + 0.5, sz + 160]]] }, 38);
      return { world: W, post: { exposure: 1.0, bloom: 0.5, bloomThreshold: 0.85, sat: 0.95 } };
    },
  },
};
