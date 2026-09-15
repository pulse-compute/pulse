const { normalizeRequestDuration } = require('@pulse-compute/runtime/host') as { normalizeRequestDuration(value?: number): number | undefined };
import FASTLY_CONFIG_SCHEMA from './config-schema.json';

type FastlySchemaRule = Readonly<{ kind: string; default?: unknown }>;
const fastlySchemaFields = FASTLY_CONFIG_SCHEMA.fields as Readonly<Record<string, FastlySchemaRule>>;
const fastlyDefaults = Object.freeze(Object.fromEntries(Object.entries(fastlySchemaFields).filter(([, rule]) => Object.prototype.hasOwnProperty.call(rule, 'default')).map(([key, rule]) => [key, rule.default]))) as Readonly<Record<string, unknown>>;

export const FASTLY_PROVIDER_API_VERSION = 'pulse.provider-fastly-api.v2' as const;

export interface PulseFastlyGripOptions {
  readonly fanoutBackend?: string;
  readonly publishEndpoint?: string;
  readonly publishUrl?: string;
  readonly publishBackend?: string;
  readonly authentication?: {
    readonly scheme?: 'bearer';
    readonly secretRef: string;
  };
  readonly directHold?: boolean;
}

export interface PulseFastlyLocalOptions {
  readonly networkFetch?: boolean;
}

export interface PulseFastlyProviderOptions {
  readonly maxDurationMs?: number;
  readonly configStore?: string;
  readonly secretStore?: string;
  readonly kv?: Readonly<Record<string, string>>;
  readonly backends?: Readonly<Record<string, string>>;
  readonly dynamicBackends?: boolean;
  readonly grip?: PulseFastlyGripOptions;
  readonly name?: string;
  readonly description?: string;
  readonly authors?: readonly string[];
  readonly local?: PulseFastlyLocalOptions;
}

export interface PulseFastlyProviderConfig {
  readonly maxDurationMs?: number;
  readonly kind: 'fastly';
  readonly version: typeof FASTLY_PROVIDER_API_VERSION;
  readonly bindings: {
    readonly configStore: string;
    readonly secretStore: string;
    readonly kv: Readonly<Record<string, string>>;
    readonly backends: Readonly<Record<string, string>>;
    readonly grip?: {
      readonly fanoutBackend?: string;
      readonly publishEndpoint?: string;
      readonly publishUrl?: string;
      readonly publishBackend?: string;
      readonly authentication?: {
        readonly scheme: 'bearer';
        readonly secretRef: string;
      };
      readonly directHold: boolean;
    };
    readonly dynamicBackends: boolean;
  };
  readonly build: {
    readonly name: string;
    readonly description: string;
    readonly authors: readonly string[];
    readonly language: 'other';
  };
  readonly local: {
    readonly networkFetch: boolean;
  };
  readonly providerSpecificUserland: false;
}

function stringMap(input: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(input ?? {}).map(([key, value]) => [String(key), String(value)])));
}

function gripAuthentication(input: PulseFastlyGripOptions['authentication'] | undefined): NonNullable<PulseFastlyProviderConfig['bindings']['grip']>['authentication'] {
  if (input === undefined) return undefined;
  const scheme = String(input.scheme ?? 'bearer').toLowerCase();
  if (scheme !== 'bearer') throw new TypeError('fastly.grip.authentication.scheme must be bearer.');
  return Object.freeze({
    scheme: 'bearer' as const,
    secretRef: String(input.secretRef),
  });
}

function gripBindings(input: PulseFastlyGripOptions | undefined): NonNullable<PulseFastlyProviderConfig['bindings']['grip']> {
  return Object.freeze({
    fanoutBackend: input?.fanoutBackend === undefined ? undefined : String(input.fanoutBackend),
    publishEndpoint: input?.publishEndpoint === undefined ? undefined : String(input.publishEndpoint),
    publishUrl: input?.publishUrl === undefined ? undefined : String(input.publishUrl),
    publishBackend: input?.publishBackend === undefined ? undefined : String(input.publishBackend),
    authentication: gripAuthentication(input?.authentication),
    directHold: input?.directHold === undefined ? Boolean(fastlyDefaults['fastly.grip.directHold']) : input.directHold !== false
  });
}

export function fastly(options: PulseFastlyProviderOptions = {}): PulseFastlyProviderConfig {
  const normalizedGrip = options.grip === undefined ? undefined : gripBindings(options.grip);
  return Object.freeze({
    kind: 'fastly',
    maxDurationMs: normalizeRequestDuration(options.maxDurationMs),
    version: FASTLY_PROVIDER_API_VERSION,
    bindings: Object.freeze({
      configStore: String(options.configStore ?? fastlyDefaults['fastly.configStore']),
      secretStore: String(options.secretStore ?? fastlyDefaults['fastly.secretStore']),
      kv: stringMap(options.kv),
      backends: stringMap(options.backends),
      ...(normalizedGrip ? { grip: normalizedGrip } : {}),
      dynamicBackends: options.dynamicBackends === undefined ? Boolean(fastlyDefaults['fastly.dynamicBackends']) : options.dynamicBackends === true
    }),
    build: Object.freeze({
      name: String(options.name ?? fastlyDefaults['fastly.name']),
      description: String(options.description ?? fastlyDefaults['fastly.description']),
      authors: Object.freeze((options.authors ?? (Array.isArray(fastlyDefaults['fastly.authors']) ? fastlyDefaults['fastly.authors'] : [])).map(String)),
      language: 'other'
    }),
    local: Object.freeze({ networkFetch: Boolean(options.local?.networkFetch ?? fastlyDefaults['fastly.local.networkFetch']) }),
    providerSpecificUserland: false
  });
}
