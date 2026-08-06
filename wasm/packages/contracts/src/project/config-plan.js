'use strict';

const path = require('node:path');
const { stableStringify, sha256Hex } = require('../stable-id.js');
const {
  DEFAULT_REPORTING_LEVEL,
  normalizeReportingLevel,
  resolveReportingLevel
} = require('../logging.js');
const {
  CONFIG_FACTORY_CONTRACT_VERSION,
  CONFIG_SCOPE_CONTRACT_VERSION,
  CONFIG_FACTORY_BRAND,
  CONFIG_FACTORY_METADATA,
  isConfigFactory
} = require('./config-factory.js');
const {
  normalizeCryptoConfiguration,
  emptyCryptoConfiguration
} = require('../crypto/contracts.js');

const PROJECT_DECLARATION_VERSION = 'pulse.project-declaration.v2';
const PROFILE_PLAN_VERSION = 'pulse.profile-plan.v2';

const PROFILE_SELECTION_SOURCES = Object.freeze(['cli', 'environment', 'default']);
const EXECUTION_TARGETS = Object.freeze(['native', 'javascript']);
const PULSE_RESERVED_KEYS = Object.freeze(['entry', 'schema', 'tests', 'defaultProfile', 'strict', 'reporting', 'crypto']);
const PROFILE_CORE_KEYS = Object.freeze(['host', 'target', 'reporting', 'crypto']);
const DEFAULT_PROJECT_POINTERS = Object.freeze({
  entry: 'src/index.ts',
  schema: null,
  tests: null
});

function contractError(code, message, details = {}) {
  const error = new TypeError(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }
  return value;
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw contractError('PULSE_PROJECT_PLAN_STRING_REQUIRED', `${field} must be a non-empty string.`, { field, value });
  }
  return value.trim();
}

function normalizeWorkspacePointer(value, field, options = {}) {
  if (value === undefined || value === null || value === '') {
    if (options.required) throw contractError('PULSE_PROJECT_POINTER_REQUIRED', `${field} is required.`, { field });
    return null;
  }
  const raw = nonEmptyString(value, field).replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) {
    throw contractError('PULSE_PROJECT_POINTER_ABSOLUTE', `${field} must be workspace-relative.`, { field, value: raw });
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw contractError('PULSE_PROJECT_POINTER_ESCAPE', `${field} must remain inside the Pulse workspace.`, { field, value: raw });
  }
  if (normalized === '.' || normalized.length === 0) {
    throw contractError('PULSE_PROJECT_POINTER_INVALID', `${field} must name a workspace-relative file or directory.`, { field, value: raw });
  }
  return normalized;
}

function symbolicKind(value) {
  if (!isPlainObject(value)) return null;
  const hasConfig = Object.prototype.hasOwnProperty.call(value, '$config');
  const hasSecret = Object.prototype.hasOwnProperty.call(value, '$secret');
  if (hasConfig && hasSecret) return 'mixed';
  if (hasConfig) return 'config';
  if (hasSecret) return 'secret';
  return null;
}

function normalizeSymbolicRef(value, location) {
  const kind = symbolicKind(value);
  if (!kind) return null;
  if (kind === 'mixed') {
    throw contractError('PULSE_CONFIG_SCOPE_REF_MIXED', `${location} cannot be both a config and secret reference.`, { location });
  }
  const allowedKey = kind === 'config' ? '$config' : '$secret';
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== allowedKey) {
    throw contractError('PULSE_CONFIG_SCOPE_REF_SHAPE', `${location} must contain exactly one ${allowedKey} property.`, { location, keys });
  }
  const name = nonEmptyString(value[allowedKey], `${location}.${allowedKey}`);
  return Object.freeze({ [allowedKey]: name });
}

function normalizeStaticValue(value, location, refs) {
  const symbolic = normalizeSymbolicRef(value, location);
  if (symbolic) {
    const kind = symbolicKind(symbolic);
    const name = symbolic[kind === 'config' ? '$config' : '$secret'];
    refs.push(Object.freeze({ kind, name, path: location }));
    return symbolic;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw contractError('PULSE_PROJECT_PLAN_NUMBER_INVALID', `${location} must be a finite number.`, { location, value });
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => normalizeStaticValue(entry, `${location}[${index}]`, refs)));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined) {
        throw contractError('PULSE_PROJECT_PLAN_UNDEFINED', `${location}.${key} cannot be undefined.`, { location: `${location}.${key}` });
      }
      out[key] = normalizeStaticValue(child, `${location}.${key}`, refs);
    }
    return deepFreeze(out);
  }
  throw contractError('PULSE_PROJECT_PLAN_VALUE_UNSUPPORTED', `${location} contains a non-static value.`, {
    location,
    type: typeof value
  });
}

function assertNoMixedBindingNames(refs) {
  const kindsByName = new Map();
  for (const ref of refs) {
    const kinds = kindsByName.get(ref.name) || new Set();
    kinds.add(ref.kind);
    kindsByName.set(ref.name, kinds);
  }
  for (const [name, kinds] of kindsByName) {
    if (kinds.size > 1) {
      throw contractError('PULSE_CONFIG_SCOPE_NAME_CLASS_CONFLICT', `Logical binding ${name} cannot be both config and secret in one project.`, {
        name,
        kinds: Array.from(kinds).sort()
      });
    }
  }
}

function bindingsForRefs(refs) {
  return deepFreeze({
    config: Array.from(new Set(refs.filter((ref) => ref.kind === 'config').map((ref) => ref.name))).sort(),
    secret: Array.from(new Set(refs.filter((ref) => ref.kind === 'secret').map((ref) => ref.name))).sort()
  });
}

function normalizePulseObject(value = {}) {
  if (!isPlainObject(value)) throw contractError('PULSE_PROJECT_PULSE_OBJECT_REQUIRED', 'The reserved pulse key must contain a plain object.');
  for (const key of Object.keys(value)) {
    if (!PULSE_RESERVED_KEYS.includes(key)) {
      throw contractError('PULSE_PROJECT_PULSE_KEY_UNSUPPORTED', `Unsupported reserved pulse key: ${key}`, { key });
    }
  }
  const strict = value.strict === undefined ? true : value.strict;
  if (typeof strict !== 'boolean') throw contractError('PULSE_PROJECT_STRICT_BOOLEAN_REQUIRED', 'pulse.strict must be a boolean.', { value: strict });
  const defaultProfile = value.defaultProfile === undefined || value.defaultProfile === null
    ? null
    : nonEmptyString(value.defaultProfile, 'pulse.defaultProfile');
  const reporting = normalizeReportingLevel(value.reporting ?? DEFAULT_REPORTING_LEVEL, 'pulse.reporting');
  const crypto = Object.prototype.hasOwnProperty.call(value, 'crypto')
    ? normalizeCryptoConfiguration(value.crypto, { location: 'pulse.crypto' })
    : null;
  return deepFreeze({
    entry: normalizeWorkspacePointer(value.entry ?? DEFAULT_PROJECT_POINTERS.entry, 'pulse.entry', { required: true }),
    schema: normalizeWorkspacePointer(value.schema ?? DEFAULT_PROJECT_POINTERS.schema, 'pulse.schema'),
    tests: normalizeWorkspacePointer(value.tests ?? DEFAULT_PROJECT_POINTERS.tests, 'pulse.tests'),
    defaultProfile,
    strict,
    reporting,
    crypto
  });
}

function normalizeProfile(name, value, allRefs) {
  const profileName = nonEmptyString(name, 'profile name');
  if (profileName === 'pulse') throw contractError('PULSE_PROJECT_PROFILE_RESERVED', 'pulse is reserved and cannot be a profile name.');
  if (!isPlainObject(value)) throw contractError('PULSE_PROJECT_PROFILE_OBJECT_REQUIRED', `Profile ${profileName} must be a plain object.`, { profile: profileName });
  const host = nonEmptyString(value.host, `${profileName}.host`);
  const target = nonEmptyString(value.target, `${profileName}.target`);
  if (!EXECUTION_TARGETS.includes(target)) {
    throw contractError('PULSE_PROJECT_TARGET_UNSUPPORTED', `Profile ${profileName} target must be native or javascript.`, { profile: profileName, target });
  }
  const reporting = value.reporting === undefined || value.reporting === null
    ? null
    : normalizeReportingLevel(value.reporting, `${profileName}.reporting`);
  const crypto = Object.prototype.hasOwnProperty.call(value, 'crypto')
    ? normalizeCryptoConfiguration(value.crypto, { location: `${profileName}.crypto` })
    : null;
  const profileRefs = [];
  const fragments = {};
  for (const key of Object.keys(value).sort()) {
    if (PROFILE_CORE_KEYS.includes(key)) continue;
    fragments[key] = normalizeStaticValue(value[key], `${profileName}.${key}`, profileRefs);
  }
  allRefs.push(...profileRefs);
  return deepFreeze({
    name: profileName,
    host,
    target,
    reporting,
    crypto,
    fragments,
    bindings: bindingsForRefs(profileRefs)
  });
}

function withStableHash(value, field = 'hash', hashValue = value) {
  const copy = { ...value };
  copy[field] = sha256Hex(stableStringify(hashValue));
  return deepFreeze(copy);
}

function normalizeProjectDeclaration(input, options = {}) {
  if (!isPlainObject(input)) throw contractError('PULSE_PROJECT_DECLARATION_OBJECT_REQUIRED', 'Pulse config factory must return a plain object.');
  const pulse = normalizePulseObject(input.pulse || {});
  const profileNames = Object.keys(input).filter((key) => key !== 'pulse').sort();
  if (profileNames.length === 0) throw contractError('PULSE_PROJECT_PROFILE_REQUIRED', 'Pulse project config must declare at least one profile.');

  const refs = [];
  const profiles = {};
  for (const name of profileNames) profiles[name] = normalizeProfile(name, input[name], refs);
  assertNoMixedBindingNames(refs);
  if (pulse.defaultProfile !== null && !Object.prototype.hasOwnProperty.call(profiles, pulse.defaultProfile)) {
    throw contractError('PULSE_PROJECT_DEFAULT_PROFILE_UNKNOWN', `pulse.defaultProfile references unknown profile ${pulse.defaultProfile}.`, {
      defaultProfile: pulse.defaultProfile,
      profiles: profileNames
    });
  }

  const semantic = {
    version: PROJECT_DECLARATION_VERSION,
    configFactoryVersion: CONFIG_FACTORY_CONTRACT_VERSION,
    configScopeVersion: CONFIG_SCOPE_CONTRACT_VERSION,
    pulse,
    profiles,
    bindings: bindingsForRefs(refs)
  };
  return withStableHash({
    ...semantic,
    source: options.source ? String(options.source) : null
  }, 'projectHash', semantic);
}

function resolveProfileSelection(input = {}) {
  const cliProfile = input.cliProfile === undefined || input.cliProfile === null || input.cliProfile === ''
    ? null
    : nonEmptyString(input.cliProfile, 'cli profile');
  const environmentProfile = input.environmentProfile === undefined || input.environmentProfile === null || input.environmentProfile === ''
    ? null
    : nonEmptyString(input.environmentProfile, 'environment profile');
  const defaultProfile = input.defaultProfile === undefined || input.defaultProfile === null || input.defaultProfile === ''
    ? null
    : nonEmptyString(input.defaultProfile, 'default profile');

  if (cliProfile) return Object.freeze({ name: cliProfile, source: 'cli' });
  if (environmentProfile) return Object.freeze({ name: environmentProfile, source: 'environment' });
  if (defaultProfile) return Object.freeze({ name: defaultProfile, source: 'default' });
  throw contractError('PULSE_PROFILE_SELECTION_REQUIRED', 'Select a profile with --profile, PULSE_PROFILE, or pulse.defaultProfile.');
}

function selectedProfileRefs(profile) {
  const refs = [];
  normalizeStaticValue(profile.fragments, profile.name, refs);
  return refs;
}

function selectProfilePlan(projectDeclaration, selectionInput = {}) {
  const declaration = projectDeclaration && projectDeclaration.version === PROJECT_DECLARATION_VERSION
    ? projectDeclaration
    : normalizeProjectDeclaration(projectDeclaration);
  const selection = selectionInput.name && PROFILE_SELECTION_SOURCES.includes(selectionInput.source)
    ? Object.freeze({ name: nonEmptyString(selectionInput.name, 'selected profile'), source: selectionInput.source })
    : resolveProfileSelection({
      cliProfile: selectionInput.cliProfile,
      environmentProfile: selectionInput.environmentProfile,
      defaultProfile: declaration.pulse.defaultProfile
    });
  const profile = declaration.profiles[selection.name];
  if (!profile) {
    throw contractError('PULSE_PROFILE_UNKNOWN', `Unknown Pulse profile ${selection.name}.`, {
      profile: selection.name,
      profiles: Object.keys(declaration.profiles)
    });
  }
  const refs = selectedProfileRefs(profile);
  assertNoMixedBindingNames(refs);
  const reporting = resolveReportingLevel(profile.reporting, declaration.pulse.reporting);
  const crypto = profile.crypto !== null
    ? deepFreeze({ source: 'profile', declaration: profile.crypto })
    : (declaration.pulse.crypto !== null
        ? deepFreeze({ source: 'pulse', declaration: declaration.pulse.crypto })
        : deepFreeze({ source: 'implicit', declaration: emptyCryptoConfiguration() }));
  return withStableHash({
    version: PROFILE_PLAN_VERSION,
    projectVersion: declaration.version,
    projectHash: declaration.projectHash,
    pulse: declaration.pulse,
    profile: {
      name: profile.name,
      source: selection.source,
      host: profile.host,
      target: profile.target,
      reporting
    },
    crypto,
    fragments: profile.fragments,
    bindings: bindingsForRefs(refs)
  }, 'planHash');
}

function symbolicRef(kind, name) {
  const logicalName = nonEmptyString(name, `scope.${kind}`);
  return Object.freeze({ [kind === 'config' ? '$config' : '$secret']: logicalName });
}

function createConfigScope() {
  return Object.freeze({
    version: CONFIG_SCOPE_CONTRACT_VERSION,
    config(name) { return symbolicRef('config', name); },
    secret(name) { return symbolicRef('secret', name); }
  });
}

function invokeConfigFactory(factory, options = {}) {
  if (!isConfigFactory(factory)) {
    throw contractError('PULSE_CONFIG_FACTORY_REQUIRED', 'Pulse config must export defineConfig((scope) => ({ ... })).');
  }
  const declaration = factory(createConfigScope());
  if (declaration && typeof declaration.then === 'function') {
    throw contractError('PULSE_CONFIG_FACTORY_ASYNC_UNSUPPORTED', 'Pulse config factories must be synchronous.');
  }
  return normalizeProjectDeclaration(declaration, options);
}

function defaultProjectPlanContract() {
  return deepFreeze({
    projectDeclarationVersion: PROJECT_DECLARATION_VERSION,
    profilePlanVersion: PROFILE_PLAN_VERSION,
    configFactoryVersion: CONFIG_FACTORY_CONTRACT_VERSION,
    configScopeVersion: CONFIG_SCOPE_CONTRACT_VERSION,
    profileSelectionPrecedence: PROFILE_SELECTION_SOURCES,
    targets: EXECUTION_TARGETS,
    pulseReservedKeys: PULSE_RESERVED_KEYS,
    profileCoreKeys: PROFILE_CORE_KEYS,
    defaults: {
      pointers: DEFAULT_PROJECT_POINTERS,
      strict: true
    },
    policies: {
      workspaceRelativePointers: true,
      implicitLocalProfile: false,
      implicitFirstProfile: false,
      nodeEnvProfileInference: false,
      commandProfileInference: false,
      selectedProfilePassedToFactory: false,
      resolvedSecretValuesAllowed: false,
      secretLiteralFallbackAllowed: false,
      sameNameConfigAndSecretAllowed: false,
      genericDeepMerge: false,
      cryptoProfileReplacement: true,
      cryptoRuntimeDetection: false,
      cryptoAutomaticFallback: false
    }
  });
}

module.exports = {
  PROJECT_DECLARATION_VERSION,
  PROFILE_PLAN_VERSION,
  CONFIG_FACTORY_CONTRACT_VERSION,
  CONFIG_SCOPE_CONTRACT_VERSION,
  CONFIG_FACTORY_BRAND,
  CONFIG_FACTORY_METADATA,
  PROFILE_SELECTION_SOURCES,
  EXECUTION_TARGETS,
  PULSE_RESERVED_KEYS,
  PROFILE_CORE_KEYS,
  DEFAULT_PROJECT_POINTERS,
  createConfigScope,
  isConfigFactory,
  invokeConfigFactory,
  isPlainObject,
  normalizeWorkspacePointer,
  normalizeProjectDeclaration,
  resolveProfileSelection,
  selectProfilePlan,
  defaultProjectPlanContract
};
