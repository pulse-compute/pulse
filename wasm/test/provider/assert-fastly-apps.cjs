#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const nodeRuntime = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const fastlyRuntime = require('../../../packages/provider-fastly/src/runtime/canonical-api-runtime.js');
const fastlyContract = require('../../../packages/provider-fastly/src/provider-contract.js');
const {
  EXAMPLES,
  compileExample
} = require('../support/canonical-projects.cjs');

const secretValue = 'fastly-test-secret-value';

function executionOptions(id, project, values = {}) {
  return {
    executionId: id,
    bindings: project.providerConfig.bindings,
    request: values.request,
    config: values.config || {},
    secrets: values.secrets || {},
    kv: values.kv || {},
    fetches: values.fetches || {},
    grip: values.grip || {}
  };
}

async function executeParity(exampleId, values) {
  const { project, compiled, program } = compileExample(exampleId);
  assert.equal(project.provider, 'fastly', `${exampleId}: provider conformance must use a documented Fastly project`);
  const options = executionOptions(`fastly-parity:${exampleId}`, project, values);
  const node = await nodeRuntime.executeCanonicalProgram(program, options);
  const fastly = await fastlyRuntime.executeCanonicalProgram(program, options);
  assert.equal(node.metadata.sourceHash, fastly.metadata.sourceHash, `${exampleId}: providers must execute identical canonical source`);
  assert.equal(node.response.status, fastly.response.status, `${exampleId}: response status must match`);
  assert.equal(node.response.bodyClass, fastly.response.bodyClass, `${exampleId}: response body class must match`);
  if (node.response.bodyClass === 'structured') {
    const nodeType = String(node.response.headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '');
    const fastlyType = String(fastly.response.headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '');
    if (nodeType.includes('json') && fastlyType.includes('json')) assert.deepEqual(JSON.parse(node.response.body), JSON.parse(fastly.response.body), `${exampleId}: structured JSON response must match`);
    else assert.equal(node.response.body, fastly.response.body, `${exampleId}: structured response body must match`);
  }
  assert.equal(fastly.provider, 'fastly');
  assert.equal(fastly.providerMetadata.contract.package, '@pulse-compute/provider-fastly');
  assert.equal(fastly.providerMetadata.contract.deployable, true);
  assert.equal(fastly.providerMetadata.localConformanceRuntime, true);
  assert.equal(fastly.providerMetadata.executionMode, 'local-conformance');
  assert.equal(fastly.providerMetadata.deploymentValidated, false);
  assert.equal(fastly.providerMetadata.providerSpecificUserland, false);
  assert.equal(fastly.providerMetadata.providerSdkUserland, false);
  return Object.freeze({ project, compiled, node, fastly });
}

async function main() {
  const capabilities = await executeParity(EXAMPLES.fastlyCapabilities, {
    request: { path: '/users/7' },
    config: { API_BASE: 'https://api.example.com' },
    secrets: { API_TOKEN: secretValue },
    fetches: {
      'https://api.example.com/users/7': { status: 200, value: { id: 7, name: 'Ada' } }
    }
  });
  assert.deepEqual(JSON.parse(capabilities.fastly.response.body), { user: { id: 7, name: 'Ada' } });
  assert.equal(capabilities.project.providerConfig.bindings.configStore, 'app_config');
  assert.equal(capabilities.project.providerConfig.bindings.secretStore, 'app_secrets');
  assert.equal(capabilities.project.providerConfig.bindings.backends['https://api.example.com'], 'api_backend');
  const fastlyPlan = capabilities.fastly.providerMetadata.lowering;
  assert.deepEqual(fastlyPlan.requirements, [
    'config.get',
    'fetch',
    'grip.broadcast',
    'kv.get',
    'kv.put',
    'response.json',
    'response.text',
    'secret.get'
  ]);
  assert.equal(fastlyPlan.operations.find((entry) => entry.kind === 'config').binding, 'app_config');
  assert.equal(fastlyPlan.operations.find((entry) => entry.kind === 'secret').binding, 'app_secrets');
  assert.equal(fastlyPlan.operations.find((entry) => entry.kind === 'fetch').lowering, 'fastly.backend.fetch');
  const fetchStart = capabilities.fastly.trace.find(
    (entry) => entry.type === 'effect-start' && entry.kind === 'fetch'
  );
  assert.ok(fetchStart, 'Fastly execution must dispatch a canonical fetch effect');
  assert.deepEqual(fetchStart.headers.find(([name]) => name === 'authorization'), ['authorization', '<redacted>']);
  assert.equal(
    JSON.stringify(capabilities.fastly).includes(secretValue),
    false,
    'Fastly execution output and trace must not leak raw secrets'
  );

  const kv = await executeParity(EXAMPLES.fastlyCapabilities, {
    request: { path: '/session' },
    kv: { sessions: { 'session:123': { userId: 123 } } }
  });
  assert.deepEqual(JSON.parse(kv.fastly.response.body), { session: { userId: 123 } });
  assert.equal(kv.project.providerConfig.bindings.kv.sessions, 'app_sessions');
  assert.ok(kv.fastly.trace.some((entry) => entry.type === 'effect-start' && entry.kind === 'kv.get' && entry.store === 'sessions'));
  assert.ok(kv.fastly.trace.some((entry) => entry.type === 'effect-resolved' && entry.kind === 'kv.put' && entry.stored === true));
  assert.ok(kv.fastly.providerMetadata.lowering.operations.every((entry) => entry.kind !== 'kv' || entry.binding === 'app_sessions'));

  const opaque = await executeParity(EXAMPLES.opaqueProxy, {
    request: { path: '/archive' },
    fetches: {
      'https://assets.example.com/archive.bin': {
        status: 206,
        kind: 'stream',
        opaque: true,
        headers: [
          ['content-type', 'application/octet-stream'],
          ['x-part', 'one'],
          ['x-part', 'two']
        ],
        bodyHandle: { handleId: 'fastly-opaque-body', bodyKind: 'stream' },
        bodyStream: { chunks: [Buffer.from([0, 255, 1, 2])] }
      }
    }
  });
  assert.equal(opaque.fastly.response.status, 206);
  assert.equal(opaque.fastly.response.bodyClass, 'opaque');
  assert.equal(opaque.fastly.response.hostOwnsStream, true);
  assert.equal(opaque.fastly.response.wasmOwnsBytes, false);
  assert.deepEqual(opaque.fastly.response.headers.filter(([name]) => name === 'x-part'), [
    ['x-part', 'one'],
    ['x-part', 'two']
  ]);
  const opaqueOperation = opaque.fastly.providerMetadata.lowering.operations[0];
  assert.equal(opaqueOperation.binding, 'assets_backend');
  assert.equal(opaqueOperation.resultCapability, 'opaque.pass-through');
  assert.equal(opaqueOperation.resultLowering, 'fastly.response-body.stream');

  for (const result of [capabilities, opaque]) {
    const directPlan = fastlyContract.createFastlyLoweringPlan(result.compiled.metadata, result.project.providerConfig.bindings);
    assert.equal(directPlan.provider, 'fastly');
    assert.equal(directPlan.deployable, true);
    assert.equal(directPlan.providerSpecificUserland, false);
    assert.equal(directPlan.providerSdkUserland, false);
    assert.deepEqual(JSON.parse(JSON.stringify(directPlan)), JSON.parse(JSON.stringify(result.fastly.providerMetadata.lowering)));
  }

  console.log('ok - documented Fastly examples are the provider conformance oracle for config, secrets, KV, fetch, opaque pass-through, and redaction');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
