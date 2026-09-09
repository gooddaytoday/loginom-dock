import {resolveCalculatorPatch} from './calculator-parameters.mjs';

const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const types={integer:'Целый',real:'Вещественный',string:'Строковый',boolean:'Логический',datetime:'Дата/Время'};
const semantic=e=>Object.fromEntries(['name','label','type','formula','replace','intermediate','cached','description'].map(k=>[k,e[k]]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const control=(s,suffix,verb)=>{
 const matches=s.ui.elements.filter(e=>e.tid===s.wizard.root_tid+suffix&&e.allowed_actions.includes(verb));
 requireValue(matches.length===1,'Unique calculator control unavailable: '+suffix);return matches[0];
};

export async function configureCalculator(channel,parameters,{newNode=false}={}) {
 const ready=s=>s.wizard?.stage==='calculator'&&s.node_calculator?.verified===true;
 const observe=condition=>channel.observe({condition,readCalculator:true,ready});
 const baseline=await observe('complete calculator configuration before patch');
 const plan=resolveCalculatorPatch(parameters,baseline.node_calculator,baseline.node_calculator.input_fields,{newNode});
 const identities=new Map(baseline.node_calculator.expressions.map(e=>[e.name,e.record_id]));
 const row=(s,id)=>s.node_calculator?.expressions.find(e=>e.record_id===id);
 const select=async id=>{
  let s=await observe('select calculator expression by retained record');const e=row(s,id);requireValue(e,'Expression identity disappeared');
  if(e.selected)return s;
  await channel.perform({condition:'select retained expression',initialObservation:s,ready:s=>ready(s)&&!!row(s,id),identity:()=>({record_id:id}),
   resolve:s=>({verb:'click',ref:control(s,';CalcDataWizard;colExpressionName_'+row(s,id).name,'click').ref})});
  return observe('selected calculator expression');
 };
 for(const change of plan.changes) {
  let s,recordId=change.before?.record_id,addedTo=null;
  if(recordId)s=await select(recordId);
  else {
   s=await observe('calculator before adding one expression');const beforeIds=s.node_calculator.expressions.map(e=>e.record_id);addedTo=beforeIds;
   await channel.perform({condition:'add one calculator expression',initialObservation:s,ready,
    identity:s=>({node:s.prepared_node_context,record_ids:beforeIds}),
    resolve:s=>({verb:'click',ref:control(s,';CalcDataWizard;btnAddExpr','click').ref})});
   // Adding opens the parameter editor. Its selected row is the newly added
   // expression; the full native store is read again only after Apply.
   s=await channel.observe({condition:'new calculator expression editor',ready:s=>s.wizard?.stage==='calculator'&&s.wizard.expression_parameters?.status==='observed'});
   recordId=null;
  }
  const patch=change.after;
  if(change.before) {
   requireValue(same(semantic(row(s,recordId)),semantic(change.before)),'Expression changed since patch planning');
   if(['name','label','type'].some(k=>patch[k]!==change.before[k])) {
    await channel.perform({condition:'edit retained calculator parameters',initialObservation:s,ready,
     identity:()=>({record_id:recordId}),resolve:s=>({verb:'double_click',ref:control(s,';CalcDataWizard;colExpressionName_'+row(s,recordId).name,'double_click').ref})});
   }
  }
  if(!change.before||['name','label','type'].some(k=>patch[k]!==change.before[k])) {
   for(const [key,value] of Object.entries({name:patch.name,label:patch.label,type_label:types[patch.type]})) {
    s=await channel.observe({condition:'calculator parameter '+key,ready:s=>s.wizard?.stage==='calculator'&&s.wizard.expression_parameters?.fields[key]?.status==='observed'});
    const field=s.wizard.expression_parameters.fields[key];if(field.value===value)continue;
    if(key==='type_label') {
     const combo=s.ui.elements.find(e=>e.wizard_combo?.kind==='picker'&&e.wizard_combo.field?.name==='type_label'&&e.allowed_actions.includes('click'));
     requireValue(combo,'Calculator type dropdown unavailable');
     await channel.perform({condition:'open calculator type choices',initialObservation:s,ready:s=>s.wizard.expression_parameters?.status==='observed',
      identity:s=>s.wizard.expression_parameters.selected_expression,resolve:()=>({verb:'click',ref:combo.ref})});
     s=await channel.observe({condition:'calculator type choice '+value,ready:s=>s.ui.elements.some(e=>e.wizard_combo?.kind==='option'&&e.wizard_combo.label===value&&e.wizard_combo.field?.name==='type_label'&&e.allowed_actions.includes('select_wizard_option'))});
     await channel.perform({condition:'select calculator type '+value,initialObservation:s,ready:s=>s.ui.elements.some(e=>e.wizard_combo?.kind==='option'&&e.wizard_combo.label===value&&e.wizard_combo.field?.name==='type_label'),
      identity:()=>({type:value}),resolve:s=>({verb:'select_wizard_option',ref:s.ui.elements.find(e=>e.wizard_combo?.kind==='option'&&e.wizard_combo.label===value&&e.wizard_combo.field?.name==='type_label').ref})});
    } else await channel.perform({condition:'set calculator '+key,initialObservation:s,ready:s=>s.wizard.expression_parameters?.fields[key]?.status==='observed',
     identity:s=>({editor:s.wizard.expression_parameters.root_ref,expression:s.wizard.expression_parameters.selected_expression,key}),
     resolve:s=>({verb:'set_wizard_field',ref:s.wizard.expression_parameters.fields[key].input_ref,text:value})});
   }
   s=await channel.observe({condition:'calculator parameters ready to apply',ready:s=>s.wizard.expression_parameters?.status==='observed'});
   await channel.perform({condition:'apply calculator expression parameters',initialObservation:s,ready:s=>s.wizard.expression_parameters?.status==='observed',
    identity:s=>s.wizard.expression_parameters.selected_expression,
    resolve:s=>({verb:'apply_expression_parameters',ref:control(s,';ExprDataEditForm;btnApply','apply_expression_parameters').ref})});
  }
  s=await observe('applied calculator expression identity');
  const found=s.node_calculator.expressions.filter(e=>e.name===patch.name);
  requireValue(found.length===1&&(!recordId||found[0].record_id===recordId),'Applied expression identity differs');recordId=found[0].record_id;
  if(addedTo)requireValue(!addedTo.includes(recordId)&&s.node_calculator.expressions.length===addedTo.length+1
   &&addedTo.every(id=>s.node_calculator.expressions.some(e=>e.record_id===id)), 'Adding an expression replaced or duplicated another record');
  requireValue(found[0].label===patch.label&&found[0].type===patch.type,'Applied expression parameters differ');
  if(found[0].replace!==patch.replace) {
   await channel.perform({condition:'calculator replacement mode',initialObservation:s,ready:s=>ready(s)&&row(s,recordId)?.selected===true,
    identity:()=>({record_id:recordId,replace:patch.replace}),resolve:s=>({verb:'click',ref:control(s,';CalcDataWizard;btnReplaceField','click').ref})});
   s=await observe('calculator replacement applied');requireValue(row(s,recordId)?.replace===patch.replace,'Replacement mode differs');
  }
  if(row(s,recordId).formula!==patch.formula) {
   await channel.perform({condition:'replace selected calculator formula',initialObservation:s,ready:s=>ready(s)&&row(s,recordId)?.selected===true,
    identity:()=>({record_id:recordId}),resolve:s=>({verb:'replace_expression',ref:control(s,';CalcDataWizard;cmpExpression','replace_expression').ref,text:patch.formula})});
  }
  s=await observe('calculator formula and untouched options read back');
  requireValue(same(semantic(row(s,recordId)),semantic(patch)),'Calculator expression readback differs');identities.set(patch.name,recordId);
 }
 // Move existing records with Loginom controls. Never delete/recreate expressions
 // to obtain an order: dependent references and unrequested options survive.
 for(const [index,name] of plan.order.entries()) {
  const id=identities.get(name);let s=await select(id);
  while(row(s,id).index>index) {
   const before=row(s,id).index;
   await channel.perform({condition:'move calculator expression up one row',initialObservation:s,ready,
    identity:()=>({record_id:id,index:before}),resolve:s=>({verb:'click',ref:control(s,';CalcDataWizard;btnExprUp','click').ref})});
   s=await observe('calculator expression order changed');requireValue(row(s,id).index===before-1,'Expression order did not change exactly once');
  }
 }
 const final=await observe('complete configured calculator readback');
 requireValue(same(final.node_calculator.expressions.map(semantic),plan.expressions.map(semantic)),'Complete calculator differs from requested patch');
 return {verified:true,cleanup_complete:true,effect_possible:plan.changes.length>0||parameters.order!==undefined,
  before:baseline.node_calculator,configuration:final.node_calculator,settings_applied:false};
}
