import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservationPages } from '../lib/observation-pages.mjs';

const fixture = (count = 90) => ({ status: 'SUCCEEDED', output: {
  origin: 'https://example.test', loginom_build: 'test', workflow_ref: { prefix: 'MF;TF' },
  nodes: [], links: [], ui: { elements: Array.from({ length: count }, (_, i) => ({
    ref: `ref-${i}`, tid: `MF;TF;ModelForm;colVendors_Компоненты>Группа>Узел_${i};TreeText`,
    label: `Узел ${i}`, signature: { tag: 'span', expensive: 'x'.repeat(1000) },
    identity: { anchor_tid: `anchor-${i}` }, bounding_box: { x: i, y: i },
  })), dialogs: [], masks: [], messages: [], table_cells: [], truncated: { elements: false, nodes: false, links: false, ports: false } },
} });

test('pages are bounded, retain guards privately, and issue only delivered refs', () => {
  const pages = createObservationPages(), source = fixture();
  const first = pages.retain(structuredClone(source), { scope: 'palette' });
  const id = first.output.observation_id;
  assert.equal(pages.get(id).ui.elements[0].signature.expensive.length, 1000);
  assert.equal(first.output.ui.elements[0].signature.expensive, undefined);
  assert.equal(first.output.page.full_dom_complete, false);
  assert.equal(first.output.ui.truncated.nodes, true);
  assert.throws(() => pages.assertIssued(id, { ref: 'ref-89' }), /not been delivered/);
  let current = first; const refs = [];
  do {
    assert.ok(Buffer.byteLength(JSON.stringify(current.output)) <= 12000);
    assert.equal(current.output.observation_id, id);
    refs.push(...current.output.ui.elements.map(e => e.ref));
    const cursor = current.output.page.next_cursor;
    if (!cursor) break;
    const repeated = pages.next(cursor, structuredClone(source));
    current = pages.next(cursor, structuredClone(source));
    assert.deepEqual(current, repeated);
  } while (true);
  assert.deepEqual(refs, source.output.ui.elements.map(e => e.ref));
  assert.doesNotThrow(() => pages.assertIssued(id, { source_ref: 'ref-0', target_ref: 'ref-89' }));
});

test('changed, cleared, evicted and foreign cursors cannot combine observations', () => {
  const pages = createObservationPages({ capacity: 1 }), source = fixture();
  const first = pages.retain(structuredClone(source));
  const cursor = first.output.page.next_cursor;
  const changed = structuredClone(source); changed.output.ui.elements[0].label = 'Changed';
  assert.throws(() => pages.next(cursor, changed), /Workspace changed/);
  assert.equal(pages.get(first.output.observation_id), undefined);
  const second = pages.retain(structuredClone(source));
  pages.retain(structuredClone(source));
  assert.throws(() => pages.next(second.output.page.next_cursor, source), /stale/);
  const third = pages.retain(structuredClone(source)); pages.clear();
  assert.throws(() => pages.next(third.output.page.next_cursor, source), /stale/);
  assert.throws(() => createObservationPages().next(cursor, source), /stale/);
});

test('gesture receipt pages preserve warnings and use fresh state independent of receipt metadata', () => {
  const pages = createObservationPages(), source = fixture();
  const receipt = structuredClone(source);
  Object.assign(receipt.output, { gesture_applied: true, verification_required: true,
    recovery: { state: 'pending', outcome: { status: 'AMBIGUOUS', output: { large: 'x'.repeat(50000) } } } });
  const first = pages.retain(receipt);
  assert.equal(first.output.gesture_applied, true);
  assert.equal(first.output.verification_required, true);
  assert.equal(first.output.recovery.outcome_summary.status, 'AMBIGUOUS');
  assert.equal(first.output.recovery.outcome_summary.detail_tool, 'dock_operation_inspect');
  assert.ok(Buffer.byteLength(JSON.stringify(first.output)) <= 12000);
  assert.doesNotThrow(() => pages.next(first.output.page.next_cursor, source));
});

test('oversized records fail explicitly and graph port chunks never claim complete ports', () => {
  const source = fixture(0); source.output.nodes = [{ node_ref: { node_label: 'N' }, ports: Array.from({ length: 20 }, (_, i) => ({ tid: `port-${i}` })) }];
  const result = createObservationPages().retain(source, { scope: 'graph' });
  assert.equal(result.output.nodes.length, 3);
  assert.equal(result.output.ui.truncated.ports, true);
  const huge = fixture(1); huge.output.ui.elements[0].label = 'x'.repeat(20000);
  assert.throws(() => createObservationPages().retain(huge), /record exceeds/);
});

test('scoped omissions cannot masquerade as empty dialogs, masks or controls', () => {
  const source=fixture(2);
  source.output.ui.dialogs=[{ref:'dialog'}]; source.output.ui.masks=[{ref:'busy-mask'}];
  for (const scope of ['graph','palette']) {
    const result=createObservationPages().retain(structuredClone(source),{scope});
    for (const key of ['dialogs','masks','messages','table_cells']) assert.equal(result.output.ui.truncated[key],true);
    if (scope==='graph') assert.equal(result.output.ui.truncated.elements,true);
  }
  const dialog=createObservationPages().retain(structuredClone(source),{scope:'dialogs'});
  assert.equal(dialog.output.ui.truncated.elements,true);
  assert.equal(dialog.output.ui.truncated.nodes,true);
  assert.deepEqual(dialog.output.ui.masks,source.output.ui.masks);
});

test('palette starts with reachable rows after scrolling without discarding offscreen inventory',()=>{
  const source=fixture(80),pages=createObservationPages();
  source.output.ui.elements[75].interaction={state:'point_observed'};
  const first=pages.retain(structuredClone(source),{scope:'palette'});
  assert.equal(first.output.ui.elements[0].ref,'ref-75');
  const refs=[];let current=first;
  while (true) {
    refs.push(...current.output.ui.elements.map(e=>e.ref));
    if (!current.output.page.next_cursor) break;
    current=pages.next(current.output.page.next_cursor,source);
  }
  assert.equal(refs.length,80);assert.equal(new Set(refs).size,80);
});
