import tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from run import validate_inputs
from text_export_acceptance import audit_directory
from text_export_readiness import REJECT_BASELINE_BLOCKER

class RejectBaselineReadinessTests(unittest.TestCase):
    def test_run_is_refused_before_credentials_runtime_or_model(self):
        with self.assertRaisesRegex(ValueError,REJECT_BASELINE_BLOCKER):
            validate_inputs(SimpleNamespace(goal='text-export-node-complete',run=True))

    def test_auditor_cannot_pass_or_trust_a_claimed_read_receipt(self):
        # No receipt shape is admitted while a real reader is unavailable.
        # This checks fail-closed readiness, not semantic verification of reads.
        with tempfile.TemporaryDirectory() as d, patch.object(Path,'read_text',side_effect=AssertionError('Must not inspect unadmitted evidence')):
            result=audit_directory(Path(d),Path(d))
        self.assertFalse(result['passed'])
        self.assertIn(REJECT_BASELINE_BLOCKER,result['checks']['incomplete_or_invalid']['reason'])

if __name__=='__main__':unittest.main()
