'use strict';

const pulseWasmManifest = Object.freeze({
  version: 'pulsewasm.lowerable-library-manifest.v2',
  kind: 'pulsewasm.lowerable-library-manifest',
  contractId: 'pulse.entities',
  npmPackage: '@pulse-compute/entities',
  lowerableSubpath: '@pulse-compute/entities',
  facade: Object.freeze({
    namespace: 'entities',
    import: '@pulse-compute/entities',
    symbols: Object.freeze(['EntityRouter', 'jsonRpc'])
  }),
  publicApi: Object.freeze({
    package: '@pulse-compute/entities',
    symbols: Object.freeze(['EntityRouter', 'jsonRpc']),
    compatibilitySubpaths: Object.freeze([]),
    loweringIntentionallyNarrow: true
  }),
  description: 'Package-owned compile-time extraction and bounded Native dispatch for EntityRouter declarations and one terminal request binding.',
  compiler: Object.freeze({
    version: 'pulsewasm.lowerable-compiler-builder.v1',
    entry: './pulsewasm.compiler.cjs',
    export: 'createEntitiesPackageCompilerBuilder',
    artifact: 'entities-lowering-plan.json',
    builderOwner: '@pulse-compute/entities',
    trust: 'first-party',
    inputs: Object.freeze([
      'typescript.SourceFile',
      'pulsewasm.lowerable-library-manifest',
      'pulse.entities contracts',
      'canonical schema bundle'
    ])
  }),
  modes: Object.freeze({
    typescript: Object.freeze({ entry: './dist/index.js' }),
    jsEngine: Object.freeze({
      entry: './dist/index.js',
      behavior: 'javascript-package-runtime'
    }),
    wasm: Object.freeze({
      mode: 'implemented-now',
      sidecar: './as/index.as.ts',
      sidecarStatus: 'implemented-now',
      sourceContribution: Object.freeze({
        entry: './pulsewasm.native.cjs',
        export: 'buildEntitiesNativeSource',
        id: 'pulse-entities-native-as',
        language: 'assemblyscript',
        semanticOwner: '@pulse-compute/entities',
        providerAuthority: Object.freeze([
          'request',
          'effect-execution',
          'logging',
          'response-transport'
        ])
      }),
      lowerings: Object.freeze([
        Object.freeze({
          tsSymbol: 'EntityRouter.handle',
          asSymbol: 'pulse_entities_handle',
          callShape: 'terminal-request-bound-static-plan',
          hostCapabilities: Object.freeze([])
        })
      ]),
      hostCapabilities: Object.freeze([])
    })
  }),
  protocol: Object.freeze({
    contractId: 'pulse.entities',
    planVersion: 'pulse.entities-lowering-plan.v1',
    catalogVersion: 'pulse.entities-catalog.v1',
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
