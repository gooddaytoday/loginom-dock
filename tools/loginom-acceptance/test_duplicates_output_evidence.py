import unittest
from duplicates_output_evidence import verify_duplicates_output


class DuplicatesOutputEvidenceTest(unittest.TestCase):
    def test_missing_journal_cannot_establish_output(self):
        self.assertFalse(verify_duplicates_output([], dict(operation_id='op'), [], [], [])['passed'])

    def test_projected_empty_success_needs_raw_execution_and_table_evidence(self):
        request = dict(operation_id='op', finish='execute', read=dict(ports=[0]))
        port = dict(port=0, sample_complete=True, row_count=0, sample=[], schema=[])
        result = dict(status='SUCCEEDED', output=dict(status='complete', ports=[port]))
        events = [dict(operation_id='op', phase='node_checkpoint', result=result)]
        self.assertFalse(verify_duplicates_output(events, request, [], [], [])['passed'])
        result['output']['status'] = 'partial'
        self.assertIn('duplicates_complete_execution_required', verify_duplicates_output(events, request, [], [], [])['failures'])


if __name__ == '__main__':
    unittest.main()
