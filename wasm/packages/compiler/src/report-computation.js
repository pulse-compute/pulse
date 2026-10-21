'use strict';

// Observational joins over admitted source and validated plans. Never serialize
// an AST, generated expression, resource payload or package-private descriptor.
function collectComputationReport(compiled, plan) {
  const unique = rows => [...new Set(rows)].sort();
  const source = compiled.callableSource;
  const raw = compiled.metadata.applicationEntries || plan.routing?.entries || [];
  const defaultEntries = raw.length ? [] : ['default'];
  const owners = new Map(), resourceEntries = new Map();
  const key = s => s && JSON.stringify([s.file, s.line, s.column]);
  function walk(value, consumers) {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'callable-call') {
      const k = key(value.source);
      owners.set(k, unique([...(owners.get(k) || []), ...consumers]));
    }
    if (value.kind === 'resource-read') resourceEntries.set(value.resourceId,
      unique([...(resourceEntries.get(value.resourceId) || []), ...consumers]));
    for (const [k, child] of Object.entries(value)) if (!['callables', 'binaryResources'].includes(k)) {
      if (Array.isArray(child)) child.forEach(row => walk(row, consumers));
      else if (child && typeof child === 'object') walk(child, consumers);
    }
  }
  walk(plan.entry?.body, defaultEntries);
  for (const handler of plan.handlers || []) walk(handler.body, [handler.id]);
  for (const stage of plan.stages || []) walk(stage.body, stage.registrations.map(row => row.entryId));
  // Helpers and managed package callers without a retained canonical entry join
  // remain unassociated. Never infer a caller from a filename or source offset.
  const sites = (source?.sites || []).map((site, index) => ({ index,
    callee: source.callees.findIndex(row => row.identity === site.target),
    source: site.reportSource || null, entryIds: owners.get(key(site.source)) || [],
    managed: site.managed === true }));
  const callees = (source?.callees || []).map((callee, index) => ({ index, name: callee.name,
    source: callee.reportSource || null, helpers: callee.reportHelpers || [],
    inputSchema: callee.inputSchema, outputSchema: callee.outputSchema,
    entryIds: unique(sites.filter(site => site.callee === index).flatMap(site => site.entryIds)),
    entriesComplete: sites.filter(site => site.callee === index).every(site => site.entryIds.length > 0),
    resourceIds: (callee.plan.binaryResources?.records || []).map(row => row.id) }));
  for (const callee of callees) for (const id of callee.resourceIds) resourceEntries.set(id,
    unique([...(resourceEntries.get(id) || []), ...callee.entryIds]));
  const catalogue = compiled.binaryResources;
  const summary = catalogue ? require('@pulse-compute/wasm-contracts/resources/embedded').resourceCatalogueSummary(catalogue) : null;
  const selected = new Set([...(plan.binaryResources?.records || []).map(row => row.id),
    ...callees.flatMap(row => row.resourceIds)]);
  return { version: 'pulse.compiler-report-computation.v1', callees, sites,
    resources: summary ? {
      ...summary,
      records: summary.records.map(row => ({
        ...row, selected: selected.has(row.id), entryIds: resourceEntries.get(row.id) || [],
        calleeIndices: callees.filter(callee => callee.resourceIds.includes(row.id)).map(callee => callee.index)
      }))
    } : null };
}
module.exports = { collectComputationReport };
