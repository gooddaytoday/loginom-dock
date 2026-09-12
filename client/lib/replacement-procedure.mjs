import {resolveReplacementParameters,replacementValueKey,validateReplacementParameters} from './replacement-parameters.mjs';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const need=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const normalized=r=>({field:{kind:'input_field',name:r.selected},type:r.input_fields.find(f=>f.name===r.selected).type,pairs:r.pairs.map(({from,to})=>({from,to})),other:r.other,...(r.input_fields.find(f=>f.name===r.selected).type==='string'?{case_sensitive:r.case_sensitive}:{precision:r.precision})});
const pairKeys=ps=>ps.map(p=>[replacementValueKey(p.from),replacementValueKey(p.to)]);
export async function revealReplacementAdd(channel,observe,ready){
 let s=await observe('replacement add header');
 for(let attempt=0;attempt<130;attempt++){
  const tid=s.wizard.root_tid+';ReplaceColumnsWizard;grdReplaceItems;tbl;GroupHeader;0;AddButton';
  if(s.ui.elements.some(e=>e.tid===tid&&e.allowed_actions.includes('click')))return s;
  const field=s.node_replacement.selected;
  const anchors=s.ui.elements.filter(e=>e.replacement_field?.role==='pair'&&e.replacement_field.field_key===field&&e.scroll?.top>0&&e.allowed_actions.includes('scroll'));
  need(anchors.length&&new Set(anchors.map(e=>e.scroll.ref)).size===1&&!s.node_replacement.editor_open,'Replacement add header cannot be revealed');
  const anchor=anchors[0],before=anchor.scroll;
  await channel.perform({condition:'reveal replacement add header',initialObservation:s,ready,
   identity:()=>({field,grid:before.ref}),resolve:()=>({verb:'scroll',ref:anchor.ref,delta_y:-400})});
  s=await observe('replacement add header scroll');
  const after=s.ui.elements.find(e=>e.scroll?.ref===before.ref)?.scroll;
  need(s.node_replacement.selected===field&&after&&after.top<before.top,'Replacement add header scroll did not move');
 }
 throw Error('Replacement add header scroll limit');
}
export async function configureReplacement(channel,p,{newNode=false}={}){
 const ready=s=>s.wizard?.stage==='replacement'&&s.node_replacement?.verified===true;
 const observe=(condition,extra=()=>true)=>channel.observe({condition,readReplacement:true,ready:s=>ready(s)&&extra(s.node_replacement)});
 let state=await observe('replacement input inventory');const baseline=state.node_replacement;
 resolveReplacementParameters(p,baseline.input_fields);
 const control=(s,suffix,verb='click')=>{const tid=s.wizard.root_tid+';ReplaceColumnsWizard;'+suffix,es=s.ui.elements.filter(e=>(e.tid===tid||['fill','press'].includes(verb)&&e.identity?.anchor_tid===tid)&&e.allowed_actions.includes(verb));need(es.length===1,'Replacement control unavailable: '+suffix);return es[0];};
 const act=async(suffix,verb='click',args={})=>{const s=suffix==='grdReplaceItems;tbl;GroupHeader;0;AddButton'?await revealReplacementAdd(channel,observe,ready):await observe('replacement control '+suffix);return channel.perform({condition:'replacement '+suffix,initialObservation:s,ready,identity:()=>({field:s.node_replacement.selected,suffix}),resolve:s=>({verb,ref:control(s,suffix,verb).ref,...args})});};
 const cell=(s,name,role,part,id)=>{const es=s.ui.elements.filter(e=>e.replacement_field?.field_key===name&&e.replacement_field.role===role&&e.replacement_field.part===part&&(id===undefined||e.replacement_field.record_id===id)&&e.allowed_actions.includes('click'));need(es.length===1,'Replacement bound cell unavailable: '+name+'/'+part);return es[0];};
 const reveal=async(name,role,part,id)=>{
  let s=await observe('replacement row readiness');
  for(let n=0;n<130;n++){
   if(s.ui.elements.some(e=>e.replacement_field?.field_key===name&&e.replacement_field.role===role&&e.replacement_field.part===part&&(id===undefined||e.replacement_field.record_id===id)&&e.allowed_actions.includes('click')))return s;
   const rows=role==='field'?s.node_replacement.input_fields:s.node_replacement.pairs,at=rows.findIndex(r=>role==='field'?r.name===name:r.record_id===id);
   const visible=s.ui.elements.filter(e=>e.replacement_field?.role===role&&e.replacement_field.part===part&&e.scroll&&e.allowed_actions.includes('scroll')).sort((a,b)=>rows.findIndex(r=>r.record_id===a.replacement_field.record_id)-rows.findIndex(r=>r.record_id===b.replacement_field.record_id));
   need(at>=0&&visible.length&&n<129,'Replacement row cannot be revealed');const first=rows.findIndex(r=>r.record_id===visible[0].replacement_field.record_id),last=rows.findIndex(r=>r.record_id===visible.at(-1).replacement_field.record_id),direction=at<first?-1:at>last?1:0;
   need(direction,'Replacement row obscured');const anchor=visible[Math.floor(visible.length/2)],before=anchor.scroll;
   await channel.perform({condition:'reveal replacement row',initialObservation:s,ready,identity:()=>({name,id,scroll:before.ref}),resolve:()=>({verb:'scroll',ref:anchor.ref,delta_y:direction*400})});
   s=await observe('replacement row scroll');const after=s.ui.elements.find(e=>e.scroll?.ref===before.ref)?.scroll;need(after&&direction*(after.top-before.top)>0,'Replacement scroll did not move');
  }
 };
 const gesture=async(name,role,part,id,verb='click')=>{const s=await reveal(name,role,part,id);await channel.perform({condition:'replacement '+part,initialObservation:s,ready,identity:()=>cell(s,name,role,part,id).replacement_field,resolve:s=>({verb,ref:cell(s,name,role,part,id).ref})});};
 const select=async name=>{
  const before=(await observe('replacement field before selection')).node_replacement;
  if(before.selected!==name){await gesture(name,'field','select');await observe('replacement field and table switched',r=>r.selected===name&&(!before.pairs.length||r.pairs.every(p=>!before.pairs.some(b=>b.record_id===p.record_id))));}
  return (await observe('replacement selected field',r=>r.selected===name)).node_replacement;
 };
 const oldRules=[];
 for(const f of baseline.input_fields.filter(f=>f.mode==='manual')){const r=await select(f.name);need(!r.editor_open,'Existing replacement row editor is active');oldRules.push(normalized(r));}
 if(newNode)need(oldRules.length===0,'New replacement has unexpected rules');
 if(oldRules.length)validateReplacementParameters({rules:oldRules},'exact',{target:{kind:'existing'},inputs:[],read:{ports:[]},mappings:[],finish:'done'});
 for(const rule of p.rules??[]){
  let r=await select(rule.field.name);
  if(r.input_fields.find(f=>f.name===rule.field.name).mode==='none'){
   await gesture(rule.field.name,'field','mode');await act('grdDataList;tbl;celleditor;cbx;boundlist;Ввод_вручную');
   r=(await observe('manual replacement mode applied',r=>r.input_fields.find(f=>f.name===rule.field.name).mode==='manual')).node_replacement;
  }
  for(const row of [...r.pairs].reverse()){
   await gesture(rule.field.name,'pair','delete',row.record_id);
   r=(await observe('replacement row deleted',r=>!r.pairs.some(p=>p.record_id===row.record_id))).node_replacement;
  }
  need(r.pairs.length===0,'Replacement table not cleared');
  for(const pair of rule.pairs){
   const before=r.pairs.map(p=>p.record_id);await act('grdReplaceItems;tbl;GroupHeader;0;AddButton');
   r=(await observe('replacement row added',r=>r.pairs.length===before.length+1)).node_replacement;
   const added=r.pairs.filter(p=>!before.includes(p.record_id));need(added.length===1,'Replacement added row ambiguous');
   await gesture(rule.field.name,'pair','from',added[0].record_id,'double_click');
   await observe('replacement row editor opened',r=>r.editor_open);
   for(const [side,value] of [['ReplaceEditor',pair.from],['ReplaceEditor-1',pair.to]]){
    const kind=rule.type==='string'?'txt':rule.type==='real'?'num':'Int64Field',suffix=side+';fldVariant;ValueContainer;'+kind;
    if(value.value===null)await act(suffix+';trg_SetNullTrigger');
    else{
     const s=await observe('typed replacement editor');const es=s.ui.elements.filter(e=>e.allowed_actions.includes('fill')&&(e.identity?.anchor_tid===s.wizard.root_tid+';ReplaceColumnsWizard;'+suffix||e.tid===s.wizard.root_tid+';ReplaceColumnsWizard;'+suffix||e.tid?.startsWith(s.wizard.root_tid+';ReplaceColumnsWizard;'+suffix+';')));
     need(es.length===1,'Typed replacement input unavailable');await channel.perform({condition:'fill typed replacement value',initialObservation:s,ready,identity:()=>({field:rule.field.name,row:added[0].record_id,side}),resolve:()=>({verb:'fill',ref:es[0].ref,text:rule.type==='real'?String(value.value).replace('.',','):String(value.value)})});
    }
   }
   const s=await observe('replacement row ready to commit');await channel.perform({condition:'commit replacement row',initialObservation:s,ready,identity:()=>({field:rule.field.name,row:added[0].record_id}),resolve:s=>{const es=s.ui.elements.filter(e=>e.tid==='roweditorbuttons;update'&&e.allowed_actions.includes('click'));need(es.length===1,'Replacement row update unavailable');return {verb:'click',ref:es[0].ref};}});
   r=(await observe('replacement pair committed',r=>!r.editor_open&&r.pairs.some(p=>p.record_id===added[0].record_id&&same(pairKeys([p]),pairKeys([pair]))))).node_replacement;
  }
  if(rule.type==='string'&&r.case_sensitive!==rule.case_sensitive)await act('chkCaseSensitivity;DisplayEl','set_checked',{checked:rule.case_sensitive});
  if(rule.type!=='string'&&r.precision!==0)await act('edPrecision','fill',{text:'0'});
  if(r.other.mode!==rule.other.mode){await act('cbxReplaceOther;trg_picker');await act('cbxReplaceOther;boundlist;'+{keep:'Не_заменять',null:'На_пропущенное',value:'На_значение'}[rule.other.mode]);}
  if(rule.other.mode==='value'){
   need(rule.other.value.value!==null,'Use remaining null mode for Null');
   const suffix=rule.type==='string'?'edtReplaceOther':rule.type==='real'?'edtReplaceOtherFloat':'edtReplaceOtherInt';
   await act(suffix,'fill',{text:rule.type==='real'?String(rule.other.value.value).replace('.',','):String(rule.other.value.value)});
   await act('cbxReplaceOther','press',{key:'Tab'});
  }
  r=(await observe('complete replacement field readback')).node_replacement;
  need(same(pairKeys(r.pairs),pairKeys(rule.pairs))&&r.other.mode===rule.other.mode&&(rule.other.mode!=='value'||replacementValueKey(r.other.value)===replacementValueKey(rule.other.value))&&(rule.type==='string'?r.case_sensitive===rule.case_sensitive:r.precision===0),'Replacement field readback differs');
 }
 const expected=oldRules.filter(r=>!p.rules?.some(w=>w.field.name===r.field.name)).concat(p.rules??[]),rules=[];
 for(const f of baseline.input_fields){const current=(await observe('replacement final membership')).node_replacement.input_fields.find(x=>x.name===f.name);need(current.mode===(expected.some(r=>r.field.name===f.name)?'manual':'none'),'Unrequested replacement mode changed');if(current.mode==='manual')rules.push(normalized(await select(f.name)));}
 for(const rule of expected){const actual=rules.find(r=>r.field.name===rule.field.name);need(actual&&same(pairKeys(actual.pairs),pairKeys(rule.pairs))&&same({...actual,pairs:[]},{...rule,pairs:[],...(rule.other.mode==='value'?{other:{mode:'value',value:{...rule.other.value,value:rule.type==='integer'&&rule.other.value.value!==null?String(rule.other.value.value):rule.other.value.value}}}:{} )}),'Final replacement rule differs');}
 state=await observe('replacement final owner');
 const schema=fields=>fields.map(({record_id,name,label,type})=>({record_id,name,label,type}));
 need(same(schema(state.node_replacement.input_fields),schema(baseline.input_fields)),'Replacement input identity changed');
 return {verified:true,cleanup_complete:true,effect_possible:!!p.rules?.length,configuration:{...state.node_replacement,rules,requested_output_mode:p.output_mode??null},preservation:{unrequested_rules:true,input_identity:true}};
}
