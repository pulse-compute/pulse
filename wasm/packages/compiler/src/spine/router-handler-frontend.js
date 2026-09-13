'use strict';

const crypto = require('node:crypto');
const ts = require('typescript');
const {
  unwrapExpression,
  staticString,
  recognizeManagedHandlerWrapper,
  recognizeHandlerSurface,
  sourceModelForRouterRecognition
} = require('./handler-surface-authority.js');
const { normalizeManagedHandler } = require('./async-surface-normalizer.js');
const {
  createHandlerDiagnostic
} = require('./diagnostic-authority.js');
const {
  HANDLER_IR_VERSION,
  ROUTER_HANDLER_IR_KIND,
  createHandlerOperation
} = require('./handler-ir.js');
const {
  diagnostic,
  expectedSignature,
  CanonicalRouterCompileError
} = require('./router-topology-frontend.js');

const {
  ROUTER_CURSOR_IDENTIFIER: CURSOR,
  ROUTER_MODE_IDENTIFIER: MODE,
  ROUTER_ERROR_IDENTIFIER: ERROR
} = require('./router-control-contract.js');

const ROUTER_HANDLER_FRONTEND_VERSION = 'pulse.router-handler-frontend.v1';

function directNextCall(statement, nextName) {
  if (!ts.isReturnStatement(statement) || !statement.expression) return undefined;
  const expression = unwrapExpression(statement.expression);
  const surface = recognizeHandlerSurface(expression, { nextName, position: 'return', unwrap: true });
  return surface && surface.surfaceId === 'router.next' ? expression : undefined;
}

function isReferenceIdentifier(node) {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isCallExpression(parent) && unwrapExpression(parent.expression) === node) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node && !ts.isComputedPropertyName(parent.name)) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) && parent.name === node) return false;
  if (ts.isTypeReferenceNode(parent) && parent.typeName === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  if (ts.isLabeledStatement(parent) && parent.label === node) return false;
  if ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) return false;
  return true;
}

function validateFunctionSignature(sourceFile, functionNode, role, diagnostics) {
  const expected = expectedSignature(role);
  if (!functionNode) return undefined;
  if (functionNode.asteriskToken) diagnostics.push(createHandlerDiagnostic({
    frontend: 'canonical-router',
    issue: 'handler.generator.unsupported',
    sourceFile,
    node: functionNode
  }));
  const names = functionNode.parameters.map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : undefined);
  const matches = expected && expected.names.some((candidate) => candidate.length === names.length && candidate.every((name, index) => names[index] === name));
  if (!matches) diagnostics.push(createHandlerDiagnostic({
    frontend: 'canonical-router',
    issue: 'handler.signature.invalid',
    sourceFile,
    node: functionNode,
    values: { role, expected: expected.display },
    detail: { role, expected: expected.display, actual: names }
  }));
  return Object.freeze({
    ctxName: role === 'error' ? names[1] : names[0],
    nextName: role === 'route' && names.length === 1 ? undefined : names[role === 'error' ? 2 : 1],
    errorName: role === 'error' ? names[0] : undefined
  });
}

function emptySchemaBundle(fileName) {
  const sourceHash = crypto.createHash('sha256').update(`router-handler:${fileName}`).digest('hex');
  return Object.freeze({
    active: false,
    registry: Object.freeze([]),
    schemaIds: Object.freeze([]),
    sourceHash,
    declarationSource: '',
    moduleSource: ''
  });
}

function entrySurfaceFacts(recognition, classification, entryStableId) {
  const recognizedFacts = recognition.facts.filter((fact) => fact.routerEntryStableId === entryStableId);
  const classifiedFacts = classification.facts.filter((fact) => fact.routerEntryStableId === entryStableId);
  function summary(facts) {
    return Object.freeze({
      total: facts.length,
      byClass: Object.freeze(Object.fromEntries([...new Set(facts.map((fact) => fact.class))].sort().map((className) => [className, facts.filter((fact) => fact.class === className).length]))),
      bySurface: Object.freeze(Object.fromEntries([...new Set(facts.map((fact) => fact.surfaceId))].sort().map((surfaceId) => [surfaceId, facts.filter((fact) => fact.surfaceId === surfaceId).length])))
    });
  }
  return Object.freeze({
    recognition: Object.freeze({
      version: recognition.version,
      contractVersion: recognition.contractVersion,
      file: recognition.file,
      handlerCount: 1,
      facts: Object.freeze(recognizedFacts),
      summary: summary(recognizedFacts)
    }),
    classification: Object.freeze({
      version: classification.version,
      contractVersion: classification.contractVersion,
      file: classification.file,
      handlerCount: 1,
      facts: Object.freeze(classifiedFacts),
      summary: summary(classifiedFacts)
    })
  });
}

function analysisForSurfaceFacts(surfaceFacts) {
  const facts = surfaceFacts.classification.facts;
  const capabilities = new Set();
  let fetchCount = 0;
  for (const fact of facts) {
    if (fact.surfaceId.startsWith('ctx.fetch.')) { capabilities.add('fetch'); fetchCount += 1; continue; }
    if (fact.surfaceId.startsWith('ctx.req.')) capabilities.add(fact.surfaceId.slice('ctx.'.length));
    else if (fact.surfaceId.startsWith('ctx.config.')) capabilities.add('config.get');
    else if (fact.surfaceId.startsWith('ctx.secret.')) capabilities.add('secret.get');
    else if (fact.surfaceId.startsWith('ctx.kv.')) capabilities.add(fact.surfaceId.slice('ctx.'.length));
    else if (fact.surfaceId.startsWith('ctx.state.')) capabilities.add(fact.surfaceId.slice('ctx.'.length));
    else if (fact.surfaceId === 'ctx.emit') capabilities.add('event.emit');
    else if (fact.surfaceId.startsWith('ctx.log.')) capabilities.add('logging');
    else if (['ctx.json', 'ctx.text', 'ctx.response'].includes(fact.surfaceId)) capabilities.add(`response.${fact.surfaceId.slice('ctx.'.length)}`);
    else if (fact.surfaceId === 'ctx.param') capabilities.add('route.param');
  }
  return Object.freeze({
    capabilities: Object.freeze([...capabilities].sort()),
    providerOperations: Object.freeze([]),
    fetchCount,
    schemaReferences: Object.freeze([])
  });
}

function normalizeRouterHandler(topology, descriptor, recognition, classification, diagnostics) {
  const sourceFile = descriptor.sourceFile || topology.sourceFile;
  const fileName = descriptor.fileName || sourceFile.fileName || topology.fileName;
  const { functionNode: authoredFunctionNode, role, entry, route } = descriptor;
  let functionNode = authoredFunctionNode;
  if (!functionNode) {
    diagnostics.push(diagnostic(sourceFile, sourceFile, 'PULSE_CANONICAL_ROUTER_HANDLER_MISSING', `Unable to recover ${role} handler ${descriptor.handler && descriptor.handler.name || '<unknown>'} from the retained handler table.`, { entry: entry.index }));
    return Object.freeze({
      version: ROUTER_HANDLER_FRONTEND_VERSION,
      frontend: 'canonical-router-handler',
      fileName,
      sourceFile,
      sourceText: '',
      functionNode,
      descriptor,
      role,
      entry,
      route,
      signature: Object.freeze({ ctxName: 'ctx', nextName: undefined, errorName: undefined }),
      transferFlag: `__pulse_router_transferred_${entry.index}`,
      body: createHandlerOperation('block', { statement: ts.factory.createBlock([], true), statements: Object.freeze([]) }),
      analysis: Object.freeze({ capabilities: Object.freeze([]), providerOperations: Object.freeze([]), fetchCount: 0, schemaReferences: Object.freeze([]) }),
      schemaBundle: emptySchemaBundle(fileName),
      flow: Object.freeze({ mayTransfer: false, mustTerminate: false }),
      surfaceFacts: entrySurfaceFacts(recognition, classification, entry.stableId)
    });
  }

  const signature = validateFunctionSignature(sourceFile, functionNode, role, diagnostics) || {};
  const ctxName = signature.ctxName || 'ctx';
  const nextName = signature.nextName;
  const errorName = signature.errorName;
  const packageEffectsByStart = new Map();
  for (const effect of topology.options && topology.options.packageEffects || []) {
    const start = effect && effect.range && Number(effect.range.start);
    if (Number.isSafeInteger(start) && !packageEffectsByStart.has(start)) packageEffectsByStart.set(start, effect);
  }
  const normalized = normalizeManagedHandler(authoredFunctionNode, {
    sourceFile,
    ctxName,
    nextName,
    role,
    strict: Boolean(topology.options && topology.options.strict === true),
    frontend: 'canonical-router',
    target: topology.options && topology.options.target,
    handlerAuthoring: topology.options && topology.options.handlerAuthoring,
    requireAsync: topology.options && topology.options.requireAsync === true,
    requireEffectAwait: topology.options && topology.options.requireEffectAwait === true,
    packageEffectForCall: topology.options && topology.options.packageEffectForCall
      || ((call) => packageEffectsByStart.get(call.getStart(sourceFile)))
  });
  diagnostics.push(...normalized.diagnostics);
  functionNode = normalized.functionNode;
  const params = new Set(route && route.params || []);
  const transferFlag = `__pulse_router_transferred_${entry.index}`;

  function scan(node, root = false, parentNode) {
    if (!root && ts.isFunctionLike(node)) {
      diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'handler.nested-function.unsupported', sourceFile, node }));
      return;
    }
    if (ts.isThrowStatement(node)) diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'handler.throw.unsupported', sourceFile, node }));
    const nextSurface = recognizeHandlerSurface(node, { nextName, unwrap: true });
    if (nextSurface && nextSurface.surfaceId === 'router.next') {
      const parent = node.parent || parentNode;
      const expressionBodyReturn = ts.isArrowFunction(functionNode) && unwrapExpression(functionNode.body) === node;
      if ((!ts.isReturnStatement(parent) || unwrapExpression(parent.expression) !== node) && !expressionBodyReturn) {
        diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'router.next.not-terminal', sourceFile, node }));
      }
      if (node.arguments.length > 1) diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'router.next.arity', sourceFile, node }));
    } else if (nextName && ts.isIdentifier(node) && node.text === nextName && isReferenceIdentifier(node)) {
      diagnostics.push(createHandlerDiagnostic({
        frontend: 'canonical-router',
        issue: 'router.next.not-terminal',
        sourceFile,
        node,
        values: { reference: true }
      }));
    }
    const contextSurface = recognizeHandlerSurface(node, { ctxName, unwrap: true });
    if (contextSurface) {
      const httpOnly = contextSurface.surfaceId === 'ctx.param'
        || contextSurface.surfaceId.startsWith('ctx.req.')
        || ['ctx.json', 'ctx.text', 'ctx.response'].includes(contextSurface.surfaceId);
      const eventOnly = contextSurface.surfaceId.startsWith('ctx.event.');
      if (role === 'event' && httpOnly) diagnostics.push(diagnostic(
        sourceFile,
        node,
        'PULSE_EVENT_CONTEXT_HTTP_SURFACE_UNSUPPORTED',
        `Event handlers cannot use HTTP-only surface ${contextSurface.surfaceId}.`,
        { role, surfaceId: contextSurface.surfaceId }
      ));
      if (role !== 'event' && eventOnly) diagnostics.push(diagnostic(
        sourceFile,
        node,
        'PULSE_HTTP_CONTEXT_EVENT_SURFACE_UNSUPPORTED',
        `HTTP handlers cannot use event-only surface ${contextSurface.surfaceId}.`,
        { role, surfaceId: contextSurface.surfaceId }
      ));
    }
    if (errorName && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === errorName) {
      diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'router.error.shadowed', sourceFile, node, values: { errorName } }));
    }
    ts.forEachChild(node, (child) => scan(child, false, node));
  }
  scan(functionNode.body, true, functionNode);

  const rewriteTransformer = (context) => {
    const visit = (node) => {
      if (errorName && ts.isShorthandPropertyAssignment(node) && node.name.text === errorName) {
        return ts.factory.createPropertyAssignment(ts.factory.createIdentifier(errorName), ts.factory.createIdentifier(ERROR));
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const target = node.expression;
        const surface = recognizeHandlerSurface(node, { ctxName });
        if (surface && surface.surfaceId === 'ctx.param') {
          if (role !== 'route') {
            diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'context.param.outside-route', sourceFile, node }));
            return node;
          }
          if (node.arguments.length !== 1) {
            diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'context.param.arity', sourceFile, node }));
            return node;
          }
          const name = staticString(node.arguments[0]);
          if (name === undefined) {
            diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'context.param.dynamic', sourceFile, node }));
            return node;
          }
          if (!params.has(name)) diagnostics.push(createHandlerDiagnostic({
            frontend: 'canonical-router',
            issue: 'context.param.unknown',
            sourceFile,
            node,
            values: { route: route.path, name },
            detail: { route: route.path, parameter: name, available: [...params] }
          }));
          return ts.factory.createCallExpression(ts.factory.createIdentifier('__pulse_router_param'), undefined, [
            ts.factory.createPropertyAccessExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('ctx'), 'req'), 'path'),
            ts.factory.createStringLiteral(route.path),
            ts.factory.createStringLiteral(name)
          ]);
        }
        if (ts.isIdentifier(target.expression) && target.expression.text === ctxName && target.name.text === 'resolve') {
          diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'context.resolve.retired', sourceFile, node }));
        }
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === ctxName && node.name.text === 'resolved') {
        diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'context.resolved.retired', sourceFile, node }));
      }
      if (role === 'event'
        && ts.isPropertyAccessExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === ctxName
        && node.expression.name.text === 'event'
        && node.name.text === 'type') {
        return ts.factory.createStringLiteral(String(descriptor.event && descriptor.event.type || entry.eventType));
      }
      if (errorName && ts.isIdentifier(node) && node.text === errorName && isReferenceIdentifier(node)) return ts.factory.createIdentifier(ERROR);
      return ts.visitEachChild(node, visit, context);
    };
    return (root) => ts.visitNode(root, visit);
  };

  function rewrite(node) {
    const result = ts.transform(node, [rewriteTransformer]);
    const transformed = result.transformed[0];
    result.dispose();
    return transformed;
  }

  function transferOperation(call) {
    return createHandlerOperation('router-transfer', {
      call,
      role,
      nextIndex: entry.nextIndex,
      transferFlag,
      clearNormalMode: call.arguments.length === 0 && role !== 'error',
      errorExpression: call.arguments.length > 0 ? rewrite(call.arguments[0]) : undefined
    });
  }

  function transformList(statements) {
    const operations = [];
    let mayTransfer = false;
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      const result = transformStatement(statement);
      operations.push(...result.operations);
      mayTransfer = mayTransfer || result.mayTransfer;
      if (result.mustTerminate) {
        for (const unreachable of statements.slice(index + 1)) {
          diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'handler.unreachable-after-terminal', sourceFile, node: unreachable }));
        }
        return { operations, mayTransfer, mustTerminate: true };
      }
      if (result.mayTransfer) {
        const remainder = transformList(statements.slice(index + 1));
        if (remainder.operations.length > 0) {
          operations.push(createHandlerOperation('router-guard', {
            transferFlag,
            body: createHandlerOperation('block', {
              statement: ts.factory.createBlock([], true),
              statements: Object.freeze(remainder.operations)
            })
          }));
        }
        return { operations, mayTransfer: true, mustTerminate: remainder.mustTerminate };
      }
    }
    return { operations, mayTransfer, mustTerminate: false };
  }

  function transformStatement(statement) {
    const call = nextName ? directNextCall(statement, nextName) : undefined;
    if (call) return { operations: [transferOperation(call)], mayTransfer: true, mustTerminate: true };
    if (ts.isReturnStatement(statement)) {
      const returned = statement.expression && unwrapExpression(statement.expression);
      const returnsVoid = !returned
        || (ts.isIdentifier(returned) && returned.text === 'undefined')
        || ts.isVoidExpression(returned);
      if (role === 'event' && !returnsVoid) {
        diagnostics.push(diagnostic(
          sourceFile,
          statement,
          'PULSE_EVENT_HANDLER_RESULT_UNSUPPORTED',
          'Event handlers complete with void and cannot return a result value.',
          { role }
        ));
      } else if (role !== 'event' && !statement.expression) {
        diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-router', issue: 'handler.return-value.required', sourceFile, node: statement }));
      }
      return { operations: [createHandlerOperation('source-statement', { statement: rewrite(statement), role: 'router-return' })], mayTransfer: false, mustTerminate: true };
    }
    if (ts.isBlock(statement)) {
      const nested = transformList(statement.statements);
      return {
        operations: [createHandlerOperation('block', { statement, statements: Object.freeze(nested.operations) })],
        mayTransfer: nested.mayTransfer,
        mustTerminate: nested.mustTerminate
      };
    }
    if (ts.isIfStatement(statement)) {
      const thenResult = ts.isBlock(statement.thenStatement)
        ? transformList(statement.thenStatement.statements)
        : transformList([statement.thenStatement]);
      const elseResult = statement.elseStatement
        ? (ts.isBlock(statement.elseStatement) ? transformList(statement.elseStatement.statements) : transformList([statement.elseStatement]))
        : { operations: [], mayTransfer: false, mustTerminate: false };
      return {
        operations: [createHandlerOperation('if', {
          statement,
          expression: rewrite(statement.expression),
          thenOperation: createHandlerOperation('block', { statement: ts.factory.createBlock([], true), statements: Object.freeze(thenResult.operations) }),
          elseOperation: statement.elseStatement ? createHandlerOperation('block', { statement: ts.factory.createBlock([], true), statements: Object.freeze(elseResult.operations) }) : undefined
        })],
        mayTransfer: thenResult.mayTransfer || elseResult.mayTransfer,
        mustTerminate: Boolean(statement.elseStatement) && thenResult.mustTerminate && elseResult.mustTerminate
      };
    }
    return { operations: [createHandlerOperation('source-statement', { statement: rewrite(statement), role: 'router-source' })], mayTransfer: false, mustTerminate: false };
  }

  const originalBody = ts.isBlock(functionNode.body)
    ? functionNode.body
    : ts.factory.createBlock([ts.factory.createReturnStatement(functionNode.body)], true);
  const transformed = transformList(originalBody.statements);
  if (role !== 'event' && !transformed.mustTerminate) diagnostics.push(createHandlerDiagnostic({
    frontend: 'canonical-router',
    issue: 'handler.fallthrough',
    sourceFile,
    node: functionNode,
    values: { role },
    detail: { role }
  }));

  const surfaceFacts = entrySurfaceFacts(recognition, classification, entry.stableId);
  const wave2Normalization = normalized.summary.changed || normalized.summary.userAuthoredAsync || normalized.summary.awaitCount > 0;
  const normalization = wave2Normalization ? normalized.summary : undefined;
  return Object.freeze({
    version: ROUTER_HANDLER_FRONTEND_VERSION,
    frontend: 'canonical-router-handler',
    handlerIrVersion: HANDLER_IR_VERSION,
    handlerIrKind: ROUTER_HANDLER_IR_KIND,
    fileName,
    sourceFile,
    sourceText: authoredFunctionNode.getText(sourceFile),
    functionNode,
    authoredFunctionNode,
    warnings: normalized.warnings,
    normalization,
    descriptor,
    role,
    entry,
    route,
    signature: Object.freeze({
      ctxName: signature.ctxName || 'ctx',
      nextName,
      errorName
    }),
    transferFlag,
    body: createHandlerOperation('block', {
      statement: originalBody,
      statements: Object.freeze(transformed.operations)
    }),
    analysis: analysisForSurfaceFacts(surfaceFacts),
    schemaBundle: emptySchemaBundle(fileName),
    flow: Object.freeze({ mayTransfer: transformed.mayTransfer, mustTerminate: transformed.mustTerminate }),
    surfaceFacts: Object.freeze({
      ...surfaceFacts,
      normalization: wave2Normalization
        ? Object.freeze({
            authority: 'async-surface-normalizer',
            frontendVersion: ROUTER_HANDLER_FRONTEND_VERSION,
            ...normalized.summary,
            behaviorChangeAllowed: true
          })
        : Object.freeze({
            authority: 'router-handler-frontend',
            frontendVersion: ROUTER_HANDLER_FRONTEND_VERSION,
            changed: true,
            behaviorChangeAllowed: false
          })
    })
  });
}

function prepareCanonicalRouterHandlers(topology, recognition, classification) {
  if (!topology || topology.frontend !== 'canonical-router') throw new TypeError('prepareCanonicalRouterHandlers requires canonical Router topology.');
  const model = sourceModelForRouterRecognition(recognition);
  if (!model || model.topology !== topology) throw new TypeError('Router handler recognition does not belong to the supplied topology.');
  const diagnostics = [];
  const handlers = topology.entries
    .filter((descriptor) => ['use', 'route', 'error', 'event'].includes(descriptor.entry.kind))
    .map((descriptor) => normalizeRouterHandler(topology, descriptor, recognition, classification, diagnostics));
  const validation = Object.freeze({
    authority: 'router-handler-frontend',
    frontendVersion: ROUTER_HANDLER_FRONTEND_VERSION,
    handlerCount: handlers.length,
    behaviorChangeAllowed: false
  });
  if (diagnostics.some((entry) => entry.severity === 'error')) {
    throw new CanonicalRouterCompileError(`Canonical Router lowering failed for ${topology.fileName}.`, diagnostics);
  }
  return Object.freeze({
    version: ROUTER_HANDLER_FRONTEND_VERSION,
    topology,
    recognition,
    classification,
    validation,
    handlers: Object.freeze(handlers.map((handler) => Object.freeze({
      ...handler,
      surfaceFacts: Object.freeze({ ...handler.surfaceFacts, validation })
    })))
  });
}

module.exports = Object.freeze({
  ROUTER_HANDLER_FRONTEND_VERSION,
  validateFunctionSignature,
  prepareCanonicalRouterHandlers
});
