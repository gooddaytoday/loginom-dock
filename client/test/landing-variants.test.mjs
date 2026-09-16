import test from 'node:test';
import assert from 'node:assert/strict';
import { mountVariant } from '../../landing/variants/engine.mjs';

function setup({ reduced = false, fine = true, context = 'available', factory, observerError = false, legacyReset = false } = {}) {
  class Element extends EventTarget {
    attributes = new Map();
    listeners = new Map();
    hidden = false;
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    toggleAttribute(name, value) { if (value) this.setAttribute(name, ''); else this.removeAttribute(name); }
    addEventListener(type, callback, options) {
      super.addEventListener(type, callback, options);
      this.listeners.set(callback, type);
    }
    removeEventListener(type, callback, options) {
      super.removeEventListener(type, callback, options);
      this.listeners.delete(callback);
    }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const frames = [], resets = [], clears = [], transforms = [], calls = [];
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    reset() { resets.push(true); this.globalAlpha = 1; this.globalCompositeOperation = 'source-over'; },
    setTransform(...args) { transforms.push(args); },
    clearRect(...args) { clears.push(args); },
  };
  if (legacyReset) delete ctx.reset;
  let bitmapWidth = 0, bitmapResets = 0;
  const canvas = {
    get width() { return bitmapWidth; },
    set width(value) { bitmapWidth = value; bitmapResets++; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; },
    getContext() { if (context === 'throws') throw new Error('Canvas unavailable'); return context === 'null' ? null : ctx; },
  };
  const root = new Element(), pause = new Element(), replay = new Element(), controls = new Element();
  const doc = new Element(), win = new Element(), motion = new Element(), pointerMedia = new Element();
  controls.hidden = true;
  doc.hidden = false;
  motion.matches = reduced;
  pointerMedia.matches = fine;
  let rect = { width: 800, height: 600, left: 20, top: 10 };
  root.querySelector = selector => ({ canvas, '.flow-controls': controls,
    '[data-flow-pause]': pause, '[data-flow-replay]': replay })[selector];
  root.getBoundingClientRect = () => rect;
  doc.createElement = tag => { calls.push(tag); return { getContext: () => ctx }; };
  const callbacks = new Map();
  let id = 0, intersection, resize, disconnects = 0;
  Object.assign(win, {
    devicePixelRatio: 3,
    matchMedia: query => query.includes('reduced-motion') ? motion : pointerMedia,
    requestAnimationFrame(callback) { callbacks.set(++id, callback); return id; },
    cancelAnimationFrame(handle) { callbacks.delete(handle); },
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect() { disconnects++; }
    },
    IntersectionObserver: class {
      constructor(callback) { intersection = callback; }
      observe() { if (observerError) throw new Error('observer setup failed'); }
      disconnect() { disconnects++; }
    },
  });
  const dispose = mountVariant(factory ?? (() => ({ draw(context, frame) {
    assert.equal(context.globalAlpha, 1, 'context opacity is reset before every scene draw');
    assert.equal(context.globalCompositeOperation, 'source-over');
    frames.push(frame);
    context.globalAlpha = .1;
    context.globalCompositeOperation = 'lighter';
  } })), root, win, doc);
  return {
    root, pause, replay, controls, canvas, ctx, frames, resets, clears, transforms, calls, dispose,
    get pending() { return callbacks.size; },
    get disconnects() { return disconnects; },
    get bitmapResets() { return bitmapResets; },
    get listeners() { return [root, pause, replay, doc, win, motion, pointerMedia].reduce((n, item) => n + item.listeners.size, 0); },
    frame(now) { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(now)); },
    visible(value) { intersection?.([{ target: root, isIntersecting: value }]); },
    hidden(value) { doc.hidden = value; doc.dispatchEvent(new Event('visibilitychange')); },
    reduce(value) { motion.matches = value; motion.dispatchEvent(new Event('change')); },
    fine(value) { pointerMedia.matches = value; pointerMedia.dispatchEvent(new Event('change')); },
    resize(values = {}) { rect = { ...rect, ...values }; resize?.(); },
    point(x, y) { root.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: x, clientY: y })); },
    leave() { root.dispatchEvent(new Event('pointerleave')); },
  };
}

test('variant time advances only during visible animation and resumes one loop without catching up', () => {
  const s = setup();
  assert.equal(s.pending, 0);
  s.visible(true);
  s.visible(true);
  assert.equal(s.pending, 1);
  s.frame(0);
  s.frame(1000);
  assert.equal(s.frames.at(-1).time, 1);
  s.hidden(true);
  assert.equal(s.pending, 0);
  s.frame(10000);
  s.hidden(false);
  s.frame(20000);
  assert.equal(s.frames.at(-1).time, 1);
  s.visible(false);
  assert.equal(s.pending, 0);
  s.visible(true);
  s.frame(40000);
  s.frame(40100);
  assert.ok(Math.abs(s.frames.at(-1).time - 1.1) < 1e-9);
  s.dispose();
});

test('native pause and replay clicks preserve manual intent across visibility and motion changes', () => {
  const s = setup();
  s.visible(true);
  s.frame(0);
  s.frame(1000);
  s.pause.click();
  assert.equal(s.pause.getAttribute('aria-pressed'), 'true');
  assert.equal(s.pause.getAttribute('aria-label'), 'Продолжить анимацию');
  s.visible(false);
  s.visible(true);
  s.hidden(true);
  s.hidden(false);
  s.reduce(true);
  s.reduce(false);
  assert.equal(s.pending, 0);
  s.replay.click();
  assert.equal(s.pending, 1);
  assert.equal(s.pause.getAttribute('aria-pressed'), 'false');
  assert.equal(s.pause.getAttribute('aria-label'), 'Приостановить анимацию');
  assert.equal(s.frames.at(-1).time, 0);
  assert.equal(s.frames.at(-1).progress, 0);
  assert.equal([...s.pause.listeners.values()].includes('keydown'), false, 'native keyboard activation is not duplicated');
  s.dispose();
});

test('reduced motion renders a complete still with no RAF and follows preference changes', () => {
  const s = setup({ reduced: true });
  s.visible(true);
  assert.equal(s.pending, 0);
  assert.equal(s.controls.hidden, true);
  assert.equal(s.frames.at(-1).time, 12);
  assert.equal(s.frames.at(-1).progress, 1);
  assert.deepEqual(s.frames.at(-1).pointer, { x: 0, y: 0 });
  assert.equal(s.root.getAttribute('data-rendered'), '');
  s.reduce(false);
  assert.equal(s.controls.hidden, false);
  assert.equal(s.pending, 1);
  assert.equal(s.frames.at(-1).progress, 1);
  s.reduce(true);
  assert.equal(s.pending, 0);
  s.dispose();
});

test('variant caps DPR and animation at 30fps, eases entrance and lowers detail on narrow canvases', () => {
  const s = setup();
  assert.equal(s.canvas.width, 1200);
  assert.equal(s.canvas.height, 900);
  assert.deepEqual(s.transforms.at(-1), [1.5, 0, 0, 1.5, 0, 0]);
  s.visible(true);
  s.frame(0);
  const draws = s.frames.length;
  s.frame(16);
  s.frame(33);
  assert.equal(s.frames.length, draws);
  s.frame(34);
  assert.equal(s.frames.length, draws + 1);
  s.frame(1300);
  assert.ok(Math.abs(s.frames.at(-1).progress - .875) < 1e-9);
  s.frame(2600);
  assert.equal(s.frames.at(-1).progress, 1);
  s.resize({ width: 599 });
  assert.equal(s.frames.at(-1).detail, .6);
  assert.equal(s.pending, 1);
  assert.equal(s.resets.length, s.frames.length);
  assert.equal(s.clears.length, s.frames.length);
  s.resize({ width: 600 });
  assert.equal(s.frames.at(-1).detail, 1);
  s.dispose();
});

test('fine pointers are clamped and smoothed; touch preference and reduced motion stay centered', () => {
  const s = setup();
  s.visible(true);
  s.frame(0);
  s.point(10000, -10000);
  s.frame(34);
  const initial = s.frames.at(-1).pointer;
  assert.ok(initial.x > 0 && initial.x < 1);
  assert.ok(initial.y < 0 && initial.y > -1);
  s.frame(1000);
  assert.ok(s.frames.at(-1).pointer.x > initial.x && s.frames.at(-1).pointer.x <= 1);
  s.leave();
  s.frame(1100);
  assert.ok(s.frames.at(-1).pointer.x < .9);
  s.fine(false);
  s.point(10000, -10000);
  s.frame(1200);
  assert.deepEqual(s.frames.at(-1).pointer, { x: 0, y: 0 });
  s.reduce(true);
  assert.deepEqual(s.frames.at(-1).pointer, { x: 0, y: 0 });
  s.dispose();
});

test('disposal removes all subscriptions, cancels animation and ignores queued observer deliveries', () => {
  const s = setup();
  s.visible(true);
  assert.ok(s.listeners > 0);
  s.dispose();
  s.dispose();
  assert.equal(s.listeners, 0);
  assert.equal(s.disconnects, 2);
  assert.equal(s.pending, 0);
  assert.equal(s.controls.hidden, true);
  const count = s.frames.length;
  s.resize();
  s.visible(true);
  s.replay.click();
  s.pause.click();
  s.reduce(true);
  s.hidden(false);
  s.frame(10000);
  assert.equal(s.frames.length, count);
  assert.equal(s.pending, 0);
});

test('setup and draw errors preserve fallback without scheduling or leaking handlers', () => {
  for (const options of [
    { context: 'null' }, { context: 'throws' },
    { factory: () => { throw new Error('scene setup failed'); } },
    { factory: () => ({}) },
    { factory: () => ({ draw() { throw new Error('scene draw failed'); } }) },
    { observerError: true },
  ]) {
    const s = setup(options);
    assert.equal(s.root.getAttribute('data-rendered'), undefined);
    assert.equal(s.controls.hidden, true);
    assert.equal(s.pending, 0);
    assert.equal(s.listeners, 0);
    s.dispose();
  }
  assert.doesNotThrow(() => mountVariant(() => {}, null, {}, {}));
});

test('a later renderer failure restores fallback and cancels the active loop', () => {
  let draws = 0;
  const s = setup({ factory: () => ({ draw() { if (++draws > 1) throw new Error('failed after setup'); } }) });
  assert.equal(s.root.getAttribute('data-rendered'), '');
  s.visible(true);
  s.frame(0);
  assert.equal(s.root.getAttribute('data-rendered'), undefined);
  assert.equal(s.controls.hidden, true);
  assert.equal(s.pending, 0);
  assert.equal(s.listeners, 0);
  assert.equal(s.disconnects, 2);
});

test('scene canvas factory uses the injected document, and older Canvas state resets via bitmap width', () => {
  let sprite;
  const s = setup({ factory: ({ createCanvas }) => {
    sprite = createCanvas();
    return { draw() {} };
  } });
  assert.ok(sprite);
  assert.deepEqual(s.calls, ['canvas']);
  s.dispose();
  const legacy = setup({ legacyReset: true });
  legacy.visible(true);
  legacy.frame(0);
  legacy.frame(34);
  assert.equal(legacy.frames.length, 3);
  assert.ok(legacy.bitmapResets >= legacy.frames.length);
  legacy.dispose();
});
