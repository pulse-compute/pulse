'use strict';

// Build evidence, not execution evidence. Re-audit the final bytes rather than
// copying an inspection of a possibly different/prelink artifact.
const { canonicalJson, sha256, fail } = require('./data');
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const complete = count => ({ status: 'complete', observed: count, expected: count, reason: null });
function readHostExtensions(prepared, outDir, artifact) {
  const path = require('node:path');
  const contract = require('@pulse-compute/wasm-contracts/provider/toolchain').hostExtensions;
  const { readFile } = require('./files');
  const effects = (prepared.plan.effects || []).filter(row => row.kind === 'host.extension');
  if (!effects.length) return [];
  if (!prepared.providerNativeManifest) return null;
  const manifest = JSON.parse(readFile(outDir, path.relative(outDir, prepared.providerNativeManifest)).bytes);
  const policy = manifest.hostExtensionPolicy, selected = manifest.hostExtensions;
  if (!policy || !Array.isArray(selected) || selected.length !== effects.length || policy.contributions.length !== selected.length || new Set(selected.map(row => row.id)).size !== selected.length) fail('REPORT_IDENTITY');
  const bytes = readFile(outDir, artifact.file).bytes;
  if (sha256(bytes) !== artifact.sha256) fail('REPORT_ARTIFACT_HASH');
  const audit = contract.auditWasm(bytes, policy);
  const types = { 127: 'i32', 126: 'i64', 125: 'f32', 124: 'f64' };
  return selected.map(row => {
    const contribution = policy.contributions.find(item => item.id === row.id);
    if (!contribution || !effects.some(effect => effect.package === row.package && effect.contractId === row.contractId && effect.operation === row.operation)
      || !same([row.package, row.contractId, row.operation, row.target, row.service, row.sha256],
        [contribution.package, contribution.contractId, contribution.operation, contribution.target, contribution.service, contribution.sha256])
      || !Array.isArray(row.imports) || row.imports.some(item => !policy.imports.some(declared => same(item, declared)))) fail('REPORT_IDENTITY');
    return { ...row, protocol: contribution.version, policySha256: audit.policySha256, artifactId: artifact.id,
      observedImports: audit.observedImports.filter(item => row.imports.some(declared => item.module === declared.module && item.name === declared.name))
        .map(item => ({ module: item.module, name: item.name, parameters: item.signature[0].map(code => types[code]), results: item.signature[1].map(code => types[code]) })) };
  });
}
function addHostExtensions(capsule, rows, source, root, evidenceIds) {
  if (rows === undefined || rows === null) return; // Historical/portable evidence has no selected-provider census.
  const { stableReportId: id } = require('./capsule');
  capsule.hostExtensions = rows.map(row => ({ id: id('host-extension', row.id), contributionId: row.id,
    package: row.package, contractId: row.contractId, operation: row.operation, protocol: row.protocol,
    service: row.service, target: row.target, source: source(row.source, root), sourceSha256: row.sha256,
    policySha256: row.policySha256, artifactId: row.artifactId, declaredImports: row.imports,
    observedImports: row.observedImports, evidenceIds }));
  capsule.coverage.hostExtensions = complete(rows.length);
}
function checkHostExtensions(capsule, maps, ensure) {
  for (const row of capsule.hostExtensions || []) {
    const artifact = maps.artifacts.get(row.artifactId);
    ensure(artifact && artifact.id === capsule.context.primaryArtifactId && artifact.stage === 'final', 'REPORT_REFERENCE');
    ensure(row.target.provider === capsule.context.host && row.target.target === capsule.context.target
      && row.target.targetId === artifact.target, 'REPORT_IDENTITY');
    ensure(row.evidenceIds.length > 0 && row.declaredImports.length > 0, 'REPORT_REFERENCE');
    for (const imports of [row.declaredImports, row.observedImports])
      ensure(new Set(imports.map(item => canonicalJson([item.module, item.name]))).size === imports.length, 'REPORT_DUPLICATE');
    const sorted = rows => [...rows].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
    ensure(same(sorted(row.declaredImports), sorted(row.observedImports)), 'REPORT_IDENTITY');
  }
}
module.exports = { readHostExtensions, addHostExtensions, checkHostExtensions };
