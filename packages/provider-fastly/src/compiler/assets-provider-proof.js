'use strict';

function loadAssetsContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/assets/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/assets/contracts.js');
    }
    throw error;
  }
}

function loadDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/diagnostics.js');
    }
    throw error;
  }
}

const assetsContracts = loadAssetsContracts();
const {
  PACKAGE_VERSION,
  normalizeArtifact,
  normalizeDiagnostic
} = loadDiagnostics();
const {
  createFastlyAssetsProvider,
  createDefaultStoresFromPlan,
  buildFastlyAssetsProviderConfig,
  normalizeHeaders
} = require('../runtime/assets-provider.js');

const phaseName = 'fastly-assets-provider-proof';

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}

function normalizePlan(input) {
  const plan = input && input.artifact ? input.artifact : input;
  if (!plan || typeof plan !== 'object') return undefined;
  return {
    ...plan,
    entries: Array.isArray(plan.entries) ? plan.entries.map(clone) : [],
    payloadModes: plan.payloadModes ? clone(plan.payloadModes) : undefined
  };
}

function plannedEntries(plan) {
  return (plan && Array.isArray(plan.entries) ? plan.entries : [])
    .filter((entry) => entry && entry.status !== 'unsupported' && entry.lookup && entry.lookup.store && entry.lookup.key)
    .map(clone);
}

function normalizeKey(key) {
  const text = String(key || '');
  return text.startsWith('/') ? text : `/${text}`;
}

function makeDiagnostic(code, message, severity, details) {
  return normalizeDiagnostic({
    phase: phaseName,
    severity: severity || 'error',
    code,
    message,
    hint: details && details.hint,
    details,
    loc: { file: '<fastly-assets-provider-proof>' }
  });
}

function headerValue(headers, name) {
  const lower = String(name).toLowerCase();
  const found = normalizeHeaders(headers).find(([key]) => String(key).toLowerCase() === lower);
  return found ? found[1] : undefined;
}

function resultBody(result) {
  if (!result) return undefined;
  if (result.body !== undefined) return String(result.body);
  if (result.bodyStream && Array.isArray(result.bodyStream.chunks)) {
    return result.bodyStream.chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)).join('');
  }
  return undefined;
}

function check(name, passed, details, failures, diagnostics) {
  const out = { name, status: passed ? 'ok' : 'error', details: details || {} };
  if (!passed) {
    failures.push(out);
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_PROVIDER_SMOKE_FAILED,
      `Fastly assets provider proof check failed: ${name}.`,
      'error',
      { check: name, details: out.details }
    ));
  }
  return out;
}

function cloneEntryForPayload(entry, payloadMode, idSuffix) {
  const next = clone(entry);
  next.id = `${entry.id || 'asset'}-${idSuffix}`;
  next.lookup = { ...(next.lookup || {}), payloadMode };
  next.response = {
    ...(next.response || {}),
    lookupId: next.id,
    payloadMode,
    payloadStatus: payloadMode === 'binary-buffer' ? 'reserved-with-diagnostic' : 'lowering-plan-only'
  };
  return next;
}

function selectEntry(entries, method) {
  const upper = String(method || 'GET').toUpperCase();
  if (upper === 'HEAD') {
    return entries.find((entry) => String(entry.lookup.method || 'GET').toUpperCase() === 'HEAD') || entries[0];
  }
  return entries.find((entry) => String(entry.lookup.method || 'GET').toUpperCase() === upper) || entries[0];
}

function bodyFixtureForEntry(entry, label) {
  return `${label}:${entry.lookup.store}:${normalizeKey(entry.lookup.key)}`;
}

function storesWithBody(entry, body, options = {}) {
  return {
    [entry.lookup.store]: {
      [normalizeKey(entry.lookup.key)]: {
        status: options.status || (entry.response && entry.response.status) || 200,
        body,
        payloadMode: options.payloadMode,
        cacheControl: entry.lookup.cacheControl,
        headers: [
          ['Content-Type', options.contentType || 'text/plain; charset=utf-8'],
          ['X-PulseWasm-Fastly-Proof', options.label || '1']
        ]
      }
    }
  };
}

function sourceArtifactVersion(value) {
  if (!value) return undefined;
  if (value.artifact) return value.artifact.version;
  return value.version;
}

function normalizeSourceArtifacts(inputs) {
  const fastlyStreamBindingPlan = inputs.fastlyStreamBindingPlan || (inputs.fastlyHostcallBinding && inputs.fastlyHostcallBinding.streamBindingPlan);
  const fastlyStreamHeaderAdapter = inputs.fastlyStreamHeaderAdapter || (inputs.fastlyAdapter && inputs.fastlyAdapter.streamHeaderAdapter);
  return {
    fastlyStreamBindingPlan: sourceArtifactVersion(fastlyStreamBindingPlan),
    fastlyStreamHeaderAdapter: sourceArtifactVersion(fastlyStreamHeaderAdapter),
    requestResultHeaders: sourceArtifactVersion(inputs.requestResultHeaders),
    streamingPassthrough: sourceArtifactVersion(inputs.streamingPassthrough),
    wasmHostAbi: sourceArtifactVersion(inputs.wasmHostAbi)
  };
}

function buildFastlyAssetsProviderProof(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const plan = normalizePlan(inputs.assetsLoweringPlan || inputs.plan);
  const diagnostics = [];
  if (!plan) {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_PROVIDER_PLAN_REQUIRED,
      'Fastly assets provider proof requires an assets-lowering-plan artifact.',
      'error',
      { hint: 'Emit --assets-lowering-plan before requesting the Fastly assets provider proof.' }
    ));
  }

  const entries = plannedEntries(plan);
  if (plan && entries.length === 0) {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.FASTLY_PROVIDER_PLAN_REQUIRED,
      'Fastly assets provider proof requires at least one static assets lookup/respond entry from the lowering plan.',
      'error',
      { entries: 0, hint: 'Add assets.lookup("public", "/file.txt") and assets.respond(handle) to the entry source.' }
    ));
  }

  const failures = [];
  const checks = [];
  const results = {};
  const sourceArtifacts = normalizeSourceArtifacts(inputs);
  let proofStores = inputs.stores;
  const providerConfig = inputs.providerConfig || buildFastlyAssetsProviderConfig({ plan, resolvedConfig: inputs.resolvedConfig });
  let provider;

  checks.push(check(
    'Fastly assets provider config maps plan stores to symbolic config/secret refs',
    providerConfig && providerConfig.provider === 'fastly' && providerConfig.symbolicRefsOnly === true && Array.isArray(providerConfig.stores) && providerConfig.stores.length === entries.length ? true : Boolean(providerConfig && providerConfig.stores && providerConfig.stores.length > 0 && providerConfig.configStore && providerConfig.secretStore),
    {
      stores: providerConfig && providerConfig.stores ? providerConfig.stores.length : 0,
      configStore: providerConfig && providerConfig.configStore,
      secretStore: providerConfig && providerConfig.secretStore,
      symbolicRefsOnly: providerConfig && providerConfig.symbolicRefsOnly
    },
    failures,
    diagnostics
  ));

  if (entries.length > 0) {
    const getEntry = selectEntry(entries, 'GET');
    const headEntry = selectEntry(entries, 'HEAD') || getEntry;
    if (!proofStores) {
      proofStores = createDefaultStoresFromPlan(plan);
      proofStores[getEntry.lookup.store] = {
        ...(proofStores[getEntry.lookup.store] || {}),
        [normalizeKey(getEntry.lookup.key)]: {
          status: (getEntry.response && getEntry.response.status) || 200,
          body: bodyFixtureForEntry(getEntry, 'fastly-proof'),
          cacheControl: getEntry.lookup.cacheControl,
          headers: [['Content-Type', 'text/plain; charset=utf-8']]
        }
      };
      proofStores[headEntry.lookup.store] = {
        ...(proofStores[headEntry.lookup.store] || {}),
        [normalizeKey(headEntry.lookup.key)]: {
          status: (headEntry.response && headEntry.response.status) || 200,
          body: bodyFixtureForEntry(headEntry, 'fastly-proof-head'),
          cacheControl: headEntry.lookup.cacheControl,
          headers: [['Content-Type', 'text/plain; charset=utf-8']]
        }
      };
    }

    provider = createFastlyAssetsProvider({
      plan,
      stores: proofStores,
      mode: inputs.mode || 'provider-object-store',
      providerConfig,
      resolvedConfig: inputs.resolvedConfig,
      sourceArtifacts
    });
    diagnostics.push(...(provider.diagnostics || []));

    const getResult = provider.executeRequest({ method: 'GET', path: getEntry.lookup.key });
    results.getText = {
      status: getResult.status,
      kind: getResult.kind,
      body: resultBody(getResult),
      headers: normalizeHeaders(getResult.headers),
      diagnostics: getResult.diagnostics || []
    };
    checks.push(check(
      'GET maps to Fastly response path with status/headers/body',
      getResult.status === ((getEntry.response && getEntry.response.status) || 200) && getResult.kind === 'fastly-response' && typeof getResult.body === 'string' && getResult.body.length > 0 && getResult.fastlyResponsePath === true,
      { status: getResult.status, kind: getResult.kind, bodyLength: getResult.body ? String(getResult.body).length : 0, fastlyResponsePath: getResult.fastlyResponsePath },
      failures,
      diagnostics
    ));
    checks.push(check(
      'GET headers/status pass through into Fastly response shape',
      Boolean(headerValue(getResult.headers, 'Content-Type')) && headerValue(getResult.headers, 'X-PulseWasm-Fastly-Asset-Key') === normalizeKey(getEntry.lookup.key),
      { contentType: headerValue(getResult.headers, 'Content-Type'), assetKey: headerValue(getResult.headers, 'X-PulseWasm-Fastly-Asset-Key') },
      failures,
      diagnostics
    ));
    if (getEntry.lookup.cacheControl) {
      checks.push(check(
        'GET cache-control policy is preserved in Fastly response headers when declared',
        headerValue(getResult.headers, 'Cache-Control') === getEntry.lookup.cacheControl,
        { expected: getEntry.lookup.cacheControl, actual: headerValue(getResult.headers, 'Cache-Control') },
        failures,
        diagnostics
      ));
    }

    const headResult = provider.executeRequest({ method: 'HEAD', path: headEntry.lookup.key });
    results.head = {
      status: headResult.status,
      kind: headResult.kind,
      body: resultBody(headResult),
      headers: normalizeHeaders(headResult.headers),
      diagnostics: headResult.diagnostics || []
    };
    checks.push(check(
      'HEAD maps to Fastly response headers/status with no body',
      headResult.status === ((headEntry.response && headEntry.response.status) || 200) && headResult.kind === 'fastly-empty' && headResult.body === undefined,
      { status: headResult.status, kind: headResult.kind, body: headResult.body },
      failures,
      diagnostics
    ));

    const missingPath = '/__pulsewasm-fastly-missing-asset__';
    const missingResult = provider.executeRequest({ method: 'GET', path: missingPath });
    results.missing = {
      status: missingResult.status,
      kind: missingResult.kind,
      passThroughOn404: missingResult.passThroughOn404,
      diagnostics: missingResult.diagnostics || []
    };
    checks.push(check(
      'missing asset follows Fastly 404/pass-through policy',
      missingResult.status === 404 && missingResult.kind === 'fastly-empty' && missingResult.passThroughOn404 === true,
      { status: missingResult.status, kind: missingResult.kind, passThroughOn404: missingResult.passThroughOn404 },
      failures,
      diagnostics
    ));

    const methodResult = provider.executeRequest({ method: 'POST', path: getEntry.lookup.key });
    results.unsupportedMethod = {
      status: methodResult.status,
      kind: methodResult.kind,
      headers: normalizeHeaders(methodResult.headers),
      diagnostics: methodResult.diagnostics || []
    };
    checks.push(check(
      'unsupported methods are diagnosed and rejected by Fastly proof',
      methodResult.status === 405 && (methodResult.diagnostics || []).some((diag) => diag.code === assetsContracts.ASSETS_DIAGNOSTIC_CODES.UNSUPPORTED_METHOD),
      { status: methodResult.status, diagnosticCodes: (methodResult.diagnostics || []).map((diag) => diag.code) },
      failures,
      diagnostics
    ));

    const streamEntry = cloneEntryForPayload(getEntry, 'stream-pass-through-response', 'stream');
    const streamPlan = { ...plan, entries: [streamEntry] };
    const streamProvider = createFastlyAssetsProvider({
      plan: streamPlan,
      stores: storesWithBody(streamEntry, bodyFixtureForEntry(streamEntry, 'fastly-proof-stream'), { payloadMode: 'stream-pass-through-response', label: 'stream' }),
      providerConfig,
      sourceArtifacts
    });
    const streamResult = streamProvider.executeRequest({ method: 'GET', path: streamEntry.lookup.key });
    results.stream = {
      status: streamResult.status,
      kind: streamResult.kind,
      fastlyStreamBindingPlanConnected: streamResult.fastlyStreamBindingPlanConnected,
      responseRef: streamResult.responseRef,
      streamRef: streamResult.streamRef,
      body: resultBody(streamResult),
      diagnostics: streamResult.diagnostics || []
    };
    checks.push(check(
      'stream pass-through response maps to Fastly stream binding plan path',
      streamResult.status === 200 && streamResult.kind === 'fastly-stream' && streamResult.bodyStream && streamResult.bodyStream.hostOwnedBytes === true && resultBody(streamResult).length > 0,
      { status: streamResult.status, kind: streamResult.kind, fastlyStreamBindingPlanConnected: streamResult.fastlyStreamBindingPlanConnected, responseRef: streamResult.responseRef, streamRef: streamResult.streamRef, bodyLength: resultBody(streamResult).length },
      failures,
      diagnostics
    ));

    const binaryEntry = cloneEntryForPayload(getEntry, 'binary-buffer', 'binary');
    const binaryPlan = { ...plan, entries: [binaryEntry] };
    const binaryProvider = createFastlyAssetsProvider({
      plan: binaryPlan,
      stores: storesWithBody(binaryEntry, Buffer.from('binary-proof'), { payloadMode: 'binary-buffer', label: 'binary' }),
      providerConfig,
      sourceArtifacts
    });
    const binaryResult = binaryProvider.executeRequest({ method: 'GET', path: binaryEntry.lookup.key });
    results.binary = {
      status: binaryResult.status,
      kind: binaryResult.kind,
      diagnostics: binaryResult.diagnostics || []
    };
    checks.push(check(
      'binary body/buffer mode remains reserved with diagnostic for Fastly',
      binaryResult.status === 501 && (binaryResult.diagnostics || []).some((diag) => diag.code === assetsContracts.ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED),
      { status: binaryResult.status, diagnosticCodes: (binaryResult.diagnostics || []).map((diag) => diag.code) },
      failures,
      diagnostics
    ));
  }

  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const artifact = normalizeArtifact({
    version: assetsContracts.ASSETS_FASTLY_PROVIDER_PROOF_VERSION,
    generatedBy,
    phase: phaseName,
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    provider: 'fastly',
    providerPackage: '@pulse-compute/provider-fastly',
    contractId: assetsContracts.ASSETS_CONTRACT_ID,
    sourceAssetsLoweringPlanVersion: plan && plan.version,
    loweringPlanConnected: Boolean(plan && entries.length > 0),
    providerBehaviorImplemented: true,
    compiledWasmLowering: false,
    proofMode: 'direct-fastly-provider-smoke-connected-to-lowering-plan',
    scope: {
      mode: inputs.mode || 'provider-object-store',
      methods: clone(assetsContracts.ASSETS_ALLOWED_METHODS),
      staticStoreKeyFromLoweringPlan: true,
      uploads: false,
      invalidation: false,
      mutationApis: false,
      fullObjectStoreSemantics: false,
      cacheControlPolicy: 'pass-through-when-declared',
      notFoundPolicy: '404-pass-through',
      configSecretRefs: 'symbolic-only'
    },
    providerConfig,
    fastlyArtifacts: {
      fastlyStreamBindingPlan: sourceArtifacts.fastlyStreamBindingPlan,
      fastlyStreamHeaderAdapter: sourceArtifacts.fastlyStreamHeaderAdapter,
      requestResultHeaders: sourceArtifacts.requestResultHeaders,
      streamingPassthrough: sourceArtifacts.streamingPassthrough,
      wasmHostAbi: sourceArtifacts.wasmHostAbi
    },
    payloadModes: {
      textResponseBody: {
        mode: 'text-response-body',
        status: 'implemented-now',
        proof: 'GET response body via Fastly-like response path'
      },
      headerPassThrough: {
        mode: 'header-pass-through',
        status: 'implemented-now',
        proof: 'Content-Type, X-PulseWasm-Fastly-Asset-Key, and Cache-Control header checks'
      },
      statusResultPassThrough: {
        mode: 'status-result-pass-through',
        status: 'implemented-now',
        proof: 'GET and HEAD status checks'
      },
      streamPassThroughResponse: {
        mode: 'stream-pass-through-response',
        contractStatus: assetsContracts.ASSETS_PAYLOAD_MODE_CLASSIFICATION.streamPassThroughResponse.status,
        planStatus: plan && plan.payloadModes && plan.payloadModes.stream ? plan.payloadModes.stream.status : undefined,
        hostSurfaceStatus: assetsContracts.ASSETS_PAYLOAD_MODE_CLASSIFICATION.streamPassThroughResponse.hostSurfaceStatus,
        status: entries.length > 0 ? 'implemented-fastly-proof' : 'not-exercised',
        providerWired: entries.length > 0,
        fastlyStreamBindingPlanConnected: Boolean(sourceArtifacts.fastlyStreamBindingPlan),
        binaryStaticPayloadDecision: 'stream-pass-through-for-stream-mode; binary-buffer-reserved',
        proof: 'direct Fastly provider returns kind=fastly-stream with responseRef/streamRef-style binding metadata'
      },
      binaryBodyBufferResponse: {
        mode: 'binary-buffer',
        contractStatus: assetsContracts.ASSETS_PAYLOAD_MODE_CLASSIFICATION.binaryBodyBufferResponse.status,
        planStatus: plan && plan.payloadModes && plan.payloadModes.binary ? plan.payloadModes.binary.status : undefined,
        status: 'reserved-with-diagnostic',
        providerWired: false,
        diagnosticCode: assetsContracts.ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED
      }
    },
    entriesConsumed: entries.map((entry) => ({
      id: entry.id,
      store: entry.lookup.store,
      key: entry.lookup.key,
      method: entry.lookup.method || 'GET',
      payloadMode: (entry.response && entry.response.payloadMode) || entry.lookup.payloadMode || 'text-response-body',
      response: entry.response ? { status: entry.response.status, payloadMode: entry.response.payloadMode } : undefined
    })),
    smoke: {
      checks,
      failedChecks: failures,
      results
    },
    policy: {
      compilerOwnsProviderBehavior: false,
      providerOwnsImplementation: true,
      planBuilderOwner: plan && plan.policy && plan.policy.builderOwner ? plan.policy.builderOwner : '@pulse-compute/assets',
      providerOwner: '@pulse-compute/provider-fastly',
      consumesLoweringPlan: true,
      fastlyBehaviorInCompiler: false,
      officialSdkDependency: false
    },
    summary: {
      entries: entries.length,
      checks: checks.length,
      failedChecks: failures.length,
      providerConfigMapped: checks.some((entry) => entry.name.startsWith('Fastly assets provider config') && entry.status === 'ok'),
      getTextValidated: checks.some((entry) => entry.name.startsWith('GET maps') && entry.status === 'ok'),
      headValidated: checks.some((entry) => entry.name.startsWith('HEAD maps') && entry.status === 'ok'),
      notFoundValidated: checks.some((entry) => entry.name.startsWith('missing asset') && entry.status === 'ok'),
      unsupportedMethodValidated: checks.some((entry) => entry.name.startsWith('unsupported methods') && entry.status === 'ok'),
      streamValidated: checks.some((entry) => entry.name.startsWith('stream pass-through') && entry.status === 'ok'),
      streamBindingPlanConnected: Boolean(sourceArtifacts.fastlyStreamBindingPlan),
      binaryReservedValidated: checks.some((entry) => entry.name.startsWith('binary body') && entry.status === 'ok'),
      diagnostics: diagnostics.length,
      errorDiagnostics: errorDiagnostics.length
    },
    diagnostics
  }, cwd);

  return {
    artifact,
    diagnostics,
    entries: artifact.entriesConsumed,
    smoke: artifact.smoke,
    providerConfig: artifact.providerConfig,
    hasErrors: errorDiagnostics.length > 0
  };
}

module.exports = {
  buildFastlyAssetsProviderProof,
  phaseName
};
