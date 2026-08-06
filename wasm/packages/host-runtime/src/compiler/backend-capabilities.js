'use strict';

const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = require('@pulse-compute/wasm-contracts/diagnostics');
const { selectRuntimeEngine } = loadContractsJsonBody();
const {
  BACKEND_CAPABILITIES_VERSION,
  BACKEND_CAPABILITIES_PHASE,
  DEFAULT_BACKEND_TIMEOUT_MS,
  METHOD_NAMES,
  normalizeBackendMethods
} = loadContractsBackendCapabilities();

function loadContractsJsonBody() {
  try {
    return require('@pulse-compute/wasm-contracts/host/json-body');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/host/json-body.js');
    }
    throw error;
  }
}

function loadContractsBackendCapabilities() {
  try {
    return require('@pulse-compute/wasm-contracts/host/backend-capabilities');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/host/backend-capabilities.js');
    }
    throw error;
  }
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function configArtifact(options = {}) {
  return options.resolvedConfig?.artifact || options.resolvedConfig || {};
}

function isEnvArtifact(value) {
  return value && typeof value === 'object' && typeof value.$env === 'string';
}

function makeDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({
    severity: 'error',
    phase: 'backend-capabilities',
    code,
    message,
    hint,
    details,
    loc: { file: '<config-or-handler>' }
  });
}

function sourceDescriptor(value, options = {}) {
  if (options.envRef) {
    return {
      source: 'env',
      name: options.envRef.name,
      secret: Boolean(options.envRef.secret),
      redacted: Boolean(options.envRef.redacted),
      resolved: Boolean(options.envRef.resolved),
      compiledIntoBinary: false
    };
  }
  if (isEnvArtifact(value)) {
    return {
      source: 'env',
      name: value.$env,
      secret: Boolean(value.secret),
      redacted: Boolean(value.redacted),
      resolved: Boolean(value.resolved),
      compiledIntoBinary: false
    };
  }
  if (value && typeof value === 'object' && typeof value.fromEnv === 'string') {
    return {
      source: 'env',
      name: value.fromEnv,
      secret: options.secret !== false,
      redacted: options.secret !== false,
      resolved: false,
      compiledIntoBinary: false
    };
  }
  if (typeof value === 'string') {
    return {
      source: 'literal',
      value,
      secret: Boolean(options.secret),
      redacted: Boolean(options.secret),
      compiledIntoBinary: !options.secret
    };
  }
  return { source: 'unsupported', value: value === undefined ? null : value, compiledIntoBinary: false };
}

function findEnvRefForTail(envRefByPath, tailSegments) {
  const tail = tailSegments.join('.');
  for (const [pathKey, ref] of envRefByPath.entries()) {
    if (pathKey === tail || pathKey.endsWith('.' + tail)) return ref;
  }
  return undefined;
}

function normalizeHeaderConfig(headers, backendKey, envRefByPath) {
  const out = [];
  const obj = plainObject(headers);
  for (const [name, raw] of Object.entries(obj)) {
    const envRef = findEnvRefForTail(envRefByPath, ['backends', backendKey, 'headers', name]) || findEnvRefForTail(envRefByPath, ['capabilities', 'backends', backendKey, 'headers', name]);
    const descriptor = sourceDescriptor(raw, { secret: /authorization|token|secret|key|password/i.test(name), envRef });
    const item = { ...descriptor, name };
    if (descriptor.source === 'env' && descriptor.name) item.env = descriptor.name;
    out.push(item);
  }
  return out;
}

function normalizeBackends(config) {
  const backends = [];
  const diagnostics = [];
  const envRefByPath = new Map();
  for (const ref of config.env?.references || []) {
    if (Array.isArray(ref.path)) envRefByPath.set(ref.path.join('.'), ref);
  }
  const runtime = plainObject(config.runtime);
  const capabilities = plainObject(runtime.capabilities);
  const rawBackends = plainObject(capabilities.backends || runtime.backends || config.backends);
  for (const [key, raw] of Object.entries(rawBackends)) {
    const value = plainObject(raw);
    const allowedMethods = normalizeBackendMethods(value.allowedMethods);
    const timeoutMs = value.timeoutMs === undefined || value.timeoutMs === null ? DEFAULT_BACKEND_TIMEOUT_MS : Number(value.timeoutMs);
    const backend = {
      key,
      baseUrl: sourceDescriptor(value.baseUrl, { secret: false, envRef: findEnvRefForTail(envRefByPath, ['backends', key, 'baseUrl']) || findEnvRefForTail(envRefByPath, ['capabilities', 'backends', key, 'baseUrl']) }),
      allowedMethods,
      timeoutMs,
      headers: normalizeHeaderConfig(value.headers, key, envRefByPath),
      policy: {
        declared: true,
        staticKey: true,
        secretsCompiledIntoBinary: false
      }
    };
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_BACKEND_KEY_INVALID',
        `Backend key ${JSON.stringify(key)} is not a valid static identifier-like key.`,
        'Use keys like usersApi or payments.',
        { key }
      ));
    }
    if (backend.baseUrl.source === 'unsupported') {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_BACKEND_BASE_URL_INVALID',
        `Backend ${key} must declare a literal or env-backed baseUrl.`,
        'Use baseUrl: env("USERS_API_BASE_URL") or a literal URL.',
        { key }
      ));
    }
    if (allowedMethods.length === 0) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_BACKEND_METHODS_REQUIRED',
        `Backend ${key} must declare allowedMethods.`,
        'Use allowedMethods: ["GET", "POST"].',
        { key }
      ));
    }
    for (const method of allowedMethods) {
      if (!METHOD_NAMES.has(method)) {
        diagnostics.push(makeDiagnostic(
          'PULSEWASM_BACKEND_METHOD_INVALID',
          `Backend ${key} declares unsupported method ${JSON.stringify(method)}.`,
          'Use standard uppercase HTTP methods.',
          { key, method }
        ));
      }
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || Math.floor(timeoutMs) !== timeoutMs) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_BACKEND_TIMEOUT_INVALID',
        `Backend ${key} timeoutMs must be a positive integer.`,
        `Use a positive timeout such as ${DEFAULT_BACKEND_TIMEOUT_MS}.`,
        { key, timeoutMs }
      ));
    }
    backends.push(backend);
  }
  return { backends, diagnostics };
}

function collectFetchUsages(handlerEval) {
  const usages = [];
  const items = [];
  for (const handler of handlerEval?.handlers || []) items.push(handler);
  for (const dep of handlerEval?.dependencyEvaluations || []) items.push(dep);
  for (const evaluation of items) {
    for (const fetch of evaluation.fetches || []) {
      usages.push({
        handlerId: evaluation.handlerId,
        handler: evaluation.handlerName,
        roles: evaluation.roles || [],
        backend: fetch.backend,
        method: fetch.method,
        path: fetch.path,
        static: Boolean(fetch.static),
        loc: fetch.loc
      });
    }
  }
  return usages;
}

function validateUsages(usages, backends, engine) {
  const diagnostics = [];
  const byKey = new Map(backends.map((backend) => [backend.key, backend]));
  for (const usage of usages) {
    if (!usage.backend) continue;
    const backend = byKey.get(usage.backend);
    if (!backend) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_UNDECLARED_BACKEND',
        `Handler ${usage.handler} uses undeclared backend ${JSON.stringify(usage.backend)}.`,
        'Declare the backend in defineConfig.backends before using ctx.fetch().',
        usage
      ));
      continue;
    }
    if (usage.method && !backend.allowedMethods.includes(usage.method)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_BACKEND_METHOD_NOT_ALLOWED',
        `Handler ${usage.handler} uses ${usage.method} for backend ${usage.backend}, but it is not allowed.`,
        `Add ${usage.method} to defineConfig.backends.${usage.backend}.allowedMethods or use an allowed method.`,
        { usage, allowedMethods: backend.allowedMethods }
      ));
    }
  }
  if (engine.engine === 'wasm' && usages.length > 0) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_FETCH_EFFECT_UNSUPPORTED',
      'ctx.fetch requires the Wasm host effect runtime, which is not enabled yet.',
      'Use runtime.engine = "js" manually, remove ctx.fetch from Wasm-targeted handlers, or wait for the future Wasm fetch-effect runtime.',
      { usages: usages.map((usage) => ({ handler: usage.handler, backend: usage.backend, method: usage.method, path: usage.path })) }
    ));
  }
  return diagnostics;
}

function buildMarkdown(artifact) {
  const lines = [];
  lines.push('# PulseWasm Backend Capability / ctx.fetch Contract v1');
  lines.push('');
  lines.push(`Generated by: \`${artifact.generatedBy}\``);
  lines.push(`Phase: \`${artifact.policy.phase}\``);
  lines.push('');
  lines.push('## Locked positions');
  lines.push('');
  for (const item of artifact.lockedPositions) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Backends');
  lines.push('');
  if (artifact.backends.length === 0) lines.push('- none declared');
  for (const backend of artifact.backends) {
    lines.push(`- \`${backend.key}\`: methods \`${backend.allowedMethods.join(', ') || '<none>'}\`, timeout \`${backend.timeoutMs}\`ms`);
  }
  lines.push('');
  lines.push('## ctx.fetch usages');
  lines.push('');
  if (artifact.usages.length === 0) lines.push('- none detected');
  for (const usage of artifact.usages) {
    lines.push(`- \`${usage.handler}\` -> \`${usage.backend}\` \`${usage.method || '?'} ${usage.path || '?'}\``);
  }
  lines.push('');
  lines.push('## Diagnostics');
  lines.push('');
  if (artifact.diagnostics.length === 0) lines.push('- none');
  for (const diag of artifact.diagnostics) lines.push(`- \`${diag.code}\`: ${diag.message}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildBackendCapabilities(dispatchTable, executionPlan, handlerEval, options = {}) {
  const cwd = options.cwd || process.cwd();
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const config = configArtifact(options);
  const engine = selectRuntimeEngine(config);
  const normalized = normalizeBackends(config);
  const usages = collectFetchUsages(handlerEval);
  const usageDiagnostics = validateUsages(usages, normalized.backends, engine);
  const diagnostics = [...normalized.diagnostics, ...usageDiagnostics];

  const artifact = normalizeArtifact({
    version: BACKEND_CAPABILITIES_VERSION,
    generatedBy,
    source: dispatchTable?.source,
    policy: {
      phase: BACKEND_CAPABILITIES_PHASE,
      status: 'locked-contract',
      sanctionedPath: 'ctx.fetch("backendKey", { method, path })',
      declarationSurface: 'defineConfig.backends',
      appFetchOutbound: false,
      globalFetchAllowed: false,
      arbitraryNetworkImportsAllowed: false,
      wasmFetchEffectImplemented: false,
      jsEngineEscapeHatch: 'manual-only'
    },
    lockedPositions: [
      'defineConfig.backends declares outbound backend capabilities.',
      'ctx.fetch consumes declared outbound backend capabilities during active execution.',
      'Global fetch and networking libraries are forbidden in PulseWasm handlers.',
      'backend key, method, and request object are static in v1.',
      'Wasm fetch execution is reserved for a future host effect/resume runtime.',
      'JS engine usage is manual escape hatch debt; fallback is never automatic.'
    ],
    runtime: {
      engine: engine.engine,
      engineSource: engine.source,
      manualEscapeHatch: engine.engine === 'js',
      automaticFallback: false
    },
    defaults: {
      timeoutMs: DEFAULT_BACKEND_TIMEOUT_MS
    },
    backends: normalized.backends,
    usages,
    diagnostics,
    diagnosticsPolicy: {
      errors: [
        'PULSEWASM_FETCH_EFFECT_UNSUPPORTED',
        'PULSEWASM_UNDECLARED_BACKEND',
        'PULSEWASM_DYNAMIC_BACKEND_KEY',
        'PULSEWASM_DYNAMIC_FETCH_REQUEST',
        'PULSEWASM_BACKEND_METHOD_NOT_ALLOWED',
        'PULSEWASM_FORBIDDEN_GLOBAL_FETCH',
        'PULSEWASM_FORBIDDEN_NETWORK_IMPORT'
      ],
      debt: ['PULSEWASM_FETCH_REQUIRES_JS_ENGINE']
    },
    futureWasmEffectAbi: {
      implementedIn10G: false,
      reservedShape: 'pulse_fetch_start(ctxRef, backendKeyRef, requestRef) -> FetchEffectRef',
      resumeRuntimeRequired: true
    },
    summary: {
      backends: normalized.backends.length,
      usages: usages.length,
      engine: engine.engine,
      wasmFetchEffectImplemented: false,
      wasmModeBlockedByFetch: engine.engine === 'wasm' && usages.length > 0,
      jsEscapeHatchDebt: engine.engine === 'js' && usages.length > 0,
      diagnostics: diagnostics.length
    }
  }, cwd);

  return {
    artifact,
    files: [{ file: 'generated/host/backend-capabilities.md', text: buildMarkdown(artifact) }],
    diagnostics
  };
}

module.exports = {
  BACKEND_CAPABILITIES_VERSION,
  DEFAULT_BACKEND_TIMEOUT_MS,
  buildBackendCapabilities,
  collectFetchUsages,
  normalizeBackends
};
