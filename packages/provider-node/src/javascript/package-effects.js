'use strict';

const NODE_JAVASCRIPT_PACKAGE_EFFECTS_VERSION = 'pulse.node-javascript-package-effects.v1';

class PulseNodeJavascriptPackageEffectError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'PulseNodeJavascriptPackageEffectError';
    this.code = code;
    this.detail = detail && Object.freeze({ ...detail });
  }
}

function unavailableGrip() {
  throw new PulseNodeJavascriptPackageEffectError(
    'PULSE_GRIP_BROADCAST_CAPABILITY_REQUIRED',
    'GRIP broadcast requires an explicitly configured provider publish capability.',
    { package: '@pulse-compute/grip', operation: 'broadcast', configuration: 'grip.publishEndpoint' }
  );
}

function unavailable(effect) {
  throw new PulseNodeJavascriptPackageEffectError(
    'PULSE_RUNTIME_CAPABILITY_UNAVAILABLE',
    `Pulse capability ${effect.capability || effect.kind} is unavailable in the Node JavaScript realization.`,
    { package: effect.package, contractId: effect.contractId, operation: effect.operation }
  );
}

function createNodeJavascriptPackageEffectCapabilities(options = {}) {
  const assetsLookup = options.assetsLookup || (options.assets && options.assets.lookup);
  const gripBroadcast = options.gripBroadcast || (options.grip && options.grip.broadcast);
  const digestText = require('@pulse-compute/crypto/provider').createJavascriptTextDigest(options);
  const jwtVerify = options.jwtVerify || (options.jwt && options.jwt.verify);
  const s3 = options.s3;
  return Object.freeze({
    version: NODE_JAVASCRIPT_PACKAGE_EFFECTS_VERSION,
    async effect(effect, execution) {
      if (effect && effect.contractId === 'pulse.s3') {
        if (typeof s3 !== 'function') return unavailable(effect);
        return s3(effect, execution);
      }
      if (effect && effect.contractId === 'pulse.crypto' && effect.operation === 'digestText') return digestText(effect, execution);
      if (effect && effect.contractId === 'pulse.assets' && effect.operation === 'lookup') {
        if (typeof assetsLookup !== 'function') return unavailable(effect);
        return assetsLookup(effect.payload, execution);
      }
      if (effect && effect.contractId === 'pulse.grip' && effect.operation === 'broadcast') {
        if (typeof gripBroadcast !== 'function') return unavailableGrip();
        return gripBroadcast(effect.payload, execution);
      }
      if (effect && effect.contractId === 'pulse.jwt' && effect.operation === 'verify') {
        if (typeof jwtVerify !== 'function') return unavailable(effect);
        return jwtVerify(effect, execution);
      }
      return unavailable(effect || {});
    }
  });
}

function withNodePackageEffectCapabilities(capabilities, options = {}) {
  const base = capabilities && typeof capabilities === 'object' ? capabilities : {};
  const packageCapabilities = createNodeJavascriptPackageEffectCapabilities(options);
  return Object.freeze({
    ...base,
    effect(effect, execution) {
      if (effect && (
        effect.contractId === 'pulse.crypto'
        || effect.contractId === 'pulse.assets'
        || effect.contractId === 'pulse.grip'
        || effect.contractId === 'pulse.jwt'
        || effect.contractId === 'pulse.s3'
      )) {
        return packageCapabilities.effect(effect, execution);
      }
      if (typeof base.effect === 'function') return base.effect(effect, execution);
      return unavailable(effect || {});
    }
  });
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_PACKAGE_EFFECTS_VERSION,
  PulseNodeJavascriptPackageEffectError,
  createNodeJavascriptPackageEffectCapabilities,
  withNodePackageEffectCapabilities
});
