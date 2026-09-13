import {makeTextExportContextCode,readTextExportContext,readTextExportBrowser} from './text-export-context.mjs';
import {readPreparedNodeContext} from './node-context.mjs';
import {EXPORT_FIELDS,nativeExportValue,validateExportDestination,validateNativeExportFormat} from './text-export-parameters.mjs';
import {withBrowserReceipt} from './executor.mjs';
import {createHash} from 'node:crypto';
const need=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// The only specialized lifecycle gesture is Next on the file path page: native
// Loginom may ask an exact-path overwrite question instead of advancing.
export function makeExportNextCode(task){
 return `async page=>(${exportNext.toString()})(page,${JSON.stringify(task)},${readPreparedNodeContext.toString()},${readTextExportContext.toString()},${readTextExportBrowser.toString()},${JSON.stringify(EXPORT_FIELDS)})`;
}
export async function exportNext(page,task,readNode,readContext,readBrowser,fields){
 let effect=false;const result=(status,code,output={},cleanup=false)=>({status,action_key:'node.export.next',action_revision:'1',operation_id:task.operation_id,phase:'export_next',effect_possible:effect,cleanup_complete:cleanup,output,error:code?{code,message:code}:null,trace:[]});
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),base=task.binding.workflow_ref.prefix+';WizrdMCF;';
 const read=()=>readContext(page,task.binding,readNode,readBrowser,fields);
 try{
  if(!['reject','replace'].includes(task.overwrite)||!await page.evaluate(origin=>location.origin===new URL(origin).origin,task.origin))return result('NOT_APPLIED','EXPORT_NEXT_SCOPE',{},true);
  const before=await read();if(!before.verified||before.stage!=='text_export_params'||!same(before,task.before)||before.values.destination.value!==task.destination)return result('NOT_APPLIED','EXPORT_NEXT_CONTEXT',{},true);
  const click=async(tid,label)=>{
   const l=page.locator('[data-tid='+JSON.stringify(tid)+']');if(await l.count()!==1)throw Error('ambiguous control');
   const h=await l.elementHandle();try{
    const ok=await h.evaluate((e,label)=>{const b=e.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return e.isConnected&&b.width>0&&b.height>0&&!e.classList.contains('x-item-disabled')&&(!label||e.textContent.trim()===label)&&!!hit&&(hit===e||e.contains(hit));},label);
    if(!ok)throw Error('control blocked');effect=true;await h.click({timeout:5000});
   }finally{await h.dispose();}
  };
  await click(base+'btnNext');let answered=false,decision=null;
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   const owner=await readNode(page,task.binding);if(!owner.verified||owner.surface!=='wizard'||owner.node_id!==task.binding.node.node_id)throw Error('owner changed');
   const question=await page.evaluate(destination=>{
    const windows=[...document.querySelectorAll('.x-window')].filter(e=>e.checkVisibility({checkVisibilityCSS:true}));
    if(!windows.length)return {present:false};if(windows.length!==1)return {present:true,exact:false};
    const w=windows[0],q=w.querySelector('[data-tid="msgbox;cnt;cnt;cmp"]'),title=w.querySelector('[data-tid="msgbox;p.h;p.t"]');
    return {present:true,exact:title?.textContent.trim()==='Loginom 7.4.2'&&q?.textContent.trim()==='Файл с именем '+destination+' существует. Записать поверх?'};
   },task.destination);
   if(question.present){
    if(!question.exact||answered)throw Error('unexpected export dialog');
    const current=await read();if(!same(current,before))throw Error('export parameters changed before decision');
    decision=task.overwrite;answered=true;await click('msgbox;tlb;'+(decision==='replace'?'yes':'no'),decision==='replace'?'Да':'Нет');
    continue;
   }
   const current=await read();
   if(current.verified&&current.stage==='text_export_format')return result('SUCCEEDED',null,{verified:true,destination:task.destination,overwrite:task.overwrite,existed:answered,decision,format_page:current,node_context:owner},true);
   if(answered&&decision==='reject'&&same(current,before))return result('SUCCEEDED',null,{verified:true,destination:task.destination,overwrite:'reject',existed:true,decision:'reject',rejected:true,node_context:owner},true);
   await page.waitForTimeout(100);
  }
  return result('AMBIGUOUS','EXPORT_NEXT_UNSETTLED');
 }catch{return result(effect?'AMBIGUOUS':'NOT_APPLIED','EXPORT_NEXT_UNCONFIRMED',{},!effect);}
}

export async function configureTextExport(channel,p,ctx,options){
 const binding={document_id:ctx.document_id,workflow_ref:ctx.workflow_ref,node:ctx.node};
 const {execute,onRecord,operation,receiptOptions}=options;
 const native=async()=>{const r=await execute(makeTextExportContextCode(binding));need(r.verified,'Export context unavailable: '+r.reason);await onRecord({phase:'text_export_native_read',operation_id:operation.id,configuration:r});return r;};
 const initial={},configured={};
 const readUi=stage=>channel.observe({condition:'bound '+stage,ready:s=>s.wizard?.stage===stage});
 const one=es=>{need(es.length===1,'Unique export control required');return es[0];};
 for(const stage of ['text_export_params','text_export_format']){
  let current=await native();need(current.stage===stage,'Wrong export stage');initial[stage]=current;
  for(const [key,value]of Object.entries(p)){
   if(key==='overwrite'||EXPORT_FIELDS[key]?.[0]!== (stage==='text_export_params'?'ExportTextFileParamsWizard':'ExportTextFilePreviewWizard'))continue;
   const expected=nativeExportValue(key,value);if(current.values[key].value===expected)continue;
   const tid=current.values[key].tid;let s=await readUi(stage);
   if(key==='bom'){
    const control=one(s.ui.elements.filter(e=>e.tid===tid+';DisplayEl'&&e.allowed_actions.includes('set_checked')));
    await channel.perform({condition:'export BOM',initialObservation:s,ready:s=>s.wizard?.stage===stage,identity:()=>({node:ctx.node,key,value}),resolve:()=>({verb:'set_checked',ref:control.ref,checked:value})});
   }else if(key==='destination'){
    const control=one(s.ui.elements.filter(e=>e.wizard_field?.scope==='export_format'&&e.wizard_field.name===key&&e.allowed_actions.includes('set_wizard_field')));
    await channel.perform({condition:'export destination',initialObservation:s,ready:s=>s.wizard?.stage===stage,identity:()=>({node:ctx.node,key,value}),resolve:()=>({verb:'set_wizard_field',ref:control.ref,text:value})});
   }else{
    const picker=one(s.ui.elements.filter(e=>e.tid===tid+';trg_picker'&&e.allowed_actions.includes('click')));
    await channel.perform({condition:'export options '+key,initialObservation:s,ready:s=>s.wizard?.stage===stage,identity:()=>({node:ctx.node,key}),resolve:()=>({verb:'click',ref:picker.ref})});
    s=await channel.observe({condition:'export option '+key,ready:s=>s.wizard?.stage===stage&&s.ui.elements.some(e=>e.allowed_actions.includes('select_wizard_option'))});
    const labels={encoding:'UTF-8 (65001)',delimiter:{';':'Точка с запятой',',':'Запятая','\t':'Символ табуляции'}[value],header:{none:'Нет строки заголовков',names:'Имена полей',labels:'Метки полей'}[value],line_ending:{LF:'Unix (LF)',CRLF:'Windows (CRLF)'}[value],text_qualifier:'Двойная кавычка (")',decimal_separator:{'.':'Точка (.)',',':'Запятая (,)'}[value],date_separator:{'.':'Точка (.)','/':'Слэш (/)','\\':'Обратный слэш (\\)','-':'Дефис (-)'}[value],time_separator:{':':'Двоеточие (:)','.':'Точка (.)'}[value],null_marker:value===''?'Пустая строка':value};
    const label=labels[key]??value,choice=one(s.ui.elements.filter(e=>e.allowed_actions.includes('select_wizard_option')&&e.label===label&&e.tid.startsWith(tid+';boundlist;')));
    await channel.perform({condition:'choose export '+key,initialObservation:s,ready:s=>s.wizard?.stage===stage,identity:()=>({node:ctx.node,key,value}),resolve:()=>({verb:'select_wizard_option',ref:choice.ref})});
   }
   const after=await native();need(after.values[key].value===expected,'Export setting differs: '+key);
   for(const other of Object.keys(current.values))if(other!==key)need(same(current.values[other],after.values[other]),'Unrequested export setting changed: '+other);
   current=after;
  }
  configured[stage]=current;
  if(stage==='text_export_format'&&ctx.finish!=='close')validateNativeExportFormat(current.values);
  if(stage==='text_export_params'){
   const destination=validateExportDestination(current.values.destination.value);
   const id=operation.id+':export-next',task={binding,before:current,destination,overwrite:p.overwrite??'reject',origin:options.targetOrigin,operation_id:id};
   const signature=createHash('sha256').update(JSON.stringify(task)).digest('hex');
   await onRecord({phase:'text_export_next_prepared',operation_id:operation.id,task,signature});
   const result=await execute(withBrowserReceipt('('+makeExportNextCode(task)+')(page)',{...receiptOptions(id,'node.export.next',signature),operation_id:id}));
   await onRecord({phase:'text_export_next_completed',operation_id:operation.id,outcome:result});
   need(result.status==='SUCCEEDED'&&result.cleanup_complete,'Export Next or overwrite decision uncertain');
   if(result.output.rejected){const closed=await options.close(channel);const e=Error('Export destination exists; reject policy preserved it');e.nodePhaseRefusal={phase:'configure',status:'FAILED',effect_possible:true,cleanup_complete:closed.cleanup_complete,settings_unchanged:true,verification:'text_export_conflict_rejected'};throw e;}
   configured.destination_check=result.output;
  }
 }
 const destination=configured.text_export_params.values.destination.value;
 if(ctx.finish!=='close')await channel.perform({condition:'finish export configuration',ready:s=>s.wizard?.stage==='text_export_format',identity:()=>ctx.node,resolve:s=>({verb:'wizard_step',ref:one(s.ui.elements.filter(e=>e.tid===s.wizard.root_tid+';btnNext'&&e.allowed_actions.includes('wizard_step'))).ref,expected_stage:'done'})});
 return {verified:true,cleanup_complete:true,effect_possible:true,configuration:{initial,configured,destination},source_identity_verified:true};
}
