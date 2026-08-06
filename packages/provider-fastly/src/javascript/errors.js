'use strict';

const runtimeHost = require('@pulse-compute/runtime/host');

const FASTLY_JAVASCRIPT_PROVIDER_ERROR_VERSION = 'pulse.fastly-javascript-provider-error.v1';

function fastlyJavascriptProviderError(code, message, detail = {}, cause) {
  const safeDetail = {
    ...detail,
    ...(cause && typeof cause.name === 'string' ? { causeName: cause.name } : {})
  };
  return new runtimeHost.PulseRuntimeContractError(code, message, {
    detail: Object.freeze(safeDetail)
  });
}

function isPulseRuntimeError(error) {
  return error instanceof runtimeHost.PulseRuntimeContractError
    || Boolean(error && typeof error.code === 'string' && error.code.startsWith('PULSE_'));
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_PROVIDER_ERROR_VERSION,
  fastlyJavascriptProviderError,
  isPulseRuntimeError
});
