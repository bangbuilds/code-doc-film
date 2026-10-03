// 南京龙江：江边宝船厂，船泊在岸边和江心（晨雾）；随后升帆顺江而下。
import { THREE, LOOKS, smooth, rng, fx, createCrowd } from '../film/kit.js';
import { riverWorld } from '../film/worlds.js';
import { createFleet } from '../film/sea.js';
import { createPier, createFlagPole } from '../film/props.js';
import { createBuilding } from '../film/figures.js';

const CIV = { uniform: '#5c4d3c', gear: '#3a3026', wrap: '#8a7a5c', rifle: false, pack: false, robe: true, hat: 'conical', hatColor: '#c8b078' };
const BANK = -380, NA = 9, NB = 36;                       // 左岸水线；岸边 9 艘，江心 36 艘

export default {
  setup() {
    const W = riverWorld({ name: '龙江', seed: 12, halfWidth: 380, waterHalfWidth: 470, bed: [-6, 4], bank: [3, 10],
      water: { speed: 0.9, deep: '#27352f', shallow: '#52624f', foam: 0.04, amp: 0.45 },
      shelfW: (s, side) => (side < 0 ? 240 : 70), shelfH: 3, wall: { h: 40, hVar: 30, run: 460 }, size: [2800, 3800], palette: 'quay',
      trees: { count: 9000, color: '#3a5530', scale: [5, 10], minY: 3.5, clear: (x, y, z) => x < BANK && x > -660 && Math.abs(z) < 760 } });
    const quay = createFleet(W.scene, NA, { length: 62, masts: 5, seed: 4 });
    const fleet = createFleet(W.scene, NB, { length: 60, masts: 5, seed: 6 });
    const r = rng(17);
    const mid = [...Array(NB)].map((_, i) => ({ x: -200 + (i % 4) * 135 + (r() - 0.5) * 30, z: -900 + Math.floor(i / 4) * 200 + (r() - 0.5) * 40, sc: 0.78 + r() * 0.22 }));
    const flags = [];
    for (let i = 0; i < NA; i++) {
      const z = -430 + i * 108;
      W.scene.add(createPier({ from: [BANK - 14, z + 54], to: [BANK + 24, z + 54], width: 5, y: 1.4 }));
      if (i % 2 === 0) { const f = createFlagPole(13, i % 4 ? '#b3261e' : '#c9a23f'); f.position.set(BANK - 22, W.H(BANK - 22, z + 60), z + 60); f.rotation.y = 0.5; W.scene.add(f); flags.push(f); }
    }
    for (let i = 0; i < 11; i++) {                          // 船厂的长屋，沿岸一排、后面一排
      const b = createBuilding({ w: 44, d: 15, wallH: 6, roofH: 4.2, wall: '#5a4636', roof: '#2a2a2b' });
      const x = BANK - 78 - (i % 2) * 56, z = -450 + i * 92;
      b.position.set(x, W.H(x, z), z); b.rotation.y = Math.PI / 2 + 0.05; W.scene.add(b);
    }
    createCrowd(W.scene, 420, (i, rr) => { const x = BANK - 8 - rr() * rr() * 70, z = -470 + rr() * 980; return [x, W.H(x, z), z, 1.2 + rr() * 0.8]; }, { seed: 9, figure: CIV });
    const mist = fx.mist([-40, 3, -100], [520, 3, 900], { count: 240, opacity: 0.16 });
    W.scene.add(mist);
    return { worlds: [W], W, quay, fleet, mid, flags, mist };
  },
  shots: {
    // 贴着码头向前看：一排宝船靠岸，岸上人来人往
    yard({ t, k, S }) {
      const { W } = S;
      W.tick(t); S.mist.visible = true; S.mist.userData.update(t);
      W.look({ ...LOOKS.morning, sunDir: [0.75, 0.3, 0.45], fog: ['#b9bdb9', 0.0011] }, new THREE.Vector3(BANK, 0, -300));
      S.quay.furl(1); S.fleet.furl(1);
      S.quay.pose(t, (i) => ({ x: BANK + 30, z: -430 + i * 108, heading: 0.03, moving: false }), { y: 0.25, sway: 0 });
      S.fleet.pose(t, (i) => ({ x: S.mid[i].x, z: S.mid[i].z, heading: 0.06, scale: S.mid[i].sc, moving: false }), { y: 0.25, sway: 0 });
      S.flags.forEach((f) => f.userData.update(t, 0.45));
      W.track(k, { pos: [[0, [BANK + 135, 30, -610]], [1, [BANK + 120, 36, -560]]], at: [[0, [BANK - 6, 8, -250]], [1, [BANK - 10, 8, -200]]] }, 40);
      return { world: W, post: { exposure: 1.05, bloom: 0.4, bloomThreshold: 0.85, sat: 0.82 } };
    },
    // 高处俯看：升帆，整支船队顺江而下
    river({ t, lt, k, S }) {
      const { W } = S;
      W.tick(t); S.mist.visible = false;
      W.look({ ...LOOKS.day, sunDir: [-0.5, 0.55, -0.55], fog: ['#c2cccd', 0.00032] });
      S.quay.furl(0); S.fleet.furl(0);
      const v = 2.6;
      S.quay.pose(t, (i) => ({ x: BANK + 30 + smooth(lt / 7) * 90, z: -430 + i * 108 + v * lt * 0.8, heading: 0.03 + 0.12 * Math.sin(Math.min(1, lt / 7) * Math.PI) }), { y: 0.25, sway: 0.4 });
      S.fleet.pose(t, (i) => ({ x: S.mid[i].x, z: S.mid[i].z + v * lt, heading: 0.04, scale: S.mid[i].sc }), { y: 0.25, sway: 0.4 });
      S.flags.forEach((f) => f.userData.update(t, 1));
      W.track(k, { pos: [[0, [-200, 62, -1130]], [1, [-170, 92, -1160]]], at: [[0, [10, 8, -520]], [1, [20, 4, -380]]] }, 40);
      return { world: W, post: { exposure: 1.0, bloom: 0.4, bloomThreshold: 0.88, sat: 0.9 } };
    },
  },
};
