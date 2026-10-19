'use strict';

const pulseWasmManifest = Object.freeze({
  version: 'pulsewasm.lowerable-library-manifest.v2',
  kind: 'pulsewasm.lowerable-library-manifest',
  contractId: 'pulse.mcp',
  npmPackage: '@pulse-compute/mcp',
  lowerableSubpath: '@pulse-compute/mcp/pulse',
  facade: Object.freeze({
    namespace: 'mcp',
    import: '@pulse-compute/mcp/pulse',
    symbols: Object.freeze(['EntityRouter', 'jsonRpc', 'mcp'])
  }),
  publicApi: Object.freeze({
    package: '@pulse-compute/mcp',
    symbols: Object.freeze(['EntityRouter', 'jsonRpc', 'mcp']),
    compatibilitySubpaths: Object.freeze([]),
    loweringIntentionallyNarrow: true
  }),
  description: 'Package-owned compile-time extraction and bounded Native dispatch for EntityRouter declarations and one terminal request binding.',
  compiler: Object.freeze({
    version: 'pulsewasm.lowerable-compiler-builder.v1',
    entry: './pulsewasm.compiler.cjs',
    export: 'createMcpPackageCompilerBuilder',
    nativeApplicationExport: 'buildMcpNativeApplication',
    artifact: 'mcp-binding-plan.json',
    builderOwner: '@pulse-compute/mcp',
    trust: 'first-party',
    inputs: Object.freeze([
      'typescript.SourceFile',
      'pulsewasm.lowerable-library-manifest',
      'Entities composition contracts',
      'canonical schema bundle'
    ])
  }),
  modes: Object.freeze({
    typescript: Object.freeze({ entry: './src/pulse.js' }),
    jsEngine: Object.freeze({
      entry: './src/pulse.js',
      behavior: 'javascript-package-runtime'
    }),
    wasm: Object.freeze({
      mode: 'implemented-now',
      sidecar: './as/mcp.as.ts',
      sidecarStatus: 'implemented-now',
      sourceContribution: Object.freeze({
        entry: './pulsewasm.native.cjs',
        export: 'buildMcpNativeSource',
        id: 'pulse-mcp-native-as',
        language: 'assemblyscript',
        semanticOwner: '@pulse-compute/mcp',
        providerAuthority: Object.freeze([
          'request',
          'effect-execution',
          'logging',
          'response-transport'
        ])
      }),
      lowerings: Object.freeze([
        Object.freeze({
          tsSymbol: 'mcp.handle',
          asSymbol: 'pulse_mcp_handle',
          callShape: 'terminal-request-bound-static-plan',
          hostCapabilities: Object.freeze([])
        })
      ]),
      hostCapabilities: Object.freeze([])
    })
  }),
  protocol: Object.freeze({
    contractId: 'pulse.mcp',
    planVersion: 'pulse.mcp-binding-plan.v1',
    catalogVersion: 'pulse.mcp-catalog.v1',
    payloadRulesOwner: '@pulse-compute/wasm-contracts/entities/contracts'
  }),
  policy: Object.freeze({
    loweringIntentionallyNarrow: true,
    packageOwnsFacadeMapping: true,
    canonicalRootLowering: true,
    staticDeclarationsOnly: true,
    oneRouterPerBinding: true,
    terminalBindingOnly: true,
    nativeDispatcherImplemented: true,
    nativeSourceGeneratorImplemented: true,
    javascriptDispatcherImplemented: true,
    providerAuthorityAdded: false,
    packageTargetPromoted: true,
    automaticFallback: false
  })
});

module.exports = pulseWasmManifest;
