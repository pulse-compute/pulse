'use strict';

const CONFIG_REFERENCES_PHASE = '12C.2';
const CONFIG_REFERENCES_VERSION = 'pulsewasm.config-references.v1';
const RUNTIME_CONFIG_REFERENCES_VERSION = 'pulsewasm.runtime-config-references.v1';
const PLATFORM_STORE_MAP_VERSION = 'pulsewasm.platform-store-map.v1';
const CONFIG_AUTHORING_SHAPE_VERSION = 'pulsewasm.config-authoring-shape.v1';

const SYMBOLIC_REF_MARKERS = Object.freeze(['$config', '$secret']);
const CONFIG_AUTHORING_ROOT_ALLOWED_KEYS = Object.freeze(['entry', 'rootRouter', 'profiles']);
const CONFIG_AUTHORING_PROFILE_RUNTIME_KEYS = Object.freeze(['engine', 'handlerExecutionMode', 'timeouts', 'payload', 'capabilities', 'platform']);
const CONFIG_AUTHORING_DISALLOWED_ROOT_RUNTIME_KEYS = Object.freeze(['runtime', 'json', 'backends', 'timeouts', 'assets', 'broadcaster', 'deployment']);

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
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
  if (!isSymbolicRef(value)) return undefined;
  const kind = refKind(value);
  if (kind === 'secret') return value.$secret;
  if (kind === 'config') return value.$config;
  return undefined;
}

function collectSymbolicRefs(value, pathSegments = [], out = []) {
  if (isSymbolicRef(value)) {
    out.push({
      kind: refKind(value),
      key: refKey(value),
      path: pathSegments.slice(),
      raw: value
    });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSymbolicRefs(item, pathSegments.concat(String(index)), out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectSymbolicRefs(child, pathSegments.concat(key), out);
    }
  }
  return out;
}

const collectRefs = collectSymbolicRefs;

function platformFastly(runtime) {
  const runtimeObject = plainObject(runtime);
  const platform = plainObject(runtimeObject.platform);
  return plainObject(platform.fastly || runtimeObject.fastly);
}

function providerForSymbolicRef(ref, runtime) {
  const fastly = platformFastly(runtime);
  if (ref.kind === 'config') {
    return {
      provider: fastly.configStore ? 'fastly.configStore' : 'unmapped.configStore',
      store: fastly.configStore || null,
      compiledIntoBinary: false
    };
  }
  if (ref.kind === 'secret') {
    return {
      provider: fastly.secretStore ? 'fastly.secretStore' : 'unmapped.secretStore',
      store: fastly.secretStore || null,
      compiledIntoBinary: false
    };
  }
  return { provider: 'invalid', store: null, compiledIntoBinary: false };
}

const providerFor = providerForSymbolicRef;

function authoringShapeForKind(kind) {
  return kind === 'secret' ? '{ $secret: "KEY" }' : '{ $config: "KEY" }';
}

function normalizeSymbolicRef(ref, runtime) {
  const provider = providerForSymbolicRef(ref, runtime);
  return {
    kind: ref.kind,
    key: ref.key,
    path: ref.path,
    provider: provider.provider,
    store: provider.store,
    secret: ref.kind === 'secret',
    compiledIntoBinary: false,
    authoringShape: authoringShapeForKind(ref.kind)
  };
}

function groupSymbolicRefs(refs, runtime) {
  const fastly = platformFastly(runtime);
  const configRefs = refs.filter((ref) => ref.kind === 'config').map((ref) => normalizeSymbolicRef(ref, runtime));
  const secretRefs = refs.filter((ref) => ref.kind === 'secret').map((ref) => normalizeSymbolicRef(ref, runtime));
  return {
    fastly: {
      configStore: {
        name: fastly.configStore || null,
        refs: configRefs,
        ready: Boolean(fastly.configStore) || configRefs.length === 0
      },
      secretStore: {
        name: fastly.secretStore || null,
        refs: secretRefs,
        ready: Boolean(fastly.secretStore) || secretRefs.length === 0
      }
    },
    local: {
      configProvider: 'local-env-or-file-reserved',
      secretProvider: 'local-env-or-file-reserved',
      refs: refs.map((ref) => normalizeSymbolicRef(ref, runtime))
    }
  };
}

function configAuthoringShape(generatedBy, phase = CONFIG_REFERENCES_PHASE) {
  return {
    version: CONFIG_AUTHORING_SHAPE_VERSION,
    generatedBy,
    phase,
    status: 'locked',
    root: {
      purpose: 'app topology',
      allowedKeys: CONFIG_AUTHORING_ROOT_ALLOWED_KEYS.slice(),
      profileSelector: 'external PULSE_PROFILE or CLI --profile',
      disallowedRuntimeKeys: CONFIG_AUTHORING_DISALLOWED_ROOT_RUNTIME_KEYS.slice()
    },
    profile: {
      purpose: 'runtime/deployment behavior',
      runtimeKeys: CONFIG_AUTHORING_PROFILE_RUNTIME_KEYS.slice(),
      symbolicRefs: SYMBOLIC_REF_MARKERS.map((marker) => `{ ${marker}: "KEY" }`)
    },
    envHelperPolicy: {
      required: false,
      canonical: false,
      status: 'legacy-compatible-but-not-preferred',
      note: 'The canonical authoring shape uses symbolic refs and external profile selection.'
    },
    splitConfigFiles: {
      supportedConceptually: true,
      implementationStatus: 'reserved-strict-static-imports-only',
      allowedFuture: 'direct named imports of exported object literals',
      rejectedFuture: ['function-produced config', 'conditional config', 'computed keys', 'runtime env reads']
    }
  };
}

module.exports = {
  CONFIG_REFERENCES_PHASE,
  CONFIG_REFERENCES_VERSION,
  RUNTIME_CONFIG_REFERENCES_VERSION,
  PLATFORM_STORE_MAP_VERSION,
  CONFIG_AUTHORING_SHAPE_VERSION,
  SYMBOLIC_REF_MARKERS,
  CONFIG_AUTHORING_ROOT_ALLOWED_KEYS,
  CONFIG_AUTHORING_PROFILE_RUNTIME_KEYS,
  CONFIG_AUTHORING_DISALLOWED_ROOT_RUNTIME_KEYS,
  plainObject,
  hasOwn,
  platformFastly,
  isSymbolicRef,
  refKind,
  refKey,
  collectSymbolicRefs,
  collectRefs,
  providerFor,
  providerForSymbolicRef,
  authoringShapeForKind,
  normalizeSymbolicRef,
  groupSymbolicRefs,
  configAuthoringShape
};
