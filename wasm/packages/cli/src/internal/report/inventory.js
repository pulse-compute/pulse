'use strict';

const path = require('node:path');
const { createCapsule, stableReportId: id } = require('./capsule');
const { projectSchema } = require('./schema-projection');
const { selectedProfile } = require('./snapshot');
const { relativePath } = require('./data');
const version = require('../../../package.json').version;
const producer = { name: 'pulse-report-collector', version: '1' };
const unique = values => [...new Set(values)];
const coverage = count => ({ status: 'complete', observed: count, expected: count, reason: null });
const unavailable = reason => ({ state: 'unavailable', basis: 'measured', coverage: 'partial', value: null, reason, evidenceIds: [] });
function source(value, root, zeroBasedColumn = false) {
  if (!value?.file || value.file.startsWith('<')) return null;
  const file = path.isAbsolute(value.file) ? path.relative(root, value.file).split(path.sep).join('/') : value.file;
  try { relativePath(file); } catch { return null; }
  const point = value.start || value;
  if (!Number.isInteger(point.line) || point.line < 1) return null;
  return { file, line: point.line, column: Math.max(1, (point.column || 0) + (zeroBasedColumn ? 1 : 0)) };
}
function collectInventory(project, prepared, artifacts, primaryId, optimization) {
  const { compiled, plan, native } = prepared;
  const references = prepared.reportReferences?.version === 'pulse.compiler-report-references.v1' ? prepared.reportReferences : null;
  const buildId = id('evidence', 'completed:' + primaryId), resolvedId = id('evidence', 'inventory:' + primaryId);
  const evidenceIds = [resolvedId], artifactIds = artifacts.map(row => row.id);
  const capsule = {
    kind: 'pulse.application-report', reportVersion: 1,
    producer: { pulseVersion: version, reporterVersion: '1' },
    context: { profile: selectedProfile(project), host: project.provider, target: 'native', representation: 'canonical-native-wasm', primaryArtifactId: primaryId },
    provenance: { revision: null, dirty: null, sourceFingerprint: null, buildEvidenceId: buildId,
      toolchain: [{ name: 'pulse', version }, { name: 'AssemblyScript', version: String(native.manifest.assemblyScript?.version || 'unavailable') }],
      recipe: { name: 'pulse-native', version: String(native.version), optimization, guestLinked: Boolean(native.manifest.guestLinkReport) } },
    application: { name: path.basename(project.root) }, routes: [], entries: [], declarations: [], schemas: [], bindings: [], resources: [],
    artifacts: artifacts.map(row => ({ id: row.id, sha256: row.sha256, bytes: row.bytes, representation: 'canonical-native-wasm',
      stage: row.stage, host: project.provider, target: row.target, sections: [],
      sectionCoverage: { status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' }, evidenceIds: [buildId] })),
    bodies: [], rootSets: [], measurements: [], observations: [],
    evidence: [
      { id: buildId, kind: 'build', producer, method: 'completed-native-build-v1', artifactIds, source: null, subjectIds: [], result: 'passed', scope: { corpus: null, cases: [], targets: ['native'] }, recordedAt: null },
      { id: resolvedId, kind: 'source', producer, method: references ? 'canonical-build-inventory-v2' : 'canonical-build-inventory-v1', artifactIds, source: null, subjectIds: [], result: 'observed', scope: { corpus: null, cases: [], targets: ['native'] }, recordedAt: null }
    ], coverage: {}
  };
  function observe(code, subjectIds = []) {
    const key = id('evidence', code + ':' + subjectIds.join(':'));
    if (!capsule.observations.some(row => row.id === key)) capsule.observations.push({ id: key, code, severity: 'info', producer, subjectIds, evidenceIds });
  }
  const routing = plan.routing || compiled.metadata.router;
  const raw = compiled.metadata.applicationEntries || routing?.entries || [];
  const entryIds = new Map(raw.map(row => [row.stableId, id('entry', row.stableId)]));
  // HTTP continuation indices terminate at the HTTP table boundary. Event
  // entries share application order but are never the HTTP fallthrough target.
  const indexIds = new Map(raw.filter(row => row.kind !== 'event').map(row => [row.index, entryIds.get(row.stableId)]));
  const events = new Map((compiled.eventCatalog?.events || []).map(row => [row.stableId, row]));
  for (const [order, row] of raw.entries()) {
    const event = events.get(row.stableId), body = plan.handlers?.find(body => body.id === row.stableId);
    capsule.entries.push({ id: entryIds.get(row.stableId), canonicalId: row.stableId, order,
      kind: ({ use: 'middleware', route: 'route', error: 'error', fallback: 'fallback', event: 'event' })[row.kind] || 'other',
      handlerId: row.handlerId ? id('handler', row.handlerId) : null, name: event?.type || row.kind,
      source: event ? source(event.source, project.root, true) : source(row.nativeBody?.source || body?.source, project.root),
      schemaIds: [], bindingIds: [], declarationIds: [], evidenceIds,
      flow: { nextEntryId: indexIds.get(row.nextIndex) || null, childEntryId: indexIds.get(row.childStartIndex) || null,
        parentContinueEntryId: indexIds.get(row.parentContinueIndex) || null, routerPath: row.routerPath || [],
        path: row.path ?? null, method: row.method ?? null, scoped: row.scoped === true, conditional: Boolean(row.when || row.condition || row.selection || row.kind === 'mount') } });
  }
  if (!raw.length) capsule.entries.push({ id: id('entry', 'default'), canonicalId: 'default', order: 0, kind: 'export',
    handlerId: id('handler', compiled.metadata.handler || 'default'), name: 'default',
    source: source(compiled.reachableGraph?.handlers?.[0]?.source, project.root), schemaIds: [], bindingIds: [], declarationIds: [], evidenceIds });
  const entries = new Map(capsule.entries.map(row => [row.canonicalId, row]));
  for (const [order, route] of (routing?.routes || []).entries()) {
    const entry = entries.get(route.routerEntryStableId);
    if (!entry) throw new TypeError('Canonical route has no execution entry');
    const candidates = raw.filter(row => row.index <= route.routerEntryIndex && (row.routerPath || []).every((name, i) => entry.flow.routerPath[i] === name)
      && ['use', 'mount'].includes(row.kind));
    capsule.routes.push({ id: id('route', route.stableId), canonicalId: route.stableId, order, method: route.method, path: route.path,
      handlerId: entry.handlerId, handlerName: route.handlerName || null, entryId: entry.id, source: entry.source,
      composition: [...candidates.map(row => entryIds.get(row.stableId)), entry.id], compositionCoverage: candidates.length ? 'bounded' : 'complete',
      schemaIds: [], bindingIds: [], declarationIds: [], evidenceIds });
  }
  const registry = compiled.schema?.registry || project.schemas?.registry;
  for (const schema of registry?.schemas || []) capsule.schemas.push({ id: id('schema', schema.id), schemaId: schema.id,
    registryVersion: registry.version, source: source(schema.source, project.root), structure: projectSchema(schema, registry.version),
    routeIds: [], entryIds: [], evidenceIds });
  const schemaMap = new Map(capsule.schemas.map(row => [row.schemaId, row]));
  function linkSchema(schemaId, entry) {
    const schema = schemaMap.get(schemaId);
    if (schema && entry) entry.schemaIds.push(schema.id);
    else observe('REPORT_SCHEMA_LINK_UNAVAILABLE');
  }
  for (const reference of references ? [] : compiled.metadata.schemaReferences || []) {
    const offset = reference.position?.offset;
    const owners = raw.filter(row => Number.isInteger(offset) && row.generatedRange && offset >= row.generatedRange.start && offset < row.generatedRange.end);
    const entry = raw.length ? owners.length === 1 && entries.get(owners[0].stableId) : capsule.entries[0];
    linkSchema(reference.id, entry);
  }
  if (!references) for (const [stableId, event] of events) if (event.schemaId) linkSchema(event.schemaId, entries.get(stableId));
  const bindings = new Map();
  function binding(kind, name, declared, entry) {
    const key = kind + ':' + name;
    let row = bindings.get(key);
    if (!row) { row = { id: id('binding', key), name, kind, declared: false, referenced: false, resolution: 'unavailable', routeIds: [], entryIds: [], evidenceIds }; bindings.set(key, row); }
    row.declared ||= declared; row.referenced ||= Boolean(entry);
    if (entry) entry.bindingIds.push(row.id);
    return row;
  }
  for (const kind of ['config', 'secret']) for (const name of project.bindings?.[kind] || []) binding(kind, name, true, null);
  function declaration(kind, name, entry) {
    const key = id('declaration', kind + ':' + name);
    if (!capsule.declarations.some(row => row.id === key)) capsule.declarations.push({ id: key, kind, name, evidenceIds });
    if (entry) entry.declarationIds.push(key);
  }
  const effects = plan.effects || [];
  for (const capability of compiled.metadata.capabilities || []) declaration('capability-reference', capability, null);
  for (const effect of effects) {
    const entry = entries.get(effect.applicationEntryStableId || effect.routerEntryStableId) || (!raw.length ? capsule.entries[0] : null);
    if (effect.capability) declaration('capability-reference', effect.capability, entry);
    if (references) continue;
    if (['config', 'secret', 'kv', 's3', 'assets'].includes(effect.providerKind) && effect.resource?.kind === 'literal') {
      const name = effect.resource.value;
      if (typeof name === 'string' && effect.providerKind !== 'assets') binding(effect.providerKind, name, false, entry);
    } else if (['config', 'secret', 'kv', 's3'].includes(effect.providerKind)) observe('REPORT_DYNAMIC_BINDING_REFERENCE', entry ? [entry.id] : []);
    if (effect.kind === 'event.emit') {
      const fields = effect.inputs?.find(input => input.name === 'emission')?.value?.entries || [];
      const schema = fields.find(field => field.key?.value === 'schema')?.value;
      if (schema?.kind === 'literal') linkSchema(schema.value, entry);
    }
  }
  for (const effect of references ? [] : effects) {
    const fields = effect.inputs?.find(input => input.name === 'payload')?.value?.entries || [];
    const payload = Object.fromEntries(fields.filter(field => field.key?.kind === 'literal' && field.value?.kind === 'literal'
      && ['embeddedId', 'embeddedFound', 'embeddedLength', 'embeddedType', 'key'].includes(field.key.value))
      .map(field => [field.key.value, field.value.value]));
    if (effect.kind !== 'assets.lookup' || !payload?.embeddedId || !payload.embeddedFound) continue;
    const key = id('resource', payload.embeddedId + ':' + payload.key);
    let resource = capsule.resources.find(row => row.id === key);
    if (!resource) {
      resource = { id: key, name: payload.key, kind: 'embedded-asset', mediaType: payload.embeddedType || null, artifactId: primaryId,
        inputBytes: { state: 'available', basis: 'resolved', coverage: 'exact', value: payload.embeddedLength, reason: null, evidenceIds },
        retainedPayloadBytes: unavailable('unsupported-mapping'), routeIds: [], entryIds: [], evidenceIds };
      capsule.resources.push(resource);
    }
    const owner = entries.get(effect.applicationEntryStableId || effect.routerEntryStableId) || (!raw.length ? capsule.entries[0] : null);
    if (owner) resource.entryIds.push(owner.id); else observe('REPORT_RESOURCE_LINK_UNAVAILABLE', [key]);
  }
  if (references) require('./reference-provenance').applyReferenceProvenance(capsule, references, { binding, evidenceIds, observe });
  // Package-owned declarations are deliberately narrow: entity names and their
  // schema IDs, never arbitrary metadata, auth inference or policy booleans.
  for (const artifact of compiled.packageInspection?.artifacts || []) if (artifact.data?.version === 'pulse.entities-inspection.v1') {
    for (const router of artifact.data.routers || []) for (const entity of router.entities || []) declaration('entity', entity.name, null);
    observe('REPORT_PACKAGE_DECLARATION_LINK_UNAVAILABLE');
  }
  capsule.bindings = [...bindings.values()];
  for (const entry of capsule.entries) for (const key of ['schemaIds', 'bindingIds', 'declarationIds']) entry[key] = unique(entry[key]);
  for (const route of capsule.routes) {
    const composition = capsule.entries.filter(entry => route.composition.includes(entry.id));
    for (const key of ['schemaIds', 'bindingIds', 'declarationIds']) route[key] = unique(composition.flatMap(entry => entry[key]));
    if (route.compositionCoverage === 'bounded') observe('REPORT_COMPOSITION_BOUNDED', [route.id]);
  }
  for (const [rows, key] of [[capsule.schemas, 'schemaIds'], [capsule.bindings, 'bindingIds']]) for (const row of rows) {
    row.entryIds = capsule.entries.filter(entry => entry[key].includes(row.id)).map(entry => entry.id);
    row.routeIds = capsule.routes.filter(route => route[key].includes(row.id)).map(route => route.id);
  }
  require('./resource-inventory').addResourceInventory(capsule, prepared, evidenceIds);
  for (const resource of capsule.resources) {
    resource.entryIds = unique(resource.entryIds);
    resource.routeIds = capsule.routes.filter(route => route.composition.some(entry => resource.entryIds.includes(entry))).map(route => route.id);
  }
  if (capsule.bindings.some(row => row.resolution === 'unavailable')) observe('REPORT_BINDING_REALIZATION_UNAVAILABLE');
  for (const key of ['routes', 'entries', 'schemas', 'bindings', 'resources']) capsule.coverage[key] = coverage(capsule[key].length);
  // Producer-scoped counts are independent. Other generated support and final
  // payload identity remain unknown, so this is never a whole-program census.
  capsule.coverage.resources = { status: 'partial', observed: capsule.resources.length, expected: null, reason: 'incomplete-mapping' };
  if (capsule.observations.some(row => row.code === 'REPORT_DYNAMIC_BINDING_REFERENCE')
    || capsule.references?.some(row => row.kind === 'binding' && row.state !== 'resolved')) {
    capsule.coverage.bindings = { status: 'partial', observed: capsule.bindings.length, expected: null, reason: 'incomplete-mapping' };
  }
  observe('REPORT_GENERATED_RESOURCE_INVENTORY_PARTIAL');
  observe('REPORT_AUTHORIZATION_NOT_INFERRED'); observe('REPORT_ATTRIBUTION_NOT_RECORDED'); observe('REPORT_TESTS_NOT_RECORDED');
  if (registry?.version && registry.version !== 'pulse.schema-registry-ir.v5') observe('REPORT_SCHEMA_ADAPTER_UNAVAILABLE');
  return createCapsule(capsule);
}
module.exports = { collectInventory };
