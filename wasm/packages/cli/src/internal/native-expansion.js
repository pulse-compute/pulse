'use strict';

// Projection only: no AST pass, provider generation, Wasm analysis or second plan.
const VERSION = 'pulse.native-expansion-inspection.v1';
const MAX_OWNERS = 20;
const WARNING_BYTES = 1024;

function inspectNativeExpansion(compiled, plan) {
  const router = compiled && compiled.router;
  const families = new Map();
  const handlers = new Map((router?.handlerTable?.handlers || []).map(owner => [owner.id, owner]));
  for (const entry of compiled?.metadata?.router?.entries || []) {
    if (!entry.handlerId || !['route', 'use', 'error'].includes(entry.kind)) continue;
    if (!families.has(entry.handlerId)) families.set(entry.handlerId, []);
    families.get(entry.handlerId).push(entry);
  }
  const stageByEntry = new Map();
  for (const stage of plan?.stages || []) for (const registration of stage.registrations) stageByEntry.set(registration.entryId, stage.id);
  const privateBodies = new Set((plan?.handlers || []).map(body => body.id));
  const effectsByEntry = new Map();
  for (const effect of plan?.effects || []) {
    if (!effectsByEntry.has(effect.routerEntryStableId)) effectsByEntry.set(effect.routerEntryStableId, []);
    effectsByEntry.get(effect.routerEntryStableId).push(effect);
  }
  const owners = [];
  for (const [handlerId, entries] of families) {
    if (entries.length < 2) continue;
    const owner = handlers.get(handlerId);
    const sizes = entries.map(entry => {
      const range = entry.generatedRange;
      return typeof router?.sourceText === 'string' && Number.isInteger(range?.start) && Number.isInteger(range?.end)
        && range.start >= 0 && range.end > range.start && range.end <= router.sourceText.length
        ? Buffer.byteLength(router.sourceText.slice(range.start, range.end), 'utf8') : null;
    });
    const loweredSourceBytes = sizes.every(size => size !== null) ? sizes.reduce((sum, size) => sum + size, 0) : null;
    const additionalRegistrationSourceBytes = loweredSourceBytes === null ? null : loweredSourceBytes - sizes.reduce((max, size) => Math.max(max, size), 0);
    const retainedEntries = entries.filter(entry => stageByEntry.has(entry.stableId));
    const retainedBodies = new Set(retainedEntries.map(entry => stageByEntry.get(entry.stableId))).size;
    const unsharedRegistrations = plan ? entries.length - retainedEntries.length : null;
    const nativeBodyInstances = plan ? retainedBodies + unsharedRegistrations : null;
    const sharing = !plan ? 'unavailable' : nativeBodyInstances === 1 ? 'retained' : retainedEntries.length ? 'partial' : 'not-retained';
    const effects = entries.flatMap(entry => effectsByEntry.get(entry.stableId) || []);
    const observations = [];
    if (sharing === 'unavailable') observations.push('Native planning unavailable; body sharing is unknown.');
    else if (sharing === 'retained') observations.push('One stage body is retained; registration/effect bindings still grow.');
    else {
      if (entries.some(entry => entry.kind !== 'route')) observations.push('Middleware/error registrations are outside current retained HTTP-stage lowering.');
      if (entries.some(entry => privateBodies.has(entry.stableId))) observations.push('Terminal private route bodies remain owned per registration.');
      if (effects.some(effect => effect.kind !== 'fetch' || effect.grouped || effect.decoder !== 'text' || effect.result?.mode !== 'bind')) observations.push('Effects include shapes outside bound, ungrouped text-fetch stages.');
      if (!observations.length) observations.push('No single retained body was recorded; inspect this owner against the admitted stage shapes.');
    }
    owners.push({
      handlerId, name: owner?.localName || owner?.exportName || handlerId,
      source: { file: owner?.file || owner?.loc?.file || compiled.metadata.file, line: owner?.loc?.start?.line, column: owner?.loc?.start?.column },
      registrationCount: entries.length, registrationKinds: [...new Set(entries.map(entry => entry.kind))].sort(),
      loweredSourceBytes, additionalRegistrationSourceBytes,
      nativeBodyInstances, sharedStageRegistrations: plan ? retainedEntries.length : null, unsharedRegistrations, sharing,
      expensiveUnshared: Boolean(plan && nativeBodyInstances > 1 && additionalRegistrationSourceBytes >= WARNING_BYTES),
      effectKinds: [...new Set(effects.map(effect => effect.kind))].sort(), observations,
      registrationExamples: entries.slice(0, 3).map(entry => ({ id: entry.stableId, kind: entry.kind, method: entry.method, path: entry.path })),
      omittedRegistrationExamples: Math.max(0, entries.length - 3)
    });
  }
  owners.sort((a, b) => Number(b.expensiveUnshared) - Number(a.expensiveUnshared)
    || (b.additionalRegistrationSourceBytes || 0) - (a.additionalRegistrationSourceBytes || 0)
    || a.handlerId.localeCompare(b.handlerId));
  return {
    version: VERSION, scope: 'http-native-plan', planStatus: plan ? 'available' : 'unavailable', planHash: plan?.planHash,
    costMetric: 'UTF-8 bytes of lowered Router body ranges before Native factoring; not AssemblyScript or final Wasm bytes',
    warningAdditionalSourceBytes: WARNING_BYTES, maxOwners: MAX_OWNERS,
    summary: { repeatedOwners: owners.length, registrations: owners.reduce((sum, owner) => sum + owner.registrationCount, 0),
      expensiveUnsharedOwners: owners.filter(owner => owner.expensiveUnshared).length,
      retainedOwners: owners.filter(owner => owner.sharing === 'retained').length, omittedOwners: Math.max(0, owners.length - MAX_OWNERS) },
    owners: owners.slice(0, MAX_OWNERS)
  };
}

module.exports = { inspectNativeExpansion, VERSION, MAX_OWNERS, WARNING_BYTES };
