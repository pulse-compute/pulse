'use strict';

function classifyCallExpression(ts, call, scope) {
  const expr = call.expression;
  if (ts.isIdentifier(expr)) {
    if (expr.text === 'next') return { kind: 'continuation', name: 'next', resolved: true };
    if (scope && scope.localFunctions && scope.localFunctions.has(expr.text)) {
      return { kind: 'local-function', name: expr.text, resolved: true };
    }
    return { kind: 'identifier', name: expr.text, resolved: false };
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return { kind: 'member', name: expr.name.text, resolved: false };
  }
  return { kind: 'dynamic', name: call.getText ? call.getText() : '<dynamic>', resolved: false };
}

module.exports = { classifyCallExpression };
