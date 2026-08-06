'use strict';

function isEnvCall(ts, expr, envParamName) {
  if (ts.isIdentifier(expr) && expr.text === envParamName) {
    return { method: 'string' };
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === envParamName) {
    return { method: expr.name.text, nameNode: expr.name };
  }
  return null;
}

module.exports = { isEnvCall };
