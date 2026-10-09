'use strict';

// Observational metadata only. Never insert these records into the hashed plan
// or use them to partition, render, retain, or optimize executable code.
function nativeReportOwnership({ plan, blocks, layout, handlers, stages, helpers, helperConsumers }) {
  const bodies = layout.bodySymbols.map(({ chunk, symbol }) => {
    const implementationId = layout.chunks[chunk]?.[0].handlerId || null;
    const kind = handlers.has(implementationId) ? 'terminal-body'
      : stages.has(implementationId) ? 'shared-stage-body'
      : helpers.has(implementationId) ? 'shared-helper-body' : 'dispatcher-carrier';
    return Object.freeze({ chunk, symbol, implementationId, kind });
  });
  const chunksByImplementation = new Map(), carriersByEntry = new Map();
  for (const body of bodies) {
    if (body.implementationId) {
      if (!chunksByImplementation.has(body.implementationId)) chunksByImplementation.set(body.implementationId, []);
      chunksByImplementation.get(body.implementationId).push(body);
    }
    if (body.kind !== 'dispatcher-carrier') continue;
    const selected = layout.partitioned ? layout.chunks[body.chunk].map(row => blocks[row.id]) : blocks;
    for (const entryId of new Set(selected.map(row => row.entryId).filter(Boolean))) {
      if (!carriersByEntry.has(entryId)) carriersByEntry.set(entryId, []);
      carriersByEntry.get(entryId).push(body);
    }
  }
  const stageByEntry = new Map();
  for (const stage of stages.values()) for (const row of stage.registrations) stageByEntry.set(row.entryId, stage.id);
  const helperBodiesByEntry = new Map();
  for (const [helperId, consumers] of helperConsumers) for (const entryId of consumers) {
    if (!helperBodiesByEntry.has(entryId)) helperBodiesByEntry.set(entryId, []);
    helperBodiesByEntry.get(entryId).push(...(chunksByImplementation.get(helperId) || []));
  }
  const entries = (plan.routing?.entries || []).map(entry => {
    const implementationId = handlers.has(entry.stableId) ? entry.stableId : stageByEntry.get(entry.stableId);
    const primary = implementationId ? chunksByImplementation.get(implementationId) || [] : carriersByEntry.get(entry.stableId) || [];
    const selected = [...primary, ...(helperBodiesByEntry.get(entry.stableId) || [])];
    return Object.freeze({ entryId: entry.stableId, handlerId: entry.handlerId || null,
      bodies: Object.freeze(selected.map(body => Object.freeze({ chunk: body.chunk, relation: body.kind }))),
      reason: primary.length ? null : 'entry-ownership-not-retained' });
  });
  return Object.freeze({ version: 'pulse.native-report-ownership.v1', entries: Object.freeze(entries), bodies: Object.freeze(bodies) });
}

module.exports = { nativeReportOwnership };
