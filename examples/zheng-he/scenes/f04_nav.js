// 过洋牵星：白天的船队 → 舱里的水罗盘 → 夜里用牵星板量北辰星的高度。
import { THREE, LOOKS, pinAt, windowAlpha, smooth } from '../film/kit.js';
import { seaWorld, tabletop } from '../film/worlds.js';
import { createFleet, formation } from '../film/sea.js';
import { createCompass, createStarBoard, createOilLamp } from '../film/props.js';

const SPEED = 3.2, D2R = Math.PI / 180;

export default {
  setup() {
    const W = seaWorld({ name: '南海', wind: 2.0 });
    const fleet = createFleet(W.scene, 30, { length: 64, masts: 5 });
    const slots = formation(30, { cols: 4, gapX: 190, gapZ: 230, seed: 9 });

    const T = tabletop({ wood: '#4a321c' });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 7), new THREE.MeshStandardMaterial({ color: '#2a1f16', side: THREE.BackSide, roughness: 1 }));
    walls.position.y = 1.2; T.scene.add(walls);
    T.scene.add(new THREE.AmbientLight('#4a4038', 1.1));
    const win = new THREE.DirectionalLight('#cfe2ff', 1.5); win.position.set(1.5, 2.2, 0.8); T.scene.add(win);
    const compass = createCompass({ radius: 0.17 });
    T.scene.add(compass);
    const lamp = createOilLamp({ at: [-0.46, 0, -0.26], intensity: 1.4 });
    T.scene.add(lamp);

    const N = seaWorld({ name: '夜海', wind: 2.0, sea: { amp: 0.55, foam: 0.12, deep: '#06131f', shallow: '#17404e' } });
    const night = createFleet(N.scene, 12, { length: 64, masts: 5, seed: 8 });
    const board = createStarBoard({ size: 0.1 });
    N.scene.add(board);
    const glow = new THREE.CanvasTexture(Object.assign(document.createElement('canvas'), { width: 64, height: 64 }));
    { const g = glow.image.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(210,225,255,0.8)'); gr.addColorStop(1, 'rgba(160,190,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); glow.needsUpdate = true; }
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ffffff', blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    N.scene.add(star);
    return { worlds: [W, T, N], W, fleet, slots, T, compass, lamp, N, night, board, star };
  },
  shots: {
    // 贴着旗舰的侧后方跟拍
    day({ t, k, S }) {
      const { W } = S;
      W.tick(t); W.look({ ...LOOKS.seaDay, sunDir: [-0.6, 0.55, 0.55] });
      const z0 = SPEED * t;
      S.fleet.furl(0);
      S.fleet.pose(t, (i) => { const [ac, al, sc] = S.slots[i]; return { x: ac, z: z0 + al, heading: 0, scale: sc }; }, { sea: W });
      W.track(k, { pos: [[0, [-150, 20, z0 + 150]], [1, [-128, 27, z0 + 120]]], at: [[0, [10, 15, z0 - 60]], [1, [20, 13, z0 - 140]]] }, 40, (x) => x);
      return { world: W, post: { exposure: 1.0, bloom: 0.45, bloomThreshold: 0.88, sat: 0.95 } };
    },
    // 水罗盘：浮针晃了几下，停在南北向上
    compass({ t, lt, k, S }) {
      S.compass.userData.update(lt, 0.5);
      S.lamp.userData.update(t);
      S.T.track(k, { pos: [[0, [0.3, 0.46, 0.5]], [1, [0.2, 0.4, 0.36]]], at: [[0, [0, 0.02, 0.01]], [1, [0, 0.03, 0]]] }, 34);
      return { world: S.T, post: { exposure: 1.05, bloom: 0.5, bloomThreshold: 0.8, sat: 0.9, vignette: 0.7 } };
    },
    // 夜：牵星板下沿压着海平线，上沿对准北辰星
    stars({ t, lt, k, S }) {
      const { N } = S;
      N.tick(t); N.look(LOOKS.seaNight);
      S.night.furl(0); S.night.lamps(1);
      S.night.pose(t, (i) => ({ x: -260 + (i % 4) * 190 + (i * 37 % 60), z: -420 - Math.floor(i / 4) * 300 - SPEED * t, heading: Math.PI, scale: 0.8 }), { sea: N });
      const C = [0, 9, 0], half = Math.atan(0.05 / 0.7);                 // 板的半张角
      N.cam(C, [C[0] + Math.sin(0.1) * 100, C[1] + Math.tan((2.2 + 0.8 * k) * D2R) * 100, C[2] - Math.cos(0.1) * 100], 30);
      // 板从画面下方举起来，停住
      const lift = smooth(lt / 1.6), el = half * lift - (1 - lift) * 0.22;
      S.board.userData.place(N.camera, new THREE.Vector3(0, Math.sin(el), -Math.cos(el)).normalize(), 0.7);
      const sd = new THREE.Vector3(0, Math.sin(2 * half), -Math.cos(2 * half));
      S.star.position.set(C[0] + sd.x * 3000, C[1] + sd.y * 3000, C[2] + sd.z * 3000);
      S.star.scale.setScalar(40 * (0.9 + 0.1 * Math.sin(t * 5)));
      const a = windowAlpha(lt, 1.9, 99, 0.5, 0.3);
      return { world: N, post: { exposure: 1.15, bloom: 0.9, bloomThreshold: 0.6, sat: 0.9 },
        pins: [pinAt(N.camera, [S.star.position.x + 170, S.star.position.y + 30, S.star.position.z], '北辰星', a, 'gold'),
          pinAt(N.camera, [C[0] + 330, C[1] + 22, C[2] - 3000], '海平线', a, 'river')] };
    },
  },
};
