import {createTextImportNodeSupport} from './text-import-node.mjs';
import {createSortingNodeSupport} from './sorting-node.mjs';
import {createGroupingNodeSupport} from './grouping-node.mjs';
import {createCalculatorNodeSupport} from './calculator-node.mjs';

// Candidate implementations share one lifecycle, gate and browser. Dispatch by
// the already validated request; never infer a handler from the current UI.
export function createCandidateNodeSupport(config) {
 const imports=createTextImportNodeSupport(config),calculator=createCalculatorNodeSupport(config),grouping=createGroupingNodeSupport(config),sorting=createSortingNodeSupport(config);
 const nodeApplyHandlers=new Map([...imports.nodeApplyHandlers,...calculator.nodeApplyHandlers,...grouping.nodeApplyHandlers,...sorting.nodeApplyHandlers]);
 return {nodeApplyHandlers,nodeApplyDriverFactory:options=>{
  const type=options.operation.parameters?.target?.type;
  if(type==='imports.text')return imports.nodeApplyDriverFactory(options);
  if(type==='transform.sorting')return sorting.nodeApplyDriverFactory(options);
  if(type==='transform.group_data')return grouping.nodeApplyDriverFactory(options);
  if(type==='transform.calculator')return calculator.nodeApplyDriverFactory(options);
  throw Error('No candidate driver for '+type);
 }};
}
