#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { repoRoot, run, parseJson, parseError } = require('./helpers.cjs');

function canonicalPath(file) {
  return fs.realpathSync.native(file);
}

function assertSamePath(actual, expected, message) {
  assert.equal(canonicalPath(actual), canonicalPath(expected), message);
}

function canonicalWasmSurface(entries) {
  return entries
    .map((entry) => [entry.module || '', entry.name, entry.kind].join(':'))
    .sort();
}

async function main() {
  const help = run(['build', '--help'], repoRoot);
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /pulse init/);
  assert.match(help.stdout, /pulse doctor/);
  assert.match(help.stdout, /pulse compile/);
  assert.doesNotMatch(help.stdout, /--source-only/);
  assert.doesNotMatch(help.stdout, /--provider/);
  assert.doesNotMatch(help.stdout, /--project|--workspace|--entry|--config|--suite-/);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-cli-project-'));
  const projectRoot = path.join(tmpRoot, 'hello-pulse');
  try {
    const initialized = parseJson(run(['init', projectRoot, '--json'], tmpRoot));
    assert.equal(initialized.status, 'initialized');
    assert.deepEqual(initialized.files, [
      '.gitignore',
      '.pulse/.gitignore',
      '.pulse/config.ts',
      'README.md',
      'package.json',
      'src/index.ts',
      'tests/pulse.harness.ts',
      'tsconfig.json'
    ]);
    for (const file of initialized.files) {
      assert.ok(fs.existsSync(path.join(projectRoot, file)), `pulse init should create ${file}`);
    }

    const doctor = parseJson(run(['doctor', '--json'], projectRoot));
    assert.equal(doctor.status, 'passed');
    assert.equal(doctor.summary.failed, 0);
    const nodeVersion = doctor.checks.find((check) => check.id === 'node-version');
    assert.equal(nodeVersion.status, 'passed');
    assert.deepEqual(nodeVersion.detail, {
      engines: '^22.14.0 || ^24.0.0',
      minimumVersion: '22.14.0',
      sealRange: '^24.0.0',
      reproducibleToolchainVersion: '24.18.0'
    });
    assert.ok(doctor.checks.some((check) => check.id === 'canonical-compile' && check.status === 'passed'));
    assert.ok(doctor.checks.some((check) => check.id === 'canonical-native-plan' && check.status === 'passed'));
    assert.ok(doctor.checks.some((check) => check.id === 'canonical-native-wasm' && check.status === 'passed'));
    assert.ok(doctor.checks.some((check) => check.id === 'provider-native-realization' && check.status === 'passed'));

    const tested = parseJson(run(['test', '--json'], projectRoot));
    assert.equal(tested.status, 'passed');
    assert.deepEqual(tested.summary, { total: 1, passed: 1, failed: 0 });
    const oneCase = parseJson(run(['test', '--case', 'health', '--json'], projectRoot));
    assert.equal(oneCase.cases.length, 1);
    assert.equal(oneCase.cases[0].name, 'health');

    const inspected = parseJson(run(['inspect', '--json'], projectRoot));
    assert.equal(inspected.status, 'ok');
    assert.equal(inspected.project.provider, 'node');
    assert.equal(inspected.compiler.file, 'src/index.ts');
    assert.deepEqual(inspected.compiler.capabilities, ['response.json', 'response.text']);
    assert.equal(inspected.compiler.native.target, 'portable-native-wasm');
    assert.equal(inspected.compiler.native.providerNeutral, true);
    assert.deepEqual(inspected.compiler.native.importModules, ['pulse_host']);
    assert.ok(inspected.compiler.native.wasm.bytes > 0 && inspected.compiler.native.wasm.bytes < 100000);
    const nestedInspect = parseJson(run(['inspect', '--json'], path.join(projectRoot, 'src')));
    assertSamePath(nestedInspect.project.root, projectRoot, 'config discovery should walk upward');
    assertSamePath(nestedInspect.project.configFile, path.join(projectRoot, '.pulse', 'config.ts'), 'config discovery should select the parent project configuration');

    const linkedProjectRoot = path.join(tmpRoot, 'hello-pulse-link');
    fs.symlinkSync(projectRoot, linkedProjectRoot, process.platform === 'win32' ? 'junction' : 'dir');
    const linkedInspect = parseJson(run(['inspect', '--json'], path.join(linkedProjectRoot, 'src')));
    assertSamePath(linkedInspect.project.root, projectRoot, 'config discovery should preserve project identity through a symlinked working tree');
    assertSamePath(linkedInspect.project.configFile, path.join(projectRoot, '.pulse', 'config.ts'), 'symlinked config discovery should select the physical parent configuration');

    const nativeOut = path.join(projectRoot, 'native-dist');
    const nativeCompile = parseJson(run(['compile', '--out', nativeOut, '--json'], projectRoot));
    assert.equal(nativeCompile.status, 'compiled');
    assert.equal(nativeCompile.target, 'portable-native-wasm');
    assert.equal(nativeCompile.provider, null);
    assert.equal(nativeCompile.providerNeutral, true);
    assert.equal(nativeCompile.configuredProvider, 'node');
    for (const file of [
      'canonical-program.json',
      'canonical-handler.cjs',
      'canonical-native-plan.json',
      'canonical-native.as.ts',
      'canonical-native.wasm',
      'canonical-native-manifest.json',
      'pulse-compile.json'
    ]) {
      assert.ok(fs.existsSync(path.join(nativeOut, file)), `pulse compile should create ${file}`);
    }
    const nativeManifest = JSON.parse(fs.readFileSync(path.join(nativeOut, 'pulse-compile.json'), 'utf8'));
    assert.equal(nativeManifest.provider, null);
    assert.equal(nativeManifest.providerNeutral, true);
    assert.equal(nativeManifest.configuredProvider, 'node');
    assert.equal(nativeManifest.native.planHash, nativeCompile.native.planHash);
    assert.deepEqual(nativeManifest.native.importModules, ['pulse_host']);
    assert.equal(nativeManifest.native.wasm.magic, '0061736d01000000');
    const nativeBytes = fs.readFileSync(path.join(nativeOut, 'canonical-native.wasm'));
    assert.equal(WebAssembly.validate(nativeBytes), true);
    assert.equal(nativeManifest.native.wasm.bytes, nativeBytes.length);
    assert.equal(nativeManifest.native.wasm.sha256, crypto.createHash('sha256').update(nativeBytes).digest('hex'));
    const nativeFirstHash = nativeManifest.native.wasm.sha256;
    assert.deepEqual(nativeManifest.native.wat, { file: null, emitted: false, bytes: 0, sha256: null });
    assert.equal(fs.existsSync(path.join(nativeOut, 'canonical-native.wat')), false);
    const withText = parseJson(run(['compile', '--out', nativeOut, '--emit-wat', '--json'], projectRoot));
    assert.equal(withText.manifest.native.wat.emitted, true);
    assert.equal(withText.manifest.native.wasm.sha256, nativeFirstHash);
    assert.ok(fs.readFileSync(path.join(nativeOut, 'canonical-native.wat'), 'utf8').startsWith('(module'));
    const withoutText = parseJson(run(['compile', '--out', nativeOut, '--no-clean', '--json'], projectRoot));
    assert.equal(withoutText.manifest.native.wat.emitted, false);
    assert.equal(fs.existsSync(path.join(nativeOut, 'canonical-native.wat')), false);
    const nativeSecond = parseJson(run(['compile', '--out', nativeOut, '--json'], projectRoot));
    assert.equal(nativeSecond.manifest.native.wasm.sha256, nativeFirstHash, 'pulse compile must be deterministic');
    const expectedNativeSizeOptimization = {
      version: 'pulse.native-optimization.v1',
      mode: 'experimental-native-size',
      experimental: true,
      goal: 'size',
      assemblyScript: {
        optimize: true,
        optimizeLevel: 3,
        shrinkLevel: 2,
        converge: true
      }
    };
    const experimentalNativeOut = path.join(projectRoot, 'native-dist-experimental');
    const experimentalNative = parseJson(run([
      'compile',
      '--out', experimentalNativeOut,
      '--experimental-native-size',
      '--json'
    ], projectRoot));
    assert.deepEqual(experimentalNative.native.optimization, expectedNativeSizeOptimization);
    assert.deepEqual(experimentalNative.manifest.native.optimization, expectedNativeSizeOptimization);
    assert.ok(
      experimentalNative.native.wasm.bytes < nativeCompile.native.wasm.bytes,
      'the compiler-owned experimental size profile should reduce the representative portable Native module'
    );
    assert.deepEqual(
      canonicalWasmSurface(experimentalNative.manifest.native.imports),
      canonicalWasmSurface(nativeCompile.manifest.native.imports),
      'experimental size optimization must preserve the portable host import surface'
    );
    assert.deepEqual(
      canonicalWasmSurface(experimentalNative.manifest.native.exports),
      canonicalWasmSurface(nativeCompile.manifest.native.exports),
      'experimental size optimization must preserve the portable export surface'
    );
    const boundedNativeOut = path.join(projectRoot, 'native-dist-bounded');
    const boundedNative = parseJson(run(['compile', '--out', boundedNativeOut, '--experimental-native-bounded-size', '--json'], projectRoot));
    const expectedBounded = { ...expectedNativeSizeOptimization, mode: 'experimental-native-bounded-size', assemblyScript: { ...expectedNativeSizeOptimization.assemblyScript, converge: false } };
    assert.deepEqual(boundedNative.native.optimization, expectedBounded);
    assert.equal(WebAssembly.validate(fs.readFileSync(path.join(boundedNativeOut, 'canonical-native.wasm'))), true);
    const compileProviderOverride = parseError(run(['compile', '--provider', 'fastly', '--json'], projectRoot));
    assert.equal(compileProviderOverride.error.code, 'PULSE_PROVIDER_FLAG_REMOVED');

    const built = parseJson(run(['build', '--json'], projectRoot));
    assert.equal(built.status, 'built');
    for (const file of ['canonical-program.json', 'canonical-handler.cjs', 'canonical-native-plan.json', 'canonical-native.wasm', 'pulse-build.json']) {
      assert.ok(fs.existsSync(path.join(projectRoot, 'dist', file)), `pulse build should create dist/${file}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'dist', 'pulse-build.json'), 'utf8'));
    assert.equal(manifest.provider, 'node');
    assert.equal(manifest.buildMode, 'native-provider');
    assert.equal(manifest.providerTarget.target, 'node-native-host');
    assert.equal(manifest.providerTarget.javascriptRuntime, false);
    assert.equal(manifest.portable.providerNeutral, true);
    assert.equal(manifest.project.entry, 'src/index.ts');
    const experimentalBuilt = parseJson(run([
      'build',
      '--out', 'dist-experimental',
      '--experimental-native-size',
      '--json'
    ], projectRoot));
    assert.deepEqual(experimentalBuilt.manifest.providerTarget.optimization, expectedNativeSizeOptimization);
    assert.deepEqual(experimentalBuilt.manifest.portable.optimization, expectedNativeSizeOptimization);
    const boundedBuilt = parseJson(run(['build', '--out', 'dist-bounded', '--experimental-native-bounded-size', '--json'], projectRoot));
    assert.deepEqual(boundedBuilt.manifest.portable.optimization, expectedBounded);
    assert.deepEqual(boundedBuilt.manifest.providerTarget.optimization, expectedBounded);
    const boundedPlan = parseJson(run(['build', '--experimental-native-bounded-size', '--dry-run', '--json'], projectRoot));
    assert.equal(boundedPlan.plan.optimization.mode, 'experimental-native-bounded-size');
    const experimentalPlan = parseJson(run(['build', '--experimental-native-size', '--dry-run', '--json'], projectRoot));
    assert.deepEqual(experimentalPlan.plan.optimization, {
      mode: 'experimental-native-size',
      experimental: true,
      goal: 'size',
      owner: 'native-compiler'
    });
    const artifact = parseJson(run(['inspect', '--artifact', path.join(projectRoot, 'dist', 'pulse-build.json'), '--json'], projectRoot));
    assert.equal(artifact.value.provider, 'node');

    const removedEntry = parseError(run(['inspect', '--entry', './src/alternate.ts', '--json'], projectRoot));
    assert.equal(removedEntry.error.code, 'PULSE_ARGUMENT_UNEXPECTED');

    const projectConfig = path.join(projectRoot, '.pulse', 'config.ts');
    fs.writeFileSync(projectConfig, fs.readFileSync(projectConfig, 'utf8').replace(
      '\n}));\n',
      "\n  'compile-only': { host: 'none', target: 'native', outDir: 'compile-only-dist' },\n  javascript: { host: 'node', target: 'javascript', outDir: 'javascript-dist' },\n}));\n"
    ));
    const compileOnly = parseJson(run(['compile', '--profile', 'compile-only', '--json'], projectRoot));
    assert.equal(compileOnly.provider, null);
    const compileOnlyExperimental = parseJson(run([
      'compile',
      '--profile', 'compile-only',
      '--out', 'compile-only-experimental-dist',
      '--experimental-native-size',
      '--json'
    ], projectRoot));
    assert.deepEqual(compileOnlyExperimental.native.optimization, expectedNativeSizeOptimization);
    const noneBuild = parseError(run(['build', '--profile', 'compile-only', '--json'], projectRoot));
    assert.equal(noneBuild.error.code, 'PULSE_BUILD_PROVIDER_REQUIRED');
    const noneTest = parseError(run(['test', '--profile', 'compile-only', '--json'], projectRoot));
    assert.equal(noneTest.error.code, 'PULSE_TEST_PROVIDER_REQUIRED');
    const nodeSourceOnly = parseError(run(['build', '--source-only', '--json'], projectRoot));
    assert.equal(nodeSourceOnly.error.code, 'PULSE_SOURCE_ONLY_REMOVED');
    const testSourceOnly = parseError(run(['test', '--source-only', '--json'], projectRoot));
    assert.equal(testSourceOnly.error.code, 'PULSE_SOURCE_ONLY_REMOVED');
    const javascriptExperimental = parseError(run([
      'build',
      '--profile', 'javascript',
      '--experimental-native-size',
      '--json'
    ], projectRoot));
    assert.equal(javascriptExperimental.error.code, 'PULSE_EXPERIMENTAL_NATIVE_SIZE_UNSUPPORTED');
    const javascriptBounded = parseError(run(['build', '--profile', 'javascript', '--experimental-native-bounded-size', '--json'], projectRoot));
    assert.equal(javascriptBounded.error.code, 'PULSE_EXPERIMENTAL_NATIVE_SIZE_UNSUPPORTED');
    for (const planningFlags of [[], ['--dry-run']]) {
      const javascriptText = parseError(run([
        'build', '--profile', 'javascript', '--emit-wat', ...planningFlags, '--json'
      ], projectRoot));
      assert.equal(javascriptText.error.code, 'PULSE_NATIVE_TEXT_UNSUPPORTED');
    }
    const textPlan = parseJson(run(['compile', '--emit-wat', '--dry-run', '--json'], projectRoot));
    assert.deepEqual(textPlan.plan.textArtifacts, { wat: true });

    const parityRoot = path.join(tmpRoot, 'provider-parity');
    fs.mkdirSync(path.join(parityRoot, '.pulse'), { recursive: true });
    fs.mkdirSync(path.join(parityRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(parityRoot, 'tests'), { recursive: true });
    const paritySource = path.join(parityRoot, 'src', 'index.ts');
    fs.writeFileSync(paritySource, `import type { PulseContext, PulseResult } from '@pulse-compute/runtime';
export default async function handler(ctx: PulseContext): Promise<PulseResult> {
  const apiBase = await ctx.config.get('API_BASE');
  const token = await ctx.secret.get('API_TOKEN');
  const session = await ctx.kv('sessions').get('session:1');
  const user = await ctx.fetch(\`\${apiBase}/users/1\`, { headers: { authorization: \`Bearer \${token}\` } }).json();
  await ctx.kv('sessions').put('session:last', session);
  return ctx.json({ session, user });
}
`);
    const parityHarness = path.join(parityRoot, 'tests', 'pulse.harness.ts');
    fs.writeFileSync(parityHarness, `export default {
  cases: [
    {
      name: 'provider-parity',
      config: { API_BASE: 'https://api.example.test' },
      secrets: { API_TOKEN: 'cli-provider-secret' },
      kv: { sessions: { 'session:1': { id: 1 } } },
      fetches: { 'https://api.example.test/users/1': { status: 200, value: { id: 1, name: 'Ada' } } },
      expect: { status: 200, json: { session: { id: 1 }, user: { id: 1, name: 'Ada' } } },
    },
  ],
};
`);
    fs.writeFileSync(path.join(parityRoot, '.pulse', 'config.ts'), `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((scope) => ({
  pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', defaultProfile: 'node', strict: true },
  node: { host: 'node', target: 'native', outDir: 'node-provider-dist', apiBase: scope.config('API_BASE'), apiToken: scope.secret('API_TOKEN') },
  fastly: {
    host: 'fastly',
    target: 'native',
    outDir: 'fastly-provider-dist',
    apiBase: scope.config('API_BASE'),
    apiToken: scope.secret('API_TOKEN'),
    fastly: {
      bindings: {
        configStore: 'app_config',
        secretStore: 'app_secrets',
        kv: { sessions: 'app_sessions' },
        backends: { 'https://api.example.test': 'users_backend' },
        dynamicBackends: false,
      },
      build: { name: 'provider-parity' },
    },
  },
}));
`);
    const parityRunOptions = { timeout: 120000 };
    const nodeParityInspect = parseJson(run(['inspect', '--profile', 'node', '--json'], parityRoot, parityRunOptions));
    const fastlyParityInspect = parseJson(run(['inspect', '--profile', 'fastly', '--json'], parityRoot, parityRunOptions));
    assert.equal(nodeParityInspect.compiler.sourceHash, fastlyParityInspect.compiler.sourceHash, 'provider selection must not change canonical source');
    assert.equal(nodeParityInspect.compiler.providerLowering.provider, 'node');
    assert.equal(fastlyParityInspect.compiler.providerLowering.provider, 'fastly');
    assert.deepEqual(fastlyParityInspect.compiler.providerLowering.requirements, ['config.get', 'fetch', 'kv.get', 'kv.put', 'response.json', 'secret.get']);
    assert.equal(fastlyParityInspect.compiler.providerLowering.operations.find((entry) => entry.kind === 'config').binding, 'app_config');
    assert.equal(fastlyParityInspect.compiler.providerLowering.operations.find((entry) => entry.kind === 'secret').binding, 'app_secrets');
    assert.ok(fastlyParityInspect.compiler.providerLowering.operations.filter((entry) => entry.kind === 'kv').every((entry) => entry.binding === 'app_sessions'));
    const nodeParityTest = parseJson(run(['test', '--profile', 'node', '--json'], parityRoot, parityRunOptions));
    const fastlyParityTest = parseJson(run(['test', '--profile', 'fastly', '--json'], parityRoot, parityRunOptions));
    assert.equal(nodeParityTest.status, 'passed');
    assert.equal(fastlyParityTest.status, 'passed');
    assert.deepEqual(nodeParityTest.cases[0].response, fastlyParityTest.cases[0].response);
    const nodeParityBuild = parseJson(run(['build', '--profile', 'node', '--json'], parityRoot, parityRunOptions));
    assert.equal(nodeParityBuild.manifest.program.sourceHash, fastlyParityInspect.compiler.sourceHash);
    assert.equal(fastlyParityInspect.compiler.providerLowering.provider, 'fastly');
    assert.equal(fastlyParityInspect.compiler.providerLowering.buildTarget, 'fastly-compute');
    assert.equal(fastlyParityInspect.compiler.providerLowering.deployable, true);
    assert.equal(fastlyParityInspect.compiler.providerLowering.providerSpecificUserland, false);

    const fastlyTextBuild = parseJson(run(['build', '--profile', 'fastly', '--emit-wat', '--json'], parityRoot, parityRunOptions));
    assert.equal(fastlyTextBuild.manifest.portable.wat.emitted, true);
    assert.equal(fastlyTextBuild.manifest.providerTarget.wat.emitted, true);
    const fastlyWat = path.join(parityRoot, 'fastly-provider-dist', 'bin', 'main.wat');
    assert.ok(fs.readFileSync(fastlyWat, 'utf8').startsWith('(module'));
    const fastlyWithoutText = parseJson(run(['build', '--profile', 'fastly', '--no-clean', '--json'], parityRoot, parityRunOptions));
    assert.deepEqual(fastlyWithoutText.manifest.providerTarget.wat, { file: null, emitted: false, bytes: 0, sha256: null });
    assert.equal(fastlyWithoutText.manifest.providerTarget.wasm.sha256, fastlyTextBuild.manifest.providerTarget.wasm.sha256);
    assert.equal(fs.existsSync(fastlyWat), false);

    const storageRoot = require('./storage-fixture.cjs').storageFixture(path.join(tmpRoot, 'storage'));
    for (const profile of ['local', 'javascript', 'fastly']) {
      const storage = parseJson(run(['test', '--profile', profile, '--json'], storageRoot, parityRunOptions));
      assert.deepEqual(storage.summary, { total: 3, passed: 3, failed: 0 });
      if (profile === 'fastly') {
        for (const entry of storage.cases) {
          assert.equal(entry.executionEvidence.kind, 'fastly-native-fixture-abi');
          assert.equal(entry.executionEvidence.providerRealityValidated, false);
          assert.match(entry.executionEvidence.wasmSha256, /^[a-f0-9]{64}$/);
          assert.equal(entry.effects, null, 'ABI fixtures must not fabricate canonical effect telemetry');
        }
      }
    }
    // A KV-only project must select the provider's Native executor independently
    // of S3's guest-source crypto requirements.
    const storageSource = path.join(storageRoot, 'src/index.ts');
    fs.writeFileSync(storageSource, fs.readFileSync(storageSource, 'utf8')
      .replace(/import \{ s3 \}[^\n]+\n/, '')
      .replace(/app.post\('\/objects'[\s\S]+?(?=export default app)/, ''));
    const kvOnly = parseJson(run(['test', '--profile', 'fastly', '--case', 'conditional KV consumer', '--json'], storageRoot, parityRunOptions));
    assert.deepEqual(kvOnly.summary, { total: 1, passed: 1, failed: 0 });
    assert.equal(kvOnly.cases[0].executionEvidence.kind, 'fastly-native-fixture-abi');

    const fastlyInitRoot = path.join(tmpRoot, 'fastly-pulse');
    const fastlyInit = parseError(run(['init', fastlyInitRoot, '--provider', 'fastly', '--json'], tmpRoot));
    assert.equal(fastlyInit.error.code, 'PULSE_PROVIDER_FLAG_REMOVED');

    const suiteControl = parseError(run(['test', '--suite-task', 'suite-shape', '--json'], projectRoot));
    assert.equal(suiteControl.error.code, 'PULSE_ARGUMENT_UNEXPECTED');

    const missing = path.join(tmpRoot, 'not-a-project');
    fs.mkdirSync(missing);
    const missingDoctor = parseError(run(['doctor', '--json'], missing));
    assert.equal(missingDoctor.error.code, 'PULSE_CONFIG_NOT_FOUND');

    console.log('ok - pulse CLI drives configured Node builds, inspects and tests Fastly lowering parity, keeps compile provider-neutral, and rejects removed provider/source-only flags');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (error) => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
