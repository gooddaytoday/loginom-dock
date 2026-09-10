import {NodeReadinessTimeout} from './node-procedure.mjs';
import {captureExecutionBaseline,identifyNewExecution,verifyCompletedExecution,selectExecutionChild,expectedExecutionStopProof,verifyCancelledExecution} from './node-execution-evidence.mjs';

const requireValue=(v,m)=>{if(!v)throw new Error(m);};
const one=(xs,message)=>{requireValue(xs.length===1,message);return xs[0];};
const button='MF;cntMain;tlbMainToolbar;btnProgress';
const grid='ConsoleForm;ProgressForm;trpProgress;grd;tbl';
const filter='mnContextMenu;mniShowCompletedProcesses';
const showNode='mnContextMenu;mniShowNodeToProcess';

export async function returnToExecutedWorkflow(channel,node) {
  const sameNode=s=>s.prepared_node_context?.verified===true&&s.prepared_node_context.surface==='graph'
    &&['document_id','workflow_id','node_id'].every(k=>s.prepared_node_context[k]===node[k]);
  let s=await channel.observe({condition:'executed node navigation available',readNavigation:true,ready:s=>sameNode(s)
    &&(s.navigation_context?.status==='observed'||s.node_context?.status==='observed')});
  if(s.navigation_context?.status==='observed')return;
  const context=s.node_context,path=context.path?.slice(0,-1);
  requireValue(context.kind==='node'&&path?.length&&context.node?.tid===path.at(-1).tid+'>'
    +s.prepared_node_context.tid.split(';Graph;')[1],'Execution navigation does not belong to the prepared node');
  const workflow=path.at(-1),identity=()=>({node,path});
  await channel.perform({condition:'return from executed node to its scenario',initialObservation:s,
    ready:s=>sameNode(s)&&JSON.stringify(s.node_context?.path)===JSON.stringify(context.path)
      &&s.ui.elements.filter(e=>e.tid===workflow.tid&&e.label===workflow.label&&e.allowed_actions.includes('click')).length===1,
    identity,resolve:s=>({verb:'click',ref:one(s.ui.elements.filter(e=>e.tid===workflow.tid&&e.label===workflow.label),'Scenario breadcrumb unavailable').ref})});
  await channel.observe({condition:'executed scenario navigation restored',readNavigation:true,ready:s=>sameNode(s)
    &&s.navigation_context?.status==='observed'&&JSON.stringify(s.navigation_context.path)===JSON.stringify(path.map(({tid,label})=>({tid,label})))});
}

// Private, host-owned driver. All gestures use the existing operation gate,
// opaque UI references, pre-gesture epoch guards and durable step receipts.
// A caller never supplies selectors or a sequence of browser instructions.
export async function revealExecutionControl(channel,node,initial,process,tid,verb='click') {
  let state=initial,reset=false;
  const root=initial.node_processes?.root_id;
  const matches=s=>s.ui.elements.filter(e=>e.tid===(typeof tid==='function'?tid(s):tid)&&e.allowed_actions.includes(verb));
  const valid=s=>s.prepared_node_context?.verified===true
    &&['document_id','workflow_id','node_id'].every(k=>s.prepared_node_context[k]===node[k])
    &&s.node_processes?.verified===true&&s.node_processes.root_id===root
    &&s.node_processes.processes.some(p=>p.process_id===process.process_id&&p.record_id===process.record_id);
  for(let count=0;count<32;count++) {
    requireValue(valid(state),'Process identity changed while revealing its control');
    if(matches(state).length===1)return state;
    requireValue(matches(state).length===0,'Process control is ambiguous');
    const owners=state.ui.elements.filter(e=>e.tid==='ConsoleForm;ProgressForm;trpProgress;treepanel;tree'
      &&e.process_grid&&e.scroll?.ref===e.ref&&e.allowed_actions.includes('scroll'));
    const owner=one(owners,'Bound process scroll owner unavailable');
    if(!reset&&owner.scroll.top===0)reset=true;
    const delta=reset?Math.min(1000,owner.scroll.max_top-owner.scroll.top):-Math.min(1000,owner.scroll.top);
    requireValue(delta!==0,'Process control unavailable within complete scroll range');
    const previousTop=owner.scroll.top,gridId=owner.process_grid.grid_id;
    await channel.perform({condition:'reveal exact process control',initialObservation:state,
      ready:s=>valid(s)&&s.ui.elements.some(e=>e.ref===owner.ref&&e.process_grid?.grid_id===gridId
        &&e.scroll?.ref===e.ref&&e.scroll.top===previousTop&&e.allowed_actions.includes('scroll')),
      resolve:()=>({verb:'scroll',ref:owner.ref,delta_y:delta}),
      identity:()=>({node,process_id:process.process_id,record_id:process.record_id,root_id:root,grid_id:gridId})});
    state=await channel.observe({condition:'process list moved for the same process',readProcesses:true,
      ready:s=>valid(s)&&s.ui.elements.some(e=>e.process_grid?.grid_id===gridId&&e.scroll?.ref===e.ref
        &&(delta>0?e.scroll.top>previousTop:e.scroll.top<previousTop))});
  }
  throw new Error('Process reveal exceeded bounded scroll steps');
}

export function createNodeExecutionProcedure(channel,node) {
  let baseline,execution,stopPromise,launchAttempted=false;
  const observe=(condition,ready=()=>true,extra={})=>channel.observe({condition,readProcesses:true,ready,...extra});
  const control=(s,tid,verb='click')=>s.ui.elements.filter(e=>e.tid===tid&&e.allowed_actions.includes(verb));
  const act=async(s,tid,verb='click',identity=()=>node,key)=>channel.perform({condition:'execution control '+tid,
    initialObservation:s,ready:s=>control(s,tid,verb).length===1,
    resolve:s=>({verb,ref:one(control(s,tid,verb),'Unique execution control required').ref,...(key?{key}:{})}),identity});
  const consoleVisible=s=>s.ui.elements.some(e=>e.tid===grid);
  async function openConsole() {
    let s=await observe('prepared node available for process console');
    if(!consoleVisible(s)) {await act(s,button);s=await observe('process console visible',consoleVisible);}
    return s;
  }
  async function closeConsole(s) {
    if(consoleVisible(s))await act(s,'ConsoleForm;btnClose');
    return observe('process console closed',s=>!consoleVisible(s));
  }
  const processes=s=>s.node_processes?.verified===true&&s.node_processes.show_completed===true;
  async function revealChildren(s,group) {
    // A cached process can be complete while its virtualized row is offscreen.
    // Reveal the exact record before requiring its painted expander identity.
    if(group.rendered!==true){
      const current=state=>state.node_processes?.processes.find(p=>p.process_id===group.process_id&&p.record_id===group.record_id);
      s=await revealExecutionControl(channel,node,s,group,state=>current(state)?.process_tid);
      group=current(s);requireValue(group?.rendered===true,'Execution group did not become visible');
    }
    if(group.expanded!==true) {
      requireValue(group.expander_tid,'Execution group expander must be identified');
      s=await revealExecutionControl(channel,node,s,group,group.expander_tid);
      await act(s,group.expander_tid,'click',s=>{
        const g=s.node_processes?.processes?.find(p=>p.process_id===group.process_id&&p.record_id===group.record_id);
        requireValue(g?.expanded!==true&&g.rendered===true,'Execution group changed before expansion');
        return {node,process_id:g.process_id,record_id:g.record_id};
      });
    }
    return observe('execution child processes loaded',s=>processes(s)&&s.node_processes.processes.some(p=>
      p.process_id===group.process_id&&p.record_id===group.record_id&&p.children_loaded===true&&p.expanded===true));
  }
  return Object.freeze({
    async prepare() {
      requireValue(!baseline,'Execution baseline has already been captured');
      let s=await openConsole();
      // Opening the native menu establishes the filter's actual cached state,
      // including an empty history. Never clear or delete earlier processes.
      await act(s,grid,'right_click');
      s=await observe('completed process filter observed',s=>s.node_processes?.verified===true&&control(s,filter).length===1);
      if(!s.node_processes.show_completed) {
        await act(s,filter);s=await observe('completed process history loaded',processes);
      } else {
        await act(s,filter,'press',()=>node,'Escape');s=await observe('completed process menu closed',processes);
      }
      baseline=captureExecutionBaseline(s.node_processes,node);
      await closeConsole(s);
      return structuredClone(baseline);
    },
    async launchGraph() {
      requireValue(baseline&&!execution&&!launchAttempted,'A prepared, not-yet-launched graph execution is required');
      const same=s=>s.prepared_node_context?.verified===true&&s.prepared_node_context.surface==='graph'
        &&s.prepared_node_context.locked===false&&['document_id','workflow_id','node_id'].every(k=>s.prepared_node_context[k]===node[k])
        &&s.wizard?.status==='absent'&&s.node_outputs?.verified===true;
      let s=await channel.observe({condition:'configured graph node ready for execution',readOutputs:true,ready:same});
      if(!s.node_outputs.node_selected) {
        const tid=s.prepared_node_context.tid;
        await channel.perform({condition:'select the configured node for execution',initialObservation:s,
          ready:s=>same(s)&&s.ui.elements.some(e=>e.tid===tid&&e.graph_node?.part==='body'&&e.allowed_actions.includes('click')),
          resolve:s=>({verb:'click',ref:one(s.ui.elements.filter(e=>e.tid===tid&&e.graph_node?.part==='body'),'Exact graph body required').ref}),identity:()=>({node})});
      }
      const launch=s=>s.ui.elements.filter(e=>e.graph_execution?.node_id===node.node_id&&e.allowed_actions.includes('execute_graph_node'));
      s=await channel.observe({condition:'native execution control for selected node',readOutputs:true,
        ready:s=>same(s)&&s.node_outputs.node_selected&&launch(s).length===1});
      // Never repeat an issued or uncertain launch in this driver instance.
      launchAttempted=true;
      const result=await channel.perform({condition:'execute the configured graph node',initialObservation:s,
        ready:s=>same(s)&&s.node_outputs.node_selected&&launch(s).length===1,
        resolve:s=>({verb:'execute_graph_node',ref:one(launch(s),'Unique native execution control required').ref}),
        identity:s=>({node,launch:one(launch(s),'Unique native execution control required').graph_execution})});
      return {verified:true,launch_gesture_verified:true,execution_completed:false,receipt:result};
    },
    async identify() {
      requireValue(baseline&&!execution,'A pre-launch baseline without an identified execution is required');
      await openConsole();
      const s=await observe('one new node execution group',s=>{
        if(!processes(s))return false;
        const old=new Set(baseline.roots.map(p=>p.process_id));
        return s.node_processes.processes.some(p=>p.parent_id===null&&!old.has(p.process_id));
      });
      execution=identifyNewExecution(baseline,s.node_processes);
      return structuredClone(execution);
    },
    stop() {
      // Even an unknown receipt or failed terminal wait must not cause a
      // second cancel gesture on another call. Recovery inspects this execution.
      if(stopPromise)return stopPromise;
      requireValue(execution,'An identified execution is required');
      stopPromise=(async()=>{
        let s=await openConsole();
        requireValue(processes(s)&&s.node_processes.root_id===execution.root_id,'Stop process root changed');
        const group=one(s.node_processes.processes.filter(p=>p.parent_id===null&&p.process_id===execution.group_id
          &&p.record_id===execution.group_record_id),'Stop execution group replaced');
        s=await revealChildren(s,group);
        const target=expectedExecutionStopProof(execution,s.node_processes);
        const child=one(s.node_processes.processes.filter(p=>p.record_id===target.record_id),'Stop child replaced');
        s=await revealExecutionControl(channel,node,s,child,child.process_tid,'right_click');
        const sameTarget=s=>JSON.stringify(expectedExecutionStopProof(execution,s.node_processes))===JSON.stringify(target);
        await channel.perform({condition:'open exact cancellable process menu',initialObservation:s,
          ready:s=>sameTarget(s)&&control(s,child.process_tid,'right_click').length===1,
          resolve:s=>({verb:'right_click',ref:one(control(s,child.process_tid,'right_click'),'Stop process row unavailable').ref}),
          identity:()=>({node,...target})});
        const cancel=s=>control(s,'mnContextMenu;mniCancel','cancel_process').filter(e=>
          JSON.stringify(e.process_menu?.cancellation)===JSON.stringify(target));
        s=await observe('native owner-bound process cancel available',s=>sameTarget(s)&&cancel(s).length===1);
        const proof=structuredClone(one(cancel(s),'Native stop proof unavailable').process_menu.cancellation);
        await channel.perform({condition:'cancel exact node execution',initialObservation:s,
          ready:s=>sameTarget(s)&&cancel(s).length===1,
          resolve:s=>({verb:'cancel_process',ref:one(cancel(s),'Native stop control changed').ref}),
          identity:()=>({node,...proof})});
        s=await observe('same node execution terminal after cancel',s=>{
          requireValue(processes(s)&&s.node_processes.root_id===execution.root_id,'Stop process root changed');
          const group=s.node_processes.processes.find(p=>p.process_id===execution.group_id&&p.record_id===execution.group_record_id);
          const child=s.node_processes.processes.find(p=>p.process_id===proof.process_id&&p.record_id===proof.record_id);
          requireValue(group&&child,'Stopped process records replaced');
          return [group,child].every(p=>p.progress_state?.verified===true&&p.progress_state.terminal===true);
        });
        const receipt=verifyCancelledExecution(execution,s.node_processes,proof);
        await closeConsole(s);
        return {...receipt,cleanup_complete:true};
      })();
      return stopPromise;
    },
    async waitCompleted({signal,stopSignal}={}) {
      requireValue(execution,'An identified execution is required');
      let s;
      const condition='new node execution completed';
      // A bounded read window is not the execution deadline. Continue observing
      // the same group; the channel retains total budget, signal and step limits.
      for(;;) {
        try {
          s=await observe(condition,s=>{
            signal?.throwIfAborted();
            if(processes(s)) {
              requireValue(s.node_processes.root_id===execution.root_id,'Execution process root changed');
              const group=s.node_processes.processes.find(p=>p.parent_id===null&&p.process_id===execution.group_id
                &&p.record_id===execution.group_record_id);
              requireValue(group,'Execution group replaced while waiting');
              if(group.state==='completed'&&group.error===false)return true;
              if(group.progress_state?.verified===true&&group.progress_state.terminal===true)
                throw Error('Node execution ended without success: '+group.progress_state.state);
            }
            stopSignal?.throwIfAborted();
            return false;
          });
          break;
        } catch(error) {
          // Only this loop is read-only. Once ownership/console gestures begin,
          // interruption must retain an unresolved phase until reconciled.
          if(signal?.aborted&&error===signal.reason&&!stopSignal?.aborted) {
            const interrupted=new Error(String(error.message??error));
            interrupted.nodeExecutionWaitPause={execution_id:execution.execution_id,
              read_only:true,cleanup_complete:true};
            throw interrupted;
          }
          if(!(error instanceof NodeReadinessTimeout)||error.condition!==condition)throw error;
        }
      }
      const group=one(s.node_processes.processes.filter(p=>p.process_id===execution.group_id&&p.record_id===execution.group_record_id),'Execution group replaced');
      s=await revealChildren(s,group);
      const child=selectExecutionChild(execution,s.node_processes);
      s=await revealExecutionControl(channel,node,s,child,child.process_tid,'right_click');
      await act(s,child.process_tid,'right_click',s=>{
        requireValue(s.node_processes.processes.some(p=>p.process_id===child.process_id&&p.record_id===child.record_id&&p.rendered),'Process row changed');
        return {node,process_id:child.process_id,record_id:child.record_id};
      });
      s=await observe('Show Node available for the new process',s=>processes(s)&&control(s,showNode,'show_process_node').length===1
        &&s.node_processes.processes.filter(p=>p.selected).length===1&&s.node_processes.processes.some(p=>p.selected&&p.record_id===child.record_id));
      await act(s,showNode,'show_process_node',s=>({node,process_id:child.process_id,record_id:child.record_id,
        selected:s.node_processes.processes.filter(p=>p.selected).map(p=>p.record_id)}));
      s=await observe('new process selects the prepared graph node',s=>processes(s)&&s.node_outputs?.verified===true
        &&s.node_outputs.node_selected===true&&s.prepared_node_context.surface==='graph',{readOutputs:true});
      const receipt=verifyCompletedExecution(execution,s.node_processes,{verified:true,process_id:child.process_id,record_id:child.record_id,
        node_selected:s.node_outputs.node_selected,node:s.prepared_node_context});
      await closeConsole(s);
      await returnToExecutedWorkflow(channel,node);
      return receipt;
    },
  });
}

// Final lifecycle after a separate output-port wizard has saved its settings.
// This does not reopen the node wizard or treat intermediate Done as final.
export async function finishConfiguredGraph(channel,driver,mode,node) {
  requireValue(['done','execute'].includes(mode),'A configured graph supports Done or Execute; Close belongs to the node draft');
  const graph=await channel.observe({condition:'configured node and ports returned to graph',readOutputs:true,
    ready:s=>s.prepared_node_context?.verified===true&&s.prepared_node_context.surface==='graph'&&s.prepared_node_context.locked===false
      &&['document_id','workflow_id','node_id'].every(k=>s.prepared_node_context[k]===node[k])&&s.wizard?.status==='absent'
      &&s.node_outputs?.verified===true});
  let launch,execution;
  if(mode==='execute') {
    requireValue(driver&&typeof driver.launchGraph==='function'&&typeof driver.identify==='function','Common graph execution driver required');
    launch=await driver.launchGraph();
    requireValue(launch.verified===true&&launch.launch_gesture_verified===true&&launch.receipt?.status==='SUCCEEDED'
      &&launch.receipt.cleanup_complete===true&&typeof launch.receipt.operation_id==='string'&&launch.receipt.operation_id.length>0
      &&launch.receipt.action_key==='ui.act'&&launch.receipt.action_revision==='1'&&launch.receipt.output?.gesture_applied===true,'Graph launch is unconfirmed');
    execution=await driver.identify();
    requireValue(execution?.node&&['document_id','workflow_id','node_id'].every(k=>execution.node[k]===node[k])
      &&typeof execution.execution_id==='string'&&execution.execution_id.length>0,'Fresh graph execution identity required');
  }
  return {verified:true,cleanup_complete:true,effect_possible:mode==='execute',mode,settings_applied:true,
    execution_started:mode==='execute',execution_id:execution?.execution_id??null,
    ...(execution?{execution_group:execution,launch_receipt:{operation_id:launch.receipt.operation_id,action_key:launch.receipt.action_key,action_revision:launch.receipt.action_revision,gesture_applied:true}}:{}),
    node_context:graph.prepared_node_context,package_saved:false,reopen_performed:false};
}
