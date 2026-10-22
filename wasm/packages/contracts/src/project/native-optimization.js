'use strict';

const NATIVE_OPTIMIZATION_VERSION = 'pulse.native-optimization.v1';
const NATIVE_BOUNDED_SIZE_MODE = 'native-bounded-size';
const NATIVE_SHRINK0_MODE = 'native-shrink0';
const EXPERIMENTAL_NATIVE_SIZE_MODE = 'experimental-native-size';
const EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE = 'experimental-native-bounded-size';

const NATIVE_OPTIMIZATION_MODES = Object.freeze([
  NATIVE_BOUNDED_SIZE_MODE, NATIVE_SHRINK0_MODE,
  EXPERIMENTAL_NATIVE_SIZE_MODE, EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE
]);

function selectNativeOptimizationMode(options = {}, configured) {
  const selected = [
    ['nativeShrink0', NATIVE_SHRINK0_MODE],
    ['experimentalNativeSize', EXPERIMENTAL_NATIVE_SIZE_MODE],
    ['experimentalNativeBoundedSize', EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE]
  ].filter(([key]) => {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new TypeError(`${key} must be a boolean.`);
    }
    return options[key] === true;
  });
  if (selected.length > 1) throw new TypeError('Select only one Native optimization flag.');
  const value = selected[0]?.[1] ?? options.nativeOptimization ?? configured;
  if (value === undefined || value === null || value === false) return NATIVE_BOUNDED_SIZE_MODE;
  if (value === true) return EXPERIMENTAL_NATIVE_SIZE_MODE;
  const mode = typeof value === 'object' ? value.mode : value;
  if (!NATIVE_OPTIMIZATION_MODES.includes(mode)) throw new TypeError(`Unsupported Pulse Native optimization mode ${String(mode)}.`);
  return mode;
}

module.exports = Object.freeze({
  NATIVE_BOUNDED_SIZE_MODE,
  NATIVE_SHRINK0_MODE,
  NATIVE_OPTIMIZATION_MODES,
  selectNativeOptimizationMode,
  NATIVE_OPTIMIZATION_VERSION,
  EXPERIMENTAL_NATIVE_SIZE_MODE,
  EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE
});
