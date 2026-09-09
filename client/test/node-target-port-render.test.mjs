import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createNodeTargetBrowserAdapter} from '../lib/node-target-browser.mjs';
function fixture(){
 class PackageTreeNode{};class WorkFlowTreeNode{};class ModelForm{};
 const request={document_id:'doc',workflow_ref:{workflow_id:'wf',prefix:'MF;TF-1',tab_tid:'tab',navigation_path:[{tid:'crumb',label:'Scenario'}]}};
 const element=tid=>({getAttribute:()=>tid,textContent:'Scenario',getBoundingClientRect:()=>({width:10,height:10}),classList:{contains:()=>true}});
 const tab=element('tab'),root=element('MF;TF-1;ModelForm;cmpDiagram'),body=element('MF;TF-1;Graph;Calc'),portDom=element('MF;TF-1;Graph;Calc;Output_Data-0'),crumb=element('crumb');
 root.contains=e=>e===body||e===portDom;root.querySelectorAll=()=>[];
 const port={FCell:{visible:true}},node={FGuid:'n',FIconCls:'bg-vendor-icon-calcdata',FCell:{geometry:{x:10,y:10}},FPorts:[{FCollection:[port]}]};
 let rendered=true;
 const graph={container:root,view:{getState:cell=>cell===node.FCell?{shape:{node:body}}:rendered?{shape:{node:portDom}}:null}};
 const model=Object.assign(new ModelForm(),{FCreateDraggedNodeStarted:false,FDraggingOverGraph:false,FDiagram:{FmxGraph:graph,FNodes:{FCollection:[node]}}});
 const packageNode=new PackageTreeNode(),workflowNode=Object.assign(new WorkFlowTreeNode(),{ParentNode:packageNode});
 const app={Version:'7.4.2',PackageTreeNode,WorkFlowTreeNode,ModelForm,Application:{FInstance:{FMainForm:{Items:{Workspace:{getActiveTab:()=>({Controller:{Node:{data:{node:workflowNode}},FController:model}})}}}}}};
 const document={querySelectorAll:selector=>selector.startsWith('[data-tid^=')?[crumb]:[tab,root,body,portDom].filter(e=>selector==='[data-tid='+JSON.stringify(e.getAttribute())+']')};
 const preparation={id:'doc',document,receipts:new Map([['p',{phase:'verified',workflowId:'wf',packageNode,tab}]])};
 const context=vm.createContext({document,location:{origin:'http://loginom.test'},bg:{app},__loginomDockPreparationV1:preparation,getComputedStyle:()=>({visibility:'visible'})});
 const page={evaluate:(fn,arg)=>vm.runInContext('('+fn.toString()+')('+JSON.stringify(arg)+')',context)};
 const adapter=createNodeTargetBrowserAdapter({origin:'http://loginom.test',build:'7.4.2',pinned:{},execute:code=>vm.runInNewContext('('+code+')',{...context})(page)});
 return {read:()=>adapter.observe(request,Date.now()+1000),hide:()=>{rendered=false;},port};
}
test('visible native port without a rendered identity cannot enter a complete graph checkpoint',async()=>{
 const f=fixture();assert.deepEqual(Array.from((await f.read()).nodes[0].outputs),[0]);
 f.hide();await assert.rejects(f.read(),/Visible port identity is not rendered/);
 f.port.FCell.visible=false;assert.deepEqual(Array.from((await f.read()).nodes[0].outputs),[]);
});
