'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const { buildCanonicalSchemaBundle, createCanonicalSchemaCodecs } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const jsHost = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const { Router } = require('../../../packages/runtime/src/index.js');
const http = require('../../../packages/provider-fastly/src/build/native-http-effects.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const httpHost = require('../../../packages/provider-fastly/src/testing/native-http-effects-host.js');
const platformHost = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

async function assertSchemaScalarRecords() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-scalar-records');
  const source = fs.readFileSync(path.join(fixture, 'src/index.ts'), 'utf8');
  const handler = Function('"use strict"; ' + source.replace('export default ', '') + '\nreturn handler')();
  const extracted = extractSchemaRegistry(path.join(fixture, 'src/schemas.ts'), { projectRoot: fixture });
  assert.equal(extracted.registry.schemas[0].root.fields[1].value.kind, 'scalar-record');
  assert.equal(extracted.codecInputs.native.schemas[0].representation, 'schema-projected-json-value');
  assert.equal(extracted.codecInputs.native.schemas[1].representation, 'schema-projected-json-value');
  const bundle = buildCanonicalSchemaBundle(extracted.registry, { maxBytes: 32768 });
  const codecs = createCanonicalSchemaCodecs(bundle.registry), id = 'app.Event';
  const event = properties => ({ event: 'view', properties, context: { source: 'test' } });
  const rich = event({ score: 2.5, active: false, label: '', empty: null });
  const exact = Object.fromEntries(Array.from({length: 8}, (_, i) => [String.fromCharCode(97 + i), 'x'.repeat(i < 7 ? 1024 : 967)]));
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), 8192);
  const valid = [event({}), rich, event(exact), event(Object.fromEntries(Array.from({length:32},(_,i)=>['k'+i,i]))),
    event({['😀'.repeat(32)]:'😀'.repeat(512)}), event({escaped:'"\\\n\u0000é😀'}),
    event({surrogates:'\ud800x\udfff', small:5e-324, large:-Number.MAX_VALUE}),
    event({a:'\n'.repeat(1024),b:'\n'.repeat(338)}),
    event(JSON.parse('{"__proto__":"safe","constructor":true,"":null,"10":"ten","2":"two"}')),
    {...rich,samples:[{},rich.properties],extra:null}, {...rich,extra:{nestedName:'scalar'}}];
  const invalid = [event({x:[]}),event({x:{}}),event({x:'x'.repeat(1025)}),event({['k'.repeat(65)]:true}),
    event(Object.fromEntries(Array.from({length:33},(_,i)=>['k'+i,true]))),event({...exact,h:exact.h+'x'}),
    {...rich,samples:[{x:[]}]}, {...rich,extra:{x:{}}}, event({a:'\n'.repeat(1024),b:'\n'.repeat(339)})];
  for (const value of valid) {
    const normalized = codecs.decodeJsonText(id, JSON.stringify(value));
    assert.deepEqual(normalized,value);
    assert.ok(Object.isFrozen(normalized.properties));
  }
  for (const value of [...invalid,event({x:undefined}),event({x:Infinity}),event({x:NaN}),event({x:1n}),event({x:()=>1})]) {
    assert.throws(()=>codecs.encodeJsonText(id,value),{code:'PULSE_SCHEMA_ENCODE'});
  }
  let invoked = false;
  const accessors = {};Object.defineProperty(accessors,'x',{get(){invoked=true;return 'unsafe';}});
  assert.throws(()=>codecs.encodeJsonText(id,event(accessors)),{code:'PULSE_SCHEMA_ENCODE'});assert.equal(invoked,false);
  assert.throws(()=>codecs.encodeJsonText(id,event({[Symbol('x')]:true})),{code:'PULSE_SCHEMA_ENCODE'});
  assert.throws(()=>codecs.encodeJsonText(id,event(Object.create({x:true}))),{code:'PULSE_SCHEMA_ENCODE'});
  assert.deepEqual(codecs.encode(id,event(Object.assign(Object.create(null),{x:true}))),event({x:true}));
  const duplicate = '{"event":"view","context":{"source":"test"},"properties":{"x":1,"\\u0078":2}}';
  const duplicateNested = '{"event":"view","context":{"source":"test"},"properties":{},"samples":[{"x":1,"x":2}]}';
  const lastOrdinary = '{"event":"old","event":"view","context":{"source":"test"},"properties":{"x":1,"x":2},"properties":{}}';
  assert.deepEqual(codecs.decodeJsonText(id,lastOrdinary),event({}));
  for (const text of [duplicate,duplicateNested]) assert.throws(()=>codecs.decodeJsonText(id,text),{code:'PULSE_SCHEMA_DECODE'});
  const compile = target => compileCanonicalSource(source,{fileName:'schema-scalar-records.ts',schemaBundle:bundle,requireAsync:true,target,strict:true});
  compile('javascript');
  const plan = buildCanonicalNativePlan(compile('native'));
  const native = compileCanonicalNativePlan(plan,{cwd:repoRoot});
  const options = {cwd:repoRoot,backends:{'https://sink.invalid':'sink'},requirePlatformCapability:false};
  const fastlyHttp = http.compileFastlyNativeHttpEffectsPlan(plan,options);
  const fastlyPlatform = platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  function guest(text, encode = false, index = 0) {
    const controller = nativeHost.instantiateCanonicalNativeModule(native), exports = controller.exports;
    const pointer = exports.__pin(exports.__new(text.length*2,exports.pulse_schema_string_id()));
    try {
      const input = new Uint16Array(exports.memory.buffer,pointer,text.length);
      for(let i=0;i<text.length;i++)input[i]=text.charCodeAt(i);
      const output = (encode ? exports.pulse_schema_encode : exports.pulse_schema_decode)(index,pointer);
      const bytes = new DataView(exports.memory.buffer).getUint32(output-4,true);
      return Buffer.from(exports.memory.buffer,output,bytes).toString('utf16le');
    } finally {exports.__unpin(pointer);}
  }
  for(const value of valid) assert.deepEqual(JSON.parse(guest(JSON.stringify(value))),value);
  for(const encode of [false,true]) assert.deepEqual(JSON.parse(guest(JSON.stringify(rich),encode,1)),rich);
  assert.deepEqual(JSON.parse(guest(lastOrdinary)),event({}));
  for(const text of [...invalid.map(value => JSON.stringify(value)),duplicate,duplicateNested]) {
    for(const encode of [false,true]) assert.throws(()=>guest(text,encode),{code:'PULSE_CANONICAL_NATIVE_AS_ABORT'});
  }
  async function execute(lane,body,mode='') {
    const request = {method:'POST',path:'/',body,headers:[['content-type','application/json'],['x-mode',mode]]};
    const sent = [];
    try {
      if(lane==='javascript') {
        const app = new Router();app.post('/',handler);app.error(async(error,ctx)=>ctx.text(error.code,{status:400}));
        const result = await jsHost.executeNodeJavascriptApplication(app,new Request('https://app.test/',request),{
          strict:true,schemaCodecs:codecs,maxRequestBodyBytes:32768,maxStructuredBodyBytes:32768,
          async fetchImplementation(url,init){if(url.endsWith('/input'))return new Response(body,{headers:{'content-type':'application/json'}});sent.push(init.body);return new Response('stored');}
        });
        const text = await result.text();return {text,error:result.status===400?text:null,sent};
      }
      if(lane==='native') {
        const result = await nativeHost.executeCanonicalNativeModule(native,{request,maxRequestBodyBytes:32768,maxStructuredBodyBytes:32768,
          providerAdapter:{id:'node',async dispatchEffect(effect){if(effect.parts.url.endsWith('/input'))return {status:200,body,headers:[['content-type','application/json']]};sent.push(effect.init.body);return {status:200,body:'stored',headers:[]};}}
        });return {text:result.response.body,sent};
      }
      const fixtures = {'https://sink.invalid/events':{status:200,body:'stored'},'https://sink.invalid/input':{status:200,body,headers:[['content-type','application/json']]}};
      const result = lane==='fastly-http' ? httpHost.executeFastlyNativeHttpEffects(fastlyHttp,{request,fixtures}) : platformHost.executeFastlyNativePlatformCapabilities(fastlyPlatform,{request,fixtures});
      return {text:result.response.body,sent:result.outboundRequests?.map(entry=>entry.body)||[],trace:result.trace};
    } catch(error) {return {error:error.code||error.name,message:error.message,detail:error.detail,trace:error.detail?.trace||[],sent};}
  }
  let executions = 0;
  for(const lane of ['javascript','native','fastly-http','fastly-platform']) {
    for(const value of valid) {
      const result = await execute(lane,JSON.stringify(value));executions++;
      assert.ok(!result.error,`${lane}: ${JSON.stringify(result)}`);assert.deepEqual(JSON.parse(result.text),value,lane);
    }
    assert.deepEqual(JSON.parse((await execute(lane,lastOrdinary)).text),event({}),lane);
    assert.deepEqual(JSON.parse((await execute(lane,'','construct')).text),rich,lane);
    assert.deepEqual(JSON.parse((await execute(lane,JSON.stringify(rich),'edit')).text),event({...rich.properties,edited:true}),lane);
    for(const mode of ['request','response','fetched']) {
      const result=await execute(lane,JSON.stringify(rich),mode);assert.ok(!result.error,`${lane}/${mode}: ${JSON.stringify(result)}`);assert.deepEqual(JSON.parse(result.text),rich,lane);executions++;
    }
    for(const text of [...invalid.map(value => JSON.stringify(value)),duplicate,duplicateNested,JSON.stringify(event({x:0})).replace('"x":0','"x":1e999')]) {
      const result=await execute(lane,text,'outbound');executions++;
      assert.ok(result.error,`${lane} must reject ${text.slice(0,100)}`);assert.equal(result.sent.length,0,lane);
      if(lane.startsWith('fastly'))assert.ok(!result.trace.some(entry=>entry.name==='send_async'),lane);
      else assert.equal(result.error,'PULSE_SCHEMA_DECODE',lane);
    }
    for(const mode of ['request','fetched']) {
      const result=await execute(lane,duplicate,mode);assert.ok(result.error,`${lane}/${mode} duplicate keys`);executions++;
    }
    const invalidEncode=await execute(lane,'','invalid-encode');assert.ok(invalidEncode.error,`${lane} rejects nested encode`);assert.equal(invalidEncode.sent.length,0,lane);
    const outbound=await execute(lane,JSON.stringify(rich),'outbound');assert.equal(outbound.text,'sent',lane);
    if(lane==='fastly-http')assert.equal(outbound.trace.filter(entry=>entry.name==='send_async').length,1);
    else assert.deepEqual(JSON.parse(Buffer.from(outbound.sent[0]).toString()),rich,lane);
  }
  console.log(`ok - ScalarRecord bounds, duplicates, immutable projection and round-trip parity (${executions} executions plus direct guest codec checks)`);
}

module.exports = {assertSchemaScalarRecords};
