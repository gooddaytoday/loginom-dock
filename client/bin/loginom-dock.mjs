#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../lib/config.mjs';
import { createSession } from '../lib/session.mjs';
import { createBridge } from '../lib/bridge.mjs';
import { admitStartupArtifacts } from '../lib/artifacts.mjs';

process.umask(0o077);
let bridge;
try {
  const { values } = parseArgs({ options: {
    config: { type: 'string' }, 'state-dir': { type: 'string' },
    agent: { type: 'string' }, 'adapter-revision': { type: 'string' },
    mode: { type: 'string' },
    'action-manifest-uri': { type: 'string' }, 'action-manifest-sha256': { type: 'string' },
    'replay-bootstrap': { type: 'boolean', default: false },
    'input-artifact': { type: 'string', multiple: true },
    headless: { type: 'boolean', default: false },
  } });
  const config = await loadConfig({
    configPath: values.config || process.env.LOGINOM_DOCK_CONFIG,
    stateDir: values['state-dir'], agent: values.agent, adapterRevision: values['adapter-revision'],
    mode: values.mode || process.env.LOGINOM_DOCK_MODE || 'classic',
    actionManifestUri: values['action-manifest-uri'], actionManifestSha256: values['action-manifest-sha256'],
    replayBootstrap: values['replay-bootstrap'],
  });
  const session = await createSession(config, { headless: values.headless });
  if (values['input-artifact']?.length && !['executor-preview','executor-replay'].includes(config.mode)) {
    throw new Error('Input artifacts require executor mode');
  }
  await admitStartupArtifacts(session.artifactStore, (values['input-artifact'] ?? []).map(value => {
    if (value.length>8192) throw new Error('Input artifact argument is too large');
    return JSON.parse(value);
  }));
  bridge = await createBridge(config, session);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => { await bridge.close(); process.exit(0); });
  }
  process.stdin.once('end', () => { void bridge.close(); });
  await bridge.server.connect(new StdioServerTransport());
} catch {
  // Config parsing and upstream failures may embed secrets. Startup logs are fixed.
  process.stderr.write('Loginom Dock could not start. Check its explicit config, pinned runtime, browser installation and server availability.\n');
  await bridge?.close();
  process.exitCode = 1;
}
