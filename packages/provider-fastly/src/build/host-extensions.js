'use strict';

// The provider owns the terminal service. Package selection and ABI admission
// use the shared contribution contract; trusted source is not sandboxed.
const contract = require('@pulse-compute/wasm-contracts/provider/toolchain').hostExtensions;
const { CANONICAL_NATIVE_VALUE_TRANSFER_MAX_BYTES } = require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime');
const MAX_BACKEND_BYTES = Math.min(1024, CANONICAL_NATIVE_VALUE_TRANSFER_MAX_BYTES);
const { STATES } = require('./response-authority.js');
const ADMISSION = contract.normalizeAdmission({ version: contract.ADMISSION_VERSION,
  protocols: [contract.VERSION], services: [contract.TERMINAL_SERVICE] });
const TARGET = Object.freeze({ provider: 'fastly', target: 'native', targetId: 'fastly-compute-native', hostExtensions: ADMISSION });
function fail(message, operation) { contract.fail('PLACEMENT', message, operation); }
const matches = contract.matches;
function validateBinding(effect, bindings = {}) {
  const key = effect.resource?.value;
  const backend = effect.resource?.kind === 'literal' && (bindings.backends || {})[key];
  if (typeof key !== 'string' || typeof backend !== 'string' || !backend || backend.includes('\0') || Buffer.byteLength(backend) > MAX_BACKEND_BYTES)
    contract.fail('BINDING', `${effect.package}.${effect.operation} requires a configured static backend binding.`, effect);
  return backend;
}
function select(plan, options = {}) {
  const effects = plan.effects || [];
  const used = effects.filter(effect => effect.kind === 'host.extension');
  if (!used.length) return [];
  const reject = message => fail(message, used[0]);
  // Reuse the canonical Router dispatcher and private terminal-route bodies.
  // Admission bounds authored behavior; no new scheduler or package special case.
  const routed = plan.entry?.kind === 'router';
  if (used.length !== 1 || effects.length !== 1 || used[0].grouped || used[0].result?.mode !== 'return'
    || used[0].declaredResult !== 'host-terminal'
    || (plan.helpers || []).length || (plan.callables || []).length || (plan.stages || []).length
    || options.bodyForwarding || options.bindings?.dynamicBackends || options.guestUnits?.length
    || plan.packages?.application || plan.logging?.enabledStatements)
    reject('only one direct terminal effect without surrounding effects or composition is admitted.');
  const handlers = new Map((plan.handlers || []).map(handler => [handler.id, handler]));
  const entries = plan.routing?.entries || [];
  if (routed) {
    if (!entries.length || entries.length !== handlers.size
      || entries.some(entry => entry.kind !== 'route' || entry.nativeBody?.family !== 'terminal-route'
        || !handlers.has(entry.stableId))
      || used[0].routerEntryKind !== 'route' || !handlers.has(used[0].routerEntryStableId)
      || !used[0].statementPath?.startsWith(`handlers.${used[0].routerEntryStableId}.body[`))
      reject('terminal Router placement requires private route bodies without middleware or error composition.');
  } else if (plan.entry?.kind !== 'handler' || handlers.size || entries.length
    || !used[0].statementPath?.startsWith('entry.body[')) {
    reject('terminal placement requires a plain HTTP handler or one selected Router route.');
  }
  const dispatcherLocals = new Set((plan.locals || []).filter(local => local.scopeId === 'entry').map(local => local.id));
  function expression(value, dispatcher = false) {
    if (!value || typeof value !== 'object') return;
    if (dispatcher && value.kind === 'local' && dispatcherLocals.has(value.id)) return;
    if (dispatcher && value.kind === 'undefined') return;
    if (dispatcher && value.kind === 'assignment' && value.operator === '='
      && value.target?.kind === 'local' && dispatcherLocals.has(value.target.id)) {
      expression(value.value, true); return;
    }
    // Router exhaustion emits a literal status option; authored text siblings
    // may use that same bounded response shape, without evaluating callbacks.
    if (routed && value.kind === 'object' && value.entries?.every(entry => entry.kind === 'property'
      && entry.key?.kind === 'literal' && entry.key.value === 'status' && entry.value?.kind === 'literal'
      && Number.isInteger(entry.value.value) && entry.value.value >= 100 && entry.value.value <= 599)) return;
    if (!['literal', 'context-read', 'binary', 'intrinsic'].includes(value.kind)) reject('unsupported expression in the terminal proof.');
    if (value.kind === 'context-read' && !['req.path', 'req.method', 'req.url'].includes(value.path.join('.'))) reject('request mutation/body/state is outside this proof.');
    if (value.kind === 'intrinsic' && value.name !== 'response.text' && !(dispatcher && value.name === 'router.match'))
      reject('only a plain text response control is admitted beside the handoff.');
    for (const child of [value.left, value.right, ...(value.arguments || [])]) if (child) expression(child, dispatcher);
  }
  let occurrences = 0;
  const calls = new Map();
  function statements(body, owner) {
    const dispatcher = routed && owner === 'entry';
    for (const [index, statement] of body.entries()) {
      if (statement.kind === 'if') { expression(statement.test, dispatcher); statements(statement.then, owner); statements(statement.else, owner); }
      else if (statement.kind === 'return') {
        if (statement.value?.kind !== 'intrinsic' || statement.value.name !== 'response.text') reject('Ordinary terminal branches must return a text response.');
        expression(statement.value, dispatcher);
      } else if (statement.kind === 'effect') {
        if (dispatcher || statement.effectId !== used[0].id || statement.result?.mode !== 'return'
          || (routed && owner !== used[0].routerEntryStableId)) reject('handoff must return directly from its selected route.');
        occurrences++;
      } else if (dispatcher && statement.kind === 'handler-call' && handlers.has(statement.handlerId)) {
        calls.set(statement.handlerId, (calls.get(statement.handlerId) || 0) + 1);
      } else if (dispatcher && statement.kind === 'local' && dispatcherLocals.has(statement.localId)) {
        expression(statement.value, true);
      } else if (dispatcher && statement.kind === 'expression') {
        expression(statement.expression, true);
      } else if (routed && !dispatcher && index === 0 && statement.kind === 'local'
        && statement.name === `__pulse_router_transferred_${entries.find(entry => entry.stableId === owner)?.index}`
        && handlers.get(owner)?.localIds.includes(statement.localId)
        && statement.value?.kind === 'literal' && statement.value.value === false) {
        // The canonical route body's private transfer flag, not an authored token.
      } else reject('only bounded route dispatch, pure conditions, direct handoff and text responses are admitted.');
    }
  }
  statements(plan.entry.body, 'entry');
  for (const handler of handlers.values()) {
    if (calls.get(handler.id) !== 1) reject('each terminal route requires exactly one dispatcher call.');
    statements(handler.body, handler.id);
  }
  if (occurrences !== 1) reject('exactly one terminal handoff site is required.');
  const effect = used[0];
  const inputs = effect.inputs || [];
  if (inputs.length !== 2 || inputs[0].name !== 'resource' || inputs[1].name !== 'payload'
    || inputs[1].value?.kind !== 'object' || inputs[1].value.entries?.length !== 0
    || inputs[0].value?.kind !== 'object' || inputs[0].value.entries?.length !== 2
    || inputs[0].value.entries.some(entry => entry.kind !== 'property' || entry.key?.kind !== 'literal'
      || !['kind', 'value'].includes(entry.key.value) || entry.value?.kind !== 'literal'
      || entry.value.value !== effect.resource?.[entry.key.value])) reject('The terminal service accepts only a static resource and empty payload.');
  const target = options.targetDescriptor ? { provider: 'fastly', ...options.targetDescriptor } : TARGET;
  const [artifact] = contract.select(used, options.realizationArtifacts || [], target);
  const data = artifact.data;
  if (data.service !== contract.TERMINAL_SERVICE || data.imports.length !== 1
    || JSON.stringify(data.imports[0].parameters) !== '["i32","i32","i32"]'
    || JSON.stringify(data.imports[0].results) !== '["i32"]')
    contract.fail('SIGNATURE', 'The terminal backend service requires (i32, i32, i32) -> i32.', effect);
  const backend = validateBinding(effect, options.bindings || options);
  return Object.freeze([Object.freeze({ artifact, effect, index: effects.indexOf(effect), backend })]);
}
// The terminal service uses driver-owned response authority and binds each
// selected contribution to a slot: static per-effect data (effect index, ABI
// entry, backend). Only one terminal handoff can win per request, so the
// dynamic state (dispatching slot, token, ticket, settlement) is request-scoped.
function slotSwitch(selected, slot, cases, fallback) {
  return selected.map((item, n) => `if (${slot} == ${n}) ${cases(item, n)}`).join('\n  ') + `\n  ${fallback}`;
}
function source(selected) {
  if (!selected.length) return '';
  const contributed = [...new Map(selected.map(item => [item.artifact.id, item.artifact.data.source])).values()].join('\n');
  return `
${contributed}
let __pulse_extension_status: i32 = -1
let __pulse_extension_slot: i32 = -1
let __pulse_extension_token: i32 = 0
let __pulse_extension_invocation: i32 = 0
let __pulse_extension_delivering: bool = false
let __pulse_extension_settled: bool = false
let __pulse_extension_handles_owned: bool = false
function __pulse_extension_slot_of(effectIndex: i32): i32 {
  ${selected.map((item, n) => `if (effectIndex == ${item.index}) return ${n}`).join('\n  ')}
  return -1
}
function __pulse_extension_backend(slot: i32): ArrayBuffer {
  ${slotSwitch(selected, 'slot', item => `return __pulse_fastly_utf8(${JSON.stringify(item.backend)})`, 'return new ArrayBuffer(0)')}
}
function __pulse_extension_call(slot: i32, request: i32, backend: ArrayBuffer): i32 {
  ${slotSwitch(selected, 'slot', item => `return ${item.artifact.data.entry}(request, changetype<usize>(backend), backend.byteLength)`, 'return -1')}
}
function __pulse_extension_cleanup(): void {
  // This service borrows the request handle. Status zero transfers downstream
  // response authority, not ownership of these local request/body handles.
  // Nonzero/trapped dispatch remains uncertain and is left to host teardown.
  if (!__pulse_extension_handles_owned || (__pulse_extension_slot >= 0 && __pulse_response_authority == ${STATES['outcome-unknown']})) return
  __pulse_extension_handles_owned = false
  const request = __pulse_fastly_request_handle, body = __pulse_fastly_request_body_handle
  __pulse_fastly_request_handle = -1
  __pulse_fastly_request_body_handle = -1
  const requestStatus = __pulse_fetch_close_request(request)
  const bodyStatus = __pulse_fetch_close_body(body)
  if (requestStatus != 0 || bodyStatus != 0) __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 285, __pulse_extension_slot)
}
function __pulse_extension_begin(effectIndex: i32, payload: __PulseFastlyValue): void {
  const slot = __pulse_extension_slot_of(effectIndex)
  if (slot < 0 || __pulse_response_authority != ${STATES['owned']} || !__pulse_invocation_started || __pulse_invocation_closed || __pulse_fastly_last_error != 0 || unchecked(__pulse_invocation_tickets[effectIndex]) <= 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 280, effectIndex); return }
  // One bounded backend encoding and one opaque token per admitted invocation.
  const backend = __pulse_extension_backend(slot)
  if (backend.byteLength > ${MAX_BACKEND_BYTES} || __pulse_extension_token != 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 280, effectIndex); return }
  // Allocate before dispatch, while we still own downstream response authority.
  const value = new __PulseFastlyValue()
  value.kind = 9 // private provider completion token, never an authored value
  __pulse_extension_token = __pulse_fastly_put(value)
  if (__pulse_extension_token <= 0 || __pulse_fastly_last_error != 0) return
  // Recheck the shared request budget immediately before crossing the ABI.
  if (!__pulse_fetch_request_check(effectIndex) || __pulse_invocation_closed || __pulse_fastly_last_error != 0) return
  __pulse_extension_invocation = unchecked(__pulse_invocation_tickets[effectIndex])
  __pulse_extension_slot = slot
  if (!__pulse_response_begin()) return
  __pulse_extension_status = __pulse_extension_call(slot, __pulse_fastly_request_handle, backend)
  if (__pulse_extension_status != 0) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 281, effectIndex); return }
  __pulse_response_transferred()
  __pulse_extension_cleanup()
  if (!__pulse_fetch_request_check(effectIndex) || __pulse_invocation_closed || __pulse_fastly_last_error != 0) return
  __pulse_fastly_ready_effect(effectIndex, __pulse_extension_token)
}
`;
}
// Typed contributions to the existing structural lifecycle emitter.
// Bodies see parameters and module globals, never the caller's local variables.
const OWNER = 'host-extension.terminal';
function hooks(selected) {
  if (!selected.length) return [];
  const mine = (effect) => `__pulse_extension_slot_of(${effect}) >= 0`;
  // The dispatched slot only; an undispatched terminal effect can never settle.
  const dispatched = (effect) => `__pulse_extension_slot_of(${effect}) == __pulse_extension_slot`;
  return [
    { point: 'request.acquired', owner: OWNER, order: 0, body: '  __pulse_extension_handles_owned = true' },
    // Authenticate the terminal value before the ordinary invocation consumes its
    // ticket. A raw exported setter is not authority to complete this operation.
    { point: 'effect.settle', owner: OWNER, order: 0, body: `  if (!(${mine('effect')})) return true
  if (!(${dispatched('effect')}) || __pulse_response_authority != ${STATES['transferred']} || __pulse_extension_settled || ticket != __pulse_extension_invocation || result != __pulse_extension_token || result <= 0) {
    __pulse_fastly_fail(PULSE_ERROR_STATE, 284, effect); return false
  }
  return true` },
    { point: 'effect.deliver', owner: OWNER, order: 0,
      before: `  __pulse_extension_delivering = ${mine('effect')}`,
      after: `  __pulse_extension_delivering = false
  if (${mine('effect')} && accepted == 1) __pulse_extension_settled = true` },
    { point: 'effect.result', owner: OWNER, order: 0, body: `  if (!(${mine('effect')})) return true
  if (!(${dispatched('effect')}) || !__pulse_extension_delivering || __pulse_response_authority != ${STATES['transferred']} || __pulse_extension_settled || result != __pulse_extension_token || __pulse_invocation_closed) {
    __pulse_fastly_fail(PULSE_ERROR_STATE, 284, effect); return false
  }
  return true` },
    { point: 'invocation.close', owner: OWNER, order: 0, body: `  __pulse_extension_cleanup()
  __pulse_extension_token = 0
  __pulse_extension_invocation = 0
  __pulse_extension_delivering = false` },
    { point: 'result.claim', owner: OWNER, order: 0, body: `  if (__pulse_response_authority == ${STATES['owned']}) return false
  if (__pulse_response_authority != ${STATES['transferred']} || !__pulse_extension_settled || result != __pulse_extension_token || __pulse_extension_token <= 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 283, -1); return true }
  __pulse_response_complete()
  __pulse_extension_token = 0
  return true` }
  ];
}
function policy(selected, baseline) {
  return contract.composeImportPolicy(baseline, selected.map(item => item.artifact));
}
function evidence(selected, lifecycle, importPolicy) {
  if (!selected.length) return undefined;
  return Object.freeze({ version: 'pulse.fastly-terminal-service.v1', service: contract.TERMINAL_SERVICE,
    contributions: importPolicy.contributions,
    useSites: selected.map(({artifact,effect,index}) => ({ contributionId: artifact.id, effectId: effect.id, index,
      source: effect.source || null })),
    lifecycle: { executionVersion: lifecycle.plan.executionVersion, httpVersion: lifecycle.plan.httpVersion,
      selectedPoints: lifecycle.plan.sites.map(site => ({ site: site.id, points: site.points.map(point => ({ point: point.point, kind: point.kind, contributions: point.contributions })) })),
      coverage: 'selected-points; normal-return-only after/end/closed; no trap finalizer' },
    limits: { backendBytes: MAX_BACKEND_BYTES, completionValues: 1 },
    accounting: 'not-selected', importPolicy });
}
module.exports = { ADMISSION, TARGET, MAX_BACKEND_BYTES, validateBinding, select, matches, source, hooks, policy, evidence };
