#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const wasmRoot = path.resolve(__dirname, '..');
const packagesRoot = path.join(wasmRoot, 'packages');
const repoRoot = path.resolve(wasmRoot, '..');
const providerFastlyRoot = path.join(repoRoot, 'packages', 'provider-fastly');
const providerNodeRoot = path.join(repoRoot, 'packages', 'provider-node');
const contractsSourceRoot = path.join(packagesRoot, 'contracts', 'src');

function rel(file) {
  const base = file.startsWith(wasmRoot) ? wasmRoot : repoRoot;
  return path.relative(base, file).replace(/\\/g, '/');
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'artifacts') continue;
      walk(full, files);
    } else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function maskStringsAndComments(source) {
  let out = '';
  let i = 0;
  let state = 'code';
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        out += '  ';
        i += 2;
        state = 'line';
        continue;
      }
      if (ch === '/' && next === '*') {
        out += '  ';
        i += 2;
        state = 'block';
        continue;
      }
      if (ch === "'") {
        out += ' ';
        i += 1;
        state = 'single';
        continue;
      }
      if (ch === '"') {
        out += ' ';
        i += 1;
        state = 'double';
        continue;
      }
      if (ch === '`') {
        out += ' ';
        i += 1;
        state = 'template';
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (state === 'line') {
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      if (ch === '\n') state = 'code';
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') {
        out += '  ';
        i += 2;
        state = 'code';
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      if (ch === '\\') {
        out += ' ';
        if (i + 1 < source.length) out += source[i + 1] === '\n' ? '\n' : ' ';
        i += 2;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"') || (state === 'template' && ch === '`')) {
        state = 'code';
      }
      continue;
    }
  }
  return out;
}

function lineForOffset(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function collectVersionLiterals(source) {
  const result = [];
  const pattern = /pulsewasm\.[a-z0-9_.-]+\.v[0-9]+/g;
  let match;
  while ((match = pattern.exec(source))) {
    result.push({ literal: match[0], line: lineForOffset(source, match.index) });
  }
  return result;
}

function collectContractVersionLiterals() {
  const literals = new Map();
  for (const file of walk(contractsSourceRoot)) {
    const fileRel = rel(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const { literal } of collectVersionLiterals(text)) {
      const owners = literals.get(literal) || [];
      owners.push(fileRel);
      literals.set(literal, owners);
    }
  }
  return literals;
}

function sourceFilesOutsideContracts() {
  const files = [];
  for (const packageEntry of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!packageEntry.isDirectory()) continue;
    if (packageEntry.name === 'contracts') continue;
    files.push(...walk(path.join(packagesRoot, packageEntry.name, 'src')));
  }
  files.push(...walk(path.join(providerFastlyRoot, 'src')));
  files.push(...walk(path.join(providerNodeRoot, 'src')));
  files.push(...walk(path.join(repoRoot, 'packages', 'runtime', 'src')));
  return files;
}

function toSet(values) {
  return new Set(values || []);
}

// This is the intentional package-local/compiler-local version ledger. Any new non-contract
// pulsewasm.*.vN literal must be added here with an owning file, or moved to contracts first.
const allowedLocalVersionLiterals = new Map(Object.entries({
  'packages/build-support/src/assemblyscript-compile.js': [
    'pulsewasm.assemblyscript-compile.v1'
  ],
  'packages/compiler/src/build-manifest.js': [
    'pulsewasm.build-manifest.v1'
  ],
  'packages/compiler/src/cli-intents.js': [
    'pulsewasm.cli-artifacts.v1',
    'pulsewasm.cli-doctor.v1',
    'pulsewasm.doctor-handler-io-lifecycle.v1',
    'pulsewasm.doctor-assets-package.v1',
    'pulsewasm.cli-explain.v1',
    'pulsewasm.cli-intent.v1'
  ],
  'packages/compiler/src/codegen/dispatch-ts.js': [
    'pulsewasm.dispatch-ts.v3'
  ],
  'packages/compiler/src/codegen/effect-composition.js': [
    'pulsewasm.effect-composition.v1',
    'pulsewasm.effect-continuation-contract.v1',
    'pulsewasm.effect-plan-contract.v1',
    'pulsewasm.timeout-scope-policy.v1'
  ],
  'packages/compiler/src/codegen/effect-runtime.js': [
    'pulsewasm.effect-kind-registry.v1',
    'pulsewasm.effect-resume-protocol.v1',
    'pulsewasm.effect-runtime-contract.v1',
    'pulsewasm.effect-runtime.v1',
    'pulsewasm.effect-timeout-policy.v1'
  ],
  'packages/compiler/src/codegen/execution-harness-ts.js': [
    'pulsewasm.execution-harness.v2'
  ],
  'packages/compiler/src/codegen/handler-bindings-ts.js': [
    'pulsewasm.handler-bindings.v1'
  ],
  'packages/compiler/src/codegen/local-harness-ts.js': [
    'pulsewasm.local-harness.v1',
    'pulsewasm.result-abi.v1'
  ],
  'packages/compiler/src/codegen/pulse-wrapper.js': [
    'pulsewasm.pulse-build-output.runtime.v1',
    'pulsewasm.pulse-build-output.v1',
    'pulsewasm.pulse-dev-runtime.runtime.v1',
    'pulsewasm.pulse-dev-runtime.v1',
    'pulsewasm.resolved-config.v2',
    'pulsewasm.wrapper-integration.v1',
    'pulsewasm.wrapper-smoke-manifest.v1'
  ],
  'packages/compiler/src/config-resolver.js': [
    'pulsewasm.resolved-config.v2'
  ],
  'packages/compiler/src/extractor.js': [
    'pulsewasm.ast.v1',
    'pulsewasm.router-ir.v1',
    'pulsewasm.router-tree.v1',
    'pulsewasm.symbol-index.v1'
  ],
  'packages/compiler/src/handler-eval.js': [
    'pulsewasm.handler-eval.v1'
  ],
  'packages/host-runtime/src/compiler/compiled-wasm-runtime.js': [
    'pulsewasm.compiled-wasm-host-runtime.v1',
    'pulsewasm.compiled-wasm-node-adapter.v1',
    'pulsewasm.compiled-wasm-runtime-smoke.v1',
    'pulsewasm.compiled-wasm-runtime.v1'
  ],
  'packages/host-runtime/src/compiler/host-runtime-kernel.js': [
    'pulsewasm.host-runtime-kernel.v2'
  ],
  'packages/host-runtime/src/compiler/wasm-host-bridge.js': [
    'pulsewasm.wasm-host-bridge.v3'
  ],
  'packages/host-runtime/src/runtime/compiled-wasm-host-runtime-kv.js': [
    'pulsewasm.compiled-wasm-host-runtime-kv.v1'
  ],
  'packages/provider-fastly/src/compiler/lifecycle-parity-contract.js': [
    'pulsewasm.fastly-lifecycle-parity-proof.v1'
  ],
  'packages/provider-fastly/src/compiler/fastly-adapter.js': [
    'pulsewasm.fastly-adapter.v1',
    'pulsewasm.fastly-deployment-readiness.v1',
    'pulsewasm.fastly-local-smoke.v1',
    'pulsewasm.fastly-packaging-smoke.v1',
    'pulsewasm.fastly-stream-header-adapter.v1'
  ],
  'packages/provider-fastly/src/compiler/fastly-command-entry.js': [
    'pulsewasm.fastly-command-entry.v1',
    'pulsewasm.fastly-command-import-audit.v1',
    'pulsewasm.fastly-command-smoke.v1',
    'pulsewasm.fastly-serve-gate.v1',
    'pulsewasm.fastly-start-export-audit.v1'
  ],
  'packages/provider-fastly/src/compiler/fastly-config-secret-serve.js': [
    'pulsewasm.fastly-config-secret-readiness.v1',
    'pulsewasm.fastly-config-secret-runtime.v1',
    'pulsewasm.fastly-config-secret-serve.v1',
    'pulsewasm.fastly-config-secret-smoke.v1'
  ],
  'packages/provider-fastly/src/compiler/fastly-hostcall-binding.js': [
    'pulsewasm.fastly-binding-risk-report.v1',
    'pulsewasm.fastly-hostcall-binding-contract.v1',
    'pulsewasm.fastly-hostcall-modules.v1',
    'pulsewasm.fastly-pack-inputs.v1',
    'pulsewasm.fastly-ref-lifecycle.v1',
    'pulsewasm.fastly-stream-binding-plan.v1'
  ],
  'packages/provider-fastly/src/compiler/fastly-readiness.js': [
    'pulsewasm.fastly-adapter-plan.v1',
    'pulsewasm.fastly-capability-map.v1',
    'pulsewasm.fastly-hostcall-map.v1',
    'pulsewasm.fastly-packaging-plan.v1',
    'pulsewasm.fastly-readiness.v1',
    'pulsewasm.fastly-risk-report.v1',
    'pulsewasm.fastly-sdk-audit.v1'
  ],
  'packages/provider-node/src/compiler/node-adapter.js': [
    'pulsewasm.node-adapter.v2'
  ],
  'packages/provider-node/src/runtime/compiled-wasm-node-adapter-kv.js': [
    'pulsewasm.compiled-wasm-node-adapter-kv.v1'
  ],
  'packages/runtime-core-as/src/compiler/assemblyscript-core.js': [
    'pulsewasm.assemblyscript-core.v3',
    'pulsewasm.assemblyscript-handlers.v1'
  ],
  'packages/runtime-core-as/src/compiler/assemblyscript-shape.js': [
    'pulsewasm.assemblyscript-generated.v2',
    'pulsewasm.assemblyscript-shape.v2'
  ],
  'packages/runtime-core-as/src/compiler/assemblyscript-wasm-smoke.js': [
    'pulsewasm.assemblyscript-wasm-smoke.v1'
  ],
  'packages/runtime-core-as/src/compiler/compiled-handlers.js': [
    'pulsewasm.compiled-handler-hardening.v1',
    'pulsewasm.compiled-handler-plan.v2',
    'pulsewasm.compiled-handler-smoke.v2',
    'pulsewasm.handler-lowering-report.v2'
  ],
  'packages/runtime-core-as/src/compiler/integrated-compiled-app.js': [
    'pulsewasm.integrated-compiled-app-smoke.v1',
    'pulsewasm.integrated-compiled-app.v1',
    'pulsewasm.integrated-link-report.v1'
  ]
}).map(([file, literals]) => [file, toSet(literals)]));

// Suspicious uppercase ledgers/maps must also be classified. This catches new local
// *_POLICY / *_CODES / *_CAPABILITIES style hidden contracts even when they do not
// contain a pulsewasm version literal.
const allowedLocalIdentifierDefinitions = new Map(Object.entries({
  // K1 assigns the portable authoring/host boundary to runtime. Native and Node
  // consume that owner's host export; neither duplicates its operation ledger.
  'packages/runtime/src/internal/conditional-kv.js': ['KV_CONDITIONAL_KINDS'],
  // Runtime owns Router error admission. The Native host consumes its host
  // predicate; provider numeric diagnostics map into this documented catalog.
  'packages/runtime/src/internal/errors.js': ['APPLICATION_ERROR_CODES'],
  'packages/runtime/src/internal/logging.js': [
    'LOG_METHODS'
  ],
  'packages/runtime/src/internal/package-runtime.js': [
    'PACKAGE_RUNTIME_BRIDGE_VERSION',
    'PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION'
  ],
  'packages/runtime/src/internal/fetch.js': [
    'SUPPORTED_FETCH_METHODS',
    'SUPPORTED_FETCH_INIT_FIELDS'
  ],
  'packages/provider-node/src/javascript/bindings-adapter.js': [
    'NODE_JAVASCRIPT_BINDINGS_ADAPTER_VERSION'
  ],
  'packages/provider-node/src/javascript/fetch-adapter.js': [
    'NODE_JAVASCRIPT_FETCH_ADAPTER_VERSION'
  ],
  'packages/provider-node/src/javascript/assets-adapter.js': [
    'NODE_JAVASCRIPT_ASSETS_ADAPTER_VERSION'
  ],
  'packages/provider-node/src/javascript/package-effects.js': [
    'NODE_JAVASCRIPT_PACKAGE_EFFECTS_VERSION'
  ],
  'packages/provider-node/src/javascript/grip-broadcast.js': [
    'NODE_JAVASCRIPT_GRIP_BROADCAST_VERSION'
  ],
  'packages/provider-node/src/javascript/jwt-verifier.js': [
    'NODE_JAVASCRIPT_JWT_VERIFIER_VERSION'
  ],
  'packages/provider-node/src/runtime/jwt-verifier.js': [
    'NODE_NATIVE_JWT_VERIFIER_VERSION'
  ],
  'packages/provider-node/src/javascript/source-package.js': [
    'NODE_JAVASCRIPT_SOURCE_PACKAGE_VERSION'
  ],
  'packages/provider-fastly/src/javascript/source-package.js': [
    'FASTLY_JAVASCRIPT_SOURCE_PACKAGE_VERSION',
    'FASTLY_JAVASCRIPT_DEPLOYMENT_CANDIDATE_VERSION',
    'FASTLY_JS_COMPUTE_VERSION',
    'ESBUILD_VERSION'
  ],
  'packages/provider-fastly/src/javascript/local-loader.js': [
    'FASTLY_JAVASCRIPT_LOCAL_LOADER_VERSION'
  ],
  'packages/provider-fastly/src/javascript/errors.js': [
    'FASTLY_JAVASCRIPT_PROVIDER_ERROR_VERSION'
  ],
  'packages/provider-fastly/src/javascript/bindings-adapter.js': [
    'FASTLY_JAVASCRIPT_BINDINGS_ADAPTER_VERSION'
  ],
  'packages/provider-fastly/src/javascript/fetch-adapter.js': [
    'FASTLY_JAVASCRIPT_FETCH_ADAPTER_VERSION'
  ],
  'packages/provider-fastly/src/javascript/assets-adapter.js': [
    'FASTLY_JAVASCRIPT_ASSETS_ADAPTER_VERSION'
  ],
  'packages/provider-fastly/src/javascript/package-effects.js': [
    'FASTLY_JAVASCRIPT_PACKAGE_EFFECTS_VERSION'
  ],
  'packages/provider-fastly/src/javascript/grip-broadcast.js': [
    'FASTLY_JAVASCRIPT_GRIP_BROADCAST_VERSION'
  ],
  'packages/provider-fastly/src/javascript/logging.js': [
    'FASTLY_JAVASCRIPT_LOGGING_VERSION'
  ],
  'packages/provider-fastly/src/javascript/jwt-verifier.js': [
    'FASTLY_JAVASCRIPT_JWT_VERIFIER_VERSION'
  ],
  'packages/provider-fastly/src/javascript/runtime-host.js': [
    'FASTLY_JAVASCRIPT_RUNTIME_HOST_VERSION'
  ],
  'packages/provider-fastly/src/javascript/lifecycle.js': [
    'FASTLY_JAVASCRIPT_LIFECYCLE_VERSION'
  ],
  'packages/provider-fastly/src/javascript/test-runtime.js': [
    'FASTLY_JAVASCRIPT_TEST_RUNTIME_VERSION'
  ],
  'packages/runtime/src/internal/effect-adapter.js': [
    'JAVASCRIPT_EFFECT_PROTOCOL_VERSION',
    'JAVASCRIPT_EFFECT_ADAPTER_VERSION',
    'JAVASCRIPT_EFFECT_OBSERVATION_VERSION'
  ],
  'packages/runtime/src/internal/event-execution.js': [
    'EVENT_FRAME_VERSION',
    'EVENT_EXECUTION_RESULT_VERSION',
    'EVENT_RUNTIME_CODES'
  ],
  'packages/runtime/src/internal/event-emission.js': [
    'EVENT_ADAPTER_VERSION',
    'EVENT_EMIT_CODES'
  ],
  'packages/runtime/src/host.js': [
    'RUNTIME_HOST_API_VERSION'
  ],
  'packages/host-runtime/src/runtime/native-crypto-verifier.js': [
    'NATIVE_CRYPTO_VERIFIER_VERSION'
  ],
  'packages/compiler/src/javascript-application-plan.js': [
    'JAVASCRIPT_APPLICATION_PLANNER_VERSION'
  ],
  'packages/provider-node/src/javascript/runtime-host.js': [
    'NODE_JAVASCRIPT_RUNTIME_HOST_VERSION'
  ],
  'packages/provider-node/src/events/reference-adapter.js': [
    'NODE_EVENT_REFERENCE_ADAPTER_VERSION',
    'NODE_EVENT_ADAPTER_CODES'
  ],
  'packages/provider-node/src/javascript/node-adapter.js': [
    'NODE_JAVASCRIPT_REQUEST_ADAPTER_VERSION'
  ],
  'packages/provider-node/src/javascript/lifecycle.js': [
    'NODE_JAVASCRIPT_LIFECYCLE_VERSION'
  ],
  'packages/provider-node/src/javascript/test-runtime.js': [
    'NODE_JAVASCRIPT_TEST_RUNTIME_VERSION'
  ],
  'packages/runtime/src/index.js': [
    'RUNTIME_API_VERSION',
    'ROUTER_API_VERSION'
  ],
  'packages/build-support/src/assemblyscript-compile.js': [
    'ASSEMBLYSCRIPT_COMPILE_VERSION'
  ],
  'packages/compiler/src/ast-json.js': [
    'TEXT_KINDS'
  ],
  'packages/compiler/src/cli-intents.js': [
    'CLI_ARTIFACTS_VERSION',
    'CLI_DOCTOR_VERSION',
    'CLI_EXPLAIN_VERSION',
    'CLI_INTENT_VERSION'
  ],
  'packages/cli/src/command-spec.js': [
    'COMMAND_SPEC_VERSION'
  ],
  'packages/cli/src/documentation.js': [
    'DOCUMENTATION_VERSION'
  ],
  'packages/cli/src/workflow.js': [
    'CLI_VERSION'
  ],
  'packages/cli/src/diagnostics.js': [
    'CLI_DIAGNOSTICS_VERSION',
    'DIAGNOSTIC_DEFINITIONS'
  ],
  'packages/cli/src/project-config-schema.js': [
    'PROJECT_CONFIG_SCHEMA_VERSION',
    'PROJECT_CONFIG_REFERENCE_VERSION',
    'CONFIG_FIELDS',
    'CONFIG_RUNTIME_RULES'
  ],
  'packages/cli/src/project-config.js': [
    'PROJECT_CONFIG_VERSION'
  ],
  'packages/cli/src/typescript-module-loader.js': [
    'TYPESCRIPT_MODULE_LOADER_VERSION',
    'PROJECT_HARNESS_VERSION'
  ],
  'packages/cli/src/workspace.js': [
    'WORKSPACE_DISCOVERY_VERSION',
    'PROJECT_WORKSPACE_VERSION'
  ],
  'packages/compiler/src/project-config-compiler.js': [
    'PROJECT_CONFIG_COMPILER_VERSION'
  ],
  'packages/compiler/src/events/event-topology.js': [
    'EVENT_TOPOLOGY_VERSION',
    'EVENT_OUTBOUND_REQUIREMENTS_VERSION'
  ],
  'packages/compiler/src/events/event-emit.js': [
    'EVENT_EMIT_CALLSITE_VERSION',
    'EVENT_EMIT_ANALYSIS_VERSION'
  ],
  'packages/compiler/src/project/reachable-graph-contract.js': [
    'COMPILER_REACHABLE_GRAPH_CONTRACT_VERSION'
  ],
  'packages/compiler/src/project/reachable-graph-implementation.js': [
    'COMPILER_REACHABLE_GRAPH_IMPLEMENTATION_VERSION'
  ],
  'packages/compiler/src/project/reachable-graph-builder.js': [
    'PROJECT_GRAPH_BUILDER_VERSION',
    'PROJECT_GRAPH_CONTEXT_VERSION'
  ],
  'packages/compiler/src/project/package-reachability.js': [
    'COMPILER_PACKAGE_REACHABILITY_VERSION'
  ],
  'packages/compiler/src/project/router-module-linker.js': [
    'ROUTER_MODULE_LINKER_VERSION'
  ],
  'packages/compiler/src/project-target-support.js': [
    'EVENT_TARGET_SUPPORT_VERSION'
  ],
  'packages/cli/src/project-execution.js': [
    'PROJECT_EXECUTION_VERSION',
    'EVENT_INSPECTION_VERSION'
  ],
  'packages/compiler/src/canonical-api-compiler.js': [
    'CANONICAL_API_COMPILER_VERSION'
  ],
  'packages/compiler/src/canonical-native-plan.js': [
    'CANONICAL_NATIVE_PLAN_COMPILER_VERSION',
    'FETCH_RESPONSE_METHODS',
    'EFFECT_STATIC_FIELDS'
  ],
  'packages/compiler/src/canonical-project-compiler.js': [
    'CANONICAL_PROJECT_COMPILER_VERSION'
  ],
  'packages/compiler/src/spine/router-control-contract.js': [
    'ROUTER_CONTROL_CONTRACT_VERSION'
  ],
  'packages/compiler/src/spine/async-surface-normalizer.js': [
    'ASYNC_SURFACE_NORMALIZER_VERSION'
  ],
  'packages/compiler/src/spine/router-handler-frontend.js': [
    'ROUTER_HANDLER_FRONTEND_VERSION'
  ],
  'packages/compiler/src/spine/router-handler-ir.js': [
    'ROUTER_HANDLER_IR_BUNDLE_VERSION'
  ],
  'packages/compiler/src/spine/router-topology-frontend.js': [
    'ROUTER_TOPOLOGY_FRONTEND_VERSION',
    'CANONICAL_ROUTER_COMPILER_VERSION',
    'CANONICAL_ROUTER_AUTHORING_VERSION',
    'CANONICAL_ROUTER_EXECUTION_VERSION',
    'SUPPORTED_ROUTE_METHODS',
    'DISALLOWED_OPERATION_KINDS'
  ],
  'packages/compiler/src/spine/diagnostic-authority.js': [
    'DIAGNOSTIC_AUTHORITY_VERSION'
  ],
  'packages/compiler/src/spine/handler-surface-authority.js': [
    'HANDLER_SURFACE_AUTHORITY_VERSION'
  ],
  'packages/compiler/src/spine/canonical-handler-ir.js': [
    'CANONICAL_HANDLER_IR_VERSION'
  ],
  'packages/compiler/src/spine/equivalence.js': [
    'PORTABLE_EQUIVALENCE_VERSION'
  ],
  'packages/compiler/src/spine/handler-ir.js': [
    'HANDLER_IR_VERSION',
    'HANDLER_IR_OPERATION_KINDS',
    'HANDLER_IR_EXTENSION_OPERATION_KINDS',
    'ROUTER_HANDLER_IR_OPERATION_KINDS',
    'ALL_HANDLER_IR_OPERATION_KINDS'
  ],
  'packages/compiler/src/spine/handler-ir-emitter.js': [
    'HANDLER_IR_EMITTER_VERSION'
  ],
  'packages/compiler/src/spine/plain-handler-frontend.js': [
    'PLAIN_HANDLER_FRONTEND_VERSION'
  ],
  'packages/compiler/src/spine/package-operation-seam.js': [
    'PACKAGE_OPERATION_RECOGNITION_VERSION',
    'PACKAGE_RESULT_ADAPTER_VERSION'
  ],
  'packages/compiler/src/spine/provider-requirement-authority.js': [
    'PROVIDER_REQUIREMENT_AUTHORITY_VERSION'
  ],
  'packages/wasm-guest-link/src/stage.js': [
    'GUEST_LINK_STAGE_INVOCATION_VERSION',
    'GUEST_LINK_STAGE_RESULT_VERSION',
    'GUEST_LINK_STAGE_INVOCATION_FIELDS',
    'GUEST_LINK_STAGE_RESULT_FIELDS',
    'FINAL_WASM_POLICY_FIELDS'
  ],
  'packages/compiler/src/codegen/dispatch-ts.js': [
    'DISPATCH_TS_VERSION'
  ],
  'packages/compiler/src/codegen/effect-composition.js': [
    'EFFECT_COMPOSITION_VERSION',
    'EFFECT_CONTINUATION_CONTRACT_VERSION',
    'EFFECT_PLAN_CONTRACT_VERSION',
    'TIMEOUT_SCOPE_POLICY_VERSION'
  ],
  'packages/compiler/src/codegen/effect-runtime.js': [
    'EFFECT_KINDS',
    'EFFECT_KIND_REGISTRY_VERSION',
    'EFFECT_RESUME_PROTOCOL_VERSION',
    'EFFECT_RUNTIME_CONTRACT_VERSION',
    'EFFECT_RUNTIME_VERSION',
    'EFFECT_TIMEOUT_POLICY_VERSION'
  ],
  'packages/compiler/src/codegen/execution-harness-ts.js': [
    'EXECUTION_HARNESS_VERSION'
  ],
  'packages/compiler/src/codegen/handler-bindings-ts.js': [
    'HANDLER_BINDINGS_VERSION'
  ],
  'packages/compiler/src/codegen/local-harness-ts.js': [
    'LOCAL_HARNESS_VERSION'
  ],
  'packages/compiler/src/codegen/pulse-wrapper.js': [
    'PULSE_BUILD_OUTPUT_VERSION',
    'PULSE_DEV_RUNTIME_VERSION',
    'WRAPPER_INTEGRATION_VERSION'
  ],
  'packages/host-runtime/src/compiler/compiled-wasm-runtime.js': [
    'COMPILED_WASM_HOST_RUNTIME_VERSION',
    'COMPILED_WASM_NODE_ADAPTER_VERSION',
    'COMPILED_WASM_RUNTIME_SMOKE_VERSION',
    'COMPILED_WASM_RUNTIME_VERSION'
  ],
  'packages/host-runtime/src/compiler/host-runtime-kernel.js': [
    'HOST_RUNTIME_KERNEL_VERSION'
  ],
  'packages/host-runtime/src/compiler/wasm-host-bridge.js': [
    'WASM_BRIDGE_VERSION'
  ],
  'packages/host-runtime/src/runtime/continuation-registry.js': [
    'CONTINUATION_REGISTRY_VERSION'
  ],
  'packages/host-runtime/src/runtime/canonical-api-runtime.js': [
    'CANONICAL_HOST_RUNTIME_VERSION',
    'SENSITIVE_FIELDS'
  ],
  'packages/provider-fastly/src/config-api.js': [
    'FASTLY_PROVIDER_API_VERSION'
  ],
  'packages/provider-fastly/src/runtime/canonical-api-runtime.js': [
    'CANONICAL_FASTLY_RUNTIME_VERSION'
  ],
  'packages/provider-fastly/src/build/canonical-target.js': [
    'FASTLY_CANONICAL_BUILD_VERSION'
  ],
  'packages/provider-fastly/src/build/entities-native.js': [
    'FASTLY_ENTITIES_NATIVE_REALIZATION_VERSION',
    'FASTLY_ENTITIES_NATIVE_SOURCE_VERSION',
    'ENTITIES_NATIVE_SOURCE_VERSION'
  ],
  'packages/provider-fastly/src/build/native-http-shell.js': [
    'FASTLY_NATIVE_HTTP_SHELL_VERSION',
    'FASTLY_NATIVE_HTTP_SHELL_GENERATOR_VERSION',
    'FASTLY_NATIVE_HTTP_SHELL_COMPILER_VERSION',
    'FASTLY_NATIVE_HTTP_SHELL_ABI_VERSION'
  ],
  'packages/provider-fastly/src/build/native-http-effects.js': [
    'FASTLY_NATIVE_HTTP_EFFECTS_VERSION',
    'FASTLY_NATIVE_HTTP_EFFECTS_GENERATOR_VERSION',
    'FASTLY_NATIVE_HTTP_EFFECTS_COMPILER_VERSION',
    'FASTLY_NATIVE_HTTP_EFFECTS_ABI_VERSION'
  ],
  'packages/provider-fastly/src/build/native-platform-capabilities.js': [
    'FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION',
    'FASTLY_NATIVE_PLATFORM_CAPABILITIES_GENERATOR_VERSION',
    'FASTLY_NATIVE_PLATFORM_CAPABILITIES_COMPILER_VERSION',
    'FASTLY_NATIVE_PLATFORM_CAPABILITIES_ABI_VERSION',
    'FASTLY_NATIVE_PLATFORM_CAPABILITIES_MAX_WASM_BYTES',
    'FASTLY_NATIVE_PLATFORM_CAPABILITIES_BUFFER_BYTES',
    'FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS',
    'FASTLY_NATIVE_PLATFORM_CAPABILITIES_REQUIRED_IMPORTS',
    'FASTLY_NATIVE_PLATFORM_CAPABILITIES_ALLOWED_IMPORTS',
    'FASTLY_NATIVE_PLATFORM_EFFECT_KINDS',
    'FASTLY_NATIVE_PLATFORM_CAPABILITY_KINDS'
  ],
  'packages/provider-fastly/src/compiler/lifecycle-parity-contract.js': [
    'FASTLY_LIFECYCLE_PARITY_PROOF_VERSION',
    'FASTLY_LIFECYCLE_PARITY_POLICY'
  ],
  'packages/provider-fastly/src/compiler/runtime-provider-shape.js': [
    'ALLOWED_PROVIDER_KINDS'
  ],
  'packages/provider-fastly/src/compiler/fastly-adapter.js': [
    'FASTLY_ADAPTER_VERSION',
    'FASTLY_DEPLOYMENT_READINESS_VERSION',
    'FASTLY_LOCAL_SMOKE_VERSION',
    'FASTLY_PACKAGING_SMOKE_VERSION',
    'FASTLY_STREAM_HEADER_ADAPTER_VERSION'
  ],
  'packages/provider-fastly/src/compiler/fastly-command-entry.js': [
    'FASTLY_COMMAND_ENTRY_VERSION',
    'FASTLY_COMMAND_IMPORT_AUDIT_VERSION',
    'FASTLY_COMMAND_SMOKE_VERSION',
    'FASTLY_SERVE_GATE_VERSION',
    'FASTLY_START_EXPORT_AUDIT_VERSION'
  ],
  'packages/provider-fastly/src/compiler/fastly-config-secret-serve.js': [
    'CONTRACT_VERSION',
    'READINESS_VERSION',
    'RUNTIME_VERSION',
    'SMOKE_VERSION'
  ],
  'packages/provider-fastly/src/compiler/fastly-hostcall-binding.js': [
    'FASTLY_BINDING_RISK_REPORT_VERSION',
    'FASTLY_HOSTCALL_BINDING_CONTRACT_VERSION',
    'FASTLY_HOSTCALL_MODULES_VERSION',
    'FASTLY_PACK_INPUTS_VERSION',
    'FASTLY_REF_LIFECYCLE_VERSION',
    'FASTLY_STREAM_BINDING_PLAN_VERSION'
  ],
  'packages/provider-fastly/src/compiler/fastly-readiness.js': [
    'FASTLY_ADAPTER_PLAN_VERSION',
    'FASTLY_CAPABILITY_MAP_VERSION',
    'FASTLY_HOSTCALL_MAP_VERSION',
    'FASTLY_PACKAGING_PLAN_VERSION',
    'FASTLY_READINESS_VERSION',
    'FASTLY_RISK_REPORT_VERSION',
    'FASTLY_SDK_AUDIT_VERSION'
  ],
  'packages/provider-fastly/src/runtime/provider-primitives-contract.js': [
    'FASTLY_PROVIDER_CONTRACT_VERSION'
  ],
  'packages/provider-node/src/compiler/node-adapter.js': [
    'NODE_ADAPTER_VERSION'
  ],
  'packages/provider-node/src/capabilities.js': [
    'NODE_CANONICAL_PROVIDER_CAPABILITIES',
    'NODE_NATIVE_TARGET_CAPABILITIES'
  ],
  'packages/provider-node/src/runtime/canonical-api-runtime.js': [
    'CANONICAL_NODE_RUNTIME_VERSION'
  ],
  'packages/schema-json/src/compiler/canonical-schema-codecs.js': [
    'CANONICAL_SCHEMA_BUNDLE_VERSION',
    'CANONICAL_SCHEMA_REGISTRY_VERSION',
    'CANONICAL_SCHEMA_CODECS_VERSION',
    'JAVASCRIPT_SCHEMA_CODEC_VERSION',
    'NATIVE_SCHEMA_CODEC_VERSION'
  ],
  'packages/schema-json/src/compiler/schema-registry.js': [
    'SCHEMA_REGISTRY_EXTRACTOR_VERSION',
    'HELPER_EXPORTS',
    'MARKER_EXPORTS'
  ],
  'packages/runtime-core-as/src/compiler/assemblyscript-core.js': [
    'ASSEMBLYSCRIPT_CORE_VERSION',
    'ASSEMBLYSCRIPT_HANDLERS_VERSION'
  ],
  'packages/runtime-core-as/src/compiler/assemblyscript-shape.js': [
    'ASSEMBLYSCRIPT_GENERATED_MANIFEST_VERSION',
    'ASSEMBLYSCRIPT_SHAPE_VERSION',
    'CHANNEL_CODES',
    'METHOD_CODES',
    'ROLE_CODES',
    'SEGMENT_CODES'
  ],
  'packages/runtime-core-as/src/compiler/assemblyscript-wasm-smoke.js': [
    'ASSEMBLYSCRIPT_WASM_SMOKE_VERSION'
  ],
  'packages/runtime-core-as/src/compiler/compiled-handlers.js': [
    'COMPILED_HANDLER_HARDENING_VERSION',
    'COMPILED_HANDLER_PLAN_VERSION',
    'COMPILED_HANDLER_SMOKE_VERSION',
    'HANDLER_LOWERING_REPORT_VERSION'
  ],
  'packages/runtime-core-as/src/compiler/integrated-compiled-app.js': [
    'INTEGRATED_COMPILED_APP_SMOKE_VERSION',
    'INTEGRATED_COMPILED_APP_VERSION',
    'INTEGRATED_LINK_REPORT_VERSION'
  ],
  'packages/runtime-core-as/src/compiler/canonical-native.js': [
    'CANONICAL_NATIVE_AS_GENERATOR_VERSION'
  ]
}).map(([file, identifiers]) => [file, toSet(identifiers)]));

const suspiciousIdentifierPattern = /\bconst\s+([A-Z][A-Z0-9_]*(?:(?:VERSION)|(?:POLICY)|(?:CODES)|(?:KINDS)|(?:OUTCOMES)|(?:TARGETS)|(?:METHODS)|(?:CAPABILITIES)|(?:MODES)|(?:TYPES)|(?:SURFACE)|(?:EXPORTS)|(?:DEFINITIONS)|(?:ALIASES)|(?:MARKERS)|(?:REGISTRY)|(?:MAP)|(?:FIELDS)|(?:RULES))[A-Z0-9_]*)\s*=/g;
const assetContractIdentifierPattern = /\bconst\s+(ASSETS_(?:(?:CONTRACT)|(?:NPM)|(?:LOWERABLE)|(?:PUBLIC)|(?:ALLOWED)|(?:SUPPORTED)|(?:RESERVED)|(?:RESPONSE)|(?:LOOKUP)|(?:PROVIDER)|(?:KEY)|(?:CACHE)|(?:PAYLOAD)|(?:LIBRARY)|(?:DIAGNOSTIC))[A-Z0-9_]*)\s*=/g;

const contractVersionLiterals = collectContractVersionLiterals();
const sourceFiles = sourceFilesOutsideContracts();

const seenLocalVersions = new Map();
for (const file of sourceFiles) {
  const fileRel = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  const allowedVersionsForFile = allowedLocalVersionLiterals.get(fileRel) || new Set();

  for (const hit of collectVersionLiterals(text)) {
    const seen = seenLocalVersions.get(fileRel) || new Set();
    seen.add(hit.literal);
    seenLocalVersions.set(fileRel, seen);

    if (contractVersionLiterals.has(hit.literal)) {
      assert.fail(
        `${fileRel}:${hit.line} duplicates contract-owned version literal ${hit.literal}; import it from contracts instead. Contract owner(s): ${contractVersionLiterals.get(hit.literal).join(', ')}`
      );
    }

    assert.ok(
      allowedVersionsForFile.has(hit.literal),
      `${fileRel}:${hit.line} defines unclassified local version literal ${hit.literal}; move stable cross-package contracts to wasm-contracts or add an explicit package-local/compiler-only classification in assert-hidden-contracts.cjs`
    );
  }

  const masked = maskStringsAndComments(text);
  const allowedIdentifiersForFile = allowedLocalIdentifierDefinitions.get(fileRel) || new Set();
  let assetMatch;
  while ((assetMatch = assetContractIdentifierPattern.exec(masked))) {
    const identifier = assetMatch[1];
    const line = lineForOffset(masked, assetMatch.index);
    assert.fail(`${fileRel}:${line} defines assets contract-shaped identifier ${identifier}; assets lowering constants must be owned by wasm-contracts/assets/contracts`);
  }

  let match;
  while ((match = suspiciousIdentifierPattern.exec(masked))) {
    const identifier = match[1];
    const line = lineForOffset(masked, match.index);
    assert.ok(
      allowedIdentifiersForFile.has(identifier),
      `${fileRel}:${line} defines unclassified uppercase contract-shaped identifier ${identifier}; move cross-package policy to contracts or classify it as package-local/compiler-only`
    );
  }
}

for (const [fileRel, expectedLiterals] of allowedLocalVersionLiterals) {
  const repoCandidate = path.join(repoRoot, fileRel);
  const file = fs.existsSync(repoCandidate) ? repoCandidate : path.join(wasmRoot, fileRel);
  assert.ok(fs.existsSync(file), `hidden-contract version allowlist file must exist: ${fileRel}`);
  const actual = seenLocalVersions.get(fileRel) || new Set();
  for (const literal of expectedLiterals) {
    assert.ok(actual.has(literal), `hidden-contract version allowlist is stale: ${fileRel} no longer contains ${literal}`);
  }
}

for (const [fileRel, expectedIdentifiers] of allowedLocalIdentifierDefinitions) {
  const repoCandidate = path.join(repoRoot, fileRel);
  const file = fs.existsSync(repoCandidate) ? repoCandidate : path.join(wasmRoot, fileRel);
  assert.ok(fs.existsSync(file), `hidden-contract identifier allowlist file must exist: ${fileRel}`);
  const masked = maskStringsAndComments(fs.readFileSync(file, 'utf8'));
  const actual = new Set(Array.from(masked.matchAll(suspiciousIdentifierPattern), (match) => match[1]));
  for (const identifier of expectedIdentifiers) {
    assert.ok(actual.has(identifier), `hidden-contract identifier allowlist is stale: ${fileRel} no longer defines ${identifier}`);
  }
}

console.log('ok - PulseWasm hidden contract scanner classifies non-contract versions and rejects duplicate contract literals');
