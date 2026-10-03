// 满剌加：海边的栅栏和仓库（官厂），船队泊在外面，货从栈桥运进去。
import { THREE, LOOKS, rng, createColumn, polyPath } from '../film/kit.js';
import { coastWorld } from '../film/worlds.js';
import { createFleet } from '../film/sea.js';
import { createDepot, createPier } from '../film/props.js';

const CIV = { uniform: '#6a5a44', gear: '#3a3026', wrap: '#8a7a5c', rifle: false, pack: false, robe: true, hat: 'conical', hatColor: '#c8b078' };

export default {
  setup() {
    const AX = -20, AD = 150;
    const inDepot = (x, y, z) => Math.abs(x - AX) < 125 && z > -440 && z < -180;      // 仓库区不长树（岸线在 z≈-150，仓库在其后 150 米）
    const W = coastWorld({ name: '满剌加', seed: 44, sea: { deep: '#0b3542', shallow: '#2f9088', foam: 0.1, amp: 0.3, chop: 0.8 }, wind: 0.9, bay: { width: 520, depth: 150 }, flat: 250, beach: [2.6, 55],
      hills: { h: 120, hVar: 70, run: 380 }, palette: 'tropic',
      trees: [{ shape: 'palm', count: 2600, scale: [8, 13], minY: 2.3, maxY: 16, maxSlope: 0.5, clear: (x, y, z) => inDepot(x, y, z) || (Math.abs(x - 60) < 22 && y < 5) },
        { count: 12000, color: '#2f5a2c', scale: [6, 12], minY: 9, clear: inDepot }] });
    const [ax, az] = W.coast.inland(AX, AD);
    const depot = createDepot({ at: [ax, az], w: 170, d: 112, groundY: W.H(ax, az) + 0.2 });
    W.scene.add(depot);
    const sz = W.coast.shore(60);
    W.scene.add(createPier({ from: [60, sz - 6], to: [60, sz + 85], width: 6, y: 1.5 }));
    const fleet = createFleet(W.scene, 14, { length: 60, masts: 5, seed: 5 });
    const r = rng(23);
    const berth = [...Array(14)].map((_, i) => ({ x: -420 + (i % 5) * 150 + (r() - 0.5) * 50, z: sz + 120 + Math.floor(i / 5) * 150 + (r() - 0.5) * 40, sc: 0.75 + r() * 0.25 }));
    const col = createColumn(W.scene, 70, { figure: CIV });
    const path = polyPath([[60, sz + 80], [60, sz - 10], [40, sz - 60], [ax + 6, az + 62]], (x, z) => (z > sz - 4 ? 1.65 : W.H(x, z)), 0.1);
    return { worlds: [W], W, depot, fleet, berth, col, path, ax, az, sz };
  },
  shots: {
    depot({ t, k, S }) {
      const { W } = S;
      W.tick(t); W.look({ ...LOOKS.tropic, sunDir: [0.55, 0.55, 0.6] }, new THREE.Vector3(S.ax, 0, S.az));
      S.fleet.furl(1);
      S.fleet.pose(t, (i) => ({ x: S.berth[i].x, z: S.berth[i].z, heading: 2.2, scale: S.berth[i].sc, moving: false }), { sea: W });
      S.col.pose(t, S.path, { head: 0.97 + t * 0.003, spacing: 3.2, lanes: 2, speed: 6, pitch: 0.12 });
      S.depot.userData.flag.userData.update(t, 0.8);
      W.track(k, { pos: [[0, [S.ax + 235, 46, S.sz + 95]], [1, [S.ax + 195, 34, S.sz + 60]]], at: [[0, [S.ax - 20, 6, S.az + 40]], [1, [S.ax - 20, 7, S.az + 30]]] }, 40);
      return { world: W, post: { exposure: 1.0, bloom: 0.4, bloomThreshold: 0.88, sat: 1.0 } };
    },
  },
};
