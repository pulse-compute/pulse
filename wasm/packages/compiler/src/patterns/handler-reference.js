'use strict';

const { match, unknown } = require('./result.js');

function isInlineFunction(ts, node) {
  return Boolean(node) && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function classifyHandlerReference(ts, node) {
  if (ts.isIdentifier(node)) return match({ kind: 'identifier', name: node.text });
  if (isInlineFunction(ts, node)) {
    return match({
      kind: 'inline',
      inlineKind: ts.isArrowFunction(node) ? 'inline-arrow' : 'inline-function-expression'
    });
  }
  return unknown();
}

function classifyChannelReference(ts, node, isStringLiteralLike) {
  if (isStringLiteralLike(ts, node)) return match({ kind: 'static', value: node.text });
  return classifyHandlerReference(ts, node);
}

module.exports = {
  classifyChannelReference,
  classifyHandlerReference,
  isInlineFunction
};
