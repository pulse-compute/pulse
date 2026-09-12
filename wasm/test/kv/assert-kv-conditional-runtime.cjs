'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const host = require('../../../packages/runtime/src/host');
const { createNodeKvReference } = require('../../../packages/provider-node/src/runtime/conditional-kv');
const spec = require('./k1/reference.cjs');
const vectors = require('./k1/vectors.json');

async function main() {
  for (const row of vectors.tokens) assert.equal(host.normalizeKvGeneration(row.token), row.token);
  for (const token of [...vectors.invalidTokens, 1n, 'x'.repeat(257)]) assert.throws(() => host.normalizeKvGeneration(token));
  for (const {value, wire} of vectors.wire) {
    assert.equal(Buffer.from(host.encodeConditionalKvValue(value)).toString(), wire);
    assert.deepEqual(host.decodeConditionalKvValue(Buffer.from(wire)), spec.decode(Buffer.from(wire)));
  }
  for (const wire of vectors.invalidWire) assert.throws(() => host.decodeConditionalKvValue(Buffer.from(wire)));
  for (const wire of [Buffer.from([255]), Buffer.from('{"__pulseKv":1,"value":{"x":1,"\\u0078":2}}')]) assert.throws(() => host.decodeConditionalKvValue(wire));
  const largest = 'x'.repeat(65534);
  assert.equal(host.decodeConditionalKvValue(host.encodeConditionalKvValue(largest)), largest);
  assert.throws(() => host.encodeConditionalKvValue(largest + 'x'));
  const deepest = (n) => { let value=null; while(n--) value=[value]; return value; };
  assert.deepEqual(host.decodeConditionalKvValue(host.encodeConditionalKvValue(deepest(64))), deepest(64));
  for (const invalid of [deepest(65), Array(10000).fill(0), undefined, NaN, 1n]) assert.throws(() => host.encodeConditionalKvValue(invalid));
  let accessed=0; const array=[]; Object.defineProperty(array,'0',{get(){accessed++;return 'secret';},enumerable:true});
  assert.throws(() => host.encodeConditionalKvValue(array)); assert.equal(accessed,0,'validation cannot invoke an array getter');
  for (const key of ['', '\ud800', '\u0080', 'x'.repeat(1025)]) assert.throws(() => host.normalizeConditionalKvKey(key));
  for (const key of ['#','..','雪'.repeat(341)+'a']) assert.equal(host.normalizeConditionalKvKey(key),key);
  const ref=createNodeKvReference({kvInstanceId:'unit',kvGenerationStart:'9007199254740993'});
  const capabilities={prepareConditionalKv:ref.prepareConditionalKv};
  const execution=host.createJavascriptEffectExecution({capabilities});
  const value={nested:{text:'admitted-value'}};
  const pending=execution.dispatch({kind:'kv.insertIfAbsent',namespace:'n',key:'private-key',value});
  value.nested.text='mutated';
  assert.deepEqual(await pending,{status:'stored'});
  const read=await execution.dispatch({kind:'kv.getVersioned',namespace:'n',key:'private-key'});
  assert.equal(read.value.nested.text,'admitted-value'); assert.ok(Object.isFrozen(read.value.nested));
  assert.equal(read.generation,'node-kv-v1:unit:00000000000000000020000000000002');
  await ref.kv('n').put('private-key',{nested:{text:'unconditional'}});
  assert.deepEqual(await execution.dispatch({kind:'kv.compareAndSwap',namespace:'n',key:'private-key',generation:read.generation,value:null}),{status:'conflict'});
  const trace=JSON.stringify(execution.summary());
  for(const secret of ['private-key','admitted-value',read.generation]) assert.equal(trace.includes(secret),false);
  await execution.close();
  let calls=0;
  for(const [input,reason] of [
    [{key:''},'invalid-key'],[{key:'x',generation:0},'invalid-generation'],[{key:'x',generation:'ok',value:undefined},'invalid-value'],
    [{namespace:'',key:'x',generation:'ok',value:1},'configuration'],[{key:'x',generation:'ok',value:largest+'x'},'too-large']
  ]) {
    const e=host.createJavascriptEffectExecution({effectAdapter:{dispatch(){calls++;return {status:'stored'};}}});
    assert.deepEqual(await e.dispatch({kind:'kv.compareAndSwap',namespace:'n',value:null,...input}),{status:'not-stored',reason}); await e.close();
  }
  assert.equal(calls,0);
  for(const invalid of [{status:'stored',generation:'invented'},{status:'conflict',value:'private'},{status:'failed'},{status:'unknown',reason:'rejected'},true]) {
    assert.deepEqual(host.normalizeConditionalKvResult({kind:'kv.compareAndSwap'},invalid),{status:'unknown',reason:'protocol'});
  }
  for(const invalid of [{status:'found',value:null,generation:0},{status:'not-found',generation:'invented'}, {status:'found',value:undefined,generation:'valid'}]) {
    assert.equal(host.normalizeConditionalKvResult({kind:'kv.getVersioned'},invalid).status,'failed');
  }
  // No prepare capability means unsupported, never an unconditional GET/PUT fallback.
  const unsupported=host.createJavascriptEffectExecution({capabilities:{kv(){return {get(){calls++;},put(){calls++;}};}}});
  assert.deepEqual(await unsupported.dispatch({kind:'kv.insertIfAbsent',namespace:'n',key:'k',value:1}),{status:'not-stored',reason:'configuration'});
  await unsupported.close(); assert.equal(calls,0);
  // The released authoring types, not a K1 augmentation, own all three methods.
  const fixture=path.join(__dirname,'k2/types.ts');
  const program=ts.createProgram([fixture],{baseUrl:path.resolve(__dirname,'../../..'),paths:{'@pulse-compute/pulse':['packages/pulse/src/index.d.ts'],'@pulse-compute/runtime':['packages/runtime/src/index.d.ts']},types:[],strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,skipLibCheck:false});
  const diagnostics=ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));
  assert.ok(fs.readFileSync(fixture,'utf8').includes('@ts-expect-error'));
  console.log('ok - K2 production types, wire/token/bounds corpus, admission snapshot, redaction and explicit failure outcomes');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
