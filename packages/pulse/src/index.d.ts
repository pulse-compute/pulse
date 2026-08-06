import { Router } from '@pulse-compute/runtime';

export type {
  HeaderPair,
  PulseEffect,
  PulseParallelEffect,
  PulseEffectResult,
  PulseParallelResult,
  PulseRequest,
  PulseFetchInit,
  PulseStructuredResponse,
  PulseOpaqueResponse,
  PulseFetchResponse,
  PulseFetchOperation,
  PulseResult,
  PulseResponseOptions,
  PulseJsonResponseOptions,
  PulseState,
  PulseLogger,
  PulseKvNamespace,
  PulseEmitEvent,
  PulseExecutionContext,
  PulseContext,
  PulseRouteContext,
  PulseEvent,
  PulseEventContext,
  PulseEventHandler,
  HandlerResult,
  Handler,
  RouterNext,
  RouteHandler,
  RouterMiddleware,
  RouterErrorHandler,
  PulseHandlerResult,
  PulseHandler,
  PulseRouteHandler,
  PulseMiddleware,
  PulseErrorHandler
} from '@pulse-compute/runtime';

export type PulseExecutionTarget = 'native' | 'javascript';
export type PulseReportingLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';
export type PulseCryptoAlgorithm = 'HS256' | 'ES256';
export type PulseCryptoRealization =
  | 'runtime-builtin'
  | 'guest-source:pulse-hmac-as'
  | 'guest-linked:pulse-es256-rustcrypto-p256';
export type PulseCryptoConfiguration =
  | readonly PulseCryptoAlgorithm[]
  | Readonly<Partial<Record<PulseCryptoAlgorithm, Readonly<{
      realization?: PulseCryptoRealization;
    }>>>>;

export interface PulseConfigReference<Name extends string = string> {
  readonly $config: Name;
}

export interface PulseSecretReference<Name extends string = string> {
  readonly $secret: Name;
}

export type PulseSymbolicReference<Name extends string = string> =
  | PulseConfigReference<Name>
  | PulseSecretReference<Name>;

export type PulseStaticValue =
  | null
  | string
  | number
  | boolean
  | PulseSymbolicReference
  | readonly PulseStaticValue[]
  | { readonly [key: string]: PulseStaticValue };

/** Symbolic configuration authority. It never exposes selected profiles or resolved values. */
export interface PulseConfigScope {
  config<const Name extends string>(name: Name): PulseConfigReference<Name>;
  secret<const Name extends string>(name: Name): PulseSecretReference<Name>;
}

export interface PulseProjectOptions {
  /** Workspace-relative application entry. Defaults to src/index.ts. */
  readonly entry?: string;
  /** Optional workspace-relative schema pointer. */
  readonly schema?: string | null;
  /** Optional workspace-relative test harness entry. */
  readonly tests?: string | null;
  /** Fallback after --profile and PULSE_PROFILE. No implicit local profile exists. */
  readonly defaultProfile?: string | null;
  /** Schema-bound request JSON is required when true. Defaults to true. */
  readonly strict?: boolean;
  /** Base log reporting threshold. Defaults to info. */
  readonly reporting?: PulseReportingLevel;
  /** Globally required crypto algorithms. A selected profile declaration replaces this value. */
  readonly crypto?: PulseCryptoConfiguration;
}

export type PulseProfile = Readonly<{
  host: string;
  target: PulseExecutionTarget;
  /** Flat profile override for pulse.reporting. */
  reporting?: PulseReportingLevel;
  /** Required crypto algorithms for this profile. Replaces pulse.crypto rather than merging. */
  crypto?: PulseCryptoConfiguration;
} & Record<string, PulseStaticValue>>;

export type PulseProjectDeclaration = Readonly<{
  pulse?: PulseProjectOptions;
  [profile: string]: PulseProfile | PulseProjectOptions | undefined;
}>;

export interface PulseConfigFactory<out Declaration extends PulseProjectDeclaration = PulseProjectDeclaration> {
  (scope: PulseConfigScope): Declaration;
}

/**
 * Preserve and brand one synchronous project/profile declaration factory.
 * The factory is evaluated only with symbolic config and secret references.
 */
export declare function defineConfig<const Declaration extends PulseProjectDeclaration>(
  factory: PulseConfigFactory<Declaration>
): PulseConfigFactory<Declaration>;

export interface PulseAutoOptions {
  readonly auto: true;
}

declare const pulseProfileTokenBrand: unique symbol;

/** Opaque project-profile composition token. It has no readable public fields. */
export interface PulseProfileToken {
  readonly [pulseProfileTokenBrand]: true;
}

export type PulseEventDeclaration =
  | Readonly<{ schema: string }>
  | Readonly<{ schema: null }>;

/**
 * Project-aware application root. Pulse shares Router registration and execution
 * semantics; the compiler attaches project/profile metadata beside Router IR.
 */
export declare class Pulse extends Router {
  constructor(options: PulseAutoOptions);
  constructor(config: PulseConfigFactory);
  on<Payload = unknown>(
    type: string,
    declaration: Readonly<{ schema: string }>,
    handler: import('@pulse-compute/runtime').PulseEventHandler<Payload>
  ): this;
  on(
    type: string,
    declaration: Readonly<{ schema: null }>,
    handler: import('@pulse-compute/runtime').PulseEventHandler<null>
  ): this;
  profile(): PulseProfileToken;
}

export declare const PULSE_APPLICATION_API_VERSION: 'pulse.application-authoring.v3';
