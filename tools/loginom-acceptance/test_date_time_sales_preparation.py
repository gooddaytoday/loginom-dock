"""Model-free business, coverage and fail-closed preparation regressions."""
import copy
import json
import tempfile
import unittest
import argparse
from pathlib import Path
from unittest.mock import patch
from date_time_goal_oracle import FIXTURES, OPS, expected, frozen, projection, source_rows, render
from date_time_goal_evidence import full_port, graph, save_checkpoint
from date_time_admission import check, GATES
from date_time_sales_acceptance import audit


class DateTimeSalesPreparation(unittest.TestCase):
    def test_frozen_full_twelve_rows_and_both_dates(self):
        data = frozen()
        self.assertEqual(data, expected((FIXTURES/'sales.csv').read_bytes()))
        self.assertEqual((len(data['calendar']['rows']), len(data['calendar']['schema'])), (12, 27))
        self.assertEqual(data['empty']['rows'], [])
        self.assertEqual(data['empty']['schema'], data['calendar']['schema'])
        self.assertEqual({(f['input'], f['operation']) for f in projection() if 'operation' in f},
                         {(source, op) for source in ('DateA', 'DateB') for op in OPS})

    def test_business_totals_independently_enumerated(self):
        value = frozen()
        self.assertEqual(value['month']['rows'], [[None, None, 42], [2023, 12, 10], [2024, 1, 50],
            [2024, 2, 75], [2024, 3, 70], [2024, 4, 110], [2024, 12, 90], [2025, 1, 100]])
        self.assertEqual(value['quarter']['rows'], [[None, None, 42], [2023, 4, 10],
            [2024, 1, 195], [2024, 2, 110], [2024, 4, 90], [2025, 1, 100]])
        self.assertEqual(sum(r[-1] for r in value['month']['rows']), 547)

    def test_boundary_values_and_asymmetric_nulls(self):
        value = frozen()['calendar']; names = [f['name'] for f in value['schema']]
        rows = [dict(zip(names, r)) for r in value['rows']]
        self.assertEqual(rows[1]['A_month_end'], '2024-02-29T00:00:00.000')
        self.assertEqual(rows[0]['B_year_end'], '2024-12-31T00:00:00.000')
        self.assertEqual(rows[2]['A_quarter_start'], '2024-04-01T00:00:00.000')
        self.assertEqual(rows[2]['B_quarter_end'], '2024-03-31T00:00:00.000')
        self.assertIsNone(rows[10]['B_year']); self.assertEqual(rows[10]['SavedYearA'], 2024)
        self.assertIsNone(rows[11]['SavedYearA']); self.assertEqual(rows[11]['B_quarter'], 2)

    def test_names_labels_exclusion_and_order_are_frozen(self):
        value = frozen()
        self.assertEqual([f['name'] for f in value['calendar']['schema']][:3], ['RowId', 'SalesAmount', 'A_date'])
        self.assertEqual(value['calendar']['schema'][13], dict(name='SavedYearA', label='Год сохранённой даты A', type='integer'))
        self.assertEqual(value['excluded'], [dict(name='DateB', label='DateB', type='datetime', excluded=True)])
        self.assertEqual(value['initial']['schema'][13]['name'], 'A_year')

    def test_source_rejects_duplicate_ids_or_missing_cells(self):
        data = (FIXTURES/'sales.csv').read_bytes()
        for changed in (data.replace(b'12;NULL', b'11;NULL'), data.replace(b'12;NULL;2024-06-30 23:59:59;2', b'12;NULL')):
            with self.assertRaises(ValueError):
                source_rows(changed)

    def test_complete_read_is_total_returned_not_magic_ten(self):
        table = frozen()['calendar']
        port = dict(row_count=12, sample_rows=12, sample_complete=True, schema=table['schema'], sample=table['rows'])
        self.assertTrue(full_port(port, table))
        for change in ({'sample_rows': 10}, {'sample': table['rows'][:10]}, {'truncated': True}, {'row_count': 13}, {'sample_complete': False}):
            self.assertFalse(full_port(dict(port, **change), table))
        self.assertTrue(full_port(dict(row_count=0, sample_rows=0, sample_complete=True, sample=[], schema=table['schema']), frozen()['empty']))
        changed = copy.deepcopy(port); changed['schema'][0]['label'] = 'wrong'
        self.assertFalse(full_port(changed, table))

    def test_natural_prompt_has_no_api_recipe_or_hidden_reopen(self):
        text = render('20260913-120000-1234abcd')
        self.assertNotIn('__', text)
        for token in ('node.apply', 'sample_rows', 'package.save_as', 'package.save_checkpoint', 'operation_id', 'fault injection'):
            self.assertNotIn(token, text)
        self.assertIn('Повторное открытие сохранённого пакета выполнит отдельная независимая диагностика', text)

    def test_absent_admission_and_fake_passes_refuse_without_launch(self):
        with tempfile.TemporaryDirectory() as tmp:
            for value in ({}, {'gates': {g: {'status': 'passed', 'path': 'missing', 'sha256': '0'*64} for g in GATES}}):
                r = check(value, Path(tmp))
                self.assertFalse(r['passed']); self.assertFalse(r['model_started'])
                self.assertTrue(set(GATES) <= set(r['checks']))
                self.assertTrue(all(not r['checks'][g]['passed'] for g in GATES))

    def test_full_auditor_does_not_accept_summary_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = audit({}, {'events': [], 'calls': [], 'tools': [], 'summary': 'All passed'}, '', {}, Path(tmp), {}, Path(tmp))
            self.assertFalse(r['passed']); self.assertFalse(r['node_admitted'])
            self.assertFalse(r['checks']['all_required_components']['passed'])

    def test_graph_has_exact_six_nodes_five_connections(self):
        value = graph()
        self.assertEqual(len(value['nodes']), 6); self.assertEqual(len(value['links']), 5)
        self.assertIn('Нет_продаж|Output_Data[0]|Пустой_календарь|Input_Data[0]', value['links'])
        self.assertNotIn('Нет_продаж|Output_Data[1]|Пустой_календарь|Input_Data[0]', value['links'])

    def test_no_save_or_extra_save_is_rejected(self):
        with self.assertRaises(ValueError):
            save_checkpoint([], [], '/test-3/new.lgp', '2')
        events = [dict(phase='prepared', action_key='package.save_as')]*2
        with self.assertRaises(ValueError):
            save_checkpoint(events, [], '/test-3/new.lgp', '2')

    def test_runner_gate_precedes_auth_or_runtime_setup(self):
        import run
        args = argparse.Namespace(goal='date-time-sales', date_time_admission=FIXTURES/'admission.pending.json')
        with patch('run.connection') as auth, patch('run.validate_inputs') as validate:
            with self.assertRaises(ValueError):
                run.execute(args)
            auth.assert_not_called(); validate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
