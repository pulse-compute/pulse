#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION
} = require('../../../packages/provider-node/src/javascript/support.js');
const {
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/javascript/target.js');

const declaration = NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION;
assert.equal(declaration.targetId, NODE_JAVASCRIPT_TARGET_DESCRIPTOR.targetId);
assert.deepEqual(declaration.availability.summary, { total: 12, satisfied: 12, pending: 0, blocked: 0 });
assert.ok(declaration.availability.gates.every((entry) => entry.status === 'satisfied'));
assert.ok(declaration.availability.gates.every((entry) => !entry.evidence || !entry.evidence.artifact.includes('/audit/')));
assert.equal(declaration.availability.coreExecutionReady, true);
assert.equal(declaration.availability.fullTargetSupportReady, true);
assert.equal(declaration.availability.generalAvailable, true);
assert.equal(declaration.availability.automaticFallback, false);
assert.equal(NODE_JAVASCRIPT_TARGET_DESCRIPTOR.automaticFallback, false);

const {
  providerPackageName,
  resolveProviderToolchain
} = require('../../packages/compiler/src/provider-toolchain.js');
const {
  loadConventionalProject,
  normalizeProject
} = require('../../packages/cli/src/project-config.js');

assert.equal(providerPackageName('fastly'), '@pulse-compute/provider-fastly');
assert.equal(providerPackageName('node'), '@pulse-compute/provider-node');
assert.equal(providerPackageName('esp32'), '@pulse-compute/provider-esp32');
assert.equal(providerPackageName('none'), null);
assert.equal(providerPackageName('@example/pulse-provider-esp32'), '@example/pulse-provider-esp32');
assert.throws(
  () => providerPackageName('./provider-esp32'),
  (error) => error && error.code === 'PULSE_PROVIDER_UNSUPPORTED'
);
assert.equal(resolveProviderToolchain('fastly').driver.id, 'fastly');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-provider-toolchain-'));
try {
  const packageRoot = path.join(fixtureRoot, 'node_modules', '@example', 'pulse-provider-esp32');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify({
    name: '@example/pulse-provider-esp32',
    version: '1.2.3',
    type: 'commonjs',
    exports: { './toolchain': './toolchain.cjs' }
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(packageRoot, 'toolchain.cjs'), `'use strict';
module.exports = Object.freeze({
  version: 'pulse.provider-toolchain.v1',
  id: 'esp32',
  packageName: '@example/pulse-provider-esp32',
  packageVersion: '1.2.3',
  createDriver() {
    return Object.freeze({
      version: 'pulse.provider-driver.v1',
      id: 'esp32',
      executable: false,
      localExecution: false,
      deployable: false,
      deploymentValidated: false,
      sourcePackage: false,
      compiledWasm: true,
      defaultBuildMode: 'compile-only',
      sourceOnlySupported: false,
      normalizeConfig(value) { return Object.freeze({ kind: 'esp32', board: value.board || 'generic' }); },
      projectConfigDocument(value) { return value; },
      initTemplate() { return Object.freeze({ profileFragment: '', dependencies: Object.freeze({}) }); },
      targets: Object.freeze({
        native: Object.freeze({
          version: 'pulse.provider-target-descriptor.v1',
          target: 'native',
          targetId: 'esp32-native',
          runtimeClass: 'native',
          status: 'compile-only',
          automaticFallback: false,
          commands: Object.freeze({ compile: true })
        })
      })
    });
  }
});
`);

  const resolution = resolveProviderToolchain('@example/pulse-provider-esp32', { projectRoot: fixtureRoot });
  assert.equal(resolution.selector, '@example/pulse-provider-esp32');
  assert.equal(resolution.id, 'esp32');
  assert.equal(resolution.packageName, '@example/pulse-provider-esp32');
  assert.equal(resolution.packageVersion, '1.2.3');
  assert.equal(resolution.entrypoint, './toolchain');
  assert.equal(resolution.official, false);

  const project = normalizeProject({
    entry: './src/index.ts',
    provider: { kind: '@example/pulse-provider-esp32', board: 'devkit' }
  }, { projectRoot: fixtureRoot });
  assert.equal(project.provider, 'esp32');
  assert.equal(project.providerSelector, '@example/pulse-provider-esp32');
  assert.equal(project.providerConfig.board, 'devkit');
  assert.equal(project.providerToolchain.contractVersion, 'pulse.provider-toolchain.v1');

  fs.mkdirSync(path.join(fixtureRoot, '.pulse'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'src', 'index.ts'), 'export default {};\n');
  const configFile = path.join(fixtureRoot, '.pulse', 'config.ts');
  fs.writeFileSync(configFile, `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', defaultProfile: 'local', strict: true },
  local: {
    host: '@example/pulse-provider-esp32',
    target: 'native',
    esp32: { board: 'devkit' },
  },
}));
`);
  const conventional = loadConventionalProject(Object.freeze({
    version: 'pulse.workspace.v1',
    kind: 'conventional',
    root: fixtureRoot,
    configFile,
    source: '.pulse/config.ts',
    boundary: fixtureRoot,
    configInsideWorkspace: true
  }));
  assert.equal(conventional.provider, 'esp32');
  assert.equal(conventional.providerSelector, '@example/pulse-provider-esp32');
  assert.equal(conventional.providerConfig.board, 'devkit');

  assert.throws(
    () => resolveProviderToolchain('@example/missing-provider', { projectRoot: fixtureRoot }),
    (error) => error && error.code === 'PULSE_PROVIDER_PACKAGE_NOT_FOUND'
  );

  const invalidRoot = path.join(fixtureRoot, 'node_modules', '@example', 'invalid-provider');
  fs.mkdirSync(invalidRoot, { recursive: true });
  fs.writeFileSync(path.join(invalidRoot, 'package.json'), `${JSON.stringify({
    name: '@example/invalid-provider',
    version: '1.0.0',
    type: 'commonjs',
    exports: { './toolchain': './toolchain.cjs' }
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(invalidRoot, 'toolchain.cjs'), `module.exports = {
  version: 'pulse.provider-toolchain.v0',
  id: 'invalid',
  packageName: '@example/invalid-provider',
  packageVersion: '1.0.0',
  createDriver() { return {}; }
};
`);
  assert.throws(
    () => resolveProviderToolchain('@example/invalid-provider', { projectRoot: fixtureRoot }),
    (error) => error && error.code === 'PULSE_PROVIDER_TOOLCHAIN_INVALID'
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('ok - target support and deterministic provider package bootstrap are current, explicit, and fallback-free');
