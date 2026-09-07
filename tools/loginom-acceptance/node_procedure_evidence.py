"""Independent journal checks for the private text-import procedure.

Input must come from the authenticated session journal. This verifier does not
admit a catalog, authenticate a journal file, or establish Hermes acceptance.
It never uses the handler's settings_readback_verified summary as evidence.
"""
import hashlib
import json


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def verify_internal_sequence(events, operation_id):
    rows = [r for r in events if r.get('operation_id') == operation_id]
    failures, observations, mutations = [], [], []
    current = pending = None
    samples = []
    previous_step = 0
    session = None
    document = workflow = origin = build = None
    for row in rows:
        if row.get('internal_provenance') != 'client_node_procedure_v1':
            continue
        identity = (row.get('session_id'), row.get('runtime_revision'), row.get('target'))
        if session is None:
            session = identity
        if identity != session or not identity[0] or not identity[1]:
            failures.append('journal_session_mismatch')
        phase, step = row.get('phase'), row.get('step')
        if not isinstance(step, int) or step < 1 or step > 96:
            failures.append('invalid_step'); continue
        if row.get('internal_operation_id') != f'{operation_id}:n{step}':
            failures.append('internal_identity_mismatch')
        if phase == 'node_observation_sample':
            if pending or (samples and samples[0].get('step') != step):
                failures.append('observation_interleaving')
            if row.get('sample') != len(samples):
                failures.append('sample_sequence')
            samples.append(row)
        elif phase == 'node_observation_completed':
            semantic = row.get('readiness', {}).get('policy') == 'semantic_condition_v2'
            required_samples = row.get('readiness', {}).get('required_samples') if semantic else 4
            if semantic and required_samples not in (1, 2):
                failures.append('invalid_readiness_policy'); required_samples = 2
            if step != previous_step + 1 or pending or not required_samples <= len(samples) <= (80 if row.get('readiness') else 12):
                failures.append('observation_sequence')
            readiness = row.get('readiness')
            if readiness is not None:
                condition = readiness.get('condition')
                if (not isinstance(condition, str) or not condition.strip()
                        or readiness.get('satisfied') is not True
                        or not 0 <= readiness.get('elapsed_ms', -1) < readiness.get('timeout_ms', 0) <= 15000
                        or any(s.get('readiness', {}).get('condition') != condition for s in samples)
                        or any(s.get('readiness', {}).get('satisfied') is not True for s in samples[-required_samples:])):
                    failures.append('readiness_not_confirmed')
                if semantic and required_samples == 2 and (not readiness.get('identity_sha256') or any(
                        s.get('readiness', {}).get('identity_sha256') != readiness['identity_sha256'] for s in samples[-2:])):
                    failures.append('target_identity_not_stable')
            outcome = row.get('outcome', {})
            state = outcome.get('output', {})
            if outcome.get('status') != 'SUCCEEDED' or not samples or samples[-1].get('outcome') != outcome:
                failures.append('observation_not_backed_by_sample')
            recent = [s.get('outcome', {}).get('output', {}) for s in samples[-required_samples:]]
            if len(recent) != required_samples or any((not semantic and s.get('dom_epoch') != state.get('dom_epoch')) or s.get('ui', {}).get('masks') for s in recent):
                failures.append('observation_not_settled')
            doc = state.get('dom_epoch', {}).get('document')
            if document is None:
                document, workflow, origin, build = doc, state.get('workflow_ref'), state.get('origin'), state.get('loginom_build')
            if not doc or (doc, state.get('workflow_ref'), state.get('origin'), state.get('loginom_build')) != (document, workflow, origin, build):
                failures.append('document_context_mismatch')
            ui = state.get('ui', {})
            if state.get('scan', {}).get('complete') is not True or ui.get('masks') != [] or ui.get('dialogs') != []:
                failures.append('observation_blocked')
            current = state
            observations.append((step, state))
            previous_step, samples = step, []
        elif phase == 'node_step_prepared':
            if step != previous_step + 1 or pending or samples or current is None:
                failures.append('mutation_without_fresh_observation')
            action = row.get('action', {})
            if current is not None:
                if row.get('observation_sha256') != digest(current):
                    failures.append('observation_digest_mismatch')
                if row.get('signature') != digest([row.get('internal_operation_id'), action, current]):
                    failures.append('step_signature_mismatch')
                refs = [action.get(k) for k in ('ref', 'source_ref', 'target_ref') if k in action]
                for ref in refs:
                    matching = [e for e in current.get('ui', {}).get('elements', []) if e.get('ref') == ref]
                    if len(matching) != 1 or action.get('verb') not in matching[0].get('allowed_actions', []):
                        failures.append('unissued_action_reference')
            pending = row
            current = None
        elif phase == 'node_step_completed':
            outcome = row.get('outcome', {})
            if not pending or pending.get('step') != step:
                failures.append('completion_without_preparation')
            if outcome.get('operation_id') != row.get('internal_operation_id') or outcome.get('action_key') != 'ui.act':
                failures.append('receipt_identity_mismatch')
            if outcome.get('status') != 'SUCCEEDED' or outcome.get('cleanup_complete') is not True:
                failures.append('incomplete_mutation')
            if pending:
                mutations.append((step, pending['action'], outcome))
            pending = None
            previous_step = step
        else:
            failures.append('unknown_internal_event')
    if pending or samples or not observations or not mutations:
        failures.append('incomplete_procedure_journal')
    return {'passed': not failures, 'failures': sorted(set(failures)),
            'observations': observations, 'mutations': mutations}


def verify_text_import_roundtrip(events, operation_id, expected):
    sequence = verify_internal_sequence(events, operation_id)
    failures = list(sequence['failures'])
    mutations, observations = sequence['mutations'], sequence['observations']
    saves = [s for s, a, _ in mutations if a.get('verb') == 'finish_wizard']
    opens = [s for s, a, _ in mutations if a.get('verb') == 'open_wizard']
    if len(saves) != 2 or len(opens) != 1 or not saves[0] < opens[0] < saves[1]:
        failures.append('save_open_save_sequence')
    else:
        nodes = []
        for step, action, outcome in mutations:
            if action.get('verb') == 'finish_wizard':
                proof = [e for e in outcome.get('trace', []) if e.get('event') == 'wizard_finish_graph_verified']
                if len(proof) != 1:
                    failures.append('finish_receipt_missing')
                else:
                    nodes.append(proof[0].get('node', {}).get('node_label'))
        if len(nodes) != 2 or not nodes[0] or nodes[0] != nodes[1]:
            failures.append('finished_node_changed')
        for start, end in [(0, saves[0]), (opens[0], saves[1])]:
            reads = [(s, o) for s, o in observations if start < s < end]
            chosen = {}
            for step, state in reads:
                stage = state.get('wizard', {}).get('stage')
                if stage in ['text_import_file', 'text_import_format', 'output_mapping']:
                    chosen[stage] = (step, state['wizard'])
            if set(chosen) != {'text_import_file', 'text_import_format', 'output_mapping'}:
                failures.append('missing_stage_readback'); continue
            if not chosen['text_import_file'][0] < chosen['text_import_format'][0] < chosen['output_mapping'][0]:
                failures.append('stage_order')
            source = chosen['text_import_file'][1].get('import_source', {}).get('fields', {})
            for name, desired in expected['source'].items():
                f = source.get(name, {})
                value = str(desired) if name == 'rows_to_skip' else desired
                if f.get('status') != 'observed' or f.get('truncated') is True or f.get('value') != value:
                    failures.append('source_' + name)
            owners = [chosen[k][1].get('owner_context', {}) for k in ('text_import_file', 'text_import_format', 'output_mapping')]
            owner_ids = [(o.get('node', {}).get('tid'), [(x.get('tid'), x.get('label')) for x in o.get('path', [])]) for o in owners]
            if any(o.get('status') != 'observed' for o in owners) or not owner_ids[0][0] or any(o != owner_ids[0] for o in owner_ids):
                failures.append('wizard_owner_mismatch')
            if start and nodes and not owner_ids[0][0].endswith('>' + nodes[0]):
                failures.append('reopened_node_mismatch')
            formatted = chosen['text_import_format'][1]
            aliases = {'delimiter': {';': 'Точка с запятой', ',': 'Запятая', '\t': 'Символ табуляции', ' ': 'Пробел'},
                       'decimal_separator': {'.': 'Точка (.)', ',': 'Запятая (,)'},
                       'text_qualifier': {'"': 'Двойная кавычка (")', "'": "Одинарная кавычка (')", '`': 'Обратная кавычка (`)', '': 'Нет'}}
            for name, desired in expected['format'].items():
                f = formatted.get('settings', {}).get('fields', {}).get(name, {})
                allowed = [desired]
                if desired in aliases.get(name, {}):
                    allowed.append(aliases[name][desired])
                if f.get('status') != 'observed' or f.get('truncated') is True or f.get('value') not in allowed:
                    failures.append('format_' + name)
            columns = formatted.get('import_columns', {})
            if columns.get('definition_coverage', {}).get('status') != 'complete_configured_columns' or columns.get('definition_coverage', {}).get('count') != len(expected['columns']):
                failures.append('column_coverage')
            actual = [{k: c.get(k) for k in expected['columns'][0]} for c in columns.get('fields', [])]
            if actual != expected['columns']:
                failures.append('column_values')
            output = chosen['output_mapping'][1].get('output_columns', {})
            if output.get('definition_coverage', {}).get('status') != 'complete_configured_rows' or output.get('definition_coverage', {}).get('count') != len(expected['columns']):
                failures.append('mapping_coverage')
            wanted = [{k: c[k] for k in ('name', 'label', 'type', 'data_kind')} for c in expected['columns']]
            if [{k: c.get(k) for k in wanted[0]} for c in output.get('fields', [])] != wanted:
                failures.append('mapping_values')
            for actual, desired in zip(output.get('fields', []), expected['columns']):
                if actual.get('source', {}).get('status') != 'rendered_source' or actual.get('source', {}).get('label') != desired['label'] or actual.get('source', {}).get('type') != desired['type']:
                    failures.append('mapping_source_values')
    return {'passed': not failures, 'failures': sorted(set(failures)),
            'journal_authentication_verified': False, 'hermes_acceptance_verified': False,
            'package_persistence_verified': False, 'execution_verified': False}


def audit_bound_operation(evidence, request, expected, source_path, prefix, transfer_verified):
    """Bind internal evidence to one real external request and its upload proof."""
    failure = {'passed': False, 'reason': 'node_procedure_binding_missing'}
    if not transfer_verified or not source_path:
        return failure
    try:
        calls, replies, events = evidence['calls'], evidence['tools'], evidence['events']
        configs = [c for c in calls if c.get('tool') == prefix + 'dock_action_run'
                   and c.get('arguments', {}).get('action_key') == 'node.configure_text_import']
        uploads = [c for c in calls if c.get('tool') == prefix + 'dock_artifact_upload']
        if len(configs) != 1 or len(uploads) != 1:
            return failure
        call, upload = configs[0], uploads[0]
        args = call['arguments']; parameters = args['parameters']; operation_id = args['operation_id']
        twins = [r for r in replies if (r.get('session_id'), r.get('tool_call_id')) == (call['session_id'], call['tool_call_id'])]
        if len(twins) != 1 or twins[0].get('tool') != call['tool'] or twins[0]['row'] <= call['row']:
            return failure
        if call['session_id'] != upload['session_id'] or parameters['source_transfer_operation_id'] != upload['arguments']['operation_id']:
            return failure
        output = twins[0]['result']
        if output.get('status') != 'SUCCEEDED' or output.get('cleanup_complete') is not True or output.get('operation_id') != operation_id:
            return failure
        prepared = [(i, e) for i, e in enumerate(events) if e.get('operation_id') == operation_id and e.get('phase') == 'prepared']
        completed = [(i, e) for i, e in enumerate(events) if e.get('operation_id') == operation_id and e.get('phase') == 'completed']
        if len(prepared) != 1 or len(completed) != 1 or prepared[0][0] >= completed[0][0]:
            return failure
        if prepared[0][1].get('parameters') != parameters or completed[0][1].get('outcome') != output:
            return failure
        checkpoint = prepared[0][1].get('checkpoint', {})
        if checkpoint.get('source_transfer_operation_id') != upload['arguments']['operation_id'] or checkpoint.get('workflow_ref') != parameters['node_ref']['workflow_ref']:
            return failure
        subset = events[prepared[0][0]+1:completed[0][0]]
        all_internal = [e for e in events if e.get('operation_id') == operation_id and e.get('internal_provenance') == 'client_node_procedure_v1']
        if not all_internal or all_internal != subset:
            return failure
        if any(not e.get('readiness') for e in subset if e.get('phase') in ('node_observation_sample', 'node_observation_completed')):
            return {**failure, 'reason': 'explicit_readiness_evidence_missing'}
        desired = {'source': {'source_path': source_path, 'encoding': 'UTF-8 (65001)',
                              'rows_to_skip': 0, 'first_line_as_title': True},
                   'format': {'delimiter': expected['input']['delimiter'], 'decimal_separator': expected['input']['decimal_separator'],
                              'text_qualifier': expected['input']['quote'], 'null_marker': expected['input']['null_literal']},
                   'columns': [{'name': c['name'], 'label': c['name'], 'type': c['type'], 'used': True,
                                'data_kind': 'Непрерывный' if c['type'] in ('integer', 'real') else 'Дискретный'} for c in expected['schema']]}
        if parameters['settings'] != desired:
            return {**failure, 'reason': 'declared_fixture_settings_mismatch'}
        first = next(e['outcome']['output'] for e in subset if e['phase'] == 'node_observation_completed')
        if first.get('authenticated') is not True or first.get('dom_epoch', {}).get('document') != checkpoint.get('document_id') or first.get('wizard', {}).get('owner_context') != checkpoint.get('owner'):
            return failure
        proof = verify_text_import_roundtrip(subset, operation_id, desired)
        return {**proof, 'operation_id': operation_id, 'reason': 'bound_internal_text_import_roundtrip'}
    except (KeyError, TypeError, ValueError, IndexError, StopIteration, AttributeError):
        return failure
