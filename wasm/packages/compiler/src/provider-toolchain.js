'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const {
  PROVIDER_DRIVER_VERSION,
  PROVIDER_TARGET_RESULT_VERSION,
  assertProviderToolchain,
  assertProviderDriver,
  normalizeProviderTargetResult
} = require('@pulse-compute/wasm-contracts/provider/toolchain');

const PROVIDER_PACKAGE_SCOPE = '@pulse-compute';
const PROVIDER_PACKAGE_PREFIX = 'provider-';
const BUILTIN_PROVIDER_IDS = Object.freeze(['node', 'fastly', 'none']);
const loadedByEntry = new Map();

const reportingTargetCapability = Object.freeze({
  supported: true,
  default: 'info',
  levels: Object.freeze(['off', 'error', 'warn', 'info', 'debug'])
});

const noneDriver = assertProviderDriver({
  version: PROVIDER_DRIVER_VERSION,
  id: 'none',
  descriptor: undefined,
  executable: false,
  localExecution: false,
  deployable: false,
  deploymentValidated: false,
  sourcePackage: false,
  compiledWasm: true,
  defaultBuildMode: 'compile-only',
  sourceOnlySupported: false,
  normalizeConfig() {
    return Object.freeze({ kind: 'none', bindings: Object.freeze({}), local: Object.freeze({}) });
  },
  defaultLocalNetworkFetch: false,
  projectConfigDocument() { return undefined; },
  initTemplate() {
    return Object.freeze({ profileFragment: '', dependencies: Object.freeze({}) });
  },
  targets: Object.freeze({
    native: Object.freeze({
      version: 'pulse.provider-target-descriptor.v1',
      target: 'native',
      targetId: 'portable-native-wasm',
      runtimeClass: 'native',
      status: 'compile-only',
      automaticFallback: false,
      reporting: reportingTargetCapability,
      commands: Object.freeze({ compile: true, inspect: true, doctor: true, build: false, test: false, dev: false })
    }),
    javascript: Object.freeze({
      version: 'pulse.javascript-target-descriptor.v2',
      target: 'javascript',
      targetId: 'none-javascript',
      runtimeClass: 'javascript',
      status: 'unsupported',
      sourceApplication: true,
      automaticFallback: false,
      hostBridge: false,
      applicationLoader: false,
      requestAdapter: false,
      lifecycle: false,
      reporting: reportingTargetCapability,
      commands: Object.freeze({ compile: true, inspect: true, doctor: true, build: false, test: false, dev: false })
    })
  }),
  inspectRealization(invocation) {
    const artifact = invocation.nativeArtifact;
    return normalizeProviderTargetResult({
      version: PROVIDER_TARGET_RESULT_VERSION,
      action: 'inspect-native',
      provider: 'none',
      target: 'native',
      status: 'inspected',
      automaticFallback: false,
      files: Object.freeze({}),
      build: null,
      realization: Object.freeze({
        target: 'portable-native-wasm',
        provider: null,
        providerNeutralWasm: true,
        nativeWasm: true,
        javascriptRuntime: false,
        jsComputeRuntime: false,
        wasm: artifact.manifest.wasm,
        wat: artifact.manifest.wat,
        importModules: artifact.manifest.importModules,
        imports: artifact.manifest.imports,
        exports: artifact.manifest.exports
      }),
      packaging: null
    });
  }
});

function providerError(code, message, detail = {}, cause) {
  const error = new TypeError(message, cause ? { cause } : undefined);
  error.code = code;
  error.detail = Object.freeze({ ...detail });
  return error;
}

function normalizeSelector(value) {
  const selector = String(value || '').trim();
  if (!selector) throw providerError('PULSE_PROVIDER_UNSUPPORTED', 'Pulse provider selection must not be empty.');
  return selector.startsWith('@') ? selector : selector.toLowerCase();
}

function assertPackageName(value) {
  const packageName = String(value);
  const segment = '[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?';
  const valid = new RegExp(`^(?:${segment}|@${segment}/${segment})$`).test(packageName);
  if (!valid || packageName === '.' || packageName === '..') {
    throw providerError(
      'PULSE_PROVIDER_UNSUPPORTED',
      `Pulse provider "${packageName}" must be an exact npm package name.`,
      { selector: packageName }
    );
  }
  return packageName;
}

function providerPackageName(value) {
  const selector = normalizeSelector(value);
  if (selector === 'none') return null;
  if (selector.startsWith('@')) return assertPackageName(selector);
  return `${PROVIDER_PACKAGE_SCOPE}/${PROVIDER_PACKAGE_PREFIX}${assertPackageName(selector)}`;
}

function projectRequire(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  return createRequire(path.join(root, 'package.json'));
}

function resolveToolchainEntry(selector, packageName, options = {}) {
  const request = `${packageName}/toolchain`;
  const builtin = BUILTIN_PROVIDER_IDS.includes(selector);
  const resolver = builtin ? require : projectRequire(options.projectRoot);
  try {
    return resolver.resolve(request);
  } catch (cause) {
    throw providerError(
      'PULSE_PROVIDER_PACKAGE_NOT_FOUND',
      `Pulse provider package "${packageName}" does not expose ${request}.`,
      {
        selector,
        packageName,
        projectRoot: path.resolve(options.projectRoot || process.cwd()),
        entrypoint: './toolchain'
      },
      cause
    );
  }
}

function loadProviderToolchain(selector, packageName, entry) {
  const cached = loadedByEntry.get(entry);
  if (cached) return cached;
  let declared;
  try {
    declared = require(entry);
  } catch (cause) {
    throw providerError(
      'PULSE_PROVIDER_TOOLCHAIN_LOAD_FAILED',
      `Pulse could not load provider toolchain "${packageName}/toolchain".`,
      { selector, packageName, entrypoint: './toolchain' },
      cause
    );
  }
  let toolchain;
  try {
    toolchain = assertProviderToolchain(declared, {
      packageName,
      id: BUILTIN_PROVIDER_IDS.includes(selector) ? selector : undefined
    });
  } catch (cause) {
    throw providerError(
      'PULSE_PROVIDER_TOOLCHAIN_INVALID',
      `Provider package "${packageName}" does not implement the Pulse provider toolchain contract.`,
      { selector, packageName, entrypoint: './toolchain' },
      cause
    );
  }
  let driver;
  try {
    driver = assertProviderDriver(toolchain.createDriver(), { id: toolchain.id });
  } catch (cause) {
    if (cause && cause.code === 'PULSE_PROVIDER_TOOLCHAIN_INVALID') throw cause;
    throw providerError(
      'PULSE_PROVIDER_TOOLCHAIN_LOAD_FAILED',
      `Provider package "${packageName}" failed while creating its Pulse driver.`,
      { selector, packageName, entrypoint: './toolchain' },
      cause
    );
  }
  const loaded = Object.freeze({ toolchain, driver });
  loadedByEntry.set(entry, loaded);
  return loaded;
}

function resolveProviderToolchain(value, options = {}) {
  const selector = normalizeSelector(value);
  if (selector === 'none') {
    return Object.freeze({
      selector,
      id: 'none',
      packageName: null,
      packageVersion: null,
      contractVersion: null,
      entrypoint: null,
      official: true,
      driver: noneDriver
    });
  }
  const packageName = providerPackageName(selector);
  const entry = resolveToolchainEntry(selector, packageName, options);
  const loaded = loadProviderToolchain(selector, packageName, entry);
  return Object.freeze({
    selector,
    id: loaded.driver.id,
    packageName: loaded.toolchain.packageName,
    packageVersion: loaded.toolchain.packageVersion,
    contractVersion: loaded.toolchain.version,
    entrypoint: './toolchain',
    official: BUILTIN_PROVIDER_IDS.includes(selector),
    driver: loaded.driver
  });
}

function getProviderDriver(value, options = {}) {
  return resolveProviderToolchain(value, options).driver;
}

function getProviderTargetDescriptor(provider, target = 'native', options = {}) {
  const driver = typeof provider === 'string' ? getProviderDriver(provider, options) : provider;
  const descriptor = driver.targets && driver.targets[String(target || 'native').toLowerCase()];
  if (!descriptor) throw new TypeError(`Unknown Pulse target ${String(target)} for provider ${driver.id}.`);
  return descriptor;
}

function getProviderTargetSupportDeclaration(provider, target = 'native', options = {}) {
  const driver = typeof provider === 'string' ? getProviderDriver(provider, options) : provider;
  return driver.targetSupport && driver.targetSupport[String(target || 'native').toLowerCase()] || null;
}

function providerTargetAvailability(provider, options = {}) {
  const driver = typeof provider === 'string' ? getProviderDriver(provider, options) : provider;
  const native = driver.targets && driver.targets.native;
  const javascript = driver.targets && driver.targets.javascript;
  const javascriptSupport = getProviderTargetSupportDeclaration(driver, 'javascript');
  return Object.freeze({
    native: Boolean(native && ['supported', 'compile-only'].includes(native.status)),
    javascript: javascriptSupport
      ? javascriptSupport.availability.generalAvailable === true
      : Boolean(javascript && javascript.status === 'supported'),
    descriptors: Object.freeze({ native, javascript })
  });
}

function providerIds(options = {}) {
  return Object.freeze(BUILTIN_PROVIDER_IDS.filter((id) => (
    options.executable !== true || getProviderDriver(id).executable === true
  )));
}

function providerConfigReferences() {
  return Object.freeze(BUILTIN_PROVIDER_IDS
    .map((id) => getProviderDriver(id))
    .filter((driver) => driver.configReference)
    .map((driver) => driver.configReference));
}

const drivers = {};
for (const id of BUILTIN_PROVIDER_IDS) {
  Object.defineProperty(drivers, id, {
    enumerable: true,
    get() { return getProviderDriver(id); }
  });
}
Object.freeze(drivers);

module.exports = Object.freeze({
  PROVIDER_PACKAGE_SCOPE,
  PROVIDER_PACKAGE_PREFIX,
  BUILTIN_PROVIDER_IDS,
  drivers,
  providerPackageName,
  resolveProviderToolchain,
  getProviderDriver,
  getProviderTargetDescriptor,
  getProviderTargetSupportDeclaration,
  providerTargetAvailability,
  providerIds,
  providerConfigReferences
});
