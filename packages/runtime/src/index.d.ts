export type HeaderPair = readonly [name: string, value: string];

declare const pulseEffectBrand: unique symbol;
declare const pulseParallelEffectBrand: unique symbol;

export interface PulseEffect<T> extends Promise<T> {
  readonly [pulseEffectBrand]: T;
}

/** An externally dispatched Pulse effect that may be a member of ctx.parallel(). */
export interface PulseParallelEffect<T> extends PulseEffect<T> {
  readonly [pulseParallelEffectBrand]: true;
}

export type PulseEffectResult<T> = T extends PulseEffect<infer Result> ? Result : never;
export type PulseParallelResult<T extends Readonly<Record<string, PulseParallelEffect<unknown>>>> = {
  readonly [Key in keyof T]: PulseEffectResult<T[Key]>;
};

export interface PulseRequest {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly headers: readonly HeaderPair[];
  header(name: string): string | undefined;
  text(): PulseEffect<string>;
  json<T = unknown>(schemaId?: string): PulseEffect<T>;
}

export interface PulseFetchInitBase {
  readonly method?: 'GET' | 'HEAD' | 'POST';
  readonly headers?: Readonly<Record<string, string>> | readonly HeaderPair[];
  readonly timeoutMs?: number;
}

export type PulseFetchInit = PulseFetchInitBase & (
  | { readonly body?: never; readonly json?: never; readonly schema?: never }
  | { readonly body: string; readonly json?: never; readonly schema?: never }
  | { readonly body?: never; readonly json: unknown; readonly schema?: string }
);

export interface PulseStructuredResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly kind: string;
  readonly bodyClass: 'structured';
  readonly headers: readonly HeaderPair[];
  header(name: string): string | undefined;
  text(): PulseEffect<string>;
  json<T = unknown>(schemaId?: string): PulseEffect<T>;
}

export interface PulseOpaqueResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly kind: 'stream';
  readonly bodyClass: 'opaque';
  readonly headers: readonly HeaderPair[];
  header(name: string): string | undefined;
  /** Opaque host-owned handle. It is returnable but not inspectable or iterable. */
  readonly bodyHandle: unknown;
  /** Opaque pass-through bodies cannot be inspected. */
  text(): never;
  /** Opaque pass-through bodies cannot be inspected. */
  json<T = unknown>(schemaId?: string): never;
}

export type PulseFetchResponse = PulseStructuredResponse | PulseOpaqueResponse;

export interface PulseFetchOperation extends PulseParallelEffect<PulseOpaqueResponse> {
  text(): PulseParallelEffect<string>;
  json<T = unknown>(schemaId?: string): PulseParallelEffect<T>;
}

export interface PulseResult {
  readonly status: number;
  readonly kind: string;
  readonly bodyClass: 'structured' | 'opaque';
  readonly headers: readonly HeaderPair[];
}

export interface PulseResponseOptions {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>> | readonly HeaderPair[];
}

export interface PulseJsonResponseOptions extends PulseResponseOptions {
  /** Exact schema ID declared by the project. */
  readonly schema?: string;
}

export interface PulseState {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface PulseLogger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

// Opaque, bounded string. It is neither an application version nor a number.
export type PulseKvGeneration = string;
export type PulseKvReadFailureReason =
  | 'invalid-key' | 'configuration' | 'not-authorized' | 'throttled'
  | 'unavailable' | 'transport' | 'timeout' | 'protocol' | 'too-large' | 'invalid-value';
export type PulseKvVersionedResult<T> =
  | { readonly status: 'found'; readonly value: T; readonly generation: PulseKvGeneration }
  | { readonly status: 'not-found' }
  | { readonly status: 'failed'; readonly reason: PulseKvReadFailureReason };

export type PulseKvNotStoredReason =
  | 'invalid-key' | 'invalid-value' | 'invalid-generation' | 'too-large'
  | 'configuration' | 'not-authorized' | 'throttled' | 'rejected'
  | 'unavailable' | 'transport' | 'timeout' | 'protocol';
export type PulseKvConditionalResult =
  | { readonly status: 'stored' }
  | { readonly status: 'conflict' }
  | { readonly status: 'not-stored'; readonly reason: PulseKvNotStoredReason }
  | { readonly status: 'unknown'; readonly reason: 'transport' | 'timeout' | 'unavailable' | 'protocol' };

export interface PulseKvNamespace<T = unknown> {
  getVersioned(key: string): PulseParallelEffect<PulseKvVersionedResult<T>>;
  insertIfAbsent(key: string, value: T): PulseParallelEffect<PulseKvConditionalResult>;
  compareAndSwap(key: string, generation: PulseKvGeneration, value: T): PulseParallelEffect<PulseKvConditionalResult>;
  get(key: string): PulseParallelEffect<T | undefined>;
  put(key: string, value: T): PulseParallelEffect<boolean>;
}

export type PulseEmitEvent<Payload = unknown> =
  | Readonly<{ schema: string; payload: Payload }>
  | Readonly<{ schema: null; payload?: never }>;

/** Plane-neutral authority shared by one isolated HTTP request or event invocation. */
export interface PulseExecutionContext {
  /** Validate/project a value through a literal registered schema and return bounded JSON text. */
  encodeJson(value: unknown, schemaId: string): string;
  readonly state: PulseState;
  readonly log: PulseLogger;
  fetch(url: string, init?: PulseFetchInit): PulseFetchOperation;
  /** Dispatches a statically keyed group of independent Pulse effects and rejoins in property order. */
  parallel<const T extends Readonly<Record<string, PulseParallelEffect<unknown>>>>(effects: T): PulseEffect<PulseParallelResult<T>>;
  readonly config: { get(name: string): PulseParallelEffect<string | undefined> };
  readonly secret: { get(name: string): PulseParallelEffect<string | undefined> };
  kv<T = unknown>(name: string): PulseKvNamespace<T>;
  emit<Payload = unknown>(
    type: string,
    event: Readonly<{ schema: string; payload: Payload }>
  ): PulseParallelEffect<void>;
  emit(
    type: string,
    event: Readonly<{ schema: null; payload?: never }>
  ): PulseParallelEffect<void>;
}

/** HTTP request execution context. */
export interface PulseContext extends PulseExecutionContext {
  readonly req: PulseRequest;
  json(value: unknown, descriptor?: PulseJsonResponseOptions | string): PulseResult;
  text(value: string, options?: PulseResponseOptions): PulseResult;
  response(input?: PulseResponseOptions & { readonly body?: string }): PulseResult;
}

export interface PulseRouteContext extends PulseContext {
  /** Returns the named static route parameter for the matched Router path. */
  param(name: string): string | undefined;
}

export interface PulseEvent<Payload = unknown> {
  readonly type: string;
  readonly payload: Payload;
}

/** Non-HTTP event execution context. Event handlers cannot access request or response fields. */
export interface PulseEventContext<Payload = unknown> extends PulseExecutionContext {
  readonly event: PulseEvent<Payload>;
}

export type PulseEventHandler<Payload = unknown> = (ctx: PulseEventContext<Payload>) => Promise<void>;

export type HandlerResult = PulseResult | PulseFetchResponse;
export type Handler = (ctx: PulseContext) => Promise<HandlerResult>;
/** Terminal Router control transfer. The current handler never resumes after this value is returned. */
export type RouterNext = (error?: unknown) => never;
export type RouteHandler = (ctx: PulseRouteContext, next: RouterNext) => Promise<HandlerResult>;
export type RouterMiddleware = (ctx: PulseContext, next: RouterNext) => Promise<HandlerResult>;
export type RouterErrorHandler = (error: unknown, ctx: PulseContext, next: RouterNext) => Promise<HandlerResult>;

/** Canonical Pulse-prefixed aliases. They do not create a second handler or Router algebra. */
export type PulseHandlerResult = HandlerResult;
export type PulseHandler = Handler;
export type PulseRouteHandler = RouteHandler;
export type PulseMiddleware = RouterMiddleware;
export type PulseErrorHandler = RouterErrorHandler;

/**
 * Static authoring marker compiled by Pulse. Router instances are not runtime dispatchers.
 * Canonical v2 supports terminal middleware/error transfer, get/head/post/put/patch/delete routes,
 * fallthrough, and acyclic static mounts.
 */
export declare class Router {
  use(handler: RouterMiddleware): this;
  use(path: string, handler: RouterMiddleware): this;
  get(path: string, handler: RouteHandler): this;
  head(path: string, handler: RouteHandler): this;
  post(path: string, handler: RouteHandler): this;
  put(path: string, handler: RouteHandler): this;
  patch(path: string, handler: RouteHandler): this;
  delete(path: string, handler: RouteHandler): this;
  mount(path: string, router: Router): this;
  error(handler: RouterErrorHandler): this;
}

export declare const RUNTIME_API_VERSION: 'pulse.runtime-authoring.v4';
export declare const ROUTER_API_VERSION: 'pulse.router-authoring.v2';
