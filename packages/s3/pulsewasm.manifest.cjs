'use strict';
const { S3_PACKAGE, S3_CONTRACT_ID, S3_OPERATIONS } = require('@pulse-compute/wasm-contracts/s3/contracts');
module.exports = Object.freeze({
  version: 'pulsewasm.lowerable-library-manifest.v2', kind: 'pulsewasm.lowerable-library-manifest',
  contractId: S3_CONTRACT_ID, npmPackage: S3_PACKAGE, lowerableSubpath: S3_PACKAGE,
  facade: { namespace: 's3', import: S3_PACKAGE, symbols: ['head', 'getText'] },
  publicApi: { package: S3_PACKAGE, symbols: ['s3'], compatibilitySubpaths: [], loweringIntentionallyNarrow: true },
  compiler: { version: 'pulsewasm.lowerable-compiler-builder.v1', entry: './pulsewasm.compiler.cjs', export: 'buildS3LoweringPlan', artifact: 's3-lowering-plan.json', builderOwner: S3_PACKAGE, trust: 'first-party', inputs: ['typescript.SourceFile'] },
  modes: {
    typescript: { entry: './src/index.js' }, jsEngine: { entry: './src/index.js', behavior: 'reserved-with-diagnostic' },
    wasm: {
      mode: 'wasm-sidecar', sidecar: './as/read.as.ts',
      // The builder emits canonical effects. Both Native read realizations
      // compose the shared package-owned signing protocol, not a direct call.
      lowerings: Object.keys(S3_OPERATIONS).map((name) => ({ tsSymbol: `s3.${name}`, asSymbol: '__pulse_s3_sign', callShape: 'context-literal-binding-runtime-key', hostCapabilities: ['backend-fetch', 'body', 'clock', 'result'] })),
      hostCapabilities: ['backend-fetch', 'body', 'clock', 'result']
    }
  },
  policy: { packageOwnsFacadeMapping: true, canonicalRootLowering: true, automaticFallback: false }
});
