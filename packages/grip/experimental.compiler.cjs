'use strict';

const { createHash } = require('node:crypto');
const SUBPATH = '@pulse-compute/grip/experimental';
const OPERATIONS = Object.freeze({
  handoffFanout: 'redirect_to_grip_proxy_v2',
  handoffWebSocket: 'redirect_to_websocket_proxy_v2'
});

function contribution(operation) {
  const abi = OPERATIONS[operation];
  const entry = `__grip_${operation}`;
  const source = `@external("fastly_http_req", "${abi}") declare function ${entry}(request: i32, backend: usize, length: i32): i32\n`;
  return {
    version: 'pulse.host-extension.v1', id: `@pulse-compute/grip:${operation}`,
    kind: 'host-extension', mediaType: 'text/assemblyscript', package: '@pulse-compute/grip', contractId: 'pulse.grip',
    data: {
      operation, target: { provider: 'fastly', target: 'native', targetId: 'fastly-compute-native' },
      service: 'terminal-request-backend.v1', source,
      sha256: createHash('sha256').update(source).digest('hex'), entry,
      imports: [{ module: 'fastly_http_req', name: abi, parameters: ['i32', 'i32', 'i32'], results: ['i32'] }]
    }
  };
}

// Bind import identifiers, including aliases, with TypeScript's lexical binder.
// Text matching would accidentally grant an operation to a shadowing local.
function buildExperimental({ ts, sourceFile, unwrapExpression, placementForCall, enclosingContextName,
  rangeFor, locFor, makeDiagnostic }) {
  const bindings = new Map(), entries = [], diagnostics = [];
  if (!sourceFile.statements.some(s => ts.isImportDeclaration(s) && s.moduleSpecifier.text === SUBPATH))
    return { entries, diagnostics, realizationArtifacts: [] };
  const host = {
    getSourceFile: file => file === sourceFile.fileName ? sourceFile : undefined,
    getDefaultLibFileName: () => '', writeFile() {}, getCurrentDirectory: () => '',
    getDirectories: () => [], fileExists: file => file === sourceFile.fileName,
    readFile: file => file === sourceFile.fileName ? sourceFile.text : undefined,
    getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n'
  };
  const checker = ts.createProgram([sourceFile.fileName], { noLib: true, noResolve: true }, host).getTypeChecker();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== SUBPATH) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const names = clause.namedBindings;
    if (names && ts.isNamespaceImport(names)) bindings.set(checker.getSymbolAtLocation(names.name), '*');
    if (names && ts.isNamedImports(names)) {
      for (const specifier of names.elements) {
        const imported = (specifier.propertyName || specifier.name).text;
        if (!specifier.isTypeOnly && Object.hasOwn(OPERATIONS, imported))
          bindings.set(checker.getSymbolAtLocation(specifier.name), imported);
      }
    }
  }
  function resolve(expression) {
    const value = unwrapExpression(ts, expression);
    if (ts.isIdentifier(value)) {
      const operation = bindings.get(checker.getSymbolAtLocation(value));
      return operation !== '*' ? operation : undefined;
    }
    if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)
      && bindings.get(checker.getSymbolAtLocation(value.expression)) === '*'
      && Object.hasOwn(OPERATIONS, value.name.text)) return value.name.text;
  }
  function contextSymbol(node) {
    for (let owner = node.parent; owner; owner = owner.parent) {
      if (ts.isFunctionLike(owner)) {
        const parameter = owner.parameters[0];
        return parameter && ts.isIdentifier(parameter.name) ? checker.getSymbolAtLocation(parameter.name) : undefined;
      }
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const operation = resolve(node.expression);
      if (operation) {
        const context = unwrapExpression(ts, node.arguments[0]);
        const backend = unwrapExpression(ts, node.arguments[1]);
        const contextName = enclosingContextName(ts, node);
        const placement = placementForCall(ts, node);
        const parent = ts.isAwaitExpression(node.parent) ? node.parent.parent : node.parent;
        const currentContext = contextSymbol(node);
        const valid = node.arguments.length === 2 && context && ts.isIdentifier(context)
          && currentContext && checker.getSymbolAtLocation(context) === currentContext && backend
          && (ts.isStringLiteral(backend) || ts.isNoSubstitutionTemplateLiteral(backend))
          && backend.text.length > 0 && !backend.text.includes('\0') && placement === 'return'
          && ts.isReturnStatement(parent) && !node.questionDotToken && !node.expression.questionDotToken;
        if (!valid) diagnostics.push(makeDiagnostic(sourceFile, node, 'PULSE_HOST_EXTENSION_PLACEMENT',
          `${SUBPATH}.${operation} requires a direct terminal return with the current handler context and a literal backend key.`,
          `Use return ${operation}(${contextName}, 'backend'); in a plain Fastly Native handler or selected Router route.`));
        else entries.push({
          kind: 'grip-terminal', symbol: operation, placement, loc: locFor(sourceFile, node), range: rangeFor(sourceFile, node),
          canonicalEffect: {
            version: 'pulse.canonical-package-effect.v1', contractId: 'pulse.grip', package: '@pulse-compute/grip', import: '@pulse-compute/grip',
            kind: 'host.extension', providerKind: 'host-extension', operation, capability: 'host.extension',
            providerRequirements: ['host.extension'], result: 'host-terminal', placement,
            range: rangeFor(sourceFile, node), loc: locFor(sourceFile, node),
            resource: { kind: 'literal', value: backend.text }, payload: {}
          }
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { entries, diagnostics, realizationArtifacts: [...new Set(entries.map(e => e.symbol))].sort().map(contribution) };
}
module.exports = { buildExperimental };
