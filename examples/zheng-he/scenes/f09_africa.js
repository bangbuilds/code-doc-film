// 非洲东岸：稀树草原的海岸，船队泊在外面；岸上，一头长颈鹿。
import { THREE, LOOKS, rng, createCrowd } from '../film/kit.js';
import { coastWorld } from '../film/worlds.js';
import { createFleet } from '../film/sea.js';
import { createGiraffe } from '../film/props.js';

const CIV = { uniform: '#6a5a44', gear: '#3a3026', wrap: '#8a7a5c', rifle: false, pack: false, robe: true, hat: 'conical', hatColor: '#c8b078' };

export default {
  setup() {
    const GX = 40, GD = 52;
    const W = coastWorld({ name: '麻林', seed: 83, sea: { deep: '#0b3542', shallow: '#33968c', foam: 0.3, amp: 0.5, chop: 0.9 }, wind: -1.3, bay: { width: 900, depth: 50 }, flat: 520, beach: [2.6, 80],
      hills: { h: 45, hVar: 30, run: 900 },
      palette: 'savanna',
      trees: [{ shape: 'acacia', count: 520, scale: [10, 17], minY: 2.7, maxY: 40, maxSlope: 0.4, clear: (x, y, z) => Math.abs(x - GX) < 46 && y < 9 }] });
    const at = (x, d) => { const [px, pz] = W.coast.inland(x, d); return [px, W.H(px, pz), pz]; };
    const g = at(GX, GD);
    const giraffe = createGiraffe();
    giraffe.position.set(...g); giraffe.rotation.y = 1.25; W.scene.add(giraffe);
    createCrowd(W.scene, 12, (i, rr) => { const x = g[0] - 16 + rr() * 9, z = g[2] + 1 + rr() * 6; return [x, W.H(x, z), z, Math.atan2(g[0] - x, g[2] - z)]; }, { seed: 6, figure: CIV });
    const sz = W.coast.shore(0);
    const fleet = createFleet(W.scene, 14, { length: 60, masts: 5, seed: 13 });
    const r = rng(67);
    const berth = [...Array(14)].map((_, i) => ({ x: -420 + (i % 5) * 200 + (r() - 0.5) * 70, z: sz + 250 + Math.floor(i / 5) * 190 + (r() - 0.5) * 50, sc: 0.75 + r() * 0.25 }));
    return { worlds: [W], W, giraffe, fleet, berth, g, sz };
  },
  shots: {
    // 从海上靠近：船队、沙滩、金合欢树
    shore({ t, k, S }) {
      const { W, sz } = S;
      W.tick(t); W.look({ ...LOOKS.seaGolden, top: '#5a7ca6', horizon: '#f2d09a', sunDir: [0.75, 0.3, 0.55], fog: ['#e6c592', 0.0004], hemi: 0.7 }, new THREE.Vector3(0, 0, sz - 80));
      S.fleet.furl(1); S.giraffe.userData.update(t);
      S.fleet.pose(t, (i) => ({ x: S.berth[i].x, z: S.berth[i].z, heading: 2.1, scale: S.berth[i].sc, moving: false }), { sea: W });
      W.track(k, { pos: [[0, [330, 46, sz + 470]], [1, [270, 34, sz + 380]]], at: [[0, [-30, 8, sz - 80]], [1, [0, 8, sz - 80]]] }, 40);
      return { world: W, post: { exposure: 1.0, bloom: 0.5, bloomThreshold: 0.85, sat: 0.98 } };
    },
    // 逆着光：长颈鹿的剪影，身后是海和船
    giraffe({ t, k, S }) {
      const { W, g, sz } = S;
      W.tick(t); W.look({ ...LOOKS.seaGolden, top: '#5a7ca6', horizon: '#f2c98c', glow: 0.6, sunDir: [0.62, 0.12, 0.78], fog: ['#e8c38c', 0.0004], hemi: 0.8 }, new THREE.Vector3(g[0], g[1], g[2]));
      S.fleet.furl(1); S.giraffe.userData.update(t);
      S.fleet.pose(t, (i) => ({ x: S.berth[i].x, z: S.berth[i].z, heading: 2.1, scale: S.berth[i].sc, moving: false }), { sea: W });
      W.track(k, { pos: [[0, W.on(g[0] - 4, g[2] - 18, 1.6)], [1, W.on(g[0] - 2.5, g[2] - 14.5, 1.9)]], at: [[0, [g[0] - 1.2, g[1] + 2.9, g[2]]], [1, [g[0] - 0.8, g[1] + 3.1, g[2]]]] }, 38, undefined, { clear: 1.0 });
      return { world: W, post: { exposure: 1.0, bloom: 0.4, bloomThreshold: 0.9, sat: 1.0 } };
    },
  },
};
