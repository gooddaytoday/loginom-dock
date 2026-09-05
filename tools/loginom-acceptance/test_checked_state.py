import copy
import unittest

from checked_state import prove, audit_goal, TARGET_SUFFIX


class CheckedStateProofTest(unittest.TestCase):
    def fixture(self, noop=False):
        target = {'ref': 'r1', 'tid': 'Wizard;Checkbox;DisplayEl', 'identity': {'id': 1},
                  'label': 'Parallel processing', 'allowed_actions': ['set_checked'],
                  'check_state': {'kind': 'checkbox', 'checked': noop, 'indeterminate': False}}
        call = {'session_id': 's1', 'tool_call_id': 'c1', 'tool': 'dock_ui_action', 'row': 2,
                'arguments': {'action': {'verb': 'set_checked', 'ref': 'r1', 'checked': True}}}
        after = copy.deepcopy(target)
        after['check_state']['checked'] = True
        trace = [{'event': 'ui_preconditions_verified', 'verb': 'set_checked', 'refs': ['r1']},
                 {'event': 'ui_state_verified', 'verb': 'set_checked', 'ref': 'r1', 'checked': True}]
        trace.append({'event': 'ui_state_already_satisfied' if noop else 'ui_gesture_applied',
                      'verb': 'set_checked', 'checked': True})
        result = {'status': 'SUCCEEDED', 'operation_id': 'op1', 'cleanup_complete': True,
                  'effect_possible': not noop, 'trace': trace,
                  'output': {'gesture_applied': not noop, 'ui': {'elements': [after]}}}
        evidence = {'tools': [{**call, 'row': 3, 'result': result}],
                    'events': [{'phase': 'completed', 'operation_id': 'op1',
                                'outcome': copy.deepcopy(result)}]}
        return call, target, evidence

    def test_transition_and_noop(self):
        for noop in (False, True):
            self.assertEqual(prove(*self.fixture(noop))['noop'], noop)

    def roundtrip(self):
        evidence = {'calls': [], 'tools': [], 'events': []}
        for i, noop in enumerate((False, True, False)):
            call, target, part = self.fixture(noop)
            call.update(row=i*4+2, tool_call_id=f'c{i}')
            call['arguments']['observation_id'] = f'o{i}'
            target['tid'] = 'MF;TF;' + TARGET_SUFFIX
            reply = part['tools'][0]
            reply.update(row=i*4+3, tool_call_id=f'c{i}')
            result = reply['result']
            result['operation_id'] = f'op{i}'
            result['output']['ui']['elements'][0]['tid'] = target['tid']
            if i == 2:
                target['check_state']['checked'] = True
                call['arguments']['action']['checked'] = False
                result['output']['ui']['elements'][0]['check_state']['checked'] = False
                for event in result['trace']:
                    if 'checked' in event: event['checked'] = False
            target['check_state']['source'] = 'loginom_ext'
            result['output']['ui']['elements'][0]['check_state']['source'] = 'loginom_ext'
            evidence['calls'].append(call)
            evidence['tools'].extend([{'row':i*4+1, 'result':{'output':{
                'observation_id':f'o{i}', 'ui':{'elements':[target]}}}}, reply])
            evidence['events'].append({'phase':'completed', 'operation_id':f'op{i}', 'outcome':copy.deepcopy(result)})
        return evidence

    def test_goal_roundtrip_and_stale_or_unrelated_target(self):
        data = self.roundtrip()
        self.assertTrue(audit_goal(data, [], '', {'dock_ui_action'})['all_assertions_passed'])
        for mutate in (
            lambda d: d['calls'][1]['arguments'].update(observation_id='o0'),
            lambda d: d['tools'][2]['result']['output']['ui']['elements'][0].update(tid='unrelated'),
            lambda d: d['calls'].append({'tool':'dock_ui_action', 'row':99, 'arguments':{'action':{'verb':'click'}}}),
        ):
            data = self.roundtrip()
            mutate(data)
            self.assertFalse(audit_goal(data, [], '', {'dock_ui_action'})['all_assertions_passed'])

    def test_tampered_evidence(self):
        for mutate in (
            lambda c, t, e: e['events'].clear(),
            lambda c, t, e: e['tools'][0]['result']['output']['ui']['elements'][0]['check_state'].update(checked=False),
            lambda c, t, e: e['tools'][0].update(session_id='other'),
            lambda c, t, e: c['arguments']['action'].update(checked=1),
            lambda c, t, e: t.update(identity={'id': 2}),
            lambda c, t, e: t['check_state'].update(checked=True),
        ):
            args = self.fixture()
            mutate(*args)
            self.assertIsNone(prove(*args))

    def test_forged_noop_and_wrong_readback_fail_even_with_matching_journal(self):
        for field, value in (('effect_possible', True), ('cleanup_complete', False)):
            call, target, evidence = self.fixture(True)
            evidence['tools'][0]['result'][field] = value
            evidence['events'][0]['outcome'][field] = value
            self.assertIsNone(prove(call, target, evidence))
        call, target, evidence = self.fixture()
        for result in (evidence['tools'][0]['result'], evidence['events'][0]['outcome']):
            result['output']['ui']['elements'][0]['check_state']['checked'] = False
        self.assertIsNone(prove(call, target, evidence))


if __name__ == '__main__':
    unittest.main()
