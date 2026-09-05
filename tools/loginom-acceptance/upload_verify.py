"""Independent transfer completion from same-session server-copy byte proof."""
import copy
import upload_probe
import rename_effect


def audit(evidence, checks, request, prefix, mutations, storage_audit):
    def check(name, value):
        checks.append({'name':name,'passed':bool(value)})
    calls,tools,events=(evidence[k] for k in ('calls','tools','events'))
    verifies=[c for c in calls if c['tool']==prefix+'dock_artifact_verify']
    check('one_server_copy_verification',len(verifies)==1)
    if len(verifies)!=1:return {'all_assertions_passed':False,'assertions':checks,'goal':'file-upload-verify'}
    call=verifies[0];args=call.get('arguments',{})
    before={**evidence,'calls':[c for c in calls if c['row']<call['row']],
            'tools':[t for t in tools if t['row']<call['row']]}
    upload_probe.audit(before,checks,request,prefix,mutations,storage_audit)
    uploads=[c for c in before['calls'] if c['tool']==prefix+'dock_artifact_upload']
    upload_id=uploads[0].get('arguments',{}).get('operation_id') if len(uploads)==1 else None
    check('verification_identifiers_bound',set(args)=={'operation_id','verification_id','observation_id','file_ref'}
          and all(isinstance(v,str) and bool(v) for v in args.values())
          and args.get('operation_id')==upload_id and args.get('verification_id')!=upload_id)
    prepared=[t['result'] for t in before['tools'] if t['tool']==prefix+'dock_prepare']
    artifacts=prepared[0].get('input_artifacts',[]) if len(prepared)==1 else []
    artifact=artifacts[0] if len(artifacts)==1 else {}
    descriptor=upload_probe.descriptor(request['run_id'],request['storage_directory'])
    reads=[t for t in before['tools'] if t['tool']==prefix+'dock_workspace_observe'
           and t['result'].get('output',{}).get('observation_id')==args.get('observation_id')]
    read=reads[0]['result'] if len(reads)==1 else {}
    output=read.get('output',{})
    targets=[r for r in output.get('ui',{}).get('elements',[]) if r.get('ref')==args.get('file_ref')]
    check('verification_targets_exact_delivered_csv',len(targets)==1 and targets[0].get('label')==descriptor['name']
          and targets[0].get('tid')==output.get('workflow_ref',{}).get('prefix','')+';FileStorageForm;colName_'+descriptor['name']
          and 'double_click' in targets[0].get('allowed_actions',[]))
    inspections=[t for t in before['tools'] if t['tool']==prefix+'dock_operation_inspect'
                 and t['result'].get('output',{}).get('operation_id')==upload_id]
    inspected=inspections[-1]['result']['output'] if inspections else {}
    compact={key:inspected.get(key) for key in ('operation_id','state','cleanup_confirmed','effect_state','recovery_options','next_steps')}
    original=inspected.get('outcome',{})
    compact['outcome_summary']={key:original.get(key) for key in ('status','action_key','operation_id')}
    compact['outcome_summary']['detail_tool']='dock_operation_inspect'
    comparable=copy.deepcopy(read);context=comparable.get('output',{}).pop('operation',None)
    records=[e for e in events if e.get('phase')=='observation_completed' and e.get('operation_id')==read.get('operation_id')]
    check('file_read_bound_to_raw_journal',bool(read.get('operation_id')) and len(records)==1
          and context==compact and compact.get('state')=='pending' and compact.get('cleanup_confirmed') is True
          and rename_effect.journal_equal(records[0].get('outcome',{}),comparable))
    replies=[t for t in tools if t['session_id']==call['session_id'] and t['tool_call_id']==call['tool_call_id']
             and t['tool']==call['tool'] and t['row']>call['row']]
    result=replies[0]['result'] if len(replies)==1 else {}
    destination=request['storage_directory']+'/'+descriptor['name']
    raw_output={'artifact_id':artifact.get('artifact_id'),'upload_grant_id':artifact.get('upload',{}).get('grant_id'),
                'upload_operation_id':upload_id,'destination':destination,'suggested_name':descriptor['name'],
                'download_completed':True,'bytes_verification_required':True,'file_ref':args.get('file_ref'),'observation_id':args.get('observation_id')}
    expected={**raw_output,'bytes_verification_required':False,'bytes_verified':True,
              'bytes':descriptor['bytes'],'sha256':descriptor['sha256'],'upload_completion_verified':True}
    check('host_verified_exact_bytes',result.get('status')=='SUCCEEDED' and result.get('action_key')=='artifact.verify'
          and result.get('action_revision')=='1' and result.get('operation_id')==args.get('verification_id')
          and result.get('phase')=='verified' and result.get('cleanup_complete') is True and result.get('error') is None
          and result.get('output')==expected)
    raw_records=[e for e in events if e.get('phase')=='download_completed' and e.get('operation_id')==args.get('verification_id')]
    raw=raw_records[0].get('outcome',{}) if len(raw_records)==1 else {}
    check('native_download_bound_to_verification',len(raw_records)==1 and raw.get('output')==raw_output
          and raw.get('action_key')=='artifact.download' and raw.get('action_revision')=='1'
          and raw.get('operation_id')==args.get('verification_id') and raw.get('status')=='SUCCEEDED'
          and raw.get('phase')=='downloaded' and raw.get('cleanup_complete') is True and raw.get('effect_possible') is True
          and raw.get('error') is None)
    verified=[e for e in events if e.get('phase')=='download_verified' and e.get('operation_id')==args.get('verification_id')]
    byte_result=copy.deepcopy(result)
    byte_result.setdefault('output',{})['upload_completion_verified']=False
    check('host_proof_bound_to_artifact_and_request',len(verified)==1 and verified[0].get('outcome')==byte_result
          and verified[0].get('parameters')=={'upload_operation_id':upload_id,'observation_id':args.get('observation_id'),'file_ref':args.get('file_ref')}
          and verified[0].get('checkpoint',{}).get('artifact')==artifact)
    after=[t for t in tools if t['tool']==prefix+'dock_operation_inspect' and t['row']>call['row']]
    summary={'verification_id':args.get('verification_id'),'status':'SUCCEEDED','bytes_verified':True,
             'upload_completion_verified':True,'destination':destination,'bytes':descriptor['bytes'],'sha256':descriptor['sha256']}
    transfers=[e for e in events if e.get('phase')=='transfer_completed' and e.get('operation_id')==upload_id]
    completed=transfers[0].get('outcome',{}) if len(transfers)==1 else {}
    check('transfer_completion_recorded',len(transfers)==1 and completed.get('status')=='SUCCEEDED'
          and completed.get('action_key')=='artifact.upload' and completed.get('operation_id')==upload_id
          and completed.get('cleanup_complete') is True and completed.get('error') is None
          and completed.get('output',{}).get('transfer_postcondition')=='destination_bytes_digest_and_size'
          and completed['output'].get('verification_required') is False and completed['output'].get('server_copy_verification')==summary)
    finalized=[e for e in events if e.get('phase')=='verification_completed' and e.get('operation_id')==args.get('verification_id')]
    check('final_verification_recorded',len(finalized)==1 and finalized[0].get('outcome')==result)
    check('verified_transfer_releases_pending',bool(after) and all(t['result'].get('output',{}).get('state')=='resolved'
          and t['result']['output'].get('operation_id')==upload_id
          and t['result']['output'].get('outcome')==completed
          and t['result']['output']['outcome'].get('output',{}).get('server_copy_verification')==summary for t in after))
    check('no_mutations_after_verification',not any(c['tool'] in mutations and c['row']>call['row'] for c in calls))
    return {'all_assertions_passed':all(c['passed'] for c in checks),'assertions':checks,'goal':'file-upload-verify',
            'destination':destination,'limitations':['Confirmed replace transfer satisfies exact destination byte postcondition. Reject/conflict and download budget remain open.']}
