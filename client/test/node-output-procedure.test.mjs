import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTableNumericFormat} from '../lib/node-output-procedure.mjs';
const integer={index:0,key:'Id',type:'integer'},real={index:2,key:'Amount',type:'real'};
const f=(target,custom=true)=>({source_index:target.index,name_key:target.key,...Object.fromEntries(Object.entries({formatting:true,custom,decimal_digits:'0',currency:'',thousands:false,scientific:false,format_string:target.type==='real'?'0.################E+00':'0'}).map(([k,value])=>[k,{status:'observed',value}]))});
test('numeric format readback accepts the native canonical integer representation',()=>{
 assert.equal(verifyTableNumericFormat(f(integer,false),integer).representation,'standard_integer');
 assert.equal(verifyTableNumericFormat(f(integer),integer).representation,'custom');
 assert.equal(verifyTableNumericFormat(f(real),real).mask,'0.################E+00');
});
for(const [name,change] of Object.entries({wrong_field:s=>s.source_index=4,wrong_key:s=>s.name_key='other',
 rounded:s=>s.format_string.value='0.00',disabled:s=>s.formatting.value=false,
 grouped:s=>s.thousands.value=true,currency:s=>s.currency.value='$',scientific:s=>s.scientific.value=true,
 decimals:s=>s.decimal_digits.value='2',unobserved:s=>s.custom.status='unobserved',
}))test('numeric readback refuses '+name,()=>{const s=f(integer,false);change(s);assert.throws(()=>verifyTableNumericFormat(s,integer));});
test('a standard real format cannot replace the explicit seventeen-digit mask',()=>assert.throws(()=>verifyTableNumericFormat(f(real,false),real)));

test('datetime readback requires its own field and explicit millisecond mask',async()=>{
 const {verifyTableDateTimeFormat}=await import('../lib/node-output-procedure.mjs');
 const target={index:1,key:'Moment',type:'datetime'},state={source_index:1,name_key:'Moment',formatting:{status:'observed',value:true},custom:{status:'observed',value:true},format_string:{status:'observed',value:'yyyy-mm-dd hh:nn:ss.zzz'}};
 assert.equal(verifyTableDateTimeFormat(state,target).precision,'millisecond');
 for(const change of [s=>s.source_index=0,s=>s.name_key='other',s=>s.custom.value=false,s=>s.formatting.value=false,s=>s.format_string.value='YYYY-MM-DD HH:mm:ss.SSS']) {
  const altered=structuredClone(state);change(altered);assert.throws(()=>verifyTableDateTimeFormat(altered,target));
 }
});
