'use strict';

const crypto = require('node:crypto');
const { normalizeFastlyMaxWasmBytes, assertFastlyWasmBudget } = require('./wasm-budget.js');
const fs = require('node:fs');
const path = require('node:path');
const { CANONICAL_NATIVE_PLAN_VERSION } = require('@pulse-compute/wasm-contracts/handler/canonical-native-plan');
const {
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION,
  compileFastlyNativePlatformCapabilitiesPlan,
  writeFastlyNativePlatformCapabilitiesModule
} = require('./native-platform-capabilities.js');

const FASTLY_CANONICAL_BUILD_VERSION = 'pulse.fastly-canonical-build.v6';
const FASTLY_CANONICAL_TARGET = 'fastly-compute-native';

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function isFastlyNativeArtifact(native) {
  return Boolean(
    native
    && native.version === FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION
    && Buffer.isBuffer(native.wasm)
    && native.manifest
    && native.manifest.wasm
  );
}

function providerBuildError(code, message, detail = {}) {
  const error = new Error(message);
  error.name = 'FastlyCanonicalBuildError';
  error.code = code;
  error.detail = Object.freeze({ ...detail });
  return error;
}

function assertFastlyProviderPlan(providerPlan) {
  if (
    !providerPlan
    || providerPlan.version !== 'pulse.canonical-provider-plan.v1'
    || providerPlan.provider !== 'fastly'
    || !Array.isArray(providerPlan.operations)
  ) {
    throw new TypeError('Fastly canonical target requires the canonical Fastly provider plan.');
  }
  return providerPlan;
}

function metadataFromCanonicalPlans(plan, providerPlan) {
  const lowering = assertFastlyProviderPlan(providerPlan);
  return Object.freeze({
    sourceHash: plan.source.sourceHash,
    projectSourceHash: plan.source.projectSourceHash || plan.source.sourceHash,
    capabilities: plan.capabilities,
    providerOperations: lowering.operations,
    packageEffects: plan.packages && plan.packages.effects || Object.freeze([]),
    schemaIds: plan.schemas && plan.schemas.ids || Object.freeze([]),
    schemaReferences: plan.schemas && plan.schemas.references || Object.freeze([]),
    schemaSourceHash: plan.schemas && plan.schemas.sourceHash
  });
}

function assertExactProviderNative(native) {
  if (!isFastlyNativeArtifact(native)) {
    throw providerBuildError(
      'PULSE_FASTLY_NATIVE_ARTIFACT_INVALID',
      'Fastly packaging requires a Fastly provider-native artifact.',
      { automaticFallback: false }
    );
  }
  const observedSha256 = sha256(native.wasm);
  if (native.manifest.wasm.sha256 !== observedSha256) {
    throw providerBuildError(
      'PULSE_FASTLY_NATIVE_ARTIFACT_HASH_MISMATCH',
      'Fastly provider-native bytes do not match their compiler manifest.',
      {
        expectedSha256: native.manifest.wasm.sha256,
        observedSha256,
        automaticFallback: false
      }
    );
  }
  if (native.guestLink) {
    const audit = native.guestLink.audit;
    if (
      !audit
      || audit.status !== 'passed'
      || audit.providerPackaging && audit.providerPackaging.authorized !== true
      || !audit.artifact
      || audit.artifact.sha256 !== observedSha256
      || native.guestLink.providerPackaging
        && native.guestLink.providerPackaging.authorized !== true
    ) {
      throw providerBuildError(
        'PULSE_GUEST_FINAL_AUDIT_FAILED',
        'Fastly packaging requires exact bytes authorized by the final guest-link audit.',
        { observedSha256, automaticFallback: false }
      );
    }
  }
  return native;
}

function validateGripBindings(metadata = {}, bindings = {}) {
  const operations = (metadata.providerOperations || []).filter((operation) => operation && operation.kind === 'grip');
  if (operations.length === 0) return Object.freeze({ active: false, operations: Object.freeze([]) });
  const grip = bindings.grip && typeof bindings.grip === 'object' ? bindings.grip : {};
  const publish = operations.filter((operation) => operation.operation === 'publish');
  const broadcast = operations.filter((operation) => operation.operation === 'broadcast');
  const hold = operations.filter((operation) => operation.operation === 'hold');
  if (broadcast.length > 0 && !String(grip.publishEndpoint || '').trim()) {
    throw providerBuildError(
      'PULSE_FASTLY_GRIP_PUBLISH_BINDING_REQUIRED',
      'Fastly GRIP broadcast operations require provider.grip.publishEndpoint.',
      { operations: broadcast.map((operation) => operation.id) }
    );
  }
  if (broadcast.length > 0) {
    try {
      const endpoint = new URL(String(grip.publishEndpoint));
      if (!['http:', 'https:'].includes(endpoint.protocol)) throw new TypeError('unsupported protocol');
    } catch {
      throw providerBuildError(
        'PULSE_FASTLY_GRIP_PUBLISH_BINDING_REQUIRED',
        'Fastly GRIP publishEndpoint must be an absolute HTTP or HTTPS URL.',
        { operations: broadcast.map((operation) => operation.id) }
      );
    }
    if (grip.authentication !== undefined) {
      const authentication = grip.authentication && typeof grip.authentication === 'object' ? grip.authentication : {};
      if (String(authentication.scheme || 'bearer').toLowerCase() !== 'bearer') {
        throw providerBuildError(
          'PULSE_FASTLY_NATIVE_GRIP_AUTH_SCHEME_UNSUPPORTED',
          'Fastly GRIP broadcast supports only bearer authentication.',
          { operations: broadcast.map((operation) => operation.id) }
        );
      }
      if (!String(authentication.secretRef || '').trim()) {
        throw providerBuildError(
          'PULSE_FASTLY_NATIVE_GRIP_SECRET_REFERENCE_MISSING',
          'Fastly GRIP bearer authentication requires a named secret reference.',
          { operations: broadcast.map((operation) => operation.id) }
        );
      }
    }
  }
  if (publish.length > 0 && !String(grip.publishUrl || '').trim()) {
    throw providerBuildError(
      'PULSE_FASTLY_GRIP_PUBLISH_BINDING_REQUIRED',
      'Fastly GRIP publish operations require provider.grip.publishUrl.',
      { operations: publish.map((operation) => operation.id) }
    );
  }
  if (hold.length > 0 && grip.directHold === false && !String(grip.fanoutBackend || '').trim()) {
    throw providerBuildError(
      'PULSE_FASTLY_GRIP_FANOUT_BACKEND_REQUIRED',
      'Fastly GRIP Fanout handoff requires provider.grip.fanoutBackend when directHold is disabled.',
      { operations: hold.map((operation) => operation.id) }
    );
  }
  const endpoint = broadcast.length > 0 ? grip.publishEndpoint : grip.publishUrl;
  if ((publish.length > 0 || broadcast.length > 0) && String(endpoint || '').trim() && !String(grip.publishBackend || '').trim() && bindings.dynamicBackends !== true) {
    const origin = new URL(String(endpoint)).origin;
    if (!(bindings.backends && bindings.backends[origin])) {
      throw providerBuildError(
        'PULSE_FASTLY_GRIP_PUBLISH_BACKEND_REQUIRED',
        `No Fastly backend binding is configured for the GRIP publish origin ${origin}.`,
        { origin, operations: [...publish, ...broadcast].map((operation) => operation.id) }
      );
    }
  }
  return Object.freeze({
    active: true,
    operations: Object.freeze(operations.map((operation) => Object.freeze({ id: operation.id, operation: operation.operation, result: operation.result }))),
    directHold: grip.directHold !== false,
    fanoutBackend: grip.fanoutBackend === undefined ? undefined : String(grip.fanoutBackend),
    publishEndpoint: grip.publishEndpoint === undefined ? undefined : String(grip.publishEndpoint),
    publishUrl: grip.publishUrl === undefined ? undefined : String(grip.publishUrl),
    publishBackend: grip.publishBackend === undefined ? undefined : String(grip.publishBackend),
    authentication: grip.authentication === undefined ? undefined : Object.freeze({
      scheme: String(grip.authentication.scheme || 'bearer'),
      secretRef: String(grip.authentication.secretRef || '')
    })
  });
}

function cleanName(value) { return String(value || 'pulse-app').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'pulse-app'; }
function tomlString(value) { return JSON.stringify(String(value)); }

function normalizedBuildConfig(providerConfig = {}) {
  const input = providerConfig.build && typeof providerConfig.build === 'object' ? providerConfig.build : {};
  return Object.freeze({
    name: cleanName(input.name),
    description: String(input.description || 'Pulse application'),
    authors: Object.freeze(Array.isArray(input.authors) ? input.authors.map(String) : []),
    language: 'other'
  });
}

function nativeBuildCheckCommand() {
  return "node -e \"const fs=require('node:fs');const f='bin/main.wasm';if(!fs.existsSync(f)){console.error('Run pulse build before Fastly packaging.');process.exit(1)}\"";
}

function renderFastlyToml(build) {
  return [
    'manifest_version = 3',
    `name = ${tomlString(build.name)}`,
    `description = ${tomlString(build.description)}`,
    `authors = [${build.authors.map(tomlString).join(', ')}]`,
    'language = "other"',
    '',
    '[scripts]',
    `build = ${tomlString(nativeBuildCheckCommand())}`,
    ''
  ].join('\n');
}

function inspectFastlyCanonicalTarget(options = {}) {
  const plan = options.plan;
  if (!plan || plan.version !== CANONICAL_NATIVE_PLAN_VERSION) {
    throw new TypeError(`Fastly canonical target inspection requires ${CANONICAL_NATIVE_PLAN_VERSION}.`);
  }
  const providerConfig = options.providerConfig || {};
  const bindings = options.bindings || providerConfig.bindings || {};
  const maxWasmBytes = normalizeFastlyMaxWasmBytes(providerConfig.build?.maxWasmBytes);
  if (isFastlyNativeArtifact(options.native)) assertFastlyWasmBudget(options.native.wasm.length, maxWasmBytes);
  const native = isFastlyNativeArtifact(options.native)
    ? assertExactProviderNative(options.native)
    : compileFastlyNativePlatformCapabilitiesPlan(plan, {
        cwd: options.cwd || options.projectRoot || process.cwd(),
        projectRoot: options.projectRoot,
        profile: options.profile,
        bindings,
        maxDurationMs: providerConfig.maxDurationMs,
        maxWasmBytes,
        requirePlatformCapability: false,
        canonicalBuild: true,
        targetDescriptor: options.targetDescriptor,
        synchronizedPackages: options.synchronizedPackages,
        realizationArtifacts: options.realizationArtifacts
          || (options.native && options.native.realizationArtifacts),
        guestUnits: options.guestUnits
          || (options.native && options.native.guestUnits),
        nativeOptimization: options.nativeOptimization
          || (options.experimentalNativeSize === true ? 'experimental-native-size' : undefined),
        emitWat: options.emitWat,
        timeoutMs: options.compileTimeoutMs
      });
  const duration = require('@pulse-compute/runtime/host').normalizeRequestDuration(providerConfig.maxDurationMs);
  if (native.manifest.bindings?.maxDurationMs !== duration) {
    throw providerBuildError('PULSE_REQUEST_DURATION_ARTIFACT_MISMATCH', 'Fastly artifact request deadline does not match the selected provider profile.');
  }
  return Object.freeze({
    target: FASTLY_CANONICAL_TARGET,
    provider: 'fastly',
    providerNeutralInput: true,
    nativeWasm: true,
    javascriptRuntime: false,
    jsComputeRuntime: false,
    planHash: plan.planHash,
    compilerVersion: native.compilerVersion,
    compiler: native.manifest.assemblyScript,
    wasm: native.manifest.wasm,
    wat: native.manifest.wat,
    importModules: native.manifest.importModules,
    imports: native.manifest.imports,
    exports: native.manifest.exports,
    policy: native.manifest.policy,
    native
  });
}

function writeFastlyCanonicalTarget(options = {}) {
  if (options.sourceOnly === true) {
    throw providerBuildError(
      'PULSE_SOURCE_ONLY_REMOVED',
      'Fastly source-only JavaScript packaging was removed. pulse build emits generated native source and bin/main.wasm together.',
      { replacement: 'pulse build' }
    );
  }
  const outDir = path.resolve(options.outDir || '.');
  const plan = options.plan;
  if (!plan || plan.version !== CANONICAL_NATIVE_PLAN_VERSION) {
    throw new TypeError(`Fastly canonical target requires ${CANONICAL_NATIVE_PLAN_VERSION}.`);
  }
  const lowering = assertFastlyProviderPlan(options.providerPlan);
  const metadata = metadataFromCanonicalPlans(plan, lowering);
  const providerConfig = options.providerConfig || {};
  const bindings = options.bindings || providerConfig.bindings || {};
  const buildConfig = normalizedBuildConfig(providerConfig);
  const grip = validateGripBindings(metadata, bindings);

  const srcDir = path.join(outDir, 'src');
  const binDir = path.join(outDir, 'bin');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  let native;
  const maxWasmBytes = normalizeFastlyMaxWasmBytes(providerConfig.build?.maxWasmBytes);
  if (isFastlyNativeArtifact(options.native)) assertFastlyWasmBudget(options.native.wasm.length, maxWasmBytes);
  const auditedNative = isFastlyNativeArtifact(options.native)
    ? assertExactProviderNative(options.native)
    : null;
  if (auditedNative) {
    native = auditedNative;
  } else {
    const realization = inspectFastlyCanonicalTarget({
      plan,
      providerConfig,
      bindings,
      cwd: options.cwd || options.projectRoot || outDir,
      projectRoot: options.projectRoot,
      profile: options.profile,
      targetDescriptor: options.targetDescriptor,
      synchronizedPackages: options.synchronizedPackages,
      realizationArtifacts: options.realizationArtifacts
        || (options.native && options.native.realizationArtifacts),
      guestUnits: options.guestUnits
        || (options.native && options.native.guestUnits),
      nativeOptimization: options.nativeOptimization
        || (options.experimentalNativeSize === true ? 'experimental-native-size' : undefined),
      emitWat: options.emitWat,
      compileTimeoutMs: options.compileTimeoutMs
    });
    native = realization.native;
  }
  const written = writeFastlyNativePlatformCapabilitiesModule(native, outDir, {
    sourceFile: 'src/main.as.ts',
    wasmFile: 'bin/main.wasm',
    watFile: 'bin/main.wat',
    planFile: 'fastly-native-plan.json',
    manifestFile: 'fastly-native-manifest.json'
  });

  const files = {
    providerFile: path.join(outDir, 'fastly-provider.json'),
    entryFile: path.join(outDir, 'fastly-entry.cjs'),
    buildFile: path.join(outDir, 'fastly-build.json'),
    fastlyTomlFile: path.join(outDir, 'fastly.toml'),
    packageFile: path.join(outDir, 'package.json'),
    sourceEntryFile: written.sourceFile,
    sourceHandlerFile: undefined,
    wasmFile: written.wasmFile,
    watFile: written.watFile,
    nativePlanFile: written.planFile,
    nativeManifestFile: written.manifestFile
  };

  fs.writeFileSync(files.providerFile, stableJson(lowering));
  fs.writeFileSync(files.fastlyTomlFile, renderFastlyToml(buildConfig));
  fs.writeFileSync(files.packageFile, stableJson({
    name: buildConfig.name,
    version: '0.0.0',
    private: true,
    scripts: {
      build: nativeBuildCheckCommand(),
      start: 'fastly compute serve'
    }
  }));
  fs.writeFileSync(files.entryFile, `'use strict';\n\nconst program = require('./canonical-handler.cjs');\nconst { createCanonicalFastlyRuntime } = require('@pulse-compute/provider-fastly/runtime/canonical-api-runtime');\nconst bindings = Object.freeze(${JSON.stringify(bindings)});\nmodule.exports = Object.freeze({\n  version: ${JSON.stringify(FASTLY_CANONICAL_BUILD_VERSION)},\n  provider: 'fastly',\n  deployable: true,\n  deploymentValidated: false,\n  nativeWasm: true,\n  localConformanceRuntime: true,\n  createRuntime(options = {}) { return createCanonicalFastlyRuntime({ ...options, bindings }); },\n  execute(options = {}) { return createCanonicalFastlyRuntime({ ...options, bindings }).execute(program, options); }\n});\n`);

  const build = Object.freeze({
    version: FASTLY_CANONICAL_BUILD_VERSION,
    status: 'built',
    provider: 'fastly',
    target: FASTLY_CANONICAL_TARGET,
    sourceHash: metadata.sourceHash,
    projectSourceHash: metadata.projectSourceHash || metadata.sourceHash,
    handlerSourceHash: metadata.sourceHash,
    planVersion: plan.version,
    planHash: plan.planHash,
    deployable: true,
    sourcePackage: true,
    sourceOnly: false,
    compiledWasmPresent: true,
    deploymentValidated: false,
    compileCommand: 'pulse build',
    outputWasm: 'bin/main.wasm',
    compiler: Object.freeze({
      package: native.manifest.assemblyScript.package,
      version: native.manifest.assemblyScript.version,
      target: FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION,
      targetCompilerVersion: native.compilerVersion,
      invoked: auditedNative === null
    }),
    optimization: native.manifest.optimization,
    wasm: Object.freeze({ file: 'bin/main.wasm', ...native.manifest.wasm }),
    wat: Object.freeze({ file: written.watFile ? 'bin/main.wat' : null, ...native.manifest.wat }),
    imports: native.manifest.imports,
    importModules: native.manifest.importModules,
    exports: native.manifest.exports,
    crypto: native.manifest.crypto,
    ...(native.guestLink ? {
      guestLink: Object.freeze({
        version: native.guestLink.report.version,
        units: native.guestLink.report.units,
        finalArtifact: native.guestLink.report.finalArtifact,
        fallback: false,
        packagedBytesMatchAudit: sha256(fs.readFileSync(written.wasmFile)) === native.guestLink.audit.artifact.sha256
      })
    } : {}),
    localConformanceRuntime: true,
    providerSpecificUserland: false,
    providerSdkUserland: false,
    javascriptRuntime: false,
    jsComputeRuntime: false,
    build: buildConfig,
    files: Object.freeze({
      handler: 'canonical-handler.cjs',
      program: 'canonical-program.json',
      portableWasm: 'canonical-native.wasm',
      portableManifest: 'canonical-native-manifest.json',
      providerPlan: 'fastly-provider.json',
      localEntry: 'fastly-entry.cjs',
      sourceEntry: 'src/main.as.ts',
      wasm: 'bin/main.wasm',
      wat: written.watFile ? 'bin/main.wat' : null,
      nativePlan: 'fastly-native-plan.json',
      nativeManifest: 'fastly-native-manifest.json',
      fastlyToml: 'fastly.toml',
      package: 'package.json',
      schemaRegistry: metadata.schemaIds && metadata.schemaIds.length > 0 ? 'schema-json-registry.json' : undefined,
      schemaCodecs: metadata.schemaIds && metadata.schemaIds.length > 0 ? 'schema-json-codecs.cjs' : undefined
    }),
    grip,
    schemas: Object.freeze({
      active: Boolean(metadata.schemaIds && metadata.schemaIds.length > 0),
      ids: Object.freeze([...(metadata.schemaIds || [])]),
      references: Object.freeze([...(metadata.schemaReferences || [])]),
      sourceHash: metadata.schemaSourceHash
    }),
    lowering
  });
  fs.writeFileSync(files.buildFile, stableJson(build));
  return Object.freeze({ ...files, build, lowering, compilation: native, native });
}

module.exports = Object.freeze({
  FASTLY_CANONICAL_BUILD_VERSION,
  FASTLY_CANONICAL_TARGET,
  normalizedBuildConfig,
  renderFastlyToml,
  validateGripBindings,
  isFastlyNativeArtifact,
  assertExactProviderNative,
  inspectFastlyCanonicalTarget,
  writeFastlyCanonicalTarget
});
