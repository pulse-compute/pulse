#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const contracts = require('../../packages/contracts/src/provider/toolchain.js');
const nodeToolchain = require('../../../packages/provider-node/src/toolchain.js');
const fastlyToolchain = require('../../../packages/provider-fastly/src/toolchain/index.js');
const {
  NODE_PROVIDER_DESCRIPTOR
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const {
  NODE_JWT_VERIFY_CAPABILITY,
  NODE_NATIVE_TARGET_CAPABILITIES
} = require('../../../packages/provider-node/src/capabilities.js');

const drivers = new Map();
for (const toolchain of [nodeToolchain, fastlyToolchain]) {
  assert.equal(toolchain.version, contracts.PROVIDER_TOOLCHAIN_VERSION);
  assert.equal(toolchain.createDriver.length, 0, `${toolchain.id} createDriver must receive no compiler service`);
  const driver = contracts.assertProviderDriver(toolchain.createDriver(), { id: toolchain.id });
  drivers.set(toolchain.id, driver);
  assert.equal(driver.version, contracts.PROVIDER_DRIVER_VERSION);
  assert.ok(driver.targets.native.finalWasmPolicy, `${toolchain.id} Native descriptor requires a final-Wasm policy`);
  assert.equal(driver.targets.native.automaticFallback, false);
  assert.equal(driver.targets.javascript.automaticFallback, false);
  assert.equal(typeof driver.writeTarget, 'function');
  assert.equal(typeof driver.inspectRealization, 'function');
  assert.equal(typeof driver.javascript.writeSourcePackage, 'function');
  assert.equal(typeof driver.javascript.describeSourcePackage, 'function');
  assert.ok(driver.javascript.targetSupportPolicy, `${toolchain.id} owns an explicit target-support policy`);
}

assert.deepEqual(drivers.get('node').events.targets, ['javascript', 'native']);
assert.equal(typeof drivers.get('node').events.executeTestCase, 'function');
assert.equal(drivers.get('fastly').events, undefined, 'Fastly must not advertise an HTTP/GRIP event adapter');
for (const capability of ['event.ingress', 'event.emit']) {
  assert.ok(NODE_PROVIDER_DESCRIPTOR.capabilities.includes(capability));
  assert.ok(NODE_NATIVE_TARGET_CAPABILITIES.includes(capability));
}
assert.ok(NODE_PROVIDER_DESCRIPTOR.capabilities.includes(NODE_JWT_VERIFY_CAPABILITY), 'Node descriptor must advertise its implemented JWT capability');
assert.ok(NODE_NATIVE_TARGET_CAPABILITIES.includes(NODE_JWT_VERIFY_CAPABILITY), 'Node Native target must project the same JWT capability identity');
assert.equal(NODE_PROVIDER_DESCRIPTOR.lowering[NODE_JWT_VERIFY_CAPABILITY], 'node.native.jwt.verify');

const compilerPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'wasm', 'packages', 'compiler', 'package.json'), 'utf8'));
assert.ok(compilerPackage.dependencies['@pulse-compute/provider-node'], 'built-in Node toolchain remains an exact package dependency');
assert.ok(compilerPackage.dependencies['@pulse-compute/provider-fastly'], 'built-in Fastly toolchain remains an exact package dependency');

const composition = fs.readFileSync(path.join(repoRoot, 'wasm', 'packages', 'compiler', 'bin', 'provider-proof-composition.js'), 'utf8');
assert.match(composition, /@pulse-compute\/provider-node\/compiler/);
assert.match(composition, /@pulse-compute\/provider-fastly\/compiler/);
const extractor = fs.readFileSync(path.join(repoRoot, 'wasm', 'packages', 'compiler', 'src', 'extractor.js'), 'utf8');
assert.doesNotMatch(extractor, /@pulse-compute\/provider-(?:node|fastly)/);

const conformanceImports = JSON.parse(fs.readFileSync(path.join(repoRoot, 'wasm', 'test', 'contracts', 'provider-package-conformance-imports.json'), 'utf8'));
assert.equal(conformanceImports.version, 'pulse.provider-package-conformance-imports.v1');
assert.equal(conformanceImports.imports.length, 7);
assert.equal(new Set(conformanceImports.imports.map((entry) => `${entry.file}\0${entry.specifier}`)).size, 7);

console.log('ok - Node and Fastly packages expose one exact driver contract, aligned HTTP/event capability truth, and explicitly bounded conformance-only private imports');
