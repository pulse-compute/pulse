'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { extractFromFile } = require('./extractor.js');
const { resolveConfigFromFile } = require('./config-resolver.js');
const { ExtractionError, createDiagnosticsEnvelope, formatDiagnostics } = require('./diagnostics.js');
const {
  applyCliIntent,
  createArtifactsList,
  createDoctorArtifact,
  createExplainArtifact,
  knownFeatures,
  pushUnique,
  splitList
} = require('./cli-intents.js');
const { createBuildManifest, makeArtifactRecord } = require('./build-manifest.js');
const { getDefaultArtifactsDir } = require('@pulse-compute/wasm-build-support/artifacts-dir');
const { normalizeArtifactFile } = require('@pulse-compute/wasm-build-support/files');

const BUILD_COMMANDS = new Set(['build', 'extract']);
const PLAN_COMMANDS = new Set(['plan']);
const DOCTOR_COMMANDS = new Set(['doctor']);
const EXPLAIN_COMMANDS = new Set(['explain']);
const ARTIFACT_COMMANDS = new Set(['artifacts', 'artifact']);
const CONFIG_COMMANDS = new Set(['resolve-config', 'config']);

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseEnvAssignment(value) {
  const index = value.indexOf('=');
  if (index <= 0) {
    throw new Error(`Invalid --env value "${value}". Use NAME=value.`);
  }
  return [value.slice(0, index), value.slice(index + 1)];
}

function parseArgs(argv, defaults = {}) {
  const args = {
    command: 'build',
    entry: undefined,
    config: undefined,
    outDir: defaults.defaultOutDir || path.join(process.cwd(), 'artifacts'),
    outDirExplicit: false,
    root: undefined,
    profile: undefined,
    targetIntent: undefined,
    providerIntent: undefined,
    features: [],
    diagnosticsFile: undefined,
    manifestFile: undefined,
    artifactsAction: undefined,
    outputFormat: 'text',
    env: {},
    includeAst: false,
    emitDispatchTs: false,
    emitHandlerBindings: false,
    emitExecutionHarness: false,
    emitAssemblyScriptShape: false,
    emitAssemblyScriptCore: false,
    emitAssemblyScriptCompile: false,
    emitWasmSmoke: false,
    emitLocalHarness: false,
    emitWasmHostAbi: false,
    emitWasmHostBridge: false,
    emitRequestResultHeaders: false,
    emitChannelBroadcaster: false,
    emitJsonBody: false,
    emitBackendCapabilities: false,
    emitHostRuntimeKernel: false,
    emitNodeAdapter: false,
    emitHandlerLibraryContracts: false,
    emitAssetsLoweringPlan: false,
    emitNodeAssetsProviderProof: false,
    emitFastlyAssetsProviderProof: false,
    emitFastlyAssetsPackageOutParityProof: false,
    emitRouteHandlerEffectPlan: false,
    emitNodeRouteHandlerEffectProof: false,
    emitFastlyRouteHandlerEffectProof: false,
    emitFastlyLifecycleParityProof: false,
    emitNodeLiveOriginRouteHandlerEffectProof: false,
    emitNodeCompiledRouteHandlerEffectBridge: false,
    emitRouteHandlerContextLoweringPlan: false,
    emitHandlerIoLifecyclePlan: false,
    emitRequestJsonBodyPlan: false,
    emitNodeRequestJsonBodyProof: false,
    emitSchemaDecodeResultPlan: false,
    emitNodeSchemaDecodeResultProof: false,
    emitSchemaResponseCodecPlan: false,
    emitNodeSchemaResponseCodecProof: false,
    emitBackendJsonRequestBodyPlan: false,
    emitNodeBackendJsonRequestBodyProof: false,
    emitHostCapabilities: false,
    emitEffectRuntime: false,
    emitEffectComposition: false,
    emitCompiledHandlers: false,
    emitSchemaJsonCompile: false,
    emitSchemaJsonSidecar: false,
    emitSchemaJsonGenericParser: false,
    emitLibrarySidecars: false,
    emitStreamingPassthrough: false,
    emitIntegratedCompiledApp: false,
    emitCompiledWasmRuntime: false,
    emitPulseWrapper: false,
    emitFastlyReadiness: false,
    emitFastlyHostcallBinding: false,
    emitFastlyAdapter: false,
    emitFastlyCommandEntry: false,
    configOnly: false,
    strict: true,
    noStrictRequested: false,
    help: false
  };

  const tokens = argv.slice();
  if (tokens.length > 0) {
    const first = tokens[0];
    if (BUILD_COMMANDS.has(first)) {
      args.command = 'build';
      tokens.shift();
    } else if (PLAN_COMMANDS.has(first)) {
      args.command = 'plan';
      tokens.shift();
    } else if (DOCTOR_COMMANDS.has(first)) {
      args.command = 'doctor';
      tokens.shift();
    } else if (EXPLAIN_COMMANDS.has(first)) {
      args.command = 'explain';
      tokens.shift();
    } else if (ARTIFACT_COMMANDS.has(first)) {
      args.command = 'artifacts';
      args.artifactsAction = 'list';
      tokens.shift();
    } else if (CONFIG_COMMANDS.has(first)) {
      args.command = 'resolve-config';
      args.configOnly = true;
      tokens.shift();
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--json') {
      args.outputFormat = 'json';
      continue;
    }
    if (token === '--format') {
      args.outputFormat = requireValue(tokens, ++i, token);
      continue;
    }
    if (token.startsWith('--format=')) {
      args.outputFormat = token.slice('--format='.length);
      continue;
    }
    if (token === '--target') {
      args.targetIntent = requireValue(tokens, ++i, token);
      continue;
    }
    if (token.startsWith('--target=')) {
      args.targetIntent = token.slice('--target='.length);
      continue;
    }
    if (token === '--provider') {
      args.providerIntent = requireValue(tokens, ++i, token);
      continue;
    }
    if (token.startsWith('--provider=')) {
      args.providerIntent = token.slice('--provider='.length);
      continue;
    }
    if (token === '--feature' || token === '--features') {
      pushUnique(args.features, splitList(requireValue(tokens, ++i, token)));
      continue;
    }
    if (token.startsWith('--feature=')) {
      pushUnique(args.features, splitList(token.slice('--feature='.length)));
      continue;
    }
    if (token.startsWith('--features=')) {
      pushUnique(args.features, splitList(token.slice('--features='.length)));
      continue;
    }
    if (token === '--diagnostics') {
      args.diagnosticsFile = requireValue(tokens, ++i, token);
      continue;
    }
    if (token.startsWith('--diagnostics=')) {
      args.diagnosticsFile = token.slice('--diagnostics='.length);
      continue;
    }
    if (token === '--manifest') {
      args.manifestFile = requireValue(tokens, ++i, token);
      continue;
    }
    if (token.startsWith('--manifest=')) {
      args.manifestFile = token.slice('--manifest='.length);
      continue;
    }
    if (token === '--ast' || token === '--emit-ast') {
      args.includeAst = true;
      continue;
    }
    if (token === '--emit-dispatch-ts' || token === '--dispatch-ts') {
      args.emitDispatchTs = true;
      continue;
    }
    if (token === '--emit-handler-bindings' || token === '--handler-bindings') {
      args.emitHandlerBindings = true;
      args.emitDispatchTs = true;
      continue;
    }
    if (token === '--emit-execution-harness' || token === '--execution-harness') {
      args.emitExecutionHarness = true;
      args.emitHandlerBindings = true;
      args.emitDispatchTs = true;
      continue;
    }
    if (token === '--emit-assemblyscript-shape' || token === '--assemblyscript-shape' || token === '--emit-as-shape' || token === '--as-shape') {
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-assemblyscript-core' || token === '--assemblyscript-core' || token === '--emit-as-core' || token === '--as-core') {
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-assemblyscript-compile' || token === '--assemblyscript-compile' || token === '--emit-as-compile' || token === '--as-compile' || token === '--compile-as') {
      args.emitAssemblyScriptCompile = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-wasm-smoke' || token === '--wasm-smoke' || token === '--emit-assemblyscript-wasm-smoke' || token === '--assemblyscript-wasm-smoke' || token === '--emit-as-wasm-smoke' || token === '--as-wasm-smoke') {
      args.emitWasmSmoke = true;
      args.emitAssemblyScriptCompile = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-local-harness' || token === '--local-harness') {
      args.emitLocalHarness = true;
      args.emitExecutionHarness = true;
      args.emitHandlerBindings = true;
      args.emitDispatchTs = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-wasm-host-abi' || token === '--wasm-host-abi' || token === '--host-abi' || token === '--emit-host-abi') {
      args.emitWasmHostAbi = true;
      continue;
    }
    if (token === '--emit-wasm-host-bridge' || token === '--wasm-host-bridge' || token === '--host-bridge' || token === '--emit-host-bridge') {
      args.emitWasmHostBridge = true;
      args.emitWasmHostAbi = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-request-result-headers' || token === '--request-result-headers' || token === '--headers-adaptor' || token === '--emit-headers-adaptor') {
      args.emitRequestResultHeaders = true;
      args.emitWasmHostAbi = true;
      continue;
    }
    if (token === '--emit-channel-broadcaster' || token === '--channel-broadcaster' || token === '--broadcaster-adaptor' || token === '--emit-broadcaster-adaptor') {
      args.emitChannelBroadcaster = true;
      args.emitRequestResultHeaders = true;
      args.emitWasmHostAbi = true;
      continue;
    }
    if (token === '--emit-json-body' || token === '--json-body' || token === '--emit-body-json' || token === '--body-json') {
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitWasmHostAbi = true;
      continue;
    }
    if (token === '--emit-backend-capabilities' || token === '--backend-capabilities' || token === '--emit-ctx-fetch' || token === '--ctx-fetch') {
      args.emitBackendCapabilities = true;
      continue;
    }
    if (token === '--emit-host-runtime-kernel' || token === '--host-runtime-kernel' || token === '--host-runtime' || token === '--emit-host-runtime') {
      args.emitHostRuntimeKernel = true;
      args.emitWasmHostBridge = true;
      args.emitWasmHostAbi = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitChannelBroadcaster = true;
      args.emitBackendCapabilities = true;
      continue;
    }
    if (token === '--emit-node-adapter' || token === '--node-adapter' || token === '--emit-node-host-adapter' || token === '--node-host-adapter') {
      args.emitNodeAdapter = true;
      args.emitHostRuntimeKernel = true;
      args.emitWasmHostBridge = true;
      args.emitWasmHostAbi = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitChannelBroadcaster = true;
      args.emitBackendCapabilities = true;
      continue;
    }
    if (token === '--emit-handler-library-contracts' || token === '--handler-library-contracts' || token === '--emit-library-contracts' || token === '--library-contracts') {
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-assets-lowering-plan' || token === '--assets-lowering-plan' || token === '--emit-assets-plan') {
      args.emitAssetsLoweringPlan = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-assets-compiled-wasm-sidecar-plan' || token === '--assets-compiled-wasm-sidecar-plan' || token === '--emit-assets-sidecar-plan') {
      args.emitAssetsCompiledWasmSidecarPlan = true;
      args.emitAssetsLoweringPlan = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-assets-sidecar-compile-link-proof' || token === '--assets-sidecar-compile-link-proof' || token === '--emit-assets-sidecar-link-proof') {
      args.emitAssetsSidecarCompileLinkProof = true;
      args.emitAssetsCompiledWasmSidecarPlan = true;
      args.emitAssetsLoweringPlan = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-node-assets-provider-proof' || token === '--node-assets-provider-proof' || token === '--emit-node-assets-proof') {
      args.emitNodeAssetsProviderProof = true;
      args.emitAssetsLoweringPlan = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-node-compiled-wasm-assets-lifecycle-proof' || token === '--node-compiled-wasm-assets-lifecycle-proof' || token === '--emit-node-compiled-assets-proof') {
      args.emitNodeCompiledWasmAssetsLifecycleProof = true;
      args.emitAssetsCompiledWasmSidecarPlan = true;
      args.emitAssetsLoweringPlan = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-fastly-assets-provider-proof' || token === '--fastly-assets-provider-proof' || token === '--emit-fastly-assets-proof') {
      args.emitFastlyAssetsProviderProof = true;
      args.emitAssetsLoweringPlan = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-fastly-assets-package-out-parity-proof' || token === '--fastly-assets-package-out-parity-proof' || token === '--emit-fastly-assets-package-proof') {
      args.emitFastlyAssetsPackageOutParityProof = true;
      args.emitFastlyAssetsProviderProof = true;
      args.emitAssetsCompiledWasmSidecarPlan = true;
      args.emitAssetsLoweringPlan = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-route-handler-effect-plan' || token === '--route-handler-effect-plan' || token === '--emit-route-handler-effects' || token === '--route-handler-effects' || token === '--emit-route-effects' || token === '--route-effects' || token === '--emit-ctx-resolve-plan' || token === '--ctx-resolve-plan') {
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      args.emitEffectComposition = true;
      args.emitEffectRuntime = true;
      continue;
    }
    if (token === '--emit-node-route-handler-effect-proof' || token === '--node-route-handler-effect-proof' || token === '--emit-node-route-handler-effects' || token === '--node-route-handler-effects' || token === '--emit-node-route-effects' || token === '--node-route-effects' || token === '--emit-node-ctx-resolve-proof' || token === '--node-ctx-resolve-proof') {
      args.emitNodeRouteHandlerEffectProof = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      args.emitEffectComposition = true;
      args.emitEffectRuntime = true;
      continue;
    }
    if (token === '--emit-node-live-origin-route-handler-effect-proof' || token === '--node-live-origin-route-handler-effect-proof' || token === '--emit-node-live-origin-route-effects' || token === '--node-live-origin-route-effects' || token === '--emit-node-live-origin-ctx-resolve-proof' || token === '--node-live-origin-ctx-resolve-proof') {
      args.emitNodeLiveOriginRouteHandlerEffectProof = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      args.emitEffectComposition = true;
      args.emitEffectRuntime = true;
      continue;
    }
    if (token === '--emit-node-compiled-route-handler-effect-bridge' || token === '--node-compiled-route-handler-effect-bridge' || token === '--emit-node-compiled-route-effects' || token === '--node-compiled-route-effects' || token === '--emit-node-compiled-ctx-resolve-bridge' || token === '--node-compiled-ctx-resolve-bridge') {
      args.emitNodeCompiledRouteHandlerEffectBridge = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      args.emitEffectComposition = true;
      args.emitEffectRuntime = true;
      args.emitCompiledHandlers = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-fastly-route-handler-effect-proof' || token === '--fastly-route-handler-effect-proof' || token === '--emit-fastly-route-handler-effects' || token === '--fastly-route-handler-effects' || token === '--emit-fastly-route-effects' || token === '--fastly-route-effects' || token === '--emit-fastly-ctx-resolve-proof' || token === '--fastly-ctx-resolve-proof') {
      args.emitFastlyRouteHandlerEffectProof = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      args.emitEffectComposition = true;
      args.emitEffectRuntime = true;
      continue;
    }
    if (token === '--emit-route-handler-context-lowering' || token === '--route-handler-context-lowering' || token === '--emit-route-handler-context-plan' || token === '--route-handler-context-plan' || token === '--emit-context-lowering' || token === '--context-lowering' || token === '--emit-ctx-lowering' || token === '--ctx-lowering' || token === '--sync-context') {
      args.emitRouteHandlerContextLoweringPlan = true;
      continue;
    }
    if (token === '--emit-handler-io-lifecycle-plan' || token === '--handler-io-lifecycle-plan' || token === '--emit-handler-io-lifecycle' || token === '--handler-io-lifecycle' || token === '--emit-handler-io' || token === '--handler-io' || token === '--io-lifecycle') {
      args.emitHandlerIoLifecyclePlan = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      args.emitEffectComposition = true;
      args.emitEffectRuntime = true;
      continue;
    }
    if (token === '--emit-request-json-body-plan' || token === '--request-json-body-plan' || token === '--emit-request-json-body' || token === '--request-json-body' || token === '--emit-ctx-req-json' || token === '--ctx-req-json') {
      args.emitRequestJsonBodyPlan = true;
      args.emitSchemaJsonSidecar = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      continue;
    }
    if (token === '--emit-node-request-json-body-proof' || token === '--node-request-json-body-proof' || token === '--emit-node-ctx-req-json-proof' || token === '--node-ctx-req-json-proof') {
      args.emitNodeRequestJsonBodyProof = true;
      args.emitRequestJsonBodyPlan = true;
      args.emitSchemaJsonSidecar = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitCompiledHandlers = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-schema-decode-result-plan' || token === '--schema-decode-result-plan' || token === '--emit-schema-decode-result' || token === '--schema-decode-result' || token === '--emit-ctx-req-json-schema' || token === '--ctx-req-json-schema') {
      args.emitSchemaDecodeResultPlan = true;
      args.emitRequestJsonBodyPlan = true;
      args.emitSchemaJsonSidecar = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      continue;
    }
    if (token === '--emit-node-schema-decode-result-proof' || token === '--node-schema-decode-result-proof' || token === '--emit-node-ctx-req-json-schema-proof' || token === '--node-ctx-req-json-schema-proof') {
      args.emitNodeSchemaDecodeResultProof = true;
      args.emitSchemaDecodeResultPlan = true;
      args.emitRequestJsonBodyPlan = true;
      args.emitSchemaJsonSidecar = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitCompiledHandlers = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-schema-response-codec-plan' || token === '--schema-response-codec-plan' || token === '--emit-schema-response-codec' || token === '--schema-response-codec' || token === '--emit-ctx-result-json-schema' || token === '--ctx-result-json-schema') {
      args.emitSchemaResponseCodecPlan = true;
      args.emitSchemaDecodeResultPlan = true;
      args.emitRequestJsonBodyPlan = true;
      args.emitSchemaJsonSidecar = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      continue;
    }
    if (token === '--emit-node-schema-response-codec-proof' || token === '--node-schema-response-codec-proof' || token === '--emit-node-ctx-result-json-schema-proof' || token === '--node-ctx-result-json-schema-proof') {
      args.emitNodeSchemaResponseCodecProof = true;
      args.emitSchemaResponseCodecPlan = true;
      args.emitSchemaDecodeResultPlan = true;
      args.emitRequestJsonBodyPlan = true;
      args.emitSchemaJsonSidecar = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      args.emitCompiledHandlers = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-backend-json-request-body-plan' || token === '--backend-json-request-body-plan' || token === '--emit-backend-json-request-body' || token === '--backend-json-request-body' || token === '--emit-fetch-json-body' || token === '--fetch-json-body' || token === '--ctx-fetch-json') {
      args.emitBackendJsonRequestBodyPlan = true;
      args.emitSchemaResponseCodecPlan = true;
      args.emitSchemaDecodeResultPlan = true;
      args.emitRequestJsonBodyPlan = true;
      args.emitSchemaJsonSidecar = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      continue;
    }
    if (token === '--emit-node-backend-json-request-body-proof' || token === '--node-backend-json-request-body-proof' || token === '--emit-node-backend-json-request-body' || token === '--node-backend-json-request-body' || token === '--emit-node-fetch-json-body-proof' || token === '--node-fetch-json-body-proof') {
      args.emitNodeBackendJsonRequestBodyProof = true;
      args.emitBackendJsonRequestBodyPlan = true;
      args.emitSchemaResponseCodecPlan = true;
      args.emitSchemaDecodeResultPlan = true;
      args.emitRequestJsonBodyPlan = true;
      args.emitSchemaJsonSidecar = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      continue;
    }
    if (token === '--emit-fastly-lifecycle-parity-proof' || token === '--fastly-lifecycle-parity-proof' || token === '--emit-fastly-lifecycle-parity' || token === '--fastly-lifecycle-parity' || token === '--fastly-provider-lifecycle' || token === '--fastly-reference-lifecycle') {
      args.emitFastlyLifecycleParityProof = true;
      args.emitBackendJsonRequestBodyPlan = true;
      args.emitHandlerIoLifecyclePlan = true;
      args.emitSchemaResponseCodecPlan = true;
      args.emitSchemaDecodeResultPlan = true;
      args.emitRequestJsonBodyPlan = true;
      args.emitSchemaJsonSidecar = true;
      args.emitJsonBody = true;
      args.emitRequestResultHeaders = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      args.emitEffectComposition = true;
      args.emitEffectRuntime = true;
      continue;
    }
    if (token === '--emit-host-capabilities' || token === '--host-capabilities' || token === '--emit-wasi-provider-map' || token === '--wasi-provider-map') {
      args.emitHostCapabilities = true;
      args.emitHandlerLibraryContracts = true;
      args.emitRequestResultHeaders = true;
      args.emitChannelBroadcaster = true;
      args.emitJsonBody = true;
      args.emitBackendCapabilities = true;
      args.emitWasmHostAbi = true;
      continue;
    }
    if (token === '--emit-effect-runtime' || token === '--effect-runtime' || token === '--emit-effects' || token === '--effects') {
      args.emitEffectRuntime = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      args.emitHostCapabilities = true;
      args.emitHandlerLibraryContracts = true;
      args.emitRequestResultHeaders = true;
      args.emitChannelBroadcaster = true;
      args.emitJsonBody = true;
      args.emitBackendCapabilities = true;
      args.emitWasmHostAbi = true;
      continue;
    }
    if (token === '--emit-effect-composition' || token === '--effect-composition' || token === '--emit-effect-continuations' || token === '--effect-continuations') {
      args.emitEffectComposition = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitRouteHandlerEffectPlan = true;
      args.emitEffectRuntime = true;
      args.emitHostCapabilities = true;
      args.emitHandlerLibraryContracts = true;
      args.emitRequestResultHeaders = true;
      args.emitChannelBroadcaster = true;
      args.emitJsonBody = true;
      args.emitBackendCapabilities = true;
      args.emitWasmHostAbi = true;
      continue;
    }
    if (token === '--emit-compiled-handlers' || token === '--compiled-handlers' || token === '--emit-compiled-user-handlers' || token === '--compiled-user-handlers') {
      args.emitCompiledHandlers = true;
      args.emitRouteHandlerContextLoweringPlan = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-schema-json-compile' || token === '--schema-json-compile') {
      args.emitSchemaJsonCompile = true;
      args.emitJsonBody = true;
      args.emitWasmHostAbi = true;
      continue;
    }
    if (token === '--emit-schema-json-sidecar' || token === '--schema-json-sidecar' || token === '--emit-schema-json' || token === '--schema-json') {
      args.emitSchemaJsonSidecar = true;
      args.emitJsonBody = true;
      args.emitWasmHostAbi = true;
      continue;
    }
    if (token === '--emit-schema-json-generic-parser' || token === '--schema-json-generic-parser' || token === '--emit-schema-json-parser' || token === '--schema-json-parser' || token === '--emit-as-json-parser' || token === '--as-json-parser') {
      args.emitSchemaJsonGenericParser = true;
      args.emitJsonBody = true;
      args.emitWasmHostAbi = true;
      continue;
    }
    if (token === '--emit-library-sidecars' || token === '--library-sidecars' || token === '--emit-sidecar-consumption' || token === '--sidecar-consumption') {
      args.emitLibrarySidecars = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-streaming-passthrough' || token === '--streaming-passthrough' || token === '--emit-stream-result' || token === '--stream-result') {
      args.emitStreamingPassthrough = true;
      args.emitNodeAdapter = true;
      args.emitHostRuntimeKernel = true;
      args.emitWasmHostBridge = true;
      args.emitWasmHostAbi = true;
      args.emitRequestResultHeaders = true;
      args.emitJsonBody = true;
      args.emitChannelBroadcaster = true;
      args.emitBackendCapabilities = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      continue;
    }
    if (token === '--emit-integrated-compiled-app' || token === '--integrated-compiled-app' || token === '--emit-integrated-smoke' || token === '--integrated-smoke') {
      args.emitIntegratedCompiledApp = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      args.emitSchemaJsonSidecar = true;
      args.emitLibrarySidecars = true;
      args.emitJsonBody = true;
      args.emitWasmHostAbi = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-compiled-wasm-runtime' || token === '--compiled-wasm-runtime' || token === '--emit-local-compiled-wasm-runtime' || token === '--local-compiled-wasm-runtime') {
      args.emitCompiledWasmRuntime = true;
      args.emitIntegratedCompiledApp = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      args.emitSchemaJsonSidecar = true;
      args.emitLibrarySidecars = true;
      args.emitJsonBody = true;
      args.emitWasmHostAbi = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-pulse-wrapper' || token === '--pulse-wrapper' || token === '--emit-wrapper-integration' || token === '--wrapper-integration') {
      args.emitPulseWrapper = true;
      args.emitCompiledWasmRuntime = true;
      args.emitIntegratedCompiledApp = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      args.emitSchemaJsonSidecar = true;
      args.emitLibrarySidecars = true;
      args.emitJsonBody = true;
      args.emitWasmHostAbi = true;
      args.emitHandlerLibraryContracts = true;
      continue;
    }
    if (token === '--emit-fastly-hostcall-binding' || token === '--fastly-hostcall-binding' || token === '--emit-fastly-binding-contract' || token === '--fastly-binding-contract' || token === '--emit-fastly-hostcalls' || token === '--fastly-hostcalls') {
      args.emitFastlyHostcallBinding = true;
      args.emitFastlyReadiness = true;
      args.emitPulseWrapper = true;
      args.emitCompiledWasmRuntime = true;
      args.emitIntegratedCompiledApp = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      args.emitSchemaJsonSidecar = true;
      args.emitLibrarySidecars = true;
      args.emitJsonBody = true;
      args.emitWasmHostAbi = true;
      args.emitHandlerLibraryContracts = true;
      args.emitHostCapabilities = true;
      args.emitEffectComposition = true;
      continue;
    }
    if (token === '--emit-fastly-adapter' || token === '--fastly-adapter' || token === '--emit-fastly-stream-header-adapter' || token === '--fastly-stream-header-adapter') {
      args.emitFastlyAdapter = true;
      args.emitFastlyHostcallBinding = true;
      args.emitFastlyReadiness = true;
      args.emitPulseWrapper = true;
      args.emitCompiledWasmRuntime = true;
      args.emitIntegratedCompiledApp = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      args.emitSchemaJsonSidecar = true;
      args.emitLibrarySidecars = true;
      args.emitJsonBody = true;
      args.emitWasmHostAbi = true;
      args.emitHandlerLibraryContracts = true;
      args.emitHostCapabilities = true;
      args.emitEffectComposition = true;
      continue;
    }
    if (token === '--emit-fastly-command-entry' || token === '--fastly-command-entry' || token === '--emit-fastly-start' || token === '--fastly-start' || token === '--emit-fastly-command' || token === '--fastly-command') {
      args.emitFastlyCommandEntry = true;
      args.emitFastlyAdapter = true;
      args.emitFastlyHostcallBinding = true;
      args.emitFastlyReadiness = true;
      args.emitPulseWrapper = true;
      args.emitCompiledWasmRuntime = true;
      args.emitIntegratedCompiledApp = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      args.emitSchemaJsonSidecar = true;
      args.emitLibrarySidecars = true;
      args.emitJsonBody = true;
      args.emitWasmHostAbi = true;
      args.emitHandlerLibraryContracts = true;
      args.emitHostCapabilities = true;
      args.emitEffectComposition = true;
      continue;
    }
    if (token === '--emit-fastly-readiness' || token === '--fastly-readiness' || token === '--emit-fastly-audit' || token === '--fastly-audit') {
      args.emitFastlyReadiness = true;
      args.emitPulseWrapper = true;
      args.emitCompiledWasmRuntime = true;
      args.emitIntegratedCompiledApp = true;
      args.emitAssemblyScriptCore = true;
      args.emitAssemblyScriptShape = true;
      args.emitSchemaJsonSidecar = true;
      args.emitLibrarySidecars = true;
      args.emitJsonBody = true;
      args.emitWasmHostAbi = true;
      args.emitHandlerLibraryContracts = true;
      args.emitHostCapabilities = true;
      args.emitEffectComposition = true;
      continue;
    }
    if (token === '--strict') {
      args.strict = true;
      continue;
    }
    if (token === '--no-strict') {
      args.strict = false;
      args.noStrictRequested = true;
      continue;
    }
    if (token === '--config-only') {
      args.configOnly = true;
      args.command = 'resolve-config';
      continue;
    }
    if (token === '--config' || token === '-c') {
      args.config = requireValue(tokens, ++i, token);
      continue;
    }
    if (token.startsWith('--config=')) {
      args.config = token.slice('--config='.length);
      continue;
    }
    if (token === '--profile' || token === '-p') {
      args.profile = requireValue(tokens, ++i, token);
      continue;
    }
    if (token.startsWith('--profile=')) {
      args.profile = token.slice('--profile='.length);
      continue;
    }
    if (token === '--env') {
      const [name, value] = parseEnvAssignment(requireValue(tokens, ++i, token));
      args.env[name] = value;
      continue;
    }
    if (token.startsWith('--env=')) {
      const [name, value] = parseEnvAssignment(token.slice('--env='.length));
      args.env[name] = value;
      continue;
    }
    if (token === '--out' || token === '-o') {
      args.outDir = requireValue(tokens, ++i, token);
      args.outDirExplicit = true;
      continue;
    }
    if (token.startsWith('--out=')) {
      args.outDir = token.slice('--out='.length);
      args.outDirExplicit = true;
      continue;
    }
    if (token === '--root' || token === '-r') {
      args.root = requireValue(tokens, ++i, token);
      continue;
    }
    if (token.startsWith('--root=')) {
      args.root = token.slice('--root='.length);
      continue;
    }
    if (!token.startsWith('-')) {
      if (args.command === 'explain') {
        if (!args.diagnosticsFile) {
          args.diagnosticsFile = token;
          continue;
        }
        throw new Error(`Unexpected explain argument: ${token}`);
      }
      if (args.command === 'artifacts') {
        if (!args.artifactsAction || args.artifactsAction === 'list') {
          args.artifactsAction = token;
          continue;
        }
        throw new Error(`Unexpected artifacts argument: ${token}`);
      }
      if (!args.entry) {
        args.entry = token;
        continue;
      }
    }
    throw new Error(`Unexpected argument: ${token}`);
  }

  if (args.command === 'artifacts' && !args.artifactsAction) args.artifactsAction = 'list';
  if (args.command === 'artifacts' && args.artifactsAction !== 'list') {
    throw new Error(`Unsupported artifacts action "${args.artifactsAction}". Expected "list".`);
  }
  if (args.outputFormat !== 'text' && args.outputFormat !== 'json') {
    throw new Error(`Unsupported --format value "${args.outputFormat}". Expected text or json.`);
  }

  return applyCliIntent(args);
}

function usage() {
  return `PulseWasm CLI

Usage:
  pulsewasm plan <entry.js|entry.ts> [--root app] [--out .pulsewasm] [--features assets,route-context,route-effects,handler-io] [--target wasm] [--provider none|node|fastly]
  pulsewasm plan --config pulse.config.ts [--profile edge] [--env NAME=value] [--out .pulsewasm] [--features assets,route-context,route-effects,handler-io]
  pulsewasm build <entry.js|entry.ts> [--root app] [--out .pulsewasm] [--target js|wasm|wasm-smoke] [--provider none|node|fastly] [--features assets,schema,route-context,route-effects,handler-io]
  pulsewasm build --config pulse.config.ts [--profile edge] [--env NAME=value] [--out .pulsewasm] [--target js|wasm|wasm-smoke] [--provider none|node|fastly]
  pulsewasm doctor <entry.js|entry.ts> [--root app] [--out .pulsewasm] [--target wasm] [--provider none|node|fastly]
  pulsewasm doctor --config pulse.config.ts [--profile edge] [--env NAME=value] [--out .pulsewasm]
  pulsewasm explain [diagnostics.json|--diagnostics diagnostics.json] [--format text|json]
  pulsewasm artifacts list [--out .pulsewasm|--manifest build-manifest.json] [--format text|json]
  pulsewasm resolve-config --config pulse.config.ts [--profile edge] [--env NAME=value] [--out .pulsewasm]

Compatibility:
  pulsewasm-extract is still supported and accepts the same commands.
  Existing low-level --emit-* flags remain available as debug/test escapes.
  Backward-compatible build aliases still work:
    pulsewasm-extract <entry.js|entry.ts> [--root app] [--out artifacts] [--ast]
    pulsewasm-extract --config pulse.config.ts --config-only [--profile edge] [--env NAME=value]

Intent presets:
  plan    emits route metadata plus package/lifecycle plans, including ctx.resolve route-effect plans; no provider proof is emitted unless requested explicitly.
  build   preserves the existing build gatekeeper and can add --target/--provider/--features presets.
  doctor  runs the plan-oriented checks and writes cli-doctor.json with user-actionable status.
  explain groups diagnostics by severity/code for humans or JSON tools.
  artifacts list prints artifact producer ownership and why each artifact exists.

Preset options:
  --target js           emit TypeScript dispatch metadata.
  --target wasm         emit AssemblyScript/Wasm planning metadata, without forcing a Wasm smoke compile.
  --target wasm-smoke   opt into the AS/Wasm smoke compile path.
  --provider node       include provider-relevant host capability metadata without forcing Node provider proof/runtime output.
  --provider fastly     include provider-relevant host capability metadata without forcing Fastly provider proof/runtime output.
  --features route-context emit route-handler-context-lowering-plan.json for the synchronous ctx surface.
  --features route-effects emit ctx.resolve/ctx.fetch route-handler-effect-plan.json without provider execution.
  --features handler-io    emit handler-io-lifecycle-plan.json unifying ctx, request body, backend/origin, schema, and response posture.
  --features request-json  emit request-json-body-plan.json for lazy ctx.req.json/parse request body reads.
  --features schema-decode-result emit schema-decode-result-plan.json for ctx.req.json("Schema") accessor validation.
  --features schema-response-codec emit schema-response-codec-plan.json for ctx.result.json("Schema", ref) and ctx.resolved().json("Schema").
  --features node-request-json-body-proof emits the Node compiled-Wasm proof for lazy ctx.req.json body reads.
  --features node-schema-decode-result-proof emits the Node compiled-Wasm proof for schema-backed ctx.req.json("Schema") decode results.
  --features node-schema-response-codec-proof emits the Node compiled-Wasm proof for schema-backed ctx.result.json("Schema", ref).
  --features node-route-handler-effect-proof emits the Node local fixture proof that consumes route-handler-effect-plan.json.
  --features node-live-origin-route-handler-effect-proof emits a Node proof that performs real local HTTP origin GET/HEAD using configured backend baseUrl values.
  --features node-compiled-route-handler-effect-bridge emits a compiled-Wasm Node resolve/resume bridge proof over live-origin fetches.
  --features fastly-route-handler-effect-proof emits the Fastly symbolic-backend fixture proof that consumes route-handler-effect-plan.json.
  --features fastly-lifecycle-parity-proof emits the Fastly reference lifecycle parity/classification proof.
  --features assets-compiled-wasm-sidecar emit assets-compiled-wasm-sidecar-plan.json for package-owned AS sidecar readiness.
  --features node-compiled-wasm-assets-lifecycle-proof emits the Node compiled-Wasm terminal assets lifecycle proof.
  --features fastly-assets-package-out-parity-proof emits the Fastly assets package-out parity/readiness proof.
  --features LIST       add comma-separated feature presets. Known features: ${knownFeatures().join(', ')}.

Core outputs:
  build-manifest.json deterministic build manifest, artifact hashes, pass list, status
  diagnostics.json     deterministic diagnostics envelope
  route-plan.json      flattened deterministic PulseWasm route plan
  handler-table.json   resolved handler/function table with stable handler IDs
  execution-plan.json  runtime-parity ordered entry scanner metadata
  assets-lowering-plan.json optional package-owned pulse.assets validate-and-plan artifact
  assets-compiled-wasm-sidecar-plan.json optional package-owned pulse.assets AS sidecar readiness artifact
  node-compiled-wasm-assets-lifecycle-proof.json optional Pass 49 Node compiled-Wasm terminal assets lifecycle proof
  fastly-assets-package-out-parity-proof.json optional Pass 50 Fastly package-out assets parity proof
  route-handler-context-lowering-plan.json optional Pass 31 synchronous ctx lowering plan artifact
  route-handler-effect-plan.json optional ctx.resolve/ctx.fetch lifecycle plan artifact
  handler-io-lifecycle-plan.json optional Pass 36 unified handler I/O lifecycle plan artifact
  request-json-body-plan.json optional Pass 39 lazy request JSON body plan artifact
  schema-decode-result-plan.json optional Pass 40 schema-backed decode result plan artifact
  schema-response-codec-plan.json optional Pass 41 schema-backed response/origin codec plan artifact
  node-request-json-body-proof.json optional Pass 39 Node compiled-Wasm proof for ctx.req.json
  node-schema-decode-result-proof.json optional Pass 40 Node compiled-Wasm proof for ctx.req.json("Schema")
  node-schema-response-codec-proof.json optional Pass 41 Node compiled-Wasm proof for ctx.result.json("Schema", ref)
  schema-json-generic-parser.json optional generic AS JSON parser fallback artifact
  node-route-handler-effect-proof.json optional Node provider-owned proof for planned ctx.fetch effects
  node-live-origin-route-handler-effect-proof.json optional Node provider-owned live-origin HTTP proof for planned ctx.fetch effects
  node-compiled-route-handler-effect-bridge.json optional Node compiled-Wasm resolve/resume bridge proof for planned ctx.fetch effects
  fastly-route-handler-effect-proof.json optional Fastly provider-owned proof for planned ctx.fetch effects
  cli-doctor.json      optional doctor summary when using the doctor intent

Examples:
  pulsewasm plan --config ./examples/integrated.config.js --profile edge --out ./.pulsewasm
  pulsewasm build --config ./examples/integrated.config.js --profile edge --target wasm --provider node --features assets,route-effects,handler-io --out ./.pulsewasm
  pulsewasm doctor --config ./examples/integrated.config.js --profile edge --out ./.pulsewasm
  pulsewasm explain ./.pulsewasm/diagnostics.json
  pulsewasm artifacts list --out ./.pulsewasm
`;
}
function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function artifactName(outDir, filePath) {
  const rel = path.relative(outDir, filePath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : path.basename(filePath);
}

function writeJson(filePath, value, artifactRecords, outDir = path.dirname(filePath)) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = jsonText(value);
  fs.writeFileSync(filePath, text, 'utf8');
  if (artifactRecords) {
    artifactRecords.push(makeArtifactRecord(artifactName(outDir, filePath), value, text));
  }
  return text;
}

function writeText(filePath, text, artifactRecords, outDir = path.dirname(filePath)) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
  if (artifactRecords) {
    artifactRecords.push(makeArtifactRecord(artifactName(outDir, filePath), undefined, text));
  }
  return text;
}

function writeDiagnostics(outDir, envelope, artifactRecords) {
  writeJson(path.join(outDir, 'diagnostics.json'), envelope, artifactRecords, outDir);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveCliInput(cwd, filePath) {
  return path.resolve(cwd, filePath);
}

const PULSE_CONFIG_CANDIDATES = ['pulse.config.js', 'pulse.config.cjs', 'pulse.config.mjs', 'pulse.config.ts', 'pulse.config.mts', 'pulse.config.cts'];

function discoverSiblingConfigForEntry(cwd, entryArg) {
  if (!entryArg) return undefined;
  const entryAbs = path.resolve(cwd, entryArg);
  const dir = path.dirname(entryAbs);
  for (const name of PULSE_CONFIG_CANDIDATES) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function resolveEntryPath(cwd, entryArg, configDir, entryCameFromConfig) {
  if (path.isAbsolute(entryArg)) return entryArg;
  if (entryCameFromConfig && configDir) {
    const configRelative = path.resolve(configDir, entryArg);
    if (fs.existsSync(configRelative)) return configRelative;
  }
  return path.resolve(cwd, entryArg);
}

function formatExplainText(explanation) {
  const lines = [];
  lines.push('PulseWasm diagnostics explanation');
  lines.push(`  source: ${explanation.source}`);
  lines.push(`  status: ${explanation.status}`);
  lines.push(`  diagnostics: ${explanation.counts?.total || 0} (${explanation.counts?.error || 0} error, ${explanation.counts?.warning || 0} warning, ${explanation.counts?.info || 0} info)`);
  if (!explanation.groups || explanation.groups.length === 0) {
    lines.push('  No diagnostics found.');
    return `${lines.join('\n')}\n`;
  }
  for (const group of explanation.groups) {
    lines.push(`\n${group.severity.toUpperCase()} ${group.code} (${group.count})`);
    for (const message of group.messages || []) {
      lines.push(`  - ${message}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function formatArtifactsText(list) {
  const lines = [];
  lines.push('PulseWasm artifacts');
  lines.push(`  manifest: ${list.source}`);
  lines.push(`  status: ${list.status}`);
  if (list.command) lines.push(`  command: ${list.command}`);
  if (list.outDir) lines.push(`  outDir: ${list.outDir}`);
  lines.push(`  artifacts: ${list.artifactCount}`);
  for (const artifact of list.artifacts || []) {
    const version = artifact.version ? ` [${artifact.version}]` : '';
    lines.push(`\n- ${artifact.file}${version}`);
    lines.push(`  producer: ${artifact.producer}`);
    lines.push(`  why: ${artifact.why}`);
    if (artifact.bytes !== undefined) lines.push(`  bytes: ${artifact.bytes}`);
  }
  return `${lines.join('\n')}\n`;
}

function writeDoctor(outDir, args, diagnostics, result, resolvedConfig, artifactRecords) {
  const doctor = createDoctorArtifact({ args, diagnostics, result, resolvedConfig });
  writeJson(path.join(outDir, 'cli-doctor.json'), doctor, artifactRecords, outDir);
  return doctor;
}

function withConfigPass(diagnostics, resolvedConfig, cwd) {
  if (!resolvedConfig) return diagnostics;
  const pass = {
    name: 'config-resolve',
    status: 'ok',
    summary: {
      profile: resolvedConfig.profile || resolvedConfig.selectedProfile,
      entry: resolvedConfig.entry,
      rootRouter: resolvedConfig.rootRouter,
      engine: resolvedConfig.runtime?.engine || resolvedConfig.target
    }
  };
  return createDiagnosticsEnvelope({
    source: diagnostics?.source,
    status: diagnostics?.status || 'ok',
    diagnostics: diagnostics?.diagnostics || [],
    passes: [pass].concat(diagnostics?.passes || []),
    summary: {
      config: {
        profile: resolvedConfig.profile || resolvedConfig.selectedProfile,
        source: resolvedConfig.artifact?.source
      },
      extraction: diagnostics?.summary
    },
    cwd
  });
}

function writeBuildManifest(outDir, options, artifactRecords) {
  const refreshed = [];
  const byFile = new Map();
  for (const record of artifactRecords || []) byFile.set(record.file, record);
  for (const [file, record] of byFile) {
    const absolute = path.join(outDir, file);
    if (!fs.existsSync(absolute)) continue;
    normalizeArtifactFile(absolute);
    const buffer = fs.readFileSync(absolute);
    const next = makeArtifactRecord(file, undefined, buffer);
    if (record.version !== undefined) next.version = record.version;
    refreshed.push(next);
  }
  const manifest = createBuildManifest({ ...options, artifactRecords: refreshed });
  writeJson(path.join(outDir, 'build-manifest.json'), manifest);
  return manifest;
}

async function runCli(argv, io = {}) {
  const cwd = io.cwd || process.cwd();
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const providerProofs = io.providerProofs && typeof io.providerProofs === 'object'
    ? io.providerProofs
    : Object.freeze({});
  function providerProof(name) {
    const proof = providerProofs[name];
    if (typeof proof !== 'function') {
      throw new TypeError(`Pulse legacy provider proof ${name} requires an explicit CLI/testing composition root.`);
    }
    return proof;
  }
  function exitIfRequested() {
    if (io.exitOnComplete) process.exit(process.exitCode || 0);
  }
  const defaultOutDir = io.defaultOutDir || getDefaultArtifactsDir(cwd);
  let args = { command: 'build', outDir: defaultOutDir, strict: true, configOnly: false, includeAst: false, emitDispatchTs: false, emitHandlerBindings: false, emitExecutionHarness: false, emitAssemblyScriptShape: false, emitAssemblyScriptCore: false, emitAssemblyScriptCompile: false, emitWasmSmoke: false, emitLocalHarness: false, emitWasmHostAbi: false, emitWasmHostBridge: false, emitRequestResultHeaders: false, emitChannelBroadcaster: false, emitJsonBody: false, emitBackendCapabilities: false, emitHostRuntimeKernel: false, emitNodeAdapter: false, emitHandlerLibraryContracts: false, emitAssetsLoweringPlan: false, emitNodeAssetsProviderProof: false, emitFastlyAssetsProviderProof: false, emitFastlyAssetsPackageOutParityProof: false, emitRouteHandlerEffectPlan: false, emitNodeLiveOriginRouteHandlerEffectProof: false, emitNodeCompiledRouteHandlerEffectBridge: false, emitRouteHandlerContextLoweringPlan: false,
    emitHandlerIoLifecyclePlan: false, emitHostCapabilities: false, emitEffectRuntime: false, emitEffectComposition: false, emitCompiledHandlers: false, emitSchemaJsonCompile: false, emitSchemaJsonSidecar: false, emitSchemaJsonGenericParser: false, emitLibrarySidecars: false, emitStreamingPassthrough: false, emitIntegratedCompiledApp: false, emitCompiledWasmRuntime: false, emitPulseWrapper: false, emitFastlyReadiness: false, emitFastlyHostcallBinding: false, emitFastlyAdapter: false, emitFastlyCommandEntry: false };

  try {
    args = parseArgs(argv, { defaultOutDir });
  } catch (error) {
    const outDir = path.resolve(cwd, args.outDir || defaultOutDir);
    const artifactRecords = [];
    const diagnostics = createDiagnosticsEnvelope({
      source: '<cli>',
      status: 'error',
      diagnostics: [{
        phase: 'cli',
        code: 'PULSEWASM_CLI_INVALID_ARGUMENTS',
        message: error && error.message ? error.message : String(error),
        severity: 'error',
        loc: { file: '<cli>' }
      }],
      passes: [],
      summary: { strict: true },
      cwd
    });
    try {
      writeDiagnostics(outDir, diagnostics, artifactRecords);
      writeBuildManifest(outDir, { cwd, outDir, args, status: 'error', diagnostics }, artifactRecords);
    } catch (_) {
      // stderr remains the fallback when artifacts cannot be written.
    }
    stderr.write(`PulseWasm build failed.\n${formatDiagnostics(diagnostics.diagnostics)}\n`);
    stderr.write(`  diagnostics:     ${path.join(outDir, 'diagnostics.json')}\n`);
    stderr.write(`  build manifest:  ${path.join(outDir, 'build-manifest.json')}\n`);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    stdout.write(usage());
    exitIfRequested();
    return;
  }

  if (args.command === 'explain') {
    const diagnosticsFile = resolveCliInput(cwd, args.diagnosticsFile || path.join(args.outDir, 'diagnostics.json'));
    const envelope = readJsonFile(diagnosticsFile);
    const explanation = createExplainArtifact(envelope, diagnosticsFile);
    stdout.write(args.outputFormat === 'json' ? jsonText(explanation) : formatExplainText(explanation));
    exitIfRequested();
    return;
  }

  if (args.command === 'artifacts') {
    const manifestFile = resolveCliInput(cwd, args.manifestFile || path.join(args.outDir, 'build-manifest.json'));
    const manifest = readJsonFile(manifestFile);
    const list = createArtifactsList(manifest, manifestFile);
    stdout.write(args.outputFormat === 'json' ? jsonText(list) : formatArtifactsText(list));
    exitIfRequested();
    return;
  }

  let outDir = path.resolve(cwd, args.outDir);
  const artifactRecords = [];
  let resolvedConfig;
  let entry;
  let root;

  try {
    if (args.noStrictRequested) {
      throw new ExtractionError({
        phase: 'cli',
        code: 'PULSEWASM_NO_STRICT_UNSUPPORTED',
        message: '--no-strict is not supported in PulseWasm Phase 7. The gatekeeper is strict by default.',
        hint: 'Remove --no-strict. Future non-strict/advisory modes must be defined explicitly before use.',
        loc: { file: '<cli>' }
      });
    }
    let configFileAbs;
    let configDir;
    if (!args.config && args.entry) {
      const discovered = discoverSiblingConfigForEntry(cwd, args.entry);
      if (discovered) {
        args.config = path.relative(cwd, discovered).replace(/\\/g, '/');
        args.configDiscoveredFromEntry = true;
      }
    }
    if (args.config) {
      configFileAbs = path.resolve(cwd, args.config);
      configDir = path.dirname(configFileAbs);
      resolvedConfig = resolveConfigFromFile(configFileAbs, {
        cwd,
        profile: args.profile,
        env: {
          ...(process.env || {}),
          ...(io.env || {}),
          ...args.env
        }
      });
      if (!args.outDirExplicit && resolvedConfig.outDir) {
        outDir = path.resolve(configDir, resolvedConfig.outDir);
      }
      writeJson(path.join(outDir, 'resolved-config.json'), resolvedConfig.artifact, artifactRecords);
    }

    if (args.configOnly) {
      if (!args.config) {
        throw new ExtractionError({
          phase: 'cli',
          code: 'PULSEWASM_CONFIG_ONLY_REQUIRES_CONFIG',
          message: '--config-only or resolve-config requires --config <pulse.config.ts>.',
          hint: 'Pass a Pulse config file to resolve.',
          loc: { file: '<cli>' }
        });
      }
      const diagnostics = createDiagnosticsEnvelope({
        source: args.config ? path.resolve(cwd, args.config) : '<cli>',
        status: 'ok',
        diagnostics: [],
        passes: [{ name: 'config-resolve', status: 'ok', summary: { profile: resolvedConfig?.profile || resolvedConfig?.selectedProfile } }],
        summary: { configOnly: true, profile: resolvedConfig?.profile || resolvedConfig?.selectedProfile, strict: args.strict },
        cwd
      });
      writeDiagnostics(outDir, diagnostics, artifactRecords);
      writeBuildManifest(outDir, {
        cwd,
        outDir,
        args,
        status: 'ok',
        resolvedConfig,
        diagnostics,
        entry: resolvedConfig?.entry,
        rootRouter: resolvedConfig?.rootRouter
      }, artifactRecords);
      stdout.write(`PulseWasm config resolved.\n`);
      stdout.write(`  resolved config: ${path.join(outDir, 'resolved-config.json')}\n`);
      stdout.write(`  diagnostics:     ${path.join(outDir, 'diagnostics.json')}\n`);
      stdout.write(`  build manifest:  ${path.join(outDir, 'build-manifest.json')}\n`);
      exitIfRequested();
      return;
    }

    const entryFromConfig = resolvedConfig?.entry;
    const rootFromConfig = resolvedConfig?.rootRouter;
    const entryArg = args.entry || entryFromConfig;
    if (!entryArg) {
      throw new ExtractionError({
        phase: 'cli',
        code: 'PULSEWASM_ENTRY_REQUIRED',
        message: 'PulseWasm build requires an entry file.',
        hint: 'Pass an entry file as a positional argument or define config.entry as a static string.',
        loc: { file: '<cli>' }
      });
    }

    entry = resolveEntryPath(cwd, entryArg, configDir, !args.entry && Boolean(entryFromConfig));
    root = args.root || rootFromConfig;

    const result = extractFromFile(entry, {
      cwd,
      root,
      includeAst: args.includeAst,
      emitDispatchTs: args.emitDispatchTs,
      emitHandlerBindings: args.emitHandlerBindings,
      emitExecutionHarness: args.emitExecutionHarness,
      emitAssemblyScriptShape: args.emitAssemblyScriptShape,
      emitAssemblyScriptCore: args.emitAssemblyScriptCore,
      emitAssemblyScriptCompile: args.emitAssemblyScriptCompile,
      emitWasmSmoke: args.emitWasmSmoke,
      emitLocalHarness: args.emitLocalHarness,
      emitWasmHostAbi: args.emitWasmHostAbi,
      emitWasmHostBridge: args.emitWasmHostBridge,
      emitRequestResultHeaders: args.emitRequestResultHeaders,
      emitChannelBroadcaster: args.emitChannelBroadcaster,
      emitJsonBody: args.emitJsonBody,
      emitBackendCapabilities: args.emitBackendCapabilities,
      emitHostRuntimeKernel: args.emitHostRuntimeKernel,
      emitNodeAdapter: args.emitNodeAdapter,
      emitHandlerLibraryContracts: args.emitHandlerLibraryContracts,
      emitAssetsLoweringPlan: args.emitAssetsLoweringPlan,
      emitAssetsCompiledWasmSidecarPlan: args.emitAssetsCompiledWasmSidecarPlan,
      emitAssetsSidecarCompileLinkProof: args.emitAssetsSidecarCompileLinkProof,
      emitNodeAssetsProviderProof: args.emitNodeAssetsProviderProof,
      emitNodeCompiledWasmAssetsLifecycleProof: args.emitNodeCompiledWasmAssetsLifecycleProof,
      emitFastlyAssetsProviderProof: args.emitFastlyAssetsProviderProof,
      emitFastlyAssetsPackageOutParityProof: args.emitFastlyAssetsPackageOutParityProof,
      emitNodeRouteHandlerEffectProof: args.emitNodeRouteHandlerEffectProof,
      emitFastlyRouteHandlerEffectProof: args.emitFastlyRouteHandlerEffectProof,
      emitFastlyLifecycleParityProof: args.emitFastlyLifecycleParityProof,
      emitRouteHandlerEffectPlan: args.emitRouteHandlerEffectPlan,
      emitRouteHandlerContextLoweringPlan: args.emitRouteHandlerContextLoweringPlan,
      emitHandlerIoLifecyclePlan: args.emitHandlerIoLifecyclePlan,
      emitRequestJsonBodyPlan: args.emitRequestJsonBodyPlan,
      emitSchemaDecodeResultPlan: args.emitSchemaDecodeResultPlan,
      emitSchemaResponseCodecPlan: args.emitSchemaResponseCodecPlan,
      emitBackendJsonRequestBodyPlan: args.emitBackendJsonRequestBodyPlan,
      emitNodeBackendJsonRequestBodyProof: args.emitNodeBackendJsonRequestBodyProof,
      emitNodeRequestJsonBodyProof: args.emitNodeRequestJsonBodyProof,
      emitNodeSchemaDecodeResultProof: args.emitNodeSchemaDecodeResultProof,
      emitNodeSchemaResponseCodecProof: args.emitNodeSchemaResponseCodecProof,
      emitHostCapabilities: args.emitHostCapabilities,
      emitEffectRuntime: args.emitEffectRuntime,
      emitEffectComposition: args.emitEffectComposition,
      emitCompiledHandlers: args.emitCompiledHandlers,
      emitSchemaJsonCompile: args.emitSchemaJsonCompile,
      emitSchemaJsonSidecar: args.emitSchemaJsonSidecar,
      emitSchemaJsonGenericParser: args.emitSchemaJsonGenericParser,
      emitLibrarySidecars: args.emitLibrarySidecars,
      emitStreamingPassthrough: args.emitStreamingPassthrough,
      emitIntegratedCompiledApp: args.emitIntegratedCompiledApp,
      emitCompiledWasmRuntime: args.emitCompiledWasmRuntime,
      emitPulseWrapper: args.emitPulseWrapper,
      emitFastlyReadiness: args.emitFastlyReadiness,
      emitFastlyHostcallBinding: args.emitFastlyHostcallBinding,
      emitFastlyAdapter: args.emitFastlyAdapter,
      emitFastlyCommandEntry: args.emitFastlyCommandEntry,
      resolvedConfig: resolvedConfig?.artifact,
      configRoot: configDir || path.dirname(entry),
      outDir,
      providerProofs
    });

    const diagnostics = withConfigPass(result.diagnostics, resolvedConfig, cwd);

    if (args.emitNodeLiveOriginRouteHandlerEffectProof) {
      const liveProof = await providerProof('buildNodeLiveOriginRouteHandlerEffectProof')({
        cwd,
        generatedBy: result.summary && result.summary.generatedBy,
        routeHandlerEffectPlan: result.routeHandlerEffectPlan,
        resolvedConfig: resolvedConfig?.artifact,
        mode: 'cli-live-origin-http'
      });
      const liveProofErrors = liveProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
      if (liveProofErrors.length > 0) {
        throw new ExtractionError(liveProofErrors, {
          passes: [...(diagnostics.passes || []), { name: 'node-live-origin-route-handler-effect-proof', status: 'error', summary: liveProof.artifact.summary }],
          source: entry,
          summary: result.summary
        });
      }
      result.nodeLiveOriginRouteHandlerEffectProof = liveProof;
      diagnostics.passes = [...(diagnostics.passes || []), { name: 'node-live-origin-route-handler-effect-proof', status: 'ok', summary: liveProof.artifact.summary }];
    }

    if (args.emitNodeCompiledRouteHandlerEffectBridge) {
      const compiledBridge = await providerProof('buildNodeCompiledRouteHandlerEffectBridge')({
        cwd,
        outDir,
        generatedBy: result.summary && result.summary.generatedBy,
        routeHandlerEffectPlan: result.routeHandlerEffectPlan,
        compiledHandlers: result.compiledHandlers,
        resolvedConfig: resolvedConfig?.artifact,
        mode: 'cli-compiled-wasm-live-origin-bridge'
      });
      const compiledBridgeErrors = compiledBridge.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
      if (compiledBridgeErrors.length > 0) {
        throw new ExtractionError(compiledBridgeErrors, {
          passes: [...(diagnostics.passes || []), { name: 'node-compiled-route-handler-effect-bridge', status: 'error', summary: compiledBridge.artifact.summary }],
          source: entry,
          summary: result.summary
        });
      }
      result.nodeCompiledRouteHandlerEffectBridge = compiledBridge;
      diagnostics.passes = [...(diagnostics.passes || []), { name: 'node-compiled-route-handler-effect-bridge', status: 'ok', summary: compiledBridge.artifact.summary }];
    }

    if (args.emitNodeBackendJsonRequestBodyProof) {
      const backendJsonProof = await providerProof('buildNodeBackendJsonRequestBodyProof')({
        cwd,
        generatedBy: result.summary && result.summary.generatedBy,
        routeHandlerEffectPlan: result.routeHandlerEffectPlan,
        backendJsonRequestBodyPlan: result.backendJsonRequestBodyPlan,
        requestJsonBodyPlan: result.requestJsonBodyPlan,
        resolvedConfig: resolvedConfig?.artifact,
        mode: 'cli-node-backend-json-request-body-proof'
      });
      const backendJsonProofErrors = backendJsonProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
      if (backendJsonProofErrors.length > 0) {
        throw new ExtractionError(backendJsonProofErrors, {
          passes: [...(diagnostics.passes || []), { name: 'node-backend-json-request-body-proof', status: 'error', summary: backendJsonProof.artifact.summary }],
          source: entry,
          summary: result.summary
        });
      }
      result.nodeBackendJsonRequestBodyProof = backendJsonProof;
      diagnostics.passes = [...(diagnostics.passes || []), { name: 'node-backend-json-request-body-proof', status: 'ok', summary: backendJsonProof.artifact.summary }];
    }

    writeJson(path.join(outDir, 'symbol-index.json'), result.symbolIndex, artifactRecords);
    writeJson(path.join(outDir, 'handler-table.json'), result.handlerTable, artifactRecords);
    writeJson(path.join(outDir, 'handler-eval.json'), result.handlerEval, artifactRecords);
    writeJson(path.join(outDir, 'path-table.json'), result.pathTable, artifactRecords);
    writeJson(path.join(outDir, 'dispatch-table.json'), result.dispatchTable, artifactRecords);
    writeJson(path.join(outDir, 'execution-plan.json'), result.executionPlan, artifactRecords);
    if (result.handlerBindings) {
      writeJson(path.join(outDir, 'handler-bindings.json'), result.handlerBindings.artifact, artifactRecords);
    }
    if (result.executionHarness) {
      writeJson(path.join(outDir, 'execution-harness.json'), result.executionHarness.artifact, artifactRecords);
    }
    if (result.localHarness) {
      writeJson(path.join(outDir, 'local-harness.json'), result.localHarness.artifact, artifactRecords);
    }
    if (result.assemblyScriptShape) {
      writeJson(path.join(outDir, 'assemblyscript-shape.json'), result.assemblyScriptShape.artifact, artifactRecords);
      writeJson(path.join(outDir, 'generated/as/manifest.json'), result.assemblyScriptShape.manifest, artifactRecords, outDir);
      for (const file of result.assemblyScriptShape.files) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.assemblyScriptCore) {
      writeJson(path.join(outDir, 'assemblyscript-core.json'), result.assemblyScriptCore.artifact, artifactRecords);
      if (result.assemblyScriptCore.handlersArtifact) {
        writeJson(path.join(outDir, 'assemblyscript-handlers.json'), result.assemblyScriptCore.handlersArtifact, artifactRecords);
      }
      for (const file of result.assemblyScriptCore.files) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.assemblyScriptCompile) {
      writeJson(path.join(outDir, 'assemblyscript-compile.json'), result.assemblyScriptCompile.artifact, artifactRecords);
      for (const output of result.assemblyScriptCompile.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.assemblyScriptWasmSmoke) {
      writeJson(path.join(outDir, 'assemblyscript-wasm-smoke.json'), result.assemblyScriptWasmSmoke.artifact, artifactRecords);
      for (const file of result.assemblyScriptWasmSmoke.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
      for (const output of result.assemblyScriptWasmSmoke.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.wasmHostAbi) {
      writeJson(path.join(outDir, 'wasm-host-abi.json'), result.wasmHostAbi.artifact, artifactRecords);
      for (const file of result.wasmHostAbi.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.wasmHostBridge) {
      writeJson(path.join(outDir, 'wasm-host-bridge.json'), result.wasmHostBridge.artifact, artifactRecords);
      for (const file of result.wasmHostBridge.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
      for (const output of result.wasmHostBridge.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.requestResultHeaders) {
      writeJson(path.join(outDir, 'request-result-headers.json'), result.requestResultHeaders.artifact, artifactRecords);
      for (const file of result.requestResultHeaders.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.channelBroadcaster) {
      writeJson(path.join(outDir, 'channel-broadcaster.json'), result.channelBroadcaster.artifact, artifactRecords);
      for (const file of result.channelBroadcaster.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.jsonBody) {
      writeJson(path.join(outDir, 'json-body.json'), result.jsonBody.artifact, artifactRecords);
      for (const file of result.jsonBody.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.backendCapabilities) {
      writeJson(path.join(outDir, 'backend-capabilities.json'), result.backendCapabilities.artifact, artifactRecords);
      for (const file of result.backendCapabilities.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.hostRuntimeKernel) {
      writeJson(path.join(outDir, 'host-runtime-kernel.json'), result.hostRuntimeKernel.artifact, artifactRecords);
      for (const file of result.hostRuntimeKernel.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.nodeAdapter) {
      writeJson(path.join(outDir, 'node-adapter.json'), result.nodeAdapter.artifact, artifactRecords);
      for (const file of result.nodeAdapter.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.handlerLibraryContracts) {
      writeJson(path.join(outDir, 'handler-library-contracts.json'), result.handlerLibraryContracts.artifact, artifactRecords);
      writeJson(path.join(outDir, 'handler-execution-modes.json'), result.handlerLibraryContracts.handlerExecutionModes, artifactRecords);
      writeJson(path.join(outDir, 'library-contract-schema.json'), result.handlerLibraryContracts.libraryContractSchema, artifactRecords);
      writeJson(path.join(outDir, 'library-capabilities.json'), result.handlerLibraryContracts.libraryCapabilities, artifactRecords);
      writeJson(path.join(outDir, 'library-compatibility-report.json'), result.handlerLibraryContracts.libraryCompatibilityReport, artifactRecords);
      for (const file of result.handlerLibraryContracts.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.assetsLoweringPlan) {
      writeJson(path.join(outDir, 'assets-lowering-plan.json'), result.assetsLoweringPlan.artifact, artifactRecords);
    }
    if (result.assetsCompiledWasmSidecarPlan) {
      writeJson(path.join(outDir, 'assets-compiled-wasm-sidecar-plan.json'), result.assetsCompiledWasmSidecarPlan.artifact, artifactRecords);
    }
    if (result.assetsSidecarCompileLinkProof) {
      writeJson(path.join(outDir, 'assets-sidecar-compile-link-proof.json'), result.assetsSidecarCompileLinkProof.artifact, artifactRecords);
    }
    if (result.nodeAssetsProviderProof) {
      writeJson(path.join(outDir, 'node-assets-provider-proof.json'), result.nodeAssetsProviderProof.artifact, artifactRecords);
    }
    if (result.nodeCompiledWasmAssetsLifecycleProof) {
      writeJson(path.join(outDir, 'node-compiled-wasm-assets-lifecycle-proof.json'), result.nodeCompiledWasmAssetsLifecycleProof.artifact, artifactRecords);
    }
    if (result.fastlyAssetsProviderProof) {
      writeJson(path.join(outDir, 'fastly-assets-provider-proof.json'), result.fastlyAssetsProviderProof.artifact, artifactRecords);
    }
    if (result.fastlyAssetsPackageOutParityProof) {
      writeJson(path.join(outDir, 'fastly-assets-package-out-parity-proof.json'), result.fastlyAssetsPackageOutParityProof.artifact, artifactRecords);
    }
    if (result.routeHandlerEffectPlan) {
      writeJson(path.join(outDir, 'route-handler-effect-plan.json'), result.routeHandlerEffectPlan.artifact, artifactRecords);
    }
    if (result.nodeRouteHandlerEffectProof) {
      writeJson(path.join(outDir, 'node-route-handler-effect-proof.json'), result.nodeRouteHandlerEffectProof.artifact, artifactRecords);
    }
    if (result.nodeLiveOriginRouteHandlerEffectProof) {
      writeJson(path.join(outDir, 'node-live-origin-route-handler-effect-proof.json'), result.nodeLiveOriginRouteHandlerEffectProof.artifact, artifactRecords);
    }
    if (result.nodeCompiledRouteHandlerEffectBridge) {
      writeJson(path.join(outDir, 'node-compiled-route-handler-effect-bridge.json'), result.nodeCompiledRouteHandlerEffectBridge.artifact, artifactRecords);
      for (const file of result.nodeCompiledRouteHandlerEffectBridge.files || []) writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      for (const output of result.nodeCompiledRouteHandlerEffectBridge.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.fastlyRouteHandlerEffectProof) {
      writeJson(path.join(outDir, 'fastly-route-handler-effect-proof.json'), result.fastlyRouteHandlerEffectProof.artifact, artifactRecords);
    }
    if (result.fastlyLifecycleParityProof) {
      writeJson(path.join(outDir, 'fastly-lifecycle-parity-proof.json'), result.fastlyLifecycleParityProof.artifact, artifactRecords);
    }
    if (result.routeHandlerContextLoweringPlan) {
      writeJson(path.join(outDir, 'route-handler-context-lowering-plan.json'), result.routeHandlerContextLoweringPlan.artifact, artifactRecords);
    }
    if (result.handlerIoLifecyclePlan) {
      writeJson(path.join(outDir, 'handler-io-lifecycle-plan.json'), result.handlerIoLifecyclePlan.artifact, artifactRecords);
    }
    if (result.requestJsonBodyPlan) {
      writeJson(path.join(outDir, 'request-json-body-plan.json'), result.requestJsonBodyPlan.artifact, artifactRecords);
    }
    if (result.schemaDecodeResultPlan) {
      writeJson(path.join(outDir, 'schema-decode-result-plan.json'), result.schemaDecodeResultPlan.artifact, artifactRecords);
    }
    if (result.schemaResponseCodecPlan) {
      writeJson(path.join(outDir, 'schema-response-codec-plan.json'), result.schemaResponseCodecPlan.artifact, artifactRecords);
    }
    if (result.backendJsonRequestBodyPlan) {
      writeJson(path.join(outDir, 'backend-json-request-body-plan.json'), result.backendJsonRequestBodyPlan.artifact, artifactRecords);
    }
    if (result.nodeBackendJsonRequestBodyProof) {
      writeJson(path.join(outDir, 'node-backend-json-request-body-proof.json'), result.nodeBackendJsonRequestBodyProof.artifact, artifactRecords);
    }
    if (result.nodeRequestJsonBodyProof) {
      writeJson(path.join(outDir, 'node-request-json-body-proof.json'), result.nodeRequestJsonBodyProof.artifact, artifactRecords);
      for (const file of result.nodeRequestJsonBodyProof.files || []) writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      for (const output of result.nodeRequestJsonBodyProof.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.nodeSchemaDecodeResultProof) {
      writeJson(path.join(outDir, 'node-schema-decode-result-proof.json'), result.nodeSchemaDecodeResultProof.artifact, artifactRecords);
      for (const file of result.nodeSchemaDecodeResultProof.files || []) writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      for (const output of result.nodeSchemaDecodeResultProof.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.nodeSchemaResponseCodecProof) {
      writeJson(path.join(outDir, 'node-schema-response-codec-proof.json'), result.nodeSchemaResponseCodecProof.artifact, artifactRecords);
      for (const file of result.nodeSchemaResponseCodecProof.files || []) writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      for (const output of result.nodeSchemaResponseCodecProof.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.hostCapabilities) {
      writeJson(path.join(outDir, 'host-capabilities.json'), result.hostCapabilities.artifact, artifactRecords);
      writeJson(path.join(outDir, 'host-capability-contract.json'), result.hostCapabilities.hostCapabilityContract, artifactRecords);
      writeJson(path.join(outDir, 'wasi-provider-map.json'), result.hostCapabilities.wasiProviderMap, artifactRecords);
      writeJson(path.join(outDir, 'capability-provider-report.json'), result.hostCapabilities.capabilityProviderReport, artifactRecords);
      for (const file of result.hostCapabilities.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.effectRuntime) {
      writeJson(path.join(outDir, 'effect-runtime.json'), result.effectRuntime.artifact, artifactRecords);
      writeJson(path.join(outDir, 'effect-runtime-contract.json'), result.effectRuntime.effectRuntimeContract, artifactRecords);
      writeJson(path.join(outDir, 'effect-kind-registry.json'), result.effectRuntime.effectKindRegistry, artifactRecords);
      writeJson(path.join(outDir, 'effect-resume-protocol.json'), result.effectRuntime.effectResumeProtocol, artifactRecords);
      writeJson(path.join(outDir, 'effect-timeout-policy.json'), result.effectRuntime.effectTimeoutPolicy, artifactRecords);
      for (const file of result.effectRuntime.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.effectComposition) {
      writeJson(path.join(outDir, 'effect-composition.json'), result.effectComposition.artifact, artifactRecords);
      writeJson(path.join(outDir, 'effect-plan-contract.json'), result.effectComposition.effectPlanContract, artifactRecords);
      writeJson(path.join(outDir, 'effect-continuation-contract.json'), result.effectComposition.effectContinuationContract, artifactRecords);
      writeJson(path.join(outDir, 'timeout-scope-policy.json'), result.effectComposition.timeoutScopePolicy, artifactRecords);
      for (const file of result.effectComposition.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.schemaJsonCompile) {
      writeJson(path.join(outDir, 'schema-json-compile.json'), result.schemaJsonCompile.artifact, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-compile-smoke.json'), result.schemaJsonCompile.smoke, artifactRecords);
      for (const file of result.schemaJsonCompile.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.schemaJsonGenericParser) {
      writeJson(path.join(outDir, 'schema-json-generic-parser.json'), result.schemaJsonGenericParser.artifact, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-generic-parser-plan.json'), result.schemaJsonGenericParser.plan, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-generic-parser-abi.json'), result.schemaJsonGenericParser.sidecarAbi, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-generic-parser-smoke.json'), result.schemaJsonGenericParser.smoke, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-parser-report.json'), result.schemaJsonGenericParser.report, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-registry.json'), result.schemaJsonGenericParser.registry, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-sidecar-abi.json'), result.schemaJsonGenericParser.sidecarAbi, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-body-policy.json'), result.schemaJsonGenericParser.bodyPolicy, artifactRecords);
      for (const file of result.schemaJsonGenericParser.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
      for (const output of result.schemaJsonGenericParser.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.schemaJsonSidecar) {
      writeJson(path.join(outDir, 'schema-json-sidecar.json'), result.schemaJsonSidecar.artifact, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-plan.json'), result.schemaJsonSidecar.plan, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-parser-report.json'), result.schemaJsonSidecar.report, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-registry.json'), result.schemaJsonSidecar.registry, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-sidecar-abi.json'), result.schemaJsonSidecar.sidecarAbi, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-body-policy.json'), result.schemaJsonSidecar.bodyPolicy, artifactRecords);
      writeJson(path.join(outDir, 'schema-json-smoke.json'), result.schemaJsonSidecar.smoke, artifactRecords);
      for (const file of result.schemaJsonSidecar.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
      for (const output of result.schemaJsonSidecar.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.librarySidecars) {
      writeJson(path.join(outDir, 'library-sidecar-consumption.json'), result.librarySidecars.artifact, artifactRecords);
      writeJson(path.join(outDir, 'api-surface.json'), result.librarySidecars.apiSurface, artifactRecords);
      writeJson(path.join(outDir, 'ctx-extension-scope-map.json'), result.librarySidecars.ctxExtensionScopeMap, artifactRecords);
      writeJson(path.join(outDir, 'lifecycle-ordering.json'), result.librarySidecars.lifecycleOrdering, artifactRecords);
      writeJson(path.join(outDir, 'library-sidecar-smoke.json'), result.librarySidecars.smoke, artifactRecords);
      for (const file of result.librarySidecars.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
      for (const output of result.librarySidecars.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.streamingPassthrough) {
      writeJson(path.join(outDir, 'streaming-passthrough.json'), result.streamingPassthrough.artifact, artifactRecords);
      writeJson(path.join(outDir, 'stream-result-abi.json'), result.streamingPassthrough.streamResultAbi, artifactRecords);
      writeJson(path.join(outDir, 'response-passthrough-policy.json'), result.streamingPassthrough.responsePassthroughPolicy, artifactRecords);
      writeJson(path.join(outDir, 'streaming-passthrough-smoke.json'), result.streamingPassthrough.smoke, artifactRecords);
      for (const file of result.streamingPassthrough.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.integratedCompiledApp) {
      writeJson(path.join(outDir, 'integrated-compiled-app.json'), result.integratedCompiledApp.artifact, artifactRecords);
      writeJson(path.join(outDir, 'integrated-link-report.json'), result.integratedCompiledApp.linkReport, artifactRecords);
      writeJson(path.join(outDir, 'integrated-compiled-app-smoke.json'), result.integratedCompiledApp.smoke, artifactRecords);
      for (const file of result.integratedCompiledApp.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
      for (const output of result.integratedCompiledApp.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.compiledWasmRuntime) {
      writeJson(path.join(outDir, 'compiled-wasm-runtime.json'), result.compiledWasmRuntime.artifact, artifactRecords);
      writeJson(path.join(outDir, 'compiled-wasm-host-runtime.json'), result.compiledWasmRuntime.hostRuntime, artifactRecords);
      writeJson(path.join(outDir, 'compiled-wasm-node-adapter.json'), result.compiledWasmRuntime.nodeAdapter, artifactRecords);
      writeJson(path.join(outDir, 'compiled-wasm-runtime-smoke.json'), result.compiledWasmRuntime.smoke, artifactRecords);
      for (const file of result.compiledWasmRuntime.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
      for (const output of result.compiledWasmRuntime.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.pulseWrapper) {
      writeJson(path.join(outDir, 'wrapper-integration.json'), result.pulseWrapper.artifact, artifactRecords);
      writeJson(path.join(outDir, 'pulse-build-output.json'), result.pulseWrapper.buildOutput, artifactRecords);
      writeJson(path.join(outDir, 'pulse-dev-runtime.json'), result.pulseWrapper.devRuntime, artifactRecords);
      for (const file of result.pulseWrapper.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.fastlyReadiness) {
      writeJson(path.join(outDir, 'fastly-readiness.json'), result.fastlyReadiness.artifact, artifactRecords);
      writeJson(path.join(outDir, 'fastly-sdk-audit.json'), result.fastlyReadiness.sdkAudit, artifactRecords);
      writeJson(path.join(outDir, 'fastly-hostcall-map.json'), result.fastlyReadiness.hostcallMap, artifactRecords);
      writeJson(path.join(outDir, 'fastly-capability-map.json'), result.fastlyReadiness.capabilityMap, artifactRecords);
      writeJson(path.join(outDir, 'fastly-packaging-plan.json'), result.fastlyReadiness.packagingPlan, artifactRecords);
      writeJson(path.join(outDir, 'fastly-risk-report.json'), result.fastlyReadiness.riskReport, artifactRecords);
      writeJson(path.join(outDir, 'fastly-adapter-plan.json'), result.fastlyReadiness.adapterPlan, artifactRecords);
      for (const file of result.fastlyReadiness.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.fastlyHostcallBinding) {
      writeJson(path.join(outDir, 'fastly-hostcall-binding-contract.json'), result.fastlyHostcallBinding.artifact, artifactRecords);
      writeJson(path.join(outDir, 'fastly-hostcall-modules.json'), result.fastlyHostcallBinding.hostcallModules, artifactRecords);
      writeJson(path.join(outDir, 'fastly-ref-lifecycle.json'), result.fastlyHostcallBinding.refLifecycle, artifactRecords);
      writeJson(path.join(outDir, 'fastly-stream-binding-plan.json'), result.fastlyHostcallBinding.streamBindingPlan, artifactRecords);
      writeJson(path.join(outDir, 'fastly-pack-inputs.json'), result.fastlyHostcallBinding.packInputs, artifactRecords);
      writeJson(path.join(outDir, 'fastly-binding-risk-report.json'), result.fastlyHostcallBinding.riskReport, artifactRecords);
      for (const file of result.fastlyHostcallBinding.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    if (result.fastlyAdapter) {
      writeJson(path.join(outDir, 'fastly-adapter.json'), result.fastlyAdapter.artifact, artifactRecords);
      writeJson(path.join(outDir, 'fastly-stream-header-adapter.json'), result.fastlyAdapter.streamHeaderAdapter, artifactRecords);
      writeJson(path.join(outDir, 'fastly-local-smoke.json'), result.fastlyAdapter.localSmoke, artifactRecords);
      writeJson(path.join(outDir, 'fastly-packaging-smoke.json'), result.fastlyAdapter.packagingSmoke, artifactRecords);
      writeJson(path.join(outDir, 'fastly-deployment-readiness.json'), result.fastlyAdapter.deploymentReadiness, artifactRecords);
      for (const file of result.fastlyAdapter.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
      for (const output of result.fastlyAdapter.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.fastlyCommandEntry) {
      writeJson(path.join(outDir, 'fastly-command-entry.json'), result.fastlyCommandEntry.artifact, artifactRecords);
      writeJson(path.join(outDir, 'fastly-start-export-audit.json'), result.fastlyCommandEntry.startExportAudit, artifactRecords);
      writeJson(path.join(outDir, 'fastly-command-import-audit.json'), result.fastlyCommandEntry.importAudit, artifactRecords);
      writeJson(path.join(outDir, 'fastly-serve-gate.json'), result.fastlyCommandEntry.serveGate, artifactRecords);
      writeJson(path.join(outDir, 'fastly-command-smoke.json'), result.fastlyCommandEntry.commandSmoke, artifactRecords);
      for (const file of result.fastlyCommandEntry.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
      for (const output of result.fastlyCommandEntry.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.compiledHandlers) {
      writeJson(path.join(outDir, 'compiled-handler-plan.json'), result.compiledHandlers.artifact, artifactRecords);
      writeJson(path.join(outDir, 'handler-lowering-report.json'), result.compiledHandlers.report, artifactRecords);
      writeJson(path.join(outDir, 'compiled-handler-hardening.json'), result.compiledHandlers.hardening, artifactRecords);
      writeJson(path.join(outDir, 'compiled-handler-smoke.json'), result.compiledHandlers.smoke, artifactRecords);
      for (const file of result.compiledHandlers.files || []) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
      for (const output of result.compiledHandlers.outputFiles || []) {
        const abs = path.resolve(cwd, output.file);
        if (fs.existsSync(abs)) {
          const buffer = fs.readFileSync(abs);
          artifactRecords.push(makeArtifactRecord(artifactName(outDir, abs), undefined, buffer));
        }
      }
    }
    if (result.deploymentPosture) {
      writeJson(path.join(outDir, 'deployment-posture.json'), result.deploymentPosture.artifact, artifactRecords);
    }
    if (result.dispatchTs) {
      writeJson(path.join(outDir, 'generated/manifest.json'), result.dispatchTs.manifest, artifactRecords, outDir);
      for (const file of result.dispatchTs.files) {
        writeText(path.join(outDir, file.file), file.text, artifactRecords, outDir);
      }
    }
    writeJson(path.join(outDir, 'route-plan.json'), result.routePlan, artifactRecords);
    writeJson(path.join(outDir, 'route-id-map.json'), result.routeIdMap, artifactRecords);
    writeJson(path.join(outDir, 'router-ir.json'), result.routerIR, artifactRecords);
    writeJson(path.join(outDir, 'router-tree.json'), result.routerTree, artifactRecords);
    writeDiagnostics(outDir, diagnostics, artifactRecords);
    if (args.command === 'doctor') {
      writeDoctor(outDir, args, diagnostics, result, resolvedConfig, artifactRecords);
    }
    if (args.includeAst) {
      writeJson(path.join(outDir, 'ast.json'), result.ast, artifactRecords);
    }
    writeBuildManifest(outDir, {
      cwd,
      outDir,
      args,
      status: 'ok',
      resolvedConfig,
      result,
      diagnostics,
      entry,
      rootRouter: root
    }, artifactRecords);

    const completion = args.command === 'plan' ? 'PulseWasm plan complete.' : args.command === 'doctor' ? 'PulseWasm doctor complete.' : 'PulseWasm build complete.';
    stdout.write(`${completion}\n`);
    if (resolvedConfig) stdout.write(`  resolved config: ${path.join(outDir, 'resolved-config.json')}\n`);
    if (args.command === 'doctor') stdout.write(`  doctor:         ${path.join(outDir, 'cli-doctor.json')}\n`);
    stdout.write(`  symbol index:    ${path.join(outDir, 'symbol-index.json')}\n`);
    stdout.write(`  handler table:   ${path.join(outDir, 'handler-table.json')}\n`);
    stdout.write(`  handler eval:    ${path.join(outDir, 'handler-eval.json')}\n`);
    stdout.write(`  path table:      ${path.join(outDir, 'path-table.json')}\n`);
    stdout.write(`  dispatch table:  ${path.join(outDir, 'dispatch-table.json')}\n`);
    stdout.write(`  execution plan:  ${path.join(outDir, 'execution-plan.json')}\n`);
    if (result.handlerBindings) stdout.write(`  handler bindings: ${path.join(outDir, 'handler-bindings.json')}\n`);
    if (result.executionHarness) stdout.write(`  execution harness: ${path.join(outDir, 'execution-harness.json')}\n`);
    if (result.localHarness) stdout.write(`  local harness:    ${path.join(outDir, 'local-harness.json')}\n`);
    if (result.assemblyScriptShape) stdout.write(`  AssemblyScript shape: ${path.join(outDir, 'assemblyscript-shape.json')}\n`);
    if (result.assemblyScriptCore) {
      stdout.write(`  AssemblyScript core:  ${path.join(outDir, 'assemblyscript-core.json')}\n`);
      if (result.assemblyScriptCore.handlersArtifact) stdout.write(`  AssemblyScript handlers: ${path.join(outDir, 'assemblyscript-handlers.json')}\n`);
    }
    if (result.assemblyScriptCompile) stdout.write(`  AssemblyScript compile: ${path.join(outDir, 'assemblyscript-compile.json')}\n`);
    if (result.assemblyScriptWasmSmoke) stdout.write(`  AssemblyScript Wasm smoke: ${path.join(outDir, 'assemblyscript-wasm-smoke.json')}\n`);
    if (result.wasmHostAbi) stdout.write(`  Wasm host ABI:  ${path.join(outDir, 'wasm-host-abi.json')}\n`);
    if (result.wasmHostBridge) stdout.write(`  Wasm host bridge: ${path.join(outDir, 'wasm-host-bridge.json')}\n`);
    if (result.requestResultHeaders) stdout.write(`  request/result/headers: ${path.join(outDir, 'request-result-headers.json')}\n`);
    if (result.channelBroadcaster) stdout.write(`  channel/broadcaster: ${path.join(outDir, 'channel-broadcaster.json')}\n`);
    if (result.jsonBody) stdout.write(`  JSON/body ABI:   ${path.join(outDir, 'json-body.json')}\n`);
    if (result.backendCapabilities) stdout.write(`  backend capabilities: ${path.join(outDir, 'backend-capabilities.json')}\n`);
    if (result.hostRuntimeKernel) stdout.write(`  host runtime kernel: ${path.join(outDir, 'host-runtime-kernel.json')}\n`);
    if (result.nodeAdapter) stdout.write(`  Node adapter:    ${path.join(outDir, 'node-adapter.json')}\n`);
    if (result.handlerLibraryContracts) stdout.write(`  handler/library contracts: ${path.join(outDir, 'handler-library-contracts.json')}\n`);
    if (result.assetsLoweringPlan) stdout.write(`  assets lowering plan: ${path.join(outDir, 'assets-lowering-plan.json')}\n`);
    if (result.assetsCompiledWasmSidecarPlan) stdout.write(`  assets compiled-Wasm sidecar plan: ${path.join(outDir, 'assets-compiled-wasm-sidecar-plan.json')}\n`);
    if (result.assetsSidecarCompileLinkProof) stdout.write(`  assets sidecar compile/link proof: ${path.join(outDir, 'assets-sidecar-compile-link-proof.json')}\n`);
    if (result.nodeAssetsProviderProof) stdout.write(`  Node assets provider proof: ${path.join(outDir, 'node-assets-provider-proof.json')}\n`);
    if (result.nodeCompiledWasmAssetsLifecycleProof) stdout.write(`  Node compiled-Wasm assets lifecycle proof: ${path.join(outDir, 'node-compiled-wasm-assets-lifecycle-proof.json')}\n`);
    if (result.fastlyAssetsProviderProof) stdout.write(`  Fastly assets provider proof: ${path.join(outDir, 'fastly-assets-provider-proof.json')}\n`);
    if (result.fastlyAssetsPackageOutParityProof) stdout.write(`  Fastly assets package-out parity proof: ${path.join(outDir, 'fastly-assets-package-out-parity-proof.json')}\n`);
    if (result.routeHandlerEffectPlan) stdout.write(`  route handler effect plan: ${path.join(outDir, 'route-handler-effect-plan.json')}\n`);
    if (result.nodeRouteHandlerEffectProof) stdout.write(`  Node route handler effect proof: ${path.join(outDir, 'node-route-handler-effect-proof.json')}\n`);
    if (result.nodeLiveOriginRouteHandlerEffectProof) stdout.write(`  Node live-origin route handler effect proof: ${path.join(outDir, 'node-live-origin-route-handler-effect-proof.json')}\n`);
    if (result.nodeCompiledRouteHandlerEffectBridge) stdout.write(`  Node compiled route handler effect bridge: ${path.join(outDir, 'node-compiled-route-handler-effect-bridge.json')}\n`);
    if (result.fastlyRouteHandlerEffectProof) stdout.write(`  Fastly route handler effect proof: ${path.join(outDir, 'fastly-route-handler-effect-proof.json')}\n`);
    if (result.fastlyLifecycleParityProof) stdout.write(`  Fastly lifecycle parity proof: ${path.join(outDir, 'fastly-lifecycle-parity-proof.json')}\n`);
    if (result.routeHandlerContextLoweringPlan) stdout.write(`  route handler context lowering plan: ${path.join(outDir, 'route-handler-context-lowering-plan.json')}\n`);
    if (result.handlerIoLifecyclePlan) stdout.write(`  handler I/O lifecycle plan: ${path.join(outDir, 'handler-io-lifecycle-plan.json')}\n`);
    if (result.requestJsonBodyPlan) stdout.write(`  request JSON body plan: ${path.join(outDir, 'request-json-body-plan.json')}\n`);
    if (result.backendJsonRequestBodyPlan) stdout.write(`  backend JSON request body plan: ${path.join(outDir, 'backend-json-request-body-plan.json')}\n`);
    if (result.nodeBackendJsonRequestBodyProof) stdout.write(`  Node backend JSON request body proof: ${path.join(outDir, 'node-backend-json-request-body-proof.json')}\n`);
    if (result.nodeRequestJsonBodyProof) stdout.write(`  Node request JSON body proof: ${path.join(outDir, 'node-request-json-body-proof.json')}\n`);
    if (result.hostCapabilities) stdout.write(`  host capabilities: ${path.join(outDir, 'host-capabilities.json')}\n`);
    if (result.effectRuntime) stdout.write(`  effect runtime: ${path.join(outDir, 'effect-runtime.json')}\n`);
    if (result.effectComposition) stdout.write(`  effect composition: ${path.join(outDir, 'effect-composition.json')}\n`);
    if (result.schemaJsonCompile) stdout.write(`  schema JSON compile: ${path.join(outDir, 'schema-json-compile.json')}\n`);
    if (result.schemaJsonGenericParser) stdout.write(`  schema JSON generic parser: ${path.join(outDir, 'schema-json-generic-parser.json')}\n`);
    if (result.schemaJsonSidecar) stdout.write(`  schema JSON sidecar: ${path.join(outDir, 'schema-json-sidecar.json')}\n`);
    if (result.librarySidecars) stdout.write(`  library sidecars: ${path.join(outDir, 'library-sidecar-consumption.json')}\n`);
    if (result.streamingPassthrough) stdout.write(`  streaming/pass-through: ${path.join(outDir, 'streaming-passthrough.json')}\n`);
    if (result.compiledHandlers) stdout.write(`  compiled handlers: ${path.join(outDir, 'compiled-handler-plan.json')}\n`);
    if (result.compiledWasmRuntime) stdout.write(`  compiled-wasm runtime: ${path.join(outDir, 'compiled-wasm-runtime.json')}\n`);
    if (result.pulseWrapper) stdout.write(`  Pulse wrapper:   ${path.join(outDir, 'wrapper-integration.json')}\n`);
    if (result.fastlyReadiness) stdout.write(`  Fastly readiness: ${path.join(outDir, 'fastly-readiness.json')}\n`);
    if (result.fastlyHostcallBinding) stdout.write(`  Fastly hostcall binding: ${path.join(outDir, 'fastly-hostcall-binding-contract.json')}\n`);
    if (result.fastlyAdapter) stdout.write(`  Fastly adapter: ${path.join(outDir, 'fastly-adapter.json')}\n`);
    if (result.fastlyCommandEntry) stdout.write(`  Fastly command entry: ${path.join(outDir, 'fastly-command-entry.json')}\n`);
    if (result.deploymentPosture) stdout.write(`  deployment posture: ${path.join(outDir, 'deployment-posture.json')}\n`);
    if (result.dispatchTs) stdout.write(`  dispatch TS:     ${path.join(outDir, 'generated/dispatch.ts')}\n`);
    stdout.write(`  route-plan:      ${path.join(outDir, 'route-plan.json')}\n`);
    stdout.write(`  route-id-map:    ${path.join(outDir, 'route-id-map.json')}\n`);
    stdout.write(`  router IR:       ${path.join(outDir, 'router-ir.json')}\n`);
    stdout.write(`  tree:            ${path.join(outDir, 'router-tree.json')}\n`);
    stdout.write(`  diagnostics:     ${path.join(outDir, 'diagnostics.json')}\n`);
    if (args.includeAst) stdout.write(`  AST:             ${path.join(outDir, 'ast.json')}\n`);
    stdout.write(`  build manifest:  ${path.join(outDir, 'build-manifest.json')}\n`);
    exitIfRequested();
  } catch (error) {
    if (error instanceof ExtractionError) {
      const diagnostics = createDiagnosticsEnvelope({
        source: error.source || entry || args.entry || args.config || '<cli>',
        status: 'error',
        diagnostics: error.diagnostics,
        passes: error.passes || [],
        summary: { ...(error.summary || {}), strict: args.strict },
        cwd
      });
      try {
        writeDiagnostics(outDir, diagnostics, artifactRecords);
        if (args.command === 'doctor') {
          writeDoctor(outDir, args, diagnostics, null, resolvedConfig, artifactRecords);
        }
        writeBuildManifest(outDir, {
          cwd,
          outDir,
          args,
          status: 'error',
          resolvedConfig,
          diagnostics,
          entry,
          rootRouter: root
        }, artifactRecords);
      } catch (_) {
        // stderr remains the fallback when the diagnostics artifacts cannot be written.
      }
      stderr.write(`${args.command === 'doctor' ? 'PulseWasm doctor failed.' : args.command === 'plan' ? 'PulseWasm plan failed.' : 'PulseWasm build failed.'}\n${formatDiagnostics(error.diagnostics)}\n`);
      stderr.write(`  diagnostics:     ${path.join(outDir, 'diagnostics.json')}\n`);
      stderr.write(`  build manifest:  ${path.join(outDir, 'build-manifest.json')}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

module.exports = {
  parseArgs,
  runCli,
  usage
};
