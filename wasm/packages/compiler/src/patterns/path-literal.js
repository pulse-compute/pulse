'use strict';

function isStringLiteralLike(ts, node) {
  return Boolean(node) && (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral);
}

function literalText(node) {
  return node.text;
}

function nodeText(sourceFile, node) {
  return node.getText(sourceFile).trim();
}

function unwrapExpression(ts, node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression?.(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

module.exports = {
  isStringLiteralLike,
  literalText,
  nodeText,
  unwrapExpression
};
