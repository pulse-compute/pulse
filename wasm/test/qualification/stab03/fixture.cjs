'use strict';
const fs=require('node:fs'),path=require('node:path');
const profiles=['node-native','node-javascript','fastly-native'];
const asset='<html><body>composed consumer</body></html>';
function write(root,jwk){
 fs.mkdirSync(path.join(root,'.pulse'),{recursive:true});
 const guard=(scope,binding)=>`const issued=ctx.req.header('x-proof-issued')||'';
 const message='${scope}\\n'+ctx.req.method+'\\n'+ctx.req.url+'\\n'+issued;
 const proof=await crypto.verifyMacText(ctx,message,ctx.req.header('x-proof')||'',{algorithm:'HS256',key:{type:'secret',binding:'${binding}'}});
 if(proof.status!=='valid')return ctx.text('proof denied',{status:403});
 const clock=await ctx.time.now();
 if(clock.status!=='ok')return ctx.text('clock unavailable',{status:503});
 if(issued.length!==13)return ctx.text('invalid proof time',{status:403});
 const time=ctx.decodeJson<{issued:number}>('{"issued":'+issued+'}','proof.Time');
 if(!(time.issued>0)||time.issued>clock.unixEpochMs||clock.unixEpochMs-time.issued>60000)return ctx.text('stale proof',{status:403});`;
 const auth=JSON.stringify({algorithms:['RS256'],key:{type:'jwks',keys:[jwk]},issuer:'composed-fixture',audience:'consumer',requiredClaims:['sub','iat','exp']});
 fs.writeFileSync(path.join(root,'app.ts'),`import {Pulse} from '@pulse-compute/pulse';
import {crypto} from '@pulse-compute/crypto';
import {jwt} from '@pulse-compute/jwt';
import {assets} from '@pulse-compute/assets';
const app=new Pulse({auto:true});
app.use('/api',async(ctx,next)=>{
 ${guard('ingress','INGRESS_KEY')}
 const original=ctx.req.header('authorization');
 const identity=await jwt.verify(ctx,jwt.bearer(ctx.req),${auth});
 if(identity.claims.sub!=='reader')return ctx.text('user denied',{status:403});
 if(original!==ctx.req.header('authorization'))return ctx.text('bearer changed',{status:500});
 return next();
});
app.post('/api/command',async ctx=>{
 const command=await ctx.req.json<{id:string;value:string}>('command.Input');
 if(command.id.length===0||command.id.length>64||command.value.length>256)return ctx.text('invalid',{status:400});
 const result=await ctx.kv<{value:string}>('commands').insertIfAbsent(command.id,{value:command.value});
 if(result.status==='stored')return ctx.json({status:'accepted'},{status:202});
 if(result.status==='unknown')return ctx.json({status:'unknown'},{status:503});
 if(result.status==='conflict'){
  const existing=await ctx.kv<{value:string}>('commands').getVersioned(command.id);
  if(existing.status==='found'&&existing.value.value===command.value)return ctx.json({status:'replayed'});
  return ctx.json({status:'conflict'},{status:409});
 }
 return ctx.json({status:'unavailable'},{status:503});
});
app.post('/worker',async ctx=>{
 ${guard('worker','WORKER_KEY')}
 const command=await ctx.req.json<{id:string}>('worker.Input');
 const read=await ctx.parallel({command:ctx.kv<{value:string}>('commands').getVersioned(command.id),prefix:ctx.config.get('VIEW_PREFIX')});
 if(read.command.status!=='found')return ctx.text('missing',{status:404});
 const result=await ctx.kv('views').insertIfAbsent(command.id,{value:read.command.value.value,prefix:read.prefix||''});
 if(result.status==='stored')return ctx.json({status:'projected'},{status:202});
 if(result.status==='conflict')return ctx.json({status:'replayed'});
 return ctx.json({status:'unknown'},{status:503});
});
app.get('/api/view',async ctx=>{
 const result=await ctx.kv<{value:string;prefix:string}>('views').getVersioned('item');
 if(result.status!=='found')return ctx.text('pending',{status:404});
 return ctx.json({value:result.value.value,prefix:result.value.prefix});
});
app.use('/static',async(ctx,next)=>{${guard('ingress','INGRESS_KEY')}return next();});
app.get('/static/index.html',async ctx=>{const found=await assets.lookup(ctx,'static','/index.html');return assets.respond(found);});
app.head('/static/index.html',async ctx=>{const found=await assets.lookup(ctx,'static','/index.html',{method:'HEAD'});return assets.respond(found);});
app.error(async(error,ctx,next)=>ctx.text('denied',{status:401}));
export default app;
`);
 fs.writeFileSync(path.join(root,'schemas.ts'),`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';export default defineSchemaRegistry({schemas:{'proof.Time':schema<{issued:number}>(),'command.Input':schema<{id:string;value:string}>(),'worker.Input':schema<{id:string}>()}});`);
 const config={pulse:{entry:'app.ts',schema:'schemas.ts',defaultProfile:'node-native',strict:false,crypto:['HS256','RS256']}};
 for(const profile of profiles){const[host,target]=profile.split('-');config[profile]={host,target,outDir:`out/${profile}`,
  [host]:{maxDurationMs:15000,...(host==='fastly'?{bindings:{secretStore:'app_secrets',configStore:'app_config',kv:{commands:'commands',views:'views',static:'static'}}}:{})}};}
 fs.writeFileSync(path.join(root,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));\n`);
}
module.exports={write,profiles,asset};

// Reduction controls distinguish the signature guest itself from two independent
// allocating compositions. These are compiler evidence, not request executions.
function writeControl(root,jwk,kind){
 fs.mkdirSync(path.join(root,'.pulse'),{recursive:true});
 const auth=JSON.stringify({algorithms:['RS256'],key:{type:'jwks',keys:[jwk]}});
 const tail=kind==='mac'
  ? "const proof=await crypto.verifyMacText(ctx,ctx.req.url,ctx.req.header('x-proof')||'',{algorithm:'HS256',key:{type:'secret',binding:'INGRESS_KEY'}});return ctx.text(proof.status);"
  : kind==='schema' ? "const time=ctx.decodeJson<{issued:number}>('{\"issued\":1}','proof.Time');return ctx.text(''+time.issued);" : "return ctx.text(identity.claims.sub||'');";
 fs.writeFileSync(path.join(root,'app.ts'),`import {Pulse} from '@pulse-compute/pulse';import {jwt} from '@pulse-compute/jwt';import {crypto} from '@pulse-compute/crypto';const app=new Pulse({auto:true});app.get('/',async ctx=>{const identity=await jwt.verify(ctx,jwt.bearer(ctx.req),${auth});${tail}});export default app;`);
 if(kind==='schema')fs.writeFileSync(path.join(root,'schemas.ts'),`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';export default defineSchemaRegistry({schemas:{'proof.Time':schema<{issued:number}>()}});`);
 const config={pulse:{entry:'app.ts',defaultProfile:'node-native',strict:false,crypto:kind==='mac'?['RS256','HS256']:['RS256'],...(kind==='schema'?{schema:'schemas.ts'}:{})},'node-native':{host:'node',target:'native'}};
 fs.writeFileSync(path.join(root,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
}
module.exports.writeControl=writeControl;
