import test from 'node:test';
import assert from 'node:assert/strict';
import {configureSorting} from '../lib/sorting-procedure.mjs';

function fixture({newNode=false,locale=true}={}) {
 const fields=[{name:'Amount',label:'Сумма',type:'real'},{name:'Name',label:'Имя',type:'string'}];
 const configuration={verified:true,input_fields:fields,keys:[{...fields[0],record_id:'a',order:0,direction:'ASC'}],selections:{selected:[]},options:{chkLocaleAware:{value:locale,switch_pressed:false},chkBufferWhole:{value:false},cbxMaxThreadCount:{value:0}}};
 const gestures=[];const flags={};
 const snapshot=()=>({wizard:{stage:'sorting',root_tid:'root'},node_sorting:structuredClone(configuration),ui:{elements:[
  ...configuration.keys.flatMap(k=>['field','direction'].map(part=>({ref:k.name+':'+part,tid:part,sorting_field:{field_key:k.name,record_id:k.record_id,role:'selected',part},allowed_actions:['click']}))),
  {ref:'locale',tid:'root;SortingWizard;SortingColumnCollection;chkLocaleAware;ValueControl;DisplayEl',allowed_actions:['set_checked']}
 ]}});
 const channel={observe:async()=>snapshot(),perform:async spec=>{
  const action=spec.resolve(snapshot());gestures.push(action);
  if(flags.failBeforeGesture)throw Error('ownership changed before gesture');
  if(action.ref==='locale')configuration.options.chkLocaleAware.value=action.checked;
  if(action.ref==='Amount:field')configuration.selections.selected=['a'];
  if(action.ref==='Amount:direction'&&!flags.lostChange)configuration.keys[0].direction='DESC';
  if(flags.changeCache)configuration.options.chkBufferWhole.value=true;
 }};
 return {configuration,flags,gestures,run:p=>configureSorting(channel,p,{newNode})};
}

test('existing empty parameters preserve observed keys and locale without toggles',async()=>{
 const f=fixture({locale:false});const r=await f.run({});assert.equal(r.configuration.options.chkLocaleAware.value,false);assert.deepEqual(f.gestures,[]);
});
test('explicit direction changes once and unrequested cache and threads remain unchanged',async()=>{
 const f=fixture();const r=await f.run({keys:[{field:{kind:'input_field',name:'Amount'},direction:'DESC'}],compare_with_locale:false});
 assert.equal(r.configuration.keys[0].direction,'DESC');assert.equal(r.configuration.options.chkBufferWhole.value,false);
 assert.equal(f.gestures.filter(g=>g.ref==='Amount:direction').length,1);assert.deepEqual(f.gestures.at(-1),{verb:'set_checked',ref:'locale',checked:false});
});
test('unknown field fails before any gesture',async()=>{
 const f=fixture();await assert.rejects(f.run({keys:[{field:{kind:'input_field',name:'Missing'},direction:'ASC'}]}),/missing/);assert.deepEqual(f.gestures,[]);
});
test('unconfirmed change never retries a blind direction toggle',async()=>{
 const f=fixture();f.flags.lostChange=true;await assert.rejects(f.run({keys:[{field:{kind:'input_field',name:'Amount'},direction:'DESC'}]}),/direction differs/);
 assert.equal(f.gestures.filter(g=>g.ref==='Amount:direction').length,1);
});
test('foreign ownership and changes to unrelated options cannot succeed',async()=>{
 for(const flag of ['failBeforeGesture','changeCache']){const f=fixture();f.flags[flag]=true;await assert.rejects(f.run({compare_with_locale:false}),/ownership|Unrequested/);}
});
test('new node uses explicit locale default and variable-driven locale fails closed',async()=>{
 const f=fixture({newNode:true,locale:false});await f.run({});assert.equal(f.gestures[0].checked,true);
 const g=fixture();g.configuration.options.chkLocaleAware.switch_pressed=true;await assert.rejects(g.run({}),/Variable-driven/);assert.deepEqual(g.gestures,[]);
});
