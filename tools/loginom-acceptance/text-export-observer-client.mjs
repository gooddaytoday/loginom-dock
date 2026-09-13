// Acceptance entry only. No native admission exists in this revision.
import {NATIVE_SMOKE_ADMITTED} from './text-export-observer-policy.mjs';
if(!NATIVE_SMOKE_ADMITTED)throw Error('TEXT_EXPORT_NATIVE_SMOKE_NOT_ADMITTED');
const {Client}=await import('../../client/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
const {Server}=await import('../../client/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js');
const {CallToolRequestSchema}=await import('../../client/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js');
const {readFile,realpath}=await import('node:fs/promises');
const {join,resolve}=await import('node:path');
const {performance}=await import('node:perf_hooks');
const {installObserverSdk}=await import('./text-export-observer-sdk.mjs');
process.umask(0o077);
const i=process.argv.indexOf('--state-dir'),stateDirectory=process.argv[i+1],runDirectory=process.env.DOCK_ACCEPTANCE_RUN_DIR;
if(i<0||!runDirectory||await realpath(stateDirectory)!==resolve(stateDirectory)||await realpath(runDirectory)!==resolve(runDirectory)||stateDirectory!==join(runDirectory,'private','dock-state'))throw Error('Observer isolation unavailable');
const run=JSON.parse(await readFile(join(runDirectory,'request.json'),'utf8'));
if(run.goal_id!=='text-export-node-complete'||run.scope!=='source_runtime'||run.acceptance_observer?.contract!==2)throw Error('Observer run contract differs');
// Run start is set by the outer host, never by the model or observer.
const remaining=Number(process.env.DOCK_ACCEPTANCE_DEADLINE_EPOCH_MS)-Date.now();
if(!Number.isFinite(remaining)||remaining<=0)throw Error('Observer overall deadline unavailable');
installObserverSdk({Client,Server,CallToolRequestSchema,runDirectory,stateDirectory,run,overallDeadline:performance.now()+remaining});
await import('../../client/bin/loginom-dock.mjs');
