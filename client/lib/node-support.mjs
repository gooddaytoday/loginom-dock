import {createTextImportNodeSupport} from './text-import-node.mjs';
import {createCalculatorNodeSupport} from './calculator-node.mjs';

// Candidate implementations share one lifecycle, gate and browser. Dispatch by
// the already validated request; never infer a handler from the current UI.
export function createCandidateNodeSupport(config) {
 const imports=createTextImportNodeSupport(config),calculator=createCalculatorNodeSupport(config);
 const nodeApplyHandlers=new Map([...imports.nodeApplyHandlers,...calculator.nodeApplyHandlers]);
 return {nodeApplyHandlers,nodeApplyDriverFactory:options=>{
  const type=options.operation.parameters?.target?.type;
  if(type==='imports.text')return imports.nodeApplyDriverFactory(options);
  if(type==='transform.calculator')return calculator.nodeApplyDriverFactory(options);
  throw Error('No candidate driver for '+type);
 }};
}
