'use strict';

const pulseWasmManifest = Object.freeze({
  version: 'pulsewasm.lowerable-library-manifest.v2',
  kind: 'pulsewasm.lowerable-library-manifest',
  contractId: 'pulse.jwt',
  npmPackage: '@pulse-compute/jwt',
  lowerableSubpath: '@pulse-compute/jwt',
  facade: Object.freeze({
    namespace: 'jwt',
    import: '@pulse-compute/jwt',
    symbols: Object.freeze(['bearer', 'verify', 'sign'])
  }),
  publicApi: Object.freeze({
    package: '@pulse-compute/jwt',
    symbols: Object.freeze([
      'JWT_ERROR_CODES',
      'JwtError',
      'bearer',
      'jwt',
      'verify',
      'sign'
    ]),
    compatibilitySubpaths: Object.freeze([]),
    loweringIntentionallyNarrow: true
  }),
  description: 'Package-owned Native lowering contract for bounded, provider-neutral JWT verification and HS256 signing.',
  compiler: Object.freeze({
    version: 'pulsewasm.lowerable-compiler-builder.v1',
    entry: './pulsewasm.compiler.cjs',
    export: 'buildJwtLoweringPlan',
    artifact: 'jwt-lowering-plan.json',
    builderOwner: '@pulse-compute/jwt',
    trust: 'first-party',
    inputs: Object.freeze([
      'typescript.SourceFile',
      'pulsewasm.lowerable-library-manifest',
      'pulse.jwt contracts',
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
      mode: 'wasm-sidecar',
      sidecar: './as/index.as.ts',
      sourceContribution: Object.freeze({
        entry: './pulsewasm.native.cjs',
        export: 'pulseJwtAssemblyScriptSource',
        id: 'pulse-jwt-as',
        language: 'assemblyscript',
        semanticOwner: '@pulse-compute/jwt',
        providerAuthority: Object.freeze([
          'request',
          'secret',
          'wall-clock',
          'schema',
          'redaction',
          'error-transport'
        ])
      }),
      lowerings: Object.freeze([
        Object.freeze({ tsSymbol: 'jwt.sign', asSymbol: 'pulse_jwt_sign', callShape: 'claims-static-sign-policy', hostCapabilities: Object.freeze(['clock', 'result']) }),
        Object.freeze({
          tsSymbol: 'jwt.verify',
          asSymbol: 'pulse_jwt_verify',
          callShape: 'request-bearer-static-policy',
          hostCapabilities: Object.freeze([
            'clock',
            'headers',
            'result'
          ])
        })
      ]),
      hostCapabilities: Object.freeze([
        'clock',
        'headers',
        'result'
      ]),
      realization: Object.freeze({
        kind: 'crypto-composed',
        semanticOwner: '@pulse-compute/crypto',
        realization: 'guest-source:pulse-hmac-as',
        implementation: 'pulse-hmac-as.v1',
        packageSource: 'pulse-jwt-as',
        algorithms: Object.freeze(['HS256', 'ES256', 'RS256']),
        keyTypes: Object.freeze(['secret', 'jwk', 'jwks']),
        guestUnitRequired: false,
        guestUnits: Object.freeze({
          ES256: 'pulse.crypto.es256.rustcrypto-p256.v1', RS256: 'pulse.crypto.es256.rustcrypto-p256.v1'
        }),
        portable: true,
        automaticFallback: false
      })
    })
  }),
  protocol: Object.freeze({
    contractId: 'pulse.jwt',
    payloadRulesOwner: '@pulse-compute/wasm-contracts/jwt/contracts'
  }),
  policy: Object.freeze({
    effectRuntimeRequired: true,
    providerRuntimeImplemented: true,
    loweringIntentionallyNarrow: true,
    packageOwnsFacadeMapping: true,
    canonicalRootLowering: true,
    tokenSourceStatic: true,
    policyStatic: true,
    targetBindingRequired: true,
    nativeRealizationImplemented: true,
    automaticFallback: false
  })
});

module.exports = pulseWasmManifest;
