#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const wasmRoot = path.resolve(__dirname, '..');
const packagesRoot = path.join(wasmRoot, 'packages');
const repoRoot = path.resolve(wasmRoot, '..');
const productPackagesRoot = path.join(repoRoot, 'packages');
const providerFastlyRoot = path.join(repoRoot, 'packages', 'provider-fastly');
const providerNodeRoot = path.join(repoRoot, 'packages', 'provider-node');
const expectedPackages = [
  'build-support',
  'cli',
  'compiler',
  'contracts',
  'host-runtime',
  'library-kit',
  'runtime-core-as',
  'schema-json',
  'wasm-guest-link'
];

const allowedCompilerDependencyPackages = new Set([
  'cli'
]);

const allowedCompilerPublicImports = new Map([
  ['packages/cli/bin/pulsewasm-extract.js', new Set(['@pulse-compute/wasm-compiler/cli'])],
  ['packages/cli/src/index.js', new Set(['@pulse-compute/wasm-compiler/cli'])],
  ['packages/cli/src/project-config.js', new Set(['@pulse-compute/wasm-compiler/project-config-compiler'])],
  ['packages/cli/src/provider-drivers.js', new Set(['@pulse-compute/wasm-compiler/provider-toolchain'])],
  ['packages/cli/src/target-support.js', new Set(['@pulse-compute/wasm-compiler/project-target-support'])],
  ['packages/cli/src/project-execution.js', new Set([
    '@pulse-compute/wasm-compiler/canonical-api-compiler',
    '@pulse-compute/wasm-compiler/canonical-project-compiler',
    '@pulse-compute/wasm-compiler/canonical-native-plan',
    '@pulse-compute/wasm-compiler/canonical-native-compiler',
    '@pulse-compute/wasm-compiler/javascript-application-plan'
  ])]
]);

function rel(file) {
  return path.relative(file.startsWith(wasmRoot) ? wasmRoot : repoRoot, file).replace(/\\/g, '/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hasDependency(manifest, depName) {
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .some((section) => manifest[section] && Object.prototype.hasOwnProperty.call(manifest[section], depName));
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, files);
    } else if (/\.(?:js|cjs|mjs|ts|tsx|json|md)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function walkExecutablePackageFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'test', 'tests', 'docs', 'examples', 'conformance', 'artifacts'].includes(entry.name)) continue;
      walkExecutablePackageFiles(full, files);
    } else if (/\.(?:js|cjs|mjs|ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function assertProviderConformanceImports(packageFiles) {
  const contract = readJson(path.join(wasmRoot, 'test', 'contracts', 'provider-package-conformance-imports.json'));
  assert.equal(contract.version, 'pulse.provider-package-conformance-imports.v1');
  assert.equal(contract.owner, 'provider-package-conformance');
  const allowed = new Set(contract.imports.map((entry) => `${entry.file}\0${entry.specifier}`));
  const observed = new Set();
  for (const file of packageFiles.filter((entry) => /\.(?:ts|tsx)$/.test(entry))) {
    const fileRel = path.relative(repoRoot, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    for (const request of requireTargets(text)) {
      if (!request.startsWith('.')) continue;
      const target = path.normalize(path.join(path.dirname(fileRel), request)).replace(/\\/g, '/');
      if (!/^packages\/provider-(?:node|fastly)\/src\//.test(target)) continue;
      const key = `${fileRel}\0${request}`;
      assert.ok(allowed.has(key), `${fileRel} imports provider-private source through ${request} without the named conformance contract`);
      observed.add(key);
    }
  }
  assert.deepEqual([...observed].sort(), [...allowed].sort(), 'provider conformance import allowlist must be exact and fully observed');
}

function assertNoForbiddenContractsSourceReferences(contractsDir) {
  const contractsSourceRoot = path.join(contractsDir, 'src');
  for (const file of walk(contractsSourceRoot)) {
    const fileRel = rel(file);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('@pulse-compute/wasm-compiler'), `${fileRel} must not depend on the compiler package`);
    assert.ok(!text.includes('../../compiler'), `${fileRel} must not require compiler source`);
    assert.ok(!text.includes('../compiler'), `${fileRel} must not require compiler source`);
    assert.ok(!text.includes('packages/compiler/src'), `${fileRel} must not reference compiler internals`);
  }
}

function normalizeRelativeTarget(fileRel, request) {
  return path.normalize(path.join(path.dirname(fileRel), request)).replace(/\\/g, '/');
}

function requireTargets(text) {
  const targets = [];
  const requirePattern = /require\(['"]([^'"]+)['"]\)/g;
  let match;
  while ((match = requirePattern.exec(text))) targets.push(match[1]);
  return targets;
}

function moduleTargets(text) {
  const targets = new Set(requireTargets(text));
  const staticPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = staticPattern.exec(text))) targets.add(match[1]);
  while ((match = dynamicPattern.exec(text))) targets.add(match[1]);
  return [...targets];
}

function maskCommentsAndTemplates(source) {
  let output = '';
  let index = 0;
  let state = 'code';
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (current === '/' && next === '/') {
        output += '  ';
        index += 2;
        state = 'line-comment';
      } else if (current === '/' && next === '*') {
        output += '  ';
        index += 2;
        state = 'block-comment';
      } else if (current === '`') {
        output += ' ';
        index += 1;
        state = 'template';
      } else if (current === "'") {
        output += current;
        index += 1;
        state = 'single-quote';
      } else if (current === '"') {
        output += current;
        index += 1;
        state = 'double-quote';
      } else {
        output += current;
        index += 1;
      }
      continue;
    }
    if (state === 'line-comment') {
      output += current === '\n' ? '\n' : ' ';
      index += 1;
      if (current === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        output += '  ';
        index += 2;
        state = 'code';
      } else {
        output += current === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    if (state === 'template') {
      if (current === '\\') {
        output += ' ';
        if (index + 1 < source.length) output += source[index + 1] === '\n' ? '\n' : ' ';
        index += 2;
      } else {
        output += current === '\n' ? '\n' : ' ';
        index += 1;
        if (current === '`') state = 'code';
      }
      continue;
    }
    output += current;
    index += 1;
    if (current === '\\' && index < source.length) {
      output += source[index];
      index += 1;
    } else if ((state === 'single-quote' && current === "'") || (state === 'double-quote' && current === '"')) {
      state = 'code';
    }
  }
  return output;
}

function assertDeclaredWorkspacePackageImports() {
  const packageDirs = [
    ...fs.readdirSync(productPackagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(productPackagesRoot, entry.name)),
    ...fs.readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(packagesRoot, entry.name))
  ].filter((dir) => fs.existsSync(path.join(dir, 'package.json')));
  const packagesByName = new Map(packageDirs.map((dir) => {
    const manifest = readJson(path.join(dir, 'package.json'));
    return [manifest.name, Object.freeze({ dir, manifest })];
  }));

  for (const owner of packagesByName.values()) {
    for (const file of walkExecutablePackageFiles(owner.dir)) {
      const fileRel = path.relative(repoRoot, file).replace(/\\/g, '/');
      const source = maskCommentsAndTemplates(fs.readFileSync(file, 'utf8'));
      for (const request of moduleTargets(source)) {
        if (!request.startsWith('@pulse-compute/')) continue;
        const segments = request.split('/');
        const dependencyName = segments.slice(0, 2).join('/');
        const subpath = segments.slice(2).join('/');
        const dependency = packagesByName.get(dependencyName);
        assert.ok(dependency, `${fileRel} imports unknown workspace package ${dependencyName}`);
        if (dependencyName !== owner.manifest.name) {
          assert.ok(
            hasDependency(owner.manifest, dependencyName),
            `${fileRel} imports ${request} without declaring ${dependencyName}`
          );
        }
        if (subpath) {
          const exportKey = `./${subpath}`;
          assert.ok(
            dependency.manifest.exports && Object.prototype.hasOwnProperty.call(dependency.manifest.exports, exportKey),
            `${fileRel} imports unexported workspace entry ${request}`
          );
        }
      }
    }
  }
}

function assertNoProductTestPrivateToolchainImports() {
  for (const entry of fs.readdirSync(productPackagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const testRoot = path.join(productPackagesRoot, entry.name, 'test');
    for (const file of walk(testRoot)) {
      if (!/\.(?:js|cjs|mjs|ts|tsx)$/.test(file)) continue;
      const fileRel = path.relative(repoRoot, file).replace(/\\/g, '/');
      for (const request of moduleTargets(fs.readFileSync(file, 'utf8'))) {
        if (!request.startsWith('.')) continue;
        const target = normalizeRelativeTarget(fileRel, request);
        assert.ok(
          !target.startsWith('wasm/packages/compiler/src/') && !target.startsWith('wasm/packages/contracts/src/'),
          `${fileRel} imports private toolchain source through ${request}; use a declared package entry or move compiler conformance under wasm/test`
        );
      }
    }
  }
}

function assertEntitiesSchemaBridgeImports() {
  const entitiesSourceRoot = path.join(repoRoot, 'packages', 'entities', 'src');
  for (const file of walk(entitiesSourceRoot)) {
    if (!/\.(?:ts|tsx|js|cjs|mjs)$/.test(file)) continue;
    const fileRel = path.relative(repoRoot, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    for (const request of moduleTargets(text)) {
      const forbiddenPublic = request.startsWith('@pulse-compute/runtime/')
        && request !== '@pulse-compute/runtime/package';
      const forbiddenAuthority = /^@pulse-compute\/(?:wasm-schema-json|wasm-compiler|provider-(?:node|fastly))(?:\/|$)/.test(request);
      const relativeTarget = request.startsWith('.')
        ? normalizeRelativeTarget(fileRel, request)
        : '';
      const forbiddenPrivate = relativeTarget.startsWith('packages/runtime/src/')
        || relativeTarget.startsWith('wasm/packages/schema-json/src/')
        || relativeTarget.startsWith('packages/provider-node/src/')
        || relativeTarget.startsWith('packages/provider-fastly/src/');
      assert.ok(
        !forbiddenPublic && !forbiddenAuthority && !forbiddenPrivate,
        `${fileRel} imports ${request}; Entities schema access must use only @pulse-compute/runtime/package`
      );
    }
  }
}

function assertNoCompilerWrapperDebt(packageFiles) {
  for (const file of packageFiles) {
    const fileRel = rel(file);
    if (fileRel.startsWith('packages/compiler/')) continue;

    const allowedPublicImports = allowedCompilerPublicImports.get(fileRel) || new Set();
    const text = fs.readFileSync(file, 'utf8');

    for (const request of requireTargets(text)) {
      if (request.startsWith('@pulse-compute/wasm-compiler')) {
        assert.ok(
          allowedPublicImports.has(request),
          `${fileRel} imports ${request}; only CLI may import an explicitly approved public compiler entrypoint`
        );
        continue;
      }

      if (!request.startsWith('.')) continue;
      const target = normalizeRelativeTarget(fileRel, request);
      assert.ok(
        !target.startsWith('packages/compiler/src/') && !target.startsWith('wasm/packages/compiler/src/'),
        `${fileRel} imports compiler internals through ${request}; import a package-owned public surface instead`
      );
    }
  }

  for (const [fileRel, allowed] of allowedCompilerPublicImports) {
    assert.ok(fs.existsSync(path.join(wasmRoot, fileRel)), `allowed compiler public import file must exist: ${fileRel}`);
    const text = fs.readFileSync(path.join(wasmRoot, fileRel), 'utf8');
    for (const request of allowed) {
      assert.ok(text.includes(request), `${fileRel} must import compiler through public entrypoint ${request}`);
    }
  }
}

assert.ok(fs.existsSync(packagesRoot), 'wasm/packages directory must exist');
for (const packageName of expectedPackages) {
  const packageDir = path.join(packagesRoot, packageName);
  const manifestPath = path.join(packageDir, 'package.json');
  assert.ok(fs.existsSync(manifestPath), `wasm/packages/${packageName}/package.json must exist`);
  const manifest = readJson(manifestPath);
  const expectedName = packageName === 'cli'
    ? '@pulse-compute/cli'
    : packageName === 'wasm-guest-link'
      ? '@pulse-compute/wasm-guest-link'
      : `@pulse-compute/wasm-${packageName}`;
  assert.equal(manifest.name, expectedName, `${packageName} workspace package name should remain stable`);

  if (packageName === 'compiler') {
    assert.ok(hasDependency(manifest, '@pulse-compute/wasm-contracts'), 'compiler package should depend on contracts');
  }

  const dependsOnCompiler = hasDependency(manifest, '@pulse-compute/wasm-compiler');
  if (packageName === 'contracts') {
    assert.ok(!dependsOnCompiler, 'contracts package must not depend on compiler');
  } else if (packageName !== 'compiler') {
    assert.ok(
      !dependsOnCompiler || allowedCompilerDependencyPackages.has(packageName),
      `${packageName} depends on compiler; only cli may depend on the compiler public package surface`
    );
  }
}


assert.equal(fs.existsSync(path.join(packagesRoot, 'provider-fastly')), false, 'Fastly product provider must not remain under wasm/packages');
assert.equal(fs.existsSync(path.join(packagesRoot, 'provider-node')), false, 'Node product provider must not remain under wasm/packages');
const providerFastlyManifestPath = path.join(providerFastlyRoot, 'package.json');
assert.ok(fs.existsSync(providerFastlyManifestPath), 'packages/provider-fastly/package.json must exist');
const providerFastlyManifest = readJson(providerFastlyManifestPath);
assert.equal(providerFastlyManifest.name, '@pulse-compute/provider-fastly');
assert.equal(providerFastlyManifest.exports['./toolchain'], './src/toolchain/index.js', 'Fastly must expose its provider-owned toolchain entry');
assert.ok(hasDependency(providerFastlyManifest, '@pulse-compute/wasm-contracts'), 'Fastly provider should depend on canonical contracts');
assert.ok(hasDependency(providerFastlyManifest, '@pulse-compute/wasm-host-runtime'), 'Fastly provider should depend on the canonical host runtime');
assert.ok(hasDependency(providerFastlyManifest, '@pulse-compute/wasm-runtime-core-as'), 'Fastly native realization should depend directly on the canonical Native generator');
assert.equal(hasDependency(providerFastlyManifest, '@pulse-compute/wasm-compiler'), false, 'Fastly provider must not depend on the compiler');
const fastlyDefault = fs.readFileSync(path.join(providerFastlyRoot, 'src', 'index.js'), 'utf8');
assert.ok(!fastlyDefault.includes('./compiler'), 'Fastly default API must not expose compiler internals');
assert.ok(!fastlyDefault.includes('./runtime'), 'Fastly default API must not expose runtime internals');
for (const file of walk(path.join(providerFastlyRoot, 'src'))) {
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes('wasm/packages/provider-fastly'), `${path.relative(repoRoot, file).replace(/\\/g, '/')} must not reference the retired wasm package location`);
}

const providerNodeManifestPath = path.join(providerNodeRoot, 'package.json');
assert.ok(fs.existsSync(providerNodeManifestPath), 'packages/provider-node/package.json must exist');
const providerNodeManifest = readJson(providerNodeManifestPath);
assert.equal(providerNodeManifest.name, '@pulse-compute/provider-node');
assert.equal(providerNodeManifest.exports['./toolchain'], './src/toolchain.js', 'Node must expose its provider-owned toolchain entry');
assert.ok(hasDependency(providerNodeManifest, '@pulse-compute/wasm-contracts'), 'Node provider should depend on canonical contracts');
assert.ok(hasDependency(providerNodeManifest, '@pulse-compute/wasm-host-runtime'), 'Node provider should depend on the canonical host runtime');
assert.equal(hasDependency(providerNodeManifest, '@pulse-compute/wasm-compiler'), false, 'Node provider must not depend on the compiler');

for (const entry of fs.readdirSync(wasmRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (['packages', 'test', 'scripts', 'artifacts', 'examples', 'fixtures', 'generated'].includes(entry.name)) continue;
  const obsoleteManifest = path.join(wasmRoot, entry.name, 'package.json');
  assert.ok(!fs.existsSync(obsoleteManifest), `obsolete wasm/${entry.name}/package.json should not exist; use wasm/packages/${entry.name}`);
}

const packageFiles = [...walk(packagesRoot), ...walk(providerFastlyRoot), ...walk(providerNodeRoot)];
const allPackageFiles = [...walk(packagesRoot), ...walk(productPackagesRoot)];
for (const file of packageFiles) {
  const fileRel = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes('wasm/compiler'), `${fileRel} should not hard-code obsolete wasm/compiler path`);
  assert.ok(!text.includes('wasm/contracts'), `${fileRel} should not hard-code obsolete wasm/contracts path`);
  assert.ok(!text.includes('wasm/provider-node'), `${fileRel} should not hard-code obsolete wasm/provider-node path`);
  assert.ok(!text.includes('wasm/provider-fastly'), `${fileRel} should not hard-code obsolete wasm/provider-fastly path`);
}

assertNoForbiddenContractsSourceReferences(path.join(packagesRoot, 'contracts'));
assertNoCompilerWrapperDebt(allPackageFiles);
assertDeclaredWorkspacePackageImports();
assertNoProductTestPrivateToolchainImports();
assertEntitiesSchemaBridgeImports();
assertProviderConformanceImports([
  ...walk(path.join(repoRoot, 'packages', 'assets', 'test')),
  ...walk(path.join(repoRoot, 'packages', 'jwt', 'test'))
]);

const cliManifest = readJson(path.join(packagesRoot, 'cli', 'package.json'));
assert.equal(hasDependency(cliManifest, '@pulse-compute/provider-fastly'), false, 'CLI package must not depend directly on the Fastly provider');
assert.equal(hasDependency(cliManifest, '@pulse-compute/provider-node'), false, 'CLI package must not depend directly on the Node provider');
for (const fileName of ['project-config.js', 'project-config-schema.js', 'project-execution.js']) {
  const file = path.join(packagesRoot, 'cli', 'src', fileName);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes('@pulse-compute/provider-fastly'), `${fileName} must consume provider operations through the fixed toolchain registry`);
  assert.ok(!text.includes('@pulse-compute/provider-node'), `${fileName} must consume reference Node operations through the fixed toolchain registry`);
  assert.ok(!/project\.provider\s*[!=]==?\s*['"](?:node|fastly|none)['"]/.test(text), `${fileName} must not branch on a concrete provider id`);
}

const providerToolchainSource = fs.readFileSync(path.join(packagesRoot, 'compiler', 'src', 'provider-toolchain.js'), 'utf8');
const projectTargetSupportSource = fs.readFileSync(path.join(packagesRoot, 'compiler', 'src', 'project-target-support.js'), 'utf8');
for (const concreteImport of [
  "require('@pulse-compute/provider-fastly",
  "require('@pulse-compute/provider-node"
]) {
  assert.ok(!providerToolchainSource.includes(concreteImport), `compiler provider bootstrap must not import ${concreteImport}`);
  assert.ok(!projectTargetSupportSource.includes(concreteImport), `shared target-support composition must not import ${concreteImport}`);
}
assert.ok(providerToolchainSource.includes("`${packageName}/toolchain`"), 'compiler must resolve the selected formal provider package entry');
assert.ok(providerToolchainSource.includes("const PROVIDER_PACKAGE_SCOPE = '@pulse-compute'"), 'compiler must declare the provider package namespace');
assert.ok(providerToolchainSource.includes("const PROVIDER_PACKAGE_PREFIX = 'provider-'"), 'compiler must declare the provider package convention');
assert.ok(providerToolchainSource.includes('`${PROVIDER_PACKAGE_SCOPE}/${PROVIDER_PACKAGE_PREFIX}${assertPackageName(selector)}`'), 'bare provider ids must resolve through the namespace convention');
assert.equal(providerToolchainSource.includes('OFFICIAL_PROVIDER_PACKAGES'), false, 'compiler must not retain a concrete provider alias table');

const repoArtifacts = path.join(repoRoot, 'artifacts');
assert.ok(!fs.existsSync(repoArtifacts), 'repo-root artifacts/ must not exist; wasm/artifacts is the only generated/reference artifact root');

const wasmArtifacts = path.join(wasmRoot, 'artifacts');
if (fs.existsSync(wasmArtifacts)) {
  assert.ok(fs.statSync(wasmArtifacts).isDirectory(), 'wasm/artifacts must be a directory when generated outputs exist');
}

for (const packageName of expectedPackages) {
  const packageArtifacts = path.join(packagesRoot, packageName, 'artifacts');
  assert.ok(!fs.existsSync(packageArtifacts), `wasm/packages/${packageName}/artifacts must not exist; use wasm/artifacts`);
}

console.log('ok - PulseWasm workspace import/layout boundaries, ephemeral artifact output, and compiler-wrapper debt removal are enforced');
