'use strict';

// No IO, compiler, provider or viewer dependencies. All consumers share this result.
const { validateCapsule } = require('./capsule');
const { comparisonSchema, COLLECTIONS, SEMANTIC_COLLECTIONS } = require('./comparison-schema');
const { validate } = require('./validate');
const { copyData, canonicalJson: json, parseJson, sha256, freeze, fail } = require('./data');
const semantic = require('./semantic-comparison');
const same = (a, b) => json(a) === json(b);
const sort = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...new Set(values)].sort(sort);
const value = input => ({ recorded: input !== undefined, value: input === undefined ? null : input });
const keyFor = (collection, key) => collection + ':' + sha256(json(key));
const primary = c => c.artifacts.find(row => row.id === c.context.primaryArtifactId);
const pick = (row, keys) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const ensure = (condition, code = 'REPORT_COMPARISON') => { if (!condition) fail(code); };
const complete = coverage => coverage.status === 'complete';
const emptyCounts = () => ({ added: 0, removed: 0, modified: 0, coverageChanged: 0, unresolvedBefore: 0, unresolvedAfter: 0, unchanged: 0 });
function coverage(c, collection) {
  if (SEMANTIC_COLLECTIONS.includes(collection)) return semantic.coverage(c, collection);
  return c.coverage[collection] || { status: c[collection]?.length ? 'partial' : 'unavailable', observed: c[collection]?.length || 0,
    expected: null, reason: 'not-recorded' };
}
function source(c) {
  return { capsuleHash: c.evidenceHash.value, reportVersion: c.reportVersion, producer: c.producer, application: c.application,
    context: c.context, provenance: c.provenance, artifact: pick(primary(c), ['id', 'sha256', 'bytes', 'representation', 'stage', 'host', 'target']),
    build: c.build || null };
}
function buildSettings(c) {
  if (!c.build) return undefined;
  return { operation: c.build.operation, compilers: c.build.compilers.map(row => pick(row,
    ['phase', 'compilerVersion', 'toolchain', 'flags', 'flagsComplete', 'optimization', 'timeoutMs'])).map(row => ({ ...row,
      toolchain: [...row.toolchain].sort((a, b) => sort(a.name, b.name) || sort(a.version, b.version)) })).sort((a, b) => sort(a.phase, b.phase)) };
}
function compatibility(before, after) {
  const checks = [];
  function check(path, a, b, impact = 'qualifying', known = true) {
    checks.push({ path, impact, status: !known || a === undefined || b === undefined ? 'unknown' : same(a, b) ? 'same' : 'changed', before: value(a), after: value(b) });
  }
  for (const field of ['host', 'target', 'representation']) check('/context/' + field, before.context[field], after.context[field], 'blocking');
  for (const field of ['target', 'stage', 'representation', 'host']) check('/artifact/' + field, primary(before)[field], primary(after)[field], 'blocking');
  check('/application/name', before.application.name, after.application.name);
  check('/context/profile', before.context.profile, after.context.profile);
  check('/producer', before.producer, after.producer);
  check('/provenance/recipe', before.provenance.recipe, after.provenance.recipe, 'qualifying',
    ![before, after].some(c => c.provenance.recipe.optimization === 'unavailable'));
  check('/provenance/toolchain', before.provenance.toolchain, after.provenance.toolchain, 'qualifying',
    [before, after].every(c => c.provenance.toolchain.length && c.provenance.toolchain.every(t => t.version !== 'unavailable')));
  check('/build/settings', buildSettings(before), buildSettings(after), 'qualifying',
    [before, after].every(c => c.build?.compilers.length && c.build.compilers.every(row => row.flagsComplete
      && row.optimization.optimizeLevel !== null && row.optimization.shrinkLevel !== null)));
  const status = checks.some(row => row.impact === 'blocking' && row.status !== 'same') ? 'incompatible'
    : checks.some(row => row.status === 'changed') ? 'different-build' : checks.some(row => row.status === 'unknown') ? 'unknown' : 'compatible';
  return { status, checks };
}
function metric(fact, method = null, stage = null) {
  return fact ? { state: fact.state, value: fact.value, basis: fact.basis, coverage: fact.coverage, reason: fact.reason, method, stage }
    : { state: 'unavailable', value: null, basis: null, coverage: null, reason: 'not-recorded', method, stage };
}
function metricDelta(a, b, comparable) {
  if (!a || !b || a.state !== 'available' || b.state !== 'available') return { delta: null, deltaReason: 'missing-evidence' };
  if (!comparable) return { delta: null, deltaReason: 'incompatible-artifacts' };
  if (a.basis !== b.basis || a.method !== b.method || a.stage !== b.stage) return { delta: null, deltaReason: 'incomparable-evidence' };
  if (a.coverage !== 'exact' || b.coverage !== 'exact') return { delta: null, deltaReason: 'non-exact-evidence' };
  return { delta: b.value - a.value, deltaReason: null };
}
const isMetric = row => row && typeof row === 'object' && Object.hasOwn(row, 'state') && Object.hasOwn(row, 'basis') && Object.hasOwn(row, 'value');
const uncertain = row => row === undefined || row === null || row === 'unavailable' || row && typeof row === 'object'
  && (row.state === 'unavailable' || row.state === 'not-applicable' || row.status === 'unavailable' || row.status === 'partial' || row.complete === false);
function missingLinks(row) {
  return Boolean(row && typeof row === 'object' && (row.complete === false || Object.values(row).some(missingLinks)));
}
function fields(a, b, comparable, prefix = '') {
  const changes = [];
  function visit(left, right, path) {
    if (left === undefined && right === undefined || left !== undefined && right !== undefined && same(left, right)) return;
    const measure = isMetric(left) || isMetric(right);
    const objects = row => row && typeof row === 'object' && !Array.isArray(row);
    // Coverage and fact transitions are atomic, preserving their qualifications.
    const atomic = measure || typeof left?.complete === 'boolean' || typeof right?.complete === 'boolean'
      || /(?:Coverage|coverage|structure|consumers|composition|flow|via)$/.test(path)
      || (left && Object.hasOwn(left, 'state') && Object.hasOwn(left, 'value')) || (right && Object.hasOwn(right, 'state') && Object.hasOwn(right, 'value'));
    if (!atomic && objects(left) && objects(right)) {
      for (const name of sorted([...Object.keys(left), ...Object.keys(right)])) visit(left[name], right[name], path + '/' + name.replaceAll('~', '~0').replaceAll('/', '~1'));
    } else changes.push({ path: path || '/', kind: uncertain(left) || uncertain(right) || missingLinks(left) || missingLinks(right) || /coverage/i.test(path)
      || measure && ['state', 'basis', 'coverage', 'method', 'stage'].some(key => left?.[key] !== right?.[key]) ? 'coverage' : 'value',
      before: value(left), after: value(right), ...(measure ? metricDelta(left, right, comparable) : { delta: null, deltaReason: null }) });
  }
  visit(a, b, prefix); return changes;
}
function grouped(rows, identity) {
  const groups = new Map();
  for (const row of rows) { const key = identity(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  return groups;
}
function identity(c, collection, row, maps, index) {
  if (collection === 'routes') return ['route', row.method, row.path];
  if (collection === 'schemas') return ['schema', row.schemaId];
  if (collection === 'bindings') return ['binding', row.kind, row.name];
  if (collection === 'declarations') return ['declaration', row.kind, row.name];
  if (collection === 'references') return row.canonicalId !== null
    ? [row.kind, row.bindingKind, row.canonicalId] : null;
  if (collection === 'evidence') return [row.kind, row.producer.name, row.method, row.scope];
  if (collection === 'observations') return row.subjectIds.every(id => maps.has(id))
    ? [row.code, row.producer.name, sorted(row.subjectIds.map(id => maps.get(id)))] : null;
  if (collection === 'resources') {
    // Response names are ordinal presentation labels, not cross-build keys.
    if (row.kind === 'response-payload') return null;
    return ['resource', row.kind, row.generator?.scope || null, row.generator?.producer.name || null, row.name];
  }
  if (collection === 'entries') {
    const route = index.routes.get(row.id);
    if (route) return maps.get(route.id) ? ['route-entry', maps.get(route.id)] : null;
    if (!row.name) return null;
    return ['entry', row.kind, row.name, row.source?.file || null, row.flow?.routerPath || [], row.flow?.method || null, row.flow?.path || null];
  }
  // Generated chunk/function indices and artifact-bound implementation IDs are
  // not persistent identities. Only named implementation identities may join.
  if (collection === 'implementations') {
    const artifact = index.artifacts.get(row.artifactId), domain = [artifact.stage, artifact.host, artifact.target];
    if (row.origin === 'dispatcher') return null;
    if (row.origin === 'dedicated') {
      const entry = index.entries.get(row.canonicalId);
      return entry && maps.get(entry.id) ? [domain, 'dedicated', maps.get(entry.id)] : null;
    }
    return row.canonicalId === null ? null : [domain, row.origin, row.canonicalId];
  }
  return null;
}
function matching(a, b, collection, maps, indexes) {
  const left = a[collection] || [], right = b[collection] || [], pairs = [], pending = [];
  const identities = [new Map(), new Map()];
  for (const [index, c, rows] of [[0, a, left], [1, b, right]]) for (const row of rows) {
    const logical = identity(c, collection, row, maps[index], indexes[index]);
    identities[index].set(row.id, logical === null ? null : keyFor(collection, logical));
  }
  const groups = [grouped(left, row => identities[0].get(row.id)), grouped(right, row => identities[1].get(row.id))];
  for (const groupKey of sorted([...groups[0].keys(), ...groups[1].keys()].filter(key => key !== null))) {
    const before = groups[0].get(groupKey) || [], after = groups[1].get(groupKey) || [];
    if (before.length === 1 && after.length === 1) pairs.push({ key: groupKey, before: before[0], after: after[0], basis: 'logical-key' });
    else {
      const remaining = new Map(after.map(row => [row.canonicalId || row.id, row]));
      const uniqueCanonical = new Set(before.map(row => row.canonicalId || row.id)).size === before.length && remaining.size === after.length;
      const unmatched = [];
      for (const row of before) {
        const canonical = row.canonicalId || row.id, peer = uniqueCanonical && remaining.get(canonical);
        if (peer) { pairs.push({ key: keyFor(collection, [groupKey, canonical]), before: row, after: peer, basis: 'canonical-id' }); remaining.delete(canonical); }
        else unmatched.push(row);
      }
      const rest = uniqueCanonical ? [...remaining.values()] : after;
      if (unmatched.length || rest.length) pending.push({ key: groupKey, before: unmatched, after: rest,
        reason: before.length > 1 || after.length > 1 ? 'ambiguous-identity' : null });
    }
  }
  const unknownLeft = groups[0].get(null) || [], unknownRight = groups[1].get(null) || [];
  // Exact record IDs are sufficient only inside the same physical artifact.
  const sameArtifact = primary(a).sha256 === primary(b).sha256;
  const byId = new Map(unknownRight.map(row => [row.id, row]));
  const unresolved = [];
  for (const row of unknownLeft) {
    const peer = sameArtifact && byId.get(row.id);
    if (peer) { pairs.push({ key: keyFor(collection, ['artifact', primary(a).sha256, row.id]), before: row, after: peer, basis: 'same-artifact' }); byId.delete(row.id); }
    else unresolved.push(row);
  }
  if (unresolved.length || byId.size) pending.push({ key: keyFor(collection, ['unresolved']), before: unresolved, after: [...byId.values()], reason: 'missing-identity' });
  for (const pair of pairs) { maps[0].set(pair.before.id, pair.key); maps[1].set(pair.after.id, pair.key); }
  for (const item of pending) if (!item.reason) {
    item.before.forEach(row => maps[0].set(row.id, item.key)); item.after.forEach(row => maps[1].set(row.id, item.key));
  }
  return { pairs, pending };
}
function rowLabel(collection, row) {
  return collection === 'routes' ? row.method + ' ' + row.path : row.schemaId || row.name || row.canonicalId || row.origin || row.code || row.kind;
}
function scopedComplete(c, collection, row) {
  if (complete(coverage(c, collection))) return true;
  const scope = row.generator?.scope;
  return collection === 'resources' && scope && c.resourceProducers?.some(producer => producer.scope === scope && complete(producer.coverage));
}
function projector(c, maps, rank) {
  const byId = new Map([...c.artifacts, ...c.bodies].map(row => [row.id, row]));
  const measurements = grouped(c.measurements, row => row.subjectId);
  function refs(ids = [], ordered = false) {
    const known = ids.map(id => maps.get(id)).filter(Boolean);
    return { keys: ordered ? known : sorted(known), complete: known.length === ids.length, unresolved: ids.length - known.length };
  }
  function sizes(id) {
    return Object.fromEntries(['handler-body', 'reachable', 'own', 'shared'].map(name => {
      const rows = (measurements.get(id) || []).filter(row => row.metric === name && row.artifactId === c.context.primaryArtifactId);
      const facts = [...new Map(rows.map(row => [json(metric(row.fact, row.method, row.stage)), metric(row.fact, row.method, row.stage)])).values()];
      return [name, facts.length === 1 ? facts[0] : metric(null, facts.length ? 'conflicting-evidence' : null, 'final')];
    }));
  }
  return (collection, row) => {
    const common = pick(row, ['name', 'kind', 'source']);
    if (collection === 'routes' || collection === 'entries') {
      const result = { ...common, ...pick(row, ['method', 'path', 'handlerName', 'behavior', 'compositionCoverage']),
        schemas: refs(row.schemaIds), bindings: refs(row.bindingIds), declarations: refs(row.declarationIds), sizes: sizes(row.id) };
      if (rank.has(row.id)) result.relativeOrder = rank.get(row.id);
      if (row.composition) result.composition = refs(row.composition, true);
      if (row.flow) result.flow = { ...pick(row.flow, ['routerPath', 'path', 'method', 'scoped', 'conditional']),
        next: refs(row.flow.nextEntryId ? [row.flow.nextEntryId] : []), child: refs(row.flow.childEntryId ? [row.flow.childEntryId] : []),
        parentContinue: refs(row.flow.parentContinueEntryId ? [row.flow.parentContinueEntryId] : []) };
      return result;
    }
    if (collection === 'schemas') return { ...common, schemaId: row.schemaId, registryVersion: row.registryVersion, structure: row.structure,
      consumers: { routes: refs(row.routeIds), entries: refs(row.entryIds) } };
    if (collection === 'bindings') return { ...common, ...pick(row, ['declared', 'referenced', 'resolution']), consumers: { routes: refs(row.routeIds), entries: refs(row.entryIds) } };
    if (collection === 'declarations') return common;
    if (collection === 'references') return { ...pick(row, ['kind', 'bindingKind', 'canonicalId', 'state', 'reason', 'entryCoverage', 'externalPackages']),
      target: refs(row.targetId ? [row.targetId] : []), consumers: refs(row.entryIds) };
    if (collection === 'evidence') return { ...pick(row, ['kind', 'producer', 'method', 'source', 'result', 'scope', 'recordedAt']),
      subjects: refs(row.subjectIds), artifacts: row.artifactIds.map(id => pick(byId.get(id), ['stage', 'host', 'target'])).sort((a, b) => sort(json(a), json(b))) };
    if (collection === 'observations') return { ...pick(row, ['code', 'severity', 'producer']), subjects: refs(row.subjectIds),
      ...(row.graphDiagnostic ? { graphDiagnostic: pick(row.graphDiagnostic, ['reason', 'code', 'observed', 'expected']) } : {}) };
    if (collection === 'resources') return { ...common, mediaType: row.mediaType, inputBytes: metric(row.inputBytes), retainedPayloadBytes: metric(row.retainedPayloadBytes),
      consumers: { routes: refs(row.routeIds), entries: refs(row.entryIds) }, ...(row.generator ? { generator: {
        ...pick(row.generator, ['scope', 'producer', 'representation', 'entryCoverage']), schema: refs(row.generator.schemaId ? [row.generator.schemaId] : []),
        representationBytes: metric(row.generator.representationBytes) } } : {}) };
    const artifact = byId.get(row.artifactId), bytes = row.bodyIds.reduce((sum, id) => sum + byId.get(id).bytes, 0);
    return { origin: row.origin, roles: row.roles, consumerBasis: row.consumerBasis, entryCoverage: row.entryCoverage, bodyCoverage: row.bodyCoverage,
      consumers: { routes: refs(row.routeIds), entries: refs(row.entryIds) }, containingBodyBytes: metric({
        state: complete(row.bodyCoverage) ? 'available' : 'unavailable', value: complete(row.bodyCoverage) ? bytes : null,
        basis: 'measured', coverage: complete(row.bodyCoverage) ? 'exact' : 'partial', reason: complete(row.bodyCoverage) ? null : row.bodyCoverage.reason
      }, 'whole-containing-bodies-nonadditive', artifact.stage) };
  };
}
function buildProjection(c) {
  if (!c.build) return undefined;
  return { ...pick(c.build, ['operation', 'timingScope', 'totalDurationMs', 'compilationDurationMs', 'stages', 'providerArtifactReuse', 'cache']), settings: buildSettings(c) };
}
function compareCapsules(beforeInput, afterInput) {
  const before = validateCapsule(beforeInput), after = validateCapsule(afterInput);
  const collections = before.analytics || after.analytics ? [...COLLECTIONS, ...SEMANTIC_COLLECTIONS] : COLLECTIONS;
  const compatible = compatibility(before, after), comparable = compatible.status !== 'incompatible';
  const maps = [new Map(), new Map()], matches = new Map(), inventories = [], sections = [];
  const indexes = [before, after].map(c => ({ routes: new Map(c.routes.map(row => [row.entryId, row])), entries: new Map(c.entries.map(row => [row.canonicalId, row])), artifacts: new Map(c.artifacts.map(row => [row.id, row])) }));
  // Route keys precede entry keys; all matches exist before projecting links.
  for (const collection of COLLECTIONS) matches.set(collection, matching(before, after, collection, maps, indexes));
  const ranks = [new Map(), new Map()];
  for (const collection of ['routes', 'entries']) for (const [index, side] of [[0, 'before'], [1, 'after']]) {
    [...matches.get(collection).pairs].sort((a, b) => a[side].order - b[side].order).forEach((pair, rank) => ranks[index].set(pair[side].id, rank));
  }
  const project = [projector(before, maps[0], ranks[0]), projector(after, maps[1], ranks[1])];
  const authored = collections.length > COLLECTIONS.length ? semantic.prepareSemanticComparison(before, after, maps) : null;
  for (const collection of collections) {
    const isSemantic = SEMANTIC_COLLECTIONS.includes(collection);
    const projections = isSemantic ? authored.project : project;
    const counts = emptyCounts(), changes = [], match = (isSemantic ? authored.matches : matches).get(collection);
    for (const pair of match.pairs) {
      const delta = fields(projections[0](collection, pair.before), projections[1](collection, pair.after), comparable);
      if (!delta.length) { counts.unchanged++; continue; }
      const status = delta.every(row => row.kind === 'coverage') ? 'coverage-changed' : 'modified';
      counts[status === 'modified' ? 'modified' : 'coverageChanged']++;
      changes.push({ key: pair.key, label: isSemantic ? authored.label[1](collection,pair.after) : rowLabel(collection, pair.after), status, basis: pair.basis,
        beforeIds: [pair.before.id], afterIds: [pair.after.id], reason: null, fields: delta });
    }
    for (const item of match.pending) {
      const addition = !item.before.length, removal = !item.after.length;
      const known = !item.reason && (addition && item.after.every(row => scopedComplete(before, collection, row))
        || removal && item.before.every(row => scopedComplete(after, collection, row)));
      if (known) {
        const status = addition ? 'added' : 'removed', rows = addition ? item.after : item.before;
        for (const row of rows) {
          counts[status]++;
          const projected = projections[addition ? 1 : 0](collection, row);
          changes.push({ key: item.key, label: isSemantic ? authored.label[addition?1:0](collection,row) : rowLabel(collection, row), status, basis: isSemantic ? (collection === 'associations' ? 'semantic-links' : 'authored-source-slot') : 'logical-key',
            beforeIds: addition ? [] : [row.id], afterIds: addition ? [row.id] : [], reason: null,
            fields: fields(addition ? undefined : projected, addition ? projected : undefined, comparable) });
        }
      } else {
        counts.unresolvedBefore += item.before.length; counts.unresolvedAfter += item.after.length;
        changes.push({ key: item.key, label: isSemantic ? authored.label[item.after.length?1:0](collection,item.after[0] || item.before[0]) : rowLabel(collection, item.after[0] || item.before[0]), status: 'unresolved', basis: 'unresolved',
          beforeIds: item.before.map(row => row.id).sort(sort), afterIds: item.after.map(row => row.id).sort(sort),
          reason: item.reason || 'incomplete-inventory', fields: [] });
      }
    }
    const a = coverage(before, collection), b = coverage(after, collection);
    inventories.push({ collection, before: a, after: b, delta: complete(a) && complete(b) ? b.observed - a.observed : null, counts, ...(isSemantic ? {identityCoverage:{before:semantic.identityCoverage(a,changes,'before'),after:semantic.identityCoverage(b,changes,'after')}} : {}) });
    if (changes.length) sections.push({ collection, changes: changes.sort((a, b) => sort(a.key, b.key)) });
  }
  const metadata = c => ({ application: c.application, context: pick(c.context, ['profile', 'host', 'target', 'representation']),
    producer: c.producer, provenance: pick(c.provenance, ['revision', 'dirty', 'sourceFingerprint', 'toolchain', 'recipe']),
    ...(c.build ? { build: buildProjection(c) } : {}) });
  const result = { kind: 'pulse.report-comparison', comparisonVersion: 1, matchingVersion: authored ? 'pulse.report-matching.v2' : 'pulse.report-matching.v1',
    sources: { before: source(before), after: source(after) }, compatibility: compatible,
    summary: { artifactBytes: { before: primary(before).bytes, after: primary(after).bytes,
      delta: comparable ? primary(after).bytes - primary(before).bytes : null, reason: comparable ? null : 'incompatible-artifacts' }, inventories },
    metadataChanges: fields(metadata(before), metadata(after), comparable), sections };
  result.comparisonHash = { algorithm: 'sha256', value: sha256(json(result)) };
  return validateComparison(result);
}
function validateComparison(input) {
  const result = copyData(input);
  if (result?.kind !== 'pulse.report-comparison' || result.comparisonVersion !== 1 || !['pulse.report-matching.v1', 'pulse.report-matching.v2'].includes(result.matchingVersion)) fail('REPORT_COMPARISON_VERSION');
  validate(result, comparisonSchema);
  const { comparisonHash, ...payload } = result;
  ensure(comparisonHash.value === sha256(json(payload)), 'REPORT_COMPARISON_HASH');
  const expectedCollections = result.matchingVersion === 'pulse.report-matching.v2' ? [...COLLECTIONS, ...SEMANTIC_COLLECTIONS] : COLLECTIONS;
  ensure(same(result.summary.inventories.map(row => row.collection), expectedCollections));
  const capsules = ['before', 'after'].map(side => {
    const row = result.sources[side];
    ensure(row.artifact.id === 'artifact:' + row.artifact.sha256 && row.context.primaryArtifactId === row.artifact.id);
    return { ...row, artifacts: [row.artifact], evidenceHash: { value: row.capsuleHash } };
  });
  ensure(same(result.compatibility, compatibility(...capsules)));
  ensure(same(result.sections.map(row => row.collection), expectedCollections.filter(name => result.sections.some(row => row.collection === name))));
  const collections = new Set();
  for (const section of result.sections) {
    ensure(!collections.has(section.collection) && section.changes.length); collections.add(section.collection);
    ensure(same(section.changes.map(row => row.key), sorted(section.changes.map(row => row.key))));
    const used = [new Set(), new Set()];
    for (const change of section.changes) {
      ensure(change.beforeIds.length || change.afterIds.length);
      ensure((SEMANTIC_COLLECTIONS.includes(section.collection) ? ['retained-identity','authored-source-slot','semantic-links','unresolved'] : ['logical-key','canonical-id','same-artifact','unresolved']).includes(change.basis));
      for (const [index, ids] of [change.beforeIds, change.afterIds].entries()) for (const id of ids) { ensure(!used[index].has(id)); used[index].add(id); }
      ensure(same(change.fields.map(row => row.path), sorted(change.fields.map(row => row.path))));
      ensure(new Set(change.beforeIds).size === change.beforeIds.length && new Set(change.afterIds).size === change.afterIds.length);
      if (change.status === 'unresolved') ensure(change.reason !== null && change.basis === 'unresolved' && !change.fields.length);
      else {
        ensure(change.reason === null && change.basis !== 'unresolved' && change.fields.length);
        if (['modified', 'coverage-changed'].includes(change.status)) ensure((change.status === 'coverage-changed') === change.fields.every(row => row.kind === 'coverage'));
        ensure(change.status === 'added' ? !change.beforeIds.length && change.afterIds.length === 1
          : change.status === 'removed' ? !change.afterIds.length && change.beforeIds.length === 1 : change.beforeIds.length === 1 && change.afterIds.length === 1);
      }
    }
  }
  for (const field of [...result.metadataChanges, ...result.sections.flatMap(section => section.changes.flatMap(row => row.fields))]) {
    ensure((field.before.recorded || field.before.value === null) && (field.after.recorded || field.after.value === null));
    ensure(!same(field.before, field.after));
    if (isMetric(field.before.value) || isMetric(field.after.value)) ensure(same(pick(field, ['delta', 'deltaReason']),
      metricDelta(field.before.value, field.after.value, result.compatibility.status !== 'incompatible')));
    else ensure(field.delta === null && field.deltaReason === null);
  }
  for (const inventory of result.summary.inventories) {
    const changes = result.sections.find(section => section.collection === inventory.collection)?.changes || [];
    const isSemantic = SEMANTIC_COLLECTIONS.includes(inventory.collection);
    ensure(isSemantic ? same(inventory.identityCoverage, {before:semantic.identityCoverage(inventory.before,changes,'before'),after:semantic.identityCoverage(inventory.after,changes,'after')}) : inventory.identityCoverage === undefined);
    const count = emptyCounts(); count.unchanged = inventory.counts.unchanged;
    for (const change of result.sections.find(section => section.collection === inventory.collection)?.changes || []) {
      if (change.status === 'unresolved') { count.unresolvedBefore += change.beforeIds.length; count.unresolvedAfter += change.afterIds.length; }
      else count[change.status === 'coverage-changed' ? 'coverageChanged' : change.status]++;
    }
    ensure(same(count, inventory.counts));
    ensure(inventory.before.observed === count.removed + count.modified + count.coverageChanged + count.unresolvedBefore + count.unchanged);
    ensure(inventory.after.observed === count.added + count.modified + count.coverageChanged + count.unresolvedAfter + count.unchanged);
    ensure(inventory.delta === (complete(inventory.before) && complete(inventory.after) ? inventory.after.observed - inventory.before.observed : null));
  }
  const bytes = result.summary.artifactBytes, comparable = result.compatibility.status !== 'incompatible';
  ensure(bytes.before === result.sources.before.artifact.bytes && bytes.after === result.sources.after.artifact.bytes);
  ensure(bytes.delta === (comparable ? bytes.after - bytes.before : null) && bytes.reason === (comparable ? null : 'incompatible-artifacts'));
  return freeze(result);
}
const parseComparison = input => validateComparison(require('./encoding').decode(parseJson(input)));
const serializeComparison = input => json(validateComparison(input)) + '\n';
module.exports = { compareCapsules, validateComparison, parseComparison, serializeComparison };
