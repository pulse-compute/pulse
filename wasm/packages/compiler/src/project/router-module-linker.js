'use strict';

const ts = require('typescript');
const {
  buildRouterIR
} = require('../extractor.js');
const {
  projectGraphContext,
  finalizeReachableProjectGraph
} = require('./reachable-graph-builder.js');

const ROUTER_MODULE_LINKER_VERSION = 'pulse.router-module-linker.v1';

class RouterModuleLinkError extends Error {
  constructor(message, diagnostics = [], detail = {}) {
    super(message);
    this.name = 'RouterModuleLinkError';
    this.code = 'PULSE_PROJECT_MODULE_LINK_FAILED';
    this.diagnostics = Object.freeze([...diagnostics]);
    this.detail = Object.freeze({ ...detail });
  }
}

function sourceLocationFromLoc(loc) {
  const start = loc && (loc.start || loc);
  return Object.freeze({
    file: String(loc && loc.file || '<unknown>').replace(/\\/g, '/'),
    line: Number(start && start.line || 1),
    column: Number(start && start.column || 1)
  });
}

function referenceSource(module, loc) {
  const source = sourceLocationFromLoc(loc);
  return Object.freeze({ file: module.path, line: source.line, column: source.column });
}

function declarationSource(module, declaration) {
  const loc = declaration && (declaration.functionLoc || declaration.loc || declaration.initLoc);
  return loc ? referenceSource(module, loc) : Object.freeze({ file: module.path, line: 1, column: 1 });
}

function graphDiagnostic(code, message, loc, detail = {}) {
  const source = sourceLocationFromLoc(loc);
  return Object.freeze({
    code,
    kind: 'RouterModuleLinkDiagnostic',
    severity: 'error',
    message,
    file: source.file,
    position: Object.freeze({ line: source.line, column: source.column }),
    detail: Object.freeze({ ...detail })
  });
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

function anonymousDefaultHandler(module) {
  const sourceFile = module.sourceFile;
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)
      && !statement.name
      && statement.modifiers
      && statement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      && statement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      const start = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
      return Object.freeze({
        kind: 'handler',
        module,
        localName: '<default-handler>',
        exportName: 'default',
        declaration: Object.freeze({
          anonymous: true,
          node: statement,
          loc: Object.freeze({ file: module.path, start: Object.freeze({ line: start.line + 1, column: start.character + 1 }) })
        })
      });
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const unwrapped = wrappersForExpression(statement.expression);
      if (!unwrapped.expression || (!ts.isArrowFunction(unwrapped.expression) && !ts.isFunctionExpression(unwrapped.expression))) continue;
      const start = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
      return Object.freeze({
        kind: 'handler',
        module,
        localName: '<default-handler>',
        exportName: 'default',
        declaration: Object.freeze({
          anonymous: true,
          node: unwrapped.expression,
          wrappers: unwrapped.wrappers,
          loc: Object.freeze({ file: module.path, start: Object.freeze({ line: start.line + 1, column: start.character + 1 }) })
        })
      });
    }
  }
  return undefined;
}

function wrappersForExpression(node) {
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
  return Object.freeze({ expression: current, wrappers: Object.freeze(wrappers) });
}

function importResolutionForLocal(context, module, localName) {
  for (const relation of module.imports) {
    const binding = relation.bindings.find((entry) => entry.localName === localName);
    if (!binding) continue;
    const resolution = module.resolutions.find((entry) => entry.relation === relation);
    return resolution ? Object.freeze({ relation, binding, resolution }) : undefined;
  }
  return undefined;
}

function localExportNames(module, localName) {
  const names = [];
  for (const [exportName, target] of module.localExports) if (target === localName) names.push(exportName);
  return Object.freeze(names.sort());
}

function directAuthoringImports(sourceFile) {
  const imports = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const expected = statement.moduleSpecifier.text === '@pulse-compute/runtime' ? 'Router'
      : statement.moduleSpecifier.text === '@pulse-compute/pulse' ? 'Pulse'
        : undefined;
    if (!expected) continue;
    const bindings = statement.importClause && statement.importClause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly || element.propertyName || element.name.text !== expected) continue;
      imports.add(expected);
    }
  }
  return imports;
}

function applicationConstructions(sourceFile) {
  const out = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const unwrapped = wrappersForExpression(declaration.initializer);
      const value = unwrapped.expression;
      if (!value || !ts.isNewExpression(value) || !ts.isIdentifier(value.expression) || !['Router', 'Pulse'].includes(value.expression.text)) continue;
      out.push(Object.freeze({
        localName: declaration.name.text,
        className: value.expression.text,
        node: value,
        wrappers: unwrapped.wrappers
      }));
    }
  }
  return Object.freeze(out);
}

function sourceModuleForKey(context, key) {
  return context.projectModules.get(key);
}

function buildModuleIndexes(context) {
  const indexes = new Map();
  const diagnostics = [];
  for (const module of [...context.projectModules.values()].filter((entry) => entry.runtime).sort((a, b) => a.path.localeCompare(b.path))) {
    const ir = buildRouterIR(module.sourceFile, { cwd: '.' });
    diagnostics.push(...(ir.diagnostics || []));
    const routers = new Map((ir.routerIR || []).map((entry) => [entry.name, entry]));
    const handlers = new Map((ir.handlerIR || []).map((entry) => [entry.name, entry]));
    const imports = directAuthoringImports(module.sourceFile);
    const constructions = applicationConstructions(module.sourceFile);
    indexes.set(module.path, Object.freeze({ module, ir, routers, handlers, imports, constructions }));
  }
  return Object.freeze({ indexes, diagnostics });
}

function resolveExport(context, indexes, module, exportName, diagnostics, stack = [], consumedImports) {
  const key = `${module.path}:${exportName}`;
  if (stack.includes(key)) {
    diagnostics.push(graphDiagnostic('PULSE_PROJECT_EXPORT_CYCLE_UNSUPPORTED', `Export resolution cycle detected for ${exportName} in ${module.path}.`, { file: module.path, start: { line: 1, column: 1 } }, { stack: [...stack, key] }));
    return undefined;
  }
  const nextStack = [...stack, key];
  if (module.localExports.has(exportName)) {
    return resolveLocal(context, indexes, module, module.localExports.get(exportName), diagnostics, nextStack, exportName, consumedImports);
  }
  if (exportName === 'default') {
    const anonymous = anonymousDefaultHandler(module);
    if (anonymous) return anonymous;
  }

  const candidates = [];
  for (const relation of module.reExports) {
    const resolution = module.resolutions.find((entry) => entry.relation === relation);
    const target = resolution && sourceModuleForKey(context, resolution.targetKey);
    if (!target) continue;
    if (relation.star && exportName !== 'default') {
      const resolved = resolveExport(context, indexes, target, exportName, diagnostics, nextStack, consumedImports);
      if (resolved) candidates.push(resolved);
      continue;
    }
    for (const mapping of relation.mappings) {
      if (mapping.exportName !== exportName) continue;
      const resolved = resolveExport(context, indexes, target, mapping.localName, diagnostics, nextStack, consumedImports);
      if (resolved) candidates.push(resolved);
    }
  }
  const unique = Array.from(new Map(candidates.map((entry) => [`${entry.module.path}:${entry.localName}:${entry.kind}`, entry])).values());
  if (unique.length > 1) {
    diagnostics.push(graphDiagnostic('PULSE_PROJECT_EXPORT_AMBIGUOUS', `Export ${exportName} in ${module.path} resolves to more than one project symbol.`, { file: module.path, start: { line: 1, column: 1 } }, { exportName, candidates: unique.map((entry) => `${entry.module.path}#${entry.localName}`) }));
    return undefined;
  }
  return unique[0];
}

function resolveLocal(context, indexes, module, localName, diagnostics, stack = [], requestedExportName, consumedImports) {
  const index = indexes.get(module.path);
  if (!index) return undefined;
  if (index.routers.has(localName)) return Object.freeze({
    kind: 'router',
    module,
    localName,
    exportName: requestedExportName || localExportNames(module, localName)[0] || null,
    declaration: index.routers.get(localName)
  });
  if (index.handlers.has(localName)) return Object.freeze({
    kind: 'handler',
    module,
    localName,
    exportName: requestedExportName || localExportNames(module, localName)[0] || null,
    declaration: index.handlers.get(localName)
  });
  const imported = importResolutionForLocal(context, module, localName);
  if (!imported) return undefined;
  if (consumedImports) consumedImports.add(`${module.path}\u0000${localName}`);
  const target = sourceModuleForKey(context, imported.resolution.targetKey);
  if (!target) return Object.freeze({ kind: 'package', moduleKey: imported.resolution.targetKey, localName, importedName: imported.binding.importedName });
  if (imported.binding.importedName === '*') {
    diagnostics.push(graphDiagnostic('PULSE_PROJECT_NAMESPACE_HANDLER_REFERENCE_UNSUPPORTED', `Namespace import ${localName} cannot be used as a direct handler or Router reference.`, imported.relation.source, { localName, specifier: imported.relation.specifier }));
    return undefined;
  }
  return resolveExport(context, indexes, target, imported.binding.importedName, diagnostics, stack, consumedImports);
}

function validateRuntimeProjectImports(context, consumedImports, diagnostics) {
  for (const module of [...context.projectModules.values()].filter((entry) => entry.runtime).sort((a, b) => a.path.localeCompare(b.path))) {
    for (const relation of module.imports) {
      if (relation.kind !== 'runtime-import') continue;
      const resolution = module.resolutions.find((entry) => entry.relation === relation);
      if (!resolution || !sourceModuleForKey(context, resolution.targetKey)) continue;
      if (relation.bindings.length === 0) {
        diagnostics.push(graphDiagnostic(
          'PULSE_PROJECT_RUNTIME_SIDE_EFFECT_IMPORT_UNSUPPORTED',
          `Project runtime side-effect import ${JSON.stringify(relation.specifier)} is not supported by the first multi-module compiler implementation.`,
          relation.source,
          { specifier: relation.specifier, automaticFallback: false }
        ));
        continue;
      }
      for (const binding of relation.bindings) {
        const key = `${module.path}\u0000${binding.localName}`;
        if (consumedImports.has(key)) continue;
        diagnostics.push(graphDiagnostic(
          'PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED',
          `Project runtime import ${binding.localName} from ${JSON.stringify(relation.specifier)} is not a Router, middleware, route handler, event handler, error handler, mounted Router, or resolved application root.`,
          relation.source,
          {
            specifier: relation.specifier,
            localName: binding.localName,
            importedName: binding.importedName,
            supportedRoles: Object.freeze(['application-root', 'router', 'middleware', 'route', 'event', 'error-middleware']),
            automaticFallback: false
          }
        ));
      }
    }
  }
}

function moduleIdsByPath(graphBuild) {
  return new Map(graphBuild.graph.modules.filter((module) => module.kind === 'project').map((module) => [module.path, module.id]));
}

function globalSymbol(moduleId, kind, localName) {
  return `${moduleId}::${kind}::${localName}`;
}

function retainedDeclarations(context, diagnostics) {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const declarations = [];
  const typeNames = new Map();
  const imports = new Map();

  for (const module of [...context.projectModules.values()].filter((entry) => entry.runtime).sort((a, b) => a.path.localeCompare(b.path))) {
    for (const statement of module.sourceFile.statements) {
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
        const name = statement.name && statement.name.text;
        const text = printer.printNode(ts.EmitHint.Unspecified, statement, module.sourceFile);
        if (name && typeNames.has(name) && typeNames.get(name) !== text) {
          diagnostics.push(graphDiagnostic('PULSE_PROJECT_TYPE_NAME_COLLISION', `Type declaration ${name} is defined differently in more than one reachable module.`, { file: module.path, start: { line: 1, column: 1 } }, { name }));
          continue;
        }
        if (name) typeNames.set(name, text);
        declarations.push(text);
        continue;
      }
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const relation = module.imports.find((entry) => entry.statement === statement);
      const resolution = relation && module.resolutions.find((entry) => entry.relation === relation);
      if (resolution && sourceModuleForKey(context, resolution.targetKey)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!['@pulse-compute/runtime', '@pulse-compute/pulse'].includes(specifier)) continue;
      const clause = statement.importClause;
      if (!clause || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
      const removed = specifier === '@pulse-compute/runtime' ? 'Router' : 'Pulse';
      const kept = clause.namedBindings.elements.filter((element) => (element.propertyName ? element.propertyName.text : element.name.text) !== removed);
      if (kept.length === 0 && !clause.name) continue;
      const nextClause = ts.factory.updateImportClause(
        clause,
        clause.isTypeOnly || kept.every((element) => element.isTypeOnly),
        clause.name,
        ts.factory.updateNamedImports(clause.namedBindings, kept.map((element) => ts.factory.updateImportSpecifier(element, false, element.propertyName, element.name)))
      );
      const text = printer.printNode(ts.EmitHint.Unspecified, ts.factory.updateImportDeclaration(statement, statement.modifiers, nextClause, statement.moduleSpecifier, statement.attributes), module.sourceFile);
      imports.set(text, text);
    }
  }
  return [...imports.values(), ...Array.from(new Set(declarations))].join('\n');
}

function linkedAuthoringSource(context) {
  return [...context.projectModules.values()]
    .filter((entry) => entry.runtime)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => `// @pulse-project-module ${entry.path}\n${entry.sourceText}`)
    .join('\n');
}

function orderLinkedRouters(routers, rootName) {
  const byName = new Map(routers.map((router) => [router.name, router]));
  const visited = new Set();
  let routerOrder = 0;
  let operationOrder = 0;

  function visit(name) {
    if (!name || visited.has(name)) return;
    const router = byName.get(name);
    if (!router) return;
    visited.add(name);
    router.order = routerOrder++;
    for (const op of router.ops) {
      op.order = operationOrder++;
      if (op.kind === 'mount') visit(op.router);
    }
  }

  visit(rootName);
  for (const router of [...routers].sort((left, right) => left.name.localeCompare(right.name))) visit(router.name);
  routers.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  return Object.freeze({ routers, operationCount: operationOrder });
}

function linkProjectRouterModules(graphBuild, options = {}) {
  const context = projectGraphContext(graphBuild);
  if (!context) throw new TypeError('linkProjectRouterModules requires a reachable project graph build.');
  const diagnostics = [];
  const built = buildModuleIndexes(context);
  diagnostics.push(...built.diagnostics);
  const indexes = built.indexes;
  const consumedImports = new Set();
  const entryModule = context.projectModules.get(graphBuild.entryKey);
  const root = resolveExport(context, indexes, entryModule, 'default', diagnostics, [], consumedImports);
  for (const index of indexes.values()) {
    for (const construction of index.constructions) {
      if (!index.imports.has(construction.className)) {
        const packageName = construction.className === 'Pulse' ? '@pulse-compute/pulse' : '@pulse-compute/runtime';
        const point = index.module.sourceFile.getLineAndCharacterOfPosition(construction.node.getStart(index.module.sourceFile));
        diagnostics.push(graphDiagnostic(
          'PULSE_PROJECT_APPLICATION_IMPORT_REQUIRED',
          `${construction.className} construction in ${index.module.path} requires a direct unaliased named import from ${packageName}.`,
          { file: index.module.path, start: { line: point.line + 1, column: point.character + 1 } },
          { className: construction.className, packageName, localName: construction.localName }
        ));
      }
      if (construction.className === 'Pulse' && (!root || root.kind !== 'router' || root.module.path !== index.module.path || root.localName !== construction.localName)) {
        const point = index.module.sourceFile.getLineAndCharacterOfPosition(construction.node.getStart(index.module.sourceFile));
        diagnostics.push(graphDiagnostic(
          'PULSE_CANONICAL_PULSE_ROOT_ONLY',
          'Pulse may be constructed only for the resolved default application root. Imported and mounted applications use Router.',
          { file: index.module.path, start: { line: point.line + 1, column: point.character + 1 } },
          { declaration: construction.localName }
        ));
      }
    }
  }
  if (!root || root.kind !== 'router') {
    return Object.freeze({
      version: ROUTER_MODULE_LINKER_VERSION,
      kind: root && root.kind || 'unknown',
      root,
      diagnostics: Object.freeze([...diagnostics]),
      graph: finalizeReachableProjectGraph(graphBuild, root ? [{
        module: root.module.path,
        exportName: root.exportName,
        localName: root.localName,
        role: root.kind === 'router' ? 'router' : 'handler',
        wrappers: [],
        source: { file: entryModule.path, line: 1, column: 1 }
      }] : [])
    });
  }

  const moduleIds = moduleIdsByPath(graphBuild);
  const routerSymbols = new Map();
  const handlerSymbols = new Map();
  for (const [modulePath, index] of indexes) {
    const moduleId = moduleIds.get(modulePath);
    for (const name of index.routers.keys()) routerSymbols.set(`${modulePath}:${name}`, globalSymbol(moduleId, 'router', name));
    for (const name of index.handlers.keys()) handlerSymbols.set(`${modulePath}:${name}`, globalSymbol(moduleId, 'handler', name));
  }

  function resolveReference(module, ref, role) {
    if (!ref || ref.kind === 'inline' || ref.kind === 'static') return Object.freeze({ ref, target: undefined });
    const target = resolveLocal(context, indexes, module, ref.value, diagnostics, [], undefined, consumedImports);
    if (!target || !['handler', 'router'].includes(target.kind)) {
      diagnostics.push(graphDiagnostic('PULSE_PROJECT_IMPORTED_SYMBOL_UNRESOLVED', `Unable to resolve ${role} reference ${ref.value} from ${module.path}.`, ref.loc, { role, reference: ref.value }));
      return Object.freeze({ ref, target: undefined });
    }
    if (role === 'router' && target.kind !== 'router') {
      diagnostics.push(graphDiagnostic('PULSE_PROJECT_MOUNT_TARGET_KIND_MISMATCH', `Mounted reference ${ref.value} resolves to a handler rather than a Router.`, ref.loc, { reference: ref.value }));
      return Object.freeze({ ref, target: undefined });
    }
    if (role !== 'router' && target.kind !== 'handler') {
      diagnostics.push(graphDiagnostic('PULSE_PROJECT_HANDLER_TARGET_KIND_MISMATCH', `Handler reference ${ref.value} resolves to a Router rather than a handler.`, ref.loc, { reference: ref.value, role }));
      return Object.freeze({ ref, target: undefined });
    }
    if (role !== 'router' && target.declaration && target.declaration.anonymous) {
      diagnostics.push(graphDiagnostic(
        'PULSE_PROJECT_ANONYMOUS_IMPORTED_HANDLER_UNSUPPORTED',
        `Imported handler reference ${ref.value} resolves to an anonymous default handler. Name the exported handler before registering it with a Router.`,
        ref.loc,
        { reference: ref.value, module: target.module.path, role }
      ));
      return Object.freeze({ ref, target: undefined });
    }
    const symbol = target.kind === 'router'
      ? routerSymbols.get(`${target.module.path}:${target.localName}`)
      : handlerSymbols.get(`${target.module.path}:${target.localName}`);
    const next = Object.freeze({
      ...ref,
      value: symbol,
      localName: target.localName,
      exportName: target.exportName,
      modulePath: target.module.path,
      wrappers: Object.freeze([...(ref.wrappers || [])])
    });
    return Object.freeze({ ref: next, target });
  }

  const routers = [];
  const handlers = [];
  const handlerReferences = [{
    module: root.module.path,
    exportName: root.exportName || 'default',
    localName: root.localName,
    role: 'router',
    wrappers: [],
    source: declarationSource(root.module, root.declaration)
  }];
  let handlerOrder = 0;

  for (const [modulePath, index] of [...indexes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const handler of index.ir.handlerIR || []) {
      const exportNames = localExportNames(index.module, handler.name);
      handlers.push({
        ...handler,
        name: handlerSymbols.get(`${modulePath}:${handler.name}`),
        symbolId: handlerSymbols.get(`${modulePath}:${handler.name}`),
        localName: handler.name,
        exportName: exportNames[0] || handler.exportName,
        modulePath,
        moduleId: moduleIds.get(modulePath),
        order: handlerOrder++
      });
    }
    for (const router of index.ir.routerIR || []) {
      const ops = [];
      for (const op of router.ops || []) {
        const next = { ...op };
        if (next.kind === 'mount') {
          const resolved = resolveReference(index.module, { kind: 'identifier', value: next.router, loc: next.loc, ...(next.routerWrappers ? { wrappers: next.routerWrappers } : {}) }, 'router');
          if (resolved.target) {
            next.router = resolved.ref.value;
            handlerReferences.push({
              module: resolved.target.module.path,
              exportName: resolved.target.exportName,
              localName: resolved.target.localName,
              role: 'router',
              wrappers: resolved.ref.wrappers || [],
              source: referenceSource(index.module, next.loc)
            });
          }
        } else if (next.handler) {
          const role = next.kind === 'use' ? 'middleware' : next.kind === 'error' ? 'error-middleware' : next.kind === 'event' ? 'event' : 'route';
          if (next.handler.kind === 'inline') {
            handlerReferences.push({
              module: index.module.path,
              exportName: null,
              localName: `<inline:${referenceSource(index.module, next.handler.loc).line}:${referenceSource(index.module, next.handler.loc).column}>`,
              role,
              wrappers: next.handler.wrappers || [],
              source: referenceSource(index.module, next.handler.loc)
            });
          } else {
            const resolved = resolveReference(index.module, next.handler, role);
            next.handler = resolved.ref;
            if (resolved.target) handlerReferences.push({
              module: resolved.target.module.path,
              exportName: resolved.target.exportName,
              localName: resolved.target.localName,
              role,
              wrappers: resolved.ref.wrappers || [],
              source: referenceSource(index.module, op.handler && op.handler.loc || op.loc)
            });
          }
        }
        ops.push(next);
      }
      routers.push({
        ...router,
        name: routerSymbols.get(`${modulePath}:${router.name}`),
        localName: router.name,
        modulePath,
        moduleId: moduleIds.get(modulePath),
        order: -1,
        ops
      });
    }
  }

  const rootGlobalName = routerSymbols.get(`${root.module.path}:${root.localName}`);
  const ordered = orderLinkedRouters(routers, rootGlobalName);
  if (options.target !== 'javascript') validateRuntimeProjectImports(context, consumedImports, diagnostics);
  const combinedIr = Object.freeze({
    source: entryModule.path,
    routerIR: Object.freeze(ordered.routers),
    handlerIR: Object.freeze(handlers),
    diagnostics: Object.freeze([...diagnostics]),
    summary: Object.freeze({
      routers: routers.length,
      handlers: handlers.length,
      operations: ordered.operationCount,
      routersWithOps: routers.filter((router) => router.ops.length > 0).length,
      statements: routers.reduce((total, router) => total + new Set(router.ops.map((op) => op.statementOrder)).size, 0)
    })
  });
  const manifest = finalizeReachableProjectGraph(graphBuild, handlerReferences);
  const retained = retainedDeclarations(context, diagnostics);
  const rootIndex = indexes.get(root.module.path);
  const rootSourceFile = root.module.sourceFile;
  const functionNodeForHandler = (handler) => {
    const module = context.projectModules.get(handler && handler.file);
    const sourceFile = module ? module.sourceFile : rootSourceFile;
    if (!sourceFile) return undefined;
    if (handler && handler.localName) return functionForNamedHandler(sourceFile, handler.localName);
    const offset = handler && handler.loc && handler.loc.start && handler.loc.start.offset;
    let match;
    function visit(node) {
      if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.getStart(sourceFile) === offset) match = node;
      if (!match) ts.forEachChild(node, visit);
    }
    if (Number.isInteger(offset)) visit(sourceFile);
    return match;
  };

  if (diagnostics.some((entry) => entry.severity !== 'warning')) {
    throw new RouterModuleLinkError(`Project module linking failed with ${diagnostics.length} diagnostic(s).`, diagnostics, { entry: entryModule.path });
  }

  return Object.freeze({
    version: ROUTER_MODULE_LINKER_VERSION,
    kind: 'router',
    graph: manifest,
    ir: combinedIr,
    entryModule,
    rootModule: root.module,
    rootLocalName: root.localName,
    rootGlobalName,
    rootExportName: root.exportName || 'default',
    rootSourceFile,
    rootSourceText: root.module.sourceText,
    authoringSourceText: linkedAuthoringSource(context),
    entrySourceFile: entryModule.sourceFile,
    entrySourceText: entryModule.sourceText,
    retainedDeclarations: retained,
    functionNodeForHandler,
    sourceFileForPath(file) {
      const module = context.projectModules.get(file);
      return module && module.sourceFile;
    },
    projectFiles: graphBuild.projectModulePaths,
    runtimeProjectFiles: graphBuild.runtimeProjectModulePaths,
    diagnostics: Object.freeze([]),
    summary: Object.freeze({
      projectModules: graphBuild.summary.projectModules,
      runtimeProjectModules: graphBuild.summary.runtimeProjectModules,
      routers: routers.length,
      handlers: handlers.length,
      handlerReferences: manifest.handlers.length,
      cycles: manifest.cycles.length
    })
  });
}

function linkProjectPlainHandler(graphBuild, options = {}) {
  const context = projectGraphContext(graphBuild);
  if (!context) throw new TypeError('linkProjectPlainHandler requires a reachable project graph build.');
  const diagnostics = [];
  const built = buildModuleIndexes(context);
  diagnostics.push(...built.diagnostics);
  const consumedImports = new Set(Array.isArray(options.consumedRuntimeImports) ? options.consumedRuntimeImports : []);
  const entryModule = context.projectModules.get(graphBuild.entryKey);
  const root = resolveExport(context, built.indexes, entryModule, 'default', diagnostics, [], consumedImports);
  if (!root || root.kind !== 'handler') {
    diagnostics.push(graphDiagnostic(
      'PULSE_PROJECT_PLAIN_HANDLER_ROOT_REQUIRED',
      'The configured entry must resolve its default export to one project-owned handler.',
      { file: entryModule.path, start: { line: 1, column: 1 } },
      { resolvedKind: root && root.kind || 'unknown' }
    ));
  }
  if (options.target !== 'javascript') validateRuntimeProjectImports(context, consumedImports, diagnostics);
  if (diagnostics.some((entry) => entry.severity !== 'warning')) {
    throw new RouterModuleLinkError(`Project plain-handler linking failed with ${diagnostics.length} diagnostic(s).`, diagnostics, { entry: entryModule.path });
  }
  const handlerReferences = [{
    module: root.module.path,
    exportName: root.exportName || 'default',
    localName: root.localName,
    role: 'handler',
    wrappers: [],
    source: declarationSource(root.module, root.declaration)
  }];
  return Object.freeze({
    version: ROUTER_MODULE_LINKER_VERSION,
    kind: 'handler',
    graph: finalizeReachableProjectGraph(graphBuild, handlerReferences),
    entryModule,
    rootModule: root.module,
    rootLocalName: root.localName,
    rootExportName: root.exportName || 'default',
    rootSourceFile: root.module.sourceFile,
    rootSourceText: root.module.sourceText,
    authoringSourceText: root.module.sourceText,
    projectFiles: graphBuild.projectModulePaths,
    runtimeProjectFiles: graphBuild.runtimeProjectModulePaths,
    diagnostics: Object.freeze([]),
    summary: Object.freeze({
      projectModules: graphBuild.summary.projectModules,
      runtimeProjectModules: graphBuild.summary.runtimeProjectModules,
      handlers: 1,
      handlerReferences: 1,
      cycles: graphBuild.graph.cycles.length
    })
  });
}

function resolveProjectRoot(graphBuild) {
  const context = projectGraphContext(graphBuild);
  if (!context) throw new TypeError('resolveProjectRoot requires a reachable project graph build.');
  const diagnostics = [];
  const built = buildModuleIndexes(context);
  diagnostics.push(...built.diagnostics);
  const entry = context.projectModules.get(graphBuild.entryKey);
  const root = resolveExport(context, built.indexes, entry, 'default', diagnostics);
  if (diagnostics.length > 0) throw new RouterModuleLinkError(`Project root resolution failed with ${diagnostics.length} diagnostic(s).`, diagnostics, { entry: entry.path });
  return Object.freeze({ root, indexes: built.indexes });
}

module.exports = Object.freeze({
  ROUTER_MODULE_LINKER_VERSION,
  RouterModuleLinkError,
  linkProjectPlainHandler,
  linkProjectRouterModules,
  resolveProjectRoot,
  wrappersForExpression
});
