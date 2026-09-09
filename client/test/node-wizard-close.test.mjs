import test from 'node:test';
import assert from 'node:assert/strict';
import {wizardCloseBinding,boundWizardCloseConfirmation,cancelledWizardReady} from '../lib/node-wizard-close.mjs';
const fixture=()=>{
 const state={prepared_node_context:{verified:true,surface:'wizard',document_id:'doc',workflow_id:'flow',node_id:'node'},
  wizard:{status:'observed',root_ref:'wizard',root_tid:'MF;TF-1;WizrdMCF',stage:'done',owner_context:{status:'observed',node:{tid:'node',label:'Import'},path:[]}},
  ui:{dialogs:[],masks:[],elements:[]}};
 const binding=wizardCloseBinding(state);
 state.ui.dialogs=[{ref:'dialog',title:'Подтвердить',text:'Подтвердить Вы действительно хотите закрыть мастер настройки? Да Нет'}];
 state.ui.masks=[{ref:'wizard',kind:'modal_background'}];
 state.ui.elements=['yes','no'].map(name=>({ref:name,tid:'msgbox;tlb;'+name,label:name==='yes'?'Да':'Нет',signature:{dialog_ref:'dialog'},allowed_actions:['click']}));
 return {state,binding};
};
test('Close waits for the same unlocked node, not merely a visible graph',()=>{
 const {binding}=fixture();
 const state={wizard:{status:'absent'},prepared_node_context:{...binding.node,verified:true,surface:'graph',locked:false},ui:{dialogs:[],masks:[]}};
 assert.equal(cancelledWizardReady(state,binding),true);
 for(const change of [s=>s.prepared_node_context.locked=true,s=>delete s.prepared_node_context.locked,
  s=>s.prepared_node_context.node_id='other',s=>s.prepared_node_context.document_id='other',
  s=>s.prepared_node_context.workflow_id='other',s=>s.prepared_node_context.verified=false,
  s=>s.ui.dialogs.push({}),s=>s.ui.masks.push({}),s=>s.wizard.status='observed']) {
  const altered=structuredClone(state);change(altered);assert.equal(cancelledWizardReady(altered,binding),false);
 }
});
test('close confirmation requires the exact wizard, node, question and answer owners',()=>{
 const {state,binding}=fixture();assert.equal(boundWizardCloseConfirmation(state,binding),true);
 for(const change of [s=>s.prepared_node_context.node_id='other',s=>s.wizard.root_ref='other',s=>s.wizard.stage='other',
  s=>s.wizard.owner_context.node.label='other',s=>s.ui.dialogs[0].text='Удалить узел?',s=>s.ui.dialogs.push({...s.ui.dialogs[0]}),
  s=>s.ui.elements[0].signature.dialog_ref='other',s=>s.ui.elements[0].label='Нет',s=>s.ui.masks[0].kind='busy',
  s=>s.ui.masks[0].ref='other',s=>s.ui.elements.push({...s.ui.elements[0]})]) {
  const altered=structuredClone(state);change(altered);assert.equal(boundWizardCloseConfirmation(altered,binding),false);
 }
});
test('portal discovery alone cannot authorize the affirmative click',()=>{
 const {state,binding}=fixture();state.ui.elements=[];
 assert.equal(boundWizardCloseConfirmation(state,binding,false),true);
 assert.equal(boundWizardCloseConfirmation(state,binding),false);
});
test('the deactivation prompt is not a wizard cancellation even when native button IDs coincide',()=>{
 const {state,binding}=fixture();
 state.ui.dialogs[0].title='Loginom 7.4.2';
 state.ui.dialogs[0].text='Loginom 7.4.2 Настройка узла приведет к его деактивации. Вы действительно хотите начать настраивать узел? Да Да, больше не спрашивать Нет';
 state.ui.elements.find(e=>e.tid==='msgbox;tlb;no').label='Да, больше не спрашивать';
 state.ui.elements.push({ref:'cancel',tid:'msgbox;tlb;cancel',label:'Нет',signature:{dialog_ref:'dialog'},allowed_actions:['click']});
 assert.equal(boundWizardCloseConfirmation(state,binding),false);
});
