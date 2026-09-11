import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedGraphSelection} from '../lib/node-graph-selection.mjs';
const state=()=>({prepared_node_context:{verified:true,surface:'graph',tid:'Graph;Node'},ui:{elements:[
 {tid:'Graph;Node',ref:'body',graph_node:{part:'body'},allowed_actions:['click'],interaction:{state:'point_observed'}},
 {tid:'Graph;Node;Label;Label',ref:'label',graph_node:{part:'label'},allowed_actions:['click'],interaction:{state:'point_observed'}}]}});
test('selects the body when painted, otherwise its exact native label',()=>{
 const s=state();assert.deepEqual(preparedGraphSelection(s),{verb:'click',ref:'body'});
 s.ui.elements[0].interaction.state='point_not_observed';assert.deepEqual(preparedGraphSelection(s),{verb:'click',ref:'label'});
});
test('refuses foreign labels, overlays, duplicate references and changed surfaces',()=>{
 for(const mutate of [s=>s.ui.elements[1].tid='Graph;Other;Label;Label',s=>s.ui.elements[1].graph_node.part='settings',
 s=>s.ui.elements[1].interaction.state='point_not_observed',s=>s.ui.elements.push({...s.ui.elements[1]}),s=>s.prepared_node_context.surface='wizard']){
  const s=state();s.ui.elements[0].interaction.state='point_not_observed';mutate(s);assert.throws(()=>preparedGraphSelection(s));
 }
});
test('dismisses covered hover controls and observes the body before selecting again',async()=>{
 const {selectPreparedGraphNode}=await import('../lib/node-graph-selection.mjs');
 const s=state();s.ui.elements[0].interaction.state='point_not_observed';const actions=[];
 const channel={perform:async o=>{assert.equal(o.ready(o.initialObservation),true);actions.push(o.resolve(o.initialObservation));},
 observe:async o=>{const fresh=state();assert.equal(o.ready(fresh),true);return fresh;}};
 await selectPreparedGraphNode(channel,s,'select');assert.deepEqual(actions,[{verb:'click',ref:'label'},{verb:'click',ref:'body'}]);
});
test('uses the selection target resolved after an epoch refresh',async()=>{
 const {selectPreparedGraphNode}=await import('../lib/node-graph-selection.mjs');
 for(const [initialLabel,refreshedLabel] of [[false,true],[true,false]]){
  const initial=state(),fresh=state(),actions=[];let calls=0;
  if(initialLabel)initial.ui.elements[0].interaction.state='point_not_observed';
  if(refreshedLabel)fresh.ui.elements[0].interaction.state='point_not_observed';
  const channel={perform:async o=>{
   if(calls++===0){o.resolve(initial);actions.push(o.resolve(fresh));}
   else actions.push(o.resolve(state()));
  },observe:async o=>{const s=state();assert.equal(o.ready(s),true);return s;}};
  await selectPreparedGraphNode(channel,initial,'refresh');
  assert.deepEqual(actions.map(a=>a.ref),refreshedLabel?['label','body']:['body']);
 }
});
