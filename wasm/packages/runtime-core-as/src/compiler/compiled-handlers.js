'use strict';

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

function loadRequestJsonBodyContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/handler/request-json-body');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/handler/request-json-body.js');
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

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultArtifactsDir } = require('@pulse-compute/wasm-build-support/artifacts-dir');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const { PACKAGE_VERSION, normalizeArtifact, sourceLoc, stableFileName } = loadContractsDiagnostics();
const {
  ROUTE_HANDLER_CONTEXT_LOWERING_VERSION,
  ROUTE_HANDLER_CONTEXT_LOWERING_PHASE,
  ROUTE_HANDLER_CONTEXT_LOWERING_ARTIFACT,
  ROUTE_HANDLER_CONTEXT_SYNC_SURFACE,
  ROUTE_HANDLER_CONTEXT_RESERVED_SURFACE,
  ROUTE_HANDLER_CONTEXT_EXPRESSION_SUBSET,
  ROUTE_HANDLER_CONTEXT_DIAGNOSTICS,
  defaultRouteHandlerContextLoweringPolicy
} = loadHandlerContextContracts();
const {
  ROUTE_HANDLER_EFFECT_DIAGNOSTICS = {}
} = loadHandlerEffectContracts();
const {
  REQUEST_JSON_BODY_DIAGNOSTICS = {}
} = loadRequestJsonBodyContracts();
const { resolveAsc } = require('@pulse-compute/wasm-build-support/assemblyscript-compile');

const COMPILED_HANDLER_PLAN_VERSION = 'pulsewasm.compiled-handler-plan.v2';
const HANDLER_LOWERING_REPORT_VERSION = 'pulsewasm.handler-lowering-report.v2';
const COMPILED_HANDLER_SMOKE_VERSION = 'pulsewasm.compiled-handler-smoke.v2';
const COMPILED_HANDLER_HARDENING_VERSION = 'pulsewasm.compiled-handler-hardening.v1';

function sha256Text(text) { return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex'); }
function sha256Buffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function makeFile(file, text) { return { file, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Text(text), text }; }
function asString(value) { return JSON.stringify(String(value ?? '')); }
function safeIdentifier(value, fallback = 'handler') {
  const raw = String(value || fallback).replace(/[^A-Za-z0-9_$]/g, '_');
  const cleaned = raw.length > 0 ? raw : fallback;
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;
}
function hasModifier(node, kind) { return Boolean(node.modifiers && node.modifiers.some((m) => m.kind === kind)); }
function nodeText(sourceFile, node) { return node.getText(sourceFile).trim(); }
function isStringLiteralLike(node) { return ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral; }
function isNumberLiteralLike(node) { return ts.isNumericLiteral(node); }
function isExported(node) { return hasModifier(node, ts.SyntaxKind.ExportKeyword); }
function stripAnsi(value) { return String(value || '').replace(/\u001b\[[0-9;]*m/g, ''); }
function truncate(value, max = 20000) { const text = String(value || ''); return text.length <= max ? text : `${text.slice(0,max)}\n... <truncated ${text.length-max} chars>`; }
function parseAscWarnings(stderr) {
  const text = stripAnsi(stderr); const warnings = [];
  const regex = /WARNING\s+(AS\d+):\s+([^\n]+)(?:.|\n)*?in ([^\n]+)\((\d+),(\d+)\)/g; let match;
  while ((match = regex.exec(text))) warnings.push({ code: match[1], message: match[2].trim(), file: match[3], line: Number(match[4]), column: Number(match[5]) });
  if (warnings.length === 0 && /WARNING\s+AS\d+:/m.test(text)) warnings.push({ code: 'AS_WARNING', message: 'AssemblyScript emitted one or more warnings. Inspect stderr.' });
  return warnings;
}
function assemblyScriptVersion(cwd) {
  try { const packageJson = require.resolve('assemblyscript/package.json', { paths: [cwd] }); return JSON.parse(fs.readFileSync(packageJson, 'utf8')).version; } catch (_) { return undefined; }
}
function fileRecord(filePath, cwd, kind) { const buffer = fs.readFileSync(filePath); return { file: path.relative(cwd, filePath).replace(/\\/g, '/'), kind, bytes: buffer.length, sha256: sha256Buffer(buffer) }; }

function collectHandlerNodes(sourceFile) {
  const map = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      map.set(statement.name.text, { node: statement, declaration: statement, exported: isExported(statement), kind: 'function-declaration' });
    } else if (ts.isVariableStatement(statement)) {
      const exported = isExported(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const init = declaration.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          map.set(declaration.name.text, { node: init, declaration, exported, kind: ts.isArrowFunction(init) ? 'const-arrow' : 'const-function-expression' });
        }
      }
    }
  }
  return map;
}

function propertyChain(node) {
  const parts = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current)) { parts.unshift(current.name.text); current = current.expression; }
  if (ts.isIdentifier(current)) parts.unshift(current.text);
  else return undefined;
  return parts;
}


function normalizeRouteEffectPlan(input) {
  if (!input) return { routes: [] };
  if (input.artifact && Array.isArray(input.artifact.routes)) return input.artifact;
  if (Array.isArray(input.routes)) return input;
  return { routes: [] };
}


function normalizeRequestJsonBodyPlan(input) {
  if (!input) return { routes: [] };
  if (input.artifact && Array.isArray(input.artifact.routes)) return input.artifact;
  if (Array.isArray(input.routes)) return input;
  return { routes: [] };
}

function plannedEffectRoutes(input) {
  const plan = normalizeRouteEffectPlan(input);
  return (Array.isArray(plan.routes) ? plan.routes : [])
    .filter((route) => Array.isArray(route.resolves) && route.resolves.length > 0);
}
function routeHasJsonBackendRequestBody(route) {
  return Array.isArray(route && route.resolves) && route.resolves.some((resolve) => Array.isArray(resolve.effects) && resolve.effects.some((effect) => effect && effect.kind === 'backend-fetch' && effect.request && (effect.request.bodyMode === 'json' || effect.request.json)));
}
function sampleJsonBodyForRoute(route) {
  return '{"id":"compiled-created","name":"Compiled Created User","active":true}';
}

function methodCodeExpression(method) {
  const normalized = String(method || 'GET').toUpperCase();
  if (normalized === 'POST') return 'METHOD_POST';
  if (normalized === 'HEAD') return 'METHOD_HEAD';
  return 'METHOD_GET';
}

function sampleRoutePath(route) {
  const raw = String(route && route.path || '/');
  return raw.replace(/:([A-Za-z_$][A-Za-z0-9_$]*)/g, 'abc');
}

function routeEffectPlanIndex(input) {
  const plan = normalizeRouteEffectPlan(input);
  const routesByHandler = new Map();
  const continuationsByName = new Map();
  const continuationNames = new Set();
  for (const route of Array.isArray(plan.routes) ? plan.routes : []) {
    if (route && route.handlerName) routesByHandler.set(route.handlerName, route);
    for (const resolve of Array.isArray(route?.resolves) ? route.resolves : []) {
      const name = resolve?.continuation?.name;
      if (name) {
        continuationNames.add(name);
        continuationsByName.set(name, { route, resolve, continuation: resolve.continuation });
      }
    }
  }
  return { plan, routesByHandler, continuationsByName, continuationNames };
}

function propertyKeyText(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node)) return node.text;
  if (isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function routeResolveForContext(context) {
  const resolves = Array.isArray(context.routeEffectRoute?.resolves) ? context.routeEffectRoute.resolves : [];
  return resolves[context.resolveLoweringIndex || 0];
}

function resolvedNameFromCtxResolvedCall(node, ctxName) {
  const expr = unwrapExpression(node);
  if (!expr || !ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) return undefined;
  const chain = propertyChain(expr.expression) || [];
  if (chain.join('.') !== `${ctxName}.resolved`) return undefined;
  if (expr.arguments.length === 0) return '$default';
  if (expr.arguments.length === 1 && isStringLiteralLike(unwrapExpression(expr.arguments[0]))) return unwrapExpression(expr.arguments[0]).text;
  return undefined;
}


function requestJsonRefFromCtxCall(node, ctxName) {
  const expr = unwrapExpression(node);
  if (!expr || !ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) return undefined;
  const chain = propertyChain(expr.expression) || [];
  const joined = chain.join('.');
  if (!(joined === `${ctxName}.req.json` || joined === `${ctxName}.request.json` || joined === `${ctxName}.req.parse`)) return undefined;
  if (expr.arguments.length > 1) return undefined;
  const first = expr.arguments.length === 1 ? unwrapExpression(expr.arguments[0]) : undefined;
  if (first && !isStringLiteralLike(first)) return { status: 'error', schema: undefined, mode: 'invalid' };
  const schema = first ? first.text : '';
  return { status: 'ok', schema, mode: schema ? 'schemaJson' : 'genericJson', surface: joined.replace(`${ctxName}.`, 'ctx.') };
}


function resultHeaderStatementsFromOptions(sourceFile, optionsNode, diagnostics, context) {
  const expr = unwrapExpression(optionsNode);
  if (!expr || !ts.isObjectLiteralExpression(expr)) return [];
  const statements = [];
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = propertyKeyText(prop.name);
    if (key !== 'headers') continue;
    const headers = unwrapExpression(prop.initializer);
    if (!headers || !ts.isObjectLiteralExpression(headers)) continue;
    for (const headerProp of headers.properties) {
      if (!ts.isPropertyAssignment(headerProp)) continue;
      const headerName = propertyKeyText(headerProp.name);
      if (!headerName) {
        diagnostics.push(makeDiagnostic(sourceFile, headerProp, 'PULSEWASM_COMPILED_RESULT_HEADER_DYNAMIC_UNSUPPORTED', 'Dynamic response header names are not supported in compiled handler result options.', 'Use literal header names.'));
        continue;
      }
      statements.push(`pulse_response_header_set_compiled(${context.ctxName}, ${asString(headerName)}, ${lowerExpression(sourceFile, headerProp.initializer, diagnostics, context)})`);
    }
  }
  return statements;
}

function resultStatusExpressionFromOptions(sourceFile, optionsNode, diagnostics, context, fallback = '200') {
  const expr = unwrapExpression(optionsNode);
  if (!expr || !ts.isObjectLiteralExpression(expr)) return fallback;
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = propertyKeyText(prop.name);
    if (key === 'status') return lowerExpression(sourceFile, prop.initializer, diagnostics, context);
  }
  return fallback;
}

function resolvedJsonRefFromCall(node, context) {
  const expr = unwrapExpression(node);
  if (!expr || !ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) return undefined;
  const chain = propertyChain(expr.expression);
  if (!chain || chain.length !== 2 || chain[1] !== 'json') return undefined;
  if (!context.resolvedLocals || !context.resolvedLocals.has(chain[0])) return undefined;
  const schema = expr.arguments.length > 0 && isStringLiteralLike(unwrapExpression(expr.arguments[0])) ? unwrapExpression(expr.arguments[0]).text : '';
  return { local: chain[0], resolvedName: context.resolvedLocals.get(chain[0]), schema };
}

function schemaJsonTextExpression(sourceFile, node, diagnostics, context) {
  const expr = unwrapExpression(node);
  if (expr && ts.isIdentifier(expr)) {
    if (context.requestJsonLocals && context.requestJsonLocals.has(expr.text)) return `pulse_request_json_text_compiled(${context.ctxName}, ${expr.text})`;
    if (context.resolvedJsonLocals && context.resolvedJsonLocals.has(expr.text)) {
      const resolvedName = context.resolvedJsonLocals.get(expr.text);
      return `pulse_resolved_json_text_compiled(${context.ctxName}, ${asString(resolvedName)})`;
    }
  }
  const resolvedJson = resolvedJsonRefFromCall(expr, context);
  if (resolvedJson) return `pulse_resolved_json_text_compiled(${context.ctxName}, ${asString(resolvedJson.resolvedName)})`;
  diagnostics.push(makeDiagnostic(sourceFile, node, 'PULSEWASM_SCHEMA_RESPONSE_RESULT_JSON_VALUE_UNSUPPORTED', 'ctx.result.json currently accepts opaque request/response JSON refs only.', 'Pass a ref from ctx.req.json("Schema") or ctx.resolved(...).json("Schema").'));
  return "''";
}

function lowerPlannedResolveCall(sourceFile, node, diagnostics, context) {
  if (!context.allowRouteEffects) {
    diagnostics.push(makeDiagnostic(sourceFile, node, ROUTE_HANDLER_CONTEXT_DIAGNOSTICS.effectBoundaryReserved, 'ctx.resolve is only available when route-effect lowering is enabled.', 'Use the route-effect plan/bridge feature.'));
    return '0';
  }
  const resolve = routeResolveForContext(context);
  if (!resolve) {
    diagnostics.push(makeDiagnostic(sourceFile, node, ROUTE_HANDLER_EFFECT_DIAGNOSTICS.resolveNotReturned || 'PULSEWASM_ROUTE_EFFECT_RESOLVE_NOT_PLANNED', 'ctx.resolve has no matching planned route-effect boundary.', 'Use ctx.resolve(ctx.fetch(...), top-level continuation) with static fetch arguments.'));
    return '0';
  }
  const boundaryIndex = context.resolveLoweringIndex || 0;
  context.resolveLoweringIndex = boundaryIndex + 1;
  recordContextCall(context, 'ctx.resolve', node, sourceFile);
  recordOutcome(context, sourceFile, node, diagnostics, 'resolve');
  return `pulse_result_resolve_compiled(${context.ctxName}, ${boundaryIndex})`;
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current)) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function lowerBinaryOperator(kind) {
  if (kind === ts.SyntaxKind.PlusToken) return '+';
  if (kind === ts.SyntaxKind.MinusToken) return '-';
  if (kind === ts.SyntaxKind.AsteriskToken) return '*';
  if (kind === ts.SyntaxKind.SlashToken) return '/';
  if (kind === ts.SyntaxKind.PercentToken) return '%';
  if (kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsToken) return '==';
  if (kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsToken) return '!=';
  if (kind === ts.SyntaxKind.LessThanToken) return '<';
  if (kind === ts.SyntaxKind.LessThanEqualsToken) return '<=';
  if (kind === ts.SyntaxKind.GreaterThanToken) return '>';
  if (kind === ts.SyntaxKind.GreaterThanEqualsToken) return '>=';
  if (kind === ts.SyntaxKind.AmpersandAmpersandToken) return '&&';
  if (kind === ts.SyntaxKind.BarBarToken) return '||';
  return undefined;
}

function isBooleanBinaryOperator(kind) {
  return kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken ||
    kind === ts.SyntaxKind.LessThanToken ||
    kind === ts.SyntaxKind.LessThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanToken ||
    kind === ts.SyntaxKind.GreaterThanEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken;
}

function recordContextCall(context, surface, node, sourceFile) {
  if (!context.metrics) return;
  context.metrics.contextCalls.push({ surface, text: nodeText(sourceFile, node), loc: sourceLoc(sourceFile, node) });
}

function lowerLiteral(sourceFile, node, diagnostics, context) {
  const expr = unwrapExpression(node);
  if (!expr) return '0';
  if (isStringLiteralLike(expr)) return asString(expr.text);
  if (isNumberLiteralLike(expr)) return expr.text.includes('.') ? expr.text : `${Number(expr.text) | 0}`;
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPrefixUnaryExpression(expr)) {
    if (expr.operator === ts.SyntaxKind.ExclamationToken) return `!(${lowerExpression(sourceFile, expr.operand, diagnostics, context)})`;
    if (expr.operator === ts.SyntaxKind.MinusToken) return `-(${lowerExpression(sourceFile, expr.operand, diagnostics, context)})`;
  }
  if (ts.isBinaryExpression(expr)) {
    const op = lowerBinaryOperator(expr.operatorToken.kind);
    if (op) return `(${lowerExpression(sourceFile, expr.left, diagnostics, context)} ${op} ${lowerExpression(sourceFile, expr.right, diagnostics, context)})`;
  }
  if (ts.isCallExpression(expr)) return lowerCallExpression(sourceFile, expr, diagnostics, context, { expression: true });
  diagnostics.push(makeDiagnostic(
    sourceFile,
    expr,
    ROUTE_HANDLER_CONTEXT_DIAGNOSTICS.unsupportedExpression,
    `Expression "${nodeText(sourceFile,expr)}" is not supported in Pass 31 compiled context handlers.`,
    'Use AS-clean literals, identifiers, primitive operators, and the supported ctx context surface.'
  ));
  return '/* unsupported */ 0';
}
function lowerExpression(sourceFile, node, diagnostics, context) { return lowerLiteral(sourceFile, node, diagnostics, context); }

function makeDiagnostic(sourceFile, node, code, message, hint, details) {
  return { phase: 'compiled-handlers', code, severity: 'error', message, hint, loc: sourceLoc(sourceFile, node), details };
}

function recordOutcome(context, sourceFile, node, diagnostics, kind) {
  if (!context.outcomes) context.outcomes = [];
  const terminalKinds = new Set(['result', 'next', 'next-error', 'channel', 'resolve']);
  if (!terminalKinds.has(kind)) return;
  const existing = context.outcomes.find((item) => terminalKinds.has(item.kind));
  if (existing) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      'PULSEWASM_COMPILED_HANDLER_CONFLICTING_OUTCOME',
      'Compiled handlers may produce only one terminal outcome on a linear path.',
      'Choose exactly one of ctx.result.*, ctx.resolve(...), next(), next(err), or a channel return. Use explicit future control-flow support for branched outcomes.',
      { firstOutcome: existing.kind, secondOutcome: kind }
    ));
    return;
  }
  context.outcomes.push({ kind, text: nodeText(sourceFile, node), loc: sourceLoc(sourceFile, node) });
}

function lowerCallExpression(sourceFile, node, diagnostics, context, options = {}) {
  const callee = node.expression;
  if (ts.isIdentifier(callee) && callee.text === context.nextName) {
    if (node.arguments.length === 0) {
      recordContextCall(context, 'next', node, sourceFile);
      recordOutcome(context, sourceFile, node, diagnostics, 'next');
      return `pulse_next(changetype<PulseWasmDispatchState>(${context.ctxName}))`;
    }
    if (node.arguments.length === 1) {
      recordContextCall(context, 'next(error)', node, sourceFile);
      recordOutcome(context, sourceFile, node, diagnostics, 'next-error');
      return `pulse_next_error(changetype<PulseWasmDispatchState>(${context.ctxName}), ${lowerExpression(sourceFile, node.arguments[0], diagnostics, context)})`;
    }
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const chain = propertyChain(callee) || [];
    const joined = chain.join('.');
    const ctx = context.ctxName;
    if (context.requestJsonLocals && chain.length === 2 && context.requestJsonLocals.has(chain[0])) {
      const refName = chain[0];
      const method = chain[1];
      recordContextCall(context, `ctx.req.json.${method}`, node, sourceFile);
      if (method === 'ok' && node.arguments.length === 0) return `pulse_request_json_ok_compiled(${ctx}, ${refName})`;
      if (method === 'errorText' && node.arguments.length === 0) return `pulse_request_json_error_text_compiled(${ctx}, ${refName})`;
      if (method === 'jsonText' && node.arguments.length === 0) return `pulse_request_json_text_compiled(${ctx}, ${refName})`;
      if (method === 'getString' && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) return `pulse_request_json_get_string_compiled(${ctx}, ${refName}, ${asString(unwrapExpression(node.arguments[0]).text)})`;
      if (method === 'getI32' && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) return `I32.parseInt(pulse_request_json_get_string_compiled(${ctx}, ${refName}, ${asString(unwrapExpression(node.arguments[0]).text)}))`;
      if (method === 'getU32' && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) return `U32.parseInt(pulse_request_json_get_string_compiled(${ctx}, ${refName}, ${asString(unwrapExpression(node.arguments[0]).text)}))`;
      if (method === 'getF64' && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) return `F64.parseFloat(pulse_request_json_get_string_compiled(${ctx}, ${refName}, ${asString(unwrapExpression(node.arguments[0]).text)}))`;
      if (method === 'getBool' && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) return `pulse_request_json_get_bool_compiled(${ctx}, ${refName}, ${asString(unwrapExpression(node.arguments[0]).text)})`;
      if (method === 'has' && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) return `pulse_request_json_has_compiled(${ctx}, ${refName}, ${asString(unwrapExpression(node.arguments[0]).text)})`;
      diagnostics.push(makeDiagnostic(sourceFile, node, REQUEST_JSON_BODY_DIAGNOSTICS.accessorUnsupported || 'PULSEWASM_REQUEST_JSON_ACCESSOR_UNSUPPORTED', `Request JSON accessor ${method} is not supported by the Pass 39 compiled handler bridge.`, 'Use ok(), errorText(), jsonText(), getString(), getI32(), getU32(), getF64(), getBool(), or has() with literal paths.'));
      return method === 'ok' || method === 'getBool' || method === 'has' ? 'false' : method === 'getI32' || method === 'getU32' || method === 'getF64' ? '0' : "''";
    }
    if (context.resolvedLocals && chain.length === 2 && context.resolvedLocals.has(chain[0])) {
      const resolvedName = context.resolvedLocals.get(chain[0]);
      const method = chain[1];
      recordContextCall(context, `ctx.resolved.${method}`, node, sourceFile);
      if (method === 'status' && node.arguments.length === 0) return `pulse_resolved_status_compiled(${ctx}, ${asString(resolvedName)})`;
      if (method === 'ok' && node.arguments.length === 0) return `pulse_resolved_ok_compiled(${ctx}, ${asString(resolvedName)})`;
      if (method === 'text' && node.arguments.length === 0) return `pulse_resolved_text_compiled(${ctx}, ${asString(resolvedName)})`;
      if (method === 'jsonText' && node.arguments.length === 0) return `pulse_resolved_json_text_compiled(${ctx}, ${asString(resolvedName)})`;
      if (method === 'json' && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) return `pulse_resolved_json_handle_compiled(${ctx}, ${asString(resolvedName)}, ${asString(unwrapExpression(node.arguments[0]).text)})`;
      if (method === 'header' && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) return `pulse_resolved_header_compiled(${ctx}, ${asString(resolvedName)}, ${asString(unwrapExpression(node.arguments[0]).text)})`;
    }
    if (joined === `${ctx}.param` && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.param', node, sourceFile); return `pulse_ctx_param(${ctx}, ${asString(unwrapExpression(node.arguments[0]).text)})`; }
    if (joined === `${ctx}.paramI32` && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.paramI32', node, sourceFile); return `I32.parseInt(pulse_ctx_param(${ctx}, ${asString(unwrapExpression(node.arguments[0]).text)}))`; }
    if (joined === `${ctx}.request.method` && node.arguments.length === 0) { recordContextCall(context, 'ctx.request.method', node, sourceFile); return `pulse_request_method_compiled(${ctx})`; }
    if (joined === `${ctx}.request.path` && node.arguments.length === 0) { recordContextCall(context, 'ctx.request.path', node, sourceFile); return `pulse_request_path_compiled(${ctx})`; }
    if (joined === `${ctx}.state.get` && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.state.get', node, sourceFile); return `pulse_ctx_state_get(${ctx}, ${asString(unwrapExpression(node.arguments[0]).text)})`; }
    if (joined === `${ctx}.state.set` && node.arguments.length === 2 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.state.set', node, sourceFile); return `pulse_ctx_state_set(${ctx}, ${asString(unwrapExpression(node.arguments[0]).text)}, ${lowerExpression(sourceFile, node.arguments[1], diagnostics, context)})`; }
    if (joined === `${ctx}.request.header.first` && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.request.header.first', node, sourceFile); return `pulse_request_header_first_compiled(${ctx}, ${asString(unwrapExpression(node.arguments[0]).text)})`; }
    if (joined === `${ctx}.request.header.count` && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.request.header.count', node, sourceFile); return `pulse_request_header_count_compiled(${ctx}, ${asString(unwrapExpression(node.arguments[0]).text)})`; }
    if (joined === `${ctx}.request.header.at` && node.arguments.length === 2 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.request.header.at', node, sourceFile); return `pulse_request_header_at_compiled(${ctx}, ${asString(unwrapExpression(node.arguments[0]).text)}, ${lowerExpression(sourceFile, node.arguments[1], diagnostics, context)})`; }
    const requestJsonRef = requestJsonRefFromCtxCall(node, ctx);
    if (requestJsonRef) {
      if (requestJsonRef.status !== 'ok') diagnostics.push(makeDiagnostic(sourceFile, node, REQUEST_JSON_BODY_DIAGNOSTICS.nonLiteralSchema || 'PULSEWASM_REQUEST_JSON_SCHEMA_MUST_BE_LITERAL', 'ctx.req.json/parse schema names must be string literals.', 'Use ctx.req.json("Schema") or ctx.req.json() with explicit generic parser config.'));
      recordContextCall(context, requestJsonRef.surface || 'ctx.req.json', node, sourceFile);
      return `pulse_request_json_compiled(${ctx}, ${asString(requestJsonRef.schema || '')}, ${requestJsonRef.mode === 'genericJson' ? 'true' : 'false'})`;
    }
    if (joined === `${ctx}.response.header.set` && node.arguments.length === 2 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.response.header.set', node, sourceFile); return `pulse_response_header_set_compiled(${ctx}, ${asString(unwrapExpression(node.arguments[0]).text)}, ${lowerExpression(sourceFile, node.arguments[1], diagnostics, context)})`; }
    if (joined === `${ctx}.response.header.append` && node.arguments.length === 2 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.response.header.append', node, sourceFile); return `pulse_response_header_append_compiled(${ctx}, ${asString(unwrapExpression(node.arguments[0]).text)}, ${lowerExpression(sourceFile, node.arguments[1], diagnostics, context)})`; }
    if (joined === `${ctx}.response.header.delete` && node.arguments.length === 1 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.response.header.delete', node, sourceFile); return `pulse_response_header_delete_compiled(${ctx}, ${asString(unwrapExpression(node.arguments[0]).text)})`; }
    if (joined === `${ctx}.resolved` && context.allowRouteEffects) {
      const resolvedName = resolvedNameFromCtxResolvedCall(node, ctx);
      if (resolvedName !== undefined) { recordContextCall(context, 'ctx.resolved', node, sourceFile); return `pulse_resolved_handle_compiled(${ctx}, ${asString(resolvedName)})`; }
    }
    if (joined === `${ctx}.resolve` && node.arguments.length === 2) return lowerPlannedResolveCall(sourceFile, node, diagnostics, context);
    if (joined === `${ctx}.result.text` && (node.arguments.length === 2 || node.arguments.length === 3)) {
      recordContextCall(context, 'ctx.result.text', node, sourceFile); recordOutcome(context, sourceFile, node, diagnostics, 'result');
      const headerStatements = node.arguments[2] ? resultHeaderStatementsFromOptions(sourceFile, node.arguments[2], diagnostics, context) : [];
      return `${headerStatements.join(';\n')}${headerStatements.length ? ';\n' : ''}pulse_result_text_compiled(${ctx}, ${lowerExpression(sourceFile, node.arguments[0], diagnostics, context)}, ${lowerExpression(sourceFile, node.arguments[1], diagnostics, context)})`;
    }
    if (joined === `${ctx}.result.jsonText` && (node.arguments.length === 2 || node.arguments.length === 3)) {
      recordContextCall(context, 'ctx.result.jsonText', node, sourceFile); recordOutcome(context, sourceFile, node, diagnostics, 'result');
      const headerStatements = node.arguments[2] ? resultHeaderStatementsFromOptions(sourceFile, node.arguments[2], diagnostics, context) : [];
      return `${headerStatements.join(';\n')}${headerStatements.length ? ';\n' : ''}pulse_result_json_text_compiled(${ctx}, ${lowerExpression(sourceFile, node.arguments[0], diagnostics, context)}, ${lowerExpression(sourceFile, node.arguments[1], diagnostics, context)})`;
    }
    if (joined === `${ctx}.result.json` && (node.arguments.length === 2 || node.arguments.length === 3) && isStringLiteralLike(unwrapExpression(node.arguments[0]))) {
      recordContextCall(context, 'ctx.result.json', node, sourceFile); recordOutcome(context, sourceFile, node, diagnostics, 'result');
      const optionsNode = node.arguments[2];
      const headerStatements = optionsNode ? resultHeaderStatementsFromOptions(sourceFile, optionsNode, diagnostics, context) : [];
      const statusExpression = optionsNode ? resultStatusExpressionFromOptions(sourceFile, optionsNode, diagnostics, context, '200') : '200';
      const bodyExpression = schemaJsonTextExpression(sourceFile, node.arguments[1], diagnostics, context);
      return `${headerStatements.join(';\n')}${headerStatements.length ? ';\n' : ''}pulse_result_json_text_compiled(${ctx}, ${statusExpression}, ${bodyExpression})`;
    }
    if (joined === `${ctx}.result.empty` && (node.arguments.length === 1 || node.arguments.length === 2)) {
      recordContextCall(context, 'ctx.result.empty', node, sourceFile); recordOutcome(context, sourceFile, node, diagnostics, 'result');
      const headerStatements = node.arguments[1] ? resultHeaderStatementsFromOptions(sourceFile, node.arguments[1], diagnostics, context) : [];
      return `${headerStatements.join(';\n')}${headerStatements.length ? ';\n' : ''}pulse_result_empty_compiled(${ctx}, ${lowerExpression(sourceFile, node.arguments[0], diagnostics, context)})`;
    }
    if (joined === `${ctx}.schema.encode` && node.arguments.length === 2 && isStringLiteralLike(unwrapExpression(node.arguments[0]))) { recordContextCall(context, 'ctx.schema.encode', node, sourceFile); return schemaJsonTextExpression(sourceFile, node.arguments[1], diagnostics, context); }
    if (joined === `${ctx}.error` && node.arguments.length >= 2) { recordContextCall(context, 'ctx.error', node, sourceFile); const status = node.arguments[2] ? lowerExpression(sourceFile, node.arguments[2], diagnostics, context) : '500'; return `changetype<usize>(createPulseWasmError(${lowerExpression(sourceFile, node.arguments[0], diagnostics, context)}, ${lowerExpression(sourceFile, node.arguments[1], diagnostics, context)}, ${status}))`; }
    if ((joined === `${ctx}.fetch` || joined === `${ctx}.sleep` || joined === `${ctx}.resolve` || joined === `${ctx}.bodyText`)) {
      if (context.metrics) context.metrics.effectsRejected += 1;
      diagnostics.push(makeDiagnostic(sourceFile, node, ROUTE_HANDLER_CONTEXT_DIAGNOSTICS.effectBoundaryReserved, `${joined} is recognized as a Pulse effect, but this compiled handler location cannot lower it.`, 'Use ctx.resolve(ctx.fetch(...), top-levelContinuation) from a route handler for Pass 38.'));
      return '0';
    }
  }
  diagnostics.push(makeDiagnostic(sourceFile, node, ROUTE_HANDLER_CONTEXT_DIAGNOSTICS.unsupportedCall, `Call "${nodeText(sourceFile, node)}" is not supported in Pass 38 compiled handlers.`, 'Use direct next(), ctx.param(), ctx.request.method/path, ctx.result.*, ctx.resolve(ctx.fetch(...), continuation), ctx.resolved(), request/response header DSL, or simple local values.'));
  return '0';
}

function cloneBranchContext(context) {
  return { ...context, outcomes: Array.isArray(context.outcomes) ? context.outcomes.slice() : [] };
}

function lowerBranchStatements(sourceFile, statement, diagnostics, context) {
  const branch = cloneBranchContext(context);
  const lines = [];
  if (ts.isBlock(statement)) {
    for (const child of statement.statements) lines.push(lowerStatement(sourceFile, child, diagnostics, branch));
  } else {
    lines.push(lowerStatement(sourceFile, statement, diagnostics, branch));
  }
  return lines.filter(Boolean);
}

function indentGeneratedBlock(lines) {
  return lines
    .flatMap((line) => String(line || '').split('\n'))
    .filter((line) => line.length > 0)
    .map((line) => `  ${line}`)
    .join('\n');
}

function lowerIfStatement(sourceFile, statement, diagnostics, context) {
  if (context.metrics) context.metrics.ifStatementsLowered += 1;
  const condition = lowerExpression(sourceFile, statement.expression, diagnostics, context);
  const thenBody = indentGeneratedBlock(lowerBranchStatements(sourceFile, statement.thenStatement, diagnostics, context));
  if (!statement.elseStatement) return `if (${condition}) {\n${thenBody}\n}`;
  const elseBody = indentGeneratedBlock(lowerBranchStatements(sourceFile, statement.elseStatement, diagnostics, context));
  return `if (${condition}) {\n${thenBody}\n} else {\n${elseBody}\n}`;
}

function lowerStatement(sourceFile, statement, diagnostics, context) {
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
    return `${lowerCallExpression(sourceFile, statement.expression, diagnostics, context)};`;
  }
  if (ts.isReturnStatement(statement)) {
    if (!statement.expression) return 'return;';
    if (context.role === 'channel') {
      if (ts.isArrayLiteralExpression(statement.expression)) {
        diagnostics.push(makeDiagnostic(sourceFile, statement.expression, 'PULSEWASM_COMPILED_CHANNEL_MULTI_VALUE_RESERVED', 'Compiled multi-channel return values are reserved in Pass 31.', 'Return a single string channel for now. Multi-channel output will use an explicit channel-list representation later.'));
        return 'return 0;';
      }
      if (isStringLiteralLike(statement.expression) || ts.isBinaryExpression(statement.expression) || ts.isIdentifier(statement.expression)) {
        recordOutcome(context, sourceFile, statement, diagnostics, 'channel');
        return `return changetype<usize>(${lowerExpression(sourceFile, statement.expression, diagnostics, context)});`;
      }
    }
    if (ts.isCallExpression(statement.expression)) return `${lowerCallExpression(sourceFile, statement.expression, diagnostics, context)};\n  return;`;
    diagnostics.push(makeDiagnostic(sourceFile, statement, 'PULSEWASM_COMPILED_HANDLER_UNSUPPORTED_RETURN', `Return expression "${nodeText(sourceFile, statement)}" is not supported in Pass 31 compiled context handlers.`, 'Return direct next(), ctx.result.*, ctx.error transition, or a string channel value.'));
    return 'return;';
  }
  if (ts.isVariableStatement(statement)) {
    const lines = [];
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) {
        diagnostics.push(makeDiagnostic(sourceFile, decl.name, 'PULSEWASM_COMPILED_HANDLER_UNSUPPORTED_BINDING', 'Destructuring is not supported in Pass 31 compiled context handlers.', 'Use simple named local variables.'));
        continue;
      }
      const resolvedName = decl.initializer ? resolvedNameFromCtxResolvedCall(decl.initializer, context.ctxName) : undefined;
      const requestJsonRef = decl.initializer ? requestJsonRefFromCtxCall(decl.initializer, context.ctxName) : undefined;
      const resolvedJsonRef = decl.initializer ? resolvedJsonRefFromCall(decl.initializer, context) : undefined;
      const typeText = decl.type ? decl.type.getText(sourceFile) : (resolvedName !== undefined || requestJsonRef !== undefined || resolvedJsonRef !== undefined ? 'usize' : inferTypeFromInitializer(sourceFile, decl.initializer));
      const asType = lowerType(typeText);
      if (!asType) {
        diagnostics.push(makeDiagnostic(sourceFile, decl, 'PULSEWASM_COMPILED_HANDLER_UNSUPPORTED_TYPE', `Local type "${typeText || '<implicit>'}" is not supported in Pass 38 compiled context handlers.`, 'Use explicit string, boolean/bool, number/f64, i32/u32, usize, or void types.'));
        continue;
      }
      const init = decl.initializer ? ` = ${lowerExpression(sourceFile, decl.initializer, diagnostics, context)}` : '';
      lines.push(`let ${decl.name.text}: ${asType}${init};`);
      if (resolvedName !== undefined && context.resolvedLocals) context.resolvedLocals.set(decl.name.text, resolvedName);
      if (requestJsonRef !== undefined && context.requestJsonLocals) context.requestJsonLocals.set(decl.name.text, requestJsonRef);
      if (resolvedJsonRef !== undefined && context.resolvedJsonLocals) context.resolvedJsonLocals.set(decl.name.text, resolvedJsonRef.resolvedName);
    }
    return lines.join('\n  ');
  }
  if (ts.isIfStatement(statement)) {
    return lowerIfStatement(sourceFile, statement, diagnostics, context);
  }
  diagnostics.push(makeDiagnostic(sourceFile, statement, 'PULSEWASM_COMPILED_HANDLER_UNSUPPORTED_STATEMENT', `Statement "${nodeText(sourceFile, statement)}" is not supported in Pass 31 compiled context handlers.`, 'Use const/let declarations, direct ctx DSL calls, direct next(), and return.'));
  return '';
}

function inferTypeFromInitializer(sourceFile, init) {
  const expr = unwrapExpression(init);
  if (!expr) return undefined;
  if (isStringLiteralLike(expr)) return 'string';
  if (isNumberLiteralLike(expr)) return 'number';
  if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) return 'boolean';
  if (ts.isPrefixUnaryExpression(expr)) {
    if (expr.operator === ts.SyntaxKind.ExclamationToken) return 'boolean';
    if (expr.operator === ts.SyntaxKind.MinusToken) return 'number';
  }
  if (ts.isBinaryExpression(expr)) {
    if (isBooleanBinaryOperator(expr.operatorToken.kind) || expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) return 'boolean';
    if (expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const leftType = inferTypeFromInitializer(sourceFile, expr.left);
      const rightType = inferTypeFromInitializer(sourceFile, expr.right);
      return leftType === 'string' || rightType === 'string' ? 'string' : 'number';
    }
    if ([ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken].includes(expr.operatorToken.kind)) return 'number';
  }
  if (ts.isCallExpression(expr)) {
    const chain = ts.isPropertyAccessExpression(expr.expression) ? propertyChain(expr.expression) : undefined;
    const joined = chain ? chain.join('.') : '';
    if (chain && chain[chain.length - 1] === 'param') return 'string';
    if (chain && chain[chain.length - 1] === 'paramI32') return 'i32';
    if (chain && (chain[chain.length - 1] === 'get' || chain[chain.length - 1] === 'first' || chain[chain.length - 1] === 'at')) return 'string';
    if (chain && chain[chain.length - 1] === 'count') return 'i32';
    if (joined.endsWith('.request.method') || joined.endsWith('.request.path')) return 'string';
    if (chain && (joined.endsWith('.req.json') || joined.endsWith('.request.json') || joined.endsWith('.req.parse'))) return 'usize';
    if (chain && chain[chain.length - 1] === 'resolved') return 'usize';
    if (chain && chain[chain.length - 1] === 'json') return 'usize';
    if (joined.endsWith('.schema.encode')) return 'string';
    if (chain && (chain[chain.length - 1] === 'text' || chain[chain.length - 1] === 'jsonText' || chain[chain.length - 1] === 'header' || chain[chain.length - 1] === 'errorText' || chain[chain.length - 1] === 'getString')) return 'string';
    if (chain && (chain[chain.length - 1] === 'status' || chain[chain.length - 1] === 'getI32' || chain[chain.length - 1] === 'getU32')) return 'i32';
    if (chain && chain[chain.length - 1] === 'getF64') return 'number';
    if (chain && (chain[chain.length - 1] === 'ok' || chain[chain.length - 1] === 'getBool' || chain[chain.length - 1] === 'has')) return 'boolean';
    if (chain && chain[chain.length - 1] === 'error') return 'usize';
  }
  return undefined;
}

function lowerType(typeText) {
  const t = String(typeText || '').trim();
  if (!t) return undefined;
  if (t === 'string') return 'string';
  if (t === 'boolean' || t === 'bool') return 'bool';
  if (t === 'number' || t === 'f64') return 'f64';
  if (['i32','u32','i64','u64','usize','void'].includes(t)) return t;
  return undefined;
}

function validateUnsupportedSyntax(sourceFile, node, diagnostics) {
  function walk(n) {
    if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n)) {
      diagnostics.push(makeDiagnostic(sourceFile, n, 'PULSEWASM_COMPILED_HANDLER_LOOP_UNSUPPORTED', 'User-authored loops are not supported in Pass 31 compiled context handlers.', 'Loops are allowed in generated/runtime code and later validated sidecars, not in Pass 31 user handlers.'));
    }
    if (ts.isAwaitExpression(n)) {
      diagnostics.push(makeDiagnostic(sourceFile, n, 'PULSEWASM_AWAIT_EFFECT_RESERVED', 'await is recognized as future lowerable Pulse effect sugar, but is not implemented in Pass 31.', 'Use explicit effect contracts later or host-import/js-engine mode now.'));
    }
    if (ts.isTryStatement(n) || ts.isThrowStatement(n)) {
      diagnostics.push(makeDiagnostic(sourceFile, n, 'PULSEWASM_COMPILED_HANDLER_THROW_UNSUPPORTED', 'throw/try-catch are not supported in Pass 31 compiled context handlers.', 'Use next(ctx.error(...)) as the clean error transition.'));
    }
    if (ts.isNewExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
      diagnostics.push(makeDiagnostic(sourceFile, n, 'PULSEWASM_COMPILED_HANDLER_UNSUPPORTED_SYNTAX', 'Classes/new expressions are not supported in Pass 31 compiled context handlers.', 'Use trusted Pulse DSL helpers and simple local values.'));
    }
    ts.forEachChild(n, walk);
  }
  walk(node);
}

function roleForHandler(handler) { return String((handler.roles || [])[0] || '').split(':')[0] || 'unknown'; }
function expectedParamNamesForRole(role) {
  if (role === 'error') return ['err', 'ctx', 'next'];
  if (role === 'channel' || role === 'continuation') return ['ctx'];
  return ['ctx', 'next'];
}
function validateParameterNames(sourceFile, node, role, diagnostics) {
  const expected = expectedParamNamesForRole(role);
  const actual = Array.from(node.parameters || []).map((p) => ts.isIdentifier(p.name) ? p.name.text : '<non-identifier>');
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      'PULSEWASM_COMPILED_HANDLER_PARAMETER_NAME_MISMATCH',
      `Compiled ${role} handler parameters must be named exactly (${expected.join(', ')}).`,
      'Use role-specific parameter names so the Pass 31 lowering surface remains explicit.',
      { expected, actual }
    ));
  }
}
function validateParameterTypes(sourceFile, node, diagnostics) {
  for (const param of Array.from(node.parameters || [])) {
    if (param.type) {
      const typeText = param.type.getText(sourceFile);
      if (!lowerType(typeText) || /Promise|any|unknown|Record|Object|Number|String|Boolean|\|/.test(typeText)) {
        diagnostics.push(makeDiagnostic(sourceFile, param.type, 'PULSEWASM_COMPILED_HANDLER_UNSUPPORTED_TYPE', `Parameter type "${typeText}" is not supported.`, 'Use PulseCtx/PulseNext/PulseError names at the TS surface or AS-compatible primitives for local helpers.'));
      }
    }
  }
}

function functionSignatureFor(handler, nodeInfo) {
  const role = roleForHandler(handler);
  const name = safeIdentifier(handler.exportName || handler.localName || handler.id);
  if (role === 'error') return `export function ${name}(err: usize, ctx: usize, next: usize): void`;
  if (role === 'channel') return `export function ${name}(ctx: usize): usize`;
  if (role === 'continuation') return `export function ${name}(ctx: usize): void`;
  return `export function ${name}(ctx: usize, next: usize): void`;
}

function lowerHandler(sourceFile, handler, nodeInfo, routeEffectIndex) {
  const diagnostics = [];
  const role = roleForHandler(handler);
  const node = nodeInfo?.node;
  if (!node) {
    diagnostics.push({ phase:'compiled-handlers', code:'PULSEWASM_COMPILED_HANDLER_SOURCE_MISSING', severity:'error', message:`Handler source for ${handler.localName} was not found.`, hint:'Use top-level exported handlers in the entry file.', loc: handler.loc });
    return { handler, role, status:'error', diagnostics, source:'' };
  }
  if (!nodeInfo.exported && !handler.declaration?.exported) {
    diagnostics.push(makeDiagnostic(sourceFile, nodeInfo.declaration || node, 'PULSEWASM_COMPILED_HANDLER_NOT_EXPORTED', `Handler "${handler.localName}" must be exported for compiled-wasm mode.`, 'Export every handler used by the route plan.'));
  }
  if (node.type && /Promise|any|unknown|Record|Object|Number|String|Boolean|\|/.test(node.type.getText(sourceFile))) {
    diagnostics.push(makeDiagnostic(sourceFile, node.type, 'PULSEWASM_COMPILED_HANDLER_UNSUPPORTED_TYPE', `Return type "${node.type.getText(sourceFile)}" is not supported.`, 'Use void or explicit AS-compatible types.'));
  }
  validateUnsupportedSyntax(sourceFile, node, diagnostics);
  validateParameterNames(sourceFile, node, role, diagnostics);
  validateParameterTypes(sourceFile, node, diagnostics);
  const params = Array.from(node.parameters || []).map((p) => ts.isIdentifier(p.name) ? p.name.text : '');
  const ctxName = role === 'error' ? (params[1] || 'ctx') : (params[0] || 'ctx');
  const nextName = role === 'channel' || role === 'continuation' ? 'next' : (role === 'error' ? (params[2] || 'next') : (params[1] || 'next'));
  const handlerName = handler.localName || handler.exportName || handler.id;
  const metrics = { contextCalls: [], ifStatementsLowered: 0, effectsRejected: 0 };
  const context = {
    role,
    ctxName,
    nextName,
    handlerName,
    allowRouteEffects: Boolean(routeEffectIndex),
    routeEffectRoute: routeEffectIndex && routeEffectIndex.routesByHandler.get(handlerName),
    continuationInfo: routeEffectIndex && routeEffectIndex.continuationsByName.get(handlerName),
    resolveLoweringIndex: 0,
    resolvedLocals: new Map(),
    requestJsonLocals: new Map(),
    resolvedJsonLocals: new Map(),
    outcomes: [],
    metrics
  };
  let bodyLines = [];
  if (node.body && ts.isBlock(node.body)) {
    for (const stmt of node.body.statements) bodyLines.push(lowerStatement(sourceFile, stmt, diagnostics, context));
  } else if (node.body) {
    if (role === 'channel') bodyLines.push(`return changetype<usize>(${lowerExpression(sourceFile, node.body, diagnostics, context)});`);
    else bodyLines.push(`${lowerExpression(sourceFile, node.body, diagnostics, context)};`);
  }
  if (bodyLines.length === 0 && role === 'channel') bodyLines.push('return 0;');
  const signature = functionSignatureFor(handler, nodeInfo);
  const body = bodyLines.filter(Boolean).map((line) => `  ${line.replace(/\n/g, '\n  ')}`).join('\n');
  const source = `${signature} {\n${body}\n}`;
  return { handler, role, status: diagnostics.length ? 'error' : 'ok', diagnostics, source, loweredStatements: bodyLines.length, metrics, contextCalls: metrics.contextCalls };
}


function normalizeSchemaFieldKind(type) {
  const value = String(type || '').trim().toLowerCase();
  if (value === 'boolean') return 'bool';
  if (value === 'number' || value === 'float') return 'f64';
  if (value === 'integer' || value === 'int') return 'i32';
  if (value === 'uint') return 'u32';
  return value;
}
function artifactPayload(value) {
  return value && typeof value === 'object' && value.artifact ? value.artifact : value;
}
function schemaSummariesFromRequestJsonPlan(requestJsonBodyPlan) {
  const plan = artifactPayload(requestJsonBodyPlan);
  const byId = new Map();
  const add = (summary) => {
    if (!summary || !summary.id) return;
    const fields = Array.isArray(summary.fields) ? summary.fields.map((field) => ({ name: String(field.name || ''), type: normalizeSchemaFieldKind(field.type) })).filter((field) => field.name) : [];
    byId.set(String(summary.id), { id: String(summary.id), fields });
  };
  const registry = plan && plan.schemaRegistry;
  for (const schema of Array.isArray(registry && registry.schemas) ? registry.schemas : []) add(schema);
  for (const route of Array.isArray(plan && plan.routes) ? plan.routes : []) {
    for (const read of Array.isArray(route.reads) ? route.reads : []) add(read.schemaSummary);
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}
function buildSchemaValidationSource(requestJsonBodyPlan) {
  const schemas = schemaSummariesFromRequestJsonPlan(requestJsonBodyPlan);
  const cases = [];
  for (const schema of schemas) {
    const checks = [];
    for (const field of schema.fields) {
      checks.push(`    if (!jsonFieldMatchesKind(text, ${asString(field.name)}, ${asString(field.type)})) { setSchemaDecodeError(${asString(schema.id)}, ${asString(field.name)}, ${asString(field.type)}); return false }`);
    }
    cases.push(`  if (schema == ${asString(schema.id)}) {\n${checks.length ? checks.join('\n') : '    return true'}\n    return true\n  }`);
  }
  return `
function jsonValueLooksNumberAt(text: string, start: i32): bool {
  if (start < 0 || start >= text.length) return false
  const ch = text.charCodeAt(start)
  return ch == 45 || (ch >= 48 && ch <= 57)
}
function jsonValueLooksBoolAt(text: string, start: i32): bool {
  if (start < 0) return false
  return text.substr(start, 4) == 'true' || text.substr(start, 5) == 'false'
}
function jsonFieldMatchesKind(text: string, field: string, kind: string): bool {
  const start = findJsonFieldValueStart(text, field)
  if (start < 0) return false
  if (kind == 'string') return text.charCodeAt(start) == 34
  if (kind == 'bool') return jsonValueLooksBoolAt(text, start)
  if (kind == 'i32' || kind == 'u32' || kind == 'f64') return jsonValueLooksNumberAt(text, start)
  return true
}
function setSchemaDecodeError(schema: string, field: string, expected: string): void {
  __requestJsonErrorText = '{"error":"schema_decode_failed","schema":"' + schema + '","field":"' + field + '","expected":"' + expected + '"}'
}
function validateRequestJsonSchema(schema: string): bool {
  if (schema.length == 0) return true
  const text = requestBodyTextOnce()
${cases.length ? cases.join('\n') : ''}
  return true
}
`;
}

function buildUserHandlersSource(lowered, routeEffectPlan, requestJsonBodyPlan) {
  const functions = lowered.map((entry) => entry.source).join('\n\n');
  const schemaValidationSource = buildSchemaValidationSource(requestJsonBodyPlan);
  const effectIndex = routeEffectPlanIndex(routeEffectPlan);
  const resumeCases = [];
  for (const route of Array.isArray(effectIndex.plan.routes) ? effectIndex.plan.routes : []) {
    const runtimeId = Number(route.runtimeId);
    if (!Number.isFinite(runtimeId)) continue;
    const resolves = Array.isArray(route.resolves) ? route.resolves : [];
    resolves.forEach((resolve, index) => {
      const continuationName = safeIdentifier(resolve?.continuation?.name || '');
      if (continuationName) resumeCases.push(`  if (routeRuntimeId == ${runtimeId | 0} && boundaryIndex == ${index | 0}) { ${continuationName}(0); return true }`);
    });
  }
  return `/*
 * Generated by PulseWasm Pass 31.
 * Compiled user handlers. Do not edit by hand.
 */
import {
  PulseWasmDispatchState,
  createPulseWasmError,
  pulse_next,
  pulse_next_error,
  pulse_set_result,
  currentParamCount,
  currentParamNameAt,
  currentParamValueAt
} from './runtime-core.as'
import {
  METHOD_GET,
  METHOD_POST,
  METHOD_PUT,
  METHOD_PATCH,
  METHOD_DELETE,
  METHOD_HEAD,
  METHOD_OPTIONS
} from './types.as'

export const COMPILED_RESULT_NONE: i32 = 0
export const COMPILED_RESULT_TEXT: i32 = 1
export const COMPILED_RESULT_JSON: i32 = 2
export const COMPILED_RESULT_EMPTY: i32 = 4
export const COMPILED_RESULT_RESOLVE: i32 = 6

let __compiledResultStatus: i32 = 0
let __compiledResultKind: i32 = COMPILED_RESULT_NONE
let __compiledResultBody: string = ''
let __compiledResolveBoundaryIndex: i32 = -1

let __requestHeaderNames = new Array<string>()
let __requestHeaderValues = new Array<string>()
let __requestBodyText: string = ''
let __requestBodyReadCount: i32 = 0
let __requestJsonParseCount: i32 = 0
let __requestJsonParsed: bool = false
let __requestJsonValid: bool = false
let __requestJsonErrorText: string = ''
let __requestJsonValidatedSchema: string = ''
let __responseHeaderNames = new Array<string>()
let __responseHeaderValues = new Array<string>()
let __resolvedNames = new Array<string>()
let __resolvedStatuses = new Array<i32>()
let __resolvedKinds = new Array<string>()
let __resolvedBodies = new Array<string>()
let __resolvedHeaderResultNames = new Array<string>()
let __resolvedHeaderNames = new Array<string>()
let __resolvedHeaderValues = new Array<string>()
let __bridgeIncomingBuffers = new Array<ArrayBuffer>()
let __bridgeResultBodyBuffer = new ArrayBuffer(0)
let __bridgeResultHeaderBuffer = new ArrayBuffer(0)

export function compiled_alloc_utf8(len: i32): usize {
  const buffer = new ArrayBuffer(len)
  __bridgeIncomingBuffers.push(buffer)
  return changetype<usize>(buffer)
}
function decodeUtf8(ptr: usize, len: i32): string {
  if (len <= 0) return ''
  return String.UTF8.decodeUnsafe(ptr, len)
}
export function compiled_result_body_utf8_len(): i32 {
  __bridgeResultBodyBuffer = String.UTF8.encode(__compiledResultBody)
  return __bridgeResultBodyBuffer.byteLength
}
export function compiled_result_body_utf8_ptr(): usize {
  __bridgeResultBodyBuffer = String.UTF8.encode(__compiledResultBody)
  return changetype<usize>(__bridgeResultBodyBuffer)
}
export function compiled_result_header_count(): i32 { return __responseHeaderNames.length }
export function compiled_result_header_name_utf8_len(index: i32): i32 {
  if (index < 0 || index >= __responseHeaderNames.length) return 0
  __bridgeResultHeaderBuffer = String.UTF8.encode(__responseHeaderNames[index])
  return __bridgeResultHeaderBuffer.byteLength
}
export function compiled_result_header_name_utf8_ptr(index: i32): usize {
  if (index < 0 || index >= __responseHeaderNames.length) return 0
  __bridgeResultHeaderBuffer = String.UTF8.encode(__responseHeaderNames[index])
  return changetype<usize>(__bridgeResultHeaderBuffer)
}
export function compiled_result_header_value_utf8_len(index: i32): i32 {
  if (index < 0 || index >= __responseHeaderValues.length) return 0
  __bridgeResultHeaderBuffer = String.UTF8.encode(__responseHeaderValues[index])
  return __bridgeResultHeaderBuffer.byteLength
}
export function compiled_result_header_value_utf8_ptr(index: i32): usize {
  if (index < 0 || index >= __responseHeaderValues.length) return 0
  __bridgeResultHeaderBuffer = String.UTF8.encode(__responseHeaderValues[index])
  return changetype<usize>(__bridgeResultHeaderBuffer)
}

function lowerAscii(value: string): string {
  let out = ''
  for (let i: i32 = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    out += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code)
  }
  return out
}

function headerNameEquals(left: string, right: string): bool {
  return lowerAscii(left) == lowerAscii(right)
}

export function compiled_reset_result(): void {
  __compiledResultStatus = 0
  __compiledResultKind = COMPILED_RESULT_NONE
  __compiledResultBody = ''
  __compiledResolveBoundaryIndex = -1
  __responseHeaderNames = new Array<string>()
  __responseHeaderValues = new Array<string>()
}

export function compiled_reset_request_headers(): void {
  __requestHeaderNames = new Array<string>()
  __requestHeaderValues = new Array<string>()
}

export function compiled_set_request_header(name: string, value: string): void {
  __requestHeaderNames.push(name)
  __requestHeaderValues.push(value)
}


export function compiled_reset_request_body(): void {
  __requestBodyText = ''
  __requestBodyReadCount = 0
  __requestJsonParseCount = 0
  __requestJsonParsed = false
  __requestJsonValid = false
  __requestJsonErrorText = ''
  __requestJsonValidatedSchema = ''
}
export function compiled_set_request_body(body: string): void {
  __requestBodyText = body
  __requestBodyReadCount = 0
  __requestJsonParseCount = 0
  __requestJsonParsed = false
  __requestJsonValid = false
  __requestJsonErrorText = ''
  __requestJsonValidatedSchema = ''
}
export function compiled_set_request_body_utf8(bodyPtr: usize, bodyLen: i32): void { compiled_set_request_body(decodeUtf8(bodyPtr, bodyLen)) }
export function compiled_request_body_read_count(): i32 { return __requestBodyReadCount }
export function compiled_request_json_parse_count(): i32 { return __requestJsonParseCount }
function requestBodyTextOnce(): string {
  if (__requestBodyReadCount == 0) __requestBodyReadCount = 1
  return __requestBodyText
}
function trimAscii(value: string): string {
  let start: i32 = 0
  let end: i32 = value.length
  while (start < end) {
    const ch = value.charCodeAt(start)
    if (ch == 32 || ch == 9 || ch == 10 || ch == 13) start += 1
    else break
  }
  while (end > start) {
    const ch = value.charCodeAt(end - 1)
    if (ch == 32 || ch == 9 || ch == 10 || ch == 13) end -= 1
    else break
  }
  return value.substring(start, end)
}
function parseRequestJsonOnce(): void {
  if (__requestJsonParsed) return
  __requestJsonParsed = true
  __requestJsonParseCount += 1
  const text = trimAscii(requestBodyTextOnce())
  if (text.length >= 2) {
    const first = text.charCodeAt(0)
    const last = text.charCodeAt(text.length - 1)
    if ((first == 123 && last == 125) || (first == 91 && last == 93)) {
      __requestJsonValid = true
      __requestJsonErrorText = ''
      return
    }
  }
  __requestJsonValid = false
  __requestJsonErrorText = '{"error":"invalid_json"}'
}
function skipJsonWhitespace(text: string, index: i32): i32 {
  let i = index
  while (i < text.length) {
    const ch = text.charCodeAt(i)
    if (ch == 32 || ch == 9 || ch == 10 || ch == 13) i += 1
    else break
  }
  return i
}
function findJsonFieldValueStart(text: string, key: string): i32 {
  const pattern = '"' + key + '"'
  let at = text.indexOf(pattern)
  while (at >= 0) {
    let colon = text.indexOf(':', at + pattern.length)
    if (colon < 0) return -1
    return skipJsonWhitespace(text, colon + 1)
  }
  return -1
}
function readJsonStringToken(text: string, start: i32): string {
  let out = ''
  let i = start + 1
  while (i < text.length) {
    const ch = text.charCodeAt(i)
    if (ch == 34) return out
    if (ch == 92 && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next == 34 || next == 92 || next == 47) { out += String.fromCharCode(next); i += 2; continue }
      if (next == 110) { out += '\\n'; i += 2; continue }
      if (next == 114) { out += '\\r'; i += 2; continue }
      if (next == 116) { out += '\\t'; i += 2; continue }
    }
    out += String.fromCharCode(ch)
    i += 1
  }
  return out
}
function readJsonBareToken(text: string, start: i32): string {
  let end = start
  while (end < text.length) {
    const ch = text.charCodeAt(end)
    if (ch == 44 || ch == 125 || ch == 93 || ch == 32 || ch == 9 || ch == 10 || ch == 13) break
    end += 1
  }
  return text.substring(start, end)
}
function requestJsonGetValue(path: string): string {
  parseRequestJsonOnce()
  if (!__requestJsonValid) return ''
  const text = requestBodyTextOnce()
  const start = findJsonFieldValueStart(text, path)
  if (start < 0) return ''
  if (start < text.length && text.charCodeAt(start) == 34) return readJsonStringToken(text, start)
  return readJsonBareToken(text, start)
}
${schemaValidationSource}
export function pulse_request_json_compiled(ctx: usize, schema: string, generic: bool): usize {
  parseRequestJsonOnce()
  if (!generic && schema.length > 0 && __requestJsonValid && __requestJsonValidatedSchema != schema) {
    __requestJsonValidatedSchema = schema
    if (!validateRequestJsonSchema(schema)) __requestJsonValid = false
  }
  return 1
}
export function pulse_request_json_ok_compiled(ctx: usize, refId: usize): bool { parseRequestJsonOnce(); return __requestJsonValid }
export function pulse_request_json_error_text_compiled(ctx: usize, refId: usize): string { parseRequestJsonOnce(); return __requestJsonErrorText }
export function pulse_request_json_text_compiled(ctx: usize, refId: usize): string { parseRequestJsonOnce(); return __requestJsonValid ? requestBodyTextOnce() : '' }
export function pulse_request_json_get_string_compiled(ctx: usize, refId: usize, path: string): string { return requestJsonGetValue(path) }
export function pulse_request_json_get_bool_compiled(ctx: usize, refId: usize, path: string): bool { return requestJsonGetValue(path) == 'true' }
export function pulse_request_json_has_compiled(ctx: usize, refId: usize, path: string): bool { parseRequestJsonOnce(); return __requestJsonValid && findJsonFieldValueStart(requestBodyTextOnce(), path) >= 0 }

export function compiled_result_status(): i32 { return __compiledResultStatus }
export function compiled_result_kind(): i32 { return __compiledResultKind }
export function compiled_result_body(): string { return __compiledResultBody }
export function compiled_result_resolve_boundary_index(): i32 { return __compiledResolveBoundaryIndex }
export function compiled_response_header_count(): i32 { return __responseHeaderNames.length }
export function compiled_response_header_name_at(index: i32): string { return index >= 0 && index < __responseHeaderNames.length ? __responseHeaderNames[index] : '' }
export function compiled_response_header_value_at(index: i32): string { return index >= 0 && index < __responseHeaderValues.length ? __responseHeaderValues[index] : '' }
export function compiled_response_header_first(name: string): string {
  for (let i: i32 = 0; i < __responseHeaderNames.length; i += 1) if (headerNameEquals(__responseHeaderNames[i], name)) return __responseHeaderValues[i]
  return ''
}
export function compiled_response_header_count_named(name: string): i32 {
  let count: i32 = 0
  for (let i: i32 = 0; i < __responseHeaderNames.length; i += 1) if (headerNameEquals(__responseHeaderNames[i], name)) count += 1
  return count
}

export function pulse_ctx_param(ctx: usize, name: string): string {
  const state = changetype<PulseWasmDispatchState>(ctx)
  const count = currentParamCount(state)
  for (let i: i32 = 0; i < count; i += 1) {
    if (currentParamNameAt(state, i) == name) return currentParamValueAt(state, i)
  }
  return ''
}

export function pulse_request_method_compiled(ctx: usize): string {
  const methodCode = changetype<PulseWasmDispatchState>(ctx).methodCode
  if (methodCode == METHOD_GET) return 'GET'
  if (methodCode == METHOD_POST) return 'POST'
  if (methodCode == METHOD_PUT) return 'PUT'
  if (methodCode == METHOD_PATCH) return 'PATCH'
  if (methodCode == METHOD_DELETE) return 'DELETE'
  if (methodCode == METHOD_HEAD) return 'HEAD'
  if (methodCode == METHOD_OPTIONS) return 'OPTIONS'
  return ''
}

export function pulse_request_path_compiled(ctx: usize): string {
  return changetype<PulseWasmDispatchState>(ctx).requestPath
}

export function pulse_ctx_state_get(ctx: usize, key: string): string | null {
  const state = changetype<PulseWasmDispatchState>(ctx)
  for (let i: i32 = 0; i < state.stateKeys.length; i += 1) if (state.stateKeys[i] == key) return state.stateValues[i]
  return null
}
export function pulse_ctx_state_set(ctx: usize, key: string, value: string): void {
  const state = changetype<PulseWasmDispatchState>(ctx)
  for (let i: i32 = 0; i < state.stateKeys.length; i += 1) {
    if (state.stateKeys[i] == key) { state.stateValues[i] = value; return }
  }
  state.stateKeys.push(key)
  state.stateValues.push(value)
}

export function pulse_request_header_first_compiled(ctx: usize, name: string): string {
  for (let i: i32 = 0; i < __requestHeaderNames.length; i += 1) if (headerNameEquals(__requestHeaderNames[i], name)) return __requestHeaderValues[i]
  return ''
}
export function pulse_request_header_count_compiled(ctx: usize, name: string): i32 {
  let count: i32 = 0
  for (let i: i32 = 0; i < __requestHeaderNames.length; i += 1) if (headerNameEquals(__requestHeaderNames[i], name)) count += 1
  return count
}
export function pulse_request_header_at_compiled(ctx: usize, name: string, index: i32): string {
  let seen: i32 = 0
  for (let i: i32 = 0; i < __requestHeaderNames.length; i += 1) {
    if (headerNameEquals(__requestHeaderNames[i], name)) {
      if (seen == index) return __requestHeaderValues[i]
      seen += 1
    }
  }
  return ''
}

export function pulse_response_header_append_compiled(ctx: usize, name: string, value: string): void {
  __responseHeaderNames.push(name)
  __responseHeaderValues.push(value)
}
export function pulse_response_header_set_compiled(ctx: usize, name: string, value: string): void {
  pulse_response_header_delete_compiled(ctx, name)
  pulse_response_header_append_compiled(ctx, name, value)
}
export function pulse_response_header_delete_compiled(ctx: usize, name: string): void {
  const nextNames = new Array<string>()
  const nextValues = new Array<string>()
  for (let i: i32 = 0; i < __responseHeaderNames.length; i += 1) {
    if (!headerNameEquals(__responseHeaderNames[i], name)) {
      nextNames.push(__responseHeaderNames[i])
      nextValues.push(__responseHeaderValues[i])
    }
  }
  __responseHeaderNames = nextNames
  __responseHeaderValues = nextValues
}

export function pulse_result_text_compiled(ctx: usize, status: i32, body: string): void {
  __compiledResultStatus = status
  __compiledResultKind = COMPILED_RESULT_TEXT
  __compiledResultBody = body
  if (ctx != 0) pulse_set_result(changetype<PulseWasmDispatchState>(ctx), 1)
}
export function pulse_result_json_text_compiled(ctx: usize, status: i32, body: string): void {
  if (compiled_response_header_count_named('content-type') == 0) pulse_response_header_set_compiled(ctx, 'Content-Type', 'application/json')
  __compiledResultStatus = status
  __compiledResultKind = COMPILED_RESULT_JSON
  __compiledResultBody = body
  if (ctx != 0) pulse_set_result(changetype<PulseWasmDispatchState>(ctx), 1)
}
export function pulse_result_empty_compiled(ctx: usize, status: i32): void {
  __compiledResultStatus = status
  __compiledResultKind = COMPILED_RESULT_EMPTY
  __compiledResultBody = ''
  if (ctx != 0) pulse_set_result(changetype<PulseWasmDispatchState>(ctx), 1)
}

export function pulse_result_resolve_compiled(ctx: usize, boundaryIndex: i32): void {
  __compiledResultStatus = 0
  __compiledResultKind = COMPILED_RESULT_RESOLVE
  __compiledResultBody = ''
  __compiledResolveBoundaryIndex = boundaryIndex
  if (ctx != 0) pulse_set_result(changetype<PulseWasmDispatchState>(ctx), 1)
}

export function compiled_clear_resolved(): void {
  __resolvedNames = new Array<string>()
  __resolvedStatuses = new Array<i32>()
  __resolvedKinds = new Array<string>()
  __resolvedBodies = new Array<string>()
  __resolvedHeaderResultNames = new Array<string>()
  __resolvedHeaderNames = new Array<string>()
  __resolvedHeaderValues = new Array<string>()
}
export function compiled_set_resolved(name: string, status: i32, kind: string, body: string): void {
  __resolvedNames.push(name)
  __resolvedStatuses.push(status)
  __resolvedKinds.push(kind)
  __resolvedBodies.push(body)
}
export function compiled_set_resolved_utf8(namePtr: usize, nameLen: i32, status: i32, kindPtr: usize, kindLen: i32, bodyPtr: usize, bodyLen: i32): void {
  compiled_set_resolved(decodeUtf8(namePtr, nameLen), status, decodeUtf8(kindPtr, kindLen), decodeUtf8(bodyPtr, bodyLen))
}
export function compiled_set_resolved_header(name: string, headerName: string, value: string): void {
  __resolvedHeaderResultNames.push(name)
  __resolvedHeaderNames.push(headerName)
  __resolvedHeaderValues.push(value)
}
export function compiled_set_resolved_header_utf8(namePtr: usize, nameLen: i32, headerPtr: usize, headerLen: i32, valuePtr: usize, valueLen: i32): void {
  compiled_set_resolved_header(decodeUtf8(namePtr, nameLen), decodeUtf8(headerPtr, headerLen), decodeUtf8(valuePtr, valueLen))
}
function resolvedIndex(name: string): i32 {
  for (let i: i32 = 0; i < __resolvedNames.length; i += 1) { if (__resolvedNames[i] == name) return i }
  return -1
}
export function pulse_resolved_handle_compiled(ctx: usize, name: string): usize { return 0 }
export function pulse_resolved_status_compiled(ctx: usize, name: string): i32 {
  const index = resolvedIndex(name)
  return index >= 0 ? __resolvedStatuses[index] : 0
}
export function pulse_resolved_ok_compiled(ctx: usize, name: string): bool {
  const status = pulse_resolved_status_compiled(ctx, name)
  return status >= 200 && status < 300
}
export function pulse_resolved_text_compiled(ctx: usize, name: string): string {
  const index = resolvedIndex(name)
  return index >= 0 ? __resolvedBodies[index] : ''
}
export function pulse_resolved_json_handle_compiled(ctx: usize, name: string, schema: string): usize { return pulse_resolved_handle_compiled(ctx, name) }
export function pulse_resolved_json_text_compiled(ctx: usize, name: string): string { return pulse_resolved_text_compiled(ctx, name) }
export function pulse_resolved_header_compiled(ctx: usize, name: string, headerName: string): string {
  const lower = headerName.toLowerCase()
  for (let i: i32 = 0; i < __resolvedHeaderNames.length; i += 1) {
    if (__resolvedHeaderResultNames[i] == name && __resolvedHeaderNames[i].toLowerCase() == lower) return __resolvedHeaderValues[i]
  }
  return ''
}

export function compiled_resume_route_effect(routeRuntimeId: i32, boundaryIndex: i32): bool {
${resumeCases.length ? resumeCases.join('\n') : '  return false'}
  return false
}


${functions}
`;
}

function buildCompiledHandlerSlotsSource(dispatchTable) {
  const slots = (dispatchTable?.handlerSlots || []).slice().sort((a,b)=>Number(a.slot)-Number(b.slot));
  const imports = [];
  const routeCases=[]; const middlewareCases=[]; const lifecycleCases=[]; const errorCases=[]; const channelCases=[];
  for (const slot of slots) {
    const role = String((slot.roles || [])[0] || '').split(':')[0];
    const name = safeIdentifier(slot.exportName || slot.name || slot.id);
    const slotNum = Number(slot.slot) | 0;
    imports.push(name);
    if (role === 'route') routeCases.push(`    case ${slotNum}: ${name}(ctx, next); return true`);
    else if (role === 'middleware') middlewareCases.push(`    case ${slotNum}: ${name}(ctx, next); return true`);
    else if (role === 'lifecycle') lifecycleCases.push(`    case ${slotNum}: ${name}(ctx, next); return true`);
    else if (role === 'error') errorCases.push(`    case ${slotNum}: ${name}(err, ctx, next); return true`);
    else if (role === 'channel') channelCases.push(`    case ${slotNum}: return ${name}(ctx)`);
  }
  const uniqueImports = Array.from(new Set(imports)).sort();
  return `/*\n * Generated by PulseWasm Pass 31.\n * Compiled handler slots. No pulsewasm_handlers imports are emitted.\n */\nimport {\n  ROLE_ROUTE, ROLE_MIDDLEWARE, ROLE_LIFECYCLE, ROLE_ERROR, ROLE_CHANNEL\n} from './types.as'\nimport {\n  HANDLER_SLOT_COUNT, HANDLER_SLOT_IDS, HANDLER_SLOT_NAMES, HANDLER_ROLE_CODES, HANDLER_PARAM_COUNTS\n} from './route-table.as'\nimport {\n  ${uniqueImports.join(',\n  ')}\n} from './user-handlers.as'\n\nexport const HANDLER_BINDINGS_MODULE: string = 'compiled-wasm'\nexport const HANDLER_BINDING_COUNT: i32 = HANDLER_SLOT_COUNT\nexport function handlerSlotExists(slot: i32): bool { return slot >= 0 && slot < HANDLER_SLOT_COUNT }\nexport function handlerIdForSlot(slot: i32): string { return handlerSlotExists(slot) ? unchecked(HANDLER_SLOT_IDS[slot]) : '' }\nexport function handlerNameForSlot(slot: i32): string { return handlerSlotExists(slot) ? unchecked(HANDLER_SLOT_NAMES[slot]) : '' }\nexport function handlerRoleCodeForSlot(slot: i32): i32 { return handlerSlotExists(slot) ? unchecked(HANDLER_ROLE_CODES[slot]) : 0 }\nexport function handlerParamCountForSlot(slot: i32): i32 { return handlerSlotExists(slot) ? unchecked(HANDLER_PARAM_COUNTS[slot]) : -1 }\nexport function slotAcceptsRole(slot: i32, roleCode: i32): bool { return handlerSlotExists(slot) && handlerRoleCodeForSlot(slot) == roleCode }\nexport function invokeRouteHandlerBySlot(slot: i32, ctx: usize, next: usize): bool { if (!slotAcceptsRole(slot, ROLE_ROUTE)) return false; switch (slot) {\n${routeCases.join('\n')}\n    default: return false\n  } }\nexport function invokeMiddlewareHandlerBySlot(slot: i32, ctx: usize, next: usize): bool { if (!slotAcceptsRole(slot, ROLE_MIDDLEWARE)) return false; switch (slot) {\n${middlewareCases.join('\n')}\n    default: return false\n  } }\nexport function invokeLifecycleHandlerBySlot(slot: i32, ctx: usize, next: usize): bool { if (!slotAcceptsRole(slot, ROLE_LIFECYCLE)) return false; switch (slot) {\n${lifecycleCases.join('\n')}\n    default: return false\n  } }\nexport function invokeErrorHandlerBySlot(slot: i32, err: usize, ctx: usize, next: usize): bool { if (!slotAcceptsRole(slot, ROLE_ERROR)) return false; switch (slot) {\n${errorCases.join('\n')}\n    default: return false\n  } }\nexport function invokeChannelHandlerBySlot(slot: i32, ctx: usize): usize { if (!slotAcceptsRole(slot, ROLE_CHANNEL)) return 0; switch (slot) {\n${channelCases.join('\n')}\n    default: return 0\n  } }\nexport function invokeHandlerByRole(roleCode: i32, slot: i32, err: usize, ctx: usize, next: usize): bool {\n  if (roleCode == ROLE_ROUTE) return invokeRouteHandlerBySlot(slot, ctx, next)\n  if (roleCode == ROLE_MIDDLEWARE) return invokeMiddlewareHandlerBySlot(slot, ctx, next)\n  if (roleCode == ROLE_LIFECYCLE) return invokeLifecycleHandlerBySlot(slot, ctx, next)\n  if (roleCode == ROLE_ERROR) return invokeErrorHandlerBySlot(slot, err, ctx, next)\n  if (roleCode == ROLE_CHANNEL) return invokeChannelHandlerBySlot(slot, ctx) != 0\n  return false\n}\n`;
}

function buildSmokeRunnerSource(routeEffectPlan, requestJsonBodyPlan) {
  const plannedRoutes = plannedEffectRoutes(routeEffectPlan);
  const requestJsonPlan = normalizeRequestJsonBodyPlan(requestJsonBodyPlan);
  const requestJsonRoutes = Array.isArray(requestJsonPlan.routes) ? requestJsonPlan.routes.filter((route) => route.required) : [];
  const bridgeFns = [];
  for (let index = 0; index < plannedRoutes.length; index += 1) {
    const route = plannedRoutes[index];
    const methodCode = methodCodeExpression(route.method);
    const samplePath = sampleRoutePath(route);
    const missingPath = samplePath.replace(/abc/g, 'missing');
    const effectCount = (route.resolves || []).reduce((count, resolve) => count + (Array.isArray(resolve.effects) ? resolve.effects.length : 0), 0);
    const runtimeId = Number(route.runtimeId || 0) | 0;
    const defaultRun = routeHasJsonBackendRequestBody(route)
      ? `runRequestWithBody(${methodCode}, ${asString(samplePath)}, ${asString(sampleJsonBodyForRoute(route))})`
      : `runRequest(${methodCode}, ${asString(samplePath)})`;
    const missingRun = routeHasJsonBackendRequestBody(route)
      ? `runRequestWithBody(${methodCode}, ${asString(missingPath)}, ${asString(sampleJsonBodyForRoute(route))})`
      : `runRequest(${methodCode}, ${asString(missingPath)})`;
    bridgeFns.push(`export function bridge_run_effect_route_${index}(): i32 { ${defaultRun}; return compiled_result_kind() }`);
    bridgeFns.push(`export function bridge_run_effect_route_${index}_missing(): i32 { ${missingRun}; return compiled_result_kind() }`);
    bridgeFns.push(`export function bridge_route_${index}_runtime_id(): i32 { return ${runtimeId} }`);
    bridgeFns.push(`export function bridge_route_${index}_boundary_index(): i32 { return compiled_result_resolve_boundary_index() }`);
    bridgeFns.push(`export function bridge_route_${index}_effect_count(): i32 { return ${effectCount | 0} }`);
    bridgeFns.push(`export function bridge_smoke_route_${index}_is_resolve(): i32 { bridge_run_effect_route_${index}(); return compiled_result_kind() == COMPILED_RESULT_RESOLVE && compiled_result_resolve_boundary_index() >= 0 ? 1 : 0 }`);
  }
  for (let index = 0; index < requestJsonRoutes.length; index += 1) {
    const route = requestJsonRoutes[index];
    const methodCode = methodCodeExpression(route.method);
    const samplePath = sampleRoutePath(route);
    bridgeFns.push(`export function bridge_run_request_json_route_${index}(): i32 { runRequestWithBody(${methodCode}, ${asString(samplePath)}, '{"id":"body-123","name":"Body User","active":true}'); return compiled_result_status() }`);
    bridgeFns.push(`export function bridge_run_request_json_route_${index}_invalid(): i32 { runRequestWithBody(${methodCode}, ${asString(samplePath)}, 'not-json'); return compiled_result_status() }`);
    if (Array.isArray(route.modes) && route.modes.includes('schemaJson')) bridgeFns.push(`export function bridge_run_request_json_route_${index}_schema_missing(): i32 { runRequestWithBody(${methodCode}, ${asString(samplePath)}, '{"id":"body-123","name":"Body User"}'); return compiled_result_status() }`);
    bridgeFns.push(`export function bridge_request_json_route_${index}_body_read_count(): i32 { return compiled_request_body_read_count() }`);
    bridgeFns.push(`export function bridge_request_json_route_${index}_parse_count(): i32 { return compiled_request_json_parse_count() }`);
  }
  return `/* Generated by PulseWasm Pass 38. */
import { METHOD_GET, METHOD_POST, METHOD_HEAD, createDispatchState, stepDispatchState, STEP_INVOKE, invokeCurrentHandler, defaultStatusForStepResult } from '../as/index.as'
import {
  compiled_reset_result,
  compiled_reset_request_headers,
  compiled_set_request_header,
  compiled_reset_request_body,
  compiled_set_request_body_utf8,
  compiled_request_body_read_count,
  compiled_request_json_parse_count,
  compiled_result_status,
  compiled_result_kind,
  compiled_result_body,
  compiled_result_resolve_boundary_index,
  compiled_response_header_first,
  compiled_response_header_count_named,
  compiled_clear_resolved,
  compiled_alloc_utf8,
  compiled_set_resolved_utf8,
  compiled_set_resolved_header_utf8,
  compiled_result_body_utf8_len,
  compiled_result_body_utf8_ptr,
  compiled_result_header_count,
  compiled_result_header_name_utf8_len,
  compiled_result_header_name_utf8_ptr,
  compiled_result_header_value_utf8_len,
  compiled_result_header_value_utf8_ptr,
  compiled_resume_route_effect,
  COMPILED_RESULT_TEXT,
  COMPILED_RESULT_JSON,
  COMPILED_RESULT_RESOLVE
} from '../as/user-handlers.as'

function seedRequestHeaders(): void {
  compiled_reset_request_headers()
  compiled_set_request_header('X-Trace', 'alpha')
  compiled_set_request_header('x-trace', 'beta')
}

function runRequest(methodCode: i32, path: string): i32 {
  compiled_reset_result()
  compiled_reset_request_body()
  seedRequestHeaders()
  const state = createDispatchState(methodCode, path)
  let guard: i32 = 0
  while (guard < 64) {
    guard += 1
    const step = stepDispatchState(state)
    if (step != STEP_INVOKE) return defaultStatusForStepResult(step)
    invokeCurrentHandler(state)
    if (compiled_result_kind() == COMPILED_RESULT_RESOLVE) return 0
    if (compiled_result_status() != 0) return compiled_result_status()
  }
  return -999
}

function runRequestWithBody(methodCode: i32, path: string, body: string): i32 {
  compiled_reset_result()
  compiled_reset_request_body()
  seedRequestHeaders()
  const encoded = String.UTF8.encode(body)
  compiled_set_request_body_utf8(changetype<usize>(encoded), encoded.byteLength)
  const state = createDispatchState(methodCode, path)
  let guard: i32 = 0
  while (guard < 64) {
    guard += 1
    const step = stepDispatchState(state)
    if (step != STEP_INVOKE) return defaultStatusForStepResult(step)
    invokeCurrentHandler(state)
    if (compiled_result_kind() == COMPILED_RESULT_RESOLVE) return 0
    if (compiled_result_status() != 0) return compiled_result_status()
  }
  return -999
}

export function bridge_alloc_utf8(len: i32): usize { return compiled_alloc_utf8(len) }
export function bridge_set_request_body_utf8(bodyPtr: usize, bodyLen: i32): void { compiled_set_request_body_utf8(bodyPtr, bodyLen) }
export function bridge_request_body_read_count(): i32 { return compiled_request_body_read_count() }
export function bridge_request_json_parse_count(): i32 { return compiled_request_json_parse_count() }
export function bridge_set_resolved_response_utf8(namePtr: usize, nameLen: i32, status: i32, kindPtr: usize, kindLen: i32, bodyPtr: usize, bodyLen: i32): void { compiled_set_resolved_utf8(namePtr, nameLen, status, kindPtr, kindLen, bodyPtr, bodyLen) }
export function bridge_set_resolved_header_utf8(namePtr: usize, nameLen: i32, headerPtr: usize, headerLen: i32, valuePtr: usize, valueLen: i32): void { compiled_set_resolved_header_utf8(namePtr, nameLen, headerPtr, headerLen, valuePtr, valueLen) }
export function bridge_clear_resolved(): void { compiled_clear_resolved() }
export function bridge_resume(routeRuntimeId: i32, boundaryIndex: i32): i32 { compiled_reset_result(); if (compiled_resume_route_effect(routeRuntimeId, boundaryIndex)) return compiled_result_status(); return -404 }
export function bridge_result_kind(): i32 { return compiled_result_kind() }
export function bridge_result_status(): i32 { return compiled_result_status() }
export function bridge_result_body_utf8_len(): i32 { return compiled_result_body_utf8_len() }
export function bridge_result_body_utf8_ptr(): usize { return compiled_result_body_utf8_ptr() }
export function bridge_result_header_count(): i32 { return compiled_result_header_count() }
export function bridge_result_header_name_utf8_len(index: i32): i32 { return compiled_result_header_name_utf8_len(index) }
export function bridge_result_header_name_utf8_ptr(index: i32): usize { return compiled_result_header_name_utf8_ptr(index) }
export function bridge_result_header_value_utf8_len(index: i32): i32 { return compiled_result_header_value_utf8_len(index) }
export function bridge_result_header_value_utf8_ptr(index: i32): usize { return compiled_result_header_value_utf8_ptr(index) }

${bridgeFns.join('\n')}

export function smoke_compiled_get_realtime_status(): i32 { return runRequest(METHOD_GET, '/realtime/abc') }
export function smoke_compiled_get_realtime_body(): i32 { runRequest(METHOD_GET, '/realtime/abc'); return compiled_result_body() == 'realtime:abc' ? 1 : 0 }
export function smoke_compiled_post_compute_status(): i32 { return runRequest(METHOD_POST, '/compute/42') }
export function smoke_compiled_post_compute_body(): i32 { runRequest(METHOD_POST, '/compute/42'); return compiled_result_body() == 'compute:42' ? 1 : 0 }
export function smoke_compiled_fallthrough_status(): i32 { return runRequest(METHOD_GET, '/fall/abc') }
export function smoke_compiled_fallthrough_body(): i32 { runRequest(METHOD_GET, '/fall/abc'); return compiled_result_body() == 'fall:abc' ? 1 : 0 }
export function smoke_compiled_error_status(): i32 { return runRequest(METHOD_GET, '/fail') }
export function smoke_compiled_error_body(): i32 { runRequest(METHOD_GET, '/fail'); return compiled_result_body() == 'error:FAIL' ? 1 : 0 }
export function smoke_compiled_result_kind_text(): i32 { runRequest(METHOD_GET, '/realtime/abc'); return compiled_result_kind() == COMPILED_RESULT_TEXT ? 1 : 0 }
export function smoke_compiled_headers_status(): i32 { return runRequest(METHOD_GET, '/headers') }
export function smoke_compiled_headers_body(): i32 { runRequest(METHOD_GET, '/headers'); return compiled_result_body() == '{"trace":"alpha","second":"beta"}' ? 1 : 0 }
export function smoke_compiled_headers_json_kind(): i32 { runRequest(METHOD_GET, '/headers'); return compiled_result_kind() == COMPILED_RESULT_JSON ? 1 : 0 }
export function smoke_compiled_headers_content_type(): i32 { runRequest(METHOD_GET, '/headers'); return compiled_response_header_first('content-type') == 'application/json' ? 1 : 0 }
export function smoke_compiled_headers_set(): i32 { runRequest(METHOD_GET, '/headers'); return compiled_response_header_first('x-mode') == 'compiled' ? 1 : 0 }
export function smoke_compiled_headers_repeated(): i32 { runRequest(METHOD_GET, '/headers'); return compiled_response_header_count_named('grip-channel') == 2 ? 1 : 0 }
export function smoke_compiled_headers_delete(): i32 { runRequest(METHOD_GET, '/headers'); return compiled_response_header_first('x-delete') == '' ? 1 : 0 }
export function smoke_compiled_context_status(): i32 { return runRequest(METHOD_GET, '/context/abc') }
export function smoke_compiled_context_body(): i32 { runRequest(METHOD_GET, '/context/abc'); return compiled_result_body() == 'context:abc:GET:/context/abc' ? 1 : 0 }
export function smoke_compiled_context_header(): i32 { runRequest(METHOD_GET, '/context/abc'); return compiled_response_header_first('x-context') == 'pass31' ? 1 : 0 }
export function smoke_compiled_context_fallback_status(): i32 { return runRequest(METHOD_GET, '/context/xyz') }
export function smoke_compiled_context_fallback_body(): i32 { runRequest(METHOD_GET, '/context/xyz'); return compiled_result_body() == 'method:GET:/context/xyz' ? 1 : 0 }
`;
}

function writeStagedFiles(stagingDir, shape, core, compiledFiles) {
  const byFile = new Map();
  if (shape?.files) for (const f of shape.files) byFile.set(f.file, f.text);
  if (core?.files) for (const f of core.files) byFile.set(f.file, f.text);
  for (const f of compiledFiles) byFile.set(f.file, f.text);
  for (const [file, text] of byFile.entries()) { const abs = path.join(stagingDir, file); fs.mkdirSync(path.dirname(abs), { recursive:true }); fs.writeFileSync(abs, text, 'utf8'); }
  return Array.from(byFile.entries()).map(([file,text])=>({ file, bytes: Buffer.byteLength(text,'utf8'), sha256: sha256Text(text) }));
}

function compileAndSmoke({ cwd, outDir, shape, core, files, routeEffectPlan, requestJsonBodyPlan }) {
  const diagnostics = [];
  const asc = resolveAsc(cwd);
  if (!asc) {
    diagnostics.push({ phase:'compiled-handlers', code:'PULSEWASM_ASSEMBLYSCRIPT_ASC_MISSING', severity:'error', message:'AssemblyScript compiler dependency was not found.', hint:'Run npm install before compiled handler smoke.', loc:{file:'<compiled-handlers>'} });
    return { diagnostics, smoke: undefined, outputs: [] };
  }
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsewasm-compiled-handlers-'));
  const outputDir = path.join(outDir || getDefaultArtifactsDir(cwd), 'generated', 'compiled-handlers');
  fs.mkdirSync(outputDir, { recursive:true });
  const staged = writeStagedFiles(stagingDir, shape, core, files);
  const wasmFile = path.join(outputDir, 'pulsewasm-compiled-handlers.wasm');
  const watFile = path.join(outputDir, 'pulsewasm-compiled-handlers.wat');
  const entry = path.join(stagingDir, 'generated/as-smoke/compiled-handler-smoke-runner.as.ts');
  const ascArgs = [asc.script, entry, '--outFile', wasmFile, '--textFile', watFile, '--runtime', 'stub', '--noAssert'];
  const proc = spawnSync(asc.executable, ascArgs, { cwd, encoding:'utf8', maxBuffer: 1024*1024*16 });
  const warnings = parseAscWarnings(proc.stderr);
  if (proc.error || proc.status !== 0) {
    diagnostics.push({ phase:'compiled-handlers', code:'PULSEWASM_COMPILED_HANDLER_AS_COMPILE_FAILED', severity:'error', message:`Compiled handler AssemblyScript smoke failed${proc.status !== undefined ? ` with exit code ${proc.status}` : ''}.`, hint:'Inspect compiled-handler-smoke.json stderr/stdout.', loc:{file:'<compiled-handlers>'}, details:{ stdout: truncate(proc.stdout, 8000), stderr: truncate(proc.stderr,8000), exitCode: proc.status } });
  }
  const outputs=[]; if (fs.existsSync(wasmFile)) outputs.push(fileRecord(wasmFile,cwd,'compiled-handler-wasm')); if (fs.existsSync(watFile)) outputs.push(fileRecord(watFile,cwd,'compiled-handler-wat'));
  let smoke;
  if (diagnostics.length === 0 && fs.existsSync(wasmFile)) {
    const wasm = fs.readFileSync(wasmFile);
    const module = new WebAssembly.Module(wasm);
    const imports = WebAssembly.Module.imports(module);
    const importObject = { env: { abort(){ throw new Error('AssemblyScript abort'); } } };
    for (const imp of imports) { if (!importObject[imp.module]) importObject[imp.module] = {}; importObject[imp.module][imp.name] = () => 0; }
    const instance = new WebAssembly.Instance(module, importObject);
    const plannedRoutes = plannedEffectRoutes(routeEffectPlan);
    const checkDefs = plannedRoutes.length > 0
      ? plannedRoutes.map((_, index) => [`bridge_smoke_route_${index}_is_resolve`, 1])
      : [
        ['smoke_compiled_get_realtime_status', 200], ['smoke_compiled_get_realtime_body', 1],
        ['smoke_compiled_post_compute_status', 201], ['smoke_compiled_post_compute_body', 1],
        ['smoke_compiled_fallthrough_status', 202], ['smoke_compiled_fallthrough_body', 1],
        ['smoke_compiled_error_status', 500], ['smoke_compiled_error_body', 1],
        ['smoke_compiled_result_kind_text', 1],
        ['smoke_compiled_headers_status', 203], ['smoke_compiled_headers_body', 1],
        ['smoke_compiled_headers_json_kind', 1], ['smoke_compiled_headers_content_type', 1],
        ['smoke_compiled_headers_set', 1], ['smoke_compiled_headers_repeated', 1],
        ['smoke_compiled_headers_delete', 1],
        ['smoke_compiled_context_status', 204], ['smoke_compiled_context_body', 1],
        ['smoke_compiled_context_header', 1], ['smoke_compiled_context_fallback_status', 405],
        ['smoke_compiled_context_fallback_body', 1]
      ];
    const checks=[];
    for (const [name, expected] of checkDefs) {
      let actual, status='ok', message;
      try { const fn = instance.exports[name]; if (typeof fn !== 'function') { status='error'; message='Missing smoke export.'; } else { actual = fn(); if (actual !== expected) { status='error'; message=`Expected ${expected}, got ${actual}.`; } } } catch(e) { status='error'; message=e.message || String(e); }
      checks.push({ name, expected, actual, status, message });
    }
    smoke = { imports, exports: WebAssembly.Module.exports(module), checks, failedChecks: checks.filter(c=>c.status !== 'ok'), wasmBytes: wasm.length };
    if (smoke.failedChecks.length) diagnostics.push({ phase:'compiled-handlers', code:'PULSEWASM_COMPILED_HANDLER_SMOKE_FAILED', severity:'error', message:'Compiled handler smoke checks failed.', hint:'Inspect compiled-handler-smoke.json checks.', loc:{file:'<compiled-handlers>'} });
  }
  return { diagnostics, warnings, smoke, outputs, staged, command: { executable: asc.display, args: ascArgs.slice(1).map(arg => path.isAbsolute(arg) ? path.relative(cwd,arg).replace(/\\/g,'/') : arg) }, result: { exitCode: proc.status, stdout: truncate(proc.stdout), stderr: truncate(proc.stderr) } };
}

function buildCompiledUserHandlers(sourceFile, handlerTable, handlerEval, dispatchTable, assemblyScriptShape, assemblyScriptCore, options = {}) {
  const cwd = options.cwd || process.cwd();
  const outDir = options.outDir || getDefaultArtifactsDir(cwd);
  const nodes = collectHandlerNodes(sourceFile);
  const routeEffectIndex = options.routeHandlerEffectPlan ? routeEffectPlanIndex(options.routeHandlerEffectPlan) : undefined;
  const lowered = [];
  const diagnostics = [];
  for (const handler of handlerTable.handlers || []) {
    const nodeInfo = nodes.get(handler.localName || handler.exportName);
    const entry = lowerHandler(sourceFile, handler, nodeInfo, routeEffectIndex);
    lowered.push(entry);
    diagnostics.push(...entry.diagnostics);
  }
  if (routeEffectIndex) {
    for (const name of routeEffectIndex.continuationNames) {
      const nodeInfo = nodes.get(name);
      const handler = { id: `continuation_${name}`, localName: name, exportName: name, roles: ['continuation'], declaration: { exported: true }, loc: nodeInfo?.node ? sourceLoc(sourceFile, nodeInfo.node) : undefined };
      const entry = lowerHandler(sourceFile, handler, nodeInfo, routeEffectIndex);
      lowered.push(entry);
      diagnostics.push(...entry.diagnostics);
    }
  }
  const eligible = lowered.filter(e => e.status === 'ok').length;
  const userHandlersSource = buildUserHandlersSource(lowered, options.routeHandlerEffectPlan, options.requestJsonBodyPlan);
  const handlerSlotsSource = buildCompiledHandlerSlotsSource(dispatchTable);
  const files = [makeFile('generated/as/user-handlers.as.ts', userHandlersSource), makeFile('generated/as/handler-slots.as.ts', handlerSlotsSource), makeFile('generated/as-smoke/compiled-handler-smoke-runner.as.ts', buildSmokeRunnerSource(options.routeHandlerEffectPlan, options.requestJsonBodyPlan))];
  let smokeResult = { diagnostics: [], smoke: undefined, outputs: [] };
  if (diagnostics.length === 0 && options.compileSmoke !== false) {
    smokeResult = compileAndSmoke({ cwd, outDir, shape: assemblyScriptShape, core: assemblyScriptCore, files, routeEffectPlan: options.routeHandlerEffectPlan, requestJsonBodyPlan: options.requestJsonBodyPlan });
    diagnostics.push(...(smokeResult.diagnostics || []));
  }
  const artifact = normalizeArtifact({
    version: COMPILED_HANDLER_PLAN_VERSION,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    status: diagnostics.length ? 'error' : 'ok',
    policy: {
      phase: options.requestJsonBodyPlan ? '39' : options.routeHandlerEffectPlan ? '38' : '31',
      handlerExecutionMode: 'compiled-wasm',
      hostImportsRemovedForHandlers: true,
      userAuthoredLoops: false,
      effects: options.routeHandlerEffectPlan ? 'ctx.resolve(ctx.fetch(...), continuation) lowered to compiled resolve boundary' : 'recognized/planned by route-effect plan, unsupported in sync compiled-handler execution',
      asyncAwait: 'rejected; direct await on trusted effects is reserved for future lowering',
      arbitraryLibraries: false,
      contextLowering: defaultRouteHandlerContextLoweringPolicy(),
      sourceOfTruth: 'handler-table.json + handler-eval.json + source AST under compiled handler contract'
    },
    handlers: lowered.map((entry) => ({
      id: entry.handler.id,
      name: entry.handler.localName,
      exportName: entry.handler.exportName,
      role: entry.role,
      status: entry.status,
      loweredStatements: entry.loweredStatements || 0,
      contextCalls: (entry.contextCalls || []).map((call) => call.surface),
      ifStatementsLowered: entry.metrics ? entry.metrics.ifStatementsLowered : 0,
      diagnostics: entry.diagnostics.map(d => d.code)
    })),
    diagnostics,
    summary: {
      handlers: lowered.length,
      eligible,
      errors: lowered.length - eligible,
      generatedFiles: files.length,
      compiled: Boolean(smokeResult.smoke) && diagnostics.length === 0,
      smokeExecuted: Boolean(smokeResult.smoke),
      smokeChecks: smokeResult.smoke ? smokeResult.smoke.checks.length : 0,
      failedSmokeChecks: smokeResult.smoke ? smokeResult.smoke.failedChecks.length : 0,
      jsHandlerImports: false,
      wasmBytes: smokeResult.smoke ? smokeResult.smoke.wasmBytes : 0,
      contextCalls: lowered.reduce((count, entry) => count + (entry.contextCalls || []).length, 0),
      ifStatementsLowered: lowered.reduce((count, entry) => count + (entry.metrics ? entry.metrics.ifStatementsLowered : 0), 0),
      effectsRejected: lowered.reduce((count, entry) => count + (entry.metrics ? entry.metrics.effectsRejected : 0), 0),
      routeEffectBridge: Boolean(options.routeHandlerEffectPlan),
      requestJsonBodyLowering: Boolean(options.requestJsonBodyPlan)
    }
  }, cwd);
  const report = normalizeArtifact({
    version: HANDLER_LOWERING_REPORT_VERSION,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    status: diagnostics.length ? 'error' : 'ok',
    typePolicy: {
      number: 'lowered-to-f64', boolean: 'lowered-to-bool', string: 'string', integerTypes: ['i32','u32','i64','u64'], rejected: ['any','unknown','Promise<T>','union types','generics']
    },
    contextLowering: defaultRouteHandlerContextLoweringPolicy(),
    allowedCtxDsl: ['ctx.param','ctx.paramI32','ctx.request.method','ctx.request.path','ctx.state.get','ctx.state.set','ctx.request.header.first','ctx.request.header.count','ctx.request.header.at','ctx.response.header.set','ctx.response.header.append','ctx.response.header.delete','ctx.result.text','ctx.result.empty','ctx.result.jsonText','ctx.result.json','ctx.schema.encode','ctx.req.json','ctx.req.parse','requestJson.ok/getString/jsonText','resolved.json(Schema)','ctx.error','next','next(err)','if/else terminal branches'],
    allowedTsSubset: ROUTE_HANDLER_CONTEXT_EXPRESSION_SUBSET,
    rejected: ['for/while/do loops','async/await','try/catch/throw','dynamic calls','arbitrary member calls','conflicting linear outcomes','multi-channel return values','effects in compiled-wasm mode'],
    handlers: artifact.handlers,
    diagnostics,
    summary: artifact.summary
  }, cwd);
  const hardening = normalizeArtifact({
    version: COMPILED_HANDLER_HARDENING_VERSION,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    status: diagnostics.length ? 'error' : 'ok',
    phase: '31',
    contract: {
      terminalOutcomePolicy: 'one terminal outcome per linear handler path',
      parameterNamesRequired: true,
      headerDslProven: true,
      requestMethodPathDslProven: true,
      ifElseBranchLoweringProven: true,
      jsonTextResultProven: true,
      channelMultiValue: 'reserved; single string channel only in Pass 31',
      localHelpers: 'reserved unless directly lowerable by current handler source pass',
      effects: 'recognized but unsupported',
      requestJsonBody: options.requestJsonBodyPlan ? 'ctx.req.json/parse lazy body decode lowered to cached request-json refs' : 'planned-only',
      loops: 'user-authored loops rejected; generated/runtime loops allowed'
    },
    proven: [
      'compiled request method/path DSL',
      'compiled if/else branch lowering for synchronous context handlers',
      'compiled request header first/count/at DSL',
      'compiled response header set/append/delete DSL',
      'jsonText/result.json result kind and Content-Type behavior',
      'repeated response headers are preserved in compiled smoke',
      'conflicting linear handler outcomes are rejected',
      'role parameter names are enforced',
      'ctx.request.method/path are lowered from compiled dispatch state',
      'AS-clean if/else branches are lowered for synchronous ctx paths',
      'multi-channel compiled return is explicitly deferred'
    ],
    deferred: [
      'string[] channel lowering',
      'inline continuation lifting',
      'compiled effect execution',
      'general local helper module lowering',
      'non-terminal branch data-flow analysis'
    ],
    diagnostics,
    summary: {
      handlers: lowered.length,
      eligible,
      errors: lowered.length - eligible,
      headerDslSmokeChecks: smokeResult.smoke ? smokeResult.smoke.checks.filter((c) => c.name.includes('headers')).length : 0,
      failedSmokeChecks: smokeResult.smoke ? smokeResult.smoke.failedChecks.length : 0,
      conflictingOutcomeDiagnostics: diagnostics.filter((d) => d.code === 'PULSEWASM_COMPILED_HANDLER_CONFLICTING_OUTCOME').length,
      parameterNameDiagnostics: diagnostics.filter((d) => d.code === 'PULSEWASM_COMPILED_HANDLER_PARAMETER_NAME_MISMATCH').length,
      channelMultiValueDiagnostics: diagnostics.filter((d) => d.code === 'PULSEWASM_COMPILED_CHANNEL_MULTI_VALUE_RESERVED').length
    }
  }, cwd);


  const contextSurfaces = new Map();
  for (const entry of lowered) {
    for (const call of entry.contextCalls || []) contextSurfaces.set(call.surface, (contextSurfaces.get(call.surface) || 0) + 1);
  }
  const contextLowering = normalizeArtifact({
    version: ROUTE_HANDLER_CONTEXT_LOWERING_VERSION,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    status: diagnostics.length ? 'error' : 'ok',
    phase: ROUTE_HANDLER_CONTEXT_LOWERING_PHASE,
    artifact: ROUTE_HANDLER_CONTEXT_LOWERING_ARTIFACT,
    policy: defaultRouteHandlerContextLoweringPolicy(),
    syncSurface: [...ROUTE_HANDLER_CONTEXT_SYNC_SURFACE],
    reservedSurface: [...ROUTE_HANDLER_CONTEXT_RESERVED_SURFACE],
    expressionSubset: JSON.parse(JSON.stringify(ROUTE_HANDLER_CONTEXT_EXPRESSION_SUBSET)),
    handlers: lowered.map((entry) => ({
      id: entry.handler.id,
      name: entry.handler.localName,
      exportName: entry.handler.exportName,
      role: entry.role,
      status: entry.status,
      contextCalls: entry.contextCalls || [],
      contextCallSurfaces: (entry.contextCalls || []).map((call) => call.surface),
      ifStatementsLowered: entry.metrics ? entry.metrics.ifStatementsLowered : 0,
      effectsRejected: entry.metrics ? entry.metrics.effectsRejected : 0,
      diagnostics: entry.diagnostics.map((d) => d.code)
    })),
    diagnostics,
    summary: {
      handlers: lowered.length,
      eligible,
      errors: lowered.length - eligible,
      contextCalls: lowered.reduce((count, entry) => count + (entry.contextCalls || []).length, 0),
      surfaces: Array.from(contextSurfaces.entries()).map(([surface, count]) => ({ surface, count })).sort((a,b) => a.surface.localeCompare(b.surface)),
      requestMethodCalls: contextSurfaces.get('ctx.request.method') || 0,
      requestPathCalls: contextSurfaces.get('ctx.request.path') || 0,
      ifStatementsLowered: lowered.reduce((count, entry) => count + (entry.metrics ? entry.metrics.ifStatementsLowered : 0), 0),
      effectsRejected: lowered.reduce((count, entry) => count + (entry.metrics ? entry.metrics.effectsRejected : 0), 0),
      routeEffectBridge: Boolean(options.routeHandlerEffectPlan),
      requestJsonBodyLowering: Boolean(options.requestJsonBodyPlan),
      providerBehaviorImplemented: false,
      effectExecutionImplemented: false,
      smokeExecuted: Boolean(smokeResult.smoke),
      failedSmokeChecks: smokeResult.smoke ? smokeResult.smoke.failedChecks.length : 0
    }
  }, cwd);

  const smokeArtifact = normalizeArtifact({
    version: COMPILED_HANDLER_SMOKE_VERSION,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    status: diagnostics.length ? 'error' : 'ok',
    policy: { phase: '31', wasmCompiled: Boolean(smokeResult.outputs?.length), wasmExecuted: Boolean(smokeResult.smoke), handlerImports: 'compiled AS user handlers; no pulsewasm_handlers import module' },
    command: smokeResult.command,
    result: smokeResult.result,
    generated: { inputFiles: smokeResult.staged || [], outputFiles: smokeResult.outputs || [] },
    checks: smokeResult.smoke ? smokeResult.smoke.checks : [],
    diagnostics,
    warnings: smokeResult.warnings || [],
    summary: { compiled: Boolean(smokeResult.outputs?.length) && diagnostics.length === 0, executed: Boolean(smokeResult.smoke), checks: smokeResult.smoke ? smokeResult.smoke.checks.length : 0, failedChecks: smokeResult.smoke ? smokeResult.smoke.failedChecks.length : 0, diagnostics: diagnostics.length, warnings: (smokeResult.warnings || []).length, jsHandlerImports: false }
  }, cwd);
  return { artifact, report, hardening, contextLowering, smoke: smokeArtifact, files, outputFiles: smokeResult.outputs || [], diagnostics };
}

module.exports = { buildCompiledUserHandlers };
