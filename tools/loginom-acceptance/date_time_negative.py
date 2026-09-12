"""Mutate one verified source journal in memory; no UI or model execution."""
import argparse
import json
from copy import deepcopy
from pathlib import Path
from date_time_audit import audit

def negative_checks(events, request):
    baseline = audit(events, request)
    if not baseline['passed']:
        raise ValueError('A passing baseline is required')
    op = request['operation_id']
    checks = {}
    def changed(phase, mutate):
        indexes = [i for i, e in enumerate(events) if e.get('operation_id') == op and e.get('phase') == phase]
        if not indexes:
            raise ValueError('Missing negative target: ' + phase)
        copied = list(events)
        for index in indexes:
            copied[index] = deepcopy(events[index])
            mutate(copied[index])
        return copied
    mutations = {
        'wrong_checkpoint_owner': ('node_checkpoint', lambda e: e['result']['node'].update(node_id='foreign')),
        'false_execution_id': ('node_checkpoint', lambda e: e['result']['execution'].update(execution_id='stale')),
        'wrong_output_value': ('node_checkpoint', lambda e: e['result']['output']['ports'][0]['sample'][0][0].update(value='999')),
        'incomplete_output': ('node_checkpoint', lambda e: e['result']['output']['ports'][0].update(sample_complete=False)),
        'unverified_phase': ('node_phase_completed', lambda e: e['receipt'].update(status='unverified') if e['receipt']['phase'] == 'configure' else None),
        'wrong_output_owner': ('node_phase_completed', lambda e: e['receipt']['value']['native_mapping']['node_context'].update(node_id='foreign') if e['receipt']['phase'] == 'output_mapping' else None),
        'missing_finish': ('node_phase_completed', lambda e: e['receipt']['value'].update(settings_applied=False) if e['receipt']['phase'] == 'finish' else None),
        'missing_matrix': ('node_phase_completed', lambda e: e['receipt']['value']['configuration'].update(field_matrices=[]) if e['receipt']['phase'] == 'configure' else None),
    }
    for name, (phase, mutate) in mutations.items():
        report = audit(changed(phase, mutate), request)
        checks[name] = dict(passed=report['passed'] is False)
    return dict(passed=all(c['passed'] for c in checks.values()), checks=checks)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('session', type=Path)
    parser.add_argument('operation_id')
    args = parser.parse_args()
    events = [json.loads(line) for line in (args.session / 'execution-events.jsonl').read_text().splitlines()]
    requests = [e['request'] for e in events if e.get('phase') == 'node_apply_prepared' and e.get('operation_id') == args.operation_id]
    if len(requests) != 1:
        raise SystemExit('One original request required')
    report = negative_checks(events, requests[0])
    (args.session / (args.operation_id + '-negative.json')).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['passed'] else 1)
