#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultArtifactsDir } = require('@pulse-compute/wasm-build-support/artifacts-dir');
const { resolveConfigFromFile } = require('../src/config-resolver.js');
const { buildRuntimeProviderKv, buildKvAdapterIntegration } = require('@pulse-compute/provider-fastly/compiler/runtime-provider-kv');
const { createBuildManifest, makeArtifactRecord } = require('../src/build-manifest.js');
const { createDiagnosticsEnvelope, PACKAGE_VERSION } = require('../src/diagnostics.js');

const root = path.resolve(__dirname, '..');
const outDir = getDefaultArtifactsDir(root);
const configPath = path.join(root, 'examples', 'runtime-provider-fastly.config.js');
fs.mkdirSync(outDir, { recursive: true });

const resolvedConfig = resolveConfigFromFile(configPath, { cwd: root, profile: 'edge', env: { PULSE_PROFILE: 'edge' } });
const providerResult = buildRuntimeProviderKv({ cwd: root, generatedBy: PACKAGE_VERSION, resolvedConfig: resolvedConfig.artifact });
const adapterResult = buildKvAdapterIntegration({ cwd: root, generatedBy: PACKAGE_VERSION, resolvedConfig: resolvedConfig.artifact });
const diagnosticsList = providerResult.diagnostics || [];
const artifactRecords = [];
function writeJson(fileName, value) {
  const full = path.join(outDir, fileName);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const text = JSON.stringify(value, null, 2) + '\n';
  fs.writeFileSync(full, text);
  artifactRecords.push(makeArtifactRecord(fileName, value, text));
}
function writeText(fileName, text) {
  const full = path.join(outDir, fileName);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  artifactRecords.push(makeArtifactRecord(fileName, { version: undefined }, text));
}

function includeExistingJson(fileName) {
  const full = path.join(outDir, fileName);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, 'utf8');
  artifactRecords.push(makeArtifactRecord(fileName, JSON.parse(text), text));
}

writeJson('resolved-config.json', resolvedConfig.artifact);
writeJson('runtime-provider-contract.json', providerResult.artifact);
writeJson('runtime-provider-kv-resolution.json', providerResult.resolution);
writeJson('config-authoring-shape.json', providerResult.configAuthoringShape);
writeJson('platform-store-map.json', providerResult.platformStoreMap);
writeJson('kv-capability-contract.json', providerResult.kvCapabilityContract);
writeJson('kv-provider-map.json', providerResult.kvProviderMap);
writeJson('runtime-provider-api-surface.json', providerResult.apiSurface);
writeJson('runtime-provider-smoke.json', providerResult.smoke);
writeJson('kv-adapter-integration.json', adapterResult.integration);
writeJson('kv-provider-runtime-map.json', adapterResult.runtimeMap);
for (const file of [...providerResult.files, ...adapterResult.files]) writeText(file.file, file.text);

const diagnostics = createDiagnosticsEnvelope({
  diagnostics: diagnosticsList,
  generatedBy: PACKAGE_VERSION,
  cwd: root,
  status: diagnosticsList.length ? 'error' : 'ok',
  summary: { phase: '14B/14C', ...providerResult.summary, localAdapterProof: true }
});
writeJson('diagnostics.json', diagnostics);
includeExistingJson('assets-lowering-plan.json');
includeExistingJson('node-assets-provider-proof.json');
includeExistingJson('fastly-assets-provider-proof.json');
const manifest = createBuildManifest({
  cwd: root,
  outDir,
  args: { command: 'build:runtime-provider-kv', strict: true },
  artifactRecords,
  resolvedConfig,
  diagnostics,
  result: { diagnostics, summary: { entry: resolvedConfig.entry, rootRouter: resolvedConfig.rootRouter } }
});
writeJson('build-manifest.json', manifest);
if (diagnosticsList.length) process.exitCode = 1;
console.log('Runtime provider / KV artifacts written to', outDir);
