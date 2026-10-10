'use strict';

const { stableReportId: id } = require('./capsule');
const { fail } = require('./data');
const complete = count => ({ status: 'complete', observed: count, expected: count, reason: null });
const missing = (count = 0, expected = null, reason = 'not-recorded') => ({
  status: count || expected > 0 ? 'partial' : 'unavailable', observed: count, expected, reason
});
const unavailable = (reason = 'unsupported-mapping') => ({ state: 'unavailable', basis: 'measured', coverage: 'partial', value: null, reason, evidenceIds: [] });
const notApplicable = () => ({ ...unavailable('not-applicable'), state: 'not-applicable' });
const measured = (value, evidenceIds) => ({ state: 'available', basis: 'resolved', coverage: 'exact', value, reason: null, evidenceIds });

// Build-time adapters only. Each scope names the inventory actually enumerated;
// a selected asset is not an inventory of every file in its source manifest.
function addResourceInventory(capsule, prepared, evidenceIds) {
  const references = capsule.references, native = prepared.native;
  const projection = prepared.reportReferences?.version === 'pulse.compiler-report-references.v1' ? prepared.reportReferences : null;
  const producers = [];
  function record(scope, producer, rows, expected, reason = 'unsupported-mapping') {
    const coverage = expected !== null && expected === rows.length ? complete(expected) : missing(rows.length, expected, reason);
    producers.push({ scope, producer, resourceIds: rows.map(row => row.id), coverage, evidenceIds });
  }
  function consumerCoverage(target, known) {
    const refs = references?.filter(row => row.targetId === target.id) || [];
    return known && refs.every(row => row.entryCoverage.status === 'complete') ? complete(target.entryIds.length)
      : missing(target.entryIds.length, null, 'entry-ownership-not-retained');
  }
  const assetProducer = { name: '@pulse-compute/assets', version: 'pulse.embedded-assets.v1' };
  const assets = capsule.resources.filter(row => row.kind === 'embedded-asset');
  for (const resource of assets) {
    const input = projection?.references.find(row => row.kind === 'resource' && row.state === 'resolved'
      && id('resource', row.canonicalId) === resource.id)?.resource;
    const encoded = input?.encodedBytes;
    if (encoded != null && (!Number.isSafeInteger(encoded) || encoded !== 4 * Math.ceil(resource.inputBytes.value / 3))) fail('REPORT_RESOURCE_METRICS');
    resource.generator = { scope: 'selected-embedded-assets', producer: assetProducer, representation: 'base64-text',
      representationBytes: encoded == null ? unavailable('not-recorded') : measured(encoded, evidenceIds),
      schemaId: null, entryCoverage: consumerCoverage(resource, Boolean(projection)) };
  }
  const resolvedAssets = projection && projection.references.filter(row => row.kind === 'resource');
  record('selected-embedded-assets', assetProducer, assets,
    resolvedAssets && resolvedAssets.every(row => row.state === 'resolved') ? resolvedAssets.length : null, 'incomplete-mapping');

  const responses = projection?.responsePayloads;
  if (responses?.version === 'pulse.report-text-responses.v1') {
    const responseProducer = { name: 'pulse-native-text-responses', version: '1' }, responseRows = [];
    const entries = new Map(capsule.entries.map(row => [row.canonicalId, row.id]));
    for (const [index, site] of responses.sites.entries()) {
      if (!['resolved', 'dynamic', 'unknown'].includes(site.state) || typeof site.canonicalId !== 'string'
        || (site.state === 'resolved' ? !Number.isSafeInteger(site.inputBytes) || site.inputBytes < 0 : site.inputBytes !== null)
        || site.entryIds.some(key => !entries.has(key))) fail('REPORT_RESOURCE_METRICS');
      const entryIds = [...new Set(site.entryIds.map(key => entries.get(key)))];
      const resource = { id: id('resource', 'text-response:' + site.canonicalId), name: 'Text response ' + (index + 1),
        kind: 'response-payload', mediaType: site.mediaType, artifactId: null,
        inputBytes: site.state === 'resolved' ? measured(site.inputBytes, evidenceIds)
          : unavailable(site.state === 'dynamic' ? 'dynamic-reference' : 'unresolved-reference'),
        retainedPayloadBytes: unavailable(), routeIds: [], entryIds, evidenceIds,
        generator: { scope: 'canonical-text-responses', producer: responseProducer, representation: 'native-string',
          representationBytes: unavailable(), schemaId: null,
          entryCoverage: site.entriesComplete ? complete(entryIds.length) : missing(entryIds.length, null, 'entry-ownership-not-retained') } };
      responseRows.push(resource); capsule.resources.push(resource);
    }
    record('canonical-text-responses', responseProducer, responseRows, responses.sites.length);
  }

  const schemaProducer = { name: 'pulse-native-schema-codecs', version: '1' };
  const codecs = native.manifest.schemaCodecs?.codecs, schemaRows = [];
  if (Array.isArray(codecs)) for (const codec of codecs) {
    if (typeof codec.id !== 'string' || !codec.id) continue;
    const schema = capsule.schemas.find(row => row.schemaId === codec.id);
    const resource = { id: id('resource', 'schema-codec:' + codec.id), name: codec.id, kind: 'schema-validator',
      mediaType: 'application/json', artifactId: null, inputBytes: notApplicable(), retainedPayloadBytes: unavailable(),
      routeIds: [], entryIds: schema?.entryIds || [], evidenceIds,
      generator: { scope: 'schema-codecs', producer: schemaProducer, representation: 'pulse.report-schema-shape.v1',
        representationBytes: schema?.structure.state === 'available' ? measured(schema.structure.descriptorBytes, evidenceIds)
          : unavailable(schema?.structure.reason || 'missing-evidence'), schemaId: schema?.id || null,
        entryCoverage: schema ? consumerCoverage(schema, Boolean(references)) : missing(0, null, 'entry-ownership-not-retained') } };
    schemaRows.push(resource); capsule.resources.push(resource);
  }
  record('schema-codecs', schemaProducer, schemaRows, Array.isArray(codecs) ? codecs.length : null);

  const packageProducer = { name: 'pulse-package-lowering', version: '1' }, units = native.guestUnits, packageRows = [];
  if (Array.isArray(units)) for (const unit of units) {
    if (unit.version !== 'pulse.guest-unit-contribution.v1' || unit.origin !== 'package-prebuilt'
      || ![unit.id, unit.owner, unit.packageVersion].every(value => typeof value === 'string' && value)) continue;
    // No manifest path, module bytes, key material or package-private data.
    const resource = { id: id('resource', 'package-guest-unit:' + unit.owner + ':' + unit.id), name: unit.id, kind: 'helper',
      mediaType: 'application/wasm', artifactId: null, inputBytes: unavailable('not-recorded'), retainedPayloadBytes: unavailable(),
      routeIds: [], entryIds: [], evidenceIds, generator: { scope: 'package-guest-units',
        producer: { name: unit.owner, version: unit.packageVersion }, representation: 'package-guest-unit',
        representationBytes: unavailable('not-recorded'), schemaId: null, entryCoverage: missing(0, null, 'entry-ownership-not-retained') } };
    packageRows.push(resource); capsule.resources.push(resource);
  }
  record('package-guest-units', packageProducer, packageRows, Array.isArray(units) ? units.length : null);
  const artifacts = native.manifest.packageRealizationArtifacts;
  // Realization records may contain signing keys. Only their independent count
  // is safe here; do not retain IDs/hashes or serialize an arbitrary descriptor.
  const count = artifacts?.version === 'pulse.package-realization-artifact-set.v1'
    && Number.isSafeInteger(artifacts.count) && artifacts.count >= 0 ? artifacts.count : null;
  record('package-realizations', packageProducer, [], count);
  record('generated-support', { name: 'pulse-native-generator', version: '1' }, [], null);
  capsule.resourceProducers = producers;
}

module.exports = { addResourceInventory };
