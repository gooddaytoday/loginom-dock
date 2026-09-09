import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCalculatorParameters,resolveCalculatorPatch} from '../lib/calculator-parameters.mjs';
const expression=(name,index=0)=>({name,index,record_id:'r'+index,expression_id:String(index),label:'Same',type:'real',formula:'Amount * 2',replace:false,intermediate:false,cached:true,description:'Keep me'});
const observed=()=>({verified:true,inventory_complete:true,mode:'expression',expressions:[expression('A'),expression('B',1)]});
const inputs=[{name:'Amount',type:'real'}];
const request=()=>({target:{kind:'existing'},inputs:[],read:{ports:[0]},mappings:[]});
test('partial expression patch retains unrequested formulas, options, description and order',()=>{
 const before=observed(),p={expressions:[{target:{kind:'existing',name:'A'},formula:'Amount * 3'}]};
 validateCalculatorParameters(p,'expression',request());const r=resolveCalculatorPatch(p,before,inputs);
 assert.equal(r.expressions[0].formula,'Amount * 3');assert.equal(r.expressions[0].cached,true);
 assert.equal(r.expressions[0].description,'Keep me');assert.deepEqual(r.expressions[1],before.expressions[1]);
 assert.equal(before.expressions[0].formula,'Amount * 2');
});
test('replacement is resolved against input names and duplicate labels stay valid',()=>{
 const p={expressions:[{target:{kind:'new'},name:'Amount',label:'Same',type:'real',formula:'Amount / 3',replace:true}]};
 validateCalculatorParameters(p,'expression',request());const r=resolveCalculatorPatch(p,observed(),inputs);
 assert.equal(r.expressions.length,3);assert.equal(r.expressions[2].replace,true);
 assert.throws(()=>resolveCalculatorPatch(p,observed(),[]),/input field/);
});
test('explicit order is a complete permutation; omitted expressions are preserved',()=>{
 const p={expressions:[],order:['B','A']};assert.deepEqual(resolveCalculatorPatch(p,observed(),inputs).order,['B','A']);
 assert.throws(()=>resolveCalculatorPatch({...p,order:['A']},observed(),inputs),/every resulting/);
});
test('invalid input is refused before node changes',()=>{
 const cases=[{expressions:[{target:{kind:'new'},name:'N'}]},
  {expressions:[{target:{kind:'existing',name:'A'},type:'javascript'}]},
  {expressions:[{target:{kind:'existing',name:'A'},formula:'1\r2'}]},
  {expressions:[{target:{kind:'existing',name:'A'},formula:' '}]},
  {expressions:[{target:{kind:'existing',name:'A'}},{target:{kind:'existing',name:'a'}}]},
  {expressions:[],order:['A','a']},{expressions:[],unknown:true}];
 for(const p of cases)assert.throws(()=>validateCalculatorParameters(p,'expression',request()));
 assert.throws(()=>validateCalculatorParameters({expressions:[]},'javascript',request()));
 assert.throws(()=>resolveCalculatorPatch({expressions:[{target:{kind:'existing',name:'A'},name:'b'}]},observed(),inputs),/collides/);
 assert.throws(()=>resolveCalculatorPatch({expressions:[{target:{kind:'existing',name:'missing'}}]},observed(),inputs),/missing/);
});
test('only a pristine new-node default may be reused',()=>{
 const p={expressions:[{target:{kind:'new'},name:'Revenue',label:'Revenue',type:'real',formula:'Amount * 2',replace:false}]};
 const o=observed();o.expressions=[{...expression('Expr1'),formula:'',cached:false,description:''}];
 const r=resolveCalculatorPatch(p,o,inputs,{newNode:true});assert.equal(r.changes[0].reuse_default,true);assert.equal(r.expressions[0].record_id,'r0');
 o.expressions[0].formula='123';assert.throws(()=>resolveCalculatorPatch(p,o,inputs,{newNode:true}),/default expression changed/);
});
