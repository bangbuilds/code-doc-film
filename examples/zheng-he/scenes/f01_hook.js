// 开场：日出时的空海 → 镜头升起，一支大船队迎着朝阳向南（-z）行驶。
import { LOOKS } from '../film/kit.js';
import { seaWorld } from '../film/worlds.js';
import { createFleet, formation } from '../film/sea.js';

const HEADING = Math.PI, SPEED = 3.2;                    // 船头朝 -z；约 6 节
const POST = { exposure: 1.0, bloom: 0.55, bloomThreshold: 0.82, sat: 0.92 };

export default {
  setup() {
    const W = seaWorld({ name: '外洋', wind: -1.85 });
    const fleet = createFleet(W.scene, 62, { length: 64, masts: 5 });
    const slots = formation(62, { cols: 6, gapX: 170, gapZ: 210, seed: 5 });
    return { worlds: [W], W, fleet, slots };
  },
  shots: {
    // 贴着水面看日出，海上什么都没有
    empty({ t, k, S }) {
      const { W } = S;
      W.tick(t); W.look(LOOKS.seaDawn);
      S.fleet.hide();
      W.track(k, { pos: [[0, [0, 5, 300]], [1, [0, 7, 250]]], at: [[0, [70, 6, -600]], [1, [50, 6, -600]]] }, 36);
      return { world: W, post: POST };
    },
    // 62 艘：旗舰在最前（远处），镜头从船队后部升起
    fleet({ t, k, S }) {
      const { W } = S;
      W.tick(t); W.look(LOOKS.seaDawn);
      const z0 = -1250 - SPEED * t;
      S.fleet.furl(0);
      S.fleet.pose(t, (i) => { const [ac, al, sc] = S.slots[i]; return { x: -ac, z: z0 - al, heading: HEADING, scale: sc }; }, { sea: W });
      W.track(k, { pos: [[0, [-60, 26, 760]], [1, [-20, 150, 900]]], at: [[0, [190, 16, -200]], [1, [190, 0, -420]]] }, 42);
      return { world: W, post: POST };
    },
  },
};
