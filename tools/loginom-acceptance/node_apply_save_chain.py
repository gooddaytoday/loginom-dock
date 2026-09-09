"""Journal proof of intermediate save followed by final save/reopen.

The caller must bind revisions to the verified catalog and separately prove
public calls, workspace preparation, settings and fresh output after reopening.
"""
import json
import re


def verify_save_chain(events, seed_request, final_path, revisions):
    failures = []
    keys = ('package.save_checkpoint', 'package.save_as')
    if (set(revisions) != set(keys) or any(not isinstance(v, str) or not v for v in revisions.values())
            or not isinstance(final_path, str) or not final_path.startswith('/') or not final_path.endswith('.lgp')
            or any(p in ('', '.', '..') for p in final_path.split('/')[1:])):
        return dict(passed=False, failures=['save_chain_expected_contract'])
    seed = [(i, e) for i, e in enumerate(events) if e.get('phase') == 'node_checkpoint'
            and e.get('operation_id') == seed_request.get('operation_id')]
    if len(seed) != 1:
        return dict(passed=False, failures=['save_chain_unique_seed'])
    previous_pos, seed_event = seed[0]
    label = seed_request.get('target', {}).get('label')
    tid = re.sub(r'\s', '_', str(label)).replace(',', '')
    graph = dict(nodes=[label], ports=[dict(node_label=label, tids=[tid+';Input_Connection[0]',
                 tid+';Input_Var[0]', tid+';Output_Data[0]'])], links=[])
    flow = {k: seed_request.get('workflow_ref', {}).get(k) for k in ('tab_tid', 'prefix')}
    identity = lambda e: (e.get('session_id'), e.get('runtime_revision'), json.dumps(e.get('target'), sort_keys=True))
    if any(not seed_event.get(k) for k in ('session_id', 'runtime_revision', 'target')) or not all(flow.values()):
        failures.append('save_chain_seed_binding')
    paths = (final_path+'.draft.lgp', final_path)
    operation_ids = []
    for index, (key, path) in enumerate(zip(keys, paths)):
        starts = [(i, e) for i, e in enumerate(events) if e.get('phase') == 'prepared' and e.get('action_key') == key]
        ends = [(i, e) for i, e in enumerate(events) if e.get('phase') == 'completed' and e.get('action_key') == key]
        if len(starts) != 1 or len(ends) != 1:
            failures.append(key+':unique_receipts')
            continue
        start_pos, start = starts[0]; end_pos, end = ends[0]
        operation_id = start.get('operation_id'); operation_ids.append(operation_id)
        if not isinstance(operation_id, str) or not operation_id or not previous_pos < start_pos < end_pos:
            failures.append(key+':order_or_id')
        previous_pos = end_pos
        checkpoint = start.get('checkpoint', {})
        # The task specifies destinations and persistence, not a conflict
        # policy. Either declared policy is valid when no conflict occurred;
        # the trace check below still rejects an actual overwrite here.
        parameters = start.get('parameters', {})
        if (set(parameters) != {'path', 'conflict_policy'} or parameters.get('path') != path
                or parameters.get('conflict_policy') not in ('fail', 'replace')):
            failures.append(key+':declared_parameters')
        for row in (start, end):
            if (row.get('operation_id') != operation_id or row.get('action_revision') != revisions[key]
                    or row.get('parameters') != parameters
                    or row.get('checkpoint') != checkpoint or identity(row) != identity(seed_event)):
                failures.append(key+':contract_binding')
        if (checkpoint.get('path') != path or checkpoint.get('graph') != graph or checkpoint.get('workflow_ref') != flow
                or checkpoint.get('package_identity', {}).get('path') != ('' if index == 0 else paths[0])):
            failures.append(key+':previous_package_graph')
        outcome = end.get('outcome', {})
        output = outcome.get('output', {})
        if (outcome.get('status') != 'SUCCEEDED' or outcome.get('phase') != 'verified'
                or outcome.get('cleanup_complete') is not True or outcome.get('error') is not None
                or outcome.get('operation_id') != operation_id or outcome.get('action_key') != key
                or output.get('package_ref') != dict(kind='package', path=path, active_identity=path)
                or output.get('reopened') is not bool(index)):
            failures.append(key+':verified_outcome')
        trace = outcome.get('trace', [])
        names = (['save_requested', 'save_flow_completed', 'open_saved_package_observed', 'postcondition_verified']
                 if index == 0 else ['save_requested', 'saved_package_closed', 'package_open_command_ready',
                                     'reopened_package_observed', 'postcondition_verified'])
        selected = []
        for name in names:
            matches = [(i, t) for i, t in enumerate(trace) if t.get('event') == name]
            if len(matches) != 1:
                failures.append(key+':trace_'+name)
            else:
                selected.append(matches[0])
        if len(selected) == len(names):
            if [i for i, _ in selected] != sorted(i for i, _ in selected):
                failures.append(key+':trace_order')
            saved, observed, post = selected[0][1], selected[-2][1], selected[-1][1]
            if (saved.get('path') != path or observed.get('requested_path') != path or observed.get('actual_path') != path
                    or observed.get('path_matches') is not True or observed.get('graph_matches') is not True
                    or observed.get('graph') != graph or post.get('graph') != graph
                    or post.get('package_path') != path or post.get('reopened') is not bool(index)):
                failures.append(key+':path_graph_evidence')
            if index == 0 and (observed.get('workflow_ref') != flow or observed.get('workflow_matches') is not True
                    or post.get('proof') != 'awaited_save_flow_same_open_workflow'
                    or post.get('persisted_content_verified') is not False):
                failures.append(key+':same_open_workflow')
        if index == 0 and (output.get('workflow_preserved') is not True or output.get('save_completed') is not True
                or output.get('persisted_content_verified') is not False
                or any(t.get('event') in ('saved_package_closed', 'reopened_package_observed') for t in trace)):
            failures.append(key+':checkpoint_no_reopen')
        if any(t.get('event') in ('overwrite_confirmed', 'conflict_rejected') for t in trace):
            failures.append(key+':unexpected_conflict')
    if len(set(operation_ids + [seed_request.get('operation_id')])) != 3:
        failures.append('save_chain_distinct_operations')
    return dict(passed=not failures, failures=sorted(set(failures)), save_operation_ids=operation_ids,
                scope='two_save_receipts_only', package_path=final_path,
                settings_persistence_verified=False, hermes_acceptance_verified=False)
