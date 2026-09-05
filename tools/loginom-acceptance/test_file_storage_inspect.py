import copy
import unittest
from audit import file_storage_inspect, PREFIX

class FileStorageInspectTest(unittest.TestCase):
    def fixture(self):
        target={'ref':'r','tid':'MF;cntMain;tlbMainToolbar;btnFilestorage'}
        initial={'session_id':'s','tool_call_id':'initial','tool':PREFIX+'dock_workspace_observe','row':1,
                 'result':{'status':'SUCCEEDED','output':{'observation_id':'o','ui':{'elements':[target]}}}}
        call={'session_id':'s','tool_call_id':'click','tool':PREFIX+'dock_ui_action','row':2,
              'arguments':{'observation_id':'o','action':{'verb':'click','ref':'r'}}}
        action={'session_id':'s','tool_call_id':'click','tool':call['tool'],'row':3,
                'result':{'status':'SUCCEEDED','operation_id':'click-op','output':{}}}
        observe={'session_id':'s','tool_call_id':'read','tool':PREFIX+'dock_workspace_observe','row':5,
                 'result':{'status':'SUCCEEDED','operation_id':'read-op','output':{'file_storage':{
                     'status':'observed','directory':'/analyst/data','source':'visible_breadcrumbs',
                     'navigation_identity':{'anchor_tid':'nav'},'listing_complete':False}}}}
        data={'calls':[call,{'session_id':'s','tool_call_id':'read','tool':PREFIX+'dock_workspace_observe','row':4,'arguments':{'scope':'all'}}],'tools':[initial,action,observe],'events':[
            {'phase':'completed','operation_id':t['result']['operation_id'],'outcome':copy.deepcopy(t['result'])}
            for t in (action,observe)]}
        data['events'][-1]['phase']='observation_completed'
        observe['result']['output']['operation']={'operation_id':None,'state':'idle','cleanup_confirmed':True,'effect_state':'none',
            'recovery_options':[],'next_steps':[{'tool':'dock_workspace_observe','arguments':{},'required_fields':[],
            'requires':[],'provides':['observation_id','fresh_ui_refs']}],'outcome_summary':None}
        return data

    def test_bound_navigation_and_directory(self):
        self.assertTrue(file_storage_inspect(self.fixture(),[],'/analyst/data')['all_assertions_passed'])

    def test_rejects_wrong_directory_unbound_results_and_file_mutations(self):
        mutations=[
            lambda d:d['tools'][-1]['result']['output']['file_storage'].update(directory='/user/other'),
            lambda d:d['tools'][-1]['result']['output']['file_storage'].update(listing_complete=True),
            lambda d:d['events'].pop(),
            lambda d:d['tools'][0]['result']['output']['ui']['elements'][0].update(tid='FileStorage;btnDelete'),
            lambda d:d['calls'][0]['arguments']['action'].update(verb='fill'),
            lambda d:d['calls'].append({**d['calls'][0],'row':6}),
            lambda d:d['tools'][-1].update(session_id='other'),
        ]
        for mutate in mutations:
            data=self.fixture();mutate(data)
            self.assertFalse(file_storage_inspect(data,[],'/analyst/data')['all_assertions_passed'])

    def test_epoch_refusal_requires_bound_no_effect_receipt(self):
        data=self.fixture();r=data['tools'][1]['result']
        r.update(status='NOT_APPLIED',phase='preconditions',effect_possible=False,cleanup_complete=True,
                 error={'code':'UI_EPOCH_CHANGED'},trace=[{'event':'ui_action_failed','code':'UI_EPOCH_CHANGED'}])
        data['events'][0]['outcome']=copy.deepcopy(r)
        self.assertTrue(file_storage_inspect(data,[],'/analyst/data')['all_assertions_passed'])
        for key,value in [('effect_possible',True),('cleanup_complete',False),('phase','gesture')]:
            changed=copy.deepcopy(data);changed['tools'][1]['result'][key]=value
            changed['events'][0]['outcome']=copy.deepcopy(changed['tools'][1]['result'])
            self.assertFalse(file_storage_inspect(changed,[],'/analyst/data')['all_assertions_passed'])
