import copy
import json
from pathlib import Path
import unittest

import import_settings_evidence as ise

EXPECTED = json.loads(Path(__file__).with_name('fixtures').joinpath('data-pipeline/expected.json').read_text())


def snapshot():
    prefix = 'MF;TF-1'
    path = [{'ref': str(i), 'tid': prefix + ';cnrNaviMode;b.s_' + '>'.join(['p', 'w', 'n', 's'][:i+1]),
             'label': name} for i, name in enumerate(('Package', 'Workflow', 'Import', 'Settings'))]
    values = {'delimiter': ';', 'text_qualifier': 'Двойная кавычка (")',
              'decimal_separator': 'Точка (.)', 'null_marker': '\\N'}
    return {'authenticated': True, 'origin': 'http://test', 'loginom_build': 'build',
            'workflow_ref': {'prefix': prefix}, 'package_identity': {'name': 'Package'},
            'active_tab_ref': 'tab', 'dom_epoch': {'document': 'doc', 'revision': 1},
            'ui': {'dialogs': [], 'masks': []},
            'wizard': {'status': 'observed', 'stage': 'text_import_format',
                       'root_tid': prefix + ';WizrdMCF', 'root_ref': 'wizard',
                       'owner_context': {'status': 'observed', 'node': copy.deepcopy(path[-2]), 'path': path},
                       'settings': {'status': 'draft_ui_values', 'applied_verified': False,
                                    'fields': {key: {'status': 'observed', 'value': value,
                                                     'value_length_utf16': len(value), 'truncated': False,
                                                     'value_kind': 'displayed_input_text',
                                                     'source_tid': prefix + ';WizrdMCF;ImportTextFileParamsWizard;' + ise.FIELD_OWNERS[key] + ';ValueControl',
                                                     'input_ref': key + '-input', 'owner_ref': key + '-owner'}
                                               for key, value in values.items()}},
                       'import_columns': {'status': 'rendered_draft_columns', 'complete': False,
                                          'settings_applied': False, 'truncated': False,
                                          'fields': [{'index': i, 'status': 'observed', 'used': True, **column}
                                                     for i, column in enumerate(EXPECTED['schema'])]}}}


class ImportSettingsEvidenceTests(unittest.TestCase):
    def test_fixture_match_stays_incomplete(self):
        state = snapshot(); report = ise.compare(state, EXPECTED)
        self.assertTrue(report['rendered_import_settings_match'])
        self.assertFalse(report['complete']); self.assertFalse(report['node_persistence_verified'])
        self.assertFalse(report['package_persistence_verified']); self.assertTrue(report['missing_proofs'])
        self.assertTrue(ise.compare(state, EXPECTED, report['context'])['rendered_import_settings_match'])
        state['wizard']['import_columns']['fields'].reverse()
        self.assertTrue(ise.compare(state, EXPECTED)['rendered_import_settings_match'])

    def test_context_binding(self):
        context = ise.compare(snapshot(), EXPECTED)['context']
        for key in ('origin', 'loginom_build', 'active_tab_ref', 'package_identity'):
            state = snapshot(); state[key] = 'foreign'
            self.assertEqual(ise.compare(state, EXPECTED, context)['reason'], 'context_changed')
        for mode in ('owner', 'path', 'root', 'stage', 'auth', 'document', 'editor', 'mask', 'dialog'):
            with self.subTest(mode=mode):
                state = snapshot(); wizard = state['wizard']
                if mode == 'owner': wizard['owner_context']['status'] = 'ambiguous'
                if mode == 'path': wizard['owner_context']['path'][-1]['tid'] = 'foreign'
                if mode == 'root': wizard['root_tid'] = 'MF;TF-2;WizrdMCF'
                if mode == 'stage': wizard['stage'] = 'output_mapping'
                if mode == 'auth': state['authenticated'] = False
                if mode == 'document': state['dom_epoch']['document'] = 'other'
                if mode == 'editor': wizard['import_column_editor'] = {'status': 'observed'}
                if mode == 'mask': state['ui']['masks'] = [{}]
                if mode == 'dialog': state['ui']['dialogs'] = [{}]
                self.assertFalse(ise.compare(state, EXPECTED, context)['rendered_import_settings_match'])

    def test_fields_exact_and_observed(self):
        for key in snapshot()['wizard']['settings']['fields']:
            for change in ({'value': '?'}, {'status': 'ambiguous'}, {'truncated': True},
                           {'value_length_utf16': 999}, {'input_ref': None}, {'value_kind': 'guessed'}, {'source_tid': 'foreign'}):
                with self.subTest(key=key, change=change):
                    state = snapshot(); state['wizard']['settings']['fields'][key].update(change)
                    self.assertFalse(ise.compare(state, EXPECTED)['rendered_import_settings_match'])
        state = snapshot(); state['wizard']['settings']['fields']['decimal_separator']['value'] = '.'
        state['wizard']['settings']['fields']['decimal_separator']['value_length_utf16'] = 1
        self.assertEqual(ise.compare(state, EXPECTED)['reason'], 'setting_mismatch:decimal_separator')
        state = snapshot(); fields = state['wizard']['settings']['fields']
        fields['decimal_separator']['input_ref'] = fields['delimiter']['input_ref']
        self.assertEqual(ise.compare(state, EXPECTED)['reason'], 'duplicate_setting_input')

    def test_only_exact_first_server_crumb_can_have_empty_label(self):
        state = snapshot(); owner = state['wizard']['owner_context']
        for crumb in owner['path']:
            crumb['tid'] = crumb['tid'].replace('b.s_p', 'b.s_Сервер')
        owner['node'] = copy.deepcopy(owner['path'][-2])
        owner['path'][0]['label'] = ''
        self.assertTrue(ise.compare(state, EXPECTED)['rendered_import_settings_match'])
        for index in range(1, len(owner['path'])):
            changed = copy.deepcopy(state)
            changed['wizard']['owner_context']['path'][index]['label'] = ''
            self.assertFalse(ise.compare(changed, EXPECTED)['rendered_import_settings_match'])
        for root_name in ('Другой', 'СерверX'):
            changed = copy.deepcopy(state); changed_owner = changed['wizard']['owner_context']
            for crumb in changed_owner['path']:
                crumb['tid'] = crumb['tid'].replace('b.s_Сервер', 'b.s_' + root_name)
            changed_owner['node'] = copy.deepcopy(changed_owner['path'][-2])
            self.assertEqual(ise.compare(changed, EXPECTED)['reason'], 'owner_path_mismatch')

    def test_delimiter_reopened_display_label_is_exact(self):
        for label, matches in (('Точка с запятой', True), ('Точка с запятой ', False),
                               ('точка с запятой', False), ('Semicolon', False)):
            state = snapshot(); field = state['wizard']['settings']['fields']['delimiter']
            field.update(value=label, value_length_utf16=len(label))
            self.assertEqual(ise.compare(state, EXPECTED)['rendered_import_settings_match'], matches)

    def test_columns_reject_incomplete_duplicate_and_wrong_schema(self):
        for mode in ('truncated', 'ambiguous', 'index', 'name', 'type', 'used', 'missing', 'extra', 'bool_index', 'complete'):
            with self.subTest(mode=mode):
                state = snapshot(); columns = state['wizard']['import_columns']; fields = columns['fields']
                if mode == 'truncated': columns['truncated'] = True
                if mode == 'ambiguous': fields[0]['status'] = 'unobserved_or_ambiguous'
                if mode == 'index': fields[1]['index'] = fields[0]['index']
                if mode == 'name': fields[1]['name'] = fields[0]['name']
                if mode == 'type': fields[0]['type'] = 'string'
                if mode == 'used': fields[0]['used'] = False
                if mode == 'missing': fields.pop()
                if mode == 'extra': fields.append(copy.deepcopy(fields[0]))
                if mode == 'bool_index': fields[0]['index'] = False
                if mode == 'complete': columns['complete'] = True
                self.assertFalse(ise.compare(state, EXPECTED)['rendered_import_settings_match'])

    def test_diagnose_only_unique_bound_receipts(self):
        result = {'status': 'SUCCEEDED', 'operation_id': 'op', 'output': snapshot()}
        call = {'session_id': 's', 'tool_call_id': 'c', 'tool': 'dock_workspace_observe', 'row': 1}
        evidence = {'calls': [call], 'tools': [{**call, 'row': 2, 'result': result}],
                    'events': [{'phase': 'observation_completed', 'operation_id': 'op', 'outcome': copy.deepcopy(result)}]}
        report = ise.diagnose(evidence, EXPECTED, '')
        self.assertEqual(report['observations'][0]['operation_id'], 'op')
        self.assertTrue(report['observations'][0]['rendered_import_settings_match']); self.assertFalse(report['complete'])
        for mode in ('reply', 'event', 'unbound', 'session', 'changed'):
            data = copy.deepcopy(evidence)
            if mode == 'reply': data['tools'] *= 2
            if mode == 'event': data['events'] *= 2
            if mode == 'unbound': data['events'] = []
            if mode == 'session': data['calls'][0]['session_id'] = 'other'
            if mode == 'changed': data['tools'][0]['result']['output']['wizard']['settings']['fields']['delimiter']['value'] = ','
            self.assertEqual(ise.diagnose(data, EXPECTED, '')['observations'], [], mode)

    def test_malformed_never_matches(self):
        for state in (None, {}, {'wizard': []}, snapshot()):
            if state and isinstance(state.get('wizard'), dict): state['wizard']['import_columns']['fields'] = None
            self.assertFalse(ise.compare(state, EXPECTED)['rendered_import_settings_match'])
