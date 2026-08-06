declare interface EntitiesRuntimeLimits {
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

declare const runtime: {
  readonly ENTITIES_ADAPTER_VERSION: 'pulse.entities-adapter.v1';
  readonly ENTITIES_FAILURE_VERSION: 'pulse.entities-failure.v1';
  readonly ENTITIES_JSON_RPC_ADAPTER_VERSION: 'pulse.entities-json-rpc-adapter.v1';
  readonly ENTITIES_JSON_RPC_OPTIONS: Readonly<{ namedParamsOnly: true; acceptEmptyObjectForNoInput: false }>;
  readonly ENTITIES_DEFAULT_LIMITS: EntitiesRuntimeLimits;
  readonly ENTITIES_LIMIT_KEYS: readonly string[];
  readonly ENTITIES_FAILURE_KINDS: readonly string[];
  readonly ENTITIES_FAILURE_CODES: Readonly<Record<string, string>>;
  readonly ENTITIES_DIAGNOSTIC_CODES: Readonly<Record<string, string>>;
  entitiesContractError(code: string, message: string, detail?: Readonly<Record<string, unknown>>): TypeError & {
    readonly code: string;
    readonly detail: Readonly<Record<string, unknown>>;
  };
  utf8ByteLength(value: unknown): number;
  compareText(left: string, right: string): number;
  normalizeEntityLimits(input?: Readonly<Partial<EntitiesRuntimeLimits>>): EntitiesRuntimeLimits;
  normalizeDiscriminator(value: unknown, limits?: EntitiesRuntimeLimits): string;
  normalizeSchemaId(value: unknown, field?: string): string | null;
  normalizeStaticMetadata(value: unknown, limits?: EntitiesRuntimeLimits): Readonly<Record<string, unknown>> | undefined;
  normalizeEntityDeclaration(input: unknown, limits?: EntitiesRuntimeLimits): Readonly<{
    input: string | null;
    output: string | null;
    metadata?: Readonly<Record<string, unknown>>;
  }>;
  normalizeHandler<T extends Function>(handler: T): T;
  normalizeJsonRpcAdapterOptions(input?: Readonly<{ namedParamsOnly?: true; acceptEmptyObjectForNoInput?: boolean }>): Readonly<{
    namedParamsOnly: true;
    acceptEmptyObjectForNoInput: boolean;
  }>;
  normalizeAdapter(input: unknown, limits?: EntitiesRuntimeLimits): Readonly<{
    version: string;
    id: 'json-rpc';
    adapterVersion: string;
    options: Readonly<Record<string, unknown>>;
    limits: EntitiesRuntimeLimits;
  }>;
  createJsonRpcAdapter(input?: Readonly<{ namedParamsOnly?: true; acceptEmptyObjectForNoInput?: boolean }>, limits?: EntitiesRuntimeLimits): Readonly<{
    version: string;
    id: 'json-rpc';
    adapterVersion: string;
    options: Readonly<{ namedParamsOnly: true; acceptEmptyObjectForNoInput: boolean }>;
    limits: EntitiesRuntimeLimits;
  }>;
  normalizeEntityRegistration(input: unknown, limits?: EntitiesRuntimeLimits): Readonly<{
    discriminator: string;
    declaration: Readonly<{ input: string | null; output: string | null; metadata?: Readonly<Record<string, unknown>> }>;
    handler: Function;
  }>;
  normalizeEntityFailure(input: unknown, limits?: EntitiesRuntimeLimits): Readonly<Record<string, unknown>>;
};

export = runtime;
