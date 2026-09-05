import copy
import unittest
import test_upload_probe as probe_test
import upload_verify
from audit import PREFIX,MUTATIONS,file_storage_inspect

class UploadVerifyTest(unittest.TestCase):
    def fixture(self):
        data,request=probe_test.UploadProbeTest().fixture()
        artifact=data['tools'][0]['result']['input_artifacts'][0]
        inspection=data['tools'][-1]['result']['output']
        inspection.update(cleanup_confirmed=True,effect_state='partial_or_unverified',next_steps=[])
        context={k:inspection[k] for k in ('operation_id','state','cleanup_confirmed','effect_state','recovery_options','next_steps')}
        original=inspection['outcome'];original.update(action_key='artifact.upload')
        # Keep fixture upload receipt and original inspection identical.
        data['tools'][-2]['result']['action_key']='artifact.upload';data['events'][-1]['outcome']['action_key']='artifact.upload'
        context['outcome_summary']={'status':'AMBIGUOUS','action_key':'artifact.upload','operation_id':'up','detail_tool':'dock_operation_inspect'}
        file={'ref':'ui-file','label':artifact['name'],'tid':'MF;TF-2;FileStorageForm;colName_'+artifact['name'],'allowed_actions':['double_click']}
        read={'status':'SUCCEEDED','operation_id':'file-read','output':{'observation_id':'file-obs','workflow_ref':{'prefix':'MF;TF-2'},'ui':{'elements':[file]},'operation':context}}
        raw=copy.deepcopy(read);raw['output'].pop('operation')
        data['tools'].append({'session_id':'s','tool_call_id':'file-read','tool':PREFIX+'dock_workspace_observe','row':11,'result':read})
        data['events'].append({'phase':'observation_completed','operation_id':'file-read','outcome':raw})
        args={'operation_id':'up','verification_id':'verify','observation_id':'file-obs','file_ref':'ui-file'}
        call={'session_id':'s','tool_call_id':'verify','tool':PREFIX+'dock_artifact_verify','row':12,'arguments':args}
        data['calls'].append(call)
        output={'artifact_id':'a','upload_grant_id':'g','upload_operation_id':'up','destination':artifact['upload']['destination'],
                'suggested_name':artifact['name'],'download_completed':True,'bytes_verification_required':True,'file_ref':'ui-file','observation_id':'file-obs'}
        native={'status':'SUCCEEDED','action_key':'artifact.download','action_revision':'1','operation_id':'verify',
                'phase':'downloaded','cleanup_complete':True,'effect_possible':True,'error':None,'output':output}
        result={**copy.deepcopy(native),'action_key':'artifact.verify','phase':'verified',
                'output':{**output,'bytes_verification_required':False,'bytes_verified':True,'bytes':230,'sha256':artifact['sha256'],'upload_completion_verified':True}}
        data['tools'].append({**call,'row':13,'result':result})
        data['events'].extend([{'phase':'download_completed','operation_id':'verify','outcome':native},
                              {'phase':'download_verified','operation_id':'verify','outcome':{**copy.deepcopy(result),'output':{**result['output'],'upload_completion_verified':False}},
                               'parameters':{'upload_operation_id':'up','observation_id':'file-obs','file_ref':'ui-file'},'checkpoint':{'artifact':artifact}}])
        after=copy.deepcopy(inspection)
        after['outcome']['output']['server_copy_verification']={'verification_id':'verify','status':'SUCCEEDED','bytes_verified':True,
            'upload_completion_verified':True,'destination':artifact['upload']['destination'],'bytes':230,'sha256':artifact['sha256']}
        after['state']='resolved'
        after['outcome'].update(status='SUCCEEDED',error=None,cleanup_complete=True)
        after['outcome']['output'].update(verification_required=False,transfer_postcondition='destination_bytes_digest_and_size')
        data['events'].extend([{'phase':'transfer_completed','operation_id':'up','outcome':copy.deepcopy(after['outcome'])},
                               {'phase':'verification_completed','operation_id':'verify','outcome':copy.deepcopy(result)}])
        data['tools'].append({'session_id':'s','tool_call_id':'after','tool':PREFIX+'dock_operation_inspect','row':15,'result':{'output':after}})
        return data,request

    def test_same_session_bound_byte_proof(self):
        data,request=self.fixture()
        report=upload_verify.audit(data,[],request,PREFIX,MUTATIONS,file_storage_inspect)
        self.assertTrue(report['all_assertions_passed'],report)

    def test_rejects_wrong_bytes_file_receipt_context_or_completion_claim(self):
        for change in [lambda d:d['tools'][-2]['result']['output'].update(sha256='0'*64),
                       lambda d:d['tools'][-3]['result']['output']['ui']['elements'][0].update(label='other.csv'),
                       lambda d:next(e for e in d['events'] if e['phase']=='download_completed')['outcome']['output'].update(destination='/other'),
                       lambda d:next(e for e in d['events'] if e['phase']=='download_verified')['checkpoint'].update(artifact={}),
                       lambda d:d['tools'][-3]['result']['output']['operation'].update(state='resolved'),
                       lambda d:d['tools'][-1]['result']['output'].update(state='pending'),
                       lambda d:d['calls'].append({**d['calls'][-1],'row':20,'tool_call_id':'repeat'})]:
            data,request=self.fixture();change(data)
            self.assertFalse(upload_verify.audit(data,[],request,PREFIX,MUTATIONS,file_storage_inspect)['all_assertions_passed'])
