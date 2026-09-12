import type {
  Handler,
  PulseEffect,
  PulseKvGeneration, PulseKvVersionedResult, PulseKvConditionalResult,
  PulseFetchResponse,
  PulseParallelEffect,
  PulseParallelResult,
  Router
} from './index';

/** Provider-owned execution metadata supplied to every JavaScript effect. */
export interface PulseJavascriptEffectHostExecution {
  readonly kind: 'request' | 'event';
  readonly request?: Request;
  readonly event?: PulseEventFrame;
  readonly application?: unknown;
  readonly signal?: AbortSignal;
  readonly deadlineMonotonicMs?: number;
  /** Adds execution-owned sensitive text to runtime redaction before provider work continues. */
  registerRedactionValue(value: string | Uint8Array): void;
  /** Applies one project-owned schema codec directly to an in-memory semantic value. */
  validateSchemaValue(
    schemaId: string,
    value: unknown,
    context?: Readonly<{ source?: string; operationId?: string }>
  ): unknown;
}

/** Canonical execution-owned effect descriptor delivered to a trusted provider adapter. */
export interface PulseJavascriptEffectDescriptor {
  readonly version: 'pulse.javascript-effect.v1';
  readonly id: string;
  readonly kind: string;
  readonly providerKind: string;
  readonly operation: string;
  readonly capability: string;
  readonly [field: string]: unknown;
}

/** Host-only preparation hook. Resolving/staging must not dispatch; invoking
 * the returned primitive is the conservative storage dispatch boundary. */
export interface PulseConditionalKvExecution {
  readonly signal?: AbortSignal;
  readonly deadlineMonotonicMs?: number;
  registerRedactionValue?(value: string): void;
  onKvObservation?(value: Readonly<Record<string, unknown>>): void;
}
export interface PulseKvClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}
export type PulseConditionalKvPreparation = (
  effect: Readonly<Record<string, unknown>>,
  execution: PulseConditionalKvExecution
) => Promise<(() => unknown) | undefined> | (() => unknown) | undefined;

export interface PulseJavascriptEffectAdapterInput {
  prepareConditionalKv?: PulseConditionalKvPreparation;
  readonly id?: string;
  dispatch(
    effect: PulseJavascriptEffectDescriptor,
    execution: PulseJavascriptEffectHostExecution
  ): Promise<unknown> | unknown;
  dispose?(execution: PulseJavascriptEffectHostExecution): Promise<void> | void;
}

export interface PulseJavascriptEffectAdapter {
  readonly version: 'pulse.javascript-effect-adapter.v1';
  readonly prepareConditionalKv?: PulseConditionalKvPreparation;
  readonly id: string;
  dispatch(
    effect: PulseJavascriptEffectDescriptor,
    execution: PulseJavascriptEffectHostExecution
  ): Promise<unknown> | unknown;
  dispose?(execution: PulseJavascriptEffectHostExecution): Promise<void> | void;
}

export interface PulseEventAdapterSemantics {
  readonly acceptance: 'host-accepted';
  readonly deliveryGuarantee: 'none';
  readonly autoLoopback: false;
  readonly sameStackReentry: false;
  readonly queueDiscipline: 'fifo-per-declared-adapter';
  readonly executionIsolation: 'one-event-frame-per-execution';
}

export interface PulseEventRecordingAdapterOptions {
  readonly id?: string;
  readonly maxQueueDepth?: number;
}

/** Bounded deterministic event acceptance adapter. It never invokes a local application handler. */
export interface PulseEventRecordingAdapter extends PulseJavascriptEffectAdapter {
  readonly eventAdapter: {
    readonly version: 'pulse.event-adapter.v1';
    readonly id: string;
    readonly maxQueueDepth: number;
    readonly semantics: PulseEventAdapterSemantics;
  };
  acceptedFrames(): readonly PulseEventFrame[];
}

export interface PulseRuntimeHostKvNamespace<T = unknown> {
  getVersioned?(key: string): Promise<PulseKvVersionedResult<T>> | PulseKvVersionedResult<T>;
  insertIfAbsent?(key: string, value: T): Promise<PulseKvConditionalResult> | PulseKvConditionalResult;
  compareAndSwap?(key: string, generation: PulseKvGeneration, value: T): Promise<PulseKvConditionalResult> | PulseKvConditionalResult;
  get(key: string): Promise<T | undefined> | T | undefined;
  put(key: string, value: T): Promise<boolean> | boolean;
}

/** Compatibility injection shape retained while providers move to one effect adapter. */
export interface PulseRuntimeHostCapabilities {
  prepareConditionalKv?: PulseConditionalKvPreparation;
  fetch?(
    url: string,
    init?: unknown,
    execution?: PulseJavascriptEffectHostExecution
  ): Promise<Response | PulseFetchResponse> | Response | PulseFetchResponse;
  config?(
    name: string,
    execution?: PulseJavascriptEffectHostExecution
  ): Promise<string | undefined> | string | undefined;
  secret?(
    name: string,
    execution?: PulseJavascriptEffectHostExecution
  ): Promise<string | undefined> | string | undefined;
  kv?<T = unknown>(
    name: string,
    execution?: PulseJavascriptEffectHostExecution
  ): PulseRuntimeHostKvNamespace<T> | undefined;
  emit?(
    frame: PulseEventFrame,
    execution?: PulseJavascriptEffectHostExecution
  ): Promise<void> | void;
  effect?(
    effect: PulseJavascriptEffectDescriptor,
    execution: PulseJavascriptEffectHostExecution
  ): Promise<unknown> | unknown;
}

export interface PulseJavascriptEffectObservation {
  readonly version: 'pulse.javascript-effect-observation.v1';
  readonly type: 'effect-dispatched' | 'effect-settled' | 'parallel-dispatched' | 'parallel-settled' | 'kv-lifecycle';
  readonly [field: string]: unknown;
}

export interface PulseJavascriptEffectGroupSummary {
  readonly id: string;
  readonly keys: readonly string[];
  readonly effectIds: readonly string[];
}

export interface PulseJavascriptEffectSummary {
  readonly version: 'pulse.javascript-effect-observation.v1';
  readonly adapter: {
    readonly version: 'pulse.javascript-effect-adapter.v1';
  readonly prepareConditionalKv?: PulseConditionalKvPreparation;
    readonly id: string;
  };
  readonly effectCount: number;
  readonly localEffectCount: number;
  readonly ownedEffectCount: number;
  readonly parallelCount: number;
  readonly resolutionOrder: readonly string[];
  readonly groups: readonly PulseJavascriptEffectGroupSummary[];
  readonly observations: readonly PulseJavascriptEffectObservation[];
  readonly redactedSecretCount: number;
  readonly aborted: boolean;
  readonly abortCode?: string;
  readonly closed: boolean;
}

/** Maintainer bridge used by the managed Router lifecycle and focused adapter tests. */
export interface PulseJavascriptEffectExecution {
  /** Execution-owned local projection. It participates in lifecycle containment but is not parallel-eligible. */
  local<T = unknown>(
    kind: string,
    producer: (execution: PulseJavascriptEffectHostExecution) => T | PromiseLike<T>
  ): PulseEffect<T>;
  dispatch<T = unknown>(
    effect: Omit<PulseJavascriptEffectDescriptor, 'version' | 'id'> & { readonly id?: string },
    projector?: (value: unknown) => T
  ): PulseParallelEffect<T>;
  project<T, U>(
    effect: PulseParallelEffect<T>,
    projection: string,
    projector: (value: T) => U | PromiseLike<U>
  ): PulseParallelEffect<U>;
  parallel<T extends Readonly<Record<string, PulseParallelEffect<unknown>>>>(
    effects: T
  ): PulseEffect<PulseParallelResult<T>>;
  /** Applies execution-owned secret redaction to an error before it crosses a managed boundary. */
  redactError(error: unknown): unknown;
  /** Applies execution-owned secret and sensitive-field redaction to structured evidence. */
  redactValue<T = unknown>(value: T): unknown;
  assertIdle(): Promise<void>;
  summary(): PulseJavascriptEffectSummary;
  close(): Promise<void>;
}

export interface PulseRuntimeExecutionOptions {
  /** Host-only monotonic clock/scheduler injection for deterministic lifecycle evidence. */
  readonly kvClock?: PulseKvClock;
  /** Host monotonic deadline; conditional KV uses the earlier of this and 10 seconds. */
  readonly deadlineMonotonicMs?: number;
  /** Compatibility bridge. New providers should inject one shared effectAdapter instead. */
  readonly capabilities?: PulseRuntimeHostCapabilities;
  readonly effectAdapter?: PulseJavascriptEffectAdapter | PulseJavascriptEffectAdapterInput;
  readonly application?: unknown;
  /** Managed execution plane. Direct effect executions default to request. */
  readonly executionKind?: 'request' | 'event';
  /** Normalized event input supplied only for event-owned adapter work. */
  readonly event?: PulseEventFrame;
  readonly requestHeaders?: readonly (readonly [string, string])[];
  readonly signal?: AbortSignal;
  readonly maxEffects?: number;
  /** Optional stricter limits for direct event ingress normalization. */
  readonly eventLimits?: PulseEventLimits;
  /** Maximum bytes materialized by ctx.req.text()/json(). */
  readonly maxRequestBodyBytes?: number;
  /** Maximum bytes materialized by fetched response text()/json() projections. */
  readonly maxFetchBodyBytes?: number;
  /** Shared fallback for request and fetched structured bodies. */
  readonly maxStructuredBodyBytes?: number;
  /** Maximum UTF-8 bytes in config and secret names. */
  readonly maxBindingNameBytes?: number;
  /** Maximum UTF-8 bytes returned by config and secret providers. */
  readonly maxBindingValueBytes?: number;
  /** Maximum UTF-8 bytes in a KV namespace name. */
  readonly maxKvNamespaceBytes?: number;
  /** Maximum UTF-8 bytes in a KV key. */
  readonly maxKvKeyBytes?: number;
  /** Maximum serialized bytes in a detached KV value. */
  readonly maxKvValueBytes?: number;
  /** Maximum nesting depth in a detached KV value. */
  readonly maxKvValueDepth?: number;
  /** Maximum entries in a detached KV value. */
  readonly maxKvValueEntries?: number;
  /** Compiler-generated project schema codec table. This is a host integration surface, not an authoring API. */
  readonly schemaCodecs?: {
    readonly registry?: unknown;
    has(schemaId: string): boolean;
    decode(schemaId: string, value: unknown, source?: string): unknown;
    decodeJsonText(schemaId: string, text: string, source?: string): unknown;
    encodeJsonText(schemaId: string, value: unknown, source?: string): string;
    responseCase?(responseCaseId: string): { readonly id: string; readonly status: number; readonly schemaId: string } | undefined;
    createTraceEvent?(event: unknown, options?: unknown): unknown;
  };
  /** Enforces registered schema IDs at every semantic JSON boundary. */
  readonly strict?: boolean;
  /** Provider-known sensitive values available before the first secret read. */
  readonly redactionValues?: readonly string[];
  /** Resolved synchronous logging threshold. */
  readonly reporting?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 0 | 1 | 2 | 3 | 4;
  /** Provider-owned best-effort logging sink. */
  readonly log?: (level: 1 | 2 | 3 | 4, message: string, event: Readonly<Record<string, unknown>>) => void;
  readonly onLogObservation?: (event: Readonly<Record<string, unknown>>) => void;
  readonly onJsonTrace?: (event: unknown) => void;
  readonly onEffectObservation?: (observation: PulseJavascriptEffectObservation) => void;
  readonly onEffectSummary?: (summary: PulseJavascriptEffectSummary) => void;
}

export declare class PulseRuntimeContractError extends Error {
  readonly code: string;
  readonly detail?: unknown;
}

export declare class PulseUnhandledError extends Error {
  readonly code: 'PULSE_RUNTIME_UNHANDLED_ERROR';
}

export declare function createJavascriptEffectAdapter(
  input: PulseJavascriptEffectAdapterInput
): PulseJavascriptEffectAdapter;
export declare function createCapabilityEffectAdapter(
  capabilities?: PulseRuntimeHostCapabilities
): PulseJavascriptEffectAdapter;
export declare function createEventRecordingAdapter(
  options?: PulseEventRecordingAdapterOptions
): PulseEventRecordingAdapter;
export declare function createJavascriptEffectExecution(
  options?: PulseRuntimeExecutionOptions & { readonly request?: Request }
): PulseJavascriptEffectExecution;
export interface PulseBindingValueLimits {
  readonly maxBindingNameBytes?: number;
  readonly maxBindingValueBytes?: number;
  readonly maxKvNamespaceBytes?: number;
  readonly maxKvKeyBytes?: number;
  readonly maxKvValueBytes?: number;
  readonly maxKvValueDepth?: number;
  readonly maxKvValueEntries?: number;
}
export declare function normalizeBindingName(kind: string, value: unknown, options?: PulseBindingValueLimits): string;
export declare function normalizeBindingValue(
  capability: string,
  name: string,
  value: unknown,
  options?: PulseBindingValueLimits
): string | undefined;
export declare function normalizeKvNamespace(value: unknown, options?: PulseBindingValueLimits): string;
export declare function normalizeKvKey(value: unknown, options?: PulseBindingValueLimits): string;
export declare function cloneKvValue<T>(
  value: T,
  options?: {
    readonly operation?: string;
    readonly allowUndefined?: boolean;
    readonly maxDepth?: number;
    readonly maxEntries?: number;
    readonly maxBytes?: number;
    readonly maxKvValueBytes?: number;
    readonly maxKvValueDepth?: number;
    readonly maxKvValueEntries?: number;
  }
): T;
export declare function normalizeKvPutResult(value: unknown): boolean;
export interface PulseRedactionState {
  add(value: unknown): unknown;
  count(): number;
  redactString(value: unknown): string;
  redactValue(value: unknown): unknown;
  redactError(error: unknown): unknown;
  values(): readonly '<redacted>'[];
  summary(): { readonly registeredSecretCount: number };
}
export declare function createRedactionState(initialValues?: Iterable<unknown> | string): PulseRedactionState;
export declare function isPulseJavascriptEffect(value: unknown): boolean;

export declare function isRouterApplication(value: unknown): value is Router;
export declare function assertRouterApplication(value: unknown): Router;
export declare function normalizeApplication(value: unknown): Router;
export declare function executeRouter(
  application: Router,
  request: Request,
  options?: PulseRuntimeExecutionOptions
): Promise<Response>;
export declare function executeApplication(
  application: Router | Handler,
  request: Request,
  options?: PulseRuntimeExecutionOptions
): Promise<Response>;
export interface PulseEventLimits {
  readonly maxTypeBytes?: number;
  readonly maxSchemaIdBytes?: number;
  readonly maxPayloadBytes?: number;
  readonly maxPayloadDepth?: number;
  readonly maxPayloadEntries?: number;
  readonly maxEvents?: number;
}
export type PulseEventFrame<Payload = unknown> =
  | Readonly<{
      version: 'pulse.event-frame.v1';
      type: string;
      schemaId: string;
      payload: Payload;
    }>
  | Readonly<{
      version: 'pulse.event-frame.v1';
      type: string;
      schemaId: null;
      payload?: never;
    }>;
export type PulseEventExecutionResult =
  | Readonly<{
      version: 'pulse.event-execution-result.v1';
      status: 'completed';
    }>
  | Readonly<{
      version: 'pulse.event-execution-result.v1';
      status: 'failed';
      error: unknown;
    }>;
/** Direct, transport-free JavaScript execution of one canonical Pulse event frame. */
export declare function executeEvent(
  application: Router,
  frame: PulseEventFrame,
  options?: PulseRuntimeExecutionOptions
): Promise<PulseEventExecutionResult>;
export declare function responseBodyClass(response: Response): 'structured' | 'opaque';
export declare function responseHeaderPairs(response: Response): readonly (readonly [string, string])[];
export declare function isPulseFetchResponse(value: unknown): value is PulseFetchResponse;
/** Marks a provider-owned Web Response as an opaque pass-through without copying its body. */
export declare function markOpaqueResponse(
  response: Response,
  headers?: Headers | Readonly<Record<string, string>> | readonly (readonly [string, string])[]
): Response;
export declare function wrapStructuredResponse(response: Response): PulseFetchResponse;
export declare function createOpaqueFetchResponse(input?: {
  readonly status?: number;
  readonly headers?: Headers | Readonly<Record<string, string>> | readonly (readonly [string, string])[];
  readonly bodyHandle?: unknown;
  readonly response?: Response;
}): PulseFetchResponse;

export declare const RUNTIME_HOST_API_VERSION: 'pulse.runtime-host.v3';
export declare const JAVASCRIPT_EFFECT_PROTOCOL_VERSION: 'pulse.javascript-effect.v1';
export declare const JAVASCRIPT_EFFECT_ADAPTER_VERSION: 'pulse.javascript-effect-adapter.v1';
export declare const JAVASCRIPT_EFFECT_OBSERVATION_VERSION: 'pulse.javascript-effect-observation.v1';
export declare const EVENT_ADAPTER_VERSION: 'pulse.event-adapter.v1';
export declare const EVENT_ADAPTER_SEMANTICS: PulseEventAdapterSemantics;
export declare const EVENT_EMIT_CODES: Readonly<{
  INPUT_INVALID: 'PULSE_RUNTIME_EVENT_EMIT_INPUT_INVALID';
  SCHEMA_INVALID: 'PULSE_RUNTIME_EVENT_EMIT_SCHEMA_INVALID';
  ACCEPTANCE_INVALID: 'PULSE_RUNTIME_EVENT_EMIT_ACCEPTANCE_INVALID';
  QUEUE_FULL: 'PULSE_RUNTIME_EVENT_EMIT_QUEUE_FULL';
  ADAPTER_INVALID: 'PULSE_RUNTIME_EVENT_ADAPTER_INVALID';
}>;

/** Shared host-only conditional KV boundary; no provider SDK tokens enter as numbers. */
export declare const KV_CONDITIONAL_KINDS: readonly string[];
export declare const KV_CONDITIONAL_LIMITS: Readonly<Record<string, number>>;
export declare function isConditionalKv(kind: string): boolean;
export declare function normalizeKvGeneration(value: unknown): PulseKvGeneration;
export declare function normalizeConditionalKvKey(value: unknown, options?: PulseBindingValueLimits): string;
export declare function encodeConditionalKvValue(value: unknown, options?: PulseBindingValueLimits): Uint8Array;
export declare function decodeConditionalKvValue(bytes: Uint8Array, options?: PulseBindingValueLimits): unknown;
export declare function admitConditionalKv(input: Readonly<Record<string, unknown>>, options?: PulseRuntimeExecutionOptions): Readonly<Record<string, unknown>>;
export declare function normalizeConditionalKvResult(effect: Readonly<{ kind: string }>, value: unknown, options?: PulseBindingValueLimits): PulseKvVersionedResult<unknown> | PulseKvConditionalResult;
export declare function executeConditionalKv(effect: Readonly<Record<string, unknown>>, prepare: PulseConditionalKvPreparation, execution?: PulseConditionalKvExecution, options?: PulseRuntimeExecutionOptions): Promise<PulseKvVersionedResult<unknown> | PulseKvConditionalResult>;
export declare function registerKvRedactions(effect: Readonly<Record<string, unknown>>, register?: (value: string) => void): void;
