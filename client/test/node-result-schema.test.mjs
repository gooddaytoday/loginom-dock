import test from 'node:test';
import assert from 'node:assert/strict';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {nodeApplyResultSchema,deliveryJobResultSchema} from '../lib/node-result-schema.mjs';
const provider=new AjvJsonSchemaValidator(),validate=provider.getValidator(nodeApplyResultSchema);
const result=()=>({operation_id:'op',status:'AMBIGUOUS',effect_possible:true,phases:[],node:null,
 execution:{status:'pending',execution_id:'process'},output:{status:'not_refreshed',evidence_ref:null,ports:[]},
 package_saved:false,cleanup_complete:false,warnings:[],pending_phase:'execute',error:{code:'UNKNOWN',message:'Await original receipt'}});
test('result schema preserves uncertainty and forbids claiming node-level package persistence',()=>{
 assert.equal(validate(result()).valid,true);
 for(const patch of [{package_saved:true},{persisted_package_verified:true},{pending_phase:'retry'},
  {execution:{status:'cancelled'}},{cleanup_complete:'yes'}])assert.equal(validate({...result(),...patch}).valid,false);
});
test('explicit workflow activation survives public result validation',()=>{
 const r=result();r.pending_phase='workflow';r.phases=[{phase:'workflow',receipt_id:'op:workflow',status:'verified',effect_possible:true}];
 assert.equal(validate(r).valid,true);
});
test('table output requires typed values, precision and bounded samples',()=>{
 const r=result();r.output={status:'complete',evidence_ref:'read',ports:[{port:0,port_guid:'p',fresh:true,execution_id:'e',
  schema:[{index:0,name:'Id',label:'Id',type:'integer'}],row_count:1,
  sample:[[{type:'integer',is_null:false,value:'9007199254740993',precision:'exact_integer',representation:'decimal_integer'}]],
  sample_rows:1,sample_complete:true,precision:{numbers_verified:true,limitations:[],strings:'UI text'}}]};
 assert.equal(validate(r).valid,true);
 const bad=structuredClone(r);delete bad.output.ports[0].sample[0][0].precision;assert.equal(validate(bad).valid,false);
 const long=structuredClone(r);long.output.ports[0].sample=Array(11).fill(r.output.ports[0].sample[0]);assert.equal(validate(long).valid,false);
});
test('delivery result distinguishes unresolved transfer from a worker or successful node',()=>{
 const check=provider.getValidator(deliveryJobResultSchema),r={operation_id:'delivery',state:'settled',phase:'verify',upload_operation_id:'delivery:upload',
  outcome:{status:'AMBIGUOUS',effect_possible:true},error:{code:'ARTIFACT_DELIVERY_INCOMPLETE',message:'Inspect original upload'}};
 assert.equal(check(r).valid,true);assert.equal(check({...r,state:'completed'}).valid,false);assert.equal(check(result()).valid,false);
});
test('calculator readback has its own public shape and cannot masquerade as text import or persistence',()=>{
 const r=result();r.configuration={status:'applied',readback:{kind:'calculator',input_mapping:{port:0,autosync:false,fields:[]},scope:'observed_before_verified_finish',node:{document_id:'d',workflow_id:'w',node_id:'n'},
 receipt_ids:['op:input_mapping','op:configure','op:node_finish','op:output_mapping','op:finish'],values_are:'observed_ui_values',mode:'expression',
 expressions:[{index:0,name:'R',label:'R',type:'real',formula:'A * 2',replace:false,intermediate:false,cached:false,description:''}],
 input_fields:[{name:'A',label:'A',type:'real'}],syntax_validation:'accepted_by_loginom_next',output_mapping:{port:0,autosync:true,fields:[{index:0,name:'R',label:'R',type:'real',data_kind:'Непрерывный',source_name:'R',excluded:false}]},package_persistence_verified:false}};
 assert.equal(validate(r).valid,true);
 for(const change of [v=>v.kind='text_import',v=>v.mode='javascript',v=>v.package_persistence_verified=true,v=>v.receipt_ids.pop(),v=>delete v.expressions[0].formula]){
  const invalid=structuredClone(r);change(invalid.configuration.readback);assert.equal(validate(invalid).valid,false);
 }
});
