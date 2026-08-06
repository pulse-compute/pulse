#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultArtifactsDir } = require('@pulse-compute/wasm-build-support/artifacts-dir');
const { resolveConfigFromFile } = require('../src/config-resolver.js');
const { buildConfigProviderResolution } = require('@pulse-compute/provider-fastly/compiler/config-provider-resolution');
const { createBuildManifest, makeArtifactRecord } = require('../src/build-manifest.js');
const { createDiagnosticsEnvelope } = require('../src/diagnostics.js');
const { PACKAGE_VERSION } = require('../src/diagnostics.js');

const root = path.resolve(__dirname, '..');
const outDir = getDefaultArtifactsDir(root);
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'generated', 'host'), { recursive: true });

const configPath = path.join(root, 'examples', 'config-provider.config.js');
const resolvedConfig = resolveConfigFromFile(configPath, {
  cwd: root,
  profile: 'edge',
  env: {
    PULSE_PROFILE: 'edge'
  }
});

const result = buildConfigProviderResolution({
  resolvedConfig,
  cwd: root,
  generatedBy: PACKAGE_VERSION,
  configValues: {
    USERS_API_BASE_URL: 'https://users.example.test',
    ASSET_ENDPOINT: 'https://assets.example.test',
    ASSET_BUCKET: 'pulse-assets'
  },
  secretValues: {
    USERS_API_TOKEN: 'shh-token',
    ASSET_KEY: 'asset-key'
  }
});

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
writeJson('config-provider-contract.json', result.artifact);
writeJson('runtime-provider-resolution.json', result.resolution);
writeJson('fastly-provider-map.json', result.providerMap);
writeJson('config-provider-smoke.json', result.smoke);
for (const file of result.files) writeText(file.file, file.text);

const diagnostics = createDiagnosticsEnvelope({
  diagnostics: result.diagnostics,
  generatedBy: PACKAGE_VERSION,
  cwd: root,
  status: result.diagnostics.length > 0 ? 'error' : 'ok',
  summary: {
    phase: '13D',
    refs: result.resolution.summary.refs,
    configRefs: result.resolution.summary.configRefs,
    secretRefs: result.resolution.summary.secretRefs
  }
});
writeJson('diagnostics.json', diagnostics);

includeExistingJson('assets-lowering-plan.json');
includeExistingJson('node-assets-provider-proof.json');
includeExistingJson('fastly-assets-provider-proof.json');
const manifest = createBuildManifest({
  cwd: root,
  outDir,
  args: { command: 'build:config-provider-resolution', strict: true },
  artifactRecords,
  resolvedConfig,
  diagnostics,
  result: {
    diagnostics,
    summary: {
      entry: resolvedConfig.entry,
      rootRouter: resolvedConfig.rootRouter
    }
  }
});
writeJson('build-manifest.json', manifest);

console.log('Config provider resolution artifacts written to', outDir);
