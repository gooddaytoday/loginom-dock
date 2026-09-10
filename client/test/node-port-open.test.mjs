import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {openPreparedOutputPort} from '../lib/node-port-open.mjs';

function fixture(direction='output') {
 class ModelForm{};class WizardTreeNode{};class ModelPortTreeNode{};class ModelOutputPortsTreeNode{};class ModelInputPortsTreeNode{};class ModelNodeTreeNode{};
 const prefix='MF;TF',elements=[],box={x:0,y:0,width:20,height:20};
 const el=tid=>{const e={tid,id:'element-'+elements.length,textContent:'',visible:true,scrollLeft:0,scrollTop:0,getAttribute:()=>tid,getBoundingClientRect:()=>box,
  checkVisibility:o=>o?.checkVisibilityCSS===true&&e.visible,contains:x=>x===e||x?.parent===e,
  closest:()=>null,classList:{contains:()=>true}};elements.push(e);return e;};
 const tab=el('tab'),root=el(prefix+';ModelForm;cmpDiagram'),nodeDom=el(prefix+';Graph;Node');nodeDom.parent=root;
 const portDom=el(nodeDom.tid+';'+(direction==='input'?'Input':'Output')+'_Data-0');portDom.parent=root;
 const menu=el('mn'),button=el('mn;mniConfigurePort');button.parent=menu;menu.visible=false;
 const wizardDom=el(prefix+';WizrdMCF');wizardDom.visible=false;
 const dialog=el(null);dialog.visible=false;dialog.innerText='Loginom 7.4.2 Настройка порта приведет к деактивации узла. Вы действительно хотите начать настраивать порт? Да Да, больше не спрашивать Нет';
 const confirmation=Object.fromEntries(Object.entries({yes:'Да',no:'Да, больше не спрашивать',cancel:'Нет'}).map(([key,label])=>{
  const e=el('msgbox;tlb;'+key);e.textContent=label;e.parent=dialog;return [key,e];
 }));
 const node={FGuid:'node',FCell:{},data:{},FLocked:false},port={FGuid:'port',FCell:{},FPortIndex:0,data:{},parent:node};node.FPorts=[{FCollection:[port]}];
 const graph=Object.assign(new ModelForm(),{FDiagram:{FNodes:{FCollection:[node]},FmxGraph:{container:root,
  view:{getState:c=>({shape:{node:c===node.FCell?nodeDom:portDom}})},getCellAt:()=>port.FCell}},FPortContextMenu:{el:{dom:menu}}});
 const workflow={},packageNode={},nodeTree=Object.assign(new ModelNodeTreeNode(),{ParentNode:workflow,FGuid:'node',FModelNode:node.data});
 const group=Object.assign(new (direction==='input'?ModelInputPortsTreeNode:ModelOutputPortsTreeNode)(),{ParentNode:nodeTree}),portTree=Object.assign(new ModelPortTreeNode(),{ParentNode:group,FIndex:0,FModelNodePort:port.data});
 const wizardTree=Object.assign(new WizardTreeNode(),{ParentNode:portTree});
 class WizardModelComponentForm{};const wizard=Object.assign(new WizardModelComponentForm(),{[direction==='input'?'FModelSocket':'FModelEnginePort']:{},FView:{el:{dom:wizardDom}}});
 const card={Controller:{FController:graph,Node:{data:{node:workflow}}}},flags={foreignMenu:false,foreignWizard:false,loading:0,deactivation:false},gestures=[];
 const document={querySelectorAll:q=>{
  if(q.startsWith('[data-tid=')){const t=JSON.parse(q.slice(10,-1));return elements.filter(e=>e.tid===t);}
  if(q.startsWith('[data-tid^=')){const t=JSON.parse(q.slice(11,-1));return elements.filter(e=>e.tid?.startsWith(t));}
  if(q==='[role="dialog"],.x-message-box')return dialog.visible?[dialog]:[];
  if(q==='.x-mask,.x-mask-msg,.bg-mask-message')return [];
  if(dialog.visible)return [dialog];
  if(flags.loading>0){flags.loading--;return [{checkVisibility:()=>true}];}return [];
 }};
 const prep={document,id:'doc',receipts:new Map([['prepare',{phase:'verified',workflowId:'flow',tab,packageNode,nodeTargetWorkflowNode:workflow}]])};
 const app={Version:'7.4.2',ModelForm,WizardTreeNode,ModelPortTreeNode,ModelOutputPortsTreeNode,ModelInputPortsTreeNode,ModelNodeTreeNode,Application:{FInstance:{FMainForm:{Items:{Workspace:{getActiveTab:()=>card}}}}}};
 menu.id='menu';const nativeControls=new Map([dialog,...Object.values(confirmation)].map(e=>[e.id,{el:{dom:e}}]));
 const context=vm.createContext({document,location:{origin:'http://example.test'},bg:{app},__loginomDockPreparationV1:prep,Ext:{getCmp:id=>nativeControls.get(id)??graph.FPortContextMenu}});
 const showWizard=()=>{menu.visible=false;dialog.visible=false;wizardDom.visible=true;card.Controller.FController=wizard;card.Controller.Node.data.node=wizardTree;if(flags.foreignWizard)portTree.FModelNodePort={};flags.loading=2;};
 const page={evaluate:(fn,arg)=>vm.runInContext('('+fn.toString()+')('+JSON.stringify(arg)+')',context),waitForTimeout:async()=>{},locator:selector=>{
  const tid=JSON.parse(selector.replace(/:visible$/, '').slice(10,-1));return {waitFor:async()=>{},click:async options=>{
   if(options?.trial){if(tid===confirmation.yes.tid)flags.beforeConfirm?.();return;}gestures.push(tid);
   if(tid===portDom.tid){menu.visible=true;graph.FCurrentPortMenu=flags.foreignMenu?{}:port;}
   else if(tid===button.tid){if(flags.deactivation){menu.visible=false;dialog.visible=true;}else showWizard();}
   else if(tid===confirmation.yes.tid){showWizard();if(flags.lostConfirmation)throw Error('Confirmation reply lost');}
   else throw Error('Unexpected gesture');
  }};
 }};
 const task={binding:{document_id:'doc',workflow_ref:{workflow_id:'flow',prefix,tab_tid:'tab'},node:{document_id:'doc',workflow_id:'flow',node_id:'node'}},
  direction,port:0,operation_id:'open',origin:'http://example.test',build:'7.4.2',deadline:Date.now()+20000};
 const readNode=async()=>({verified:true,surface:'graph',locked:false,node_id:'node'});
 const run=()=>openPreparedOutputPort(page,task,readNode);
 return {run,task,prep,flags,gestures,port,portDom,graph,node,wizard,card,menu,readNode,page,dialog,confirmation,nativeControls,document,el};
}

test('port opening binds menu and wizard native identities and replays without another gesture',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.status,'SUCCEEDED',r.error);assert.equal(r.port_guid,'port');
 assert.equal(f.gestures.length,2);assert.equal(r.trace.at(-1).event,'output_port_wizard_verified');
 const again=await f.run();assert.equal(again.status,'SUCCEEDED',again.error);assert.equal(again.replayed,true);assert.equal(f.gestures.length,2);
});
test('foreign menu stops before Configure and unresolved opening never repeats right click',async()=>{
 const f=fixture();f.flags.foreignMenu=true;const r=await f.run();assert.equal(r.status,'AMBIGUOUS');assert.equal(f.gestures.length,1);
 f.flags.foreignMenu=false;await f.run();assert.equal(f.gestures.length,1);
});
test('foreign port tree cannot become a successful opening receipt',async()=>{
 const f=fixture();f.flags.foreignWizard=true;const r=await f.run();assert.equal(r.status,'AMBIGUOUS');assert.equal(f.gestures.length,2);
 assert.equal(f.prep.outputPortOpenReceipts.get('open').phase,'open_issued');
});
test('unknown target and blocked graph cause no gesture',async()=>{
 for(const change of [f=>{f.task.port=1;},f=>{f.node.FLocked=true;},f=>{f.flags.loading=1;},f=>{f.menu.visible=true;}]){
  const f=fixture();change(f);const r=await f.run();assert.equal(r.status,'NOT_APPLIED',r.error);assert.equal(f.gestures.length,0);
 }
});
test('verified opening refuses a different wizard or a reused operation target',async()=>{
 const f=fixture();assert.equal((await f.run()).status,'SUCCEEDED');f.wizard.FModelEnginePort={};assert.equal((await f.run()).verified,false);assert.equal(f.gestures.length,2);
 f.task.port=1;assert.equal((await f.run()).verified,false);assert.equal(f.gestures.length,2);
});
test('pre-gesture reservation can be released after a no-effect refusal',async()=>{
 const f=fixture();const original=f.page.locator;let reject=true;
 f.page.locator=s=>{const loc=original(s);return {...loc,click:async options=>{if(reject&&options?.trial)throw Error('covered');return loc.click(options);}};};
 assert.equal((await f.run()).status,'NOT_APPLIED');assert.equal(f.prep.outputPortOpenReceipts.size,0);assert.equal(f.gestures.length,0);
 reject=false;assert.equal((await f.run()).status,'SUCCEEDED');assert.equal(f.gestures.length,2);
});

test('reopened ports may omit the lazy FPortIndex but must retain their native cell and tree index',async()=>{
 const f=fixture();delete f.port.FPortIndex;assert.equal((await f.run()).status,'SUCCEEDED');
 const wrong=fixture();wrong.port.FPortIndex=1;assert.equal((await wrong.run()).status,'NOT_APPLIED');assert.equal(wrong.gestures.length,0);
});

test('active port opening confirms its bound question once and replay performs no gestures',async()=>{
 const f=fixture();f.flags.deactivation=true;
 const result=await f.run();assert.equal(result.status,'SUCCEEDED',result.error);
 assert.deepEqual(f.gestures.slice(-1),['msgbox;tlb;yes']);assert.equal(f.gestures.length,3);
 assert.deepEqual(result.trace.map(t=>t.event),['output_port_reserved','output_port_menu_verified','output_port_deactivation_question_verified','output_port_deactivation_issued','output_port_wizard_verified']);
 assert.equal((await f.run()).status,'SUCCEEDED');assert.equal(f.gestures.length,3);
});

test('deactivation rechecks question, node, port, dialog and control before Yes',async()=>{
 const changes=[
  f=>{f.dialog.innerText=f.dialog.innerText.replace('порта','узла');},
  f=>{f.graph.FCurrentPortMenu={};},f=>{f.node.data={};},f=>{f.port.data={};},
  f=>{f.node.FLocked=true;},f=>{f.card.Controller.Node.data.node={};},
  f=>{f.confirmation.yes.textContent='Другой ответ';},
  f=>{f.nativeControls.get(f.confirmation.yes.id).disabled=true;},
  f=>{f.nativeControls.set(f.dialog.id,{el:{dom:f.dialog}});},
  f=>{f.dialog.visible=false;},
 ];
 for(const [i,change] of changes.entries()) {
  const f=fixture();f.flags.deactivation=true;f.flags.beforeConfirm=()=>change(f);
  const result=await f.run();assert.equal(result.status,'AMBIGUOUS',String(i));
  assert.equal(f.gestures.length,2,String(i));assert.equal(f.prep.outputPortOpenReceipts.get('open').phase,'open_issued');
 }
});

test('lost Yes response retains issued receipt and reconciles without another confirmation',async()=>{
 const f=fixture();f.flags.deactivation=true;f.flags.lostConfirmation=true;
 const first=await f.run();assert.equal(first.status,'AMBIGUOUS');assert.equal(f.gestures.length,3);
 assert.equal(f.prep.outputPortOpenReceipts.get('open').phase,'deactivation_issued');
 const second=await f.run();assert.equal(second.status,'SUCCEEDED',second.error);assert.equal(f.gestures.length,3);
});

test('input port binds its own group and socket without accepting the output engine port',async()=>{
 const f=fixture('input'),r=await f.run();assert.equal(r.status,'SUCCEEDED',r.error);assert.equal(r.direction,'input');
 assert.equal(f.prep.inputPortOpenReceipts.get('open').enginePort,f.wizard.FModelSocket);
 const again=await f.run();assert.equal(again.replayed,true);assert.equal(f.gestures.length,2);
 f.wizard.FModelEnginePort=f.wizard.FModelSocket;f.wizard.FModelSocket={};
 assert.equal((await f.run()).verified,false);assert.equal(f.gestures.length,2);
});
test('unresolved opposite-direction port opening prevents a new gesture',async()=>{
 const f=fixture('input');f.flags.foreignMenu=true;await f.run();
 f.task.direction='output';f.task.operation_id='another';f.flags.foreignMenu=false;
 const r=await f.run();assert.equal(r.status,'NOT_APPLIED');assert.equal(f.gestures.length,1);
});

for (const direction of ['input', 'output']) test(`${direction} port ignores hidden stale menus but rejects two visible menus`, async()=>{
 const f=fixture(direction),old=f.el('mn'),button=f.el('mn;mniConfigurePort');button.parent=old;old.visible=false;button.visible=false;
 assert.equal((await f.run()).status,'SUCCEEDED');assert.equal(f.gestures.length,2);
 const g=fixture(direction),duplicate=g.el('mn');duplicate.visible=false;
 const locate=g.page.locator;g.page.locator=s=>{const l=locate(s);return {...l,click:async o=>{await l.click(o);if(!o?.trial&&o?.button==='right')duplicate.visible=true;}};};
 assert.equal((await g.run()).status,'AMBIGUOUS');assert.equal(g.gestures.length,1);
});
