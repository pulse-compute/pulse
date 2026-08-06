'use strict';

const {
  NATIVE_OPTIMIZATION_VERSION,
  EXPERIMENTAL_NATIVE_SIZE_MODE
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

function resolveNativeOptimization(value) {
  if (value === undefined || value === null || value === false) return undefined;
  if (
    value === true
    || value === EXPERIMENTAL_NATIVE_SIZE_MODE
    || (typeof value === 'object' && value.mode === EXPERIMENTAL_NATIVE_SIZE_MODE)
  ) {
    return EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION;
  }
  throw new TypeError(`Unsupported Pulse Native optimization mode ${String(value && value.mode || value)}.`);
}

function appendAssemblyScriptOptimizationArgs(args, value) {
  if (!Array.isArray(args)) throw new TypeError('AssemblyScript optimization arguments require a mutable argument array.');
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
  resolveNativeOptimization,
  appendAssemblyScriptOptimizationArgs
});
