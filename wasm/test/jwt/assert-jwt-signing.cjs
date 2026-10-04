#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const { executeFastlyJavascriptApplication } = require('../../../packages/provider-fastly/src/javascript/runtime-host.js');
const NOW = 1800000000;
const KEY = 'fixture-only-jwt-signing-secret-32-bytes';

async function main() {
  const tc = acceptanceToolchain();
  const cwd = fs.mkdtempSync(path.join(__dirname, '.sign-'));
  let executions = 0;
  try {
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'jwt']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    fs.mkdirSync(path.join(cwd, 'src')); fs.mkdirSync(path.join(cwd, '.pulse'));
    const entryFile = path.join(cwd, 'src/index.ts');
    fs.copyFileSync(path.join(__dirname, 'sign-consumer.ts'), entryFile);
    const config = { pulse: { entry: 'src/index.ts', defaultProfile: 'node-native', strict: false, crypto: ['HMAC-SHA256'] } };
    for (const host of ['node', 'fastly']) for (const target of ['native', 'javascript']) {
      config[`${host}-${target}`] = { host, target, ...(host === 'fastly' ? { fastly: { bindings: { secretStore: 'app_secrets' } } } : {}) };
    }
    const writeConfig = () => fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope) => (${JSON.stringify(config)}));`);
    writeConfig();
    let projects = Object.fromEntries(Object.keys(config).filter(id => id !== 'pulse').map(profile => [profile, tc.resolveProject({ cwd, profile })]));
    for (const project of [projects['node-javascript'], projects['fastly-javascript']]) {
      const inspected = tc.inspectProject(project);
      assert.equal(inspected.provider.targetSupport.project.status, 'eligible', JSON.stringify(inspected.provider.targetSupport));
    }
    const signingOnly = tc.compileFastly(projects['fastly-native']);
    assert.equal(signingOnly.manifest.policy.wasi, 'clock_time_get only');
    assert.match(signingOnly.manifest.policy.jwt, /bounded issuance/);
    // A reader can authenticate its inbound token and mint a worker token in
    // the same artifact. Verification and issuance retain separate demands.
    fs.appendFileSync(entryFile, `
app.get('/verify', async ctx => {
      const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), {
        algorithms: ['HS256'], key: { type: 'secret', binding: 'WORKER_KEY' },
        issuer: 'issuer', audience: 'worker', requiredClaims: ['sub', 'iat', 'exp'],
        maxTokenAgeSeconds: 60,
      });
      return ctx.text(verified.claims.sub);
    });
`);
    config.pulse.crypto.push('HS256'); writeConfig();
    projects = Object.fromEntries(Object.keys(projects).map(profile => [profile, tc.resolveProject({ cwd, profile })]));
    const node = tc.compileNativeProjectInMemory(projects['node-native']);
    const fastly = tc.compileFastly(projects['fastly-native']);
    assert.equal(fastly.inspection.imports.some(({ module }) => /pulse_host|js[_-]?compute/i.test(module)), false);
    const js = tc.prepareJavascriptApplication(projects['node-javascript']);
    const nested = depth => { let value = 1; for (let i = 0; i < depth; i++) value = { x: value }; return value; };
    const boundary = 8192 - Buffer.byteLength(JSON.stringify({ x: '', iat: NOW, exp: NOW + 45 }));
    const cases = [
      { claims: { x: 'x'.repeat(boundary) } },
      { claims: { x: 'x'.repeat(boundary + 1) }, failed: true },
      { claims: nested(32) },
      { claims: nested(33), failed: true },
      { claims: { x: Array(1022).fill(0) } },
      { claims: { sub: 'maximum-key' }, key: 'é'.repeat(2048) },
      { claims: { sub: 'oversize-key' }, key: 'é'.repeat(2049), failed: true },
      { claims: { iss: 'issuer', aud: 'worker', sub: 'scheduler', scope: 'reconcile', job: 'projection', epoch: 3, method: 'POST', path: '/step', bodySha256: 'a'.repeat(64) } },
      { claims: { unicode: 'é😀', nested: [null, true, { x: 1.25 }], escaped: '\u0000"\\' } },
      { claims: {} },
      { claims: { exp: NOW + 900 }, failed: true },
      { claims: { iat: NOW }, failed: true },
      { claims: { nbf: NOW }, failed: true },
      { claims: { x: 'é'.repeat(4096) }, failed: true },
      { claims: { x: Array(1024).fill(0) }, failed: true },
      { claims: { sub: 'missing-key' }, key: undefined, failed: true },
      { claims: { sub: 'short-key' }, key: 'short', failed: true },
      { claims: { sub: 'long-key' }, key: 'x'.repeat(4097), failed: true },
      { route: '/parallel' },
      { route: '/verify' },
      { route: '/five-minutes-plus', ttl: 301 },
      { route: '/one-hour', ttl: 3600 },
      { route: '/one-day', ttl: 86400 },
      { route: '/date-limit', ttl: 8640000000000 - NOW },
      { route: '/date-overflow', failed: true },
    ];
    function validate(token, claims, ttl, key = KEY) {
      const [header, payload, signature] = token.split('.');
      assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' });
      assert.equal(signature, createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url'));
      assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), { ...claims, iat: NOW, exp: NOW + ttl });
    }
    const issued = {};
    for (const row of cases) for (const mode of Object.keys(projects)) {
      const key = Object.hasOwn(row, 'key') ? row.key : KEY;
      const secrets = key === undefined ? {} : { WORKER_KEY: key };
      const route = row.route || '/sign';
      const request = { method: row.route ? 'GET' : 'POST', path: route, url: `https://sign.test${route}`, headers: row.route === '/verify' ? [['authorization', `Bearer ${issued[mode]}`]] : [], ...(row.route ? {} : { body: JSON.stringify(row.claims) }) };
      const observations = [], logs = [];
      let result;
      try {
      if (mode === 'fastly-native') result = tc.executeFastlyNativePlatformCapabilities(fastly, { request, secrets, clockUnixSeconds: NOW, allowHandledJwtError: true });
      else if (mode === 'node-native') result = await tc.executeCanonicalNativeModule(node.native,
        tc.driver.executionOptions(projects[mode].providerConfig, { request, secrets, strict: false,
          captureJwtWallClock: () => ({ trusted: true, unixEpochSeconds: NOW }), onEffectObservation: event => observations.push(event), log: event => logs.push(event) }));
      else {
        const execute = mode === 'node-javascript' ? tc.executeNodeJavascriptApplication : executeFastlyJavascriptApplication;
        const response = await execute(js.loaded.application, new Request(request.url, { method: request.method, body: request.body, headers: request.headers }), {
          secrets, bindings: { secretStore: 'app_secrets' },
          apis: { SecretStore: class { async get(name) { return secrets[name] === undefined ? null : { plaintext: () => secrets[name] }; } } },
          strict: false, jwtCaptureWallClock: () => ({ trusted: true, unixEpochSeconds: NOW }),
          onEffectObservation: event => observations.push(event), log: event => logs.push(event),
        });
        result = { response: { status: response.status, body: await response.text() } };
      }
      } catch (error) {
        assert.equal(row.failed, true, `${mode}: unexpected ${error.stack}`);
        if (mode === 'fastly-native') {
          // The production Native driver terminates a failed JWT effect; it
          // does not enable the verification-only diagnostic HTTP harness.
          assert.equal(error.code, 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED');
          assert.equal(error.detail.lastError, 1008);
          assert.ok([241, 242, 243, 244, 246, 248].includes(error.detail.errorStage), JSON.stringify(error.detail));
        } else assert.match(error.code, /^PULSE_JWT_(CLAIMS_INVALID|LIMIT_EXCEEDED|KEY_INVALID|OPERATION_FAILED)$/);
        assert.equal(JSON.stringify(error).includes(KEY), false);
        executions++; continue;
      }
      const body = result.response.body;
      if (row.failed) {
        assert.ok(result.response.status >= 400, `${mode}: expected failure ${JSON.stringify(row)}: ${body}`);
        assert.equal(body.includes(KEY), false);
      } else {
        assert.equal(result.response.status, 200, `${mode}: ${body}`);
        if (row.route === '/verify') assert.equal(body, 'scheduler', `${mode}: signer/verifier round-trip`);
        else if (row.ttl) validate(body, { sub: 'lifetime' }, row.ttl);
        else if (row.route) { const tokens = JSON.parse(body); validate(tokens.first, { sub: 'first' }, 1); validate(tokens.second, { sub: 'second' }, 300); }
        else {
          validate(body, row.claims, 45, key);
          if (row.claims.sub === 'scheduler') issued[mode] = body;
          assert.equal(JSON.stringify([observations, logs, result.trace, result.logs]).includes(body), false, `${mode}: token redacted`);
        }
      }
      executions++;
    }
    // Configuration owns crypto admission; no implicit realization or fallback.
    config.pulse.crypto = [];
    writeConfig();
    for (const profile of Object.keys(projects)) assert.throws(() => tc.inspectProject(tc.resolveProject({ cwd, profile })), /HMAC-SHA256/);
    console.log(JSON.stringify({ status: 'passed', executions, targets: Object.keys(projects), providerReality: false }));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack || error); console.error(JSON.stringify({ detail: error.detail, diagnostics: error.diagnostics })); process.exitCode = 1; });
