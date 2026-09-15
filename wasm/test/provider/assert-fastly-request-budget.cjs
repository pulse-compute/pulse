'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
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
const native = platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:path.resolve(__dirname,'../../..'),bindings:{kv:{catalog:'catalog'}},maxDurationMs:10000});
const authority = createConditionalKvAuthority();authority.stores.set('catalog',new Map());
let reads=0,inserts=0; const waits=[];
const result=mock.executeFastlyNativePlatformCapabilities(native,{conditionalKv:{authority,onCall(stage,detail){if(stage==='select')waits.push(detail.timeout);if(stage==='lookup'){reads++;return {readyDelayMs:6000};}if(stage==='insert')inserts++;}}});
assert.equal(result.response.status,504);assert.equal(result.instance.exports.pulse_fastly_request_expired(),1);
assert.equal(reads,2);assert.equal(inserts,0);assert.equal(authority.stores.get('catalog').has('checkpoint'),false);
assert.ok(waits.includes(4000));
const quick=mock.executeFastlyNativePlatformCapabilities(native,{conditionalKv:{authority}});
assert.equal(quick.response.status,200);assert.equal(quick.instance.exports.pulse_fastly_request_expired(),0);
console.log('ok - Fastly Native shares a total request budget across KV operations and blocks the checkpoint');

const lateAuthority = createConditionalKvAuthority(); lateAuthority.stores.set('catalog', new Map());
const uncertain = mock.executeFastlyNativePlatformCapabilities(native, {conditionalKv: {authority: lateAuthority,
  onCall(stage) { if (stage === 'insert') return {readyDelayMs: 10001}; }
}});
assert.equal(uncertain.response.status, 504);
assert.ok(lateAuthority.stores.get('catalog').has('checkpoint'), '504 must not imply a dispatched conditional write rolled back');
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
const {inspectFastlyCanonicalTarget} = require('../../../packages/provider-fastly/src/build/canonical-target');
assert.throws(() => inspectFastlyCanonicalTarget({plan, native, providerConfig: {maxDurationMs: 9999}}), {code: 'PULSE_REQUEST_DURATION_ARTIFACT_MISMATCH'});
const {fastlyJavascriptProjectRestrictions} = require('../../../packages/provider-fastly/src/javascript/target-support-policy');
assert.throws(() => fastlyJavascriptProjectRestrictions({}, {providerConfig: {maxDurationMs: 10000}}), {code: 'PULSE_REQUEST_DURATION_UNSUPPORTED'});

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

const fetchCompiled = compileCanonicalSource(`import type {PulseContext} from '@pulse-compute/runtime';
export default async function handler(ctx: PulseContext) { const result = await ctx.fetch('https://example.test/data'); return ctx.text('done'); }`,
  {fileName: path.join(__dirname, 'request-budget-fetch.ts'), strict: false});
const fetchNative = platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(fetchCompiled), {
  cwd: path.resolve(__dirname, '../../..'), maxDurationMs: 10000, requirePlatformCapability: false, bindings: {backends: {'https://example.test': 'origin'}}
});
const preparedTooLate = mock.executeFastlyNativePlatformCapabilities(fetchNative, {
  hostcallDelayMs: {'fastly_http_req.uri_set': 10000}
});
assert.equal(preparedTooLate.response.status, 504);
assert.equal(preparedTooLate.trace.filter(x => x.module === 'fastly_http_req' && x.name === 'send_async').length, 0);
console.log('ok - Fastly outbound preparation cannot dispatch fetch after expiry');
