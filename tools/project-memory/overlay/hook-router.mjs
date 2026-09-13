import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync, existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadProjectRouting, resolveProjectRoute, makeRoutingReceipt,
  routingReceiptPath, readMappedState, readRouteReceipt, validateActivation, activationPath, assertNoLegacyState,
  computeOfficialPluginPin,
} from './project-routing.mjs';

export const HOOK_SCRIPTS = Object.freeze({
  SessionStart: 'session-start-commit.mjs',
  UserPromptSubmit: 'auto-recall.mjs',
  Stop: 'auto-capture.mjs',
  PreCompact: 'pre-compact-capture.mjs',
  SessionEnd: 'session-end.mjs',
});
const SELF = fileURLToPath(import.meta.url);
const CHILD_EXPECTED = 'OPENVIKING_ROUTER_EXPECTED';
const MAX_STDIN = 8 * 1024 * 1024;
export class HookRoutingError extends Error {}
const fail = message => { throw new HookRoutingError(message); };

export function parseHookInput(raw, cwd = process.cwd()) {
  let value;
  try { value = JSON.parse(raw.toString()); } catch { fail('Hook input must be JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') fail('Invalid hook input.');
  if (typeof value.session_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.session_id))
    fail('Hook input lacks a valid host session_id.');
  if (typeof value.cwd !== 'string' || value.cwd !== resolve(value.cwd)) fail('Hook input lacks an absolute host cwd.');
  // The wrapper must be launched in the host workspace. Never substitute a project cwd.
  if (value.cwd !== cwd || realpathSync(value.cwd) !== value.cwd) fail('Hook cwd does not match the host workspace.');
  return { threadId: value.session_id, cwd: value.cwd };
}

function officialScript(route, event) {
  if (!Object.hasOwn(HOOK_SCRIPTS, event)) fail('Unsupported hook event.');
  const script = join(route.pluginRoot, 'scripts', HOOK_SCRIPTS[event]);
  if (!lstatSync(script).isFile() || realpathSync(script) !== script) fail('Official hook must be a regular pinned file.');
  const manifest = JSON.parse(readFileSync(join(route.pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  if (manifest.version !== '0.8.1') fail('Only the reviewed official plugin version 0.8.1 is supported.');
  const pin = computeOfficialPluginPin(route.pluginRoot);
  if (route.pluginPin && (pin.version !== route.pluginPin.version || pin.sha256 !== route.pluginPin.sha256))
    fail('Official plugin content changed from the reviewed project route.');
  return script;
}

function connectionFingerprint(cfg) {
  return createHash('sha256').update(JSON.stringify([
    cfg.baseUrl, cfg.apiKey || '', cfg.account || '', cfg.user || '',
    cfg.authMode, cfg.sendIdentityHeaders,
  ])).digest('hex');
}

export function buildChildEnvironment(parentEnv, cfg, route) {
  if (!cfg.baseUrl || !cfg.apiKey || !['api_key', 'trusted'].includes(cfg.authMode))
    fail('The existing official connection is incomplete.');
  if (cfg.peerId && cfg.peerId !== route.canonicalPeerId) fail('An unrelated explicit Peer is configured.');
  const env = { ...parentEnv };
  // Resolve once using the original official rules, then pin only this child.
  // Explicit credentialSource=cli ignores PEER_ID, so carry the effective
  // connection into env mode and verify the complete identity again in child.
  for (const name of ['OPENVIKING_BEARER_TOKEN', 'OPENVIKING_BASE_URL', 'OPENVIKING_MCP_URL',
    'OPENVIKING_CREDENTIALS_SOURCE', 'OV_HOOK_WORKER', 'OPENVIKING_HOOK_STDIN_CACHE']) delete env[name];
  Object.assign(env, {
    OPENVIKING_CREDENTIAL_SOURCE: 'env', OPENVIKING_URL: cfg.baseUrl,
    OPENVIKING_API_KEY: cfg.apiKey, OPENVIKING_ACCOUNT: cfg.account || '',
    OPENVIKING_USER: cfg.user || '', OPENVIKING_AUTH_MODE: cfg.authMode,
    OPENVIKING_PEER_ID: route.canonicalPeerId, OPENVIKING_RECALL_PEER_SCOPE: 'actor',
    OPENVIKING_CODEX_STATE_DIR: route.stateDir,
  });
  env[CHILD_EXPECTED] = JSON.stringify({
    connection: connectionFingerprint(cfg), peerId: route.canonicalPeerId,
    stateDir: route.stateDir, pluginRoot: route.pluginRoot, pluginPin: route.pluginPin,
  });
  return env;
}

export { validateActivation, activationPath, assertNoLegacyState };

function writeReceipt(context, route) {
  const target = routingReceiptPath(route, context.threadId);
  const directory = join(route.stateDir, 'routing-receipts');
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  if (realpathSync(directory) !== directory || (lstatSync(directory).mode & 0o777) !== 0o700)
    fail('Routing receipt directory must be private and non-symlinked.');
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(makeRoutingReceipt(context, route))}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, target);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export async function runHook(event, {
  raw, cwd = process.cwd(), routing = loadProjectRouting(),
  parentEnv = process.env, stdout = process.stdout, stderr = process.stderr,
  legacyStateDir, spawnImpl = spawn,
} = {}) {
  if (!Object.hasOwn(HOOK_SCRIPTS, event)) fail('Unsupported hook event.');
  const context = parseHookInput(raw, cwd);
  const route = resolveProjectRoute(context.cwd, routing);
  if (!route) fail('No exact shared-project route exists for this workspace.');
  officialScript(route, event);
  validateActivation(context, route, legacyStateDir);
  if (event !== 'SessionStart') {
    readRouteReceipt(context, route);
    readMappedState(context, route);
  }
  const { loadConfig } = await import(pathToFileURL(join(route.pluginRoot, 'scripts', 'config.mjs')).href);
  const cfg = loadConfig();
  const env = buildChildEnvironment(parentEnv, cfg, route);
  const result = await new Promise((accept, reject) => {
    const child = spawnImpl(process.execPath, [SELF, '--child', event, route.pluginRoot], {
      cwd: context.cwd, env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.on('error', () => reject(new HookRoutingError('Official hook could not start.')));
    child.stdout.pipe(stdout, { end: false });
    child.stderr.pipe(stderr, { end: false });
    child.stdin.on('error', () => {});
    child.once('close', (code, signal) => accept({ code: code ?? 1, signal }));
    child.stdin.end(raw);
  });
  if (result.code !== 0 || result.signal) fail('Official hook did not finish successfully.');
  if (event === 'SessionStart') {
    readMappedState(context, route);
    writeReceipt(context, route);
  }
  // This proves routing only. Async Stop/SessionEnd may still be capturing.
  return { event, routeEstablished: event === 'SessionStart', captureVerified: false };
}

async function runChild(event, pluginRoot) {
  const expected = JSON.parse(process.env[CHILD_EXPECTED] || '{}');
  if (expected.pluginRoot !== pluginRoot || !expected.pluginPin?.sha256 || expected.pluginPin.version !== '0.8.1')
    fail('Child plugin pin does not match.');
  const script = officialScript({ pluginRoot, pluginPin: expected.pluginPin }, event);
  const { loadConfig } = await import(pathToFileURL(join(pluginRoot, 'scripts', 'config.mjs')).href);
  const cfg = loadConfig();
  if (connectionFingerprint(cfg) !== expected.connection || cfg.peerId !== expected.peerId ||
    cfg.recallPeerScope !== 'actor' || process.env.OPENVIKING_CODEX_STATE_DIR !== expected.stateDir)
    fail('Official child connection or project routing changed during resolution.');
  delete process.env[CHILD_EXPECTED];
  process.umask(0o077);
  // Official async-writer re-enters process.argv[1]; keep it the official hook.
  process.argv = [process.execPath, script];
  await import(pathToFileURL(script).href);
}

async function main() {
  if (process.argv[2] === '--child') return runChild(process.argv[3], process.argv[4]);
  if (process.argv.length !== 3) fail('Usage: hook-router.mjs <hook event>');
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length; if (size > MAX_STDIN) fail('Hook input exceeds the size limit.');
    chunks.push(chunk);
  }
  await runHook(process.argv[2], { raw: Buffer.concat(chunks) });
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === SELF) main().catch(error => {
  // Do not echo arbitrary config/parser/transport exceptions or stdin payloads.
  process.stderr.write(`OpenViking project hook: ${error instanceof HookRoutingError ? error.message : 'Routing validation failed.'}\n`);
  process.exitCode = 1;
});
