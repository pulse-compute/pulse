'use strict';

// Shared host contract. Provider preparation must not send a storage operation;
// the returned primitive is the conservative dispatch boundary (including throws).
const { cloneKvValue, normalizeKvNamespace } = require('./bindings.js');
const { PulseRuntimeContractError } = require('./errors.js');
const KV_CONDITIONAL_KINDS = Object.freeze(['kv.getVersioned', 'kv.insertIfAbsent', 'kv.compareAndSwap']);
const KV_CONDITIONAL_LIMITS = Object.freeze({ namespaceBytes: 256, keyBytes: 1024, generationBytes: 256,
  valueBytes: 65536, wireBytes: 65560, depth: 64, entries: 10000, envelopeBytes: 262144, timeoutMs: 10000 });
const readReasons = new Set(['invalid-key', 'configuration', 'not-authorized', 'throttled', 'unavailable', 'transport', 'timeout', 'protocol', 'too-large', 'invalid-value']);
const writeReasons = new Set([...readReasons, 'invalid-generation', 'rejected']);
const unknownReasons = new Set(['transport', 'timeout', 'unavailable', 'protocol']);
const encoder = new TextEncoder();
const admissions = new WeakSet();
// Descriptor copies retain the original admission/deadline. Symbols never enter
// the serialized effect envelope; only admissions minted by this owner are trusted.
const admissionSymbol = Symbol('pulse.conditional-kv-admission');
const isConditionalKv = (kind) => KV_CONDITIONAL_KINDS.includes(kind);
const isRead = (effect) => effect.kind === 'kv.getVersioned';
const frozen = (value) => Object.freeze(value);
function fail(reason) { const error = new Error('Pulse conditional KV boundary rejected data.'); error.kvReason = reason; throw error; }
function byteLength(value) { return encoder.encode(value).byteLength; }
function kvClock(options = {}) { return options.kvClock || { now: () => performance.now(), setTimeout, clearTimeout }; }
function boundedLimits(options = {}) {
  const limit = (name, max) => options[name] === undefined ? max : Math.min(max, options[name]);
  return { maxKvValueBytes: limit('maxKvValueBytes', 65536), maxKvValueDepth: limit('maxKvValueDepth', 64), maxKvValueEntries: limit('maxKvValueEntries', 10000) };
}
function normalizeKvGeneration(value) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(value)) fail('invalid-generation');
  return value;
}
function normalizeConditionalKvKey(value, options = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || byteLength(value) > Math.min(1024, options.maxKvKeyBytes ?? 1024)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('invalid-key');
  return value;
}
function validationReason(error) {
  if (error && error.kvReason) return error.kvReason;
  return /TOO_LARGE|DEPTH_EXCEEDED|ENTRIES_EXCEEDED/.test(error && error.code || '') ? 'too-large' : 'invalid-value';
}
function encodeConditionalKvValue(value, options = {}) {
  let detached;
  try { detached = cloneKvValue(value, boundedLimits(options)); } catch (error) { fail(validationReason(error)); }
  const wire = encoder.encode('{"__pulseKv":1,"value":' + JSON.stringify(detached) + '}');
  if (wire.byteLength > KV_CONDITIONAL_LIMITS.wireBytes) fail('too-large');
  return wire;
}
function decodeConditionalKvValue(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array)) fail('protocol');
  if (bytes.byteLength > KV_CONDITIONAL_LIMITS.wireBytes) fail('too-large');
  let text, parsed;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    parsed = JSON.parse(text);
    // JSON.parse validates syntax; this bounded scan rejects last-wins duplicate
    // members, including escaped aliases, before exposing any parsed value.
    const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
    let cursor = 0, entries = 0;
    function visit(depth) {
      if (depth > 65 || ++entries > 10002) fail('too-large');
      const first = tokens[cursor++];
      if (first !== '{' && first !== '[') return;
      const end = first === '{' ? '}' : ']', names = new Set();
      if (tokens[cursor] === end) { cursor++; return; }
      while (true) {
        if (first === '{') {
          const name = JSON.parse(tokens[cursor++]);
          if (names.has(name)) fail('protocol'); names.add(name);
          if (tokens[cursor++] !== ':') fail('protocol');
        }
        visit(depth + 1);
        const separator = tokens[cursor++];
        if (separator === end) return;
        if (separator !== ',') fail('protocol');
      }
    }
    visit(0);
    if (cursor !== tokens.length || !parsed || Array.isArray(parsed) || parsed.__pulseKv !== 1
      || Object.keys(parsed).sort().join(',') !== '__pulseKv,value') fail('protocol');
  } catch (error) { fail(error.kvReason || 'protocol'); }
  try { return cloneKvValue(parsed.value, boundedLimits(options)); } catch (error) { fail(validationReason(error)); }
}
function kvFailure(effect, reason, dispatched = false) {
  return frozen(isRead(effect) ? { status: 'failed', reason: readReasons.has(reason) ? reason : 'protocol' }
    : { status: dispatched ? 'unknown' : 'not-stored', reason: (dispatched ? unknownReasons : writeReasons).has(reason) ? reason : 'protocol' });
}
function admitConditionalKv(input, options = {}) {
  if (admissions.has(input)) return input;
  if (input && admissions.has(input[admissionSymbol])) return input[admissionSymbol];
  const clock = kvClock(options);
  const deadline = Math.min(clock.now() + KV_CONDITIONAL_LIMITS.timeoutMs, options.deadlineMonotonicMs ?? Infinity);
  const result = { kind: input.kind, deadline };
  try {
    try { result.namespace = normalizeKvNamespace(input.namespace ?? input.store, { maxKvNamespaceBytes: Math.min(256, options.maxKvNamespaceBytes ?? 256) }); }
    catch (_) { fail('configuration'); }
    result.key = normalizeConditionalKvKey(input.key, options);
    if (input.kind === 'kv.compareAndSwap') result.generation = normalizeKvGeneration(input.generation);
    if (!isRead(input)) result.value = decodeConditionalKvValue(encodeConditionalKvValue(input.value, options), options);
    if (byteLength(JSON.stringify(result)) > KV_CONDITIONAL_LIMITS.envelopeBytes) fail('too-large');
  } catch (error) { result.validationResult = kvFailure(result, validationReason(error)); }
  result[admissionSymbol] = result;
  const admitted = frozen(result); admissions.add(admitted); return admitted;
}
function exactRecord(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('protocol');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('protocol');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || !fields.every((key) => keys.includes(key))) fail('protocol');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('protocol');
  }
}
function normalizeConditionalKvResult(effect, value, options = {}) {
  try {
    // Read status without invoking an accessor from a malformed provider result.
    const status = value && Object.getOwnPropertyDescriptor(value, 'status');
    const tag = status && status.value;
    if (isRead(effect)) {
      if (tag === 'found') {
        exactRecord(value, ['status', 'value', 'generation']);
        const generation = normalizeKvGeneration(value.generation);
        const detached = decodeConditionalKvValue(encodeConditionalKvValue(value.value, options), options);
        return frozen({ status: 'found', value: detached, generation });
      }
      if (tag === 'not-found') { exactRecord(value, ['status']); return frozen({ status: tag }); }
      exactRecord(value, ['status', 'reason']);
      if (tag !== 'failed' || !readReasons.has(value.reason)) fail('protocol');
    } else {
      if (tag === 'stored' || tag === 'conflict') { exactRecord(value, ['status']); return frozen({ status: tag }); }
      exactRecord(value, ['status', 'reason']);
      if (!((tag === 'not-stored' && writeReasons.has(value.reason)) || (tag === 'unknown' && unknownReasons.has(value.reason)))) fail('protocol');
    }
    return frozen({ status: tag, reason: value.reason });
  } catch (error) { return kvFailure(effect, validationReason(error) === 'invalid-generation' ? 'protocol' : validationReason(error), !isRead(effect)); }
}
function registerKvRedactions(effect, register) {
  if (typeof register !== 'function') return;
  const visit = (value) => {
    if (typeof value === 'string' && value.length) register(value);
    else if (value && typeof value === 'object') for (const key of Object.keys(value)) { register(key); visit(value[key]); }
  };
  visit(effect.key); visit(effect.generation); visit(effect.value);
}
function cancelled() { return new PulseRuntimeContractError('PULSE_RUNTIME_EFFECT_ABORTED', 'Pulse conditional KV execution was cancelled.'); }
async function executeConditionalKv(effect, prepare, execution = {}, options = {}) {
  const admitted = admissions.has(effect) ? effect : admitConditionalKv(effect, options);
  const clock = kvClock(options), controller = new AbortController();
  let dispatched = false, settled = false, timer, rejectCancellation, resolveTimeout;
  registerKvRedactions(admitted, execution.registerRedactionValue);
  const observe = (outcome) => {
    if (typeof execution.onKvObservation === 'function') execution.onKvObservation(frozen({
      type: 'kv-lifecycle', kind: admitted.kind, dispatched, mayHaveCommitted: !isRead(admitted) && dispatched && (outcome === 'cancelled' || outcome === 'unknown'), outcome
    }));
  };
  const cancellation = new Promise((_, reject) => { rejectCancellation = reject; });
  const timeout = new Promise((resolve) => { resolveTimeout = resolve; });
  const abort = () => { if (!settled) { controller.abort(); rejectCancellation(cancelled()); } };
  const expire = () => { if (!settled) { controller.abort(); resolveTimeout(kvFailure(admitted, 'timeout', dispatched)); } };
  const signal = execution.signal;
  if (signal) signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal && signal.aborted) throw cancelled();
    if (admitted.validationResult) return admitted.validationResult;
    if (clock.now() >= admitted.deadline) return kvFailure(admitted, 'timeout');
    timer = clock.setTimeout(expire, admitted.deadline - clock.now());
    const operationExecution = frozen({ ...execution, signal: controller.signal, deadlineMonotonicMs: admitted.deadline });
    const work = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return kvFailure(admitted, 'timeout');
      try {
        const primitive = await prepare(admitted, operationExecution);
        if (controller.signal.aborted || clock.now() >= admitted.deadline) {
          controller.abort();
          return kvFailure(admitted, 'timeout');
        }
        if (typeof primitive !== 'function') return kvFailure(admitted, 'configuration');
        dispatched = true;
        const value = await primitive();
        if (clock.now() >= admitted.deadline) {
          controller.abort();
          return kvFailure(admitted, 'timeout', true);
        }
        const normalized = normalizeConditionalKvResult(admitted, value, options);
        if (normalized.status === 'found') registerKvRedactions(normalized, execution.registerRedactionValue);
        return normalized;
      } catch (error) {
        return kvFailure(admitted, dispatched ? 'transport' : error && writeReasons.has(error.kvReason) ? error.kvReason : 'unavailable', dispatched);
      }
    });
    const result = await Promise.race([work, timeout, cancellation]);
    if (signal && signal.aborted) throw cancelled();
    observe(result.status);
    return result;
  } catch (error) { if (signal && signal.aborted) observe('cancelled'); throw error; }
  finally { settled = true; if (timer !== undefined) clock.clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); }
}
module.exports = Object.freeze({ KV_CONDITIONAL_KINDS, KV_CONDITIONAL_LIMITS, isConditionalKv, normalizeKvGeneration, normalizeConditionalKvKey,
  admitConditionalKv, encodeConditionalKvValue, decodeConditionalKvValue, normalizeConditionalKvResult, executeConditionalKv, registerKvRedactions });
