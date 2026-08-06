'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { astToJson } = require('./ast-json.js');
const {
  PACKAGE_VERSION,
  DIAGNOSTICS_VERSION,
  diagnostic,
  ExtractionError,
  normalizeArtifact,
  sourceLoc,
  stableFileName
} = require('./diagnostics.js');
const {
  createRouteIdMap,
  createRouteStableId,
  buildRouteStableInput,
  sourceTextHash
} = require('./stable-id.js');
const { buildHandlerTable } = require('./handler-table.js');
const { buildHandlerEval } = require('./handler-eval.js');
const { buildPathTable } = require('./path-table.js');
const { buildDispatchTable } = require('./dispatch-table.js');
const { buildExecutionPlan } = require('./execution-plan.js');
const { ROUTE_ID_POLICY, ROUTE_PLAN_VERSION } = loadContractsRoutePlan();
const EVENTS = loadContractsEvents();
const { buildTypeScriptDispatch } = require('./codegen/dispatch-ts.js');
const { buildTypeScriptHandlerBindings } = require('./codegen/handler-bindings-ts.js');
const { buildTypeScriptExecutionHarness } = require('./codegen/execution-harness-ts.js');
const {
  buildAssemblyScriptShape,
  buildAssemblyScriptCore,
  buildAssemblyScriptWasmSmoke,
  buildCompiledUserHandlers,
  buildIntegratedCompiledApp,
  buildRouteHandlerEffectPlan,
  buildRouteHandlerContextLoweringPlan,
  buildHandlerIoLifecyclePlan,
  buildRequestJsonBodyPlan,
  buildSchemaDecodeResultPlan,
  buildSchemaResponseCodecPlan,
  buildBackendJsonRequestBodyPlan
} = require('@pulse-compute/wasm-runtime-core-as/compiler');
const { buildTypeScriptLocalHarness } = require('./codegen/local-harness-ts.js');
const { buildAssemblyScriptCompileSmoke } = require('@pulse-compute/wasm-build-support/assemblyscript-compile');
const {
  buildWasmHostAbi,
  buildWasmHostBridge,
  buildRequestResultHeaders,
  buildChannelBroadcaster,
  buildJsonBodyAbi,
  buildDeploymentPosture,
  buildBackendCapabilities,
  buildHostRuntimeKernel,
  buildStreamingPassthrough,
  buildCompiledWasmRuntime
} = require('@pulse-compute/wasm-host-runtime/compiler');
const {
  buildHandlerLibraryContracts,
  buildHostCapabilities,
  buildLibrarySidecarConsumption,
  buildAssetsLoweringPlan,
  buildAssetsCompiledWasmSidecarPlan,
  buildAssetsSidecarCompileLinkProof,
  discoverLowerableLibraryManifests
} = require('@pulse-compute/wasm-library-kit/compiler');
const { buildEffectRuntime } = require('./codegen/effect-runtime.js');
const { buildEffectComposition } = require('./codegen/effect-composition.js');
const { buildSchemaJsonSidecar, buildSchemaJsonCompile, buildSchemaJsonGenericParser, compileNeeded, genericParserNeeded } = require('@pulse-compute/wasm-schema-json/compiler');
const { buildPulseWrapperIntegration } = require('./codegen/pulse-wrapper.js');
const {
  DEFAULT_ROUTER_API_REGISTRY,
  SUPPORTED_METHODS,
  ROUTE_METHODS,
  arityDisplay,
  buildRouterApiRegistry,
  signatureForArity
} = require('./definitions/router-api.js');
const { DIAGNOSTIC_CODES } = require('./diagnostics/codes.js');
const { isInlineFunction: patternIsInlineFunction, classifyHandlerReference, classifyChannelReference } = require('./patterns/handler-reference.js');
const { isRouterNewExpression: patternIsRouterNewExpression, isDirectRouterDeclarationInitializer: patternIsDirectRouterDeclarationInitializer } = require('./patterns/router-construction.js');
const { unwindRouterCallChain, isOutermostCallInChain } = require('./patterns/router-chain-call.js');
const {
  PATH_GRAMMAR_VERSION,
  PATH_POLICY,
  compileRoutePath,
  extractParams,
  joinPaths,
  joinScopedPrefix,
  normalizeRoutePath,
  publicPathPattern,
  scopedPathMatchDetails,
  stripScopedWildcard,
  validatePath
} = require('./path.js');

function loadContractsRoutePlan() {
  try {
    return require('@pulse-compute/wasm-contracts/route-plan');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../contracts/src/route-plan.js');
    }
    throw error;
  }
}

function loadContractsEvents() {
  try {
    return require('@pulse-compute/wasm-contracts/events');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code) && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../contracts/src/events/contracts.js');
    }
    throw error;
  }
}

function scriptKindForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return ts.ScriptKind.TS;
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function readSourceFile(filePath) {
  const abs = path.resolve(filePath);
  const text = fs.readFileSync(abs, 'utf8');
  return ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindForFile(abs));
}

function refToString(ref) {
  if (!ref) return undefined;
  if (ref.kind === 'handler') return ref.id;
  if (ref.kind === 'identifier' || ref.kind === 'inline' || ref.kind === 'ref' || ref.kind === 'static') return ref.value;
  return String(ref.value ?? ref.id ?? '');
}

function refToName(ref) {
  if (!ref) return undefined;
  if (ref.kind === 'handler') return ref.name;
  if (ref.kind === 'identifier' || ref.kind === 'inline' || ref.kind === 'ref' || ref.kind === 'static') return ref.value;
  return String(ref.value ?? ref.name ?? '');
}

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral;
}

function literalText(node) {
  return node.text;
}

function nodeText(sourceFile, node) {
  return node.getText(sourceFile).trim();
}

function isInlineFunction(node) {
  return patternIsInlineFunction(ts, node);
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers && node.modifiers.some((modifier) => modifier.kind === kind));
}

function isExportedNode(node) {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function parameterName(sourceFile, parameter) {
  if (ts.isIdentifier(parameter.name)) return parameter.name.text;
  return nodeText(sourceFile, parameter.name);
}

function describeFunctionSignature(sourceFile, node) {
  const params = Array.from(node.parameters || []).map((parameter) => parameterName(sourceFile, parameter));
  const nonIdentifierParams = Array.from(node.parameters || [])
    .filter((parameter) => !ts.isIdentifier(parameter.name))
    .map((parameter) => nodeText(sourceFile, parameter.name));
  const returnType = node.type ? node.type.getText(sourceFile) : undefined;
  return {
    async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
    generator: Boolean(node.asteriskToken),
    paramCount: params.length,
    params,
    nonIdentifierParams,
    returnType,
    returnsPromise: Boolean(returnType && /\bPromise\b/.test(returnType))
  };
}

function declarationHandlerKind(init) {
  if (ts.isArrowFunction(init)) return 'const-arrow';
  if (ts.isFunctionExpression(init)) return 'const-function-expression';
  return 'unknown';
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression?.(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function parseDiagnostics(sourceFile) {
  const diagnostics = [];
  for (const parseDiag of sourceFile.parseDiagnostics || []) {
    const start = parseDiag.start ?? 0;
    const end = start + (parseDiag.length ?? 0);
    const startLC = sourceFile.getLineAndCharacterOfPosition(start);
    const endLC = sourceFile.getLineAndCharacterOfPosition(end);
    diagnostics.push({
      phase: 'parse',
      code: 'PULSEWASM_PARSE_ERROR',
      message: ts.flattenDiagnosticMessageText(parseDiag.messageText, '\n'),
      hint: 'Fix syntax before PulseWasm extraction can continue.',
      loc: {
        file: sourceFile.fileName,
        start: { line: startLC.line + 1, column: startLC.character + 1, offset: start },
        end: { line: endLC.line + 1, column: endLC.character + 1, offset: end }
      }
    });
  }
  return diagnostics;
}

function unwrapReferenceExpression(node) {
  const wrappers = [];
  let current = node;
  while (current) {
    if (ts.isParenthesizedExpression(current)) wrappers.push('parentheses');
    else if (ts.isAsExpression(current)) wrappers.push('as-cast');
    else if (ts.isTypeAssertionExpression(current)) wrappers.push('type-assertion');
    else if (ts.isSatisfiesExpression?.(current)) wrappers.push('satisfies');
    else if (ts.isNonNullExpression(current)) wrappers.push('non-null');
    else break;
    current = current.expression;
  }
  return { expression: current, wrappers };
}

function parseHandlerRef(sourceFile, node, diagnostics, phase = 'extract') {
  const unwrapped = unwrapReferenceExpression(node);
  const classified = classifyHandlerReference(ts, unwrapped.expression);
  if (classified.status === 'match' && classified.value.kind === 'identifier') {
    return { kind: 'identifier', value: classified.value.name, ...(unwrapped.wrappers.length > 0 ? { wrappers: unwrapped.wrappers } : {}), loc: sourceLoc(sourceFile, node) };
  }
  if (classified.status === 'match' && classified.value.kind === 'inline') {
    const value = nodeText(sourceFile, unwrapped.expression);
    return {
      kind: 'inline',
      value,
      inlineKind: classified.value.inlineKind,
      ...(unwrapped.wrappers.length > 0 ? { wrappers: unwrapped.wrappers } : {}),
      sourceTextHash: sourceTextHash(value),
      signature: describeFunctionSignature(sourceFile, unwrapped.expression),
      loc: sourceLoc(sourceFile, node)
    };
  }
  diagnostics.push(
    diagnostic(
      sourceFile,
      node,
      DIAGNOSTIC_CODES.UNSUPPORTED_HANDLER,
      'Unsupported handler expression. PulseWasm v1 accepts direct identifier handlers and inline function expressions only.',
      'Use handlerName, function (...) { ... }, or (...) => { ... }.',
      { phase }
    )
  );
  return { kind: 'unsupported', value: nodeText(sourceFile, node), loc: sourceLoc(sourceFile, node) };
}

function parseChannelRef(sourceFile, node, diagnostics, phase = 'extract') {
  const classified = classifyChannelReference(ts, node, (innerTs, innerNode) => isStringLiteralLike(innerNode));
  if (classified.status === 'match' && classified.value.kind === 'static') {
    return { kind: 'static', value: classified.value.value, loc: sourceLoc(sourceFile, node) };
  }
  if (classified.status === 'match' && classified.value.kind === 'identifier') {
    return { kind: 'ref', value: classified.value.name, loc: sourceLoc(sourceFile, node) };
  }
  if (classified.status === 'match' && classified.value.kind === 'inline') {
    const value = nodeText(sourceFile, node);
    return {
      kind: 'inline',
      value,
      inlineKind: classified.value.inlineKind,
      sourceTextHash: sourceTextHash(value),
      signature: describeFunctionSignature(sourceFile, node),
      loc: sourceLoc(sourceFile, node)
    };
  }
  diagnostics.push(
    diagnostic(
      sourceFile,
      node,
      DIAGNOSTIC_CODES.UNSUPPORTED_CHANNEL,
      'Unsupported channel expression. PulseWasm v1 accepts string literals, identifiers, and inline functions only.',
      'Use .channel("name"), .channel(channelFactory), or .channel((ctx) => "name").',
      { phase }
    )
  );
  return { kind: 'ref', value: nodeText(sourceFile, node), unsupported: true, loc: sourceLoc(sourceFile, node) };
}


function propertyNameTextForObject(sourceFile, nameNode, diagnostics, node) {
  if (ts.isIdentifier(nameNode) || isStringLiteralLike(nameNode) || ts.isNumericLiteral(nameNode)) return nameNode.text;
  diagnostics.push(
    diagnostic(
      sourceFile,
      nameNode,
      'PULSEWASM_TIMEOUT_COMPUTED_KEY',
      'Computed timeout option keys are not supported in PulseWasm scope timeout metadata.',
      'Use static timeout keys such as defaultMs, hardMs, effectDefaultMs, and schedulerResolutionMs.',
      { phase: 'extract' }
    )
  );
  return nodeText(sourceFile, nameNode || node);
}

function parseTimeoutLiteral(sourceFile, node, diagnostics, phase = 'extract') {
  const expr = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(expr)) {
    diagnostics.push(
      diagnostic(
        sourceFile,
        node,
        'PULSEWASM_TIMEOUT_DYNAMIC',
        'Router .timeout(...) requires a static object literal in PulseWasm v1.',
        'Use .timeout({ defaultMs: 5000, hardMs: 30000, effectDefaultMs: 5000 }).',
        { phase }
      )
    );
    return { unsupported: true, source: nodeText(sourceFile, node), loc: sourceLoc(sourceFile, node) };
  }

  const allowed = new Set(['defaultMs', 'hardMs', 'effectDefaultMs', 'schedulerResolutionMs']);
  const config = { loc: sourceLoc(sourceFile, node) };
  for (const prop of expr.properties) {
    if (ts.isSpreadAssignment(prop)) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          prop,
          'PULSEWASM_TIMEOUT_SPREAD_UNSUPPORTED',
          'Object spread is not supported in router .timeout(...) metadata.',
          'Write timeout metadata as a direct object literal.',
          { phase }
        )
      );
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          prop,
          'PULSEWASM_TIMEOUT_PROPERTY_UNSUPPORTED',
          'Only plain property assignments are supported in router .timeout(...) metadata.',
          'Use .timeout({ defaultMs: 5000 }).',
          { phase }
        )
      );
      continue;
    }
    const key = propertyNameTextForObject(sourceFile, prop.name, diagnostics, prop);
    if (!allowed.has(key)) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          prop.name,
          'PULSEWASM_TIMEOUT_OPTION_UNSUPPORTED',
          `Unsupported router timeout option ${JSON.stringify(key)}.`,
          'Allowed timeout options: defaultMs, hardMs, effectDefaultMs, schedulerResolutionMs.',
          { phase }
        )
      );
      continue;
    }
    const valueExpr = unwrapExpression(prop.initializer);
    if (!ts.isNumericLiteral(valueExpr)) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          prop.initializer,
          'PULSEWASM_TIMEOUT_VALUE_UNSUPPORTED',
          `Router timeout option ${key} must be a positive integer literal.`,
          'Use a numeric literal such as 5000.',
          { phase }
        )
      );
      continue;
    }
    const value = Number(valueExpr.text);
    if (!Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          prop.initializer,
          'PULSEWASM_TIMEOUT_VALUE_INVALID',
          `Router timeout option ${key} must be a positive integer number of milliseconds.`,
          'Use a positive integer such as 5000.',
          { phase }
        )
      );
      continue;
    }
    config[key] = value;
  }
  return config;
}

function parsePathLiteral(sourceFile, node, diagnostics, usage, phase = 'extract') {
  if (!isStringLiteralLike(node)) {
    diagnostics.push(
      diagnostic(
        sourceFile,
        node,
        DIAGNOSTIC_CODES.DYNAMIC_PATH,
        `Dynamic ${usage} paths are not supported in PulseWasm v1.`,
        'Use a string literal path such as "/compute/:id".',
        { phase }
      )
    );
    return nodeText(sourceFile, node);
  }

  const raw = literalText(node);
  try {
    const { normalized } = validatePath(raw, { allowWildcard: true });
    return normalized;
  } catch (error) {
    diagnostics.push(
      diagnostic(
        sourceFile,
        node,
        DIAGNOSTIC_CODES.INVALID_PATH,
        error.message,
        'Allowed grammar: literal segments, :param segments, and at most one trailing * segment.',
        { phase }
      )
    );
    return normalizeRoutePath(raw);
  }
}

function parseEventTypeLiteral(sourceFile, node, diagnostics) {
  if (!isStringLiteralLike(node)) {
    diagnostics.push(diagnostic(
      sourceFile,
      node,
      EVENTS.EVENT_DIAGNOSTIC_CODES.TYPE_INVALID,
      'Pulse.on event types must be direct string literals.',
      'Use app.on("namespace.event", { schema: "events.Payload" }, handler).',
      { phase: 'extract' }
    ));
    return nodeText(sourceFile, node);
  }
  const value = literalText(node);
  try {
    return EVENTS.normalizeEventType(value);
  } catch (error) {
    diagnostics.push(diagnostic(
      sourceFile,
      node,
      error.code || EVENTS.EVENT_DIAGNOSTIC_CODES.TYPE_INVALID,
      error.message,
      'Use a non-empty event type within the canonical UTF-8 byte limit.',
      { phase: 'extract' }
    ));
    return value;
  }
}

function parseEventDeclarationLiteral(sourceFile, node, diagnostics) {
  const expression = unwrapExpression(node);
  let schema;
  let valid = true;
  if (!ts.isObjectLiteralExpression(expression) || expression.properties.length !== 1) {
    valid = false;
  } else {
    const property = expression.properties[0];
    const staticName = property && ts.isPropertyAssignment(property)
      && (ts.isIdentifier(property.name) || isStringLiteralLike(property.name))
      ? property.name.text
      : undefined;
    if (staticName !== 'schema') valid = false;
    else {
      const value = unwrapExpression(property.initializer);
      if (value.kind === ts.SyntaxKind.NullKeyword) schema = null;
      else if (isStringLiteralLike(value)) schema = literalText(value);
      else valid = false;
    }
  }
  if (!valid) {
    diagnostics.push(diagnostic(
      sourceFile,
      node,
      EVENTS.EVENT_DIAGNOSTIC_CODES.DECLARATION_INVALID,
      'Pulse.on declarations must be direct object literals containing exactly one literal schema field.',
      'Use { schema: "events.Payload" } or { schema: null } without spreads, computed keys, or aliases.',
      { phase: 'extract' }
    ));
    return { version: EVENTS.EVENT_DECLARATION_VERSION, schemaId: undefined, unsupported: true };
  }
  try {
    return EVENTS.normalizeEventDeclaration({ schema });
  } catch (error) {
    diagnostics.push(diagnostic(
      sourceFile,
      node,
      error.code || EVENTS.EVENT_DIAGNOSTIC_CODES.DECLARATION_INVALID,
      error.message,
      'Use a bounded dotted schema ID or explicit null.',
      { phase: 'extract' }
    ));
    return { version: EVENTS.EVENT_DECLARATION_VERSION, schemaId: schema, unsupported: true };
  }
}

function parseEventOperation(sourceFile, step, diagnostics) {
  const { args, node, order, statementOrder } = step;
  const loc = sourceLoc(sourceFile, node);
  if (args.length !== 3) {
    diagnostics.push(diagnostic(
      sourceFile,
      node,
      'PULSEWASM_EVENTS_SIGNATURE_UNSUPPORTED',
      `Pulse.on() expects exactly 3 arguments, got ${args.length}.`,
      'Use app.on(type, { schema }, handler).',
      { phase: 'extract' }
    ));
    return { kind: 'event', order, statementOrder, loc, unsupported: true };
  }
  return {
    kind: 'event',
    order,
    statementOrder,
    loc,
    type: parseEventTypeLiteral(sourceFile, args[0], diagnostics),
    declaration: parseEventDeclarationLiteral(sourceFile, args[1], diagnostics),
    handler: parseHandlerRef(sourceFile, args[2], diagnostics, 'extract-event')
  };
}

function isRouterNewExpression(init) {
  return patternIsRouterNewExpression(ts, init, (_ts, node) => unwrapExpression(node));
}

function isDirectRouterDeclarationInitializer(node) {
  return patternIsDirectRouterDeclarationInitializer(ts, node);
}

function indexSourceFile(sourceFile, options = {}) {
  const cwd = options.cwd || process.cwd();
  const diagnostics = [];
  const routers = new Map();
  const handlers = new Map();
  let routerOrder = 0;
  let handlerOrder = 0;

  function addHandler(name, declarationNode, functionNode, kind) {
    const sourceText = nodeText(sourceFile, functionNode || declarationNode);
    const exportCarrier = declarationNode.parent && ts.isVariableStatement(declarationNode.parent)
      ? declarationNode.parent
      : declarationNode;
    const exportName = isExportedNode(exportCarrier) ? name : undefined;
    handlers.set(name, {
      symbolId: name,
      name,
      localName: name,
      exportName,
      order: handlerOrder++,
      kind,
      file: stableFileName(sourceFile.fileName, cwd),
      loc: sourceLoc(sourceFile, declarationNode),
      functionLoc: sourceLoc(sourceFile, functionNode || declarationNode),
      sourceTextHash: sourceTextHash(sourceText),
      signature: describeFunctionSignature(sourceFile, functionNode || declarationNode)
    });
  }

  ts.forEachChild(sourceFile, (statement) => {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      addHandler(statement.name.text, statement, statement, 'function-declaration');
      return;
    }

    if (!ts.isVariableStatement(statement)) return;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const name = declaration.name.text;
      const init = declaration.initializer;
      if (!init) continue;
      if (isRouterNewExpression(init)) {
        const construction = unwrapExpression(init);
        routers.set(name, {
          name,
          order: routerOrder++,
          applicationKind: construction && ts.isNewExpression(construction) && ts.isIdentifier(construction.expression) && construction.expression.text === 'Pulse' ? 'pulse' : 'router',
          file: stableFileName(sourceFile.fileName, cwd),
          initLoc: sourceLoc(sourceFile, declaration)
        });
        continue;
      }
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        addHandler(name, declaration, init, declarationHandlerKind(init));
      }
    }
  });

  function walk(node) {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ['Router', 'Pulse'].includes(node.expression.text) && !isDirectRouterDeclarationInitializer(node)) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          node,
          DIAGNOSTIC_CODES.UNSUPPORTED_ROUTER_CONSTRUCTION,
          'Router or Pulse construction must be assigned directly to a top-level application variable.',
          'Use `const app = new Pulse({ auto: true })` for the project root or `const child = new Router()` for mounted routers.',
          { phase: 'index' }
        )
      );
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);

  return {
    routers,
    handlers,
    diagnostics,
    artifact: {
      version: 'pulsewasm.symbol-index.v1',
      generatedBy: PACKAGE_VERSION,
      source: stableFileName(sourceFile.fileName, cwd),
      routers: Array.from(routers.values()),
      handlers: Array.from(handlers.values())
    }
  };
}

function unwindCallChain(sourceFile, expr, diagnostics) {
  return unwindRouterCallChain(ts, sourceFile, expr, diagnostics, diagnostic);
}

function parseRouterOperation(sourceFile, step, diagnostics, options = {}) {
  const apiRegistry = options.apiRegistry || (options.routerApiDefinitions ? buildRouterApiRegistry(options.routerApiDefinitions) : DEFAULT_ROUTER_API_REGISTRY);
  const { method, args, node, order, statementOrder } = step;
  const loc = sourceLoc(sourceFile, node);
  const definition = apiRegistry.get(method);

  function base(kind) {
    return { kind, order, statementOrder, loc };
  }

  function arityMatches() {
    if (!definition) return false;
    if (!definition.allowedArities.includes(args.length)) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          node,
          DIAGNOSTIC_CODES.ARITY,
          `.${method}() expects ${arityDisplay(definition)} argument(s), got ${args.length}.`,
          'Use only the supported PulseWasm v1 route authoring subset.',
          { phase: 'extract' }
        )
      );
      return false;
    }
    return true;
  }

  if (method === 'on' && (options.applicationKind === 'pulse' || args.length === 3)) {
    return parseEventOperation(sourceFile, step, diagnostics);
  }

  if (!definition) {
    diagnostics.push(
      diagnostic(
        sourceFile,
        step.nameNode,
        DIAGNOSTIC_CODES.UNSUPPORTED_ROUTER_METHOD,
        `Unsupported router method .${method}().`,
        `Supported methods: ${apiRegistry.supportedMethodNames().map((name) => `.${name}()`).join(', ')}.`,
        { phase: 'extract' }
      )
    );
    return { ...base('unsupported'), method };
  }

  if (!arityMatches()) return { ...base('unsupported'), method };
  const signature = signatureForArity(definition, args.length) || {};

  if (definition.kind === 'route') {
    return {
      ...base(definition.opKind),
      method: definition.method,
      route: true,
      path: parsePathLiteral(sourceFile, args[signature.pathArg], diagnostics, 'route'),
      handler: parseHandlerRef(sourceFile, args[signature.handlerArg], diagnostics)
    };
  }

  if (definition.kind === 'mount') {
    const routerArg = args[signature.routerArg];
    const unwrappedRouter = unwrapReferenceExpression(routerArg);
    if (!ts.isIdentifier(unwrappedRouter.expression)) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          routerArg,
          DIAGNOSTIC_CODES.UNSUPPORTED_MOUNT_TARGET,
          'Mounted routers must be direct router variable references, optionally wrapped by parentheses, a cast, non-null assertion, or satisfies expression.',
          'Use app.mount("/prefix", childRouter).',
          { phase: 'extract' }
        )
      );
    }
    return {
      ...base(definition.opKind),
      path: stripScopedWildcard(parsePathLiteral(sourceFile, args[signature.pathArg], diagnostics, 'mount')),
      router: ts.isIdentifier(unwrappedRouter.expression) ? unwrappedRouter.expression.text : nodeText(sourceFile, routerArg),
      ...(unwrappedRouter.wrappers.length > 0 ? { routerWrappers: unwrappedRouter.wrappers } : {})
    };
  }

  if (definition.kind === 'middleware') {
    const op = { ...base(definition.opKind) };
    if (signature.pathArg !== undefined) {
      op.path = stripScopedWildcard(parsePathLiteral(sourceFile, args[signature.pathArg], diagnostics, 'middleware'));
    }
    op.handler = parseHandlerRef(sourceFile, args[signature.handlerArg], diagnostics);
    return op;
  }

  if (definition.kind === 'channel') {
    return {
      ...base(definition.opKind),
      value: parseChannelRef(sourceFile, args[signature.valueArg], diagnostics)
    };
  }

  if (definition.kind === 'lifecycle') {
    const eventArg = args[signature.eventArg];
    if (!isStringLiteralLike(eventArg) || !(definition.allowedEvents || []).includes(literalText(eventArg))) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          eventArg,
          DIAGNOSTIC_CODES.UNSUPPORTED_LIFECYCLE,
          'Only .on("connect", handler) and .on("disconnect", handler) are supported in PulseWasm v1.',
          `Use a literal lifecycle event: ${(definition.allowedEvents || []).map((event) => JSON.stringify(event)).join(' or ')}.`,
          { phase: 'extract' }
        )
      );
    }
    return {
      ...base(definition.opKind),
      event: isStringLiteralLike(eventArg) ? literalText(eventArg) : nodeText(sourceFile, eventArg),
      handler: parseHandlerRef(sourceFile, args[signature.handlerArg], diagnostics)
    };
  }


  if (definition.kind === 'timeout') {
    return {
      ...base(definition.opKind),
      value: parseTimeoutLiteral(sourceFile, args[signature.valueArg], diagnostics)
    };
  }

  if (definition.kind === 'error') {
    return {
      ...base(definition.opKind),
      handler: parseHandlerRef(sourceFile, args[signature.handlerArg], diagnostics)
    };
  }

  return { ...base('unsupported'), method };
}

function extractRouterOperations(sourceFile, routerMap, options = {}) {
  const apiRegistry = options.apiRegistry || (options.routerApiDefinitions ? buildRouterApiRegistry(options.routerApiDefinitions) : DEFAULT_ROUTER_API_REGISTRY);
  const diagnostics = [];
  const opsByRouter = new Map();
  for (const name of routerMap.keys()) opsByRouter.set(name, []);
  const acceptedOutermostCalls = new Set();
  const routerAliases = new Map();
  let aliasesChanged = true;
  while (aliasesChanged) {
    aliasesChanged = false;
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const value = unwrapExpression(declaration.initializer);
        if (!ts.isIdentifier(value)) continue;
        const target = routerMap.has(value.text) ? value.text : routerAliases.get(value.text);
        if (target && !routerAliases.has(declaration.name.text)) {
          routerAliases.set(declaration.name.text, target);
          aliasesChanged = true;
        }
      }
    }
  }
  let statementOrder = 0;
  let operationOrder = 0;

  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const chain = unwindCallChain(sourceFile, statement.expression, diagnostics);
    if (!chain || !routerMap.has(chain.root)) continue;
    acceptedOutermostCalls.add(statement.expression);
    const routerOps = opsByRouter.get(chain.root);
    const router = routerMap.get(chain.root);
    const currentStatementOrder = statementOrder++;
    for (const step of chain.steps) {
      routerOps.push(parseRouterOperation(sourceFile, { ...step, order: operationOrder++, statementOrder: currentStatementOrder }, diagnostics, {
        apiRegistry,
        applicationKind: router && router.applicationKind
      }));
    }
  }

  function walk(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && routerMap.has(node.left.text)) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          node,
          DIAGNOSTIC_CODES.ROUTER_REASSIGNMENT,
          `Router variable "${node.left.text}" is reassigned. Reassigning router variables is unsupported in PulseWasm v1.`,
          'Declare each router once and register routes through direct chained calls.',
          { phase: 'extract' }
        )
      );
    }

    if (ts.isCallExpression(node) && isOutermostCallInChain(ts, node)) {
      const chain = unwindCallChain(sourceFile, node, []);
      if (chain && routerMap.has(chain.root) && !acceptedOutermostCalls.has(node)) {
        const eventRegistration = chain.steps.some((step) => step.method === 'on' && (routerMap.get(chain.root)?.applicationKind === 'pulse' || step.args.length === 3));
        diagnostics.push(
          diagnostic(
            sourceFile,
            node,
            eventRegistration ? 'PULSEWASM_EVENTS_REGISTRATION_HIDDEN' : DIAGNOSTIC_CODES.DYNAMIC_ROUTE_REGISTRATION,
            eventRegistration
              ? 'Pulse event registrations must be visible as top-level expression statements on the application root.'
              : 'Router registration calls must be top-level expression statements in PulseWasm v1.',
            eventRegistration
              ? 'Move Pulse.on declarations out of conditionals, loops, helper functions, and nested blocks.'
              : 'Move route declarations out of conditionals, loops, helper functions, and nested blocks.',
            { phase: 'extract' }
          )
        );
      } else if (chain && routerAliases.has(chain.root) && chain.steps.some((step) => step.method === 'on' && step.args.length === 3)) {
        diagnostics.push(diagnostic(
          sourceFile,
          node,
          'PULSEWASM_EVENTS_REGISTRATION_HIDDEN',
          'Pulse event registrations must use the directly declared application root identifier.',
          'Register the event with app.on(type, { schema }, handler) on the top-level Pulse root.',
          { phase: 'extract' }
        ));
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      const value = unwrapExpression(node.initializer);
      if (ts.isPropertyAccessExpression(value)
        && value.name.text === 'on'
        && ts.isIdentifier(value.expression)
        && (routerMap.has(value.expression.text) || routerAliases.has(value.expression.text))) {
        diagnostics.push(diagnostic(
          sourceFile,
          node,
          'PULSEWASM_EVENTS_REGISTRATION_HIDDEN',
          'Pulse.on cannot be extracted, aliased, rebound, or invoked indirectly.',
          'Declare each event with a direct top-level app.on(type, { schema }, handler) call.',
          { phase: 'extract' }
        ));
      }
    }

    ts.forEachChild(node, walk);
  }
  walk(sourceFile);

  return {
    opsByRouter,
    diagnostics,
    summary: {
      routersWithOps: Array.from(opsByRouter.entries()).filter(([, ops]) => ops.length > 0).length,
      operations: operationOrder,
      statements: statementOrder
    }
  };
}

function buildRouterIR(sourceFile, options = {}) {
  const cwd = options.cwd || process.cwd();
  const index = indexSourceFile(sourceFile, options);
  const extraction = extractRouterOperations(sourceFile, index.routers, options);

  const routerIR = Array.from(index.routers.values()).map((router) => ({
    name: router.name,
    order: router.order,
    file: router.file,
    initLoc: router.initLoc,
    ops: extraction.opsByRouter.get(router.name) || []
  }));

  const handlerIR = Array.from(index.handlers.values());
  return {
    source: stableFileName(sourceFile.fileName, cwd),
    routerIR,
    handlerIR,
    symbolIndex: index.artifact,
    diagnostics: [...index.diagnostics, ...extraction.diagnostics],
    summary: {
      routers: routerIR.length,
      handlers: handlerIR.length,
      operations: extraction.summary.operations,
      routersWithOps: extraction.summary.routersWithOps,
      statements: extraction.summary.statements
    }
  };
}

function validateIR(ir) {
  const diagnostics = [...ir.diagnostics];
  const routerNames = new Set(ir.routerIR.map((router) => router.name));

  for (const router of ir.routerIR) {
    for (const op of router.ops) {
      if (op.kind === 'mount' && !routerNames.has(op.router)) {
        diagnostics.push({
          phase: 'validate',
          code: 'PULSEWASM_UNKNOWN_MOUNT_TARGET',
          message: `Router "${router.name}" mounts unknown router "${op.router}".`,
          hint: 'Mounted routers must be declared as direct new Router() variables in the same source file.',
          loc: op.loc
        });
      }
      if (op.kind === 'unsupported') {
        diagnostics.push({
          phase: 'validate',
          code: 'PULSEWASM_UNSUPPORTED_OPERATION',
          message: `Unsupported router operation .${op.method || '<unknown>'}().`,
          hint: 'Use only the supported PulseWasm v1 route authoring subset.',
          loc: op.loc
        });
      }
    }
  }

  return diagnostics;
}


function cloneIR(ir) {
  return {
    ...ir,
    routerIR: (ir.routerIR || []).map((router) => ({
      ...router,
      ops: (router.ops || []).map((op) => ({ ...op }))
    })),
    handlerIR: [...(ir.handlerIR || [])],
    diagnostics: [...(ir.diagnostics || [])],
    summary: { ...(ir.summary || {}) }
  };
}

function pathUsageForOp(op) {
  if (!op || !op.path) return undefined;
  if (op.route || ROUTE_METHODS.has(op.kind)) return 'route';
  if (op.kind === 'mount') return 'mount';
  if (op.kind === 'use') return 'middleware';
  return undefined;
}

function normalizePathIR(ir, options = {}) {
  const diagnostics = [];
  const normalizedIR = cloneIR(ir);
  let paths = 0;
  let scopedPaths = 0;
  let wildcardPaths = 0;

  for (const router of normalizedIR.routerIR || []) {
    for (const op of router.ops || []) {
      const usage = pathUsageForOp(op);
      if (!usage) continue;
      paths += 1;
      const scoped = usage === 'mount' || usage === 'middleware';
      if (scoped) scopedPaths += 1;
      try {
        const compiled = compileRoutePath(op.path, {
          scoped,
          allowWildcard: true
        });
        if (compiled.wildcard) wildcardPaths += 1;
        op.pathPattern = publicPathPattern(compiled);
        op.pathGrammarVersion = PATH_GRAMMAR_VERSION;
        op.path = scoped ? stripScopedWildcard(compiled.normalized) : compiled.normalized;
      } catch (error) {
        diagnostics.push({
          pass: 'path-normalize',
          code: DIAGNOSTIC_CODES.INVALID_PATH,
          severity: 'error',
          message: error.message,
          hint: 'Allowed grammar: literal segments, :param segments, and at most one unnamed trailing * segment.',
          loc: op.loc
        });
      }
    }
  }

  return {
    ir: normalizedIR,
    diagnostics,
    summary: {
      paths,
      scopedPaths,
      wildcardPaths,
      grammarVersion: PATH_GRAMMAR_VERSION
    }
  };
}

function resolveRouterTreeFromIR(ir, rootName) {
  const routers = new Map(ir.routerIR.map((router) => [router.name, router]));
  const visiting = new Set();
  const visited = new Set();

  function build(name, stack = []) {
    const router = routers.get(name);
    if (!router) {
      throw new ExtractionError({
        phase: 'resolve',
        code: 'PULSEWASM_UNKNOWN_ROOT_ROUTER',
        message: `Unknown root router "${name}".`,
        hint: `Available routers: ${Array.from(routers.keys()).join(', ') || '<none>'}`,
        loc: { file: '<route-extractor>' }
      });
    }
    if (visiting.has(name)) {
      throw new ExtractionError({
        phase: 'resolve',
        code: 'PULSEWASM_MOUNT_CYCLE',
        message: `Mount cycle detected: ${[...stack, name].join(' -> ')}.`,
        hint: 'PulseWasm v1 requires an acyclic router mount tree.',
        loc: router.initLoc
      });
    }

    visiting.add(name);
    const children = [];
    for (const op of router.ops) {
      if (op.kind === 'mount') {
        children.push({
          order: op.order,
          mountPath: op.path,
          router: build(op.router, [...stack, name]),
          loc: op.loc
        });
      }
    }
    visiting.delete(name);
    visited.add(name);

    return {
      name: router.name,
      order: router.order,
      file: router.file,
      initLoc: router.initLoc,
      ops: router.ops,
      children
    };
  }

  const tree = build(rootName);
  return { tree, visitedRouters: Array.from(visited) };
}

function resolveRouterTree(ir, rootName, options = {}) {
  const cwd = options.cwd || process.cwd();
  const resolved = resolveRouterTreeFromIR(ir, rootName);
  return {
    version: 'pulsewasm.router-tree.v1',
    generatedBy: PACKAGE_VERSION,
    source: ir.source,
    entryRouter: rootName,
    visitedRouters: resolved.visitedRouters,
    tree: normalizeArtifact(resolved.tree, cwd)
  };
}

function cloneAccumulator(acc) {
  return {
    pathPrefix: acc.pathPrefix,
    middleware: [...acc.middleware],
    scopedMiddleware: [...acc.scopedMiddleware],
    errorHandlers: [...acc.errorHandlers],
    connectHandlers: [...acc.connectHandlers],
    disconnectHandlers: [...acc.disconnectHandlers],
    channel: acc.channel ? { ...acc.channel } : undefined
  };
}

function flattenRouterTree(tree, options = {}) {
  const root = tree.tree || tree;
  const routes = [];
  const diagnostics = options.diagnostics || [];
  const routerByName = new Map();

  function collect(node) {
    routerByName.set(node.name, node);
    for (const child of node.children || []) collect(child.router);
  }
  collect(root);

  function scopedMiddlewareMatchesForRoute(absolutePath, acc) {
    const matches = [];
    for (const entry of acc.scopedMiddleware) {
      let details;
      try {
        details = scopedPathMatchDetails(absolutePath, entry.path);
      } catch (error) {
        diagnostics.push({
          pass: 'flatten',
          code: 'PULSEWASM_INVALID_SCOPED_MIDDLEWARE_PATH',
          severity: 'error',
          message: error.message,
          hint: 'Path-scoped middleware must use the same strict PulseWasm path grammar as routes.',
          loc: entry.loc
        });
        continue;
      }

      for (const detail of details.diagnostics || []) {
        diagnostics.push({
          pass: 'flatten',
          code: detail.code,
          severity: 'error',
          message: detail.message,
          hint: detail.hint,
          loc: entry.loc
        });
      }

      if (!details.matches) continue;
      const compiled = compileRoutePath(entry.path, { scoped: true, allowWildcard: true });
      matches.push({
        path: entry.path,
        pattern: publicPathPattern(compiled),
        captures: details.captures || [],
        handler: entry.handler,
        loc: entry.loc
      });
    }
    return matches;
  }

  function emitRoute(op, acc, routerName) {
    const absolutePath = joinPaths(acc.pathPrefix, op.path);
    let compiled;
    try {
      compiled = compileRoutePath(absolutePath, { allowWildcard: true });
    } catch (error) {
      diagnostics.push({
        pass: 'flatten',
        code: 'PULSEWASM_INVALID_FLATTENED_PATH',
        severity: 'error',
        message: error.message,
        hint: 'Mounted route paths must flatten into the strict PulseWasm path grammar.',
        loc: op.loc
      });
      return;
    }

    const scopedMatches = scopedMiddlewareMatchesForRoute(absolutePath, acc);
    const scopedRefs = scopedMatches.map((entry) => entry.handler);
    const allMiddlewareRefs = [...acc.middleware, ...scopedRefs].filter(Boolean);
    const params = compiled.params;
    const pathPattern = publicPathPattern(compiled);
    const method = op.method || op.kind.toUpperCase();
    const runtimeId = routes.length;
    const stableInput = buildRouteStableInput({
      method,
      path: absolutePath,
      params,
      middleware: allMiddlewareRefs,
      errorHandlers: acc.errorHandlers,
      connectHandlers: acc.connectHandlers,
      disconnectHandlers: acc.disconnectHandlers,
      handler: op.handler,
      channel: acc.channel
    });
    const plan = {
      id: runtimeId,
      runtimeId,
      stableId: createRouteStableId({
        method,
        path: absolutePath,
        params,
        middleware: allMiddlewareRefs,
        errorHandlers: acc.errorHandlers,
        connectHandlers: acc.connectHandlers,
        disconnectHandlers: acc.disconnectHandlers,
        handler: op.handler,
        channel: acc.channel
      }),
      stableInput,
      order: op.order,
      sourceRouter: routerName,
      method,
      path: absolutePath,
      pathPattern,
      params,
      scopedMiddleware: scopedMatches.map((entry) => ({
        path: entry.path,
        pattern: entry.pattern,
        captures: entry.captures,
        handler: refToString(entry.handler),
        handlerName: refToName(entry.handler),
        loc: entry.loc
      })),
      middleware: allMiddlewareRefs.map(refToString).filter(Boolean),
      middlewareNames: allMiddlewareRefs.map(refToName).filter(Boolean),
      errorHandlers: acc.errorHandlers.map(refToString).filter(Boolean),
      errorHandlerNames: acc.errorHandlers.map(refToName).filter(Boolean),
      connectHandlers: acc.connectHandlers.map(refToString).filter(Boolean),
      connectHandlerNames: acc.connectHandlers.map(refToName).filter(Boolean),
      disconnectHandlers: acc.disconnectHandlers.map(refToString).filter(Boolean),
      disconnectHandlerNames: acc.disconnectHandlers.map(refToName).filter(Boolean),
      handler: refToString(op.handler),
      handlerName: refToName(op.handler),
      loc: op.loc
    };
    if (acc.channel) {
      plan.channel = acc.channel.kind === 'handler'
        ? { kind: 'handler', value: acc.channel.id, name: acc.channel.name }
        : { kind: acc.channel.kind, value: acc.channel.value };
    }
    routes.push(plan);
  }

  function walk(node, incomingAcc) {
    const acc = cloneAccumulator(incomingAcc);

    for (const op of node.ops || []) {
      switch (op.kind) {
        case 'use': {
          if (op.path) {
            acc.scopedMiddleware.push({
              path: joinScopedPrefix(acc.pathPrefix, op.path),
              handler: op.handler,
              loc: op.loc
            });
          } else {
            acc.middleware.push(op.handler);
          }
          break;
        }
        case 'error': {
          acc.errorHandlers.push(op.handler);
          break;
        }
        case 'lifecycle': {
          if (op.event === 'connect') acc.connectHandlers.push(op.handler);
          else if (op.event === 'disconnect') acc.disconnectHandlers.push(op.handler);
          break;
        }
        case 'channel': {
          acc.channel = op.value;
          break;
        }
        case 'get':
        case 'post': {
          emitRoute(op, acc, node.name);
          break;
        }
        case 'mount': {
          const child = routerByName.get(op.router);
          if (!child) break;
          const childAcc = cloneAccumulator(acc);
          childAcc.pathPrefix = joinScopedPrefix(acc.pathPrefix, op.path);
          walk(child, childAcc);
          break;
        }
        default:
          if (op.route || ROUTE_METHODS.has(op.kind)) {
            emitRoute(op, acc, node.name);
          }
          break;
      }
    }
  }

  walk(root, {
    pathPrefix: '/',
    middleware: [],
    scopedMiddleware: [],
    errorHandlers: [],
    connectHandlers: [],
    disconnectHandlers: [],
    channel: undefined
  });

  return routes;
}

function createRoutePlanResult(ir, routerTreeArtifact, rootName, sourceFile, options = {}) {
  const cwd = options.cwd || process.cwd();
  const diagnostics = [];
  const routes = flattenRouterTree(routerTreeArtifact, { ...options, diagnostics });
  const routePlan = normalizeArtifact(
    {
      version: ROUTE_PLAN_VERSION,
      generatedBy: PACKAGE_VERSION,
      source: stableFileName(sourceFile.fileName, cwd),
      entryRouter: rootName,
      pathPolicy: PATH_POLICY,
      idPolicy: ROUTE_ID_POLICY,
      routes
    },
    cwd
  );
  return { routePlan, diagnostics };
}

function createRoutePlan(ir, routerTreeArtifact, rootName, sourceFile, options = {}) {
  return createRoutePlanResult(ir, routerTreeArtifact, rootName, sourceFile, options).routePlan;
}

function extractionSummary({ sourceFile, ir, routerTree, routePlan, handlerTable, handlerEval, dispatchTable, executionPlan, handlerBindings, executionHarness, localHarness, assemblyScriptShape, assemblyScriptCore, assemblyScriptCompile, assemblyScriptWasmSmoke, wasmHostAbi, wasmHostBridge, requestResultHeaders, channelBroadcaster, jsonBody, backendCapabilities, deploymentPosture, hostRuntimeKernel, nodeAdapter, streamingPassthrough, handlerLibraryContracts, assetsLoweringPlan, assetsSidecarCompileLinkProof, assetsCompiledWasmSidecarPlan, nodeAssetsProviderProof, nodeCompiledWasmAssetsLifecycleProof, fastlyAssetsProviderProof, fastlyAssetsPackageOutParityProof, routeHandlerEffectPlan, nodeRouteHandlerEffectProof, fastlyRouteHandlerEffectProof, fastlyLifecycleParityProof, routeHandlerContextLoweringPlan, handlerIoLifecyclePlan, requestJsonBodyPlan, schemaDecodeResultPlan, schemaResponseCodecPlan, backendJsonRequestBodyPlan, nodeRequestJsonBodyProof, nodeSchemaDecodeResultProof, nodeSchemaResponseCodecProof, hostCapabilities, effectRuntime, effectComposition, compiledHandlers, schemaJsonCompile, schemaJsonGenericParser, schemaJsonSidecar, librarySidecars, integratedCompiledApp, compiledWasmRuntime, pulseWrapper, fastlyReadiness, fastlyHostcallBinding, fastlyAdapter, fastlyCommandEntry, dispatchTs, includeAst, cwd }) {
  return {
    source: stableFileName(sourceFile.fileName, cwd || process.cwd()),
    routers: ir.routerIR.length,
    handlerDeclarations: ir.handlerIR.length,
    handlers: handlerTable ? handlerTable.handlers.length : ir.handlerIR.length,
    handlerEval: handlerEval ? handlerEval.summary : undefined,
    operations: ir.summary.operations,
    visitedRouters: routerTree.visitedRouters.length,
    routes: routePlan.routes.length,
    dispatch: dispatchTable ? dispatchTable.summary : undefined,
    executionPlan: executionPlan ? executionPlan.summary : undefined,
    handlerBindings: handlerBindings ? handlerBindings.artifact.summary : undefined,
    executionHarness: executionHarness ? executionHarness.artifact.summary : undefined,
    localHarness: localHarness ? localHarness.artifact.summary : undefined,
    assemblyScriptShape: assemblyScriptShape ? assemblyScriptShape.artifact.summary : undefined,
    assemblyScriptCore: assemblyScriptCore ? assemblyScriptCore.artifact.summary : undefined,
    assemblyScriptCompile: assemblyScriptCompile ? assemblyScriptCompile.artifact.summary : undefined,
    assemblyScriptWasmSmoke: assemblyScriptWasmSmoke ? assemblyScriptWasmSmoke.artifact.summary : undefined,
    wasmHostAbi: wasmHostAbi ? wasmHostAbi.artifact.summary : undefined,
    wasmHostBridge: wasmHostBridge ? wasmHostBridge.artifact.summary : undefined,
    requestResultHeaders: requestResultHeaders ? requestResultHeaders.artifact.summary : undefined,
    channelBroadcaster: channelBroadcaster ? channelBroadcaster.artifact.summary : undefined,
    jsonBody: jsonBody ? jsonBody.artifact.summary : undefined,
    backendCapabilities: backendCapabilities ? backendCapabilities.artifact.summary : undefined,
    deploymentPosture: deploymentPosture ? deploymentPosture.artifact.summary : undefined,
    hostRuntimeKernel: hostRuntimeKernel ? hostRuntimeKernel.artifact.summary : undefined,
    nodeAdapter: nodeAdapter ? nodeAdapter.artifact.summary : undefined,
    streamingPassthrough: streamingPassthrough ? streamingPassthrough.artifact.summary : undefined,
    handlerLibraryContracts: handlerLibraryContracts ? handlerLibraryContracts.artifact.summary : undefined,
    assetsLoweringPlan: assetsLoweringPlan ? assetsLoweringPlan.artifact.summary : undefined,
    assetsCompiledWasmSidecarPlan: assetsCompiledWasmSidecarPlan ? assetsCompiledWasmSidecarPlan.artifact.summary : undefined,
    assetsSidecarCompileLinkProof: assetsSidecarCompileLinkProof ? assetsSidecarCompileLinkProof.artifact.summary : undefined,
    nodeAssetsProviderProof: nodeAssetsProviderProof ? nodeAssetsProviderProof.artifact.summary : undefined,
    nodeCompiledWasmAssetsLifecycleProof: nodeCompiledWasmAssetsLifecycleProof ? nodeCompiledWasmAssetsLifecycleProof.artifact.summary : undefined,
    fastlyAssetsProviderProof: fastlyAssetsProviderProof ? fastlyAssetsProviderProof.artifact.summary : undefined,
    fastlyAssetsPackageOutParityProof: fastlyAssetsPackageOutParityProof ? fastlyAssetsPackageOutParityProof.artifact.summary : undefined,
    routeHandlerEffectPlan: routeHandlerEffectPlan ? routeHandlerEffectPlan.artifact.summary : undefined,
    nodeRouteHandlerEffectProof: nodeRouteHandlerEffectProof ? nodeRouteHandlerEffectProof.artifact.summary : undefined,
    fastlyRouteHandlerEffectProof: fastlyRouteHandlerEffectProof ? fastlyRouteHandlerEffectProof.artifact.summary : undefined,
    fastlyLifecycleParityProof: fastlyLifecycleParityProof ? fastlyLifecycleParityProof.artifact.summary : undefined,
    routeHandlerContextLoweringPlan: routeHandlerContextLoweringPlan ? routeHandlerContextLoweringPlan.artifact.summary : undefined,
    handlerIoLifecyclePlan: handlerIoLifecyclePlan ? handlerIoLifecyclePlan.artifact.summary : undefined,
    requestJsonBodyPlan: requestJsonBodyPlan ? requestJsonBodyPlan.artifact.summary : undefined,
    nodeRequestJsonBodyProof: nodeRequestJsonBodyProof ? nodeRequestJsonBodyProof.artifact.summary : undefined,
    schemaDecodeResultPlan: schemaDecodeResultPlan ? schemaDecodeResultPlan.artifact.summary : undefined,
    schemaResponseCodecPlan: schemaResponseCodecPlan ? schemaResponseCodecPlan.artifact.summary : undefined,
    backendJsonRequestBodyPlan: backendJsonRequestBodyPlan ? backendJsonRequestBodyPlan.artifact.summary : undefined,
    nodeSchemaDecodeResultProof: nodeSchemaDecodeResultProof ? nodeSchemaDecodeResultProof.artifact.summary : undefined,
    nodeSchemaResponseCodecProof: nodeSchemaResponseCodecProof ? nodeSchemaResponseCodecProof.artifact.summary : undefined,
    hostCapabilities: hostCapabilities ? hostCapabilities.artifact.summary : undefined,
    effectRuntime: effectRuntime ? effectRuntime.artifact.summary : undefined,
    effectComposition: effectComposition ? effectComposition.artifact.summary : undefined,
    compiledHandlers: compiledHandlers ? compiledHandlers.artifact.summary : undefined,
    schemaJsonCompile: schemaJsonCompile ? schemaJsonCompile.artifact.summary : undefined,
    schemaJsonGenericParser: schemaJsonGenericParser ? schemaJsonGenericParser.artifact.summary : undefined,
    schemaJsonSidecar: schemaJsonSidecar ? schemaJsonSidecar.artifact.summary : undefined,
    librarySidecars: librarySidecars ? librarySidecars.artifact.summary : undefined,
    integratedCompiledApp: integratedCompiledApp ? integratedCompiledApp.artifact.summary : undefined,
    compiledWasmRuntime: compiledWasmRuntime ? compiledWasmRuntime.artifact.summary : undefined,
    pulseWrapper: pulseWrapper ? pulseWrapper.artifact.summary : undefined,
    fastlyReadiness: fastlyReadiness ? fastlyReadiness.artifact.summary : undefined,
    fastlyHostcallBinding: fastlyHostcallBinding ? fastlyHostcallBinding.artifact.summary : undefined,
    fastlyAdapter: fastlyAdapter ? fastlyAdapter.artifact.summary : undefined,
    fastlyCommandEntry: fastlyCommandEntry ? fastlyCommandEntry.artifact.summary : undefined,
    dispatchTs: dispatchTs ? dispatchTs.manifest.summary : undefined,
    astIncluded: Boolean(includeAst)
  };
}

function makePass(name, status, summary = {}) {
  return { name, status, summary };
}

function lowerableFacadeAllowances(manifestRecords = []) {
  const allowedImports = [];
  const allowedImportCalls = [];
  const allowedImportMemberCalls = [];
  for (const record of manifestRecords || []) {
    const manifest = record && record.manifest ? record.manifest : record;
    if (!manifest || !manifest.lowerableSubpath) continue;
    allowedImports.push(manifest.lowerableSubpath);
    const facade = manifest.facade || {};
    const namespace = facade.namespace || manifest.namespace;
    for (const symbol of facade.symbols || []) {
      allowedImportCalls.push(`${manifest.lowerableSubpath}:${symbol}`);
      if (namespace) allowedImportMemberCalls.push(`${manifest.lowerableSubpath}:${namespace}.${symbol}`);
      allowedImportMemberCalls.push(`${manifest.lowerableSubpath}:default.${symbol}`);
    }
  }
  return { allowedImports, allowedImportCalls, allowedImportMemberCalls };
}

function extractFromSourceFile(sourceFile, options = {}) {
  options = { ...options };
  const providerProofs = options.providerProofs && typeof options.providerProofs === 'object'
    ? options.providerProofs
    : Object.freeze({});
  function providerProof(name) {
    const proof = providerProofs[name];
    if (typeof proof !== 'function') {
      throw new TypeError(`Pulse legacy provider proof ${name} requires an explicit CLI/testing composition root.`);
    }
    return proof;
  }
  const buildNodeAdapter = (...args) => providerProof('buildNodeAdapter')(...args);
  const buildNodeAssetsProviderProof = (...args) => providerProof('buildNodeAssetsProviderProof')(...args);
  const buildNodeCompiledWasmAssetsLifecycleProof = (...args) => providerProof('buildNodeCompiledWasmAssetsLifecycleProof')(...args);
  const buildNodeRouteHandlerEffectProof = (...args) => providerProof('buildNodeRouteHandlerEffectProof')(...args);
  const buildNodeRequestJsonBodyProof = (...args) => providerProof('buildNodeRequestJsonBodyProof')(...args);
  const buildNodeSchemaDecodeResultProof = (...args) => providerProof('buildNodeSchemaDecodeResultProof')(...args);
  const buildNodeSchemaResponseCodecProof = (...args) => providerProof('buildNodeSchemaResponseCodecProof')(...args);
  const buildFastlyReadiness = (...args) => providerProof('buildFastlyReadiness')(...args);
  const buildFastlyHostcallBinding = (...args) => providerProof('buildFastlyHostcallBinding')(...args);
  const buildFastlyStreamHeaderAdapter = (...args) => providerProof('buildFastlyStreamHeaderAdapter')(...args);
  const buildFastlyCommandEntry = (...args) => providerProof('buildFastlyCommandEntry')(...args);
  const buildFastlyAssetsProviderProof = (...args) => providerProof('buildFastlyAssetsProviderProof')(...args);
  const buildFastlyAssetsPackageOutParityProof = (...args) => providerProof('buildFastlyAssetsPackageOutParityProof')(...args);
  const buildFastlyRouteHandlerEffectProof = (...args) => providerProof('buildFastlyRouteHandlerEffectProof')(...args);
  const buildFastlyLifecycleParityProof = (...args) => providerProof('buildFastlyLifecycleParityProof')(...args);
  if (options.emitStreamingPassthrough) {
    options.emitNodeAdapter = true;
    options.emitHostRuntimeKernel = true;
    options.emitWasmHostBridge = true;
    options.emitWasmHostAbi = true;
    options.emitRequestResultHeaders = true;
  }
  if (options.emitCompiledHandlers) {
    options.emitAssemblyScriptCore = true;
    options.emitAssemblyScriptShape = true;
    options.emitRouteHandlerContextLoweringPlan = true;
  }
  if (options.emitLibrarySidecars) {
    options.emitHandlerLibraryContracts = true;
  }
  if (options.emitNodeAssetsProviderProof) {
    options.emitAssetsLoweringPlan = true;
  }
  if (options.emitNodeRouteHandlerEffectProof) {
    options.emitRouteHandlerEffectPlan = true;
    options.emitRouteHandlerContextLoweringPlan = true;
    options.emitEffectComposition = true;
    options.emitEffectRuntime = true;
  }
  if (options.emitFastlyRouteHandlerEffectProof) {
    options.emitRouteHandlerEffectPlan = true;
    options.emitRouteHandlerContextLoweringPlan = true;
    options.emitEffectComposition = true;
    options.emitEffectRuntime = true;
  }
  if (options.emitFastlyLifecycleParityProof) {
    options.emitRouteHandlerEffectPlan = true;
    options.emitRouteHandlerContextLoweringPlan = true;
    options.emitHandlerIoLifecyclePlan = true;
    options.emitBackendJsonRequestBodyPlan = true;
    options.emitEffectComposition = true;
    options.emitEffectRuntime = true;
  }
  if (options.emitFastlyAssetsProviderProof) {
    options.emitAssetsLoweringPlan = true;
  }
  if (options.emitAssetsLoweringPlan) {
    options.emitHandlerLibraryContracts = true;
  }
  if (options.emitSchemaJsonSidecar) {
    options.emitJsonBody = true;
    options.emitWasmHostAbi = true;
  }
  if (options.emitBackendJsonRequestBodyPlan) {
    options.emitRouteHandlerEffectPlan = true;
    options.emitRequestJsonBodyPlan = true;
    options.emitSchemaResponseCodecPlan = true;
  }
  if (options.emitNodeBackendJsonRequestBodyProof) {
    options.emitBackendJsonRequestBodyPlan = true;
  }
  if (options.emitHandlerIoLifecyclePlan) {
    options.emitRouteHandlerContextLoweringPlan = true;
    options.emitRouteHandlerEffectPlan = true;
  }

  if (options.emitRouteHandlerEffectPlan) {
    options.emitEffectComposition = true;
    options.emitEffectRuntime = true;
  }
  if (options.emitEffectComposition) {
    options.emitEffectRuntime = true;
  }
  if (options.emitFastlyAdapter) {
    options.emitFastlyHostcallBinding = true;
  }
  if (options.emitFastlyHostcallBinding) {
    options.emitFastlyReadiness = true;
  }
  if (options.emitFastlyReadiness) {
    options.emitPulseWrapper = true;
    options.emitHostCapabilities = true;
    options.emitEffectComposition = true;
    options.emitEffectRuntime = true;
    options.emitBackendCapabilities = true;
  }

  if (options.emitPulseWrapper) {
    options.emitCompiledWasmRuntime = true;
  }

  if (options.emitEffectRuntime) {
    options.emitHostCapabilities = true;
  }

  if (options.emitHostCapabilities) {
    options.emitHandlerLibraryContracts = true;
  }

  if (options.emitNodeAdapter) {
    options.emitHostRuntimeKernel = true;
  }

  if (options.emitHostRuntimeKernel) {
    options.emitWasmHostBridge = true;
    options.emitWasmHostAbi = true;
    options.emitAssemblyScriptCore = true;
    options.emitAssemblyScriptShape = true;
    options.emitJsonBody = true;
    options.emitRequestResultHeaders = true;
    options.emitChannelBroadcaster = true;
    options.emitBackendCapabilities = true;
  }

  if (options.emitJsonBody) {
    options.emitRequestResultHeaders = true;
    options.emitWasmHostAbi = true;
  }

  if (options.emitChannelBroadcaster) {
    options.emitRequestResultHeaders = true;
    options.emitWasmHostAbi = true;
  }

  if (options.emitRequestResultHeaders) {
    options.emitWasmHostAbi = true;
  }

  if (options.emitWasmHostBridge) {
    options.emitWasmHostAbi = true;
    options.emitAssemblyScriptCore = true;
    options.emitAssemblyScriptShape = true;
  }

  if (options.emitWasmSmoke) {
    options.emitAssemblyScriptCompile = true;
    options.emitAssemblyScriptCore = true;
    options.emitAssemblyScriptShape = true;
  }

  if (options.emitAssemblyScriptCompile) {
    options.emitAssemblyScriptCore = true;
    options.emitAssemblyScriptShape = true;
  }

  if (options.emitLocalHarness) {
    options.emitExecutionHarness = true;
    options.emitHandlerBindings = true;
    options.emitDispatchTs = true;
    options.emitAssemblyScriptCore = true;
    options.emitAssemblyScriptShape = true;
  }
  const cwd = options.cwd || process.cwd();
  const passes = [];
  const source = sourceFile.fileName;

  const parseDiags = parseDiagnostics(sourceFile);
  passes.push(makePass('parse', parseDiags.length === 0 ? 'ok' : 'error', { diagnostics: parseDiags.length }));
  if (parseDiags.length > 0) {
    throw new ExtractionError(parseDiags, { passes, source });
  }

  const ir = buildRouterIR(sourceFile, options);
  const indexDiagnostics = ir.diagnostics.filter((diag) => (diag.phase || diag.pass) === 'index');
  const extractDiagnostics = ir.diagnostics.filter((diag) => (diag.phase || diag.pass) !== 'index');
  passes.push(makePass('index', indexDiagnostics.length === 0 ? 'ok' : 'error', {
    routers: ir.routerIR.length,
    handlers: ir.handlerIR.length,
    diagnostics: indexDiagnostics.length
  }));
  passes.push(makePass('extract', extractDiagnostics.length === 0 ? 'ok' : 'error', {
    operations: ir.summary.operations,
    routersWithOps: ir.summary.routersWithOps,
    diagnostics: extractDiagnostics.length
  }));

  const validationDiagnostics = validateIR(ir);
  passes.push(makePass('validate', validationDiagnostics.length === 0 ? 'ok' : 'error', { diagnostics: validationDiagnostics.length }));
  if (validationDiagnostics.length > 0) {
    throw new ExtractionError(validationDiagnostics, { passes, source, summary: ir.summary });
  }

  const pathNormalization = normalizePathIR(ir, { cwd });
  passes.push(makePass('path-normalize', pathNormalization.diagnostics.length === 0 ? 'ok' : 'error', {
    ...pathNormalization.summary,
    diagnostics: pathNormalization.diagnostics.length
  }));
  if (pathNormalization.diagnostics.length > 0) {
    throw new ExtractionError(pathNormalization.diagnostics, { passes, source, summary: ir.summary });
  }
  const normalizedIR = pathNormalization.ir;

  const handlerResolution = buildHandlerTable(normalizedIR, { cwd });
  passes.push(makePass('handler-table', handlerResolution.diagnostics.length === 0 ? 'ok' : 'error', {
    handlers: handlerResolution.handlerTable.handlers.length,
    diagnostics: handlerResolution.diagnostics.length
  }));
  if (handlerResolution.diagnostics.length > 0) {
    throw new ExtractionError(handlerResolution.diagnostics, { passes, source, summary: ir.summary });
  }
  const resolvedIR = handlerResolution.resolvedIR;

  const lowerableManifestRecords = options.emitAssetsLoweringPlan
    ? discoverLowerableLibraryManifests({ cwd, workspaceRoot: options.workspaceRoot })
    : [];
  const handlerEvaluationAllowances = lowerableFacadeAllowances(lowerableManifestRecords);
  const handlerEvaluation = buildHandlerEval(sourceFile, handlerResolution.handlerTable, {
    cwd,
    allowedImports: handlerEvaluationAllowances.allowedImports,
    allowedImportCalls: handlerEvaluationAllowances.allowedImportCalls,
    allowedImportMemberCalls: handlerEvaluationAllowances.allowedImportMemberCalls
  });
  passes.push(makePass('handler-eval', handlerEvaluation.diagnostics.length === 0 ? 'ok' : 'error', {
    handlers: handlerEvaluation.handlerEval.handlers.length,
    dependencies: handlerEvaluation.handlerEval.summary.dependencies,
    diagnostics: handlerEvaluation.diagnostics.length
  }));
  if (handlerEvaluation.diagnostics.length > 0) {
    throw new ExtractionError(handlerEvaluation.diagnostics, { passes, source, summary: ir.summary });
  }

  const rootName = options.root || (resolvedIR.routerIR[0] && resolvedIR.routerIR[0].name);
  if (!rootName) {
    const diagnostics = [{
      phase: 'resolve',
      code: 'PULSEWASM_NO_ROUTER',
      message: 'No direct `new Router()` declaration was found.',
      hint: 'Declare a router with `const app = new Router()`.',
      loc: { file: sourceFile.fileName }
    }];
    passes.push(makePass('resolve', 'error', { diagnostics: diagnostics.length }));
    throw new ExtractionError(diagnostics, { passes, source, summary: ir.summary });
  }

  let routerTree;
  try {
    routerTree = resolveRouterTree(resolvedIR, rootName, options);
    passes.push(makePass('resolve', 'ok', {
      entryRouter: rootName,
      visitedRouters: routerTree.visitedRouters.length
    }));
  } catch (error) {
    if (error instanceof ExtractionError) {
      const diagnostics = error.diagnostics.map((diag) => ({ ...diag, phase: diag.phase || 'resolve' }));
      passes.push(makePass('resolve', 'error', { diagnostics: diagnostics.length }));
      throw new ExtractionError(diagnostics, { passes, source, summary: ir.summary });
    }
    throw error;
  }

  const routePlanResult = createRoutePlanResult(resolvedIR, routerTree, rootName, sourceFile, options);
  const routePlan = routePlanResult.routePlan;
  passes.push(makePass('flatten', routePlanResult.diagnostics.length === 0 ? 'ok' : 'error', {
    routes: routePlan.routes.length,
    diagnostics: routePlanResult.diagnostics.length
  }));
  if (routePlanResult.diagnostics.length > 0) {
    throw new ExtractionError(routePlanResult.diagnostics, { passes, source, summary: ir.summary });
  }
  const routeIdMap = normalizeArtifact(createRouteIdMap(routePlan, { cwd, generatedBy: PACKAGE_VERSION }), cwd);
  const pathTable = buildPathTable(routePlan, { cwd, generatedBy: PACKAGE_VERSION });
  const dispatchResult = buildDispatchTable(routePlan, handlerResolution.handlerTable, handlerEvaluation.handlerEval, pathTable, { cwd, generatedBy: PACKAGE_VERSION });
  const dispatchTable = dispatchResult.dispatchTable;
  passes.push(makePass('stable-ids', 'ok', {
    routes: routePlan.routes.length,
    stableIds: routeIdMap.summary.stableIds,
    runtimeIds: routeIdMap.summary.runtimeIds
  }));
  passes.push(makePass('path-table', 'ok', pathTable.summary));
  passes.push(makePass('dispatch-table', dispatchResult.diagnostics.length === 0 ? 'ok' : 'error', dispatchTable.summary));
  if (dispatchResult.diagnostics.length > 0) {
    throw new ExtractionError(dispatchResult.diagnostics, { passes, source, summary: ir.summary });
  }

  const executionPlanResult = buildExecutionPlan(routerTree, dispatchTable, { cwd, generatedBy: PACKAGE_VERSION, resolvedConfig: options.resolvedConfig });
  const executionPlan = executionPlanResult.executionPlan;
  passes.push(makePass('execution-plan', executionPlanResult.diagnostics.length === 0 ? 'ok' : 'error', executionPlan.summary));
  if (executionPlanResult.diagnostics.length > 0) {
    throw new ExtractionError(executionPlanResult.diagnostics, { passes, source, summary: ir.summary });
  }

  let assemblyScriptShape;
  if (options.emitAssemblyScriptShape || options.emitAssemblyScriptCore) {
    assemblyScriptShape = buildAssemblyScriptShape(dispatchTable, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      executionPlan
    });
    passes.push(makePass('assemblyscript-shape', assemblyScriptShape.diagnostics.length === 0 ? 'ok' : 'error', assemblyScriptShape.artifact.summary));
    if (assemblyScriptShape.diagnostics.length > 0) {
      throw new ExtractionError(assemblyScriptShape.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let assemblyScriptCore;
  if (options.emitAssemblyScriptCore) {
    assemblyScriptCore = buildAssemblyScriptCore(dispatchTable, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      executionPlan,
      assemblyScriptShape
    });
    passes.push(makePass('assemblyscript-core', assemblyScriptCore.diagnostics.length === 0 ? 'ok' : 'error', assemblyScriptCore.artifact.summary));
    if (assemblyScriptCore.diagnostics.length > 0) {
      throw new ExtractionError(assemblyScriptCore.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let assemblyScriptCompile;
  if (options.emitAssemblyScriptCompile) {
    assemblyScriptCompile = buildAssemblyScriptCompileSmoke(assemblyScriptShape, assemblyScriptCore, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      outDir: options.outDir
    });
    passes.push(makePass('assemblyscript-compile', assemblyScriptCompile.diagnostics.length === 0 ? 'ok' : 'error', assemblyScriptCompile.artifact.summary));
    if (assemblyScriptCompile.diagnostics.length > 0) {
      throw new ExtractionError(assemblyScriptCompile.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let assemblyScriptWasmSmoke;
  if (options.emitWasmSmoke) {
    assemblyScriptWasmSmoke = buildAssemblyScriptWasmSmoke(assemblyScriptShape, assemblyScriptCore, assemblyScriptCompile, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      outDir: options.outDir
    });
    passes.push(makePass('assemblyscript-wasm-smoke', assemblyScriptWasmSmoke.diagnostics.length === 0 ? 'ok' : 'error', assemblyScriptWasmSmoke.artifact.summary));
    if (assemblyScriptWasmSmoke.diagnostics.length > 0) {
      throw new ExtractionError(assemblyScriptWasmSmoke.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let handlerBindings;
  if (options.emitHandlerBindings || options.emitExecutionHarness) {
    handlerBindings = buildTypeScriptHandlerBindings(dispatchTable, handlerResolution.handlerTable, {
      cwd,
      outDir: options.outDir,
      generatedBy: PACKAGE_VERSION
    });
    passes.push(makePass('handler-bindings', handlerBindings.diagnostics.length === 0 ? 'ok' : 'error', handlerBindings.artifact.summary));
    if (handlerBindings.diagnostics.length > 0) {
      throw new ExtractionError(handlerBindings.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let executionHarness;
  if (options.emitExecutionHarness) {
    executionHarness = buildTypeScriptExecutionHarness(dispatchTable, handlerBindings, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      executionPlan
    });
    passes.push(makePass('execution-harness', executionHarness.diagnostics.length === 0 ? 'ok' : 'error', executionHarness.artifact.summary));
    if (executionHarness.diagnostics.length > 0) {
      throw new ExtractionError(executionHarness.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let localHarness;
  if (options.emitLocalHarness) {
    localHarness = buildTypeScriptLocalHarness(dispatchTable, handlerBindings, executionHarness, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      executionPlan
    });
    passes.push(makePass('local-harness', localHarness.diagnostics.length === 0 ? 'ok' : 'error', localHarness.artifact.summary));
    if (localHarness.diagnostics.length > 0) {
      throw new ExtractionError(localHarness.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let wasmHostAbi;
  if (options.emitWasmHostAbi) {
    wasmHostAbi = buildWasmHostAbi(dispatchTable, executionPlan, {
      cwd,
      generatedBy: PACKAGE_VERSION
    });
    passes.push(makePass('wasm-host-abi', wasmHostAbi.diagnostics.length === 0 ? 'ok' : 'error', wasmHostAbi.artifact.summary));
    if (wasmHostAbi.diagnostics.length > 0) {
      throw new ExtractionError(wasmHostAbi.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let wasmHostBridge;
  if (options.emitWasmHostBridge) {
    wasmHostBridge = buildWasmHostBridge(assemblyScriptShape, assemblyScriptCore, wasmHostAbi, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      outDir: options.outDir
    });
    passes.push(makePass('wasm-host-bridge', wasmHostBridge.diagnostics.length === 0 ? 'ok' : 'error', wasmHostBridge.artifact.summary));
    if (wasmHostBridge.diagnostics.length > 0) {
      throw new ExtractionError(wasmHostBridge.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let requestResultHeaders;
  if (options.emitRequestResultHeaders) {
    requestResultHeaders = buildRequestResultHeaders(dispatchTable, executionPlan, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      wasmHostAbi,
      wasmHostBridge
    });
    passes.push(makePass('request-result-headers', requestResultHeaders.diagnostics.length === 0 ? 'ok' : 'error', requestResultHeaders.artifact.summary));
    if (requestResultHeaders.diagnostics.length > 0) {
      throw new ExtractionError(requestResultHeaders.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let channelBroadcaster;
  if (options.emitJsonBody) {
    options.emitRequestResultHeaders = true;
    options.emitWasmHostAbi = true;
  }

  if (options.emitChannelBroadcaster) {
    channelBroadcaster = buildChannelBroadcaster(dispatchTable, executionPlan, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      wasmHostAbi,
      wasmHostBridge,
      requestResultHeaders
    });
    passes.push(makePass('channel-broadcaster', channelBroadcaster.diagnostics.length === 0 ? 'ok' : 'error', channelBroadcaster.artifact.summary));
    if (channelBroadcaster.diagnostics.length > 0) {
      throw new ExtractionError(channelBroadcaster.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let jsonBody;
  let backendCapabilities;
  let deploymentPosture;
  if (options.emitBackendCapabilities) {
    backendCapabilities = buildBackendCapabilities(dispatchTable, executionPlan, handlerEvaluation.handlerEval, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      resolvedConfig: options.resolvedConfig
    });
    passes.push(makePass('backend-capabilities', backendCapabilities.diagnostics.length === 0 ? 'ok' : 'error', backendCapabilities.artifact.summary));
    if (backendCapabilities.diagnostics.length > 0) {
      throw new ExtractionError(backendCapabilities.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  if (options.emitJsonBody) {
    jsonBody = buildJsonBodyAbi(dispatchTable, executionPlan, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      wasmHostAbi,
      requestResultHeaders,
      resolvedConfig: options.resolvedConfig
    });
    passes.push(makePass('json-body', jsonBody.diagnostics.length === 0 ? 'ok' : 'error', jsonBody.artifact.summary));
    if (jsonBody.diagnostics.length > 0) {
      throw new ExtractionError(jsonBody.diagnostics, { passes, source, summary: ir.summary });
    }

    deploymentPosture = buildDeploymentPosture(dispatchTable, executionPlan, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      resolvedConfig: options.resolvedConfig,
      jsonBody,
      backendCapabilities
    });
    passes.push(makePass('deployment-posture', deploymentPosture.diagnostics.length === 0 ? 'ok' : 'error', deploymentPosture.artifact.summary));
    if (deploymentPosture.diagnostics.length > 0) {
      throw new ExtractionError(deploymentPosture.diagnostics, { passes, source, summary: ir.summary });
    }
  } else if (options.emitBackendCapabilities) {
    deploymentPosture = buildDeploymentPosture(dispatchTable, executionPlan, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      resolvedConfig: options.resolvedConfig,
      backendCapabilities
    });
    passes.push(makePass('deployment-posture', deploymentPosture.diagnostics.length === 0 ? 'ok' : 'error', deploymentPosture.artifact.summary));
    if (deploymentPosture.diagnostics.length > 0) {
      throw new ExtractionError(deploymentPosture.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let hostRuntimeKernel;
  if (options.emitHostRuntimeKernel) {
    hostRuntimeKernel = buildHostRuntimeKernel(wasmHostAbi, wasmHostBridge, deploymentPosture, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      outDir: options.outDir
    });
    passes.push(makePass('host-runtime-kernel', hostRuntimeKernel.diagnostics.length === 0 ? 'ok' : 'error', hostRuntimeKernel.artifact.summary));
    if (hostRuntimeKernel.diagnostics.length > 0) {
      throw new ExtractionError(hostRuntimeKernel.diagnostics, { passes, source, summary: ir.summary });
    }
  }


  let nodeAdapter;
  if (options.emitNodeAdapter) {
    nodeAdapter = buildNodeAdapter(hostRuntimeKernel, wasmHostAbi, deploymentPosture, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      outDir: options.outDir
    });
    passes.push(makePass('node-adapter', nodeAdapter.diagnostics.length === 0 ? 'ok' : 'error', nodeAdapter.artifact.summary));
    if (nodeAdapter.diagnostics.length > 0) {
      throw new ExtractionError(nodeAdapter.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let streamingPassthrough;
  if (options.emitStreamingPassthrough) {
    streamingPassthrough = buildStreamingPassthrough({ wasmHostAbi, wasmHostBridge, hostRuntimeKernel, nodeAdapter, requestResultHeaders }, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      outDir: options.outDir,
      deploymentPosture
    });
    passes.push(makePass('streaming-passthrough', streamingPassthrough.diagnostics.length === 0 ? 'ok' : 'error', streamingPassthrough.artifact.summary));
    if (streamingPassthrough.diagnostics.length > 0) {
      throw new ExtractionError(streamingPassthrough.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let handlerLibraryContracts;
  if (options.emitHandlerLibraryContracts) {
    handlerLibraryContracts = buildHandlerLibraryContracts({
      cwd,
      generatedBy: PACKAGE_VERSION,
      dispatchTable,
      executionPlan,
      handlerTable: handlerResolution.handlerTable,
      handlerEval: handlerEvaluation.handlerEval,
      resolvedConfig: options.resolvedConfig
    });
    passes.push(makePass('handler-library-contracts', handlerLibraryContracts.diagnostics.length === 0 ? 'ok' : 'error', handlerLibraryContracts.artifact.summary));
    if (handlerLibraryContracts.diagnostics.length > 0) {
      throw new ExtractionError(handlerLibraryContracts.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let assetsLoweringPlan;
  if (options.emitAssetsLoweringPlan) {
    assetsLoweringPlan = buildAssetsLoweringPlan({
      cwd,
      generatedBy: PACKAGE_VERSION,
      sourceFile,
      manifestRecords: lowerableManifestRecords,
      routePlan,
      executionPlan,
      handlerTable: handlerResolution.handlerTable,
      handlerEval: handlerEvaluation.handlerEval,
      handlerLibraryContracts,
      resolvedConfig: options.resolvedConfig,
      typescript: ts
    });
    const assetsLoweringPlanErrors = assetsLoweringPlan.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('assets-lowering-plan', assetsLoweringPlanErrors.length === 0 ? 'ok' : 'error', assetsLoweringPlan.artifact.summary));
    if (assetsLoweringPlanErrors.length > 0) {
      throw new ExtractionError(assetsLoweringPlanErrors, { passes, source, summary: ir.summary });
    }
  }

  let assetsCompiledWasmSidecarPlan;
  if (options.emitAssetsCompiledWasmSidecarPlan) {
    assetsCompiledWasmSidecarPlan = buildAssetsCompiledWasmSidecarPlan({
      cwd,
      generatedBy: PACKAGE_VERSION,
      sourceFile,
      manifestRecords: lowerableManifestRecords,
      assetsLoweringPlan,
      handlerLibraryContracts,
      resolvedConfig: options.resolvedConfig,
      typescript: ts
    });
    const assetsCompiledWasmSidecarPlanErrors = assetsCompiledWasmSidecarPlan.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('assets-compiled-wasm-sidecar-plan', assetsCompiledWasmSidecarPlanErrors.length === 0 ? 'ok' : 'error', assetsCompiledWasmSidecarPlan.artifact.summary));
    if (assetsCompiledWasmSidecarPlanErrors.length > 0) {
      throw new ExtractionError(assetsCompiledWasmSidecarPlanErrors, { passes, source, summary: ir.summary });
    }
  }

  let assetsSidecarCompileLinkProof;
  if (options.emitAssetsSidecarCompileLinkProof) {
    assetsSidecarCompileLinkProof = buildAssetsSidecarCompileLinkProof({
      cwd,
      generatedBy: PACKAGE_VERSION,
      sourceFile,
      manifestRecords: lowerableManifestRecords,
      assetsLoweringPlan,
      assetsCompiledWasmSidecarPlan,
      handlerLibraryContracts,
      resolvedConfig: options.resolvedConfig,
      typescript: ts
    });
    const assetsSidecarCompileLinkProofErrors = assetsSidecarCompileLinkProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('assets-sidecar-compile-link-proof', assetsSidecarCompileLinkProofErrors.length === 0 ? 'ok' : 'error', assetsSidecarCompileLinkProof.artifact.summary));
    if (assetsSidecarCompileLinkProofErrors.length > 0) {
      throw new ExtractionError(assetsSidecarCompileLinkProofErrors, { passes, source, summary: ir.summary });
    }
  }

  let nodeAssetsProviderProof;
  if (options.emitNodeAssetsProviderProof) {
    nodeAssetsProviderProof = buildNodeAssetsProviderProof({
      cwd,
      generatedBy: PACKAGE_VERSION,
      assetsLoweringPlan,
      resolvedConfig: options.resolvedConfig
    });
    const nodeAssetsProviderProofErrors = nodeAssetsProviderProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('node-assets-provider-proof', nodeAssetsProviderProofErrors.length === 0 ? 'ok' : 'error', nodeAssetsProviderProof.artifact.summary));
    if (nodeAssetsProviderProofErrors.length > 0) {
      throw new ExtractionError(nodeAssetsProviderProofErrors, { passes, source, summary: ir.summary });
    }
  }

  let nodeCompiledWasmAssetsLifecycleProof;
  if (options.emitNodeCompiledWasmAssetsLifecycleProof) {
    nodeCompiledWasmAssetsLifecycleProof = buildNodeCompiledWasmAssetsLifecycleProof({
      cwd,
      generatedBy: PACKAGE_VERSION,
      assetsLoweringPlan,
      assetsCompiledWasmSidecarPlan,
      resolvedConfig: options.resolvedConfig,
      configRoot: options.configRoot || options.resolvedConfigDir || options.configDir || options.entryDir || cwd
    });
    const nodeCompiledWasmAssetsLifecycleProofErrors = nodeCompiledWasmAssetsLifecycleProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('node-compiled-wasm-assets-lifecycle-proof', nodeCompiledWasmAssetsLifecycleProofErrors.length === 0 ? 'ok' : 'error', nodeCompiledWasmAssetsLifecycleProof.artifact.summary));
    if (nodeCompiledWasmAssetsLifecycleProofErrors.length > 0) {
      throw new ExtractionError(nodeCompiledWasmAssetsLifecycleProofErrors, { passes, source, summary: ir.summary });
    }
  }

  let hostCapabilities;
  if (options.emitHostCapabilities) {
    hostCapabilities = buildHostCapabilities({
      cwd,
      generatedBy: PACKAGE_VERSION,
      handlerLibraryContracts,
      requestResultHeaders,
      channelBroadcaster,
      jsonBody,
      backendCapabilities,
      wasmHostAbi,
      resolvedConfig: options.resolvedConfig
    });
    passes.push(makePass('host-capabilities', hostCapabilities.diagnostics.length === 0 ? 'ok' : 'error', hostCapabilities.artifact.summary));
    if (hostCapabilities.diagnostics.length > 0) {
      throw new ExtractionError(hostCapabilities.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let effectRuntime;
  if (options.emitEffectRuntime) {
    effectRuntime = buildEffectRuntime({
      cwd,
      generatedBy: PACKAGE_VERSION,
      hostCapabilities,
      backendCapabilities,
      jsonBody,
      resolvedConfig: options.resolvedConfig
    });
    passes.push(makePass('effect-runtime', effectRuntime.diagnostics.length === 0 ? 'ok' : 'error', effectRuntime.artifact.summary));
    if (effectRuntime.diagnostics.length > 0) {
      throw new ExtractionError(effectRuntime.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let effectComposition;
  if (options.emitEffectComposition) {
    effectComposition = buildEffectComposition({
      cwd,
      generatedBy: PACKAGE_VERSION,
      effectRuntime,
      hostCapabilities,
      executionPlan,
      resolvedConfig: options.resolvedConfig
    });
    passes.push(makePass('effect-composition', effectComposition.diagnostics.length === 0 ? 'ok' : 'error', effectComposition.artifact.summary));
    if (effectComposition.diagnostics.length > 0) {
      throw new ExtractionError(effectComposition.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let routeHandlerEffectPlan;
  if (options.emitRouteHandlerEffectPlan) {
    routeHandlerEffectPlan = buildRouteHandlerEffectPlan(sourceFile, routePlan, handlerResolution.handlerTable, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      executionPlan,
      effectComposition,
      resolvedConfig: options.resolvedConfig
    });
    passes.push(makePass('route-handler-effects', routeHandlerEffectPlan.diagnostics.length === 0 ? 'ok' : 'error', routeHandlerEffectPlan.artifact.summary));
    if (routeHandlerEffectPlan.diagnostics.length > 0) {
      throw new ExtractionError(routeHandlerEffectPlan.diagnostics, { passes, source, summary: ir.summary });
    }
  }


  let nodeRouteHandlerEffectProof;
  if (options.emitNodeRouteHandlerEffectProof) {
    nodeRouteHandlerEffectProof = buildNodeRouteHandlerEffectProof({
      cwd,
      generatedBy: PACKAGE_VERSION,
      routeHandlerEffectPlan,
      resolvedConfig: options.resolvedConfig
    });
    const nodeRouteHandlerEffectProofErrors = nodeRouteHandlerEffectProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('node-route-handler-effect-proof', nodeRouteHandlerEffectProofErrors.length === 0 ? 'ok' : 'error', nodeRouteHandlerEffectProof.artifact.summary));
    if (nodeRouteHandlerEffectProofErrors.length > 0) {
      throw new ExtractionError(nodeRouteHandlerEffectProofErrors, { passes, source, summary: ir.summary });
    }
  }


  let fastlyRouteHandlerEffectProof;
  if (options.emitFastlyRouteHandlerEffectProof) {
    fastlyRouteHandlerEffectProof = buildFastlyRouteHandlerEffectProof({
      cwd,
      generatedBy: PACKAGE_VERSION,
      routeHandlerEffectPlan,
      resolvedConfig: options.resolvedConfig
    });
    const fastlyRouteHandlerEffectProofErrors = fastlyRouteHandlerEffectProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('fastly-route-handler-effect-proof', fastlyRouteHandlerEffectProofErrors.length === 0 ? 'ok' : 'error', fastlyRouteHandlerEffectProof.artifact.summary));
    if (fastlyRouteHandlerEffectProofErrors.length > 0) {
      throw new ExtractionError(fastlyRouteHandlerEffectProofErrors, { passes, source, summary: ir.summary });
    }
  }

  let routeHandlerContextLoweringPlan;
  if (options.emitRouteHandlerContextLoweringPlan) {
    routeHandlerContextLoweringPlan = buildRouteHandlerContextLoweringPlan(sourceFile, routePlan, handlerResolution.handlerTable, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      executionPlan,
      routeHandlerEffectPlan,
      resolvedConfig: options.resolvedConfig
    });
    const routeHandlerContextErrors = routeHandlerContextLoweringPlan.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('route-handler-context-lowering', routeHandlerContextErrors.length === 0 ? 'ok' : 'error', routeHandlerContextLoweringPlan.artifact.summary));
    if (routeHandlerContextErrors.length > 0) {
      throw new ExtractionError(routeHandlerContextErrors, { passes, source, summary: ir.summary });
    }
  }

  let schemaJsonCompile;
  const shouldCompileSchemaJson = Boolean(options.emitSchemaJsonCompile) || compileNeeded(options.resolvedConfig || {});
  let schemaResolvedConfig = options.resolvedConfig;
  if (shouldCompileSchemaJson) {
    schemaJsonCompile = buildSchemaJsonCompile({ cwd, generatedBy: PACKAGE_VERSION, resolvedConfig: options.resolvedConfig });
    passes.push(makePass('schema-json-compile', schemaJsonCompile.diagnostics.length === 0 ? 'ok' : 'error', schemaJsonCompile.artifact.summary));
    if (schemaJsonCompile.diagnostics.length > 0) {
      throw new ExtractionError(schemaJsonCompile.diagnostics, { passes, source, summary: ir.summary });
    }
    schemaResolvedConfig = schemaJsonCompile.compiledConfig;
  }

  let schemaJsonGenericParser;
  const shouldUseGenericSchemaJsonParser = Boolean(options.emitSchemaJsonGenericParser) || (Boolean(options.emitSchemaJsonSidecar) && genericParserNeeded(schemaResolvedConfig || {}));
  if (shouldUseGenericSchemaJsonParser) {
    schemaJsonGenericParser = buildSchemaJsonGenericParser(dispatchTable, executionPlan, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      outDir: options.outDir,
      resolvedConfig: schemaResolvedConfig,
      forceGenericParser: Boolean(options.emitSchemaJsonGenericParser)
    });
    passes.push(makePass('schema-json-generic-parser', schemaJsonGenericParser.diagnostics.length === 0 ? 'ok' : 'error', schemaJsonGenericParser.artifact.summary));
    if (schemaJsonGenericParser.diagnostics.length > 0) {
      throw new ExtractionError(schemaJsonGenericParser.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let schemaJsonSidecar;
  if (options.emitSchemaJsonSidecar && !schemaJsonGenericParser) {
    schemaJsonSidecar = buildSchemaJsonSidecar(dispatchTable, executionPlan, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      outDir: options.outDir,
      resolvedConfig: schemaResolvedConfig
    });
    passes.push(makePass('schema-json-sidecar', schemaJsonSidecar.diagnostics.length === 0 ? 'ok' : 'error', schemaJsonSidecar.artifact.summary));
    if (schemaJsonSidecar.diagnostics.length > 0) {
      throw new ExtractionError(schemaJsonSidecar.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let requestJsonBodyPlan;
  if (options.emitRequestJsonBodyPlan) {
    requestJsonBodyPlan = buildRequestJsonBodyPlan(sourceFile, routePlan, handlerResolution.handlerTable, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      resolvedConfig: schemaResolvedConfig || options.resolvedConfig,
      schemaJsonCompile,
      schemaJsonGenericParser,
      schemaJsonSidecar
    });
    const requestJsonBodyErrors = requestJsonBodyPlan.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('request-json-body', requestJsonBodyErrors.length === 0 ? 'ok' : 'error', requestJsonBodyPlan.artifact.summary));
    if (requestJsonBodyErrors.length > 0) {
      throw new ExtractionError(requestJsonBodyErrors, { passes, source, summary: ir.summary });
    }
  }

  let schemaDecodeResultPlan;
  if (options.emitSchemaDecodeResultPlan) {
    schemaDecodeResultPlan = buildSchemaDecodeResultPlan({
      cwd,
      generatedBy: PACKAGE_VERSION,
      resolvedConfig: schemaResolvedConfig || options.resolvedConfig,
      requestJsonBodyPlan,
      schemaJsonCompile,
      schemaJsonGenericParser,
      schemaJsonSidecar
    });
    const schemaDecodeResultErrors = schemaDecodeResultPlan.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('schema-decode-result', schemaDecodeResultErrors.length === 0 ? 'ok' : 'error', schemaDecodeResultPlan.artifact.summary));
    if (schemaDecodeResultErrors.length > 0) {
      throw new ExtractionError(schemaDecodeResultErrors, { passes, source, summary: ir.summary });
    }
  }

  let schemaResponseCodecPlan;
  if (options.emitSchemaResponseCodecPlan) {
    schemaResponseCodecPlan = buildSchemaResponseCodecPlan(sourceFile, routePlan, handlerResolution.handlerTable, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      resolvedConfig: schemaResolvedConfig || options.resolvedConfig,
      routeHandlerEffectPlan,
      requestJsonBodyPlan,
      schemaDecodeResultPlan,
      schemaJsonCompile,
      schemaJsonGenericParser,
      schemaJsonSidecar
    });
    const schemaResponseCodecErrors = schemaResponseCodecPlan.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('schema-response-codec', schemaResponseCodecErrors.length === 0 ? 'ok' : 'error', schemaResponseCodecPlan.artifact.summary));
    if (schemaResponseCodecErrors.length > 0) {
      throw new ExtractionError(schemaResponseCodecErrors, { passes, source, summary: ir.summary });
    }
  }

  let backendJsonRequestBodyPlan;
  if (options.emitBackendJsonRequestBodyPlan) {
    backendJsonRequestBodyPlan = buildBackendJsonRequestBodyPlan({
      cwd,
      generatedBy: PACKAGE_VERSION,
      routeHandlerEffectPlan,
      requestJsonBodyPlan,
      resolvedConfig: schemaResolvedConfig || options.resolvedConfig
    });
    const backendJsonRequestBodyErrors = backendJsonRequestBodyPlan.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('backend-json-request-body', backendJsonRequestBodyErrors.length === 0 ? 'ok' : 'error', backendJsonRequestBodyPlan.artifact.summary));
    if (backendJsonRequestBodyErrors.length > 0) {
      throw new ExtractionError(backendJsonRequestBodyErrors, { passes, source, summary: ir.summary });
    }
  }

  let handlerIoLifecyclePlan;
  if (options.emitHandlerIoLifecyclePlan) {
    handlerIoLifecyclePlan = buildHandlerIoLifecyclePlan(sourceFile, routePlan, handlerResolution.handlerTable, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      resolvedConfig: schemaResolvedConfig || options.resolvedConfig,
      routeHandlerContextLoweringPlan,
      routeHandlerEffectPlan,
      nodeRouteHandlerEffectProof,
      fastlyRouteHandlerEffectProof,
      schemaJsonCompile,
      requestJsonBodyPlan,
      schemaDecodeResultPlan,
      schemaResponseCodecPlan,
      schemaJsonGenericParser,
      schemaJsonSidecar
    });
    const handlerIoLifecycleErrors = handlerIoLifecyclePlan.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('handler-io-lifecycle', handlerIoLifecycleErrors.length === 0 ? 'ok' : 'error', handlerIoLifecyclePlan.artifact.summary));
    if (handlerIoLifecycleErrors.length > 0) {
      throw new ExtractionError(handlerIoLifecycleErrors, { passes, source, summary: ir.summary });
    }
  }

  let fastlyLifecycleParityProof;
  if (options.emitFastlyLifecycleParityProof) {
    fastlyLifecycleParityProof = buildFastlyLifecycleParityProof({
      cwd,
      generatedBy: PACKAGE_VERSION,
      routeHandlerEffectPlan,
      handlerIoLifecyclePlan,
      backendJsonRequestBodyPlan,
      resolvedConfig: schemaResolvedConfig || options.resolvedConfig,
      mode: 'cli-fastly-lifecycle-parity-proof'
    });
    const fastlyLifecycleParityErrors = fastlyLifecycleParityProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('fastly-lifecycle-parity-proof', fastlyLifecycleParityErrors.length === 0 ? 'ok' : 'error', fastlyLifecycleParityProof.artifact.summary));
    if (fastlyLifecycleParityErrors.length > 0) {
      throw new ExtractionError(fastlyLifecycleParityErrors, { passes, source, summary: ir.summary });
    }
  }

  let librarySidecars;
  if (options.emitLibrarySidecars) {
    librarySidecars = buildLibrarySidecarConsumption({
      cwd,
      generatedBy: PACKAGE_VERSION,
      outDir: options.outDir,
      executionPlan,
      handlerLibraryContracts
    });
    passes.push(makePass('library-sidecars', librarySidecars.diagnostics.length === 0 ? 'ok' : 'error', librarySidecars.artifact.summary));
    if (librarySidecars.diagnostics.length > 0) {
      throw new ExtractionError(librarySidecars.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let compiledHandlers;
  if (options.emitCompiledHandlers) {
    compiledHandlers = buildCompiledUserHandlers(sourceFile, handlerResolution.handlerTable, handlerEvaluation.handlerEval, dispatchTable, assemblyScriptShape, assemblyScriptCore, {
      cwd,
      generatedBy: PACKAGE_VERSION,
      outDir: options.outDir,
      routeHandlerEffectPlan,
      requestJsonBodyPlan
    });
    passes.push(makePass('compiled-handlers', compiledHandlers.diagnostics.length === 0 ? 'ok' : 'error', compiledHandlers.artifact.summary));
    if (compiledHandlers.diagnostics.length > 0) {
      throw new ExtractionError(compiledHandlers.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let nodeRequestJsonBodyProof;
  if (options.emitNodeRequestJsonBodyProof) {
    nodeRequestJsonBodyProof = buildNodeRequestJsonBodyProof({
      cwd,
      outDir: options.outDir,
      generatedBy: PACKAGE_VERSION,
      requestJsonBodyPlan,
      compiledHandlers,
      resolvedConfig: schemaResolvedConfig || options.resolvedConfig,
      mode: 'compiled-wasm-request-json-body-proof'
    });
    const nodeRequestJsonBodyProofErrors = nodeRequestJsonBodyProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('node-request-json-body-proof', nodeRequestJsonBodyProofErrors.length === 0 ? 'ok' : 'error', nodeRequestJsonBodyProof.artifact.summary));
    if (nodeRequestJsonBodyProofErrors.length > 0) {
      throw new ExtractionError(nodeRequestJsonBodyProofErrors, { passes, source, summary: ir.summary });
    }
  }

  let nodeSchemaDecodeResultProof;
  if (options.emitNodeSchemaDecodeResultProof) {
    nodeSchemaDecodeResultProof = buildNodeSchemaDecodeResultProof({
      cwd,
      outDir: options.outDir,
      generatedBy: PACKAGE_VERSION,
      schemaDecodeResultPlan,
      requestJsonBodyPlan,
      compiledHandlers,
      resolvedConfig: schemaResolvedConfig || options.resolvedConfig,
      mode: 'compiled-wasm-schema-decode-result-proof'
    });
    const nodeSchemaDecodeResultProofErrors = nodeSchemaDecodeResultProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('node-schema-decode-result-proof', nodeSchemaDecodeResultProofErrors.length === 0 ? 'ok' : 'error', nodeSchemaDecodeResultProof.artifact.summary));
    if (nodeSchemaDecodeResultProofErrors.length > 0) {
      throw new ExtractionError(nodeSchemaDecodeResultProofErrors, { passes, source, summary: ir.summary });
    }
  }

  let nodeSchemaResponseCodecProof;
  if (options.emitNodeSchemaResponseCodecProof) {
    nodeSchemaResponseCodecProof = buildNodeSchemaResponseCodecProof({
      cwd,
      outDir: options.outDir,
      generatedBy: PACKAGE_VERSION,
      schemaResponseCodecPlan,
      requestJsonBodyPlan,
      schemaDecodeResultPlan,
      compiledHandlers,
      resolvedConfig: schemaResolvedConfig || options.resolvedConfig,
      mode: 'compiled-wasm-schema-response-codec-proof'
    });
    const nodeSchemaResponseCodecProofErrors = nodeSchemaResponseCodecProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('node-schema-response-codec-proof', nodeSchemaResponseCodecProofErrors.length === 0 ? 'ok' : 'error', nodeSchemaResponseCodecProof.artifact.summary));
    if (nodeSchemaResponseCodecProofErrors.length > 0) {
      throw new ExtractionError(nodeSchemaResponseCodecProofErrors, { passes, source, summary: ir.summary });
    }
  }

  let integratedCompiledApp;
  if (options.emitIntegratedCompiledApp) {
    integratedCompiledApp = buildIntegratedCompiledApp({ assemblyScriptShape, assemblyScriptCore, schemaJsonSidecar, librarySidecars, streamingPassthrough, dispatchTable }, { cwd, generatedBy: PACKAGE_VERSION, outDir: options.outDir });
    passes.push(makePass('integrated-compiled-app', integratedCompiledApp.diagnostics.length === 0 ? 'ok' : 'error', integratedCompiledApp.artifact.summary));
    if (integratedCompiledApp.diagnostics.length > 0) {
      throw new ExtractionError(integratedCompiledApp.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let compiledWasmRuntime;
  if (options.emitCompiledWasmRuntime) {
    compiledWasmRuntime = buildCompiledWasmRuntime({ assemblyScriptShape, assemblyScriptCore, schemaJsonSidecar, librarySidecars }, { cwd, generatedBy: PACKAGE_VERSION, outDir: options.outDir, dispatchTable });
    passes.push(makePass('compiled-wasm-runtime', compiledWasmRuntime.diagnostics.length === 0 ? 'ok' : 'error', compiledWasmRuntime.artifact.summary));
    if (compiledWasmRuntime.diagnostics.length > 0) {
      throw new ExtractionError(compiledWasmRuntime.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let pulseWrapper;
  if (options.emitPulseWrapper) {
    pulseWrapper = buildPulseWrapperIntegration({ compiledWasmRuntime, deploymentPosture }, { cwd, generatedBy: PACKAGE_VERSION, outDir: options.outDir, resolvedConfig: options.resolvedConfig });
    passes.push(makePass('pulse-wrapper', pulseWrapper.diagnostics.length === 0 ? 'ok' : 'error', pulseWrapper.artifact.summary));
    if (pulseWrapper.diagnostics.length > 0) {
      throw new ExtractionError(pulseWrapper.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let fastlyReadiness;
  if (options.emitFastlyReadiness) {
    fastlyReadiness = buildFastlyReadiness({
      pulseWrapper,
      compiledWasmRuntime,
      hostCapabilities,
      streamingPassthrough,
      wasmHostAbi,
      nodeAdapter,
      backendCapabilities,
      channelBroadcaster,
      deploymentPosture,
      effectRuntime,
      effectComposition,
      schemaJsonSidecar,
      librarySidecars
    }, { cwd, generatedBy: PACKAGE_VERSION, outDir: options.outDir, resolvedConfig: options.resolvedConfig });
    passes.push(makePass('fastly-readiness', fastlyReadiness.diagnostics.length === 0 ? 'ok' : 'error', fastlyReadiness.artifact.summary));
    if (fastlyReadiness.diagnostics.length > 0) {
      throw new ExtractionError(fastlyReadiness.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let fastlyHostcallBinding;
  if (options.emitFastlyHostcallBinding) {
    fastlyHostcallBinding = buildFastlyHostcallBinding({
      fastlyReadiness,
      compiledWasmRuntime,
      hostCapabilities,
      streamingPassthrough,
      wasmHostAbi,
      backendCapabilities,
      deploymentPosture
    }, { cwd, generatedBy: PACKAGE_VERSION, outDir: options.outDir, resolvedConfig: options.resolvedConfig });
    passes.push(makePass('fastly-hostcall-binding', fastlyHostcallBinding.diagnostics.length === 0 ? 'ok' : 'error', fastlyHostcallBinding.artifact.summary));
    if (fastlyHostcallBinding.diagnostics.length > 0) {
      throw new ExtractionError(fastlyHostcallBinding.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let fastlyAdapter;
  if (options.emitFastlyAdapter) {
    fastlyAdapter = buildFastlyStreamHeaderAdapter({
      compiledWasmRuntime,
      fastlyHostcallBinding,
      fastlyReadiness,
      streamingPassthrough,
      wasmHostAbi
    }, { cwd, generatedBy: PACKAGE_VERSION, outDir: options.outDir, resolvedConfig: options.resolvedConfig });
    passes.push(makePass('fastly-adapter', fastlyAdapter.diagnostics.length === 0 ? 'ok' : 'error', fastlyAdapter.artifact.summary));
    if (fastlyAdapter.diagnostics.length > 0) {
      throw new ExtractionError(fastlyAdapter.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let fastlyCommandEntry;
  if (options.emitFastlyCommandEntry) {
    fastlyCommandEntry = buildFastlyCommandEntry({ fastlyAdapter, fastlyHostcallBinding }, { cwd, generatedBy: PACKAGE_VERSION, outDir: options.outDir, resolvedConfig: options.resolvedConfig });
    passes.push(makePass('fastly-command-entry', fastlyCommandEntry.diagnostics.length === 0 ? 'ok' : 'error', fastlyCommandEntry.artifact.summary));
    if (fastlyCommandEntry.diagnostics.length > 0) {
      throw new ExtractionError(fastlyCommandEntry.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  let fastlyAssetsProviderProof;
  if (options.emitFastlyAssetsProviderProof) {
    fastlyAssetsProviderProof = buildFastlyAssetsProviderProof({
      cwd,
      generatedBy: PACKAGE_VERSION,
      assetsLoweringPlan,
      resolvedConfig: options.resolvedConfig,
      fastlyHostcallBinding,
      fastlyAdapter,
      requestResultHeaders,
      streamingPassthrough,
      wasmHostAbi
    });
    const fastlyAssetsProviderProofErrors = fastlyAssetsProviderProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('fastly-assets-provider-proof', fastlyAssetsProviderProofErrors.length === 0 ? 'ok' : 'error', fastlyAssetsProviderProof.artifact.summary));
    if (fastlyAssetsProviderProofErrors.length > 0) {
      throw new ExtractionError(fastlyAssetsProviderProofErrors, { passes, source, summary: ir.summary });
    }
  }


  let fastlyAssetsPackageOutParityProof;
  if (options.emitFastlyAssetsPackageOutParityProof) {
    fastlyAssetsPackageOutParityProof = buildFastlyAssetsPackageOutParityProof({
      cwd,
      generatedBy: PACKAGE_VERSION,
      assetsLoweringPlan,
      assetsCompiledWasmSidecarPlan,
      fastlyAssetsProviderProof,
      resolvedConfig: options.resolvedConfig,
      fastlyHostcallBinding,
      fastlyAdapter,
      requestResultHeaders,
      streamingPassthrough,
      wasmHostAbi
    });
    const fastlyAssetsPackageOutParityProofErrors = fastlyAssetsPackageOutParityProof.diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
    passes.push(makePass('fastly-assets-package-out-parity-proof', fastlyAssetsPackageOutParityProofErrors.length === 0 ? 'ok' : 'error', fastlyAssetsPackageOutParityProof.artifact.summary));
    if (fastlyAssetsPackageOutParityProofErrors.length > 0) {
      throw new ExtractionError(fastlyAssetsPackageOutParityProofErrors, { passes, source, summary: ir.summary });
    }
  }

  let dispatchTs;
  if (options.emitDispatchTs || options.emitHandlerBindings || options.emitExecutionHarness || options.emitLocalHarness) {
    dispatchTs = buildTypeScriptDispatch(dispatchTable, { cwd, generatedBy: PACKAGE_VERSION, handlerBindings, executionHarness, localHarness });
    passes.push(makePass('dispatch-ts', dispatchTs.diagnostics.length === 0 ? 'ok' : 'error', dispatchTs.manifest.summary));
    if (dispatchTs.diagnostics.length > 0) {
      throw new ExtractionError(dispatchTs.diagnostics, { passes, source, summary: ir.summary });
    }
  }

  const emittedArtifacts = ['symbol-index.json', 'handler-table.json', 'handler-eval.json', 'path-table.json', 'dispatch-table.json', 'execution-plan.json', 'router-ir.json', 'router-tree.json', 'route-plan.json', 'route-id-map.json', 'diagnostics.json']
    .concat((options.emitAssemblyScriptShape || options.emitAssemblyScriptCore) ? ['assemblyscript-shape.json', 'generated/as/manifest.json', 'generated/as/types.as.ts', 'generated/as/route-table.as.ts', 'generated/as/dispatch-shape.as.ts', 'generated/as/index.as.ts'] : [])
    .concat(options.emitAssemblyScriptCore ? ['assemblyscript-core.json', 'assemblyscript-handlers.json', 'generated/as/runtime-path.as.ts', 'generated/as/handler-slots.as.ts', 'generated/as/runtime-core.as.ts', 'generated/as/index.as.ts'] : [])
    .concat(options.emitAssemblyScriptCompile ? ['assemblyscript-compile.json', 'generated/as-smoke/pulsewasm-smoke.wasm', 'generated/as-smoke/pulsewasm-smoke.wat'] : [])
    .concat(options.emitWasmSmoke ? ['assemblyscript-wasm-smoke.json', 'generated/as-smoke/smoke-runner.as.ts', 'generated/wasm-smoke/pulsewasm-local-smoke.wasm', 'generated/wasm-smoke/pulsewasm-local-smoke.wat'] : [])
    .concat(options.emitWasmHostAbi ? ['wasm-host-abi.json', 'generated/host/wasm-host-abi.md'] : [])
    .concat(options.emitWasmHostBridge ? ['wasm-host-bridge.json', 'generated/host-bridge/host-bridge-runner.as.ts', 'generated/wasm-bridge/pulsewasm-host-bridge.wasm', 'generated/wasm-bridge/pulsewasm-host-bridge.wat'] : [])
    .concat(options.emitRequestResultHeaders ? ['request-result-headers.json', 'generated/host/request-result-headers.md'] : [])
    .concat(options.emitChannelBroadcaster ? ['channel-broadcaster.json', 'generated/host/channel-broadcaster.md'] : [])
    .concat(options.emitJsonBody ? ['json-body.json', 'deployment-posture.json', 'generated/host/json-body.md'] : [])
    .concat(options.emitBackendCapabilities ? ['backend-capabilities.json', 'generated/host/backend-capabilities.md'].concat(options.emitJsonBody ? [] : ['deployment-posture.json']) : [])
    .concat(options.emitHostRuntimeKernel ? ['host-runtime-kernel.json', 'generated/host/host-runtime-kernel.cjs'] : [])
    .concat(options.emitNodeAdapter ? ['node-adapter.json', 'generated/node/node-adapter.cjs'] : [])
    .concat(options.emitHandlerLibraryContracts ? ['handler-library-contracts.json', 'handler-execution-modes.json', 'library-contract-schema.json', 'library-capabilities.json', 'library-compatibility-report.json', 'generated/host/handler-library-contracts.md'] : [])
    .concat(options.emitAssetsLoweringPlan ? ['assets-lowering-plan.json'] : [])
    .concat(options.emitAssetsCompiledWasmSidecarPlan ? ['assets-compiled-wasm-sidecar-plan.json'] : [])
    .concat(options.emitAssetsSidecarCompileLinkProof ? ['assets-sidecar-compile-link-proof.json'] : [])
    .concat(options.emitNodeAssetsProviderProof ? ['node-assets-provider-proof.json'] : [])
    .concat(options.emitNodeCompiledWasmAssetsLifecycleProof ? ['node-compiled-wasm-assets-lifecycle-proof.json'] : [])
    .concat(options.emitFastlyAssetsProviderProof ? ['fastly-assets-provider-proof.json'] : [])
    .concat(options.emitFastlyAssetsPackageOutParityProof ? ['fastly-assets-package-out-parity-proof.json'] : [])
    .concat(options.emitRouteHandlerEffectPlan ? ['route-handler-effect-plan.json'] : [])
    .concat(options.emitNodeRouteHandlerEffectProof ? ['node-route-handler-effect-proof.json'] : [])
    .concat(options.emitFastlyRouteHandlerEffectProof ? ['fastly-route-handler-effect-proof.json'] : [])
    .concat(options.emitFastlyLifecycleParityProof ? ['fastly-lifecycle-parity-proof.json'] : [])
    .concat(options.emitRouteHandlerContextLoweringPlan ? ['route-handler-context-lowering-plan.json'] : [])
    .concat(options.emitHandlerIoLifecyclePlan ? ['handler-io-lifecycle-plan.json'] : [])
    .concat(options.emitRequestJsonBodyPlan ? ['request-json-body-plan.json'] : [])
    .concat(options.emitSchemaDecodeResultPlan ? ['schema-decode-result-plan.json'] : [])
    .concat(options.emitNodeRequestJsonBodyProof ? ['node-request-json-body-proof.json'] : [])
    .concat(options.emitNodeSchemaDecodeResultProof ? ['node-schema-decode-result-proof.json'] : [])
    .concat(options.emitHostCapabilities ? ['host-capabilities.json', 'host-capability-contract.json', 'wasi-provider-map.json', 'capability-provider-report.json', 'generated/host/host-capabilities.md'] : [])
    .concat(options.emitEffectRuntime ? ['effect-runtime.json', 'effect-runtime-contract.json', 'effect-kind-registry.json', 'effect-resume-protocol.json', 'effect-timeout-policy.json', 'generated/host/effect-runtime.md'] : [])
    .concat(options.emitEffectComposition ? ['effect-composition.json', 'effect-plan-contract.json', 'effect-continuation-contract.json', 'timeout-scope-policy.json', 'generated/host/effect-composition.md'] : [])
    .concat(schemaJsonCompile ? ['schema-json-compile.json', 'schema-json-compile-smoke.json', 'generated/host/schema-json-compile.md'] : [])
    .concat(schemaJsonGenericParser ? ['schema-json-generic-parser.json', 'schema-json-generic-parser-plan.json', 'schema-json-generic-parser-abi.json', 'schema-json-generic-parser-smoke.json', 'schema-json-plan.json', 'schema-json-parser-report.json', 'schema-json-registry.json', 'schema-json-sidecar-abi.json', 'schema-json-body-policy.json', 'generated/as/schema-json/generic/as-json-parser.as.ts', 'generated/as-smoke/schema-json-generic-parser-smoke-runner.as.ts', 'generated/schema-json-generic-parser/pulsewasm-schema-json-generic-parser.wasm', 'generated/schema-json-generic-parser/pulsewasm-schema-json-generic-parser.wat', 'generated/host/schema-json-generic-parser.md'] : [])
    .concat(options.emitSchemaJsonSidecar && !schemaJsonGenericParser ? ['schema-json-sidecar.json', 'schema-json-plan.json', 'schema-json-parser-report.json', 'schema-json-registry.json', 'schema-json-sidecar-abi.json', 'schema-json-body-policy.json', 'schema-json-smoke.json', 'generated/as/schema-json/app/create-user-body.as.ts', 'generated/as/schema-json/auth/login-body.as.ts', 'generated/as-smoke/schema-json-smoke-runner.as.ts', 'generated/schema-json/pulsewasm-schema-json.wasm', 'generated/schema-json/pulsewasm-schema-json.wat', 'generated/host/schema-json-sidecar.md'] : [])
    .concat(options.emitLibrarySidecars ? ['library-sidecar-consumption.json', 'api-surface.json', 'ctx-extension-scope-map.json', 'lifecycle-ordering.json', 'library-sidecar-smoke.json', 'generated/as/library-sidecars/test-extension.as.ts', 'generated/as-smoke/library-sidecar-smoke-runner.as.ts', 'generated/library-sidecars/pulsewasm-library-sidecar.wasm', 'generated/library-sidecars/pulsewasm-library-sidecar.wat', 'generated/host/library-sidecar-consumption.md'] : [])
    .concat(options.emitStreamingPassthrough ? ['streaming-passthrough.json', 'stream-result-abi.json', 'response-passthrough-policy.json', 'streaming-passthrough-smoke.json', 'generated/host/streaming-passthrough.md'] : [])
    .concat(options.emitCompiledHandlers ? ['compiled-handler-plan.json', 'handler-lowering-report.json', 'compiled-handler-hardening.json', 'compiled-handler-smoke.json', 'generated/as/user-handlers.as.ts', 'generated/as/handler-slots.as.ts', 'generated/as-smoke/compiled-handler-smoke-runner.as.ts', 'generated/compiled-handlers/pulsewasm-compiled-handlers.wasm', 'generated/compiled-handlers/pulsewasm-compiled-handlers.wat'] : [])
    .concat(options.emitIntegratedCompiledApp ? ['integrated-compiled-app.json', 'integrated-link-report.json', 'integrated-compiled-app-smoke.json', 'generated/as/user-handlers.as.ts', 'generated/as/handler-slots.as.ts', 'generated/as-smoke/integrated-compiled-app-smoke-runner.as.ts', 'generated/integrated-compiled-app/pulsewasm-integrated-compiled-app.wasm', 'generated/integrated-compiled-app/pulsewasm-integrated-compiled-app.wat', 'generated/host/integrated-compiled-app.md'] : [])
    .concat(options.emitCompiledWasmRuntime ? ['compiled-wasm-runtime.json', 'compiled-wasm-host-runtime.json', 'compiled-wasm-node-adapter.json', 'compiled-wasm-runtime-smoke.json', 'generated/as/user-handlers.as.ts', 'generated/as/handler-slots.as.ts', 'generated/host-bridge/compiled-host-bridge-runner.as.ts', 'generated/compiled-wasm-runtime/pulsewasm-compiled-runtime.wasm', 'generated/host/compiled-wasm-host-runtime.cjs', 'generated/node/compiled-wasm-node-adapter.cjs', 'generated/host/compiled-wasm-runtime.md'] : [])
    .concat(options.emitPulseWrapper ? ['wrapper-integration.json', 'pulse-build-output.json', 'pulse-dev-runtime.json', 'generated/pulse/pulse-wrapper.cjs', 'generated/host/pulse-wrapper-integration.md'] : [])
    .concat(options.emitFastlyReadiness ? ['fastly-readiness.json', 'fastly-sdk-audit.json', 'fastly-hostcall-map.json', 'fastly-capability-map.json', 'fastly-packaging-plan.json', 'fastly-risk-report.json', 'fastly-adapter-plan.json', 'generated/host/fastly-readiness.md'] : [])
    .concat(options.emitFastlyHostcallBinding ? ['fastly-hostcall-binding-contract.json', 'fastly-hostcall-modules.json', 'fastly-ref-lifecycle.json', 'fastly-stream-binding-plan.json', 'fastly-pack-inputs.json', 'fastly-binding-risk-report.json', 'generated/host/fastly-hostcall-binding-contract.md'] : [])
    .concat(options.emitFastlyAdapter ? ['fastly-adapter.json', 'fastly-stream-header-adapter.json', 'fastly-local-smoke.json', 'fastly-packaging-smoke.json', 'fastly-deployment-readiness.json', 'generated/fastly/fastly-adapter.cjs', 'generated/fastly/fastly.toml', 'generated/fastly/README.md', 'generated/fastly/pulsewasm-compute.wasm', 'generated/host/fastly-stream-header-adapter.md'] : [])
    .concat(options.emitFastlyCommandEntry ? ['fastly-command-entry.json', 'fastly-start-export-audit.json', 'fastly-command-import-audit.json', 'fastly-serve-gate.json', 'fastly-command-smoke.json', 'generated/fastly/fastly-entry.as.ts', 'generated/fastly/fastly.toml', 'generated/fastly/README.md', 'generated/fastly/pulsewasm-compute.wasm', 'generated/host/fastly-command-entry.md'] : [])
    .concat((options.emitHandlerBindings || options.emitExecutionHarness) ? ['handler-bindings.json'] : [])
    .concat(options.emitExecutionHarness ? ['execution-harness.json'] : [])
    .concat(options.emitLocalHarness ? ['local-harness.json'] : [])
    .concat(options.includeAst ? ['ast.json'] : [])
    .concat(dispatchTs ? ['generated/manifest.json', 'generated/types.ts', 'generated/route-table.ts', 'generated/dispatch.ts'] : [])
    .concat((options.emitHandlerBindings || options.emitExecutionHarness) ? ['generated/handler-slots.ts'] : [])
    .concat(options.emitExecutionHarness ? ['generated/execution-plan.ts', 'generated/execution-harness.ts'] : [])
    .concat(options.emitLocalHarness ? ['generated/local-harness.ts'] : [])
    .concat(dispatchTs ? ['generated/index.ts'] : []);
  passes.push(makePass('emit', 'ok', {
    artifacts: emittedArtifacts
  }));

  const summary = extractionSummary({ sourceFile, ir: resolvedIR, routerTree, routePlan, handlerTable: handlerResolution.handlerTable, handlerEval: handlerEvaluation.handlerEval, dispatchTable, executionPlan, handlerBindings, executionHarness, localHarness, assemblyScriptShape, assemblyScriptCore, assemblyScriptCompile, assemblyScriptWasmSmoke, wasmHostAbi, wasmHostBridge, requestResultHeaders, channelBroadcaster, jsonBody, backendCapabilities, deploymentPosture, hostRuntimeKernel, nodeAdapter, streamingPassthrough, handlerLibraryContracts, assetsLoweringPlan, assetsSidecarCompileLinkProof, assetsCompiledWasmSidecarPlan, nodeAssetsProviderProof, nodeCompiledWasmAssetsLifecycleProof, fastlyAssetsProviderProof, fastlyAssetsPackageOutParityProof, routeHandlerEffectPlan, nodeRouteHandlerEffectProof, fastlyRouteHandlerEffectProof, fastlyLifecycleParityProof, routeHandlerContextLoweringPlan, handlerIoLifecyclePlan, requestJsonBodyPlan, schemaDecodeResultPlan, schemaResponseCodecPlan, backendJsonRequestBodyPlan, nodeRequestJsonBodyProof, nodeSchemaDecodeResultProof, nodeSchemaResponseCodecProof, hostCapabilities, effectRuntime, effectComposition, compiledHandlers, schemaJsonCompile, schemaJsonGenericParser, schemaJsonSidecar, librarySidecars, integratedCompiledApp, compiledWasmRuntime, pulseWrapper, fastlyReadiness, fastlyHostcallBinding, fastlyAdapter, fastlyCommandEntry, dispatchTs, includeAst: options.includeAst, cwd });
  const diagnosticsArtifact = {
    version: DIAGNOSTICS_VERSION,
    generatedBy: PACKAGE_VERSION,
    source: stableFileName(sourceFile.fileName, cwd),
    status: 'ok',
    diagnostics: [],
    passes: normalizeArtifact(passes, cwd),
    summary: normalizeArtifact(summary, cwd)
  };

  return {
    sourceFile,
    symbolIndex: normalizeArtifact(ir.symbolIndex, cwd),
    ast: options.includeAst
      ? normalizeArtifact({
          version: 'pulsewasm.ast.v1',
          generatedBy: PACKAGE_VERSION,
          source: stableFileName(sourceFile.fileName, cwd),
          ast: astToJson(ts, sourceFile)
        }, cwd)
      : undefined,
    routerIR: normalizeArtifact({
      version: 'pulsewasm.router-ir.v1',
      generatedBy: PACKAGE_VERSION,
      source: stableFileName(sourceFile.fileName, cwd),
      routers: resolvedIR.routerIR,
      handlerDeclarations: ir.handlerIR,
      handlers: handlerResolution.handlerTable.handlers
    }, cwd),
    routerTree,
    handlerTable: handlerResolution.handlerTable,
    handlerEval: handlerEvaluation.handlerEval,
    pathTable,
    dispatchTable,
    executionPlan,
    handlerBindings,
    executionHarness,
    localHarness,
    assemblyScriptShape,
    assemblyScriptCore,
    assemblyScriptCompile,
    assemblyScriptWasmSmoke,
    wasmHostAbi,
    wasmHostBridge,
    requestResultHeaders,
    channelBroadcaster,
    jsonBody,
    backendCapabilities,
    deploymentPosture,
    hostRuntimeKernel,
    nodeAdapter,
    streamingPassthrough,
    integratedCompiledApp,
    compiledWasmRuntime,
    pulseWrapper,
    fastlyReadiness,
    fastlyHostcallBinding,
    fastlyAdapter,
    fastlyCommandEntry,
    handlerLibraryContracts,
    assetsLoweringPlan,
    assetsCompiledWasmSidecarPlan,
    assetsSidecarCompileLinkProof,
    nodeAssetsProviderProof,
    nodeCompiledWasmAssetsLifecycleProof,
    fastlyAssetsProviderProof,
    fastlyAssetsPackageOutParityProof,
    routeHandlerEffectPlan,
    nodeRouteHandlerEffectProof,
    fastlyRouteHandlerEffectProof,
    fastlyLifecycleParityProof,
    routeHandlerContextLoweringPlan,
    handlerIoLifecyclePlan,
    requestJsonBodyPlan,
    nodeRequestJsonBodyProof,
    schemaDecodeResultPlan,
    schemaResponseCodecPlan,
    backendJsonRequestBodyPlan,
    nodeSchemaDecodeResultProof,
    nodeSchemaResponseCodecProof,
    hostCapabilities,
    effectRuntime,
    effectComposition,
    compiledHandlers,
    schemaJsonCompile,
    schemaJsonGenericParser,
    schemaJsonSidecar,
    librarySidecars,
    integratedCompiledApp,
    compiledWasmRuntime,
    dispatchTs,
    routePlan,
    routeIdMap,
    diagnostics: diagnosticsArtifact,
    passes,
    summary
  };
}

function extractFromFile(filePath, options = {}) {
  const sourceFile = readSourceFile(filePath);
  return extractFromSourceFile(sourceFile, options);
}

module.exports = {
  SUPPORTED_METHODS,
  ROUTE_METHODS,
  ROUTE_ID_POLICY,
  ROUTE_PLAN_VERSION,
  DEFAULT_ROUTER_API_REGISTRY,
  buildRouterApiRegistry,
  extractFromFile,
  extractFromSourceFile,
  flattenRouterTree,
  createRoutePlan,
  createRoutePlanResult,
  createRouteIdMap,
  buildDispatchTable,
  buildExecutionPlan,
  buildTypeScriptDispatch,
  buildTypeScriptHandlerBindings,
  buildAssemblyScriptCore,
  buildAssemblyScriptCompileSmoke,
  buildAssemblyScriptWasmSmoke,
  buildWasmHostAbi,
  buildWasmHostBridge,
  buildHostRuntimeKernel,
  buildHostCapabilities,
  buildEffectRuntime,
  buildEffectComposition,
  buildRouteHandlerEffectPlan,
  buildRouteHandlerContextLoweringPlan,
  buildHandlerIoLifecyclePlan,
  buildSchemaResponseCodecPlan,
  buildBackendJsonRequestBodyPlan,
  buildCompiledUserHandlers,
  buildSchemaJsonCompile,
  buildSchemaJsonGenericParser,
  buildSchemaJsonSidecar,
  buildLibrarySidecarConsumption,
  buildIntegratedCompiledApp,
  buildChannelBroadcaster,
  buildJsonBodyAbi,
  buildDeploymentPosture,
  buildTypeScriptLocalHarness,
  resolveRouterTree,
  resolveRouterTreeFromIR,
  buildRouterIR,
  indexSourceFile,
  extractRouterOperations,
  parseRouterOperation,
  validateIR,
  normalizePathIR,
  parseDiagnostics,
  readSourceFile,
  refToString
};
