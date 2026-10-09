'use strict';

const { stableReportId: id } = require('./capsule');

// Consume the build's allowlisted compiler projection. Replay only reads the
// retained capsule; this adapter never loads a compiler, provider or application.
function applyReferenceProvenance(capsule, projection, { binding, evidenceIds, observe }) {
  const entries = new Map(capsule.entries.map(row => [row.canonicalId, row]));
  const schemas = new Map(capsule.schemas.map(row => [row.schemaId, row]));
  capsule.references = [];
  for (const input of projection.references) {
    const consumers = input.entryIds.map(key => entries.get(key));
    if (consumers.some(row => !row)) throw new TypeError('Report reference has no canonical execution entry');
    const entryIds = consumers.map(row => row.id);
    let target = null;
    if (input.state === 'resolved' && input.kind === 'binding') {
      target = binding(input.bindingKind, input.canonicalId, false, null);
      target.referenced = true;
      for (const entry of consumers) entry.bindingIds.push(target.id);
    } else if (input.state === 'resolved' && input.kind === 'schema') {
      target = schemas.get(input.canonicalId) || null;
      if (target) for (const entry of consumers) entry.schemaIds.push(target.id);
    } else if (input.state === 'resolved' && input.kind === 'resource' && input.resource) {
      target = { id: id('resource', input.canonicalId), name: input.resource.name, kind: 'embedded-asset',
        mediaType: input.resource.mediaType, artifactId: capsule.context.primaryArtifactId,
        inputBytes: { state: 'available', basis: 'resolved', coverage: 'exact', value: input.resource.inputBytes, reason: null, evidenceIds },
        retainedPayloadBytes: { state: 'unavailable', basis: 'measured', coverage: 'partial', value: null, reason: 'unsupported-mapping', evidenceIds: [] },
        routeIds: [], entryIds, evidenceIds };
      capsule.resources.push(target);
    }
    const state = target ? 'resolved' : input.state === 'dynamic' ? 'dynamic' : 'unknown';
    const row = { id: id('reference', JSON.stringify([input.kind, input.bindingKind, input.canonicalId, input.observationId])),
      kind: input.kind, bindingKind: input.bindingKind, canonicalId: input.canonicalId, state,
      reason: state === 'resolved' ? null : state === 'dynamic' ? 'dynamic-reference' : 'unresolved-reference',
      targetId: target?.id || null, entryIds, evidenceIds,
      entryCoverage: input.entriesComplete ? { status: 'complete', observed: entryIds.length, expected: entryIds.length, reason: null }
        : { status: entryIds.length ? 'partial' : 'unavailable', observed: entryIds.length, expected: null, reason: 'entry-ownership-not-retained' } };
    capsule.references.push(row);
    if (state !== 'resolved') observe(state === 'dynamic' ? 'REPORT_DYNAMIC_REFERENCE' : 'REPORT_UNRESOLVED_REFERENCE', [row.id, ...entryIds]);
    if (!input.entriesComplete) observe('REPORT_REFERENCE_CONSUMER_UNAVAILABLE', [row.id, ...entryIds]);
  }
  const complete = capsule.references.every(row => row.state === 'resolved' && row.entryCoverage.status === 'complete');
  capsule.coverage.references = { status: complete ? 'complete' : 'partial', observed: capsule.references.length,
    expected: complete ? capsule.references.length : null, reason: complete ? null : 'incomplete-mapping' };
}

module.exports = { applyReferenceProvenance };
