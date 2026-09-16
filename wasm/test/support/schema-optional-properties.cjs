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

async function assertSchemaOptionalProperties() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-optional-properties');
  const source = fs.readFileSync(path.join(fixture, 'src/index.ts'), 'utf8');
  const handler = Function('"use strict"; ' + source.replace('export default ', '') + '\nreturn handler')();
  const extracted = extractSchemaRegistry(path.join(fixture, 'src/schemas.ts'), { projectRoot: fixture });
  const fields = extracted.registry.schemas[0].root.fields;
  assert.equal(fields.find(field => field.name === 'notes').required, false);
  assert.equal(fields.find(field => field.name === 'id').required, true);
  assert.equal(fields.find(field => field.name === 'owner').value.fields.find(field => field.name === 'id').required, false);
  assert.equal(extracted.codecInputs.native.schemas[0].representation, 'schema-projected-json-value');
  const maxBytes = 1024;
  const bundle = buildCanonicalSchemaBundle(extracted.registry, { maxBytes });
  const codecs = createCanonicalSchemaCodecs(bundle.registry);
  const id = 'app.Resource';
  const base = {id:'r1',owner:{type:'individual',label:'Owner'},locations:[{id:'main',kind:'docs',primary:false}]};
  const rich = {...base,notes:'Exact bytes \uFEFFé😀\u0000\r\n\\',owner:{type:'team',id:'team-1',label:'Owner'},locations:[
    {id:'first',kind:'docs',url:'https://example.invalid',primary:false},
    {id:'second',kind:'guide',label:'',instructions:'Use this',primary:true},
  ],flags:{active:false,score:0,values:[],child:{}},nullable:null,signed:-2147483648,unsigned:4294967295,role:'author'};
  for (const value of [base,rich,{...base,notes:''},{...base,flags:{},nullable:''}]) {
    const decoded = codecs.decodeJsonText(id,JSON.stringify(value));
    assert.deepEqual(decoded,value);
    assert.equal(Object.hasOwn(decoded,'notes'),Object.hasOwn(value,'notes'));
    assert.equal(Object.isFrozen(decoded),true);
    assert.equal(Object.isFrozen(decoded.owner),true);
    assert.equal(Object.isFrozen(decoded.locations[0]),true);
  }
  // Presence is an own data property. Accessors must never execute, inherited
  // properties are not admitted, and present undefined is not omission.
  let accessed = false;
  const accessor = {...base};
  Object.defineProperty(accessor,'notes',{get(){accessed=true;return 'unsafe';}});
  assert.throws(()=>codecs.encodeJsonText(id,accessor),{code:'PULSE_SCHEMA_ENCODE'});
  assert.equal(accessed,false);
  const inherited = Object.assign(Object.create({notes:'inherited'}),base);
  assert.equal(codecs.encodeJsonText(id,inherited),JSON.stringify(base));
  for (const value of [{...base,notes:undefined},{...base,notes:null},{...base,flags:{active:undefined}}]) {
    assert.throws(()=>codecs.encodeJsonText(id,value),{code:'PULSE_SCHEMA_ENCODE'});
  }
  const compile = target => compileCanonicalSource(source,{fileName:'schema-optional-properties.ts',schemaBundle:bundle,requireAsync:true,target,strict:true});
  compile('javascript');
  const plan = buildCanonicalNativePlan(compile('native'));
  const native = compileCanonicalNativePlan(plan,{cwd:repoRoot});
  // Exercise guest codec exports directly as well: optimized builds use
  // --noAssert, so presence/type checks must survive without host preflight.
  function guestRoundtrip(value) {
    const controller = nativeHost.instantiateCanonicalNativeModule(native);
    const exports = controller.exports;
    const text = JSON.stringify(value);
    const pointer = exports.__pin(exports.__new(text.length*2,exports.pulse_schema_string_id()));
    try {
      const input = new Uint16Array(exports.memory.buffer,pointer,text.length);
      for (let i=0;i<text.length;i++) input[i]=text.charCodeAt(i);
      const output = exports.pulse_schema_encode(0,pointer);
      const bytes = new DataView(exports.memory.buffer).getUint32(output-4,true);
      return Buffer.from(exports.memory.buffer,output,bytes).toString('utf16le');
    } finally {exports.__unpin(pointer);}
  }
  assert.equal(guestRoundtrip({...rich,unknown:true}),codecs.encodeJsonText(id,rich));
  assert.equal(guestRoundtrip(base),codecs.encodeJsonText(id,base));
  for (const invalid of [{...base,id:null},{...base,notes:null},{...base,flags:{score:'wrong'}},{...base,owner:{}},{...base,unsigned:-1}]) {
    assert.throws(()=>guestRoundtrip(invalid),{code:'PULSE_CANONICAL_NATIVE_AS_ABORT'});
  }
  const options = {cwd:repoRoot,backends:{'https://objects.invalid':'objects'},requirePlatformCapability:false};
  const fastlyHttp = http.compileFastlyNativeHttpEffectsPlan(plan,options);
  const fastlyPlatform = platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  assert.equal(native.manifest.policy.javascriptRuntime,false);
  for (const artifact of [fastlyHttp,fastlyPlatform]) {
    assert.ok(!artifact.inspection.imports.some(entry=>/env|pulse_host|js[_-]?compute/.test(entry.module)));
  }
  async function execute(lane,body,mode='') {
    const request = {method:'POST',path:'/',body,headers:[['content-type','application/json'],['x-mode',mode]]};
    const sent = [];
    try {
      if (lane === 'javascript') {
        const app = new Router();app.post('/',handler);
        app.error(async(error,ctx)=>ctx.text(error.code,{status:400}));
        const result = await jsHost.executeNodeJavascriptApplication(app,new Request('https://app.test/',request),{
          strict:true,schemaCodecs:codecs,maxRequestBodyBytes:2048,maxStructuredBodyBytes:maxBytes,
          async fetchImplementation(_url,init){sent.push(init.body);return new Response('stored');},
        });
        const text = await result.text();
        return {text,error:result.status===400?text:null,sent};
      }
      if (lane === 'native') {
        const result = await nativeHost.executeCanonicalNativeModule(native,{request,maxRequestBodyBytes:2048,maxStructuredBodyBytes:maxBytes,
          providerAdapter:{id:'node',async dispatchEffect(effect){sent.push(effect.init.body);return {status:200,body:'stored',headers:[]};}},
        });
        return {text:result.response.body,sent};
      }
      const fixtures = {'https://objects.invalid/resource':{status:200,body:'stored'}};
      const result = lane === 'fastly-http'
        ? httpHost.executeFastlyNativeHttpEffects(fastlyHttp,{request,fixtures})
        : platformHost.executeFastlyNativePlatformCapabilities(fastlyPlatform,{request,fixtures});
      return {text:result.response.body,status:result.response.status,sent:result.outboundRequests?.map(entry=>entry.body)||[],trace:result.trace};
    } catch(error) {return {error:error.code||error.name,message:error.message,detail:error.detail,cause:error.cause?.message,trace:error.detail?.trace||[],sent};}
  }
  for (const lane of ['javascript','native','fastly-http','fastly-platform']) {
    for (const value of [base,rich,{...base,notes:''},{...base,flags:{},nullable:''}]) {
      const result = await execute(lane,JSON.stringify(value));
      assert.ok(!result.error,`${lane}: ${JSON.stringify(result)}`);
      assert.equal(result.text,codecs.encodeJsonText(id,value),`${lane} exact string/scalar/presence bytes`);
    }
    const constructed = await execute(lane,'','construct');assert.equal(constructed.text,JSON.stringify(base),lane);
    assert.equal((await execute(lane,JSON.stringify(base),'presence')).text,'absent',lane);
    assert.equal((await execute(lane,JSON.stringify({...base,notes:''}),'presence')).text,'present',lane);
    const edited = await execute(lane,JSON.stringify(base),'edit');
    assert.equal(edited.text,codecs.encodeJsonText(id,{...base,notes:'Third accepted command'}),lane);
    const preserved = await execute(lane,edited.text,'preserve');
    assert.equal(preserved.text,codecs.encodeJsonText(id,{...base,id:'r2',notes:'Third accepted command'}),lane);
    for (const mode of ['response','request']) assert.equal((await execute(lane,JSON.stringify(rich),mode)).text,codecs.encodeJsonText(id,rich),lane);
    const extra = {...rich,unknown:1,owner:{...rich.owner,extra:true},locations:rich.locations.map(item=>({...item,ignored:1})),flags:{...rich.flags,unknown:2}};
    assert.equal((await execute(lane,JSON.stringify(extra))).text,codecs.encodeJsonText(id,rich),`${lane} recursive projection`);
    const outbound = await execute(lane,JSON.stringify(rich),'outbound');
    assert.equal(outbound.text,'sent',lane);
    if (lane === 'fastly-http') assert.equal(outbound.trace.filter(entry=>entry.name==='send_async').length,1);
    else assert.equal(Buffer.from(outbound.sent[0]).toString(),codecs.encodeJsonText(id,rich),lane);
    for (const value of [
      {...base,notes:null}, {...base,notes:1}, {...base,owner:{label:'Owner'}},
      {...base,flags:{active:0}}, {...base,nullable:7}, {...base,role:'invalid'},
      {...base,signed:2147483648}, {...base,unsigned:-1},
      {...base,locations:[{id:'x',kind:'docs',label:null,primary:false}]},
    ]) {
      const result = await execute(lane,JSON.stringify(value),'outbound');
      assert.ok(result.error,`${lane} must reject ${JSON.stringify(value)}`);
      assert.equal(result.sent.length,0,`${lane} invalid input must not dispatch`);
      if (!lane.startsWith('fastly')) assert.equal(result.error,'PULSE_SCHEMA_DECODE',lane);
      else assert.ok(!result.trace.some(entry=>entry.name==='send_async'),lane);
    }
    const undefinedResult = await execute(lane,'','undefined');assert.ok(undefinedResult.error,`${lane} present undefined`);
    const oversized = await execute(lane,JSON.stringify({...base,notes:'x'.repeat(1100)}));assert.ok(oversized.error || oversized.status === 413,`${lane} byte bound ${JSON.stringify(oversized)}`);
    const expanded = await execute(lane,JSON.stringify({...base,notes:'x'.repeat(600)}),'expand');
    assert.ok(expanded.error || expanded.status === 413,`${lane} encoded output byte bound`);
    assert.equal(expanded.sent.length,0,lane);
    if (lane.startsWith('fastly')) assert.ok(!expanded.trace.some(entry=>entry.name==='send_async'),lane);
    const exact = {...base,notes:'x'.repeat(maxBytes-Buffer.byteLength(codecs.encodeJsonText(id,{...base,notes:''})))};
    assert.equal(Buffer.byteLength((await execute(lane,JSON.stringify(exact))).text),maxBytes,lane);
  }
  console.log('ok - optional schema properties preserve absence, nullability, nested/array values and edit merges across JavaScript, Node Native and both Fastly Native paths');
}

module.exports = {assertSchemaOptionalProperties};
