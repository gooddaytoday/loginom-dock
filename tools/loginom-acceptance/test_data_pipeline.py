import copy
import unittest
from pathlib import Path
import data_pipeline
from test_upload_verify import UploadVerifyTest
from audit import PREFIX, MUTATIONS, file_storage_inspect, rejected_before_browser


class DataPipelineTest(unittest.TestCase):
    def test_transfer_prefix_survives_later_pipeline_mutations_but_never_admits_domain(self):
        evidence,request=UploadVerifyTest().fixture()
        evidence['calls'].append({'session_id':'s','tool_call_id':'later','tool':PREFIX+'dock_ui_action','row':20,'arguments':{}})
        report=data_pipeline.audit(evidence,[],request,PREFIX,MUTATIONS,file_storage_inspect,rejected_before_browser)
        self.assertTrue(report['transfer_verified'],report)
        self.assertFalse(report['all_assertions_passed'])
        self.assertEqual(report['missing_domain_verifiers'],list(data_pipeline.DOMAIN_GATES))

    def test_mutation_before_resolved_inspection_does_not_prove_transfer(self):
        evidence,request=UploadVerifyTest().fixture()
        evidence['calls'].append({'session_id':'s','tool_call_id':'early','tool':PREFIX+'dock_ui_action','row':14,'arguments':{}})
        report=data_pipeline.audit(evidence,[],request,PREFIX,MUTATIONS,file_storage_inspect,rejected_before_browser)
        self.assertFalse(report['transfer_verified'])
        self.assertFalse(report['all_assertions_passed'])

    def test_repeated_upload_or_forged_domain_summary_never_passes(self):
        evidence,request=UploadVerifyTest().fixture()
        call=next(c for c in evidence['calls'] if c['tool']==PREFIX+'dock_artifact_upload')
        evidence['calls'].append({**copy.deepcopy(call),'row':20})
        evidence['domain_proof']={gate:True for gate in data_pipeline.DOMAIN_GATES}
        report=data_pipeline.audit(evidence,[],request,PREFIX,MUTATIONS,file_storage_inspect,rejected_before_browser)
        self.assertFalse(report['transfer_verified']);self.assertFalse(report['all_assertions_passed'])

    def test_prompt_embeds_full_pinned_task_and_explicit_destination(self):
        template=Path(data_pipeline.__file__).with_name('goals').joinpath('data-pipeline.txt').read_text()
        prompt=data_pipeline.prompt(template,'/analyst/packages/new.lgp','/analyst','20260905-120000-1234abcd')
        self.assertNotIn('__',prompt)
        for text in ('Quantity','UnitPrice','RowCount','null','повторно','/analyst/packages/new.lgp','Dock-upload-20260905-120000-1234abcd.csv'):
            self.assertIn(text,prompt)


    def test_proven_grant_refusal_allows_a_corrected_request_only_without_effects(self):
        for effect in (False,True):
            evidence,request=UploadVerifyTest().fixture()
            call={'session_id':'s','tool_call_id':'typo','tool':PREFIX+'dock_artifact_upload','row':1,
                  'arguments':{'operation_id':'rejected-upload'}}
            result={'status':'FAILED','action_key':'request.validate','phase':'request_rejected','operation_id':None,
                    'request_rejected':True,'effect_possible':effect,'trace':[],'error':{'code':'REQUEST_REJECTED'},
                    'output':{'operation':{'state':'idle','cleanup_confirmed':True,'effect_state':'none'}}}
            evidence['calls'].append(call);evidence['tools'].append({**call,'row':2,'result':result})
            report=data_pipeline.audit(evidence,[],request,PREFIX,MUTATIONS,file_storage_inspect,rejected_before_browser)
            self.assertEqual(report['pre_action_rejections'],0 if effect else 1)
            self.assertEqual(report['transfer_verified'],not effect)
            self.assertFalse(report['all_assertions_passed'])
