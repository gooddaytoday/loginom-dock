import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGroupingInlineSources,verifyGroupingStaleRemoval,verifyGroupingAutosyncRestore} from '../lib/grouping-inline-mapping.mjs';
const configuration={keys:[{name:'Group',label:'Группа',type:'string'}],measures:[{name:'Amount',label:'Сумма',type:'real',functions:4}]};
function fixture(){
 const sources=[{record_id:'s0',name:'Group',label:'Группа',type:'string'},{record_id:'s1',name:'Amount',label:'Сумма|Минимум',type:'real'}];
 const fields=[...sources.map((s,i)=>({record_id:'t'+i,field_id:String(i),name:'Custom'+i,label:'Same',type:s.type,source:s,inherited:false,excluded:false,required:false})),{record_id:'old',field_id:'9',name:'PreviousMax',label:'Same',type:'real',source:null,inherited:false,excluded:false,required:false}].map((f,i)=>({...f,index:i,group_index:i}));
 const before={verified:true,inventory_complete:true,source_identity_verified:true,mapping_wizard:'DerivedDataSourceMappingEngineOutputPortWizard',node_context:{node_id:'owned'},autosync:false,source_fields:sources,target_fields:fields};
 const after={...structuredClone(before),target_fields:structuredClone(fields.slice(0,2))};return {before,after,field:fields[2]};
}
test('replacement identifies only the obsolete unbound output',()=>{
 const {before,after,field}=fixture();assert.deepEqual(validateGroupingInlineSources(configuration,before),[field]);assert.equal(verifyGroupingStaleRemoval(before,after,field),true);
});
test('removal refuses foreign ownership, changed surviving fields, replaced sources and wrong row',()=>{
 for(const mutate of [f=>{f.after.node_context.node_id='foreign';},f=>{f.after.target_fields[0].name='Changed';},f=>f.after.source_fields.pop(),f=>f.after.target_fields.reverse(),f=>{f.field.source=f.before.source_fields[1];},f=>{f.field.required=true;}]){
  const f=fixture();mutate(f);assert.throws(()=>verifyGroupingStaleRemoval(f.before,f.after,f.field));
 }
});
test('conditional mapping cannot conceal incompatible source types or excluded fields',()=>{
 const f=fixture();f.before.source_fields[1].type='integer';assert.throws(()=>validateGroupingInlineSources(configuration,f.before));
 const g=fixture();g.before.target_fields[0].excluded=true;assert.throws(()=>validateGroupingInlineSources(configuration,g.before));
});


test('autosync restoration permits regenerated record IDs but preserves each field ID and link',()=>{
 const {after}=fixture();const restored=structuredClone(after);restored.autosync=true;
 restored.target_fields.forEach((f,i)=>{f.record_id='fresh'+i;});
 assert.equal(verifyGroupingAutosyncRestore(after,restored,true),true);
 restored.target_fields[0].field_id='foreign';assert.throws(()=>verifyGroupingAutosyncRestore(after,restored,true));
});
