'use strict';

// Only adapt the producer's explicit v2 relations. Function names, byte sizes,
// authored-handler equality and call-graph guesses never establish ownership.
const { bodyId, stableReportId: id } = require('./capsule');
const { canonicalJson, fail } = require('./data');
const origins = { 'terminal-body': 'dedicated', 'shared-helper-body': 'authored-helper',
  'shared-stage-body': 'consolidated-stage', 'dispatcher-carrier': 'dispatcher' };
const unique = values => [...new Set(values)];
const partial = (observed, reason) => ({ status: 'partial', observed, expected: null, reason });
function implementationId(artifactId, origin, canonicalId, chunk) {
  return id('implementation', canonicalJson([artifactId, origin, canonicalId, canonicalId === null ? chunk : null]));
}
function collectImplementations(capsule, capture, artifact, evidenceIds) {
  const entries = new Map(capsule.entries.map(row => [row.canonicalId, row]));
  const byId = new Map(capsule.entries.map(row => [row.id, row]));
  const consumers = new Map();
  for (const entry of capture.entries) for (const body of entry.bodies) {
    if (!consumers.has(body.chunk)) consumers.set(body.chunk, []);
    consumers.get(body.chunk).push(entries.get(entry.entryId).id);
  }
  const rows = new Map();
  for (const mapping of capture.chunkMappings) {
    const origin = origins[mapping.kind], canonicalId = mapping.implementationId;
    const key = implementationId(artifact.id, origin, canonicalId, mapping.chunk);
    if (!rows.has(key)) rows.set(key, { id: key, artifactId: artifact.id, canonicalId, origin,
      consumerBasis: 'compiler-entry-association', chunks: [], evidenceIds });
    rows.get(key).chunks.push({ chunk: mapping.chunk,
      bodyId: mapping.functionIndex === null ? null : bodyId(artifact.sha256, mapping.functionIndex),
      reason: mapping.reason, entryIds: consumers.get(mapping.chunk) || [] });
  }
  for (const row of rows.values()) {
    row.entryIds = unique(row.chunks.flatMap(chunk => chunk.entryIds));
    // Authored helpers have the helper role; their callers retain their own
    // roles on entries. Consolidated stages/carriers can span several roles.
    row.roles = row.origin === 'authored-helper' ? ['helper'] : unique(row.entryIds.map(key => byId.get(key).kind));
    row.routeIds = capsule.routes.filter(route => route.composition.some(key => row.entryIds.includes(key))).map(route => route.id);
    row.bodyIds = unique(row.chunks.map(chunk => chunk.bodyId).filter(key => key !== null));
    const mapped = row.chunks.filter(chunk => chunk.bodyId !== null).length;
    row.bodyCoverage = { status: mapped === row.chunks.length ? 'complete' : 'partial', observed: mapped,
      expected: row.chunks.length, reason: mapped === row.chunks.length ? null : 'final-symbol-not-surviving' };
    row.entryCoverage = partial(row.entryIds.length, 'incomplete-root-universe');
  }
  return [...rows.values()];
}
function checkImplementations(capsule, maps) {
  const ensure = (value, code = 'REPORT_ATTRIBUTION') => { if (!value) fail(code); };
  const sameSet = (a, b) => canonicalJson([...new Set(a)].sort()) === canonicalJson(b);
  const chunks = new Set(), identities = new Set();
  if (capsule.implementations) ensure(capsule.coverage.implementations.status === 'partial'
    && capsule.coverage.implementations.expected === null
    && capsule.coverage.implementations.reason === 'incomplete-mapping', 'REPORT_COVERAGE');
  for (const row of capsule.implementations || []) {
    const artifact = maps.artifacts.get(row.artifactId);
    ensure(artifact, 'REPORT_REFERENCE');
    ensure((row.origin === 'dispatcher') === (row.canonicalId === null), 'REPORT_IDENTITY');
    if (row.origin === 'dispatcher') ensure(row.chunks.length === 1, 'REPORT_IDENTITY');
    ensure(row.id === implementationId(row.artifactId, row.origin, row.canonicalId, row.chunks[0].chunk), 'REPORT_IDENTITY');
    if (row.canonicalId !== null) {
      const key = canonicalJson([row.artifactId, row.canonicalId]);
      ensure(!identities.has(key), 'REPORT_DUPLICATE'); identities.add(key);
    }
    ensure(row.evidenceIds.length > 0 && row.evidenceIds.some(key => maps.evidence.get(key)?.artifactIds.includes(row.artifactId)), 'REPORT_REFERENCE');
    let mapped = 0;
    for (const chunk of row.chunks) {
      const key = row.artifactId + ':' + chunk.chunk;
      ensure(!chunks.has(key), 'REPORT_DUPLICATE'); chunks.add(key);
      ensure(chunk.entryIds.every(key => maps.entries.has(key)), 'REPORT_REFERENCE');
      if (chunk.bodyId === null) ensure(chunk.reason === 'final-symbol-not-surviving');
      else {
        ensure(chunk.reason === null);
        ensure(maps.bodies.get(chunk.bodyId)?.artifactId === row.artifactId, 'REPORT_IDENTITY'); mapped++;
      }
      if (row.origin === 'dedicated') ensure(chunk.entryIds.every(key => maps.entries.get(key).canonicalId === row.canonicalId), 'REPORT_IDENTITY');
    }
    ensure(sameSet(row.chunks.flatMap(chunk => chunk.entryIds), row.entryIds), 'REPORT_REVERSE_REFERENCE');
    ensure(sameSet(row.chunks.map(chunk => chunk.bodyId).filter(key => key !== null), row.bodyIds), 'REPORT_REVERSE_REFERENCE');
    const roles = row.origin === 'authored-helper' ? ['helper'] : row.entryIds.map(key => maps.entries.get(key).kind);
    ensure(sameSet(roles, row.roles), 'REPORT_IDENTITY');
    const routes = capsule.routes.filter(route => route.composition.some(key => row.entryIds.includes(key))).map(route => route.id);
    ensure(sameSet(routes, row.routeIds), 'REPORT_REVERSE_REFERENCE');
    const coverage = row.bodyCoverage, complete = mapped === row.chunks.length;
    ensure(coverage.observed === mapped && coverage.expected === row.chunks.length
      && coverage.status === (complete ? 'complete' : 'partial')
      && coverage.reason === (complete ? null : 'final-symbol-not-surviving'), 'REPORT_COVERAGE');
    ensure(row.entryCoverage.status === 'partial' && row.entryCoverage.observed === row.entryIds.length
      && row.entryCoverage.expected === null && row.entryCoverage.reason === 'incomplete-root-universe', 'REPORT_COVERAGE');
  }
}
module.exports = { collectImplementations, checkImplementations, implementationId };
