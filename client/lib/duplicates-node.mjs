import {createTabularTransformNodeSupport} from './calculator-node.mjs';
import {validateDuplicatesParameters,resolveDuplicatesParameters,DUPLICATES_OUTPUT} from './duplicates-parameters.mjs';
import {configureDuplicates} from './duplicates-procedure.mjs';
import {preflightTabularSource} from './sorting-preflight.mjs';
import {configureSortingOutput} from './sorting-output.mjs';
import {duplicatesConfigurationReadback} from './duplicates-readback.mjs';
import {duplicatesParametersSchema} from './node-api.mjs';
const need=(v,m)=>{if(!v)throw Error('Duplicates: '+m);};
export function createDuplicatesNodeSupport(config){return createTabularTransformNodeSupport(config,{
 type:'research.duplicates',mode:'mark',revision:'duplicates-v1-internal-1',readback:duplicatesConfigurationReadback,parameterSchema:duplicatesParametersSchema,
 validate:validateDuplicatesParameters,
 preflight:(options,ctx,config)=>preflightTabularSource(options,ctx,config,{required:true,resolve:resolveDuplicatesParameters,label:'duplicates'}),
 validateInput:(p,resolved,native)=>resolveDuplicatesParameters(p,native.target_fields),
 configurationObservation:{condition:'duplicate roles page',readDuplicates:true,ready:s=>s.wizard?.stage==='input_mapping'&&s.node_duplicates?.verified===true},
 async configure(channel,p,{request,inputMapping}){
  if(request.finish==='close'){
   const s=await channel.observe({condition:'duplicate draft ready for disposal',readDuplicates:true,ready:s=>s.node_duplicates?.verified===true});
   return {verified:true,cleanup_complete:true,effect_possible:false,configuration:s.node_duplicates,draft_edits_skipped:true};
  }
  const changed=await configureDuplicates(channel,p,inputMapping);
  await channel.perform({condition:'validate duplicate roles',ready:s=>s.wizard?.stage==='input_mapping',identity:s=>s.prepared_node_context,
   resolve:s=>{const es=s.ui.elements.filter(e=>e.tid===s.wizard.root_tid+';btnNext'&&e.allowed_actions.includes('wizard_step'));need(es.length===1,'Next unavailable');return {verb:'wizard_step',ref:es[0].ref,expected_stage:'done'};}});
  const done=await channel.observe({condition:'duplicate roles accepted',ready:s=>s.wizard?.stage==='done'});
  return {...changed,validation:{status:'accepted_by_loginom_next',node_context:done.prepared_node_context}};
 },
 configureOutput:(channel,c,p,m)=>configureSortingOutput(channel,{input_fields:[...DUPLICATES_OUTPUT,...c.fields]},p,m),
});}
