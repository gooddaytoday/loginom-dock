import {validateActionParameters} from './action-catalog.mjs';
import {nodeJobResultSchema,deliveryJobResultSchema} from './node-result-schema.mjs';

const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const text=(maxLength=128)=>({type:'string',minLength:1,maxLength});
const id={...text(),pattern:'^[A-Za-z0-9_.:-]+$'};
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const choice=(...values)=>({type:'string',enum:values});
const boolean={type:'boolean'};
const array=(items,maxItems,minItems=0)=>({type:'array',items,maxItems,minItems});
const ref=object({document_id:id,workflow_id:id,node_id:id});
const sourceSettings=object({source_path:text(2048),encoding:text(80),rows_to_skip:integer(0,1000000),first_line_as_title:boolean},[]);
const format=object({delimiter:{type:'string',minLength:1,maxLength:1},decimal_separator:choice('.',','),
 null_marker:{type:'string',maxLength:256},text_qualifier:{type:'string',maxLength:1}},[]);
const column=object({source_name:text(120),name:text(120),label:text(120),
 type:choice('integer','real','string','boolean','datetime'),data_kind:choice('Неопределенное','Непрерывный','Дискретный'),used:boolean},[]);
export const calculatorExpressionSchema=object({target:object({kind:choice('new','existing'),name:text(128)},['kind']),
 name:text(128),label:text(200),type:choice('integer','real','string','boolean','datetime'),formula:text(2048),replace:boolean},['target']);
export const calculatorParametersSchema=object({expressions:array(calculatorExpressionSchema,128),order:array(text(128),128,1)},['expressions']);
export const groupingFieldSchema=object({kind:choice('input_field'),name:text(128)});
export const groupingMeasureSchema=object({field:groupingFieldSchema,function:choice('sum','count','avg','min','max'),name:text(128),label:text(120)});
export const groupingParametersSchema=object({group_by:array(groupingFieldSchema,128,1),measures:array(groupingMeasureSchema,256,1)},[]);
export const sortingKeySchema=object({field:groupingFieldSchema,direction:choice('ASC','DESC'),case_sensitive:boolean},['field','direction']);
export const sortingParametersSchema=object({keys:array(sortingKeySchema,128,1),compare_with_locale:boolean},[]);
export const reformChangeSchema=object({field:groupingFieldSchema,name:text(128),label:text(128),type:choice('string','integer','real','boolean','datetime'),data_kind:choice('Неопределенное','Непрерывный','Дискретный'),usage:choice('Не задано','Активное','Выходное','Группа','Показатель','Транзакция','Элемент'),excluded:boolean},['field']);
export const reformParametersSchema=object({changes:array(reformChangeSchema,128)},['changes']);
// New nodes require complete settings; existing nodes accept a patch. The installed
// handler validates that distinction and cross-field invariants before any UI work.
export const nodeApplyInputSchema=object({
 operation_id:id,contract_revision:choice('1.0.0'),document_id:id,
 workflow_ref:object({workflow_id:id,tab_tid:text(128),prefix:text(128),navigation_path:array(object({tid:text(512),label:{type:'string'}}),32,1)}),
 target:object({kind:choice('new','existing'),type:choice('imports.text','transform.calculator','transform.group_data','transform.sorting','transform.reform_columns'),label:text(200),ref,
  position:object({x:{type:'number',minimum:8,maximum:10000},y:{type:'number',minimum:8,maximum:10000}})},['kind','type']),
 inputs:array(object({source:ref,output:integer(0,99),input:integer(0,99)}),1),
 mode:choice('delimited','expression','aggregate','keys','scalar'),parameters:object({
  source:object({artifact_id:id,upload_operation_id:id,bytes:integer(0,16777216),sha256:{...text(64),minLength:64,pattern:'^[a-f0-9]{64}$'}},['artifact_id','upload_operation_id']),
  settings:object({source:sourceSettings,format,columns:array(column,1000,1)},[]),
  expressions:array(calculatorExpressionSchema,128),order:array(text(128),128,1),group_by:array(groupingFieldSchema,128,1),measures:array(groupingMeasureSchema,256,1),keys:array(sortingKeySchema,128,1),compare_with_locale:boolean,changes:array(reformChangeSchema,128)},[]),
 mappings:array(object({direction:choice('input','output'),port:integer(0,0),autosync:boolean,
  fields:array(object({source:object({kind:choice('configured_field'),name:text(128)}),name:text(128),label:text(120),excluded:boolean},['source']),1000,1)},['direction','port']),2),
 finish:choice('done','execute','close'),
 read:object({ports:array(integer(0,0),1),sample_rows:integer(0,10),require_exact_numbers:boolean}),
 budgets:object({configure_ms:integer(1,1800000),execute_ms:integer(1,1800000),total_ms:integer(1,1800000)}),
});
const operation=object({operation_id:id});
const deliveryId={...id,maxLength:80};
const delivery=object({operation_id:deliveryId,artifact_id:id,upload_grant_id:id,budget_ms:integer(1000,1800000)});
const resumeDelivery=object({operation_id:deliveryId,resume_id:deliveryId,budget_ms:integer(1000,1800000)});
const tool=(name,description,inputSchema,readOnlyHint=false)=>({name,description,inputSchema,
 outputSchema:name.startsWith('dock_node_')?nodeJobResultSchema:deliveryJobResultSchema,
 annotations:{readOnlyHint,destructiveHint:!readOnlyHint,openWorldHint:false}});
export const nodeApiTools=Object.freeze([
 tool('dock_node_apply','Candidate node operation: text import, expression Calculator, aggregate Grouping, Sorting, or Field Parameters when its handler is installed. Field Parameters uses mode scalar and changes: each change identifies an input_field/name and patches name, label, scalar type, data_kind, usage, or excluded. Unspecified properties are preserved; output selection and order use mappings. Existing Field Parameters reexecution without edits uses parameters={changes:[]}, inputs=[], mappings=[]. For exact conversion/value checks set read.require_exact_numbers=true; ordinary false reads may round numbers. Sorting uses mode keys: ordered keys with field input_field/name, direction ASC/DESC, explicit case_sensitive for string/variant fields, optional compare_with_locale (true for new nodes, preserved for existing). Existing sorting parameters={} preserves keys. Grouping uses ordered group_by input_field names and a full measures list (field, function, name, label); supported functions are sum/count/avg/min/max, count includes null rows. Import source needs only artifact_id and upload_operation_id from a verified delivery; the client resolves bytes and SHA-256 locally. Optional legacy bytes/sha256 must match when supplied. Import settings are required. Calculator accepts ordered expressions with new/existing targets and preserves unrequested settings; optional order lists every resulting expression name. New expressions require name, label, type, formula, replace. Done saves without executing; Close discards the draft and rejects Calculator input mappings, which require a separate committed wizard; Execute reads output 0. Poll the SAME operation_id; timeout never restarts work. Save the package separately.',nodeApplyInputSchema),
 tool('dock_node_resume','Candidate explicit continuation of the SAME known node operation with identical original parameters. Retains accepted phases; unresolved effects or lost document refuse continuation. Does not reconstruct a lost session.',nodeApplyInputSchema),
 tool('dock_node_status','Read local state and accepted progress without browser access or re-execution.',operation,true),
 tool('dock_node_wait','Wait up to timeout_ms for the SAME worker. Timeout returns running; never infer termination or start a replacement.',object({operation_id:id,timeout_ms:integer(0,60000)},['operation_id']),true),
 tool('dock_node_cancel','Request local cancellation. Partial effects remain; poll until cleanup settles. Does not stop an identified server execution.',operation),
 tool('dock_node_stop','Request native stop only for an identified server execution currently awaited by this node operation. Poll the same worker for confirmed outcome.',operation),
]);
export const deliveryApiTools=Object.freeze([
 tool('dock_artifact_deliver','Candidate delivery of an authorized artifact to its grant destination, including path conflict policy and byte verification. Retain operation_id after timeout or uncertainty; never reupload with a replacement ID.',delivery),
 tool('dock_artifact_delivery_status','Read the retained delivery job without browser calls. A failed tool wait does not prove transfer termination.',operation,true),
 tool('dock_artifact_delivery_resume','Explicitly resume the SAME known delivery job after inspecting status. Uses the original upload receipt; never repeats an unresolved download. Requires the original live runtime and unchanged grant.',resumeDelivery),
]);
export const isNodeApiTool=name=>[...nodeApiTools,...deliveryApiTools].some(tool=>tool.name===name);
export async function dispatchNodeApi(runtime,name,args,{signal}={}) {
 const definition=runtime.tools.find(tool=>tool.name===name);
 if(!definition||!isNodeApiTool(name))throw Error('Node operation tool is unavailable in this session');
 validateActionParameters(definition.inputSchema,args);
 signal?.throwIfAborted();
 switch(name){
  case 'dock_node_apply':return runtime.startNodeApply(args);
  case 'dock_node_resume':return runtime.startNodeApply(args,{resume:true});
  case 'dock_node_status':return runtime.nodeApplyStatus(args.operation_id);
  case 'dock_node_wait':return runtime.waitNodeApply(args.operation_id,{timeoutMs:args.timeout_ms??1000,signal});
  case 'dock_node_cancel':return runtime.cancelNodeApply(args.operation_id);
  case 'dock_node_stop':return runtime.stopNodeApply(args.operation_id);
  case 'dock_artifact_deliver':return runtime.deliverArtifact(args,{signal});
  case 'dock_artifact_delivery_status':return runtime.artifactDeliveryStatus(args.operation_id);
  case 'dock_artifact_delivery_resume':return runtime.resumeArtifactDelivery(args,{signal});
 }
}
