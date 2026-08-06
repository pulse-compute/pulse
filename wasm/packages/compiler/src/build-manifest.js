'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { PACKAGE_VERSION, countDiagnostics, normalizeArtifact, stableFileName } = require('./diagnostics.js');
const { getDefaultArtifactsDir } = require('@pulse-compute/wasm-build-support/artifacts-dir');

const ARTIFACT_ORDER = [
  'resolved-config.json',
  'cli-doctor.json',
  'symbol-index.json',
  'handler-table.json',
  'handler-eval.json',
  'path-table.json',
  'dispatch-table.json',
  'execution-plan.json',
  'handler-bindings.json',
  'execution-harness.json',
  'local-harness.json',
  'assemblyscript-shape.json',
  'assemblyscript-core.json',
  'assemblyscript-handlers.json',
  'assemblyscript-compile.json',
  'assemblyscript-wasm-smoke.json',
  'wasm-host-abi.json',
  'wasm-host-bridge.json',
  'request-result-headers.json',
  'channel-broadcaster.json',
  'json-body.json',
  'backend-capabilities.json',
  'deployment-posture.json',
  'host-runtime-kernel.json',
  'node-adapter.json',
  'handler-library-contracts.json',
  'handler-execution-modes.json',
  'library-contract-schema.json',
  'library-capabilities.json',
  'library-compatibility-report.json',
  'assets-lowering-plan.json',
  'assets-compiled-wasm-sidecar-plan.json',
  'assets-sidecar-compile-link-proof.json',
  'assets-package-owned-lowering-proof.json',
  'assets-package-out-discovery-proof.json',
  'grip-lowering-plan.json',
  'second-package-owned-lowering-proof.json',
  'grip-package-owned-lowering-proof.json',
  'guest-unit-plan.json',
  'guest-link-report.json',
  'final-wasm-audit.json',
  'node-assets-provider-proof.json',
  'node-compiled-wasm-assets-lifecycle-proof.json',
  'fastly-assets-provider-proof.json',
  'fastly-assets-package-out-parity-proof.json',
  'route-handler-effect-plan.json',
  'node-route-handler-effect-proof.json',
  'node-live-origin-route-handler-effect-proof.json',
  'node-compiled-route-handler-effect-bridge.json',
  'fastly-route-handler-effect-proof.json',
  'fastly-lifecycle-parity-proof.json',
  'route-handler-context-lowering-plan.json',
  'handler-io-lifecycle-plan.json',
  'request-json-body-plan.json',
  'node-request-json-body-proof.json',
  'schema-decode-result-plan.json',
  'node-schema-decode-result-proof.json',
  'schema-response-codec-plan.json',
  'backend-json-request-body-plan.json',
  'node-backend-json-request-body-proof.json',
  'node-schema-response-codec-proof.json',
  'reference-lifecycle-stabilization-proof.json',
  'reference-node-lifecycle-golden.json',
  'beta-lifecycle-golden.json',
  'lifecycle-authoring-alignment.json',
  'lifecycle-readiness-aggregate.json',
  'doctor-readiness-aggregator.json',
  'host-capabilities.json',
  'host-capability-contract.json',
  'wasi-provider-map.json',
  'capability-provider-report.json',
  'effect-runtime.json',
  'effect-runtime-contract.json',
  'effect-kind-registry.json',
  'effect-resume-protocol.json',
  'effect-timeout-policy.json',
  'effect-composition.json',
  'effect-plan-contract.json',
  'effect-continuation-contract.json',
  'timeout-scope-policy.json',
  'compiled-handler-plan.json',
  'handler-lowering-report.json',
  'compiled-handler-hardening.json',
  'compiled-handler-smoke.json',
  'wrapper-integration.json',
  'pulse-build-output.json',
  'pulse-dev-runtime.json',
  'schema-json-generic-parser.json',
  'schema-json-generic-parser-plan.json',
  'schema-json-generic-parser-abi.json',
  'schema-json-generic-parser-smoke.json',
  'schema-json-sidecar.json',
  'schema-json-plan.json',
  'schema-json-parser-report.json',
  'schema-json-registry.json',
  'schema-json-sidecar-abi.json',
  'schema-json-body-policy.json',
  'schema-json-smoke.json',
  'generated/as/schema-json/generic/as-json-parser.as.ts',
  'generated/as-smoke/schema-json-generic-parser-smoke-runner.as.ts',
  'generated/schema-json-generic-parser/pulsewasm-schema-json-generic-parser.wasm',
  'generated/schema-json-generic-parser/pulsewasm-schema-json-generic-parser.wat',
  'generated/host/schema-json-generic-parser.md',
  'generated/host/handler-library-contracts.md',
  'generated/host/host-capabilities.md',
  'generated/host/effect-runtime.md',
  'generated/host/effect-composition.md',
  'generated/as/user-handlers.as.ts',
  'generated/as-smoke/compiled-handler-smoke-runner.as.ts',
  'generated/compiled-handlers/pulsewasm-compiled-handlers.wasm',
  'generated/compiled-handlers/pulsewasm-compiled-handlers.wat',
  'generated/as-smoke/pulsewasm-smoke.wasm',
  'generated/as-smoke/pulsewasm-smoke.wat',
  'generated/wasm-smoke/pulsewasm-local-smoke.wasm',
  'generated/wasm-smoke/pulsewasm-local-smoke.wat',
  'generated/as-smoke/smoke-runner.as.ts',
  'generated/host/wasm-host-abi.md',
  'generated/host/request-result-headers.md',
  'generated/host/channel-broadcaster.md',
  'generated/host/json-body.md',
  'generated/host/backend-capabilities.md',
  'generated/host/pulse-wrapper-integration.md',
  'generated/pulse/pulse-wrapper.cjs',
  'generated/host/host-runtime-kernel.cjs',
  'generated/node/node-adapter.cjs',
  'generated/host-bridge/host-bridge-runner.as.ts',
  'generated/wasm-bridge/pulsewasm-host-bridge.wasm',
  'generated/wasm-bridge/pulsewasm-host-bridge.wat',
  'generated/manifest.json',
  'generated/types.ts',
  'generated/route-table.ts',
  'generated/dispatch.ts',
  'generated/handler-slots.ts',
  'generated/execution-plan.ts',
  'generated/execution-harness.ts',
  'generated/local-harness.ts',
  'generated/as/manifest.json',
  'generated/as/types.as.ts',
  'generated/as/route-table.as.ts',
  'generated/as/dispatch-shape.as.ts',
  'generated/as/runtime-path.as.ts',
  'generated/as/handler-slots.as.ts',
  'generated/as/runtime-core.as.ts',
  'generated/as/index.as.ts',
  'generated/index.ts',
  'route-plan.json',
  'route-id-map.json',
  'router-ir.json',
  'router-tree.json',
  'diagnostics.json',
  'ast.json',
  'build-manifest.json'
];

function sha256(text) {
  const hash = crypto.createHash('sha256');
  if (Buffer.isBuffer(text)) hash.update(text);
  else hash.update(String(text), 'utf8');
  return hash.digest('hex');
}

function artifactVersion(value) {
  return value && typeof value === 'object' && typeof value.version === 'string' ? value.version : undefined;
}

function artifactSortKey(fileName) {
  const index = ARTIFACT_ORDER.indexOf(fileName);
  return index === -1 ? ARTIFACT_ORDER.length + fileName.charCodeAt(0) : index;
}

function sortArtifacts(artifacts) {
  return artifacts.slice().sort((a, b) => {
    const ak = artifactSortKey(a.file);
    const bk = artifactSortKey(b.file);
    if (ak !== bk) return ak - bk;
    return a.file.localeCompare(b.file);
  });
}

function makeArtifactRecord(fileName, value, jsonText) {
  return {
    file: fileName,
    version: artifactVersion(value),
    bytes: Buffer.isBuffer(jsonText) ? jsonText.length : Buffer.byteLength(String(jsonText), 'utf8'),
    sha256: sha256(jsonText)
  };
}

function summarizeResult(result) {
  if (!result) return undefined;
  const routePlan = result.routePlan || {};
  const handlerTable = result.handlerTable || {};
  const handlerEval = result.handlerEval || {};
  const dispatchTable = result.dispatchTable || {};
  const dispatchTs = result.dispatchTs || {};
  return {
    routes: Array.isArray(routePlan.routes) ? routePlan.routes.length : 0,
    handlers: Array.isArray(handlerTable.handlers) ? handlerTable.handlers.length : 0,
    handlerEvalStatus: handlerEval.summary,
    dispatch: dispatchTable.summary,
    executionPlan: result.executionPlan?.summary,
    handlerBindings: result.handlerBindings?.artifact?.summary,
    executionHarness: result.executionHarness?.artifact?.summary,
    localHarness: result.localHarness?.artifact?.summary,
    assemblyScriptShape: result.assemblyScriptShape?.artifact?.summary,
    assemblyScriptCore: result.assemblyScriptCore?.artifact?.summary,
    assemblyScriptCompile: result.assemblyScriptCompile?.artifact?.summary,
    assemblyScriptWasmSmoke: result.assemblyScriptWasmSmoke?.artifact?.summary,
    wasmHostAbi: result.wasmHostAbi?.artifact?.summary,
    wasmHostBridge: result.wasmHostBridge?.artifact?.summary,
    requestResultHeaders: result.requestResultHeaders?.artifact?.summary,
    channelBroadcaster: result.channelBroadcaster?.artifact?.summary,
    jsonBody: result.jsonBody?.artifact?.summary,
    backendCapabilities: result.backendCapabilities?.artifact?.summary,
    deploymentPosture: result.deploymentPosture?.artifact?.summary,
    hostRuntimeKernel: result.hostRuntimeKernel?.artifact?.summary,
    nodeAdapter: result.nodeAdapter?.artifact?.summary,
    handlerLibraryContracts: result.handlerLibraryContracts?.artifact?.summary,
    doctorReadinessAggregator: result.doctorReadinessAggregator?.artifact?.summary,
    lifecycleReadinessAggregate: result.lifecycleReadinessAggregate?.artifact?.summary,
    assetsLoweringPlan: result.assetsLoweringPlan?.artifact?.summary,
    nodeAssetsProviderProof: result.nodeAssetsProviderProof?.artifact?.summary,
    fastlyAssetsProviderProof: result.fastlyAssetsProviderProof?.artifact?.summary,
    fastlyAssetsPackageOutParityProof: result.fastlyAssetsPackageOutParityProof?.artifact?.summary,
    routeHandlerEffectPlan: result.routeHandlerEffectPlan?.artifact?.summary,
    nodeRouteHandlerEffectProof: result.nodeRouteHandlerEffectProof?.artifact?.summary,
    nodeLiveOriginRouteHandlerEffectProof: result.nodeLiveOriginRouteHandlerEffectProof?.artifact?.summary,
    nodeCompiledRouteHandlerEffectBridge: result.nodeCompiledRouteHandlerEffectBridge?.artifact?.summary,
    fastlyRouteHandlerEffectProof: result.fastlyRouteHandlerEffectProof?.artifact?.summary,
    fastlyLifecycleParityProof: result.fastlyLifecycleParityProof?.artifact?.summary,
    routeHandlerContextLoweringPlan: result.routeHandlerContextLoweringPlan?.artifact?.summary,
    handlerIoLifecyclePlan: result.handlerIoLifecyclePlan?.artifact?.summary,
    requestJsonBodyPlan: result.requestJsonBodyPlan?.artifact?.summary,
    schemaDecodeResultPlan: result.schemaDecodeResultPlan?.artifact?.summary,
    schemaResponseCodecPlan: result.schemaResponseCodecPlan?.artifact?.summary,
    backendJsonRequestBodyPlan: result.backendJsonRequestBodyPlan?.artifact?.summary,
    nodeBackendJsonRequestBodyProof: result.nodeBackendJsonRequestBodyProof?.artifact?.summary,
    nodeRequestJsonBodyProof: result.nodeRequestJsonBodyProof?.artifact?.summary,
    nodeSchemaDecodeResultProof: result.nodeSchemaDecodeResultProof?.artifact?.summary,
    nodeSchemaResponseCodecProof: result.nodeSchemaResponseCodecProof?.artifact?.summary,
    hostCapabilities: result.hostCapabilities?.artifact?.summary,
    effectRuntime: result.effectRuntime?.artifact?.summary,
    effectComposition: result.effectComposition?.artifact?.summary,
    compiledHandlers: result.compiledHandlers?.artifact?.summary,
    schemaJsonCompile: result.schemaJsonCompile?.artifact?.summary,
    schemaJsonGenericParser: result.schemaJsonGenericParser?.artifact?.summary,
    schemaJsonSidecar: result.schemaJsonSidecar?.artifact?.summary,
    dispatchTs: dispatchTs.manifest ? dispatchTs.manifest.summary : undefined
  };
}

function createBuildManifest(options = {}) {
  const cwd = options.cwd || process.cwd();
  const outDir = options.outDir || getDefaultArtifactsDir(cwd);
  const args = options.args || {};
  const result = options.result;
  const resolvedConfig = options.resolvedConfig;
  const diagnostics = options.diagnostics || result?.diagnostics;
  const status = options.status || diagnostics?.status || 'ok';
  const artifactRecords = sortArtifacts(options.artifactRecords || []);

  const entry = options.entry || args.entry || result?.summary?.entry || resolvedConfig?.entry;
  const rootRouter = options.rootRouter || args.root || result?.summary?.rootRouter || resolvedConfig?.rootRouter;
  const selectedProfile = resolvedConfig?.selectedProfile || args.profile;
  const configSource = resolvedConfig?.artifact?.source || args.config;

  return normalizeArtifact({
    version: 'pulsewasm.build-manifest.v1',
    generatedBy: PACKAGE_VERSION,
    status,
    command: args.command || 'build',
    strict: args.strict !== false,
    cwd: '.',
    outDir: stableFileName(outDir, cwd),
    config: configSource ? stableFileName(path.resolve(cwd, configSource), cwd) : undefined,
    profile: selectedProfile,
    entry: entry ? stableFileName(path.resolve(cwd, entry), cwd) : undefined,
    rootRouter,
    target: resolvedConfig?.target,
    artifactCount: artifactRecords.length,
    artifacts: artifactRecords,
    artifactMap: artifactRecords.reduce((acc, artifact) => {
      const key = artifact.file.replace(/\.json$/, '').replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      acc[key] = artifact.file;
      return acc;
    }, {}),
    passes: diagnostics?.passes || result?.diagnostics?.passes || [],
    diagnostics: diagnostics ? {
      status: diagnostics.status,
      counts: diagnostics.counts || countDiagnostics(diagnostics.diagnostics || [])
    } : undefined,
    summary: {
      configOnly: Boolean(args.configOnly),
      includeAst: Boolean(args.includeAst),
      emitDispatchTs: Boolean(args.emitDispatchTs),
      emitHandlerBindings: Boolean(args.emitHandlerBindings),
      emitExecutionHarness: Boolean(args.emitExecutionHarness),
      emitAssemblyScriptShape: Boolean(args.emitAssemblyScriptShape),
      emitAssemblyScriptCore: Boolean(args.emitAssemblyScriptCore),
      emitAssemblyScriptCompile: Boolean(args.emitAssemblyScriptCompile),
      emitWasmSmoke: Boolean(args.emitWasmSmoke),
      emitLocalHarness: Boolean(args.emitLocalHarness),
      emitWasmHostAbi: Boolean(args.emitWasmHostAbi),
      emitWasmHostBridge: Boolean(args.emitWasmHostBridge),
      emitRequestResultHeaders: Boolean(args.emitRequestResultHeaders),
      emitChannelBroadcaster: Boolean(args.emitChannelBroadcaster),
      emitJsonBody: Boolean(args.emitJsonBody),
      emitBackendCapabilities: Boolean(args.emitBackendCapabilities),
      emitHostRuntimeKernel: Boolean(args.emitHostRuntimeKernel),
      emitNodeAdapter: Boolean(args.emitNodeAdapter),
      emitHandlerLibraryContracts: Boolean(args.emitHandlerLibraryContracts),
      emitAssetsLoweringPlan: Boolean(args.emitAssetsLoweringPlan),
      emitNodeAssetsProviderProof: Boolean(args.emitNodeAssetsProviderProof),
      emitFastlyAssetsProviderProof: Boolean(args.emitFastlyAssetsProviderProof),
      emitFastlyAssetsPackageOutParityProof: Boolean(args.emitFastlyAssetsPackageOutParityProof),
      emitRouteHandlerEffectPlan: Boolean(args.emitRouteHandlerEffectPlan),
      emitNodeRouteHandlerEffectProof: Boolean(args.emitNodeRouteHandlerEffectProof),
      emitNodeLiveOriginRouteHandlerEffectProof: Boolean(args.emitNodeLiveOriginRouteHandlerEffectProof),
      emitNodeCompiledRouteHandlerEffectBridge: Boolean(args.emitNodeCompiledRouteHandlerEffectBridge),
      emitFastlyRouteHandlerEffectProof: Boolean(args.emitFastlyRouteHandlerEffectProof),
      emitFastlyLifecycleParityProof: Boolean(args.emitFastlyLifecycleParityProof),
      emitRouteHandlerContextLoweringPlan: Boolean(args.emitRouteHandlerContextLoweringPlan),
      emitHandlerIoLifecyclePlan: Boolean(args.emitHandlerIoLifecyclePlan),
      emitRequestJsonBodyPlan: Boolean(args.emitRequestJsonBodyPlan),
      emitNodeRequestJsonBodyProof: Boolean(args.emitNodeRequestJsonBodyProof),
      emitHostCapabilities: Boolean(args.emitHostCapabilities),
      emitEffectRuntime: Boolean(args.emitEffectRuntime),
      emitEffectComposition: Boolean(args.emitEffectComposition),
      emitCompiledHandlers: Boolean(args.emitCompiledHandlers),
      emitSchemaJsonCompile: Boolean(args.emitSchemaJsonCompile),
      emitSchemaJsonGenericParser: Boolean(args.emitSchemaJsonGenericParser),
      emitSchemaJsonSidecar: Boolean(args.emitSchemaJsonSidecar),
      emitLibrarySidecars: Boolean(args.emitLibrarySidecars),
      emitAssemblyScriptPathMatcher: Boolean(args.emitAssemblyScriptCore),
      selectedProfile,
      extraction: summarizeResult(result)
    }
  }, cwd);
}

module.exports = {
  createBuildManifest,
  makeArtifactRecord,
  sha256,
  sortArtifacts
};
