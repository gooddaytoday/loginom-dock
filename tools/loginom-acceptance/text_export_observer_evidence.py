"""Independent unadmitted observer proof verifier; no native reader or model call.

`expected` must be derived from the actual public reject/original ledger, not
copied from proof.json. The outer gate stays closed pending native smoke.
"""
import hashlib,json,stat,math
from pathlib import Path
REVISION='node17-reject-read-observer.1-unadmitted'
def sha(data):return hashlib.sha256(data).hexdigest()
def verify_observer(directory,expected,replace_request):
    if not __debug__: return {"passed":False,"reason":"Verifier requires assertions enabled"}
    directory=Path(directory)
    try:
        lines=(directory/'observer.jsonl').read_bytes().splitlines();events=[];previous='0'*64
        assert len(lines)==4,'Missing/extra/incomplete observer events'
        for i,line in enumerate(lines):
            e=json.loads(line);assert e['seq']==i+1 and e['previous']==previous
            assert isinstance(e['mono_ms'],(int,float)) and math.isfinite(e['mono_ms']) and (not events or e['mono_ms']>=events[-1]['mono_ms'])
            previous=sha(line);events.append(e)
        assert [e['kind'] for e in events]==['reject_bound','read_started','read_completed','replace_dispatch']
        b=events[0]['payload'];r=events[2]['payload'];d=events[3]['payload'];read_id=b['read_id']
        for key in ['run_id','session_id','runtime','baseline','reject','identity','origin','overall_deadline_ms']:assert b[key]==expected[key],key
        assert b['observer_revision']==REVISION
        assert b['reject']['status']=='FAILED' and b['reject']['cleanup_complete'] is True and b['reject']['verification']=='text_export_conflict_rejected'
        assert b['baseline']['original_event_index']<b['reject']['terminal_event_index']
        assert events[3]['mono_ms']<b['deadline_ms']<=events[0]['mono_ms']+60000
        assert b['deadline_ms']<=b['overall_deadline_ms']
        assert events[1]['payload']['read_id']==r['read_id']==d['read_id']==read_id
        encoded=json.dumps(replace_request,ensure_ascii=False,separators=(',',':')).encode()
        assert b['request_sha256']==d['request_sha256']==sha(encoded),'Request changed'
        args=replace_request['params']['arguments'];assert args['parameters']['overwrite']=='replace'
        assert r['destination']==b['baseline']['destination']==b['reject']['destination']==args['parameters']['destination']
        assert r['cleanup_complete'] is True and r['workflow_returned'] is True and r['download_count']==1
        assert r['before']==r['after']==expected['expected_snapshot'] and r['before']['complete'] is True
        for key in ['document_id','workflow_id','node_id','source_node_id']:assert r['before'][key]==expected['identity'][key]
        for key in ['graph','settings','source_settings']:assert isinstance(r['before'][key],dict) and r['before'][key]
        raw=r['raw'];assert [x['kind'] for x in raw]==['snapshot_before','download_listener','download_gesture','download_completed','workflow_return','snapshot_after']
        assert r['listener_before_gesture'] is True
        for i,x in enumerate(raw):assert x['seq']==i+1 and x['read_id']==read_id and x['session_id']==b['session_id'] and x['origin']==b['origin']
        assert raw[0]['payload']==r['before'] and raw[5]['payload']==r['after'] and raw[4]['payload']==b['identity']
        name=Path(r['destination']).name;assert raw[3]['payload']=={'suggested_name':name,'download_completed':True,'destination':r['destination']}
        assert r['native_file']=='reject-baseline/'+read_id+'/'+name and r['native_file']!=b['baseline']['native_file']
        p=directory/r['native_file'];assert p.resolve().is_relative_to(directory.resolve())
        assert all(not x.is_symlink() for x in [p,*p.parents] if x!=directory.parent)
        info=p.lstat();assert stat.S_ISREG(info.st_mode) and info.st_size<=16777216
        data=p.read_bytes();assert len(data)==r['bytes']==b['baseline']['bytes'] and sha(data)==r['sha256']==b['baseline']['sha256']
        # Actual outer dispatcher integration must also require this anchor.
        # A local `replace_dispatch` intent alone is not actual dispatch proof.
        actual=expected['actual_replace_dispatch'];assert actual['operation_id']==args['operation_id']
        assert actual['after_observer_chain_sha256']==previous and actual['mono_ms']>=events[3]['mono_ms']
        assert actual['before_product_dispatch'] is True
        return {'passed':True,'scope':'unadmitted_observer_proof','bytes':len(data),'sha256':sha(data),'global_atomicity_verified':False}
    except (AssertionError,KeyError,TypeError,ValueError,OSError) as e:
        return {'passed':False,'scope':'unadmitted_observer_proof','reason':str(e),'global_atomicity_verified':False}
