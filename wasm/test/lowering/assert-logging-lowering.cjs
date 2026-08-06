#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const {
  CanonicalNativePlanError,
  buildCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');

const source = `
  export default async function handler(ctx) {
    ctx.log.debug('debug-message')
    ctx.log.info('info-message')
    ctx.log.warn('warn-message')
    ctx.log.error('error-message')
    return ctx.text('ok')
  }
`;
const compiled = compileCanonicalSource(source, { fileName: 'logging.ts', strict: false });
assert.ok(compiled.metadata.capabilities.includes('logging'));
assert.equal(compiled.metadata.effectCount, 0, 'logging is not an effect');
assert.equal(compiled.metadata.continuationCount, 0, 'logging does not create continuations');

const off = buildCanonicalNativePlan(compiled, { reporting: 'off' });
const info = buildCanonicalNativePlan(compiled, { reporting: 'info' });
const debug = buildCanonicalNativePlan(compiled, { reporting: 'debug' });
assert.deepEqual(off.logging.reporting, {
  version: 'pulse.logging.v1',
  name: 'off',
  level: 0,
  default: false,
  abi: off.logging.abi
});
assert.deepEqual(
  [off.logging.enabledStatements, off.logging.prunedStatements],
  [0, 4]
);
assert.deepEqual(
  [info.logging.enabledStatements, info.logging.prunedStatements],
  [3, 1]
);
assert.deepEqual(
  [debug.logging.enabledStatements, debug.logging.prunedStatements],
  [4, 0]
);
assert.equal(off.entry.body.some((statement) => statement.expression && statement.expression.name === 'logging.emit'), false);
assert.equal(info.entry.body.filter((statement) => statement.expression && statement.expression.name === 'logging.emit').length, 3);
assert.notEqual(off.planHash, info.planHash);
assert.notEqual(info.planHash, debug.planHash);
assert.equal(info.logging.abi.signature, 'pulse_log(level:i32,message_ptr:i32,message_len:i32)->void');

const native = compileCanonicalNativePlan(info, { cwd: process.cwd() });
assert.ok(native.manifest.imports.some((entry) => entry.module === 'pulse_host' && entry.name === 'log'));
const debugNative = compileCanonicalNativePlan(debug, { cwd: process.cwd() });

void (async () => {
  const emitted = [];
  const execution = await executeCanonicalNativeModule(native, {
    plan: info,
    reporting: 'info',
    redactionValues: ['message'],
    log(level, message) {
      emitted.push([level, message]);
      if (level === 2) throw new Error('sink unavailable');
    },
    request: { path: '/' }
  });
  assert.equal(execution.response.status, 200);
  assert.equal(execution.response.body, 'ok');
  assert.deepEqual(emitted, [
    [3, 'info-<redacted>'],
    [2, 'warn-<redacted>'],
    [1, 'error-<redacted>']
  ]);
  assert.doesNotMatch(JSON.stringify(execution.trace), /info-message|warn-message|error-message/);

  const debugEmitted = [];
  await executeCanonicalNativeModule(debugNative, {
    plan: debug,
    log(level, message) { debugEmitted.push([level, message]); },
    request: { path: '/' }
  });
  assert.deepEqual(debugEmitted.map(([level]) => level), [4, 3, 2, 1], 'Native host derives reporting from the hash-bound plan');

  assert.throws(
    () => compileCanonicalSource(
      `export default async function handler(ctx) { await ctx.log.info('no'); return ctx.text('ok'); }`,
      { fileName: 'await-log.ts', strict: false }
    ),
    (error) => error.diagnostics.some((entry) => entry.code === 'PULSE_LOG_AWAIT_FORBIDDEN')
  );
  const invalid = compileCanonicalSource(
    `export default async function handler(ctx) { ctx.log.info(123); return ctx.text('ok'); }`,
    { fileName: 'invalid-log.ts', strict: false }
  );
  assert.throws(() => buildCanonicalNativePlan(invalid), (error) => {
    assert.ok(error instanceof CanonicalNativePlanError);
    assert.ok(error.diagnostics.some((entry) => entry.code === 'PULSE_CANONICAL_NATIVE_LOG_INVALID'));
    return true;
  });

  console.log('ok - Native logging is threshold-pruned, hash-bound, synchronous, redacted, and request-contained');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
