'use strict';
const { normalizeFastlyS3 } = require('./s3.js');

function providerConfigError(code, message, detail) {
  const error = new TypeError(message);
  error.code = code;
  error.detail = Object.freeze({ ...detail });
  return error;
}

function normalizeStringMap(input, code) {
  if (input === undefined) return Object.freeze({});
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw providerConfigError(code, 'Provider binding maps must be objects.', {
      valueType: Array.isArray(input) ? 'array' : typeof input
    });
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(input).map(([key, value]) => [String(key), String(value)])
  ));
}

function normalizeFastlyProviderConfig(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const bindings = input.bindings && typeof input.bindings === 'object' && !Array.isArray(input.bindings)
    ? input.bindings
    : {};
  const local = input.local && typeof input.local === 'object' && !Array.isArray(input.local)
    ? input.local
    : {};
  const gripInput = bindings.grip && typeof bindings.grip === 'object' && !Array.isArray(bindings.grip)
    ? bindings.grip
    : {};
  return Object.freeze({
    kind: 'fastly',
    version: input.version ? String(input.version) : undefined,
    bindings: Object.freeze({
      configStore: String(bindings.configStore || 'pulse_config'),
      secretStore: String(bindings.secretStore || 'pulse_secrets'),
      kv: normalizeStringMap(bindings.kv, 'PULSE_FASTLY_KV_BINDINGS_INVALID'),
      s3: normalizeFastlyS3(bindings.s3),
      backends: normalizeStringMap(bindings.backends, 'PULSE_FASTLY_BACKEND_BINDINGS_INVALID'),
      grip: Object.freeze({
        fanoutBackend: gripInput.fanoutBackend === undefined ? undefined : String(gripInput.fanoutBackend),
        publishEndpoint: gripInput.publishEndpoint === undefined ? undefined : String(gripInput.publishEndpoint),
        publishUrl: gripInput.publishUrl === undefined ? undefined : String(gripInput.publishUrl),
        publishBackend: gripInput.publishBackend === undefined ? undefined : String(gripInput.publishBackend),
        authentication: gripInput.authentication === undefined ? undefined : Object.freeze({
          scheme: String(gripInput.authentication && gripInput.authentication.scheme || 'bearer').toLowerCase(),
          secretRef: String(gripInput.authentication && gripInput.authentication.secretRef || '')
        }),
        directHold: gripInput.directHold !== false
      }),
      dynamicBackends: bindings.dynamicBackends === true
    }),
    build: Object.freeze({
      name: String(input.build && input.build.name || 'pulse-app'),
      description: String(input.build && input.build.description || 'Pulse application'),
      authors: Object.freeze(Array.isArray(input.build && input.build.authors) ? input.build.authors.map(String) : [])
    }),
    local: Object.freeze({ networkFetch: local.networkFetch === true }),
    providerSpecificUserland: false
  });
}

function fastlyProjectConfigDocument(config) {
  return Object.freeze({
    kind: 'fastly',
    bindings: config.bindings,
    build: config.build,
    local: config.local,
    providerSpecificUserland: false
  });
}

function fastlyInitTemplate(name) {
  return Object.freeze({
    profileFragment: `    fastly: {
      bindings: {
        configStore: 'pulse_config',
        secretStore: 'pulse_secrets',
        kv: { sessions: 'sessions' },
        dynamicBackends: false,
      },
      build: { name: '${name}' },
    },
`,
    dependencies: Object.freeze({
      '@pulse-compute/provider-fastly': require('../../package.json').version
    })
  });
}

const FASTLY_PROJECT_CONFIG_REFERENCE = Object.freeze({
  sections: Object.freeze([
    Object.freeze({
      id: 'fastly',
      title: 'Fastly provider options',
      description: 'Options passed to fastly(...) from @pulse-compute/provider-fastly.'
    })
  ]),
  fields: Object.freeze([
    Object.freeze({ section: 'fastly', path: 'fastly.bindings.s3', type: 'Readonly<Record<string, S3ReadBinding & { backend: string }>>', default: '`{}`', scope: 'Fastly Native S3 reads', description: 'Maps logical names to fixed HTTPS endpoint, bucket, region, named static backend, accessKeyIdSecret, secretAccessKeySecret, optional sessionTokenSecret, maxTextBytes (1–32768, default 32768) and timeoutMs (1–30000, default 10000).', security: 'Credentials resolve through the configured Secret Store at execution. Dynamic backend authority and guest endpoint overrides are forbidden.' }),
    Object.freeze({ section: 'fastly', path: 'fastly.configStore', type: 'string', default: '`pulse_config`', scope: 'Fastly config capability', description: 'Fastly Config Store resource name.' }),
    Object.freeze({ section: 'fastly', path: 'fastly.secretStore', type: 'string', default: '`pulse_secrets`', scope: 'Fastly secret capability', description: 'Fastly Secret Store resource name.', security: 'The name is build metadata; secret values are never embedded by this option.' }),
    Object.freeze({ section: 'fastly', path: 'fastly.kv', type: 'Readonly<Record<string, string>>', default: '`{}`', scope: 'Fastly KV capability', description: 'Maps logical ctx.kv names to Fastly KV Store resource names.', diagnostics: Object.freeze(['PULSE_FASTLY_KV_BINDINGS_INVALID']) }),
    Object.freeze({ section: 'fastly', path: 'fastly.backends', type: 'Readonly<Record<string, string>>', default: '`{}`', scope: 'Fastly fetch capability', description: 'Maps static absolute origin URLs to named Fastly backends.', security: 'Prefer explicit backends over dynamic origin authority.', diagnostics: Object.freeze(['PULSE_FASTLY_BACKEND_BINDINGS_INVALID', 'PULSE_FASTLY_BACKEND_REQUIRED']) }),
    Object.freeze({ section: 'fastly', path: 'fastly.dynamicBackends', type: 'boolean', default: '`false`', scope: 'Fastly fetch capability', description: 'Allows undeclared outbound origins to use dynamic backends.', security: 'Opt in deliberately because it broadens outbound authority.', diagnostics: Object.freeze(['PULSE_FASTLY_BACKEND_REQUIRED']) }),
    Object.freeze({ section: 'fastly', path: 'fastly.grip', type: 'object', default: 'omitted', scope: 'Fastly GRIP capability', description: 'Provider-owned bindings used by package-owned GRIP compatibility and canonical broadcast effects.' }),
    Object.freeze({ section: 'fastly', path: 'fastly.grip.fanoutBackend', type: 'string', default: 'omitted', scope: 'GRIP hold', description: 'Named Fastly Fanout backend.', diagnostics: Object.freeze(['PULSE_FASTLY_GRIP_FANOUT_BACKEND_REQUIRED']) }),
    Object.freeze({ section: 'fastly', path: 'fastly.grip.publishEndpoint', type: 'string', default: 'omitted', scope: 'GRIP broadcast', description: 'Provider-owned absolute publish/control endpoint; distinct from public gateway and ingress URLs.', diagnostics: Object.freeze(['PULSE_FASTLY_GRIP_PUBLISH_BINDING_REQUIRED']) }),
    Object.freeze({ section: 'fastly', path: 'fastly.grip.publishUrl', type: 'string', default: 'omitted', scope: 'GRIP publish', description: 'Absolute publish endpoint URL.', diagnostics: Object.freeze(['PULSE_FASTLY_GRIP_PUBLISH_BINDING_REQUIRED']) }),
    Object.freeze({ section: 'fastly', path: 'fastly.grip.publishBackend', type: 'string', default: 'omitted', scope: 'GRIP broadcast/publish', description: 'Named backend for the provider publish endpoint.', diagnostics: Object.freeze(['PULSE_FASTLY_GRIP_PUBLISH_BINDING_REQUIRED']) }),
    Object.freeze({ section: 'fastly', path: 'fastly.grip.authentication', type: 'object', default: 'omitted', scope: 'GRIP broadcast authentication', description: 'Authentication metadata containing references only; no credential value is accepted here.', security: 'Store the value in Fastly Secret Store and configure only secretRef.' }),
    Object.freeze({ section: 'fastly', path: 'fastly.grip.authentication.scheme', type: "'bearer'", default: '`bearer`', scope: 'GRIP broadcast authentication', description: 'Provider authentication scheme.', diagnostics: Object.freeze(['PULSE_FASTLY_NATIVE_GRIP_AUTH_SCHEME_UNSUPPORTED']) }),
    Object.freeze({ section: 'fastly', path: 'fastly.grip.authentication.secretRef', type: 'string', default: 'omitted', scope: 'GRIP broadcast authentication', description: 'Named Fastly Secret Store key used for the bearer token.', security: 'The secret value is resolved only at request execution and is redacted from traces.', diagnostics: Object.freeze(['PULSE_FASTLY_NATIVE_GRIP_SECRET_REFERENCE_MISSING']) }),
    Object.freeze({ section: 'fastly', path: 'fastly.grip.directHold', type: 'boolean', default: '`true`', scope: 'GRIP hold', description: 'Enables the direct host-owned hold response realization.' }),
    Object.freeze({ section: 'fastly', path: 'fastly.name', type: 'string', default: '`pulse-app`', scope: 'Fastly package metadata', description: 'Generated Fastly package name.' }),
    Object.freeze({ section: 'fastly', path: 'fastly.description', type: 'string', default: '`Pulse application`', scope: 'Fastly package metadata', description: 'Generated Fastly package description.' }),
    Object.freeze({ section: 'fastly', path: 'fastly.authors', type: 'readonly string[]', default: '`[]`', scope: 'Fastly package metadata', description: 'Generated Fastly package authors.' }),
    Object.freeze({ section: 'fastly', path: 'fastly.local', type: 'object', default: '`{}`', scope: 'local Fastly conformance', description: 'Local-only behavior; it does not alter the deployed target.' }),
    Object.freeze({ section: 'fastly', path: 'fastly.local.networkFetch', type: 'boolean', default: '`false`', scope: 'local Fastly fetch realization', description: 'Allows unmatched local Fastly fetches to use the network.', precedence: '`dev.networkFetch` overrides this value when explicitly set.', security: 'Keep disabled for deterministic tests and offline development.' })
  ])
});

module.exports = Object.freeze({
  normalizeFastlyProviderConfig,
  fastlyProjectConfigDocument,
  fastlyInitTemplate,
  FASTLY_PROJECT_CONFIG_REFERENCE
});
