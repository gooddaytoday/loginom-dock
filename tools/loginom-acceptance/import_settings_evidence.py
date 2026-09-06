"""Diagnostic comparison of rendered import settings, never persistence proof."""
import copy
import re
import settings_evidence

MISSING_PROOFS = ('source_artifact_binding', 'encoding_header_skip_readback',
                  'complete_source_schema', 'output_mapping', 'apply_reopen_readback',
                  'package_persistence')
# Exact display labels observed in the import UI; do not infer a locale or
# normalize unknown labels. Literal delimiter input is also supported.
DISPLAY_VALUES = {
    'delimiter': {';': ';', 'Точка с запятой': ';'},
    'text_qualifier': {'Двойная кавычка (")': '"'},
    'decimal_separator': {'Точка (.)': '.'},
}
FIELD_OWNERS = {'delimiter': 'edtDelimiterChar', 'text_qualifier': 'edtTextQualifier',
                'decimal_separator': 'edtDecimalSeparator', 'null_marker': 'edtValueNull'}


class Unverifiable(ValueError):
    pass


def _context(snapshot):
    if snapshot.get('authenticated') is not True:
        raise Unverifiable('unauthenticated')
    wizard = snapshot['wizard']
    if wizard.get('status') != 'observed' or wizard.get('stage') != 'text_import_format':
        raise Unverifiable('import_format_not_observed')
    prefix = snapshot['workflow_ref']['prefix']
    if not isinstance(prefix, str) or not re.fullmatch(r'MF;TF(?:-\d+)?', prefix):
        raise Unverifiable('workflow_context_missing')
    if wizard.get('root_tid') != prefix + ';WizrdMCF' or not wizard.get('root_ref'):
        raise Unverifiable('wizard_context_mismatch')
    owner = wizard['owner_context']
    path = owner.get('path', [])
    node = owner.get('node', {})
    if (owner.get('status') != 'observed' or not isinstance(path, list) or not 3 <= len(path) <= 32
            or not node.get('ref') or not node.get('label') or not node.get('tid')):
        raise Unverifiable('owner_context_missing')
    for index, item in enumerate(path):
        icon_only_root = (index == 0 and item.get('tid') == prefix + ';cnrNaviMode;b.s_Сервер'
                          and item.get('label') == '')
        if (not isinstance(item.get('tid'), str) or not item['tid'].startswith(prefix + ';')
                or not isinstance(item.get('label'), str) or (not item['label'] and not icon_only_root)
                or (index and not item['tid'].startswith(path[index - 1]['tid'] + '>'))):
            raise Unverifiable('owner_path_mismatch')
    if any(node.get(key) != path[-2].get(key) for key in ('ref', 'tid', 'label')):
        raise Unverifiable('owner_node_mismatch')
    context = {key: copy.deepcopy(snapshot.get(key)) for key in
               ('origin', 'loginom_build', 'workflow_ref', 'package_identity', 'active_tab_ref')}
    if any(not value for value in context.values()) or not snapshot.get('dom_epoch', {}).get('document'):
        raise Unverifiable('context_missing')
    context.update(document=snapshot['dom_epoch']['document'], wizard_root_ref=wizard['root_ref'],
                   owner=copy.deepcopy(owner))
    return context


def compare(snapshot, expected, expected_context=None):
    """Compare one native snapshot; optional context anchors it to a prior read.

    Callers must bind snapshots to immutable receipts. A match deliberately
    remains incomplete: rendered columns do not prove full source schema.
    """
    result = {'rendered_import_settings_match': False, 'complete': False,
              'node_persistence_verified': False, 'package_persistence_verified': False,
              'missing_proofs': list(MISSING_PROOFS)}
    try:
        context = _context(snapshot)
        if expected_context is not None and context != expected_context:
            raise Unverifiable('context_changed')
        wizard = snapshot['wizard']
        ui = snapshot['ui']
        if ui.get('dialogs') != [] or ui.get('masks') != []:
            raise Unverifiable('dialog_or_mask_present_or_unobserved')
        if 'import_column_editor' in wizard:
            raise Unverifiable('column_editor_present')
        settings = wizard['settings']
        if settings.get('status') != 'draft_ui_values' or settings.get('applied_verified') is not False:
            raise Unverifiable('draft_settings_unobserved')
        wanted = expected['input']
        keys = {'delimiter': 'delimiter', 'text_qualifier': 'quote',
                'decimal_separator': 'decimal_separator', 'null_marker': 'null_literal'}
        values = {}
        refs = set()
        for key, target in keys.items():
            field = settings['fields'][key]
            value = field.get('value')
            if (field.get('status') != 'observed' or field.get('truncated') is not False
                    or field.get('value_kind') != 'displayed_input_text' or not isinstance(value, str)
                    or len(value) > 256
                    or field.get('value_length_utf16') != len(value.encode('utf-16-le')) // 2
                    or not field.get('input_ref') or not field.get('owner_ref')):
                raise Unverifiable('setting_unobserved:' + key)
            if field.get('source_tid') != wizard['root_tid'] + ';ImportTextFileParamsWizard;' + FIELD_OWNERS[key] + ';ValueControl':
                raise Unverifiable('setting_owner_mismatch:' + key)
            if field['input_ref'] in refs:
                raise Unverifiable('duplicate_setting_input')
            refs.add(field['input_ref'])
            actual = value if key == 'null_marker' else DISPLAY_VALUES[key].get(value)
            if actual is None or actual != wanted[target]:
                raise Unverifiable('setting_mismatch:' + key)
            values[key] = actual
        columns = wizard['import_columns']
        if (columns.get('status') != 'rendered_draft_columns' or columns.get('truncated') is not False
                or columns.get('complete') is not False or columns.get('settings_applied') is not False):
            raise Unverifiable('rendered_columns_unobserved_or_truncated')
        fields, schema = columns['fields'], expected['schema']
        if not isinstance(fields, list) or not isinstance(schema, list) or not 1 <= len(fields) == len(schema) <= 8:
            raise Unverifiable('rendered_column_count_mismatch')
        indexes, names = set(), set()
        for column in fields:
            index, name = column.get('index'), column.get('name')
            if (column.get('status') != 'observed' or type(index) is not int
                    or not 0 <= index < len(schema) or index in indexes
                    or not isinstance(name, str) or name in names):
                raise Unverifiable('column_ambiguous_or_duplicate')
            indexes.add(index); names.add(name)
            if name != schema[index]['name'] or column.get('type') != schema[index]['type'] or column.get('used') is not True:
                raise Unverifiable('column_mismatch:' + str(index))
        if len({c['name'] for c in schema}) != len(schema):
            raise Unverifiable('expected_schema_ambiguous')
        return {**result, 'rendered_import_settings_match': True, 'reason': 'rendered_settings_match',
                'context': context, 'values': values, 'rendered_column_count': len(fields)}
    except (KeyError, TypeError, AttributeError, ValueError, UnicodeError) as error:
        return {**result, 'reason': str(error) if isinstance(error, Unverifiable) else 'malformed_evidence_or_fixture'}


def diagnose(evidence, expected, prefix):
    observations = []
    for receipt in settings_evidence.bound_receipts(evidence, prefix):
        snapshot = receipt['outcome'].get('output', {})
        if (not isinstance(snapshot, dict) or not isinstance(snapshot.get('wizard'), dict)
                or snapshot['wizard'].get('stage') != 'text_import_format'):
            continue
        observations.append({'session_id': receipt['call'].get('session_id'),
                             'tool_call_id': receipt['call'].get('tool_call_id'),
                             'operation_id': receipt['outcome']['operation_id'],
                             **compare(snapshot, expected)})
        if len(observations) >= 60:
            return {'observations': observations, 'truncated': True, 'complete': False}
    return {'observations': observations, 'truncated': False, 'complete': False}
