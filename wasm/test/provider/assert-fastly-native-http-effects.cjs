#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { EXAMPLES, compileExample, internalFixture } = require('../support/canonical-projects.cjs');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const effects = require('../../../packages/provider-fastly/src/build/native-http-effects.js');
const mock = require('../../../packages/provider-fastly/src/testing/native-http-effects-host.js');

function planForExample(name) {
  return buildCanonicalNativePlan(compileExample(EXAMPLES[name]).compiled);
}

function planForFixture(name) {
  return buildCanonicalNativePlan(internalFixture(name).compiled);
}

function headerValues(headers, name) {
  const target = String(name).toLowerCase();
  return headers.filter(([headerName]) => String(headerName).toLowerCase() === target).map(([, value]) => value);
}

function assertNativeEffectsModule(name, compiled) {
  assert.equal(compiled.version, effects.FASTLY_NATIVE_HTTP_EFFECTS_VERSION, `${name} target version`);
  assert.equal(compiled.manifest.planHash, compiled.plan.planHash, `${name} plan hash binding`);
  assert.equal(compiled.manifest.policy.nativeFastly, true, `${name} native Fastly policy`);
  assert.equal(compiled.manifest.policy.javascriptRuntime, false, `${name} no JavaScript runtime`);
  assert.equal(compiled.manifest.policy.jsComputeRuntime, false, `${name} no js-compute-runtime`);
  assert.equal(compiled.manifest.policy.effects, 'fetch-only', `${name} native Fastly effect effect boundary`);
  assert.equal(compiled.manifest.policy.continuations, true, `${name} continuation execution`);
  assert.equal(compiled.inspection.valid, true, `${name} valid Wasm`);
  assert.equal(compiled.inspection.magic, '0061736d01000000', `${name} Wasm magic`);
  assert.ok(compiled.wasm.length > 1024 && compiled.wasm.length < effects.FASTLY_NATIVE_HTTP_EFFECTS_MAX_WASM_BYTES, `${name} compact native Wasm`);
  assert.equal(compiled.inspection.imports.some((entry) => entry.module === 'env' || /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)), false, `${name} no env.abort, portable host, WASI, or JavaScript runtime imports`);
  for (const moduleName of ['fastly_abi', 'fastly_http_req', 'fastly_http_resp', 'fastly_http_body']) {
    assert.ok(compiled.inspection.importModules.includes(moduleName), `${name} imports ${moduleName}`);
  }
  const exportNames = new Set(compiled.inspection.exports.map((entry) => entry.name));
  for (const exportName of ['_start', 'memory', 'pulse_start', 'pulse_resume', 'pulse_set_effect_result', 'pulse_result_handle', 'pulse_fastly_last_error', 'pulse_fastly_error_stage', 'pulse_fastly_error_effect']) {
    assert.ok(exportNames.has(exportName), `${name} exports ${exportName}`);
  }
}

function writeSchemaFixture(root) {
  const sourceRoot = path.join(root, 'schema-project', 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  const schemaFile = path.join(sourceRoot, 'schemas.ts');
  const entryFile = path.join(sourceRoot, 'index.ts');
  fs.writeFileSync(schemaFile, `export interface OriginUser {
  id: number
  name: string
  active: boolean
}
`, 'utf8');
  fs.writeFileSync(entryFile, `import type { PulseContext, PulseResult } from '@pulse-compute/runtime'
import type { OriginUser } from './schemas'

export default function handler(ctx: PulseContext): PulseResult {
  const user = ctx.fetch('https://schema.example.test/user').json<OriginUser>('app.OriginUser')
  return ctx.json({ user })
}
`, 'utf8');
  const compiled = compileCanonicalProject(entryFile, {
    rootDir: path.dirname(sourceRoot),
    schemas: {
      contentTypePolicy: 'require-json',
      maxBytes: 1024,
      entries: [
        { id: 'app.OriginUser', namespace: 'app', name: 'OriginUser', source: './src/schemas.ts', type: 'OriginUser' }
      ]
    }
  });
  return buildCanonicalNativePlan(compiled);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-effects-'));
try {
  require('./assert-fastly-native-value-parity.cjs').main('http');
  const singlePlan = planForExample('fetchComposition');
  const singleOptions = {
    cwd: repoRoot,
    backends: {
      'https://users.example.test': 'users',
      'https://stats.example.test': 'stats',
      'https://flags.example.test': 'flags'
    }
  };
  const singleFirst = effects.compileFastlyNativeHttpEffectsPlan(singlePlan, singleOptions);
  const singleSecond = effects.compileFastlyNativeHttpEffectsPlan(singlePlan, { ...singleOptions, cwd: os.tmpdir() });
  assertNativeEffectsModule('single-fetch', singleFirst);
  assert.deepEqual(singleFirst.wasm, singleSecond.wasm, 'single fetch native Fastly Wasm must be deterministic across cwd');
  assert.equal(singleFirst.source, singleSecond.source, 'single fetch AssemblyScript must be deterministic across cwd');
  assert.equal(singleFirst.wat, singleSecond.wat, 'single fetch WAT must be deterministic across cwd');
  assert.deepEqual(singleFirst.manifest, singleSecond.manifest, 'single fetch manifest must be deterministic across cwd');
  for (const expected of [
    ['fastly_http_req', 'send_async'],
    ['fastly_http_req', 'pending_req_wait'],
    ['fastly_http_body', 'read']
  ]) {
    assert.ok(singleFirst.inspection.imports.some((entry) => entry.module === expected[0] && entry.name === expected[1]), `single fetch must import ${expected.join('.')}`);
  }

  let result = mock.executeFastlyNativeHttpEffects(singleFirst, {
    request: { method: 'GET', path: '/user' },
    fixtures: {
      users: {
        '/users/123': {
          status: 200,
          headers: [['content-type', 'application/json'], ['x-source', 'origin-a']],
          json: { id: 123, name: 'Ada' }
        }
      }
    }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(JSON.parse(result.response.body), { found: true, user: { id: 123, name: 'Ada' } });
  assert.equal(result.response.origin, false, 'decoded origin response must become a structured downstream response');
  assert.ok(result.trace.some((entry) => entry.module === 'fastly_http_req' && entry.name === 'send_async' && entry.backend === 'users'));
  assert.ok(result.trace.some((entry) => entry.module === 'fastly_http_req' && entry.name === 'pending_req_wait'));
  assert.ok(result.trace.some((entry) => entry.module === 'fastly_http_body' && entry.name === 'read' && entry.bytes > 0));

  const zeroPendingResult = mock.executeFastlyNativeHttpEffects(singleFirst, {
    request: { method: 'GET', path: '/user' },
    handleStarts: { pending: 0 },
    fixtures: {
      users: {
        '/users/123': {
          status: 200,
          headers: [['content-type', 'application/json'], ['x-source', 'origin-zero']],
          json: { id: 123, name: 'Ada' }
        }
      }
    }
  });
  assert.equal(zeroPendingResult.response.status, 200, 'Fastly pending request handle zero must remain a valid active effect');
  assert.deepEqual(JSON.parse(zeroPendingResult.response.body), { found: true, user: { id: 123, name: 'Ada' } });
  assert.ok(zeroPendingResult.trace.some((entry) => entry.name === 'send_async' && entry.pendingHandle === 0));
  assert.ok(zeroPendingResult.trace.some((entry) => entry.name === 'pending_req_wait' && entry.pendingHandle === 0));

  result = mock.executeFastlyNativeHttpEffects(singleFirst, {
    request: { method: 'GET', path: '/user' },
    fixtures: { users: { '/users/123': { status: 404, headers: { 'content-type': 'application/json' }, json: { error: 'not found' } } } }
  });
  assert.equal(result.response.status, 200, 'HTTP 404 remains response data and follows handler control flow');
  assert.deepEqual(JSON.parse(result.response.body), { found: true, user: { error: 'not found' } });

  assert.throws(
    () => mock.executeFastlyNativeHttpEffects(singleFirst, {
      request: { method: 'GET', path: '/user' },
      fixtures: { users: { '/users/123': { transportStatus: mock.FASTLY_STATUS_ERROR } } }
    }),
    (error) => {
      assert.equal(error && error.code, 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_EXECUTION_FAILED');
      assert.equal(error.detail.lastError, 1006, 'transport failure must use the explicit transport-error class');
      assert.equal(error.detail.errorEffect, 0);
      assert.equal(error.detail.trace.some((entry) => entry.name === 'send_downstream'), false, 'transport failure must not send a downstream response');
      return true;
    }
  );

  const multiPlan = singlePlan;
  const multi = singleFirst;
  assertNativeEffectsModule('grouped-fetch', multi);
  assert.equal(multi.manifest.groupedContinuationCount, 2);
  result = mock.executeFastlyNativeHttpEffects(multi, {
    request: { method: 'GET', path: '/user-summary' },
    fixtures: {
      users: { '/users/123': { json: { id: 123, name: 'Ada' } } },
      stats: { '/users/123': { json: { score: 99 } } },
      flags: { '/users/123': { json: { enabled: true } } }
    }
  });
  assert.deepEqual(JSON.parse(result.response.body), { id: 123, name: 'Ada', score: 99, enabled: true });
  const groupTrace = result.trace.filter((entry) => entry.name === 'send_async' || entry.name === 'pending_req_wait');
  assert.deepEqual(groupTrace.slice(0, 3).map((entry) => entry.name), ['send_async', 'send_async', 'send_async'], 'all grouped effects must start before any wait');
  assert.deepEqual(groupTrace.slice(0, 3).map((entry) => entry.backend), ['users', 'stats', 'flags']);
  assert.deepEqual(groupTrace.slice(3).map((entry) => entry.name), ['pending_req_wait', 'pending_req_wait', 'pending_req_wait']);

  result = mock.executeFastlyNativeHttpEffects(multi, {
    request: { method: 'GET', path: '/user-summary-parallel' },
    fixtures: {
      users: { '/users/123': { json: { id: 123, name: 'Ada' } } },
      stats: { '/users/123': { json: { score: 99 } } },
      flags: { '/users/123': { json: { enabled: true } } }
    }
  });
  assert.deepEqual(JSON.parse(result.response.body), { id: 123, name: 'Ada', score: 99, enabled: true });
  const parallelTrace = result.trace.filter((entry) => entry.name === 'send_async' || entry.name === 'pending_req_wait');
  assert.deepEqual(parallelTrace.slice(0, 3).map((entry) => entry.name), ['send_async', 'send_async', 'send_async']);
  assert.deepEqual(parallelTrace.slice(3).map((entry) => entry.name), ['pending_req_wait', 'pending_req_wait', 'pending_req_wait']);

  const chainPlan = planForFixture('continuation-chain');
  const chain = effects.compileFastlyNativeHttpEffectsPlan(chainPlan, {
    cwd: repoRoot,
    backends: {
      'https://users.example.test': 'users',
      'https://details.example.test': 'details'
    }
  });
  assertNativeEffectsModule('dependent-continuation', chain);
  result = mock.executeFastlyNativeHttpEffects(chain, {
    fixtures: {
      users: { '/users/123': { json: { id: 123, name: 'Ada' } } },
      details: { '/users/123': { json: { city: 'Denver' } } }
    }
  });
  assert.deepEqual(JSON.parse(result.response.body), { id: 123, city: 'Denver' });
  const chainTrace = result.trace.filter((entry) => entry.name === 'send_async' || entry.name === 'pending_req_wait');
  assert.deepEqual(chainTrace.map((entry) => [entry.name, entry.backend || null, entry.url || null]), [
    ['send_async', 'users', 'https://users.example.test/users/123'],
    ['pending_req_wait', 'users', 'https://users.example.test/users/123'],
    ['send_async', 'details', 'https://details.example.test/users/123'],
    ['pending_req_wait', 'details', 'https://details.example.test/users/123']
  ], 'dependent continuation must derive and start its second URL only after the first result resumes');

  const opaquePlan = planForExample('opaqueProxy');
  const opaque = effects.compileFastlyNativeHttpEffectsPlan(opaquePlan, {
    cwd: repoRoot,
    backends: { 'https://assets.example.com': 'assets' }
  });
  assertNativeEffectsModule('opaque-pass-through', opaque);
  result = mock.executeFastlyNativeHttpEffects(opaque, {
    request: { method: 'GET', path: '/archive' },
    fixtures: {
      assets: {
        '/archive.bin': {
          status: 206,
          headers: [['content-type', 'application/octet-stream'], ['set-cookie', 'a=1'], ['set-cookie', 'b=2']],
          body: Buffer.from([0, 1, 2, 3, 255])
        }
      }
    }
  });
  assert.equal(result.response.status, 206);
  assert.deepEqual(result.response.bodyBytes, Buffer.from([0, 1, 2, 3, 255]));
  assert.deepEqual(headerValues(result.response.headers, 'set-cookie'), ['a=1', 'b=2']);
  assert.equal(result.response.origin, true, 'opaque pass-through must retain origin response/body ownership');
  assert.equal(result.trace.some((entry) => entry.module === 'fastly_http_body' && entry.name === 'read' && entry.handle === result.response.bodyHandle), false, 'opaque pass-through must not materialize the origin body in guest memory');

  const schemaPlan = writeSchemaFixture(tempRoot);
  const schema = effects.compileFastlyNativeHttpEffectsPlan(schemaPlan, {
    cwd: repoRoot,
    backends: { 'https://schema.example.test': 'schema' }
  });
  assertNativeEffectsModule('schema-fetch', schema);
  result = mock.executeFastlyNativeHttpEffects(schema, {
    fixtures: {
      schema: {
        '/user': {
          headers: { 'content-type': 'application/json; charset=utf-8' },
          json: { id: 7, name: 'Ada', active: true, ignored: 'not in schema' }
        }
      }
    }
  });
  assert.deepEqual(JSON.parse(result.response.body), { user: { id: 7, name: 'Ada', active: true } }, 'schema decode must validate and project declared fields');
  assert.throws(
    () => mock.executeFastlyNativeHttpEffects(schema, {
      fixtures: { schema: { '/user': { headers: { 'content-type': 'application/json' }, json: { id: 7, name: 'Ada' } } } }
    }),
    (error) => error && error.code === 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_EXECUTION_FAILED'
      && error.detail.lastError === 1005,
    'schema decode must reject missing required origin fields'
  );
  assert.throws(
    () => mock.executeFastlyNativeHttpEffects(schema, {
      fixtures: { schema: { '/user': { headers: { 'content-type': 'text/plain' }, body: '{"id":7,"name":"Ada","active":true}' } } }
    }),
    (error) => error && error.code === 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_EXECUTION_FAILED'
      && error.detail.lastError === 1005,
    'require-json schema policy must reject a non-JSON origin content type'
  );

  result = mock.executeFastlyNativeHttpEffects(schema, {
    fixtures: { schema: { '/user': { headers: { 'content-type': 'application/json' }, body: '{"id":7e0,"name":"Ada","active":true}' } } }
  });
  assert.deepEqual(JSON.parse(result.response.body), { user: { id: 7, name: 'Ada', active: true } }, 'strict JSON parser must accept valid exponent syntax');

  const invalidJsonBodies = [
    ['malformed exponent', '{"id":1e,"name":"Ada","active":true}'],
    ['leading zero', '{"id":01,"name":"Ada","active":true}'],
    ['invalid unicode escape', '{"id":7,"name":"A\\u00xz","active":true}'],
    ['unescaped control character', `{"id":7,"name":"A${String.fromCharCode(1)}da","active":true}`]
  ];
  for (const [name, body] of invalidJsonBodies) {
    assert.throws(
      () => mock.executeFastlyNativeHttpEffects(schema, {
        fixtures: { schema: { '/user': { headers: { 'content-type': 'application/json' }, body } } }
      }),
      (error) => error && error.code === 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_EXECUTION_FAILED'
        && error.detail.lastError === 1004,
      `strict JSON parser must reject ${name}`
    );
  }
  const deeplyNestedJson = `${'['.repeat(66)}0${']'.repeat(66)}`;
  assert.throws(
    () => mock.executeFastlyNativeHttpEffects(singleFirst, {
      request: { method: 'GET', path: '/user' },
      fixtures: { users: { '/users/123': { headers: { 'content-type': 'application/json' }, body: deeplyNestedJson } } }
    }),
    (error) => error && error.code === 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_MOCK_EXECUTION_FAILED'
      && error.detail.lastError === 1004,
    'strict JSON parser must reject nesting beyond the bounded native depth'
  );

  const outputRoot = path.join(tempRoot, 'written');
  const written = effects.writeFastlyNativeHttpEffectsModule(chain, outputRoot);
  for (const file of [written.sourceFile, written.wasmFile, written.watFile, written.planFile, written.manifestFile]) {
    assert.equal(fs.existsSync(file), true, `${path.basename(file)} must be written`);
  }
  assert.deepEqual(fs.readFileSync(written.wasmFile), chain.wasm);
  assert.equal(JSON.parse(fs.readFileSync(written.manifestFile, 'utf8')).planHash, chainPlan.planHash);

  assert.throws(
    () => effects.compileFastlyNativeHttpEffectsPlan(singlePlan, { cwd: repoRoot }),
    (error) => error && error.code === 'PULSE_FASTLY_NATIVE_HTTP_BACKEND_MISSING',
    'each native Fastly HTTP effect requires an explicit backend binding'
  );
  const platformPlan = planForExample('fastlyCapabilities');
  assert.throws(
    () => effects.compileFastlyNativeHttpEffectsPlan(platformPlan, { cwd: repoRoot }),
    (error) => error && error.code === 'PULSE_FASTLY_NATIVE_HTTP_PLATFORM_EFFECTS_DEFERRED',
    'native Fastly effect must keep config/secret/KV/GRIP capability realization deferred to native platform capability'
  );

  const proof = {
    version: effects.FASTLY_NATIVE_HTTP_EFFECTS_VERSION,
    plans: [
      { name: 'fetch-composition', planHash: singlePlan.planHash, bytes: singleFirst.wasm.length, sha256: singleFirst.inspection.sha256 },
      { name: 'dependent-continuation', planHash: chainPlan.planHash, bytes: chain.wasm.length, sha256: chain.inspection.sha256 },
      { name: 'opaque-pass-through', planHash: opaquePlan.planHash, bytes: opaque.wasm.length, sha256: opaque.inspection.sha256 },
      { name: 'schema-fetch', planHash: schemaPlan.planHash, bytes: schema.wasm.length, sha256: schema.inspection.sha256 }
    ],
    assertions: {
      directFastlyImports: true,
      fetchAsyncWait: true,
      groupedStartsBeforeWait: true,
      dependentContinuation: true,
      originStatusHeadersBody: true,
      schemaDecode: true,
      strictJsonDecode: true,
      opaquePassThrough: true,
      transportVsHttpError: true,
      deterministic: true,
      platformCapabilitiesDeferred: true,
      zeroValuedOpaqueHandles: true,
      javascriptRuntime: false
    }
  };
  const proofFlag = process.argv.indexOf('--proof-file');
  if (proofFlag >= 0) {
    const proofValue = process.argv[proofFlag + 1];
    assert.ok(proofValue && !proofValue.startsWith('--'), '--proof-file requires a path');
    const proofFile = path.resolve(proofValue);
    fs.mkdirSync(path.dirname(proofFile), { recursive: true });
    fs.writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(proof, null, 2));
  console.log('ok - native Fastly effect realizes consolidated fetch composition, grouped and dependent continuations, schema decode, opaque pass-through, and explicit transport-error behavior');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
