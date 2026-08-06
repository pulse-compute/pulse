'use strict';

const ts = require('typescript');
const {
  createConfigScope,
  normalizeProjectDeclaration,
  selectProfilePlan
} = require('@pulse-compute/wasm-contracts/project/config-plan');

const PROJECT_CONFIG_COMPILER_VERSION = 'pulse.project-config-compiler.v1';
const CONFIG_PACKAGE = '@pulse-compute/pulse';
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

class PulseProjectConfigCompileError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PulseProjectConfigCompileError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function scriptKind(file) {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  if (/\.js$/i.test(file) || /\.cjs$/i.test(file) || /\.mjs$/i.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function location(sourceFile, node) {
  const start = node.getStart(sourceFile);
  const point = sourceFile.getLineAndCharacterOfPosition(start);
  return Object.freeze({
    file: sourceFile.fileName,
    line: point.line + 1,
    column: point.character + 1,
    start,
    end: node.end
  });
}

function fail(sourceFile, node, code, message, detail = {}) {
  throw new PulseProjectConfigCompileError(code, message, {
    ...detail,
    source: location(sourceFile, node)
  });
}

function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function propertyName(sourceFile, node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return String(node.text);
  fail(sourceFile, node, 'PULSE_CONFIG_PROPERTY_NAME_UNSUPPORTED', 'Pulse config property names must be static identifiers or literals.');
}

function factoryBodyExpression(sourceFile, factory) {
  if (ts.isExpression(factory.body)) return unwrap(factory.body);
  const statements = factory.body.statements.filter((entry) => !ts.isEmptyStatement(entry));
  if (statements.length !== 1 || !ts.isReturnStatement(statements[0]) || !statements[0].expression) {
    fail(sourceFile, factory.body, 'PULSE_CONFIG_FACTORY_BODY_UNSUPPORTED', 'Pulse config factory must be an expression body or contain exactly one return statement.');
  }
  return unwrap(statements[0].expression);
}

function evaluateExpression(sourceFile, node, context, path = 'config') {
  const value = unwrap(node);
  if (ts.isStringLiteralLike(value)) return value.text;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(value) && (value.operator === ts.SyntaxKind.MinusToken || value.operator === ts.SyntaxKind.PlusToken)) {
    const operand = unwrap(value.operand);
    if (!ts.isNumericLiteral(operand)) fail(sourceFile, value, 'PULSE_CONFIG_VALUE_UNSUPPORTED', `${path} supports unary +/- only for numeric literals.`);
    const number = Number(operand.text);
    return value.operator === ts.SyntaxKind.MinusToken ? -number : number;
  }
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.map((entry, index) => {
      if (ts.isSpreadElement(entry)) fail(sourceFile, entry, 'PULSE_CONFIG_SPREAD_UNSUPPORTED', 'Pulse config arrays do not support spread elements.');
      return evaluateExpression(sourceFile, entry, context, `${path}[${index}]`);
    });
  }
  if (ts.isObjectLiteralExpression(value)) {
    const out = Object.create(null);
    for (const member of value.properties) {
      if (ts.isSpreadAssignment(member)) fail(sourceFile, member, 'PULSE_CONFIG_SPREAD_UNSUPPORTED', 'Pulse config objects do not support spread properties.');
      if (!ts.isPropertyAssignment(member)) {
        fail(sourceFile, member, 'PULSE_CONFIG_PROPERTY_UNSUPPORTED', 'Pulse config objects support only explicit property assignments.');
      }
      if (member.name && ts.isComputedPropertyName(member.name)) {
        fail(sourceFile, member.name, 'PULSE_CONFIG_COMPUTED_KEY_UNSUPPORTED', 'Pulse config objects do not support computed property names.');
      }
      const key = propertyName(sourceFile, member.name);
      if (UNSAFE_KEYS.has(key)) fail(sourceFile, member.name, 'PULSE_CONFIG_UNSAFE_KEY', `Pulse config property ${key} is not allowed.`, { key });
      if (Object.prototype.hasOwnProperty.call(out, key)) fail(sourceFile, member.name, 'PULSE_CONFIG_DUPLICATE_KEY', `Pulse config property ${key} is duplicated.`, { key });
      out[key] = evaluateExpression(sourceFile, member.initializer, context, `${path}.${key}`);
    }
    return out;
  }
  if (ts.isCallExpression(value)) {
    const callee = unwrap(value.expression);
    if (
      ts.isPropertyAccessExpression(callee)
      && ts.isIdentifier(callee.expression)
      && callee.expression.text === context.scopeName
      && (callee.name.text === 'config' || callee.name.text === 'secret')
    ) {
      if (value.arguments.length !== 1 || !ts.isStringLiteralLike(unwrap(value.arguments[0]))) {
        fail(sourceFile, value, 'PULSE_CONFIG_SCOPE_LITERAL_REQUIRED', `scope.${callee.name.text} requires one string literal name.`);
      }
      const name = unwrap(value.arguments[0]).text;
      return context.scope[callee.name.text](name);
    }
    fail(sourceFile, value, 'PULSE_CONFIG_CALL_UNSUPPORTED', 'Pulse config factories allow calls only to direct scope.config() and scope.secret() members.');
  }
  if (ts.isIdentifier(value) && value.text === 'undefined') {
    fail(sourceFile, value, 'PULSE_CONFIG_UNDEFINED_UNSUPPORTED', `${path} cannot contain undefined.`);
  }
  fail(sourceFile, value, 'PULSE_CONFIG_VALUE_UNSUPPORTED', `${path} contains unsupported executable syntax.`, {
    kind: ts.SyntaxKind[value.kind],
    text: value.getText(sourceFile)
  });
}

function findConfigFactory(sourceFile) {
  let defineImport = null;
  let exportExpression = null;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteralLike(statement.moduleSpecifier) || statement.moduleSpecifier.text !== CONFIG_PACKAGE) {
        fail(sourceFile, statement, 'PULSE_CONFIG_IMPORT_UNSUPPORTED', `Conventional Pulse config may import only defineConfig from ${CONFIG_PACKAGE}.`);
      }
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
        fail(sourceFile, statement, 'PULSE_CONFIG_IMPORT_SHAPE_UNSUPPORTED', `Import defineConfig as a direct named import from ${CONFIG_PACKAGE}.`);
      }
      if (defineImport) fail(sourceFile, statement, 'PULSE_CONFIG_IMPORT_DUPLICATE', 'Pulse config may contain only one import declaration.');
      const elements = clause.namedBindings.elements;
      if (elements.length !== 1 || elements[0].propertyName || elements[0].name.text !== 'defineConfig') {
        fail(sourceFile, statement, 'PULSE_CONFIG_IMPORT_SHAPE_UNSUPPORTED', `Import only the unaliased defineConfig symbol from ${CONFIG_PACKAGE}.`);
      }
      defineImport = elements[0].name.text;
      continue;
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (exportExpression) fail(sourceFile, statement, 'PULSE_CONFIG_EXPORT_DUPLICATE', 'Pulse config must contain one default export.');
      exportExpression = statement.expression;
      continue;
    }
    if (ts.isEmptyStatement(statement)) continue;
    fail(sourceFile, statement, 'PULSE_CONFIG_TOP_LEVEL_UNSUPPORTED', 'Conventional Pulse config permits only its defineConfig import and one default export.');
  }
  if (!defineImport) fail(sourceFile, sourceFile, 'PULSE_CONFIG_DEFINE_IMPORT_REQUIRED', `Pulse config must import defineConfig from ${CONFIG_PACKAGE}.`);
  if (!exportExpression) fail(sourceFile, sourceFile, 'PULSE_CONFIG_DEFAULT_EXPORT_REQUIRED', 'Pulse config must default-export defineConfig((scope) => ({ ... })).');
  const call = unwrap(exportExpression);
  if (!ts.isCallExpression(call) || !ts.isIdentifier(unwrap(call.expression)) || unwrap(call.expression).text !== defineImport || call.arguments.length !== 1) {
    fail(sourceFile, exportExpression, 'PULSE_CONFIG_FACTORY_REQUIRED', 'Pulse config must default-export one direct defineConfig(factory) call.');
  }
  const factory = unwrap(call.arguments[0]);
  if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) {
    fail(sourceFile, factory, 'PULSE_CONFIG_FACTORY_REQUIRED', 'defineConfig requires one inline configuration factory.');
  }
  if (factory.modifiers && factory.modifiers.some((entry) => entry.kind === ts.SyntaxKind.AsyncKeyword)) {
    fail(sourceFile, factory, 'PULSE_CONFIG_FACTORY_ASYNC_UNSUPPORTED', 'Pulse config factories must be synchronous.');
  }
  if (factory.asteriskToken) fail(sourceFile, factory, 'PULSE_CONFIG_FACTORY_GENERATOR_UNSUPPORTED', 'Pulse config factories cannot be generators.');
  if (factory.parameters.length !== 1 || !ts.isIdentifier(factory.parameters[0].name)) {
    fail(sourceFile, factory, 'PULSE_CONFIG_SCOPE_PARAMETER_REQUIRED', 'Pulse config factory requires exactly one identifier parameter for its symbolic scope.');
  }
  return { factory, scopeName: factory.parameters[0].name.text };
}

function compileProjectConfigSource(source, options = {}) {
  const file = String(options.file || '.pulse/config.ts');
  const sourceFile = ts.createSourceFile(file, String(source), ts.ScriptTarget.ES2022, true, scriptKind(file));
  const parseErrors = sourceFile.parseDiagnostics || [];
  if (parseErrors.length > 0) {
    const first = parseErrors[0];
    const node = first.start == null ? sourceFile : sourceFile.getChildAt(first.start, sourceFile);
    fail(sourceFile, node || sourceFile, 'PULSE_CONFIG_PARSE_FAILED', ts.flattenDiagnosticMessageText(first.messageText, '\n'), { typescriptCode: first.code });
  }
  const found = findConfigFactory(sourceFile);
  const raw = evaluateExpression(sourceFile, factoryBodyExpression(sourceFile, found.factory), {
    scopeName: found.scopeName,
    scope: createConfigScope()
  });
  const declaration = normalizeProjectDeclaration(raw, { source: options.source || file });
  const result = {
    version: PROJECT_CONFIG_COMPILER_VERSION,
    file,
    declaration
  };
  const selection = options.selection || ((options.cliProfile !== undefined || options.environmentProfile !== undefined || options.profile !== undefined)
    ? { cliProfile: options.cliProfile, environmentProfile: options.environmentProfile, name: options.profile, source: options.profileSource }
    : null);
  if (selection) result.plan = selectProfilePlan(declaration, selection);
  return Object.freeze(result);
}

function compileProjectConfigFile(file, options = {}) {
  const fs = require('node:fs');
  return compileProjectConfigSource(fs.readFileSync(file, 'utf8'), { ...options, file });
}

module.exports = Object.freeze({
  PROJECT_CONFIG_COMPILER_VERSION,
  CONFIG_PACKAGE,
  PulseProjectConfigCompileError,
  compileProjectConfigSource,
  compileProjectConfigFile
});
