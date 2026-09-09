import {readPreparedNodeContext,validatePreparedNodeContext} from './node-context.mjs';

export function makeNodeMappingContextCode(binding) {
  validatePreparedNodeContext(binding);
  return `async page=>(${readNodeMapping.toString()})(page,${JSON.stringify(binding)},${readPreparedNodeContext.toString()},${readMappingBrowser.toString()})`;
}

export async function readNodeMapping(page,binding,readNode=readPreparedNodeContext,readBrowser=readMappingBrowser) {
  const before=await readNode(page,binding);
  if(before.verified!==true||before.surface!=='wizard')return {verified:false,reason:'mapping_node_surface'};
  const result=await page.evaluate(readBrowser,binding.workflow_ref.prefix);
  const after=await readNode(page,binding);
  if(JSON.stringify(before)!==JSON.stringify(after))return {verified:false,reason:'mapping_node_changed'};
  return {...result,node_context:after};
}

// Only local UI stores are read. No model loads, server requests or dataset APIs.
export function readMappingBrowser(prefix) {
  const fail=reason=>({verified:false,reason,source_identity_verified:false});
  const types={1:'boolean',2:'datetime',3:'real',4:'integer',5:'string',6:'variant'};
  const exact=tid=>[...document.querySelectorAll('[data-tid]')].filter(e=>e.getAttribute('data-tid')===tid);
  const forms=['ColumnsMappingEngineOutputPortWizard','DerivedDataSourceOutputSocketWizard'];
  const candidates=forms.flatMap(form=>exact(prefix+';WizrdMCF;'+form).filter(e=>e.checkVisibility({checkVisibilityCSS:true})).map(root=>({form,root})));
  if(candidates.length!==1)return fail('mapping_root');
  const {form,root}=candidates[0],grouped=form==='DerivedDataSourceOutputSocketWizard';
  const base=prefix+';WizrdMCF;'+form+';';
  if([...document.querySelectorAll('.x-mask,.x-mask-msg,.bg-mask-message')].some(e=>e.checkVisibility({checkVisibilityCSS:true})))return fail('mapping_mask');
  const grids=['grdSourceColumns;tbl','grdTargetColumns;tbl'].map(s=>exact(base+s));
  if(grids.some(es=>es.length!==1||!root.contains(es[0])))return fail('mapping_grids');
  const elements=grids.map(es=>es[0]),views=elements.map(e=>globalThis.Ext?.getCmp?.(e.id));
  if(views.some((v,i)=>v?.el?.dom!==elements[i]))return fail('mapping_views');
  const stores=views.map(v=>v.getStore?.());
  if(stores[0]===stores[1])return fail('mapping_same_store');
  const inventories=[];
  for(const store of stores) {
    if(store?.$className!=='Ext.data.Store'||store.isBufferedStore||store.isLoading?.())return fail('mapping_store');
    const data=store.getData?.(),records=data?.items,source=data?.getSource?.()?.items;
    // After node reconfiguration Loginom's grouped target total can count only
    // active columns. Admit that observed form only with the complete unfiltered
    // cached source collection; every active/excluded record is validated below.
    const total=store.getTotalCount?.(),activeTotal=grouped&&store===stores[1]&&Array.isArray(records)&&Array.isArray(source)
      &&total===records.filter(r=>r?.data?.GroupField==='').length;
    if(!Array.isArray(records)||records.length>1000||store.getCount?.()!==records.length||total!==records.length&&!activeTotal
      ||source&&(!Array.isArray(source)||source.length!==records.length||new Set(source).size!==records.length||source.some(r=>!records.includes(r))))return fail('mapping_filtered_store');
    const ids=new Set(),names=new Set(),fieldIds=new Set(),groupIndices=new Map();
    for(const [i,r] of records.entries()) {
      const d=r?.data,id=String(r?.internalId??'');
      const group=grouped?d?.GroupField:'';
      if(grouped&&(group!==''&&(store!==stores[1]||group!=='Исключенные')))return fail('mapping_group');
      const index=grouped?(groupIndices.get(group)??0):i;
      if(!r?.isModel||!id||ids.has(id)||d?.Index!==index||!Number.isSafeInteger(d.ID)||d.ID<0
        ||fieldIds.has(d.ID)||typeof d.Name!=='string'||!d.Name||d.Name.length>=240||names.has(d.Name)
        ||typeof d.Required!=='boolean'||typeof d.DisplayName!=='string'||d.DisplayName.length>=240||!types[d.DataType]||d.Broken!==false)
        return fail('mapping_record');
      ids.add(id);names.add(d.Name);fieldIds.add(d.ID);
      groupIndices.set(group,index+1);
    }
    inventories.push(records);
  }
  const [sources,targets]=inventories,linked=new Set(),excludedSources=new Map();
  const describe=r=>({record_id:String(r.internalId),field_id:String(r.data.ID),index:r.data.Index,
    name:r.data.Name,label:r.data.DisplayName,type:types[r.data.DataType],required:r.data.Required});
  for(const target of targets) {
    if(![0,1,2].includes(target.data.DataKind))return fail('mapping_target_kind');
    if(grouped&&typeof target.data.IsDerived!=='boolean')return fail('mapping_inherited');
    const source=target.data.ConnectedRecord;
    if(grouped&&target.data.GroupField==='Исключенные') {
      const matches=sources.filter(s=>s.data.Name===target.data.Name&&s.data.DataType===target.data.DataType);
      if(source!=null||target.data.Required!==false||target.data.IsDerived!==false
        ||target.data.SourceDisplayName!==null||target.data.SourceDataType!==null||target.data.DataKind!==0
        ||matches.length!==1||matches[0].data.Required!==false||matches[0].data.ConnectedRecord!=null)
        return fail('mapping_excluded_source');
      excludedSources.set(target,matches[0]);
      continue;
    }
    if(source==null)continue;
    if(!sources.includes(source)||source.data.ConnectedRecord!==target||linked.has(source)
      ||target.data.SourceDisplayName!==source.data.DisplayName||target.data.SourceDataType!==source.data.DataType)
      return fail('mapping_connected_record');
    linked.add(source);
  }
  if(sources.some(s=>s.data.ConnectedRecord!=null&&(!targets.includes(s.data.ConnectedRecord)
    ||s.data.ConnectedRecord.data.ConnectedRecord!==s)))return fail('mapping_reverse_record');
  const rows=[...elements[1].querySelectorAll('table.x-grid-item')],rendered=new Set();
  if(!rows.length||rows.length>200)return fail('mapping_render_bound');
  for(const row of rows) {
    const index=Number(row.getAttribute('data-recordindex')),target=targets[index];
    if(!Number.isSafeInteger(index)||index<0||!target||rendered.has(index)
      ||row.getAttribute('data-recordid')!==String(target.internalId)||row.getAttribute('data-boundview')!==elements[1].id)
      return fail('mapping_render_identity');
    for(const [key,value] of [['colName_',target.data.Name],['colDisplayName_',target.data.DisplayName],
      ['colSourceDisplayName_',target.data.ConnectedRecord?.data.DisplayName??'']]) {
      const cells=exact(base+key+target.data.Name).filter(c=>row.contains(c));
      if(cells.length!==1||cells[0].textContent.trim()!==value)return fail('mapping_render_value');
    }
    rendered.add(index);
  }
  const buttons=exact(base+'btnAutoSyncThroughColumns'),button=buttons[0];
  const native=button&&globalThis.Ext?.getCmp?.(button.id);
  if(buttons.length!==1||!root.contains(button)||!button.checkVisibility({checkVisibilityCSS:true})||native?.el?.dom!==button
    ||typeof native.pressed!=='boolean'||native.pressed!==button.classList.contains('x-btn-pressed'))return fail('mapping_autosync');
  return {verified:true,source_identity_verified:true,inventory_complete:true,
    ...(grouped?{mapping_wizard:form}:{}),
    state_source:'cached_mapping_stores',autosync:native.pressed,
    source_fields:sources.map(describe),target_fields:targets.map((t,i)=>({...describe(t),
      ...(grouped?{index:i,group_index:t.data.Index,excluded:excludedSources.has(t),inherited:t.data.IsDerived,
        exclusion_source:excludedSources.has(t)?describe(excludedSources.get(t)):null}:{}),
      data_kind:{0:'Неопределенное',1:'Непрерывный',2:'Дискретный'}[t.data.DataKind],
      source:t.data.ConnectedRecord?describe(t.data.ConnectedRecord):null})),rendered_indices:[...rendered],
    settings_applied:false,package_saved:false};
}
