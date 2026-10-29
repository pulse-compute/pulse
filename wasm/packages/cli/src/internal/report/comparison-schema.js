'use strict';

// Shared wire contract; projections below consume validated Report v1 capsules.
const { capsuleSchema } = require('./schema');
const { LIMITS, freeze } = require('./data');
const text = { type: 'string', minLength: 1, maxLength: LIMITS.stringBytes };
const uint = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const signed = { ...uint, minimum: -Number.MAX_SAFE_INTEGER };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const ref = name => ({ $ref: '#/$defs/' + name });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const en = (...values) => ({ enum: values });
const array = items => ({ type: 'array', items, maxItems: LIMITS.records });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const COLLECTIONS = ['routes', 'entries', 'schemas', 'bindings', 'resources', 'implementations', 'declarations', 'references', 'evidence', 'observations'];
const SEMANTIC_COLLECTIONS = ['handlers', 'registrations', 'useSites', 'helperCalls', 'associations'];
const HOST_COLLECTIONS = ['hostContributions', 'hostUseSites', 'hostAudits'];
const ALL_COLLECTIONS = [...COLLECTIONS, ...HOST_COLLECTIONS, ...SEMANTIC_COLLECTIONS];
const states = ['added', 'removed', 'modified', 'coverage-changed', 'unresolved'];
const defs = {
  ...capsuleSchema.$defs,
  // {} deliberately accepts a bounded JSON value, never an executable JS value.
  // copyData admission and explicit projections own that boundary.
  CompareValue: object({ recorded: { type: 'boolean' }, value: {} }),
  CompareField: object({ path: text, kind: en('value', 'coverage'), before: ref('CompareValue'), after: ref('CompareValue'),
    delta: nullable(signed), deltaReason: nullable(en('missing-evidence', 'incompatible-artifacts', 'incomparable-evidence', 'non-exact-evidence')) }),
  CompareArtifact: object(Object.fromEntries(['id', 'sha256', 'bytes', 'representation', 'stage', 'host', 'target'].map(key => [key, capsuleSchema.$defs.Artifact.properties[key]]))),
  CompareSource: object({ capsuleHash: hash, reportVersion: { const: 1 }, producer: capsuleSchema.properties.producer,
    application: capsuleSchema.properties.application, context: ref('Context'), provenance: capsuleSchema.properties.provenance,
    artifact: ref('CompareArtifact'), build: nullable(ref('Build')) }),
  CompareCounts: object(Object.fromEntries(['added', 'removed', 'modified', 'coverageChanged', 'unresolvedBefore', 'unresolvedAfter', 'unchanged'].map(key => [key, uint]))),
  CompareInventory: object({ collection: en(...ALL_COLLECTIONS), before: ref('Coverage'), after: ref('Coverage'),
    delta: nullable(signed), counts: ref('CompareCounts') }),
  CompareChange: object({ key: text, label: text, status: en(...states),
    basis: en('logical-key', 'canonical-id', 'same-artifact', 'retained-identity', 'authored-source-slot', 'semantic-links', 'unresolved'),
    beforeIds: array(text), afterIds: array(text),
    reason: nullable(en('ambiguous-identity', 'missing-identity', 'incomplete-inventory')),
    fields: array(ref('CompareField')) }),
  CompareSection: object({ collection: en(...ALL_COLLECTIONS), changes: array(ref('CompareChange')) }),
  CompareCheck: object({ path: text, impact: en('blocking', 'qualifying'), status: en('same', 'changed', 'unknown'),
    before: ref('CompareValue'), after: ref('CompareValue') })
};
// Identity coverage is mandatory for v2 semantic inventories, checked by validator.
defs.CompareIdentityCoverage = object({ ...defs.Coverage.properties, reason: nullable(text) });
defs.CompareInventory.properties.identityCoverage = object({ before: ref('CompareIdentityCoverage'), after: ref('CompareIdentityCoverage') });
const shape = object({ kind: { const: 'pulse.report-comparison' }, comparisonVersion: { const: 1 },
  matchingVersion: en('pulse.report-matching.v1', 'pulse.report-matching.v2'),
  sources: object({ before: ref('CompareSource'), after: ref('CompareSource') }),
  compatibility: object({ status: en('compatible', 'different-build', 'incompatible', 'unknown'), checks: array(ref('CompareCheck')) }),
  summary: object({ artifactBytes: object({ before: uint, after: uint, delta: nullable(signed), reason: nullable(en('incompatible-artifacts')) }),
    inventories: array(ref('CompareInventory')) }),
  metadataChanges: array(ref('CompareField')), sections: array(ref('CompareSection')),
  comparisonHash: object({ algorithm: { const: 'sha256' }, value: hash }) });
const used = {};
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.$ref) { const name = node.$ref.slice('#/$defs/'.length); if (!used[name]) { used[name] = defs[name]; visit(defs[name]); } }
  Object.values(node).forEach(visit);
}
visit(shape);
module.exports = { HOST_COLLECTIONS: Object.freeze(HOST_COLLECTIONS), SEMANTIC_COLLECTIONS: Object.freeze(SEMANTIC_COLLECTIONS), COLLECTIONS: Object.freeze(COLLECTIONS), comparisonSchema: freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pulse:report:comparison:v1', ...shape, $defs: used
}) };
