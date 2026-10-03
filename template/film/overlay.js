// DOM overlay drawn over the WebGL canvas: subtitles, the station stamp (title/date/place),
// big-number callouts, labels pinned to 3D points, the progress bar, title cards, and —
// in QA mode only — a warning panel. A pure function of the state passed to update().
// Two layouts: landscape (16:9, also used for 1:1) and portrait (9:16, with platform
// safe zones: nothing important in the top 8% or the bottom 17%).
import { clamp, smooth, easeOut, VIEW } from './engine.js';

const css = (st) => `
#ov { position:absolute; inset:0; pointer-events:none; font-family:${st.font}; color:${st.cream}; overflow:hidden; }
#ov .scrim { position:absolute; left:0; top:0; width:900px; height:380px; background:radial-gradient(ellipse at 18% 22%, rgba(8,7,6,.55), rgba(8,7,6,0) 70%); }
#ov .scrim2 { position:absolute; left:0; right:0; bottom:0; height:240px; background:linear-gradient(rgba(8,7,6,0), rgba(8,7,6,.45)); }
#ov .sub { position:absolute; left:0; right:0; bottom:74px; text-align:center; font-size:46px; font-weight:600; letter-spacing:.04em;
  text-shadow:0 2px 10px rgba(0,0,0,.85), 0 0 2px rgba(0,0,0,.9); white-space:nowrap; }
#ov .stamp { position:absolute; left:96px; top:78px; }
#ov .stamp .no { font-size:22px; letter-spacing:.3em; color:${st.gold}; opacity:.9; }
#ov .stamp .title { font-size:54px; font-weight:700; letter-spacing:.08em; margin-top:10px; text-shadow:0 2px 14px rgba(0,0,0,.7); }
#ov .stamp .rule { width:280px; height:1px; background:${st.goldLine}; margin:16px 0 14px; transform-origin:left; }
#ov .stamp .date { font-size:28px; letter-spacing:.18em; color:${st.gold}; text-shadow:0 2px 10px rgba(0,0,0,.8); }
#ov .stamp .place { font-size:26px; letter-spacing:.2em; opacity:.85; margin-top:6px; text-shadow:0 2px 10px rgba(0,0,0,.8); }
#ov .callout { position:absolute; right:120px; top:330px; text-align:right; }
#ov .callout .num { font-size:168px; font-weight:900; line-height:1; color:${st.goldBright}; letter-spacing:-.02em; text-shadow:0 4px 30px rgba(0,0,0,.6); font-variant-numeric:tabular-nums; }
#ov .callout .unit { font-size:40px; letter-spacing:.2em; margin-top:8px; text-shadow:0 2px 12px rgba(0,0,0,.8); }
#ov .callout.red .num { color:${st.red}; }
#ov .callout.small .num { font-size:112px; letter-spacing:.06em; }
#ov .pin { position:absolute; transform:translate(-50%,-100%); text-align:center; white-space:nowrap; }
#ov .pin .t { font-size:30px; letter-spacing:.14em; text-shadow:0 2px 10px rgba(0,0,0,.95), 0 0 3px #000; }
#ov .pin .l { width:1px; height:34px; margin:6px auto 0; background:linear-gradient(${st.cream}, rgba(239,230,210,0)); }
#ov .pin.gold .t { color:${st.dot}; }
#ov .pin.river .t { color:#9fb9c2; font-style:italic; letter-spacing:.3em; font-size:26px; }
#ov .pin.river .l, #ov .pin.nudged .l { display:none; }
#ov .card { position:absolute; left:0; right:0; top:360px; text-align:center; }
#ov .card .t { font-size:150px; font-weight:900; letter-spacing:.3em; text-shadow:0 6px 40px rgba(0,0,0,.7); margin-left:.3em; }
#ov .card .s { font-size:38px; letter-spacing:.5em; color:${st.gold}; margin-top:26px; margin-left:.5em; }
#ov .card .r { width:420px; height:1px; margin:30px auto 0; background:${st.goldLine}; }
#ov .card .n { font-size:30px; letter-spacing:.35em; opacity:.85; margin-top:34px; margin-left:.35em; }
#ov .card.big { top:250px; padding:70px 0 80px; background:radial-gradient(ellipse 34% 50% at 50% 50%, rgba(8,7,6,.62), rgba(8,7,6,0)); }
#ov .card.big .t { font-size:230px; letter-spacing:.25em; margin-left:.25em; }
#ov .progress { position:absolute; left:96px; bottom:40px; display:flex; gap:10px; align-items:center; font-size:16px; letter-spacing:.2em; color:rgba(239,230,210,.55); }
#ov .progress i { display:block; width:26px; height:2px; background:rgba(239,230,210,.25); }
#ov .progress i.on { background:${st.route}; }
#ov .progress i.now { background:${st.dot}; }
#ov .qa { position:absolute; right:20px; top:20px; max-width:900px; padding:14px 18px; background:rgba(160,20,20,.92); color:#fff; font:600 24px/1.4 Menlo,monospace; white-space:pre-wrap; display:none; }
#ov .qamark { position:absolute; left:0; top:0; width:12px; height:12px; display:none; }

/* portrait 9:16 */
#ov.portrait .scrim { width:1080px; height:560px; }
#ov.portrait .scrim2 { height:640px; }
#ov.portrait .stamp { left:64px; top:190px; }
#ov.portrait .stamp .title { font-size:60px; }
#ov.portrait .stamp .date { font-size:32px; } #ov.portrait .stamp .place { font-size:30px; }
#ov.portrait .callout { right:64px; top:560px; }
#ov.portrait .callout .num { font-size:150px; } #ov.portrait .callout.small .num { font-size:104px; }
#ov.portrait .sub { left:70px; right:70px; bottom:360px; font-size:56px; white-space:normal; line-height:1.35; }
#ov.portrait .progress { left:64px; bottom:auto; top:150px; }
#ov.portrait .progress i { width:18px; }
#ov.portrait .card { top:660px; } #ov.portrait .card .t { font-size:170px; }
#ov.portrait .card.big { top:560px; background:radial-gradient(ellipse 60% 50% at 50% 50%, rgba(8,7,6,.62), rgba(8,7,6,0)); } #ov.portrait .card.big .t { font-size:210px; }
#ov.portrait .card .s { font-size:34px; letter-spacing:.3em; margin-left:.3em; } #ov.portrait .card .n { font-size:28px; letter-spacing:.2em; margin-left:.2em; }
`;

const DEFAULT_STYLE = { font: '"Songti SC","STSong","Noto Serif CJK SC","Noto Serif SC","Source Han Serif SC","SimSun",serif', cream: '#efe6d2', gold: '#d9a441', goldBright: '#e2ad4f', goldLine: 'rgba(217,164,65,.7)', red: '#d6453a', dot: '#e7b35a', route: '#c0392b' };

export function createOverlay(root, style = {}) {
  const st = { ...DEFAULT_STYLE, ...style };
  const tag = document.createElement('style');
  tag.textContent = css(st);
  root.appendChild(tag);
  const ov = document.createElement('div');
  ov.id = 'ov';
  if (VIEW.portrait) ov.className = 'portrait';
  ov.innerHTML = `
    <div class="scrim"></div><div class="scrim2"></div>
    <div class="stamp"><div class="no"></div><div class="title"></div><div class="rule"></div><div class="date"></div><div class="place"></div></div>
    <div class="callout"><div class="num"></div><div class="unit"></div></div>
    <div class="card"><div class="t"></div><div class="r"></div><div class="s"></div><div class="n"></div></div>
    <div class="sub"></div>
    <div class="pins"></div>
    <div class="progress"></div>
    <div class="qa"></div><div class="qamark"></div>`;
  root.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const el = { scrim: $('.scrim'), stamp: $('.stamp'), no: $('.stamp .no'), title: $('.stamp .title'), rule: $('.stamp .rule'), date: $('.stamp .date'), place: $('.stamp .place'),
    callout: $('.callout'), num: $('.callout .num'), unit: $('.callout .unit'), sub: $('.sub'), pins: $('.pins'), progress: $('.progress'),
    card: $('.card'), ct: $('.card .t'), cs: $('.card .s'), cr: $('.card .r'), cn: $('.card .n'), qa: $('.qa'), qamark: $('.qamark') };
  const pinPool = [];
  const pinEl = (i) => {
    while (pinPool.length <= i) { const d = document.createElement('div'); d.className = 'pin'; d.innerHTML = '<div class="t"></div><div class="l"></div>'; el.pins.appendChild(d); pinPool.push(d); }
    return pinPool[i];
  };

  // keep labels on screen and apart: later labels that would overlap an earlier one are nudged down
  function layoutPins(pins) {
    const W = VIEW.W, H = VIEW.H, top = VIEW.portrait ? 300 : 130, bottom = H - (VIEW.portrait ? 480 : 190);
    const placed = [];
    return pins.filter((p) => p.alpha > 0.001).map((p) => {
      const w = [...p.text].length * 34 + 24;
      let x = clamp(p.x, w / 2 + 40, W - w / 2 - 40), y = clamp(p.y, top, bottom), nudged = false;
      for (let guard = 0; guard < 6; guard++) {
        const hit = placed.find((q) => Math.abs(q.x - x) < (q.w + w) / 2 && Math.abs(q.y - y) < 46);
        if (!hit) break;
        y = hit.y + 50; nudged = true;
      }
      placed.push({ x, y, w });
      return { ...p, x, y, nudged };
    });
  }

  return {
    // state: { stamp, callout, sub, pins, progress, card, qa }
    update(s) {
      const stp = s.stamp;
      if (stp && stp.alpha > 0.001) {
        el.stamp.style.opacity = stp.alpha; el.scrim.style.opacity = stp.alpha;
        el.no.textContent = stp.no || ''; el.title.textContent = stp.title || '';
        el.date.textContent = stp.date || ''; el.place.textContent = stp.place || '';
        el.rule.style.transform = `scaleX(${stp.ruleK ?? 1})`;
        el.stamp.style.transform = `translateY(${(1 - (stp.enter ?? 1)) * 14}px)`;
      } else { el.stamp.style.opacity = 0; el.scrim.style.opacity = 0; }

      const co = s.callout;
      if (co && co.alpha > 0.001) {
        el.callout.style.opacity = co.alpha;
        el.callout.className = 'callout' + (co.red ? ' red' : '') + (co.small ? ' small' : '');
        el.num.textContent = co.num; el.unit.textContent = co.unit || '';
        el.callout.style.transform = `translateY(${(1 - (co.enter ?? 1)) * 24}px)`;
      } else el.callout.style.opacity = 0;

      const cd = s.card;
      if (cd && cd.alpha > 0.001) {
        el.card.style.opacity = cd.alpha; el.card.className = 'card' + (cd.big ? ' big' : '');
        el.ct.textContent = cd.title; el.cs.textContent = cd.sub || ''; el.cn.textContent = cd.note || '';
        el.cr.style.transform = `scaleX(${cd.ruleK ?? 1})`;
        el.card.style.transform = `translateY(${(1 - (cd.enter ?? 1)) * 20}px)`;
      } else el.card.style.opacity = 0;

      const su = s.sub;
      if (su && su.text && su.alpha > 0.001) { el.sub.style.opacity = su.alpha; el.sub.textContent = su.text; } else el.sub.style.opacity = 0;

      const pins = layoutPins(s.pins || []);
      pins.forEach((p, i) => {
        const d = pinEl(i);
        d.style.display = 'block'; d.style.opacity = p.alpha;
        d.style.left = `${p.x}px`; d.style.top = `${p.y}px`;
        d.className = 'pin' + (p.kind ? ' ' + p.kind : '') + (p.nudged ? ' nudged' : '');
        d.firstChild.textContent = p.text;
      });
      for (let i = pins.length; i < pinPool.length; i++) pinPool[i].style.display = 'none';

      const pr = s.progress;
      if (pr && pr.alpha > 0.001) {
        el.progress.style.opacity = pr.alpha;
        if (el.progress.dataset.k !== `${pr.now}/${pr.total}`) {
          let h = pr.label ? `<span>${pr.label}</span>` : '';
          for (let i = 1; i <= pr.total; i++) h += `<i class="${i < pr.now ? 'on' : i === pr.now ? 'now' : ''}"></i>`;
          el.progress.innerHTML = h + `<span>${String(pr.now).padStart(2, '0')} / ${pr.total}</span>`;
          el.progress.dataset.k = `${pr.now}/${pr.total}`;
        }
      } else el.progress.style.opacity = 0;

      // QA mode: a pixel marker the QA script reads, and the warnings spelled out for a human/agent
      if (s.qa) {
        const w = s.qa.warnings || [];
        el.qamark.style.display = 'block';
        el.qamark.style.background = w.length ? '#ff00ff' : '#00ff00';
        el.qa.style.display = w.length ? 'block' : 'none';
        el.qa.textContent = w.join('\n');
      }
    },
  };
}

// alpha for a [a, b] window with soft edges
export function windowAlpha(t, a, b, fin = 0.35, fout = 0.35) {
  return smooth((t - a) / fin) * (1 - smooth((t - (b - fout)) / fout));
}
export function subAt(subs, t) {
  for (const c of subs) if (t >= c.start - 0.05 && t < c.end) return { text: c.text, alpha: windowAlpha(t, c.start - 0.05, c.end, 0.12, 0.12) };
  return { text: '', alpha: 0 };
}
export { easeOut, clamp };
