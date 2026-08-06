'use strict';

const path = require('node:path');
const ts = require('typescript');
const {
  buildPlainHandlerIr,
  handlerIrSnapshot
} = require('./handler-ir.js');
const {
  normalizeManagedHandler
} = require('./async-surface-normalizer.js');
const {
  extractKvNamespaceDeclaration,
  recognizeHandlerSurface
} = require('./handler-surface-authority.js');
const {
  PACKAGE_OPERATION_RECOGNITION_VERSION,
  lowerCanonicalPackageOperations
} = require('./package-operation-seam.js');
const {
  collectProviderRequirements
} = require('./provider-requirement-authority.js');
const {
  projectGraphContext,
  resolutionForImport
} = require('../project/reachable-graph-builder.js');
const {
  sha256Hex,
  stableStringify
} = require('../stable-id.js');
const {
  PACKAGE_MANAGED_HANDLER_DESCRIPTOR_VERSION
} = require('@pulse-compute/wasm-contracts/package/package-contract');

function loadCanonicalNativePlanContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-native-plan'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../contracts/src/handler/canonical-native-plan.js');
    }
    throw error;
  }
}

const canonicalNativePlanContract = loadCanonicalNativePlanContract();

const managedHandlerDescriptorVersion = PACKAGE_MANAGED_HANDLER_DESCRIPTOR_VERSION;
const managedHandlerIrVersion = 'pulse.managed-handler-ir.v2';
const managedHandlerIrBundleVersion = 'pulse.managed-handler-ir-bundle.v2';
const managedHandlerEffectPlanVersion = 'pulse.managed-handler-effect-plan.v1';
const managedHandlerReachabilityVersion = 'pulse.managed-handler-reachability.v1';
const managedHandlerNativeFactsVersion = 'pulse.managed-handler-native-facts.v1';
const managedHandlerNativeBundleVersion = 'pulse.managed-handler-native-bundle.v1';
const MANAGED_HANDLER_ROLE = 'schema-operation';
const managedHandlerInputKinds = Object.freeze(['schema-value', 'empty-value']);
const managedHandlerResultKinds = Object.freeze(['schema-value', 'completion']);
const managedHandlerOperationKinds = Object.freeze([
  'block',
  'local',
  'if',
  'effect',
  'parallel',
  'logging',
  'schema-result',
  'completion',
  'rejected'
]);

const ASSIGNMENT_OPERATORS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '&=', '|=', '^=', '<<=', '>>=', '>>>='
]);
const PURE_BINARY_OPERATORS = new Set([
  '===', '!==', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', '**',
  '&&', '||', '??', '&', '|', '^', '<<', '>>', '>>>', 'in'
]);
const PURE_PREFIX_OPERATORS = new Set(['!', '+', '-', '~', 'typeof', 'void']);
const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

const canonicalHandlerIr = new WeakMap();
const managedHandlerNativeFacts = new WeakMap();

class ManagedHandlerCompileError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'ManagedHandlerCompileError';
    this.code = 'PULSE_MANAGED_HANDLER_COMPILE_FAILED';
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string.`);
  return value.trim();
}

function portableFile(value, field) {
  const input = requiredString(value, field).replace(/\\/g, '/');
  const normalized = path.posix.normalize(input).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new TypeError(`${field} must be a contained portable file path.`);
  }
  return normalized;
}

function sourcePoint(input, field) {
  if (input == null) return undefined;
  if (!isPlainObject(input)) throw new TypeError(`${field} must be an object.`);
  const line = Number(input.line || 1);
  const column = Number(input.column || 1);
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
    throw new TypeError(`${field} line and column must be positive safe integers.`);
  }
  return Object.freeze({
    file: portableFile(input.file, `${field}.file`),
    line,
    column
  });
}

function normalizeSchemaBinding(input, field, emptyKind, valueKind) {
  if (!isPlainObject(input)) throw new TypeError(`${field} must be an object.`);
  const schemaId = input.schemaId == null ? null : requiredString(input.schemaId, `${field}.schemaId`);
  const kind = input.kind == null ? (schemaId === null ? emptyKind : valueKind) : requiredString(input.kind, `${field}.kind`);
  const allowed = field === 'input' ? managedHandlerInputKinds : managedHandlerResultKinds;
  if (!allowed.includes(kind)) throw new TypeError(`${field}.kind must be one of ${allowed.join(', ')}.`);
  if ((kind === valueKind) !== (schemaId !== null)) {
    throw new TypeError(`${field} must pair ${valueKind} with one schemaId and ${emptyKind} with null.`);
  }
  return Object.freeze({ kind, schemaId });
}

function normalizeDescriptor(input, index) {
  if (!isPlainObject(input)) throw new TypeError(`descriptors[${index}] must be an object.`);
  if (input.version !== managedHandlerDescriptorVersion) {
    throw new TypeError(`descriptors[${index}].version must be ${managedHandlerDescriptorVersion}.`);
  }
  if (input.role !== MANAGED_HANDLER_ROLE) {
    throw new TypeError(`descriptors[${index}].role must be ${MANAGED_HANDLER_ROLE}.`);
  }
  if (!isPlainObject(input.source)) throw new TypeError(`descriptors[${index}].source must be an object.`);
  const origin = sourcePoint(input.origin, `descriptors[${index}].origin`);
  return Object.freeze({
    version: managedHandlerDescriptorVersion,
    id: requiredString(input.id, `descriptors[${index}].id`),
    role: MANAGED_HANDLER_ROLE,
    origin,
    source: Object.freeze({
      file: portableFile(input.source.file, `descriptors[${index}].source.file`),
      exportName: requiredString(input.source.exportName, `descriptors[${index}].source.exportName`),
      localName: requiredString(input.source.localName, `descriptors[${index}].source.localName`)
    }),
    input: normalizeSchemaBinding(input.input, `input`, 'empty-value', 'schema-value'),
    result: normalizeSchemaBinding(input.result, `result`, 'completion', 'schema-value')
  });
}

function positionFor(sourceFile, node, fallback) {
  const candidates = [
    node,
    node && node.expression,
    node && node.statements && node.statements[0],
    node && ts.getOriginalNode(node)
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!sourceFile || typeof candidate.getStart !== 'function' || candidate.pos < 0) continue;
    try {
      const offset = candidate.getStart(sourceFile);
      const point = sourceFile.getLineAndCharacterOfPosition(offset);
      return Object.freeze({ line: point.line + 1, column: point.character + 1, offset });
    } catch (_) {
      // Synthetic wrapper nodes use the descriptor/source fallback below.
    }
  }
  return Object.freeze({
    line: fallback && fallback.line || 1,
    column: fallback && fallback.column || 1,
    offset: 0
  });
}

function diagnostic(options) {
  const fallback = options.fallback || options.descriptor && options.descriptor.origin;
  return Object.freeze({
    code: String(options.code),
    kind: 'ManagedHandlerCompileDiagnostic',
    severity: 'error',
    message: String(options.message),
    file: options.sourceFile && options.sourceFile.fileName || fallback && fallback.file || '<managed-handler>',
    position: positionFor(options.sourceFile, options.node, fallback),
    detail: Object.freeze({
      ...(options.descriptor ? { descriptorId: options.descriptor.id } : {}),
      ...(options.detail || {})
    })
  });
}

function normalizeDiagnostics(entries) {
  return Object.freeze([...entries].sort((left, right) => (
    String(left.file || '').localeCompare(String(right.file || ''))
    || Number(left.position && left.position.line || 0) - Number(right.position && right.position.line || 0)
    || Number(left.position && left.position.column || 0) - Number(right.position && right.position.column || 0)
    || String(left.code).localeCompare(String(right.code))
    || String(left.message).localeCompare(String(right.message))
  )));
}

function modulePathCandidates(input) {
  const value = portableFile(input, 'handler source file');
  const extension = path.posix.extname(value);
  const stem = extension ? value.slice(0, -extension.length) : value;
  const candidates = new Set([value]);
  if (extension) for (const next of SOURCE_EXTENSIONS) candidates.add(`${stem}${next}`);
  else for (const next of SOURCE_EXTENSIONS) candidates.add(`${value}${next}`);
  for (const next of SOURCE_EXTENSIONS) candidates.add(path.posix.join(stem, `index${next}`));
  return candidates;
}

function findModulePath(input, available) {
  const matches = [...modulePathCandidates(input)].filter((candidate) => available.has(candidate));
  return Object.freeze({ matches: Object.freeze(matches.sort()), selected: matches.length === 1 ? matches[0] : undefined });
}

function unwrap(node) {
  let current = node;
  while (current && (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isSatisfiesExpression?.(current)
    || ts.isPartiallyEmittedExpression(current)
  )) current = current.expression;
  return current;
}

function functionDeclarations(sourceFile, localName) {
  const matches = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.name.text === localName) {
      matches.push(Object.freeze({ functionNode: statement, declaration: statement }));
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== localName || !declaration.initializer) continue;
      const initializer = unwrap(declaration.initializer);
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        matches.push(Object.freeze({ functionNode: initializer, declaration }));
      }
    }
  }
  return matches;
}

function resolveDescriptors(graphBuild, descriptors, diagnostics) {
  const context = projectGraphContext(graphBuild);
  if (!context || !graphBuild.graph || !Array.isArray(graphBuild.graph.modules)) {
    throw new TypeError('compileManagedHandlerDescriptors requires one completed reachable project graph build.');
  }
  const graphModules = new Map(graphBuild.graph.modules.filter((entry) => entry.kind === 'project').map((entry) => [entry.path, entry]));
  const available = new Set(graphModules.keys());
  const resolved = [];

  for (const descriptor of descriptors) {
    const ownerMatch = findModulePath(descriptor.origin.file, available);
    if (!ownerMatch.selected) {
      diagnostics.push(diagnostic({
        descriptor,
        code: ownerMatch.matches.length > 1 ? 'PULSE_MANAGED_HANDLER_OWNER_AMBIGUOUS' : 'PULSE_MANAGED_HANDLER_OWNER_UNREACHABLE',
        message: ownerMatch.matches.length > 1
          ? `Managed handler owner ${descriptor.origin.file} is ambiguous in the reachable graph.`
          : `Managed handler owner ${descriptor.origin.file} is not present in the reachable graph.`,
        detail: { candidates: ownerMatch.matches }
      }));
      continue;
    }

    const ownerPath = ownerMatch.selected;
    let targetPath;
    let importedResolution;
    const localTarget = findModulePath(descriptor.source.file, available);
    if (localTarget.selected === ownerPath) {
      targetPath = ownerPath;
    } else {
      importedResolution = resolutionForImport(graphBuild, ownerPath, descriptor.source.localName);
      if (importedResolution && available.has(importedResolution.targetKey)) targetPath = importedResolution.targetKey;
      else if (localTarget.selected) targetPath = localTarget.selected;
    }

    if (!targetPath) {
      diagnostics.push(diagnostic({
        descriptor,
        code: localTarget.matches.length > 1 ? 'PULSE_MANAGED_HANDLER_SOURCE_AMBIGUOUS' : 'PULSE_MANAGED_HANDLER_SOURCE_UNREACHABLE',
        message: localTarget.matches.length > 1
          ? `Managed handler source ${descriptor.source.file} is ambiguous in the reachable graph.`
          : `Managed handler source ${descriptor.source.file} is not present in the reachable graph.`,
        detail: { candidates: localTarget.matches }
      }));
      continue;
    }

    const graphModule = graphModules.get(targetPath);
    const sourceModule = context.projectModules.get(targetPath);
    if (!graphModule || !sourceModule || graphModule.runtime !== true) {
      diagnostics.push(diagnostic({
        descriptor,
        code: 'PULSE_MANAGED_HANDLER_SOURCE_UNREACHABLE',
        message: `Managed handler source ${targetPath} is not runtime-reachable.`,
        detail: { modulePath: targetPath, moduleId: graphModule && graphModule.id }
      }));
      continue;
    }

    const imported = ownerPath !== targetPath;
    if (imported) {
      if (!importedResolution
        || importedResolution.targetKey !== targetPath
        || importedResolution.binding.importedName !== descriptor.source.exportName) {
        diagnostics.push(diagnostic({
          descriptor,
          sourceFile: context.projectModules.get(ownerPath).sourceFile,
          node: importedResolution && importedResolution.relation.statement,
          code: 'PULSE_MANAGED_HANDLER_IMPORT_UNRESOLVED',
          message: `Managed handler import ${descriptor.source.localName} does not resolve to ${descriptor.source.exportName} in ${targetPath}.`,
          detail: { ownerPath, targetPath, exportName: descriptor.source.exportName, localName: descriptor.source.localName }
        }));
        continue;
      }
      if (!graphModule.exports.includes(descriptor.source.exportName)) {
        diagnostics.push(diagnostic({
          descriptor,
          sourceFile: sourceModule.sourceFile,
          code: 'PULSE_MANAGED_HANDLER_EXPORT_UNRESOLVED',
          message: `Managed handler export ${descriptor.source.exportName} is not declared by ${targetPath}.`,
          detail: { targetPath, exports: graphModule.exports }
        }));
        continue;
      }
    }

    const symbol = imported
      ? sourceModule.localExports.get(descriptor.source.exportName)
      : descriptor.source.localName;
    if (!symbol) {
      diagnostics.push(diagnostic({
        descriptor,
        sourceFile: sourceModule.sourceFile,
        code: 'PULSE_MANAGED_HANDLER_EXPORT_UNRESOLVED',
        message: `Managed handler export ${descriptor.source.exportName} does not resolve to a direct project declaration.`,
        detail: { targetPath, exportName: descriptor.source.exportName }
      }));
      continue;
    }

    const declarations = functionDeclarations(sourceModule.sourceFile, symbol);
    if (declarations.length !== 1) {
      diagnostics.push(diagnostic({
        descriptor,
        sourceFile: sourceModule.sourceFile,
        node: declarations[1] && declarations[1].declaration,
        code: declarations.length === 0 ? 'PULSE_MANAGED_HANDLER_DECLARATION_UNRESOLVED' : 'PULSE_MANAGED_HANDLER_DECLARATION_AMBIGUOUS',
        message: declarations.length === 0
          ? `Managed handler ${symbol} is not a module-level function declaration or const function.`
          : `Managed handler ${symbol} resolves to more than one module-level function declaration.`,
        detail: { targetPath, symbol }
      }));
      continue;
    }

    resolved.push(Object.freeze({
      descriptor,
      ownerPath,
      targetPath,
      graphModule,
      sourceModule,
      symbol,
      declaration: declarations[0].declaration,
      functionNode: declarations[0].functionNode
    }));
  }
  return Object.freeze(resolved);
}

function hasSimpleParameter(parameter) {
  return Boolean(
    parameter
    && ts.isIdentifier(parameter.name)
    && !parameter.dotDotDotToken
    && !parameter.initializer
    && !parameter.questionToken
  );
}

function containsIdentifier(node, name) {
  let found = false;
  function visit(current) {
    if (found || !current) return;
    if (ts.isIdentifier(current) && current.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function contextPath(node, ctxName) {
  const parts = [];
  let current = unwrap(node);
  while (current && ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = unwrap(current.expression);
  }
  return current && ts.isIdentifier(current) && current.text === ctxName ? Object.freeze(parts) : undefined;
}

function expressionContainsBareContext(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (plan.kind === 'context' || (plan.kind === 'context-read' && plan.path.length === 0)) return true;
  return Object.values(plan).some((value) => (
    Array.isArray(value)
      ? value.some(expressionContainsBareContext)
      : expressionContainsBareContext(value)
  ));
}

function createOperation(kind, fields = {}) {
  if (!managedHandlerOperationKinds.includes(kind)) throw new TypeError(`Unsupported managed Handler IR operation kind: ${kind}`);
  return Object.freeze({ kind, ...fields });
}

function createExpressionCompiler(state) {
  const {
    sourceFile,
    descriptor,
    diagnostics,
    ctxName,
    inputName,
    handlerTargets,
    currentSymbol
  } = state;

  function fail(node, code, message, detail = {}) {
    diagnostics.push(diagnostic({ descriptor, sourceFile, node, code, message, detail }));
  }

  function propertyKey(node) {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return String(node.text);
    return undefined;
  }

  function compile(node, scope) {
    const current = unwrap(node);
    if (!current) return Object.freeze({ kind: 'undefined' });

    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      return Object.freeze({ kind: 'literal', value: current.text });
    }
    if (ts.isNumericLiteral(current)) return Object.freeze({ kind: 'literal', value: Number(current.text) });
    if (current.kind === ts.SyntaxKind.TrueKeyword || current.kind === ts.SyntaxKind.FalseKeyword) {
      return Object.freeze({ kind: 'literal', value: current.kind === ts.SyntaxKind.TrueKeyword });
    }
    if (current.kind === ts.SyntaxKind.NullKeyword) return Object.freeze({ kind: 'literal', value: null });

    if (ts.isIdentifier(current)) {
      if (current.text === 'undefined') return Object.freeze({ kind: 'undefined' });
      const binding = scope.get(current.text);
      if (binding) return Object.freeze({ kind: binding.kind, id: binding.id, name: binding.name });
      if (handlerTargets.has(current.text)) {
        fail(current, 'PULSE_MANAGED_HANDLER_REFERENCE_ESCAPE', `Managed handler reference ${current.text} cannot be used as a value.`, { reference: current.text });
        return Object.freeze({ kind: 'rejected-reference', name: current.text });
      }
      fail(current, 'PULSE_MANAGED_HANDLER_REFERENCE_UNRESOLVED', `Managed handler expression references unresolved identifier ${current.text}.`, { reference: current.text });
      return Object.freeze({ kind: 'unresolved', name: current.text });
    }

    if (ts.isArrayLiteralExpression(current)) {
      return Object.freeze({
        kind: 'array',
        items: Object.freeze(current.elements.map((entry) => {
          if (ts.isOmittedExpression(entry)) return Object.freeze({ kind: 'undefined' });
          if (ts.isSpreadElement(entry)) return Object.freeze({ kind: 'spread', value: compile(entry.expression, scope) });
          return compile(entry, scope);
        }))
      });
    }

    if (ts.isObjectLiteralExpression(current)) {
      const entries = [];
      for (const property of current.properties) {
        if (ts.isSpreadAssignment(property)) {
          entries.push(Object.freeze({ kind: 'spread', value: compile(property.expression, scope) }));
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          entries.push(Object.freeze({ kind: 'property', key: property.name.text, value: compile(property.name, scope) }));
          continue;
        }
        if (ts.isPropertyAssignment(property)) {
          const key = ts.isComputedPropertyName(property.name)
            ? Object.freeze({ kind: 'computed', value: compile(property.name.expression, scope) })
            : propertyKey(property.name);
          if (key === undefined || key === '__proto__') {
            fail(property.name, 'PULSE_MANAGED_HANDLER_OBJECT_KEY_UNSUPPORTED', 'Managed handler object results require safe static or computed property keys.');
          }
          entries.push(Object.freeze({ kind: 'property', key, value: compile(property.initializer, scope) }));
          continue;
        }
        fail(property, 'PULSE_MANAGED_HANDLER_CALLBACK_UNSUPPORTED', 'Object methods, accessors, and function-valued members are outside pure managed handler lowering.');
      }
      return Object.freeze({ kind: 'object', entries: Object.freeze(entries) });
    }

    if (ts.isTemplateExpression(current)) {
      const parts = [Object.freeze({ kind: 'text', value: current.head.text })];
      for (const span of current.templateSpans) {
        parts.push(Object.freeze({ kind: 'value', value: compile(span.expression, scope) }));
        parts.push(Object.freeze({ kind: 'text', value: span.literal.text }));
      }
      return Object.freeze({ kind: 'template', parts: Object.freeze(parts) });
    }

    if (ts.isBinaryExpression(current)) {
      const operator = current.operatorToken.getText(sourceFile);
      if (ASSIGNMENT_OPERATORS.has(operator)) {
        const inputAssignment = containsIdentifier(current.left, inputName) || containsIdentifier(current.right, inputName);
        fail(
          current,
          inputAssignment ? 'PULSE_MANAGED_HANDLER_INPUT_ESCAPE' : 'PULSE_MANAGED_HANDLER_MUTATION_UNSUPPORTED',
          inputAssignment
            ? 'The schema-bound input is immutable and cannot escape through assignment.'
            : 'Assignment is outside pure managed handler lowering.',
          { operator }
        );
        return Object.freeze({ kind: 'rejected-assignment', operator, target: compile(current.left, scope), value: compile(current.right, scope) });
      }
      if (!PURE_BINARY_OPERATORS.has(operator)) {
        fail(current.operatorToken, 'PULSE_MANAGED_HANDLER_EXPRESSION_UNSUPPORTED', `Binary operator ${operator} is outside pure managed handler lowering.`, { operator });
      }
      return Object.freeze({
        kind: 'binary',
        operator,
        left: compile(current.left, scope),
        right: compile(current.right, scope)
      });
    }

    if (ts.isPrefixUnaryExpression(current)) {
      const operator = ts.tokenToString(current.operator) || current.getText(sourceFile).slice(0, 1);
      if (!PURE_PREFIX_OPERATORS.has(operator)) {
        fail(current, 'PULSE_MANAGED_HANDLER_MUTATION_UNSUPPORTED', `Prefix operator ${operator} is outside pure managed handler lowering.`, { operator });
      }
      return Object.freeze({ kind: 'unary', operator, value: compile(current.operand, scope) });
    }

    if (ts.isPostfixUnaryExpression(current)) {
      const operator = ts.tokenToString(current.operator) || current.getText(sourceFile).slice(-2);
      fail(current, 'PULSE_MANAGED_HANDLER_MUTATION_UNSUPPORTED', `Postfix operator ${operator} is outside pure managed handler lowering.`, { operator });
      return Object.freeze({ kind: 'rejected-update', operator, value: compile(current.operand, scope) });
    }

    if (ts.isConditionalExpression(current)) {
      return Object.freeze({
        kind: 'conditional',
        test: compile(current.condition, scope),
        whenTrue: compile(current.whenTrue, scope),
        whenFalse: compile(current.whenFalse, scope)
      });
    }

    if (ts.isPropertyAccessExpression(current)) {
      if (current.questionDotToken) fail(current, 'PULSE_MANAGED_HANDLER_EXPRESSION_UNSUPPORTED', 'Optional property access is outside pure managed handler lowering.');
      const ctxPath = contextPath(current, ctxName);
      if (ctxPath) {
        const contextKey = ctxPath.join('.');
        if (!canonicalNativePlanContract.CANONICAL_NATIVE_CONTEXT_READS.includes(contextKey)) {
          fail(current, 'PULSE_MANAGED_HANDLER_CONTEXT_READ_UNSUPPORTED', `Context read ctx.${contextKey} is outside the canonical native context contract.`, { path: ctxPath });
        }
        return Object.freeze({ kind: 'context-read', path: ctxPath });
      }
      return Object.freeze({ kind: 'property', object: compile(current.expression, scope), property: current.name.text });
    }

    if (ts.isElementAccessExpression(current)) {
      if (current.questionDotToken) fail(current, 'PULSE_MANAGED_HANDLER_EXPRESSION_UNSUPPORTED', 'Optional element access is outside pure managed handler lowering.');
      return Object.freeze({
        kind: 'element',
        object: compile(current.expression, scope),
        index: compile(current.argumentExpression, scope)
      });
    }

    if (ts.isCallExpression(current)) {
      const callee = unwrap(current.expression);
      const calleeName = callee && ts.isIdentifier(callee) ? callee.text : undefined;
      const inputEscapes = containsIdentifier(current.expression, inputName)
        || current.arguments.some((argument) => containsIdentifier(argument, inputName));
      if (inputEscapes) {
        fail(current, 'PULSE_MANAGED_HANDLER_INPUT_ESCAPE', 'The schema-bound input cannot escape through a call or callback.', { callee: callee && callee.getText(sourceFile) });
      }
      if (calleeName === currentSymbol) {
        fail(current, 'PULSE_MANAGED_HANDLER_RECURSION_UNSUPPORTED', `Managed handler ${currentSymbol} cannot call itself.`, { callee: calleeName });
      } else if (calleeName && handlerTargets.has(calleeName)) {
        fail(current, 'PULSE_MANAGED_HANDLER_DIRECT_CALL_UNSUPPORTED', `Managed handler ${currentSymbol} cannot call managed handler ${calleeName}.`, { callee: calleeName });
      } else {
        fail(current, 'PULSE_MANAGED_HANDLER_CALL_UNSUPPORTED', 'Function and method calls enter the effectful managed-handler pass and are not part of pure lowering.', { callee: callee && callee.getText(sourceFile) });
      }
      const target = ts.isPropertyAccessExpression(callee)
        ? compile(callee.expression, scope)
        : Object.freeze({ kind: 'callee', name: calleeName || callee && callee.getText(sourceFile) || '<unknown>' });
      return Object.freeze({
        kind: 'rejected-call',
        target,
        arguments: Object.freeze(current.arguments.map((argument) => compile(argument, scope)))
      });
    }

    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isClassExpression(current)) {
      const capturesInput = containsIdentifier(current.body || current, inputName);
      fail(current, 'PULSE_MANAGED_HANDLER_CALLBACK_UNSUPPORTED', 'Nested functions, closures, classes, and arbitrary callbacks are outside managed handler lowering.');
      if (capturesInput) fail(current, 'PULSE_MANAGED_HANDLER_INPUT_ESCAPE', 'The schema-bound input cannot be captured by a nested function or callback.');
      return Object.freeze({ kind: 'rejected-callback' });
    }

    if (ts.isAwaitExpression(current) || ts.isYieldExpression(current) || ts.isNewExpression(current)) {
      fail(current, 'PULSE_MANAGED_HANDLER_EXPRESSION_UNSUPPORTED', `${ts.SyntaxKind[current.kind]} enters effectful or dynamic execution and is outside pure managed handler lowering.`, { syntax: ts.SyntaxKind[current.kind] });
      return Object.freeze({ kind: 'rejected-expression', syntax: ts.SyntaxKind[current.kind] });
    }

    fail(current, 'PULSE_MANAGED_HANDLER_EXPRESSION_UNSUPPORTED', `Expression ${ts.SyntaxKind[current.kind]} is outside pure managed handler lowering.`, { syntax: ts.SyntaxKind[current.kind] });
    return Object.freeze({ kind: 'rejected-expression', syntax: ts.SyntaxKind[current.kind] });
  }

  return compile;
}

function handlerTargetNames(context, resolved, byModule) {
  const names = new Set(byModule.get(resolved.targetPath) || []);
  const module = context.projectModules.get(resolved.targetPath);
  for (const relation of module && module.imports || []) {
    for (const binding of relation.bindings || []) {
      const resolution = resolutionForImport(resolved.graphBuild, resolved.targetPath, binding.localName);
      if (!resolution) continue;
      const targetSymbols = byModule.get(resolution.targetKey);
      if (!targetSymbols) continue;
      const targetModule = context.projectModules.get(resolution.targetKey);
      const exportedLocal = targetModule && targetModule.localExports.get(binding.importedName);
      if (exportedLocal && targetSymbols.has(exportedLocal)) names.add(binding.localName);
    }
  }
  return names;
}

function normalizedSourceIdentity(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function sourceIdentityMatches(value, resolved) {
  const actual = normalizedSourceIdentity(value);
  if (!actual) return false;
  const expected = [
    resolved.targetPath,
    resolved.sourceModule && resolved.sourceModule.absolutePath,
    resolved.sourceModule && resolved.sourceModule.sourceFile && resolved.sourceModule.sourceFile.fileName
  ].map(normalizedSourceIdentity).filter(Boolean);
  return expected.some((candidate) => actual === candidate || actual.endsWith(`/${normalizedSourceIdentity(resolved.targetPath)}`));
}

function sourceRangeContains(range, start, end) {
  const rangeStart = Number(range && range.start);
  const rangeEnd = Number(range && range.end);
  return Number.isSafeInteger(rangeStart)
    && Number.isSafeInteger(rangeEnd)
    && rangeStart >= start
    && rangeEnd <= end;
}

function packageInputsForHandler(recognition, resolved) {
  if (!recognition) {
    return Object.freeze({
      effects: Object.freeze([]),
      operations: Object.freeze([]),
      intrinsics: Object.freeze([]),
      resultAdapters: Object.freeze([]),
      lowering: lowerCanonicalPackageOperations(Object.freeze({
        version: PACKAGE_OPERATION_RECOGNITION_VERSION,
        operations: Object.freeze([]),
        packages: Object.freeze([]),
        schemaReferences: Object.freeze([]),
        realizationArtifacts: Object.freeze([]),
        guestUnits: Object.freeze([]),
        cryptoRequirements: Object.freeze([])
      }))
    });
  }
  const sourceFile = resolved.sourceModule.sourceFile;
  const start = resolved.functionNode.getStart(sourceFile);
  const end = resolved.functionNode.getEnd();
  const extensions = recognition.publicExtensions || {};
  const within = (entry) => sourceIdentityMatches(entry && entry.loc && entry.loc.file, resolved)
    && sourceRangeContains(entry && entry.range, start, end);
  const withinOperation = (entry) => sourceIdentityMatches(entry && entry.source && entry.source.file, resolved)
    && sourceRangeContains(entry && entry.range, start, end);
  const sortByRange = (left, right) => Number(left.range.start) - Number(right.range.start)
    || Number(left.range.end) - Number(right.range.end)
    || String(left.kind || left.intrinsic || '').localeCompare(String(right.kind || right.intrinsic || ''));
  const operations = Object.freeze([...(recognition.operations || [])].filter(withinOperation).sort(sortByRange));
  const contractIds = new Set(operations.map((entry) => String(entry.contractId || '')).filter(Boolean));
  const packages = Object.freeze([...(recognition.packages || [])]
    .filter((entry) => contractIds.has(String(entry.contractId || '')))
    .map((entry) => Object.freeze({
      ...entry,
      operationCount: operations.filter((operation) => operation.contractId === entry.contractId).length,
      intrinsicCount: [...(extensions.intrinsics || [])].filter(within)
        .filter((intrinsic) => intrinsic.contractId === entry.contractId).length
    })));
  const packageNames = new Set(packages.flatMap((entry) => [entry.package, entry.lowerableSubpath]).map(String).filter(Boolean));
  const packageOwned = (entry) => contractIds.has(String(entry && entry.contractId || ''))
    || packageNames.has(String(entry && (entry.package || entry.requestedBy || entry.owner) || ''));
  const filteredRecognition = Object.freeze({
    version: PACKAGE_OPERATION_RECOGNITION_VERSION,
    operations,
    packages,
    schemaReferences: Object.freeze([...(recognition.schemaReferences || [])].filter((entry) => (
      sourceIdentityMatches(entry && (entry.file || entry.loc && entry.loc.file), resolved)
      && (!entry.range || sourceRangeContains(entry.range, start, end))
    ))),
    realizationArtifacts: Object.freeze([...(recognition.realizationArtifacts || [])]
      .filter(packageOwned)),
    guestUnits: Object.freeze([...(recognition.guestUnits || [])]
      .filter(packageOwned)),
    cryptoRequirements: Object.freeze([...(recognition.cryptoRequirements || [])]
      .filter(packageOwned))
  });
  return Object.freeze({
    effects: Object.freeze(operations.map((entry) => entry.canonicalEffect)),
    operations,
    intrinsics: Object.freeze([...(extensions.intrinsics || [])].filter(within).sort(sortByRange)),
    resultAdapters: Object.freeze([...(extensions.resultAdapters || [])].filter(within).sort(sortByRange)),
    lowering: lowerCanonicalPackageOperations(filteredRecognition)
  });
}

function lookupByRange(entries) {
  const byStart = new Map();
  for (const entry of entries || []) {
    const start = Number(entry && entry.range && entry.range.start);
    if (Number.isSafeInteger(start) && !byStart.has(start)) byStart.set(start, entry);
  }
  return (call, sourceFile) => {
    if (!call || typeof call.getStart !== 'function') return undefined;
    try { return byStart.get(call.getStart(sourceFile)); }
    catch (_) { return undefined; }
  };
}

function sortedUnique(values) {
  return Object.freeze([...new Set((values || []).map(String).filter(Boolean))].sort());
}

function continuationForEffect(operationIr, effectId) {
  return operationIr.continuationSites.find((entry) => entry.effectIds.includes(effectId));
}

function effectPlanForHandler(options) {
  const {
    descriptor,
    source,
    operationIr,
    capabilities,
    packageEffects,
    packageLowering
  } = options;
  const effects = Object.freeze(operationIr.effectSites.map((site, index) => {
    const continuation = continuationForEffect(operationIr, site.id);
    return deepFreeze({
      ...site,
      order: index + 1,
      ...(continuation ? { continuationId: continuation.id } : {}),
      source: Object.freeze({
        file: source.file,
        line: Number(site.position && site.position.line || source.position.line),
        column: Number(site.position && site.position.column || source.position.column),
        handlerId: descriptor.id
      })
    });
  }));
  const semantic = deepFreeze({
    version: managedHandlerEffectPlanVersion,
    kind: 'managed-handler-effects',
    handlerId: descriptor.id,
    source,
    capabilities,
    effects,
    packages: Object.freeze({ effects: packageLowering.effects }),
    ownership: Object.freeze({ providerNeutral: true })
  });
  const plan = deepFreeze({ ...semantic, planHash: sha256Hex(stableStringify(semantic)) });
  return Object.freeze({
    plan,
    providerRequirements: collectProviderRequirements(plan, packageLowering)
  });
}

function compileHandler(resolved, graphBuild, allResolved, diagnostics, packageRecognition) {
  const descriptor = resolved.descriptor;
  const sourceFile = resolved.sourceModule.sourceFile;
  const original = resolved.functionNode;

  if (original.asteriskToken) {
    diagnostics.push(diagnostic({
      descriptor,
      sourceFile,
      node: original,
      code: 'PULSE_MANAGED_HANDLER_GENERATOR_UNSUPPORTED',
      message: 'Generator functions are outside managed handler lowering.'
    }));
  }
  if (original.parameters.length !== 2 || !original.parameters.every(hasSimpleParameter)) {
    diagnostics.push(diagnostic({
      descriptor,
      sourceFile,
      node: original,
      code: 'PULSE_MANAGED_HANDLER_SIGNATURE_INVALID',
      message: 'Managed schema operations require exactly two simple identifier parameters: (ctx, input).',
      detail: { parameterCount: original.parameters.length }
    }));
    return undefined;
  }

  const ctxName = original.parameters[0].name.text;
  const inputName = original.parameters[1].name.text;
  if (ctxName === inputName) {
    diagnostics.push(diagnostic({
      descriptor,
      sourceFile,
      node: original.parameters[1],
      code: 'PULSE_MANAGED_HANDLER_SIGNATURE_INVALID',
      message: 'Managed handler context and input parameters must have distinct identifiers.'
    }));
    return undefined;
  }

  const packageInputs = packageInputsForHandler(packageRecognition, resolved);
  const findPackageEffect = lookupByRange(packageInputs.effects);
  const findPackageIntrinsic = lookupByRange(packageInputs.intrinsics);
  const findPackageResultAdapter = lookupByRange(packageInputs.resultAdapters);
  const packageEffectForCall = (call) => findPackageEffect(call, sourceFile);
  const packageIntrinsicForCall = (call) => findPackageIntrinsic(call, sourceFile);
  const packageResultAdapterForCall = (call) => findPackageResultAdapter(call, sourceFile);

  const normalizer = normalizeManagedHandler(original, {
    sourceFile,
    ctxName,
    frontend: 'canonical-source',
    role: MANAGED_HANDLER_ROLE,
    strict: true,
    requireEffectAwait: false,
    packageEffectForCall
  });
  diagnostics.push(...normalizer.diagnostics);
  const handler = normalizer.functionNode;

  const schemaReferences = Object.freeze([
    descriptor.input.schemaId && Object.freeze({ id: descriptor.input.schemaId, usage: 'managed-input', capability: 'schema.decode' }),
    descriptor.result.schemaId && Object.freeze({ id: descriptor.result.schemaId, usage: 'managed-result', capability: 'schema.encode' })
  ].filter(Boolean));
  const frontend = {
    frontend: 'canonical-source',
    fileName: resolved.targetPath,
    sourceFile,
    handler,
    diagnostics,
    analysis: Object.freeze({
      capabilities: Object.freeze([]),
      fetchCount: 0,
      schemaReferences,
      providerOperations: Object.freeze([])
    }),
    schemaBundle: Object.freeze({
      declaredSchemaIds: Object.freeze(schemaReferences.map((entry) => entry.id)),
      schemaIds: Object.freeze(schemaReferences.map((entry) => entry.id))
    })
  };
  const rawOperationIr = buildPlainHandlerIr(frontend, {
    packageEffects: packageInputs.effects,
    packageIntrinsics: packageInputs.intrinsics,
    packageResultAdapters: packageInputs.resultAdapters,
    packageEffectForCall,
    packageIntrinsicForCall,
    packageResultAdapterForCall
  });
  if (!rawOperationIr) return undefined;

  const context = projectGraphContext(graphBuild);
  const symbolsByModule = new Map();
  for (const entry of allResolved) {
    if (!symbolsByModule.has(entry.targetPath)) symbolsByModule.set(entry.targetPath, new Set());
    symbolsByModule.get(entry.targetPath).add(entry.symbol);
  }
  const withBuild = Object.freeze({ ...resolved, graphBuild });
  const handlerTargets = handlerTargetNames(context, withBuild, symbolsByModule);
  const compileExpression = createExpressionCompiler({
    sourceFile,
    descriptor,
    diagnostics,
    ctxName,
    inputName,
    handlerTargets,
    currentSymbol: resolved.symbol
  });

  const state = {
    localIndex: 0,
    returnIndex: 0,
    loggingIndex: 0,
    locals: [],
    resultSites: [],
    loggingSites: [],
    effectRuntimeInputs: new Map()
  };
  const rootScope = new Map([
    [ctxName, Object.freeze({ kind: 'context', id: 'parameter-0', name: ctxName })],
    [inputName, Object.freeze({ kind: 'input', id: 'parameter-1', name: inputName })]
  ]);

  function fail(node, code, message, detail = {}) {
    diagnostics.push(diagnostic({ descriptor, sourceFile, node, code, message, detail }));
  }

  function registerEffectRuntimeInputs(site, candidate, scope) {
    if (!site || state.effectRuntimeInputs.has(site.id)) {
      if (site && state.effectRuntimeInputs.has(site.id)) {
        fail(handler, 'PULSE_MANAGED_HANDLER_EFFECT_INPUT_DUPLICATE', `Managed effect ${site.id} was projected more than once.`, { effectId: site.id });
      }
      return;
    }
    const inputs = [];
    const names = new Set();
    function add(name, node) {
      if (!node) return;
      const normalized = String(name);
      if (names.has(normalized)) {
        fail(node, 'PULSE_MANAGED_HANDLER_EFFECT_INPUT_DUPLICATE', `Managed effect ${site.id} repeats runtime input ${normalized}.`, { effectId: site.id, input: normalized });
        return;
      }
      names.add(normalized);
      inputs.push(Object.freeze({ name: normalized, value: compileExpression(node, scope) }));
    }

    const chain = candidate && candidate.chain;
    const provider = candidate && candidate.operation && candidate.operation.providerKind
      ? candidate.operation
      : candidate && candidate.providerKind
        ? candidate
        : undefined;
    const packageEffect = candidate && candidate.effect;
    const packageCall = candidate && candidate.call;
    if (chain) {
      add('url', chain.url);
      add('init', chain.init);
      for (const [index, argument] of (chain.decoderArgs || []).entries()) add(`decoderArgument${index}`, argument);
    } else if (provider) {
      if (provider.providerKind === 'config' || provider.providerKind === 'secret') {
        add('name', provider.name || provider.resource);
      } else if (provider.providerKind === 'kv') {
        add('store', provider.store || provider.resource);
        add('key', provider.key);
        add('value', provider.value);
      } else if (provider.providerKind === 'event') {
        add('type', provider.type);
        add('emission', provider.emission);
      } else {
        for (const [index, argument] of (provider.args || []).entries()) add(`argument${index}`, argument);
      }
    } else if (packageEffect && packageCall) {
      for (const input of packageEffect.runtimeInputs || []) {
        add(input.name, packageCall.arguments && packageCall.arguments[input.argumentIndex]);
      }
    }
    state.effectRuntimeInputs.set(site.id, deepFreeze({ effectId: site.id, inputs: Object.freeze(inputs) }));
  }

  function requireConst(statement) {
    if (statement && ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
      fail(statement, 'PULSE_MANAGED_HANDLER_MUTATION_UNSUPPORTED', 'Managed handler locals and effect results must be declared with const.');
    }
  }

  function bindLocal(name, node, scope, binding = 'value') {
    if (scope.has(name)) {
      fail(node, 'PULSE_MANAGED_HANDLER_BINDING_DUPLICATE', `Managed handler local ${name} shadows an existing binding.`, { local: name });
    }
    state.localIndex += 1;
    const local = Object.freeze({ kind: 'local', id: `local-${state.localIndex}`, name });
    scope.set(name, local);
    const position = positionFor(sourceFile, node);
    state.locals.push(Object.freeze({ id: local.id, name, binding, position }));
    return Object.freeze({ ...local, binding, position });
  }

  function compileReturn(statement, scope) {
    state.returnIndex += 1;
    const position = positionFor(sourceFile, statement);
    if (descriptor.result.kind === 'schema-value') {
      if (!statement.expression || (ts.isIdentifier(unwrap(statement.expression)) && unwrap(statement.expression).text === 'undefined')) {
        fail(statement, 'PULSE_MANAGED_HANDLER_RESULT_REQUIRED', `Managed handler ${descriptor.id} must return a value for schema ${descriptor.result.schemaId}.`, { schemaId: descriptor.result.schemaId });
        return Object.freeze({ operation: createOperation('rejected', { position, reason: 'result-required' }), terminates: true });
      }
      const expression = compileExpression(statement.expression, scope);
      if (expressionContainsBareContext(expression)) {
        fail(statement.expression, 'PULSE_MANAGED_HANDLER_CONTEXT_ESCAPE', 'The managed request context cannot be adopted as a schema-bound result.');
      }
      const operation = createOperation('schema-result', {
        site: `result-${state.returnIndex}`,
        schemaId: descriptor.result.schemaId,
        adoption: 'schema-bound-value',
        expression,
        position
      });
      state.resultSites.push(operation);
      return Object.freeze({ operation, terminates: true });
    }

    if (statement.expression) {
      const expression = unwrap(statement.expression);
      if (!ts.isIdentifier(expression) || expression.text !== 'undefined') {
        fail(statement.expression, 'PULSE_MANAGED_HANDLER_RESULT_UNSUPPORTED', 'A completion-only managed handler must not return a value.');
        compileExpression(statement.expression, scope);
      }
    }
    const operation = createOperation('completion', {
      site: `result-${state.returnIndex}`,
      adoption: 'completion-only',
      position
    });
    state.resultSites.push(operation);
    return Object.freeze({ operation, terminates: true });
  }

  function compileVariable(statement, scope) {
    requireConst(statement);
    const operations = [];
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        fail(declaration, 'PULSE_MANAGED_HANDLER_BINDING_UNSUPPORTED', 'Managed handler locals require simple identifier bindings with initializers.');
        operations.push(createOperation('rejected', { position: positionFor(sourceFile, declaration), reason: 'binding' }));
        continue;
      }
      const initializer = compileExpression(declaration.initializer, scope);
      if (expressionContainsBareContext(initializer)) {
        fail(declaration.initializer, 'PULSE_MANAGED_HANDLER_CONTEXT_ESCAPE', 'The managed request context cannot be captured in a local value.');
      }
      const local = bindLocal(declaration.name.text, declaration.name, scope);
      operations.push(createOperation('local', {
        id: local.id,
        name: local.name,
        initializer,
        position: local.position
      }));
    }
    return Object.freeze({ operations: Object.freeze(operations), terminates: false });
  }

  function compileNamespace(statement, scope) {
    const namespace = extractKvNamespaceDeclaration(statement, ctxName);
    if (!namespace) return undefined;
    requireConst(statement);
    const local = bindLocal(namespace.variableName, namespace.declaration.name, scope, 'provider-namespace');
    return Object.freeze({
      operation: createOperation('local', {
        id: local.id,
        name: local.name,
        initializer: Object.freeze({
          kind: 'provider-namespace',
          providerKind: 'kv',
          resource: compileExpression(namespace.store, scope)
        }),
        position: local.position
      }),
      terminates: false
    });
  }

  function effectOperation(site, continuation, position, fields = {}) {
    return createOperation('effect', {
      effect: site,
      continuation,
      ...fields,
      position
    });
  }

  function compileBoundEffect(candidate, site, continuation, scope) {
    registerEffectRuntimeInputs(site, candidate, scope);
    requireConst(candidate.statement);
    const local = bindLocal(candidate.variableName, candidate.declaration.name, scope, 'effect-result');
    return Object.freeze({
      operation: effectOperation(site, continuation, positionFor(sourceFile, candidate.statement), {
        binding: Object.freeze({ id: local.id, name: local.name, kind: 'effect-result' })
      }),
      terminates: false
    });
  }

  function compileEffectReturn(operation, scope) {
    registerEffectRuntimeInputs(operation.site, Object.freeze({ effect: operation.effect, call: operation.call }), scope);
    const position = positionFor(sourceFile, operation.statement);
    if (descriptor.result.kind !== 'schema-value') {
      fail(operation.statement, 'PULSE_MANAGED_HANDLER_RESULT_UNSUPPORTED', 'A completion-only managed handler cannot adopt a package effect value as its result.');
      return Object.freeze({ operation: createOperation('rejected', { position, reason: 'effect-result' }), terminates: true });
    }
    state.returnIndex += 1;
    const resultSite = createOperation('schema-result', {
      site: `result-${state.returnIndex}`,
      schemaId: descriptor.result.schemaId,
      adoption: 'schema-bound-effect-value',
      expression: Object.freeze({ kind: 'effect-result', effectId: operation.site.id }),
      position
    });
    state.resultSites.push(resultSite);
    return Object.freeze({
      operation: effectOperation(operation.site, operation.continuation, position, {
        result: Object.freeze({ site: resultSite.site, schemaId: descriptor.result.schemaId, adoption: resultSite.adoption })
      }),
      terminates: true
    });
  }

  function parallelBindings(candidate, scope) {
    if (candidate.discard || !candidate.declaration) return Object.freeze([]);
    requireConst(candidate.statement);
    const name = candidate.declaration.name;
    if (ts.isIdentifier(name)) {
      const local = bindLocal(name.text, name, scope, 'parallel-result');
      return Object.freeze([Object.freeze({ id: local.id, name: local.name, key: null })]);
    }
    const bindings = [];
    for (const element of name.elements || []) {
      if (!ts.isIdentifier(element.name)) continue;
      const keyNode = element.propertyName || element.name;
      const key = ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode) ? keyNode.text : undefined;
      const local = bindLocal(element.name.text, element.name, scope, 'parallel-member');
      bindings.push(Object.freeze({ id: local.id, name: local.name, key }));
    }
    return Object.freeze(bindings);
  }

  function compileParallel(operation, scope, strategy) {
    if (operation.kind === 'fetch-group') {
      const bindings = [];
      for (const [index, candidate] of operation.candidates.entries()) {
        registerEffectRuntimeInputs(operation.sites[index], candidate, scope);
        requireConst(candidate.statement);
        const local = bindLocal(candidate.variableName, candidate.declaration.name, scope, 'effect-result');
        bindings.push(Object.freeze({ id: local.id, name: local.name, key: null }));
      }
      return Object.freeze({
        operation: createOperation('parallel', {
          strategy,
          effects: operation.sites,
          continuation: operation.continuation,
          bindings: Object.freeze(bindings),
          position: positionFor(sourceFile, operation.candidates[0].statement)
        }),
        terminates: false
      });
    }
    for (const [index, member] of operation.candidate.members.entries()) {
      registerEffectRuntimeInputs(operation.sites[index], member, scope);
    }
    return Object.freeze({
      operation: createOperation('parallel', {
        strategy,
        effects: operation.sites,
        continuation: operation.continuation,
        bindings: parallelBindings(operation.candidate, scope),
        keys: Object.freeze(operation.candidate.members.map((entry) => entry.key)),
        position: positionFor(sourceFile, operation.candidate.statement)
      }),
      terminates: false
    });
  }

  function compileLogging(statement, scope) {
    if (!ts.isExpressionStatement(statement)) return undefined;
    const surface = recognizeHandlerSurface(statement.expression, { ctxName, strict: true, unwrap: true });
    if (!surface || !surface.surfaceId.startsWith('ctx.log.')) return undefined;
    state.loggingIndex += 1;
    const position = positionFor(sourceFile, statement.expression);
    const site = Object.freeze({
      id: `logging-${state.loggingIndex}`,
      capability: 'logging',
      level: surface.detail.level,
      position
    });
    state.loggingSites.push(site);
    return Object.freeze({
      operation: createOperation('logging', {
        site,
        arguments: Object.freeze(surface.detail.arguments.map((entry) => compileExpression(entry, scope))),
        position
      }),
      terminates: false
    });
  }

  function compileSourceStatement(statement, scope) {
    if (ts.isVariableStatement(statement)) {
      const namespace = compileNamespace(statement, scope);
      return namespace || compileVariable(statement, scope);
    }
    if (ts.isReturnStatement(statement)) return compileReturn(statement, scope);
    if (ts.isEmptyStatement(statement)) {
      return Object.freeze({ operation: createOperation('block', { statements: Object.freeze([]), position: positionFor(sourceFile, statement) }), terminates: false });
    }
    if (ts.isExpressionStatement(statement)) {
      const logging = compileLogging(statement, scope);
      if (logging) return logging;
      compileExpression(statement.expression, scope);
      fail(statement, 'PULSE_MANAGED_HANDLER_STATEMENT_UNSUPPORTED', 'Managed handlers accept canonical effects, logging, local declarations, if/else branches, and schema-bound returns only.');
      return Object.freeze({ operation: createOperation('rejected', { position: positionFor(sourceFile, statement), reason: 'expression-statement' }), terminates: false });
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      const capturesInput = containsIdentifier(statement, inputName);
      fail(statement, 'PULSE_MANAGED_HANDLER_CALLBACK_UNSUPPORTED', 'Nested functions, classes, and callbacks are outside managed handler lowering.');
      if (capturesInput) fail(statement, 'PULSE_MANAGED_HANDLER_INPUT_ESCAPE', 'The schema-bound input cannot be captured by a nested declaration.');
      return Object.freeze({ operation: createOperation('rejected', { position: positionFor(sourceFile, statement), reason: 'nested-declaration' }), terminates: false });
    }
    fail(statement, 'PULSE_MANAGED_HANDLER_CONTROL_FLOW_UNSUPPORTED', `Statement ${ts.SyntaxKind[statement.kind]} is outside managed handler lowering.`, { syntax: ts.SyntaxKind[statement.kind] });
    return Object.freeze({ operation: createOperation('rejected', { position: positionFor(sourceFile, statement), reason: 'control-flow' }), terminates: false });
  }

  function compileOperation(operation, scope) {
    if (operation.kind === 'block') return compileOperationList(operation.statements, new Map(scope), operation.statement);
    if (operation.kind === 'if') {
      const test = compileExpression(operation.expression, scope);
      const thenResult = compileOperation(operation.thenOperation, new Map(scope));
      const elseResult = operation.elseOperation
        ? compileOperation(operation.elseOperation, new Map(scope))
        : Object.freeze({ operation: undefined, terminates: false });
      return Object.freeze({
        operation: createOperation('if', {
          test,
          thenOperation: thenResult.operation || createOperation('block', { statements: Object.freeze([]), position: positionFor(sourceFile, operation.statement) }),
          elseOperation: elseResult.operation,
          position: positionFor(sourceFile, operation.statement)
        }),
        terminates: thenResult.terminates && elseResult.terminates
      });
    }
    if (operation.kind === 'source-statement') return compileSourceStatement(operation.statement, scope);
    if (operation.kind === 'fetch-single' || operation.kind === 'provider-variable' || operation.kind === 'package-variable') {
      return compileBoundEffect(operation.candidate, operation.site, operation.continuation, scope);
    }
    if (operation.kind === 'provider-expression') {
      registerEffectRuntimeInputs(operation.site, operation.candidate, scope);
      return Object.freeze({
        operation: effectOperation(operation.site, operation.continuation, positionFor(sourceFile, operation.candidate.statement)),
        terminates: false
      });
    }
    if (operation.kind === 'package-effect') {
      if (operation.returnResult) return compileEffectReturn(operation, scope);
      registerEffectRuntimeInputs(operation.site, Object.freeze({ effect: operation.effect, call: operation.call }), scope);
      return Object.freeze({
        operation: effectOperation(operation.site, operation.continuation, positionFor(sourceFile, operation.statement)),
        terminates: false
      });
    }
    if (operation.kind === 'fetch-group') return compileParallel(operation, scope, 'implicit-independent-fetch-group');
    if (operation.kind === 'parallel-group') return compileParallel(operation, scope, 'explicit-keyed');
    if (operation.kind === 'opaque-fetch-return') {
      fail(operation.statement, 'PULSE_MANAGED_HANDLER_RESPONSE_RESULT_UNSUPPORTED', 'Managed schema operations cannot return an opaque fetch Response; the adapter owns completion framing.');
      return Object.freeze({ operation: createOperation('rejected', { position: positionFor(sourceFile, operation.statement), reason: 'opaque-response' }), terminates: true });
    }
    if (operation.kind === 'package-result-adapter') {
      fail(operation.statement, 'PULSE_MANAGED_HANDLER_RESPONSE_RESULT_UNSUPPORTED', 'Managed schema operations cannot invoke a package response adapter; the entity adapter owns completion framing.');
      return Object.freeze({ operation: createOperation('rejected', { position: positionFor(sourceFile, operation.statement), reason: 'package-result-adapter' }), terminates: true });
    }
    fail(handler, 'PULSE_MANAGED_HANDLER_CONTROL_FLOW_UNSUPPORTED', `Canonical Handler IR operation ${operation.kind} is outside managed handler lowering.`, { operationKind: operation.kind });
    return Object.freeze({ operation: createOperation('rejected', { position: positionFor(sourceFile, handler), reason: 'canonical-operation' }), terminates: false });
  }

  function compileOperationList(operations, scope, blockNode) {
    const statements = [];
    let terminates = false;
    for (const operation of operations) {
      if (terminates) {
        fail(operation.statement || blockNode || handler, 'PULSE_MANAGED_HANDLER_UNREACHABLE', 'Statements after a managed handler result are unreachable.');
        continue;
      }
      const result = compileOperation(operation, scope);
      if (result.operations) statements.push(...result.operations);
      else if (result.operation) statements.push(result.operation);
      terminates = result.terminates;
    }
    return Object.freeze({
      operation: createOperation('block', {
        statements: Object.freeze(statements),
        position: positionFor(sourceFile, blockNode || handler)
      }),
      terminates
    });
  }

  const compiledBody = compileOperation(rawOperationIr.body, rootScope);
  let body = compiledBody.operation;
  if (!compiledBody.terminates) {
    if (descriptor.result.kind === 'schema-value') {
      fail(handler.body, 'PULSE_MANAGED_HANDLER_RESULT_FALLTHROUGH', `Managed handler ${descriptor.id} must return schema ${descriptor.result.schemaId} on every path.`, { schemaId: descriptor.result.schemaId });
    } else {
      state.returnIndex += 1;
      const completion = createOperation('completion', {
        site: `result-${state.returnIndex}`,
        adoption: 'completion-only',
        implicit: true,
        position: positionFor(sourceFile, handler.body)
      });
      state.resultSites.push(completion);
      body = createOperation('block', {
        ...body,
        statements: Object.freeze([...body.statements, completion])
      });
    }
  }

  const capabilities = sortedUnique([
    ...rawOperationIr.effectSites.map((entry) => entry.capability),
    ...schemaReferences.map((entry) => entry.capability),
    ...(state.loggingSites.length > 0 ? ['logging'] : [])
  ]);
  const analysis = deepFreeze({
    capabilities,
    fetchCount: rawOperationIr.effectSites.filter((entry) => entry.kind === 'fetch').length,
    genericJsonCount: 0,
    schemaBoundJsonCount: 0,
    schemaReferences,
    providerOperations: Object.freeze(rawOperationIr.effectSites
      .filter((entry) => ['config', 'secret', 'kv'].includes(entry.providerKind))
      .map((entry) => Object.freeze({
        id: entry.id,
        kind: entry.providerKind,
        operation: entry.operation,
        capability: entry.capability,
        resource: entry.resource,
        position: entry.position
      })))
  });
  const operationIr = Object.freeze({ ...rawOperationIr, analysis });
  const source = Object.freeze({
    moduleId: resolved.graphModule.id,
    file: resolved.targetPath,
    exportName: descriptor.source.exportName,
    localName: resolved.symbol,
    position: positionFor(sourceFile, resolved.declaration)
  });
  const effectPlan = effectPlanForHandler({
    descriptor,
    source,
    operationIr,
    capabilities,
    packageEffects: packageInputs.effects,
    packageLowering: packageInputs.lowering
  });
  const semantic = {
    version: managedHandlerIrVersion,
    kind: 'managed-handler',
    id: descriptor.id,
    role: MANAGED_HANDLER_ROLE,
    source,
    parameters: Object.freeze({
      context: Object.freeze({ kind: 'managed-context', index: 0, name: ctxName }),
      input: Object.freeze({ ...descriptor.input, index: 1, name: inputName, binding: 'pre-bound' })
    }),
    result: Object.freeze({ ...descriptor.result, adoption: descriptor.result.kind === 'schema-value' ? 'schema-bound-value' : 'completion-only' }),
    normalization: normalizer.summary,
    body,
    locals: Object.freeze(state.locals),
    resultSites: Object.freeze(state.resultSites),
    canonical: handlerIrSnapshot(operationIr),
    effects: Object.freeze({
      count: operationIr.effectSites.length,
      sites: operationIr.effectSites,
      continuations: operationIr.continuationSites,
      logging: Object.freeze(state.loggingSites),
      packageOperations: Object.freeze(packageInputs.effects)
    }),
    effectPlan: effectPlan.plan,
    providerRequirements: effectPlan.providerRequirements,
    eligibility: Object.freeze({
      scope: 'handler-syntax',
      inspectionScope: 'declared-handler-effects',
      inspected: true,
      packageTargetPromotion: false,
      javascript: Object.freeze({ eligible: true, blockers: Object.freeze([]) }),
      native: Object.freeze({ eligible: true, blockers: Object.freeze([]) })
    })
  };
  const record = deepFreeze({ ...semantic, handlerHash: sha256Hex(stableStringify(semantic)) });
  const runtimeInputs = Object.freeze(operationIr.effectSites.map((site) => (
    state.effectRuntimeInputs.get(site.id)
    || deepFreeze({ effectId: site.id, inputs: Object.freeze([]) })
  )));
  const nativeSemantic = {
    version: managedHandlerNativeFactsVersion,
    handlerIrVersion: managedHandlerIrVersion,
    id: record.id,
    source: record.source,
    parameters: record.parameters,
    result: record.result,
    body: record.body,
    locals: record.locals,
    resultSites: record.resultSites,
    effects: Object.freeze({
      count: record.effects.count,
      sites: record.effects.sites,
      continuations: record.effects.continuations,
      logging: record.effects.logging,
      runtimeInputs
    }),
    providerRequirements: record.providerRequirements,
    handlerHash: record.handlerHash
  };
  managedHandlerNativeFacts.set(record, deepFreeze({
    ...nativeSemantic,
    nativeFactsHash: sha256Hex(stableStringify(nativeSemantic))
  }));
  canonicalHandlerIr.set(record, operationIr);
  return record;
}

function compileManagedHandlerDescriptors(inputs = {}) {
  if (!inputs || typeof inputs !== 'object') throw new TypeError('compileManagedHandlerDescriptors requires an input object.');
  const rawDescriptors = inputs.descriptors;
  if (!Array.isArray(rawDescriptors) || rawDescriptors.length === 0) {
    throw new TypeError('compileManagedHandlerDescriptors requires at least one descriptor.');
  }
  const descriptors = Object.freeze(rawDescriptors.map(normalizeDescriptor));
  const ids = new Set();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) throw new TypeError(`Managed handler descriptor ID ${descriptor.id} is duplicated.`);
    ids.add(descriptor.id);
  }
  const packageRecognition = inputs.packageOperationRecognition;
  if (packageRecognition !== undefined && (!packageRecognition || packageRecognition.version !== PACKAGE_OPERATION_RECOGNITION_VERSION)) {
    throw new TypeError(`packageOperationRecognition must be ${PACKAGE_OPERATION_RECOGNITION_VERSION}.`);
  }

  const diagnostics = [];
  const resolved = resolveDescriptors(inputs.graphBuild, descriptors, diagnostics);
  const handlers = [];
  for (const entry of resolved) {
    const handler = compileHandler(entry, inputs.graphBuild, resolved, diagnostics, packageRecognition);
    if (handler) handlers.push(handler);
  }
  if (diagnostics.length > 0) {
    const normalized = normalizeDiagnostics(diagnostics);
    throw new ManagedHandlerCompileError(`Managed handler compilation failed with ${normalized.length} diagnostic(s).`, normalized);
  }

  handlers.sort((left, right) => left.id.localeCompare(right.id) || left.handlerHash.localeCompare(right.handlerHash));
  const reachableCapabilities = sortedUnique(handlers.flatMap((entry) => entry.providerRequirements.capabilities));
  const reachableProviderKinds = sortedUnique(handlers.flatMap((entry) => entry.providerRequirements.providerKinds));
  const reachablePackages = Object.freeze(handlers.flatMap((entry) => entry.providerRequirements.packages
    .map((identity) => Object.freeze({ handlerId: entry.id, ...identity })))
    .sort((left, right) => left.handlerId.localeCompare(right.handlerId)
      || left.contractId.localeCompare(right.contractId)
      || left.package.localeCompare(right.package)));
  const reachability = Object.freeze({
    version: managedHandlerReachabilityVersion,
    scope: 'declared-reachable-managed-handlers',
    graphHash: inputs.graphBuild.graph.graphHash,
    handlers: Object.freeze(handlers.map((entry) => Object.freeze({
      id: entry.id,
      source: entry.source,
      handlerHash: entry.handlerHash,
      effectPlanHash: entry.effectPlan.planHash
    }))),
    capabilities: reachableCapabilities,
    providerKinds: reachableProviderKinds,
    packages: reachablePackages,
    policy: Object.freeze({
      staticHandlerTable: true,
      selectedHandlerExecutesAtRuntime: true,
      undeclaredHandlersExcluded: true,
      recursiveDispatch: false,
      dynamicDispatch: false
    })
  });
  const semantic = {
    version: managedHandlerIrBundleVersion,
    descriptorVersion: managedHandlerDescriptorVersion,
    handlerIrVersion: managedHandlerIrVersion,
    role: MANAGED_HANDLER_ROLE,
    graphHash: inputs.graphBuild.graph.graphHash,
    handlers: Object.freeze(handlers),
    reachability,
    summary: Object.freeze({
      handlers: handlers.length,
      schemaInputs: handlers.filter((entry) => entry.parameters.input.kind === 'schema-value').length,
      schemaResults: handlers.filter((entry) => entry.result.kind === 'schema-value').length,
      completions: handlers.filter((entry) => entry.result.kind === 'completion').length,
      effects: handlers.reduce((sum, entry) => sum + entry.effects.count, 0),
      continuations: handlers.reduce((sum, entry) => sum + entry.effects.continuations.length, 0),
      capabilities: reachableCapabilities.length,
      nativeEligible: handlers.filter((entry) => entry.eligibility.native.eligible).length
    })
  };
  return deepFreeze({ ...semantic, bundleHash: sha256Hex(stableStringify(semantic)) });
}

function canonicalHandlerIrForManagedHandler(handler) {
  return handler && typeof handler === 'object' ? canonicalHandlerIr.get(handler) : undefined;
}

function compileManagedHandlerNativeBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || bundle.version !== managedHandlerIrBundleVersion) {
    throw new TypeError(`compileManagedHandlerNativeBundle requires ${managedHandlerIrBundleVersion}.`);
  }
  if (!Array.isArray(bundle.handlers)) {
    throw new TypeError('compileManagedHandlerNativeBundle requires managed handlers.');
  }
  const handlers = bundle.handlers.map((handler) => {
    const facts = managedHandlerNativeFacts.get(handler);
    if (!facts) {
      const error = new TypeError(`Managed handler ${String(handler && handler.id || '<unknown>')} has no private Native projection facts.`);
      error.code = 'PULSE_MANAGED_HANDLER_NATIVE_FACTS_UNAVAILABLE';
      throw error;
    }
    if (!handler.eligibility || !handler.eligibility.native || handler.eligibility.native.eligible !== true) {
      const error = new TypeError(`Managed handler ${handler.id} is not eligible for Native lowering.`);
      error.code = 'PULSE_MANAGED_HANDLER_NATIVE_INELIGIBLE';
      throw error;
    }
    return facts;
  }).sort((left, right) => left.id.localeCompare(right.id) || left.nativeFactsHash.localeCompare(right.nativeFactsHash));
  const capabilities = sortedUnique(handlers.flatMap((handler) => handler.providerRequirements.capabilities));
  const providerKinds = sortedUnique(handlers.flatMap((handler) => handler.providerRequirements.providerKinds));
  const semantic = {
    version: managedHandlerNativeBundleVersion,
    handlerIrBundleVersion: managedHandlerIrBundleVersion,
    handlerIrVersion: managedHandlerIrVersion,
    nativeFactsVersion: managedHandlerNativeFactsVersion,
    graphHash: bundle.graphHash,
    handlers: Object.freeze(handlers),
    reachability: bundle.reachability,
    capabilities,
    providerKinds,
    summary: Object.freeze({
      handlers: handlers.length,
      effects: handlers.reduce((sum, handler) => sum + handler.effects.count, 0),
      continuations: handlers.reduce((sum, handler) => sum + handler.effects.continuations.length, 0),
      runtimeInputs: handlers.reduce((sum, handler) => sum + handler.effects.runtimeInputs.reduce((count, effect) => count + effect.inputs.length, 0), 0),
      capabilities: capabilities.length
    }),
    policy: Object.freeze({
      genericDataOnly: true,
      sourceAstExcluded: true,
      packageSemanticsExcluded: true,
      publicHandlerIrVersionFrozen: true,
      automaticFallback: false
    })
  };
  return deepFreeze({ ...semantic, bundleHash: sha256Hex(stableStringify(semantic)) });
}

module.exports = Object.freeze({
  MANAGED_HANDLER_DESCRIPTOR_VERSION: managedHandlerDescriptorVersion,
  MANAGED_HANDLER_IR_VERSION: managedHandlerIrVersion,
  MANAGED_HANDLER_IR_BUNDLE_VERSION: managedHandlerIrBundleVersion,
  MANAGED_HANDLER_EFFECT_PLAN_VERSION: managedHandlerEffectPlanVersion,
  MANAGED_HANDLER_REACHABILITY_VERSION: managedHandlerReachabilityVersion,
  MANAGED_HANDLER_NATIVE_FACTS_VERSION: managedHandlerNativeFactsVersion,
  MANAGED_HANDLER_NATIVE_BUNDLE_VERSION: managedHandlerNativeBundleVersion,
  MANAGED_HANDLER_ROLE,
  MANAGED_HANDLER_INPUT_KINDS: managedHandlerInputKinds,
  MANAGED_HANDLER_RESULT_KINDS: managedHandlerResultKinds,
  MANAGED_HANDLER_OPERATION_KINDS: managedHandlerOperationKinds,
  ManagedHandlerCompileError,
  compileManagedHandlerDescriptors,
  compileManagedHandlerNativeBundle,
  canonicalHandlerIrForManagedHandler
});
