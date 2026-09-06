import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRedactor } from '../lib/redact.mjs';
import { actionReply } from '../lib/bridge.mjs';

test('observation usage is a separate bounded hint and never changes the authoritative receipt', () => {
  const receipt = { status: 'SUCCEEDED', action_key: 'workspace.observe', operation_id: 'receipt-only',
    output: { observation_id: 'issued-observation', observation_kind: 'roots',
      wizard: { root_ref: 'ui-metadata' }, page: { next_cursor: 'next-page' },
      operation: { operation_id: 'pending-operation', state: 'pending' },
      recovery: { operation_id: 'recovery-operation' },
      ui: { elements: Array.from({ length: 5 }, (_, i) => ({ ref: `ui-root-${i}`, kind: 'region', allowed_actions: [] })) } } };
  const original = JSON.stringify(receipt);
  const reply = actionReply(receipt, { observe: true });
  assert.equal(reply.content[0].text, original);
  assert.equal(JSON.stringify(receipt), original);
  // The exporter selects this first unchanged status/action_key/operation_id object.
  assert.deepEqual(JSON.parse(reply.content[0].text), receipt);
  const usage = JSON.parse(reply.content[1].text);
  assert.equal(usage.kind, 'dock_observation_usage');
  assert.equal(usage.observation_id, 'issued-observation');
  assert.deepEqual(usage.next_page_arguments, { cursor: 'next-page' });
  assert.deepEqual(usage.root_read_arguments, [0, 1, 2].map(i => ({ root_ref: `ui-root-${i}`, observation_id: 'issued-observation' })));
  assert.equal(JSON.stringify(usage).includes('ui-metadata'), false);
  assert.equal(JSON.stringify(usage).includes('pending-operation'), false);
  assert.match(usage.reference_usage, /Metadata refs alone are not issued/);
  assert.match(usage.reference_usage, /allowed_actions/);
  assert.match(usage.receipt_id_usage, /never an observation_id alias/);
  for (const modify of [r => delete r.output.ui, r => delete r.output.observation_id,
    r => { r.output.observation_id = ''; }, r => { r.status = 'NOT_APPLIED'; }]) {
    const candidate = structuredClone(receipt); modify(candidate);
    const result = actionReply(candidate, { observe: true });
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].text, JSON.stringify(candidate));
  }
  assert.equal(actionReply(receipt).content.length, 1);
  const noCursor = structuredClone(receipt); delete noCursor.output.page.next_cursor;
  assert.equal(Object.hasOwn(JSON.parse(actionReply(noCursor, { observe: true }).content[1].text), 'next_page_arguments'), false);
  const ambiguous = structuredClone(receipt);
  ambiguous.output.ui.elements = [
    { ref: 'ui-duplicate', kind: 'region', allowed_actions: [] },
    { ref: 'ui-duplicate', kind: 'region', allowed_actions: [] },
    { ref: 'ui-button', kind: 'button', allowed_actions: ['click'] },
    { ref: 'ui-unsafe-region', kind: 'region', allowed_actions: ['click'] },
  ];
  assert.deepEqual(JSON.parse(actionReply(ambiguous, { observe: true }).content[1].text).root_read_arguments, []);
});

// Module mocks are isolated to this child process, so actual SDK and bridge
// imports used by the other suites retain their original implementations.
test('bridge keeps application feedback recoverable over the MCP protocol', async () => {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  let result;
  try {
    result = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', '--test',
      fileURLToPath(new URL('./support/bridge-contract.mjs', import.meta.url))], { timeout: 30000, env: environment });
  } catch (error) {
    const redactor = createRedactor();
    const diagnostic = redactor.text(`stdout:\n${String(error.stdout ?? '')}\nstderr:\n${String(error.stderr ?? '')}`).slice(0, 16000);
    assert.fail(`Bridge protocol test subprocess failed (${error.code ?? error.signal ?? 'unknown'}).\n${diagnostic}`);
  }
  assert.match(result.stdout, /pass 1/);
  assert.match(result.stdout, /fail 0/);
});
