#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const assetsRoot = path.join(repoRoot, 'packages', 'assets');

const assetsContracts = require(path.join(wasmRoot, 'packages', 'contracts', 'src', 'assets', 'contracts.js'));
const libraryManifest = require(path.join(wasmRoot, 'packages', 'contracts', 'src', 'library', 'manifest.js'));
const handlerLibraryContracts = require(path.join(wasmRoot, 'packages', 'library-kit', 'src', 'compiler', 'handler-library-contracts.js'));
const libraryKitAssetsLowering = require(path.join(wasmRoot, 'packages', 'library-kit', 'src', 'compiler', 'assets-lowering.js'));
const packageAssetsLowering = require(path.join(assetsRoot, 'pulsewasm.compiler.cjs'));
const assetsManifest = require(path.join(assetsRoot, 'pulsewasm.manifest.cjs'));

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

function sourceFile(name, text) {
  return ts.createSourceFile(path.join(repoRoot, 'fixtures', name), text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function buildPlan(builder) {
  return builder({
    cwd: repoRoot,
    workspaceRoot: repoRoot,
    sourceFile: sourceFile('assets-package-owned-lowering.ts', `
      import { assets } from '@pulse-compute/assets';
      export async function handler(ctx) {
        const found = await assets.lookup(ctx, 'public', '/app.js', { method: 'GET', cacheControl: 'public, max-age=60' });
        return assets.respond(found);
      }
    `),
    generatedBy: 'test',
    typescript: ts
  });
}

const assetsPackageJson = readJson(path.join(assetsRoot, 'package.json'));
assert.equal(assetsManifest.version, libraryManifest.LOWERABLE_LIBRARY_MANIFEST_VERSION, 'assets manifest must use the v2 package-owned compiler-builder manifest contract');
assert.equal(assetsManifest.compiler.version, 'pulsewasm.lowerable-compiler-builder.v1', 'assets manifest must declare the lowerable compiler builder protocol');
assert.equal(assetsManifest.compiler.entry, './pulsewasm.compiler.cjs', 'assets manifest must point at the package-owned compiler entry');
assert.equal(assetsManifest.compiler.export, 'buildAssetsLoweringPlan', 'assets manifest must name the package-owned builder export');
assert.equal(assetsManifest.compiler.builderOwner, '@pulse-compute/assets', 'assets package must own its assets-specific lowerer');
assert.equal(assetsManifest.compiler.trust, 'first-party', 'assets package-owned lowerer must be explicitly first-party trusted');
assert.equal(libraryManifest.validateLowerableLibraryManifest(assetsManifest).status, 'ok', 'v2 assets lowerable manifest must validate');

assert.ok(assetsPackageJson.exports['./pulsewasm/compiler'], '@pulse-compute/assets must export ./pulsewasm/compiler');
assert.equal(assetsPackageJson.exports['./pulsewasm/compiler'].require, './pulsewasm.compiler.cjs', 'compiler export must point at the package-owned CJS builder');
assert.ok(assetsPackageJson.files.includes('pulsewasm.compiler.cjs'), 'packed assets package must include the compiler builder');
assert.ok(assetsPackageJson.files.includes('as'), 'packed assets package must include the AS sidecar directory');
assert.equal(assetsManifest.modes.wasm.sidecar, './as/index.as.ts', 'assets manifest must declare the package-owned AS sidecar');
assert.ok(fs.existsSync(path.join(assetsRoot, 'as', 'index.as.ts')), 'assets package must ship the declared AS sidecar source');
assert.equal(typeof packageAssetsLowering.buildAssetsLoweringPlan, 'function', 'package-owned compiler builder must export buildAssetsLoweringPlan');
assert.equal(typeof packageAssetsLowering.buildAssetsCompiledWasmSidecarPlan, 'function', 'package-owned compiler builder must export buildAssetsCompiledWasmSidecarPlan');
assert.equal(packageAssetsLowering.assetsLoweringBuilder.owner, '@pulse-compute/assets', 'package-owned builder descriptor must record @pulse-compute/assets ownership');
assert.equal(packageAssetsLowering.assetsCompiledWasmSidecarBuilder.owner, '@pulse-compute/assets', 'package-owned sidecar builder descriptor must record @pulse-compute/assets ownership');

const discovered = handlerLibraryContracts.discoverLowerableLibraryManifests({ cwd: repoRoot })
  .find((entry) => entry.manifest.contractId === assetsContracts.ASSETS_CONTRACT_ID);
assert.ok(discovered, 'library-kit must discover the assets package manifest');
assert.equal(discovered.validation.status, 'ok', 'discovered v2 assets manifest must validate');
const resolution = handlerLibraryContracts.resolveLowerableCompilerBuilder(discovered);
assert.equal(resolution.status, 'ok', 'library-kit generic compiler builder resolution must validate');
assert.equal(path.relative(repoRoot, resolution.entry).replace(/\\/g, '/'), 'packages/assets/pulsewasm.compiler.cjs', 'generic loader must resolve the package-owned compiler builder');
const loaded = handlerLibraryContracts.loadLowerableCompilerBuilder(discovered);
assert.equal(loaded.exportName, 'buildAssetsLoweringPlan', 'generic loader must use manifest compiler.export');
assert.equal(typeof loaded.builder, 'function', 'generic loader must return the package-owned builder function');

const packagePlan = buildPlan(packageAssetsLowering.buildAssetsLoweringPlan);
const wrapperPlan = buildPlan(libraryKitAssetsLowering.buildAssetsLoweringPlan);
const packageSidecarPlan = packageAssetsLowering.buildAssetsCompiledWasmSidecarPlan({
  cwd: repoRoot,
  packageDir: assetsRoot,
  manifest: assetsManifest,
  assetsLoweringPlan: packagePlan.artifact,
  generatedBy: 'test'
});
const wrapperSidecarPlan = libraryKitAssetsLowering.buildAssetsCompiledWasmSidecarPlan({
  cwd: repoRoot,
  workspaceRoot: repoRoot,
  assetsLoweringPlan: wrapperPlan.artifact,
  generatedBy: 'test'
});
assert.equal(packageSidecarPlan.artifact.status, 'ok', 'package-owned sidecar builder must emit a clean compiled-Wasm sidecar plan');
assert.equal(wrapperSidecarPlan.artifact.status, 'ok', 'library-kit wrapper must emit a clean compiled-Wasm sidecar plan through the package builder');
assert.equal(packageSidecarPlan.artifact.version, assetsContracts.ASSETS_COMPILED_WASM_SIDECAR_PLAN_VERSION, 'sidecar plan version remains contract-owned');
assert.equal(wrapperSidecarPlan.artifact.sidecar.exists, true, 'library-kit wrapper sidecar plan must find the package-owned sidecar');
for (const result of [packagePlan, wrapperPlan]) {
  assert.equal(result.artifact.status, 'ok', 'package-owned assets builder must emit a clean plan');
  assert.equal(result.artifact.version, assetsContracts.ASSETS_LOWERING_PLAN_VERSION, 'plan version remains contract-owned');
  assert.equal(result.artifact.policy.builderOwner, '@pulse-compute/assets', 'assets lowering plan must record package-owned builder ownership');
  assert.equal(result.artifact.policy.compilerOwnsPackageMapping, false, 'compiler must not own assets package mapping');
  assert.equal(result.artifact.entries.length, 1, 'static lookup/respond must produce one plan entry');
  assert.equal(result.artifact.entries[0].lookup.store, 'public');
  assert.equal(result.artifact.entries[0].lookup.key, '/app.js');
  assert.equal(result.artifact.entries[0].response.payloadMode, 'text-response-body');
}
assert.deepEqual(wrapperPlan.artifact.entries, packagePlan.artifact.entries, 'library-kit generic wrapper must preserve the package builder plan entries');

const libraryKitAssetsSource = read(path.join(wasmRoot, 'packages', 'library-kit', 'src', 'compiler', 'assets-lowering.js'));
assert.doesNotMatch(libraryKitAssetsSource, /collectFacadeBindings|lookupLocals|respondLocals|assets\.lookup requires|assets\.respond requires/, 'library-kit assets-lowering wrapper must not own assets-specific AST rules');
assert.match(libraryKitAssetsSource, /loadLowerableCompilerBuilder/, 'library-kit must load package-owned builders generically');

const compilerSource = read(path.join(wasmRoot, 'packages', 'compiler', 'src', 'extractor.js'));
assert.doesNotMatch(compilerSource, /@pulse-compute\/assets\/pulsewasm/, 'compiler must not hard-code the assets lowerable subpath');
assert.match(compilerSource, /buildAssetsLoweringPlan/, 'compiler may continue to orchestrate assets plan emission');

const facadeSource = read(path.join(assetsRoot, 'src', 'pulsewasm.ts'));
assert.match(facadeSource, /PulseWasmAssetsLoweringError/, 'direct PulseWasm assets facade runtime execution must still throw');
assert.match(facadeSource, /lowerableOnly/, 'facade must remain validate/lower only');
const assetsPackage = readJson(path.join(assetsRoot, 'package.json'));
assert.equal(assetsPackage.exports['.'].import, './dist/index.js', 'assets root must expose the canonical JavaScript and lowerable package surface');
assert.equal(assetsPackage.exports['.'].default, './dist/index.js', 'assets root must resolve from generated CommonJS application packages');
const compositionMarker = read(path.join(assetsRoot, 'src', 'index.ts'));
assert.match(compositionMarker, /AssetManager/, 'assets root must expose the restored JavaScript implementation');
assert.match(compositionMarker, /assets/, 'assets root must expose the canonical lowerable namespace');
assert.doesNotMatch(facadeSource, /from ['"]\.\/index\.js['"]|from ['"]\.\/asset-manager\.js['"]|from ['"]\.\/asset-bucket\.js['"]/, 'lowerable facade must not import normal runtime API');

console.log('ok - Assets package-owned lowering validates the canonical root, generic loader, and JavaScript implementation');
