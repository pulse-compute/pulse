#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const wasmRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(wasmRoot, '..');
const libraryKit = require(path.join(wasmRoot, 'packages', 'library-kit'));
const assetsContracts = require(path.join(wasmRoot, 'packages', 'contracts', 'src', 'assets', 'contracts.js'));
const assetsManifest = require(path.join(repoRoot, 'packages', 'assets', 'pulsewasm.manifest.cjs'));
const { extractFromFile } = require(path.join(wasmRoot, 'packages', 'compiler', 'src', 'extractor.js'));

function sourceFile(name, text) {
  return ts.createSourceFile(path.join(repoRoot, 'fixtures', name), text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function plan(name, text) {
  return libraryKit.buildAssetsLoweringPlan({
    cwd: repoRoot,
    sourceFile: sourceFile(name, text),
    generatedBy: 'test',
    typescript: ts
  });
}

function codes(result) {
  return new Set((result.diagnostics || []).map((entry) => entry.code));
}

function severitiesFor(result, code) {
  return (result.diagnostics || []).filter((entry) => entry.code === code).map((entry) => entry.severity || 'error');
}

function assertPlanPosture(result) {
  assert.equal(result.artifact.version, assetsContracts.ASSETS_LOWERING_PLAN_VERSION, 'plan version must come from wasm-contracts/assets/contracts');
  assert.equal(result.artifact.contractId, assetsContracts.ASSETS_CONTRACT_ID, 'plan contract id must be pulse.assets');
  assert.equal(result.artifact.npmPackage, assetsManifest.npmPackage, 'npm package identity must come from the package-owned manifest');
  assert.equal(result.artifact.lowerableSubpath, assetsManifest.lowerableSubpath, 'lowerable subpath must come from the package-owned manifest');
  assert.equal(result.artifact.policy.builderOwner, '@pulse-compute/assets', 'assets lowering builder must be package-owned');
  assert.equal(result.artifact.policy.compilerOwnsPackageMapping, false, 'compiler must not own assets package mapping');
  assert.equal(result.artifact.providerBehaviorImplemented, false, 'Assets lowering must remain validate-and-plan only');
  assert.equal(result.artifact.payloadModes.binary.status, 'reserved-with-diagnostic', 'binary assets payload posture must be explicit');
  assert.equal(result.artifact.payloadModes.stream.status, 'lowering-plan-only', 'stream assets payload posture must be explicit');
  assert.equal(result.artifact.payloadModes.stream.hostSurfaceStatus, 'implemented-now', 'host stream surface must be represented separately from provider wiring');
  assert.deepEqual(result.artifact.payloadModes.classification, assetsContracts.ASSETS_PAYLOAD_MODE_CLASSIFICATION, 'payload classification must be copied from assets contracts');
  const resultCodes = codes(result);
  assert.ok(resultCodes.has(assetsContracts.ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED), 'binary reserved diagnostic must appear in the plan');
  assert.ok(resultCodes.has(assetsContracts.ASSETS_DIAGNOSTIC_CODES.STREAM_PROVIDER_NOT_WIRED), 'stream plan-only diagnostic must appear in the plan');
  assert.ok(resultCodes.has(assetsContracts.ASSETS_DIAGNOSTIC_CODES.RUNTIME_EXECUTION_UNSUPPORTED), 'direct runtime execution diagnostic must appear in the plan');
}

{
  const result = plan('assets-namespace.ts', `
    import { assets } from '@pulse-compute/assets';
    export function handler(ctx) {
      const found = assets.lookup(ctx, 'public', '/app.js');
      return assets.respond(found);
    }
  `);
  assert.equal(result.artifact.status, 'ok', 'namespace lookup/respond must plan cleanly');
  assert.equal(result.artifact.entries.length, 1, 'namespace lookup/respond must produce one plan entry');
  assert.equal(result.artifact.entries[0].lookup.store, 'public');
  assert.equal(result.artifact.entries[0].lookup.key, '/app.js');
  assert.equal(result.artifact.entries[0].lookup.method, 'GET');
  assert.equal(result.artifact.entries[0].lookup.handle, 'found');
  assert.equal(result.artifact.entries[0].response.lookupId, result.artifact.entries[0].id, 'respond must reference the lookup entry');
  assert.equal(result.artifact.entries[0].response.payloadMode, 'text-response-body');
  assert.equal(result.hasErrors, false);
  assertPlanPosture(result);
}

{
  const result = plan('assets-named.ts', `
    import { lookup, respond } from '@pulse-compute/assets';
    export function handler(ctx) {
      const found = lookup(ctx, 'public', '/main.css', { method: 'HEAD', passThroughOn404: true, cacheControl: 'public, max-age=60' });
      return respond(found, { status: 204 });
    }
  `);
  assert.equal(result.artifact.status, 'ok', 'named lookup/respond imports must plan cleanly');
  assert.equal(result.artifact.entries.length, 1);
  assert.equal(result.artifact.entries[0].lookup.method, 'HEAD');
  assert.equal(result.artifact.entries[0].lookup.passThroughOn404, true);
  assert.equal(result.artifact.entries[0].lookup.cacheControl, 'public, max-age=60');
  assert.equal(result.artifact.entries[0].response.status, 204);
  assertPlanPosture(result);
}

{
  const result = plan('assets-dynamic.ts', `
    import { assets } from '@pulse-compute/assets';
    export function handler(ctx, key: string) {
      const found = assets.lookup(ctx, 'public', key);
      return assets.respond(found);
    }
  `);
  assert.equal(result.artifact.status, 'error', 'dynamic key must be diagnosed as unsupported');
  assert.ok(codes(result).has(assetsContracts.ASSETS_DIAGNOSTIC_CODES.NON_LITERAL_LOOKUP));
  assert.equal(result.artifact.unsupported.length, 1);
}

{
  const result = plan('assets-bad-respond.ts', `
    import { assets } from '@pulse-compute/assets';
    export function handler(ctx, found: unknown) {
      return assets.respond(found);
    }
  `);
  assert.equal(result.artifact.status, 'error', 'respond without a lookup handle must be diagnosed');
  assert.ok(codes(result).has(assetsContracts.ASSETS_DIAGNOSTIC_CODES.RESPOND_REQUIRES_LOOKUP));
}

{
  const result = plan('assets-bad-method.ts', `
    import { assets } from '@pulse-compute/assets';
    export function handler(ctx) {
      const found = assets.lookup(ctx, 'public', '/app.js', { method: 'POST' });
      return assets.respond(found);
    }
  `);
  assert.equal(result.artifact.status, 'error', 'unsupported methods must be rejected');
  assert.ok(codes(result).has(assetsContracts.ASSETS_DIAGNOSTIC_CODES.UNSUPPORTED_METHOD));
}

{
  const result = plan('assets-binary.ts', `
    import { assets } from '@pulse-compute/assets';
    export function handler(ctx) {
      const found = assets.lookup(ctx, 'public', '/image.png', { payloadMode: 'binary-buffer' });
      return assets.respond(found);
    }
  `);
  assert.equal(result.artifact.status, 'error', 'binary-buffer must remain reserved with a diagnostic');
  assert.ok(codes(result).has(assetsContracts.ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED));
  assert.ok(severitiesFor(result, assetsContracts.ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED).includes('error'));
}

{
  const result = plan('assets-stream.ts', `
    import { assets } from '@pulse-compute/assets';
    export function handler(ctx) {
      const found = assets.lookup(ctx, 'public', '/video.txt', { payloadMode: 'stream-pass-through-response' });
      return assets.respond(found);
    }
  `);
  assert.equal(result.artifact.status, 'ok', 'stream payload must remain plan-only, not an error');
  assert.ok(codes(result).has(assetsContracts.ASSETS_DIAGNOSTIC_CODES.STREAM_PROVIDER_NOT_WIRED));
  assert.ok(severitiesFor(result, assetsContracts.ASSETS_DIAGNOSTIC_CODES.STREAM_PROVIDER_NOT_WIRED).includes('warning'));
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsewasm-assets-plan-'));
  const entry = path.join(tmpDir, 'app.ts');
  fs.writeFileSync(entry, `
    import { Router } from './pulse-runtime/dist/index.js';
    import { assets } from '@pulse-compute/assets';
    const app = new Router();
    export function serveAsset(ctx, next) {
      const found = assets.lookup(ctx, 'public', '/app.js');
      return assets.respond(found);
    }
    app.get('/app.js', serveAsset);
  `, 'utf8');
  try {
    const result = extractFromFile(entry, {
      cwd: repoRoot,
      root: 'app',
      emitAssetsLoweringPlan: true
    });
    assert.ok(result.assetsLoweringPlan, 'compiler extraction must return the package-owned assets lowering plan');
    assert.equal(result.assetsLoweringPlan.artifact.entries.length, 1, 'compiler extraction must pass sourceFile into the assets plan builder');
    assert.ok(result.passes.some((entry) => entry.name === 'assets-lowering-plan' && entry.status === 'ok'), 'compiler passes must include assets-lowering-plan');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log('ok - assets lowering plan detects facade imports, emits plan entries, and preserves binary/stream posture');
