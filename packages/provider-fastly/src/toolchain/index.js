'use strict';

const path = require('node:path');
const {
  PROVIDER_DRIVER_VERSION,
  PROVIDER_TARGET_RESULT_VERSION,
  PROVIDER_PACKAGING_AUDIT_VERSION,
  defineProviderToolchain,
  defineProviderDriver,
  normalizeProviderTargetResult,
  normalizeProviderJavascriptPackageResult
} = require('@pulse-compute/wasm-contracts/provider/toolchain');
const { defineFinalWasmPolicy, FINAL_WASM_POLICY_VERSION } = require('@pulse-compute/wasm-contracts/provider/final-wasm-policy');
const { defineCryptoTargetCapabilities } = require('@pulse-compute/wasm-contracts/crypto/contracts');
const nativeRuntime = require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime');
const fastlyRuntime = require('../runtime/canonical-api-runtime.js');
const { writeFastlyCanonicalTarget, inspectFastlyCanonicalTarget } = require('../build/canonical-target.js');
const { FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS } = require('../build/native-platform-capabilities.js');
const { FASTLY_PROVIDER_DESCRIPTOR, createFastlyLoweringPlan } = require('../provider-contract.js');
const { FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR } = require('../javascript/target.js');
const { FASTLY_JAVASCRIPT_TARGET_SUPPORT_DECLARATION } = require('../javascript/support.js');
const {
  classifyFastlyJavascriptCapability,
  classifyFastlyJavascriptProviderRequirement,
  fastlyJavascriptProjectRestrictions
} = require('../javascript/target-support-policy.js');
const fastlyJavascriptTestRuntime = require('../javascript/test-runtime.js');
const fastlyJavascriptLocalLoader = require('../javascript/local-loader.js');
const { writeFastlyJavascriptSourcePackage } = require('../javascript/source-package.js');
const {
  normalizeFastlyProviderConfig,
  fastlyProjectConfigDocument,
  fastlyInitTemplate,
  FASTLY_PROJECT_CONFIG_REFERENCE
} = require('./config.js');
const packageManifest = require('../../package.json');

const reportingTargetCapability = Object.freeze({
  supported: true,
  default: 'info',
  levels: Object.freeze(['off', 'error', 'warn', 'info', 'debug'])
});

const fastlyFinalWasmPolicy = defineFinalWasmPolicy({
  version: FINAL_WASM_POLICY_VERSION,
  descriptorOwner: packageManifest.name,
  toolchainVersion: 'pulse.provider-toolchain.v1',
  descriptorIdentity: 'fastly-compute-native',
  permittedImports: FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS
    .map(([module, name]) => ({ module, name, kind: 'function' })),
  requiredExports: nativeRuntime.CANONICAL_NATIVE_EXPORTS.map(([name, second]) => ({
    name,
    kind: second === 'memory' ? 'memory' : 'function'
  }))
});

function adjustPackages(packages, restrictions) {
  return packages.map((entry) => {
    if (!entry.required) return entry;
    const packageRestriction = entry.contractId === 'pulse.assets'
      ? restrictions.assets
      : (entry.contractId === 'pulse.grip' ? restrictions.grip : null);
    if (!packageRestriction) return entry;
    return Object.freeze({
      ...entry,
      status: 'blocked',
      reasonId: packageRestriction.reasonId,
      owner: packageRestriction.owner
    });
  });
}

function createDriver() {
  return defineProviderDriver({
    version: PROVIDER_DRIVER_VERSION,
    id: 'fastly',
    descriptor: FASTLY_PROVIDER_DESCRIPTOR,
    executable: true,
    localExecution: true,
    deployable: true,
    deploymentValidated: false,
    sourcePackage: true,
    compiledWasm: true,
    defaultBuildMode: 'native-provider',
    sourceOnlySupported: false,
    targetSupport: Object.freeze({ javascript: FASTLY_JAVASCRIPT_TARGET_SUPPORT_DECLARATION }),
    normalizeConfig: normalizeFastlyProviderConfig,
    defaultLocalNetworkFetch: false,
    projectConfigDocument: fastlyProjectConfigDocument,
    configReference: FASTLY_PROJECT_CONFIG_REFERENCE,
    initTemplate: fastlyInitTemplate,
    javascript: Object.freeze({
      kind: 'provider-bundled',
      localEmulation: true,
      buildTimeLoader: true,
      localExecutionMode: fastlyJavascriptTestRuntime.FASTLY_JAVASCRIPT_LOCAL_EXECUTION_MODE,
      realityRunner: 'fastly compute serve',
      targetSupportPolicy: Object.freeze({
          providerId: 'fastly',
          declaration: FASTLY_JAVASCRIPT_TARGET_SUPPORT_DECLARATION,
          context: fastlyJavascriptProjectRestrictions,
          classifyCapability: classifyFastlyJavascriptCapability,
          classifyProviderRequirement(id, _compilerCapabilities, restrictions) {
            return classifyFastlyJavascriptProviderRequirement(id, restrictions);
          },
          packageOptions: Object.freeze({
            suppliedCoreOwner: 'runtime',
            packageResolutionReasonId: 'fastly-esbuild-package-resolution-planned',
            packageResolutionOwner: 'provider-fastly',
            packageRuntimeOwner: 'provider-fastly'
          }),
          adjustPackages,
          commandOptions: Object.freeze({ projectScopedBuild: true })
      }),
      loadApplication(plan, options) {
        return fastlyJavascriptLocalLoader.loadFastlyJavascriptLocalApplication(plan, {
          projectRoot: options.projectRoot,
          schemaBundle: options.schemaBundle
        });
      },
      writeSourcePackage(invocation) {
        return normalizeProviderJavascriptPackageResult(writeFastlyJavascriptSourcePackage({
          plan: invocation.applicationPlan,
          projectRoot: invocation.project.root,
          outDir: invocation.project.outDir,
          schemaBundle: invocation.javascript.schemaBundle,
          providerConfig: invocation.providerConfig,
          reporting: invocation.javascript.reporting,
          strict: invocation.javascript.strict,
          maxStructuredBodyBytes: invocation.javascript.maxStructuredBodyBytes,
          targetSupport: invocation.javascript.targetSupport
        }), { provider: 'fastly' });
      },
      describeSourcePackage(sourcePackage, context) {
        return Object.freeze({
          deploymentCandidate: true,
          downstreamJavascriptRuntimeWasm: true,
          application: Object.freeze({
            entry: path.relative(context.outDir, sourcePackage.paths.entry).replace(/\\/g, '/'),
            modules: context.plan.graph.modules.filter((entry) => entry.runtime).length,
            bundledApplication: path.relative(context.outDir, sourcePackage.paths.bundledApplication).replace(/\\/g, '/'),
            deployment: path.basename(sourcePackage.paths.deployment),
            deploymentCandidate: path.basename(sourcePackage.paths.deploymentCandidate),
            fastlyToml: path.basename(sourcePackage.paths.fastlyToml),
            buildConfig: path.basename(sourcePackage.paths.buildConfig),
            bundledInputs: sourcePackage.manifest.summary.bundledInputs
          }),
          files: Object.freeze({
            bundledApplication: sourcePackage.paths.bundledApplication,
            deployment: sourcePackage.paths.deployment,
            deploymentCandidate: sourcePackage.paths.deploymentCandidate,
            fastlyToml: sourcePackage.paths.fastlyToml,
            buildConfig: sourcePackage.paths.buildConfig
          })
        });
      },
      executeTestCase(application, testCase, options) {
        return fastlyJavascriptTestRuntime.executeFastlyJavascriptTestCase(application, testCase, options);
      },
      createLocalEnvironment: fastlyJavascriptTestRuntime.createFastlyJavascriptLocalEnvironment,
      createTestRequest: fastlyJavascriptTestRuntime.createFastlyJavascriptTestRequest,
      executeLocalRequest: fastlyJavascriptTestRuntime.executeFastlyJavascriptLocalRequest
    }),
    targets: Object.freeze({
      native: Object.freeze({
        version: 'pulse.provider-target-descriptor.v1',
        target: 'native',
        targetId: 'fastly-compute-native',
        runtimeClass: 'native',
        status: 'supported',
        capabilities: Object.freeze([
          's3.head', 's3.getText',
          'kv.getVersioned', 'kv.insertIfAbsent', 'kv.compareAndSwap',
          'jwt.verify',
          'jwt.verify.hs256',
          'jwt.verify.es256',
          'secret.get',
          'time.wall-clock'
        ]),
        keyTypes: Object.freeze(['secret', 'jwk', 'jwks']),
        realizations: Object.freeze([
          Object.freeze({
            kind: 'crypto-composed',
            realization: 'guest-source:pulse-hmac-as',
            implementation: 'pulse-hmac-as.v1',
            algorithms: Object.freeze(['HS256']),
            keyTypes: Object.freeze(['secret']),
            implemented: true,
            status: 'implemented-e2',
            semanticOwner: '@pulse-compute/crypto',
            guestUnitRequired: false,
            portable: true,
            automaticFallback: false
          }),
          Object.freeze({
            kind: 'crypto-composed',
            realization: 'guest-linked:pulse-es256-rustcrypto-p256',
            implementation: 'rustcrypto.p256-0.13.2.ecdsa-0.16.9.sha2-0.10.9.v1',
            algorithms: Object.freeze(['ES256']),
            keyTypes: Object.freeze(['jwk', 'jwks']),
            implemented: true,
            status: 'implemented-g4',
            semanticOwner: '@pulse-compute/crypto',
            guestUnitRequired: true,
            portable: true,
            automaticFallback: false
          })
        ]),
        jwt: Object.freeze({
          status: 'implemented-e2',
          realization: 'guest-source:pulse-hmac-as',
          implementation: 'pulse-hmac-as.v1',
          packageSource: 'pulse-jwt-as',
          providerAuthorities: Object.freeze([
            'request',
            'secret',
            'wall-clock',
            'schema',
            'error-transport'
          ]),
          automaticFallback: false
        }),
        automaticFallback: false,
        crypto: defineCryptoTargetCapabilities({
          target: 'native',
          algorithms: [...['SHA-256', 'HMAC-SHA256'].map((algorithm) => ({ algorithm, realization: 'guest-source:pulse-hmac-as', implemented: true, status: 'implemented-o2' })), {
            algorithm: 'HS256',
            realization: 'guest-source:pulse-hmac-as',
            implemented: true,
            status: 'implemented-c3'
          }, {
            algorithm: 'ES256',
            realization: 'guest-linked:pulse-es256-rustcrypto-p256',
            implemented: true,
            status: 'implemented-g4'
          }]
        }),
        finalWasmPolicy: fastlyFinalWasmPolicy,
        reporting: reportingTargetCapability,
        commands: Object.freeze({ compile: true, inspect: true, doctor: true, build: true, test: true, dev: true })
      }),
      javascript: FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR
    }),
    execute: fastlyRuntime.executeCanonicalProgram,
    prepareNativeExecution: require('./native-execution.js').prepareFastlyNativeExecution,
    createLoweringPlan(metadata, providerConfig = {}) {
      return createFastlyLoweringPlan(metadata, providerConfig.bindings || {});
    },
    inspectRealization(invocation) {
      const realization = inspectFastlyCanonicalTarget({
        plan: invocation.applicationPlan,
        providerPlan: invocation.providerPlan,
        providerConfig: invocation.providerConfig,
        projectRoot: invocation.project.root,
        profile: invocation.project.profile,
        targetDescriptor: invocation.selectedTarget,
        synchronizedPackages: invocation.synchronizedPackages,
        realizationArtifacts: invocation.nativeArtifact.realizationArtifacts,
        guestUnits: invocation.nativeArtifact.guestUnits,
        nativeOptimization: invocation.optimization,
        compileTimeoutMs: invocation.timeoutMs
      });
      const { native, ...publicRealization } = realization;
      return normalizeProviderTargetResult({
        version: PROVIDER_TARGET_RESULT_VERSION,
        action: 'inspect-native',
        provider: 'fastly',
        target: 'native',
        status: 'inspected',
        automaticFallback: false,
        files: Object.freeze({}),
        build: null,
        realization: publicRealization,
        packaging: null
      });
    },
    writeTarget(invocation) {
      const inspected = inspectFastlyCanonicalTarget({
        plan: invocation.applicationPlan,
        providerPlan: invocation.providerPlan,
        providerConfig: invocation.providerConfig,
        projectRoot: invocation.project.root,
        profile: invocation.project.profile,
        targetDescriptor: invocation.selectedTarget,
        synchronizedPackages: invocation.synchronizedPackages,
        realizationArtifacts: invocation.nativeArtifact.realizationArtifacts,
        guestUnits: invocation.nativeArtifact.guestUnits,
        nativeOptimization: invocation.optimization,
        compileTimeoutMs: invocation.timeoutMs
      });
      const providerBuild = writeFastlyCanonicalTarget({
        outDir: invocation.project.outDir,
        plan: invocation.applicationPlan,
        providerPlan: invocation.providerPlan,
        native: inspected.native,
        providerConfig: invocation.providerConfig,
        bindings: invocation.providerConfig.bindings,
        projectRoot: invocation.project.root,
        profile: invocation.project.profile,
        targetDescriptor: invocation.selectedTarget,
        synchronizedPackages: invocation.synchronizedPackages
      });
      const { native, ...publicRealization } = inspected;
      const audit = native.guestLink && native.guestLink.audit;
      return normalizeProviderTargetResult({
        version: PROVIDER_TARGET_RESULT_VERSION,
        action: 'write-native',
        provider: 'fastly',
        target: 'native',
        status: 'built',
        automaticFallback: false,
        files: Object.freeze({
          provider: providerBuild.providerFile,
          providerEntry: providerBuild.entryFile,
          providerBuild: providerBuild.buildFile,
          providerWasm: providerBuild.wasmFile,
          providerWat: providerBuild.watFile,
          providerNativePlan: providerBuild.nativePlanFile,
          providerNativeManifest: providerBuild.nativeManifestFile,
          fastlyToml: providerBuild.fastlyTomlFile,
          providerPackage: providerBuild.packageFile,
          providerSourceEntry: providerBuild.sourceEntryFile
        }),
        build: providerBuild.build,
        realization: publicRealization,
        packaging: audit ? Object.freeze({
          version: PROVIDER_PACKAGING_AUDIT_VERSION,
          artifactSha256: providerBuild.build.wasm.sha256,
          auditedSha256: audit.artifact.sha256,
          authorized: native.guestLink.providerPackaging.authorized === true
        }) : null
      });
    },
    executionOptions(providerConfig = {}, values = {}) {
      return { ...values, maxDurationMs: providerConfig.maxDurationMs, bindings: providerConfig.bindings };
    }
  });
}

module.exports = defineProviderToolchain({
  version: 'pulse.provider-toolchain.v1',
  id: 'fastly',
  packageName: packageManifest.name,
  packageVersion: packageManifest.version,
  createDriver
});
