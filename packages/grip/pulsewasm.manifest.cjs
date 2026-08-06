'use strict';

const pulseWasmManifest = Object.freeze({
  version: 'pulsewasm.lowerable-library-manifest.v2',
  kind: 'pulsewasm.lowerable-library-manifest',
  contractId: 'pulse.grip',
  npmPackage: '@pulse-compute/grip',
  lowerableSubpath: '@pulse-compute/grip',
  facade: Object.freeze({
    namespace: 'grip',
    import: '@pulse-compute/grip',
    symbols: Object.freeze(['broadcast', 'handoff', 'isWebSocket', 'subscribe'])
  }),
  publicApi: Object.freeze({
    package: '@pulse-compute/grip',
    symbols: Object.freeze(['broadcast', 'grip', 'handoff', 'isWebSocket', 'subscribe']),
    compatibilitySubpaths: Object.freeze(['@pulse-compute/grip/pulsewasm']),
    loweringIntentionallyNarrow: true
  }),
  description: 'Package-owned Native lowering manifest for bounded stateless GRIP framing and request-bound broadcast.',
  compiler: Object.freeze({
    version: 'pulsewasm.lowerable-compiler-builder.v1',
    entry: './pulsewasm.compiler.cjs',
    export: 'buildGripLoweringPlan',
    artifact: 'grip-lowering-plan.json',
    builderOwner: '@pulse-compute/grip',
    trust: 'first-party',
    inputs: Object.freeze([
      'typescript.SourceFile',
      'pulsewasm.lowerable-library-manifest',
      'pulse.grip contracts'
    ])
  }),
  modes: Object.freeze({
    typescript: Object.freeze({ entry: './dist/index.js' }),
    jsEngine: Object.freeze({ entry: './dist/index.js', behavior: 'javascript-package-runtime' }),
    wasm: Object.freeze({
      mode: 'wasm-sidecar',
      sidecar: './as/index.as.ts',
      lowerings: Object.freeze([
        Object.freeze({ tsSymbol: 'grip.isWebSocket', asSymbol: 'pulse_grip_is_websocket', callShape: 'request-classification', hostCapabilities: Object.freeze(['headers']) }),
        Object.freeze({ tsSymbol: 'grip.subscribe', asSymbol: 'pulse_grip_subscribe', callShape: 'response-static-options', hostCapabilities: Object.freeze(['headers', 'result']) }),
        Object.freeze({ tsSymbol: 'grip.handoff', asSymbol: 'pulse_grip_handoff', callShape: 'static-options', hostCapabilities: Object.freeze(['headers', 'result']) }),
        Object.freeze({ tsSymbol: 'grip.broadcast', asSymbol: 'pulse_grip_broadcast', callShape: 'context-static-message', hostCapabilities: Object.freeze(['broadcaster']) }),
        Object.freeze({ tsSymbol: 'grip.hold', asSymbol: 'pulse_grip_hold', callShape: 'literal-mode', hostCapabilities: Object.freeze(['headers']) }),
        Object.freeze({ tsSymbol: 'grip.channel', asSymbol: 'pulse_grip_channel', callShape: 'literal-channel', hostCapabilities: Object.freeze(['headers', 'channel', 'broadcaster']) }),
        Object.freeze({ tsSymbol: 'grip.publish', asSymbol: 'pulse_grip_publish', callShape: 'declared-channel-message', hostCapabilities: Object.freeze(['broadcaster', 'clock']) })
      ]),
      hostCapabilities: Object.freeze(['headers', 'channel', 'broadcaster', 'clock', 'result'])
    })
  }),
  protocol: Object.freeze({
    contractId: 'pulse.grip',
    payloadRulesOwner: '@pulse-compute/wasm-contracts/grip/contracts'
  }),
  policy: Object.freeze({
    effectRuntimeRequired: true,
    providerRuntimeImplemented: true,
    loweringIntentionallyNarrow: true,
    packageOwnsFacadeMapping: true,
    betaProofOnly: false,
    canonicalRootLowering: true,
    statelessFraming: true,
    arbitraryChannelExpressions: false,
    arbitraryPublishPayloads: false,
    automaticFallback: false
  })
});

module.exports = pulseWasmManifest;
