'use strict';

const ALLOWED_PROVIDER_KINDS = new Set(['fastly', 'local', 'node']);
const DIAGNOSTICS = {
  PROFILE_RUNTIME_REQUIRED: 'PULSEWASM_PROFILE_RUNTIME_REQUIRED',
  PROVIDER_REQUIRED: 'PULSEWASM_RUNTIME_PROVIDER_REQUIRED',
  PROVIDER_KIND_INVALID: 'PULSEWASM_RUNTIME_PROVIDER_KIND_INVALID',
  FASTLY_CONFIG_STORE_REQUIRED: 'PULSEWASM_FASTLY_CONFIG_STORE_REQUIRED',
  FASTLY_SECRET_STORE_REQUIRED: 'PULSEWASM_FASTLY_SECRET_STORE_REQUIRED',
  KV_LINK_INVALID: 'PULSEWASM_KV_LINK_INVALID',
  KV_NAMESPACE_INVALID: 'PULSEWASM_KV_NAMESPACE_INVALID'
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRuntimeProvider(runtime = {}) {
  if (isPlainObject(runtime.provider)) return runtime.provider;
  const fastly = isPlainObject(runtime.platform) && isPlainObject(runtime.platform.fastly) ? runtime.platform.fastly : undefined;
  if (fastly) {
    return {
      kind: 'fastly',
      configStore: fastly.configStore,
      secretStore: fastly.secretStore,
      kv: fastly.kv || {}
    };
  }
  return undefined;
}

function validateRuntimeProvider(profileName, profile) {
  const diagnostics = [];
  const runtime = profile && profile.runtime;
  if (!isPlainObject(runtime)) {
    diagnostics.push({ code: DIAGNOSTICS.PROFILE_RUNTIME_REQUIRED, profile: profileName, message: 'Profile runtime is required.' });
    return diagnostics;
  }
  const provider = normalizeRuntimeProvider(runtime);
  if (!isPlainObject(provider)) {
    diagnostics.push({ code: DIAGNOSTICS.PROVIDER_REQUIRED, profile: profileName, message: 'runtime.provider is required.' });
    return diagnostics;
  }
  if (!ALLOWED_PROVIDER_KINDS.has(provider.kind)) {
    diagnostics.push({ code: DIAGNOSTICS.PROVIDER_KIND_INVALID, profile: profileName, message: 'runtime.provider.kind must be one of fastly, local, node.' });
  }
  if (provider.kind === 'fastly') {
    if (typeof provider.configStore !== 'string' || !provider.configStore) {
      diagnostics.push({ code: DIAGNOSTICS.FASTLY_CONFIG_STORE_REQUIRED, profile: profileName, message: 'Fastly provider requires configStore.' });
    }
    if (typeof provider.secretStore !== 'string' || !provider.secretStore) {
      diagnostics.push({ code: DIAGNOSTICS.FASTLY_SECRET_STORE_REQUIRED, profile: profileName, message: 'Fastly provider requires secretStore.' });
    }
  }
  if (provider.kv !== undefined) {
    if (!isPlainObject(provider.kv)) {
      diagnostics.push({ code: DIAGNOSTICS.KV_NAMESPACE_INVALID, profile: profileName, message: 'runtime.provider.kv must be an object map.' });
    } else {
      for (const [logicalName, link] of Object.entries(provider.kv)) {
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(logicalName)) {
          diagnostics.push({ code: DIAGNOSTICS.KV_NAMESPACE_INVALID, profile: profileName, logicalName, message: 'KV logical names must be alphanumeric with _ or -.' });
        }
        if (typeof link !== 'string' || !link) {
          diagnostics.push({ code: DIAGNOSTICS.KV_LINK_INVALID, profile: profileName, logicalName, message: 'KV links must be non-empty strings.' });
        }
      }
    }
  }
  return diagnostics;
}

function extractProviderMap(profileName, profile) {
  const runtime = profile.runtime;
  const provider = normalizeRuntimeProvider(runtime) || {};
  return {
    profile: profileName,
    provider: provider.kind || null,
    stores: provider.kind === 'fastly' ? {
      configStore: provider.configStore,
      secretStore: provider.secretStore
    } : {},
    kv: provider.kv || {},
    authoringShape: 'runtime.provider',
    legacyPlatformFallback: !isPlainObject(runtime.provider) && isPlainObject(runtime.platform)
  };
}

function extractKvCapabilities(profileName, profile) {
  const runtime = profile.runtime || {};
  const provider = normalizeRuntimeProvider(runtime) || {};
  const kv = provider.kv || {};
  return Object.entries(kv).map(([name, link]) => ({
    profile: profileName,
    logicalName: name,
    link,
    provider: provider.kind || null,
    execution: 'reserved-effect',
    localAdapterProof: 'runtime-owned in-memory provider',
    handlerSurface: `ctx.kv("${name}")`
  }));
}

module.exports = {
  DIAGNOSTICS,
  validateRuntimeProvider,
  extractProviderMap,
  extractKvCapabilities,
  normalizeRuntimeProvider
};
