'use strict';

const ts = require('typescript');
const {
  isIdentifierNamed,
  extractFetchChain,
  recognizeManagedHandlerWrapper,
  recognizeHandlerSurface,
  sourceModelForCanonicalRecognition
} = require('./handler-surface-authority.js');
const { normalizeManagedHandler } = require('./async-surface-normalizer.js');
const {
  positionFor,
  createCanonicalDiagnostic,
  createHandlerDiagnostic
} = require('./diagnostic-authority.js');

function loadCanonicalSchemaCodecTools() {
  try { return require('@pulse-compute/wasm-schema-json/compiler/canonical-schema-codecs'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../schema-json/src/compiler/canonical-schema-codecs.js');
    throw error;
  }
}

const canonicalSchemaCodecTools = loadCanonicalSchemaCodecTools();

const PLAIN_HANDLER_FRONTEND_VERSION = 'pulse.plain-handler-frontend.v1';
const SUPPORTED_FETCH_DECODERS = Object.freeze(['json', 'text']);
const ALLOWED_IMPORTS = Object.freeze(['@pulse-compute/runtime']);

class CanonicalCompileError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'CanonicalCompileError';
    this.code = 'PULSE_CANONICAL_COMPILE_FAILED';
    this.diagnostics = diagnostics;
  }
}

function staticResource(node) {
  if (!node) return Object.freeze({ kind: 'none' });
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const value = node.text;
    let origin;
    try { origin = new URL(value).origin; } catch (_) { origin = undefined; }
    return Object.freeze({ kind: 'literal', value, origin });
  }
  return Object.freeze({ kind: 'dynamic' });
}

function diagnostic(sourceFile, node, code, message, detail = {}) {
  return createCanonicalDiagnostic({
    frontend: 'canonical-source',
    sourceFile,
    node,
    code,
    message,
    detail
  });
}




function literalStringValue(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function propertyNameValue(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return String(node.text);
  return undefined;
}

function objectLiteralPropertyValue(node, propertyName) {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || propertyNameValue(property.name) !== propertyName) continue;
    return Object.freeze({ property, value: property.initializer });
  }
  return undefined;
}

function isTypeOnlyImportDeclaration(statement) {
  if (!statement || !ts.isImportDeclaration(statement)) return false;
  const clause = statement.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return true;
  return Boolean(!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
    && clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((element) => element.isTypeOnly));
}

function effectiveSchemaBundle(input) {
  if (input && input.registry && typeof input.declarationSource === 'string') return input;
  return canonicalSchemaCodecTools.buildCanonicalSchemaBundle([]);
}

function analyzeHandler(sourceFile, handler, ctxName, diagnostics, schemaBundleInput, options = {}) {
  const schemaBundle = effectiveSchemaBundle(schemaBundleInput);
  const realizedSchemaIds = new Set((schemaBundle.registry.schemas || []).map((schema) => String(schema.id)));
  const schemaIds = new Set(
    Array.isArray(schemaBundle.declaredSchemaIds)
      ? schemaBundle.declaredSchemaIds.map(String)
      : realizedSchemaIds
  );
  const responseCases = new Map((schemaBundle.registry.responses || []).map((entry) => [String(entry.id), entry]));
  const strictJson = options.strict !== false && schemaIds.size > 0;
  const schemaReferences = [];
  const capabilities = new Set();
  const providerOperations = [];
  const fetchAliases = new Set();
  let operationIndex = 0;
  let fetchCount = 0;
  let genericJsonCount = 0;
  let schemaBoundJsonCount = 0;
  const forbiddenCalls = new Set(['require', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'eval', 'Function']);
  const forbiddenRoots = new Set(['process', 'global', 'globalThis', 'Deno', 'Bun', 'Buffer', 'console', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'Worker']);

  for (const effect of options.packageEffects || []) {
    if (effect && effect.capability) capabilities.add(String(effect.capability));
  }

  function reject(node, code, message, detail = {}) {
    diagnostics.push(diagnostic(sourceFile, node, code, message, detail));
  }

  function recordProviderOperation(node, kind, operation, capability, resourceNode) {
    operationIndex += 1;
    providerOperations.push(Object.freeze({
      id: `${kind}-${operationIndex}`,
      kind,
      operation,
      capability,
      resource: staticResource(resourceNode),
      position: positionFor(sourceFile, node)
    }));
  }

  function rootIdentifier(expression) {
    let current = expression;
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = current.expression;
    return ts.isIdentifier(current) ? current.text : undefined;
  }

  function collectFetchAliases(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const chain = extractFetchChain(node.initializer, ctxName);
      if (chain) fetchAliases.add(node.name.text);
    }
    ts.forEachChild(node, collectFetchAliases);
  }
  collectFetchAliases(handler.body || handler);

  function recordKnownSchemaReference(call, schemaId, usage, detail = {}) {
    if (!schemaIds.has(schemaId)) {
      reject(detail.node || call, 'PULSE_CANONICAL_SCHEMA_MISSING', `Schema ${JSON.stringify(schemaId)} is not declared by pulse.schema.`, { usage, schemaId, declared: [...schemaIds].sort() });
      return;
    }
    if (!realizedSchemaIds.has(schemaId)) {
      reject(
        detail.node || call,
        'PULSE_SCHEMA_CODEC_REALIZATION_PENDING',
        `Schema ${JSON.stringify(schemaId)} is registered, but its codec shape is not realized on both targets.`,
        {
          usage,
          schemaId,
          registryVersion: schemaBundle.registryIrVersion,
          fullCodecRealization: false,
          automaticFallback: false
        }
      );
      return;
    }
    const encode = usage === 'response-encode' || usage === 'fetch-encode' || usage === 'value-encode';
    schemaReferences.push(Object.freeze({
      id: schemaId,
      usage,
      capability: encode ? 'schema.encode' : 'schema.decode',
      ...(detail.responseCaseId ? { responseCaseId: detail.responseCaseId } : {}),
      position: positionFor(sourceFile, call)
    }));
    capabilities.add(encode ? 'schema.encode' : 'schema.decode');
  }

  function recordSchemaReference(call, argument, usage) {
    const schemaId = literalStringValue(argument);
    if (schemaId === undefined) {
      reject(argument || call, 'PULSE_CANONICAL_SCHEMA_ID_LITERAL_REQUIRED', 'Schema IDs must be string literals so the project compiler can link codecs before provider lowering.', { usage });
      return;
    }
    recordKnownSchemaReference(call, schemaId, usage, { node: argument });
  }

  function validateDecoderCall(call, usage) {
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return;
    const method = call.expression.name.text;
    if (method === 'text' && call.arguments.length > 0) {
      reject(call, 'PULSE_CANONICAL_DECODER_ARGUMENTS_UNSUPPORTED', 'text() does not accept a schema ID or other decoder arguments.', { usage, method, arguments: call.arguments.length });
      return;
    }
    if (method !== 'json') return;
    if (call.arguments.length > 1) {
      reject(call, 'PULSE_CANONICAL_DECODER_ARGUMENTS_UNSUPPORTED', 'json() accepts zero arguments for generic JSON or one declared schema ID.', { usage, method, arguments: call.arguments.length });
      return;
    }
    if (call.arguments.length === 1) {
      recordSchemaReference(call, call.arguments[0], usage);
      schemaBoundJsonCount += 1;
    } else {
      genericJsonCount += 1;
      if (strictJson) {
        reject(call, 'PULSE_SCHEMA_REQUIRED', `Schema-less ${usage === 'request-decode' ? 'request' : 'fetched-response'} JSON requires pulse.strict to be false.`, {
          usage,
          strict: true
        });
      }
    }
  }

  function validateResponseSchema(call) {
    if (call.arguments.length > 2) {
      reject(call, 'PULSE_RESPONSE_DESCRIPTOR_INVALID', 'ctx.json accepts a value and at most one response descriptor or response-case ID.', {
        arguments: call.arguments.length
      });
      return;
    }
    const descriptor = call.arguments[1];
    if (!descriptor) {
      if (strictJson) reject(call, 'PULSE_SCHEMA_REQUIRED', 'Strict Pulse JSON responses require a schema descriptor or registered response-case ID.', { usage: 'response-encode', strict: true });
      return;
    }
    const responseCaseId = literalStringValue(descriptor);
    if (responseCaseId !== undefined) {
      const responseCase = responseCases.get(responseCaseId);
      if (!responseCase) {
        reject(descriptor, 'PULSE_RESPONSE_CASE_MISSING', `Response case ${JSON.stringify(responseCaseId)} is not declared by pulse.schema.`, {
          responseCaseId,
          declared: [...responseCases.keys()].sort()
        });
        return;
      }
      recordKnownSchemaReference(call, String(responseCase.schemaId), 'response-encode', {
        node: descriptor,
        responseCaseId
      });
      return;
    }
    if (!ts.isObjectLiteralExpression(descriptor)) {
      reject(descriptor, 'PULSE_RESPONSE_DESCRIPTOR_LITERAL_REQUIRED', 'ctx.json response metadata must be an object literal or a registered response-case string literal.', {
        usage: 'response-encode'
      });
      return;
    }
    const schemaProperty = objectLiteralPropertyValue(descriptor, 'schema');
    if (schemaProperty) {
      recordSchemaReference(call, schemaProperty.value, 'response-encode');
      return;
    }
    if (strictJson) reject(descriptor, 'PULSE_SCHEMA_REQUIRED', 'Strict Pulse JSON responses require a schema property or registered response-case ID.', { usage: 'response-encode', strict: true });
  }

  function validateFetchSchema(call) {
    const init = call.arguments[1];
    if (!init || !ts.isObjectLiteralExpression(init)) return;
    const jsonProperty = objectLiteralPropertyValue(init, 'json');
    const schemaProperty = objectLiteralPropertyValue(init, 'schema');
    if (schemaProperty && !jsonProperty) {
      reject(schemaProperty.property, 'PULSE_FETCH_SCHEMA_WITHOUT_JSON', 'Pulse fetch schema is only valid together with the semantic json field.', {
        usage: 'fetch-encode'
      });
      return;
    }
    if (!jsonProperty) return;
    if (schemaProperty) {
      recordSchemaReference(call, schemaProperty.value, 'fetch-encode');
      return;
    }
    if (strictJson) reject(jsonProperty.property, 'PULSE_SCHEMA_REQUIRED', 'Strict outbound fetch JSON requires a registered literal schema ID.', {
      usage: 'fetch-encode',
      strict: true
    });
  }

  function visit(node) {
    if (typeof ts.isTypeNode === 'function' && ts.isTypeNode(node)) return;
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'Promise') diagnostics.push(createHandlerDiagnostic({
        frontend: 'canonical-source',
        issue: 'handler.promise.unsupported',
        sourceFile,
        node,
        values: { construction: true }
      }));
      if (node.expression.text === 'Date' && (!node.arguments || node.arguments.length === 0)) reject(node, 'PULSE_CANONICAL_NONDETERMINISM_UNSUPPORTED', 'Ambient clock access is not available in canonical user scope.');
      if (forbiddenRoots.has(node.expression.text) || node.expression.text === 'Function') reject(node, 'PULSE_CANONICAL_AMBIENT_AUTHORITY_UNSUPPORTED', `Ambient ${node.expression.text} authority is not available in canonical user scope.`, { identifier: node.expression.text });
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const root = rootIdentifier(node);
      if (root && forbiddenRoots.has(root)) reject(node, 'PULSE_CANONICAL_AMBIENT_AUTHORITY_UNSUPPORTED', `Ambient ${root} authority is not available in canonical user scope.`, { identifier: root });
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) reject(node, 'PULSE_CANONICAL_DYNAMIC_IMPORT_UNSUPPORTED', 'Dynamic import is not available in canonical user scope.');
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name === 'fetch') reject(node, 'PULSE_CANONICAL_AMBIENT_FETCH_UNSUPPORTED', 'Use ctx.fetch; ambient global fetch is not available in user scope.');
        if (name === 'Promise') diagnostics.push(createHandlerDiagnostic({
          frontend: 'canonical-source',
          issue: 'handler.promise.unsupported',
          sourceFile,
          node,
          values: { construction: false }
        }));
        if (forbiddenCalls.has(name)) reject(node, 'PULSE_CANONICAL_AMBIENT_AUTHORITY_UNSUPPORTED', `Ambient ${name} is not available in canonical user scope.`, { identifier: name });
      }
      if (ts.isPropertyAccessExpression(node.expression)) {
        const root = rootIdentifier(node.expression);
        if (root && forbiddenRoots.has(root)) reject(node, 'PULSE_CANONICAL_AMBIENT_AUTHORITY_UNSUPPORTED', `Ambient ${root} authority is not available in canonical user scope.`, { identifier: root });
        if (root === 'Date' && node.expression.name.text === 'now') reject(node, 'PULSE_CANONICAL_NONDETERMINISM_UNSUPPORTED', 'Ambient clock access is not available in canonical user scope.');
        if (root === 'Math' && node.expression.name.text === 'random') reject(node, 'PULSE_CANONICAL_NONDETERMINISM_UNSUPPORTED', 'Ambient randomness is not available in canonical user scope.');
        if (root === 'crypto') reject(node, 'PULSE_CANONICAL_AMBIENT_AUTHORITY_UNSUPPORTED', 'Ambient crypto authority is not available in canonical user scope.', { identifier: 'crypto' });

        const target = node.expression;
        const surface = recognizeHandlerSurface(node, { ctxName });
        if (surface) {
          if (surface.surfaceId === 'ctx.fetch.opaque-return' && surface.detail.fetch.fetchCall === node) {
            capabilities.add('fetch');
            fetchCount += 1;
            validateFetchSchema(node);
          } else if (surface.surfaceId === 'ctx.fetch.projected') {
            if (surface.detail.fetch.fetchCall === node) {
              capabilities.add('fetch');
              fetchCount += 1;
              validateFetchSchema(node);
            }
            if (surface.detail.fetch.decoderCall === node) validateDecoderCall(node, 'fetch-decode');
          } else if (surface.surfaceId === 'ctx.encodeJson') {
            if (node.arguments.length !== 2) {
              reject(node, 'PULSE_CANONICAL_DECODER_ARGUMENTS_UNSUPPORTED', 'ctx.encodeJson requires exactly a value and a registered literal schema ID.', { usage: 'value-encode', arguments: node.arguments.length });
            } else {
              recordSchemaReference(node, node.arguments[1], 'value-encode');
              schemaBoundJsonCount += 1;
            }
          } else if (['ctx.json', 'ctx.text', 'ctx.response'].includes(surface.surfaceId)) {
            const method = surface.surfaceId.slice('ctx.'.length);
            capabilities.add(`response.${method}`);
            if (surface.surfaceId === 'ctx.json') validateResponseSchema(node);
          } else if (surface.surfaceId === 'ctx.req.json.schema' || surface.surfaceId === 'ctx.req.json.generic') {
            capabilities.add('request.json');
            validateDecoderCall(node, 'request-decode');
          } else if (surface.surfaceId === 'ctx.req.text') {
            capabilities.add('request.text');
            validateDecoderCall(node, 'request-decode');
          } else if (surface.surfaceId === 'ctx.state.get' || surface.surfaceId === 'ctx.state.set') {
            capabilities.add(surface.surfaceId.slice('ctx.'.length));
          } else if (surface.surfaceId.startsWith('ctx.log.')) {
            capabilities.add('logging');
          } else if (surface.detail.provider) {
            const operation = surface.detail.provider;
            if (operation.providerKind === 'kv') capabilities.add('kv');
            capabilities.add(operation.capability);
            recordProviderOperation(node, operation.providerKind, operation.operation, operation.capability, operation.resource);
          }
        }
        if (isIdentifierNamed(target.expression, ctxName) && target.name.text === 'kv') capabilities.add('kv');
        if (ts.isIdentifier(target.expression) && fetchAliases.has(target.expression.text) && SUPPORTED_FETCH_DECODERS.includes(target.name.text)) validateDecoderCall(node, 'fetch-decode');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(handler.body || handler);
  return Object.freeze({
    capabilities: Object.freeze([...capabilities].sort()),
    providerOperations: Object.freeze(providerOperations),
    fetchCount,
    genericJsonCount,
    schemaBoundJsonCount,
    schemaReferences: Object.freeze(schemaReferences)
  });
}

function findCanonicalHandler(sourceFile, diagnostics, options = {}) {
  const allowedRuntimeImports = new Set([...ALLOWED_IMPORTS, ...(options.allowedRuntimeImports || []).map(String)]);
  if (options.target === 'javascript') {
    // The project graph owns import resolution and containment. These remain
    // source-runtime imports, never lowerer grants.
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) allowedRuntimeImports.add(statement.moduleSpecifier.text);
    }
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleName = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
    const typeOnlyImport = isTypeOnlyImportDeclaration(statement);
    if (!allowedRuntimeImports.has(moduleName) && !typeOnlyImport) diagnostics.push(diagnostic(sourceFile, statement, 'PULSE_CANONICAL_IMPORT_UNSUPPORTED', `Canonical handlers may use type-only imports and runtime imports owned by declared package lowerers; project-relative runtime values must pass through the reachable module graph.`, { moduleName, allowedRuntimeImports: [...allowedRuntimeImports] }));
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) diagnostics.push(diagnostic(sourceFile, statement, 'PULSE_CANONICAL_AMBIENT_STATE_UNSUPPORTED', 'Top-level runtime state is not supported; keep request state inside the handler.'));
    if (ts.isClassDeclaration(statement)) diagnostics.push(diagnostic(sourceFile, statement, 'PULSE_CANONICAL_TOP_LEVEL_CLASS_UNSUPPORTED', 'Top-level classes are not part of the canonical alpha handler subset.'));
  }

  let handler;
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const hasDefault = (statement.modifiers || []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
      const hasExport = (statement.modifiers || []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (hasDefault && hasExport) { handler = statement; break; }
    }
  }

  if (!handler) {
    for (const statement of sourceFile.statements) {
      if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
      const expression = statement.expression;
      if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'defineHandler') {
        diagnostics.push(diagnostic(sourceFile, expression, 'PULSE_CANONICAL_DEFINE_HANDLER_UNSUPPORTED', 'defineHandler is not part of the public runtime contract. Export a plain default handler function or a static Router.'));
        continue;
      }
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) { handler = expression; break; }
    }
  }

  if (handler) {
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        const moduleName = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
        const clause = statement.importClause;
        const typeOnly = isTypeOnlyImportDeclaration(statement);
        const packageLowererImport = moduleName !== '@pulse-compute/runtime' && allowedRuntimeImports.has(moduleName);
        if (!typeOnly && !packageLowererImport) diagnostics.push(diagnostic(sourceFile, statement, 'PULSE_CANONICAL_RUNTIME_IMPORT_UNSUPPORTED', 'Canonical handlers may use type-only imports from @pulse-compute/runtime and runtime imports owned by discovered package lowerers.'));
        continue;
      }
      if (statement === handler || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement)) continue;
      if (ts.isExportAssignment(statement)) {
        const expression = statement.expression;
        if (expression === handler) continue;
      }
      diagnostics.push(diagnostic(sourceFile, statement, 'PULSE_CANONICAL_TOP_LEVEL_RUNTIME_UNSUPPORTED', 'Canonical source may contain only type declarations, runtime-contract imports, and the exported default handler. Move runtime helpers inside the handler until module lowering is implemented.'));
    }
  }

  if (!handler) diagnostics.push(diagnostic(sourceFile, sourceFile, 'PULSE_CANONICAL_HANDLER_MISSING', 'Expected an exported default handler function.'));
  if (handler && handler.asteriskToken) diagnostics.push(createHandlerDiagnostic({
    frontend: 'canonical-source',
    issue: 'handler.generator.unsupported',
    sourceFile,
    node: handler
  }));
  if (handler && handler.parameters.length !== 1) diagnostics.push(diagnostic(sourceFile, handler, 'PULSE_CANONICAL_HANDLER_ARITY', 'Canonical handlers must accept exactly one ctx parameter.'));
  if (handler && !handler.body) diagnostics.push(diagnostic(sourceFile, handler, 'PULSE_CANONICAL_HANDLER_BODY_MISSING', 'Canonical handler must have a body.'));
  return handler;
}


function sourceFileForRequest(sourceText, options = {}, recognition) {
  const fileName = String(options.fileName || 'app.ts').replace(/\\/g, '/');
  const source = String(sourceText);
  const model = sourceModelForCanonicalRecognition(recognition);
  if (model && model.file === fileName && model.source === source) {
    return Object.freeze({ fileName, source, sourceFile: model.sourceFile, reusedRecognitionAst: true });
  }
  return Object.freeze({
    fileName,
    source,
    sourceFile: ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
    reusedRecognitionAst: false
  });
}

function preparePlainHandlerSource(sourceText, options = {}, recognition) {
  const parsed = sourceFileForRequest(sourceText, options, recognition);
  const schemaBundle = effectiveSchemaBundle(options.schemaBundle);
  const diagnostics = Array.from(parsed.sourceFile.parseDiagnostics || [], (entry) => Object.freeze({
    code: 'PULSE_CANONICAL_SYNTAX_ERROR',
    kind: 'CanonicalCompileDiagnostic',
    severity: 'error',
    message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
    file: parsed.fileName,
    position: Object.freeze(parsed.sourceFile.getLineAndCharacterOfPosition(entry.start || 0)),
    detail: Object.freeze({ typescriptCode: entry.code })
  }));
  const authoredHandler = findCanonicalHandler(parsed.sourceFile, diagnostics, options);
  const warnings = [];
  let handler = authoredHandler;
  let normalization;
  let analysis = Object.freeze({ capabilities: Object.freeze([]), providerOperations: Object.freeze([]), fetchCount: 0, genericJsonCount: 0, schemaBoundJsonCount: 0, schemaReferences: Object.freeze([]) });
  if (authoredHandler) {
    const ctxParameter = authoredHandler.parameters[0];
    const ctxName = ctxParameter && ts.isIdentifier(ctxParameter.name) ? ctxParameter.name.text : 'ctx';
    const packageEffectsByStart = new Map();
    for (const effect of options.packageEffects || []) {
      const start = effect && effect.range && Number(effect.range.start);
      if (Number.isSafeInteger(start) && !packageEffectsByStart.has(start)) packageEffectsByStart.set(start, effect);
    }
    const normalized = normalizeManagedHandler(authoredHandler, {
      sourceFile: parsed.sourceFile,
      ctxName,
      role: 'handler',
      strict: options.strict === true,
      frontend: 'canonical-source',
      target: options.target,
      handlerAuthoring: options.handlerAuthoring,
      requireAsync: options.requireAsync === true,
      requireEffectAwait: options.requireEffectAwait === true,
      packageEffectForCall: options.packageEffectForCall || ((call) => packageEffectsByStart.get(call.getStart(parsed.sourceFile)))
    });
    diagnostics.push(...normalized.diagnostics);
    warnings.push(...normalized.warnings);
    handler = normalized.functionNode;
    normalization = (normalized.summary.changed || normalized.summary.userAuthoredAsync || normalized.summary.awaitCount > 0)
      ? normalized.summary
      : undefined;
    analysis = analyzeHandler(parsed.sourceFile, handler, ctxName, diagnostics, schemaBundle, options);
  }
  return Object.freeze({
    version: PLAIN_HANDLER_FRONTEND_VERSION,
    frontend: 'canonical-source',
    fileName: parsed.fileName,
    sourceText: parsed.source,
    sourceFile: parsed.sourceFile,
    handler,
    schemaBundle,
    analysis,
    diagnostics,
    warnings: Object.freeze(warnings),
    normalization,
    authoredHandler,
    reusedRecognitionAst: parsed.reusedRecognitionAst
  });
}

function assertPlainHandlerDiagnostics(frontend) {
  if (!frontend || frontend.version !== PLAIN_HANDLER_FRONTEND_VERSION) {
    throw new TypeError(`assertPlainHandlerDiagnostics requires ${PLAIN_HANDLER_FRONTEND_VERSION}.`);
  }
  if (frontend.diagnostics.some((entry) => entry.severity !== 'warning')) {
    throw new CanonicalCompileError(`Canonical compilation failed for ${frontend.fileName}.`, frontend.diagnostics);
  }
  return frontend;
}

module.exports = Object.freeze({
  PLAIN_HANDLER_FRONTEND_VERSION,
  SUPPORTED_FETCH_DECODERS,
  ALLOWED_IMPORTS,
  CanonicalCompileError,
  effectiveSchemaBundle,
  preparePlainHandlerSource,
  assertPlainHandlerDiagnostics
});
