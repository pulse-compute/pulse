#!/usr/bin/env node
'use strict';

// O2 acceptance target defined by O1. No draft import mapping or S3 dispatcher.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('./o1/contract.json');
const vectors = require('./o1/vectors.json');
const bindings = require('./o1/bindings.json');
const root = path.resolve(__dirname, '../../..');

if (!fs.existsSync(path.join(root, 'packages/s3/package.json'))) {
  console.log(JSON.stringify({
    status: 'blocked', phase: 'O2', providerReality: false,
    reason: 'The real @pulse-compute/s3 package, lowering and Native provider realizations are required.',
    targets: contract.nativeAcceptance.targets,
  }));
  process.exitCode = contract.nativeAcceptance.missingRealizationExitCode;
} else {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

function cases() {
  const rows = [];
  const metadata = (body) => ({ byteLength: body.length, etag: '"opaque-o1"', contentType: 'text/plain; charset=utf-8' });
  function add(id, route, key, encoded, body, overrides = {}, expected) {
    const meta = metadata(body);
    const object = { status: 'found', ...meta, text: body.toString('utf8'), sha256: crypto.createHash('sha256').update(body).digest('hex') };
    const head = { status: 'found', ...meta };
    rows.push({
      id, route, key, url: `https://objects.example.invalid/o1-fixture/${encoded}`,
      origin: {
        status: 200,
        headers: { 'content-length': String(body.length), etag: meta.etag, 'content-type': meta.contentType },
        body, ...overrides,
      },
      expected: expected || (route === '/head' ? head : route === '/parallel' ? { metadata: head, object } : object),
    });
  }
  for (const [i, { key, encoded }] of vectors.keys.entries()) {
    for (const route of ['/head', '/get']) add(`key-${i}${route}`, route, key, encoded, Buffer.from('object\n'));
  }
  for (const v of vectors.bodies) add(`body-${v.id}`, '/get', 'body', 'body', Buffer.from(v.hex, 'hex'));
  add('parallel', '/parallel', '/a//b/', '/a//b/', Buffer.from('parallel'));
  const failure = (reason, httpStatus = 200) => ({ status: 'failed', reason, httpStatus });
  for (const hex of vectors.invalidUtf8) {
    add(`utf8-${hex}`, '/get', 'invalid', 'invalid', Buffer.from(hex, 'hex'), {}, failure('invalid-utf8'));
  }
  for (const size of [contract.limits.textUtf8Bytes, contract.limits.textUtf8Bytes + 1]) {
    const bytes = Buffer.alloc(size, 0x61);
    add(`size-${size}`, '/get', 'size', 'size', bytes, {}, size > contract.limits.textUtf8Bytes ? failure('too-large') : undefined);
    add(`head-size-${size}`, '/head', 'size', 'size', bytes);
  }
  for (const [status, reason] of [[403, 'not-authorized'], [429, 'throttled'], [500, 'unavailable'], [408, 'timeout'], [302, 'protocol'], [204, 'protocol']]) {
    for (const route of ['/head', '/get']) add(`status-${status}${route}`, route, 'status', 'status', Buffer.alloc(0), { status }, failure(reason, status));
  }
  for (const route of ['/head', '/get']) add(`absent${route}`, route, 'absent', 'absent', Buffer.alloc(0), { status: 404 }, { status: 'not-found' });
  add('head-missing-length', '/head', 'length', 'length', Buffer.alloc(0), { headers: {} }, failure('protocol'));
  add('get-wrong-length', '/get', 'length', 'length', Buffer.from('abc'), { headers: { 'content-length': '4' } }, failure('protocol'));
  add('get-encoded', '/get', 'encoded', 'encoded', Buffer.from('abc'), { headers: { 'content-encoding': 'gzip' } }, failure('protocol'));
  for (const [i, key] of ['', '.', 'a/../b', 'a'.repeat(contract.limits.keyUtf8Bytes + 1)].entries()) {
    rows.push({ id: `invalid-key-${i}`, route: '/get', key, expected: { status: 'failed', reason: 'invalid-key' } });
  }
  return rows;
}

async function main() {
  const { resolveProject } = require('../../packages/cli/src/project-config.js');
  const { inspectProject, compileNativeProjectInMemory } = require('../../packages/cli/src/project-execution.js');
  const { getProviderDriver } = require('../../packages/cli/src/provider-drivers.js');
  const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
  const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
  const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
  const cwd = fs.mkdtempSync(path.join(__dirname, '.native-read-'));
  try {
    fs.cpSync(path.join(__dirname, 'o1/native-read'), cwd, { recursive: true });
    // Literal provider fragments go through the actual config compiler/schema.
    // They cannot be silently dropped and reintroduced through a custom host.
    const config = {
      pulse: { entry: 'src/index.ts', defaultProfile: 'node-native', strict: true },
      'node-native': { host: 'node', target: 'native', node: bindings.node },
      'fastly-native': { host: 'fastly', target: 'native', fastly: bindings.fastly },
    };
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'),
      `import { defineConfig } from '@pulse-compute/pulse'\nexport default defineConfig((_scope) => (${JSON.stringify(config, null, 2)}))\n`);
    const nodeProject = resolveProject({ cwd, profile: 'node-native' });
    const fastlyProject = resolveProject({ cwd, profile: 'fastly-native' });
    for (const project of [nodeProject, fastlyProject]) {
      assert.equal(project.target, 'native');
      const inspection = inspectProject(project);
      assert.equal(inspection.provider.selectedTargetDescriptor.automaticFallback, false);
      assert.ok(project.providerConfig.bindings.s3.objects, 'provider config must preserve and validate the logical S3 binding');
    }
    const node = compileNativeProjectInMemory(nodeProject);
    const fastlyPlan = compileNativeProjectInMemory(fastlyProject).plan;
    const fastly = compileFastlyNativePlatformCapabilitiesPlan(fastlyPlan, {
      cwd: root, bindings: fastlyProject.providerConfig.bindings, canonicalBuild: true,
    });
    assert.ok(node.native.wasm.length > 0 && fastly.wasm.length > 0);
    assert.equal(fastly.inspection.imports.some(({ module }) => /pulse_host|wasi|js[_-]?compute/i.test(module)), false);
    const driver = getProviderDriver(nodeProject.providerSelector || 'node', { projectRoot: cwd });
    const secrets = {
      S3_ACCESS_KEY_ID: 'o1-access-id-secret-sentinel',
      S3_SECRET_ACCESS_KEY: 'o1-secret-key-sentinel-12345678901234567890',
    };
    for (const artifact of [node.native.wasm, fastly.wasm]) {
      for (const secret of Object.values(secrets)) assert.equal(Buffer.from(artifact).includes(Buffer.from(secret)), false);
    }
    const rows = cases();
    for (const row of rows) {
      const request = { method: 'POST', path: row.route, url: `https://app.example.invalid${row.route}`, headers: [], body: row.key };
      const methods = !row.origin ? [] : row.route === '/parallel' ? ['GET', 'HEAD'] : [row.route === '/head' ? 'HEAD' : 'GET'];
      const captured = [];
      const fetchImplementation = async (input, init) => {
        const req = new Request(input, init);
        captured.push({ method: req.method, url: req.url });
        assert.ok(row.origin, `${row.id}: invalid input must not dispatch`);
        assert.equal(req.redirect, 'manual', `${row.id}: redirects must be disabled`);
        assert.equal(req.headers.get('accept-encoding'), 'identity');
        assert.match(req.headers.get('authorization') || '', /^AWS4-HMAC-SHA256 /);
        return new Response(req.method === 'HEAD' || row.origin.status === 204 ? null : row.origin.body,
          { status: row.origin.status, headers: row.origin.headers });
      };
      const nodeResult = await executeCanonicalNativeModule(node.native, driver.executionOptions(nodeProject.providerConfig, {
        request, strict: true, secrets, fetchImplementation,
      }));
      assert.equal(nodeResult.status, 'completed', row.id);
      const fixtures = Object.fromEntries(methods.map((method) => [`${method} ${row.url}`, {
        ...row.origin, body: method === 'HEAD' ? Buffer.alloc(0) : row.origin.body,
      }]));
      const fastlyResult = executeFastlyNativePlatformCapabilities(fastly, {
        request, secretStore: bindings.fastly.bindings.secretStore, secrets, fixtures,
      });
      for (const [target, result, outbound] of [
        ['node-native', nodeResult, captured],
        ['fastly-native', fastlyResult, fastlyResult.outboundRequests],
      ]) {
        assert.equal(result.response.status, 200, `${row.id}/${target}: consumer result`);
        assert.deepEqual(JSON.parse(result.response.body), row.expected, `${row.id}/${target}: exact result`);
        assert.deepEqual(outbound.map(({ method, url }) => `${method} ${url}`).sort(),
          methods.map((method) => `${method} ${row.url}`).sort(), `${row.id}/${target}: exact origin requests, no retries`);
        for (const secret of Object.values(secrets)) assert.equal(JSON.stringify(result).includes(secret), false, `${row.id}/${target}: secret redaction`);
      }
    }
    console.log(JSON.stringify({ status: 'passed', cases: rows.length, executions: rows.length * 2,
      targets: contract.nativeAcceptance.targets, providerReality: false }));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
