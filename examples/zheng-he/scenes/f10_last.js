// 最后一次：黄昏里远去的船队 → 夜色中点着灯归来 → 空了的海（和开场呼应）。
import { LOOKS, smooth } from '../film/kit.js';
import { seaWorld } from '../film/worlds.js';
import { createFleet, formation } from '../film/sea.js';

const SPEED = 3.0;

export default {
  setup() {
    const W = seaWorld({ name: '印度洋', wind: -2.0 });
    const fleet = createFleet(W.scene, 40, { length: 64, masts: 5, lanterns: true });
    const slots = formation(40, { cols: 5, gapX: 180, gapZ: 220, seed: 21 });
    return { worlds: [W], W, fleet, slots };
  },
  shots: {
    // 跟在船队后面，看它们驶向落日
    dusk({ t, k, S }) {
      const { W } = S;
      W.tick(t); W.look({ ...LOOKS.seaGolden, sunDir: [-0.3, 0.085, -1], glow: 0.5 });
      const z0 = -900 - SPEED * t;
      S.fleet.furl(0); S.fleet.lamps(0);
      S.fleet.pose(t, (i) => { const [ac, al, sc] = S.slots[i]; return { x: -ac, z: z0 - al, heading: Math.PI, scale: sc }; }, { sea: W });
      W.track(k, { pos: [[0, [110, 13, 420]], [1, [100, 24, 520]]], at: [[0, [-60, 14, -600]], [1, [-60, 8, -600]]] }, 40);
      return { world: W, post: { exposure: 1.0, bloom: 0.45, bloomThreshold: 0.88, sat: 0.92 } };
    },
    // 归航：天快黑了，船上点起灯，迎面驶来
    home({ t, k, S }) {
      const { W } = S;
      W.tick(t); W.look({ ...LOOKS.seaDusk, sunDir: [0.3, -0.02, -1], glow: 0.7, fog: ['#7a5a52', 0.0006], hemi: 0.45, waterLight: 0.75 });
      const z0 = -620 + SPEED * t;
      S.fleet.furl(0); S.fleet.lamps(1);
      S.fleet.pose(t, (i) => { const [ac, al, sc] = S.slots[i]; return { x: ac, z: z0 + al, heading: 0, scale: sc }; }, { sea: W });
      W.track(k, { pos: [[0, [-170, 10, -300]], [1, [-150, 16, -240]]], at: [[0, [40, 14, -900]], [1, [30, 12, -900]]] }, 40);
      return { world: W, post: { exposure: 1.1, bloom: 0.9, bloomThreshold: 0.62, sat: 0.88 } };
    },
    // 海上什么都没有了
    empty({ t, lt, k, S }) {
      const { W } = S;
      W.tick(t); W.look({ ...LOOKS.seaDusk, sunDir: [0.3, -0.04, -1], glow: 0.6, fog: ['#6a4f4c', 0.0006], hemi: 0.35, waterLight: 0.66 });
      S.fleet.hide(); S.fleet.lamps(0);
      W.track(k, { pos: [[0, [0, 6, 300]], [1, [0, 9, 340]]], at: [[0, [60, 5, -600]], [1, [60, 8, -600]]] }, 36);
      return { world: W, post: { exposure: 1.0, bloom: 0.6, bloomThreshold: 0.75, sat: 0.85 } };
    },
  },
};
