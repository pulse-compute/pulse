#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, parseJson, parseError } = require('./helpers.cjs');
const { normalizeProviderConfig } = require('../../packages/cli/src/project-config.js');

function main() {
  assert.throws(
    () => normalizeProviderConfig({ kind: 'fastly', bindings: { kv: [] } }, 'fastly'),
    (error) => error.code === 'PULSE_FASTLY_KV_BINDINGS_INVALID'
  );
  assert.throws(
    () => normalizeProviderConfig({ kind: 'fastly', bindings: { backends: 'invalid' } }, 'fastly'),
    (error) => error.code === 'PULSE_FASTLY_BACKEND_BINDINGS_INVALID'
  );
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-cli-guards-'));
  const initializedRoot = path.join(tmpRoot, 'guarded-pulse');
  try {
    parseJson(run(['init', initializedRoot, '--json'], tmpRoot));
    const conflict = parseError(run(['init', initializedRoot, '--json'], tmpRoot));
    assert.equal(conflict.error.code, 'PULSE_INIT_NOT_EMPTY');

    const unsafe = parseError(run(['build', '--out', '..', '--json'], initializedRoot));
    assert.equal(unsafe.error.code, 'PULSE_BUILD_OUT_UNSAFE');
    const unsafeCompile = parseError(run(['compile', '--out', '..', '--json'], initializedRoot));
    assert.equal(unsafeCompile.error.code, 'PULSE_BUILD_OUT_UNSAFE');
    const external = path.join(tmpRoot, 'external');
    fs.mkdirSync(external);
    fs.symlinkSync(external, path.join(initializedRoot, 'linked-output'), 'dir');
    const linked = parseError(run(['build', '--out', './linked-output/dist', '--json'], initializedRoot));
    assert.equal(linked.error.code, 'PULSE_BUILD_OUT_UNSAFE');
    const linkedCompile = parseError(run(['compile', '--out', './linked-output/native', '--json'], initializedRoot));
    assert.equal(linkedCompile.error.code, 'PULSE_BUILD_OUT_UNSAFE');
    assert.equal(fs.existsSync(path.join(external, 'dist')), false);

    const guardRoot = path.join(tmpRoot, 'project-guards');
    fs.mkdirSync(path.join(guardRoot, '.pulse'), { recursive: true });
    fs.mkdirSync(path.join(guardRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(guardRoot, 'tests'), { recursive: true });
    const runtimeSecret = 'runtime-secret-must-not-leak';
    fs.writeFileSync(path.join(guardRoot, 'src', 'index.ts'), `import type { PulseContext, PulseResult } from '@pulse-compute/runtime';
export default async function handler(ctx: PulseContext): Promise<PulseResult> {
  const token = await ctx.secret.get('API_TOKEN');
  const value = await ctx.fetch(\`https://missing.example.test/\${token}\`).json();
  return ctx.json(value);
}
`);
    fs.writeFileSync(path.join(guardRoot, 'tests', 'pulse.harness.ts'), `export default { cases: [{
  name: 'redacted-runtime-error',
  secrets: { API_TOKEN: '${runtimeSecret}' },
  expect: { error: { name: 'FetchNetworkError', code: 'PULSE_FETCH_NETWORK' } },
}] };
`);
    fs.writeFileSync(path.join(guardRoot, '.pulse', 'config.ts'), `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', defaultProfile: 'node', strict: true },
  node: {
    host: 'node',
    target: 'native',
    dev: { secrets: { API_TOKEN: 'must-not-appear-in-cli-json' } },
  },
  fastly: {
    host: 'fastly',
    target: 'native',
    dev: { secrets: { API_TOKEN: 'must-not-appear-in-cli-json' }, networkFetch: false },
    fastly: {
      bindings: {
        secretStore: 'pulse_secrets',
        backends: { 'https://missing.example.test': 'missing_backend' },
        dynamicBackends: false,
      },
      build: { name: 'guarded-fastly' },
    },
  },
}));
`);

    const doctorResult = run(['doctor', '--profile', 'node', '--json'], guardRoot);
    const doctor = parseJson(doctorResult);
    assert.equal(doctor.project.dev.configuredValues.secrets, 1);
    assert.doesNotMatch(doctorResult.stdout, /must-not-appear-in-cli-json/);
    assert.doesNotMatch(doctorResult.stderr, /must-not-appear-in-cli-json/);

    const failureResult = run(['test', '--profile', 'node', '--json'], guardRoot);
    const failure = parseJson(failureResult);
    assert.equal(failure.status, 'passed');
    assert.equal(failure.cases[0].expectedError.detail.url, 'https://missing.example.test/<redacted>');
    assert.doesNotMatch(failureResult.stdout, new RegExp(runtimeSecret));
    assert.doesNotMatch(failureResult.stderr, new RegExp(runtimeSecret));

    const fastlyFailureResult = run(['test', '--profile', 'fastly', '--json'], guardRoot);
    const fastlyFailure = parseJson(fastlyFailureResult);
    assert.equal(fastlyFailure.status, 'passed');
    assert.equal(fastlyFailure.cases[0].expectedError.detail.url, 'https://missing.example.test/<redacted>');
    assert.doesNotMatch(fastlyFailureResult.stdout, new RegExp(runtimeSecret));
    assert.doesNotMatch(fastlyFailureResult.stderr, new RegExp(runtimeSecret));

    const fastlyDoctor = parseJson(run(['doctor', '--profile', 'fastly', '--json'], guardRoot));
    const providerCheck = fastlyDoctor.checks.find((check) => check.id === 'provider');
    assert.equal(providerCheck.status, 'passed');
    assert.equal(providerCheck.detail.package, '@pulse-compute/provider-fastly');
    assert.equal(providerCheck.detail.deployable, true);
    assert.equal(providerCheck.detail.deploymentValidated, false);
    assert.equal(providerCheck.detail.sourcePackage, true);
    assert.equal(providerCheck.detail.compiledWasm, true);
    assert.equal(providerCheck.detail.defaultBuildMode, 'native-provider');
    assert.equal(providerCheck.detail.sourceOnlySupported, false);
    assert.equal(providerCheck.detail.localExecution, true);
    const realizationCheck = fastlyDoctor.checks.find((check) => check.id === 'provider-native-realization');
    assert.equal(realizationCheck.status, 'passed');
    assert.equal(realizationCheck.detail.target, 'fastly-compute-native');
    assert.equal(realizationCheck.detail.javascriptRuntime, false);
    assert.equal(realizationCheck.detail.jsComputeRuntime, false);
    assert.equal(realizationCheck.detail.compiler.package, 'assemblyscript');
    assert.equal(realizationCheck.detail.compiler.version, '0.28.18');

    console.log('ok - pulse CLI guards output containment, secret redaction, init conflicts, and configured native Fastly realization');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

try { main(); } catch (error) { console.error(error && error.stack ? error.stack : error); process.exit(1); }
