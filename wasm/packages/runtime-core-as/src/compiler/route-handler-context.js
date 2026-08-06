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

function loadHandlerContextContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/handler/context');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/handler/context.js');
    }
    throw error;
  }
}

const { PACKAGE_VERSION, normalizeArtifact, sourceLoc, stableFileName } = loadContractsDiagnostics();
const {
  ROUTE_HANDLER_CONTEXT_LOWERING_VERSION,
  ROUTE_HANDLER_CONTEXT_LOWERING_PHASE,
  ROUTE_HANDLER_CONTEXT_LOWERING_ARTIFACT,
  ROUTE_HANDLER_CONTEXT_CONTRACT_ID,
  ROUTE_HANDLER_CONTEXT_SYNC_SURFACE,
  ROUTE_HANDLER_CONTEXT_RESERVED_SURFACE,
  ROUTE_HANDLER_CONTEXT_EXPRESSION_SUBSET,
  ROUTE_HANDLER_CONTEXT_DIAGNOSTICS,
  defaultRouteHandlerContextLoweringPolicy
} = loadHandlerContextContracts();

function nodeText(sourceFile, node) {
  return node ? node.getText(sourceFile).trim() : '';
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers && node.modifiers.some((modifier) => modifier.kind === kind));
}

function isExported(node) {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
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

function isStringLiteralLike(node) {
  return Boolean(node && (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral));
}

function collectFunctionNodes(sourceFile, cwd) {
  const byName = new Map();
  const byOffset = new Map();

  function record(name, node, declaration, kind, exported) {
    const loc = sourceLoc(sourceFile, declaration || node);
    const functionLoc = sourceLoc(sourceFile, node);
    const info = {
      name,
      node,
      declaration,
      kind,
      exported: Boolean(exported),
      loc,
      functionLoc,
      file: stableFileName(sourceFile.fileName, cwd)
    };
    if (name) byName.set(name, info);
    const offset = functionLoc && functionLoc.start && functionLoc.start.offset;
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
  for (const handler of handlerTable?.handlers || []) map.set(handler.id, handler);
  return map;
}

function handlerNodeFor(handler, functionIndex) {
  if (!handler) return undefined;
  if (handler.localName && functionIndex.byName.has(handler.localName)) return functionIndex.byName.get(handler.localName);
  const offset = handler.loc && handler.loc.start && handler.loc.start.offset;
  if (typeof offset === 'number' && functionIndex.byOffset.has(offset)) return functionIndex.byOffset.get(offset);
  return undefined;
}

function ctxNameFor(node, role) {
  const params = Array.from(node?.parameters || []);
  if (role === 'error') {
    const param = params[1];
    return param && ts.isIdentifier(param.name) ? param.name.text : 'ctx';
  }
  const param = params[0];
  return param && ts.isIdentifier(param.name) ? param.name.text : 'ctx';
}

function makeDiagnostic(sourceFile, node, code, severity, message, hint, details) {
  const diagnostic = {
    phase: 'route-handler-context-lowering',
    severity,
    code,
    message,
    hint,
    loc: node ? sourceLoc(sourceFile, node) : { file: stableFileName(sourceFile.fileName, process.cwd()) }
  };
  if (details !== undefined) diagnostic.details = details;
  return diagnostic;
}

function recordSurface(metrics, surface, node, sourceFile) {
  metrics.contextCalls.push({ surface, text: nodeText(sourceFile, node), loc: sourceLoc(sourceFile, node) });
  metrics.surfaces.set(surface, (metrics.surfaces.get(surface) || 0) + 1);
}

function inferExpressionType(node) {
  if (!node) return undefined;
  if (isStringLiteralLike(node)) return 'string';
  if (ts.isNumericLiteral(node)) return 'number';
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return 'boolean';
  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.ExclamationToken) return 'boolean';
    if (node.operator === ts.SyntaxKind.MinusToken) return 'number';
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.LessThanToken ||
      op === ts.SyntaxKind.LessThanEqualsToken ||
      op === ts.SyntaxKind.GreaterThanToken ||
      op === ts.SyntaxKind.GreaterThanEqualsToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken
    ) return 'boolean';
    if (op === ts.SyntaxKind.PlusToken) return 'string-or-number';
    if (op === ts.SyntaxKind.MinusToken || op === ts.SyntaxKind.AsteriskToken || op === ts.SyntaxKind.SlashToken || op === ts.SyntaxKind.PercentToken) return 'number';
  }
  if (ts.isCallExpression(node)) {
    const chain = ts.isPropertyAccessExpression(node.expression) ? propertyChain(node.expression) : undefined;
    const tail = chain ? chain[chain.length - 1] : undefined;
    const joined = chain ? chain.join('.') : '';
    if (tail === 'param' || tail === 'method' || tail === 'path' || tail === 'first' || tail === 'at') return 'string';
    if (tail === 'paramI32' || tail === 'count') return 'i32';
    if (tail === 'error') return 'usize';
    if (joined.endsWith('.result.text') || joined.endsWith('.result.jsonText') || joined.endsWith('.result.empty')) return 'void';
  }
  return undefined;
}

function scanExpression(sourceFile, node, ctxName, nextName, metrics, diagnostics) {
  if (!node) return;
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && callee.text === nextName) {
      recordSurface(metrics, node.arguments.length === 0 ? 'next' : 'next(error)', node, sourceFile);
    }
    const chain = ts.isPropertyAccessExpression(callee) ? propertyChain(callee) : undefined;
    const joined = chain ? chain.join('.') : '';
    if (joined === `${ctxName}.param` && node.arguments.length === 1 && isStringLiteralLike(node.arguments[0])) recordSurface(metrics, 'ctx.param', node, sourceFile);
    else if (joined === `${ctxName}.paramI32` && node.arguments.length === 1 && isStringLiteralLike(node.arguments[0])) recordSurface(metrics, 'ctx.paramI32', node, sourceFile);
    else if (joined === `${ctxName}.request.method` && node.arguments.length === 0) recordSurface(metrics, 'ctx.request.method', node, sourceFile);
    else if (joined === `${ctxName}.request.path` && node.arguments.length === 0) recordSurface(metrics, 'ctx.request.path', node, sourceFile);
    else if (joined === `${ctxName}.request.header.first`) recordSurface(metrics, 'ctx.request.header.first', node, sourceFile);
    else if (joined === `${ctxName}.request.header.count`) recordSurface(metrics, 'ctx.request.header.count', node, sourceFile);
    else if (joined === `${ctxName}.request.header.at`) recordSurface(metrics, 'ctx.request.header.at', node, sourceFile);
    else if (joined === `${ctxName}.response.header.set`) recordSurface(metrics, 'ctx.response.header.set', node, sourceFile);
    else if (joined === `${ctxName}.response.header.append`) recordSurface(metrics, 'ctx.response.header.append', node, sourceFile);
    else if (joined === `${ctxName}.response.header.delete`) recordSurface(metrics, 'ctx.response.header.delete', node, sourceFile);
    else if (joined === `${ctxName}.result.text`) recordSurface(metrics, 'ctx.result.text', node, sourceFile);
    else if (joined === `${ctxName}.result.jsonText`) recordSurface(metrics, 'ctx.result.jsonText', node, sourceFile);
    else if (joined === `${ctxName}.result.empty`) recordSurface(metrics, 'ctx.result.empty', node, sourceFile);
    else if (joined === `${ctxName}.error`) recordSurface(metrics, 'ctx.error', node, sourceFile);
    else if (joined === `${ctxName}.fetch` || joined === `${ctxName}.resolve` || joined === `${ctxName}.resolved` || joined === `${ctxName}.bodyText`) {
      metrics.reservedCalls.push({ surface: joined.replace(`${ctxName}.`, 'ctx.'), text: nodeText(sourceFile, node), loc: sourceLoc(sourceFile, node) });
      diagnostics.push(makeDiagnostic(
        sourceFile,
        node,
        ROUTE_HANDLER_CONTEXT_DIAGNOSTICS.effectBoundaryReserved,
        'info',
        `${joined.replace(`${ctxName}.`, 'ctx.')} crosses the reserved effect boundary for Pass 31 sync context lowering.`,
        'Use route-handler-effect-plan for ctx.resolve/ctx.fetch planning; provider execution remains future work.',
        { surface: joined.replace(`${ctxName}.`, 'ctx.') }
      ));
    }
  }
  ts.forEachChild(node, (child) => scanExpression(sourceFile, child, ctxName, nextName, metrics, diagnostics));
}

function scanStatement(sourceFile, statement, ctxName, nextName, metrics, diagnostics) {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        metrics.unsupportedSyntax.push('destructuring');
        continue;
      }
      metrics.locals.push({
        name: declaration.name.text,
        declarationKind: (statement.declarationList.flags & ts.NodeFlags.Const) ? 'const' : 'let',
        valueType: inferExpressionType(declaration.initializer),
        text: nodeText(sourceFile, declaration),
        loc: sourceLoc(sourceFile, declaration.name)
      });
    }
  }
  if (ts.isIfStatement(statement)) {
    metrics.ifStatements += 1;
    metrics.statements.push({ kind: 'if', text: nodeText(sourceFile, statement.expression), loc: sourceLoc(sourceFile, statement) });
  } else if (ts.isReturnStatement(statement)) {
    metrics.statements.push({ kind: 'return', text: nodeText(sourceFile, statement), loc: sourceLoc(sourceFile, statement) });
  } else if (ts.isExpressionStatement(statement)) {
    metrics.statements.push({ kind: 'expression', text: nodeText(sourceFile, statement), loc: sourceLoc(sourceFile, statement) });
  } else if (ts.isVariableStatement(statement)) {
    metrics.statements.push({ kind: 'local', text: nodeText(sourceFile, statement), loc: sourceLoc(sourceFile, statement) });
  }
  if (ts.isForStatement(statement) || ts.isForOfStatement(statement) || ts.isForInStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    metrics.unsupportedSyntax.push('loop');
    diagnostics.push(makeDiagnostic(sourceFile, statement, ROUTE_HANDLER_CONTEXT_DIAGNOSTICS.loopUnsupported, 'warning', 'Loops are outside the Pass 31 AS-clean handler subset.', 'Use simple straight-line or if/else context handling for now.'));
  }
  if (ts.isTryStatement(statement) || ts.isThrowStatement(statement)) {
    metrics.unsupportedSyntax.push('try/throw');
    diagnostics.push(makeDiagnostic(sourceFile, statement, ROUTE_HANDLER_CONTEXT_DIAGNOSTICS.throwUnsupported, 'warning', 'try/catch/throw are outside the Pass 31 AS-clean handler subset.', 'Use next(ctx.error(...)) for now.'));
  }
  scanExpression(sourceFile, statement, ctxName, nextName, metrics, diagnostics);
}

function nextNameFor(node, role) {
  const params = Array.from(node?.parameters || []);
  if (role === 'channel') return 'next';
  if (role === 'error') {
    const param = params[2];
    return param && ts.isIdentifier(param.name) ? param.name.text : 'next';
  }
  const param = params[1];
  return param && ts.isIdentifier(param.name) ? param.name.text : 'next';
}

function scanHandler(sourceFile, handler, nodeInfo, role) {
  const diagnostics = [];
  const metrics = { contextCalls: [], reservedCalls: [], surfaces: new Map(), ifStatements: 0, unsupportedSyntax: [], locals: [], statements: [] };
  if (!nodeInfo?.node) {
    diagnostics.push({ phase: 'route-handler-context-lowering', severity: 'error', code: ROUTE_HANDLER_CONTEXT_DIAGNOSTICS.handlerSourceMissing, message: `Handler source for ${handler.localName || handler.id} was not found.`, hint: 'Use top-level exported handlers or keep inline handlers visible to the extractor.', loc: handler.loc });
    return { diagnostics, metrics, ctxName: 'ctx', nextName: 'next' };
  }
  const ctxName = ctxNameFor(nodeInfo.node, role);
  const nextName = nextNameFor(nodeInfo.node, role);
  if (nodeInfo.node.body && ts.isBlock(nodeInfo.node.body)) {
    for (const statement of nodeInfo.node.body.statements) scanStatement(sourceFile, statement, ctxName, nextName, metrics, diagnostics);
  } else if (nodeInfo.node.body) {
    scanExpression(sourceFile, nodeInfo.node.body, ctxName, nextName, metrics, diagnostics);
  }
  return { diagnostics, metrics, ctxName, nextName };
}

function routeHandlerUses(route) {
  const uses = [];
  if (route.handler) uses.push({ role: 'route', handlerId: route.handler, name: route.handlerName });
  for (let i = 0; i < (route.middleware || []).length; i += 1) uses.push({ role: 'middleware', handlerId: route.middleware[i], name: (route.middlewareNames || [])[i] });
  for (let i = 0; i < (route.errorHandlers || []).length; i += 1) uses.push({ role: 'error', handlerId: route.errorHandlers[i], name: (route.errorHandlerNames || [])[i] });
  for (let i = 0; i < (route.connectHandlers || []).length; i += 1) uses.push({ role: 'lifecycle', handlerId: route.connectHandlers[i], name: (route.connectHandlerNames || [])[i] });
  for (let i = 0; i < (route.disconnectHandlers || []).length; i += 1) uses.push({ role: 'lifecycle', handlerId: route.disconnectHandlers[i], name: (route.disconnectHandlerNames || [])[i] });
  if (route.channel?.value) uses.push({ role: 'channel', handlerId: route.channel.value, name: route.channel.name });
  return uses;
}

function buildRouteHandlerContextLoweringPlan(sourceFile, routePlan, handlerTable, options = {}) {
  const cwd = options.cwd || process.cwd();
  const functionIndex = collectFunctionNodes(sourceFile, cwd);
  const handlersById = handlerById(handlerTable);
  const diagnostics = [];
  const seenHandlers = new Map();
  const routeEntries = [];

  for (const route of routePlan?.routes || []) {
    const uses = [];
    for (const use of routeHandlerUses(route)) {
      const handler = handlersById.get(use.handlerId);
      const nodeInfo = handlerNodeFor(handler, functionIndex);
      const key = `${use.role}:${use.handlerId}`;
      let scanned = seenHandlers.get(key);
      if (!scanned) {
        const result = scanHandler(sourceFile, handler || use, nodeInfo, use.role);
        diagnostics.push(...result.diagnostics);
        scanned = {
          id: use.handlerId,
          name: use.name || handler?.localName || handler?.exportName,
          exportName: handler?.exportName,
          role: use.role,
          sourceKind: nodeInfo?.kind,
          exported: Boolean(nodeInfo?.exported || handler?.declaration?.exported),
          ctxName: result.ctxName,
          nextName: result.nextName,
          contextCalls: result.metrics.contextCalls,
          contextCallSurfaces: result.metrics.contextCalls.map((call) => call.surface),
          reservedCalls: result.metrics.reservedCalls,
          locals: result.metrics.locals,
          statements: result.metrics.statements,
          ifStatements: result.metrics.ifStatements,
          unsupportedSyntax: Array.from(new Set(result.metrics.unsupportedSyntax)),
          diagnostics: result.diagnostics.map((entry) => entry.code)
        };
        seenHandlers.set(key, scanned);
      }
      uses.push(scanned);
    }
    const primary = uses.find((entry) => entry.role === 'route') || uses[0];
    const routeDiagnostics = uses.flatMap((entry) => entry.diagnostics || []);
    const reservedEffectCount = uses.reduce((count, entry) => count + (entry.reservedCalls || []).length, 0);
    const errorCount = routeDiagnostics.filter((code) => code === ROUTE_HANDLER_CONTEXT_DIAGNOSTICS.handlerSourceMissing).length;
    routeEntries.push({
      routeId: route.stableId || route.id,
      method: route.method,
      path: route.path,
      status: errorCount > 0 ? 'error' : (reservedEffectCount > 0 ? 'reserved-effect-boundary' : 'sync-lowerable'),
      contextCalls: primary ? primary.contextCalls : [],
      contextCallSurfaces: primary ? primary.contextCallSurfaces : [],
      reservedCalls: primary ? primary.reservedCalls : [],
      locals: primary ? primary.locals : [],
      statements: primary ? primary.statements : [],
      ifStatements: primary ? primary.ifStatements : 0,
      diagnostics: routeDiagnostics,
      handlers: uses.map((entry) => ({ id: entry.id, name: entry.name, role: entry.role, contextCallSurfaces: entry.contextCallSurfaces, reservedCalls: entry.reservedCalls.map((call) => call.surface), ifStatements: entry.ifStatements, diagnostics: entry.diagnostics }))
    });
  }

  const handlers = Array.from(seenHandlers.values());
  const surfaceCounts = new Map();
  for (const handler of handlers) {
    for (const surface of handler.contextCallSurfaces) surfaceCounts.set(surface, (surfaceCounts.get(surface) || 0) + 1);
  }
  const errorCount = diagnostics.filter((entry) => (entry.severity || 'error') === 'error').length;
  const warningCount = diagnostics.filter((entry) => (entry.severity || 'error') === 'warning').length;
  const infoCount = diagnostics.filter((entry) => (entry.severity || 'error') === 'info').length;

  const policy = defaultRouteHandlerContextLoweringPolicy();
  const artifact = normalizeArtifact({
    version: ROUTE_HANDLER_CONTEXT_LOWERING_VERSION,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    status: errorCount > 0 ? 'error' : 'ok',
    phase: ROUTE_HANDLER_CONTEXT_LOWERING_PHASE,
    artifact: ROUTE_HANDLER_CONTEXT_LOWERING_ARTIFACT,
    contractId: ROUTE_HANDLER_CONTEXT_CONTRACT_ID,
    validateAndPlanOnly: false,
    compiledSyncLoweringImplemented: true,
    runtimeBehaviorImplemented: true,
    providerBehaviorImplemented: false,
    effectExecutionImplemented: false,
    scope: {
      syncContextLowering: true,
      compiledSyncLoweringImplemented: true,
      runtimeBehaviorChanged: true,
      providerBehaviorImplemented: false,
      effectExecutionImplemented: false
    },
    authoringModel: {
      asyncAwait: false,
      promises: false,
      asyncify: false,
      closureCapture: false,
      bareDeferKeyword: false
    },
    policy,
    supportedSurface: [...ROUTE_HANDLER_CONTEXT_SYNC_SURFACE],
    syncSurface: [...ROUTE_HANDLER_CONTEXT_SYNC_SURFACE],
    reservedSurface: [...ROUTE_HANDLER_CONTEXT_RESERVED_SURFACE],
    expressionSubset: JSON.parse(JSON.stringify(ROUTE_HANDLER_CONTEXT_EXPRESSION_SUBSET)),
    routes: routeEntries,
    handlers,
    diagnostics,
    summary: {
      routes: routeEntries.length,
      handlers: handlers.length,
      syncLowerable: routeEntries.filter((route) => route.status === 'sync-lowerable').length,
      contextCalls: handlers.reduce((count, entry) => count + entry.contextCalls.length, 0),
      surfaces: Array.from(surfaceCounts.entries()).map(([surface, count]) => ({ surface, count })).sort((a, b) => a.surface.localeCompare(b.surface)),
      requestMethodCalls: surfaceCounts.get('ctx.request.method') || 0,
      requestPathCalls: surfaceCounts.get('ctx.request.path') || 0,
      ifStatements: handlers.reduce((count, entry) => count + entry.ifStatements, 0),
      effectBoundaries: handlers.reduce((count, entry) => count + entry.reservedCalls.length, 0),
      reservedEffectCalls: handlers.reduce((count, entry) => count + entry.reservedCalls.length, 0),
      providerBehaviorImplemented: false,
      effectExecutionImplemented: false,
      diagnostics: diagnostics.length,
      infos: infoCount,
      warnings: warningCount,
      errors: errorCount
    }
  }, cwd);

  return { artifact, diagnostics };
}

module.exports = {
  buildRouteHandlerContextPlan: buildRouteHandlerContextLoweringPlan,
  buildRouteHandlerContextLoweringPlan
};
