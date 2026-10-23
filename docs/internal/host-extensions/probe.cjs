'use strict';

// Historical HEX-00 boundary evidence. Not a product regression test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const provider = require(path.join(root, 'wasm/packages/contracts/src/provider/canonical-provider.js'));
const pkg = require(path.join(root, 'wasm/packages/contracts/src/package/package-contract.js'));
const final = require(path.join(root, 'wasm/packages/contracts/src/provider/final-wasm-policy.js'));
const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, status: 'pass' }); }
  catch (error) { results.push({ name, status: 'fail', message: error.message }); }
}
const authority = { contractId: 'pulse.grip', npmPackage: '@pulse-compute/grip', lowerableSubpath: '@pulse-compute/grip' };
const result = () => ({ artifact: { ...authority, version: 'hex.scope-fixture.v1', status: 'ok' } });
test('Existing GRIP capability is admitted', () => {
  const value = provider.normalizeDescriptor({ id: 'fastly', capabilities: ['grip.broadcast'], lowering: { 'grip.broadcast': 'fastly.grip.publish-control' } });
  assert.deepEqual(value.capabilities, ['grip.broadcast']);
});
test('Unknown operation capability is rejected', () => {
  assert.throws(() => provider.normalizeDescriptor({ id: 'fastly', capabilities: ['grip.handoffFanout'], lowering: { 'grip.handoffFanout': 'fixture' } }), error => error.code === 'PULSE_PROVIDER_CAPABILITY_UNKNOWN');
});
test('Existing builder result is admitted', () => {
  assert.equal(pkg.normalizePackageBuilderResult(result(), authority).hasErrors, false);
});
for (const field of ['hostImports', 'hostExtensions']) {
  test(`Undeclared top-level ${field} is rejected`, () => {
    assert.throws(() => pkg.normalizePackageBuilderResult({ ...result(), [field]: [] }, authority), new RegExp(`unsupported field.*${field}`));
  });
}
test('Existing realizationArtifacts carrier preserves opaque data, without granting execution', () => {
  const artifact = { id: 'pulse.grip:scope-only', kind: 'hex-unimplemented-fixture', version: 'hex.scope-fixture.v1', owner: '@pulse-compute/grip' };
  const normalized = pkg.normalizePackageBuilderResult({ ...result(), realizationArtifacts: [artifact] }, authority);
  assert.deepEqual(normalized.contributions.realizationArtifacts, [artifact]);
  assert(Object.isFrozen(normalized.contributions.realizationArtifacts));
});
test('Builder owner mismatch is rejected', () => {
  const input = result(); input.artifact.npmPackage = '@example/wrong-owner';
  assert.throws(() => pkg.normalizePackageBuilderResult(input, authority), /identity must equal/);
});
const existingImport = { module: 'fastly_abi', name: 'init', kind: 'function' };
const newImport = { module: 'fastly_http_req', name: 'redirect_to_grip_proxy_v2', kind: 'function' };
const policy = final.defineFinalWasmPolicy({ version: final.FINAL_WASM_POLICY_VERSION, descriptorOwner: '@example/scope-fixture', toolchainVersion: 'fixture.v1', descriptorIdentity: 'synthetic-hex-policy', permittedImports: [existingImport], requiredExports: [{ name: '_start', kind: 'function' }] });
test('Final policy admits declared imports', () => {
  assert.deepEqual(final.projectFinalWasmPolicy(policy, [existingImport]).allowedImports, [existingImport]);
});
test('Final policy rejects a new undeclared host import', () => {
  assert.throws(() => final.projectFinalWasmPolicy(policy, [existingImport, newImport]), /exceed.*policy ceiling/);
});
const files = [
  'wasm/packages/contracts/src/provider/canonical-provider.js',
  'wasm/packages/contracts/src/provider/final-wasm-policy.js',
  'wasm/packages/contracts/src/package/package-contract.js',
  'packages/provider-fastly/src/build/native-platform-capabilities.js',
  'packages/provider-fastly/src/toolchain/index.js',
  'packages/grip/src/index.ts',
  'docs/internal/host-extensions/probe.cjs'
];
const receipt = {
  kind: 'HEX-00 historical boundary probes',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version,
  sourceSha256: Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
  scope: 'Current normalizers only; synthetic final import policy; no compiler/provider execution or size claim',
  passed: results.filter(item => item.status === 'pass').length,
  failed: results.filter(item => item.status === 'fail').length,
  results
};
console.log(JSON.stringify(receipt, null, 2));
if (receipt.failed) process.exitCode = 1;
