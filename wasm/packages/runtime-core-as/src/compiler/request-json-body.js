'use strict';

const ts = require('typescript');

function loadDiagnostics() {
  try { return require('@pulse-compute/wasm-contracts/diagnostics'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/diagnostics.js');
    throw error;
  }
}
function loadRequestJsonContracts() {
  try { return require('@pulse-compute/wasm-contracts/handler/request-json-body'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/handler/request-json-body.js');
    throw error;
  }
}
function loadGenericParserContracts() {
  try { return require('@pulse-compute/wasm-contracts/schema-json/generic-parser'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/schema-json/generic-parser.js');
    throw error;
  }
}

const { PACKAGE_VERSION, normalizeArtifact, sourceLoc, stableFileName } = loadDiagnostics();
const requestJson = loadRequestJsonContracts();
const { normalizeSchemaJsonParserSelection } = loadGenericParserContracts();

function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function configArtifact(value) { return value && typeof value === 'object' && value.artifact ? value.artifact : value; }
function isStringLiteralLike(node) { return Boolean(node && (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral)); }
function unwrapExpression(node) {
  let current = node;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current)) || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current))) current = current.expression;
  return current;
}
function propertyChain(node) {
  const parts = [];
  let current = node;
  while (current && ts.isPropertyAccessExpression(current)) { parts.unshift(current.name.text); current = current.expression; }
  if (current && ts.isIdentifier(current)) parts.unshift(current.text);
  else return undefined;
  return parts;
}
function literalArg(node) {
  const expr = unwrapExpression(node);
  return isStringLiteralLike(expr) ? expr.text : undefined;
}
function hasModifier(node, kind) { return Boolean(node.modifiers && node.modifiers.some((modifier) => modifier.kind === kind)); }
function isExported(node) { return hasModifier(node, ts.SyntaxKind.ExportKeyword); }
function unique(values) { return Array.from(new Set((values || []).filter((value) => value !== undefined && value !== null).map(String))).sort(); }

function jsonConfigForSchemas(config) {
  const root = plainObject(configArtifact(config));
  const runtime = plainObject(root.runtime);
  const payload = plainObject(runtime.payload);
  return plainObject(payload.json || root.json);
}
function defaultNamespaceForSchemas(config) {
  const json = jsonConfigForSchemas(config);
  return typeof json.defaultNamespace === 'string' && json.defaultNamespace ? json.defaultNamespace : 'app';
}
function normalizeFieldType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (value === 'boolean') return 'bool';
  if (value === 'number') return 'f64';
  if (value === 'int' || value === 'integer') return 'i32';
  if (value === 'uint') return 'u32';
  return value;
}
function schemaId(schema, fallbackNamespace) {
  if (!schema || typeof schema !== 'object') return undefined;
  if (typeof schema.id === 'string' && schema.id) return schema.id;
  const name = typeof schema.name === 'string' && schema.name ? schema.name : undefined;
  if (!name) return undefined;
  const namespace = typeof schema.namespace === 'string' && schema.namespace ? schema.namespace : fallbackNamespace;
  return name.includes('.') ? name : `${namespace}.${name}`;
}
function schemaRegistry(config) {
  const json = jsonConfigForSchemas(config);
  const fallbackNamespace = defaultNamespaceForSchemas(config);
  const list = Array.isArray(json.schemas) ? json.schemas : [];
  const schemas = [];
  const byId = new Map();
  for (const entry of list) {
    const id = schemaId(entry, fallbackNamespace);
    if (!id) continue;
    const fields = plainObject(entry.fields);
    const normalized = { id, namespace: id.includes('.') ? id.split('.').slice(0, -1).join('.') : fallbackNamespace, name: id.includes('.') ? id.split('.').slice(-1)[0] : id, fields: Object.fromEntries(Object.entries(fields).map(([name, type]) => [name, normalizeFieldType(type)])), codec: entry.codec || 'json', source: entry.source };
    schemas.push(normalized);
    byId.set(id, normalized);
    byId.set(normalized.name, normalized);
  }
  return { defaultNamespace: fallbackNamespace, schemas, byId };
}
function schemaSummaryForRead(registry, schema) {
  if (!schema) return undefined;
  const found = registry.byId.get(schema) || registry.byId.get(String(schema).split('.').pop());
  if (!found) return undefined;
  return { id: found.id, fields: Object.entries(found.fields || {}).map(([name, type]) => ({ name, type })) };
}
function nodeText(sourceFile, node) { return node ? node.getText(sourceFile).trim() : ''; }
function makeDiagnostic(sourceFile, node, code, severity, message, hint, details) {
  const diagnostic = { phase: 'request-json-body', severity: severity || 'error', code, message, hint, loc: node ? sourceLoc(sourceFile, node) : { file: sourceFile ? stableFileName(sourceFile.fileName, process.cwd()) : '<request-json-body>' } };
  if (details !== undefined) diagnostic.details = details;
  return diagnostic;
}
function collectFunctionNodes(sourceFile, cwd) {
  const byName = new Map();
  const byOffset = new Map();
  function record(name, node, declaration, kind, exported) {
    const loc = sourceLoc(sourceFile, node);
    const info = { name, node, declaration, kind, exported: Boolean(exported), loc: sourceLoc(sourceFile, declaration || node), functionLoc: loc, file: stableFileName(sourceFile.fileName, cwd) };
    if (name) byName.set(name, info);
    const offset = loc && loc.start && loc.start.offset;
    if (typeof offset === 'number') byOffset.set(offset, info);
    return info;
  }
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      record(statement.name.text, statement, statement, 'function-declaration', isExported(statement));
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    const exported = isExported(statement);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const init = declaration.initializer;
      if (!init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;
      record(declaration.name.text, init, declaration, ts.isArrowFunction(init) ? 'const-arrow' : 'const-function-expression', exported);
    }
  }
  return { byName, byOffset };
}
function handlerById(handlerTable) {
  const map = new Map();
  for (const handler of handlerTable && handlerTable.handlers || []) map.set(handler.id, handler);
  return map;
}
function handlerNameForRoute(route, handlersById) {
  if (route && route.handlerName) return route.handlerName;
  const handler = route && route.handler ? handlersById.get(route.handler) : undefined;
  return handler && (handler.localName || handler.exportName || handler.inlineName);
}
function ctxNameFor(fnInfo) {
  const param = Array.from(fnInfo && fnInfo.node && fnInfo.node.parameters || [])[0];
  return param && ts.isIdentifier(param.name) ? param.name.text : 'ctx';
}
function isReqJsonCall(call, ctxName) {
  if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return false;
  const chain = propertyChain(call.expression);
  if (!chain) return false;
  const joined = chain.join('.');
  return joined === `${ctxName}.req.json` || joined === `${ctxName}.request.json` || joined === `${ctxName}.req.parse`;
}
function requestJsonMode(call, ctxName) {
  const joined = propertyChain(call.expression).join('.');
  const schema = literalArg(call.arguments[0]);
  const first = unwrapExpression(call.arguments[0]);
  const nonLiteralSchema = call.arguments.length > 0 && schema === undefined;
  return {
    surface: `ctx.${propertyChain(call.expression).slice(1).join('.')}`,
    mode: schema ? 'schemaJson' : 'genericJson',
    schema,
    nonLiteralSchema,
    parserRequired: !schema && (joined === `${ctxName}.req.json` || joined === `${ctxName}.request.json`),
    loc: undefined,
    text: undefined
  };
}
function scanFunction(sourceFile, fnInfo, parserSelection) {
  const ctxName = ctxNameFor(fnInfo);
  const reads = [];
  const accessors = [];
  const locals = new Map();
  const diagnostics = [];
  function recordRead(call, localName) {
    const read = requestJsonMode(call, ctxName);
    read.local = localName;
    read.loc = sourceLoc(sourceFile, call);
    read.text = nodeText(sourceFile, call);
    read.cacheKey = `$requestJson:${read.schema || '$generic'}`;
    read.lazy = true;
    read.repeatedReadsUseCache = true;
    if (read.nonLiteralSchema) diagnostics.push(makeDiagnostic(sourceFile, call.arguments[0], requestJson.REQUEST_JSON_BODY_DIAGNOSTICS.nonLiteralSchema, 'error', 'ctx.req.json/parse schema names must be string literals for PulseWasm request JSON lowering.', 'Use ctx.req.json("namespace.Schema") or ctx.req.json() with explicit generic parser config.'));
    if (read.mode === 'genericJson' && !parserSelection.parserRequested) diagnostics.push(makeDiagnostic(sourceFile, call, requestJson.REQUEST_JSON_BODY_DIAGNOSTICS.genericParserRequired, 'error', 'ctx.req.json() requires the explicit generic as-json parser fallback config.', 'Set runtime.payload.json = { target: "auto", parser: "as-json" } or use ctx.req.json("Schema").'));
    reads.push(read);
    if (localName) locals.set(localName, read);
  }
  if (fnInfo && fnInfo.node && fnInfo.node.body && ts.isBlock(fnInfo.node.body)) {
    for (const statement of fnInfo.node.body.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const init = unwrapExpression(declaration.initializer);
        if (isReqJsonCall(init, ctxName)) recordRead(init, declaration.name.text);
      }
    }
  }
  function walk(node) {
    if (!node) return;
    if (ts.isCallExpression(node)) {
      if (isReqJsonCall(node, ctxName)) {
        const already = reads.some((read) => read.loc && read.loc.start && read.loc.start.offset === sourceLoc(sourceFile, node).start.offset);
        if (!already) recordRead(node, undefined);
      }
      if (ts.isPropertyAccessExpression(node.expression)) {
        const chain = propertyChain(node.expression);
        if (chain && chain.length === 2 && locals.has(chain[0])) {
          const method = chain[1];
          const read = locals.get(chain[0]);
          const path = literalArg(node.arguments[0]);
          const pathRequired = ['getString', 'getI32', 'getU32', 'getF64', 'getBool', 'has'].includes(method);
          if (!requestJson.REQUEST_JSON_BODY_ACCESSORS.includes(method)) {
            diagnostics.push(makeDiagnostic(sourceFile, node, requestJson.REQUEST_JSON_BODY_DIAGNOSTICS.accessorUnsupported, 'error', `Request JSON accessor ${method} is not supported by the Pass 39 MVP.`, `Use one of: ${requestJson.REQUEST_JSON_BODY_ACCESSORS.join(', ')}.`));
          } else if (pathRequired && path === undefined) {
            diagnostics.push(makeDiagnostic(sourceFile, node, requestJson.REQUEST_JSON_BODY_DIAGNOSTICS.accessorPathMustBeLiteral, 'error', `Request JSON accessor ${method} requires a literal field path.`, `Use ${chain[0]}.${method}("fieldName").`));
          }
          accessors.push({ local: chain[0], method, path, mode: read.mode, schema: read.schema, loc: sourceLoc(sourceFile, node), text: nodeText(sourceFile, node) });
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  if (fnInfo && fnInfo.node && fnInfo.node.body) walk(fnInfo.node.body);
  return { name: fnInfo && fnInfo.name, ctxName, reads, accessors, diagnostics };
}
function buildRequestJsonBodyPlan(sourceFile, routePlan, handlerTable, inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const resolvedConfig = configArtifact(inputs.resolvedConfig || {});
  const parserSelection = normalizeSchemaJsonParserSelection(resolvedConfig);
  const schemas = schemaRegistry(resolvedConfig);
  const functions = collectFunctionNodes(sourceFile, cwd);
  const handlersById = handlerById(handlerTable);
  const diagnostics = [];
  const routes = [];
  for (const route of routePlan && routePlan.routes || []) {
    const handlerName = handlerNameForRoute(route, handlersById);
    const fnInfo = handlerName ? functions.byName.get(handlerName) : undefined;
    const scan = scanFunction(sourceFile, fnInfo, parserSelection);
    diagnostics.push(...scan.diagnostics);
    const required = scan.reads.length > 0;
    const modes = unique(required ? scan.reads.map((read) => read.mode) : ['none']);
    const routeEntry = {
      routeId: route.routeId || route.stableId || route.id,
      runtimeId: route.runtimeId,
      method: route.method,
      path: route.path,
      handlerId: route.handler,
      handlerName,
      status: scan.diagnostics.length > 0 ? 'diagnostic' : required ? 'request-json-lazy-planned' : 'no-request-json-body',
      required,
      lazy: true,
      routeDemandOnly: true,
      perRequestDecodeCache: true,
      reads: scan.reads.map((read, index) => ({ id: `${route.routeId || route.stableId || route.id || handlerName}:request-json:${index}`, mode: read.mode, schema: read.schema, schemaSummary: schemaSummaryForRead(schemas, read.schema), surface: read.surface, local: read.local, cacheKey: read.cacheKey, lazy: true, repeatedReadsUseCache: true, loc: read.loc })),
      accessors: scan.accessors,
      modes,
      modeStatuses: modes.map((mode) => ({ mode, status: requestJson.REQUEST_JSON_BODY_MODES[mode] ? requestJson.REQUEST_JSON_BODY_MODES[mode].status : 'unknown' })),
      diagnostics: scan.diagnostics.map((diag) => diag.code)
    };
    routes.push(routeEntry);
  }
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const routesWithReads = routes.filter((route) => route.required).length;
  const artifact = normalizeArtifact({
    version: requestJson.REQUEST_JSON_BODY_PLAN_VERSION,
    generatedBy,
    phase: requestJson.REQUEST_JSON_BODY_PLAN_PHASE,
    artifact: requestJson.REQUEST_JSON_BODY_PLAN_ARTIFACT,
    contractId: requestJson.REQUEST_JSON_BODY_CONTRACT_ID,
    status: errorDiagnostics.length > 0 ? 'error' : 'ok',
    source: stableFileName(sourceFile.fileName, cwd),
    validateAndPlanOnly: false,
    runtimeBehaviorChanged: true,
    compiledWasmRuntimeImplemented: true,
    nodeCompiledProofImplemented: Boolean(inputs.nodeRequestJsonBodyProof),
    providerNetworkFetchRequired: false,
    scope: JSON.parse(JSON.stringify(requestJson.REQUEST_JSON_BODY_SCOPE)),
    lazyEvaluation: JSON.parse(JSON.stringify(requestJson.REQUEST_JSON_BODY_LAZY_POLICY)),
    policy: requestJson.defaultRequestJsonBodyPolicy(),
    surface: JSON.parse(JSON.stringify(requestJson.REQUEST_JSON_BODY_SURFACE)),
    modes: JSON.parse(JSON.stringify(requestJson.REQUEST_JSON_BODY_MODES)),
    accessors: [...requestJson.REQUEST_JSON_BODY_ACCESSORS],
    reservedAccessors: [...requestJson.REQUEST_JSON_BODY_RESERVED_ACCESSORS],
    schemaJson: parserSelection,
    schemaRegistry: { defaultNamespace: schemas.defaultNamespace, schemas: schemas.schemas.map((schema) => ({ id: schema.id, fields: Object.entries(schema.fields || {}).map(([name, type]) => ({ name, type })) })) },
    genericParserArtifact: inputs.schemaJsonGenericParser && (inputs.schemaJsonGenericParser.artifact && inputs.schemaJsonGenericParser.artifact.artifact || inputs.schemaJsonGenericParser.artifact),
    schemaSidecarArtifact: inputs.schemaJsonSidecar && (inputs.schemaJsonSidecar.artifact && inputs.schemaJsonSidecar.artifact.artifact || inputs.schemaJsonSidecar.artifact),
    routes,
    diagnostics,
    summary: {
      routes: routes.length,
      routesWithJsonBodyReads: routesWithReads,
      schemaJsonRoutes: routes.filter((route) => route.modes.includes('schemaJson')).length,
      genericJsonRoutes: routes.filter((route) => route.modes.includes('genericJson')).length,
      accessors: routes.reduce((count, route) => count + route.accessors.length, 0),
      lazyRequestBodyRead: true,
      perRequestDecodeCache: true,
      compiledWasmRuntimeImplemented: true,
      nodeCompiledProofImplemented: Boolean(inputs.nodeRequestJsonBodyProof),
      binaryRequestBodyParsing: false,
      streamRequestBodyParsing: false,
      asyncAwait: false,
      promises: false,
      asyncify: false,
      autoSchemaGeneration: false,
      arbitraryJsObjectInference: false,
      diagnostics: diagnostics.length,
      errors: errorDiagnostics.length
    }
  }, cwd);
  return { artifact, diagnostics };
}

module.exports = { buildRequestJsonBodyPlan };
