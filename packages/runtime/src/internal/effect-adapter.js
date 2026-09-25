'use strict';

const { PulseRuntimeContractError } = require('./errors.js');
const {
  cloneKvValue,
  normalizeBindingName,
  normalizeBindingValue,
  normalizeKvKey,
  normalizeKvNamespace,
  normalizeKvPutResult
} = require('./bindings.js');
const { normalizeTimeResult, readWallTime } = require('./time.js');
const conditionalKv = require('./conditional-kv.js');
const { fetchRequestInitForHost } = require('./fetch.js');
const { createRedactionState } = require('./redaction.js');
const { validateSchemaValue } = require('./schema.js');
const { EVENT_EMIT_CODES } = require('./event-emission.js');
const { retainFetchResponseForBudget } = require('./response.js');

const JAVASCRIPT_EFFECT_PROTOCOL_VERSION = 'pulse.javascript-effect.v1';
const JAVASCRIPT_EFFECT_ADAPTER_VERSION = 'pulse.javascript-effect-adapter.v1';
const JAVASCRIPT_EFFECT_OBSERVATION_VERSION = 'pulse.javascript-effect-observation.v1';
const DEFAULT_MAX_EFFECTS = 1024;

const EFFECT_DATA = new WeakMap();

function requireObject(label, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Pulse ${label} must be an object.`);
  }
  return value;
}

function requireFunction(label, value) {
  if (typeof value !== 'function') throw new TypeError(`Pulse ${label} must be a function.`);
  return value;
}

function normalizeMaxEffects(value) {
  const max = value === undefined ? DEFAULT_MAX_EFFECTS : Number(value);
  if (!Number.isSafeInteger(max) || max <= 0) {
    throw new TypeError('Pulse maxEffects must be a positive safe integer.');
  }
  return max;
}

function normalizeExecutionKind(value) {
  const kind = value === undefined ? 'request' : String(value);
  if (kind !== 'request' && kind !== 'event') {
    throw new TypeError('Pulse JavaScript executionKind must be request or event.');
  }
  return kind;
}

function errorIdentity(error, redaction) {
  const redactString = redaction && typeof redaction.redactString === 'function'
    ? (value) => redaction.redactString(value)
    : (value) => String(value);
  return Object.freeze({
    name: redactString(error && typeof error.name === 'string' ? error.name : typeof error),
    code: error && typeof error.code === 'string' ? redactString(error.code) : undefined
  });
}

function abortedEffectError(reason) {
  if (reason instanceof PulseRuntimeContractError) return reason;
  return new PulseRuntimeContractError(
    'PULSE_RUNTIME_EFFECT_ABORTED',
    'Pulse JavaScript effect execution was aborted.',
    { cause: reason }
  );
}

function createEffectSignal(lifecycleSignal, descriptor) {
  const controller = new AbortController();
  let timer;
  const forwardAbort = () => {
    if (!controller.signal.aborted) controller.abort(lifecycleSignal.reason);
  };
  if (lifecycleSignal.aborted) forwardAbort();
  else lifecycleSignal.addEventListener('abort', forwardAbort, { once: true });

  const timeoutMs = descriptor.kind === 'fetch' && descriptor.init
    ? descriptor.init.timeoutMs
    : undefined;
  if (timeoutMs !== undefined && !controller.signal.aborted) {
    timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(new PulseRuntimeContractError(
          'PULSE_FETCH_TIMEOUT',
          `Pulse fetch ${descriptor.id} exceeded its ${timeoutMs}ms timeout.`
        ));
      }
    }, timeoutMs);
  }

  return Object.freeze({
    signal: controller.signal,
    dispose() {
      lifecycleSignal.removeEventListener('abort', forwardAbort);
      if (timer !== undefined) clearTimeout(timer);
    }
  });
}

function raceWithSignal(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, abortedEffectError(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
    // Observe the owned promise even when cancellation preceded the race.
    if (signal.aborted) onAbort();
  });
}

function headerNames(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((entry) => Array.isArray(entry) ? String(entry[0]).toLowerCase() : '')
      .filter(Boolean);
  }
  if (input instanceof Headers) return Array.from(input.keys(), (name) => String(name).toLowerCase());
  if (typeof input === 'object') return Object.keys(input).map((name) => String(name).toLowerCase());
  return [];
}

/**
 * Produce bounded, value-redacted evidence. The trusted adapter receives the complete
 * descriptor; observations intentionally omit bodies, binding values, and package payloads.
 * Field-level and known-secret redaction is applied before evidence leaves the request.
 */
function publicEffectDescriptor(effect, redaction) {
  const redactString = redaction && typeof redaction.redactString === 'function'
    ? (value) => redaction.redactString(value)
    : (value) => String(value);
  const base = {
    version: JAVASCRIPT_EFFECT_PROTOCOL_VERSION,
    id: redactString(effect.id),
    kind: redactString(effect.kind),
    providerKind: redactString(effect.providerKind),
    operation: redactString(effect.operation),
    capability: redactString(effect.capability)
  };
  if (effect.kind === 'fetch') {
    const init = effect.init && typeof effect.init === 'object' ? effect.init : {};
    return Object.freeze({
      ...base,
      url: redactString(effect.url),
      init: Object.freeze({
        method: init.method === undefined ? 'GET' : String(init.method).toUpperCase(),
        headerNames: Object.freeze(headerNames(init.headers).map(redactString)),
        bodyMode: init.bodyMode === undefined ? 'none' : String(init.bodyMode),
        hasBody: init.bodyMode === 'text',
        hasJson: init.bodyMode === 'json',
        timeoutMs: init.timeoutMs === undefined ? undefined : Number(init.timeoutMs)
      })
    });
  }
  if (effect.kind === 'config.get' || effect.kind === 'secret.get') {
    return Object.freeze({ ...base, name: redactString(effect.name) });
  }
  if (conditionalKv.isConditionalKv(effect.kind)) return Object.freeze({ ...base, namespace: redactString(effect.namespace), key: '<redacted>', generation: '<redacted>', value: '<redacted>' });
  if (effect.kind === 'kv.get' || effect.kind === 'kv.put') {
    return Object.freeze({
      ...base,
      namespace: redactString(effect.namespace),
      key: redactString(effect.key),
      value: effect.kind === 'kv.put' ? '<redacted>' : undefined
    });
  }
  if (effect.kind === 'event.emit') {
    const frame = effect.frame && typeof effect.frame === 'object' ? effect.frame : {};
    return Object.freeze({
      ...base,
      frame: Object.freeze({
        version: 'pulse.event-frame.v1',
        type: redactString(frame.type),
        schemaId: frame.schemaId === null ? null : redactString(frame.schemaId),
        hasPayload: Object.prototype.hasOwnProperty.call(frame, 'payload'),
        payload: Object.prototype.hasOwnProperty.call(frame, 'payload') ? '<redacted>' : undefined
      })
    });
  }
  if (effect.package) {
    return Object.freeze({
      ...base,
      package: redactString(effect.package),
      contractId: effect.contractId === undefined ? undefined : redactString(effect.contractId)
    });
  }
  return Object.freeze(base);
}

function createJavascriptEffectAdapter(input) {
  requireObject('JavaScript effect adapter', input);
  const dispatch = requireFunction('JavaScript effect adapter dispatch', input.dispatch);
  const dispose = input.dispose === undefined
    ? undefined
    : requireFunction('JavaScript effect adapter dispose', input.dispose);
  return Object.freeze({
    version: JAVASCRIPT_EFFECT_ADAPTER_VERSION,
    id: String(input.id || 'pulse.javascript-effect-adapter.custom'),
    dispatch,
    prepareConditionalKv: typeof input.prepareConditionalKv === 'function' ? input.prepareConditionalKv : undefined,
    dispose
  });
}

function unavailableCapability(effect) {
  throw new PulseRuntimeContractError(
    'PULSE_RUNTIME_CAPABILITY_UNAVAILABLE',
    `Pulse capability ${effect.capability} is unavailable in the current JavaScript realization.`
  );
}

/** Compatibility adapter for the per-capability injection shape. */
function createCapabilityEffectAdapter(capabilities = {}) {
  const value = capabilities && typeof capabilities === 'object' ? capabilities : {};
  const namespaces = new Map();
  return createJavascriptEffectAdapter({
    id: 'pulse.javascript-effect-adapter.capabilities',
    async prepareConditionalKv(effect, execution) {
      if (typeof value.prepareConditionalKv === 'function') return value.prepareConditionalKv(effect, execution);
      if (typeof value.kv !== 'function') return undefined;
      if (!namespaces.has(effect.namespace)) namespaces.set(effect.namespace, await value.kv(effect.namespace, execution));
      const namespace = namespaces.get(effect.namespace), method = effect.kind.slice(3);
      if (!namespace || typeof namespace[method] !== 'function') return undefined;
      return () => method === 'getVersioned' ? namespace[method](effect.key, execution)
        : method === 'insertIfAbsent' ? namespace[method](effect.key, effect.value, execution)
        : namespace[method](effect.key, effect.generation, effect.value, execution);
    },
    async dispatch(effect, execution) {
      if (effect.kind === 'fetch') {
        if (typeof value.fetch !== 'function') return unavailableCapability(effect);
        return value.fetch(effect.url, fetchRequestInitForHost(effect.init, execution.signal), execution);
      }
      if (effect.kind === 'time.now') return typeof value.time === 'function' ? value.time(execution) : readWallTime();
      if (effect.kind === 'config.get') {
        if (typeof value.config !== 'function') return unavailableCapability(effect);
        return value.config(effect.name, execution);
      }
      if (effect.kind === 'secret.get') {
        if (typeof value.secret !== 'function') return unavailableCapability(effect);
        return value.secret(effect.name, execution);
      }
      if (effect.kind === 'kv.get' || effect.kind === 'kv.put') {
        if (typeof value.kv !== 'function') return unavailableCapability(effect);
        if (!namespaces.has(effect.namespace)) namespaces.set(effect.namespace, value.kv(effect.namespace, execution));
        const namespace = namespaces.get(effect.namespace);
        const method = effect.kind === 'kv.get' ? 'get' : 'put';
        if (!namespace || typeof namespace[method] !== 'function') return unavailableCapability(effect);
        return method === 'get'
          ? namespace.get(effect.key)
          : namespace.put(effect.key, effect.value);
      }
      if (effect.kind === 'event.emit') {
        if (typeof value.emit !== 'function') return unavailableCapability(effect);
        return value.emit(effect.frame, execution);
      }
      if (typeof value.effect === 'function') return value.effect(effect, execution);
      return unavailableCapability(effect);
    }
  });
}

function bindingLimits(options = {}) {
  return Object.freeze({
    kvClock: options.kvClock, deadlineMonotonicMs: options.deadlineMonotonicMs,
    maxBindingNameBytes: options.maxBindingNameBytes,
    maxBindingValueBytes: options.maxBindingValueBytes,
    maxKvNamespaceBytes: options.maxKvNamespaceBytes,
    maxKvKeyBytes: options.maxKvKeyBytes,
    maxKvValueBytes: options.maxKvValueBytes,
    maxKvValueDepth: options.maxKvValueDepth,
    maxKvValueEntries: options.maxKvValueEntries
  });
}

function normalizeEffectDescriptor(input, limits) {
  const kind = String(input.kind || 'effect');
  if (conditionalKv.isConditionalKv(kind)) return { ...conditionalKv.admitConditionalKv(input, limits), id: input.id, parallelEligible: input.parallelEligible };
  if (kind === 'config.get' || kind === 'secret.get') {
    const bindingKind = kind === 'secret.get' ? 'secret' : 'config';
    return { ...input, name: normalizeBindingName(bindingKind, input.name, limits) };
  }
  if (kind === 'kv.get' || kind === 'kv.put') {
    const normalized = {
      ...input,
      namespace: normalizeKvNamespace(input.namespace, limits),
      key: normalizeKvKey(input.key, limits)
    };
    if (kind === 'kv.put') normalized.value = cloneKvValue(input.value, limits);
    return normalized;
  }
  return input;
}

function normalizeEffectResult(descriptor, value, limits) {
  if (descriptor.kind === 'time.now') return normalizeTimeResult(value);
  if (descriptor.kind === 'config.get' || descriptor.kind === 'secret.get') {
    return normalizeBindingValue(descriptor.kind, descriptor.name, value, limits);
  }
  if (descriptor.kind === 'kv.get') {
    return cloneKvValue(value, { ...limits, allowUndefined: true });
  }
  if (descriptor.kind === 'kv.put') return normalizeKvPutResult(value);
  if (descriptor.kind === 'event.emit') {
    if (value !== undefined) {
      throw new PulseRuntimeContractError(
        EVENT_EMIT_CODES.ACCEPTANCE_INVALID,
        'Pulse event emit adapters must acknowledge host acceptance with undefined.'
      );
    }
    return undefined;
  }
  return value;
}

function normalizeEffectAdapter(options = {}) {
  if (options.effectAdapter !== undefined && options.capabilities !== undefined) {
    throw new PulseRuntimeContractError(
      'PULSE_RUNTIME_EFFECT_ADAPTER_AMBIGUOUS',
      'Pulse JavaScript execution accepts either effectAdapter or legacy capabilities, not both.'
    );
  }
  if (options.effectAdapter === undefined) return createCapabilityEffectAdapter(options.capabilities);
  return createJavascriptEffectAdapter(options.effectAdapter);
}

function defineEffect(promise, data, methods = {}) {
  const effect = Promise.resolve(promise);
  EFFECT_DATA.set(effect, Object.freeze(data));
  for (const [name, method] of Object.entries(methods)) {
    Object.defineProperty(effect, name, {
      enumerable: false,
      configurable: false,
      writable: false,
      value: method
    });
  }
  return effect;
}

function dataForEffect(value) {
  return value && (typeof value === 'object' || typeof value === 'function')
    ? EFFECT_DATA.get(value)
    : undefined;
}

function isPulseJavascriptEffect(value) {
  return Boolean(dataForEffect(value));
}

function isArrayIndexKey(key) {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false;
  const value = Number(key);
  return Number.isSafeInteger(value) && value >= 0 && value < 0xffffffff && String(value) === key;
}

function validateParallelRecord(record, execution, claimedRootIds) {
  requireObject('parallel effect record', record);
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype) {
    throw new PulseRuntimeContractError(
      'PULSE_RUNTIME_PARALLEL_OBJECT_REQUIRED',
      'ctx.parallel requires an ordinary object literal-shaped record of Pulse effects.'
    );
  }

  const keys = Reflect.ownKeys(record);
  if (keys.length === 0) {
    throw new PulseRuntimeContractError(
      'PULSE_RUNTIME_PARALLEL_EMPTY',
      'ctx.parallel requires at least one keyed Pulse effect.'
    );
  }

  const entries = [];
  const seenRootIds = new Set();
  for (const key of keys) {
    if (typeof key !== 'string') {
      throw new PulseRuntimeContractError(
        'PULSE_RUNTIME_PARALLEL_KEY_STATIC_REQUIRED',
        'ctx.parallel does not accept symbol keys.'
      );
    }
    if (key === '__proto__' || isArrayIndexKey(key)) {
      throw new PulseRuntimeContractError(
        'PULSE_RUNTIME_PARALLEL_KEY_UNSUPPORTED',
        `ctx.parallel key ${JSON.stringify(key)} is not portable; use a non-index string key.`
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new PulseRuntimeContractError(
        'PULSE_RUNTIME_PARALLEL_DATA_PROPERTY_REQUIRED',
        `ctx.parallel property ${JSON.stringify(key)} must be an enumerable data property.`
      );
    }
    const effect = descriptor.value;
    const data = dataForEffect(effect);
    if (!data || data.parallelEligible !== true) {
      throw new PulseRuntimeContractError(
        'PULSE_RUNTIME_PARALLEL_EFFECT_REQUIRED',
        `ctx.parallel property ${JSON.stringify(key)} must contain a parallel-eligible Pulse effect.`
      );
    }
    if (data.execution !== execution) {
      throw new PulseRuntimeContractError(
        'PULSE_RUNTIME_PARALLEL_EFFECT_OWNERSHIP',
        `ctx.parallel property ${JSON.stringify(key)} belongs to a different managed execution.`
      );
    }
    if (seenRootIds.has(data.rootId) || claimedRootIds.has(data.rootId)) {
      throw new PulseRuntimeContractError(
        'PULSE_RUNTIME_PARALLEL_EFFECT_DUPLICATE',
        `ctx.parallel property ${JSON.stringify(key)} reuses an effect root already claimed by a parallel group.`
      );
    }
    seenRootIds.add(data.rootId);
    entries.push(Object.freeze({ key, effect, data }));
  }
  return Object.freeze(entries);
}

function attachGroupFailure(primaryReason, failures, redaction) {
  const primary = primaryReason instanceof Error ? primaryReason : new Error(String(primaryReason));
  const evidence = Object.freeze(failures.map((entry) => Object.freeze({
    key: redaction.redactString(entry.key),
    index: entry.index,
    effectId: redaction.redactString(entry.effectId),
    kind: redaction.redactString(entry.kind),
    ...errorIdentity(entry.error, redaction)
  })));
  try {
    Object.defineProperty(primary, 'effectFailures', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: evidence
    });
    return primary;
  } catch (_) {
    const wrapped = new PulseRuntimeContractError(
      'PULSE_RUNTIME_PARALLEL_FAILED',
      'One or more ctx.parallel effects failed.',
      { cause: primary }
    );
    Object.defineProperty(wrapped, 'effectFailures', { enumerable: false, value: evidence });
    return wrapped;
  }
}

function createJavascriptEffectExecution(options = {}) {
  const adapter = normalizeEffectAdapter(options);
  const redaction = createRedactionState(options.redactionValues);
  const maxEffects = normalizeMaxEffects(options.maxEffects);
  const executionKind = normalizeExecutionKind(options.executionKind);
  const limitMessage = executionKind === 'event'
    ? `Pulse event invocation exceeded the maximum of ${maxEffects} execution-owned effects.`
    : `Pulse request exceeded the maximum of ${maxEffects} request-owned effects.`;
  const limits = bindingLimits(options);
  const onObservation = options.onEffectObservation === undefined
    ? undefined
    : requireFunction('effect observation callback', options.onEffectObservation);
  const lifecycleController = new AbortController();
  const sourceSignal = options.signal;
  let removeSourceAbortListener;
  if (sourceSignal && typeof sourceSignal.addEventListener === 'function') {
    const forwardAbort = () => {
      if (!lifecycleController.signal.aborted) lifecycleController.abort(sourceSignal.reason);
    };
    if (sourceSignal.aborted) forwardAbort();
    else {
      sourceSignal.addEventListener('abort', forwardAbort, { once: true });
      removeSourceAbortListener = () => sourceSignal.removeEventListener('abort', forwardAbort);
    }
  }
  const externalExecution = Object.freeze({
    kind: executionKind,
    request: options.request,
    event: options.event,
    application: options.application,
    signal: lifecycleController.signal,
    deadlineMonotonicMs: options.deadlineMonotonicMs,
    requestBudget: options.requestBudget,
    registerRedactionValue(value) {
      if (typeof value === 'string' && value.length > 0) redaction.add(value);
    },
    validateSchemaValue(schemaId, value, context = {}) {
      return validateSchemaValue(schemaId, value, {
        schemaCodecs: options.schemaCodecs,
        strict: options.strict,
        target: options.target,
        provider: options.provider
      }, context);
    }
  });
  const counters = new Map();
  const dispatchedIds = new Set();
  const pendingEffects = new Map();
  const claimedParallelRootIds = new Set();
  const observations = [];
  const resolutionOrder = [];
  const groups = [];
  let totalEffects = 0;
  let localEffects = 0;
  let parallelCount = 0;
  let resolutionIndex = 0;
  let closed = false;

  function observe(event) {
    const observation = Object.freeze(redaction.redactValue({
      version: JAVASCRIPT_EFFECT_OBSERVATION_VERSION,
      ...event
    }));
    observations.push(observation);
    if (onObservation) onObservation(observation);
  }

  function nextId(kind) {
    const prefix = String(kind || 'effect')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'effect';
    const next = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  }

  function assertOpen() {
    if (closed) {
      throw new PulseRuntimeContractError(
        'PULSE_RUNTIME_EFFECT_EXECUTION_CLOSED',
        'Pulse effect execution is already closed.'
      );
    }
    options.requestBudget?.check();
  }

  function trackEffect(effect, data) {
    pendingEffects.set(effect, data);
    effect.then(
      () => pendingEffects.delete(effect),
      () => pendingEffects.delete(effect)
    );
    // Keep an execution-owned observer attached so a rejected effect does not become
    // an ambient unhandled rejection before Router completion checks run.
    effect.catch(() => undefined);
    return effect;
  }

  const execution = {
    dispatch(input, projector) {
      assertOpen();
      requireObject('effect descriptor', input);
      if (totalEffects + localEffects >= maxEffects) {
        throw new PulseRuntimeContractError(
          'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED',
          limitMessage
        );
      }
      const normalizedInput = normalizeEffectDescriptor(input, limits);
      const kind = String(normalizedInput.kind || 'effect');
      const descriptor = Object.freeze({
        ...normalizedInput,
        version: JAVASCRIPT_EFFECT_PROTOCOL_VERSION,
        id: input.id === undefined ? nextId(kind) : String(input.id),
        kind,
        providerKind: String(input.providerKind || kind),
        operation: String(input.operation || 'dispatch'),
        capability: String(input.capability || kind)
      });
      if (!descriptor.id) {
        throw new PulseRuntimeContractError(
          'PULSE_RUNTIME_EFFECT_ID_INVALID',
          'Pulse effect ids must be non-empty strings.'
        );
      }
      if (dispatchedIds.has(descriptor.id)) {
        throw new PulseRuntimeContractError(
          'PULSE_RUNTIME_EFFECT_ID_DUPLICATE',
          `Pulse effect id ${JSON.stringify(descriptor.id)} is already in use for this request.`
        );
      }
      dispatchedIds.add(descriptor.id);
      totalEffects += 1;
      if (conditionalKv.isConditionalKv(kind)) conditionalKv.registerKvRedactions(descriptor, (value) => redaction.add(value));
      const publicDescriptor = publicEffectDescriptor(descriptor, redaction);
      observe({ type: 'effect-dispatched', effect: publicDescriptor });

      const operationSignal = createEffectSignal(lifecycleController.signal, descriptor);
      const operationExecution = Object.freeze({ ...externalExecution, signal: operationSignal.signal });
      const raw = raceWithSignal(Promise.resolve().then(() => {
        options.requestBudget?.check();
        if (operationSignal.signal.aborted) throw abortedEffectError(operationSignal.signal.reason);
        if (conditionalKv.isConditionalKv(kind)) return conditionalKv.executeConditionalKv(descriptor,
          adapter.prepareConditionalKv || ((_admitted, kvExecution) => () => adapter.dispatch(descriptor, kvExecution)),
          { ...operationExecution, onKvObservation: observe }, limits);
        return Promise.resolve(adapter.dispatch(descriptor, operationExecution)).then(value => {
          retainFetchResponseForBudget(value, options.requestBudget);
          return value;
        });
      }), operationSignal.signal).then(
        (value) => {
          options.requestBudget?.check();
          const normalized = normalizeEffectResult(descriptor, value, limits);
          if (descriptor.kind === 'secret.get' && typeof normalized === 'string') redaction.add(normalized);
          return normalized;
        },
        (error) => { throw redaction.redactError(error); }
      ).finally(operationSignal.dispose);
      const projected = (typeof projector === 'function' ? raw.then(value => { options.requestBudget?.check(); return projector(value); }).then(value => { options.requestBudget?.check(); return value; }) : raw).catch((error) => {
        throw redaction.redactError(error);
      });
      const effectData = {
        execution,
        id: descriptor.id,
        rootId: descriptor.id,
        kind: descriptor.kind,
        descriptor,
        projection: null,
        parallelEligible: normalizedInput.parallelEligible !== false
      };
      const effect = trackEffect(defineEffect(projected, effectData), effectData);
      effect.then(
        () => {
          resolutionIndex += 1;
          resolutionOrder.push(redaction.redactString(descriptor.id));
          observe({
            type: 'effect-settled',
            effect: publicDescriptor,
            resolutionIndex,
            status: 'fulfilled'
          });
        },
        (error) => {
          resolutionIndex += 1;
          resolutionOrder.push(redaction.redactString(descriptor.id));
          observe({
            type: 'effect-settled',
            effect: publicDescriptor,
            resolutionIndex,
            status: 'rejected',
            error: errorIdentity(error, redaction)
          });
        }
      );
      return effect;
    },

    local(kind, producer) {
      assertOpen();
      requireFunction('local effect producer', producer);
      if (totalEffects + localEffects >= maxEffects) {
        throw new PulseRuntimeContractError(
          'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED',
          limitMessage
        );
      }
      const normalizedKind = String(kind || 'local');
      const id = nextId(normalizedKind);
      localEffects += 1;
      const descriptor = Object.freeze({
        version: JAVASCRIPT_EFFECT_PROTOCOL_VERSION,
        id,
        kind: normalizedKind,
        providerKind: 'runtime',
        operation: normalizedKind,
        capability: normalizedKind
      });
      const publicDescriptor = publicEffectDescriptor(descriptor, redaction);
      observe({ type: 'effect-dispatched', effect: publicDescriptor });
      const promise = Promise.resolve().then(() => {
        options.requestBudget?.check();
        if (lifecycleController.signal.aborted) throw abortedEffectError(lifecycleController.signal.reason);
        return producer(externalExecution);
      }).then(value => { options.requestBudget?.check(); return value; }).catch((error) => { throw redaction.redactError(error); });
      const effectData = {
        execution,
        id,
        rootId: id,
        kind: normalizedKind,
        descriptor,
        projection: null,
        parallelEligible: false
      };
      const effect = trackEffect(defineEffect(raceWithSignal(promise, lifecycleController.signal), effectData), effectData);
      effect.then(
        () => {
          resolutionIndex += 1;
          resolutionOrder.push(redaction.redactString(id));
          observe({ type: 'effect-settled', effect: publicDescriptor, resolutionIndex, status: 'fulfilled' });
        },
        (error) => {
          resolutionIndex += 1;
          resolutionOrder.push(redaction.redactString(id));
          observe({ type: 'effect-settled', effect: publicDescriptor, resolutionIndex, status: 'rejected', error: errorIdentity(error, redaction) });
        }
      );
      return effect;
    },

    project(parent, projection, projector) {
      assertOpen();
      const parentData = dataForEffect(parent);
      if (!parentData || parentData.execution !== execution) {
        throw new PulseRuntimeContractError(
          'PULSE_RUNTIME_EFFECT_PROJECTION_INVALID',
          executionKind === 'event'
            ? 'Pulse effect projections require an event-owned Pulse effect.'
            : 'Pulse effect projections require a request-owned Pulse effect.'
        );
      }
      const projected = raceWithSignal(parent.then(value => { options.requestBudget?.check(); return projector(value); }).then(value => { options.requestBudget?.check(); return value; }), lifecycleController.signal).catch((error) => {
        throw redaction.redactError(error);
      });
      const effectData = {
        ...parentData,
        projection: String(projection)
      };
      return trackEffect(defineEffect(projected, effectData), effectData);
    },

    parallel(record) {
      assertOpen();
      const entries = validateParallelRecord(record, execution, claimedParallelRootIds);
      for (const entry of entries) claimedParallelRootIds.add(entry.data.rootId);
      parallelCount += 1;
      const id = `parallel-${parallelCount}`;
      const group = Object.freeze({
        id,
        keys: Object.freeze(entries.map((entry) => entry.key)),
        effectIds: Object.freeze(entries.map((entry) => entry.data.id))
      });
      const publicGroup = Object.freeze(redaction.redactValue(group));
      groups.push(publicGroup);
      observe({ type: 'parallel-dispatched', group: publicGroup });

      const promise = Promise.allSettled(entries.map((entry) => entry.effect)).then((settled) => {
        const failures = [];
        // Native lowering reconstructs an ordinary object literal. Keep the direct
        // JavaScript realization observably aligned rather than returning a map.
        const output = {};
        for (let index = 0; index < settled.length; index += 1) {
          const result = settled[index];
          const entry = entries[index];
          if (result.status === 'fulfilled') {
            Object.defineProperty(output, entry.key, {
              enumerable: true,
              configurable: true,
              writable: true,
              value: result.value
            });
          } else {
            failures.push({
              key: entry.key,
              index,
              effectId: entry.data.id,
              kind: entry.data.kind,
              error: result.reason
            });
          }
        }
        if (failures.length > 0) {
          // Re-apply redaction after every group member has settled. A secret resolved
          // by another member may not have been registered when an earlier failure
          // first crossed the adapter boundary.
          throw redaction.redactError(attachGroupFailure(failures[0].error, failures, redaction));
        }
        return output;
      });
      const parallelEffectData = {
        execution,
        id,
        rootId: id,
        kind: 'parallel',
        descriptor: group,
        projection: null,
        parallelEligible: false
      };
      const parallelEffect = trackEffect(defineEffect(promise, parallelEffectData), parallelEffectData);
      parallelEffect.then(
        () => observe({ type: 'parallel-settled', group: publicGroup, status: 'fulfilled' }),
        (error) => observe({
          type: 'parallel-settled',
          group: publicGroup,
          status: 'rejected',
          error: errorIdentity(error, redaction)
        })
      );
      return parallelEffect;
    },

    async assertIdle() {
      if (pendingEffects.size === 0) return;
      const snapshot = Array.from(pendingEffects.entries());
      const active = Object.freeze(snapshot.map(([, data]) => Object.freeze({
        id: data.id,
        rootId: data.rootId,
        kind: data.kind,
        projection: data.projection
      })));
      const error = new PulseRuntimeContractError(
        'PULSE_RUNTIME_EFFECT_PENDING_AT_HANDLER_RETURN',
        executionKind === 'event'
          ? 'Pulse event handlers must await event-owned effects before completion.'
          : 'Pulse handlers must await request-owned effects before returning or transferring control.',
        { cause: Object.freeze(redaction.redactValue({ effects: active })) }
      );
      if (!lifecycleController.signal.aborted) lifecycleController.abort(error);
      await Promise.allSettled(snapshot.map(([effect]) => effect));
      throw error;
    },

    redactError(error) {
      return redaction.redactError(error);
    },

    redactValue(value) {
      return redaction.redactValue(value);
    },

    summary() {
      return Object.freeze({
        version: JAVASCRIPT_EFFECT_OBSERVATION_VERSION,
        adapter: Object.freeze({ version: adapter.version, id: redaction.redactString(adapter.id) }),
        effectCount: totalEffects,
        localEffectCount: localEffects,
        ownedEffectCount: totalEffects + localEffects,
        parallelCount,
        resolutionOrder: Object.freeze([...resolutionOrder]),
        groups: Object.freeze([...groups]),
        observations: Object.freeze([...observations]),
        redactedSecretCount: redaction.count(),
        aborted: lifecycleController.signal.aborted,
        abortCode: lifecycleController.signal.aborted && lifecycleController.signal.reason && lifecycleController.signal.reason.code
          ? redaction.redactString(lifecycleController.signal.reason.code)
          : undefined,
        closed
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      if (pendingEffects.size > 0 && !lifecycleController.signal.aborted) {
        lifecycleController.abort(new PulseRuntimeContractError(
          'PULSE_RUNTIME_EFFECT_EXECUTION_CLOSED',
          executionKind === 'event'
            ? 'Pulse JavaScript event execution closed with active event-owned effects.'
            : 'Pulse JavaScript effect execution closed with active request-owned effects.'
        ));
      }
      if (pendingEffects.size > 0) await Promise.allSettled(Array.from(pendingEffects.keys()));
      if (removeSourceAbortListener) removeSourceAbortListener();
      if (adapter.dispose) {
        try { await adapter.dispose(externalExecution); }
        catch (error) { throw redaction.redactError(error); }
      }
    }
  };

  return Object.freeze(execution);
}

module.exports = Object.freeze({
  JAVASCRIPT_EFFECT_PROTOCOL_VERSION,
  JAVASCRIPT_EFFECT_ADAPTER_VERSION,
  JAVASCRIPT_EFFECT_OBSERVATION_VERSION,
  DEFAULT_MAX_EFFECTS,
  createJavascriptEffectAdapter,
  createCapabilityEffectAdapter,
  createJavascriptEffectExecution,
  dataForEffect,
  isPulseJavascriptEffect,
  publicEffectDescriptor
});
