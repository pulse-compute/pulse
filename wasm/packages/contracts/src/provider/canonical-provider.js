'use strict';

const CANONICAL_PROVIDER_CONTRACT_VERSION = 'pulse.canonical-provider-contract.v1';
const CANONICAL_PROVIDER_PLAN_VERSION = 'pulse.canonical-provider-plan.v1';

const CANONICAL_PROVIDER_CAPABILITIES = Object.freeze([
  'request',
  'response.json',
  'response.text',
  'response.custom',
  'fetch',
  'config.get',
  'secret.get',
  'kv.get',
  'kv.put',
  'event.ingress',
  'event.emit',
  'assets.lookup',
  'grip.channel',
  'grip.hold',
  'grip.publish',
  'grip.broadcast',
  'jwt.verify',
  's3.head',
  's3.getText',
  's3.putText',
  'opaque.pass-through'
]);

class CanonicalProviderContractError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'CanonicalProviderContractError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function unique(values) {
  return [...new Set((values || []).filter((value) => value !== undefined).map(String))];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeDescriptor(input = {}) {
  const id = String(input.id || input.name || '').trim().toLowerCase();
  if (!id) throw new CanonicalProviderContractError('PULSE_PROVIDER_ID_REQUIRED', 'Canonical provider descriptor requires an id.');
  const capabilities = unique(input.capabilities || input.operations).sort();
  const unsupported = capabilities.filter((capability) => !CANONICAL_PROVIDER_CAPABILITIES.includes(capability));
  if (unsupported.length > 0) {
    throw new CanonicalProviderContractError(
      'PULSE_PROVIDER_CAPABILITY_UNKNOWN',
      `Provider ${id} declares unknown capabilities: ${unsupported.join(', ')}`,
      { id, unsupported }
    );
  }
  const lowering = { ...(input.lowering || {}) };
  for (const capability of capabilities) {
    if (!lowering[capability]) {
      throw new CanonicalProviderContractError(
        'PULSE_PROVIDER_LOWERING_MISSING',
        `Provider ${id} does not define lowering for ${capability}.`,
        { id, capability }
      );
    }
  }
  return deepFreeze({
    version: CANONICAL_PROVIDER_CONTRACT_VERSION,
    id,
    name: id,
    package: String(input.package || ''),
    runtime: String(input.runtime || ''),
    providerVersion: String(input.providerVersion || input.version || '0.0.0'),
    buildTarget: String(input.buildTarget || id),
    capabilities,
    operations: capabilities,
    lowering,
    providerSpecificUserland: false,
    providerSdkUserland: false,
    capabilityDiscoveryFromUserland: false,
    localExecution: input.localExecution !== false,
    deployable: input.deployable === true
  });
}

function capabilitiesForOperation(operation) {
  if (!operation || typeof operation !== 'object') return Object.freeze([]);
  if (operation.kind === 'fetch') {
    return Object.freeze(operation.opaqueReturn ? ['fetch', 'opaque.pass-through'] : ['fetch']);
  }
  if (operation.kind === 'config') return Object.freeze(['config.get']);
  if (operation.kind === 'secret') return Object.freeze(['secret.get']);
  if (operation.kind === 'kv') return Object.freeze([`kv.${operation.operation || 'get'}`]);
  if (operation.kind === 'grip') {
    const capability = `grip.${operation.operation || ''}`;
    return Object.freeze(operation.operation === 'hold' ? [capability, 'opaque.pass-through'] : [capability]);
  }
  if (operation.capability) {
    const direct = String(operation.capability);
    if (direct === 'kv') return Object.freeze([`kv.${operation.operation || 'get'}`]);
    return Object.freeze([direct]);
  }
  return Object.freeze([]);
}

function capabilityForOperation(operation) {
  return capabilitiesForOperation(operation)[0];
}

function capabilityFromCompilerCapability(capability) {
  const value = String(capability);
  if (value === 'request.text' || value === 'request.json') return 'request';
  if (value === 'response.response') return 'response.custom';
  if (value === 'kv') return undefined;
  return CANONICAL_PROVIDER_CAPABILITIES.includes(value) ? value : undefined;
}

function requirementsFromMetadata(metadata = {}) {
  const requirements = [];
  for (const operation of Array.isArray(metadata.providerOperations) ? metadata.providerOperations : []) {
    requirements.push(...capabilitiesForOperation(operation));
  }
  for (const capability of metadata.capabilities || []) {
    const normalized = capabilityFromCompilerCapability(capability);
    if (normalized) requirements.push(normalized);
  }
  const eventCatalog = metadata.events && metadata.events.catalog;
  for (const event of eventCatalog && Array.isArray(eventCatalog.events) ? eventCatalog.events : []) {
    for (const requirement of event.hostRequirements || []) {
      if (CANONICAL_PROVIDER_CAPABILITIES.includes(String(requirement))) requirements.push(String(requirement));
    }
  }
  if ((metadata.opaqueReturnCount || 0) > 0) requirements.push('fetch', 'opaque.pass-through');
  return Object.freeze(unique(requirements).sort());
}

function bindingForOperation(operation, bindings = {}) {
  if (!operation || typeof operation !== 'object') return undefined;
  if (operation.kind === 'config') return bindings.configStore || 'pulse_config';
  if (operation.kind === 'secret') return bindings.secretStore || 'pulse_secrets';
  if (operation.kind === 'kv') {
    const logical = operation.resource && operation.resource.kind === 'literal' ? operation.resource.value : undefined;
    return logical && bindings.kv && bindings.kv[logical] ? bindings.kv[logical] : logical;
  }
  if (operation.kind === 'fetch') {
    const origin = operation.resource && operation.resource.kind === 'literal' ? operation.resource.origin : undefined;
    return origin && bindings.backends && bindings.backends[origin] ? bindings.backends[origin] : origin;
  }
  if (operation.kind === 'grip') return bindings.grip;
  return undefined;
}

function assertProviderSupports(metadata = {}, descriptorInput) {
  const descriptor = normalizeDescriptor(descriptorInput);
  const requirements = requirementsFromMetadata(metadata);
  const missing = requirements.filter((capability) => !descriptor.capabilities.includes(capability));
  if (missing.length > 0) {
    throw new CanonicalProviderContractError(
      'PULSE_PROVIDER_CAPABILITY_UNSUPPORTED',
      `Provider ${descriptor.id} does not implement required capabilities: ${missing.join(', ')}`,
      { provider: descriptor.id, missing, required: requirements, available: descriptor.capabilities }
    );
  }
  return descriptor;
}

function createProviderLoweringPlan(metadata = {}, descriptorInput, bindings = {}) {
  const descriptor = assertProviderSupports(metadata, descriptorInput);
  const requirements = requirementsFromMetadata(metadata);
  const operations = (metadata.providerOperations || []).map((operation) => {
    const operationCapabilities = capabilitiesForOperation(operation);
    const primaryCapability = operationCapabilities[0];
    const resultCapability = operationCapabilities[1];
    return deepFreeze({
      id: String(operation.id),
      kind: String(operation.kind),
      operation: operation.operation ? String(operation.operation) : undefined,
      capability: primaryCapability,
      capabilities: operationCapabilities,
      lowering: primaryCapability ? descriptor.lowering[primaryCapability] : undefined,
      resultCapability,
      resultLowering: resultCapability ? descriptor.lowering[resultCapability] : undefined,
      binding: bindingForOperation(operation, bindings),
      resource: operation.resource,
      package: operation.package ? String(operation.package) : undefined,
      contractId: operation.contractId ? String(operation.contractId) : undefined,
      payload: operation.payload && typeof operation.payload === 'object' ? deepFreeze({ ...operation.payload }) : undefined,
      result: operation.result ? String(operation.result) : undefined,
      opaqueReturn: Boolean(operation.opaqueReturn || operation.result === 'opaque-response'),
      position: operation.position
    });
  });
  return deepFreeze({
    version: CANONICAL_PROVIDER_PLAN_VERSION,
    contractVersion: CANONICAL_PROVIDER_CONTRACT_VERSION,
    provider: descriptor.id,
    providerVersion: descriptor.providerVersion,
    package: descriptor.package,
    runtime: descriptor.runtime,
    buildTarget: descriptor.buildTarget,
    deployable: descriptor.deployable,
    localExecution: descriptor.localExecution,
    requirements,
    bindings: {
      configStore: bindings.configStore || undefined,
      secretStore: bindings.secretStore || undefined,
      kv: { ...(bindings.kv || {}) },
      backends: { ...(bindings.backends || {}) },
      grip: bindings.grip && typeof bindings.grip === 'object' ? { ...bindings.grip } : undefined
    },
    operations,
    providerSpecificUserland: false,
    providerSdkUserland: false,
    capabilityDiscoveryFromUserland: false
  });
}

module.exports = Object.freeze({
  CANONICAL_PROVIDER_CONTRACT_VERSION,
  CANONICAL_PROVIDER_PLAN_VERSION,
  CANONICAL_PROVIDER_CAPABILITIES,
  CanonicalProviderContractError,
  normalizeDescriptor,
  createProviderDescriptor: normalizeDescriptor,
  requirementsFromMetadata,
  assertProviderSupports,
  createProviderLoweringPlan,
  createProviderPlan: createProviderLoweringPlan,
  capabilitiesForOperation,
  capabilityForOperation,
  capabilityFromCompilerCapability,
  bindingForOperation,
  deepFreeze
});
