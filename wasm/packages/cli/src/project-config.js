'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compileProjectConfigFile } = require('@pulse-compute/wasm-compiler/project-config-compiler');
const configRuntime = require('@pulse-compute/wasm-contracts/project/config-runtime');
const {
  normalizeCryptoConfiguration
} = require('@pulse-compute/wasm-contracts/crypto/contracts');
const { reportingDescriptor } = require('@pulse-compute/wasm-contracts/logging');
const eventContracts = require(path.join(
  path.dirname(require.resolve('@pulse-compute/wasm-contracts')),
  'events',
  'contracts.js'
));
const { extractSchemaRegistry } = require('@pulse-compute/wasm-schema-json/compiler/schema-registry');
const { loadProjectHarness: loadHarnessModule } = require('./typescript-module-loader.js');
const { resolveWorkspace, PulseWorkspaceError, isInside } = require('./workspace.js');
const { getProviderDriver, providerIds, resolveProviderToolchain } = require('./provider-drivers.js');
const {
  PROJECT_CONFIG_SCHEMA_VERSION,
  CONFIG_DISCOVERY,
  configRuntimeRule,
  configDefault,
  validateConfigValue,
  validateProjectConfigStructure,
  projectConfigSchemaDocument
} = require('./project-config-schema.js');

const PROJECT_CONFIG_VERSION = 'pulse.project-config.v4';
const CONFIG_FILE_NAMES = CONFIG_DISCOVERY;
const PROJECT_PROVIDERS = providerIds();

class PulseProjectError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PulseProjectError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function relative(file, root) {
  const value = path.relative(root, file);
  return slash(value || '.');
}

function fileExists(file) {
  try { return fs.statSync(file).isFile(); }
  catch (_) { return false; }
}

function normalizeHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) {
    return headers.map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) throw new PulseProjectError('PULSE_CONFIG_HEADERS_INVALID', 'Headers must be [name, value] pairs.', { headers });
      return Object.freeze([String(entry[0]), String(entry[1])]);
    });
  }
  if (typeof headers === 'object') return Object.freeze(Object.entries(headers).map(([name, value]) => Object.freeze([String(name), String(value)])));
  throw new PulseProjectError('PULSE_CONFIG_HEADERS_INVALID', 'Headers must be an object or [name, value] pairs.', { headersType: typeof headers });
}

function normalizeExpectedHeaders(headers) {
  if (!headers) return [];
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  return Object.freeze(entries.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      throw new PulseProjectError('PULSE_CONFIG_HEADERS_INVALID', 'Expected headers must be [name, value] pairs.', { headers });
    }
    const value = Array.isArray(entry[1]) ? Object.freeze(entry[1].map(String)) : String(entry[1]);
    return Object.freeze([String(entry[0]), value]);
  }));
}

function normalizeRequest(input = {}) {
  const pathValue = String(input.path || (() => {
    try { return new URL(String(input.url || 'http://127.0.0.1/')).pathname; }
    catch (_) { return '/'; }
  })());
  return Object.freeze({
    method: String(input.method || 'GET').toUpperCase(),
    url: input.url ? String(input.url) : `http://127.0.0.1${pathValue}`,
    path: pathValue,
    headers: normalizeHeaders(input.headers),
    body: Object.prototype.hasOwnProperty.call(input, 'body') ? input.body : undefined
  });
}

function normalizeHarnessEvent(input, field) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PulseProjectError('PULSE_TEST_EVENT_INVALID', `${field} must be an event frame object.`);
  }
  const unknown = Object.keys(input).filter((key) => !['type', 'schema', 'schemaId', 'payload'].includes(key)).sort();
  if (unknown.length > 0) {
    throw new PulseProjectError('PULSE_TEST_EVENT_INVALID', `${field} contains unsupported fields: ${unknown.join(', ')}.`, { field, unknown });
  }
  const hasSchema = Object.prototype.hasOwnProperty.call(input, 'schema');
  const hasSchemaId = Object.prototype.hasOwnProperty.call(input, 'schemaId');
  if (hasSchema === hasSchemaId) {
    throw new PulseProjectError('PULSE_TEST_EVENT_INVALID', `${field} requires exactly one of schema or schemaId.`, { field });
  }
  try {
    return eventContracts.normalizeEventFrame({
      version: eventContracts.EVENT_FRAME_VERSION,
      type: input.type,
      schemaId: hasSchema ? input.schema : input.schemaId,
      ...(Object.prototype.hasOwnProperty.call(input, 'payload') ? { payload: input.payload } : {})
    });
  } catch (error) {
    throw new PulseProjectError('PULSE_TEST_EVENT_INVALID', `${field} is not a canonical bounded event frame: ${error.message}`, {
      field,
      eventCode: error.code,
      eventDetail: error.detail
    });
  }
}

function normalizeExpectation(input = {}, kind = 'http') {
  if (typeof input === 'string') {
    if (kind === 'http') return Object.freeze({ error: Object.freeze({ name: input }) });
    input = { error: input };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PulseProjectError('PULSE_TEST_EXPECT_INVALID', 'Test expect must be an object or error name string.');
  const error = input.error
    ? Object.freeze(typeof input.error === 'string' ? { name: input.error } : { ...input.error })
    : undefined;
  if (kind === 'event') {
    if (input.emitted !== undefined && !Array.isArray(input.emitted)) {
      throw new PulseProjectError('PULSE_TEST_EXPECT_INVALID', 'Event test expect.emitted must be an ordered array of event frames.');
    }
    const status = input.status === undefined ? (error ? 'failed' : 'completed') : String(input.status);
    if (!Object.values(eventContracts.EVENT_EXECUTION_STATUS).includes(status)) {
      throw new PulseProjectError('PULSE_TEST_EXPECT_INVALID', 'Event test expect.status must be completed or failed.', { status });
    }
    if (status === eventContracts.EVENT_EXECUTION_STATUS.COMPLETED && error) {
      throw new PulseProjectError('PULSE_TEST_EXPECT_INVALID', 'A completed event expectation cannot include expect.error.');
    }
    return Object.freeze({
      error,
      status,
      emitted: Object.freeze((input.emitted || []).map((event, index) => normalizeHarnessEvent(event, `expect.emitted[${index}]`)))
    });
  }
  return Object.freeze({
    error,
    status: input.status === undefined ? (error ? undefined : 200) : Number(input.status),
    bodyClass: input.bodyClass === undefined ? undefined : String(input.bodyClass),
    json: Object.prototype.hasOwnProperty.call(input, 'json') ? input.json : undefined,
    text: Object.prototype.hasOwnProperty.call(input, 'text') ? String(input.text) : undefined,
    headers: input.headers ? normalizeExpectedHeaders(input.headers) : undefined
  });
}

function normalizeTestCase(input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PulseProjectError('PULSE_TEST_CASE_INVALID', `Test case ${index + 1} must be an object.`);
  const name = String(input.name || `case-${index + 1}`);
  const kind = input.kind === undefined ? 'http' : String(input.kind);
  if (!['http', 'event'].includes(kind)) {
    throw new PulseProjectError('PULSE_TEST_CASE_INVALID', `Test case ${name} kind must be http or event.`, { name, kind });
  }
  if (kind === 'event' && !Object.prototype.hasOwnProperty.call(input, 'event')) {
    throw new PulseProjectError('PULSE_TEST_EVENT_INVALID', `Event test case ${name} requires event.`, { name });
  }
  if (kind === 'http' && Object.prototype.hasOwnProperty.call(input, 'event')) {
    throw new PulseProjectError('PULSE_TEST_EVENT_INVALID', `HTTP test case ${name} cannot contain event; set kind to event.`, { name });
  }
  if (kind === 'event' && Object.prototype.hasOwnProperty.call(input, 'request')) {
    throw new PulseProjectError('PULSE_TEST_EVENT_INVALID', `Event test case ${name} cannot contain an HTTP request.`, { name });
  }
  const maxBodyBytes = input.maxBodyBytes === undefined ? undefined : Number(input.maxBodyBytes);
  const continuationTtlMs = input.continuationTtlMs === undefined ? undefined : Number(input.continuationTtlMs);
  if (!validateConfigValue('harness.maxBodyBytes', maxBodyBytes)) {
    throw new PulseProjectError('PULSE_TEST_BODY_LIMIT_INVALID', `Test case ${name} maxBodyBytes must be a positive safe integer.`, { name, maxBodyBytes });
  }
  if (!validateConfigValue('harness.continuationTtlMs', continuationTtlMs)) {
    throw new PulseProjectError('PULSE_TEST_CONTINUATION_TTL_INVALID', `Test case ${name} continuationTtlMs must be a non-negative safe integer.`, { name, continuationTtlMs });
  }
  return Object.freeze({
    name,
    kind,
    ...(kind === 'event'
      ? { event: normalizeHarnessEvent(input.event, `Test case ${name} event`) }
      : { request: normalizeRequest(input.request) }),
    fetches: Object.freeze({ ...(input.fetches || {}) }),
    config: Object.freeze({ ...(input.config || {}) }),
    secrets: Object.freeze({ ...(input.secrets || {}) }),
    kv: Object.freeze({ ...(input.kv || {}) }),
    grip: Object.freeze({ ...(input.grip || {}) }),
    maxBodyBytes,
    continuationTtlMs,
    expect: normalizeExpectation(input.expect || {}, kind)
  });
}

function resolveConfiguredProvider(value, options = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.kind : value;
  const provider = String(raw || configDefault('provider')).trim();
  try {
    return resolveProviderToolchain(provider, { projectRoot: options.projectRoot });
  } catch (error) {
    throw new PulseProjectError(
      error && error.code || 'PULSE_PROVIDER_UNSUPPORTED',
      error && error.message || `Unsupported Pulse provider "${provider}".`,
      error && error.detail || { provider, official: PROJECT_PROVIDERS }
    );
  }
}

function normalizeProvider(value, options = {}) {
  return resolveConfiguredProvider(value, options).id;
}

function normalizeProviderConfig(value, provider, options = {}) {
  const driver = getProviderDriver(provider, { projectRoot: options.projectRoot });
  if (typeof driver.normalizeConfig !== 'function') {
    throw new PulseProjectError('PULSE_PROVIDER_UNSUPPORTED', `Provider "${provider}" has no configuration normalizer.`, { provider });
  }
  try {
    return driver.normalizeConfig(value);
  } catch (error) {
    throw new PulseProjectError(
      error && error.code || 'PULSE_PROVIDER_CONFIG_INVALID',
      error && error.message || `Provider "${provider}" configuration is invalid.`,
      error && error.detail || { provider }
    );
  }
}

function normalizeSchemaConfig(value, projectRoot) {
  if (value === undefined) {
    return Object.freeze({
      active: false,
      defaultNamespace: 'app',
      contentTypePolicy: configDefault('schemas.contentTypePolicy'),
      maxBytes: configDefault('schemas.maxBytes'),
      entries: Object.freeze([])
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PulseProjectError('PULSE_SCHEMA_CONFIG_INVALID', 'Pulse schema policy must be configured as an object.', { valueType: Array.isArray(value) ? 'array' : typeof value });
  }
  if (Object.prototype.hasOwnProperty.call(value, 'json') || Object.prototype.hasOwnProperty.call(value, 'defaultNamespace')) {
    throw new PulseProjectError(
      'PULSE_SCHEMA_JSON_DECLARATIONS_RETIRED',
      'schemas.json and schemas.defaultNamespace are retired. Point pulse.schema at a default-exported defineSchemaRegistry(...) module.',
      {
        retiredKeys: Object.freeze(['schemas.json', 'schemas.defaultNamespace']),
        canonicalEntrypoint: 'pulse.schema'
      }
    );
  }
  const unsupported = Object.keys(value).filter((key) => !['contentTypePolicy', 'maxBytes'].includes(key)).sort();
  if (unsupported.length > 0) {
    throw new PulseProjectError('PULSE_SCHEMA_POLICY_KEY_UNSUPPORTED', `Unsupported schema policy key(s): ${unsupported.join(', ')}.`, {
      keys: unsupported,
      allowed: Object.freeze(['contentTypePolicy', 'maxBytes'])
    });
  }
  const defaultNamespace = 'app';
  const contentTypePolicy = String(value.contentTypePolicy || configDefault('schemas.contentTypePolicy'));
  if (!validateConfigValue('schemas.contentTypePolicy', contentTypePolicy)) {
    throw new PulseProjectError('PULSE_SCHEMA_CONTENT_TYPE_POLICY_INVALID', 'Pulse schema contentTypePolicy must be "accept-json-or-missing" or "require-json".', { contentTypePolicy });
  }
  const maxBytes = Number(value.maxBytes === undefined ? configDefault('schemas.maxBytes') : value.maxBytes);
  if (!validateConfigValue('schemas.maxBytes', maxBytes)) {
    throw new PulseProjectError('PULSE_SCHEMA_BODY_LIMIT_INVALID', 'Pulse schema maxBytes must be a positive safe integer.', { maxBytes });
  }
  return Object.freeze({
    active: false,
    defaultNamespace,
    contentTypePolicy,
    maxBytes,
    entries: Object.freeze([])
  });
}

function normalizeProject(raw, options = {}) {
  if (
    raw
    && raw.schemas
    && typeof raw.schemas === 'object'
    && !Array.isArray(raw.schemas)
    && (
      Object.prototype.hasOwnProperty.call(raw.schemas, 'json')
      || Object.prototype.hasOwnProperty.call(raw.schemas, 'defaultNamespace')
    )
  ) {
    throw new PulseProjectError(
      'PULSE_SCHEMA_JSON_DECLARATIONS_RETIRED',
      'schemas.json and schemas.defaultNamespace are retired. Point pulse.schema at a default-exported defineSchemaRegistry(...) module.',
      {
        retiredKeys: Object.freeze(['schemas.json', 'schemas.defaultNamespace']),
        canonicalEntrypoint: 'pulse.schema'
      }
    );
  }
  const configIssues = validateProjectConfigStructure(raw);
  if (configIssues.length > 0) {
    throw new PulseProjectError('PULSE_CONFIG_LOAD_FAILED', 'Pulse config does not match the supported project configuration schema.', {
      validation: configIssues
    });
  }
  const configFile = options.configFile && path.resolve(options.configFile);
  const projectRoot = path.resolve(options.projectRoot || (configFile ? path.dirname(configFile) : options.cwd || process.cwd()));
  const entryValue = raw.entry || configDefault('entry');
  const entryFile = path.resolve(projectRoot, entryValue);
  const configuredProvider = raw.provider || configDefault('provider');
  const providerResolution = resolveConfiguredProvider(configuredProvider, { projectRoot });
  const provider = providerResolution.id;
  const providerSelector = providerResolution.selector;
  const driver = providerResolution.driver;
  const providerConfig = (() => {
    if (typeof driver.normalizeConfig !== 'function') {
      throw new PulseProjectError('PULSE_PROVIDER_UNSUPPORTED', `Provider "${provider}" has no configuration normalizer.`, { provider });
    }
    try {
      return driver.normalizeConfig(configuredProvider);
    } catch (error) {
      throw new PulseProjectError(
        error && error.code || 'PULSE_PROVIDER_CONFIG_INVALID',
        error && error.message || `Provider "${provider}" configuration is invalid.`,
        error && error.detail || { provider }
      );
    }
  })();
  const outDir = path.resolve(projectRoot, options.outDir || raw.outDir || configDefault('outDir'));
  const devInput = raw.dev && typeof raw.dev === 'object' ? raw.dev : {};
  const tests = Array.isArray(options.tests) ? options.tests : [];
  const schemas = normalizeSchemaConfig(raw.schemas, projectRoot);
  const crypto = raw.crypto === undefined
    ? null
    : Object.freeze({
        source: 'project',
        declaration: normalizeCryptoConfiguration(raw.crypto, { location: 'crypto' })
      });
  const reporting = reportingDescriptor(raw.reporting === undefined ? configDefault('reporting') : raw.reporting);
  const duplicateTestNames = tests.map((entry) => entry.name).filter((name, index, names) => names.indexOf(name) !== index);
  if (duplicateTestNames.length > 0) {
    throw new PulseProjectError('PULSE_TEST_CASE_DUPLICATE', `Pulse test case names must be unique: ${[...new Set(duplicateTestNames)].join(', ')}`, { names: [...new Set(duplicateTestNames)] });
  }
  const host = String(options.host || devInput.host || configDefault('dev.host')).trim();
  const maxBodyBytes = Number(devInput.maxBodyBytes === undefined ? configDefault('dev.maxBodyBytes') : devInput.maxBodyBytes);
  if (!validateConfigValue('dev.host', host)) throw new PulseProjectError('PULSE_DEV_HOST_INVALID', 'Pulse dev host must not be empty.');
  if (!validateConfigValue('dev.maxBodyBytes', maxBodyBytes)) {
    throw new PulseProjectError('PULSE_DEV_BODY_LIMIT_INVALID', 'Pulse dev maxBodyBytes must be a positive safe integer.', { maxBodyBytes });
  }
  const project = {
    version: PROJECT_CONFIG_VERSION,
    root: projectRoot,
    configFile,
    entryFile,
    provider,
    providerSelector,
    providerToolchain: Object.freeze({
      selector: providerResolution.selector,
      id: providerResolution.id,
      packageName: providerResolution.packageName,
      packageVersion: providerResolution.packageVersion,
      contractVersion: providerResolution.contractVersion,
      entrypoint: providerResolution.entrypoint,
      official: providerResolution.official
    }),
    providerConfig,
    reporting: reporting.name,
    reportingLevel: reporting.level,
    reportingPolicy: reporting,
    crypto,
    schemas,
    outDir,
    dev: Object.freeze({
      host,
      port: Number(options.port !== undefined ? options.port : (devInput.port !== undefined ? devInput.port : configDefault('dev.port'))),
      watch: options.watch === undefined ? (devInput.watch === undefined ? configDefault('dev.watch') : Boolean(devInput.watch)) : Boolean(options.watch),
      maxBodyBytes,
      config: Object.freeze({ ...(devInput.config || {}) }),
      secrets: Object.freeze({ ...(devInput.secrets || {}) }),
      kv: Object.freeze({ ...(devInput.kv || {}) }),
      fetches: Object.freeze({ ...(devInput.fetches || {}) }),
      networkFetch: devInput.networkFetch !== undefined
        ? Boolean(devInput.networkFetch)
        : (providerConfig.local && providerConfig.local.networkFetch !== undefined
            ? providerConfig.local.networkFetch
            : driver.defaultLocalNetworkFetch === true)
    }),
    tests: Object.freeze(tests),
    raw
  };
  return Object.freeze(project);
}


function projectErrorFrom(error, fallbackCode = 'PULSE_CONFIG_LOAD_FAILED') {
  if (error instanceof PulseProjectError) return error;
  if (error instanceof PulseWorkspaceError || (error && error.name === 'PulseModuleLoadError')) {
    return new PulseProjectError(error.code || fallbackCode, error.message, error.detail || error.details || {});
  }
  const code = error && error.code ? String(error.code) : fallbackCode;
  const detail = error && (error.detail || error.details) ? (error.detail || error.details) : {};
  return new PulseProjectError(code, error && error.message ? error.message : String(error), detail);
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function resolveWorkspaceFile(root, pointer, field) {
  if (pointer === null || pointer === undefined) return null;
  const file = path.resolve(root, pointer);
  if (!isInside(root, file)) {
    throw new PulseProjectError('PULSE_PROJECT_POINTER_ESCAPE', `${field} must remain inside the Pulse workspace.`, {
      root,
      pointer,
      file
    });
  }
  return file;
}

function loadProjectHarness(file, projectRoot) {
  if (!file) return Object.freeze([]);
  if (!fileExists(file)) {
    throw new PulseProjectError('PULSE_TEST_HARNESS_NOT_FOUND', `Pulse test harness does not exist: ${file}`, {
      file,
      projectRoot
    });
  }
  let loaded;
  try {
    loaded = loadHarnessModule(file, { workspaceRoot: projectRoot });
  } catch (error) {
    throw projectErrorFrom(error, 'PULSE_TEST_HARNESS_LOAD_FAILED');
  }
  const normalized = loaded.cases.map(normalizeTestCase);
  const duplicates = normalized
    .map((entry) => entry.name)
    .filter((name, index, names) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new PulseProjectError('PULSE_TEST_CASE_DUPLICATE', `Pulse test case names must be unique: ${[...new Set(duplicates)].join(', ')}`, {
      names: [...new Set(duplicates)]
    });
  }
  return Object.freeze(normalized);
}

function conventionalProjectProjection(plan, options = {}) {
  const fragments = plan.fragments || {};
  const dev = plainObject(fragments.dev) ? fragments.dev : {};
  const providerSelector = plan.profile.host;
  let provider = providerSelector;
  const driver = getProviderDriver(providerSelector, { projectRoot: options.projectRoot });
  const configured = plainObject(fragments[driver.id])
    ? fragments[driver.id]
    : (plainObject(fragments.provider) ? fragments.provider : undefined);
  if (configured) provider = { kind: providerSelector, ...configured };
  return {
    entry: plan.pulse.entry,
    provider,
    outDir: typeof fragments.outDir === 'string' ? fragments.outDir : 'dist',
    reporting: plan.profile.reporting,
    schemas: plainObject(fragments.schemas) ? fragments.schemas : undefined,
    dev: {
      host: typeof dev.host === 'string' ? dev.host : '127.0.0.1',
      port: dev.port === undefined ? 8787 : dev.port,
      watch: dev.watch === undefined ? true : Boolean(dev.watch),
      maxBodyBytes: dev.maxBodyBytes,
      networkFetch: dev.networkFetch,
      config: plainObject(dev.config) ? dev.config : {},
      secrets: plainObject(dev.secrets) ? dev.secrets : {},
      kv: plainObject(dev.kv) ? dev.kv : {},
      fetches: plainObject(dev.fetches) ? dev.fetches : {}
    }
  };
}

function loadConventionalProject(workspace, options = {}) {
  const sourceName = relative(workspace.configFile, workspace.root);
  const environmentProfile = options.environmentProfile !== undefined
    ? options.environmentProfile
    : (options.env && Object.prototype.hasOwnProperty.call(options.env, 'PULSE_PROFILE')
      ? options.env.PULSE_PROFILE
      : process.env.PULSE_PROFILE);
  const selection = {
    cliProfile: options.profile,
    environmentProfile
  };
  let compiled;
  let evaluated;
  try {
    compiled = compileProjectConfigFile(workspace.configFile, { source: sourceName, selection });
    const loaded = require('./typescript-module-loader.js').loadTypescriptModule(workspace.configFile, {
      workspaceRoot: workspace.configInsideWorkspace === false ? path.dirname(workspace.configFile) : workspace.root,
      allowedPackages: {
        '@pulse-compute/pulse': Object.freeze({ defineConfig: configRuntime.defineConfig })
      }
    });
    const exported = require('./typescript-module-loader.js').moduleDefault(loaded.exports);
    evaluated = configRuntime.evaluateConfigFactory(exported, {
      source: sourceName,
      cliProfile: selection.cliProfile,
      environmentProfile: selection.environmentProfile
    });
  } catch (error) {
    throw projectErrorFrom(error);
  }
  if (
    compiled.declaration.projectHash !== evaluated.declaration.projectHash
    || compiled.plan.planHash !== evaluated.plan.planHash
  ) {
    throw new PulseProjectError('PULSE_CONFIG_PLAN_PARITY_FAILED', 'Static and runtime Pulse config evaluation produced different canonical plans.', {
      configFile: workspace.configFile,
      staticProjectHash: compiled.declaration.projectHash,
      runtimeProjectHash: evaluated.declaration.projectHash,
      staticPlanHash: compiled.plan.planHash,
      runtimePlanHash: evaluated.plan.planHash
    });
  }

  const plan = compiled.plan;
  const testsFile = resolveWorkspaceFile(workspace.root, plan.pulse.tests, 'pulse.tests');
  const schemaFile = resolveWorkspaceFile(workspace.root, plan.pulse.schema, 'pulse.schema');
  const tests = loadProjectHarness(testsFile, workspace.root);
  const projected = conventionalProjectProjection(plan, { projectRoot: workspace.root });
  const project = normalizeProject(projected, {
    ...options,
    cwd: workspace.root,
    projectRoot: workspace.root,
    configFile: workspace.configFile,
    tests
  });
  let schemaExtraction = null;
  if (schemaFile) {
    try {
      schemaExtraction = extractSchemaRegistry(schemaFile, { projectRoot: workspace.root });
    } catch (error) {
      throw projectErrorFrom(error, 'PULSE_SCHEMA_REGISTRY_EXTRACT_FAILED');
    }
  }
  const schemaPolicy = project.schemas;
  const schemas = schemaExtraction
    ? Object.freeze({
        active: schemaExtraction.registry.schemas.length > 0,
        defaultNamespace: schemaPolicy.defaultNamespace,
        contentTypePolicy: schemaPolicy.contentTypePolicy,
        maxBytes: schemaPolicy.maxBytes,
        entries: Object.freeze([]),
        registry: schemaExtraction.registry,
        codecInputs: schemaExtraction.codecInputs,
        dependencies: schemaExtraction.dependencies
      })
    : Object.freeze({
        ...schemaPolicy,
        registry: null,
        codecInputs: null,
        dependencies: Object.freeze([])
      });

  return Object.freeze({
    ...project,
    schemas,
    workspace,
    target: plan.profile.target,
    reporting: plan.profile.reporting,
    reportingLevel: project.reportingLevel,
    reportingPolicy: project.reportingPolicy,
    strict: plan.pulse.strict,
    profile: plan.profile,
    selectedProfile: plan.profile,
    projectDeclaration: compiled.declaration,
    profilePlan: plan,
    projectHash: compiled.declaration.projectHash,
    planHash: plan.planHash,
    configParity: Object.freeze({
      status: 'matched',
      projectHash: compiled.declaration.projectHash,
      planHash: plan.planHash
    }),
    bindings: plan.bindings,
    fragments: plan.fragments,
    crypto: plan.crypto,
    schemaFile,
    testsFile,
    tests
  });
}

function validateResolvedProject(project) {
  if (!fileExists(project.entryFile)) {
    throw new PulseProjectError('PULSE_ENTRY_NOT_FOUND', `Pulse entry does not exist: ${project.entryFile}`, {
      entry: project.entryFile,
      projectRoot: project.root
    });
  }
  if (!validateConfigValue('dev.port', project.dev.port)) {
    throw new PulseProjectError('PULSE_DEV_PORT_INVALID', 'Pulse dev port must be an integer from 0 to 65535.', {
      port: project.dev.port
    });
  }
  return project;
}

function resolveProject(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  let workspace;
  try {
    workspace = resolveWorkspace({
      cwd,
      directory: options.directory
    });
  } catch (error) {
    throw projectErrorFrom(error, 'PULSE_CONFIG_NOT_FOUND');
  }
  if (!workspace) {
    throw new PulseProjectError('PULSE_CONFIG_NOT_FOUND', `No .pulse/config.ts found from ${options.directory ? path.resolve(cwd, options.directory) : cwd}.`, {
      searched: CONFIG_FILE_NAMES,
      hint: 'Create .pulse/config.ts or run pulse init.'
    });
  }
  return validateResolvedProject(loadConventionalProject(workspace, { ...options, cwd }));
}

function projectJson(project) {
  const schemaRegistry = project.schemas.registry;
  const schemaIds = schemaRegistry
    ? schemaRegistry.schemas.map((entry) => entry.id)
    : project.schemas.entries.map((entry) => entry.id);
  const schemaSources = schemaRegistry
    ? [...new Set(project.schemas.dependencies.map((entry) => relative(entry, project.root)))]
    : [...new Set(project.schemas.entries.map((entry) => relative(entry.sourceFile, project.root)))];
  return Object.freeze({
    version: project.version,
    root: project.root,
    workspace: Object.freeze({
      version: project.workspace.version,
      kind: project.workspace.kind,
      root: project.workspace.root,
      configFile: project.workspace.configFile,
      source: project.workspace.source,
      boundary: project.workspace.boundary,
      configInsideWorkspace: project.workspace.configInsideWorkspace !== false
    }),
    configFile: project.configFile,
    entryFile: project.entryFile,
    target: project.target || 'native',
    strict: project.strict !== false,
    reporting: project.reporting,
    reportingLevel: project.reportingLevel,
    reportingPolicy: project.reportingPolicy,
    selectedProfile: project.selectedProfile ? Object.freeze({ ...project.selectedProfile }) : null,
    projectHash: project.projectHash || null,
    planHash: project.planHash || null,
    configParity: project.configParity,
    bindings: project.bindings || Object.freeze({ config: Object.freeze([]), secret: Object.freeze([]) }),
    fragmentKeys: Object.freeze(Object.keys(project.fragments || {}).sort()),
    crypto: project.crypto || null,
    provider: project.provider,
    providerToolchain: project.providerToolchain,
    providerConfig: getProviderDriver(project.providerSelector || project.provider, {
      projectRoot: project.root
    }).projectConfigDocument(project.providerConfig),
    schemas: Object.freeze({
      active: project.schemas.active,
      pointer: project.schemaFile ? relative(project.schemaFile, project.root) : null,
      defaultNamespace: project.schemas.defaultNamespace,
      contentTypePolicy: project.schemas.contentTypePolicy,
      maxBytes: project.schemas.maxBytes,
      count: schemaIds.length,
      ids: Object.freeze(schemaIds),
      sources: Object.freeze(schemaSources),
      authority: schemaRegistry ? 'pulse.schema' : null,
      registryVersion: schemaRegistry ? schemaRegistry.version : null,
      registryHash: schemaRegistry ? schemaRegistry.registryHash : null,
      responseCases: schemaRegistry ? Object.freeze(schemaRegistry.responses.map((entry) => entry.id)) : Object.freeze([]),
      codecRealization: schemaRegistry ? 'cross-target-codecs' : 'inactive'
    }),
    outDir: project.outDir,
    dev: Object.freeze({
      host: project.dev.host,
      port: project.dev.port,
      watch: project.dev.watch,
      maxBodyBytes: project.dev.maxBodyBytes,
      networkFetch: project.dev.networkFetch,
      configuredValues: Object.freeze({
        config: Object.keys(project.dev.config).length,
        secrets: Object.keys(project.dev.secrets).length,
        kv: Object.keys(project.dev.kv).length,
        fetches: Object.keys(project.dev.fetches).length
      })
    }),
    testHarness: project.testsFile ? relative(project.testsFile, project.root) : null,
    tests: project.tests.map((entry) => entry.name)
  });
}

module.exports = {
  PROJECT_CONFIG_VERSION,
  PROJECT_CONFIG_SCHEMA_VERSION,
  CONFIG_FILE_NAMES,
  PROJECT_PROVIDERS,
  PulseProjectError,
  loadConventionalProject,
  normalizeProject,
  resolveProject,
  projectJson,
  normalizeHeaders,
  normalizeExpectedHeaders,
  normalizeRequest,
  normalizeExpectation,
  normalizeTestCase,
  normalizeProvider,
  normalizeProviderConfig,
  normalizeSchemaConfig,
  loadProjectHarness,
  relative,
  slash,
  projectConfigSchemaDocument
};
