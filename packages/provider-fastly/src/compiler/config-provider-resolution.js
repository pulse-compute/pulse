'use strict';

const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadContractsDiagnostics();
const {
  CONFIG_PROVIDER_RESOLUTION_PHASE: PHASE,
  CONFIG_PROVIDER_CONTRACT_VERSION: CONTRACT_VERSION,
  RUNTIME_PROVIDER_RESOLUTION_VERSION: RESOLUTION_VERSION,
  FASTLY_PROVIDER_MAP_VERSION,
  CONFIG_PROVIDER_SMOKE_VERSION: SMOKE_VERSION,
  CONFIG_PROVIDER_SURFACE,
  CONFIG_PROVIDER_POLICY,
  plainObject,
  hasOwn,
  platformFastly,
  collectRefs,
  isSymbolicRef,
  refKind,
  refKey
} = loadContractsConfigProviderResolution();


function loadContractsDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/diagnostics.js');
    }
    throw error;
  }
}

function loadContractsConfigProviderResolution() {
  try {
    return require('@pulse-compute/wasm-contracts/config/provider-resolution');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/config/provider-resolution.js');
    }
    throw error;
  }
}

function normalizeResolvedConfig(input = {}) {
  return input && input.artifact ? input.artifact : input;
}

function makeDiag(code, message, hint, details) {
  return normalizeDiagnostic({
    code,
    message,
    hint,
    severity: 'error',
    phase: 'config-provider-resolution',
    loc: { file: '<config>' },
    details
  });
}

function validateRefs(refs, runtime) {
  const diagnostics = [];
  const seen = new Set();
  const fastly = platformFastly(runtime);

  for (const ref of refs) {
    const pathText = ref.path.join('.');
    if (ref.kind === 'mixed') {
      diagnostics.push(makeDiag(
        'PULSEWASM_CONFIG_PROVIDER_MIXED_REF',
        `Config ref at ${pathText || '<root>'} declares both $config and $secret.`,
        'Use exactly one of { $config: "KEY" } or { $secret: "KEY" }.',
        { path: ref.path }
      ));
      continue;
    }
    if (typeof ref.key !== 'string' || ref.key.trim() === '') {
      diagnostics.push(makeDiag(
        'PULSEWASM_CONFIG_PROVIDER_KEY_INVALID',
        `Config ref at ${pathText || '<root>'} must use a non-empty string key.`,
        'Use a literal key such as { $config: "USERS_API_BASE_URL" } or { $secret: "USERS_API_TOKEN" }.',
        { path: ref.path }
      ));
      continue;
    }
    const extraKeys = Object.keys(ref.raw || {}).filter((key) => !['$config', '$secret'].includes(key));
    if (extraKeys.length > 0) {
      diagnostics.push(makeDiag(
        'PULSEWASM_CONFIG_PROVIDER_EXTRA_KEYS',
        `Config ref at ${pathText || '<root>'} contains unsupported properties: ${extraKeys.join(', ')}.`,
        'Symbolic refs stay intentionally tiny. Put metadata next to the ref, not inside it.',
        { path: ref.path, extraKeys }
      ));
    }
    const dupKey = `${ref.kind}:${ref.key}:${pathText}`;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);

    if (ref.kind === 'config' && !fastly.configStore) {
      diagnostics.push(makeDiag(
        'PULSEWASM_CONFIG_PROVIDER_FASTLY_CONFIG_STORE_MISSING',
        `One or more $config refs are present but runtime.platform.fastly.configStore is not configured.`,
        'Set profiles.<name>.runtime.platform.fastly.configStore to the Fastly config store name.',
        { key: ref.key, path: ref.path }
      ));
    }
    if (ref.kind === 'secret' && !fastly.secretStore) {
      diagnostics.push(makeDiag(
        'PULSEWASM_CONFIG_PROVIDER_FASTLY_SECRET_STORE_MISSING',
        `One or more $secret refs are present but runtime.platform.fastly.secretStore is not configured.`,
        'Set profiles.<name>.runtime.platform.fastly.secretStore to the Fastly secret store name.',
        { key: ref.key, path: ref.path }
      ));
    }
  }

  return diagnostics;
}

function createLookup(kind, source) {
  if (source && typeof source.get === 'function') {
    return (key) => source.get(key);
  }
  const table = plainObject(source);
  return (key) => hasOwn(table, key) ? table[key] : undefined;
}

function createPulseRuntimeConfigProvider(options = {}) {
  const resolvedConfig = normalizeResolvedConfig(options.resolvedConfig || {});
  const runtime = plainObject(options.runtime || resolvedConfig.runtime);
  const profile = options.profile || resolvedConfig.profile || null;
  const fastly = platformFastly(runtime);
  const refs = collectRefs(runtime);
  const diagnostics = validateRefs(refs, runtime);

  const configLookup = createLookup('config', options.configValues || options.configProvider || {});
  const secretLookup = createLookup('secret', options.secretValues || options.secretProvider || {});

  function getConfig(key) {
    const value = configLookup(key);
    if (value === undefined || value === null) {
      const err = new Error(`Missing config value for ${key}`);
      err.code = 'PULSEWASM_CONFIG_PROVIDER_MISSING_CONFIG';
      err.kind = 'config';
      err.key = key;
      throw err;
    }
    return String(value);
  }

  function getSecret(key) {
    const value = secretLookup(key);
    if (value === undefined || value === null) {
      const err = new Error(`Missing secret value for ${key}`);
      err.code = 'PULSEWASM_CONFIG_PROVIDER_MISSING_SECRET';
      err.kind = 'secret';
      err.key = key;
      throw err;
    }
    return String(value);
  }

  function resolveNode(value, pathSegments = []) {
    if (isSymbolicRef(value)) {
      const kind = refKind(value);
      const key = refKey(value);
      if (kind === 'config') return getConfig(key);
      if (kind === 'secret') return getSecret(key);
      return value;
    }
    if (Array.isArray(value)) return value.map((item, index) => resolveNode(item, pathSegments.concat(String(index))));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = resolveNode(child, pathSegments.concat(key));
      }
      return out;
    }
    return value;
  }

  function previewNode(value, pathSegments = []) {
    if (isSymbolicRef(value)) {
      const kind = refKind(value);
      const key = refKey(value);
      if (kind === 'config') {
        return {
          kind: 'config',
          key,
          resolved: (() => { try { return getConfig(key); } catch { return null; } })(),
          store: fastly.configStore || null,
          compiledIntoBinary: false
        };
      }
      return {
        kind: 'secret',
        key,
        resolved: (() => { try { getSecret(key); return true; } catch { return false; } })(),
        redacted: true,
        store: fastly.secretStore || null,
        compiledIntoBinary: false
      };
    }
    if (Array.isArray(value)) return value.map((item, index) => previewNode(item, pathSegments.concat(String(index))));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = previewNode(child, pathSegments.concat(key));
      }
      return out;
    }
    return value;
  }

  return {
    profile,
    runtime,
    refs,
    fastly,
    diagnostics,
    getConfig,
    getSecret,
    resolveRuntime() {
      return resolveNode(runtime);
    },
    previewRuntime() {
      return previewNode(runtime);
    },
    providerSummary() {
      return {
        profile,
        configRefs: refs.filter((ref) => ref.kind === 'config').length,
        secretRefs: refs.filter((ref) => ref.kind === 'secret').length,
        fastlyConfigStore: fastly.configStore || null,
        fastlySecretStore: fastly.secretStore || null
      };
    }
  };
}

function writeGeneratedProviderModule() {
  return `'use strict';

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isSymbolicRef(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (hasOwn(value, '$config') || hasOwn(value, '$secret'));
}

function refKind(value) {
  if (!isSymbolicRef(value)) return undefined;
  if (hasOwn(value, '$config') && hasOwn(value, '$secret')) return 'mixed';
  if (hasOwn(value, '$secret')) return 'secret';
  return 'config';
}

function refKey(value) {
  const kind = refKind(value);
  if (kind === 'config') return value.$config;
  if (kind === 'secret') return value.$secret;
  return undefined;
}

function collectRefs(value, pathSegments = [], out = []) {
  if (isSymbolicRef(value)) {
    out.push({ kind: refKind(value), key: refKey(value), path: pathSegments.slice(), raw: value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRefs(item, pathSegments.concat(String(index)), out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectRefs(child, pathSegments.concat(key), out);
    }
  }
  return out;
}

function platformFastly(runtime) {
  return plainObject(plainObject(runtime.platform).fastly || runtime.fastly);
}

function createLookup(source) {
  if (source && typeof source.get === 'function') return (key) => source.get(key);
  const table = plainObject(source);
  return (key) => hasOwn(table, key) ? table[key] : undefined;
}

function createPulseRuntimeConfigProvider(options = {}) {
  const resolvedConfig = options.resolvedConfig && options.resolvedConfig.artifact ? options.resolvedConfig.artifact : (options.resolvedConfig || {});
  const runtime = plainObject(options.runtime || resolvedConfig.runtime);
  const profile = options.profile || resolvedConfig.profile || null;
  const fastly = platformFastly(runtime);
  const refs = collectRefs(runtime);
  const configLookup = createLookup(options.configValues || options.configProvider || {});
  const secretLookup = createLookup(options.secretValues || options.secretProvider || {});

  function getConfig(key) {
    const value = configLookup(key);
    if (value === undefined || value === null) {
      const err = new Error('Missing config value for ' + key);
      err.code = 'PULSEWASM_CONFIG_PROVIDER_MISSING_CONFIG';
      err.kind = 'config';
      err.key = key;
      throw err;
    }
    return String(value);
  }

  function getSecret(key) {
    const value = secretLookup(key);
    if (value === undefined || value === null) {
      const err = new Error('Missing secret value for ' + key);
      err.code = 'PULSEWASM_CONFIG_PROVIDER_MISSING_SECRET';
      err.kind = 'secret';
      err.key = key;
      throw err;
    }
    return String(value);
  }

  function resolveNode(value) {
    if (isSymbolicRef(value)) {
      const kind = refKind(value);
      const key = refKey(value);
      if (kind === 'config') return getConfig(key);
      if (kind === 'secret') return getSecret(key);
      return value;
    }
    if (Array.isArray(value)) return value.map(resolveNode);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = resolveNode(child);
      return out;
    }
    return value;
  }

  function previewNode(value) {
    if (isSymbolicRef(value)) {
      const kind = refKind(value);
      const key = refKey(value);
      if (kind === 'config') {
        return { kind: 'config', key, resolved: (() => { try { return getConfig(key); } catch { return null; } })(), store: fastly.configStore || null, compiledIntoBinary: false };
      }
      return { kind: 'secret', key, resolved: (() => { try { getSecret(key); return true; } catch { return false; } })(), redacted: true, store: fastly.secretStore || null, compiledIntoBinary: false };
    }
    if (Array.isArray(value)) return value.map(previewNode);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = previewNode(child);
      return out;
    }
    return value;
  }

  return {
    profile,
    refs,
    fastly,
    getConfig,
    getSecret,
    resolveRuntime() { return resolveNode(runtime); },
    previewRuntime() { return previewNode(runtime); },
    providerSummary() {
      return {
        profile,
        configRefs: refs.filter((ref) => ref.kind === 'config').length,
        secretRefs: refs.filter((ref) => ref.kind === 'secret').length,
        fastlyConfigStore: fastly.configStore || null,
        fastlySecretStore: fastly.secretStore || null
      };
    }
  };
}

module.exports = { createPulseRuntimeConfigProvider, collectRefs, isSymbolicRef };
`;
}

function buildMarkdown(contract, resolution, providerMap, smoke) {
  return [
    '# PulseWasm Config / Secret Provider Resolution v1',
    '',
    `Generated by: \`${contract.generatedBy}\``,
    '',
    '## Locked posture',
    '',
    '- `$config` and `$secret` are symbolic refs in profile runtime config.',
    '- Runtime/provider resolution happens outside the Wasm binary.',
    '- Secrets are never compiled into the Wasm binary.',
    '- Fastly config/secret stores are providers, not authoring shapes.',
    '- Local/mock providers are valid for testing and development.',
    '',
    '## Current profile',
    '',
    `- profile: \`${resolution.profile || '<none>'}\``,
    `- config refs: ${resolution.summary.configRefs}`,
    `- secret refs: ${resolution.summary.secretRefs}`,
    '',
    '## Fastly provider mapping',
    '',
    `- config store: ${providerMap.fastly.configStore ? `\`${providerMap.fastly.configStore}\`` : '`<unmapped>`'}`,
    `- secret store: ${providerMap.fastly.secretStore ? `\`${providerMap.fastly.secretStore}\`` : '`<unmapped>`'}`,
    '',
    '## Smoke summary',
    '',
    `- executed: ${smoke.executed}`,
    `- failed checks: ${smoke.failedChecks}`,
    `- missing config caught: ${smoke.missingConfigCaught}`,
    `- missing secret caught: ${smoke.missingSecretCaught}`,
    ''
  ].join('\n');
}

function buildConfigProviderResolution(options = {}) {
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const resolvedConfig = normalizeResolvedConfig(options.resolvedConfig || {});
  const runtime = plainObject(resolvedConfig.runtime);
  const provider = createPulseRuntimeConfigProvider({
    resolvedConfig,
    configValues: options.configValues || {},
    secretValues: options.secretValues || {}
  });

  const refs = provider.refs.map((ref) => ({
    kind: ref.kind,
    key: ref.key,
    path: ref.path,
    store: ref.kind === 'config' ? provider.fastly.configStore || null : provider.fastly.secretStore || null,
    provider: ref.kind === 'config' ? (provider.fastly.configStore ? 'fastly.configStore' : 'unmapped.configStore') : (provider.fastly.secretStore ? 'fastly.secretStore' : 'unmapped.secretStore'),
    compiledIntoBinary: false,
    secret: ref.kind === 'secret'
  }));

  const contract = {
    version: CONTRACT_VERSION,
    generatedBy,
    phase: PHASE,
    status: 'locked',
    profile: resolvedConfig.profile || null,
    providerSurface: CONFIG_PROVIDER_SURFACE,
    policy: CONFIG_PROVIDER_POLICY,
    summary: {
      refs: refs.length,
      configRefs: refs.filter((ref) => ref.kind === 'config').length,
      secretRefs: refs.filter((ref) => ref.kind === 'secret').length,
      diagnostics: provider.diagnostics.length
    }
  };

  const preview = provider.previewRuntime();
  const resolution = {
    version: RESOLUTION_VERSION,
    generatedBy,
    phase: PHASE,
    profile: resolvedConfig.profile || null,
    refs,
    previewRuntime: preview,
    summary: {
      refs: refs.length,
      configRefs: contract.summary.configRefs,
      secretRefs: contract.summary.secretRefs,
      fastlyConfigStoreReady: Boolean(provider.fastly.configStore) || contract.summary.configRefs === 0,
      fastlySecretStoreReady: Boolean(provider.fastly.secretStore) || contract.summary.secretRefs === 0,
      diagnostics: provider.diagnostics.length
    }
  };

  const providerMap = {
    version: FASTLY_PROVIDER_MAP_VERSION,
    generatedBy,
    phase: PHASE,
    profile: resolvedConfig.profile || null,
    fastly: {
      configStore: provider.fastly.configStore || null,
      secretStore: provider.fastly.secretStore || null,
      refs
    },
    summary: {
      fastlyConfigStoreReady: resolution.summary.fastlyConfigStoreReady,
      fastlySecretStoreReady: resolution.summary.fastlySecretStoreReady,
      refs: refs.length
    }
  };

  const smoke = {
    version: SMOKE_VERSION,
    generatedBy,
    phase: PHASE,
    executed: false,
    checks: 0,
    failedChecks: 0,
    missingConfigCaught: false,
    missingSecretCaught: false,
    resolvedConfigKeys: [],
    resolvedSecretKeys: []
  };

  let smokeErrors = 0;
  try {
    const resolved = provider.resolveRuntime();
    smoke.executed = true;
    smoke.checks += 1;
    const backend = resolved.capabilities && resolved.capabilities.backends && resolved.capabilities.backends.usersApi;
    if (backend && typeof backend.baseUrl === 'string') smoke.resolvedConfigKeys.push('USERS_API_BASE_URL'); else smokeErrors += 1;
    smoke.checks += 1;
    if (backend && backend.headers && typeof backend.headers.Authorization === 'string') smoke.resolvedSecretKeys.push('USERS_API_TOKEN'); else smokeErrors += 1;
    smoke.checks += 1;
  } catch (error) {
    smokeErrors += 1;
    smoke.error = { code: error.code || 'PULSEWASM_CONFIG_PROVIDER_SMOKE_ERROR', message: error.message };
  }

  try {
    createPulseRuntimeConfigProvider({ resolvedConfig, configValues: {}, secretValues: options.secretValues || {} }).resolveRuntime();
    smokeErrors += 1;
  } catch (error) {
    smoke.checks += 1;
    smoke.missingConfigCaught = error.code === 'PULSEWASM_CONFIG_PROVIDER_MISSING_CONFIG';
    if (!smoke.missingConfigCaught) smokeErrors += 1;
  }

  try {
    createPulseRuntimeConfigProvider({ resolvedConfig, configValues: options.configValues || {}, secretValues: {} }).resolveRuntime();
    smokeErrors += 1;
  } catch (error) {
    smoke.checks += 1;
    smoke.missingSecretCaught = error.code === 'PULSEWASM_CONFIG_PROVIDER_MISSING_SECRET';
    if (!smoke.missingSecretCaught) smokeErrors += 1;
  }

  smoke.failedChecks = smokeErrors;

  const files = [
    {
      file: 'generated/host/config-provider.cjs',
      text: writeGeneratedProviderModule()
    },
    {
      file: 'generated/host/config-provider-resolution.md',
      text: buildMarkdown(contract, resolution, providerMap, smoke)
    }
  ];

  return {
    artifact: normalizeArtifact(contract, options.cwd),
    resolution: normalizeArtifact(resolution, options.cwd),
    providerMap: normalizeArtifact(providerMap, options.cwd),
    smoke: normalizeArtifact(smoke, options.cwd),
    diagnostics: provider.diagnostics,
    files
  };
}

module.exports = {
  CONTRACT_VERSION,
  RESOLUTION_VERSION,
  FASTLY_PROVIDER_MAP_VERSION,
  SMOKE_VERSION,
  buildConfigProviderResolution,
  createPulseRuntimeConfigProvider,
  collectRefs,
  isSymbolicRef
};
