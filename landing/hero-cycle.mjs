import { mountVariant } from './variants/engine.mjs';
import { HERO_STORAGE_KEY, selectNextVariant } from './hero-selection.mjs';

const selections = new WeakMap();
const mounts = new WeakMap();
const sceneLoaders = {
  clouds: () => import('./variants/clouds.mjs'),
  glyphs: () => import('./variants/glyphs.mjs'),
  ribbons: () => import('./variants/ribbons.mjs'),
  voids: () => import('./variants/voids.mjs'),
};

function selectForDocument(doc, win) {
  if (!selections.has(doc)) {
    const choose = () => {
      let storage;
      try { storage = win.localStorage; } catch { /* SecurityError on access. */ }
      return selectNextVariant(storage);
    };
    let selection;
    try {
      // Serialize simultaneous tabs where Web Locks is available. The lock is
      // held only for the synchronous read/write, never during scene loading.
      selection = win.navigator?.locks?.request
        ? win.navigator.locks.request(HERO_STORAGE_KEY, choose)
        : choose();
    } catch { selection = choose(); }
    selections.set(doc, Promise.resolve(selection).catch(choose));
  }
  return selections.get(doc);
}

export function mountHeroCycle(root, win = window, doc = document, {
  loadScene = id => sceneLoaders[id](), mountScene = mountVariant,
} = {}) {
  if (!root) return Promise.resolve(() => {});
  if (mounts.has(root)) return mounts.get(root);
  const ready = (async () => {
    const variant = await selectForDocument(doc, win);
    root.setAttribute('data-variant', variant);
    doc.body?.setAttribute('data-variant', variant);
    const poster = root.querySelector('.data-flow-fallback');
    if (poster) poster.setAttribute('src', `/variants/${variant}-poster.jpg`);
    // Select and persist exactly once per document. Pause, replay, resize and
    // a second mount reuse the chosen scene instead of consuming another turn.
    try {
      const { createScene } = await loadScene(variant);
      return mountScene(createScene, root, win, doc);
    } catch {
      root.removeAttribute('data-rendered');
      const controls = root.querySelector('.flow-controls');
      if (controls) controls.hidden = true;
      return () => {};
    }
  })();
  mounts.set(root, ready);
  return ready;
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-flow]');
  if (root) void mountHeroCycle(root);
}
