#!/usr/bin/env node
// MCP initialize/list_tools only. No model, prepare, browser action, or UI call.
import { readFile } from 'node:fs/promises';
import { Client } from '../../client/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '../../client/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const selected = config.mcp_servers['loginom-dock'];
const client = new Client({ name: 'loginom-acceptance-tool-precheck', version: '1' });
const transport = new StdioClientTransport({ command: selected.command, args: selected.args,
  env: { ...getDefaultEnvironment(), ...selected.env }, stderr: 'pipe' });
transport.stderr?.on('data', () => {});
try {
  await client.connect(transport, { timeout: 180000 });
  const names = new Set(); let cursor;
  do {
    const result = await client.listTools(cursor ? { cursor } : {});
    result.tools.forEach(tool => names.add(tool.name)); cursor = result.nextCursor;
  } while (cursor);
  const required = ['dock_prepare','dock_action_describe','dock_action_run','dock_workspace_observe',
    'dock_operation_inspect','dock_operation_recover','dock_ui_action','find','read','grep','glob'];
  const missing = required.filter(name => !names.has(name));
  process.stdout.write(JSON.stringify({ available: missing.length === 0, required, missing, tools: [...names].sort(),
    scope: 'MCP initialize/list_tools only; no model, prepare or browser actions' }) + '\n');
  if (missing.length) process.exitCode = 1;
} catch {
  process.stdout.write(JSON.stringify({ available: false, error: 'MCP_TOOL_PRECHECK_FAILED',
    scope: 'MCP initialize/list_tools only; no model, prepare or browser actions' }) + '\n');
  process.exitCode = 1;
} finally { await client.close().catch(() => {}); }
