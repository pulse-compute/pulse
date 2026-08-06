'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const PORTABLE_EQUIVALENCE_VERSION = 'pulse.compiler-equivalence-portable.v1';
const PORTABLE_PROJECT_ROOT = '$PROJECT_ROOT';
const PORTABLE_PROJECT_SOURCE_HASH = '$PROJECT_SOURCE_HASH';
const PORTABLE_PLAN_HASH = '$PLAN_HASH';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = stableObject(value[key]);
  }
  return out;
}

function stableJson(value) {
  const encoded = JSON.stringify(stableObject(value));
  return encoded === undefined ? 'undefined' : encoded;
}

function hashJson(value) {
  return sha256(stableJson(value));
}

function compiledProjectFingerprint(compiled) {
  const router = compiled.router ? {
    version: compiled.router.version,
    authoringVersion: compiled.router.authoringVersion,
    fileName: compiled.router.fileName,
    rootRouter: compiled.router.rootRouter,
    sourceText: compiled.router.sourceText,
    compilerPrelude: compiled.router.compilerPrelude,
    compilerOwnedCalls: compiled.router.compilerOwnedCalls,
    routePlan: compiled.router.routePlan,
    handlerTable: compiled.router.handlerTable,
    routerTree: compiled.router.routerTree,
    executionPlan: compiled.router.executionPlan,
    metadata: compiled.router.metadata,
    diagnostics: compiled.router.diagnostics
  } : null;
  const schema = {
    active: compiled.schema.active,
    bundle: compiled.schema.bundle,
    diagnostics: compiled.schema.diagnostics,
    warnings: compiled.schema.warnings,
    compiledSchemas: compiled.schema.compiledSchemas,
    compilerVersion: compiled.schema.compilerVersion,
    summary: compiled.schema.summary
  };
  const packageExtensions = {
    active: compiled.packageExtensions.active,
    allowedRuntimeImports: compiled.packageExtensions.allowedRuntimeImports,
    effects: compiled.packageExtensions.effects,
    plans: compiled.packageExtensions.plans,
    diagnostics: compiled.packageExtensions.diagnostics
  };
  return Object.freeze({
    version: compiled.version,
    projectCompilerVersion: compiled.projectCompilerVersion,
    metadataSha256: hashJson(compiled.metadata),
    schemaBundleSha256: hashJson(compiled.schemaBundle),
    generatedSourceSha256: sha256(compiled.generatedSource),
    generatedEsmSourceSha256: sha256(compiled.generatedEsmSource),
    diagnosticsSha256: hashJson(compiled.diagnostics),
    routerSha256: hashJson(router),
    schemaSha256: hashJson(schema),
    packageExtensionsSha256: hashJson(packageExtensions),
    summary: Object.freeze({
      authoringKind: compiled.metadata.authoring && compiled.metadata.authoring.kind || 'plain-handler',
      effectCount: compiled.metadata.effectCount,
      continuationCount: compiled.metadata.continuationCount,
      schemaReferenceCount: compiled.metadata.schemaReferenceCount,
      packageEffectCount: compiled.metadata.packageEffectCount,
      routeCount: compiled.metadata.router && compiled.metadata.router.routes ? compiled.metadata.router.routes.length : 0,
      routerEntryCount: compiled.metadata.router && compiled.metadata.router.entries ? compiled.metadata.router.entries.length : 0
    })
  });
}

function normalizePortablePath(value, projectRoot) {
  if (typeof value !== 'string' || !projectRoot || !path.isAbsolute(value)) return value;
  const root = path.resolve(projectRoot);
  const candidate = path.resolve(value);
  const relative = path.relative(root, candidate);
  if (relative === '') return PORTABLE_PROJECT_ROOT;
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return value;
  return `${PORTABLE_PROJECT_ROOT}/${relative.split(path.sep).join('/')}`;
}

function normalizePortableValue(value, options = {}, key = '') {
  if (Array.isArray(value)) return value.map((entry) => normalizePortableValue(entry, options));
  if (!value || typeof value !== 'object') {
    if (key === 'projectSourceHash') return PORTABLE_PROJECT_SOURCE_HASH;
    if (key === 'planHash') return PORTABLE_PLAN_HASH;
    return normalizePortablePath(value, options.projectRoot);
  }
  const out = {};
  for (const property of Object.keys(value)) {
    if (value[property] === undefined) continue;
    out[property] = normalizePortableValue(value[property], options, property);
  }
  return out;
}

function normalizeGeneratedSource(value, options = {}) {
  let source = String(value).replace(
    /("projectSourceHash"\s*:\s*")[0-9a-f]{64}("\s*[,}])/g,
    `$1${PORTABLE_PROJECT_SOURCE_HASH}$2`
  );
  if (options.projectRoot) {
    const root = path.resolve(options.projectRoot);
    for (const candidate of new Set([root, root.split(path.sep).join('/')])) {
      if (candidate) source = source.split(candidate).join(PORTABLE_PROJECT_ROOT);
    }
  }
  return source;
}

function portableCompiledProjectFingerprint(compiled, options = {}) {
  const router = compiled.router ? {
    version: compiled.router.version,
    authoringVersion: compiled.router.authoringVersion,
    fileName: compiled.router.fileName,
    rootRouter: compiled.router.rootRouter,
    sourceText: compiled.router.sourceText,
    compilerPrelude: compiled.router.compilerPrelude,
    compilerOwnedCalls: compiled.router.compilerOwnedCalls,
    routePlan: compiled.router.routePlan,
    handlerTable: compiled.router.handlerTable,
    routerTree: compiled.router.routerTree,
    executionPlan: compiled.router.executionPlan,
    metadata: compiled.router.metadata,
    diagnostics: compiled.router.diagnostics
  } : null;
  const schema = {
    active: compiled.schema.active,
    bundle: compiled.schema.bundle,
    diagnostics: compiled.schema.diagnostics,
    warnings: compiled.schema.warnings,
    compiledSchemas: compiled.schema.compiledSchemas,
    compilerVersion: compiled.schema.compilerVersion,
    summary: compiled.schema.summary
  };
  const packageExtensions = {
    active: compiled.packageExtensions.active,
    allowedRuntimeImports: compiled.packageExtensions.allowedRuntimeImports,
    effects: compiled.packageExtensions.effects,
    plans: compiled.packageExtensions.plans,
    diagnostics: compiled.packageExtensions.diagnostics
  };
  return Object.freeze({
    normalizationVersion: PORTABLE_EQUIVALENCE_VERSION,
    version: compiled.version,
    projectCompilerVersion: compiled.projectCompilerVersion,
    metadataSha256: hashJson(normalizePortableValue(compiled.metadata, options)),
    schemaBundleSha256: hashJson(normalizePortableValue(compiled.schemaBundle, options)),
    generatedSourceSha256: sha256(normalizeGeneratedSource(compiled.generatedSource, options)),
    generatedEsmSourceSha256: sha256(normalizeGeneratedSource(compiled.generatedEsmSource, options)),
    diagnosticsSha256: hashJson(normalizePortableValue(compiled.diagnostics, options)),
    routerSha256: hashJson(normalizePortableValue(router, options)),
    schemaSha256: hashJson(normalizePortableValue(schema, options)),
    packageExtensionsSha256: hashJson(normalizePortableValue(packageExtensions, options)),
    summary: Object.freeze({
      authoringKind: compiled.metadata.authoring && compiled.metadata.authoring.kind || 'plain-handler',
      effectCount: compiled.metadata.effectCount,
      continuationCount: compiled.metadata.continuationCount,
      schemaReferenceCount: compiled.metadata.schemaReferenceCount,
      packageEffectCount: compiled.metadata.packageEffectCount,
      routeCount: compiled.metadata.router && compiled.metadata.router.routes ? compiled.metadata.router.routes.length : 0,
      routerEntryCount: compiled.metadata.router && compiled.metadata.router.entries ? compiled.metadata.router.entries.length : 0
    })
  });
}

function nativePlanFingerprint(plan, stringify) {
  const json = stringify(plan);
  return Object.freeze({
    version: plan.version,
    compilerVersion: plan.compilerVersion,
    planHash: plan.planHash,
    stableJsonSha256: sha256(json),
    summarySha256: hashJson(plan.summary),
    effectsSha256: hashJson(plan.effects),
    continuationsSha256: hashJson(plan.continuations),
    routingSha256: hashJson(plan.routing)
  });
}

function portableNativePlanFingerprint(plan, options = {}) {
  const normalized = normalizePortableValue(plan, options);
  return Object.freeze({
    normalizationVersion: PORTABLE_EQUIVALENCE_VERSION,
    version: plan.version,
    compilerVersion: plan.compilerVersion,
    stableJsonSha256: hashJson(normalized),
    sourceSha256: hashJson(normalized.source),
    entrySha256: hashJson(normalized.entry),
    summarySha256: hashJson(normalized.summary),
    effectsSha256: hashJson(normalized.effects),
    continuationsSha256: hashJson(normalized.continuations),
    routingSha256: hashJson(normalized.routing),
    packagesSha256: hashJson(normalized.packages)
  });
}

function nativeModuleFingerprint(compiled, options = {}) {
  const omittedManifestKeys = new Set(options.omitManifestKeys || []);
  const manifest = omittedManifestKeys.size === 0
    ? compiled.manifest
    : Object.fromEntries(
        Object.entries(compiled.manifest).filter(([key]) => !omittedManifestKeys.has(key))
      );
  return Object.freeze({
    version: compiled.version,
    compilerVersion: compiled.compilerVersion,
    sourceHash: compiled.sourceHash,
    sourceSha256: sha256(compiled.source),
    wasmSha256: sha256(compiled.wasm),
    watSha256: sha256(compiled.wat),
    inspectionSha256: hashJson(compiled.inspection),
    manifestSha256: hashJson(manifest)
  });
}

function compilationErrorFingerprint(error) {
  return Object.freeze({
    name: error && error.name,
    code: error && error.code,
    diagnosticsSha256: hashJson(error && error.diagnostics || []),
    diagnostics: Object.freeze((error && error.diagnostics || []).map((diagnostic) => Object.freeze({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      file: diagnostic.file,
      position: diagnostic.position,
      detail: diagnostic.detail
    })))
  });
}

module.exports = Object.freeze({
  PORTABLE_EQUIVALENCE_VERSION,
  sha256,
  stableObject,
  stableJson,
  hashJson,
  compiledProjectFingerprint,
  portableCompiledProjectFingerprint,
  nativePlanFingerprint,
  portableNativePlanFingerprint,
  nativeModuleFingerprint,
  compilationErrorFingerprint
});
