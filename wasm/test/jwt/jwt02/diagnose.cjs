'use strict';

// JWT-02.1: observe unmodified production builds and isolated initialization
// experiments. Experimental modules never enter the product build/link path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { acceptanceToolchain } = require('../../s3/acceptance-toolchain.cjs');
const { writeControl } = require('../../qualification/stab03/fixture.cjs');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const { packageLoweringForCanonicalNativePlan } = require('../../../packages/compiler/src/spine/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-compiler');
const { generateCanonicalNativeAssemblyScript } = require('../../../packages/runtime-core-as/src/compiler/canonical-native');
const { CANONICAL_NATIVE_FINAL_WASM_POLICY } = require('../../../packages/contracts/src/handler/canonical-native-runtime');
const { inspectWasmFile } = require('../../../packages/wasm-guest-link/src/inspect');
const { memoryAbiV2 } = require('../../../packages/wasm-guest-link/src/constants');
const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile');
const { appendAssemblyScriptOptimizationArgs } = require('../../../packages/build-support/src/native-optimization');
const fastly = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const fastlyDriver = require('../../../../packages/provider-fastly/src/toolchain').createDriver();
const { executeFastlyNativePlatformCapabilities } = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');

const repo = path.resolve(__dirname, '../../../..');
const fixedRuntime = path.join(repo, 'packages/provider-fastly/src/build/fixed-memory-runtime.as');
const compilerRoot = path.join(repo, 'wasm/packages/compiler');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const synchronizedPackages = require('../../../packages/cli/release-manifest.json').packages.map(({ name, version }) => ({ name, version }));
const tc = acceptanceToolchain();

function observation(file, directory, label) {
  const inspected = inspectWasmFile(file, { workDirectory: directory, label });
  return { sha256: inspected.sha256, bytes: inspected.bytes, hasStart: inspected.hasStart,
    memoryTypes: inspected.memoryTypes, instructions: inspected.instructions,
    dataBytes: inspected.dataBytes, dataEndExclusive: Math.max(...inspected.dataSegments.map(s => s.endExclusive)) };
}

function experiment(directory, kind, runtime) {
  const asc = resolveAsc(compilerRoot);
  const file = path.join(directory, `experiment-${runtime}.wasm`);
  let sourceFile = 'source.as.ts';
  if (runtime === 'fixed-demand') {
    const original = fs.readFileSync(path.join(directory, sourceFile), 'utf8');
    const declaration = '@lazy const __pulse_crypto_digest_frame = new Uint8Array(2097152 + 32)';
    const accessor = 'return <i32>__pulse_crypto_digest_frame.dataStart';
    assert(original.includes(declaration) && original.includes(accessor));
    sourceFile = 'experiment-demand.as.ts';
    fs.writeFileSync(path.join(directory, sourceFile), original
      .replace(declaration, 'let __pulse_crypto_digest_frame: Uint8Array | null = null')
      .replace(accessor, 'if (__pulse_crypto_digest_frame === null) __pulse_crypto_digest_frame = new Uint8Array(2097152 + 32)\n  return <i32>__pulse_crypto_digest_frame!.dataStart'));
  }
  const args = [asc.script, sourceFile, '--outFile', file, '--runtime',
    runtime !== 'standard' ? fixedRuntime : kind === 'schema' ? 'incremental' : 'stub',
    '--noAssert', '--optimize', '--disable', 'bulk-memory', '--disable', 'nontrapping-f2i',
    '--disable', 'sign-extension', '--importMemory', '--noExportMemory',
    '--initialMemory', '32', '--maximumMemory', '32', '--memoryBase', '262144',
    '--exportStart', '__jwt02_initialize'];
  appendAssemblyScriptOptimizationArgs(args, undefined, { guestLinked: true });
  if (kind === 'schema') {
    const transform = require.resolve('json-as', { paths: [compilerRoot] });
    args.push('--exportRuntime', '--transform', transform, '--path', path.join(compilerRoot, 'node_modules'),
      '--path', path.dirname(path.resolve(transform, '../../..')));
  }
  const result = spawnSync(asc.executable, args, { cwd: directory, encoding: 'utf8', timeout: 120000,
    maxBuffer: 4 * 1024 * 1024, env: { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0', JSON_MODE: 'NAIVE' } });
  assert.equal(result.status, 0, result.stderr);
  const inspected = observation(file, directory, `experiment-${runtime}`);
  const memory = new WebAssembly.Memory({ initial: 32, maximum: 32 });
  const module = new WebAssembly.Module(fs.readFileSync(file));
  const imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    imports[entry.module] ||= {};
    // Initializer probes only: no signature/host operation is executed here.
    imports[entry.module][entry.name] = entry.kind === 'memory' ? memory
      : () => { throw new Error('unexpected initializer host call'); };
  }
  const instance = new WebAssembly.Instance(module, imports);
  const frame = memoryAbiV2.layout.invocationFrame;
  const bytes = new Uint8Array(memory.buffer);
  bytes.fill(0xa5, frame.start, frame.endExclusive);
  let status = 'initialized';
  try { instance.exports.__jwt02_initialize(); } catch (error) {
    assert(error instanceof WebAssembly.RuntimeError, 'initializer must not call a host or signature import');
    status = 'trapped';
  }
  const changed = bytes.subarray(frame.start, frame.endExclusive).reduce((n, byte) => n + (byte !== 0xa5), 0);
  assert.equal(inspected.hasStart, false);
  assert.equal(inspected.instructions.memoryGrow, runtime !== 'standard' ? 0 : kind === 'schema' ? 3 : 2);
  assert.equal(status, kind === 'mac' && runtime !== 'fixed-demand' ? 'trapped' : 'initialized');
  assert.equal(changed, kind === 'schema' && runtime === 'standard' ? frame.endExclusive - frame.start : 0);
  if (runtime === 'fixed-demand') assert.throws(() => instance.exports.pulse_crypto_digest_frame_v1(), WebAssembly.RuntimeError,
    'deferring the oversized frame does not make a large digest fit');
  return { kind, runtime, ...inspected, initialization: status, signatureFrameChangedBytes: changed,
    ...(runtime === 'fixed-demand' ? { largeDigestAllocation: 'trapped', sourceMutation: 'experiment-only runtime-deferred digest buffer' } : {}),
    authority: 'isolated initializer probe; not linked, admitted or executable application evidence' };
}

function main() {
  assert(process.argv.length === 2 || process.argv.length === 4 && process.argv[2] === '--out', 'usage: diagnose.cjs [--out NEW_DIRECTORY]');
  const retained = process.argv.length === 4;
  const output = retained ? path.resolve(process.argv[3]) : fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt02-'));
  if (retained) fs.mkdirSync(output);
  const root = path.join(output, 'consumer');
  const cases = [], experiments = [];
  try {
    fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), { recursive: true });
    const names = ['pulse', 'runtime', 'crypto', 'jwt', 'provider-node'];
    for (const name of names) fs.symlinkSync(path.join(repo, 'packages', name), path.join(root, 'node_modules/@pulse-compute', name), 'dir');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'jwt02-generic-consumer', private: true,
      dependencies: Object.fromEntries(names.map(name => [`@pulse-compute/${name}`, require(path.join(repo, 'packages', name, 'package.json')).version])) }));
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture' };
    const now = 1700000000;
    const signingInput = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url') + '.'
      + Buffer.from(JSON.stringify({ sub: 'reader', iat: now - 60, exp: now + 600 })).toString('base64url');
    const bearer = 'Bearer ' + signingInput + '.' + crypto.sign('sha256', Buffer.from(signingInput), pair.privateKey).toString('base64url');
    const secret = crypto.randomBytes(32).toString('hex');
    for (const kind of ['baseline', 'mac', 'schema', 'combined']) {
      fs.rmSync(path.join(root, 'schemas.ts'), { force: true });
      writeControl(root, jwk, kind === 'combined' ? 'schema' : kind);
      if (kind === 'combined') {
        const app = path.join(root, 'app.ts');
        fs.writeFileSync(app, fs.readFileSync(app, 'utf8').replace('const time=',
          "const proof=await crypto.verifyMacText(ctx,ctx.req.url,ctx.req.header('x-proof')||'',{algorithm:'HS256',key:{type:'secret',binding:'INGRESS_KEY'}});if(proof.status!=='valid')return ctx.text('invalid');const time="));
        const config = path.join(root, '.pulse/config.ts');
        fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('"crypto":["RS256"]', '"crypto":["RS256","HS256"]'));
      }
      const compiled = tc.compileProject(tc.resolveProject({ cwd: root, profile: 'node-native' }));
      const plan = buildCanonicalNativePlan(compiled);
      const directory = path.join(output, kind); fs.mkdirSync(directory);
      const source = generateCanonicalNativeAssemblyScript(plan).source;
      fs.writeFileSync(path.join(directory, 'source.as.ts'), source);
      fs.copyFileSync(path.join(root, 'app.ts'), path.join(directory, 'app.ts'));
      let canonical;
      try {
        const native = compileCanonicalNativePlan(plan, { cwd: root, outDir: directory, emitWat: true, synchronizedPackages,
          targetDescriptor: { finalWasmPolicy: CANONICAL_NATIVE_FINAL_WASM_POLICY } });
        assert.equal(kind, 'baseline', 'update characterization after the production fix is independently qualified');
        canonical = { status: 'built', sha256: hash(native.wasm), bytes: native.wasm.length };
      } catch (error) {
        assert.notEqual(kind, 'baseline');
        assert.equal(error.code, 'PULSE_GUEST_UNIT_START_MISMATCH');
        canonical = { status: 'blocked', code: error.code, message: error.message };
      }
      const primary = observation(path.join(directory, 'canonical-native.wasm'), directory, 'primary');
      assert.equal(primary.hasStart, kind !== 'baseline');
      assert.equal(primary.instructions.memoryGrow, kind === 'baseline' ? 0 : kind === 'mac' ? 2 : 3);
      assert(primary.dataEndExclusive <= memoryAbiV2.layout.primaryStatic.endExclusive);
      const provider = fastly.compileFastlyNativePlatformCapabilitiesPlan(plan, {
        ...packageLoweringForCanonicalNativePlan(plan), cwd: root, canonicalBuild: true, synchronizedPackages,
        targetDescriptor: fastlyDriver.targets.native, requirePlatformCapability: false, bindings: { secretStore: 'fixture_secrets' }
      });
      const providerFile = path.join(directory, 'fastly.wasm'); fs.writeFileSync(providerFile, provider.wasm);
      const final = observation(providerFile, directory, 'fastly');
      assert.equal(final.hasStart, false); assert.equal(final.instructions.memoryGrow, 0);
      const url = 'https://generic.test/';
      const request = { method: 'GET', path: '/', url, headers: [['authorization', bearer],
        ['x-proof', crypto.createHmac('sha256', secret).update(url).digest('hex')]], body: '' };
      const execute = artifact => {
        const hostcalls = [];
        try {
          const response = executeFastlyNativePlatformCapabilities(artifact, { request, secrets: { INGRESS_KEY: secret },
            secretStore: 'fixture_secrets', clockUnixSeconds: now,
            afterHostcall: ({ module, name }) => { hostcalls.push(`${module}.${name}`); } }).response;
          return { status: 'returned', httpStatus: response.status, body: response.body, hostcalls };
        } catch (error) { return { status: 'trapped', errorType: error.name, hostcalls }; }
      };
      const execution = execute(provider);
      if (kind === 'baseline') assert.deepEqual({ ...execution, hostcalls: [] }, { status: 'returned', httpStatus: 200, body: 'reader', hostcalls: [] });
      else assert.deepEqual(execution, { status: 'trapped', errorType: 'RuntimeError', hostcalls: [] });
      let cacheElision;
      if (kind === 'schema') {
        const elided = fastly.compileFastlyNativePlatformCapabilitiesPlan(plan, {
          ...packageLoweringForCanonicalNativePlan(plan), cwd: root, canonicalBuild: true, synchronizedPackages,
          targetDescriptor: fastlyDriver.targets.native, requirePlatformCapability: false,
          bindings: { secretStore: 'fixture_secrets' }, elideJsonCacheArena: true
        });
        const elidedFile = path.join(directory, 'fastly-cache-elided.wasm');
        fs.writeFileSync(elidedFile, elided.wasm);
        const elidedInspection = observation(elidedFile, directory, 'fastly-cache-elided');
        assert.equal(elidedInspection.hasStart, false); assert.equal(elidedInspection.instructions.memoryGrow, 0);
        const elidedExecution = execute(elided);
        assert.equal(elidedExecution.status, 'returned'); assert.equal(elidedExecution.httpStatus, 200);
        assert.equal(elidedExecution.body, '1');
        cacheElision = { ...elidedInspection, execution: elidedExecution,
          authority: 'existing opt-in cache-elision counterfactual; not a default-policy change' };
      }
      cases.push({ kind, planHash: plan.planHash, generatedSourceSha256: hash(source), canonical, primary,
        fastlyDirect: { ...final, execution, cacheElision, authority: 'direct provider-stage injected-host experiment, not ordinary build or hosted qualification' } });
      if (kind === 'mac' || kind === 'schema') for (const runtime of ['standard', 'fixed']) experiments.push(experiment(directory, kind, runtime));
      if (kind === 'mac') experiments.push(experiment(directory, kind, 'fixed-demand'));
    }
    const owners = ['wasm/packages/compiler/src/canonical-native-compiler.js',
      'wasm/packages/wasm-guest-link/src/constants.js', 'wasm/packages/wasm-guest-link/src/pipeline.js',
      'packages/crypto/as/pulse-hmac-as.ts', 'packages/crypto/pulsewasm.native.cjs',
      'packages/provider-fastly/src/build/fixed-memory-runtime.as.ts', 'packages/provider-fastly/src/build/native-platform-capabilities.js',
      'packages/provider-fastly/src/testing/native-platform-capabilities-host.js',
      'wasm/packages/build-support/src/schema-cache-arena-transform.cjs',
      'wasm/test/qualification/stab03/fixture.cjs', 'wasm/test/jwt/jwt02/diagnose.cjs', 'wasm/test/suite/registry.cjs'];
    const report = { version: 'pulse.jwt02.initialization-design.v1', status: 'passed',
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
      workingTreeStatus: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(),
      ownerHashes: Object.fromEntries(owners.map(file => [file, hash(fs.readFileSync(path.join(repo, file)))])),
      nodeVersion: process.version, assemblyScriptVersion: require(path.join(resolveAsc(compilerRoot).packageRoot, 'package.json')).version,
      binaryenVersion: require('../../../packages/wasm-guest-link/src/constants').binaryenVersion,
      memory: memoryAbiV2, cases, experiments, productionFix: false, installedQualified: false, hostedQualified: false };
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    // No private signing key, token or secret is persisted with the artifacts.
    fs.rmSync(root, { recursive: true, force: true });
    if (!retained) fs.rmSync(output, { recursive: true, force: true });
  }
}
main();
