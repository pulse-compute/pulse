'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const {
  loadCanonicalModule,
  writeCanonicalBuild
} = require('@pulse-compute/wasm-compiler/canonical-api-compiler');
const {
  compileCanonicalProject,
  packageRealizationArtifactsForCompiled
} = require('@pulse-compute/wasm-compiler/canonical-project-compiler');
const { createCanonicalSchemaCodecs } = require('@pulse-compute/wasm-schema-json/compiler/canonical-schema-codecs');
const { buildJavascriptApplicationPlan } = require('@pulse-compute/wasm-compiler/javascript-application-plan');
const { buildCanonicalNativePlan, CanonicalNativePlanError } = require('@pulse-compute/wasm-compiler/canonical-native-plan');
const {
  compileCanonicalNativePlan,
  writeCanonicalNativeModule
} = require('@pulse-compute/wasm-compiler/canonical-native-compiler');
const { PulseProjectError, projectJson, relative } = require('./project-config.js');
const { describeDiagnostic, decorateDiagnostic, httpStatusForDiagnostic } = require('./diagnostics.js');
const {
  getProviderDriver,
  getProviderTargetDescriptor,
  getProviderTargetSupportDeclaration,
  providerTargetAvailability,
  providerIds
} = require('./provider-drivers.js');
const {
  buildJavascriptTargetSupportEvidence,
  buildEventTargetSupportEvidence
} = require('./target-support.js');
const eventContracts = require(path.join(
  path.dirname(require.resolve('@pulse-compute/wasm-contracts')),
  'events',
  'contracts.js'
));
const {
  PROVIDER_TARGET_INVOCATION_VERSION,
  PROVIDER_PLAN_INPUT_VERSION,
  createProviderNativeArtifact,
  createProviderPlanInput,
  createProviderTargetInvocation,
  normalizeProviderTargetResult,
  projectProviderRequirements
} = require('@pulse-compute/wasm-contracts/provider/toolchain');
const { loadJavascriptApplication } = require('./typescript-module-loader.js');
const { writeNodeHttpResponse } = require('./internal/node-http.js');
const {
  HANDLER_AUTHORING_MODES
} = require('@pulse-compute/wasm-contracts/handler/surface-contract');
const {
  CANONICAL_PACKAGE_INSPECTION_VERSION
} = require('@pulse-compute/wasm-contracts/package/package-contract');

const PROJECT_EXECUTION_VERSION = 'pulse.project-execution.v10';
const EVENT_INSPECTION_VERSION = 'pulse.event-inspection.v1';
const BUILD_MANIFEST = 'pulse-build.json';
const COMPILE_MANIFEST = 'pulse-compile.json';
const cliPackageVersion = require('../package.json').version;
const releaseCatalog = require('../release-manifest.json');
const releaseNode = releaseCatalog.publication;

function nodeVersionSatisfiesEngines(version, engines) {
  const actual = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!actual) return false;
  const actualParts = actual.slice(1).map((part) => Number.parseInt(part, 10));
  return String(engines).split(/\s*\|\|\s*/).some((range) => {
    const minimum = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
    if (!minimum) return false;
    const minimumParts = minimum.slice(1).map((part) => Number.parseInt(part, 10));
    if (actualParts[0] !== minimumParts[0]) return false;
    for (let index = 1; index < 3; index += 1) {
      if (actualParts[index] !== minimumParts[index]) return actualParts[index] > minimumParts[index];
    }
    return true;
  });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writePackageInspectionArtifacts(compiled, outDir) {
  const inspection = compiled && compiled.packageInspection;
  const artifacts = inspection && Array.isArray(inspection.artifacts) ? inspection.artifacts : [];
  const files = artifacts.map((artifact) => {
    const relativeFile = String(artifact.file || '').replace(/\\/g, '/');
    const target = path.resolve(outDir, relativeFile);
    const relativeTarget = path.relative(path.resolve(outDir), target);
    if (!relativeFile || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      throw new PulseProjectError(
        'PULSE_PACKAGE_INSPECTION_ARTIFACT_UNSAFE',
        `Package inspection artifact ${artifact.id || '<unknown>'} must remain inside the build output.`,
        { id: artifact.id, file: relativeFile }
      );
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const bytes = stableJson(artifact.data);
    fs.writeFileSync(target, bytes);
    return Object.freeze({
      id: artifact.id,
      contractId: artifact.contractId,
      kind: artifact.kind,
      mediaType: artifact.mediaType,
      file: relativeFile,
      path: target,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    });
  });
  return Object.freeze({
    version: inspection && inspection.version || CANONICAL_PACKAGE_INSPECTION_VERSION,
    artifacts: Object.freeze(files),
    summary: inspection && inspection.summary || Object.freeze({ packages: 0, artifacts: 0, declaredHandlers: 0, handlerEffects: 0 })
  });
}

function packageInspectionManifest(written) {
  return Object.freeze({
    version: written.version,
    artifacts: Object.freeze(written.artifacts.map((artifact) => Object.freeze({
      id: artifact.id,
      contractId: artifact.contractId,
      kind: artifact.kind,
      mediaType: artifact.mediaType,
      file: artifact.file,
      sha256: artifact.sha256
    }))),
    summary: written.summary
  });
}

function selectedEventTargetSupport(project, compiled, descriptor = targetDescriptor(project)) {
  const driver = providerDriver(project);
  return buildEventTargetSupportEvidence(compiled, {
    provider: project.provider,
    target: project.target || 'native',
    descriptor,
    eventTestTargets: driver.events && driver.events.targets || []
  });
}

function sortedUnique(values) {
  return Object.freeze([...new Set((values || []).filter((value) => value !== null && value !== undefined).map(String))].sort());
}

function eventInspectionProjection(project, compiled, support = selectedEventTargetSupport(project, compiled)) {
  if (!support) return null;
  const catalog = compiled.eventCatalog || compiled.metadata && compiled.metadata.events && compiled.metadata.events.catalog;
  const outbound = compiled.eventOutboundRequirements || Object.freeze({
    version: compiled.metadata.events.outboundRequirementsVersion,
    callsites: Object.freeze([]),
    capabilities: Object.freeze([]),
    hostRequirements: Object.freeze([]),
    summary: Object.freeze({ callsites: 0, schemaBound: 0, noPayload: 0, grouped: 0, handlers: 0 })
  });
  const registrations = catalog && catalog.events || [];
  const callsites = outbound.callsites || [];
  const capabilities = sortedUnique([
    ...registrations.flatMap((event) => event.capabilities || []),
    ...(outbound.capabilities || [])
  ]);
  const hostRequirements = sortedUnique([
    ...registrations.flatMap((event) => event.hostRequirements || []),
    ...(outbound.hostRequirements || [])
  ]);
  return Object.freeze({
    version: EVENT_INSPECTION_VERSION,
    contractId: eventContracts.EVENT_CONTRACT_ID,
    catalog,
    outboundRequirements: outbound,
    registrations: Object.freeze(registrations),
    callsites: Object.freeze(callsites),
    schemas: Object.freeze({
      registrations: sortedUnique(registrations.map((event) => event.schemaId)),
      emissions: sortedUnique(callsites.map((callsite) => callsite.schemaId)),
      all: sortedUnique([
        ...registrations.map((event) => event.schemaId),
        ...callsites.map((callsite) => callsite.schemaId)
      ])
    }),
    capabilities,
    hostRequirements,
    targetSupport: support,
    policy: Object.freeze({
      providerNeutralCatalog: true,
      publicInjectionCommand: false,
      automaticLoopback: false,
      automaticFallback: false
    })
  });
}

function writeEventInspectionArtifacts(project, compiled, outDir, support) {
  const inspection = eventInspectionProjection(project, compiled, support);
  if (!inspection) return null;
  const catalogFile = path.join(outDir, 'event-catalog.json');
  const inspectionFile = path.join(outDir, 'event-inspection.json');
  fs.writeFileSync(catalogFile, stableJson(inspection.catalog));
  fs.writeFileSync(inspectionFile, stableJson(inspection));
  return Object.freeze({
    inspection,
    catalogFile,
    inspectionFile,
    files: Object.freeze({ catalog: path.basename(catalogFile), inspection: path.basename(inspectionFile) })
  });
}

function eventManifestProjection(written) {
  return written ? Object.freeze({ ...written.inspection, files: written.files }) : undefined;
}

function assertEventCommandEligible(project, compiled, command, descriptor = targetDescriptor(project)) {
  const support = selectedEventTargetSupport(project, compiled, descriptor);
  if (!support) return null;
  const commandSupport = support.commands.find((entry) => entry.id === command);
  if (!commandSupport || commandSupport.status !== 'eligible') {
    const code = support.diagnosticCode || 'PULSE_EVENT_TARGET_UNSUPPORTED';
    throw new PulseProjectError(
      code,
      `pulse ${command} cannot realize the event plane for ${project.provider}/${project.target || 'native'}.`,
      {
        provider: project.provider,
        target: project.target || 'native',
        command,
        eventTargetSupport: support,
        automaticFallback: false
      }
    );
  }
  return support;
}

function projectPlanInspection(project, compiled) {
  const profile = project.selectedProfile || project.profile || null;
  return Object.freeze({
    mode: 'conventional',
    workspace: project.workspace ? Object.freeze({
      root: project.workspace.root,
      configFile: project.workspace.configFile,
      source: project.workspace.source
    }) : null,
    projectHash: project.projectHash,
    planHash: project.planHash,
    selectedProfile: profile ? Object.freeze({
      name: profile.name,
      source: profile.source,
      host: profile.host,
      target: profile.target,
      reporting: profile.reporting,
      reportingLevel: project.reportingLevel
    }) : null,
    strict: project.strict !== false,
    bindings: Object.freeze({
      config: Object.freeze([...(project.bindings && project.bindings.config || [])]),
      secret: Object.freeze([...(project.bindings && project.bindings.secret || [])])
    }),
    fragments: Object.freeze({
      keys: Object.freeze(Object.keys(project.fragments || {}).sort()),
      ownership: compiled && compiled.packageProduct
        ? compiled.packageProduct.fragments
        : Object.freeze([]),
      unclaimed: compiled && compiled.packageProduct
        ? Object.freeze(compiled.packageProduct.fragments.filter((entry) => entry.present && !entry.contractId).map((entry) => entry.key))
        : Object.freeze(Object.keys(project.fragments || {}).sort())
    }),
    crypto: Object.freeze({
      declaration: project.profilePlan && project.profilePlan.crypto || null,
      realizationPlan: compiled && compiled.cryptoRealizationPlan || null
    }),
    application: compiled && (compiled.application || compiled.metadata && compiled.metadata.application) || null
  });
}

function jsonPolicyInspection(project, compiled, nativePlan) {
  const policy = compiled && compiled.metadata && compiled.metadata.json;
  return Object.freeze({
    strict: project.strict !== false,
    schemaBoundRequestCount: Number(policy && policy.schemaBoundRequestCount || 0),
    genericRequestCount: Number(policy && policy.genericRequestCount || 0),
    genericParserRequired: Boolean(policy && policy.genericParserRequired),
    maxBytes: Number(policy && policy.maxBytes || project.schemas && project.schemas.maxBytes || 65536),
    native: nativePlan && nativePlan.json || null
  });
}

function compileProject(project, options = {}) {
  const handlerAuthoring = options.handlerAuthoring || HANDLER_AUTHORING_MODES.ASYNC_REQUIRED;
  const configuredTarget = options.target || project.target || 'native';
  const packageTargetDescriptor = getProviderTargetDescriptor(providerDriver(project), configuredTarget);
  return compileCanonicalProject(project.entryFile, {
    target: configuredTarget,
    rootDir: project.root,
    // Package lowerers are discovered from the nearest package-manager workspace.
    // The Pulse project root remains authoritative for config and paths, but a
    // conventional project may live inside a larger source workspace.
    workspaceRoot: undefined,
    configFile: project.configFile,
    schemas: project.schemas,
    strict: project.strict !== false,
    emitJsonPolicy: true,
    handlerAuthoring,
    requireAsync: handlerAuthoring === HANDLER_AUTHORING_MODES.ASYNC_REQUIRED,
    requireEffectAwait: false,
    packageTargetDescriptor,
    packageTarget: configuredTarget,
    applicationProjectMetadata: Object.freeze({
      constructionMode: 'auto',
      projectHash: project.projectHash,
      configPlanHash: project.planHash,
      selectedProfile: project.profile,
      strict: project.strict !== false,
      bindings: project.bindings,
      fragments: project.fragments,
      crypto: project.profilePlan && project.profilePlan.crypto,
      reporting: project.reporting,
      reportingLevel: project.reportingLevel,
      target: configuredTarget,
      host: project.provider || null
    })
  });
}

function compileNativeProjectInMemory(project, options = {}) {
  let compiled;
  try {
    compiled = options.compiled && options.compiled.target !== 'javascript'
      ? options.compiled
      : compileProject(project, { ...options, target: 'native' });
  } catch (error) {
    // Native inspection is independent of a successful JavaScript compilation.
    // Keep its rejection in the Native diagnostic lane used by doctor/inspect.
    if ((project.target || 'native') !== 'javascript' || !Array.isArray(error.diagnostics)) throw error;
    const failure = new CanonicalNativePlanError(error.message, error.diagnostics);
    failure.detail = Object.freeze({ ...error.detail, causeCode: error.code, automaticFallback: false });
    throw failure;
  }
  const plan = buildCanonicalNativePlan(compiled, { reporting: project.reporting });
  const native = compileCanonicalNativePlan(plan, {
    cwd: project.root,
    projectRoot: project.root,
    profile: project.selectedProfile && project.selectedProfile.name || project.profile && project.profile.name || 'native',
    targetDescriptor: getProviderTargetDescriptor(providerDriver(project), 'native'),
    synchronizedPackages: releaseCatalog.packages.map(({ name, version }) => Object.freeze({ name, version })),
    timeoutMs: options.timeoutMs,
    nativeOptimization: options.experimentalNativeSize === true
      ? 'experimental-native-size'
      : options.nativeOptimization
  });
  return Object.freeze({ compiled, plan, native });
}

function providerDriver(project) {
  return getProviderDriver(project.providerSelector || project.provider, {
    projectRoot: project.root
  });
}

function targetDescriptor(project, target = project.target || 'native') {
  return Object.freeze({
    ...getProviderTargetDescriptor(providerDriver(project), target),
    resolvedReporting: project.reportingPolicy
  });
}

function selectedProviderTarget(project, target = project.target || 'native') {
  return getProviderTargetDescriptor(providerDriver(project), target);
}

function assertImplementedTarget(project, command) {
  const target = project.target || 'native';
  const descriptor = targetDescriptor(project, target);
  if (!descriptor.commands || descriptor.commands[command] !== true) {
    throw new PulseProjectError(
      'PULSE_TARGET_IMPLEMENTATION_PENDING',
      `pulse ${command} cannot realize the selected ${target} target yet.`,
      {
        target,
        command,
        provider: project.provider,
        selectedProfile: project.profile,
        supportedCommands: Object.freeze(Object.entries(descriptor.commands || {}).filter(([, supported]) => supported).map(([name]) => name)),
        targetDescriptor: descriptor,
        targetSupport: getProviderTargetSupportDeclaration(providerDriver(project), target),
        automaticFallback: false
      }
    );
  }
  return descriptor;
}

function javascriptLoadFailure(error) {
  if (!error) return null;
  return Object.freeze({
    name: error.name ? String(error.name) : 'Error',
    code: error.code ? String(error.code) : null,
    message: error.message ? String(error.message) : String(error),
    detail: error.detail && typeof error.detail === 'object' ? Object.freeze({ ...error.detail }) : null,
    diagnostics: Array.isArray(error.diagnostics) ? Object.freeze([...error.diagnostics]) : Object.freeze([])
  });
}

function prepareJavascriptApplication(project, options = {}) {
  const descriptor = targetDescriptor(project, 'javascript');
  const javascript = providerDriver(project).javascript;
  const plan = buildJavascriptApplicationPlan(project.entryFile, {
    rootDir: project.root,
    workspaceRoot: undefined,
    configFile: project.configFile,
    projectFragments: project.fragments,
    provider: project.provider,
    targetId: descriptor.targetId,
    providerLifecycleDeferred: descriptor.lifecycle !== true,
    capabilityEnvelope: descriptor.capabilities || Object.freeze({
      version: 'pulse.javascript-capability-envelope.v1',
      provider: project.provider,
      status: descriptor.requestAdapter === true ? 'request-lifecycle-ready' : 'provider-adapters-deferred',
      core: Object.freeze({ request: descriptor.requestAdapter === true, response: descriptor.requestAdapter === true, state: true }),
      effects: Object.freeze({ fetch: false, config: false, secret: false, kv: false }),
      packages: Object.freeze([])
    })
  });
  let loaded = null;
  let loadError = null;
  let loadAttempted = false;
  let loadSkippedReason = null;
  const localEmulation = options.localEmulation === true && javascript && javascript.localEmulation === true;
  if (descriptor.applicationLoader === true && javascript && (javascript.validateApplication || (localEmulation && javascript.loadApplication))) {
    if (options.load === false) {
      loadSkippedReason = 'plan-only-evidence';
    } else if (options.captureLoadError === true && plan.loadable !== true) {
      loadSkippedReason = 'application-plan-not-loadable';
    } else {
      loadAttempted = true;
      try {
        loaded = localEmulation && javascript.loadApplication
          ? javascript.loadApplication(plan, {
              projectRoot: project.root,
              schemaBundle: options.schemaBundle
            })
          : loadJavascriptApplication(plan, {
              workspaceRoot: project.root,
              validateApplication: javascript.validateApplication,
              allowedPackages: options.allowedPackages
            });
      } catch (error) {
        if (options.captureLoadError !== true) throw error;
        loadError = javascriptLoadFailure(error);
      }
    }
  } else if (descriptor.applicationLoader === true && javascript && javascript.buildTimeLoader === true) {
    loadSkippedReason = 'provider-build-time-bundle-loader';
  } else {
    loadSkippedReason = 'provider-application-loader-unavailable';
  }
  return Object.freeze({ descriptor, plan, loaded, loadError, loadAttempted, loadSkippedReason });
}

function selectedTargetSupportEvidence(project, compiled, javascriptApplication, descriptor, options = {}) {
  if ((project.target || 'native') !== 'javascript') return null;
  const javascript = providerDriver(project).javascript;
  const policy = javascript && javascript.targetSupportPolicy;
  if (!policy) {
    const runtimeContracts = new Set(javascriptApplication.plan.packages.map((entry) => entry.contractId));
    const providerDependent = (compiled.packageProduct && compiled.packageProduct.contracts || [])
      .filter((entry) => runtimeContracts.has(entry.contractId) && entry.javascriptTarget
        && entry.javascriptTarget.status === 'provider-dependent');
    if (providerDependent.length) throw new PulseProjectError(
      'PULSE_PROVIDER_CAPABILITY_UNSUPPORTED',
      'Provider-dependent JavaScript packages require a selected provider target-support policy.',
      { provider: project.provider, target: 'javascript',
        packages: providerDependent.map((entry) => entry.packageName), automaticFallback: false }
    );
    return null;
  }
  return buildJavascriptTargetSupportEvidence(project, {
    compiled,
    javascriptApplication,
    descriptor: descriptor || javascriptApplication && javascriptApplication.descriptor,
    declaration: options.targetSupportDeclaration
  }, policy);
}

function assertExecutableProvider(project, command) {
  const driver = providerDriver(project);
  if (!driver.executable) {
    throw new PulseProjectError(
      command === 'test' ? 'PULSE_TEST_PROVIDER_REQUIRED' : 'PULSE_DEV_PROVIDER_UNSUPPORTED',
      `pulse ${command} requires an executable provider.`,
      { provider: project.provider, supported: providerIds({ executable: true }) }
    );
  }
  return driver;
}

function providerExecutionOptions(project, values = {}) {
  const driver = providerDriver(project);
  const resolved = { ...values, reporting: project.reporting };
  return driver.executionOptions ? driver.executionOptions(project.providerConfig, resolved) : resolved;
}

function requiresExactNativeExecution(compiled) {
  const algorithms = compiled.cryptoRealizationPlan && compiled.cryptoRealizationPlan.algorithms || [];
  const operations = compiled.metadata && compiled.metadata.providerOperations || [];
  return algorithms.some((entry) => entry.kind === 'guest-linked' || entry.kind === 'guest-source')
    || (compiled.metadata?.router?.entries || []).some((entry) => entry.kind === 'error')
    || operations.some((entry) => ['kv.getVersioned', 'kv.insertIfAbsent', 'kv.compareAndSwap'].includes(entry.capability));
}

function prepareNativeExecution(project, compiled, native) {
  const driver = providerDriver(project);
  if (typeof driver.prepareNativeExecution !== 'function') {
    throw new TypeError(`Provider ${driver.id} cannot execute this Native artifact locally.`);
  }
  const execute = driver.prepareNativeExecution(providerTargetInvocation(
    project, 'execute-native', native.plan, providerLoweringPlan(project, compiled.metadata), { native }
  ));
  if (typeof execute !== 'function') throw new TypeError('Provider Native execution preparation must return a function.');
  return execute;
}

function providerLoweringPlan(project, metadata) {
  const driver = providerDriver(project);
  if (typeof driver.createLoweringPlan === 'function') {
    const input = createProviderPlanInput({
      version: PROVIDER_PLAN_INPUT_VERSION,
      capabilities: metadata && metadata.capabilities || [],
      providerOperations: metadata && metadata.providerOperations || [],
      opaqueReturnCount: metadata && metadata.opaqueReturnCount || 0
    });
    return driver.createLoweringPlan(input, project.providerConfig);
  }
  return Object.freeze({
    version: 'pulse.canonical-provider-plan.v1',
    contractVersion: 'pulse.canonical-provider-contract.v1',
    provider: 'none',
    providerVersion: 'internal',
    package: '',
    runtime: '',
    buildTarget: 'portable-native-wasm',
    deployable: false,
    localExecution: false,
    requirements: Object.freeze([]),
    bindings: Object.freeze({}),
    operations: Object.freeze([]),
    providerSpecificUserland: false,
    providerSdkUserland: false,
    capabilityDiscoveryFromUserland: false
  });
}

function synchronizedPackageFacts() {
  return Object.freeze(releaseCatalog.packages.map(
    ({ name, version }) => Object.freeze({ name, version })
  ));
}

function selectedProfileName(project) {
  return project.selectedProfile && project.selectedProfile.name
    || project.profile && project.profile.name
    || 'native';
}

function providerTargetInvocation(project, action, applicationPlan, providerPlan, options = {}) {
  const nativeArtifact = options.native ? createProviderNativeArtifact(options.native) : null;
  return createProviderTargetInvocation({
    version: PROVIDER_TARGET_INVOCATION_VERSION,
    action,
    provider: project.provider,
    selectedTarget: selectedProviderTarget(project, action.endsWith('javascript') ? 'javascript' : 'native'),
    applicationPlan,
    providerPlan,
    providerConfig: project.providerConfig,
    requirements: projectProviderRequirements(applicationPlan, providerPlan),
    nativeArtifact,
    javascript: options.javascript || null,
    project: Object.freeze({
      root: project.root,
      outDir: options.outDir || null,
      profile: selectedProfileName(project)
    }),
    synchronizedPackages: synchronizedPackageFacts(),
    optimization: options.optimization,
    timeoutMs: options.timeoutMs
  });
}

function canonicalFuturePath(candidate) {
  const requested = path.resolve(candidate);
  const suffix = [];
  let existing = requested;

  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }

  return Object.freeze({
    requested,
    existing,
    target: path.resolve(fs.realpathSync(existing), ...suffix)
  });
}

function resolveOutputDirectory(project, outDir) {
  const projectRoot = fs.realpathSync(path.resolve(project.root));
  const requestedTarget = path.isAbsolute(outDir)
    ? path.resolve(outDir)
    : path.resolve(projectRoot, outDir);

  const physical = canonicalFuturePath(requestedTarget);
  const target = physical.target;
  const relativeTarget = path.relative(projectRoot, target);

  if (
    !relativeTarget
    || relativeTarget.startsWith('..')
    || path.isAbsolute(relativeTarget)
  ) {
    throw new PulseProjectError(
      'PULSE_BUILD_OUT_UNSAFE',
      `Pulse build output must be a child directory of the project root: ${requestedTarget}`,
      { outDir: requestedTarget, projectRoot }
    );
  }

  let current = physical.existing;

  for (;;) {
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new PulseProjectError(
        'PULSE_BUILD_OUT_UNSAFE',
        `Pulse build output must not traverse a symbolic link: ${current}`,
        { outDir: requestedTarget, projectRoot, symbolicLink: current }
      );
    }

    if (fs.realpathSync(current) === projectRoot) break;

    const parent = path.dirname(current);
    if (parent === current) {
      throw new PulseProjectError(
        'PULSE_BUILD_OUT_UNSAFE',
        `Pulse build output resolves outside the project root: ${requestedTarget}`,
        { outDir: requestedTarget, projectRoot }
      );
    }

    current = parent;
  }

  return target;
}

function cleanOutputDirectory(project, outDir) {
  const target = resolveOutputDirectory(project, outDir);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function buildProject(project, options = {}) {
  const driver = providerDriver(project);
  if (options.sourceOnly === true) {
    throw new PulseProjectError(
      'PULSE_SOURCE_ONLY_REMOVED',
      'pulse build --source-only was removed. Native builds always emit generated source and provider Wasm together.',
      { provider: project.provider, replacement: 'pulse build' }
    );
  }
  if (options.experimentalNativeSize === true && (project.target || 'native') !== 'native') {
    throw new PulseProjectError(
      'PULSE_EXPERIMENTAL_NATIVE_SIZE_UNSUPPORTED',
      'The --experimental-native-size flag is available only for Native compilation.',
      {
        target: project.target || 'native',
        required: Object.freeze({ target: 'native' })
      }
    );
  }
  if (!driver.executable) {
    throw new PulseProjectError(
      'PULSE_BUILD_PROVIDER_REQUIRED',
      'pulse build requires a deployment provider in the active .pulse/config.ts profile. Use pulse compile for provider-neutral Wasm.',
      { provider: project.provider, supported: providerIds({ executable: true }), replacement: 'pulse compile' }
    );
  }
  const descriptor = assertImplementedTarget(project, 'build');

  if ((project.target || 'native') === 'javascript') {
    const javascriptApplication = prepareJavascriptApplication(project, {
      load: false,
      captureLoadError: true,
      allowedPackages: options.allowedPackages
    });
    if (javascriptApplication.plan.loadable !== true) {
      throw new PulseProjectError(
        'PULSE_JAVASCRIPT_SOURCE_PACKAGE_PLAN_UNAVAILABLE',
        'pulse build requires a loadable JavaScript application plan.',
        {
          provider: project.provider,
          target: 'javascript',
          blockers: javascriptApplication.plan.blockers,
          automaticFallback: false
        }
      );
    }
    const compiled = compileProject(project);
    const eventSupport = assertEventCommandEligible(project, compiled, 'build', descriptor);
    const targetSupport = selectedTargetSupportEvidence(project, compiled, javascriptApplication, descriptor, options);
    if (targetSupport && targetSupport.project.status !== 'eligible') {
      throw new PulseProjectError(
        'PULSE_PROVIDER_CAPABILITY_UNSUPPORTED',
        'pulse build cannot realize one or more project capabilities for the selected JavaScript target.',
        {
          provider: project.provider,
          target: 'javascript',
          status: targetSupport.project.status,
          reasonIds: targetSupport.project.reasonIds,
          targetSupport,
          automaticFallback: false
        }
      );
    }
    const requestedOutDir = options.outDir || project.outDir;
    const outDir = options.clean === false
      ? resolveOutputDirectory(project, requestedOutDir)
      : cleanOutputDirectory(project, requestedOutDir);
    const javascript = driver.javascript;
    if (!javascript || typeof javascript.writeSourcePackage !== 'function') {
      throw new PulseProjectError(
        'PULSE_TARGET_IMPLEMENTATION_PENDING',
        'The selected provider does not implement JavaScript source packaging.',
        { provider: project.provider, target: 'javascript', automaticFallback: false }
      );
    }
    const providerPlan = providerLoweringPlan(project, compiled.metadata);
    const invocation = providerTargetInvocation(
      project,
      'write-javascript',
      javascriptApplication.plan,
      providerPlan,
      {
        outDir,
        javascript: Object.freeze({
          schemaBundle: compiled.schema.bundle,
          reporting: project.reporting,
          strict: project.strict !== false,
          maxStructuredBodyBytes: project.schemas && project.schemas.maxBytes,
          targetSupport
        })
      }
    );
    const sourcePackage = javascript.writeSourcePackage(invocation);
    const sourcePackageDescription = javascript.describeSourcePackage(sourcePackage, {
      outDir,
      plan: javascriptApplication.plan
    });
    const packageInspection = writePackageInspectionArtifacts(compiled, outDir);
    const eventInspection = writeEventInspectionArtifacts(project, compiled, outDir, eventSupport);
    const manifest = Object.freeze({
      version: PROJECT_EXECUTION_VERSION,
      status: 'built',
      buildMode: 'javascript-source-package',
      provider: project.provider,
      configuredTarget: 'javascript',
      automaticFallback: false,
      reporting: project.reportingPolicy,
      cryptoRealizationPlan: compiled.cryptoRealizationPlan,
      targetDescriptor: Object.freeze({ ...descriptor, resolvedReporting: project.reportingPolicy }),
      providerTarget: Object.freeze({
        package: driver.descriptor && driver.descriptor.package,
        target: descriptor.targetId,
        status: descriptor.status,
        deployable: true,
        deploymentCandidate: sourcePackageDescription.deploymentCandidate,
        deploymentValidated: false,
        providerRealityValidated: false,
        sourcePackage: true,
        sourceOnly: true,
        nativeWasm: false,
        compiledWasmPresent: false,
        javascriptRuntime: true,
        jsComputeRuntime: false,
        downstreamJavascriptRuntimeWasm: sourcePackageDescription.downstreamJavascriptRuntimeWasm,
        executionReady: descriptor.requestAdapter === true && descriptor.lifecycle === true,
        applicationLoader: descriptor.applicationLoader === true,
        requestAdapter: descriptor.requestAdapter === true,
        lifecycle: descriptor.lifecycle === true
      }),
      project: Object.freeze({
        root: '.',
        config: project.configFile ? relative(project.configFile, project.root) : undefined,
        entry: relative(project.entryFile, project.root),
        outDir: '.'
      }),
      application: Object.freeze({
        plan: path.basename(sourcePackage.paths.applicationPlan),
        planHash: javascriptApplication.plan.planHash,
        graphHash: javascriptApplication.plan.graph.graphHash,
        loadable: true,
        sourcePackage: path.basename(sourcePackage.paths.manifest),
        entry: sourcePackageDescription.application.entry,
        package: path.basename(sourcePackage.paths.package),
        modules: sourcePackageDescription.application.modules,
        dependencies: sourcePackage.manifest.package.dependencies,
        ...sourcePackageDescription.application
      }),
      schemas: sourcePackage.manifest.schemas,
      packageInspection: packageInspectionManifest(packageInspection),
      ...(eventInspection ? { events: eventManifestProjection(eventInspection) } : {}),
      targetSupport
    });
    const manifestFile = path.join(outDir, BUILD_MANIFEST);
    fs.writeFileSync(manifestFile, stableJson(manifest));
    return Object.freeze({
      status: 'built',
      version: PROJECT_EXECUTION_VERSION,
      buildMode: 'javascript-source-package',
      provider: project.provider,
      configuredTarget: 'javascript',
      automaticFallback: false,
      project: projectJson(project),
      outDir,
      files: Object.freeze({
        entry: sourcePackage.paths.entry,
        package: sourcePackage.paths.package,
        applicationPlan: sourcePackage.paths.applicationPlan,
        schemaRegistry: sourcePackage.paths.schemaRegistry,
        schemaCodecs: sourcePackage.paths.schemaCodecs,
        ...sourcePackageDescription.files,
        sourcePackage: sourcePackage.paths.manifest,
        ...(eventInspection ? {
          eventCatalog: eventInspection.catalogFile,
          eventInspection: eventInspection.inspectionFile
        } : {}),
        manifest: manifestFile
      }),
      targetSupport,
      packageInspection,
      ...(eventInspection ? { events: eventInspection.inspection } : {}),
      sourcePackage: sourcePackage.manifest,
      manifest
    });
  }

  const prepared = compileNativeProjectInMemory(project, options);
  const eventSupport = assertEventCommandEligible(project, prepared.compiled, 'build', descriptor);
  const requestedOutDir = options.outDir || project.outDir;
  const outDir = options.clean === false
    ? resolveOutputDirectory(project, requestedOutDir)
    : cleanOutputDirectory(project, requestedOutDir);
  fs.mkdirSync(outDir, { recursive: true });

  const build = writeCanonicalBuild(prepared.compiled, outDir);
  const nativeBuild = writeCanonicalNativeModule(prepared.native, outDir);
  const packageInspection = writePackageInspectionArtifacts(prepared.compiled, outDir);
  const eventInspection = writeEventInspectionArtifacts(project, prepared.compiled, outDir, eventSupport);
  const lowering = providerLoweringPlan(project, prepared.compiled.metadata);
  const providerBuild = driver.writeTarget
    ? normalizeProviderTargetResult(driver.writeTarget(providerTargetInvocation(
        project,
        'write-native',
        prepared.plan,
        lowering,
        {
          outDir,
          native: prepared.native,
          optimization: prepared.native.manifest.optimization,
          timeoutMs: options.timeoutMs
        }
      )), { action: 'write-native', provider: project.provider, target: 'native' })
    : undefined;
  const providerFiles = providerBuild ? providerBuild.files : Object.freeze({});
  const providerBuildMetadata = providerBuild && providerBuild.build;
  const nativeManifest = prepared.native.manifest;

  const manifest = Object.freeze({
    version: PROJECT_EXECUTION_VERSION,
    status: 'built',
    buildMode: 'native-provider',
    provider: project.provider,
    configuredTarget: 'native',
    reporting: project.reportingPolicy,
    cryptoRealizationPlan: prepared.compiled.cryptoRealizationPlan,
    targetDescriptor: targetDescriptor(project, 'native'),
    providerTarget: Object.freeze({
      package: driver.descriptor && driver.descriptor.package,
      buildTarget: driver.descriptor && driver.descriptor.buildTarget,
      target: providerBuildMetadata && providerBuildMetadata.target,
      deployable: driver.deployable === true,
      deploymentValidated: driver.deploymentValidated === true,
      sourcePackage: driver.sourcePackage === true,
      sourceOnly: false,
      sourceOnlySupported: false,
      nativeWasm: true,
      providerNeutralInput: true,
      compiledWasmPresent: true,
      javascriptRuntime: false,
      jsComputeRuntime: false,
      compiler: providerBuildMetadata && providerBuildMetadata.compiler,
      optimization: providerBuildMetadata && providerBuildMetadata.optimization,
      wasm: providerBuildMetadata && providerBuildMetadata.wasm,
      wat: providerBuildMetadata && providerBuildMetadata.wat,
      importModules: providerBuildMetadata && providerBuildMetadata.importModules,
      imports: providerBuildMetadata && providerBuildMetadata.imports,
      exports: providerBuildMetadata && providerBuildMetadata.exports,
      localConformanceRuntime: driver.localExecution === true,
      lowering
    }),
    project: Object.freeze({
      root: '.',
      config: project.configFile ? relative(project.configFile, project.root) : undefined,
      entry: relative(project.entryFile, project.root),
      outDir: relative(outDir, project.root)
    }),
    program: Object.freeze({
      file: path.basename(build.programFile),
      handler: path.basename(build.handlerFile),
      sourceHash: prepared.compiled.metadata.sourceHash,
      compilerVersion: prepared.compiled.metadata.compilerVersion,
      runtimeProtocolVersion: prepared.compiled.metadata.runtimeProtocolVersion,
      authoring: prepared.compiled.metadata.authoring,
      application: prepared.compiled.metadata.application,
      routing: prepared.plan.routing,
      json: prepared.compiled.metadata.json,
      warnings: prepared.compiled.metadata.warnings,
      warningCount: prepared.compiled.metadata.warningCount || 0,
      capabilities: prepared.compiled.metadata.capabilities,
      effectCount: prepared.compiled.metadata.effectCount,
      continuationCount: prepared.compiled.metadata.continuationCount,
      groupedContinuationCount: prepared.compiled.metadata.groupedContinuationCount,
      opaqueReturnCount: prepared.compiled.metadata.opaqueReturnCount,
      projectSourceHash: prepared.compiled.metadata.projectSourceHash,
      schemaReferenceCount: prepared.compiled.metadata.schemaReferenceCount,
      schemaSourceHash: prepared.compiled.metadata.schemaSourceHash
    }),
    portable: Object.freeze({
      target: 'portable-native-wasm',
      providerNeutral: true,
      version: prepared.native.version,
      compilerVersion: prepared.native.compilerVersion,
      planVersion: prepared.plan.version,
      planCompilerVersion: prepared.plan.compilerVersion,
      planHash: prepared.plan.planHash,
      ownership: prepared.plan.ownership,
      summary: prepared.plan.summary,
      logging: prepared.plan.logging,
      ...(prepared.plan.json ? { json: prepared.plan.json } : {}),
      ...(prepared.plan.requestState ? { requestState: prepared.plan.requestState } : {}),
      assemblyScript: nativeManifest.assemblyScript,
      optimization: nativeManifest.optimization,
      source: Object.freeze({ file: path.basename(nativeBuild.sourceFile), sha256: prepared.native.sourceHash }),
      wasm: Object.freeze({ file: path.basename(nativeBuild.wasmFile), ...nativeManifest.wasm }),
      wat: Object.freeze({ file: path.basename(nativeBuild.watFile), ...nativeManifest.wat }),
      plan: path.basename(nativeBuild.planFile),
      manifest: path.basename(nativeBuild.manifestFile),
      packageRealizationArtifacts: Object.freeze({
        ...(nativeBuild.realizationArtifactsFile
          ? { file: path.basename(nativeBuild.realizationArtifactsFile) }
          : {}),
        ...nativeManifest.packageRealizationArtifacts
      }),
      ...(nativeBuild.guestUnitPlanFile ? {
        guestUnit: Object.freeze({
          plan: path.basename(nativeBuild.guestUnitPlanFile),
          report: path.basename(nativeBuild.guestLinkReportFile),
          audit: path.basename(nativeBuild.finalWasmAuditFile),
          finalArtifact: nativeManifest.guestLinkReport.finalArtifact,
          providerPackaging: nativeManifest.providerPackaging
        })
      } : {}),
      importModules: nativeManifest.importModules,
      imports: nativeManifest.imports,
      exports: nativeManifest.exports,
      policy: nativeManifest.policy
    }),
    schemas: Object.freeze({
      active: prepared.compiled.schema.active,
      registry: build.schemaRegistryFile ? path.basename(build.schemaRegistryFile) : undefined,
      codecs: build.schemaCodecsFile ? path.basename(build.schemaCodecsFile) : undefined,
      ids: prepared.compiled.metadata.schemaIds,
      references: prepared.compiled.metadata.schemaReferences,
      sourceHash: prepared.compiled.metadata.schemaSourceHash,
      policy: prepared.compiled.metadata.json
    }),
    packageInspection: packageInspectionManifest(packageInspection),
    ...(eventInspection ? { events: eventManifestProjection(eventInspection) } : {})
  });
  const manifestFile = path.join(outDir, BUILD_MANIFEST);
  fs.writeFileSync(manifestFile, stableJson(manifest));
  return Object.freeze({
    status: 'built',
    version: PROJECT_EXECUTION_VERSION,
    buildMode: 'native-provider',
    provider: project.provider,
    project: projectJson(project),
    outDir,
    files: Object.freeze({
      handler: build.handlerFile,
      program: build.programFile,
      schemaRegistry: build.schemaRegistryFile,
      schemaCodecs: build.schemaCodecsFile,
      nativeSource: nativeBuild.sourceFile,
      nativeWasm: nativeBuild.wasmFile,
      nativeWat: nativeBuild.watFile,
      nativePlan: nativeBuild.planFile,
      nativeManifest: nativeBuild.manifestFile,
      nativePackageArtifacts: nativeBuild.realizationArtifactsFile,
      guestUnitPlan: nativeBuild.guestUnitPlanFile,
      guestLinkReport: nativeBuild.guestLinkReportFile,
      finalWasmAudit: nativeBuild.finalWasmAuditFile,
      ...(eventInspection ? {
        eventCatalog: eventInspection.catalogFile,
        eventInspection: eventInspection.inspectionFile
      } : {}),
      manifest: manifestFile,
      ...providerFiles
    }),
    metadata: prepared.compiled.metadata,
    packageInspection,
    ...(eventInspection ? { events: eventInspection.inspection } : {}),
    native: Object.freeze({
      version: prepared.native.version,
      compilerVersion: prepared.native.compilerVersion,
      planVersion: prepared.plan.version,
      planHash: prepared.plan.planHash,
      summary: prepared.plan.summary,
      logging: prepared.plan.logging,
      ...(prepared.plan.json ? { json: prepared.plan.json } : {}),
      ...(prepared.plan.requestState ? { requestState: prepared.plan.requestState } : {}),
      assemblyScript: nativeManifest.assemblyScript,
      optimization: nativeManifest.optimization,
      wasm: nativeManifest.wasm,
      importModules: nativeManifest.importModules,
      exports: nativeManifest.exports
    }),
    manifest
  });
}

function compileNativeProject(project, options = {}) {
  const requestedOutDir = options.outDir || project.outDir;
  const outDir = options.clean === false
    ? resolveOutputDirectory(project, requestedOutDir)
    : cleanOutputDirectory(project, requestedOutDir);
  fs.mkdirSync(outDir, { recursive: true });

  const prepared = compileNativeProjectInMemory(project, options);
  const javascriptApplication = (project.target || 'native') === 'javascript'
    ? prepareJavascriptApplication(project, { load: false, captureLoadError: true, allowedPackages: options.allowedPackages })
    : null;
  const targetSupport = javascriptApplication
    ? selectedTargetSupportEvidence(project, prepared.compiled, javascriptApplication, javascriptApplication.descriptor, options)
    : null;
  const eventSupport = selectedEventTargetSupport(project, prepared.compiled);
  const build = writeCanonicalBuild(prepared.compiled, outDir);
  const nativeBuild = writeCanonicalNativeModule(prepared.native, outDir);
  const packageInspection = writePackageInspectionArtifacts(prepared.compiled, outDir);
  const eventInspection = writeEventInspectionArtifacts(project, prepared.compiled, outDir, eventSupport);
  const nativeManifest = prepared.native.manifest;
  const manifest = Object.freeze({
    version: PROJECT_EXECUTION_VERSION,
    status: 'compiled',
    target: 'portable-native-wasm',
    provider: null,
    providerNeutral: true,
    configuredProvider: project.provider,
    configuredTarget: project.target || 'native',
    automaticFallback: false,
    reporting: project.reportingPolicy,
    cryptoRealizationPlan: prepared.compiled.cryptoRealizationPlan,
    ...(targetSupport ? { targetSupport } : {}),
    project: Object.freeze({
      root: '.',
      config: project.configFile ? relative(project.configFile, project.root) : undefined,
      entry: relative(project.entryFile, project.root),
      outDir: relative(outDir, project.root)
    }),
    program: Object.freeze({
      file: path.basename(build.programFile),
      handler: path.basename(build.handlerFile),
      sourceHash: prepared.compiled.metadata.sourceHash,
      compilerVersion: prepared.compiled.metadata.compilerVersion,
      runtimeProtocolVersion: prepared.compiled.metadata.runtimeProtocolVersion,
      authoring: prepared.compiled.metadata.authoring,
      application: prepared.compiled.metadata.application,
      routing: prepared.plan.routing,
      json: prepared.compiled.metadata.json,
      warnings: prepared.compiled.metadata.warnings,
      warningCount: prepared.compiled.metadata.warningCount || 0,
      capabilities: prepared.compiled.metadata.capabilities,
      effectCount: prepared.compiled.metadata.effectCount,
      continuationCount: prepared.compiled.metadata.continuationCount,
      groupedContinuationCount: prepared.compiled.metadata.groupedContinuationCount,
      opaqueReturnCount: prepared.compiled.metadata.opaqueReturnCount,
      projectSourceHash: prepared.compiled.metadata.projectSourceHash,
      schemaReferenceCount: prepared.compiled.metadata.schemaReferenceCount,
      schemaSourceHash: prepared.compiled.metadata.schemaSourceHash
    }),
    native: Object.freeze({
      version: prepared.native.version,
      compilerVersion: prepared.native.compilerVersion,
      planVersion: prepared.plan.version,
      planCompilerVersion: prepared.plan.compilerVersion,
      planHash: prepared.plan.planHash,
      ownership: prepared.plan.ownership,
      summary: prepared.plan.summary,
      logging: prepared.plan.logging,
      ...(prepared.plan.json ? { json: prepared.plan.json } : {}),
      ...(prepared.plan.requestState ? { requestState: prepared.plan.requestState } : {}),
      assemblyScript: nativeManifest.assemblyScript,
      optimization: nativeManifest.optimization,
      source: Object.freeze({
        file: path.basename(nativeBuild.sourceFile),
        sha256: prepared.native.sourceHash
      }),
      wasm: Object.freeze({
        file: path.basename(nativeBuild.wasmFile),
        ...nativeManifest.wasm
      }),
      wat: Object.freeze({
        file: path.basename(nativeBuild.watFile),
        ...nativeManifest.wat
      }),
      plan: path.basename(nativeBuild.planFile),
      manifest: path.basename(nativeBuild.manifestFile),
      packageRealizationArtifacts: Object.freeze({
        ...(nativeBuild.realizationArtifactsFile
          ? { file: path.basename(nativeBuild.realizationArtifactsFile) }
          : {}),
        ...nativeManifest.packageRealizationArtifacts
      }),
      ...(nativeBuild.guestUnitPlanFile ? {
        guestUnit: Object.freeze({
          plan: path.basename(nativeBuild.guestUnitPlanFile),
          report: path.basename(nativeBuild.guestLinkReportFile),
          audit: path.basename(nativeBuild.finalWasmAuditFile),
          finalArtifact: nativeManifest.guestLinkReport.finalArtifact,
          providerPackaging: nativeManifest.providerPackaging
        })
      } : {}),
      importModules: nativeManifest.importModules,
      imports: nativeManifest.imports,
      exports: nativeManifest.exports,
      policy: nativeManifest.policy
    }),
    schemas: Object.freeze({
      active: prepared.compiled.schema.active,
      registry: build.schemaRegistryFile ? path.basename(build.schemaRegistryFile) : undefined,
      codecs: build.schemaCodecsFile ? path.basename(build.schemaCodecsFile) : undefined,
      ids: prepared.compiled.metadata.schemaIds,
      references: prepared.compiled.metadata.schemaReferences,
      sourceHash: prepared.compiled.metadata.schemaSourceHash,
      policy: prepared.compiled.metadata.json
    }),
    packageInspection: packageInspectionManifest(packageInspection),
    ...(eventInspection ? { events: eventManifestProjection(eventInspection) } : {})
  });
  const manifestFile = path.join(outDir, COMPILE_MANIFEST);
  fs.writeFileSync(manifestFile, stableJson(manifest));

  return Object.freeze({
    status: 'compiled',
    version: PROJECT_EXECUTION_VERSION,
    target: 'portable-native-wasm',
    provider: null,
    providerNeutral: true,
    configuredProvider: project.provider,
    configuredTarget: project.target || 'native',
    automaticFallback: false,
    targetSupport,
    project: projectJson(project),
    outDir,
    files: Object.freeze({
      handler: build.handlerFile,
      program: build.programFile,
      schemaRegistry: build.schemaRegistryFile,
      schemaCodecs: build.schemaCodecsFile,
      nativeSource: nativeBuild.sourceFile,
      nativeWasm: nativeBuild.wasmFile,
      nativeWat: nativeBuild.watFile,
      nativePlan: nativeBuild.planFile,
      nativeManifest: nativeBuild.manifestFile,
      nativePackageArtifacts: nativeBuild.realizationArtifactsFile,
      guestUnitPlan: nativeBuild.guestUnitPlanFile,
      guestLinkReport: nativeBuild.guestLinkReportFile,
      finalWasmAudit: nativeBuild.finalWasmAuditFile,
      ...(eventInspection ? {
        eventCatalog: eventInspection.catalogFile,
        eventInspection: eventInspection.inspectionFile
      } : {}),
      manifest: manifestFile
    }),
    metadata: prepared.compiled.metadata,
    packageInspection,
    ...(eventInspection ? { events: eventInspection.inspection } : {}),
    native: Object.freeze({
      version: prepared.native.version,
      compilerVersion: prepared.native.compilerVersion,
      planVersion: prepared.plan.version,
      planHash: prepared.plan.planHash,
      summary: prepared.plan.summary,
      logging: prepared.plan.logging,
      ...(prepared.plan.json ? { json: prepared.plan.json } : {}),
      ...(prepared.plan.requestState ? { requestState: prepared.plan.requestState } : {}),
      assemblyScript: nativeManifest.assemblyScript,
      optimization: nativeManifest.optimization,
      wasm: nativeManifest.wasm,
      importModules: nativeManifest.importModules,
      exports: nativeManifest.exports
    }),
    manifest
  });
}

function headerValue(headers, name) {
  const lower = String(name).toLowerCase();
  const values = (headers || []).filter(([key]) => String(key).toLowerCase() === lower).map(([, value]) => String(value));
  return values.length <= 1 ? values[0] : values;
}

function responseJson(response) {
  if (response.bodyClass === 'opaque') throw new Error('Opaque response cannot be decoded as JSON.');
  return JSON.parse(response.body || 'null');
}

function statusAllowsResponseBody(status) {
  const value = Number(status);
  return value !== 204 && value !== 205 && value !== 304 && !(value >= 100 && value < 200);
}

function observableTestResponse(testCase, response) {
  const method = String(testCase.request && testCase.request.method || 'GET').toUpperCase();
  if (method !== 'HEAD' && statusAllowsResponseBody(response.status)) return response;
  return Object.freeze({ ...response, body: '' });
}

function materializeTestResponse(response) {
  if (!response || response.bodyClass !== 'opaque' || response.body !== undefined) return response;
  const chunks = response.bodyStream && Array.isArray(response.bodyStream.chunks)
    ? response.bodyStream.chunks
    : undefined;
  if (!chunks) return response;
  const body = Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk)
    ? chunk
    : chunk instanceof Uint8Array
      ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      : Buffer.from(String(chunk)))).toString('utf8');
  return Object.freeze({ ...response, body });
}

function assertExpectation(testCase, execution) {
  const expected = testCase.expect;
  const response = observableTestResponse(testCase, execution.response);
  if (expected.status !== undefined) assert.equal(response.status, expected.status, `${testCase.name}: unexpected status`);
  if (expected.bodyClass !== undefined) assert.equal(response.bodyClass, expected.bodyClass, `${testCase.name}: unexpected body class`);
  if (Object.prototype.hasOwnProperty.call(expected, 'json') && expected.json !== undefined) assert.deepEqual(responseJson(response), expected.json, `${testCase.name}: unexpected JSON body`);
  if (expected.text !== undefined) assert.equal(String(response.body || ''), expected.text, `${testCase.name}: unexpected text body`);
  if (expected.headers) {
    for (const [name, value] of expected.headers) assert.deepEqual(headerValue(response.headers, name), value, `${testCase.name}: unexpected header ${name}`);
  }
}

function secretTokens(secrets) {
  return [...new Set(Object.values(secrets || {})
    .filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((left, right) => right.length - left.length);
}

function redactString(value, tokens) {
  let text = String(value);
  for (const token of tokens) text = text.split(token).join('<redacted>');
  return text;
}

function redactValue(value, tokens, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value, tokens);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return '<binary>';
  if (seen.has(value)) return '<circular>';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, tokens, seen));
  const out = {};
  for (const [key, entry] of Object.entries(value)) out[key] = redactValue(entry, tokens, seen);
  return out;
}

function errorSummary(error, secrets) {
  const tokens = secretTokens(secrets);
  const code = error && error.code ? String(error.code) : undefined;
  const descriptor = describeDiagnostic(code);
  const diagnostics = error && Array.isArray(error.diagnostics)
    ? Object.freeze(redactValue(error.diagnostics, tokens).map((entry) => decorateDiagnostic(entry)))
    : undefined;
  return Object.freeze({
    name: error && error.name ? String(error.name) : 'Error',
    code,
    title: descriptor.title,
    summary: descriptor.summary,
    category: descriptor.category,
    message: redactString(error && error.message ? error.message : String(error), tokens),
    remediation: descriptor.remediation,
    stability: descriptor.stability,
    scope: descriptor.scope,
    docs: descriptor.docs,
    detail: error && error.detail ? Object.freeze(redactValue(error.detail, tokens)) : undefined,
    diagnostics,
    execution: error && error.execution ? Object.freeze(redactValue({
      executionId: error.execution.executionId,
      resolutionOrder: error.execution.resolutionOrder,
      continuations: error.execution.continuations
    }, tokens)) : undefined
  });
}

function assertExpectedError(testCase, error) {
  const expected = testCase.expect.error;
  if (!expected) throw error;
  if (expected.name !== undefined) assert.equal(error.name, expected.name, `${testCase.name}: unexpected error name`);
  if (expected.code !== undefined) assert.equal(error.code, expected.code, `${testCase.name}: unexpected error code`);
  if (expected.category !== undefined) assert.equal(error.category, expected.category, `${testCase.name}: unexpected error category`);
  if (expected.message !== undefined) assert.match(String(error.message || ''), new RegExp(String(expected.message)), `${testCase.name}: unexpected error message`);
}

function assertEventExpectation(testCase, execution) {
  const expected = testCase.expect;
  const result = eventContracts.normalizeEventExecutionResult(execution.result);
  assert.equal(result.status, expected.status, `${testCase.name}: unexpected event execution status`);
  if (expected.error) {
    assert.ok(result.error, `${testCase.name}: expected an event execution error`);
    if (expected.error.name !== undefined) assert.equal(result.error.name, expected.error.name, `${testCase.name}: unexpected event error name`);
    if (expected.error.code !== undefined) assert.equal(result.error.code, expected.error.code, `${testCase.name}: unexpected event error code`);
    if (expected.error.category !== undefined) assert.equal(result.error.category, expected.error.category, `${testCase.name}: unexpected event error category`);
    if (expected.error.message !== undefined) assert.match(String(result.error.message || ''), new RegExp(String(expected.error.message)), `${testCase.name}: unexpected event error message`);
  }
  assert.deepEqual(execution.emittedFrames, expected.emitted, `${testCase.name}: unexpected emitted event frames`);
  return result;
}

async function executeProviderEventTestCase(driver, target, application, testCase, options = {}) {
  if (!driver.events || !driver.events.targets.includes(target) || typeof driver.events.executeTestCase !== 'function') {
    throw new PulseProjectError(
      'PULSE_EVENT_TARGET_UNSUPPORTED',
      `The selected ${driver.id}/${target} provider target does not implement event test execution.`,
      { provider: driver.id, target, command: 'test', automaticFallback: false }
    );
  }
  return driver.events.executeTestCase(Object.freeze({
    target,
    application,
    testCase,
    options: Object.freeze({ ...options })
  }));
}

function eventTestCaseResult(testCase, execution, result, started) {
  const evidence = execution.executionEvidence || {};
  const effectCount = Number(evidence.effectCount === undefined ? evidence.ownedEffectCount || 0 : evidence.effectCount);
  return Object.freeze({
    name: testCase.name,
    kind: 'event',
    status: 'passed',
    durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    event: Object.freeze({ type: testCase.event.type, schemaId: testCase.event.schemaId }),
    result,
    emittedFrames: Object.freeze(redactValue(execution.emittedFrames, secretTokens(testCase.secrets))),
    emittedFrameCount: execution.emittedFrames.length,
    effects: effectCount,
    adapter: execution.adapter
  });
}

async function runJavascriptProjectTests(project, options = {}) {
  const descriptor = assertImplementedTarget(project, 'test');
  const javascript = providerDriver(project).javascript;
  if (!javascript || typeof javascript.executeTestCase !== 'function' || descriptor.applicationLoader !== true || descriptor.requestAdapter !== true) {
    throw new PulseProjectError(
      'PULSE_TARGET_IMPLEMENTATION_PENDING',
      `pulse test cannot realize the selected javascript target for ${project.provider} yet.`,
      { target: 'javascript', command: 'test', provider: project.provider, targetDescriptor: descriptor, automaticFallback: false }
    );
  }
  const selected = options.caseName ? project.tests.filter((entry) => entry.name === options.caseName) : project.tests;
  if (selected.length === 0) {
    throw new PulseProjectError('PULSE_TEST_CASES_MISSING', options.caseName ? `No Pulse test case named ${options.caseName}.` : 'Pulse project defines no test cases.', { available: project.tests.map((entry) => entry.name) });
  }
  const localEmulation = javascript.localEmulation === true;
  const compiled = compileProject(project);
  const eventSupport = selectedEventTargetSupport(project, compiled, descriptor);
  if (eventSupport) assertEventCommandEligible(project, compiled, 'test', descriptor);
  if (selected.some((testCase) => testCase.kind === 'event') && !eventSupport) {
    throw new PulseProjectError('PULSE_TEST_EVENT_INVALID', 'The test harness contains an event case, but the application has no reachable event topology.');
  }
  const prepared = prepareJavascriptApplication(project, {
    allowedPackages: options.allowedPackages,
    localEmulation,
    schemaBundle: compiled.schema.bundle
  });
  if (!prepared.loaded) {
    throw new PulseProjectError('PULSE_JAVASCRIPT_APPLICATION_UNAVAILABLE', 'The graph-backed JavaScript application could not be loaded for project tests.', {
      planHash: prepared.plan.planHash,
      blockers: prepared.plan.blockers,
      automaticFallback: false
    });
  }
  const schemaCodecs = createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
  const cases = [];
  let failed = 0;
  for (const testCase of selected) {
    const started = process.hrtime.bigint();
    const jsonTrace = [];
    try {
      if (testCase.kind === 'event') {
        const execution = await executeProviderEventTestCase(providerDriver(project), 'javascript', prepared.loaded.application, testCase, {
          application: Object.freeze({
            projectHash: project.projectHash,
            planHash: project.planHash,
            profile: project.profile,
            target: 'javascript',
            provider: project.provider
          }),
          schemaCodecs,
          reporting: project.reporting,
          networkFetch: project.dev.networkFetch
        });
        const result = assertEventExpectation(testCase, execution);
        cases.push(eventTestCaseResult(testCase, execution, result, started));
        continue;
      }
      const runtimeOptions = {
        application: Object.freeze({
          projectHash: project.projectHash,
          planHash: project.planHash,
          profile: project.profile,
          target: 'javascript',
          provider: project.provider
        }),
        maxBodyBytes: testCase.maxBodyBytes === undefined
          ? (project.schemas.active ? project.schemas.maxBytes : undefined)
          : testCase.maxBodyBytes,
        schemaCodecs,
        strict: project.strict !== false,
        provider: project.provider,
        reporting: project.reporting,
        grip: testCase.grip,
        onJsonTrace(event) { jsonTrace.push(event); }
      };
      const execution = await javascript.executeTestCase(prepared.loaded.application, testCase, {
        ...runtimeOptions,
        bindings: project.providerConfig.bindings,
        maxDurationMs: project.providerConfig.maxDurationMs,
        networkFetch: project.dev.networkFetch
      });
      if (testCase.expect.error) throw new assert.AssertionError({ message: `${testCase.name}: expected ${testCase.expect.error.name || 'an error'} but execution completed` });
      assertExpectation(testCase, Object.freeze({
        ...execution,
        response: materializeTestResponse(execution.response)
      }));
      cases.push(Object.freeze({
        name: testCase.name,
        status: 'passed',
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        response: Object.freeze({ status: execution.response.status, bodyClass: execution.response.bodyClass, kind: execution.response.kind }),
        effects: execution.effectCount,
        ...(localEmulation ? { providerExecution: execution.provider } : {}),
        jsonTrace: Object.freeze(jsonTrace),
        continuations: execution.continuations,
        resolutionOrder: execution.resolutionOrder
      }));
    } catch (error) {
      try {
        if (testCase.kind === 'event') throw error;
        assertExpectedError(testCase, error);
        cases.push(Object.freeze({ name: testCase.name, status: 'passed', expectedError: errorSummary(error, testCase.secrets), durationMs: Number(process.hrtime.bigint() - started) / 1e6 }));
      } catch (assertion) {
        failed += 1;
        cases.push(Object.freeze({ name: testCase.name, status: 'failed', error: errorSummary(assertion === error ? error : assertion, testCase.secrets), actualError: assertion === error ? undefined : errorSummary(error, testCase.secrets), durationMs: Number(process.hrtime.bigint() - started) / 1e6 }));
      }
    }
  }
  return Object.freeze({
    status: failed === 0 ? 'passed' : 'failed',
    version: PROJECT_EXECUTION_VERSION,
    provider: project.provider,
    target: 'javascript',
    targetId: descriptor.targetId,
    automaticFallback: false,
    project: projectJson(project),
    applicationPlan: Object.freeze({
      version: prepared.plan.version,
      planHash: prepared.plan.planHash,
      graphHash: prepared.plan.graph.graphHash,
      nativeEligibility: prepared.plan.nativeEligibility,
      automaticFallback: false
    }),
    metadata: Object.freeze({
      runtimeClass: descriptor.runtimeClass,
      sourceApplication: true,
      schemaRegistryHash: compiled.metadata.schemaRegistryHash,
      schemaCodecTableHash: compiled.metadata.schemaCodecTableHash,
      schemaIds: compiled.metadata.schemaIds,
      responseCaseIds: compiled.metadata.responseCaseIds,
      ...(localEmulation ? {
        localExecution: Object.freeze({
          mode: javascript.localExecutionMode,
          providerReality: false,
          realityRunner: javascript.realityRunner,
          automaticFallback: false,
          loader: Object.freeze({
            version: prepared.loaded.version,
            kind: 'provider-owned-bundled-closure',
            sourceHash: prepared.loaded.closure.sourceHash,
            bundledInputs: prepared.loaded.closure.inputs.length,
            packagesLoaded: prepared.loaded.packagesLoaded
          })
        })
      } : {})
    }),
    summary: Object.freeze({ total: cases.length, passed: cases.length - failed, failed }),
    cases: Object.freeze(cases)
  });
}

async function runProjectTests(project, options = {}) {
  if ((project.target || 'native') === 'javascript') return runJavascriptProjectTests(project, options);
  const selected = options.caseName ? project.tests.filter((entry) => entry.name === options.caseName) : project.tests;
  if (selected.length === 0) {
    throw new PulseProjectError('PULSE_TEST_CASES_MISSING', options.caseName ? `No Pulse test case named ${options.caseName}.` : 'Pulse project defines no test cases.', { available: project.tests.map((entry) => entry.name) });
  }
  const hasEventCase = selected.some((testCase) => testCase.kind === 'event');
  const descriptor = targetDescriptor(project, 'native');
  let compiled = hasEventCase ? compileProject(project) : null;
  const eventSupport = hasEventCase ? selectedEventTargetSupport(project, compiled, descriptor) : null;
  if (hasEventCase && eventSupport) assertEventCommandEligible(project, compiled, 'test', descriptor);
  if (hasEventCase && !eventSupport) {
    throw new PulseProjectError('PULSE_TEST_EVENT_INVALID', 'The test harness contains an event case, but the application has no reachable event topology.');
  }
  const driver = assertExecutableProvider(project, 'test');
  assertImplementedTarget(project, 'test');
  const executeCanonicalProgram = driver.execute;
  if (!compiled) compiled = compileProject(project);
  const exactNativeExecution = requiresExactNativeExecution(compiled);
  const program = exactNativeExecution ? null : loadCanonicalModule(compiled);
  const native = hasEventCase || exactNativeExecution
    ? compileNativeProjectInMemory(project, { ...options, compiled }).native
    : null;
  const executeNative = exactNativeExecution ? prepareNativeExecution(project, compiled, native) : null;
  const cases = [];
  let failed = 0;
  for (const testCase of selected) {
    const started = process.hrtime.bigint();
    try {
      if (testCase.kind === 'event') {
        const schemaCodecs = createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
        const execution = await executeProviderEventTestCase(driver, 'native', native, testCase, {
          application: Object.freeze({
            projectHash: project.projectHash,
            planHash: project.planHash,
            profile: project.profile,
            target: 'native',
            provider: project.provider
          }),
          schemaCodecs,
          reporting: project.reporting,
          networkFetch: project.dev.networkFetch
        });
        const result = assertEventExpectation(testCase, execution);
        cases.push(eventTestCaseResult(testCase, execution, result, started));
        continue;
      }
      const executionOptions = providerExecutionOptions(project, {
        packageArtifacts: packageRealizationArtifactsForCompiled(compiled),
        request: testCase.request,
        fetches: testCase.fetches,
        config: testCase.config,
        secrets: testCase.secrets,
        kv: testCase.kv,
        grip: testCase.grip,
        maxBodyBytes: testCase.maxBodyBytes === undefined
          ? (project.schemas.active ? project.schemas.maxBytes : undefined)
          : testCase.maxBodyBytes,
        continuationTtlMs: testCase.continuationTtlMs,
        executionId: `test:${testCase.name}`
      });
      const execution = exactNativeExecution
        ? await executeNative(executionOptions)
        : await executeCanonicalProgram(program, executionOptions);
      if (testCase.expect.error) throw new assert.AssertionError({ message: `${testCase.name}: expected ${testCase.expect.error.name || 'an error'} but execution completed` });
      assertExpectation(testCase, Object.freeze({
        ...execution,
        response: materializeTestResponse(execution.response)
      }));
      cases.push(Object.freeze({
        name: testCase.name,
        status: 'passed',
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        response: Object.freeze({ status: execution.response.status, bodyClass: execution.response.bodyClass, kind: execution.response.kind }),
        effects: execution.effectCount,
        ...(execution.evidence ? { executionEvidence: execution.evidence } : {}),
        continuations: execution.continuations.map((entry) => Object.freeze({ id: entry.id, state: entry.state, effectIds: entry.effectIds })),
        resolutionOrder: execution.resolutionOrder
      }));
    } catch (error) {
      try {
        if (testCase.kind === 'event') throw error;
        assertExpectedError(testCase, error);
        cases.push(Object.freeze({ name: testCase.name, status: 'passed', expectedError: errorSummary(error, testCase.secrets), durationMs: Number(process.hrtime.bigint() - started) / 1e6 }));
      } catch (assertion) {
        failed += 1;
        cases.push(Object.freeze({ name: testCase.name, status: 'failed', error: errorSummary(assertion === error ? error : assertion, testCase.secrets), actualError: assertion === error ? undefined : errorSummary(error, testCase.secrets), durationMs: Number(process.hrtime.bigint() - started) / 1e6 }));
      }
    }
  }
  return Object.freeze({
    status: failed === 0 ? 'passed' : 'failed',
    version: PROJECT_EXECUTION_VERSION,
    provider: project.provider,
    project: projectJson(project),
    metadata: compiled.metadata,
    summary: Object.freeze({ total: cases.length, passed: cases.length - failed, failed }),
    cases: Object.freeze(cases)
  });
}

function inspectProject(project, options = {}) {
  const compiled = compileProject(project);
  const selectedTarget = project.target || 'native';
  let nativePlan = null;
  let native = null;
  let nativeInspectionError = null;
  try {
    const prepared = compileNativeProjectInMemory(project, { ...options, compiled });
    nativePlan = prepared.plan;
    native = prepared.native;
  } catch (error) {
    if (selectedTarget !== 'javascript' && !compiled.packageApplication) throw error;
    nativeInspectionError = errorSummary(error, project.dev && project.dev.secrets);
  }
  const driver = providerDriver(project);
  const availability = providerTargetAvailability(driver);
  const selectedDescriptor = targetDescriptor(project);
  const eventSupport = selectedEventTargetSupport(project, compiled, selectedDescriptor);
  const eventInspection = eventInspectionProjection(project, compiled, eventSupport);
  const javascriptApplication = selectedTarget === 'javascript'
    ? prepareJavascriptApplication(project, { captureLoadError: true })
    : null;
  const targetSupport = javascriptApplication
    ? selectedTargetSupportEvidence(project, compiled, javascriptApplication, selectedDescriptor, options)
    : null;
  const effectiveAvailability = targetSupport && options.targetSupportDeclaration
    ? Object.freeze({ ...availability, javascript: targetSupport.availability.generalAvailable })
    : availability;
  const referencedSchemaIds = new Set(compiled.metadata.schemaReferences.map((entry) => entry.id));
  for (const schemaId of eventInspection && eventInspection.schemas.all || []) referencedSchemaIds.add(schemaId);
  const realization = selectedTarget === 'native'
    ? (nativePlan && native && driver.inspectRealization && (!eventSupport || eventSupport.status !== 'blocked')
      ? normalizeProviderTargetResult(driver.inspectRealization(providerTargetInvocation(
        project,
        'inspect-native',
        nativePlan,
        providerLoweringPlan(project, compiled.metadata),
        {
          native,
          optimization: native && native.manifest && native.manifest.optimization,
          timeoutMs: options.timeoutMs
        }
      )), { action: 'inspect-native', provider: project.provider, target: 'native' }).realization
      : Object.freeze({
          target: selectedDescriptor.targetId,
          provider: project.provider,
          runtimeClass: selectedDescriptor.runtimeClass,
          status: 'unavailable-for-project',
          nativeWasm: false,
          providerRealityValidated: false,
          automaticFallback: false,
          error: eventSupport && eventSupport.status === 'blocked'
            ? Object.freeze({ code: eventSupport.diagnosticCode, eventTargetSupport: eventSupport })
            : nativeInspectionError
        }))
    : (javascriptApplication ? Object.freeze({
        target: selectedDescriptor.targetId,
        provider: project.provider,
        runtimeClass: selectedDescriptor.runtimeClass,
        sourceApplication: true,
        status: eventSupport && eventSupport.status === 'blocked'
          ? 'unavailable-for-project'
          : selectedDescriptor.status,
        javascriptRuntime: true,
        nativeWasm: false,
        automaticFallback: false,
        applicationPlan: Object.freeze({
          version: javascriptApplication.plan.version,
          plannerVersion: javascriptApplication.plan.plannerVersion,
          planHash: javascriptApplication.plan.planHash,
          graphHash: javascriptApplication.plan.graph.graphHash,
          loadable: javascriptApplication.plan.loadable,
          blockers: javascriptApplication.plan.blockers,
          modules: javascriptApplication.plan.graph.modules.filter((entry) => entry.runtime && entry.kind === 'project').length,
          packages: javascriptApplication.plan.packages,
          nativeEligibility: javascriptApplication.plan.nativeEligibility,
          entrySafety: javascriptApplication.plan.entrySafety
        }),
        loader: targetSupport ? Object.freeze({
          ...targetSupport.loader,
          applicationValid: targetSupport.loader.loaded === true
            || (targetSupport.loader.skippedReason === 'provider-build-time-bundle-loader'
              && javascriptApplication.plan.loadable === true)
        }) : null,
        loadError: javascriptApplication.loadError,
        supportEvidenceHash: targetSupport && targetSupport.evidenceHash,
        coreExecutionReady: targetSupport && targetSupport.availability.coreExecutionReady,
        fullTargetSupportReady: targetSupport && targetSupport.availability.fullTargetSupportReady,
        generalAvailable: targetSupport && targetSupport.availability.generalAvailable,
        projectEligibility: targetSupport && targetSupport.project.status,
        requestAdapter: selectedDescriptor.requestAdapter,
        lifecycle: selectedDescriptor.lifecycle,
        ...(eventSupport && eventSupport.status === 'blocked' ? {
          error: Object.freeze({ code: eventSupport.diagnosticCode, eventTargetSupport: eventSupport })
        } : {}),
        ...(driver.javascript && driver.javascript.localExecutionMode ? {
          localTooling: Object.freeze({
            test: driver.javascript.localExecutionMode,
            dev: driver.javascript.localExecutionMode,
            loader: 'provider-owned-bundled-closure',
            packageClosure: 'esbuild-bundled',
            providerReality: false,
            realityRunner: driver.javascript.realityRunner,
            automaticFallback: false
          }),
          deploymentCandidate: Object.freeze({
            status: 'structurally-deployable',
            emittedBy: 'pulse build',
            providerRealityValidated: false,
            deployed: false
          })
        } : {})
      }) : undefined);
  return Object.freeze({
    status: 'ok',
    version: PROJECT_EXECUTION_VERSION,
    project: projectJson(project),
    provider: Object.freeze({
      id: project.provider,
      package: driver.descriptor && driver.descriptor.package,
      buildTarget: driver.descriptor && driver.descriptor.buildTarget,
      selectedTarget,
      targetAvailability: Object.freeze({ native: effectiveAvailability.native, javascript: effectiveAvailability.javascript }),
      targetDescriptors: effectiveAvailability.descriptors,
      selectedTargetDescriptor: selectedDescriptor,
      targetSupport,
      eventTargetSupport: eventSupport,
      defaultBuildMode: driver.defaultBuildMode,
      sourceOnlySupported: false,
      realization
    }),
    plan: projectPlanInspection(project, compiled),
    compiler: Object.freeze({
      version: compiled.version,
      file: compiled.metadata.file,
      sourceHash: compiled.metadata.sourceHash,
      authoring: compiled.metadata.authoring || Object.freeze({ kind: 'handler' }),
      ...(compiled.metadata.application ? { application: compiled.metadata.application } : {}),
      ...(compiled.metadata.json ? { json: compiled.metadata.json } : {}),
      ...((compiled.metadata.warnings && compiled.metadata.warnings.length > 0) ? { warnings: compiled.metadata.warnings } : {}),
      warningCount: compiled.metadata.warningCount || 0,
      jsonPolicy: jsonPolicyInspection(project, compiled, nativePlan),
      requestState: nativePlan && nativePlan.requestState || Object.freeze({ enabled: false, representation: 'absent', reset: 'not-required' }),
      routing: nativePlan && nativePlan.routing || null,
      capabilities: compiled.metadata.capabilities,
      effects: compiled.metadata.effectSites,
      continuations: compiled.metadata.continuationSites,
      effectCount: compiled.metadata.effectCount,
      continuationCount: compiled.metadata.continuationCount,
      groupedContinuationCount: compiled.metadata.groupedContinuationCount,
      opaqueReturnCount: compiled.metadata.opaqueReturnCount,
      providerOperations: compiled.metadata.providerOperations,
      providerLowering: eventSupport && eventSupport.status === 'blocked'
        ? Object.freeze({
            status: 'blocked',
            code: eventSupport.diagnosticCode,
            eventTargetSupport: eventSupport,
            automaticFallback: false
          })
        : providerLoweringPlan(project, compiled.metadata),
      reachableGraph: Object.freeze({
        version: compiled.reachableGraph.version,
        graphHash: compiled.reachableGraph.graphHash,
        modules: compiled.reachableGraph.modules.length,
        runtimeModules: compiled.reachableGraph.modules.filter((entry) => entry.runtime).length,
        edges: compiled.reachableGraph.edges.length,
        handlers: compiled.reachableGraph.handlers.length,
        cycles: compiled.reachableGraph.cycles.length,
        unsupportedBoundaries: compiled.reachableGraph.unsupportedBoundaries.length
      }),
      packageReachability: compiled.packageReachability,
      packageProduct: compiled.packageProduct,
      packageInspection: compiled.packageInspection,
      ...(eventInspection ? { events: eventInspection } : {}),
      ...(compiled.packageApplication ? { packageApplication: compiled.packageApplication } : {}),
      applicationEntrySafety: compiled.entrySafety,
      nativeEligibility: compiled.nativeEligibility,
      native: nativePlan && native ? Object.freeze({
        status: 'available',
        target: 'portable-native-wasm',
        providerNeutral: true,
        requiredForSelectedTarget: selectedTarget === 'native',
        selectedTarget,
        automaticFallback: false,
        planVersion: nativePlan.version,
        planCompilerVersion: nativePlan.compilerVersion,
        planHash: nativePlan.planHash,
        ownership: nativePlan.ownership,
        summary: nativePlan.summary,
        ...(nativePlan.json ? { json: nativePlan.json } : {}),
        ...(nativePlan.requestState ? { requestState: nativePlan.requestState } : {}),
        compilerVersion: native.compilerVersion,
        assemblyScript: native.manifest.assemblyScript,
        wasm: native.manifest.wasm,
        wat: native.manifest.wat,
        importModules: native.manifest.importModules,
        imports: native.manifest.imports,
        exports: native.manifest.exports,
        policy: native.manifest.policy
      }) : Object.freeze({
        status: 'unavailable-for-project',
        target: 'portable-native-wasm',
        providerNeutral: true,
        requiredForSelectedTarget: selectedTarget === 'native',
        selectedTarget,
        automaticFallback: false,
        error: nativeInspectionError
      }),
      schemas: Object.freeze({
        active: compiled.schema.active,
        compilerVersion: compiled.schema.compilerVersion,
        sourceHash: compiled.metadata.schemaSourceHash,
        registry: compiled.metadata.schemaRegistry,
        references: compiled.metadata.schemaReferences,
        unused: Object.freeze(compiled.metadata.schemaIds.filter((id) => !referencedSchemaIds.has(id))),
        diagnostics: compiled.schema.diagnostics,
        warnings: compiled.schema.warnings
      })
    }),
    ...(eventInspection ? { events: eventInspection } : {}),
    testCases: project.tests.map((entry) => entry.name)
  });
}

function doctorProject(project, options = {}) {
  const checks = [];
  const selectedTarget = project.target || 'native';
  const selectedTargetDescriptor = targetDescriptor(project, selectedTarget);
  const targetSupportDeclaration = options.targetSupportDeclaration || getProviderTargetSupportDeclaration(providerDriver(project), selectedTarget);
  const providerAvailability = providerTargetAvailability(providerDriver(project));
  const targetAvailability = options.targetSupportDeclaration && targetSupportDeclaration
    ? Object.freeze({ ...providerAvailability, javascript: targetSupportDeclaration.availability.generalAvailable })
    : providerAvailability;
  checks.push(Object.freeze({
    id: 'execution-target',
    status: selectedTarget === 'javascript' && targetAvailability.javascript !== true ? 'warning' : 'passed',
    message: selectedTarget === 'javascript'
      ? (targetSupportDeclaration
          ? (targetSupportDeclaration.availability.generalAvailable
              ? `${project.provider} JavaScript full target support is sealed and generally available; the selected JavaScript target remains authoritative and no automatic fallback will occur.`
              : `Core ${project.provider} JavaScript execution is ready, but general availability remains false under the full-target-support policy while ${targetSupportDeclaration.availability.summary.pending} gate(s) remain pending; no automatic fallback will occur.`)
          : selectedTargetDescriptor.applicationLoader
            ? 'The JavaScript application loader is present, but this provider does not declare full target support; no automatic fallback will occur.'
            : selectedTargetDescriptor.status === 'source-packaging-ready'
              ? 'The selected JavaScript source-packaging boundary is ready, while provider execution remains deferred; no automatic fallback will occur.'
            : 'The selected JavaScript target is recorded but not realized for this provider; no automatic fallback will occur.')
      : 'The selected native target is available.',
    detail: Object.freeze({
      selected: selectedTarget,
      native: targetAvailability.native,
      javascript: targetAvailability.javascript,
      descriptor: selectedTargetDescriptor,
      targetSupport: targetSupportDeclaration,
      automaticFallback: false
    })
  }));
  function check(id, status, message, detail = {}, explicitCode) {
    const code = explicitCode || detail.code;
    const descriptor = code ? describeDiagnostic(code) : undefined;
    checks.push(Object.freeze({
      id,
      status,
      message,
      code,
      title: descriptor && descriptor.title,
      summary: descriptor && descriptor.summary,
      category: descriptor && descriptor.category,
      remediation: descriptor && descriptor.remediation,
      stability: descriptor && descriptor.stability,
      scope: descriptor && descriptor.scope,
      docs: descriptor && descriptor.docs,
      detail
    }));
  }
  const nodeSupported = nodeVersionSatisfiesEngines(process.versions.node, releaseNode.nodeEngines);
  check(
    'node-version',
    nodeSupported ? 'passed' : 'failed',
    `Node ${process.versions.node}`,
    {
      engines: releaseNode.nodeEngines,
      minimumVersion: releaseNode.nodeMinimumVersion,
      sealRange: releaseNode.nodeReleaseRange,
      reproducibleToolchainVersion: releaseNode.nodeVersion
    },
    nodeSupported ? undefined : 'PULSE_NODE_VERSION_UNSUPPORTED'
  );
  check('config', project.configFile ? 'passed' : 'warning', project.configFile ? `Loaded ${relative(project.configFile, project.root)}` : 'No config file; using explicit entry defaults.', {}, project.configFile ? undefined : 'PULSE_CONFIG_IMPLICIT');
  check('entry', fs.existsSync(project.entryFile) ? 'passed' : 'failed', relative(project.entryFile, project.root), { file: relative(project.entryFile, project.root) }, fs.existsSync(project.entryFile) ? undefined : 'PULSE_ENTRY_NOT_FOUND');
  if (project.profilePlan) {
    check('project-plan', 'passed', `Selected profile ${project.profile.name} from ${project.profile.source} with plan ${String(project.planHash).slice(0, 12)}…`, projectPlanInspection(project));
  }
  let compiled;
  let nativePrepared;
  let preparedJavascript;
  let targetSupport;
  let eventSupport;
  let eventInspection;
  try {
    compiled = compileProject(project);
    check('canonical-compile', (compiled.metadata.warningCount || 0) > 0 ? 'warning' : 'passed',
      compiled.target === 'javascript'
        ? `JavaScript source inspected with ${compiled.metadata.effectCount} recognized Pulse effect(s) and ${compiled.metadata.warningCount || 0} warning(s); execution retains the original source graph.`
        : `Canonical source lowered with ${compiled.metadata.effectCount} effect(s), ${compiled.metadata.continuationCount} continuation(s), and ${compiled.metadata.warningCount || 0} warning(s).`,
      { capabilities: compiled.metadata.capabilities, warnings: compiled.metadata.warnings || [] });
    eventSupport = selectedEventTargetSupport(project, compiled, selectedTargetDescriptor);
    if (eventSupport) {
      eventInspection = eventInspectionProjection(project, compiled, eventSupport);
      check(
        'events',
        eventSupport.status === 'eligible' ? 'passed' : (eventSupport.status === 'inspection-only' ? 'warning' : 'failed'),
        eventSupport.status === 'eligible'
          ? `The ${project.provider}/${selectedTarget} target satisfies ${eventSupport.requirements.length} reachable event requirement(s).`
          : eventSupport.status === 'inspection-only'
            ? 'The event catalog is available for compile-only inspection; no execution provider is selected.'
            : `The ${project.provider}/${selectedTarget} target cannot realize the reachable event plane and no fallback will occur.`,
        eventInspection,
        eventSupport.status === 'blocked' ? eventSupport.diagnosticCode : undefined
      );
    }
    const referencedSchemaIds = new Set(compiled.metadata.schemaReferences.map((entry) => entry.id));
    for (const schemaId of eventInspection && eventInspection.schemas.all || []) referencedSchemaIds.add(schemaId);
    const unusedSchemaIds = compiled.metadata.schemaIds.filter((id) => !referencedSchemaIds.has(id));
    check(
      'schemas',
      unusedSchemaIds.length > 0 ? 'warning' : 'passed',
      compiled.schema.active
        ? `Compiled ${compiled.metadata.schemaIds.length} JSON schema(s) with ${compiled.metadata.schemaReferenceCount} linked HTTP handler reference(s) and ${eventInspection ? eventInspection.schemas.all.length : 0} linked event schema(s).`
        : 'No explicit JSON schemas are configured.',
      {
        ids: compiled.metadata.schemaIds,
        references: compiled.metadata.schemaReferences,
        eventReferences: eventInspection ? eventInspection.schemas.all : Object.freeze([]),
        unused: unusedSchemaIds,
        sourceHash: compiled.metadata.schemaSourceHash,
        dependencies: compiled.watchFiles.map((file) => relative(file, project.root))
      }
    );
    const jsonPolicy = jsonPolicyInspection(project, compiled);
    check(
      'json-policy',
      'passed',
      jsonPolicy.genericParserRequired
        ? `Non-strict schema-less JSON is enabled for ${jsonPolicy.genericRequestCount} reachable call(s); native realization uses the explicit host generic parser path.`
        : (jsonPolicy.strict ? 'Strict schema-bound JSON policy is active.' : 'Non-strict JSON policy is active, but no schema-less JSON call is reachable.'),
      jsonPolicy
    );
    nativePrepared = compileNativeProjectInMemory(project, { compiled });
    if (nativePrepared.plan.requestState && nativePrepared.plan.requestState.enabled) {
      check('request-state', 'passed', 'Request-local ctx.state is guest-owned, survives continuations, and resets at pulse_start.', nativePrepared.plan.requestState);
    }
    check(
      'canonical-native-plan',
      'passed',
      `Provider-neutral native plan ${nativePrepared.plan.planHash.slice(0, 12)}… contains ${nativePrepared.plan.summary.statementCount} statement(s).`,
      {
        version: nativePrepared.plan.version,
        compilerVersion: nativePrepared.plan.compilerVersion,
        planHash: nativePrepared.plan.planHash,
        ownership: nativePrepared.plan.ownership,
        summary: nativePrepared.plan.summary
      }
    );
    check(
      'canonical-native-wasm',
      'passed',
      `Compiled ${nativePrepared.native.manifest.wasm.bytes} bytes of provider-neutral Pulse Wasm with AssemblyScript ${nativePrepared.native.manifest.assemblyScript.version}.`,
      {
        version: nativePrepared.native.version,
        compilerVersion: nativePrepared.native.compilerVersion,
        assemblyScript: nativePrepared.native.manifest.assemblyScript,
        wasm: nativePrepared.native.manifest.wasm,
        importModules: nativePrepared.native.manifest.importModules,
        planHash: nativePrepared.plan.planHash
      }
    );
  } catch (error) {
    const nativeFailure = error && ['PULSE_CANONICAL_NATIVE_PLAN_FAILED', 'PULSE_CANONICAL_NATIVE_AS_GENERATION_FAILED', 'PULSE_CANONICAL_NATIVE_COMPILE_FAILED'].includes(error.code);
    if (nativeFailure && compiled) {
      const selectedTargetRequiresNative = selectedTarget === 'native';
      check(
        error.code === 'PULSE_CANONICAL_NATIVE_PLAN_FAILED' ? 'canonical-native-plan' : 'canonical-native-wasm',
        selectedTargetRequiresNative ? 'failed' : 'warning',
        selectedTargetRequiresNative
          ? error.message
          : `Provider-neutral native realization is unavailable for this project, but the selected JavaScript target is inspected independently and no native fallback will occur: ${error.message}`,
        {
          code: error.code,
          diagnostics: error.diagnostics,
          detail: error.detail,
          selectedTarget,
          requiredForSelectedTarget: selectedTargetRequiresNative,
          automaticFallback: false
        }
      );
    } else {
      check('canonical-compile', 'failed', error.message, { code: error.code, diagnostics: error.diagnostics });
    }
    const schemaFailure = error.code === 'PULSE_SCHEMA_COMPILE_FAILED' || (error.diagnostics || []).some((entry) => String(entry.code || '').includes('SCHEMA'));
    if (schemaFailure) check('schemas', 'failed', error.message, { code: error.code, diagnostics: error.diagnostics, detail: error.detail });
  }
  if (selectedTarget === 'javascript') {
    try {
      const javascript = providerDriver(project).javascript;
      preparedJavascript = prepareJavascriptApplication(project, { captureLoadError: true });
      targetSupport = selectedTargetSupportEvidence(project, compiled, preparedJavascript, selectedTargetDescriptor, options);
      const applicationDecision = targetSupport && targetSupport.project.application.find((entry) => entry.id === 'application.plan');
      const buildTimeLoaderReady = javascript && javascript.buildTimeLoader === true
        && preparedJavascript.plan.loadable === true
        && targetSupport
        && targetSupport.loader.skippedReason === 'provider-build-time-bundle-loader'
        && targetSupport.project.status === 'eligible';
      const applicationStatus = applicationDecision && applicationDecision.status === 'pending'
        ? 'warning'
        : preparedJavascript.loaded || buildTimeLoaderReady
          ? 'passed'
          : targetSupport && targetSupport.project.status === 'pending'
            ? 'warning'
            : 'failed';
      const applicationMessage = applicationDecision && applicationDecision.status === 'pending'
        ? `The JavaScript application graph is deterministic, but reachable package realization remains pending for ${targetSupport.project.reasonIds.join(', ')}.`
        : preparedJavascript.loaded
          ? `Graph-backed JavaScript application ${preparedJavascript.plan.planHash.slice(0, 12)}… loaded ${preparedJavascript.loaded.modulesLoaded} project module(s).`
          : buildTimeLoaderReady
            ? `${project.provider} JavaScript application ${preparedJavascript.plan.planHash.slice(0, 12)}… is loadable through the deterministic build-time bundle loader and available to explicit local provider emulation.`
          : targetSupport && targetSupport.project.status === 'pending'
            ? `The JavaScript application graph is deterministic, but reachable package/capability realization remains pending for ${targetSupport.project.reasonIds.join(', ')}.`
            : (preparedJavascript.loadError
                ? `The JavaScript application loader failed: ${preparedJavascript.loadError.message}`
                : 'The JavaScript application plan is blocked for the selected target.');
      check(
        'javascript-application',
        applicationStatus,
        applicationMessage,
        {
          target: preparedJavascript.descriptor,
          planVersion: preparedJavascript.plan.version,
          planHash: preparedJavascript.plan.planHash,
          graphHash: preparedJavascript.plan.graph.graphHash,
          loadable: preparedJavascript.plan.loadable,
          blockers: preparedJavascript.plan.blockers,
          packages: preparedJavascript.plan.packages,
          nativeEligibility: preparedJavascript.plan.nativeEligibility,
          entrySafety: preparedJavascript.plan.entrySafety,
          loader: preparedJavascript.loaded ? {
            version: preparedJavascript.loaded.version,
            modulesLoaded: preparedJavascript.loaded.modulesLoaded,
            packagesLoaded: preparedJavascript.loaded.packagesLoaded
          } : null,
          loadError: preparedJavascript.loadError,
          targetSupportEvidenceHash: targetSupport && targetSupport.evidenceHash,
          projectEligibility: targetSupport && targetSupport.project.status,
          automaticFallback: false
        },
        applicationStatus === 'passed'
          ? undefined
          : targetSupport && targetSupport.project.packages.find((entry) => entry.required && entry.status === 'pending' && entry.reasonCode)?.reasonCode
            || preparedJavascript.plan.blockers[0]?.code
            || preparedJavascript.loadError?.code
            || 'PULSE_TARGET_IMPLEMENTATION_PENDING'
      );
      if (targetSupport) {
        const pendingProjectItems = targetSupport.project.summary.application.pending
          + targetSupport.project.summary.capabilities.pending
          + targetSupport.project.summary.providerRequirements.pending
          + targetSupport.project.summary.packages.pending;
        const blockedProjectItems = targetSupport.project.summary.application.blocked
          + targetSupport.project.summary.capabilities.blocked
          + targetSupport.project.summary.providerRequirements.blocked
          + targetSupport.project.summary.packages.blocked;
        check(
          'target-support',
          targetSupport.project.status === 'blocked'
            ? 'failed'
            : targetSupport.project.status === 'eligible' && targetSupport.availability.generalAvailable
              ? 'passed'
              : 'warning',
          targetSupport.project.status === 'eligible'
            ? (targetSupport.availability.generalAvailable
                ? `This project is eligible for the sealed and generally available ${project.provider} JavaScript target; the selected target remains authoritative and automatic fallback is disabled.`
                : `This project is eligible for the sealed core ${project.provider} JavaScript lane, but general availability remains false until ${targetSupport.availability.summary.pending} full-support gate(s) close.`)
            : targetSupport.project.status === 'pending'
              ? (targetSupport.availability.generalAvailable
                  ? `The ${project.provider} JavaScript target is generally available, but this project has ${pendingProjectItems} pending capability/package decision(s) and is not yet eligible.`
                  : `This project has ${pendingProjectItems} pending JavaScript capability/package decision(s); general availability also remains false under the full-target-support policy.`)
              : `This project has ${blockedProjectItems} blocked JavaScript capability/package decision(s) and cannot execute on the selected target.`,
          targetSupport
        );
      }
      if (javascript && javascript.localExecutionMode) {
        check(
          'javascript-local-tooling',
          'passed',
          `pulse test and pulse dev use explicit ${project.provider} provider emulation; provider reality remains a separate ${javascript.realityRunner} step.`,
          {
            mode: javascript.localExecutionMode,
            loader: 'provider-owned-bundled-closure',
            packageClosure: 'esbuild-bundled',
            providerReality: false,
            realityRunner: javascript.realityRunner,
            deploymentCandidate: 'pulse build',
            automaticFallback: false
          }
        );
      }
    } catch (error) {
      check('javascript-application', 'failed', error.message, { code: error.code, detail: error.detail, diagnostics: error.diagnostics }, error.code);
    }
  }
  const driver = providerDriver(project);
  if (!driver.executable) check('provider', 'warning', 'Compile-only provider selected; pulse build, dev, and test are unavailable. Use pulse compile for provider-neutral Wasm.', { provider: project.provider }, 'PULSE_PROVIDER_COMPILE_ONLY');
  else {
    try {
      const lowering = compiled ? driver.createLoweringPlan(compiled.metadata, project.providerConfig) : undefined;
      check('provider', selectedTarget === 'javascript' && targetAvailability.javascript !== true ? 'warning' : 'passed', selectedTarget === 'javascript'
        ? (targetSupportDeclaration
            ? (targetSupportDeclaration.availability.generalAvailable
                ? `${project.provider} JavaScript full target support is sealed and generally available; bounded GRIP realization is included and automatic fallback remains disabled.`
                : `${project.provider} JavaScript core execution and bounded GRIP realization are ready, but one or more full-target-support gates remain pending, so general availability remains false.`)
            : `${project.provider} JavaScript application loading is not declared as a fully supported target.`)
        : `${project.provider} native provider contract and local conformance runtime are available.`, {
        package: driver.descriptor.package,
        buildTarget: driver.descriptor.buildTarget,
        deployable: driver.deployable === true,
        deploymentValidated: driver.deploymentValidated === true,
        sourcePackage: driver.sourcePackage === true,
        compiledWasm: driver.compiledWasm === true,
        selectedTarget,
        targetAvailability: Object.freeze({ native: targetAvailability.native, javascript: targetAvailability.javascript }),
        targetDescriptors: targetAvailability.descriptors,
        selectedTargetDescriptor,
        targetSupportDeclaration,
        targetSupportEvidenceHash: targetSupport && targetSupport.evidenceHash,
        defaultBuildMode: driver.defaultBuildMode,
        sourceOnlySupported: false,
        localExecution: driver.localExecution === true,
        requirements: lowering && lowering.requirements
      });
    } catch (error) {
      check('provider', 'failed', error.message, { code: error.code, detail: error.detail });
    }
  }
  if (selectedTarget === 'native' && nativePrepared && driver.executable && driver.inspectRealization && (!eventSupport || eventSupport.status !== 'blocked')) {
    try {
      const realization = normalizeProviderTargetResult(driver.inspectRealization(providerTargetInvocation(
        project,
        'inspect-native',
        nativePrepared.plan,
        providerLoweringPlan(project, nativePrepared.compiled.metadata),
        {
          native: nativePrepared.native,
          optimization: nativePrepared.native.manifest.optimization,
          timeoutMs: options.timeoutMs
        }
      )), { action: 'inspect-native', provider: project.provider, target: 'native' }).realization;
      check(
        'provider-native-realization',
        'passed',
        `${project.provider} realizes the portable plan as ${realization.wasm.bytes} bytes of native provider Wasm.`,
        {
          target: realization.target,
          provider: project.provider,
          nativeWasm: realization.nativeWasm === true,
          javascriptRuntime: realization.javascriptRuntime === true,
          jsComputeRuntime: realization.jsComputeRuntime === true,
          compiler: realization.compiler,
          wasm: realization.wasm,
          importModules: realization.importModules,
          imports: realization.imports,
          exports: realization.exports,
          policy: realization.policy
        }
      );
    } catch (error) {
      check('provider-native-realization', 'failed', error.message, { code: error.code, detail: error.detail, diagnostics: error.diagnostics });
    }
  }
  try {
    const output = resolveOutputDirectory(project, project.outDir);
    check('build-output', 'passed', relative(output, project.root));
  } catch (error) {
    check('build-output', 'failed', error.message, { code: error.code, outDir: project.outDir });
  }
  if (driver.executable && project.dev.networkFetch) {
    check('network-fetch', typeof globalThis.fetch === 'function' ? 'passed' : 'failed', typeof globalThis.fetch === 'function' ? `${project.provider} local live fetch is available for pulse dev.` : 'Local live fetch is unavailable.', { enabled: true, provider: project.provider }, typeof globalThis.fetch === 'function' ? undefined : 'PULSE_FETCH_IMPLEMENTATION_UNAVAILABLE');
  } else {
    check('network-fetch', 'passed', project.dev.networkFetch ? 'Provider owns outbound fetch.' : 'Live network fetch is disabled; configured fixtures are required.', { enabled: project.dev.networkFetch });
  }
  check('tests', project.tests.length > 0 ? 'passed' : 'warning', project.tests.length > 0 ? `${project.tests.length} project test case(s) configured.` : 'No project test cases configured.', { count: project.tests.length }, project.tests.length > 0 ? undefined : 'PULSE_TEST_CASES_MISSING');
  const failed = checks.filter((entry) => entry.status === 'failed').length;
  const warnings = checks.filter((entry) => entry.status === 'warning').length;
  const ok = failed === 0 && (!options.strict || warnings === 0);
  return Object.freeze({
    status: ok ? (warnings > 0 ? 'warning' : 'passed') : 'failed',
    version: PROJECT_EXECUTION_VERSION,
    project: projectJson(project),
    summary: Object.freeze({ total: checks.length, passed: checks.filter((entry) => entry.status === 'passed').length, warnings, failed }),
    checks: Object.freeze(checks),
    targetSupport,
    ...(eventSupport ? { events: eventInspectionProjection(project, compiled, eventSupport) } : {}),
    metadata: compiled && compiled.metadata
  });
}

async function readRequestBody(request, maxBytes, budget) {
  const signal = budget?.signal;
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('Pulse Node maxBodyBytes must be a positive safe integer.');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    function cleanup() {
      for (const [event, fn] of [['data', data], ['end', end], ['error', error], ['aborted', aborted]]) request.removeListener(event, fn);
      signal?.removeEventListener('abort', cancel);
    }
    function fail(cause) { cleanup(); chunks.length = 0; request.once('error', () => {}); request.resume(); reject(cause); }
    function cancel() { fail(signal.reason); }
    function error(cause) { fail(new PulseProjectError('PULSE_NODE_REQUEST_READ_FAILED', 'Pulse could not read the Node request body.', { causeName: cause?.name })); }
    function aborted() { error(new Error('Request aborted')); }
    function data(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > limit) return fail(new PulseProjectError('PULSE_REQUEST_BODY_TOO_LARGE', `Request body exceeds ${limit} bytes.`, { maxBytes: limit, bytes }));
      chunks.push(buffer);
    }
    function end() { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); }
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', aborted);
  });
}

function requestHeaders(req) {
  if (Array.isArray(req.rawHeaders) && req.rawHeaders.length > 0) {
    const pairs = [];
    for (let index = 0; index < req.rawHeaders.length; index += 2) pairs.push([req.rawHeaders[index], req.rawHeaders[index + 1] || '']);
    return pairs;
  }
  return Object.entries(req.headers || {}).flatMap(([name, value]) => Array.isArray(value) ? value.map((entry) => [name, entry]) : [[name, value === undefined ? '' : value]]);
}

function devErrorResponse(res, error, secrets) {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const summary = errorSummary(error, secrets);
  res.statusCode = httpStatusForDiagnostic(summary.code, 500);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (res.statusCode === 504) res.setHeader('connection', 'close');
  res.end(stableJson({
    error: summary.name,
    code: summary.code,
    category: summary.category,
    message: summary.message,
    remediation: summary.remediation,
    docs: summary.docs
  }));
}


function javascriptProjectWatchFiles(project, prepared, compiled) {
  const files = new Set();
  if (project.configFile) files.add(path.resolve(project.configFile));
  for (const module of prepared.plan.graph.modules || []) {
    if (module.kind === 'project' && module.path) files.add(path.resolve(project.root, module.path));
  }
  for (const file of compiled && compiled.watchFiles || []) files.add(path.resolve(file));
  return Object.freeze([...files].sort());
}

async function writeJavascriptWebResponse(response, res, method = 'GET') {
  res.statusCode = response.status;
  const grouped = new Map();
  for (const [name, value] of response.headers.entries()) {
    const key = String(name).toLowerCase();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(String(value));
  }
  if (typeof response.headers.getSetCookie === 'function') {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) grouped.set('set-cookie', cookies);
  }
  for (const [name, values] of grouped) res.setHeader(name, values.length === 1 ? values[0] : values);
  if (String(method).toUpperCase() === 'HEAD' || !statusAllowsResponseBody(response.status) || !response.body) {
    if (response.body && typeof response.body.cancel === 'function') {
      try { await response.body.cancel(); } catch (_) { /* Best-effort local stream cleanup. */ }
    }
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function startBundledJavascriptDevServer(project, options = {}) {
  const descriptor = assertImplementedTarget(project, 'dev');
  const javascript = providerDriver(project).javascript;
  if (
    !javascript
    || typeof javascript.createLocalEnvironment !== 'function'
    || typeof javascript.createTestRequest !== 'function'
    || typeof javascript.executeLocalRequest !== 'function'
    || descriptor.requestAdapter !== true
    || descriptor.lifecycle !== true
  ) {
    throw new PulseProjectError(
      'PULSE_TARGET_IMPLEMENTATION_PENDING',
      'pulse dev cannot realize the selected provider-bundled JavaScript target yet.',
      { target: 'javascript', provider: project.provider, targetDescriptor: descriptor, automaticFallback: false }
    );
  }

  let prepared;
  let application;
  let compileError;
  let schemaCodecs;
  let reloadTimer;
  const watchEnabled = project.dev.watch && options.watch !== false;
  const watched = new Map();
  const events = typeof options.onEvent === 'function' ? options.onEvent : () => {};
  const environment = javascript.createLocalEnvironment({
    bindings: project.providerConfig.bindings,
    maxDurationMs: project.providerConfig.maxDurationMs,
    config: project.dev.config,
    secrets: project.dev.secrets,
    kv: project.dev.kv,
    fetches: project.dev.fetches,
    networkFetch: project.dev.networkFetch,
    fetchImplementation: project.dev.networkFetch ? globalThis.fetch : undefined
  });

  function syncWatchFiles(files) {
    if (!watchEnabled) return;
    const desired = new Set((files || []).map((file) => path.resolve(file)));
    for (const [file, listener] of watched) {
      if (desired.has(file)) continue;
      fs.unwatchFile(file, listener);
      watched.delete(file);
    }
    for (const file of desired) {
      if (watched.has(file)) continue;
      const listener = scheduleReload;
      fs.watchFile(file, { interval: 200 }, listener);
      watched.set(file, listener);
    }
  }

  function reload(reason) {
    try {
      const nextCompiled = compileProject(project);
      const next = prepareJavascriptApplication(project, {
        allowedPackages: options.allowedPackages,
        localEmulation: true,
        schemaBundle: nextCompiled.schema.bundle
      });
      if (!next.loaded) {
        throw new PulseProjectError(
          'PULSE_JAVASCRIPT_APPLICATION_UNAVAILABLE',
          'The graph-backed JavaScript application could not be loaded for local provider emulation.',
          { planHash: next.plan.planHash, blockers: next.plan.blockers, automaticFallback: false }
        );
      }
      prepared = next;
      application = next.loaded.application;
      schemaCodecs = createCanonicalSchemaCodecs(nextCompiled.schema.bundle.registry);
      compileError = undefined;
      const watchFiles = javascriptProjectWatchFiles(project, next, nextCompiled);
      syncWatchFiles(watchFiles);
      events(Object.freeze({
        event: reason === 'initial' ? 'compiled' : 'reloaded',
        provider: project.provider,
        target: 'javascript',
        targetId: descriptor.targetId,
        executionMode: javascript.localExecutionMode,
        providerReality: false,
        entry: relative(project.entryFile, project.root),
        planHash: next.plan.planHash,
        graphHash: next.plan.graph.graphHash,
        localClosureHash: next.loaded.closure.sourceHash,
        bundledInputs: next.loaded.closure.inputs.length,
        packagesLoaded: next.loaded.packagesLoaded,
        watchFiles: Object.freeze(watchFiles.map((file) => relative(file, project.root)))
      }));
    } catch (error) {
      if (!application) compileError = error;
      events(Object.freeze({
        event: 'compile-error',
        provider: project.provider,
        target: 'javascript',
        executionMode: javascript.localExecutionMode,
        retainedLastGoodProgram: Boolean(application),
        error: errorSummary(error, project.dev.secrets)
      }));
    }
  }

  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      reload('change');
    }, 60);
  }

  reload('initial');
  if (compileError) throw compileError;

  let handled = 0;
  const structuredBodyLimit = project.schemas.active
    ? Math.min(project.dev.maxBodyBytes, project.schemas.maxBytes)
    : project.dev.maxBodyBytes;
  const server = http.createServer(async (req, res) => {
    if (options.once) res.once('finish', () => server.close());
    try {
      if (compileError) throw compileError;
      const body = await readRequestBody(req, structuredBodyLimit);
      const host = req.headers.host || `${project.dev.host}:${project.dev.port}`;
      const url = new URL(req.url || '/', `http://${host}`);
      const request = javascript.createTestRequest({
        method: req.method || 'GET',
        url: url.href,
        path: url.pathname,
        headers: requestHeaders(req),
        body: body || undefined
      });
      const execution = await javascript.executeLocalRequest(application, request, {
        environment,
        bindings: project.providerConfig.bindings,
        maxDurationMs: project.providerConfig.maxDurationMs,
        application: Object.freeze({
          projectHash: project.projectHash,
          planHash: project.planHash,
          profile: project.profile,
          target: 'javascript',
          provider: project.provider
        }),
        maxBodyBytes: structuredBodyLimit,
        maxRequestBodyBytes: structuredBodyLimit,
        maxFetchBodyBytes: structuredBodyLimit,
        schemaCodecs,
        strict: project.strict !== false,
        reporting: project.reporting
      });
      await writeJavascriptWebResponse(execution.response, res, req.method || 'GET');
      handled += 1;
      events(Object.freeze({
        event: 'request',
        provider: project.provider,
        target: 'javascript',
        executionMode: javascript.localExecutionMode,
        providerReality: false,
        requestId: `dev:${handled}`,
        method: req.method || 'GET',
        path: url.pathname,
        status: execution.response.status,
        effects: execution.effectSummary ? execution.effectSummary.ownedEffectCount : 0
      }));
    } catch (error) {
      devErrorResponse(res, error, project.dev.secrets);
      events(Object.freeze({
        event: 'request-error',
        provider: project.provider,
        target: 'javascript',
        executionMode: javascript.localExecutionMode,
        method: req.method || 'GET',
        path: req.url || '/',
        error: errorSummary(error, project.dev.secrets)
      }));
    }
  });

  function cleanup() {
    if (reloadTimer) clearTimeout(reloadTimer);
    for (const [file, listener] of watched) fs.unwatchFile(file, listener);
    watched.clear();
  }
  server.once('close', cleanup);
  server.once('error', cleanup);
  const listenHost = options.host || project.dev.host;
  const listenPort = options.port !== undefined ? Number(options.port) : project.dev.port;
  server.listen(listenPort, listenHost);
  await once(server, 'listening');
  const address = server.address();
  const boundHost = typeof address === 'object' && address ? address.address : listenHost;
  const boundPort = typeof address === 'object' && address ? address.port : listenPort;
  const advertisedHost = listenHost === '0.0.0.0' || listenHost === '::' ? '127.0.0.1' : listenHost;
  const urlHost = advertisedHost.includes(':') ? `[${advertisedHost}]` : advertisedHost;
  const ready = Object.freeze({
    event: 'ready',
    version: PROJECT_EXECUTION_VERSION,
    provider: project.provider,
    target: 'javascript',
    targetId: descriptor.targetId,
    runtimeClass: descriptor.runtimeClass,
    executionMode: javascript.localExecutionMode,
    providerReality: false,
    realityRunner: javascript.realityRunner,
    host: boundHost,
    port: boundPort,
    url: `http://${urlHost}:${boundPort}`,
    watch: watched.size > 0,
    watchFiles: Object.freeze([...watched.keys()].map((file) => relative(file, project.root))),
    once: Boolean(options.once),
    applicationPlan: Object.freeze({ planHash: prepared.plan.planHash, graphHash: prepared.plan.graph.graphHash }),
    localLoader: Object.freeze({
      version: prepared.loaded.version,
      kind: 'provider-owned-bundled-closure',
      sourceHash: prepared.loaded.closure.sourceHash,
      bundledInputs: prepared.loaded.closure.inputs.length,
      packagesLoaded: prepared.loaded.packagesLoaded
    }),
    automaticFallback: false,
    project: projectJson(project)
  });
  events(ready);
  return Object.freeze({ server, ready, closed: once(server, 'close') });
}

async function startJavascriptDevServer(project, options = {}) {
  const javascript = providerDriver(project).javascript;
  if (javascript && javascript.kind === 'provider-bundled') return startBundledJavascriptDevServer(project, options);
  const descriptor = assertImplementedTarget(project, 'dev');
  if (!javascript || typeof javascript.createServer !== 'function' || descriptor.requestAdapter !== true || descriptor.lifecycle !== true) {
    throw new PulseProjectError(
      'PULSE_TARGET_IMPLEMENTATION_PENDING',
      `pulse dev cannot realize the selected javascript target for ${project.provider} yet.`,
      { target: 'javascript', provider: project.provider, targetDescriptor: descriptor, automaticFallback: false }
    );
  }

  let prepared;
  let application;
  let compileError;
  let schemaCodecs;
  let reloadTimer;
  const watchEnabled = project.dev.watch && options.watch !== false;
  const watched = new Map();
  const events = typeof options.onEvent === 'function' ? options.onEvent : () => {};

  function syncWatchFiles(files) {
    if (!watchEnabled) return;
    const desired = new Set((files || []).map((file) => path.resolve(file)));
    for (const [file, listener] of watched) {
      if (desired.has(file)) continue;
      fs.unwatchFile(file, listener);
      watched.delete(file);
    }
    for (const file of desired) {
      if (watched.has(file)) continue;
      const listener = scheduleReload;
      fs.watchFile(file, { interval: 200 }, listener);
      watched.set(file, listener);
    }
  }

  function reload(reason) {
    try {
      const next = prepareJavascriptApplication(project, { allowedPackages: options.allowedPackages });
      if (!next.loaded) {
        throw new PulseProjectError(
          'PULSE_JAVASCRIPT_APPLICATION_UNAVAILABLE',
          'The graph-backed JavaScript application could not be loaded.',
          { planHash: next.plan.planHash, blockers: next.plan.blockers, automaticFallback: false }
        );
      }
      const nextCompiled = compileProject(project);
      prepared = next;
      application = next.loaded.application;
      schemaCodecs = createCanonicalSchemaCodecs(nextCompiled.schema.bundle.registry);
      compileError = undefined;
      const watchFiles = javascriptProjectWatchFiles(project, next, nextCompiled);
      syncWatchFiles(watchFiles);
      events(Object.freeze({
        event: reason === 'initial' ? 'compiled' : 'reloaded',
        target: 'javascript',
        targetId: descriptor.targetId,
        entry: relative(project.entryFile, project.root),
        planHash: next.plan.planHash,
        graphHash: next.plan.graph.graphHash,
        watchFiles: Object.freeze(watchFiles.map((file) => relative(file, project.root)))
      }));
    } catch (error) {
      if (!application) compileError = error;
      events(Object.freeze({ event: 'compile-error', target: 'javascript', retainedLastGoodProgram: Boolean(application), error: errorSummary(error, project.dev.secrets) }));
    }
  }

  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { reloadTimer = undefined; reload('change'); }, 60);
  }

  reload('initial');
  if (compileError) throw compileError;

  let handled = 0;
  let server;
  const structuredBodyLimit = project.schemas.active
    ? Math.min(project.dev.maxBodyBytes, project.schemas.maxBytes)
    : project.dev.maxBodyBytes;
  server = javascript.createServer(null, {
    getApplication() {
      if (compileError) throw compileError;
      if (!application) throw new PulseProjectError('PULSE_JAVASCRIPT_APPLICATION_UNAVAILABLE', 'No last-good JavaScript application is available.');
      return application;
    },
    schemaCodecs() {
      if (compileError) throw compileError;
      return schemaCodecs;
    },
    strict: project.strict !== false,
    provider: project.provider,
    maxBodyBytes: structuredBodyLimit,
    application: Object.freeze({
      projectHash: project.projectHash,
      planHash: project.planHash,
      profile: project.profile,
      target: 'javascript',
      provider: project.provider
    }),
    capabilities: options.capabilities,
    config: project.dev.config,
    secrets: project.dev.secrets,
    kv: project.dev.kv,
    bindings: project.providerConfig.bindings,
    maxDurationMs: project.providerConfig.maxDurationMs,
    s3FetchImplementation: javascript.createFixtureFetch(
      project.dev.fetches,
      project.dev.networkFetch ? globalThis.fetch : undefined,
      { rawResponse: true }
    ),
    fetchImplementation: javascript.createFixtureFetch(
      project.dev.fetches,
      project.dev.networkFetch ? globalThis.fetch : undefined
    ),
    maxRequestBodyBytes: structuredBodyLimit,
    maxFetchBodyBytes: structuredBodyLimit,
    onRequest(event) {
      handled += 1;
      events(Object.freeze({ event: 'request', target: 'javascript', ...event, requestId: `dev:${handled}` }));
      if (options.once) server.close();
    },
    onError(error, context) {
      const request = context && context.request;
      events(Object.freeze({
        event: 'request-error',
        target: 'javascript',
        method: request && request.method || 'GET',
        path: request && request.url || '/',
        error: errorSummary(error, project.dev.secrets)
      }));
      if (options.once) server.close();
    }
  });

  function cleanup() {
    if (reloadTimer) clearTimeout(reloadTimer);
    for (const [file, listener] of watched) fs.unwatchFile(file, listener);
    watched.clear();
  }
  server.once('close', cleanup);
  server.once('error', cleanup);
  const listenHost = options.host || project.dev.host;
  const listenPort = options.port !== undefined ? Number(options.port) : project.dev.port;
  server.listen(listenPort, listenHost);
  await once(server, 'listening');
  const address = server.address();
  const boundHost = typeof address === 'object' && address ? address.address : listenHost;
  const boundPort = typeof address === 'object' && address ? address.port : listenPort;
  const advertisedHost = listenHost === '0.0.0.0' || listenHost === '::' ? '127.0.0.1' : listenHost;
  const urlHost = advertisedHost.includes(':') ? `[${advertisedHost}]` : advertisedHost;
  const ready = Object.freeze({
    event: 'ready',
    version: PROJECT_EXECUTION_VERSION,
    provider: project.provider,
    target: 'javascript',
    targetId: descriptor.targetId,
    runtimeClass: descriptor.runtimeClass,
    host: boundHost,
    port: boundPort,
    url: `http://${urlHost}:${boundPort}`,
    watch: watched.size > 0,
    watchFiles: Object.freeze([...watched.keys()].map((file) => relative(file, project.root))),
    once: Boolean(options.once),
    applicationPlan: Object.freeze({ planHash: prepared.plan.planHash, graphHash: prepared.plan.graph.graphHash }),
    automaticFallback: false,
    project: projectJson(project)
  });
  events(ready);
  return Object.freeze({ server, ready, closed: once(server, 'close') });
}

async function startDevServer(project, options = {}) {
  if ((project.target || 'native') === 'javascript') return startJavascriptDevServer(project, options);
  const driver = assertExecutableProvider(project, 'dev');
  assertImplementedTarget(project, 'dev');
  const executeCanonicalProgram = driver.execute;
  let compiled;
  let program;
  let native;
  let executeNative;
  let exactNativeExecution = false;
  let packageArtifacts = Object.freeze([]);
  let compileError;
  let reloadTimer;
  const watchEnabled = project.dev.watch && options.watch !== false;
  const watched = new Map();
  const events = typeof options.onEvent === 'function' ? options.onEvent : () => {};
  function syncWatchFiles(files) {
    if (!watchEnabled) return;
    const desired = new Set((files || []).map((file) => path.resolve(file)));
    for (const [file, listener] of watched) {
      if (desired.has(file)) continue;
      fs.unwatchFile(file, listener);
      watched.delete(file);
    }
    for (const file of desired) {
      if (watched.has(file)) continue;
      const listener = scheduleReload;
      fs.watchFile(file, { interval: 200 }, listener);
      watched.set(file, listener);
    }
  }
  function reload(reason) {
    try {
      const nextCompiled = compileProject(project);
      const nextExactNativeExecution = requiresExactNativeExecution(nextCompiled);
      const nextProgram = nextExactNativeExecution ? null : loadCanonicalModule(nextCompiled);
      const nextNative = nextExactNativeExecution
        ? compileNativeProjectInMemory(project, { ...options, compiled: nextCompiled }).native
        : null;
      const nextExecuteNative = nextExactNativeExecution ? prepareNativeExecution(project, nextCompiled, nextNative) : null;
      compiled = nextCompiled;
      program = nextProgram;
      native = nextNative;
      executeNative = nextExecuteNative;
      exactNativeExecution = nextExactNativeExecution;
      packageArtifacts = packageRealizationArtifactsForCompiled(nextCompiled);
      compileError = undefined;
      syncWatchFiles(compiled.watchFiles);
      events(Object.freeze({
        event: reason === 'initial' ? 'compiled' : 'reloaded',
        entry: relative(project.entryFile, project.root),
        sourceHash: compiled.metadata.sourceHash,
        projectSourceHash: compiled.metadata.projectSourceHash,
        schemaSourceHash: compiled.metadata.schemaSourceHash,
        watchFiles: Object.freeze(compiled.watchFiles.map((file) => relative(file, project.root)))
      }));
    } catch (error) {
      if (!program && !executeNative) compileError = error;
      events(Object.freeze({ event: 'compile-error', retainedLastGoodProgram: Boolean(program || executeNative), error: errorSummary(error, project.dev.secrets) }));
    }
  }
  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { reloadTimer = undefined; reload('change'); }, 60);
  }
  reload('initial');
  if (compileError) throw compileError;

  let handled = 0;
  const server = http.createServer(async (req, res) => {
    const budget = require('@pulse-compute/wasm-host-runtime/runtime/canonical-api-runtime').createRequestBudget(providerExecutionOptions(project, {}));
    if (options.once) res.once('finish', () => server.close());
    try {
      if (compileError) throw compileError;
      const bodyLimit = project.schemas.active ? Math.min(project.dev.maxBodyBytes, project.schemas.maxBytes) : project.dev.maxBodyBytes;
      budget.check();
      const body = await budget.race(readRequestBody(req, bodyLimit, budget));
      const host = req.headers.host || `${project.dev.host}:${project.dev.port}`;
      const url = new URL(req.url || '/', `http://${host}`);
      const executionOptions = providerExecutionOptions(project, {
        packageArtifacts,
        requestBudget: budget, signal: budget.signal,
        request: { method: req.method || 'GET', url: url.href, path: url.pathname, headers: requestHeaders(req), body: body || undefined },
        config: project.dev.config,
        secrets: project.dev.secrets,
        kv: project.dev.kv,
        fetches: project.dev.fetches,
        maxBodyBytes: bodyLimit,
        fetchImplementation: project.dev.networkFetch ? globalThis.fetch : undefined,
        liveFetch: project.dev.networkFetch,
        executionId: `dev:${++handled}`
      });
      const execution = exactNativeExecution
        ? await executeNative(executionOptions)
        : await executeCanonicalProgram(program, executionOptions);
      writeNodeHttpResponse(res, execution.response, { requestBudget: budget });
      events(Object.freeze({ event: 'request', method: req.method || 'GET', path: url.pathname, status: execution.response.status, effects: execution.effectCount }));
    } catch (error) {
      devErrorResponse(res, error, project.dev.secrets);
      events(Object.freeze({ event: 'request-error', method: req.method || 'GET', path: req.url || '/', error: errorSummary(error, project.dev.secrets) }));
    } finally { budget.close(); }
  });

  function cleanup() {
    if (reloadTimer) clearTimeout(reloadTimer);
    for (const [file, listener] of watched) fs.unwatchFile(file, listener);
    watched.clear();
  }
  server.once('close', cleanup);
  server.once('error', cleanup);
  const listenHost = options.host || project.dev.host;
  const listenPort = options.port !== undefined ? Number(options.port) : project.dev.port;
  server.listen(listenPort, listenHost);
  await once(server, 'listening');
  const address = server.address();
  const boundHost = typeof address === 'object' && address ? address.address : listenHost;
  const boundPort = typeof address === 'object' && address ? address.port : listenPort;
  const advertisedHost = listenHost === '0.0.0.0' || listenHost === '::' ? '127.0.0.1' : listenHost;
  const urlHost = advertisedHost.includes(':') ? `[${advertisedHost}]` : advertisedHost;
  const ready = Object.freeze({
    event: 'ready',
    version: PROJECT_EXECUTION_VERSION,
    provider: project.provider,
    host: boundHost,
    port: boundPort,
    url: `http://${urlHost}:${boundPort}`,
    watch: watched.size > 0,
    watchFiles: Object.freeze([...watched.keys()].map((file) => relative(file, project.root))),
    once: Boolean(options.once),
    project: projectJson(project)
  });
  events(ready);
  return Object.freeze({ server, ready, closed: once(server, 'close') });
}

function initProject(target, options = {}) {
  const root = path.resolve(target || '.');
  if (fs.existsSync(root)) {
    const entries = fs.readdirSync(root);
    if (entries.length > 0 && !options.force) throw new PulseProjectError('PULSE_INIT_NOT_EMPTY', `Target directory is not empty: ${root}`, { root, hint: 'Use --force only when replacing the generated Pulse files is intentional.' });
  }

  const normalizedName = String(options.name || path.basename(root) || 'pulse-app').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const name = normalizedName || 'pulse-app';
  const provider = String(options.provider || 'node').toLowerCase();
  let driver;
  try {
    driver = getProviderDriver(provider);
  } catch (_) {
    throw new PulseProjectError(
      'PULSE_INIT_PROVIDER_UNSUPPORTED',
      'pulse init requires a registered executable provider template.',
      { provider, supported: providerIds({ executable: true }) }
    );
  }
  if (!driver.executable || typeof driver.initTemplate !== 'function') {
    throw new PulseProjectError(
      'PULSE_INIT_PROVIDER_UNSUPPORTED',
      'pulse init requires a registered executable provider template.',
      { provider, supported: providerIds({ executable: true }) }
    );
  }
  const template = driver.initTemplate(name);
  const profileFragments = `    outDir: 'dist',
    dev: { host: '127.0.0.1', port: 8787 },
${template.profileFragment || ''}`;

  const dependencies = { '@pulse-compute/pulse': cliPackageVersion };
  Object.assign(dependencies, template.dependencies || {});

  const files = {
    '.gitignore': 'dist\nnode_modules\n',
    '.pulse/.gitignore': '*\n!.gitignore\n!config.ts\n',
    '.pulse/config.ts': `import { defineConfig } from '@pulse-compute/pulse';

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: '${provider}',
    target: 'native',
${profileFragments}
  },
}));
`,
    'README.md': `# ${name}\n\nInstall dependencies with \`npm install\`, then run \`npm run doctor\`.\n\nThe generated project uses the conventional \`.pulse/config.ts\` workspace, an async \`Pulse\` application root, and a dedicated test harness.\n\nUse \`npm run dev\`, \`npm test\`, \`npm run inspect\`, \`npm run compile\`, and \`npm run build\` for the canonical project workflow.\n`,
    'package.json': stableJson({
      name,
      version: '0.0.0',
      private: true,
      scripts: {
        build: 'pulse build',
        compile: 'pulse compile',
        dev: 'pulse dev',
        doctor: 'pulse doctor',
        inspect: 'pulse inspect',
        test: 'pulse test'
      },
      dependencies,
      devDependencies: { '@pulse-compute/cli': cliPackageVersion, typescript: '5.9.3' }
    }),
    'src/index.ts': `import { Pulse } from '@pulse-compute/pulse';

const app = new Pulse({ auto: true });

app.get('/health', async (ctx) => {
  return ctx.json({ ok: true });
});

app.get('/', async (ctx) => {
  return ctx.text('Pulse is running');
});

export default app;
`,
    'tests/pulse.harness.ts': `export default {
  cases: [
    {
      name: 'health',
      request: { method: 'GET', path: '/health' },
      expect: { status: 200, json: { ok: true } },
    },
  ],
};
`,
    'tsconfig.json': stableJson({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false
      },
      include: ['src/**/*.ts', '.pulse/**/*.ts', 'tests/**/*.ts']
    })
  };

  const fileNames = Object.keys(files).sort();
  for (const name of fileNames) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && !options.force) throw new PulseProjectError('PULSE_INIT_FILE_EXISTS', `Refusing to overwrite ${file}.`, { file });
    fs.writeFileSync(file, files[name]);
  }

  return Object.freeze({
    status: 'initialized',
    version: PROJECT_EXECUTION_VERSION,
    root,
    files: Object.freeze(fileNames),
    packageManager: 'npm',
    nextSteps: Object.freeze([`cd ${root}`, 'npm install', 'npm run doctor'])
  });
}

module.exports = {
  PROJECT_EXECUTION_VERSION,
  BUILD_MANIFEST,
  COMPILE_MANIFEST,
  resolveOutputDirectory,
  compileProject,
  compileNativeProjectInMemory,
  prepareJavascriptApplication,
  compileNativeProject,
  buildProject,
  runProjectTests,
  inspectProject,
  doctorProject,
  startDevServer,
  initProject,
  errorSummary,
  responseJson
};
