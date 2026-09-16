// Shared lifecycle only. Each preview supplies an independent Canvas scene.
const FRAME_INTERVAL = 1000 / 30;
const APPEARANCE_SECONDS = 2.6;
const clamp = value => Math.max(-1, Math.min(1, value));

export function mountVariant(createScene, root = document.querySelector('[data-flow]'), win = window, doc = document) {
  if (!root) return () => {};

  const cleanups = [];
  let canvas, controls, pause, replay, ctx, scene, motion, finePointer;
  let width = 0, height = 0, dpr = 1;
  let raf = null, lastTick = null, lastDraw = null, time = 0, entrance = 0;
  let visible = false, paused = false, disposed = false;
  let pointerX = 0, pointerY = 0, smoothX = 0, smoothY = 0;

  function stop() {
    if (raf !== null) win.cancelAnimationFrame(raf);
    raf = lastTick = lastDraw = null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    if (controls) controls.hidden = true;
    root.removeAttribute('data-rendered');
    root.removeAttribute('data-reduced-motion');
  }

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    cleanups.push(() => target.removeEventListener(type, callback, options));
  }

  function canAnimate() {
    return !disposed && width > 0 && height > 0 && visible && !doc.hidden && !paused && !motion.matches;
  }

  function syncControls() {
    controls.hidden = motion.matches;
    root.toggleAttribute('data-reduced-motion', motion.matches);
    pause.setAttribute('aria-pressed', String(paused));
    const label = paused ? 'Продолжить анимацию' : 'Приостановить анимацию';
    pause.setAttribute('aria-label', label);
    pause.title = label;
  }

  function draw() {
    if (disposed || !width || !height) return;
    try {
      // Reset clipping, transforms, compositing and styles even if a scene leaves
      // context state behind. Older Canvas APIs reset through the bitmap width.
      if (typeof ctx.reset === 'function') ctx.reset();
      else canvas.width = canvas.width;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const reducedMotion = motion.matches;
      const progress = Math.min(1, entrance / APPEARANCE_SECONDS);
      scene.draw(ctx, {
        width, height,
        time: reducedMotion ? 12 : time,
        progress: reducedMotion ? 1 : 1 - (1 - progress) ** 3,
        pointer: { x: reducedMotion ? 0 : smoothX, y: reducedMotion ? 0 : smoothY },
        reducedMotion,
        detail: width < 600 ? .6 : 1,
      });
      root.setAttribute('data-rendered', '');
    } catch {
      // An illustration must never interrupt the independent installation UI.
      dispose();
    }
  }

  function tick(now) {
    raf = null;
    if (!canAnimate()) { stop(); return; }
    const delta = lastTick === null ? 0 : Math.max(0, (now - lastTick) / 1000);
    lastTick = now;
    time += delta;
    entrance += delta;
    const smoothing = 1 - Math.exp(-delta * 6);
    smoothX += (pointerX - smoothX) * smoothing;
    smoothY += (pointerY - smoothY) * smoothing;
    if (lastDraw === null || now - lastDraw >= FRAME_INTERVAL - .0001) {
      lastDraw = now;
      draw();
    }
    schedule();
  }

  function schedule() {
    if (!canAnimate()) { stop(); return; }
    if (raf === null) raf = win.requestAnimationFrame(tick);
  }

  function resize() {
    if (disposed) return;
    try {
      const rect = root.getBoundingClientRect();
      width = Math.max(0, rect.width);
      height = Math.max(0, rect.height);
      dpr = Math.max(1, Math.min(win.devicePixelRatio || 1, 1.5));
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      draw();
      schedule();
    } catch { dispose(); }
  }

  function onPause() {
    if (disposed || motion.matches) return;
    paused = !paused;
    syncControls();
    schedule();
  }

  function onReplay() {
    if (disposed || motion.matches) return;
    time = entrance = 0;
    pointerX = pointerY = smoothX = smoothY = 0;
    paused = false;
    stop();
    syncControls();
    draw();
    schedule();
  }

  function onMotionChange() {
    if (disposed) return;
    // Avoid replaying the entrance when returning from an already complete still.
    if (!motion.matches) entrance = APPEARANCE_SECONDS;
    pointerX = pointerY = smoothX = smoothY = 0;
    syncControls();
    draw();
    schedule();
  }

  function onPointer(event) {
    if (!finePointer.matches || !canAnimate()) return;
    const rect = root.getBoundingClientRect();
    pointerX = clamp((event.clientX - rect.left) / width * 2 - 1);
    pointerY = clamp((event.clientY - rect.top) / height * 2 - 1);
  }

  function onPointerLeave() { pointerX = pointerY = 0; }
  function onPointerChange() {
    if (!finePointer.matches) pointerX = pointerY = smoothX = smoothY = 0;
  }

  try {
    controls = root.querySelector('.flow-controls');
    canvas = root.querySelector('canvas');
    pause = root.querySelector('[data-flow-pause]');
    replay = root.querySelector('[data-flow-replay]');
    if (controls) controls.hidden = true;
    root.removeAttribute('data-rendered');
    if (!canvas || !controls || !pause || !replay) { dispose(); return dispose; }
    ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) { dispose(); return dispose; }
    scene = createScene({ createCanvas: () => doc.createElement('canvas') });
    if (typeof scene?.draw !== 'function') { dispose(); return dispose; }
    motion = win.matchMedia('(prefers-reduced-motion: reduce)');
    finePointer = win.matchMedia('(hover: hover) and (pointer: fine)');

    // Buttons provide native Enter/Space activation; no keyboard interception.
    listen(pause, 'click', onPause);
    listen(replay, 'click', onReplay);
    listen(root, 'pointermove', onPointer, { passive: true });
    listen(root, 'pointerleave', onPointerLeave);
    listen(doc, 'visibilitychange', schedule);
    listen(motion, 'change', onMotionChange);
    listen(finePointer, 'change', onPointerChange);

    if (win.ResizeObserver) {
      const observer = new win.ResizeObserver(resize);
      cleanups.push(() => observer.disconnect());
      observer.observe(root);
    } else listen(win, 'resize', resize);

    if (win.IntersectionObserver) {
      const observer = new win.IntersectionObserver(entries => {
        if (disposed) return;
        const entry = entries.find(item => !item.target || item.target === root);
        if (!entry) return;
        visible = entry.isIntersecting;
        schedule();
      }, { threshold: 0 });
      cleanups.push(() => observer.disconnect());
      observer.observe(root);
    } else {
      const checkVisibility = () => {
        if (disposed) return;
        const rect = root.getBoundingClientRect();
        visible = rect.top < win.innerHeight && rect.top + rect.height > 0;
        schedule();
      };
      listen(win, 'scroll', checkVisibility, { passive: true });
      listen(win, 'resize', checkVisibility);
      checkVisibility();
    }
    syncControls();
    resize();
  } catch { dispose(); }

  return dispose;
}
