'use strict';

// Test-owned fixture/probes for the existing Fastly application-error driver.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { root, hash } = require('./schema-cost-profile.cjs');
const providerFile = path.join(root, 'packages/provider-fastly/src/build/native-platform-capabilities.js');
const hostFile = path.join(root, 'packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const host = require(hostFile).executeFastlyNativePlatformCapabilities;
const kind = index => ['json', 'config', 'text'][index % 3];
const eventNames = ['begin-before', 'begin-after', 'settle-before', 'settle-after', 'resume-before', 'resume-after', 'resolve-before', 'resolve-after', 'setter-before', 'setter-after', 'error-take-before', 'error-take-after'];

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, 'diagnostic boundary drift: ' + before);
  return source.replace(before, after);
}

function sourceFor(count, topology) {
  const operation = i => kind(i) === 'config' ? `ctx.config.get('K${i}')`
    : `ctx.fetch('https://proof.example.invalid/s${i}').${kind(i) === 'json' ? "json('proof.Row')" : 'text()'}`;
  const names = Array.from({ length: count }, (_, i) => `v${i}`);
  const calls = topology === 'parallel'
    ? `const {${names.join(',')}} = await ctx.parallel({${names.map((name, i) => `${name}:${operation(i)}`).join(',')}});`
    : names.map((name, i) => `const ${name}=await ${operation(i)};${i < count - 1 ? `if(!${name})return ctx.text('missing dependency');` : ''}`).join('\n');
  const result = names.map((name, i) => kind(i) === 'json' ? `${name}.id` : `(${name}||'missing')`).join("+'|'+");
  return `import {Router} from '@pulse-compute/runtime';
const app=new Router();
app.get('/run',async(ctx)=>{${calls}return ctx.text(${result});});
app.error(async(error,ctx,next)=>ctx.text(error.code,{status:422}));
export default app;\n`;
}

function prepare(count, topology, directory) {
  const { extractSchemaRegistry } = require('../../../packages/schema-json/src/compiler/schema-registry');
  const { buildCanonicalSchemaBundle } = require('../../../packages/schema-json/src/compiler/canonical-schema-codecs');
  const { compileCanonicalRouterSource } = require('../../../packages/compiler/src/canonical-router-compiler');
  const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
  const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
  const source = sourceFor(count, topology);
  const schema = "import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema'; interface Row {id:string} export default defineSchemaRegistry({schemas:{'proof.Row':schema<Row>()}});\n";
  const schemaFile = path.join(directory, 'schemas.ts'); fs.writeFileSync(schemaFile, schema);
  const bundle = buildCanonicalSchemaBundle(extractSchemaRegistry(schemaFile, { projectRoot: directory }).registry);
  const router = compileCanonicalRouterSource(source, { fileName: 'src/index.ts', rootDir: directory });
  const compiled = compileCanonicalSource(router.sourceText, { fileName: 'src/index.ts', rootDir: directory, strict: false,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata }, schemaBundle: bundle });
  assert.equal(compiled.ok, true);
  const plan = buildCanonicalNativePlan(compiled);
  assert.equal(plan.effects.length, count);
  assert.deepEqual(plan.effects.map(e => e.kind), Array.from({ length: count }, (_, i) => kind(i) === 'config' ? 'config.get' : 'fetch'));
  assert.equal(plan.routing.entries.filter(e => e.kind === 'error').length, 1);
  return { plan, fixtureSha256: { router: hash(source), schema: hash(schema) } };
}

function instrument(source, count) {
  const wrappers = [
    ['__pulse_invocation_begin', 'index: i32', 'bool', 'index', 'index', '0', '0', 0, 1],
    ['__pulse_invocation_settle', 'index: i32, ticket: i32, result: i32', 'i32', 'index, ticket, result', 'index', 'ticket', 'result', 2, 3],
    ['pulse_resume', '', 'i32', '', '-1', '0', '0', 4, 5],
    ['__pulse_fastly_resolve_effect', 'effectIndex: i32', 'i32', 'effectIndex', 'effectIndex', 'o09_ticket(effectIndex)', '0', 6, 7],
    ['pulse_set_effect_result', 'effectIndex: i32, handle: i32', 'i32', 'effectIndex, handle', 'effectIndex', 'o09_ticket(effectIndex)', 'handle', 8, 9],
    ['host_router_error_take', '', 'i32', '', '-1', '0', '0', 10, 11]
  ];
  const additions = ['@external("o09", "event") declare function __o09_event(kind:i32,index:i32,ticket:i32,result:i32,status:i32):void;'];
  for (const [name, params, type, args, index, ticket, value, before, after] of wrappers) {
    source = replaceOnce(source, `function ${name}(${params}): ${type} {`, `function __o09_impl_${name}(${params}): ${type} {`);
    const result = name === '__pulse_fastly_resolve_effect' ? 'out' : value;
    additions.push(`${name.startsWith('pulse_') ? 'export ' : ''}function ${name}(${params}):${type}{
      __o09_event(${before},${index},${ticket},${value},0);
      const out=__o09_impl_${name}(${args});
      ${name === '__pulse_fastly_resolve_effect' ? '__o09_fault_after_resolve(effectIndex);' : ''}
      __o09_event(${after},${index},${name === '__pulse_invocation_begin' ? 'o09_ticket(index)' : ticket},${result},${type === 'bool' ? 'out?1:0' : 'out'});
      return out;
    }`);
  }
  additions.push(`
const __o09_fault_codes=new StaticArray<i32>(${count});
export function o09_fault(index:i32,code:i32):void{unchecked(__o09_fault_codes[index]=code);}
function __o09_fault_after_resolve(index:i32):void{
  const code=unchecked(__o09_fault_codes[index]);
  if(code==0)return;
  unchecked(__o09_fault_codes[index]=0);
  __pulse_application_schema=1;
  __pulse_fastly_fail(code,code==1004?3:52,-1);
  __pulse_application_schema=0;
}
export function o09_ticket(index:i32):i32{return index>=0&&index<${count}?unchecked(__pulse_invocation_tickets[index]):-1;}
export function o09_mode(index:i32):i32{return index>=0&&index<${count}?unchecked(__pulse_fastly_pending_mode[index]):-1;}
export function o09_count():i32{return __pulse_invocation_count;}
export function o09_closed():bool{return __pulse_invocation_closed;}
export function o09_slot(index:i32,field:i32):i32{switch(index){
${Array.from({ length: count }, (_, i) => `case ${i}:return field==0?__pulse_effect_pending_${i}:field==1?__pulse_effect_ready_${i}:__pulse_effect_result_${i};`).join('\n')}
default:return -1;}}
export function o09_arm(index:i32):void{switch(index){
${Array.from({ length: count }, (_, i) => `case ${i}:__pulse_effect_pending_${i}=1;__pulse_effect_ready_${i}=0;return;`).join('\n')}
}}
export function o09_begin(index:i32):bool{return __pulse_invocation_begin(index);}
export function o09_settle(index:i32,ticket:i32,result:i32):i32{return __pulse_invocation_settle(index,ticket,result);}
export function o09_close():void{__pulse_invocation_close();}
export function o09_clear_error():void{__pulse_application_clear();}
export function o09_value(value:i32):i32{return host_value_number(f64(value));}
export function o09_kind(handle:i32):i32{return handle>0?__pulse_fastly_value(handle).kind:-1;}
export function o09_number(handle:i32):f64{return __pulse_fastly_value(handle).number;}
`);
  return source + '\n' + additions.join('\n');
}

function build(count, topology, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const { plan, fixtureSha256 } = prepare(count, topology, directory);
  let calls = 0, diagnostic, generatedSourceHash, diagnosticSourceHash;
  const loaded = new Module(providerFile, module); loaded.filename = providerFile;
  loaded.paths = Module._nodeModulePaths(path.dirname(providerFile));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = id => id !== 'node:child_process' ? originalRequire(id) : {
    ...originalRequire(id), spawnSync(executable, args, options) {
      assert.match(args[0], /asc\.js$/); calls++;
      const result = spawnSync(executable, args, options);
      assert.equal(result.status, 0, result.error?.message || result.stderr);
      const entry = path.resolve(options.cwd, args[1]), original = fs.readFileSync(entry, 'utf8');
      generatedSourceHash = hash(original);
      const traced = instrument(original, count); diagnosticSourceHash = hash(traced);
      const extra = [...args], output = path.join(directory, 'diagnostic.wasm');
      assert.ok(extra.includes('--outFile')); extra[extra.indexOf('--outFile') + 1] = output;
      fs.writeFileSync(entry, traced);
      try {
        const probe = spawnSync(executable, extra, options);
        assert.equal(probe.status, 0, probe.error?.message || probe.stderr);
        diagnostic = fs.readFileSync(output); assert.ok(WebAssembly.validate(diagnostic));
      } finally { fs.writeFileSync(entry, original); }
      return result;
    }
  };
  loaded._compile(fs.readFileSync(providerFile, 'utf8'), providerFile);
  const production = loaded.exports.compileFastlyNativePlatformCapabilitiesPlan(plan, {
    cwd: root, canonicalBuild: true, requirePlatformCapability: false, emitWat: false,
    bindings: { configStore: 'o09', effectBackends: Object.fromEntries(plan.effects.filter(e => e.kind === 'fetch').map(e => [e.id, 'proof'])) }
  });
  assert.equal(calls, 1); assert.equal(generatedSourceHash, hash(production.source));
  assert.ok(!WebAssembly.Module.imports(new WebAssembly.Module(production.wasm)).some(i => i.module === 'o09'));
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(diagnostic)).filter(i => i.module === 'o09').map(i => i.name), ['event']);
  fs.writeFileSync(path.join(directory, 'production.wasm'), production.wasm);
  return { production: production.wasm, diagnostic, identity: { count, topology, fixtureSha256,
    sourceSha256: generatedSourceHash, diagnosticSourceSha256: diagnosticSourceHash,
    productionWasmSha256: hash(production.wasm), diagnosticWasmSha256: hash(diagnostic),
    assemblyScript: production.manifest.assemblyScript, jsonAs: production.manifest.jsonAs } };
}

function diagnosticHost() {
  const source = replaceOnce(fs.readFileSync(hostFile, 'utf8'), '  instance = new WebAssembly.Instance(module, imports);', `
  Object.assign(imports, {o09:{event:options.o09.event}});
  instance = new WebAssembly.Instance(module, imports);
  options.o09.attach(instance,trace);
  if(options.o09.skipStart)return {instance,trace};`);
  const loaded = new Module(hostFile, module); loaded.filename = hostFile;
  loaded.paths = Module._nodeModulePaths(path.dirname(hostFile)); loaded._compile(source, hostFile);
  return loaded.exports.executeFastlyNativePlatformCapabilities;
}
const probeHost = diagnosticHost();

function observe(count) {
  let instance, trace; const events = [];
  const state = () => {
    const e = instance.exports;
    return { error: e.pulse_fastly_last_error(), stage: e.pulse_fastly_error_stage(), effect: e.pulse_fastly_error_effect(),
      count: e.o09_count(), closed: !!e.o09_closed(),
      tickets: Array.from({ length: count }, (_, i) => e.o09_ticket(i)) };
  };
  return { events, state, get instance() { return instance; }, get trace() { return trace; }, attach(value, hostTrace) { instance = value; trace = hostTrace; },
    event(kind, index, ticket, result, status) {
      const e = instance.exports;
      events.push({ event: eventNames[kind], index, ticket, result, status,
        error: e.pulse_fastly_last_error(), stage: e.pulse_fastly_error_stage(), effect: e.pulse_fastly_error_effect(),
        currentTicket: e.o09_ticket(index), mode: e.o09_mode(index),
        pending: e.o09_slot(index, 0), ready: e.o09_slot(index, 1), stored: e.o09_slot(index, 2),
        resultKind: result > 0 ? e.o09_kind(result) : -1,
        ...([4, 10, 11].includes(kind) ? { openTickets: Array.from({ length: count }, (_, i) => e.o09_ticket(i)).filter(t => t > 0).length } : {}) });
    } };
}

function execute(wasm, options, observer) {
  try {
    const result = observer ? probeHost(wasm, { ...options, o09: observer }) : host(wasm, options);
    return { response: { status: result.response.status, body: result.response.body, headers: result.response.headers }, trace: result.trace,
      failure: null, instance: result.instance };
  } catch (error) {
    if (error.code !== 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED') throw error;
    return { response: null, failure: { code: error.code, error: error.detail.lastError, stage: error.detail.errorStage, effect: error.detail.errorEffect },
      trace: error.detail.trace, instance: observer?.instance };
  }
}

module.exports = { root, hash, kind, sourceFor, build, observe, execute, probeHost };
