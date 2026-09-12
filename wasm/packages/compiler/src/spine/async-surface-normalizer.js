'use strict';

const ts = require('typescript');
const {
  HANDLER_AUTHORING_MODES
} = require('@pulse-compute/wasm-contracts/handler/surface-contract');
const {
  recognizeHandlerSurface,
  extractKvNamespaceDeclaration,
  unwrapExpression
} = require('./handler-surface-authority.js');
const {
  createCanonicalDiagnostic,
  createHandlerDiagnostic
} = require('./diagnostic-authority.js');

const ASYNC_SURFACE_NORMALIZER_VERSION = 'pulse.async-surface-normalizer.v2';

function warning(frontend, sourceFile, node, code, message, detail = {}) {
  return createCanonicalDiagnostic({
    frontend,
    sourceFile,
    node,
    code,
    message,
    detail,
    severity: 'warning'
  });
}

function modifiersWithoutAsync(node) {
  const current = node.modifiers || [];
  const next = current.filter((modifier) => modifier.kind !== ts.SyntaxKind.AsyncKeyword);
  return next.length === current.length ? node.modifiers : next;
}

function updateFunctionWithoutAsync(node, body) {
  const modifiers = modifiersWithoutAsync(node);
  if (ts.isFunctionDeclaration(node)) {
    return ts.factory.updateFunctionDeclaration(node, modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body);
  }
  if (ts.isFunctionExpression(node)) {
    return ts.factory.updateFunctionExpression(node, modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body);
  }
  if (ts.isArrowFunction(node)) {
    return ts.factory.updateArrowFunction(node, modifiers, node.typeParameters, node.parameters, node.type, node.equalsGreaterThanToken, body);
  }
  if (ts.isMethodDeclaration(node)) {
    return ts.factory.updateMethodDeclaration(node, modifiers, node.asteriskToken, node.name, node.questionToken, node.typeParameters, node.parameters, node.type, body);
  }
  return node;
}

function directReturnExpression(node) {
  let current = node;
  let parent = current && current.parent;
  while (parent && (
    ts.isParenthesizedExpression(parent)
    || ts.isAsExpression(parent)
    || ts.isSatisfiesExpression?.(parent)
    || ts.isNonNullExpression(parent)
    || ts.isTypeAssertionExpression(parent)
  )) {
    current = parent;
    parent = current.parent;
  }
  return Boolean(parent && ts.isReturnStatement(parent) && parent.expression === current);
}

function resolveHandlerAuthoringMode(options = {}) {
  const explicit = options.handlerAuthoring;
  if (explicit !== undefined) {
    if (!Object.values(HANDLER_AUTHORING_MODES).includes(explicit)) {
      throw new TypeError(`Unknown Pulse handler authoring mode: ${explicit}`);
    }
    return explicit;
  }
  return options.requireAsync === true
    ? HANDLER_AUTHORING_MODES.ASYNC_REQUIRED
    : HANDLER_AUTHORING_MODES.SYNCHRONOUS_COMPATIBILITY;
}

function normalizeManagedHandler(functionNode, options = {}) {
  if (!functionNode || !ts.isFunctionLike(functionNode)) throw new TypeError('normalizeManagedHandler requires a function-like node.');
  const sourceFile = options.sourceFile;
  const ctxName = options.ctxName || 'ctx';
  const nextName = options.nextName;
  const frontend = options.frontend || 'canonical-source';
  const strict = options.strict !== false;
  const handlerAuthoring = resolveHandlerAuthoringMode(options);
  const requireAsync = handlerAuthoring === HANDLER_AUTHORING_MODES.ASYNC_REQUIRED;
  const requireEffectAwait = options.requireEffectAwait === true;
  const diagnostics = [];
  const warnings = [];
  const changes = [];
  let kvAliases = new Map();
  const awaitedRoots = new WeakSet();
  const parallelMemberRoots = new WeakSet();
  const userAuthoredAsync = (functionNode.modifiers || []).some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  const enforceEffectAwait = userAuthoredAsync || requireEffectAwait;
  let awaitCount = 0;
  let effectAwaitCount = 0;
  let syncAwaitCount = 0;
  let missingEffectAwaitCount = 0;

  if (requireAsync && !userAuthoredAsync) {
    diagnostics.push(createHandlerDiagnostic({
      frontend,
      issue: 'handler.async.required',
      sourceFile,
      node: functionNode,
      values: { role: options.role || 'handler' },
      detail: { role: options.role || 'handler', handlerAuthoring }
    }));
  }

  function surfaceFor(node, position) {
    return recognizeHandlerSurface(node, {
      ctxName,
      kvAliases,
      nextName,
      role: options.role,
      strict,
      packageEffectForCall: options.packageEffectForCall,
      unwrap: true,
      position
    });
  }

  const transformer = (context) => {
    function visit(node) {
      if (ts.isBlock(node)) {
        const inherited = kvAliases; kvAliases = new Map(inherited);
        try { return ts.visitEachChild(node, visit, context); } finally { kvAliases = inherited; }
      }
      if (ts.isVariableStatement(node)) {
        const namespace = extractKvNamespaceDeclaration(node, ctxName, { unwrap: true });
        for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) kvAliases.delete(declaration.name.text);
        if (namespace) kvAliases.set(namespace.variableName, namespace.store);
      }
      if (node !== functionNode && ts.isFunctionLike(node)) {
        const nestedAsync = (node.modifiers || []).some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
        if (nestedAsync) diagnostics.push(createHandlerDiagnostic({
          frontend,
          issue: 'handler.nested-async-function.unsupported',
          sourceFile,
          node
        }));
        return node;
      }

      if (ts.isAwaitExpression(node)) {
        awaitCount += 1;
        const inner = unwrapExpression(node.expression);
        const surface = surfaceFor(inner, 'await-expression');
        if (!surface || surface.surfaceId === 'javascript.await' || surface.class === 'javascript-only') {
          diagnostics.push(createHandlerDiagnostic({
            frontend,
            issue: 'handler.await.native-unsupported',
            sourceFile,
            node,
            values: { expression: inner && inner.getText ? inner.getText(sourceFile) : '<unknown>' },
            detail: { selectedTarget: options.target || 'native', automaticFallback: false }
          }));
          return ts.visitNode(node.expression, visit);
        }
        awaitedRoots.add(inner);
        if (surface.surfaceId === 'ctx.parallel') {
          const record = surface.detail && surface.detail.parallel && surface.detail.parallel.record;
          if (record && ts.isObjectLiteralExpression(record)) {
            for (const property of record.properties) {
              if (ts.isPropertyAssignment(property)) parallelMemberRoots.add(unwrapExpression(property.initializer));
            }
          }
        }
        if (surface.classification && surface.classification.ok === false) {
          diagnostics.push(createCanonicalDiagnostic({
            frontend,
            sourceFile,
            node,
            code: surface.classification.code,
            message: surface.classification.message,
            detail: { surfaceId: surface.surfaceId, strict }
          }));
          return ts.visitNode(node.expression, visit);
        }
        if (surface.surfaceId === 'router.next') {
          diagnostics.push(createCanonicalDiagnostic({
            frontend,
            sourceFile,
            node,
            code: 'PULSE_ROUTER_NEXT_TERMINAL',
            message: 'next() is a terminal Router control transfer and must be returned directly.',
            detail: { surfaceId: surface.surfaceId }
          }));
          return ts.visitNode(node.expression, visit);
        }
        if (surface.awaitPolicy === 'synchronous-statement-only') {
          diagnostics.push(createCanonicalDiagnostic({
            frontend,
            sourceFile,
            node,
            code: 'PULSE_LOG_AWAIT_FORBIDDEN',
            message: `${surface.surfaceId} is synchronous, returns void, and must not be awaited.`,
            detail: { surfaceId: surface.surfaceId }
          }));
          return ts.visitNode(node.expression, visit);
        }
        if (surface.class === 'effect' || surface.class === 'package-owned') {
          effectAwaitCount += 1;
          changes.push(Object.freeze({ kind: 'effect-await-erased', surfaceId: surface.surfaceId }));
          return ts.visitNode(node.expression, visit);
        }
        if (surface.class === 'sync') {
          syncAwaitCount += 1;
          warnings.push(warning(
            frontend,
            sourceFile,
            node,
            'PULSE_AWAIT_SYNC_REDUNDANT',
            `await is redundant for synchronous Pulse surface ${surface.surfaceId}; native lowering erases it.`,
            { surfaceId: surface.surfaceId }
          ));
          changes.push(Object.freeze({ kind: 'sync-await-erased', surfaceId: surface.surfaceId }));
          return ts.visitNode(node.expression, visit);
        }
        diagnostics.push(createHandlerDiagnostic({
          frontend,
          issue: 'handler.await.native-unsupported',
          sourceFile,
          node,
          values: { expression: inner && inner.getText ? inner.getText(sourceFile) : '<unknown>' }
        }));
        return ts.visitNode(node.expression, visit);
      }

      if (ts.isCallExpression(node)) {
        const surface = surfaceFor(node, directReturnExpression(node) ? 'return' : 'expression');
        if (surface) {
          const awaited = awaitedRoots.has(unwrapExpression(node));
          if (surface.classification && surface.classification.ok === false && !awaited) {
            diagnostics.push(createCanonicalDiagnostic({
              frontend,
              sourceFile,
              node,
              code: surface.classification.code,
              message: surface.classification.message,
              detail: { surfaceId: surface.surfaceId, strict }
            }));
          } else if (surface.surfaceId === 'router.next') {
            // Router terminal validation owns the exact return-position checks.
          } else if (enforceEffectAwait && (surface.class === 'effect' || surface.class === 'package-owned')
            && !awaitedRoots.has(unwrapExpression(node)) && !parallelMemberRoots.has(unwrapExpression(node))) {
            const returnAdopted = directReturnExpression(node) && (
              surface.awaitPolicy === 'return-adopted-or-required'
              || (surface.class === 'package-owned' && surface.detail && surface.detail.packageEffect && surface.detail.packageEffect.placement === 'return')
            );
            if (!returnAdopted) {
              missingEffectAwaitCount += 1;
              diagnostics.push(createCanonicalDiagnostic({
                frontend,
                sourceFile,
                node,
                code: 'PULSE_EFFECT_AWAIT_REQUIRED',
                message: `Pulse effect ${surface.surfaceId} must be awaited before its value is consumed.`,
                detail: { surfaceId: surface.surfaceId, awaitPolicy: surface.awaitPolicy }
              }));
            }
          }
          if (surface.surfaceId === 'ctx.parallel') {
            // The outer combinator owns its statically keyed effect members. Visiting
            // those calls as independent expressions would incorrectly diagnose each
            // member as a missing await before Handler IR can validate the group.
            return node;
          }
          // The recognized call owns its receiver chain. Visit only arguments so nested
          // effects in argument expressions still receive deterministic diagnostics.
          const argumentsArray = node.arguments.map((argument) => ts.visitNode(argument, visit));
          if (argumentsArray.every((argument, index) => argument === node.arguments[index])) return node;
          return ts.factory.updateCallExpression(node, node.expression, node.typeArguments, argumentsArray);
        }
      }

      return ts.visitEachChild(node, visit, context);
    }

    return (root) => {
      const body = root.body ? ts.visitNode(root.body, visit) : root.body;
      const updated = updateFunctionWithoutAsync(root, body);
      if (updated !== root && userAuthoredAsync) changes.push(Object.freeze({ kind: 'async-wrapper-erased' }));
      return updated;
    };
  };

  const result = ts.transform(functionNode, [transformer]);
  const transformed = result.transformed[0];
  result.dispose();
  const normalized = changes.length > 0 ? transformed : functionNode;

  return Object.freeze({
    version: ASYNC_SURFACE_NORMALIZER_VERSION,
    functionNode: normalized,
    diagnostics: Object.freeze(diagnostics),
    warnings: Object.freeze(warnings),
    summary: Object.freeze({
      changed: changes.length > 0,
      userAuthoredAsync,
      handlerAuthoring,
      requireAsync,
      requireEffectAwait: enforceEffectAwait,
      awaitCount,
      effectAwaitCount,
      syncAwaitCount,
      missingEffectAwaitCount,
      changes: Object.freeze(changes)
    })
  });
}

module.exports = Object.freeze({
  ASYNC_SURFACE_NORMALIZER_VERSION,
  resolveHandlerAuthoringMode,
  normalizeManagedHandler
});
