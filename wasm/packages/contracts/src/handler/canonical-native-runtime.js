'use strict';

const CANONICAL_NATIVE_WASM_VERSION = 'pulse.canonical-native-wasm.v2';
const CANONICAL_NATIVE_ABI_VERSION = 2;
const CANONICAL_NATIVE_AS_GENERATOR_VERSION = 'pulse.canonical-native-as-generator.v4';
const CANONICAL_NATIVE_COMPILER_VERSION = 'pulse.canonical-native-wasm-compiler.v3';
const CANONICAL_NATIVE_HOST_VERSION = 'pulse.canonical-native-host.v4';

const CANONICAL_NATIVE_RUN_STATUS = Object.freeze({
  COMPLETE: 0,
  SUSPENDED: 1,
  FAILED: -1,
  INVALID_RESUME: -2
});

const CANONICAL_NATIVE_RESULT_STATUS = Object.freeze({
  REJECTED: 0,
  ACCEPTED: 1
});

const CANONICAL_NATIVE_ERROR_CODES = Object.freeze({
  NONE: 0,
  INVALID_START: 1,
  INCOMPLETE_RESUME: 2,
  INVALID_EFFECT_RESULT: 3,
  FALLTHROUGH_WITHOUT_RESULT: 4,
  HOST_FAILURE: 5,
  INVALID_PROGRAM_COUNTER: 6
});

const CANONICAL_NATIVE_BINARY_OPERATORS = Object.freeze([
  '===', '!==', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', '**',
  '&&', '||', '??', '&', '|', '^', '<<', '>>', '>>>', 'in'
]);

const CANONICAL_NATIVE_UNARY_OPERATORS = Object.freeze([
  '!', '+', '-', '~', 'typeof', 'void'
]);

const CANONICAL_NATIVE_ASSIGNMENT_OPERATORS = Object.freeze([
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '&=', '|=', '^=', '<<=', '>>=', '>>>='
]);

const CANONICAL_NATIVE_IMPORT_MODULE = 'pulse_host';
const CANONICAL_NATIVE_ALLOWED_ENV_IMPORTS = Object.freeze(['abort', 'seed']);
const CANONICAL_NATIVE_IMPORTS = Object.freeze([
  ['value_undefined', [], ['i32']],
  ['value_null', [], ['i32']],
  ['value_boolean', ['i32'], ['i32']],
  ['value_number', ['f64'], ['i32']],
  ['value_string', ['i32', 'i32'], ['i32']],
  ['value_array', [], ['i32']],
  ['value_array_push', ['i32', 'i32'], []],
  ['value_array_spread', ['i32', 'i32'], []],
  ['value_object', [], ['i32']],
  ['value_object_set', ['i32', 'i32', 'i32'], []],
  ['value_object_spread', ['i32', 'i32'], []],
  ['value_property', ['i32', 'i32'], ['i32']],
  ['value_property_set', ['i32', 'i32', 'i32'], ['i32']],
  ['value_element', ['i32', 'i32'], ['i32']],
  ['value_element_set', ['i32', 'i32', 'i32'], ['i32']],
  ['value_binary', ['i32', 'i32', 'i32'], ['i32']],
  ['value_unary', ['i32', 'i32'], ['i32']],
  ['value_truthy', ['i32'], ['i32']],
  ['value_nullish', ['i32'], ['i32']],
  ['value_string_trim', ['i32'], ['i32']],
  ['log', ['i32', 'i32'], []],
  ['request_method', [], ['i32']],
  ['request_url', [], ['i32']],
  ['request_path', [], ['i32']],
  ['request_headers', [], ['i32']],
  ['request_header', ['i32'], ['i32']],
  ['request_text', [], ['i32']],
  ['request_json', ['i32'], ['i32']],
  ['router_match', ['i32', 'i32'], ['i32']],
  ['router_param', ['i32', 'i32', 'i32'], ['i32']],
  // 0: no failure; positive: application error handle; negative: terminal failure.
  ['router_error_take', [], ['i32']],
  ['response_json', ['i32', 'i32'], ['i32']],
  ['schema_encode', ['i32', 'i32'], ['i32']],
  ['schema_decode', ['i32', 'i32'], ['i32']],
  ['response_text', ['i32', 'i32'], ['i32']],
  ['response_custom', ['i32'], ['i32']],
  ['grip_is_websocket', [], ['i32']],
  ['grip_subscribe', ['i32', 'i32'], ['i32']],
  ['grip_handoff', ['i32'], ['i32']],
  ['kv_namespace', ['i32'], ['i32']],
  ['fetch_json', ['i32', 'i32'], ['i32']],
  ['fetch_text', ['i32'], ['i32']],
  ['fetch_header', ['i32', 'i32'], ['i32']],
  ['effect_begin', ['i32', 'i32'], []]
]);

const CANONICAL_NATIVE_EXPORTS = Object.freeze([
  ['memory', 'memory'],
  ['pulse_abi_version', [], ['i32']],
  ['pulse_plan_hash_ptr', [], ['i32']],
  ['pulse_plan_hash_length', [], ['i32']],
  ['pulse_start', [], ['i32']],
  ['pulse_resume', [], ['i32']],
  ['pulse_set_effect_result', ['i32', 'i32'], ['i32']],
  ['pulse_result_handle', [], ['i32']],
  ['pulse_program_counter', [], ['i32']],
  ['pulse_continuation_state', [], ['i32']],
  ['pulse_last_error_code', [], ['i32']],
  ['pulse_pending_count', [], ['i32']]
]);

const CANONICAL_NATIVE_SCHEMA_EXPORTS = Object.freeze([
  ['__new', ['i32', 'i32'], ['i32']],
  ['__pin', ['i32'], ['i32']],
  ['__unpin', ['i32'], []],
  ['pulse_schema_string_id', [], ['i32']],
  ['pulse_schema_decode', ['i32', 'i32'], ['i32']],
  ['pulse_schema_encode', ['i32', 'i32'], ['i32']]
]);

const CANONICAL_NATIVE_IMPORT_NAMES = Object.freeze(CANONICAL_NATIVE_IMPORTS.map(([name]) => name));
const CANONICAL_NATIVE_EXPORT_NAMES = Object.freeze(CANONICAL_NATIVE_EXPORTS.map(([name]) => name));
const CANONICAL_NATIVE_SCHEMA_EXPORT_NAMES = Object.freeze(CANONICAL_NATIVE_SCHEMA_EXPORTS.map(([name]) => name));

// Canonical compilation produces a Pulse host-ABI module before provider
// packaging. Its imports are checked independently of the final provider ABI.
const { defineFinalWasmPolicy, FINAL_WASM_POLICY_VERSION } = require('../provider/final-wasm-policy.js');
const CANONICAL_NATIVE_FINAL_WASM_POLICY = defineFinalWasmPolicy({
  version: FINAL_WASM_POLICY_VERSION,
  descriptorOwner: '@pulse-compute/wasm-contracts',
  toolchainVersion: 'pulse.provider-toolchain.v1',
  descriptorIdentity: 'pulse-canonical-native-host',
  permittedImports: [
    ...CANONICAL_NATIVE_IMPORT_NAMES.map(name => ({ module: 'pulse_host', name, kind: 'function' })),
    ...CANONICAL_NATIVE_ALLOWED_ENV_IMPORTS.map(name => ({ module: 'env', name, kind: 'function' }))
  ],
  requiredExports: CANONICAL_NATIVE_EXPORTS.map(([name, second]) => ({ name, kind: second === 'memory' ? 'memory' : 'function' }))
});

const CANONICAL_NATIVE_DIAGNOSTIC_CODES = Object.freeze({
  PLAN_REQUIRED: 'PULSE_CANONICAL_NATIVE_WASM_PLAN_REQUIRED',
  PLAN_INVALID: 'PULSE_CANONICAL_NATIVE_WASM_PLAN_INVALID',
  STATEMENT_UNSUPPORTED: 'PULSE_CANONICAL_NATIVE_WASM_STATEMENT_UNSUPPORTED',
  EXPRESSION_UNSUPPORTED: 'PULSE_CANONICAL_NATIVE_WASM_EXPRESSION_UNSUPPORTED',
  LOCAL_UNRESOLVED: 'PULSE_CANONICAL_NATIVE_WASM_LOCAL_UNRESOLVED',
  EFFECT_UNRESOLVED: 'PULSE_CANONICAL_NATIVE_WASM_EFFECT_UNRESOLVED',
  ASSEMBLYSCRIPT_MISSING: 'PULSE_CANONICAL_NATIVE_WASM_ASC_MISSING',
  ASSEMBLYSCRIPT_FAILED: 'PULSE_CANONICAL_NATIVE_WASM_ASC_FAILED',
  WASM_INVALID: 'PULSE_CANONICAL_NATIVE_WASM_INVALID',
  ABI_INVALID: 'PULSE_CANONICAL_NATIVE_WASM_ABI_INVALID'
});

const CANONICAL_NATIVE_POLICY = Object.freeze({
  providerNeutral: true,
  providerSelected: false,
  javascriptRuntime: false,
  asyncify: false,
  promiseSemantics: false,
  valueOwnership: 'host-owned opaque i32 handles; generated Wasm owns control flow and local identities',
  controlFlow: 'generated AssemblyScript state machine with stable basic blocks',
  suspension: 'effect_begin records descriptors before one explicit suspension boundary; results are injected before pulse_resume',
  groupedEffects: 'all group members begin before one suspension boundary and all results must be ready before resume',
  incompleteResume: 'rejected without advancing the program counter or consuming available results',
  resultFreshness: 'managed hosts authenticate single-use invocation tickets; raw ABI v2 index/handle exports are trusted-host operations',
  authority: 'request data and consequential effects remain host-owned; guest control flow remains authoritative',
  schemaJson: 'normalized registry IR generates json-as 1.5.0 guest codecs; host preflight enforces shared policy and structured errors',
  schemaBodyOwnership: 'request and fetched-response bytes are snapshotted once; application JSON values are encoded before suspension'
});

module.exports = Object.freeze({
  CANONICAL_NATIVE_WASM_VERSION,
  CANONICAL_NATIVE_ABI_VERSION,
  CANONICAL_NATIVE_AS_GENERATOR_VERSION,
  CANONICAL_NATIVE_COMPILER_VERSION,
  CANONICAL_NATIVE_HOST_VERSION,
  CANONICAL_NATIVE_RUN_STATUS,
  CANONICAL_NATIVE_RESULT_STATUS,
  CANONICAL_NATIVE_ERROR_CODES,
  CANONICAL_NATIVE_BINARY_OPERATORS,
  CANONICAL_NATIVE_UNARY_OPERATORS,
  CANONICAL_NATIVE_ASSIGNMENT_OPERATORS,
  CANONICAL_NATIVE_IMPORT_MODULE,
  CANONICAL_NATIVE_ALLOWED_ENV_IMPORTS,
  CANONICAL_NATIVE_IMPORTS,
  CANONICAL_NATIVE_IMPORT_NAMES,
  CANONICAL_NATIVE_EXPORTS,
  CANONICAL_NATIVE_EXPORT_NAMES,
  CANONICAL_NATIVE_SCHEMA_EXPORTS,
  CANONICAL_NATIVE_SCHEMA_EXPORT_NAMES,
  CANONICAL_NATIVE_DIAGNOSTIC_CODES,
  CANONICAL_NATIVE_POLICY,
  CANONICAL_NATIVE_FINAL_WASM_POLICY
});
