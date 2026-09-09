// Operator harness: real MCP request/response handling around the same public
// dispatcher used by bridge.mjs. Remote connection/pinning is tested separately.
import {Client} from '../../client/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {Server} from '../../client/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import {InMemoryTransport} from '../../client/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '../../client/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import {dispatchNodeApi,isNodeApiTool} from '../../client/lib/node-api.mjs';
import {appendFile,writeFile} from 'node:fs/promises';

export async function createPublicNodeWire(runtime,{directory,browserSequence}) {
 const server=new Server({name:'dock-public-node-live-qa',version:'1'},{capabilities:{tools:{}}});
 const definitions=runtime.tools.filter(t=>isNodeApiTool(t.name)||t.name==='dock_action_run');
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:definitions}));
 server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
  const {name,arguments:args={}}=request.params;
  try {
   const result=isNodeApiTool(name)?await dispatchNodeApi(runtime,name,args,{signal:extra.signal}):name==='dock_action_run'
    ?await runtime.run(args.action_key,args.parameters,{operationId:args.operation_id,signal:extra.signal}):null;
   if(!result)throw Error('Unsupported operator wire tool');
   return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
  }catch(error){return {isError:true,content:[{type:'text',text:String(error.message)}]};}
 });
 const client=new Client({name:'codex-operator-public-node-qa',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 await writeFile(directory+'/public-tools.json',JSON.stringify(await client.listTools(),null,2));
 let sequence=0;
 const call=async(name,args)=>{
  const id=++sequence,request=JSON.parse(JSON.stringify({name,arguments:args})),before=browserSequence();
  await appendFile(directory+'/public-api.jsonl',JSON.stringify({id,phase:'request',before,request})+'\n');
  const reply=await client.callTool(request,undefined,{timeout:Math.max(60000,(args.budget_ms??0)+30000)});
  await appendFile(directory+'/public-api.jsonl',JSON.stringify({id,phase:'response',after:browserSequence(),reply})+'\n');
  if(reply.isError)throw Error('Public '+name+': '+reply.content.map(x=>x.text??'').join('\n'));
  const result=JSON.parse(reply.content[0].text);
  if(JSON.stringify(result)!==JSON.stringify(reply.structuredContent))throw Error('MCP text and structured result differ');
  return result;
 };
 return {runtime:{...runtime,
  deliverArtifact:request=>call('dock_artifact_deliver',request),
  resumeArtifactDelivery:request=>call('dock_artifact_delivery_resume',request),
  artifactDeliveryStatus:id=>call('dock_artifact_delivery_status',{operation_id:id}),
  run:(action_key,parameters,{operationId}={})=>call('dock_action_run',{action_key,parameters,operation_id:operationId}),
  async runNodeApply(request,{resume=false,signal}={}) {
   if(signal?.aborted)throw Error('Operator public run was cancelled before dispatch');
   let current=await call(resume?'dock_node_resume':'dock_node_apply',request);
   while(current.state==='running')current=await call('dock_node_wait',{operation_id:request.operation_id,timeout_ms:10000});
   if(current.state!=='settled'||!current.outcome)throw Error('Public node worker rejected: '+JSON.stringify(current.error));
   return current.outcome;
  },
 },close:async()=>{await client.close();await server.close();}};
}
