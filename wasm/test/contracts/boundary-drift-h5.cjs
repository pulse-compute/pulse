'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.pulse-docs-site',
  'node_modules',
  'target'
]);

function copyRepository(repoRoot, destination) {
  fs.cpSync(repoRoot, destination, {
    recursive: true,
    filter(source) {
      if (source === repoRoot) return true;
      const relative = path.relative(repoRoot, source);
      return !relative.split(path.sep).some((part) => EXCLUDED_DIRECTORY_NAMES.has(part));
    }
  });
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const source = path.join(directory, entry.name);
      if (entry.name === 'node_modules') {
        const relative = path.relative(repoRoot, source);
        const target = path.join(destination, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.symlinkSync(source, target, 'dir');
        continue;
      }
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue;
      visit(source);
    }
  };
  visit(repoRoot);
}

function runNode(repoRoot, relativeScript) {
  return spawnSync(process.execPath, [path.join(repoRoot, relativeScript)], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024
  });
}

function assertPassed(result, label) {
  assert.equal(result.error, undefined, `${label} could not execute: ${result.error && result.error.message}`);
  assert.equal(result.status, 0, `${label} failed:\n${result.stdout || ''}${result.stderr || ''}`);
}

function assertRejected(result, pattern, label) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.error, undefined, `${label} could not execute: ${result.error && result.error.message}`);
  assert.notEqual(result.status, 0, `${label} unexpectedly passed`);
  assert.match(output, pattern, `${label} did not fail at the expected guardrail`);
  return Object.freeze({
    id: label,
    status: 'PASS',
    mutationRejected: true,
    expectedDiagnostic: pattern.source
  });
}

function mutateFile(repoRoot, relativeFile, mutate, run, expected, label) {
  const target = path.join(repoRoot, relativeFile);
  const original = fs.readFileSync(target, 'utf8');
  const changed = mutate(original);
  assert.notEqual(changed, original, `${label} mutation must change ${relativeFile}`);
  fs.writeFileSync(target, changed);
  try {
    return assertRejected(run(), expected, label);
  } finally {
    fs.writeFileSync(target, original);
  }
}

function runBoundaryDriftProof(repoRoot) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-boundary-h5-drift-'));
  const copyRoot = path.join(temporaryRoot, 'pulse');
  const importScript = 'wasm/test/assert-import-boundaries.cjs';
  const h4Script = 'wasm/test/contracts/assert-boundary-authority-h4.cjs';
  const entitiesSchemaScript = 'wasm/test/entities/assert-entities-schema-bridge.cjs';
  try {
    copyRepository(repoRoot, copyRoot);
    assertPassed(runNode(copyRoot, importScript), 'baseline import-boundary scanner');
    assertPassed(runNode(copyRoot, h4Script), 'baseline H4 capability authority');
    assertPassed(runNode(copyRoot, entitiesSchemaScript), 'baseline Entities schema bridge authority');

    const cases = [];
    cases.push(mutateFile(
      copyRoot,
      'wasm/packages/contracts/package.json',
      (source) => {
        const manifest = JSON.parse(source);
        manifest.dependencies = {
          ...(manifest.dependencies || {}),
          '@pulse-compute/wasm-compiler': 'workspace:*'
        };
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
      () => runNode(copyRoot, importScript),
      /contracts package must not depend on compiler/,
      'forbidden-manifest-dependency'
    ));

    cases.push(mutateFile(
      copyRoot,
      'packages/assets/package.json',
      (source) => {
        const manifest = JSON.parse(source);
        delete manifest.dependencies['@pulse-compute/wasm-contracts'];
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
      () => runNode(copyRoot, importScript),
      /imports @pulse-compute\/wasm-contracts\/diagnostics without declaring @pulse-compute\/wasm-contracts/,
      'undeclared-package-runtime-import'
    ));

    cases.push(mutateFile(
      copyRoot,
      'wasm/packages/contracts/package.json',
      (source) => {
        const manifest = JSON.parse(source);
        delete manifest.exports['./events'];
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
      () => runNode(copyRoot, importScript),
      /imports unexported workspace entry @pulse-compute\/wasm-contracts\/events/,
      'unexported-workspace-import'
    ));

    const forbiddenImport = path.join(copyRoot, 'packages', 'jwt', 'test', 'h5-forbidden-provider-import.test.ts');
    fs.writeFileSync(
      forbiddenImport,
      "const privateProvider = require('../../provider-fastly/src/toolchain/index.js');\nvoid privateProvider;\n"
    );
    try {
      cases.push(assertRejected(
        runNode(copyRoot, importScript),
        /without the named conformance contract/,
        'forbidden-provider-private-import'
      ));
    } finally {
      fs.unlinkSync(forbiddenImport);
    }

    const forbiddenEntitiesImport = path.join(copyRoot, 'packages', 'entities', 'src', 'internal', 'h5-forbidden-schema-import.ts');
    fs.writeFileSync(
      forbiddenEntitiesImport,
      "import runtimeHost from '@pulse-compute/runtime/host';\nvoid runtimeHost;\n"
    );
    try {
      cases.push(assertRejected(
        runNode(copyRoot, importScript),
        /Entities schema access must use only @pulse-compute\/runtime\/package/,
        'entities-schema-forbidden-import'
      ));
    } finally {
      fs.unlinkSync(forbiddenEntitiesImport);
    }

    const forbiddenPackageTestImport = path.join(copyRoot, 'packages', 'entities', 'test', 'h5-forbidden-toolchain-import.test.ts');
    fs.writeFileSync(
      forbiddenPackageTestImport,
      "const contractPrivate = require('../../../wasm/packages/contracts/src/entities/runtime.js');\nvoid contractPrivate;\n"
    );
    try {
      cases.push(assertRejected(
        runNode(copyRoot, importScript),
        /imports private toolchain source.*use a declared package entry/,
        'forbidden-package-test-toolchain-import'
      ));
    } finally {
      fs.unlinkSync(forbiddenPackageTestImport);
    }

    cases.push(mutateFile(
      copyRoot,
      'packages/pulse/src/index.d.ts',
      (source) => source.replace(
        "export type PulseCryptoAlgorithm = 'HS256' | 'ES256';",
        "export type PulseCryptoAlgorithm = 'HS256';"
      ),
      () => runNode(copyRoot, h4Script),
      /PulseCryptoAlgorithm/,
      'public-types-capability-drift'
    ));

    cases.push(mutateFile(
      copyRoot,
      'packages/crypto/src/contracts.ts',
      (source) => source.replace(
        "      'fastly-javascript',\n",
        ''
      ),
      () => runNode(copyRoot, h4Script),
      /fastly-javascript/,
      'typescript-capability-mirror-drift'
    ));

    cases.push(mutateFile(
      copyRoot,
      'wasm/packages/contracts/src/crypto/contracts.js',
      (source) => source.replace(
        "eligibleTargets: ['node-javascript', 'fastly-javascript']",
        "eligibleTargets: ['node-javascript']"
      ),
      () => runNode(copyRoot, h4Script),
      /fastly-javascript/,
      'commonjs-capability-mirror-drift'
    ));

    cases.push(mutateFile(
      copyRoot,
      'packages/runtime/src/package.d.ts',
      (source) => source.replace(
        "PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION: 'pulse.first-party-embedded-schema-codec-bridge.v1'",
        "PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION: 'pulse.first-party-embedded-schema-codec-bridge.v99'"
      ),
      () => runNode(copyRoot, entitiesSchemaScript),
      /schema codec bridge type mirror must match the CommonJS runtime version/,
      'entities-schema-types-mirror-drift'
    ));

    cases.push(mutateFile(
      copyRoot,
      'packages/runtime/src/internal/package-runtime.js',
      (source) => source.replace(
        '      return Object.freeze({\n        decodeEmbeddedJson(schemaId, packageOwnedText) {',
        '      return Object.freeze({\n        schemaCodecs: data.schemaCodecs,\n        decodeEmbeddedJson(schemaId, packageOwnedText) {'
      ),
      () => runNode(copyRoot, entitiesSchemaScript),
      /schema bridge capability surface must not expose registry, codec, request, or provider authority/,
      'entities-schema-capability-drift'
    ));

    return Object.freeze({
      version: 'pulse.boundary-drift-proof.h5.v1',
      status: 'PASS',
      isolatedTemporaryCopy: true,
      productionSourcesMutated: false,
      baselines: Object.freeze([
        'wasm/test/assert-import-boundaries.cjs',
        'wasm/test/contracts/assert-boundary-authority-h4.cjs',
        'wasm/test/entities/assert-entities-schema-bridge.cjs'
      ]),
      cases: Object.freeze(cases)
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

module.exports = Object.freeze({ runBoundaryDriftProof });
