'use strict';

const path = require('node:path');

const {
  NATIVE_BOUNDED_SIZE_MODE,
  NATIVE_SHRINK0_MODE,
  selectNativeOptimizationMode,
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

const NATIVE_BOUNDED_SIZE_OPTIMIZATION = Object.freeze({
  ...EXPERIMENTAL_NATIVE_BOUNDED_SIZE_OPTIMIZATION,
  mode: NATIVE_BOUNDED_SIZE_MODE,
  experimental: false
});
const NATIVE_SHRINK0_OPTIMIZATION = Object.freeze({
  ...NATIVE_BOUNDED_SIZE_OPTIMIZATION,
  mode: NATIVE_SHRINK0_MODE,
  goal: 'speed',
  assemblyScript: Object.freeze({ optimize: true, optimizeLevel: 3, shrinkLevel: 0, converge: false })
});

function resolveNativeOptimization(value) {
  const mode = selectNativeOptimizationMode({ nativeOptimization: value });
  return {
    [NATIVE_BOUNDED_SIZE_MODE]: NATIVE_BOUNDED_SIZE_OPTIMIZATION,
    [NATIVE_SHRINK0_MODE]: NATIVE_SHRINK0_OPTIMIZATION,
    [EXPERIMENTAL_NATIVE_SIZE_MODE]: EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION,
    [EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE]: EXPERIMENTAL_NATIVE_BOUNDED_SIZE_OPTIMIZATION
  }[mode];
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

function appendJsonCacheArenaArgs(args, value, schemaCodecsActive) {
  if (value !== undefined && typeof value !== 'boolean') throw new TypeError('elideJsonCacheArena must be a boolean.');
  if (value === true && schemaCodecsActive) args.push('--transform', path.join(__dirname, 'schema-cache-arena-transform.cjs'));
}

module.exports = Object.freeze({
  appendJsonCacheArenaArgs,
  NATIVE_BOUNDED_SIZE_MODE,
  NATIVE_SHRINK0_MODE,
  selectNativeOptimizationMode,
  NATIVE_OPTIMIZATION_VERSION,
  EXPERIMENTAL_NATIVE_SIZE_MODE,
  EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION,
  EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE,
  EXPERIMENTAL_NATIVE_BOUNDED_SIZE_OPTIMIZATION,
  prepareReportCapture: require('./report-capture').prepareReportCapture,
  observeAssemblyScript: require('./build-observation').observeAssemblyScript,
  resolveNativeOptimization,
  appendAssemblyScriptOptimizationArgs
});
