'use strict';

const {
  PROVIDER_REQUIREMENT_RECORD_VERSION,
  normalizeProviderRequirementRecord
} = require('@pulse-compute/wasm-contracts/package/package-contract');

const PROVIDER_REQUIREMENT_AUTHORITY_VERSION = 'pulse.provider-requirement-authority.v1';

class ProviderRequirementAuthorityError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ProviderRequirementAuthorityError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sortedUnique(values) {
  return Object.freeze([...new Set((values || []).filter((value) => typeof value === 'string' && value.length > 0))].sort());
}

function providerOperation(effect) {
  const operation = {
    order: effect.order,
    id: effect.id,
    kind: effect.kind,
    providerKind: effect.providerKind,
    operation: effect.operation,
    capability: effect.capability,
    package: effect.package,
    contractId: effect.contractId,
    result: cloneJson(effect.result),
    continuationId: effect.continuationId,
    resource: cloneJson(effect.resource),
    source: cloneJson(effect.source),
    routeStableId: effect.routeStableId,
    routeRuntimeId: effect.routeRuntimeId,
    routeMethod: effect.routeMethod,
    routePath: effect.routePath,
    routerEntryStableId: effect.routerEntryStableId,
    routerEntryKind: effect.routerEntryKind,
    routerEntryIndex: effect.routerEntryIndex,
    routerEntryPath: effect.routerEntryPath
  };
  return deepFreeze(Object.fromEntries(Object.entries(operation).filter(([, value]) => value !== undefined)));
}

function packageIdentity(effect) {
  return deepFreeze({
    contractId: String(effect.contractId || ''),
    package: String(effect.package || ''),
    import: String(effect.import || '')
  });
}

function packageEffectIdentity(effect) {
  return [effect && effect.contractId, effect && effect.package, effect && effect.import, effect && effect.kind, effect && effect.operation, effect && effect.capability, effect && effect.placement, effect && effect.range && effect.range.start, effect && effect.range && effect.range.end].join('|');
}

function assertPackageLoweringMatchesPlan(plan, packageLowering) {
  const declared = (plan && plan.packages && Array.isArray(plan.packages.effects)) ? plan.packages.effects : [];
  const lowered = packageLowering && Array.isArray(packageLowering.effects) ? packageLowering.effects : [];
  if (declared.length !== lowered.length) {
    throw new ProviderRequirementAuthorityError(
      'PULSE_PROVIDER_REQUIREMENT_PACKAGE_MISMATCH',
      'Canonical package lowering and native-plan package effects differ.',
      { declared: declared.length, lowered: lowered.length }
    );
  }
  for (let index = 0; index < declared.length; index += 1) {
    if (packageEffectIdentity(declared[index]) !== packageEffectIdentity(lowered[index])) {
      throw new ProviderRequirementAuthorityError(
        'PULSE_PROVIDER_REQUIREMENT_PACKAGE_MISMATCH',
        'Canonical package lowering changed package-effect identity or order.',
        { index, declared: cloneJson(declared[index]), lowered: cloneJson(lowered[index]) }
      );
    }
  }
}

function collectProviderRequirements(plan, packageLowering) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.effects) || !Array.isArray(plan.capabilities)) {
    throw new ProviderRequirementAuthorityError('PULSE_PROVIDER_REQUIREMENT_PLAN_INVALID', 'Provider requirements require a canonical native plan.');
  }
  assertPackageLoweringMatchesPlan(plan, packageLowering);

  const capabilities = sortedUnique(plan.capabilities.map(String));
  const capabilitySet = new Set(capabilities);
  for (const effect of plan.effects) {
    if (effect.capability && !capabilitySet.has(String(effect.capability))) {
      throw new ProviderRequirementAuthorityError(
        'PULSE_PROVIDER_REQUIREMENT_CAPABILITY_UNDECLARED',
        `Canonical effect ${effect.id} requires undeclared capability ${effect.capability}.`,
        { effectId: effect.id, capability: effect.capability }
      );
    }
  }

  const packageEffects = deepFreeze(cloneJson((plan.packages && plan.packages.effects) || []));
  const packageMap = new Map();
  for (const effect of packageEffects) {
    const identity = packageIdentity(effect);
    const key = `${identity.contractId}|${identity.package}|${identity.import}`;
    if (!packageMap.has(key)) packageMap.set(key, identity);
  }

  return normalizeProviderRequirementRecord({
    version: PROVIDER_REQUIREMENT_RECORD_VERSION,
    authorityVersion: PROVIDER_REQUIREMENT_AUTHORITY_VERSION,
    planVersion: String(plan.version || ''),
    planHash: String(plan.planHash || ''),
    providerNeutral: Boolean(plan.ownership && plan.ownership.providerNeutral),
    capabilities,
    providerKinds: sortedUnique(plan.effects.map((effect) => effect.providerKind)),
    operations: Object.freeze(plan.effects.map(providerOperation)),
    packageEffects,
    packages: Object.freeze([...packageMap.values()]),
    packageOperationIds: Object.freeze(packageLowering && packageLowering.operations
      ? packageLowering.operations.map((operation) => String(operation.id))
      : []),
    hostCapabilities: sortedUnique(packageLowering && packageLowering.requiredHostCapabilities),
    policy: Object.freeze({
      providerSelected: false,
      providerNeutralPlanRequired: true,
      sourceAstAccepted: false,
      sourceTextAccepted: false,
      canonicalPlanOnly: true,
      packageLoweringBundleOnly: true
    })
  });
}


function assertProviderRequirementsForPlan(requirements, plan) {
  let normalized;
  try {
    normalized = normalizeProviderRequirementRecord(requirements);
  } catch (error) {
    throw new ProviderRequirementAuthorityError(
      'PULSE_PROVIDER_REQUIREMENT_RECORD_INVALID',
      'Expected a canonical provider requirement record.',
      { version: requirements && requirements.version, cause: error && error.message }
    );
  }
  const planHash = String(plan && plan.planHash || '');
  if (!planHash || normalized.planHash !== planHash) {
    throw new ProviderRequirementAuthorityError(
      'PULSE_PROVIDER_REQUIREMENT_PLAN_MISMATCH',
      'Provider requirements do not belong to the canonical native plan being realized.',
      { planHash, requirementPlanHash: normalized.planHash }
    );
  }
  if (normalized.planVersion !== String(plan && plan.version || '')) {
    throw new ProviderRequirementAuthorityError(
      'PULSE_PROVIDER_REQUIREMENT_PLAN_VERSION_MISMATCH',
      'Provider requirements were produced for a different canonical native-plan version.',
      { planVersion: plan && plan.version, requirementPlanVersion: normalized.planVersion }
    );
  }
  if (normalized.providerNeutral !== true) {
    throw new ProviderRequirementAuthorityError(
      'PULSE_PROVIDER_REQUIREMENT_PROVIDER_NEUTRAL_REQUIRED',
      'Canonical native realization requires provider-neutral requirements.',
      { providerNeutral: normalized.providerNeutral }
    );
  }
  return normalized;
}

function providerRequirementSnapshot(requirements) {
  let normalized;
  try {
    normalized = normalizeProviderRequirementRecord(requirements);
  } catch (error) {
    throw new ProviderRequirementAuthorityError(
      'PULSE_PROVIDER_REQUIREMENT_RECORD_INVALID',
      'Expected a canonical provider requirement record.',
      { cause: error && error.message }
    );
  }
  return deepFreeze({
    capabilities: cloneJson(normalized.capabilities),
    providerKinds: cloneJson(normalized.providerKinds),
    operations: cloneJson(normalized.operations),
    packageEffects: cloneJson(normalized.packageEffects),
    packages: cloneJson(normalized.packages)
  });
}

module.exports = Object.freeze({
  PROVIDER_REQUIREMENT_AUTHORITY_VERSION,
  PROVIDER_REQUIREMENT_RECORD_VERSION,
  ProviderRequirementAuthorityError,
  collectProviderRequirements,
  assertProviderRequirementsForPlan,
  providerRequirementSnapshot
});
