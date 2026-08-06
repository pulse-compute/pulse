'use strict';

const {
  DEFAULT_REPORTING_LEVEL,
  REPORTING_LEVEL_NAMES
} = require('@pulse-compute/wasm-contracts/logging');
const {
  CRYPTO_ALGORITHMS,
  CRYPTO_REALIZATIONS,
  normalizeCryptoConfiguration
} = require('@pulse-compute/wasm-contracts/crypto/contracts');
const { providerIds, providerConfigReferences } = require('./provider-drivers.js');

const PROJECT_CONFIG_SCHEMA_VERSION = 'pulse.project-config-schema.v1';
const PROJECT_CONFIG_REFERENCE_VERSION = PROJECT_CONFIG_SCHEMA_VERSION;
const builtinProviderIds = providerIds();
const providerReferenceContributions = providerConfigReferences();
const providerConfigSections = Object.freeze(providerReferenceContributions.flatMap((entry) => entry.sections || []));
const providerConfigFields = Object.freeze(providerReferenceContributions.flatMap((entry) => entry.fields || []));
const providerIdType = `${builtinProviderIds.map((id) => `'${id}'`).join(' | ')} | scoped package name`;
const providerIdList = builtinProviderIds.map((id) => `\`${id}\``).join(', ');
const cryptoRealizationIds = [...new Set(CRYPTO_REALIZATIONS.map((entry) => entry.id))];

function field(value) {
  return Object.freeze({
    required: false,
    default: '—',
    allowed: '—',
    precedence: 'Configuration value.',
    security: 'No special handling.',
    diagnostics: Object.freeze([]),
    ...value,
    diagnostics: Object.freeze([...(value.diagnostics || [])])
  });
}

const CONFIG_SECTIONS = Object.freeze([
  Object.freeze({ id: 'project', title: 'Project and provider selection', description: 'Select the canonical entry, provider, and build output.' }),
  Object.freeze({ id: 'crypto', title: 'Cryptographic requirements', description: 'Declare exact algorithms for the global or selected profile and resolve one target realization without fallback. This surface is part of the synchronized 1.0.0-beta.1 package set.' }),
  Object.freeze({ id: 'schemas', title: 'JSON schema policy', description: 'Configure bounded schema-body policy. Conventional projects declare registry identity only through pulse.schema.' }),
  Object.freeze({ id: 'dev', title: 'Local development', description: 'Configure the foreground local server and local-only provider inputs.' }),
  ...providerConfigSections
]);

const CONFIG_FIELDS = Object.freeze([
  field({ section: 'project', path: 'entry', type: 'string', default: '`./src/index.ts`', scope: 'all project commands', description: 'Project-relative TypeScript handler entry.', precedence: '`pulse.entry` in `.pulse/config.ts`.', security: 'Must resolve to an existing file.', diagnostics: ['PULSE_ENTRY_NOT_FOUND'] }),
  field({ section: 'project', path: 'provider', type: `${providerIdType} | provider configuration`, default: '`node`', allowed: `${providerIdList}, another bare host id, or an exact scoped package name`, scope: 'compile/build/dev/test', description: 'Selects provider validation, local conformance, and build realization through the provider package toolchain contract.', precedence: 'Bare host ids resolve to `@pulse-compute/provider-<id>`; scoped package names are loaded exactly from the project.', security: 'Package loading is explicit and limited to the selected package `./toolchain` export; there is no scanning or fallback discovery.', diagnostics: ['PULSE_PROVIDER_PACKAGE_NOT_FOUND', 'PULSE_PROVIDER_TOOLCHAIN_LOAD_FAILED', 'PULSE_PROVIDER_TOOLCHAIN_INVALID', 'PULSE_PROVIDER_UNSUPPORTED', 'PULSE_PROVIDER_COMPILE_ONLY', 'PULSE_TEST_PROVIDER_REQUIRED', 'PULSE_DEV_PROVIDER_UNSUPPORTED'] }),
  field({ section: 'project', path: 'outDir', type: 'string', default: '`./dist`', scope: 'compile/build', description: 'Project-relative artifact output directory.', precedence: '`--out` overrides this field for the current command.', security: 'Must remain a real child of the project root; absolute, parent-traversal, and symbolic-link traversal outside the project root is rejected.', diagnostics: ['PULSE_BUILD_OUT_UNSAFE'] }),
  field({ section: 'project', path: 'reporting', type: "'off' | 'error' | 'warn' | 'info' | 'debug'", default: '`info`', allowed: '`off`, `error`, `warn`, `info`, `debug`', scope: 'compile/build/dev/test', description: 'Resolved synchronous logging threshold after the flat profile override is applied.', precedence: 'Selected-profile `reporting`, then `pulse.reporting`, then `info`.', security: 'Known request-owned secret values are redacted before provider emission.', diagnostics: ['PULSE_REPORTING_LEVEL_UNSUPPORTED'] }),

  field({ section: 'crypto', path: 'pulse.crypto', type: "readonly ('HS256' | 'ES256')[] | { readonly HS256?: { readonly realization?: PulseCryptoRealization }; readonly ES256?: { readonly realization?: PulseCryptoRealization } }", default: 'implicit no-crypto declaration', allowed: '`HS256`, `ES256`; exact pins `runtime-builtin`, `guest-source:pulse-hmac-as`, and `guest-linked:pulse-es256-rustcrypto-p256`', scope: 'global crypto requirement default', description: 'Declares the complete global algorithm set. Array entries are canonical algorithm names; object entries may pin one exact known realization.', precedence: 'Used only when the selected profile omits `crypto`.', security: 'Keys and verification bytes are not configuration values. Target selection is deterministic and never probes or falls back.', diagnostics: ['PULSE_CRYPTO_CONFIG_SHAPE_INVALID', 'PULSE_CRYPTO_ALGORITHM_DUPLICATE', 'PULSE_CRYPTO_ALGORITHM_UNKNOWN', 'PULSE_CRYPTO_REALIZATION_UNKNOWN'] }),
  field({ section: 'crypto', path: '<profile>.crypto', type: "readonly ('HS256' | 'ES256')[] | { readonly HS256?: { readonly realization?: PulseCryptoRealization }; readonly ES256?: { readonly realization?: PulseCryptoRealization } }", default: 'inherit `pulse.crypto` when absent', allowed: '`[]` and `{}` explicitly select no crypto; otherwise `HS256` and/or `ES256`', scope: 'selected profile', description: 'Replaces the complete global crypto declaration for the selected profile. Arrays and objects never merge with `pulse.crypto`.', precedence: 'Selected-profile declaration replaces `pulse.crypto`; absence inherits it.', security: 'Every declared algorithm must resolve for the selected target before lowering. A failed exact realization cannot select another backend.', diagnostics: ['PULSE_CRYPTO_CONFIG_REQUIRED', 'PULSE_CRYPTO_REALIZATION_PIN_INVALID', 'PULSE_CRYPTO_REALIZATION_UNAVAILABLE'] }),

  field({ section: 'schemas', path: 'schemas', type: 'PulseSchemaConfig', default: '`{}`', scope: 'compile/dev/test/build', description: 'Sets schema body limits and content-type policy. Schema identities come from the module selected by pulse.schema.', security: 'Structured bodies are bounded before decoding.', diagnostics: ['PULSE_SCHEMA_COMPILE_FAILED'] }),
  field({ section: 'schemas', path: 'schemas.contentTypePolicy', type: "'accept-json-or-missing' | 'require-json'", default: '`accept-json-or-missing`', allowed: '`accept-json-or-missing`, `require-json`', scope: 'request and fetched-body schema decode', description: 'Controls whether a JSON content type is mandatory.', diagnostics: ['PULSE_SCHEMA_CONTENT_TYPE_POLICY_INVALID', 'PULSE_SCHEMA_DECODE'] }),
  field({ section: 'schemas', path: 'schemas.maxBytes', type: 'positive safe integer', default: '`65_536`', scope: 'structured schema decode', description: 'Maximum buffered bytes accepted by schema decoding.', security: 'Raise deliberately; this is a memory and request-amplification boundary.', diagnostics: ['PULSE_SCHEMA_BODY_LIMIT_INVALID', 'PULSE_BODY_TOO_LARGE'] }),

  field({ section: 'dev', path: 'dev', type: 'object', default: '`{}`', scope: 'pulse dev and local conformance', description: 'Development listener and local fixture inputs.' }),
  field({ section: 'dev', path: 'dev.host', type: 'string', default: '`127.0.0.1`', scope: 'pulse dev', description: 'Listener host.', precedence: '`--host` overrides this field.', security: 'Binding a non-loopback address exposes the local development server.', diagnostics: ['PULSE_DEV_HOST_INVALID'] }),
  field({ section: 'dev', path: 'dev.port', type: 'integer', default: '`8787`', allowed: '`0`–`65535`; `0` requests an ephemeral port', scope: 'pulse dev', description: 'Listener port.', precedence: '`--port` overrides this field.', diagnostics: ['PULSE_DEV_PORT_INVALID'] }),
  field({ section: 'dev', path: 'dev.watch', type: 'boolean', default: '`true`', scope: 'pulse dev', description: 'Watches the entry and schema dependency graph.', precedence: '`--watch` or `--no-watch` overrides this field.', security: 'Configuration-file changes still require a restart.' }),
  field({ section: 'dev', path: 'dev.maxBodyBytes', type: 'positive safe integer', default: '`65_536`', scope: 'incoming local requests', description: 'Maximum request body accepted by the local development server.', security: 'Raise deliberately; this is a memory and request-amplification boundary.', diagnostics: ['PULSE_DEV_BODY_LIMIT_INVALID', 'PULSE_REQUEST_BODY_TOO_LARGE'] }),
  field({ section: 'dev', path: 'dev.networkFetch', type: 'boolean', default: 'selected provider default', scope: 'local fetch realization', description: 'Allows unmatched local fetches to use the network.', precedence: 'This explicit field overrides the selected provider local default.', security: 'Keep disabled for deterministic or untrusted test inputs.', diagnostics: ['PULSE_FETCH_IMPLEMENTATION_UNAVAILABLE', 'PULSE_FETCH_NETWORK'] }),
  field({ section: 'dev', path: 'dev.config', type: 'Readonly<Record<string, string>>', default: '`{}`', scope: 'local config capability', description: 'Local configuration-store values.', security: 'Development input only; it does not configure deployed provider stores.' }),
  field({ section: 'dev', path: 'dev.secrets', type: 'Readonly<Record<string, string>>', default: '`{}`', scope: 'local secret capability', description: 'Local secret-store values.', security: 'Raw values are omitted from project JSON, diagnostics, and runtime error details; do not commit real production secrets.' }),
  field({ section: 'dev', path: 'dev.kv', type: 'Readonly<Record<string, Readonly<Record<string, unknown>>>>', default: '`{}`', scope: 'local KV capability', description: 'Local KV stores keyed by configured logical store name.', security: 'Development input only; it is not deployed.' }),
  field({ section: 'dev', path: 'dev.fetches', type: 'Readonly<Record<string, unknown>>', default: '`{}`', scope: 'local fetch capability', description: 'Deterministic fetch fixtures resolved before optional live network fetch.', security: 'Prefer fixtures for deterministic tests and offline development.' }),
  ...providerConfigFields.map(field)
]);

const CONFIG_DISCOVERY = Object.freeze(['.pulse/config.ts']);

const CONFIG_PRECEDENCE = Object.freeze([
  'Discovery starts at the positional directory or the current working directory and searches upward for .pulse/config.ts.',
  'Profile precedence is --profile, PULSE_PROFILE, then pulse.defaultProfile.',
  'A selected-profile crypto declaration replaces pulse.crypto completely; array and object forms never merge.',
  'Command-line output, host, port, and watch values override the corresponding active-profile field for that command. Entry, provider, and target remain project-configured.',
  'Dedicated harness case inputs replace development inputs for that case; they do not configure deployment resources.',
  'Provider deployment bindings come from the configured provider object; handler source never receives provider SDK objects.'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

const CONFIG_RUNTIME_RULES = Object.freeze({
  entry: Object.freeze({ kind: 'string', default: './src/index.ts', nonEmpty: true }),
  provider: Object.freeze({ kind: 'provider-package', default: 'node', builtinValues: builtinProviderIds }),
  outDir: Object.freeze({ kind: 'string', default: './dist', nonEmpty: true }),
  reporting: Object.freeze({ kind: 'enum', default: DEFAULT_REPORTING_LEVEL, values: REPORTING_LEVEL_NAMES }),
  crypto: Object.freeze({ kind: 'crypto-configuration', optional: true }),
  'schemas.contentTypePolicy': Object.freeze({ kind: 'enum', default: 'accept-json-or-missing', values: Object.freeze(['accept-json-or-missing', 'require-json']) }),
  'schemas.maxBytes': Object.freeze({ kind: 'positive-safe-integer', default: 65536 }),
  'dev.host': Object.freeze({ kind: 'string', default: '127.0.0.1', nonEmpty: true }),
  'dev.port': Object.freeze({ kind: 'integer', default: 8787, minimum: 0, maximum: 65535 }),
  'dev.watch': Object.freeze({ kind: 'boolean', default: true }),
  'dev.maxBodyBytes': Object.freeze({ kind: 'positive-safe-integer', default: 65536 }),
  'harness.maxBodyBytes': Object.freeze({ kind: 'positive-safe-integer', optional: true }),
  'harness.continuationTtlMs': Object.freeze({ kind: 'non-negative-safe-integer', optional: true })
 });

const PROJECT_CONFIG_JSON_SCHEMA = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pulse:project-config:v1',
  title: 'Pulse project configuration',
  type: 'object',
  additionalProperties: false,
  properties: {
    entry: { type: 'string', minLength: 1, default: './src/index.ts' },
    provider: {
      oneOf: [
        { type: 'string', minLength: 1 },
        {
          type: 'object',
          required: ['kind'],
          properties: { kind: { type: 'string', minLength: 1 } },
          additionalProperties: true
        }
      ],
      default: 'node'
    },
    outDir: { type: 'string', minLength: 1, default: './dist' },
    reporting: { enum: [...REPORTING_LEVEL_NAMES], default: DEFAULT_REPORTING_LEVEL },
    crypto: {
      oneOf: [
        {
          type: 'array',
          uniqueItems: true,
          items: { enum: [...CRYPTO_ALGORITHMS] }
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(CRYPTO_ALGORITHMS.map((algorithm) => [
            algorithm,
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                realization: { enum: [...cryptoRealizationIds] }
              }
            }
          ]))
        }
      ]
    },
    schemas: {
      type: 'object',
      additionalProperties: false,
      properties: {
        contentTypePolicy: { enum: ['accept-json-or-missing', 'require-json'], default: 'accept-json-or-missing' },
        maxBytes: { type: 'integer', minimum: 1, maximum: 9007199254740991, default: 65536 }
      }
    },
    dev: {
      type: 'object',
      additionalProperties: false,
      properties: {
        host: { type: 'string', minLength: 1, default: '127.0.0.1' },
        port: { type: 'integer', minimum: 0, maximum: 65535, default: 8787 },
        watch: { type: 'boolean', default: true },
        maxBodyBytes: { type: 'integer', minimum: 1, maximum: 9007199254740991, default: 65536 },
        networkFetch: { type: 'boolean' },
        config: { type: 'object', additionalProperties: { type: 'string' } },
        secrets: { type: 'object', additionalProperties: { type: 'string' } },
        kv: { type: 'object', additionalProperties: { type: 'object' } },
        fetches: { type: 'object' }
      }
    }
  }
});

const CONFIG_CONTAINER_KEYS = deepFreeze({
  '$': ['entry', 'provider', 'outDir', 'reporting', 'crypto', 'schemas', 'dev'],
  'schemas': ['contentTypePolicy', 'maxBytes'],
  'dev': ['host', 'port', 'watch', 'maxBodyBytes', 'networkFetch', 'config', 'secrets', 'kv', 'fetches']
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateProjectConfigStructure(input) {
  const issues = [];
  const issue = (path, message) => issues.push(Object.freeze({ path, message }));
  const checkObject = (value, owner, path) => {
    if (!isRecord(value)) { issue(path, 'must be an object'); return false; }
    const allowed = new Set(CONFIG_CONTAINER_KEYS[owner]);
    for (const key of Object.keys(value)) if (!allowed.has(key)) issue(path === '$' ? key : `${path}.${key}`, 'is not a supported configuration field');
    return true;
  };
  if (!checkObject(input, '$', '$')) return Object.freeze(issues);
  if (input.provider !== undefined && !(typeof input.provider === 'string' || (isRecord(input.provider) && typeof input.provider.kind === 'string'))) {
    issue('provider', 'must be a bare provider id, exact scoped provider package name, or provider configuration object');
  }
  if (input.crypto !== undefined) {
    try { normalizeCryptoConfiguration(input.crypto, { location: 'crypto' }); }
    catch (error) { issue('crypto', error && error.message ? error.message : 'must be a valid crypto declaration'); }
  }
  if (input.schemas !== undefined) checkObject(input.schemas, 'schemas', 'schemas');
  if (input.dev !== undefined) checkObject(input.dev, 'dev', 'dev');
  return Object.freeze(issues);
}

function cloneDefault(value) {
  if (Array.isArray(value)) return value.map(cloneDefault);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneDefault(entry)]));
  return value;
}

function configRuntimeRule(path) {
  const rule = CONFIG_RUNTIME_RULES[path];
  if (!rule) throw new Error(`Unknown project-config runtime rule ${path}`);
  return rule;
}

function configDefault(path) {
  const rule = configRuntimeRule(path);
  if (!Object.prototype.hasOwnProperty.call(rule, 'default')) throw new Error(`Project-config rule ${path} has no default`);
  return cloneDefault(rule.default);
}

function validateConfigValue(path, value) {
  const rule = configRuntimeRule(path);
  if (value === undefined && rule.optional) return true;
  if (rule.kind === 'string') return typeof value === 'string' && (!rule.nonEmpty || value.trim().length > 0);
  if (rule.kind === 'boolean') return typeof value === 'boolean';
  if (rule.kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (rule.kind === 'array') return Array.isArray(value);
  if (rule.kind === 'enum') return rule.values.includes(value);
  if (rule.kind === 'provider-package') return typeof value === 'string' && value.trim().length > 0;
  if (rule.kind === 'crypto-configuration') {
    try { normalizeCryptoConfiguration(value, { location: path }); return true; }
    catch (_) { return false; }
  }
  if (rule.kind === 'integer') return Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum;
  if (rule.kind === 'positive-safe-integer') return Number.isSafeInteger(value) && value > 0;
  if (rule.kind === 'non-negative-safe-integer') return Number.isSafeInteger(value) && value >= 0;
  throw new Error(`Unsupported project-config runtime rule kind ${rule.kind}`);
}

function projectConfigSchemaDocument() {
  return Object.freeze({
    schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
    discovery: CONFIG_DISCOVERY,
    precedence: CONFIG_PRECEDENCE,
    sections: CONFIG_SECTIONS,
    fields: CONFIG_FIELDS,
    runtimeRules: CONFIG_RUNTIME_RULES,
    jsonSchema: PROJECT_CONFIG_JSON_SCHEMA
  });
}

module.exports = Object.freeze({
  PROJECT_CONFIG_SCHEMA_VERSION,
  PROJECT_CONFIG_REFERENCE_VERSION,
  CONFIG_SECTIONS,
  CONFIG_FIELDS,
  CONFIG_DISCOVERY,
  CONFIG_PRECEDENCE,
  CONFIG_RUNTIME_RULES,
  PROJECT_CONFIG_JSON_SCHEMA,
  CONFIG_CONTAINER_KEYS,
  validateProjectConfigStructure,
  configRuntimeRule,
  configDefault,
  validateConfigValue,
  projectConfigSchemaDocument
});
