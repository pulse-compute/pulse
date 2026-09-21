#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const { compileCanonicalSource, loadCanonicalModule } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const execution = require('../../packages/cli/src/project-execution.js');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const driver = require('../../../packages/provider-node/src/toolchain.js').createDriver();
const jsHost = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const { Router } = require('../../../packages/runtime/src/index.js');
const { createCanonicalSchemaCodecs } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const platformHost = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const { handlerIrForCanonicalSourceOutput } = require('../../packages/compiler/src/spine/canonical-source.js');
const { payloadForCanonicalHandlerIr } = require('../../packages/compiler/src/spine/canonical-handler-ir.js');
const repoRoot = path.resolve(__dirname, '../../..');
const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/bounded-read-loops');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const compile = (source, target = 'native') => compileCanonicalSource(source, { fileName: 'bounded-read-loop.ts', requireAsync: true, strict: false, target });
const kvRead = "const row=await ctx.kv('pages').getVersioned(key);";
const program = loop => `export default async function handler(ctx) {let key='p1';let count=0;${loop};return ctx.text(count+':'+key)}`;
const loop = body => `for(let i=0;i<4;i++){${body}}`;
const rehash = plan => { delete plan.planHash; plan.planHash = sha256(stableStringify(plan)); return plan; };

async function main() {
  const negatives = [
    `for(let i=0;i<65;i++){${kvRead}}`, `for(let i=0;i<count;i++){${kvRead}}`,
    `for(let i=1;i<4;i++){${kvRead}}`, `for(var i=0;i<4;i++){${kvRead}}`,
    `for(let i=0;i<1.5;i++){${kvRead}}`, `for(let i=0;i<4;i--){${kvRead}}`,
    `for(let i=0;key!==''&&i<4;i++){${kvRead}}`, `for(let i=0;i<4&&(count=0);i++){${kvRead}}`,
    loop(kvRead+'i=0'), loop(kvRead+'if(count){i--}'), loop(kvRead+'const i=0'),
    loop(kvRead+'const ctx={}'), loop(kvRead+'[i]=[0]'), loop(kvRead+'const f=()=>i'),
    loop(kvRead+'for(let j=0;j<2;j++){i=0}'), loop(kvRead+'for(let i=0;i<2;i++){}'),
    loop(kvRead+`for(let j=0;j<2;j++){${kvRead}}`),
    `for(let i=0;i<64;i++){${kvRead}for(let j=0;j<1024;j++){for(let k=0;k<2;k++){count++}}}`,
    loop(kvRead+'continue label'), loop(kvRead+'break label'),
    loop(kvRead+"await ctx.kv('pages').put(key,'write')"),
    loop(kvRead+"await ctx.kv('pages').compareAndSwap(key,'token',{})"),
    loop(kvRead+"await ctx.fetch('https://example.invalid').text()"),
    loop(kvRead+"const group=await ctx.parallel({a:ctx.kv('pages').getVersioned(key)})"),
    loop(kvRead+'const x=await helper()'), loop(kvRead+'const x=helper()'),
    loop(kvRead+"ctx.state.set('x','y')"), loop(kvRead+"ctx.log.info('x')"),
    loop(kvRead+'const x=ctx.req.path'), loop(kvRead+'while(true){}'),
    loop("const row=await ctx.kv('pages').getVersioned(i=0)"),
    loop("const row=await ctx.kv(i=0).getVersioned(key)"),
    loop(kvRead+"return ctx.kv('pages').getVersioned(key)"),
    loop(kvRead+'const a=[1].map(x=>x)'),
    // Existing pure-loop admission must not inherit read-loop calls/transfers.
    loop(kvRead+"for(let j=0;j<2;j++){return ctx.text('bad')}"),
    loop(kvRead+"for(let j=0;j<2&&ctx.decodeJson('{}','pages.Page');j++){}"),
  ];
  for (const target of ['native', 'javascript']) for (const source of negatives) {
    assert.throws(() => compile(program(source), target), error => error.diagnostics?.some(d =>
      ['PULSE_CANONICAL_READ_LOOP_UNSUPPORTED', 'PULSE_CANONICAL_PURE_LOOP_UNSUPPORTED', 'PULSE_NATIVE_AWAIT_UNSUPPORTED'].includes(d.code)), `${target}: ${source}`);
  }
  for(const target of ['native','javascript'])for(const body of [
    "store=other;const row=await store.getVersioned(key)",
    "const store=other;const row=await store.getVersioned(key)",
    "for(let j=0;j<2;j++){store=other}const row=await store.getVersioned(key)",
  ]) assert.throws(()=>compile(`export default async function h(ctx){let key='p';let store=ctx.kv('pages');const other=ctx.kv('other');${loop(body)}return ctx.text('done')}`,target),
    error=>error.diagnostics?.some(d=>d.code==='PULSE_CANONICAL_READ_LOOP_UNSUPPORTED'));
  const source = program(`for(let i=0;i<4&&key!=='';i+=1){if(count===9)continue;${kvRead}if(row.status!=='found')break;key=row.value.next;count+=1}`);
  const compiled = compile(source);
  const ir = payloadForCanonicalHandlerIr(handlerIrForCanonicalSourceOutput(compiled)).operationIr;
  assert.equal(ir.summary.operationKinds['read-loop'], 1);
  assert.equal(ir.effectSites.length, 1);
  const plan = buildCanonicalNativePlan(compiled);
  const readLoop = plan.entry.body.find(s => s.kind === 'read-loop');
  assert.equal(readLoop.version, 'pulse.bounded-read-loop.v1');
  assert.equal(plan.effects.length, 1); assert.equal(plan.continuations.length, 1);
  assert.equal(plan.planHash, buildCanonicalNativePlan(compile(source)).planHash);
  assert.notEqual(plan.planHash, buildCanonicalNativePlan(compile(source.replace('i<4', 'i<3'))).planHash);
  const invalidPlans = [
    ['iteration bound', s => { s.maxIterations = 65; }],
    ['literal cap', s => { s.test.left.right.value = 3; }],
    ['initialize', s => { s.initial.value = 1; }],
    ['increment', s => { s.increment.value.value = 2; }],
    ['increment', s => { s.increment.target.id = plan.locals[0].id; }],
    ['contract version', s => { s.version = 'unknown'; }],
    ['counter', s => { s.body.push({ kind: 'expression', expression: { kind: 'update', operator: '--', target: { kind: 'local', id: s.localId } } }); }],
    ['unsupported statement', s => { s.body.push({ kind: 'effect-group', effectIds: [], results: [], continuationId: plan.continuations[0].id }); }],
    ['cannot nest', s => { s.body.push(structuredClone(s)); }],
    ['unsupported value', s => { s.body.push({ kind: 'expression', expression: { kind: 'intrinsic', name: 'state.get', arguments: [] } }); }],
    ['sequential effect', s => { s.body = []; }],
  ];
  for (const [message, change] of invalidPlans) {
    const changed = structuredClone(plan); change(changed.entry.body.find(s => s.kind === 'read-loop'));
    assert.throws(() => validateCanonicalNativePlan(rehash(changed)), error => error.diagnostics?.some(d => d.message.includes(message)), message);
  }
  {const changed = structuredClone(plan);changed.effects[0].kind='kv.put';
    assert.throws(()=>validateCanonicalNativePlan(rehash(changed)),error=>error.diagnostics?.some(d=>d.message.includes('effect kind is not admitted')));}
  for(const mutation of [
    p=>{p.effects[0].result.localId=p.entry.body.find(s=>s.kind==='read-loop').localId;},
    p=>{p.effects[0].inputs[0].value={kind:'update',operator:'--',target:{kind:'local',id:p.entry.body.find(s=>s.kind==='read-loop').localId}};},
  ]) {const changed=structuredClone(plan);mutation(changed);assert.throws(()=>validateCanonicalNativePlan(rehash(changed)),error=>error.diagnostics?.some(d=>d.message.includes('counter')));}
  const native = compileCanonicalNativePlan(plan, { cwd: repoRoot });
  const repeat = compileCanonicalNativePlan(plan, { cwd: os.tmpdir() });
  assert.deepEqual(native.wasm, repeat.wasm);
  const requests = [];
  const opts = { strict: false, providerAdapter: { id: 'node', dispatchEffect(effect) {
    requests.push(effect.key); return { status: 'found', generation: 'fixture-token', value: { next: requests.length < 3 ? 'p'+(requests.length+1) : '' } };
  } } };
  const result = await nativeHost.executeCanonicalNativeModule(native, opts);
  assert.equal(result.response.body, '3:');assert.deepEqual(requests, ['p1','p2','p3']);
  // The lifecycle suite below executes repeated sites in the internal generator
  // as well as the selected original-source JavaScript and Native hosts.
  assert.ok(loadCanonicalModule(compiled));

  // Source JavaScript and Native exercise continue before/after suspension,
  // iteration-local reset, outer shadowing, and nearest-loop control transfers.
  const controlSource = `export default async function h(ctx){let key='p';let sum=0;const i=99;const store=ctx.kv('pages');
    for(let i=0;i<4;i++){if(i===0)continue;const row=await store.getVersioned(key);let fresh;if(i===1)fresh=7;if(fresh!==undefined)sum+=fresh;
      for(let j=0;j<4;j++){if(j===0)continue;if(j===2)break;sum+=j}if(i===2)continue;sum+=10;}
    return ctx.text(sum+':'+i)}`;
  const control = compile(controlSource), controlNative = compileCanonicalNativePlan(buildCanonicalNativePlan(control), { cwd: repoRoot });
  const authored = {};Function('exports', ts.transpileModule(controlSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(authored);
  const app = new Router();app.get('/',authored.default);
  const n = await nativeHost.executeCanonicalNativeModule(controlNative, { strict: false, providerAdapter: { id: 'node', dispatchEffect: () => ({ status: 'not-found' }) } });
  const j = await jsHost.executeNodeJavascriptApplication(app,new Request('https://example.invalid/'),{ strict:false });
  assert.equal(n.response.body,'30:99');assert.equal(await j.text(),n.response.body);assert.equal(n.effectCount,3);
  const zero=compile(controlSource.replace('i<4','i<0'));const zn=compileCanonicalNativePlan(buildCanonicalNativePlan(zero),{cwd:repoRoot});
  assert.equal((await nativeHost.executeCanonicalNativeModule(zn,{strict:false})).response.body,'0:99');
  const partitioned = compileCanonicalNativePlan(buildCanonicalNativePlan(compile(controlSource.replace('if(i===0)', 'sum+=0;'.repeat(80)+'if(i===0)'))),{cwd:repoRoot});
  assert.equal(partitioned.manifest.dispatcher.strategy,'bounded-state-chunks');
  assert.equal((await nativeHost.executeCanonicalNativeModule(partitioned,{strict:false,providerAdapter:{id:'node',dispatchEffect:()=>({status:'not-found'})}})).response.body,'30:99');
  const single=compileCanonicalNativePlan(buildCanonicalNativePlan(compile(program("for(let i=0;i<3;++i)if(i>0)await ctx.kv('pages').getVersioned(key)"))),{cwd:repoRoot});
  const discarded=await nativeHost.executeCanonicalNativeModule(single,{strict:false,providerAdapter:{id:'node',dispatchEffect:()=>({status:'not-found'})}});
  assert.equal(discarded.effectCount,2);assert.equal(discarded.response.body,'0:p1');

  const cwd=fs.mkdtempSync(path.join(fixture,'.read-loop-'));
  try {
    fs.cpSync(path.join(fixture,'src'),path.join(cwd,'src'),{recursive:true});fs.cpSync(path.join(fixture,'.pulse'),path.join(cwd,'.pulse'),{recursive:true});
    fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
    for(const name of ['pulse','s3','crypto'])fs.symlinkSync(path.join(repoRoot,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
    const np=resolveProject({cwd,profile:'node'}), prepared=execution.compileNativeProjectInMemory(np);
    const jp=resolveProject({cwd,profile:'javascript'}), js=execution.prepareJavascriptApplication(jp);
    const fp=resolveProject({cwd,profile:'fastly'}), fastly=platform.compileFastlyNativePlatformCapabilitiesPlan(prepared.plan,{cwd,bindings:fp.providerConfig.bindings,canonicalBuild:true});
    const schemaCodecs=createCanonicalSchemaCodecs(prepared.plan.schemas.registry);
    assert.deepEqual(prepared.plan.effects.map(e=>e.kind),['s3.getText','crypto.digestText']);
    assert.equal(prepared.plan.continuations.length,2);
    const secrets={S3_ID:'fixture-id',S3_KEY:'fixture-secret-012345678901234567890123456789'};
    const vectors=[
      {name:'empty',pages:[],expected:'0:0::99'},
      {name:'one',pages:[{next:'',action:'',values:[1,-1,2,99]}],expected:'1:103::99'},
      {name:'continue-break',pages:[{next:'p2',action:'continue',values:[1]},{next:'p3',action:'break',values:[2]}],expected:'2:3:p3:99'},
      {name:'return',pages:[{next:'p2',action:'',values:[1]},{next:'p3',action:'return',values:[2]}],expected:'found:1:103'},
      {name:'break-before',pages:[{next:'',action:'',values:[]}],stop:'p1',expected:'0:0:p1:99',reads:0},
      {name:'cap',pages:Array.from({length:65},(_,i)=>({next:'p'+(i+2),action:'',values:[1]})),expected:'64:6464:p65:99',reads:64},
      {name:'cycle',pages:[{next:'p1',action:'continue',values:[1]}],expected:'64:64:p1:99',reads:64},
    ];
    for(const row of vectors){
      const responses=Object.fromEntries(row.pages.map((p,i)=>['https://objects.example.invalid/pages/p'+(i+1),JSON.stringify(p)]));
      const request={method:'GET',path:'/pages',url:'https://app.example.invalid/pages',headers:[['x-start',row.pages.length?'p1':''],['x-stop-before',row.stop||'']],body:''};
      const nodeCalls=[],jsCalls=[],fastlyCalls=[];
      const fetcher=calls=>async(input,init)=>{const r=new Request(input,init);calls.push(r.url);assert.ok(responses[r.url]);return new Response(responses[r.url],{status:200,headers:{'content-type':'application/json'}})};
      const nr=await nativeHost.executeCanonicalNativeModule(prepared.native,driver.executionOptions(np.providerConfig,{request,strict:false,secrets,fetchImplementation:fetcher(nodeCalls)}));
      const jr=await jsHost.executeNodeJavascriptApplication(js.loaded.application,new Request(request.url,{headers:request.headers}),{schemaCodecs,s3:jp.providerConfig.bindings.s3,strict:false,secrets,fetchImplementation:fetcher(jsCalls)});
      const fr=platformHost.executeFastlyNativePlatformCapabilities(fastly,{request,secrets,secretStore:'app_secrets',fixtures:Object.fromEntries(Object.entries(responses).map(([url,body])=>['GET '+url,{status:200,headers:[['content-type','application/json'],['content-length',String(Buffer.byteLength(body))]],body}])),onOutboundRequest(r){fastlyCalls.push(r.url)}});
      assert.equal(nr.response.body,row.expected,row.name+'/native');assert.equal(await jr.text(),row.expected,row.name+'/javascript');assert.equal(fr.response.body,row.expected,row.name+'/fastly');
      assert.equal(nodeCalls.length,row.reads??row.pages.length);assert.deepEqual(jsCalls,nodeCalls);assert.deepEqual(fastlyCalls,nodeCalls);
      assert.equal(nr.effectCount,nodeCalls.length*2);
    }
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
  await require('../runtime/bounded-read-loop-lifecycle.cjs').main();
  console.log(JSON.stringify({status:'passed',negativeSources:negatives.length*2+6,planMutations:invalidPlans.length+3,storageVectors:7,lifecycle:'PS2',targets:['node-javascript','node-native','internal-generator','fastly-native-fixture'],providerReality:false}));
}
main().catch(error=>{console.error(error.stack);console.error(JSON.stringify(error.diagnostics||error.detail||{}));process.exitCode=1});
