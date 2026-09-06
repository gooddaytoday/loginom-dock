"""Full P3 diagnostic: transfer proof is reusable; domain admission is fail-closed.

The full goal runs now so real UI failures guide implementation. Until an
independent typed settings/execution/result/reopen verifier exists, this module
cannot admit P3, even if every gesture or the model's final answer says success.
"""
from pathlib import Path
import upload_probe
import upload_verify
import json
import rendered_results
import settings_evidence
import import_settings_evidence
import import_roundtrip_evidence

FIXTURES = tuple('fixtures/data-pipeline/'+name for name in ('sales.csv','expected.json','task.txt'))
DOMAIN_GATES = ('wizard_settings_readback', 'calculator_expression_and_mappings',
                'group_keys_and_aggregations', 'fresh_execution_identity',
                'complete_typed_results', 'saved_reopened_settings', 'reexecution_results')


def prompt(template, package, directory, run_id):
    task=Path(__file__).with_name('fixtures').joinpath('data-pipeline/task.txt').read_text()
    return upload_probe.prompt(template,package,directory,run_id).replace('__PIPELINE_TASK__',task.strip())


def declared_source_path(request):
    """Resolve only the fixture declared before execution, never a model path."""
    try:
        descriptor = upload_probe.descriptor(request['run_id'], request['storage_directory'])
        if (request.get('input_artifact') != descriptor
                or request.get('harness_inputs', {}).get(upload_probe.FIXTURE) != upload_probe.FIXTURE_SHA):
            return None
        return descriptor['upload']['directory'] + '/' + descriptor['name']
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def audit(evidence, checks, request, prefix, mutations, storage_audit, rejected_before_browser):
    def check(name,value):checks.append({'name':name,'passed':bool(value)})
    calls,tools=evidence['calls'],evidence['tools']
    rejected=[]
    for call in calls:
        if call['tool'] in (prefix+'dock_artifact_upload',prefix+'dock_artifact_verify') and rejected_before_browser(call,evidence):
            rejected.append((call['session_id'],call['tool_call_id']))
    # Only proven pre-dispatch refusals are removed from the transfer attempt
    # count. Failed browser effects and ambiguous replies remain in the audit.
    evidence={**evidence,'calls':[c for c in calls if (c['session_id'],c['tool_call_id']) not in rejected],
              'tools':[t for t in tools if (t['session_id'],t['tool_call_id']) not in rejected]}
    calls,tools=evidence['calls'],evidence['tools']
    verifies=[c for c in calls if c['tool']==prefix+'dock_artifact_verify']
    uploads=[c for c in calls if c['tool']==prefix+'dock_artifact_upload']
    check('pipeline_exactly_one_upload_and_verify',len(uploads)==len(verifies)==1)
    transfer_passed=False
    if len(verifies)==len(uploads)==1:
        verify=verifies[0]
        later_mutations=[c['row'] for c in calls if c['tool'] in mutations and c['row']>verify['row']]
        boundary=min(later_mutations) if later_mutations else float('inf')
        inspections=[t for t in tools if verify['row']<t['row']<boundary
                     and t['tool']==prefix+'dock_operation_inspect'
                     and t.get('result',{}).get('output',{}).get('operation_id')==uploads[0].get('arguments',{}).get('operation_id')]
        check('transfer_inspected_before_pipeline_mutation',bool(inspections))
        if inspections:
            cutoff=inspections[0]['row']
            part={**evidence,'calls':[c for c in calls if c['row']<=cutoff],
                  'tools':[t for t in tools if t['row']<=cutoff]}
            transfer_checks=[]
            proof=upload_verify.audit(part,transfer_checks,request,prefix,mutations,storage_audit)
            transfer_passed=proof['all_assertions_passed']
            checks.extend({**c,'name':'transfer_'+c['name']} for c in transfer_checks)
    # Deliberate missing-verifier gates, not synthetic proof fields accepted from
    # model output. Implement each using native, pinned evidence before admission.
    for gate in DOMAIN_GATES:check('unimplemented_verifier_'+gate,False)
    return {'all_assertions_passed':False,'assertions':checks,'goal':request.get('goal_id','data-pipeline'),
            'acceptance_status':'diagnostic_only_domain_verifiers_incomplete',
            'rendered_result_diagnostics':rendered_results.diagnose(evidence,json.loads(Path(__file__).with_name('fixtures').joinpath('data-pipeline/expected.json').read_text()),prefix),
            'import_settings_diagnostics':import_settings_evidence.diagnose(evidence,json.loads(Path(__file__).with_name('fixtures').joinpath('data-pipeline/expected.json').read_text()),prefix,expected_source_path=declared_source_path(request)),
            'import_roundtrip_diagnostics':import_roundtrip_evidence.diagnose(evidence,json.loads(Path(__file__).with_name('fixtures').joinpath('data-pipeline/expected.json').read_text()),prefix,expected_source_path=declared_source_path(request)),
            'settings_roundtrip_diagnostics':settings_evidence.diagnose(evidence,json.loads(Path(__file__).with_name('fixtures').joinpath('data-pipeline/expected.json').read_text())['calculator'],prefix),
            'transfer_verified':transfer_passed,'pre_action_rejections':len(rejected),'missing_domain_verifiers':list(DOMAIN_GATES),
            'limitations':['Full P3 task requested; typed domain evidence audit is not implemented. No P3 acceptance claim is possible.']}
