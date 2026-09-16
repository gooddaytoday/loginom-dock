// A small, local Canvas renderer. No WebGL, media downloads or runtime dependencies.
const TAU = Math.PI * 2;
const COLORS = ['#e89a73', '#d66d60', '#ffe0b1', '#84bfc0'];

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// A braided torus knot: three folds connect into one continuous data stream.
function knot(u, v, time) {
  const radius = 1 + .32 * Math.cos(3 * u) + .105 * Math.cos(v);
  return [
    radius * Math.cos(2 * u),
    radius * Math.sin(2 * u),
    .48 * Math.sin(3 * u) + .105 * Math.sin(v) + .025 * Math.sin(5 * u + time * .3),
  ];
}

export function mountDataFlow(root, win = window, doc = document) {
  const canvas = root.querySelector('canvas');
  let ctx;
  try { ctx = canvas.getContext('2d', { alpha: true }); } catch { return () => {}; }
  if (!ctx) return () => {};

  const controls = root.querySelector('.flow-controls');
  const pause = root.querySelector('[data-flow-pause]');
  const replay = root.querySelector('[data-flow-replay]');
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = win.matchMedia('(hover: hover) and (pointer: fine)');
  const rng = random(87231);
  const particles = Array.from({ length: 4200 }, (_, i) => ({
    u: rng() * TAU,
    v: rng() * TAU,
    scatter: [rng() * 5 - 2.5, rng() * 5 - 2.5, rng() * 4 - 2],
    size: .6 + rng() * 1.05,
    color: i % 17 === 0 ? 3 : i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
    light: rng(),
  }));
  const stars = Array.from({ length: 100 }, () => [rng(), rng(), rng()]);
  const sprites = COLORS.map(color => {
    const sprite = doc.createElement('canvas');
    sprite.width = sprite.height = 48;
    const context = sprite.getContext('2d');
    if (!context) return null;
    const glow = context.createRadialGradient(24, 24, 0, 24, 24, 24);
    glow.addColorStop(0, '#fff5e7');
    glow.addColorStop(.07, color);
    glow.addColorStop(.23, `${color}80`);
    glow.addColorStop(1, `${color}00`);
    context.fillStyle = glow;
    context.fillRect(0, 0, 48, 48);
    return sprite;
  });

  let width = 0, height = 0, dpr = 1;
  let frame = null, lastTime = null, elapsed = 0, entrance = 0;
  let visible = false, paused = false, disposed = false;
  let pointerX = 0, pointerY = 0, tiltX = 0, tiltY = 0;

  function syncControls() {
    // Respect the OS preference throughout the visit, including changes while open.
    controls.hidden = motion.matches;
    root.toggleAttribute('data-reduced-motion', motion.matches);
    pause.setAttribute('aria-pressed', String(paused));
    const label = paused ? 'Продолжить анимацию' : 'Приостановить анимацию';
    pause.setAttribute('aria-label', label);
    pause.title = label;
  }

  function draw() {
    if (!width || !height) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const staticScene = motion.matches;
    const t = staticScene ? 8 : elapsed;
    const progress = staticScene ? 1 : Math.min(1, entrance / 3.2);
    const assembled = 1 - (1 - progress) ** 3;
    const scale = Math.min(width * .29, height * .34);
    const centerX = width * .49;
    const centerY = height * .51;
    const rx = .93 + (staticScene ? 0 : tiltY * .22);
    const ry = -.3 + (staticScene ? 0 : tiltX * .27) + Math.sin(t * .075) * .18;
    const rz = -.38 + t * .027;
    const sx = Math.sin(rx), cx = Math.cos(rx), sy = Math.sin(ry), cy = Math.cos(ry);
    const sz = Math.sin(rz), cz = Math.cos(rz);
    function project([x, y, z]) {
      const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
      const x1 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
      const depth = 3.8 / (3.8 - z2);
      return [centerX + (x1 * cz - y1 * sz) * scale * depth,
        centerY + (x1 * sz + y1 * cz) * scale * depth, depth, z2];
    }

    ctx.globalCompositeOperation = 'source-over';
    for (const [x, y, light] of stars) {
      ctx.globalAlpha = .08 + light * .25;
      ctx.fillStyle = '#c8b1a7';
      ctx.fillRect(x * width, y * height, light > .9 ? 1.5 : .8, light > .9 ? 1.5 : .8);
    }
    ctx.globalAlpha = 1;
    const halo = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, scale * 1.6);
    halo.addColorStop(0, '#ae4b2512');
    halo.addColorStop(.5, '#9b352210');
    halo.addColorStop(1, '#9b352200');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    // Fine filaments connect the particles and make depth legible at small sizes.
    for (let strand = 0; strand < 24; strand++) {
      ctx.beginPath();
      const v = strand / 24 * TAU;
      for (let j = 0; j <= 180; j++) {
        const u = j / 180 * TAU;
        const [x, y] = project(knot(u, v + u * 3, t));
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = strand % 5 === 0 ? '#c88165' : '#9b5b4b';
      ctx.globalAlpha = assembled * .32;
      ctx.lineWidth = .55;
      ctx.stroke();
    }

    const stride = width < 550 ? 2 : 1;
    for (let i = 0; i < particles.length; i += stride) {
      const p = particles[i];
      const u = p.u + t * (.019 + p.light * .008);
      const target = knot(u, p.v + u * 3, t);
      const position = target.map((value, axis) => value * assembled + p.scatter[axis] * (1 - assembled));
      const [x, y, depth, z] = project(position);
      const brightness = .5 + (z + 1.5) / 3 * .55;
      const pulse = .8 + .2 * Math.sin(p.u * 5 + t * .8);
      ctx.globalAlpha = Math.min(1, brightness * pulse);
      ctx.fillStyle = COLORS[p.color];
      const size = p.size * depth * (width < 550 ? .9 : 1);
      ctx.fillRect(x, y, size, size);
      if (p.light > .9) {
        ctx.fillStyle = '#fff0d3';
        ctx.fillRect(x, y, size * .8, size * .8);
      }
      if (p.light > .973 && sprites[p.color]) {
        const glowSize = (11 + p.size * 12) * depth;
        ctx.globalAlpha = Math.min(.85, brightness * pulse);
        ctx.drawImage(sprites[p.color], x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    root.setAttribute('data-rendered', '');
  }

  function canAnimate() { return !disposed && visible && !doc.hidden && !paused && !motion.matches; }
  function stop() {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    lastTime = null;
  }
  function tick(now) {
    frame = null;
    if (!canAnimate()) { lastTime = null; return; }
    // Cap at 30fps on high-refresh displays and never catch up after a hidden tab.
    if (lastTime !== null && now - lastTime < 30) {
      frame = win.requestAnimationFrame(tick);
      return;
    }
    const delta = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, .06);
    lastTime = now;
    elapsed += delta;
    entrance += delta;
    tiltX += (pointerX - tiltX) * .045;
    tiltY += (pointerY - tiltY) * .045;
    draw();
    frame = win.requestAnimationFrame(tick);
  }
  function schedule() {
    if (!canAnimate()) { stop(); return; }
    if (frame === null) frame = win.requestAnimationFrame(tick);
  }
  function resize() {
    const rect = root.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(win.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    draw();
  }
  function onPause() { paused = !paused; syncControls(); schedule(); }
  function onReplay() {
    elapsed = entrance = 0;
    paused = false;
    pointerX = pointerY = tiltX = tiltY = 0;
    syncControls();
    draw();
    schedule();
  }
  function onMotionChange() {
    syncControls();
    if (!motion.matches) entrance = 3.2;
    draw();
    schedule();
  }
  function onPointer(event) {
    if (!finePointer.matches || !canAnimate()) return;
    const rect = root.getBoundingClientRect();
    pointerX = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
    pointerY = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
  }
  function onPointerLeave() { pointerX = pointerY = 0; }
  const resizeObserver = new win.ResizeObserver(resize);
  const intersectionObserver = new win.IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    schedule();
  }, { threshold: 0 });

  pause.addEventListener('click', onPause);
  replay.addEventListener('click', onReplay);
  root.addEventListener('pointermove', onPointer, { passive: true });
  root.addEventListener('pointerleave', onPointerLeave);
  doc.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', onMotionChange);
  resizeObserver.observe(root);
  intersectionObserver.observe(root);
  syncControls();
  resize();

  return () => {
    disposed = true;
    stop();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    pause.removeEventListener('click', onPause);
    replay.removeEventListener('click', onReplay);
    root.removeEventListener('pointermove', onPointer);
    root.removeEventListener('pointerleave', onPointerLeave);
    doc.removeEventListener('visibilitychange', schedule);
    motion.removeEventListener('change', onMotionChange);
    controls.hidden = true;
  };
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-flow]');
  if (root) {
    // A renderer failure must leave the static illustration and install flow usable.
    try { mountDataFlow(root); } catch { root.removeAttribute('data-rendered'); }
  }
}
