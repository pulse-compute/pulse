#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const compilerRoot = path.join(repoRoot, 'wasm/packages/compiler');
const assemblyScriptRoot = path.dirname(require.resolve('assemblyscript/package.json', { paths: [compilerRoot] }));
const asc = path.join(assemblyScriptRoot, 'bin/asc.js');
const jsonAsTransform = require.resolve('json-as', { paths: [compilerRoot] });
const jsonAsRoot = path.resolve(jsonAsTransform, '..', '..', '..');
const jsonAsDependencyRoot = path.dirname(jsonAsRoot);
const jsonAsPackage = JSON.parse(fs.readFileSync(path.join(jsonAsRoot, 'package.json'), 'utf8'));
const assemblyScriptPackage = JSON.parse(fs.readFileSync(path.join(assemblyScriptRoot, 'package.json'), 'utf8'));
const xjbAsPackage = JSON.parse(fs.readFileSync(path.join(jsonAsDependencyRoot, 'xjb-as/package.json'), 'utf8'));
const lock = fs.readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');

assert.equal(assemblyScriptPackage.version, '0.28.18');
assert.equal(jsonAsPackage.version, '1.5.0');
assert.equal(xjbAsPackage.version, '0.1.0');
assert.match(lock, /assemblyscript:\n\s+specifier: 0\.28\.18\n\s+version: 0\.28\.18/);
assert.match(lock, /json-as:\n\s+specifier: 1\.5\.0\n\s+version: 1\.5\.0/);
assert.match(lock, /xjb-as@0\.1\.0:/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-json-as-'));

function compile(input, output, transform) {
  const args = [
    asc,
    input,
    '--outFile', output,
    '--runtime', 'incremental',
    '--exportRuntime',
    '--exportTable',
    '-O3',
    '--path', path.join(compilerRoot, 'node_modules')
  ];
  if (transform) {
    args.push('--transform', jsonAsTransform, '--path', jsonAsDependencyRoot);
  }
  const started = performance.now();
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      JSON_STRICT: 'true',
      JSON_USE_FAST_PATH: '0'
    },
    maxBuffer: 1024 * 1024 * 16
  });
  const durationMs = performance.now() - started;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(output), true);
  return { bytes: fs.statSync(output).size, durationMs };
}

function instantiate(bytes) {
  const module = new WebAssembly.Module(bytes);
  return new WebAssembly.Instance(module, {
    env: {
      abort() { throw new Error('json-as abort'); }
    }
  });
}

try {
  const plainWasm = path.join(temp, 'baseline.wasm');
  const jsonAsWasm = path.join(temp, 'json-as.wasm');
  const plainCompile = compile(
    path.join(repoRoot, 'wasm/test/fixtures/conformance/json-as-plain.ts'),
    plainWasm,
    false
  );
  const jsonAsCompile = compile(
    path.join(repoRoot, 'wasm/test/fixtures/conformance/json-as-compat.ts'),
    jsonAsWasm,
    true
  );
  const bytes = fs.readFileSync(jsonAsWasm);
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), [{ module: 'env', name: 'abort', kind: 'function' }]);
  const instance = instantiate(bytes);
  assert.equal(instance.exports.valid_roundtrip(), 1);
  assert.equal(instance.exports.missing_required_defaults(), 1, 'json-as alone defaults a missing required field');
  assert.equal(instance.exports.non_finite_encode_extension(), 1, 'json-as alone can serialize NaN as a non-RFC extension');
  assert.throws(() => instance.exports.unknown_field(), /json-as abort|unreachable/, 'JSON_STRICT rejects unknown keys instead of Pulse drop semantics');

  const decodeInstance = instantiate(bytes);
  assert.throws(() => decodeInstance.exports.non_finite_extension(), /json-as abort|unreachable/);

  const coldStarts = [];
  for (let index = 0; index < 20; index += 1) {
    const start = performance.now();
    instantiate(bytes);
    coldStarts.push(performance.now() - start);
  }
  const sorted = [...coldStarts].sort((left, right) => left - right);
  const medianColdStartMs = sorted[Math.floor(sorted.length / 2)];
  assert.ok(jsonAsCompile.bytes > 0 && plainCompile.bytes > 0);
  assert.ok(Number.isFinite(medianColdStartMs) && medianColdStartMs >= 0);

  const publicPulseFiles = [
    path.join(repoRoot, 'packages/pulse/src/index.js'),
    path.join(repoRoot, 'packages/pulse/src/index.d.ts'),
    path.join(repoRoot, 'packages/pulse/src/schema.js'),
    path.join(repoRoot, 'packages/pulse/src/schema.d.ts')
  ];
  const publicText = publicPulseFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(publicText, /from ['"]json-as['"]|require\\(['"]json-as['"]\\)|@json\b/);

  const measurement = {
    assemblyScript: assemblyScriptPackage.version,
    jsonAs: jsonAsPackage.version,
    xjbAs: xjbAsPackage.version,
    strictTransformCompiled: true,
    moduleBytes: {
      plain: plainCompile.bytes,
      jsonAs: jsonAsCompile.bytes,
      delta: jsonAsCompile.bytes - plainCompile.bytes
    },
    compileMs: {
      plain: Number(plainCompile.durationMs.toFixed(3)),
      jsonAs: Number(jsonAsCompile.durationMs.toFixed(3))
    },
    medianColdStartMs: Number(medianColdStartMs.toFixed(6)),
    semanticGate: {
      unknownInputFields: 'pulse-preflight-drop-required',
      missingRequiredFields: 'pulse-presence-guard-required',
      nonFiniteEncode: 'pulse-finite-number-guard-required',
      failures: 'pulse-structured-nontrapping-adapter-required',
      backendRequiresPulseGuards: true
    },
    automaticFallback: false,
    fullCodecRealization: true
  };
  console.log(JSON.stringify(measurement));
  console.log('ok - pinned json-as compatibility and required Pulse semantic guards');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
