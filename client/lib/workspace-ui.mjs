// The model receives opaque observed references, never executable selectors or
// browser code. All browser-side inspection and gestures below are client-pinned.
export const uiActionSchema = {
  type: 'object', additionalProperties: false, required: ['verb'],
  properties: {
    verb: { type: 'string', enum: ['click', 'double_click', 'fill', 'press', 'drag', 'scroll', 'set_checked'] },
    checked: { type: 'boolean' },
    delta_y: { type: 'integer', minimum: -1000, maximum: 1000 },
    ref: { type: 'string', maxLength: 128 }, text: { type: 'string', maxLength: 2048 },
    key: { type: 'string', enum: ['Enter', 'Escape', 'Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete', 'Space', 'F2'] },
    source_ref: { type: 'string', maxLength: 128 }, target_ref: { type: 'string', maxLength: 128 },
  },
};

export function validateUiAction(action, snapshot) {
  if (!action || typeof action !== 'object' || Array.isArray(action) || !uiActionSchema.properties.verb.enum.includes(action.verb)) throw new Error('Unsupported observed UI action');
  const fields = action.verb === 'drag' ? ['verb', 'source_ref', 'target_ref']
    : action.verb === 'fill' ? ['verb', 'ref', 'text'] : action.verb === 'press' ? ['verb', 'ref', 'key'] : action.verb === 'scroll' ? ['verb', 'ref', 'delta_y'] : action.verb === 'set_checked' ? ['verb','ref','checked'] : ['verb', 'ref'];
  if (Object.keys(action).some(key => !fields.includes(key)) || fields.some(key => !(key in action))) throw new Error('UI action fields do not match its verb');
  const refs = action.verb === 'drag' ? [action.source_ref, action.target_ref] : [action.ref];
  if (refs.some(ref => typeof ref !== 'string' || !/^ui-[a-zA-Z0-9-]{1,124}$/.test(ref))) throw new Error('UI action requires opaque observed references');
  if (action.verb === 'drag' && action.source_ref === action.target_ref) throw new Error('Drag requires different source and target references');
  if (action.verb === 'fill' && (typeof action.text !== 'string' || action.text.length > 2048 || /\0/.test(action.text))) throw new Error('UI text must be at most 2048 characters without NUL');
  if (action.verb === 'press' && !uiActionSchema.properties.key.enum.includes(action.key)) throw new Error('Unsupported UI key; clipboard and navigation shortcuts are not allowed');
  if (action.verb === 'scroll' && (!Number.isInteger(action.delta_y) || !action.delta_y || Math.abs(action.delta_y)>1000)) throw new Error('Scroll requires a nonzero integer delta_y within -1000..1000');
  if (action.verb === 'set_checked' && typeof action.checked !== 'boolean') throw new Error('set_checked requires a boolean checked value');
  if (snapshot) {
    if (!Array.isArray(snapshot.ui?.elements)) throw new Error('UI action requires an observation snapshot');
    for (const ref of refs) {
      const elements = snapshot.ui.elements.filter(element => element.ref === ref);
      if (elements.length !== 1 || !elements[0].allowed_actions?.includes(action.verb)) throw new Error('UI reference is absent, ambiguous, or does not support this action');
      if (action.verb==='set_checked' && elements[0].check_state?.kind==='radio' && !action.checked) throw new Error('Select the desired radio option; a radio cannot be independently unchecked');
    }
  }
  return action;
}

function workspaceUiCapability(page, task) {
  const started = Date.now(), deadline = started + 15000;
  const trace = [], handles = [];
  let phase = 'observing', effectPossible = false, mouseHeld = false;
  const record = (event, details = {}) => trace.push({ at_ms: Date.now() - started, event, ...details });
  const result = (status, output = {}, error = null) => ({ status, action_key: task.mode === 'observe' ? 'workspace.observe' : 'ui.act',
    action_revision: '1', operation_id: task.operation_id ?? null, phase, effect_possible: effectPossible, output, error, trace });
  const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
  const timeout = () => { const left = deadline - Date.now(); if (left <= 0) fail('UI_DEADLINE_EXCEEDED', 'Observed UI action deadline exceeded'); return left; };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  // A WeakMap records DOM incarnations, without adding attributes or mutating
  // Loginom. Re-rendering an identical-looking control invalidates its old ref.
  // The state is document-bound; navigation invalidates every previous reference.
  const readUi = () => page.evaluate(() => {
    const scanStarted = Date.now(), maxElements = 6000, maxWork = 250000, maxMs = 500;
    let work = 0;
    const charge = () => {
      if (++work > maxWork || Date.now() - scanStarted > maxMs) {
        const error = new Error('Workspace scan budget exceeded; no complete observation or action references were issued');
        error.code = 'UI_SCAN_LIMIT'; throw error;
      }
    };
    const dom = [], walker = document.createTreeWalker(document.documentElement, 1);
    let next;
    while ((next = walker.nextNode())) {
      charge();
      if (dom.length >= maxElements) { const error = new Error('Workspace exceeds the bounded scan size; narrower browser roots are required'); error.code = 'UI_SCAN_LIMIT'; throw error; }
      dom.push(next);
    }
    const select = selector => dom.filter(element => { charge(); return element.matches(selector); });
    const stateKey = Symbol.for('loginom-dock.workspace-ui.identity.v1');
    let state = globalThis[stateKey];
    if (!state || state.document !== document) {
      state = { document, ids: new WeakMap(), sequence: 0, epoch: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      Object.defineProperty(globalThis, stateKey, { value: state, configurable: true });
    }
    const refOf = element => {
      if (!state.ids.has(element)) state.ids.set(element, `ui-${state.epoch}-${++state.sequence}`);
      return state.ids.get(element);
    };
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
    const textOf = element => {
      if (sensitive(element)) return '[REDACTED]';
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
      || !!element.closest('.monaco-editor,.CodeMirror,.ace_editor');
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
    const candidates = select('button,input,textarea,select,[contenteditable="true"],[role="button"],[role="checkbox"],[role="radio"],[role="combobox"],[role="menuitem"],[role="tab"],[role="treeitem"],[role="option"],[role="spinbutton"],[data-tid]')
      .filter(element => visible(element) && !sensitive(element) && scopeOf(element) !== 'inactive_workflow');
    const interesting = element => element.matches('button,input,textarea,select,[contenteditable="true"],[role="button"],[role="checkbox"],[role="radio"],[role="combobox"],[role="menuitem"],[role="tab"],[role="treeitem"],[role="option"],[role="spinbutton"]')
      || /;(?:Input|Output)_[^;]+$|;Label;Label$|;Graph;[^;]+$|;btn[^;]+$|;edt[^;]+$|;mi[^;]+$|;tb(?:-\d+)?$/.test(getTid(element) ?? '')
      // Pinned E2E bg/selectors.ts:272,279,286: palette tree labels and
      // expanders are spans without button/treeitem roles in some UI builds.
      || /;ModelForm;colVendors_Компоненты>[^;]+;(?:TreeText|TreeExpander)$/.test(getTid(element) ?? '')
      // E2E bg/selectors.ts:1068 and bg/helpers/wizard.ts:29: the node
      // settings affordance can be SVG without a button role.
      || /;Graph;[^;]+;Setting$/.test(getTid(element) ?? '')
      || /;(?:Display|Input)El$/.test(getTid(element) ?? '') && element.matches('.x-form-checkbox,.x-form-radio')
      // Loginom message-box buttons are anchors without an ARIA button role;
      // their pinned test identifiers end with tlb;yes / tlb;no, not btn*.
      || ((getTid(element) ?? '').startsWith('msgbox') && /;tlb;(?:yes|no|ok|cancel)$/.test(getTid(element)) && !!dialogRef(element));
    const priority = { graph_editor: 0, dialog: 1, graph: 2, workflow: 3, global: 4 };
    const controls = candidates.filter(interesting).sort((left, right) => priority[scopeOf(left)] - priority[scopeOf(right)]);
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
      for (const y of [0.5,0.25,0.75]) for (const x of [0.5,0.25,0.75]) {
        charge();
        const point={x:left+(right-left)*x,y:top+(bottom-top)*y},hit=document.elementFromPoint(point.x,point.y);
        if (hit && (hit===element || element.contains(hit))) return {state:'point_observed',point};
      }
      return {state:'point_not_observed',point:null};
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
      const value = editable && !sensitive(element) ? String(element.value ?? (element.isContentEditable ? element.textContent : '') ?? '').slice(0, 2048) : undefined;
      return { ref: refOf(element), tid, identity, kind, role, label, scope: scopeOf(element), ...(value === undefined ? {} : { value }),
        ...(scroll ? { scroll } : {}),
        ...(checkState ? {check_state:checkState} : {}),
        signature: { tag, tid, role, type: element.getAttribute('type'), name: element.getAttribute('name'), label, ...(value === undefined ? {} : { value }), dialog_ref: dialogRef(element), scroll, check_state:checkState },
        enabled: isEnabled, visible: true, interaction, bounding_box: boxOf(element),
        allowed_actions: allowed ? ['click', 'double_click', 'press', 'drag', ...(editable ? ['fill'] : []), ...(checkState ? ['set_checked'] : []), ...(scroll && interaction.state === 'point_observed' ? ['scroll'] : [])] : [] };
    });
    const graphPrefix = workflow ? workflow.prefix + ';Graph;' : null;
    const graphElements = graphPrefix ? all.filter(element => (getTid(element) ?? '').startsWith(graphPrefix)) : [];
    const labels = [...new Set(graphElements.filter(element => /;Label;Label$/.test(getTid(element)) && visible(element))
      .map(element => getTid(element).slice(graphPrefix.length).replace(/;Label;Label$/, '')).filter(label => label && label !== 'Переменные_сценария'))].sort();
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
    const allCells = select('td,th,[role="gridcell"],[role="columnheader"],.x-grid-cell-inner');
    const cells = allCells.filter(visible).filter(element => !allCells.some(other => { charge(); return other !== element && element.contains(other); }));
    const tableCells = cells.slice(0, 120).map(element => {
      const column = element.getAttribute('aria-colindex');
      const table = element.closest('table,[role="grid"]');
      const headers = table ? allCells.filter(item => { charge(); return item.matches('th,[role="columnheader"]') && table.contains(item); }) : [];
      const index = element.cellIndex ?? (column ? Number(column) - 1 : -1);
      const header = index >= 0 ? textOf(headers[index] ?? element) : '';
      return { text: sensitivePattern.test(header) ? '[REDACTED]' : textOf(element), row: element.parentElement?.getAttribute('aria-rowindex') ?? null, column };
    });
    const workarea = graphPrefix ? all.find(element => getTid(element) === workflow.prefix + ';ModelForm;pnlWorkarea') : null;
    return { origin: location.origin, authenticated: !!tids.get('MF;cntMain;tlbMainToolbar;btnAvatar')?.some(visible), loginom_build: globalThis.bg?.app?.Version ?? null,
      workflow_ref: workflow, active_identity: active ? textOf(active) : null, package_identity: packageIdentity,
      scan: { complete: true, visited_elements: dom.length, max_elements: maxElements, max_work: maxWork, max_ms: maxMs },
      nodes, links: links.slice(0, 500), workarea: workarea ? boxOf(workarea) : null,
      ui: { elements, dialogs: dialogs.slice(0, 12), messages: messages.slice(0, 30), masks: masks.slice(0, 12), table_cells: tableCells,
        truncated: { elements: controls.length > 240, nodes: labels.length > 200, links: links.length > 500, ports: nodes.some(node => node.ports.length === 100), dialogs: dialogs.length > 12, messages: messages.length > 30, masks: masks.length > 12, table_cells: cells.length > 120 } } };
  });

  const locatorFor = identity => {
    if (!identity || !Array.isArray(identity.path) || identity.path.some(index => !Number.isInteger(index) || index < 0) || identity.path.length > 64) fail('UI_REFERENCE_INVALID', 'Observed control identity is invalid');
    const escaped = JSON.stringify(identity.anchor_tid).replaceAll('\u2028', '\\2028 ').replaceAll('\u2029', '\\2029 ');
    const anchor = identity.anchor_tid === null ? 'html' : `[data-tid=${escaped}]`;
    return page.locator(anchor + identity.path.map(index => ` > :nth-child(${index + 1})`).join(''));
  };
  const checkedHandle = async (before, current) => {
    if (!current || !same(before.identity, current.identity) || !same(before.signature, current.signature)
      || !current.allowed_actions.includes(task.action.verb)) fail('UI_REFERENCE_STALE', 'The observed control changed; observe the workspace again');
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
        if (!same(current.ui.dialogs.map(item => item.ref), task.snapshot.ui.dialogs.map(item => item.ref))) fail('UI_CONTEXT_CHANGED', 'The visible dialog changed; observe the workspace again');
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
        record('ui_preconditions_verified', { verb: task.action.verb, refs });
        phase = 'applying'; effectPossible = true;
        const first = targets[0].handle;
        const clickTarget = async clickCount => {
          timeout(); mouseHeld = true;
          await page.mouse.click(targets[0].point.x, targets[0].point.y, { clickCount });
          mouseHeld = false;
        };
        if (task.action.verb === 'click') await clickTarget(1);
        else if (task.action.verb === 'double_click') await clickTarget(2);
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
        const observed = await readUi();
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
        try { await page.mouse.up(); record('cleanup_completed', { resource: 'mouse' }); refreshedAfterCleanup = true; }
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
