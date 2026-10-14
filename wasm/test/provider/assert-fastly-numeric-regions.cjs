'use strict';
const assert = require('node:assert/strict');
const { normalizeSchemaRegistry } = require('../../packages/contracts/src/schema-json/registry');
const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { generateCanonicalNativeAssemblyScript: generate } = require('../../packages/runtime-core-as/src/compiler/canonical-native');
const { prepareNumericRegions, POLICY } = require('../../packages/runtime-core-as/src/compiler/canonical-native-numeric');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { withBoxedControl } = require('../support/numeric-region-control.cjs');
const location = { file: 'numeric-regions.ts', line: 1, column: 1 };
const schemaBundle = buildCanonicalSchemaBundle(normalizeSchemaRegistry({ source: location, schemas: [{ id: 'proof.Input', typeName: 'Input', source: location,
  root: { kind: 'object', fields: [{ name: 'n', required: true, value: { kind: 'f64' } }] } }] }));
const source = `export default async function handler(ctx) {
  const input = await ctx.req.json('proof.Input');
  let n = 70000; let alias = n;
  for(let i=0;i<8;i++) { for(let j=0;j<8;j++) { if(j===2) continue; n += 0.25; if(j===5) break; } }
  const before = {n,alias}; const array = [n,alias]; const spread = {...before};
  n = 80000; for(let i=0;i<4;i++){ n++; }
  const after = {n};
  let fraction = 0; let large = 9007199254740992; let neg = 0; let nan = 1; let inf = 1; let rem = 1;
  for(let i=0;i<3;i++){ fraction += 0.1; large += 1; neg = 0 * -1; nan = 0 / 0; inf = 1 / 0; rem = 1 % 0; }
  const numeric = {fraction,large,negativeZero:1/neg<0,nan:nan!==nan,truth:!!nan,infinity:inf>0,remainder:rem!==rem};
  let conditional = 1; for(let i=0;i<4;i++){ conditional = i===2 ? conditional*2 : conditional+0.5; if(i===3){conditional--;}else{++conditional;} }
  let zero = 12; for(let i=0;i<0;i++){zero+=1;}
  let truth=0; let z=0; let notNumber=0/0;
  for(let i=0;i<2;i++){if(notNumber){truth+=100;}else{truth+=1;}if(z){truth+=100;}if(!notNumber){truth+=2;}if(1/0){truth+=4;}}
  const flow = {conditional,zero,truth};
  let mixed = input.n; for(let i=0;i<2;i++){mixed+=1;}
  let text = 'x'; for(let i=0;i<2;i++){text+='y';}
  const retained = []; let escaped=70000; for(let i=0;i<3;i++){retained[i]=escaped;escaped+=1;}
  let nested=1; for(let i=0;i<2;i++){nested+=(nested++);}
  const unsupported = {mixed,text,retained,nested};
  let sent=123; for(let i=0;i<3;i++){sent+=1;}
  const saved = {sent};
  const first = await ctx.fetch('https://numeric.test/first',{method:'POST',body:sent}).text();
  let resumed=200; for(let i=0;i<2;i++){resumed+=1;}
  const {slow,fast} = await ctx.parallel({slow:ctx.fetch('https://numeric.test/slow').text(),fast:ctx.fetch('https://numeric.test/fast').text()});
  const pair={slow,fast};
  return ctx.json({before,array,spread,after,numeric,flow,unsupported,saved,sent,resumed,first,pair});
}`;
function proofAdmission() {
  const local = id => ({kind:'local',id,valueKind:'number'}), literal = value => ({kind:'literal',value,valueKind:'number'});
  const assign = value => ({kind:'expression',expression:{kind:'assignment',operator:'+=',target:local('n'),value}});
  const init = {kind:'local',localId:'n',value:literal(70000)};
  const loop = body => ({kind:'pure-loop',localId:'i',maxIterations:3,test:{kind:'binary',operator:'<',left:local('i'),right:literal(3)},body});
  const plan = {locals:[{id:'n'},{id:'i'},{id:'unknown'}]};
  const proof = (statements, options={}) => prepareNumericRegions({plan,policy:POLICY,schemaActive:true,budgeted:false,localName:id=>id,...options}).select(statements);
  assert.equal(proof([init,loop([assign(literal(1))])]).size,2);
  for(const unsafe of [local('unknown'), literal('1'),{kind:'pure-helper-call',helperId:'x',arguments:[]}, {kind:'assignment',operator:'=',target:local('n'),value:literal(1)}])
    assert.equal(proof([init,loop([assign(unsafe)])]).size,0,'independent proof ignores spoofed numeric annotations');
  assert.equal(proof([loop([assign(literal(1))])]).size,0,'unknown incoming handle');
  assert.equal(proof([init,loop([assign(literal(1))])],{budgeted:true}).size,0);
  assert.equal(proof([init,loop([assign(literal(1))])],{schemaActive:false}).size,0);
  assert.equal(proof([init,loop([assign(literal(1))])],{policy:undefined}).size,0);
  const conditionalInit={kind:'if',test:local('i'),then:[{kind:'local',localId:'unknown',value:literal(1)}],else:[]};
  assert.equal(proof([init,loop([conditionalInit,assign(local('unknown'))])]).size,0,'one-arm initialization does not dominate read');
  assert.equal(proof([init,loop([{kind:'pure-loop',localId:'unknown',maxIterations:0,test:literal(0),body:[]},assign(local('unknown'))])]).size,0,'zero-trip loop does not initialize live-out');
}
async function main() {
  proofAdmission();
  const plan=buildCanonicalNativePlan(compileCanonicalSource(source,{fileName:location.file,schemaBundle,strict:false,target:'native'}));
  const before=JSON.stringify(plan), portable=generate(plan), optimized=generate(plan,{numericRegions:POLICY});
  assert.equal(JSON.stringify(plan),before,'analysis never mutates plan');
  const shape = generated => generated.blocks.map(({lines,...block})=>block);
  assert.deepEqual(shape(optimized),shape(portable),'control IDs, boundaries, weights and continuation sites unchanged');
  assert.equal(optimized.manifest.guardStateCount,portable.manifest.guardStateCount);
  assert(optimized.manifest.numericRegions.regions.length>=6);
  assert.equal(generate(plan).source,portable.source,'default/Node emission is unchanged by prior Fastly selection');
  for(const capability of ['response.output','request.body.transform']) assert.equal(generate({...plan,capabilities:[...plan.capabilities,capability]},{numericRegions:POLICY}).manifest.numericRegions.enabled,false);
  const options={canonicalBuild:true,requirePlatformCapability:false,bindings:{backends:{'https://numeric.test':'numeric'}}};
  const control=withBoxedControl(p=>p.compileFastlyNativePlatformCapabilitiesPlan(plan,options));
  const artifact=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  assert.equal(artifact.manifest.numericRegions.policy,POLICY);
  const fixtures={'https://numeric.test/first':{body:'first',status:200},'https://numeric.test/slow':{body:'slow',status:200,delayMs:5},'https://numeric.test/fast':{body:'fast',status:200}};
  const handler = new Function(source.replace('export default','return'))();
  for(const n of [0,-3,0.25,9007199254740992]) {
    const expected=await handler({req:{json:async()=>({n})},fetch:url=>({text:async()=>fixtures[url].body}),parallel:async items=>Object.fromEntries(await Promise.all(Object.entries(items).map(async ([k,v])=>[k,await v]))),json:v=>v});
    const opts={fixtures,request:{method:'POST',path:'/',headers:[['content-type','application/json']],body:JSON.stringify({n})}};
    const a=execute(artifact,opts),b=execute(control,opts);
    assert.equal(a.response.body,b.response.body);
    assert.deepEqual(JSON.parse(a.response.body),expected);
    assert.deepEqual(a.trace,b.trace,'effect order and host lifecycle unchanged');
    assert.deepEqual(a.outboundRequests,b.outboundRequests,'exact effect payload bytes survive boxing');
  }
  for(const failure of [{sendStatus:1},{neverHeaders:true}]) {
    const opts={fixtures:{...fixtures,'https://numeric.test/first':failure},request:{method:'POST',path:'/',headers:[['content-type','application/json']],body:'{"n":1}'}};
    function outcome(compiled){try{return {response:execute(compiled,opts).response};}catch(e){return {code:e.code,detail:e.detail};}}
    assert.deepEqual(outcome(artifact),outcome(control),'failure/deadline parity');
  }
  for (const slow of [{neverHeaders:true},{sendStatus:1}]) {
    const opts={fixtures:{...fixtures,'https://numeric.test/slow':slow},request:{method:'POST',path:'/',headers:[['content-type','application/json']],body:'{"n":1}'}};
    const failure=compiled=>{try{return execute(compiled,opts).response;}catch(e){return {code:e.code,detail:e.detail};}};
    assert.deepEqual(failure(artifact),failure(control),'parallel failure/deadline keeps cancellation and pending-resource behavior');
  }
  const recovery=execute(artifact,{fixtures,request:{method:'POST',path:'/',headers:[['content-type','application/json']],body:'{"n":2}'}});
  assert.equal(recovery.response.status,200,'fresh instance after failure');
  await require('./assert-fastly-numeric-owners.cjs').main();
  console.log('ok - numeric regions: proof rejection, unchanged control, aliases, snapshots, IEEE numbers, loops, effects and recovery');
}
module.exports={main,source,schemaBundle};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
