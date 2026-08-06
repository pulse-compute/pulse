'use strict';

const ts = require('typescript');
const { PACKAGE_VERSION, normalizeArtifact, sourceLoc, stableFileName } = require('./diagnostics.js');
const { sourceTextHash } = require('./stable-id.js');

const ALLOWED_LITERAL_GLOBALS = new Set(['undefined', 'NaN', 'Infinity']);
const NETWORK_IMPORT_MODULES = new Set(['axios', 'undici', 'node-fetch', 'got', 'ky', 'http', 'https', 'node:http', 'node:https']);
const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken
]);

function nodeText(sourceFile, node) {
  return node.getText(sourceFile).trim();
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers && node.modifiers.some((modifier) => modifier.kind === kind));
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

function functionKind(node, fallback = 'function') {
  if (ts.isFunctionDeclaration(node)) return 'function-declaration';
  if (ts.isArrowFunction(node)) return fallback === 'inline' ? 'inline-arrow' : 'const-arrow';
  if (ts.isFunctionExpression(node)) return fallback === 'inline' ? 'inline-function-expression' : 'const-function-expression';
  return fallback;
}

function declarationKindFromList(list) {
  if (!list) return 'var';
  if ((list.flags & ts.NodeFlags.Const) !== 0) return 'const';
  if ((list.flags & ts.NodeFlags.Let) !== 0) return 'let';
  return 'var';
}

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral;
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

function sourceKey(loc) {
  if (!loc) return '<unknown>';
  const start = loc.start ? `${loc.start.offset}` : '?';
  return `${loc.file || '<unknown>'}:${start}`;
}

function uniqueByKey(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function collectBindingNames(node, names = []) {
  if (!node) return names;
  if (ts.isIdentifier(node)) {
    names.push(node.text);
    return names;
  }
  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
    for (const element of node.elements || []) {
      if (ts.isBindingElement(element)) collectBindingNames(element.name, names);
    }
  }
  return names;
}

function importModuleText(node) {
  return isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : '<dynamic>';
}

function collectTopLevelSymbols(sourceFile, cwd) {
  const functionsByName = new Map();
  const variablesByName = new Map();
  const importsByName = new Map();
  const inlineFunctionsByOffset = new Map();

  function addFunction(name, declarationNode, functionNode, kind) {
    const sourceText = nodeText(sourceFile, functionNode);
    functionsByName.set(name, {
      name,
      kind,
      declarationNode,
      node: functionNode,
      body: functionNode.body,
      file: stableFileName(sourceFile.fileName, cwd),
      loc: sourceLoc(sourceFile, declarationNode),
      functionLoc: sourceLoc(sourceFile, functionNode),
      sourceTextHash: sourceTextHash(sourceText),
      signature: describeFunctionSignature(sourceFile, functionNode)
    });
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const module = importModuleText(statement);
      const clause = statement.importClause;
      if (clause.name) {
        importsByName.set(clause.name.text, {
          name: clause.name.text,
          importedName: 'default',
          kind: 'default',
          module,
          loc: sourceLoc(sourceFile, clause.name)
        });
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        importsByName.set(bindings.name.text, {
          name: bindings.name.text,
          importedName: '*',
          kind: 'namespace',
          module,
          loc: sourceLoc(sourceFile, bindings.name)
        });
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const specifier of bindings.elements) {
          importsByName.set(specifier.name.text, {
            name: specifier.name.text,
            importedName: specifier.propertyName ? specifier.propertyName.text : specifier.name.text,
            kind: 'named',
            module,
            loc: sourceLoc(sourceFile, specifier.name)
          });
        }
      }
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      addFunction(statement.name.text, statement, statement, 'function-declaration');
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      const declarationKind = declarationKindFromList(statement.declarationList);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        const init = declaration.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          addFunction(name, declaration, init, ts.isArrowFunction(init) ? 'const-arrow' : 'const-function-expression');
        } else {
          variablesByName.set(name, {
            name,
            declarationKind,
            file: stableFileName(sourceFile.fileName, cwd),
            loc: sourceLoc(sourceFile, declaration),
            hasInitializer: Boolean(init),
            sourceTextHash: init ? sourceTextHash(nodeText(sourceFile, init)) : undefined
          });
        }
      }
    }
  }

  function collectInline(node) {
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !isTopLevelFunctionInitializer(node)) {
      const loc = sourceLoc(sourceFile, node);
      inlineFunctionsByOffset.set(loc.start.offset, {
        name: `<inline:${loc.start.offset}>`,
        kind: functionKind(node, 'inline'),
        declarationNode: node,
        node,
        body: node.body,
        file: stableFileName(sourceFile.fileName, cwd),
        loc,
        functionLoc: loc,
        sourceTextHash: sourceTextHash(nodeText(sourceFile, node)),
        signature: describeFunctionSignature(sourceFile, node)
      });
    }
    ts.forEachChild(node, collectInline);
  }

  function isTopLevelFunctionInitializer(node) {
    const parent = node.parent;
    return Boolean(parent && ts.isVariableDeclaration(parent) && parent.initializer === node && parent.parent && parent.parent.parent && ts.isVariableStatement(parent.parent.parent));
  }

  collectInline(sourceFile);

  return {
    functionsByName,
    variablesByName,
    importsByName,
    inlineFunctionsByOffset
  };
}

function isIdentifierReference(node) {
  if (!ts.isIdentifier(node)) return false;
  const parent = node.parent;
  if (!parent) return true;

  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)) && parent.name === node) return false;
  if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node) return false;
  if ((ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isLabeledStatement(parent) && parent.label === node) return false;
  if (ts.isBreakStatement(parent) && parent.label === node) return false;
  if (ts.isContinueStatement(parent) && parent.label === node) return false;
  if (ts.isTypeReferenceNode(parent)) return false;
  if (ts.isPropertySignature(parent) && parent.name === node) return false;
  if (ts.isEnumMember(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (ts.isJsxAttribute(parent) && parent.name === node) return false;

  // Shorthand object properties are real references. Everything else above is declaration/name metadata.
  return true;
}

function unsupportedSyntaxForNode(node) {
  if (ts.isAwaitExpression(node)) {
    return ['PULSEWASM_UNSUPPORTED_AWAIT', 'await is not supported in PulseWasm v1 handler bodies.', 'Use explicit continuation style and no hidden suspension.'];
  }
  if (ts.isTryStatement(node)) {
    return ['PULSEWASM_UNSUPPORTED_TRY_CATCH', 'try/catch/finally is not supported in PulseWasm v1 handler bodies.', 'Use explicit Pulse error handlers instead of JavaScript exception control flow.'];
  }
  if (ts.isThrowStatement(node)) {
    return ['PULSEWASM_UNSUPPORTED_THROW', 'throw is not supported in PulseWasm v1 handler bodies.', 'Route errors through the explicit error handler contract.'];
  }
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    return ['PULSEWASM_UNSUPPORTED_LOOP', 'loops are not supported in PulseWasm v1 handler bodies.', 'Use a narrower, explicitly lowered helper once the subset expands.'];
  }
  if (ts.isSwitchStatement(node)) {
    return ['PULSEWASM_UNSUPPORTED_SWITCH', 'switch statements are not supported in PulseWasm v1 handler bodies.', 'Use if/else for the v1 subset.'];
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    return ['PULSEWASM_UNSUPPORTED_CLASS', 'classes are not supported in PulseWasm v1 handler bodies.', 'Use top-level functions and explicit data values.'];
  }
  if (ts.isThis(node)) {
    return ['PULSEWASM_UNSUPPORTED_THIS', '`this` is not supported in PulseWasm v1 handler bodies.', 'Use explicit ctx/next parameters only.'];
  }
  if (ts.isNewExpression(node)) {
    return ['PULSEWASM_UNSUPPORTED_NEW', '`new` expressions are not supported in PulseWasm v1 handler bodies.', 'Use allowlisted constructors only after the subset is widened.'];
  }
  if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
    return ['PULSEWASM_UNSUPPORTED_SPREAD', 'spread syntax is not supported in PulseWasm v1 handler bodies.', 'Use explicit values in the v1 subset.'];
  }
  return null;
}

function makeDiagnostic(code, message, hint, loc, details) {
  const diag = {
    pass: 'handler-eval',
    code,
    severity: 'error',
    message,
    hint,
    loc
  };
  if (details !== undefined) diag.details = details;
  return diag;
}

function createEvalBase(entry, record, mode) {
  return {
    handlerId: entry.id,
    handlerName: entry.localName || entry.inlineName || entry.name || record?.name || entry.id,
    roles: entry.roles || [],
    mode,
    kind: entry.kind || record?.kind,
    file: entry.file || record?.file,
    loc: entry.loc || record?.loc,
    status: 'ok',
    params: record?.signature?.params || entry.signature?.params || [],
    captures: [],
    calls: [],
    deps: [],
    dependencyChain: [],
    globals: [],
    imports: [],
    fetches: [],
    unsupported: []
  };
}

function buildHandlerEval(sourceFile, handlerTable, options = {}) {
  const cwd = options.cwd || process.cwd();
  const symbols = collectTopLevelSymbols(sourceFile, cwd);
  const handlersByName = new Map();
  const handlerIdsByName = new Map();
  const diagnostics = [];
  const dependencyEvaluations = [];
  const dependencyCache = new Map();
  const allowedImports = new Set(options.allowedImports || []);
  const allowedImportCalls = new Set(options.allowedImportCalls || []);
  const allowedImportMemberCalls = new Set(options.allowedImportMemberCalls || []);
  const allowedGlobals = new Set([...(options.allowedGlobals || []), ...ALLOWED_LITERAL_GLOBALS]);

  for (const handler of handlerTable.handlers || []) {
    if (handler.localName) {
      handlersByName.set(handler.localName, handler);
      handlerIdsByName.set(handler.localName, handler.id);
    }
  }

  function locateHandlerRecord(handler) {
    if (handler.localName && symbols.functionsByName.has(handler.localName)) return symbols.functionsByName.get(handler.localName);
    const start = handler.loc?.start?.offset;
    if (typeof start === 'number' && symbols.inlineFunctionsByOffset.has(start)) return symbols.inlineFunctionsByOffset.get(start);
    return undefined;
  }

  function evaluateRecord(entry, record, mode, stack = []) {
    const cacheKey = entry.id || `local:${entry.name}`;
    const evaluation = createEvalBase(entry, record, mode);
    const unsupportedKeys = new Set();

    function addUnsupported(code, message, hint, loc, details) {
      const key = `${code}:${sourceKey(loc)}:${message}`;
      if (unsupportedKeys.has(key)) return;
      unsupportedKeys.add(key);
      const item = { code, message, hint, loc };
      if (details !== undefined) item.details = details;
      evaluation.unsupported.push(item);
      diagnostics.push(makeDiagnostic(code, `${evaluation.handlerName}: ${message}`, hint, loc || evaluation.loc, details));
      evaluation.status = 'error';
    }

    if (!record || !record.node) {
      addUnsupported(
        'PULSEWASM_HANDLER_NODE_NOT_FOUND',
        'Unable to find the AST node for this handler.',
        'Handlers must be top-level declarations or direct inline function expressions in the analyzed entry file.',
        entry.loc
      );
      return evaluation;
    }

    const rootFunction = record.node;
    const rootBody = rootFunction.body;
    const rootParams = Array.from(rootFunction.parameters || []);
    const scopes = [new Map()];

    function currentScope() {
      return scopes[scopes.length - 1];
    }

    function pushScope() {
      scopes.push(new Map());
    }

    function popScope() {
      scopes.pop();
    }

    function addLocal(name, kind, loc) {
      currentScope().set(name, { name, kind, loc });
    }

    for (const parameter of rootParams) {
      if (ts.isIdentifier(parameter.name)) addLocal(parameter.name.text, 'param', sourceLoc(sourceFile, parameter.name));
    }

    function resolveName(name) {
      for (let i = scopes.length - 1; i >= 0; i -= 1) {
        const found = scopes[i].get(name);
        if (found) return { ...found, scope: 'local' };
      }
      if (symbols.functionsByName.has(name)) return { scope: 'top-level-function', ...symbols.functionsByName.get(name) };
      if (symbols.variablesByName.has(name)) return { scope: 'top-level-variable', ...symbols.variablesByName.get(name) };
      if (symbols.importsByName.has(name)) return { scope: 'import', ...symbols.importsByName.get(name) };
      if (allowedGlobals.has(name)) return { scope: 'allowed-global', name };
      return { scope: 'global', name };
    }

    function addCapture(name, resolution, loc) {
      const capture = {
        name,
        kind: resolution.scope === 'top-level-variable' ? resolution.declarationKind : resolution.scope,
        mutable: resolution.scope === 'top-level-variable' && resolution.declarationKind !== 'const',
        loc
      };
      evaluation.captures.push(capture);
      addUnsupported(
        capture.mutable ? 'PULSEWASM_UNSUPPORTED_MUTABLE_CAPTURE' : 'PULSEWASM_UNSUPPORTED_CLOSURE_CAPTURE',
        `Closure capture of outer ${capture.mutable ? 'mutable ' : ''}symbol "${name}" is not supported.`,
        'Pass values through ctx or a future explicit binding surface instead of closing over module scope.',
        loc,
        { name, capture }
      );
    }

    function addImportUse(name, resolution, loc) {
      const importUse = {
        name,
        importedName: resolution.importedName,
        kind: resolution.kind,
        module: resolution.module,
        allowed: allowedImports.has(resolution.module),
        loc
      };
      evaluation.imports.push(importUse);
      if (!importUse.allowed) {
        const network = NETWORK_IMPORT_MODULES.has(resolution.module) || NETWORK_IMPORT_MODULES.has(String(resolution.module).replace(/^node:/, 'node:'));
        if (network) {
          addUnsupported(
            'PULSEWASM_FORBIDDEN_NETWORK_IMPORT',
            `Network dependency "${resolution.module}" is not allowed in PulseWasm handler code.`,
            'Use the declared backend capability surface and ctx.fetch("backendKey", { ... }) instead.',
            loc,
            importUse
          );
          return;
        }
        addUnsupported(
          'PULSEWASM_FORBIDDEN_IMPORT',
          `Imported dependency "${name}" from "${resolution.module}" is not allowed in PulseWasm v1 handler evaluation.`,
          'Inline the logic into the supported subset or add a future explicit allowlisted import resolver.',
          loc,
          importUse
        );
      }
    }

    function addGlobalUse(name, loc) {
      if (allowedGlobals.has(name)) return;
      const globalUse = { name, loc };
      evaluation.globals.push(globalUse);
      addUnsupported(
        'PULSEWASM_UNSUPPORTED_GLOBAL',
        `Global "${name}" is not supported in PulseWasm v1 handler bodies.`,
        'Use only ctx, next, local variables, and direct same-file helper calls in the v1 subset.',
        loc,
        globalUse
      );
    }

    function isAllowedImportCall(resolution, localName) {
      if (!resolution || resolution.scope !== 'import') return false;
      return allowedImportCalls.has(`${resolution.module}:${resolution.importedName}`) || allowedImportCalls.has(`${resolution.module}:${localName}`);
    }

    function isAllowedImportMemberCall(resolution, memberName) {
      if (!resolution || resolution.scope !== 'import') return false;
      return allowedImportMemberCalls.has(`${resolution.module}:${resolution.importedName}.${memberName}`) || allowedImportMemberCalls.has(`${resolution.module}:${resolution.name}.${memberName}`);
    }

    function addDependency(name, resolution, loc) {
      const handlerId = handlerIdsByName.get(name);
      const dep = {
        name,
        kind: 'local-function',
        resolved: true,
        handlerId,
        sourceTextHash: resolution.sourceTextHash,
        loc
      };
      evaluation.deps.push(dep);
      return dep;
    }

    function evaluateDependency(name, resolution, loc) {
      const depKey = `local:${name}:${resolution.sourceTextHash || ''}`;
      if (stack.includes(name)) {
        addUnsupported(
          'PULSEWASM_UNSUPPORTED_RECURSION',
          `Recursive helper dependency detected: ${[...stack, name].join(' -> ')}.`,
          'PulseWasm v1 requires an acyclic direct helper dependency chain.',
          loc,
          { chain: [...stack, name] }
        );
        return undefined;
      }
      if (!dependencyCache.has(depKey)) {
        const depEntry = {
          id: handlerIdsByName.get(name) || `local_${sourceTextHash(`${resolution.file}:${name}:${resolution.sourceTextHash}`)}`,
          name,
          localName: name,
          roles: handlerIdsByName.has(name) ? ['handler-dependency'] : ['local-dependency'],
          kind: resolution.kind,
          file: resolution.file,
          loc: resolution.loc,
          signature: resolution.signature
        };
        const depEval = evaluateRecord(depEntry, resolution, 'dependency', [...stack, name]);
        dependencyCache.set(depKey, depEval);
        dependencyEvaluations.push(depEval);
      }
      const depEval = dependencyCache.get(depKey);
      evaluation.dependencyChain.push({
        name,
        handlerId: handlerIdsByName.get(name),
        status: depEval.status,
        deps: depEval.deps.map((dep) => dep.name),
        unsupported: depEval.unsupported.map((item) => item.code)
      });
      if (depEval.status !== 'ok') evaluation.status = 'error';
      return depEval;
    }

    function handleIdentifierReference(node) {
      if (!isIdentifierReference(node)) return;
      const name = node.text;
      const loc = sourceLoc(sourceFile, node);
      const resolution = resolveName(name);
      if (resolution.scope === 'local' || resolution.scope === 'allowed-global') return;
      if (resolution.scope === 'top-level-function') {
        addUnsupported(
          'PULSEWASM_UNSUPPORTED_FUNCTION_REFERENCE',
          `Function "${name}" is referenced as a value instead of called directly.`,
          'Only direct same-file helper calls are supported in handler bodies.',
          loc,
          { name }
        );
        return;
      }
      if (resolution.scope === 'top-level-variable') {
        addCapture(name, resolution, loc);
        return;
      }
      if (resolution.scope === 'import') {
        addImportUse(name, resolution, loc);
        return;
      }
      addGlobalUse(name, loc);
    }


    function propertyValue(objectNode, key) {
      if (!objectNode || !ts.isObjectLiteralExpression(objectNode)) return undefined;
      for (const prop of objectNode.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const name = prop.name;
        if ((ts.isIdentifier(name) || isStringLiteralLike(name)) && name.text === key) return prop.initializer;
      }
      return undefined;
    }



    function propertyAccessChain(node) {
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

    function isTrustedCtxDslCall(node, chain) {
      if (!chain || chain.length < 2) return false;
      const objectName = chain[0];
      const objectResolution = resolveName(objectName);
      if (!(objectResolution.scope === 'local' && objectResolution.kind === 'param')) return false;
      const suffix = chain.slice(1).join('.');
      return new Set([
        'param',
        'paramI32',
        'state.get',
        'state.set',
        'request.method',
        'request.path',
        'request.header.first',
        'request.header.count',
        'request.header.at',
        'req.json',
        'request.json',
        'req.parse',
        'response.header.set',
        'response.header.append',
        'response.header.delete',
        'result.text',
        'result.empty',
        'result.jsonText',
        'result.json',
        'schema.encode',
        'resolved',
        'error'
      ]).has(suffix);
    }

    function parseStaticFetchRequest(node, objectName) {
      const loc = sourceLoc(sourceFile, node);
      const usage = {
        target: `${objectName}.fetch`,
        object: objectName,
        loc,
        static: false,
        backend: undefined,
        method: undefined,
        path: undefined,
        diagnostics: []
      };
      if (node.arguments.length !== 2) {
        addUnsupported(
          'PULSEWASM_DYNAMIC_FETCH_REQUEST',
          `${objectName}.fetch expects exactly a backend key and a static request object in PulseWasm v1.`,
          'Use ctx.fetch("backendKey", { method: "GET", path: "/path" }).',
          loc,
          { argCount: node.arguments.length }
        );
        return usage;
      }
      const backendArg = node.arguments[0];
      if (!isStringLiteralLike(backendArg)) {
        addUnsupported(
          'PULSEWASM_DYNAMIC_BACKEND_KEY',
          'ctx.fetch backend key must be a string literal in PulseWasm v1.',
          'Declare the backend in defineConfig.backends and call ctx.fetch("backendKey", ...).',
          sourceLoc(sourceFile, backendArg),
          { target: nodeText(sourceFile, backendArg) }
        );
      } else {
        usage.backend = backendArg.text;
      }

      const requestArg = node.arguments[1];
      if (!ts.isObjectLiteralExpression(requestArg)) {
        addUnsupported(
          'PULSEWASM_DYNAMIC_FETCH_REQUEST',
          'ctx.fetch request must be an object literal in PulseWasm v1.',
          'Use ctx.fetch("backendKey", { method: "GET", path: "/path" }).',
          sourceLoc(sourceFile, requestArg),
          { target: nodeText(sourceFile, requestArg) }
        );
        return usage;
      }

      const methodNode = propertyValue(requestArg, 'method');
      const pathNode = propertyValue(requestArg, 'path');
      if (!methodNode || !isStringLiteralLike(methodNode)) {
        addUnsupported(
          'PULSEWASM_DYNAMIC_FETCH_REQUEST',
          'ctx.fetch method must be a string literal in PulseWasm v1.',
          'Use method: "GET" or another method explicitly allowed by the backend declaration.',
          methodNode ? sourceLoc(sourceFile, methodNode) : sourceLoc(sourceFile, requestArg),
          { field: 'method' }
        );
      } else {
        usage.method = methodNode.text.toUpperCase();
      }
      if (!pathNode) {
        addUnsupported(
          'PULSEWASM_DYNAMIC_FETCH_REQUEST',
          'ctx.fetch path is required in PulseWasm v1.',
          'Use path: "/path" or a Pass 30 route-effect lowerable expression with literals, +, and ctx.param(...).',
          sourceLoc(sourceFile, requestArg),
          { field: 'path' }
        );
      } else {
        usage.path = isStringLiteralLike(pathNode) ? pathNode.text : nodeText(sourceFile, pathNode);
        usage.pathLowering = isStringLiteralLike(pathNode) ? 'literal' : 'route-handler-effect-plan';
      }
      usage.static = Boolean(usage.backend && usage.method && usage.path);
      return usage;
    }

    function handleCall(node) {
      const callee = node.expression;
      const loc = sourceLoc(sourceFile, node);
      if (ts.isIdentifier(callee)) {
        const name = callee.text;
        const targetLoc = sourceLoc(sourceFile, callee);
        const resolution = resolveName(name);
        if (name === 'fetch') {
          evaluation.calls.push({ target: 'fetch', resolved: false, kind: 'global-fetch', loc });
          addUnsupported(
            'PULSEWASM_FORBIDDEN_GLOBAL_FETCH',
            'Global fetch() is not allowed in PulseWasm handler code.',
            'Declare a backend in defineConfig.backends and use ctx.fetch("backendKey", { ... }).',
            targetLoc,
            { target: 'fetch' }
          );
        } else if (resolution.scope === 'local' && resolution.kind === 'param' && name === 'next') {
          evaluation.calls.push({
            target: name,
            resolved: true,
            kind: node.arguments.length > 0 ? 'continuation-error' : 'continuation',
            argCount: node.arguments.length,
            transition: node.arguments.length > 0 ? 'error' : 'normal',
            loc
          });
        } else if (resolution.scope === 'top-level-function') {
          const dep = addDependency(name, resolution, targetLoc);
          evaluation.calls.push({ target: name, resolved: true, kind: 'local-function', handlerId: dep.handlerId, loc });
          evaluateDependency(name, resolution, targetLoc);
        } else if (resolution.scope === 'import') {
          addImportUse(name, resolution, targetLoc);
          if (isAllowedImportCall(resolution, name)) {
            evaluation.calls.push({
              target: name,
              resolved: true,
              kind: 'lowerable-import',
              module: resolution.module,
              importedName: resolution.importedName,
              loc
            });
          } else {
            evaluation.calls.push({ target: name, resolved: false, kind: 'import', module: resolution.module, loc });
            addUnsupported(
              'PULSEWASM_UNRESOLVED_HANDLER_DEPENDENCY',
              `Imported call target "${name}" cannot be resolved by the v1 same-file evaluator.`,
              'Use direct same-file helpers or wait for an explicit import resolver phase.',
              targetLoc,
              { name, module: resolution.module }
            );
          }
        } else if (resolution.scope === 'top-level-variable') {
          evaluation.calls.push({ target: name, resolved: false, kind: 'captured-variable', loc });
          addCapture(name, resolution, targetLoc);
          addUnsupported(
            'PULSEWASM_UNSUPPORTED_DYNAMIC_CALL',
            `Call target "${name}" resolves to a top-level variable, not a direct function declaration.`,
            'Use a top-level function declaration or const arrow/function expression helper.',
            targetLoc,
            { name }
          );
        } else if (resolution.scope === 'local') {
          evaluation.calls.push({ target: name, resolved: false, kind: 'local-value', loc });
          addUnsupported(
            'PULSEWASM_UNSUPPORTED_DYNAMIC_CALL',
            `Local value "${name}" is called dynamically.`,
            'PulseWasm v1 only allows next() and direct same-file helper calls.',
            targetLoc,
            { name }
          );
        } else {
          evaluation.calls.push({ target: name, resolved: false, kind: resolution.scope, loc });
          addGlobalUse(name, targetLoc);
          addUnsupported(
            'PULSEWASM_UNRESOLVED_HANDLER_DEPENDENCY',
            `Call target "${name}" could not be statically resolved.`,
            'Use next() or a direct same-file helper function.',
            targetLoc,
            { name }
          );
        }
        for (const arg of node.arguments) walk(arg);
        return;
      }

      if (ts.isPropertyAccessExpression(callee)) {
        const target = nodeText(sourceFile, callee);
        const chain = propertyAccessChain(callee);
        if (isTrustedCtxDslCall(node, chain)) {
          evaluation.calls.push({ target, resolved: true, kind: 'trusted-ctx-dsl', loc });
          for (const arg of node.arguments) walk(arg);
          return;
        }
        const suffix = chain && chain.length >= 2 ? chain.slice(1).join('.') : undefined;
        if (suffix === 'resolve') {
          const objectName = chain[0];
          const objectResolution = resolveName(objectName);
          if (objectResolution.scope === 'local' && objectResolution.kind === 'param') {
            evaluation.calls.push({
              target,
              resolved: true,
              kind: 'ctx-resolve',
              argCount: node.arguments.length,
              loc
            });
            if (node.arguments[0]) walk(node.arguments[0]);
            // The continuation argument is intentionally not walked as a normal
            // function-value reference; route-handler-effect-plan validates that
            // it is a top-level named continuation.
            return;
          }
        }
        const memberName = callee.name.text;
        if (ts.isIdentifier(callee.expression)) {
          const objectResolution = resolveName(callee.expression.text);
          if (isAllowedImportMemberCall(objectResolution, memberName)) {
            addImportUse(callee.expression.text, objectResolution, sourceLoc(sourceFile, callee.expression));
            evaluation.calls.push({
              target,
              resolved: true,
              kind: 'lowerable-import-member',
              module: objectResolution.module,
              importedName: objectResolution.importedName,
              member: memberName,
              loc
            });
            for (const arg of node.arguments) walk(arg);
            return;
          }
        }
        if (memberName === 'fetch' && ts.isIdentifier(callee.expression)) {
          const objectName = callee.expression.text;
          const objectResolution = resolveName(objectName);
          if (objectResolution.scope === 'local' && objectResolution.kind === 'param') {
            const fetchUsage = parseStaticFetchRequest(node, objectName);
            evaluation.fetches.push(fetchUsage);
            evaluation.calls.push({
              target,
              resolved: fetchUsage.static,
              kind: 'ctx-fetch',
              backend: fetchUsage.backend,
              method: fetchUsage.method,
              path: fetchUsage.path,
              static: fetchUsage.static,
              loc
            });
            return;
          }
        }
        if (ts.isIdentifier(callee.expression) && ['ok', 'errorText', 'jsonText', 'json', 'getString', 'getI32', 'getU32', 'getF64', 'getBool', 'has'].includes(memberName)) {
          const objectResolution = resolveName(callee.expression.text);
          if (objectResolution.scope === 'local') {
            evaluation.calls.push({ target, resolved: true, kind: 'request-json-body-accessor', loc });
            for (const arg of node.arguments) walk(arg);
            return;
          }
        }
        if (target === 'globalThis.fetch') {
          evaluation.calls.push({ target, resolved: false, kind: 'global-fetch', loc });
          addUnsupported(
            'PULSEWASM_FORBIDDEN_GLOBAL_FETCH',
            'globalThis.fetch() is not allowed in PulseWasm handler code.',
            'Declare a backend in defineConfig.backends and use ctx.fetch("backendKey", { ... }).',
            sourceLoc(sourceFile, callee),
            { target }
          );
          for (const arg of node.arguments) walk(arg);
          return;
        }
        if (ts.isIdentifier(callee.expression)) {
          const objectResolution = resolveName(callee.expression.text);
          if (objectResolution.scope === 'import' && NETWORK_IMPORT_MODULES.has(objectResolution.module)) {
            evaluation.calls.push({ target, resolved: false, kind: 'network-import', module: objectResolution.module, loc });
            addImportUse(callee.expression.text, objectResolution, sourceLoc(sourceFile, callee.expression));
            return;
          }
        }
        evaluation.calls.push({
          target,
          resolved: false,
          kind: 'member',
          loc
        });
        addUnsupported(
          'PULSEWASM_UNSUPPORTED_MEMBER_CALL',
          `Member call "${target}" is not supported in PulseWasm v1 handler evaluation.`,
          'Use direct allowlisted helper calls only. Builder/ctx methods need an explicit future lowering contract.',
          sourceLoc(sourceFile, callee),
          { target }
        );
        walk(callee.expression);
        for (const arg of node.arguments) walk(arg);
        return;
      }

      if (ts.isElementAccessExpression(callee)) {
        evaluation.calls.push({ target: nodeText(sourceFile, callee), resolved: false, kind: 'computed', loc });
        addUnsupported(
          'PULSEWASM_UNSUPPORTED_COMPUTED_ACCESS',
          `Computed call target "${nodeText(sourceFile, callee)}" is not supported.`,
          'Use direct identifier calls only in the v1 subset.',
          sourceLoc(sourceFile, callee),
          { target: nodeText(sourceFile, callee) }
        );
        walk(callee.expression);
        walk(callee.argumentExpression);
        for (const arg of node.arguments) walk(arg);
        return;
      }

      evaluation.calls.push({ target: nodeText(sourceFile, callee), resolved: false, kind: 'dynamic', loc });
      addUnsupported(
        'PULSEWASM_UNSUPPORTED_DYNAMIC_CALL',
        `Dynamic call target "${nodeText(sourceFile, callee)}" is not supported.`,
        'Use next() or a direct same-file helper function.',
        sourceLoc(sourceFile, callee),
        { target: nodeText(sourceFile, callee) }
      );
      walk(callee);
      for (const arg of node.arguments) walk(arg);
    }

    function handleAssignment(node) {
      const loc = sourceLoc(sourceFile, node);
      const left = node.left;
      if (ts.isIdentifier(left)) {
        const name = left.text;
        const resolution = resolveName(name);
        if (resolution.scope === 'local' && resolution.kind !== 'param') {
          walk(node.right);
          return;
        }
        addUnsupported(
          resolution.scope === 'top-level-variable' ? 'PULSEWASM_UNSUPPORTED_OUTER_MUTATION' : 'PULSEWASM_UNSUPPORTED_ASSIGNMENT_TARGET',
          `Assignment to "${name}" is not supported in PulseWasm v1 handler bodies.`,
          'Only local non-parameter variables may be assigned after declaration in the v1 subset.',
          loc,
          { name, resolution: resolution.scope }
        );
        walk(node.right);
        return;
      }
      addUnsupported(
        'PULSEWASM_UNSUPPORTED_ASSIGNMENT_TARGET',
        `Assignment target "${nodeText(sourceFile, left)}" is not supported in PulseWasm v1 handler bodies.`,
        'Avoid object/property mutation until the lowering contract explicitly supports it.',
        sourceLoc(sourceFile, left),
        { target: nodeText(sourceFile, left) }
      );
      walk(left);
      walk(node.right);
    }

    function handleVariableDeclaration(node) {
      if (!ts.isIdentifier(node.name)) {
        addUnsupported(
          'PULSEWASM_UNSUPPORTED_BINDING_PATTERN',
          `Binding pattern "${nodeText(sourceFile, node.name)}" is not supported in PulseWasm v1 handler bodies.`,
          'Use a simple identifier declaration.',
          sourceLoc(sourceFile, node.name),
          { target: nodeText(sourceFile, node.name) }
        );
        if (node.initializer) walk(node.initializer);
        return;
      }
      if (node.initializer && ts.isIdentifier(node.initializer) && node.initializer.text === 'next') {
        addUnsupported(
          'PULSEWASM_UNSUPPORTED_NEXT_ESCAPE',
          'Aliasing next is not supported in PulseWasm v1 handler bodies.',
          'Call next() or next(err) directly so the continuation remains statically visible.',
          sourceLoc(sourceFile, node.initializer),
          { target: node.name.text }
        );
      }
      if (node.initializer) walk(node.initializer);
      addLocal(node.name.text, 'local', sourceLoc(sourceFile, node.name));
    }

    function walk(node) {
      if (!node) return;

      const unsupported = unsupportedSyntaxForNode(node);
      if (unsupported) {
        addUnsupported(unsupported[0], unsupported[1], unsupported[2], sourceLoc(sourceFile, node));
      }

      if (isFunctionLike(node)) {
        addUnsupported(
          'PULSEWASM_UNSUPPORTED_NESTED_FUNCTION',
          'Nested function declarations/expressions are not supported in PulseWasm v1 handler bodies.',
          'Use top-level helper functions only.',
          sourceLoc(sourceFile, node),
          { syntaxKind: ts.SyntaxKind[node.kind] }
        );
        return;
      }

      if (ts.isBlock(node)) {
        pushScope();
        for (const statement of node.statements) walk(statement);
        popScope();
        return;
      }

      if (ts.isVariableDeclaration(node)) {
        handleVariableDeclaration(node);
        return;
      }

      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) walk(declaration);
        return;
      }

      if (ts.isCallExpression(node)) {
        handleCall(node);
        return;
      }

      if (ts.isPropertyAccessExpression(node)) {
        walk(node.expression);
        return;
      }

      if (ts.isElementAccessExpression(node)) {
        addUnsupported(
          'PULSEWASM_UNSUPPORTED_COMPUTED_ACCESS',
          `Computed property access "${nodeText(sourceFile, node)}" is not supported in PulseWasm v1 handler bodies.`,
          'Use direct property access only, and only where the lowering contract allows it.',
          sourceLoc(sourceFile, node),
          { target: nodeText(sourceFile, node) }
        );
        walk(node.expression);
        walk(node.argumentExpression);
        return;
      }

      if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) {
        handleAssignment(node);
        return;
      }

      if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
        if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) {
          addUnsupported(
            'PULSEWASM_UNSUPPORTED_MUTATION',
            `Update expression "${nodeText(sourceFile, node)}" is not supported in PulseWasm v1 handler bodies.`,
            'Use explicit local assignment only if needed.',
            sourceLoc(sourceFile, node),
            { target: nodeText(sourceFile, node) }
          );
          walk(node.operand);
          return;
        }
      }

      if (ts.isPropertyAssignment(node)) {
        if (node.name && ts.isComputedPropertyName(node.name)) walk(node.name.expression);
        walk(node.initializer);
        return;
      }

      if (ts.isShorthandPropertyAssignment(node)) {
        handleIdentifierReference(node.name);
        return;
      }

      if (ts.isIdentifier(node)) {
        handleIdentifierReference(node);
        return;
      }

      ts.forEachChild(node, walk);
    }

    if (!rootBody) {
      addUnsupported(
        'PULSEWASM_HANDLER_BODY_REQUIRED',
        'Handler has no body to evaluate.',
        'Declare handlers with an explicit function body in the v1 subset.',
        record.functionLoc || entry.loc
      );
    } else if (ts.isBlock(rootBody)) {
      for (const statement of rootBody.statements) walk(statement);
    } else {
      walk(rootBody);
    }

    evaluation.captures = uniqueByKey(evaluation.captures, (item) => `${item.name}:${sourceKey(item.loc)}`);
    evaluation.calls = uniqueByKey(evaluation.calls, (item) => `${item.kind}:${item.target}:${sourceKey(item.loc)}`);
    evaluation.deps = uniqueByKey(evaluation.deps, (item) => `${item.name}:${item.handlerId || ''}`);
    evaluation.globals = uniqueByKey(evaluation.globals, (item) => `${item.name}:${sourceKey(item.loc)}`);
    evaluation.imports = uniqueByKey(evaluation.imports, (item) => `${item.name}:${item.module}:${sourceKey(item.loc)}`);
    evaluation.dependencyChain = uniqueByKey(evaluation.dependencyChain, (item) => `${item.name}:${item.handlerId || ''}`);
    evaluation.summary = {
      captures: evaluation.captures.length,
      calls: evaluation.calls.length,
      deps: evaluation.deps.length,
      dependencyChain: evaluation.dependencyChain.length,
      globals: evaluation.globals.length,
      imports: evaluation.imports.length,
      fetches: evaluation.fetches.length,
      unsupported: evaluation.unsupported.length
    };
    return evaluation;
  }

  const handlerEvaluations = [];
  for (const handler of handlerTable.handlers || []) {
    const record = locateHandlerRecord(handler);
    handlerEvaluations.push(evaluateRecord(handler, record, 'handler', [handler.localName || handler.id]));
  }

  const uniqueDependencyEvaluations = uniqueByKey(dependencyEvaluations, (item) => `${item.handlerId}:${item.handlerName}`);

  const artifact = normalizeArtifact({
    version: 'pulsewasm.handler-eval.v1',
    generatedBy: PACKAGE_VERSION,
    source: stableFileName(sourceFile.fileName, cwd),
    policy: {
      model: 'shallow-static-validator',
      contract: 'validate handler dependency shape; do not interpret arbitrary JavaScript',
      allowedCalls: ['next()', 'next(err)', 'direct same-file top-level helper calls', 'ctx.fetch("declaredBackend", staticRequest)', 'package-owned lowerable facade imports supplied by compiler orchestration'],
      rejected: [
        'async/await and Promise semantics',
        'loops',
        'try/catch/throw',
        'member-call dispatch except ctx.fetch capability usage',
        'computed access',
        'forbidden imports',
        'unsupported globals',
        'closure captures',
        'nested functions',
        'recursion'
      ]
    },
    handlers: handlerEvaluations,
    dependencyEvaluations: uniqueDependencyEvaluations,
    summary: {
      handlers: handlerEvaluations.length,
      ok: handlerEvaluations.filter((item) => item.status === 'ok').length,
      error: handlerEvaluations.filter((item) => item.status !== 'ok').length,
      dependencies: uniqueDependencyEvaluations.length,
      diagnostics: diagnostics.length,
      unsupported: handlerEvaluations.reduce((sum, item) => sum + item.unsupported.length, 0) + uniqueDependencyEvaluations.reduce((sum, item) => sum + item.unsupported.length, 0)
    }
  }, cwd);

  return {
    handlerEval: artifact,
    diagnostics
  };
}

module.exports = {
  buildHandlerEval,
  collectTopLevelSymbols
};
