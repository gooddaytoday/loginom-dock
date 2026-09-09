import {readTableFormatDefinitions,revealTableFormatField} from './table-format-pages.mjs';
const requireValue=(v,m)=>{if(!v)throw Error(m);};
const one=(xs,m)=>{requireValue(xs.length===1,m);return xs[0];};
const tableRef=t=>({view_guid:t.view_guid,port_guid:t.port_guid,table_tid:t.table_tid});

export async function returnFromOutputTable(channel,table) {
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const bound=s=>s.prepared_node_context?.verified===true&&s.prepared_node_context.surface==='views'
    &&s.node_outputs?.verified===true&&s.node_outputs.surface==='views'
    &&s.node_outputs.tables.filter(t=>t.active&&same(tableRef(t),tableRef(table))).length===1
    &&s.workflow_navigation?.status==='observed'
    &&s.ui.elements.filter(e=>e.ref===s.workflow_navigation.control_ref&&e.tid===s.workflow_navigation.control_tid
      &&e.allowed_actions.includes('click')).length===1;
  const before=await channel.observe({condition:'source Table and parent scenario observed',readOutputs:true,readNavigation:true,ready:bound});
  const node=Object.fromEntries(['document_id','workflow_id','node_id'].map(k=>[k,before.prepared_node_context[k]]));
  const path=before.workflow_navigation.path;
  await channel.perform({condition:'return from the read Table to its scenario',initialObservation:before,
    ready:s=>bound(s)&&same(s.workflow_navigation.path,path),identity:()=>({node,table:tableRef(table),path}),
    resolve:s=>({verb:'click',ref:s.workflow_navigation.control_ref})});
  const after=await channel.observe({condition:'Table returned to the prepared scenario',readOutputs:true,readNavigation:true,
    ready:s=>s.prepared_node_context?.verified===true&&s.prepared_node_context.surface==='graph'
      &&Object.keys(node).every(k=>s.prepared_node_context[k]===node[k])&&s.navigation_context?.status==='observed'
      &&same(s.navigation_context.path,path)&&s.node_outputs?.verified===true&&s.node_outputs.surface==='graph'
      &&s.node_outputs.ports.filter(p=>p.port_guid===table.port_guid&&p.active===true).length===1});
  return {verified:true,source_table:tableRef(table),node_context:after.prepared_node_context,
    workflow_path:path,execution_started:false,reopen_performed:false};
}

// Fixed UI procedures only: callers provide a port number, never a selector,
// browser callback or sequence. The enclosing node.apply owns the channel gate.
export async function openNewOutputTable(channel,port) {
  const observe=(condition,ready,confirmIdentity)=>channel.observe({condition,readOutputs:true,ready,confirmIdentity});
  const perform=(s,condition,select,verb='click')=>channel.perform({condition,initialObservation:s,
    ready:s=>s.ui.elements.filter(select).length===1,resolve:s=>({verb,ref:one(s.ui.elements.filter(select),'Unique Table control required').ref}),
    identity:s=>s.prepared_node_context});
  let s=await observe('prepared graph output',s=>s.node_outputs?.verified&&s.node_outputs.surface==='graph');
  const output=one(s.node_outputs.ports.filter(p=>p.index===port),'Requested output port missing');
  requireValue(output.active,'Requested output is not active');
  const nodeTid=s.prepared_node_context.tid;
  await perform(s,'select prepared graph node',e=>e.graph_node?.part==='body'&&e.tid===nodeTid);
  s=await observe('prepared node visualizers',s=>s.ui.elements.some(e=>e.allowed_actions.includes('open_node_views')));
  await perform(s,'open prepared node visualizers',e=>e.allowed_actions.includes('open_node_views'),'open_node_views');
  s=await observe('prepared port visualizer cards',s=>s.node_outputs?.verified&&s.node_outputs.surface==='views'&&s.ui.elements.some(e=>e.viewer_vendor?.kind==='table'));
  const before=s.node_outputs.tables.map(t=>t.view_guid);
  await perform(s,'select Table vendor',e=>e.viewer_vendor?.kind==='table');
  s=await observe('Table selected for native output port',s=>s.ui.elements.some(e=>e.viewer_vendor?.selected===true)
    &&s.ui.elements.some(e=>e.viewer_card?.kind==='add'&&e.viewer_card.port_guid===output.port_guid));
  await perform(s,'add Table to native output',e=>e.viewer_card?.kind==='add'&&e.viewer_card.port_guid===output.port_guid);
  s=await observe('new Table card bound to output',s=>{
    const added=s.node_outputs?.verified?s.node_outputs.tables.filter(t=>!before.includes(t.view_guid)&&t.port_guid===output.port_guid):[];
    return added.length===1&&s.ui.elements.filter(e=>e.viewer_card?.kind==='enter'&&e.viewer_card.view_guid===added[0].view_guid
      &&e.viewer_card.port_guid===output.port_guid&&e.allowed_actions.includes('enter_table')).length===1;
  },s=>({epoch:s.dom_epoch,tables:s.node_outputs.tables}));
  const added=s.node_outputs.tables.find(t=>!before.includes(t.view_guid)&&t.port_guid===output.port_guid);
  await perform(s,'enter new Table',e=>e.viewer_card?.kind==='enter'&&e.viewer_card.view_guid===added.view_guid,'enter_table');
  s=await observe('new Table active',s=>s.node_outputs?.verified&&s.node_outputs.tables.some(t=>t.active&&t.view_guid===added.view_guid&&t.table_tid));
  return {table:tableRef(s.node_outputs.tables.find(t=>t.view_guid===added.view_guid)),port,port_guid:output.port_guid,created:true};
}

export function verifyTableNumericFormat(observed,target) {
  const value=(name,expected)=>observed?.[name]?.status==='observed'&&observed[name].value===expected;
  const mask=target.type==='real'?'0.################E+00':'0';
  const identity=observed?.source_index===target.index&&observed.name_key===target.key;
  const custom=value('custom',true);
  // Loginom canonicalizes integer mask 0 into its standard numeric controls
  // when the selected field changes. Verify that equivalent stored form too.
  const standardInteger=target.type==='integer'&&value('custom',false)&&value('decimal_digits','0')
    &&value('currency','')&&value('thousands',false)&&value('scientific',false);
  requireValue(['integer','real'].includes(target.type)&&identity&&value('formatting',true)
    &&value('format_string',mask)&&(custom||standardInteger),'Stored numeric format differs');
  return {index:target.index,key:target.key,type:target.type,mask,representation:custom?'custom':'standard_integer'};
}

export function verifyTableDateTimeFormat(observed,target) {
  const mask='yyyy-mm-dd hh:nn:ss.zzz';
  requireValue(target.type==='datetime'&&observed?.source_index===target.index&&observed.name_key===target.key
    &&['formatting','custom'].every(k=>observed[k]?.status==='observed'&&observed[k].value===true)
    &&observed.format_string?.status==='observed'&&observed.format_string.value===mask,'Stored datetime format differs');
  return {index:target.index,key:target.key,type:target.type,mask,representation:'custom',precision:'millisecond',timezone:'unspecified'};
}

export async function configureTablePrecision(channel,table,{alreadyOpen=false}={}) {
  const dialog={table,kind:'format'};let offset=0,definition;
  const read=(condition,ready=()=>true)=>channel.observe({condition,tableDialog:dialog,tableFormatPage:{offset,limit:8},ready:s=>s.table_settings?.status==='observed'
    &&s.table_settings.kind==='format'&&!!s.table_settings.format?.page?.schema_id&&(!definition||s.table_settings.format.page.schema_id===definition.schema_id)&&ready(s)});
  const field=s=>s.table_settings.format.selected_numeric??s.table_settings.format.selected_datetime;
  const action=(s,condition,resolve,identity)=>channel.perform({condition,initialObservation:s,ready:s=>s.table_settings?.format?.page?.schema_id===definition.schema_id,
    resolve,identity:s=>({table,...identity(s)})});
  if(!alreadyOpen) {
    const s=await channel.observe({condition:'Table Format available',readOutputs:true,ready:s=>s.ui.elements.some(e=>e.tid===table.table_tid+';btnDataGridFormat')});
    await channel.perform({condition:'open bound Table format',initialObservation:s,ready:s=>s.ui.elements.some(e=>e.tid===table.table_tid+';btnDataGridFormat'),
      resolve:s=>({verb:'click',ref:one(s.ui.elements.filter(e=>e.tid===table.table_tid+';btnDataGridFormat'),'Unique Format control required').ref}),identity:()=>({table})});
  }
  definition=await readTableFormatDefinitions(channel,table);
  let s;
  const fields=definition.fields.map(f=>({index:f.source_index,definition_index:f.index,key:f.name_key,type:f.type,label:f.label}));
  const numeric=fields.filter(f=>['integer','real'].includes(f.type)),datetime=fields.filter(f=>f.type==='datetime'),targets=[...numeric,...datetime];
  const select=async target=>{
    const native=definition.fields.find(f=>f.index===target.definition_index);
    offset=Math.floor(native.index/8)*8;
    s=await revealTableFormatField(channel,table,definition,native);
    await action(s,'select Table format field '+target.index,s=>({verb:'click',ref:one(s.ui.elements.filter(e=>e.table_field?.source_index===target.index
      &&e.table_field.name_key===target.key&&e.table_field.type===target.type),'Bound Table field missing').ref}),()=>({field:target}));
    s=await read('Table format field '+target.index+' selected',s=>s.table_settings.format.fields.some(f=>f.selected&&f.source_index===target.index&&f.name_key===target.key));
  };
  for(const target of targets) {
    await select(target);
    for(const name of ['formatting','custom']) {
      const setting=field(s)[name];requireValue(setting?.status==='observed','Numeric format control unavailable');
      if(!setting.value) {
        await action(s,'enable Table '+name,s=>{const f=field(s)[name],refs=[f.input_ref,f.display_ref];
          return {verb:'set_checked',checked:true,ref:one(s.ui.elements.filter(e=>refs.includes(e.ref)&&e.allowed_actions.includes('set_checked')&&e.interaction?.state==='point_observed').slice(0,1),'Numeric checkbox is not painted').ref};},()=>({field:target,setting:name}));
        s=await read('Table '+name+' enabled',s=>field(s)?.source_index===target.index&&field(s)[name]?.value===true);
      }
    }
    const mask=target.type==='datetime'?'yyyy-mm-dd hh:nn:ss.zzz':target.type==='real'?'0.################E+00':'0';
    await action(s,'set exact Table numeric mask',s=>({verb:'fill',ref:field(s).format_string.input_ref,text:mask}),()=>({field:target,mask}));
    s=await read('Table numeric mask draft matches',s=>field(s)?.source_index===target.index&&field(s).format_string?.value===mask);
    await action(s,'commit Table numeric mask',s=>({verb:'press',ref:field(s).format_string.input_ref,key:'Tab'}),()=>({field:target,mask}));
    s=await read('Table numeric mask applied to draft',s=>field(s)?.source_index===target.index&&field(s).format_string?.value===mask);
    target.mask=mask;
  }
  // Selecting another field and returning verifies the stored dialog model;
  // merely reading an input immediately after typing is insufficient in Ext.
  for(const target of targets) {
    const alternate=fields.find(f=>f.index!==target.index);
    if(alternate)await select(alternate);
    await select(target);
    target.verified_format=(target.type==='datetime'?verifyTableDateTimeFormat:verifyTableNumericFormat)(field(s),target);
    if(alternate)requireValue(s.table_settings.format.metadata_fields.find(f=>f.source_index===target.index&&f.name_key===target.key)?.format_string===target.mask,
      'Stored Table field mask differs from the selected format');
  }
  if(!s)s=await read('Table format ready to apply');
  await action(s,'apply bound Table format',s=>({verb:'click',ref:one(s.ui.elements.filter(e=>e.tid===table.table_tid+';ModalWindow_BrowseFormat;btnApply'),'Unique Table format Apply missing').ref}),()=>({fields:targets}));
  await channel.observe({condition:'Table format dialog closed',tableDialog:dialog,readOutputs:true,ready:s=>s.ui.dialogs.length===0&&s.node_outputs?.tables?.some(t=>t.active&&t.view_guid===table.view_guid)});
  return {table,fields,numeric_formats:numeric,datetime_formats:datetime,dialog_readback_verified:fields.length!==1||targets.length===0,format_application_pending:fields.length===1&&targets.length===1,values_verified:false};
}

export async function prepareTableRead(channel,table) {
  const observe=(condition,ready)=>channel.observe({condition,readOutputs:true,ready});
  for(const kind of ['nulls','data_types']) {
    let s=await observe('Table '+kind+' toggle available',s=>s.ui.elements.some(e=>e.view_toggle?.kind===kind));
    const control=one(s.ui.elements.filter(e=>e.view_toggle?.kind===kind),'Table display toggle ambiguous');
    if(!control.view_toggle.pressed) {
      await channel.perform({condition:'enable Table '+kind,initialObservation:s,ready:s=>s.ui.elements.filter(e=>e.view_toggle?.kind===kind&&!e.view_toggle.pressed).length===1,
        resolve:s=>({verb:'click',ref:s.ui.elements.find(e=>e.view_toggle?.kind===kind).ref}),identity:()=>({table,toggle:kind})});
      s=await observe('Table '+kind+' enabled',s=>s.ui.elements.some(e=>e.view_toggle?.kind===kind&&e.view_toggle.pressed));
    }
  }
  let s=await observe('Table Filter available',s=>s.ui.elements.some(e=>e.tid===table.table_tid+';btnDataGridFilter'));
  await channel.perform({condition:'open bound Table filter',initialObservation:s,ready:s=>s.ui.elements.some(e=>e.tid===table.table_tid+';btnDataGridFilter'),
    resolve:s=>({verb:'click',ref:one(s.ui.elements.filter(e=>e.tid===table.table_tid+';btnDataGridFilter'),'Unique Table Filter required').ref}),identity:()=>({table})});
  const read=()=>channel.observe({condition:'Table filter setting ready',tableDialog:{table,kind:'filter'},ready:s=>s.table_settings?.filter?.enabled?.status==='observed'});
  s=await read();
  if(s.table_settings.filter.enabled.value) {
    await channel.perform({condition:'disable output Table filtering',initialObservation:s,ready:s=>s.table_settings?.filter?.enabled?.value===true,
      resolve:s=>{const setting=s.table_settings.filter.enabled,refs=[setting.input_ref,setting.display_ref];return {verb:'set_checked',checked:false,
        ref:one(s.ui.elements.filter(e=>refs.includes(e.ref)&&e.allowed_actions.includes('set_checked')&&e.interaction?.state==='point_observed').slice(0,1),'Table filter checkbox is not painted').ref};},identity:()=>({table,filter:false})});
    s=await read();
  }
  requireValue(s.table_settings.filter.enabled.value===false,'Table filter remains enabled');
  const filter=s.table_settings.filter;
  await channel.perform({condition:'apply disabled Table filter',initialObservation:s,ready:s=>s.table_settings?.filter?.enabled?.value===false,
    resolve:s=>({verb:'click',ref:one(s.ui.elements.filter(e=>e.tid===table.table_tid+';ModalWindow_BrowseFilter;btnApply'),'Unique Table Filter Apply required').ref}),identity:()=>({table,filter:false})});
  await channel.observe({condition:'Table filter dialog closed',tableDialog:{table,kind:'filter'},ready:s=>s.ui.dialogs.length===0&&s.node_outputs?.tables?.some(t=>t.active&&t.view_guid===table.view_guid)});
  return {table,filter_enabled:false,filter_setting:filter,null_display:true,type_icons:true,settings_applied:true};
}
