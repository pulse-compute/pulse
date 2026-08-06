'use strict';

const pulseWasmManifest = Object.freeze({
  version: 'pulsewasm.lowerable-library-manifest.v2',
  kind: 'pulsewasm.lowerable-library-manifest',
  contractId: 'pulse.assets',
  npmPackage: '@pulse-compute/assets',
  lowerableSubpath: '@pulse-compute/assets',
  facade: Object.freeze({
    namespace: 'assets',
    import: '@pulse-compute/assets',
    symbols: Object.freeze(['lookup', 'respond'])
  }),
  publicApi: Object.freeze({
    package: '@pulse-compute/assets',
    symbols: Object.freeze(['AssetBucket', 'AssetManager', 'assets', 'createAssets', 'lookup', 'respond', 'signSigV4']),
    compatibilitySubpaths: Object.freeze(['@pulse-compute/assets/pulsewasm']),
    loweringIntentionallyNarrow: true
  }),
  description: 'Package-owned PulseWasm lowerable manifest for static/host-backed asset response helpers.',
  compiler: Object.freeze({
    version: 'pulsewasm.lowerable-compiler-builder.v1',
    entry: './pulsewasm.compiler.cjs',
    export: 'buildAssetsLoweringPlan',
    artifact: 'assets-lowering-plan.json',
    builderOwner: '@pulse-compute/assets',
    trust: 'first-party',
    inputs: Object.freeze([
      'typescript.SourceFile',
      'pulsewasm.lowerable-library-manifest',
      'pulse.assets contracts'
    ])
  }),
  modes: Object.freeze({
    typescript: Object.freeze({ entry: './dist/index.js' }),
    jsEngine: Object.freeze({ entry: './dist/index.js', behavior: 'javascript-package-runtime' }),
    wasm: Object.freeze({
      mode: 'wasm-sidecar',
      sidecar: './as/index.as.ts',
      lowerings: Object.freeze([
        Object.freeze({ tsSymbol: 'assets.lookup', asSymbol: 'pulse_assets_lookup', callShape: 'literal-store-path', hostCapabilities: Object.freeze(['assets', 'headers', 'result']) }),
        Object.freeze({ tsSymbol: 'assets.respond', asSymbol: 'pulse_assets_respond', callShape: 'asset-handle', hostCapabilities: Object.freeze(['assets', 'headers', 'result', 'body']) })
      ]),
      hostCapabilities: Object.freeze(['assets', 'headers', 'result', 'body', 'clock'])
    })
  }),
  protocol: Object.freeze({
    contractId: 'pulse.assets',
    payloadRulesOwner: '@pulse-compute/wasm-contracts/assets/contracts'
  }),
  policy: Object.freeze({
    effectRuntimeRequired: true,
    loweringIntentionallyNarrow: true,
    packageOwnsFacadeMapping: true,
    binaryBodyStillReserved: true,
    payloadModesExplicit: true
  })
});

module.exports = pulseWasmManifest;
