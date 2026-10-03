// Debug contact sheet: render several times and tile the WebGL canvas into one 2D canvas.
window.__sheet = (times, cols = 3) => {
  const src = document.getElementById('film');
  let c = document.getElementById('__sheet');
  if (!c) { c = document.createElement('canvas'); c.id = '__sheet'; c.width = 1920; c.height = 1080; Object.assign(c.style, { position: 'fixed', inset: '0', zIndex: 99, background: '#000' }); document.body.appendChild(c); }
  c.style.display = 'block';
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 1920, 1080);
  const rows = Math.ceil(times.length / cols), w = 1920 / cols, h = w * 9 / 16;
  times.forEach((t, i) => {
    window.__film.renderAt(t);
    const x = (i % cols) * w, y = Math.floor(i / cols) * h;
    g.drawImage(src, x, y, w - 4, h - 4);
    g.fillStyle = '#ff0'; g.font = '28px sans-serif'; g.fillText(t.toFixed(1) + 's', x + 10, y + 34);
  });
  return rows;
};
window.__unsheet = () => { const c = document.getElementById('__sheet'); if (c) c.style.display = 'none'; };
