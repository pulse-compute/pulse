'use strict';
const { inspectWasm } = require('@pulse-compute/wasm-build-support/files');
const { copyData, canonicalJson, sha256, fail } = require('./data');
const { validateAttribution } = require('./completion');
const { createCapsule, bodyId, stableReportId: id } = require('./capsule');
const producer = { name: 'pulse-report-size', version: '1' };
const unique = values => [...new Set(values)];
const unavailable = (reason, evidenceIds) => ({ state: 'unavailable', basis: 'measured', coverage: 'partial', value: null, reason, evidenceIds });
const measured = (value, evidenceIds, coverage = 'exact') => ({ state: 'available', basis: 'measured', coverage, value, reason: null, evidenceIds });
function census(bytes) {
  try { return inspectWasm(bytes); } catch { fail('REPORT_INVALID_WASM'); }
}
function verifyAttribution(input, artifact, bytes) {
  const capture = validateAttribution(input), physical = census(bytes);
  if (capture.artifactId !== artifact.id || capture.artifactSha256 !== artifact.sha256 || capture.stage !== artifact.stage
    || sha256(bytes) !== artifact.sha256 || bytes.length !== artifact.bytes) fail('REPORT_IDENTITY');
  if (capture.importedFunctions !== physical.importedFunctions || canonicalJson(capture.functions) !== canonicalJson(physical.functions)) fail('REPORT_ATTRIBUTION');
  return capture;
}
function addSizeEvidence(input, files, attribution = null) {
  const capsule = copyData(input), entries = new Map(capsule.entries.map(row => [row.id, row]));
  if (attribution) {
    attribution = validateAttribution(attribution);
    if (!capsule.artifacts.some(row => row.id === attribution.artifactId && row.stage === attribution.stage)) fail('REPORT_IDENTITY');
  }
  capsule.observations = capsule.observations.filter(row => row.code !== 'REPORT_ATTRIBUTION_NOT_RECORDED');
  capsule.bodies = []; capsule.measurements = []; capsule.rootSets = [];
  for (const artifact of capsule.artifacts) {
    const bytes = files.get(artifact.id);
    if (!bytes || bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) fail('REPORT_ARTIFACT_HASH');
    const physical = census(bytes), evidenceId = id('evidence', 'size:' + artifact.id), evidenceIds = [evidenceId];
    capsule.evidence.push({ id: evidenceId, kind: 'measurement', producer, method: 'retained-wasm-ledger-and-attribution-v1',
      artifactIds: [artifact.id], source: null, subjectIds: [], result: 'observed',
      scope: { corpus: null, cases: [], targets: ['native'] }, recordedAt: null });
    artifact.evidenceIds.push(evidenceId);
    artifact.sections = physical.sections.map(({ offset, ...row }) => row);
    artifact.sectionCoverage = { status: 'complete', observed: physical.sections.length, expected: physical.sections.length, reason: null };
    const bodyBytes = physical.functions.reduce((n, row) => n + row.bytes, 0);
    const dataFact = physical.dataPayloadBytes === null ? unavailable('unsupported-mapping', evidenceIds) : measured(physical.dataPayloadBytes, evidenceIds);
    artifact.ledger = { headerBytes: 8, codeBodyBytes: bodyBytes,
      codeFramingBytes: physical.sections.filter(row => row.id === 10).reduce((n, row) => n + row.bytes, 0) - bodyBytes,
      dataPayloadBytes: dataFact, unattributedDataPayloadBytes: { ...dataFact } };
    capsule.bodies.push(...physical.functions.map(row => ({ ...row, id: bodyId(artifact.sha256, row.index), artifactId: artifact.id })));
    const capture = attribution?.artifactId === artifact.id ? verifyAttribution(attribution, artifact, bytes) : null;
    function graphObservation(diagnostic) {
      const key = id('evidence', 'graph:' + artifact.id + ':' + diagnostic.code);
      if (!capsule.observations.some(row => row.id === key)) capsule.observations.push({ id: key,
        code: 'REPORT_GRAPH_UNAVAILABLE', severity: 'info', producer, subjectIds: [artifact.id], evidenceIds,
        graphDiagnostic: diagnostic });
    }
    if (capture?.graph.diagnostic) graphObservation(capture.graph.diagnostic);
    if (!capture) {
      const prelink = attribution?.stage === 'prelink' && artifact.stage === 'final';
      graphObservation({ reason: prelink ? 'prelink-only' : 'missing-evidence', code: prelink ? 'prelink-evidence-only' : 'capture-absent',
        functionIndex: null, observed: null, expected: null });
    }
    const owners = new Map((capture?.attributionVersion === 2 ? capture.entries : (capture?.handlerBodies || []).map(row => ({
      ...row, bodies: row.chunks.map(chunk => ({ chunk, relation: 'terminal-body' })), reason: null
    }))).map(row => [row.entryId, row]));
    if (capture?.attributionVersion === 2) {
      const canonicalEntries = new Map(capsule.entries.map(row => [row.canonicalId, row]));
      for (const owner of owners.values()) {
        const entry = canonicalEntries.get(owner.entryId);
        if (!entry || entry.handlerId !== (owner.handlerId === null ? null : id('handler', owner.handlerId))) fail('REPORT_IDENTITY');
      }
    }
    const mappings = new Map((capture?.chunkMappings || []).map(row => [row.chunk, row]));
    const sizes = new Map(physical.functions.map(row => [row.index, row.bytes]));
    const outgoing = new Map();
    for (const edge of capture?.graph.edges || []) { if (!outgoing.has(edge.caller)) outgoing.set(edge.caller, []); outgoing.get(edge.caller).push(edge.callee); }
    let work = 0;
    function closure(roots) {
      const visited = new Set(), queue = [...roots];
      for (let i = 0; i < queue.length; i++) {
        if (++work > 1000000) {
          graphObservation({ reason: 'graph-budget-exhausted', code: 'traversal-work-limit',
            functionIndex: null, observed: work, expected: 1000000 });
          return null;
        }
        const index = queue[i]; if (visited.has(index) || index < physical.importedFunctions) continue;
        visited.add(index); queue.push(...(outgoing.get(index) || []));
      }
      return [...visited];
    }
    const set = { id: id('root-set', artifact.id), artifactId: artifact.id, universeComplete: false,
      graph: capture?.graph.state === 'available' ? 'static-direct-calls' : 'unsupported', roots: [], evidenceIds };
    // Route rows retain their historical subjects. v2 also exposes measurements
    // for middleware/error/etc. entries without duplicating route measurements.
    const routeEntries = new Set(capsule.routes.map(row => row.entryId));
    const subjects = [...capsule.routes, ...(capture?.attributionVersion === 2
      ? capsule.entries.filter(row => !routeEntries.has(row.id)) : [])];
    for (const subject of subjects) {
      const entry = subject.entryId ? entries.get(subject.entryId) : subject, owner = owners.get(entry.canonicalId);
      if (owner && (owner.handlerId === null ? null : id('handler', owner.handlerId)) !== subject.handlerId) fail('REPORT_IDENTITY');
      const chunks = owner?.bodies || [], carrier = chunks.some(body => body.relation === 'dispatcher-carrier');
      const mapped = chunks.filter(body => body.relation !== 'dispatcher-carrier')
        .map(body => mappings.get(body.chunk)).filter(row => row.functionIndex !== null);
      const indices = unique(mapped.map(row => row.functionIndex));
      const complete = chunks.length > 0 && mapped.length === chunks.length && !carrier && owner.reason === null;
      const unsupported = !owner || !chunks.length || chunks.some(body => mappings.get(body.chunk).reason === 'unsupported-mapping');
      const reason = !capture
        ? attribution?.stage === 'prelink' && artifact.stage === 'final' ? 'prelink-only' : 'missing-evidence'
        : owner?.reason || (carrier ? 'dispatcher-carrier' : unsupported ? 'unsupported-mapping'
          : capture.attributionVersion === 2 ? 'final-symbol-not-surviving' : 'incomplete-mapping');
      const base = { subjectId: subject.id, artifactId: artifact.id, stage: artifact.stage, mappedChunks: mapped.length,
        expectedChunks: owner && !owner.reason ? chunks.length : null, rootSetId: null, rootId: null };
      function measurement(metric, selected, coverage, why, root = null) {
        const available = selected !== null;
        capsule.measurements.push({ ...base, id: id('measurement', subject.id + ':' + artifact.id + ':' + metric), metric,
          method: available ? metric === 'handler-body' ? 'final-body-map-v1' : 'static-direct-calls-v1' : 'unavailable',
          fact: available ? measured(selected.reduce((n, index) => n + sizes.get(index), 0), evidenceIds, coverage) : unavailable(why, evidenceIds),
          bodyIds: available ? selected.map(index => bodyId(artifact.sha256, index)) : [],
          rootSetId: root ? set.id : null, rootId: root?.id || null });
      }
      measurement('handler-body', indices.length ? indices : null, complete ? 'exact' : 'partial', reason);
      const reached = complete && capture.graph.state === 'available' ? closure(indices) : null;
      const root = reached ? { id: id('root', subject.id + ':' + artifact.id), kind: subject.entryId ? 'route' : 'other', subjectId: subject.id,
        bodyIds: reached.map(index => bodyId(artifact.sha256, index)) } : null;
      if (root) set.roots.push(root);
      measurement('reachable', reached, 'bounded', complete
        ? capture.graph.state === 'available' ? 'graph-budget-exhausted' : capture.graph.reason
        : reason, root);
      measurement('own', null, 'partial', 'incomplete-root-universe');
      measurement('shared', null, 'partial', 'incomplete-root-universe');
    }
    if (set.roots.length) capsule.rootSets.push(set);
    capsule.observations.push({ id: id('evidence', 'size-limits:' + artifact.id), code: 'REPORT_SIZE_NONADDITIVE_CODE_ONLY_INCOMPLETE_ROOTS',
      severity: 'info', producer, subjectIds: [artifact.id], evidenceIds });
  }
  // Original asset input lengths and encoded schema descriptors cannot identify
  // final data segments. All retained data remains physically counted once and
  // unattributed; resource payload values retain explicit unavailability.
  return createCapsule(capsule);
}
module.exports = { addSizeEvidence, verifyAttribution, census };
