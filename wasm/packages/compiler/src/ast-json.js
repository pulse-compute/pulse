'use strict';

const { sourceLoc } = require('./diagnostics.js');

const TEXT_KINDS = new Set([
  'Identifier',
  'StringLiteral',
  'NoSubstitutionTemplateLiteral',
  'NumericLiteral',
  'PropertyAccessExpression',
  'CallExpression',
  'NewExpression',
  'VariableDeclaration',
  'FunctionDeclaration',
  'ArrowFunction',
  'FunctionExpression'
]);

function compactText(text, maxLength) {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function astToJson(ts, sourceFile, options = {}) {
  const maxTextLength = options.maxTextLength ?? 180;
  const maxDepth = options.maxDepth ?? 80;

  function visit(node, depth) {
    const kind = ts.SyntaxKind[node.kind] || String(node.kind);
    const out = {
      kind,
      loc: sourceLoc(sourceFile, node)
    };
    if (TEXT_KINDS.has(kind)) {
      out.text = compactText(node.getText(sourceFile), maxTextLength);
    }
    if (depth >= maxDepth) {
      out.truncated = true;
      return out;
    }
    const children = [];
    ts.forEachChild(node, (child) => {
      children.push(visit(child, depth + 1));
    });
    if (children.length > 0) out.children = children;
    return out;
  }

  return visit(sourceFile, 0);
}

module.exports = { astToJson };
