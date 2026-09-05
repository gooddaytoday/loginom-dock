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
    await login.locator('input').fill('user', { timeout: remaining() });
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

export function makeWorkspacePrepareCode({ loginomUrl, compatibility, allowTestLogin = false, platform = process.platform }) {
  const url = new URL(loginomUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
      || [...url.searchParams.keys()].some(key => /token|password|secret|auth|api.?key/i.test(key))) {
    throw new Error('Workspace preparation requires a credential-free Loginom URL');
  }
  const options = { url: url.href, applicationBase: url.origin + url.pathname,
    expectedBuild: compatibility?.loginom_build ?? null, profileId: compatibility?.profile_id,
    platform: ({ darwin: 'macos', linux: 'linux', win32: 'windows' })[platform] ?? platform,
    allowTestLogin: allowTestLogin === true };
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
  description: 'Read the prepared Loginom workspace: logical workflow/node refs, ports, links and geometry. Does not change the UI or expose raw browser access.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
