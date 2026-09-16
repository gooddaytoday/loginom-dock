import test from 'node:test';
import assert from 'node:assert/strict';
import { mountDataFlow } from '../../landing/hero.mjs';

function scene({ reduced = false, contextAvailable = true } = {}) {
  class Element extends EventTarget {
    attributes = new Map();
    hidden = false;
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    toggleAttribute(name, value) { if (value) this.setAttribute(name, ''); else this.removeAttribute(name); }
    getAttribute(name) { return this.attributes.get(name); }
    click() { this.dispatchEvent(new Event('click')); }
  }
  let draws = 0;
  const context = new Proxy({}, { get: (_, name) => name === 'createRadialGradient'
    ? () => ({ addColorStop() {} })
    : () => { if (name === 'clearRect') draws++; }, set: () => true });
  const canvas = { getContext: () => contextAvailable ? context : null };
  const pause = new Element(), replay = new Element(), controls = new Element();
  controls.hidden = true;
  const root = new Element();
  root.querySelector = selector => ({ canvas, '.flow-controls': controls,
    '[data-flow-pause]': pause, '[data-flow-replay]': replay })[selector];
  root.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0, left: 0 });
  const motion = new EventTarget();
  motion.matches = reduced;
  const doc = new EventTarget();
  doc.hidden = false;
  doc.createElement = () => ({ getContext: () => context });
  const callbacks = new Map();
  let nextId = 0, intersection, resize;
  const win = {
    devicePixelRatio: 3,
    matchMedia: query => query.includes('reduced-motion') ? motion : { matches: true },
    requestAnimationFrame: callback => { callbacks.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => callbacks.delete(id),
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} disconnect() {} },
    IntersectionObserver: class { constructor(callback) { intersection = callback; } observe() {} disconnect() {} },
  };
  const dispose = mountDataFlow(root, win, doc);
  return { root, pause, replay, controls, canvas, dispose,
    get pending() { return callbacks.size; }, get draws() { return draws; },
    frame(now) { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(now)); },
    visible(value) { intersection([{ isIntersecting: value }]); },
    hidden(value) { doc.hidden = value; doc.dispatchEvent(new Event('visibilitychange')); },
    reduce(value) { motion.matches = value; motion.dispatchEvent(new Event('change')); },
    resize() { resize(); },
  };
}

test('hero pauses outside the viewport and in hidden tabs, then resumes one animation loop', () => {
  const s = scene();
  assert.equal(s.pending, 0);
  s.visible(true);
  assert.equal(s.pending, 1);
  s.frame(0);
  s.hidden(true);
  assert.equal(s.pending, 0);
  const draws = s.draws;
  s.frame(10000);
  assert.equal(s.draws, draws);
  s.hidden(false);
  s.visible(true);
  assert.equal(s.pending, 1);
  s.visible(false);
  assert.equal(s.pending, 0);
  s.dispose();
});

test('hero honors reduced motion on load and when the system preference changes', () => {
  const s = scene({ reduced: true });
  s.visible(true);
  assert.equal(s.pending, 0);
  assert.equal(s.controls.hidden, true);
  assert.ok(s.root.attributes.has('data-rendered'), 'the static canvas scene is rendered');
  s.reduce(false);
  assert.equal(s.controls.hidden, false);
  assert.equal(s.pending, 1);
  s.frame(0);
  s.reduce(true);
  assert.equal(s.pending, 0);
  assert.equal(s.controls.hidden, true);
  s.dispose();
});

test('manual pause survives visibility changes; replay resumes; disposal removes event handlers', () => {
  const s = scene();
  s.visible(true);
  s.pause.click();
  assert.equal(s.pause.getAttribute('aria-pressed'), 'true');
  assert.equal(s.pending, 0);
  s.visible(false);
  s.visible(true);
  s.hidden(true);
  s.hidden(false);
  assert.equal(s.pending, 0);
  s.replay.click();
  assert.equal(s.pause.getAttribute('aria-pressed'), 'false');
  assert.equal(s.pending, 1);
  s.dispose();
  assert.equal(s.pending, 0);
  const draws = s.draws;
  s.replay.click();
  s.reduce(true);
  s.hidden(true);
  assert.equal(s.draws, draws);
  assert.equal(s.pending, 0);
});

test('hero bounds rendering resolution and frame rate without creating duplicate loops on resize', () => {
  const s = scene();
  assert.equal(s.canvas.width, 1200);
  assert.equal(s.canvas.height, 900);
  s.visible(true);
  s.frame(0);
  const draws = s.draws;
  s.frame(16);
  assert.equal(s.draws, draws);
  s.frame(34);
  assert.equal(s.draws, draws + 1);
  s.resize();
  assert.equal(s.pending, 1);
  s.dispose();
});

test('hero keeps its SVG fallback and hides animation controls when Canvas is unavailable', () => {
  const s = scene({ contextAvailable: false });
  assert.equal(s.pending, 0);
  assert.equal(s.controls.hidden, true);
  assert.equal(s.root.attributes.has('data-rendered'), false);
  assert.equal(s.draws, 0);
  s.dispose();
});
