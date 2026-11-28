'use strict';

// JWT-02.2: ordinary canonical compilation and injected provider execution.
// Synthetic workspace evidence; installed qualification belongs to JWT-02.3.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { acceptanceToolchain } = require('../../s3/acceptance-toolchain.cjs');
const { writeControl } = require('../../qualification/stab03/fixture.cjs');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const { inspectWasmFile } = require('../../../packages/wasm-guest-link/src/inspect');
const { memoryAbiV2 } = require('../../../packages/wasm-guest-link/src/constants');
const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile');
const { executeFastlyNativePlatformCapabilities } = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');

const repo = path.resolve(__dirname, '../../../..');

const compilerRoot = path.join(repo, 'wasm/packages/compiler');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const tc = acceptanceToolchain();

function observation(file, directory, label) {
  const inspected = inspectWasmFile(file, { workDirectory: directory, label });
  return { sha256: inspected.sha256, bytes: inspected.bytes, hasStart: inspected.hasStart,
    memoryTypes: inspected.memoryTypes, instructions: inspected.instructions,
    dataBytes: inspected.dataBytes, dataEndExclusive: Math.max(...inspected.dataSegments.map(s => s.endExclusive)) };
}

async function main() {
  assert(process.argv.length === 2 || process.argv.length === 4 && process.argv[2] === '--out', 'usage: diagnose.cjs [--out NEW_DIRECTORY]');
  const retained = process.argv.length === 4;
  const output = retained ? path.resolve(process.argv[3]) : fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt02-'));
  if (retained) fs.mkdirSync(output);
  const root = path.join(output, 'consumer');
  const cases = [];
  try {
    fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), { recursive: true });
    const names = ['pulse', 'runtime', 'crypto', 'jwt', 'provider-node', 'provider-fastly'];
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
      const configFile = path.join(root, '.pulse/config.ts');
      fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace('"node-native":{"host":"node","target":"native"}',
        '"node-native":{"host":"node","target":"native"},"fastly-native":{"host":"fastly","target":"native","outDir":"out/fastly","fastly":{"bindings":{"secretStore":"fixture_secrets"}}}'));
      const appFile = path.join(root, 'app.ts');
      let appSource = fs.readFileSync(appFile, 'utf8').replace('export default app;', "app.error(async(error,ctx,next)=>ctx.text('denied',{status:401}));export default app;");
      appSource = appSource.replace("('{\"issued\":1}','proof.Time')", "(ctx.req.header('x-schema')||'{\"issued\":1}','proof.Time')");
      fs.writeFileSync(appFile, appSource);
      const compiled = tc.compileProject(tc.resolveProject({ cwd: root, profile: 'node-native' }));
      const plan = buildCanonicalNativePlan(compiled);
      const directory = path.join(output, kind); fs.mkdirSync(directory);
      fs.copyFileSync(path.join(root, 'app.ts'), path.join(directory, 'app.ts'));
      const project = tc.resolveProject({ cwd: root, profile: 'node-native' });
      const native = tc.compileNativeProjectInMemory(project).native;
      fs.writeFileSync(path.join(directory, 'source.as.ts'), native.source);
      const canonical = { status: 'built', sha256: hash(native.wasm), bytes: native.wasm.length, runtime: native.manifest.linkedRuntime, layout: native.manifest.finalWasmAudit.layout };
      if (kind === 'combined') assert.deepEqual(tc.compileNativeProjectInMemory(project).native.wasm, native.wasm, 'same-source linked artifact is deterministic');
      fs.writeFileSync(path.join(directory, 'canonical-native.wasm'), native.wasm);
      const primary = observation(path.join(directory, 'canonical-native.wasm'), directory, 'canonical-final');
      assert.equal(primary.hasStart, false);
      assert.equal(primary.instructions.memoryGrow, 0);
      assert(native.manifest.linkedRuntime);
      const built = tc.buildProject(tc.resolveProject({ cwd: root, profile: 'fastly-native' }));
      assert.equal(built.status, 'built');
      const providerWasm = fs.readFileSync(path.join(built.outDir, 'bin/main.wasm'));
      const provider = { wasm: providerWasm, inspection: { imports: WebAssembly.Module.imports(new WebAssembly.Module(providerWasm)) } };
      const providerFile = path.join(directory, 'fastly.wasm'); fs.writeFileSync(providerFile, provider.wasm);
      const final = observation(providerFile, directory, 'fastly');
      assert.equal(final.hasStart, false); assert.equal(final.instructions.memoryGrow, 0);
      const url = 'https://generic.test/';
      const request = { method: 'GET', path: '/', url, headers: [['authorization', bearer],
        ['x-proof', crypto.createHmac('sha256', secret).update(url).digest('hex')]], body: '' };
      const execute = (artifact, selectedRequest = request) => {
        const hostcalls = [];
        try {
          const response = executeFastlyNativePlatformCapabilities(artifact, { request: selectedRequest, secrets: { INGRESS_KEY: secret }, allowHandledJwtError: true,
            secretStore: 'fixture_secrets', clockUnixSeconds: now,
            afterHostcall: ({ module, name }) => { hostcalls.push(`${module}.${name}`); } }).response;
          return { status: 'returned', httpStatus: response.status, body: response.body, hostcalls };
        } catch (error) { return { status: 'trapped', errorType: error.name, hostcalls }; }
      };
      const execution = execute(provider);
      const expected = kind === 'baseline' ? 'reader' : kind === 'mac' ? 'valid' : '1';
      assert.equal(execution.status, 'returned', JSON.stringify(execution));
      assert.equal(execution.httpStatus, 200); assert.equal(execution.body, expected);
      const nodeResult = await tc.executeCanonicalNativeModule(native, tc.driver.executionOptions(project.providerConfig, {
        request, secrets: { INGRESS_KEY: secret }, strict: false,
        captureJwtWallClock: () => ({ trusted: true, unixEpochSeconds: now })
      }));
      assert.equal(nodeResult.response.status, 200); assert.equal(nodeResult.response.body, expected);
      const failures = [];
      const invalid = [{ name: 'invalid-signature', headers: [['authorization', bearer.slice(0, -6) + 'AAAAAA']], status: 401, body: 'denied' }];
      if (kind === 'mac' || kind === 'combined') invalid.push({ name: 'invalid-mac', headers: [['authorization', bearer], ['x-proof', '0'.repeat(64)]], status: 200, body: kind === 'mac' ? 'invalid-authenticator' : 'invalid' });
      if (kind === 'schema' || kind === 'combined') invalid.push({ name: 'invalid-schema', headers: [...request.headers, ['x-schema', '{"issued":"bad"}']], status: 401, body: 'denied' });
      for (const cell of invalid) {
        const invalidRequest = { ...request, headers: cell.headers };
        const fastlyResult = execute(provider, invalidRequest);
        const node = await tc.executeCanonicalNativeModule(native, tc.driver.executionOptions(project.providerConfig, {
          request: invalidRequest, secrets: { INGRESS_KEY: secret }, strict: false,
          captureJwtWallClock: () => ({ trusted: true, unixEpochSeconds: now })
        }));
        assert.equal(fastlyResult.httpStatus, cell.status, cell.name); assert.equal(fastlyResult.body, cell.body, cell.name);
        assert.equal(node.response.status, cell.status, cell.name); assert.equal(node.response.body, cell.body, cell.name);
        failures.push(cell.name);
      }
      cases.push({ kind, planHash: plan.planHash, canonical, primary, failures, fastly: { ...final, execution }, node: nodeResult.response });
    }
    const owners = ['wasm/packages/compiler/src/canonical-native-compiler.js',
      'wasm/packages/host-runtime/src/runtime/canonical-native-host.js', 'wasm/packages/host-runtime/src/runtime/native-initialization.js',
      'wasm/packages/runtime-core-as/src/compiler/linked-runtime.js', 'wasm/packages/wasm-guest-link/src/inspect.js',
      'wasm/packages/wasm-guest-link/src/constants.js', 'wasm/packages/wasm-guest-link/src/pipeline.js',
      'packages/crypto/as/pulse-hmac-as.ts', 'packages/crypto/pulsewasm.native.cjs',
      'wasm/packages/runtime-core-as/src/compiler/fixed-memory-runtime.as.ts', 'packages/provider-fastly/src/build/native-platform-capabilities.js',
      'packages/provider-fastly/src/testing/native-platform-capabilities-host.js',
      'wasm/packages/build-support/src/schema-cache-arena-transform.cjs',
      'wasm/test/qualification/stab03/fixture.cjs', 'wasm/test/jwt/jwt02/composition.cjs', 'wasm/test/suite/registry.cjs'];
    const report = { version: 'pulse.jwt02.composition.v1', status: 'passed',
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
      workingTreeStatus: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(),
      ownerHashes: Object.fromEntries(owners.map(file => [file, hash(fs.readFileSync(path.join(repo, file)))])),
      nodeVersion: process.version, assemblyScriptVersion: require(path.join(resolveAsc(compilerRoot).packageRoot, 'package.json')).version,
      binaryenVersion: require('../../../packages/wasm-guest-link/src/constants').binaryenVersion,
      memory: memoryAbiV2, cases, productionFix: true, installedQualified: false, hostedQualified: false };
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    // No private signing key, token or secret is persisted with the artifacts.
    fs.rmSync(root, { recursive: true, force: true });
    if (!retained) fs.rmSync(output, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
