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
const canonicalProvider = require('@pulse-compute/wasm-contracts/provider/canonical-provider');
const nodeRuntime = require('./runtime/canonical-api-runtime.js');
const { NODE_NATIVE_TARGET_DESCRIPTOR } = require('./native/target.js');
const { NODE_JAVASCRIPT_TARGET_DESCRIPTOR } = require('./javascript/target.js');
const { NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION } = require('./javascript/support.js');
const {
  classifyNodeJavascriptCapability,
  classifyNodeJavascriptProviderRequirement
} = require('./javascript/target-support-policy.js');
const nodeJavascriptHost = require('./javascript/runtime-host.js');
const nodeJavascriptLifecycle = require('./javascript/lifecycle.js');
const nodeJavascriptTestRuntime = require('./javascript/test-runtime.js');
const { createNodeEventReferenceAdapter } = require('./events/reference-adapter.js');
const { writeNodeJavascriptSourcePackage } = require('./javascript/source-package.js');
const packageManifest = require('../package.json');

const reportingTargetCapability = Object.freeze({
  supported: true,
  default: 'info',
  levels: Object.freeze(['off', 'error', 'warn', 'info', 'debug'])
});

function genericProviderConfig(value) {
  const input = value && typeof value === 'object' ? value : {};
  const bindings = input.bindings || {};
  if (Object.keys(bindings).some((key) => key !== 's3')) throw new TypeError('Unknown Node binding field.');
  return Object.freeze({ kind: 'node', maxDurationMs: require('@pulse-compute/runtime/host').normalizeRequestDuration(input.maxDurationMs), bindings: Object.freeze({ s3: require('./config/s3.js').normalizeNodeS3(bindings.s3) }), local: Object.freeze({}) });
}

function nodeRealization(nativeArtifact) {
  return Object.freeze({
    target: 'node-native-host',
    provider: 'node',
    providerNeutralWasm: true,
    nativeWasm: true,
    compiledWasmPresent: true,
    sourceOnly: false,
    sourceOnlySupported: false,
    javascriptRuntime: false,
    jsComputeRuntime: false,
    wasm: nativeArtifact.manifest.wasm,
    wat: nativeArtifact.manifest.wat,
    importModules: nativeArtifact.manifest.importModules,
    imports: nativeArtifact.manifest.imports,
    exports: nativeArtifact.manifest.exports,
    packageRealizationArtifacts: nativeArtifact.manifest.packageRealizationArtifacts,
    compiler: Object.freeze({
      package: nativeArtifact.manifest.assemblyScript.package,
      version: nativeArtifact.manifest.assemblyScript.version,
      targetCompilerVersion: nativeArtifact.compilerVersion
    }),
    optimization: nativeArtifact.manifest.optimization
  });
}

function targetSupportContext(_compiled, _project, declaration) {
  const gates = declaration.availability && declaration.availability.gates || [];
  return Object.freeze({
    bindingsRedaction: gates.some((entry) => entry.id === 'bindings-redaction' && entry.status === 'satisfied'),
    gripRealized: gates.some((entry) => entry.id === 'grip-readiness' && entry.evidence && entry.evidence.status === 'passed')
  });
}

async function executeNodeEventTestCase(invocation = {}) {
  const target = String(invocation.target || '');
  if (!['javascript', 'native'].includes(target)) {
    throw new TypeError(`Node event test execution does not support target ${JSON.stringify(target)}.`);
  }
  const testCase = invocation.testCase || {};
  const options = invocation.options || {};
  const adapter = createNodeEventReferenceAdapter({
    id: `pulse-test-${target}`,
    maxQueueDepth: 1024
  });
  let executionEvidence = null;
  const common = {
    application: options.application,
    config: testCase.config || {},
    secrets: testCase.secrets || {},
    kv: testCase.kv || {},
    grip: testCase.grip || {},
    fetches: testCase.fetches || {},
    eventAdapter: adapter,
    schemaCodecs: options.schemaCodecs,
    reporting: options.reporting,
    maxEffects: options.maxEffects,
    maxBindingNameBytes: options.maxBindingNameBytes,
    maxBindingValueBytes: options.maxBindingValueBytes,
    maxKvNamespaceBytes: options.maxKvNamespaceBytes,
    maxKvKeyBytes: options.maxKvKeyBytes,
    maxKvValueBytes: options.maxKvValueBytes,
    maxKvValueDepth: options.maxKvValueDepth,
    maxKvValueEntries: options.maxKvValueEntries
  };
  const result = target === 'javascript'
    ? await nodeJavascriptHost.executeNodeJavascriptEvent(invocation.application, testCase.event, {
        ...common,
        fetchImplementation: nodeJavascriptHost.createNodeJavascriptFixtureFetch(
          testCase.fetches || {},
          options.networkFetch === true ? globalThis.fetch : undefined
        ),
        onEffectSummary(value) { executionEvidence = value; }
      })
    : await nodeRuntime.executeNodeNativeEvent(invocation.application, testCase.event, {
        ...common,
        onEventExecutionEvidence(value) { executionEvidence = value; }
      });
  return Object.freeze({
    version: 'pulse.provider-event-test-result.v1',
    target,
    result,
    emittedFrames: adapter.acceptedFrames(),
    adapter: adapter.summary(),
    executionEvidence
  });
}

function createDriver() {
  return defineProviderDriver({
    version: PROVIDER_DRIVER_VERSION,
    id: 'node',
    descriptor: nodeRuntime.NODE_PROVIDER_DESCRIPTOR,
    executable: true,
    localExecution: true,
    deployable: true,
    deploymentValidated: false,
    sourcePackage: false,
    compiledWasm: true,
    defaultBuildMode: 'native-provider',
    sourceOnlySupported: false,
    targetSupport: Object.freeze({ javascript: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION }),
    normalizeConfig: genericProviderConfig,
    configReference: Object.freeze({
      sections: [{ id: 'node', title: 'Node provider options', description: 'Provider-owned Node profile configuration.' }],
      fields: [{ section:'node', path:'node.maxDurationMs', type:'integer', allowed:'1–30000', default:'omitted', scope:'HTTP request execution', description:'One provider-owned monotonic budget shared by request effects and continuations; expiry does not prove rollback of dispatched writes.' }, { section: 'node', path: 'node.bindings.s3', type: 'Readonly<Record<string, S3Binding>>', default: '`{}`', scope: 'Node Native and JavaScript S3',
        description: 'Maps literal logical names to fixed HTTPS endpoint, bucket, region, accessKeyIdSecret, secretAccessKeySecret, optional sessionTokenSecret, maxTextBytes (1–2097152, default 32768) and timeoutMs (1–30000, default 10000).',
        security: 'Only named credential references are configuration. Runtime keys cannot override authority.' }]
    }),
    defaultLocalNetworkFetch: true,
    projectConfigDocument(config) { return (Object.keys(config.bindings.s3).length || config.maxDurationMs !== undefined) ? config : undefined; },
    initTemplate() {
      return Object.freeze({ profileFragment: '', dependencies: Object.freeze({}) });
    },
    executionOptions(config, values) {
      return Object.freeze({
        ...values,
        maxDurationMs: config.maxDurationMs,
        s3: config.bindings.s3,
        s3FetchImplementation: values.s3FetchImplementation || require('./javascript/fetch-adapter.js').createNodeJavascriptFixtureFetch(
          values.fetches || {}, values.fetchImplementation || (values.liveFetch === true ? globalThis.fetch : undefined),
          { rawResponse: true }
        ),
        providerAdapter: nodeRuntime.createNodeProviderAdapter()
      });
    },
    javascript: Object.freeze({
      kind: 'reference-node',
      localEmulation: false,
      buildTimeLoader: false,
      validateApplication: nodeJavascriptHost.assertNodeJavascriptApplication,
      targetSupportPolicy: Object.freeze({
          providerId: 'node',
          declaration: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION,
          context: targetSupportContext,
          classifyCapability: classifyNodeJavascriptCapability,
          classifyProviderRequirement: classifyNodeJavascriptProviderRequirement
      }),
      writeSourcePackage(invocation) {
        return normalizeProviderJavascriptPackageResult(writeNodeJavascriptSourcePackage({
          plan: invocation.applicationPlan,
          projectRoot: invocation.project.root,
          outDir: invocation.project.outDir,
          schemaBundle: invocation.javascript.schemaBundle
        }), { provider: 'node' });
      },
      describeSourcePackage(sourcePackage) {
        return Object.freeze({
          deploymentCandidate: false,
          downstreamJavascriptRuntimeWasm: false,
          application: Object.freeze({
            entry: path.basename(sourcePackage.paths.entry),
            modules: sourcePackage.manifest.summary.modules
          }),
          files: Object.freeze({})
        });
      },
      executeTestCase(application, testCase, options) {
        return nodeJavascriptTestRuntime.executeNodeJavascriptTestCase(application, testCase, options);
      },
      createServer: nodeJavascriptLifecycle.createNodeJavascriptServer,
      createFixtureFetch: nodeJavascriptHost.createNodeJavascriptFixtureFetch
    }),
    events: Object.freeze({
      targets: Object.freeze(['javascript', 'native']),
      executeTestCase: executeNodeEventTestCase
    }),
    targets: Object.freeze({
      native: Object.freeze({
        ...NODE_NATIVE_TARGET_DESCRIPTOR,
        target: 'native',
        targetId: 'node-native-host',
        runtimeClass: 'native',
        status: 'supported',
        automaticFallback: false,
        reporting: reportingTargetCapability,
        commands: Object.freeze({ compile: true, inspect: true, doctor: true, build: true, test: true, dev: true })
      }),
      javascript: NODE_JAVASCRIPT_TARGET_DESCRIPTOR
    }),
    execute: nodeRuntime.executeCanonicalProgram,
    prepareNativeExecution(invocation) {
      const { executeCanonicalNativeModule } = require('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host');
      const native = { ...invocation.nativeArtifact, plan: invocation.applicationPlan };
      return (options) => executeCanonicalNativeModule(native, options);
    },
    createLoweringPlan(metadata, config = {}) {
      require('./config/s3.js').validateNodeS3Operations(metadata, config.bindings || {});
      return canonicalProvider.createProviderLoweringPlan(metadata, nodeRuntime.NODE_PROVIDER_DESCRIPTOR, {
        grip: 'node-reference-broadcaster'
      });
    },
    inspectRealization(invocation) {
      const realization = nodeRealization(invocation.nativeArtifact);
      return normalizeProviderTargetResult({
        version: PROVIDER_TARGET_RESULT_VERSION,
        action: 'inspect-native',
        provider: 'node',
        target: 'native',
        status: 'inspected',
        automaticFallback: false,
        files: Object.freeze({}),
        build: null,
        realization,
        packaging: null
      });
    },
    writeTarget(invocation) {
      const realization = nodeRealization(invocation.nativeArtifact);
      const audit = invocation.nativeArtifact.guestAudit;
      return normalizeProviderTargetResult({
        version: PROVIDER_TARGET_RESULT_VERSION,
        action: 'write-native',
        provider: 'node',
        target: 'native',
        status: 'built',
        automaticFallback: false,
        files: Object.freeze({}),
        build: realization,
        realization,
        packaging: audit ? Object.freeze({
          version: PROVIDER_PACKAGING_AUDIT_VERSION,
          artifactSha256: invocation.nativeArtifact.finalArtifact.sha256,
          auditedSha256: audit.finalArtifact.sha256,
          authorized: audit.providerPackaging.authorized === true
        }) : null
      });
    }
  });
}

module.exports = defineProviderToolchain({
  version: 'pulse.provider-toolchain.v1',
  id: 'node',
  packageName: packageManifest.name,
  packageVersion: packageManifest.version,
  createDriver
});
