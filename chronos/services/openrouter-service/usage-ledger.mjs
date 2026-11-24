import { t3Home } from '../paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export function receipt(response,model,{id,at=Date.now()}={}){
 const u=response.usage||response.data?.usage||{},p=u.prompt_tokens_details||u.input_tokens_details||{},c=u.completion_tokens_details||u.output_tokens_details||{};
 const cached=finite(p.cached_tokens)??finite(u.cached_tokens)??0;
 const input=finite(u.prompt_tokens)??finite(u.input_tokens)??0;
 const output=finite(u.completion_tokens)??finite(u.output_tokens)??0,reasoning=Math.min(output,finite(c.reasoning_tokens)??0);
 return {id:String(id||response.id||response.data?.id||randomUUID()),role:'assistant',providerID:'openrouter',modelID:response.model||response.data?.model||model,
  sessionID:'openrouter-mcp',time:{created:at},tokens:{input:Math.max(0,input-cached),output:output-reasoning,cache:{read:cached,write:0},reasoning},
  cost:finite(u.cost)??finite(u.total_cost)??finite(response.cost)??null,olyOpenrouterReceipt:true};
}
export function writeReceipt(response,model,{root=process.env.OLY_USAGE_ROOT||path.join(t3Home,'userdata','openrouter-usage'),id,at}={}){
 const r=receipt(response,model,{id,at});
 const dir=path.join(root,'storage','message','openrouter-mcp');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,createHash('sha256').update(r.id).digest('hex')+'.json');
 let old;try{old=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
 if(old){r.modelID||=old.modelID;r.time=old.time;if(r.cost==null)r.cost=old.cost;if(!r.tokens.input&&!r.tokens.output)r.tokens=old.tokens}
 if(!r.modelID)return null;
 const tmp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(r));fs.renameSync(tmp,file);return file;
}
