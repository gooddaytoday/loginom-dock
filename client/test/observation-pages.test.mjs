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

test('unchanged visible values cannot revive a cursor after a DOM mutation round trip', () => {
  const pages=createObservationPages(),source=fixture();
  source.output.dom_epoch={document:'document-1',revision:0};
  const first=pages.retain(structuredClone(source));
  assert.deepEqual(first.output.dom_epoch,source.output.dom_epoch);
  const fresh=structuredClone(source);fresh.output.dom_epoch.revision=2;
  assert.throws(()=>pages.next(first.output.page.next_cursor,fresh),/Workspace changed/);
});

test('region discovery cursors preserve their read mode and region refs remain non-actionable', () => {
  const pages=createObservationPages(),source=fixture();source.output.observation_kind='roots';
  for(const e of source.output.ui.elements){e.kind='region';e.allowed_actions=[];}
  const first=pages.retain(structuredClone(source),{scope:'roots'});
  assert.equal(first.output.observation_kind,'roots');
  assert.equal(pages.kindForCursor(first.output.page.next_cursor),'roots');
  assert.deepEqual(first.output.ui.elements[0].allowed_actions,[]);
  assert.doesNotThrow(()=>pages.assertIssued(first.output.observation_id,{ref:first.output.ui.elements[0].ref}));
});

test('cursor retains the selected root and cannot switch to an unscoped snapshot', () => {
  const pages=createObservationPages(),source=fixture();
  source.output.observation_root={ref:'ui-root',identity:{anchor_tid:'root',path:[]},global_scan:true,detail_scope:'elements_and_cells'};
  const first=pages.retain(structuredClone(source)),cursor=first.output.page.next_cursor;
  assert.equal(pages.rootForCursor(cursor),'ui-root');
  assert.deepEqual(pages.next(cursor,structuredClone(source)).output.observation_root,source.output.observation_root);
  const outside=structuredClone(source);delete outside.output.observation_root;
  assert.throws(()=>pages.next(cursor,outside),/Workspace changed/);
  assert.throws(()=>pages.rootForCursor(cursor),/stale/);
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

test('file storage destination is delivered and invalidates cursors when it changes', () => {
  const pages=createObservationPages(),source=fixture();
  source.output.file_storage={status:'observed',directory:'/user/data',source:'visible_breadcrumbs',listing_complete:false};
  const first=pages.retain(structuredClone(source));
  assert.deepEqual(first.output.file_storage,source.output.file_storage);
  const changed=structuredClone(source);changed.output.file_storage.directory='/user/other';
  assert.throws(()=>pages.next(first.output.page.next_cursor,changed),/Workspace changed/);
});

test('storage discovery filter is delivered and retained by its cursor', () => {
  const pages=createObservationPages(),source=fixture();
  source.output.observation_kind='roots';source.output.observation_filter={storage_name:'data'};
  const first=pages.retain(structuredClone(source),{scope:'roots'});
  assert.deepEqual(first.output.observation_filter,{storage_name:'data'});
  assert.deepEqual(pages.filterForCursor(first.output.page.next_cursor),{storage_name:'data'});
  const changed=structuredClone(source);changed.output.observation_filter.storage_name='other';
  assert.throws(()=>pages.next(first.output.page.next_cursor,changed),/Workspace changed/);
});
