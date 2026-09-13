"""Synthetic observer evidence only: never admits a native acceptance run."""
import copy,json,tempfile,unittest
from pathlib import Path
from text_export_observer_evidence import verify_observer,sha,REVISION

def encoded(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()

class ObserverEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='node17-proof-test-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.data=b'x\n';self.read_id='synthetic-read'
        self.identity=dict(document_id='d',workflow_id='w',node_id='n',source_node_id='s')
        snapshot=dict(complete=True,**self.identity,graph={'nodes':['s','n']},settings={'delimiter':';'},source_settings={'delimiter':';'})
        self.expected=dict(overall_deadline_ms=3600000,run_id='run',session_id='session',runtime='a'*64,origin='http://logi-test-plan.bg.local',identity=self.identity,expected_snapshot=snapshot,
            baseline=dict(original_event_hash='b'*64,original_event_index=1,destination='/test-2/result.csv',native_file='original/result.csv',bytes=2,sha256=sha(self.data)),
            reject=dict(terminal_event_hash='c'*64,terminal_event_index=10,status='FAILED',cleanup_complete=True,verification='text_export_conflict_rejected',destination='/test-2/result.csv'))
        self.request={'params':{'name':'dock_node_apply','arguments':{'operation_id':'replace','parameters':{'overwrite':'replace','destination':'/test-2/result.csv'}}}}
        b={k:copy.deepcopy(v) for k,v in self.expected.items() if k!='expected_snapshot'}
        b.update(observer_revision=REVISION,read_id=self.read_id,deadline_ms=60000,request_sha256=sha(encoded(self.request)))
        r=dict(read_id=self.read_id,before=copy.deepcopy(snapshot),after=copy.deepcopy(snapshot),destination='/test-2/result.csv',bytes=2,sha256=sha(self.data),native_file='reject-baseline/'+self.read_id+'/result.csv',cleanup_complete=True,workflow_returned=True,download_count=1,listener_before_gesture=True)
        kinds=['snapshot_before','download_listener','download_gesture','download_completed','workflow_return','snapshot_after']
        payloads=[snapshot,{}, {},dict(suggested_name='result.csv',download_completed=True,destination=r['destination']),self.identity,snapshot]
        r['raw']=[dict(kind=k,seq=i+1,read_id=self.read_id,session_id='session',origin=self.expected['origin'],payload=copy.deepcopy(payloads[i])) for i,k in enumerate(kinds)]
        self.events=[dict(kind=k,payload=p,mono_ms=i+1) for i,(k,p) in enumerate(zip(['reject_bound','read_started','read_completed','replace_dispatch'],[b,{'read_id':self.read_id},r,{'read_id':self.read_id,'request_sha256':b['request_sha256']}]))]
        self.file=self.root/r['native_file'];self.file.parent.mkdir(parents=True);self.file.write_bytes(self.data)
        self.persist()

    def persist(self):
        previous='0'*64;lines=[]
        for i,e in enumerate(self.events):
            e.update(seq=i+1,previous=previous);line=encoded(e);previous=sha(line);lines.append(line)
        (self.root/'observer.jsonl').write_bytes(b'\n'.join(lines)+b'\n')
        self.expected['actual_replace_dispatch']=dict(operation_id='replace',after_observer_chain_sha256=previous,mono_ms=5,before_product_dispatch=True)

    def result(self):return verify_observer(self.root,self.expected,self.request)['passed']

    def test_synthetic_positive_does_not_claim_native_or_global_atomicity(self):
        r=verify_observer(self.root,self.expected,self.request)
        self.assertTrue(r['passed']);self.assertEqual(r['scope'],'unadmitted_observer_proof');self.assertFalse(r['global_atomicity_verified'])

    def test_semantic_negatives_with_valid_rebuilt_hash_chain(self):
        originals=copy.deepcopy(self.events)
        changes=[
            (0,['run_id'],'old-run'),(0,['session_id'],'old-session'),(0,['runtime'],'old-runtime'),
            (0,['baseline','original_event_index'],11),(0,['reject','cleanup_complete'],False),(0,['deadline_ms'],4),
            (2,['destination'],'/test-2/other.csv'),(2,['bytes'],3),(2,['sha256'],'0'*64),
            (2,['cleanup_complete'],False),(2,['workflow_returned'],False),(2,['download_count'],2),
            (2,['listener_before_gesture'],False),(2,['native_file'],'original/result.csv'),
            (2,['after','settings','delimiter'],','),(2,['after','source_settings','delimiter'],','),
            (2,['after','graph','nodes'],['s']),(2,['before','complete'],False),
            (2,['raw',1,'kind'],'download_gesture'),(2,['raw',3,'payload','suggested_name'],'old.csv'),
            (2,['raw',3,'session_id'],'old-session'),(2,['raw',4,'payload','node_id'],'other'),
            (3,['read_id'],'old-read'),(3,['request_sha256'],'0'*64),
        ]
        for index,path,value in changes:
            with self.subTest(path=path,value=value):
                self.events=copy.deepcopy(originals);target=self.events[index]['payload']
                for key in path[:-1]:target=target[key]
                target[path[-1]]=value;self.persist();self.assertFalse(self.result())

    def test_actual_dispatch_must_be_independently_bound(self):
        for key,value in [('operation_id','other'),('mono_ms',0),('before_product_dispatch',False),('after_observer_chain_sha256','0'*64)]:
            with self.subTest(key=key):
                self.persist();self.expected['actual_replace_dispatch'][key]=value;self.assertFalse(self.result())
        self.expected.pop('actual_replace_dispatch');self.assertFalse(self.result())

    def test_tamper_missing_events_and_actual_bytes(self):
        p=self.root/'observer.jsonl';original=p.read_bytes()
        for data in [b'',original.replace(b'"seq":1',b'"seq":9'),original.splitlines()[0]+b'\n']:
            p.write_bytes(data);self.assertFalse(self.result())
        p.write_bytes(original);self.file.write_bytes(b'y\n');self.assertFalse(self.result())
        self.file.unlink();self.assertFalse(self.result())

    def test_wrong_request_and_symlink_are_refused(self):
        self.request['params']['arguments']['parameters']['overwrite']='reject';self.assertFalse(self.result())
        self.request['params']['arguments']['parameters']['overwrite']='replace'
        other=self.root/'other.csv';other.write_bytes(self.data);self.file.unlink();self.file.symlink_to(other);self.assertFalse(self.result())

    def test_nonmonotonic_and_nonfinite_times_are_refused(self):
        for time in [0,float('nan'),float('inf')]:
            self.events[2]['mono_ms']=time;self.persist();self.assertFalse(self.result())

if __name__=='__main__':unittest.main()
