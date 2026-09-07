import { createHash } from 'node:crypto';
import { makeWorkspaceUiCode, validateUiAction } from './workspace-ui.mjs';

// Private transport for fixed, client-pinned node procedures. No recipes, UI
// selectors or step arrays are accepted from the caller. The enclosing action
// runtime owns its mutation gate for the whole procedure, including observations.
export function createNodeProcedure({ operation, execute, record, wrapMutation,
  targetOrigin, targetBuild, now = Date.now, maxSteps = 96, signal,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let sequence = 0;
  let snapshot = null;
  let evidenceSnapshot = null;
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const checkBudget = () => {
    signal?.throwIfAborted();
    if (sequence >= maxSteps || now() >= operation.deadline) {
      throw new Error('Node procedure budget exhausted; inspect the partial result');
    }
  };
  const entry = (phase, details) => record({ operation_id: operation.id,
    action_key: operation.action.action_key, action_revision: operation.action.revision,
    phase, internal_provenance: 'client_node_procedure_v1', ...details });
  const assertContext = (state, allowTransient = false) => {
    const expected = operation.checkpoint;
    if (state.origin !== targetOrigin || state.loginom_build !== targetBuild
      || JSON.stringify(state.workflow_ref) !== JSON.stringify(expected.workflow_ref)
      || !expected.document_id || state.dom_epoch?.document !== expected.document_id) {
      throw new Error('Node procedure document or workflow changed');
    }
    if (!Array.isArray(state.ui?.masks) || !Array.isArray(state.ui?.dialogs)
      || (!allowTransient && state.ui.masks.length)
      || state.ui.dialogs.some(d => !allowTransient || d.identity?.anchor_tid !== 'toast')
      || ['dialogs','masks'].some(key => state.ui.truncated?.[key] !== false)
      || state.scan?.complete !== true) {
      throw new Error('Node procedure is blocked by a mask or dialog');
    }
  };
  return Object.freeze({
    async observe({ condition, ready, confirmIdentity, timeoutMs = 15000 } = {}) {
      checkBudget();
      if (typeof condition !== 'string' || !condition.trim() || typeof ready !== 'function'
        || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 15000) {
        throw new Error('A named, bounded readiness condition is required');
      }
      // A failed wait must invalidate even a previously usable observation.
      snapshot = null;
      evidenceSnapshot = null;
      const step = ++sequence, id = operation.id + ':n' + step;
      const started = now(), deadline = Math.min(operation.deadline, started + timeoutMs);
      let result, satisfied = false, previousIdentity, confirmations = 0;
      for (let sample = 0; sample < 80; sample++) {
        signal?.throwIfAborted();
        if (now() >= deadline) break;
        if (sample) await wait(Math.min(200, Math.max(0, deadline - now())));
        signal?.throwIfAborted();
        if (now() >= deadline) break;
        // Rediscover the root: wizard transitions and combo portals can replace it.
        const roots = await execute(makeWorkspaceUiCode({ mode: 'observe', operation_id: id,
          discover_roots: true, expected_origin: targetOrigin, expected_build: targetBuild }),
        { timeout: Math.min(35000, Math.max(1, deadline - now())) });
        if (roots.status !== 'SUCCEEDED') throw new Error('Node procedure roots could not be observed');
        const wizard = roots.output.wizard;
        const portal = wizard?.status === 'observed' && roots.output.ui?.elements?.some(e =>
          e.tid?.startsWith(wizard.root_tid + ';') && e.tid.endsWith(';boundlist'));
        const root = wizard?.status === 'observed' && !portal ? wizard.root_ref : undefined;
        if (now() >= deadline) break;
        result = await execute(makeWorkspaceUiCode({ mode: 'observe', operation_id: id,
          root_ref: root, expected_origin: targetOrigin, expected_build: targetBuild }),
        { timeout: Math.min(35000, Math.max(1, deadline - now())) });
        if (result.status !== 'SUCCEEDED') throw new Error('Node procedure observation is incomplete');
        assertContext(result.output, true);
        satisfied = !result.output.ui.masks.length && !result.output.ui.dialogs.length
          && ready(result.output) === true && now() < deadline;
        const identity = satisfied && confirmIdentity ? digest(confirmIdentity(result.output)) : null;
        confirmations = satisfied ? (confirmIdentity ? (identity === previousIdentity ? confirmations + 1 : 1) : 1) : 0;
        previousIdentity = identity;
        await entry('node_observation_sample', { step, sample, internal_operation_id: id,
          readiness: { policy: 'semantic_condition_v2', required_samples: confirmIdentity ? 2 : 1, identity_sha256: identity, condition, satisfied, timeout_ms: timeoutMs, elapsed_ms: now() - started },
          outcome: structuredClone(result) });
        // The action transport checks the exact document epoch again before
        // the gesture. Repeating already satisfied observations adds latency
        // without making that check stronger.
        if (satisfied && confirmations >= (confirmIdentity ? 2 : 1)) break;
      }
      if (!satisfied || confirmations < (confirmIdentity ? 2 : 1) || now() >= deadline) {
        throw new Error('Node procedure readiness timeout: ' + condition + '; no mutation was authorized');
      }
      const persisted = await entry('node_observation_completed', { step, internal_operation_id: id,
        readiness: { policy: 'semantic_condition_v2', required_samples: confirmIdentity ? 2 : 1, identity_sha256: previousIdentity, condition, satisfied: true, timeout_ms: timeoutMs, elapsed_ms: now() - started }, outcome: structuredClone(result) });
      if (!persisted?.outcome?.output) throw new Error('Node observation requires a durable journal acknowledgement');
      evidenceSnapshot = structuredClone(persisted.outcome.output);
      snapshot = structuredClone(result.output);
      return structuredClone(snapshot);
    },
    async act(action) {
      checkBudget();
      if (!snapshot) throw new Error('A fresh internal observation is required');
      validateUiAction(action, snapshot);
      assertContext(snapshot);
      const step = ++sequence, id = operation.id + ':n' + step;
      const before = snapshot;
      snapshot = null;
      const signature = digest([id, action, evidenceSnapshot]);
      // This write must be durable before the browser receives the mutation.
      const persisted = await entry('node_step_prepared', { step, internal_operation_id: id,
        action: structuredClone(action), observation_sha256: digest(evidenceSnapshot), signature });
      evidenceSnapshot = null;
      if (!persisted || JSON.stringify(persisted.action) !== JSON.stringify(action)
        || persisted.signature !== signature) throw new Error('Prepared step was not durably preserved after redaction');
      signal?.throwIfAborted();
      if (now() >= operation.deadline) throw new Error('Node procedure deadline elapsed before mutation');
      const code = makeWorkspaceUiCode({ mode: 'act', operation_id: id, action,
        snapshot: before, expected_origin: targetOrigin, expected_build: targetBuild });
      const wrapped = wrapMutation(code, { id, signature, action_key: 'ui.act' });
      let result;
      try { result = await execute(wrapped, { timeout: 35000 }); }
      catch (error) {
        operation.transportUncertain = true;
        operation.cleanupConfirmed = false;
        throw error;
      }
      if (result.operation_id !== id || result.action_key !== 'ui.act') {
        operation.transportUncertain = true;
        operation.cleanupConfirmed = false;
        await entry('node_step_completed', { step, internal_operation_id: id, outcome: structuredClone(result) });
        throw new Error('Node procedure receipt identity differs; inspect the original browser receipt');
      }
      operation.cleanupConfirmed = result.cleanup_complete === true;
      operation.nodeEffectPossible ||= result.effect_possible === true;
      await entry('node_step_completed', { step, internal_operation_id: id, outcome: structuredClone(result) });
      if (result.status !== 'SUCCEEDED' || !operation.cleanupConfirmed) {
        throw new Error('Node procedure step did not confirm completion; inspect before retry');
      }
      // Even a successful gesture does not authorize the next one with old refs.
      return structuredClone(result);
    },
    get steps() { return sequence; },
  });
}
