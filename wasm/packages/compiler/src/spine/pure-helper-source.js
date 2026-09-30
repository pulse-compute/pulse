'use strict';

const ts = require('typescript');

// Admission only; lowering remains in Handler IR and the canonical plan.
function validatePureHelperSource(helper) {
  const fn = helper.functionNode, source = helper.sourceFile, diagnostics = [];
  const scalar = node => node && [ts.SyntaxKind.StringKeyword, ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.BooleanKeyword].includes(node.kind);
  function fail(node, reason, message) {
    const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
    diagnostics.push({ code: `PULSE_NATIVE_PURE_HELPER_${reason}_UNSUPPORTED`, severity: 'error', message,
      file: helper.source.file, position: { line: pos.line + 1, column: pos.character + 1 } });
  }
  if (!ts.isFunctionDeclaration(fn) || fn.asteriskToken || fn.typeParameters?.length || !fn.body || !ts.isBlock(fn.body)
    || fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || !scalar(fn.type)
    || fn.parameters.some(p => !ts.isIdentifier(p.name) || p.name.text === 'ctx' || !scalar(p.type) || p.initializer || p.dotDotDotToken || p.questionToken)
    || new Set(fn.parameters.map(p => p.name.getText(source))).size !== fn.parameters.length) {
    fail(fn, 'SIGNATURE', 'Pure helpers require synchronous function declarations with explicit scalar parameters and result.');
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
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)
      || ts.isNewExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      fail(node, 'VALUE', 'PF-02 accepts only scalar values and no structured inputs or type assertions.'); return;
    }
    if (ts.isIdentifier(node) && !names.has(node.text)) fail(node, 'CAPTURE', `Pure helper cannot capture ${node.text}.`);
    const target = ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ? node.left : ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) ? node.operand : undefined;
    if (target && ts.isIdentifier(target) && params.has(target.text)) fail(node, 'MUTATION', 'Pure helper parameters are read-only.');
    if (ts.isVariableDeclaration(node)) {
      if (!node.initializer || node.type && !scalar(node.type)) fail(node, 'LOCAL', 'Pure helper locals require scalar initializers.');
      if (node.initializer) inspect(node.initializer);
      return;
    }
    ts.forEachChild(node, inspect);
  }
  inspect(fn.body);
  return diagnostics;
}
module.exports = { validatePureHelperSource };
