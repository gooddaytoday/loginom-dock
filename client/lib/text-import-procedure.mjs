// Fixed one-node procedure, not a scenario interpreter. Until native acceptance
// and the independent auditor are complete this module is not catalog-admitted.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const types = { integer: 'Целый', real: 'Вещественный', string: 'Строковый', boolean: 'Логический', datetime: 'Дата/Время' };
const kinds = ['Неопределенное', 'Непрерывный', 'Дискретный'];
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function one(values, message) { requireValue(values.length === 1, message); return values[0]; }

export function validateTextImportRequest(p) {
  requireValue(p && typeof p === 'object' && !Array.isArray(p), 'Text import parameters are required');
  requireValue(Object.keys(p).sort().join(',') === 'columns,format,source', 'Unexpected text import parameters');
  requireValue(p.source && Object.keys(p.source).sort().join(',') === 'encoding,first_line_as_title,rows_to_skip,source_path', 'Source parameters are incomplete');
  requireValue(typeof p.source.source_path === 'string' && /^\/(?!\/)/.test(p.source.source_path)
    && p.source.source_path.length <= 2048 && !/[|*?%\\\x00-\x1f]/.test(p.source.source_path)
    && p.source.source_path.split('/').slice(1).every(x => x && x !== '.' && x !== '..'), 'One explicit storage path is required');
  requireValue(typeof p.source.encoding === 'string' && p.source.encoding.length > 0 && p.source.encoding.length <= 100, 'Encoding is required');
  requireValue(typeof p.source.first_line_as_title === 'boolean' && Number.isInteger(p.source.rows_to_skip)
    && p.source.rows_to_skip >= 0 && p.source.rows_to_skip <= 1000000, 'Invalid source row settings');
  requireValue(p.format && Object.keys(p.format).sort().join(',') === 'decimal_separator,delimiter,null_marker,text_qualifier', 'Format parameters are incomplete');
  for (const [name, value] of Object.entries(p.format)) requireValue(typeof value === 'string'
    && value.length <= (name === 'null_marker' ? 256 : 1) && !/[\x00\r\n]/.test(value), 'Invalid format value: ' + name);
  requireValue(p.format.delimiter.length === 1 && ['.', ','].includes(p.format.decimal_separator), 'Explicit delimiters are required');
  requireValue(Array.isArray(p.columns) && p.columns.length >= 1 && p.columns.length <= 8, 'The current reader supports 1–8 fully visible configured columns');
  requireValue(new Set(p.columns.map(c => c?.name)).size === p.columns.length, 'Duplicate column names');
  for (const c of p.columns) {
    requireValue(c && Object.keys(c).sort().join(',') === 'data_kind,label,name,type,used', 'Column parameters are incomplete');
    for (const key of ['name', 'label']) requireValue(typeof c[key] === 'string' && c[key].length > 0 && c[key].length <= 120 && !/[\x00-\x1f]/.test(c[key]), 'Invalid column ' + key);
    requireValue(Object.hasOwn(types, c.type) && kinds.includes(c.data_kind) && typeof c.used === 'boolean', 'Invalid column semantics');
  }
}

export async function configureTextImportDraft(channel, parameters, owner) {
  validateTextImportRequest(parameters);
  requireValue(owner?.status === 'observed' && owner.node?.tid && owner.path?.length, 'An observed wizard owner is required');
  let currentOwner = owner;
  const identity = c => ({ node: c?.node?.tid, path: c?.path?.map(x => ({ tid: x.tid, label: x.label })) });
  const read = async (stage, condition = 'stage controls ready', ready = () => true) => {
    const s = await channel.observe({ condition: stage + ': ' + condition, ready: state => {
      const w = state.wizard;
      if (w?.status === 'observed' && !same(identity(w.owner_context), identity(currentOwner))) {
        throw new Error('Text import wizard owner changed');
      }
      if (w?.status !== 'observed' || w.stage !== stage) return false;
      const fields = stage === 'text_import_file' ? w.import_source?.fields
        : stage === 'text_import_format' ? w.settings?.fields : null;
      const names = stage === 'text_import_file' ? Object.keys(parameters.source)
        : stage === 'text_import_format' ? Object.keys(parameters.format) : [];
      if (!names.every(name => fields?.[name]?.status === 'observed' && fields[name].truncated !== true)) return false;
      if (stage === 'output_mapping' && w.output_columns?.definition_coverage?.status !== 'complete_configured_rows') return false;
      if (stage === 'done' && state.ui.elements.filter(e => e.tid === w.root_tid + ';btnDone'
        && e.allowed_actions?.includes('finish_wizard')).length !== 1) return false;
      return ready(state);
    } });
    requireValue(s.wizard?.status === 'observed' && s.wizard.stage === stage
      && same(identity(s.wizard.owner_context), identity(currentOwner)), 'Text import wizard stage or owner changed');
    return s;
  };
  const act = (s, action) => channel.act(action);
  const field = (s, name, source = false) => {
    const f = (source ? s.wizard.import_source?.fields : s.wizard.settings?.fields)?.[name];
    requireValue(f?.status === 'observed' && f.truncated !== true, 'Field is not completely observed: ' + name);
    return f;
  };
  const control = (s, suffix, verb) => one(s.ui.elements.filter(e => e.tid === s.wizard.root_tid + ';' + suffix
    && e.allowed_actions?.includes(verb)), 'Wizard control is absent or ambiguous: ' + suffix).ref;
  const next = async (from, to) => {
    const s = await read(from, 'Next control available', state => state.ui.elements.filter(e =>
      e.tid === state.wizard.root_tid + ';btnNext' && e.allowed_actions?.includes('wizard_step')).length === 1);
    await act(s, { verb: 'wizard_step', ref: control(s, 'btnNext', 'wizard_step'), expected_stage: to });
    return read(to);
  };
  // Source and format are caller decisions. No automatic type detection result
  // is treated as confirmation of the requested schema.
  for (const name of ['source_path', 'encoding', 'rows_to_skip', 'first_line_as_title']) {
    let s = await read('text_import_file'), f = field(s, name, true);
    const desired = name === 'rows_to_skip' ? String(parameters.source[name]) : parameters.source[name];
    if (f.value === desired) continue;
    if (name === 'first_line_as_title') await act(s, { verb: 'set_checked', ref: f.display_ref, checked: desired });
    else {
      await act(s, { verb: 'fill', ref: f.input_ref, text: desired });
      s = await read('text_import_file'); f = field(s, name, true);
      await act(s, { verb: 'press', ref: f.input_ref, key: 'Tab' });
    }
    s = await read('text_import_file', 'source value applied: ' + name, state =>
      state.wizard.import_source.fields[name]?.value === desired);
    requireValue(field(s, name, true).value === desired, 'Source value was not applied: ' + name);
  }
  const sourceReadback = (await read('text_import_file')).wizard.import_source;
  await next('text_import_file', 'text_import_format');
  for (const [name, text] of Object.entries(parameters.format)) {
    const s = await read('text_import_format'), f = field(s, name);
    if (f.value !== text) await act(s, { verb: 'set_wizard_field', ref: f.input_ref, text });
  }
  const columns = s => {
    const c = s.wizard.import_columns;
    requireValue(c?.definition_coverage?.status === 'complete_configured_columns' && c.truncated === false
      && c.fields?.length === parameters.columns.length && c.definition_coverage.count === c.fields.length
      && c.fields.every((f, i) => f.status === 'observed' && f.index === i), 'Configured columns are not completely visible');
    return c.fields;
  };
  for (let i = 0; i < parameters.columns.length; i++) {
    for (const property of ['type', 'data_kind']) {
      const s = await read('text_import_format', 'complete configured columns', state =>
        state.wizard.import_columns?.definition_coverage?.status === 'complete_configured_columns'
        && state.wizard.import_columns?.fields?.length === parameters.columns.length), c = columns(s)[i], wanted = parameters.columns[i];
      requireValue(c.name === wanted.name && c.label === wanted.label && c.used === wanted.used,
        'Column names, labels or selection differ; this candidate only changes type and data kind');
      if (c[property] === wanted[property]) continue;
      await act(s, { verb: 'double_click', ref: c.cell_refs[property] });
      const editing = await read('text_import_format', 'column editor: ' + i + '/' + property, state => {
        const e = state.wizard.import_column_editor;
        return e?.status === 'observed' && e.index === i && e.property === property
          && e.name === wanted.name && e.picker_status === 'observed';
      }), editor = editing.wizard.import_column_editor;
      requireValue(editor?.status === 'observed' && editor.index === i && editor.property === property
        && editor.name === wanted.name && editor.picker_status === 'observed', 'Column editor binding is incomplete');
      await act(editing, { verb: 'click', ref: editor.picker_ref });
      const label = property === 'type' ? types[wanted.type] : wanted.data_kind;
      const choosing = await read('text_import_format', 'column option: ' + i + '/' + property, state =>
        state.ui.elements.filter(e => e.allowed_actions?.includes('select_wizard_option')
          && e.wizard_combo?.kind === 'option' && e.wizard_combo.label === label
          && e.wizard_combo.field?.owner_ref === editor.owner_ref
          && e.wizard_combo.field?.name === property).length === 1);
      const option = one(choosing.ui.elements.filter(e => e.allowed_actions?.includes('select_wizard_option')
        && e.wizard_combo?.kind === 'option' && e.wizard_combo.label === label
        && e.wizard_combo.field?.owner_ref === editor.owner_ref
        && e.wizard_combo.field?.name === property), 'Column option is absent or ambiguous');
      await act(choosing, { verb: 'select_wizard_option', ref: option.ref });
      requireValue(columns(await read('text_import_format', 'column value applied: ' + i + '/' + property, state =>
        state.wizard.import_columns?.fields?.[i]?.[property] === wanted[property]))[i][property] === wanted[property], 'Column readback differs');
    }
  }
  const formatted = await read('text_import_format');
  const schemaReadback = columns(formatted);
  const mapping = await next('text_import_format', 'output_mapping');
  const output = mapping.wizard.output_columns;
  requireValue(output?.definition_coverage?.status === 'complete_configured_rows'
    && output.definition_coverage.count === parameters.columns.length && output.fields?.length === parameters.columns.length
    && output.fields.every((c, i) => c.status === 'observed' && c.name === parameters.columns[i].name
      && c.label === parameters.columns[i].label && c.type === parameters.columns[i].type
      && c.data_kind === parameters.columns[i].data_kind && c.source?.status === 'rendered_source'
      && c.source.label === parameters.columns[i].label && c.source.type === parameters.columns[i].type),
  'Output mapping does not match the complete requested schema');
  const done = await next('output_mapping', 'done');
  const finished = await act(done, { verb: 'finish_wizard', ref: control(done, 'btnDone', 'finish_wizard') });
  const receipt = one(finished.trace.filter(e => e.event === 'wizard_finish_graph_verified'), 'Wizard finish graph receipt is missing');
  const nodeLabel = receipt.node?.node_label;
  requireValue(typeof nodeLabel === 'string' && nodeLabel.length > 0, 'Finished node identity is absent');
  let graph = await channel.observe({ condition: 'saved node incarnation stable after Done', confirmIdentity: state => state.ui.elements.filter(e =>
    e.graph_node?.node_label === nodeLabel && e.graph_node.part === 'body').map(e => e.ref), ready: state =>
    state.wizard?.status === 'absent' && state.ui.elements.filter(e => e.graph_node?.node_label === nodeLabel
      && e.graph_node.part === 'body' && e.allowed_actions?.includes('click')).length === 1 });
  requireValue(graph.wizard?.status === 'absent', 'Wizard is still open after Done');
  const body = one(graph.ui.elements.filter(e => e.graph_node?.node_label === nodeLabel
    && e.graph_node.part === 'body' && e.allowed_actions?.includes('click')), 'Finished graph node is ambiguous');
  await channel.act({ verb: 'click', ref: body.ref });
  graph = await channel.observe({ condition: 'saved node settings available', ready: state =>
    state.wizard?.status === 'absent' && state.ui.elements.filter(e => e.wizard_open?.node?.node_label === nodeLabel
      && e.allowed_actions?.includes('open_wizard')).length === 1 });
  const settings = one(graph.ui.elements.filter(e => e.wizard_open?.node?.node_label === nodeLabel
    && e.allowed_actions?.includes('open_wizard')), 'Finished node settings control is absent');
  const opened = await channel.act({ verb: 'open_wizard', ref: settings.ref });
  const reopenedOwner = opened.output.wizard?.owner_context;
  requireValue(reopenedOwner?.status === 'observed'
    && reopenedOwner.node.tid === owner.path.at(-3).tid + '>' + nodeLabel
    && same(reopenedOwner.path.slice(0, -2).map(x => ({ tid: x.tid, label: x.label })),
      owner.path.slice(0, -2).map(x => ({ tid: x.tid, label: x.label }))), 'Reopened wizard belongs to a different node');
  currentOwner = reopenedOwner;
  const reopenedSource = await read('text_import_file');
  for (const [name, desired] of Object.entries(parameters.source)) requireValue(
    field(reopenedSource, name, true).value === (name === 'rows_to_skip' ? String(desired) : desired),
    'Saved source differs after reopening: ' + name);
  const reopenedFormat = await next('text_import_file', 'text_import_format');
  const displayValues = {
    delimiter: { ';': 'Точка с запятой', ',': 'Запятая', '\t': 'Символ табуляции', ' ': 'Пробел' },
    text_qualifier: { '"': 'Двойная кавычка (")', "'": "Одинарная кавычка (')", '`': 'Обратная кавычка (`)', '': 'Нет' },
    decimal_separator: { '.': 'Точка (.)', ',': 'Запятая (,)' },
  };
  for (const [name, desired] of Object.entries(parameters.format)) {
    const actual = field(reopenedFormat, name).value;
    requireValue(actual === desired || actual === displayValues[name]?.[desired], 'Saved format differs after reopening: ' + name);
  }
  requireValue(columns(reopenedFormat).every((c, i) => Object.keys(parameters.columns[i]).every(k => c[k] === parameters.columns[i][k])),
    'Saved columns differ after reopening');
  const reopenedMapping = await next('text_import_format', 'output_mapping');
  const projection = c => ({ name: c.name, label: c.label, type: c.type, data_kind: c.data_kind, usage: c.usage,
    source: { status: c.source?.status, label: c.source?.label, type: c.source?.type } });
  const actualOutput = reopenedMapping.wizard.output_columns;
  requireValue(actualOutput?.definition_coverage?.status === 'complete_configured_rows'
    && actualOutput.definition_coverage.count === output.fields.length
    && same(actualOutput.fields.map(projection), output.fields.map(projection))
    && actualOutput.auto_sync?.status === 'observed' && output.auto_sync?.status === 'observed'
    && actualOutput.auto_sync.value === output.auto_sync.value, 'Saved output mapping differs after reopening');
  const readbackDone = await next('output_mapping', 'done');
  await channel.act({ verb: 'finish_wizard', ref: control(readbackDone, 'btnDone', 'finish_wizard') });
  return { source: sourceReadback, format: formatted.wizard.settings, columns: schemaReadback,
    output_columns: output, settings_readback_verified: true, reopen_required: false, node_label: nodeLabel,
    package_saved: false, execution_started: false };
}
