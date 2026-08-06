'use strict';

const ABI_VERSION = 'pulsewasm.wasm-host-abi.v4';
const ABI_PHASE = '12D';

const METHOD_CODES = Object.freeze({
  UNKNOWN: 0,
  GET: 1,
  POST: 2,
  PUT: 3,
  PATCH: 4,
  DELETE: 5,
  OPTIONS: 6,
  HEAD: 7
});

const RESULT_KINDS = Object.freeze({
  RESULT_NONE: 0,
  RESULT_TEXT: 1,
  RESULT_JSON: 2,
  RESULT_BINARY: 3,
  RESULT_EMPTY: 4,
  RESULT_STREAM: 5
});

const NEXT_OUTCOMES = Object.freeze({
  NEXT_NONE: 0,
  NEXT_NORMAL: 1,
  NEXT_ERROR: 2
});

function fn(name, params, returns = 'void', notes = []) {
  return { name, params, returns, notes };
}

function buildWasmHostAbiExportGroups() {
  const memory = [
    fn('memory', [], 'memory', ['Exported linear memory.']),
    fn('pulse_alloc', [{ name: 'byteLength', type: 'i32' }], 'i32', ['Allocates host-visible memory.']),
    fn('pulse_free', [{ name: 'ptr', type: 'i32' }, { name: 'byteLength', type: 'i32' }], 'void', ['Releases memory previously allocated through pulse_alloc when supported.'])
  ];

  const lifecycle = [
    fn('pulse_init', [], 'void', ['Initializes runtime globals.']),
    fn('pulse_reset', [], 'void', ['Clears transient dispatch/result/error state.'])
  ];

  const dispatch = [
    fn('pulse_execute_request', [{ name: 'methodCode', type: 'i32' }, { name: 'pathPtr', type: 'i32' }, { name: 'pathLen', type: 'i32' }], 'i32', ['Executes request routing with a UTF-8 full path.']),
    fn('pulse_execute_connect', [{ name: 'methodCode', type: 'i32' }, { name: 'pathPtr', type: 'i32' }, { name: 'pathLen', type: 'i32' }], 'i32', ['Executes explicit connect lifecycle handlers for the matched scope.']),
    fn('pulse_execute_disconnect', [{ name: 'methodCode', type: 'i32' }, { name: 'pathPtr', type: 'i32' }, { name: 'pathLen', type: 'i32' }], 'i32', ['Executes explicit disconnect lifecycle handlers for the matched scope.'])
  ];

  const result = [
    fn('pulse_result_status', [], 'i32'),
    fn('pulse_result_kind', [], 'i32'),
    fn('pulse_result_body_ref', [], 'i32'),
    fn('pulse_result_body_ptr', [], 'i32'),
    fn('pulse_result_body_len', [], 'i32'),
    fn('pulse_result_headers_ref', [], 'i32'),
    fn('pulse_result_error_ref', [], 'i32'),
    fn('pulse_result_stream_ref', [], 'i32'),
    fn('pulse_result_response_ref', [], 'i32')
  ];

  const headers = [
    fn('pulse_request_header_first', [{ name: 'ctxRef', type: 'i32' }, { name: 'namePtr', type: 'i32' }, { name: 'nameLen', type: 'i32' }], 'i32', ['Returns first matching request header StringRef, or 0.']),
    fn('pulse_request_header_count', [{ name: 'ctxRef', type: 'i32' }, { name: 'namePtr', type: 'i32' }, { name: 'nameLen', type: 'i32' }], 'i32'),
    fn('pulse_request_header_at', [{ name: 'ctxRef', type: 'i32' }, { name: 'namePtr', type: 'i32' }, { name: 'nameLen', type: 'i32' }, { name: 'index', type: 'i32' }], 'i32', ['Returns matching request header StringRef by repeated-header index, or 0.']),
    fn('pulse_response_header_set', [{ name: 'ctxRef', type: 'i32' }, { name: 'namePtr', type: 'i32' }, { name: 'nameLen', type: 'i32' }, { name: 'valuePtr', type: 'i32' }, { name: 'valueLen', type: 'i32' }], 'void'),
    fn('pulse_response_header_append', [{ name: 'ctxRef', type: 'i32' }, { name: 'namePtr', type: 'i32' }, { name: 'nameLen', type: 'i32' }, { name: 'valuePtr', type: 'i32' }, { name: 'valueLen', type: 'i32' }], 'void'),
    fn('pulse_response_header_delete', [{ name: 'ctxRef', type: 'i32' }, { name: 'namePtr', type: 'i32' }, { name: 'nameLen', type: 'i32' }], 'void'),
    fn('pulse_result_header_count', [], 'i32'),
    fn('pulse_result_header_name_ptr', [{ name: 'index', type: 'i32' }], 'i32'),
    fn('pulse_result_header_name_len', [{ name: 'index', type: 'i32' }], 'i32'),
    fn('pulse_result_header_value_ptr', [{ name: 'index', type: 'i32' }], 'i32'),
    fn('pulse_result_header_value_len', [{ name: 'index', type: 'i32' }], 'i32'),
    fn('pulse_result_header_mode', [{ name: 'index', type: 'i32' }], 'i32', ['1 = set/override, 2 = append.']),
    fn('pulse_result_header_delete_count', [], 'i32'),
    fn('pulse_result_header_delete_name_ptr', [{ name: 'index', type: 'i32' }], 'i32'),
    fn('pulse_result_header_delete_name_len', [{ name: 'index', type: 'i32' }], 'i32')
  ];

  const jsonBody = [
    fn('pulse_request_body_text', [{ name: 'ctxRef', type: 'i32' }], 'i32', ['Returns request body text StringRef; body access is explicit and lazy.']),
    fn('pulse_request_body_len', [{ name: 'ctxRef', type: 'i32' }], 'i32'),
    fn('pulse_request_json_parse', [{ name: 'ctxRef', type: 'i32' }], 'i32', ['Returns JsonParseResultRef; parsing errors are explicit, not thrown.']),
    fn('pulse_json_result_ok', [{ name: 'resultRef', type: 'i32' }], 'i32'),
    fn('pulse_json_result_value', [{ name: 'resultRef', type: 'i32' }], 'i32'),
    fn('pulse_json_result_error', [{ name: 'resultRef', type: 'i32' }], 'i32'),
    fn('pulse_json_kind', [{ name: 'valueRef', type: 'i32' }], 'i32'),
    fn('pulse_json_object_has', [{ name: 'valueRef', type: 'i32' }, { name: 'keyPtr', type: 'i32' }, { name: 'keyLen', type: 'i32' }], 'i32'),
    fn('pulse_json_object_get', [{ name: 'valueRef', type: 'i32' }, { name: 'keyPtr', type: 'i32' }, { name: 'keyLen', type: 'i32' }], 'i32'),
    fn('pulse_json_array_len', [{ name: 'valueRef', type: 'i32' }], 'i32'),
    fn('pulse_json_array_get', [{ name: 'valueRef', type: 'i32' }, { name: 'index', type: 'i32' }], 'i32'),
    fn('pulse_json_as_string', [{ name: 'valueRef', type: 'i32' }], 'i32'),
    fn('pulse_json_as_f64', [{ name: 'valueRef', type: 'i32' }], 'f64'),
    fn('pulse_json_as_bool', [{ name: 'valueRef', type: 'i32' }], 'i32'),
    fn('pulse_result_json_text', [{ name: 'ctxRef', type: 'i32' }, { name: 'statusCode', type: 'i32' }, { name: 'jsonPtr', type: 'i32' }, { name: 'jsonLen', type: 'i32' }], 'void', ['Sets RESULT_JSON and Content-Type: application/json.'])
  ];

  const stringRefs = [
    fn('pulse_string_ptr', [{ name: 'stringRef', type: 'i32' }], 'i32'),
    fn('pulse_string_len', [{ name: 'stringRef', type: 'i32' }], 'i32'),
    fn('pulse_string_is_null', [{ name: 'stringRef', type: 'i32' }], 'i32')
  ];

  const ctxOps = [
    fn('pulse_ctx_param', [{ name: 'ctxRef', type: 'i32' }, { name: 'namePtr', type: 'i32' }, { name: 'nameLen', type: 'i32' }], 'i32', ['Returns a StringRef, or 0 when missing.']),
    fn('pulse_ctx_state_get', [{ name: 'ctxRef', type: 'i32' }, { name: 'keyPtr', type: 'i32' }, { name: 'keyLen', type: 'i32' }], 'i32', ['Returns a StringRef, or 0 when missing.']),
    fn('pulse_ctx_state_set', [{ name: 'ctxRef', type: 'i32' }, { name: 'keyPtr', type: 'i32' }, { name: 'keyLen', type: 'i32' }, { name: 'valuePtr', type: 'i32' }, { name: 'valueLen', type: 'i32' }], 'void'),
    fn('pulse_result_text', [{ name: 'ctxRef', type: 'i32' }, { name: 'statusCode', type: 'i32' }, { name: 'bodyPtr', type: 'i32' }, { name: 'bodyLen', type: 'i32' }], 'void'),
    fn('pulse_result_empty', [{ name: 'ctxRef', type: 'i32' }, { name: 'statusCode', type: 'i32' }], 'void'),
    fn('pulse_result_stream', [{ name: 'ctxRef', type: 'i32' }, { name: 'statusCode', type: 'i32' }, { name: 'streamRef', type: 'i32' }], 'void', ['Sets RESULT_STREAM from an opaque host-owned stream ref.']),
    fn('pulse_result_from_response', [{ name: 'ctxRef', type: 'i32' }, { name: 'responseRef', type: 'i32' }], 'void', ['Sets RESULT_STREAM from an opaque host-owned response ref; host preserves/merges status, headers, and stream.']),
    fn('pulse_next', [{ name: 'ctxRef', type: 'i32' }], 'void'),
    fn('pulse_next_error', [{ name: 'ctxRef', type: 'i32' }, { name: 'errorRef', type: 'i32' }], 'void')
  ];

  const errors = [
    fn('pulse_error', [{ name: 'codePtr', type: 'i32' }, { name: 'codeLen', type: 'i32' }, { name: 'messagePtr', type: 'i32' }, { name: 'messageLen', type: 'i32' }, { name: 'statusCode', type: 'i32' }], 'i32'),
    fn('pulse_error_with_cause', [{ name: 'codePtr', type: 'i32' }, { name: 'codeLen', type: 'i32' }, { name: 'messagePtr', type: 'i32' }, { name: 'messageLen', type: 'i32' }, { name: 'statusCode', type: 'i32' }, { name: 'causeRef', type: 'i32' }], 'i32'),
    fn('pulse_error_code_ref', [{ name: 'errorRef', type: 'i32' }], 'i32'),
    fn('pulse_error_message_ref', [{ name: 'errorRef', type: 'i32' }], 'i32'),
    fn('pulse_error_status_code', [{ name: 'errorRef', type: 'i32' }], 'i32'),
    fn('pulse_error_cause_ref', [{ name: 'errorRef', type: 'i32' }], 'i32')
  ];

  const channel = [
    fn('pulse_channel_count', [{ name: 'channelsRef', type: 'i32' }], 'i32'),
    fn('pulse_channel_ref_at', [{ name: 'channelsRef', type: 'i32' }, { name: 'index', type: 'i32' }], 'i32')
  ];

  return { memory, lifecycle, dispatch, result, headers, jsonBody, stringRefs, ctxOps, errors, channel };
}

function flattenWasmHostAbiExports(groups) {
  return Object.entries(groups).flatMap(([group, functions]) => functions.map((item) => ({ group, ...item })));
}

function listWasmHostAbiExports() {
  return flattenWasmHostAbiExports(buildWasmHostAbiExportGroups());
}

module.exports = {
  ABI_VERSION,
  ABI_PHASE,
  METHOD_CODES,
  RESULT_KINDS,
  NEXT_OUTCOMES,
  buildWasmHostAbiExportGroups,
  flattenWasmHostAbiExports,
  listWasmHostAbiExports
};
