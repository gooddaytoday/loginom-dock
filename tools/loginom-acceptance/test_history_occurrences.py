"""Storage copies are not retry successes; all examples are synthetic."""
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from evidence import export_history, PREFIX

class HistoryOccurrences(unittest.TestCase):
    def export(self, *, stamp=10, boundary=True, summary=False, changed=False, archived=True):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);db=sqlite3.connect(home/'state.db')
            db.execute('CREATE TABLE messages(id INTEGER,session_id TEXT,role TEXT,tool_call_id TEXT,tool_name TEXT,content TEXT,tool_calls TEXT,timestamp REAL,active INTEGER,_compressed_summary INTEGER)')
            args={'name':PREFIX+'dock_workspace_observe','arguments':{}}
            call=json.dumps([{'id':'same','function':{'name':'tool_call','arguments':json.dumps(args)}}])
            reply=json.dumps({'status':'SUCCEEDED','output':{'observation_id':'one'}})
            other=reply if not changed else json.dumps({'status':'FAILED'})
            if summary:
                other='[tool_call]'+''.join(f' {k}={str(v)[:40]}' for k,v in args.items())+f' ({len(reply):,} chars result)'
            rows=[(1,'s','assistant',None,None,'HIDDEN_REASONING',call,9,0 if archived else 1,0),
                  (2,'s','tool','same','tool_call',reply,None,10,0 if archived else 1,0),
                  (3,'s','assistant',None,None,'HIDDEN_SUMMARY',None,20,1,int(boundary)),
                  (4,'s','assistant',None,None,'HIDDEN_REASONING',call,9 if stamp==10 else stamp-1,1,0),
                  (5,'s','tool','same','tool_call',other,None,stamp,1,0)]
            db.executemany('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?)',rows);db.commit();db.close()
            return export_history(home,[])
    def test_exact_archived_copies_are_explicit_aliases(self):
        calls,tools=self.export()
        self.assertEqual((len(calls),len(tools)),(1,1))
        self.assertEqual(calls[0]['storage_copies'][0]['row'],4)
        self.assertEqual(tools[0]['storage_copies'][0]['row'],5)
        self.assertEqual(tools[0]['provider_tool_call_id'],'same')
        self.assertEqual(calls[0]['tool_call_id'],tools[0]['tool_call_id'])
        self.assertNotIn('HIDDEN',json.dumps([calls,tools]))
    def test_verified_generic_summary_retains_original_receipt_and_copy(self):
        calls,tools=self.export(summary=True)
        self.assertEqual(len(tools),1)
        self.assertEqual(tools[0]['result']['status'],'SUCCEEDED')
        self.assertEqual(tools[0]['storage_copies'][0]['kind'],'exact_generic_summary_after_compression')
    def test_same_id_on_new_timestamp_is_a_separate_occurrence(self):
        calls,tools=self.export(stamp=30)
        self.assertEqual((len(calls),len(tools)),(2,2))
        self.assertNotEqual(calls[0]['tool_call_id'],calls[1]['tool_call_id'])
        self.assertEqual([c['tool_call_id'] for c in calls],[t['tool_call_id'] for t in tools])
    def test_no_boundary_or_no_archive_never_collapses_calls(self):
        for options in ({'boundary':False},{'archived':False}):
            calls,tools=self.export(**options)
            self.assertEqual((len(calls),len(tools)),(2,2))
    def test_conflicting_reply_is_preserved_and_pairing_cannot_pass(self):
        calls,tools=self.export(changed=True)
        self.assertEqual(len(calls),1);self.assertEqual(len(tools),2)
        self.assertEqual(tools[1]['result']['status'],'FAILED')
        self.assertEqual(tools[0]['tool_call_id'],tools[1]['tool_call_id'])

if __name__=='__main__':unittest.main()
