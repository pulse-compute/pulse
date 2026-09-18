'use strict';

const {
  isJavascriptCoreCapability
} = require('@pulse-compute/wasm-contracts/project/javascript-core-capabilities');

function decision(id, status, reasonId, owner, required = true) {
  return Object.freeze({ id, status, required, reasonId, owner });
}

function blockedRestriction(id, restriction) {
  return restriction
    ? decision(id, 'blocked', restriction.reasonId, restriction.owner)
    : null;
}

function classifyFastlyJavascriptCapability(id, restrictions = {}) {
  const capability = String(id);
  if (capability === 'crypto.digestText') return decision(capability, 'eligible', 'fastly-javascript-crypto-sha256-runtime-builtin', 'provider-fastly');
  if (['kv.getVersioned', 'kv.insertIfAbsent', 'kv.compareAndSwap'].includes(capability)) return decision(capability, 'blocked', 'fastly-conditional-kv-incomplete', 'provider-fastly');
  if (['s3.head', 's3.getText', 's3.putText'].includes(capability)) return decision(capability, 'blocked', 'fastly-javascript-s3-raw-headers-unavailable', 'provider-fastly');
  if (isJavascriptCoreCapability(capability)) {
    return decision(capability, 'eligible', 'fastly-request-router-runtime', 'provider-fastly');
  }
  if (
    capability === 'request.json'
    || capability === 'req.json'
    || capability.startsWith('request.body')
    || capability.startsWith('req.body')
    || capability.startsWith('schema.')
  ) {
    return decision(capability, 'eligible', 'fastly-shared-schema-boundaries', 'runtime');
  }
  if (capability === 'fetch' || capability.startsWith('fetch.') || capability === 'backend-fetch') {
    return blockedRestriction(capability, restrictions.fetch)
      || decision(capability, 'eligible', 'fastly-fetch-adapter', 'provider-fastly');
  }
  if (capability === 'config' || capability === 'config.get') {
    return blockedRestriction(capability, restrictions.config)
      || decision(capability, 'eligible', 'fastly-config-store-adapter', 'provider-fastly');
  }
  if (capability === 'secret' || capability === 'secret.get') {
    return blockedRestriction(capability, restrictions.secret)
      || decision(capability, 'eligible', 'fastly-secret-store-adapter', 'provider-fastly');
  }
  if (capability === 'kv' || capability.startsWith('kv.')) {
    return blockedRestriction(capability, restrictions.kv)
      || decision(capability, 'eligible', 'fastly-kv-store-adapter', 'provider-fastly');
  }
  if (capability === 'assets' || capability.startsWith('assets.')) {
    return blockedRestriction(capability, restrictions.assets)
      || decision(capability, 'eligible', 'fastly-assets-kv-adapter', 'provider-fastly');
  }
  if (
    capability === 'broadcaster'
    || capability === 'channel'
    || capability === 'grip'
    || capability.startsWith('grip.')
  ) {
    return blockedRestriction(capability, restrictions.grip)
      || decision(capability, 'eligible', 'fastly-grip-broadcast-adapter', 'provider-fastly');
  }
  if (
    capability === 'body'
    || capability === 'headers'
    || capability === 'json'
    || capability === 'opaque.pass-through'
    || capability === 'result'
    || capability.startsWith('result.')
    || capability === 'parallel'
    || capability.startsWith('parallel.')
    || capability === 'logging'
    || capability === 'log'
    || capability.startsWith('log.')
  ) {
    return decision(capability, 'eligible', 'fastly-shared-javascript-runtime', 'runtime');
  }
  if (capability === 'clock' || capability === 'timer') {
    return decision(capability, 'pending', 'fastly-javascript-clock-timer-pending', 'runtime');
  }
  if (capability === 'time.wall-clock') {
    return decision(capability, 'eligible', 'fastly-javascript-provider-wall-clock-authority', 'provider-fastly');
  }
  if (
    capability === 'jwt.sign'
    || capability === 'jwt.verify'
    || capability === 'jwt.verify.hs256'
    || capability === 'jwt.verify.es256'
    || capability === 'jwt.verify.rs256'
  ) {
    return blockedRestriction(capability, restrictions.jwt)
      || decision(capability, 'eligible', 'fastly-javascript-jwt-crypto-runtime-builtin', 'provider-fastly');
  }
  if (capability.startsWith('jwt.verify.')) {
    return decision(capability, 'blocked', 'jwt-crypto-realization-unavailable', 'crypto');
  }
  if (capability === 'event.ingress') {
    return decision(capability, 'blocked', 'fastly-event-ingress-unavailable', 'provider-fastly');
  }
  if (capability === 'event.emit') {
    return decision(capability, 'blocked', 'fastly-event-emit-unavailable', 'provider-fastly');
  }
  return decision(capability, 'blocked', 'unknown-fastly-javascript-capability-fail-closed', 'compiler');
}

function classifyFastlyJavascriptProviderRequirement(id, restrictions = {}) {
  const requirement = String(id);
  if (requirement === 'crypto.digestText') return decision(requirement, 'eligible', 'fastly-javascript-crypto-sha256-runtime-builtin', 'provider-fastly');
  if (['kv.getVersioned', 'kv.insertIfAbsent', 'kv.compareAndSwap'].includes(requirement)) return decision(requirement, 'blocked', 'fastly-conditional-kv-incomplete', 'provider-fastly');
  if (['s3.head', 's3.getText', 's3.putText'].includes(requirement)) return decision(requirement, 'blocked', 'fastly-javascript-s3-raw-headers-unavailable', 'provider-fastly');
  if (requirement === 'request' || ['response.json', 'response.text', 'response.custom'].includes(requirement)) {
    return decision(requirement, 'eligible', 'fastly-request-response-lifecycle', 'provider-fastly');
  }
  if (requirement === 'fetch' || requirement === 'opaque.pass-through' || ['body', 'headers', 'result'].includes(requirement)) {
    return blockedRestriction(requirement, restrictions.fetch)
      || decision(requirement, 'eligible', 'fastly-fetch-adapter', 'provider-fastly');
  }
  if (requirement === 'config.get') {
    return blockedRestriction(requirement, restrictions.config)
      || decision(requirement, 'eligible', 'fastly-config-store-adapter', 'provider-fastly');
  }
  if (requirement === 'secret.get') {
    return blockedRestriction(requirement, restrictions.secret)
      || decision(requirement, 'eligible', 'fastly-secret-store-adapter', 'provider-fastly');
  }
  if (requirement === 'kv' || requirement === 'kv.get' || requirement === 'kv.put') {
    return blockedRestriction(requirement, restrictions.kv)
      || decision(requirement, 'eligible', 'fastly-kv-store-adapter', 'provider-fastly');
  }
  if (requirement === 'assets' || requirement.startsWith('assets.')) {
    return blockedRestriction(requirement, restrictions.assets)
      || decision(requirement, 'eligible', 'fastly-assets-kv-adapter', 'provider-fastly');
  }
  if (
    ['broadcaster', 'channel'].includes(requirement)
    || requirement === 'grip'
    || requirement.startsWith('grip.')
  ) {
    return blockedRestriction(requirement, restrictions.grip)
      || decision(requirement, 'eligible', 'fastly-grip-broadcast-adapter', 'provider-fastly');
  }
  if (requirement.startsWith('schema.')) {
    return decision(requirement, 'eligible', 'fastly-shared-schema-boundaries', 'runtime');
  }
  if (requirement === 'clock') {
    return decision(requirement, 'pending', 'fastly-javascript-clock-timer-pending', 'runtime');
  }
  if (requirement === 'time.wall-clock') {
    return decision(requirement, 'eligible', 'fastly-javascript-provider-wall-clock-authority', 'provider-fastly');
  }
  if (
    requirement === 'jwt.sign'
    || requirement === 'jwt.verify'
    || requirement === 'jwt.verify.hs256'
    || requirement === 'jwt.verify.es256'
    || requirement === 'jwt.verify.rs256'
  ) {
    return blockedRestriction(requirement, restrictions.jwt)
      || decision(requirement, 'eligible', 'fastly-javascript-jwt-crypto-runtime-builtin', 'provider-fastly');
  }
  if (requirement.startsWith('jwt.verify.')) {
    return decision(requirement, 'blocked', 'jwt-crypto-realization-unavailable', 'crypto');
  }
  if (requirement === 'event.ingress') {
    return decision(requirement, 'blocked', 'fastly-event-ingress-unavailable', 'provider-fastly');
  }
  if (requirement === 'event.emit') {
    return decision(requirement, 'blocked', 'fastly-event-emit-unavailable', 'provider-fastly');
  }
  return decision(requirement, 'blocked', 'unknown-fastly-provider-requirement-fail-closed', 'compiler');
}

function restriction(reasonId, configuration) {
  return Object.freeze({ reasonId, owner: 'provider-fastly', configuration });
}

function fastlyJavascriptProjectRestrictions(compiled, project) {
  if (project.providerConfig?.maxDurationMs !== undefined) {
    const error = new TypeError('fastly.maxDurationMs requires the Native target; Fastly JavaScript does not implement the request deadline.');
    error.code = 'PULSE_REQUEST_DURATION_UNSUPPORTED';
    throw error;
  }
  const bindings = project.providerConfig && project.providerConfig.bindings || {};
  const backends = bindings.backends && typeof bindings.backends === 'object' ? bindings.backends : {};
  const kv = bindings.kv && typeof bindings.kv === 'object' ? bindings.kv : {};
  const sites = compiled.metadata.effectSites || [];
  const fetchSites = sites.filter((entry) => entry.kind === 'fetch');
  const kvSites = sites.filter((entry) => entry.kind === 'kv.get' || entry.kind === 'kv.put');
  const assetSites = sites.filter((entry) => entry.contractId === 'pulse.assets' && entry.operation === 'lookup');
  const gripSites = sites.filter((entry) => entry.contractId === 'pulse.grip' && entry.operation === 'broadcast');
  const configSites = sites.filter((entry) => entry.kind === 'config.get');
  const secretSites = sites.filter((entry) => entry.kind === 'secret.get');
  const jwtSites = sites.filter((entry) => (
    entry.contractId === 'pulse.jwt'
    && (['verify', 'sign'].includes(entry.operation) || ['jwt.verify', 'jwt.sign'].includes(entry.kind))
  ));
  const output = {};

  if (configSites.length > 0 && !(typeof bindings.configStore === 'string' && bindings.configStore.trim())) {
    output.config = restriction('fastly-config-store-binding-required', 'bindings.configStore');
  }
  const grip = bindings.grip && typeof bindings.grip === 'object' ? bindings.grip : {};
  const gripSecretRequired = gripSites.length > 0 && grip.authentication && grip.authentication.secretRef;
  if ((secretSites.length > 0 || gripSecretRequired) && !(typeof bindings.secretStore === 'string' && bindings.secretStore.trim())) {
    output.secret = restriction('fastly-secret-store-binding-required', 'bindings.secretStore');
  }
  if (jwtSites.length > 0 && !(typeof bindings.secretStore === 'string' && bindings.secretStore.trim())) {
    output.jwt = restriction('fastly-jwt-secret-store-binding-required', 'bindings.secretStore');
  }

  for (const site of fetchSites) {
    const resource = site.resource || {};
    if (resource.kind === 'literal') {
      if (!resource.origin) {
        output.fetch = restriction('fastly-fetch-url-invalid', 'ctx.fetch');
        break;
      }
      if (!(typeof backends[resource.origin] === 'string' && backends[resource.origin].trim()) && bindings.dynamicBackends !== true) {
        output.fetch = restriction('fastly-fetch-backend-binding-required', `bindings.backends.${resource.origin}`);
        break;
      }
    } else if (resource.kind === 'dynamic' && bindings.dynamicBackends !== true && Object.keys(backends).length === 0) {
      output.fetch = restriction('fastly-dynamic-fetch-backend-policy-required', 'bindings.backends');
      break;
    }
  }

  for (const site of kvSites) {
    const resource = site.resource || {};
    if (resource.kind !== 'literal') {
      output.kv = restriction('fastly-dynamic-kv-namespace-unsupported', 'bindings.kv');
      break;
    }
    const namespace = String(resource.value || '');
    if (!(typeof kv[namespace] === 'string' && kv[namespace].trim())) {
      output.kv = restriction('fastly-kv-binding-required', `bindings.kv.${namespace}`);
      break;
    }
  }

  for (const site of assetSites) {
    const store = site.payload && typeof site.payload.store === 'string' ? site.payload.store : '';
    if (!store || !(typeof kv[store] === 'string' && kv[store].trim())) {
      output.assets = restriction('fastly-assets-binding-required', store ? `bindings.kv.${store}` : 'bindings.kv');
      break;
    }
  }

  if (gripSites.length > 0) {
    const endpointValue = grip.publishEndpoint || grip.publishUrl;
    let endpoint;
    try { endpoint = new URL(String(endpointValue || '')); }
    catch (_) {
      output.grip = restriction('fastly-grip-publish-endpoint-required', 'bindings.grip.publishEndpoint');
    }
    if (endpoint && !['http:', 'https:'].includes(endpoint.protocol)) {
      output.grip = restriction('fastly-grip-publish-endpoint-invalid', 'bindings.grip.publishEndpoint');
    }
    if (endpoint && !output.grip) {
      const mapped = typeof backends[endpoint.origin] === 'string' && backends[endpoint.origin].trim();
      const explicit = typeof grip.publishBackend === 'string' && grip.publishBackend.trim();
      if (!mapped && !explicit && bindings.dynamicBackends !== true) {
        output.grip = restriction('fastly-grip-publish-backend-required', 'bindings.grip.publishBackend');
      }
    }
  }

  return Object.freeze(output);
}

module.exports = Object.freeze({
  classifyFastlyJavascriptCapability,
  classifyFastlyJavascriptProviderRequirement,
  fastlyJavascriptProjectRestrictions
});
