// Acceptance-only adapter. Reuses observed UI primitives; never starts a client.
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {relative} from 'node:path';
import {readFile} from 'node:fs/promises';
import {makeWorkspaceUiCode} from '../../client/lib/workspace-ui.mjs';
import {makeNativeOutputDownloadCode} from '../../client/lib/executor.mjs';
import {createNodeTargetBrowserAdapter} from '../../client/lib/node-target-browser.mjs';
import {need,same,checkStep,checkActionLedger} from './text-export-observer-policy.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const one=xs=>{need(xs.length===1,'Unique observed control required');return xs[0];};
export function parseBrowserResult(reply){
 need(!reply?.isError,'Browser call failed');
 const results=(reply.content??[]).filter(x=>x.type==='text').flatMap(x=>{try{return [JSON.parse(x.text.match(/^### Result\n([\s\S]*?)(?:\n### |$)/)?.[1]??x.text)];}catch{return [];}});
 return one(results);
}
export function projectGraph(g,c){
 need(g?.complete===true&&g.interaction_ready===true&&g.document_id===c.identity.document_id&&same(g.workflow_ref,c.workflow_ref),'Foreign graph owner');
 for(const id of [c.identity.node_id,c.identity.source_node_id])need(g.nodes.filter(n=>n.ref.node_id===id&&n.ref.document_id===c.identity.document_id&&n.ref.workflow_id===c.identity.workflow_id).length===1,'Missing graph/source identity');
 const edges=g.links.filter(e=>e.target===c.identity.node_id);
 need(edges.length===1&&same(edges[0],c.source_edge),'Observed source anchor changed');
 return {complete:true,...c.identity,workflow_ref:g.workflow_ref,settings_verified:false,graph:{nodes:g.nodes.map(({dom_epoch,...n})=>n),links:g.links,foreign_links:g.foreign_links}};
}
export function createNativeObserver({invoke,artifactRoot,record=async()=>{},clock=()=>performance.now()}){
 return async({context:c,readId,deadline,downloadPath,signal})=>{
  const ledger=[],seenRefs=new Set(),base={expected_origin:c.origin,expected_build:'7.4.2'};
  const guard=()=>{signal.throwIfAborted();need(clock()<deadline,'Observer deadline');};
  const run=async(step,code)=>{
   guard();checkStep(step,c);
   if(step.kind==='root')need(seenRefs.has(step.ref),'Unknown observation root');
   need(ledger.length<32,'Observer action count exceeded');
   const start=clock();await record({phase:'prepared',seq:ledger.length+1,step,code_sha256:hash(code),run_id:c.run_id,session_id:c.session_id,mono_start:start});guard();
   const response=await invoke({code,signal,timeout:Math.max(1,Math.floor(deadline-clock()))});guard();
   const result=parseBrowserResult(response);
   if(result.status!==undefined)need(result.status==='SUCCEEDED','Native step incomplete');
   if(['files','home','folder','return'].includes(step.kind))need(result.cleanup_complete===true&&result.output?.gesture_applied===true,'Navigation cleanup unknown');
   for(const e of result.output?.ui?.elements??[])seenRefs.add(e.ref);
   const entry={seq:ledger.length+1,run_id:c.run_id,session_id:c.session_id,mono_start:start,mono_end:clock(),step,code_sha256:hash(code),response:result,cleanup_complete:true};
   await record({phase:'completed',...entry});guard();ledger.push(entry);
   return result;
  };
  const graph=async()=>{
   let calls=0;
   const adapter=createNodeTargetBrowserAdapter({origin:c.origin,build:'7.4.2',execute:code=>{need(++calls===1,'Graph retry forbidden');return run({kind:'graph'},code);}});
   return projectGraph(await adapter.observe(c.graph_request,Date.now()+Math.max(1,deadline-clock())),c);
  };
  const observe=async(step)=>{
   const options=step.kind==='roots'?{discover_roots:true}:step.kind==='row'?{discover_roots:true,storage_name:step.name}:{root_ref:step.ref};
   return (await run(step,makeWorkspaceUiCode({mode:'observe',...base,...options}))).output;
  };
  const roots=()=>observe({kind:'roots'}),root=ref=>observe({kind:'root',ref});
  const nav=async(kind,s,e)=>run({kind,snapshot:s,element:e},makeWorkspaceUiCode({mode:'act',...base,snapshot:s,action:{verb:kind==='folder'?'double_click':'click',ref:e.ref}}));
  const control=async tid=>{const s=await roots(),e=one(s.ui.elements.filter(e=>e.tid===tid));return root(e.ref);};
  const directory=async()=>{let s=await roots();const e=one(s.ui.elements.filter(e=>e.tid===s.workflow_ref?.prefix+';NavigationBar;NavigationPanel'));return root(e.ref);};
  const row=async name=>{let s=await observe({kind:'row',name});return root(one(s.ui.elements.filter(e=>e.tid===s.workflow_ref.prefix+';FileStorageForm;colName_'+name)).ref);};
  const before=await graph();
  let s=await control('MF;cntMain;tlbMainToolbar');await nav('files',s,one(s.ui.elements.filter(e=>e.tid==='MF;cntMain;tlbMainToolbar;btnFilestorage')));
  s=await directory();
  if(!['/','/test-2'].includes(s.file_storage?.directory)){
   await nav('home',s,one(s.ui.elements.filter(e=>e.tid===s.workflow_ref.prefix+';cnrNaviMode;b.s_Сервер>Файлы')));s=await directory();need(s.file_storage.directory==='/','Unknown navigation');
  }
  if(s.file_storage.directory==='/'){
   s=await row('test-2');await nav('folder',s,one(s.ui.elements.filter(e=>e.label==='test-2'&&e.storage_entry?.kind==='folder')));
   s=await directory();
  }
  need(s.file_storage?.directory==='/test-2','Exact storage not reached');
  const name=c.baseline.destination.split('/').at(-1);s=await row(name);
  const e=one(s.ui.elements.filter(e=>e.tid===s.workflow_ref.prefix+';FileStorageForm;colName_'+name&&e.label===name));
  const step={kind:'download',snapshot:s,element:e};checkStep(step,c);
  const task={...base,operation_id:'observer:'+readId,artifact:{artifact_id:readId,name},output_binding:{session_id:c.session_id,document_id:c.identity.document_id,workflow_id:c.identity.workflow_id,node_id:c.identity.node_id,execution_id:c.baseline.execution_id,destination:c.baseline.destination,directory:'/test-2'},expected_bytes:c.baseline.bytes,snapshot:s,file_ref:e.ref,observation_id:s.observation_id,download_path:downloadPath};
  const downloadCode=makeNativeOutputDownloadCode(task);
  // Refuse implicit reveal/scroll above; count all downloads on this exact Page.
  const counted=`async page=>{let count=0;const listener=()=>{count++};page.on('download',listener);try{const result=await (${downloadCode})(page);return {...result,observer_download_count:count,observer_listener_registered:true};}finally{page.off('download',listener);}}`;
  const downloaded=await run(step,counted);
  need(downloaded.cleanup_complete===true&&downloaded.observer_download_count===1&&downloaded.observer_listener_registered===true&&downloaded.output?.download_completed===true&&downloaded.output.suggested_name===name&&same(downloaded.output.output_binding,task.output_binding),'Native download binding incomplete');
  s=await control('MF;cntMain;cntWorkspace;Workspace;t.br');await nav('return',s,one(s.ui.elements.filter(e=>e.tid===c.workflow_ref.tab_tid)));
  const after=await graph();need(same(before,after),'Observed graph/identity changed');checkActionLedger(ledger,c);guard();
  const bytes=await readFile(downloadPath);guard();
  const payloads=[before,{}, {},{suggested_name:name,download_completed:true,destination:c.baseline.destination},c.identity,after];
  const raw=['snapshot_before','download_listener','download_gesture','download_completed','workflow_return','snapshot_after'].map((kind,i)=>({kind,seq:i+1,read_id:readId,session_id:c.session_id,origin:c.origin,payload:payloads[i]}));
  return {read_id:readId,before,after,destination:c.baseline.destination,bytes:bytes.length,sha256:hash(bytes),native_file:relative(artifactRoot,downloadPath),cleanup_complete:true,workflow_returned:true,listener_before_gesture:true,download_count:1,raw,action_ledger:ledger,settings_verified:false,global_atomicity_verified:false};
 };
}
