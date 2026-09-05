import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { makeWorkspacePrepareCode, makeWorkspaceBootstrapCode, parseWorkspacePreparation, prepareWorkspaceSession, requirePreparedWorkspace } from '../lib/workspace.mjs';
import { createSerialGate } from '../lib/clipboard.mjs';

const build = '7.5.0-alpha+build.49202';

async function bootstrap({ url='https://loginom.test/app', actualBuild=build, tids=[], dialog=false, mask=false, size=0 }={}) {
  let scanned=0, evaluations=0;
  const elements=[...tids.map(tid=>({tid})), ...(dialog?[{dialog:true}]:[]), ...(mask?[{mask:true}]:[]), ...Array.from({length:size},()=>({}))].map(item=>({
    getAttribute(name) { assert.equal(name,'data-tid');return item.tid??null; },
    hasAttribute() { return false; },
    getBoundingClientRect() { return {width:10,height:10}; },
    matches(selector) { return selector.includes('role="dialog"') ? !!item.dialog : !!item.mask; },
    get value() { throw new Error('Credential values must never be read'); },
    get textContent() { throw new Error('Bootstrap must not read arbitrary text'); },
  }));
  const page={url:()=>url, async evaluate(fn,args) {
    evaluations++;
    return runInNewContext(`(${fn.toString()})(args)`,{args,location:{origin:'https://loginom.test'},bg:{app:{Version:actualBuild}},
      Date:{now:()=>0},getComputedStyle:()=>({}),document:{documentElement:{},createTreeWalker:()=>({nextNode:()=>elements[scanned++]??null})}});
  }};
  const result=await runInNewContext(makeWorkspaceBootstrapCode({origin:'https://loginom.test',build}),{URL})(page);
  return {result:JSON.parse(JSON.stringify(result)),evaluations,scanned};
}

test('bootstrap does not inspect another origin or require preparation',async()=>{
  const {result,evaluations}=await bootstrap({url:'about:blank'});
  assert.equal(evaluations,0);assert.equal(result.output.target_state,'not_open');
  assert.equal(result.effect_possible,false);assert.equal(result.output.observation_only,true);
});

test('bootstrap reports login, ready, incompatible build and blockers without reading values',async()=>{
  for (const [options,state] of [
    [{tids:['LoginForm;Login;edtUsername']},'login_required'],
    [{tids:['MF;cntMain;tlbMainToolbar;btnAvatar']},'ready_for_prepare'],
    [{actualBuild:'different'},'incompatible_or_loading'],
    [{dialog:true,mask:true},'blocked'],
  ]) {
    const {result}=await bootstrap(options);assert.equal(result.output.target_state,state);
    assert.equal(result.output.scan.complete,true);assert.equal(result.output.ui,undefined);
  }
});

test('bootstrap stops the DOM walk at its budget and cannot claim readiness',async()=>{
  const {result,scanned}=await bootstrap({tids:['MF;cntMain;tlbMainToolbar;btnAvatar'],size:5000});
  assert.equal(scanned,4000);assert.equal(result.output.scan.complete,false);
  assert.equal(result.output.target_state,'indeterminate');
});
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
  const replayState = await execute(replay, { allowTestLogin: true, testLoginUser: 'test-account' });
  const normalState = await execute(normal);
  assert.equal(replayState.status, 'READY');
  assert.equal(normalState.status, 'READY');
  assert.equal(JSON.stringify(replayState.workflow_ref), JSON.stringify(normalState.workflow_ref));
  assert.equal(replayState.workflow_ref.prefix, 'MF;TF-2');
  assert.equal(normalState.target.loginom_build, build);
  assert.ok(replay.events.includes('login'));
  assert.ok(replay.events.some(event=>event.fill==='test-account'));
  assert.ok(!replay.events.some(event=>event.fill==='user'));
  assert.ok(!normal.events.includes('login'));
});

test('an incompatible UI is rejected before login or draft creation', async () => {
  const fixture = pageFixture({ actualBuild: '8.0.0' });
  const state = await execute(fixture, { allowTestLogin: true, testLoginUser: 'test-account' });
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

test('automatic test login requires an explicit account', async () => {
  const fixture=pageFixture();
  await assert.rejects(()=>execute(fixture,{allowTestLogin:true}),/explicit Loginom account/);
  assert.deepEqual(fixture.events,[]);
});
