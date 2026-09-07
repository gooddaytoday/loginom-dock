import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeProcedure } from '../lib/node-procedure.mjs';
import { validateTextImportRequest } from '../lib/text-import-procedure.mjs';

function fixture({ recordFailure, executeFailure, changedDocument, foreignReceipt, movingEpoch, dialogsAtRead, loadingSamples = 0, maxSteps = 8 } = {}) {
  const events = [], records = []; let reads = 0;
  const operation = { id: 'parent', action: { action_key: 'node.import.configure', revision: '1' },
    deadline: 10000, checkpoint: { workflow_ref: { prefix: 'MF;TF-1', tab_tid: 'tab' }, document_id: 'doc' } };
  const state = { origin: 'http://example.test', loginom_build: '7.4.2', workflow_ref: operation.checkpoint.workflow_ref,
    dom_epoch: { document: changedDocument ? 'foreign' : 'doc', revision: 1 }, scan: { complete: true }, wizard: { status: 'absent' },
    ui: { masks: [], dialogs: [], truncated: { elements: false, masks: false, dialogs: false },
      elements: [{ ref: 'ui-button', allowed_actions: ['click'] }] } };
  const channel = createNodeProcedure({ operation, maxSteps, now: () => 1, wait: async () => {},
    targetOrigin: 'http://example.test', targetBuild: '7.4.2',
    record: async entry => { events.push(entry.phase); if (recordFailure && entry.phase === recordFailure) throw new Error('disk failure'); records.push(entry); return structuredClone(entry); },
    wrapMutation: (code, options) => { events.push('wrapped'); return { code, options }; },
    execute: async code => {
      if (typeof code === 'string') { reads++; const output = structuredClone(state); if (movingEpoch) output.dom_epoch.revision = reads; if (dialogsAtRead) output.ui.dialogs = dialogsAtRead(reads); if (reads <= loadingSamples) output.ui.masks = [{ kind: 'busy' }]; return { status: 'SUCCEEDED', output }; }
      events.push('mutated'); if (executeFailure) throw new Error('transport');
      return { status: 'SUCCEEDED', operation_id: foreignReceipt ? 'foreign' : code.options.id, action_key: 'ui.act', cleanup_complete: true, effect_possible: true, output: state };
    } });
  return { channel, operation, events, records };
}
test('durable internal preparation precedes mutation; next action requires fresh observation', async () => {
  const f = fixture(); await f.channel.observe({ condition: 'button usable', ready: s => s.ui.elements.some(e => e.ref === 'ui-button') }); await f.channel.act({ verb: 'click', ref: 'ui-button' });
  assert.deepEqual(f.events.filter(x => x !== 'node_observation_sample'), ['node_observation_completed', 'node_step_prepared', 'wrapped', 'mutated', 'node_step_completed']);
  assert.equal(f.records.find(r => r.phase === 'node_step_prepared').internal_operation_id, 'parent:n2');
  assert.match(f.records.find(r => r.phase === 'node_step_prepared').observation_sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(f.channel.act({ verb: 'click', ref: 'ui-button' }), /fresh internal observation/);
});
test('journal failure prevents mutation', async () => {
  const f = fixture({ recordFailure: 'node_step_prepared' }); await f.channel.observe({ condition: 'button usable', ready: s => s.ui.elements.some(e => e.ref === 'ui-button') });
  await assert.rejects(f.channel.act({ verb: 'click', ref: 'ui-button' }), /disk failure/);
  assert.ok(!f.events.includes('mutated'));
});
test('transport uncertainty retains unresolved cleanup', async () => {
  const f = fixture({ executeFailure: true }); await f.channel.observe({ condition: 'button usable', ready: s => s.ui.elements.some(e => e.ref === 'ui-button') });
  await assert.rejects(f.channel.act({ verb: 'click', ref: 'ui-button' }), /transport/);
  assert.equal(f.operation.transportUncertain, true); assert.equal(f.operation.cleanupConfirmed, false);
});
test('document replacement rejects identical-looking refs', async () => {
  const f = fixture({ changedDocument: true }); await assert.rejects(f.channel.observe({ condition: 'button usable', ready: s => s.ui.elements.some(e => e.ref === 'ui-button') }), /document or workflow changed/);
  assert.ok(!f.events.includes('mutated'));
});
test('step budget cannot be bypassed with additional observations', async () => {
  const f = fixture({ maxSteps: 1 }); await f.channel.observe({ condition: 'button usable', ready: s => s.ui.elements.some(e => e.ref === 'ui-button') });
  await assert.rejects(f.channel.observe({ condition: 'button usable', ready: s => s.ui.elements.some(e => e.ref === 'ui-button') }), /budget exhausted/);
  await assert.rejects(f.channel.act({ verb: 'click', ref: 'ui-button' }), /budget exhausted/);
});
const request = () => ({ source: { source_path: '/user/input.csv', encoding: 'UTF-8 (65001)', rows_to_skip: 0, first_line_as_title: true },
  format: { delimiter: ';', decimal_separator: '.', null_marker: '?', text_qualifier: '"' },
  columns: [{ name: 'Count', label: 'Count', type: 'integer', data_kind: 'Непрерывный', used: true }] });
test('typed request admits different values without a scenario recipe', () => { validateTextImportRequest(request()); });
for (const path of ['/user/*.csv', '/user/a.csv|/user/b.csv', '/user/../input.csv', 'https://host/a', '/user/a%2fb']) {
  test('rejects nonliteral source ' + path, () => { const p = request(); p.source.source_path = path; assert.throws(() => validateTextImportRequest(p), /storage path/); });
}
test('rejects unknown steps, duplicate schema and unsupported column count', () => {
  const p = request(); p.steps = []; assert.throws(() => validateTextImportRequest(p), /Unexpected/); delete p.steps;
  p.columns.push({ ...p.columns[0] }); assert.throws(() => validateTextImportRequest(p), /Duplicate/);
  p.columns = Array.from({ length: 9 }, (_, i) => ({ ...p.columns[0], name: 'C' + i })); assert.throws(() => validateTextImportRequest(p), /1–8/);
});

test('bounded observation waits for loading without permitting a masked mutation', async () => {
  const f = fixture({ loadingSamples: 6 }); await f.channel.observe({ condition: 'button usable', ready: s => s.ui.elements.some(e => e.ref === 'ui-button') });
  assert.ok(f.records.filter(r => r.phase === 'node_observation_sample').length >= 4);
  await f.channel.act({ verb: 'click', ref: 'ui-button' });
});
test('ready condition completes without redundant identical snapshots', async () => {
  const f = fixture(); await f.channel.observe({ condition: 'button usable', ready: () => true });
  assert.equal(f.records.filter(r => r.phase === 'node_observation_sample').length, 1);
});
test('foreign receipt cannot confirm original cleanup', async () => {
  const f = fixture({ foreignReceipt: true }); await f.channel.observe({ condition: 'button usable', ready: s => s.ui.elements.some(e => e.ref === 'ui-button') });
  await assert.rejects(f.channel.act({ verb: 'click', ref: 'ui-button' }), /receipt identity differs/);
  assert.equal(f.operation.transportUncertain, true); assert.equal(f.operation.cleanupConfirmed, false);
});

test('completion journal failure preserves the already performed effect', async () => {
  const f = fixture({ recordFailure: 'node_step_completed' }); await f.channel.observe({ condition: 'button usable', ready: s => s.ui.elements.some(e => e.ref === 'ui-button') });
  await assert.rejects(f.channel.act({ verb: 'click', ref: 'ui-button' }), /disk failure/);
  assert.equal(f.operation.nodeEffectPossible, true);
  assert.equal(f.operation.cleanupConfirmed, true);
});

test('public import action rejects a fabricated upload identifier before browser access', async () => {
  const { runtime, Page } = await import('./support/executor-fixture.mjs');
  const page = new Page(); let called = 0;
  const engine = runtime(page, { execute: async () => { called++; throw new Error('Unexpected browser call'); } });
  const result = await engine.run('node.configure_text_import', {
    node_ref: { kind: 'node', node_label: 'Import', workflow_ref: { prefix: 'MF;TF-1', tab_tid: 'tab' } },
    source_transfer_operation_id: 'invented', settings: request(),
  }, { operationId: 'configure-test' });
  assert.equal(result.status, 'FAILED'); assert.equal(result.effect_possible, false); assert.equal(called, 0);
  assert.match(result.error.message, /completed verified upload/);
});


test('stable DOM cannot satisfy a pending semantic condition', async () => {
  const f = fixture(); let checks = 0;
  await f.channel.observe({ condition: 'requested value read back', ready: () => ++checks >= 6 });
  const samples = f.records.filter(r => r.phase === 'node_observation_sample');
  assert.equal(samples.length, 6);
  assert.ok(samples.slice(0, 5).every(r => r.readiness.satisfied === false));
  assert.ok(samples.slice(-1).every(r => r.readiness.satisfied === true));
});
test('readiness timeout names the missing result and invalidates old refs', async () => {
  const f = fixture(); await f.channel.observe({ condition: 'button usable', ready: s => s.ui.elements.some(e => e.ref === 'ui-button') });
  await assert.rejects(f.channel.observe({ condition: 'column editor bound', ready: () => false }), /readiness timeout: column editor bound/);
  await assert.rejects(f.channel.act({ verb: 'click', ref: 'ui-button' }), /fresh internal observation/);
  assert.ok(!f.events.includes('mutated'));
});

test('a visible toast blocks readiness until it disappears', async () => {
  const f = fixture({ dialogsAtRead: n => n <= 10 ? [{ identity: { anchor_tid: 'toast' } }] : [] });
  await f.channel.observe({ condition: 'wizard usable', ready: () => true });
  const samples = f.records.filter(r => r.phase === 'node_observation_sample');
  assert.ok(samples.some(r => r.outcome.output.ui.dialogs.length && !r.readiness.satisfied));
  assert.ok(samples.slice(-1).every(r => r.outcome.output.ui.dialogs.length === 0));
  await f.channel.act({ verb: 'click', ref: 'ui-button' });
});
test('an unexpected dialog fails immediately without a mutation', async () => {
  const f = fixture({ dialogsAtRead: () => [{ identity: { anchor_tid: 'MessageBox' } }] });
  await assert.rejects(f.channel.observe({ condition: 'wizard usable', ready: () => true }), /blocked/);
  assert.ok(!f.events.includes('mutated'));
});

test('target incarnation confirmation waits for the same identity twice', async () => {
  const f = fixture(); let reads = 0;
  await f.channel.observe({ condition: 'saved node incarnation', ready: () => true,
    confirmIdentity: () => ++reads < 3 ? 'old-' + reads : 'new-node' });
  assert.equal(f.records.filter(r => r.phase === 'node_observation_sample').length, 4);
  assert.equal(f.records.at(-1).readiness.required_samples, 2);
});
