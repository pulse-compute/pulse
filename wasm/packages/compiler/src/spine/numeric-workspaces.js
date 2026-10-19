'use strict';
const ts = require('typescript');
// Lexical ownership check shared by Native and original-source JavaScript.
function inspectNumericWorkspaces(handler, ctxName) {
  const errors = [];
  const fail = node => errors.push({ node, message: 'Numeric workspaces require a const literal-capacity construction and direct length/index access in the declaring function; only simple indexed writes are allowed.' });
  function nonNumericIndex(node, scope, seen = new Set()) {
    if (ts.isParenthesizedExpression(node)) return nonNumericIndex(node.expression, scope, seen);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      const initial = scope.get(node.text)?.declaration?.initializer;
      return initial ? nonNumericIndex(initial, scope, seen) : false;
    }
    return false;
  }
  function visit(node, scope, depth, loop) {
    if (ts.isBlock(node)) {
      scope = new Map(scope);
      for (const s of node.statements) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) scope.set(d.name.text, { declaration: d, depth });
    }
    if (node !== handler && ts.isFunctionLike(node)) {
      scope = new Map(scope); depth++;
      for (const p of node.parameters || []) if (ts.isIdentifier(p.name)) scope.set(p.name.text, { depth });
    }
    if (ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForOfStatement(node)) loop = true;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const call = node.initializer, target = call.expression;
      if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(target) && target.name.text === 'numbers'
        && ts.isPropertyAccessExpression(target.expression) && target.expression.name.text === 'workspace'
        && ts.isIdentifier(target.expression.expression) && target.expression.expression.text === ctxName && !scope.has(ctxName)) {
        const cap = call.arguments[0];
        if (!(node.parent.flags & ts.NodeFlags.Const) || loop || call.arguments.length !== 1 || !cap || !ts.isNumericLiteral(cap)
          || !Number.isInteger(Number(cap.text)) || Number(cap.text) < 1 || Number(cap.text) > 1024
          || call.questionDotToken || target.questionDotToken || target.expression.questionDotToken || call.typeArguments?.length) fail(node);
        else { scope.set(node.name.text, { declaration: node, depth, workspace: true }); return; }
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'workspace' && ts.isIdentifier(node.expression)
      && node.expression.text === ctxName && !scope.has(ctxName)) fail(node);
    if (ts.isIdentifier(node)) {
      if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
        || ts.isPropertyAssignment(node.parent) && node.parent.name === node && !ts.isComputedPropertyName(node.parent.name)) return;
      const binding = scope.get(node.text);
      if (binding?.workspace && node !== binding.declaration.name) {
        const access = node.parent, parent = access?.parent;
        const element = ts.isElementAccessExpression(access) && access.expression === node && !access.questionDotToken;
        const length = ts.isPropertyAccessExpression(access) && access.expression === node && access.name.text === 'length' && !access.questionDotToken;
        if (element && nonNumericIndex(access.argumentExpression, scope)) fail(node);
        if (depth !== binding.depth || !(element || length)) fail(node);
        if (ts.isBinaryExpression(parent) && parent.left === access && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
          && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment && (!element || parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken)) fail(node);
        if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)) fail(node);
      }
    }
    ts.forEachChild(node, child => visit(child, scope, depth, loop));
  }
  visit(handler.body, new Map(), 0, false);
  return errors;
}
module.exports = { inspectNumericWorkspaces };
