// 长乐太平港：船队泊在湾里候风（黄昏，灯火）；东北季风起，升帆出海（清晨）。
import { THREE, LOOKS, smooth, hash1, rng } from '../film/kit.js';
import { coastWorld } from '../film/worlds.js';
import { createFleet } from '../film/sea.js';
import { addHouses, createPier, createFlagPole, createTorchReflections } from '../film/props.js';

const N = 26;

export default {
  setup() {
    const W = coastWorld({ name: '太平港', seed: 31, sea: 'harbor', wind: 1.2, bay: { width: 430, depth: 300 }, flat: 100, hills: { h: 170, hVar: 90, run: 280 }, palette: 'quay',
      trees: { count: 9000, color: '#3a5a30', scale: [5, 10], minY: 7, maxSlope: 1.6, clear: (x, y, z) => y < 9 } });
    const fleet = createFleet(W.scene, N, { length: 60, masts: 5, lanterns: true });
    const r = rng(8);
    const berth = [...Array(N)].map((_, i) => ({ x: ((i % 6) - 2.5) * 105 + (r() - 0.5) * 40, z: -150 + Math.floor(i / 6) * 120 + (r() - 0.5) * 40, sc: 0.75 + r() * 0.25, delay: r() * 2.2 + Math.floor(i / 6) * 0.2 }));
    // town on the flat behind the beach, three piers
    addHouses(W.scene, 46, (i, rr) => { const x = -330 + (i % 23) * 29 + (rr() - 0.5) * 8, d = 34 + Math.floor(i / 23) * 24 + rr() * 6; const [px, pz] = W.coast.inland(x, d); return [px, W.H(px, pz), pz, Math.PI + (rr() - 0.5) * 0.3]; }, { wall: '#4a4038', roof: '#25282a' });
    const flags = [];
    for (const x of [-170, 0, 170]) {
      const [sx, sz] = W.coast.inland(x, 6);
      W.scene.add(createPier({ from: [sx, sz], to: [sx, sz + 70], width: 6, y: 1.5 }));
      const f = createFlagPole(14, x === 0 ? '#c9a23f' : '#b3261e');
      const [fx, fz] = W.coast.inland(x + 14, 16); f.position.set(fx, W.H(fx, fz), fz); f.rotation.y = -0.9; W.scene.add(f); flags.push(f);
    }
    {                                                        // 镜头前的一面大旗：风一来它先动
      const f = createFlagPole(24, '#b3261e', 10, 5.6);
      f.position.set(-262, W.H(-262, -300), -300); f.rotation.y = -1.1; W.scene.add(f); flags.push(f);
    }
    const refl = createTorchReflections(W.scene, N * 2, { waterY: 0.15, length: 34, opacity: 0.4 });
    return { worlds: [W], W, fleet, berth, flags, refl };
  },
  shots: {
    // 黄昏：帆落下，灯点起来，旗子垂着
    anchor({ t, k, S }) {
      const { W } = S;
      W.tick(t); W.look({ ...LOOKS.seaDusk, sunDir: [-0.96, 0.06, -0.25], fog: ['#7b5a4e', 0.0007], hemi: 0.42 });
      S.fleet.furl(1); S.fleet.lamps(1);
      S.fleet.pose(t, (i) => ({ x: S.berth[i].x, z: S.berth[i].z, heading: 0.55 + hash1(i) * 0.12, scale: S.berth[i].sc, moving: false }), { sea: W });
      S.flags.forEach((f) => f.userData.update(t, 0.08));
      W.track(k, { pos: [[0, [330, 9, 470]], [1, [270, 13, 420]]], at: [[0, [-40, 14, -160]], [1, [-60, 14, -200]]] }, 40);
      S.refl.visible = true;
      S.refl.userData.pose(t, W.camera, (i) => { const st = S.fleet.state[i >> 1]; return st.on ? new THREE.Vector3(st.x + (i & 1 ? 6 : -6), 0, st.z + (i & 1 ? -22 : 20) * st.scale) : null; });
      return { world: W, post: { exposure: 1.1, bloom: 0.9, bloomThreshold: 0.6, sat: 0.85 } };
    },
    // 清晨起风：旗子展开，帆升起，船一艘接一艘驶出海湾
    sail({ t, lt, k, S }) {
      const { W } = S;
      W.tick(t); W.look({ ...LOOKS.seaDay, sunDir: [-0.55, 0.5, -0.6] }, new THREE.Vector3(-150, 0, -230));
      S.refl.visible = false; S.fleet.lamps(0);
      S.fleet.furl(1 - smooth(lt / 1.8));
      S.fleet.pose(t, (i) => {
        const b = S.berth[i], go = Math.max(0, lt - b.delay), d = go * go * 0.9 / (1 + go * 0.25);       // ease away from the berth
        return { x: b.x + d * 0.22, z: b.z + d, heading: 0.55 * (1 - smooth(go / 2.5)) + 0.2, scale: b.sc, moving: go > 0.3 };
      }, { sea: W });
      S.flags.forEach((f) => f.userData.update(t, 0.25 + 0.75 * smooth(lt / 1.2)));
      W.track(k, { pos: [[0, [-250, 34, -370]], [1, [-235, 46, -350]]], at: [[0, [20, 8, 60]], [1, [40, 6, 160]]] }, 42);
      return { world: W, post: { exposure: 1.0, bloom: 0.5, bloomThreshold: 0.85, sat: 0.95 } };
    },
  },
};
