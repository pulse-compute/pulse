'use strict';

const ts = require('typescript');

function loadDiagnostics() {
  try { return require('@pulse-compute/wasm-contracts/diagnostics'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/diagnostics.js');
    throw error;
  }
}
function loadSchemaResponseContracts() {
  try { return require('@pulse-compute/wasm-contracts/handler/schema-response-codec'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/handler/schema-response-codec.js');
    throw error;
  }
}

const { PACKAGE_VERSION, normalizeArtifact, sourceLoc, stableFileName } = loadDiagnostics();
const schemaResponse = loadSchemaResponseContracts();

function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function artifact(value) { return value && typeof value === 'object' && value.artifact ? value.artifact : value; }
function clone(value) { if (Array.isArray(value)) return value.map(clone); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])); return value; }
function isStringLiteralLike(node) { return Boolean(node && (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral)); }
function unwrapExpression(node) { let current = node; while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current)) || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current))) current = current.expression; return current; }
function literalArg(node) { const expr = unwrapExpression(node); return isStringLiteralLike(expr) ? expr.text : undefined; }
function nodeText(sourceFile, node) { return node ? node.getText(sourceFile).trim() : ''; }
function hasModifier(node, kind) { return Boolean(node.modifiers && node.modifiers.some((modifier) => modifier.kind === kind)); }
function isExported(node) { return hasModifier(node, ts.SyntaxKind.ExportKeyword); }
function propertyChain(node) { const parts = []; let current = node; while (current && ts.isPropertyAccessExpression(current)) { parts.unshift(current.name.text); current = current.expression; } if (current && ts.isIdentifier(current)) parts.unshift(current.text); else return undefined; return parts; }
function propertyKeyText(name) { if (!name) return undefined; if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text; return undefined; }
function configRoot(config) { return plainObject(artifact(config)); }
function jsonConfig(config) { const root = configRoot(config); const runtime = plainObject(root.runtime); const payload = plainObject(runtime.payload); return plainObject(payload.json || root.json); }
function defaultNamespace(config) { const json = jsonConfig(config); return typeof json.defaultNamespace === 'string' && json.defaultNamespace ? json.defaultNamespace : 'app'; }
function normalizeType(type) { const value = String(type || '').trim().toLowerCase(); if (value === 'boolean') return 'bool'; if (value === 'number') return 'f64'; if (value === 'int' || value === 'integer') return 'i32'; if (value === 'uint') return 'u32'; return value; }
function schemaId(schema, fallbackNamespace) { if (!schema || typeof schema !== 'object') return undefined; if (typeof schema.id === 'string' && schema.id) return schema.id; const name = typeof schema.name === 'string' && schema.name ? schema.name : undefined; if (!name) return undefined; const namespace = typeof schema.namespace === 'string' && schema.namespace ? schema.namespace : fallbackNamespace; return name.includes('.') ? name : `${namespace}.${name}`; }
function schemaRegistry(config) {
  const json = jsonConfig(config);
  const fallbackNamespace = defaultNamespace(config);
  const map = new Map();
  const schemas = [];
  for (const entry of Array.isArray(json.schemas) ? json.schemas : []) {
    const id = schemaId(entry, fallbackNamespace);
    if (!id) continue;
    const fields = Object.fromEntries(Object.entries(plainObject(entry.fields)).map(([name, type]) => [name, normalizeType(type)]));
    const normalized = { id, namespace: id.includes('.') ? id.split('.').slice(0, -1).join('.') : fallbackNamespace, name: id.includes('.') ? id.split('.').slice(-1)[0] : id, fields, codec: entry.codec || 'json', source: entry.source };
    schemas.push(normalized);
    map.set(id, normalized);
    map.set(normalized.name, normalized);
  }
  return { defaultNamespace: fallbackNamespace, schemas, map };
}
function summarizeSchema(schema) { return schema ? { id: schema.id, fields: Object.entries(schema.fields || {}).map(([name, type]) => ({ name, type })) } : undefined; }
function makeDiagnostic(sourceFile, node, code, message, severity, details, hint) { return { phase: 'schema-response-codec', severity: severity || 'error', code, message, hint, details, loc: node ? sourceLoc(sourceFile, node) : { file: sourceFile ? stableFileName(sourceFile.fileName, process.cwd()) : '<schema-response-codec>' } }; }
function collectFunctionNodes(sourceFile, cwd) {
  const byName = new Map();
  function record(name, node, declaration, kind, exported) { byName.set(name, { name, node, declaration, kind, exported: Boolean(exported), loc: sourceLoc(sourceFile, declaration || node), file: stableFileName(sourceFile.fileName, cwd) }); }
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) record(statement.name.text, statement, statement, 'function-declaration', isExported(statement));
    if (!ts.isVariableStatement(statement)) continue;
    const exported = isExported(statement);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const init = declaration.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) record(declaration.name.text, init, declaration, ts.isArrowFunction(init) ? 'const-arrow' : 'const-function-expression', exported);
    }
  }
  return byName;
}
function handlerById(handlerTable) { const map = new Map(); for (const handler of handlerTable && handlerTable.handlers || []) map.set(handler.id, handler); return map; }
function handlerNameForRoute(route, handlersById) { if (route && route.handlerName) return route.handlerName; const handler = route && route.handler ? handlersById.get(route.handler) : undefined; return handler && (handler.localName || handler.exportName || handler.inlineName); }
function ctxNameFor(fnInfo) { const param = Array.from(fnInfo && fnInfo.node && fnInfo.node.parameters || [])[0]; return param && ts.isIdentifier(param.name) ? param.name.text : 'ctx'; }
function isCtxResolvedCall(call, ctxName) { if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return false; const chain = propertyChain(call.expression); return Boolean(chain && chain.join('.') === `${ctxName}.resolved`); }
function resolvedNameFromCall(call, ctxName) { if (!isCtxResolvedCall(call, ctxName)) return undefined; if (call.arguments.length === 0) return '$default'; if (call.arguments.length === 1) return literalArg(call.arguments[0]); return undefined; }
function isReqJsonCall(call, ctxName) { if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return false; const chain = propertyChain(call.expression); const joined = chain && chain.join('.'); return joined === `${ctxName}.req.json` || joined === `${ctxName}.request.json` || joined === `${ctxName}.req.parse`; }
function requestJsonSchemaFromCall(call) { return literalArg(call && call.arguments && call.arguments[0]); }
function statusFromOptions(optionsNode) { const expr = unwrapExpression(optionsNode); if (!expr || !ts.isObjectLiteralExpression(expr)) return { status: 200, dynamic: false }; for (const prop of expr.properties) { if (!ts.isPropertyAssignment(prop)) continue; const key = propertyKeyText(prop.name); if (key !== 'status') continue; const init = unwrapExpression(prop.initializer); if (init && ts.isNumericLiteral(init)) return { status: Number(init.text), dynamic: false }; if (init && ts.isIdentifier(init)) return { statusExpression: init.text, dynamic: true }; return { statusExpression: prop.initializer && prop.initializer.getText ? prop.initializer.getText() : '<dynamic>', dynamic: true }; } return { status: 200, dynamic: false }; }
function literalHeaders(optionsNode) { const expr = unwrapExpression(optionsNode); const headers = []; if (!expr || !ts.isObjectLiteralExpression(expr)) return headers; for (const prop of expr.properties) { if (!ts.isPropertyAssignment(prop) || propertyKeyText(prop.name) !== 'headers') continue; const h = unwrapExpression(prop.initializer); if (!h || !ts.isObjectLiteralExpression(h)) continue; for (const hp of h.properties) { if (!ts.isPropertyAssignment(hp)) continue; const name = propertyKeyText(hp.name); if (name) headers.push({ name, valueText: hp.initializer && hp.initializer.getText ? hp.initializer.getText() : '<value>' }); } } return headers; }
function valueKindForExpression(expr, locals) {
  const value = unwrapExpression(expr);
  if (!value) return { kind: 'unsupported' };
  if (ts.isIdentifier(value)) {
    if (locals.requestJson.has(value.text)) return { kind: 'requestJsonDecodeRef', local: value.text, schema: locals.requestJson.get(value.text) };
    if (locals.originJson.has(value.text)) return { kind: 'resolvedJsonDecodeRef', local: value.text, schema: locals.originJson.get(value.text).schema, resolvedName: locals.originJson.get(value.text).resolvedName };
    return { kind: 'identifier', local: value.text };
  }
  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
    const chain = propertyChain(value.expression);
    if (chain && chain.length === 2 && locals.resolved.has(chain[0]) && chain[1] === 'json') return { kind: 'resolvedJsonDecodeRef', schema: literalArg(value.arguments[0]), resolvedName: locals.resolved.get(chain[0]), inline: true };
    if (chain && chain.join('.').endsWith('.schema.encode')) return { kind: 'schemaEncodeCall', schema: literalArg(value.arguments[0]) };
  }
  if (ts.isObjectLiteralExpression(value)) return { kind: 'arbitraryObjectLiteral' };
  return { kind: 'unsupported', text: value.getText ? value.getText() : String(value) };
}
function scanFunction(sourceFile, fnInfo, registry) {
  const ctxName = ctxNameFor(fnInfo);
  const locals = { resolved: new Map(), requestJson: new Map(), originJson: new Map() };
  const finalResponses = [];
  const originDecodes = [];
  const schemaEncodes = [];
  const diagnostics = [];
  function noteSchema(schemaName, node, surface) {
    if (!schemaName) return undefined;
    const found = registry.map.get(schemaName) || registry.map.get(String(schemaName).split('.').pop());
    if (!found) diagnostics.push(makeDiagnostic(sourceFile, node, schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.schemaMissing, `Schema ${schemaName} used by ${surface} is not declared.`, 'error', { schema: schemaName, declaredSchemas: registry.schemas.map((entry) => entry.id) }, 'Declare the schema under runtime.payload.json.schemas.'));
    return found;
  }
  function walk(node) {
    if (!node) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrapExpression(node.initializer);
      const resolvedName = isCtxResolvedCall(init, ctxName) ? resolvedNameFromCall(init, ctxName) : undefined;
      if (resolvedName !== undefined) locals.resolved.set(node.name.text, resolvedName);
      if (isReqJsonCall(init, ctxName)) locals.requestJson.set(node.name.text, requestJsonSchemaFromCall(init) || '$generic');
      if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression)) {
        const chain = propertyChain(init.expression);
        if (chain && chain.length === 2 && locals.resolved.has(chain[0]) && chain[1] === 'json') {
          const schema = literalArg(init.arguments[0]);
          if (!schema) diagnostics.push(makeDiagnostic(sourceFile, init, schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.originJsonSchemaMustBeLiteral, 'ctx.resolved(...).json(...) schema must be a string literal.', 'error', { text: nodeText(sourceFile, init) }));
          const found = noteSchema(schema, init, 'ctx.resolved().json');
          const entry = { local: node.name.text, resolvedLocal: chain[0], resolvedName: locals.resolved.get(chain[0]), schema, schemaFound: Boolean(found), schemaSummary: summarizeSchema(found), surface: 'ctx.resolved().json("Schema")', loc: sourceLoc(sourceFile, init), text: nodeText(sourceFile, init) };
          locals.originJson.set(node.name.text, { schema, resolvedName: entry.resolvedName });
          originDecodes.push(entry);
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const chain = propertyChain(node.expression);
      const joined = chain && chain.join('.');
      if (joined === `${ctxName}.result.json`) {
        const schema = literalArg(node.arguments[0]);
        if (!schema) diagnostics.push(makeDiagnostic(sourceFile, node.arguments[0] || node, schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.resultJsonSchemaMustBeLiteral, 'ctx.result.json schema must be a string literal.', 'error', { text: nodeText(sourceFile, node) }));
        const found = noteSchema(schema, node, 'ctx.result.json');
        const value = valueKindForExpression(node.arguments[1], locals);
        if (value.kind === 'arbitraryObjectLiteral') diagnostics.push(makeDiagnostic(sourceFile, node.arguments[1], schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.arbitraryObjectReserved, 'Arbitrary object literals are reserved for schema-backed response encoding.', 'error', { text: nodeText(sourceFile, node.arguments[1]) }, 'Use an opaque decode ref from ctx.req.json("Schema") or ctx.resolved(...).json("Schema").'));
        else if (!['requestJsonDecodeRef', 'resolvedJsonDecodeRef'].includes(value.kind)) diagnostics.push(makeDiagnostic(sourceFile, node.arguments[1] || node, schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.resultJsonUnsupportedValue, 'ctx.result.json currently accepts opaque schema/generic decode refs only.', 'error', { value }, 'Pass an opaque ref from ctx.req.json("Schema") or ctx.resolved(...).json("Schema").'));
        const status = statusFromOptions(node.arguments[2]);
        finalResponses.push({ schema, schemaFound: Boolean(found), schemaSummary: summarizeSchema(found), value, status: status.status || 200, statusDynamic: Boolean(status.dynamic), headers: literalHeaders(node.arguments[2]), surface: 'ctx.result.json("Schema", value, options?)', loc: sourceLoc(sourceFile, node), text: nodeText(sourceFile, node) });
      }
      if (joined === `${ctxName}.schema.encode`) {
        const schema = literalArg(node.arguments[0]);
        if (!schema) diagnostics.push(makeDiagnostic(sourceFile, node.arguments[0] || node, schemaResponse.SCHEMA_RESPONSE_CODEC_DIAGNOSTICS.schemaEncodeSchemaMustBeLiteral, 'ctx.schema.encode schema must be a string literal.', 'error', { text: nodeText(sourceFile, node) }));
        const found = noteSchema(schema, node, 'ctx.schema.encode');
        schemaEncodes.push({ schema, schemaFound: Boolean(found), schemaSummary: summarizeSchema(found), value: valueKindForExpression(node.arguments[1], locals), loc: sourceLoc(sourceFile, node), text: nodeText(sourceFile, node) });
      }
    }
    ts.forEachChild(node, walk);
  }
  if (fnInfo && fnInfo.node && fnInfo.node.body) walk(fnInfo.node.body);
  return { name: fnInfo && fnInfo.name, ctxName, finalResponses, originDecodes, schemaEncodes, diagnostics };
}

function buildSchemaResponseCodecPlan(sourceFile, routePlan, handlerTable, inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const resolvedConfig = artifact(inputs.resolvedConfig || {});
  const registry = schemaRegistry(resolvedConfig);
  const functions = collectFunctionNodes(sourceFile, cwd);
  const handlersById = handlerById(handlerTable);
  const diagnostics = [];
  const routeEntries = [];
  const continuationHandlers = new Set();
  const effectPlan = artifact(inputs.routeHandlerEffectPlan || {});
  for (const route of Array.isArray(effectPlan && effectPlan.routes) ? effectPlan.routes : []) {
    for (const resolve of Array.isArray(route.resolves) ? route.resolves : []) if (resolve && resolve.continuation && resolve.continuation.name) continuationHandlers.add(resolve.continuation.name);
  }
  const routeNames = new Set();
  for (const route of routePlan && routePlan.routes || []) {
    const handlerName = handlerNameForRoute(route, handlersById);
    if (handlerName) routeNames.add(handlerName);
    const fnInfo = handlerName ? functions.get(handlerName) : undefined;
    const scan = scanFunction(sourceFile, fnInfo, registry);
    diagnostics.push(...scan.diagnostics);
    if (scan.finalResponses.length || scan.originDecodes.length || scan.schemaEncodes.length) routeEntries.push({ routeId: route.routeId || route.stableId || route.id, runtimeId: route.runtimeId, method: route.method, path: route.path, handlerName, role: 'route', status: scan.diagnostics.length ? 'diagnostic' : 'schema-response-codec-planned', finalResponses: scan.finalResponses, originDecodes: scan.originDecodes, schemaEncodes: scan.schemaEncodes, diagnostics: scan.diagnostics.map((diag) => diag.code) });
  }
  for (const name of continuationHandlers) {
    if (routeNames.has(name)) continue;
    const fnInfo = functions.get(name);
    const scan = scanFunction(sourceFile, fnInfo, registry);
    diagnostics.push(...scan.diagnostics);
    if (scan.finalResponses.length || scan.originDecodes.length || scan.schemaEncodes.length) routeEntries.push({ routeId: `continuation:${name}`, handlerName: name, role: 'continuation', status: scan.diagnostics.length ? 'diagnostic' : 'schema-response-codec-planned', finalResponses: scan.finalResponses, originDecodes: scan.originDecodes, schemaEncodes: scan.schemaEncodes, diagnostics: scan.diagnostics.map((diag) => diag.code) });
  }
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const artifactOut = normalizeArtifact({
    version: schemaResponse.SCHEMA_RESPONSE_CODEC_PLAN_VERSION,
    generatedBy,
    phase: schemaResponse.SCHEMA_RESPONSE_CODEC_PLAN_PHASE,
    artifact: schemaResponse.SCHEMA_RESPONSE_CODEC_PLAN_ARTIFACT,
    contractId: schemaResponse.SCHEMA_RESPONSE_CODEC_CONTRACT_ID,
    status: errorDiagnostics.length ? 'error' : 'ok',
    source: stableFileName(sourceFile.fileName, cwd),
    requestJsonBodyPlanConnected: Boolean(inputs.requestJsonBodyPlan),
    schemaDecodeResultPlanConnected: Boolean(inputs.schemaDecodeResultPlan),
    routeHandlerEffectPlanConnected: Boolean(inputs.routeHandlerEffectPlan),
    validateAndPlanOnly: false,
    runtimeBehaviorChanged: true,
    compiledWasmRuntimeImplemented: true,
    nodeCompiledProofImplemented: Boolean(inputs.nodeSchemaResponseCodecProof),
    providerNetworkFetchRequired: false,
    scope: JSON.parse(JSON.stringify(schemaResponse.SCHEMA_RESPONSE_CODEC_SCOPE)),
    surface: JSON.parse(JSON.stringify(schemaResponse.SCHEMA_RESPONSE_CODEC_SURFACE)),
    valueKinds: JSON.parse(JSON.stringify(schemaResponse.SCHEMA_RESPONSE_CODEC_VALUE_KINDS)),
    reserved: [...schemaResponse.SCHEMA_RESPONSE_CODEC_RESERVED_SURFACE],
    policy: schemaResponse.defaultSchemaResponseCodecPolicy(),
    schemaRegistry: { defaultNamespace: registry.defaultNamespace, schemas: registry.schemas.map(summarizeSchema) },
    routes: routeEntries,
    diagnostics,
    summary: {
      routes: routeEntries.length,
      routeHandlers: routeEntries.filter((entry) => entry.role === 'route').length,
      continuationHandlers: routeEntries.filter((entry) => entry.role === 'continuation').length,
      finalJsonResponses: routeEntries.reduce((sum, entry) => sum + entry.finalResponses.length, 0),
      originJsonDecodes: routeEntries.reduce((sum, entry) => sum + entry.originDecodes.length, 0),
      schemaEncodes: routeEntries.reduce((sum, entry) => sum + entry.schemaEncodes.length, 0),
      originResponseJsonDecodeImplemented: true,
      schemaEncodeReservedForBackendBodies: false,
      schemaEncodeImplementedForBackendJsonBodies: true,
      compiledWasmRuntimeImplemented: true,
      nodeCompiledProofImplemented: Boolean(inputs.nodeSchemaResponseCodecProof),
      providerNetworkFetchRequired: false,
      originResponseJsonDecodeImplemented: true,
      schemaEncodeReservedForBackendBodies: false,
      schemaEncodeImplementedForBackendJsonBodies: true,
      backendJsonRequestBodies: true,
      requestBodyEffects: true,
      automaticSchemaGeneration: false,
      typedSchemaSpecificAccessors: false,
      arbitraryJsObjectInference: false,
      binaryRequestBodyParsing: false,
      streamRequestBodyParsing: false,
      diagnostics: diagnostics.length,
      errors: errorDiagnostics.length
    }
  }, cwd);
  return { artifact: artifactOut, diagnostics, routes: routeEntries, schemaRegistry: registry };
}

module.exports = { buildSchemaResponseCodecPlan };
