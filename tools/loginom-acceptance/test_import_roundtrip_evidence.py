import copy
import unittest
import import_roundtrip_evidence as ir
from test_import_settings_evidence import EXPECTED, snapshot, source_snapshot, mapping_snapshot

PATH = '/test/source.csv'


def fixture(selection=True):
    source = source_snapshot(); form = snapshot(); mapping = mapping_snapshot()
    done = copy.deepcopy(mapping); done['wizard']['stage'] = 'done'
    owner = source['wizard']['owner_context']; node = owner['node']['label']
    graph = copy.deepcopy(source); graph['wizard'] = {'status': 'absent'}
    graph['navigation_context'] = {'status': 'observed', 'path': [{k:p[k] for k in ('tid','label')} for p in owner['path'][:-2]]}
    body = {'ref':'body', 'graph_node':{'node_label':node,'part':'body'}, 'allowed_actions':['click']}
    settings = {'ref':'settings', 'graph_node':{'node_label':node,'part':'settings'}, 'allowed_actions':['open_wizard']}
    graph['ui']['elements'] = [body] if selection else [body, settings]
    selected = copy.deepcopy(graph); selected['ui']['elements'] = [body, settings]
    reopened = source_snapshot()
    for field in reopened['wizard']['import_source']['fields'].values():
        if 'input_ref' in field: field['input_ref'] += '-new'
    for state in (source, form, mapping, reopened):
        state['ui']['elements'] = [{'ref':'next', 'allowed_actions':['wizard_step']}]
    done['ui']['elements'] = [{'ref':'finish', 'allowed_actions':['finish_wizard']}]
    evidence = {'calls':[], 'tools':[], 'events':[]}
    def emit(state, verb=None, ref=None):
        n = len(evidence['calls']); tool = 'dock_ui_action' if verb else 'dock_workspace_observe'
        call = {'session_id':'s', 'tool_call_id':str(n), 'tool':tool, 'row':n*2+1, 'arguments':{}}
        if verb: call['arguments'] = {'observation_id':'obs'+str(n-1), 'action':{'verb':verb,'ref':ref}}
        if verb == 'wizard_step': call['arguments']['action']['expected_stage'] = state['wizard']['stage']
        outcome = {'status':'SUCCEEDED', 'operation_id':'op'+str(n), 'cleanup_complete':True,
                   'output':copy.deepcopy(state)}
        outcome['output']['observation_id'] = 'obs'+str(n)
        if verb: outcome['trace'] = [{'event':'ui_preconditions_verified','refs':[ref],'verb':verb},
                                     {'event':'ui_gesture_applied','verb':verb}]
        if verb == 'wizard_step':
            outcome['trace'].append({'event':'wizard_step_verified',
                                     'from_stage':evidence['tools'][-1]['result']['output']['wizard']['stage'],
                                     'to_stage':state['wizard']['stage'], 'root_ref':state['wizard']['root_ref'],
                                     'settings_applied':False})
        if verb == 'finish_wizard':
            outcome['trace'].append({'event':'wizard_finish_graph_verified', 'previous_owner':copy.deepcopy(owner['node']),
                                     'node':body['graph_node'], 'node_ref':'body', 'reopen_required':True,
                                     'settings_readback_verified':False, 'package_saved':False})
        if verb == 'open_wizard':
            outcome['trace'].append({'event':'wizard_open_verified','node':settings['graph_node'],
                                     'workflow_path':graph['navigation_context']['path'],
                                     'wizard_root_ref':state['wizard']['root_ref'],
                                     'owner_node':copy.deepcopy(state['wizard']['owner_context']['node']), 'settings_applied':False})
        evidence['calls'].append(call); evidence['tools'].append({**call,'row':n*2+2,'result':outcome})
        evidence['events'].append({'phase':'completed' if verb else 'observation_completed',
                                   'operation_id':outcome['operation_id'],'outcome':copy.deepcopy(outcome)})
    emit(source); emit(form,'wizard_step','next'); emit(mapping,'wizard_step','next')
    emit(done,'wizard_step','next'); emit(graph,'finish_wizard','finish')
    if selection: emit(selected,'click','body')
    emit(reopened,'open_wizard','settings'); emit(form,'wizard_step','next'); emit(mapping,'wizard_step','next')
    return evidence


class ImportRoundtripTests(unittest.TestCase):
    def diagnose(self, evidence):
        return ir.diagnose(evidence, EXPECTED, '', expected_source_path=PATH)['roundtrips']

    def test_complete_rendered_sequence_with_optional_selection(self):
        for selection in (False, True):
            proofs = self.diagnose(fixture(selection))
            self.assertEqual(len(proofs), 1)
            self.assertTrue(proofs[0]['rendered_import_settings_roundtrip_match'])
            self.assertFalse(proofs[0]['complete']); self.assertFalse(proofs[0]['package_persistence_verified'])

    def test_missing_duplicate_and_unbound_fail(self):
        for mode in ('missing_call', 'missing_reply', 'missing_event', 'duplicate_call', 'duplicate_reply',
                     'duplicate_event', 'changed_journal', 'unissued', 'missing_trace', 'duplicate_trace'):
            with self.subTest(mode=mode):
                data = fixture()
                if mode == 'missing_call': data['calls'].pop(2)
                if mode == 'missing_reply': data['tools'].pop(2)
                if mode == 'missing_event': data['events'].pop(2)
                if mode == 'duplicate_call': data['calls'].append(copy.deepcopy(data['calls'][2]))
                if mode == 'duplicate_reply': data['tools'].append(copy.deepcopy(data['tools'][2]))
                if mode == 'duplicate_event': data['events'].append(copy.deepcopy(data['events'][2]))
                if mode == 'changed_journal': data['events'][2]['outcome']['status'] = 'FAILED'
                if mode == 'unissued': data['calls'][4]['arguments']['observation_id'] = 'foreign'
                if mode in ('missing_trace', 'duplicate_trace'):
                    for outcome in (data['tools'][4]['result'], data['events'][4]['outcome']):
                        if mode == 'missing_trace': outcome['trace'] = []
                        else: outcome['trace'] *= 2
                self.assertEqual(self.diagnose(data), [])

    def test_wrong_context_stale_instance_and_generic_navigation_fail(self):
        for mode in ('stale', 'foreign_owner', 'package', 'document', 'graph_path', 'wrong_body',
                     'wrong_open', 'generic_next', 'missing_source', 'bad_mapping'):
            with self.subTest(mode=mode):
                data = fixture()
                index = 6
                if mode in ('graph_path', 'wrong_body'): index = 4
                if mode == 'generic_next': index = 1
                for outcome in (data['tools'][index]['result'], data['events'][index]['outcome']):
                    state = outcome['output']
                    if mode == 'stale': state['wizard']['import_source']['fields']['source_path']['input_ref'] = 'source_path'
                    if mode == 'foreign_owner': state['wizard']['owner_context']['node']['label'] = 'Other'
                    if mode == 'package': state['package_identity'] = {'name':'Other'}
                    if mode == 'document': state['dom_epoch']['document'] = 'Other'
                    if mode == 'graph_path': state['navigation_context']['path'] = []
                    if mode == 'wrong_body': state['ui']['elements'][0]['graph_node']['node_label'] = 'Other'
                    if mode == 'missing_source': state['wizard'].pop('import_source')
                    if mode == 'bad_mapping': state['wizard']['stage'] = 'output_mapping'
                    if mode == 'generic_next':
                        for t in outcome['trace']: t['verb'] = 'click'
                if mode == 'generic_next': data['calls'][1]['arguments']['action']['verb'] = 'click'
                if mode == 'wrong_open': data['calls'][6]['arguments']['action']['ref'] = 'body'
                self.assertEqual(self.diagnose(data), [])

    def test_unaccounted_mutations_including_overlap_and_foreign_session_fail(self):
        for row, session in ((8, 's'), (9, 's'), (10, 'other'), (17, 'other')):
            data = fixture(); data['calls'].append({'row':row,'session_id':session,'tool_call_id':'extra','tool':'dock_action_run'})
            self.assertEqual(self.diagnose(data), [])

    def test_missing_path_and_detached_snapshots_do_not_prove_roundtrip(self):
        self.assertEqual(ir.diagnose(fixture(), EXPECTED, '')['roundtrips'], [])
        self.assertEqual(self.diagnose({'calls':[],'tools':[],'events':[]}), [])

    def test_typed_transition_proof_required(self):
        for index in (1, 4, 6):
            for mode in ('missing', 'duplicate', 'wrong'):
                data = fixture()
                for outcome in (data['tools'][index]['result'], data['events'][index]['outcome']):
                    if mode == 'missing': outcome['trace'].pop()
                    elif mode == 'duplicate': outcome['trace'].append(copy.deepcopy(outcome['trace'][-1]))
                    elif index == 1: outcome['trace'][-1]['root_ref'] = 'wrong'
                    elif index == 4: outcome['trace'][-1]['node_ref'] = 'wrong'
                    else: outcome['trace'][-1]['workflow_path'] = []
                self.assertEqual(self.diagnose(data), [], (index, mode))
