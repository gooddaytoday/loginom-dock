import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createArtifactStore } from '../../lib/artifacts.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client as ProtocolClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as actionCatalog from '../../lib/action-catalog.mjs';
import * as skill from '../../lib/skill.mjs';
import * as workspace from '../../lib/workspace.mjs';
import { actions, selectors, build, Page, nodeParameters } from './executor-fixture.mjs';

// Exercise the actual bridge request handler and MCP Server/Client protocol.
// Only external services, catalog delivery and browser transport are replaced;
// no localhost listener, real browser, credentials or model is involved.
test('MCP application refusals remain typed normal content and the same connection can create a node afterwards', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dock-bridge-contract-'));
  const page = new Page(); let browserCalls = 0;
  const compatibility = { profile_id: 'unit-macos-chromium', loginom_build: build, platform: 'macos', browser: 'chromium' };
  const pinned = { actions, selectors, pins: {}, compatibility, manifest: { compatibility } };
  class ExternalClient {
    constructor(identity) { this.browser = identity.name === 'loginom-dock-browser'; }
    async connect() {}
    async close() {}
    async listTools() { return { tools: [{ name: this.browser ? 'browser_run_code_unsafe' : 'read', inputSchema: { type: 'object', additionalProperties: true } }] }; }
    async callTool(request) {
      assert.equal(this.browser, true);
      assert.equal(request.name, 'browser_run_code_unsafe');
      browserCalls++;
      const code = request.arguments.code;
      const output = code.includes('async function prepareWorkspace(')
        ? { status: 'READY', target: compatibility, authenticated: true, created_draft: false, workflow_ref: { tab_tid: page.tabTid, prefix: page.prefix } }
        : await page.execute(code);
      return { content: [{ type: 'text', text: JSON.stringify(output) }] };
    }
  }
  class ExternalTransport { constructor() {} }
  mock.module('@modelcontextprotocol/sdk/client/index.js', { namedExports: { Client: ExternalClient } });
  mock.module('@modelcontextprotocol/sdk/client/stdio.js', { namedExports: { StdioClientTransport: ExternalTransport, getDefaultEnvironment: () => ({}) } });
  mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', { namedExports: { StreamableHTTPClientTransport: ExternalTransport } });
  mock.module(new URL('../../lib/action-catalog.mjs', import.meta.url).href, { namedExports: { ...actionCatalog, pinActionCatalog: async () => pinned } });
  // The external browser fixture represents the pinned Mac target even when
  // this protocol test runs on the Linux build host. Keep real preparation and
  // target validation; supply only that explicit simulated client platform.
  mock.module(new URL('../../lib/workspace.mjs', import.meta.url).href, { namedExports: { ...workspace,
    makeWorkspacePrepareCode: options => workspace.makeWorkspacePrepareCode({ ...options, platform: 'darwin' }),
  } });
  mock.module(new URL('../../lib/skill.mjs', import.meta.url).href, { namedExports: { ...skill,
    skillTransport: () => ({}), createSkillLoader: () => ({ prepare: async () => ({ main: '/unit/skill', directory: '/unit/skill',
      detail: { revision: 'unit-skill', source: 'unit-source', content: 'Legacy skill context without the new recovery tools.' } }) }),
  } });
  const { createBridge } = await import('../../lib/bridge.mjs');
  const session = { directory, browserCli: '/unit/browser.mjs', browserConfig: '/unit/browser.json', browserRoot: '/unit/browser',
    metadata: { client: '0.1.0-test', clientRevision: 'd'.repeat(64), sessionId: 'unit-bridge-session' }, async save() {} };
  const config = { endpoint: 'https://dock.invalid/mcp', apiKey: 'UNIT-NONSECRET', loginomUrl: 'https://loginom.invalid/?testable=true', mode: 'executor-replay' };
  let bridge, client;
  try {
    session.artifactStore=await createArtifactStore({directory:join(directory,'input')});
    const sourcePath=join(directory,'private-source.csv');await writeFile(sourcePath,'abc');
    const admitted=await session.artifactStore.admit({sourcePath,name:'sales.csv',bytes:3,
      sha256:createHash('sha256').update('abc').digest('hex')});
    bridge = await createBridge(config, session);
    client = new ProtocolClient({ name: 'test-agent', version: '1.0.0' });
    const [agentTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([bridge.server.connect(bridgeTransport), client.connect(agentTransport)]);
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'dock_operation_recover'));
    assert.ok(listed.tools.some(tool => tool.name === 'dock_artifact_upload'));
    assert.ok(listed.tools.some(tool => tool.name === 'dock_artifact_verify'));
    const rejectedVerify=await client.callTool({name:'dock_artifact_verify',arguments:{operation_id:'u',verification_id:'v',
      observation_id:'o',file_ref:'r',download_path:'/private/replaced'}});
    assert.equal(JSON.parse(rejectedVerify.content[0].text).error.code,'REQUEST_REJECTED');
    assert.equal(browserCalls,0);
    const rejectedUpload=await client.callTool({name:'dock_artifact_upload',arguments:{artifact_id:'a',upload_grant_id:'g',
      observation_id:'o',operation_id:'u',destination:'/other'}});
    assert.equal(JSON.parse(rejectedUpload.content[0].text).error.code,'REQUEST_REJECTED');
    assert.equal(browserCalls,0);
    const available = await client.callTool({ name: 'dock_action_describe', arguments: {} });
    assert.notEqual(available.isError, true);
    assert.deepEqual(JSON.parse(available.content[0].text).available_actions, ['node.add', 'link.create', 'package.save_as']);
    assert.equal(browserCalls, 0);

    const bootstrap = await client.callTool({ name: 'dock_workspace_observe', arguments: { scope: 'bootstrap' } });
    const initial = JSON.parse(bootstrap.content[0].text);
    assert.equal(initial.status, 'SUCCEEDED');
    assert.equal(initial.output.bootstrap, true);
    assert.equal(initial.effect_possible, false);
    assert.equal(browserCalls, 1);
    assert.equal(session.metadata.workspaceReady, undefined);
    assert.equal(session.metadata.archiveActive, undefined);
    assert.equal(page.drops, 0);
    const premature = await client.callTool({ name: 'dock_workspace_observe', arguments: { scope: 'graph' } });
    assert.equal(JSON.parse(premature.content[0].text).status, 'FAILED');
    assert.equal(browserCalls, 1);

    const prepared = await client.callTool({ name: 'dock_prepare', arguments: {} });
    assert.notEqual(prepared.isError, true);
    const metadata = JSON.parse(prepared.content[0].text);
    assert.equal(metadata.prepared, true);
    assert.deepEqual(metadata.input_artifacts,[admitted]);
    assert.equal(JSON.stringify(metadata.input_artifacts).includes(sourcePath),false);
    assert.deepEqual(metadata.executor.available_actions, ['node.add', 'link.create', 'package.save_as']);
    assert.ok(prepared.content.some(block => block.type === 'text' && block.text.includes('dock_ui_action') && block.text.includes('supersede')));
    const beforeInvalid = browserCalls;
    for (const key of ['canvas.add_node', 'node.rename', 'workflow.create']) {
      const response = await client.callTool({ name: 'dock_action_run', arguments: { action_key: key, parameters: {} } });
      assert.notEqual(response.isError, true);
      const outcome = JSON.parse(response.content[0].text);
      assert.equal(outcome.status, 'FAILED');
      assert.equal(outcome.error.code, 'REQUEST_REJECTED');
      assert.equal(outcome.request_rejected, true);
      assert.equal(outcome.effect_possible, false);
      assert.equal(response.content.length, 2);
      assert.equal(response.content[1].type, 'text');
      assert.equal(Object.hasOwn(outcome, 'knowledge_context'), false);
      assert.deepEqual(outcome.output.available_actions, ['node.add', 'link.create', 'package.save_as']);
    }
    assert.equal(browserCalls, beforeInvalid);
    const succeeded = await client.callTool({ name: 'dock_action_run', arguments: { action_key: 'node.add', parameters: nodeParameters, operation_id: 'after-three-refusals' } });
    assert.notEqual(succeeded.isError, true);
    assert.equal(JSON.parse(succeeded.content[0].text).status, 'SUCCEEDED');
    assert.equal(succeeded.content.length, 2);
    const verification = JSON.parse(succeeded.content[1].text);
    assert.equal(verification.kind, 'dock_outcome_verification');
    assert.equal(verification.operation_id, 'after-three-refusals');
    assert.equal(verification.domain_effect.state, 'verified');
    assert.equal(verification.goal.state, 'not_verified');
    assert.equal(page.drops, 1);
    assert.deepEqual(page.nodes.map(node => node.label), ['Источник']);
  } finally {
    await client?.close();
    await bridge?.close();
    mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  }
});
