#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { compileNativeProjectInMemory, prepareJavascriptApplication, inspectProject } = require('../../packages/cli/src/project-execution.js');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const { executeNodeJavascriptTestCase } = require('../../../packages/provider-node/src/javascript/test-runtime.js');
const { executeFastlyJavascriptTestCase } = require('../../../packages/provider-fastly/src/javascript/test-runtime.js');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

const repoRoot = path.resolve(__dirname, '../../..');
const allowedPackages = {
  '@pulse-compute/pulse': require('../../../packages/pulse/src/index.js'),
  '@pulse-compute/runtime': require('../../../packages/runtime/src/index.js')
};
const modes = ['node-native', 'node-javascript', 'fastly-native', 'fastly-javascript'];

function observe(response) {
  const headers = [...response.headers].map(([key, value]) => [key.toLowerCase(), value]).sort();
  const text = String(response.body || '');
  const json = headers.some(([key, value]) => key === 'content-type' && value.includes('application/json'));
  return { status: response.status, headers, body: json ? JSON.parse(text) : text };
}

async function proveFixture(name, expectedCases) {
  const cwd = path.join(repoRoot, 'wasm/test/fixtures/projects', name);
  const projects = Object.fromEntries(modes.map((profile) => [profile, resolveProject({ cwd, profile })]));
  for (const mode of modes) {
    const project = projects[mode];
    assert.equal(`${project.provider}-${project.target}`, mode);
    assert.equal(project.tests.length, expectedCases);
    assert.deepEqual(project.tests, projects['node-native'].tests, 'every mode uses the same consumer cases');
    const inspection = inspectProject(project);
    assert.equal(inspection.provider.selectedTarget, project.target);
    assert.equal(inspection.provider.selectedTargetDescriptor.automaticFallback, false);
  }
  const compiled = compileNativeProjectInMemory(projects['node-native']);
  const nodeJs = prepareJavascriptApplication(projects['node-javascript'], { allowedPackages });
  const fastlyJs = prepareJavascriptApplication(projects['fastly-javascript'], { allowedPackages, localEmulation: true });
  assert.ok(nodeJs.loaded, 'Node JavaScript source must load');
  assert.ok(fastlyJs.loaded, 'Fastly JavaScript source must load');
  const fastly = compileFastlyNativePlatformCapabilitiesPlan(compiled.plan, {
    cwd: repoRoot, bindings: {}, requirePlatformCapability: false, canonicalBuild: true
  });
  assert.ok(compiled.native.wasm.length > 0);
  assert.ok(fastly.wasm.length > 0);
  assert.equal(fastly.inspection.imports.some(({ module }) => /pulse_host|wasi|js[_-]?compute/i.test(module)), false);

  const routes = compiled.plan.routing.routes.map(({ method, path: routePath }) => ({ method, path: routePath }));
  if (name === 'catalog-router-methods') {
    const { operations } = JSON.parse(fs.readFileSync(path.join(cwd, 'operations.json'), 'utf8'));
    assert.equal(operations.length, 14);
    assert.deepEqual(operations.reduce((counts, { method }) => {
      counts[method] = (counts[method] || 0) + 1;
      return counts;
    }, {}), { PATCH: 3, PUT: 5, DELETE: 6 });
    assert.deepEqual(routes.slice(0, 14), operations.map(({ method, path }) => ({ method, path })));
    for (const { operationId } of operations) {
      assert.equal(projects['node-native'].tests.filter((test) => test.name === operationId).length, 1);
    }
  } else {
    assert.deepEqual(routes, [
      { method: 'PUT', path: '/api/v1/resources/:resourceId/visibility' },
      { method: 'PATCH', path: '/api/v1/resources/:resourceId' },
      { method: 'DELETE', path: '/api/v1/resources/:resourceId' }
    ]);
  }

  for (const test of projects['node-native'].tests) {
    const native = await executeCanonicalNativeModule(compiled.native, {
      request: test.request, providerAdapter: createNodeProviderAdapter(), strict: true
    });
    assert.equal(native.status, 'completed');
    const results = {
      'node-native': native,
      'node-javascript': await executeNodeJavascriptTestCase(nodeJs.loaded.application, test, { strict: true }),
      'fastly-native': executeFastlyNativePlatformCapabilities(fastly, { request: test.request }),
      'fastly-javascript': await executeFastlyJavascriptTestCase(fastlyJs.loaded.application, test, { bindings: {}, strict: true, networkFetch: false })
    };
    const baseline = observe(native.response);
    for (const mode of modes) {
      const actual = observe(results[mode].response);
      assert.equal(actual.status, test.expect.status, `${name}/${test.name}/${mode}: expected status`);
      assert.deepEqual(actual.body, test.expect.json === undefined ? test.expect.text : test.expect.json, `${name}/${test.name}/${mode}: expected body`);
      assert.deepEqual(actual, baseline, `${name}/${test.name}/${mode}: response parity`);
    }
  }
  return { fixture: name, cases: expectedCases, executions: expectedCases * modes.length, modes, providerReality: false };
}

(async () => {
  const proofs = [];
  proofs.push(await proveFixture('catalog-router-probe', 3));
  proofs.push(await proveFixture('catalog-router-methods', 68));
  console.log(JSON.stringify({ status: 'passed', proofs }, null, 2));
  console.log('ok - Catalog consumer verbs, mounted routing and terminal transfers match on four explicit targets');
})().catch((error) => {
  console.error(error.stack || error);
  if (error.diagnostics) console.error(JSON.stringify(error.diagnostics, null, 2));
  process.exitCode = 1;
});
