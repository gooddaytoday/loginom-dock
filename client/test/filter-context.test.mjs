import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFilterBrowser,readFilterContext} from '../lib/filter-context.mjs';
function fixture(){
 const root={id:'grid',checkVisibility:()=>true},model=data=>({isModel:true,internalId:String(++seq),data});let seq=0;
 const store=items=>({$className:'Ext.data.Store',getData:()=>({items}),getCount:()=>items.length,getProxy:()=>({$className:'bg.ext.CollectionProxy'})});
 const inputs=[model({RowNumberer:0,Value:'Id',Name:'Id',DisplayText:'Identifier',DataType:4}),model({RowNumberer:1,Value:'',DataType:4})];
 const data={Name:'Id',DataType:4,RowNumberer:0,RelationType:4,CaseSensitive:false,UseVariables:0,CompareValue:2,CompareValueList:[]};
 const rows=[model(data)],rs=store(rows),controller={FFilterItemsStore:rs,FColumnInfoStore:store(inputs)};
 const grid={$className:'bg.components.filterdata.view.FilterDataPanel',el:{dom:root},Controller:controller,getStore:()=>rs,getView:()=>({getNode:()=>null}),getSelectionModel:()=>({getSelection:()=>[]})};controller.FView=grid;
 const context={document:{querySelectorAll:()=>[root]},Ext:{getCmp:()=>grid},Date};
 return {data,rows,inputs,rs,grid,controller,read:()=>JSON.parse(JSON.stringify(vm.runInNewContext('('+readFilterBrowser.toString()+')("WF")',context)))};
}
test('filter reads the complete ordered local condition inventory and preserves exact values',()=>{
 const f=fixture();f.rows.push({isModel:true,internalId:'or',data:{IsOperatorRecord:true}});
 f.rows.push({isModel:true,internalId:'row',data:{...f.data,Name:'',RowNumberer:1,RelationType:8,CompareValueLowerBound:2,CompareValueUpperBound:4}});
 const r=f.read();assert.equal(r.verified,true);assert.deepEqual(r.rows.map(x=>x.kind),['condition','or','condition']);
 assert.deepEqual(r.rows[2].field,{kind:'row_number'});assert.equal(r.rows[2].upper,4);assert.equal(r.rows[0].value,2);
});
test('filter cached dates retain seconds and milliseconds without timezone conversion',()=>{
 const f=fixture();f.inputs[0].data.DataType=2;f.data.DataType=2;f.data.CompareValue=new Date(2024,1,29,23,59,58,123);
 assert.equal(f.read().rows[0].value,'2024-02-29T23:59:58.123');
});
test('persisted range, list and null conditions need only their active operands',()=>{
 for(const [code,operands,key,value] of [[8,{CompareValueLowerBound:2,CompareValueUpperBound:4},'upper',4],
  [10,{CompareValueList:[2,4]},'values',[2,4]],[6,{},'operator_code',6]]){
  const f=fixture();delete f.data.CompareValue;delete f.data.CompareValueList;Object.assign(f.data,{RelationType:code},operands);
  const result=f.read();assert.equal(result.verified,true);assert.deepEqual(result.rows[0][key],value);assert.equal('value' in result.rows[0],false);
 }
});
test('incomplete, foreign, variable and lossy filter models never produce verified configuration',()=>{
 for(const mutate of [f=>f.data.UseVariables=1,f=>f.data.DataType=6,f=>f.data.CompareValue=2**53,
  f=>f.rs.isSyncing=true,f=>f.controller.FView={},f=>f.controller.FFilterItemsStore={},
  f=>f.rows.push({...f.rows[0]}),f=>f.inputs.push({...f.inputs[0]}),
  f=>f.grid.editingPlugin={editing:true,context:{record:{},grid:f.grid,store:f.rs}},
  f=>f.rs.getData=()=>({items:f.rows,getSource:()=>({items:[...f.rows,{}]})})]){
  const f=fixture();mutate(f);assert.equal(f.read().verified,false);
 }
});
test('filter read refuses another node or port and detects owner change during read',async()=>{
 const owner={verified:true,surface:'wizard',node_id:'node'},page={evaluate:async()=>({verified:true})};
 for(const before of [{...owner,input_port:{port:0}},{...owner,output_port:{port:0}},{...owner,surface:'graph'}])
  assert.equal((await readFilterContext(page,{workflow_ref:{prefix:'WF'}},async()=>before)).verified,false);
 let count=0;const result=await readFilterContext(page,{workflow_ref:{prefix:'WF'}},async()=>({...owner,node_id:++count===1?'node':'other'}));
 assert.equal(result.verified,false);assert.equal(result.reason,'filter_node_changed');
});

test('1000 actual fields plus the native row number option are within the input limit',()=>{
 const f=fixture();
 for(let i=1;i<1000;i++)f.inputs.push({isModel:true,internalId:'input-'+i,data:{RowNumberer:0,Name:'Field'+i,Value:'Field'+i,DisplayText:'Field'+i,DataType:4}});
 const read=f.read();assert.equal(read.verified,true);assert.equal(read.input_fields.length,1000);
 f.inputs.push({isModel:true,internalId:'overflow',data:{RowNumberer:0,Name:'Overflow',Value:'Overflow',DisplayText:'Overflow',DataType:4}});
 assert.equal(f.read().verified,false);
 f.inputs.splice(1,1);assert.equal(f.read().verified,false,'1001 real fields without a helper remain out of bounds');
});
test('duplicate native row number helpers are rejected',()=>{
 const f=fixture();f.inputs.push({...f.inputs[1],internalId:'second-row-number'});
 assert.equal(f.read().verified,false);
});
