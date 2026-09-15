'use strict';
module.exports = Object.freeze({
  version: 'pulsewasm.lowerable-library-manifest.v2', kind: 'pulsewasm.lowerable-library-manifest',
  contractId: 'pulse.crypto', npmPackage: '@pulse-compute/crypto', lowerableSubpath: '@pulse-compute/crypto',
  facade: { namespace: 'crypto', import: '@pulse-compute/crypto', symbols: ['digestText'] },
  publicApi: { package: '@pulse-compute/crypto', symbols: ['crypto', 'digestText'], compatibilitySubpaths: [], loweringIntentionallyNarrow: true },
  compiler: { version: 'pulsewasm.lowerable-compiler-builder.v1', entry: './pulsewasm.compiler.cjs', export: 'buildCryptoLoweringPlan', artifact: 'crypto-lowering-plan.json', builderOwner: '@pulse-compute/crypto', trust: 'first-party', inputs: ['typescript.SourceFile'] },
  modes: {
    typescript: { entry: './dist/index.js' }, jsEngine: { entry: './dist/index.js', behavior: 'provider-dependent' },
    wasm: { mode: 'wasm-sidecar', sidecar: './as/digest-text.as.ts',
      lowerings: [{ tsSymbol: 'crypto.digestText', asSymbol: '__pulse_crypto_digest_text', callShape: 'context-runtime-text', hostCapabilities: ['result'] }],
      hostCapabilities: ['result'] }
  },
  policy: { packageOwnsFacadeMapping: true, canonicalRootLowering: true, automaticFallback: false }
});
