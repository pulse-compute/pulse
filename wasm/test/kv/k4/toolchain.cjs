'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const repoRoot = path.resolve(__dirname, '../../../..');
const sources = {
  '@pulse-compute/cli/project-config': 'wasm/packages/cli/src/project-config.js',
  '@pulse-compute/cli/project-execution': 'wasm/packages/cli/src/project-execution.js',
  '@pulse-compute/wasm-host-runtime/runtime/canonical-native-host': 'wasm/packages/host-runtime/src/runtime/canonical-native-host.js',
  '@pulse-compute/provider-node/runtime/canonical-api-runtime': 'packages/provider-node/src/runtime/canonical-api-runtime.js',
  '@pulse-compute/provider-node/javascript/bindings-adapter': 'packages/provider-node/src/javascript/bindings-adapter.js',
  '@pulse-compute/provider-node/javascript/runtime-host': 'packages/provider-node/src/javascript/runtime-host.js',
  '@pulse-compute/provider-fastly/testing/fastly-cli': 'packages/provider-fastly/src/testing/fastly-cli.js',
};
function toolchain(packedRoot) {
  const installed = packedRoot && createRequire(path.join(packedRoot, 'package.json'));
  function load(name) {
    if (!installed) return require(path.join(repoRoot, sources[name]));
    const resolved = fs.realpathSync(installed.resolve(name));
    assert.ok(resolved.startsWith(path.join(packedRoot, 'node_modules') + path.sep), `${name}: isolated installed package required`);
    return installed(name);
  }
  return Object.assign({}, ...Object.keys(sources).map(load));
}
function project(cwd, packedRoot) {
  fs.mkdirSync(path.join(cwd, '.pulse'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../k2/consumer.ts'), path.join(cwd, 'src/index.ts'));
  const version = JSON.parse(fs.readFileSync(path.join(packedRoot || repoRoot,
    packedRoot ? 'node_modules/@pulse-compute/runtime/package.json' : 'packages/runtime/package.json'))).version;
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'pulse-k4-consumer', private: true, version: '0.0.0',
    dependencies: Object.fromEntries(['pulse', 'runtime', 'cli', 'provider-node', 'provider-fastly'].map((name) => [`@pulse-compute/${name}`, version])) }));
  if (!packedRoot) {
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'runtime']) fs.symlinkSync(path.join(repoRoot, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
  }
  fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', defaultProfile: 'fastly-native', strict: false },
  'node-native': { host: 'node', target: 'native', schemas: { maxBytes: 262144 } },
  'node-javascript': { host: 'node', target: 'javascript', schemas: { maxBytes: 262144 } },
  'fastly-native': { host: 'fastly', target: 'native', outDir: 'dist', schemas: { maxBytes: 262144 },
    fastly: { bindings: { kv: { catalog: 'k4_catalog' } }, build: { name: 'pulse-k4-local' } } }
}));\n`);
}
module.exports = { toolchain, project, repoRoot };
