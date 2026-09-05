import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRedactor } from '../lib/redact.mjs';

// Module mocks are isolated to this child process, so actual SDK and bridge
// imports used by the other suites retain their original implementations.
test('bridge keeps application feedback recoverable over the MCP protocol', async () => {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  let result;
  try {
    result = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', '--test',
      fileURLToPath(new URL('./support/bridge-contract.mjs', import.meta.url))], { timeout: 30000, env: environment });
  } catch (error) {
    const redactor = createRedactor();
    const diagnostic = redactor.text(`stdout:\n${String(error.stdout ?? '')}\nstderr:\n${String(error.stderr ?? '')}`).slice(0, 16000);
    assert.fail(`Bridge protocol test subprocess failed (${error.code ?? error.signal ?? 'unknown'}).\n${diagnostic}`);
  }
  assert.match(result.stdout, /pass 1/);
  assert.match(result.stdout, /fail 0/);
});
