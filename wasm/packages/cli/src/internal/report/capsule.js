'use strict';

const { copyData, canonicalJson, parseJson, sha256, fail, relativePath, freeze } = require('./data');
const { capsuleSchema } = require('./schema');
const { validate, project } = require('./validate');
const { structureFromDescriptor, REGISTRY_VERSION } = require('./schema-projection');
const collections = ['routes', 'entries', 'declarations', 'schemas', 'bindings', 'resources', 'artifacts', 'bodies', 'rootSets', 'measurements', 'observations', 'evidence'];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const ensure = (condition, code = 'REPORT_INVARIANT') => { if (!condition) fail(code); };
function artifactId(hash) { ensure(/^[a-f0-9]{64}$/.test(hash)); return `artifact:${hash}`; }
function bodyId(hash, index) { ensure(Number.isSafeInteger(index) && index >= 0); return `body:${artifactId(hash).slice(9)}:${index}`; }
function stableReportId(kind, canonicalId) {
  ensure(['route', 'entry', 'schema', 'binding', 'resource', 'measurement', 'evidence', 'declaration', 'root-set', 'handler', 'root'].includes(kind));
  ensure(typeof canonicalId === 'string' && canonicalId.length > 0);
  return `${kind}:${sha256(canonicalJson({ kind, canonicalId }))}`;
}
function normalize(input) {
  const value = copyData(input);
  const sets = new Set(['evidenceIds', 'schemaIds', 'bindingIds', 'declarationIds', 'routeIds', 'entryIds', 'artifactIds', 'subjectIds', 'bodyIds', 'cases', 'targets']);
  function walk(item, key) {
    if (Array.isArray(item)) {
      if (sets.has(key)) { ensure(new Set(item).size === item.length, 'REPORT_DUPLICATE'); item.sort(compare); }
      item.forEach(child => walk(child, ''));
    } else if (item && typeof item === 'object') Object.keys(item).forEach(key => walk(item[key], key));
  }
  walk(value, '');
  for (const name of collections.filter(name => !['routes', 'entries'].includes(name))) value[name]?.sort((a, b) => compare(a.id, b.id));
  value.provenance?.toolchain?.sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
  for (const schema of value.schemas || []) if (schema.structure?.state === 'available') {
    ensure(schema.structure.reason === null && schema.registryVersion === REGISTRY_VERSION, 'REPORT_SCHEMA_METRICS');
    const canonical = structureFromDescriptor(schema.structure.descriptor);
    ensure(schema.structure.descriptorBytes === canonical.descriptorBytes && schema.structure.topLevelKeys === canonical.topLevelKeys
      && schema.structure.requiredKeys === canonical.requiredKeys && schema.structure.keyCountsState === canonical.keyCountsState
      && same([...schema.structure.properties].sort((a, b) => compare(a.name, b.name)), canonical.properties), 'REPORT_SCHEMA_METRICS');
    schema.structure = canonical;
  }
  for (const roots of value.rootSets || []) roots.roots.sort((a, b) => compare(a.id, b.id));
  return value;
}
function check(capsule) {
  validate(capsule, capsuleSchema);
  const maps = {}, all = new Map();
  for (const name of collections) {
    maps[name] = new Map();
    for (const row of capsule[name]) {
      ensure(!all.has(row.id), 'REPORT_DUPLICATE'); all.set(row.id, row); maps[name].set(row.id, row);
    }
  }
  function references(ids, map = all) { for (const id of ids) ensure(map.has(id), 'REPORT_REFERENCE'); }
  function source(row) {
    if (!row.source) return;
    relativePath(row.source.file);
    if (row.source.endLine !== undefined) ensure(row.source.endLine >= row.source.line);
    if (row.source.endColumn !== undefined) ensure(row.source.endLine !== undefined
      && (row.source.endLine > row.source.line || row.source.endColumn >= row.source.column));
  }
  function fact(value) {
    references(value.evidenceIds, maps.evidence);
    if (value.state === 'available') ensure(value.value !== null && value.reason === null && value.evidenceIds.length > 0, 'REPORT_FACT');
    else ensure(value.value === null && value.reason !== null, 'REPORT_FACT');
    if (value.state === 'not-applicable') ensure(value.reason === 'not-applicable', 'REPORT_FACT');
  }
  function coverage(value, count) {
    ensure(value.observed === count, 'REPORT_COVERAGE');
    if (value.expected !== null) ensure(value.expected >= value.observed, 'REPORT_COVERAGE');
    if (value.status === 'complete') ensure(value.expected === count && value.reason === null, 'REPORT_COVERAGE');
    else ensure(value.reason !== null, 'REPORT_COVERAGE');
    if (['unavailable', 'not-applicable'].includes(value.status)) ensure(count === 0, 'REPORT_COVERAGE');
  }
  for (const name of Object.keys(capsule.coverage)) coverage(capsule.coverage[name], capsule[name].length);
  for (const [name, rows] of Object.entries(maps)) for (const row of rows.values()) {
    source(row);
    if (row.evidenceIds) references(row.evidenceIds, maps.evidence);
    for (const [key, target] of [['schemaIds', 'schemas'], ['bindingIds', 'bindings'], ['declarationIds', 'declarations'],
      ['routeIds', 'routes'], ['entryIds', 'entries'], ['artifactIds', 'artifacts']]) if (row[key]) references(row[key], maps[target]);
    if (row.subjectIds) references(row.subjectIds);
    if (['routes', 'entries', 'schemas', 'bindings', 'resources', 'declarations'].includes(name)) ensure(row.evidenceIds.length > 0, 'REPORT_REFERENCE');
  }
  for (const name of ['routes', 'entries']) capsule[name].forEach((row, index) => {
    ensure(index === 0 || row.order > capsule[name][index - 1].order, 'REPORT_ORDER');
  });
  for (const route of capsule.routes) {
    references([route.entryId, ...route.composition], maps.entries);
    ensure(maps.entries.get(route.entryId).handlerId === route.handlerId, 'REPORT_REFERENCE');
  }
  for (const entry of capsule.entries) if (entry.flow) {
    references([entry.flow.nextEntryId, entry.flow.childEntryId, entry.flow.parentContinueEntryId].filter(id => id !== null), maps.entries);
  }
  for (const name of ['schemas', 'bindings']) {
    const key = name === 'schemas' ? 'schemaIds' : 'bindingIds', reverseRoutes = new Map(), reverseEntries = new Map();
    for (const [records, reverse] of [[capsule.routes, reverseRoutes], [capsule.entries, reverseEntries]])
      for (const record of records) for (const id of record[key]) {
        if (!reverse.has(id)) reverse.set(id, []); reverse.get(id).push(record.id);
      }
    for (const row of capsule[name]) {
      ensure(same((reverseRoutes.get(row.id) || []).sort(compare), row.routeIds), 'REPORT_REVERSE_REFERENCE');
      ensure(same((reverseEntries.get(row.id) || []).sort(compare), row.entryIds), 'REPORT_REVERSE_REFERENCE');
    }
  }
  for (const row of capsule.schemas) if (row.structure.state === 'unavailable') {
    ensure(row.structure.reason !== null && row.structure.descriptor === null && row.structure.descriptorBytes === null
      && row.structure.topLevelKeys === null && row.structure.requiredKeys === null && row.structure.properties.length === 0
      && row.structure.keyCountsState === 'unavailable', 'REPORT_SCHEMA_METRICS');
  }
  for (const artifact of capsule.artifacts) {
    ensure(artifact.id === artifactId(artifact.sha256), 'REPORT_IDENTITY');
    coverage(artifact.sectionCoverage, artifact.sections.length);
    artifact.sections.forEach((section, index) => ensure(section.index === index && section.payloadBytes <= section.bytes));
    if (artifact.sectionCoverage.status === 'complete') ensure(8 + artifact.sections.reduce((n, s) => n + s.bytes, 0) === artifact.bytes, 'REPORT_LEDGER');
  }
  const primary = maps.artifacts.get(capsule.context.primaryArtifactId);
  ensure(primary && primary.stage === 'final' && primary.host === capsule.context.host, 'REPORT_ELIGIBILITY');
  const build = maps.evidence.get(capsule.provenance.buildEvidenceId);
  ensure(build && build.kind === 'build' && build.result === 'passed' && build.artifactIds.includes(primary.id), 'REPORT_ELIGIBILITY');
  for (const evidence of capsule.evidence) {
    if (evidence.kind === 'test') ensure(evidence.artifactIds.length > 0 && evidence.scope.corpus
      && evidence.scope.cases.length > 0 && evidence.scope.targets.length > 0, 'REPORT_TEST_SCOPE');
    if (evidence.recordedAt !== null) ensure(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(evidence.recordedAt)
      && Number.isFinite(Date.parse(evidence.recordedAt)), 'REPORT_DATA');
  }
  for (const body of capsule.bodies) {
    const artifact = maps.artifacts.get(body.artifactId);
    ensure(artifact && body.id === bodyId(artifact.sha256, body.index), 'REPORT_IDENTITY');
  }
  function bodies(ids, artifact) {
    references(ids, maps.bodies);
    ensure(ids.every(id => maps.bodies.get(id).artifactId === artifact), 'REPORT_IDENTITY');
    return ids.reduce((n, id) => n + maps.bodies.get(id).bytes, 0);
  }
  const bodyTotals = new Map();
  for (const body of capsule.bodies) bodyTotals.set(body.artifactId, (bodyTotals.get(body.artifactId) || 0) + body.bytes);
  for (const artifact of capsule.artifacts) {
    const maximum = artifact.sectionCoverage.status === 'complete'
      ? artifact.sections.filter(section => section.id === 10).reduce((sum, section) => sum + section.payloadBytes, 0) : artifact.bytes;
    ensure((bodyTotals.get(artifact.id) || 0) <= maximum, 'REPORT_LEDGER');
  }
  const rootLookups = new Map();
  for (const set of capsule.rootSets) {
    references([set.artifactId], maps.artifacts); references(set.evidenceIds, maps.evidence);
    ensure(new Set(set.roots.map(root => root.id)).size === set.roots.length, 'REPORT_DUPLICATE');
    const byId = new Map(), counts = new Map(), subjects = new Set();
    for (const root of set.roots) {
      bodies(root.bodyIds, set.artifactId); if (root.subjectId !== null) references([root.subjectId]);
      if (root.kind === 'route') ensure(maps.routes.has(root.subjectId), 'REPORT_ROOTS');
      byId.set(root.id, root); subjects.add(root.subjectId);
      for (const id of root.bodyIds) counts.set(id, (counts.get(id) || 0) + 1);
    }
    if (set.universeComplete) {
      ensure(capsule.routes.every(route => subjects.has(route.id)), 'REPORT_ROOTS');
      ensure(capsule.entries.filter(entry => ['event', 'startup', 'error', 'export', 'fallback', 'other'].includes(entry.kind))
        .every(entry => subjects.has(entry.id)), 'REPORT_ROOTS');
    }
    rootLookups.set(set.id, { byId, counts });
  }
  for (const measurement of capsule.measurements) {
    references([measurement.subjectId]); references([measurement.artifactId], maps.artifacts); fact(measurement.fact);
    ensure(['routes', 'entries', 'schemas', 'resources'].some(name => maps[name].has(measurement.subjectId)), 'REPORT_REFERENCE');
    if (measurement.rootSetId !== null) {
      const set = maps.rootSets.get(measurement.rootSetId);
      ensure(set && rootLookups.get(set.id).byId.has(measurement.rootId), 'REPORT_REFERENCE');
    } else ensure(measurement.rootId === null, 'REPORT_REFERENCE');
    ensure(measurement.stage === maps.artifacts.get(measurement.artifactId).stage, 'REPORT_IDENTITY');
    const total = bodies(measurement.bodyIds, measurement.artifactId);
    if (measurement.expectedChunks !== null) ensure(measurement.mappedChunks <= measurement.expectedChunks, 'REPORT_COVERAGE');
    if (measurement.fact.state !== 'available') { ensure(measurement.bodyIds.length === 0); continue; }
    ensure(measurement.fact.basis === 'measured' && measurement.fact.value === total, 'REPORT_MEASUREMENT');
    ensure(measurement.fact.evidenceIds.some(id => maps.evidence.get(id).artifactIds.includes(measurement.artifactId)), 'REPORT_IDENTITY');
    if (measurement.fact.coverage !== 'partial') ensure(measurement.expectedChunks !== null && measurement.mappedChunks === measurement.expectedChunks, 'REPORT_COVERAGE');
    if (measurement.metric === 'handler-body') {
      ensure(measurement.method === 'final-body-map-v1' && measurement.rootSetId === null && measurement.rootId === null, 'REPORT_MEASUREMENT');
      ensure(measurement.bodyIds.length > 0 && measurement.mappedChunks > 0, 'REPORT_COVERAGE');
      continue;
    }
    const set = maps.rootSets.get(measurement.rootSetId), root = rootLookups.get(set?.id)?.byId.get(measurement.rootId);
    ensure(set && root && root.subjectId === measurement.subjectId && set.artifactId === measurement.artifactId
      && set.graph === 'static-direct-calls' && measurement.method === 'static-direct-calls-v1', 'REPORT_ROOTS');
    let expected = root.bodyIds;
    if (measurement.metric !== 'reachable') {
      ensure(set.universeComplete && measurement.fact.coverage === 'exact', 'REPORT_ROOTS');
      const counts = rootLookups.get(set.id).counts;
      expected = root.bodyIds.filter(id => measurement.metric === 'own' ? counts.get(id) === 1 : counts.get(id) > 1);
    }
    ensure(same(expected, measurement.bodyIds), 'REPORT_MEASUREMENT');
  }
  for (const resource of capsule.resources) {
    fact(resource.inputBytes); fact(resource.retainedPayloadBytes);
    if (resource.artifactId !== null) references([resource.artifactId], maps.artifacts);
    if (resource.retainedPayloadBytes.state === 'available') ensure(resource.artifactId !== null
      && resource.retainedPayloadBytes.value <= maps.artifacts.get(resource.artifactId).bytes, 'REPORT_LEDGER');
  }
  return capsule;
}
function evidenceDigest(capsule) { const { evidenceHash, ...payload } = capsule; return sha256(canonicalJson(payload)); }
function createCapsule(input) {
  // Projection is explicit and happens before hashing. It strips unsupported
  // fields; it cannot recognize a secret deliberately placed in an allowed name.
  const projected = project(copyData(input), capsuleSchema);
  ensure(projected && typeof projected === 'object' && !Array.isArray(projected), 'REPORT_SCHEMA');
  projected.evidenceHash = { algorithm: 'sha256', value: '0'.repeat(64) };
  validate(projected, capsuleSchema);
  const capsule = check(normalize(projected));
  capsule.evidenceHash.value = evidenceDigest(capsule);
  canonicalJson(capsule);
  return freeze(capsule);
}
function validateCapsule(input) {
  const data = copyData(input);
  if (data?.kind !== 'pulse.application-report' || data.reportVersion !== 1) fail('REPORT_VERSION');
  validate(data, capsuleSchema);
  const capsule = check(normalize(data));
  ensure(capsule.evidenceHash.value === evidenceDigest(capsule), 'REPORT_HASH');
  return freeze(capsule);
}
const parseCapsule = input => validateCapsule(parseJson(input));
const serializeCapsule = input => canonicalJson(validateCapsule(input)) + '\n';
const htmlPayload = input => serializeCapsule(input).replace(/[<>&\u2028\u2029]/g,
  value => '\\u' + value.charCodeAt(0).toString(16).padStart(4, '0'));
const terminalText = input => String(input).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g,
  value => '\\u' + value.charCodeAt(0).toString(16).padStart(4, '0'));
module.exports = { createCapsule, validateCapsule, parseCapsule, serializeCapsule, htmlPayload, terminalText,
  stableReportId, artifactId, bodyId, evidenceDigest };
