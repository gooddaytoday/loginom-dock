import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { makeWorkspacePrepareCode, parseWorkspacePreparation, prepareWorkspaceSession, requirePreparedWorkspace } from '../lib/workspace.mjs';
import { createSerialGate } from '../lib/clipboard.mjs';

const build = '7.5.0-alpha+build.49202';
function pageFixture({ authenticated = false, workflow = false, actualBuild = build } = {}) {
  const events = [];
  let url = 'about:blank';
  const locator = selector => ({
    async isVisible() {
      if (selector.includes('btnAvatar')) return authenticated;
      if (selector.includes('edtUsername')) return !authenticated;
      return true;
    },
    async count() {
      if (selector.includes('x-tab-active')) return workflow ? 1 : 0;
      if (selector.includes('bg-mask-message')) return 0;
      return 1;
    },
    async click() {
      events.push(selector.includes('btnLogin') ? 'login' : 'create_draft');
      if (selector.includes('btnLogin')) authenticated = true;
      if (selector.includes('btnCreateUnsavedPackage')) workflow = true;
    },
    async fill(value) { events.push({ fill: value }); },
    locator(child) { return locator(selector + ' ' + child); },
    async getAttribute() { return 'MF;cntMain;cntWorkspace;Workspace;t.br;tb-2'; },
    async waitFor() {},
  });
  return { events, page: {
    url: () => url,
    async goto(value) { url = value; events.push('navigate'); },
    async evaluate() { return actualBuild; },
    locator, async waitForTimeout() {},
  } };
}
const execute = async (fixture, options = {}) => runInNewContext(makeWorkspacePrepareCode({
  loginomUrl: 'http://loginom.example/app?testable=true',
  compatibility: { profile_id: 'tested-ui', loginom_build: build, platform: 'macos', browser: 'chromium' }, platform: 'darwin', ...options,
}))(fixture.page);

test('normal preparation opens Loginom and asks for login without assuming test credentials', async () => {
  const fixture = pageFixture();
  const state = await execute(fixture);
  assert.equal(state.status, 'LOGIN_REQUIRED');
  assert.deepEqual(fixture.events, ['navigate']);
});

test('operator test login and authenticated normal preparation reach the same workspace contract', async () => {
  const replay = pageFixture();
  const normal = pageFixture({ authenticated: true });
  const replayState = await execute(replay, { allowTestLogin: true });
  const normalState = await execute(normal);
  assert.equal(replayState.status, 'READY');
  assert.equal(normalState.status, 'READY');
  assert.equal(JSON.stringify(replayState.workflow_ref), JSON.stringify(normalState.workflow_ref));
  assert.equal(replayState.workflow_ref.prefix, 'MF;TF-2');
  assert.equal(normalState.target.loginom_build, build);
  assert.ok(replay.events.includes('login'));
  assert.ok(!normal.events.includes('login'));
});

test('an incompatible UI is rejected before login or draft creation', async () => {
  const fixture = pageFixture({ actualBuild: '8.0.0' });
  const state = await execute(fixture, { allowTestLogin: true });
  assert.equal(state.status, 'INCOMPATIBLE');
  assert.deepEqual(fixture.events, ['navigate']);
});

test('an incompatible operating system is rejected before any browser call', async () => {
  const fixture = pageFixture({ authenticated: true });
  await assert.rejects(execute(fixture, { platform: 'linux' }), /platform\/browser/);
  assert.deepEqual(fixture.events, []);
});

test('repeat preparation preserves an existing authenticated workflow', async () => {
  const fixture = pageFixture({ authenticated: true, workflow: true });
  const state = await execute(fixture);
  assert.equal(state.created_draft, false);
  assert.deepEqual(fixture.events, ['navigate']);
});

test('only a fully prepared workspace can admit action mutations', () => {
  for (const metadata of [{}, { skillRevision: 'skill' }, { workspaceReady: true },
    { skillRevision: 'skill', workspaceReady: true }]) assert.throws(() => requirePreparedWorkspace(metadata), /NOT_READY/);
  requirePreparedWorkspace({ skillRevision: 'skill', workspaceReady: true, targetIdentity: { loginom_build: build } });
  assert.throws(() => parseWorkspacePreparation({ content: [{ type: 'text', text: '{"status":"READY"}' }] }), /no verified/);
  assert.throws(() => makeWorkspacePrepareCode({ loginomUrl: 'http://loginom.example/?token=secret' }), /credential-free/);
});

test('preparation failure cannot admit a queued action before durable readiness', async () => {
  for (const failure of ['record', 'save']) {
    const metadata = { skillRevision: 'skill' };
    const gate = createSerialGate();
    const events = [];
    const preparing = gate(() => prepareWorkspaceSession({ metadata,
      assertAllowed() {}, assertTarget() {},
      async prepare() { return { status: 'READY', target: { loginom_build: build }, workflow_ref: { prefix: 'MF;TF-1' } }; },
      async record() { events.push('record'); if (failure === 'record') throw new Error('disk failure'); },
      async save() { events.push('save'); throw new Error('disk failure'); },
    }));
    const action = gate(() => requirePreparedWorkspace(metadata));
    await assert.rejects(preparing, /disk failure/);
    await assert.rejects(action, /NOT_READY/);
    assert.equal(metadata.workspaceReady, false);
    assert.deepEqual(events, failure === 'record' ? ['record'] : ['record', 'save']);
  }
});

test('pending-operation guard prevents preparation from mutating a workspace', async () => {
  const metadata = { skillRevision: 'skill', workspaceReady: true, targetIdentity: { loginom_build: build } };
  let calls = 0;
  await assert.rejects(prepareWorkspaceSession({ metadata,
    assertAllowed() { throw new Error('pending operation'); },
    prepare() { calls++; }, record() { calls++; }, save() { calls++; },
  }), /pending operation/);
  assert.equal(calls, 0);
  assert.equal(metadata.workspaceReady, true);
});
