'use strict';

const { normalizeDiagnostic } = require('../diagnostics.js');
const {
  LIBRARY_CONTRACT_VERSION,
  ALLOWED_HOST_CAPABILITIES,
  normalizeContractModeKeys
} = require('./contracts.js');
const LIBRARY_SIDECAR_PHASE = '12C';
const LIBRARY_SIDECAR_CONSUMPTION_VERSION = 'pulsewasm.library-sidecar-consumption.v1';
const CTX_EXTENSION_SCOPE_MAP_VERSION = 'pulsewasm.ctx-extension-scope-map.v1';
const LIBRARY_SIDECAR_SMOKE_VERSION = 'pulsewasm.library-sidecar-smoke.v1';

function makeDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({
    phase: 'library-sidecars',
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: { file: '<library-sidecars>' }
  });
}

function defaultCtxExtensionContract() {
  return {
    version: LIBRARY_CONTRACT_VERSION,
    package: 'pulse.test-extension',
    description: 'Phase 12C fixture contract proving declared ctx extension installation, scope checking, AS sidecar linking, and lowering.',
    modes: {
      typescript: { entry: './dist/index.js' },
      jsEngine: { entry: './dist/index.js' },
      wasm: {
        mode: 'wasm-sidecar',
        sidecar: './as/index.as.ts',
        hostCapabilities: ['headers', 'result'],
        lowerings: [
          {
            tsSymbol: 'ctx.test.mark',
            asSymbol: 'pulse_test_mark',
            callShape: 'ctx-extension-literal-string',
            hostCapabilities: ['headers', 'result']
          }
        ],
        ctxExtensions: [
          {
            namespace: 'test',
            installedBy: { kind: 'middleware', tsSymbol: 'testExtension' },
            methods: [
              {
                tsPath: 'ctx.test.mark',
                asSymbol: 'pulse_test_mark',
                callShape: 'literal-string',
                hostCapabilities: ['headers', 'result']
              }
            ]
          }
        ]
      }
    },
    policy: {
      fixtureOnly: true,
      inferredCompatibility: false,
      arbitraryTsCompilation: false,
      sidecarRequiredForWasm: true,
      scopeCheckedCtxExtension: true,
      realGripSemanticsImplemented: false,
      assetsImplemented: false
    }
  };
}

function validateCtxExtensions(contract) {
  const diagnostics = [];
  const modes = normalizeContractModeKeys(contract.modes);
  const wasm = modes.wasm || {};
  const extensions = Array.isArray(wasm.ctxExtensions) ? wasm.ctxExtensions : [];
  for (const extension of extensions) {
    if (!extension || typeof extension.namespace !== 'string' || extension.namespace.length === 0) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_LIBRARY_CTX_EXTENSION_NAMESPACE_REQUIRED',
        `Library ${contract.package || '<unknown>'} declares a ctx extension without a static namespace.`,
        'Declare modes.wasm.ctxExtensions[].namespace as a static string.',
        { package: contract.package, extension }
      ));
      continue;
    }
    if (!extension.installedBy || extension.installedBy.kind !== 'middleware' || typeof extension.installedBy.tsSymbol !== 'string') {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_LIBRARY_CTX_EXTENSION_INSTALLER_REQUIRED',
        `ctx.${extension.namespace} must declare the middleware symbol that installs it.`,
        'Declare installedBy: { kind: "middleware", tsSymbol: "..." } for compiled-Wasm scope tracking.',
        { package: contract.package, extension }
      ));
    }
    const methods = Array.isArray(extension.methods) ? extension.methods : [];
    if (methods.length === 0) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_LIBRARY_CTX_EXTENSION_METHODS_REQUIRED',
        `ctx.${extension.namespace} declares no lowerable methods.`,
        'Declare at least one methods[] entry with tsPath and asSymbol.',
        { package: contract.package, extension }
      ));
    }
    for (const method of methods) {
      if (!method || typeof method.tsPath !== 'string' || typeof method.asSymbol !== 'string') {
        diagnostics.push(makeDiagnostic(
          'PULSEWASM_LIBRARY_CTX_EXTENSION_METHOD_INVALID',
          `ctx.${extension.namespace} declares an invalid extension method.`,
          'Each method must include static tsPath and asSymbol strings.',
          { package: contract.package, extension, method }
        ));
      }
      for (const capability of method.hostCapabilities || []) {
        if (!ALLOWED_HOST_CAPABILITIES.includes(capability)) {
          diagnostics.push(makeDiagnostic(
            'PULSEWASM_LIBRARY_CTX_EXTENSION_UNKNOWN_CAPABILITY',
            `ctx.${extension.namespace}.${method && method.tsPath ? method.tsPath : '<method>'} requires unknown host capability ${JSON.stringify(capability)}.`,
            `Use one of: ${ALLOWED_HOST_CAPABILITIES.join(', ')}.`,
            { package: contract.package, capability }
          ));
        }
      }
    }
  }
  return { extensions, diagnostics };
}

function ctxExtensionValidationExamples() {
  return [
    { source: 'ctx.test.mark("ok")', status: 'allowed-in-installed-scope', lowering: 'pulse_test_mark(ctx, "ok")' },
    { source: 'ctx.test.mark("ok")', status: 'rejected-outside-installed-scope', diagnostic: 'PULSEWASM_CTX_EXTENSION_NOT_IN_SCOPE' },
    { source: 'ctx.anythingElse.foo()', status: 'rejected-undeclared-extension', diagnostic: 'PULSEWASM_CTX_EXTENSION_UNDECLARED' },
    { source: 'const t = ctx.test; t.mark("ok")', status: 'rejected-extension-aliasing', diagnostic: 'PULSEWASM_CTX_EXTENSION_ESCAPE_UNSUPPORTED' }
  ];
}

module.exports = {
  LIBRARY_SIDECAR_PHASE,
  LIBRARY_SIDECAR_CONSUMPTION_VERSION,
  CTX_EXTENSION_SCOPE_MAP_VERSION,
  LIBRARY_SIDECAR_SMOKE_VERSION,
  defaultCtxExtensionContract,
  validateCtxExtensions,
  ctxExtensionValidationExamples
};
