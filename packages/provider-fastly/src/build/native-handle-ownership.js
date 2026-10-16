'use strict';

function validateRoots(plan, manifest) {
  if (!manifest.handleOwnership?.enabled) return;
  const { CANONICAL_NATIVE_PURE_HELPER_VERSION } = require('@pulse-compute/wasm-contracts/handler/canonical-native-plan');
  const expected = ['__pulse_result',
    ...((plan.helpers || []).some(h => h.version !== CANONICAL_NATIVE_PURE_HELPER_VERSION) ? ['__pulse_helper_result'] : []),
    ...(plan.locals || []).map((_, i) => `__pulse_local_${i}`),
    ...(plan.effects || []).map((_, i) => `__pulse_effect_result_${i}`),
    ...(manifest.requestState.enabled ? ['__pulse_state_keys', '__pulse_state_values'] : [])];
  if (JSON.stringify(manifest.handleOwnership.roots) !== JSON.stringify(expected)) {
    throw new Error('Fastly handle ownership root descriptor mismatch');
  }
}

function providerRoots(plan) {
  return ['__pulse_request_headers_snapshot', '__pulse_fastly_payloads', '__pulse_fastly_ready',
    '__pulse_handle_cache_roots', '__pulse_handle_resource_roots',
    ...((plan.capabilities || []).includes('request.body.forward') ? ['__fwd_marker', '__fwd_result'] : [])];
}

function providerSource(plan, enabled, roots = providerRoots(plan)) {
  if (!enabled) return '';
  if (JSON.stringify(roots) !== JSON.stringify(providerRoots(plan))) throw new Error('Fastly provider root descriptor mismatch');
  const arrays = new Set(['__pulse_fastly_payloads', '__pulse_fastly_ready', '__pulse_handle_cache_roots', '__pulse_handle_resource_roots']);
  return ['function __pulse_handle_provider_roots(): void {',
    ...roots.map(name => arrays.has(name)
      ? `  for (let i = 0; i < ${name}.length; i++) __pulse_handle_mark(unchecked(${name}[i]))`
      : `  __pulse_handle_mark(${name})`), '}'].join('\n');
}

// This source is composed only with the canonical emitter's complete, eligible
// root descriptor. Synchronous host operations never call the checkpoint.
function fields(enabled) {
  return enabled ? `
  traceHandleEdges(): void {
    if (this.valuesStorage !== null) {
      const values = this.valuesStorage!
      for (let i = 0; i < values.length; i++) {
        const handle = unchecked(values[i])
        if (handle <= 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 1, -1); return }
        __pulse_handle_mark(handle)
      }
    }
    if (this.textLeft !== null) __pulse_handle_work!.push(this.textLeft!)
    if (this.textRight !== null) __pulse_handle_work!.push(this.textRight!)
  }
` : '';
}

function tableSource(enabled) {
  if (!enabled) return `
@lazy const __pulse_fastly_values = new Array<__PulseFastlyValue>()
function __pulse_fastly_has_value(handle: i32): bool { return handle > 0 && handle <= __pulse_fastly_values.length }
function __pulse_fastly_value_count(): i32 { return __pulse_fastly_values.length }
function __pulse_fastly_put(value: __PulseFastlyValue): i32 { __pulse_fastly_values.push(value); return __pulse_fastly_values.length }
function __pulse_fastly_value(handle: i32): __PulseFastlyValue { if (!__pulse_fastly_has_value(handle)) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 1, -1); return new __PulseFastlyValue() } return unchecked(__pulse_fastly_values[handle - 1]) }
`;
  return `
@lazy let __pulse_fastly_values = new Map<i32, __PulseFastlyValue>()
// The existing caches never evict or replace entries. Record each insertion
// once so tracing is proportional to occupied slots, not 132,101 possible slots.
@lazy const __pulse_handle_cache_roots = new Array<i32>()
// Wrappers keep their existing request lifetime. Resource IDs are never traced
// as value handles; collection neither closes nor cancels a host resource.
@lazy const __pulse_handle_resource_roots = new Array<i32>()
let __pulse_handle_next: i32 = 0
let __pulse_handle_allocations: i32 = 0
let __pulse_handle_interval: i32 = 1024
let __pulse_handle_survivors: Map<i32, __PulseFastlyValue> | null = null
let __pulse_handle_work: Array<__PulseFastlyValue> | null = null
function __pulse_fastly_has_value(handle: i32): bool { return handle > 0 && __pulse_fastly_values.has(handle) }
function __pulse_fastly_value_count(): i32 { return __pulse_fastly_values.size }
function __pulse_fastly_put(value: __PulseFastlyValue): i32 {
  // Provider-owned terminal error responses still allocate after a latched
  // failure, just as on the retained path. Checkpoints remain suppressed.
  if (__pulse_handle_next == i32.MAX_VALUE) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 1, -1); return 0 }
  const handle = ++__pulse_handle_next
  __pulse_fastly_values.set(handle, value)
  if (value.kind == PULSE_VALUE_FETCH || value.s3Body || value.responseHandle != 0 || value.bodyHandle != 0) __pulse_handle_resource_roots.push(handle)
  __pulse_handle_allocations++
  return handle
}
function __pulse_fastly_value(handle: i32): __PulseFastlyValue {
  if (!__pulse_fastly_has_value(handle)) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 1, -1); return new __PulseFastlyValue() }
  return __pulse_fastly_values.get(handle)
}
function __pulse_handle_mark(handle: i32): void {
  if (handle == 0 || __pulse_fastly_last_error != 0) return
  const survivors = __pulse_handle_survivors!
  if (survivors.has(handle)) return
  if (!__pulse_fastly_has_value(handle)) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 1, -1); return }
  const value = __pulse_fastly_values.get(handle)
  survivors.set(handle, value)
  __pulse_handle_work!.push(value)
}
@noinline
function __pulse_handle_checkpoint(): void {
  if (__pulse_fastly_last_error != 0 || __pulse_error != 0 || __pulse_handle_allocations < __pulse_handle_interval) return
  // Separate handle and object visitation: ropes retain direct objects, and
  // multiple handle IDs can reference one object. Neither permits losing an ID.
  __pulse_handle_survivors = new Map<i32, __PulseFastlyValue>()
  __pulse_handle_work = new Array<__PulseFastlyValue>()
  const visited = new Set<__PulseFastlyValue>()
  __pulse_handle_guest_roots()
  __pulse_handle_provider_roots()
  const work = __pulse_handle_work!
  while (work.length > 0 && __pulse_fastly_last_error == 0) {
    const value = work.pop()
    if (visited.has(value)) continue
    visited.add(value)
    value.traceHandleEdges()
  }
  // Publish only a complete trace. Rebuilding also drops historical Map
  // insertion/deletion capacity; no append-only tombstone vector remains.
  if (__pulse_fastly_last_error == 0) {
    __pulse_fastly_values = __pulse_handle_survivors!
    __pulse_handle_interval = max<i32>(1024, __pulse_fastly_values.size)
    __pulse_handle_allocations = 0
  }
  __pulse_handle_survivors = null
  __pulse_handle_work = null
}
`;
}

module.exports = { fields, tableSource, validateRoots, providerRoots, providerSource };
