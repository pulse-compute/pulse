'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gzipSync } = require('node:zlib');
const { performance } = require('node:perf_hooks');
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

function assertFastlyAdmissionOrder(repoRoot, artifacts, cases) {
  const { resolveAsc } = require('../../packages/build-support/src/assemblyscript-compile.js');
  const compilerRoot = path.join(repoRoot, 'wasm/packages/compiler');
  const asc = resolveAsc(compilerRoot);
  const transform = require.resolve('json-as', { paths: [compilerRoot] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-nested-admission-'));
  try {
    for (const [lane, artifact] of artifacts) {
      const source = artifact.source.replace('function __pulse_fastly_json(handle: i32, depth: i32): string {',
        'function __pulse_fastly_json(handle: i32, depth: i32): string { __test_serializations++;');
      assert.notEqual(source, artifact.source);
      const file = path.join(directory, lane + '.ts');
      const output = path.join(directory, lane + '.wasm');
      fs.writeFileSync(file, source + `
let __test_handles: i32 = 0
let __test_serializations: i32 = 0
export function probe_string_id(): i32 { return idof<string>() }
export function probe_parse(text: string): i32 {
  const schema = __pulse_fastly_string_value('app.Small')
  const before = __pulse_fastly_values.length
  __pulse_fastly_schema_parse_json(text, schema)
  __test_handles = __pulse_fastly_values.length - before
  return __pulse_fastly_last_error
}
export function probe_stat(serializations: bool): i32 { return serializations ? __test_serializations : __test_handles }
export function probe_cycle(): i32 {
  const value = host_value_object()
  host_value_object_set(value, __pulse_fastly_string_value('self'), value)
  const init = host_value_object()
  host_value_object_set(init, __pulse_fastly_string_value('schema'), __pulse_fastly_string_value('app.Event'))
  __pulse_fastly_fetch_json_body(__pulse_fastly_value(init), value)
  return __pulse_fastly_last_error
}
`);
      const compiled = spawnSync(asc.executable, [asc.script, file, '--outFile', output, '--runtime', 'incremental', '--exportRuntime', '--optimize',
        '--transform', transform, '--path', path.join(compilerRoot, 'node_modules'), '--path', path.resolve(transform, '../../../..')], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000,
        env: { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0', JSON_MODE: 'NAIVE' }
      });
      assert.equal(compiled.status, 0, lane + ': ' + (compiled.error || compiled.stderr));
      const module = new WebAssembly.Module(fs.readFileSync(output));
      function instantiate() {
        const imports = {};
        for (const item of WebAssembly.Module.imports(module)) {
          imports[item.module] ||= {};
          imports[item.module][item.name] = () => { throw new Error('Unexpected host call: ' + item.module + '.' + item.name); };
        }
        return new WebAssembly.Instance(module, imports).exports;
      }
      for (const [name, text, valid] of cases) {
        const exports = instantiate();
        const pointer = exports.__pin(exports.__new(text.length * 2, exports.probe_string_id()));
        try {
          const units = new Uint16Array(exports.memory.buffer, pointer, text.length);
          for (let index = 0; index < text.length; index++) units[index] = text.charCodeAt(index);
          const error = exports.probe_parse(pointer);
          assert.equal(error === 0, valid, lane + '/' + name);
          assert.equal(exports.probe_stat(0) > 0, valid, lane + '/' + name + ': reject before creating parser handles');
        } finally { exports.__unpin(pointer); }
      }
      const exports = instantiate();
      assert.notEqual(exports.probe_cycle(), 0, lane + ': reject cyclic outbound value');
      assert.equal(exports.probe_stat(1), 0, lane + ': reject before serializer entry');
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function assertSchemaNestedJson() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-nested-json');
  const source = fs.readFileSync(path.join(fixture, 'src/index.ts'), 'utf8');
  const handler = Function('"use strict"; ' + source.replace('export default ', '') + '\nreturn handler')();
  const extracted = extractSchemaRegistry(path.join(fixture, 'src/schemas.ts'), { projectRoot: fixture });
  const bundle = buildCanonicalSchemaBundle(extracted.registry, { maxBytes: 65536 });
  const codecs = createCanonicalSchemaCodecs(bundle.registry), id = 'app.Event';
  const event = properties => ({ event: 'view', properties, context: { source: 'test' } });
  const rich = event({ nested: { array: [null, false, 0, { label: 'é😀' }] } });
  const valid = [event({}), rich,
    event(JSON.parse('{"__proto__":{"constructor":[],"":false},"10":[{"2":null}]}')),
    event({ controls: { text: '\u0000\n\t"\\é😀', lone: '\ud800x\udfff' }, numbers: [5e-324, -Number.MAX_VALUE] }),
    ...[null, false, 0, '', [], {}, [{ a: [true] }]].map(data => ({ ...rich, data })),
    { ...rich, samples: [null, [false, 0], { a: [] }] }];
  const duplicate = '{"event":"view","context":{"source":"test"},"properties":{"a":{"x":1,"\\u0078":2}}}';
  const duplicateArray = '{"event":"view","context":{"source":"test"},"properties":{},"data":[{"x":1,"x":2}]}';
  const lastOrdinary = '{"event":"old","event":"view","context":{"source":"test"},"properties":{"x":1,"x":2},"properties":{}}';
  const invalid = [event([]), event(null), { ...rich, context: {} }, { ...rich, data: { text: 'x'.repeat(16385) } }];
  const invalidText = [...invalid.map(JSON.stringify), duplicate, duplicateArray,
    JSON.stringify(rich).slice(0, -1), '{"event":"view","context":{"source":"test"},"properties":{"n":1e999}}'];
  const exactBudget = { data: { a: '\n'.repeat(16), b: '\n'.repeat(16), c: '\n'.repeat(5) + 'xxx' } };
  const small = [
    ['text', ' '.repeat(499) + '{"data":null}', ' '.repeat(500) + '{"data":null}'],
    ['depth', JSON.stringify({ data: [[[null]]] }), JSON.stringify({ data: [[[[null]]]] })],
    ['nodes', JSON.stringify({ data: [[null,null,null],[null,null,null],null,null] }), JSON.stringify({ data: [[null,null,null,null],[null,null,null],null,null] })],
    ['members', JSON.stringify({ data: { a:null,b:null,c:null } }), JSON.stringify({ data: { a:null,b:null,c:null,d:null } })],
    ['items', JSON.stringify({ data: [null,null,null,null] }), JSON.stringify({ data: [null,null,null,null,null] })],
    ['key', JSON.stringify({ data: { abcdefgh:null } }), JSON.stringify({ data: { abcdefghi:null } })],
    ['string', JSON.stringify({ data: 'x'.repeat(16) }), JSON.stringify({ data: 'x'.repeat(17) })],
    ['budget', JSON.stringify(exactBudget), JSON.stringify({ data: { ...exactBudget.data, c: exactBudget.data.c + 'x' } })]
  ];
  // The literal JSON document above is 13 bytes, plus the selected whitespace.
  assert.equal(Buffer.byteLength(small[0][1]), 512);
  for (const value of valid) {
    const normalized = codecs.decodeJsonText(id, JSON.stringify(value));
    assert.deepEqual(normalized, value);
    const stack = [normalized];
    while (stack.length) { const item = stack.pop(); if (item && typeof item === 'object') { assert.ok(Object.isFrozen(item)); stack.push(...Object.values(item)); } }
  }
  const original = event({ a: [{ b: true }] });
  const detached = codecs.encode(id, original);
  original.properties.a[0].b = false;
  assert.equal(detached.properties.a[0].b, true);
  assert.equal(Object.isFrozen(original.properties.a), false);
  const shared = { x: [0] };
  const copy = codecs.encode(id, event({ a: shared, b: shared }));
  assert.notEqual(copy.properties.a, copy.properties.b);
  let invoked = false;
  const accessor = {}; Object.defineProperty(accessor, 'x', { enumerable: true, get() { invoked = true; return 1; } });
  const cyclic = {}; cyclic.self = cyclic;
  const arrayCycle = []; arrayCycle.push(arrayCycle);
  for (const data of [undefined, NaN, Infinity, 1n, Symbol(), () => 1, new Date(), new Map(),
    cyclic, arrayCycle, accessor, { toJSON() { invoked = true; return {}; } }, { [Symbol()]: true },
    new Array(1), Object.assign([], { extra: true }), Object.create({ inherited: true })]) {
    assert.throws(() => codecs.encodeJsonText(id, { ...rich, data }), { code: 'PULSE_SCHEMA_ENCODE' });
  }
  assert.equal(invoked, false);
  assert.deepEqual(codecs.decodeJsonText(id, lastOrdinary), event({}));
  for (const text of invalidText) assert.throws(() => codecs.decodeJsonText(id, text));
  for (const [name, exact, over] of small) {
    assert.deepEqual(codecs.decodeJsonText('app.Small', exact), JSON.parse(exact), name);
    assert.throws(() => codecs.decodeJsonText('app.Small', over), undefined, name);
  }
  assert.throws(() => codecs.decodeJsonText('app.Small', '{"data":null,"ignored":[[[[null]]]]}'));
  const maximumNodes = event(Object.fromEntries([1024,1024,1024,1015].map((count, index) => ['array' + index, Array(count).fill(null)])));
  const { admitJsonValue } = require('../../packages/schema-json/src/compiler/json-admission.js');
  assert.equal(admitJsonValue(maximumNodes, extracted.registry.schemas[0].jsonLimits).nodes, 4096);
  const overNodes = event({ ...maximumNodes.properties, array3: [...maximumNodes.properties.array3, null] });
  assert.throws(() => codecs.encodeJsonText(id, overNodes), { code: 'PULSE_SCHEMA_ENCODE' });
  valid.push(maximumNodes);
  const compile = target => compileCanonicalSource(source, { fileName:'schema-nested-json.ts',schemaBundle:bundle,requireAsync:true,target,strict:true });
  compile('javascript');
  const plan = buildCanonicalNativePlan(compile('native'));
  let started = performance.now();
  const native = compileCanonicalNativePlan(plan,{cwd:repoRoot});
  const compileMs = [performance.now() - started];
  const options = {cwd:repoRoot,backends:{'https://sink.invalid':'sink'},requirePlatformCapability:false};
  started = performance.now();
  const fastlyHttp = http.compileFastlyNativeHttpEffectsPlan(plan,options);
  compileMs.push(performance.now() - started);
  started = performance.now();
  const fastlyPlatform = platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  compileMs.push(performance.now() - started);
  assertFastlyAdmissionOrder(repoRoot, [['http', fastlyHttp], ['platform', fastlyPlatform]], [
    ...small.flatMap(([name, exact, over]) => [[name + '/exact', exact, true], [name + '/over', over, false]]),
    ['malformed', '{"data":[', false]
  ]);
  let guestMemoryBytes = 0;
  function guest(text, encode = false, index = 0) {
    const controller = nativeHost.instantiateCanonicalNativeModule(native), exports = controller.exports;
    const pointer = exports.__pin(exports.__new(text.length*2,exports.pulse_schema_string_id()));
    try {
      const input = new Uint16Array(exports.memory.buffer,pointer,text.length);
      for(let i=0;i<text.length;i++)input[i]=text.charCodeAt(i);
      const output = (encode ? exports.pulse_schema_encode : exports.pulse_schema_decode)(index,pointer);
      guestMemoryBytes = Math.max(guestMemoryBytes, exports.memory.buffer.byteLength);
      const bytes = new DataView(exports.memory.buffer).getUint32(output-4,true);
      return Buffer.from(exports.memory.buffer,output,bytes).toString('utf16le');
    } finally {exports.__unpin(pointer);}
  }
  async function execute(lane,body,mode='') {
    const request = {method:'POST',path:'/',body,headers:[['content-type','application/json'],['x-mode',mode]]};
    const sent = [];
    try {
      if(lane==='javascript') {
        const app = new Router();app.post('/',handler);app.error(async(error,ctx)=>ctx.text(error.code,{status:400}));
        const result = await jsHost.executeNodeJavascriptApplication(app,new Request('https://app.test/',request),{
          strict:true,schemaCodecs:codecs,maxRequestBodyBytes:65536,maxStructuredBodyBytes:65536,
          async fetchImplementation(url,init){if(url.endsWith('/input'))return new Response(body,{headers:{'content-type':'application/json'}});sent.push(init.body);return new Response('stored');}
        });
        const text = await result.text();return {text,error:result.status===400?text:null,sent};
      }
      if(lane==='native') {
        const result = await nativeHost.executeCanonicalNativeModule(native,{request,maxRequestBodyBytes:65536,maxStructuredBodyBytes:65536,
          providerAdapter:{id:'node',async dispatchEffect(effect){if(effect.parts.url.endsWith('/input'))return {status:200,body,headers:[['content-type','application/json']]};sent.push(effect.init.body);return {status:200,body:'stored',headers:[]};}}
        });return {text:result.response.body,sent};
      }
      const fixtures = {'https://sink.invalid/events':{status:200,body:'stored'},'https://sink.invalid/input':{status:200,body,headers:[['content-type','application/json']]}};
      const result = lane==='fastly-http' ? httpHost.executeFastlyNativeHttpEffects(fastlyHttp,{request,fixtures}) : platformHost.executeFastlyNativePlatformCapabilities(fastlyPlatform,{request,fixtures});
      return {text:result.response.body,sent:result.outboundRequests?.map(entry=>entry.body)||[],trace:result.trace};
    } catch(error) {return {error:error.code||error.name,message:error.message,detail:error.detail,trace:error.detail?.trace||[],sent};}
  }
  let executions = 0;
  for (const encode of [false, true]) {
    for (const value of valid) assert.deepEqual(JSON.parse(guest(JSON.stringify(value), encode)), value);
    assert.deepEqual(JSON.parse(guest(lastOrdinary, encode)), event({}));
    for (const text of invalidText) assert.throws(() => guest(text, encode));
    for (const [name, exact, over] of small) {
      assert.deepEqual(JSON.parse(guest(exact, encode, 2)), JSON.parse(exact), 'guest/' + name);
      assert.throws(() => guest(over, encode, 2), undefined, 'guest/' + name);
    }
  }
  let chain = null; for (let i = 0; i < 126; i++) chain = [chain];
  const deep = event({ chain });
  const tooDeep = event({ chain: [chain] });
  assert.deepEqual(JSON.parse(guest(JSON.stringify(deep), false, 1)), deep);
  assert.throws(() => guest(JSON.stringify(tooDeep), false, 1));
  for (const lane of ['javascript','native','fastly-http','fastly-platform']) {
    for (const value of valid) {
      const result = await execute(lane, JSON.stringify(value)); executions++;
      assert.ok(!result.error, lane + ': ' + JSON.stringify(result));
      assert.deepEqual(JSON.parse(result.text), value, lane);
    }
    for (const [mode, text, expected] of [['',lastOrdinary,event({})], ['construct','',rich],
      ['edit',JSON.stringify(rich),event({...rich.properties,edited:{active:true}})], ['deep',JSON.stringify(deep),deep]]) {
      const result = await execute(lane,text,mode); executions++;
      assert.ok(!result.error, lane+'/'+mode+': '+JSON.stringify(result));
      assert.deepEqual(JSON.parse(result.text),expected,lane+'/'+mode);
    }
    assert.ok((await execute(lane,JSON.stringify(tooDeep),'deep')).error,lane+'/depth129');
    for (const mode of ['request','response','fetched']) {
      const result=await execute(lane,JSON.stringify(rich),mode); executions++;
      assert.ok(!result.error,lane+'/'+mode+': '+JSON.stringify(result));
      assert.deepEqual(JSON.parse(result.text),rich,lane+'/'+mode);
    }
    for (const text of invalidText) {
      const result=await execute(lane,text,'outbound'); executions++;
      assert.ok(result.error,lane+' rejects invalid input');
      assert.equal(result.sent.length,0,lane);
      assert.ok(!(result.trace||[]).some(entry=>entry.name==='send_async'),lane);
    }
    for (const mode of ['request','fetched']) assert.ok((await execute(lane,duplicate,mode)).error,lane+'/'+mode);
    for (const mode of ['invalid-encode','invalid-outbound','cyclic-outbound']) {
      const result=await execute(lane,'',mode); executions++;
      assert.ok(result.error,lane+'/'+mode); assert.equal(result.sent.length,0,lane);
      assert.ok(!(result.trace||[]).some(entry=>entry.name==='send_async'),lane);
    }
    assert.ok((await execute(lane,JSON.stringify(rich),'mutate')).error,lane+' nested values are immutable');
    for (const [name,exact,over] of small) {
      const admitted=await execute(lane,exact,'small'), rejected=await execute(lane,over,'small'); executions+=2;
      assert.ok(!admitted.error,lane+'/'+name+': '+JSON.stringify(admitted));
      assert.deepEqual(JSON.parse(admitted.text),JSON.parse(exact),lane+'/'+name);
      assert.ok(rejected.error,lane+'/'+name+' one over');
    }
    const outbound=await execute(lane,JSON.stringify(rich),'outbound'); executions++;
    assert.equal(outbound.text,'sent',lane);
    assert.equal(outbound.sent.length,1,lane);
    assert.deepEqual(JSON.parse(Buffer.from(outbound.sent[0]).toString()),rich,lane);
  }
  console.log(JSON.stringify({ fixture: 'schema-nested-json', profile: 'default', maxAdmittedNodes: 4096,
    guestLinearMemoryBytesAtReturn: guestMemoryBytes,
    artifacts: [native,fastlyHttp,fastlyPlatform].map((artifact,index) => ({
      target: ['node-native','fastly-http','fastly-platform'][index], rawBytes: artifact.wasm.length,
      gzipBytes: gzipSync(artifact.wasm).length, compileMs: Math.round(compileMs[index])
    })), providerReality: false }));
  console.log(`ok - configurable nested JSON: ${executions} cross-target executions, all eight exact/over limits, depth 128, immutable detached values, duplicate policy, and zero sends after rejection`);
}

module.exports = { assertSchemaNestedJson };
if (require.main === module) assertSchemaNestedJson().catch(error => { console.error(error); process.exitCode=1; });
