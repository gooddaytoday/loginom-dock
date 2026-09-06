// The model receives opaque observed references, never executable selectors or
// browser code. All browser-side inspection and gestures below are client-pinned.
export const uiActionSchema = {
  type: 'object', additionalProperties: false, required: ['verb'],
  properties: {
    verb: { type: 'string', enum: ['click', 'double_click', 'right_click', 'fill', 'press', 'drag', 'scroll', 'set_checked', 'replace_expression', 'set_wizard_field', 'wizard_step', 'select_wizard_option'] },
    expected_stage: { type: 'string', enum: ['text_import_file','text_import_format','input_mapping','output_mapping','calculator','grouping','done'] },
    checked: { type: 'boolean' },
    delta_y: { type: 'integer', minimum: -1000, maximum: 1000 },
    ref: { type: 'string', maxLength: 128 }, text: { type: 'string', maxLength: 2048 },
    key: { type: 'string', enum: ['Enter', 'Escape', 'Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete', 'Space', 'F2'] },
    source_ref: { type: 'string', maxLength: 128 }, target_ref: { type: 'string', maxLength: 128 },
  },
};

export function validateUiAction(action, snapshot) {
  if (!action || typeof action !== 'object' || Array.isArray(action) || !uiActionSchema.properties.verb.enum.includes(action.verb)) throw new Error('Unsupported observed UI action');
  const fields = action.verb === 'wizard_step' ? ['verb','ref','expected_stage'] : action.verb === 'drag' ? ['verb', 'source_ref', 'target_ref']
    : ['fill','replace_expression','set_wizard_field'].includes(action.verb) ? ['verb', 'ref', 'text'] : action.verb === 'press' ? ['verb', 'ref', 'key'] : action.verb === 'scroll' ? ['verb', 'ref', 'delta_y'] : action.verb === 'set_checked' ? ['verb','ref','checked'] : ['verb', 'ref'];
  if (Object.keys(action).some(key => !fields.includes(key)) || fields.some(key => !(key in action))) throw new Error('UI action fields do not match its verb');
  const refs = action.verb === 'drag' ? [action.source_ref, action.target_ref] : [action.ref];
  if (refs.some(ref => typeof ref !== 'string' || !/^ui-[a-zA-Z0-9-]{1,124}$/.test(ref))) throw new Error('UI action requires opaque observed references: copy the element.ref value beginning with ui- from the delivered observation; tid and identity.anchor_tid are not action refs');
  if (action.verb === 'drag' && action.source_ref === action.target_ref) throw new Error('Drag requires different source and target references');
  if (['fill','replace_expression','set_wizard_field'].includes(action.verb) && (typeof action.text !== 'string' || action.text.length > 2048 || /\0/.test(action.text))) throw new Error('UI text must be at most 2048 characters without NUL');
  if(action.verb==='set_wizard_field' && (action.text.length>256 || /[\r\n]/.test(action.text)))throw new Error('Wizard field text requires at most 256 characters without line breaks');
  if(action.verb==='replace_expression' && (/\r/.test(action.text) || action.text.split('\n').length>128))throw new Error('Expression replacement requires LF lines, at most 128');
  if(action.verb==='wizard_step' && !uiActionSchema.properties.expected_stage.enum.includes(action.expected_stage))throw new Error('wizard_step requires a recognized expected_stage');
  if (action.verb === 'press' && !uiActionSchema.properties.key.enum.includes(action.key)) throw new Error('Unsupported UI key; clipboard and navigation shortcuts are not allowed');
  if (action.verb === 'scroll' && (!Number.isInteger(action.delta_y) || !action.delta_y || Math.abs(action.delta_y)>1000)) throw new Error('Scroll requires a nonzero integer delta_y within -1000..1000');
  if (action.verb === 'set_checked' && typeof action.checked !== 'boolean') throw new Error('set_checked requires a boolean checked value');
  if (snapshot) {
    if(action.verb==='wizard_step' && (snapshot.wizard?.status!=='observed' || snapshot.wizard.stage===action.expected_stage))throw new Error('wizard_step requires a different destination stage and an observed wizard');
    if (!Array.isArray(snapshot.ui?.elements)) throw new Error('UI action requires an observation snapshot');
    for (const ref of refs) {
      const elements = snapshot.ui.elements.filter(element => element.ref === ref);
      if (elements.length !== 1 || !elements[0].allowed_actions?.includes(action.verb)) throw new Error('UI reference is absent, ambiguous, or does not support this action');
      if(action.verb==='set_wizard_field' && action.text.length>elements[0].wizard_field.max_length_utf16)throw new Error('Wizard text exceeds the observed native input limit; select an observed option instead of typing its label');
      if (action.verb==='set_checked' && elements[0].check_state?.kind==='radio' && !action.checked) throw new Error('Select the desired radio option; a radio cannot be independently unchecked');
    }
  }
  return action;
}

function workspaceUiCapability(page, task) {
  const started = Date.now(), deadline = started + 15000;
  const trace = [], handles = [];
  let phase = 'observing', effectPossible = false, mouseHeld = false, mouseButton = 'left';
  const record = (event, details = {}) => trace.push({ at_ms: Date.now() - started, event, ...details });
  const result = (status, output = {}, error = null) => ({ status, action_key: task.mode === 'observe' ? 'workspace.observe' : 'ui.act',
    action_revision: '1', operation_id: task.operation_id ?? null, phase, effect_possible: effectPossible, output, error, trace });
  const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
  const timeout = () => { const left = deadline - Date.now(); if (left <= 0) fail('UI_DEADLINE_EXCEEDED', 'Observed UI action deadline exceeded'); return left; };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  // A WeakMap records DOM incarnations, without adding attributes or mutating
  // Loginom. Re-rendering an identical-looking control invalidates its old ref.
  // The state is document-bound; navigation invalidates every previous reference.
  const readUi = async (rediscover = false) => {
    const observed = await page.evaluate(({rootRef,discoverRoots,storageName}) => {
    try {
    const scanStarted = Date.now(), maxElements = 6000, maxWork = 250000, maxMs = 500;
    let work = 0;
    const charge = () => {
      if (++work > maxWork || Date.now() - scanStarted > maxMs) {
        const error = new Error('Workspace scan budget exceeded; no complete observation or action references were issued');
        error.code = 'UI_SCAN_LIMIT'; throw error;
      }
    };
    const stateKey = Symbol.for('loginom-dock.workspace-ui.identity.v1');
    let state = globalThis[stateKey];
    if (!state || state.document !== document) {
      state = { document, ids: new WeakMap(), sequence: 0, epoch: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      Object.defineProperty(globalThis, stateKey, { value: state, configurable: true });
    }
    if (!state.observer) {
      if (typeof MutationObserver !== 'function') {
        const error = new Error('DOM mutation tracking is unavailable'); error.code = 'UI_EPOCH_UNAVAILABLE'; throw error;
      }
      state.revision = 0;
      // Diagnostic counters never waive the epoch guard. Retain no DOM nodes,
      // text, attribute values or arbitrary attribute/class names.
      state.mutations={cursor_style:0,other_style:0,attributes:0,child_list:0,text:0,other:0,unclassified:0,ignored_cursor_blink:0};
      state.captureMutations=records=>{
        state.revision+=records.length;
        for(const record of records.slice(0,128)) {
          let kind='other';
          if(record.type==='attributes') {
            const cursor=record.target?.classList?.contains('CodeMirror-cursors') || record.target?.classList?.contains('CodeMirror-cursor');
            kind=record.attributeName==='style'?(cursor?'cursor_style':'other_style'):'attributes';
          } else if(record.type==='childList')kind='child_list';
          else if(record.type==='characterData')kind='text';
          state.mutations[kind]++;
          // CodeMirror5 restartBlink toggles ONLY cursorDiv.style.visibility.
          // Restrict the exemption to that owned container and empty/hidden
          // inline style. Any geometry/style ABA has a nonmatching oldValue in
          // its batch and still changes the epoch. No style strings are retained.
          const target=record.target;
          if(record.type==='attributes' && record.attributeName==='style' && target?.isConnected
            && target.classList?.contains('CodeMirror-cursors')) {
            const editor=target.closest('[data-tid$=";WizrdMCF;CalcDataWizard;cmpExpression"]');
            const wrapper=target.closest('.CodeMirror');
            const visibilityOnly=value=>value===null || typeof value==='string' && /^\s*(?:visibility\s*:\s*hidden\s*;?\s*)?$/.test(value);
            if(editor && wrapper && editor.contains(wrapper) && wrapper.CodeMirror?.getWrapperElement?.()===wrapper
              && visibilityOnly(record.oldValue) && visibilityOnly(target.getAttribute('style'))) {
              state.revision--;state.mutations.ignored_cursor_blink++;
            }
          }
        }
        state.mutations.unclassified+=Math.max(0,records.length-128);
      };
      state.observer = new MutationObserver(records => state.captureMutations(records));
      state.observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true,attributeOldValue:true,characterData:true});
    }
    // Delivery of the observer callback may lag behind a new synchronous read.
    state.captureMutations(state.observer.takeRecords());
    if (!Number.isSafeInteger(state.revision)) {
      const error = new Error('DOM mutation revision overflow'); error.code = 'UI_EPOCH_UNAVAILABLE'; throw error;
    }
    const refOf = element => {
      if (!state.ids.has(element)) state.ids.set(element, `ui-${state.epoch}-${++state.sequence}`);
      const ref=state.ids.get(element);
      state.refs ??= new Map();
      if (!state.refs.has(ref)) state.refs.set(ref,new WeakRef(element));
      while (state.refs.size>4096) state.refs.delete(state.refs.keys().next().value);
      return ref;
    };
    const requestedRoot = rootRef ? state.refs?.get(rootRef)?.deref() : null;
    if (rootRef && !requestedRoot?.isConnected) {
      const error=new Error('Observed root is detached or its reference expired');error.code='UI_ROOT_STALE';throw error;
    }
    const dom = [], seenElements = new Set();
    const include = element => {
      charge(); if (seenElements.has(element)) return;
      if (dom.length >= maxElements) { const error=new Error('Selected region or global guards exceed the scan budget');error.code='UI_SCAN_LIMIT';throw error; }
      seenElements.add(element);dom.push(element);
    };
    const regionSelector='[data-tid$=";PreviewForm;DataSetForm"],[data-tid$=";ViewsForm;BrowseView"],[data-tid="MF;cntMain;tlbMainToolbar"],[role="dialog"],.x-window,.bg-dialog,[role="grid"],table,[role="form"],[data-tid$=";WizrdMCF"],[data-tid$=";boundlist"],[data-tid$=";MapTreeForm;tree"],[data-tid$=";cmpDiagram"],[data-tid$=";pnlWorkarea"],[data-tid$="NavigationBar;NavigationPanel"]';
    // E2E utils/selectors.Format: whitespace -> underscore, comma removed.
    // This finds candidates, not filesystem identity or absence. CSS hex escapes
    // keep arbitrary filename characters data rather than selector syntax.
    const storageSuffix=storageName===null ? null : ';FileStorageForm;colName_'+storageName.replace(/\s/g,'_').replace(/,/g,'');
    const storageSelector=storageSuffix===null ? null : '[data-tid$="'+Array.from(storageSuffix,char=>'\\'+char.codePointAt(0).toString(16)+' ').join('')+'"]';
    const regionElements=discoverRoots ? [...document.querySelectorAll(storageSelector ?? regionSelector)] : [];
    charge();
    if (discoverRoots) for (const element of regionElements) include(element);
    const walker=discoverRoots ? null : document.createTreeWalker(requestedRoot ?? document.documentElement,1);
    if (requestedRoot) include(requestedRoot);
    let next, traversed=0;while (walker && (next=walker.nextNode())) {
      if (++traversed>maxElements) { const error=new Error('DOM traversal exceeds the scan budget');error.code='UI_SCAN_LIMIT';throw error; }
      include(next);
    }
    const detailElements=dom.length;
    // E2E bg/selectors.ts wizard lifecycle and P3 wizard selectors. These
    // fixed markers expose the current page without scanning its whole tree.
    const wizardMarkers={text_import_file:';ImportTextFilePreviewWizard;edtFileName',
      text_import_format:';ImportTextFileParamsWizard;edtValueNull',
      input_mapping:';TuneDataSourceInputPortWizard;btnAddMappingColumn',
      output_mapping:';ColumnsMappingEngineOutputPortWizard;btnAddMappingColumn',
      calculator:';CalcDataWizard;btnAddExpr',grouping:';GroupDataWizard;grdUsedFields;tbl',
      done:';DoneWizard;edtDisplayName'};
    const wizardButtons=['btnPrev','btnNext','btnDone','btnExecute','btnClose','btnError'];
    const wizardSelectors=['[data-tid$=";WizrdMCF"]','[data-tid$=";WizrdMCF;cardWizardPanel;p.h;p.t"]',
      ...Object.values(wizardMarkers).map(suffix=>'[data-tid$=";WizrdMCF'+suffix+'"]'),
      '[data-tid*=";WizrdMCF;CalcDataWizard;colExpressionName_"]','[data-tid$=";WizrdMCF;CalcDataWizard;cmpExpression"]','[data-tid$=";WizrdMCF;CalcDataWizard;btnCalcMode"]','span.bg-TBGCalcMode-cmExpression,span.bg-TBGCalcMode-cmJavaScript',
      ...['edtDelimiterChar','edtTextQualifier','edtValueNull','edtDecimalSeparator'].flatMap(name=>{const owner='[data-tid$=";WizrdMCF;ImportTextFileParamsWizard;'+name+';ValueControl"]';return [owner,owner+' input',owner+' textarea'];}),
      '[data-tid$=";WizrdMCF;ExprDataEditForm"]',
      ...['edtName','edtDisplayName','cbxDataType'].flatMap(name=>{const owner='[data-tid$=";WizrdMCF;ExprDataEditForm;'+name+'"]';return [owner,owner+' input'];}),
      ...wizardButtons.map(name=>'[data-tid$=";WizrdMCF;'+name+'"]')].join(',');
    if (requestedRoot || discoverRoots) {
      // Native fixed queries discover global blockers/context without walking
      // every unrelated subtree in JavaScript. Their synchronous browser cost
      // cannot be preempted; charge immediately after each native operation.
      const guards=document.querySelectorAll(wizardSelectors+',[data-tid="MF;cntMain;tlbMainToolbar;btnAvatar"],.x-tab-active[data-tid],[role="dialog"],.x-window,.bg-dialog,.bg-mask-message,.x-mask-msg,[role="alert"],[role="status"],.bg-message,.x-message-box,.x-form-invalid-under,[data-tid$="FileStorageForm;pnlFileStorage;tbl"]');
      charge();for (const element of guards) include(element);
    }
    const select = selector => dom.filter(element => { charge(); return element.matches(selector); });
    const all = select('[data-tid]'), tids = new Map();
    for (const element of all) { const tid = element.getAttribute('data-tid'); const list = tids.get(tid) ?? []; list.push(element); tids.set(tid, list); }
    const getTid = element => element?.getAttribute?.('data-tid') ?? null;
    const boxOf = element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const visible = element => {
      if (!element?.isConnected) return false;
      const box = boxOf(element);
      const graphLink = /^MF;TF(?:-\d+)?;Graph;[^;|]+\|[^;|]+\|[^;|]+\|[^;|]+$/.test(getTid(element) ?? '');
      if (!(box.width > 0 && box.height > 0) && !(graphLink && box.width >= 0 && box.height >= 0 && (box.width > 0 || box.height > 0))) return false;
      for (let parent = element; parent; parent = parent.parentElement) {
        charge();
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || parent.hasAttribute('hidden')) return false;
      }
      return true;
    };
    const sensitivePattern = /password|passwd|\bpwd\b|secret|token|credential|authorization|api[_ -]?key|private[_ -]?key|one[_ -]?time|\botp\b|парол|секрет|токен/i;
    const sensitive = element => {
      for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) {
        charge();
        if (parent.matches('input[type="password"],input[type="hidden"],input[type="file"]')) return true;
        if (sensitivePattern.test(['name', 'id', 'data-tid', 'autocomplete', 'aria-label'].map(name => parent.getAttribute(name) ?? '').join(' ')) || (getTid(parent) ?? '').startsWith('LoginForm;')) return true;
      }
      return false;
    };
    const short = (value, limit = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
    const textOf = (element, fixedContext=false) => {
      if (sensitive(element)) return '[REDACTED]';
      if (discoverRoots && !fixedContext) return short(element.getAttribute('aria-label') || element.getAttribute('title') || '');
      if (!fixedContext && requestedRoot && element!==requestedRoot && !requestedRoot.contains(element)
          && !(getTid(element) ?? '').startsWith('MF;cntMain;cntWorkspace;Workspace;t.br;tb')) return '[outside selected root]';
      const parts = [], walker = document.createTreeWalker(element, 4);
      let textNode, length = 0;
      while ((textNode = walker.nextNode()) && length < 2000) {
        charge();
        if (textNode.parentElement && !sensitive(textNode.parentElement) && visible(textNode.parentElement)
          && !textNode.parentElement.closest('script,style,noscript,textarea')) {
          const value = textNode.textContent ?? ''; parts.push(value); length += value.length;
        }
      }
      return short(parts.join(' '));
    };
    const identityOf = element => {
      const path = [];
      for (let parent = element, depth = 0; parent && depth < 64; depth++, parent = parent.parentElement) {
        charge();
        const tid = getTid(parent);
        if (tid && tids.get(tid)?.length === 1) return { anchor_tid: tid, path };
        if (parent === document.documentElement) return { anchor_tid: null, path };
        if (!parent.parentElement) break;
        path.unshift([...parent.parentElement.children].indexOf(parent));
      }
      return null;
    };
    const enabled = element => !element.matches(':disabled') && !element.closest('[aria-disabled="true"],.x-item-disabled,.x-btn-disabled');
    const dangerous = element => sensitive(element) || !!element.closest('a[href],iframe,object,embed')
      || element.matches('input[type="url"],input[type="file"],input[type="hidden"]')
      || /(?:^|[;_ -])(?:script|javascript|python|codeeditor)(?:[;_ -]|$)/i.test(['name', 'id', 'data-tid'].map(key => element.getAttribute(key) ?? '').join(' '))
      || !!element.closest('.monaco-editor,.CodeMirror,.ace_editor,[data-tid$=";WizrdMCF;CalcDataWizard;cmpExpression"]');
    const dialogElements = select('[role="dialog"],.x-window,.bg-dialog').filter(visible)
      .filter((element, index, items) => !items.some((other, i) => i !== index && other.contains(element)));
    const dialogs = dialogElements.map(element => ({ ref: refOf(element), title: short(element.getAttribute('aria-label') ?? select('[role="heading"],.x-title-text').find(item => element.contains(item))?.textContent),
        text: textOf(element), bounding_box: boxOf(element), z_index: Number(getComputedStyle(element).zIndex) || 0, identity: identityOf(element) }));
    const dialogRef = element => {
      const owner = dialogElements.find(dialog => dialog === element || dialog.contains(element));
      return owner ? refOf(owner) : null;
    };
    const activeTabs = all.filter(element => (getTid(element) ?? '').startsWith('MF;cntMain;cntWorkspace;Workspace;t.br;tb') && element.classList.contains('x-tab-active') && visible(element));
    const active = activeTabs.length === 1 ? activeTabs[0] : null;
    const match = /^MF;cntMain;cntWorkspace;Workspace;t\.br;tb(?:-(\d+))?$/.exec(getTid(active) ?? '');
    const workflow = match ? { tab_tid: getTid(active), prefix: match[1] ? `MF;TF-${match[1]}` : 'MF;TF' } : null;
    const scopeOf = element => {
      if (dialogRef(element)) return 'dialog';
      let workflowAncestor = false, graphAncestor = false;
      for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) {
        charge();
        const tid = getTid(parent) ?? '', owner = /^(MF;TF(?:-\d+)?);/.exec(tid)?.[1];
        if (owner && owner !== workflow?.prefix) return 'inactive_workflow';
        if (owner) workflowAncestor = true;
        if (workflow && tid === workflow.prefix + ';ModelForm;cmpDiagram') graphAncestor = true;
      }
      if (graphAncestor && element.matches('textarea,input,[contenteditable="true"]')) return 'graph_editor';
      if ((getTid(element) ?? '').startsWith(workflow?.prefix + ';Graph;')) return 'graph';
      return workflowAncestor ? 'workflow' : 'global';
    };
    const wizardForms=all.filter(element=>getTid(element)===workflow?.prefix+';WizrdMCF' && visible(element) && !sensitive(element));
    let wizard={status:wizardForms.length?'ambiguous':'absent'};
    if (wizardForms.length===1) {
      const form=wizardForms[0],base=getTid(form);
      const matching=suffix=>(tids.get(base+suffix)??[]).filter(element=>form.contains(element) && visible(element) && !sensitive(element));
      const titles=matching(';cardWizardPanel;p.h;p.t');
      const stages=Object.entries(wizardMarkers).filter(([,suffix])=>matching(suffix).length===1).map(([key])=>key);
      wizard={status:'observed',root_tid:base,root_ref:refOf(form),title:titles.length===1?textOf(titles[0],true):null,
        title_status:titles.length===1?'observed':titles.length?'ambiguous':'unobserved',
        stage:stages.length===1?stages[0]:null,stage_status:stages.length===1?'observed':stages.length?'ambiguous':'unrecognized',
        controls:Object.fromEntries(wizardButtons.map(name=>{const found=matching(';'+name);return [name,
          {status:found.length===1?'observed':found.length?'ambiguous':'unobserved',enabled:found.length===1?enabled(found[0]):null}];}))};
    }
    if(wizard.status==='observed' && wizard.stage==='calculator') {
      // This native dialog is a sibling of the wizard, not its descendant.
      // E2E sCalculator.edit: expose bounded UI values, never applied proof.
      const base=wizard.root_tid+';ExprDataEditForm';
      const forms=(tids.get(base)??[]).filter(e=>visible(e) && !sensitive(e));
      if(forms.length) {
        wizard.expression_parameters={status:forms.length===1?'observed':'ambiguous',applied_verified:false};
        if(forms.length===1) {
          wizard.expression_parameters.root_ref=refOf(forms[0]);
          wizard.expression_parameters.fields=Object.fromEntries(Object.entries({name:'edtName',label:'edtDisplayName',type_label:'cbxDataType'}).map(([name,key])=>{
            const owners=(tids.get(base+';'+key)??[]).filter(e=>forms[0].contains(e) && visible(e) && !sensitive(e));
            const inputs=owners.length===1?dom.filter(e=>{charge();return owners[0].contains(e) && e.matches('input') && visible(e) && !sensitive(e);}):[];
            if(owners.length!==1 || inputs.length!==1)return [name,{status:owners.length>1 || inputs.length>1?'ambiguous':'unobserved'}];
            const value=String(inputs[0].value??'');
            return [name,{status:'observed',value:value.slice(0,256),value_length_utf16:value.length,truncated:value.length>256,
              input_ref:refOf(inputs[0]),owner_ref:refOf(owners[0]),enabled:enabled(inputs[0]),read_only:inputs[0].readOnly===true}];
          }));
        }
      }
    }
    const wizardFields=new Map(),wizardCombos=new Map();
    if(wizard.status==='observed' && wizard.stage==='text_import_format') {
      const base=wizard.root_tid+';ImportTextFileParamsWizard;';
      const fields={delimiter:'edtDelimiterChar',text_qualifier:'edtTextQualifier',null_marker:'edtValueNull',decimal_separator:'edtDecimalSeparator'};
      wizard.settings={status:'draft_ui_values',applied_verified:false,fields:Object.fromEntries(Object.entries(fields).map(([name,key])=>{
        const owners=(tids.get(base+key+';ValueControl')??[]).filter(item=>wizardForms[0].contains(item) && visible(item) && !sensitive(item));
        const inputs=owners.length===1?dom.filter(item=>{charge();return owners[0].contains(item) && item.matches('input:not([type="hidden"]),textarea') && visible(item) && !sensitive(item);}):[];
        if(owners.length!==1 || inputs.length!==1)return [name,{status:owners.length>1 || inputs.length>1?'ambiguous':'unobserved'}];
        const input=inputs[0],value=String(input.value??'');
        const ownerTid=base+key+';ValueControl';
        if(enabled(input) && value.length<=256)wizardCombos.set(ownerTid,{name,owner_ref:refOf(owners[0]),input_ref:refOf(input),root_ref:wizard.root_ref,value});
        const rawMax=input.getAttribute('maxlength'),nativeMax=rawMax!==null && /^\d+$/.test(rawMax) && Number.isSafeInteger(Number(rawMax))?Number(rawMax):null;
        if(value.length<=256 && !/[\0\r\n]/.test(value) && !input.readOnly && enabled(input))
          wizardFields.set(input,{name,max_length_utf16:Math.min(256,nativeMax??256),stage:wizard.stage,root_ref:refOf(wizardForms[0]),owner_ref:refOf(owners[0])});
        return [name,{status:'observed',value:value.slice(0,256),value_length_utf16:value.length,truncated:value.length>256,
          enabled:enabled(input),read_only:input.readOnly===true,source_tid:ownerTid,input_ref:refOf(input),owner_ref:refOf(owners[0]),value_kind:'displayed_input_text',native_max_length_utf16:nativeMax}];
      }))};
    }
    if (discoverRoots) {
      const regions=regionElements.filter(element=>visible(element) && !sensitive(element) && scopeOf(element)!=='inactive_workflow')
        // Deliver the current wizard root before its tables, so a changing form
        // can be read narrowly without paging through those tables first.
        .sort((a,b)=>{const rank=e=>getTid(e)===workflow?.prefix+';WizrdMCF'?0:wizardCombos.has((getTid(e)??'').replace(/;boundlist$/,'')) && (getTid(e)??'').endsWith(';boundlist')?1:(getTid(e)??'').endsWith(';MapTreeForm;tree')?2:3;return rank(a)-rank(b);});
      const elements=regions.slice(0,240).map(element=>({ref:refOf(element),tid:getTid(element),identity:identityOf(element),
        kind:'region',label:textOf(element),scope:scopeOf(element),visible:true,enabled:enabled(element),allowed_actions:[],
        signature:{tag:element.tagName.toLowerCase()},bounding_box:boxOf(element)}));
      return {origin:location.origin,authenticated:!!tids.get('MF;cntMain;tlbMainToolbar;btnAvatar')?.some(visible),
        loginom_build:globalThis.bg?.app?.Version ?? null,workflow_ref:workflow,active_identity:active ? textOf(active) : null,
        dom_epoch:{document:state.epoch,revision:state.revision},observation_kind:'roots',wizard,
        ...(storageName===null?{}:{observation_filter:{storage_name:storageName}}),
        scan:{complete:true,mutation_counts:{...state.mutations},visited_elements:dom.length,detail_elements:0,max_elements:maxElements,max_work:maxWork,max_ms:maxMs},
        nodes:[],links:[],ui:{elements,dialogs:[],messages:[],masks:[],table_cells:[],
          truncated:{elements:regions.length>240,nodes:true,links:true,ports:true,dialogs:true,messages:true,masks:true,table_cells:true}}};
    }
    const candidates = select('button,input,textarea,select,[contenteditable="true"],[role="button"],[role="checkbox"],[role="radio"],[role="combobox"],[role="menuitem"],[role="tab"],[role="treeitem"],[role="option"],[role="spinbutton"],[data-tid]')
      .filter(element => visible(element) && !sensitive(element) && scopeOf(element) !== 'inactive_workflow');
    const selectedRoot = rootRef ? dom.find(element=>state.ids.get(element)===rootRef) : null;
    if (rootRef && (!selectedRoot || !visible(selectedRoot) || sensitive(selectedRoot) || scopeOf(selectedRoot)==='inactive_workflow')) {
      const error=new Error('Observed root is detached, hidden or belongs to another workspace');error.code='UI_ROOT_STALE';throw error;
    }
    const comboPart=element=>{
      const tid=getTid(element)??'';
      for(const [ownerTid,field] of wizardCombos) {
        if(tid===ownerTid+';trg_picker')return {kind:'picker',field};
        const prefix=ownerTid+';boundlist;';
        if(!tid.startsWith(prefix) || !tid.slice(prefix.length) || tid.slice(prefix.length).includes(';'))continue;
        const lists=(tids.get(ownerTid+';boundlist')??[]).filter(visible);
        if(lists.length!==1 || !lists[0].contains(element) || sensitive(lists[0]))return null;
        const label=textOf(element,true),formatted=label.replace(/\s/g,'_').replace(/,/g,'');
        if(!label || label.length>=240 || tid!==prefix+formatted)return null;
        return {kind:'option',field,list_ref:refOf(lists[0]),label};
      }
      return null;
    };
    const interesting = element => !!comboPart(element) || element.matches('button,input,textarea,select,[contenteditable="true"],[role="button"],[role="checkbox"],[role="radio"],[role="combobox"],[role="menuitem"],[role="tab"],[role="treeitem"],[role="option"],[role="spinbutton"]')
      || /;(?:Input|Output)_[^;]+$|;Label;Label$|;Graph;[^;]+$|;btn[^;]+$|;edt[^;]+$|;mi[^;]+$|;tb(?:-\d+)?$/.test(getTid(element) ?? '')
      // Pinned E2E bg/selectors.ts:272,279,286: palette tree labels and
      // expanders are spans without button/treeitem roles in some UI builds.
      || /;ModelForm;colVendors_Компоненты>[^;]+;(?:TreeText|TreeExpander)$/.test(getTid(element) ?? '')
      // E2E helpers/navigation.ts ByPanel and live MapTreeForm: navigation
      // labels/expanders have no ARIA role. Only exact navigation tree parts.
      || /^MF;(?:TF(?:-\d+)?;)?MapTreeForm;colNavigation_Сервер>[^;]+;(?:TreeText|TreeExpander)$/.test(getTid(element) ?? '')
      // E2E bg/selectors.ts:1068 and bg/helpers/wizard.ts:29: the node
      // settings affordance can be SVG without a button role.
      || /;Graph;[^;]+;Setting$/.test(getTid(element) ?? '')
      || (getTid(element) ?? '')===workflow?.prefix+';WizrdMCF;CalcDataWizard;cmpExpression'
      || (getTid(element) ?? '').startsWith(workflow?.prefix+';WizrdMCF;CalcDataWizard;colExpressionName_')
      // E2E bg/selectors.ts:970: context-menu item wrappers carry stable
      // mn;mni* tids even when their inner ARIA menuitem has no test ID.
      || /^mn;mni[^;]+$/.test(getTid(element) ?? '')
      // E2E filestorage.FolderSelector/OpenFolder: storage names are table
      // cells without button roles. The observed row identity owns the gesture.
      || /;FileStorageForm;colName_[^;]+$/.test(getTid(element) ?? '')
      || /;(?:Display|Input)El$/.test(getTid(element) ?? '') && element.matches('.x-form-checkbox,.x-form-radio')
      // Loginom message-box buttons are anchors without an ARIA button role;
      // their pinned test identifiers end with tlb;yes / tlb;no, not btn*.
      || ((getTid(element) ?? '').startsWith('msgbox') && /;tlb;(?:yes|no|ok|cancel)$/.test(getTid(element)) && !!dialogRef(element));
    const graphPrefix = workflow ? workflow.prefix + ';Graph;' : null;
    const graphElements = graphPrefix ? all.filter(element => (getTid(element) ?? '').startsWith(graphPrefix)) : [];
    const labels = [...new Set(graphElements.filter(element => /;Label;Label$/.test(getTid(element)) && visible(element))
      .map(element => getTid(element).slice(graphPrefix.length).replace(/;Label;Label$/, '')).filter(label => label && label !== 'Переменные_сценария'))].sort();
    const graphLabels=new Set(labels);
    const graphNodeOf=element=>{
      const tid=getTid(element)??'';
      if(!graphPrefix || !tid.startsWith(graphPrefix))return null;
      const body=tid.slice(graphPrefix.length),parts=body.split(';'),label=parts[0];
      if(!graphLabels.has(label) || (tids.get(graphPrefix+label)??[]).filter(visible).length!==1)return null;
      const part=parts.length===1?'body':parts.slice(1).join(';')==='Label;Label'?'label':parts.length===2 && parts[1]==='Setting'?'settings':null;
      return part?{node_label:label,part}:null;
    };
    const priority = { graph_editor: 0, dialog: 1, graph: 2, workflow: 3, global: 4 };
    const controlPriority = element => {
      const tid=getTid(element)??'',base=workflow?.prefix+';WizrdMCF;';
      if(/^mn;mni[^;]+$/.test(tid) || element.getAttribute('role')==='menuitem')return -30;
      if(comboPart(element)?.kind==='option')return -25;
      if(dialogRef(element))return -20;
      // Keep lifecycle and selected-expression controls on the first compact
      // page, ahead of Calculator operator palettes and rendered preview cells.
      if(wizardButtons.some(name=>tid===base+name))return -10;
      if(['btnCalcMode','btnAddExpr','btnExprEdit'].some(name=>tid===base+'CalcDataWizard;'+name))return -9;
      if(tid===base+'CalcDataWizard;cmpExpression')return -8;
      if(tid.startsWith(base+'CalcDataWizard;colExpressionName_'))return -7;
      if((getTid(element.closest('[data-tid]'))??'').startsWith(base) && !dangerous(element)
        && element.matches('input,textarea,select,[contenteditable="true"]'))return -6;
      const graphNode=graphNodeOf(element);
      if(graphNode)return graphNode.part==='settings'?1.5:graphNode.part==='body'?1.6:1.7;
      return priority[scopeOf(element)];
    };
    const controls = candidates.filter(interesting).filter(element=>!selectedRoot || selectedRoot===element || selectedRoot.contains(element))
      .sort((left, right) => controlPriority(left) - controlPriority(right));
    const checkStateOf = element => {
      const type=element.getAttribute('type'),role=element.getAttribute('role');
      if (element.tagName.toLowerCase()==='input' && ['checkbox','radio'].includes(type)) {
        return {kind:type,checked:element.checked===true,indeterminate:element.indeterminate===true,source:'native'};
      }
      // E2E wizard.ts:425-455 and app_consts.ts:245: exact owner tid and
      // x-form-cb-checked are Loginom's Ext checkbox state, not input.value.
      const tid=getTid(element),ownerTid=tid?.replace(/;(?:Display|Input)El$/,'');
      if (ownerTid!==tid && element.matches('.x-form-checkbox,.x-form-radio')) {
        const owners=tids.get(ownerTid)??[];
        if (owners.length===1 && owners[0].contains(element)) return {kind:element.matches('.x-form-radio')?'radio':'checkbox',
          checked:owners[0].classList.contains('x-form-cb-checked'),indeterminate:false,source:'loginom_ext',owner_ref:refOf(owners[0])};
      }
      const value=element.getAttribute('aria-checked');
      if (['checkbox','radio'].includes(role) && ['true','false','mixed'].includes(value)) return {kind:role,checked:value==='mixed'?null:value==='true',indeterminate:value==='mixed',source:'aria'};
      return null;
    };
    const scrollOf = element => {
      for (let parent=element; parent && parent!==document.body; parent=parent.parentElement) {
        charge();
        if (parent.scrollHeight>parent.clientHeight && ['auto','scroll'].includes(getComputedStyle(parent).overflowY)) {
          return { ref: refOf(parent), top: parent.scrollTop, max_top: parent.scrollHeight-parent.clientHeight };
        }
      }
      return null;
    };
    const interactionOf = element => {
      const box=boxOf(element), width=globalThis.innerWidth ?? document.documentElement.clientWidth,
        height=globalThis.innerHeight ?? document.documentElement.clientHeight;
      if (![width,height].every(Number.isFinite)) return { state:'unverified', point:null };
      if (box.x>=width || box.y>=height || box.x+box.width<=0 || box.y+box.height<=0) return {state:'outside_viewport',point:null};
      const left=Math.max(0,box.x),right=Math.min(width,box.x+box.width),top=Math.max(0,box.y),bottom=Math.min(height,box.y+box.height);
      const covering=[],seenCovering=new Set();
      for (const y of [0.5,0.25,0.75]) for (const x of [0.5,0.25,0.75]) {
        charge();
        const point={x:left+(right-left)*x,y:top+(bottom-top)*y},hit=document.elementFromPoint(point.x,point.y);
        if (hit && (hit===element || element.contains(hit))) return {state:'point_observed',point};
        if(hit && !seenCovering.has(hit) && covering.length<3) {
          seenCovering.add(hit);
          // No text or values: identify the covering layer without reading its
          // potentially unrelated content or granting a new action reference.
          covering.push(sensitive(hit)?{redacted:true}:{tag:hit.tagName.toLowerCase(),tid:getTid(hit),
            anchor_tid:identityOf(hit)?.anchor_tid??null,role:hit.getAttribute('role')});
        }
      }
      return {state:'point_not_observed',point:null,covering};
    };
    // E2E sCalculator.ExpressionInput/ExpressionText and check.Mode. Visible
    // PRE nodes are a rendering, not an authoritative editor document (the E2E
    // helper itself warns about empty/multiline checks). Never grant generic
    // gestures or claim a complete formula from this representation.
    const calculatorEditorOf = element => {
      const base=workflow?.prefix+';WizrdMCF;CalcDataWizard;';
      if(getTid(element)!==base+'cmpExpression')return null;
      const peers=tids.get(base+'cmpExpression')??[];
      const buttons=(tids.get(base+'btnCalcMode')??[]).filter(visible);
      const icons=buttons.length===1 ? dom.filter(item=>{charge();return buttons[0].contains(item) &&
        item.matches('span') && visible(item) && !sensitive(item);}) : [];
      const modes=['Expression','JavaScript'].filter(mode=>icons.some(item=>item.classList.contains('bg-TBGCalcMode-cm'+mode)));
      const lines=[];let remaining=2048,truncated=false,redacted=false;
      for(const item of dom) {
        charge();if(!element.contains(item) || !item.matches('pre') || !visible(item))continue;
        if(lines.length>=32){truncated=true;break;}
        let text='';const walker=document.createTreeWalker(item,4);let node;
        while((node=walker.nextNode())) {
          charge();const parent=node.parentElement;
          if(!parent || !visible(parent))continue;
          if(sensitive(parent)){redacted=true;continue;}
          const part=node.textContent??'';
          text+=part.slice(0,remaining);remaining-=Math.min(remaining,part.length);
          if(remaining===0){
            // Budget exhaustion is conservatively incomplete, even at an exact boundary.
            truncated=true;break;
          }
        }
        lines.push(text);if(truncated)break;
      }
      const selected=all.filter(item=>{charge();return (getTid(item)??'').startsWith(base+'colExpressionName_') &&
        visible(item) && !sensitive(item) && item.closest('table')?.classList.contains('x-grid-item-selected');});
      const selectedExpression=selected.length===1?{ref:refOf(selected[0]),tid:getTid(selected[0]),label:textOf(selected[0])}:null;
      let documentRead={status:'unavailable',full_text_verified:false};
      const wrappers=dom.filter(item=>{charge();return element.contains(item) && item.matches('.CodeMirror') && visible(item);});
      // CodeMirror 5 public read APIs, scoped to the exact editor wrapper. No
      // setValue/replaceRange or execution of the supplied expression here.
      if(wrappers.length===1 && !redacted && !dom.some(item=>{charge();return element.contains(item) && sensitive(item);}))try {
        const wrapper=wrappers[0],cm=wrapper.CodeMirror,doc=cm?.getDoc?.(),input=cm?.getInputField?.();
        if(cm?.getWrapperElement?.()===wrapper && input?.isConnected && wrapper.contains(input) && !sensitive(input)
          && doc && ['firstLine','lastLine','lineCount','getLine'].every(key=>typeof doc[key]==='function')) {
          const count=doc.lineCount(),first=doc.firstLine(),last=doc.lastLine();
          if(!Number.isInteger(count) || count<1 || count>128 || first!==0 || last!==count-1)documentRead={status:'unsupported_size_or_subdocument',full_text_verified:false};
          else {
            const parts=[];let length=0,valid=true;
            for(let i=0;i<count;i++) {
              charge();const line=doc.getLine(i);
              if(typeof line!=='string' || /[\r\n\0]/.test(line) || (length+=line.length+(i?1:0))>2048){valid=false;break;}
              parts.push(line);
            }
            documentRead=valid?{status:'observed',full_text_verified:true,text:parts.join('\n'),
              wrapper_ref:refOf(wrapper),input_ref:refOf(input),document_ref:refOf(doc),
              writable:typeof cm.getOption==='function' && cm.getOption('readOnly')===false && !input.readOnly && !input.disabled}:
              {status:'unsupported_text_or_size',full_text_verified:false};
          }
        }
      } catch(error) {if(error?.code==='UI_SCAN_LIMIT')throw error;documentRead={status:'read_failed',full_text_verified:false};}
      return {kind:'calculator',status:peers.filter(visible).length===1?'observed':'ambiguous',
        mode:modes.length===1?modes[0]==='Expression'?'expression':'javascript':null,
        mode_status:buttons.length>1 || modes.length>1?'ambiguous':modes.length===1?'observed':'unobserved',
        selected_expression:selectedExpression,document:documentRead,
        rendered_lines:documentRead.full_text_verified || redacted?[]:lines,rendering_truncated:truncated,redacted,
        full_text_verified:documentRead.full_text_verified,syntax_validity:'unverified'};
    };
    const elements = controls.slice(0, 240).map(element => {
      const identity = identityOf(element), tag = element.tagName.toLowerCase(), tid = getTid(element);
      const editable = element.matches('textarea,input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),[contenteditable="true"]') && !element.readOnly;
      const label = short(element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.getAttribute('title') || textOf(element));
      const role = element.getAttribute('role'), kind = /;(?:Input|Output)_/.test(tid ?? '') ? 'port' : editable ? 'field' : /;Graph;/.test(tid ?? '') ? 'graph' : 'control';
      const isEnabled = enabled(element), allowed = identity && isEnabled && !dangerous(element);
      const scroll = scrollOf(element);
      const interaction = interactionOf(element);
      const checkState=checkStateOf(element);
      const calculatorEditor=calculatorEditorOf(element);
      const combo=comboPart(element);
      const wizardStep=wizard.status==='observed' && wizard.stage && ['btnNext','btnPrev'].some(name=>tid===wizard.root_tid+';'+name)
        && wizard.controls[tid.split(';').at(-1)]?.status==='observed'
        ? {direction:tid.endsWith(';btnNext')?'next':'previous',root_ref:wizard.root_ref,stage:wizard.stage}:null;
      const expressionWritable=identity && isEnabled && calculatorEditor?.status==='observed' && calculatorEditor.mode==='expression'
        && calculatorEditor.selected_expression && calculatorEditor.document.full_text_verified && calculatorEditor.document.writable;
      const fullValue = editable && !sensitive(element) ? String(element.value ?? (element.isContentEditable ? element.textContent : '') ?? '') : undefined;
      const value = fullValue?.slice(0, 2048), valueTruncated = fullValue !== undefined && fullValue.length > 2048;
      const fieldValue = value === undefined ? {} : {value, value_truncated:valueTruncated, value_length_utf16:fullValue.length};
      return { ref: refOf(element), tid, identity, kind, role, label, scope: scopeOf(element), ...fieldValue,
        ...(graphNodeOf(element) ? {graph_node:graphNodeOf(element)} : {}),
        ...(scroll ? { scroll } : {}),
        ...(checkState ? {check_state:checkState} : {}),
        ...(calculatorEditor ? {calculator_editor:calculatorEditor} : {}),
        ...(combo ? {wizard_combo:combo} : {}),
        ...(wizardStep ? {wizard_step:wizardStep} : {}),
        ...(wizardFields.has(element) ? {wizard_field:wizardFields.get(element)} : {}),
        signature: { tag, tid, role, type: element.getAttribute('type'), name: element.getAttribute('name'), label, ...fieldValue, dialog_ref: dialogRef(element), scroll, check_state:checkState },
        enabled: isEnabled, visible: true, interaction, bounding_box: boxOf(element),
        // A bounded prefix is not a sufficient value precondition. A dedicated
        // large-field driver must establish its own complete read/write contract.
        allowed_actions: expressionWritable ? ['replace_expression'] : allowed && !valueTruncated ? ['click', 'double_click', 'right_click', 'press', 'drag', ...(editable ? ['fill',...(wizardFields.has(element)?['set_wizard_field']:[])] : []), ...(checkState ? ['set_checked'] : []), ...(wizardStep?['wizard_step']:[]), ...(combo?.kind==='option'?['select_wizard_option']:[]), ...(scroll && interaction.state === 'point_observed' ? ['scroll'] : [])] : [] };
    });
    const nodes = labels.slice(0, 200).map(label => {
      const nodeTid = graphPrefix + label, node = tids.get(nodeTid)?.[0];
      return { node_ref: { kind: 'node', node_label: label, workflow_ref: workflow }, bounding_box: node ? boxOf(node) : null,
        ports: graphElements.filter(element => (getTid(element) ?? '').startsWith(nodeTid + ';') && /;(?:Input|Output)_[^;]+$/.test(getTid(element)))
          .slice(0, 100).map(element => ({ tid: getTid(element), bounding_box: boxOf(element), ui_ref: refOf(element) })) };
    });
    const links = [...new Set(graphElements.map(getTid).filter(tid => { const body = tid.slice(graphPrefix.length); return body.split('|').length === 4 && !body.includes(';'); }))].sort();
    let packageIdentity = null;
    try {
      const app = globalThis.bg?.app;
      let node = app?.Application?.FInstance?.FMainForm?.Items?.Workspace?.getActiveTab()?.Controller?.Node?.data?.node;
      const seen = new Set();
      for (let depth = 0; node && depth < 32 && !seen.has(node); depth++, node = node.ParentNode) {
        seen.add(node);
        if (app.PackageTreeNode && node instanceof app.PackageTreeNode) {
          const raw = node.PackageFileName;
          const path = typeof raw === 'string' && raw.trim() ? raw.replaceAll('\\', '/').replace(/\/+/g, '/') : null;
          packageIdentity = { path: path && !path.startsWith('/') ? '/' + path : path, name: short(node.PackageName, 200) }; break;
        }
      }
    } catch { /* A dialog or non-workflow tab may have no cached package node. */ }
    const readTexts = selector => select(selector).filter(visible).map(element => ({ ref: refOf(element), text: textOf(element), bounding_box: boxOf(element) }));
    const foregroundDialog = dialogs.reduce((top, dialog) => !top || dialog.z_index >= top.z_index ? dialog : top, null);
    const foregroundElement = foregroundDialog ? dialogElements.find(element => refOf(element) === foregroundDialog.ref) : null;
    const masks = select('.bg-mask-message,.x-mask-msg').filter(visible).map(element => {
      // Mask.js applies bg-mask-message to the whole target and renders its
      // bg-mask-text attribute. Descendant text is the underlying workspace,
      // not the mask message. Loginom also uses "Загрузка" while waiting for a
      // modal answer: message text does not establish which UI is blocked.
      // Only a mask disjoint from the actual foreground dialog is background;
      // its controls must still pass exact painted hit ownership before acting.
      const owner = dialogRef(element), ownText = element.getAttribute('bg-mask-text');
      const kind = foregroundElement && !foregroundElement.contains(element) && !element.contains(foregroundElement) ? 'modal_background' : 'busy';
      return { ref: refOf(element), kind, dialog_ref: owner, text: ownText === null ? textOf(element) : short(ownText), bounding_box: boxOf(element) };
    });
    const messages = readTexts('[role="alert"],[role="status"],.bg-message,.x-message-box,.x-form-invalid-under');
    const allCells = select('td,th,[role="gridcell"],[role="columnheader"],.x-column-header[data-tid],.x-grid-cell-inner');
    const cells = allCells.filter(visible).filter(element=>!selectedRoot || selectedRoot===element || selectedRoot.contains(element))
      .filter(element => !allCells.some(other => { charge(); return other !== element && element.contains(other); }));
    // E2E previewTable.ts and sBrowseView.ts: header key + zero-based row
    // identify rendered data cells. CSS type/null markers are observations,
    // not execution freshness, full result coverage or parsed value claims.
    const dataIdentity=element=>{
      const owner=element.closest('td,[role="gridcell"],.x-column-header,[role="columnheader"]')??element;
      const tid=getTid(owner),match=/^(MF;TF(?:-\d+)?;(?:ModelForm;(?:PreviewWindow;)?PreviewForm;DataSetForm|ViewsForm;BrowseView));normalHeaderCt;([^;]+)$/.exec(tid??'');
      if(!match || match[2].length>256 || !tid.startsWith(workflow?.prefix+';'))return null;
      const isHeader=owner.matches('.x-column-header,[role="columnheader"]');
      const cell=isHeader?null:/^(.+)_(0|[1-9][0-9]*)$/.exec(match[2]);
      if(!isHeader && (!cell || !Number.isSafeInteger(Number(cell[2]))))return null;
      return {owner,view_key:match[1],column_key:isHeader?match[2]:cell[1],row_index:cell?Number(cell[2]):null,isHeader};
    };
    const typeNames={dtInteger:'integer',dtFloat:'real',dtString:'string',dtBoolean:'boolean',dtDateTime:'datetime',dtVariant:'variant'};
    const literalCellText=element=>{
      const walker=document.createTreeWalker(element,4);let node,text='',complete=true;
      while((node=walker.nextNode())) {
        charge();const parent=node.parentElement;
        if(!parent || !visible(parent) || sensitive(parent) || parent.closest('script,style,noscript,textarea'))continue;
        const part=node.textContent??'';
        if(text.length+part.length>2048){text+=part.slice(0,2048-text.length);complete=false;break;}
        text+=part;
      }
      return {text,complete};
    };
    const tableCells = cells.slice(0, 120).map(element => {
      const column = element.getAttribute('aria-colindex');
      const table = element.closest('table,[role="grid"]');
      const headers = table ? allCells.filter(item => { charge(); return item.matches('th,[role="columnheader"]') && table.contains(item); }) : [];
      const index = element.cellIndex ?? (column ? Number(column) - 1 : -1);
      const header = index >= 0 ? textOf(headers[index] ?? element) : '';
      const data=dataIdentity(element);
      let detail={},redacted=sensitivePattern.test(header);
      if(data) {
        const {owner,view_key,column_key,row_index,isHeader}=data;
        const sourceHeaders=(tids.get(view_key+';normalHeaderCt;'+column_key)??[])
          .filter(item=>item.matches('.x-column-header,[role="columnheader"]') && visible(item));
        const sourceHeader=sourceHeaders.length===1?sourceHeaders[0]:null;
        redacted ||= sensitive(owner) || sensitivePattern.test(column_key) || !!sourceHeader && sensitivePattern.test(textOf(sourceHeader));
        if(isHeader) {
          const types=Object.entries(typeNames).filter(([css])=>owner.classList.contains('bg-TBGDataType-'+css+'-before')).map(([,type])=>type);
          detail.data_column={view_key,column_key,declared_type:types.length===1?types[0]:null,
            type_status:types.length===1?'observed':types.length?'ambiguous':'unobserved'};
        } else {
          redacted ||= !sourceHeader;
          const literal=!redacted?literalCellText(element):{text:null,complete:false};
          detail.data_cell={view_key,column_key,row_index,header_observed:!!sourceHeader,
            display_text:literal.text,text_complete:literal.complete,redacted,
            null_marker_present:owner.classList.contains('bg-cell-null-value') || element.classList.contains('bg-cell-null-value')};
        }
      }
      return { text: redacted ? '[REDACTED]' : textOf(element), row: element.parentElement?.getAttribute('aria-rowindex') ?? null, column,...detail };
    });
    const workarea = graphPrefix ? all.find(element => getTid(element) === workflow.prefix + ';ModelForm;pnlWorkarea') : null;
    // E2E navigation.GetCurrentTabPath reads the visible breadcrumb labels.
    // This is destination evidence only: virtualized rows cannot prove absence
    // of a conflicting filename, nor do labels establish server byte identity.
    let fileStorage = {status:'unobserved',directory:null,listing_complete:false,reason:'storage_container_not_observed'};
    const storagePrefix = workflow?.prefix + ';FileStorageForm;';
    if (workflow && all.some(element => (getTid(element) ?? '').startsWith(storagePrefix + 'pnlFileStorage;tbl') && visible(element))) {
      const bars = all.filter(element => (getTid(element) ?? '').startsWith(workflow.prefix + ';')
        && (getTid(element) ?? '').endsWith('NavigationBar;NavigationPanel') && visible(element) && !sensitive(element));
      fileStorage.reason='navigation_not_unique';
      if (bars.length === 1) {
        const bar=bars[0], buttonParts=all.filter(element => bar.contains(element)
          && (getTid(element) ?? '').includes('cnrNaviMode;b.s'));
        const buttons=buttonParts.filter(element=>!buttonParts.some(other=>{charge();return other!==element && other.contains(element);}));
        const labels=select('.x-btn-inner-default-toolbar-small').filter(element => bar.contains(element)
          && buttons.some(button => {charge();return button.contains(element);}));
        fileStorage.reason='navigation_segments_incomplete';
        fileStorage.segment_counts={buttons:buttons.length,labels:labels.length};
        const segments=[];let valid=labels.length>0 && labels.length<=32 && labels.length===buttons.length
          && buttons.every(button => labels.filter(label => {charge();return button.contains(label);}).length===1);
        for (const label of labels.slice(0,32)) {
          if (sensitive(label)) {fileStorage.reason='navigation_segment_sensitive';valid=false;break;}
          const reader=document.createTreeWalker(label,4);let node,value='';
          while ((node=reader.nextNode())) {
            charge();if(sensitive(node.parentElement)) {valid=false;break;}
            value+=String(node.textContent ?? '').slice(0,201);if(value.length>200) break;
          }
          // GetCurrentPath skips empty breadcrumb labels (navigation controls
          // without a directory name). An empty path itself is never accepted.
          if (!value.trim()) continue;
          if (!visible(label)) {fileStorage.reason='navigation_segment_hidden';valid=false;break;}
          if (value.length>200 || value!==value.trim() || /[\\/\x00-\x1f\x7f]/.test(value) || value==='.' || value==='..') {fileStorage.reason='navigation_segment_invalid';valid=false;break;}
          segments.push(value);
        }
        if (valid && segments.length && segments.join('/').length<=2000) {
          // E2E utils/files.GetRelativePath removes the virtual Files root.
          // Remove only the first known root, never a same-named real directory.
          if (segments[0]==='Файлы') fileStorage={status:'observed',directory:'/'+segments.slice(1).join('/'),
            display_path:'/'+segments.join('/'),navigation_root:segments[0],
            navigation_identity:identityOf(bar),source:'visible_breadcrumbs',listing_complete:false};
          else fileStorage.reason='navigation_root_unrecognized';
        }
      }
    }
    return { origin: location.origin, authenticated: !!tids.get('MF;cntMain;tlbMainToolbar;btnAvatar')?.some(visible), loginom_build: globalThis.bg?.app?.Version ?? null,
      workflow_ref: workflow, active_identity: active ? textOf(active) : null, package_identity: packageIdentity,
      file_storage:fileStorage,wizard,
      dom_epoch: {document:state.epoch,revision:state.revision},
      ...(selectedRoot ? {observation_root:{ref:rootRef,identity:identityOf(selectedRoot),detail_scope:'elements_and_cells',global_scan:false,global_guards:'fixed_native_queries'}} : {}),
      scan: { complete: true, mutation_counts:{...state.mutations}, visited_elements: dom.length, detail_elements:detailElements, max_elements: maxElements, max_work: maxWork, max_ms: maxMs },
      nodes, links: links.slice(0, 500), workarea: workarea ? boxOf(workarea) : null,
      ui: { elements, dialogs: dialogs.slice(0, 12), messages: messages.slice(0, 30), masks: masks.slice(0, 12), table_cells: tableCells,
        truncated: { elements: !!selectedRoot || controls.length > 240, nodes: !!selectedRoot || labels.length > 200, links: !!selectedRoot || links.length > 500, ports: !!selectedRoot || nodes.some(node => node.ports.length === 100), dialogs: dialogs.length > 12, messages: !!selectedRoot || messages.length > 30, masks: masks.length > 12, table_cells: !!selectedRoot || cells.length > 120 } } };
    } catch (error) {
      // Playwright serializes thrown Errors without arbitrary properties such
      // as our code. Return a small data envelope across the realm boundary;
      // never export exception messages that may contain page/private values.
      const code=['UI_SCAN_LIMIT','UI_ROOT_STALE','UI_EPOCH_UNAVAILABLE'].includes(error?.code)
        ? error.code : 'UI_OBSERVATION_FAILED';
      return {ui_read_failure:{code}};
    }
  },{rootRef:rediscover ? null : task.root_ref ?? task.snapshot?.observation_root?.ref ?? null,discoverRoots:rediscover || task.discover_roots===true,storageName:task.storage_name ?? null});
    if (observed?.ui_read_failure) {
      const code=observed.ui_read_failure.code;
      const messages={UI_SCAN_LIMIT:'Workspace scan budget exceeded; use root discovery and a narrower observation',
        UI_ROOT_STALE:'Observed root is detached, hidden, inactive or expired',
        UI_EPOCH_UNAVAILABLE:'DOM mutation tracking is unavailable',UI_OBSERVATION_FAILED:'Browser observation failed'};
      fail(Object.hasOwn(messages,code)?code:'UI_OBSERVATION_FAILED',messages[code]??messages.UI_OBSERVATION_FAILED);
    }
    return observed;
  };

  const locatorFor = identity => {
    if (!identity || !Array.isArray(identity.path) || identity.path.some(index => !Number.isInteger(index) || index < 0) || identity.path.length > 64) fail('UI_REFERENCE_INVALID', 'Observed control identity is invalid');
    const escaped = JSON.stringify(identity.anchor_tid).replaceAll('\u2028', '\\2028 ').replaceAll('\u2029', '\\2029 ');
    const anchor = identity.anchor_tid === null ? 'html' : `[data-tid=${escaped}]`;
    return page.locator(anchor + identity.path.map(index => ` > :nth-child(${index + 1})`).join(''));
  };
  const checkedHandle = async (before, current) => {
    if (!current || !same(before.identity, current.identity) || !same(before.signature, current.signature)
      || !current.allowed_actions.includes(task.action.verb)
      || task.action.verb==='replace_expression' && !same(before.calculator_editor,current.calculator_editor)
      || task.action.verb==='set_wizard_field' && !same(before.wizard_field,current.wizard_field)
      || task.action.verb==='wizard_step' && !same(before.wizard_step,current.wizard_step)
      || task.action.verb==='select_wizard_option' && !same(before.wizard_combo,current.wizard_combo)) fail('UI_REFERENCE_STALE', 'The observed control changed; observe the workspace again');
    const locator = locatorFor(current.identity);
    if (await locator.count() !== 1) fail('UI_REFERENCE_STALE', 'Observed control is no longer unique');
    const handle = await locator.elementHandle({ timeout: timeout() });
    if (!handle) fail('UI_REFERENCE_STALE', 'Observed control is detached');
    handles.push(handle);
    const graphPrefix = task.snapshot.workflow_ref?.prefix + ';Graph;';
    const graphBody = current.tid?.startsWith(graphPrefix) ? current.tid.slice(graphPrefix.length) : null;
    const isGraphLink = graphBody !== null && graphBody.split('|').length === 4 && !graphBody.includes(';');
    const valid = await handle.evaluate((element, ref) => element.isConnected && globalThis[Symbol.for('loginom-dock.workspace-ui.identity.v1')]?.ids.get(element) === ref, current.ref);
    // Playwright treats zero-height/width SVG geometry as invisible even when
    // the stroke is painted. Links use the same style check as observation and
    // must still prove ownership of a painted hit point below.
    if (!valid || (!isGraphLink && !(await handle.isVisible())) || !(await handle.isEnabled())) fail('UI_REFERENCE_STALE', 'Observed control is detached, hidden, disabled, or replaced');
    // Chromium's Playwright boundingBox() and DOM getBoundingClientRect() can
    // disagree on SVG groups. Compare two reads of the same DOM geometry, then
    // dispatch the exact checked viewport point without another box conversion.
    const box = await handle.evaluate(element => {
      const rect = element.getBoundingClientRect();
      let stylesVisible = true;
      for (let parent = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || parent.getAttribute('hidden') !== null) stylesVisible = false;
      }
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, styles_visible: stylesVisible };
    }), viewport = page.viewportSize();
    const validExtents = box && (isGraphLink ? box.width >= 0 && box.height >= 0 && (box.width > 0 || box.height > 0) : box.width > 0 && box.height > 0);
    if (!box?.styles_visible || !validExtents || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(box[key])
      || Math.abs(box[key] - current.bounding_box[key]) > 0.75)) fail('UI_REFERENCE_STALE', 'Observed control geometry changed');
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (!isGraphLink && viewport && (point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height)) fail('UI_REFERENCE_OFFSCREEN', 'Observed control is outside the viewport');
    const hit = await handle.evaluate((element, { point, viewport, isGraphLink }) => {
      let checked = 0;
      const ownsPoint = candidate => {
        if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y) || candidate.x < 0 || candidate.y < 0
          || (viewport && (candidate.x >= viewport.width || candidate.y >= viewport.height))) return false;
        checked++;
        const target = document.elementFromPoint(candidate.x, candidate.y);
        return target === element || element.contains(target);
      };
      if (ownsPoint(point)) return { point, source: 'box_center', candidates_checked: checked };
      if (!isGraphLink) return null;
      // A bent SVG link can have empty space at its rectangle center. Sample
      // only its actual geometry, transformed into the current viewport. These
      // are bounded read-only hit tests; exactly one verified point is clicked.
      const shapes = [element, ...element.querySelectorAll('path,polyline,line,polygon,rect,circle,ellipse')].slice(0, 16);
      const fractions = [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875, 0.0625, 0.9375];
      for (const shape of shapes) {
        if (typeof shape.getTotalLength !== 'function' || typeof shape.getPointAtLength !== 'function' || typeof shape.getScreenCTM !== 'function') continue;
        try {
          const length = shape.getTotalLength(), matrix = shape.getScreenCTM();
          if (!Number.isFinite(length) || length <= 0 || !matrix || ['a', 'b', 'c', 'd', 'e', 'f'].some(key => !Number.isFinite(matrix[key]))) continue;
          for (const fraction of fractions) {
            const local = shape.getPointAtLength(length * fraction);
            if (!local || !Number.isFinite(local.x) || !Number.isFinite(local.y)) continue;
            const candidate = { x: matrix.a * local.x + matrix.c * local.y + matrix.e,
              y: matrix.b * local.x + matrix.d * local.y + matrix.f };
            if (ownsPoint(candidate)) return { point: candidate, source: 'svg_geometry', candidates_checked: checked };
          }
        } catch { /* Detached or malformed SVG geometry is never a click target. */ }
      }
      return null;
    }, { point, viewport, isGraphLink });
    if (!hit) fail('UI_REFERENCE_OBSCURED', 'The observed control has no verified visible interaction point');
    if (isGraphLink) record('ui_link_hit_point', { ref: current.ref, source: hit.source, candidates_checked: hit.candidates_checked, point: hit.point });
    return { handle, point: hit.point };
  };
  return (async () => {
    let outcome, cleanupComplete = true, refreshedAfterCleanup = false;
    record('ui_observation_started');
    try {
      const current = await readUi();
      if (task.mode === 'observe') {
        phase = 'observed';
        outcome = result('SUCCEEDED', current);
      } else {
        phase = 'preconditions';
        if (!task.snapshot || !same(task.snapshot.origin, current.origin) || current.origin !== task.expected_origin
          || current.loginom_build !== task.expected_build || !same(task.snapshot.loginom_build, current.loginom_build)
          || !same(task.snapshot.workflow_ref, current.workflow_ref)) fail('UI_CONTEXT_CHANGED', 'Origin, build, or active workspace changed; observe the workspace again');
        if (!current.authenticated) fail('LOGIN_REQUIRED', 'Loginom authentication is required before changing the workspace');
        if (!same(task.snapshot.dom_epoch, current.dom_epoch)) fail('UI_EPOCH_CHANGED', 'The document changed since this observation; observe again even if its visible state looks unchanged');
        if (!same(current.ui.dialogs.map(item => item.ref), task.snapshot.ui.dialogs.map(item => item.ref))) fail('UI_CONTEXT_CHANGED', 'The visible dialog changed; observe the workspace again');
        if(['set_wizard_field','wizard_step','select_wizard_option'].includes(task.action.verb) && (!same(task.snapshot.wizard,current.wizard)
          || !same(task.snapshot.active_identity,current.active_identity) || !same(task.snapshot.package_identity,current.package_identity)))
          fail('WIZARD_CONTEXT_CHANGED','Wizard settings or package changed; observe again');
        const refs = task.action.verb === 'drag' ? [task.action.source_ref, task.action.target_ref] : [task.action.ref];
        if (current.ui.masks.length) {
          const foreground = current.ui.dialogs.reduce((top, dialog) => !top || dialog.z_index >= top.z_index ? dialog : top, null);
          const targetsForeground = foreground && refs.every(ref => current.ui.elements.find(element => element.ref === ref)?.signature.dialog_ref === foreground.ref);
          const dialogBlocked = !foreground || current.ui.masks.some(mask => mask.dialog_ref === foreground.ref || mask.kind !== 'modal_background');
          // A modal confirmation intentionally masks the workspace behind it.
          // Only its own controls can proceed; their exact painted hit point is
          // still checked below, so a mask over the button cannot be bypassed.
          if (!targetsForeground || dialogBlocked) fail('UI_MASKED', 'The workspace is masked; only an unblocked foreground dialog can be changed');
        }
        const targets = [];
        for (const ref of refs) {
          const before = task.snapshot.ui.elements.find(element => element.ref === ref);
          const item = current.ui.elements.find(element => element.ref === ref);
          if (!before) fail('UI_REFERENCE_INVALID', 'Action reference is absent from the supplied observation');
          targets.push(await checkedHandle(before, item));
        }
        const epochBeforeGesture = await page.evaluate(() => {
          const state=globalThis[Symbol.for('loginom-dock.workspace-ui.identity.v1')];
          if (!state?.observer) return null;
          state.captureMutations(state.observer.takeRecords());
          return {document:state.epoch,revision:state.revision};
        });
        if (!same(current.dom_epoch,epochBeforeGesture)) fail('UI_EPOCH_CHANGED','The document changed while checking the target; observe again');
        record('ui_preconditions_verified', { verb: task.action.verb, refs });
        phase = 'applying'; effectPossible = true;
        const first = targets[0].handle;
        const clickTarget = async (clickCount, button = 'left') => {
          timeout(); mouseHeld = true; mouseButton = button;
          await page.mouse.click(targets[0].point.x, targets[0].point.y, { clickCount, button });
          mouseHeld = false;
        };
        if (task.action.verb === 'click' || ['wizard_step','select_wizard_option'].includes(task.action.verb)) await clickTarget(1);
        else if (task.action.verb === 'double_click') await clickTarget(2);
        else if (task.action.verb === 'right_click') await clickTarget(1, 'right');
        else if (task.action.verb === 'press') await first.press(task.action.key, { timeout: timeout() });
        else if (task.action.verb === 'set_checked') {
          const before=current.ui.elements.find(item=>item.ref===task.action.ref).check_state;
          if (before.checked===task.action.checked && !before.indeterminate) {
            effectPossible=false;record('ui_state_already_satisfied',{verb:task.action.verb,checked:task.action.checked});
          } else { await clickTarget(1); await page.waitForTimeout(50); }
        }
        else if (task.action.verb === 'scroll') {
          const expected=current.ui.elements.find(item=>item.ref===task.action.ref).scroll;
          const moved=await first.evaluate((element,{expected,delta})=>{
            const state=globalThis[Symbol.for('loginom-dock.workspace-ui.identity.v1')];
            for (let parent=element,depth=0;parent && parent!==document.body && depth<64;parent=parent.parentElement,depth++) {
              if (!(parent.scrollHeight>parent.clientHeight) || !['auto','scroll'].includes(getComputedStyle(parent).overflowY)) continue;
              if (state?.ids.get(parent)!==expected.ref || parent.scrollTop!==expected.top || parent.scrollHeight-parent.clientHeight!==expected.max_top) return null;
              const target=Math.max(0,Math.min(expected.max_top,expected.top+delta));
              if (target===expected.top) return null;
              parent.scrollTop=target;
              return {from:expected.top,to:parent.scrollTop,owner_ref:expected.ref};
            }
            return null;
          },{expected,delta:task.action.delta_y});
          if (!moved) { effectPossible=false; fail('UI_SCROLL_UNAVAILABLE','Scroll owner changed or its boundary was reached; observe again'); }
          record('ui_scroll_applied',moved);
          await page.waitForTimeout(50);
        }
        else if (task.action.verb === 'replace_expression') {
          const before=current.ui.elements.find(item=>item.ref===task.action.ref).calculator_editor;
          const ownsFocus=async(expectedText=before.document.text)=>{
            const fresh=await readUi(),found=fresh.ui.elements.find(item=>item.ref===task.action.ref)?.calculator_editor;
            if(!fresh.authenticated || fresh.origin!==current.origin || !same(fresh.workflow_ref,current.workflow_ref)
              || !same(fresh.ui.masks,current.ui.masks) || !same(fresh.ui.dialogs,current.ui.dialogs)
              || !found || found.mode!=='expression' || found.document.text!==expectedText || !same(found.selected_expression,before.selected_expression)
              || !found.document.full_text_verified || !found.document.writable)return false;
            return first.evaluate((element,expected)=>{
            const state=globalThis[Symbol.for('loginom-dock.workspace-ui.identity.v1')];
            const wrappers=[...element.querySelectorAll('.CodeMirror')];
            if(wrappers.length!==1)return false;
            const wrapper=wrappers[0],cm=wrapper.CodeMirror,input=cm?.getInputField?.();
            return state?.ids.get(wrapper)===expected.wrapper_ref && state.ids.get(input)===expected.input_ref &&
              state.ids.get(cm?.getDoc?.())===expected.document_ref && document.activeElement===input && wrapper.contains(input);
          },before.document);};
          await clickTarget(1);
          if(!await ownsFocus())fail('EXPRESSION_FOCUS_CHANGED','The Calculator input did not receive focus');
          await page.keyboard.press('ControlOrMeta+A');
          if(!await ownsFocus())fail('EXPRESSION_FOCUS_CHANGED','The Calculator input lost focus before replacement');
          await page.keyboard.press('Backspace');
          if(!await ownsFocus(''))fail('EXPRESSION_FOCUS_CHANGED','The Calculator input lost focus or did not clear');
          timeout();if(task.action.text)await page.keyboard.type(task.action.text,{delay:0});
        }
        else if (task.action.verb === 'set_wizard_field') {
          const before=current.ui.elements.find(item=>item.ref===task.action.ref);
          const stillOwned=async()=>{
            const fresh=await readUi(),field=fresh.ui.elements.find(item=>item.ref===task.action.ref);
            return fresh.authenticated && fresh.origin===current.origin && fresh.loginom_build===current.loginom_build
              && same(fresh.workflow_ref,current.workflow_ref) && same(fresh.package_identity,current.package_identity)
              && same(fresh.active_identity,current.active_identity) && same(fresh.wizard,current.wizard)
              && same(fresh.ui.dialogs,current.ui.dialogs) && same(fresh.ui.masks,current.ui.masks)
              && field?.allowed_actions.includes('set_wizard_field') && same(field.wizard_field,before.wizard_field)
              && field.value===before.value && await first.evaluate(element=>document.activeElement===element);
          };
          if(before.value===task.action.text) {
            effectPossible=false;record('ui_state_already_satisfied',{verb:task.action.verb});
          } else {
            await clickTarget(1);
            if(!await stillOwned())fail('WIZARD_FIELD_CHANGED','Wizard field changed while receiving focus; inspect before retry');
            await first.press('ControlOrMeta+A',{timeout:timeout()});
            if(!await stillOwned())fail('WIZARD_FIELD_CHANGED','Wizard field changed before replacement; inspect before retry');
            timeout();
            if(task.action.text)await page.keyboard.type(task.action.text,{delay:0});
            else await first.press('Backspace',{timeout:timeout()});
          }
        }
        else if (task.action.verb === 'fill') {
          await clickTarget(1);
          await first.press('ControlOrMeta+A', { timeout: timeout() });
          if (!(await first.evaluate(element => document.activeElement === element))) fail('UI_FOCUS_CHANGED', 'The observed editor lost keyboard focus');
          timeout();
          // Loginom's transient rename editor commits real keyboard input; fill()
          // alone did not update its component model in live acceptance.
          if (task.action.text) await page.keyboard.type(task.action.text, { delay: 0 });
          else await first.press('Backspace', { timeout: timeout() });
        } else if (task.action.verb === 'drag') {
          await page.mouse.move(targets[0].point.x, targets[0].point.y);
          timeout(); mouseHeld = true;
          await page.mouse.down();
          timeout();
          await page.mouse.move(targets[1].point.x, targets[1].point.y, { steps: 20 });
          await page.mouse.up(); mouseHeld = false;
          record('cleanup_completed', { resource: 'mouse' });
        } else fail('UI_ACTION_INVALID', 'Unsupported UI gesture');
        if (effectPossible) record('ui_gesture_applied', { verb: task.action.verb });
        phase = 'observing'; timeout();
        let observed;
        try { observed = await readUi(); }
        catch(error) {
          // A generic click can legitimately close its popup/tree. Rediscover
          // regions only after the completed gesture, never for preconditions
          // or typed value/stage verification. This proves no navigation goal.
          if(error?.code!=='UI_ROOT_STALE' || !effectPossible || !['click','double_click','right_click','press'].includes(task.action.verb))throw error;
          observed=await readUi(true);
          record('ui_root_closed_after_gesture',{verification_required:true});
        }
        if(task.action.verb==='select_wizard_option') {
          const choice=current.ui.elements.find(item=>item.ref===task.action.ref).wizard_combo;
          const field=observed.wizard.settings?.fields?.[choice.field.name];
          if(!observed.authenticated || observed.origin!==current.origin || observed.loginom_build!==current.loginom_build
            || !same(observed.workflow_ref,current.workflow_ref) || !same(observed.package_identity,current.package_identity)
            || !same(observed.active_identity,current.active_identity) || observed.wizard.root_ref!==choice.field.root_ref
            || observed.wizard.stage!==current.wizard.stage || !same(observed.ui.dialogs,current.ui.dialogs) || observed.ui.masks.length
            || field?.status!=='observed' || field.truncated || field.value!==choice.label
            || field.input_ref!==choice.field.input_ref || field.owner_ref!==choice.field.owner_ref)
            fail('WIZARD_OPTION_NOT_CONFIRMED','The selected option label was not read back in its original wizard field; inspect before retry');
          record('wizard_option_verified',{field:choice.field.name,label:choice.label,settings_applied:false});
        }
        if(task.action.verb==='wizard_step') {
          const unchangedContext=fresh=>fresh.authenticated && fresh.origin===current.origin && fresh.loginom_build===current.loginom_build
            && same(fresh.workflow_ref,current.workflow_ref) && same(fresh.package_identity,current.package_identity)
            && same(fresh.active_identity,current.active_identity) && fresh.wizard.status==='observed'
            && fresh.wizard.root_ref===current.wizard.root_ref && same(fresh.ui.dialogs,current.ui.dialogs);
          // Wait only for this one click. No timeout or intermediate mask can
          // issue a second click or turn a closed wizard into an applied claim.
          for(let attempt=0;attempt<24 && unchangedContext(observed)
            && (observed.wizard.stage!==task.action.expected_stage || observed.ui.masks.length);attempt++) {
            timeout();await page.waitForTimeout(Math.min(200,timeout()));observed=await readUi();
          }
          if(!unchangedContext(observed) || observed.ui.masks.length || observed.wizard.stage!==task.action.expected_stage)
            fail('WIZARD_STEP_NOT_CONFIRMED','The requested destination stage was not confirmed after one click; inspect before retry');
          record('wizard_step_verified',{from_stage:current.wizard.stage,to_stage:observed.wizard.stage,
            root_ref:observed.wizard.root_ref,settings_applied:false,syntax_validity:'unverified'});
        }
        if(task.action.verb==='set_wizard_field') {
          const before=current.ui.elements.find(item=>item.ref===task.action.ref);
          const after=observed.ui.elements.find(item=>item.ref===before.ref);
          const expected=JSON.parse(JSON.stringify(current.wizard));
          Object.assign(expected.settings.fields[before.wizard_field.name],{value:task.action.text,value_length_utf16:task.action.text.length,truncated:false});
          if(!observed.authenticated || observed.origin!==current.origin || observed.loginom_build!==current.loginom_build
            || !same(observed.workflow_ref,current.workflow_ref) || !same(observed.package_identity,current.package_identity)
            || !same(observed.active_identity,current.active_identity) || !same(observed.wizard,expected)
            || !same(observed.ui.dialogs,current.ui.dialogs) || !same(observed.ui.masks,current.ui.masks)
            || !after || !same(after.identity,before.identity) || !same(after.wizard_field,before.wizard_field)
            || after.value_truncated || after.value!==task.action.text)
            fail('WIZARD_FIELD_NOT_CONFIRMED','The draft value was not confirmed in the same wizard field; inspect before retry');
          record('wizard_draft_value_verified',{ref:after.ref,field:after.wizard_field.name,settings_applied:false});
        }
        if(task.action.verb==='replace_expression') {
          const before=current.ui.elements.find(item=>item.ref===task.action.ref);
          const after=observed.ui.elements.filter(item=>same(item.identity,before.identity));
          const editor=after.length===1?after[0].calculator_editor:null;
          if(!editor || editor.mode!=='expression' || !same(editor.selected_expression,before.calculator_editor.selected_expression)
            || !editor.document.full_text_verified || editor.document.text!==task.action.text
            || ['wrapper_ref','input_ref','document_ref'].some(key=>editor.document[key]!==before.calculator_editor.document[key]))
            fail('EXPRESSION_TEXT_NOT_CONFIRMED','Replacement text was not confirmed in the same selected expression; inspect before retry');
          record('expression_text_verified',{ref:after[0].ref,selected_expression:editor.selected_expression,
            syntax_validity:'unverified',settings_applied:false});
        }
        if (task.action.verb==='set_checked') {
          const before=current.ui.elements.find(item=>item.ref===task.action.ref);
          const matches=observed.ui.elements.filter(item=>same(item.identity,before.identity) && item.tid===before.tid && item.label===before.label && item.check_state?.kind===before.check_state.kind);
          if (matches.length!==1 || matches[0].check_state.checked!==task.action.checked || matches[0].check_state.indeterminate) fail('UI_STATE_NOT_CONFIRMED','The requested checked state was not confirmed; inspect before any retry');
          record('ui_state_verified',{verb:task.action.verb,ref:matches[0].ref,checked:task.action.checked});
        }
        phase = 'completed';
        outcome = result('SUCCEEDED', { ...observed, gesture_applied: effectPossible, verification_required: true });
      }
    } catch (error) {
      record('ui_action_failed', { code: error?.code ?? 'UI_BROWSER_CALL_FAILED' });
      let observed = {};
      if (error?.code === 'UI_SCAN_LIMIT') observed = { observation_required: true, scan: { complete: false, limit_exceeded: true } };
      else try { observed = await readUi(); } catch { /* Never replace uncertainty with a fabricated observation. */ }
      outcome = result(effectPossible ? 'AMBIGUOUS' : 'NOT_APPLIED', observed,
        { code: error?.code ?? 'UI_BROWSER_CALL_FAILED', message: error?.code ? error.message : 'The browser did not confirm the UI operation; inspect the workspace before recovery' });
    } finally {
      if (mouseHeld) {
        try { await page.mouse.up({ button: mouseButton }); record('cleanup_completed', { resource: 'mouse', button: mouseButton }); refreshedAfterCleanup = true; }
        catch { cleanupComplete = false; outcome = result('AMBIGUOUS', outcome?.output, { code: 'UI_CLEANUP_FAILED', message: 'Mouse release could not be confirmed' }); record('cleanup_failed', { resource: 'mouse' }); }
      }
      for (const handle of handles) { try { await handle.dispose(); } catch { /* Disposal does not mutate Loginom. */ } }
    }
    if (refreshedAfterCleanup) {
      try { outcome.output = { ...await readUi(), verification_required: true }; }
      catch { outcome.output = { observation_required: true, verification_required: true }; }
    }
    return { ...outcome, cleanup_complete: cleanupComplete };
  })();
}

export function makeWorkspaceUiCode(options) {
  if (!options || !['observe', 'act'].includes(options.mode)) throw new Error('Workspace UI mode must be observe or act');
  if (options.mode === 'act') validateUiAction(options.action, options.snapshot);
  const task = { ...structuredClone(options), kind: 'workspace-ui' };
  return `async (page) => (${workspaceUiCapability.toString()})(page, ${JSON.stringify(task)})`;
}
