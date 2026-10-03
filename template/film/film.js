// Film controller: one WebGL renderer for the whole piece. Maps composition time →
// (frame, shot, local time), renders that shot, and updates the DOM overlay. Scenes are
// built lazily and deterministically (seeded), so any time can be rendered in any order;
// only two are kept in memory — the rest are disposed and rebuilt identically when needed.
import { createRenderer, setView, QA } from './engine.js';
import { createOverlay, subAt } from './overlay.js';
import { loadGeo, buildMap } from './map.js';
import { createRunner } from './frame.js';

const KEEP = 2;

function dispose(worlds) {
  const seen = new Set();
  for (const w of worlds || []) w?.scene?.traverse?.((o) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) if (!seen.has(m)) { seen.add(m); for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); }
  });
}

export async function boot({ canvas, overlayRoot, film }) {
  setView(film.meta.W, film.meta.H);
  QA.on = !!film.meta.qa;
  const R = createRenderer(canvas);
  const overlay = createOverlay(overlayRoot, film.meta.style);
  const geo = film.meta.hasGeo ? await loadGeo('') : null;
  const map = geo ? buildMap(geo, film.meta.style) : null;
  // load every scene module up front (code only — building is lazy and synchronous)
  const mods = {};
  await Promise.all([...new Set(film.frames.map((f) => f.scene).filter(Boolean))].map(async (name) => { mods[name] = (await import(`../scenes/${name}.js`)).default; }));
  const ctx = { map, geo, film };
  const runners = film.frames.map((f) => createRunner(f, f.scene ? mods[f.scene] : null, ctx));
  const live = [];                                   // most-recently-used runners that hold built worlds
  function touch(r) {
    const i = live.indexOf(r);
    if (i >= 0) live.splice(i, 1);
    live.push(r);
    while (live.length > KEEP) { const old = live.shift(); dispose(old.worlds()); old.drop(); }
  }

  function renderAt(time) {
    const i = Math.max(0, film.frames.findIndex((x) => time >= x.start && time < x.start + x.duration));
    const idx = time >= film.frames[film.frames.length - 1].start ? film.frames.length - 1 : i;
    const f = film.frames[idx], r = runners[idx];
    const t = Math.min(Math.max(0, time - f.start), f.duration - 1e-4);
    if (f.scene) touch(r);
    const out = r.render(t);
    R.render(out.scene, out.camera, time, out.post);
    const ov = r.overlay(t, out);
    ov.sub = subAt(film.subs, time);
    if (QA.on) ov.qa = { warnings: QA.now };
    overlay.update(ov);
    document.getElementById('film-error')?.remove();      // a frame that renders clears an earlier error panel
    return out;
  }
  try { renderAt(0); } catch (e) { window.__filmError?.(e); }
  return {
    renderAt,
    // QA helper for the browser console / Claude's browser tools: render the given times and
    // return every engine warning raised (camera lifted, view blocked, …).
    qa(times) { QA.all.clear(); for (const t of times) renderAt(t); return [...QA.all]; },
    film,
  };
}
