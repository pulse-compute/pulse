'use strict';

// The provider owns the terminal service. Package selection and ABI admission
// use the shared contribution contract; trusted source is not sandboxed.
const contract = require('@pulse-compute/wasm-contracts/provider/toolchain').hostExtensions;
const ADMISSION = contract.normalizeAdmission({ version: contract.ADMISSION_VERSION,
  protocols: [contract.VERSION], services: [contract.TERMINAL_SERVICE] });
const TARGET = Object.freeze({ provider: 'fastly', target: 'native', targetId: 'fastly-compute-native', hostExtensions: ADMISSION });
function fail(message, operation) { contract.fail('PLACEMENT', message, operation); }
const matches = contract.matches;
function validateBinding(effect, bindings = {}) {
  const key = effect.resource?.value;
  const backend = effect.resource?.kind === 'literal' && (bindings.backends || {})[key];
  if (typeof key !== 'string' || typeof backend !== 'string' || !backend || backend.includes('\0'))
    contract.fail('BINDING', `${effect.package}.${effect.operation} requires a configured static backend binding.`, effect);
  return backend;
}
function select(plan, options = {}) {
  const effects = plan.effects || [];
  const used = effects.filter(effect => effect.kind === 'host.extension');
  if (!used.length) return [];
  const reject = message => fail(message, used[0]);
  // A single ordinary direct-return site bounds the proof. No scheduler/composition claim.
  if (used.length !== 1 || effects.length !== 1 || used[0].grouped || used[0].result?.mode !== 'return'
    || !used[0].statementPath.startsWith('entry.body') || (plan.helpers || []).length || (plan.callables || []).length
    || options.bodyForwarding || options.guestUnits?.length || plan.handlers?.length || plan.routing?.entries?.length || plan.packages?.application || plan.logging?.enabledStatements) reject('only one ordinary direct terminal effect is admitted.');
  function expression(value) {
    if (!value || typeof value !== 'object') return;
    if (!['literal', 'context-read', 'binary', 'intrinsic'].includes(value.kind)) reject('unsupported expression in the terminal proof.');
    if (value.kind === 'context-read' && !['req.path', 'req.method', 'req.url'].includes(value.path.join('.'))) reject('request mutation/body/state is outside this proof.');
    if (value.kind === 'intrinsic' && value.name !== 'response.text') reject('only a plain text response control is admitted beside the handoff.');
    for (const child of [value.left, value.right, ...(value.arguments || [])]) if (child) expression(child);
  }
  function statements(body) {
    for (const statement of body) {
      if (statement.kind === 'if') { expression(statement.test); statements(statement.then); statements(statement.else); }
      else if (statement.kind === 'return') expression(statement.value);
      else if (statement.kind !== 'effect') reject('only pure route conditions, terminal return and a text response control are admitted.');
    }
  }
  statements(plan.entry.body);
  const effect = used[0];
  const [artifact] = contract.select(used, options.realizationArtifacts || [], TARGET);
  const data = artifact.data;
  if (data.service !== contract.TERMINAL_SERVICE || data.imports.length !== 1
    || JSON.stringify(data.imports[0].parameters) !== '["i32","i32","i32"]'
    || JSON.stringify(data.imports[0].results) !== '["i32"]')
    contract.fail('SIGNATURE', 'The terminal backend service requires (i32, i32, i32) -> i32.', effect);
  const backend = validateBinding(effect, options.bindings || options);
  return Object.freeze([Object.freeze({ artifact, effect, index: effects.indexOf(effect), backend })]);
}
function source(selected) {
  if (!selected.length) return '';
  const { artifact, backend, index } = selected[0];
  return `
${artifact.data.source}
// 0 owned, 1 dispatch outcome unknown, 2 transferred, 3 completed. Never retry.
let __pulse_extension_state: i32 = 0
let __pulse_extension_status: i32 = -1
let __pulse_extension_token: i32 = 0
let __pulse_extension_invocation: i32 = 0
let __pulse_extension_delivering: bool = false
let __pulse_extension_settled: bool = false
let __pulse_extension_handles_owned: bool = false
function __pulse_extension_cleanup(): void {
  // This service borrows the request handle. Status zero transfers downstream
  // response authority, not ownership of these local request/body handles.
  // Nonzero/trapped dispatch remains uncertain and is left to host teardown.
  if (!__pulse_extension_handles_owned || __pulse_extension_state == 1) return
  __pulse_extension_handles_owned = false
  const request = __pulse_fastly_request_handle, body = __pulse_fastly_request_body_handle
  __pulse_fastly_request_handle = -1
  __pulse_fastly_request_body_handle = -1
  const requestStatus = __pulse_fetch_close_request(request)
  const bodyStatus = __pulse_fetch_close_body(body)
  if (requestStatus != 0 || bodyStatus != 0) __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 285, ${index})
}
export function pulse_extension_state(): i32 { return __pulse_extension_state }
export function pulse_extension_status(): i32 { return __pulse_extension_status }
function __pulse_extension_begin(effectIndex: i32): void {
  if (__pulse_extension_state != 0 || effectIndex != ${index} || !__pulse_invocation_started || __pulse_invocation_closed || __pulse_fastly_last_error != 0 || unchecked(__pulse_invocation_tickets[effectIndex]) <= 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 280, effectIndex); return }
  const backend = __pulse_fastly_utf8(${JSON.stringify(backend)})
  // Allocate before dispatch, while we still own downstream response authority.
  const value = new __PulseFastlyValue()
  value.kind = 9 // private provider completion token, never an authored value
  __pulse_extension_token = __pulse_fastly_put(value)
  if (__pulse_extension_token <= 0 || __pulse_fastly_last_error != 0) return
  // Recheck the shared request budget immediately before crossing the ABI.
  if (!__pulse_fetch_request_check(effectIndex) || __pulse_invocation_closed || __pulse_fastly_last_error != 0) return
  __pulse_extension_invocation = unchecked(__pulse_invocation_tickets[effectIndex])
  __pulse_extension_state = 1
  __pulse_extension_status = ${artifact.data.entry}(__pulse_fastly_request_handle, changetype<usize>(backend), backend.byteLength)
  if (__pulse_extension_status != 0) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 281, effectIndex); return }
  __pulse_extension_state = 2
  __pulse_extension_cleanup()
  if (__pulse_invocation_closed || __pulse_fastly_last_error != 0) return
  __pulse_fastly_ready_effect(effectIndex, __pulse_extension_token)
}
`;
}
function instrument(input, selected) {
  if (!selected.length) return input;
  let output = input;
  function replace(from, to) {
    if (!output.includes(from)) fail(`provider boundary drift: ${from}`);
    output = output.replace(from, to);
  }
  const index = selected[0].index;
  replace('  __pulse_fastly_request_body_handle = load<i32>(changetype<usize>(handles) + 4)',
    '  __pulse_fastly_request_body_handle = load<i32>(changetype<usize>(handles) + 4)\n  __pulse_extension_handles_owned = true');
  // Authenticate the terminal value before the ordinary invocation consumes its
  // ticket. A raw exported setter is not authority to complete this operation.
  replace('function __pulse_invocation_settle(index: i32, ticket: i32, result: i32): i32 {',
    `function __pulse_invocation_settle(index: i32, ticket: i32, result: i32): i32 {
  if (index == ${index} && (__pulse_extension_state != 2 || __pulse_extension_settled || ticket != __pulse_extension_invocation || result != __pulse_extension_token || result <= 0)) {
    __pulse_fastly_fail(PULSE_ERROR_STATE, 284, index); return 0
  }`);
  replace('return pulse_set_effect_result(index, result)', `__pulse_extension_delivering = index == ${index}
  const accepted = pulse_set_effect_result(index, result)
  __pulse_extension_delivering = false
  if (index == ${index} && accepted == 1) __pulse_extension_settled = true
  return accepted`);
  replace('export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {',
    `export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {
  if (effectIndex == ${index} && (!__pulse_extension_delivering || __pulse_extension_state != 2 || __pulse_extension_settled || handle != __pulse_extension_token || __pulse_invocation_closed)) {
    __pulse_fastly_fail(PULSE_ERROR_STATE, 284, effectIndex); return 0
  }`);
  replace('function __pulse_invocation_close(): void {', `function __pulse_invocation_close(): void {
  __pulse_extension_cleanup()
  __pulse_extension_token = 0
  __pulse_extension_invocation = 0
  __pulse_extension_delivering = false`);
  // Apply last so body/deadline/fetch error responders cannot precede this fence.
  if (output.includes('function __request_send_timeout(): void {')) {
    replace('function __request_send_timeout(): void {', 'function __request_send_timeout(): void {\n  if (__pulse_extension_state != 0) return;');
  }
  replace('function __pulse_fastly_jwt_send_error(): void {', 'function __pulse_fastly_jwt_send_error(): void {\n  if (__pulse_extension_state != 0) return;');
  replace('function __pulse_fastly_send_result(handle: i32): i32 {', 'function __pulse_fastly_send_result(handle: i32): i32 { if (__pulse_extension_state != 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 282, -1); return PULSE_ERROR_STATE; }');
  replace('  __pulse_fastly_jwt_attach_evidence(result)', `  if (__pulse_extension_state != 0) {
    if (__pulse_extension_state != 2 || !__pulse_extension_settled || result != __pulse_extension_token || __pulse_extension_token <= 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 283, -1); return }
    __pulse_extension_state = 3
    __pulse_extension_token = 0
    return
  }
  __pulse_fastly_jwt_attach_evidence(result)`);
  return output;
}
function imports(selected) { return selected.flatMap(item => item.artifact.data.imports); }
function policy(selected, baseline) {
  return contract.composeImportPolicy(baseline.map(([module, name]) => ({ module, name, kind: 'function' })), selected.map(item => item.artifact));
}
function auditSignatures(bytes, selected, baseline) {
  if (!selected.length) return;
  return contract.auditWasm(bytes, policy(selected, baseline));
}
module.exports = { ADMISSION, TARGET, validateBinding, select, matches, source, instrument, imports, policy, auditSignatures };
