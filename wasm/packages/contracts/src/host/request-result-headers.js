'use strict';

const REQUEST_RESULT_HEADERS_VERSION = 'pulsewasm.request-result-headers.v2';
const REQUEST_RESULT_HEADERS_PHASE = '12D';

const HEADER_ABI_EXPORTS = Object.freeze([
  'pulse_request_header_first(ctxRef, namePtr, nameLen) -> StringRef',
  'pulse_request_header_count(ctxRef, namePtr, nameLen) -> i32',
  'pulse_request_header_at(ctxRef, namePtr, nameLen, index) -> StringRef',
  'pulse_response_header_set(ctxRef, namePtr, nameLen, valuePtr, valueLen) -> void',
  'pulse_response_header_append(ctxRef, namePtr, nameLen, valuePtr, valueLen) -> void',
  'pulse_response_header_delete(ctxRef, namePtr, nameLen) -> void',
  'pulse_result_header_count() -> i32',
  'pulse_result_header_name_ptr(index) -> i32',
  'pulse_result_header_name_len(index) -> i32',
  'pulse_result_header_value_ptr(index) -> i32',
  'pulse_result_header_value_len(index) -> i32',
  'pulse_result_header_mode(index) -> i32',
  'pulse_result_header_delete_count() -> i32',
  'pulse_result_header_delete_name_ptr(index) -> i32',
  'pulse_result_header_delete_name_len(index) -> i32'
]);

function handlerVisibleHeaderAbiExports() {
  return HEADER_ABI_EXPORTS.slice(0, 6);
}

function hostResultHeaderAbiExports() {
  return HEADER_ABI_EXPORTS.slice(6);
}

module.exports = {
  REQUEST_RESULT_HEADERS_VERSION,
  REQUEST_RESULT_HEADERS_PHASE,
  HEADER_ABI_EXPORTS,
  handlerVisibleHeaderAbiExports,
  hostResultHeaderAbiExports
};
