// 古里：棕榈海岸，沙滩上的集市，船队泊在外面，小船往来。
import { THREE, LOOKS, rng, createCrowd } from '../film/kit.js';
import { coastWorld } from '../film/worlds.js';
import { createFleet } from '../film/sea.js';
import { addFlatHouses, createStalls } from '../film/props.js';
import { createBoat } from '../film/figures.js';

const CIV = { uniform: '#9a8462', gear: '#3a3026', wrap: '#8a7a5c', rifle: false, pack: false, robe: true, hat: 'turban', hatColor: '#e2d8c4' };

export default {
  setup() {
    const market = (x, y, z) => (Math.abs(x) < 210 && y < 6.5) || (x > -300 && x < -150 && y < 9);     // 集市和机位附近不长树
    const W = coastWorld({ name: '古里', seed: 63, sea: { deep: '#0b3542', shallow: '#33968c', foam: 0.25, amp: 0.4, chop: 0.9 }, wind: -1.4, bay: { width: 800, depth: 80 }, flat: 230, beach: [3, 70],
      hills: { h: 70, hVar: 50, run: 520 }, palette: 'tropic',
      trees: [{ shape: 'palm', count: 4200, scale: [8, 14], minY: 2.7, maxY: 14, maxSlope: 0.5, clear: market },
        { count: 9000, color: '#2f5a2c', scale: [6, 12], minY: 10 }] });
    const at = (x, d) => { const [px, pz] = W.coast.inland(x, d); return [px, W.H(px, pz), pz]; };
    addFlatHouses(W.scene, 150, (i, rr) => { const x = -420 + rr() * 840, d = 122 + rr() * rr() * 120; return at(x, x > -330 && x < -130 ? d + 70 : d); }, { seed: 37, wall: '#c2a982', domes: 0.03, towers: 0.02, size: 0.9 });      // 机位一带的房子往后退
    createStalls(W.scene, 64, (i, rr) => { const [x, y, z] = at(-190 + (i % 16) * 25 + (rr() - 0.5) * 8, 44 + Math.floor(i / 16) * 17 + rr() * 3); return [x, y, z, (rr() - 0.5) * 0.4]; });
    createCrowd(W.scene, 420, (i, rr) => { const [x, y, z] = at(-200 + rr() * 400, 36 + rr() * 70); return [x, y, z, rr() * 6.28]; }, { seed: 12, figure: CIV });
    const sz = W.coast.shore(0);
    const fleet = createFleet(W.scene, 16, { length: 60, masts: 5, seed: 9 });
    const r = rng(41);
    const berth = [...Array(16)].map((_, i) => ({ x: -420 + (i % 6) * 160 + (r() - 0.5) * 60, z: sz + 150 + Math.floor(i / 6) * 150 + (r() - 0.5) * 40, sc: 0.75 + r() * 0.25 }));
    const boats = [...Array(7)].map((_, i) => { const b = createBoat(); b.scale.setScalar(1.3); W.scene.add(b); return b; });
    return { worlds: [W], W, fleet, berth, boats, sz, at };
  },
  shots: {
    // 从海上看过去：船、沙滩集市、棕榈林
    harbor({ t, k, S }) {
      const { W, sz } = S;
      W.tick(t); W.look({ ...LOOKS.tropic, sunDir: [0.5, 0.6, 0.62] }, new THREE.Vector3(0, 0, sz - 60));
      S.fleet.furl(1);
      S.fleet.pose(t, (i) => ({ x: S.berth[i].x, z: S.berth[i].z, heading: 2.0, scale: S.berth[i].sc, moving: false }), { sea: W });
      S.boats.forEach((b, i) => { const ph = ((t * 1.4 + i * 31) % 150) / 150, z = sz + 14 + (i % 2 ? ph : 1 - ph) * 190; b.position.set(-150 + i * 52, W.sea.height(-150 + i * 52, z, t) + 0.1, z); b.rotation.y = Math.PI / 2; });
      W.track(k, { pos: [[0, [-250, 20, sz + 330]], [1, [-200, 15, sz + 260]]], at: [[0, [10, 9, sz - 60]], [1, [30, 9, sz - 60]]] }, 40);
      return { world: W, post: { exposure: 1.0, bloom: 0.4, bloomThreshold: 0.88, sat: 1.0 } };
    },
    // 集市：货摊、人群，海上是泊着的船
    trade({ t, k, S }) {
      const { W, sz, at } = S;
      W.tick(t); W.look({ ...LOOKS.tropic, sunDir: [-0.55, 0.6, 0.55] }, new THREE.Vector3(0, 3, sz - 60));
      S.fleet.furl(1);
      S.fleet.pose(t, (i) => ({ x: S.berth[i].x, z: S.berth[i].z, heading: 2.0, scale: S.berth[i].sc, moving: false }), { sea: W });
      S.boats.forEach((b, i) => { const ph = ((t * 1.4 + i * 31) % 150) / 150, z = sz + 14 + (i % 2 ? ph : 1 - ph) * 190; b.position.set(-150 + i * 52, W.sea.height(-150 + i * 52, z, t) + 0.1, z); b.rotation.y = Math.PI / 2; });
      const a = at(-250, 118), b = at(-215, 108);
      W.track(k, { pos: [[0, [a[0], a[1] + 17, a[2]]], [1, [b[0], b[1] + 13, b[2]]]], at: [[0, [-20, 2, sz - 40]], [1, [10, 2, sz - 34]]] }, 40);
      return { world: W, post: { exposure: 1.0, bloom: 0.4, bloomThreshold: 0.88, sat: 1.05 } };
    },
  },
};
