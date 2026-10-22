'use strict';
const path = require('node:path');
const { relativePath, fail, canonicalJson } = require('./data');
const complete = count => ({ status: 'complete', observed: count, expected: count, reason: null });
const partial = count => ({ status: 'partial', observed: count, expected: null, reason: 'entry-ownership-not-retained' });
const unknown = () => ({ state: 'unavailable', basis: 'measured', coverage: 'partial', value: null, reason: 'not-recorded', evidenceIds: [] });
const fact = (value, evidenceIds) => ({ state: 'available', basis: 'resolved', coverage: 'exact', value, reason: null, evidenceIds });

function addComputation(capsule, projection, root, evidenceIds) {
  if (projection?.version !== 'pulse.compiler-report-computation.v1') return;
  const { stableReportId: id } = require('./capsule');
  const entries = new Map(capsule.entries.map(row => [row.canonicalId, row.id]));
  const entryIds = values => [...new Set(values.map(value => entries.get(value)).filter(Boolean))];
  function source(value) {
    if (value) {
      const file = path.isAbsolute(value.file) ? path.relative(root, value.file).split(path.sep).join('/') : value.file;
      try { relativePath(file); return { state: 'available', value: { ...value, file }, reason: null }; } catch { /* unknown */ }
    }
    return { state: 'unavailable', value: null, reason: 'not-recorded' };
  }
  const callees = projection.callees.map(row => {
    const location = source(row.source), consumers = entryIds(row.entryIds);
    return { id: id('handler', 'callable:' + (location.value?.file || 'unknown:' + row.index) + '#' + row.name),
      name: row.name, source: location, helpers: row.helpers.map(h => ({ name: h.name, source: source(h.source) })),
      inputSchema: row.inputSchema, outputSchema: row.outputSchema, entryIds: consumers,
      entryCoverage: row.entriesComplete && consumers.length === row.entryIds.length ? complete(consumers.length) : partial(consumers.length),
      resourceIds: row.resourceIds.map(value => id('resource', 'binary:' + value)), bodyBytes: unknown() };
  });
  capsule.computation = { version: 'pulse.report-computation.v1', callees,
    sites: projection.sites.map(row => ({ calleeId: callees[row.callee].id, source: source(row.source), entryIds: entryIds(row.entryIds), managed: row.managed })),
    coverage: complete(callees.length), evidenceIds };
  const catalogue = projection.resources;
  if (!catalogue) return;
  const backings = new Map();
  const producer = { name: 'pulse-binary-resources', version: '1' }, resources = [];
  for (const row of catalogue.records) {
    const resourceId = id('resource', 'binary:' + row.id), consumers = entryIds(row.entryIds);
    if (!backings.has(row.blobId)) backings.set(row.blobId, { id: row.blobId, sha256: row.sha256,
      byteLength: row.byteLength, resourceIds: [], selected: false });
    const backing = backings.get(row.blobId); backing.resourceIds.push(resourceId); backing.selected ||= row.selected;
    resources.push({ id: resourceId, name: row.id, kind: 'binary-resource', mediaType: null, artifactId: null,
      inputBytes: fact(row.byteLength, evidenceIds), retainedPayloadBytes: unknown(), entryIds: consumers, routeIds: [], evidenceIds,
      binary: { backingId: row.blobId, sha256: row.sha256, selected: row.selected, calleeIds: row.calleeIndices.map(i => callees[i].id) },
      generator: { scope: 'binary-resources', producer, representation: 'native-immutable-data',
        representationBytes: unknown(), schemaId: null,
        entryCoverage: row.selected ? partial(consumers.length) : complete(0) } });
  }
  const all = [...backings.values()], selected = all.filter(row => row.selected);
  capsule.binaryResources = { version: 'pulse.report-binary-resources.v1', identity: catalogue.identity, manifestId: catalogue.manifestId,
    budgets: catalogue.budgets, source: catalogue.source, bindingCount: resources.length, uniqueBackingCount: all.length,
    selectedBindingCount: resources.filter(row => row.binary.selected).length, selectedUniqueBackingCount: selected.length,
    declaredBackingBytes: fact(catalogue.backingBytes, evidenceIds), selectedBackingBytes: fact(selected.reduce((n, row) => n + row.byteLength, 0), evidenceIds),
    observedBackingBytes: unknown(), observedArtifactId: null, observedRanges: [],
    instanceMemoryBytes: unknown(), processMemoryBytes: unknown(), backings: all, evidenceIds };
  capsule.resources.push(...resources);
  capsule.resourceProducers.push({ scope: 'binary-resources', producer, resourceIds: resources.map(row => row.id), coverage: complete(resources.length), evidenceIds });
}

function validateComputation(capsule) {
  const c = capsule.computation, b = capsule.binaryResources;
  const ensure = value => { if (!value) fail('REPORT_COMPUTATION'); };
  const equal = (a, b) => canonicalJson([...a].sort()) === canonicalJson([...b].sort());
  const resources = capsule.resources.filter(row => row.kind === 'binary-resource');
  ensure(capsule.resources.every(row => Boolean(row.binary) === (row.kind === 'binary-resource')));
  const entries = new Set(capsule.entries.map(row => row.id));
  const evidence = new Set(capsule.evidence.map(row => row.id));
  const ids = values => ensure(new Set(values).size === values.length);
  const unknown = value => ensure(value.state === 'unavailable' && value.value === null && value.reason === 'not-recorded'
    && value.basis === 'measured' && value.coverage === 'partial' && value.evidenceIds.length === 0);
  function source(s) {
    ensure(s.state === 'available' ? s.value && s.reason === null : s.state === 'unavailable' && s.value === null && s.reason === 'not-recorded');
    if (s.value) { relativePath(s.value.file); ensure(s.value.end.offset > s.value.start.offset
      && (s.value.end.line > s.value.start.line || s.value.end.line === s.value.start.line && s.value.end.column > s.value.start.column)); }
  }
  function consumers(row) { ids(row.entryIds); ensure(row.entryIds.every(id => entries.has(id))); }
  if (c) {
    ids(c.callees.map(row => row.id)); ensure(c.evidenceIds.length && c.evidenceIds.every(id => evidence.has(id)));
    ensure(c.coverage.status === 'complete' && c.coverage.observed === c.callees.length && c.coverage.expected === c.callees.length && c.coverage.reason === null);
    for (const row of c.callees) {
      source(row.source); row.helpers.forEach(h => source(h.source)); consumers(row); unknown(row.bodyBytes);
      ids(row.resourceIds); ensure(row.resourceIds.every(id => resources.some(r => r.id === id && r.binary.calleeIds.includes(row.id))));
      const sites = c.sites.filter(site => site.calleeId === row.id);
      ensure(sites.length > 0 && equal(row.entryIds, new Set(sites.flatMap(site => site.entryIds))));
      ensure(row.entryCoverage.observed === row.entryIds.length);
      ensure(row.entryCoverage.status === 'complete' ? row.entryCoverage.expected === row.entryIds.length && row.entryCoverage.reason === null && sites.every(site => site.entryIds.length)
        : row.entryCoverage.status === 'partial' && row.entryCoverage.expected === null && row.entryCoverage.reason === 'entry-ownership-not-retained');
    }
    for (const site of c.sites) { source(site.source); consumers(site); ensure(c.callees.some(row => row.id === site.calleeId)); }
  }
  ensure(Boolean(b) === Boolean(capsule.resourceProducers?.some(row => row.scope === 'binary-resources')));
  if (!b) { ensure(!resources.length); return; }
  ensure(c && b.evidenceIds.length && b.evidenceIds.every(id => evidence.has(id)));
  ids(b.backings.map(row => row.id));
  ensure(b.bindingCount === resources.length && b.uniqueBackingCount === b.backings.length
    && b.selectedBindingCount === resources.filter(row => row.binary.selected).length
    && b.selectedUniqueBackingCount === b.backings.filter(row => row.selected).length);
  for (const [metric, rows] of [['declaredBackingBytes', b.backings], ['selectedBackingBytes', b.backings.filter(row => row.selected)]]) {
    const f = b[metric]; ensure(f.state === 'available' && f.basis === 'resolved' && f.coverage === 'exact' && f.reason === null
      && f.value === rows.reduce((n, row) => n + row.byteLength, 0) && equal(f.evidenceIds, b.evidenceIds));
  }
  for (const k of ['instanceMemoryBytes', 'processMemoryBytes']) unknown(b[k]);
  if (b.observedBackingBytes.state === 'unavailable') {
    unknown(b.observedBackingBytes); ensure(b.observedArtifactId === null && !b.observedRanges.length);
  } else {
    const artifact = capsule.artifacts.find(row => row.id === b.observedArtifactId), f = b.observedBackingBytes;
    ensure(artifact && f.state === 'available' && f.basis === 'measured' && f.coverage === 'exact' && f.reason === null
      && f.value === b.selectedBackingBytes.value && f.evidenceIds.length === 1);
    const proof = capsule.evidence.find(row => row.id === f.evidenceIds[0]);
    ensure(proof?.method === 'disjoint-raw-data-ranges-v1' && equal(proof.artifactIds, [artifact.id]));
    ensure(equal(b.observedRanges.map(row => row.backingId), b.backings.filter(row => row.selected && row.byteLength).map(row => row.id)));
    let end = 0;
    for (const range of b.observedRanges) {
      const backing = b.backings.find(row => row.id === range.backingId);
      ensure(backing && range.bytes === backing.byteLength && range.bytes >= 32 && range.offset >= end
        && range.offset + range.bytes <= artifact.bytes); end = range.offset + range.bytes;
    }
  }
  ensure(b.bindingCount <= b.budgets.bindings && b.source.recordCount <= b.budgets.files
    && b.source.decodedBytes <= b.budgets.totalBytes && b.source.serializedBytes <= b.budgets.serializedBytes
    && b.declaredBackingBytes.value <= b.source.decodedBytes && b.uniqueBackingCount <= b.source.recordCount);
  for (const backing of b.backings) {
    const rows = resources.filter(row => row.binary.backingId === backing.id);
    ensure(rows.length && equal(backing.resourceIds, rows.map(row => row.id)) && backing.selected === rows.some(row => row.binary.selected)
      && backing.id === backing.sha256 + ':' + backing.byteLength && backing.byteLength <= b.budgets.fileBytes);
    for (const row of rows) ensure(row.inputBytes.value === backing.byteLength && row.binary.sha256 === backing.sha256);
  }
  for (const row of resources) {
    ensure(b.backings.some(backing => backing.id === row.binary.backingId)); ids(row.binary.calleeIds);
    ensure(row.binary.calleeIds.every(id => c.callees.some(callee => callee.id === id && callee.resourceIds.includes(row.id))));
    if (!row.binary.selected) ensure(!row.entryIds.length && !row.binary.calleeIds.length);
  }
}
module.exports = { addComputation, validateComputation };
