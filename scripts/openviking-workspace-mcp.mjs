#!/usr/bin/env node
// Project-scoped launcher for the installed personal OpenViking MCP proxy.
// The project's Codex config supplies cwd; never infer it from the plugin cache.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.cwd();
if (!existsSync(join(workspace, ".codex", "config.toml")) || workspace === homedir()) {
  throw new Error("OpenViking MCP requires a project working directory with .codex/config.toml");
}
const plugin = resolve(homedir(), ".codex/plugins/cache/loginom-dock/openviking-memory/0.8.1");
const moduleAt = (relative) => import(pathToFileURL(join(plugin, relative)).href);
const { loadConfig } = await moduleAt("scripts/config.mjs");
const { resolveOpenVikingCredentials } = await moduleAt("scripts/ov-credentials.mjs");
const { createLogger } = await moduleAt("scripts/debug-log.mjs");
const { buildMcpProxyConfig } = await moduleAt("scripts/shared/mcp-proxy-config.mjs");
const { deriveWorkspacePeerId } = await moduleAt("scripts/shared/workspace-peer.mjs");
const { createOpenVikingMcpProxy } = await moduleAt("scripts/shared/mcp-proxy-core.mjs");

function readConfig() {
  const credentials = resolveOpenVikingCredentials();
  const cfg = loadConfig();
  return buildMcpProxyConfig({
    ...credentials,
    peerId: deriveWorkspacePeerId(workspace),
    userAgent: cfg.userAgent,
    timeoutMs: cfg.timeoutMs,
    debug: cfg.debug,
    debugLogPath: cfg.debugLogPath,
    watchedPaths: [credentials.cliPath, credentials.ovPath, credentials.cliPathCandidate],
  });
}

// Preserve the public API while making actor scope the default for search.
const scopedFetch = (url, options = {}) => {
  const message = JSON.parse(options.body || "null");
  if (message?.method === "tools/call" && message.params?.name === "search") {
    const args = message.params.arguments ||= {};
    args.peer_scope ??= "actor";
    options = { ...options, body: JSON.stringify(message) };
  }
  return fetch(url, options);
};
createOpenVikingMcpProxy({ readConfig, loggerFactory: createLogger, fetchImpl: scopedFetch }).start();
