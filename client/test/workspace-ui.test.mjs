import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeWorkspaceUiCode, validateUiAction } from '../lib/workspace-ui.mjs';
import { assertActionOutcome } from '../lib/action-catalog.mjs';

const build = '7.5.0-alpha+build.49202', origin = 'https://loginom.test';
const clone = value => JSON.parse(JSON.stringify(value));

// This small DOM is an external UI double, not a replacement of the production
// observer/guards. Every test executes the full serialized browser capability.
function matches(element, selector) {
  if (selector.includes(',')) return selector.split(',').some(part => matches(element, part));
  selector = selector.trim();
  const not = [...selector.matchAll(/:not\(([^)]+)\)/g)];
  if (not.some(([, inner]) => matches(element, inner))) return false;
  selector = selector.replace(/:not\([^)]+\)/g, '');
  if (selector === ':disabled') return !!element.disabled;
  const tag = selector.match(/^[a-z]+/i)?.[0];
  if (tag && element.tagName !== tag.toUpperCase()) return false;
  for (const [, name, value] of selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
    if (!element.hasAttribute(name) || (value !== undefined && element.getAttribute(name) !== value)) return false;
  }
  for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!element.classList.contains(name)) return false;
  return true;
}
class Element {
  constructor(tag = 'div', attrs = {}, text = '', box = { x: 0, y: 0, width: 10, height: 10 }) {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.ownText = text;
    this.children = []; this.parentElement = null; this.box = box; this.style = {};
    this.value = ''; this.readOnly = false; this.disabled = false;
    this.classList = { contains: name => (this.attrs.class ?? '').split(' ').includes(name) };
  }
  append(...elements) { for (const element of elements) { this.children.push(element); element.parentElement = this; } return elements.at(-1); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(element => element !== this); this.parentElement = null; }
  get isConnected() { return this.root || !!this.parentElement?.isConnected; }
  get isContentEditable() { return this.attrs.contenteditable === 'true'; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(' '); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  getBoundingClientRect() { return { ...this.box }; }
  matches(selector) { return matches(this, selector); }
  closest(selector) { for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element; return null; }
  contains(other) { for (let element = other; element; element = element.parentElement) if (element === this) return true; return false; }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelectorAll(selector) { return this.descendants().filter(element => element.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
class Document {
  constructor() {
    this.documentElement = new Element('html', {}, '', { x: 0, y: 0, width: 1000, height: 800 }); this.documentElement.root = true;
    this.body = this.documentElement.append(new Element('body', {}, '', { x: 0, y: 0, width: 1000, height: 800 }));
    this.activeElement = this.body;
  }
  all() { return [this.documentElement, ...this.documentElement.descendants()]; }
  querySelectorAll(selector) { return this.all().filter(element => element.matches(selector)); }
  createTreeWalker(element, kind) {
    if (kind === 1) { const items = element.descendants(); let index=0; return { nextNode: () => items[index++] ?? null }; }
    const text = [element, ...element.descendants()].filter(item => item.ownText).map(item => ({ parentElement: item, textContent: item.ownText }));
    let index = 0; return { nextNode: () => text[index++] ?? null };
  }
  elementFromPoint(x, y) {
    return this.all().filter(element => element.style.display !== 'none' && element.style.visibility !== 'hidden' && x >= element.box.x && y >= element.box.y
      && x <= element.box.x + element.box.width && y <= element.box.y + element.box.height).at(-1) ?? null;
  }
}
class Handle {
  constructor(page, element) { this.page = page; this.element = element; }
  async evaluate(fn, arg) {
    if (fn.toString().includes('getBoundingClientRect')) this.page.beforeHandleGeometry?.(this.element);
    return fn(this.element, arg);
  }
  async isVisible() { return this.element.isConnected && this.element.style.display !== 'none'; }
  async isEnabled() { return !this.element.disabled; }
  async boundingBox() { this.page.playwrightBoxReads++; return this.element.isConnected ? { ...this.element.box, ...this.page.playwrightBox } : null; }
  async click() { this.page.events.push('click'); this.page.document.activeElement = this.element; }
  async dblclick() { this.page.events.push('double_click'); this.page.document.activeElement = this.element; }
  async press(key) {
    this.page.events.push(key);
    if (key === 'ControlOrMeta+A') this.page.selectedAll = true;
    if (key === 'Backspace' && this.page.selectedAll) this.element.value = '';
    if (key === 'Enter') this.page.committed = this.element.value;
  }
  async dispose() { this.page.disposed++; }
}
class Page {
  constructor() {
    this.document = new Document(); this.events = []; this.disposed = 0; this.location = { origin }; this.clickedPoints = []; this.playwrightBoxReads = 0;
    this.app = { Version: build };
    this.avatar = this.add('button', 'MF;cntMain;tlbMainToolbar;btnAvatar', '', { x: 950, y: 0, width: 30, height: 20 });
    this.tab = this.add('div', 'MF;cntMain;cntWorkspace;Workspace;t.br;tb-1', 'Сценарий', { x: 10, y: 5, width: 100, height: 20 });
    this.tab.attrs.class = 'x-tab-active';
    const page = this;
    class MutationObserverFixture {
      constructor(callback) { this.callback=callback; this.pending=[]; page.mutationObserver=this; }
      observe(root, options) { this.root=root; this.options=options; }
      takeRecords() { return this.pending.splice(0); }
    }
    this.context = vm.createContext({ document: this.document, location: this.location, bg: { app: this.app },
      MutationObserver: MutationObserverFixture,
      getComputedStyle: element => ({ display: 'block', visibility: 'visible', opacity: '1', ...element.style }), Date, Math });
    this.keyboard = { type: async text => {
      this.events.push('keyboard_type'); const element = this.document.activeElement;
      element.value = this.selectedAll ? text : element.value + text; this.selectedAll = false;
    } };
    this.mouse = {
      click: async (x, y, { clickCount, button }) => {
        this.clickedButton = button;
        this.events.push(clickCount === 2 ? 'double_click' : 'click'); this.clickedPoints.push({ x, y, clickCount });
        this.document.activeElement = this.document.elementFromPoint(x, y);
        if (this.failClick) { this.mouseHeld = true; throw new Error('Click response lost'); }
      },
      move: async (x, y) => { this.events.push('mouse_move'); if (this.mouseHeld && this.failDrag) throw new Error('lost browser response with secret=thismustnotleak'); this.point = { x, y }; },
      down: async () => { this.events.push('mouse_down'); this.mouseHeld = true; },
      up: async options => { this.releasedButton = options?.button; this.events.push('mouse_up'); if (this.failRelease) throw new Error('mouse release interrupted'); this.mouseHeld = false; },
    };
  }
  add(tag, tid, text = '', box = { x: 30, y: 100, width: 100, height: 25 }, parent = this.document.body) { return parent.append(new Element(tag, tid ? { 'data-tid': tid } : {}, text, box)); }
  async evaluate(fn, arg) { return fn(arg); }
  viewportSize() { return { width: 1000, height: 800 }; }
  locator(selector) {
    let [anchor, ...steps] = selector.split(' > ');
    let elements = this.document.querySelectorAll(anchor);
    for (const step of steps) { const index = Number(step.match(/nth-child\((\d+)\)/)[1]) - 1; elements = elements.map(element => element.children[index]).filter(Boolean); }
    return { count: async () => elements.length, elementHandle: async () => new Handle(this, elements[0]) };
  }
  async execute(options) { return clone(await vm.runInContext(`(${makeWorkspaceUiCode({ expected_build: build, expected_origin: origin, ...options })})`, this.context)(this)); }
  async observe() { const outcome = await this.execute({ mode: 'observe' }); assertActionOutcome(outcome); assert.equal(outcome.status, 'SUCCEEDED'); return outcome.output; }
  async act(action, snapshot) { return this.execute({ mode: 'act', operation_id: 'test-primitive', action, snapshot }); }
}

test('fixed observation remains available during masks and login, bounds evidence, and never reads password controls', async () => {
  const page = new Page(); page.avatar.remove();
  const password = page.add('input', 'LoginForm;Login;edtPassword'); password.attrs.type = 'password';
  Object.defineProperty(password, 'value', { get() { throw new Error('Password value must never be read'); } });
  page.add('div', null, 'Вычисление', { x: 20, y: 200, width: 100, height: 20 }).attrs.class = 'bg-mask-message';
  page.add('div', null, 'Не удалось прочитать файл', { x: 20, y: 250, width: 200, height: 20 }).attrs.role = 'alert';
  const snapshot = await page.observe();
  assert.equal(snapshot.authenticated, false);
  assert.equal(snapshot.ui.masks[0].text, 'Вычисление');
  assert.equal(snapshot.ui.messages[0].text, 'Не удалось прочитать файл');
  assert.ok(!snapshot.ui.elements.some(element => element.tid?.includes('Password')));
  for (let index = 0; index < 250; index++) page.add('button', `button-${index}`, String(index));
  const bounded = await page.observe(); assert.equal(bounded.ui.elements.length, 240); assert.equal(bounded.ui.truncated.elements, true);
});

test('observation supplies real graph references, visible editor settings, dialogs and table text', async () => {
  const page = new Page();
  page.add('div', 'MF;TF-1;Graph;Источник', '', { x: 200, y: 100, width: 100, height: 50 });
  page.add('span', 'MF;TF-1;Graph;Источник;Label;Label', 'Источник', { x: 200, y: 100, width: 80, height: 20 });
  page.add('div', 'MF;TF-1;Graph;Источник;Output_Data-0', '', { x: 290, y: 120, width: 10, height: 10 });
  page.add('div', 'MF;TF-1;Graph;Источник|Output_Data-0|Приёмник|Input_Data-0');
  const dialog = page.add('div', 'Dialog', '', { x: 400, y: 100, width: 300, height: 300 }); dialog.attrs.role = 'dialog'; dialog.attrs['aria-label'] = 'Настройка';
  const field = page.add('textarea', null, '', { x: 450, y: 150, width: 150, height: 80 }, dialog); field.value = 'a;b\n1;2';
  const table = page.add('table', null, '', { x: 20, y: 450, width: 200, height: 100 });
  page.add('td', null, '42', { x: 20, y: 450, width: 100, height: 20 }, table);
  const snapshot = await page.observe();
  assert.equal(snapshot.nodes[0].node_ref.node_label, 'Источник'); assert.equal(snapshot.nodes[0].ports.length, 1);
  assert.equal(snapshot.links.length, 1); assert.equal(snapshot.ui.dialogs[0].title, 'Настройка');
  const observedField = snapshot.ui.elements.find(element => element.kind === 'field');
  assert.equal(observedField.value, 'a;b\n1;2'); assert.deepEqual(observedField.identity, { anchor_tid: 'Dialog', path: [0] });
  assert.equal(snapshot.ui.table_cells[0].text, '42');
});

function deleteConfirmation(page, { id = 'msgbox-1', y = 340, z = 19000 } = {}) {
  const dialog = page.add('div', null, 'Удалить выделенную связь?', { x: 460, y, width: 280, height: 140 });
  dialog.attrs.class = 'x-window x-message-box'; dialog.style.zIndex = String(z);
  const yes = page.add('a', id + ';tlb;yes', 'Удалить', { x: 500, y: y + 90, width: 90, height: 25 }, dialog);
  const no = page.add('a', id + ';tlb;no', 'Нет', { x: 610, y: y + 90, width: 70, height: 25 }, dialog);
  return { dialog, yes, no };
}

test('native message-box anchor buttons are actionable inside a foreground dialog above its masked workspace', async () => {
  const page = new Page();
  page.add('span', 'MF;TF-1;Graph;Источник;Label;Label', 'Источник');
  page.add('span', 'MF;TF-1;Graph;Приёмник;Label;Label', 'Приёмник');
  page.add('g', 'MF;TF-1;Graph;Источник;Output_Data-0');
  page.add('g', 'MF;TF-1;Graph;Приёмник;Input_Data-0');
  const edge = page.add('g', 'MF;TF-1;Graph;Источник|Output_Data-0|Приёмник|Input_Data-0');
  const background = page.add('div', null, 'Компоненты Импорт Текстовый файл Калькулятор', { x: 40, y: 70, width: 900, height: 700 });
  background.attrs.class = 'bg-mask-message'; background.attrs['bg-mask-text'] = '';
  const { dialog, yes } = deleteConfirmation(page);
  const snapshot = await page.observe(), buttons = snapshot.ui.elements.filter(element => element.scope === 'dialog');
  assert.deepEqual(buttons.map(element => element.label), ['Удалить', 'Нет']);
  assert.ok(buttons.every(element => element.signature.dialog_ref === snapshot.ui.dialogs[0].ref && element.allowed_actions.includes('click')));
  assert.equal(snapshot.ui.truncated.elements, false);
  assert.equal(snapshot.ui.masks[0].kind, 'modal_background'); assert.equal(snapshot.ui.masks[0].text, '');
  const click = page.mouse.click;
  page.mouse.click = async (...args) => { await click(...args); if (page.document.activeElement === yes) { edge.remove(); dialog.remove(); background.remove(); } };
  const result = await page.act({ verb: 'click', ref: buttons[0].ref }, snapshot);
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(page.clickedPoints.length, 1);
  assert.deepEqual(result.output.links, []); assert.equal(result.output.nodes.length, 2);
  assert.deepEqual(result.output.nodes.map(node => node.ports.length), [1, 1]);
  assert.deepEqual(result.output.ui.dialogs, []); assert.deepEqual(result.output.ui.masks, []);
});

test('a modal background never permits workspace controls or controls of a lower dialog', async () => {
  const page = new Page(); const button = page.add('button', 'Actions;btnRun', 'Выполнить');
  const mask = page.add('div', null, 'Компоненты', { x: 40, y: 70, width: 900, height: 700 }); mask.attrs.class = 'bg-mask-message'; mask.attrs['bg-mask-text'] = '';
  const lower = deleteConfirmation(page), top = deleteConfirmation(page, { id: 'msgbox-2', y: 510, z: 20000 });
  const snapshot = await page.observe();
  for (const tid of [button.getAttribute('data-tid'), lower.yes.getAttribute('data-tid')]) {
    const target = snapshot.ui.elements.find(element => element.tid === tid);
    for (const verb of ['click','right_click']) {
      const result = await page.act({ verb, ref: target.ref }, snapshot);
      assert.equal(result.status, 'NOT_APPLIED'); assert.equal(result.error.code, 'UI_MASKED');
    }
  }
  assert.deepEqual(page.clickedPoints, []);
  const allowed = snapshot.ui.elements.find(element => element.tid === top.no.getAttribute('data-tid'));
  const result = await page.act({ verb: 'click', ref: allowed.ref }, snapshot);
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(page.document.activeElement, top.no);
});

test('dialog, ancestor and painted external masks all prevent confirmation', async () => {
  for (const blocking of ['dialog_mask', 'ancestor_mask', 'external_mask', 'point_overlay']) {
    const page = new Page();
    const background = page.add('div', null, 'Компоненты', { x: 40, y: 70, width: 900, height: 700 }); background.attrs.class = 'bg-mask-message'; background.attrs['bg-mask-text'] = '';
    const { dialog, yes } = deleteConfirmation(page);
    const overlay = page.add('div', null, 'Ожидание', { ...yes.box }, blocking === 'dialog_mask' ? dialog : page.document.body);
    if (blocking !== 'point_overlay') { overlay.attrs.class = 'bg-mask-message'; overlay.attrs['bg-mask-text'] = 'Загрузка'; }
    if (blocking === 'ancestor_mask') { dialog.remove(); overlay.append(dialog); }
    const snapshot = await page.observe(), button = snapshot.ui.elements.find(element => element.tid === yes.getAttribute('data-tid'));
    const result = await page.act({ verb: 'click', ref: button.ref }, snapshot);
    assert.equal(result.status, 'NOT_APPLIED', blocking);
    assert.equal(result.error.code, ['dialog_mask', 'ancestor_mask'].includes(blocking) ? 'UI_MASKED' : 'UI_REFERENCE_OBSCURED', blocking);
    assert.deepEqual(page.clickedPoints, [], blocking);
  }
});

test('background loading text is preserved without blocking the exposed foreground dialog', async () => {
  for (const maskKind of ['loginom', 'ext']) {
    const page = new Page();
    const mask = page.add('div', null, maskKind === 'ext' ? 'Загрузка данных' : 'Компоненты Импорт', { x: 40, y: 70, width: 900, height: 700 });
    mask.attrs.class = maskKind === 'ext' ? 'x-mask-msg' : 'bg-mask-message';
    if (maskKind === 'loginom') mask.attrs['bg-mask-text'] = 'Загрузка данных';
    const { yes } = deleteConfirmation(page);
    const snapshot = await page.observe(), button = snapshot.ui.elements.find(element => element.tid === yes.getAttribute('data-tid'));
    assert.equal(snapshot.ui.masks[0].kind, 'modal_background'); assert.equal(snapshot.ui.masks[0].text, 'Загрузка данных');
    const result = await page.act({ verb: 'click', ref: button.ref }, snapshot);
    assert.equal(result.status, 'SUCCEEDED'); assert.equal(page.clickedPoints.length, 1); assert.equal(page.document.activeElement, yes);
  }
});

test('message-box discovery does not exempt anchors with navigation or script hrefs', async () => {
  for (const href of ['#', 'javascript:void(0)', 'https://external.test']) {
    const page = new Page(), { yes } = deleteConfirmation(page); yes.attrs.href = href;
    const snapshot = await page.observe(), button = snapshot.ui.elements.find(element => element.tid === yes.getAttribute('data-tid'));
    assert.ok(button); assert.deepEqual(button.allowed_actions, []);
    assert.throws(() => validateUiAction({ verb: 'click', ref: button.ref }, snapshot), /does not support/);
  }
});

test('opaque editor reference performs real keyboard input and leaves commit to a separate observed action', async () => {
  const page = new Page(), editor = page.add('textarea', null); editor.value = 'Старое имя';
  const snapshot = await page.observe(), field = snapshot.ui.elements.find(element => element.kind === 'field');
  const applied = await page.act({ verb: 'fill', ref: field.ref, text: 'Исправленное имя' }, snapshot);
  assert.equal(applied.status, 'SUCCEEDED'); assert.equal(applied.cleanup_complete, true);
  assert.equal(applied.output.gesture_applied, true); assert.equal(applied.output.verification_required, true);
  assert.equal(editor.value, 'Исправленное имя'); assert.equal(page.committed, undefined);
  assert.deepEqual(page.events, ['click', 'ControlOrMeta+A', 'keyboard_type']);
  const committed = await page.act({ verb: 'press', ref: field.ref, key: 'Enter' }, applied.output);
  assert.equal(committed.status, 'SUCCEEDED'); assert.equal(page.committed, 'Исправленное имя');
});

test('active graph editors and graph controls survive the cap, while inactive workflows are excluded', async () => {
  const page = new Page();
  for (let index = 0; index < 250; index++) page.add('button', `MF;TF-1;ModelForm;btnComponent-${index}`, String(index));
  const graph = page.add('div', 'MF;TF-1;ModelForm;cmpDiagram', '', { x: 300, y: 300, width: 500, height: 300 });
  page.add('textarea', null, '', { x: 350, y: 350, width: 100, height: 20 }, graph);
  page.add('span', 'MF;TF-1;Graph;Исправить;Label;Label', 'Исправить', { x: 350, y: 400, width: 100, height: 20 }, graph);
  page.add('button', 'MF;TF-2;ModelForm;btnOther', 'Неактивный сценарий');
  const snapshot = await page.observe();
  assert.equal(snapshot.ui.elements[0].scope, 'graph_editor');
  assert.deepEqual(snapshot.ui.elements[0].identity, { anchor_tid: 'MF;TF-1;ModelForm;cmpDiagram', path: [0] });
  assert.ok(snapshot.ui.elements.some(element => element.tid?.includes(';Graph;Исправить;Label;Label')));
  assert.ok(!snapshot.ui.elements.some(element => element.tid?.startsWith('MF;TF-2;')));
  assert.equal(snapshot.ui.truncated.elements, true);
});

test('same-looking replacement, changed value, and duplicate IDs cannot retarget an observed reference', async () => {
  for (const change of ['replacement', 'value', 'duplicate']) {
    const page = new Page(), field = page.add('input', 'Parameters;edtValue'); field.value = 'old';
    const snapshot = await page.observe(), ref = snapshot.ui.elements.find(element => element.tid === 'Parameters;edtValue').ref;
    if (change === 'replacement') { field.remove(); const replacement = page.add('input', 'Parameters;edtValue'); replacement.value = 'old'; }
    if (change === 'value') field.value = 'external change';
    if (change === 'duplicate') page.add('input', 'Parameters;edtValue');
    const outcome = await page.act({ verb: 'fill', ref, text: 'new' }, snapshot);
    assert.equal(outcome.status, 'NOT_APPLIED', change); assert.equal(outcome.error.code, 'UI_REFERENCE_STALE', change);
    assert.deepEqual(page.events, [], change); assert.equal(outcome.effect_possible, false);
  }
});

test('stable SVG DOM geometry dispatches the checked point even when Playwright reports a different box', async () => {
  for (const verb of ['click', 'double_click']) {
    const page = new Page();
    const shape = page.add('g', 'MF;TF-1;Graph;Узел', '', { x: 620, y: 372, width: 56, height: 76 });
    page.playwrightBox = { x: 620, y: 372, width: 56, height: 56 };
    const snapshot = await page.observe(), element = snapshot.ui.elements.find(item => item.tid === shape.getAttribute('data-tid'));
    const result = await page.act({ verb, ref: element.ref }, snapshot);
    assert.equal(result.status, 'SUCCEEDED'); assert.equal(page.playwrightBoxReads, 0);
    assert.deepEqual(page.clickedPoints, [{ x: 648, y: 410, clickCount: verb === 'click' ? 1 : 2 }]);
    assert.equal(page.document.activeElement, shape);
  }
});

test('a DOM geometry change during preflight is rejected before any checked-point click', async () => {
  const page = new Page(), shape = page.add('g', 'MF;TF-1;Graph;Узел');
  const snapshot = await page.observe(), element = snapshot.ui.elements.find(item => item.tid === shape.getAttribute('data-tid'));
  page.beforeHandleGeometry = target => { target.box.x += 4; };
  const result = await page.act({ verb: 'click', ref: element.ref }, snapshot);
  assert.equal(result.status, 'NOT_APPLIED'); assert.equal(result.error.code, 'UI_REFERENCE_STALE');
  assert.equal(result.effect_possible, false); assert.deepEqual(page.clickedPoints, []);
});

function bentSvgLink(page, { matrix = { a: 1, b: 0, c: 0, d: 1, e: 100, f: 100 }, box = { x: 100, y: 100, width: 200, height: 100 } } = {}) {
  const link = page.add('g', 'MF;TF-1;Graph;Источник|Output_Data-0|Приёмник|Input_Data-0', '', box);
  const path = page.add('path', null, '', box, link);
  path.getTotalLength = () => 300;
  path.getPointAtLength = length => length <= 100 ? { x: 0, y: length } : { x: length - 100, y: 100 };
  path.getScreenCTM = () => matrix;
  page.document.elementFromPoint = (x, y) => {
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    const local = { x: (matrix.d * (x - matrix.e) - matrix.c * (y - matrix.f)) / determinant,
      y: (-matrix.b * (x - matrix.e) + matrix.a * (y - matrix.f)) / determinant };
    const painted = (Math.abs(local.x) <= 1 && local.y >= 0 && local.y <= 100)
      || (Math.abs(local.y - 100) <= 1 && local.x >= 0 && local.x <= 200);
    return painted ? path : page.document.body;
  };
  return { link, path };
}

test('bent SVG link is clicked once on its actual painted geometry instead of empty bounding-box center', async () => {
  const page = new Page(); const { link, path } = bentSvgLink(page);
  assert.equal(page.document.elementFromPoint(200, 150), page.document.body);
  const snapshot = await page.observe(), element = snapshot.ui.elements.find(item => item.tid === link.getAttribute('data-tid'));
  const result = await page.act({ verb: 'click', ref: element.ref }, snapshot);
  assert.equal(result.status, 'SUCCEEDED'); assert.deepEqual(page.clickedPoints, [{ x: 150, y: 200, clickCount: 1 }]);
  assert.equal(page.document.activeElement, path);
  assert.ok(result.trace.some(event => event.event === 'ui_link_hit_point' && event.source === 'svg_geometry' && event.candidates_checked === 2));
});

test('SVG path points use their actual screen transform and already-valid center remains the first choice', async () => {
  const page = new Page();
  const { link, path } = bentSvgLink(page, { matrix: { a: 0, b: 2, c: -2, d: 0, e: 500, f: 100 }, box: { x: 300, y: 100, width: 200, height: 400 } });
  let snapshot = await page.observe(), element = snapshot.ui.elements.find(item => item.tid === link.getAttribute('data-tid'));
  const transformed = await page.act({ verb: 'click', ref: element.ref }, snapshot);
  assert.equal(transformed.status, 'SUCCEEDED'); assert.deepEqual(page.clickedPoints, [{ x: 300, y: 200, clickCount: 1 }]);
  page.document.elementFromPoint = () => path;
  path.getTotalLength = () => { throw new Error('No path sampling needed for a valid center'); };
  snapshot = await page.observe(); element = snapshot.ui.elements.find(item => item.tid === link.getAttribute('data-tid'));
  const centered = await page.act({ verb: 'click', ref: element.ref }, snapshot);
  assert.equal(centered.status, 'SUCCEEDED'); assert.deepEqual(page.clickedPoints.at(-1), { x: 400, y: 300, clickCount: 1 });
  assert.ok(centered.trace.some(event => event.event === 'ui_link_hit_point' && event.source === 'box_center' && event.candidates_checked === 1));
});

test('malformed SVG geometry and an actually covered link never become blind click retries', async () => {
  for (const failure of ['length', 'point', 'matrix', 'throw', 'covered', 'no_painted_point']) {
    const page = new Page(); const { link, path } = bentSvgLink(page);
    if (failure === 'length') path.getTotalLength = () => NaN;
    if (failure === 'point') path.getPointAtLength = () => ({ x: Infinity, y: 100 });
    if (failure === 'matrix') path.getScreenCTM = () => null;
    if (failure === 'throw') path.getPointAtLength = () => { throw new Error('Detached geometry'); };
    if (failure === 'covered') { const overlay = page.add('div', null, 'Overlay', { ...link.box }); page.document.elementFromPoint = () => overlay; }
    if (failure === 'no_painted_point') page.document.elementFromPoint = () => page.document.body;
    const snapshot = await page.observe(), element = snapshot.ui.elements.find(item => item.tid === link.getAttribute('data-tid'));
    const result = await page.act({ verb: 'click', ref: element.ref }, snapshot);
    assert.equal(result.status, 'NOT_APPLIED', failure); assert.equal(result.error.code, 'UI_REFERENCE_OBSCURED', failure);
    assert.equal(result.effect_possible, false, failure); assert.deepEqual(page.clickedPoints, [], failure);
  }
});

test('only exact graph-link identities admit painted zero-height SVG strokes', async () => {
  const page = new Page();
  const link = page.add('g', 'MF;TF-1;Graph;Источник|Output_Data-0|Приёмник|Input_Data-0', '', { x: 100, y: 100, width: 200, height: 0 });
  const stroke = page.add('path', null, '', { ...link.box }, link);
  page.document.elementFromPoint = (x, y) => x >= 100 && x <= 300 && Math.abs(y - 100) <= 1 ? stroke : page.document.body;
  page.add('button', 'Actions;btnEmpty', '', { ...link.box });
  page.add('g', link.getAttribute('data-tid') + ';SourceBend', '', { ...link.box });
  const snapshot = await page.observe(), element = snapshot.ui.elements.find(item => item.tid === link.getAttribute('data-tid'));
  assert.ok(element); assert.ok(!snapshot.ui.elements.some(item => item.tid === 'Actions;btnEmpty' || item.tid?.endsWith(';SourceBend')));
  const result = await page.act({ verb: 'click', ref: element.ref }, snapshot);
  assert.equal(result.status, 'SUCCEEDED'); assert.deepEqual(page.clickedPoints, [{ x: 200, y: 100, clickCount: 1 }]);
  link.style.visibility = 'hidden';
  const hidden = await page.observe(); assert.ok(!hidden.ui.elements.some(item => item.ref === element.ref));
});

test('an uncertain checked-point click releases the mouse and does not claim a completed gesture', async () => {
  const page = new Page(); page.failClick = true;
  const button = page.add('button', 'Controls;btnExecute', 'Выполнить');
  const snapshot = await page.observe(), element = snapshot.ui.elements.find(item => item.tid === button.getAttribute('data-tid'));
  const result = await page.act({ verb: 'click', ref: element.ref }, snapshot);
  assert.equal(result.status, 'AMBIGUOUS'); assert.equal(result.cleanup_complete, true);
  assert.equal(page.mouseHeld, false); assert.equal(page.events.filter(event => event === 'mouse_up').length, 1);
  assert.equal(result.output.gesture_applied, undefined);
});

test('UI actions reject changed context, masks, new dialogs, hidden and covered controls before mutation', async () => {
  for (const change of ['origin', 'build', 'workflow', 'mask', 'dialog', 'hidden', 'covered']) {
    const page = new Page(), button = page.add('button', 'Actions;btnRun', 'Выполнить');
    const snapshot = await page.observe(), ref = snapshot.ui.elements.find(element => element.tid === 'Actions;btnRun').ref;
    if (change === 'origin') page.location.origin = 'https://other.test';
    if (change === 'build') page.app.Version = 'different';
    if (change === 'workflow') page.tab.attrs['data-tid'] = 'MF;cntMain;cntWorkspace;Workspace;t.br;tb-2';
    if (change === 'mask') page.add('div', null, 'Ожидание').attrs.class = 'bg-mask-message';
    if (change === 'dialog') page.add('div', null, 'Предупреждение').attrs.role = 'dialog';
    if (change === 'hidden') button.style.display = 'none';
    if (change === 'covered') page.add('div', null, 'Overlay', { ...button.box });
    const outcome = await page.act({ verb: 'click', ref }, snapshot);
    assert.equal(outcome.status, 'NOT_APPLIED', change); assert.deepEqual(page.events, [], change);
  }
});

test('drag emits actual bounded mouse gestures and releases the mouse after a failure', async () => {
  for (const failure of [false, true]) {
    const page = new Page(); page.failDrag = failure;
    page.add('div', 'MF;TF-1;Graph;Источник;Output_Data-0', '', { x: 100, y: 100, width: 10, height: 10 });
    page.add('div', 'MF;TF-1;Graph;Приёмник;Input_Data-2', '', { x: 300, y: 100, width: 10, height: 10 });
    const snapshot = await page.observe(), ports = snapshot.ui.elements.filter(element => element.kind === 'port');
    const outcome = await page.act({ verb: 'drag', source_ref: ports[0].ref, target_ref: ports[1].ref }, snapshot);
    assert.equal(outcome.status, failure ? 'AMBIGUOUS' : 'SUCCEEDED'); assert.equal(outcome.cleanup_complete, true);
    assert.equal(page.mouseHeld, false); assert.equal(page.events.filter(event => event === 'mouse_up').length, 1);
    assert.ok(outcome.trace.some(event => event.event === 'cleanup_completed' && event.resource === 'mouse'));
    assert.ok(!JSON.stringify(outcome).includes('thismustnotleak'));
  }
});

test('unconfirmed mouse release is explicitly recorded and never reported as completed cleanup', async () => {
  const page = new Page(); page.failDrag = true; page.failRelease = true;
  page.add('div', 'MF;TF-1;Graph;A;Output_Data-0', '', { x: 100, y: 100, width: 10, height: 10 });
  page.add('div', 'MF;TF-1;Graph;B;Input_Data-0', '', { x: 300, y: 100, width: 10, height: 10 });
  const snapshot = await page.observe(), ports = snapshot.ui.elements.filter(element => element.kind === 'port');
  const outcome = await page.act({ verb: 'drag', source_ref: ports[0].ref, target_ref: ports[1].ref }, snapshot);
  assert.equal(outcome.status, 'AMBIGUOUS'); assert.equal(outcome.cleanup_complete, false); assert.equal(outcome.error.code, 'UI_CLEANUP_FAILED');
});

test('failure output observes the graph after finally mouse-up, including effects caused by release', async () => {
  const page = new Page(); page.failDrag = true;
  page.add('div', 'MF;TF-1;Graph;A;Output_Data-0', '', { x: 100, y: 100, width: 10, height: 10 });
  page.add('div', 'MF;TF-1;Graph;B;Input_Data-0', '', { x: 300, y: 100, width: 10, height: 10 });
  const originalUp = page.mouse.up;
  page.mouse.up = async () => { await originalUp(); page.add('span', 'MF;TF-1;Graph;Последствие;Label;Label', 'Последствие'); };
  const snapshot = await page.observe(), ports = snapshot.ui.elements.filter(element => element.kind === 'port');
  const outcome = await page.act({ verb: 'drag', source_ref: ports[0].ref, target_ref: ports[1].ref }, snapshot);
  assert.equal(outcome.status, 'AMBIGUOUS'); assert.equal(outcome.cleanup_complete, true);
  assert.deepEqual(outcome.output.nodes.map(node => node.node_ref.node_label), ['Последствие']);
  assert.equal(outcome.output.verification_required, true);
});

test('navigation links, URL/file/password fields and code editors are not actionable and model selectors are rejected', async () => {
  const page = new Page();
  const anchor = page.add('a', null, 'External'); anchor.attrs.href = 'https://external.test';
  page.add('button', 'Link;btnOpen', 'Открыть', undefined, anchor);
  for (const type of ['url', 'file', 'password']) { const input = page.add('input', `Field-${type}`); input.attrs.type = type; }
  const code = page.add('textarea', 'Editor;python'); code.value = 'not executed';
  const snapshot = await page.observe();
  for (const element of snapshot.ui.elements.filter(element => /Link;|Field-|python/.test(element.tid ?? ''))) assert.deepEqual(element.allowed_actions, []);
  assert.throws(() => validateUiAction({ verb: 'click', ref: 'ui-1', selector: 'body' }), /fields/);
  assert.throws(() => validateUiAction({ verb: 'press', ref: 'ui-1', key: 'ControlOrMeta+V' }), /Unsupported UI key/);
  assert.throws(() => validateUiAction({ verb: 'fill', ref: 'ui-1', text: 'x'.repeat(2049) }), /2048/);
  assert.throws(() => validateUiAction({ verb: 'click', ref: '[data-tid="foo"]' }), /opaque/);
  assert.throws(() => validateUiAction({ verb: 'click', ref: 'ui-missing' }, snapshot), /absent/);
});

test('palette spans provide observed references for enumeration without raw selectors', async () => {
  const page = new Page();
  const expander = page.add('span', 'MF;TF-1;ModelForm;colVendors_Компоненты>Импорт;TreeExpander', '', { x: 30, y: 50, width: 20, height: 20 });
  page.add('span', 'MF;TF-1;ModelForm;colVendors_Компоненты>Импорт>Текстовый_файл;TreeText', 'Текстовый файл');
  const snapshot = await page.observe();
  const target = snapshot.ui.elements.find(item => item.tid === expander.getAttribute('data-tid'));
  assert.ok(target?.allowed_actions.includes('click'));
  assert.ok(snapshot.ui.elements.some(item => item.label === 'Текстовый файл'));
  assert.equal((await page.act({ verb: 'click', ref: target.ref }, snapshot)).status, 'SUCCEEDED');
  expander.remove();
  assert.equal((await page.act({ verb: 'click', ref: target.ref }, snapshot)).status, 'NOT_APPLIED');
});

test('right click uses the checked ref and releases the right button after a lost reply', async () => {
  for (const failure of [false, true]) {
    const page = new Page();
    page.add('button', 'Node;btnMenu', 'Menu');
    const snapshot = await page.observe();
    const target = snapshot.ui.elements.find(e => e.tid === 'Node;btnMenu');
    validateUiAction({verb:'right_click',ref:target.ref},snapshot);
    page.failClick = failure;
    const outcome = await page.act({verb:'right_click',ref:target.ref},snapshot);
    assert.equal(page.clickedButton,'right');
    assert.equal(page.clickedPoints.length,1);
    assert.equal(outcome.status,failure ? 'AMBIGUOUS' : 'SUCCEEDED');
    assert.equal(outcome.cleanup_complete,true);
    if (failure) assert.equal(page.releasedButton,'right');
    else assert.ok(outcome.trace.some(e=>e.event==='ui_gesture_applied' && e.verb==='right_click'));
  }
  assert.throws(()=>validateUiAction({verb:'right_click',ref:'ui-one',x:100}), /fields/);
});

test('initial region discovery avoids a large document and only admits later detailed reads', async () => {
  const page=new Page();
  const form=page.add('div','Form;Main','',{x:30,y:100,width:300,height:100});form.attrs.role='form';form.attrs['aria-label']='Import settings';
  page.add('input','Form;edtInside','',{x:35,y:110,width:100,height:25},form);
  const background=page.add('div','Background');
  for(let i=0;i<6500;i++) page.add('div',null,'',{x:600,y:500,width:1,height:1},background);
  let visits=0;const original=page.document.createTreeWalker.bind(page.document);
  page.document.createTreeWalker=(node,kind)=>{visits++;return original(node,kind);};
  const discovered=await page.execute({mode:'observe',discover_roots:true});
  assert.equal(discovered.status,'SUCCEEDED');assert.equal(visits,0);
  assert.equal(discovered.output.observation_kind,'roots');
  const root=discovered.output.ui.elements.find(e=>e.tid==='Form;Main');
  assert.ok(root);assert.deepEqual(root.allowed_actions,[]);
  assert.equal(discovered.output.ui.truncated.masks,true);
  assert.throws(()=>validateUiAction({verb:'click',ref:root.ref},discovered.output),/does not support/);
  const detail=await page.execute({mode:'observe',root_ref:root.ref});
  assert.equal(detail.status,'SUCCEEDED');assert.ok(detail.output.ui.elements.some(e=>e.tid==='Form;edtInside'));
});

test('selected root traverses only its small subtree while a large background and global blocker remain outside', async () => {
  const page=new Page(),root=page.add('div','Form;btnSection','Section',{x:30,y:100,width:300,height:100});
  page.add('input','Form;edtInside','',{x:35,y:110,width:100,height:25},root);
  const initial=await page.observe(),ref=initial.ui.elements.find(e=>e.tid==='Form;btnSection').ref;
  const large=page.add('div','Background');
  for(let i=0;i<6500;i++) page.add('div',null,'',{x:600,y:500,width:1,height:1},large);
  assert.equal((await page.execute({mode:'observe'})).error.code,'UI_SCAN_LIMIT');
  let elementVisits=0;const original=page.document.createTreeWalker.bind(page.document);
  page.document.createTreeWalker=(node,kind)=>{
    const walker=original(node,kind);
    return {nextNode:()=>{const value=walker.nextNode();if(kind===1 && value) elementVisits++;return value;}};
  };
  const narrow=await page.execute({mode:'observe',root_ref:ref});
  assert.equal(narrow.status,'SUCCEEDED');assert.equal(elementVisits,1);
  assert.equal(narrow.output.scan.detail_elements,2);
  assert.equal(narrow.output.observation_root.global_scan,false);
  assert.equal(narrow.output.authenticated,true);assert.deepEqual(narrow.output.workflow_ref,initial.workflow_ref);
  assert.equal(narrow.output.ui.truncated.nodes,true);
  const mask=page.add('div',null,'Busy',{x:0,y:0,width:1000,height:800},large);mask.attrs.class='bg-mask-message';
  const blocked=await page.execute({mode:'observe',root_ref:ref});
  assert.equal(blocked.output.ui.masks.length,1);
  const target=blocked.output.ui.elements.find(e=>e.tid==='Form;edtInside');
  assert.equal((await page.act({verb:'fill',ref:target.ref,text:'x'},blocked.output)).error.code,'UI_MASKED');
  mask.remove();
  page.add('input','Form;edtInside','',{x:650,y:550,width:100,height:25},large);
  const duplicate=await page.execute({mode:'observe',root_ref:ref});
  const ambiguous=duplicate.output.ui.elements.find(e=>e.tid==='Form;edtInside');
  const denied=await page.act({verb:'fill',ref:ambiguous.ref,text:'x'},duplicate.output);
  assert.equal(denied.error.code,'UI_REFERENCE_STALE');
  assert.equal(denied.effect_possible,false);
});

test('root detail preserves global masks and rejects a detached root', async () => {
  const page=new Page(),root=page.add('div','Form;btnSection','Section',{x:30,y:100,width:300,height:100});
  const inside=page.add('input','Form;edtInside','',{x:35,y:110,width:100,height:25},root);
  page.add('input','Other;edtOutside','',{x:400,y:110,width:100,height:25});
  const initial=await page.observe(),ref=initial.ui.elements.find(e=>e.tid==='Form;btnSection').ref;
  const result=await page.execute({mode:'observe',root_ref:ref});
  assert.equal(result.status,'SUCCEEDED');
  assert.equal(result.output.authenticated,true);assert.deepEqual(result.output.workflow_ref,initial.workflow_ref);
  assert.equal(result.output.observation_root.ref,ref);
  assert.ok(result.output.ui.elements.some(e=>e.tid==='Form;edtInside'));
  assert.ok(!result.output.ui.elements.some(e=>e.tid==='Other;edtOutside'));
  assert.equal(result.output.ui.truncated.elements,true);
  const mask=page.add('div',null,'Busy',{x:0,y:0,width:1000,height:800});mask.attrs.class='bg-mask-message';
  const blocked=await page.execute({mode:'observe',root_ref:ref});
  assert.equal(blocked.output.ui.masks.length,1);
  const target=blocked.output.ui.elements.find(e=>e.tid===inside.getAttribute('data-tid'));
  assert.equal((await page.act({verb:'fill',ref:target.ref,text:'x'},blocked.output)).error.code,'UI_MASKED');
  root.remove();
  assert.equal((await page.execute({mode:'observe',root_ref:ref})).error.code,'UI_ROOT_STALE');
});

test('field observation labels bounded prefixes and never admits a gesture against an unseen suffix', async () => {
  const page=new Page();const field=page.add('textarea','Form;edtLong');
  field.value='x'.repeat(2048);
  const initial=await page.observe();const target=initial.ui.elements.find(e=>e.tid==='Form;edtLong');
  assert.equal(target.value_truncated,false);assert.equal(target.value_length_utf16,2048);
  assert.ok(target.allowed_actions.includes('fill'));
  field.value+='hidden suffix';
  const snapshot=await page.observe(),long=snapshot.ui.elements.find(e=>e.tid==='Form;edtLong');
  assert.equal(long.value.length,2048);assert.equal(long.value_truncated,true);
  assert.equal(long.value_length_utf16,2061);assert.deepEqual(long.allowed_actions,[]);
  assert.ok(!JSON.stringify(snapshot).includes('hidden suffix'));
  assert.equal((await page.act({verb:'fill',ref:target.ref,text:'replacement'},initial)).status,'NOT_APPLIED');
  assert.deepEqual(page.clickedPoints,[]);assert.equal(field.value.length,2061);
});

test('DOM epoch rejects ABA before any gesture and consumes pending mutation records', async () => {
  const page = new Page(); page.add('button','Safe;btnAction','Action');
  const before = await page.observe();
  const target = before.ui.elements.find(e=>e.tid==='Safe;btnAction');
  // The DOM has returned to A, but the browser queued the A→B and B→A records.
  page.mutationObserver.pending.push({},{});
  const outcome=await page.act({verb:'click',ref:target.ref},before);
  assert.equal(outcome.status,'NOT_APPLIED');assert.equal(outcome.error.code,'UI_EPOCH_CHANGED');
  assert.equal(outcome.effect_possible,false);assert.deepEqual(page.clickedPoints,[]);
  assert.equal(page.mutationObserver.pending.length,0);
  const fresh=await page.observe();assert.equal(fresh.dom_epoch.revision,2);
  assert.equal((await page.act({verb:'click',ref:target.ref},fresh)).status,'SUCCEEDED');
  page.mutationObserver.callback([{}]);
  assert.equal((await page.observe()).dom_epoch.revision,3);
});

test('context menu wrapper keeps its E2E identity alongside the anonymous ARIA child', async () => {
  const page = new Page();
  const wrapper = page.add('div','mn;mniSetupNode','',{x:30,y:100,width:200,height:25});
  const inner = page.add('a',null,'Настроить узел...',wrapper.box,wrapper);
  inner.attrs.role = 'menuitem';
  const snapshot = await page.observe();
  const target = snapshot.ui.elements.find(e=>e.tid==='mn;mniSetupNode');
  assert.ok(target?.allowed_actions.includes('click'));
  assert.equal(snapshot.ui.elements[0].tid,'mn;mniSetupNode');
  assert.equal((await page.act({verb:'click',ref:target.ref},snapshot)).status,'SUCCEEDED');
  wrapper.remove();
  assert.equal((await page.act({verb:'click',ref:target.ref},snapshot)).status,'NOT_APPLIED');
});

test('node settings affordance without button role is observable and guarded', async () => {
  const page = new Page();
  const settings = page.add('g', 'MF;TF-1;Graph;Текстовый_файл;Setting', '', {x:30,y:50,width:20,height:20});
  page.add('g', 'MF;TF-1;Graph;Текстовый_файл;UnknownDecoration', '');
  const snapshot = await page.observe();
  const target = snapshot.ui.elements.find(item => item.tid === settings.getAttribute('data-tid'));
  assert.ok(target?.allowed_actions.includes('click'));
  assert.ok(!snapshot.ui.elements.some(item => item.tid?.endsWith(';UnknownDecoration')));
  assert.equal((await page.act({verb:'click',ref:target.ref},snapshot)).status,'SUCCEEDED');
  settings.remove();
  assert.equal((await page.act({verb:'click',ref:target.ref},snapshot)).status,'NOT_APPLIED');
});

test('oversized DOM stops observation and rejects a gesture before input without an empty graph claim', async () => {
  const page=new Page();page.add('button','Safe;btnAction','Action');
  const snapshot=await page.observe();
  assert.equal(snapshot.scan.complete,true);
  const ref=snapshot.ui.elements.find(item=>item.tid==='Safe;btnAction').ref;
  let visits=0;
  const original=page.document.createTreeWalker.bind(page.document);
  page.document.createTreeWalker=(root,kind)=>kind===1 ? {nextNode:()=>{visits++;return page.document.body;}} : original(root,kind);
  const observed=await page.execute({mode:'observe'});
  assert.equal(observed.error.code,'UI_SCAN_LIMIT');assert.equal(visits,6001);
  assert.equal(observed.output.scan.complete,false);assert.equal(observed.output.nodes,undefined);
  assert.equal(observed.output.ui,undefined);
  const acted=await page.act({verb:'click',ref},snapshot);
  assert.equal(acted.status,'NOT_APPLIED');assert.equal(acted.effect_possible,false);
  assert.equal(acted.error.code,'UI_SCAN_LIMIT');assert.deepEqual(page.events,[]);
});

test('scroll clamps to its observed owner, rejects old state and does not scroll its parent', async () => {
  const page=new Page();page.waitForTimeout=async()=>{};
  page.context.innerWidth=1000;page.context.innerHeight=800;
  const outer=page.add('div','Outer','',{x:10,y:60,width:500,height:500});
  const inner=page.add('div','Inner','',{x:20,y:80,width:300,height:300},outer);
  for (const [el,height] of [[outer,2000],[inner,1000]]) Object.assign(el,{scrollTop:0,scrollHeight:height,clientHeight:300,style:{overflowY:'auto'}});
  page.add('button','Inner;btnRow','Row',undefined,inner);
  const initial=await page.observe(),target=initial.ui.elements.find(e=>e.tid==='Inner;btnRow');
  assert.ok(target.allowed_actions.includes('scroll'));
  const result=await page.act({verb:'scroll',ref:target.ref,delta_y:1000},initial);
  assert.equal(result.status,'SUCCEEDED');assert.equal(inner.scrollTop,700);assert.equal(outer.scrollTop,0);
  assert.ok(result.trace.some(e=>e.event==='ui_scroll_applied' && e.from===0 && e.to===700));
  const stale=await page.act({verb:'click',ref:target.ref},initial);
  assert.equal(stale.status,'NOT_APPLIED');assert.equal(stale.error.code,'UI_REFERENCE_STALE');
  const boundary=await page.act({verb:'scroll',ref:target.ref,delta_y:100},result.output);
  assert.equal(boundary.status,'NOT_APPLIED');assert.equal(boundary.effect_possible,false);assert.equal(outer.scrollTop,0);
  for (const delta of [0,1001,-1001,1.5,'100']) assert.throws(()=>validateUiAction({verb:'scroll',ref:target.ref,delta_y:delta}),/delta_y/);
});

test('virtualized row replacement after scrolling issues a new incarnation', async () => {
  const page=new Page(),owner=page.add('div','Rows','',{x:20,y:80,width:300,height:300});
  page.context.innerWidth=1000;page.context.innerHeight=800;
  Object.assign(owner,{scrollTop:0,scrollHeight:1000,clientHeight:300,style:{overflowY:'auto'}});
  const row=page.add('button','Rows;btnItem','Old row',undefined,owner);
  const snapshot=await page.observe(),ref=snapshot.ui.elements.find(e=>e.tid==='Rows;btnItem').ref;
  page.waitForTimeout=async()=>{row.remove();page.add('button','Rows;btnItem','New row',undefined,owner);};
  const result=await page.act({verb:'scroll',ref,delta_y:200},snapshot);
  assert.equal(result.status,'SUCCEEDED');
  const next=result.output.ui.elements.find(e=>e.tid==='Rows;btnItem');
  assert.notEqual(next.ref,ref);assert.equal(next.label,'New row');
  assert.equal((await page.act({verb:'click',ref},snapshot)).status,'NOT_APPLIED');
});

test('observation distinguishes rendered offscreen and covered targets from reachable targets',async()=>{
  const page=new Page();page.context.innerWidth=1000;page.context.innerHeight=800;
  page.add('button','Hit;btnVisible','Visible',{x:30,y:100,width:100,height:25});
  page.add('button','Hit;btnOffscreen','Offscreen',{x:30,y:1200,width:100,height:25});
  page.add('button','Hit;btnCovered','Covered',{x:300,y:100,width:100,height:25});
  page.add('div','Overlay','',{x:295,y:95,width:110,height:35});
  const s=await page.observe();
  const state=tid=>s.ui.elements.find(e=>e.tid===tid).interaction.state;
  assert.equal(state('Hit;btnVisible'),'point_observed');
  assert.equal(state('Hit;btnOffscreen'),'outside_viewport');
  assert.equal(state('Hit;btnCovered'),'point_not_observed');
});

test('set_checked reads back native state and does not toggle an already satisfied request',async()=>{
  const page=new Page();page.waitForTimeout=async()=>{};
  const input=page.add('input','Wizard;Flag');input.attrs.type='checkbox';input.checked=false;
  const click=page.mouse.click;page.mouse.click=async(...args)=>{await click(...args);input.checked=!input.checked;};
  const before=await page.observe(),ref=before.ui.elements.find(e=>e.tid==='Wizard;Flag').ref;
  const first=await page.act({verb:'set_checked',ref,checked:true},before);
  assert.equal(first.status,'SUCCEEDED');assert.equal(input.checked,true);
  assert.ok(first.trace.some(t=>t.event==='ui_state_verified' && t.checked===true));
  const count=page.events.length;
  const again=await page.act({verb:'set_checked',ref,checked:true},first.output);
  assert.equal(again.status,'SUCCEEDED');assert.equal(again.effect_possible,false);
  assert.equal(again.output.gesture_applied,false);assert.equal(page.events.length,count);
  assert.ok(!again.trace.some(t=>t.event==='ui_gesture_applied'));
  assert.throws(()=>validateUiAction({verb:'set_checked',ref,checked:'true'}),/boolean/);
});

test('unconfirmed checkbox change stays ambiguous instead of blindly retrying a toggle',async()=>{
  const page=new Page();page.waitForTimeout=async()=>{};
  const input=page.add('input','Wizard;Flag');input.attrs.type='checkbox';input.checked=false;
  const s=await page.observe(),ref=s.ui.elements.find(e=>e.tid==='Wizard;Flag').ref;
  const r=await page.act({verb:'set_checked',ref,checked:true},s);
  assert.equal(r.status,'AMBIGUOUS');assert.equal(r.error.code,'UI_STATE_NOT_CONFIRMED');
  assert.equal(page.events.filter(e=>e==='click').length,1);
});

test('Loginom Ext DisplayEl state is read from its exact checked owner and radio cannot be unchecked',async()=>{
  const page=new Page();page.waitForTimeout=async()=>{};
  const owner=page.add('div','Wizard;Option','',{x:20,y:90,width:150,height:50});
  const display=page.add('span','Wizard;Option;DisplayEl','',{x:30,y:100,width:20,height:20},owner);
  display.attrs.class='x-form-radio';display.classList.contains=name=>display.attrs.class.split(' ').includes(name);
  owner.classList.contains=name=>(owner.attrs.class??'').split(' ').includes(name);
  const click=page.mouse.click;page.mouse.click=async(...args)=>{await click(...args);owner.attrs.class='x-form-cb-checked';};
  const s=await page.observe(),target=s.ui.elements.find(e=>e.tid==='Wizard;Option;DisplayEl');
  assert.equal(target.check_state.source,'loginom_ext');assert.equal(target.check_state.checked,false);
  assert.throws(()=>validateUiAction({verb:'set_checked',ref:target.ref,checked:false},s),/radio/);
  assert.equal((await page.act({verb:'set_checked',ref:target.ref,checked:true},s)).status,'SUCCEEDED');
});

test('file storage directory uses active complete breadcrumbs and never proves file absence', async () => {
  const page=new Page();
  page.add('div','MF;TF-1;FileStorageForm;pnlFileStorage;tbl');
  const bar=page.add('div','MF;TF-1;NavigationBar;NavigationPanel');
  const labels=[];
  for (const [index,text] of ['user','data','Приёмка 1'].entries()) {
    const button=page.add('div',`MF;TF-1;cnrNaviMode;b.s-${index}`,'',undefined,bar);
    const label=page.add('span',null,text,undefined,button);
    label.attrs.class='x-btn-inner-default-toolbar-small';labels.push(label);
  }
  let output=await page.observe();
  assert.equal(output.file_storage.directory,'/user/data/Приёмка 1');
  assert.equal(output.file_storage.listing_complete,false);
  const duplicate=page.add('div','MF;TF-1;Other;NavigationBar;NavigationPanel');
  assert.equal((await page.observe()).file_storage.status,'unobserved');duplicate.remove();
  labels[1].style.display='none';
  assert.equal((await page.observe()).file_storage.directory,null);labels[1].style.display='';
  for (const bad of ['../data','data/other',' data','x'.repeat(201)]) {
    labels[1].ownText=bad;assert.equal((await page.observe()).file_storage.status,'unobserved');
  }
  labels[1].ownText='data';bar.attrs['data-tid']='MF;TF-2;NavigationBar;NavigationPanel';
  assert.equal((await page.observe()).file_storage.directory,null);
});

test('file storage name cells expose E2E targets without requiring a button role', async () => {
  const page=new Page();
  const row=page.add('td','MF;TF-1;FileStorageForm;colName_user','user');
  const observed=await page.observe();
  const target=observed.ui.elements.find(e=>e.tid===row.getAttribute('data-tid'));
  assert.ok(target.allowed_actions.includes('double_click'));
  assert.deepEqual(target.identity,{anchor_tid:row.getAttribute('data-tid'),path:[]});
  row.remove();
  page.add('td','MF;TF-1;FileStorageForm;colName_user','user');
  const result=await page.execute({mode:'act',snapshot:observed,action:{verb:'double_click',ref:target.ref}});
  assert.notEqual(result.status,'SUCCEEDED');assert.deepEqual(page.events,[]);
});

test('observation error codes cross a serialized browser boundary without exception text', async () => {
  for (const [code,expected] of [['UI_SCAN_LIMIT','UI_SCAN_LIMIT'],[undefined,'UI_OBSERVATION_FAILED']]) {
    const page=new Page(),evaluate=page.evaluate.bind(page);
    page.evaluate=async (...args)=>{try{return clone(await evaluate(...args));}catch(error){throw new Error(error.message);}};
    page.document.createTreeWalker=()=>{const error=new Error('private-page-value');error.code=code;throw error;};
    const result=await page.execute({mode:'observe'});
    assert.equal(result.status,'NOT_APPLIED');assert.equal(result.error.code,expected);
    assert.equal(JSON.stringify(result).includes('private-page-value'),false);
    if (code) assert.equal(result.output.scan.complete,false);
  }
});

test('navigation root reads the directory without traversing a large storage table', async () => {
  const page=new Page(),table=page.add('div','MF;TF-1;FileStorageForm;pnlFileStorage;tbl');
  for(let i=0;i<6500;i++) page.add('div',null,'row',undefined,table);
  const bar=page.add('div','MF;TF-1;NavigationBar;NavigationPanel');
  for(const [i,text] of ['user','data'].entries()) {
    const button=page.add('div',`MF;TF-1;cnrNaviMode;b.s-${i}`,'',undefined,bar);
    page.add('span',null,text,undefined,button).attrs.class='x-btn-inner-default-toolbar-small';
  }
  // Emulate the fixed native queries; JavaScript detail walks remain real.
  page.document.querySelectorAll=selector=>selector.includes('[role="grid"]')?[bar,table]:[page.avatar,page.tab,table];
  let walkedTable=false;const walker=page.document.createTreeWalker.bind(page.document);
  page.document.createTreeWalker=(element,kind)=>{if(element===table)walkedTable=true;return walker(element,kind);};
  const roots=await page.execute({mode:'observe',discover_roots:true});
  const ref=roots.output.ui.elements.find(e=>e.tid===bar.getAttribute('data-tid')).ref;
  const detail=await page.execute({mode:'observe',root_ref:ref});
  assert.equal(detail.status,'SUCCEEDED');assert.equal(detail.output.file_storage.directory,'/user/data');
  assert.equal(detail.output.file_storage.listing_complete,false);assert.equal(walkedTable,false);
});

test('storage-name discovery uses escaped fixed lookup and no table traversal', async () => {
  const page=new Page(),name='data, " ]';
  const cell=page.add('td','MF;TF-1;FileStorageForm;colName_data_"_]','data, " ]');
  for(let i=0;i<6500;i++) page.add('div',null,'background');
  let lookup='',walks=0;const walker=page.document.createTreeWalker.bind(page.document);
  page.document.createTreeWalker=(element,kind)=>{if(kind===1)walks++;return walker(element,kind);};
  page.document.querySelectorAll=selector=>{
    if(selector.startsWith('[data-tid$="\\')) {lookup=selector;return [cell];}
    return [page.avatar,page.tab];
  };
  const result=await page.execute({mode:'observe',discover_roots:true,storage_name:name});
  assert.equal(result.status,'SUCCEEDED');assert.equal(walks,0);
  assert.equal(result.output.observation_filter.storage_name,name);
  assert.deepEqual(result.output.ui.elements[0].allowed_actions,[]);
  assert.equal(lookup.replace(/\\([a-f0-9]+) /g,(_,hex)=>String.fromCodePoint(parseInt(hex,16))),
    '[data-tid$=";FileStorageForm;colName_data_"_]"]');
  const ref=result.output.ui.elements[0].ref;
  const detail=await page.execute({mode:'observe',root_ref:ref});
  assert.equal(detail.status,'SUCCEEDED');assert.equal(walks,1);
  assert.equal(detail.output.ui.elements[0].label,name);
});

test('nested breadcrumb button parts are one segment and incomplete paths explain refusal', async () => {
  const page=new Page();page.add('div','MF;TF-1;FileStorageForm;pnlFileStorage;tbl');
  const bar=page.add('div','MF;TF-1;NavigationBar;NavigationPanel');
  const outer=page.add('div','MF;TF-1;cnrNaviMode;b.s-1','',undefined,bar);
  const inner=page.add('span','MF;TF-1;cnrNaviMode;b.s-1;inner','',undefined,outer);
  const label=page.add('span',null,'user',undefined,inner);label.attrs.class='x-btn-inner-default-toolbar-small';
  assert.equal((await page.observe()).file_storage.directory,'/user');
  label.remove();const failed=(await page.observe()).file_storage;
  assert.equal(failed.reason,'navigation_segments_incomplete');
  assert.deepEqual(failed.segment_counts,{buttons:1,labels:0});
});

test('empty navigation decorations are skipped without accepting an empty directory', async () => {
  const page=new Page();page.add('div','MF;TF-1;FileStorageForm;pnlFileStorage;tbl');
  const bar=page.add('div','MF;TF-1;NavigationBar;NavigationPanel');
  const labels=[];
  for(const [i,text] of ['', 'user', 'data', ''].entries()) {
    const button=page.add('div',`MF;TF-1;cnrNaviMode;b.s-${i}`,'',undefined,bar);
    const label=page.add('span',null,text,undefined,button);label.attrs.class='x-btn-inner-default-toolbar-small';
    if(!text) label.style.display='none';labels.push(label);
  }
  assert.equal((await page.observe()).file_storage.directory,'/user/data');
  for(const label of labels)label.ownText='';
  assert.equal((await page.observe()).file_storage.status,'unobserved');
});
