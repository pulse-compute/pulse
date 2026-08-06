'use strict';

const { DIAGNOSTIC_CODES } = require('../diagnostics/codes.js');

function unwindRouterCallChain(ts, sourceFile, expr, diagnostics, diagnostic) {
  const steps = [];
  let cursor = expr;

  while (ts.isCallExpression(cursor)) {
    const callee = cursor.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      steps.unshift({ method: callee.name.text, args: Array.from(cursor.arguments), node: cursor, nameNode: callee.name });
      cursor = callee.expression;
      continue;
    }
    if (ts.isElementAccessExpression(callee)) {
      if (diagnostics && diagnostic) {
        diagnostics.push(
          diagnostic(
            sourceFile,
            callee,
            DIAGNOSTIC_CODES.COMPUTED_METHOD,
            'Computed router method calls are not supported in PulseWasm v1.',
            'Use direct property calls such as app.get("/path", handler).',
            { phase: 'extract' }
          )
        );
      }
      return null;
    }
    return null;
  }

  if (!ts.isIdentifier(cursor)) return null;
  return { root: cursor.text, rootNode: cursor, steps };
}

function isOutermostCallInChain(ts, node) {
  return !(
    node.parent &&
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.parent &&
    ts.isCallExpression(node.parent.parent)
  );
}

module.exports = {
  isOutermostCallInChain,
  unwindRouterCallChain
};
