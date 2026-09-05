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
                     'status':'observed','directory':'/user/data','source':'visible_breadcrumbs',
                     'navigation_identity':{'anchor_tid':'nav'},'listing_complete':False}}}}
        data={'calls':[call,{'session_id':'s','tool_call_id':'read','tool':PREFIX+'dock_workspace_observe','row':4,'arguments':{'scope':'all'}}],'tools':[initial,action,observe],'events':[
            {'phase':'completed','operation_id':t['result']['operation_id'],'outcome':copy.deepcopy(t['result'])}
            for t in (action,observe)]}
        return data

    def test_bound_navigation_and_directory(self):
        self.assertTrue(file_storage_inspect(self.fixture(),[])['all_assertions_passed'])

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
            self.assertFalse(file_storage_inspect(data,[])['all_assertions_passed'])
