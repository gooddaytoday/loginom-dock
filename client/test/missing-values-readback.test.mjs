import test from 'node:test';import assert from 'node:assert/strict';
import {missingValuesConfigurationReadback as readback} from '../lib/missing-values-readback.mjs';
function fixture(){
 const node={document_id:'d',workflow_id:'w',node_id:'n'},owner={...node,verified:true};
 const source={record_id:'s',name:'Amount',label:'Amount',type:'real'},field={index:0,name:'Amount',label:'Amount',type:'real',data_kind:'Непрерывный'};
 const input={verified:true,inventory_complete:true,node_context:{...owner,input_port:{port:0}},source_fields:[source],target_fields:[{...field,source}]};
 const output={...input,source_identity_verified:true,node_context:{...owner,output_port:{port:0}},target_fields:[{...field,excluded:false,source}]};
 const configuration={verified:true,inventory_complete:true,node_context:owner,input_fields:[field],fields:[{...field,used:true,method:'mean',method_code:3}],ordered:false,max_nulls_percent:100,options:{pedUseQuality:{value:false,switch_pressed:false},pedOrderedSample:{value:false,switch_pressed:false},pedMaxNullsPercent:{value:100,switch_pressed:false}}};
 const value={input_mapping:{native_mapping:input,finish:{settings_applied:true}},configure:{configuration,validation:{status:'accepted_by_loginom_next',node_context:owner}},node_finish:{settings_applied:true,mode:'done',node_context:owner},output_mapping:{native_mapping:output,finish:{settings_applied:true}},finish:{settings_applied:true,mode:'execute',node_context:owner}};
 return {node,operation_id:'op',phases:Object.entries(value).map(([phase,v])=>({phase,receipt_id:'op:'+phase,status:'verified',value:{verified:true,cleanup_complete:true,...v}}))};
}
test('missing values readback reports observed threshold and method without persistence or mean claims',()=>{const r=readback(fixture());assert.equal(r.max_nulls_percent,100);assert.equal(r.fields[0].method,'mean');assert.equal(r.package_persistence_verified,false);assert.equal(Object.hasOwn(r,'mean'),false);});
test('missing values refuses mismatched owners, receipts, methods and incomplete processing coverage',()=>{
 for(const mutate of [f=>f.phases[1].value.configuration.node_context={verified:true,node_id:'foreign'},f=>f.phases[1].receipt_id='old:configure',f=>f.phases[1].value.configuration.fields[0].method_code=6,f=>f.phases[1].value.configuration.fields[0].method='median',f=>f.phases[1].value.configuration.fields=[],f=>f.phases[1].value.configuration.max_nulls_percent=101,f=>f.phases[1].value.configuration.options.pedMaxNullsPercent.value=99,f=>f.phases[1].value.configuration.options.pedMaxNullsPercent.switch_pressed=true,f=>f.phases[2].value.settings_applied=false,f=>f.phases.push(f.phases[1])]){const f=fixture();mutate(f);assert.throws(()=>readback(f));}
});
