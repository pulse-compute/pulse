'use strict';

const { fastlyJavascriptProviderError } = require('./errors.js');

const FASTLY_JAVASCRIPT_PACKAGE_EFFECTS_VERSION = 'pulse.fastly-javascript-package-effects.v1';

function unavailable(effect = {}) {
  throw fastlyJavascriptProviderError(
    'PULSE_RUNTIME_CAPABILITY_UNAVAILABLE',
    `Pulse capability ${effect.capability || effect.kind || 'package-effect'} is unavailable in the Fastly JavaScript realization.`,
    { package: effect.package, contractId: effect.contractId, operation: effect.operation }
  );
}

function createFastlyJavascriptPackageEffectCapabilities(options = {}) {
  const assetsLookup = options.assetsLookup;
  const gripBroadcast = options.gripBroadcast;
  const digestText = require('@pulse-compute/crypto/provider').createJavascriptTextDigest(options);
  const jwtVerify = options.jwtVerify;
  return Object.freeze({
    version: FASTLY_JAVASCRIPT_PACKAGE_EFFECTS_VERSION,
    effect(effect, execution) {
      if (effect && effect.contractId === 'pulse.crypto' && effect.operation === 'digestText') return digestText(effect, execution);
      if (effect && effect.contractId === 'pulse.assets' && effect.operation === 'lookup') {
        if (typeof assetsLookup !== 'function') return unavailable(effect);
        return assetsLookup(effect.payload, execution);
      }
      if (effect && effect.contractId === 'pulse.grip' && effect.operation === 'broadcast') {
        if (typeof gripBroadcast !== 'function') {
          throw fastlyJavascriptProviderError(
            'PULSE_GRIP_BROADCAST_CAPABILITY_REQUIRED',
            'GRIP broadcast requires a configured Fastly publish capability.',
            { package: effect.package, operation: 'broadcast', configuration: 'bindings.grip.publishEndpoint' }
          );
        }
        return gripBroadcast(effect.payload, execution);
      }
      if (effect && effect.contractId === 'pulse.jwt' && effect.operation === 'verify') {
        if (typeof jwtVerify !== 'function') return unavailable(effect);
        return jwtVerify(effect, execution);
      }
      return unavailable(effect);
    }
  });
}

function withFastlyPackageEffectCapabilities(capabilities, options = {}) {
  const base = capabilities && typeof capabilities === 'object' ? capabilities : {};
  const configured = createFastlyJavascriptPackageEffectCapabilities(options);
  return Object.freeze({
    ...base,
    effect(effect, execution) {
      if (effect && (
        effect.contractId === 'pulse.crypto'
        || effect.contractId === 'pulse.assets'
        || effect.contractId === 'pulse.grip'
        || effect.contractId === 'pulse.jwt'
      )) {
        return configured.effect(effect, execution);
      }
      if (typeof base.effect === 'function') return base.effect(effect, execution);
      return unavailable(effect);
    }
  });
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_PACKAGE_EFFECTS_VERSION,
  createFastlyJavascriptPackageEffectCapabilities,
  withFastlyPackageEffectCapabilities
});
