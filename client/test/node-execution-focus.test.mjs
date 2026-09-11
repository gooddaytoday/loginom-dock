import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeExecutionProcedure} from '../lib/node-execution-procedure.mjs';
const node={document_id:'doc',workflow_id:'flow',node_id:'node'};
const button='MF;cntMain;tlbMainToolbar;btnProgress',grid='ConsoleForm;ProgressForm;trpProgress;grd;tbl';
async function fixture({hide=true,replace=false,lost=false}={}){
 let opened=true,launched=false,selected=false,menu=false,shown=false;
 const actions=[],el=(tid,allowed_actions=['click'])=>({tid,ref:tid,allowed_actions});
 const state=()=>({prepared_node_context:{...node,verified:true,surface:'graph'},navigation_context:{status:'observed'},
  node_outputs:{verified:true,node_selected:shown},
  node_processes:{verified:opened,inventory_complete:true,show_completed:true,root_id:'root',node_context:{...node,verified:true},processes:launched?[
   {process_id:'1',record_id:'group',parent_id:null,state:'completed',error:false,children_loaded:true,expanded:true,rendered:true},
   {process_id:'1.1',record_id:replace&&shown?'replaced':'child',parent_id:'1',state:'completed',error:false,rendered:true,selected,process_tid:'child-row'}]:[]},
  ui:{elements:[el(button),...(opened?[el(grid,['right_click']),el('ConsoleForm;btnClose'),el('child-row',['right_click'])]:[]),
   ...(menu?[el('mnContextMenu;mniShowCompletedProcesses',['click','press']),el('mnContextMenu;mniShowNodeToProcess',['show_process_node'])]:[])]}});
 const channel={observe:async o=>{const s=state();assert.ok(o.ready(s),o.condition);return structuredClone(s);},perform:async o=>{
  const s=state();assert.ok(o.ready(s));o.identity(s);const a=o.resolve(s);actions.push(a);
  if(a.verb==='right_click'){menu=true;if(a.ref==='child-row')selected=true;}
  if(a.verb==='press')menu=false;
  if(a.verb==='show_process_node'){shown=true;opened=!hide;menu=false;if(lost)throw Error('lost Show reply');}
  if(a.ref===button)opened=true;
  if(a.ref==='ConsoleForm;btnClose')opened=false;
  return {status:'SUCCEEDED'};
 }};
 const driver=createNodeExecutionProcedure(channel,node);await driver.prepare();launched=true;await driver.identify();actions.length=0;
 return {driver,actions};
}
for(const hide of [false,true])test('completion verifies the same process after Show Node, hidden console: '+hide,async()=>{
 const f=await fixture({hide}),r=await f.driver.waitCompleted();assert.equal(r.execution_id,'doc:root:1');assert.equal(r.owner_verified,true);
 assert.equal(f.actions.filter(a=>a.ref===button).length,hide?1:0);
 assert.equal(f.actions.filter(a=>a.verb==='show_process_node').length,1);
 assert.equal(f.actions.some(a=>a.verb==='execute_graph_node'),false);
});
test('reopening cannot accept a replaced execution child',async()=>{
 const f=await fixture({replace:true});await assert.rejects(f.driver.waitCompleted(),/selected requested node process/);
 assert.equal(f.actions.filter(a=>a.ref===button).length,1);
});
test('unknown Show result never triggers another gesture',async()=>{
 const f=await fixture({lost:true});await assert.rejects(f.driver.waitCompleted(),/lost Show reply/);
 assert.deepEqual(f.actions.map(a=>a.verb),['right_click','show_process_node']);
});
