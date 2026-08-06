declare interface EntitiesLimits {
  readonly maxEnvelopeBytes: number;
  readonly maxPayloadBytes: number;
  readonly maxMethodBytes: number;
  readonly maxEntities: number;
  readonly maxMetadataBytesPerEntity: number;
  readonly maxMetadataBytesPerRouter: number;
  readonly maxMetadataDepth: number;
  readonly maxMetadataEntries: number;
  readonly maxJsonDepth: number;
  readonly maxOutputBytes: number;
  readonly maxErrorMessageBytes: number;
}

declare interface NormalizedEntityDeclaration {
  readonly input: string | null;
  readonly output: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

declare interface NormalizedEntityAdapter {
  readonly version: string;
  readonly id: 'json-rpc';
  readonly adapterVersion: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly limits: EntitiesLimits;
}

declare interface EntitiesContractError extends TypeError {
  readonly code: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

declare const contracts: {
  readonly ENTITIES_PACKAGE_VERSION: 'pulse.entities-package.v1';
  readonly ENTITIES_CONTRACT_VERSION: 'pulse.entities-contract.v1';
  readonly ENTITIES_ADAPTER_VERSION: 'pulse.entities-adapter.v1';
  readonly ENTITIES_PLAN_VERSION: 'pulse.entities-lowering-plan.v1';
  readonly ENTITIES_CATALOG_VERSION: 'pulse.entities-catalog.v1';
  readonly ENTITIES_FAILURE_VERSION: 'pulse.entities-failure.v1';
  readonly ENTITIES_DIAGNOSTIC_VERSION: 'pulse.entities-diagnostics.v1';
  readonly ENTITIES_HANDLER_REFERENCE_VERSION: 'pulse.entities-handler-reference.v1';
  readonly ENTITIES_REGISTRY_VERSION: 'pulse.entities-registry.v1';
  readonly ENTITIES_JSON_RPC_ADAPTER_VERSION: 'pulse.entities-json-rpc-adapter.v1';
  readonly ENTITIES_CONTRACT_ID: 'pulse.entities';
  readonly ENTITIES_PACKAGE_NAME: '@pulse-compute/entities';
  readonly ENTITIES_LOWERER_ID: 'pulse.entities.compiler-builder.v1';
  readonly ENTITIES_LOWERER_EXPORT: 'createEntitiesPackageCompilerBuilder';
  readonly ENTITIES_LOWERER_MANIFEST: './pulsewasm.manifest.cjs';
  readonly ENTITIES_LOWERABLE_SUBPATH: '@pulse-compute/entities';
  readonly ENTITIES_PACKAGE_INTRINSIC_VERSION: 'pulse.package-intrinsic.v1';
  readonly ENTITIES_PUBLIC_SYMBOLS: readonly ['EntityRouter', 'jsonRpc'];
  readonly ENTITIES_PACKAGE_INTRINSICS: Readonly<{
    handle: Readonly<{
      name: 'pulse.entities.handle.v1';
      compilerName: '__pulse_entities_handle';
      valueKind: 'response';
      argumentIndexes: readonly [0];
    }>;
  }>;
  readonly ENTITIES_JSON_RPC_OPTIONS: Readonly<{ namedParamsOnly: true; acceptEmptyObjectForNoInput: false }>;
  readonly ENTITIES_DEFAULT_LIMITS: EntitiesLimits;
  readonly ENTITIES_LIMIT_KEYS: readonly string[];
  readonly ENTITIES_FAILURE_KINDS: readonly string[];
  readonly ENTITIES_FAILURE_CODES: Readonly<Record<string, string>>;
  readonly ENTITIES_DIAGNOSTIC_CODES: Readonly<Record<string, string>>;
  entitiesContractError(code: string, message: string, detail?: Readonly<Record<string, unknown>>): EntitiesContractError;
  normalizeEntityLimits(input?: Readonly<Partial<EntitiesLimits>>): EntitiesLimits;
  normalizeDiscriminator(value: unknown, limits?: EntitiesLimits): string;
  normalizeSchemaId(value: unknown, field?: string): string | null;
  normalizeStaticMetadata(value: unknown, limits?: EntitiesLimits): Readonly<Record<string, unknown>> | undefined;
  normalizeEntityDeclaration(input: unknown, limits?: EntitiesLimits): NormalizedEntityDeclaration;
  normalizeHandler<T extends Function>(handler: T): T;
  normalizeHandlerReference(input: unknown): Readonly<Record<string, string>>;
  normalizeJsonRpcAdapterOptions(input?: Readonly<{ namedParamsOnly?: true; acceptEmptyObjectForNoInput?: boolean }>): Readonly<{
    namedParamsOnly: true;
    acceptEmptyObjectForNoInput: boolean;
  }>;
  normalizeAdapter(input: unknown, limits?: EntitiesLimits): NormalizedEntityAdapter;
  normalizeEntityRegistration(input: unknown, limits?: EntitiesLimits): Readonly<{
    discriminator: string;
    declaration: NormalizedEntityDeclaration;
    handler: Function;
  }>;
  normalizeEntityRegistry(input: readonly unknown[], limits?: EntitiesLimits): Readonly<{
    version: string;
    entries: readonly unknown[];
    registryHash: string;
    limits: EntitiesLimits;
  }>;
  normalizeEntityFailure(input: unknown, limits?: EntitiesLimits): Readonly<Record<string, unknown>>;
  normalizeEntityPlan(input: unknown): Readonly<Record<string, unknown>>;
};

export = contracts;
