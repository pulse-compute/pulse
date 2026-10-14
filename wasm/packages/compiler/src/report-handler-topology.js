'use strict';

const { createHash } = require('node:crypto');
const { topologyForCanonicalRouterOutput, surfaceFactsForCanonicalRouterOutput, handlerIrsForCanonicalRouterOutput } = require('./spine/canonical-router');
const { sourceModelForRouterRecognition, capabilityForHandlerSurface, staticString } = require('./spine/handler-surface-authority');
const { projectRouterControl } = require('./report-router-control');
const { bindingOwnership } = require('./spine/binding-ownership');
const unavailable = () => ({ state: 'unavailable', value: null, reason: 'not-recorded' });
const available = value => ({ state: 'available', value, reason: null });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

// Post-emission observation only. Read retained compiler objects, never reparse
// emitted source or read files. Nothing here enters executable metadata/hashes.
function collectHandlerTopology(compiled) {
  const topology = topologyForCanonicalRouterOutput(compiled.router);
  if (!topology) return undefined;
  // A newer/other topology must not turn successful compilation into a report
  // failure, nor acquire a fabricated role. Its analytics remain unavailable.
  if (topology.entries.some(({ entry }) => !['route', 'use', 'mount', 'error', 'event', 'fallback'].includes(entry.kind))) return undefined;
  const linked = topology.options.linkedProjectModules;
  const files = new Map();
  const sourceFile = file => linked?.sourceFileForPath(file)
    || (topology.sourceFile.fileName === file ? topology.sourceFile : undefined);
  function span(file, start, end) {
    const source = sourceFile(file);
    if (!source || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < 0 || end <= start || end > source.text.length) return unavailable();
    if (!files.has(file)) files.set(file, createHash('sha256').update(source.text).digest('hex'));
    const point = offset => { const p = source.getLineAndCharacterOfPosition(offset);
      return { offset, line: p.line + 1, column: p.character + 1 }; };
    return available({ file, sha256: files.get(file), start: point(start), end: point(end) });
  }
  const location = loc => span(loc?.file, loc?.start?.offset, loc?.end?.offset);
  const modules = new Map((compiled.reachableGraph?.modules || []).filter(m => m.path).map(m => [m.path, m]));
  function packageFor(file) {
    const module = modules.get(file);
    if (!module) return unavailable();
    return module.packageName && module.packageVersion
      ? available({ name: module.packageName, version: module.packageVersion, sourceIdentity: module.path })
      : { state: 'not-applicable', value: null, reason: 'not-applicable' };
  }
  const handlers = topology.handlerTable.handlers.map(handler => ({
    id: handler.id, kind: 'handler', name: handler.localName || null,
    source: location(handler.loc), package: packageFor(handler.file),
    evidence: [{ basis: 'handler-table', producer: 'canonical-router-handler-table' }]
  }));
  for (const helper of linked?.sourceHelpers || []) {
    const file = helper.source.file, node = helper.functionNode, source = sourceFile(file);
    handlers.push({ id: helper.id, kind: 'helper', name: helper.source.name || null,
      source: source && node ? span(file, node.getStart(source), node.end) : unavailable(), package: packageFor(file),
      evidence: [{ basis: 'handler-table', producer: 'canonical-router-linked-helper' }] });
  }
  const http = new Map(topology.entries.filter(d => d.entry.kind !== 'event').map(d => [d.entry.index, d.entry.stableId]));
  const controls = new Map((handlerIrsForCanonicalRouterOutput(compiled.router) || []).map(row => [row.entryStableId, row.operationIr]));
  const mounts = [];
  const registrations = topology.entries.map(({ entry, rawEntry }) => {
    // The compiler's child/parent-return interval identifies this particular
    // mount expansion, even when router definition paths are identical.
    while (mounts.length && entry.index >= mounts.at(-1).end) mounts.pop();
    const registration = {
      id: entry.stableId, handlerId: entry.handlerId || null,
      kind: entry.kind === 'use' ? 'middleware' : entry.kind,
      authored: Boolean(rawEntry.loc) && entry.kind !== 'fallback',
      source: location(rawEntry.loc), routerId: entry.router, routerPath: [...entry.routerPath],
      mountPath: entry.kind === 'event' ? [] : mounts.map(m => m.id), order: entry.index,
      match: available({ method: entry.method || null, path: entry.path ?? null, eventType: entry.eventType || null }),
      control: projectRouterControl(entry, rawEntry, controls.get(entry.stableId)),
      flow: { next: http.get(entry.nextIndex) || null, child: http.get(entry.childStartIndex) || null,
        parentContinue: http.get(entry.parentContinueIndex) || null },
      evidence: [{ basis: 'router-topology', producer: 'canonical-router-execution-topology' }]
    };
    if (entry.kind === 'mount' && entry.childStartIndex > entry.index && entry.parentContinueIndex >= entry.childStartIndex) {
      mounts.push({ id: entry.stableId, end: entry.parentContinueIndex });
    }
    return registration;
  });
  const model = sourceModelForRouterRecognition(surfaceFactsForCanonicalRouterOutput(compiled.router)?.recognition);
  const nodeSource = row => span(row.sourceFile.fileName, row.node.getStart(row.sourceFile), row.node.end);
  const useSites = model?.authoredSites.map(row => {
    const recognized = row.recognized, capability = capabilityForHandlerSurface(recognized);
    const provider = recognized.detail?.provider, effect = recognized.detail?.packageEffect;
    const name = provider ? staticString(provider.resource, { unwrap: true }) : effect?.resource?.kind === 'literal' ? effect.resource.value : undefined;
    const binding = bindingOwnership(provider?.providerKind || effect?.providerKind, name,
      Boolean(provider?.resource) && name === undefined || effect?.resource?.kind === 'dynamic');
    return { ownerId: row.ownerId, surfaceId: recognized.surfaceId, operation: recognized.canonicalOperation,
      capability: capability ? available(capability) : unavailable(),
      binding: binding || { state: 'not-applicable', kind: null, canonicalId: null },
      source: nodeSource(row), evidence: [{ basis: 'authored-recognition', producer: 'canonical-handler-surface-authority' }] };
  });
  const calls = new Map();
  let helperCallsComplete = true;
  for (const row of model?.validatedCalls || []) {
    const source = nodeSource(row);
    // No lowered offsets, call order or guessed identities stand in for source.
    if (source.state !== 'available') { helperCallsComplete = false; continue; }
    const key = JSON.stringify([row.callerId, row.calleeId, source.value.file, source.value.start.offset, source.value.end.offset]);
    if (!calls.has(key)) calls.set(key, { canonicalId: null, callerId: row.callerId, calleeId: row.calleeId,
      registrationIds: [], source, evidence: [{ basis: 'validated-helper-call', producer: 'canonical-router-handler-validation' }] });
    calls.get(key).registrationIds.push(row.registrationId);
  }
  return freeze({ version: 'pulse.compiler-report-topology.v1', handlers, registrations,
    ...(model ? { useSites, helperCalls: [...calls.values()], helperCallsComplete } : {}) });
}
module.exports = { collectHandlerTopology };
