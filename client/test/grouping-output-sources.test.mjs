import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGroupingSourceFetch} from '../lib/grouping-output-sources.mjs';
function fixture(){const source={record_id:'s',field_id:'0',name:'Amount',label:'Сумма',type:'real'};
 const before={source_fields:[],target_fields:[{record_id:'old',field_id:'9',index:0,name:'Renamed',label:'Показатель',type:'real',source:null}],node_context:{node_id:'owned'},autosync:false};
 const after={...structuredClone(before),inventory_complete:true,source_fields:[source]};after.target_fields[0].record_id='new';after.target_fields[0].source=source;return {before,after};}
test('schema retrieval binds retained renamed output without changing its persistent identity',()=>{
 const {before,after}=fixture();assert.equal(verifyGroupingSourceFetch(before,after),true);
});
test('schema retrieval refuses node, autosync, layout, field identity and null-link drift',()=>{
 for(const mutate of [f=>{f.after.node_context.node_id='foreign';},f=>{f.after.autosync=true;},f=>{f.after.target_fields[0].field_id='0';},f=>{f.after.target_fields[0].type='string';},f=>{f.after.target_fields[0].source=null;},f=>f.after.target_fields.pop()]){
  const f=fixture();mutate(f);assert.throws(()=>verifyGroupingSourceFetch(f.before,f.after));
 }
});
