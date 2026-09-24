'use strict';

const path = require('node:path');

const {
  NATIVE_OPTIMIZATION_VERSION,
  EXPERIMENTAL_NATIVE_SIZE_MODE,
  EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE
} = require('@pulse-compute/wasm-contracts/project/native-optimization');
const EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION = Object.freeze({
  version: NATIVE_OPTIMIZATION_VERSION,
  mode: EXPERIMENTAL_NATIVE_SIZE_MODE,
  experimental: true,
  goal: 'size',
  assemblyScript: Object.freeze({
    optimize: true,
    optimizeLevel: 3,
    shrinkLevel: 2,
    converge: true
  })
});

const EXPERIMENTAL_NATIVE_BOUNDED_SIZE_OPTIMIZATION = Object.freeze({
  version: NATIVE_OPTIMIZATION_VERSION,
  mode: EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE,
  experimental: true,
  goal: 'size',
  assemblyScript: Object.freeze({
    optimize: true,
    optimizeLevel: 3,
    shrinkLevel: 2,
    converge: false
  })
});

function resolveNativeOptimization(value) {
  if (value === undefined || value === null || value === false) return undefined;
  if (
    value === true
    || value === EXPERIMENTAL_NATIVE_SIZE_MODE
    || (typeof value === 'object' && value.mode === EXPERIMENTAL_NATIVE_SIZE_MODE)
  ) {
    return EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION;
  }
  if (value === EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE
    || (typeof value === 'object' && value.mode === EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE)) {
    return EXPERIMENTAL_NATIVE_BOUNDED_SIZE_OPTIMIZATION;
  }
  throw new TypeError(`Unsupported Pulse Native optimization mode ${String(value && value.mode || value)}.`);
}

function appendAssemblyScriptOptimizationArgs(args, value, options = {}) {
  if (!Array.isArray(args)) throw new TypeError('AssemblyScript optimization arguments require a mutable argument array.');
  // AssemblyScript ignores custom @noinline annotations. Apply Pulse's generated
  // annotations to Binaryen IR before its default passes in every profile.
  args.push('--transform', path.join(__dirname, 'native-retention-transform.cjs'));
  // Run merging after asc's optimizer has honored retained helper boundaries.
  // Guest inputs are merged once, with the other units, by the guest-link owner.
  if (!options.guestLinked) args.push('--runPasses', 'merge-similar-functions');
  const optimization = resolveNativeOptimization(value);
  if (!optimization) return undefined;
  args.push(
    '--optimizeLevel', String(optimization.assemblyScript.optimizeLevel),
    '--shrinkLevel', String(optimization.assemblyScript.shrinkLevel)
  );
  if (optimization.assemblyScript.converge) args.push('--converge');
  return optimization;
}

module.exports = Object.freeze({
  NATIVE_OPTIMIZATION_VERSION,
  EXPERIMENTAL_NATIVE_SIZE_MODE,
  EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION,
  EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE,
  EXPERIMENTAL_NATIVE_BOUNDED_SIZE_OPTIMIZATION,
  resolveNativeOptimization,
  appendAssemblyScriptOptimizationArgs
});
