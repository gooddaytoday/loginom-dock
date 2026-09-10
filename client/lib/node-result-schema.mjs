// Public result data, including partial effects. Validation is not an independent
// acceptance audit: a valid schema alone never proves the user's goal complete.
const str={type:'string'},bool={type:'boolean'},integer={type:'integer',minimum:0};
const values=(...enumValues)=>({type:'string',enum:enumValues});
const object=(properties,required=Object.keys(properties),additionalProperties=false)=>({type:'object',properties,required,additionalProperties});
const array=items=>({type:'array',items});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const ref=object({document_id:str,workflow_id:str,node_id:str});
const error=object({code:str,message:str,cause:object({code:str,message:str})},['code','message']);
const phase=values('validate','source','workflow','target','input_mapping','open','configure','node_finish','output_mapping','finish','execute','read');
const execution=object({status:values('not_requested','pending','completed','cancelled'),execution_id:nullable(str),stop_verified:bool},['status','execution_id']);
const receipt=object({phase,receipt_id:str,status:values('pending','verified','not_requested'),effect_possible:bool});
const cell=object({type:str,is_null:bool,value:{type:['string','number','boolean','null']},decimal:str,
 representation:str,precision:str,display_text:str,timezone:str},['type','is_null','precision']);
const column=object({index:integer,name:str,label:str,type:str,header_tid:str,data_kind:str},['index','name','label','type'],true);
const port=object({port:integer,port_guid:str,fresh:bool,freshness_basis:str,execution_id:str,
 table:object({view_guid:str,port_guid:str,table_tid:str}),schema:array(column),row_count:integer,
 sample:{type:'array',items:array(cell),maxItems:10},sample_rows:{type:'integer',minimum:0,maximum:10},sample_complete:bool,
 precision:object({numbers_verified:bool,limitations:array(str),strings:str}),table_schema_id:str,filter_enabled:bool},
 ['port','port_guid','fresh','execution_id','schema','row_count','sample','sample_rows','sample_complete','precision'],true);
const output=object({status:values('not_refreshed','partial','complete'),evidence_ref:nullable(str),execution_id:str,ports:array(port),
 verified:bool,cleanup_complete:bool,effect_possible:bool,no_output_requested:bool},['status','evidence_ref'],true);
const readbackColumn=object({index:integer,name:str,label:str,type:str,data_kind:str,used:bool});
const readbackMappingField=object({index:integer,name:str,label:str,type:str,data_kind:str,source_name:str});
const boundedFields=items=>({...array(items),maxItems:1000});
const importConfigurationReadback=object({kind:values('text_import'),scope:values('observed_before_verified_finish'),node:ref,
 receipt_ids:{...array(str),minItems:3,maxItems:3},values_are:values('observed_ui_values'),
 source:object({source_path:str,connection:str,encoding:str,rows_to_skip:str,first_line_as_title:bool}),
 format:object({delimiter:str,text_qualifier:str,null_marker:str,decimal_separator:str}),
 columns:boundedFields(readbackColumn),output_mapping:object({port:{type:'integer',const:0},autosync:bool,fields:boundedFields(readbackMappingField)}),
 package_persistence_verified:{type:'boolean',const:false}});
const calculatorConfigurationReadback=object({kind:values('calculator'),scope:values('observed_before_verified_finish'),node:ref,
 receipt_ids:{...array(str),minItems:5,maxItems:5},values_are:values('observed_ui_values'),mode:values('expression'),
 expressions:{...array(object({index:integer,name:str,label:str,type:str,formula:str,replace:bool,intermediate:bool,cached:bool,description:str})),minItems:1,maxItems:128},
 input_mapping:object({port:{type:'integer',const:0},autosync:bool,fields:boundedFields(object({...readbackMappingField.properties,excluded:bool}))}),
 input_fields:boundedFields(object({name:str,label:str,type:str})),syntax_validation:values('accepted_by_loginom_next'),
 output_mapping:object({port:{type:'integer',const:0},autosync:bool,fields:boundedFields(object({...readbackMappingField.properties,excluded:bool}))}),
 package_persistence_verified:{type:'boolean',const:false}});
const groupingConfigurationReadback=object({kind:values('grouping'),scope:values('observed_before_verified_finish'),node:ref,
 receipt_ids:{...array(str),minItems:5,maxItems:5},values_are:values('observed_ui_values'),mode:values('aggregate'),
 group_by:{...array(object({name:str,label:str,type:str,order:integer})),minItems:1,maxItems:128},
 measures:{...array(object({name:str,label:str,type:str,order:integer,functions:integer})),minItems:1,maxItems:256},
 options:object({pedDimCache:object({value:bool,switch_pressed:bool}),pedSortResult:object({value:bool,switch_pressed:bool})}),
 input_mapping:object({port:{type:'integer',const:0},autosync:bool,fields:boundedFields(readbackMappingField)}),
 output_mapping:object({port:{type:'integer',const:0},autosync:bool,fields:boundedFields(object({...readbackMappingField.properties,excluded:bool}))}),
 package_persistence_verified:{type:'boolean',const:false}});
const sortingConfigurationReadback=object({kind:values('sorting'),scope:values('observed_before_verified_finish'),node:ref,
 receipt_ids:{...array(str),minItems:5,maxItems:5},values_are:values('observed_ui_values'),mode:values('keys'),
 keys:{...array(object({name:str,label:str,type:str,order:integer,direction:values('ASC','DESC'),case_sensitive:bool})),minItems:1,maxItems:128},
 options:object({chkLocaleAware:object({value:bool,switch_pressed:bool}),chkBufferWhole:object({value:bool,switch_pressed:bool}),cbxMaxThreadCount:object({value:integer,switch_pressed:bool})}),
 comparison:object({mode:values('binary','user_locale'),locale:nullable(str),locale_verified:bool,case_insensitivity:values('latin_only','locale_dependent')}),
 input_mapping:object({port:{type:'integer',const:0},autosync:bool,fields:boundedFields(readbackMappingField)}),
 output_mapping:object({port:{type:'integer',const:0},autosync:bool,fields:boundedFields(object({...readbackMappingField.properties,excluded:bool}))}),
 package_persistence_verified:{type:'boolean',const:false}});
const configurationReadback={anyOf:[importConfigurationReadback,calculatorConfigurationReadback,groupingConfigurationReadback,sortingConfigurationReadback]};
export const nodeApplyResultSchema=object({operation_id:str,status:values('SUCCEEDED','FAILED','NOT_APPLIED','AMBIGUOUS'),
 effect_possible:bool,phases:array(receipt),node:nullable(ref),execution,output,
 package_saved:{type:'boolean',const:false},cleanup_complete:bool,warnings:array(str),
 configuration:object({status:values('applied','discarded'),readback:configurationReadback},['status']),
 checkpoint_kind:values('local_node_checkpoint','local_node_cancellation','local_node_stopped'),
 persisted_package_verified:{type:'boolean',const:false},pending_phase:nullable(phase),error},
 ['operation_id','status','effect_possible','phases','node','execution','output','package_saved','cleanup_complete','warnings']);
const outcome=object({status:values('SUCCEEDED','FAILED','NOT_APPLIED','AMBIGUOUS'),action_key:{type:'string',const:'node.apply'},
 action_revision:str,operation_id:str,phase:str,effect_possible:bool,cleanup_complete:bool,
 output:nodeApplyResultSchema,error:nullable(error),trace:array({type:'object'})});
const progress=object({node:nullable(ref),execution,accepted_phases:array(phase),pending_phase:nullable(phase),effect_possible:bool,cleanup_complete:bool});
export const nodeJobResultSchema=object({operation_id:str,attempt:{type:'integer',minimum:1},state:values('running','settled'),
 cancel_requested:bool,server_stop_requested:bool,progress:nullable(progress),outcome:nullable(outcome),error:nullable(error)});
export const deliveryJobResultSchema=object({operation_id:str,state:values('running','settled'),phase:str,upload_operation_id:str,
 outcome:nullable(object({status:values('SUCCEEDED','FAILED','NOT_APPLIED','AMBIGUOUS'),upload_operation_id:str,
  destination:str,bytes:integer,sha256:str,verification_id:str,cleanup_complete:bool,upload_completion_verified:bool,
  code:str,effect_possible:bool},['status'],true)),error:nullable(object({code:str,message:str},['message'],true))});
