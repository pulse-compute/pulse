'use strict';

const { canonicalJson, sha256, fail, relativePath } = require('./data');
const { stableReportId } = require('./capsule');
const complete = count => ({ status: 'complete', observed: count, expected: count, reason: null });
const unavailable = () => ({ status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' });
const helperId = canonicalId => 'helper:' + sha256(canonicalJson(['helper', canonicalId]));

const siteId = row => 'use:' + sha256(canonicalJson(['use', row.ownerId, row.source.value.file,
  row.source.value.start.offset, row.source.value.end.offset, row.surfaceId]));
const callId = row => 'call:' + sha256(canonicalJson(['call', row.callerId, row.calleeId, row.source.value.file,
  row.source.value.start.offset, row.source.value.end.offset]));

function projectHandlerTopology(topology, references = []) {
  if (topology?.version !== 'pulse.compiler-report-topology.v1') topology = undefined;
  const handlers = (topology?.handlers || []).map(row => ({ ...row, canonicalId: row.id,
    id: row.kind === 'helper' ? helperId(row.id) : stableReportId('handler', row.id) }));
  const handlerIds = new Map(handlers.map(row => [row.canonicalId, row.id]));
  const entryId = value => value === null ? null : stableReportId('entry', value);
  const registrations = (topology?.registrations || []).map(row => ({ ...row, canonicalId: row.id,
    id: entryId(row.id), handlerId: row.handlerId === null ? null : handlerIds.get(row.handlerId),
    mountPath: row.mountPath.map(entryId), flow: Object.fromEntries(Object.entries(row.flow).map(([key, value]) => [key, entryId(value)])) }));
  const useSites = (topology?.useSites || []).filter(row => row.source.state === 'available').map(row => {
    const b = row.binding;
    const reference = b.state === 'resolved' ? references.find(ref => ref.kind === 'binding'
      && ref.bindingKind === b.kind && ref.canonicalId === b.canonicalId && ref.state === 'resolved') : undefined;
    const binding = b.state === 'not-applicable'
      ? { state: 'not-applicable', kind: null, referenceId: null, bindingId: null, reason: 'no-named-binding' }
      : reference ? { state: 'resolved', kind: b.kind, referenceId: reference.id, bindingId: reference.targetId, reason: null }
      : { state: b.state === 'dynamic' ? 'dynamic' : 'unknown', kind: b.kind, referenceId: null, bindingId: null,
        reason: b.state === 'dynamic' ? 'dynamic-reference' : 'unresolved-reference' };
    const site = { ...row, ownerId: handlerIds.get(row.ownerId), binding };
    return { ...site, id: siteId(site) };
  });
  const helperCalls = (topology?.helperCalls || []).map(row => {
    const call = { ...row, callerId: handlerIds.get(row.callerId), calleeId: handlerIds.get(row.calleeId),
      registrationIds: [...new Set(row.registrationIds.map(entryId))].sort() };
    return { ...call, id: callId(call) };
  });
  const coverage = (rows, count) => rows === undefined ? unavailable() : rows.length === count ? complete(count)
    : { status: 'partial', observed: count, expected: rows.length, reason: 'not-recorded' };
  return { version: 'pulse.report-analytics.v1', handlers, registrations, useSites, helperCalls, associations: [],
    coverage: { handlers: topology ? complete(handlers.length) : unavailable(),
      registrations: topology ? complete(registrations.length) : unavailable(),
      useSites: coverage(topology?.useSites, useSites.length), helperCalls: topology?.helperCallsComplete === false
        ? { status: 'partial', observed: helperCalls.length, expected: null, reason: 'not-recorded' }
        : coverage(topology?.helperCalls, helperCalls.length),
      associations: unavailable() } };
}

function validateHandlerTopology(capsule) {
  const analytics = capsule.analytics;
  if (!analytics) return;
  const ensure = (condition, code = 'REPORT_ANALYTICS') => { if (!condition) fail(code); };
  const handlers = new Map(), registrations = new Map();
  function unique(rows, map) {
    for (const row of rows) { ensure(!map.has(row.id), 'REPORT_DUPLICATE'); map.set(row.id, row); }
  }
  unique(analytics.handlers, handlers); unique(analytics.registrations, registrations);
  function fact(value) {
    ensure(value.state === 'available' ? value.value !== null && value.reason === null
      : value.value === null && value.reason !== null, 'REPORT_FACT');
    if (value.state === 'not-applicable') ensure(value.reason === 'not-applicable', 'REPORT_FACT');
  }
  const sourceHashes = new Map();
  function source(value) {
    fact(value);
    if (value.state !== 'available') return;
    const s = value.value;
    relativePath(s.file);
    ensure(!sourceHashes.has(s.file) || sourceHashes.get(s.file) === s.sha256, 'REPORT_ANALYTICS_SOURCE');
    sourceHashes.set(s.file, s.sha256);
    ensure(s.end.offset > s.start.offset && (s.end.line > s.start.line
      || s.end.line === s.start.line && s.end.column > s.start.column), 'REPORT_ANALYTICS_SOURCE');
    if (s.start.line === s.end.line) ensure(s.end.offset - s.start.offset === s.end.column - s.start.column, 'REPORT_ANALYTICS_SOURCE');
  }
  for (const row of handlers.values()) {
    ensure(row.id === (row.kind === 'helper' ? helperId(row.canonicalId) : stableReportId('handler', row.canonicalId)), 'REPORT_IDENTITY');
    source(row.source); fact(row.package);
    if (row.package.state === 'available') {
      relativePath(row.package.value.sourceIdentity);
      if (row.source.state === 'available') ensure(row.package.value.sourceIdentity === row.source.value.file, 'REPORT_ANALYTICS_SOURCE');
    }
    ensure(row.evidence.length === 1 && row.evidence[0].basis === 'handler-table'
      && row.evidence[0].producer === (row.kind === 'helper' ? 'canonical-router-linked-helper' : 'canonical-router-handler-table'));
  }
  const entries = new Map(capsule.entries.map(row => [row.id, row]));
  for (const row of registrations.values()) for (const id of Object.values(row.flow)) {
    ensure(id === null || registrations.has(id), 'REPORT_REFERENCE');
  }
  let previous = -1;
  const mounts = [];
  for (const row of registrations.values()) {
    ensure(row.order > previous, 'REPORT_ORDER'); previous = row.order;
    ensure(row.id === stableReportId('entry', row.canonicalId), 'REPORT_IDENTITY');
    const entry = entries.get(row.id);
    ensure(entry && entry.canonicalId === row.canonicalId && entry.order === row.order
      && entry.handlerId === row.handlerId && entry.kind === (row.kind === 'mount' ? 'other' : row.kind), 'REPORT_REFERENCE');
    ensure(row.handlerId === null || handlers.get(row.handlerId)?.kind === 'handler', 'REPORT_REFERENCE');
    if (row.kind === 'mount' || !row.authored) ensure(row.handlerId === null);
    if (row.authored && row.kind !== 'mount') ensure(row.handlerId !== null);
    source(row.source); fact(row.match);
    ensure(row.routerPath.length > 0 && row.routerPath.at(-1) === row.routerId);
    ensure(row.evidence.length === 1 && row.evidence[0].basis === 'router-topology'
      && row.evidence[0].producer === 'canonical-router-execution-topology');
    for (const id of Object.values(row.flow)) ensure(id === null || registrations.has(id), 'REPORT_REFERENCE');
    ensure(entry.flow && entry.flow.nextEntryId === row.flow.next && entry.flow.childEntryId === row.flow.child
      && entry.flow.parentContinueEntryId === row.flow.parentContinue && canonicalJson(entry.flow.routerPath) === canonicalJson(row.routerPath));
    if (row.match.state === 'available') {
      ensure(row.match.value.path === entry.flow.path && row.match.value.method === entry.flow.method);
      ensure(row.kind === 'event' ? row.match.value.eventType === entry.name : row.match.value.eventType === null);
    }
    if (row.kind === 'event') ensure(Object.values(row.flow).every(v => v === null) && row.mountPath.length === 0);
    else for (const id of Object.values(row.flow)) ensure(id === null || registrations.get(id).kind !== 'event');
    ensure(new Set(row.mountPath).size === row.mountPath.length, 'REPORT_DUPLICATE');
    // Validate instance ancestry, not just the existence of a mount ID.
    while (mounts.length && mounts.at(-1).end <= row.order) mounts.pop();
    const expected = row.kind === 'event' ? [] : mounts.map(m => m.id);
    ensure(canonicalJson(row.mountPath) === canonicalJson(expected));
    if (row.kind === 'mount') {
      ensure(row.flow.next === row.flow.parentContinue);
      if (row.flow.child !== null) ensure(registrations.get(row.flow.child).order > row.order);
      if (row.flow.parentContinue !== null) ensure(registrations.get(row.flow.parentContinue).order > row.order);
      if (row.flow.child !== null) {
        const start = registrations.get(row.flow.child).order;
        const end = row.flow.parentContinue === null ? Infinity : registrations.get(row.flow.parentContinue).order;
        ensure(start === row.order + 1 && end >= start);
        if (mounts.length) ensure(end <= mounts.at(-1).end);
        mounts.push({ id: row.id, end });
      }
    } else ensure(row.flow.child === null && row.flow.parentContinue === null);
    if (row.flow.next !== null) ensure(registrations.get(row.flow.next).order > row.order);
  }
  const sites = new Map(), calls = new Map();
  unique(analytics.useSites, sites); unique(analytics.helperCalls, calls);
  const references = new Map((capsule.references || []).map(row => [row.id, row]));
  const bindings = new Map(capsule.bindings.map(row => [row.id, row]));
  function ownedSource(row, ownerId) {
    const owner = handlers.get(ownerId);
    ensure(owner, 'REPORT_REFERENCE');
    source(row.source);
    ensure(row.source.state === 'available', 'REPORT_ANALYTICS_SOURCE');
    if (owner.source.state === 'available') {
      const s = row.source.value, o = owner.source.value;
      ensure(s.file === o.file && s.sha256 === o.sha256 && s.start.offset >= o.start.offset
        && s.end.offset <= o.end.offset, 'REPORT_ANALYTICS_SOURCE');
    }
  }
  for (const row of sites.values()) {
    ownedSource(row, row.ownerId);
    ensure(row.id === siteId(row), 'REPORT_IDENTITY');
    fact(row.capability);
    ensure(row.evidence.length === 1 && row.evidence[0].basis === 'authored-recognition'
      && row.evidence[0].producer === 'canonical-handler-surface-authority');
    const b = row.binding;
    if (b.state === 'not-applicable') ensure(b.kind === null && b.bindingId === null && b.referenceId === null && b.reason === 'no-named-binding');
    else {
      ensure(b.kind !== null);
      if (b.state === 'resolved') {
        const ref = references.get(b.referenceId), target = bindings.get(b.bindingId);
        ensure(ref && target && ref.kind === 'binding' && ref.state === 'resolved' && ref.targetId === b.bindingId
          && ref.bindingKind === b.kind && target.kind === b.kind && ref.canonicalId === target.name && b.reason === null, 'REPORT_REFERENCE');
      } else {
        ensure(b.bindingId === null && b.reason === (b.state === 'dynamic' ? 'dynamic-reference' : 'unresolved-reference'));
        if (b.referenceId !== null) {
          const ref = references.get(b.referenceId);
          ensure(ref && ref.kind === 'binding' && ref.bindingKind === b.kind && ref.state === b.state && ref.targetId === null, 'REPORT_REFERENCE');
        }
      }
    }
  }
  for (const row of calls.values()) {
    ownedSource(row, row.callerId);
    ensure(handlers.get(row.callerId)?.kind === 'handler' && handlers.get(row.calleeId)?.kind === 'helper', 'REPORT_REFERENCE');
    ensure(row.id === callId(row) && row.canonicalId === null, 'REPORT_IDENTITY');
    ensure(row.registrationIds.length > 0 && new Set(row.registrationIds).size === row.registrationIds.length, 'REPORT_DUPLICATE');
    for (const id of row.registrationIds) ensure(registrations.get(id)?.handlerId === row.callerId
      && ['route', 'middleware'].includes(registrations.get(id).kind), 'REPORT_REFERENCE');
    if (analytics.coverage.helperCalls.status === 'complete') ensure(canonicalJson([...registrations.values()]
      .filter(r => r.handlerId === row.callerId).map(r => r.id).sort()) === canonicalJson([...row.registrationIds].sort()), 'REPORT_COVERAGE');
    ensure(row.evidence.length === 1 && row.evidence[0].basis === 'validated-helper-call'
      && row.evidence[0].producer === 'canonical-router-handler-validation');
  }
  for (const [key, coverage] of Object.entries(analytics.coverage)) {
    ensure(coverage.observed === analytics[key].length, 'REPORT_COVERAGE');
    ensure(coverage.expected === null || coverage.expected >= coverage.observed, 'REPORT_COVERAGE');
    if (coverage.status === 'complete') ensure(coverage.expected === coverage.observed && coverage.reason === null, 'REPORT_COVERAGE');
    else ensure(coverage.reason !== null, 'REPORT_COVERAGE');
    if (['unavailable', 'not-applicable'].includes(coverage.status)) ensure(coverage.observed === 0 && coverage.expected === null, 'REPORT_COVERAGE');
    if (key === 'associations') ensure(coverage.status === 'unavailable' && coverage.reason === 'not-recorded', 'REPORT_COVERAGE');
  }
  if (analytics.coverage.registrations.status === 'complete') ensure(registrations.size === entries.size, 'REPORT_COVERAGE');
}
module.exports = { projectHandlerTopology, validateHandlerTopology };
