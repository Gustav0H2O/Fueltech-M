/* FuelTech Master — fondo interactivo: partículas de combustible + red */
(function () {
  const cv = document.getElementById('bg');
  const ctx = cv.getContext('2d');
  let W, H, parts = [];
  const mouse = { x: -9999, y: -9999 };
  const N = Math.min(90, Math.floor(window.innerWidth / 16));

  function resize() {
    W = cv.width = window.innerWidth;
    H = cv.height = window.innerHeight;
  }
  window.addEventListener('resize', resize); resize();

  window.addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('pointerleave', () => { mouse.x = -9999; });

  for (let i = 0; i < N; i++) {
    parts.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .25, vy: -.15 - Math.random() * .35,
      r: .8 + Math.random() * 1.8,
      hot: Math.random() < .3   // partículas ámbar (combustible) vs azules
    });
  }

  let paused = false;
  document.addEventListener('visibilitychange', () => { paused = document.hidden; });

  (function frame() {
    requestAnimationFrame(frame);
    if (paused) return;
    ctx.clearRect(0, 0, W, H);

    for (const p of parts) {
      // repulsión suave del mouse
      const dx = p.x - mouse.x, dy = p.y - mouse.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 16900) { const d = Math.sqrt(d2) || 1; p.vx += (dx / d) * .08; p.vy += (dy / d) * .08; }
      p.vx *= .985; p.vy = p.vy * .985 - .004;
      p.x += p.vx; p.y += p.vy;
      if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; p.vy = -.15 - Math.random() * .35; }
      if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 7);
      ctx.fillStyle = p.hot ? 'rgba(229,57,53,.5)' : 'rgba(151,158,167,.3)';
      ctx.fill();
    }

    // red de conexiones cercanas
    ctx.lineWidth = .6;
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j];
        const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < 10000) {
          ctx.strokeStyle = `rgba(74,85,98,${.18 * (1 - d2 / 10000)})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
  })();
})();
