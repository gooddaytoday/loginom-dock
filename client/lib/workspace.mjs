// Fixed local lifecycle code. Catalogs never supply executable bootstrap code.
async function prepareWorkspace(page, options) {
  const deadline = Date.now() + 120000;
  const remaining = () => Math.max(1, deadline - Date.now());
  const tid = value => page.locator(`[data-tid=${JSON.stringify(value)}]`);
  const wait = async probe => {
    while (Date.now() < deadline) {
      const value = await probe();
      if (value) return value;
      await page.waitForTimeout(100);
    }
    throw new Error('Loginom workspace preparation timed out');
  };
  const current = page.url();
  if (current === 'about:blank' || !current.startsWith(options.applicationBase)) {
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: Math.min(60000, remaining()) });
  }
  // This public version constant is defined by the observed bg/app/Version.js.
  // It identifies the frontend/UI build, not the server binary version.
  const build = await wait(() => page.evaluate(() => globalThis.bg?.app?.Version ?? null));
  const target = { profile_id: options.profileId, loginom_build: build,
    platform: options.platform, browser: 'chromium' };
  if (options.expectedBuild && build !== options.expectedBuild) {
    return { status: 'INCOMPATIBLE', target, authenticated: false, created_draft: false };
  }
  const avatar = tid('MF;cntMain;tlbMainToolbar;btnAvatar');
  const login = tid('LoginForm;Login;edtUsername');
  await wait(async () => await avatar.isVisible().catch(() => false) || await login.isVisible().catch(() => false));
  if (!(await avatar.isVisible().catch(() => false))) {
    if (!options.allowTestLogin) {
      return { status: 'LOGIN_REQUIRED', target, authenticated: false, created_draft: false };
    }
    const password = tid('LoginForm;Login;edtPassword');
    const submit = tid('LoginForm;Login;btnLogin');
    if (await login.count() !== 1 || await password.count() !== 1 || await submit.count() !== 1) {
      throw new Error('The verified test login form is unavailable');
    }
    await login.locator('input').fill(options.testLoginUser, { timeout: remaining() });
    await password.locator('input').fill('', { timeout: remaining() });
    await submit.click({ timeout: remaining() });
    await wait(() => avatar.isVisible());
  }
  const selected = () => page.locator('[data-tid^="MF;cntMain;cntWorkspace;Workspace;t.br;tb"].x-tab-active');
  let createdDraft = false;
  if (await selected().count() === 0) {
    const draft = tid('MF;TF;HomePage;btnCreateUnsavedPackage');
    await draft.waitFor({ state: 'visible', timeout: remaining() });
    await draft.click({ timeout: remaining() });
    createdDraft = true;
  }
  const workflow = await wait(async () => {
    const tabs = selected();
    if (await tabs.count() !== 1) return null;
    const tabTid = await tabs.getAttribute('data-tid');
    const match = /^MF;cntMain;cntWorkspace;Workspace;t\.br;tb(?:-(\d+))?$/.exec(tabTid ?? '');
    if (!match) return null;
    const prefix = match[1] ? `MF;TF-${match[1]}` : 'MF;TF';
    if (!(await tid(`${prefix};ModelForm;cmpDiagram`).isVisible().catch(() => false))
        || !(await tid(`${prefix};ModelForm;pnlWorkarea`).isVisible().catch(() => false))
        || await page.locator('.bg-mask-message:visible').count()) return null;
    return { tab_tid: tabTid, prefix };
  });
  // The graph appears just before ExtJS installs its drag handlers.
  if (createdDraft) await page.waitForTimeout(500);
  return { status: 'READY', target, authenticated: true, created_draft: createdDraft, workflow_ref: workflow };
}

export function makeWorkspacePrepareCode({ loginomUrl, compatibility, allowTestLogin = false, testLoginUser = null, platform = process.platform }) {
  const url = new URL(loginomUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
      || [...url.searchParams.keys()].some(key => /token|password|secret|auth|api.?key/i.test(key))) {
    throw new Error('Workspace preparation requires a credential-free Loginom URL');
  }
  if (allowTestLogin && (typeof testLoginUser !== 'string' || !testLoginUser.trim() || testLoginUser.length>200 || /[\x00-\x1f\x7f]/.test(testLoginUser))) throw new Error('Test login requires an explicit Loginom account');
  const options = { url: url.href, applicationBase: url.origin + url.pathname,
    expectedBuild: compatibility?.loginom_build ?? null, profileId: compatibility?.profile_id,
    platform: ({ darwin: 'macos', linux: 'linux', win32: 'windows' })[platform] ?? platform,
    allowTestLogin: allowTestLogin === true, testLoginUser: allowTestLogin ? testLoginUser : null };
  if (compatibility?.platform !== options.platform || compatibility?.browser !== 'chromium') {
    throw new Error('The pinned Loginom compatibility profile does not support this platform/browser');
  }
  return `async (page) => (${prepareWorkspace.toString()})(page, ${JSON.stringify(options)})`;
}

export function parseWorkspacePreparation(response) {
  if (response?.isError) throw new Error('Loginom workspace preparation failed');
  for (const block of response?.content ?? []) {
    if (block.type !== 'text') continue;
    const match = block.text.match(/^### Result\n([\s\S]*?)(?:\n### |$)/);
    let value;
    try { value = JSON.parse(match?.[1] ?? block.text); } catch { continue; }
    if (!['READY', 'LOGIN_REQUIRED', 'INCOMPATIBLE'].includes(value?.status)
        || typeof value.target?.loginom_build !== 'string'
        || typeof value.authenticated !== 'boolean' || typeof value.created_draft !== 'boolean') continue;
    if (value.status === 'READY' && (!value.authenticated || !value.workflow_ref?.tab_tid || !value.workflow_ref?.prefix)) continue;
    return value;
  }
  throw new Error('Workspace preparation returned no verified state');
}

export function requirePreparedWorkspace(metadata) {
  if (!metadata.skillRevision || metadata.workspaceReady !== true || !metadata.targetIdentity?.loginom_build) {
    throw new Error('NOT_READY: call dock_prepare and complete Loginom workspace preparation first');
  }
}

// Called inside the same browser gate as actions. Readiness is not published to
// another action until evidence and the session manifest have both been saved.
export async function prepareWorkspaceSession({ metadata, assertAllowed, prepare, assertTarget, record, save }) {
  assertAllowed();
  if (metadata.workspaceReady === true) {
    throw new Error('Workspace is already prepared. Use dock_workspace_observe for the current UI and dock_action_describe to reread input_artifacts. Preparation has not changed the workspace.');
  }
  metadata.workspaceReady = false;
  try {
    const state = await prepare();
    if (state.status === 'READY') {
      assertTarget(state.target);
      metadata.targetIdentity = state.target;
      metadata.workflowRef = state.workflow_ref;
    } else {
      metadata.targetIdentity = null;
      metadata.workflowRef = null;
    }
    await record({ event: 'workspace_prepared', state });
    metadata.workspaceReady = state.status === 'READY';
    await save();
    return state;
  } catch (error) {
    metadata.workspaceReady = false;
    metadata.targetIdentity = null;
    metadata.workflowRef = null;
    throw error;
  }
}

export const workspaceObserveTool = {
  name: 'dock_workspace_observe',
  description: 'Read a compact page of the prepared Loginom workspace. Before preparation, scope bootstrap reads only application/build/login/blocker state without navigation, login, draft creation or capture activation. Otherwise choose all (default), palette, graph or dialogs. wizard metadata reports the visible title, recognized current stage and lifecycle button states; input_mapping may be a normal step before a node-specific page. It does not prove node ownership, applied settings or execution. To open node settings, use a single click on its observed Graph;<label>;Setting control as in E2E OpenNodeSettings; double-click is not its contract. Optionally supply root_ref plus its observation_id to limit detailed UI elements/cells to an already delivered element and its descendants. Detailed traversal is limited to the root; global context and blockers use fixed native queries. Graph completeness is not established by a root read. Use scope roots to discover regions in an oversized document without detailed traversal. With scope roots, optional storage_name finds rendered file-storage name candidates using a fixed native query, without walking the table. Missing candidates do not prove file absence; formatted IDs may collide, so read and verify the actual candidate before acting. Region refs have no gestures: first read one using root_ref and observation_id, then act on its delivered controls. Discovery is not proof that blockers are absent. Continue with cursor=page.next_cursor alone; pages share observation_id and revision. If the workspace changes, start a new observation. Only delivered UI refs can be used. visible means rendered, not necessarily reachable: prefer interaction.state=point_observed for gestures. outside_viewport and point_not_observed indicate that no interaction point was seen; read other pages to find a reachable target, especially after scroll. Truncation and full_dom_complete=false mean this is not proof of the whole workspace. Recognized Preview/Table cells expose data_cell view/field/row identity, bounded untrimmed display_text and observed null_marker_present; data_column records expose declared UI types. Missing/ambiguous headers suppress cell text. These describe rendered data only: they do not establish execution identity, full row coverage or numeric precision. Calculator editor records distinguish bounded rendered_lines from document.text: full_text_verified=true requires a complete read of the bound CodeMirror document; rendered_lines alone never establish it. selected_expression identifies the selected field. Only a writable expression-mode document offers replace_expression; generic editor gestures remain unavailable. Neither document text nor syntax_validity=unverified proves syntax validity or saved settings. Read-only.',
  inputSchema: { type: 'object', properties: {
    scope: { type: 'string', enum: ['bootstrap', 'all', 'palette', 'graph', 'dialogs', 'roots'] },
    cursor: { type: 'string', minLength: 1, maxLength: 128 },
    storage_name: {type:'string',minLength:1,maxLength:200},
    root_ref: {type:'string',minLength:1,maxLength:128},
    observation_id: {type:'string',minLength:1,maxLength:128},
  }, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

function bootstrapWorkspace(page, expected) {
  return (async () => {
    let origin = null;
    try { origin = new URL(page.url()).origin; } catch { /* No open application. */ }
    let output = { bootstrap: true, target_state: 'not_open', origin, authenticated: null,
      login_required: null, compatible_build: null, observation_only: true };
    if (origin === expected.origin) {
      output = await page.evaluate(({ expectedBuild }) => {
        const started = Date.now(), walker = document.createTreeWalker(document.documentElement, 1);
        let visited = 0, element, exhausted = false, avatar = false, login = false, dialogs = 0, masks = 0;
        const visible = element => {
          const box = element.getBoundingClientRect();
          if (!(box.width > 0 && box.height > 0)) return false;
          let depth = 0;
          for (let parent = element; parent; parent = parent.parentElement) {
            if (++depth > 64 || Date.now() - started > 75) return false;
            const style = getComputedStyle(parent);
            if (parent.hasAttribute('hidden') || style.display === 'none' || ['hidden','collapse'].includes(style.visibility) || style.opacity === '0') return false;
          }
          return true;
        };
        while (visited < 4000 && Date.now() - started <= 75) {
          element = walker.nextNode();
          if (!element) { exhausted = true; break; }
          visited++;
          const tid = element.getAttribute('data-tid');
          const isAvatar = tid === 'MF;cntMain;tlbMainToolbar;btnAvatar';
          const isLogin = tid === 'LoginForm;Login;edtUsername';
          const isDialog = element.matches('[role="dialog"],.x-window,.bg-dialog');
          const isMask = element.matches('.bg-mask-message,.x-mask-msg');
          if (!(isAvatar || isLogin || isDialog || isMask) || !visible(element)) continue;
          avatar ||= isAvatar; login ||= isLogin; dialogs += Number(isDialog); masks += Number(isMask);
        }
        const build = globalThis.bg?.app?.Version ?? null, compatible = build === expectedBuild;
        return { bootstrap: true, origin: location.origin, loginom_build: typeof build === 'string' ? build.slice(0,128) : null,
          target_state: !compatible ? 'incompatible_or_loading' : !exhausted ? 'indeterminate'
            : login && !avatar ? 'login_required' : dialogs || masks ? 'blocked' : avatar ? 'ready_for_prepare' : 'indeterminate',
          authenticated: avatar && !login ? true : login && !avatar ? false : null,
          login_required: login && !avatar ? true : avatar && !login ? false : null,
          compatible_build: compatible, blockers: { visible_dialogs: dialogs, visible_masks: masks },
          scan: { visited_elements: visited, complete: exhausted, max_elements: 4000, max_ms: 75 },
          observation_only: true };
      }, { expectedBuild: expected.build });
    }
    return { status: 'SUCCEEDED', action_key: 'workspace.observe', action_revision: '1', operation_id: null,
      phase: 'observed', effect_possible: false, cleanup_complete: true, error: null, trace: [], output };
  })();
}

export function makeWorkspaceBootstrapCode({ origin, build }) {
  if (typeof origin !== 'string' || new URL(origin).origin !== origin || typeof build !== 'string' || !build) throw new Error('Bootstrap requires a pinned origin and build');
  return `async (page) => (${bootstrapWorkspace.toString()})(page, ${JSON.stringify({ origin, build })})`;
}
