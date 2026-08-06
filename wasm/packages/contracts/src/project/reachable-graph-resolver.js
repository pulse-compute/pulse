'use strict';

const path = require('node:path');
const { stableStringify, sha256Hex } = require('../stable-id.js');

const MODULE_RESOLVER_CONTRACT_VERSION = 'pulse.module-resolver.v1';
const MODULE_RESOLVER_INPUT_VERSION = 'pulse.module-resolver-input.v1';
const RESOLUTION_KINDS = Object.freeze([
  'project-relative',
  'tsconfig-path',
  'package-root',
  'package-subpath',
  'generated',
  'external'
]);
const PROJECT_SOURCE_EXTENSIONS = Object.freeze([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json'
]);
const TYPE_DECLARATION_EXTENSIONS = Object.freeze(['.d.ts', '.d.mts', '.d.cts']);
const RUNTIME_PACKAGE_CONDITIONS = Object.freeze(['pulse', 'import', 'default']);
const TYPE_PACKAGE_CONDITIONS = Object.freeze(['types', 'pulse', 'import', 'default']);
const PACKAGE_ROOT_FIELDS = Object.freeze(['module', 'main']);
const TYPE_ROOT_FIELDS = Object.freeze(['types', 'typings']);
const CANDIDATE_STEPS = Object.freeze([
  'exact',
  'typescript-extension-substitution',
  'extension-append',
  'directory-package-entry',
  'directory-index'
]);
const TYPESCRIPT_EXTENSION_SUBSTITUTIONS = Object.freeze({
  '.js': Object.freeze(['.ts', '.tsx', '.js']),
  '.jsx': Object.freeze(['.tsx', '.jsx']),
  '.mjs': Object.freeze(['.mts', '.mjs']),
  '.cjs': Object.freeze(['.cts', '.cjs'])
});
const EXTERNAL_SCHEMES = Object.freeze(['node:', 'http:', 'https:', 'data:']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertKnownKeys(input, allowed, field) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`${field} contains unsupported field ${key}.`);
  }
}

function assertString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string.`);
  if (value.includes('\0')) throw new TypeError(`${field} must not contain NUL.`);
  return value.trim();
}

function assertSha256(value, field, options = {}) {
  if (value == null && options.nullable === true) return null;
  const text = assertString(value, field);
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`${field} must be a lowercase SHA-256 hex string.`);
  return text;
}

function normalizePortablePath(value, field, options = {}) {
  const text = assertString(value, field).replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(text) || text.startsWith('/') || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) {
    throw new TypeError(`${field} must be a portable workspace-relative path.`);
  }
  const normalized = path.posix.normalize(text);
  if (normalized === '..' || normalized.startsWith('../')) throw new TypeError(`${field} must not escape the workspace.`);
  if (normalized === '.') {
    if (options.allowDot === true) return '.';
    throw new TypeError(`${field} must identify a file or non-root path.`);
  }
  const withoutPrefix = normalized.startsWith('./') ? normalized.slice(2) : normalized;
  if (!withoutPrefix || withoutPrefix.endsWith('/')) throw new TypeError(`${field} must be a normalized portable path.`);
  return withoutPrefix;
}

function normalizeDirectoryPath(value, field) {
  if (value == null || value === '' || value === '.') return '.';
  return normalizePortablePath(value, field, { allowDot: true });
}

function normalizeModuleSpecifier(value, field = 'specifier') {
  const specifier = assertString(value, field).replace(/\\/g, '/');
  if (specifier.startsWith('/') || /^[a-zA-Z]:\//.test(specifier)) {
    throw new TypeError(`${field} must not be an absolute filesystem path.`);
  }
  return specifier;
}

function wildcardCount(value) {
  return (String(value).match(/\*/g) || []).length;
}

function normalizePathAlias(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`pathAliases[${index}] must be an object.`);
  assertKnownKeys(input, new Set(['pattern', 'targets', 'wildcard', 'prefix', 'suffix']), `pathAliases[${index}]`);
  const pattern = assertString(input.pattern, `pathAliases[${index}].pattern`).replace(/\\/g, '/');
  if (pattern.startsWith('.') || pattern.startsWith('/') || /^[a-zA-Z]:\//.test(pattern)) {
    throw new TypeError(`pathAliases[${index}].pattern must be a bare alias pattern.`);
  }
  const stars = wildcardCount(pattern);
  if (stars > 1) throw new TypeError(`pathAliases[${index}].pattern may contain at most one wildcard.`);
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new TypeError(`pathAliases[${index}].targets must be a non-empty array.`);
  }
  const targets = [];
  for (let targetIndex = 0; targetIndex < input.targets.length; targetIndex += 1) {
    const raw = assertString(input.targets[targetIndex], `pathAliases[${index}].targets[${targetIndex}]`).replace(/\\/g, '/');
    const targetStars = wildcardCount(raw);
    if (targetStars > 1) throw new TypeError(`pathAliases[${index}].targets[${targetIndex}] may contain at most one wildcard.`);
    if ((stars === 1) !== (targetStars === 1)) {
      throw new TypeError(`pathAliases[${index}] wildcard usage must match between pattern and targets.`);
    }
    targets.push(normalizePortablePath(raw.replace('*', '__PULSE_WILDCARD__'), `pathAliases[${index}].targets[${targetIndex}]`).replace('__PULSE_WILDCARD__', '*'));
  }
  const prefix = stars === 1 ? pattern.slice(0, pattern.indexOf('*')) : pattern;
  const suffix = stars === 1 ? pattern.slice(pattern.indexOf('*') + 1) : '';
  return Object.freeze({
    pattern,
    wildcard: stars === 1,
    prefix,
    suffix,
    targets: Object.freeze(Array.from(new Set(targets)))
  });
}

function compareAliases(a, b) {
  if (a.wildcard !== b.wildcard) return a.wildcard ? 1 : -1;
  if (a.prefix.length !== b.prefix.length) return b.prefix.length - a.prefix.length;
  if (a.suffix.length !== b.suffix.length) return b.suffix.length - a.suffix.length;
  return a.pattern.localeCompare(b.pattern);
}

function defaultModuleResolverContract() {
  return Object.freeze({
    version: MODULE_RESOLVER_CONTRACT_VERSION,
    inputVersion: MODULE_RESOLVER_INPUT_VERSION,
    resolutionKinds: RESOLUTION_KINDS,
    projectSourceExtensions: PROJECT_SOURCE_EXTENSIONS,
    typeDeclarationExtensions: TYPE_DECLARATION_EXTENSIONS,
    runtimePackageConditions: RUNTIME_PACKAGE_CONDITIONS,
    typePackageConditions: TYPE_PACKAGE_CONDITIONS,
    packageRootFields: PACKAGE_ROOT_FIELDS,
    typeRootFields: TYPE_ROOT_FIELDS,
    candidateSteps: CANDIDATE_STEPS,
    typescriptExtensionSubstitutions: TYPESCRIPT_EXTENSION_SUBSTITUTIONS,
    policies: Object.freeze({
      staticEsmOnly: true,
      exactSpecifierFirst: true,
      deterministicCandidateOrder: true,
      ambiguousSuccessfulCandidatesAreErrors: true,
      packageExportsAreAuthoritativeWhenPresent: true,
      unexportedDeepImportsAllowedWhenExportsPresent: false,
      typeOnlyEdgesDoNotCreateRuntimeReachability: true,
      tsconfigPathPatterns: 'exact-or-single-wildcard',
      tsconfigPathPatternPrecedence: 'exact-then-longest-prefix-and-suffix',
      supportedTsconfigResolutionInputs: Object.freeze(['baseUrl', 'paths']),
      deferredTsconfigResolutionInputs: Object.freeze(['extends', 'rootDirs', 'moduleSuffixes', 'customConditions', 'plugins']),
      symlinkPolicy: 'resolve-for-containment-preserve-logical-identity',
      pathIdentity: 'workspace-relative-posix',
      casePolicy: 'case-sensitive-manifest-reject-case-fold-collisions',
      hostPlatformAffectsIdentity: false,
      dynamicImportImplemented: false,
      arbitraryRequireImplemented: false,
      loaderHooksImplemented: false,
      packageManagerPluginsImplemented: false
    })
  });
}

function normalizeModuleResolverInput(input = {}) {
  if (!isPlainObject(input)) throw new TypeError('Resolver input must be an object.');
  assertKnownKeys(input, new Set(['version', 'resolverVersion', 'resolverHash', 'baseUrl', 'pathAliases', 'configFile', 'configContentHash']), 'Resolver input');
  const aliases = Object.freeze([...(input.pathAliases || [])].map(normalizePathAlias).sort(compareAliases));
  const patterns = new Set();
  for (const alias of aliases) {
    if (patterns.has(alias.pattern)) throw new TypeError(`Duplicate tsconfig path alias pattern ${alias.pattern}.`);
    patterns.add(alias.pattern);
  }
  const semantic = Object.freeze({
    version: MODULE_RESOLVER_INPUT_VERSION,
    resolverVersion: MODULE_RESOLVER_CONTRACT_VERSION,
    baseUrl: normalizeDirectoryPath(input.baseUrl, 'baseUrl'),
    pathAliases: aliases,
    configFile: input.configFile == null ? null : normalizePortablePath(input.configFile, 'configFile'),
    configContentHash: assertSha256(input.configContentHash, 'configContentHash', { nullable: true })
  });
  return Object.freeze({ ...semantic, resolverHash: sha256Hex(stableStringify(semantic)) });
}

function matchPathAlias(specifierInput, resolverInput) {
  const specifier = normalizeModuleSpecifier(specifierInput);
  const resolver = normalizeModuleResolverInput(resolverInput || {});
  for (const alias of resolver.pathAliases) {
    if (!alias.wildcard) {
      if (specifier !== alias.pattern) continue;
      return Object.freeze({ alias, capture: null });
    }
    if (!specifier.startsWith(alias.prefix) || !specifier.endsWith(alias.suffix)) continue;
    const capture = specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length);
    return Object.freeze({ alias, capture });
  }
  return null;
}

function parsePackageSpecifier(specifierInput) {
  const specifier = normalizeModuleSpecifier(specifierInput);
  if (specifier.startsWith('.') || EXTERNAL_SCHEMES.some((scheme) => specifier.startsWith(scheme))) return null;
  const segments = specifier.split('/');
  const scoped = specifier.startsWith('@');
  const packageName = scoped ? segments.slice(0, 2).join('/') : segments[0];
  const rest = scoped ? segments.slice(2) : segments.slice(1);
  if (!packageName || (scoped && segments.length < 2)) throw new TypeError(`Invalid package specifier ${specifier}.`);
  return Object.freeze({
    packageName,
    packageSubpath: rest.length === 0 ? '.' : `./${rest.join('/')}`,
    kind: rest.length === 0 ? 'package-root' : 'package-subpath'
  });
}

function classifyModuleSpecifier(specifierInput, resolverInput = {}) {
  const specifier = normalizeModuleSpecifier(specifierInput);
  if (EXTERNAL_SCHEMES.some((scheme) => specifier.startsWith(scheme))) return Object.freeze({ kind: 'external', specifier });
  if (specifier.startsWith('./') || specifier.startsWith('../')) return Object.freeze({ kind: 'project-relative', specifier });
  const aliasMatch = matchPathAlias(specifier, resolverInput);
  if (aliasMatch) return Object.freeze({ kind: 'tsconfig-path', specifier, alias: aliasMatch.alias.pattern, capture: aliasMatch.capture });
  const parsed = parsePackageSpecifier(specifier);
  if (!parsed) throw new TypeError(`Unsupported module specifier ${specifier}.`);
  return Object.freeze({ ...parsed, specifier });
}

function extensionCandidates(portableBase) {
  const extension = path.posix.extname(portableBase);
  const candidates = [portableBase];
  const substitutions = TYPESCRIPT_EXTENSION_SUBSTITUTIONS[extension];
  if (substitutions) {
    const stem = portableBase.slice(0, -extension.length);
    for (const replacement of substitutions) candidates.push(`${stem}${replacement}`);
  } else if (!extension) {
    for (const suffix of PROJECT_SOURCE_EXTENSIONS) candidates.push(`${portableBase}${suffix}`);
    for (const suffix of PROJECT_SOURCE_EXTENSIONS) candidates.push(path.posix.join(portableBase, `index${suffix}`));
  }
  return Object.freeze(Array.from(new Set(candidates)));
}

function projectResolutionCandidates(importerPathInput, specifierInput, resolverInput = {}) {
  const importerPath = normalizePortablePath(importerPathInput, 'importerPath');
  const specifier = normalizeModuleSpecifier(specifierInput);
  const resolver = normalizeModuleResolverInput(resolverInput || {});
  const classification = classifyModuleSpecifier(specifier, resolver);
  let bases = [];
  if (classification.kind === 'project-relative') {
    const base = path.posix.join(path.posix.dirname(importerPath), specifier);
    bases = [normalizePortablePath(base, 'relative resolution candidate')];
  } else if (classification.kind === 'tsconfig-path') {
    const match = matchPathAlias(specifier, resolver);
    bases = match.alias.targets.map((target) => {
      const replaced = match.capture == null ? target : target.replace('*', match.capture);
      const joined = resolver.baseUrl === '.' ? replaced : path.posix.join(resolver.baseUrl, replaced);
      return normalizePortablePath(joined, 'tsconfig path resolution candidate');
    });
  } else {
    return Object.freeze([]);
  }
  const candidates = [];
  for (const base of bases) candidates.push(...extensionCandidates(base));
  return Object.freeze(Array.from(new Set(candidates)));
}

module.exports = Object.freeze({
  MODULE_RESOLVER_CONTRACT_VERSION,
  MODULE_RESOLVER_INPUT_VERSION,
  RESOLUTION_KINDS,
  PROJECT_SOURCE_EXTENSIONS,
  TYPE_DECLARATION_EXTENSIONS,
  RUNTIME_PACKAGE_CONDITIONS,
  TYPE_PACKAGE_CONDITIONS,
  PACKAGE_ROOT_FIELDS,
  TYPE_ROOT_FIELDS,
  CANDIDATE_STEPS,
  TYPESCRIPT_EXTENSION_SUBSTITUTIONS,
  EXTERNAL_SCHEMES,
  normalizePortablePath,
  normalizeDirectoryPath,
  normalizeModuleSpecifier,
  normalizeModuleResolverInput,
  defaultModuleResolverContract,
  matchPathAlias,
  parsePackageSpecifier,
  classifyModuleSpecifier,
  projectResolutionCandidates
});
