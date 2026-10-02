'use strict';

const ts = require('typescript');
const values = require('../pure-helper-values');

// Admission only; lowering remains in Handler IR and the canonical plan.
function validatePureHelperSource(helper) {
  const fn = helper.functionNode, source = helper.sourceFile, diagnostics = [];
  const scalar = node => node && values.scalar(ts.tokenToString(node.kind));
  helper.parameterTypes = fn.parameters.map(p => helper.resolveType?.(p.type) || (scalar(p.type) ? p.type.getText(source) : undefined));
  function fail(node, reason, message) {
    const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
    diagnostics.push({ code: `PULSE_NATIVE_PURE_HELPER_${reason}_UNSUPPORTED`, severity: 'error', message,
      file: helper.source.file, position: { line: pos.line + 1, column: pos.character + 1 } });
  }
  if (!ts.isFunctionDeclaration(fn) || fn.asteriskToken || fn.typeParameters?.length || !fn.body || !ts.isBlock(fn.body)
    || fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || !scalar(fn.type)
    || fn.parameters.some(p => !ts.isIdentifier(p.name) || p.name.text === 'ctx' || !helper.parameterTypes[fn.parameters.indexOf(p)] || p.initializer || p.dotDotDotToken || p.questionToken)
    || new Set(fn.parameters.map(p => p.name.getText(source))).size !== fn.parameters.length) {
    fail(fn, 'SIGNATURE', 'Pure helpers require synchronous function declarations with explicit bounded scalar/record/number-array parameters and a scalar result.');
    return diagnostics;
  }
  // Function declarations are mutable bindings in JS; reject writes anywhere in
  // the defining module. Caller shadowing is checked at the resolved call site.
  function assignments(node) {
    const target = ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ? node.left : (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) ? node.operand : undefined;
    if (target && ts.isIdentifier(target) && target.text === fn.name.text) fail(node, 'IDENTITY', 'Pure helper identities cannot be reassigned.');
    ts.forEachChild(node, assignments);
  }
  assignments(source);
  const params = new Set(fn.parameters.map(p => p.name.text));
  const names = new Set(params);
  function collect(node) {
    if (node !== fn && ts.isFunctionLike(node)) { fail(node, 'CAPTURE', 'Nested functions and closures are outside pure helpers.'); return; }
    if (ts.isVariableDeclaration(node)) {
      if (!ts.isIdentifier(node.name) || names.has(node.name.text)) fail(node, 'LOCAL', 'Pure helper locals must have unique identifier bindings.');
      else names.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  }
  collect(fn.body);
  function inspect(node) {
    if (ts.isCallExpression(node)) { fail(node, 'CALL', 'Pure helpers cannot call helpers, callbacks, methods, effects or Router operations.'); return; }
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node) || ts.isThrowStatement(node) || ts.isTryStatement(node)) {
      fail(node, 'CONTROL', 'Async operations and exception syntax are outside pure helpers.'); return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.questionDotToken) fail(node, 'SHAPE', 'Optional access is outside pure helpers.');
      inspect(node.expression); return;
    }
    if (ts.isElementAccessExpression(node)) {
      if (node.questionDotToken) fail(node, 'SHAPE', 'Optional access is outside pure helpers.');
      inspect(node.expression); inspect(node.argumentExpression); return;
    }
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)
      || ts.isNewExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      fail(node, 'VALUE', 'Pure helpers cannot allocate structured values or use type assertions.'); return;
    }
    if (ts.isIdentifier(node) && !names.has(node.text)) fail(node, 'CAPTURE', `Pure helper cannot capture ${node.text}.`);
    const target = ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ? node.left : ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) ? node.operand : undefined;
    if (target && (!ts.isIdentifier(target) || params.has(target.text))) fail(node, 'MUTATION', 'Pure helper parameters are read-only.');
    if (ts.isVariableDeclaration(node)) {
      if (!node.initializer || node.type && !scalar(node.type) && !helper.resolveType?.(node.type)) fail(node, 'LOCAL', 'Pure helper locals require supported initializers.');
      if (node.initializer) inspect(node.initializer);
      return;
    }
    ts.forEachChild(node, inspect);
  }
  inspect(fn.body);
  return diagnostics;
}
// Resolve only structural declarations in the already contained project graph.
// No TypeScript checker widening, ambient types, package lookup or runtime import.
function resolvePureType(context, module, node, seen = new Set(), depth = 0) {
  if (!node || depth > values.BORROW_LIMITS.recordDepth) return;
  if (values.scalar(ts.tokenToString(node.kind))) return node.getText(module.sourceFile);
  if (ts.isArrayTypeNode(node) && node.elementType.kind === ts.SyntaxKind.NumberKeyword) return { kind: 'number-array' };
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && !node.typeArguments?.length) {
    const name = node.typeName.text, key = module.path + '#' + name;
    if (seen.has(key)) return;
    const next = new Set([...seen, key]);
    const declarations = module.sourceFile.statements.filter(s => (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name.text === name);
    if (declarations.length === 1) {
      const decl = declarations[0];
      if (decl.typeParameters?.length || decl.heritageClauses?.length) return;
      return resolvePureType(context, module, ts.isTypeAliasDeclaration(decl) ? decl.type : decl, next, depth);
    }
    for (const relation of module.imports) {
      const binding = relation.bindings.find(b => b.localName === name);
      if (!binding || binding.importedName === '*') continue;
      const resolution = module.resolutions.find(r => r.relation === relation);
      const target = resolution && context.projectModules.get(resolution.targetKey);
      if (!target) return;
      const exported = target.sourceFile.statements.find(s => (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name.text === binding.importedName && s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
      const targetName = target.localExports.get(binding.importedName) || exported?.name.text;
      if (!targetName) return;
      const decl = target.sourceFile.statements.find(s => (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name.text === targetName);
      if (!decl || decl.typeParameters?.length || decl.heritageClauses?.length) return;
      return resolvePureType(context, target, ts.isTypeAliasDeclaration(decl) ? decl.type : decl, next, depth);
    }
    return;
  }
  if ((ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) && depth < values.BORROW_LIMITS.recordDepth) {
    const fields = [];
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name) || member.questionToken || member.initializer) return;
      const name = member.name.text;
      if (values.FORBIDDEN_FIELDS.includes(name) || fields.some(f => f.name === name)) return;
      const type = resolvePureType(context, module, member.type, seen, depth + 1);
      if (!type) return;
      fields.push({ name, type });
    }
    if (fields.length && fields.length <= values.BORROW_LIMITS.recordFields) return { kind: 'record', fields };
  }
}
function typeNode(type) {
  if (typeof type === 'string') return ts.factory.createKeywordTypeNode({string:ts.SyntaxKind.StringKeyword,number:ts.SyntaxKind.NumberKeyword,boolean:ts.SyntaxKind.BooleanKeyword}[type]);
  if (type.kind === 'number-array') return ts.factory.createArrayTypeNode(typeNode('number'));
  return ts.factory.createTypeLiteralNode(type.fields.map(f => ts.factory.createPropertySignature(undefined, f.name, undefined, typeNode(f.type))));
}
module.exports = { validatePureHelperSource, resolvePureType, typeNode };
