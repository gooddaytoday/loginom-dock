"""Independent proof of a checked-state action, using immutable browser evidence."""
from rename_effect import journal_equal

TARGET_SUFFIX = 'WizrdMCF;ImportTextFilePreviewWizard;chkParallelProcessing;ValueControl;DisplayEl'


def audit_goal(evidence, checks, prefix, mutations):
    """Prove a three-step checkbox round trip in the real Text Import wizard."""
    def check(name, value):
        checks.append({'name': name, 'passed': bool(value)})
    calls = evidence['calls']
    actions = [c for c in calls if c['tool'] == prefix + 'dock_ui_action'
               and c.get('arguments', {}).get('action', {}).get('verb') == 'set_checked']
    snapshots = [(t['row'], t['result']['output']) for t in evidence['tools']
                 if isinstance(t.get('result'), dict) and isinstance(t['result'].get('output'), dict)]
    transitions = []
    for call in actions:
        prior = max((c['row'] for c in calls if c['tool'] in mutations and c['row'] < call['row']), default=-1)
        args = call.get('arguments', {})
        targets = [e for row, s in snapshots if prior < row < call['row']
                   and s.get('observation_id') == args.get('observation_id')
                   for e in s.get('ui', {}).get('elements', []) if e.get('ref') == args['action'].get('ref')]
        target = targets[0] if targets and all(e == targets[0] for e in targets) else {}
        proof = prove(call, target, evidence)
        if (proof and target.get('tid', '').endswith(TARGET_SUFFIX)
                and target.get('check_state', {}).get('source') == 'loginom_ext'):
            transitions.append(proof)
    check('three_fresh_checked_actions_bound_to_browser', len(actions) == len(transitions) == 3)
    cycle = False
    if len(transitions) == 3:
        a, b, c = transitions
        cycle = (a['tid'] == b['tid'] == c['tid'] and not a['noop'] and b['noop'] and not c['noop']
                 and a['after'] == b['before'] == b['after'] == c['before']
                 and a['before'] == c['after'])
    check('checkbox_changed_repeated_without_click_and_restored', cycle)
    check('no_mutations_between_checked_steps_or_after_restore', bool(actions) and all(
        c in actions for c in calls if c['tool'] in mutations and c['row'] >= actions[0]['row']))
    check('no_save_or_execution', all(c.get('arguments', {}).get('action_key') == 'node.add'
          for c in calls if c['tool'] == prefix + 'dock_action_run'))
    return {'schema_version': 1, 'kind': 'independent_checkbox_roundtrip_audit', 'assertions': checks,
            'all_assertions_passed': bool(checks) and all(c['passed'] for c in checks),
            'limitations': ['Proves one unsaved wizard checkbox only; no data import, apply, radio or reopen acceptance.']}


def prove(call, target, evidence):
    """Return the verified transition or None. Caller proves delivery and goal scope."""
    action = call.get('arguments', {}).get('action', {})
    desired = action.get('checked')
    before = target.get('check_state', {})
    if (action.get('verb') != 'set_checked' or type(desired) is not bool
            or action.get('ref') != target.get('ref')
            or 'set_checked' not in target.get('allowed_actions', [])
            or before.get('kind') not in ('checkbox', 'radio')
            or type(before.get('indeterminate')) is not bool
            or (type(before.get('checked')) is not bool and not (
                before.get('checked') is None and before.get('indeterminate') is True))
            or (before.get('kind') == 'radio' and not desired)
            or not target.get('tid') or not target.get('identity')):
        return None
    replies = [t for t in evidence.get('tools', [])
               if t.get('session_id') == call.get('session_id')
               and t.get('tool_call_id') == call.get('tool_call_id')
               and t.get('tool') == call.get('tool') and t.get('row', -1) > call['row']]
    if len(replies) != 1:
        return None
    result = replies[0].get('result', {})
    records = [e.get('outcome', {}) for e in evidence.get('events', [])
               if e.get('phase') == 'completed' and e.get('operation_id')
               and e.get('operation_id') == result.get('operation_id')]
    if (result.get('status') != 'SUCCEEDED' or result.get('cleanup_complete') is not True
            or len(records) != 1 or not journal_equal(records[0], result)):
        return None
    raw = records[0]
    matches = [e for e in raw.get('output', {}).get('ui', {}).get('elements', [])
               if e.get('identity') == target['identity'] and e.get('tid') == target['tid']
               and e.get('label') == target.get('label')]
    if len(matches) != 1:
        return None
    after = matches[0].get('check_state', {})
    if (after.get('kind') != before['kind'] or after.get('checked') is not desired
            or after.get('indeterminate') is not False):
        return None
    trace = raw.get('trace', [])
    noop = before.get('checked') is desired and before.get('indeterminate') is False
    if (raw.get('effect_possible') is not (not noop)
            or raw.get('output', {}).get('gesture_applied') is not (not noop)
            or not any(t.get('event') == 'ui_preconditions_verified'
                       and t.get('verb') == 'set_checked' and t.get('refs') == [action['ref']]
                       for t in trace)
            or not any(t.get('event') == 'ui_state_verified' and t.get('verb') == 'set_checked'
                       and t.get('checked') is desired
                       and t.get('ref') == matches[0].get('ref') for t in trace)
            or sum(t.get('event') == 'ui_gesture_applied' for t in trace) != (0 if noop else 1)
            or any(t.get('event') == 'ui_gesture_applied' and t.get('verb') != 'set_checked' for t in trace)
            or sum(t.get('event') == 'ui_state_already_satisfied' and t.get('checked') is desired
                   for t in trace) != (1 if noop else 0)):
        return None
    return {'tid': target['tid'], 'before': before, 'after': after, 'noop': noop}
