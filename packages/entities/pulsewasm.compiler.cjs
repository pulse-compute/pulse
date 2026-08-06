'use strict';

const path = require('node:path');

const phaseName = 'entities-lowering-plan';

function loadContract(subpath, fallback) {
  try {
    return require(`@pulse-compute/wasm-contracts/${subpath}`);
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require(fallback);
    }
    throw error;
  }
}

const {
  normalizeArtifact,
  normalizeDiagnostic,
  sourceLoc,
  stableFileName
} = loadContract('diagnostics', '../../wasm/packages/contracts/src/diagnostics.js');
const entitiesContracts = loadContract('entities/contracts', '../../wasm/packages/contracts/src/entities/contracts.js');
const entitiesCatalogContracts = loadContract('entities/catalog', '../../wasm/packages/contracts/src/entities/catalog.js');
const packageContracts = loadContract('package/package-contract', '../../wasm/packages/contracts/src/package/package-contract.js');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function loadTypeScript(inputs = {}) {
  if (inputs.typescript) return inputs.typescript;
  if (inputs.ts) return inputs.ts;
  try {
    return require('typescript');
  } catch (error) {
    const diagnostic = normalizeDiagnostic({
      phase: phaseName,
      severity: 'error',
      code: 'PULSE_ENTITIES_TYPESCRIPT_REQUIRED',
      message: 'Entities declaration extraction requires the synchronized TypeScript parser.',
      hint: 'Run the first-party lowerer from the restored Pulse workspace toolchain.',
      loc: { file: '<entities-lowering-plan>' }
    });
    const thrown = new Error(diagnostic.message);
    thrown.diagnostics = [diagnostic];
    throw thrown;
  }
}

function sourceFileFromInputs(ts, inputs) {
  if (inputs.sourceFile) return inputs.sourceFile;
  const sourceText = inputs.sourceText === undefined ? '' : String(inputs.sourceText);
  const sourcePath = inputs.sourcePath || '<entities-lowering-plan>';
  return ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    /\.[cm]?tsx?$/.test(sourcePath) ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );
}

function unwrapExpression(ts, node) {
  let current = node;
  while (
    current
    && (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression && ts.isSatisfiesExpression(current)
    )
  ) current = current.expression;
  return current;
}

function rangeFor(sourceFile, node) {
  return Object.freeze({
    start: node && typeof node.getStart === 'function' ? node.getStart(sourceFile) : 0,
    end: node && typeof node.getEnd === 'function' ? node.getEnd() : 0
  });
}

function positionFor(sourceFile, node) {
  const offset = node && typeof node.getStart === 'function' ? node.getStart(sourceFile) : 0;
  const point = sourceFile.getLineAndCharacterOfPosition(offset);
  return Object.freeze({ line: point.line + 1, column: point.character + 1, offset });
}

function locFor(sourceFile, node) {
  return node ? sourceLoc(sourceFile, node) : { file: sourceFile.fileName };
}

function makeDiagnostic(sourceFile, node, code, message, hint, details) {
  return normalizeDiagnostic({
    phase: phaseName,
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: locFor(sourceFile, node)
  });
}

function hasErrors(diagnostics) {
  return diagnostics.some((entry) => String(entry.severity || 'error') === 'error');
}

function propertyName(ts, node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return String(node.text);
  return undefined;
}

function literalString(ts, node) {
  const current = unwrapExpression(ts, node);
  return current && (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current))
    ? current.text
    : undefined;
}

function literalBoolean(ts, node) {
  const current = unwrapExpression(ts, node);
  if (!current) return undefined;
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function literalNumber(ts, node) {
  const current = unwrapExpression(ts, node);
  if (!current) return undefined;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(current.operand)) {
    return -Number(current.operand.text);
  }
  return undefined;
}

function objectMembers(ts, sourceFile, node, allowed, diagnostics, code, subject) {
  const current = unwrapExpression(ts, node);
  if (!current || !ts.isObjectLiteralExpression(current)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current || node,
      code,
      `${subject} must be an inline static object literal.`,
      `Inline ${subject.toLowerCase()} without spreads, computed names, methods, accessors, or runtime values.`
    ));
    return new Map();
  }
  const output = new Map();
  for (const member of current.properties) {
    if (!ts.isPropertyAssignment(member)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        member,
        code,
        `${subject} contains an unsupported dynamic property form.`,
        'Use ordinary static property assignments only.'
      ));
      continue;
    }
    const name = propertyName(ts, member.name);
    if (!name || name === '__proto__' || !allowed.has(name) || output.has(name)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        member.name,
        code,
        `${subject} contains an unsupported or duplicate property.`,
        `Use each supported property at most once: ${[...allowed].sort().join(', ')}.`,
        { property: name || '<computed>' }
      ));
      continue;
    }
    output.set(name, member.initializer);
  }
  return output;
}

function staticJsonValue(ts, sourceFile, node, diagnostics, depth = 0) {
  const current = unwrapExpression(ts, node);
  const code = entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.METADATA_INVALID;
  if (!current || depth > entitiesContracts.ENTITIES_DEFAULT_LIMITS.maxMetadataDepth + 1) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current || node,
      code,
      'Entity metadata exceeds the static extraction depth limit.',
      'Reduce metadata nesting and keep it within the package-owned bound.'
    ));
    return { ok: false };
  }
  if (current.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  const text = literalString(ts, current);
  if (text !== undefined) return { ok: true, value: text };
  const boolean = literalBoolean(ts, current);
  if (boolean !== undefined) return { ok: true, value: boolean };
  const number = literalNumber(ts, current);
  if (number !== undefined) {
    if (Number.isFinite(number)) return { ok: true, value: number };
    diagnostics.push(makeDiagnostic(sourceFile, current, code, 'Entity metadata numbers must be finite.', 'Use a finite number literal.'));
    return { ok: false };
  }
  if (ts.isArrayLiteralExpression(current)) {
    const values = [];
    let ok = true;
    for (const element of current.elements) {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
        diagnostics.push(makeDiagnostic(sourceFile, element, code, 'Entity metadata arrays must be dense and contain no spreads.', 'List every static JSON value explicitly.'));
        ok = false;
        continue;
      }
      const parsed = staticJsonValue(ts, sourceFile, element, diagnostics, depth + 1);
      ok = parsed.ok && ok;
      if (parsed.ok) values.push(parsed.value);
    }
    return ok ? { ok: true, value: values } : { ok: false };
  }
  if (ts.isObjectLiteralExpression(current)) {
    const value = {};
    const names = new Set();
    let ok = true;
    for (const member of current.properties) {
      if (!ts.isPropertyAssignment(member)) {
        diagnostics.push(makeDiagnostic(sourceFile, member, code, 'Entity metadata objects accept ordinary static properties only.', 'Remove spreads, shorthand properties, methods, accessors, and computed names.'));
        ok = false;
        continue;
      }
      const name = propertyName(ts, member.name);
      if (!name || name === '__proto__' || names.has(name)) {
        diagnostics.push(makeDiagnostic(sourceFile, member.name, code, 'Entity metadata keys must be unique static strings.', 'Use one ordinary string key per metadata field.'));
        ok = false;
        continue;
      }
      names.add(name);
      const parsed = staticJsonValue(ts, sourceFile, member.initializer, diagnostics, depth + 1);
      ok = parsed.ok && ok;
      if (parsed.ok) value[name] = parsed.value;
    }
    return ok ? { ok: true, value } : { ok: false };
  }
  diagnostics.push(makeDiagnostic(
    sourceFile,
    current,
    code,
    'Entity metadata must contain static JSON values only.',
    'Replace runtime expressions with bounded literal strings, finite numbers, booleans, null, arrays, or objects.'
  ));
  return { ok: false };
}

function contractValue(sourceFile, node, diagnostics, fallbackCode, callback) {
  try {
    return callback();
  } catch (error) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      error && error.code || fallbackCode,
      error && error.message || 'Entity declaration is invalid.',
      'Use the frozen bounded Entities declaration contract.',
      error && error.detail
    ));
    return undefined;
  }
}

function collectFacadeBindings(ts, sourceFile, manifest, diagnostics) {
  const bindings = {
    routers: new Set(),
    adapters: new Set(),
    imports: []
  };
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const moduleName = literalString(ts, statement.moduleSpecifier);
    if (moduleName !== manifest.lowerableSubpath) continue;
    const clause = statement.importClause;
    if (clause.name) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        clause.name,
        entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_STATIC_REQUIRED,
        'The Entities lowerer does not accept a default package import.',
        'Use named package-root imports; local aliases on named imports are supported.'
      ));
    }
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        named.name,
        entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_STATIC_REQUIRED,
        'The Entities lowerer does not accept namespace imports.',
        'Import EntityRouter and jsonRpc by name; local aliases are supported.'
      ));
    }
    if (named && ts.isNamedImports(named)) {
      for (const specifier of named.elements) {
        if (specifier.isTypeOnly) continue;
        const imported = specifier.propertyName ? specifier.propertyName.text : specifier.name.text;
        const local = specifier.name.text;
        if (imported === 'EntityRouter') bindings.routers.add(local);
        else if (imported === 'jsonRpc') bindings.adapters.add(local);
        else diagnostics.push(makeDiagnostic(
          sourceFile,
          specifier.name,
          entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.REGISTRATION_UNSUPPORTED,
          `Runtime import ${JSON.stringify(imported)} is outside the Entities lowerable surface.`,
          'Use import type for erased types and named runtime imports for EntityRouter and jsonRpc only.'
        ));
        bindings.imports.push({ imported, local });
      }
    }
  }
  return bindings;
}

function sourceIdentity(sourceFile, cwd) {
  return String(stableFileName(sourceFile.fileName, cwd)).replace(/\\/g, '/');
}

function relativeHandlerIdentity(sourceFile, cwd, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const source = sourceIdentity(sourceFile, cwd);
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier));
  if (!joined || joined === '..' || joined.startsWith('../') || joined.startsWith('/')) return undefined;
  return joined.replace(/^\.\//, '');
}

function collectHandlerBindings(ts, sourceFile, cwd) {
  const handlers = new Map();
  const currentFile = sourceIdentity(sourceFile, cwd);
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause && !statement.importClause.isTypeOnly) {
      const moduleName = literalString(ts, statement.moduleSpecifier);
      if (!moduleName || moduleName === entitiesContracts.ENTITIES_LOWERABLE_SUBPATH) continue;
      const file = relativeHandlerIdentity(sourceFile, cwd, moduleName);
      const named = statement.importClause.namedBindings;
      if (!file || !named || !ts.isNamedImports(named)) continue;
      for (const specifier of named.elements) {
        if (specifier.isTypeOnly) continue;
        const exportName = specifier.propertyName ? specifier.propertyName.text : specifier.name.text;
        const localName = specifier.name.text;
        handlers.set(localName, { file, exportName, localName });
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const localName = statement.name.text;
      handlers.set(localName, { file: currentFile, exportName: localName, localName });
      continue;
    }
    if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = unwrapExpression(ts, declaration.initializer);
        if (
          ts.isIdentifier(declaration.name)
          && initializer
          && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          const localName = declaration.name.text;
          handlers.set(localName, { file: currentFile, exportName: localName, localName });
        }
      }
    }
  }
  return handlers;
}

function parseAdapter(ts, sourceFile, node, bindings, diagnostics) {
  const fallback = entitiesContracts.createJsonRpcAdapter();
  const current = unwrapExpression(ts, node);
  if (!current || !ts.isCallExpression(current)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current || node,
      entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_STATIC_REQUIRED,
      'EntityRouter adapter must be a direct call to the imported jsonRpc constructor.',
      'Use adapter: jsonRpc({ ...literalOptions }).'
    ));
    return fallback;
  }
  const callee = unwrapExpression(ts, current.expression);
  if (!callee || !ts.isIdentifier(callee) || !bindings.adapters.has(callee.text)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      callee || current,
      entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_UNSUPPORTED,
      'Only the first-party named jsonRpc adapter import is supported.',
      'Import jsonRpc from @pulse-compute/entities and call it directly.'
    ));
    return fallback;
  }
  if (current.arguments.length > 1) {
    diagnostics.push(makeDiagnostic(sourceFile, current, entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID, 'jsonRpc accepts at most one static options object.', 'Pass zero arguments or one inline options object.'));
    return fallback;
  }
  const options = {};
  if (current.arguments.length === 1) {
    const members = objectMembers(
      ts,
      sourceFile,
      current.arguments[0],
      new Set(['namedParamsOnly', 'acceptEmptyObjectForNoInput']),
      diagnostics,
      entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID,
      'JSON-RPC adapter options'
    );
    if (members.has('namedParamsOnly')) {
      const value = literalBoolean(ts, members.get('namedParamsOnly'));
      if (value === undefined) diagnostics.push(makeDiagnostic(sourceFile, members.get('namedParamsOnly'), entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID, 'namedParamsOnly must be the literal true.', 'Use namedParamsOnly: true.'));
      else options.namedParamsOnly = value;
    }
    if (members.has('acceptEmptyObjectForNoInput')) {
      const value = literalBoolean(ts, members.get('acceptEmptyObjectForNoInput'));
      if (value === undefined) diagnostics.push(makeDiagnostic(sourceFile, members.get('acceptEmptyObjectForNoInput'), entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID, 'acceptEmptyObjectForNoInput must be a boolean literal.', 'Use true or false directly.'));
      else options.acceptEmptyObjectForNoInput = value;
    }
  }
  return contractValue(
    sourceFile,
    current,
    diagnostics,
    entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_OPTIONS_INVALID,
    () => entitiesContracts.createJsonRpcAdapter(options)
  ) || fallback;
}

function parseRouterConstructor(ts, sourceFile, node, bindings, diagnostics) {
  const members = objectMembers(
    ts,
    sourceFile,
    node,
    new Set(['adapter']),
    diagnostics,
    entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_STATIC_REQUIRED,
    'EntityRouter options'
  );
  if (!members.has('adapter')) {
    diagnostics.push(makeDiagnostic(sourceFile, node, entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_STATIC_REQUIRED, 'EntityRouter options require adapter.', 'Declare adapter: jsonRpc({ ...literalOptions }).'));
    return entitiesContracts.createJsonRpcAdapter();
  }
  return parseAdapter(ts, sourceFile, members.get('adapter'), bindings, diagnostics);
}

function collectRouters(ts, sourceFile, bindings, diagnostics) {
  const routers = [];
  const recognized = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = unwrapExpression(ts, declaration.initializer);
      if (!initializer || !ts.isNewExpression(initializer)) continue;
      const constructor = unwrapExpression(ts, initializer.expression);
      if (!constructor || !ts.isIdentifier(constructor) || !bindings.routers.has(constructor.text)) continue;
      recognized.add(initializer);
      if (!(statement.declarationList.flags & ts.NodeFlags.Const) || !ts.isIdentifier(declaration.name)) {
        diagnostics.push(makeDiagnostic(sourceFile, declaration, entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_STATIC_REQUIRED, 'EntityRouter must be assigned to one module-level const identifier.', 'Declare const rpc = new EntityRouter({ adapter: jsonRpc() }).'));
        continue;
      }
      if (!initializer.arguments || initializer.arguments.length !== 1) {
        diagnostics.push(makeDiagnostic(sourceFile, initializer, entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_STATIC_REQUIRED, 'EntityRouter requires exactly one static options object.', 'Pass { adapter: jsonRpc(...) } directly.'));
      }
      const adapter = parseRouterConstructor(ts, sourceFile, initializer.arguments && initializer.arguments[0], bindings, diagnostics);
      routers.push({
        id: declaration.name.text,
        node: initializer,
        adapter,
        registrations: [],
        bindings: []
      });
    }
  }
  function visit(node) {
    if (ts.isNewExpression(node)) {
      const constructor = unwrapExpression(ts, node.expression);
      if (constructor && ts.isIdentifier(constructor) && bindings.routers.has(constructor.text) && !recognized.has(node)) {
        diagnostics.push(makeDiagnostic(sourceFile, node, entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.ADAPTER_STATIC_REQUIRED, 'EntityRouter construction is supported only in a module-level const declaration.', 'Move construction to module initialization.'));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (routers.length > 1) {
    for (const router of routers.slice(1)) diagnostics.push(makeDiagnostic(
      sourceFile,
      router.node,
      entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.REGISTRATION_UNSUPPORTED,
      'The first Entities lowering contract accepts one router per owning module.',
      'Move each router and its one transport binding into a separate owning module.'
    ));
  }
  return routers.slice(0, 1);
}

function parseDeclaration(ts, sourceFile, node, diagnostics) {
  const members = objectMembers(
    ts,
    sourceFile,
    node,
    new Set(['input', 'output', 'metadata']),
    diagnostics,
    entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID,
    'Entity declaration'
  );
  if (!members.has('input') || !members.has('output')) {
    diagnostics.push(makeDiagnostic(sourceFile, node, entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.SCHEMA_MISSING, 'Entity declarations require explicit input and output schema fields.', 'Use a declared schema ID literal or null for both fields.'));
    return undefined;
  }
  function schemaValue(name) {
    const candidate = unwrapExpression(ts, members.get(name));
    if (candidate && candidate.kind === ts.SyntaxKind.NullKeyword) return null;
    const value = literalString(ts, candidate);
    if (value === undefined) {
      diagnostics.push(makeDiagnostic(sourceFile, candidate || node, entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.SCHEMA_ID_INVALID, `Entity ${name} schema must be a literal registered ID or null.`, 'Use a dotted schema ID string literal or null.'));
      return undefined;
    }
    return value;
  }
  const input = schemaValue('input');
  const output = schemaValue('output');
  if (input === undefined || output === undefined) return undefined;
  let metadata;
  if (members.has('metadata')) {
    const parsed = staticJsonValue(ts, sourceFile, members.get('metadata'), diagnostics);
    if (!parsed.ok || !parsed.value || Array.isArray(parsed.value) || typeof parsed.value !== 'object') {
      if (parsed.ok) diagnostics.push(makeDiagnostic(sourceFile, members.get('metadata'), entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.METADATA_INVALID, 'Entity metadata root must be a static object literal.', 'Use an object with bounded static JSON values.'));
      return undefined;
    }
    metadata = parsed.value;
  }
  return contractValue(
    sourceFile,
    node,
    diagnostics,
    entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID,
    () => entitiesContracts.normalizeEntityDeclaration({ input, output, ...(metadata === undefined ? {} : { metadata }) })
  );
}

function schemaSets(schemaBundle) {
  if (!schemaBundle) return null;
  const registrySchemas = schemaBundle.registry && Array.isArray(schemaBundle.registry.schemas)
    ? schemaBundle.registry.schemas
    : [];
  const realized = new Set(registrySchemas.map((entry) => String(entry.id)));
  const declared = new Set(
    Array.isArray(schemaBundle.declaredSchemaIds)
      ? schemaBundle.declaredSchemaIds.map(String)
      : (Array.isArray(schemaBundle.schemaIds) ? schemaBundle.schemaIds.map(String) : [...realized])
  );
  return { declared, realized };
}

function validateSchemaReference(sourceFile, node, id, usage, capability, sets, diagnostics) {
  if (id === null) return undefined;
  if (sets && !sets.declared.has(id)) diagnostics.push(makeDiagnostic(
    sourceFile,
    node,
    entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.SCHEMA_MISSING,
    `Entity ${usage} schema ${JSON.stringify(id)} is not declared by pulse.schema.`,
    'Declare the schema in the selected project registry or correct the literal ID.',
    { usage, schemaId: id, declared: [...sets.declared].sort() }
  ));
  return Object.freeze({
    id,
    usage,
    capability,
    file: sourceFile.fileName,
    position: positionFor(sourceFile, node)
  });
}

function resolveHandler(ts, sourceFile, node, handlers, diagnostics) {
  const current = unwrapExpression(ts, node);
  if (!current || !ts.isIdentifier(current) || !handlers.has(current.text)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current || node,
      entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.HANDLER_UNRESOLVED,
      'Entity handler must be a statically resolvable module-level function or named relative import.',
      'Pass a named function declaration, a module-level const function, or a named import from a reachable project module.'
    ));
    return undefined;
  }
  return contractValue(
    sourceFile,
    current,
    diagnostics,
    entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.HANDLER_UNRESOLVED,
    () => entitiesContracts.normalizeHandlerReference(handlers.get(current.text))
  );
}

function routerCall(ts, call, routersById) {
  const expression = unwrapExpression(ts, call.expression);
  if (expression && ts.isPropertyAccessExpression(expression)) {
    const receiver = unwrapExpression(ts, expression.expression);
    if (receiver && ts.isIdentifier(receiver) && routersById.has(receiver.text)) {
      return { router: routersById.get(receiver.text), method: expression.name.text, computed: false };
    }
  }
  if (expression && ts.isElementAccessExpression(expression)) {
    const receiver = unwrapExpression(ts, expression.expression);
    const method = literalString(ts, expression.argumentExpression);
    if (receiver && ts.isIdentifier(receiver) && routersById.has(receiver.text) && ['on', 'handle'].includes(method)) {
      return { router: routersById.get(receiver.text), method, computed: true };
    }
  }
  return undefined;
}

function isModuleExpressionStatement(ts, sourceFile, call) {
  return ts.isExpressionStatement(call.parent) && call.parent.parent === sourceFile;
}

function functionLike(ts, node) {
  return Boolean(node && (
    ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
  ));
}

function enclosingFunction(ts, node) {
  let current = node && node.parent;
  while (current) {
    if (functionLike(ts, current)) return current;
    current = current.parent;
  }
  return undefined;
}

function directTerminalReturn(ts, call, fn) {
  let current = call;
  let parent = current.parent;
  while (parent && (
    ts.isParenthesizedExpression(parent)
    || ts.isAsExpression(parent)
    || ts.isNonNullExpression(parent)
    || ts.isSatisfiesExpression && ts.isSatisfiesExpression(parent)
  )) {
    current = parent;
    parent = parent.parent;
  }
  if (parent && ts.isReturnStatement(parent) && parent.expression === current) return true;
  return Boolean(fn && ts.isArrowFunction(fn) && fn.body === current);
}

function contextNameFor(ts, fn) {
  const first = fn && fn.parameters && fn.parameters[0];
  return first && ts.isIdentifier(first.name) ? first.name.text : undefined;
}

const BODY_METHODS = new Set(['arrayBuffer', 'bytes', 'formData', 'json', 'stream', 'text']);

function bodyConsumers(ts, fn, contextName) {
  const consumers = [];
  function visit(node) {
    if (node !== fn && functionLike(ts, node)) return;
    if (ts.isCallExpression(node)) {
      const expression = unwrapExpression(ts, node.expression);
      if (expression && ts.isPropertyAccessExpression(expression) && BODY_METHODS.has(expression.name.text)) {
        const owner = unwrapExpression(ts, expression.expression);
        if (owner && ts.isPropertyAccessExpression(owner)) {
          const root = unwrapExpression(ts, owner.expression);
          if (root && ts.isIdentifier(root) && root.text === contextName && ['req', 'request'].includes(owner.name.text)) consumers.push(node);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  if (fn && fn.body) visit(fn.body);
  return consumers;
}

function parseRegistration(ts, sourceFile, call, router, handlers, schemaState, diagnostics) {
  if (!isModuleExpressionStatement(ts, sourceFile, call)) {
    diagnostics.push(makeDiagnostic(sourceFile, call, entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.REGISTRATION_UNSUPPORTED, 'Entity registrations must be standalone module-level statements.', 'Move rpc.on(...) out of functions, conditions, loops, and chains.'));
    return;
  }
  if (call.arguments.length !== 3) {
    diagnostics.push(makeDiagnostic(sourceFile, call, entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'rpc.on(...) requires discriminator, declaration, and handler arguments.', 'Pass exactly three static arguments.'));
    return;
  }
  const discriminator = literalString(ts, call.arguments[0]);
  if (discriminator === undefined) {
    diagnostics.push(makeDiagnostic(sourceFile, call.arguments[0], entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.DISCRIMINATOR_STATIC_REQUIRED, 'Entity discriminator must be a string literal.', 'Inline one non-empty bounded discriminator string.'));
    return;
  }
  const normalizedDiscriminator = contractValue(
    sourceFile,
    call.arguments[0],
    diagnostics,
    entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.DISCRIMINATOR_INVALID,
    () => entitiesContracts.normalizeDiscriminator(discriminator, router.adapter.limits)
  );
  const declaration = parseDeclaration(ts, sourceFile, call.arguments[1], diagnostics);
  const handler = resolveHandler(ts, sourceFile, call.arguments[2], handlers, diagnostics);
  if (normalizedDiscriminator === undefined || !declaration || !handler) return;
  if (router.registrations.some((entry) => entry.discriminator === normalizedDiscriminator)) {
    diagnostics.push(makeDiagnostic(sourceFile, call.arguments[0], entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.DISCRIMINATOR_DUPLICATE, `Entity discriminator ${JSON.stringify(normalizedDiscriminator)} is already registered.`, 'Use one unique discriminator per router.'));
    return;
  }
  const inputReference = validateSchemaReference(sourceFile, call.arguments[1], declaration.input, 'entity-input', 'schema.decode', schemaState, diagnostics);
  const outputReference = validateSchemaReference(sourceFile, call.arguments[1], declaration.output, 'entity-output', 'schema.encode', schemaState, diagnostics);
  router.registrations.push(Object.freeze({
    discriminator: normalizedDiscriminator,
    declaration,
    handler,
    schemaReferences: Object.freeze([inputReference, outputReference].filter(Boolean)),
    range: rangeFor(sourceFile, call),
    loc: locFor(sourceFile, call)
  }));
}

function parseBinding(ts, sourceFile, call, router, diagnostics) {
  const fn = enclosingFunction(ts, call);
  const contextName = contextNameFor(ts, fn);
  const argument = unwrapExpression(ts, call.arguments[0]);
  if (
    call.arguments.length !== 1
    || !fn
    || !contextName
    || !argument
    || !ts.isIdentifier(argument)
    || argument.text !== contextName
    || !directTerminalReturn(ts, call, fn)
  ) {
    diagnostics.push(makeDiagnostic(sourceFile, call, entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.BINDING_UNSUPPORTED, 'rpc.handle(ctx) must be returned directly from its current request-bound handler.', 'Use return rpc.handle(ctx) with the handler context as the sole argument.'));
    return;
  }
  const consumers = bodyConsumers(ts, fn, contextName);
  if (consumers.length > 0) diagnostics.push(makeDiagnostic(
    sourceFile,
    consumers[0],
    entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.BODY_CONSUMER_CONFLICT,
    'rpc.handle(ctx) cannot coexist with another request-body consumer in the same handler.',
    'Remove direct request-body reads; the selected Entities adapter owns the bounded body.'
  ));
  router.bindings.push(Object.freeze({
    call,
    contextName,
    range: rangeFor(sourceFile, call),
    loc: locFor(sourceFile, call)
  }));
}

function collectRouterCalls(ts, sourceFile, routers, handlers, schemaState, diagnostics) {
  const routersById = new Map(routers.map((router) => [router.id, router]));
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const resolved = routerCall(ts, node, routersById);
      if (resolved && resolved.computed) diagnostics.push(makeDiagnostic(
        sourceFile,
        node,
        resolved.method === 'on'
          ? entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.REGISTRATION_UNSUPPORTED
          : entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.BINDING_UNSUPPORTED,
        `Computed rpc[${JSON.stringify(resolved.method)}](...) syntax is not lowerable.`,
        `Call rpc.${resolved.method}(...) directly.`
      ));
      else if (resolved && resolved.method === 'on') parseRegistration(ts, sourceFile, node, resolved.router, handlers, schemaState, diagnostics);
      else if (resolved && resolved.method === 'handle') parseBinding(ts, sourceFile, node, resolved.router, diagnostics);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  for (const router of routers) {
    if (router.registrations.length > router.adapter.limits.maxEntities) diagnostics.push(makeDiagnostic(
      sourceFile,
      router.node,
      entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.LIMIT_EXCEEDED,
      'Entity router exceeds its registration limit.',
      `Declare at most ${router.adapter.limits.maxEntities} entities.`
    ));
    if (router.bindings.length !== 1) diagnostics.push(makeDiagnostic(
      sourceFile,
      router.node,
      entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.BINDING_UNSUPPORTED,
      router.bindings.length === 0
        ? 'EntityRouter requires exactly one terminal rpc.handle(ctx) binding.'
        : 'EntityRouter cannot be bound more than once.',
      'Keep one router instance per one request-bound transport handler.'
    ));
  }
}

function planForRouters(sourceFile, routers, diagnostics) {
  const input = {
    version: entitiesContracts.ENTITIES_PLAN_VERSION,
    contractId: entitiesContracts.ENTITIES_CONTRACT_ID,
    routers: routers.map((router) => ({
      id: router.id,
      adapter: router.adapter,
      binding: { kind: 'request' },
      entities: router.registrations.map((entry) => ({
        discriminator: entry.discriminator,
        inputSchema: entry.declaration.input,
        outputSchema: entry.declaration.output,
        handler: entry.handler,
        ...(entry.declaration.metadata === undefined ? {} : { metadata: entry.declaration.metadata })
      }))
    }))
  };
  return contractValue(
    sourceFile,
    routers[0] && routers[0].node || sourceFile,
    diagnostics,
    entitiesContracts.ENTITIES_DIAGNOSTIC_CODES.DECLARATION_INVALID,
    () => entitiesContracts.normalizeEntityPlan(input)
  ) || entitiesContracts.normalizeEntityPlan({
    version: entitiesContracts.ENTITIES_PLAN_VERSION,
    contractId: entitiesContracts.ENTITIES_CONTRACT_ID,
    routers: []
  });
}

function catalogForPlan(plan) {
  const eligibility = Object.freeze(Object.fromEntries(
    entitiesCatalogContracts.ENTITIES_CATALOG_TARGETS.map((target) => [target, true])
  ));
  return entitiesCatalogContracts.normalizeEntityCatalog({
    version: entitiesContracts.ENTITIES_CATALOG_VERSION,
    contractId: entitiesContracts.ENTITIES_CONTRACT_ID,
    routers: plan.routers.map((router) => ({
      id: router.id,
      adapter: router.adapter.id,
      binding: router.binding.kind,
      entities: router.entities.map((entry) => ({
        name: entry.discriminator,
        inputSchema: entry.inputSchema,
        outputSchema: entry.outputSchema,
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
        eligibility
      }))
    }))
  });
}

const entityTargetEvidence = Object.freeze({
  'fastly-javascript': Object.freeze({
    target: 'fastly-javascript',
    eligible: true,
    evidence: 'measured-execution',
    runtimeExecutionMeasured: true,
    providerRealityValidated: true,
    externalProviderExecution: true,
    realization: 'javascript-package-runtime',
    evidenceTask: 'entities-cross-target',
    evidenceEngine: 'viceroy 0.20.1',
    reasonCode: 'PULSE_ENTITIES_FASTLY_JAVASCRIPT_VICEROY_MEASURED'
  }),
  'fastly-native': Object.freeze({
    target: 'fastly-native',
    eligible: true,
    evidence: 'measured-execution',
    runtimeExecutionMeasured: true,
    providerRealityValidated: true,
    externalProviderExecution: true,
    realization: 'provider-owned-native-adapter',
    evidenceTask: 'entities-cross-target',
    evidenceEngine: 'viceroy 0.20.1',
    reasonCode: 'PULSE_ENTITIES_FASTLY_NATIVE_VICEROY_MEASURED'
  }),
  'node-javascript': Object.freeze({
    target: 'node-javascript',
    eligible: true,
    evidence: 'measured-execution',
    runtimeExecutionMeasured: true,
    providerRealityValidated: false,
    externalProviderExecution: false,
    realization: 'javascript-package-runtime',
    evidenceTask: 'entities-cross-target',
    reasonCode: 'PULSE_ENTITIES_NODE_JAVASCRIPT_FOUR_MODE_MEASURED'
  }),
  'node-native': Object.freeze({
    target: 'node-native',
    eligible: true,
    evidence: 'measured-execution',
    runtimeExecutionMeasured: true,
    providerRealityValidated: false,
    externalProviderExecution: false,
    realization: 'canonical-package-native-source',
    evidenceTask: 'entities-cross-target',
    reasonCode: 'PULSE_ENTITIES_NODE_NATIVE_FOUR_MODE_MEASURED'
  })
});

function inspectionForPlan(plan, catalog) {
  return deepFreeze({
    version: 'pulse.entities-inspection.v1',
    contractId: entitiesContracts.ENTITIES_CONTRACT_ID,
    package: entitiesContracts.ENTITIES_PACKAGE_NAME,
    declaration: 'statically-declared',
    planHash: plan.planHash,
    catalogHash: catalog.catalogHash,
    routers: plan.routers.map((router) => ({
      id: router.id,
      adapter: {
        id: router.adapter.id,
        version: router.adapter.version,
        adapterVersion: router.adapter.adapterVersion,
        options: router.adapter.options
      },
      binding: router.binding.kind,
      entities: router.entities.map((entry) => ({
        name: entry.discriminator,
        schemas: { input: entry.inputSchema, output: entry.outputSchema },
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
        handler: {
          file: entry.handler.file,
          exportName: entry.handler.exportName
        }
      }))
    })),
    targets: Object.freeze(Object.fromEntries(
      entitiesCatalogContracts.ENTITIES_CATALOG_TARGETS.map((target) => [target, entityTargetEvidence[target]])
    )),
    diagnostics: Object.freeze([]),
    policy: Object.freeze({
      declarationSeparateFromEligibility: true,
      eligibilitySeparateFromMeasuredExecution: true,
      nodeExecutionMeasured: true,
      fastlyCompileOnly: false,
      fastlyExternalExecutionClaimed: true,
      fourModeExecutionMeasured: true,
      providerRealityValidated: true,
      runtimeValuesExcluded: true,
      rawPayloadsExcluded: true,
      rawRequestIdsExcluded: true,
      resolvedSecretsExcluded: true,
      providerObjectsExcluded: true,
      automaticFallback: false
    })
  });
}

function managedHandlerDescriptor(entry) {
  const start = entry.loc && entry.loc.start || { line: 1, column: 1 };
  return deepFreeze({
    version: packageContracts.PACKAGE_MANAGED_HANDLER_DESCRIPTOR_VERSION,
    id: `${entry.loc.file}#${entry.router}:${entry.discriminator}`,
    role: 'schema-operation',
    origin: { file: entry.loc.file, line: start.line, column: start.column },
    source: {
      file: entry.handler.file,
      exportName: entry.handler.exportName,
      localName: entry.handler.localName
    },
    input: {
      kind: entry.inputSchema === null ? 'empty-value' : 'schema-value',
      schemaId: entry.inputSchema
    },
    result: {
      kind: entry.outputSchema === null ? 'completion' : 'schema-value',
      schemaId: entry.outputSchema
    }
  });
}

function intrinsicForBinding(sourceFile, binding, plan) {
  const descriptor = entitiesContracts.ENTITIES_PACKAGE_INTRINSICS.handle;
  return Object.freeze({
    version: packageContracts.PACKAGE_INTRINSIC_VERSION,
    contractId: entitiesContracts.ENTITIES_CONTRACT_ID,
    package: entitiesContracts.ENTITIES_PACKAGE_NAME,
    import: entitiesContracts.ENTITIES_LOWERABLE_SUBPATH,
    kind: 'entities.handle',
    operation: 'handle',
    intrinsic: descriptor.name,
    packageIntrinsic: descriptor.name,
    compilerName: descriptor.compilerName,
    valueKind: descriptor.valueKind,
    argumentIndexes: descriptor.argumentIndexes,
    staticArguments: Object.freeze([plan]),
    range: binding.range,
    loc: binding.loc || locFor(sourceFile, binding.call)
  });
}

function createEntitiesPackageCompilerBuilder(inputs = {}) {
  const ts = loadTypeScript(inputs);
  const sourceFile = sourceFileFromInputs(ts, inputs);
  const manifest = inputs.manifest || require('./pulsewasm.manifest.cjs');
  const diagnostics = [];
  const bindings = collectFacadeBindings(ts, sourceFile, manifest, diagnostics);
  const handlers = collectHandlerBindings(ts, sourceFile, inputs.cwd || process.cwd());
  const routers = collectRouters(ts, sourceFile, bindings, diagnostics);
  collectRouterCalls(ts, sourceFile, routers, handlers, schemaSets(inputs.schemaBundle), diagnostics);

  const plan = planForRouters(sourceFile, routers, diagnostics);
  const catalog = catalogForPlan(plan);
  const inspection = inspectionForPlan(plan, catalog);
  const schemaReferences = routers.flatMap((router) => router.registrations.flatMap((entry) => entry.schemaReferences));
  const canonicalIntrinsics = routers.flatMap((router) => (
    router.bindings.length === 1 ? [intrinsicForBinding(sourceFile, router.bindings[0], plan)] : []
  ));
  const realizationArtifacts = Object.freeze([deepFreeze({
    version: 'pulse.entities-native-builder-descriptor.v1',
    id: 'pulse-entities-native-as',
    contractId: entitiesContracts.ENTITIES_CONTRACT_ID,
    package: entitiesContracts.ENTITIES_PACKAGE_NAME,
    kind: 'package-native-source-builder',
    mediaType: 'application/vnd.pulse.entities-native-builder+json',
    data: Object.freeze({
      entry: './pulsewasm.native.cjs',
      export: 'buildEntitiesNativeSource',
      sourceVersion: 'pulse.entities-native-source.v1',
      managedHandlerNativeBundleVersion: 'pulse.managed-handler-native-bundle.v1',
      packageTargetPromoted: true,
      automaticFallback: false
    })
  })]);
  const artifact = deepFreeze(normalizeArtifact({
    version: entitiesContracts.ENTITIES_PLAN_VERSION,
    generatedBy: inputs.generatedBy || entitiesContracts.ENTITIES_LOWERER_ID,
    phase: phaseName,
    contractId: entitiesContracts.ENTITIES_CONTRACT_ID,
    package: entitiesContracts.ENTITIES_PACKAGE_NAME,
    lowerableSubpath: manifest.lowerableSubpath,
    status: hasErrors(diagnostics) ? 'error' : 'ok',
    source: sourceFile.fileName,
    manifest: {
      version: manifest.version,
      contractId: manifest.contractId,
      package: manifest.npmPackage,
      builderOwner: manifest.compiler && manifest.compiler.builderOwner,
      builderTrust: manifest.compiler && manifest.compiler.trust,
      mode: manifest.modes && manifest.modes.wasm && manifest.modes.wasm.mode,
      sidecarStatus: manifest.modes && manifest.modes.wasm && manifest.modes.wasm.sidecarStatus
    },
    plan,
    catalog,
    inspection,
    entries: routers.flatMap((router) => router.registrations.map((entry) => ({
      router: router.id,
      discriminator: entry.discriminator,
      handler: entry.handler,
      inputSchema: entry.declaration.input,
      outputSchema: entry.declaration.output,
      range: entry.range,
      loc: entry.loc
    }))),
    canonicalIntrinsics,
    schemaReferences,
    realizationArtifacts,
    diagnostics,
    policy: {
      packageOwnsRecognition: true,
      compilerOwnsPackageMapping: false,
      namedImportAliasesSupported: true,
      namespaceImportsSupported: false,
      defaultImportsSupported: false,
      staticModuleRegistrationsOnly: true,
      oneRouterPerOwningModule: true,
      terminalBindingOnly: true,
      routeTopologySymbolsRequired: false,
      providerNeutral: true,
      nativeDispatcherImplemented: true,
      nativeSourceGeneratorImplemented: true,
      javascriptDispatcherImplemented: true,
      packageTargetPromoted: true,
      automaticFallback: false
    },
    summary: {
      routers: plan.routers.length,
      entities: plan.routers.reduce((sum, router) => sum + router.entities.length, 0),
      intrinsics: canonicalIntrinsics.length,
      schemaReferences: schemaReferences.length,
      nativeSourceBuilders: realizationArtifacts.length,
      inspectionArtifacts: 2,
      errors: diagnostics.filter((entry) => String(entry.severity || 'error') === 'error').length
    }
  }, inputs.cwd || process.cwd()));

  const managedHandlers = Object.freeze(artifact.entries.map(managedHandlerDescriptor)
    .sort((left, right) => left.id.localeCompare(right.id)));
  const inspectionArtifacts = Object.freeze([
    deepFreeze({
      version: packageContracts.PACKAGE_INSPECTION_ARTIFACT_VERSION,
      id: entitiesContracts.ENTITIES_CATALOG_VERSION,
      contractId: entitiesContracts.ENTITIES_CONTRACT_ID,
      package: entitiesContracts.ENTITIES_PACKAGE_NAME,
      kind: 'deterministic-catalog',
      mediaType: 'application/json',
      file: 'entities-catalog.json',
      data: artifact.catalog
    }),
    deepFreeze({
      version: packageContracts.PACKAGE_INSPECTION_ARTIFACT_VERSION,
      id: 'pulse.entities-inspection.v1',
      contractId: entitiesContracts.ENTITIES_CONTRACT_ID,
      package: entitiesContracts.ENTITIES_PACKAGE_NAME,
      kind: 'declaration-and-target-evidence',
      mediaType: 'application/json',
      file: 'entities-inspection.json',
      data: artifact.inspection
    })
  ]);

  return Object.freeze({
    artifact,
    entries: Object.freeze(artifact.entries),
    canonicalEffects: Object.freeze([]),
    canonicalIntrinsics: Object.freeze(canonicalIntrinsics),
    schemaReferences: Object.freeze(schemaReferences),
    realizationArtifacts,
    inspectionArtifacts,
    managedHandlers,
    diagnostics: Object.freeze(diagnostics),
    warnings: Object.freeze([]),
    manifest,
    dependencies: Object.freeze([]),
    hasErrors: hasErrors(diagnostics)
  });
}

const entitiesLoweringBuilder = Object.freeze({
  name: 'entities-lowering-builder',
  owner: entitiesContracts.ENTITIES_PACKAGE_NAME,
  trust: 'first-party',
  version: entitiesContracts.ENTITIES_PLAN_VERSION,
  build: createEntitiesPackageCompilerBuilder
});

module.exports = Object.freeze({
  createEntitiesPackageCompilerBuilder,
  buildEntitiesLoweringPlan: createEntitiesPackageCompilerBuilder,
  entitiesLoweringBuilder,
  ENTITIES_DIAGNOSTIC_CODES: entitiesContracts.ENTITIES_DIAGNOSTIC_CODES
});
