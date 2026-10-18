'use strict';

// One fresh control-plane/docs pass per seal attempt. Standalone pack commands
// still validate for themselves; only the controller pins this local receipt.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { candidateIdentity } = require('./release-feature-acceptance.cjs');
const { atomicJson, inputIdentity } = require('./release-recovery.cjs');
const { fingerprint } = require('./release-checkpoints.cjs');
const SCHEMA = 'pulse.release-source-checks.v2';
const LEGACY_SCHEMA = 'pulse.release-source-checks.v1';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function inputs(root) {
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !['_', 'SHLVL', 'PWD', 'OLDPWD'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  return { dependenciesSha256: inputIdentity(root).dependenciesSha256,
    nodeSha256: hash(fs.readFileSync(process.execPath)), environmentSha256: fingerprint(environment) };
}

function check(root, file) {
  const started = Date.now();
  const candidate = candidateIdentity(root);
  const identity = inputs(root);
  // The release validator owns maintainer, publication, generated references,
  // source links, metadata, package/catalog consistency without rendering.
  require('./documentation-ownership.cjs').synchronizeDocumentationMetadata({ repoRoot: root, write: false });
  const snippets = require('../wasm/scripts/sync-doc-snippets.cjs').synchronizeDocSnippets({ write: false });
  const documentation = require('./documentation-release.cjs').validatePackageDocumentation({ repoRoot: root });
  assert.deepEqual(candidateIdentity(root), candidate, 'Source changed during source checks');
  assert.deepEqual(inputs(root), identity, 'Inputs changed during source checks');
  const report = { schemaVersion: SCHEMA, status: 'passed', repoRoot: fs.realpathSync(root),
    candidate, inputs: identity, snippets, documentation, durationMs: Date.now() - started };
  assertPackageSourceChecks(report);
  atomicJson(file, report);
  return report;
}

// Portable structural proof; checkout/input authentication stays in verify().
function assertPackageSourceChecks(report) {
  assert.equal(report.schemaVersion, SCHEMA, 'New qualification requires v2 source checks');
  assert.equal(report.status, 'passed');
  for (const result of [report.snippets, report.documentation, report.documentation?.maintenance,
    report.documentation?.maintenance?.publication]) assert.equal(result?.status, 'ok', 'Incomplete source checks');
  assert.equal(report.documentation.validationKind, 'package-source', 'Package source validation required');
  assert(!Object.hasOwn(report, 'documentationCandidate'), 'Package source checks cannot retain a site candidate');
  assert(!Object.hasOwn(report.documentation, 'site'), 'Package source checks cannot contain rendered output');
}

function verify(root, file, expectedSha256) {
  assert.match(expectedSha256 || '', /^[a-f0-9]{64}$/, 'Missing source-check receipt digest');
  assert(fs.lstatSync(file).isFile(), 'Source-check receipt must be an ordinary file');
  const bytes = fs.readFileSync(file);
  assert.equal(hash(bytes), expectedSha256, 'Source-check receipt changed');
  const report = JSON.parse(bytes);
  assert([SCHEMA, LEGACY_SCHEMA].includes(report.schemaVersion), 'Unsupported source-check schema');
  assert.equal(report.status, 'passed');
  assert.equal(report.repoRoot, fs.realpathSync(root), 'Source checks belong to another checkout');
  assert.deepEqual(report.candidate, candidateIdentity(root), 'Source checks belong to another candidate');
  assert.deepEqual(report.inputs, inputs(root), 'Source-check inputs changed');
  for (const result of [report.snippets, report.documentation, report.documentation?.maintenance,
    report.documentation?.maintenance?.publication]) assert.equal(result?.status, 'ok', 'Incomplete source checks');
  if (report.schemaVersion === SCHEMA) assertPackageSourceChecks(report);
  else {
    assert(report.documentation.site?.generatedFiles > 0, 'Source checks must include the site');
    const docs = report.documentationCandidate;
    assert(docs, 'Source checks must retain the validated docs candidate');
    assert.deepEqual(require('./release-recovery.cjs').describeArtifact(docs.directory),
      { kind: docs.kind, sha256: docs.sha256 }, 'Validated documentation changed');
  }
  return report;
}

module.exports = { SCHEMA, LEGACY_SCHEMA, assertPackageSourceChecks, check, verify };
if (require.main === module) {
  try {
    assert(process.argv.length === 4 && process.argv[2] === '--out', 'Usage: release-source-checks.cjs --out <file>');
    const result = check(path.resolve(__dirname, '..'), path.resolve(process.argv[3]));
    console.log(`ok - source checks (${result.durationMs}ms): maintainer, publication, catalog, source and installed documentation`);
  } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
