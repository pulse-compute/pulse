'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {compileCanonicalSource} = require('../../packages/compiler/src/canonical-api-compiler');
const {buildCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-plan');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const mock = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const {createConditionalKvAuthority} = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
const source = `import type { PulseContext } from '@pulse-compute/runtime';
export default async function handler(ctx: PulseContext) {
  const one = await ctx.kv('catalog').getVersioned('one');
  const two = await ctx.kv('catalog').getVersioned('two');
  const stored = await ctx.kv('catalog').insertIfAbsent('checkpoint', 1);
  return ctx.text('done');
}`;
const compiled = compileCanonicalSource(source,{fileName:path.join(__dirname,'request-budget-consumer.ts'),strict:false});
const plan = buildCanonicalNativePlan(compiled);
const native = platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:path.resolve(__dirname,'../../..'),bindings:{kv:{catalog:'catalog'}},maxDurationMs:10000,timeoutDiagnostics:true});
const authority = createConditionalKvAuthority();authority.stores.set('catalog',new Map());
let reads=0,inserts=0; const waits=[];
const probe = '12345678-1234-4abc-8def-123456789abc';
const result=mock.executeFastlyNativePlatformCapabilities(native,{request:{headers:{'x-pulse-probe-id':probe}},conditionalKv:{authority,onCall(stage,detail){if(stage==='select')waits.push(detail.timeout);if(stage==='lookup'){reads++;return {readyDelayMs:6000};}if(stage==='insert')inserts++;}}});
assert.equal(result.response.status,504);assert.equal(result.instance.exports.pulse_fastly_request_expired(),1);
assert.equal(result.response.body, 'Gateway Timeout');
assert.deepEqual(result.response.headers, [['content-type', 'text/plain; charset=utf-8']]);
const diagnostics = result.logs.filter(log => log.message.includes('pulse.request-timeout.v1'));
assert.equal(diagnostics.length, 1);
const diagnostic = JSON.parse(diagnostics[0].message);
assert.equal(diagnostic.probeId, probe);
assert.equal(diagnostic.budgetMs, 10000); assert.equal(diagnostic.elapsedMs, 10000);
assert.equal(diagnostic.timeoutStage, 260); assert.equal(diagnostic.remoteAcceptance, 'unknown');
assert.equal(diagnostic.requestElapsedAtDispatchMs, 6000); assert.equal(diagnostic.effectElapsedMs, 4000);
assert.ok(Buffer.byteLength(diagnostics[0].message) <= 1024);
assert.equal(reads,2);assert.equal(inserts,0);assert.equal(authority.stores.get('catalog').has('checkpoint'),false);
assert.ok(waits.includes(4000));
const quick=mock.executeFastlyNativePlatformCapabilities(native,{conditionalKv:{authority}});
assert.equal(quick.response.status,200);assert.equal(quick.instance.exports.pulse_fastly_request_expired(),0);
assert.deepEqual(quick.logs, []);
console.log('ok - Fastly Native shares a total request budget across KV operations and blocks the checkpoint');

const lateAuthority = createConditionalKvAuthority(); lateAuthority.stores.set('catalog', new Map());
const uncertain = mock.executeFastlyNativePlatformCapabilities(native, {conditionalKv: {authority: lateAuthority,
  onCall(stage) { if (stage === 'insert') return {readyDelayMs: 10001}; }
}});
assert.equal(uncertain.response.status, 504);
assert.ok(lateAuthority.stores.get('catalog').has('checkpoint'), '504 must not imply a dispatched conditional write rolled back');
const lateDiagnostic = JSON.parse(uncertain.logs.find(log => log.message.includes('pulse.request-timeout.v1')).message);
assert.equal(lateDiagnostic.requestElapsedAtDispatchMs, 0); assert.equal(lateDiagnostic.effectElapsedMs, 10000);
const preparedLate = mock.executeFastlyNativePlatformCapabilities(native, {conditionalKv: {authority: lateAuthority,
  onCall(stage) { if (stage === 'lookup') return {readyDelayMs: 1000}; if (stage === 'insert') return {readyDelayMs: 9000}; }
}});
assert.equal(preparedLate.response.status, 504);
const preparedDiagnostic = JSON.parse(preparedLate.logs.find(log => log.message.includes('pulse.request-timeout.v1')).message);
assert.equal(preparedDiagnostic.requestElapsedAtDispatchMs, 2000); assert.equal(preparedDiagnostic.effectElapsedMs, 8000);
console.log('ok - Fastly deadline preserves remote acceptance uncertainty');

// A noninterruptible final body write must be checked before response handoff.
const responseExpired = mock.executeFastlyNativePlatformCapabilities(native, {
  conditionalKv: {authority}, hostcallDelayMs: {'fastly_http_body.write': 10000}
});
assert.equal(responseExpired.response.status, 504);
assert.equal(responseExpired.trace.filter(x => x.module === 'fastly_http_resp' && x.name === 'send_downstream').length, 1);
const handedOff = mock.executeFastlyNativePlatformCapabilities(native, {
  conditionalKv: {authority}, hostcallDelayMs: {'fastly_http_resp.send_downstream': 10001}
});
assert.equal(handedOff.response.status, 200, 'successful noninterruptible handoff must not be replaced');
console.log('ok - Fastly final response write is fenced; completed handoff is not withdrawn');

for (const sample of [() => ({status: 1}), (() => {let n=0;return () => ({nanoseconds: n++ === 0 ? 1_000_000n : 0n});})()]) {
  const failedClock = mock.executeFastlyNativePlatformCapabilities(native, {conditionalKv: {authority}, monotonicClock: sample});
  assert.equal(failedClock.response.status, 504);
  assert.deepEqual(failedClock.trace.filter(x => x.module === 'pulse_kv_evidence' && x.name !== 'clock'), []);
}
const {inspectFastlyCanonicalTarget, writeFastlyCanonicalTarget} = require('../../../packages/provider-fastly/src/build/canonical-target');
assert.throws(() => inspectFastlyCanonicalTarget({plan, native, providerConfig: {maxDurationMs: 9999}}), {code: 'PULSE_REQUEST_DURATION_ARTIFACT_MISMATCH'});
const {fastlyJavascriptProjectRestrictions} = require('../../../packages/provider-fastly/src/javascript/target-support-policy');
assert.throws(() => fastlyJavascriptProjectRestrictions({}, {providerConfig: {maxDurationMs: 10000}}), {code: 'PULSE_REQUEST_DURATION_UNSUPPORTED'});
assert.throws(() => fastlyJavascriptProjectRestrictions({}, {providerConfig: {maxDurationMs: 10000, timeoutDiagnostics:true}}), {code: 'PULSE_REQUEST_DURATION_UNSUPPORTED'});
assert.throws(() => inspectFastlyCanonicalTarget({plan, native, providerConfig: {maxDurationMs:10000}}), {code:'PULSE_FASTLY_NATIVE_ARTIFACT_INVALID'});
const legacyBindings = {...native.manifest.bindings}; delete legacyBindings.timeoutDiagnostics;
const legacyDiagnostic = {...native, manifest:{...native.manifest, bindings:legacyBindings}};
assert.throws(() => inspectFastlyCanonicalTarget({plan, native:legacyDiagnostic, providerConfig:{maxDurationMs:10000}}),
  {code:'PULSE_FASTLY_NATIVE_ARTIFACT_INVALID'}, 'legacy always-on artifacts without the selection field require rebuilding');
const providerPlan = require('../../../packages/provider-fastly/src/provider-contract').createFastlyLoweringPlan(compiled.metadata, {kv:{catalog:'catalog'}});
function rejectedReuse(artifact, timeoutDiagnostics) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-timeout-selection-'));
  try {
    assert.throws(() => writeFastlyCanonicalTarget({plan, providerPlan, native:artifact, outDir,
      providerConfig:{maxDurationMs:10000,timeoutDiagnostics,bindings:{kv:{catalog:'catalog'}}}}),
    {code:'PULSE_FASTLY_NATIVE_ARTIFACT_INVALID'});
    assert.equal(fs.existsSync(path.join(outDir,'bin/main.wasm')), false);
  } finally { fs.rmSync(outDir, {recursive:true,force:true}); }
}
rejectedReuse(native, false); rejectedReuse(legacyDiagnostic, false);

// Omitted and explicit false retain the whole-request deadline, with no
// diagnostic source, probe read, timing samples or timeout log side effects.
for (const timeoutDiagnostics of [undefined, false]) {
  const disabled = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, {
    maxDurationMs:10000, timeoutDiagnostics, bindings:{kv:{catalog:'catalog'}}
  });
  assert.ok(!disabled.source.includes('__request_diag'));
  assert.ok(!disabled.source.includes('pulse.request-timeout.v1'));
  assert.throws(() => inspectFastlyCanonicalTarget({plan, native:disabled, providerConfig:{maxDurationMs:10000,timeoutDiagnostics:true}}), {code:'PULSE_FASTLY_NATIVE_ARTIFACT_INVALID'});
  rejectedReuse(disabled, true);
  const offAuthority = createConditionalKvAuthority(); offAuthority.stores.set('catalog', new Map());
  const offQuick = mock.executeFastlyNativePlatformCapabilities(disabled, {conditionalKv:{authority:offAuthority}});
  assert.deepEqual(offQuick.response, quick.response);
  assert.deepEqual(offQuick.logs, []);
  const clocks = execution => execution.trace.filter(t => t.module === 'wasi_snapshot_preview1' && t.name === 'clock_time_get').length;
  assert.equal(clocks(quick) - clocks(offQuick), 3, 'only opt-in adds one observational clock sample per KV dispatch');
  assert.equal(offQuick.trace.some(t => t.name === 'header_value_get' && t.header === 'x-pulse-probe-id'), false);
  offAuthority.stores.set('catalog', new Map());
  const offTimeout = mock.executeFastlyNativePlatformCapabilities(disabled, {conditionalKv:{authority:offAuthority,
    onCall(stage) { if (stage === 'insert') return {readyDelayMs:10001}; }
  }});
  assert.deepEqual(offTimeout.response, uncertain.response);
  assert.equal(offTimeout.instance.exports.pulse_fastly_request_expired(), 1);
  assert.ok(offAuthority.stores.get('catalog').has('checkpoint'), 'disabling diagnostics must not change write acceptance');
  assert.deepEqual(offTimeout.logs, []);
}
console.log('ok - diagnostics default off preserves deadline, HTTP and remote acceptance without probe/timing/log overhead');

const bodyCompiled = compileCanonicalSource(`import type {PulseContext} from '@pulse-compute/runtime';
export default async function handler(ctx: PulseContext) { const body = await ctx.req.text(); const value = await ctx.config.get('after-body'); return ctx.text(body); }`,
  {fileName: path.join(__dirname, 'request-budget-body.ts'), strict: false});
const bodyNative = platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(bodyCompiled), {
  cwd: path.resolve(__dirname, '../../..'), maxDurationMs: 10000, bindings: {configStore: 'app_config'}
});
const delayed = mock.executeFastlyNativePlatformCapabilities(bodyNative, {request: {method: 'POST', body: 'bounded', readyDelayMs: 10000}, config: {'after-body': 'value'}});
assert.equal(delayed.response.status, 504);
assert.equal(delayed.trace.filter(x => x.module === 'fastly_config_store').length, 0);
const bodyQuick = mock.executeFastlyNativePlatformCapabilities(bodyNative, {request: {method: 'POST', body: 'bounded'}, config: {'after-body': 'value'}});
assert.equal(bodyQuick.response.status, 200); assert.equal(bodyQuick.response.body, 'bounded');
console.log('ok - Fastly body admission, invalid clocks, stale artifacts and JS rejection are bounded');
const admittedBeforeInit = mock.executeFastlyNativePlatformCapabilities(native, {
  conditionalKv: {authority}, hostcallDelayMs: {'fastly_abi.init': 10000}
});
assert.equal(admittedBeforeInit.response.status, 504);
assert.equal(admittedBeforeInit.trace.filter(x => x.module === 'pulse_kv_evidence' && x.name !== 'clock').length, 0);
console.log('ok - Fastly budget starts at request entry, before ABI setup');

// Explicit opt-in must select the diagnostic imports, without application logs
// or effects. Exercise both existing sinks and their failure behavior.
const plainPlan = buildCanonicalNativePlan(compileCanonicalSource(
  `export default async function handler(ctx) { return ctx.text('ok'); }`,
  {fileName: 'timeout-no-effects.ts', strict: false}));
for (const timeoutDiagnostics of [undefined, false]) {
  const plain = platform.compileFastlyNativePlatformCapabilitiesPlan(plainPlan, {
    maxDurationMs:10000, timeoutDiagnostics, requirePlatformCapability:false
  });
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(plain.wasm));
  assert.equal(imports.some(i => ['header_value_get','fd_write','endpoint_get','write'].includes(i.name) && ['fastly_http_req','wasi_snapshot_preview1','fastly_log'].includes(i.module)), false);
  const timeout = mock.executeFastlyNativePlatformCapabilities(plain, {hostcallDelayMs:{'fastly_abi.init':10000}});
  assert.equal(timeout.response.status, 504); assert.equal(timeout.response.body, 'Gateway Timeout');
  assert.deepEqual(timeout.logs, []);
}
for (const endpoint of [undefined, 'timeout-events']) {
  const plain = platform.compileFastlyNativePlatformCapabilitiesPlan(plainPlan, {
    maxDurationMs: 10000, timeoutDiagnostics: true, requirePlatformCapability: false,
    bindings: endpoint ? {logEndpoint: endpoint} : {}
  });
  for (const fault of [{}, {logWriteFailure:true}, {logWriteMaxBytes:0}, {logWriteMaxBytes:7},
    ...(endpoint ? [{logEndpointFailure:true}] : [])]) {
    const timedOut = mock.executeFastlyNativePlatformCapabilities(plain, {
      request: {headers: {'x-pulse-probe-id': probe}},
      hostcallDelayMs: {'fastly_http_req.header_value_get':10000}, ...fault
    });
    assert.equal(timedOut.response.status, 504);
    assert.equal(timedOut.response.body, 'Gateway Timeout');
    const writes = timedOut.trace.filter(t => (t.module === 'fastly_log' && t.name === 'write')
      || (t.module === 'wasi_snapshot_preview1' && t.name === 'fd_write'));
    assert.equal(writes.length, fault.logEndpointFailure ? 0 : 1);
    if (endpoint) assert.equal(timedOut.trace.some(t => t.name === 'fd_write'), false);
    if (!Object.keys(fault).length) {
      assert.equal(timedOut.logs[0].endpoint, endpoint || 'stdout');
      assert.equal(JSON.parse(timedOut.logs[0].message).probeId, probe);
    }
  }
}
console.log('ok - explicit diagnostic opt-in audits both sinks; disabled builds omit diagnostic-only imports');

const fetchCompiled = compileCanonicalSource(`import type {PulseContext} from '@pulse-compute/runtime';
export default async function handler(ctx: PulseContext) { const result = await ctx.fetch('https://example.test/data'); return ctx.text('done'); }`,
  {fileName: path.join(__dirname, 'request-budget-fetch.ts'), strict: false});
const fetchNative = platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(fetchCompiled), {
  cwd: path.resolve(__dirname, '../../..'), maxDurationMs: 10000, timeoutDiagnostics: true, requirePlatformCapability: false, bindings: {backends: {'https://example.test': 'origin'}}
});
assert.equal(fetchNative.manifest.resourceAccounting.selection, 'canonical-fetch-cohorts');
let preparedTooLate, preparationExpired = false; const afterPreparation = [];
assert.throws(() => mock.executeFastlyNativePlatformCapabilities(fetchNative, {
  hostcallDelayMs: {'fastly_http_req.uri_set': 10000},
  afterHostcall(c) { if (preparationExpired) afterPreparation.push(c.name); if (c.name === 'uri_set') preparationExpired = true; }
}), error => {
  preparedTooLate = error.detail;
  return error.code === 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED' && error.detail.errorStage === 260;
});
assert(preparationExpired);
assert(afterPreparation.every(name => name === 'clock_time_get' || name === 'fd_write'),
  'expired selected fetch may emit its diagnostic but cannot dispatch, clean up or deliver an error');
assert.equal(afterPreparation.filter(name => name === 'fd_write').length, 1);
assert.equal(preparedTooLate.trace.filter(x => x.module === 'fastly_http_req' && x.name === 'send_async').length, 0);
console.log('ok - Fastly outbound preparation cannot dispatch fetch after expiry');

// The error driver has its own fatal-return fence. Keep the request-budget
// source integration covered when its per-site settlement moves into a helper.
const {compileCanonicalRouterSource} = require('../../packages/compiler/src/canonical-router-compiler');
const errorRouter = compileCanonicalRouterSource(`import {Router} from '@pulse-compute/runtime';
const app = new Router();
app.get('/run', async ctx => {
  const {one, two} = await ctx.parallel({
    one: ctx.fetch('https://budget.example.invalid/one'),
    two: ctx.config.get('SECOND')
  });
  return ctx.text('done');
});
app.error(async (error,ctx,next) => ctx.text(error.code,{status:422}));
export default app;`, {fileName: 'request-budget-error-route.ts'});
const errorCompiled = compileCanonicalSource(errorRouter.sourceText, {
  fileName: 'request-budget-error-route.ts', strict: false, internalGeneratedHandler: true,
  compilerPrelude: errorRouter.compilerPrelude, compilerOwnedCalls: errorRouter.compilerOwnedCalls,
  metadataExtensions: {router: errorRouter.metadata}
});
const errorNative = platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(errorCompiled), {
  cwd: path.resolve(__dirname, '../../..'), maxDurationMs: 10000,
  bindings: {configStore: 'app_config', backends: {'https://budget.example.invalid': 'origin'}}
});
assert.match(errorNative.source, /if \(fatal\) \{ __pulse_fastly_jwt_send_error\(\); return \}/,
  'fatal settlement uses the shared response hook');
assert.match(errorNative.source, /function __pulse_fastly_jwt_send_error\(\): void \{ if \(__request_expired \|\| !__request_check\(\)\)/,
  'the request-budget owner retains first priority in that hook');
const errorOptions = {request: {path: '/run'}, config: {SECOND: 'ready'}};
const expiredGroup = mock.executeFastlyNativePlatformCapabilities(errorNative, {
  ...errorOptions, fixtures: {'https://budget.example.invalid/one': {body: 'late', delayMs: 10000}}
});
assert.equal(expiredGroup.response.status, 504);
assert.equal(expiredGroup.instance.exports.pulse_fastly_request_expired(), 1);
assert.equal(expiredGroup.trace.filter(x => x.module === 'fastly_http_resp' && x.name === 'send_downstream').length, 1);
const recoveredTransport = mock.executeFastlyNativePlatformCapabilities(errorNative, {
  ...errorOptions, fixtures: {'https://budget.example.invalid/one': {transportStatus: 1}}
});
assert.equal(recoveredTransport.response.status,422);
assert.equal(recoveredTransport.response.body,'PULSE_FETCH_NETWORK');
assert.equal(mock.executeFastlyNativePlatformCapabilities(errorNative, {
  ...errorOptions, fixtures: {'https://budget.example.invalid/one': {body: 'ready'}}
}).response.status, 200);
console.log('ok - shared error-driver settlement preserves the fatal-return deadline fence and transport diagnostics');
