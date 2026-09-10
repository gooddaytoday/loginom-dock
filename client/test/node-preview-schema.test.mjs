import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readPreviewSchemaBrowser,readNodePreviewSchema} from '../lib/node-preview-schema.mjs';
function fixture(){
 const prefix='MF;TF-1',base=prefix+';ModelForm;PreviewWindow',all=[];
 function el(tid,parent=null){const e={id:'e'+all.length,tid,parent,checkVisibility:()=>true,getAttribute:()=>tid,
  contains(x){return x===this||!!x?.parent&&this.contains(x.parent);}};all.push(e);return e;}
 const root=el(base),dataRoot=el(base+';PreviewForm;DataSetForm',root),header=el(dataRoot.tid+';normalHeaderCt',dataRoot);
 const records=['Amount','Other'].map((name,i)=>({isModel:true,internalId:'r'+i,data:{Name:name,DisplayName:'Сумма',DataType:3}}));
 const store={$className:'Ext.data.Store',getCount:()=>records.length,getData:()=>({items:records,getSource:()=>({items:records})})};
 const columns=records.map(r=>({dataIndex:r.data.Name,text:r.data.DisplayName,el:{dom:el(header.tid+';'+r.data.Name,header)}}));
 const node={FGuid:'node',data:{}},port={FGuid:'port',parent:node,FType:1,FSubType:1,FPortIndex:0};
 node.FPorts=[{FCollection:[port]}];
 const data={FView:{el:{dom:dataRoot}},FModelNode:node.data,FColumnInfosStore:store};
 const form={constructor:{name:'PreviewForm'},FCurrentPreviewNode:node,FCurrentPreviewPort:port,FFormCache:{data}};
 const manager={constructor:{name:'PreviewModelFormManager'},FPreviewVisible:true,FPreviewWindow:{FView:{el:{dom:root}}},FPreviewForm:form,FShowDataLastCall:{Node:node,Port:port}};
 const binding={workflow_ref:{prefix},node:{node_id:'node'}};
 const context={document:{querySelectorAll:q=>{const tid=JSON.parse(q.slice('[data-tid='.length,-1));return all.filter(e=>e.tid===tid);}},
  Ext:{getCmp:id=>id===header.id?{el:{dom:header},items:{items:columns}}:null},
  bg:{app:{Application:{FInstance:{FMainForm:{Items:{Workspace:{getActiveTab:()=>({Controller:{FController:{FPreviewManager:manager}}})}}}}}}}};
 return {manager,form,data,root,store,records,columns,node,port,context,binding,read:()=>vm.runInNewContext('('+readPreviewSchemaBrowser.toString()+')(binding)',{...context,binding})};
}
test('preview schema uses exact native node, output port, cache and duplicate-label column identities',()=>{
 const f=fixture(),r=f.read();assert.equal(r.verified,true);assert.deepEqual(Array.from(r.fields,x=>x.name),['Amount','Other']);assert.equal(r.settings_changed,false);
});
test('foreign preview, stale cache, input port, partial schema and header drift cannot authorize grouping',()=>{
 for(const mutate of [f=>{f.node.FGuid='foreign';},f=>{f.port.parent={};},f=>{f.port.FType=0;},f=>{f.port.FPortIndex=1;},f=>{f.manager.FShowDataLastCall.Port={};},f=>{f.data.FModelNode={};},f=>{f.columns[0].text='Other';},f=>{f.store.getData=()=>({items:f.records.slice(0,1),getSource:()=>({items:f.records})});},f=>{f.form.FFormCache.extra=f.data;}]){
  const f=fixture();mutate(f);assert.equal(f.read().verified,false);
 }
});
test('ownership changes during cached preview read reject even an apparently valid schema',async()=>{
 const owner={verified:true,surface:'graph',node_id:'node'};let reads=0;
 const r=await readNodePreviewSchema({evaluate:async()=>({verified:true})},{},async()=>({...owner,node_id:++reads===1?'node':'other'}));
 assert.equal(r.verified,false);assert.equal(r.reason,'preview_owner_changed');
});

test('persisted sole output with no optional FPortIndex remains exactly bound',()=>{
 const f=fixture();delete f.port.FPortIndex;assert.equal(f.read().verified,true);
 f.node.FPorts[0].FCollection.push({...f.port});assert.equal(f.read().verified,false);
});
