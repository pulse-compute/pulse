'use strict';

const ts = require('typescript');

function loadContractsDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/diagnostics.js');
    }
    throw error;
  }
}

function loadHandlerEffectContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/handler/effects');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/handler/effects.js');
    }
    throw error;
  }
}

const { PACKAGE_VERSION, normalizeArtifact, sourceLoc, stableFileName } = loadContractsDiagnostics();
const {
  ROUTE_HANDLER_EFFECT_PLAN_VERSION,
  ROUTE_HANDLER_EFFECT_PLAN_PHASE,
  ROUTE_HANDLER_EFFECT_PLAN_ARTIFACT,
  ROUTE_HANDLER_EFFECT_ALLOWED_METHODS,
  ROUTE_HANDLER_EFFECT_DIAGNOSTICS,
  defaultRouteHandlerEffectPolicy
} = loadHandlerEffectContracts();

function nodeText(sourceFile, node) {
  return node ? node.getText(sourceFile).trim() : '';
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers && node.modifiers.some((modifier) => modifier.kind === kind));
}

function isExported(node) {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function isStringLiteralLike(node) {
  return Boolean(node && (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral));
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current)) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function propertyChain(node) {
  const parts = [];
  let current = node;
  while (current && ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (current && ts.isIdentifier(current)) parts.unshift(current.text);
  else return undefined;
  return parts;
}

function propertyKey(sourceFile, nameNode) {
  if (!nameNode) return undefined;
  if (ts.isIdentifier(nameNode) || isStringLiteralLike(nameNode) || ts.isNumericLiteral(nameNode)) return String(nameNode.text);
  return undefined;
}

function propertyValue(sourceFile, objectNode, key) {
  if (!objectNode || !ts.isObjectLiteralExpression(objectNode)) return undefined;
  for (const prop of objectNode.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyKey(sourceFile, prop.name);
    if (name === key) return prop.initializer;
  }
  return undefined;
}

function makeDiagnostic(sourceFile, node, code, message, hint, details) {
  const diagnostic = {
    phase: 'route-handler-effects',
    severity: 'error',
    code,
    message,
    hint,
    loc: node ? sourceLoc(sourceFile, node) : { file: sourceFile.fileName }
  };
  if (details !== undefined) diagnostic.details = details;
  return diagnostic;
}

function collectFunctionNodes(sourceFile, cwd) {
  const byName = new Map();
  const byOffset = new Map();

  function record(name, node, declaration, kind, exported) {
    const info = {
      name,
      node,
      declaration,
      kind,
      exported: Boolean(exported),
      loc: sourceLoc(sourceFile, declaration || node),
      functionLoc: sourceLoc(sourceFile, node),
      file: stableFileName(sourceFile.fileName, cwd)
    };
    if (name) byName.set(name, info);
    const offset = info.functionLoc && info.functionLoc.start && info.functionLoc.start.offset;
    if (typeof offset === 'number') byOffset.set(offset, info);
    return info;
  }

  function collectInline(node) {
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !isTopLevelFunctionInitializer(node)) {
      const loc = sourceLoc(sourceFile, node);
      byOffset.set(loc.start.offset, {
        name: undefined,
        node,
        declaration: node,
        kind: ts.isArrowFunction(node) ? 'inline-arrow' : 'inline-function-expression',
        exported: false,
        loc,
        functionLoc: loc,
        file: stableFileName(sourceFile.fileName, cwd)
      });
    }
    ts.forEachChild(node, collectInline);
  }

  function isTopLevelFunctionInitializer(node) {
    const parent = node.parent;
    return Boolean(parent && ts.isVariableDeclaration(parent) && parent.initializer === node && parent.parent && parent.parent.parent && ts.isVariableStatement(parent.parent.parent));
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

  collectInline(sourceFile);
  return { byName, byOffset };
}

function handlerNodeFor(handler, functionIndex) {
  if (!handler) return undefined;
  if (handler.localName && functionIndex.byName.has(handler.localName)) return functionIndex.byName.get(handler.localName);
  const offset = handler.loc && handler.loc.start && handler.loc.start.offset;
  if (typeof offset === 'number' && functionIndex.byOffset.has(offset)) return functionIndex.byOffset.get(offset);
  return undefined;
}

function handlerById(handlerTable) {
  const map = new Map();
  for (const handler of handlerTable?.handlers || []) map.set(handler.id, handler);
  return map;
}

function ctxNameForFunction(node, role = 'route') {
  const params = Array.from(node?.parameters || []);
  if (role === 'error') {
    const param = params[1];
    return param && ts.isIdentifier(param.name) ? param.name.text : 'ctx';
  }
  const param = params[0];
  return param && ts.isIdentifier(param.name) ? param.name.text : 'ctx';
}

function scanLocalInitializers(sourceFile, node, ctxName) {
  const locals = new Map();
  function scanStatement(statement) {
    if (!ts.isVariableStatement(statement)) return;
    const declarationKind = (statement.declarationList.flags & ts.NodeFlags.Const) ? 'const' : 'let';
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      locals.set(declaration.name.text, {
        declarationKind,
        initializer: unwrapExpression(declaration.initializer),
        loc: sourceLoc(sourceFile, declaration.name),
        ctxName
      });
    }
  }
  if (node?.body && ts.isBlock(node.body)) {
    for (const statement of node.body.statements) scanStatement(statement);
  }
  return locals;
}

function lowerExpressionTree(sourceFile, node, ctxName, locals, diagnostics, stack = []) {
  const expr = unwrapExpression(node);
  if (!expr) return { kind: 'missing' };
  if (isStringLiteralLike(expr)) return { kind: 'literal', value: expr.text };
  if (ts.isNumericLiteral(expr)) return { kind: 'number', value: Number(expr.text) };
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'boolean', value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'boolean', value: false };

  if (ts.isCallExpression(expr)) {
    const chain = ts.isPropertyAccessExpression(expr.expression) ? propertyChain(expr.expression) : undefined;
    if (chain && chain.join('.') === `${ctxName}.param` && expr.arguments.length === 1 && isStringLiteralLike(expr.arguments[0])) {
      return { kind: 'ctx.param', name: expr.arguments[0].text };
    }
    if (chain && chain.join('.') === `${ctxName}.paramI32` && expr.arguments.length === 1 && isStringLiteralLike(expr.arguments[0])) {
      return { kind: 'ctx.paramI32', name: expr.arguments[0].text };
    }
  }

  if (ts.isIdentifier(expr) && locals.has(expr.text)) {
    const local = locals.get(expr.text);
    if (local.declarationKind !== 'const') {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        expr,
        ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchPathUnsupported,
        `Local "${expr.text}" is not const and cannot be used in a lowerable fetch request expression.`,
        'Use a const initialized from literals, string concatenation, or ctx.param(...).',
        { name: expr.text }
      ));
      return { kind: 'unsupported', source: nodeText(sourceFile, expr) };
    }
    if (stack.includes(expr.text)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        expr,
        ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchPathUnsupported,
        `Recursive local expression reference detected while lowering "${expr.text}".`,
        'Keep fetch request expressions acyclic and explicit.',
        { chain: [...stack, expr.text] }
      ));
      return { kind: 'unsupported', source: nodeText(sourceFile, expr) };
    }
    return { kind: 'local', name: expr.text, value: lowerExpressionTree(sourceFile, local.initializer, ctxName, locals, diagnostics, [...stack, expr.text]) };
  }

  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const parts = [];
    function pushPart(part) {
      if (!part) return;
      if (part.kind === 'concat') parts.push(...part.parts);
      else parts.push(part);
    }
    pushPart(lowerExpressionTree(sourceFile, expr.left, ctxName, locals, diagnostics, stack));
    pushPart(lowerExpressionTree(sourceFile, expr.right, ctxName, locals, diagnostics, stack));
    return { kind: 'concat', parts };
  }

  diagnostics.push(makeDiagnostic(
    sourceFile,
    expr,
    ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchPathUnsupported,
    `Fetch request expression "${nodeText(sourceFile, expr)}" is not lowerable in the Pass 30 route-effect plan.`,
    'Use string literals, + concatenation, const locals, and ctx.param("name") for now.',
    { source: nodeText(sourceFile, expr) }
  ));
  return { kind: 'unsupported', source: nodeText(sourceFile, expr) };
}

function lowerHeaders(sourceFile, headersNode, ctxName, locals, diagnostics) {
  const headers = [];
  if (!headersNode) return headers;
  const expr = unwrapExpression(headersNode);
  if (!ts.isObjectLiteralExpression(expr)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      expr,
      ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchHeadersUnsupported,
      'ctx.fetch headers must be a static object literal in the Pass 30 route-effect plan.',
      'Use headers: { accept: "application/json" } or omit headers.',
      { source: nodeText(sourceFile, expr) }
    ));
    return headers;
  }
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        prop,
        ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchHeadersUnsupported,
        'Only plain header property assignments are supported in ctx.fetch request specs.',
        'Avoid spread, shorthand, and methods in headers for now.',
        { source: nodeText(sourceFile, prop) }
      ));
      continue;
    }
    const name = propertyKey(sourceFile, prop.name);
    if (!name) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        prop.name,
        ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchHeadersUnsupported,
        'Computed header names are not supported in ctx.fetch request specs.',
        'Use literal header names.',
        { source: nodeText(sourceFile, prop.name) }
      ));
      continue;
    }
    headers.push({ name, value: lowerExpressionTree(sourceFile, prop.initializer, ctxName, locals, diagnostics), loc: sourceLoc(sourceFile, prop) });
  }
  return headers;
}


function backendPolicyMap(resolvedConfig) {
  const backends = resolvedConfig && resolvedConfig.runtime && resolvedConfig.runtime.capabilities && resolvedConfig.runtime.capabilities.backends;
  const map = new Map();
  for (const [key, value] of Object.entries(backends || {})) {
    map.set(key, {
      allowedMethods: Array.isArray(value.allowedMethods) ? value.allowedMethods.map((entry) => String(entry).toUpperCase()) : Array.isArray(value.methods) ? value.methods.map((entry) => String(entry).toUpperCase()) : undefined,
      requestBody: Array.isArray(value.requestBody) ? value.requestBody.map((entry) => String(entry)) : undefined
    });
  }
  return map;
}

function requestJsonRefForIdentifier(sourceFile, ctxName, locals, identifier) {
  if (!identifier || !ts.isIdentifier(identifier) || !locals || !locals.has(identifier.text)) return undefined;
  const local = locals.get(identifier.text);
  const init = unwrapExpression(local.initializer);
  if (!init || !ts.isCallExpression(init) || !ts.isPropertyAccessExpression(init.expression)) return undefined;
  const chain = propertyChain(init.expression);
  if (!chain || chain[0] !== ctxName || chain[1] !== 'req' || !['json', 'parse'].includes(chain[2])) return undefined;
  let mode = 'genericJson';
  let schema;
  if (init.arguments.length === 1 && isStringLiteralLike(unwrapExpression(init.arguments[0]))) {
    mode = 'schemaJson';
    schema = unwrapExpression(init.arguments[0]).text;
  }
  return { kind: 'request-json-decode-ref', local: identifier.text, mode, schema, surface: `ctx.req.${chain[2]}`, loc: local.loc };
}

function lowerSchemaEncodeJsonBody(sourceFile, node, ctxName, locals, diagnostics) {
  const expr = unwrapExpression(node);
  if (!expr || !ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) {
    diagnostics.push(makeDiagnostic(sourceFile, expr || node, ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchJsonBodySchemaEncodeRequired, 'ctx.fetch json request bodies must use ctx.schema.encode("Schema", ref).', 'Use json: ctx.schema.encode("upstream.Schema", input).', { source: nodeText(sourceFile, expr || node) }));
    return undefined;
  }
  const chain = propertyChain(expr.expression);
  if (!chain || chain.join('.') !== `${ctxName}.schema.encode`) {
    diagnostics.push(makeDiagnostic(sourceFile, expr, ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchJsonBodySchemaEncodeRequired, 'ctx.fetch json request bodies must use ctx.schema.encode("Schema", ref).', 'Use json: ctx.schema.encode("upstream.Schema", input).', { source: nodeText(sourceFile, expr) }));
    return undefined;
  }
  const schemaArg = unwrapExpression(expr.arguments[0]);
  if (!schemaArg || !isStringLiteralLike(schemaArg)) {
    diagnostics.push(makeDiagnostic(sourceFile, schemaArg || expr, ROUTE_HANDLER_EFFECT_DIAGNOSTICS.schemaEncodeDynamicSchemaUnsupported, 'ctx.schema.encode requires a literal schema name for backend JSON request bodies.', 'Use ctx.schema.encode("upstream.Schema", ref).', { source: nodeText(sourceFile, schemaArg || expr) }));
    return undefined;
  }
  const valueArg = unwrapExpression(expr.arguments[1]);
  const source = requestJsonRefForIdentifier(sourceFile, ctxName, locals, valueArg);
  if (!source) {
    diagnostics.push(makeDiagnostic(sourceFile, valueArg || expr, ROUTE_HANDLER_EFFECT_DIAGNOSTICS.schemaEncodeRefRequired, 'ctx.schema.encode backend JSON request bodies require an opaque decode ref value.', 'Pass the ref returned by ctx.req.json("Schema") or another supported opaque schema ref.', { source: nodeText(sourceFile, valueArg || expr) }));
    return { kind: 'schema-encode', mode: 'json', schema: schemaArg.text, source: undefined, loc: sourceLoc(sourceFile, expr) };
  }
  return { kind: 'schema-encode', mode: 'json', schema: schemaArg.text, source, loc: sourceLoc(sourceFile, expr) };
}

function diagnoseReservedRequestBodyProperties(sourceFile, requestArg, diagnostics) {
  const reserved = [
    [['bytes', 'binary'], ROUTE_HANDLER_EFFECT_DIAGNOSTICS.requestBodyBinaryReserved, 'Binary backend request bodies are reserved.'],
    [['stream'], ROUTE_HANDLER_EFFECT_DIAGNOSTICS.requestBodyStreamReserved, 'Stream backend request bodies are reserved.'],
    [['multipart', 'formData', 'form'], ROUTE_HANDLER_EFFECT_DIAGNOSTICS.requestBodyMultipartReserved, 'Multipart/form-data backend request bodies are reserved.'],
    [['body', 'text'], ROUTE_HANDLER_EFFECT_DIAGNOSTICS.backendRequestBodyModeUnsupported, 'Arbitrary backend request body passthrough is not supported.']
  ];
  for (const [keys, code, message] of reserved) {
    for (const key of keys) {
      const node = propertyValue(sourceFile, requestArg, key);
      if (node) diagnostics.push(makeDiagnostic(sourceFile, node, code, message, 'Use json: ctx.schema.encode("Schema", ref) or remove the request body.', { field: key }));
    }
  }
}

function validateBackendPolicy(sourceFile, node, effect, backendPolicies, diagnostics) {
  const policy = effect.backend ? backendPolicies.get(effect.backend) : undefined;
  if (!policy) return;
  const method = String(effect.request.method || '').toUpperCase();
  if (method && Array.isArray(policy.allowedMethods) && !policy.allowedMethods.includes(method)) {
    diagnostics.push(makeDiagnostic(sourceFile, node, ROUTE_HANDLER_EFFECT_DIAGNOSTICS.backendMethodUnsupported, `Backend "${effect.backend}" does not allow method "${method}".`, 'Add the method to backend allowedMethods or use an allowed method.', { backend: effect.backend, method, allowedMethods: policy.allowedMethods }));
  }
  const bodyMode = effect.request.bodyMode || 'none';
  if (Array.isArray(policy.requestBody) && !policy.requestBody.includes(bodyMode)) {
    diagnostics.push(makeDiagnostic(sourceFile, node, ROUTE_HANDLER_EFFECT_DIAGNOSTICS.backendRequestBodyModeUnsupported, `Backend "${effect.backend}" does not allow request body mode "${bodyMode}".`, 'Add the body mode to backend requestBody or remove the request body.', { backend: effect.backend, bodyMode, requestBody: policy.requestBody }));
  }
}

function parseFetchEffect(sourceFile, node, ctxName, locals, diagnostics, effectName, backendPolicies = new Map()) {
  const expr = unwrapExpression(node);
  const chain = expr && ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) ? propertyChain(expr.expression) : undefined;
  if (!expr || !ts.isCallExpression(expr) || !chain || chain.join('.') !== `${ctxName}.fetch`) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      expr || node,
      ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolveEffectUnsupported,
      'ctx.resolve currently accepts only ctx.fetch(...) effects or a static object map of ctx.fetch(...) effects.',
      'Use ctx.resolve(ctx.fetch("backend", { method: "GET", path: "/x" }), afterFetch).',
      { source: nodeText(sourceFile, expr || node) }
    ));
    return undefined;
  }

  const loc = sourceLoc(sourceFile, expr);
  const effect = {
    name: effectName || '$default',
    kind: 'backend-fetch',
    publicSurface: 'ctx.fetch',
    loc,
    backend: undefined,
    request: {
      method: undefined,
      path: undefined,
      headers: [],
      bodyMode: 'none'
    }
  };

  if (expr.arguments.length !== 2) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      expr,
      ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchRequestMustBeObject,
      'ctx.fetch requires exactly a backend key and a request object in the Pass 30 route-effect plan.',
      'Use ctx.fetch("backend", { method: "GET", path: "/x" }).',
      { argCount: expr.arguments.length }
    ));
    return effect;
  }

  const backendArg = unwrapExpression(expr.arguments[0]);
  if (!isStringLiteralLike(backendArg)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      backendArg,
      ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchBackendMustBeLiteral,
      'ctx.fetch backend key must be a string literal in the Pass 30 route-effect plan.',
      'Declare a backend in config and call ctx.fetch("backendKey", requestSpec).',
      { source: nodeText(sourceFile, backendArg) }
    ));
  } else {
    effect.backend = backendArg.text;
  }

  const requestArg = unwrapExpression(expr.arguments[1]);
  if (!ts.isObjectLiteralExpression(requestArg)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      requestArg,
      ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchRequestMustBeObject,
      'ctx.fetch request spec must be a static object literal in the Pass 30 route-effect plan.',
      'Use { method: "GET", path: "/path" } directly in the ctx.fetch call.',
      { source: nodeText(sourceFile, requestArg) }
    ));
    return effect;
  }

  const methodNode = propertyValue(sourceFile, requestArg, 'method');
  if (!methodNode || !isStringLiteralLike(unwrapExpression(methodNode))) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      methodNode || requestArg,
      ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchMethodMustBeLiteral,
      'ctx.fetch request method must be a string literal in the Pass 30 route-effect plan.',
      'Use method: "GET", "HEAD", or "POST" for this MVP pass.',
      { field: 'method' }
    ));
  } else {
    const method = unwrapExpression(methodNode).text.toUpperCase();
    effect.request.method = method;
    if (!ROUTE_HANDLER_EFFECT_ALLOWED_METHODS.includes(method)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        methodNode,
        ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchMethodUnsupported,
        `ctx.fetch method "${method}" is reserved for a later route-effect pass.`,
        `Use one of: ${ROUTE_HANDLER_EFFECT_ALLOWED_METHODS.join(', ')}.`,
        { method, allowed: [...ROUTE_HANDLER_EFFECT_ALLOWED_METHODS] }
      ));
    }
  }

  const pathNode = propertyValue(sourceFile, requestArg, 'path');
  if (!pathNode) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      requestArg,
      ROUTE_HANDLER_EFFECT_DIAGNOSTICS.fetchPathUnsupported,
      'ctx.fetch request spec requires a path field in the Pass 30 route-effect plan.',
      'Use path: "/literal" or string concatenation with ctx.param("name").',
      { field: 'path' }
    ));
  } else {
    effect.request.path = lowerExpressionTree(sourceFile, pathNode, ctxName, locals, diagnostics);
  }

  effect.request.headers = lowerHeaders(sourceFile, propertyValue(sourceFile, requestArg, 'headers'), ctxName, locals, diagnostics);

  const jsonNode = propertyValue(sourceFile, requestArg, 'json');
  if (jsonNode) {
    effect.request.bodyMode = 'json';
    effect.request.json = lowerSchemaEncodeJsonBody(sourceFile, jsonNode, ctxName, locals, diagnostics);
  }
  diagnoseReservedRequestBodyProperties(sourceFile, requestArg, diagnostics);
  validateBackendPolicy(sourceFile, requestArg, effect, backendPolicies, diagnostics);
  return effect;
}

function parseResolveCall(sourceFile, node, ctxName, locals, functionIndex, diagnostics, backendPolicies) {
  const expr = unwrapExpression(node);
  const chain = expr && ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) ? propertyChain(expr.expression) : undefined;
  if (!expr || !ts.isCallExpression(expr) || !chain || chain.join('.') !== `${ctxName}.resolve`) return undefined;

  const resolve = {
    loc: sourceLoc(sourceFile, expr),
    groupShape: undefined,
    continuation: undefined,
    effects: []
  };

  if (expr.arguments.length !== 2) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      expr,
      ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolveEffectUnsupported,
      'ctx.resolve requires an effect/group and a named continuation in the Pass 30 route-effect plan.',
      'Use ctx.resolve(ctx.fetch(...), afterFetch).',
      { argCount: expr.arguments.length }
    ));
    return resolve;
  }

  const effectArg = unwrapExpression(expr.arguments[0]);
  const continuationArg = unwrapExpression(expr.arguments[1]);
  if (!ts.isIdentifier(continuationArg)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      continuationArg,
      ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolveContinuationMustBeTopLevel,
      'ctx.resolve continuation must be a top-level named function in the Pass 30 route-effect plan.',
      'Use ctx.resolve(effect, afterFetch) and define/export function afterFetch(ctx) { ... }.',
      { source: nodeText(sourceFile, continuationArg) }
    ));
  } else {
    const name = continuationArg.text;
    const target = functionIndex.byName.get(name);
    if (!target) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        continuationArg,
        ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolveContinuationMissing,
        `ctx.resolve continuation "${name}" was not found as a top-level function.`,
        'Define a top-level continuation function in the same entry file.',
        { continuation: name }
      ));
    }
    resolve.continuation = {
      name,
      exported: Boolean(target && target.exported),
      loc: target ? target.loc : sourceLoc(sourceFile, continuationArg)
    };
  }

  if (effectArg && ts.isCallExpression(effectArg)) {
    resolve.groupShape = 'single';
    const effect = parseFetchEffect(sourceFile, effectArg, ctxName, locals, diagnostics, '$default', backendPolicies);
    if (effect) resolve.effects.push(effect);
    return resolve;
  }

  if (effectArg && ts.isObjectLiteralExpression(effectArg)) {
    resolve.groupShape = 'named-object';
    for (const prop of effectArg.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        diagnostics.push(makeDiagnostic(
          sourceFile,
          prop,
          ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolveObjectKeyUnsupported,
          'ctx.resolve named effect groups support only static property assignments in the Pass 30 plan.',
          'Use { user: ctx.fetch(...) } with literal property names.',
          { source: nodeText(sourceFile, prop) }
        ));
        continue;
      }
      const name = propertyKey(sourceFile, prop.name);
      if (!name) {
        diagnostics.push(makeDiagnostic(
          sourceFile,
          prop.name,
          ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolveObjectKeyUnsupported,
          'ctx.resolve effect names must be static identifiers or string literals.',
          'Use a literal effect name such as user or "user".',
          { source: nodeText(sourceFile, prop.name) }
        ));
        continue;
      }
      const effect = parseFetchEffect(sourceFile, prop.initializer, ctxName, locals, diagnostics, name, backendPolicies);
      if (effect) resolve.effects.push(effect);
    }
    return resolve;
  }

  if (effectArg && ts.isArrayLiteralExpression(effectArg)) {
    resolve.groupShape = 'array';
    diagnostics.push(makeDiagnostic(
      sourceFile,
      effectArg,
      ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolveArrayGroupReserved,
      'ctx.resolve array effect groups are reserved in Pass 30.',
      'Use a named object group such as { user: ctx.fetch(...), posts: ctx.fetch(...) } so results have stable names.',
      { length: effectArg.elements.length }
    ));
    return resolve;
  }

  diagnostics.push(makeDiagnostic(
    sourceFile,
    effectArg || expr,
    ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolveEffectUnsupported,
    'ctx.resolve effect argument is not lowerable in the Pass 30 route-effect plan.',
    'Use ctx.fetch(...) directly or a static object map of ctx.fetch(...) calls.',
    { source: nodeText(sourceFile, effectArg || expr) }
  ));
  return resolve;
}

function findResolveCalls(sourceFile, node, ctxName, locals, functionIndex, diagnostics, backendPolicies) {
  const resolves = [];
  function walk(n) {
    if (!n) return;
    if (ts.isCallExpression(n)) {
      const parsed = parseResolveCall(sourceFile, n, ctxName, locals, functionIndex, diagnostics, backendPolicies);
      if (parsed) {
        resolves.push(parsed);
        return;
      }
    }
    ts.forEachChild(n, walk);
  }
  if (node?.body) walk(node.body);
  return resolves;
}

function collectContextCalls(sourceFile, node, ctxName) {
  const calls = [];
  function walk(n) {
    if (!n) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const chain = propertyChain(n.expression);
      if (chain && chain[0] === ctxName) {
        calls.push({ surface: `ctx.${chain.slice(1).join('.')}`, target: chain.join('.'), loc: sourceLoc(sourceFile, n) });
      }
    }
    ts.forEachChild(n, walk);
  }
  if (node?.body) walk(node.body);
  return calls;
}

function collectResolvedAccesses(sourceFile, node, ctxName, effectNames, diagnostics) {
  const resolvedLocals = new Map();
  const accesses = [];
  const methods = [];
  const effectNameSet = new Set(effectNames || []);

  function parseResolvedCall(call) {
    const chain = ts.isPropertyAccessExpression(call.expression) ? propertyChain(call.expression) : undefined;
    if (!chain || chain.join('.') !== `${ctxName}.resolved`) return undefined;
    let name = '$default';
    if (call.arguments.length === 1 && isStringLiteralLike(unwrapExpression(call.arguments[0]))) name = unwrapExpression(call.arguments[0]).text;
    else if (call.arguments.length > 0) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        call.arguments[0],
        ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolvedResultUnknownName,
        'ctx.resolved(...) accepts no argument for a single effect or a string literal name for a named effect group.',
        'Use ctx.resolved() or ctx.resolved("user").',
        { source: nodeText(sourceFile, call.arguments[0]) }
      ));
    }
    if (effectNameSet.size > 0 && !effectNameSet.has(name)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        call,
        ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolvedResultUnknownName,
        `ctx.resolved("${name}") does not match a planned effect name.`,
        `Use one of: ${Array.from(effectNameSet).join(', ')}.`,
        { name, known: Array.from(effectNameSet) }
      ));
    }
    return { name, loc: sourceLoc(sourceFile, call) };
  }

  function scanStatement(statement) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const init = unwrapExpression(declaration.initializer);
        if (init && ts.isCallExpression(init)) {
          const resolved = parseResolvedCall(init);
          if (resolved) {
            resolvedLocals.set(declaration.name.text, resolved.name);
            accesses.push({ name: resolved.name, as: declaration.name.text, loc: resolved.loc });
          }
        }
      }
    }
  }

  if (node?.body && ts.isBlock(node.body)) {
    for (const statement of node.body.statements) scanStatement(statement);
  }

  function walk(n) {
    if (!n) return;
    if (ts.isCallExpression(n)) {
      if (ts.isPropertyAccessExpression(n.expression)) {
        const chain = propertyChain(n.expression);
        if (chain && chain.join('.') === `${ctxName}.resolved`) {
          const resolved = parseResolvedCall(n);
          if (resolved) accesses.push({ name: resolved.name, loc: resolved.loc });
          return;
        }
        if (chain && chain.length === 2 && resolvedLocals.has(chain[0])) {
          const method = chain[1];
          const access = { name: resolvedLocals.get(chain[0]), variable: chain[0], method, loc: sourceLoc(sourceFile, n) };
          methods.push(access);
          if (['bytes', 'stream'].includes(method)) {
            diagnostics.push(makeDiagnostic(
              sourceFile,
              n,
              ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolvedResponseModeReserved,
              `Resolved fetch response method ${method}() is reserved in Pass 30.`,
              'Use status(), ok(), header(), text(), jsonText(), or json("Schema") in the lifecycle plan.',
              access
            ));
          }
        }
      }
    }
    ts.forEachChild(n, walk);
  }
  if (node?.body) walk(node.body);
  return { accesses, methods };
}

function routeDisplay(route) {
  return `${route.method || 'ANY'} ${route.path || '/'}`;
}

function buildRouteHandlerEffectPlan(sourceFile, routePlan, handlerTable, inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const diagnostics = [];
  const policy = defaultRouteHandlerEffectPolicy();
  const functions = collectFunctionNodes(sourceFile, cwd);
  const handlersById = handlerById(handlerTable);
  const routes = [];
  const continuationPlans = [];
  const continuationsByName = new Map();
  const backendPolicies = backendPolicyMap(inputs.resolvedConfig);

  for (const route of routePlan?.routes || []) {
    const handler = handlersById.get(route.handler);
    const nodeInfo = handlerNodeFor(handler, functions);
    if (!handler || !nodeInfo) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        undefined,
        ROUTE_HANDLER_EFFECT_DIAGNOSTICS.handlerSourceMissing,
        `Unable to find source for route handler on ${routeDisplay(route)}.`,
        'Route effect planning requires same-file top-level or direct inline route handlers.',
        { route: routeDisplay(route), handlerId: route.handler }
      ));
      routes.push({ routeId: route.stableId, method: route.method, path: route.path, handlerId: route.handler, status: 'error', resolves: [] });
      continue;
    }

    const ctxName = ctxNameForFunction(nodeInfo.node, 'route');
    const locals = scanLocalInitializers(sourceFile, nodeInfo.node, ctxName);
    const resolves = findResolveCalls(sourceFile, nodeInfo.node, ctxName, locals, functions, diagnostics, backendPolicies);
    const contextCalls = collectContextCalls(sourceFile, nodeInfo.node, ctxName);
    const routeEntry = {
      routeId: route.stableId,
      runtimeId: route.runtimeId,
      method: route.method,
      path: route.path,
      handlerId: route.handler,
      handlerName: handler.localName || handler.inlineName || route.handlerName,
      handlerKind: handler.kind,
      inline: Boolean(handler.declaration && handler.declaration.topLevel === false),
      ctxName,
      status: resolves.length > 0 ? 'planned' : 'no-effects',
      contextCalls,
      resolves
    };
    routes.push(routeEntry);

    for (const resolve of resolves) {
      const continuationName = resolve.continuation && resolve.continuation.name;
      if (!continuationName || continuationsByName.has(continuationName)) continue;
      const target = functions.byName.get(continuationName);
      if (!target) continue;
      const continuationCtxName = ctxNameForFunction(target.node, 'route');
      const effectNames = resolve.effects.map((effect) => effect.name);
      const resolved = collectResolvedAccesses(sourceFile, target.node, continuationCtxName, effectNames, diagnostics);
      const plan = {
        name: continuationName,
        exported: Boolean(target.exported),
        kind: target.kind,
        ctxName: continuationCtxName,
        loc: target.loc,
        resultAccesses: resolved.accesses,
        responseMethodCalls: resolved.methods,
        status: 'planned-only'
      };
      continuationsByName.set(continuationName, plan);
      continuationPlans.push(plan);
    }
  }

  const plannedResolves = routes.flatMap((route) => route.resolves || []);
  const plannedEffects = plannedResolves.flatMap((resolve) => resolve.effects || []);
  const artifact = normalizeArtifact({
    version: ROUTE_HANDLER_EFFECT_PLAN_VERSION,
    generatedBy,
    phase: ROUTE_HANDLER_EFFECT_PLAN_PHASE,
    artifact: ROUTE_HANDLER_EFFECT_PLAN_ARTIFACT,
    status: diagnostics.length === 0 ? 'ok' : 'error',
    source: stableFileName(sourceFile.fileName, cwd),
    scope: {
      planOnly: true,
      runtimeBehaviorChanged: false,
      providerBehaviorImplemented: false,
      compiledWasmEffectExecutionImplemented: false
    },
    authoringModel: {
      canonicalResolve: 'ctx.resolve(ctx.fetch("backend", requestSpec), continuation)',
      canonicalNamedGroup: 'ctx.resolve({ name: ctx.fetch("backend", requestSpec) }, continuation)',
      canonicalResultAccess: 'ctx.resolved() / ctx.resolved("name")',
      arrays: 'reserved-with-diagnostic',
      bareDeferKeyword: false,
      asyncAwait: false,
      promises: false
    },
    policy,
    routes,
    continuations: continuationPlans,
    summary: {
      routes: routes.length,
      routesWithEffects: routes.filter((route) => (route.resolves || []).length > 0).length,
      resolveBoundaries: plannedResolves.length,
      effects: plannedEffects.length,
      backendFetchEffects: plannedEffects.filter((effect) => effect.kind === 'backend-fetch').length,
      backendJsonRequestBodyEffects: plannedEffects.filter((effect) => effect.kind === 'backend-fetch' && effect.request && effect.request.bodyMode === 'json').length,
      requestBodyEffects: plannedEffects.filter((effect) => effect.kind === 'backend-fetch' && effect.request && effect.request.bodyMode && effect.request.bodyMode !== 'none').length,
      continuations: continuationPlans.length,
      diagnostics: diagnostics.length,
      providerBehaviorImplemented: false,
      compiledWasmEffectExecutionImplemented: false
    },
    diagnostics
  }, cwd);

  return {
    artifact,
    diagnostics
  };
}

module.exports = {
  buildRouteHandlerEffectPlan,
  collectFunctionNodes,
  lowerExpressionTree
};
