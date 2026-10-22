"use strict";
const { PulseProjectError } = require('./project-error');
function selectedNativeOptimization(options = {}, project = {}) {
  const { selectNativeOptimizationMode } = require('@pulse-compute/wasm-contracts/project/native-optimization');
  try { return selectNativeOptimizationMode(options, project.nativeOptimization); }
  catch (error) { throw new PulseProjectError('PULSE_ARGUMENT_UNEXPECTED', error.message); }
}
function hasNativeOptimization(options = {}) {
  return options.nativeShrink0 === true || options.experimentalNativeSize === true
    || options.experimentalNativeBoundedSize === true || options.nativeOptimization !== undefined;
}
module.exports = { selectedNativeOptimization, hasNativeOptimization };
