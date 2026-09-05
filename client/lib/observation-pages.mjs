import { randomUUID, createHash } from 'node:crypto';

const scopes = new Set(['all', 'palette', 'graph', 'dialogs']);
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const revision = snapshot => {
  const { operation, observation_id, recovery, gesture_applied, verification_required, ...state } = snapshot;
  return createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex');
};
const compactElement = item => {
  const { signature, bounding_box, ...rest } = item;
  return { ...rest, ...(signature ? { signature: { tag: signature.tag } } : {}) };
};
const compactOperation = operation => operation && ({
  operation_id: operation.operation_id, state: operation.state, cleanup_confirmed: operation.cleanup_confirmed,
  effect_state: operation.effect_state, recovery_options: operation.recovery_options, next_steps: operation.next_steps,
  outcome_summary: operation.outcome ? { status: operation.outcome.status, action_key: operation.outcome.action_key,
    operation_id: operation.outcome.operation_id, detail_tool: 'dock_operation_inspect' } : null,
});

// Full guard snapshots stay private. Only issued references may be acted on.
// Cursors address one captured state; a fresh browser read must match its revision.
export function createObservationPages({ maxBytes = 12000, maxRecords = 32, capacity = 8 } = {}) {
  const entries = new Map(), cursors = new Map();
  const clear = () => { entries.clear(); cursors.clear(); };
  const remove = id => {
    entries.delete(id);
    for (const [cursor, page] of cursors) if (page.id === id) cursors.delete(cursor);
  };
  const records = (snapshot, scope) => {
    const rows = [];
    if (scope === 'all' || scope === 'graph') {
      for (const node of snapshot.nodes ?? []) {
        const ports = node.ports ?? [];
        for (let offset = 0; offset < Math.max(ports.length, 1); offset += 8) {
          rows.push(['nodes', { ...node, ports: ports.slice(offset, offset + 8),
            ...(ports.length > 8 ? { ports_page: { offset, total: ports.length, complete: false } } : {}) }]);
        }
      }
      for (const link of snapshot.links ?? []) rows.push(['links', link]);
    }
    for (const item of snapshot.ui.elements ?? []) {
      const palette = /;ModelForm;colVendors_Компоненты>/.test(item.tid ?? '');
      if (scope === 'palette' && !palette || scope === 'graph' && !['graph', 'graph_editor'].includes(item.scope)
          || scope === 'dialogs' && item.scope !== 'dialog') continue;
      rows.push(['elements', compactElement(item)]);
    }
    for (const collection of ['dialogs', 'masks', 'messages', 'table_cells']) {
      if (scope === 'palette' || scope === 'graph') continue;
      for (const item of snapshot.ui[collection] ?? []) rows.push([collection, item]);
    }
    return rows;
  };
  const render = (entry, offset) => {
    const snapshot = entry.snapshot;
    const output = Object.fromEntries(['origin', 'authenticated', 'loginom_build', 'workflow_ref', 'active_identity', 'package_identity', 'workarea', 'verification_required', 'gesture_applied', 'scan']
      .filter(key => key in snapshot).map(key => [key, structuredClone(snapshot[key])]));
    output.operation = compactOperation(snapshot.operation);
    if (snapshot.recovery) output.recovery = compactOperation(snapshot.recovery);
    output.observation_id = entry.id;
    output.observation_revision = entry.revision;
    output.nodes = []; output.links = [];
    output.ui = { elements: [], dialogs: [], masks: [], messages: [], table_cells: [], truncated: { ...snapshot.ui.truncated } };
    if (entry.scope !== 'all') {
      // Scope omission is not evidence of absence in the workspace.
      if (entry.rows.filter(([key]) => key === 'elements').length < (snapshot.ui.elements?.length ?? 0)) output.ui.truncated.elements = true;
      if (entry.scope !== 'dialogs') for (const key of ['dialogs', 'masks', 'messages', 'table_cells']) output.ui.truncated[key] = true;
    }
    output.page = { schema_version: 1, scope: entry.scope, offset, returned: 0, total_records: entry.rows.length,
      next_cursor: null, captured_snapshot_complete: false, full_dom_complete: false };
    if (bytes(output) > maxBytes - 700) throw new Error('Observation metadata exceeds the page budget; inspect a narrower context');
    let end = offset;
    while (end < entry.rows.length && end - offset < maxRecords) {
      const [collection, value] = entry.rows[end];
      const target = ['nodes', 'links'].includes(collection) ? output[collection] : output.ui[collection];
      target.push(value);
      if (bytes(output) > maxBytes - 700) { target.pop(); break; }
      end++;
    }
    if (end === offset && end < entry.rows.length) throw new Error('One observation record exceeds the page budget');
    const included = entry.rows.slice(offset, end);
    for (const collection of ['nodes', 'links', 'elements', 'dialogs', 'masks', 'messages', 'table_cells']) {
      if (entry.rows.some(([key], index) => key === collection && (index < offset || index >= end))) output.ui.truncated[collection] = true;
    }
    if (!['all', 'graph'].includes(entry.scope)) output.ui.truncated.nodes = output.ui.truncated.links = output.ui.truncated.ports = true;
    if (output.nodes.some(node => node.ports_page)) output.ui.truncated.ports = true;
    for (const [collection, item] of included) if (collection === 'elements') entry.issued.add(item.ref);
    output.page.returned = end - offset;
    output.page.captured_snapshot_complete = offset === 0 && end === entry.rows.length;
    if (end < entry.rows.length) {
      let cursor = entry.next.get(end);
      if (!cursor) { cursor = randomUUID(); entry.next.set(end, cursor); cursors.set(cursor, { id: entry.id, offset: end }); }
      output.page.next_cursor = cursor;
    }
    return output;
  };
  return {
    clear,
    get(id) { return entries.get(id)?.snapshot; },
    assertIssued(id, action) {
      const entry = entries.get(id);
      if (!entry || [action.ref, action.source_ref, action.target_ref].filter(Boolean).some(ref => !entry.issued.has(ref))) {
        throw new Error('UI reference has not been delivered in this observation; read its page first');
      }
    },
    retain(outcome, { scope = 'all' } = {}) {
      if (!scopes.has(scope)) throw new Error('Unknown observation scope');
      if (!outcome?.output?.ui) return outcome;
      const snapshot = structuredClone(outcome.output), id = randomUUID();
      const entry = { id, snapshot, revision: revision(snapshot), scope, rows: records(snapshot, scope), issued: new Set(), next: new Map() };
      const output = render(entry, 0);
      entries.set(id, entry);
      while (entries.size > capacity) remove(entries.keys().next().value);
      outcome.output = output;
      return outcome;
    },
    next(cursor, fresh) {
      const page = cursors.get(cursor), entry = page && entries.get(page.id);
      if (!entry) throw new Error('Observation cursor is stale or belongs to another session');
      if (fresh.status !== 'SUCCEEDED' || revision(fresh.output) !== entry.revision) {
        remove(entry.id);
        throw new Error('Workspace changed between observation pages; begin a new observation');
      }
      return { ...fresh, output: render(entry, page.offset) };
    },
  };
}
