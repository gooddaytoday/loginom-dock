import {verifyCalculatorInlineSync} from './calculator-inline-mapping.mjs';
import {createNodeProcedure} from './node-procedure.mjs';
import {withBrowserReceipt} from './executor.mjs';
import {validateCalculatorParameters} from './calculator-parameters.mjs';
import {configureCalculator} from './calculator-procedure.mjs';
import {calculatorConfigurationReadback} from './calculator-readback.mjs';
import {calculatorParametersSchema} from './node-api.mjs';
import {openPreparedWizard} from './node-wizard-open.mjs';
import {closePreparedWizard} from './node-wizard-close.mjs';
import {createNodeExecutionProcedure,finishConfiguredGraph} from './node-execution-procedure.mjs';
import {configureOutputFields,configureOutputAutosync,reorderOutputFields,resolveConfiguredOutputMapping} from './port-mapping-procedure.mjs';
import {readOutputDefinitionPages} from './import-definition-pages.mjs';
import {openNewOutputTable,configureTablePrecision,prepareTableRead,returnFromOutputTable} from './node-output-procedure.mjs';
import {readTableOutputPages} from './table-output-pages.mjs';
import {decodeTableOutput} from './table-output-values.mjs';
import {finishedImportSurface,verifyFinishedImportContinuation} from './node-import-continuation.mjs';

const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const verified=v=>({verified:true,cleanup_complete:true,effect_possible:false,...v});
const control=(s,key,verb)=>{const es=s.ui.elements.filter(e=>e.tid===s.wizard.root_tid+';'+key&&e.allowed_actions.includes(verb));requireValue(es.length===1,'Unique wizard control required: '+key);return es[0];};
export function calculatorOutputSources(configuration) {
 const replaced=new Set(configuration.expressions.filter(e=>e.replace).map(e=>e.name.toLowerCase()));
 return [...configuration.expressions.filter(e=>!e.intermediate),...configuration.input_fields.filter(f=>!replaced.has(f.name.toLowerCase()))]
  .map(f=>({name:f.name,label:f.label,type:f.type,used:true}));
}

export function createCalculatorNodeSupport({targetOrigin,targetBuild}) {
 const nodeApplyHandlers=new Map([['transform.calculator',{revision:'calculator-v3-internal-2',modes:['expression'],output_wizard:'separate',
  configurationReadback:calculatorConfigurationReadback,parameter_schema:calculatorParametersSchema,
  validate:(p,m,r)=>{validateCalculatorParameters(p,m,r);
   requireValue(r.mappings.every(x=>(x.fields??[]).every(f=>f.source?.kind==='configured_field'&&(x.direction==='output'||f.excluded!==true))),
    'Calculator mappings require configured field names; input exclusions are unsupported');},
  configure:(ctx,p,drivers)=>drivers.configureCalculator(ctx,p)}]]);
 const nodeApplyDriverFactory=({operation,execute,onRecord,now,receiptOptions})=>{
  let channel,activeSignal,configured,mapping,columns,executionDriver,executionReceipt;
  const enter=ctx=>{activeSignal=ctx.signal;operation.deadline=ctx.deadline;
   channel??=createNodeProcedure({operation,execute,record:onRecord,now,maxSteps:4096,targetOrigin,targetBuild,
    signal:{throwIfAborted:()=>activeSignal?.throwIfAborted()},preparedNodeContext:{document_id:ctx.document_id,workflow_ref:ctx.workflow_ref,node:ctx.node},
    wrapMutation:(code,r)=>withBrowserReceipt('('+code+')(page)',{...receiptOptions(r.id,r.action_key,r.signature),operation_id:r.id})});return channel;};
  const finishWizard=async (mode,port=false)=>{
   const verb=mode==='execute'?'execute_wizard':'finish_wizard',key=mode==='execute'?'btnExecute':'btnDone';
   const s=await channel.observe({condition:'calculator '+mode+' available',...(port?{outputColumnPage:{offset:0,limit:8}}:{}),ready:s=>s.wizard?.status==='observed'&&s.ui.elements.some(e=>e.tid===s.wizard.root_tid+';'+key&&e.allowed_actions.includes(verb))});
   await channel.perform({condition:'calculator '+mode,initialObservation:s,ready:s=>s.wizard?.status==='observed',identity:s=>s.prepared_node_context,
    resolve:s=>({verb,ref:control(s,key,verb).ref})});
   const graph=await channel.observe({condition:'calculator returned to graph',ready:s=>s.wizard?.status==='absent'&&s.prepared_node_context?.surface==='graph'});
   return verified({effect_possible:true,mode,settings_applied:true,execution_started:false,node_context:graph.prepared_node_context});
  };
  return {
   verifySource:async()=>verified({not_applicable:true,source_kind:'upstream_table'}),
   async openWizard(ctx) {
    enter(ctx);executionDriver=createNodeExecutionProcedure(channel,ctx.node);await executionDriver.prepare();
    const s=await channel.observe({condition:'calculator graph before opening',ready:s=>s.prepared_node_context?.surface==='graph'});
    await channel.perform({condition:'select calculator graph node',initialObservation:s,ready:s=>s.prepared_node_context?.surface==='graph',identity:()=>ctx.node,
     resolve:s=>{const e=s.ui.elements.find(e=>e.tid===s.prepared_node_context.tid&&e.graph_node?.part==='body');requireValue(e,'Calculator graph body unavailable');return {verb:'click',ref:e.ref};}});
    await openPreparedWizard(channel);
    const opened=await channel.observe({condition:'calculator expression page',readCalculator:true,ready:s=>s.wizard?.stage==='calculator'&&s.node_calculator?.verified===true});
    return verified({effect_possible:true,node_context:opened.prepared_node_context});
   },
   async configureCalculator(ctx,p) {
    enter(ctx);const changed=await configureCalculator(channel,p,{newNode:operation.nodeApply.request.target.kind==='new'});configured=changed.configuration;
    // Close discards this editor draft directly. Next can validate a formula or
    // synchronize a derived port, neither of which is needed for cancellation.
    if(operation.nodeApply.request.finish==='close')return verified({...changed});
    const s=await channel.observe({condition:'calculator syntax validation available',readCalculator:true,ready:s=>s.wizard?.stage==='calculator'&&s.node_calculator?.verified===true});
    await channel.perform({condition:'validate calculator expressions and advance',initialObservation:s,ready:s=>s.wizard?.stage==='calculator',identity:()=>ctx.node,
     resolve:s=>({verb:'wizard_step',ref:control(s,'btnNext','wizard_step').ref,expected_stage:['output_mapping','done']})});
    let inlineMapping;
    const destination=await channel.observe({condition:'calculator validated destination',ready:s=>['output_mapping','done'].includes(s.wizard?.stage)});
    if(destination.wizard.stage==='output_mapping'){
     const ready=s=>s.wizard?.stage==='output_mapping'&&s.node_mapping?.verified===true
      &&s.node_mapping.mapping_wizard==='DerivedDataSourceMappingEngineOutputPortWizard';
     const before=await channel.observe({condition:'calculator conditional output mapping',readMappings:true,ready});
     const native=before.node_mapping;resolveConfiguredOutputMapping({direction:'output',port:0},calculatorOutputSources(configured),native);
     const linked=native.target_fields.map(f=>(f.source??f.exclusion_source)?.record_id);
     requireValue(linked.every(Boolean),'Conditional calculator output has an unbound field');
     const missing=native.source_fields.filter(f=>!linked.includes(f.record_id));
     requireValue(missing.every(f=>f.required===true&&p.expressions.some(e=>e.target.kind==='new'&&e.name===f.name)),
      'Only newly requested expressions may need conditional output synchronization');
     let after=before;
     if(missing.length){
      await channel.perform({condition:'include requested calculator fields in retained output',initialObservation:before,ready,identity:()=>ctx.node,
       resolve:s=>({verb:'click',ref:control(s,'DerivedDataSourceMappingEngineOutputPortWizard;btnSyncThroughColumns','click').ref})});
      after=await channel.observe({condition:'calculator conditional output synchronized',readMappings:true,ready});
      verifyCalculatorInlineSync(native,after.node_mapping,missing);
     }
     inlineMapping={before:native,after:after.node_mapping,added_sources:missing.map(f=>f.name)};
     await channel.perform({condition:'complete calculator conditional mapping',initialObservation:after,ready,identity:()=>ctx.node,
      resolve:s=>({verb:'wizard_step',ref:control(s,'btnNext','wizard_step').ref,expected_stage:'done'})});
    }
    const done=await channel.observe({condition:'calculator syntax accepted on completion page',ready:s=>s.wizard?.stage==='done'});
    return verified({...changed,effect_possible:true,syntax_validation:{status:'accepted_by_loginom_next',node_context:done.prepared_node_context},configuration:configured,...(inlineMapping?{inline_mapping:inlineMapping}:{})});
   },
   async mapPorts(mappings,ctx) {
    if(ctx.receipt_id===operation.id+':input_mapping'){
     // Even an unchanged input wizard's Done may synchronize/reorder fields.
     // Cancellation must never open and commit that separate settings form.
     if(operation.nodeApply.request.finish==='close'){
      requireValue(mappings.length===0,'Close cannot commit input mappings');
      return verified({not_applicable:true,mappings:[]});
     }
     enter(ctx);await channel.openInputPort(0);
     const ready=s=>s.wizard?.stage==='input_mapping'&&s.node_mapping?.verified===true;
     let s=await channel.observe({condition:'calculator incoming port schema',readMappings:true,ready});
     const requested=mappings[0]??{direction:'input',port:0},sources=s.node_mapping.source_fields.map(f=>({...f,used:true}));
     const resolved=resolveConfiguredOutputMapping(requested,sources,s.node_mapping),changes=[];
     if(requested.fields)changes.push(await configureOutputFields(channel,requested,sources));
     if(resolved.fields)changes.push(await reorderOutputFields(channel,resolved.fields.map(f=>f.current.record_id)));
     if(requested.autosync!==undefined)changes.push(await configureOutputAutosync(channel,requested.autosync));
     s=await channel.observe({condition:'configured incoming port readback',readMappings:true,ready});
     const native_mapping=s.node_mapping,definition=await readOutputDefinitionPages(channel,{expectedCount:native_mapping.target_fields.length});
     requireValue(definition.fields.every((f,i)=>['name','label','type','data_kind'].every(k=>f[k]===native_mapping.target_fields[i][k])),'Incoming port definition differs');
     const finish=await finishWizard('done',true);
     return verified({effect_possible:true,native_mapping,definition,changes,finish,source_identity_verified:true});
    }
    enter(ctx);requireValue(configured,'Configured calculator missing');await channel.openOutputPort(0);
    const ready=s=>s.wizard?.stage==='output_mapping'&&s.node_mapping?.verified===true;
    const sources=calculatorOutputSources(configured);
    let s=await channel.observe({condition:'calculator native output mapping',readMappings:true,ready});
    resolveConfiguredOutputMapping({direction:'output',port:0},sources,s.node_mapping);
    const changes=[];
    if(mappings.length) {
     const requested=mappings[0],resolved=resolveConfiguredOutputMapping(requested,sources,s.node_mapping);
     if(requested.fields)changes.push(await configureOutputFields(channel,requested,sources));
     if(resolved.fields){
      const current=await channel.observe({condition:'output identities after field edits',readMappings:true,ready});
      const updated=resolveConfiguredOutputMapping(requested,sources,current.node_mapping);
      changes.push(await reorderOutputFields(channel,updated.fields.map(f=>f.current.record_id)));
     }
     if(requested.autosync!==undefined)changes.push(await configureOutputAutosync(channel,requested.autosync));
    }
    s=await channel.observe({condition:'configured calculator output mapping readback',readMappings:true,ready});mapping=s.node_mapping;
    const active=mapping.target_fields.filter(f=>!f.excluded),definition=await readOutputDefinitionPages(channel,{expectedCount:mapping.target_fields.length});
    requireValue(definition.fields.length===mapping.target_fields.length&&definition.fields.every((f,i)=>['name','label','type','data_kind'].every(k=>f[k]===mapping.target_fields[i][k])),
     'Rendered calculator output mapping differs from native fields');columns=active;
    const finish=await finishWizard('done',true);
    return verified({effect_possible:true,native_mapping:mapping,definition,changes,finish,source_identity_verified:true});
   },
   async finish(mode,ctx){enter(ctx);if(mode==='close')return closePreparedWizard(channel);requireValue(mode==='done','Separate calculator port requires intermediate Done');return finishWizard(mode);},
   async finishGraph(mode,ctx){
    enter(ctx);
    const graph=await channel.observe({condition:'calculator graph ready after port commit',ready:s=>s.prepared_node_context?.surface==='graph'&&s.wizard?.status==='absent'});
    // Loginom can leave a visible port without an SVG shape after port Done.
    // The normal node selection redraws it before the next graph checkpoint.
    await channel.perform({condition:'select configured calculator after port commit',initialObservation:graph,
     ready:s=>s.prepared_node_context?.surface==='graph',identity:()=>ctx.node,
     resolve:s=>{const matches=s.ui.elements.filter(e=>e.tid===s.prepared_node_context.tid&&e.graph_node?.part==='body'&&e.allowed_actions.includes('click'));
      requireValue(matches.length===1,'Configured calculator body unavailable');return {verb:'click',ref:matches[0].ref};}});
    const finish=await finishConfiguredGraph(channel,executionDriver,mode,ctx.node);
    if(mode==='execute')finish.continuation_surface=finishedImportSurface(await channel.observe({
     condition:'calculator graph execution continuity checkpoint',readProcesses:true,readOutputs:true,
     ready:s=>s.prepared_node_context?.surface==='graph'&&s.node_processes?.verified===true&&s.node_outputs?.verified===true}));
    return finish;
   },
   async waitExecution(ctx){
    enter(ctx);requireValue(executionDriver,'Calculator execution driver is missing');
    try{executionReceipt=await executionDriver.waitCompleted({stopSignal:ctx.stopSignal});}
    catch(error){
     if(!ctx.stopSignal?.aborted||error!==ctx.stopSignal.reason||operation.transportUncertain)throw error;
     const saved=await onRecord({phase:'node_server_stop_requested',operation_id:operation.id,
      execution:structuredClone(ctx.execution),node:structuredClone(ctx.node)});
     requireValue(saved?.phase==='node_server_stop_requested'&&saved.operation_id===operation.id
      &&saved.execution?.execution_id===ctx.execution.execution_id,'Calculator stop request was not durably acknowledged');
     return executionDriver.stop();
    }
    return executionReceipt;
   },
   async readOutput(read,ctx) {
    enter(ctx);requireValue(executionReceipt?.verified&&executionReceipt.owner_verified&&executionReceipt.execution_id===ctx.execution.execution_id,'Calculator execution proof missing');
    if(!read.ports.length)return verified({status:'complete',ports:[],execution_id:ctx.execution.execution_id,evidence_ref:ctx.receipt_id});
    const table=await openNewOutputTable(channel,0),formatProof=await configureTablePrecision(channel,table.table),readSettings=await prepareTableRead(channel,table.table);
    const raw=await readTableOutputPages(channel,table.table,{sampleRows:read.sample_rows});
    const data=decodeTableOutput(raw,{formatProof,readSettings,expectedColumns:columns,requireExactNumbers:read.require_exact_numbers});
    const returned=await returnFromOutputTable(channel,table.table);
    return verified({effect_possible:true,status:data.sample_complete?'complete':'partial',execution_id:ctx.execution.execution_id,evidence_ref:ctx.receipt_id,
     ports:[{port:0,port_guid:table.port_guid,fresh:true,execution_id:ctx.execution.execution_id,...data}],table_creation:table,format_proof:formatProof,read_settings:readSettings,workflow_return:returned});
   },
   async verifyContinuation(state,{signal}={}){
    // Only a durably accepted graph launch can be resumed. A partially edited
    // expression or port needs reconciliation; never replay its mutations.
    if(!channel||!configured||state.pending||state.cleanup_complete!==true
     ||state.phases.at(-1)?.phase!=='finish'||now()>=state.deadline)return false;
    activeSignal=signal;signal?.throwIfAborted();operation.deadline=Math.min(state.deadline,now()+15000);
    const surface=await channel.observe({condition:'calculator retains accepted execution checkpoint',readProcesses:true,readOutputs:true,
     ready:s=>s.prepared_node_context?.surface==='graph'&&s.node_processes?.verified===true&&s.node_outputs?.verified===true});
    const confirmed=verifyFinishedImportContinuation({node:state.node,finish:state.phases.at(-1).value,surface});
    await onRecord({operation_id:operation.id,action_key:'node.apply',action_revision:state.request.contract_revision,
     phase:'node_continuation_checked',boundary:'finish',verified:confirmed,surface:finishedImportSurface(surface)});
    return confirmed;
   },
  };
 };
 return {nodeApplyHandlers,nodeApplyDriverFactory};
}
