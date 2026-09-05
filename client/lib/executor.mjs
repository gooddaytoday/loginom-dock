import { randomUUID, createHash } from 'node:crypto';
import { requireCapability } from './capability-registry.mjs';
import { actionDescribeTool, actionRunTool, assertActionOutcome, validateActionParameters } from './action-catalog.mjs';
import { makeWorkspaceUiCode, validateUiAction, uiActionSchema } from './workspace-ui.mjs';
import { createObservationPages } from './observation-pages.mjs';
import { makeWorkspaceBootstrapCode } from './workspace.mjs';

const identifier = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' };
const operationInspectTool = { name: 'dock_operation_inspect',
  description: 'Inspect or reconcile a Dock operation from its actual browser receipt and current UI. Read-only; explains partial effects and available recovery. A tool failure does not terminate the task.',
  inputSchema: { type: 'object', properties: { operation_id: identifier }, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
const operationRecoverTool = { name: 'dock_operation_recover',
  description: 'Recover in the same session: complete_link connects the existing added input; restore_control confirms cleanup of a completed call; accept_observed_state resolves an uncertain generic UI gesture after a fresh observation. abandon_operation explicitly stops pursuing a completed operation after inspecting its fresh state, so a mistaken request or changed goal can be corrected with new actions. Its original outcome remains unsuccessful; it does not undo effects or verify the goal. Both observation strategies require observation_id and confirmed browser completion/cleanup. operation_id is the original pending ID; recovery_operation_id is a NEW unique request ID (for example repair-001). Inspect first, verify and continue.',
  inputSchema: { type: 'object', properties: { operation_id: identifier, recovery_operation_id: identifier,
    observation_id: identifier, strategy: { type: 'string', enum: ['complete_link', 'restore_control', 'accept_observed_state', 'abandon_operation'] } }, required: ['operation_id', 'recovery_operation_id', 'strategy'], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } };
const uiActionTool = { name: 'dock_ui_action',
  description: 'Perform one bounded UI gesture on a fresh ref from dock_workspace_observe: click, double_click, right_click, fill, press, drag, scroll, set_checked or replace_expression. right_click sends one right mouse click; observe the resulting menu before selecting an item. action uses verb, e.g. {verb:"click",ref:"<observed ui-ref>"}, {verb:"drag",source_ref:"<observed ui-ref>",target_ref:"<observed ui-ref>"} or {verb:"scroll",ref:"<observed ui-ref>",delta_y:300}. Scroll requires allowed_actions including scroll and targets only its observed scroll owner; delta_y is a nonzero integer within -1000..1000. For a checkbox/radio use {verb:"set_checked",ref:"<observed ui-ref>",checked:true}; check_state is read before/after and an already satisfied request does not click. Radio options can only be selected, not independently unchecked. replace_expression uses {verb:"replace_expression",ref:"<editor ui-ref>",text:"Quantity * UnitPrice"} only when explicitly offered by the Calculator editor. It replaces the selected expression through keyboard input and confirms exact LF text (max 2048 characters/128 lines) via its bound document. It does not apply wizard settings or prove valid syntax; inspect errors and apply separately. Never use fill or press to bypass an unavailable editor contract. Read the new observation after scrolling; old refs/pages are invalid. Use for settings, execution, inspection and repairs outside the ready-made actions. No JavaScript or selectors. A successful gesture is not proof of task completion: inspect its result. operation_id is a NEW unique UI request ID; for a pending partial action, recovery_operation_id is that ORIGINAL pending operation ID.',
  inputSchema: { type: 'object', properties: { observation_id: identifier, operation_id: identifier, recovery_operation_id: identifier,
    action: uiActionSchema },
    required: ['observation_id', 'operation_id', 'action'], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } };
const artifactUploadTool = {name:'dock_artifact_upload',
  description:'Submit an operator-authorized input artifact to its exact Loginom destination. Requires artifact_id and upload_grant_id from dock_prepare plus a fresh observation of the current storage directory. This candidate supports only explicitly authorized replace; reject is unavailable and never silently changed. Submission is not upload completion: the operation remains pending for server verification. A repeated operation_id never sends the file again. No local paths, selectors, or overwrite choices are accepted.',
  inputSchema:{type:'object',additionalProperties:false,required:['artifact_id','upload_grant_id','observation_id','operation_id'],
    properties:{artifact_id:identifier,upload_grant_id:identifier,observation_id:identifier,operation_id:identifier}},
  annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}};
const artifactVerifyTool={name:'dock_artifact_verify',
  description:'Download and verify the exact authorized CSV for a pending upload. operation_id is the ORIGINAL upload; verification_id is a new unique verification request. Supply observation_id and file_ref from a fresh detailed file-row observation. This checks downloaded name, size and SHA, without resubmitting the upload. Repeat the same verification_id or inspect the original operation after a lost response; never bypass uncertainty with a new ID. Confirmed submission plus matching destination bytes, cleanup and durable receipts complete the original transfer. Inspect it and obtain fresh UI refs before continuing.',
  inputSchema:{type:'object',additionalProperties:false,required:['operation_id','verification_id','observation_id','file_ref'],
    properties:{operation_id:identifier,verification_id:identifier,observation_id:identifier,file_ref:identifier}},
  annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}};
export const executorTools = [actionDescribeTool, actionRunTool, operationInspectTool, operationRecoverTool, uiActionTool];

async function browserArtifactUpload(page,task,observe) {
  let phase='preconditions',effect=false,input;
  const trace=[];
  const outcome=(status,code,output={})=>({status,action_key:'artifact.upload',action_revision:'1',operation_id:task.operation_id,
    phase,effect_possible:effect,cleanup_complete:true,output,error:code?{code,message:code}:null,trace});
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  try {
    if(task.artifact.upload.overwrite!=='replace')return outcome('NOT_APPLIED','UPLOAD_POLICY_UNAVAILABLE');
    const read=await observe(page),current=read.output;
    if(read.status!=='SUCCEEDED')return outcome('NOT_APPLIED','UPLOAD_OBSERVATION_FAILED');
    if(!current.authenticated || current.origin!==task.expected_origin || current.loginom_build!==task.expected_build
      || !same(current.workflow_ref,task.snapshot.workflow_ref) || !same(current.dom_epoch,task.snapshot.dom_epoch))
      return outcome('NOT_APPLIED','UPLOAD_CONTEXT_CHANGED');
    if(current.file_storage?.status!=='observed' || current.file_storage.directory!==task.artifact.upload.directory
      || current.ui.dialogs.length || current.ui.masks.length)return outcome('NOT_APPLIED','UPLOAD_DESTINATION_UNAVAILABLE');
    const prefix=current.workflow_ref?.prefix;
    if(typeof prefix!=='string' || !/^MF;TF(?:-\d+)?$/.test(prefix))return outcome('NOT_APPLIED','UPLOAD_CONTEXT_CHANGED');
    // E2E bg/helpers/filestorage.UploadFiles uses this hidden native input.
    const toolbar=page.locator(`[data-tid="${prefix};FileStorageForm;tbrActions"]`);
    const target=toolbar.locator('input[type="file"]');
    if(await toolbar.count()!==1 || !await toolbar.isVisible() || !await toolbar.isEnabled()
      || await target.count()!==1 || !await target.isEnabled())return outcome('NOT_APPLIED','UPLOAD_INPUT_UNAVAILABLE');
    input=await target.elementHandle();
    if(!input || !await input.evaluate(element=>element.isConnected && element.tagName==='INPUT' && element.type==='file'))
      return outcome('NOT_APPLIED','UPLOAD_INPUT_UNAVAILABLE');
    const epoch=await page.evaluate(()=>{
      const state=globalThis[Symbol.for('loginom-dock.workspace-ui.identity.v1')];
      if(!state?.observer)return null;
      state.revision+=state.observer.takeRecords().length;return {document:state.epoch,revision:state.revision};
    });
    if(!same(epoch,current.dom_epoch))return outcome('NOT_APPLIED','UPLOAD_CONTEXT_CHANGED');
    trace.push({event:'upload_preconditions_verified',destination:task.artifact.upload.destination});
    phase='submitting';effect=true;
    await input.setInputFiles(task.upload_path,{timeout:15000});
    phase='submitted';trace.push({event:'upload_input_submitted'});
    // Native input completion does not establish completion of Loginom's
    // asynchronous server transfer. Keep the operation pending, even on receipt.
    return outcome('AMBIGUOUS','UPLOAD_SERVER_VERIFICATION_REQUIRED',{upload_submitted:true,
      artifact_id:task.artifact.artifact_id,upload_grant_id:task.artifact.upload.grant_id,destination:task.artifact.upload.destination,
      bytes:task.artifact.bytes,sha256:task.artifact.sha256,verification_required:true});
  } catch {return outcome(effect?'AMBIGUOUS':'NOT_APPLIED',effect?'UPLOAD_SUBMISSION_UNCERTAIN':'UPLOAD_PREFLIGHT_FAILED');}
  finally {if(input)try{await input.dispose();}catch{}}
}

export function makeArtifactUploadCode(options) {
  const observe=makeWorkspaceUiCode({mode:'observe',root_ref:options.snapshot?.observation_root?.ref,
    expected_build:options.expected_build,expected_origin:options.expected_origin});
  return `async (page) => (${browserArtifactUpload.toString()})(page,${JSON.stringify(options)},${observe})`;
}

async function browserArtifactDownload(page,task,observe,act) {
  let phase='preconditions',gesture=false,download=null,completed=false,event;
  const result=(status,code,output={})=>({status,action_key:'artifact.download',action_revision:'1',operation_id:task.operation_id,
    phase,effect_possible:gesture,cleanup_complete:!gesture || completed,output,
    error:code?{code,message:code}:null,trace:[]});
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const contextMatches=current=>current.authenticated && current.origin===task.expected_origin
    && current.loginom_build===task.expected_build && same(current.workflow_ref,task.snapshot.workflow_ref)
    && current.file_storage?.status==='observed' && current.file_storage.directory===task.artifact.upload.directory
    && current.ui.dialogs.length===0 && current.ui.masks.length===0;
  try {
    const before=await observe(page);
    if(before.status!=='SUCCEEDED' || !contextMatches(before.output)
      || !same(before.output.dom_epoch,task.snapshot.dom_epoch))return result('NOT_APPLIED','DOWNLOAD_CONTEXT_CHANGED');
    // Register BEFORE the checked gesture; native download may fire before
    // the click promise settles. Only this Page's event is eligible.
    event=page.waitForEvent('download',{timeout:15000}).then(value=>value,()=>null);
    phase='requesting';gesture=true;
    const action=await act(page);
    gesture=action.effect_possible===true;
    download=await event;
    if(action.status!=='SUCCEEDED' || action.output?.gesture_applied!==true) {
      if(download) {gesture=true;await download.cancel();completed=true;}
      return result(gesture?'AMBIGUOUS':'NOT_APPLIED','DOWNLOAD_GESTURE_NOT_CONFIRMED');
    }
    gesture=true;
    if(!download)return result('AMBIGUOUS','DOWNLOAD_EVENT_MISSING');
    // Do not persist the URL (it may carry credentials); compare only origin.
    const url=download.url(),originPrefix=task.expected_origin+'/';
    if(typeof url!=='string' || !(url.startsWith(originPrefix) || url.startsWith('blob:'+originPrefix))) {
      await download.cancel();completed=true;
      return result('AMBIGUOUS','DOWNLOAD_ORIGIN_MISMATCH');
    }
    const name=download.suggestedFilename();
    if(name!==task.artifact.name) {
      await download.cancel();completed=true;
      return result('AMBIGUOUS','DOWNLOAD_FILENAME_MISMATCH');
    }
    phase='downloading';
    await download.saveAs(task.download_path);
    if(await download.failure()!==null)return result('AMBIGUOUS','DOWNLOAD_FAILED');
    completed=true;
    const after=await observe(page);
    if(after.status!=='SUCCEEDED' || !contextMatches(after.output))return result('AMBIGUOUS','DOWNLOAD_CONTEXT_CHANGED');
    phase='downloaded';
    return result('SUCCEEDED',null,{artifact_id:task.artifact.artifact_id,upload_grant_id:task.artifact.upload.grant_id,
      upload_operation_id:task.upload_operation_id,destination:task.artifact.upload.destination,
      suggested_name:name,download_completed:true,bytes_verification_required:true,
      file_ref:task.file_ref,observation_id:task.observation_id});
  } catch {
    // An unexpected gesture exception may have emitted a download already.
    // Drain the bounded listener and cancel any captured transfer before exit.
    if(event && !download)try{download=await event;}catch{}
    if(download && !completed)try{await download.cancel();completed=true;}catch{}
    return result(gesture || event?'AMBIGUOUS':'NOT_APPLIED','DOWNLOAD_BROWSER_CALL_FAILED');
  }
}

// Trusted adapter only: every public reference must additionally be checked
// against createObservationPages.assertIssued before this code is constructed.
// This candidate covers CSV double-click downloads only; package files require
// an explicit download command instead of opening their scenario.
export function makeArtifactDownloadCode(options) {
  const artifact=options?.artifact,snapshot=options?.snapshot;
  const matches=snapshot?.ui?.elements?.filter(item=>item.ref===options.file_ref) ?? [];
  const suffix=artifact?.name?.replace(/\s/g,'_').replace(/,/g,'');
  if(!artifact?.upload || !/\.csv$/i.test(artifact.name) || matches.length!==1
    || matches[0].label!==artifact.name || matches[0].tid!==snapshot.workflow_ref?.prefix+';FileStorageForm;colName_'+suffix)
    throw new Error('Download requires the exact observed authorized CSV file');
  const shared={expected_build:options.expected_build,expected_origin:options.expected_origin};
  const observe=makeWorkspaceUiCode({mode:'observe',root_ref:options.storage_root_ref,...shared});
  const act=makeWorkspaceUiCode({mode:'act',snapshot,action:{verb:'double_click',ref:options.file_ref},...shared});
  return `async (page) => (${browserArtifactDownload.toString()})(page,${JSON.stringify(options)},${observe},${act})`;
}

function browserCapability(page, task) {
  const started = Date.now();
  const deadline = task.deadline_at ?? started + task.action.timeout_ms;
  const trace = [];
  let phase = 'preconditions';
  let effectPossible = false;
  let mouseHeld = false;
  let transientEditor = null;
  let transientDialog = false;
  let restoreViewport = null;
  let workflow = task.checkpoint?.workflow_ref ?? null;
  let loginomBuild = null;
  const record = (event, detail = {}) => trace.push({ at_ms: Date.now() - started, event, ...detail });
  const remaining = () => Math.max(0, deadline - Date.now());
  const wait = ms => page.waitForTimeout(Math.min(ms, remaining()));
  const result = (status, output = {}, error = null) => ({ status, action_key: task.action.action_key,
    action_revision: task.action.revision, operation_id: task.operation_id, phase, effect_possible: effectPossible, output, error, trace });
  const safeMessage = error => String(error?.message ?? error ?? 'unknown failure').slice(0, 1000);
  const ensureDeadline = () => { if (Date.now() >= deadline) throw new Error('Action deadline exceeded'); };
  const interact = async (operation, effect = false) => {
    ensureDeadline();
    if (effect) { effectPossible = true; phase = 'applying'; }
    return operation(Math.max(1, remaining()));
  };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const sorted = values => [...values].sort();

  const cssString = value => JSON.stringify(value).replaceAll('\u2028', '\\2028 ').replaceAll('\u2029', '\\2029 ');
  const tid = (modifier, value, suffix = '') => page.locator(`[data-tid${modifier}=${cssString(value)}]${suffix}`);
  const visible = async locator => {
    const count = await locator.count();
    const matches = [];
    for (let index = 0; index < count; index++) if (await locator.nth(index).isVisible()) matches.push(locator.nth(index));
    return matches;
  };
  const encode = (value, encoder) => {
    if (encoder === 'integer') {
      if (!Number.isInteger(value) || value < 0 || value > 999) throw new Error('Unsafe selector integer');
      return String(value);
    }
    if (typeof value !== 'string' || !value || value.length > 200 || /[;|<>"'\\\r\n]/.test(value)) {
      throw new Error('Unsafe Loginom selector parameter');
    }
    return value.replace(/\s/g, '_').replace(/,/g, '');
  };
  const activePrefix = async () => {
    const tabs = await visible(tid('^', 'MF;cntMain;cntWorkspace;Workspace;t.br;tb', '.x-tab-active'));
    if (tabs.length !== 1) throw new Error('Exactly one selected Loginom workspace tab is required');
    const tabTid = await tabs[0].getAttribute('data-tid');
    const match = /^MF;cntMain;cntWorkspace;Workspace;t\.br;tb(?:-(\d+))?$/.exec(tabTid ?? '');
    if (!match) throw new Error('Selected Loginom workspace tab has an unknown identity');
    const prefix = match[1] ? `MF;TF-${match[1]}` : 'MF;TF';
    if (workflow && (workflow.tab_tid !== tabTid || workflow.prefix !== prefix)) {
      throw new Error('Active workflow changed since the operation was prepared');
    }
    return prefix;
  };
  const interpolate = (definition, bindings) => definition.value.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, name) => {
    if (!(name in bindings)) throw new Error(`Missing selector binding ${name}`);
    return encode(bindings[name], definition.parameters[name]);
  });
  const resolve = async (symbol, bindings = {}, options = {}) => {
    ensureDeadline();
    const definition = task.selectors[symbol];
    if (!definition || !task.action.selector_symbols.includes(symbol)) throw new Error(`Selector ${symbol} is not allowed by the action`);
    let value = interpolate(definition, bindings);
    let match = definition.match;
    if (['activeTab', 'activeWorkflow'].includes(definition.scope)) {
      const prefix = await activePrefix();
      value = `${prefix};${value}`;
      match = 'exact';
    }
    const operator = { exact: '', prefix: '^', suffix: '$' }[match];
    const classSuffix = definition.required_class ? `.${definition.required_class}` : '';
    const all = tid(operator, value, classSuffix);
    let matches = [...Array(await all.count()).keys()].map(index => all.nth(index));
    if (definition.visibility !== 'any') {
      const visibility = await Promise.all(matches.map(locator => locator.isVisible()));
      matches = matches.filter((_, index) => visibility[index] === (definition.visibility === 'visible'));
    }
    const expected = options.cardinality ?? definition.cardinality;
    if ((expected === 'one' && matches.length !== 1) || (expected === 'zeroOrOne' && matches.length > 1)) {
      throw new Error(`Selector ${symbol} cardinality ${matches.length}, expected ${expected}`);
    }
    if (expected === 'many') return matches;
    if (matches.length === 0) return null;
    const locator = matches[0];
    if (definition.state.includes('enabled') && !(await locator.isEnabled())) throw new Error(`Selector ${symbol} is disabled`);
    if (options.stable !== false) {
      const first = await locator.boundingBox();
      if (!first) throw new Error(`Selector ${symbol} has no interaction geometry`);
      await wait(50);
      const second = await locator.boundingBox();
      if (!second || ['x', 'y', 'width', 'height'].some(key => Math.abs(first[key] - second[key]) > 0.75)) {
        throw new Error(`Selector ${symbol} geometry is unstable`);
      }
      const point = { x: second.x + second.width / 2, y: second.y + second.height / 2 };
      const viewport = page.viewportSize();
      if (viewport && (point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height)) {
        throw new Error(`Selector ${symbol} is outside the viewport`);
      }
    }
    return locator;
  };
  const poll = async (probe, interval = 100) => {
    for (;;) {
      ensureDeadline();
      const value = await probe();
      if (value) return value;
      await wait(interval);
    }
  };
  const waitForNoMask = async (maxWaitMs = 10000) => {
    const waitDeadline = Math.min(deadline, Date.now() + maxWaitMs);
    while (Date.now() < waitDeadline) {
      const masks = await visible(page.locator('.bg-mask-message'));
      if (!masks.length) return;
      await wait(100);
    }
    throw new Error('Loginom is masked by an in-progress operation');
  };
  const ensureReady = async () => {
    await resolve('loginom.ready_avatar', {}, { stable: false });
    loginomBuild = await page.evaluate(() => globalThis.bg?.app?.Version ?? null);
    if (task.expected_build && loginomBuild !== task.expected_build) throw new Error('Loginom build differs from the verified executor target');
    const prefix = await activePrefix();
    await waitForNoMask();
    const tab = await resolve('workspace.active_tab', {}, { stable: false });
    workflow ??= { tab_tid: await tab.getAttribute('data-tid'), prefix };
    record('preconditions_verified', { active_tab: prefix });
    return prefix;
  };
  const graphNodes = async prefix => page.locator(`[data-tid^=${cssString(prefix + ';Graph;')}][data-tid$=";Label;Label"]`).evaluateAll(elements =>
    [...new Set(elements.filter(element => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }).map(element => (element.getAttribute('data-tid') ?? '').split(';Graph;')[1]?.replace(/;Label;Label$/, ''))
      .filter(label => label && label !== 'Переменные_сценария'))].sort());
  const ports = async (prefix, nodeLabel) => page.locator(`[data-tid^=${cssString(prefix + ';Graph;' + nodeLabel + ';')}]`).evaluateAll(elements =>
    [...new Set(elements.map(element => element.getAttribute('data-tid')).filter(value => /;(?:Input|Output)_[^;]+$/.test(value ?? '')))].sort());
  const graphLinks = async prefix => page.locator(`[data-tid^=${cssString(prefix + ';Graph;')}]`).evaluateAll(elements =>
    [...new Set(elements.map(element => element.getAttribute('data-tid')).filter(value => {
      const body = (value ?? '').split(';Graph;')[1] ?? '';
      return body.split('|').length === 4 && !body.includes(';');
    }))].sort());
  const rawGraph = async prefix => ({ nodes: await Promise.all((await graphNodes(prefix)).map(async label =>
    ({ label, ports: await ports(prefix, label) }))), links: await graphLinks(prefix) });
  const graphSnapshot = async prefix => {
    const nodes = await graphNodes(prefix);
    const mappings = new Map();
    const canonicalPorts = [];
    for (const node of nodes) {
      const rawPorts = (await ports(prefix, node)).map(value => value.slice((prefix + ';Graph;' + node + ';').length));
      const groups = new Map(), mapping = new Map();
      for (const port of rawPorts) {
        const match = /^(.*)-(\d+)$/.exec(port);
        if (!match) { mapping.set(port, port); continue; }
        const kind = match[1], list = groups.get(kind) ?? [];
        list.push({ raw: port, index: Number(match[2]) }); groups.set(kind, list);
      }
      for (const [kind, group] of groups) {
        group.sort((left, right) => left.index - right.index);
        group.forEach((port, ordinal) => mapping.set(port.raw, `${kind}[${ordinal}]`));
      }
      mappings.set(node, mapping);
      canonicalPorts.push({ node_label: node, tids: sorted([...mapping.values()].map(port => `${node};${port}`)) });
    }
    // Loginom recreates live port indices on reopen (observed 0,1,3 -> 0,1,2).
    // Preserve type/direction/count and ordinal, and remap each link endpoint
    // through the same bijection. A different ordinal still changes the graph.
    const canonicalLinks = (await graphLinks(prefix)).map(value => {
      const [source, output, target, input] = value.slice((prefix + ';Graph;').length).split('|');
      const sourcePort = mappings.get(source)?.get(output), targetPort = mappings.get(target)?.get(input);
      if (!sourcePort || !targetPort) throw new Error('Graph link endpoint is absent from its node port snapshot');
      return `${source}|${sourcePort}|${target}|${targetPort}`;
    });
    return { nodes, ports: canonicalPorts, links: sorted(canonicalLinks) };
  };
  const nodeRef = nodeLabel => ({ kind: 'node', node_label: nodeLabel, workflow_ref: { ...workflow } });
  const checkNodeRef = node => {
    if (!node.workflow_ref || node.workflow_ref.tab_tid !== workflow.tab_tid || node.workflow_ref.prefix !== workflow.prefix) throw new Error('Node reference belongs to a different workflow');
  };
  const nodeDropGeometry = async () => {
    const workareaBox = await (await resolve('workflow.workarea')).boundingBox();
    if (!workareaBox) throw new Error('Workflow has no interaction geometry');
    const point = { x: workareaBox.x + task.parameters.target_position.x, y: workareaBox.y + task.parameters.target_position.y };
    const graph = await resolve('workflow.graph', {}, { stable: false });
    return graph.evaluate((element, point) => {
      // Pinned, read-only local probe. ModelForm.js:2483-2500 subtracts cntDiagram,
      // Graph.js:808-813 adds scroll and divides by scale; mouseup snaps to grid.
      // SVG rect x/y are painted in view coordinates, not pnlWorkarea coordinates.
      const app = globalThis.bg?.app;
      const card = app?.Application?.FInstance?.FMainForm?.Items?.Workspace?.getActiveTab();
      const model = card?.Controller?.FController;
      if (!app?.ModelForm || !(model instanceof app.ModelForm) || !model.View?.getEl()?.dom?.contains(element)) {
        throw new Error('Pinned ModelForm geometry probe does not match the active DOM');
      }
      const diagram = model.FDiagram, mxGraph = diagram?.FmxGraph, view = mxGraph?.view;
      if (mxGraph?.container !== element || mxGraph.gridSize !== 8 || !(diagram.FInitialScale > 0) || !(view?.scale > 0)) {
        throw new Error('Pinned graph geometry profile is unavailable');
      }
      const box = model.Items.cntDiagram.getBox();
      const scale = view.scale / diagram.FInitialScale;
      const logical = { x: Math.round((point.x - box.x + element.scrollLeft) / scale),
        y: Math.round((point.y - box.y + element.scrollTop) / scale) };
      const snapped = { x: Math.round(logical.x / 8) * 8, y: Math.round(logical.y / 8) * 8 };
      if (snapped.x < 0 || snapped.y < 0) throw new Error('Requested drop lies outside the diagram');
      return { point, snapped,
        svg: { x: (snapped.x + view.translate.x) * view.scale, y: (snapped.y + view.translate.y) * view.scale },
        scale, view_scale: view.scale, origin: { x: box.x, y: box.y }, scroll: { x: element.scrollLeft, y: element.scrollTop } };
    }, point);
  };
  const verifyNodePosition = async (nodeLabel, expected) => {
    if (!expected?.svg) throw new Error('Node position has no pre-mutation geometry checkpoint');
    const created = await resolve('workflow.node', { node_label: nodeLabel });
    const rectangle = created.locator('rect').first();
    const x = await rectangle.getAttribute('x'), y = await rectangle.getAttribute('y');
    const actual = { x: Number(x), y: Number(y) };
    if (x === null || y === null || !Number.isFinite(actual.x) || !Number.isFinite(actual.y)) {
      throw new Error('Created node has no verified SVG rectangle coordinates');
    }
    // mxGraph rounds SVG drawing coordinates to pixels. No extra grid-cell
    // tolerance is accepted: the grid calculation was performed before mutation.
    if (Math.abs(actual.x - expected.svg.x) > 0.75 || Math.abs(actual.y - expected.svg.y) > 0.75) {
      throw new Error(`Created node position differs from the expected SVG grid position (${actual.x}, ${actual.y}; expected ${expected.svg.x}, ${expected.svg.y})`);
    }
    return { actual_svg: actual, expected_svg: expected.svg, logical: expected.snapped };
  };
  const drag = async (source, targetPoint, { sourcePoint, steps = 20 } = {}) => {
    const box = await source.boundingBox();
    if (!box) throw new Error('Drag source lost its geometry');
    const start = sourcePoint ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await interact(() => page.mouse.move(start.x, start.y));
    // mouse.down itself can be applied before the transport reports an error.
    mouseHeld = true;
    try {
      await interact(() => page.mouse.down(), true);
      await interact(() => page.mouse.move(targetPoint.x, targetPoint.y, { steps }), true);
    } finally {
      await page.mouse.up();
      mouseHeld = false;
      record('mouse_released');
    }
  };
  const nodeCheckpoint = async () => {
    const prefix = await ensureReady();
    await resolve(`component.${task.parameters.component_key}`);
    const box = await (await resolve('workflow.workarea')).boundingBox();
    const position = task.parameters.target_position;
    if (!box || position.x < 8 || position.y < 8 || position.x > box.width - 8 || position.y > box.height - 8) {
      throw new Error('Target position is outside the workflow');
    }
    const before = await graphNodes(prefix);
    if (task.parameters.expected_label && before.includes(encode(task.parameters.expected_label, 'loginom_tid'))) {
      throw new Error('Expected node label already exists before this operation');
    }
    return { workflow_ref: { ...workflow }, nodes: before, graph: await rawGraph(prefix), geometry: await nodeDropGeometry() };
  };
  const reconcileNode = async before => {
    const prefix = await ensureReady();
    // Loginom hides the label while its inline editor is open. An empty
    // label snapshot then cannot prove that the node was never created.
    const graph = await resolve('workflow.graph', {}, { stable: false });
    if ((await visible(graph.locator('textarea'))).length) {
      return result('AMBIGUOUS', { reason: 'node rename editor is still open' });
    }
    const after = await graphNodes(prefix);
    const added = after.filter(value => !before.nodes.includes(value));
    const removed = before.nodes.filter(value => !after.includes(value));
    if (!added.length && !removed.length) {
      if (before.graph && !same(await rawGraph(prefix), before.graph)) return result('AMBIGUOUS', {
        reason: 'unrelated graph changed', added_labels: [], removed_labels: [] });
      return result('NOT_APPLIED');
    }
    if (added.length !== 1 || removed.length) return result('AMBIGUOUS', { added_labels: added, removed_labels: removed });
    const label = added[0];
    let autoCreatedLinks = [];
    if (before.graph) {
      const current = await rawGraph(prefix);
      current.nodes = current.nodes.filter(node => node.label !== label);
      if (!same(current, before.graph)) {
        const addedLinks = current.links.filter(link => !before.graph.links.includes(link));
        const ownedLinks = addedLinks.filter(link => {
          const parts = link.slice((prefix + ';Graph;').length).split('|');
          return parts.length === 4 && (parts[0] === label || parts[2] === label);
        });
        const withoutOwnedLinks = { ...current, links: current.links.filter(link => !ownedLinks.includes(link)) };
        if (!same(withoutOwnedLinks, before.graph)) return result('AMBIGUOUS', {
          added_label: label, added_links: addedLinks, repairable_links: [], reason: 'unrelated graph changed' });
        // Loginom can connect nearby nodes on drop. These fully observed incident
        // links are a normal effect of adding a node, not an uncertain operation.
        // The agent must still decide whether they satisfy the scenario goal.
        autoCreatedLinks = ownedLinks;
      }
    }
    if (task.parameters.expected_label && encode(task.parameters.expected_label, 'loginom_tid') !== label) {
      return result('AMBIGUOUS', { added_label: label, auto_created_links: autoCreatedLinks,
        repairable_links: autoCreatedLinks, reason: 'requested rename is not confirmed' });
    }
    const position = await verifyNodePosition(label, before.geometry);
    const reportsAutoLinks = !!task.action.output_schema.properties?.auto_created_links
      && !!task.action.output_schema.properties?.goal_verified;
    if (autoCreatedLinks.length && !reportsAutoLinks) return result('AMBIGUOUS', {
      added_label: label, added_links: autoCreatedLinks, repairable_links: autoCreatedLinks,
      reason: 'This legacy catalog cannot report automatic links; inspect their suitability before completing the node operation' });
    phase = 'verified';
    record('postcondition_verified', { added_count: 1, node_label: label, position, auto_created_links: autoCreatedLinks });
    return result('SUCCEEDED', { node_ref: nodeRef(label), ...(reportsAutoLinks
      ? { auto_created_links: autoCreatedLinks, goal_verified: false } : {}) });
  };
  const runNodeAdd = async () => {
    const before = await nodeCheckpoint();
    if (task.checkpoint && !same(before, task.checkpoint)) throw new Error('Workflow changed after node preflight');
    const prefix = workflow.prefix;
    const component = await resolve(`component.${task.parameters.component_key}`);
    record('node_snapshot_before', { count: before.nodes.length, geometry: before.geometry });
    await drag(component, before.geometry.point);
    record('component_dragged', { component_key: task.parameters.component_key });
    let after;
    try { after = await poll(async () => {
      const snapshot = await graphNodes(prefix);
      return !same(snapshot, before.nodes) ? snapshot : null;
    }); } catch { after = await graphNodes(prefix); }
    const added = after.filter(value => !before.nodes.includes(value));
    const removed = before.nodes.filter(value => !after.includes(value));
    if (!added.length && !removed.length) return reconcileNode(before);
    if (added.length !== 1 || removed.length) return result('AMBIGUOUS', { added_labels: added, removed_labels: removed });
    let label = added[0];
    if (task.parameters.expected_label) {
      const expectedLabel = encode(task.parameters.expected_label, 'loginom_tid');
      if (expectedLabel !== label) {
        const existing = await resolve('workflow.node', { node_label: expectedLabel }, { cardinality: 'zeroOrOne', stable: false });
        if (existing) return result('AMBIGUOUS', { added_label: label, reason: 'expected label already exists' });
        await interact(timeout => resolve('workflow.node_label', { node_label: label }, { stable: false }).then(item => item.dblclick({ timeout })), true);
        const graph = await resolve('workflow.graph', {}, { stable: false });
        const editors = await visible(graph.locator('textarea'));
        if (editors.length !== 1) return result('AMBIGUOUS', { added_label: label, reason: 'rename editor cardinality' });
        transientEditor = editors[0];
        await interact(timeout => transientEditor.click({ timeout }));
        await interact(timeout => transientEditor.press('ControlOrMeta+A', { timeout }));
        await interact(() => page.keyboard.type(task.parameters.expected_label, { delay: 20 }), true);
        await interact(timeout => transientEditor.press('Enter', { timeout }), true);
        await poll(() => resolve('workflow.node', { node_label: expectedLabel }, { cardinality: 'zeroOrOne', stable: false }));
        transientEditor = null;
        label = expectedLabel;
      }
      record('node_renamed', { node_label: label });
    }
    return reconcileNode(before);
  };
  const portSymbol = (direction, port) => `workflow.port.${direction}.${port.kind}`;
  const portBindings = (node, port) => ({ node_label: node.node_label, port_index: port.index ?? 0 });
  const linkCheckpoint = async () => {
    const prefix = await ensureReady();
    const { source_node: sourceNode, target_node: targetNode, source_port: sourcePort, target_port: targetPort } = task.parameters;
    checkNodeRef(sourceNode); checkNodeRef(targetNode);
    const source = await resolve(portSymbol('output', sourcePort), portBindings(sourceNode, sourcePort));
    const target = await resolve(portSymbol('input', targetPort), portBindings(targetNode, targetPort));
    return { workflow_ref: { ...workflow },
      source_tid: await source.getAttribute('data-tid'), target_tid: await target.getAttribute('data-tid'),
      links: await graphLinks(prefix), ports: await ports(prefix, targetNode.node_label), graph: await rawGraph(prefix) };
  };
  const reconcileLink = async (before, context = null) => {
    const prefix = await ensureReady();
    const { source_node: sourceNode, target_node: targetNode, target_port: targetPort } = task.parameters;
    checkNodeRef(sourceNode); checkNodeRef(targetNode);
    const currentLinks = await graphLinks(prefix);
    const currentPorts = await ports(prefix, targetNode.node_label);
    const addedLinks = currentLinks.filter(value => !before.links.includes(value));
    const removedLinks = before.links.filter(value => !currentLinks.includes(value));
    const addedPorts = currentPorts.filter(value => !before.ports.includes(value));
    const removedPorts = before.ports.filter(value => !currentPorts.includes(value));
    const sourceInfo = before.source_tid.split(';').at(-1);
    const targetInfo = before.target_tid.split(';').at(-1);
    const linkPrefix = `${prefix};Graph;${sourceNode.node_label}|${sourceInfo}|${targetNode.node_label}|`;
    if (before.graph) {
      const current = await rawGraph(prefix);
      current.links = current.links.filter(link => !addedLinks.includes(link) || !link.startsWith(linkPrefix));
      current.nodes = current.nodes.map(node => node.label === targetNode.node_label
        ? { ...node, ports: node.ports.filter(port => !addedPorts.includes(port)) } : node);
      if (!same(current, before.graph)) return result('AMBIGUOUS', { reason: 'unrelated graph changed', added_links: addedLinks, added_ports: addedPorts });
    }
    if (context) record('link_observation', { ...context,
      baseline: { ports: before.ports, links: before.links },
      current: { ports: currentPorts, links: currentLinks },
      delta: { added_ports: addedPorts, removed_ports: removedPorts, added_links: addedLinks, removed_links: removedLinks } });
    if (removedLinks.length || removedPorts.length) return result('AMBIGUOUS', { removed_links: removedLinks, removed_ports: removedPorts });
    if (targetPort.kind === 'add') {
      const targetTid = addedPorts[0];
      const exact = targetTid && linkPrefix + targetTid.split(';').at(-1);
      if (addedPorts.length === 1 && addedLinks.length === 1 && addedLinks[0] === exact) {
        phase = 'verified';
        record('postcondition_verified', { add_port_created: true, exact_link: true });
        return result('SUCCEEDED', { link_ref: { kind: 'link', tid: exact }, target_port_tid: targetTid });
      }
    } else {
      const exact = linkPrefix + targetInfo;
      if (currentLinks.includes(exact) && !addedPorts.length && addedLinks.every(link => link === exact)) {
        phase = 'verified';
        record('postcondition_verified', { exact_link: true, reconciled: before.links.includes(exact) });
        return result('SUCCEEDED', { link_ref: { kind: 'link', tid: exact }, reconciled: before.links.includes(exact) });
      }
    }
    if (addedLinks.length || addedPorts.length) return result('AMBIGUOUS', { added_links: addedLinks, added_ports: addedPorts });
    return result('NOT_APPLIED');
  };
  const runLinkCreate = async () => {
    const before = await linkCheckpoint();
    if (task.checkpoint && !same(before, task.checkpoint)) throw new Error('Workflow changed after link preflight');
    const initial = await reconcileLink(before, { stage: 'initial', attempt: 0 });
    if (initial.status !== 'NOT_APPLIED') return initial;
    const graph = await resolve('workflow.graph', {}, { stable: false });
    const viewportState = await graph.evaluate(element => ({ scrollLeft: element.scrollLeft, scrollTop: element.scrollTop }));
    restoreViewport = () => graph.evaluate((element, state) => { element.scrollLeft = state.scrollLeft; element.scrollTop = state.scrollTop; }, viewportState);
    const { source_node: sourceNode, target_node: targetNode, source_port: sourcePort, target_port: targetPort } = task.parameters;
    for (let attempt = 0; attempt <= task.action.retry_budget; attempt++) {
      // Any partial port/link mutation stops retries, even a single unlinked port.
      const prior = await reconcileLink(before, { stage: 'before_drag', attempt: attempt + 1 });
      if (prior.status !== 'NOT_APPLIED') return prior;
      const freshSource = await resolve(portSymbol('output', sourcePort), portBindings(sourceNode, sourcePort));
      const freshTarget = await resolve(portSymbol('input', targetPort), portBindings(targetNode, targetPort));
      const sourceBox = await freshSource.boundingBox(), targetBox = await freshTarget.boundingBox();
      if (!sourceBox || !targetBox) throw new Error('Port geometry disappeared');
      const corrections = [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 1 }, { x: 1, y: 1 }];
      const correction = corrections[attempt % corrections.length];
      const sourcePoint = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
      const targetPoint = { x: targetBox.x + targetBox.width / 2 + correction.x, y: targetBox.y + targetBox.height / 2 + correction.y };
      record('port_drag_attempt', { attempt: attempt + 1, correction, source_point: sourcePoint, target_point: targetPoint });
      await drag(freshSource, targetPoint, { sourcePoint, steps: 10 + attempt * 4 });
      await wait(150);
      await waitForNoMask();
      const observed = await reconcileLink(before, { stage: 'after_drag', attempt: attempt + 1 });
      if (observed.status !== 'NOT_APPLIED') return observed;
      // Require another settled observation before permitting a new attempt.
      await wait(150);
      await waitForNoMask();
      const settled = await reconcileLink(before, { stage: 'settled_after_drag', attempt: attempt + 1 });
      if (settled.status !== 'NOT_APPLIED') return settled;
    }
    return reconcileLink(before, { stage: 'retry_exhausted', attempt: task.action.retry_budget + 1 });
  };
  const recoverLink = async () => {
    const before = task.checkpoint;
    if (!before?.graph || task.parameters.target_port.kind !== 'add') throw new Error('Recovery requires an Input_Add graph checkpoint');
    const observed = await reconcileLink(before, { stage: 'before_recovery', attempt: 1 });
    if (observed.status !== 'AMBIGUOUS' || observed.output.reason || observed.output.added_links?.length !== 0
        || observed.output.added_ports?.length !== 1) return observed;
    const targetTid = observed.output.added_ports[0];
    if (!targetTid.startsWith(before.workflow_ref.prefix + ';Graph;' + task.parameters.target_node.node_label + ';Input_Data-')) {
      throw new Error('The observed partial port is not an input data port of the requested target');
    }
    const source = tid('', before.source_tid), target = tid('', targetTid);
    if (await source.count() !== 1 || await target.count() !== 1) throw new Error('Recovery ports are no longer unique');
    const box = await target.boundingBox();
    if (!box) throw new Error('Recovery target has no geometry');
    record('partial_link_recovery', { target_port_tid: targetTid, creates_port: false });
    const graph = await resolve('workflow.graph', {}, { stable: false });
    const viewport = await graph.evaluate(element => ({ scrollLeft: element.scrollLeft, scrollTop: element.scrollTop }));
    restoreViewport = () => graph.evaluate((element, state) => { element.scrollLeft = state.scrollLeft; element.scrollTop = state.scrollTop; }, viewport);
    await drag(source, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await wait(200); await waitForNoMask();
    return reconcileLink(before, { stage: 'after_recovery', attempt: 1 });
  };
  const normalizedPackagePath = () => {
    let value = task.parameters.path.trim().replaceAll('\\', '/').replace(/\/+/g, '/');
    if (!value.startsWith('/')) value = '/' + value;
    if (!value.toLowerCase().endsWith('.lgp')) value += '.lgp';
    if (value.includes('/../') || value.endsWith('/..') || value.includes('/./') || /[\0\r\n]/.test(value)) throw new Error('Unsafe package path');
    const roots = task.action.effect.allowed_roots;
    if (!Array.isArray(roots) || !roots.some(root => value === root || value.startsWith(root + '/'))) throw new Error('Package path is outside the allowed Loginom storage root');
    return value;
  };
  const packageIdentity = async () => page.evaluate(() => {
    // Pinned read-only probe of cached navigation records. PackageFileName is a
    // local getter (MapTree.js:2151-2154), not a server proxy or RPC operation.
    const app = globalThis.bg?.app;
    let node = app?.Application?.FInstance?.FMainForm?.Items?.Workspace?.getActiveTab()?.Controller?.Node?.data?.node;
    const seen = new Set();
    for (let depth = 0; node && depth < 32 && !seen.has(node); depth++) {
      seen.add(node);
      if (app.PackageTreeNode && node instanceof app.PackageTreeNode) {
        const path = node.PackageFileName;
        return { path: typeof path === 'string' ? path : null, name: node.PackageName ?? null };
      }
      node = node.ParentNode;
    }
    throw new Error('Active workflow has no verified cached package identity');
  });
  const normalizeStoredPath = value => {
    if (typeof value !== 'string' || !value.trim()) return null;
    value = value.replaceAll('\\', '/').replace(/\/+/g, '/');
    return value.startsWith('/') ? value : '/' + value;
  };
  const packageCheckpoint = async () => {
    const prefix = await ensureReady();
    const tab = await resolve('workspace.active_tab', {}, { stable: false });
    return { workflow_ref: { ...workflow }, path: normalizedPackagePath(),
      identity: (await tab.innerText()).trim(), package_identity: await packageIdentity(), graph: await graphSnapshot(prefix) };
  };
  const verifyReopenedPackage = async before => {
    const prefix = await ensureReady();
    const activeTab = await resolve('workspace.active_tab', {}, { stable: false });
    const identity = (await activeTab.innerText()).trim();
    const reopenedIdentity = await packageIdentity();
    const normalizedPath = normalizeStoredPath(reopenedIdentity.path);
    const signature = await graphSnapshot(prefix);
    const pathMatches = normalizedPath === before.path, graphMatches = same(signature, before.graph);
    record('reopened_package_observed', { requested_path: before.path, actual_path: normalizedPath,
      tab_caption: identity, path_matches: pathMatches, graph_matches: graphMatches, graph: signature });
    if (!pathMatches || !graphMatches) {
      return result('AMBIGUOUS', { path: before.path, actual_path: normalizedPath, tab_caption: identity,
        path_matches: pathMatches, graph_matches: graphMatches, expected_graph: before.graph, actual_graph: signature,
        reason: 'reopened package path or graph differs' });
    }
    phase = 'verified';
    record('postcondition_verified', { reopened: true, package_path: normalizedPath, tab_caption: identity, graph: signature });
    return result('SUCCEEDED', { package_ref: { kind: 'package', path: normalizedPath, active_identity: normalizedPath }, reopened: true });
  };
  const writeFileName = async (field, value) => {
    const input = field.locator('input');
    await interact(timeout => input.click({ timeout }));
    await interact(timeout => input.press('ControlOrMeta+A', { timeout }));
    await interact(() => page.keyboard.type(value, { delay: 10 }));
    await interact(timeout => input.press('Tab', { timeout }));
    if (await input.inputValue() !== value) throw new Error('Loginom file name editor did not commit the requested path');
  };
  const runPackageSaveAs = async () => {
    const before = await packageCheckpoint();
    if (task.checkpoint && !same(before, task.checkpoint)) throw new Error('Package changed after save preflight');
    const click = async (symbol, effect = false) => interact(timeout => resolve(symbol).then(item => item.click({ timeout })), effect);
    transientDialog = true;
    await click('packages.menu');
    await click('packages.save_as');
    const input = await poll(() => resolve('file_dialog.file_name', {}, { cardinality: 'zeroOrOne', stable: false }));
    await writeFileName(input, before.path);
    await click('file_dialog.confirm', true);
    record('save_requested', { path: before.path });
    const saved = await poll(async () => {
      const message = await resolve('message.text', {}, { cardinality: 'zeroOrOne', stable: false });
      if (message && (await message.innerText()).toLocaleLowerCase('ru').includes('существует')) return 'conflict';
      const errorMessage = await resolve('message.error', {}, { cardinality: 'zeroOrOne', stable: false });
      if (errorMessage) throw new Error((await errorMessage.innerText()).slice(0, 500));
      const dialog = await resolve('file_dialog.file_name', {}, { cardinality: 'zeroOrOne', stable: false });
      const masks = await visible(page.locator('.bg-mask-message'));
      return !dialog && !masks.length ? 'saved' : null;
    });
    if (saved === 'conflict') {
      if (task.parameters.conflict_policy === 'replace') {
        await click('message.yes', true);
        record('overwrite_confirmed');
      } else {
        const no = await resolve('message.no', {}, { cardinality: 'zeroOrOne', stable: false });
        if (!no) return result('AMBIGUOUS', { path: before.path, reason: 'overwrite cancellation is unavailable' });
        await interact(timeout => no.click({ timeout }));
        record('conflict_rejected');
        return result('NOT_APPLIED', { path: before.path, conflict: true });
      }
    }
    await waitForNoMask(60000);
    await poll(async () => !(await resolve('file_dialog.file_name', {}, { cardinality: 'zeroOrOne', stable: false })));
    const errorMessage = await resolve('message.error', {}, { cardinality: 'zeroOrOne', stable: false });
    if (errorMessage) throw new Error((await errorMessage.innerText()).slice(0, 500));
    transientDialog = false;
    await click('packages.menu');
    await click('packages.close', true);
    // Closing and reopening necessarily changes the selected tab identity.
    const closedTabTid = workflow.tab_tid;
    workflow = null;
    await poll(async () => {
      const unsaved = await resolve('message.text', {}, { cardinality: 'zeroOrOne', stable: false });
      if (unsaved && (await unsaved.innerText()).toLocaleLowerCase('ru').includes('сохранить изменения')) {
        transientDialog = true;
        throw new Error('Package remained dirty after save');
      }
      return await tid('', closedTabTid).count() === 0;
    });
    record('saved_package_closed');
    transientDialog = true;
    await click('packages.menu');
    await click('packages.open');
    const openInput = await poll(() => resolve('file_dialog.file_name', {}, { cardinality: 'zeroOrOne', stable: false }));
    await writeFileName(openInput, before.path);
    await click('file_dialog.confirm', true);
    await poll(async () => {
      const errorMessage = await resolve('message.error', {}, { cardinality: 'zeroOrOne', stable: false });
      if (errorMessage) throw new Error((await errorMessage.innerText()).slice(0, 500));
      try { return await resolve('workflow.graph', {}, { cardinality: 'zeroOrOne', stable: false }); }
      catch (error) {
        if (/selected Loginom workspace tab|unknown identity/.test(error.message)) return null;
        throw error;
      }
    });
    await waitForNoMask(60000);
    transientDialog = false;
    return verifyReopenedPackage(before);
  };
  const observe = async () => {
    const prefix = await ensureReady();
    const labels = await graphNodes(prefix);
    const nodes = [];
    for (const label of labels) {
      const locator = await resolve('workflow.node', { node_label: label }, { stable: false });
      const nodePorts = [];
      for (const portTid of await ports(prefix, label)) {
        const locator = tid('', portTid);
        if (await locator.count() !== 1) throw new Error('Observed port has ambiguous identity');
        nodePorts.push({ tid: portTid, bounding_box: await locator.boundingBox() });
      }
      nodes.push({ node_ref: nodeRef(label), bounding_box: await locator.boundingBox(), ports: nodePorts });
    }
    const tab = await resolve('workspace.active_tab', {}, { stable: false });
    const workarea = await (await resolve('workflow.workarea', {}, { stable: false })).boundingBox();
    const observedPackage = await packageIdentity();
    return result('SUCCEEDED', { authenticated: true, loginom_build: loginomBuild, workflow_ref: { ...workflow },
      active_identity: (await tab.innerText()).trim(), package_identity: { path: normalizeStoredPath(observedPackage.path), name: observedPackage.name },
      nodes, links: await graphLinks(prefix), workarea });
  };
  return (async () => {
    record('action_started', { capability: task.action.capability, mode: task.mode ?? 'apply' });
    const handlers = {
      nodeAdd: { prepare: nodeCheckpoint, apply: runNodeAdd, reconcile: () => reconcileNode(task.checkpoint) },
      linkCreate: { prepare: linkCheckpoint, apply: runLinkCreate, reconcile: () => reconcileLink(task.checkpoint), recover_link: recoverLink },
      packageSaveAs: { prepare: packageCheckpoint, apply: runPackageSaveAs,
        reconcile: () => result('AMBIGUOUS', {}, { code: 'SAVE_RECEIPT_MISSING', message: 'A lost save response cannot prove close/reopen from a read-only DOM snapshot' }) },
    };
    let outcome;
    try {
      const handler = handlers[task.handler];
      if (!handler) throw new Error('Unknown local capability handler');
      if (task.mode === 'observe') outcome = await observe();
      else if (task.mode === 'prepare') {
        const checkpoint = await handler.prepare();
        phase = 'prepared';
        outcome = { ...result('NOT_APPLIED'), checkpoint };
      } else if (task.mode === 'reconcile') {
        phase = 'reconciling';
        outcome = await handler.reconcile();
      } else if (task.mode === 'recover_link') {
        if (!handler.recover_link) throw new Error('Recovery is unavailable for this handler');
        outcome = await handler.recover_link();
      } else if (!task.mode || task.mode === 'apply') outcome = await handler.apply();
      else throw new Error('Unknown capability execution mode');
    } catch (error) {
      record('action_failed', { phase, effect_possible: effectPossible });
      outcome = result(effectPossible || task.mode === 'reconcile' ? 'AMBIGUOUS' : 'FAILED', {}, { code: 'CAPABILITY_ERROR', message: safeMessage(error) });
    } finally {
      const cleanup = async (name, operation) => {
        try { await operation(); record('cleanup_completed', { resource: name }); }
        catch (error) {
          record('cleanup_failed', { resource: name });
          outcome = result('AMBIGUOUS', {}, { code: 'CLEANUP_FAILED', message: safeMessage(error) });
        }
      };
      if (mouseHeld) await cleanup('mouse', () => page.mouse.up());
      if (transientEditor) await cleanup('rename_editor', async () => {
        if (await transientEditor.isVisible()) await transientEditor.press('Escape', { timeout: 3000 });
      });
      if (transientDialog) await cleanup('transient_dialog', () => page.keyboard.press('Escape'));
      if (restoreViewport) await cleanup('viewport', restoreViewport);
    }
    outcome.cleanup_complete = !trace.some(entry => entry.event === 'cleanup_failed');
    return outcome;
  })();
}

export function makeCapabilityCode(action, selectors, parameters, options = {}) {
  const handler = requireCapability(action).handler;
  const allowedSelectors = Object.fromEntries(action.selector_symbols.map(symbol => [symbol, selectors.get(symbol)]));
  const task = { action: structuredClone(action), selectors: structuredClone(allowedSelectors), parameters: structuredClone(parameters), ...structuredClone(options), handler };
  const body = `(${browserCapability.toString()})(page, ${JSON.stringify(task)})`;
  return ['apply', 'recover_link'].includes(task.mode) && task.receipt_namespace
    ? withBrowserReceipt(body, task) : `async (page) => ${body}`;
}

// The receipt lives on the Playwright Page in the local browser server, outside
// the web application's JS world. Losing an MCP response does not lose proof
// that this exact operation finished its finally/cleanup block.
function browserReceipt(page, task, perform) {
  const symbol = Symbol.for('loginom-dock.operation-receipts.v1');
  const ledger = page[symbol] ??= new Map();
  const key = task.receipt_namespace + '/' + (task.receipt_id ?? task.operation_id);
  const previous = ledger.get(key);
  const envelope = (state, output = {}) => ({ status: 'SUCCEEDED', action_key: 'operation.inspect', action_revision: '1',
    operation_id: task.operation_id, phase: 'observed', effect_possible: false, output: { state, ...output }, error: null, trace: [] });
  if (task.receipt_read) {
    if (!previous) return envelope('missing');
    if (previous.signature !== task.receipt_signature) return envelope('identity_mismatch');
    return envelope(previous.state, previous.outcome ? { receipt: previous.outcome } : {});
  }
  if (previous) {
    if (previous.signature !== task.receipt_signature) throw new Error('Browser operation receipt identity mismatch');
    if (previous.state === 'completed') return previous.outcome;
    throw new Error('Browser operation already started; inspect its receipt before retrying');
  }
  for (const [oldKey, value] of ledger) {
    if (ledger.size < 128) break;
    if (value.state === 'completed' && oldKey !== key) ledger.delete(oldKey);
  }
  if (ledger.size >= 128) throw new Error('Browser receipt capacity reached');
  const entry = { state: 'running', signature: task.receipt_signature };
  ledger.set(key, entry);
  return (async () => {
    try { const outcome = await perform(); entry.outcome = outcome; entry.state = 'completed'; return outcome; }
    catch (error) { entry.state = 'unknown'; throw error; }
  })();
}
function withBrowserReceipt(body, options) {
  return `async (page) => (${browserReceipt.toString()})(page, ${JSON.stringify(options)}, () => ${body})`;
}

export function parseCapabilityResult(response) {
  if (response?.isError) throw new Error('Pinned browser capability call failed');
  for (const block of response?.content ?? []) {
    if (block.type !== 'text') continue;
    const match = block.text.match(/^### Result\n([\s\S]*?)(?:\n### |$)/);
    const source = match?.[1] ?? block.text;
    try { return assertActionOutcome(JSON.parse(source)); } catch {}
  }
  throw new Error('Pinned browser capability returned no typed result');
}

export function createActionRuntime({ pinned, execute, artifactStore, allowCandidate = false, onRecord = async () => {}, now = Date.now, targetBuild = pinned?.compatibility?.loginom_build, targetOrigin }) {
  if (!pinned?.actions || !pinned?.selectors) throw new Error('A verified pinned action catalog is required');
  let pending = null;
  let running = false;
  const operations = new Map();
  const auxiliary = new Map();
  const observations = createObservationPages();
  const receiptNamespace = randomUUID();
  const checkId = id => { if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) throw new Error('A stable operation identifier is required'); };
  const fingerprint = (actionKey, parameters) => {
    const canonical = value => value && typeof value === 'object'
      ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    return createHash('sha256').update(JSON.stringify([actionKey, canonical(parameters)])).digest('hex');
  };
  const find = actionKey => {
    if (typeof actionKey !== 'string' || !actionKey.trim()) throw new Error('action_key is required');
    const action = pinned.actions.get(actionKey);
    if (!action) throw new Error(`Action ${actionKey} is not present in the pinned catalog`);
    requireCapability(action);
    const accepted = pinned.acceptanceVerified === true && pinned.pins?.catalogLifecycleStatus === 'production';
    if (action.status !== 'production' && !(action.status === 'candidate' && (allowCandidate || accepted))) {
      throw new Error(`Action ${actionKey} is not executable in this session (${action.status})`);
    }
    return action;
  };
  const failed = (operation, code, message, status = 'AMBIGUOUS') => ({ status,
    action_key: operation.action.action_key, action_revision: operation.action.revision,
    operation_id: operation.id, phase: 'unverified', effect_possible: status === 'AMBIGUOUS', output: {}, error: { code, message }, trace: [] });
  const receiptOptions = (operation, id, key, signature) => {
    operation.lastReceipt = { id, signature, action_key: key, operation_id: id };
    return { receipt_namespace: receiptNamespace, receipt_id: id, receipt_signature: signature };
  };
  const invoke = async (operation, mode, { receiptId, ...options } = {}) => {
    const mutation = ['apply', 'recover_link'].includes(mode);
    const receipt = mutation ? receiptOptions(operation, receiptId ?? operation.id, operation.action.action_key,
      fingerprint(mode, [operation.action.action_key, operation.parameters, operation.checkpoint])) : {};
    // Recovery receipts retain the original action identity; their storage ID is
    // distinct so repeating recovery never performs another physical gesture.
    if (mutation) operation.lastReceipt.operation_id = operation.id;
    const outcome = await execute(makeCapabilityCode(operation.action, pinned.selectors, operation.parameters, {
      operation_id: operation.id, mode, checkpoint: operation.checkpoint, expected_build: targetBuild,
      ...receipt, ...(mutation ? { deadline_at: mode === 'apply' ? operation.deadline : now() + operation.action.timeout_ms } : {}),
    }), { timeout: operation.action.timeout_ms + 5000, ...options });
    assertActionOutcome(outcome);
    if (outcome.action_key !== operation.action.action_key || outcome.action_revision !== operation.action.revision) {
      throw new Error('Dock capability outcome identity does not match the pinned action');
    }
    if (outcome.operation_id !== operation.id) throw new Error('Dock capability operation identity does not match');
    if (mode !== 'prepare' && outcome.status === 'SUCCEEDED') validateActionParameters(operation.action.output_schema, outcome.output, 'output');
    return outcome;
  };
  const remember = async (operation, phase, outcome) => {
    await onRecord({ operation_id: operation.id, action_key: operation.action.action_key, action_revision: operation.action.revision,
      phase, parameters: structuredClone(operation.parameters), checkpoint: structuredClone(operation.checkpoint ?? null),
      deadline_at: operation.deadline ?? null, ...(outcome ? { outcome: structuredClone(outcome) } : {}) });
  };
  const readReceipt = async operation => {
    if (!operation.lastReceipt) return { state: 'missing' };
    const reference = operation.lastReceipt;
    const code = `async (page) => (${browserReceipt.toString()})(page, ${JSON.stringify({ receipt_namespace: receiptNamespace,
      receipt_id: reference.id, receipt_signature: reference.signature, receipt_read: true, operation_id: operation.id })})`;
    const value = await execute(code, { timeout: 10000 });
    assertActionOutcome(value);
    const state = value.output;
    if (state?.state === 'completed') {
      const receipt = assertActionOutcome(state.receipt);
      if (receipt.operation_id !== reference.operation_id || receipt.action_key !== reference.action_key) throw new Error('Recovered browser receipt has a different identity');
      if (receipt.action_key === operation.action.action_key && receipt.status === 'SUCCEEDED' && operation.action.output_schema) {
        validateActionParameters(operation.action.output_schema, receipt.output, 'output');
      }
    }
    return state;
  };
  const finishArtifactVerification=async (operation,attempt,raw) => {
    assertActionOutcome(raw);
    if(raw.action_key!=='artifact.download' || raw.action_revision!=='1' || raw.operation_id!==attempt.id)
      throw new Error('Downloaded artifact receipt identity mismatch');
    attempt.raw=structuredClone(raw);
    if(!attempt.rawRecorded) {
      await remember(attempt,'download_completed',raw);attempt.rawRecorded=true;
    }
    const artifact=operation.checkpoint.artifact;
    let outcome=attempt.byteOutcome ?? {...structuredClone(raw),action_key:'artifact.verify'};
    if(!attempt.byteOutcome && raw.status==='SUCCEEDED') {
      const expected={artifact_id:artifact.artifact_id,upload_grant_id:artifact.upload.grant_id,
        upload_operation_id:operation.id,destination:artifact.upload.destination,suggested_name:artifact.name,
        download_completed:true,bytes_verification_required:true,file_ref:attempt.parameters.file_ref,
        observation_id:attempt.parameters.observation_id};
      if(fingerprint('download.output',raw.output)!==fingerprint('download.output',expected) || raw.cleanup_complete!==true
        || raw.phase!=='downloaded' || raw.effect_possible!==true || raw.error!==null)
        throw new Error('Downloaded artifact metadata differs from the original upload');
      try {
        await attempt.lease.verify(raw.output.suggested_name);
        outcome={...outcome,phase:'verified',output:{...expected,bytes_verification_required:false,bytes_verified:true,
          bytes:artifact.bytes,sha256:artifact.sha256,upload_completion_verified:false}};
      } catch {
        outcome={...outcome,status:'FAILED',phase:'verification_failed',output:{upload_operation_id:operation.id,
          destination:artifact.upload.destination,bytes_verified:false,upload_completion_verified:false},
          error:{code:'DOWNLOADED_ARTIFACT_MISMATCH',message:'Downloaded bytes do not match the admitted artifact'}};
      }
    }
    attempt.byteOutcome=structuredClone(outcome);
    if(!attempt.byteRecorded) {await remember(attempt,'download_verified',outcome);attempt.byteRecorded=true;}
    if(outcome.output.bytes_verified===true && operation.outcome.output.upload_submitted===true
      && operation.outcome.cleanup_complete===true && raw.cleanup_complete===true) {
      // The transfer contract's postcondition is exact destination bytes/size/
      // digest, not a visible filename or a network-idle heuristic. Both native
      // calls have completed; retain the proof across cleanup/journal failures.
      try {
        await attempt.lease.release();await operation.uploadLease.release();
      } catch {
        attempt.outcome={...structuredClone(outcome),status:'AMBIGUOUS',phase:'cleanup',cleanup_complete:false,
          error:{code:'TRANSFER_CLEANUP_FAILED',message:'Transfer proof is retained; temporary file cleanup is unconfirmed'}};
        operation.cleanupConfirmed=false;
        return attempt.outcome;
      }
      const summary={verification_id:attempt.id,status:'SUCCEEDED',bytes_verified:true,upload_completion_verified:true,
        destination:artifact.upload.destination,bytes:artifact.bytes,sha256:artifact.sha256};
      const completedUpload={...structuredClone(operation.outcome),status:'SUCCEEDED',phase:'verified',error:null,
        cleanup_complete:true,output:{...structuredClone(operation.outcome.output),verification_required:false,
          transfer_postcondition:'destination_bytes_digest_and_size',server_copy_verification:summary}};
      const completedVerification={...structuredClone(outcome),output:{...outcome.output,upload_completion_verified:true}};
      if(!attempt.transferRecorded) {await remember(operation,'transfer_completed',completedUpload);attempt.transferRecorded=true;}
      await remember(attempt,'verification_completed',completedVerification);
      operation.outcome=completedUpload;operation.transportUncertain=false;operation.cleanupConfirmed=true;
      attempt.outcome=completedVerification;attempt.settled=true;
      auxiliary.set(attempt.id,{signature:attempt.signature,outcome:structuredClone(completedVerification)});
      if(pending===operation)pending=null;
      return completedVerification;
    }
    attempt.outcome=outcome;attempt.settled=true;
    auxiliary.set(attempt.id,{signature:attempt.signature,outcome:structuredClone(outcome)});
    operation.transportUncertain=false;operation.cleanupConfirmed=raw.cleanup_complete===true;
    operation.outcome.output.server_copy_verification={verification_id:attempt.id,status:outcome.status,
      bytes_verified:outcome.output.bytes_verified===true,upload_completion_verified:false,
      ...(outcome.output.bytes_verified ? {destination:artifact.upload.destination,bytes:artifact.bytes,sha256:artifact.sha256} : {})};
    if(raw.status==='NOT_APPLIED' && raw.cleanup_complete===true)await attempt.lease.release();
    return outcome;
  };
  const reconcilePending = async () => {
    const operation = pending;
    try {
      const verification=operation.verification;
      if(operation.action.capability==='artifact.upload' && verification && !verification.settled) {
        if(running)return failed(operation,'OPERATION_STILL_PENDING','The verification request is still running');
        const state=verification.raw ? {state:'completed',receipt:verification.raw} : await readReceipt(operation);
        if(state.state!=='completed')return failed(operation,'OPERATION_STILL_PENDING','The download receipt has not confirmed browser completion');
        await finishArtifactVerification(operation,verification,state.receipt);
      }
      if (operation.transportUncertain) {
        const state = await readReceipt(operation);
        if (state?.state !== 'completed') return failed(operation, 'OPERATION_STILL_PENDING',
          `Browser receipt is ${state?.state ?? 'unavailable'}; only observation is available until actual completion is established`);
        operation.transportUncertain = false;
        operation.cleanupConfirmed = state.receipt.cleanup_complete === true;
        await remember(operation, 'receipt_recovered', state.receipt);
        if (auxiliary.has(operation.lastReceipt.id)) {
          const cached = auxiliary.get(operation.lastReceipt.id);
          cached.outcome = { ...structuredClone(state.receipt), ...(cached.outcome.recovery_operation_id
            ? { recovery_operation_id: cached.outcome.recovery_operation_id } : {}) };
        }
        if (state.receipt.action_key === operation.action.action_key) operation.outcome = state.receipt;
        if (operation.cleanupConfirmed && operation.outcome.status !== 'AMBIGUOUS') {
          if(operation.action.capability==='artifact.upload' && operation.outcome.status==='NOT_APPLIED')await operation.uploadLease?.release();
          pending = null; return operation.outcome;
        }
      }
      if(operation.cleanupConfirmed===false && operation.verification?.byteOutcome?.output?.bytes_verified===true)
        return failed(operation,'TRANSFER_FINALIZATION_PENDING','Verified bytes are retained; transfer cleanup has not completed');
      if (operation.cleanupConfirmed === false) return failed(operation, 'CLEANUP_RECEIPT_MISSING',
        'The browser call finished but cleanup is unconfirmed. Inspect and restore_control before further mutations.');
      if (['ui.act','artifact.upload'].includes(operation.action.capability)) {
        await remember(operation, 'reconciled', operation.outcome);
        if(operation.action.capability==='artifact.upload' && operation.outcome?.status==='NOT_APPLIED')await operation.uploadLease?.release();
        if (operation.outcome.status !== 'AMBIGUOUS') pending = null;
        return operation.outcome;
      }
      const outcome = await invoke(operation, 'reconcile');
      await remember(operation, 'reconciled', outcome);
      operation.outcome = outcome;
      if (outcome.status === 'SUCCEEDED' || outcome.status === 'NOT_APPLIED') {
        pending = null;
        operation.outcome = outcome;
      }
      return outcome;
    } catch (error) { return failed(operation, 'RECONCILIATION_FAILED', String(error?.message ?? error).slice(0, 1000)); }
  };
  const recoveryAdvice = operation => {
    const base = [{ tool: 'dock_workspace_observe', arguments: {}, required_fields: [],
      requires: [], provides: ['observation_id', 'fresh_ui_refs'] }];
    if (!operation || pending !== operation) return { recovery_options: [], next_steps: base };
    base.unshift({ tool: 'dock_operation_inspect', arguments: { operation_id: operation.id },
      required_fields: [], requires: [], provides: ['completion_receipt', 'cleanup_state'] });
    if (operation.transportUncertain) return { recovery_options: [], next_steps: base };
    if(operation.action.capability==='artifact.upload') {
      if(operation.cleanupConfirmed && (!operation.verification || operation.verification.settled))base.push({
        tool:'dock_artifact_verify',arguments:{operation_id:operation.id},required_fields:['verification_id','observation_id','file_ref'],
        requires:['fresh_observed_authorized_csv_ref','confirmed_browser_completion'],provides:['server_copy_byte_verification']});
      return {recovery_options:[],next_steps:base};
    }
    const strategies = operation.cleanupConfirmed === false ? ['restore_control']
      : ['abandon_operation', ...(operation.action.capability === 'ui.act' ? ['accept_observed_state'] : []),
        ...(operation.action.capability === 'link.create.v1' && operation.parameters.target_port.kind === 'add'
          && !operation.outcome?.output?.reason && operation.outcome?.output?.added_ports?.length === 1
          && operation.outcome?.output?.added_links?.length === 0 ? ['complete_link'] : [])];
    for (const strategy of strategies) {
      const observed = ['abandon_operation', 'accept_observed_state'].includes(strategy);
      base.push({ tool: 'dock_operation_recover', arguments: { operation_id: operation.id, strategy },
        required_fields: ['recovery_operation_id', ...(observed ? ['observation_id'] : [])],
        id_roles: { operation_id: 'original_pending_operation', recovery_operation_id: 'new_unique_request' },
        requires: ['confirmed_browser_completion', ...(strategy === 'restore_control' ? [] : ['confirmed_cleanup']),
          ...(observed ? ['fresh_observation_id'] : [])], provides: ['recovery_receipt'] });
    }
    if (operation.cleanupConfirmed === true) base.push({ tool: 'dock_ui_action',
      arguments: { recovery_operation_id: operation.id }, required_fields: ['operation_id', 'observation_id', 'action'],
      id_roles: { operation_id: 'new_unique_request', recovery_operation_id: 'original_pending_operation' },
      requires: ['fresh_observation_id', 'observed_owned_ui_ref', 'confirmed_browser_completion', 'confirmed_cleanup'],
      provides: ['gesture_receipt', 'reconciliation'] });
    return { recovery_options: strategies, next_steps: base };
  };
  const view = (operation, outcome) => ({ status: 'SUCCEEDED', action_key: 'operation.inspect', action_revision: '1',
    operation_id: operation?.id, phase: 'observed', effect_possible: false, error: null, trace: [], output: {
      operation_id: operation?.id ?? null, state: !operation ? 'idle' : pending === operation ? 'pending' : 'resolved',
      outcome: outcome ?? operation?.outcome ?? null, cleanup_confirmed: operation ? operation.cleanupConfirmed === true : true,
      effect_state: !operation ? 'none' : operation.transportUncertain ? 'unknown' : pending === operation ? 'partial_or_unverified'
        : operation.outcome?.resolution ? 'observed_unverified' : 'verified',
      ...recoveryAdvice(operation),
    } });
  const retainObservation = outcome => {
    try { return observations.retain(outcome); }
    catch {
      // Delivery failure after a gesture must not become a pre-action rejection.
      // The immutable browser receipt remains in the journal/operation record.
      return { ...outcome, output: { observation_required: true, verification_required: true,
        ...(outcome.output?.gesture_applied === undefined ? {} : { gesture_applied: outcome.output.gesture_applied }),
        observation_error: 'Observation could not fit a page; request a narrower workspace scope and inspect the operation.' } };
    }
  };
  const inspect = async ({ operationId, signal } = {}) => {
    signal?.throwIfAborted();
    const operation = operationId ? operations.get(operationId) : pending;
    if (operationId && !operation) throw new Error('Operation is not known in this session');
    if (!operation || pending !== operation) return view(operation);
    return view(operation, await reconcilePending());
  };
  return Object.freeze({
    tools: [...executorTools,...(allowCandidate && artifactStore ? [artifactUploadTool,artifactVerifyTool] : [])],
    assertPreparationAllowed() {
      if (running || pending) throw new Error('Dock preparation cannot run while an action is running or its effect remains uncertain');
    },
    describe(actionKey) {
      if (actionKey === undefined) return { available_actions: [...pinned.actions.keys()],
        ...(allowCandidate && artifactStore ? {artifact_upload_tool:'dock_artifact_upload',artifact_verify_tool:'dock_artifact_verify',input_artifacts:artifactStore.list()} : {}),
        ui_action_tool: 'dock_ui_action', observation_tool: 'dock_workspace_observe', session_manifest: structuredClone(pinned.pins) };
      const action = find(actionKey);
      return { action: structuredClone(action), session_manifest: structuredClone(pinned.pins) };
    },
    requestFailure(error) {
      return { status: pending ? 'AMBIGUOUS' : 'FAILED', action_key: pending?.action.action_key ?? 'request.validate',
        action_revision: pending?.action.revision ?? '1', operation_id: pending?.id ?? null,
        phase: 'request_rejected', effect_possible: !!pending, request_rejected: true,
        output: { available_actions: [...pinned.actions.keys()], ui_action_tool: 'dock_ui_action', operation: view(pending).output,
          ...(error?.code==='ARTIFACT_GRANT_NOT_FOUND' && allowCandidate && artifactStore ? {input_artifacts:artifactStore.list()} : {}) },
        error: { code: 'REQUEST_REJECTED', message: String(error?.message ?? error).slice(0, 1000) }, trace: [] };
    },
    inspect,
    async recover(operationId, { strategy, recoveryOperationId, observationId, signal } = {}) {
      signal?.throwIfAborted(); checkId(operationId); checkId(recoveryOperationId);
      const signature = fingerprint('recover', [operationId, strategy, observationId ?? null]);
      if (auxiliary.has(recoveryOperationId)) {
        const previous = auxiliary.get(recoveryOperationId);
        if (previous.signature !== signature) throw new Error('Recovery operation ID was already used with different parameters');
        return structuredClone(previous.outcome);
      }
      if (operations.has(recoveryOperationId)) throw new Error('Recovery ID conflicts with an existing operation');
      const operation = operations.get(operationId);
      if (!operation || pending !== operation) throw new Error('Recovery requires the pending operation of this session');
      if(operation.action.capability==='artifact.upload')throw new Error('Upload requires server transfer verification before recovery or abandonment');
      if (!['complete_link', 'restore_control', 'accept_observed_state', 'abandon_operation'].includes(strategy)) throw new Error('Unsupported recovery strategy');
      if (strategy === 'complete_link' && operation.action.capability !== 'link.create.v1') throw new Error('complete_link requires a pending link.create operation');
      if (strategy === 'accept_observed_state' && operation.action.capability !== 'ui.act') throw new Error('Only a generic UI gesture can accept an observed state; domain actions require verified postconditions');
      if (running) throw new Error('Another Dock action is still running');
      running = true;
      try {
        await reconcilePending();
        if (!pending) return { ...structuredClone(operation.outcome), recovery_operation_id: recoveryOperationId };
        if (operation.transportUncertain) throw new Error('The browser operation has not confirmed completion; inspect before recovery');
        if (strategy !== 'restore_control' && !operation.cleanupConfirmed) throw new Error('Restore browser control before repairing the graph');
        if (strategy === 'accept_observed_state' || strategy === 'abandon_operation') {
          const snapshot = observations.get(observationId);
          if (!snapshot) throw new Error('Observe the current UI before accepting its state');
          const current = await execute(makeWorkspaceUiCode({ mode: 'observe', expected_build: targetBuild, expected_origin: targetOrigin }), { signal, timeout: 35000 });
          const identity = value => [value.origin, value.loginom_build, value.workflow_ref, value.package_identity, value.nodes, value.links, value.ui];
          if (current.status !== 'SUCCEEDED' || fingerprint('ui-state', identity(snapshot)) !== fingerprint('ui-state', identity(current.output))) {
            throw new Error('Observed state changed before acceptance; inspect the fresh UI');
          }
          const resolution = strategy === 'abandon_operation' ? 'abandoned_after_observation' : 'accepted_observed_state';
          const resolved = { ...structuredClone(operation.outcome), resolution, goal_verified: false,
            recovery_operation_id: recoveryOperationId, observation_id: observationId };
          await remember(operation, strategy === 'abandon_operation' ? 'operation_abandoned' : 'observed_state_accepted', resolved);
          operation.outcome = resolved; pending = null; observations.clear();
          const result = { status: 'SUCCEEDED', action_key: 'operation.recover', action_revision: '1', operation_id: operationId,
            phase: 'resolved', effect_possible: false, error: null, trace: [], output: { resolution,
              goal_verified: false, original_outcome: resolved }, recovery_operation_id: recoveryOperationId };
          auxiliary.set(recoveryOperationId, { signature, outcome: structuredClone(result) });
          return result;
        }
        if ((operation.recoveryAttempts ?? 0) >= 12) throw new Error('Recovery budget exhausted; inspect and report the unresolved state');
        operation.recoveryAttempts = (operation.recoveryAttempts ?? 0) + 1;
        const record = { ...operation, id: recoveryOperationId, parameters: { original_operation_id: operationId, strategy } };
        await remember(record, 'recovery_prepared');
        observations.clear();
        let outcome;
        try {
          if (strategy === 'complete_link') outcome = await invoke(operation, 'recover_link', { receiptId: recoveryOperationId });
          else {
            const receipt = receiptOptions(operation, recoveryOperationId, 'operation.restore_control', signature);
            const body = `(async () => { const outcome = {status:'SUCCEEDED', action_key:'operation.restore_control',action_revision:'1',operation_id:${JSON.stringify(recoveryOperationId)},phase:'cleanup',effect_possible:true,output:{},error:null,trace:[]}; try { await page.mouse.up({button:'left'}); await page.mouse.up({button:'right'}); await page.keyboard.press('Escape'); outcome.cleanup_complete=true; } catch(error) { outcome.status='AMBIGUOUS';outcome.cleanup_complete=false;outcome.error={code:'CLEANUP_FAILED',message:String(error.message).slice(0,500)}; } return outcome; })()`;
            const restored = await execute(withBrowserReceipt(body, receipt), { timeout: 15000 });
            if (!restored.cleanup_complete) { operation.cleanupConfirmed = false; outcome = failed(operation, 'CLEANUP_FAILED', 'Browser cleanup failed'); }
            else { operation.cleanupConfirmed = true; outcome = operation.action.capability === 'ui.act'
              ? { ...operation.outcome, cleanup_complete: true } : await invoke(operation, 'reconcile'); }
          }
        } catch (error) {
          operation.transportUncertain = true;
          outcome = failed(operation, 'BROWSER_CALL_UNCERTAIN', String(error?.message ?? error).slice(0, 1000));
        }
        if (!operation.transportUncertain && outcome.status === 'FAILED' && outcome.cleanup_complete === true) {
          const attempt = outcome;
          outcome = await invoke(operation, 'reconcile');
          outcome.recovery_attempt = attempt;
        }
        operation.outcome = outcome;
        if (!operation.transportUncertain) operation.cleanupConfirmed = outcome.cleanup_complete === true;
        await remember(record, 'recovery_completed', outcome);
        const returned = { ...outcome, recovery_operation_id: recoveryOperationId };
        auxiliary.set(recoveryOperationId, { signature, outcome: structuredClone(returned) });
        if (!operation.transportUncertain && operation.cleanupConfirmed && ['SUCCEEDED', 'NOT_APPLIED'].includes(outcome.status)) pending = null;
        return returned;
      } finally { running = false; }
    },
    async observe({ signal, scope, cursor, rootRef, observationId, storageName } = {}) {
      signal?.throwIfAborted();
      if (scope !== undefined && !['bootstrap', 'all', 'palette', 'graph', 'dialogs', 'roots'].includes(scope)) throw new Error('Unknown observation scope');
      if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || scope !== undefined)) throw new Error('Use cursor alone to continue the original observation scope');
      if (cursor !== undefined && (rootRef !== undefined || observationId !== undefined)) throw new Error('Use cursor alone to continue the original root');
      if ((rootRef===undefined)!==(observationId===undefined) || (['bootstrap','roots'].includes(scope) && rootRef!==undefined)) throw new Error('Root requires root_ref and observation_id in a prepared workspace');
      if (rootRef!==undefined) {
        if (typeof rootRef!=='string' || !/^ui-[a-zA-Z0-9-]{1,124}$/.test(rootRef)) throw new Error('Root requires an observed opaque reference');
        observations.assertIssued(observationId,{ref:rootRef});
      }
      if (storageName!==undefined && (scope!=='roots' || cursor!==undefined || typeof storageName!=='string'
          || !storageName || storageName.length>200 || /[\\/\x00-\x1f\x7f]/.test(storageName))) throw new Error('storage_name requires roots scope and one filename');
      const selectedStorageName=cursor===undefined ? storageName : observations.filterForCursor(cursor)?.storage_name;
      const selectedRoot = cursor===undefined ? rootRef : observations.rootForCursor(cursor);
      if (scope === 'bootstrap') return execute(makeWorkspaceBootstrapCode({ origin: targetOrigin, build: targetBuild }), { signal, timeout: 5000 });
      const observationOperationId=randomUUID();
      const outcome = await execute(makeWorkspaceUiCode({ mode: 'observe', operation_id:observationOperationId, root_ref:selectedRoot, storage_name:selectedStorageName, discover_roots:scope==='roots' || (cursor!==undefined && observations.kindForCursor(cursor)==='roots'), expected_build: targetBuild, expected_origin: targetOrigin }), { signal, timeout: 35000 });
      await onRecord({operation_id:observationOperationId,phase:'observation_completed',outcome:structuredClone(outcome)});
      outcome.output.operation = view(pending).output;
      return cursor === undefined ? observations.retain(outcome, { scope }) : observations.next(cursor, outcome);
    },
    async uiAct(action, { observationId, operationId, recoveryOperationId, signal } = {}) {
      signal?.throwIfAborted(); checkId(operationId);
      if(pending?.action.capability==='artifact.upload')throw new Error('Upload is pending server verification; only observation and inspection are available');
      const signature = fingerprint('ui.act', [observationId, action, recoveryOperationId ?? null]);
      if (auxiliary.has(operationId)) {
        const previous = auxiliary.get(operationId);
        if (previous.signature !== signature) throw new Error('UI operation ID was already used with different parameters');
        return structuredClone(previous.outcome);
      }
      if (operations.has(operationId)) throw new Error('UI operation ID conflicts with an existing operation');
      const snapshot = observations.get(observationId);
      if (!snapshot) throw new Error('Observation is stale or belongs to another session; observe again');
      validateUiAction(action, snapshot);
      observations.assertIssued(observationId, action);
      if (running) throw new Error('Another Dock action is still running');
      if (recoveryOperationId && pending?.id !== recoveryOperationId) throw new Error('Recovery binding does not match the pending operation');
      if (pending && (!recoveryOperationId || pending.transportUncertain || !pending.cleanupConfirmed)) {
        throw new Error('Inspect the pending operation and confirm browser completion/cleanup before UI repair');
      }
      if (pending && (pending.recoveryAttempts ?? 0) >= 12) throw new Error('Recovery budget exhausted; report the unresolved state');
      const original = pending;
      // While a domain action is pending, repair only its known created node,
      // target node, or the corresponding editor/dialog. Unrelated graph items
      // remain protected by both ref scope and the original graph checkpoint.
      if (original) {
        const output = original.outcome?.output ?? {};
        const label = original.action.capability === 'node.add.v1'
          ? output.added_label ?? (output.added_labels?.length === 1 ? output.added_labels[0] : null)
          : original.action.capability === 'link.create.v1' ? original.parameters.target_node.node_label : null;
        const prefix = original.checkpoint.workflow_ref?.prefix;
        const references = [action.ref, action.source_ref, action.target_ref].filter(Boolean);
        for (const ref of references) {
          const element = snapshot.ui.elements.find(item => item.ref === ref);
          const tidValue = element?.tid ?? element?.identity?.anchor_tid ?? '';
          const owned = label && (tidValue === `${prefix};Graph;${label}` || tidValue.startsWith(`${prefix};Graph;${label};`));
          const source = original.action.capability === 'link.create.v1' && tidValue === original.checkpoint.source_tid
            && action.verb === 'drag' && action.source_ref === ref;
          const uiOwned = original.action.capability === 'ui.act' && original.checkpoint.target_tids?.includes(tidValue);
          const createdLink = original.action.capability === 'node.add.v1' && output.repairable_links?.includes(tidValue);
          const linkPrefix = `${prefix};Graph;${original.parameters.source_node?.node_label}|${original.checkpoint.source_tid?.split(';').at(-1)}|${original.parameters.target_node?.node_label}|`;
          const misplacedLink = original.action.capability === 'link.create.v1' && !output.reason
            && original.checkpoint.graph && output.added_links?.includes(tidValue)
            && !original.checkpoint.links.includes(tidValue) && tidValue.startsWith(linkPrefix)
            && !output.removed_links?.length && !output.removed_ports?.length;
          const editor = element?.kind === 'field' && (element?.scope === 'graph_editor' || tidValue === `${prefix};Graph`);
          const dialog = element?.scope === 'dialog' || !!element?.signature?.dialog_ref;
          if (!owned && !source && !uiOwned && !createdLink && !misplacedLink && !editor && !dialog) throw new Error('UI repair target is outside the pending operation; inspect its actual partial result');
        }
      }
      running = true;
      const uiOperation = { id: operationId, signature, action: { action_key: 'ui.act', revision: '1', capability: 'ui.act' },
        parameters: { action, observation_id: observationId, recovery_operation_id: recoveryOperationId ?? null },
        checkpoint: { workflow_ref: snapshot.workflow_ref, target_tids: [action.ref, action.source_ref, action.target_ref].filter(Boolean)
          .map(ref => snapshot.ui.elements.find(item => item.ref === ref)).map(item => item.tid ?? item.identity?.anchor_tid) }, deadline: now() + 30000 };
      const owner = original ?? uiOperation;
      try {
        await remember(uiOperation, 'prepared');
        if (original) original.recoveryAttempts = (original.recoveryAttempts ?? 0) + 1;
        else { operations.set(operationId, uiOperation); pending = uiOperation; }
        const receipt = receiptOptions(owner, operationId, 'ui.act', signature);
        observations.clear();
        let outcome;
        try {
          const code = makeWorkspaceUiCode({ mode: 'act', expected_build: targetBuild, expected_origin: targetOrigin,
            operation_id: operationId, action, snapshot });
          outcome = await execute(withBrowserReceipt(`(${code})(page)`, receipt), { timeout: 35000 });
        } catch (error) { owner.transportUncertain = true; outcome = failed(uiOperation, 'BROWSER_CALL_UNCERTAIN', String(error?.message ?? error).slice(0, 1000)); }
        if (!owner.transportUncertain) owner.cleanupConfirmed = outcome.cleanup_complete === true;
        uiOperation.outcome = outcome;
        await remember(uiOperation, 'completed', outcome);
        if (original && !owner.transportUncertain && owner.cleanupConfirmed) {
          const resolved = await reconcilePending();
          outcome.output.recovery = view(original, resolved).output;
        } else if (!original && !owner.transportUncertain && owner.cleanupConfirmed && outcome.status !== 'AMBIGUOUS') pending = null;
        outcome = retainObservation(outcome);
        auxiliary.set(operationId, { signature, outcome: structuredClone(outcome) });
        return outcome;
      } finally { running = false; }
    },
    async upload({artifactId,grantId,observationId,operationId,signal}={}) {
      signal?.throwIfAborted();checkId(operationId);
      if(!allowCandidate || !artifactStore)throw new Error('Artifact upload is available only in an authorized candidate session');
      const artifact=artifactStore.getUploadGrant(artifactId,grantId);
      const signature=fingerprint('artifact.upload',[artifactId,grantId,observationId]);
      if(auxiliary.has(operationId))throw new Error('Upload operation ID conflicts with another request');
      if(operations.has(operationId)) {
        const previous=operations.get(operationId);
        if(previous.signature!==signature || previous.action.capability!=='artifact.upload')throw new Error('Upload operation ID was already used with different parameters');
        return previous.outcome ? structuredClone(previous.outcome) : failed(previous,'OPERATION_STILL_PENDING','The browser operation is still running');
      }
      if(running || pending)throw new Error('Resolve the pending Dock operation before uploading');
      if(artifact.upload.overwrite!=='replace')throw new Error('reject upload policy is not implemented; it cannot be replaced implicitly');
      const snapshot=observations.get(observationId);
      if(!snapshot || snapshot.file_storage?.status!=='observed' || snapshot.file_storage.directory!==artifact.upload.directory)
        throw new Error('Observe the exact authorized Loginom storage directory before uploading');
      running=true;
      try {
        const lease=await artifactStore.stageUpload(artifactId);
        const operation={id:operationId,signature,uploadLease:lease,action:{action_key:'artifact.upload',revision:'1',capability:'artifact.upload'},
          parameters:{artifact_id:artifactId,upload_grant_id:grantId,observation_id:observationId,destination:artifact.upload.destination,overwrite:artifact.upload.overwrite},
          checkpoint:{workflow_ref:snapshot.workflow_ref,file_storage:snapshot.file_storage,storage_root_ref:snapshot.observation_root?.ref ?? null,artifact},deadline:now()+30000};
        try {await lease.verify();signal?.throwIfAborted();await remember(operation,'prepared');signal?.throwIfAborted();}
        catch(error){await lease.release();throw error;}
        operations.set(operationId,operation);pending=operation;observations.clear();
        let outcome;
        try {
          const receipt=receiptOptions(operation,operationId,'artifact.upload',signature);
          const code=makeArtifactUploadCode({operation_id:operationId,artifact,upload_path:lease.path,snapshot,
            expected_build:targetBuild,expected_origin:targetOrigin});
          outcome=assertActionOutcome(await execute(withBrowserReceipt(`(${code})(page)`,receipt),{timeout:35000}));
          if(outcome.operation_id!==operationId || outcome.action_key!=='artifact.upload' || outcome.action_revision!=='1')
            throw new Error('Upload receipt identity mismatch');
        } catch {operation.transportUncertain=true;outcome=failed(operation,'BROWSER_CALL_UNCERTAIN','Inspect the upload receipt before any further mutation');}
        operation.cleanupConfirmed=!operation.transportUncertain && outcome.cleanup_complete===true;
        operation.outcome=outcome;
        await remember(operation,'completed',outcome);
        if(!operation.transportUncertain && outcome.status==='NOT_APPLIED' && operation.cleanupConfirmed) {
          await lease.release();pending=null;
        }
        return structuredClone(outcome);
      } finally {running=false;}
    },
    async verifyArtifact({operationId,verificationId,observationId,fileRef,signal}={}) {
      signal?.throwIfAborted();checkId(operationId);checkId(verificationId);
      if(!allowCandidate || !artifactStore)throw new Error('Artifact verification is available only in a candidate session');
      const signature=fingerprint('artifact.verify',[operationId,observationId,fileRef]);
      const operation=operations.get(operationId);
      if(operations.has(verificationId))throw new Error('Verification ID conflicts with an existing operation');
      if(auxiliary.has(verificationId)) {
        const previous=auxiliary.get(verificationId);
        if(previous.signature!==signature)throw new Error('Verification ID was already used with different parameters');
        return structuredClone(previous.outcome);
      }
      if(operation?.verification?.id===verificationId) {
        if(operation.verification.signature!==signature)throw new Error('Verification ID was already used with different parameters');
        return structuredClone(operation.verification.outcome ?? failed(operation.verification,'OPERATION_STILL_PENDING','Inspect the original upload to reconcile its download'));
      }
      if(running || !operation || pending!==operation || operation.action.capability!=='artifact.upload'
        || operation.transportUncertain || !operation.cleanupConfirmed || (operation.verification && !operation.verification.settled))
        throw new Error('Inspect and confirm the pending upload browser receipt before verifying its file');
      const snapshot=observations.get(observationId);
      if(!snapshot)throw new Error('Observe the authorized file row before verifying');
      observations.assertIssued(observationId,{ref:fileRef});
      const options={operation_id:verificationId,upload_operation_id:operationId,observation_id:observationId,file_ref:fileRef,
        snapshot,artifact:operation.checkpoint.artifact,storage_root_ref:operation.checkpoint.storage_root_ref,
        expected_build:targetBuild,expected_origin:targetOrigin};
      // Validate exact file identity before allocating any download lease.
      makeArtifactDownloadCode(options);
      running=true;
      try {
        const lease=await artifactStore.stageDownload(operation.parameters.artifact_id);
        const attempt={id:verificationId,signature,lease,action:{action_key:'artifact.verify',revision:'1',capability:'artifact.verify'},
          parameters:{upload_operation_id:operationId,observation_id:observationId,file_ref:fileRef},checkpoint:{artifact:options.artifact},deadline:now()+60000};
        try {signal?.throwIfAborted();await remember(attempt,'download_prepared');signal?.throwIfAborted();}
        catch(error){await lease.release();throw error;}
        operation.verification=attempt;observations.clear();
        const receipt=receiptOptions(operation,verificationId,'artifact.download',signature);
        let raw;
        try {
          const code=makeArtifactDownloadCode({...options,download_path:lease.path});
          raw=await execute(withBrowserReceipt(`(${code})(page)`,receipt),{timeout:65000});
        } catch {
          operation.transportUncertain=true;operation.cleanupConfirmed=false;
          attempt.outcome=failed(attempt,'BROWSER_CALL_UNCERTAIN','Inspect the original upload before any repeated download');
          await remember(attempt,'download_transport_uncertain',attempt.outcome);
          return structuredClone(attempt.outcome);
        }
        return structuredClone(await finishArtifactVerification(operation,attempt,raw));
      } finally {running=false;}
    },
    async run(actionKey, parameters, { signal, operationId } = {}) {
      signal?.throwIfAborted();
      const action = find(actionKey);
      validateActionParameters(action.input_schema, parameters);
      if (operationId !== undefined && (typeof operationId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(operationId))) {
        throw new Error('operation_id must be a stable identifier with at most 128 characters');
      }
      if (running) throw new Error('Another Dock action is still running');
      running = true;
      try {
        const signature = fingerprint(actionKey, parameters);
        if (operationId && auxiliary.has(operationId)) throw new Error('Operation ID conflicts with a recovery or UI operation');
        if (operationId && operations.has(operationId) && operations.get(operationId).signature !== signature) {
          throw new Error('operation_id was already used with different parameters');
        }
        if (pending) {
          const reconciled = await reconcilePending();
          if (pending || (operationId && operationId === reconciled.operation_id) || signature === operations.get(reconciled.operation_id)?.signature) return reconciled;
        }
        if (operationId && operations.has(operationId)) {
          const previous = operations.get(operationId);
          if (previous.signature !== signature) throw new Error('operation_id was already used with different parameters');
          return structuredClone(previous.outcome);
        }
        const operation = { id: operationId ?? randomUUID(), action, signature, parameters: structuredClone(parameters) };
        let prepared;
        try { prepared = await invoke(operation, 'prepare', { signal }); }
        catch (error) { return failed(operation, 'PREFLIGHT_FAILED', String(error?.message ?? error).slice(0, 1000), 'FAILED'); }
        if (prepared.status !== 'NOT_APPLIED' || prepared.phase !== 'prepared' || !prepared.checkpoint?.workflow_ref) return prepared;
        operation.checkpoint = prepared.checkpoint;
        signal?.throwIfAborted();
        operation.deadline = now() + action.timeout_ms;
        await remember(operation, 'prepared');
        signal?.throwIfAborted();
        operations.set(operation.id, operation);
        pending = operation;
        observations.clear();
        let outcome;
        try {
          // Keep the browser gate until the bounded mutation reports completion,
          // even when its caller cancels. Cancellation never frees a live action.
          outcome = await invoke(operation, 'apply');
        } catch (error) {
          operation.transportUncertain = true;
          outcome = failed(operation, 'BROWSER_CALL_UNCERTAIN', String(error?.message ?? error).slice(0, 1000));
        }
        operation.outcome = outcome;
        operation.cleanupConfirmed = outcome.cleanup_complete === true;
        try { await remember(operation, 'completed', outcome); }
        catch (error) {
          operation.outcome = failed(operation, 'EVIDENCE_WRITE_FAILED', String(error?.message ?? error).slice(0, 1000));
          return operation.outcome;
        }
        if (outcome.status !== 'AMBIGUOUS' && operation.cleanupConfirmed) pending = null;
        return outcome;
      } finally { running = false; }
    },
  });
}
