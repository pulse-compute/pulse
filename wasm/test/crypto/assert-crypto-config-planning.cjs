#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
process.chdir(repoRoot);
const corpus = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'packages', 'crypto', 'conformance', 'hs256.json'),
  'utf8'
));

const {
  normalizeProjectDeclaration,
  selectProfilePlan,
  defaultProjectPlanContract
} = require('../../packages/contracts/src/project/config-plan.js');
const {
  normalizeCryptoConfiguration,
  normalizeCryptoRequirements,
  defineCryptoTargetCapabilities,
  planCryptoRealizations
} = require('../../packages/contracts/src/crypto/contracts.js');
const {
  collectReachableCryptoRequirements,
  planProjectCrypto
} = require('../../packages/compiler/src/crypto-requirement-planner.js');
const {
  compileProjectConfigSource
} = require('../../packages/compiler/src/project-config-compiler.js');
const {
  projectConfigSchemaDocument,
  validateConfigValue,
  validateProjectConfigStructure
} = require('../../packages/cli/src/project-config-schema.js');
const {
  compileCanonicalProject,
  CanonicalProjectCompileError
} = require('../../packages/compiler/src/canonical-project-compiler.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/native/target.js');
const {
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/javascript/target.js');
const {
  FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR
} = require('../../../packages/provider-fastly/src/javascript/target.js');
const fastlyToolchain = require('../../../packages/provider-fastly/src/toolchain/index.js');

function config(overrides = {}) {
  return {
    pulse: { defaultProfile: 'dev', crypto: ['HS256'], ...(overrides.pulse || {}) },
    dev: { host: 'node', target: 'javascript', ...(overrides.dev || {}) },
    prod: { host: 'node', target: 'native', ...(overrides.prod || {}) }
  };
}

function select(raw, name) {
  return selectProfilePlan(normalizeProjectDeclaration(raw), { name, source: 'cli' });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error && error.code, code, error && error.stack);
    return true;
  });
}

const inherited = select(config(), 'dev');
assert.equal(inherited.crypto.source, 'pulse');
assert.deepEqual(inherited.crypto.declaration.algorithms, [{ algorithm: 'HS256', realization: null }]);
assert.equal(inherited.fragments.crypto, undefined);

const replaced = select(config({ prod: { crypto: {} } }), 'prod');
assert.equal(replaced.crypto.source, 'profile');
assert.equal(replaced.crypto.declaration.form, 'object');
assert.deepEqual(replaced.crypto.declaration.algorithms, []);

const explicitArrayNone = select(config({ prod: { crypto: [] } }), 'prod');
assert.equal(explicitArrayNone.crypto.source, 'profile');
assert.equal(explicitArrayNone.crypto.declaration.form, 'array');
assert.deepEqual(explicitArrayNone.crypto.declaration.algorithms, []);
assert.notEqual(replaced.planHash, inherited.planHash);

const objectReplacement = select(config({
  pulse: { crypto: { HS256: { realization: 'runtime-builtin' } } },
  prod: { crypto: { HS256: {} } }
}), 'prod');
assert.equal(objectReplacement.crypto.source, 'profile');
assert.equal(objectReplacement.crypto.declaration.form, 'object');
assert.deepEqual(objectReplacement.crypto.declaration.algorithms, [{
  algorithm: 'HS256',
  realization: null
}]);

const implicitNone = select({
  pulse: { defaultProfile: 'dev' },
  dev: { host: 'node', target: 'javascript' }
}, 'dev');
assert.equal(implicitNone.crypto.source, 'implicit');
assert.equal(implicitNone.crypto.declaration.form, 'implicit');
assert.deepEqual(implicitNone.crypto.declaration.algorithms, []);

const pinned = select(config({
  prod: { crypto: { HS256: { realization: 'guest-source:pulse-hmac-as' } } }
}), 'prod');
assert.equal(pinned.crypto.declaration.algorithms[0].realization, 'guest-source:pulse-hmac-as');

expectCode(() => normalizeCryptoConfiguration('HS256'), 'PULSE_CRYPTO_CONFIG_SHAPE_INVALID');
expectCode(() => normalizeCryptoConfiguration(['HS256', 'HS256']), 'PULSE_CRYPTO_ALGORITHM_DUPLICATE');
expectCode(() => normalizeCryptoConfiguration(['hs256']), 'PULSE_CRYPTO_ALGORITHM_UNKNOWN');
expectCode(() => normalizeCryptoConfiguration({ HS256: 'runtime-builtin' }), 'PULSE_CRYPTO_REALIZATION_SELECTION_OBJECT_REQUIRED');
expectCode(() => normalizeCryptoConfiguration({ HS256: { realization: 'webcrypto' } }), 'PULSE_CRYPTO_REALIZATION_UNKNOWN');
expectCode(() => normalizeCryptoConfiguration({ HS256: { fallback: true } }), 'PULSE_CRYPTO_REALIZATION_SELECTION_KEY_UNSUPPORTED');

const staticCompiled = compileProjectConfigSource(`
  import { defineConfig } from '@pulse-compute/pulse'
  export default defineConfig((_scope) => ({
    pulse: { defaultProfile: 'prod', crypto: ['HS256'] },
    prod: {
      host: 'node',
      target: 'native',
      crypto: { HS256: { realization: 'guest-source:pulse-hmac-as' } },
    },
  }))
`, {
  file: '.pulse/config.ts',
  selection: { name: 'prod', source: 'cli' }
});
assert.equal(staticCompiled.plan.crypto.source, 'profile');
assert.equal(staticCompiled.plan.crypto.declaration.algorithms[0].realization, 'guest-source:pulse-hmac-as');

const installedOnly = collectReachableCryptoRequirements([{
  requestedBy: '@pulse-compute/jwt',
  reachable: false,
  algorithms: ['HS256']
}]);
assert.deepEqual(installedOnly.algorithms, []);

const reachable = collectReachableCryptoRequirements([
  { requestedBy: '@pulse-compute/jwt', reachable: true, algorithms: ['HS256'] },
  { requestedBy: '@pulse-compute/crypto', reachable: true, algorithms: ['HS256'] }
]);
assert.deepEqual(reachable.algorithms, [{
  algorithm: 'HS256',
  requestedBy: ['@pulse-compute/crypto', '@pulse-compute/jwt']
}]);

expectCode(() => planProjectCrypto({
  declaration: explicitArrayNone.crypto.declaration,
  requirements: normalizeCryptoRequirements([{ algorithm: 'HS256', requestedBy: '@pulse-compute/jwt' }]),
  targetDescriptor: NODE_JAVASCRIPT_TARGET_DESCRIPTOR,
  target: 'javascript',
  profile: 'prod'
}), 'PULSE_CRYPTO_CONFIG_REQUIRED');

expectCode(() => planProjectCrypto({
  declaration: implicitNone.crypto.declaration,
  requirements: normalizeCryptoRequirements([{ algorithm: 'HS256', requestedBy: '@pulse-compute/crypto' }]),
  targetDescriptor: NODE_JAVASCRIPT_TARGET_DESCRIPTOR,
  target: 'javascript',
  profile: 'dev'
}), 'PULSE_CRYPTO_CONFIG_REQUIRED');

const jsPlan = planProjectCrypto({
  declaration: inherited.crypto.declaration,
  requirements: reachable,
  targetDescriptor: NODE_JAVASCRIPT_TARGET_DESCRIPTOR,
  target: 'javascript',
  profile: 'dev'
});
assert.deepEqual(jsPlan.algorithms.map((entry) => ({
  algorithm: entry.algorithm,
  realization: entry.realization,
  kind: entry.kind,
  automaticFallback: entry.automaticFallback
})), [{
  algorithm: 'HS256',
  realization: 'runtime-builtin',
  kind: 'runtime-builtin',
  automaticFallback: false
}]);
assert.equal(jsPlan.algorithms[0].targetStatus, 'implemented-c2');
assert.equal(jsPlan.algorithms[0].targetImplemented, true);
assert.equal(jsPlan.automaticFallback, false);

const nativePlan = planProjectCrypto({
  declaration: pinned.crypto.declaration,
  requirements: reachable,
  targetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
  target: 'native',
  profile: 'prod'
});
assert.equal(nativePlan.algorithms[0].realization, 'guest-source:pulse-hmac-as');
assert.equal(nativePlan.algorithms[0].backend, 'pulse-hmac-as');
assert.equal(nativePlan.algorithms[0].pinned, true);
assert.equal(nativePlan.algorithms[0].targetStatus, 'implemented-c3');
assert.equal(nativePlan.algorithms[0].targetImplemented, true);

const reorderedRequirements = normalizeCryptoRequirements([
  { algorithm: 'HS256', requestedBy: '@pulse-compute/jwt' },
  { algorithm: 'HS256', requestedBy: '@pulse-compute/crypto' }
]);
assert.equal(planCryptoRealizations({
  declaration: inherited.crypto.declaration,
  requirements: reorderedRequirements,
  targetDescriptor: NODE_JAVASCRIPT_TARGET_DESCRIPTOR,
  target: 'javascript',
  profile: 'dev'
}).planHash, jsPlan.planHash);

expectCode(() => planProjectCrypto({
  declaration: normalizeCryptoConfiguration({ HS256: { realization: 'runtime-builtin' } }),
  requirements: reachable,
  targetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
  target: 'native',
  profile: 'prod'
}), 'PULSE_CRYPTO_REALIZATION_PIN_INVALID');

expectCode(() => planProjectCrypto({
  declaration: inherited.crypto.declaration,
  requirements: reachable,
  targetDescriptor: {
    crypto: defineCryptoTargetCapabilities({ target: 'javascript', algorithms: [] })
  },
  target: 'javascript',
  profile: 'dev'
}), 'PULSE_CRYPTO_REALIZATION_UNAVAILABLE');

assert.equal(
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR.crypto.algorithms.find(
    (entry) => entry.algorithm === 'HS256'
  ).realization,
  'runtime-builtin'
);
assert.equal(FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR.crypto.algorithms[0].realization, 'runtime-builtin');
assert.equal(
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR.crypto.algorithms.find(
    (entry) => entry.algorithm === 'HS256'
  ).kind,
  'runtime-builtin'
);
assert.equal(FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR.crypto.algorithms[0].kind, 'runtime-builtin');
assert.equal(
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR.crypto.algorithms.find(
    (entry) => entry.algorithm === 'HS256'
  ).implemented,
  true
);
assert.equal(FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR.crypto.algorithms[0].implemented, true);
assert.equal(
  NODE_NATIVE_TARGET_DESCRIPTOR.crypto.algorithms.find(
    (entry) => entry.algorithm === 'HS256'
  ).realization,
  'guest-source:pulse-hmac-as'
);
assert.equal(
  NODE_NATIVE_TARGET_DESCRIPTOR.crypto.algorithms.find(
    (entry) => entry.algorithm === 'ES256'
  ).realization,
  'guest-linked:pulse-es256-rustcrypto-p256'
);
const fastlyDriver = fastlyToolchain.createDriver({
  buildJavascriptTargetSupportEvidence() { return null; }
});
assert.equal(
  fastlyDriver.targets.native.crypto.algorithms.find(
    (entry) => entry.algorithm === 'HS256'
  ).realization,
  'guest-source:pulse-hmac-as'
);
assert.equal(
  NODE_NATIVE_TARGET_DESCRIPTOR.crypto.algorithms.find(
    (entry) => entry.algorithm === 'HS256'
  ).implemented,
  true
);
assert.equal(
  fastlyDriver.targets.native.crypto.algorithms.find(
    (entry) => entry.algorithm === 'HS256'
  ).implemented,
  true
);
assert.ok([
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR,
  FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR,
  NODE_NATIVE_TARGET_DESCRIPTOR,
  fastlyDriver.targets.native
].every((descriptor) => descriptor.crypto.automaticFallback === false));

const fixtureRoot = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects', 'reachable-modules', 'router');
const entryFile = path.join(fixtureRoot, 'src', 'index.ts');
const compilerOptions = {
  rootDir: fixtureRoot,
  workspaceRoot: repoRoot,
  tsconfigFile: path.join(fixtureRoot, 'tsconfig.json'),
  packageTargetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR,
  packageTarget: 'native',
  cryptoRequirements: [{
    requestedBy: '@pulse-compute/crypto',
    reachable: true,
    algorithms: ['HS256']
  }],
  applicationProjectMetadata: {
    selectedProfile: { name: 'prod', source: 'fixture' },
    strict: true,
    target: 'native',
    host: 'node',
    projectHash: '1'.repeat(64),
    configPlanHash: '2'.repeat(64),
    bindings: { config: [], secret: [] },
    fragments: {},
    crypto: pinned.crypto
  },
  strict: true,
  requireAsync: true,
  requireEffectAwait: true
};
const compiled = compileCanonicalProject(entryFile, compilerOptions);
assert.equal(compiled.cryptoRealizationPlan.algorithms[0].realization, 'guest-source:pulse-hmac-as');

assert.throws(
  () => compileCanonicalProject(entryFile, {
    ...compilerOptions,
    schemas: { definitelyInvalidBeforeLowering: true },
    applicationProjectMetadata: {
      ...compilerOptions.applicationProjectMetadata,
      crypto: explicitArrayNone.crypto
    }
  }),
  (error) => {
    assert.ok(error instanceof CanonicalProjectCompileError);
    assert.equal(error.code, 'PULSE_CRYPTO_CONFIG_REQUIRED');
    assert.equal(error.diagnostics[0].detail.automaticFallback, false);
    return true;
  },
  'invalid crypto plans must stop before schema compilation or source lowering'
);

const contract = defaultProjectPlanContract();
assert.equal(contract.policies.genericDeepMerge, false);
assert.equal(contract.policies.cryptoProfileReplacement, true);
assert.equal(contract.policies.cryptoRuntimeDetection, false);
assert.equal(contract.policies.cryptoAutomaticFallback, false);

const publicConfigSchema = projectConfigSchemaDocument();
assert.ok(publicConfigSchema.fields.some((entry) => entry.path === 'pulse.crypto'));
assert.ok(publicConfigSchema.fields.some((entry) => entry.path === '<profile>.crypto'));
assert.ok(publicConfigSchema.precedence.some((entry) => /crypto declaration replaces pulse\.crypto completely/.test(entry)));
assert.deepEqual(validateProjectConfigStructure({ crypto: ['HS256'] }), []);
assert.deepEqual(validateProjectConfigStructure({
  crypto: { HS256: { realization: 'runtime-builtin' } }
}), []);
assert.deepEqual(validateProjectConfigStructure({
  crypto: { ES256: { realization: 'guest-linked:pulse-es256-rustcrypto-p256' } }
}), []);
assert.equal(validateProjectConfigStructure({ crypto: ['HS256', 'HS256'] })[0].path, 'crypto');
assert.equal(validateProjectConfigStructure({ crypto: ['UNKNOWN'] })[0].path, 'crypto');
assert.equal(validateConfigValue('crypto', { HS256: {} }), true);
assert.equal(validateConfigValue('crypto', { HS256: { realization: 'unknown' } }), false);
assert.deepEqual(
  publicConfigSchema.jsonSchema.properties.crypto.oneOf[0].items.enum,
  ['HS256', 'ES256', 'RS256', 'SHA-256', 'HMAC-SHA256']
);

const coveredConfigurationCases = [
  'inherited-global-crypto',
  'named-profile-replacement',
  'no-array-merging',
  'no-object-merging',
  'empty-array',
  'empty-object',
  'duplicate-array-entry',
  'unknown-key',
  'unknown-algorithm',
  'unknown-realization',
  'profile-missing-hs256',
  'target-without-hs256',
  'unavailable-exact-realization-pin',
  'no-fallback-after-realization-failure'
];
assert.deepEqual(
  [...coveredConfigurationCases].sort(),
  [...corpus.configurationCases].sort(),
  'the shared C4 corpus and executable configuration matrix must remain synchronized'
);

console.log('ok - crypto configuration replacement, reachable demand, deterministic realization planning, and pre-lowering failure are canonical');
