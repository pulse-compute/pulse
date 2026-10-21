'use strict';

const ts = require('typescript');

function loadHandlerSurfaceContract() {
  try {
    return require('@pulse-compute/wasm-contracts/handler/surface-contract');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../contracts/src/handler/surface-contract.js');
    }
    throw error;
  }
}

const contract = loadHandlerSurfaceContract();
const HANDLER_SURFACE_AUTHORITY_VERSION = 'pulse.compiler-handler-surface.v2';
const canonicalSourceModels = new WeakMap();
const canonicalRouterModels = new WeakMap();

function unwrapExpression(node) {
  let current = node;
  while (current && (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression?.(current)
    || ts.isNonNullExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isPartiallyEmittedExpression?.(current)
  )) current = current.expression;
  return current;
}

function expressionFor(node, options = {}) {
  let current = options.unwrap === true ? unwrapExpression(node) : node;
  if (options.unwrapAwait === true && current && ts.isAwaitExpression(current)) {
    current = options.unwrap === true ? unwrapExpression(current.expression) : current.expression;
  }
  return current;
}

function isIdentifierNamed(node, name, options = {}) {
  const current = expressionFor(node, options);
  return Boolean(current && ts.isIdentifier(current) && current.text === name);
}

function isPropertyAccessNamed(node, objectName, propertyName, options = {}) {
  const current = expressionFor(node, options);
  return Boolean(current && ts.isPropertyAccessExpression(current)
    && isIdentifierNamed(current.expression, objectName, options)
    && current.name.text === propertyName);
}

function callTargetParts(expression, options = {}) {
  const current = expressionFor(expression, options);
  if (!current || !ts.isCallExpression(current)) return undefined;
  const target = expressionFor(current.expression, options);
  if (!target || !ts.isPropertyAccessExpression(target)) return undefined;
  return Object.freeze({ call: current, receiver: expressionFor(target.expression, options), method: target.name.text });
}

function staticString(node, options = {}) {
  const current = expressionFor(node, options);
  return current && (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) ? current.text : undefined;
}

function createRecognition(surfaceId, node, detail = {}, options = {}) {
  const classified = contract.classifyHandlerSurface(surfaceId, { strict: options.strict !== false });
  const definition = contract.DEFAULT_HANDLER_SURFACE_REGISTRY.get(surfaceId);
  if (!definition) return undefined;
  return Object.freeze({
    version: HANDLER_SURFACE_AUTHORITY_VERSION,
    contractVersion: contract.HANDLER_SURFACE_CONTRACT_VERSION,
    contractId: contract.HANDLER_SURFACE_CONTRACT_ID,
    surfaceId,
    class: definition.class,
    canonicalOperation: definition.canonicalOperation,
    awaitPolicy: definition.awaitPolicy,
    nativeEligible: definition.targetSupport.native,
    node,
    detail: Object.freeze({ ...detail }),
    classification: classified
  });
}

function recognizeManagedHandlerWrapper(node, options = {}) {
  if (!node || !ts.isFunctionLike(node)) return undefined;
  const async = (node.modifiers || []).some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (!async) return undefined;
  return createRecognition('handler.managed-async-wrapper', node, {
    role: options.role,
    functionKind: ts.SyntaxKind[node.kind]
  }, options);
}

function extractFetchChain(expression, ctxName, options = {}) {
  const current = expressionFor(expression, options);
  if (!current) return undefined;
  let decoder;
  let decoderCall;
  let call = current;
  const outer = callTargetParts(current, options);
  if (outer && ['json', 'text'].includes(outer.method)) {
    decoder = outer.method;
    decoderCall = outer.call;
    call = outer.receiver;
  }
  call = expressionFor(call, options);
  if (!call || !ts.isCallExpression(call)) return undefined;
  if (!isPropertyAccessNamed(call.expression, ctxName, 'fetch', options)) return undefined;
  return Object.freeze({
    fetchCall: call,
    decoder,
    decoderCall,
    decoderArgs: decoderCall ? Object.freeze([...decoderCall.arguments]) : Object.freeze([]),
    url: call.arguments[0],
    init: call.arguments[1]
  });
}

function extractParallelCall(expression, ctxName, options = {}) {
  const current = expressionFor(expression, options);
  if (!current || !ts.isCallExpression(current)) return undefined;
  if (!isPropertyAccessNamed(current.expression, ctxName, 'parallel', options)) return undefined;
  return Object.freeze({
    call: current,
    argumentCount: current.arguments.length,
    record: current.arguments[0]
  });
}

function extractEventEmitCall(expression, ctxName, options = {}) {
  const current = expressionFor(expression, options);
  if (!current || !ts.isCallExpression(current)) return undefined;
  if (!isPropertyAccessNamed(current.expression, ctxName, 'emit', options)) return undefined;
  return Object.freeze({
    call: current,
    argumentCount: current.arguments.length,
    type: current.arguments[0],
    event: current.arguments[1]
  });
}

function extractKvNamespaceDeclaration(statement, ctxName, options = {}) {
  if (!statement || !ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return undefined;
  const declaration = statement.declarationList.declarations[0];
  const initializer = expressionFor(declaration.initializer, options);
  if (!ts.isIdentifier(declaration.name) || !initializer || !ts.isCallExpression(initializer)) return undefined;
  if (!isPropertyAccessNamed(initializer.expression, ctxName, 'kv', options) || initializer.arguments.length !== 1) return undefined;
  return Object.freeze({ statement, declaration, variableName: declaration.name.text, store: initializer.arguments[0] });
}

function extractProviderCall(expression, ctxName, kvAliases = new Map(), options = {}) {
  const current = expressionFor(expression, options);
  if (!current || !ts.isCallExpression(current)) return undefined;
  const emit = extractEventEmitCall(current, ctxName, options);
  if (emit && emit.argumentCount === 2) {
    return Object.freeze({
      call: current,
      surfaceId: 'ctx.emit',
      kind: 'event.emit',
      providerKind: 'event',
      operation: 'emit',
      capability: 'event.emit',
      type: emit.type,
      emission: emit.event,
      args: Object.freeze([...current.arguments])
    });
  }
  const target = expressionFor(current.expression, options);
  if (!target || !ts.isPropertyAccessExpression(target)) return undefined;
  const receiver = expressionFor(target.expression, options);
  const method = target.name.text;

  if (receiver && ts.isPropertyAccessExpression(receiver) && isIdentifierNamed(receiver.expression, ctxName, options)) {
    const namespace = receiver.name.text;
    if (namespace === 'req' && method === 'readTextChunk' && current.arguments.length === 0) {
      return Object.freeze({ call: current, surfaceId: 'ctx.req.readTextChunk', kind: 'output.readTextChunk', providerKind: 'output', operation: 'readTextChunk', capability: 'request.body.transform', args: Object.freeze([]) });
    }
    if (namespace === 'output' && ((method === 'start' && current.arguments.length <= 1) || (method === 'write' && current.arguments.length === 1))) {
      return Object.freeze({ call: current, surfaceId: `ctx.output.${method}`, kind: `output.${method}`, providerKind: 'output', operation: method, capability: 'response.output', args: Object.freeze([...current.arguments]) });
    }
    if (namespace === 'time' && method === 'now' && current.arguments.length === 0) {
      return Object.freeze({ call: current, surfaceId: 'ctx.time.now', kind: 'time.now', providerKind: 'time', operation: 'now', capability: 'time.wall-clock', args: Object.freeze([]) });
    }
    if (namespace === 'config' && method === 'get' && current.arguments.length === 1) {
      return Object.freeze({ call: current, surfaceId: 'ctx.config.get', kind: 'config.get', providerKind: 'config', operation: 'get', capability: 'config.get', resource: current.arguments[0], name: current.arguments[0], args: Object.freeze([...current.arguments]) });
    }
    if (namespace === 'secret' && method === 'get' && current.arguments.length === 1) {
      return Object.freeze({ call: current, surfaceId: 'ctx.secret.get', kind: 'secret.get', providerKind: 'secret', operation: 'get', capability: 'secret.get', resource: current.arguments[0], name: current.arguments[0], args: Object.freeze([...current.arguments]) });
    }
  }

  if (['get', 'put', 'getVersioned', 'insertIfAbsent', 'compareAndSwap', 'list', 'delete'].includes(method)) {
    let store;
    if (receiver && ts.isCallExpression(receiver) && isPropertyAccessNamed(receiver.expression, ctxName, 'kv', options) && receiver.arguments.length === 1) {
      store = receiver.arguments[0];
    } else if (receiver && ts.isIdentifier(receiver) && kvAliases.has(receiver.text)) {
      store = kvAliases.get(receiver.text);
    }
    if (store) {
      if (['getVersioned', 'insertIfAbsent', 'compareAndSwap', 'list', 'delete'].includes(method)
        && !ts.isStringLiteral(store) && !ts.isNoSubstitutionTemplateLiteral(store)) return undefined;
      const expected = method === 'compareAndSwap' ? 3 : ['get', 'getVersioned', 'delete', 'list'].includes(method) ? 1 : 2;
      if (current.arguments.length === expected) {
        return Object.freeze({
          call: current,
          surfaceId: `ctx.kv.${method}`,
          valueTypeNode: method === 'getVersioned' && (ts.isCallExpression(receiver) ? receiver : store.parent)?.typeArguments?.length === 1 ? (ts.isCallExpression(receiver) ? receiver : store.parent).typeArguments[0] : undefined,
          kind: `kv.${method}`,
          providerKind: 'kv',
          operation: method,
          capability: `kv.${method}`,
          resource: store,
          store,
          key: method === 'list' ? undefined : current.arguments[0],
          options: method === 'list' ? current.arguments[0] : undefined,
          value: current.arguments[method === 'compareAndSwap' ? 2 : 1],
          generation: method === 'compareAndSwap' ? current.arguments[1] : undefined,
          args: Object.freeze([...current.arguments])
        });
      }
    }
  }
  return undefined;
}

function recognizeHandlerSurface(node, options = {}) {
  if (!node) return undefined;
  const ctxName = options.ctxName || 'ctx';
  const nextName = options.nextName;
  const current = expressionFor(node, options);

  if (ts.isAwaitExpression(current)) {
    const inner = recognizeHandlerSurface(current.expression, { ...options, awaited: true });
    if (inner) return Object.freeze({ ...inner, node: current, awaited: true, innerNode: inner.node });
    return createRecognition('javascript.await', current, { awaited: true }, options);
  }

  const wrapper = recognizeManagedHandlerWrapper(current, options);
  if (wrapper) return wrapper;

  if (ts.isCallExpression(current)) {
    const callTarget = expressionFor(current.expression, options);
    if (nextName && isIdentifierNamed(callTarget, nextName)) {
      return createRecognition('router.next', current, {
        argumentCount: current.arguments.length,
        position: options.position
      }, options);
    }

    const parallel = extractParallelCall(current, ctxName, options);
    if (parallel) return createRecognition('ctx.parallel', current, { parallel }, options);

    const emit = extractEventEmitCall(current, ctxName, options);
    if (emit) return createRecognition('ctx.emit', current, { emit }, options);

    if (typeof options.packageEffectForCall === 'function') {
      const packageEffect = options.packageEffectForCall(current);
      if (packageEffect) return createRecognition('package.operation', current, { packageEffect }, options);
    }

    const fetch = extractFetchChain(current, ctxName, options);
    if (fetch) {
      return createRecognition(fetch.decoder ? 'ctx.fetch.projected' : 'ctx.fetch.opaque-return', current, { fetch }, options);
    }

    const provider = extractProviderCall(current, ctxName, options.kvAliases || new Map(), options);
    if (provider) return createRecognition(provider.surfaceId, current, { provider }, options);

    const target = expressionFor(current.expression, options);
    if (target && ts.isPropertyAccessExpression(target)) {
      const receiver = expressionFor(target.expression, options);
      if (receiver && ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'resources' && isIdentifierNamed(receiver.expression, ctxName, options) && target.name.text === 'map') return createRecognition('ctx.resources', current, {}, options);
      if (isIdentifierNamed(receiver, ctxName, options)) {
        const direct = Object.freeze({
          param: 'ctx.param',
          json: 'ctx.json',
          encodeJson: 'ctx.encodeJson',
          decodeJson: 'ctx.decodeJson',
          text: 'ctx.text',
          response: 'ctx.response'
        });
        const surfaceId = direct[target.name.text];
        if (surfaceId) return createRecognition(surfaceId, current, { arguments: Object.freeze([...current.arguments]) }, options);
      }
      if (receiver && ts.isPropertyAccessExpression(receiver) && isIdentifierNamed(receiver.expression, ctxName, options)) {
        const namespace = receiver.name.text;
        const method = target.name.text;
        if (namespace === 'output' && method === 'close' && current.arguments.length === 0) return createRecognition('ctx.output.close', current, { arguments: Object.freeze([]) }, options);
        if (namespace === 'req' && method === 'header') return createRecognition('ctx.req.header', current, { arguments: Object.freeze([...current.arguments]) }, options);
        if (namespace === 'req' && method === 'text') return createRecognition('ctx.req.text', current, { arguments: Object.freeze([...current.arguments]) }, options);
        if (namespace === 'req' && method === 'body') return createRecognition('ctx.req.body', current, { arguments: Object.freeze([...current.arguments]) }, options);
        if (namespace === 'req' && method === 'json') {
          return createRecognition(current.arguments.length === 0 ? 'ctx.req.json.generic' : 'ctx.req.json.schema', current, { arguments: Object.freeze([...current.arguments]) }, options);
        }
        if (namespace === 'state' && method === 'get') return createRecognition('ctx.state.get', current, { arguments: Object.freeze([...current.arguments]) }, options);
        if (namespace === 'state' && method === 'set') return createRecognition('ctx.state.set', current, { arguments: Object.freeze([...current.arguments]) }, options);
        if (namespace === 'log' && ['error', 'warn', 'info', 'debug'].includes(method)) {
          return createRecognition(`ctx.log.${method}`, current, {
            level: method,
            arguments: Object.freeze([...current.arguments])
          }, options);
        }
      }
    }
  }

  if (ts.isPropertyAccessExpression(current)) {
    const receiver = expressionFor(current.expression, options);
    if (receiver && ts.isPropertyAccessExpression(receiver) && isIdentifierNamed(receiver.expression, ctxName, options) && receiver.name.text === 'req') {
      const surfaceId = Object.freeze({
        method: 'ctx.req.method',
        url: 'ctx.req.url',
        path: 'ctx.req.path',
        headers: 'ctx.req.headers'
      })[current.name.text];
      if (surfaceId) return createRecognition(surfaceId, current, {}, options);
    }
    if (receiver && ts.isPropertyAccessExpression(receiver) && isIdentifierNamed(receiver.expression, ctxName, options) && receiver.name.text === 'event') {
      const surfaceId = Object.freeze({
        type: 'ctx.event.type',
        payload: 'ctx.event.payload'
      })[current.name.text];
      if (surfaceId) return createRecognition(surfaceId, current, {}, options);
    }
  }

  return undefined;
}

function classifyRecognizedHandlerSurface(recognized, options = {}) {
  if (!recognized) return undefined;
  const classified = contract.classifyHandlerSurface(recognized.surfaceId, {
    strict: options.strict !== false
  });
  return Object.freeze({
    version: HANDLER_SURFACE_AUTHORITY_VERSION,
    surfaceId: recognized.surfaceId,
    class: recognized.class,
    canonicalOperation: recognized.canonicalOperation,
    awaitPolicy: recognized.awaitPolicy,
    nativeEligible: recognized.nativeEligible,
    classification: classified,
    detail: recognized.detail
  });
}

function sourcePosition(sourceFile, node) {
  const offset = node && typeof node.getStart === 'function' ? node.getStart(sourceFile) : 0;
  const point = sourceFile.getLineAndCharacterOfPosition(offset);
  return Object.freeze({ line: point.line + 1, column: point.character + 1, offset });
}

function defaultHandlerCandidates(sourceFile) {
  const handlers = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const modifiers = statement.modifiers || [];
      if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        && modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) handlers.push(statement);
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const expression = unwrapExpression(statement.expression);
      if (expression && (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))) handlers.push(expression);
    }
  }
  return handlers;
}

function inspectCanonicalSourceSurfaces(sourceText, options = {}) {
  const fileName = String(options.fileName || 'app.ts').replace(/\\/g, '/');
  const source = String(sourceText);
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const handlers = defaultHandlerCandidates(sourceFile);
  const facts = [];
  const seen = new Set();
  const surfacesByNode = new WeakMap();

  function record(node, handler, ctxName) {
    const recognized = recognizeHandlerSurface(node, { ctxName, role: 'handler', strict: options.strict !== false });
    if (!recognized) return undefined;
    surfacesByNode.set(node, recognized);
    const position = sourcePosition(sourceFile, node);
    const key = `${recognized.surfaceId}\u0000${position.offset}\u0000${node.end}`;
    if (!seen.has(key)) {
      seen.add(key);
      facts.push(Object.freeze({
        surfaceId: recognized.surfaceId,
        class: recognized.class,
        canonicalOperation: recognized.canonicalOperation,
        awaitPolicy: recognized.awaitPolicy,
        nativeEligible: recognized.nativeEligible,
        awaited: recognized.awaited === true,
        position
      }));
    }
    return recognized;
  }

  for (const handler of handlers) {
    const ctxParameter = handler.parameters && handler.parameters[0];
    const ctxName = ctxParameter && ts.isIdentifier(ctxParameter.name) ? ctxParameter.name.text : 'ctx';
    record(handler, handler, ctxName);
    function visit(node) {
      if (typeof ts.isTypeNode === 'function' && ts.isTypeNode(node)) return;
      const recognized = record(node, handler, ctxName);
      if (recognized && ts.isAwaitExpression(node)) return;
      if (recognized && ts.isCallExpression(node)) {
        for (const argument of node.arguments) visit(argument);
        return;
      }
      ts.forEachChild(node, visit);
    }
    if (handler.body) visit(handler.body);
  }

  facts.sort((left, right) => left.position.offset - right.position.offset || left.surfaceId.localeCompare(right.surfaceId));
  const recognition = Object.freeze({
    version: HANDLER_SURFACE_AUTHORITY_VERSION,
    contractVersion: contract.HANDLER_SURFACE_CONTRACT_VERSION,
    file: fileName,
    handlerCount: handlers.length,
    facts: Object.freeze(facts),
    summary: Object.freeze({
      total: facts.length,
      byClass: Object.freeze(Object.fromEntries([...new Set(facts.map((fact) => fact.class))].sort().map((className) => [className, facts.filter((fact) => fact.class === className).length]))),
      bySurface: Object.freeze(Object.fromEntries([...new Set(facts.map((fact) => fact.surfaceId))].sort().map((surfaceId) => [surfaceId, facts.filter((fact) => fact.surfaceId === surfaceId).length])))
    })
  });
  canonicalSourceModels.set(recognition, Object.freeze({
    file: fileName,
    source,
    sourceFile,
    handlers: Object.freeze([...handlers]),
    surfaceForNode(node) {
      return node && typeof node === 'object' ? surfacesByNode.get(node) : undefined;
    }
  }));
  return recognition;
}

function sourceModelForCanonicalRecognition(recognition) {
  return recognition && typeof recognition === 'object' ? canonicalSourceModels.get(recognition) : undefined;
}

function classifyCanonicalSourceSurfaces(recognition, options = {}) {
  return Object.freeze({
    version: HANDLER_SURFACE_AUTHORITY_VERSION,
    contractVersion: contract.HANDLER_SURFACE_CONTRACT_VERSION,
    file: recognition.file,
    handlerCount: recognition.handlerCount,
    facts: Object.freeze(recognition.facts.map((fact) => Object.freeze({
      ...fact,
      classification: contract.classifyHandlerSurface(fact.surfaceId, { strict: options.strict !== false })
    }))),
    summary: recognition.summary
  });
}

function routerHandlerNames(entry) {
  const functionNode = entry && entry.functionNode;
  const role = entry && entry.role;
  const names = functionNode && functionNode.parameters
    ? functionNode.parameters.map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : undefined)
    : [];
  return Object.freeze({
    ctxName: role === 'error' ? names[1] : names[0],
    nextName: role === 'route' && names.length === 1 ? undefined : names[role === 'error' ? 2 : 1],
    errorName: role === 'error' ? names[0] : undefined
  });
}

// Shared compiler projection. Recognition details own provider/package capability
// names; synchronous surfaces use the same mapping as router analysis.
function capabilityForHandlerSurface(fact) {
  if (fact.detail?.provider) return fact.detail.provider.capability;
  if (fact.detail?.packageEffect) return String(fact.detail.packageEffect.capability || fact.detail.packageEffect.kind);
  const id = fact.surfaceId;
  if (id === 'ctx.req.body') return 'request.body.forward';
  if (id.startsWith('ctx.fetch.')) return 'fetch';
  if (id.startsWith('ctx.req.')) return id.slice(4);
  if (id.startsWith('ctx.config.')) return 'config.get';
  if (id.startsWith('ctx.secret.')) return 'secret.get';
  if (id.startsWith('ctx.kv.') || id.startsWith('ctx.state.')) return id.slice(4);
  if (id === 'ctx.emit') return 'event.emit';
  if (id.startsWith('ctx.log.')) return 'logging';
  if (['ctx.json', 'ctx.text', 'ctx.response'].includes(id)) return `response.${id.slice(4)}`;
  if (id === 'ctx.param') return 'route.param';
  return undefined;
}

function inspectCanonicalRouterSurfaces(topology, options = {}) {
  if (!topology || topology.frontend !== 'canonical-router' || !topology.sourceFile || !Array.isArray(topology.entries)) {
    throw new TypeError('inspectCanonicalRouterSurfaces requires a prepared canonical Router topology.');
  }
  const sourceFile = topology.sourceFile;
  const facts = [];
  const surfacesByEntry = new Map();
  // Private observations retain original nodes before normalization. They never
  // enter recognition facts, summaries, executable metadata or identity hashes.
  const authoredSites = [], validatedCalls = [], seenOwners = new Set();
  function retainAuthored(ownerId, fn, file, names) {
    if (seenOwners.has(ownerId)) return;
    seenOwners.add(ownerId);
    const seenNodes = new WeakSet();
    function visit(node, aliases) {
      if (seenNodes.has(node)) return;
      seenNodes.add(node);
      if (ts.isTypeNode(node) || ts.isFunctionLike(node)) return;
      if (ts.isBlock(node)) {
        const local = new Map(aliases);
        for (const statement of node.statements) {
          const namespace = extractKvNamespaceDeclaration(statement, names.ctxName, { unwrap: true });
          if (namespace) local.set(namespace.variableName, namespace.store);
          visit(statement, local);
        }
        return;
      }
      // Await/parentheses are syntax wrappers, not additional operation sites.
      const current = expressionFor(node, { unwrap: true });
      if (current !== node) { visit(current, aliases); return; }
      if (ts.isAwaitExpression(node)) { visit(node.expression, aliases); return; }
      const recognized = recognizeHandlerSurface(node, { ...names, unwrap: true,
        kvAliases: aliases, packageEffectForCall: options.packageEffectForCall });
      if (recognized && recognized.class !== 'handler-wrapper') {
        authoredSites.push(Object.freeze({ ownerId, sourceFile: file, node, recognized }));
        if (ts.isCallExpression(node)) {
          for (const argument of node.arguments) visit(argument, aliases);
          // A fetch projection owns its fetch receiver; provider receiver inputs
          // can themselves contain synchronous context operations.
          if (recognized.detail?.provider?.resource) visit(recognized.detail.provider.resource, aliases);
          for (const argument of recognized.detail?.fetch?.fetchCall?.arguments || []) visit(argument, aliases);
          return;
        }
      }
      ts.forEachChild(node, child => visit(child, aliases));
    }
    if (fn.body) visit(fn.body, new Map());
  }

  function record(entry, node, names) {
    const recognized = recognizeHandlerSurface(node, {
      ctxName: names.ctxName || 'ctx',
      nextName: names.nextName,
      role: entry.role,
      unwrap: true,
      strict: options.strict !== false
    });
    if (!recognized) return undefined;
    let byNode = surfacesByEntry.get(entry.entry.stableId);
    if (!byNode) {
      byNode = new WeakMap();
      surfacesByEntry.set(entry.entry.stableId, byNode);
    }
    byNode.set(node, recognized);
    const entrySourceFile = entry.sourceFile || sourceFile;
    const position = sourcePosition(entrySourceFile, node);
    facts.push(Object.freeze({
      routerEntryStableId: entry.entry.stableId,
      routerEntryIndex: entry.entry.index,
      routerEntryKind: entry.entry.kind,
      handlerId: entry.entry.handlerId,
      role: entry.role,
      surfaceId: recognized.surfaceId,
      class: recognized.class,
      canonicalOperation: recognized.canonicalOperation,
      awaitPolicy: recognized.awaitPolicy,
      nativeEligible: recognized.nativeEligible,
      awaited: recognized.awaited === true,
      position
    }));
    return recognized;
  }

  for (const entry of topology.entries) {
    if (!entry.functionNode) continue;
    const names = routerHandlerNames(entry);
    retainAuthored(entry.entry.handlerId, entry.functionNode, entry.sourceFile || sourceFile, names);
    record(entry, entry.functionNode, names);
    function visit(node) {
      if (typeof ts.isTypeNode === 'function' && ts.isTypeNode(node)) return;
      const recognized = record(entry, node, names);
      if (recognized && ts.isAwaitExpression(node)) return;
      if (recognized && ts.isCallExpression(node)) {
        for (const argument of node.arguments) visit(argument);
        return;
      }
      ts.forEachChild(node, visit);
    }
    if (entry.functionNode.body) visit(entry.functionNode.body);
  }

  for (const helper of options.linkedProjectModules?.sourceHelpers || []) {
    if (!helper.pure) retainAuthored(helper.id, helper.functionNode, helper.sourceFile, { ctxName: 'ctx' });
  }
  const recognition = Object.freeze({
    version: HANDLER_SURFACE_AUTHORITY_VERSION,
    contractVersion: contract.HANDLER_SURFACE_CONTRACT_VERSION,
    file: topology.fileName,
    handlerCount: topology.entries.filter((entry) => Boolean(entry.functionNode)).length,
    facts: Object.freeze(facts),
    summary: Object.freeze({
      total: facts.length,
      byClass: Object.freeze(Object.fromEntries([...new Set(facts.map((fact) => fact.class))].sort().map((className) => [className, facts.filter((fact) => fact.class === className).length]))),
      bySurface: Object.freeze(Object.fromEntries([...new Set(facts.map((fact) => fact.surfaceId))].sort().map((surfaceId) => [surfaceId, facts.filter((fact) => fact.surfaceId === surfaceId).length]))),
      byEntryKind: Object.freeze(Object.fromEntries([...new Set(facts.map((fact) => fact.routerEntryKind))].sort().map((kind) => [kind, facts.filter((fact) => fact.routerEntryKind === kind).length])))
    })
  });
  canonicalRouterModels.set(recognition, Object.freeze({
    topology,
    authoredSites: Object.freeze(authoredSites),
    get validatedCalls() { return Object.freeze([...validatedCalls]); },
    retainValidatedCall(entry, helper, node, sourceFile) {
      validatedCalls.push(Object.freeze({ callerId: entry.handlerId, calleeId: helper.id,
        registrationId: entry.stableId, node: ts.getOriginalNode(node), sourceFile }));
    },
    namesForEntry(entryStableId) {
      const entry = topology.entries.find((candidate) => candidate.entry.stableId === entryStableId);
      return entry ? routerHandlerNames(entry) : undefined;
    },
    surfaceForNode(entryStableId, node) {
      const byNode = surfacesByEntry.get(entryStableId);
      return byNode && node && typeof node === 'object' ? byNode.get(node) : undefined;
    },
    factsForEntry(entryStableId) {
      return Object.freeze(facts.filter((fact) => fact.routerEntryStableId === entryStableId));
    }
  }));
  return recognition;
}

function sourceModelForRouterRecognition(recognition) {
  return recognition && typeof recognition === 'object' ? canonicalRouterModels.get(recognition) : undefined;
}

function classifyCanonicalRouterSurfaces(recognition, options = {}) {
  return Object.freeze({
    version: HANDLER_SURFACE_AUTHORITY_VERSION,
    contractVersion: contract.HANDLER_SURFACE_CONTRACT_VERSION,
    file: recognition.file,
    handlerCount: recognition.handlerCount,
    facts: Object.freeze(recognition.facts.map((fact) => Object.freeze({
      ...fact,
      classification: contract.classifyHandlerSurface(fact.surfaceId, { strict: options.strict !== false })
    }))),
    summary: recognition.summary
  });
}

module.exports = Object.freeze({
  HANDLER_SURFACE_AUTHORITY_VERSION,
  contractVersion: contract.HANDLER_SURFACE_CONTRACT_VERSION,
  unwrapExpression,
  expressionFor,
  isIdentifierNamed,
  isPropertyAccessNamed,
  callTargetParts,
  staticString,
  recognizeManagedHandlerWrapper,
  recognizeHandlerSurface,
  capabilityForHandlerSurface,
  classifyRecognizedHandlerSurface,
  extractFetchChain,
  extractEventEmitCall,
  extractParallelCall,
  extractProviderCall,
  extractKvNamespaceDeclaration,
  inspectCanonicalSourceSurfaces,
  classifyCanonicalSourceSurfaces,
  sourceModelForCanonicalRecognition,
  inspectCanonicalRouterSurfaces,
  classifyCanonicalRouterSurfaces,
  sourceModelForRouterRecognition
});
