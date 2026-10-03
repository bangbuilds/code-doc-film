// Example scene: one river, three shots. Copy this file, rename it, and change what is in
// setup() and shots{} — the shot ids must match the "shots" listed for the frame in film.json.
import { THREE, LOOKS, createColumn, createPontoon, polyPath, pinAt, windowAlpha, fx } from '../film/kit.js';
import { riverWorld } from '../film/worlds.js';
import { createTorchReflections } from '../film/props.js';

export default {
  // Build everything once. Return the worlds in `worlds` so the engine can free them later.
  setup() {
    const W = riverWorld({ name: '某条河', seed: 7, halfWidth: 70, water: 'calm', palette: 'green', trees: { count: 6000 } });
    const A = W.river.bank(-1, -20, 2), B = W.river.bank(1, 20, 2);          // the two bridgeheads
    const pontoon = createPontoon({ from: A, to: B, boats: 14 });
    W.scene.add(pontoon);
    // walk on the deck when over the bridge, on the ground elsewhere
    const y = (x, z) => (pontoon.userData.on(x, z) ? pontoon.userData.deckY : Math.max(W.H(x, z), pontoon.userData.deckY));
    const path = polyPath([[-300, -160], [A[0] - 20, -30], A, [0, 0], B, [B[0] + 20, 30], [300, 160]], y, 0.05);
    const day = createColumn(W.scene, 120);
    const night = createColumn(W.scene, 120, { torches: true });
    const refl = createTorchReflections(W.scene, 120);
    const mist = fx.mist([0, 3, 0], [200, 3, 400]);
    W.scene.add(mist);
    return { worlds: [W], W, pontoon, path, day, night, refl, mist };
  },
  shots: {
    // c = { t, lt, dur, k, S, cue(i), shot, frame, map, geo } — see film/frame.js
    dawn({ t, k, S }) {
      const { W } = S;
      W.tick(t); S.mist.userData.update(t);
      W.look(LOOKS.morning);
      S.day.hide(); S.night.hide(); S.refl.visible = false; S.mist.visible = true;
      // camera keyframes in normalised shot time (0 → 1): they survive any change in narration length
      W.track(k, { pos: [[0, [60, 8, -90]], [1, [40, 10, -70]]], at: [[0, [0, 2, 0]], [1, [-10, 2, 6]]] }, 38);
      return { world: W, post: { exposure: 1.0, bloom: 0.5, sat: 0.75 } };
    },
    crossing({ t, lt, k, S }) {
      const { W } = S;
      W.tick(t); S.mist.userData.update(t);
      W.look(LOOKS.morning);
      S.night.hide(); S.refl.visible = false; S.mist.visible = true;
      S.day.pose(t, S.path, { head: 0.45 + lt * 0.01, spacing: 3.5, lanes: 2 });
      W.track(k, { pos: [[0, [40, 10, -70]], [1, [26, 7, -46]]], at: [[0, [-10, 2, 6]], [1, [-16, 2, 4]]] }, 38);
      return { world: W, post: { exposure: 1.0, bloom: 0.5, sat: 0.75 }, pins: [pinAt(W.camera, [0, 4, 0], '浮桥', windowAlpha(lt, 0.4, 3, 0.3, 0.3), 'gold')] };
    },
    torches({ t, k, S }) {
      const { W } = S;
      W.tick(t);
      W.look(LOOKS.moon);
      S.day.hide(); S.mist.visible = false; S.refl.visible = true;
      const head = 0.62 + t * 0.002, gap = 3.6;
      S.night.pose(t, S.path, { head, spacing: gap, lanes: 2 });
      W.track(k, { pos: [[0, [200, 120, -200]], [1, [160, 130, -250]]], at: [[0, [0, 0, 10]], [1, [-40, 0, 0]]] }, 40);
      // reflections need the camera, so pose them after the camera is set
      S.refl.userData.pose(t, W.camera, (i) => { const p = S.path(head - Math.floor(i / 2) * gap / S.path.meters); return S.pontoon.userData.on(p.x, p.z) ? p : null; });
      return { world: W, post: { exposure: 1.2, bloom: 1.0, bloomThreshold: 0.55, sat: 0.8 } };
    },
  },
};
