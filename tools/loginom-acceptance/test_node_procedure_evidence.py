import copy
import json
from pathlib import Path
import unittest
from node_procedure_evidence import verify_text_import_roundtrip

FIXTURE = Path(__file__).resolve().parents[2] / 'client/test/fixtures/node-import-journal.json'


class NodeProcedureEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads(FIXTURE.read_text())
        self.events = self.fixture['events']
        self.expected = self.fixture['expected']

    def verify(self):
        return verify_text_import_roundtrip(self.events, self.fixture['operation_id'], self.expected)

    def test_native_projection_passes_only_its_declared_local_obligations(self):
        result = self.verify()
        self.assertTrue(result['passed'], result)
        for key in ('journal_authentication_verified', 'hermes_acceptance_verified', 'package_persistence_verified', 'execution_verified'):
            self.assertFalse(result[key])

    def test_wrong_expected_source_schema_and_format_are_rejected(self):
        for section, name, value in [('source', 'source_path', '/user/wrong.csv'), ('format', 'decimal_separator', ',')]:
            with self.subTest(section=section):
                previous = self.expected[section][name]
                self.expected[section][name] = value
                self.assertFalse(self.verify()['passed'])
                self.expected[section][name] = previous
        self.expected['columns'][3]['type'] = 'integer'
        self.assertIn('column_values', self.verify()['failures'])

    def test_lost_completed_receipt_cannot_pass(self):
        row = next(r for r in self.events if r['phase'] == 'node_step_completed')
        self.events.remove(row)
        self.assertFalse(self.verify()['passed'])

    def test_same_looking_foreign_document_cannot_pass(self):
        row = next(r for r in self.events if r['phase'] == 'node_observation_completed')
        row['outcome']['output']['dom_epoch']['document'] = 'different'
        self.assertIn('document_context_mismatch', self.verify()['failures'])

    def test_a_success_summary_cannot_replace_reopen(self):
        self.events = [r for r in self.events if r.get('action', {}).get('verb') != 'open_wizard']
        self.events.append({'operation_id': self.fixture['operation_id'], 'settings_readback_verified': True})
        self.assertIn('save_open_save_sequence', self.verify()['failures'])

    def test_unfinished_cleanup_and_foreign_receipt_fail(self):
        row = next(r for r in self.events if r['phase'] == 'node_step_completed')
        row['outcome']['cleanup_complete'] = False
        row['outcome']['operation_id'] = 'another-operation'
        result = self.verify()
        self.assertIn('incomplete_mutation', result['failures'])
        self.assertIn('receipt_identity_mismatch', result['failures'])

    def test_duplicate_step_and_changed_session_fail(self):
        self.events.insert(1, copy.deepcopy(self.events[0]))
        self.events[-1]['session_id'] = 'other-session'
        result = self.verify()
        self.assertIn('sample_sequence', result['failures'])
        self.assertIn('journal_session_mismatch', result['failures'])

    def test_readiness_requires_four_satisfied_samples_before_mutation(self):
        for row in self.events:
            if row.get('phase') in ('node_observation_sample', 'node_observation_completed'):
                row['readiness'] = {'condition': 'explicit test condition', 'satisfied': True,
                                    'timeout_ms': 15000, 'elapsed_ms': 600}
        self.assertTrue(self.verify()['passed'])
        row = next(r for r in self.events if r.get('phase') == 'node_observation_sample')
        row['readiness']['satisfied'] = False
        self.assertIn('readiness_not_confirmed', self.verify()['failures'])

    def test_semantic_policy_requires_readiness_and_target_identity(self):
        for row in self.events:
            if row.get('phase') in ('node_observation_sample', 'node_observation_completed'):
                row['readiness'] = {'policy': 'semantic_condition_v2', 'required_samples': 2,
                    'condition': 'target incarnation', 'satisfied': True, 'identity_sha256': 'a'*64,
                    'timeout_ms': 15000, 'elapsed_ms': 600}
        self.assertTrue(self.verify()['passed'])
        last = next(r for r in self.events if r.get('phase') == 'node_observation_completed')
        last['readiness']['identity_sha256'] = 'b'*64
        self.assertIn('target_identity_not_stable', self.verify()['failures'])


if __name__ == '__main__':
    unittest.main()
