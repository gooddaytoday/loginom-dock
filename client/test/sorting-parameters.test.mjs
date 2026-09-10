import test from 'node:test';import assert from 'node:assert/strict';
import {validateSortingParameters,resolveSortingParameters} from '../lib/sorting-parameters.mjs';
const field=name=>({kind:'input_field',name}),req={target:{kind:'new'},inputs:[{input:0}],read:{ports:[0]},mappings:[],finish:'execute'};
const valid=()=>({keys:[{field:field('Amount'),direction:'DESC'},{field:field('Name'),direction:'ASC',case_sensitive:false}],compare_with_locale:false});
const schema=[{name:'Amount',label:'Same',type:'real'},{name:'Name',label:'Same',type:'string'}];
test('sorting binds exact names and preserves mixed priority despite equal labels',()=>{const p=valid();validateSortingParameters(p,'keys',req);assert.deepEqual(resolveSortingParameters(p,schema).map(f=>[f.name,f.direction,f.case_sensitive]),[['Amount','DESC',undefined],['Name','ASC',false]]);});
test('sorting refuses missing fields and requires explicit text comparison',()=>{const p=valid();assert.throws(()=>resolveSortingParameters(p,schema.slice(0,1)),/missing/);delete p.keys[1].case_sensitive;assert.throws(()=>resolveSortingParameters(p,schema),/case_sensitive/);p.keys[1].case_sensitive=true;p.keys[0].case_sensitive=false;assert.throws(()=>resolveSortingParameters(p,schema),/case_sensitive/);});
test('sorting validates complete replacement before effects',()=>{for(const change of [p=>p.keys=[],p=>p.keys.push(p.keys[0]),p=>delete p.keys[0].direction,p=>p.keys[0].direction='desc',p=>p.keys[0].field.kind='label',p=>p.compare_with_locale='false',p=>p.extra=true]){const p=valid();change(p);assert.throws(()=>validateSortingParameters(p,'keys',req));}});
test('sorting preserves existing keys but new nodes require keys',()=>{assert.throws(()=>validateSortingParameters({},'keys',req));assert.doesNotThrow(()=>validateSortingParameters({compare_with_locale:false},'keys',{...req,target:{kind:'existing'},inputs:[]}));assert.throws(()=>validateSortingParameters(valid(),'keys',{...req,inputs:[]}));});
test('sorting cancellation cannot commit input mapping',()=>assert.throws(()=>validateSortingParameters(valid(),'keys',{...req,finish:'close',mappings:[{direction:'input',port:0}]}),/Close/));
test('variant keys require an explicit case flag just like string keys',()=>{
 const p={keys:[{field:field('Mixed'),direction:'ASC'}]},fields=[{name:'Mixed',label:'Смешанный',type:'variant'}];
 assert.throws(()=>resolveSortingParameters(p,fields),/Explicit case_sensitive/);
 p.keys[0].case_sensitive=false;assert.equal(resolveSortingParameters(p,fields)[0].type,'variant');
});
