"""Hermetic subscription selection; no real credentials or network."""
import base64
import json
from pathlib import Path
import tempfile
import time
import unittest
import audit
import run
from test_acceptance import fixture

class SubscriptionTest(unittest.TestCase):
    def test_only_approved_provider_is_copied_and_expiry_is_required(self):
        with tempfile.TemporaryDirectory() as root:
            home=Path(root)
            payload=base64.urlsafe_b64encode(json.dumps({'exp':time.time()+5000}).encode()).decode().rstrip('=')
            state={'providers':{'openai-codex':{'auth_mode':'chatgpt','tokens':{'access_token':'fixture.'+payload+'.signature','refresh_token':'fixture-refresh'}},'other':{'secret':'excluded'}},'credential_pool':{'other':['excluded']}}
            (home/'auth.json').write_text(json.dumps(state))
            copied=run.connection(home)
            self.assertEqual(list(copied['providers']),['openai-codex'])
            self.assertNotIn('excluded',json.dumps(copied))
            state['providers']['openai-codex']['tokens']['access_token']='bad'
            (home/'auth.json').write_text(json.dumps(state))
            with self.assertRaises(ValueError):run.connection(home)
    def test_missing_connection_never_uses_env_or_personal_codex(self):
        with tempfile.TemporaryDirectory() as root:
            home=Path(root);(home/'auth.json').write_text('{}')
            with self.assertRaises(ValueError):run.connection(home)
    def test_auditor_rejects_wrong_provider_model_or_reasoning(self):
        for key,value in [('provider','xiaomi'),('model','mimo-v2.5')]:
            request,evidence,prompt=fixture();evidence['process']['usage'][key]=value
            self.assertFalse(audit.audit(request,evidence,prompt)['all_assertions_passed'])
        request,evidence,prompt=fixture();request['reasoning_effort']='high'
        self.assertFalse(audit.audit(request,evidence,prompt)['all_assertions_passed'])

if __name__=='__main__':unittest.main()
