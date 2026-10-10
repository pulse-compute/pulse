'use strict';

const { packageOperationRecognitionForCompiled } = require('./spine/package-operation-seam');

// Build-time projection of compiler facts. This record never enters the Native
// plan, executable source, recipe or provider configuration. Unknown expressions
// are not evaluated or serialized, and reference resolution is not host binding.
function collectCanonicalReportReferences(compiled, plan) {
  const raw = compiled.metadata.applicationEntries || plan.routing?.entries || [];
  const entries = new Set(raw.map(row => row.stableId));
  if (!raw.length) entries.add('default');
  const helpers = new Map(), rows = new Map();
  const schemas = new Set((compiled.schema?.registry || plan.schemas?.registry)?.schemas?.map(row => row.id) || []);
  const unique = values => [...new Set(values)].sort();
  function calls(value, stageConsumers) {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'helper-call' || value.kind === 'pure-helper-call') {
      if (!helpers.has(value.helperId)) helpers.set(value.helperId, new Set());
      for (const entry of stageConsumers || [value.callerEntryId]) helpers.get(value.helperId).add(entry);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') {
      if (Array.isArray(child)) child.forEach(row => calls(row, stageConsumers)); else calls(child, stageConsumers);
    }
  }
  for (const body of [plan.entry.body, ...(plan.handlers || []).map(row => row.body)]) calls(body);
  for (const stage of plan.stages || []) calls(stage.body, stage.registrations.map(row => row.entryId));
  // Package provenance comes from the trusted recognition bundle, never a file
  // name, schema name or usage-string guess. Keep it outside executable metadata.
  const packageSources = new Map();
  const referenceKey = row => JSON.stringify([row.id, row.usage, row.capability,
    row.file || compiled.metadata.file || '', row.position?.offset]);
  for (const source of packageOperationRecognitionForCompiled(compiled)?.publicExtensions?.plans || []) {
    for (const reference of source.schemaReferences || []) {
      const key = referenceKey(reference);
      if (!packageSources.has(key)) packageSources.set(key, new Set());
      packageSources.get(key).add(source.package);
    }
  }
  function owners(effect) {
    if (effect.helperId) return [...(helpers.get(effect.helperId) || [])];
    const entry = effect.applicationEntryStableId || effect.routerEntryStableId;
    return entry ? [entry] : raw.length ? [] : ['default'];
  }
  function add(kind, canonicalId, bindingKind, consumers, observationId, detail = {}) {
    const state = canonicalId === null ? detail.dynamic ? 'dynamic' : 'unknown' : detail.unresolved ? 'unknown' : 'resolved';
    const key = JSON.stringify([kind, bindingKind, state, state === 'resolved' ? canonicalId : observationId]);
    let row = rows.get(key);
    if (!row) {
      row = { kind, canonicalId, bindingKind, state, observationId: state === 'resolved' ? null : observationId,
        entryIds: [], entriesComplete: true, ...(detail.resource ? { resource: detail.resource } : {}) };
      rows.set(key, row);
    }
    row.entryIds.push(...consumers.filter(id => entries.has(id)));
    row.entriesComplete &&= consumers.length > 0 && consumers.every(id => entries.has(id));
    if (detail.externalPackages?.length) row.externalPackages = unique([...(row.externalPackages || []), ...detail.externalPackages]);
  }
  const literal = value => value?.kind === 'literal' && typeof value.value === 'string' ? value.value : null;
  const input = (effect, name) => effect.inputs?.find(row => row.name === name)?.value;
  const field = (object, name) => object?.kind === 'object'
    ? object.entries?.find(row => row.key?.kind === 'literal' && row.key.value === name)?.value : null;
  for (const effect of plan.effects || []) {
    const consumers = owners(effect), kind = effect.providerKind;
    if (['config', 'secret', 'kv', 's3'].includes(kind)) {
      const expression = kind === 's3' ? field(input(effect, 'resource'), 'binding')
        : input(effect, kind === 'kv' ? 'store' : 'name');
      const resolved = literal(expression);
      const name = resolved ?? (effect.resource?.kind === 'literal' && typeof effect.resource.value === 'string' ? effect.resource.value : null);
      add('binding', name, kind, consumers, effect.id, {
        dynamic: effect.resource?.kind === 'dynamic' || Boolean(expression && expression.kind !== 'literal')
      });
    }
    if (effect.kind === 'event.emit') {
      const schema = literal(field(input(effect, 'emission'), 'schema'));
      if (schema !== null) add('schema', schema, null, consumers, effect.id, { unresolved: !schemas.has(schema) });
    }
    if (effect.kind !== 'assets.lookup') continue;
    const payload = input(effect, 'payload'), embeddedId = literal(field(payload, 'embeddedId'));
    const key = literal(field(payload, 'key'));
    const found = field(payload, 'embeddedFound')?.value === true;
    const bytes = field(payload, 'embeddedLength')?.value;
    const encoded = literal(field(payload, 'embeddedData'));
    const known = embeddedId !== null && key !== null && found && Number.isSafeInteger(bytes) && bytes >= 0;
    add('resource', embeddedId !== null && key !== null ? embeddedId + ':' + key : null, null, consumers, effect.id, {
      unresolved: !known,
      dynamic: Boolean(field(payload, 'key') && field(payload, 'key').kind !== 'literal'),
      ...(known ? { resource: { name: key, mediaType: literal(field(payload, 'embeddedType')), inputBytes: bytes,
        encodedBytes: encoded === null ? null : Buffer.byteLength(encoded, 'utf8') } } : {})
    });
  }
  // These offsets are compiler-generated entry/helper ranges, not a reader's source
  // heuristic. Authored package references from another file cannot borrow an
  // unrelated generated offset. Unassociated references remain observations.
  for (const [index, reference] of (compiled.metadata.schemaReferences || []).entries()) {
    const sameFile = !reference.file || reference.file === compiled.metadata.file;
    const offset = reference.position?.offset;
    const contains = row => row.generatedRange && offset >= row.generatedRange.start && offset < row.generatedRange.end;
    const located = sameFile && Number.isSafeInteger(offset);
    const matches = located ? raw.filter(contains) : [];
    const helperMatches = located ? (plan.routing?.helpers || []).filter(contains) : [];
    const consumers = !raw.length && sameFile ? ['default']
      : matches.length === 1 && !helperMatches.length ? [matches[0].stableId]
      : !matches.length && helperMatches.length === 1 ? [...(helpers.get(helperMatches[0].id) || [])] : [];
    const name = typeof reference.id === 'string' && reference.id ? reference.id : null;
    add('schema', name, null, consumers, 'schema:' + index, { unresolved: !schemas.has(name),
      externalPackages: [...(packageSources.get(referenceKey(reference)) || [])] });
  }
  for (const event of compiled.eventCatalog?.events || []) if (event.schemaId) {
    add('schema', event.schemaId, null, [event.stableId], event.stableId, { unresolved: !schemas.has(event.schemaId) });
  }
  // Only compact allowlisted data crosses into Report. No provider metadata,
  // effect payloads, binding values, resource bodies or expression text survives.
  const routeBehaviors = require('./report-route-behavior').routeBehaviorForMetadata(compiled.metadata.router);
  return Object.freeze({ version: 'pulse.compiler-report-references.v1',
    ...(routeBehaviors ? { routeBehaviors } : {}),
    responsePayloads: require('./report-response-payloads').collectResponsePayloads(plan, entries, helpers),
    references: Object.freeze([...rows.values()].map(row => Object.freeze({ ...row, entryIds: Object.freeze(unique(row.entryIds)),
      ...(row.externalPackages ? { externalPackages: Object.freeze(row.externalPackages) } : {}),
      ...(row.resource ? { resource: Object.freeze(row.resource) } : {}) }))) });
}

module.exports = { collectCanonicalReportReferences };
