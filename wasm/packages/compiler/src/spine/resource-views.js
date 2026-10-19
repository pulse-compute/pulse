'use strict';
const ts = require('typescript');
const reads = new Set(['readU8', 'readU32LE', 'readF32LE']);

// Lexical view admission shared by original-source JS and generated Native.
// Views are not values in the portable authoring model: only their direct reads
// can cross a helper, state, response or continuation boundary.
function inspectResourceViews(handler, ctxName) {
  const errors = [], calls = new WeakSet(), identities = new Set();
  const fail = node => errors.push({ node, message: 'Binary resources require const views mapped from literal identities, used only for byteLength or direct scalar reads in the declaring function.' });
  function visit(node, scope, depth) {
    if (ts.isBlock(node)) {
      scope = new Map(scope);
      // Predeclare to respect lexical shadowing, including temporal dead zones.
      for (const statement of node.statements) if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) scope.set(declaration.name.text, { declaration, depth });
      }
    }
    if (node !== handler && ts.isFunctionLike(node)) {
      scope = new Map(scope); depth++;
      for (const parameter of node.parameters || []) if (ts.isIdentifier(parameter.name)) scope.set(parameter.name.text, { depth });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const call = node.initializer;
      if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
        && call.expression.name.text === 'map' && ts.isPropertyAccessExpression(call.expression.expression)
        && call.expression.expression.name.text === 'resources' && ts.isIdentifier(call.expression.expression.expression)
        && call.expression.expression.expression.text === ctxName && !scope.has(ctxName)) {
        const id = call.arguments[0];
        if (!(node.parent.flags & ts.NodeFlags.Const) || call.arguments.length !== 1 || !id
          || !(ts.isStringLiteral(id) || ts.isNoSubstitutionTemplateLiteral(id)) || call.questionDotToken || call.expression.questionDotToken || call.expression.expression.questionDotToken || call.typeArguments?.length) fail(node);
        else {
          scope.set(node.name.text, { declaration: node, depth, resource: true }); identities.add(id.text);
          return;
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'resources' && ts.isIdentifier(node.expression)
      && node.expression.text === ctxName && !scope.has(ctxName)) fail(node);
    if (ts.isIdentifier(node)) {
      const binding = scope.get(node.text);
      if (binding?.resource && node !== binding.declaration.name) {
        const property = node.parent, call = property?.parent;
        if (depth !== binding.depth || !ts.isPropertyAccessExpression(property) || property.expression !== node || property.questionDotToken) fail(node);
        else if (property.name.text === 'byteLength') {
          if (ts.isBinaryExpression(call) && call.left === property && call.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
            && call.operatorToken.kind <= ts.SyntaxKind.LastAssignment || (ts.isPrefixUnaryExpression(call) || ts.isPostfixUnaryExpression(call)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(call.operator)) fail(node);
        } else if (reads.has(property.name.text) && ts.isCallExpression(call) && call.expression === property
          && call.arguments.length === 1 && !call.questionDotToken && !call.typeArguments?.length) calls.add(call);
        else fail(node);
      }
    }
    ts.forEachChild(node, child => visit(child, scope, depth));
  }
  visit(handler.body, new Map(), 0);
  return { errors, calls, identities: [...identities].sort() };
}
module.exports = { inspectResourceViews };
