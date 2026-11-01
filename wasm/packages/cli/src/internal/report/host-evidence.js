'use strict';

// Capture depends only on the shared admission/audit contract. Replay needs no
// provider, package source, configuration values, or executable package code.
const { copyData, canonicalJson: json, sha256, fail } = require('./data');
const collections = ['hostContributions', 'hostUseSites', 'hostAudits'];
const complete = count => ({ status: 'complete', observed: count, expected: count, reason: null });
const unknown = () => ({ status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' });
const sort = rows => rows.sort((a, b) => json(a) < json(b) ? -1 : json(a) > json(b) ? 1 : 0);
const key = row => json([row.module, row.name]);
const descriptor = row => ({ id: row.contributionId, package: row.package, contractId: row.contractId,
  version: row.protocol, operation: row.operation, target: row.target, service: row.service, entry: row.entry, sha256: row.sourceSha256 });
function capture(input, artifacts, artifact, bytes) {
  const contract = require('@pulse-compute/wasm-contracts/provider/toolchain').hostExtensions;
  const data = copyData(input);
  if (data.finalWasmSha256 !== artifact.sha256 || sha256(bytes) !== artifact.sha256) fail('REPORT_HOST_IDENTITY');
  const audited = contract.auditWasm(bytes, data.importPolicy);
  if (json(audited.observedImports) !== json(data.observedImports)
    || json(data.contributions) !== json(data.importPolicy.contributions)) fail('REPORT_HOST_IDENTITY');
  const selected = data.contributions.map(row => {
    const candidates = (artifacts || []).filter(a => a.kind === 'host-extension' && a.id === row.id);
    if (candidates.length !== 1) fail('REPORT_HOST_IDENTITY');
    const a = contract.normalizeContribution(candidates[0]);
    const actual = { id: a.id, package: a.package, contractId: a.contractId, version: a.version,
      operation: a.data.operation, target: a.data.target, service: a.data.service, entry: a.data.entry, sha256: a.data.sha256 };
    if (json(actual) !== json(row)) fail('REPORT_HOST_IDENTITY');
    return { ...row, declaredImports: a.data.imports };
  });
  const scalar = { 127: 'i32', 126: 'i64', 125: 'f32', 124: 'f64' };
  return { ...data, contributions: selected, observedImports: audited.observedImports.map(row => ({
    module: row.module, name: row.name, kind: row.kind,
    parameters: row.kind === 'function' ? row.signature[0].map(type => scalar[type]) : null,
    results: row.kind === 'function' ? row.signature[1].map(type => scalar[type]) : null
  })) };
}
function addInventory(capsule, prepared, evidenceIds, source) {
  const { stableReportId: id } = require('./capsule');
  const effects = prepared.plan.effects;
  const used = (effects || []).filter(row => row.kind === 'host.extension');
  const data = prepared.hostEvidence, artifactId = capsule.context.primaryArtifactId;
  for (const name of collections) { capsule[name] = []; capsule.coverage[name] = data || Array.isArray(effects) && !used.length ? complete(0) : unknown(); }
  if (!data) return;
  const packageVersion = name => {
    const versions = [...new Set((prepared.reportPackageVersions || []).filter(p => p.name === name).map(p => p.version))];
    return versions.length === 1 ? versions[0] : null;
  };
  for (const row of data.contributions) capsule.hostContributions.push({
    id: id('host-contribution', row.id), contributionId: row.id, package: row.package, contractId: row.contractId,
    packageVersion: packageVersion(row.package),
    protocol: row.version, operation: row.operation, service: row.service, implementation: data.implementation,
    target: row.target, sourceSha256: row.sha256, entry: row.entry, policySha256: data.importPolicy.sha256,
    declaredImports: row.declaredImports, artifactId, evidenceIds
  });
  if (data.useSites.length !== used.length) fail('REPORT_HOST_IDENTITY');
  for (const site of data.useSites) {
    const effect = used.find(row => row.id === site.effectId);
    const contribution = data.contributions.find(row => row.id === site.contributionId);
    if (!effect || !contribution || effect.package !== contribution.package || effect.contractId !== contribution.contractId
      || effect.operation !== contribution.operation) fail('REPORT_HOST_IDENTITY');
    const owner = capsule.entries.find(row => row.canonicalId === (effect.applicationEntryStableId || effect.routerEntryStableId || 'default'));
    if (!owner) fail('REPORT_HOST_IDENTITY');
    // Router lowerings can refer to a generated dispatcher. The canonical entry
    // retains the authored handler; never present that generated span as source.
    const operationSource = effect.routerEntryStableId ? null : source(effect.source);
    const authored = operationSource || owner.source;
    capsule.hostUseSites.push({ id: id('host-use-site', effect.id), canonicalId: effect.id,
      contributionId: id('host-contribution', site.contributionId), entryIds: [owner.id], source: authored,
      sourceBasis: operationSource ? 'authored-operation' : authored ? 'authored-entry' : 'not-recorded', evidenceIds });
  }
  capsule.hostAudits.push({ id: id('host-audit', artifactId), artifactId,
    policyVersion: data.importPolicy.version, policySha256: data.importPolicy.sha256,
    baselineSha256: data.importPolicy.baselineSha256, permittedImports: data.importPolicy.permittedImports,
    observedImports: data.observedImports, importCoverage: complete(data.observedImports.length),
    lifecycle: data.lifecycle, runtimeObservationCoverage: unknown(), evidenceIds });
  for (const name of collections) capsule.coverage[name] = complete(capsule[name].length);
}
function check(c, maps, { ensure, coverage, same, stableReportId: id }) {
  const present = collections.filter(name => Object.hasOwn(c, name));
  ensure(present.length === 0 || present.length === collections.length, 'REPORT_HOST_COVERAGE');
  for (const name of collections) ensure(Object.hasOwn(c, name) === Object.hasOwn(c.coverage, name), 'REPORT_HOST_COVERAGE');
  if (!present.length) return;
  ensure(collections.every(name => c.coverage[name].status === c.coverage.hostContributions.status), 'REPORT_HOST_COVERAGE');
  if (c.hostContributions.length) ensure(collections.every(name => c.coverage[name].status === 'complete'), 'REPORT_HOST_COVERAGE');
  ensure(c.hostAudits.length <= 1, 'REPORT_HOST_IDENTITY');
  ensure(Boolean(c.hostContributions.length) === Boolean(c.hostUseSites.length)
    && Boolean(c.hostContributions.length) === Boolean(c.hostAudits.length), 'REPORT_HOST_IDENTITY');
  for (const row of c.hostUseSites) {
    ensure(row.id === id('host-use-site', row.canonicalId) && maps.hostContributions.has(row.contributionId)
      && row.entryIds.length > 0 && row.evidenceIds.length > 0, 'REPORT_HOST_IDENTITY');
    ensure((row.source === null) === (row.sourceBasis === 'not-recorded'), 'REPORT_HOST_IDENTITY');
  }
  for (const audit of c.hostAudits) {
    ensure(audit.artifactId === c.context.primaryArtifactId && audit.id === id('host-audit', audit.artifactId)
      && audit.evidenceIds.length > 0, 'REPORT_HOST_IDENTITY');
    coverage(audit.importCoverage, audit.observedImports.length);
    ensure(audit.importCoverage.status === 'complete' && same(audit.runtimeObservationCoverage, unknown()), 'REPORT_HOST_COVERAGE');
    const declarations = new Map();
    for (const row of c.hostContributions) {
      ensure(row.id === id('host-contribution', row.contributionId) && row.contributionId.startsWith(row.package + ':')
        && row.artifactId === audit.artifactId && row.policySha256 === audit.policySha256
        && row.protocol === 'pulse.host-extension.v1' && row.service === 'terminal-request-backend.v1'
        && row.target.provider === c.context.host && row.target.target === c.context.target
        && row.evidenceIds.length > 0 && row.declaredImports.length > 0
        && c.hostUseSites.some(site => site.contributionId === row.id), 'REPORT_HOST_IDENTITY');
      const unique = new Set();
      for (const imported of row.declaredImports) {
        ensure(!unique.has(key(imported)), 'REPORT_HOST_IMPORT'); unique.add(key(imported));
        ensure(!declarations.has(key(imported)) || same(declarations.get(key(imported)), imported), 'REPORT_HOST_IMPORT');
        declarations.set(key(imported), imported);
        const observed = audit.observedImports.filter(i => key(i) === key(imported));
        ensure(observed.length > 0 && observed.every(i => i.kind === 'function'
          && same(i.parameters, imported.parameters) && same(i.results, imported.results)), 'REPORT_HOST_IMPORT');
      }
    }
    const imports = sort([...declarations.values()]);
    const contributions = c.hostContributions.map(descriptor).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    ensure(audit.policyVersion === 'pulse.host-extension-import-policy.v1'
      && sha256(json({ version: audit.policyVersion, baselineSha256: audit.baselineSha256, contributions, imports })) === audit.policySha256, 'REPORT_HOST_IDENTITY');
    const baseline = audit.permittedImports.filter(row => !declarations.has(key(row)));
    ensure(sha256(json(baseline)) === audit.baselineSha256
      && same(sort([...baseline, ...imports.map(row => ({ module: row.module, name: row.name, kind: 'function' }))]), audit.permittedImports), 'REPORT_HOST_IMPORT');
    for (const row of audit.observedImports) ensure(audit.permittedImports.some(i => i.module === row.module && i.name === row.name && i.kind === row.kind)
      && (row.kind === 'function' ? row.parameters !== null && row.results !== null : row.parameters === null && row.results === null), 'REPORT_HOST_IMPORT');
  }
}
module.exports = { capture, addInventory, check };
