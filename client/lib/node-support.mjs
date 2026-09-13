import {createCollapseNodeSupport} from './collapse-node.mjs';
import {createUnionNodeSupport} from './union-node.mjs';
import {createJoinNodeSupport} from './join-node.mjs';
import {createFilterNodeSupport} from './filter-node.mjs';
import {createTextImportNodeSupport} from './text-import-node.mjs';
import {createSortingNodeSupport} from './sorting-node.mjs';
import {createGroupingNodeSupport} from './grouping-node.mjs';
import {createReformNodeSupport} from './reform-node.mjs';
import {createCalculatorNodeSupport} from './calculator-node.mjs';

// Candidate implementations share one lifecycle, gate and browser. Dispatch by
// the already validated request; never infer a handler from the current UI.
export function createCandidateNodeSupport(config) {
 const collapse=createCollapseNodeSupport(config),union=createUnionNodeSupport(config),join=createJoinNodeSupport(config),filter=createFilterNodeSupport(config),imports=createTextImportNodeSupport(config),calculator=createCalculatorNodeSupport(config),grouping=createGroupingNodeSupport(config),sorting=createSortingNodeSupport(config),reform=createReformNodeSupport(config);
 const nodeApplyHandlers=new Map([...collapse.nodeApplyHandlers,...imports.nodeApplyHandlers,...calculator.nodeApplyHandlers,...grouping.nodeApplyHandlers,...sorting.nodeApplyHandlers,...reform.nodeApplyHandlers,...filter.nodeApplyHandlers,...join.nodeApplyHandlers,...union.nodeApplyHandlers]);
 return {nodeApplyHandlers,nodeApplyDriverFactory:options=>{
  const type=options.operation.parameters?.target?.type;
  if(type==='transform.collapse_columns')return collapse.nodeApplyDriverFactory(options);
  if(type==='transform.union_data')return union.nodeApplyDriverFactory(options);
  if(type==='transform.join_data')return join.nodeApplyDriverFactory(options);
  if(type==='transform.filter_data')return filter.nodeApplyDriverFactory(options);
  if(type==='imports.text')return imports.nodeApplyDriverFactory(options);
  if(type==='transform.reform_columns')return reform.nodeApplyDriverFactory(options);
  if(type==='transform.sorting')return sorting.nodeApplyDriverFactory(options);
  if(type==='transform.group_data')return grouping.nodeApplyDriverFactory(options);
  if(type==='transform.calculator')return calculator.nodeApplyDriverFactory(options);
  throw Error('No candidate driver for '+type);
 }};
}
