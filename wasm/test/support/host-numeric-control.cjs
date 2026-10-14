'use strict';
// Test-only boxed pulse_host artifact. The production compiler has no opt-out.
function withBoxedHostControl(callback) {
  const emitterId = require.resolve('../../packages/runtime-core-as/src/compiler/canonical-native');
  const compilerId = require.resolve('../../packages/compiler/src/canonical-native-compiler');
  const emitter = require(emitterId), compiler = require.cache[compilerId];
  require.cache[emitterId].exports = { ...emitter, generateCanonicalNativeAssemblyScript(plan, options) {
    return emitter.generateCanonicalNativeAssemblyScript(plan, { ...options, numericRegions: undefined });
  } };
  delete require.cache[compilerId];
  try { return callback(require(compilerId)); }
  finally { require.cache[emitterId].exports = emitter; if (compiler) require.cache[compilerId] = compiler; else delete require.cache[compilerId]; }
}
function executionSemantics(result) {
  const value = { response: result.response, trace: result.trace, continuations: result.continuations,
    resolutionOrder: result.resolutionOrder, effectCount: result.effectCount, memory: result.memory };
  // The registry assigns a different owner ID per execution. Preserve each
  // invocation's sequence suffix and all payload strings, including user data.
  return JSON.parse(JSON.stringify(value, (key, v) => key === 'invocationId' && typeof v === 'string'
    ? v.replace(/^(continuation-)?effect-\d+-/, (_, prefix = '') => prefix + 'effect-owner-') : v));
}
module.exports = { withBoxedHostControl, executionSemantics };
