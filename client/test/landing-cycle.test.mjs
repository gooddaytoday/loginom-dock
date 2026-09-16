import test from 'node:test';
import assert from 'node:assert/strict';
import { HERO_VARIANTS, HERO_STORAGE_KEY, selectNextVariant } from '../../landing/hero-selection.mjs';
import { mountHeroCycle } from '../../landing/hero-cycle.mjs';

function storageFor(backing = new Map()) {
  const reads = [], writes = [];
  return {
    backing, reads, writes,
    getItem(key) { reads.push(key); return backing.get(key) ?? null; },
    setItem(key, value) { writes.push([key, value]); backing.set(key, value); },
  };
}

function pageFixture({ storage = storageFor(), reduced = false } = {}) {
  class Element extends EventTarget {
    attributes = new Map();
    hidden = false;
    textContent = '';
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    hasAttribute(name) { return this.attributes.has(name); }
    toggleAttribute(name, value) { if (value) this.setAttribute(name, ''); else this.removeAttribute(name); }
    click() { this.dispatchEvent(new Event('click')); }
    get dataset() {
      const attribute = key => `data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
      return new Proxy({}, {
        get: (_, key) => this.getAttribute(attribute(key)) ?? undefined,
        set: (_, key, value) => { this.setAttribute(attribute(key), value); return true; },
      });
    }
  }
  const root = new Element(), body = new Element(), poster = new Element(), description = new Element();
  const controls = new Element(), pause = new Element(), replay = new Element(), canvas = new Element();
  const motion = new Element(), pointer = new Element(), doc = new Element(), win = new Element();
  motion.matches = reduced;
  pointer.matches = true;
  controls.hidden = true;
  const context = { reset() {}, setTransform() {}, clearRect() {} };
  canvas.getContext = () => context;
  root.getBoundingClientRect = () => ({ width: 900, height: 630, left: 0, top: 0 });
  root.querySelector = selector => ({
    '.data-flow-fallback': poster, '.sr-only': description, canvas,
    '.flow-controls': controls, '[data-flow-pause]': pause, '[data-flow-replay]': replay,
  })[selector] ?? null;
  doc.body = body;
  doc.hidden = false;
  doc.querySelector = selector => selector === '[data-flow]' ? root : null;
  doc.createElement = () => ({ getContext: () => context });
  const pending = new Map();
  let nextFrame = 0;
  Object.assign(win, {
    localStorage: storage, innerHeight: 720, devicePixelRatio: 1,
    matchMedia: query => query.includes('reduced-motion') ? motion : pointer,
    requestAnimationFrame(callback) { pending.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { pending.delete(id); },
  });
  return {
    root, body, poster, description, controls, pause, replay, canvas, doc, win, storage,
    frame(now) { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(now)); },
    get pendingFrames() { return pending.size; },
  };
}

test('hero rotation starts with clouds and keeps the agreed four-variant order', () => {
  assert.deepEqual(HERO_VARIANTS, ['clouds', 'glyphs', 'ribbons', 'voids']);
  assert.equal(HERO_STORAGE_KEY, 'loginom-dock.hero.next-variant.v1');
  const storage = storageFor();
  const shown = Array.from({ length: 13 }, () => selectNextVariant(storage));
  assert.deepEqual(shown, [
    'clouds', 'glyphs', 'ribbons', 'voids',
    'clouds', 'glyphs', 'ribbons', 'voids',
    'clouds', 'glyphs', 'ribbons', 'voids', 'clouds',
  ]);
  assert.equal(storage.backing.get(HERO_STORAGE_KEY), 'glyphs');
});

test('the next hero survives new page storage wrappers and touches only its own key', () => {
  const backing = new Map([['unrelated-setting', 'preserve me']]);
  const firstPage = storageFor(backing);
  assert.equal(selectNextVariant(firstPage), 'clouds');
  assert.deepEqual(firstPage.reads, [HERO_STORAGE_KEY]);
  assert.deepEqual(firstPage.writes, [[HERO_STORAGE_KEY, 'glyphs']]);

  const nextPage = storageFor(backing);
  assert.equal(selectNextVariant(nextPage), 'glyphs');
  assert.deepEqual(nextPage.reads, [HERO_STORAGE_KEY]);
  assert.deepEqual(nextPage.writes, [[HERO_STORAGE_KEY, 'ribbons']]);
  assert.deepEqual([...backing], [
    ['unrelated-setting', 'preserve me'], [HERO_STORAGE_KEY, 'ribbons'],
  ]);
});

test('each persisted variant is the next selection, including wraparound after voids', () => {
  for (const [current, next] of [
    ['clouds', 'glyphs'], ['glyphs', 'ribbons'], ['ribbons', 'voids'], ['voids', 'clouds'],
  ]) {
    const storage = storageFor(new Map([[HERO_STORAGE_KEY, current]]));
    assert.equal(selectNextVariant(storage), current);
    assert.deepEqual(storage.writes, [[HERO_STORAGE_KEY, next]]);
  }
});

test('missing or malformed stored IDs restart deterministically and heal the saved next ID', () => {
  for (const value of [null, '', '0', '1', '4', '-1', 'NaN', 'undefined', 'null',
    'clouds ', ' glyphs', 'GLYPHS', 'workflow', '["clouds"]', '{"next":"voids"}', '__proto__']) {
    const storage = storageFor(value === null ? new Map() : new Map([[HERO_STORAGE_KEY, value]]));
    assert.equal(selectNextVariant(storage), 'clouds', `invalid value ${JSON.stringify(value)}`);
    assert.deepEqual(storage.writes, [[HERO_STORAGE_KEY, 'glyphs']]);
  }
});

test('unavailable storage still selects the first scene without throwing', () => {
  assert.equal(selectNextVariant(undefined), 'clouds');
  assert.equal(selectNextVariant(null), 'clouds');
  const writes = [];
  assert.equal(selectNextVariant({
    getItem() { throw new DOMException('Storage is disabled', 'SecurityError'); },
    setItem(key, value) { writes.push([key, value]); },
  }), 'clouds');
  assert.deepEqual(writes, [[HERO_STORAGE_KEY, 'glyphs']]);
  assert.equal(selectNextVariant({
    getItem() { throw new DOMException('Storage is disabled', 'SecurityError'); },
    setItem() { throw new DOMException('Storage is disabled', 'SecurityError'); },
  }), 'clouds');
});

test('a failed persistence write does not discard the valid scene that was read', () => {
  for (const selected of HERO_VARIANTS) {
    const writes = [];
    const result = selectNextVariant({
      getItem(key) { assert.equal(key, HERO_STORAGE_KEY); return selected; },
      setItem(key, value) {
        writes.push([key, value]);
        throw new DOMException('Storage quota reached', 'QuotaExceededError');
      },
    });
    assert.equal(result, selected);
    assert.deepEqual(writes, [[HERO_STORAGE_KEY, HERO_VARIANTS[(HERO_VARIANTS.indexOf(selected) + 1) % 4]]]);
  }
});

test('one page lazily mounts only its selected scene and pause/replay do not advance rotation', async () => {
  const storage = storageFor(new Map([[HERO_STORAGE_KEY, 'ribbons']]));
  const p = pageFixture({ storage });
  const loaded = [], frames = [];
  const loadScene = async id => {
    loaded.push(id);
    assert.equal(p.poster.getAttribute('src'), '/variants/ribbons-poster.jpg', 'fallback changes before module loading');
    return { createScene: () => ({ draw: (_, frame) => frames.push(frame) }) };
  };
  const ready = mountHeroCycle(p.root, p.win, p.doc, { loadScene });
  const repeated = mountHeroCycle(p.root, p.win, p.doc, { loadScene });
  assert.equal(ready, repeated, 'concurrent bootstrap shares its pending mount');
  const dispose = await ready;
  assert.deepEqual(loaded, ['ribbons']);
  assert.equal(p.root.getAttribute('data-variant'), 'ribbons');
  assert.equal(p.body.getAttribute('data-variant'), 'ribbons');
  assert.equal(p.root.getAttribute('data-rendered'), '');
  assert.equal(p.controls.hidden, false);
  p.frame(0);
  p.frame(1000);
  assert.equal(frames.at(-1).time, 1);
  p.pause.click();
  assert.equal(p.pause.getAttribute('aria-pressed'), 'true');
  assert.equal(p.pendingFrames, 0);
  p.replay.click();
  assert.equal(p.pause.getAttribute('aria-pressed'), 'false');
  assert.equal(frames.at(-1).time, 0);
  assert.equal(p.pendingFrames, 1);
  assert.equal(await mountHeroCycle(p.root, p.win, p.doc, { loadScene }), dispose);
  assert.deepEqual(storage.reads, [HERO_STORAGE_KEY]);
  assert.deepEqual(storage.writes, [[HERO_STORAGE_KEY, 'voids']]);
  assert.deepEqual(loaded, ['ribbons']);
  dispose();
  assert.equal(p.pendingFrames, 0);
});

test('multiple roots in one document reuse selection; a new document takes the next scene', async () => {
  const storage = storageFor(), first = pageFixture({ storage }), replacement = pageFixture({ storage });
  const loaded = [];
  const options = {
    loadScene: async id => { loaded.push(id); return { createScene() {} }; },
    mountScene: () => () => {},
  };
  await mountHeroCycle(first.root, first.win, first.doc, options);
  await mountHeroCycle(replacement.root, first.win, first.doc, options);
  assert.deepEqual(loaded, ['clouds', 'clouds']);
  assert.equal(replacement.root.getAttribute('data-variant'), 'clouds');
  assert.deepEqual(storage.writes, [[HERO_STORAGE_KEY, 'glyphs']]);
  const reloaded = pageFixture({ storage });
  await mountHeroCycle(reloaded.root, reloaded.win, reloaded.doc, options);
  assert.deepEqual(loaded, ['clouds', 'clouds', 'glyphs']);
  assert.deepEqual(storage.writes, [[HERO_STORAGE_KEY, 'glyphs'], [HERO_STORAGE_KEY, 'ribbons']]);
});

test('a rejected scene import keeps its chosen poster and does not consume a second turn', async () => {
  const p = pageFixture({ storage: storageFor(new Map([[HERO_STORAGE_KEY, 'voids']])) });
  let imports = 0, mounts = 0;
  p.controls.hidden = false;
  p.root.setAttribute('data-rendered', '');
  const options = {
    loadScene: async id => {
      imports++;
      assert.equal(id, 'voids');
      assert.equal(p.poster.getAttribute('src'), '/variants/voids-poster.jpg');
      throw new Error('Scene download failed');
    },
    mountScene() { mounts++; },
  };
  const dispose = await mountHeroCycle(p.root, p.win, p.doc, options);
  assert.equal(typeof dispose, 'function');
  dispose();
  await mountHeroCycle(p.root, p.win, p.doc, options);
  assert.equal(imports, 1);
  assert.equal(mounts, 0);
  assert.equal(p.controls.hidden, true);
  assert.equal(p.root.hasAttribute('data-rendered'), false);
  assert.equal(p.poster.getAttribute('src'), '/variants/voids-poster.jpg');
  assert.deepEqual(p.storage.writes, [[HERO_STORAGE_KEY, 'clouds']]);
});

test('scene startup failures also preserve the selected fallback', async () => {
  const p = pageFixture({ storage: storageFor(new Map([[HERO_STORAGE_KEY, 'glyphs']])) });
  const dispose = await mountHeroCycle(p.root, p.win, p.doc, {
    loadScene: async () => ({ createScene() {} }),
    mountScene() { throw new Error('Canvas cannot initialize'); },
  });
  assert.equal(typeof dispose, 'function');
  assert.equal(p.poster.getAttribute('src'), '/variants/glyphs-poster.jpg');
  assert.equal(p.controls.hidden, true);
  assert.equal(p.root.hasAttribute('data-rendered'), false);
  assert.deepEqual(p.storage.writes, [[HERO_STORAGE_KEY, 'ribbons']]);
});

test('missing hero root leaves storage untouched and inaccessible localStorage still renders', async () => {
  const p = pageFixture();
  let loads = 0;
  const options = {
    loadScene: async id => { loads++; assert.equal(id, 'clouds'); return { createScene() {} }; },
    mountScene: () => () => {},
  };
  const absent = await mountHeroCycle(null, p.win, p.doc, options);
  assert.equal(typeof absent, 'function');
  assert.equal(loads, 0);
  assert.deepEqual(p.storage.reads, []);
  assert.deepEqual(p.storage.writes, []);
  Object.defineProperty(p.win, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } });
  await mountHeroCycle(p.root, p.win, p.doc, options);
  assert.equal(loads, 1);
  assert.equal(p.poster.getAttribute('src'), '/variants/clouds-poster.jpg');
});

test('storage selection is locked across documents but module loading happens after lock release', async () => {
  const storage = storageFor(), pages = [pageFixture({ storage }), pageFixture({ storage })];
  const requested = [], loaded = [];
  let locked = false, tail = Promise.resolve();
  const locks = { request(name, choose) {
    requested.push(name);
    const result = tail.then(() => {
      locked = true;
      try { return choose(); } finally { locked = false; }
    });
    tail = result;
    return result;
  } };
  for (const p of pages) p.win.navigator = { locks };
  const options = {
    loadScene: async id => {
      assert.equal(locked, false, 'lazy download must not hold the inter-tab storage lock');
      loaded.push(id);
      return { createScene() {} };
    },
    mountScene: () => () => {},
  };
  await Promise.all(pages.map(p => mountHeroCycle(p.root, p.win, p.doc, options)));
  assert.deepEqual(requested, [HERO_STORAGE_KEY, HERO_STORAGE_KEY]);
  assert.deepEqual(loaded, ['clouds', 'glyphs']);
  assert.deepEqual(storage.writes, [[HERO_STORAGE_KEY, 'glyphs'], [HERO_STORAGE_KEY, 'ribbons']]);
});

test('unavailable Web Locks falls back to one deterministic selection', async () => {
  for (const request of [() => { throw new Error('Locks denied'); }, () => Promise.reject(new Error('Locks denied'))]) {
    const p = pageFixture();
    p.win.navigator = { locks: { request } };
    await mountHeroCycle(p.root, p.win, p.doc, {
      loadScene: async id => { assert.equal(id, 'clouds'); return { createScene() {} }; },
      mountScene: () => () => {},
    });
    assert.deepEqual(p.storage.writes, [[HERO_STORAGE_KEY, 'glyphs']]);
  }
});
