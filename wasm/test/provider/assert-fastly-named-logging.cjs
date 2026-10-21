'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const { normalizeFastlyLogEndpoint } = require('../../../packages/provider-fastly/src/toolchain/logging.js');
const { fastly } = require('../../../packages/provider-fastly/src/config-api.js');
const { normalizeFastlyProviderConfig } = require('../../../packages/provider-fastly/src/toolchain/config.js');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const endpoint = 'production-events';
const source = `export default async function handler(ctx) {
  const token = await ctx.secret.get('TOKEN');
  ctx.log.info('{"event":"arrival","token":"' + token + '","text":"café 😀"}');
  ctx.log.warn('outcome café 😀');
  ctx.log.debug('filtered');
  return ctx.text('ok', {status:202});
}`;
function compile(source, options = {}, reporting = 'info') {
  const plan = buildCanonicalNativePlan(compileCanonicalSource(source, { fileName: 'named-logging.ts', strict: false }), { reporting });
  return platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: root, canonicalBuild: true, requirePlatformCapability: false, bindings: { secretStore: 'secrets', ...options } });
}
async function main() {
  let checks = 0;
  assert.equal(normalizeFastlyLogEndpoint(undefined), undefined);
  for (const name of ['', 'stdout', 'STDERR', 'fst_managed_anything', 'FST_MANAGED_x', ' trailing', 'trailing ', 'a\nb', '\0', 'a'.repeat(256), '\ud800', null, false, {}]) {
    for (const invoke of [() => fastly({ logEndpoint: name }), () => normalizeFastlyProviderConfig({ bindings: { logEndpoint: name } })])
      assert.throws(invoke, e => e.code === 'PULSE_FASTLY_LOG_ENDPOINT_INVALID');
    checks++;
  }
  for (const name of [endpoint, '事件', 'a'.repeat(255)]) {
    assert.equal(normalizeFastlyProviderConfig(fastly({logEndpoint:name})).bindings.logEndpoint, name); checks++;
  }
  const artifact = compile(source, { logEndpoint: endpoint });
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(artifact.wasm));
  assert.deepEqual(imports.filter(i => i.module === 'fastly_log').map(i => i.name).sort(), ['endpoint_get','write']);
  assert(!imports.some(i => i.name === 'fd_write'));
  assert.equal(artifact.manifest.bindings.logEndpoint, endpoint);
  const secret = 'named-private-token';
  for (const fault of [{}, {logEndpointFailure:true}, {logEndpoints:[]}, {logWriteFailure:true}, {logWriteMaxBytes:0}, {logWriteMaxBytes:7}]) {
    let raw = [];
    const result = execute(artifact, {secretStore:'secrets', secrets:{TOKEN:secret}, ...fault, onLogWrite(message) { assert(!message.includes(secret)); raw.push(message); }});
    assert.equal(result.response.status, 202); assert.equal(result.response.body, 'ok');
    assert.equal(result.trace.filter(t => t.module === 'fastly_log' && t.name === 'endpoint_get').length, 2);
    const failedLookup = fault.logEndpointFailure || fault.logEndpoints;
    assert.equal(result.trace.filter(t => t.module === 'fastly_log' && t.name === 'write').length, failedLookup ? 0 : 2);
    assert(!result.trace.some(t => t.name === 'fd_write'));
    if (!Object.keys(fault).length) {
      assert.deepEqual(JSON.parse(raw[0].slice('[pulse:info] '.length)), {event:'arrival',token:'<redacted>',text:'café 😀'});
      assert.equal(raw[1], '[pulse:warn] outcome café 😀\n');
      assert(result.logs.every(l => l.endpoint === endpoint));
    }
    checks++;
  }
  const stdout = compile(source);
  assert(WebAssembly.Module.imports(new WebAssembly.Module(stdout.wasm)).some(i => i.name === 'fd_write'));
  assert(!WebAssembly.Module.imports(new WebAssembly.Module(stdout.wasm)).some(i => i.module === 'fastly_log'));
  const off = compile(source, {logEndpoint:endpoint}, 'off');
  assert(!WebAssembly.Module.imports(new WebAssembly.Module(off.wasm)).some(i => i.module === 'fastly_log' || i.name === 'fd_write'));
  checks+=2;
  const header = compile(`export default async function handler(ctx) {ctx.log.info('' + ctx.req.header('x-message')); return ctx.text('ok');}`, {logEndpoint:'事件'});
  const overhead = Buffer.byteLength('[pulse:info] \n');
  for (const [bytes, expected] of [[65536-overhead,1],[65537-overhead,0]]) {
    const value = '😀'.repeat(Math.floor(bytes/4))+'a'.repeat(bytes%4);
    const result = execute(header, { request:{headers:{'x-message':value}} });
    assert.equal(result.response.status,200); assert.equal(result.logs.length,expected);
    if (expected) { assert.equal(result.logs[0].endpoint,'事件'); assert.equal(Buffer.byteLength(result.logs[0].message),65536); assert(!result.logs[0].message.includes('\ufffd')); }
    checks++;
  }
  const adapterSource = `
export function pulse_entities_set_request(pointer: i32): i32 { return 1; }
export function pulse_entities_start(): i32 { const message='adapter café 😀'; pulse_entities_host_log(1,changetype<i32>(message),message.length); return 1; }
export function pulse_entities_resume(): i32 { return 1; }
export function pulse_entities_set_effect_result(index:i32,ok:i32,pointer:i32): i32 { return 1; }
function pulse_entities_run_suspended(): i32 { return 2; }
function pulse_entities_run_complete(): i32 { return 1; }
function pulse_entities_response_ptr(): i32 { return changetype<i32>('ok'); }
function pulse_entities_response_status(): i32 { return 200; }
export function pulse_fastly_last_error(): i32 { return pulse_fastly_entities_last_error(); }
`;
  const adapter = require('../../../packages/provider-fastly/src/build/entities-native.js').compileFastlyEntitiesNative({
    version:'pulse.entities-native-source.v1',kind:'package-generated-source',
    policy:{javascriptRuntime:false,javascriptHandlerImports:false,automaticFallback:false,requestBodyReads:1},imports:[],summary:{effects:0},planHash:'named-adapter',source:adapterSource,
    sourceSha256:require('node:crypto').createHash('sha256').update(adapterSource).digest('hex')
  },{cwd:root,logEndpoint:endpoint});
  assert(!adapter.imports.some(i=>i.name==='fd_write'));
  for (const fault of [{},{logEndpointFailure:true},{logWriteFailure:true},{logWriteMaxBytes:0},{logWriteMaxBytes:7}]) {
    const result=execute(adapter,fault); assert.equal(result.response.status,200);assert.equal(result.response.body,'ok');
    assert.equal(result.trace.filter(t=>t.name==='endpoint_get').length,1);
    assert.equal(result.trace.filter(t=>t.module==='fastly_log'&&t.name==='write').length,fault.logEndpointFailure?0:1); checks++;
  }
  const { inspectFastlyCanonicalTarget } = require('../../../packages/provider-fastly/src/build/canonical-target.js');
  assert.throws(() => inspectFastlyCanonicalTarget({ plan:artifact.plan, native:artifact, providerConfig:{bindings:{logEndpoint:'other'}} }), e=>e.code==='PULSE_FASTLY_NATIVE_ARTIFACT_INVALID'); checks++;
  const { Router } = require('../../../packages/runtime/src/index.js');
  const { createFastlyJavascriptHandler } = require('../../../packages/provider-fastly/src/javascript/lifecycle.js');
  for (const mode of ['success','lookup-failure','write-failure']) {
    const records=[]; let opens=0;
    class Logger {constructor(name) {assert.equal(name,endpoint);opens++;if(mode==='lookup-failure')throw Error('lookup');}log(record){if(mode==='write-failure')throw Error('write');records.push(record);}}
    const app=new Router(); app.get('/',async ctx=>{const token=await ctx.secret.get('TOKEN');ctx.log.info('secret '+token+' café 😀');ctx.log.warn('outcome');return ctx.text('ok');});
    const handler=createFastlyJavascriptHandler(app,{bindings:{logEndpoint:endpoint},apis:{Logger},capabilities:{secret:()=>secret},console:{log(){throw Error('NO_STDOUT_FALLBACK');}}});
    const response=await handler(new Request('https://app.test/'));
    assert.equal(response.status,200); assert.equal(await response.text(),'ok');assert.equal(opens,2);
    assert(records.every(r=>!r.includes(secret))); assert.equal(records.length,mode==='success'?2:0);checks++;
  }
  const { createFastlyJavascriptLogEmitter }=require('../../../packages/provider-fastly/src/javascript/logging.js');
  const records=[]; const emit=createFastlyJavascriptLogEmitter({logEndpoint:endpoint,Logger:class {log(r){records.push(r);}}});
  const prefix=Buffer.byteLength('[pulse][info] ');
  emit(3,'a'.repeat(65536-prefix));emit(3,'a'.repeat(65537-prefix));assert.equal(records.length,1);checks++;
  console.log('ok - named Fastly logging '+JSON.stringify({checks,finalWasm:true,redaction:true,bestEffort:true,localEngine:false,deployed:false}));
  return { checks };
}
module.exports={main,source,endpoint};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
