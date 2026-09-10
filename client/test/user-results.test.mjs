import test from 'node:test';
import assert from 'node:assert/strict';
import { compactNodeResult, compactActionResult, compactKnowledgeBundle, userResultSchema } from '../lib/user-results.mjs';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
const validate = new AjvJsonSchemaValidator().getValidator(userResultSchema);

test('compact node result keeps references, precision and errors without configuration traces', () => {
  const raw = { operation_id: 'job', attempt: 1, state: 'settled', progress: null, error: null,
    outcome: { status: 'SUCCEEDED', cleanup_complete: true, effect_possible: true, trace: [{ large: 'trace' }],
      output: { node: { document_id: 'doc', workflow_id: 'wf', node_id: 'node' }, package_saved: false,
        configuration: { readback: { huge: 'details' } }, output: { status: 'partial', evidence_ref: 'receipt', ports: [
          { port: 0, port_guid: 'port', fresh: true, row_count: 12, schema: [{ index: 0, name: 'amount', label: 'Amount', type: 'real', header_tid: 'internal' }],
            sample: [[{ display_text: '1.2', precision: 'unverified' }]], sample_rows: 1, sample_complete: false,
            precision: { numbers_verified: false, limitations: ['numeric_display_precision'] } },
        ] } } } };
  const before = JSON.stringify(raw), result = compactNodeResult(raw);
  assert.equal(validate(result).valid, true);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(result.node.node_id, 'node');assert.equal(result.package_saved, false);
  assert.equal(result.output.ports[0].precision.numbers_verified, false);
  assert.equal(result.output.ports[0].row_count, 12);
  assert.ok(!JSON.stringify(result).includes('huge') && !JSON.stringify(result).includes('internal'));
  raw.outcome.status = 'AMBIGUOUS';raw.outcome.error = { code: 'UNCERTAIN', message: 'inspect same ID' };
  assert.equal(compactNodeResult(raw).error.code, 'UNCERTAIN');
});
test('compact actions retain navigation and issued UI controls needed for recovery', () => {
  const raw = { operation_id: 'save', status: 'SUCCEEDED', output: { workflow_ref: { workflow_id: 'new' },
    observation_id: 'obs', ui: { elements: [{ ref: 'visible', allowed_actions: ['click'] }] } }, trace: ['internal'] };
  const result = compactActionResult(raw);
  assert.deepEqual(result.output, raw.output);assert.equal(result.trace, undefined);assert.equal(raw.trace.length, 1);
});
test('knowledge bundle retains parameter schemas and revision pins', () => {
  const schema = { type: 'object', required: ['keys'] };
  const result = compactKnowledgeBundle({ session_manifest: { digest: 'pin' }, actions: [{ action_key: 'save', input_schema: schema, revision: '2' }],
    node_types: [{ type: 'transform.sorting', modes: ['keys'], parameter_schema: schema, cache_key: 'cache', source: 'internal references' }] });
  assert.equal(result.session_manifest.digest, 'pin');assert.deepEqual(result.node_types[0].parameter_schema, schema);
  assert.equal(result.node_types[0].cache_key, 'cache');assert.equal(result.node_types[0].source, undefined);
});
