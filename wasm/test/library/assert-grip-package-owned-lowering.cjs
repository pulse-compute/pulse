#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const gripRoot = path.join(repoRoot, 'packages', 'grip');

const gripContracts = require(path.join(wasmRoot, 'packages', 'contracts', 'src', 'grip', 'contracts.js'));
const libraryManifest = require(path.join(wasmRoot, 'packages', 'contracts', 'src', 'library', 'manifest.js'));
const handlerLibraryContracts = require(path.join(wasmRoot, 'packages', 'library-kit', 'src', 'compiler', 'handler-library-contracts.js'));
const packageLowering = require(path.join(wasmRoot, 'packages', 'library-kit', 'src', 'compiler', 'package-lowering.js'));
const packageGripLowering = require(path.join(gripRoot, 'pulsewasm.compiler.cjs'));
const gripManifest = require(path.join(gripRoot, 'pulsewasm.manifest.cjs'));
const {
  buildWorkspacePackage,
  cleanupWorkspacePackageBuilds
} = require('../support/workspace-package-build.cjs');

buildWorkspacePackage('packages/grip');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

function sourceFile(name, text) {
  return ts.createSourceFile(path.join(repoRoot, 'fixtures', name), text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function buildPositivePlan(builder) {
  return builder({
    cwd: repoRoot,
    workspaceRoot: repoRoot,
    sourceFile: sourceFile('grip-package-owned-lowering-test.js', `
      import { grip } from '@pulse-compute/grip/pulsewasm';
      export function holdDemo() {
        grip.channel('events:demo', { fanout: true });
        return grip.hold('stream', { channels: ['events:demo'], timeoutMs: 30000 });
      }
      export function publishDemo() {
        return grip.publish('events:demo', 'hello beta lifecycle', { event: 'demo.message', id: 'demo-1' });
      }
    `),
    generatedBy: 'test',
    typescript: ts
  });
}

function buildNegativePlan() {
  return packageGripLowering.buildGripLoweringPlan({
    cwd: repoRoot,
    workspaceRoot: repoRoot,
    sourceFile: sourceFile('grip-package-owned-lowering-negative-test.js', `
      import { grip } from '@pulse-compute/grip/pulsewasm';
      const dynamicChannel = 'events:' + Date.now();
      export function badHold(mode, message) {
        return grip.hold(mode, { channels: [dynamicChannel] });
      }
      export function badPublish(message) {
        return grip.publish(dynamicChannel, message);
      }
    `),
    generatedBy: 'test',
    typescript: ts
  });
}

const packageJson = readJson(path.join(gripRoot, 'package.json'));
assert.equal(gripManifest.version, libraryManifest.LOWERABLE_LIBRARY_MANIFEST_VERSION, 'GRIP manifest must use the v2 package-owned compiler-builder manifest contract');
assert.equal(gripManifest.contractId, gripContracts.GRIP_CONTRACT_ID, 'GRIP manifest must bind to pulse.grip');
assert.equal(gripManifest.npmPackage, '@pulse-compute/grip', 'GRIP npm identity must be package-owned');
assert.equal(gripManifest.lowerableSubpath, '@pulse-compute/grip', 'GRIP canonical root must be the package-owned lowerable subpath');
assert.deepEqual(
  gripManifest.publicApi.compatibilitySubpaths,
  ['@pulse-compute/grip/pulsewasm'],
  'GRIP must keep the explicit Native facade subpath'
);
assert.equal(gripManifest.compiler.entry, './pulsewasm.compiler.cjs', 'GRIP manifest must point at the package-owned compiler builder');
assert.equal(gripManifest.compiler.export, 'buildGripLoweringPlan', 'GRIP manifest must name the package-owned lowerer export');
assert.equal(gripManifest.compiler.builderOwner, '@pulse-compute/grip', 'GRIP package must own its lowerer');
assert.equal(gripManifest.compiler.trust, 'first-party', 'GRIP lowerer must be first-party trusted');
assert.equal(libraryManifest.validateLowerableLibraryManifest(gripManifest).status, 'ok', 'GRIP lowerable manifest must validate');

assert.ok(packageJson.exports['./pulsewasm'], '@pulse-compute/grip must export ./pulsewasm');
assert.ok(packageJson.exports['./pulsewasm/manifest'], '@pulse-compute/grip must export ./pulsewasm/manifest');
assert.ok(packageJson.exports['./pulsewasm/compiler'], '@pulse-compute/grip must export ./pulsewasm/compiler');
assert.ok(packageJson.files.includes('pulsewasm.manifest.cjs'), 'packed GRIP package must include the manifest');
assert.ok(packageJson.files.includes('pulsewasm.compiler.cjs'), 'packed GRIP package must include the compiler builder');
assert.ok(packageJson.files.includes('as'), 'packed GRIP package must include the sidecar directory');
assert.ok(fs.existsSync(path.join(gripRoot, 'src', 'pulsewasm.ts')), 'GRIP lowerable facade source must exist');
assert.ok(fs.existsSync(path.join(gripRoot, 'dist', 'pulsewasm.js')), 'GRIP lowerable facade dist JS must exist');
assert.ok(fs.existsSync(path.join(gripRoot, 'dist', 'pulsewasm.d.ts')), 'GRIP lowerable facade dist types must exist');
assert.ok(fs.existsSync(path.join(gripRoot, 'as', 'index.as.ts')), 'GRIP package-owned AS sidecar must exist');

assert.equal(typeof packageGripLowering.buildGripLoweringPlan, 'function', 'GRIP package-owned compiler builder must export buildGripLoweringPlan');
assert.equal(packageGripLowering.gripLoweringBuilder.owner, '@pulse-compute/grip', 'GRIP builder descriptor must record package ownership');

const discovered = handlerLibraryContracts.discoverLowerableLibraryManifests({ cwd: repoRoot, workspaceRoot: repoRoot })
  .find((entry) => entry.manifest.contractId === gripContracts.GRIP_CONTRACT_ID && entry.manifest.npmPackage === '@pulse-compute/grip');
assert.ok(discovered, 'library-kit must discover the package-owned GRIP manifest');
assert.equal(discovered.validation.status, 'ok', 'discovered GRIP manifest must validate');
const resolution = handlerLibraryContracts.resolveLowerableCompilerBuilder(discovered);
assert.equal(resolution.status, 'ok', 'library-kit generic compiler builder resolution must validate for GRIP');
assert.equal(path.relative(repoRoot, resolution.entry).replace(/\\/g, '/'), 'packages/grip/pulsewasm.compiler.cjs', 'generic loader must resolve the GRIP package-owned compiler builder');
const loaded = handlerLibraryContracts.loadLowerableCompilerBuilder(discovered);
assert.equal(loaded.exportName, 'buildGripLoweringPlan', 'generic loader must use GRIP manifest compiler.export');
assert.equal(typeof loaded.builder, 'function', 'generic loader must return the GRIP package-owned builder function');

const packagePlan = buildPositivePlan(packageGripLowering.buildGripLoweringPlan);
const genericPlan = packageLowering.buildPackageOwnedLoweringPlan({
  cwd: repoRoot,
  workspaceRoot: repoRoot,
  contractId: gripContracts.GRIP_CONTRACT_ID,
  sourceFile: sourceFile('grip-package-owned-lowering-generic-test.js', `
    import { grip } from '@pulse-compute/grip/pulsewasm';
    export function holdDemo() {
      grip.channel('events:demo', { fanout: true });
      return grip.hold('stream', { channels: ['events:demo'], timeoutMs: 30000 });
    }
    export function publishDemo() {
      return grip.publish('events:demo', 'hello beta lifecycle', { event: 'demo.message', id: 'demo-1' });
    }
  `),
  generatedBy: 'test',
  typescript: ts
});
function canonicalEffectsFor(result) {
  return result.contributions ? result.contributions.canonicalEffects : result.canonicalEffects;
}
for (const result of [packagePlan, genericPlan]) {
  assert.equal(result.artifact.status, 'ok', 'GRIP lowerer must emit a clean plan for static beta calls');
  assert.equal(result.artifact.version, gripContracts.GRIP_LOWERING_PLAN_VERSION, 'GRIP lowering plan version must be contract-owned');
  assert.equal(result.artifact.packageCompilerBuilder.owner, '@pulse-compute/grip', 'GRIP lowering plan must record package-owned builder ownership');
  assert.equal(result.artifact.entries.length, 3, 'static GRIP hold/channel/publish must produce three plan entries');
  assert.equal(result.artifact.summary.holdEntries, 1, 'plan must include one hold entry');
  assert.equal(result.artifact.summary.channelEntries, 1, 'plan must include one channel entry');
  assert.equal(result.artifact.summary.publishEntries, 1, 'plan must include one publish entry');
  assert.equal(result.artifact.summary.providerRuntimeImplemented, true, 'GRIP lowering must report the implemented provider runtime boundary');
  assert.deepEqual(canonicalEffectsFor(result).map((entry) => entry.kind), ['grip.channel', 'grip.hold', 'grip.publish'], 'GRIP lowering must emit canonical provider effects');
  assert.deepEqual(canonicalEffectsFor(result).map((entry) => entry.result), ['ack', 'opaque-response', 'structured-response']);
}
function comparableEntries(entries) {
  return entries.map((entry) => {
    const { loc, range, canonicalEffect, ...rest } = entry;
    const normalizedEffect = canonicalEffect && typeof canonicalEffect === 'object'
      ? (() => { const { loc: effectLoc, range: effectRange, ...effectRest } = canonicalEffect; return effectRest; })()
      : canonicalEffect;
    return normalizedEffect ? { ...rest, canonicalEffect: normalizedEffect } : rest;
  });
}
assert.deepEqual(comparableEntries(genericPlan.artifact.entries), comparableEntries(packagePlan.artifact.entries), 'generic package-owned loader must preserve GRIP package plan entries apart from source locations');

const negativePlan = buildNegativePlan();
const negativeCodes = new Set(negativePlan.diagnostics.map((entry) => entry.code));
assert.ok(negativeCodes.has(gripContracts.GRIP_DIAGNOSTIC_CODES.NON_LITERAL_HOLD_MODE), 'dynamic hold mode must be rejected');
assert.ok(negativeCodes.has(gripContracts.GRIP_DIAGNOSTIC_CODES.NON_LITERAL_CHANNEL) || negativeCodes.has(gripContracts.GRIP_DIAGNOSTIC_CODES.DYNAMIC_CHANNEL_LIST_UNSUPPORTED), 'dynamic channel names/lists must be rejected');
assert.ok(negativeCodes.has(gripContracts.GRIP_DIAGNOSTIC_CODES.NON_LITERAL_MESSAGE), 'dynamic publish message must be rejected');

const resolvedContracts = handlerLibraryContracts.resolveDefaultLibraryContracts({ cwd: repoRoot, workspaceRoot: repoRoot });
const gripContract = resolvedContracts.find((entry) => entry.package === gripContracts.GRIP_CONTRACT_ID);
assert.ok(gripContract, 'library contracts must include pulse.grip');
assert.equal(gripContract.npmPackage, '@pulse-compute/grip', 'pulse.grip contract must now be sourced from the package-owned manifest when available');
assert.equal(gripContract.manifest.owner, 'package', 'pulse.grip contract must record package-owned manifest ownership');
assert.equal(gripContract.compiler.builderOwner, '@pulse-compute/grip', 'pulse.grip contract must record package-owned compiler builder ownership');

const libraryKitPackageLoweringSource = read(path.join(wasmRoot, 'packages', 'library-kit', 'src', 'compiler', 'package-lowering.js'));
assert.match(libraryKitPackageLoweringSource, /buildPackageOwnedLoweringPlan/, 'library-kit must expose a generic package-owned lowering loader');
assert.doesNotMatch(libraryKitPackageLoweringSource, /grip\.hold|pulse_grip_hold|@pulse-compute\/grip\/pulsewasm/, 'library-kit generic loader must not own GRIP-specific AST rules');
const compilerSource = read(path.join(wasmRoot, 'packages', 'compiler', 'src', 'extractor.js'));
assert.doesNotMatch(compilerSource, /@pulse-compute\/grip\/pulsewasm/, 'compiler must not hard-code the GRIP lowerable subpath');

const facadeSource = read(path.join(gripRoot, 'src', 'pulsewasm.ts'));
assert.match(facadeSource, /PulseWasmGripLoweringError/, 'direct PulseWasm GRIP facade runtime execution must throw');
assert.match(facadeSource, /lowerableOnly/, 'GRIP facade must remain validate/lower only');
const gripPackage = readJson(path.join(gripRoot, 'package.json'));
assert.equal(gripPackage.exports['.'].import, './dist/index.js', 'GRIP must expose its canonical stateless HTTP package root');
assert.equal(gripPackage.exports['.'].default, './dist/index.js', 'GRIP root must resolve from generated CommonJS application packages');
const gripRootSource = read(path.join(gripRoot, 'src', 'index.ts'));
for (const symbol of ['isWebSocket', 'subscribe', 'handoff', 'broadcast']) assert.match(gripRootSource, new RegExp(symbol), `GRIP root must expose ${symbol}`);
assert.doesNotMatch(gripRootSource, /WebSocketContext|ctx\.ws|connection registry/i, 'GRIP root must remain stateless HTTP framing');
assert.doesNotMatch(facadeSource, /GripGateway|@fanoutio\/grip/, 'lowerable GRIP facade must not import normal runtime gateway implementation');

cleanupWorkspacePackageBuilds();
console.log('ok - package-owned GRIP lowering emits canonical channel, hold, and publish effects');
