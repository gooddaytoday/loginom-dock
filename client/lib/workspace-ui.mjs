// The model receives opaque observed references, never executable selectors or
// browser code. All browser-side inspection and gestures below are client-pinned.
export const uiActionSchema = {
  type: 'object', additionalProperties: false, required: ['verb'],
  properties: {
    verb: { type: 'string', enum: ['click', 'double_click', 'right_click', 'fill', 'press', 'drag', 'scroll', 'set_checked', 'replace_expression', 'set_wizard_field', 'wizard_step', 'select_wizard_option', 'apply_expression_parameters', 'cancel_expression_parameters', 'open_wizard', 'finish_wizard', 'apply_output_column', 'cancel_output_column', 'apply_reform_column', 'cancel_reform_column'] },
    expected_stage: { type: 'string', enum: ['text_import_file','text_import_format','input_mapping','output_mapping','calculator','grouping','field_parameters','done'],
      description: 'Required only for wizard_step: destination after the observed next/previous control, not the current stage. For delimited Text Import, next follows text_import_file → text_import_format → output_mapping → done; previous reverses this order. input_mapping means a separate INPUT PORT mapping wizard, never Text Import output columns. Other wizard families may have different paths; inspect their current UI and sources instead of guessing. Do not pass this field to open_wizard or finish_wizard.' },
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
    const regionSelector='[data-tid="mnContextData"],[data-tid="ConsoleForm"],[data-tid$=";FileStorageForm;pnlFileStorage;tbl"],[data-tid$=";PreviewForm;DataSetForm"],[data-tid$=";ViewsForm;BrowseView"],[data-tid="MF;cntMain;tlbMainToolbar"],[data-tid="MF;cntMain;cntWorkspace;Workspace;t.br"],[role="dialog"],.x-window,.bg-dialog,[role="grid"],table,[role="form"],[data-tid$=";WizrdMCF"],[data-tid$=";boundlist"],[data-tid$=";MapTreeForm;tree"],[data-tid$=";cmpDiagram"],[data-tid$=";pnlWorkarea"],[data-tid$="NavigationBar;NavigationPanel"]';
    // E2E utils/selectors.Format: whitespace -> underscore, comma removed.
    // This finds candidates, not filesystem identity or absence. CSS hex escapes
    // keep arbitrary filename characters data rather than selector syntax.
    const storageSuffix=storageName===null ? null : ';FileStorageForm;colName_'+storageName.replace(/\s/g,'_').replace(/,/g,'');
    const storageSelector=storageSuffix===null ? null : '[data-tid$="'+Array.from(storageSuffix,char=>'\\'+char.codePointAt(0).toString(16)+' ').join('')+'"]';
    // Indexed Table roots use the same E2E IdSuffix convention as the first
    // view. The candidate selector also finds descendants: admit only exact
    // numeric root identities, charging every candidate against the budget.
    const indexedViews=discoverRoots && storageSelector===null
      ? [...document.querySelectorAll('[data-tid*=";ViewsForm;BrowseView-"]')].filter(element=>{
        charge();return /^MF;TF(?:-\d+)?;ViewsForm;BrowseView-[1-9][0-9]*$/.test(element.getAttribute('data-tid')??'');
      }):[];
    const processMenuCandidates=discoverRoots?document.querySelectorAll('[data-tid="mnContextMenu"]'):[];charge();
    const processMenuRegions=processMenuCandidates.length===1
      && processMenuCandidates[0].querySelectorAll('[data-tid="mnContextMenu;mniShowNodeToProcess"]').length===1
      && processMenuCandidates[0].querySelectorAll('[data-tid="mnContextMenu;mniShowCompletedProcesses"]').length===1
      ? [processMenuCandidates[0]]:[];charge();
    const regionElements=discoverRoots ? [...new Set([...document.querySelectorAll(storageSelector ?? regionSelector),...indexedViews,...(storageSelector===null?processMenuRegions:[])])] : [];
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
      input_mapping:[';TuneDataSourceInputPortWizard;btnAddMappingColumn',';TuneDataSourceMappingWizard;btnAddMappingColumn'],
      output_mapping:[';ColumnsMappingEngineOutputPortWizard;btnAddMappingColumn',';DerivedDataSourceOutputSocketWizard;btnAddMappingColumn',';DerivedDataSourceMappingEngineOutputPortWizard;btnAddMappingColumn'],
      calculator:';CalcDataWizard;btnAddExpr',grouping:';GroupDataWizard;grdUsedFields;tbl',
      field_parameters:';ReformColumnsWizard;grdTargetColumns;tbl',done:';DoneWizard;edtDisplayName'};
    const wizardButtons=['btnPrev','btnNext','btnDone','btnExecute','btnClose','btnError'];
    // Breadcrumb labels are fixed global context even for a narrow file row;
    // including buttons without their labels loses the observed directory.
    const wizardSelectors=['[data-tid$=";ModelForm;cmpDiagram"]','[data-tid$=";NavigationBar;NavigationPanel"]','[data-tid*=";cnrNaviMode;b.s_"]','[data-tid*=";cnrNaviMode;b.s"] .x-btn-inner-default-toolbar-small','[data-tid$=";WizrdMCF"]','[data-tid$=";WizrdMCF;cardWizardPanel;p.h;p.t"]',
      ...Object.values(wizardMarkers).flat().map(suffix=>'[data-tid$=";WizrdMCF'+suffix+'"]'),
      '[data-tid*=";WizrdMCF;CalcDataWizard;colExpressionName_"]','[data-tid*=";WizrdMCF;CalcDataWizard;colExpressionDisplayName_"]','[data-tid$=";WizrdMCF;CalcDataWizard;cmpExpression"]','[data-tid$=";WizrdMCF;CalcDataWizard;btnCalcMode"]','[data-tid$=";WizrdMCF;CalcDataWizard;btnReplaceField"]','span.bg-TBGCalcMode-cmExpression,span.bg-TBGCalcMode-cmJavaScript',
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
      '[data-tid$=";WizrdMCF;EditReformColumnDefForm"]','[data-tid="EditReformColumnDefForm"]',
      ...['edtName','edtDisplayName','cbxDataType','cbxDataKind','cbxUsageType','cntMain;cbxCachingMethod','cntMain;chbExcluded','cntMain;chbExcluded;DisplayEl'].flatMap(name=>{const owner='[data-tid="EditReformColumnDefForm;'+name+'"]';return [owner,owner+' input'];}),
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
      ...['chbIntermediate','chbCached'].flatMap(name=>['',';InputEl',';DisplayEl'].map(part=>'[data-tid$=";WizrdMCF;ExprDataEditForm;'+name+part+'"]')),
      ...wizardButtons.map(name=>'[data-tid$=";WizrdMCF;'+name+'"]')].join(',');
    if (requestedRoot || discoverRoots) {
      // Native fixed queries discover global blockers/context without walking
      // every unrelated subtree in JavaScript. Their synchronous browser cost
      // cannot be preempted; charge immediately after each native operation.
      const guards=document.querySelectorAll(wizardSelectors+',[data-tid="MF;cntMain;tlbMainToolbar;btnAvatar"],.x-tab-active[data-tid],[role="dialog"],.x-window,.bg-dialog,.bg-mask-message,.x-mask-msg,[role="alert"],[role="status"],.bg-message,.x-message-box,.x-form-invalid-under,[data-tid$="FileStorageForm;pnlFileStorage;tbl"]');
      charge();for (const element of guards) include(element);
      // Ext renders Table modals in a portal outside the owning BrowseView.
      // Include exact view roots as global identity guards, never their trees.
      const tableOwners=document.querySelectorAll('[data-tid$=";ViewsForm;BrowseView"],[data-tid*=";ViewsForm;BrowseView-"]');
      charge();for (const element of tableOwners) {
        charge();if(/^MF;TF(?:-\d+)?;ViewsForm;BrowseView(?:-[1-9][0-9]*)?$/.test(element.getAttribute('data-tid')??''))include(element);
      }
    }
    // The exact process context menu is a portal. Read its owning console
    // through the same bounded DOM scanner, never another workflow subtree.
    if(requestedRoot?.getAttribute('data-tid')==='mnContextMenu'
      && requestedRoot.querySelectorAll('[data-tid="mnContextMenu;mniShowNodeToProcess"]').length===1
      && requestedRoot.querySelectorAll('[data-tid="mnContextMenu;mniShowCompletedProcesses"]').length===1) {
      const panels=document.querySelectorAll('[data-tid="ConsoleForm"]');charge();
      if(panels.length===1) {include(panels[0]);const descendants=panels[0].querySelectorAll('*');charge();
        for(const element of descendants)include(element);}
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
    const enabled = element => !element.matches(':disabled') && !element.closest('[aria-disabled="true"],.x-item-disabled,.x-btn-disabled,.x-menu-item-disabled');
    const dangerous = element => sensitive(element) || !!element.closest('a[href],iframe,object,embed')
      // The native chooser interrupts MCP's typed browser response. File
      // submission belongs to dock_artifact_upload and its pinned grant.
      || !!element.closest('[data-tid$=";FileStorageForm;btnUpload"]')
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
    let nodeContext={status:'unobserved',opening_verified:false};
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
    // Node overview is distinct from workflow and port/wizard navigation.
    if(workflow && wizard.status==='absent') {
      const panelTid=workflow.prefix+';NavigationBar;NavigationPanel',panels=tids.get(panelTid)??[];
      const prefix=workflow.prefix+';cnrNaviMode;b.s_';
      const inside=(e,parent)=>{
        const r=boxOf(e),p=boxOf(parent),vw=globalThis.innerWidth,vh=globalThis.innerHeight;
        return visible(e)&&!sensitive(e)&&[r.x,r.y,r.width,r.height,p.x,p.y,p.width,p.height,vw,vh].every(Number.isFinite)
          &&r.x>=0&&r.y>=0&&r.x+r.width<=vw&&r.y+r.height<=vh
          &&r.x>=p.x&&r.y>=p.y&&r.x+r.width<=p.x+p.width&&r.y+r.height<=p.y+p.height;
      };
      if(panels.length>1)nodeContext.status='ambiguous';
      else if(panels.length===1&&inside(panels[0],panels[0])) {
        const panel=panels[0],crumbs=all.filter(e=>{charge();return panel.contains(e)&&/;cnrNaviMode;b\.s_/.test(getTid(e)??'');});
        if(crumbs.length>32)nodeContext.status='bounded';
        else if(crumbs.length===6&&crumbs.every(e=>inside(e,panel)&&(getTid(e)??'').startsWith(prefix))) {
          const items=crumbs.map(e=>({ref:refOf(e),tid:getTid(e),label:textOf(e,true)}));
          const unique=new Set(items.map(i=>i.tid)).size===items.length;
          const bounded=items.every(i=>i.tid.length<=2048&&i.label.length<240)&&items.reduce((n,i)=>n+i.tid.length+i.label.length,0)<=4096;
          const chain=items.every((i,n)=>i.tid.slice(prefix.length).split('>').length===n+1&&(!n||i.tid.startsWith(items[n-1].tid+'>')));
          const format=s=>s.replace(/\s/g,'_').replace(/,/g,'');
          const node=items[5];
          const exact=items[0].tid===prefix+'Сервер'&&items[1].label==='Пакеты'&&items.slice(2).every(i=>i.label)
            &&node.tid===items[4].tid+'>'+format(node.label);
          const icon=(e,selector)=>{const found=e.querySelectorAll(selector);charge();return found.length===1&&inside(found[0],e);};
          const icons=icon(crumbs[4],'.maptree-icon-workflow')&&icon(crumbs[5],'[class*="bg-vendor-icon-"]');
          if(!bounded)nodeContext.status='bounded';
          else if(!unique||!chain)nodeContext.status='ambiguous';
          else if(exact&&icons)nodeContext={status:'observed',kind:'node',opening_verified:false,panel_ref:refOf(panel),
            node:{ref:node.ref,tid:node.tid,label:node.label},path:items};
        }
      }
    }
    if(wizard.status==='observed' && wizard.stage==='input_mapping'
      && (tids.get(wizard.root_tid+';TuneDataSourceMappingWizard;btnAddMappingColumn')??[]).some(e=>wizardForms[0].contains(e)&&visible(e))) {
      const context={status:'unobserved',direction:'input',port_key:null,port_index:null,
        source_identity_verified:false,opening_verified:false};
      wizard.input_port_context=context;
      const panelTid=workflow.prefix+';NavigationBar;NavigationPanel',panels=tids.get(panelTid)??[];
      const prefix=workflow.prefix+';cnrNaviMode;b.s_';
      const inside=(e,parent)=>{
        const r=boxOf(e),p=boxOf(parent),vw=globalThis.innerWidth,vh=globalThis.innerHeight;
        return visible(e)&&!sensitive(e)&&[r.x,r.y,r.width,r.height,p.x,p.y,p.width,p.height,vw,vh].every(Number.isFinite)
          &&r.x>=0&&r.y>=0&&r.x+r.width<=vw&&r.y+r.height<=vh
          &&r.x>=p.x&&r.y>=p.y&&r.x+r.width<=p.x+p.width&&r.y+r.height<=p.y+p.height;
      };
      if(panels.length>1)context.status='ambiguous';
      else if(panels.length===1&&inside(panels[0],panels[0])) {
        const panel=panels[0],crumbs=all.filter(e=>{charge();return panel.contains(e)&&/;cnrNaviMode;b\.s_/.test(getTid(e)??'');});
        if(crumbs.length>32)context.status='bounded';
        else if(crumbs.length===9&&crumbs.every(e=>inside(e,panel)&&(getTid(e)??'').startsWith(prefix))) {
          const items=crumbs.map(e=>({ref:refOf(e),tid:getTid(e),label:textOf(e,true)}));
          const unique=new Set(items.map(i=>i.tid)).size===items.length;
          const bounded=items.every(i=>i.tid.length<=2048&&i.label.length<240)&&items.reduce((n,i)=>n+i.tid.length+i.label.length,0)<=4096;
          const chain=items.every((i,n)=>i.tid.slice(prefix.length).split('>').length===n+1&&(!n||i.tid.startsWith(items[n-1].tid+'>')));
          const format=s=>s.replace(/\s/g,'_').replace(/,/g,'');
          const node=items[5],folder=items[6],port=items[7],last=items[8];
          const exact=items[0].tid===prefix+'Сервер'&&items[1].label==='Пакеты'
            &&node.label&&folder.label==='Входные порты'&&port.label&&last.label==='Настройка'
            &&folder.tid===node.tid+'>Входные_порты'&&port.tid===folder.tid+'>'+format(port.label)
            &&last.tid===port.tid+'>Настройка';
          const iconCount=(e,selector)=>{const found=e.querySelectorAll(selector);charge();return found.length===1&&inside(found[0],e)?1:0;};
          const icons=iconCount(crumbs[4],'.maptree-icon-workflow')===1
            &&iconCount(crumbs[5],'[class*="bg-vendor-icon-"]')===1
            &&iconCount(crumbs[8],'.maptree-icon-wizard')===1;
          if(!bounded)context.status='bounded';
          else if(!unique||!chain)context.status='ambiguous';
          else if(exact&&icons)Object.assign(context,{status:'observed',panel_ref:refOf(panel),node:{ref:node.ref,tid:node.tid,label:node.label},
            node_path:items.slice(0,6),port_display_label:port.label,port_ref:port.ref,port_path:items.slice(0,8),path:items});
        }
      }
    }

    if(wizard.status==='observed' && wizard.stage==='grouping') {
      // E2E sGroupData and live GroupDataWizard: a flat sequence of TABLE
      // records carries section headers and explicit section-end summaries.
      // This is rendered configuration, never source identity or full coverage.
      const base=wizard.root_tid+';GroupDataWizard;',gridTid=base+'grdUsedFields;tbl';
      const grouping={status:'unobserved',keys:[],measures:[],complete:false,
        source_identity_verified:false,settings_applied:false,aggregation_settings_verified:false,
        definition_coverage:{status:'partial'},reason:'grouping_region_required'};
      wizard.grouping=grouping;
      // Available fields are selectable before either used-field section has
      // been configured. Bind each control to its exact wizard-owned grid/row;
      // this does not establish complete source schema or applied settings.
      grouping.available_fields=[];
      const availableTid=base+'grdDataFields;tbl',availableGrids=[...wizardForms[0].querySelectorAll('[data-tid$=";GroupDataWizard;grdDataFields;tbl"]')].filter(e=>{charge();return getTid(e)===availableTid && visible(e);});
      if(!discoverRoots && availableGrids.length===1 && wizardForms[0].contains(availableGrids[0])) {
        const available=availableGrids[0],types={dtInteger:'integer',dtFloat:'real',dtString:'string',dtBoolean:'boolean',dtDateTime:'datetime',dtVariant:'variant'};
        const cells=all.filter(e=>{charge();return (getTid(e)??'').startsWith(base+'colDisplayName_') && available.contains(e) && visible(e) && !sensitive(e);});
        if(cells.length<=64)for(const cell of cells) {
          const tid=getTid(cell),key=tid.slice((base+'colDisplayName_').length),row=cell.closest('table.x-grid-item');
          const peers=tids.get(tid)??[],index=row?.getAttribute('data-recordindex'),label=textOf(cell);
          const icons=[...cell.querySelectorAll('[class*="bg-TBGDataType-"]')];charge();
          const kinds=icons.length===1 && visible(icons[0])?Object.entries(types).filter(([css])=>icons[0].classList.contains('bg-TBGDataType-'+css)):[];
          if(peers.length!==1 || !row || row.closest('[data-tid$=";tbl"]')!==available
            || !available.getAttribute('id') || row.getAttribute('data-boundview')!==available.getAttribute('id')
            || !/^(0|[1-9][0-9]*)$/.test(index??'') || cell.closest('.x-grid-row-summary')
            || !key || key.length>128 || key.includes(';') || !label || label.length>=240
            || label==='[outside selected root]' || kinds.length!==1)continue;
          grouping.available_fields.push({field_key:key,label,input_type:kinds[0][1],cell_ref:refOf(cell),row_ref:refOf(row),
            grid_ref:refOf(available),record_index:Number(index),selected:row.classList.contains('x-grid-item-selected'),source_identity_verified:false});
        }
      }
      const grids=tids.get(gridTid)??[];
      if(!discoverRoots && grids.length===1 && wizardForms[0].contains(grids[0])
        && (!requestedRoot || requestedRoot===grids[0] || requestedRoot.contains(grids[0]))) {
        const grid=grids[0],containers=[...grid.querySelectorAll('.x-grid-item-container')];charge();
        const inside=(e,parent)=>{
          const b=boxOf(e),p=boxOf(parent),vw=globalThis.innerWidth,vh=globalThis.innerHeight;
          return visible(e) && !sensitive(e) && [b.x,b.y,b.width,b.height,p.x,p.y,p.width,p.height,vw,vh].every(Number.isFinite)
            && b.x>=0 && b.y>=0 && b.x+b.width<=vw && b.y+b.height<=vh
            // Live Ext table borders extend exactly 1/64 CSS px beyond the
            // container's right edge. No tolerance applies to viewport edges.
            && b.x>=p.x && b.y>=p.y && b.x+b.width<=p.x+p.width+1/64 && b.y+b.height<=p.y+p.height;
        };
        const noEditors=![...wizardForms[0].querySelectorAll('[data-tid]')].some(e=>{
          charge();const tid=getTid(e)??'';
          return visible(e) && (tid.startsWith(wizard.root_tid+';FactorEditDialog') || tid.startsWith(gridTid+';celleditor'));
        });
        grouping.reason='grouping_structure_unverifiable';
        if(containers.length===1 && inside(grid,grid) && inside(containers[0],grid) && noEditors
          && !select('.bg-mask-message,.x-mask-msg').some(visible)) {
          const container=containers[0],rows=[...container.children];charge();
          const allRows=[...grid.querySelectorAll('table.x-grid-item')];charge();
          const types={dtInteger:'integer',dtFloat:'real',dtString:'string',dtBoolean:'boolean',dtDateTime:'datetime',dtVariant:'variant'};
          let section=null,sectionIndex=-1,closed=true,valid=rows.length>0 && rows.length<=8
            && rows.length===allRows.length && rows.every(e=>allRows.includes(e))
            && [...grid.children].every(e=>e===container || !visible(e));
          const keys=[],measures=[],seen=new Set(),sections=[];
          for(const [index,row] of rows.entries()) {
            charge();if(!valid)break;
            const bodyId=grid.getAttribute('id');
            const headers=[...row.querySelectorAll('.x-grid-group-hd')];charge();
            const dataRows=[...row.querySelectorAll('tr.x-grid-row')];charge();
            const summaries=[...row.querySelectorAll('tr.x-grid-row-summary')];charge();
            const rowParts=[...row.querySelectorAll('tr')];charge();
            const expectedParts=[...headers.map(e=>e.closest('tr')),...dataRows,...summaries];
            if(row.parentElement!==container || !row.matches('table.x-grid-item') || !inside(row,container)
              || row.getAttribute('data-recordindex')!==String(index) || !bodyId || row.getAttribute('data-boundview')!==bodyId
              || headers.length>1 || dataRows.length!==1 || summaries.length>1 || rowParts.length!==expectedParts.length
              || rowParts.some((part,i)=>part!==expectedParts[i])){valid=false;break;}
            if(headers.length===1) {
              const header=headers[0],next=sectionIndex+1,id=next===0?'6':next===1?'7':null;
              if(!closed || !id || getTid(header)!==gridTid+';GroupHeader;'+id || header.getAttribute('data-groupname')!==id
                || (tids.get(getTid(header))??[]).length!==1
                || !header.classList.contains('x-grid-group-hd-not-collapsible') || !inside(header,row)
                || textOf(header,true)!==(next===0?'Группа':'Показатели')){valid=false;break;}
              sectionIndex=next;section=next===0?'group':'measure';closed=false;
              sections.push({role:section,header_ref:refOf(header)});
            }
            if(closed || !section){valid=false;break;}
            const cells=all.filter(e=>{charge();return dataRows[0].contains(e) && (getTid(e)??'').startsWith(base+'colUsedFields_');});
            if(cells.length!==1 || !inside(cells[0],row)){valid=false;break;}
            const cell=cells[0],fieldKey=getTid(cell).slice((base+'colUsedFields_').length),text=textOf(cell,true);
            const peers=(tids.get(getTid(cell))??[]).filter(e=>!(e.closest('.x-grid-row-summary') && e.closest('table')===row && textOf(e,true)===''));
            const icons=[...cell.querySelectorAll('[class*="bg-TBGDataType-"]')];charge();
            const observedTypes=icons.length===1 && visible(icons[0])?Object.entries(types).filter(([css])=>icons[0].classList.contains('bg-TBGDataType-'+css)):[];
            if(!fieldKey || fieldKey.length>128 || fieldKey.includes(';') || seen.has(fieldKey) || peers.length!==1
              || !text || text.length>=240 || sensitive(cell) || observedTypes.length!==1){valid=false;break;}
            const aggregate=section==='measure'?/^(.*) \((Сумма|Количество)\)$/.exec(text):null;
            if(section==='measure' && (!aggregate || !aggregate[1] || aggregate[1].length>=240)){valid=false;break;}
            const field={field_key:fieldKey,label:aggregate?aggregate[1]:text,input_type:observedTypes[0][1],
              row_ref:refOf(row),cell_ref:refOf(cell),section_ref:sections.at(-1).header_ref,
              rendered_text:text,source_identity_verified:false};
            if(section==='measure')field.aggregations=[aggregate[2]==='Сумма'?'sum':'count'];
            (section==='group'?keys:measures).push(field);seen.add(fieldKey);
            if(summaries.length) {
              const expected=base+'colUsedFields;SummaryRow-'+sectionIndex;
              const ends=[...summaries[0].querySelectorAll('[data-tid]')].filter(e=>{charge();return getTid(e)===expected || getTid(e)===getTid(cell);});
              if(ends.length!==1 || textOf(ends[0],true)!=='' || !inside(summaries[0],row) || !inside(ends[0],row)){valid=false;break;}
              closed=true;
            }
          }
          if(valid && closed && sectionIndex===1 && keys.length && measures.length)Object.assign(grouping,
            {status:'rendered_grouping_rows',keys,measures,sections,reason:'rendered_rows_only',grid_ref:refOf(grid),container_ref:refOf(container)});
          if(grouping.status==='rendered_grouping_rows') {
            const bounds=e=>({top:e.scrollTop,left:e.scrollLeft,height:e.clientHeight,width:e.clientWidth,
              scroll_height:e.scrollHeight,scroll_width:e.scrollWidth});
            const gridBounds=bounds(grid),containerBounds=bounds(container);
            const noOverflow=b=>Object.values(b).every(Number.isFinite) && b.top===0 && b.left===0
              && b.height>0 && b.width>0 && b.scroll_height===b.height && b.scroll_width===b.width;
            const transform=globalThis.getComputedStyle(container).transform;
            const atOrigin=['none','matrix(1, 0, 0, 1, 0, 0)','matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'].includes(transform);
            const extras=[...grid.children].filter(e=>e!==container);
            // Exact observed Ext sentinel only; hidden row/spacer payload is
            // not evidence that the complete list has been rendered.
            const sentinel=extras.length<=1 && extras.every(e=>e.tagName==='DIV'
              && e.children.length===0 && !getTid(e) && globalThis.getComputedStyle(e).display==='none'
              && e.getAttribute('role')==='presentation' && e.style.width==='1px' && e.style.height==='1px');
            const controls=[...grid.querySelectorAll('input,textarea,select')];charge();
            if(noOverflow(gridBounds) && noOverflow(containerBounds) && atOrigin && sentinel && controls.length===0) {
              grouping.definition_coverage={status:'complete_rendered_used_fields',source_identity_verified:false,
                row_count:rows.length,first_index:0,last_index:rows.length-1,
                first_row_ref:refOf(rows[0]),last_row_ref:refOf(rows.at(-1)),grid_bounds:gridBounds,container_bounds:containerBounds,
                sections:sections.map(s=>({role:s.role,header_ref:s.header_ref,
                  row_count:(s.role==='group'?keys:measures).length})),
                unfiltered_scope:'used_fields_only',available_fields_filter_applies:false,
                no_scroll_remainder:true,container_at_origin:true,no_editors:true};
            }
          }

        }
      }
    }
    if(wizard.status==='observed' && wizard.stage==='grouping') {
      const dialogTid=wizard.root_tid+';FactorEditDialog',dialogs=tids.get(dialogTid)??[];
      const factor={status:'unobserved',opening_verified:false,settings_applied:false,
        source_identity_verified:false,aggregation_settings_verified:false,options:[]};
      wizard.factor_editor=factor;
      const fullyVisible=e=>{
        const b=boxOf(e);
        return visible(e) && !sensitive(e) && [b.x,b.y,b.width,b.height].every(Number.isFinite)
          && b.x>=0 && b.y>=0 && b.x+b.width<=globalThis.innerWidth && b.y+b.height<=globalThis.innerHeight;
      };
      if(!discoverRoots && dialogs.length===1 && fullyVisible(dialogs[0])
        && (!requestedRoot || requestedRoot===dialogs[0] || requestedRoot.contains(dialogs[0]))) {
        const dialog=dialogs[0],groupTid=dialogTid+';grpFactors',groups=tids.get(groupTid)??[];
        const definitions=[['gdSum','sum','Сумма'],['gdCount','count','Количество'],['gdMin','min','Минимум'],
          ['gdMax','max','Максимум'],['gdAvg','average','Среднее'],['gdMedian','median','Медиана'],['gdMode','mode','Мода'],
          ['gdStdDev','standard_deviation','Стандартное откл.'],['gdUniqueCount','unique_count','Кол-во уникальных'],
          ['gdNullCount','null_count','Кол-во пропусков'],['gdFirst','first','Первый'],['gdLast','last','Последний'],
          ['gdOnly','only','Единственный'],['gdConcat','concat','Список']];
        const owners=[...dialog.querySelectorAll('.x-form-type-checkbox')].filter(e=>(getTid(e)??'').startsWith(groupTid+';') || groups.length===1 && groups[0].contains(e));
        let valid=groups.length===1 && dialog.contains(groups[0]) && fullyVisible(groups[0]) && owners.length===14;
        const options=[];
        for(const [index,[iconName,aggregation,label]] of definitions.entries()) {
          if(!valid)break;charge();
          const tid=groupTid+';chb'+(index?'-'+index:'');const matches=tids.get(tid)??[];
          if(matches.length!==1){valid=false;break;}
          const owner=matches[0],displays=tids.get(tid+';DisplayEl')??[],inputs=tids.get(tid+';InputEl')??[];
          const b=boxOf(owner),g=boxOf(groups[0]);
          const labels=[...owner.querySelectorAll('.x-form-cb-label')],icons=[...owner.querySelectorAll('[class*="bg-TBGGroupDataFunction-"]')];charge();
          if(!owners.includes(owner) || !groups[0].contains(owner) || !fullyVisible(owner)
            || b.x<g.x || b.y<g.y || b.x+b.width>g.x+g.width || b.y+b.height>g.y+g.height
            || displays.length!==1 || inputs.length!==1 || !owner.contains(displays[0]) || !owner.contains(inputs[0])
            || !fullyVisible(displays[0]) || inputs[0].getAttribute('role')!=='checkbox'
            || labels.length!==1 || !fullyVisible(labels[0]) || textOf(labels[0],true)!==label
            || icons.length!==1 || !fullyVisible(icons[0]) || !icons[0].classList.contains('bg-TBGGroupDataFunction-'+iconName)
            || definitions.filter(([name])=>icons[0].classList.contains('bg-TBGGroupDataFunction-'+name)).length!==1) {valid=false;break;}
          options.push({aggregation,label,owner_ref:refOf(owner),display_ref:refOf(displays[0]),
            checked:owner.classList.contains('x-form-cb-checked'),enabled:enabled(owner),state_source:'ext_owner_class'});
        }
        const gridTid=wizard.root_tid+';GroupDataWizard;grdUsedFields;tbl',grids=tids.get(gridTid)??[];
        let selected=null;
        if(grids.length===1 && wizardForms[0].contains(grids[0])) {
          const rows=[...grids[0].querySelectorAll('table.x-grid-item-selected')];charge();
          if(rows.length===1 && fullyVisible(rows[0]) && rows[0].getAttribute('data-boundview')===grids[0].getAttribute('id')) {
            const prefix=wizard.root_tid+';GroupDataWizard;colUsedFields_';
            const cells=[...rows[0].querySelectorAll('[data-tid]')].filter(e=>!e.closest('.x-grid-row-summary') && (getTid(e)??'').startsWith(prefix));
            // The dialog is a portal sibling; a scoped dialog read does not
            // include the selected grid cell in tids. Check exact native DOM
            // uniqueness with a bounded query, not metadata issuance.
            const exactCells=cells.length===1?[...document.querySelectorAll('[data-tid='+JSON.stringify(getTid(cells[0]))+']')].filter(e=>{
              charge();return !(e.closest('.x-grid-row-summary') && e.closest('table')===rows[0] && fullyVisible(e) && textOf(e,true)==='');
            }):[];charge();
            if(cells.length===1 && fullyVisible(cells[0]) && exactCells.length===1 && exactCells[0]===cells[0]) {
              const key=getTid(cells[0]).slice(prefix.length),index=rows[0].getAttribute('data-recordindex');
              if(key && !key.includes(';') && /^[0-9]+$/.test(index??''))selected={status:'rendered_selected',
                field_key:key,row_ref:refOf(rows[0]),cell_ref:refOf(cells[0]),record_index:Number(index),opening_verified:false};
            }
          }
        }
        if(valid && selected)Object.assign(factor,{status:'rendered_factor_options',dialog_ref:refOf(dialog),
          dialog_tid:dialogTid,group_ref:refOf(groups[0]),selected_field:selected,options,
          definition_coverage:{status:'complete_rendered_options',count:14},count_includes_null_records:true});
      }
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
      const forms=['ColumnsMappingEngineOutputPortWizard','DerivedDataSourceOutputSocketWizard','DerivedDataSourceMappingEngineOutputPortWizard'].filter(name=>
        (tids.get(wizard.root_tid+';'+name+';btnAddMappingColumn')??[]).filter(e=>wizardForms[0].contains(e) && visible(e) && !sensitive(e)).length===1);
      const base=wizard.root_tid+';'+(forms.length===1?forms[0]:'__unobserved__')+';';
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
    if(wizard.reform_columns) {
      let coverage={status:'partial',source_identity_verified:false};
      const base=wizard.root_tid+';ReformColumnsWizard;';
      const unique=key=>{const es=tids.get(base+key)??[];return es.length===1 && wizardForms[0].contains(es[0])
        && visible(es[0]) && !sensitive(es[0])?es[0]:null;};
      const body=unique('grdTargetColumns;tbl'),filter=unique('TargetFilter');
      if(body && filter) {
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
        const fields=wizard.reform_columns.fields;
        const noEditors=!all.some(e=>{charge();return ((getTid(e)??'').startsWith(base+'grdTargetColumns;tbl;celleditor')
          || getTid(e)===wizard.root_tid+';EditReformColumnDefForm' || getTid(e)==='EditReformColumnDefForm') && visible(e);});
        const noMasks=!select('.bg-mask-message,.x-mask-msg').some(visible);
        if(containers.length===1 && rows.length>0 && rows.length<=8 && rows.length===fields.length
          && dimensions.every(Number.isFinite) && body.clientWidth>0 && body.clientHeight>0
          && body.scrollWidth<=body.clientWidth && body.scrollHeight<=body.clientHeight && body.scrollLeft===0 && body.scrollTop===0
          && inputs.length===1 && String(inputs[0].value??'')==='' && noEditors && noMasks && inside(body,body)) {
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
                || rb.y!==(previous?previous.y+previous.height:cb.y) || matches.length!==1 || matches[0].status!=='observed' || typeof matches[0].excluded!=='boolean' || !matches[0].caching || !matches[0].data_kind || !matches[0].usage
                || nameCells.length!==1)return false;
              const key=getTid(nameCells[0]).slice((base+'colName_').length);
              return ['colName_','colDisplayName_','colDataKind_','colDefaultUsageType_','colCachingMethod_','colExcluded_'].every(prefix=>{
                const es=tids.get(base+prefix+key)??[];
                return es.length===1 && row.contains(es[0]) && inside(es[0],row);
              });
            }) && boxOf(rows.at(-1)).y+boxOf(rows.at(-1)).height===cb.y+cb.height;
          if(valid)coverage={status:'complete_configured_fields',count:rows.length,body_ref:refOf(body),container_ref:refOf(container),
            first_row_ref:refOf(rows[0]),last_row_ref:refOf(rows.at(-1)),filter_ref:refOf(inputs[0]),source_identity_verified:false};
        }
      }
      wizard.reform_columns.definition_coverage=coverage;
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
      // Complete bounded definition rows are distinct from expression text,
      // options, source mapping identity and applied/persisted configuration.
      const manifest={status:'unobserved',fields:[],definition_coverage:{status:'partial'},complete:false,
        expression_texts_verified:false,source_identity_verified:false,settings_applied:false,
        selected_replacement:{status:'unobserved'}};
      wizard.calculator_expressions=manifest;
      const replacements=tids.get(base+'btnReplaceField')??[];
      if(wizard.expression_selection.status==='observed' && replacements.length===1
        && wizardForms[0].contains(replacements[0]) && visible(replacements[0]) && !sensitive(replacements[0]))
        manifest.selected_replacement={status:'observed',value:replacements[0].classList.contains('x-btn-pressed'),
          enabled:enabled(replacements[0]),button_ref:refOf(replacements[0]),row_ref:wizard.expression_selection.row_ref};
      const gridTid=base+'grdExpressions;tbl',grids=tids.get(gridTid)??[];
      if(!discoverRoots && grids.length===1 && wizardForms[0].contains(grids[0])
        && (!requestedRoot || requestedRoot===grids[0] || requestedRoot.contains(grids[0]))) {
        const grid=grids[0],containers=[...grid.querySelectorAll('.x-grid-item-container')];charge();
        const inside=(e,parent)=>{
          const b=boxOf(e),p=boxOf(parent),vw=globalThis.innerWidth,vh=globalThis.innerHeight;
          return visible(e) && !sensitive(e) && [b.x,b.y,b.width,b.height,p.x,p.y,p.width,p.height,vw,vh].every(Number.isFinite)
            && b.x>=0 && b.y>=0 && b.x+b.width<=vw && b.y+b.height<=vh
            && b.x>=p.x && b.y>=p.y && b.x+b.width<=p.x+p.width && b.y+b.height<=p.y+p.height;
        };
        const bounds=[grid.clientWidth,grid.clientHeight,grid.scrollWidth,grid.scrollHeight,grid.scrollLeft,grid.scrollTop];
        const noEditor=!all.some(e=>{charge();return visible(e) && ((getTid(e)??'').startsWith(gridTid+';celleditor')
          || getTid(e)===wizard.root_tid+';ExprDataEditForm');});
        if(containers.length===1 && inside(grid,grid) && inside(containers[0],grid) && noEditor && !dialogs.length
          && !select('.bg-mask-message,.x-mask-msg').some(visible) && bounds.every(Number.isFinite)
          && grid.clientWidth>0 && grid.clientHeight>0 && grid.scrollWidth<=grid.clientWidth && grid.scrollHeight<=grid.clientHeight
          && grid.scrollLeft===0 && grid.scrollTop===0) {
          const container=containers[0],rows=[...container.children];charge();
          const nativeRows=[...grid.querySelectorAll('table.x-grid-item')];charge();
          const cb=boxOf(container),gb=boxOf(grid),boundId=grid.getAttribute('id');
          let valid=!!boundId && rows.length>0 && rows.length<=8 && rows.length===nativeRows.length
            && rows.every(e=>nativeRows.includes(e)) && cb.x===gb.x && cb.y===gb.y
            && [...grid.children].every(e=>e===container || !visible(e));
          const fields=[],names=new Set(),types={dtInteger:'integer',dtFloat:'real',dtString:'string',dtBoolean:'boolean',dtDateTime:'datetime',dtVariant:'variant'};
          for(const [index,row] of rows.entries()) {
            charge();if(!valid)break;
            const rb=boxOf(row),previous=index?boxOf(rows[index-1]):null;
            const dataRows=[...row.querySelectorAll('tr')];charge();
            const cells=all.filter(e=>{charge();return row.contains(e) && (getTid(e)??'').startsWith(base+'colExpressionName_');});
            if(!row.matches('table.x-grid-item') || row.parentElement!==container || !inside(row,container)
              || row.getAttribute('data-recordindex')!==String(index) || row.getAttribute('data-boundview')!==boundId
              || rb.y!==(previous?previous.y+previous.height:cb.y) || dataRows.length!==1
              || !dataRows[0].classList.contains('x-grid-row') || cells.length!==1){valid=false;break;}
            const cell=cells[0],key=getTid(cell).slice((base+'colExpressionName_').length),name=String(cell.textContent??'');
            const labels=tids.get(base+'colExpressionDisplayName_'+key)??[],peers=tids.get(getTid(cell))??[];
            const icons=[...cell.querySelectorAll('[class*="bg-TBGDataType-dt"]')];charge();
            const matched=icons.length===1 && visible(icons[0])?Object.entries(types).filter(([css])=>icons[0].classList.contains('bg-TBGDataType-'+css)):[];
            if(peers.length!==1 || labels.length!==1 || !row.contains(labels[0]) || !inside(cell,row) || !inside(labels[0],row)
              || dom.some(e=>{charge();return (cell.contains(e) || labels[0].contains(e)) && sensitive(e);})
              || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || key!==name || names.has(name) || matched.length!==1){valid=false;break;}
            const label=String(labels[0].textContent??'');
            if(!label || label.length>256 || /[\0\r\n]/.test(label)){valid=false;break;}
            fields.push({index,name,label,type:matched[0][1],row_ref:refOf(row),name_ref:refOf(cell),label_ref:refOf(labels[0]),
              selected:row.classList.contains('x-grid-item-selected')});names.add(name);
          }
          if(valid && fields.length===rows.length && boxOf(rows.at(-1)).y+boxOf(rows.at(-1)).height===cb.y+cb.height)
            Object.assign(manifest,{status:'rendered_expression_definitions',fields,
              definition_coverage:{status:'complete_configured_rows',count:fields.length,grid_ref:refOf(grid),container_ref:refOf(container),
                first_row_ref:refOf(rows[0]),last_row_ref:refOf(rows.at(-1)),source_identity_verified:false}});
        }
      }
    }
// Private candidate: accepts only the pinned DOM probe schema. No model-supplied
// expected names, link order or values participate in reconstructing the links.
function readRenderedInputMapping(observation) {
  const empty = reason => ({status:'unobserved',reason,links:[],complete:false,
    source_identity_verified:false,settings_applied:false});
  try {
    const d=observation;
    const require = (ok,reason) => { if(!ok)throw new Error(reason); };
    const cls=(n,c)=>String(n?.classes??'').split(/\s+/).includes(c);
    const finite=r=>r&&['x','y','width','height','right','bottom'].every(k=>Number.isFinite(r[k]))
      && r.width>0&&r.height>0&&r.right===r.x+r.width&&r.bottom===r.y+r.height;
    const shown=n=>n?.visible===true&&finite(n.rect)&&n.style?.visibility==='visible'
      &&n.style.display!=='none'&&Number(n.style.opacity)>0;
    const inside=(n,p)=>shown(n)&&finite(p.rect)&&n.rect.x>=p.rect.x&&n.rect.y>=p.rect.y
      &&n.rect.right<=p.rect.right&&n.rect.bottom<=p.rect.bottom;
    require(d?.status==='dom_observation'&&/^MF;TF(?:-\d+)?;WizrdMCF$/.test(d.owner?.tid),'owner_unverified');
    require(Number.isFinite(d.viewport?.width)&&Number.isFinite(d.viewport?.height),'viewport_unverified');
    const viewport={rect:{x:0,y:0,width:d.viewport.width,height:d.viewport.height,right:d.viewport.width,bottom:d.viewport.height}};
    require(inside(d.owner,viewport)&&Array.isArray(d.masks)&&d.masks.length===0,'owner_blocked');
    const base=d.owner.tid+';TuneDataSourceMappingWizard;';
    const control=name=>{
      const c=d.controls.filter(x=>x.name===name);
      require(c.length===1&&c[0].matches.length===1,'control_not_unique');
      const n=c[0].matches[0];require(n.tid===base+name&&inside(n,d.owner),'control_not_owned');return n;
    };
    const radio=name=>{const n=control(name);require(cls(n,'x-form-type-radio'),'mode_not_radio');
      const input=n.parts.filter(p=>p.tid===base+name+';InputEl');
      require(input.length===1&&inside(input[0],n)&&input[0].disabled===false,'mode_input_unverified');
      return cls(n,'x-form-cb-checked');};
    require(radio('rbLinks')&&!radio('rbTable'),'links_mode_unverified');
    for(const name of ['SourceFilter','TargetFilter']) {
      const n=control(name),inputs=n.parts.filter(p=>p.tag==='INPUT');
      require(inputs.length===1&&inside(inputs[0],n)&&inputs[0].value==='','filter_not_empty');
    }
    require(Array.isArray(d.ownedMarkers)&&!d.ownedMarkers.some(n=>n.visible&&/GroupHeader|celleditor/.test(n.tid??'')),'grouped_or_editing');
    const noScroll=n=>n.scroll&&['left','top','width','height','clientWidth','clientHeight'].every(k=>Number.isFinite(n.scroll[k]))
      &&n.scroll.left===0&&n.scroll.top===0&&n.scroll.width<=n.scroll.clientWidth&&n.scroll.height<=n.scroll.clientHeight;
    const grid=side=>{
      const names={source:['grdSourceColumns','colSourceName_'],target:['grdTargetColumns','colDisplayName_']};
      require(Array.isArray(d[side])&&d[side].length===1,'grid_not_unique');
      const g=d[side][0],[gridName,cellName]=names[side];
      require(g.tid===base+gridName+';tbl'&&inside(g,d.owner)&&noScroll(g),'grid_bounds_unverified');
      const containers=g.children.filter(n=>cls(n,'x-grid-item-container'));
      require(containers.length===1&&g.children.every(n=>n===containers[0]||!n.visible),'container_not_unique');
      const c=containers[0];require(inside(c,g)&&noScroll(c)&&c.rect.x===g.rect.x&&c.rect.y===g.rect.y,'container_bounds_unverified');
      const rows=c.children;require(rows.length>0&&rows.length<=8,'row_bound_exceeded');
      const keys=new Set();
      const fields=rows.map((r,index)=>{
        require(r.tag==='TABLE'&&cls(r,'x-grid-item')&&r.recordindex===String(index)&&r.boundview===g.id
          &&inside(r,c)&&r.rect.y===(index?rows[index-1].rect.bottom:c.rect.y),'row_structure_unverified');
        require(r.rows.length===1&&cls(r.rows[0],'x-grid-row')&&inside(r.rows[0],r),'data_row_unverified');
        const cells=r.rows[0].cells.filter(n=>n.tid?.startsWith(base+cellName));
        require(cells.length===1&&inside(cells[0],r),'field_cell_unverified');
        const cell=cells[0],key=cell.tid.slice((base+cellName).length);
        require(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)&&!keys.has(key),'field_key_ambiguous');keys.add(key);
        require(typeof cell.text==='string'&&cell.text.length>0&&cell.text.length<=256&&!/[\0\r\n]/.test(cell.text),'field_label_unbounded');
        const iconClasses=[...String(cell.html??'').matchAll(/class="([^"]*)"/g)].flatMap(m=>m[1].split(/\s+/)).filter(x=>/^bg-TBGDataType-dt/.test(x));
        const typeMap={dtInteger:'integer',dtFloat:'real',dtString:'string',dtBoolean:'boolean',dtDateTime:'datetime',dtVariant:'variant'};
        require(iconClasses.length===1&&typeMap[iconClasses[0].slice('bg-TBGDataType-'.length)],'field_type_marker_unverified');
        return {index,key,label:cell.text,type_marker:typeMap[iconClasses[0].slice('bg-TBGDataType-'.length)],
          type_verified:Array.isArray(cell.icons)&&cell.icons.length===1&&inside(cell.icons[0],cell)
            &&cls(cell.icons[0],iconClasses[0]),cell_tid:cell.tid,rect:cell.rect};
      });
      require(rows.at(-1).rect.bottom===c.rect.bottom,'rows_end_unverified');return {fields,grid:g};
    };
    const source=grid('source'),target=grid('target');
    require(d.draws?.length===1,'draw_not_unique');const draw=d.draws[0];
    require(draw.tid===base+'pnlMiddle;draw'&&inside(draw,d.owner)&&draw.svgs?.length===1,'draw_owner_unverified');
    const svg=draw.svgs[0];require(inside(svg,draw)&&svg.paths?.length>0&&svg.paths.length<=24,'svg_bound_unverified');
    const lines=[],arrows=[],hitAreas=[];
    const number='-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
    const linePattern=new RegExp('^M('+number+'),('+number+')L('+number+'),('+number+')L('+number+'),('+number+')L('+number+'),('+number+')$');
    const point=(m,x,y)=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f});
    for(const [index,p] of svg.paths.entries()) {
      const m=p.screenCTM;require(m&&['a','b','c','d','e','f'].every(k=>Number.isFinite(m[k]))&&m.a===1&&m.b===0&&m.c===0&&m.d===1&&m.e===draw.rect.x&&m.f===draw.rect.y,'path_transform_unverified');
      require(p.style.visibility==='visible'&&p.style.display!=='none'&&Number(p.style.opacity)===1,'path_hidden');
      const match=linePattern.exec(p.d);
      if(match&&p.style.stroke==='rgb(247, 147, 30)'&&Number(p.style.strokeOpacity)===1&&Number(p.style.strokeWidth.replace('px',''))===2&&p.style.fill==='rgba(0, 0, 0, 0)') {
        const v=match.slice(1).map(Number);
        require(v[0]===0&&v[2]===20&&v[4]===80&&v[6]===100&&v[1]===v[3]&&v[5]===v[7]&&draw.rect.width===100,'line_shape_unverified');
        lines.push({index,start:point(m,v[0],v[1]),end:point(m,v[6],v[7]),local:v});
      } else if(p.d.endsWith('Z')&&p.style.fill==='rgb(247, 147, 30)'&&p.style.stroke==='rgb(255, 255, 255)'&&Number(p.style.fillOpacity)===1)arrows.push(p);
      else if(p.d.endsWith('Z')&&p.style.fill==='rgb(255, 255, 255)'&&Number(p.style.fillOpacity)===0.01&&Number(p.style.strokeOpacity)===0.01)hitAreas.push(p);
      else require(false,'unknown_path');
    }
    require(lines.length>0&&lines.length===arrows.length&&lines.length===hitAreas.length,'path_count_unverified');
    const usedSources=new Set(),usedTargets=new Set();
    const links=lines.map(line=>{
      const src=source.fields.filter(f=>line.start.x===f.rect.right+1&&line.start.y===f.rect.y+f.rect.height/2);
      const dst=target.fields.filter(f=>line.end.x===f.rect.x-1&&line.end.y===f.rect.y+f.rect.height/2);
      require(src.length===1&&dst.length===1,'endpoint_ambiguous');const a=src[0],b=dst[0];
      require(!usedSources.has(a.key)&&!usedTargets.has(b.key),'duplicate_endpoint');usedSources.add(a.key);usedTargets.add(b.key);
      const y=line.local[7];
      const arrow=`M90,${y-6}L90,${y+6}L100,${y}L90,${y-6}Z`;
      require(arrows.filter(p=>p.d===arrow&&p.screenCTM.e===draw.rect.x&&p.screenCTM.f===draw.rect.y).length===1,'arrow_unverified');
      const sy=line.local[1],delta=(y-sy)/40,n=v=>Number(v.toFixed(8));
      const hit=`M0,${sy-5}L${n(20+delta)},${sy-5}L${n(80+delta)},${y-5}L100,${y-5}L100,${y+5}L${n(80-delta)},${y+5}L${n(20-delta)},${sy+5}L0,${sy+5}Z`;
      require(hitAreas.filter(p=>p.d===hit).length===1,'hit_area_unverified');
      return {source_key:a.key,target_key:b.key,source_cell_tid:a.cell_tid,target_cell_tid:b.cell_tid,path_index:line.index};
    });
    return {status:'rendered_mapping_links',owner_tid:d.owner.tid,source_rows:source.fields,target_rows:target.fields,links,
      rendered_coverage:{status:'complete_visible_rows',source_count:source.fields.length,target_count:target.fields.length,link_count:links.length},
      complete:false,source_identity_verified:false,settings_applied:false};
  } catch(error) { return empty(error.message||'mapping_structure_unverifiable'); }
}

    if(wizard.status==='observed' && wizard.stage==='input_mapping'
      && (tids.get(wizard.root_tid+';TuneDataSourceMappingWizard;btnAddMappingColumn')??[]).some(e=>wizardForms[0].contains(e)&&visible(e))) {
      const mappingBase=wizard.root_tid+';TuneDataSourceMappingWizard;';
      const mapping={status:'unobserved',reason:'full_mapping_root_required',links:[],complete:false,source_identity_verified:false,settings_applied:false};
      wizard.input_mapping=mapping;
      const owner=wizardForms[0];
      if(!discoverRoots && (!requestedRoot || requestedRoot===owner || requestedRoot.contains(owner)) && !dialogs.length) {
        const query=(root,selector)=>{const found=[...root.querySelectorAll(selector)];charge();if(found.length>128)throw new Error('mapping_collection_bound');for(const e of found) {charge();if(!seenElements.has(e))throw new Error('mapping_scan_incomplete');}return found;};
        const children=e=>{const found=[...e.children];if(found.length>32)throw new Error('mapping_collection_bound');for(const n of found){charge();if(!seenElements.has(n))throw new Error('mapping_scan_incomplete');}return found;};
        const exact=tail=>(tids.get(mappingBase+tail)??[]).filter(e=>owner.contains(e));
        const rect=e=>{const b=boxOf(e);return {...b,right:b.x+b.width,bottom:b.y+b.height};};
        const info=e=>{charge();const s=getComputedStyle(e);return {tag:e.tagName,tid:getTid(e),id:e.getAttribute('id'),classes:e.getAttribute('class'),
          rect:rect(e),visible:visible(e)&&!sensitive(e),style:Object.fromEntries(['display','visibility','opacity','fill','fillOpacity','stroke','strokeWidth','strokeOpacity'].map(k=>[k,s[k]])),
          scroll:{left:e.scrollLeft,top:e.scrollTop,width:e.scrollWidth,height:e.scrollHeight,clientWidth:e.clientWidth,clientHeight:e.clientHeight}};};
        const cell=e=>{const icons=query(e,'[class*="bg-TBGDataType-dt"]');
          return {...info(e),icons:icons.map(info),text:String(e.textContent??'').trim(),html:icons.length===1&&visible(icons[0])&&!sensitive(icons[0])?'<i class="'+icons[0].getAttribute('class')+'"></i>':''};};
        const table=e=>({...info(e),recordindex:e.getAttribute('data-recordindex'),boundview:e.getAttribute('data-boundview'),
          rows:query(e,'tr').map(r=>({...info(r),cells:children(r).map(cell)}))});
        const grid=name=>exact(name+';tbl').map(g=>({...info(g),children:children(g).map(c=>({...info(c),children:children(c).map(table)}))}));
        const control=name=>({name,matches:exact(name).map(e=>({...info(e),parts:[e,...query(e,'input,button,label,[data-tid]')].map(n=>({...info(n),
          value:'value'in n?String(n.value??''):null,disabled:'disabled'in n?n.disabled:null}))}))});
        const matrices=e=>{charge();const m=e.getScreenCTM?.();return m?Object.fromEntries(['a','b','c','d','e','f'].map(k=>[k,m[k]])):null;};
        try {
          const mappingNodes=dom.filter(e=>{charge();return owner.contains(e);});
          if(mappingNodes.some(e=>sensitive(e)))throw new Error('mapping_sensitive_content');
          const pathElements=[];
          const draws=exact('pnlMiddle;draw').map(e=>({...info(e),svgs:query(e,'svg').map(s=>({...info(s),paths:query(s,'path').map(p=>{
            pathElements.push(p);if(pathElements.length>24)throw new Error('mapping_path_bound');
            for(let ancestor=p.parentElement;ancestor&&ancestor!==owner;ancestor=ancestor.parentElement){charge();const style=getComputedStyle(ancestor);if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)!==1)throw new Error('mapping_path_hidden');}
            return {...info(p),d:p.getAttribute('d'),screenCTM:matrices(p)};})}))}));
          const raw={status:'dom_observation',owner:info(owner),viewport:{width:globalThis.innerWidth,height:globalThis.innerHeight},
            masks:select('.x-mask,.bg-mask-message,.x-mask-msg').filter(visible).map(info),
            controls:['rbLinks','rbTable','SourceFilter','TargetFilter'].map(control),source:grid('grdSourceColumns'),target:grid('grdTargetColumns'),draws,
            ownedMarkers:mappingNodes.filter(e=>(getTid(e)??'').startsWith(mappingBase)&&/GroupHeader|celleditor/.test(getTid(e))).map(info)};
          const rendered=readRenderedInputMapping(raw);
          if(rendered.status==='rendered_mapping_links') {
            const cellRef=tid=>{const found=exact(tid.slice(mappingBase.length));if(found.length!==1)throw new Error('mapping_cell_not_unique');return refOf(found[0]);};
            const fields=rows=>rows.map(({cell_tid,rect,...row})=>({...row,cell_ref:cellRef(cell_tid)}));
            const links=rendered.links.map(({source_cell_tid,target_cell_tid,path_index,...link})=>({...link,source_ref:cellRef(source_cell_tid),target_ref:cellRef(target_cell_tid),path_ref:refOf(pathElements[path_index])}));
            Object.assign(mapping,{...rendered,root_ref:refOf(owner),source_rows:fields(rendered.source_rows),target_rows:fields(rendered.target_rows),links});
            delete mapping.reason;delete mapping.owner_tid;
          } else Object.assign(mapping,rendered);
        } catch(error) {if(error?.code==='UI_SCAN_LIMIT')throw error;mapping.reason='mapping_structure_unverifiable';}
      }
    }

    if(wizard.status==='observed' && wizard.stage==='field_parameters') {
      const candidates=[...(tids.get(wizard.root_tid+';EditReformColumnDefForm')??[]),...(tids.get('EditReformColumnDefForm')??[])];
      const visibleWizards=all.filter(e=>{charge();return (getTid(e)??'').endsWith(';WizrdMCF') && visible(e);});
      const forms=candidates.filter(e=>visible(e) && !sensitive(e));
      const portalUnbound=forms.some(e=>getTid(e)==='EditReformColumnDefForm' && (!e.matches('.x-window') || visibleWizards.length!==1 || visibleWizards[0]!==wizardForms[0]));
      const base=forms.length===1?getTid(forms[0]):wizard.root_tid+';EditReformColumnDefForm';
      if(forms.length) {
        wizard.reform_parameters={status:forms.length===1 && !portalUnbound?'observed':'ambiguous',applied_verified:false};
        if(forms.length===1 && !portalUnbound) {
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
          Object.assign(wizard.reform_parameters,{root_ref:refOf(form),root_tid:base,selected_column:selected.length===1?selected[0]:null,fields});
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
        wizardCombos.set(reformParams.root_tid+';cbxDataType',{name:'type_label',scope:'reform_column',
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
          wizard.expression_parameters.options=Object.fromEntries(Object.entries({intermediate:'chbIntermediate',cached:'chbCached'}).map(([name,key])=>{
            const owners=tids.get(base+';'+key)??[],inputs=tids.get(base+';'+key+';InputEl')??[],displays=tids.get(base+';'+key+';DisplayEl')??[];
            const known=owners.length===1 && inputs.length===1 && displays.length===1
              && forms[0].contains(owners[0]) && owners[0].contains(inputs[0]) && owners[0].contains(displays[0])
              && [owners[0],inputs[0],displays[0]].every(e=>visible(e) && !sensitive(e))
              && inputs[0].matches('input.x-form-checkbox') && displays[0].matches('.x-form-checkbox');
            return [name,known?{status:'observed',value:owners[0].classList.contains('x-form-cb-checked'),
              owner_ref:refOf(owners[0]),input_ref:refOf(inputs[0]),display_ref:refOf(displays[0]),enabled:enabled(inputs[0]),
              source:'loginom_ext_checkbox',applied_verified:false}:{status:'unobserved'}];
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
        .sort((a,b)=>{const rank=e=>getTid(e)===workflow?.prefix+';WizrdMCF'?0:wizardCombos.has((getTid(e)??'').replace(/;boundlist$/,'')) && (getTid(e)??'').endsWith(';boundlist')?1:getTid(e)===workflow?.prefix+';FileStorageForm;pnlFileStorage;tbl'?2:(getTid(e)??'').endsWith(';MapTreeForm;tree')?3:4;return rank(a)-rank(b);});
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
    const processConsole={status:'unobserved',top_groups:[],rows:[],top_level_complete:false,
      details_complete:false,execution_verified:false,owner_verified:false};
    const consoles=tids.get('ConsoleForm')??[];
    if(consoles.length===1 && (!requestedRoot || requestedRoot===consoles[0] || requestedRoot.contains(consoles[0]) || getTid(requestedRoot)==='mnContextMenu')) {
      const panel=consoles[0],base='ConsoleForm;ProgressForm;';
      const inside=(e,parent)=>{const b=boxOf(e),p=boxOf(parent);return visible(e) && !sensitive(e)
        && b.x>=0 && b.y>=0 && b.x+b.width<=globalThis.innerWidth && b.y+b.height<=globalThis.innerHeight
        && b.x>=p.x && b.y>=p.y && b.x+b.width<=p.x+p.width && b.y+b.height<=p.y+p.height;};
      const gridLists=['trpProgress;treepanel;tree','trpProgress;grd;tbl'].map(suffix=>tids.get(base+suffix)??[]);
      let valid=inside(panel,panel) && gridLists.every(list=>list.length===1 && panel.contains(list[0]));
      const grids=valid?gridLists.map(list=>list[0]):[],rowSets=[],bounds=[];
      for(const grid of grids) {
        const b={top:grid.scrollTop,left:grid.scrollLeft,height:grid.clientHeight,width:grid.clientWidth,
          scroll_height:grid.scrollHeight,scroll_width:grid.scrollWidth};bounds.push(b);
        const containers=grid.querySelectorAll('.x-grid-item-container');charge();
        if(!inside(grid,panel) || !Object.values(b).every(Number.isFinite) || b.top!==0 || b.left!==0
          || b.height<=0 || b.width<=0 || b.height!==b.scroll_height || b.width!==b.scroll_width
          || containers.length!==1){valid=false;break;}
        const container=containers[0],nativeRows=grid.querySelectorAll('table.x-grid-item');charge();
        const transform=getComputedStyle(container).transform;
        if(!inside(container,grid) || !['none','matrix(1, 0, 0, 1, 0, 0)'].includes(transform)
          || nativeRows.length>30 || nativeRows.length!==container.children.length){valid=false;break;}
        const extras=[...grid.children].filter(e=>e!==container);
        if(extras.length>1 || extras.some(e=>e.tagName!=='DIV' || e.children.length || getTid(e)
          || getComputedStyle(e).display!=='none' || e.style.width!=='1px' || e.style.height!=='1px')){valid=false;break;}
        const rows=[...nativeRows];
        if(rows.some((row,index)=>{charge();return row.parentElement!==container || !inside(row,grid)
          || row.getAttribute('data-recordindex')!==String(index) || row.getAttribute('data-boundview')!==grid.getAttribute('id');})){valid=false;break;}
        rowSets.push(rows);
      }
      if(valid && rowSets.length===2 && rowSets[0].length===rowSets[1].length) {
        const rows=[],seen=new Set(),paths=new Set(),ordinals=[];
        for(let index=0;index<rowSets[0].length;index++) {
          charge();const pair=rowSets.map(list=>list[index]),record=pair[0].getAttribute('data-recordid');
          const left=pair[0].querySelectorAll('td[data-tid]'),right=pair[1].querySelectorAll('td[data-tid]');charge();
          if(!record || seen.has(record) || pair[1].getAttribute('data-recordid')!==record || left.length!==2 || right.length!==8){valid=false;break;}
          const fields={},cells=[...left,...right];let path;
          for(const cell of cells) {
            const match=/^ConsoleForm;ProgressForm;col(Id|Process|Percent|Progress|ActionStop|ActionDelete|ErrorDetails|ProgressStart|ProgressFinish|ProcessTime)_(Root>.+)$/.exec(getTid(cell)??'');
            if(!match || fields[match[1]] || (tids.get(getTid(cell))??[]).length!==1 || !inside(cell,cell.closest('table'))
              || path && path!==match[2]){valid=false;break;}
            path=match[2];fields[match[1]]=cell;
          }
          if(!valid || !path || paths.has(path)){valid=false;break;}
          const ordinal=textOf(fields.Id,true),top=path.split('>').length===2;
          if(!/^[1-9][0-9]*(?:\.[1-9][0-9]*)*$/.test(ordinal) || top!==!ordinal.includes('.')
            || !top && !paths.has(path.slice(0,path.lastIndexOf('>')))){valid=false;break;}
          if(top)ordinals.push(Number(ordinal));
          const states=(fields.Progress.getAttribute('class')??'').split(/\s+/).filter(c=>c.startsWith('bg-progress-ptps'));
          const finish=textOf(fields.ProgressFinish,true),start=textOf(fields.ProgressStart,true),error=textOf(fields.ErrorDetails,true);
          const completed=states.length===1 && states[0]==='bg-progress-ptpsCompleted' && finish.length>0 && error.length===0;
          rows.push({record_id:record,path,ordinal,process_cell_ref:refOf(fields.Process),selected:pair[0].classList.contains('x-grid-item-selected'),
            rendered_state:completed?'completed':'unknown',start,finish,error_present:error.length>0});seen.add(record);paths.add(path);
        }
        if(valid && ordinals.every((n,i)=>Number.isSafeInteger(n) && (!i || n>ordinals[i-1]))) {
          const menu=document.querySelectorAll('[data-tid="mnContextMenu;mniShowCompletedProcesses"]');charge();
          const filter=menu.length===1 && inside(menu[0],menu[0])?{status:'observed',checked:menu[0].classList.contains('x-menu-item-checked'),owner_ref:refOf(menu[0])}:{status:'unobserved',checked:null};
          Object.assign(processConsole,{status:'rendered_process_inventory',panel_ref:refOf(panel),grid_refs:grids.map(refOf),
            grid_ids:grids.map(g=>g.getAttribute('id')),grid_bounds:bounds,rows,top_groups:rows.filter(r=>!r.ordinal.includes('.')).map(r=>r.record_id),state_source:'native_progress_cell_class',show_completed:filter,
            top_level_rendered_coverage:true,top_level_complete:filter.status==='observed' && filter.checked});
        }
      }
    }
    const processCells=new Map(processConsole.status==='rendered_process_inventory'
      ? processConsole.rows.map((row,index)=>[row.process_cell_ref,{record_id:row.record_id,path:row.path,
        record_index:index,panel_ref:processConsole.panel_ref,grid_ids:processConsole.grid_ids}]) : []);
    const processMenuControls=new Map();
    const menus=tids.get('mnContextMenu')??[];
    const selectedProcesses=processConsole.rows.filter(row=>row.selected);
    if(menus.length===1 && visible(menus[0]) && processConsole.status==='rendered_process_inventory' && selectedProcesses.length===1
      && ['mniShowNodeToProcess','mniShowCompletedProcesses'].every(name=>(tids.get('mnContextMenu;'+name)??[]).length===1)) {
      for(const action of ['mniShowNodeToProcess','mniShowCompletedProcesses']) {
        const tid='mnContextMenu;'+action,items=tids.get(tid)??[];
        if(items.length===1 && menus[0].contains(items[0]) && visible(items[0]))processMenuControls.set(refOf(items[0]),{
          action,menu_ref:refOf(menus[0]),process:processCells.get(selectedProcesses[0].process_cell_ref),opening_verified:false});
      }
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
    // The rendered grouping parser has already bound each actual cell to a
    // unique wizard-owned grid, data row and closed section. Metadata refs
    // alone never create actionable records; candidates below must include
    // the same live DOM element and pass native identity/interaction guards.
    const groupingCells=new Map(wizard.grouping?.status==='rendered_grouping_rows'
      ? [...wizard.grouping.keys,...wizard.grouping.measures].map(field=>[field.cell_ref,{
        field_key:field.field_key,row_ref:field.row_ref,section_ref:field.section_ref,
        role:wizard.grouping.keys.includes(field)?'group':'measure',
        grid_ref:wizard.grouping.grid_ref,wizard_root_ref:wizard.root_ref}]) : []);
    for(const field of wizard.grouping?.available_fields??[])groupingCells.set(field.cell_ref,{
      field_key:field.field_key,row_ref:field.row_ref,grid_ref:field.grid_ref,role:'available',wizard_root_ref:wizard.root_ref});
    const interesting = element => processCells.has(state.ids.get(element)) || processMenuControls.has(state.ids.get(element)) || groupingCells.has(state.ids.get(element)) || !!comboPart(element) || importColumnCellRefs.has(state.ids.get(element)) || element.matches('button,input,textarea,select,[contenteditable="true"],[role="button"],[role="checkbox"],[role="radio"],[role="combobox"],[role="menuitem"],[role="tab"],[role="treeitem"],[role="option"],[role="spinbutton"]')
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
    const controls = candidates.filter(interesting)
      // Loginom draws anonymous canvas geometry with repeated Graph;Vertex
      // tids even in an empty draft. It is not a node or an actionable target.
      // Preserve a real uniquely labelled node whose actual name is Vertex.
      .filter(element=>!ownedGraph(element) || getTid(element)!==graphPrefix+'Vertex' || graphNodeOf(element))
      .filter(element=>!element.closest('[data-tid="mnContextMenu"]') || processMenuControls.has(state.ids.get(element))).filter(element=>!selectedRoot || selectedRoot===element || selectedRoot.contains(element))
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
      const groupingField=groupingCells.get(state.ids.get(element));
      const processRow=processCells.get(state.ids.get(element)),processMenu=processMenuControls.get(state.ids.get(element));
      const wizardStep=wizard.status==='observed' && wizard.stage && ['btnNext','btnPrev'].some(name=>tid===wizard.root_tid+';'+name)
        && wizard.controls[tid.split(';').at(-1)]?.status==='observed'
        ? {direction:tid.endsWith(';btnNext')?'next':'previous',root_ref:wizard.root_ref,stage:wizard.stage}:null;
      const openWizard=wizard.status==='absent' && navigationContext.status==='observed' && graphNodeOf(element)?.part==='settings'
        ? {node:graphNodeOf(element),workflow_path:navigationContext.path}:null;
      const inputPortFinishReady=wizard.stage==='input_mapping' && wizard.input_port_context?.status==='observed'
        && wizard.input_port_context.direction==='input' && wizard.input_mapping?.status==='rendered_mapping_links'
        && wizard.input_mapping.root_ref===wizard.root_ref && wizard.input_mapping.rendered_coverage?.status==='complete_visible_rows'
        && wizard.input_mapping.source_rows?.length===wizard.input_mapping.rendered_coverage.source_count
        && wizard.input_mapping.target_rows?.length===wizard.input_mapping.rendered_coverage.target_count
        && wizard.input_mapping.links?.length===wizard.input_mapping.rendered_coverage.link_count;
      const outputPortFinishReady=wizard.stage==='output_mapping' && wizard.port_context?.status==='observed'
        && wizard.port_context.kind==='output_data' && wizard.output_columns?.status==='rendered_rows'
        && wizard.output_columns.definition_coverage?.status==='complete_configured_rows'
        && wizard.output_columns.fields?.length===wizard.output_columns.definition_coverage.count
        && wizard.output_columns.auto_sync?.status==='observed';
      const finishWizard=tid===wizard.root_tid+';btnDone' && wizard.stage==='done' && wizard.completion?.ready && wizard.owner_context?.status==='observed'
        ? {root_ref:wizard.root_ref,owner:wizard.owner_context,completion:wizard.completion}
        : tid===wizard.root_tid+';btnDone' && wizard.controls.btnDone?.status==='observed' && inputPortFinishReady
          ? {mode:'input_port',root_ref:wizard.root_ref,node_ref:wizard.input_port_context.node.ref,port_ref:wizard.input_port_context.port_ref}
          : tid===wizard.root_tid+';btnDone' && wizard.controls.btnDone?.status==='observed' && outputPortFinishReady
            ? {mode:'output_port',root_ref:wizard.root_ref,node_ref:wizard.port_context.node.ref,port_ref:wizard.port_context.port.ref}:null;
      const reformColumn=wizard.stage==='field_parameters',column=reformColumn?wizard.reform_parameters:wizard.column_parameters;
      const columnReady=column?.status==='observed' && column.selected_column?.data_kind && column.selected_column?.usage
        && (!reformColumn || column.selected_column.caching && typeof column.selected_column.excluded==='boolean')
        && Object.values(column.fields??{}).length===(reformColumn?7:5) && Object.values(column.fields).every(f=>f.status==='observed' && !f.truncated);
      const columnForm=reformColumn?'EditReformColumnDefForm':'EditColumnDefForm';
      const columnBase=reformColumn?column?.root_tid:wizard.root_tid+';'+columnForm;
      const columnClose=columnReady && [columnBase+';btnApply',columnBase+';btnCancel'].includes(tid)
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
      // A name-cell read does not include its sibling type in `tids`.
      // Read only that row's metadata; do not issue sibling action refs.
      const storageTypes=storageRow ? [...storageRow.querySelectorAll('[data-tid]')].filter(other=>{charge();return getTid(other)===tid.replace(';colName_',';colFileType_')
        && other.closest('.x-grid-item')===storageRow && visible(other) && !sensitive(other);}) : [];
      const storageEntry=storageRow ? {row_ref:refOf(storageRow),selected:storageRow.classList.contains('x-grid-item-selected'),
        kind:storageTypes.length===1 && textOf(storageTypes[0],true)==='Папка' ? 'folder':'unknown'} : null;
      return { ref: refOf(element), tid, identity, kind, role, label:label || (combo?.kind==='picker' && combo.field.scope==='import_column'
        ? 'Открыть список: '+(combo.field.name==='type'?'Тип данных':'Вид данных'):''), scope: scopeOf(element), ...fieldValue,
        ...(processRow?{process_row:processRow}:{}),...(processMenu?{process_menu:processMenu}:{}),
        ...(groupingField ? {grouping_field:groupingField} : {}),
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
        signature: { tag, tid, role, type: element.getAttribute('type'), name: element.getAttribute('name'), label, ...fieldValue, dialog_ref: dialogRef(element), scroll, check_state:checkState, ...(groupingField?{grouping_field:groupingField}:{}),...(processRow?{process_row:processRow}:{}),...(processMenu?{process_menu:processMenu}:{}) },
        enabled: isEnabled, visible: true, interaction, bounding_box: boxOf(element),
        // A bounded prefix is not a sufficient value precondition. A dedicated
        // large-field driver must establish its own complete read/write contract.
        allowed_actions: processRow || processMenu ? (allowed && interaction.state==='point_observed' ? (processRow?['click','right_click','press']:['click','press']) : []) : groupingField ? (allowed && interaction.state==='point_observed' ? ['click','double_click','press'] : []) : expressionWritable ? ['replace_expression'] : allowed && !valueTruncated ? ['click', 'double_click', 'right_click', 'press', 'drag', ...(editable ? ['fill',...(wizardFields.has(element)?['set_wizard_field']:[])] : []), ...(checkState ? ['set_checked'] : []), ...(wizardStep?['wizard_step']:[]), ...(openWizard?['open_wizard']:[]), ...(finishWizard?['finish_wizard']:[]), ...(columnClose?[columnClose.mode+'_'+columnClose.scope+'_column']:[]), ...(expressionApply?['apply_expression_parameters']:[]), ...(expressionCancel?['cancel_expression_parameters']:[]), ...(combo?.kind==='option'?['select_wizard_option']:[]), ...(scroll && interaction.state === 'point_observed' ? ['scroll'] : [])] : [] };
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
      const tid=getTid(owner),match=/^(MF;TF(?:-\d+)?;(?:ModelForm;(?:PreviewWindow;)?PreviewForm;DataSetForm|ViewsForm;BrowseView(?:-[1-9][0-9]*)?));normalHeaderCt;([^;]+)$/.exec(tid??'');
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
    // Candidate: observed Table settings only, never result/execution acceptance.
    let tableSettings={status:'unobserved',settings_applied:false,result_complete:false,execution_verified:false};
    if(workflow) {
      const viewPattern=new RegExp('^'+workflow.prefix+';ViewsForm;BrowseView(?:-\\d+)?$');
      const onScreen=element=>{
        if(!visible(element) || sensitive(element))return false;
        const b=boxOf(element),w=globalThis.innerWidth,h=globalThis.innerHeight;
        return [b.x,b.y,b.width,b.height,w,h].every(Number.isFinite) && b.width>0 && b.height>0
          && b.x>=0 && b.y>=0 && b.x+b.width<=w && b.y+b.height<=h;
      };
      const views=all.filter(e=>{charge();return viewPattern.test(getTid(e)??'') && onScreen(e);});
      if(views.length===1) {
        const view=views[0],viewKey=getTid(view);
        const modalNames=['BrowseFormat','BrowseFilter'];
        const modals=all.filter(e=>{charge();return modalNames.some(name=>getTid(e)===viewKey+';ModalWindow_'+name)
          && onScreen(e) && (!selectedRoot || selectedRoot===e || selectedRoot.contains(e));});
        if(modals.length===1 && !masks.length && !dialogElements.some(e=>e!==modals[0] && !e.contains(modals[0]) && !modals[0].contains(e))) {
          const modal=modals[0],kind=getTid(modal).endsWith('_BrowseFormat')?'format':'filter';
          const base=getTid(modal)+';'+(kind==='format'?'BrowseFormat':'BrowseFilter')+';';
          const unique=tid=>{const found=(tids.get(tid)??[]).filter(e=>modal.contains(e));return found.length===1 && visible(found[0]) && !sensitive(found[0])?found[0]:null;};
          const input=key=>{
            const owner=unique(base+key),inputs=owner?dom.filter(e=>{charge();return owner.contains(e) && e.matches('input') && visible(e) && !sensitive(e);}):[];
            if(inputs.length!==1)return {status:'unobserved'};
            const value=String(inputs[0].value??'');
            return {status:value.length<240?'observed':'truncated',value:value.slice(0,240),enabled:enabled(inputs[0]),input_ref:refOf(inputs[0])};
          };
          const checked=key=>{
            const owner=unique(base+key),display=unique(base+key+';DisplayEl');
            if(!owner)return {status:'unobserved'};
            let painted=display,part='display';
            if(!painted && key==='BrowseFormatPanel;cntFormat;cnt-1;chb') {
              const displays=(tids.get(base+key+';DisplayEl')??[]).filter(e=>modal.contains(e));
              const input=unique(base+key+';InputEl'),empty=displays.length===1?displays[0]:null;
              const box=empty?boxOf(empty):null,style=empty?getComputedStyle(empty):null;
              // Native Format parent checkbox uses a painted Ext button while
              // its single inline DisplayEl has no box. Never use .checked.
              if(empty && owner.contains(empty) && !sensitive(empty) && empty.matches('span.x-form-checkbox')
                && box.width===0 && box.height===0 && style.display==='inline' && style.visibility==='visible' && style.opacity!=='0'
                && input && owner.contains(input) && onScreen(input) && input.matches('input.x-form-checkbox[type="button"][role="checkbox"]')) {
                painted=input;part='input';
              }
            }
            if(!painted || !owner.contains(painted))return {status:'unobserved'};
            const state=checkStateOf(painted);
            return state?.source==='loginom_ext' && state.kind==='checkbox' && !state.indeterminate
              ?{status:'observed',value:state.checked,enabled:enabled(painted),owner_ref:refOf(owner),
                state_source:'loginom_ext',...(part==='input'?{input_ref:refOf(painted)}:{display_ref:refOf(painted)})}:{status:'unobserved'};
          };
          const bounds=grid=>{
            if(!grid || !onScreen(grid))return null;
            const rows=dom.filter(e=>{charge();return grid.contains(e) && e.matches('table.x-grid-item');});
            const containers=dom.filter(e=>{charge();return grid.contains(e) && e.matches('.x-grid-item-container');});
            const dims=[grid.clientWidth,grid.clientHeight,grid.scrollWidth,grid.scrollHeight,grid.scrollLeft,grid.scrollTop];
            if(rows.length>16 || containers.length!==1 || dims.some(n=>!Number.isFinite(n)) || grid.clientWidth<=0 || grid.clientHeight<=0
              || grid.scrollWidth>grid.clientWidth || grid.scrollHeight>grid.clientHeight || grid.scrollLeft!==0 || grid.scrollTop!==0)return null;
            const container=containers[0],box=boxOf(grid),inside=e=>{const b=boxOf(e);return onScreen(e)&&b.x>=box.x&&b.y>=box.y&&b.x+b.width<=box.x+box.width&&b.y+b.height<=box.y+box.height;};
            const cb=boxOf(container),emptyContainer=rows.length===0 && container.isConnected && !sensitive(container)
              && getComputedStyle(container).display!=='none' && getComputedStyle(container).visibility!=='hidden'
              && [cb.x,cb.y,cb.width,cb.height].every(Number.isFinite) && cb.height===0 && cb.width>0
              && cb.x>=box.x && cb.y>=box.y && cb.x+cb.width<=box.x+box.width && cb.y<=box.y+box.height;
            const extras=[...grid.children].filter(e=>e!==container);
            const sentinel=extras.length<=1 && extras.every(e=>e.tagName==='DIV' && e.children.length===0 && !getTid(e)
              && getComputedStyle(e).display==='none' && e.getAttribute('role')==='presentation'
              && e.style.width==='1px' && e.style.height==='1px');
            const transform=getComputedStyle(container).transform;
            if(!(inside(container)||emptyContainer) || container.children.length!==rows.length || [...container.children].some(e=>!rows.includes(e))
              || !sentinel || !['none','matrix(1, 0, 0, 1, 0, 0)','matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'].includes(transform))return null;
            const id=grid.getAttribute('id');
            if(!id || rows.some((r,i)=>r.parentElement!==container || !inside(r) || r.getAttribute('data-boundview')!==id
              || r.getAttribute('data-recordindex')!==String(i)))return null;
            return {rows,grid_ref:refOf(grid),container_ref:refOf(container)};
          };
          tableSettings={...tableSettings,status:'observed',kind,view_key:viewKey,view_ref:refOf(view),modal_ref:refOf(modal),owner_binding:'observed_view_only'};
          if(kind==='filter') {
            const grid=unique(base+'tbl'),coverage=bounds(grid);
            tableSettings.filter={enabled:checked('chkEnableFilter'),predicate_coverage:coverage?.rows.length===0?'complete_empty':'partial',
              predicates_complete:coverage?.rows.length===0,effective_filter_verified:false,
              ...(coverage?{rendered_row_count:coverage.rows.length,grid_ref:coverage.grid_ref,container_ref:coverage.container_ref}:{})};
          } else {
            const labelCells=all.filter(e=>{charge();return (getTid(e)??'').startsWith(base+'colDisplayName_') && modal.contains(e);});
            const rows=[...new Set(labelCells.map(e=>e.closest('table')).filter(Boolean))];
            const grid=unique(base+'grdFields;tbl');
            const coverage=bounds(grid),filter=input('txtColumnsFilterField');
            const fields=labelCells.slice(0,16).map(cell=>{
              const key=getTid(cell).slice((base+'colDisplayName_').length),row=cell.closest('table');
              const index=unique(base+'colSourceColumnIndex_'+key),visibility=unique(base+'colInAll_'+key);
              const icons=dom.filter(e=>{charge();return cell.contains(e) && /bg-TBGDataType-dt/.test(e.getAttribute('class')??'');});
              const types=Object.entries({String:'string',Integer:'integer',Float:'real',Boolean:'boolean',DateTime:'datetime',Variant:'variant'})
                .filter(([name])=>icons.length===1 && icons[0].classList.contains('bg-TBGDataType-dt'+name));
              const eye=visibility?dom.filter(e=>{charge();return visibility.contains(e) && (e.classList.contains('bg-icon-visible')||e.classList.contains('bg-icon-invisible'));}):[];
              const value=index?textOf(index,true):'',label=textOf(cell,true);
              if(!row || !onScreen(cell) || !index || !visibility || !onScreen(index) || !onScreen(visibility) || index.closest('table')!==row || visibility.closest('table')!==row
                || !/^\d+$/.test(value) || Number(value)>100000 || !key || key.length>=240 || label.length>=240 || types.length!==1
                || !visible(icons[0]))return {status:'ambiguous'};
              // Ext hides nonselected eye icons with opacity:0. That leaves
              // schema observable, but supplies no painted visibility state.
              const visibilityObserved=eye.length===1 && onScreen(eye[0])
                && eye[0].classList.contains('bg-icon-visible')!==eye[0].classList.contains('bg-icon-invisible');
              return {status:'observed',name_key:key,source_index:Number(value),label,type:types[0][1],visible:visibilityObserved?eye[0].classList.contains('bg-icon-visible'):null,
                visibility_status:visibilityObserved?'observed':'unobserved',visibility_cell_ref:refOf(visibility),
                ...(visibilityObserved?{visibility_icon_ref:refOf(eye[0])}:{}),selected:row.classList.contains('x-grid-item-selected'),row_ref:refOf(row),label_ref:refOf(cell)};
            });
            const valid=coverage && coverage.rows.length>0 && fields.length===coverage.rows.length && labelCells.length===fields.length
              && fields.every(f=>f.status==='observed') && new Set(fields.map(f=>f.name_key)).size===fields.length
              && new Set(fields.map(f=>f.source_index)).size===fields.length && fields.every(f=>f.source_index<fields.length)
              && filter.status==='observed' && filter.value===''
              && !dom.some(e=>{charge();return modal.contains(e) && /celleditor|EditColumnDefForm/.test(getTid(e)??'') && visible(e);});
            tableSettings.format={fields,fieldlist_complete:!!valid,visibility_complete:!!valid && fields.every(f=>f.visibility_status==='observed'),filter,source_identity_verified:false};
            const selected=fields.filter(f=>f.status==='observed' && f.selected);
            if(valid && selected.length===1 && ['integer','real'].includes(selected[0].type)) {
              tableSettings.format.selected_numeric={name_key:selected[0].name_key,source_index:selected[0].source_index,
                formatting:checked('BrowseFormatPanel;cntFormat;cnt-1;chb'),custom:checked('BrowseFormatPanel;cbFormatStr'),
                thousands:checked('BrowseFormatPanel;cbThousand'),scientific:checked('BrowseFormatPanel;cbScientific'),
                decimal_digits:input('BrowseFormatPanel;edtDecimalDigit'),currency:input('BrowseFormatPanel;edtCurrency'),
                format_string:input('BrowseFormatPanel;edtFormatStr'),losslessness_verified:false};
            }
          }
        }
      }
    }
    // Small rendered Table evidence. These facts do not attest execution or
    // source ownership; the independent verifier must bind the opening gesture.
    const tableCoverage={status:'unobserved',complete_result_verified:false};
    if(workflow) {
      const viewPattern=new RegExp('^'+workflow.prefix+';ViewsForm;BrowseView(?:-[1-9][0-9]*)?$');
      const inside=(e,parent)=>{
        if(!visible(e)||sensitive(e))return false;
        const b=boxOf(e),p=boxOf(parent);
        return [b.x,b.y,b.width,b.height,p.x,p.y,p.width,p.height].every(Number.isFinite)
          &&b.width>0&&b.height>0&&b.x>=0&&b.y>=0&&b.x+b.width<=globalThis.innerWidth&&b.y+b.height<=globalThis.innerHeight
          &&b.x>=p.x&&b.y>=p.y&&b.x+b.width<=p.x+p.width&&b.y+b.height<=p.y+p.height;
      };
      const views=all.filter(e=>{charge();return viewPattern.test(getTid(e)??'')&&inside(e,e);});
      if(views.length===1) {
        const view=views[0],key=getTid(view),one=tid=>{const es=tids.get(tid)??[];return es.length===1?es[0]:null;};
        Object.assign(tableCoverage,{status:'observed_view',view_key:key,view_ref:refOf(view)});
        const nulls=one(key+';btnDataGridShowNulls');
        if(nulls&&inside(nulls,view))tableCoverage.null_display={status:'observed',enabled:nulls.classList.contains('x-btn-pressed'),control_ref:refOf(nulls),state_source:'ext_pressed_class'};
        const modal=one(key+';ModalWindow_BrowseGoToLine'),range=one(key+';ModalWindow_BrowseGoToLine;BrowseGoToLine;lblRowsRange');
        if(modal&&range&&modal.contains(range)&&inside(modal,modal)&&inside(range,modal)) {
          const literal=textOf(range,true),match=/^Номер строки \(1 - ([1-9][0-9]*)\):$/.exec(literal);
          if(match&&Number.isSafeInteger(Number(match[1])))tableCoverage.row_range={status:'observed',first:1,last:Number(match[1]),literal,modal_ref:refOf(modal),label_ref:refOf(range),source_total_verified:false};
        }
        const menu=one('mnContextData');
        if(menu&&inside(menu,menu)) {
          const names=['btnFirstPage','btnPrevPage','btnNextPage','btnLastPage'],items=names.map(n=>one('mnContextData;'+n));
          if(items.every(e=>e&&menu.contains(e)&&inside(e,menu)))tableCoverage.pagination={status:'observed_menu',menu_ref:refOf(menu),opening_verified:false,
            controls:items.map((e,i)=>({name:names[i],ref:refOf(e),enabled:enabled(e)}))};
        }
        const grids=['grd','grd-1'].map(n=>one(key+';grdData;'+n+';tbl'));
        const inventories=[];
        let valid=grids.every(g=>g&&view.contains(g)&&inside(g,view));
        for(const grid of valid?grids:[]) {
          charge();const bounds={top:grid.scrollTop,left:grid.scrollLeft,height:grid.clientHeight,width:grid.clientWidth,scroll_height:grid.scrollHeight,scroll_width:grid.scrollWidth};
          const containers=grid.querySelectorAll('.x-grid-item-container'),rows=[...grid.querySelectorAll('table.x-grid-item')];charge();
          if(Object.values(bounds).some(n=>!Number.isFinite(n))||bounds.top!==0||bounds.left!==0||bounds.height<=0||bounds.width<=0
            ||bounds.height!==bounds.scroll_height||bounds.width!==bounds.scroll_width||containers.length!==1||rows.length>16){valid=false;break;}
          const container=containers[0],extras=[...grid.children].filter(e=>e!==container),id=grid.getAttribute('id');
          if(!id||!inside(container,grid)||!['none','matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(container).transform)
            ||container.children.length!==rows.length||extras.length>1||extras.some(e=>e.tagName!=='DIV'||e.children.length||getTid(e)
              ||getComputedStyle(e).display!=='none'||e.getAttribute('role')!=='presentation'||e.style.width!=='1px'||e.style.height!=='1px')){valid=false;break;}
          const records=rows.map((r,i)=>{charge();return {index:r.getAttribute('data-recordindex'),record_id:r.getAttribute('data-recordid'),ref:refOf(r),valid:r.parentElement===container&&inside(r,grid)&&r.getAttribute('data-boundview')===id&&r.getAttribute('data-recordindex')===String(i)};});
          if(records.some(r=>!r.valid||!r.record_id)||new Set(records.map(r=>r.record_id)).size!==records.length){valid=false;break;}
          inventories.push({grid_ref:refOf(grid),container_ref:refOf(container),bounds,records:records.map(({valid,...r})=>r)});
        }
        if(valid&&inventories.length===2&&inventories[0].records.length===inventories[1].records.length
          &&inventories[0].records.every((r,i)=>r.record_id===inventories[1].records[i].record_id)) {
          tableCoverage.rendered_rows={status:'bounded_unscrolled_inventory',count:inventories[0].records.length,grids:inventories,source_total_verified:false};
        }
      }
    }

    // Metadata refs are not issued controls. Admit only the same bounded live
    // Table label cell, with its typed owner/schema identity frozen in signature.
    if(tableSettings.format?.fieldlist_complete) {
      for(const field of tableSettings.format.fields) {
        const matches=candidates.filter(e=>{charge();return state.ids.get(e)===field.label_ref;});
        if(matches.length!==1)continue;
        const issuedIndex=elements.findIndex(e=>e.ref===field.label_ref);
        const element=matches[0];
        if(selectedRoot && selectedRoot!==element && !selectedRoot.contains(element))continue;
        if(!controls.includes(element))controls.push(element);
        if(issuedIndex<0 && elements.length>=240)continue;
        const identity=identityOf(element),tid=getTid(element),tag=element.tagName.toLowerCase();
        const interaction=interactionOf(element),isEnabled=enabled(element);
        const tableField={view_key:tableSettings.view_key,view_ref:tableSettings.view_ref,modal_ref:tableSettings.modal_ref,
          name_key:field.name_key,source_index:field.source_index,type:field.type,row_ref:field.row_ref};
        const signature={tag,tid,role:element.getAttribute('role'),type:element.getAttribute('type'),name:element.getAttribute('name'),
          label:field.label,dialog_ref:dialogRef(element),table_field:tableField};
        const issued={ref:field.label_ref,tid,identity,kind:'control',role:signature.role,label:field.label,scope:scopeOf(element),
          table_field:tableField,signature,enabled:isEnabled,visible:true,interaction,bounding_box:boxOf(element),
          allowed_actions:identity && isEnabled && !dangerous(element) && interaction.state==='point_observed'?['click','press']:[]};
        if(issuedIndex>=0)elements[issuedIndex]=issued;else elements.push(issued);
      }
    }
    return { origin: location.origin, authenticated: !!tids.get('MF;cntMain;tlbMainToolbar;btnAvatar')?.some(visible), loginom_build: globalThis.bg?.app?.Version ?? null,
      workflow_ref: workflow, graph_identity:graphIdentity, active_tab_ref:active?refOf(active):null, active_identity: active ? textOf(active) : null, package_identity: packageIdentity,
      file_storage:fileStorage,wizard,navigation_context:navigationContext,node_context:nodeContext,table_settings:tableSettings,table_coverage:tableCoverage,process_console:processConsole,
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
        const lifecycleContextMatches=fresh=>fresh.authenticated && fresh.origin===current.origin && fresh.loginom_build===current.loginom_build
          && same(fresh.workflow_ref,current.workflow_ref) && same(fresh.package_identity,current.package_identity)
          && fresh.active_tab_ref===current.active_tab_ref && !!current.active_tab_ref
          && !!current.dom_epoch?.document && fresh.dom_epoch?.document===current.dom_epoch.document && fresh.ui.dialogs.length===0;
        let staleOpeningRoots=0;
        const readOpeningUi=async()=>{
          for(;;) {
            const roots=await readUi(true);
            // Roots discovery intentionally omits package/tab identity and
            // detailed blockers. Check its available context now; require the
            // full context and typed owner verification on the detailed read.
            if(!roots.authenticated || roots.origin!==current.origin || roots.loginom_build!==current.loginom_build
              || !same(roots.workflow_ref,current.workflow_ref) || !current.dom_epoch?.document
              || roots.dom_epoch?.document!==current.dom_epoch.document)
              fail('WIZARD_CONTEXT_CHANGED','The original document and workspace were not preserved after the wizard gesture');
            postActionRoot=roots.wizard?.root_ref ?? roots.ui.elements.find(e=>e.tid===current.workflow_ref.prefix+';ModelForm;cmpDiagram')?.ref ?? roots.ui.elements.find(e=>e.scope==='dialog')?.ref ?? roots.ui.elements[0]?.ref;
            if(!postActionRoot)fail('WIZARD_OPEN_NOT_CONFIRMED','No current region was available after opening settings');
            try {
              const fresh=await readUi();
              if(!lifecycleContextMatches(fresh))fail('WIZARD_CONTEXT_CHANGED','The original document and workspace changed while reading the wizard region');
              return fresh;
            } catch(error) {
              // The one completed click can replace cmpDiagram with WizrdMCF
              // between discovery and detail. Rediscover only that detached
              // post-gesture region; never repeat the gesture or relax guards.
              if(error?.code!=='UI_ROOT_STALE' || !effectPossible || staleOpeningRoots>=3)throw error;
              staleOpeningRoots++;
              record('wizard_region_rediscovery',{reason:'UI_ROOT_STALE',attempt:staleOpeningRoots});
              timeout();await page.waitForTimeout(Math.min(100,timeout()));
            }
          }
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
          const contextMatches=lifecycleContextMatches;
          const inputPort=finish.mode==='input_port',outputPort=finish.mode==='output_port',port=inputPort||outputPort;
          const finishOwner=inputPort?current.wizard.input_port_context:outputPort?current.wizard.port_context:finish.owner;
          const expectedLabel=port?finishOwner.node.label:finish.completion.fields.label.value;
          const workflowPath=(inputPort?finishOwner.node_path.slice(0,-1):outputPort?finishOwner.path.slice(0,-4):finishOwner.path.slice(0,-2)).map(({tid,label})=>({tid,label}));
          const targetNode=fresh=>{
            const expected=expectedLabel;
            // E2E Format maps whitespace to underscores and removes commas.
            // Wrapped SVG labels may lose whitespace at BR boundaries, so
            // require both the exact native key and rendered punctuation.
            const key=expected.replace(/\s/g,'_').replace(/,/g,'');
            const labels=fresh.ui.elements.filter(e=>e.graph_node?.part==='label'
              && e.graph_node.node_label===key && typeof e.graph_node.label_text==='string'
              && e.graph_node.label_text.replace(/\s/g,'')===expected.replace(/\s/g,''));
            if(labels.length!==1)return null;
            const bodies=fresh.ui.elements.filter(e=>e.graph_node?.part==='body' && e.graph_node.node_label===key);
            return bodies.length===1?bodies[0]:null;
          };
          for(let attempt=0;attempt<24 && contextMatches(observed) && (observed.wizard.status!=='absent' || observed.ui.masks.length || !targetNode(observed));attempt++) {
            timeout();await page.waitForTimeout(Math.min(200,timeout()));observed=await readOpeningUi();
          }
          const ready=fresh=>contextMatches(fresh) && !fresh.ui.masks.length && fresh.wizard.status==='absent' && !!targetNode(fresh)
            && fresh.navigation_context?.status==='observed'
            && same(fresh.navigation_context.path,workflowPath);
          if(!ready(observed))
            fail('WIZARD_FINISH_NOT_CONFIRMED','The expected node and workflow were not confirmed after one Done click; inspect before retry');
          // Live finish can replace the newly painted graph body after the
          // first success. Issue only the final quiet snapshot, not its stale
          // predecessor; a replacement restarts settling without another click.
          const stamp=fresh=>({epoch:fresh.dom_epoch,node_ref:targetNode(fresh)?.ref,
            label_ref:fresh.ui.elements.find(e=>e.graph_node?.part==='label'
              && e.graph_node.node_label===targetNode(fresh)?.graph_node.node_label)?.ref});
          let quietSamples=0;
          for(let attempt=0;attempt<12 && quietSamples<3;attempt++) {
            timeout();await page.waitForTimeout(Math.min(200,timeout()));
            const fresh=await readOpeningUi();
            if(!ready(fresh))fail('WIZARD_FINISH_NOT_CONFIRMED','The destination changed while settling after one Done click; inspect before retry');
            quietSamples=same(stamp(fresh),stamp(observed))?quietSamples+1:0;
            observed=fresh;
          }
          if(quietSamples<3)fail('WIZARD_FINISH_NOT_SETTLED','The graph kept changing after one Done click; observe before continuing');
          const node=targetNode(observed);
          record(port?(inputPort?'input_port_finish_settled':'output_port_finish_settled'):'wizard_finish_settled',{quiet_samples:quietSamples,interval_ms:200,dom_epoch:observed.dom_epoch,node_ref:node.ref});
          if(port)record(inputPort?'input_port_finish_verified':'output_port_finish_verified',{wizard_root_ref:finish.root_ref,control_ref:task.action.ref,
            port_path:inputPort?finishOwner.port_path:finishOwner.path.slice(0,-1).map(({tid,label})=>({tid,label})),node:node.graph_node,node_ref:node.ref,workflow_path:workflowPath,
            reopen_required:true,settings_readback_verified:false,settings_applied:false,source_identity_verified:false,package_saved:false});
          else record('wizard_finish_graph_verified',{previous_owner:finish.owner.node,node:node.graph_node,node_ref:node.ref,
            label:finish.completion.fields.label.value,reopen_required:true,settings_readback_verified:false,package_saved:false});
        }
        if(task.action.verb==='open_wizard') {
          const opening=current.ui.elements.find(e=>e.ref===task.action.ref).wizard_open;
          const contextMatches=lifecycleContextMatches;
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
          // A native stage can become visible before delayed tooltip/layout work
          // finishes. Keep the same single click, but capture a quiet epoch before
          // handing out pages; never ignore mutations or revive stale cursors.
          let quietSamples=0;
          for(let attempt=0;attempt<12 && quietSamples<3;attempt++) {
            timeout();await page.waitForTimeout(Math.min(200,timeout()));
            const fresh=await readUi();
            if(!unchangedContext(fresh) || fresh.ui.masks.length || fresh.wizard.stage!==task.action.expected_stage)
              fail('WIZARD_STEP_NOT_CONFIRMED','The destination changed while settling after one click; inspect before retry');
            quietSamples=same(fresh.dom_epoch,observed.dom_epoch)?quietSamples+1:0;
            observed=fresh;
          }
          if(quietSamples<3)fail('WIZARD_STEP_NOT_SETTLED','The destination kept changing after one click; observe the current wizard before continuing');
          record('wizard_step_settled',{quiet_samples:quietSamples,interval_ms:200,dom_epoch:observed.dom_epoch});
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

export function makeWorkspaceUiCode(options, { snapshotArgument = false } = {}) {
  if (!options || !['observe', 'act'].includes(options.mode)) throw new Error('Workspace UI mode must be observe or act');
  if (options.mode === 'act') validateUiAction(options.action, options.snapshot);
  const task = { ...structuredClone(options), kind: 'workspace-ui' };
  // Trusted composite operations may supply their own fresh native read after
  // a bounded preparatory gesture. This is not a public tool parameter.
  if(snapshotArgument)return `async (page, snapshot) => (${workspaceUiCapability.toString()})(page, {...${JSON.stringify(task)},snapshot})`;
  return `async (page) => (${workspaceUiCapability.toString()})(page, ${JSON.stringify(task)})`;
}
