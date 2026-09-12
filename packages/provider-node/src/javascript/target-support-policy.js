'use strict';

const {
  isJavascriptCoreCapability
} = require('@pulse-compute/wasm-contracts/project/javascript-core-capabilities');

function decision(id, status, reasonId, owner, required = true) {
  return Object.freeze({ id, status, required, reasonId, owner });
}

function classifyNodeJavascriptCapability(id, options = {}) {
  const capability = String(id);
  if (['s3.head', 's3.getText', 's3.putText'].includes(capability)) return decision(capability, 'eligible', 'node-s3-bounded-origin-transport', 'provider-node');
  if (isJavascriptCoreCapability(capability)) {
    return decision(capability, 'eligible', 'node-router-context-parity', 'provider-node');
  }
  if (capability === 'logging' || capability === 'log' || capability.startsWith('log.')) {
    return decision(capability, 'eligible', 'javascript-logging-runtime', 'runtime');
  }
  if (capability === 'request.json' || capability === 'req.json' || capability.startsWith('request.body') || capability.startsWith('req.body')) {
    return decision(capability, 'eligible', 'javascript-request-body-realization', 'runtime');
  }
  if (
    capability === 'fetch'
    || capability.startsWith('fetch.')
    || capability === 'backend-fetch'
    || capability === 'body'
    || capability === 'headers'
    || capability === 'json'
    || capability === 'opaque.pass-through'
    || capability === 'result'
    || capability.startsWith('result.')
  ) {
    return decision(capability, 'eligible', 'javascript-fetch-projection-realization', 'runtime');
  }
  if (capability === 'clock' || capability === 'timer') {
    return decision(capability, 'pending', 'javascript-clock-timer-realization-pending', 'runtime');
  }
  if (capability === 'time.wall-clock') {
    return decision(capability, 'eligible', 'node-provider-wall-clock-authority', 'provider-node');
  }
  if (
    capability === 'jwt.verify'
    || capability === 'jwt.verify.hs256'
    || capability === 'jwt.verify.es256'
  ) {
    return decision(capability, 'eligible', 'node-javascript-jwt-crypto-runtime-builtin', 'provider-node');
  }
  if (capability.startsWith('jwt.verify.')) {
    return decision(capability, 'blocked', 'jwt-crypto-realization-unavailable', 'crypto');
  }
  if (capability === 'config.get' || capability === 'secret.get' || capability === 'kv' || capability.startsWith('kv.')) {
    return options.bindingsRedaction === true
      ? decision(capability, 'eligible', 'javascript-binding-redaction-implemented', 'provider-node')
      : decision(capability, 'pending', 'javascript-binding-effect-pending', 'provider-node');
  }
  if (capability === 'assets' || capability.startsWith('assets.')) {
    return decision(capability, 'eligible', 'assets-javascript-realization', 'assets');
  }
  if (capability.startsWith('schema.')) {
    return decision(capability, 'eligible', 'javascript-schema-validation-policy', 'schema-json');
  }
  if (capability === 'event.ingress') {
    return decision(capability, 'eligible', 'node-event-reference-ingress', 'provider-node');
  }
  if (capability === 'event.emit') {
    return decision(capability, 'eligible', 'node-event-reference-acceptance', 'provider-node');
  }
  if (capability === 'broadcaster' || capability === 'channel' || capability === 'grip' || capability.startsWith('grip.')) {
    return options.gripRealized === true
      ? decision(capability, 'eligible', 'grip-realization-implemented', 'grip')
      : decision(capability, 'pending', 'grip-javascript-readiness-pending', 'grip');
  }
  return decision(capability, 'blocked', 'unknown-javascript-capability-fail-closed', 'compiler');
}

function classifyNodeJavascriptProviderRequirement(id, compilerCapabilities, options = {}) {
  const requirement = String(id);
  if (['s3.head', 's3.getText', 's3.putText'].includes(requirement)) return decision(requirement, 'eligible', 'node-s3-bounded-origin-transport', 'provider-node');
  if (requirement === 'request') {
    const bodyRequired = compilerCapabilities.some((entry) => entry === 'request.json' || entry.startsWith('request.body'));
    return bodyRequired
      ? decision(requirement, 'eligible', 'javascript-request-body-realization', 'runtime')
      : decision(requirement, 'eligible', 'node-request-adapter-and-body-text', 'provider-node');
  }
  if (['response.json', 'response.text', 'response.custom'].includes(requirement)) {
    return decision(requirement, 'eligible', 'node-response-ownership', 'provider-node');
  }
  if (requirement === 'fetch' || requirement === 'opaque.pass-through' || ['body', 'headers', 'result'].includes(requirement)) {
    return decision(requirement, 'eligible', 'javascript-fetch-projection-realization', 'runtime');
  }
  if (['config.get', 'secret.get', 'kv.get', 'kv.put'].includes(requirement)) {
    return options.bindingsRedaction === true
      ? decision(requirement, 'eligible', 'javascript-binding-redaction-implemented', 'provider-node')
      : decision(requirement, 'pending', 'javascript-binding-effect-pending', 'provider-node');
  }
  if (requirement === 'assets' || requirement.startsWith('assets.')) {
    return decision(requirement, 'eligible', 'assets-javascript-realization', 'assets');
  }
  if (requirement === 'clock') {
    return decision(requirement, 'pending', 'javascript-clock-timer-realization-pending', 'runtime');
  }
  if (requirement === 'time.wall-clock') {
    return decision(requirement, 'eligible', 'node-provider-wall-clock-authority', 'provider-node');
  }
  if (
    requirement === 'jwt.verify'
    || requirement === 'jwt.verify.hs256'
    || requirement === 'jwt.verify.es256'
  ) {
    return decision(requirement, 'eligible', 'node-javascript-jwt-crypto-runtime-builtin', 'provider-node');
  }
  if (requirement.startsWith('jwt.verify.')) {
    return decision(requirement, 'blocked', 'jwt-crypto-realization-unavailable', 'crypto');
  }
  if (requirement.startsWith('schema.')) {
    return decision(requirement, 'eligible', 'javascript-schema-validation-policy', 'schema-json');
  }
  if (requirement === 'event.ingress') {
    return decision(requirement, 'eligible', 'node-event-reference-ingress', 'provider-node');
  }
  if (requirement === 'event.emit') {
    return decision(requirement, 'eligible', 'node-event-reference-acceptance', 'provider-node');
  }
  if (['broadcaster', 'channel'].includes(requirement) || requirement === 'grip' || requirement.startsWith('grip.')) {
    return options.gripRealized === true
      ? decision(requirement, 'eligible', 'grip-realization-implemented', 'grip')
      : decision(requirement, 'pending', 'grip-javascript-readiness-pending', 'grip');
  }
  return decision(requirement, 'blocked', 'unknown-provider-requirement-fail-closed', 'compiler');
}

module.exports = Object.freeze({
  classifyNodeJavascriptCapability,
  classifyNodeJavascriptProviderRequirement
});
