import type { PulseContext, PulseParallelEffect } from './index';

export declare const PACKAGE_RUNTIME_BRIDGE_VERSION: 'pulse.package-runtime-bridge.v1';
export declare const PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION: 'pulse.first-party-embedded-schema-codec-bridge.v1';

export interface PulsePackageRuntimeContext {
  /**
   * Detached request metadata view. URL, method, headers, and lifecycle signal
   * are preserved, but the application-owned request body is unavailable.
   * Body projection methods reject with
   * `PULSE_RUNTIME_PACKAGE_REQUEST_BODY_UNAVAILABLE`.
   */
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly path: {
    readonly absolute: string;
    readonly relative: string;
  };
  readonly signal?: AbortSignal;
}

export interface PulsePackageEffectOperation<Result = unknown> {
  readonly kind: string;
  readonly capability: string;
  readonly result: string;
  /** Type-only result carrier. It is not inspected at runtime. */
  readonly __result?: Result;
}

export interface PulsePackageRuntimeDefinition<
  Operations extends Readonly<Record<string, PulsePackageEffectOperation<unknown>>>
> {
  readonly package: string;
  readonly contractId: string;
  readonly providerKind: string;
  readonly operations: Operations;
}

export type PulsePackageOperationResult<Operation> =
  Operation extends PulsePackageEffectOperation<infer Result> ? Result : unknown;

export interface PulsePackageRuntime<
  Operations extends Readonly<Record<string, PulsePackageEffectOperation<unknown>>>
> {
  readonly version: typeof PACKAGE_RUNTIME_BRIDGE_VERSION;
  readonly package: string;
  readonly contractId: string;
  readonly providerKind: string;
  context(ctx: PulseContext): PulsePackageRuntimeContext;
  effect<Key extends keyof Operations & string>(
    ctx: PulseContext,
    operation: Key,
    payload?: Readonly<Record<string, unknown>>,
  ): PulseParallelEffect<PulsePackageOperationResult<Operations[Key]>>;
  effect<Key extends keyof Operations & string, Result>(
    ctx: PulseContext,
    operation: Key,
    payload: Readonly<Record<string, unknown>> | undefined,
    projector: (value: unknown) => Result | PromiseLike<Result>,
  ): PulseParallelEffect<Result>;
}

export interface PulsePackageSchemaDeclaration {
  readonly input: string | null;
  readonly output: string | null;
}

export type PulsePackageSchemaReadonly<Value> =
  Value extends (...args: never[]) => unknown ? Value
    : Value extends readonly (infer Entry)[] ? readonly PulsePackageSchemaReadonly<Entry>[]
      : Value extends object ? { readonly [Key in keyof Value]: PulsePackageSchemaReadonly<Value[Key]> }
        : Value;

export interface PulsePackageSchemaCodecBridge {
  decodeEmbeddedJson<Value = unknown>(schemaId: string, packageOwnedText: string): PulsePackageSchemaReadonly<Value>;
  encodeEmbeddedJson(schemaId: string, packageOwnedValue: unknown): string;
}

export interface PulsePackageSchemaCodecRuntime {
  readonly version: typeof PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION;
  readonly package: string;
  readonly contractId: string;
  bind(ctx: PulseContext, declaration: PulsePackageSchemaDeclaration): PulsePackageSchemaCodecBridge;
}

export interface PulsePackageSchemaCodecRuntimeDefinition {
  readonly package: string;
  readonly contractId: string;
}

export declare const TRUSTED_PACKAGE_EFFECT_CATALOG: Readonly<Record<string, {
  readonly contractId: string;
  readonly providerKind: string;
  readonly operations: Readonly<Record<string, {
    readonly kind: string;
    readonly capability: string;
    readonly result: string;
  }>>;
}>>;

export declare function clonePackageEffectPayload<T extends Readonly<Record<string, unknown>>>(
  payload: T,
  limits?: {
    readonly maxBytes?: number;
    readonly maxDepth?: number;
    readonly maxEntries?: number;
  },
): T;

export declare function createPackageRuntime<
  const Operations extends Readonly<Record<string, PulsePackageEffectOperation<unknown>>>
>(definition: PulsePackageRuntimeDefinition<Operations>): PulsePackageRuntime<Operations>;

export declare function createPackageSchemaCodecRuntime(
  definition: PulsePackageSchemaCodecRuntimeDefinition,
): PulsePackageSchemaCodecRuntime;

declare const packageRuntime: Readonly<{
  PACKAGE_RUNTIME_BRIDGE_VERSION: typeof PACKAGE_RUNTIME_BRIDGE_VERSION;
  PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION: typeof PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION;
  TRUSTED_PACKAGE_EFFECT_CATALOG: typeof TRUSTED_PACKAGE_EFFECT_CATALOG;
  clonePackageEffectPayload: typeof clonePackageEffectPayload;
  createPackageRuntime: typeof createPackageRuntime;
  createPackageSchemaCodecRuntime: typeof createPackageSchemaCodecRuntime;
}>;

export default packageRuntime;
