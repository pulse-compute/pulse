'use strict';
// Test-only retained realization of exactly the same canonical plan. The
// provider remains authoritative; no production option disables its policy.
function withRetainedHandles(callback) {
  const canonicalId = require.resolve('../../packages/runtime-core-as/src/compiler/canonical-native.js');
  const platformId = require.resolve('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
  const canonical = require(canonicalId), old = require.cache[canonicalId].exports;
  const oldPlatform = require.cache[platformId];
  require.cache[canonicalId].exports = { ...canonical, generateCanonicalNativeAssemblyScript(plan, options) {
    return canonical.generateCanonicalNativeAssemblyScript(plan, { ...options, handleOwnership: undefined });
  } };
  delete require.cache[platformId];
  try { return callback(require(platformId)); }
  finally { require.cache[canonicalId].exports = old; if (oldPlatform) require.cache[platformId] = oldPlatform; else delete require.cache[platformId]; }
}
module.exports = { withRetainedHandles };
