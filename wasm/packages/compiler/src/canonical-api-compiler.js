'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { executeCanonicalSourceSpine } = require('./spine/canonical-source.js');
const {
  extractFetchChain,
  extractProviderCall,
  extractKvNamespaceDeclaration
} = require('./spine/handler-surface-authority.js');
const {
  payloadForCanonicalHandlerIr
} = require('./spine/canonical-handler-ir.js');
const {
  emitCanonicalHandlerGenerator
} = require('./spine/handler-ir-emitter.js');
const {
  SUPPORTED_FETCH_DECODERS,
  ALLOWED_IMPORTS,
  CanonicalCompileError
} = require('./spine/plain-handler-frontend.js');

function loadCanonicalRuntimeContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-runtime'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../contracts/src/handler/canonical-runtime.js');
    throw error;
  }
}

const canonicalRuntimeContract = loadCanonicalRuntimeContract();

const CANONICAL_API_COMPILER_VERSION = 'pulse.canonical-api-compiler.v7';

function findSourceRoot(start) {
  let current = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

function stableSourceName(file, options = {}) {
  if (options.fileName) return String(options.fileName).replace(/\\/g, '/');
  const absolute = path.resolve(file);
  const root = path.resolve(options.rootDir || findSourceRoot(path.dirname(absolute)));
  const relative = path.relative(root, absolute).replace(/\\/g, '/');
  return relative && !relative.startsWith('../') ? relative : path.basename(absolute);
}

function emitCanonicalProgramFromHandlerIr(ir) {
  const payload = payloadForCanonicalHandlerIr(ir);
  const emitted = emitCanonicalHandlerGenerator(payload.operationIr);
  const sourceFile = payload.sourceFile;
  const schemaBundle = payload.schemaBundle;
  const explicitParallelCount = ir.continuationSites.filter((site) => site.kind === 'parallel-group').length;
  const metadata = Object.freeze({
    version: ir.programVersion,
    compilerVersion: ir.compilerVersion,
    runtimeProtocolVersion: ir.runtimeProtocolVersion,
    file: ir.file,
    sourceHash: ir.sourceHash,
    loweredSourceHash: ir.loweredSourceHash,
    projectSourceHash: ir.projectSourceHash,
    handler: 'default',
    ctxParameter: ir.handler.ctxParameter,
    capabilities: ir.capabilities,
    providerOperations: ir.providerOperations,
    effectSites: ir.effectSites,
    continuationSites: ir.continuationSites,
    effectCount: ir.effectSites.length,
    continuationCount: ir.continuationSites.length,
    groupedContinuationCount: ir.continuationSites.filter((site) => site.kind === 'fetch-group' || site.kind === 'parallel-group').length,
    ...(explicitParallelCount > 0 ? { explicitParallelCount } : {}),
    opaqueReturnCount: ir.continuationSites.filter((site) => site.kind === 'opaque-fetch-return').length,
    schemaRegistry: ir.schema.registry,
    schemaIds: ir.schema.ids,
    responseCaseIds: ir.schema.responseCaseIds,
    schemaSourceHash: ir.schema.sourceHash,
    schemaRegistryHash: ir.schema.registryHash,
    schemaCodecTableHash: ir.schema.codecTableHash,
    schemaFullCodecRealization: ir.schema.fullCodecRealization,
    schemaReferences: ir.schemaReferences,
    schemaReferenceCount: ir.schemaReferences.length,
    packageEffects: ir.packageEffects,
    packageEffectCount: ir.packageEffects.length,
    ...(ir.json ? { json: ir.json } : {}),
    ...(ir.warnings ? { warnings: ir.warnings, warningCount: ir.warnings.length } : {}),
    authoring: ir.authoring,
    ...(ir.application ? { application: ir.application } : {}),
    ...(ir.applicationEntries ? { applicationEntries: ir.applicationEntries } : {}),
    ...(ir.events ? { events: ir.events } : {}),
    router: ir.router,
    compilerOwnedCalls: ir.compilerOwnedCalls,
    compilerOwnedIntrinsics: ir.compilerOwnedIntrinsics,
    compilerPreludeHash: ir.compilerPreludeHash,
    userAuthoredAsync: ir.invariants.userAuthoredAsync,
    promiseSemantics: ir.invariants.promiseSemantics,
    asyncify: ir.invariants.asyncify
  });

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const generatorText = printer.printNode(ts.EmitHint.Unspecified, emitted.generator, sourceFile);
  const metadataSource = JSON.stringify(metadata, null, 2);
  const generatedTypeScript = [
    schemaBundle.declarationSource,
    payload.compilerPrelude,
    generatorText,
    `const __pulse_metadata = ${metadataSource};`,
    'module.exports = Object.freeze({',
    `  version: ${JSON.stringify(canonicalRuntimeContract.CANONICAL_PROGRAM_VERSION)},`,
    '  metadata: Object.freeze(__pulse_metadata),',
    '  schemaCodecs: __pulse_schema_codecs,',
    '  createHandler() { return __pulse_handler; }',
    '});',
    ''
  ].join('\n');
  const transpiled = ts.transpileModule(generatedTypeScript, {
    fileName: `${ir.file}.generated.ts`,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      removeComments: false,
      esModuleInterop: false
    },
    reportDiagnostics: true
  });
  const generatedSource = transpiled.outputText;
  const generatedEsmTypeScript = [
    schemaBundle.declarationSource,
    payload.compilerPrelude,
    generatorText,
    `export const version = ${JSON.stringify(canonicalRuntimeContract.CANONICAL_PROGRAM_VERSION)};`,
    `export const metadata = Object.freeze(${metadataSource});`,
    'export const schemaCodecs = __pulse_schema_codecs;',
    'export function createHandler() { return __pulse_handler; }',
    ''
  ].join('\n');
  const esmTranspiled = ts.transpileModule(generatedEsmTypeScript, {
    fileName: `${ir.file}.generated.mts`,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      strict: true,
      removeComments: false
    },
    reportDiagnostics: true
  });
  const generatedEsmSource = esmTranspiled.outputText;

  return Object.freeze({
    ok: true,
    version: CANONICAL_API_COMPILER_VERSION,
    metadata,
    schemaBundle,
    generatedSource,
    generatedEsmSource,
    diagnostics: Object.freeze([])
  });
}

const PLAIN_HANDLER_IMPLEMENTATION = Object.freeze({
  compilerVersion: CANONICAL_API_COMPILER_VERSION,
  programVersion: canonicalRuntimeContract.CANONICAL_PROGRAM_VERSION,
  runtimeProtocolVersion: canonicalRuntimeContract.CANONICAL_RUNTIME_PROTOCOL_VERSION,
  emitCanonicalProgram: emitCanonicalProgramFromHandlerIr
});

function compileCanonicalSource(sourceText, options = {}) {
  return executeCanonicalSourceSpine(sourceText, options, PLAIN_HANDLER_IMPLEMENTATION);
}

function compileCanonicalFile(file, options = {}) {
  const absolute = path.resolve(file);
  return compileCanonicalSource(fs.readFileSync(absolute, 'utf8'), { ...options, fileName: stableSourceName(absolute, options) });
}

function loadCanonicalModule(compiled, options = {}) {
  if (!compiled || compiled.ok !== true || typeof compiled.generatedSource !== 'string') throw new TypeError('loadCanonicalModule requires a successful canonical compilation.');
  const filename = options.fileName || `${compiled.metadata.file}.generated.cjs`;
  const module = { exports: {} };
  const script = new vm.Script(`(function(module, exports, require, __filename, __dirname) {\n${compiled.generatedSource}\n})`, { filename });
  const fn = script.runInThisContext();
  fn(module, module.exports, require, filename, path.dirname(filename));
  return module.exports;
}

function writeCanonicalBuild(compiled, outDir, options = {}) {
  const target = path.resolve(outDir);
  fs.mkdirSync(target, { recursive: true });
  const handlerFile = path.join(target, options.handlerFile || 'canonical-handler.cjs');
  const programFile = path.join(target, options.programFile || 'canonical-program.json');
  const esmHandlerFile = options.esmHandlerFile ? path.join(target, options.esmHandlerFile) : undefined;
  const schemaActive = Boolean(compiled.schemaBundle && compiled.schemaBundle.active);
  const schemaRegistryFile = schemaActive ? path.join(target, options.schemaRegistryFile || 'schema-json-registry.json') : undefined;
  const schemaCodecsFile = schemaActive ? path.join(target, options.schemaCodecsFile || 'schema-json-codecs.cjs') : undefined;
  fs.writeFileSync(handlerFile, compiled.generatedSource);
  if (esmHandlerFile) fs.writeFileSync(esmHandlerFile, compiled.generatedEsmSource);
  if (schemaRegistryFile) fs.writeFileSync(schemaRegistryFile, `${JSON.stringify(compiled.schemaBundle.registry, null, 2)}\n`);
  if (schemaCodecsFile) fs.writeFileSync(schemaCodecsFile, compiled.schemaBundle.moduleSource);
  const packageInspectionArtifacts = Object.freeze((compiled.packageInspection && compiled.packageInspection.artifacts || []).map((artifact) => {
    const relativeFile = String(artifact.file || '').replace(/\\/g, '/');
    const artifactFile = path.resolve(target, relativeFile);
    const relativeArtifact = path.relative(target, artifactFile);
    if (!relativeFile || relativeArtifact.startsWith('..') || path.isAbsolute(relativeArtifact)) {
      const error = new Error(`Package inspection artifact ${artifact.id || '<unknown>'} must remain inside the canonical build output.`);
      error.code = 'PULSE_PACKAGE_INSPECTION_ARTIFACT_UNSAFE';
      error.detail = Object.freeze({ id: artifact.id, file: relativeFile });
      throw error;
    }
    fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
    fs.writeFileSync(artifactFile, `${JSON.stringify(artifact.data, null, 2)}\n`);
    return Object.freeze({ id: artifact.id, contractId: artifact.contractId, file: artifactFile });
  }));
  fs.writeFileSync(programFile, `${JSON.stringify({
    ...compiled.metadata,
    generatedHandler: path.basename(handlerFile),
    generatedEsmHandler: esmHandlerFile ? path.basename(esmHandlerFile) : undefined,
    generatedSchemaRegistry: schemaRegistryFile ? path.basename(schemaRegistryFile) : undefined,
    generatedSchemaCodecs: schemaCodecsFile ? path.basename(schemaCodecsFile) : undefined
  }, null, 2)}\n`);
  return Object.freeze({ outDir: target, handlerFile, esmHandlerFile, programFile, schemaRegistryFile, schemaCodecsFile, packageInspectionArtifacts, metadata: compiled.metadata });
}

module.exports = {
  CANONICAL_API_COMPILER_VERSION,
  CANONICAL_PROGRAM_VERSION: canonicalRuntimeContract.CANONICAL_PROGRAM_VERSION,
  CANONICAL_RUNTIME_PROTOCOL_VERSION: canonicalRuntimeContract.CANONICAL_RUNTIME_PROTOCOL_VERSION,
  SUPPORTED_FETCH_DECODERS,
  ALLOWED_IMPORTS,
  CanonicalCompileError,
  compileCanonicalSource,
  compileCanonicalFile,
  loadCanonicalModule,
  writeCanonicalBuild,
  extractFetchChain,
  extractProviderCall,
  extractKvNamespaceDeclaration,
  stableSourceName
};
