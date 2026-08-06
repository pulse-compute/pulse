'use strict';

function isRouterNewExpression(ts, init, unwrapExpression) {
  const expr = unwrapExpression(ts, init);
  return Boolean(expr && ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) && ['Router', 'Pulse'].includes(expr.expression.text));
}

function isDirectRouterDeclarationInitializer(ts, node) {
  let current = node;
  while (current.parent && (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent) || ts.isNonNullExpression(current.parent))) {
    current = current.parent;
  }
  return Boolean(current.parent && ts.isVariableDeclaration(current.parent) && current.parent.initializer === current && ts.isIdentifier(current.parent.name));
}

module.exports = {
  isDirectRouterDeclarationInitializer,
  isRouterNewExpression
};
