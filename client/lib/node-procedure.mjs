import { createHash } from 'node:crypto';
import { makeWorkspaceUiCode, validateUiAction } from './workspace-ui.mjs';
import {validatePreparedNodeContext} from './node-context.mjs';
import {makeNodeMappingContextCode} from './node-mapping-context.mjs';
import {makeNodePreviewSchemaCode} from './node-preview-schema.mjs';
import {makeGroupingContextCode} from './grouping-context.mjs';
import {makeCalculatorContextCode} from './calculator-context.mjs';
import {makePreparedOutputPortOpenCode,makePreparedInputPortOpenCode} from './node-port-open.mjs';
import {makeNodeProcessContextCode} from './node-process-context.mjs';
import {makeNodeOutputContextCode} from './node-output-context.mjs';
import {makeNodeTableContextCode} from './node-table-context.mjs';
import {boundWizardCloseConfirmation,wizardCloseDialogOwner} from './node-wizard-close.mjs';
import {boundWizardDeactivationConfirmation,wizardDeactivationDialogOwner} from './node-wizard-open.mjs';
const boundWizardConfirmation=(...args)=>boundWizardCloseConfirmation(...args)||boundWizardDeactivationConfirmation(...args);
const wizardConfirmationOwner=(...args)=>wizardCloseDialogOwner(...args)||wizardDeactivationDialogOwner(...args);

export class NodeReadinessTimeout extends Error {
  constructor(condition) {
    super('Node procedure readiness timeout: '+condition+'; no mutation was authorized');
    this.name='NodeReadinessTimeout';this.condition=condition;
  }
}

export class NodeProcedureStepError extends Error {
  constructor(receipt) {
    super('Node procedure step did not confirm completion; inspect before retry');
    this.name = 'NodeProcedureStepError';
    this.receipt = structuredClone(receipt);
  }
}

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

// Private transport for fixed, client-pinned node procedures. No recipes, UI
// selectors or step arrays are accepted from the caller. The enclosing action
// runtime owns its mutation gate for the whole procedure, including observations.
export function createNodeProcedure({ operation, execute, record, wrapMutation,
  targetOrigin, targetBuild, now = Date.now, maxSteps = 96, signal, preparedNodeContext,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let sequence = 0;
  const nextStep=()=>{sequence++;return operation.nodeStepSequence=(operation.nodeStepSequence??0)+1;};
  let snapshot = null;
  let evidenceSnapshot = null;
  let snapshotTableDialog = null;
  let snapshotWizardConfirmation = null;
  if(preparedNodeContext)validatePreparedNodeContext(preparedNodeContext);
  const boundOptions=preparedNodeContext?{prepared_node_context:structuredClone(preparedNodeContext)}:{};
  let uiContext=preparedNodeContext?null:operation.checkpoint;
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const checkBudget = () => {
    signal?.throwIfAborted();
    if (sequence >= maxSteps || now() >= operation.deadline) {
      throw new Error('Node procedure budget exhausted; inspect the partial result');
    }
  };
  const entry = (phase, details) => record({ operation_id: operation.id,
    action_key: operation.action.action_key, action_revision: operation.action.revision,
    phase, internal_provenance: 'client_node_procedure_v1', ...details });
  const allowedDialog=(d,dialog)=>dialog && d.identity?.anchor_tid===dialog.table.table_tid+';ModalWindow_Browse'+(dialog.kind==='format'?'Format':'Filter');
  const allowedOutputEditor=(dialog,state)=>['output_mapping','input_mapping'].includes(state.wizard?.stage)
    &&state.wizard.column_parameters?.status==='observed'&&state.wizard.column_parameters.portal_bound===true
    &&state.wizard.column_parameters.root_tid===(state.wizard.stage==='input_mapping'?'EditTuneColumnDefForm':'EditColumnDefForm')
    &&state.wizard.column_parameters.selected_column?.status==='observed'
    &&dialog.ref===state.wizard.column_parameters.root_ref&&dialog.identity?.anchor_tid===state.wizard.column_parameters.root_tid;
  const allowedExpressionEditor=(dialog,state)=>state.wizard?.stage==='calculator'
    &&state.wizard.expression_parameters?.status==='observed'&&state.wizard.expression_selection?.status==='observed'
    &&state.wizard.expression_parameters.selected_expression?.tid===state.wizard.root_tid+';CalcDataWizard;colExpressionName_'+state.wizard.expression_selection.name
    &&dialog.ref===state.wizard.expression_parameters.root_ref&&dialog.identity?.anchor_tid===state.wizard.root_tid+';ExprDataEditForm';
  const allowedFactorEditor=(dialog,state)=>state.wizard?.stage==='grouping'
    &&state.wizard.factor_editor?.status==='rendered_factor_options'
    &&state.wizard.factor_editor.selected_field?.status==='rendered_selected'
    &&dialog.ref===state.wizard.factor_editor.dialog_ref
    &&dialog.identity?.anchor_tid===state.wizard.root_tid+';FactorEditDialog';
  const allowedPreview=(dialog,state)=>state.node_preview_schema?.verified===true
    &&dialog.identity?.anchor_tid===state.node_preview_schema.root_tid
    &&state.node_preview_schema.node_id===preparedNodeContext?.node.node_id;
  const allowedNodeEditor=(dialog,state)=>allowedExpressionEditor(dialog,state)||allowedFactorEditor(dialog,state)||allowedPreview(dialog,state);
  const assertContext = (state, allowTransient = false, tableDialog = null, rootsOnly = false, wizardConfirmation = null) => {
    if(preparedNodeContext) {
      const b=state.prepared_node_context;
      if(b?.verified!==true || b.document_id!==preparedNodeContext.document_id
        || b.workflow_id!==preparedNodeContext.workflow_ref.workflow_id || b.node_id!==preparedNodeContext.node.node_id)
        throw new Error('Prepared node binding is missing or changed');
      uiContext??={workflow_ref:structuredClone(state.workflow_ref),document_id:state.dom_epoch?.document};
    }
    const expected = uiContext;
    if (state.origin !== targetOrigin || state.loginom_build !== targetBuild
      || JSON.stringify(canonical(state.workflow_ref)) !== JSON.stringify(canonical(expected.workflow_ref))
      || !expected.document_id || state.dom_epoch?.document !== expected.document_id) {
      throw new Error('Node procedure document or workflow changed');
    }
    // Root discovery carries identity but deliberately omits blocker details.
    // A rediscovery never authorizes a gesture; its next full read checks them.
    if(rootsOnly)return;
    const closing=boundWizardConfirmation(state,wizardConfirmation,false);
    const expressionModal=state.ui?.dialogs?.length===1&&allowedNodeEditor(state.ui.dialogs[0],state);
    const expressionMask=m=>expressionModal&&m.kind==='modal_background'&&m.target_tid===state.wizard.root_tid&&m.ref===state.wizard.root_ref;
    if (!Array.isArray(state.ui?.masks) || !Array.isArray(state.ui?.dialogs)
      || (!allowTransient && !closing && state.ui.masks.some(m=>!expressionMask(m)))
      || !closing && state.ui.dialogs.some(d => !allowedDialog(d,tableDialog) && !allowedOutputEditor(d,state) && !allowedNodeEditor(d,state) && (!allowTransient || d.identity?.anchor_tid !== 'toast'))
      || ['dialogs','masks'].some(key => state.ui.truncated?.[key] !== false)
      || state.scan?.complete !== true) {
      throw new Error('Node procedure is blocked by a mask or dialog');
    }
  };
  const channel = {
    async openOutputPort(port) {return channel.openPort('output',port);},
    async openInputPort(port) {return channel.openPort('input',port);},
    async openPort(direction,port) {
      if(!['input','output'].includes(direction))throw Error('Explicit port direction required');
      checkBudget();
      if(!preparedNodeContext||!Number.isInteger(port)||port<0||port>99)throw Error('A prepared output port index is required');
      const before=await channel.observe({condition:'prepared graph before opening output port',
        ready:s=>s.prepared_node_context?.surface==='graph'&&s.prepared_node_context.locked===false&&s.wizard?.status==='absent'});
      assertContext(before);
      checkBudget();
      const step=nextStep(),id=operation.id+':n'+step,action={verb:'open_'+direction+'_port',port},actionKey='node.'+direction+'_port.open.internal';
      const signature=digest([id,action,evidenceSnapshot]),observationHash=digest(evidenceSnapshot);
      snapshot=null;evidenceSnapshot=null;
      const prepared=await entry('node_step_prepared',{step,internal_operation_id:id,action,observation_sha256:observationHash,signature});
      if(prepared?.signature!==signature||JSON.stringify(prepared.action)!==JSON.stringify(action))throw Error('Port opening was not durably prepared');
      signal?.throwIfAborted();
      if(now()>=operation.deadline)throw Error('Port opening deadline elapsed before mutation');
      const code=(direction==='input'?makePreparedInputPortOpenCode:makePreparedOutputPortOpenCode)(preparedNodeContext,{port,operation_id:id,origin:targetOrigin,build:targetBuild,
        deadline:Math.min(operation.deadline,now()+15000)});
      const envelope=`async page=>{const r=await (${code})(page);return {status:r.status,action_key:${JSON.stringify(actionKey)},action_revision:'1',operation_id:${JSON.stringify(id)},phase:'port_open',effect_possible:r.effect_possible,cleanup_complete:r.cleanup_complete,output:r,error:r.error?{code:'OUTPUT_PORT_OPEN_UNCONFIRMED',message:r.error}:null,trace:r.trace}}`;
      let result;
      try{result=await execute(wrapMutation(envelope,{id,signature,action_key:actionKey}),{timeout:20000});}
      catch(error){operation.transportUncertain=true;operation.cleanupConfirmed=false;throw error;}
      if(result.operation_id!==id||result.action_key!==actionKey){operation.transportUncertain=true;operation.cleanupConfirmed=false;throw Error('Port opening receipt identity differs');}
      operation.cleanupConfirmed=result.cleanup_complete===true;operation.nodeEffectPossible ||= result.effect_possible===true;
      const completed=await entry('node_step_completed',{step,internal_operation_id:id,outcome:structuredClone(result)});
      if(completed?.outcome?.operation_id!==id||JSON.stringify(completed.outcome)!==JSON.stringify(result))throw Error('Port opening outcome was not durably preserved');
      const owner=result.output;
      if(result.status!=='SUCCEEDED'||!operation.cleanupConfirmed||owner?.verified!==true||owner.direction!==direction||owner.port!==port
        ||owner.opening_operation_id!==id||owner.document_id!==preparedNodeContext.document_id
        ||owner.workflow_id!==preparedNodeContext.workflow_ref.workflow_id||owner.node_id!==preparedNodeContext.node.node_id)
        throw new NodeProcedureStepError(result);
      return structuredClone(result);
    },
    async observe({ condition, ready, confirmIdentity, timeoutMs = 15000, importColumnPage, outputColumnPage, readProcesses = false, readOutputs = false, readMappings = false, readCalculator = false, readGrouping = false, readPreview = false, readNavigation = false, tablePage, tableDialog, tableFormatPage, wizardConfirmation } = {}) {
      checkBudget();
      if (typeof condition !== 'string' || !condition.trim() || typeof ready !== 'function'
        || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 15000) {
        throw new Error('A named, bounded readiness condition is required');
      }
      readOutputs ||= !!tablePage || !!tableDialog;
      if(wizardConfirmation && (!preparedNodeContext || !['close','deactivation'].includes(wizardConfirmation.kind)))throw Error('A prepared wizard confirmation binding is required');
      if(tableDialog && (!['format','filter'].includes(tableDialog.kind)||!tableDialog.table))throw new Error('A typed Table dialog binding is required');
      if(tablePage)makeNodeTableContextCode(preparedNodeContext,tablePage.table,tablePage.page);
      if(tableDialog)makeNodeTableContextCode(preparedNodeContext,tableDialog.table,{row_offset:0,row_limit:0,column_offset:0,column_limit:1});
      if ((readProcesses || readOutputs || readMappings || readCalculator || readGrouping || readPreview) && !preparedNodeContext) throw new Error('Native process/output reads require a prepared node');
      // A failed wait must invalidate even a previously usable observation.
      snapshot = null;
      evidenceSnapshot = null;
      snapshotTableDialog=null;
      snapshotWizardConfirmation=null;
      const step = nextStep(), id = operation.id + ':n' + step;
      const started = now(), deadline = Math.min(operation.deadline, started + timeoutMs);
      let result, satisfied = false, previousIdentity, confirmations = 0, rootRefreshes = 0;
      try {
      for (let sample = 0; sample < 80; sample++) {
        signal?.throwIfAborted();
        if (now() >= deadline) break;
        if (sample) await wait(Math.min(200, Math.max(0, deadline - now())));
        signal?.throwIfAborted();
        if (now() >= deadline) break;
        // Rediscover the root: wizard transitions and combo portals can replace it.
        const roots = await execute(makeWorkspaceUiCode({ mode: 'observe', operation_id: id,
          ...boundOptions,
          discover_roots: true, expected_origin: targetOrigin, expected_build: targetBuild }),
        { timeout: Math.min(35000, Math.max(1, deadline - now())) });
        if (roots.status !== 'SUCCEEDED') throw new Error('Node procedure roots could not be observed');
        const wizard = roots.output.wizard;
        const portals = wizard?.status === 'observed' ? (roots.output.ui?.elements??[]).filter(e =>
          e.tid?.startsWith(wizard.root_tid + ';') && e.tid.endsWith(';boundlist')) : [];
        if(portals.length>1)throw new Error('Node procedure dropdown owner is ambiguous');
        // Dropdowns live outside the wizard subtree. Reading the unique
        // portal plus fixed wizard guards avoids scanning unrelated file tabs.
        const processRoot=readProcesses ? ['mnContextMenu','ConsoleForm','MF;cntMain;tlbMainToolbar'].map(tid=>(roots.output.ui?.elements??[]).filter(e=>e.tid===tid))
          .find(xs=>xs.length===1)?.[0].ref : undefined;
        const outputRoot=readOutputs ? [preparedNodeContext.workflow_ref.prefix+';ViewsForm;BrowseView',preparedNodeContext.workflow_ref.prefix+';ViewsForm',preparedNodeContext.workflow_ref.prefix+';ModelForm;cmpDiagram']
          .map(tid=>(roots.output.ui?.elements??[]).filter(e=>e.tid===tid)).find(xs=>xs.length===1)?.[0].ref : undefined;
        const dialogRoot=tableDialog ? (roots.output.ui?.elements??[]).filter(e=>e.tid===tableDialog.table.table_tid+';ModalWindow_Browse'+(tableDialog.kind==='format'?'Format':'Filter')) : [];
        if(dialogRoot.length>1)throw new Error('Table dialog is ambiguous');
        const navigationRoot=readNavigation&&preparedNodeContext?(roots.output.ui?.elements??[]).find(e=>e.tid===preparedNodeContext.workflow_ref.prefix+';NavigationBar;NavigationPanel')?.ref:undefined;
        const graphRoot=preparedNodeContext?(roots.output.ui?.elements??[]).find(e=>e.tid===preparedNodeContext.workflow_ref.prefix+';ModelForm;cmpDiagram')?.ref:undefined;
        if(readNavigation&&!navigationRoot)throw Error('Prepared workflow navigation region unavailable');
        const outputEditors=['output_mapping','input_mapping'].includes(wizard?.stage)?(roots.output.ui?.elements??[]).filter(e=>e.tid===(wizard.stage==='input_mapping'?'EditTuneColumnDefForm':'EditColumnDefForm')):[];
        if(outputEditors.length>1)throw Error('Output field editor is ambiguous');
        const editorSuffix=wizard?.stage==='calculator'?';ExprDataEditForm':wizard?.stage==='grouping'?';FactorEditDialog':null;
        const expressionEditors=editorSuffix?(roots.output.ui?.elements??[]).filter(e=>e.tid===wizard.root_tid+editorSuffix):[];
        if(expressionEditors.length>1)throw Error('Calculator expression editor is ambiguous');
        // This is read-only root selection. The subsequent full read must prove
        // its native ownership before any dialog or mutation is admitted.
        const previewRoot=readPreview?(roots.output.ui?.elements??[]).find(e=>e.tid===preparedNodeContext.workflow_ref.prefix+';ModelForm;PreviewWindow')?.ref:undefined;
        const root = previewRoot ?? dialogRoot[0]?.ref ?? outputEditors[0]?.ref ?? navigationRoot ?? processRoot ?? outputRoot ?? (portals.length===1 ? portals[0].ref : expressionEditors[0]?.ref ?? (wizard?.status === 'observed' ? wizard.root_ref : graphRoot));
        if (now() >= deadline) break;
        result = await execute(makeWorkspaceUiCode({ mode: 'observe', operation_id: id,
          ...boundOptions,
          root_ref: root, expected_origin: targetOrigin, expected_build: targetBuild,
          ...(importColumnPage===undefined?{}:{import_column_page:importColumnPage}),
          ...(outputColumnPage===undefined?{}:{output_column_page:outputColumnPage}),
          ...(tableFormatPage===undefined?{}:{table_format_page:tableFormatPage}) }),
        { timeout: Math.min(35000, Math.max(1, deadline - now())) });
        if(result.status==='SUCCEEDED' && wizardConfirmationOwner(result.output,wizardConfirmation)) {
          // The native message box is a portal outside the wizard subtree.
          const dialog=result.output.ui.dialogs[0];
          result=await execute(makeWorkspaceUiCode({mode:'observe',operation_id:id,...boundOptions,
            root_ref:dialog.ref,expected_origin:targetOrigin,expected_build:targetBuild}),
          {timeout:Math.min(35000,Math.max(1,deadline-now()))});
        }
        if (result.status !== 'SUCCEEDED') {
          // A closing modal can disappear after root discovery. Only this
          // strict read-only refusal permits rediscovery, never replay a gesture.
          if (root && rootRefreshes < 2 && result.status === 'NOT_APPLIED'
            && result.action_key === 'workspace.observe' && result.phase === 'observing'
            && result.error?.code === 'UI_ROOT_STALE' && result.effect_possible === false
            && result.cleanup_complete === true) {
            assertContext(roots.output, true, tableDialog, true);
            await entry('node_observation_root_refreshed', {step, sample, internal_operation_id:id,
              refresh:++rootRefreshes, condition, outcome:structuredClone(result)});
            confirmations=0;previousIdentity=undefined;
            continue;
          }
          throw new Error('Node procedure observation is incomplete');
        }
        if(readPreview){
          result.output.node_preview_schema=await execute(makeNodePreviewSchemaCode(preparedNodeContext),{timeout:Math.min(35000,Math.max(1,deadline-now()))});
        }
        assertContext(result.output, true, tableDialog, false, wizardConfirmation);
        if(readNavigation)result.output.node_navigation_read=true;
        if(boundWizardConfirmation(result.output,wizardConfirmation))result.output.node_wizard_confirmation=structuredClone(wizardConfirmation);
        // These are bounded reads of native UI caches and DOM, guarded by the
        // prepared node before and after. Preserve them in the same journal
        // observation; they are not an execution or data-freshness claim.
        for (const [requested,key,makeCode] of [[readProcesses,'node_processes',makeNodeProcessContextCode],
          [readOutputs,'node_outputs',makeNodeOutputContextCode], [readMappings,'node_mapping',makeNodeMappingContextCode],
          [readCalculator,'node_calculator',makeCalculatorContextCode], [readGrouping,'node_grouping',makeGroupingContextCode]]) {
          if (!requested) continue;
          if (now() >= deadline) break;
          const native=await execute(makeCode(preparedNodeContext),{timeout:Math.min(35000,Math.max(1,deadline-now()))});
          result.output[key]=native;
          if(native.node_context && JSON.stringify(canonical(native.node_context))!==JSON.stringify(canonical(result.output.prepared_node_context)))
            throw new Error('Native process/output context changed during observation');
        }
        if(tablePage) {
          if(now()>=deadline)break;
          result.output.node_table_request=structuredClone(tablePage);
          result.output.node_table=await execute(makeNodeTableContextCode(preparedNodeContext,tablePage.table,tablePage.page),
            {timeout:Math.min(35000,Math.max(1,deadline-now()))});
        }
        if(now()>=deadline)break;
        if(tableDialog) {
          const tables=result.output.node_outputs?.tables??[];
          if(result.output.node_outputs?.verified!==true || tables.filter(t=>t.active&&t.view_guid===tableDialog.table.view_guid
            &&t.port_guid===tableDialog.table.port_guid&&t.table_tid===tableDialog.table.table_tid).length!==1)throw new Error('Table dialog owner changed');
          result.output.node_table_dialog=structuredClone(tableDialog);
        }
        satisfied = (boundWizardConfirmation(result.output,wizardConfirmation)
          || result.output.ui.masks.every(m=>result.output.ui.dialogs.length===1&&allowedNodeEditor(result.output.ui.dialogs[0],result.output)
            &&m.kind==='modal_background'&&m.target_tid===result.output.wizard.root_tid&&m.ref===result.output.wizard.root_ref)
            &&result.output.ui.dialogs.every(d=>allowedDialog(d,tableDialog)||allowedOutputEditor(d,result.output)||allowedNodeEditor(d,result.output)))
          && ready(result.output) === true && now() < deadline;
        const identity = satisfied && confirmIdentity ? digest(confirmIdentity(result.output)) : null;
        confirmations = satisfied ? (confirmIdentity ? (identity === previousIdentity ? confirmations + 1 : 1) : 1) : 0;
        previousIdentity = identity;
        await entry('node_observation_sample', { step, sample, internal_operation_id: id,
          readiness: { policy: 'semantic_condition_v2', required_samples: confirmIdentity ? 2 : 1, identity_sha256: identity, condition, satisfied, timeout_ms: timeoutMs, elapsed_ms: now() - started },
          outcome: structuredClone(result) });
        // The action transport checks the exact document epoch again before
        // the gesture. Repeating already satisfied observations adds latency
        // without making that check stronger.
        if (satisfied && confirmations >= (confirmIdentity ? 2 : 1)) break;
      }
      if (!satisfied || confirmations < (confirmIdentity ? 2 : 1) || now() >= deadline) {
        const timedOut=await entry('node_observation_timeout',{step,internal_operation_id:id,condition,
          elapsed_ms:now()-started,effect_possible:false});
        if(timedOut?.condition!==condition||timedOut.effect_possible!==false)throw Error('Observation timeout was not durably acknowledged');
        throw new NodeReadinessTimeout(condition);
      }
      const persisted = await entry('node_observation_completed', { step, internal_operation_id: id,
        readiness: { policy: 'semantic_condition_v2', required_samples: confirmIdentity ? 2 : 1, identity_sha256: previousIdentity, condition, satisfied: true, timeout_ms: timeoutMs, elapsed_ms: now() - started }, outcome: structuredClone(result) });
      if (!persisted?.outcome?.output) throw new Error('Node observation requires a durable journal acknowledgement');
      evidenceSnapshot = structuredClone(persisted.outcome.output);
      snapshot = structuredClone(result.output);
      snapshotTableDialog=tableDialog?structuredClone(tableDialog):null;
      snapshotWizardConfirmation=snapshot.node_wizard_confirmation??null;
      return structuredClone(snapshot);
      } catch(error) {
        if(signal?.aborted&&error===signal.reason) {
          const interrupted=await entry('node_observation_interrupted',{step,internal_operation_id:id,
            condition,reason:'local_cancel',effect_possible:false,cleanup_complete:true});
          if(interrupted?.step!==step||interrupted.internal_operation_id!==id||interrupted.condition!==condition
            ||interrupted.reason!=='local_cancel'||interrupted.effect_possible!==false||interrupted.cleanup_complete!==true)
            throw Error('Interrupted observation was not durably acknowledged');
        }
        throw error;
      }
    },
    async act(action) {
      checkBudget();
      if (!snapshot) throw new Error('A fresh internal observation is required');
      validateUiAction(action, snapshot);
      assertContext(snapshot,false,snapshotTableDialog,false,snapshotWizardConfirmation);
      if(snapshotWizardConfirmation && (action.verb!==(snapshotWizardConfirmation.kind==='close'?'confirm_wizard_close':'confirm_wizard_deactivation') || snapshot.ui.elements.find(e=>e.ref===action.ref)?.tid!=='msgbox;tlb;yes'))throw Error('Only the bound wizard confirmation can answer this question');
      const step = nextStep(), id = operation.id + ':n' + step;
      const before = snapshot;
      snapshot = null;
      const signature = digest([id, action, evidenceSnapshot]);
      // This write must be durable before the browser receives the mutation.
      const persisted = await entry('node_step_prepared', { step, internal_operation_id: id,
        action: structuredClone(action), observation_sha256: digest(evidenceSnapshot), signature });
      evidenceSnapshot = null;
      if (!persisted || JSON.stringify(persisted.action) !== JSON.stringify(action)
        || persisted.signature !== signature) throw new Error('Prepared step was not durably preserved after redaction');
      signal?.throwIfAborted();
      if (now() >= operation.deadline) throw new Error('Node procedure deadline elapsed before mutation');
      const code = makeWorkspaceUiCode({ mode: 'act', operation_id: id, action,
        ...boundOptions,
        snapshot: before, expected_origin: targetOrigin, expected_build: targetBuild });
      const wrapped = wrapMutation(code, { id, signature, action_key: 'ui.act' });
      let result;
      try { result = await execute(wrapped, { timeout: 35000 }); }
      catch (error) {
        operation.transportUncertain = true;
        operation.cleanupConfirmed = false;
        throw error;
      }
      if (result.operation_id !== id || result.action_key !== 'ui.act') {
        operation.transportUncertain = true;
        operation.cleanupConfirmed = false;
        await entry('node_step_completed', { step, internal_operation_id: id, outcome: structuredClone(result) });
        throw new Error('Node procedure receipt identity differs; inspect the original browser receipt');
      }
      operation.cleanupConfirmed = result.cleanup_complete === true;
      operation.nodeEffectPossible ||= result.effect_possible === true;
      await entry('node_step_completed', { step, internal_operation_id: id, outcome: structuredClone(result) });
      if (result.status !== 'SUCCEEDED' || !operation.cleanupConfirmed) {
        throw new NodeProcedureStepError(result);
      }
      // Even a successful gesture does not authorize the next one with old refs.
      return structuredClone(result);
    },
    // Fixed handlers supply the readiness condition and domain identity. Caller
    // input never contains a resolver or a recipe. Only a durably recorded,
    // strictly pre-gesture epoch refusal permits a new local attempt.
    async perform({ condition, ready, resolve, identity, timeoutMs = 15000, initialObservation }) {
      if (typeof resolve !== 'function' || typeof identity !== 'function') {
        throw new Error('A bound action resolver and domain identity are required');
      }
      let binding, intent;
      const initialPage=initialObservation?.wizard?.import_columns?.page;
      const initialOutputPage=initialObservation?.wizard?.output_columns?.page;
      for (let attempt = 0; attempt < 3; attempt++) {
        let observed;
        if (!attempt && initialObservation !== undefined) {
          checkBudget();
          if (!snapshot || digest(initialObservation) !== digest(snapshot) || ready(snapshot) !== true) {
            throw new Error('Initial bound observation is no longer current or ready');
          }
          observed=structuredClone(snapshot);
        } else observed = await channel.observe({ condition, ready, timeoutMs,
          ...(initialPage?{importColumnPage:{offset:initialPage.offset,limit:initialPage.limit}}:{}),
          ...(initialOutputPage?{outputColumnPage:{offset:initialOutputPage.offset,limit:initialOutputPage.limit}}:{}),
          tablePage:initialObservation?.node_table_request,
          wizardConfirmation:initialObservation?.node_wizard_confirmation,
          readNavigation:initialObservation?.node_navigation_read===true,
          readMappings:initialObservation?.node_mapping!==undefined,
          readCalculator:initialObservation?.node_calculator!==undefined,
          readGrouping:initialObservation?.node_grouping!==undefined,
          readPreview:initialObservation?.node_preview_schema!==undefined,
          readProcesses:initialObservation?.node_processes!==undefined,readOutputs:initialObservation?.node_outputs!==undefined,tableDialog:initialObservation?.node_table_dialog,
          tableFormatPage:initialObservation?.table_settings?.format?.page?{offset:initialObservation.table_settings.format.page.offset,limit:initialObservation.table_settings.format.page.limit}:undefined });
        const action = resolve(observed), object = identity(observed);
        if (!object || typeof object !== 'object' || !Object.keys(object).length) {
          throw new Error('A nonempty domain identity is required');
        }
        const nextBinding = digest(canonical(object));
        const nextIntent = digest(canonical(Object.fromEntries(Object.entries(action)
          .filter(([key]) => !['ref', 'source_ref', 'target_ref'].includes(key)))));
        if (attempt && (binding !== nextBinding || intent !== nextIntent)) {
          snapshot = null;
          throw new Error('Node procedure recovery target or intent changed');
        }
        binding = nextBinding; intent = nextIntent;
        try { return await channel.act(action); }
        catch (error) {
          const r = error instanceof NodeProcedureStepError ? error.receipt : null;
          if (attempt === 2 || r?.status !== 'NOT_APPLIED' || r.phase !== 'preconditions'
            || r.effect_possible !== false || r.cleanup_complete !== true
            || r.error?.code !== 'UI_EPOCH_CHANGED'
            || r.trace?.some(e => e.event === 'ui_preconditions_verified')
            || !Array.isArray(r.trace)) throw error;
          const event = await entry('node_step_refresh_authorized', {
            step:operation.nodeStepSequence,internal_operation_id:r.operation_id,
            rejected_operation_id: r.operation_id, retry: attempt + 1,
            condition, binding_sha256: binding, intent_sha256: intent,
            effect_possible: false,
          });
          if (event?.rejected_operation_id !== r.operation_id || event.retry !== attempt + 1
            || event.binding_sha256 !== binding || event.intent_sha256 !== intent) {
            throw new Error('Node recovery authorization was not durably preserved');
          }
        }
      }
    },
    get steps() { return sequence; },
  };
  return Object.freeze(channel);
}
