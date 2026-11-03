'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {compileCanonicalSource} = require('../../packages/compiler/src/canonical-api-compiler');
const {buildCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-plan');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const mock = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const {createConditionalKvAuthority} = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
const source = `import {Pulse} from '@pulse-compute/pulse';
import {s3} from '@pulse-compute/s3';
const app = new Pulse({auto:true});
app.get('/', async ctx => {
  const one = await ctx.kv('catalog').getVersioned('private-key');
  const object = await s3.getText(ctx, 'objects', 'private-object');
  return ctx.text('done');
});
app.get('/many', async ctx => {
  for(let i=0;i<64;i++) { const one=await ctx.kv('catalog').getVersioned('private-key'); }
  for(let j=0;j<64;j++) { const two=await ctx.kv('catalog').getVersioned('private-key'); }
  return ctx.text('done');
});
app.get('/parallel', async ctx => {
  const pair=await ctx.parallel({one:ctx.kv('catalog').getVersioned('one'),two:ctx.kv('catalog').getVersioned('two')});
  return ctx.text('done');
}); export default app;`;
function main() {
  const bindings = {...require('../s3/o1/bindings.json').fastly.bindings,kv:{catalog:'catalog'}};
  const cwd=fs.mkdtempSync(path.join(__dirname,'.latency-'));
  process.on('exit',()=>fs.rmSync(cwd,{recursive:true,force:true}));
  fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));
  fs.writeFileSync(path.join(cwd,'src/index.ts'),source);
  const config={pulse:{entry:'src/index.ts',defaultProfile:'fastly',strict:false,crypto:['SHA-256','HMAC-SHA256']},fastly:{host:'fastly',target:'native',fastly:{bindings,maxDurationMs:10000}}};
  fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
  const project=require('../../packages/cli/src/project-config').resolveProject({cwd});
  const compiled=require('../../packages/cli/src/project-execution').compileProject(project);
  const plan = buildCanonicalNativePlan(compiled);
  const options = {cwd:path.resolve(__dirname,'../../..'),bindings,maxDurationMs:10000,emitWat:false};
  const disabled = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,options);
  assert.equal(platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,{...options,latencyDiagnostics:false}).source,disabled.source);
  assert.doesNotMatch(disabled.source,/x-pulse-latency|__lat_/);
  assert.throws(()=>platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,{...options,latencyDiagnostics:true,maxDurationMs:undefined}));
  assert.throws(()=>platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,{...options,latencyDiagnostics:'true'}));
  const native = platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,latencyDiagnostics:true});
  assert.equal(native.manifest.latencyDiagnostics,'pulse.request-latency.v1');
  assert.throws(()=>require('../../../packages/provider-fastly/src/build/canonical-target').inspectFastlyCanonicalTarget({plan,native,providerConfig:{bindings,maxDurationMs:10000}}),/latency evidence selection/);
  const authority = createConditionalKvAuthority();authority.stores.set('catalog',new Map());
  const execute = (extra={})=>mock.executeFastlyNativePlatformCapabilities(native,{
    conditionalKv:{authority,onCall(stage){if(stage==='lookup')return {readyDelayMs:25};}},
    secrets:{S3_ACCESS_KEY_ID:'fixture-access',S3_SECRET_ACCESS_KEY:'fixture-private-secret'},secretDelayMs:7,
    fixtures:{'https://objects.example.invalid/o1-fixture/private-object':{status:200,body:'private-body',delayMs:35,bodyDelayMs:11}},...extra});
  const header = result=>{
    const values=result.response.headers.filter(([k])=>k==='x-pulse-latency');assert.equal(values.length,1);
    assert(Buffer.byteLength(values[0][1])<=4096);return JSON.parse(values[0][1]);
  };
  const result=execute();assert.equal(result.response.status,200);assert.equal(result.response.body,'done');
  const timing=header(result);assert.equal(timing.valid,true);assert.equal(timing.open,0);
  assert.equal(timing.wallUs,85000);assert.equal(timing.spans.length,2);
  const kv=timing.spans[0],s3=timing.spans[1];
  assert.equal(kv[3],25000);assert.equal(kv[4],25000);
  assert.equal(s3[3],60000);assert.equal(s3[4],46000);assert.equal(s3[5],14000);
  for(const secret of ['private-key','private-object','private-body','fixture-access','fixture-private-secret'])assert(!JSON.stringify(timing).includes(secret));
  const timeout=execute({conditionalKv:{authority,onCall(stage){if(stage==='lookup')return {readyDelayMs:20000};}}});
  assert.equal(timeout.response.status,504);assert.equal(header(timeout).valid,true);
  assert.equal(timeout.outboundRequests.length,0,'Expired KV does not introduce S3 work');
  const missing=execute({secrets:{}});assert.equal(missing.response.status,200);assert.equal(header(missing).open,0);
  const many=execute({request:{method:'GET',path:'/many'}}), manyTiming=header(many);
  assert.equal(many.response.status,200);assert(manyTiming.dropped>0);
  assert.equal(manyTiming.totals.reduce((n,row)=>n+row[1],0),128,'Truncation must preserve all aggregate counts');
  const parallel=header(execute({request:{method:'GET',path:'/parallel'}}));
  assert.equal(parallel.wallUs,25000);assert.equal(parallel.spans.length,2);
  assert.equal(parallel.spans.reduce((n,row)=>n+row[3],0),50000,'Concurrent spans retain overlap rather than pretending to partition request time');
  console.log('ok - opt-in latency: known KV/S3/credential delays, body wait separation, early failure, deadline parity, secret exclusion and artifact selection');
}
if(require.main===module)main();
module.exports={main};
