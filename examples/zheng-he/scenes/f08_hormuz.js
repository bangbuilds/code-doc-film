// 忽鲁谟斯：光秃秃的山，土色平顶的城，海边一支驼队，港里泊着宝船。
import { THREE, LOOKS, rng, polyPath } from '../film/kit.js';
import { coastWorld } from '../film/worlds.js';
import { createFleet } from '../film/sea.js';
import { addFlatHouses, createCaravan } from '../film/props.js';

export default {
  setup() {
    const W = coastWorld({ name: '忽鲁谟斯', seed: 71, sea: { deep: '#0c3a48', shallow: '#3a9a94', foam: 0.2, amp: 0.35, chop: 0.9 }, wind: 1.9, bay: { width: 620, depth: 110 }, flat: 190, beach: [3, 75],
      hills: { h: 330, hVar: 170, run: 230, base: 0.5, ridge: 0.9 },
      palette: 'arid', trees: null });
    const at = (x, d) => { const [px, pz] = W.coast.inland(x, d); return [px, W.H(px, pz), pz]; };
    addFlatHouses(W.scene, 260, (i, rr) => at(-190 + rr() * 520, 62 + rr() * rr() * 190), { seed: 61, size: 1.7, towers: 0.05, domes: 0.16 });
    const sz = W.coast.shore(0);
    const fleet = createFleet(W.scene, 12, { length: 60, masts: 5, seed: 11 });
    const r = rng(53);
    const berth = [...Array(12)].map((_, i) => ({ x: -160 + (i % 4) * 150 + (r() - 0.5) * 50, z: sz + 110 + Math.floor(i / 4) * 150 + (r() - 0.5) * 40, sc: 0.75 + r() * 0.25 }));
    const caravan = createCaravan(W.scene, 18);
    const pts = []; for (let x = -640; x <= 60; x += 70) pts.push(W.coast.inland(x, 26 + 5 * Math.sin(x * 0.02)));
    const path = polyPath(pts, W.H, 0.05);
    return { worlds: [W], W, fleet, berth, caravan, path, sz, at };
  },
  shots: {
    port({ t, k, S }) {
      const { W, sz } = S;
      W.tick(t); W.look({ ...LOOKS.seaGolden, top: '#5d7aa0', horizon: '#f0cf9c', sunDir: [-0.7, 0.24, 0.65], fog: ['#e3c191', 0.00042], hemi: 0.7 }, new THREE.Vector3(-200, 0, sz - 60));
      S.fleet.furl(1);
      S.fleet.pose(t, (i) => ({ x: S.berth[i].x, z: S.berth[i].z, heading: 0.9, scale: S.berth[i].sc, moving: false }), { sea: W });
      S.caravan.pose(t, S.path, { head: 0.665 + t * 0.0017, spacing: 6.5 });
      const c0 = W.coast.inland(-330, 6), c1 = W.coast.inland(-318, 8);
      W.track(k, { pos: [[0, [c0[0], W.H(...c0) + 3.2, c0[1]]], [1, [c1[0], W.H(...c1) + 4.4, c1[1]]]], at: [[0, [-120, 16, sz - 90]], [1, [-100, 18, sz - 96]]] }, 42);
      return { world: W, post: { exposure: 1.0, bloom: 0.5, bloomThreshold: 0.85, sat: 0.95 } };
    },
  },
};
