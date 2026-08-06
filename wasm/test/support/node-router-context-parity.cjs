'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const fixtureRoot = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects', 'router-context-parity');

const runtime = require('../../../packages/runtime/src/index.js');
const pulse = require('../../../packages/pulse/src/index.js');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const {
  prepareJavascriptApplication,
  runProjectTests,
  startDevServer
} = require('../../packages/cli/src/project-execution.js');
const { providerTargetAvailability } = require('../../packages/cli/src/provider-drivers.js');
const { NODE_JAVASCRIPT_TARGET_DESCRIPTOR } = require('../../../packages/provider-node/src/javascript/target.js');

const NODE_ROUTER_CONTEXT_PARITY_VERSION = 'pulse.node-router-context-parity.v1';
const NODE_WIRE_OBSERVATION_VERSION = 'pulse.node-wire-observation.v1';
const TRANSPORT_RESPONSE_HEADERS = Object.freeze([
  'connection',
  'content-length',
  'date',
  'keep-alive',
  'transfer-encoding'
]);
const TRANSPORT_RESPONSE_HEADER_SET = new Set(TRANSPORT_RESPONSE_HEADERS);
const ALLOWED_CORE_PACKAGES = Object.freeze({
  '@pulse-compute/runtime': runtime,
  '@pulse-compute/pulse': pulse
});

function freezePairs(pairs) {
  return Object.freeze(pairs.map(([name, value]) => Object.freeze([String(name), String(value)])));
}

function resolveParityProjects() {
  const native = resolveProject({ cwd: fixtureRoot, env: { PULSE_PROFILE: 'native' } });
  const javascript = resolveProject({ cwd: fixtureRoot, env: { PULSE_PROFILE: 'javascript' } });
  assert.equal(native.provider, 'node');
  assert.equal(javascript.provider, 'node');
  assert.equal(native.target, 'native');
  assert.equal(javascript.target, 'javascript');
  assert.deepEqual(native.tests.map((entry) => entry.name), javascript.tests.map((entry) => entry.name));
  return Object.freeze({ native, javascript });
}

function normalizedWireHeaders(rawHeaders) {
  const pairs = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = String(rawHeaders[index] || '').toLowerCase();
    const value = String(rawHeaders[index + 1] || '');
    if (!TRANSPORT_RESPONSE_HEADER_SET.has(name)) pairs.push(Object.freeze([name, value]));
  }
  return Object.freeze(pairs);
}

function requestEnvelope(testCase) {
  const request = testCase.request || {};
  const url = new URL(String(request.url));
  const body = request.body === undefined ? undefined : String(request.body);
  const headers = [...(request.headers || []).map(([name, value]) => [String(name), String(value)])];
  headers.push(['host', url.host]);
  headers.push(['connection', 'close']);
  if (body !== undefined) headers.push(['content-length', String(Buffer.byteLength(body))]);
  return Object.freeze({
    method: String(request.method || 'GET').toUpperCase(),
    url: url.toString(),
    path: `${url.pathname}${url.search}`,
    headers: freezePairs(headers),
    body
  });
}

function nodeRequest(server, testCase) {
  const address = server.address();
  const envelope = requestEnvelope(testCase);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: address.port,
      method: envelope.method,
      path: envelope.path,
      headers: envelope.headers.flat(),
      agent: false
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Object.freeze({
        version: NODE_WIRE_OBSERVATION_VERSION,
        status: response.statusCode,
        headers: normalizedWireHeaders(response.rawHeaders),
        body: Buffer.concat(chunks).toString('utf8')
      })));
    });
    request.once('error', reject);
    request.end(envelope.body);
  });
}

async function closeRunningServer(running) {
  if (!running || !running.server || !running.server.listening) return;
  running.server.close();
  await running.closed;
}

function projectTestEvidence(result, target) {
  return Object.freeze({
    status: result.status,
    provider: result.provider,
    target,
    ...(result.targetId ? { targetId: result.targetId } : {}),
    automaticFallback: result.automaticFallback === true,
    summary: result.summary,
    cases: Object.freeze(result.cases.map((entry) => Object.freeze({
      name: entry.name,
      status: entry.status,
      ...(entry.response ? { response: entry.response } : {})
    })))
  });
}

function requestEvidence(testCase) {
  const request = testCase.request || {};
  return Object.freeze({
    method: String(request.method || 'GET').toUpperCase(),
    url: String(request.url),
    headers: freezePairs(request.headers || []),
    ...(request.body === undefined ? {} : { body: String(request.body) })
  });
}

async function runNodeRouterContextParity() {
  const projects = resolveParityProjects();
  const descriptor = NODE_JAVASCRIPT_TARGET_DESCRIPTOR;
  const availability = providerTargetAvailability('node');
  const prepared = prepareJavascriptApplication(projects.javascript, { allowedPackages: ALLOWED_CORE_PACKAGES });
  assert.ok(prepared.loaded, 'JavaScript parity fixture must load through the graph-backed application loader.');

  const nativeTests = await runProjectTests(projects.native);
  const javascriptTests = await runProjectTests(projects.javascript, { allowedPackages: ALLOWED_CORE_PACKAGES });
  assert.equal(nativeTests.status, 'passed', 'Native project tests must pass before wire comparison.');
  assert.equal(javascriptTests.status, 'passed', 'JavaScript project tests must pass before wire comparison.');
  assert.deepEqual(nativeTests.summary, javascriptTests.summary, 'Project-test summaries must match.');

  let nativeRunning;
  let javascriptRunning;
  const cases = [];
  try {
    nativeRunning = await startDevServer(projects.native, {
      host: '127.0.0.1',
      port: 0,
      watch: false
    });
    javascriptRunning = await startDevServer(projects.javascript, {
      host: '127.0.0.1',
      port: 0,
      watch: false,
      allowedPackages: ALLOWED_CORE_PACKAGES
    });

    for (const testCase of projects.native.tests) {
      const nativeObservation = await nodeRequest(nativeRunning.server, testCase);
      const javascriptObservation = await nodeRequest(javascriptRunning.server, testCase);
      assert.deepEqual(
        javascriptObservation,
        nativeObservation,
        `${testCase.name}: native Node and JavaScript Node wire observations diverged.`
      );
      cases.push(Object.freeze({
        name: testCase.name,
        request: requestEvidence(testCase),
        native: nativeObservation,
        javascript: javascriptObservation,
        equal: true
      }));
    }
  } finally {
    await closeRunningServer(javascriptRunning);
    await closeRunningServer(nativeRunning);
  }

  const nativeApplication = nativeTests.metadata && nativeTests.metadata.application;
  return Object.freeze({
    version: NODE_ROUTER_CONTEXT_PARITY_VERSION,
    observation: Object.freeze({
      version: NODE_WIRE_OBSERVATION_VERSION,
      boundary: 'node-http-wire',
      responseHeadersExcludedAsTransportOwned: TRANSPORT_RESPONSE_HEADERS,
      permanentSemanticTrace: false
    }),
    fixture: Object.freeze({
      path: 'wasm/test/fixtures/projects/router-context-parity',
      cases: Object.freeze(projects.native.tests.map((entry) => entry.name))
    }),
    targets: Object.freeze({
      native: Object.freeze({
        provider: projects.native.provider,
        target: projects.native.target,
        projectHash: projects.native.projectHash,
        configPlanHash: projects.native.planHash,
        sourceHash: nativeTests.metadata.sourceHash,
        projectSourceHash: nativeTests.metadata.projectSourceHash,
        routerExecutionVersion: nativeApplication && nativeApplication.router && nativeApplication.router.executionVersion,
        automaticFallback: false
      }),
      javascript: Object.freeze({
        provider: projects.javascript.provider,
        target: projects.javascript.target,
        targetId: descriptor.targetId,
        status: descriptor.status,
        available: availability.javascript,
        projectHash: projects.javascript.projectHash,
        configPlanHash: projects.javascript.planHash,
        applicationPlanHash: prepared.plan.planHash,
        graphHash: prepared.plan.graph.graphHash,
        automaticFallback: false
      })
    }),
    projectTests: Object.freeze({
      native: projectTestEvidence(nativeTests, 'native'),
      javascript: projectTestEvidence(javascriptTests, 'javascript')
    }),
    parity: Object.freeze({
      status: 'passed',
      total: cases.length,
      matched: cases.length,
      mismatches: 0,
      cases: Object.freeze(cases)
    }),
    scope: Object.freeze({
      routerTopology: true,
      terminalNext: true,
      scopedMiddleware: true,
      mountedRouters: true,
      routeParams: true,
      requestState: true,
      requestMethodUrlPath: true,
      requestBody: true,
      requestHeaderPairs: true,
      responseStatusHeadersBody: true,
      repeatedResponseHeaders: true,
      headAndBodylessResponseOwnership: true,
      handledAndUnhandledErrors: true,
      routerOwned404And500: true,
      automaticFallback: false
    })
  });
}

module.exports = Object.freeze({
  NODE_ROUTER_CONTEXT_PARITY_VERSION,
  NODE_WIRE_OBSERVATION_VERSION,
  TRANSPORT_RESPONSE_HEADERS,
  ALLOWED_CORE_PACKAGES,
  fixtureRoot,
  normalizedWireHeaders,
  requestEnvelope,
  resolveParityProjects,
  runNodeRouterContextParity
});
