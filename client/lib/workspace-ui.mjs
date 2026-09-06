// The model receives opaque observed references, never executable selectors or
// browser code. All browser-side inspection and gestures below are client-pinned.
export const uiActionSchema = {
  type: 'object', additionalProperties: false, required: ['verb'],
  properties: {
    verb: { type: 'string', enum: ['click', 'double_click', 'right_click', 'fill', 'press', 'drag', 'scroll', 'set_checked', 'replace_expression', 'set_wizard_field', 'wizard_step', 'select_wizard_option', 'apply_expression_parameters', 'cancel_expression_parameters', 'open_wizard', 'finish_wizard', 'apply_output_column', 'cancel_output_column', 'apply_reform_column', 'cancel_reform_column'] },
    expected_stage: { type: 'string', enum: ['text_import_file','text_import_format','input_mapping','output_mapping','calculator','grouping','field_parameters','done'] },
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
  let postActionRoot;
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
      output_mapping:[';ColumnsMappingEngineOutputPortWizard;btnAddMappingColumn',';DerivedDataSourceOutputSocketWizard;btnAddMappingColumn',';DerivedDataSourceMappingEngineOutputPortWizard;btnAddMappingColumn'],
      calculator:';CalcDataWizard;btnAddExpr',grouping:';GroupDataWizard;grdUsedFields;tbl',
      field_parameters:';ReformColumnsWizard;grdTargetColumns;tbl',done:';DoneWizard;edtDisplayName'};
    const wizardButtons=['btnPrev','btnNext','btnDone','btnExecute','btnClose','btnError'];
    const wizardSelectors=['[data-tid$=";ModelForm;cmpDiagram"]','[data-tid$=";NavigationBar;NavigationPanel"]','[data-tid*=";cnrNaviMode;b.s_"]','[data-tid$=";WizrdMCF"]','[data-tid$=";WizrdMCF;cardWizardPanel;p.h;p.t"]',
      ...Object.values(wizardMarkers).flat().map(suffix=>'[data-tid$=";WizrdMCF'+suffix+'"]'),
      '[data-tid*=";WizrdMCF;CalcDataWizard;colExpressionName_"]','[data-tid*=";WizrdMCF;CalcDataWizard;colExpressionDisplayName_"]','[data-tid$=";WizrdMCF;CalcDataWizard;cmpExpression"]','[data-tid$=";WizrdMCF;CalcDataWizard;btnCalcMode"]','span.bg-TBGCalcMode-cmExpression,span.bg-TBGCalcMode-cmJavaScript',
      ...['edtDelimiterChar','edtTextQualifier','edtValueNull','edtDecimalSeparator'].flatMap(name=>{const owner='[data-tid$=";WizrdMCF;ImportTextFileParamsWizard;'+name+';ValueControl"]';return [owner,owner+' input',owner+' textarea'];}),
      ...['edtConnection','edtFileName;ValueControl','edtCodePage;ValueControl','edtRowsToSkip;ValueControl'].flatMap(name=>{
        const owner='[data-tid$=";WizrdMCF;ImportTextFilePreviewWizard;'+name+'"]';return [owner,owner+' input',owner+' textarea'];}),
      '[data-tid$=";WizrdMCF;ImportTextFilePreviewWizard;edtFirstLineAsTitle;ValueControl"]',
      '[data-tid$=";WizrdMCF;ImportTextFilePreviewWizard;edtFirstLineAsTitle;ValueControl;DisplayEl"]',
      ...['grdTargetColumns;tbl','TargetFilter','rbTable','rbLinks','btnAutoSyncThroughColumns'].flatMap(name=>{
        const owner='[data-tid$=";WizrdMCF;ColumnsMappingEngineOutputPortWizard;'+name+'"]';return [owner,owner+' input'];}),
      '[data-tid*=";WizrdMCF;ColumnsMappingEngineOutputPortWizard;grdTargetColumns;tbl;celleditor"]',
      ...['edtDisplayName','cbxNodeTitleMode'].flatMap(name=>{const owner='[data-tid$=";WizrdMCF;DoneWizard;'+name+'"]';return [owner,owner+' input'];}),
      ...['ColumnsMappingEngineOutputPortWizard','DerivedDataSourceOutputSocketWizard','DerivedDataSourceMappingEngineOutputPortWizard','ReformColumnsWizard'].flatMap(form=>
        ['colName_','colDisplayName_','colDataKind_','colDefaultUsageType_','colSourceDisplayName_','colCachingMethod_','colExcluded_'].map(key=>'[data-tid*=";WizrdMCF;'+form+';'+key+'"]')),
      '[data-tid$=";WizrdMCF;EditReformColumnDefForm"]',
      '[data-tid*=";WizrdMCF;ImportTextFileParamsWizard;ColumnDefsTuning;grdSettings;grd-1;normalHeaderCt;"]',
      ...['',';normalHeaderCt',';tbl'].map(suffix=>'[data-tid$=";WizrdMCF;ImportTextFileParamsWizard;ColumnDefsTuning;grdSettings;grd-1'+suffix+'"]'),
      '[data-tid*=";WizrdMCF;ImportTextFileParamsWizard;ColumnDefsTuning;grdSettings;grd-1;tbl;celleditor"][data-tid$=";cbx"]',
      '[data-tid*=";WizrdMCF;ImportTextFileParamsWizard;ColumnDefsTuning;grdSettings;grd-1;tbl;celleditor"][data-tid$=";cbx;trg_picker"]',
      ...['edtName','edtDisplayName','cbxDataType','cbxDataKind','cbxUsageType','cntMain;cbxCachingMethod'].flatMap(name=>{const owner='[data-tid$=";WizrdMCF;EditReformColumnDefForm;'+name+'"]';return [owner,owner+' input'];}),
      '[data-tid$=";WizrdMCF;EditReformColumnDefForm;cntMain;chbExcluded"]','[data-tid$=";WizrdMCF;EditReformColumnDefForm;cntMain;chbExcluded;DisplayEl"]',
      '[data-tid$=";WizrdMCF;EditColumnDefForm"]',
      ...['edtName','edtDisplayName','cbxDataType','cbxDataKind','cbxUsageType'].flatMap(name=>{const owner='[data-tid$=";WizrdMCF;EditColumnDefForm;'+name+'"]';return [owner,owner+' input'];}),
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
    const textOf = (element, fixedContext=false, separator=' ') => {
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
      return short(parts.join(separator));
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
    const graphContainers=workflow?(tids.get(workflow.prefix+';ModelForm;cmpDiagram')??[]):[];
    const activeGraphOwner=element=>{
      if(!visible(element) || sensitive(element))return false;
      const box=boxOf(element);if(box.x+box.width<=0 || box.y+box.height<=0
        || Number.isFinite(globalThis.innerWidth) && box.x>=globalThis.innerWidth
        || Number.isFinite(globalThis.innerHeight) && box.y>=globalThis.innerHeight)return false;
      for(let parent=element.parentElement;parent && parent!==document.body;parent=parent.parentElement) {
        charge();const owner=/^(MF;TF(?:-\d+)?)(?:;|$)/.exec(getTid(parent)??'')?.[1];
        if(owner && owner!==workflow.prefix)return false;
      }
      return true;
    };
    const graphContainer=graphContainers.length===1 && activeGraphOwner(graphContainers[0])?graphContainers[0]:null;
    const graphQueryable=!discoverRoots && graphContainer && (!requestedRoot || requestedRoot===graphContainer || requestedRoot.contains(graphContainer));
    const nativeGraphElements=graphQueryable?all.filter(e=>{charge();return graphContainer.contains(e) && (getTid(e)??'').includes(';Graph;');}):[];
    const namespaces=[...new Set(nativeGraphElements.filter(e=>{charge();return visible(e) && !sensitive(e);})
      .map(e=>/^(MF;TF(?:-\d+)?;Graph;)/.exec(getTid(e)??'')?.[1]).filter(Boolean))];
    const graphPrefix=graphContainer && namespaces.length===1?namespaces[0]:null;
    const graphIdentity=graphPrefix?{status:'observed',container_ref:refOf(graphContainer),container_tid:getTid(graphContainer),native_prefix:graphPrefix}
      :{status:graphContainers.length>1 || namespaces.length>1?'ambiguous':'unobserved'};
    const ownedGraph=element=>!!graphPrefix && graphContainer.contains(element) && (getTid(element)??'').startsWith(graphPrefix);
    const scopeOf = element => {
      if (dialogRef(element)) return 'dialog';
      if(/^(MF;TF(?:-\d+)?;Graph;)/.test(getTid(element)??''))return ownedGraph(element)?'graph':'inactive_workflow';
      let workflowAncestor = false, graphAncestor = false;
      for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) {
        charge();
        const tid = getTid(parent) ?? '', owner = /^(MF;TF(?:-\d+)?);/.exec(tid)?.[1];
        if (owner && owner !== workflow?.prefix && !ownedGraph(parent)) return 'inactive_workflow';
        if (owner) workflowAncestor = true;
        if (parent===graphContainer) graphAncestor = true;
      }
      if (graphAncestor && element.matches('textarea,input,[contenteditable="true"]')) return 'graph_editor';
      return workflowAncestor ? 'workflow' : 'global';
    };
    const wizardForms=all.filter(element=>getTid(element)===workflow?.prefix+';WizrdMCF' && visible(element) && !sensitive(element));
    let wizard={status:wizardForms.length?'ambiguous':'absent'};
    if (wizardForms.length===1) {
      const form=wizardForms[0],base=getTid(form);
      const matching=suffix=>(tids.get(base+suffix)??[]).filter(element=>form.contains(element) && visible(element) && !sensitive(element));
      const titles=matching(';cardWizardPanel;p.h;p.t');
      const stages=Object.entries(wizardMarkers).flatMap(([key,suffixes])=>[suffixes].flat().flatMap(suffix=>matching(suffix).map(()=>key)));
      wizard={status:'observed',root_tid:base,root_ref:refOf(form),title:titles.length===1?textOf(titles[0],true):null,
        title_status:titles.length===1?'observed':titles.length?'ambiguous':'unobserved',
        stage:stages.length===1?stages[0]:null,stage_status:stages.length===1?'observed':stages.length?'ambiguous':'unrecognized',
        controls:Object.fromEntries(wizardButtons.map(name=>{const found=matching(';'+name);return [name,
          {status:found.length===1?'observed':found.length?'ambiguous':'unobserved',enabled:found.length===1?enabled(found[0]):null}];}))};
    }
    let navigationContext={status:'unobserved'};
    if(workflow) {
      // E2E navigation.GetCurrentTabPath: inspect the current tab's visible
      // breadcrumb buttons, not document.title. This is observed context only;
      // proving which graph click opened the wizard requires an action receipt.
      const panels=(tids.get(workflow.prefix+';NavigationBar;NavigationPanel')??[]).filter(e=>visible(e) && !sensitive(e));
      let ownerContext={status:panels.length>1?'ambiguous':'unobserved',opening_verified:false};
      let portContext={status:panels.length>1?'ambiguous':'unobserved',opening_verified:false};
      if(panels.length===1) {
        const prefix=workflow.prefix+';cnrNaviMode;b.s_';
        const crumbs=all.filter(e=>{charge();return (getTid(e)??'').startsWith(prefix) && panels[0].contains(e) && visible(e) && !sensitive(e);});
        if(crumbs.length>32)ownerContext.status='bounded';
        else if(crumbs.length) {
          const items=crumbs.map(e=>({ref:refOf(e),tid:getTid(e),label:textOf(e,true),
            wizard_icon:e.querySelectorAll('.maptree-icon-wizard').length===1,
            workflow_icon:e.querySelectorAll('.maptree-icon-workflow').length===1,
            outputs_icon:e.querySelectorAll('.maptree-icon-modeloutputports').length===1,
            output_data_icon:e.querySelectorAll('.bg-vendor-icon-deriveddatasourceoutputsocketdef,.bg-vendor-icon-outputdatasourcesocketdef').length===1,
            vendor_icon:e.querySelectorAll('[class*="bg-vendor-icon-"]').length===1}));
          const unique=new Set(items.map(i=>i.tid)).size===items.length;
          const chain=items.every((item,index)=>item.tid.length<=2048 && item.label.length<240
            && (!index || item.tid.startsWith(items[index-1].tid+'>')));
          const last=items.at(-1),node=items.at(-2);
          if(items.reduce((size,item)=>size+item.tid.length+item.label.length,0)>4096)ownerContext.status='bounded';
          else if(!unique || !chain)ownerContext.status='ambiguous';
          else if(last.workflow_icon) {
            navigationContext={status:'observed',kind:'workflow',path:items.map(({tid,label})=>({tid,label}))};
          }
          else if(last.wizard_icon && items.filter(i=>i.wizard_icon).length===1 && node?.output_data_icon && node.label
            && items.at(-3)?.outputs_icon && items.at(-4)?.vendor_icon && items.at(-4)?.label && items.at(-5)?.workflow_icon) {
            const parent=items.at(-4);
            portContext={status:'observed',opening_verified:false,kind:'output_data',panel_ref:refOf(panels[0]),
              node:{ref:parent.ref,tid:parent.tid,label:parent.label},port:{ref:node.ref,tid:node.tid,label:node.label},
              path:items.map(({ref,tid,label})=>({ref,tid,label}))};
          }
          else if(last.wizard_icon && items.filter(i=>i.wizard_icon).length===1 && node?.vendor_icon && node.label && items.at(-3)?.workflow_icon) {
            ownerContext={status:'observed',opening_verified:false,panel_ref:refOf(panels[0]),
              node:{ref:node.ref,tid:node.tid,label:node.label},
              path:items.map(({ref,tid,label})=>({ref,tid,label}))};
          }
        }
      }
      if(wizard.status==='observed')wizard.owner_context=ownerContext;
      if(wizard.status==='observed' && wizard.stage==='output_mapping')wizard.port_context=portContext;
    }
    if(wizard.status==='observed' && ['output_mapping','field_parameters'].includes(wizard.stage)) {
      const reform=wizard.stage==='field_parameters',columnsKey=reform?'reform_columns':'output_columns';
      const mappingForms=['ColumnsMappingEngineOutputPortWizard','DerivedDataSourceOutputSocketWizard','DerivedDataSourceMappingEngineOutputPortWizard'].filter(name=>
        (tids.get(wizard.root_tid+';'+name+';btnAddMappingColumn')??[]).filter(visible).length===1);
      const base=wizard.root_tid+';'+(reform?'ReformColumnsWizard':mappingForms.length===1?mappingForms[0]:'__unobserved__')+';';
      const cells=all.filter(e=>{charge();return (getTid(e)??'').startsWith(base+'colName_') && wizardForms[0].contains(e)
        && visible(e) && !sensitive(e) && !e.closest('.x-grid-row-summary');});
      if(cells.length) {
        wizard[columnsKey]={status:cells.length>64?'bounded':'rendered_rows',complete:false,settings_applied:false,fields:[]};
        if(cells.length<=64) {
          const keys=cells.map(e=>getTid(e).slice((base+'colName_').length));
          wizard[columnsKey].fields=cells.map((cell,index)=>{
            const key=keys[index],row=cell.closest('table');
            const labels=(tids.get(base+'colDisplayName_'+key)??[]).filter(e=>row && e.closest('table')===row && !e.closest('.x-grid-row-summary') && visible(e) && !sensitive(e));
            const name=textOf(cell,true),label=labels.length===1?textOf(labels[0],true):'';
            const icons=labels.length===1?[...labels[0].querySelectorAll('[class*="bg-TBGDataType-dt"]')]:[];
            const types=Object.entries({String:'string',Integer:'integer',Float:'real',Boolean:'boolean',DateTime:'datetime',Variant:'variant'})
              .filter(([kind])=>icons.length===1 && icons[0].classList.contains('bg-TBGDataType-dt'+kind));
            if(keys.filter(k=>k===key).length!==1 || labels.length!==1 || types.length!==1 || !name || name.length>=240 || label.length>=240)
              return {status:'ambiguous',field_key:key.slice(0,240)};
            const extras=Object.fromEntries(Object.entries({data_kind:'colDataKind_',usage:'colDefaultUsageType_',...(reform?{caching:'colCachingMethod_'}:{})}).map(([name,prefix])=>{
              const cells=(tids.get(base+prefix+key)??[]).filter(e=>e.closest('table')===row && !e.closest('.x-grid-row-summary') && visible(e) && !sensitive(e));
              const text=cells.length===1?textOf(cells[0],true):null;return [name,text && text.length<240?text:null];
            }));
            const sources=(tids.get(base+'colSourceDisplayName_'+key)??[]).filter(e=>e.closest('table')===row && !e.closest('.x-grid-row-summary') && visible(e) && !sensitive(e));
            let source={status:sources.length>1?'ambiguous':'unobserved',identity_verified:false};
            if(sources.length===1) {
              const cell=sources[0],label=textOf(cell,true),icons=[...cell.querySelectorAll('[class*="bg-TBGDataType-dt"]')];
              const nulls=cell.querySelectorAll('.bg-cell-null-value').length;
              const types=Object.entries({String:'string',Integer:'integer',Float:'real',Boolean:'boolean',DateTime:'datetime',Variant:'variant'})
                .filter(([kind])=>icons.length===1 && icons[0].classList.contains('bg-TBGDataType-dt'+kind));
              source={status:!label && nulls===1 && !icons.length?'unmapped':label && label.length<240 && !nulls && types.length===1?'rendered_source':'ambiguous',identity_verified:false,cell_ref:refOf(cell)};
              if(source.status==='rendered_source'){source.label=label;source.type=types[0][1];}
            }
            let excluded=null;
            if(reform) {
              const cells=(tids.get(base+'colExcluded_'+key)??[]).filter(e=>e.closest('table')===row && !e.closest('.x-grid-row-summary') && visible(e) && !sensitive(e));
              const checks=cells.length===1?[...cells[0].querySelectorAll('.x-grid-checkcolumn')]:[];
              if(checks.length===1)excluded=checks[0].classList.contains('x-grid-checkcolumn-checked');
            }
            return {status:'observed',name,label,type:types[0][1],...extras,...(reform?{excluded}:{source}),selected:row.classList.contains('x-grid-item-selected'),name_ref:refOf(cell),label_ref:refOf(labels[0]),row_ref:refOf(row)};
          });
        }
      }
    }
    if(wizard.output_columns) {
      let coverage={status:'partial',source_identity_verified:false};
      const base=wizard.root_tid+';ColumnsMappingEngineOutputPortWizard;';
      const unique=key=>{const es=tids.get(base+key)??[];return es.length===1 && wizardForms[0].contains(es[0])
        && visible(es[0]) && !sensitive(es[0])?es[0]:null;};
      const body=unique('grdTargetColumns;tbl'),filter=unique('TargetFilter'),tableMode=unique('rbTable'),linksMode=unique('rbLinks');
      const auto=unique('btnAutoSyncThroughColumns');
      wizard.output_columns.auto_sync=auto?{status:'observed',value:auto.classList.contains('x-btn-pressed'),ref:refOf(auto)}:{status:'unobserved'};
      if(body && filter && tableMode && linksMode) {
        const containers=[...body.querySelectorAll('.x-grid-item-container')];charge();
        const rows=[...body.querySelectorAll('table.x-grid-item')];charge();
        const inputs=[...filter.querySelectorAll('input')].filter(e=>{charge();return visible(e) && !sensitive(e);});
        const inside=(e,parent)=>{
          if(!visible(e) || sensitive(e))return false;
          const b=boxOf(e),p=boxOf(parent),vw=globalThis.innerWidth,vh=globalThis.innerHeight;
          return [b.x,b.y,b.width,b.height,p.x,p.y,p.width,p.height,vw,vh].every(Number.isFinite)
            && vw>0 && vh>0 && b.x>=0 && b.y>=0 && b.x+b.width<=vw && b.y+b.height<=vh
            && b.x>=p.x && b.y>=p.y && b.x+b.width<=p.x+p.width && b.y+b.height<=p.y+p.height;
        };
        const dimensions=[body.clientWidth,body.clientHeight,body.scrollWidth,body.scrollHeight,body.scrollLeft,body.scrollTop];
        const fields=wizard.output_columns.fields;
        const noEditors=!all.some(e=>{charge();return ((getTid(e)??'').startsWith(base+'grdTargetColumns;tbl;celleditor')
          || getTid(e)===wizard.root_tid+';EditColumnDefForm') && visible(e);});
        const noMasks=!select('.bg-mask-message,.x-mask-msg').some(visible);
        if(containers.length===1 && rows.length>0 && rows.length<=8 && rows.length===fields.length
          && dimensions.every(Number.isFinite) && body.clientWidth>0 && body.clientHeight>0
          && body.scrollWidth<=body.clientWidth && body.scrollHeight<=body.clientHeight && body.scrollLeft===0 && body.scrollTop===0
          && inputs.length===1 && String(inputs[0].value??'')==='' && tableMode.classList.contains('x-form-cb-checked')
          && !linksMode.classList.contains('x-form-cb-checked') && noEditors && noMasks && inside(body,body)) {
          const container=containers[0],cb=boxOf(container),bb=boxOf(body);
          const direct=[...container.children];charge();
          const bodyChildren=[...body.children];charge();
          const boundId=body.getAttribute('id');
          const valid=boundId && inside(container,body) && cb.y===bb.y && cb.x===bb.x
            && direct.length===rows.length && direct.every(e=>rows.includes(e))
            && bodyChildren.every(e=>e===container || !visible(e))
            && rows.every((row,index)=>{
              charge();const rb=boxOf(row),previous=index?boxOf(rows[index-1]):null;
              const matches=fields.filter(f=>f.row_ref===refOf(row));
              const nameCells=all.filter(e=>{charge();return row.contains(e) && (getTid(e)??'').startsWith(base+'colName_');});
              if(row.parentElement!==container || row.getAttribute('data-recordindex')!==String(index)
                || row.getAttribute('data-boundview')!==boundId || !inside(row,container)
                || rb.y!==(previous?previous.y+previous.height:cb.y) || matches.length!==1 || matches[0].status!=='observed'
                || nameCells.length!==1)return false;
              const key=getTid(nameCells[0]).slice((base+'colName_').length);
              return ['colName_','colDisplayName_','colSourceDisplayName_','colDataKind_','colDefaultUsageType_'].every(prefix=>{
                const es=tids.get(base+prefix+key)??[];
                return es.length===1 && row.contains(es[0]) && inside(es[0],row);
              });
            }) && boxOf(rows.at(-1)).y+boxOf(rows.at(-1)).height===cb.y+cb.height;
          if(valid)coverage={status:'complete_configured_rows',count:rows.length,body_ref:refOf(body),container_ref:refOf(container),
            first_row_ref:refOf(rows[0]),last_row_ref:refOf(rows.at(-1)),filter_ref:refOf(inputs[0]),table_mode_ref:refOf(tableMode),source_identity_verified:false};
        }
      }
      wizard.output_columns.definition_coverage=coverage;
    }
    if(wizard.status==='observed' && wizard.stage==='done') {
      const base=wizard.root_tid+';DoneWizard;';
      const fields=Object.fromEntries(Object.entries({label:'edtDisplayName',label_mode:'cbxNodeTitleMode'}).map(([name,key])=>{
        const owners=(tids.get(base+key)??[]).filter(e=>wizardForms[0].contains(e) && visible(e) && !sensitive(e));
        const inputs=owners.length===1?dom.filter(e=>{charge();return owners[0].contains(e) && e.matches('input') && visible(e) && !sensitive(e);}):[];
        if(inputs.length!==1)return [name,{status:inputs.length>1?'ambiguous':'unobserved'}];
        const input=inputs[0],value=String(input.value??'');
        return [name,{status:'observed',value:value.slice(0,240),truncated:value.length>=240,input_ref:refOf(input),owner_ref:refOf(owners[0]),enabled:enabled(input)}];
      }));
      wizard.completion={fields,ready:Object.values(fields).every(f=>f.status==='observed' && !f.truncated && f.enabled && f.value && !/[\0\r\n]/.test(f.value))
        && ['Автоматическая метка','Пользовательская метка'].includes(fields.label_mode.value),settings_applied:false};
    }
    if(wizard.status==='observed' && wizard.stage==='calculator') {
      const base=wizard.root_tid+';CalcDataWizard;';
      const selected=all.filter(e=>{charge();return (getTid(e)??'').startsWith(base+'colExpressionName_') && visible(e) && !sensitive(e) && e.closest('table')?.classList.contains('x-grid-item-selected');});
      wizard.expression_selection={status:selected.length>1?'ambiguous':'unobserved'};
      if(selected.length===1) {
        const cell=selected[0],suffix=getTid(cell).slice((base+'colExpressionName_').length),row=cell.closest('table');
        const labels=(tids.get(base+'colExpressionDisplayName_'+suffix)??[]).filter(e=>visible(e) && !sensitive(e) && e.closest('table')===row);
        const typeNames={None:'Неопределенный',DateTime:'Дата/Время',Float:'Вещественный',Integer:'Целый',Boolean:'Логический',String:'Строковый',Variant:'Переменный'};
        const icons=[...cell.querySelectorAll('[class*="bg-TBGDataType-dt"]')];charge();
        const types=icons.length<=8?Object.entries(typeNames).filter(([type])=>icons.some(e=>{charge();return visible(e) && e.classList.contains('bg-TBGDataType-dt'+type);})):[];
        const name=String(cell.textContent??''),label=labels.length===1?String(labels[0].textContent??''):null;
        if(labels.length===1 && types.length===1 && name.length<=256 && label.length<=256)
          wizard.expression_selection={status:'observed',row_ref:refOf(row),name,label,type_label:types[0][1]};
      }
    }
    if(wizard.status==='observed' && wizard.stage==='field_parameters') {
      const base=wizard.root_tid+';EditReformColumnDefForm';
      const forms=(tids.get(base)??[]).filter(e=>visible(e) && !sensitive(e));
      if(forms.length) {
        wizard.reform_parameters={status:forms.length===1?'observed':'ambiguous',applied_verified:false};
        if(forms.length===1) {
          const form=forms[0],selected=(wizard.reform_columns?.fields??[]).filter(f=>f.status==='observed' && f.selected);
          const fields=Object.fromEntries(Object.entries({name:'edtName',label:'edtDisplayName',type_label:'cbxDataType',data_kind:'cbxDataKind',usage:'cbxUsageType',caching:'cntMain;cbxCachingMethod'}).map(([name,key])=>{
            const owners=(tids.get(base+';'+key)??[]).filter(e=>form.contains(e) && visible(e) && !sensitive(e));
            const inputs=owners.length===1?dom.filter(e=>{charge();return owners[0].contains(e) && e.matches('input') && visible(e) && !sensitive(e);}):[];
            if(inputs.length!==1)return [name,{status:inputs.length>1?'ambiguous':'unobserved'}];
            const input=inputs[0],value=String(input.value??'');
            return [name,{status:'observed',value:value.slice(0,256),value_length_utf16:value.length,truncated:value.length>256,input_ref:refOf(input),owner_ref:refOf(owners[0]),enabled:enabled(input),read_only:input.readOnly===true}];
          }));
          const owners=(tids.get(base+';cntMain;chbExcluded')??[]).filter(e=>form.contains(e) && visible(e) && !sensitive(e));
          const displays=(tids.get(base+';cntMain;chbExcluded;DisplayEl')??[]).filter(e=>owners.length===1 && owners[0].contains(e) && visible(e) && !sensitive(e));
          fields.excluded=owners.length===1 && displays.length===1 && displays[0].matches('.x-form-checkbox')
            ?{status:'observed',value:owners[0].classList.contains('x-form-cb-checked'),owner_ref:refOf(owners[0]),display_ref:refOf(displays[0]),enabled:enabled(displays[0])}
            :{status:owners.length>1 || displays.length>1?'ambiguous':'unobserved'};
          Object.assign(wizard.reform_parameters,{root_ref:refOf(form),selected_column:selected.length===1?selected[0]:null,fields});
        }
      }
    }
    if(wizard.status==='observed' && wizard.stage==='text_import_file') {
      // E2E sImportTxt.previewWizard and Help: property wrappers also contain
      // variable inputs. Only the exact ValueControl owns the displayed value.
      const base=wizard.root_tid+';ImportTextFilePreviewWizard;';
      const fields=Object.fromEntries(Object.entries({source_path:'edtFileName;ValueControl',connection:'edtConnection',
        encoding:'edtCodePage;ValueControl',rows_to_skip:'edtRowsToSkip;ValueControl'}).map(([name,key])=>{
        const owners=(tids.get(base+key)??[]).filter(e=>wizardForms[0].contains(e) && visible(e) && !sensitive(e));
        const inputs=owners.length===1?dom.filter(e=>{charge();return owners[0].contains(e)
          && e.matches('input:not([type="hidden"]),textarea') && visible(e) && !sensitive(e);}):[];
        if(owners.length!==1 || inputs.length!==1)return [name,{status:owners.length>1 || inputs.length>1?'ambiguous':'unobserved'}];
        const input=inputs[0],value=String(input.value??'');
        // URLs can embed basic-auth credentials or query tokens. The local
        // source readback never persists such URLs as a newly structured value.
        if(name==='source_path' && /[a-z][a-z0-9+.-]*:\/\//i.test(value))return [name,{status:'redacted',value_kind:'url'}];
        const limit=name==='source_path'?2048:256;
        return [name,{status:'observed',value:value.slice(0,limit),value_length_utf16:value.length,truncated:value.length>limit,
          input_ref:refOf(input),owner_ref:refOf(owners[0]),enabled:enabled(input),read_only:input.readOnly===true,
          value_kind:'displayed_input_text'}];
      }));
      const ownerTid=base+'edtFirstLineAsTitle;ValueControl';
      const owners=(tids.get(ownerTid)??[]).filter(e=>wizardForms[0].contains(e) && visible(e) && !sensitive(e));
      const displays=(tids.get(ownerTid+';DisplayEl')??[]).filter(e=>owners.length===1 && owners[0].contains(e) && visible(e) && !sensitive(e));
      fields.first_line_as_title=owners.length===1 && displays.length===1 && displays[0].matches('.x-form-checkbox')
        ?{status:'observed',value:owners[0].classList.contains('x-form-cb-checked'),owner_ref:refOf(owners[0]),
          display_ref:refOf(displays[0]),enabled:enabled(displays[0]),value_kind:'loginom_ext_checkbox'}
        :{status:owners.length>1 || displays.length>1?'ambiguous':'unobserved'};
      wizard.import_source={status:'draft_ui_values',settings_applied:false,file_bytes_verified:false,schema_complete:false,fields};
    }
    const wizardFields=new Map(),wizardCombos=new Map();
    const reformParams=wizard.reform_parameters;
    if(reformParams?.status==='observed' && reformParams.selected_column && Object.keys(reformParams.fields??{}).length===7
      && Object.values(reformParams.fields).every(f=>f.status==='observed' && !f.truncated)) {
      const field=reformParams.fields.type_label;
      if(field.enabled && !field.read_only)
        wizardCombos.set(wizard.root_tid+';EditReformColumnDefForm;cbxDataType',{name:'type_label',scope:'reform_column',
          owner_ref:field.owner_ref,input_ref:field.input_ref,root_ref:wizard.root_ref,parameter_root_ref:reformParams.root_ref,
          selected_column:reformParams.selected_column,value:field.value});
    }

    if(wizard.status==='observed' && wizard.stage==='output_mapping') {
      const base=wizard.root_tid+';EditColumnDefForm';
      const forms=(tids.get(base)??[]).filter(e=>visible(e) && !sensitive(e));
      if(forms.length) {
        wizard.column_parameters={status:forms.length===1?'observed':'ambiguous',applied_verified:false};
        if(forms.length===1) {
          const selected=(wizard.output_columns?.fields??[]).filter(field=>field.status==='observed' && dom.some(e=>{charge();return state.ids.get(e)===field.name_ref && e.closest('table')?.classList.contains('x-grid-item-selected');}));
          const selection=selected.length===1?selected[0]:null;
          wizard.column_parameters.root_ref=refOf(forms[0]);wizard.column_parameters.selected_column=selection;
          wizard.column_parameters.fields=Object.fromEntries(Object.entries({name:'edtName',label:'edtDisplayName',type_label:'cbxDataType',data_kind:'cbxDataKind',usage:'cbxUsageType'}).map(([name,key])=>{
            const owners=(tids.get(base+';'+key)??[]).filter(e=>forms[0].contains(e) && visible(e) && !sensitive(e));
            const inputs=owners.length===1?dom.filter(e=>{charge();return owners[0].contains(e) && e.matches('input') && visible(e) && !sensitive(e);}):[];
            if(inputs.length!==1)return [name,{status:inputs.length>1?'ambiguous':'unobserved'}];
            const input=inputs[0],value=String(input.value??''),rawMax=input.getAttribute('maxlength');
            const nativeMax=rawMax!==null && /^\d+$/.test(rawMax) && Number.isSafeInteger(Number(rawMax))?Number(rawMax):256;
            if(['name','label'].includes(name) && selection && value.length<=256 && enabled(input) && !input.readOnly)
              wizardFields.set(input,{name,scope:'output_column',max_length_utf16:Math.min(nativeMax,256),stage:wizard.stage,
                root_ref:refOf(forms[0]),wizard_root_ref:wizard.root_ref,owner_ref:refOf(owners[0]),selected_column:selection});
            if(name==='type_label' && selection && value.length<=256 && enabled(input))
              wizardCombos.set(base+';'+key,{name,scope:'output_column',owner_ref:refOf(owners[0]),input_ref:refOf(input),
                root_ref:wizard.root_ref,parameter_root_ref:refOf(forms[0]),selected_column:selection,value});
            return [name,{status:'observed',value:value.slice(0,256),value_length_utf16:value.length,truncated:value.length>256,
              input_ref:refOf(input),owner_ref:refOf(owners[0]),enabled:enabled(input),read_only:input.readOnly===true}];
          }));
        }
      }
    }

    if(wizard.column_parameters && (Object.values(wizard.column_parameters.fields??{}).length!==5
      || Object.values(wizard.column_parameters.fields??{}).some(f=>f.status!=='observed' || f.truncated))) {
      for(const [input,field] of wizardFields)if(field.scope==='output_column')wizardFields.delete(input);
      for(const [owner,field] of wizardCombos)if(field.scope==='output_column')wizardCombos.delete(owner);
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
          const selected=all.filter(e=>{charge();return (getTid(e)??'').startsWith(wizard.root_tid+';CalcDataWizard;colExpressionName_') && visible(e) && !sensitive(e) && e.closest('table')?.classList.contains('x-grid-item-selected');});
          const selectedExpression=selected.length===1?{ref:refOf(selected[0]),tid:getTid(selected[0]),label:textOf(selected[0],true)}:null;
          wizard.expression_parameters.selected_expression=selectedExpression;
          wizard.expression_parameters.fields=Object.fromEntries(Object.entries({name:'edtName',label:'edtDisplayName',type_label:'cbxDataType'}).map(([name,key])=>{
            const owners=(tids.get(base+';'+key)??[]).filter(e=>forms[0].contains(e) && visible(e) && !sensitive(e));
            const inputs=owners.length===1?dom.filter(e=>{charge();return owners[0].contains(e) && e.matches('input') && visible(e) && !sensitive(e);}):[];
            if(owners.length!==1 || inputs.length!==1)return [name,{status:owners.length>1 || inputs.length>1?'ambiguous':'unobserved'}];
            const value=String(inputs[0].value??''),input=inputs[0];
            const rawMax=input.getAttribute('maxlength'),nativeMax=rawMax!==null && /^\d+$/.test(rawMax) && Number.isSafeInteger(Number(rawMax))?Number(rawMax):null;
            if(['name','label'].includes(name) && selectedExpression && value.length<=256 && !/[\0\r\n]/.test(value) && enabled(input) && !input.readOnly)
              wizardFields.set(input,{name,scope:'expression_parameter',max_length_utf16:Math.min(256,nativeMax??256),stage:wizard.stage,
                root_ref:refOf(forms[0]),wizard_root_ref:wizard.root_ref,owner_ref:refOf(owners[0]),selected_expression:selectedExpression});
            if(name==='type_label' && selectedExpression && value.length<=256 && enabled(input))
              wizardCombos.set(base+';'+key,{name,scope:'expression_parameter',owner_ref:refOf(owners[0]),input_ref:refOf(input),
                root_ref:wizard.root_ref,parameter_root_ref:refOf(forms[0]),selected_expression:selectedExpression,value});
            return [name,{status:'observed',value:value.slice(0,256),value_length_utf16:value.length,truncated:value.length>256,
              input_ref:refOf(inputs[0]),owner_ref:refOf(owners[0]),enabled:enabled(inputs[0]),read_only:inputs[0].readOnly===true}];
          }));
        }
      }
    }
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
          wizardFields.set(input,{name,scope:'import_format',max_length_utf16:Math.min(256,nativeMax??256),stage:wizard.stage,root_ref:refOf(wizardForms[0]),owner_ref:refOf(owners[0])});
        return [name,{status:'observed',value:value.slice(0,256),value_length_utf16:value.length,truncated:value.length>256,
          enabled:enabled(input),read_only:input.readOnly===true,source_tid:ownerTid,input_ref:refOf(input),owner_ref:refOf(owners[0]),value_kind:'displayed_input_text',native_max_length_utf16:nativeMax}];
      }))};
      // E2E sColumnDefsTuning: properties are rows; field identity is a column
      // index. These are rendered draft settings, never complete output schema.
      const columnBase=base+'ColumnDefsTuning;grdSettings;grd-1;normalHeaderCt;';
      const headers=all.filter(e=>{charge();const tid=getTid(e);return tid?.startsWith(columnBase)
        && /^\d{1,4}$/.test(tid.slice(columnBase.length)) && visible(e) && !sensitive(e);});
      const indexes=[...new Set(headers.map(e=>getTid(e).slice(columnBase.length)))];
      const types={'Целый':'integer','Вещественный':'real','Строковый':'string','Логический':'boolean','Дата/Время':'datetime','Переменный':'variant'};
      const columns=indexes.slice(0,8).map(index=>{
        const cells=[0,1,2,3,4].map(row=>(tids.get(columnBase+index+'_'+row)??[])
          .filter(e=>visible(e) && !sensitive(e) && wizardForms[0].contains(e)));
        const unique=headers.filter(e=>getTid(e)===columnBase+index).length===1 && cells.every(es=>es.length===1);
        if(!unique)return {index:Number(index),status:'unobserved_or_ambiguous'};
        const values=cells.slice(0,4).map(es=>textOf(es[0],true));
        const checks=cells[4][0].querySelectorAll('.x-grid-checkcolumn');charge();
        const used=checks.length===1 && visible(checks[0]) && !sensitive(checks[0]) ? checks[0].classList.contains('x-grid-checkcolumn-checked'):null;
        if(values.some(v=>!v || v.length>120) || !types[values[2]] || used===null)
          return {index:Number(index),status:'unobserved_or_ambiguous'};
        return {index:Number(index),status:'observed',header_ref:refOf(headers.find(e=>getTid(e)===columnBase+index)),name:values[0],label:values[1],type:types[values[2]],data_kind:values[3],used,
          cell_refs:Object.fromEntries(['name','label','type','data_kind','used'].map((key,i)=>[key,refOf(cells[i][0])]))};
      });
      // The cell's old text is hidden while the floating editor is open.
      // Bind the draft input to one selected property; never promote it to an
      // applied column value. Choice actions require the whole column binding.
      const editorBase=base+'ColumnDefsTuning;grdSettings;grd-1;tbl;';
      const editors=all.filter(e=>{charge();const tid=getTid(e);return tid?.startsWith(editorBase)
        && /^celleditor(?:-\d+)?;cbx$/.test(tid.slice(editorBase.length)) && visible(e) && !sensitive(e) && wizardForms[0].contains(e);});
      if(editors.length) {
        wizard.import_column_editor={status:'unobserved_or_ambiguous',settings_applied:false};
        const selected=all.filter(e=>{charge();const tid=getTid(e);return tid?.startsWith(columnBase)
          && /^\d{1,4}_[0-4]$/.test(tid.slice(columnBase.length)) && visible(e) && !sensitive(e)
          && wizardForms[0].contains(e) && e.classList.contains('x-grid-cell-selected');});
        if(editors.length===1 && selected.length===1) {
          const [index,row]=getTid(selected[0]).slice(columnBase.length).split('_');
          const nativeInputs=editors[0].querySelectorAll('input:not([type="hidden"])');charge();
          const inputs=[...nativeInputs].filter(e=>{charge();return visible(e) && !sensitive(e);});
          const boundCells=[0,1,2,3,4].map(r=>(tids.get(columnBase+index+'_'+r)??[]).filter(e=>visible(e) && !sensitive(e) && wizardForms[0].contains(e)));
          const value=inputs.length===1?String(inputs[0].value??''):'';
          const name=boundCells[0].length===1?textOf(boundCells[0][0],true):'',label=boundCells[1].length===1?textOf(boundCells[1][0],true):'';
          const canonical=row==='2'?types[value]:row==='3' && ['Неопределенное','Непрерывный','Дискретный'].includes(value)?value:null;
          if(canonical && name && name.length<=120 && label && label.length<=120 && inputs.length===1)
            wizard.import_column_editor={status:'observed',index:Number(index),name,label,property:row==='2'?'type':'data_kind',
              value,canonical_value:canonical,input_ref:refOf(inputs[0]),owner_ref:refOf(editors[0]),cell_ref:refOf(selected[0]),
              enabled:enabled(inputs[0]),settings_applied:false};
          const checks=boundCells[4].length===1?boundCells[4][0].querySelectorAll('.x-grid-checkcolumn'):[];charge();
          const used=checks.length===1 && visible(checks[0]) && !sensitive(checks[0])?checks[0].classList.contains('x-grid-checkcolumn-checked'):null;
          const otherRow=row==='2'?3:2,otherValue=boundCells[otherRow]?.length===1?textOf(boundCells[otherRow][0],true):'';
          const otherCanonical=row==='2'?['Неопределенное','Непрерывный','Дискретный'].includes(otherValue)?otherValue:null:types[otherValue];
          if(wizard.import_column_editor.status==='observed' && boundCells.every(es=>es.length===1)
            && headers.filter(e=>getTid(e)===columnBase+index).length===1 && used!==null && otherCanonical) {
            Object.assign(wizard.import_column_editor,{used,header_ref:refOf(headers.find(e=>getTid(e)===columnBase+index)),
              other_property:row==='2'?'data_kind':'type',other_value:otherCanonical,
              cell_refs:Object.fromEntries(['name','label','type','data_kind','used'].map((key,i)=>[key,refOf(boundCells[i][0])]))});
            const pickers=(tids.get(getTid(editors[0])+';trg_picker')??[]).filter(e=>visible(e) && !sensitive(e));
            const pickerReady=pickers.length===1 && editors[0].contains(pickers[0]) && enabled(pickers[0]) && enabled(inputs[0]);
            wizard.import_column_editor.picker_status=pickerReady?'observed':pickers.length>1?'ambiguous':'unobserved';
            if(pickerReady)wizard.import_column_editor.picker_ref=refOf(pickers[0]);
            if(enabled(inputs[0]))wizardCombos.set(getTid(editors[0]),{name:wizard.import_column_editor.property,scope:'import_column',
              root_ref:wizard.root_ref,owner_ref:refOf(editors[0]),input_ref:refOf(inputs[0]),value});
          }

        }
      }
      // Configured definitions are complete only when the whole bounded native
      // grid is visible. This says nothing about source bytes or output schema.
      const gridTid=base+'ColumnDefsTuning;grdSettings;grd-1';
      let coverage={status:'partial',source_schema_verified:false};
      const grids=tids.get(gridTid)??[],headerContainers=tids.get(gridTid+';normalHeaderCt')??[],bodies=tids.get(gridTid+';tbl')??[];
      const contained=(element,container)=>{
        if(!visible(element) || sensitive(element))return false;
        const b=boxOf(element),c=boxOf(container),vw=globalThis.innerWidth,vh=globalThis.innerHeight;
        return [b.x,b.y,b.width,b.height,c.x,c.y,c.width,c.height,vw,vh].every(Number.isFinite)
          && vw>0 && vh>0 && b.x>=0 && b.y>=0 && b.x+b.width<=vw && b.y+b.height<=vh
          && b.x>=c.x && b.y>=c.y && b.x+b.width<=c.x+c.width && b.y+b.height<=c.y+c.height;
      };
      const noOverflow=e=>Number.isFinite(e.clientWidth) && Number.isFinite(e.scrollWidth)
        && e.clientWidth>0 && e.scrollWidth<=e.clientWidth;
      if(grids.length===1 && headerContainers.length===1 && bodies.length===1) {
        const grid=grids[0],container=headerContainers[0],body=bodies[0];
        const nativeHeaders=[...container.querySelectorAll('.x-column-header')];charge();
        const indexed=all.filter(e=>{charge();return (getTid(e)??'').startsWith(columnBase)
          && /^\d+$/.test(getTid(e).slice(columnBase.length));});
        const ordered=[...indexed].sort((a,b)=>Number(getTid(a).slice(columnBase.length))-Number(getTid(b).slice(columnBase.length)));
        const count=ordered.length;
        const first=nativeHeaders.filter(e=>{charge();return e.classList.contains('x-column-header-first');});
        const last=nativeHeaders.filter(e=>{charge();return e.classList.contains('x-column-header-last');});
        const everyCell=ordered.every((header,index)=>[0,1,2,3,4].every(row=>{
          const peers=tids.get(columnBase+index+'_'+row)??[];
          return peers.length===1 && body.contains(peers[0]) && contained(peers[0],body);
        }));
        if(count>0 && count<=8 && nativeHeaders.length===count && columns.length===count
          && wizardForms[0].contains(grid) && grid.contains(container) && grid.contains(body)
          && contained(grid,grid) && contained(container,grid) && contained(body,grid)
          && noOverflow(grid) && noOverflow(container) && noOverflow(body) && !all.some(e=>{charge();const tid=getTid(e);return tid?.startsWith(editorBase)
            && /^celleditor(?:-\d+)?;cbx$/.test(tid.slice(editorBase.length)) && visible(e);})
          && ordered.every((header,index)=>getTid(header)===columnBase+index && nativeHeaders.includes(header)
            && contained(header,container) && columns[index]?.index===index && columns[index].status==='observed'
            && ['Неопределенное','Непрерывный','Дискретный'].includes(columns[index].data_kind))
          && everyCell && first.length===1 && first[0]===ordered[0] && last.length===1 && last[0]===ordered[count-1])
          coverage={status:'complete_configured_columns',count,grid_ref:refOf(grid),container_ref:refOf(container),
            body_ref:refOf(body),first_header_ref:refOf(first[0]),last_header_ref:refOf(last[0]),source_schema_verified:false};
      }
      wizard.import_columns={status:columns.length?'rendered_draft_columns':'unobserved',fields:columns,
        truncated:indexes.length>8,complete:false,settings_applied:false,definition_coverage:coverage};
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
        loginom_build:globalThis.bg?.app?.Version ?? null,workflow_ref:workflow,graph_identity:graphIdentity,active_identity:active ? textOf(active) : null,
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
        if(tid===ownerTid+';trg_picker')return field.scope!=='import_column' || wizard.import_column_editor?.picker_status==='observed' && wizard.import_column_editor.picker_ref===state.ids.get(element)
          ? {kind:'picker',field}:null;
        const prefix=ownerTid+';boundlist;';
        if(!tid.startsWith(prefix) || !tid.slice(prefix.length) || tid.slice(prefix.length).includes(';'))continue;
        const lists=(tids.get(ownerTid+';boundlist')??[]).filter(visible);
        if(lists.length!==1 || !lists[0].contains(element) || sensitive(lists[0]))return null;
        const label=textOf(element,true),formatted=label.replace(/\s/g,'_').replace(/,/g,'');
        if(!label || label.length>=240 || tid!==prefix+formatted)return null;
        if(field.scope==='import_column' && !(field.name==='type'
          ? ['Целый','Вещественный','Строковый','Логический','Дата/Время','Переменный']
          : ['Неопределенное','Непрерывный','Дискретный']).includes(label))return null;
        return {kind:'option',field,list_ref:refOf(lists[0]),label};
      }
      return null;
    };
    const importColumnCellRefs=new Set((wizard.import_columns?.fields??[]).filter(column=>column.status==='observed')
      .flatMap(column=>[column.cell_refs.type,column.cell_refs.data_kind]));
    const interesting = element => !!comboPart(element) || importColumnCellRefs.has(state.ids.get(element)) || element.matches('button,input,textarea,select,[contenteditable="true"],[role="button"],[role="checkbox"],[role="radio"],[role="combobox"],[role="menuitem"],[role="tab"],[role="treeitem"],[role="option"],[role="spinbutton"]')
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
    const graphElements = graphPrefix ? all.filter(element=>ownedGraph(element) && visible(element) && !sensitive(element)) : [];
    const labels = [...new Set(graphElements.filter(element => /;Label;Label$/.test(getTid(element)) && visible(element))
      .map(element => getTid(element).slice(graphPrefix.length).replace(/;Label;Label$/, '')).filter(label => label && label !== 'Переменные_сценария'))].sort();
    const graphLabels=new Set(labels);
    const graphNodeOf=element=>{
      const tid=getTid(element)??'';
      if(!ownedGraph(element))return null;
      const body=tid.slice(graphPrefix.length),parts=body.split(';'),label=parts[0];
      if(!graphLabels.has(label) || graphElements.filter(e=>getTid(e)===graphPrefix+label).length!==1)return null;
      const part=parts.length===1?'body':parts.slice(1).join(';')==='Label;Label'?'label':parts.length===2 && parts[1]==='Setting'?'settings':null;
      return part?{node_label:label,part,...(part==='label'?{label_text:textOf(element,false,'')}: {})}:null;
    };
    const priority = { graph_editor: 0, dialog: 1, graph: 2, workflow: 3, global: 4 };
    const controlPriority = element => {
      const tid=getTid(element)??'',base=workflow?.prefix+';WizrdMCF;';
      if(/^mn;mni[^;]+$/.test(tid) || element.getAttribute('role')==='menuitem')return -30;
      if(comboPart(element)?.kind==='option')return -25;
      if(comboPart(element)?.kind==='picker' && comboPart(element).field.scope==='import_column')return -24;
      if(dialogRef(element))return -20;
      // Keep lifecycle and selected-expression controls on the first compact
      // page, ahead of Calculator operator palettes and rendered preview cells.
      // Import types are needed before advancing: metadata cell_refs are not
      // issued controls. Deliver type cells first instead of burying them behind
      // all format inputs and preview controls on later compact pages.
      if(importColumnCellRefs.has(state.ids.get(element)))return /_2$/.test(tid)?-12:-11;
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
      const openWizard=wizard.status==='absent' && navigationContext.status==='observed' && graphNodeOf(element)?.part==='settings'
        ? {node:graphNodeOf(element),workflow_path:navigationContext.path}:null;
      const finishWizard=tid===wizard.root_tid+';btnDone' && wizard.stage==='done' && wizard.completion?.ready && wizard.owner_context?.status==='observed'
        ? {root_ref:wizard.root_ref,owner:wizard.owner_context,completion:wizard.completion}:null;
      const reformColumn=wizard.stage==='field_parameters',column=reformColumn?wizard.reform_parameters:wizard.column_parameters;
      const columnReady=column?.status==='observed' && column.selected_column?.data_kind && column.selected_column?.usage
        && (!reformColumn || column.selected_column.caching && typeof column.selected_column.excluded==='boolean')
        && Object.values(column.fields??{}).length===(reformColumn?7:5) && Object.values(column.fields).every(f=>f.status==='observed' && !f.truncated);
      const columnForm=reformColumn?'EditReformColumnDefForm':'EditColumnDefForm';
      const columnClose=columnReady && [wizard.root_tid+';'+columnForm+';btnApply',wizard.root_tid+';'+columnForm+';btnCancel'].includes(tid)
        ? {scope:reformColumn?'reform':'output',mode:tid.endsWith(';btnApply')?'apply':'cancel',root_ref:column.root_ref,wizard_root_ref:wizard.root_ref,original_row:column.selected_column}:null;
      const params=wizard.expression_parameters;
      const expressionParametersReady=params?.status==='observed' && wizard.expression_selection?.status==='observed' && params.selected_expression
        && Object.values(params.fields??{}).length===3 && Object.values(params.fields).every(f=>f.status==='observed' && !f.truncated);
      const expressionApply=tid===wizard.root_tid+';ExprDataEditForm;btnApply' && expressionParametersReady
        ? {root_ref:params.root_ref,wizard_root_ref:wizard.root_ref,selected_expression:params.selected_expression}:null;
      const expressionCancel=tid===wizard.root_tid+';ExprDataEditForm;btnCancel' && expressionParametersReady
        ? {root_ref:params.root_ref,wizard_root_ref:wizard.root_ref,selected_expression:params.selected_expression,original_row:wizard.expression_selection}:null;
      const expressionWritable=identity && isEnabled && calculatorEditor?.status==='observed' && calculatorEditor.mode==='expression'
        && calculatorEditor.selected_expression && calculatorEditor.document.full_text_verified && calculatorEditor.document.writable;
      const fullValue = editable && !sensitive(element) ? String(element.value ?? (element.isContentEditable ? element.textContent : '') ?? '') : undefined;
      const value = fullValue?.slice(0, 2048), valueTruncated = fullValue !== undefined && fullValue.length > 2048;
      const fieldValue = value === undefined ? {} : {value, value_truncated:valueTruncated, value_length_utf16:fullValue.length};
      // E2E filestorage: click selects a row; doubleClick opens the folder.
      // Read the type from the same row, never infer it from a filename.
      const storageRow=/^MF;TF(?:-\d+)?;FileStorageForm;colName_.+$/.test(tid ?? '') ? element.closest('.x-grid-item') : null;
      const storageTypes=storageRow ? (tids.get(tid.replace(';colName_',';colFileType_')) ?? []).filter(other=>{charge();return storageRow.contains(other)
        && visible(other) && !sensitive(other);}) : [];
      const storageEntry=storageRow ? {row_ref:refOf(storageRow),selected:storageRow.classList.contains('x-grid-item-selected'),
        kind:storageTypes.length===1 && textOf(storageTypes[0])==='Папка' ? 'folder':'unknown'} : null;
      return { ref: refOf(element), tid, identity, kind, role, label:label || (combo?.kind==='picker' && combo.field.scope==='import_column'
        ? 'Открыть список: '+(combo.field.name==='type'?'Тип данных':'Вид данных'):''), scope: scopeOf(element), ...fieldValue,
        ...(storageEntry ? {storage_entry:storageEntry} : {}),
        ...(graphNodeOf(element) ? {graph_node:graphNodeOf(element)} : {}),
        ...(scroll ? { scroll } : {}),
        ...(checkState ? {check_state:checkState} : {}),
        ...(calculatorEditor ? {calculator_editor:calculatorEditor} : {}),
        ...(combo ? {wizard_combo:combo} : {}),
        ...(wizardStep ? {wizard_step:wizardStep} : {}),
        ...(openWizard ? {wizard_open:openWizard} : {}),
        ...(finishWizard ? {wizard_finish:finishWizard} : {}),
        ...(columnClose ? {column_close:columnClose} : {}),
        ...(expressionApply ? {expression_apply:expressionApply} : {}),
        ...(expressionCancel ? {expression_cancel:expressionCancel} : {}),
        ...(wizardFields.has(element) ? {wizard_field:wizardFields.get(element)} : {}),
        signature: { tag, tid, role, type: element.getAttribute('type'), name: element.getAttribute('name'), label, ...fieldValue, dialog_ref: dialogRef(element), scroll, check_state:checkState },
        enabled: isEnabled, visible: true, interaction, bounding_box: boxOf(element),
        // A bounded prefix is not a sufficient value precondition. A dedicated
        // large-field driver must establish its own complete read/write contract.
        allowed_actions: expressionWritable ? ['replace_expression'] : allowed && !valueTruncated ? ['click', 'double_click', 'right_click', 'press', 'drag', ...(editable ? ['fill',...(wizardFields.has(element)?['set_wizard_field']:[])] : []), ...(checkState ? ['set_checked'] : []), ...(wizardStep?['wizard_step']:[]), ...(openWizard?['open_wizard']:[]), ...(finishWizard?['finish_wizard']:[]), ...(columnClose?[columnClose.mode+'_'+columnClose.scope+'_column']:[]), ...(expressionApply?['apply_expression_parameters']:[]), ...(expressionCancel?['cancel_expression_parameters']:[]), ...(combo?.kind==='option'?['select_wizard_option']:[]), ...(scroll && interaction.state === 'point_observed' ? ['scroll'] : [])] : [] };
    });
    const nodes = labels.slice(0, 200).map(label => {
      const nodeTid = graphPrefix + label, matches=graphElements.filter(e=>getTid(e)===nodeTid),node=matches.length===1?matches[0]:null;
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
      workflow_ref: workflow, graph_identity:graphIdentity, active_tab_ref:active?refOf(active):null, active_identity: active ? textOf(active) : null, package_identity: packageIdentity,
      file_storage:fileStorage,wizard,navigation_context:navigationContext,
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
  },{rootRef:rediscover ? null : postActionRoot ?? task.root_ref ?? task.snapshot?.observation_root?.ref ?? null,discoverRoots:rediscover || task.discover_roots===true,storageName:task.storage_name ?? null});
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
      || task.action.verb==='cancel_expression_parameters' && !same(before.expression_cancel,current.expression_cancel)
      || task.action.verb==='apply_expression_parameters' && !same(before.expression_apply,current.expression_apply)
      || ['apply_output_column','cancel_output_column','apply_reform_column','cancel_reform_column'].includes(task.action.verb) && !same(before.column_close,current.column_close)
      || task.action.verb==='finish_wizard' && !same(before.wizard_finish,current.wizard_finish)
      || task.action.verb==='open_wizard' && !same(before.wizard_open,current.wizard_open)
      || task.action.verb==='wizard_step' && !same(before.wizard_step,current.wizard_step)
      || task.action.verb==='select_wizard_option' && !same(before.wizard_combo,current.wizard_combo)) fail('UI_REFERENCE_STALE', 'The observed control changed; observe the workspace again');
    const locator = locatorFor(current.identity);
    if (await locator.count() !== 1) fail('UI_REFERENCE_STALE', 'Observed control is no longer unique');
    const handle = await locator.elementHandle({ timeout: timeout() });
    if (!handle) fail('UI_REFERENCE_STALE', 'Observed control is detached');
    handles.push(handle);
    const graphPrefix = task.snapshot.graph_identity?.status==='observed'?task.snapshot.graph_identity.native_prefix:null;
    const graphBody = graphPrefix && current.scope==='graph' && current.tid?.startsWith(graphPrefix) ? current.tid.slice(graphPrefix.length) : null;
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
        if(['set_wizard_field','wizard_step','select_wizard_option','apply_expression_parameters','cancel_expression_parameters','open_wizard','finish_wizard','apply_output_column','cancel_output_column','apply_reform_column','cancel_reform_column'].includes(task.action.verb) && (!same(task.snapshot.wizard,current.wizard)
          || !same(task.snapshot.active_identity,current.active_identity) || !same(task.snapshot.package_identity,current.package_identity)))
          fail('WIZARD_CONTEXT_CHANGED','Wizard settings or package changed; observe again');
        const refs = task.action.verb === 'drag' ? [task.action.source_ref, task.action.target_ref] : [task.action.ref];
        if(refs.some(ref=>current.ui.elements.some(e=>e.ref===ref && ['graph','graph_editor'].includes(e.scope)))
          && !same(task.snapshot.graph_identity,current.graph_identity))fail('UI_CONTEXT_CHANGED','The graph container or native namespace changed; observe again');
        if (current.ui.masks.length) {
          const foreground = current.ui.dialogs.reduce((top, dialog) => !top || dialog.z_index >= top.z_index ? dialog : top, null);
          const targetsForeground = foreground && refs.every(ref => {
            const element=current.ui.elements.find(element=>element.ref===ref);
            return element?.signature.dialog_ref===foreground.ref || task.action.verb==='select_wizard_option'
              && element?.wizard_combo?.kind==='option' && ['expression_parameter','output_column','reform_column'].includes(element.wizard_combo.field.scope)
              && element.wizard_combo.field.parameter_root_ref===foreground.ref;
          });
          const dialogBlocked = !foreground || current.ui.masks.some(mask => mask.dialog_ref === foreground.ref || mask.kind !== 'modal_background');
          // A modal confirmation intentionally masks the workspace behind it.
          // Only its own controls or a bound parameter option can proceed; the hit point is
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
        if (task.action.verb === 'click' || ['wizard_step','select_wizard_option','apply_expression_parameters','cancel_expression_parameters','open_wizard','finish_wizard','apply_output_column','cancel_output_column','apply_reform_column','cancel_reform_column'].includes(task.action.verb)) await clickTarget(1);
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
            if(['expression_parameter','output_column','import_format'].includes(before.wizard_field.scope)) {
              if(!await first.evaluate(element=>document.activeElement===element))fail('WIZARD_FIELD_CHANGED','Wizard field lost focus before edit completion');
              // Loginom updates a linked display label on input completion.
              // Commit the draft input before reading coupled parameter values.
              await first.press('Tab',{timeout:timeout()});
            }
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
        if(['apply_expression_parameters','cancel_expression_parameters','select_wizard_option','apply_output_column','cancel_output_column','apply_reform_column','cancel_reform_column'].includes(task.action.verb))postActionRoot=current.wizard.root_ref;
        const readOpeningUi=async()=>{
          const roots=await readUi(true);
          postActionRoot=roots.wizard?.root_ref ?? roots.ui.elements.find(e=>e.tid===current.workflow_ref.prefix+';ModelForm;cmpDiagram')?.ref ?? roots.ui.elements.find(e=>e.scope==='dialog')?.ref ?? roots.ui.elements[0]?.ref;
          if(!postActionRoot)fail('WIZARD_OPEN_NOT_CONFIRMED','No current region was available after opening settings');
          return readUi();
        };
        let observed;
        try { observed = await (['open_wizard','finish_wizard'].includes(task.action.verb)?readOpeningUi():readUi()); }
        catch(error) {
          // A generic click can legitimately close its popup/tree. Rediscover
          // regions only after the completed gesture, never for preconditions
          // or typed value/stage verification. This proves no navigation goal.
          if(error?.code!=='UI_ROOT_STALE' || !effectPossible || !['click','double_click','right_click','press'].includes(task.action.verb))throw error;
          observed=await readUi(true);
          record('ui_root_closed_after_gesture',{verification_required:true});
        }
        if(task.action.verb==='finish_wizard') {
          const finish=current.ui.elements.find(e=>e.ref===task.action.ref).wizard_finish;
          const contextMatches=fresh=>fresh.authenticated && fresh.origin===current.origin && fresh.loginom_build===current.loginom_build
            && same(fresh.workflow_ref,current.workflow_ref) && same(fresh.package_identity,current.package_identity)
            && fresh.active_tab_ref===current.active_tab_ref && !!current.active_tab_ref && fresh.ui.dialogs.length===0;
          const targetNode=fresh=>{
            const labels=fresh.ui.elements.filter(e=>e.graph_node?.part==='label' && e.graph_node.label_text===finish.completion.fields.label.value);
            if(labels.length!==1)return null;
            return fresh.ui.elements.find(e=>e.graph_node?.part==='body' && e.graph_node.node_label===labels[0].graph_node.node_label)??null;
          };
          for(let attempt=0;attempt<24 && contextMatches(observed) && (observed.wizard.status!=='absent' || observed.ui.masks.length || !targetNode(observed));attempt++) {
            timeout();await page.waitForTimeout(Math.min(200,timeout()));observed=await readOpeningUi();
          }
          const node=targetNode(observed);
          if(!contextMatches(observed) || observed.ui.masks.length || observed.wizard.status!=='absent' || !node
            || observed.navigation_context?.status!=='observed'
            || !same(observed.navigation_context.path,finish.owner.path.slice(0,-2).map(({tid,label})=>({tid,label}))))
            fail('WIZARD_FINISH_NOT_CONFIRMED','The expected node and workflow were not confirmed after one Done click; inspect before retry');
          record('wizard_finish_graph_verified',{previous_owner:finish.owner.node,node:node.graph_node,node_ref:node.ref,
            label:finish.completion.fields.label.value,reopen_required:true,settings_readback_verified:false,package_saved:false});
        }
        if(task.action.verb==='open_wizard') {
          const opening=current.ui.elements.find(e=>e.ref===task.action.ref).wizard_open;
          const contextMatches=fresh=>fresh.authenticated && fresh.origin===current.origin && fresh.loginom_build===current.loginom_build
            && same(fresh.workflow_ref,current.workflow_ref) && same(fresh.package_identity,current.package_identity)
            && fresh.active_tab_ref===current.active_tab_ref && !!current.active_tab_ref && fresh.ui.dialogs.length===0;
          for(let attempt=0;attempt<24 && contextMatches(observed) && (observed.wizard?.owner_context?.status!=='observed' || observed.ui.masks.length);attempt++) {
            timeout();await page.waitForTimeout(Math.min(200,timeout()));observed=await readOpeningUi();
          }
          const owner=observed.wizard?.owner_context;
          // Graph and breadcrumb tids share the native formatted key; display
          // labels retain commas/spaces and may wrap differently on the canvas.
          if(!contextMatches(observed) || observed.ui.masks.length || observed.wizard?.status!=='observed'
            || owner?.status!=='observed' || owner.node.tid!==opening.workflow_path.at(-1)?.tid+'>'+opening.node.node_label
            || !same(owner.path.slice(0,-2).map(({tid,label})=>({tid,label})),opening.workflow_path))
            fail('WIZARD_OPEN_NOT_CONFIRMED','The intended node wizard was not confirmed after one click; inspect the current view before retry');
          record('wizard_open_verified',{node:opening.node,workflow_path:opening.workflow_path,wizard_root_ref:observed.wizard.root_ref,
            owner_node:owner.node,settings_applied:false});
        }
        if(['apply_output_column','cancel_output_column','apply_reform_column','cancel_reform_column'].includes(task.action.verb)) {
          const reform=task.action.verb.endsWith('_reform_column'),cancel=task.action.verb.startsWith('cancel_');
          const paramsKey=reform?'reform_parameters':'column_parameters',rowsKey=reform?'reform_columns':'output_columns';
          const params=current.wizard[paramsKey],fields=params.fields;
          const types={'Целый':'integer','Вещественный':'real','Строковый':'string','Логический':'boolean','Дата/Время':'datetime','Переменный':'variant'};
          const wanted=cancel?params.selected_column:{name:fields.name.value,label:fields.label.value,type:types[fields.type_label.value],data_kind:fields.data_kind.value,usage:fields.usage.value,...(reform?{caching:fields.caching.value,excluded:fields.excluded.value}:{})};
          const sameContext=fresh=>fresh.authenticated && fresh.origin===current.origin && fresh.loginom_build===current.loginom_build
            && same(fresh.workflow_ref,current.workflow_ref) && same(fresh.package_identity,current.package_identity)
            && fresh.active_tab_ref===current.active_tab_ref && fresh.wizard.root_ref===current.wizard.root_ref && fresh.wizard.stage===(reform?'field_parameters':'output_mapping')
            && same(fresh.wizard.owner_context,current.wizard.owner_context)
            && same(fresh.wizard.port_context,current.wizard.port_context);
          const matches=fresh=>(fresh.wizard[rowsKey]?.fields??[]).filter(row=>row.status==='observed' && row.selected
            && ['name','label','type','data_kind','usage'].every(k=>wanted[k] && row[k]===wanted[k])
            && (!reform || row.caching===wanted.caching && row.excluded===wanted.excluded)
            && (!cancel || row.row_ref===wanted.row_ref));
          const closed=fresh=>!fresh.wizard[paramsKey] && !fresh.ui.dialogs.some(d=>d.ref===params.root_ref);
          for(let attempt=0;attempt<12 && sameContext(observed) && (!closed(observed) || observed.ui.masks.length || matches(observed).length!==1);attempt++) {
            timeout();await page.waitForTimeout(Math.min(100,timeout()));observed=await readUi();
          }
          if(!sameContext(observed) || !closed(observed) || observed.ui.masks.length || observed.ui.dialogs.length || matches(observed).length!==1)
            fail('OUTPUT_COLUMN_NOT_CONFIRMED','The selected output row was not confirmed after closing its editor; inspect before retry');
          record(reform?'reform_column_row_verified':'output_column_row_verified',{mode:cancel?'cancel':'apply',row:matches(observed)[0],node_saved:false,port_saved:false,package_saved:false});
        }
        if(['apply_expression_parameters','cancel_expression_parameters'].includes(task.action.verb)) {
          const cancelling=task.action.verb==='cancel_expression_parameters';
          const desired=cancelling?Object.fromEntries(['name','label','type_label'].map(k=>[k,{value:current.wizard.expression_selection[k]}])):current.wizard.expression_parameters.fields;
          const contextChecks=fresh=>({authenticated:fresh.authenticated,origin:fresh.origin===current.origin,build:fresh.loginom_build===current.loginom_build,
            workflow:same(fresh.workflow_ref,current.workflow_ref),package:same(fresh.package_identity,current.package_identity),
            active:same(fresh.active_identity,current.active_identity),wizard:fresh.wizard.root_ref===current.wizard.root_ref,stage:fresh.wizard.stage==='calculator'});
          const sameContext=fresh=>Object.values(contextChecks(fresh)).every(Boolean);
          const closed=fresh=>!fresh.wizard.expression_parameters && !fresh.ui.dialogs.some(d=>d.ref===current.wizard.expression_parameters.root_ref);
          const rowMatches=fresh=>{const row=fresh.wizard.expression_selection;return row?.status==='observed' && row.name===desired.name.value && row.label===desired.label.value && row.type_label===desired.type_label.value && (!cancelling || row.row_ref===current.wizard.expression_selection.row_ref);};
          for(let attempt=0;attempt<12 && sameContext(observed) && (!closed(observed) || !rowMatches(observed) || observed.ui.masks.length);attempt++) {
            await page.waitForTimeout(Math.min(100,timeout()));observed=await readUi();
          }
          const row=observed.wizard.expression_selection;
          record('expression_apply_checks',{mode:cancelling?'cancel':'apply',...contextChecks(observed),dialog_closed:closed(observed),no_masks:observed.ui.masks.length===0,no_dialogs:observed.ui.dialogs.length===0,row_matches:rowMatches(observed)});
          if(!sameContext(observed) || !closed(observed) || observed.ui.masks.length || observed.ui.dialogs.length
            || !rowMatches(observed))
            fail(cancelling?'EXPRESSION_CANCEL_NOT_CONFIRMED':'EXPRESSION_PARAMETERS_NOT_CONFIRMED','Expression row did not confirm name, label and type after closing parameters; inspect before retry');
          record(cancelling?'expression_parameters_cancel_verified':'expression_parameters_row_verified',{name:row.name,label:row.label,type_label:row.type_label,node_settings_applied:false,package_saved:false});
        }
        if(task.action.verb==='select_wizard_option') {
          const choice=current.ui.elements.find(item=>item.ref===task.action.ref).wizard_combo;
          if(choice.field.scope==='import_column') {
            const editor=current.wizard.import_column_editor;
            const desired=editor.property==='type'?({'Целый':'integer','Вещественный':'real','Строковый':'string','Логический':'boolean','Дата/Время':'datetime','Переменный':'variant'})[choice.label]:choice.label;
            const sameContext=fresh=>fresh.authenticated && fresh.origin===current.origin && fresh.loginom_build===current.loginom_build
              && same(fresh.workflow_ref,current.workflow_ref) && same(fresh.package_identity,current.package_identity)
              && same(fresh.active_identity,current.active_identity) && fresh.active_tab_ref===current.active_tab_ref
              && fresh.dom_epoch.document===current.dom_epoch.document && fresh.wizard.status==='observed'
              && fresh.wizard.root_ref===current.wizard.root_ref && fresh.wizard.stage===current.wizard.stage
              && same(fresh.wizard.owner_context,current.wizard.owner_context) && same(fresh.ui.dialogs,current.ui.dialogs)
              && same(fresh.wizard.settings,current.wizard.settings);
            let stable=0,previous=null,column;
            for(let attempt=0;attempt<40 && sameContext(observed);attempt++) {
              column=observed.wizard.import_columns?.fields?.find(e=>e.index===editor.index);
              const ready=!observed.wizard.import_column_editor && !observed.ui.masks.length
                && column?.status==='observed' && column.name===editor.name && column.label===editor.label
                && column.used===editor.used && column.header_ref===editor.header_ref && same(column.cell_refs,editor.cell_refs) && column[editor.property]===desired
                && ['Неопределенное','Непрерывный','Дискретный'].includes(column.data_kind)
                && (editor.property==='type' || column.type===editor.other_value);
              const stamp={epoch:observed.dom_epoch,wizard:observed.wizard};
              stable=ready && previous && same(stamp,previous)?stable+1:0;
              if(stable>=5)break;
              previous=ready?stamp:null;
              timeout();await page.waitForTimeout(Math.min(100,timeout()));observed=await readUi();
            }
            if(stable<5)fail('WIZARD_OPTION_NOT_CONFIRMED','Import column did not settle after the editor closed; inspect before retry');
            record('import_column_option_verified',{index:column.index,name:column.name,property:editor.property,
              type:column.type,data_kind:column.data_kind,settings_applied:false});
          } else {
          const parameterKey=choice.field.scope==='expression_parameter'?'expression_parameters':choice.field.scope==='output_column'?'column_parameters':choice.field.scope==='reform_column'?'reform_parameters':null;
          const expressionParameter=parameterKey!==null;
          const field=observed.wizard[parameterKey??'settings']?.fields?.[choice.field.name];
          const expected=JSON.parse(JSON.stringify(current.wizard));
          if(expressionParameter)expected[parameterKey].fields[choice.field.name].value=choice.label;
          if(expressionParameter)expected[parameterKey].fields[choice.field.name].value_length_utf16=choice.label.length;
          if(!observed.authenticated || observed.origin!==current.origin || observed.loginom_build!==current.loginom_build
            || !same(observed.workflow_ref,current.workflow_ref) || !same(observed.package_identity,current.package_identity)
            || !same(observed.active_identity,current.active_identity) || observed.wizard.root_ref!==choice.field.root_ref
            || observed.wizard.stage!==current.wizard.stage || !same(observed.ui.dialogs,current.ui.dialogs)
            || (expressionParameter?!same(observed.ui.masks,current.ui.masks):observed.ui.masks.length>0)
            || expressionParameter && !same(observed.wizard,expected)
            || field?.status!=='observed' || field.truncated || field.value!==choice.label
            || field.input_ref!==choice.field.input_ref || field.owner_ref!==choice.field.owner_ref)
            fail('WIZARD_OPTION_NOT_CONFIRMED','The selected option label was not read back in its original wizard field; inspect before retry');
          record('wizard_option_verified',{field:choice.field.name,label:choice.label,settings_applied:false});
          }
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
          if(before.wizard_field.scope==='import_format' && before.value!==task.action.text) {
            // Blur applies import format and can asynchronously rebuild preview.
            // Observe only: never type again while that refresh is pending.
            const contextMatches=fresh=>fresh.authenticated && fresh.origin===current.origin && fresh.loginom_build===current.loginom_build
              && same(fresh.workflow_ref,current.workflow_ref) && same(fresh.package_identity,current.package_identity)
              && fresh.active_tab_ref===current.active_tab_ref && fresh.wizard.root_ref===current.wizard.root_ref
              && fresh.wizard.stage===current.wizard.stage && same(fresh.wizard.owner_context,current.wizard.owner_context)
              && same(fresh.ui.dialogs,current.ui.dialogs);
            let stable=0,previous=null;
            for(let attempt=0;attempt<40 && contextMatches(observed);attempt++) {
              const field=observed.ui.elements.find(e=>e.ref===before.ref);
              const ready=observed.ui.masks.length===0 && field?.interaction?.state==='point_observed'
                && field.enabled && field.value===task.action.text;
              const stamp={epoch:observed.dom_epoch,wizard:observed.wizard};
              stable=ready && previous && same(stamp,previous)?stable+1:0;
              if(stable>=2)break;
              previous=ready?stamp:null;
              timeout();await page.waitForTimeout(Math.min(100,timeout()));observed=await readUi();
            }
            if(stable<2)fail('WIZARD_FIELD_NOT_CONFIRMED','Import preview did not settle in the original wizard after input completion');
            record('import_format_input_settled',{ref:before.ref,settings_applied:false});
          }
          const after=observed.ui.elements.find(item=>item.ref===before.ref);
          const expected=JSON.parse(JSON.stringify(current.wizard));
          const expressionParameter=before.wizard_field.scope==='expression_parameter';
          // Format changes may recompute the derived column definitions.
          // Their new values are exposed for separate verification, not admitted
          // as the requested schema by a successful format-field edit.
          if(before.wizard_field.scope==='import_format')expected.import_columns=observed.wizard.import_columns;
          const fields=expressionParameter?expected.expression_parameters.fields:before.wizard_field.scope==='output_column'?expected.column_parameters.fields:expected.settings.fields;
          // Native name editing can update a still-linked display label. Accept
          // only the original label or this exact name, and expose the readback.
          if(expressionParameter && before.wizard_field.name==='name' && fields.label.value===fields.name.value
            && observed.wizard.expression_parameters?.fields?.label?.value===task.action.text)
            Object.assign(fields.label,{value:task.action.text,value_length_utf16:task.action.text.length,truncated:false});
          Object.assign(fields[before.wizard_field.name],{value:task.action.text,value_length_utf16:task.action.text.length,truncated:false});
          if(!observed.authenticated || observed.origin!==current.origin || observed.loginom_build!==current.loginom_build
            || !same(observed.workflow_ref,current.workflow_ref) || !same(observed.package_identity,current.package_identity)
            || !same(observed.active_identity,current.active_identity) || !same(observed.wizard,expected)
            || !same(observed.ui.dialogs,current.ui.dialogs) || !same(observed.ui.masks,current.ui.masks)
            || !after || !same(after.identity,before.identity) || !same(after.wizard_field,before.wizard_field)
            || after.value_truncated || after.value!==task.action.text)
            fail('WIZARD_FIELD_NOT_CONFIRMED','The draft value was not confirmed in the same wizard field; inspect before retry');
          record('wizard_draft_value_verified',{ref:after.ref,field:after.wizard_field.name,scope:after.wizard_field.scope??'import_format',settings_applied:false});
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
