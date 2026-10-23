'use strict';

// HEX-01 private experiment, deliberately narrower than a public extension API.
// Trusted package source is not sandboxed. This provider owns the terminal service.
const { createHash } = require('node:crypto');
const digest = source => createHash('sha256').update(source).digest('hex');
function fail(message) { throw new Error(`HEX-01 host extension: ${message}`); }
function matches(effect, artifact) {
  return artifact.kind === 'host-extension-proof' && artifact.package === effect.package
    && artifact.contractId === effect.contractId && artifact.data?.operation === effect.operation;
}
function select(plan, options = {}) {
  const effects = plan.effects || [];
  const used = effects.filter(effect => effect.kind === 'host.extension');
  if (!used.length) return [];
  // A single ordinary direct-return site bounds the proof. No scheduler/composition claim.
  if (used.length !== 1 || effects.length !== 1 || used[0].grouped || used[0].result?.mode !== 'return'
    || !used[0].statementPath.startsWith('entry.body') || (plan.helpers || []).length
    || options.bodyForwarding || options.guestUnits?.length || plan.handlers?.length || plan.logging?.enabledStatements) fail('only one ordinary direct terminal effect is admitted.');
  function expression(value) {
    if (!value || typeof value !== 'object') return;
    if (!['literal', 'context-read', 'binary', 'intrinsic'].includes(value.kind)) fail('unsupported expression in the terminal proof.');
    if (value.kind === 'context-read' && !['req.path', 'req.method', 'req.url'].includes(value.path.join('.'))) fail('request mutation/body/state is outside this proof.');
    if (value.kind === 'intrinsic' && value.name !== 'response.text') fail('only a plain text response control is admitted beside the handoff.');
    for (const child of [value.left, value.right, ...(value.arguments || [])]) if (child) expression(child);
  }
  function statements(body) {
    for (const statement of body) {
      if (statement.kind === 'if') { expression(statement.test); statements(statement.then); statements(statement.else); }
      else if (statement.kind === 'return') expression(statement.value);
      else if (statement.kind !== 'effect') fail('only pure route conditions, terminal return and a text response control are admitted.');
    }
  }
  statements(plan.entry.body);
  const effect = used[0];
  const candidates = (options.realizationArtifacts || []).filter(artifact => matches(effect, artifact));
  if (candidates.length !== 1) fail(`${effect.package}.${effect.operation} requires exactly one owned contribution.`);
  const artifact = candidates[0], data = artifact.data;
  if (artifact.version !== 'pulse.host-extension-proof.v0' || artifact.mediaType !== 'text/assemblyscript'
    || data.target !== 'fastly-compute-native' || data.service !== 'terminal-request-backend.v0'
    || !/^__[a-zA-Z0-9_]+$/.test(data.entry) || typeof data.source !== 'string'
    || digest(data.source) !== data.sha256 || !Array.isArray(data.imports) || data.imports.length !== 1)
    fail('unsupported contribution identity, target, service or source digest.');
  const declaration = data.imports[0];
  if (typeof declaration.module !== 'string' || typeof declaration.name !== 'string'
    || JSON.stringify(declaration.parameters) !== '["i32","i32","i32"]'
    || JSON.stringify(declaration.results) !== '["i32"]') fail('terminal service requires (i32, i32, i32) -> i32.');
  const key = effect.resource?.value;
  const backend = (options.bindings || options).backends?.[key];
  if (typeof key !== 'string' || typeof backend !== 'string' || !backend || backend.includes('\0'))
    fail(`${effect.package}.${effect.operation} requires a configured static backend binding.`);
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
export function pulse_extension_state(): i32 { return __pulse_extension_state }
export function pulse_extension_status(): i32 { return __pulse_extension_status }
function __pulse_extension_begin(effectIndex: i32): void {
  if (__pulse_extension_state != 0 || effectIndex != ${index}) { __pulse_fastly_fail(PULSE_ERROR_STATE, 280, effectIndex); return }
  const backend = __pulse_fastly_utf8(${JSON.stringify(backend)})
  // Allocate before dispatch, while we still own downstream response authority.
  const value = new __PulseFastlyValue()
  value.kind = 9 // private provider completion token, never an authored value
  __pulse_extension_token = __pulse_fastly_put(value)
  if (__pulse_extension_token <= 0 || __pulse_fastly_last_error != 0) return
  __pulse_extension_state = 1
  __pulse_extension_status = ${artifact.data.entry}(__pulse_fastly_request_handle, changetype<usize>(backend), backend.byteLength)
  if (__pulse_extension_status != 0) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 281, effectIndex); return }
  __pulse_extension_state = 2
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
  // Apply last so body/deadline/fetch error responders cannot precede this fence.
  replace('function __pulse_fastly_jwt_send_error(): void {', 'function __pulse_fastly_jwt_send_error(): void {\n  if (__pulse_extension_state != 0) return;');
  replace('function __pulse_fastly_send_result(handle: i32): i32 {', 'function __pulse_fastly_send_result(handle: i32): i32 { if (__pulse_extension_state != 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 282, -1); return PULSE_ERROR_STATE; }');
  replace('  __pulse_fastly_jwt_attach_evidence(result)', `  if (__pulse_extension_state != 0) {
    if (__pulse_extension_state != 2 || result != __pulse_extension_token) { __pulse_fastly_fail(PULSE_ERROR_STATE, 283, -1); return }
    __pulse_extension_state = 3
    return
  }
  __pulse_fastly_jwt_attach_evidence(result)`);
  return output;
}
function imports(selected) { return selected.flatMap(item => item.artifact.data.imports); }
// Read real Wasm type/import sections, not just source annotations or WAT strings.
function auditSignatures(bytes, selected) {
  if (!selected.length) return;
  let p = 8;
  const types = [], signatures = new Map();
  const leb = () => { let n = 0, shift = 0; for (let i = 0; i < 5 && p < bytes.length; i++) { const b = bytes[p++]; n += (b & 127) * 2 ** shift; if (!(b & 128)) return n; shift += 7; } fail('invalid Wasm integer.'); };
  const name = () => { const n = leb(); const s = bytes.toString('utf8', p, p+n); p += n; return s; };
  const vector = () => Array.from({ length: leb() }, () => bytes[p++]);
  while (p < bytes.length) {
    const id = bytes[p++], size = leb(), end = p + size;
    if (id === 1) for (let n = leb(); n > 0; n--) { if (bytes[p++] !== 0x60) fail('unsupported Wasm type.'); types.push([vector(), vector()]); }
    if (id === 2) for (let n = leb(); n > 0; n--) {
      const module = name(), field = name(), kind = bytes[p++];
      if (kind !== 0) fail('proof accepts function imports only.');
      signatures.set(`${module}:${field}`, types[leb()]);
    }
    p = end;
  }
  for (const declaration of imports(selected)) {
    const actual = signatures.get(`${declaration.module}:${declaration.name}`);
    if (JSON.stringify(actual) !== '[[127,127,127],[127]]') fail('emitted import is missing or has a conflicting ABI signature.');
  }
}
module.exports = { select, matches, source, instrument, imports, auditSignatures };
