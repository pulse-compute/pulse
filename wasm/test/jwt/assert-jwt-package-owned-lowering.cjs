#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
process.chdir(repoRoot);

const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');
const packageContracts = require('../../packages/contracts/src/package/package-contract.js');
const manifestContracts = require('../../packages/contracts/src/library/manifest.js');
const {
  defineCryptoTargetCapabilities,
  normalizeCryptoConfiguration
} = require('../../packages/contracts/src/crypto/contracts.js');
const jwtManifest = require('../../../packages/jwt/pulsewasm.manifest.cjs');
const jwtLowering = require('../../../packages/jwt/pulsewasm.compiler.cjs');
const {
  discoverLowerableLibraryManifests,
  loadLowerableCompilerBuilder
} = require('../../packages/library-kit/src/compiler/handler-library-contracts.js');
const {
  buildPackageOwnedLoweringPlan
} = require('../../packages/library-kit/src/compiler/package-lowering.js');
const {
  compileCanonicalProject
} = require('../../packages/compiler/src/canonical-project-compiler.js');
const {
  lowerCanonicalPackageOperations,
  packageOperationRecognitionForCompiled
} = require('../../packages/compiler/src/spine/package-operation-seam.js');
const {
  classifyFastlyJavascriptCapability,
  classifyFastlyJavascriptProviderRequirement
} = require('../../../packages/provider-fastly/src/javascript/target-support-policy.js');

const SECRET_BINDING = 'JWT_D3_SECRET_BINDING';

function schemaBundle(ids = ['auth.AccessClaims'], realized = ids) {
  return {
    declaredSchemaIds: ids,
    schemaIds: ids,
    registryIrVersion: 'test.schema-registry.v1',
    fullCodecRealization: realized.length === ids.length,
    registry: { schemas: realized.map((id) => ({ id })) }
  };
}

function options(schema = true) {
  return `{
    algorithms: ['HS256'],
    key: { type: 'secret', binding: '${SECRET_BINDING}' },
    issuer: 'https://issuer.example',
    audience: ['pulse-api'],
    requiredClaims: ['sub'],
    ${schema ? "claimsSchema: 'auth.AccessClaims'," : ''}
  }`;
}

function sourceWith(policy = options(), token = 'jwt.bearer(ctx.req)', placement = 'variable') {
  const call = `jwt.verify(ctx, ${token}, ${policy})`;
  const body = placement === 'return'
    ? `return ${call}`
    : placement === 'parallel'
      ? `const { verified } = await ctx.parallel({ verified: ${call} }); return ctx.text(verified.claims.sub)`
      : placement === 'unawaited'
        ? `const verified = ${call}; return ctx.text(verified.claims.sub)`
        : `const verified = await ${call}; return ctx.text(verified.claims.sub)`;
  return `import { jwt } from '@pulse-compute/jwt'
export default async function handler(ctx) {
  ${body}
}
`;
}

function build(source, extra = {}) {
  return jwtLowering.buildJwtLoweringPlan({
    cwd: repoRoot,
    sourcePath: 'src/index.ts',
    sourceText: source,
    schemaBundle: schemaBundle(),
    ...extra
  });
}

function expectCode(source, code, extra = {}) {
  const result = build(source, extra);
  assert.equal(result.artifact.status, 'error', `expected ${code}`);
  assert.ok(
    result.diagnostics.some((entry) => entry.code === code),
    `expected ${code}; got ${result.diagnostics.map((entry) => entry.code).join(', ')}`
  );
  return result;
}

const manifestValidation = manifestContracts.validateLowerableLibraryManifest(jwtManifest);
assert.equal(manifestValidation.status, 'ok');
assert.equal(jwtManifest.contractId, jwtContracts.JWT_CONTRACT_ID);
assert.equal(jwtManifest.compiler.export, 'buildJwtLoweringPlan');
assert.equal(jwtManifest.modes.wasm.realization.kind, 'crypto-composed');
assert.equal(jwtManifest.modes.wasm.realization.semanticOwner, '@pulse-compute/crypto');
assert.equal(jwtManifest.modes.wasm.realization.realization, 'guest-source:pulse-hmac-as');
assert.equal(jwtManifest.modes.wasm.realization.implementation, 'pulse-hmac-as.v1');
assert.deepEqual(jwtManifest.modes.wasm.realization.algorithms, ['HS256', 'ES256']);
assert.deepEqual(jwtManifest.modes.wasm.realization.keyTypes, ['secret', 'jwk', 'jwks']);
assert.equal(jwtManifest.modes.wasm.realization.guestUnitRequired, false);
assert.equal(jwtManifest.modes.wasm.realization.automaticFallback, false);
assert.equal(jwtManifest.modes.wasm.sourceContribution.id, 'pulse-jwt-as');
assert.equal(
  jwtManifest.modes.wasm.sourceContribution.semanticOwner,
  '@pulse-compute/jwt'
);

const jwtProduct = packageContracts.normalizePackageContract(JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'packages', 'jwt', 'pulse.package.json'), 'utf8')
));
assert.deepEqual(jwtProduct.targets.native.providerRequirements, [
  'jwt.sign',
  'jwt.verify',
  'jwt.verify.es256',
  'jwt.verify.hs256',
  'secret.get',
  'time.wall-clock'
]);
assert.equal(jwtProduct.targets.native.status, 'provider-dependent');
assert.equal(jwtProduct.targets.javascript.status, 'provider-dependent');

assert.equal(classifyFastlyJavascriptCapability('jwt.verify.hs256').status, 'eligible');
assert.equal(classifyFastlyJavascriptProviderRequirement('time.wall-clock').status, 'eligible');
assert.equal(classifyFastlyJavascriptCapability('jwt.verify.rs256').status, 'blocked');

const discovered = discoverLowerableLibraryManifests({
  cwd: repoRoot,
  workspaceRoot: repoRoot,
  scanNodeModules: false
}).find((entry) => entry.manifest.contractId === jwtContracts.JWT_CONTRACT_ID);
assert.ok(discovered);
assert.equal(discovered.validation.status, 'ok');
const loaded = loadLowerableCompilerBuilder(discovered);
assert.equal(loaded.exportName, 'buildJwtLoweringPlan');
assert.equal(typeof loaded.builder, 'function');
assert.equal(jwtLowering.jwtLoweringBuilder.owner, '@pulse-compute/jwt');

const targetDescriptor = {
  id: 'proof-native',
  mode: 'native',
  capabilities: [
    'jwt.verify',
    'jwt.verify.hs256',
    'secret.get',
    'time.wall-clock'
  ],
  crypto: defineCryptoTargetCapabilities({
    target: 'native',
    algorithms: [{
      algorithm: 'HS256',
      realization: 'guest-source:pulse-hmac-as',
      implemented: true,
      status: 'implemented-c3'
    }]
  })
};

const direct = build(sourceWith());
assert.equal(direct.artifact.status, 'ok');
assert.equal(direct.canonicalEffects.length, 1);
assert.equal(direct.canonicalIntrinsics.length, 1);
assert.equal(direct.schemaReferences.length, 1);
assert.equal(Object.hasOwn(direct.entries[0], 'target'), false);
assert.deepEqual(direct.entries[0].providerRequirements, [
  'jwt.verify',
  'time.wall-clock',
  'jwt.verify.hs256',
  'secret.get',
  'schema.decode'
]);
assert.deepEqual(direct.cryptoRequirements, [{
  version: packageContracts.PACKAGE_CRYPTO_REQUIREMENT_VERSION,
  requestedBy: '@pulse-compute/jwt',
  semanticOwner: '@pulse-compute/crypto',
  reachable: true,
  algorithms: ['HS256']
}]);
assert.equal(direct.canonicalEffects[0].payload.token.kind, 'bearer-request-header');
assert.deepEqual(direct.canonicalEffects[0].payload.algorithms, ['HS256']);
assert.equal(direct.canonicalEffects[0].payload.claimsSchema, 'auth.AccessClaims');
assert.equal(Object.hasOwn(direct.canonicalEffects[0].payload, 'key'), false);
assert.deepEqual(direct.canonicalEffects[0].resource, {
  keyType: 'secret',
  keyArtifactId: null,
  secretBinding: SECRET_BINDING
});
assert.deepEqual(direct.keyArtifacts, []);
assert.deepEqual(direct.realizationArtifacts, []);
const directText = JSON.stringify(direct.artifact);
assert.doesNotMatch(directText, /secret-material|token-value/i);
assert.match(directText, /rawTokenExcludedFromPlan/);

const generic = buildPackageOwnedLoweringPlan({
  cwd: repoRoot,
  workspaceRoot: repoRoot,
  contractId: 'pulse.jwt',
  sourcePath: 'src/index.ts',
  sourceText: sourceWith(),
  schemaBundle: schemaBundle(),
  targetDescriptor: Object.freeze({
    id: 'must-not-cross-package-builder-boundary',
    mode: 'native',
    capabilities: Object.freeze([])
  })
});
assert.equal(generic.artifact.status, 'ok');
assert.equal(generic.version, packageContracts.PACKAGE_BUILDER_RESULT_VERSION);
assert.deepEqual(
  generic.contributions.canonicalEffects,
  direct.canonicalEffects.map((entry) => packageContracts.normalizeCanonicalPackageEffect(entry, {
    contractId: jwtManifest.contractId,
    npmPackage: jwtManifest.npmPackage,
    lowerableSubpath: jwtManifest.lowerableSubpath
  }))
);
assert.equal(Object.hasOwn(generic, 'targetDescriptor'), false);
assert.equal(Object.hasOwn(generic.artifact.entries[0], 'target'), false);

const importShapes = [
  `import jwt from '@pulse-compute/jwt'
export default async function handler(ctx) {
  return jwt.verify(ctx, jwt.bearer(ctx.req), { algorithms: ['HS256'], key: { type: 'secret', binding: '${SECRET_BINDING}' } })
}`,
  `import * as auth from '@pulse-compute/jwt'
export default async function handler(ctx) {
  const verified = await auth.verify(ctx, auth.bearer(ctx.req), { algorithms: ['HS256'], key: { type: 'secret', binding: '${SECRET_BINDING}' } })
  return ctx.text(verified.claims.sub)
}`,
  `import { verify as verifyJwt, bearer as bearerJwt } from '@pulse-compute/jwt'
export default async function handler(ctx) {
  const verified = await verifyJwt(ctx, bearerJwt(ctx.req), { algorithms: ['HS256'], key: { type: 'secret', binding: '${SECRET_BINDING}' } })
  return ctx.text(verified.protectedHeader.alg)
}`
];
for (const source of importShapes) {
  const result = build(source);
  assert.equal(result.artifact.status, 'ok', result.diagnostics.map((entry) => entry.code).join(', '));
}

const parallel = build(sourceWith(options(false), undefined, 'parallel'));
assert.equal(parallel.artifact.status, 'ok');
assert.equal(parallel.entries[0].placement, 'statement');

expectCode(
  sourceWith(`{ algorithms: [], key: { type: 'secret', binding: '${SECRET_BINDING}' } }`, undefined, 'return'),
  jwtContracts.JWT_DIAGNOSTIC_CODES.ALGORITHMS_EMPTY
);
expectCode(
  sourceWith(`{ algorithms: ['none'], key: { type: 'secret', binding: '${SECRET_BINDING}' } }`, undefined, 'return'),
  jwtContracts.JWT_DIAGNOSTIC_CODES.ALGORITHM_UNSUPPORTED
);
const asymmetric = expectCode(
  sourceWith(`{
    algorithms: ['RS256'],
    key: { type: 'jwk', key: { kty: 'RSA', n: 'D3_PUBLIC_MATERIAL', e: 'AQAB' } }
  }`, undefined, 'return'),
  jwtContracts.JWT_DIAGNOSTIC_CODES.ALGORITHM_UNSUPPORTED
);
assert.equal(asymmetric.cryptoRequirements.length, 0);
assert.deepEqual(asymmetric.keyArtifacts, []);
assert.deepEqual(asymmetric.realizationArtifacts, []);
assert.doesNotMatch(JSON.stringify(asymmetric), /D3_PUBLIC_MATERIAL/);
expectCode(
  `import { jwt } from '@pulse-compute/jwt'
export default async function handler(ctx) {
  const algorithms = ['HS256']
  return jwt.verify(ctx, jwt.bearer(ctx.req), { algorithms, key: { type: 'secret', binding: '${SECRET_BINDING}' } })
}`,
  jwtContracts.JWT_DIAGNOSTIC_CODES.ALGORITHMS_LITERAL_REQUIRED
);
expectCode(
  sourceWith(options(false), `ctx.req.header('authorization')`, 'return'),
  jwtContracts.JWT_DIAGNOSTIC_CODES.TOKEN_SOURCE_UNSUPPORTED
);
expectCode(
  sourceWith(options(true), undefined, 'unawaited'),
  jwtContracts.JWT_DIAGNOSTIC_CODES.PLACEMENT_UNSUPPORTED
);
expectCode(
  sourceWith(options(true)),
  jwtContracts.JWT_DIAGNOSTIC_CODES.SCHEMA_UNKNOWN,
  { schemaBundle: schemaBundle([]) }
);
expectCode(
  sourceWith(options(true)),
  jwtContracts.JWT_DIAGNOSTIC_CODES.SCHEMA_UNREALIZED,
  { schemaBundle: schemaBundle(['auth.AccessClaims'], []) }
);
const targetBlindDecision = build(sourceWith(options(false)), {
  targetDescriptor: Object.freeze({
    id: 'unsupported-target-must-not-enter-builder',
    mode: 'native',
    capabilities: Object.freeze([]),
    keyTypes: Object.freeze([])
  })
});
assert.equal(targetBlindDecision.artifact.status, 'ok');
assert.equal(targetBlindDecision.diagnostics.filter((entry) => entry.severity === 'error').length, 0);
assert.deepEqual(targetBlindDecision.entries[0].providerRequirements, [
  'jwt.verify',
  'time.wall-clock',
  'jwt.verify.hs256',
  'secret.get'
]);
assert.equal(Object.hasOwn(targetBlindDecision.entries[0], 'target'), false);
assert.equal(targetBlindDecision.artifact.policy.targetEligibilityDeferredToProviderBoundary, true);

for (const relative of [
  'wasm/packages/library-kit/src/compiler/package-lowering.js',
  'wasm/packages/compiler/src/spine/package-operation-seam.js',
  'wasm/packages/compiler/src/canonical-project-compiler.js',
  'wasm/packages/compiler/src/project/package-reachability.js'
]) {
  const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
  assert.doesNotMatch(source, /@pulse-compute\/jwt|PULSE_JWT_|jwt\.verify/);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-d3-lowering-'));
try {
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"."}}\n');
  fs.writeFileSync(path.join(sourceRoot, 'schemas.ts'), 'export interface AccessClaims { sub: string }\n');
  const entryFile = path.join(sourceRoot, 'index.ts');
  fs.writeFileSync(entryFile, sourceWith());
  const compiled = compileCanonicalProject(entryFile, {
    rootDir: tempRoot,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(tempRoot, 'tsconfig.json'),
    packageTargetDescriptor: targetDescriptor,
    packageTarget: 'native',
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    schemas: {
      entries: [{
        id: 'auth.AccessClaims',
        namespace: 'auth',
        name: 'AccessClaims',
        source: './src/schemas.ts',
        type: 'AccessClaims'
      }]
    },
    applicationProjectMetadata: {
      selectedProfile: { name: 'test', source: 'fixture' },
      strict: true,
      target: 'native',
      host: 'node',
      projectHash: '3'.repeat(64),
      configPlanHash: '4'.repeat(64),
      bindings: { config: [], secret: [] },
      fragments: {},
      crypto: {
        source: 'profile',
        declaration: normalizeCryptoConfiguration({
          HS256: { realization: 'guest-source:pulse-hmac-as' }
        })
      }
    }
  });
  assert.equal(compiled.cryptoRealizationPlan.algorithms[0].realization, 'guest-source:pulse-hmac-as');
  assert.equal(compiled.cryptoRealizationPlan.algorithms[0].implementation, 'pulse-hmac-as.v1');
  assert.deepEqual(compiled.cryptoRealizationPlan.algorithms[0].requestedBy, ['@pulse-compute/jwt']);
  assert.deepEqual(compiled.packageReachability.selectedContracts, ['pulse.jwt']);
  assert.equal(compiled.metadata.packageEffectCount, 1);
  const recognition = packageOperationRecognitionForCompiled(compiled);
  assert.deepEqual(recognition.operations[0].providerRequirements, [
    'jwt.verify',
    'jwt.verify.hs256',
    'schema.decode',
    'secret.get',
    'time.wall-clock'
  ]);
  assert.deepEqual(recognition.cryptoRequirements, direct.cryptoRequirements);
  const lowered = lowerCanonicalPackageOperations(recognition);
  assert.deepEqual(lowered.requiredProviderCapabilities, [
    'jwt.verify',
    'jwt.verify.hs256',
    'schema.decode',
    'secret.get',
    'time.wall-clock'
  ]);
  assert.deepEqual(lowered.cryptoRequirements, recognition.cryptoRequirements);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('ok - JWT package lowering emits provider-neutral HS256 requirements while target eligibility remains outside the package builder');

const signPolicy = `{ algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 45 }`;
const signSource = (policy = signPolicy, call = 'jwt.sign') => `import { jwt, sign as issue } from '@pulse-compute/jwt';
export default async function handler(ctx) { const token = await ${call}(ctx, { sub: 'scheduler' }, ${policy}); return ctx.text(token); }`;
for (const call of ['jwt.sign', 'issue']) {
  const result = build(signSource(signPolicy, call));
  assert.equal(result.hasErrors, false, JSON.stringify(result.diagnostics));
  assert.equal(result.canonicalEffects[0].kind, 'jwt.sign');
  assert.equal(result.canonicalEffects[0].result, 'string');
  assert.deepEqual(result.canonicalEffects[0].runtimeInputs, [{ name: 'claims', argumentIndex: 1, source: 'package-call-argument' }]);
  assert.deepEqual(result.cryptoRequirements[0].algorithms, ['HMAC-SHA256']);
  assert.deepEqual(result.canonicalEffects[0].providerRequirements, ['jwt.sign', 'secret.get', 'time.wall-clock']);
  assert.equal(result.canonicalIntrinsics.length, 0);
}
for (const policy of [
  'dynamicOptions',
  signPolicy.replace("'HS256'", "'ES256'"),
  signPolicy.replace('45', '0'), signPolicy.replace('45', '301'), signPolicy.replace('45', 'ttl'),
  signPolicy.replace("'WORKER_KEY'", 'binding'),
  signPolicy.replace("type: 'secret'", "type: 'jwk'"),
  signPolicy.replace("algorithm: 'HS256'", "...other, algorithm: 'HS256'"),
  signPolicy.replace('expiresInSeconds: 45', 'expiresInSeconds: 45, kid: "override"'),
]) assert.equal(build(signSource(policy)).hasErrors, true, policy);
assert.equal(build(signSource().replace('await jwt.sign', 'jwt.sign')).hasErrors, true);
assert.equal(build(signSource().replace('jwt.sign(ctx,', 'jwt.sign(other,')).hasErrors, true);
console.log('ok - JWT signing owns static policy validation, secret/clock authority and explicit HMAC-SHA256 demand');
