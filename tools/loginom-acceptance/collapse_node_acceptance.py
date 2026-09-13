"""Fail-closed FULL Collapse goal auditor, separate from case-only oracle.

Consumes original model-run calls/tool content/events and an independent session
bundle. Readonly source, topology and fault evidence must come from actual native sessions.
"""
import argparse,hashlib,importlib.util,json,re,sys
from pathlib import Path
from evidence import PREFIX,unwrap
from grouping_node_acceptance import model_completed
from node_public_acceptance_evidence import paired_public_calls, proven_validation_refusal
from preflight import runtime_pin
import collapse_acceptance as admission
W=Path(__file__).resolve().parent;R=W.parents[1];K=admission.KIT
spec=importlib.util.spec_from_file_location('collapse_case_oracle',K/'audit.py');oracle=importlib.util.module_from_spec(spec);spec.loader.exec_module(oracle)
EXPECTED=json.loads((K/'expected.json').read_text())
PINS=json.loads((K.parent/'review-fix/provenance.json').read_text())
def need(v,message):
    if not v:raise ValueError(message)
def one(xs,message):need(len(xs)==1,message);return xs[0]
def event(e,operation,phase):return one([x for x in e['events'] if x.get('operation_id')==operation and x.get('phase')==phase],phase+': '+operation)
def pairs(e):
    ps,failures=paired_public_calls(e);need(not failures,'Raw call/reply binding: '+str(failures))
    for c,r in ps:
        raw=r.get('raw_content');need(isinstance(raw,str) and 0<len(raw.encode())<=1048576,'Missing/oversized raw public reply')
        need(unwrap(raw)==r['result'],'Raw reply differs from projected result')
    return ps

def node(e,ps,op):
    call=one([c for c,r in ps if c['tool']==PREFIX+'dock_node_apply' and c['arguments'].get('operation_id')==op],'Node public start')
    prepared=event(e,op,'node_apply_prepared');need(prepared['request']==call['arguments'],'Prepared request differs from public call')
    replies=[r['result'] for c,r in ps if c['arguments'].get('operation_id')==op and r['result'].get('state')=='settled']
    need(bool(replies) and all(x==replies[0] for x in replies),'Node settled result absent/changed')
    body=replies[0];end=event(e,op,'completed')['outcome'];n=end['output']
    need(body['status']==end['status'] and body.get('node')==n.get('node'),'Terminal node identity/status')
    if end['status']=='SUCCEEDED':
        need(body['configuration']==n['configuration'] and body['execution']==n['execution'],'Terminal settings/execution differ')
        for a,b in zip(body['output'].get('ports',[]),n['output'].get('ports',[])):
            for key in ['schema','exact_table','sample','read_coverage','binding']:
                need(a.get(key)==b.get(key),'Public/internal '+key)
        need(len(body['output'].get('ports',[]))==len(n['output'].get('ports',[])),'Public/internal port count')
    return call['arguments'],body

def native_case(e,ps,op,key):
    request,body=node(e,ps,op);oracle.audit(body,key)
    for role in ['information','transposed']:
        if role in request['parameters']:need([f['name'] for f in request['parameters'][role]]==EXPECTED[key][role],'Declared roles differ')
    if 'ignore_empty' in request['parameters']:need(request['parameters']['ignore_empty']==EXPECTED[key]['ignore_empty'],'Declared empty policy differs')
    need(request['read']['coverage']=='full' and request['read']['require_exact_numbers'] is True,'Exact request required')
    proof=event(e,op,'collapse_native_full_completed')['proof'];b=body['output']['ports'][0]['binding']
    need(proof['read_id']==b['read_id'] and proof['binding']['runtime_binding_id']==proof['loaded_runtime']['binding_id']==b['read_id'],'Loaded binding identity')
    need(all(proof['binding'].get(k)==v for k,v in b.items() if k!='read_id'),'Native/public full binding')
    need(proof['loaded_runtime']['document_id']==b['document_id'],'Loaded document')
    need(proof['loaded_runtime']['functions']==PINS['loaded_functions'] and proof['loaded_runtime']['constants']==PINS['loaded_constants'],'Loaded implementations')
    need({f['name']:f['sha256'] for f in proof['frontends']}==PINS['frontend_sha256'],'Frontend pins')
    life=proof['lifecycle'];count=body['output']['ports'][0]['read_coverage']['cells_read']
    need(life['published'] and not life['retired'] and life['pending']==0 and life['requests']==life['releasedRequests']==life['releasedResponses']==count,'Native lifecycle')
    src=proof['source_profile'];imp,imported=node(e,ps,src['import_operation_id'])
    need(imp['target']['type']=='imports.text' and imported['execution']['status']=='completed','Completed local source')
    need(imported['node']['node_id']==src['node_id'] and imported['execution']['execution_id']==src['execution_id'],'Source execution identity')
    need(imp['parameters']['source']['upload_operation_id']==src['source']['lineage']['selected_upload'],'Private source upload identity')
    up=event(e,src['source']['lineage']['verified_current_upload'],'completed')['outcome']
    # Initial upload completion alone is not byte verification: require final
    # server-copy proof in any later recorded outcome for this exact upload.
    upload_id=src['source']['lineage']['verified_current_upload']
    verified=[x.get('outcome',{}) for x in e['events'] if x.get('operation_id')==upload_id and isinstance(x.get('outcome'),dict)]
    need(any(x.get('status')=='SUCCEEDED' and x.get('output',{}).get('server_copy_verification',{}).get('sha256')==src['source']['sha256'] and x['output']['server_copy_verification'].get('bytes_verified') is True and x['output']['server_copy_verification'].get('upload_completion_verified') is True and x['output']['server_copy_verification'].get('bytes')==src['source']['bytes'] and x['output']['server_copy_verification'].get('destination')==src['source']['destination'] for x in verified),'Verified source bytes')
    fixture=K/'fixtures'/EXPECTED[key]['fixture'];need(src['source']['sha256']==admission.sha(fixture) and src['source']['bytes']==fixture.stat().st_size,'Frozen source bytes differ')
    need(src['source']['lineage']['basis']=='private_ordered_upload_history' and type(src['source']['lineage']['execution_sequence']) is int and src['source']['lineage']['external_writers_excluded'] is False,'Source lineage contract')
    return request,body

def readonly_receipt(receipt,*,run_id,document_id,path,digest,size):
    # Schema validation cannot substitute for an installed independently audited producer.
    need(receipt['kind']=='collapse_readonly_source_v1' and receipt['run_id']==run_id and receipt['document_id']==document_id,'Readonly run/document')
    need(receipt['path']==path and receipt['sha256']==digest and receipt['bytes']==size,'Readonly bytes/path')
    need(receipt['before_any_write'] is True and receipt['write_operations']==[],'Readonly observation order')
    need(receipt.get('raw_observation_refs') and receipt.get('download_artifact_sha256')==digest,'Readonly native evidence missing')
    need(False,'Bare readonly receipts are unsupported; actual native session evidence required')

def persistence(request,e,bundle,original):
    need(isinstance(bundle,dict),'Independent new-session bundle missing')
    need(bundle['run_id']==request['run_id'] and bundle['origin']=='independent_codex_session','Independent run identity')
    if bundle.get('kind')=='collapse_native_sessions_v1':
        return native_session_persistence(request,e,bundle,original)
    other=bundle['evidence'];need(other['run_id']==request['run_id'] and other['events'],'Independent raw evidence missing');ps=pairs(other)
    need(set(bundle['case_operations'])==set(EXPECTED),'All ten independent reopened cases required')
    for key,(oldrequest,before) in original.items():
        op=bundle['case_operations'][key];again,after=native_case(other,ps,op,key)
        need(again['parameters']=={} and again['mappings']==[],'Reopen secretly reconfigured Collapse')
        need(before['node']['node_id']==after['node']['node_id'] and before['node']['document_id']!=after['node']['document_id'],'Independent document/node identity')
        for field in ['schema','exact_table']:need(before['output']['ports'][0][field]==after['output']['ports'][0][field],'Persistence '+field)
        for field in ['mode','information','transposed','ignore_empty','input_mapping','output_mapping']:need(before['configuration']['readback'][field]==after['configuration']['readback'][field],'Persisted settings '+field)
        proof=event(other,op,'collapse_native_full_completed')['proof'];imp,imported=node(other,ps,proof['source_profile']['import_operation_id'])
        need(imp['parameters']['settings']=={} and imp['mappings']==[],'Reopen import was reconfigured')
        oldproof=event(e,oldrequest['operation_id'],'collapse_native_full_completed')['proof'];_,oldimport=node(e,pairs(e),oldproof['source_profile']['import_operation_id'])
        for field in ['source','format','columns','output_mapping']:need(imported['configuration']['readback'][field]==oldimport['configuration']['readback'][field],'Persisted import '+field)
        graph=bundle['graphs'][key];need(graph['before']==graph['after'] and bool(graph['before']['nodes']) and bool(graph['before']['links']),'Saved topology differs/missing')
        need(graph['before_document']==before['node']['document_id'] and graph['after_document']==after['node']['document_id'] and graph['raw_before_ref'] and graph['raw_after_ref'],'Topology raw ownership')
        saveid=bundle['save_operations'][key];savecall,savereply=one([(c,r) for c,r in pairs(e) if c['tool']==PREFIX+'dock_action_run' and c['arguments'].get('operation_id')==saveid],'Save public call')
        saved=event(e,saveid,'completed')['outcome'];need(saved['status']=='SUCCEEDED' and saved['output']['save_completed'] and saved['output']['workflow_preserved'],'Saved checkpoint not proved')
        need(savereply['result']['output']==saved['output'],'Save public/journal mismatch')
        need(saved['output']['package_ref']['path']==bundle['package_paths'][key],'Saved path differs')
        source=proof['source_profile']['source']
        readonly_receipt(bundle['readonly_sources'][key],run_id=request['run_id'],document_id=after['node']['document_id'],path=source['destination'],digest=source['sha256'],size=source['bytes'])
    return True

def native_session_persistence(request,e,bundle,original):
    """Consume real per-case sessions; never merge ten callers into one identity.

    This component check does not change the separate model/candidate admission.
    Diagnostic source cases cannot substitute for the original model run.
    """
    sys.path.insert(0,str(K.parent/'native-gates'))
    try:
        from verify_reopened import check as fresh_check
        from import_settings import format_equal
        from export_live import export
        need(set(original)==set(EXPECTED)==set(bundle['sessions']),'All ten original and fresh cases required')
        docs=set();sessions=set()
        for key,(oldrequest,before) in original.items():
            directory=Path(bundle['sessions'][key]);spec=json.loads((directory/'readonly-specification.json').read_text())
            need(spec['case']==key and spec['run_id']==request['run_id'],'Native case/run identity')
            verified=fresh_check(directory)
            need(verified['document_id'] not in docs and verified['session_id'] not in sessions,'Fresh case session reused')
            docs.add(verified['document_id']);sessions.add(verified['session_id'])
            baseline=json.loads(Path(spec['baseline_case']).read_text())
            for field in ['node','configuration','output']:
                need(baseline[field]==before[field],'Diagnostic baseline substituted for original model '+field)
            other=export(directory,request['run_id']);op=spec['run_id']+':'+key+':reopen'
            _,after=native_case(other,pairs(other),op,key)
            oldproof=event(e,oldrequest['operation_id'],'collapse_native_full_completed')['proof']
            _,oldimport=node(e,pairs(e),oldproof['source_profile']['import_operation_id'])
            imported=json.loads((directory/'reopened-import.json').read_text())['output']
            for field in ['source','format','columns','output_mapping']:
                new_value=imported['configuration']['readback'][field];old_value=oldimport['configuration']['readback'][field]
                need(format_equal(old_value,new_value) if field=='format' else new_value==old_value,'Persisted import '+field)
            saveid=bundle['save_operations'][key]
            savecall,savereply=one([(c,r) for c,r in pairs(e) if c['tool']==PREFIX+'dock_action_run' and c['arguments'].get('operation_id')==saveid],'Original model save public call')
            saved=event(e,saveid,'completed')['outcome']
            need(saved['status']=='SUCCEEDED' and saved['output']['save_completed'] and saved['output']['workflow_preserved'],'Original saved checkpoint missing')
            need(savereply['result']['output']==saved['output'],'Save public/journal mismatch')
            need(saved['output']['package_ref']['path']==spec['package']['path'],'Original saved package differs')
        return True
    finally:
        sys.path.pop(0)

def audit_native_diagnostics(bundle):
    """Explicit operator scope: raw bridge verification, never Hermes acceptance."""
    sys.path.insert(0,str(K.parent/'native-gates'))
    try:
        from verify_bundle import check
        return check(bundle)
    finally:
        sys.path.pop(0)

def negative(e,ps,op,kind):
    call,reply=one([(c,r) for c,r in ps if c['tool']==PREFIX+'dock_node_apply' and c['arguments'].get('operation_id')==op],'Negative public call')
    p=call['arguments']['parameters']
    need((kind=='conflict' and bool({f['name'] for f in p['information']}&{f['name'] for f in p['transposed']})) or (kind=='empty' and p['transposed']==[]) or (kind=='missing' and '__MissingField__' in [f['name'] for f in p['transposed']]),'Negative input wrong')
    if kind in ('conflict','empty'):
        need(proven_validation_refusal(call,reply,e['events'],set(),ps),'Negative is not a proven unallocated MCP validation refusal')
        error=json.JSONDecoder().raw_decode(reply['result']['error'])[0]
        message=json.dumps(error.get('error',{}),ensure_ascii=False).lower()
        need(('complete ordered collapse roles required' in message) if kind=='empty' else ('unknown, duplicate or conflicting collapse role' in message),'Wrong validation cause')
    else:
        _,r=node(e,ps,op)
        need(r['status']=='NOT_APPLIED' and r['effect_possible'] is False and r['cleanup_complete'] is True,'Negative mutated state')
        need('__MissingField__' in json.dumps(event(e,op,'completed')['outcome'],ensure_ascii=False),'Missing-field cause absent')
    need(not any(x.get('operation_id')==op and x.get('phase')=='node_step_prepared' for x in e['events']),'Negative dispatched mutation')
    return True

def obligations(request,e,ps,independent=None):
    run=request['run_id']
    for suffix,kind in [('negative-conflict','conflict'),('negative-missing','missing'),('negative-empty','empty')]:
        negative(e,ps,run+':'+suffix,kind)
    for finish in ['done','close']:
        r,b=node(e,ps,run+':'+finish);need(r['finish']==finish and b['status']=='SUCCEEDED' and b['execution']['status']=='not_requested','Done/Close executed or missing')
    # The frozen goal says "if an operation becomes ambiguous"; it does not ask
    # Hermes to manufacture a transport fault. Inject it in the independent live
    # harness, retain the real gesture/replay/resume replies, and bind the session
    # to this run. No synthetic journal event or historical loss receipt qualifies.
    need(isinstance(independent,dict) and independent.get('run_id')==run,'Current independent loss session required')
    directory=Path(independent['loss_session'])
    session=json.loads((directory/'session.json').read_text())
    need(session['sessionId'] not in {c['session_id'] for c in e['calls']},'Independent loss caller required')
    sys.path.insert(0,str(K.parent/'native-gates'))
    try:
        from verify_loss import check as loss_check
        need(loss_check(directory)['operation_id'].startswith(run+':'),'Foreign loss operation')
    finally:sys.path.pop(0)
    # Any genuine ambiguous model operations must remain unresolved and must not
    # be hidden by the separate injected-fault check.
    for ev in e['events']:
        if ev.get('phase')=='completed' and ev.get('outcome',{}).get('status')=='AMBIGUOUS':
            need(False,'Model ambiguous operation requires diagnosis before acceptance: '+str(ev.get('operation_id')))
    return True

def audit(request,evidence,prompt,independent):
    checks={};results={}
    def check(name,fn):
        try:fn();checks[name]={'passed':True}
        except (ValueError,KeyError,TypeError,AssertionError,IndexError,OSError) as ex:checks[name]={'passed':False,'reason':str(ex) or 'Contract mismatch'}
    def identity():
        admission.frozen();need(request['goal_id']==admission.GOAL_ID and re.fullmatch(r'\d{8}-\d{6}-[a-f0-9]{8}',request['run_id']),'Goal/run missing')
        need(evidence['run_id']==request['run_id'],'Model run differs')
        need(request['input_artifacts']==admission.fixtures(request['run_id'],request['storage_directory']),'Fixture admission differs')
        need(prompt==admission.prompt(request['package_path'],request['storage_directory'],request['run_id']),'Prepared/changed goal substituted')
        need(request['goal_sha256']==admission.sha(W/'goals/collapse-node-complete.txt'),'Goal hash')
        need(request['runtime_source_pin']==runtime_pin(R) and request['runtime_source_pin']['client_revision']==admission.RUNTIME,'Runtime pins')
        need(all(request['harness_inputs'].get(k)==v for k,v in admission.harness_pins().items()),'Harness pins')
        need(evidence['export_complete'] and evidence['runtime_source_unchanged'] and evidence['harness_unchanged'],'Incomplete/changed export')
        need(model_completed(request,evidence),'Current approved model execution missing')
        need(evidence['calls'] and evidence['tools'] and evidence['events'],'Missing raw public/events')
        need(all(x.get('runtime_revision')==admission.RUNTIME for x in evidence['events']),'Foreign event runtime')
        need(all(c['arguments'].get('operation_id','').startswith(request['run_id']+':') for c in evidence['calls'] if c['tool']==PREFIX+'dock_node_apply'),'Prepared/other run operations')
    check('current_model_run',identity)
    for key in EXPECTED:
        def case(key=key):results[key]=native_case(evidence,pairs(evidence),request['run_id']+':'+key,key)
        check('case:'+key,case)
    check('negatives_done_close_loss',lambda:obligations(request,evidence,pairs(evidence),independent))
    check('full_new_session_persistence_source',lambda:(need(set(results)==set(EXPECTED),'Missing original cases'),persistence(request,evidence,independent,results)))
    # No input JSON can flip an unimplemented native source-proof producer to PASS.
    check('admission',lambda:need(request.get('collapse_admission',{}).get('ready') is True and request['collapse_admission'].get('runtime')==admission.RUNTIME and request['collapse_admission'].get('candidate',{}).get('manifest_sha256')==admission.CANDIDATE_SHA and request['collapse_admission'].get('candidate',{}).get('slot'),'Original model launch was not admitted'))
    passed=all(c['passed'] for c in checks.values())
    return dict(scope='collapse-node-complete FULL goal',passed=passed,subplan_complete=passed,hermes_acceptance=passed,checks=checks,prepared_cases_are_acceptance=False)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('run',type=Path);p.add_argument('--independent',type=Path);a=p.parse_args()
    print(json.dumps(audit(json.loads((a.run/'request.json').read_text()),json.loads((a.run/'evidence.json').read_text()),(a.run/'scenario.txt').read_text(),json.loads(a.independent.read_text()) if a.independent else None),ensure_ascii=False,indent=2))
