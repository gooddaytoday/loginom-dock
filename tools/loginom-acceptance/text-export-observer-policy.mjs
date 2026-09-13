// Contract 2: narrow, closed host policy. No caller-supplied JavaScript.
export const REVISION='node17-reject-read-observer.2-unadmitted';
export const NATIVE_SMOKE_ADMITTED=false;
export const need=(v,m)=>{if(!v)throw Error(m);};
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Only this proven pre-gesture refusal permits a new return observation.
export const safeReturnRefusal=r=>r?.status==='NOT_APPLIED'&&r.phase==='preconditions'
 &&r.error?.code==='UI_EPOCH_CHANGED'&&r.effect_possible===false&&r.cleanup_complete===true
 &&Array.isArray(r.trace)&&!r.trace.some(e=>['ui_preconditions_verified','ui_gesture_applied'].includes(e.event));
export const returnBinding=(s,e)=>({document:s.dom_epoch?.document,workflow:s.workflow_ref,
 active_identity:s.active_identity,package:s.package_identity,target:{tid:e.tid,label:e.label,kind:e.kind,scope:e.scope}});
export function checkStep(step,c){
 const kinds=['graph','roots','root','row','files','home','folder','download','return'];
 need(step&&kinds.includes(step.kind),'Unregistered observer action');
 const path=c.baseline.destination,name=path.split('/').at(-1),directory=path.slice(0,-name.length-1);
 need(/^\/test-2\/[A-Za-z0-9_.-]+\.(csv|tsv)$/.test(path),'Exact flat test-2 export required');
 if(['graph','roots'].includes(step.kind))need(Object.keys(step).length===1,'Unexpected observation arguments');
 if(step.kind==='row')need([name,'test-2'].includes(step.name)&&Object.keys(step).length===2,'Foreign row');
 if(step.kind==='root')need(typeof step.ref==='string'&&Object.keys(step).length===2,'Unknown root');
 if(['files','home','folder','return','download'].includes(step.kind)){
  const s=step.snapshot,e=step.element;
  need(s?.authenticated===true&&s.origin===c.origin&&s.loginom_build==='7.4.2'&&!s.ui?.dialogs?.length&&!s.ui?.masks?.length,'Observer owner blocked');
  need(s.ui.elements.filter(x=>same(x,e)).length===1,'Unissued observer element');
  const prefix=s.workflow_ref?.prefix;
  const tid=step.kind==='files'?'MF;cntMain;tlbMainToolbar;btnFilestorage':step.kind==='home'?prefix+';cnrNaviMode;b.s_Сервер>Файлы':step.kind==='return'?c.workflow_ref.tab_tid:prefix+';FileStorageForm;colName_'+(step.kind==='folder'?'test-2':name);
  need(e.tid===tid,'Forbidden observer gesture');
  const verb=['folder','download'].includes(step.kind)?'double_click':'click';need(e.allowed_actions?.includes(verb),'Observer action unavailable');
  if(step.kind==='folder')need(s.file_storage?.directory==='/'&&e.storage_entry?.kind==='folder'&&e.label==='test-2','Foreign directory navigation');
  if(step.kind==='download')need(s.file_storage?.directory===directory&&e.label===name&&e.storage_entry?.bytes===c.baseline.bytes&&e.interaction?.state==='point_observed','Exact visible file required; no implicit scroll');
 }
 return true;
}
export function checkActionLedger(ledger,c){
 need(Array.isArray(ledger)&&ledger.length>=6&&ledger.length<=512,'Incomplete action ledger');
 for(const [i,e] of ledger.entries()){
  need(e.seq===i+1&&e.session_id===c.session_id&&e.run_id===c.run_id&&e.cleanup_complete===true&&e.mono_end>=e.mono_start&&(i===0||e.mono_start>=ledger[i-1].mono_end),'Action chain differs');
  checkStep(e.step,c);need(/^[a-f0-9]{64}$/.test(e.code_sha256)&&e.response!==undefined,'Raw browser evidence missing');
 }
 need(ledger[0].step.kind==='graph'&&ledger.at(-1).step.kind==='graph','Graph observations required');
 for(const kind of ['download','files'])need(ledger.filter(e=>e.step.kind===kind).length===1,'Exactly one '+kind+' required');
 const returns=ledger.filter(e=>e.step.kind==='return');need(returns.length>=1&&returns.length<=3&&returns.at(-1).response.status==='SUCCEEDED','One completed return required');
 need(returns.slice(0,-1).every(e=>safeReturnRefusal(e.response)),'Unsafe return retry');
 need(returns.every(e=>same(returnBinding(e.step.snapshot,e.step.element),returnBinding(returns[0].step.snapshot,returns[0].step.element))),'Return target changed');
 const d=ledger.findIndex(e=>e.step.kind==='download'),r=ledger.findLastIndex(e=>e.step.kind==='return');need(d>0&&r>d&&r<ledger.length-1,'Return/download order differs');
 need(!ledger.slice(d+1).some(e=>['files','folder','home','download'].includes(e.step.kind)),'Navigation after download differs');
 return true;
}
