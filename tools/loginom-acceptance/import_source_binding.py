"""Independently order full new-import settings by the original file schema."""
import csv
import io
import copy


def source_ordered_settings(settings, source_bytes):
    groups = [('utf-8-sig', ['UTF-8', '65001', 'UTF-8 (65001)']),
              ('cp1251', ['Windows-1251', 'CP1251', '1251', 'Кириллическая (1251)']),
              ('cp1252', ['Windows-1252', 'CP1252', '1252', 'Западноевропейская (1252)']),
              ('utf-16-le', ['UTF-16 LE', 'UTF-16LE', '1200', 'UTF-16 LE (1200)']),
              ('utf-16-be', ['UTF-16 BE', 'UTF-16BE', '1201', 'UTF-16 BE (1201)'])]
    codec = next((c for c, aliases in groups if settings['source']['encoding'] in aliases), None)
    if codec is None:
        raise ValueError('unsupported source encoding')
    fmt = settings['format']; qualifier = fmt['text_qualifier']
    records = list(csv.reader(io.StringIO(source_bytes.decode(codec).removeprefix('\ufeff'), newline=''),
                             delimiter=fmt['delimiter'], quotechar=qualifier or None,
                             quoting=csv.QUOTE_MINIMAL if qualifier else csv.QUOTE_NONE))
    records = records[settings['source']['rows_to_skip']:]
    if not records:
        raise ValueError('missing source schema')
    names = records[0] if settings['source']['first_line_as_title'] else ['COL'+str(i+1) for i in range(len(records[0]))]
    columns = settings['columns']; by_source = {c.get('source_name', c['name']): c for c in columns}
    if len(set(names)) != len(names) or len(by_source) != len(columns) or set(by_source) != set(names):
        raise ValueError('source references do not cover the unique file schema')
    return {**copy.deepcopy(settings), 'columns': [copy.deepcopy(by_source[name]) for name in names]}
