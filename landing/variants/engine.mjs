import { createFlowInteraction } from '../flow-interaction.mjs';

// Shared lifecycle and local cursor field; each preview supplies its own scene.
const FRAME_INTERVAL = 1000 / 30;
const APPEARANCE_SECONDS = 2.6;

export function mountVariant(createScene, root = document.querySelector('[data-flow]'), win = window, doc = document) {
  if (!root) return () => {};

  const cleanups = [];
  let canvas, controls, pause, replay, ctx, scene, motion, finePointer;
  let width = 0, height = 0, dpr = 1;
  let raf = null, lastTick = null, lastDraw = null, time = 0, entrance = 0;
  let visible = false, paused = false, disposed = false;
  const interaction = createFlowInteraction();

  function stop() {
    if (raf !== null) win.cancelAnimationFrame(raf);
    raf = lastTick = lastDraw = null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    interaction.reset();
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
        interaction: reducedMotion ? null : interaction,
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
    interaction.step(delta);
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
      interaction.resize(width, height);
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
    if (!paused) interaction.reset();
    syncControls();
    schedule();
  }

  function onReplay() {
    if (disposed || motion.matches) return;
    time = entrance = 0;
    interaction.reset();
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
    interaction.reset();
    syncControls();
    draw();
    schedule();
  }

  function onPointer(event) {
    if (event.pointerType === 'touch' || !finePointer.matches || !canAnimate()) return;
    const rect = root.getBoundingClientRect();
    interaction.move(event.clientX - rect.left, event.clientY - rect.top);
  }

  function onPointerLeave() { interaction.release(); }
  function onPointerCancel() { interaction.reset(); }
  function onVisibilityChange() {
    if (doc.hidden) interaction.reset();
    schedule();
  }
  function onPointerChange() {
    if (!finePointer.matches) interaction.reset();
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
    listen(root, 'pointercancel', onPointerCancel);
    listen(win, 'blur', onPointerCancel);
    listen(doc, 'visibilitychange', onVisibilityChange);
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
        if (!visible) interaction.reset();
        schedule();
      }, { threshold: 0 });
      cleanups.push(() => observer.disconnect());
      observer.observe(root);
    } else {
      const checkVisibility = () => {
        if (disposed) return;
        const rect = root.getBoundingClientRect();
        visible = rect.top < win.innerHeight && rect.top + rect.height > 0;
        if (!visible) interaction.reset();
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
