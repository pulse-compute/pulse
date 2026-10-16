'use strict';
// Test-only realization of the exact same plan with the pre-MEM9 boxed emitter.
// Never expose a production switch or rewrite emitted expression strings.
function withBoxedControl(callback) {
  const canonicalId = require.resolve('../../packages/runtime-core-as/src/compiler/canonical-native.js');
  const platformId = require.resolve('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
  const canonical = require(canonicalId), oldCanonical = require.cache[canonicalId].exports;
  const oldPlatform = require.cache[platformId];
  require.cache[canonicalId].exports = { ...canonical, generateCanonicalNativeAssemblyScript(plan, options) {
    return canonical.generateCanonicalNativeAssemblyScript(plan, { ...options, numericRegions: undefined });
  } };
  delete require.cache[platformId];
  try { return callback(require(platformId)); }
  finally { require.cache[canonicalId].exports = oldCanonical; if (oldPlatform) require.cache[platformId] = oldPlatform; else delete require.cache[platformId]; }
}
module.exports = { withBoxedControl };
