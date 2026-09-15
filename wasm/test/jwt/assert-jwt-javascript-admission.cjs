#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { PACKAGE_SET, RELEASE_VERSION } = require('../../../scripts/package-support.cjs');

const repoRoot = path.resolve(__dirname, '../../..');
// Replay the same assertions against a fresh, already installed tarball consumer.
const installedRoot = process.argv[2];
const root = installedRoot ? path.resolve(installedRoot)
  : fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'jwt-admission-'));
function write(relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
if (!installedRoot) {
  write('package.json', JSON.stringify({ name: 'jwt-admission-consumer', private: true,
    dependencies: Object.fromEntries(PACKAGE_SET.map(({ name }) => [name, RELEASE_VERSION])) }));
  fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), { recursive: true });
  for (const entry of PACKAGE_SET) fs.symlinkSync(path.join(repoRoot, entry.dir),
    path.join(root, 'node_modules', entry.name), process.platform === 'win32' ? 'junction' : 'dir');
}
const request = createRequire(path.join(root, 'package.json'));
const cli = path.resolve(path.dirname(request.resolve('@pulse-compute/cli')), '../bin/pulse.js');
function run(command, profile = 'javascript', expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, command, '--profile', profile, '--json'], {
    cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(expectedStatus === 0 ? result.stdout : result.stderr);
}

async function main() {
  if (installedRoot) for (const { name } of PACKAGE_SET) {
    const packageRoot = path.join(root, 'node_modules', name);
    assert.equal(fs.lstatSync(packageRoot).isSymbolicLink(), false, `${name} must be installed`);
    assert.ok(fs.realpathSync(packageRoot).startsWith(`${root}${path.sep}`));
  }
  const secret = 'jwt-admission-fixture-secret-32-bytes';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), alg: 'ES256', use: 'sig', key_ops: ['verify'] };
  const signingInput = (algorithm) => `${Buffer.from(JSON.stringify({ alg: algorithm })).toString('base64url')}.${
    Buffer.from(JSON.stringify({ sub: 'verified-user' })).toString('base64url')}`;
  const hsInput = signingInput('HS256');
  const esInput = signingInput('ES256');
  const tokens = [
    `${hsInput}.${crypto.createHmac('sha256', secret).update(hsInput).digest('base64url')}`,
    `${esInput}.${crypto.sign('sha256', Buffer.from(esInput), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  ];
  for (const status of ['pending', 'blocked', 'unclassified']) {
    const name = `@fixture/jwt-${status}`;
    write(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0',
      exports: { './toolchain': './toolchain.cjs' } }));
    write(`node_modules/${name}/toolchain.cjs`, `const node = require('@pulse-compute/provider-node/toolchain');
module.exports = { ...node, packageName: '${name}', createDriver() {
  const driver = node.createDriver();
  const policy = driver.javascript.targetSupportPolicy;
  return { ...driver, javascript: { ...driver.javascript,
    writeSourcePackage() { throw new Error('Unavailable provider must never package source'); },
    targetSupportPolicy: ${status === 'unclassified' ? 'undefined' : `{ ...policy, classifyProviderRequirement(id, ...args) {
      return id === 'time.wall-clock'
        ? { id, status: '${status}', required: true, reasonId: 'fixture-clock-unavailable', owner: 'provider-node' }
        : policy.classifyProviderRequirement(id, ...args);
    } }`}
  } };
} };`);
  }
  write('.pulse/config.ts', `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', defaultProfile: 'javascript', strict: true },
  javascript: { host: 'node', target: 'javascript', outDir: 'dist/javascript',
    crypto: { HS256: { realization: 'runtime-builtin' }, ES256: { realization: 'runtime-builtin' } } },
  missing: { host: 'node', target: 'javascript', outDir: 'dist/missing', crypto: {} },
  wrong: { host: 'node', target: 'javascript', outDir: 'dist/wrong',
    crypto: { HS256: { realization: 'guest-source:pulse-hmac-as' }, ES256: { realization: 'runtime-builtin' } } },
  pending: { host: '@fixture/jwt-pending', target: 'javascript', outDir: 'dist/pending',
    crypto: { HS256: { realization: 'runtime-builtin' }, ES256: { realization: 'runtime-builtin' } } },
  blocked: { host: '@fixture/jwt-blocked', target: 'javascript', outDir: 'dist/blocked',
    crypto: { HS256: { realization: 'runtime-builtin' }, ES256: { realization: 'runtime-builtin' } } },
  unclassified: { host: '@fixture/jwt-unclassified', target: 'javascript', outDir: 'dist/unclassified',
    crypto: { HS256: { realization: 'runtime-builtin' }, ES256: { realization: 'runtime-builtin' } } },
  fastly: { host: 'fastly', target: 'javascript', outDir: 'dist/fastly',
    crypto: { HS256: { realization: 'runtime-builtin' }, ES256: { realization: 'runtime-builtin' } } }
}));`);
  write('src/index.ts', `import { Pulse } from '@pulse-compute/pulse';
import { jwt } from '@pulse-compute/jwt';
const app = new Pulse({ auto: true });
app.get('/hs', async (ctx) => {
  const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), {
    algorithms: ['HS256'], key: { type: 'secret', binding: 'JWT_KEY' }
  });
  return ctx.text(verified.claims.sub + ':' + verified.protectedHeader.alg);
});
app.get('/es', async (ctx) => {
  const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), {
    algorithms: ['ES256'], key: { type: 'jwk', key: ${JSON.stringify(publicJwk)} }
  });
  return ctx.text(verified.claims.sub + ':' + verified.protectedHeader.alg);
});
export default app;`);
  const cases = ['HS256', 'ES256'].map((algorithm, index) => ({
    name: algorithm, request: { method: 'GET', path: index === 0 ? '/hs' : '/es',
      headers: { authorization: `Bearer ${tokens[index]}` } },
    secrets: { JWT_KEY: secret }, expect: { status: 200, text: `verified-user:${algorithm}` }
  }));
  write('tests/pulse.harness.ts', `export default ${JSON.stringify(cases)};`);
  const { loadConventionalProject } = request('@pulse-compute/cli/project-config');
  const { compileProject, prepareJavascriptApplication } = request('@pulse-compute/cli/project-execution');
  const { resolveProviderToolchain } = request('@pulse-compute/wasm-compiler/provider-toolchain');
  const { buildJavascriptTargetSupportEvidence } = request('@pulse-compute/wasm-compiler/project-target-support');
  const project = loadConventionalProject({ root, configFile: path.join(root, '.pulse/config.ts') }, { profile: 'javascript' });
  const compiled = compileProject(project);
  const prepared = prepareJavascriptApplication(project, { load: false });
  const jwt = prepared.plan.packages.find(({ contractId }) => contractId === 'pulse.jwt');
  assert.equal(jwt.status, 'package-runtime');
  assert.equal(prepared.plan.loadable, true);
  assert.equal(prepared.plan.packageProduct.contracts.find(({ contractId }) => contractId === 'pulse.jwt').javascriptTarget.status, 'provider-dependent');
  const policy = resolveProviderToolchain('node', { projectRoot: root }).driver.javascript.targetSupportPolicy;
  const evidence = (selectedPolicy, selectedCompiled = compiled, selectedPrepared = prepared) =>
    buildJavascriptTargetSupportEvidence(project, { compiled: selectedCompiled, javascriptApplication: selectedPrepared }, selectedPolicy);
  assert.equal(evidence(policy).project.status, 'eligible');
  // Manifest requirements still apply when an import has no recognized JWT call.
  const requirements = ['jwt.verify', 'jwt.verify.hs256', 'jwt.verify.es256', 'secret.get', 'time.wall-clock'];
  const importOnly = { ...compiled, metadata: { ...compiled.metadata, capabilities: [], providerRequirements: [], providerOperations: [] } };
  for (const id of requirements) for (const status of ['pending', 'blocked']) {
    const result = evidence({ ...policy, classifyProviderRequirement(requirement, ...args) {
      return requirement === id ? { id, status, required: true, reasonId: 'fixture-capability-unavailable', owner: 'provider-node' }
        : policy.classifyProviderRequirement(requirement, ...args);
    } }, importOnly);
    assert.equal(result.project.status, status, `${id} must remain ${status}`);
    assert.equal(result.project.providerRequirements.find((entry) => entry.id === id).status, status);
  }
  assert.equal(run('doctor').summary.failed, 0);
  run('inspect');
  assert.deepEqual(run('test').summary, { total: 2, passed: 2, failed: 0 });
  const built = run('build');
  assert.equal(built.buildMode, 'javascript-source-package');
  assert.equal(built.manifest.automaticFallback, false);
  const application = request(built.files.entry);
  const { executeNodeJavascriptTestCase } = request('@pulse-compute/provider-node/javascript/test-runtime');
  for (const testCase of cases) {
    const result = await executeNodeJavascriptTestCase(application,
      { ...testCase, request: { ...testCase.request, headers: Object.entries(testCase.request.headers) } },
      { provider: 'node', strict: true, networkFetch: false });
    assert.equal(result.response.status, 200);
    assert.equal(result.response.body, testCase.expect.text);
  }
  for (const profile of ['missing', 'wrong']) {
    const result = run('build', profile, 3);
    assert.match(JSON.stringify(result), /PULSE_CRYPTO_/);
    assert.equal(fs.existsSync(path.join(root, 'dist', profile)), false);
  }
  for (const profile of ['pending', 'blocked', 'unclassified']) {
    const result = run('build', profile, 3);
    assert.equal(result.error.code, 'PULSE_PROVIDER_CAPABILITY_UNSUPPORTED');
    if (profile !== 'unclassified') assert.equal(result.error.detail.status, profile);
    assert.equal(result.error.detail.automaticFallback, false);
    assert.equal(fs.existsSync(path.join(root, 'dist', profile)), false);
  }
  // The shared planner must consult Fastly's existing support policy as well.
  const fastly = run('build', 'fastly');
  assert.equal(fastly.manifest.automaticFallback, false);
  console.log('ok - JWT JavaScript admission, provider capability rejection, HS256/ES256 execution and source packaging');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (!installedRoot) fs.rmSync(root, { recursive: true, force: true });
});
