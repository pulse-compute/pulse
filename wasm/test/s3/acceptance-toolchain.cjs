'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// The host ABI fixture models Fastly, not Pulse. It accepts only the compiled
// Wasm bytes and fixture inputs; no workspace compiler or realization is used
// by the packed consumer. It deliberately is not a new public package export.
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

function acceptanceToolchain(packedRoot) {
  if (!packedRoot) {
    const execution = require('../../packages/cli/src/project-execution.js');
    const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
    return {
      ...execution,
      ...require('../../packages/cli/src/project-config.js'),
      ...require('../../packages/host-runtime/src/runtime/canonical-native-host.js'),
      ...require('../../../packages/provider-node/src/javascript/runtime-host.js'),
      ...require('../../../packages/provider-fastly/src/javascript/target-support-policy.js'),
      driver: require('../../../packages/provider-node/src/toolchain.js').createDriver(),
      executeFastlyNativePlatformCapabilities,
      compileFastly(project) {
        return compileFastlyNativePlatformCapabilitiesPlan(execution.compileNativeProjectInMemory(project).plan, {
          cwd: project.root, bindings: project.providerConfig.bindings, canonicalBuild: true,
        });
      },
    };
  }
  const installed = createRequire(path.join(packedRoot, 'package.json'));
  function load(name) {
    const resolved = fs.realpathSync(installed.resolve(name));
    assert.ok(resolved.startsWith(path.join(packedRoot, 'node_modules') + path.sep), `${name}: must resolve inside the isolated tarball install`);
    return installed(name);
  }
  const execution = load('@pulse-compute/cli/project-execution');
  return {
    ...execution,
    ...load('@pulse-compute/cli/project-config'),
    ...load('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host'),
    ...load('@pulse-compute/provider-node/javascript/runtime-host'),
    ...load('@pulse-compute/provider-fastly/javascript/target-support-policy'),
    driver: load('@pulse-compute/provider-node/toolchain').createDriver(),
    executeFastlyNativePlatformCapabilities,
    compileFastly(project) {
      const built = execution.buildProject(project);
      assert.equal(built.status, 'built');
      const wasm = fs.readFileSync(path.join(built.outDir, 'bin/main.wasm'));
      const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
      assert.ok(imports.some(({ module }) => module === 'fastly_http_req'));
      return { wasm, inspection: { imports } };
    },
  };
}

module.exports = { acceptanceToolchain };
