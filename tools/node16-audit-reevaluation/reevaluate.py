"""Explicitly versioned independent reevaluation; execution harness stays frozen."""
import hashlib,importlib.util,json,sys
from pathlib import Path
RUN_ID='20260913-205733-a38816e5'
VERSION='node16-user-v1-reevaluation-v1'
ROOT=Path.cwd();WORK=ROOT/'tools/loginom-acceptance'
sys.path.insert(0,str(WORK))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def build(run):
 run=Path(run);request=json.loads((run/'request.json').read_text())
 if request['run_id']!=RUN_ID:raise ValueError('This verifier authorizes one explicit original run only')
 original=WORK/'collapse_node_acceptance.py'
 if sha(original)!=request['harness_inputs']['collapse_node_acceptance.py']:raise ValueError('Original execution auditor changed')
 for name,digest in request['harness_inputs'].items():
  if sha(WORK/name)!=digest:raise ValueError('Original execution harness changed: '+name)
 spec=importlib.util.spec_from_file_location('node16_original_auditor_preserved',original);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
 # A separately versioned independent implementation replaces only node projection.
 projection=Path(__file__).with_name('auditor-node-projection-candidate.py')
 exec(compile(projection.read_text(),str(projection),'exec'),v.__dict__)
 native=v.native_case
 def bind_restart(e,ps):
  old=RUN_ID+':reconfigured';final=old+'-final';source=old+'-source'
  rows=[(c,r) for c,r in ps if c['arguments'].get('operation_id')==old]
  v.need([c['tool'].removeprefix(v.PREFIX) for c,r in rows]==['dock_node_apply','dock_node_wait','dock_node_apply','dock_node_resume','dock_node_wait'],'Different recovery sequence')
  first,first_reply=rows[0];first_done=rows[1][1]['result'];replay_call,replay_reply=rows[2];resume_call,resume_reply=rows[3];resume_done=rows[4][1]['result']
  v.need(first_reply['result']['state']=='running' and first_done['state']=='settled' and first_done['status']=='NOT_APPLIED' and first_done['effect_possible'] is False and first_done['cleanup_complete'] is True,'Original operation had effects')
  v.need(replay_call['arguments']==resume_call['arguments']==first['arguments'] and replay_reply['result']==first_done,'Cached replay request/result changed')
  outcome=v.event(e,old,'completed')['outcome']
  v.need(outcome['status']=='NOT_APPLIED' and outcome['effect_possible'] is False and outcome['cleanup_complete'] is True,'Original journal had effects')
  v.need(not any(x.get('operation_id')==old and x.get('phase','').startswith('node_step') for x in e['events']),'Original operation dispatched a node step')
  v.need(sum(x.get('operation_id')==old and x.get('phase')=='node_apply_prepared' for x in e['events'])==1,'Replay/resume prepared extra work')
  v.need(resume_reply['result']['state']=='running' and resume_done['state']=='settled' and resume_done.get('status') is None and resume_done.get('outcome') is None and resume_done['error']['code']=='NODE_WORKER_REJECTED' and resume_done['error']['message']=='Resume requires the original inspected node checkpoint without an unresolved phase','Resume was not a refusal')
  target_call,target_reply=v.one([(c,r) for c,r in ps if c['tool']==v.PREFIX+'dock_node_apply' and c['arguments'].get('operation_id')==final],'Final operation identity')
  v.need({**first['arguments'],'operation_id':final}==target_call['arguments'] and target_call['arguments']['target']['kind']=='existing','Final target/parameters changed')
  v.need(rows[4][1]['row']<target_call['row'],'Final began before resume refusal')
  source_call,source_body=v.node(e,ps,source)
  v.need(source_body['status']=='SUCCEEDED' and source_body['execution']['status']=='completed','Source execution missing')
  sc,sr=v.one([(c,r) for c,r in ps if c['tool']==v.PREFIX+'dock_node_apply' and c['arguments'].get('operation_id')==source],'Source start')
  terminals=[r for c,r in ps if c['arguments'].get('operation_id')==source and r['result'].get('state')=='settled']
  v.need(rows[1][1]['row']<sc['row'] and terminals and max(r['row'] for r in terminals)<replay_call['row'],'Source execution order')
  proof=v.event(e,final,'collapse_native_full_completed')['proof']['source_profile']
  v.need(proof['import_operation_id']==source and proof['node_id']==source_body['node']['node_id'] and proof['execution_id']==source_body['execution']['execution_id'],'Different source execution')
  for c,r in ps:
   if first['row']<c['row']<target_call['row']:
    v.need(c['arguments'].get('operation_id') in (old,source) and c['tool'] in [v.PREFIX+n for n in ('dock_node_apply','dock_node_wait','dock_node_resume')],'Unaccounted intervening operation')
  v.saved_checkpoint(e,ps,RUN_ID+':save-reconfigured')
  return final
 def native_case(e,ps,op,key):
  if key=='reconfigured' and op==RUN_ID+':reconfigured':op=bind_restart(e,ps)
  return native(e,ps,op,key)
 v.native_case=native_case;v.bind_restart=bind_restart
 return v
