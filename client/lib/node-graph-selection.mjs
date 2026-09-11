// A selected node's hover controls can cover the entire SVG body. Its observed
// label remains a native selection target; never click the execution overlay.
export function preparedGraphSelection(state) {
  const node=state.prepared_node_context;
  if(node?.verified!==true||node.surface!=='graph'||typeof node.tid!=='string')throw Error('Prepared graph node required for selection');
  for(const [part,tid] of [['body',node.tid],['label',node.tid+';Label;Label']]) {
    const matches=state.ui.elements.filter(e=>e.tid===tid&&e.graph_node?.part===part
      &&e.allowed_actions.includes('click')&&e.interaction?.state==='point_observed');
    if(matches.length>1)throw Error('Prepared graph selection is ambiguous');
    if(matches.length===1)return {verb:'click',ref:matches[0].ref};
  }
  throw Error('Prepared graph node has no observed selection point');
}

export async function selectPreparedGraphNode(channel, initialObservation, condition) {
  const node=initialObservation.prepared_node_context;
  const same=s=>s.prepared_node_context?.verified===true&&s.prepared_node_context.surface==='graph'
    &&['document_id','workflow_id','node_id','tid'].every(k=>s.prepared_node_context[k]===node[k]);
  let label=false;
  await channel.perform({condition,initialObservation,ready:same,identity:()=>node,resolve:s=>{
    const action=preparedGraphSelection(s);
    label=s.ui.elements.find(e=>e.ref===action.ref)?.graph_node?.part==='label';
    return action;
  }});
  if(label) {
    // Moving to the label dismisses Loginom's hover overlay. A fresh body click
    // then exposes the settings controls just as in the ordinary path.
    const restored=await channel.observe({condition:'prepared body visible after leaving hover controls',ready:s=>same(s)
      &&s.ui.elements.some(e=>e.tid===node.tid&&e.graph_node?.part==='body'&&e.interaction?.state==='point_observed')});
    await channel.perform({condition:'select prepared body after hover dismissal',initialObservation:restored,ready:same,identity:()=>node,
      resolve:s=>{const action=preparedGraphSelection(s);if(s.ui.elements.find(e=>e.ref===action.ref)?.graph_node?.part!=='body')throw Error('Prepared body remains covered');return action;}});
  }
}
