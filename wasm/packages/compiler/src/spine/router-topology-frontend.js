'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const ts = require('typescript');
const {
  createCanonicalDiagnostic,
  adaptRouterDiagnostic
} = require('./diagnostic-authority.js');
const {
  buildRouterIR,
  normalizePathIR,
  resolveRouterTree,
  createRoutePlanResult
} = require('../extractor.js');
const { buildHandlerTable } = require('../handler-table.js');
const { buildPathTable } = require('../path-table.js');
const { buildDispatchTable } = require('../dispatch-table.js');
const { buildExecutionPlan } = require('../execution-plan.js');
const { buildEventTopology } = require('../events/event-topology.js');
const { analyzeEventEmitHandlers } = require('../events/event-emit.js');
const { ROUTER_API_DEFINITIONS } = require('../definitions/router-api.js');

const ROUTER_TOPOLOGY_FRONTEND_VERSION = 'pulse.router-topology-frontend.v1';
const CANONICAL_ROUTER_COMPILER_VERSION = 'pulse.canonical-router-compiler.v2';
const CANONICAL_ROUTER_AUTHORING_VERSION = 'pulse.router-authoring.v2';
const CANONICAL_ROUTER_EXECUTION_VERSION = 'pulse.router-terminal-execution.v1';
const ROUTER_IMPORT = '@pulse-compute/runtime';
const ROUTER_CLASS = 'Router';
const PULSE_IMPORT = '@pulse-compute/pulse';
const PULSE_CLASS = 'Pulse';
const SUPPORTED_ROUTE_METHODS = new Set(ROUTER_API_DEFINITIONS
  .filter((definition) => definition.kind === 'route')
  .map((definition) => definition.method));
const DISALLOWED_OPERATION_KINDS = new Map([
  ['lifecycle', 'realtime lifecycle handlers'],
  ['channel', 'realtime channel registration'],
  ['timeout', 'router timeout scopes']
]);

class CanonicalRouterCompileError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'CanonicalRouterCompileError';
    this.code = 'PULSE_CANONICAL_ROUTER_COMPILE_FAILED';
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

function diagnostic(sourceFile, node, code, message, detail = {}) {
  return createCanonicalDiagnostic({
    frontend: 'canonical-router',
    sourceFile,
    node,
    code,
    message,
    detail
  });
}

function extractorDiagnostic(sourceFile, entry) {
  return adaptRouterDiagnostic(sourceFile, entry);
}

function parseRouterSource(sourceText, fileName) {
  return ts.createSourceFile(fileName, String(sourceText), ts.ScriptTarget.ES2022, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function applicationImports(sourceFile) {
  const found = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const expected = moduleName === ROUTER_IMPORT ? ROUTER_CLASS : (moduleName === PULSE_IMPORT ? PULSE_CLASS : undefined);
    if (!expected) continue;
    const bindings = statement.importClause && statement.importClause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const item = bindings.elements.find((element) => (element.propertyName ? element.propertyName.text : element.name.text) === expected && element.name.text === expected);
    if (item) found.push(Object.freeze({ statement, item, moduleName, className: expected, kind: expected === PULSE_CLASS ? 'pulse' : 'router' }));
  }
  return Object.freeze(found);
}

function directDefaultImport(sourceFile, localName) {
  if (!localName) return undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (clause && clause.name && clause.name.text === localName) {
      return Object.freeze({ statement, moduleName: statement.moduleSpecifier.text, localName });
    }
  }
  return undefined;
}

function stripModuleExtension(value) {
  return String(value).replace(/\.(?:[cm]?[jt]sx?)$/i, '');
}

function configImportMatches(importRecord, options, fileName) {
  if (!importRecord || !importRecord.moduleName.startsWith('.')) return false;
  if (!options.configFile) return /(?:^|\/)\.pulse\/config(?:\.[cm]?[jt]sx?)?$/.test(importRecord.moduleName.replace(/\\/g, '/'));
  const sourceFile = path.resolve(options.rootDir || process.cwd(), fileName);
  const imported = stripModuleExtension(path.resolve(path.dirname(sourceFile), importRecord.moduleName));
  const configured = stripModuleExtension(path.resolve(options.configFile));
  return imported === configured;
}

function rootApplicationDeclaration(sourceFile, rootName) {
  if (!rootName) return undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== rootName || !declaration.initializer) continue;
      let current = declaration.initializer;
      while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression?.(current) || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current))) current = current.expression;
      if (current && ts.isNewExpression(current) && ts.isIdentifier(current.expression) && [ROUTER_CLASS, PULSE_CLASS].includes(current.expression.text)) {
        return Object.freeze({ statement, declaration, expression: current, className: current.expression.text, kind: current.expression.text === PULSE_CLASS ? 'pulse' : 'router' });
      }
    }
  }
  return undefined;
}

function rootRouterName(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) return statement.expression.text;
  }
  return undefined;
}

function detectCanonicalRouterSource(sourceText, options = {}) {
  const sourceFile = parseRouterSource(sourceText, String(options.fileName || 'app.ts'));
  return Boolean(applicationImports(sourceFile).length > 0 || sourceFile.statements.some((statement) => {
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some((declaration) => {
      let initializer = declaration.initializer;
      while (initializer && (ts.isParenthesizedExpression(initializer) || ts.isAsExpression(initializer) || ts.isSatisfiesExpression?.(initializer) || ts.isNonNullExpression(initializer) || ts.isTypeAssertionExpression(initializer))) initializer = initializer.expression;
      return initializer && ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression) && [ROUTER_CLASS, PULSE_CLASS].includes(initializer.expression.text);
    });
  }));
}

function functionForNamedHandler(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.name.text === name) return statement;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue;
      let value = declaration.initializer;
      while (value && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression?.(value) || ts.isNonNullExpression(value) || ts.isTypeAssertionExpression(value))) value = value.expression;
      if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) return value;
    }
  }
  return undefined;
}

function functionAtOffset(sourceFile, offset) {
  let match;
  function visit(node) {
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.getStart(sourceFile) === offset) match = node;
    if (!match) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return match;
}

function handlerNode(sourceFile, handler) {
  if (handler && handler.localName) return functionForNamedHandler(sourceFile, handler.localName);
  const offset = handler && handler.loc && handler.loc.start && handler.loc.start.offset;
  return Number.isInteger(offset) ? functionAtOffset(sourceFile, offset) : undefined;
}

function expectedSignature(role) {
  if (role === 'event') return { counts: [1], names: [['ctx']], display: '(ctx)' };
  if (role === 'route') return { counts: [1, 2], names: [['ctx'], ['ctx', 'next']], display: '(ctx) or (ctx, next)' };
  if (role === 'middleware') return { counts: [2], names: [['ctx', 'next']], display: '(ctx, next)' };
  if (role === 'error') return { counts: [3], names: [['error', 'ctx', 'next']], display: '(error, ctx, next)' };
  return undefined;
}

function stableEntryId(entry) {
  const input = JSON.stringify({
    index: entry.index,
    kind: entry.kind,
    order: entry.order,
    routerPath: entry.routerPath,
    method: entry.method,
    path: entry.path,
    handlerId: entry.handler && (entry.handler.id || entry.handler.handlerId),
    childRouter: entry.childRouter
  });
  return `router_entry_${crypto.createHash('sha256').update(input).digest('hex').slice(0, 24)}`;
}

function fakeHandlerEval(handlerTable) {
  return Object.freeze({
    version: 'pulse.canonical-router-static-handler-eval.v1',
    handlers: Object.freeze((handlerTable.handlers || []).map((handler) => Object.freeze({
      handlerId: handler.id,
      status: 'ok',
      captures: Object.freeze([]),
      calls: Object.freeze([]),
      deps: Object.freeze([]),
      dependencyChain: Object.freeze([]),
      globals: Object.freeze([]),
      imports: Object.freeze([]),
      unsupported: Object.freeze([])
    })))
  });
}

function httpHandlerTable(handlerTable) {
  const handlers = (handlerTable.handlers || []).filter((handler) => (handler.roles || []).some((role) => role !== 'event'));
  if (handlers.length === handlerTable.handlers.length) return handlerTable;
  return Object.freeze({ ...handlerTable, handlers: Object.freeze(handlers) });
}

function cleanExecutionEntry(entry) {
  return Object.freeze({
    stableId: stableEntryId(entry),
    index: entry.index,
    nextIndex: entry.nextIndex,
    kind: entry.kind,
    order: entry.order,
    router: entry.router,
    routerPath: Object.freeze([...(entry.routerPath || [])]),
    path: entry.path || undefined,
    scoped: entry.scoped === true,
    pattern: entry.pattern && entry.pattern.normalized || undefined,
    method: entry.method || undefined,
    routeStableId: entry.stableId || undefined,
    routeRuntimeId: Number.isInteger(entry.runtimeId) ? entry.runtimeId : undefined,
    handlerId: entry.handler && (entry.handler.id || entry.handler.handlerId) || undefined,
    childRouter: entry.childRouter || undefined,
    childStartIndex: Number.isInteger(entry.childStartIndex) ? entry.childStartIndex : undefined,
    parentContinueIndex: Number.isInteger(entry.parentContinueIndex) ? entry.parentContinueIndex : undefined
  });
}

function retainedDeclarations(sourceFile, options = {}) {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const out = [];
  for (const statement of sourceFile.statements) {
    if (statement === options.configImportStatement) continue;
    if (ts.isImportDeclaration(statement)) {
      if (ts.isStringLiteral(statement.moduleSpecifier) && [ROUTER_IMPORT, PULSE_IMPORT].includes(statement.moduleSpecifier.text)) {
        const clause = statement.importClause;
        const bindings = clause && clause.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        const removedClass = statement.moduleSpecifier.text === PULSE_IMPORT ? PULSE_CLASS : ROUTER_CLASS;
        const kept = bindings.elements.filter((element) => (element.propertyName ? element.propertyName.text : element.name.text) !== removedClass);
        if (kept.length === 0 && !clause.name) continue;
        const allTypeOnly = kept.length > 0 && kept.every((element) => element.isTypeOnly);
        const elements = kept.map((element) => ts.factory.updateImportSpecifier(element, false, element.propertyName, element.name));
        const nextClause = ts.factory.updateImportClause(clause, clause.isTypeOnly || allTypeOnly, clause.name, ts.factory.updateNamedImports(bindings, elements));
        out.push(printer.printNode(ts.EmitHint.Unspecified, ts.factory.updateImportDeclaration(statement, statement.modifiers, nextClause, statement.moduleSpecifier, statement.attributes), sourceFile));
        continue;
      }
      out.push(printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile));
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) out.push(printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile));
  }
  return out.join('\n');
}

function validatePulseProfileTokenUses(sourceFile, rootName, diagnostics) {
  if (!rootName) return;
  function visit(node) {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === rootName
      && node.expression.name.text === 'profile') {
      let current = node;
      let parent = current.parent;
      while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression?.(parent) || ts.isNonNullExpression(parent) || ts.isTypeAssertionExpression(parent))) {
        current = parent;
        parent = current.parent;
      }
      const directArgument = Boolean(parent && ts.isCallExpression(parent) && parent.expression !== current && parent.arguments.some((argument) => argument === current));
      if (node.arguments.length !== 0 || !directArgument) {
        diagnostics.push(diagnostic(
          sourceFile,
          node,
          'PULSE_PROFILE_TOKEN_DIRECT_USE_REQUIRED',
          'app.profile() is an opaque composition token and may only be passed directly to one composition helper. Package ownership is resolved by the reachable module graph in a later implementation wave.',
          { argumentCount: node.arguments.length, directArgument }
        ));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function routerPreludeSource(eventReachable = false) {
  const eventPrelude = eventReachable
    ? '\nfunction __pulse_event_runtime_id() { return -1; }'
    : '';
  return `
function __pulse_router_segments(value) {
  const text = String(value || '/');
  if (text === '/') return [];
  return text.replace(/^\\/+|\\/+$/g, '').split('/');
}
function __pulse_router_match(path, pattern) {
  const actual = __pulse_router_segments(path);
  const expected = __pulse_router_segments(pattern);
  const wildcard = expected.length > 0 && expected[expected.length - 1] === '*';
  if ((!wildcard && actual.length !== expected.length) || (wildcard && actual.length < expected.length - 1)) return false;
  const limit = wildcard ? expected.length - 1 : expected.length;
  for (let index = 0; index < limit; index += 1) {
    const part = expected[index];
    if (part.startsWith(':')) { if (!actual[index]) return false; continue; }
    if (actual[index] !== part) return false;
  }
  return true;
}
function __pulse_router_param(path, pattern, name) {
  const actual = __pulse_router_segments(path);
  const expected = __pulse_router_segments(pattern);
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] === ':' + name) return actual[index];
  }
  return undefined;
}${eventPrelude}
`.trim();
}

function prepareCanonicalRouterTopology(sourceText, options = {}) {
  const fileName = String(options.fileName || 'app.ts').replace(/\\/g, '/');
  const linkedProjectModules = options.linkedProjectModules;
  const sourceFile = linkedProjectModules ? linkedProjectModules.rootSourceFile : parseRouterSource(sourceText, fileName);
  const rootFileName = sourceFile.fileName.replace(/\\/g, '/');
  const diagnostics = [...(linkedProjectModules && linkedProjectModules.diagnostics || [])];
  const imports = applicationImports(sourceFile);
  if (imports.length === 0) diagnostics.push(diagnostic(sourceFile, sourceFile, 'PULSE_CANONICAL_ROUTER_IMPORT_REQUIRED', `Canonical application authoring requires a direct named Router import from ${ROUTER_IMPORT} or Pulse import from ${PULSE_IMPORT}.`));
  const rootLocalName = linkedProjectModules ? linkedProjectModules.rootLocalName : rootRouterName(sourceFile);
  const rootName = linkedProjectModules ? linkedProjectModules.rootGlobalName : rootLocalName;
  const rootApplication = rootApplicationDeclaration(sourceFile, rootLocalName);
  if (!rootName) diagnostics.push(diagnostic(sourceFile, sourceFile, 'PULSE_CANONICAL_ROUTER_DEFAULT_EXPORT_REQUIRED', 'Canonical Router authoring requires export default <routerIdentifier>.'));

  if (rootName && !rootApplication) diagnostics.push(diagnostic(sourceFile, sourceFile, 'PULSE_CANONICAL_APPLICATION_ROOT_REQUIRED', 'The default export must reference a direct top-level new Router() or new Pulse(...) declaration.'));
  if (rootApplication) {
    const expectedImport = rootApplication.kind === 'pulse' ? PULSE_CLASS : ROUTER_CLASS;
    if (!imports.some((entry) => entry.className === expectedImport)) {
      diagnostics.push(diagnostic(sourceFile, rootApplication.expression, 'PULSE_CANONICAL_APPLICATION_IMPORT_REQUIRED', `Application root ${expectedImport} requires a direct unaliased named import from ${rootApplication.kind === 'pulse' ? PULSE_IMPORT : ROUTER_IMPORT}.`, { className: expectedImport }));
    }
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      let value = declaration.initializer;
      while (value && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression?.(value) || ts.isNonNullExpression(value) || ts.isTypeAssertionExpression(value))) value = value.expression;
      if (value && ts.isNewExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === PULSE_CLASS && declaration.name.text !== rootLocalName) {
        diagnostics.push(diagnostic(sourceFile, value, 'PULSE_CANONICAL_PULSE_ROOT_ONLY', 'Pulse may be constructed only for the default application root. Mounted and child applications use Router.', { declaration: declaration.name.text }));
      }
    }
  }
  let applicationConstructionMode = rootApplication && rootApplication.kind === 'pulse' ? 'invalid' : 'router';
  let applicationConfigImport;
  if (rootApplication && rootApplication.kind === 'pulse') {
    const args = rootApplication.expression.arguments || [];
    const auto = args.length === 1 && ts.isObjectLiteralExpression(args[0])
      && args[0].properties.length === 1
      && ts.isPropertyAssignment(args[0].properties[0])
      && ((ts.isIdentifier(args[0].properties[0].name) && args[0].properties[0].name.text === 'auto') || (ts.isStringLiteral(args[0].properties[0].name) && args[0].properties[0].name.text === 'auto'))
      && args[0].properties[0].initializer.kind === ts.SyntaxKind.TrueKeyword;
    const explicitIdentifier = args.length === 1 && ts.isIdentifier(args[0]) ? args[0] : undefined;
    const explicitImport = explicitIdentifier ? directDefaultImport(sourceFile, explicitIdentifier.text) : undefined;
    const explicit = Boolean(explicitImport && configImportMatches(explicitImport, options, rootFileName));
    applicationConstructionMode = auto ? 'auto' : (explicit ? 'explicit' : 'invalid');
    applicationConfigImport = explicit ? explicitImport : undefined;
    if (!auto && !explicit) diagnostics.push(diagnostic(
      sourceFile,
      rootApplication.expression,
      'PULSE_CANONICAL_PULSE_CONSTRUCTOR_UNSUPPORTED',
      'Pulse construction must use new Pulse({ auto: true }) or one direct default import of the configured .pulse/config module.',
      {
        argumentCount: args.length,
        argumentKind: explicitIdentifier ? 'identifier' : (args[0] && ts.SyntaxKind[args[0].kind]),
        configuredFile: options.configFile || null
      }
    ));
    if (!options.applicationProjectMetadata) diagnostics.push(diagnostic(sourceFile, rootApplication.expression, 'PULSE_CANONICAL_PULSE_PROJECT_CONTEXT_REQUIRED', 'Pulse application roots require a normalized project/profile plan supplied by project tooling. Deployed application code does not discover configuration at runtime.', { constructionMode: applicationConstructionMode }));
  }

  if (rootApplication && rootApplication.kind === 'pulse') validatePulseProfileTokenUses(sourceFile, rootLocalName, diagnostics);

  const rawIR = linkedProjectModules
    ? linkedProjectModules.ir
    : buildRouterIR(sourceFile, { cwd: options.rootDir || process.cwd() });
  diagnostics.push(...(rawIR.diagnostics || []).map((entry) => extractorDiagnostic(sourceFile, entry)));
  const normalized = normalizePathIR(rawIR, { cwd: options.rootDir || process.cwd() });
  diagnostics.push(...(normalized.diagnostics || []).map((entry) => extractorDiagnostic(sourceFile, entry)));

  const eventIR = [];
  const httpStatementOrders = new Map();
  let httpOperationOrder = 0;
  let httpStatementOrder = 0;
  const httpRouterIR = (normalized.ir.routerIR || []).map((router) => {
    const ops = [];
    for (const op of router.ops || []) {
      if (op.kind === 'event') {
        const rootOwned = Boolean(rootApplication && rootApplication.kind === 'pulse' && router.name === rootName);
        if (!rootOwned) {
          diagnostics.push(extractorDiagnostic(sourceFile, {
            code: 'PULSEWASM_EVENTS_ROOT_ONLY',
            message: 'Pulse.on event registrations are allowed only on the resolved Pulse application root; Router and mounted registrations are unsupported.',
            loc: op.loc,
            phase: 'event-topology'
          }));
        } else if (!op.unsupported) {
          eventIR.push(Object.freeze({ ...op, router: router.name }));
        }
        continue;
      }
      if (DISALLOWED_OPERATION_KINDS.has(op.kind)) diagnostics.push(diagnostic(sourceFile, sourceFile, 'PULSE_CANONICAL_ROUTER_OPERATION_RETIRED', `Router ${DISALLOWED_OPERATION_KINDS.get(op.kind)} are not part of canonical Router v2.`, { router: router.name, operation: op.kind }));
      if (op.route && !SUPPORTED_ROUTE_METHODS.has(String(op.method))) diagnostics.push(diagnostic(sourceFile, sourceFile, 'PULSE_CANONICAL_ROUTER_METHOD_UNSUPPORTED', `Router method ${op.method} is outside canonical Router v2.`, { method: op.method }));
      const statementKey = `${router.name}\u0000${op.statementOrder}`;
      if (!httpStatementOrders.has(statementKey)) httpStatementOrders.set(statementKey, httpStatementOrder++);
      ops.push(Object.freeze({ ...op, order: httpOperationOrder++, statementOrder: httpStatementOrders.get(statementKey) }));
    }
    return Object.freeze({ ...router, ops: Object.freeze(ops) });
  });
  eventIR.sort((left, right) => left.order - right.order);
  const eventTypes = new Map();
  const declaredSchemaIds = new Set((options.eventSchemaIds || []).map(String));
  for (const event of eventIR) {
    if (eventTypes.has(event.type)) diagnostics.push(extractorDiagnostic(sourceFile, {
      code: 'PULSEWASM_EVENTS_TYPE_DUPLICATE',
      message: `Pulse event type ${JSON.stringify(event.type)} is registered more than once.`,
      loc: event.loc,
      phase: 'event-topology'
    }));
    else eventTypes.set(event.type, event.order);
    const schemaId = event.declaration && event.declaration.schemaId;
    if (schemaId !== null && !declaredSchemaIds.has(schemaId)) diagnostics.push(extractorDiagnostic(sourceFile, {
      code: 'PULSEWASM_EVENTS_SCHEMA_UNRESOLVED',
      message: `Pulse event schema ${JSON.stringify(schemaId)} is not present in the compiled project schema registry.`,
      loc: event.loc,
      phase: 'event-topology'
    }));
  }
  const normalizedIr = Object.freeze({
    ...normalized.ir,
    routerIR: Object.freeze(httpRouterIR),
    ...(eventIR.length > 0 ? { eventIR: Object.freeze(eventIR) } : {})
  });

  const handlerResult = buildHandlerTable(normalizedIr, {
    cwd: options.rootDir || process.cwd(),
    expectedSignatureForRole(role) {
      if (role === 'event') return { params: [1], display: '(ctx) => Promise<void>' };
      const expected = expectedSignature(role);
      return expected ? { params: expected.counts, display: expected.display } : undefined;
    }
  });
  diagnostics.push(...(handlerResult.diagnostics || []).map((entry) => extractorDiagnostic(sourceFile, entry)));
  const functionNodeForHandler = (handler) => linkedProjectModules
    ? linkedProjectModules.functionNodeForHandler(handler)
    : handlerNode(sourceFile, handler);
  const sourceFileForHandler = (handler) => linkedProjectModules
    ? linkedProjectModules.sourceFileForPath(handler && handler.file) || sourceFile
    : sourceFile;
  const eventEmitAnalysis = analyzeEventEmitHandlers(handlerResult.handlerTable, {
    cwd: options.rootDir || process.cwd(),
    schemaIds: options.eventSchemaIds || [],
    functionNodeForHandler,
    sourceFileForHandler
  });
  diagnostics.push(...eventEmitAnalysis.diagnostics);

  let routerTree;
  let routePlan;
  let eventTopology;
  if (rootName && handlerResult.resolvedIR.routerIR.some((router) => router.name === rootName)) {
    try {
      routerTree = resolveRouterTree(handlerResult.resolvedIR, rootName, { cwd: options.rootDir || process.cwd() });
      const routeResult = createRoutePlanResult(handlerResult.resolvedIR, routerTree, rootName, sourceFile, { cwd: options.rootDir || process.cwd() });
      routePlan = routeResult.routePlan;
      diagnostics.push(...(routeResult.diagnostics || []).map((entry) => extractorDiagnostic(sourceFile, entry)));
    } catch (error) {
      diagnostics.push(diagnostic(sourceFile, sourceFile, error.code || 'PULSE_CANONICAL_ROUTER_TREE_FAILED', error.message, { rootName }));
    }
  } else if (rootName) diagnostics.push(diagnostic(sourceFile, sourceFile, 'PULSE_CANONICAL_ROUTER_ROOT_UNKNOWN', `Default export ${rootName} is not a directly declared Router.`));

  if (routePlan) {
    const registrations = new Map();
    for (const route of routePlan.routes || []) {
      const key = `${route.method}\u0000${route.path}\u0000${route.handler}`;
      if (registrations.has(key)) {
        diagnostics.push(diagnostic(sourceFile, sourceFile, 'PULSE_CANONICAL_ROUTER_DUPLICATE_ROUTE_HANDLER', `Canonical Router v2 does not allow the same handler to be registered more than once for ${route.method} ${route.path}. Distinct handlers may share a method/path when an earlier handler can return next().`, {
          method: route.method,
          path: route.path,
          handler: route.handler,
          firstOrder: registrations.get(key),
          duplicateOrder: route.order
        }));
      } else registrations.set(key, route.order);
    }
  }

  if ((eventIR.length > 0 || eventEmitAnalysis.callsites.length > 0) && !diagnostics.some((entry) => entry.severity === 'error')) {
    try {
      eventTopology = buildEventTopology(handlerResult.resolvedIR.eventIR, handlerResult.handlerTable, {
        cwd: options.rootDir || process.cwd(),
        emitAnalysis: eventEmitAnalysis
      });
    } catch (error) {
      diagnostics.push(diagnostic(sourceFile, sourceFile, error.code || 'PULSEWASM_EVENTS_CATALOG_INVALID', error.message, { automaticFallback: false }));
    }
  }

  let executionPlan;
  if (routePlan && routerTree && !diagnostics.some((entry) => entry.severity === 'error')) {
    const pathTable = buildPathTable(routePlan, { cwd: options.rootDir || process.cwd() });
    const dispatchHandlers = httpHandlerTable(handlerResult.handlerTable);
    const dispatchResult = buildDispatchTable(routePlan, dispatchHandlers, fakeHandlerEval(dispatchHandlers), pathTable, { cwd: options.rootDir || process.cwd() });
    diagnostics.push(...(dispatchResult.diagnostics || []).map((entry) => extractorDiagnostic(sourceFile, entry)));
    const executionResult = buildExecutionPlan(routerTree, dispatchResult.dispatchTable, { cwd: options.rootDir || process.cwd() });
    diagnostics.push(...(executionResult.diagnostics || []).map((entry) => extractorDiagnostic(sourceFile, entry)));
    executionPlan = executionResult.executionPlan;
  }

  if (!routePlan || (routePlan.routes.length === 0 && !(rootApplication && rootApplication.kind === 'pulse' && eventIR.length > 0))) diagnostics.push(diagnostic(sourceFile, sourceFile, 'PULSE_CANONICAL_ROUTER_EMPTY', 'Canonical Router authoring requires at least one supported HTTP route or one statically declared Pulse event.'));
  if (diagnostics.some((entry) => entry.severity === 'error')) throw new CanonicalRouterCompileError(`Canonical Router lowering failed for ${fileName}.`, diagnostics);

  const handlers = new Map(handlerResult.handlerTable.handlers.map((handler) => [handler.id, handler]));
  const routesByStableId = new Map((routePlan.routes || []).map((route) => [route.stableId, route]));
  const httpEntries = (executionPlan.entries || []).map((rawEntry) => {
    const entry = cleanExecutionEntry(rawEntry);
    const route = entry.kind === 'route' ? routesByStableId.get(entry.routeStableId) : undefined;
    const handler = ['use', 'route', 'error'].includes(entry.kind) ? handlers.get(entry.handlerId) : undefined;
    const handlerSourceFile = handler && linkedProjectModules
      ? linkedProjectModules.sourceFileForPath(handler.file)
      : sourceFile;
    const functionNode = handler
      ? (linkedProjectModules ? linkedProjectModules.functionNodeForHandler(handler) : handlerNode(sourceFile, handler))
      : undefined;
    const role = entry.kind === 'use' ? 'middleware' : entry.kind;
    return Object.freeze({ rawEntry, entry, route, handler, functionNode, sourceFile: handlerSourceFile || sourceFile, fileName: handler && handler.file || fileName, role });
  });
  const eventEntries = eventTopology ? eventTopology.catalog.events.map((event) => {
    const registration = eventIR[event.runtimeId];
    const handler = handlers.get(event.handlerStableId);
    const handlerSourceFile = handler && linkedProjectModules
      ? linkedProjectModules.sourceFileForPath(handler.file)
      : sourceFile;
    const functionNode = handler
      ? (linkedProjectModules ? linkedProjectModules.functionNodeForHandler(handler) : handlerNode(sourceFile, handler))
      : undefined;
    const entry = Object.freeze({
      stableId: event.stableId,
      index: httpEntries.length + event.runtimeId,
      kind: 'event',
      order: registration && registration.order,
      router: rootName,
      routerPath: Object.freeze([rootName]),
      handlerId: event.handlerStableId,
      eventStableId: event.stableId,
      eventRuntimeId: event.runtimeId,
      eventType: event.type,
      eventSchemaId: event.schemaId
    });
    return Object.freeze({
      rawEntry: registration,
      entry,
      event,
      handler,
      functionNode,
      sourceFile: handlerSourceFile || sourceFile,
      fileName: handler && handler.file || fileName,
      role: 'event'
    });
  }) : [];
  const entries = Object.freeze([...httpEntries, ...eventEntries]);

  return Object.freeze({
    version: ROUTER_TOPOLOGY_FRONTEND_VERSION,
    frontend: 'canonical-router',
    sourceText: String(sourceText),
    fileName,
    sourceFile,
    options: Object.freeze({ ...options }),
    rootName,
    applicationKind: rootApplication ? rootApplication.kind : 'router',
    applicationConstructionMode,
    routePlan,
    handlerTable: handlerResult.handlerTable,
    ...(eventTopology ? {
      eventTopology,
      eventCatalog: eventTopology.catalog,
      eventOutboundRequirements: eventTopology.outboundRequirements
    } : {}),
    routerTree,
    executionPlan,
    entries,
    retainedDeclarations: linkedProjectModules
      ? linkedProjectModules.retainedDeclarations
      : retainedDeclarations(sourceFile, { configImportStatement: applicationConfigImport && applicationConfigImport.statement }),
    applicationConfigImport: applicationConfigImport ? Object.freeze({ moduleName: applicationConfigImport.moduleName, localName: applicationConfigImport.localName }) : undefined,
    compilerPrelude: routerPreludeSource(Boolean(eventTopology)),
    compilerOwnedCalls: Object.freeze([
      '__pulse_router_match',
      '__pulse_router_param',
      ...(eventTopology ? ['__pulse_event_runtime_id'] : [])
    ]),
    ...(linkedProjectModules ? { reachableGraph: linkedProjectModules.graph, projectModuleLink: Object.freeze({
      version: linkedProjectModules.version,
      projectFiles: linkedProjectModules.projectFiles,
      runtimeProjectFiles: linkedProjectModules.runtimeProjectFiles,
      summary: linkedProjectModules.summary
    }) } : {})
  });
}

module.exports = Object.freeze({
  ROUTER_TOPOLOGY_FRONTEND_VERSION,
  CANONICAL_ROUTER_COMPILER_VERSION,
  CANONICAL_ROUTER_AUTHORING_VERSION,
  CANONICAL_ROUTER_EXECUTION_VERSION,
  ROUTER_IMPORT,
  ROUTER_CLASS,
  PULSE_IMPORT,
  PULSE_CLASS,
  CanonicalRouterCompileError,
  parseRouterSource,
  detectCanonicalRouterSource,
  expectedSignature,
  diagnostic,
  cleanExecutionEntry,
  routerPreludeSource,
  prepareCanonicalRouterTopology
});
