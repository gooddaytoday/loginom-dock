import test from 'node:test';
import assert from 'node:assert/strict';
import {returnToExecutedWorkflow} from '../lib/node-execution-procedure.mjs';
const node={document_id:'doc',workflow_id:'flow',node_id:'node'};
const fixture=()=>{
 const path=[{tid:'workflow',label:'Сценарий'},{tid:'workflow>Import',label:'Import'}];
 let state={prepared_node_context:{...node,verified:true,surface:'graph',tid:'MF;TF-1;Graph;Import'},
  navigation_context:{status:'unobserved'},node_context:{status:'observed',kind:'node',node:path[1],path},
  ui:{elements:[{tid:'workflow',label:'Сценарий',ref:'ui-flow',allowed_actions:['click']}]}};
 const actions=[];
 const channel={observe:async options=>{assert.equal(options.readNavigation,true);assert.equal(options.ready(state),true);return structuredClone(state);},
  perform:async options=>{assert.equal(options.ready(state),true);actions.push(options.resolve(state));state={...state,navigation_context:{status:'observed',path:path.slice(0,1)}};}};
 return {state,channel,actions};
};
test('execution restores its parent scenario with one observed breadcrumb click',async()=>{
 const f=fixture();await returnToExecutedWorkflow(f.channel,node);assert.deepEqual(f.actions,[{verb:'click',ref:'ui-flow'}]);
});
test('execution already at the scenario does not add a navigation gesture',async()=>{
 const f=fixture();f.state.navigation_context={status:'observed'};await returnToExecutedWorkflow(f.channel,node);assert.deepEqual(f.actions,[]);
});
test('a foreign node breadcrumb cannot be used as an execution return path',async()=>{
 const f=fixture();f.state.node_context.node={tid:'workflow>Foreign',label:'Foreign'};
 await assert.rejects(returnToExecutedWorkflow(f.channel,node),/does not belong/);assert.deepEqual(f.actions,[]);
});

test('offscreen process is revealed through its bound console owner without executing or selecting another row',async()=>{
 const {revealExecutionControl}=await import('../lib/node-execution-procedure.mjs');
 const process={process_id:'5.1',record_id:'new'},tid='process-new';let top=0;
 const state=()=>({prepared_node_context:{...node,verified:true},node_processes:{verified:true,root_id:'root',processes:[process]},
  ui:{elements:[{tid:'ConsoleForm;ProgressForm;trpProgress;treepanel;tree',ref:'scroll',process_grid:{grid_id:'tree'},scroll:{ref:'scroll',top,max_top:87},allowed_actions:['scroll']},
    ...(top===87?[{tid,ref:'new-row',allowed_actions:['right_click']}]:[])]}});
 const calls=[];const channel={perform:async o=>{assert.ok(o.ready(state()));const a=o.resolve(state());calls.push(a);top+=a.delta_y;},
  observe:async o=>{assert.ok(o.ready(state()));return state();}};
 const result=await revealExecutionControl(channel,node,state(),process,tid,'right_click');
 assert.deepEqual(calls,[{verb:'scroll',ref:'scroll',delta_y:87}]);assert.equal(result.ui.elements.at(-1).ref,'new-row');
});

test('process reveal refuses foreign process identity and an exhausted scroll range',async()=>{
 const {revealExecutionControl}=await import('../lib/node-execution-procedure.mjs');
 for(const foreign of [false,true]){
  const process={process_id:'5',record_id:'target'};
  const state={prepared_node_context:{...node,verified:true},node_processes:{verified:true,root_id:'r',processes:[{...process,record_id:foreign?'other':'target'}]},
   ui:{elements:[{tid:'ConsoleForm;ProgressForm;trpProgress;treepanel;tree',ref:'scroll',process_grid:{grid_id:'tree'},scroll:{ref:'scroll',top:0,max_top:0},allowed_actions:['scroll']}]}};
  const channel={perform:async()=>assert.fail('must not mutate')};
  await assert.rejects(revealExecutionControl(channel,node,state,process,'offscreen'),/identity changed|complete scroll range/);
 }
});

test('virtual process identity becomes available only after revealing its exact cached record',async()=>{
 const {revealExecutionControl}=await import('../lib/node-execution-procedure.mjs');
 const process={process_id:'20',record_id:'cached20'};let top=0;
 const state=()=>({prepared_node_context:{...node,verified:true},node_processes:{verified:true,root_id:'root',processes:[{...process,process_tid:top===87?'native20':null}]},
  ui:{elements:[{tid:'ConsoleForm;ProgressForm;trpProgress;treepanel;tree',ref:'scroll',process_grid:{grid_id:'tree'},scroll:{ref:'scroll',top,max_top:87},allowed_actions:['scroll']},
   ...(top===87?[{tid:'native20',ref:'row20',allowed_actions:['click']}]:[])]}});
 const calls=[],channel={perform:async o=>{assert.ok(o.ready(state()));const a=o.resolve(state());calls.push(a);top+=a.delta_y;},observe:async o=>{assert.ok(o.ready(state()));return state();}};
 const resolved=await revealExecutionControl(channel,node,state(),process,s=>s.node_processes.processes.find(p=>p.record_id===process.record_id)?.process_tid);
 assert.deepEqual(calls,[{verb:'scroll',ref:'scroll',delta_y:87}]);assert.equal(resolved.node_processes.processes[0].process_tid,'native20');
});
