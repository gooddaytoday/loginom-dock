import copy
import unittest
from prepare_binding import successful_prepare
from audit import PREFIX

class PreparationV1Test(unittest.TestCase):
    def fixture(self):
        state={'status':'READY','reason':None,'authenticated':True,'created_draft':True,
               'ownership_verified':True,'target_verified':True,'session_id':'dock','operation_id':'prepare','document_id':'doc',
               'workflow_ref':{'tab_tid':'tab','prefix':'prefix','navigation_path':[{'tid':'path','label':'Workflow'}]},
               'package_ref':{'path':None,'persisted':False},'preserved_workflows':[{'tab_tid':'old','graph_unchanged':True}]}
        result={'prepared':True,'sessionId':'dock','workspace':state}
        common={'tool':PREFIX+'dock_prepare','session_id':'agent','tool_call_id':'one'}
        return {'calls':[{**common,'arguments':{},'row':1}],'tools':[{**common,'result':result,'row':2}],
                'events':[{'event':'workspace_prepared','session_id':'dock','state':copy.deepcopy(state)}]}

    def test_same_operation_repeat_is_verified_and_foreign_or_changed_state_is_rejected(self):
        data=self.fixture();self.assertIsNotNone(successful_prepare(data,PREFIX,'agent',10))
        call=copy.deepcopy(data['calls'][0]);call.update(tool_call_id='two',row=3)
        reply=copy.deepcopy(data['tools'][0]);reply.update(tool_call_id='two',row=4);reply['result']['workspace']['replayed']=True
        event=copy.deepcopy(data['events'][0]);event['state']['replayed']=True
        data['calls'].append(call);data['tools'].append(reply);data['events'].append(event)
        self.assertIsNotNone(successful_prepare(data,PREFIX,'agent',10))
        for key,value in [('document_id','different'),('ownership_verified',False),('created_draft',False)]:
            changed=copy.deepcopy(data);changed['tools'][-1]['result']['workspace'][key]=value
            changed['events'][-1]['state'][key]=value
            self.assertIsNone(successful_prepare(changed,PREFIX,'agent',10))
        data['events'][-1]['state']['preserved_workflows'][0]['graph_unchanged']=False
        self.assertIsNone(successful_prepare(data,PREFIX,'agent',10))
