#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const wasmRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(wasmRoot, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function parseWorkspacePackages(source) {
  return Array.from(source.matchAll(/^\s*-\s+"([^"]+)"\s*$/gm), (match) => match[1]);
}

function walk(dir, visitor) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, full).replaceAll(path.sep, '/');
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.pnpm-store') continue;
      visitor(full, rel, true);
      walk(full, visitor);
    } else {
      visitor(full, rel, false);
    }
  }
}

const rootManifest = readJson(path.join(repoRoot, 'package.json'));
const releaseManifest = readJson(path.join(repoRoot, 'release', 'pulse-release-manifest.json'));
assert.equal(rootManifest.engines.pnpm, releaseManifest.publication.pnpmDevelopmentRange, 'root pnpm range must match release policy');
assert.equal(Object.hasOwn(rootManifest, 'packageManager'), false, 'root development metadata must not hard-pin one pnpm patch');
assert.match(releaseManifest.publication.pnpmVersion, /^\d+\.\d+\.\d+$/, 'release policy must select an exact pnpm toolchain');

const expectedWorkspacePackages = ['packages/*', 'wasm', 'wasm/packages/*'];
assert.deepEqual(rootManifest.workspaces, expectedWorkspacePackages, 'package.json workspaces must stay aligned with pnpm-workspace.yaml');
assert.ok(!(rootManifest.devDependencies || {}).assemblyscript, 'root public workspace devDependencies must not own AssemblyScript; wasm owns AS test tooling');

assert.equal(Object.keys(rootManifest.scripts || {}).some((name) => name.startsWith('validation:bundle') || name === 'validation:restore'), false, 'portable dependency transfer scripts are distributed separately and must not leave broken workspace entry points');

const pnpmWorkspacePackages = parseWorkspacePackages(read(path.join(repoRoot, 'pnpm-workspace.yaml')));
assert.deepEqual(pnpmWorkspacePackages, expectedWorkspacePackages, 'pnpm-workspace.yaml must include public packages, the wasm root, and wasm implementation packages');

const packageScriptViolations = [];
walk(repoRoot, (full, rel, isDir) => {
  if (isDir) return;
  if (path.basename(rel) !== 'package.json') return;
  const manifest = readJson(full);
  for (const [name, script] of Object.entries(manifest.scripts || {})) {
    if (/\bnpm\s+run\b/.test(script)) {
      packageScriptViolations.push(`${rel}#${name}`);
    }
  }
});
assert.deepEqual(packageScriptViolations, [], 'workspace package scripts must use pnpm/corepack, not npm run');


const wasmManifest = readJson(path.join(wasmRoot, 'package.json'));
assert.equal(wasmManifest.name, '@pulse-compute/wasm-workspace', 'wasm/package.json should remain the named runnable wasm workspace package');
assert.equal(wasmManifest.private, true, 'wasm workspace package must stay private');
assert.ok(wasmManifest.devDependencies && wasmManifest.devDependencies.assemblyscript, 'wasm workspace package must own the AssemblyScript test-lane devDependency');
const buildSupportManifest = readJson(path.join(wasmRoot, 'packages', 'build-support', 'package.json'));
assert.ok(buildSupportManifest.dependencies && buildSupportManifest.dependencies['@pulse-compute/wasm-contracts'], 'wasm build-support package must depend on contracts for diagnostics normalization');
assert.ok(!((buildSupportManifest.dependencies || {})['@pulse-compute/wasm-compiler']), 'wasm build-support package must not depend on compiler');
assert.ok(!((buildSupportManifest.devDependencies || {}).assemblyscript), 'wasm build-support package must not own AssemblyScript; it resolves AS from the caller workspace');
const libraryKitManifest = readJson(path.join(wasmRoot, 'packages', 'library-kit', 'package.json'));
assert.ok(libraryKitManifest.dependencies && libraryKitManifest.dependencies['@pulse-compute/wasm-build-support'], 'wasm library-kit package must depend on build-support for shared build helpers');
assert.ok(libraryKitManifest.dependencies && libraryKitManifest.dependencies['@pulse-compute/wasm-contracts'], 'wasm library-kit package must depend on contracts for library/capability contract surfaces');
assert.ok(!((libraryKitManifest.dependencies || {})['@pulse-compute/wasm-compiler']), 'wasm library-kit package must not depend on compiler');
const hostRuntimeManifest = readJson(path.join(wasmRoot, 'packages', 'host-runtime', 'package.json'));
assert.ok(hostRuntimeManifest.dependencies && hostRuntimeManifest.dependencies['@pulse-compute/wasm-build-support'], 'wasm host-runtime package must depend on build-support for shared build helpers');
assert.ok(hostRuntimeManifest.dependencies && hostRuntimeManifest.dependencies['@pulse-compute/wasm-contracts'], 'wasm host-runtime package must depend on contracts for host ABI surfaces');
assert.ok(!((hostRuntimeManifest.dependencies || {})['@pulse-compute/wasm-compiler']), 'wasm host-runtime package must not depend on compiler');
const schemaJsonManifest = readJson(path.join(wasmRoot, 'packages', 'schema-json', 'package.json'));
assert.ok(schemaJsonManifest.dependencies && schemaJsonManifest.dependencies['@pulse-compute/wasm-build-support'], 'wasm schema-json package must depend on build-support for shared build helpers');
assert.ok(schemaJsonManifest.dependencies && schemaJsonManifest.dependencies['@pulse-compute/wasm-contracts'], 'wasm schema-json package must depend on contracts for schema-json contract surfaces');
assert.ok(schemaJsonManifest.dependencies && schemaJsonManifest.dependencies.typescript, 'wasm schema-json package must depend on TypeScript for schema compile lowering');
assert.ok(!((schemaJsonManifest.dependencies || {})['@pulse-compute/wasm-compiler']), 'wasm schema-json package must not depend on compiler');
const runtimeCoreAsManifest = readJson(path.join(wasmRoot, 'packages', 'runtime-core-as', 'package.json'));
assert.ok(runtimeCoreAsManifest.dependencies && runtimeCoreAsManifest.dependencies['@pulse-compute/wasm-build-support'], 'wasm runtime-core-as package must depend on build-support for shared build helpers');
assert.ok(runtimeCoreAsManifest.dependencies && runtimeCoreAsManifest.dependencies['@pulse-compute/wasm-contracts'], 'wasm runtime-core-as package must depend on contracts for diagnostics/execution-plan surfaces');
assert.ok(runtimeCoreAsManifest.dependencies && runtimeCoreAsManifest.dependencies.typescript, 'wasm runtime-core-as package must depend on TypeScript for compiled handler lowering');
assert.ok(!((runtimeCoreAsManifest.dependencies || {})['@pulse-compute/wasm-compiler']), 'wasm runtime-core-as package must not depend on compiler');
const providerNodeManifest = readJson(path.join(repoRoot, 'packages', 'provider-node', 'package.json'));
assert.equal(fs.existsSync(path.join(wasmRoot, 'packages', 'provider-node')), false, 'Node product provider must be extracted from wasm/packages');
assert.equal(providerNodeManifest.name, '@pulse-compute/provider-node', 'Node provider must use the product package name');
assert.ok(providerNodeManifest.dependencies && providerNodeManifest.dependencies['@pulse-compute/wasm-build-support'], 'provider-node must depend on build-support for shared build helpers');
assert.ok(providerNodeManifest.dependencies && providerNodeManifest.dependencies['@pulse-compute/wasm-contracts'], 'provider-node must depend on contracts for diagnostics/provider surfaces');
assert.ok(providerNodeManifest.dependencies && providerNodeManifest.dependencies['@pulse-compute/wasm-host-runtime'], 'provider-node must depend on host-runtime for compiled host runtime helpers');
assert.ok(!((providerNodeManifest.dependencies || {})['@pulse-compute/wasm-compiler']), 'provider-node must not depend on compiler');
const providerFastlyManifest = readJson(path.join(repoRoot, 'packages', 'provider-fastly', 'package.json'));
assert.equal(fs.existsSync(path.join(wasmRoot, 'packages', 'provider-fastly')), false, 'Fastly product provider must be extracted from wasm/packages');
assert.equal(providerFastlyManifest.name, '@pulse-compute/provider-fastly', 'Fastly provider must use the product package name');
assert.ok(providerFastlyManifest.dependencies && providerFastlyManifest.dependencies['@pulse-compute/wasm-build-support'], 'provider-fastly must depend on build-support for shared build helpers');
assert.ok(providerFastlyManifest.dependencies && providerFastlyManifest.dependencies['@pulse-compute/wasm-contracts'], 'provider-fastly must depend on canonical contracts');
assert.ok(providerFastlyManifest.dependencies && providerFastlyManifest.dependencies['@pulse-compute/wasm-host-runtime'], 'provider-fastly must depend on the canonical host runtime');
assert.ok(!((providerFastlyManifest.dependencies || {})['@pulse-compute/wasm-compiler']), 'provider-fastly must not depend on compiler');
const compilerManifest = readJson(path.join(wasmRoot, 'packages', 'compiler', 'package.json'));
const compilerExports = compilerManifest.exports || {};
for (const subpath of ['./codegen/*', './definitions/*', './patterns/*', './kv-provider', './compiled-wasm-host-runtime-kv', './compiled-wasm-node-adapter-kv', './runtime-provider-shape']) {
  assert.ok(!compilerExports[subpath], `wasm compiler package must not expose internal ${subpath}`);
}
for (const subpath of ['.', './cli', './extractor', './config-resolver', './diagnostics', './build-manifest', './provider-toolchain', './project-target-support']) {
  assert.ok(compilerExports[subpath], `wasm compiler package must keep public ${subpath} export`);
}
assert.ok(compilerManifest.dependencies && compilerManifest.dependencies['@pulse-compute/wasm-build-support'], 'wasm compiler package must depend on build-support for shared build helpers');
assert.ok(compilerManifest.dependencies && compilerManifest.dependencies['@pulse-compute/wasm-library-kit'], 'wasm compiler package must depend on library-kit for package-owned library builders');
assert.ok(compilerManifest.dependencies && compilerManifest.dependencies['@pulse-compute/wasm-host-runtime'], 'wasm compiler package must depend on host-runtime for package-owned host builders');
assert.ok(compilerManifest.dependencies && compilerManifest.dependencies['@pulse-compute/wasm-schema-json'], 'wasm compiler package must depend on schema-json for package-owned schema builders');
assert.ok(compilerManifest.dependencies && compilerManifest.dependencies['@pulse-compute/wasm-runtime-core-as'], 'wasm compiler package must depend on runtime-core-as for package-owned AS builders');
assert.ok(compilerManifest.dependencies && compilerManifest.dependencies['@pulse-compute/provider-node'], 'wasm compiler package must depend on provider-node for package-owned Node provider builders');
assert.ok(compilerManifest.dependencies && compilerManifest.dependencies['@pulse-compute/provider-fastly'], 'wasm compiler package must depend on provider-fastly for package-owned Fastly provider builders');
assert.ok(compilerManifest.dependencies && compilerManifest.dependencies.assemblyscript, 'wasm compiler package must own AssemblyScript as a runtime dependency for packed pulse compile workflows');
assert.ok(!(compilerManifest.devDependencies && compilerManifest.devDependencies.assemblyscript), 'wasm compiler package must not duplicate the AssemblyScript runtime dependency as a devDependency');
assert.ok(!(compilerManifest.bin && compilerManifest.bin.pulse), 'wasm compiler must not own the product-facing pulse binary');
assert.ok(!compilerExports['./workflow-cli'] && !compilerExports['./dev-ergonomics'], 'wasm compiler must not expose retired product workflow modules');
const cliManifest = readJson(path.join(wasmRoot, 'packages', 'cli', 'package.json'));
assert.equal(cliManifest.name, '@pulse-compute/cli', 'CLI stays in wasm/packages/cli while publishing under the concise product package name');
assert.equal(cliManifest.bin && cliManifest.bin.pulse, './bin/pulse.js', 'wasm CLI package must exclusively own the product-facing pulse binary');
for (const dependency of ['@pulse-compute/wasm-build-support', '@pulse-compute/wasm-compiler', '@pulse-compute/wasm-contracts', '@pulse-compute/wasm-schema-json', 'typescript']) {
  assert.ok(cliManifest.dependencies && cliManifest.dependencies[dependency], `wasm CLI package must declare ${dependency}`);
}
assert.equal(Boolean(cliManifest.dependencies && cliManifest.dependencies['@pulse-compute/provider-fastly']), false, 'wasm CLI package must not depend directly on provider-fastly');
assert.equal(Boolean(cliManifest.dependencies && cliManifest.dependencies['@pulse-compute/provider-node']), false, 'wasm CLI package must not depend directly on provider-node');
for (const subpath of ['.', './workflow', './project-config', './project-execution']) {
  assert.ok(cliManifest.exports && cliManifest.exports[subpath], `wasm CLI package must expose ${subpath}`);
}

const lockfile = read(path.join(repoRoot, 'pnpm-lock.yaml'));
const cliLockBlock = (lockfile.match(/\n  wasm\/packages\/cli:\n[\s\S]*?(?=\n  wasm\/packages\/|\n\npackages:|$)/) || [''])[0];
const compilerLockBlock = (lockfile.match(/\n  wasm\/packages\/compiler:\n[\s\S]*?(?=\n  wasm\/packages\/|\n\npackages:|$)/) || [''])[0];
const libraryKitLockBlock = (lockfile.match(/\n  wasm\/packages\/library-kit:\n[\s\S]*?(?=\n  wasm\/packages\/|\n\npackages:|$)/) || [''])[0];
assert.ok(/\n  wasm:\n\s+devDependencies:\n\s+assemblyscript:/m.test(lockfile), 'pnpm-lock.yaml must contain a wasm importer with assemblyscript');
assert.ok(
  cliLockBlock.includes("'@pulse-compute/wasm-build-support':")
    && cliLockBlock.includes("'@pulse-compute/wasm-compiler':")
    && cliLockBlock.includes("'@pulse-compute/wasm-contracts':")
    && cliLockBlock.includes("'@pulse-compute/wasm-schema-json':")
    && cliLockBlock.includes('typescript:'),
  'pnpm-lock.yaml must contain CLI dependencies for compiler, canonical contracts, schema support, build support, and TypeScript'
);
assert.ok(!cliLockBlock.includes("'@pulse-compute/provider-node':") && !cliLockBlock.includes("'@pulse-compute/provider-fastly':"), 'pnpm-lock.yaml CLI importer must not contain concrete provider dependencies');
assert.ok(/\n  wasm\/packages\/build-support:\n\s+dependencies:\n\s+'@pulse-compute\/wasm-contracts':/m.test(lockfile), 'pnpm-lock.yaml must contain a build-support importer with contracts dependency');
assert.ok(lockfile.includes('  wasm/packages/compiler:') && lockfile.includes("'@pulse-compute/wasm-library-kit':"), 'pnpm-lock.yaml must contain a compiler importer dependency on library-kit');
assert.ok(lockfile.includes('  wasm/packages/compiler:') && lockfile.includes("'@pulse-compute/wasm-host-runtime':"), 'pnpm-lock.yaml must contain a compiler importer dependency on host-runtime');
assert.ok(lockfile.includes('  wasm/packages/compiler:') && lockfile.includes("'@pulse-compute/wasm-schema-json':"), 'pnpm-lock.yaml must contain a compiler importer dependency on schema-json');
assert.ok(lockfile.includes('  wasm/packages/compiler:') && lockfile.includes("'@pulse-compute/wasm-runtime-core-as':"), 'pnpm-lock.yaml must contain a compiler importer dependency on runtime-core-as');
assert.ok(lockfile.includes('  wasm/packages/compiler:') && lockfile.includes("'@pulse-compute/provider-node':"), 'pnpm-lock.yaml must contain a compiler importer dependency on provider-node');
assert.ok(lockfile.includes('  wasm/packages/compiler:') && lockfile.includes("'@pulse-compute/provider-fastly':"), 'pnpm-lock.yaml must contain a compiler importer dependency on provider-fastly');
assert.ok(lockfile.includes('  wasm/packages/library-kit:') && lockfile.includes("'@pulse-compute/wasm-build-support':") && lockfile.includes("'@pulse-compute/wasm-contracts':"), 'pnpm-lock.yaml must contain a library-kit importer with build-support and contracts dependencies');
assert.ok(lockfile.includes('  wasm/packages/host-runtime:') && lockfile.includes("'@pulse-compute/wasm-build-support':") && lockfile.includes("'@pulse-compute/wasm-contracts':"), 'pnpm-lock.yaml must contain a host-runtime importer with build-support and contracts dependencies');
const schemaJsonLockBlock = (lockfile.match(/\n  wasm\/packages\/schema-json:\n[\s\S]*?(?=\n  wasm\/packages\/|\n\npackages:|$)/) || [''])[0];
assert.ok(schemaJsonLockBlock.includes("'@pulse-compute/wasm-build-support':") && schemaJsonLockBlock.includes("'@pulse-compute/wasm-contracts':") && schemaJsonLockBlock.includes('typescript:'), 'pnpm-lock.yaml must contain a schema-json importer with build-support, contracts, and typescript dependencies');
assert.ok(!schemaJsonLockBlock.includes('@pulse-compute/wasm-compiler'), 'pnpm-lock.yaml must not contain a schema-json importer compiler dependency');
assert.ok(!libraryKitLockBlock.includes('@pulse-compute/wasm-compiler'), 'pnpm-lock.yaml must not contain a library-kit importer compiler dependency');
const providerNodeLockBlock = (lockfile.match(/\n  packages\/provider-node:\n[\s\S]*?(?=\n  (?:packages|wasm\/packages)\/|\n\npackages:|$)/) || [''])[0];
const providerFastlyLockBlock = (lockfile.match(/\n  packages\/provider-fastly:\n[\s\S]*?(?=\n  (?:packages|wasm\/packages)\/|\n\npackages:|$)/) || [''])[0];
assert.ok(providerNodeLockBlock.includes("'@pulse-compute/wasm-build-support':") && providerNodeLockBlock.includes("'@pulse-compute/wasm-contracts':") && providerNodeLockBlock.includes("'@pulse-compute/wasm-host-runtime':"), 'pnpm-lock.yaml must contain a provider-node importer with build-support, contracts, and host-runtime dependencies');
assert.ok(providerFastlyLockBlock.includes("'@pulse-compute/wasm-build-support':") && providerFastlyLockBlock.includes("'@pulse-compute/wasm-contracts':") && providerFastlyLockBlock.includes("'@pulse-compute/wasm-host-runtime':"), 'pnpm-lock.yaml must contain the extracted provider-fastly importer with build-support, contracts, and host-runtime dependencies');
assert.ok(!providerNodeLockBlock.includes('@pulse-compute/wasm-compiler'), 'pnpm-lock.yaml must not contain a provider-node importer compiler dependency');
assert.ok(!providerFastlyLockBlock.includes('@pulse-compute/wasm-compiler'), 'pnpm-lock.yaml must not contain a provider-fastly importer compiler dependency');
assert.ok(compilerLockBlock.includes('    dependencies:') && compilerLockBlock.includes('      assemblyscript:'), 'pnpm-lock.yaml must keep AssemblyScript in the compiler importer runtime dependencies');
assert.ok(!compilerLockBlock.includes('    devDependencies:'), 'pnpm-lock.yaml must not duplicate AssemblyScript in compiler importer devDependencies');
assert.ok(!/packages\.applied-caas-gateway\d*\.internal\.api\.openai\.org/.test(lockfile), 'pnpm-lock.yaml must not contain OpenAI-internal artifact registry URLs');
assert.ok(!/\btarball:\s*https?:\/\//.test(lockfile), 'pnpm-lock.yaml must not pin explicit registry tarball URLs');

const forbiddenLockfiles = [];
walk(repoRoot, (_full, rel, isDir) => {
  if (isDir) return;
  if (rel === 'pnpm-lock.yaml') return;
  if (/^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock)$/.test(path.basename(rel))) forbiddenLockfiles.push(rel);
});
assert.deepEqual(forbiddenLockfiles, [], 'workspace must not contain npm/yarn lockfiles alongside pnpm-lock.yaml');

const forbiddenProcessToolReferences = [];
walk(wasmRoot, (full, rel, isDir) => {
  if (isDir) return;
  if (!/\.(?:cjs|js|json|md)$/.test(rel)) return;
  const source = read(full);
  if (rel.endsWith('test/assert-workspace-hygiene.cjs')) return;
  if (/\bsetsid\b/.test(source)) forbiddenProcessToolReferences.push(rel);
});
assert.deepEqual(forbiddenProcessToolReferences, [], 'wasm test/build scripts must not require non-portable setsid');

console.log('ok - workspace package-manager hygiene is pnpm-only and portable');
