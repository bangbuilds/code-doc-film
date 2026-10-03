// Frame runner: turns one frame of film.json (shots with resolved times, stamp, callouts)
// plus its scene module into pictures and overlay state.
//
// A scene module (scenes/<name>.js) is:
//   export default {
//     setup({ map, geo, film }) → state      // build worlds/actors once; list worlds in state.worlds
//     shots: { <shotId>(c) → { world, post?, pins? } }
//   }
// where c = { t, lt, dur, k, S, cue(i), shot, frame, map, geo }:
//   t   seconds since the frame started        lt  seconds since this shot started
//   dur this shot's length                     k   lt / dur (0 → 1)
//   S   the state returned by setup()          cue(i)  start of narration cue i, in SHOT time
// Map shots (type "map") need no code — they are described in film.json and drawn here.
import { QA, smooth, lerp, easeOut, easeInOut, clamp } from './engine.js';
import { mapShot, fmt } from './kit.js';
import { windowAlpha } from './overlay.js';

const COLORS = { black: [0, 0, 0], mist: [0.72, 0.74, 0.74], white: [0.95, 0.95, 0.93], dark: [0.05, 0.06, 0.07] };
const rgb = (c) => (Array.isArray(c) ? c : COLORS[c] || [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255]);
// "in"/"out": "cut" | "black" | "mist" | { color, dur }
const fadeSpec = (v, d) => (v === 'cut' ? null : typeof v === 'string' ? { color: v, dur: d } : v ? { color: v.color || 'black', dur: v.dur ?? d } : null);

export function createRunner(frame, mod, ctx) {
  let S = null;
  const state = () => (S ||= (mod?.setup ? mod.setup(ctx) : {}) || {});
  const shotAt = (t) => frame.shots.find((s) => t >= s.start && t < s.end) || frame.shots[frame.shots.length - 1];

  function render(t) {
    const shot = shotAt(t), i = frame.shots.indexOf(shot);
    const lt = t - shot.start, dur = shot.end - shot.start;
    QA.reset(`${frame.id}/${shot.id} ${t.toFixed(2)}s`);
    let out = { pins: [], post: {} };
    if (shot.type === 'map') {
      if (!ctx.map) throw new Error(`${frame.id}/${shot.id}: a map shot needs assets/geo.json (run film.py geo)`);
      mapShot(ctx.map, lt, dur, shot.map || {}, out);
    } else {
      const fn = mod?.shots?.[shot.id];
      if (!fn) throw new Error(`${frame.id}: scenes/${frame.scene}.js has no shot "${shot.id}"`);
      const r = fn({ t, lt, dur, k: clamp(lt / dur), S: state(), shot, frame, map: ctx.map, geo: ctx.geo, cue: (n) => frame.cues[n].start - shot.start });
      out = { scene: r.world.scene, camera: r.world.camera, post: { ...(r.post || {}) }, pins: r.pins || [] };
    }
    // transitions: the first shot of a frame and every 3D shot fade in from black unless told otherwise
    const fin = fadeSpec(shot.in ?? 'black', i === 0 ? 0.3 : 0.4), fout = fadeSpec(shot.out ?? 'cut', 0.5);
    let fade = out.post.fade ?? 1, color = out.post.fadeColor;
    if (fin && lt < fin.dur) { fade *= smooth(lt / fin.dur); color = rgb(fin.color); }
    if (fout && lt > dur - fout.dur) { fade *= 1 - smooth((lt - (dur - fout.dur)) / fout.dur); color = rgb(fout.color); }
    out.post.fade = fade;
    if (color) out.post.fadeColor = color;
    return out;
  }

  function overlay(t, out) {
    const shot = shotAt(t), lt = t - shot.start, dur = shot.end - shot.start, D = frame.duration;
    const st = { pins: out.pins };
    const meta = ctx.film.meta;
    if (frame.stamp !== false && !shot.card?.hideStamp) {
      const sp = { ...frame.stamp, ...(shot.stamp || {}) };
      const no = sp.no ?? (frame.station ? meta.stationFormat.replace('{n}', frame.station).replace('{total}', meta.progress?.total ?? '') : '');
      st.stamp = { no, title: sp.title, date: sp.date, place: sp.place, alpha: windowAlpha(t, 0.2, D, 0.5, 0.4), ruleK: easeOut((t - 0.3) / 0.8), enter: easeOut((t - 0.2) / 0.6) };
    }
    const c = frame.callouts.find((x) => t >= x.start - 0.1 && t < x.end);
    if (c) {
      let num = c.num;
      if (c.count) {                               // animated count: [from, to] over countDur seconds
        const k = easeInOut(clamp((t - c.start - (c.countDelay ?? 0.3)) / (c.countDur ?? 1.5)));
        num = k >= 1 && c.num ? c.num : fmt(lerp(c.count[0], c.count[1], k));
        st.callout = { num, unit: k >= 1 && c.unitAfter ? c.unitAfter : c.unit, red: c.red && k > 0.95, small: c.small };
      } else st.callout = { num, unit: c.unit, red: c.red, small: c.small };
      st.callout.alpha = windowAlpha(t, c.start, c.end, 0.3, 0.3);
      st.callout.enter = easeOut((t - c.start) / 0.45);
    }
    if (frame.station && meta.progress) st.progress = { now: frame.station, total: meta.progress.total, label: meta.progress.label, alpha: windowAlpha(t, 0.4, D, 0.5, 0.4) };
    if (shot.card) {
      const cd = shot.card, a = cd.a ?? 0.2, b = cd.b ?? dur;
      st.card = { title: cd.title, sub: cd.sub, note: cd.note, big: cd.big, alpha: windowAlpha(lt, a, b, cd.fin ?? 0.8, cd.fout ?? 0.8), ruleK: easeOut((lt - a - 0.3) / 1.2), enter: easeOut((lt - a) / 0.9) };
    }
    return st;
  }

  return { render, overlay, worlds: () => (S ? S.worlds || [] : []), drop: () => { S = null; } };
}
