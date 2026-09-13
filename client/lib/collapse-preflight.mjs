import {preflightTabularSource} from './sorting-preflight.mjs';
import {resolveCollapseParameters} from './collapse-parameters.mjs';
export function preflightCollapseSource(options,ctx,config){return preflightTabularSource(options,ctx,config,{required:options.operation.parameters.parameters.information!==undefined,resolve:resolveCollapseParameters,label:'collapse'});}
