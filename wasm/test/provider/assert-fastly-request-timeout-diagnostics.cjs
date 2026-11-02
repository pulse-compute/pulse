'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const mock = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const {createConditionalKvAuthority} = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
const ID = '31704f29-8864-4fe0-bfa6-2bd765c0310a';
const HEADER = 'x-pulse-diagnostic-id';

// Reuse the compiled request-budget fixture; no broad corpus or new test task.
function main({native, plan}) {
  const fresh = () => {const authority = createConditionalKvAuthority(); authority.stores.set('catalog', new Map()); return authority;};
  const delayedReads = () => ({authority: fresh(), onCall(stage) {if (stage === 'lookup') return {readyDelayMs: 6000};}});
  const one = result => {
    const records = result.logs.filter(log => log.message.startsWith('{"schema":"pulse.fastly.request-timeout.v1"'));
    assert.equal(records.length, 1, 'exactly one timeout record, including sender re-entry');
    assert.ok(Buffer.byteLength(records[0].message) <= 1024);
    assert.equal(records[0].message.split('\n').length, 2, 'one JSONL record');
    return JSON.parse(records[0].message);
  };
  const request = {headers: {[HEADER]: ID, authorization: 'Bearer private-token', 'x-api-key': 'private-key'}, body: 'private-body'};
  let raw = '';
  const stalled = mock.executeFastlyNativePlatformCapabilities(native, {
    request, conditionalKv: delayedReads(), onLogWrite(message) {raw += message;}
  });
  const diagnostic = one(stalled);
  assert.equal(stalled.response.status, 504);
  assert.equal(stalled.response.body, 'Gateway Timeout');
  assert.equal(diagnostic.correlationId, ID);
  assert.equal(diagnostic.elapsedMs, 10000);
  assert.equal(diagnostic.budgetMs, 10000);
  assert.equal(diagnostic.timeoutStage, 260);
  assert.equal(diagnostic.errorStage, 260);
  assert.equal(diagnostic.effectIndex, 1);
  assert.equal(diagnostic.effectKind, 15);
  assert.equal(diagnostic.phase, 'settle');
  assert.equal(diagnostic.dispatchState, 'pending-handle-observed', 'KV cleared its slot before the deadline surfaced');
  assert.equal(diagnostic.settlementState, 'not-delivered');
  assert.equal(diagnostic.remoteOutcome, 'unknown');
  assert.ok(Number.isInteger(diagnostic.programCounter));
  assert.ok(diagnostic.pendingCount > 0);
  for (const secret of ['private-token', 'private-key', 'private-body', 'checkpoint', 'https://']) assert.ok(!raw.includes(secret));
  const expectedKeys = ['schema', 'correlationId', 'elapsedMs', 'budgetMs', 'clockValid', 'timeoutStage', 'errorCode', 'errorStage', 'effectIndex', 'effectKind', 'programCounter', 'pendingCount', 'phase', 'dispatchState', 'settlementState', 'remoteOutcome'];
  assert.deepEqual(Object.keys(diagnostic).sort(), expectedKeys.sort(), 'fixed metadata-only allowlist');

  const writeAuthority = fresh();
  const uncertain = mock.executeFastlyNativePlatformCapabilities(native, {
    request, conditionalKv: {authority: writeAuthority, onCall(stage) {if (stage === 'insert') return {readyDelayMs: 10001};}}
  });
  const write = one(uncertain);
  assert.equal(write.effectIndex, 2);
  assert.equal(write.effectKind, 16);
  assert.equal(write.dispatchState, 'mutation-entered');
  assert.equal(write.remoteOutcome, 'unknown');
  assert.ok(writeAuthority.stores.get('catalog').has('checkpoint'), 'diagnostics cannot turn a 504 into rollback evidence');

  for (const id of [undefined, '', ID.toUpperCase(), ID + 'x', 'x'.repeat(4096), ID.replace('-4fe0-', '-1fe0-'), '"\\\nprivate-token']) {
    const result = mock.executeFastlyNativePlatformCapabilities(native, {
      request: {headers: id === undefined ? {} : {[HEADER]: id}}, conditionalKv: delayedReads()
    });
    assert.equal(result.response.status, 504);
    assert.equal(one(result).correlationId, null, 'invalid/missing UUID is omitted, never truncated');
  }
  const quick = mock.executeFastlyNativePlatformCapabilities(native, {request, conditionalKv: {authority: fresh()}});
  assert.equal(quick.response.status, 200);
  assert.equal(quick.logs.length, 0, 'no timeout log for success');

  for (const options of [{logWriteFailure: true}, {logWriteMaxBytes: 0}, {logWriteMaxBytes: 7}]) {
    const result = mock.executeFastlyNativePlatformCapabilities(native, {request, conditionalKv: delayedReads(), ...options});
    assert.equal(result.response.status, 504);
    assert.equal(result.response.body, 'Gateway Timeout');
    assert.equal(result.trace.filter(x => x.module === 'wasi_snapshot_preview1' && x.name === 'fd_write').length, 1, 'no log retry');
    assert.equal(result.trace.filter(x => x.module === 'fastly_http_resp' && x.name === 'send_downstream').length, 1);
  }
  const badClock = mock.executeFastlyNativePlatformCapabilities(native, {monotonicClock: () => ({status: 1}), conditionalKv: {authority: fresh()}});
  assert.equal(one(badClock).elapsedMs, null);
  assert.equal(one(badClock).clockValid, false);
  assert.equal(one(badClock).effectIndex, -1);

  const imports = native.manifest.requiredImports;
  assert.ok(imports.includes('fastly_http_req:header_value_get'));
  assert.ok(imports.includes('wasi_snapshot_preview1:fd_write'));
  assert.match(native.manifest.policy.wasi, /fd_write/);
  const named = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, {
    cwd: path.resolve(__dirname, '../../..'), maxDurationMs: 10000,
    bindings: {kv: {catalog: 'catalog'}, logEndpoint: 'timeout-diagnostics'}
  });
  const namedResult = mock.executeFastlyNativePlatformCapabilities(named, {request, conditionalKv: delayedReads(), logEndpoints: ['timeout-diagnostics']});
  assert.equal(one(namedResult).correlationId, ID);
  assert.equal(namedResult.logs[0].endpoint, 'timeout-diagnostics');
  assert.ok(named.manifest.requiredImports.includes('fastly_log:write'));
  assert.ok(!named.manifest.requiredImports.includes('wasi_snapshot_preview1:fd_write'));
  const unavailable = mock.executeFastlyNativePlatformCapabilities(named, {request, conditionalKv: delayedReads(), logEndpointFailure: true});
  assert.equal(unavailable.response.status, 504);
  assert.equal(unavailable.logs.length, 0);
  assert.equal(unavailable.trace.filter(x => x.module === 'fastly_log' && x.name === 'endpoint_get').length, 1);
  assert.equal(unavailable.trace.filter(x => x.module === 'wasi_snapshot_preview1' && x.name === 'fd_write').length, 0, 'no stdout fallback');

  const noBudget = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, {bindings: {kv: {catalog: 'catalog'}}});
  assert.doesNotMatch(noBudget.source, /pulse\.fastly\.request-timeout\.v1/);
  assert.ok(!noBudget.manifest.requiredImports.includes('wasi_snapshot_preview1:fd_write'));
  console.log('ok - bounded timeout diagnostics preserve attribution, correlation admission, uncertainty and sink failures');
}
module.exports = {main};
