"use strict";
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createECDH, generateKeyPairSync } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const cells = ['stub', 'ES256', 'RS256'].flatMap(runtime => [0, 256].map(iterations => ({ runtime, iterations, arena: 'default' })));
// Schema + linked is a separate feasibility boundary, not inferred from stub or linked alone.
cells.push(...['default', 'elided'].map(arena => ({ runtime: 'schema-linked', iterations: 256, arena })));
const name = c => `${c.runtime}-${c.iterations}-${c.arena}`;
function fixture(c, cwd) {
  assert(cells.some(x => name(x) === name(c)));
  const linked = c.runtime !== 'stub', schema = c.runtime === 'schema-linked', algorithm = c.runtime === 'RS256' ? 'RS256' : 'ES256';
  const d = Buffer.alloc(32); d[31] = 1; const ec = createECDH('prime256v1'); ec.setPrivateKey(d); const point = ec.getPublicKey();
  // Public TEST material; generated RSA key is archived in fixture.json for exact replay.
  const key = algorithm === 'RS256' ? generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey.export({format:'jwk'}) : { kty:'EC',crv:'P-256',d:d.toString('base64url'),x:point.subarray(1,33).toString('base64url'),y:point.subarray(33).toString('base64url') };
  const loop = `let n=70000;let alias=n;for(let i=0;i<${c.iterations};i++){n+=1;}`;
  const sign = which => linked ? `const ${which}=await jwt.sign(ctx,{sub:'${which}'},{algorithm:'${algorithm}',key:{type:'secret',binding:'TEST_KEY'},expiresInSeconds:60});` : '';
  const files = {
    'src/helper.ts': `export function sum():number {${loop}return n+alias;}
export function edges():boolean {let neg=0;let nan=1;let inf=1;let large=9007199254740992;let fraction=0;for(let i=0;i<4;i++){neg=0*-1;nan=0/0;inf=1/0;large+=1;fraction+=0.1;if(i===1)continue;if(i===2)break;}return 1/neg<0 && nan!==nan && inf>0 && large===9007199254740992 && fraction===0.1+0.1+0.1;}
export function unknown(value:number):number {let n=value;for(let i=0;i<4;i++){n+=1;}return n;}
export function aboveCap():number {let n=70000;for(let i=0;i<257;i++){n+=1;}return n;}`,
    'src/shared.ts': `export default async function shared(ctx,next){${loop}const saved={n,alias};const text=await ctx.fetch('https://mem9.test/value',{method:'POST',body:''+n}).text();if(text==='stop')return ctx.text('stopped:'+saved.n);n=80000;for(let j=0;j<2;j++){n+=1;}const trace=ctx.state.get('trace')||'';ctx.state.set('trace',trace+saved.n+':'+saved.alias+':'+n+';');return next();}`,
    'src/index.ts': `import {Pulse} from '@pulse-compute/pulse';import shared from './shared';import {sum,edges,unknown,aboveCap} from './helper';${linked ? "import {jwt} from '@pulse-compute/jwt';" : ''}const app=new Pulse({auto:true});app.post('/',shared);app.use(shared);app.post('/',async ctx=>{${schema ? "const input=await ctx.req.json('proof.Input');" : ''}${sign('before')}${loop}const saved={n,alias};const array=[n];const copy={...saved};const text=await ctx.fetch('https://mem9.test/value',{method:'POST',body:''+n}).text();n=90000;for(let j=0;j<2;j++){n+=1;}${sign('after')}return ctx.json({n,saved,array,copy,a:sum(),b:sum(),edge:edges(),unknown:unknown(70000),cap:aboveCap(),trace:ctx.state.get('trace')${linked ? ',before,after' : ''}});});export default app;`,
    'src/types.ts': 'export interface Input {n:number}',
    'src/schemas.ts': "import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {Input} from './types';export default defineSchemaRegistry({schemas:{'proof.Input':schema<Input>()}});",
  };
  const config = {pulse:{entry:'src/index.ts',strict:false,...(schema ? {schema:'src/schemas.ts'} : {}),...(linked ? {crypto:[algorithm]} : {})},node:{host:'node',target:'native'},fastly:{host:'fastly',target:'native',fastly:{bindings:{secretStore:'app_secrets',backends:{'https://mem9.test':'origin'}}}}};
  files['.pulse/config.ts'] = `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));`;
  for(const [f,s] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(cwd,f)),{recursive:true});fs.writeFileSync(path.join(cwd,f),s);}
  fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for(const pkg of ['pulse','jwt'])fs.symlinkSync(path.join(root,'packages',pkg),path.join(cwd,'node_modules/@pulse-compute',pkg),'dir');
  const n=70000+c.iterations,saved={n,alias:70000};
  return {files,key,algorithm,linked,schema,expected:{n:90002,saved,array:[n],copy:saved,a:n+70000,b:n+70000,edge:true,unknown:70004,cap:70257,trace:`${n}:70000:80002;`.repeat(2)},request:{method:'POST',path:'/',url:'https://mem9.test/',headers:[['content-type','application/json']],body:'{"n":70000}'}};
}
// Test-only gate bypass using the exact existing proof and f64 renderer.
// HOST_POLICY removes schema gating; it does NOT bypass budget exclusion.
function prototypeCompiler() {
  const id=require.resolve('../../packages/runtime-core-as/src/compiler/canonical-native.js');
  const platformId=require.resolve('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
  const canonical=require(id), old=require.cache[platformId];
  require.cache[id].exports={...canonical,generateCanonicalNativeAssemblyScript(plan,options){return canonical.generateCanonicalNativeAssemblyScript(plan,{...options,numericRegions:'host-numeric-regions-v1'});}};
  delete require.cache[platformId];
  try{return require(platformId).compileFastlyNativePlatformCapabilitiesPlan;}
  finally{require.cache[id].exports=canonical;if(old)require.cache[platformId]=old;else delete require.cache[platformId];}
}
module.exports={cells,name,fixture,prototypeCompiler};
