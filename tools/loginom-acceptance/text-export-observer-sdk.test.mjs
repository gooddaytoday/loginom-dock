import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {offlineProof} from './text-export-observer-offline.mjs';
import {syntheticBinding} from './text-export-observer-fixture.mjs';
import {bindObserver} from './text-export-observer-binding.mjs';
import {checkStep,NATIVE_SMOKE_ADMITTED} from './text-export-observer-policy.mjs';
async function run(t,options){const root=await mkdtemp(join(tmpdir(),'node17-sdk-unit-'));t.after(()=>rm(root,{recursive:true,force:true}));return offlineProof(root,options);}
test('real SDK in-memory wrapper passes exact request once after synthetic native chain',async t=>{const r=await run(t);assert.equal(r.error,null);assert.equal(r.dispatched,1);assert.equal(r.calls,14);assert.equal(NATIVE_SMOKE_ADMITTED,false);});
test('unregistered foreign invocation poisons observer even when swallowed',async t=>{const r=await run(t,{illegalCallAt:3});assert.equal(r.illegalBlocked,true);assert.equal(r.dispatched,0);assert.equal(r.hook.violated,true);});
test('foreign owner, navigation, source, hidden scroll, duplicate download and cleanup negatives',async t=>{
 const variants=[
  [0,r=>({...r,document_id:'foreign'})],
  [0,r=>({...r,links:[]})],
  [2,r=>{r.output.ui.elements[0].tid='MF;Configure';return r;}],
  [5,r=>{r.output.file_storage.directory='/other';return r;}],
  [7,r=>{r.output.ui.elements[0].interaction.state='outside_viewport';return r;}],
  [8,r=>({...r,observer_download_count:2})],
  [8,r=>({...r,cleanup_complete:false})],
  [13,r=>{r.nodes[0].ref.node_id='other';return r;}]
 ];
 for(const [index,modify] of variants){const r=await run(t,{changeResponse:(r,i)=>i===index?modify(r):r});assert.equal(r.dispatched,0);assert.ok(r.error);}
});
test('binding refuses stale source, foreign run and unterminated operation anchors',()=>{
 const f=syntheticBinding();for(const change of [x=>{x.run.run_id='old'},x=>{x.session.sessionId='foreign'},x=>{const e=x.journal.trim().split('\n');x.journal=[e[0],...e.slice(2),e[1]].join('\n')},x=>{x.journal+=JSON.stringify({session_id:'session',runtime_revision:'a'.repeat(64),phase:'node_apply_prepared',operation_id:'pending'})+'\n'}]){
  const x=structuredClone(f);change(x);assert.throws(()=>bindObserver({...x,overallDeadline:performance.now()+60000}));
 }
});
test('unknown gestures never enter the native builder allowlist',()=>{const f=syntheticBinding(),c=bindObserver({...f,overallDeadline:performance.now()+60000});for(const kind of ['Configure','Finish','Execute','save','upload','reload','press','evaluate','scroll'])assert.throws(()=>checkStep({kind},c));});

test('lower-level SDK request cannot bypass the observer allowlist',async t=>{const r=await run(t,{illegalCallAt:3,illegalDirect:true});assert.equal(r.illegalBlocked,true);assert.equal(r.dispatched,0);assert.equal(r.hook.violated,true);});

test('issued compact workflow ref stays unchanged on the wire and binds full journal identity',async t=>{const r=await run(t,{compactWorkflow:true});assert.equal(r.error,null);assert.equal(r.dispatched,1);});

// MCP JSON field order is not part of document/workflow/node identity.
test('binding accepts reordered JSON keys but refuses changed or extra identity fields',()=>{
 const f=syntheticBinding();
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;
 const original=bindObserver({...f,overallDeadline:1000});
 const ordered={...f,request:reorder(f.request)};
 assert.deepEqual(bindObserver({...ordered,overallDeadline:1000}),original);
 const journal=f.journal.trim().split('\n').map(JSON.parse).map(reorder).map(JSON.stringify).join('\n')+'\n';
 assert.deepEqual(bindObserver({...ordered,journal,overallDeadline:1000}).identity,original.identity);
 for(const key of ['document_id','workflow_id','node_id','extra']){
  const changed=structuredClone(ordered);changed.request.params.arguments.target.ref[key]='foreign';
  assert.throws(()=>bindObserver({...changed,overallDeadline:1000}));
 }
});
